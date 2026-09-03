const ChileVacationStrategy = require("./strategies/ChileVacationStrategy");
const PeruVacationStrategy = require("./strategies/PeruVacationStrategy");
const { COUNTRY } = require("../../constants/vacationStatuses");
const { getCurrentCountry } = require("../../config/country");

/**
 * Fachada que selecciona la estrategia de vacaciones según el país.
 * Las rutas y servicios siempre pasan por aquí; nunca instancian estrategias
 * directamente ni ramifican por país.
 */
const STRATEGIES = {
  [COUNTRY.CL]: new ChileVacationStrategy(),
  [COUNTRY.PE]: new PeruVacationStrategy(),
};

function getStrategy(countryCode) {
  const code = String(countryCode || "").toUpperCase();
  const strategy = STRATEGIES[code];
  if (!strategy) {
    throw new Error(`País de vacaciones no soportado: ${countryCode}`);
  }
  return strategy;
}

function isSupportedCountry(countryCode) {
  return Boolean(STRATEGIES[String(countryCode || "").toUpperCase()]);
}

/**
 * País de vacaciones de un colaborador. Lo define la instancia (`COUNTRY`):
 * cada schema solo tiene trabajadores de ese país.
 */
function resolveCountryForUser() {
  return getCurrentCountry();
}

/** Estrategia que corresponde a un colaborador. */
function getStrategyForUser(user) {
  return getStrategy(resolveCountryForUser(user));
}

module.exports = {
  getStrategy,
  isSupportedCountry,
  resolveCountryForUser,
  getStrategyForUser,
};
