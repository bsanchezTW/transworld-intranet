/**
 * Normaliza nombres/apellidos: primera letra de cada palabra en mayúscula.
 * Ej: "juan pérez" → "Juan Pérez", "MARÍA-JOSÉ" → "María-José"
 */
function capitalizePart(part) {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function toTitleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((segment) => capitalizePart(segment))
        .join("-"),
    )
    .join(" ");
}

module.exports = { toTitleCase };
