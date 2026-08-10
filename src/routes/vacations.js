const express = require("express");
const router = express.Router();
const db = require("../db");
const requireRole = require("../middlewares/requireRole");
const { getStrategy, isSupportedCountry } = require("../services/vacations/VacationEngine");
const balanceService = require("../services/vacations/vacationBalanceService");
const requestService = require("../services/vacations/vacationRequestService");
const holidayService = require("../services/vacations/holidayService");
const notificationService = require("../services/vacations/vacationNotificationService");
const {
  mapVacationRequestForView,
  mapVacationPeriodForView,
} = require("../utils/schemaMappers");
const {
  COUNTRY_LABELS,
  countryLabel,
  countryFlag,
} = require("../constants/vacationStatuses");
const { toDateOnly, addDays } = require("../utils/vacationDateUtils");

// ---------- helpers de redirect con flash ----------
function redirectOk(res, path, msg) {
  return res.redirect(`${path}?ok=1&msg=${encodeURIComponent(msg)}`);
}
function redirectErr(res, path, msg) {
  return res.redirect(`${path}?error=${encodeURIComponent(msg)}`);
}
function readFlash(req) {
  return {
    success: req.query.ok === "1" ? decodeURIComponent(req.query.msg || "Operación exitosa") : null,
    error: req.query.error ? decodeURIComponent(req.query.error) : null,
  };
}

async function logChange(req, action, linkPath) {
  if (!req.session.user || !req.session.user.id) return;
  try {
    await db.query(
      "INSERT INTO change_log (user_id, action, section, link_path) VALUES ($1, $2, $3, $4)",
      [req.session.user.id, action, "Vacaciones", linkPath],
    );
  } catch (err) {
    console.error("[Vacaciones] Error en change_log:", err.message);
  }
}

async function getAreas() {
  const { rows } = await db.query(
    "SELECT id, area_name FROM work_areas ORDER BY area_name ASC",
  );
  return rows;
}

// ==========================================================
// INDEX
// ==========================================================
router.get("/", requireRole.intranetActivo(), (req, res) => {
  res.render("RRHH/vacaciones/index", {
    titulo: "Vacaciones",
    user: req.session.user,
    ...readFlash(req),
  });
});

// ==========================================================
// MIS VACACIONES
// ==========================================================
router.get("/mis-vacaciones", requireRole.intranetActivo(), async (req, res) => {
  const userId = req.session.user.id;
  try {
    const profile = await balanceService.getUserVacationProfile(userId);
    if (profile && profile.hire_date) {
      await balanceService.recalculatePeriods(userId);
    }

    const [summary, periods, requests] = await Promise.all([
      balanceService.getBalanceSummary(userId),
      balanceService.listPeriods(userId),
      requestService.listForUser(userId),
    ]);

    const country = profile?.employment_country || "CL";
    const strategy = isSupportedCountry(country) ? getStrategy(country) : getStrategy("CL");

    res.render("RRHH/vacaciones/mis_vacaciones", {
      titulo: "Mis vacaciones",
      user: req.session.user,
      profile,
      summary,
      periods: periods.map(mapVacationPeriodForView),
      requests: requests.map(mapVacationRequestForView),
      country,
      countryLabel: countryLabel(country),
      countryFlag: countryFlag(country),
      dayUnit: strategy.getDayUnit(),
      dayUnitLabel: strategy.getDayUnit() === "business" ? "días hábiles" : "días calendario",
      hasHireDate: Boolean(profile?.hire_date),
      ...readFlash(req),
    });
  } catch (err) {
    console.error("Error en mis-vacaciones:", err);
    res.status(500).send("Error cargando tus vacaciones");
  }
});

