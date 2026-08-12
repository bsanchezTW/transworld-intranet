#!/usr/bin/env node
/**
 * Lanzador de desarrollo por país.
 *
 *   node scripts/dev.js --country=CL
 *   node scripts/dev.js --country=PE --port=3001
 *
 * Existe porque `COUNTRY=CL npm run dev` no funciona en PowerShell, que es el
 * shell de desarrollo habitual aquí. Resolverlo con un lanzador en Node evita
 * añadir cross-env o dotenv-cli solo para dos scripts.
 *
 * Precedencia de configuración (de mayor a menor):
 *   1. variables ya presentes en el entorno del proceso
 *   2. .env.<cc>.local      → credenciales del país, no versionado
 *   3. .env                 → base compartida, lo carga config/env.js
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const args = parseArgs(process.argv);
const country = String(args.country || "").trim().toUpperCase();

if (!country) {
  console.error(
    "Falta --country. Uso: node scripts/dev.js --country=CL [--port=3000]",
  );
  process.exit(1);
}

// COUNTRY se fija antes de requerir la app: config/env.js la valida contra la
// lista de países registrados y aborta el arranque si no es válida.
process.env.COUNTRY = country;
if (args.port) process.env.PORT = String(args.port);

const envFile = path.join(ROOT, `.env.${country.toLowerCase()}.local`);
if (fs.existsSync(envFile)) {
  // dotenv no pisa lo que ya existe en process.env, así que --country y --port
  // mandan por encima del archivo.
  dotenv.config({ path: envFile });
  console.log(`[dev] Configuración de ${country} desde ${path.basename(envFile)}`);
} else {
  console.log(
    `[dev] Sin ${path.basename(envFile)} — se usará .env. ` +
      `Copia .env.${country.toLowerCase()}.example para apuntar a la base de ${country}.`,
  );
}

require(path.join(ROOT, "src", "app.js"));
