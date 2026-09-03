/**
 * Logs de proceso: una línea, un scope, sin dumps de pg.
 *
 * Los fallos de conexión a Postgres se agrupan: al arrancar, 8 tareas
 * pegan a la vez y antes cada una imprimía el objeto Error completo.
 */

const DB_BURST_MS = 20000;

const bursts = new Map();

function textOf(err) {
  if (err == null) return "";
  if (typeof err === "string") return err;
  return String(err.message || err);
}

function poolerRole() {
  const user = String(process.env.DB_USER || "").trim();
  return user.split(".")[0] || "postgres";
}

function describeError(err) {
  const raw = textOf(err);
  const code = err && typeof err === "object" ? err.code : undefined;

  if (code === "28P01" || /password authentication failed/i.test(raw)) {
    const quoted = raw.match(/user "([^"]+)"/)?.[1];
    const role = quoted ? quoted.split(".")[0] : poolerRole();
    return {
      kind: "auth",
      scope: "db",
      message: `clave rechazada para ${role} — ALTER USER ${role} WITH PASSWORD igual a DB_PASSWORD`,
    };
  }

  if (/ECIRCUITBREAKER|too many authentication failures/i.test(raw)) {
    return {
      kind: "circuit",
      scope: "db",
      message:
        "pooler bloqueó conexiones (demasiados logins fallidos). Espera 1–2 min sin reiniciar",
    };
  }

  if (
    code === "08006" ||
    /econnrefused|Failed to connect to database/i.test(raw)
  ) {
    return {
      kind: "down",
      scope: "db",
      message:
        "Postgres no responde (proyecto pausado o reiniciando en Supabase)",
    };
  }

  if (/Client network socket disconnected|socket hang up/i.test(raw)) {
    return { kind: null, scope: null, message: "TLS cortado / socket hang up" };
  }

  return { kind: null, scope: null, message: raw };
}

function write(stream, scope, message) {
  stream(`[${scope}] ${message}`);
}

function rememberBurst(kind, message) {
  const existing = bursts.get(kind);
  if (existing) {
    existing.count += 1;
    return true;
  }

  const entry = { count: 0, message };
  const timer = setTimeout(() => {
    bursts.delete(kind);
    if (entry.count > 0) {
      write(console.error, "db", `+${entry.count} igual(es) omitido(s)`);
    }
  }, DB_BURST_MS);
  if (typeof timer.unref === "function") timer.unref();
  entry.timer = timer;
  bursts.set(kind, entry);
  return false;
}

function info(scope, message) {
  write(console.log, scope, message);
}

function warn(scope, err) {
  const described = describeError(err);
  if (described.kind && rememberBurst(described.kind, described.message)) {
    return;
  }
  write(console.warn, described.scope || scope, described.message);
}

function error(scope, err) {
  const described = describeError(err);
  if (described.kind && rememberBurst(described.kind, described.message)) {
    return;
  }
  write(console.error, described.scope || scope, described.message);
  if (process.env.LOG_STACK === "1" && err && err.stack) {
    console.error(err.stack);
  }
}

function reset() {
  for (const entry of bursts.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  bursts.clear();
}

module.exports = {
  info,
  warn,
  error,
  describeError,
  reset,
  DB_BURST_MS,
};