router.post("/mis-vacaciones/solicitar", requireRole.intranetActivo(), async (req, res) => {
  const userId = req.session.user.id;
  const {
    start_date,
    end_date,
    notes,
    fraction_ack,
    policy_warning_ack,
  } = req.body;
  try {
    const result = await requestService.createRequest({
      userId,
      startDate: start_date,
      endDate: end_date,
      notes,
      fractionAcknowledged: fraction_ack === "on" || fraction_ack === "1",
      policyWarningAck: policy_warning_ack === "on" || policy_warning_ack === "1",
    });

    if (!result.ok) {
      return redirectErr(res, "/RRHH/vacaciones/mis-vacaciones", result.errors.join(" "));
    }

    const profile = await balanceService.getUserVacationProfile(userId);
    notificationService.notifyNewRequest({
      request: result.request,
      user: profile,
      accumulationAlert: Boolean(result.accumulationAlert),
    });

    return redirectOk(
      res,
      "/RRHH/vacaciones/mis-vacaciones",
      "Solicitud enviada correctamente. Queda pendiente de aprobación.",
    );
  } catch (err) {
    console.error("Error creando solicitud:", err);
    return redirectErr(res, "/RRHH/vacaciones/mis-vacaciones", "Error al enviar la solicitud.");
  }
});

router.post("/mis-vacaciones/cancelar/:id", requireRole.intranetActivo(), async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await requestService.cancelRequest({
      requestId: req.params.id,
      userId,
    });
    if (!result.ok) {
      return redirectErr(res, "/RRHH/vacaciones/mis-vacaciones", result.error);
    }
    return redirectOk(res, "/RRHH/vacaciones/mis-vacaciones", "Solicitud cancelada.");
  } catch (err) {
    console.error("Error cancelando solicitud:", err);
    return redirectErr(res, "/RRHH/vacaciones/mis-vacaciones", "Error al cancelar la solicitud.");
  }
});

// ==========================================================
// GESTIÓN (ADMIN)
// ==========================================================
router.get("/gestion", requireRole.administrador(), async (req, res) => {
  try {
    const { country, area, status } = req.query;
    const [requests, areas] = await Promise.all([
      requestService.listForAdmin({
        country: country || null,
        workAreaId: area || null,
        status: status || null,
      }),
      getAreas(),
    ]);

    res.render("RRHH/vacaciones/gestion", {
      titulo: "Gestión de vacaciones",
      user: req.session.user,
      requests: requests.map(mapVacationRequestForView),
      areas,
      filtros: { country: country || "", area: area || "", status: status || "" },
      countryLabels: COUNTRY_LABELS,
      ...readFlash(req),
    });
  } catch (err) {
    console.error("Error en gestión vacaciones:", err);
    res.status(500).send("Error cargando la gestión de vacaciones");
  }
});

router.get("/gestion/:userId", requireRole.administrador(), async (req, res) => {
  const { userId } = req.params;
  try {
    const profile = await balanceService.getUserVacationProfile(userId);
    if (!profile) return res.status(404).send("Colaborador no encontrado");
    if (profile.hire_date) await balanceService.recalculatePeriods(userId);

    const [summary, periods, requests] = await Promise.all([
      balanceService.getBalanceSummary(userId),
      balanceService.listPeriods(userId),
      requestService.listForUser(userId),
    ]);

    res.render("RRHH/vacaciones/detalle_colaborador", {
      titulo: "Detalle de vacaciones",
      user: req.session.user,
      profile,
      summary,
      periods: periods.map(mapVacationPeriodForView),
      requests: requests.map(mapVacationRequestForView),
      countryLabel: countryLabel(profile.employment_country || "CL"),
      countryFlag: countryFlag(profile.employment_country || "CL"),
      ...readFlash(req),
    });
  } catch (err) {
    console.error("Error en detalle colaborador:", err);
    res.status(500).send("Error cargando el detalle del colaborador");
  }
});

