const { isFeatureEnabled } = require("../config/features");

/**
 * Corta la petición si la capacidad no existe en esta instancia.
 *
 * Devuelve 404 y no 403 a propósito: en un país donde la funcionalidad no
 * existe, la ruta tampoco existe. Un 403 revelaría que hay algo detrás.
 *
 * Va antes de requireRole: primero "¿esto existe aquí?", después "¿este
 * usuario puede?". Son preguntas distintas y no deben mezclarse.
 */
function requireFeature(feature) {
  return (req, res, next) => {
    if (isFeatureEnabled(feature)) return next();

    const accept = req.headers.accept || "";
    const wantsJson =
      req.xhr ||
      accept.includes("application/json") ||
      /\/(api|upload)\//.test(req.path);

    if (wantsJson) {
      return res.status(404).json({ error: "No encontrado" });
    }
    return res.status(404).render("404", { titulo: "Página no encontrada" });
  };
}

module.exports = requireFeature;
