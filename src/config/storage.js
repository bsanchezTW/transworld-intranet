const DEFAULT_STORAGE_BUCKET = "intranet-content";
const DEFAULT_MAX_FILE_SIZE_MB = 250;
const DEFAULT_TUS_THRESHOLD_MB = 6;
const DEFAULT_TUS_CHUNK_SIZE_MB = 6;
const DEFAULT_LIST_PAGE_SIZE = 100;
const DEFAULT_DELETE_BATCH_SIZE = 1000;
const {
  extractProjectRefFromSupabaseUrl,
  assertCountrySupabaseProject,
  assertCountryStorageBucket,
  defaultStorageBucketForCountry,
} = require("./supabaseProjects");

class StorageConfigurationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StorageConfigurationError";
    this.code = "STORAGE_CONFIGURATION_ERROR";
    this.statusCode = 500;
    Object.assign(this, details);
  }
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorageConfigurationError(
      `${name} debe ser un entero positivo; se recibió "${value}".`,
      { variable: name },
    );
  }
  return parsed;
}

function megabytesToBytes(megabytes) {
  return megabytes * 1024 * 1024;
}

function normalizeSupabaseUrl(rawUrl) {
  const value = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!value) {
    throw new StorageConfigurationError("SUPABASE_URL es obligatoria.", {
      variable: "SUPABASE_URL",
    });
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new StorageConfigurationError("SUPABASE_URL no es una URL válida.", {
      variable: "SUPABASE_URL",
    });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new StorageConfigurationError(
      "SUPABASE_URL debe usar el protocolo http o https.",
      { variable: "SUPABASE_URL" },
    );
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    parsed.hostname.toLowerCase(),
  );
  if (parsed.protocol !== "https:" && !isLoopback) {
    throw new StorageConfigurationError(
      "SUPABASE_URL debe usar HTTPS; HTTP solo se admite para localhost.",
      { variable: "SUPABASE_URL" },
    );
  }

  return value;
}

function resolveStorageSecret(env = process.env) {
  const currentSecret = String(env.SUPABASE_SECRET_KEY || "").trim();
  if (currentSecret) {
    return { key: currentSecret, source: "SUPABASE_SECRET_KEY", legacy: false };
  }

  const legacySecret = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (legacySecret) {
    return {
      key: legacySecret,
      source: "SUPABASE_SERVICE_ROLE_KEY",
      legacy: true,
    };
  }

  throw new StorageConfigurationError(
    "Falta la credencial privada de Storage: configura SUPABASE_SECRET_KEY " +
      "(preferida) o SUPABASE_SERVICE_ROLE_KEY (legacy).",
    { variable: "SUPABASE_SECRET_KEY" },
  );
}

