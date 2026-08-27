/**
 * Carga y validación del entorno. Debe requerirse ANTES que cualquier módulo
 * que lea process.env (db.js, config/country.js, servicios).
 *
 * Regla: sin fallbacks silenciosos. Si falta una variable obligatoria o trae un
 * valor inválido, la aplicación falla en el arranque con un mensaje explícito
 * en vez de arrancar con una configuración equivocada.
 */

require("dotenv").config();

const { COUNTRY_CODES, isValidCountryCode } = require("./country");
const { assertCountryDatabaseRole } = require("./supabaseProjects");

const errors = [];

function requireVar(name, { description } = {}) {
  const value = process.env[name]?.trim();
  if (!value) {
    errors.push(`${name} es obligatoria${description ? ` (${description})` : ""}.`);
    return null;
  }
  return value;
}

// ── País de la instancia ────────────────────────────────────────────────────
const rawCountry = process.env.COUNTRY?.trim();
if (!rawCountry) {
  errors.push(
    `COUNTRY es obligatoria: declara el país de esta instancia (${COUNTRY_CODES.join(" o ")}).`,
  );
} else if (!isValidCountryCode(rawCountry)) {
  errors.push(
    `COUNTRY="${rawCountry}" no es un país registrado. Valores admitidos: ${COUNTRY_CODES.join(", ")}.`,
  );
} else {
  // Normalizamos para que el resto del proceso lea siempre mayúsculas.
  process.env.COUNTRY = rawCountry.toUpperCase();
}

// ── Núcleo ──────────────────────────────────────────────────────────────────
requireVar("SESSION_SECRET", { description: "secreto de firma de sesiones" });
requireVar("APP_BASE_URL", {
  description: "URL base de esta instancia, usada en enlaces de correo",
});

// ── Base de datos ───────────────────────────────────────────────────────────
// Se admiten las dos formas que ya soporta src/db.js: DATABASE_URL o los
// campos sueltos. Basta con una.
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
const hasDiscreteDbVars = Boolean(
  process.env.DB_HOST?.trim() &&
    process.env.DB_USER?.trim() &&
    process.env.DB_NAME?.trim(),
);
if (!hasDatabaseUrl && !hasDiscreteDbVars) {
  errors.push(
    "Falta la configuración de base de datos: define DATABASE_URL, o bien DB_HOST + DB_USER + DB_NAME.",
  );
}

// ── Storage privado ────────────────────────────────────────────────────────
// Valida credenciales, límites y —cuando el project ref está disponible en el
// usuario de Postgres— que BD y Storage pertenezcan al mismo proyecto. Esto es
// la barrera que evita que una instancia PE escriba por error en Chile.
try {
  const { getStorageConfig } = require("./storage");
  getStorageConfig(process.env);
} catch (error) {
  errors.push(error.message || "Configuración de Supabase Storage inválida.");
}

if (isValidCountryCode(process.env.COUNTRY)) {
  try {
    assertCountryDatabaseRole(process.env);
  } catch (error) {
    errors.push(error.message || "Rol de base de datos inválido para el país.");
  }
}

if (errors.length > 0) {
  throw new Error(
    `Configuración de entorno inválida:\n  - ${errors.join("\n  - ")}\n` +
      "Revisa tu archivo .env (ver .env.cl.example / .env.pe.example).",
  );
}

const { getCurrentCountry, getCountryConfig } = require("./country");

module.exports = {
  country: getCurrentCountry(),
  countryConfig: getCountryConfig(),
  appBaseUrl: process.env.APP_BASE_URL.trim().replace(/\/+$/, ""),
  isProduction: process.env.NODE_ENV === "production",
};
