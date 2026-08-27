const { Pool } = require("pg");
require("dotenv").config();

const {
  getCountryDbBinding,
  searchPathStatement,
} = require("./config/supabaseProjects");

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
  if (!raw) return undefined;
  const { schema } = getCountryDbBinding(raw);
  return `-c search_path=${schema}`;
}

function createPool() {
  const ssl = resolveSsl();
  const options = postgresOptionsForCountry();
  const extra = options ? { options } : {};

  if (process.env.DATABASE_URL?.trim()) {
    return new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      ssl,
      ...extra,
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
  });
}

async function applySearchPath(client, country = process.env.COUNTRY) {
  await client.query(searchPathStatement(country));
}

const pool = createPool();

pool.on("connect", (client) => {
  if (!String(process.env.COUNTRY || "").trim()) return;
  applySearchPath(client)
    .then(() => {
      console.log("Conectado a la base de datos exitosamente");
    })
    .catch((error) => {
      console.error(
        "[db] No se pudo fijar search_path del país:",
        error.message,
      );
    });
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

module.exports = {
  query,
  getClient,
  pool,
  applySearchPath,
  searchPathStatement,
};