router.post("/gestion/:userId/ajustar", requireRole.administrador(), async (req, res) => {
  const { userId } = req.params;
  const { period_id, days_delta, reason } = req.body;
  const backTo = `/RRHH/vacaciones/gestion/${encodeURIComponent(userId)}`;
  try {
    const delta = Number(days_delta);
    if (!period_id || !Number.isFinite(delta) || delta === 0) {
      return redirectErr(res, backTo, "Indica un período y una cantidad de días distinta de cero.");
    }
    if (!reason || !String(reason).trim()) {
      return redirectErr(res, backTo, "Debes indicar el motivo del ajuste.");
    }

    await balanceService.applyAdjustment({
      periodId: period_id,
      adjustedBy: req.session.user.id,
      daysDelta: delta,
      reason,
    });
    await logChange(req, "ajustó saldo de vacaciones", backTo);

    return redirectOk(res, backTo, "Saldo ajustado correctamente.");
  } catch (err) {
    console.error("Error ajustando saldo:", err);
    return redirectErr(res, backTo, "Error al ajustar el saldo.");
  }
});

router.post("/gestion/:userId/periodo/:periodId/record", requireRole.administrador(), async (req, res) => {
  const { userId, periodId } = req.params;
  const { record_met, record_notes } = req.body;
  const backTo = `/RRHH/vacaciones/gestion/${encodeURIComponent(userId)}`;
  try {
    const met = record_met === "on" || record_met === "1" || record_met === "true";
    if (!met && (!record_notes || !String(record_notes).trim())) {
      return redirectErr(res, backTo, "Indica el motivo cuando el récord no se cumple.");
    }
    await balanceService.updatePeriodRecord({
      periodId,
      recordMet: met,
      validatedBy: req.session.user.id,
      notes: record_notes,
    });
    await logChange(req, "actualizó récord vacacional", backTo);
    return redirectOk(res, backTo, "Récord vacacional actualizado.");
  } catch (err) {
    console.error("Error actualizando récord:", err);
    return redirectErr(res, backTo, "Error al actualizar el récord vacacional.");
  }
});

router.post("/gestion/solicitud/:id/aprobar", requireRole.administrador(), async (req, res) => {
  const backTo = "/RRHH/vacaciones/gestion";
  try {
    const result = await requestService.approveRequest({
      requestId: req.params.id,
      reviewerId: req.session.user.id,
      notes: req.body.notes,
    });
    if (!result.ok) return redirectErr(res, backTo, result.error);

    const profile = await balanceService.getUserVacationProfile(result.request.user_id);
    notificationService.notifyApproved({ request: result.request, user: profile });
    await logChange(req, "aprobó una solicitud de vacaciones", backTo);

    return redirectOk(res, backTo, "Solicitud aprobada.");
  } catch (err) {
    console.error("Error aprobando solicitud:", err);
    return redirectErr(res, backTo, "Error al aprobar la solicitud.");
  }
});

router.post("/gestion/solicitud/:id/rechazar", requireRole.administrador(), async (req, res) => {
  const backTo = "/RRHH/vacaciones/gestion";
  try {
    const result = await requestService.rejectRequest({
      requestId: req.params.id,
      reviewerId: req.session.user.id,
      reason: req.body.reason,
    });
    if (!result.ok) return redirectErr(res, backTo, result.error);

    const profile = await balanceService.getUserVacationProfile(result.request.user_id);
    notificationService.notifyRejected({ request: result.request, user: profile });
    await logChange(req, "rechazó una solicitud de vacaciones", backTo);

    return redirectOk(res, backTo, "Solicitud rechazada.");
  } catch (err) {
    console.error("Error rechazando solicitud:", err);
    return redirectErr(res, backTo, "Error al rechazar la solicitud.");
  }
});

