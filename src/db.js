const { Pool } = require("pg");
require("dotenv").config();

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

function createPool() {
  const ssl = resolveSsl();

  if (process.env.DATABASE_URL?.trim()) {
    return new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      ssl,
    });
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl,
  });
}

const pool = createPool();

pool.on("connect", () => {
  console.log("Conectado a la base de datos exitosamente");
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  // Necesario para transacciones (ej. aprobación de vacaciones con FOR UPDATE)
  getClient: () => pool.connect(),
  pool,
};
