const BaseVacationStrategy = require("./BaseVacationStrategy");
const {
  countBusinessDays,
  fullYearsBetween,
  fullMonthsBetween,
  addDays,
  toDateOnly,
  rangesOverlap,
} = require("../../../utils/vacationDateUtils");

const BASE_ENTITLEMENT = 15; // días hábiles tras 1 año
const MONTHLY_ACCRUAL = 1.25; // días hábiles/mes (informativo)
const MAX_PRIOR_YEARS_CREDITED = 10; // art. 68 CT — tope de acreditación previa

/**
 * Reglas de Chile — Código del Trabajo arts. 67–73.
 * Unidad: días hábiles (lun–vie, excluye feriados CL).
 * El feriado anual no caduca (art. 5, 70 CT); acumulación hasta 2 períodos.
 */
class ChileVacationStrategy extends BaseVacationStrategy {
  getCountryCode() {
    return "CL";
  }

  getDayUnit() {
    return "business";
  }

  /**
   * Feriado progresivo art. 68 CT: +1 día por cada 3 años tras cumplir 10.
   * @param {number} totalYears — antigüedad total (empresa + previos acreditados)
   */
  getProgressiveDays(totalYears) {
    if (totalYears < 10) return 0;
    return Math.floor((totalYears - 10) / 3);
  }

  /** Total de años para progresivo: años en empresa + previos acreditados (tope 10). */
  resolveTotalYears({ yearsOfService = 0, priorYearsCredited = 0 } = {}) {
    const prior = Math.min(
      MAX_PRIOR_YEARS_CREDITED,
      Math.max(0, Number(priorYearsCredited) || 0),
    );
    return Math.max(0, Number(yearsOfService) || 0) + prior;
  }

  getAnnualEntitlement({
    yearsOfService = 0,
    priorYearsCredited = 0,
    progressiveOverride = null,
  } = {}) {
    if (
      progressiveOverride != null &&
      Number.isFinite(Number(progressiveOverride))
    ) {
      return BASE_ENTITLEMENT + Number(progressiveOverride);
    }
    const totalYears = this.resolveTotalYears({
      yearsOfService,
      priorYearsCredited,
    });
    return BASE_ENTITLEMENT + this.getProgressiveDays(totalYears);
  }

  isEligible({ hireDate, referenceDate }) {
    if (!hireDate) return false;
    return fullYearsBetween(hireDate, referenceDate) >= 1;
  }

  /** Proporcional: 1,25 hábiles por mes completo trabajado. */
  getProportionalDays({ hireDate, referenceDate }) {
    if (!hireDate) return 0;
    const months = fullMonthsBetween(hireDate, referenceDate);
    return Math.round(months * MONTHLY_ACCRUAL * 100) / 100;
  }

  countRequestDays({ startDate, endDate, holidays }) {
    return countBusinessDays(startDate, endDate, holidays);
  }

  /** Chile: el feriado anual no caduca. */
  getExpirationDate(/* { periodEnd } */) {
    return null;
  }

  validateRequest({
    request,
    holidays,
    availableBalance = 0,
    existingActiveRequests = [],
    referenceDate,
    config = {},
    allowPast = false,
  }) {
    const errors = [];
    const warnings = [];
    const today = toDateOnly(referenceDate) || toDateOnly(new Date());
    const start = toDateOnly(request.startDate);
    const end = toDateOnly(request.endDate);
    const days = this.countRequestDays({
      startDate: start,
      endDate: end,
      holidays,
    });

    if (!start || !end) {
      errors.push("Fechas de inicio y término inválidas.");
      return { valid: false, errors, warnings, days: 0 };
    }
    if (end < start) {
      errors.push("La fecha de término no puede ser anterior al inicio.");
    }
    if (days <= 0) {
      errors.push(
        "El rango seleccionado no contiene días hábiles (sábados, domingos y feriados no cuentan).",
      );
    }
    if (!allowPast && start < today) {
      errors.push("No puedes solicitar vacaciones en fechas pasadas.");
    }

    const minNotice = Number(config.minNoticeDaysCL ?? 15);
    if (!allowPast && start >= today) {
      const noticeDays = countBusinessDays(addDays(today, 1), start, holidays);
      if (noticeDays < minNotice) {
        errors.push(
          `Debes solicitar con al menos ${minNotice} días hábiles de anticipación.`,
        );
      }
    }

    if (days > availableBalance + 0.001) {
      errors.push(
        `Saldo insuficiente: solicitas ${days} día(s) hábil(es) y tienes ${availableBalance} disponible(s).`,
      );
    }

    const overlaps = existingActiveRequests.some((r) =>
      rangesOverlap(start, end, r.start_date, r.end_date),
    );
    if (overlaps) {
      errors.push(
        "El rango se solapa con otra solicitud pendiente, aprobada o en curso.",
      );
    }

    const minLong = Number(config.minLongFractionCL ?? 10);
    const hasLongSegment =
      days >= minLong ||
      existingActiveRequests.some((r) => Number(r.business_days) >= minLong);
    const consumesAll = days >= availableBalance - 0.001;
    if (days < minLong && !hasLongSegment && !consumesAll) {
      errors.push(
        `Fraccionamiento inválido: al menos un tramo del período debe ser de ${minLong} días hábiles consecutivos.`,
      );
    }

    return { valid: errors.length === 0, errors, warnings, days };
  }
}

module.exports = ChileVacationStrategy;
