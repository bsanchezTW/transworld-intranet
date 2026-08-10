const db = require("../../db");
const { getStrategy } = require("./VacationEngine");
const balanceService = require("./vacationBalanceService");
const holidayService = require("./holidayService");
const { VACATION_STATUS, VACATION_ACTIVE_STATUSES } = require("../../constants/vacationStatuses");
const { VACATION_CONFIG } = require("../../constants/vacationConfig");
const { toDateOnly } = require("../../utils/vacationDateUtils");

/**
 * Lógica de solicitudes de vacaciones: creación con validación por país,
 * aprobación transaccional con consumo de saldo, rechazo y cancelación.
 */

async function getRequestById(id) {
  const { rows } = await db.query(
    `SELECT * FROM vacation_requests WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Solicitudes activas de un usuario (para solapamiento y fraccionamiento). */
async function getActiveRequests(userId, excludeRequestId = null) {
  const params = [userId, VACATION_ACTIVE_STATUSES];
  let sql = `SELECT id, start_date, end_date, business_days, calendar_days, status, vacation_period_id
             FROM vacation_requests
             WHERE user_id = $1 AND status = ANY($2)`;
  if (excludeRequestId) {
    params.push(excludeRequestId);
    sql += ` AND id <> $3`;
  }
  const { rows } = await db.query(sql, params);
  return rows;
}

function vacationConfigForValidation() {
  return {
    minNoticeDaysCL: VACATION_CONFIG.minNoticeDaysCL,
    minNoticeDaysPE: VACATION_CONFIG.minNoticeDaysPE,
    minLongFractionCL: VACATION_CONFIG.minLongFractionCL,
    suggestedMinFractionDaysPE: VACATION_CONFIG.suggestedMinFractionDaysPE,
  };
}

/**
 * Crea una solicitud (estado pending) tras validar las reglas del país.
 * @returns {{ ok: boolean, errors?: string[], warnings?: string[], request?: object, days?: number }}
 */
async function createRequest({
  userId,
  startDate,
  endDate,
  notes,
  allowPast = false,
  fractionAcknowledged = false,
  policyWarningAck = false,
}) {
  const user = await balanceService.getUserVacationProfile(userId);
  if (!user) return { ok: false, errors: ["Colaborador no encontrado."] };
  if (!user.hire_date) {
    return {
      ok: false,
      errors: ["No tienes fecha de ingreso registrada. Contacta a RRHH."],
    };
  }

  const country = user.employment_country || "CL";
  const strategy = getStrategy(country);

  await balanceService.recalculatePeriods(userId);
  const availableBalance = await balanceService.getAvailableBalance(userId);
  const existingActiveRequests = await getActiveRequests(userId);
  const fifoPeriods =
    country === "PE"
      ? (await balanceService.listActivePeriodsFifo(userId)).map((p) => ({
          ...p,
          available: balanceService.periodAvailable(p),
        }))
      : null;
  const primaryPeriod =
    country === "PE"
      ? fifoPeriods?.find((p) => p.available > 0.001) || null
      : null;

  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  const holidays =
    strategy.getDayUnit() === "business"
      ? await holidayService.getHolidaySet(country, start, end)
      : new Set();

  const result = strategy.validateRequest({
    user,
    request: { startDate: start, endDate: end },
    holidays,
    availableBalance,
    existingActiveRequests,
    referenceDate: toDateOnly(new Date()),
    config: vacationConfigForValidation(),
    allowPast,
    primaryPeriod,
    fifoPeriods,
    fractionAcknowledged,
  });

  if (!result.valid) {
    return { ok: false, errors: result.errors, warnings: result.warnings || [] };
  }

  const warnings = result.warnings || [];
  if (warnings.length > 0 && !policyWarningAck) {
    return {
      ok: false,
      errors: [
        "Debes confirmar que has leído la advertencia de política interna antes de continuar.",
      ],
      warnings,
      requiresPolicyAck: true,
    };
  }

  const isBusiness = strategy.getDayUnit() === "business";
  const businessDays = isBusiness ? result.days : null;
  const calendarDays = isBusiness ? null : result.days;
  const fractionAckAt =
    country === "PE" && result.requiresFractionAck && fractionAcknowledged
      ? new Date()
      : null;

  const { rows } = await db.query(
    `INSERT INTO vacation_requests
       (user_id, country_code, start_date, end_date, business_days, calendar_days,
        status, requester_notes, fraction_ack_at, policy_warning_ack)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      country,
      start,
      end,
      businessDays,
      calendarDays,
      VACATION_STATUS.PENDING,
      notes ? String(notes).trim() : null,
      fractionAckAt,
      Boolean(policyWarningAck),
    ],
  );

  return {
    ok: true,
    request: rows[0],
    days: result.days,
    warnings,
    accumulationAlert: (await balanceService.getBalanceSummary(userId)).accumulationAlert,
  };
}

