#!/usr/bin/env node
/**
 * Lanzador de desarrollo por país.
 *
 *   npm run dev:cl   → Chile en :3000
 *   npm run dev:pe   → Perú en :3001
 *
 * Un solo .env con secretos compartidos (BD, Supabase, Brevo). Este script
 * fija la identidad de la instancia (COUNTRY, puerto, URL, bucket) para
 * poder levantar las dos a la vez sin dos archivos de entorno.
 *
 * PowerShell no propaga `COUNTRY=CL npm run dev`; por eso el país va en --country.
 *
 * Precedencia (de mayor a menor):
 *   1. este lanzador (país, puerto, URL local, bucket)
 *   2. variables ya presentes en el proceso
 *   3. .env / .env.local  → secretos compartidos
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { getCountryConfig, isValidCountryCode } = require("../src/config/country");
const {
  defaultStorageBucketForCountry,
  getCountryDbBinding,
  SHARED_INTRANET_PROJECT_REF,
} = require("../src/config/supabaseProjects");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function loadSharedEnv() {
  dotenv.config({ path: path.join(ROOT, ".env") });
  dotenv.config({ path: path.join(ROOT, ".env.local") });
}

const args = parseArgs(process.argv);
const country = String(args.country || "").trim().toUpperCase();

if (!country || !isValidCountryCode(country)) {
  console.error(
    "Falta --country. Uso: npm run dev:cl   o   npm run dev:pe",
  );
  process.exit(1);
}

const config = getCountryConfig(country);
const port = args.port ? Number(args.port) : config.devPort;
const baseUrl =
  args["base-url"]?.trim() || `http://localhost:${port}`;

loadSharedEnv();

// La identidad gana siempre: si .env trae APP_BASE_URL o el bucket de Chile,
// Perú en :3001 no debe heredarlos.
process.env.COUNTRY = country;
process.env.PORT = String(port);
process.env.APP_BASE_URL = baseUrl;
process.env.SUPABASE_STORAGE_BUCKET = defaultStorageBucketForCountry(country);
process.env.MAIL_FROM = process.env.MAIL_FROM || config.noReplyEmail;

// El password del .env local corresponde al rol del país (intranet_chile /
// intranet_peru), no al usuario postgres del pooler. Si DB_USER viene como
// postgres.<ref> o como el rol del otro país, lo alineamos al de esta instancia.
const dbBinding = getCountryDbBinding(country);
const currentDbUser = String(process.env.DB_USER || "").trim();
const poolerMatch = currentDbUser.match(/^([a-z0-9_]+)\.([a-z0-9-]{8,})$/i);
const projectRef = poolerMatch?.[2] || SHARED_INTRANET_PROJECT_REF;
process.env.DB_USER = `${dbBinding.role}.${projectRef}`;

if (!fs.existsSync(path.join(ROOT, ".env")) && !fs.existsSync(path.join(ROOT, ".env.local"))) {
  console.warn(
    "[dev] No hay .env en la raíz. Copia .env.example y completa las credenciales.",
  );
}

console.log(
  `[dev] ${config.name} → ${baseUrl} · schema ${dbBinding.schema} · user ${process.env.DB_USER} · bucket ${process.env.SUPABASE_STORAGE_BUCKET}`,
);

require(path.join(ROOT, "src", "app.js"));
