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
 * País de vacaciones de un colaborador. Punto único de resolución.
 *
 * Lo define la instancia (`COUNTRY`), no un campo del formulario. Si el
 * colaborador tiene employment_country de otro país, se rechaza: aplicar las
 * reglas legales ajenas produce un saldo incorrecto.
 */
function resolveCountryForUser(user) {
  const instanceCountry = getCurrentCountry();
  const code = String(user?.employment_country || "").toUpperCase();

  if (code && code !== instanceCountry) {
    throw new Error(
      `El colaborador ${user?.id ?? "(sin id)"} pertenece a ${code}, no a esta instancia (${instanceCountry}).`,
    );
  }

  return instanceCountry;
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
