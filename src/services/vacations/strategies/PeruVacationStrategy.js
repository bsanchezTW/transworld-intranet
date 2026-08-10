const BaseVacationStrategy = require("./BaseVacationStrategy");
const {
  countCalendarDays,
  fullYearsBetween,
  fullMonthsBetween,
  addDays,
  toDateOnly,
  rangesOverlap,
} = require("../../../utils/vacationDateUtils");

const ANNUAL_ENTITLEMENT = 30; // días calendario por año completo
const PROTECTED_BLOCK_SIZE = 15;
const FLEXIBLE_BLOCK_SIZE = 15;

/**
 * Reglas de Perú — D.L. 713 / D.L. 1188 (régimen general).
 * Unidad: días calendario (incluye fines de semana y feriados).
 */
class PeruVacationStrategy extends BaseVacationStrategy {
  getCountryCode() {
    return "PE";
  }

  getDayUnit() {
    return "calendar";
  }

  getAnnualEntitlement() {
    return ANNUAL_ENTITLEMENT;
  }

  isEligible({ hireDate, referenceDate }) {
    if (!hireDate) return false;
    return fullYearsBetween(hireDate, referenceDate) >= 1;
  }

  /** Proporcional: (meses_completos / 12) * 30. */
  getProportionalDays({ hireDate, referenceDate }) {
    if (!hireDate) return 0;
    const months = Math.min(12, fullMonthsBetween(hireDate, referenceDate));
    return Math.round((months / 12) * ANNUAL_ENTITLEMENT * 100) / 100;
  }

  countRequestDays({ startDate, endDate }) {
    return countCalendarDays(startDate, endDate);
  }

  getExpirationDate({ periodEnd }) {
    return addDays(periodEnd, 365);
  }

  /** Vacaciones truncas al cese: proporcional a la fecha de término. */
  getSeveranceBalance({ hireDate, terminationDate }) {
    return this.getProportionalDays({
      hireDate,
      referenceDate: terminationDate,
    });
  }

  /**
   * Hook para récord vacacional (art. 10 D.L. 713).
   * Sin datos de asistencia: no-op; RR.HH. marca manualmente record_met.
   */
  evaluateRecord(/* period, attendanceData */) {
    return { recordMet: true, reason: null };
  }

