const { getCountryConfig } = require("../config/country");

/** Sufijo del <title>: cambia con el país de la instancia. */
function getPageTitleSuffix() {
  return getCountryConfig().pageTitleSuffix;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPageTitle(title) {
  const suffix = getPageTitleSuffix();

  if (!title || typeof title !== "string") {
    return suffix;
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return suffix;
  }

  // Ya viene con el sufijo de esta instancia: no duplicarlo.
  if (new RegExp(`\\|\\s*${escapeRegExp(suffix)}\\s*$`, "i").test(trimmed)) {
    return trimmed;
  }

  // Quita un sufijo previo (incluido el de otro país) antes de añadir el actual.
  const base = trimmed
    .replace(/\s*\|\s*Intranet Transworld (?:Chile|Perú|Peru)\s*$/i, "")
    .replace(/\s*\|\s*Transworld\s*$/i, "")
    .trim();

  return `${base} | ${suffix}`;
}

module.exports = { formatPageTitle, getPageTitleSuffix };
