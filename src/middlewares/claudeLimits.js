const { isAdministrador } = require("../constants/roles");

/** Indica si el usuario de la sesión es administrador y no tiene cuota diaria. */
function claudeUserHasUnlimitedUsage(req) {
  return isAdministrador(req.session?.user?.role);
}

/** Expone req.claudeUnlimitedUsage para rutas del asistente Claude. */
function attachClaudeUsageContext(req, res, next) {
  req.claudeUnlimitedUsage = claudeUserHasUnlimitedUsage(req);
  next();
}

module.exports = {
  attachClaudeUsageContext,
  claudeUserHasUnlimitedUsage,
};