  /**
   * Valida fraccionamiento art. 17 contra un período (bloque protegido 15 + flexible 15).
   * @returns {{ valid: boolean, error?: string, requiresFractionAck?: boolean }}
   */
  validateFractionAgainstPeriod(days, period) {
    const protectedUsed = Number(period.protected_block_days_used || 0);
    const flexibleUsed = Number(period.flexible_block_days_used || 0);
    const protectedRemaining = PROTECTED_BLOCK_SIZE - protectedUsed;
    const flexibleRemaining = FLEXIBLE_BLOCK_SIZE - flexibleUsed;
    const N = Number(days);

    if (N <= 0) {
      return { valid: false, error: "El rango seleccionado no contiene días." };
    }

    // Completar bloque protegido con tramo pequeño (ej. 7+6 inválido)
    if (
      protectedUsed > 0 &&
      protectedUsed < PROTECTED_BLOCK_SIZE &&
      N >= 1 &&
      N <= 6
    ) {
      const needed = PROTECTED_BLOCK_SIZE - protectedUsed;
      if (needed >= 7) {
        return {
          valid: false,
          error:
            "Fraccionamiento inválido (art. 17.i): el complemento del bloque protegido debe ser de al menos 7 u 8 días ininterrumpidos.",
        };
      }
    }

    // Bloque flexible: tramos de 1 a 6 días (art. 17.ii)
    if (N >= 1 && N <= 6) {
      if (flexibleRemaining >= N) {
        return { valid: true, requiresFractionAck: true };
      }
      return {
        valid: false,
        error:
          "Fraccionamiento inválido (art. 17.ii D.L. 713): el bloque flexible de 15 días ya está agotado o no alcanza para este tramo.",
      };
    }

    // Bloque protegido: 15 días corridos o tramos 7+8 / 8+7 (art. 17.i)
    if (N >= PROTECTED_BLOCK_SIZE) {
      const need = Math.min(N, protectedRemaining + flexibleRemaining);
      if (need <= protectedRemaining) {
        return { valid: true, requiresFractionAck: N < PROTECTED_BLOCK_SIZE * 2 };
      }
      if (protectedRemaining + flexibleRemaining >= N) {
        return { valid: true, requiresFractionAck: true };
      }
      return {
        valid: false,
        error: `Saldo insuficiente en el período para ${N} día(s).`,
      };
    }

    // Tramo intermedio 7–14 sobre bloque protegido
    if (N >= 7 && N <= 14) {
      if (protectedUsed === 0) {
        if (N <= protectedRemaining) {
          return { valid: true, requiresFractionAck: true };
        }
        return {
          valid: false,
          error:
            "Fraccionamiento inválido (art. 17.i): el bloque protegido no alcanza para este tramo.",
        };
      }
      if (protectedUsed === 7 && N >= 8 && protectedUsed + N <= PROTECTED_BLOCK_SIZE) {
        return { valid: true, requiresFractionAck: true };
      }
      if (protectedUsed === 8 && N >= 7 && protectedUsed + N <= PROTECTED_BLOCK_SIZE) {
        return { valid: true, requiresFractionAck: true };
      }
      if (protectedUsed > 0 && protectedUsed < PROTECTED_BLOCK_SIZE) {
        return {
          valid: false,
          error:
            "Fraccionamiento inválido (art. 17.i): el complemento del bloque protegido debe ser de al menos 7 u 8 días ininterrumpidos.",
        };
      }
      if (protectedRemaining >= N) {
        return { valid: true, requiresFractionAck: true };
      }
    }

    // 7–14 cuando protegido agotado: solo flexible si cabe (raro, N>6 ya cubierto arriba para <=6)
    if (N > 6 && N < 7) {
      return {
        valid: false,
        error: "Fraccionamiento inválido: tramo intermedio no permitido entre 6 y 7 días.",
      };
    }

    return {
      valid: false,
      error:
        "Fraccionamiento inválido según art. 17 D.L. 713 para este período.",
    };
  }

  /**
   * Calcula imputación a bloques protegido/flexible al consumir N días.
   * Misma lógica que validateFractionAgainstPeriod (art. 17):
   *   1–6  → bloque flexible
   *   7–14 → bloque protegido
   *   ≥15  → protegido primero, excedente a flexible
   */
  allocateBlockDays(period, days) {
    const N = Number(days);
    const protectedUsed = Number(period.protected_block_days_used || 0);
    const flexibleUsed = Number(period.flexible_block_days_used || 0);
    const protectedRemaining = PROTECTED_BLOCK_SIZE - protectedUsed;
    const flexibleRemaining = FLEXIBLE_BLOCK_SIZE - flexibleUsed;

    if (N <= 0) {
      throw new Error("Saldo insuficiente en bloques del período.");
    }

    // Art. 17.ii: tramos 1–6 solo contra bloque flexible
    if (N >= 1 && N <= 6) {
      if (N <= flexibleRemaining) {
        return { protectedDelta: 0, flexibleDelta: N };
      }
      throw new Error("Saldo insuficiente en bloques del período.");
    }

    // Art. 17.i: tramos 7–14 solo contra bloque protegido
    if (N >= 7 && N < PROTECTED_BLOCK_SIZE) {
      if (N <= protectedRemaining) {
        return { protectedDelta: N, flexibleDelta: 0 };
      }
      throw new Error("Saldo insuficiente en bloques del período.");
    }

    // ≥15: llenar protegido y desbordar a flexible
    let remaining = N;
    let protectedDelta = 0;
    let flexibleDelta = 0;

    if (remaining <= protectedRemaining) {
      protectedDelta = remaining;
      remaining = 0;
    } else {
      protectedDelta = protectedRemaining;
      remaining -= protectedRemaining;
    }

    if (remaining > 0) {
      if (remaining <= flexibleRemaining) {
        flexibleDelta = remaining;
      } else {
        throw new Error("Saldo insuficiente en bloques del período.");
      }
    }

    return { protectedDelta, flexibleDelta };
  }