/** Días que consume una solicitud según su país. */
function requestDays(request) {
  return request.country_code === "PE"
    ? Number(request.calendar_days || 0)
    : Number(request.business_days || 0);
}

/** Normaliza period_allocations (JSONB / string / null) a array. */
function parsePeriodAllocations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Aprueba una solicitud: consume saldo FIFO dentro de una transacción.
 */
async function approveRequest({ requestId, reviewerId, notes }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const { rows: lockRows } = await client.query(
      `SELECT * FROM vacation_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = lockRows[0];
    if (!request) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Solicitud no encontrada." };
    }
    if (request.status !== VACATION_STATUS.PENDING) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Solo se pueden aprobar solicitudes pendientes." };
    }

    const days = requestDays(request);
    const { firstPeriodId, allocations } = await balanceService.consumeDaysFifo(
      client,
      request.user_id,
      days,
      request.country_code,
    );

    const { rows: updated } = await client.query(
      `UPDATE vacation_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(),
           reviewer_notes = $3, vacation_period_id = COALESCE($4, vacation_period_id),
           period_allocations = $5::jsonb,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        VACATION_STATUS.APPROVED,
        reviewerId,
        notes ? String(notes).trim() : null,
        firstPeriodId,
        JSON.stringify(allocations || []),
        requestId,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, request: updated[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (/[Ss]aldo insuficiente/.test(err.message)) {
      return { ok: false, error: "Saldo insuficiente para aprobar la solicitud." };
    }
    throw err;
  } finally {
    client.release();
  }
}

async function rejectRequest({ requestId, reviewerId, reason }) {
  const request = await getRequestById(requestId);
  if (!request) return { ok: false, error: "Solicitud no encontrada." };
  if (request.status !== VACATION_STATUS.PENDING) {
    return { ok: false, error: "Solo se pueden rechazar solicitudes pendientes." };
  }
  if (!reason || !String(reason).trim()) {
    return { ok: false, error: "Debes indicar el motivo del rechazo." };
  }

  const { rows } = await db.query(
    `UPDATE vacation_requests
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(),
         reviewer_notes = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [VACATION_STATUS.REJECTED, reviewerId, String(reason).trim(), requestId],
  );
  return { ok: true, request: rows[0] };
}

async function cancelRequest({ requestId, userId, isAdmin = false }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const { rows: lockRows } = await client.query(
      `SELECT * FROM vacation_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = lockRows[0];
    if (!request) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Solicitud no encontrada." };
    }
    if (!isAdmin && String(request.user_id) !== String(userId)) {
      await client.query("ROLLBACK");
      return { ok: false, error: "No puedes cancelar solicitudes de otro colaborador." };
    }

    const today = toDateOnly(new Date());
    if (request.status === VACATION_STATUS.PENDING) {
      // Solo cambia estado.
    } else if (request.status === VACATION_STATUS.APPROVED) {
      if (toDateOnly(request.start_date) <= today) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: "No se puede cancelar una solicitud aprobada que ya comenzó.",
        };
      }
      const storedAllocations = parsePeriodAllocations(request.period_allocations);
      if (storedAllocations.length > 0) {
        await balanceService.releaseAllocations(
          client,
          storedAllocations,
          request.country_code,
        );
      } else {
        // Fallback: solicitudes aprobadas antes de period_allocations
        await balanceService.releaseDays(
          client,
          request.vacation_period_id,
          requestDays(request),
          request.country_code,
        );
      }
    } else {
      await client.query("ROLLBACK");
      return { ok: false, error: "Esta solicitud no se puede cancelar." };
    }

    const { rows } = await client.query(
      `UPDATE vacation_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [VACATION_STATUS.CANCELLED, requestId],
    );
    await client.query("COMMIT");
    return { ok: true, request: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Preview de validación sin persistir (API). */
async function previewRequest({
  userId,
  startDate,
  endDate,
  fractionAcknowledged = false,
}) {
  const user = await balanceService.getUserVacationProfile(userId);
  if (!user || !user.hire_date) {
    return { ok: false, error: "Perfil incompleto." };
  }

  const country = user.employment_country || "CL";
  const strategy = getStrategy(country);
  const availableBalance = await balanceService.getAvailableBalance(userId);
  const existingActiveRequests = await getActiveRequests(userId);
  const fifoPeriods =
    country === "PE"
      ? (await balanceService.listActivePeriodsFifo(userId)).map((p) => ({
          ...p,
          available: balanceService.periodAvailable(p),
        }))
      : null;
  const primaryPeriod =
    country === "PE"
      ? fifoPeriods?.find((p) => p.available > 0.001) || null
      : null;

  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  const holidays =
    strategy.getDayUnit() === "business"
      ? await holidayService.getHolidaySet(country, start, end)
      : new Set();

  const result = strategy.validateRequest({
    user,
    request: { startDate: start, endDate: end },
    holidays,
    availableBalance,
    existingActiveRequests,
    referenceDate: toDateOnly(new Date()),
    config: vacationConfigForValidation(),
    primaryPeriod,
    fifoPeriods,
    fractionAcknowledged,
  });

  return {
    ok: result.valid,
    days: result.days,
    errors: result.errors,
    warnings: result.warnings || [],
    requiresFractionAck: Boolean(result.requiresFractionAck),
    unit: strategy.getDayUnit(),
    unitLabel:
      strategy.getDayUnit() === "business" ? "días hábiles" : "días calendario",
  };
}

async function listForUser(userId) {
  const { rows } = await db.query(
    `SELECT r.*, rv.first_name AS reviewer_first_name, rv.last_name AS reviewer_last_name
     FROM vacation_requests r
     LEFT JOIN users rv ON rv.id = r.reviewed_by
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId],
  );
  return rows;
}

