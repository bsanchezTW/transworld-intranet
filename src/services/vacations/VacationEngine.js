const ChileVacationStrategy = require("./strategies/ChileVacationStrategy");
const PeruVacationStrategy = require("./strategies/PeruVacationStrategy");
const { COUNTRY } = require("../../constants/vacationStatuses");

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

module.exports = {
  getStrategy,
  isSupportedCountry,
};
