/**
 * Distingue colisión del PK `id` (reintentable: el trigger de 6 dígitos
 * puede devolver el mismo candidato a dos INSERT paralelos) de otros
 * UNIQUE (email, slug, etc.), que no se reintentan.
 */
function isIdPrimaryKeyCollision(err) {
  if (!err || err.code !== "23505") return false;
  if (typeof err.constraint === "string" && /_pkey$/.test(err.constraint)) {
    return true;
  }
  if (typeof err.detail === "string" && /^\s*Key \(id\)=/i.test(err.detail)) {
    return true;
  }
  return false;
}

module.exports = { isIdPrimaryKeyCollision };
