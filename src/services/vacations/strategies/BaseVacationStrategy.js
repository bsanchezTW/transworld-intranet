/**
 * Contrato base para las estrategias de cálculo de vacaciones por país.
 * Cada país implementa sus reglas; las rutas/servicios nunca hacen
 * `if (country === 'CL')`, sino que delegan en la estrategia vía VacationEngine.
 */
class BaseVacationStrategy {
  getCountryCode() {
    throw new Error("getCountryCode no implementado");
  }

  /** Unidad de medida para la UI: 'business' | 'calendar' */
  getDayUnit() {
    throw new Error("getDayUnit no implementado");
  }

  /** Días que corresponden por un año completo de servicio. */
  getAnnualEntitlement(/* { yearsOfService, hireDate } */) {
    throw new Error("getAnnualEntitlement no implementado");
  }

  /** ¿El colaborador ya tiene derecho a vacaciones? */
  isEligible(/* { hireDate, referenceDate } */) {
    throw new Error("isEligible no implementado");
  }

  /** Días proporcionales si no cumplió el año completo. */
  getProportionalDays(/* { hireDate, referenceDate } */) {
    throw new Error("getProportionalDays no implementado");
  }

  /** Cuenta los días que consume una solicitud (según unidad del país). */
  countRequestDays(/* { startDate, endDate, holidays } */) {
    throw new Error("countRequestDays no implementado");
  }

  /**
   * Valida una solicitud antes de guardarla.
   * @returns {{ valid: boolean, errors: string[], days: number }}
   */
  validateRequest(/* { user, periods, request, holidays, existingRequests, config } */) {
    throw new Error("validateRequest no implementado");
  }

  /** Fecha límite para tomar vacaciones devengadas de un período. */
  getExpirationDate(/* { periodEnd } */) {
    throw new Error("getExpirationDate no implementado");
  }
}

module.exports = BaseVacationStrategy;