// ==========================================================
// CALENDARIO
// ==========================================================
router.get("/calendario", requireRole.intranetActivo(), async (req, res) => {
  try {
    const isAdmin = Boolean(res.locals.isAdministrador);
    const today = toDateOnly(new Date());
    const start = req.query.from ? toDateOnly(req.query.from) : addDays(today, -30);
    const end = req.query.to ? toDateOnly(req.query.to) : addDays(today, 90);

    const events = await requestService.listApprovedInRange({
      startDate: start,
      endDate: end,
      userId: isAdmin ? null : req.session.user.id,
    });

    res.render("RRHH/vacaciones/calendario", {
      titulo: "Calendario de vacaciones",
      user: req.session.user,
      isAdmin,
      events: events.map(mapVacationRequestForView),
      range: { from: start, to: end },
      ...readFlash(req),
    });
  } catch (err) {
    console.error("Error en calendario:", err);
    res.status(500).send("Error cargando el calendario");
  }
});

// ==========================================================
// FERIADOS (ADMIN)
// ==========================================================
router.get("/feriados", requireRole.administrador(), async (req, res) => {
  try {
    const [cl, pe] = await Promise.all([
      holidayService.listHolidays("CL"),
      holidayService.listHolidays("PE"),
    ]);
    res.render("RRHH/vacaciones/feriados", {
      titulo: "Feriados",
      user: req.session.user,
      holidaysCL: cl,
      holidaysPE: pe,
      ...readFlash(req),
    });
  } catch (err) {
    console.error("Error cargando feriados:", err);
    res.status(500).send("Error cargando feriados");
  }
});

router.post("/feriados", requireRole.administrador(), async (req, res) => {
  const { country_code, holiday_date, name, is_recurring } = req.body;
  try {
    if (!["CL", "PE"].includes(country_code)) {
      return redirectErr(res, "/RRHH/vacaciones/feriados", "País inválido.");
    }
    await holidayService.createHoliday({
      countryCode: country_code,
      holidayDate: holiday_date,
      name,
      isRecurring: is_recurring === "on" || is_recurring === "1",
    });
    await logChange(req, "agregó un feriado", "/RRHH/vacaciones/feriados");
    return redirectOk(res, "/RRHH/vacaciones/feriados", "Feriado agregado.");
  } catch (err) {
    console.error("Error creando feriado:", err);
    return redirectErr(res, "/RRHH/vacaciones/feriados", err.message || "Error al agregar feriado.");
  }
});

router.post("/feriados/:id/eliminar", requireRole.administrador(), async (req, res) => {
  try {
    await holidayService.deleteHoliday(req.params.id);
    await logChange(req, "eliminó un feriado", "/RRHH/vacaciones/feriados");
    return redirectOk(res, "/RRHH/vacaciones/feriados", "Feriado eliminado.");
  } catch (err) {
    console.error("Error eliminando feriado:", err);
    return redirectErr(res, "/RRHH/vacaciones/feriados", "Error al eliminar feriado.");
  }
});

// ==========================================================
// API JSON
// ==========================================================
router.get("/api/saldo", requireRole.intranetActivo(), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const summary = await balanceService.getBalanceSummary(userId);
    res.json(summary);
  } catch (err) {
    console.error("Error api saldo:", err);
    res.status(500).json({ error: "Error obteniendo saldo" });
  }
});

router.get("/api/preview-dias", requireRole.intranetActivo(), async (req, res) => {
  try {
    const { start_date, end_date, fraction_ack } = req.query;
    const start = toDateOnly(start_date);
    const end = toDateOnly(end_date);
    if (!start || !end) {
      return res.status(400).json({ error: "Fechas inválidas" });
    }

    const preview = await requestService.previewRequest({
      userId: req.session.user.id,
      startDate: start,
      endDate: end,
      fractionAcknowledged: fraction_ack === "1" || fraction_ack === "true",
    });

    if (preview.error) {
      return res.status(400).json({ error: preview.error });
    }

    res.json(preview);
  } catch (err) {
    console.error("Error api preview-dias:", err);
    res.status(500).json({ error: "Error calculando días" });
  }
});

module.exports = router;
