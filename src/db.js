const { Pool } = require("pg");

const {
  getCountryDbBinding,
  searchPathStatement,
} = require("./config/supabaseProjects");
const { isIdPrimaryKeyCollision } = require("./utils/idCollision");

const DEFAULT_POOL_MAX = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

function resolveSsl() {
  const flag = String(process.env.DB_SSL || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") {
    return { rejectUnauthorized: false };
  }
  if (flag === "false" || flag === "0") {
    return false;
  }

  const host = process.env.DB_HOST || "";
  const databaseUrl = process.env.DATABASE_URL || "";
  const looksLikeSupabase =
    host.includes("supabase.co") ||
    host.includes("supabase.com") ||
    databaseUrl.includes("supabase.co") ||
    databaseUrl.includes("supabase.com");

  return looksLikeSupabase ? { rejectUnauthorized: false } : false;
}

function postgresOptionsForCountry(country = process.env.COUNTRY) {
  const raw = String(country || "").trim();
  const parts = [];
  if (raw) {
    const { schema } = getCountryDbBinding(raw);
    parts.push(`-c search_path=${schema}`);
  }
  return parts.length ? parts.join(" ") : undefined;
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
  };
}

function createPool() {
  const ssl = resolveSsl();
  const options = postgresOptionsForCountry();
  const extra = options ? { options } : {};
  const limits = poolLimits();

  if (process.env.DATABASE_URL?.trim()) {
    return new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      ssl,
      ...extra,
      ...limits,
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
  });
}

async function applySearchPath(client, country = process.env.COUNTRY) {
  await client.query(searchPathStatement(country));
}

const pool = createPool();

pool.on("connect", (client) => {
  if (!String(process.env.COUNTRY || "").trim()) return;
  applySearchPath(client).catch((error) => {
    console.error(
      "[db] No se pudo fijar search_path del país:",
      error.message,
    );
  });
});

// Sin este handler, un cliente idle que muere (Supabase corta a ~60s) tumba
// el proceso Node. Passenger lo reinicia en bucle y cPanel sirve 503 eterno.
pool.on("error", (error) => {
  console.error("[db] Error en cliente idle del pool:", error.message);
});

async function getClient() {
  const client = await pool.connect();
  try {
    await applySearchPath(client);
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function query(text, params) {
  const client = await getClient();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
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
};
