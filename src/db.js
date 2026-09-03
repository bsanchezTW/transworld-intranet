const dns = require("dns");
const { Pool } = require("pg");

const {
  postgresStartupOptions,
  searchPathStatement,
} = require("./config/supabaseProjects");
const { isIdPrimaryKeyCollision } = require("./utils/idCollision");
const logger = require("./utils/logger");

const DEFAULT_POOL_MAX = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

function looksLikeSupabaseHost() {
  const host = process.env.DB_HOST || "";
  const databaseUrl = process.env.DATABASE_URL || "";
  return (
    host.includes("supabase.co") ||
    host.includes("supabase.com") ||
    databaseUrl.includes("supabase.co") ||
    databaseUrl.includes("supabase.com")
  );
}

function resolveSsl() {
  const flag = String(process.env.DB_SSL || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") {
    return { rejectUnauthorized: false };
  }
  if (flag === "false" || flag === "0") {
    return false;
  }

  return looksLikeSupabaseHost() ? { rejectUnauthorized: false } : false;
}

function postgresOptionsForCountry(country = process.env.COUNTRY) {
  const raw = String(country || "").trim();
  if (!raw) return undefined;
  return postgresStartupOptions(raw);
}

function lookupIpv4(hostname, _options, callback) {
  dns.lookup(hostname, { family: 4 }, callback);
}

function poolLimits() {
  const max = Number(process.env.DB_POOL_MAX);
  const connectionTimeoutMillis = Number(process.env.DB_CONNECT_TIMEOUT_MS);
  const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_POOL_MAX,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
      ? connectionTimeoutMillis
      : DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis > 0
      ? idleTimeoutMillis
      : DEFAULT_IDLE_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

function createPool() {
  const ssl = resolveSsl();
  const options = postgresOptionsForCountry();
  const extra = options ? { options } : {};
  const limits = poolLimits();
  const lookup = looksLikeSupabaseHost() ? { lookup: lookupIpv4 } : {};

  if (process.env.DATABASE_URL?.trim()) {
    return new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      ssl,
      ...extra,
      ...limits,
      ...lookup,
    });
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl,
    ...extra,
    ...limits,
    ...lookup,
  });
}

async function applySearchPath(client, country = process.env.COUNTRY) {
  await client.query(searchPathStatement(country));
}

const pool = createPool();
const poolCreatedAt = Date.now();
let firstConnectLogged = false;

pool.on("connect", () => {
  if (firstConnectLogged) return;
  firstConnectLogged = true;
  logger.info("db", `conectado en ${Date.now() - poolCreatedAt}ms`);
});

// Sin este handler, un cliente idle que muere (Supabase corta a ~60s) tumba
// el proceso Node. Passenger lo reinicia en bucle y cPanel sirve 503 eterno.
pool.on("error", (error) => {
  logger.error("db", error);
});

function warmPool() {
  pool.query("SELECT 1").catch((error) => {
    logger.error("db", error);
  });
}

async function getClient() {
  return pool.connect();
}

async function query(text, params) {
  return pool.query(text, params);
}

async function queryRetryIdCollision(text, params, maxAttempts = 8) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await query(text, params);
    } catch (err) {
      lastErr = err;
      if (!isIdPrimaryKeyCollision(err) || attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

module.exports = {
  query,
  queryRetryIdCollision,
  isIdPrimaryKeyCollision,
  getClient,
  pool,
  applySearchPath,
  searchPathStatement,
  postgresOptionsForCountry,
  warmPool,
};
