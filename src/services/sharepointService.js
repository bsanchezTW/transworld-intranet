require("dotenv").config();
const { ConfidentialClientApplication } = require("@azure/msal-node");
const { Client, ResponseType } = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch");

const CONTENT_ROOT = "Content-Intranet-Transworld/public/content";

const msalConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
    clientSecret: process.env.MS_CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const tokenResponse = await cca.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });

  if (!tokenResponse?.accessToken) {
    throw new Error("No se pudo obtener token de Microsoft Graph.");
  }

  cachedToken = tokenResponse.accessToken;
  tokenExpiresAt = tokenResponse.expiresOn
    ? new Date(tokenResponse.expiresOn).getTime()
    : Date.now() + 3_600_000;

  return cachedToken;
}

async function getGraphClient() {
  const token = await getAccessToken();
  return Client.init({
    authProvider: (done) => done(null, token),
  });
}

function getSiteId() {
  const siteId = process.env.SP_SITE_ID;
  if (!siteId) {
    throw new Error("SP_SITE_ID no está configurado en las variables de entorno.");
  }
  return siteId;
}

/**
 * Ruta relativa dentro de public/content (sin barra inicial).
 */
function normalizeRelativePath(relativePath) {
  if (!relativePath) return "";

  let clean = String(relativePath).trim();

  if (clean.startsWith("/content/")) {
    clean = clean.slice("/content/".length);
  } else if (clean.startsWith("content/")) {
    clean = clean.slice("content/".length);
  }

  clean = clean.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  // Rechazar traversal y segmentos vacíos peligrosos
  const segments = clean.split("/");
  if (
    segments.some((seg) => seg === ".." || seg === "." || seg.includes("\0"))
  ) {
    const err = new Error("Ruta relativa inválida");
    err.statusCode = 400;
    throw err;
  }

  return clean;
}

function toDriveRelativePath(relativePath) {
  const clean = normalizeRelativePath(relativePath);
  return clean ? `${CONTENT_ROOT}/${clean}` : CONTENT_ROOT;
}

/** Codifica cada segmento de ruta para Microsoft Graph (espacios, tildes, etc.). */
function encodeDriveSegments(drivePath) {
  return drivePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildDriveItemPath(relativePath, suffix = "") {
  const drivePath = toDriveRelativePath(relativePath);
  const encoded = encodeDriveSegments(drivePath);
  return `/sites/${getSiteId()}/drive/root:/${encoded}${suffix}`;
}

const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 320 * 1024;

function formatGraphError(err) {
  const body = err?.body || err?.error;
  const detail =
    (typeof body === "string" ? body : body?.message) ||
    err?.message ||
    "Error desconocido en SharePoint";
  return detail;
}

/**
 * Subida por sesión (archivos > 4 MB; límite recomendado de Graph para PUT simple).
 */
async function uploadLargeFile(fileBuffer, cleanRelative) {
  const client = await getGraphClient();
  const itemPath = buildDriveItemPath(cleanRelative);

  const session = await client
    .api(`${itemPath}:/createUploadSession`)
    .post({
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
      },
    });

  const uploadUrl = session.uploadUrl;
  if (!uploadUrl) {
    throw new Error("SharePoint no devolvió URL de subida.");
  }

  const fileSize = fileBuffer.length;
  let offset = 0;
  let lastResponse = null;

  while (offset < fileSize) {
    const chunkEnd = Math.min(offset + UPLOAD_CHUNK_SIZE, fileSize);
    const chunk = fileBuffer.subarray(offset, chunkEnd);
    const rangeEnd = chunkEnd - 1;

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${rangeEnd}/${fileSize}`,
      },
      body: chunk,
    });

    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Error en subida por fragmentos (${res.status}): ${text || res.statusText}`,
      );
    }

    const data = await res.json().catch(() => null);
    if (data?.id) {
      lastResponse = data;
    }
    offset = chunkEnd;
  }

  if (!lastResponse?.id) {
    throw new Error("La subida a SharePoint no devolvió el archivo final.");
  }

  return lastResponse;
}

/**
 * Sube un archivo a SharePoint en la ruta relativa indicada (incluye nombre de archivo).
 */
async function uploadFile(fileBuffer, relativePath) {
  if (!fileBuffer || !fileBuffer.length) {
    throw new Error("Buffer de archivo vacío.");
  }

  const cleanRelative = normalizeRelativePath(relativePath);
  if (!cleanRelative) {
    throw new Error("Ruta de archivo inválida para SharePoint.");
  }

  console.log(
    `[SharePoint] Subiendo (${fileBuffer.length} bytes): ${cleanRelative}`,
  );

  try {
    let response;

    if (fileBuffer.length <= SIMPLE_UPLOAD_MAX_BYTES) {
      const client = await getGraphClient();
      const apiPath = buildDriveItemPath(cleanRelative, ":/content");
      response = await client.api(apiPath).put(fileBuffer);
    } else {
      response = await uploadLargeFile(fileBuffer, cleanRelative);
    }

    return {
      sharepointId: response.id,
      webUrl: response.webUrl,
      relativePath: cleanRelative,
    };
  } catch (err) {
    const detail = formatGraphError(err);
    console.error("[SharePoint] Error al subir:", detail);
    const wrapped = new Error(detail);
    wrapped.statusCode = err?.statusCode;
    throw wrapped;
  }
}

