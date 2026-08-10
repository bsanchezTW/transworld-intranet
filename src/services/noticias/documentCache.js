// Caché en memoria con TTL para el HTML de los documentos Word renderizados.
//
// El HTML se guarda como archivo en SharePoint (no en la columna JSON, que
// engordaría cada fila). Traerlo desde Graph en cada visita sería lento, así
// que se cachea: el contenido es inmutable porque la ruta lleva timestamp.

const sharepoint = require("../sharepointService");

const TTL_MS = parseInt(process.env.NOTICIAS_DOC_CACHE_TTL_MS || "900000", 10); // 15 min
const MAX_ENTRIES = parseInt(process.env.NOTICIAS_DOC_CACHE_MAX || "60", 10);

const cache = new Map(); // relativePath -> { html, expiresAt }

function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;
  // Map conserva orden de inserción: el primero es el más antiguo.
  const oldest = cache.keys().next().value;
  cache.delete(oldest);
}

/**
 * Devuelve el HTML del documento, o "" si no se pudo obtener.
 * Nunca lanza: un documento inaccesible no debe romper el render de la noticia.
 */
async function getHtml(relativePath) {
  if (!relativePath) return "";

  const key = sharepoint.normalizeRelativePath(relativePath);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    // Refresca la posición para que el LRU no lo expulse mientras se usa.
    cache.delete(key);
    cache.set(key, hit);
    return hit.html;
  }

  try {
    const { buffer } = await sharepoint.downloadFile(key);
    const html = buffer.toString("utf8");
    cache.set(key, { html, expiresAt: Date.now() + TTL_MS });
    evictIfNeeded();
    return html;
  } catch (err) {
    console.warn(`[Noticias] No se pudo leer el documento renderizado ${key}:`, err.message || err);
    return "";
  }
}

function set(relativePath, html) {
  const key = sharepoint.normalizeRelativePath(relativePath);
  cache.set(key, { html, expiresAt: Date.now() + TTL_MS });
  evictIfNeeded();
}

function clear() {
  cache.clear();
}

module.exports = { getHtml, set, clear };