async function listForAdmin({ country, workAreaId, status } = {}) {
  const conditions = [];
  const params = [];

  if (country) {
    params.push(country);
    conditions.push(`r.country_code = $${params.length}`);
  }
  if (workAreaId) {
    params.push(workAreaId);
    conditions.push(`u.work_area_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await db.query(
    `SELECT r.*, u.first_name, u.last_name, u.email, u.work_area_id,
            wa.area_name AS area
     FROM vacation_requests r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN work_areas wa ON wa.id = u.work_area_id
     ${where}
     ORDER BY
       CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
       r.start_date ASC`,
    params,
  );
  return rows;
}

async function listApprovedInRange({ startDate, endDate, userId } = {}) {
  const params = [
    toDateOnly(startDate),
    toDateOnly(endDate),
    [VACATION_STATUS.APPROVED, VACATION_STATUS.IN_PROGRESS, VACATION_STATUS.COMPLETED],
  ];
  let sql = `SELECT r.*, u.first_name, u.last_name
             FROM vacation_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.status = ANY($3)
               AND r.start_date <= $2 AND r.end_date >= $1`;
  if (userId) {
    params.push(userId);
    sql += ` AND r.user_id = $4`;
  }
  sql += ` ORDER BY r.start_date ASC`;
  const { rows } = await db.query(sql, params);
  return rows;
}

async function runDailyStatusTransitions() {
  const today = toDateOnly(new Date());
  const toProgress = await db.query(
    `UPDATE vacation_requests SET status = 'in_progress', updated_at = NOW()
     WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
    [today],
  );
  const toCompleted = await db.query(
    `UPDATE vacation_requests SET status = 'completed', updated_at = NOW()
     WHERE status IN ('approved','in_progress') AND end_date < $1`,
    [today],
  );
  return {
    inProgress: toProgress.rowCount || 0,
    completed: toCompleted.rowCount || 0,
  };
}

module.exports = {
  getRequestById,
  getActiveRequests,
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  previewRequest,
  listForUser,
  listForAdmin,
  listApprovedInRange,
  runDailyStatusTransitions,
  requestDays,
};
