const path = require("node:path");
const {
  StoragePathError,
  StorageValidationError,
} = require("./storageErrors");

const CONTENT_ROUTE_PREFIX = "content";

function invalidPath(message = "Ruta relativa inválida") {
  return new StoragePathError(message);
}

/**
 * Convierte URLs `/content/...` y rutas de objeto a una clave canónica del
 * bucket. Una cadena vacía es válida únicamente para representar la raíz en
 * operaciones de listado; las operaciones de archivo la rechazan después.
 */
function normalizeRelativePath(relativePath) {
  if (relativePath === null || relativePath === undefined) return "";

  let clean = String(relativePath).trim();
  if (!clean) return "";

  if (/^https?:\/\//i.test(clean)) {
    try {
      clean = new URL(clean).pathname;
    } catch {
      throw invalidPath();
    }
  } else if (/^\/?(?:content|media)(?:[/?#]|$)/i.test(clean)) {
    // Las referencias HTTP internas guardadas en BD pueden traer
    // cache-busting. En una clave cruda, `?` y `#` son caracteres válidos.
    clean = clean.split(/[?#]/, 1)[0];
  }

  clean = clean.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (clean === CONTENT_ROUTE_PREFIX) return "";
  if (clean.startsWith(`${CONTENT_ROUTE_PREFIX}/`)) {
    clean = clean.slice(CONTENT_ROUTE_PREFIX.length + 1);
  }

  // URLs firmadas públicas: /media/<firma>/<ruta-objeto>
  if (clean === "media") return "";
  if (clean.startsWith("media/")) {
    const rest = clean.slice("media/".length);
    const slash = rest.indexOf("/");
    clean = slash === -1 ? "" : rest.slice(slash + 1);
  }

  clean = clean.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean) return "";

  const decodedSegments = [];
  for (const segment of clean.split("/")) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidPath("La ruta contiene una secuencia URL inválida");
    }

    if (
      !segment ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("\0") ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      /[\r\n]/.test(decoded)
    ) {
      throw invalidPath();
    }
    decodedSegments.push(decoded);
  }

  return decodedSegments.join("/");
}

function requireFilePath(relativePath) {
  const clean = normalizeRelativePath(relativePath);
  if (!clean || !path.posix.basename(clean)) {
    throw invalidPath("La ruta debe identificar un archivo");
  }
  return clean;
}

function joinRelativePath(...parts) {
  return normalizeRelativePath(
    parts.map((part) => normalizeRelativePath(part)).filter(Boolean).join("/"),
  );
}

function encodeObjectPath(relativePath) {
  return requireFilePath(relativePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

const MIME_BY_EXTENSION = Object.freeze({
  ".avif": "image/avif",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rar": "application/vnd.rar",
  ".rtf": "application/rtf",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
});

function detectMimeFromMagicBytes(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return "image/heif";
    }
    if (brand === "qt  ") return "video/quicktime";
    if (["isom", "iso2", "mp41", "mp42", "avc1", "dash", "M4V ", "MSNV"].includes(brand)) {
      return "video/mp4";
    }
  }
  return null;
}

function inferContentType(relativePath, buffer) {
  return (
    detectMimeFromMagicBytes(buffer) ||
    MIME_BY_EXTENSION[path.extname(String(relativePath || "")).toLowerCase()] ||
    "application/octet-stream"
  );
}

function validateContentType(contentType) {
  const clean = String(contentType || "").trim();
  if (!clean || clean.length > 200 || /[\r\n]/.test(clean) || !clean.includes("/")) {
    throw new StorageValidationError("Content-Type inválido", {
      code: "STORAGE_INVALID_CONTENT_TYPE",
    });
  }
  return clean;
}

module.exports = {
  CONTENT_ROUTE_PREFIX,
  MIME_BY_EXTENSION,
  normalizeRelativePath,
  requireFilePath,
  joinRelativePath,
  encodeObjectPath,
  detectMimeFromMagicBytes,
  inferContentType,
  validateContentType,
};
