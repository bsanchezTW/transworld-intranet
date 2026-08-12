const path = require("node:path");

const ACTIVE_CONTENT_TYPES = new Set([
  "application/atom+xml",
  "application/ecmascript",
  "application/javascript",
  "application/rss+xml",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/html",
  "text/ecmascript",
  "text/javascript",
  "text/xml",
]);

function baseContentType(contentType) {
  return String(contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function isActiveContentType(contentType) {
  return ACTIVE_CONTENT_TYPES.has(baseContentType(contentType));
}

function contentDispositionFor(file = {}) {
  const rawName = path.posix.basename(
    String(file.name || file.relativePath || "archivo"),
  );
  const fallback = rawName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .slice(0, 180) || "archivo";
  const encoded = encodeURIComponent(rawName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

module.exports = {
  ACTIVE_CONTENT_TYPES,
  baseContentType,
  isActiveContentType,
  contentDispositionFor,
};
