const db = require("../../db");
const { getStrategy, resolveCountryForUser } = require("./VacationEngine");
const { VACATION_CONFIG } = require("../../constants/vacationConfig");
const {
  toDateOnly,
  addDays,
  fullYearsBetween,
  todayInCountry,
} = require("../../utils/vacationDateUtils");

/**
 * Gestión de períodos de devengo y saldos.
 *
 * Modelo: un período por año laboral (aniversario de hire_date). Los años ya
 * cumplidos otorgan el derecho completo; el año en curso devenga proporcional.
 * Saldo de un período = entitled_days + adjusted_days - used_days (si record_met).
 */

function effectiveEntitled(period) {
  if (period.record_met === false) return 0;
  return Number(period.entitled_days);
}

function periodAvailable(period) {
  return (
    effectiveEntitled(period) +
    Number(period.adjusted_days) -
    Number(period.used_days)
  );
}

/** Suma el aniversario (años) a una fecha date-only. */
function addYears(value, years) {
  const date = toDateOnly(value);
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const target = `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return toDateOnly(target) || target;
}

async function getUserVacationProfile(userId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, employment_country, hire_date,
            manager_user_id, prior_years_credited, progressive_days_override,
            work_days_per_week
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Regenera/actualiza los períodos de un colaborador según su hire_date y país.
 * Idempotente: no duplica (UNIQUE user_id, period_start) y no pisa used/adjusted.
 */
async function recalculatePeriods(userId) {
  const user = await getUserVacationProfile(userId);
  if (!user || !user.hire_date || !user.employment_country) return;

  const country = resolveCountryForUser(user);
  const strategy = getStrategy(country);
  const hire = toDateOnly(user.hire_date);
  const today = todayInCountry();
  const yearsComplete = fullYearsBetween(hire, today);
  const priorYears = Number(user.prior_years_credited) || 0;
  const progressiveOverride =
    user.progressive_days_override != null
      ? Number(user.progressive_days_override)
      : null;

  for (let k = 1; k <= yearsComplete; k += 1) {
    const periodStart = addYears(hire, k - 1);
    const periodEnd = addDays(addYears(hire, k), -1);
    const entitled = strategy.getAnnualEntitlement({
      yearsOfService: k,
      priorYearsCredited: priorYears,
      progressiveOverride,
    });
    const expires = strategy.getExpirationDate({ periodEnd });
    await upsertPeriod({
      userId,
      country,
      periodStart,
      periodEnd,
      entitledDays: entitled,
      expiresAt: expires,
    });
  }

  const currentStart = addYears(hire, yearsComplete);
  const currentEnd = addDays(addYears(hire, yearsComplete + 1), -1);
  const proportional = strategy.getProportionalDays({
    hireDate: currentStart,
    referenceDate: today,
  });
  await upsertPeriod({
    userId,
    country,
    periodStart: currentStart,
    periodEnd: currentEnd,
    entitledDays: proportional,
    expiresAt: strategy.getExpirationDate({ periodEnd: currentEnd }),
    onlyRaiseEntitled: true,
  });

  // CL: limpiar expires_at obsoleto en períodos existentes
  if (country === "CL") {
    await db.query(
      `UPDATE vacation_periods SET expires_at = NULL, updated_at = NOW()
       WHERE user_id = $1 AND country_code = 'CL' AND expires_at IS NOT NULL`,
      [userId],
    );
  }
}

async function upsertPeriod({
  userId,
  country,
  periodStart,
  periodEnd,
  entitledDays,
  expiresAt,
  onlyRaiseEntitled = false,
}) {
  const entitledClause = onlyRaiseEntitled
    ? "GREATEST(vacation_periods.entitled_days, EXCLUDED.entitled_days)"
    : "EXCLUDED.entitled_days";

  await db.query(
    `INSERT INTO vacation_periods
       (user_id, country_code, period_start, period_end, entitled_days, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, period_start) DO UPDATE SET
       country_code = EXCLUDED.country_code,
       period_end   = EXCLUDED.period_end,
       entitled_days = ${entitledClause},
       expires_at   = EXCLUDED.expires_at,
       updated_at   = NOW()`,
    [userId, country, periodStart, periodEnd, entitledDays, expiresAt],
  );
}

/** Lista períodos de un usuario (más reciente primero). */
async function listPeriods(userId) {
  const { rows } = await db.query(
    `SELECT * FROM vacation_periods WHERE user_id = $1 ORDER BY period_start DESC`,
    [userId],
  );
  return rows;
}

/** Períodos vigentes (no vencidos), ordenados FIFO (más antiguo primero). */
async function listActivePeriodsFifo(userId, client = db) {
  const today = todayInCountry();
  const { rows } = await client.query(
    `SELECT * FROM vacation_periods
     WHERE user_id = $1
       AND (
         country_code = 'CL'
         OR expires_at IS NULL
         OR expires_at >= $2
       )
     ORDER BY period_start ASC`,
    [userId, today],
  );
  return rows;
}

/** Primer período FIFO con saldo disponible (para validación PE). */
async function getPrimaryPeriodForRequest(userId) {
  const periods = await listActivePeriodsFifo(userId);
  return periods.find((p) => periodAvailable(p) > 0.001) || null;
}

/** Saldo disponible total (suma de períodos vigentes). */
async function getAvailableBalance(userId) {
  const periods = await listActivePeriodsFifo(userId);
  return periods.reduce((sum, p) => sum + periodAvailable(p), 0);
}

/**
 * Detecta acumulación de períodos sin gozar (Chile art. 70).
 * @returns {{ alert: boolean, periodsWithBalance: number, message: string|null }}
 */
function detectAccumulationAlert(periods, country) {
  if (country !== "CL") {
    return { alert: false, periodsWithBalance: 0, message: null };
  }
  const maxPeriods = VACATION_CONFIG.maxAccumulatedPeriodsCL;
  const withBalance = periods.filter((p) => periodAvailable(p) > 0.001);
  if (withBalance.length >= maxPeriods) {
    return {
      alert: true,
      periodsWithBalance: withBalance.length,
      message: `Tienes ${withBalance.length} período(s) con saldo sin gozar. La ley permite acumular hasta ${maxPeriods} períodos consecutivos; RR.HH. y tu jefatura han sido notificados.`,
    };
  }
  return { alert: false, periodsWithBalance: withBalance.length, message: null };
}

/** Resumen de saldos para la UI. */
async function getBalanceSummary(userId) {
  const user = await getUserVacationProfile(userId);
  const country = resolveCountryForUser(user);
  const periods = await listPeriods(userId);
  const today = todayInCountry();
  let entitled = 0;
  let used = 0;
  let adjusted = 0;
  let available = 0;
  let expiringSoon = 0;

  for (const p of periods) {
    const isActive =
      country === "CL" ||
      !p.expires_at ||
      toDateOnly(p.expires_at) >= today;
    entitled += effectiveEntitled(p);
    used += Number(p.used_days);
    adjusted += Number(p.adjusted_days);
    if (isActive) {
      available += periodAvailable(p);
      if (country === "PE" && p.expires_at) {
        const limit = addDays(today, 90);
        if (toDateOnly(p.expires_at) <= limit) {
          expiringSoon += periodAvailable(p);
        }
      }
    }
  }

  const accumulation = detectAccumulationAlert(periods, country);

  return {
    entitled: round2(entitled),
    used: round2(used),
    adjusted: round2(adjusted),
    available: round2(available),
    expiringSoon: round2(expiringSoon),
    periodsCount: periods.length,
    activePeriodsCount: periods.filter(
      (p) =>
        country === "CL" ||
        !p.expires_at ||
        toDateOnly(p.expires_at) >= today,
    ).length,
    accumulationAlert: accumulation.alert,
    accumulationMessage: accumulation.message,
    periodsWithBalance: accumulation.periodsWithBalance,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Consume días de los períodos vigentes en orden FIFO (más antiguo primero).
 * Para PE actualiza contadores de bloques protegido/flexible.
 * @returns {{ firstPeriodId: number|null, allocations: Array<{periodId,days,protectedDelta,flexibleDelta}> }}
 */
async function consumeDaysFifo(client, userId, days, countryCode) {
  let remaining = Number(days);
  let firstPeriodId = null;
  const allocations = [];
  const strategy =
    countryCode === "PE" ? getStrategy("PE") : null;

  const today = todayInCountry();
  const { rows: periods } = await client.query(
    `SELECT * FROM vacation_periods
     WHERE user_id = $1
       AND (
         country_code = 'CL'
         OR expires_at IS NULL
         OR expires_at >= $2
       )
     ORDER BY period_start ASC
     FOR UPDATE`,
    [userId, today],
  );

  for (const p of periods) {
    if (remaining <= 0.001) break;
    const avail = periodAvailable(p);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);

    let protectedDelta = 0;
    let flexibleDelta = 0;

    if (strategy && p.country_code === "PE") {
      ({ protectedDelta, flexibleDelta } = strategy.allocateBlockDays(p, take));
      await client.query(
        `UPDATE vacation_periods
         SET used_days = used_days + $1,
             protected_block_days_used = protected_block_days_used + $2,
             flexible_block_days_used = flexible_block_days_used + $3,
             updated_at = NOW()
         WHERE id = $4`,
        [take, protectedDelta, flexibleDelta, p.id],
      );
      // Mantener estado en memoria para siguientes slices del mismo período
      p.used_days = Number(p.used_days) + take;
      p.protected_block_days_used =
        Number(p.protected_block_days_used || 0) + protectedDelta;
      p.flexible_block_days_used =
        Number(p.flexible_block_days_used || 0) + flexibleDelta;
    } else {
      await client.query(
        `UPDATE vacation_periods SET used_days = used_days + $1, updated_at = NOW() WHERE id = $2`,
        [take, p.id],
      );
      p.used_days = Number(p.used_days) + take;
    }

    if (firstPeriodId === null) firstPeriodId = p.id;
    allocations.push({
      periodId: p.id,
      days: take,
      protectedDelta,
      flexibleDelta,
    });
    remaining -= take;
  }

  if (remaining > 0.001) {
    throw new Error("Saldo insuficiente al consumir días de vacaciones.");
  }
  return { firstPeriodId, allocations };
}

/**
 * Revierte imputaciones exactas de una aprobación (multi-período).
 * Preferir esto sobre releaseDays cuando existan period_allocations.
 */
async function releaseAllocations(client, allocations, countryCode) {
  if (!Array.isArray(allocations) || allocations.length === 0) return;

  for (const alloc of allocations) {
    const periodId = alloc.periodId ?? alloc.period_id;
    const take = Number(alloc.days || 0);
    if (!periodId || take <= 0) continue;

    if (countryCode === "PE") {
      const protRelease = Number(alloc.protectedDelta ?? alloc.protected_delta ?? 0);
      const flexRelease = Number(alloc.flexibleDelta ?? alloc.flexible_delta ?? 0);
      await client.query(
        `UPDATE vacation_periods
         SET used_days = GREATEST(0, used_days - $1),
             protected_block_days_used = GREATEST(0, protected_block_days_used - $2),
             flexible_block_days_used = GREATEST(0, flexible_block_days_used - $3),
             updated_at = NOW()
         WHERE id = $4`,
        [take, protRelease, flexRelease, periodId],
      );
    } else {
      await client.query(
        `UPDATE vacation_periods
         SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
         WHERE id = $2`,
        [take, periodId],
      );
    }
  }
}

/**
 * Libera días de un único período (fallback para solicitudes sin period_allocations).
 * Heurística PE: revierte flexible primero (espejo de tramos 1–6 art. 17.ii).
 */
async function releaseDays(client, periodId, days, countryCode) {
  if (!periodId) return;
  const take = Number(days);

  if (countryCode === "PE") {
    const { rows } = await client.query(
      `SELECT * FROM vacation_periods WHERE id = $1 FOR UPDATE`,
      [periodId],
    );
    const period = rows[0];
    if (!period) return;

    let flexRelease = Math.min(Number(period.flexible_block_days_used), take);
    let protRelease = take - flexRelease;
    if (protRelease > Number(period.protected_block_days_used)) {
      protRelease = Number(period.protected_block_days_used);
      flexRelease = take - protRelease;
    }

    await client.query(
      `UPDATE vacation_periods
       SET used_days = GREATEST(0, used_days - $1),
           protected_block_days_used = GREATEST(0, protected_block_days_used - $2),
           flexible_block_days_used = GREATEST(0, flexible_block_days_used - $3),
           updated_at = NOW()
       WHERE id = $4`,
      [take, protRelease, flexRelease, periodId],
    );
    return;
  }

  await client.query(
    `UPDATE vacation_periods
     SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
     WHERE id = $2`,
    [take, periodId],
  );
}

/** Aplica un ajuste manual de saldo + auditoría. */
async function applyAdjustment({ periodId, adjustedBy, daysDelta, reason }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE vacation_periods
       SET adjusted_days = adjusted_days + $1, updated_at = NOW()
       WHERE id = $2`,
      [Number(daysDelta), periodId],
    );
    await client.query(
      `INSERT INTO vacation_balance_adjustments
         (vacation_period_id, adjusted_by, days_delta, reason)
       VALUES ($1, $2, $3, $4)`,
      [periodId, adjustedBy, Number(daysDelta), String(reason).trim()],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Marca récord vacacional de un período (T-05). */
async function updatePeriodRecord({
  periodId,
  recordMet,
  validatedBy,
  notes,
}) {
  await db.query(
    `UPDATE vacation_periods
     SET record_met = $1,
         record_validated_by = $2,
         record_notes = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [Boolean(recordMet), validatedBy || null, notes ? String(notes).trim() : null, periodId],
  );
}

module.exports = {
  effectiveEntitled,
  periodAvailable,
  getUserVacationProfile,
  recalculatePeriods,
  listPeriods,
  listActivePeriodsFifo,
  getPrimaryPeriodForRequest,
  getAvailableBalance,
  detectAccumulationAlert,
  getBalanceSummary,
  consumeDaysFifo,
  releaseAllocations,
  releaseDays,
  applyAdjustment,
  updatePeriodRecord,
};