/**
 * Descarga el contenido de un archivo desde SharePoint.
 */
async function downloadFile(relativePath) {
  const cleanRelative = normalizeRelativePath(relativePath);
  const client = await getGraphClient();
  const apiPath = buildDriveItemPath(cleanRelative, ":/content");

  const data = await client
    .api(apiPath)
    .responseType(ResponseType.ARRAYBUFFER)
    .get();
  const buffer = Buffer.from(data);

  let contentType = "application/octet-stream";
  try {
    const meta = await client
      .api(buildDriveItemPath(cleanRelative))
      .select("file")
      .get();
    if (meta?.file?.mimeType) {
      contentType = meta.file.mimeType;
    }
  } catch {
    // fallback al tipo genérico
  }

  return { buffer, contentType, relativePath: cleanRelative };
}

/**
 * Miniatura generada por SharePoint/Graph (útil cuando el rasterizado local
 * de un PDF falla). Devuelve null si Graph no tiene thumbnail.
 */
async function downloadThumbnail(relativePath, size = "large") {
  const cleanRelative = normalizeRelativePath(relativePath);
  if (!cleanRelative) return null;

  const allowed = new Set(["small", "medium", "large"]);
  const thumbSize = allowed.has(size) ? size : "large";

  try {
    const client = await getGraphClient();
    const data = await client
      .api(buildDriveItemPath(cleanRelative, `:/thumbnails/0/${thumbSize}/content`))
      .responseType(ResponseType.ARRAYBUFFER)
      .get();
    const buffer = Buffer.from(data);
    if (!buffer.length) return null;
    return { buffer, contentType: "image/jpeg", relativePath: cleanRelative };
  } catch (err) {
    if (err.statusCode === 404) return null;
    console.warn(
      `[SharePoint] Sin miniatura para ${cleanRelative}:`,
      err.message || err,
    );
    return null;
  }
}

/**
 * Elimina un archivo en SharePoint por ruta relativa o URL pública /content/...
 */
async function deleteFile(relativePathOrUrl) {
  if (!relativePathOrUrl) return false;

  const cleanRelative = normalizeRelativePath(relativePathOrUrl);
  if (!cleanRelative) return false;

  try {
    const client = await getGraphClient();
    await client.api(buildDriveItemPath(cleanRelative)).delete();
    console.log(`[SharePoint] Eliminado: ${cleanRelative}`);
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    console.error("[SharePoint] Error al eliminar archivo:", err.message || err);
    return false;
  }
}

async function listChildren(folderRelative, { limit } = {}) {
  const folderPath = normalizeRelativePath(folderRelative);
  const client = await getGraphClient();
  const apiPath = folderPath
    ? buildDriveItemPath(folderPath, ":/children")
    : `/sites/${getSiteId()}/drive/root:/${CONTENT_ROOT}:/children`;

  let request = client.api(apiPath);
  if (limit) {
    request = request.top(limit);
  }

  const response = await request.get();
  return response.value || [];
}

/**
 * Lista recursivamente todos los archivos bajo una carpeta.
 */
async function listFilesRecursive(folderRelative) {
  const base = normalizeRelativePath(folderRelative);
  const results = [];

  async function walk(currentFolder) {
    let children;
    try {
      children = await listChildren(currentFolder);
    } catch (err) {
      if (err.statusCode === 404) return;
      throw err;
    }

    for (const item of children) {
      const itemPath = currentFolder ? `${currentFolder}/${item.name}` : item.name;

      if (item.folder) {
        await walk(itemPath);
      } else {
        results.push({
          name: item.name,
          relativePath: itemPath,
          created_at: item.createdDateTime ? new Date(item.createdDateTime) : new Date(),
          size: item.size || 0,
          sharepointId: item.id,
          webUrl: item.webUrl,
        });
      }
    }
  }

  await walk(base);
  return results;
}

/**
 * Lista solo archivos directos de una carpeta (sin subcarpetas anidadas).
 */
async function listFilesInFolder(folderRelative, { limit } = {}) {
  const base = normalizeRelativePath(folderRelative);
  let children;

  try {
    children = await listChildren(base, { limit });
  } catch (err) {
    if (err.statusCode === 404) return [];
    throw err;
  }

  return children
    .filter((item) => !item.folder)
    .map((item) => {
      const relativePath = base ? `${base}/${item.name}` : item.name;
      return {
        name: item.name,
        relativePath,
        created_at: item.createdDateTime ? new Date(item.createdDateTime) : new Date(),
        size: item.size || 0,
        sharepointId: item.id,
        webUrl: item.webUrl,
      };
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit || undefined);
}

/**
 * Elimina todos los archivos bajo una carpeta (recursivo).
 */
async function deleteFolder(folderRelative) {
  const files = await listFilesRecursive(folderRelative);
  let deleted = false;

  for (const file of files) {
    const ok = await deleteFile(file.relativePath);
    if (ok) deleted = true;
  }

  return deleted;
}

module.exports = {
  CONTENT_ROOT,
  normalizeRelativePath,
  uploadFile,
  downloadFile,
  downloadThumbnail,
  deleteFile,
  deleteFolder,
  listFilesInFolder,
  listFilesRecursive,
  getGraphClient,
};
