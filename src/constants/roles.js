/** Roles oficiales de la intranet */
const ROLES = {
  USUARIO: "Usuario",
  ADMINISTRADOR: "Administrador",
  DESHABILITADO: "Deshabilitado",
};

const ALL_ROLES = Object.values(ROLES);

/** Roles que pueden iniciar sesión y navegar la intranet */
const ROLES_INTRANET_ACTIVOS = [ROLES.USUARIO, ROLES.ADMINISTRADOR];

/** Alias históricos que se tratan como Administrador en rutas protegidas */
const ADMIN_ROUTE_ALIASES = new Set([
  "admin",
  "Administrador",
  "rrhh",
  "marketing",
  "gerencia",
  "control_y_seguridad",
  "noticias",
  "ventas",
]);

function normalizeRole(role) {
  const raw = String(role ?? "").trim();
  if (!raw) return ROLES.DESHABILITADO;

  const lower = raw.toLowerCase();
  if (lower === "admin" || lower === "administrador") {
    return ROLES.ADMINISTRADOR;
  }
  if (lower === "usuario" || lower === "user") {
    return ROLES.USUARIO;
  }
  if (lower === "deshabilitado" || lower === "disabled") {
    return ROLES.DESHABILITADO;
  }

  if (ALL_ROLES.includes(raw)) return raw;

  return ROLES.USUARIO;
}

function isAdministrador(role) {
  return normalizeRole(role) === ROLES.ADMINISTRADOR;
}

function isUsuario(role) {
  return normalizeRole(role) === ROLES.USUARIO;
}

function isDeshabilitado(role) {
  return normalizeRole(role) === ROLES.DESHABILITADO;
}

function canLogin(role) {
  const normalized = normalizeRole(role);
  return (
    normalized === ROLES.USUARIO || normalized === ROLES.ADMINISTRADOR
  );
}

function roleMatchesRoute(userRole, allowedRoles) {
  const normalizedUser = normalizeRole(userRole);

  for (const allowed of allowedRoles) {
    const key = String(allowed || "").trim();
    if (ADMIN_ROUTE_ALIASES.has(key)) {
      if (normalizedUser === ROLES.ADMINISTRADOR) return true;
      continue;
    }
    if (normalizeRole(key) === normalizedUser) return true;
  }

  return false;
}

module.exports = {
  ROLES,
  ALL_ROLES,
  ROLES_INTRANET_ACTIVOS,
  normalizeRole,
  isAdministrador,
  isUsuario,
  isDeshabilitado,
  canLogin,
  roleMatchesRoute,
};