  /**
   * Valida fraccionamiento art. 17 simulando el consumo FIFO por período
   * (cada tramo se imputa al período que realmente lo absorbe).
   */
  validateFractionAcrossPeriods(days, periods) {
    let remaining = Number(days);
    let requiresFractionAck = false;

    for (const p of periods || []) {
      if (remaining <= 0.001) break;
      if (p.record_met === false) continue;
      const avail = Number(
        p.available != null
          ? p.available
          : (Number(p.entitled_days) || 0) +
              (Number(p.adjusted_days) || 0) -
              (Number(p.used_days) || 0),
      );
      if (avail <= 0.001) continue;

      const take = Math.min(avail, remaining);
      const frac = this.validateFractionAgainstPeriod(take, p);
      if (!frac.valid) return frac;
      if (frac.requiresFractionAck) requiresFractionAck = true;
      remaining -= take;
    }

    if (remaining > 0.001) {
      return {
        valid: false,
        error: `Saldo insuficiente en el período para ${days} día(s).`,
      };
    }
    return { valid: true, requiresFractionAck };
  }

  validateRequest({
    request,
    availableBalance = 0,
    existingActiveRequests = [],
    referenceDate,
    config = {},
    allowPast = false,
    primaryPeriod = null,
    fifoPeriods = null,
    fractionAcknowledged = false,
  }) {
    const errors = [];
    const warnings = [];
    const today = toDateOnly(referenceDate) || toDateOnly(new Date());
    const start = toDateOnly(request.startDate);
    const end = toDateOnly(request.endDate);
    const days = this.countRequestDays({ startDate: start, endDate: end });

    if (!start || !end) {
      errors.push("Fechas de inicio y término inválidas.");
      return { valid: false, errors, warnings, days: 0, requiresFractionAck: false };
    }
    if (end < start) {
      errors.push("La fecha de término no puede ser anterior al inicio.");
    }
    if (days <= 0) {
      errors.push("El rango seleccionado no contiene días.");
    }
    if (!allowPast && start < today) {
      errors.push("No puedes solicitar vacaciones en fechas pasadas.");
    }

    const minNotice = Number(config.minNoticeDaysPE ?? 7);
    if (!allowPast && start >= today) {
      const noticeDays = countCalendarDays(addDays(today, 1), start);
      if (noticeDays < minNotice) {
        errors.push(
          `Debes solicitar con al menos ${minNotice} días de anticipación.`,
        );
      }
    }

    const suggestedMin = Number(config.suggestedMinFractionDaysPE ?? 7);
    if (days < suggestedMin && days < availableBalance && days >= 1 && days <= 6) {
      warnings.push(
        `Política interna sugiere tramos de al menos ${suggestedMin} días, pero tu solicitud de ${days} día(s) es válida según el art. 17.ii D.L. 713.`,
      );
    }

    if (days > availableBalance + 0.001) {
      errors.push(
        `Saldo insuficiente: solicitas ${days} día(s) calendario y tienes ${availableBalance} disponible(s).`,
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

    let requiresFractionAck = days < ANNUAL_ENTITLEMENT;

    if (errors.length === 0) {
      let frac = null;
      if (Array.isArray(fifoPeriods) && fifoPeriods.length > 0) {
        frac = this.validateFractionAcrossPeriods(days, fifoPeriods);
      } else if (primaryPeriod) {
        frac = this.validateFractionAgainstPeriod(days, primaryPeriod);
      }
      if (frac) {
        if (!frac.valid) {
          errors.push(frac.error);
        } else {
          requiresFractionAck = Boolean(frac.requiresFractionAck);
        }
      }
    }

    if (requiresFractionAck && !fractionAcknowledged) {
      errors.push(
        "Debes confirmar que solicitas el fraccionamiento por escrito (art. 17 D.L. 713).",
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      days,
      requiresFractionAck,
    };
  }
}

module.exports = PeruVacationStrategy;