function extractProjectRefFromDatabaseEnv(env = process.env) {
  // Debe seguir la misma precedencia que db.js.
  if (env.DATABASE_URL?.trim()) {
    try {
      const parsed = new URL(env.DATABASE_URL);
      const usernameMatch = decodeURIComponent(parsed.username)
        .trim()
        .match(/^postgres\.([a-z0-9-]{8,})$/i);
      if (usernameMatch) return usernameMatch[1].toLowerCase();
      const hostMatch = parsed.hostname
        .trim()
        .match(/^db\.([a-z0-9-]{8,})\.supabase\.co$/i);
      return hostMatch?.[1]?.toLowerCase() || null;
    } catch {
      // La validación general de DATABASE_URL vive en la configuración de BD.
      return null;
    }
  }

  if (env.DB_USER) {
    const match = String(env.DB_USER).trim().match(/^postgres\.([a-z0-9-]{8,})$/i);
    if (match) return match[1].toLowerCase();
  }
  if (env.DB_HOST) {
    const match = String(env.DB_HOST)
      .trim()
      .match(/^db\.([a-z0-9-]{8,})\.supabase\.co$/i);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function assertSameSupabaseProject(url, env = process.env) {
  const storageRef = extractProjectRefFromSupabaseUrl(url);
  const databaseRef = extractProjectRefFromDatabaseEnv(env);
  if (storageRef && databaseRef && storageRef !== databaseRef) {
    throw new StorageConfigurationError(
      `SUPABASE_URL apunta al proyecto "${storageRef}", pero la base de datos ` +
        `usa "${databaseRef}". Se rechaza el arranque para no mezclar datos ` +
        "entre instancias.",
      { variable: "SUPABASE_URL", storageRef, databaseRef },
    );
  }
}

/**
 * Obtiene la configuración del proyecto Supabase de esta instancia.
 *
 * Chile y Perú pueden compartir el mismo proyecto Supabase; el aislamiento
 * es schema + rol Postgres + bucket. Un .env cruzado no debe arrancar.
 */
function getStorageConfig(env = process.env) {
  const url = normalizeSupabaseUrl(env.SUPABASE_URL);
  assertSameSupabaseProject(url, env);
  assertCountrySupabaseProject(url, env.COUNTRY, env);
  const secret = resolveStorageSecret(env);
  const bucket = String(
    env.SUPABASE_STORAGE_BUCKET ||
      defaultStorageBucketForCountry(env.COUNTRY) ||
      DEFAULT_STORAGE_BUCKET,
  ).trim();
  assertCountryStorageBucket(bucket, env.COUNTRY);

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket)) {
    throw new StorageConfigurationError(
      "SUPABASE_STORAGE_BUCKET contiene caracteres no admitidos.",
      { variable: "SUPABASE_STORAGE_BUCKET" },
    );
  }

  const maxFileSizeMb = parsePositiveInteger(
    env.SUPABASE_STORAGE_MAX_FILE_SIZE_MB,
    DEFAULT_MAX_FILE_SIZE_MB,
    "SUPABASE_STORAGE_MAX_FILE_SIZE_MB",
  );
  const tusThresholdMb = parsePositiveInteger(
    env.SUPABASE_STORAGE_TUS_THRESHOLD_MB,
    DEFAULT_TUS_THRESHOLD_MB,
    "SUPABASE_STORAGE_TUS_THRESHOLD_MB",
  );
  const tusChunkSizeMb = parsePositiveInteger(
    env.SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB,
    DEFAULT_TUS_CHUNK_SIZE_MB,
    "SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB",
  );
  const listPageSize = parsePositiveInteger(
    env.SUPABASE_STORAGE_LIST_PAGE_SIZE,
    DEFAULT_LIST_PAGE_SIZE,
    "SUPABASE_STORAGE_LIST_PAGE_SIZE",
  );
  const deleteBatchSize = parsePositiveInteger(
    env.SUPABASE_STORAGE_DELETE_BATCH_SIZE,
    DEFAULT_DELETE_BATCH_SIZE,
    "SUPABASE_STORAGE_DELETE_BATCH_SIZE",
  );

  if (tusThresholdMb > maxFileSizeMb) {
    throw new StorageConfigurationError(
      "SUPABASE_STORAGE_TUS_THRESHOLD_MB no puede superar el límite máximo de archivo.",
      { variable: "SUPABASE_STORAGE_TUS_THRESHOLD_MB" },
    );
  }
  if (tusChunkSizeMb !== DEFAULT_TUS_CHUNK_SIZE_MB) {
    throw new StorageConfigurationError(
      `SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB debe ser ${DEFAULT_TUS_CHUNK_SIZE_MB}; ` +
        "Supabase Storage exige chunks TUS de 6 MiB salvo el último.",
      { variable: "SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB" },
    );
  }
  if (listPageSize > 1000) {
    throw new StorageConfigurationError(
      "SUPABASE_STORAGE_LIST_PAGE_SIZE no puede superar 1000.",
      { variable: "SUPABASE_STORAGE_LIST_PAGE_SIZE" },
    );
  }
  if (deleteBatchSize > 1000) {
    throw new StorageConfigurationError(
      "SUPABASE_STORAGE_DELETE_BATCH_SIZE no puede superar 1000.",
      { variable: "SUPABASE_STORAGE_DELETE_BATCH_SIZE" },
    );
  }

  return Object.freeze({
    url,
    key: secret.key,
    keySource: secret.source,
    usesLegacyKey: secret.legacy,
    bucket,
    maxFileSizeBytes: megabytesToBytes(maxFileSizeMb),
    tusThresholdBytes: megabytesToBytes(tusThresholdMb),
    tusChunkSizeBytes: megabytesToBytes(tusChunkSizeMb),
    listPageSize,
    deleteBatchSize,
  });
}

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  DEFAULT_MAX_FILE_SIZE_MB,
  DEFAULT_TUS_THRESHOLD_MB,
  DEFAULT_TUS_CHUNK_SIZE_MB,
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_DELETE_BATCH_SIZE,
  StorageConfigurationError,
  extractProjectRefFromSupabaseUrl,
  extractProjectRefFromDatabaseEnv,
  assertSameSupabaseProject,
  resolveStorageSecret,
  getStorageConfig,
};
