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
 * No admite fallback: un colaborador sin país de contrato es un dato
 * incompleto, y calcularle vacaciones con reglas supuestas produce un saldo
 * legalmente incorrecto. Es preferible fallar y que RR.HH. complete el dato.
 *
 * Mientras Chile y Perú compartan base de datos, la fuente es el propio
 * colaborador. Cuando cada instancia tenga su base, esto pasará a ser
 * getCurrentCountry() y el parámetro desaparecerá.
 */
function resolveCountryForUser(user) {
  const code = String(user?.employment_country || "").toUpperCase();

  if (!isSupportedCountry(code)) {
    throw new Error(
      `El colaborador ${user?.id ?? "(sin id)"} no tiene un país de contrato válido ` +
        `(employment_country=${JSON.stringify(user?.employment_country)}). ` +
        "RR.HH. debe corregirlo antes de calcular sus vacaciones.",
    );
  }

  // Señal de datos mezclados: hasta que las bases estén separadas, una
  // instancia puede ver colaboradores del otro país. Se respeta su regla legal,
  // pero queda registrado para la migración.
  const instanceCountry = getCurrentCountry();
  if (code !== instanceCountry) {
    console.warn(
      `[Vacaciones] Colaborador ${user?.id} es de ${code} en una instancia ${instanceCountry}. ` +
        "Se aplican las reglas de su país de contrato. Revisar al separar las bases de datos.",
    );
  }

  return code;
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
