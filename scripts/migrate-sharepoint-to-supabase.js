#!/usr/bin/env node
"use strict";

/**
 * Migracion one-shot de Content-Intranet-Transworld/public/content desde
 * SharePoint hacia un bucket privado de Supabase Storage.
 *
 * Propiedades deliberadas de esta herramienta:
 * - Microsoft Graph se consume por REST, sin importar el servicio/SDK del runtime.
 * - Se sigue cada @odata.nextLink y se excluye solo el prefijo raiz `eventos/`.
 * - Cada origen se descarga a disco temporal y se calcula SHA-256 en streaming.
 * - Archivos > 6 MiB usan TUS en fragmentos reanudables de 6 MiB.
 * - El journal atomico permite continuar una sesion interrumpida.
 * - Nunca se pisa un objeto distinto salvo con --on-conflict=overwrite.
 * - La verificacion final compara el SHA-256 de origen y destino.
 *
 * Ejemplos:
 *   node scripts/migrate-sharepoint-to-supabase.js --country=CL --dry-run
 *   node scripts/migrate-sharepoint-to-supabase.js --country=CL
 *   node scripts/migrate-sharepoint-to-supabase.js --country=PE \
 *     --journal=.migration/sharepoint-pe.journal.json
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  assertCountrySupabaseProject,
} = require("../src/config/supabaseProjects");

const CONTENT_ROOT = "Content-Intranet-Transworld/public/content";
const EXCLUDED_ROOT_PREFIX = "eventos/";
const DEFAULT_BUCKET = "intranet-content";
const STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const JOURNAL_VERSION = 1;
const MANIFEST_VERSION = 1;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const MIME_BY_EXTENSION = new Map([
  [".avif", "image/avif"],
  [".avi", "video/x-msvideo"],
  [".bmp", "image/bmp"],
  [".csv", "text/csv; charset=utf-8"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".m4v", "video/x-m4v"],
  [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xml", "application/xml"],
  [".zip", "application/zip"],
]);

function inferMimeType(filePath, graphMimeType) {
  const fromGraph = String(graphMimeType || "").trim();
  if (fromGraph) return fromGraph;
  return MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function normalizeRelativePath(value) {
  if (value === null || value === undefined) return "";
  let clean = String(value).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (clean.startsWith("/content/")) clean = clean.slice("/content/".length);
  if (clean.startsWith("content/")) clean = clean.slice("content/".length);

  const segments = clean.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`Ruta relativa invalida: ${value}`);
  }
  return clean;
}

/** Excluye exactamente la carpeta raiz eventos y sus descendientes. */
function isExcludedRootPath(relativePath, isFolder = false) {
  const clean = normalizeRelativePath(relativePath);
  return clean.startsWith(EXCLUDED_ROOT_PREFIX) || (isFolder && clean === "eventos");
}

function encodePathSegments(value) {
  return String(value)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt, response, { baseDelayMs = 500, maxDelayMs = 30_000, random = Math.random } = {}) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(maxDelayMs, Math.max(0, seconds * 1000));
    const absolute = Date.parse(retryAfter);
    if (Number.isFinite(absolute)) return Math.min(maxDelayMs, Math.max(0, absolute - Date.now()));
  }

  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exponential * (0.75 + random() * 0.5));
}

async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    fetchImpl = fetch,
    retries = 5,
    sleepImpl = sleep,
    label = String(url),
    retryableStatuses = RETRYABLE_STATUSES,
    onRetry,
    timeoutMs,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error(`Timeout: ${label}`)), timeoutMs)
      : null;
    const signal = controller && init.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([controller.signal, init.signal])
      : controller?.signal || init.signal;
    try {
      const response = await fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });
      if (timeout) clearTimeout(timeout);
      if (!retryableStatuses.has(response.status) || attempt === retries) return response;

      const waitMs = retryDelayMs(attempt, response, options);
      await response.body?.cancel?.().catch(() => {});
      onRetry?.({ attempt: attempt + 1, waitMs, status: response.status, label });
      await sleepImpl(waitMs);
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) throw error;
      const waitMs = retryDelayMs(attempt, null, options);
      onRetry?.({ attempt: attempt + 1, waitMs, error, label });
      await sleepImpl(waitMs);
    }
  }
  throw lastError || new Error(`Fallo de red: ${label}`);
}

async function responseError(response, label) {
  const body = await response.text().catch(() => "");
  let responseJson = null;
  try {
    responseJson = body ? JSON.parse(body) : null;
  } catch {
    // Algunos endpoints devuelven texto/HTML; el mensaje original sigue siendo util.
  }
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 1000);
  const error = new Error(`${label}: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  error.statusCode = response.status;
  error.responseBody = detail;
  error.responseJson = responseJson;
  return error;
}

async function writeJsonAtomic(filePath, data) {
  const absolute = path.resolve(filePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await fsp.writeFile(temporary, json, { encoding: "utf8", mode: 0o600 });
  try {
    await fsp.rename(temporary, absolute);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function deepMerge(base, patch) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(base[key], value)
      : value;
  }
  return result;
}

class MigrationJournal {
  constructor(filePath, identity) {
    this.filePath = path.resolve(filePath);
    this.identity = identity;
    this.data = null;
    this.writeChain = Promise.resolve();
  }

  async load() {
    let existing = null;
    try {
      existing = JSON.parse(await fsp.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Journal invalido (${this.filePath}): ${error.message}`);
    }

    if (existing) {
      if (existing.version !== JOURNAL_VERSION) {
        throw new Error(`Version de journal no soportada: ${existing.version}`);
      }
      for (const [key, expected] of Object.entries(this.identity)) {
        if (existing.identity?.[key] !== expected) {
          throw new Error(`El journal pertenece a otro destino/origen (${key}). Usa otra ruta --journal.`);
        }
      }
      this.data = existing;
    } else {
      const now = new Date().toISOString();
      this.data = {
        version: JOURNAL_VERSION,
        identity: { ...this.identity },
        startedAt: now,
        updatedAt: now,
        files: {},
      };
    }
    return this;
  }

  get(relativePath) {
    return this.data?.files?.[relativePath] || null;
  }

  async update(relativePath, patch) {
    if (!this.data) throw new Error("Journal no inicializado");
    const previous = this.data.files[relativePath] || {};
    this.data.files[relativePath] = deepMerge(previous, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.data.updatedAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.writeChain = this.writeChain.then(() => writeJsonAtomic(this.filePath, snapshot));
    await this.writeChain;
    return this.data.files[relativePath];
  }

  async flush() {
    await this.writeChain;
    await writeJsonAtomic(this.filePath, this.data);
  }
}

class GraphSource {
  constructor(config, dependencies = {}) {
    this.tenantId = config.tenantId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.siteId = config.siteId;
    this.contentRoot = config.contentRoot || CONTENT_ROOT;
    this.fetch = dependencies.fetchImpl || fetch;
    this.sleep = dependencies.sleepImpl || sleep;
    this.retries = config.retries ?? 5;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15 * 60_000;
    this.logger = dependencies.logger || console;
    this.hasCustomTokenProvider = Boolean(dependencies.tokenProvider);
    this.tokenProvider = dependencies.tokenProvider || (() => this.acquireToken());
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async acquireToken(force = false) {
    if (!force && this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const url = `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }, this.retryOptions("OAuth Microsoft"));

    if (!response.ok) throw await responseError(response, "OAuth Microsoft");
    const payload = await response.json();
    if (!payload.access_token) throw new Error("Microsoft no devolvio access_token");
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    return this.token;
  }

  retryOptions(label) {
    return {
      fetchImpl: this.fetch,
      sleepImpl: this.sleep,
      retries: this.retries,
      timeoutMs: this.requestTimeoutMs,
      label,
      onRetry: ({ attempt, waitMs, status, error }) => {
        this.logger.warn?.(`[retry] ${label}; intento ${attempt}; espera ${waitMs} ms; ${status || error?.message || "red"}`);
      },
    };
  }

  async graphJson(urlOrPath, { refreshOnUnauthorized = true } = {}) {
    const url = /^https?:\/\//i.test(urlOrPath)
      ? urlOrPath
      : `https://graph.microsoft.com/v1.0${urlOrPath}`;
    const token = await this.tokenProvider();
    let response = await fetchWithRetry(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    }, this.retryOptions(`Graph GET ${new URL(url).pathname}`));

    if (response.status === 401 && refreshOnUnauthorized && !this.hasCustomTokenProvider) {
      await this.acquireToken(true);
      return this.graphJson(url, { refreshOnUnauthorized: false });
    }
    if (!response.ok) throw await responseError(response, `Graph GET ${new URL(url).pathname}`);
    return response.json();
  }

  childrenUrl(itemId = null) {
    const site = encodeURIComponent(this.siteId);
    const select = "id,name,size,file,folder,createdDateTime,lastModifiedDateTime,eTag";
    if (itemId) {
      return `/sites/${site}/drive/items/${encodeURIComponent(itemId)}/children?$top=200&$select=${encodeURIComponent(select)}`;
    }
    const root = encodePathSegments(this.contentRoot);
    return `/sites/${site}/drive/root:/${root}:/children?$top=200&$select=${encodeURIComponent(select)}`;
  }

  async listAllPages(firstUrl) {
    const values = [];
    let next = firstUrl;
    while (next) {
      const page = await this.graphJson(next);
      if (!Array.isArray(page.value)) throw new Error("Graph devolvio una pagina sin value[]");
      values.push(...page.value);
      next = page["@odata.nextLink"] || null;
    }
    return values;
  }

  async listFiles() {
    const files = [];
    const folders = [{ id: null, relativePath: "" }];

    for (let index = 0; index < folders.length; index += 1) {
      const folder = folders[index];
      const children = await this.listAllPages(this.childrenUrl(folder.id));
      for (const item of children) {
        if (!item?.name || !item?.id) continue;
        const relativePath = normalizeRelativePath(
          folder.relativePath ? `${folder.relativePath}/${item.name}` : item.name,
        );

        if (item.folder) {
          if (!isExcludedRootPath(relativePath, true)) folders.push({ id: item.id, relativePath });
          continue;
        }
        if (isExcludedRootPath(relativePath, false)) continue;
        if (!item.file) continue;

        files.push({
          id: item.id,
          relativePath,
          size: Number(item.size || 0),
          contentType: inferMimeType(relativePath, item.file.mimeType),
          eTag: item.eTag || null,
          createdAt: item.createdDateTime || null,
          lastModifiedAt: item.lastModifiedDateTime || null,
        });
      }
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
    return files;
  }

  async getItem(itemId) {
    const site = encodeURIComponent(this.siteId);
    const select = encodeURIComponent("id,name,size,file,eTag,lastModifiedDateTime");
    return this.graphJson(`/sites/${site}/drive/items/${encodeURIComponent(itemId)}?$select=${select}`);
  }

  async downloadToFile(item, destinationPath) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Timeout de descarga Graph")), this.requestTimeoutMs);
      try {
        const token = await this.tokenProvider();
        const site = encodeURIComponent(this.siteId);
        const url = `https://graph.microsoft.com/v1.0/sites/${site}/drive/items/${encodeURIComponent(item.id)}/content`;
        const response = await this.fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          redirect: "follow",
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = await responseError(response, `Descarga Graph ${item.relativePath}`);
          if (!RETRYABLE_STATUSES.has(response.status) || attempt === this.retries) throw error;
          throw error;
        }
        if (!response.body) throw new Error(`Graph no devolvio contenido para ${item.relativePath}`);

        const hash = crypto.createHash("sha256");
        let bytes = 0;
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destinationPath, { flags: "w" }));
        clearTimeout(timeout);

        if (bytes !== item.size) {
          throw new Error(`Tamano de Graph cambio para ${item.relativePath}: listado=${item.size}, descargado=${bytes}`);
        }
        const current = await this.getItem(item.id);
        if ((item.eTag && current.eTag !== item.eTag) || Number(current.size || 0) !== bytes) {
          const error = new Error(`El origen cambio durante la migracion: ${item.relativePath}. Congela escrituras y reejecuta.`);
          error.code = "SOURCE_CHANGED";
          throw error;
        }
        return { size: bytes, sha256: hash.digest("hex") };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        await fsp.rm(destinationPath, { force: true }).catch(() => {});
        if (error.code === "SOURCE_CHANGED" || attempt === this.retries) throw error;
        if (error.statusCode && !RETRYABLE_STATUSES.has(error.statusCode) && error.statusCode !== 401) throw error;
        if (error.statusCode === 401 && !this.hasCustomTokenProvider) await this.acquireToken(true);
        const waitMs = retryDelayMs(attempt);
        this.logger.warn?.(`[retry] descarga ${item.relativePath}; intento ${attempt + 1}; espera ${waitMs} ms; ${error.message}`);
        await this.sleep(waitMs);
      }
    }
    throw lastError;
  }
}

function storageMetadata(info) {
  return info?.metadata && typeof info.metadata === "object" ? info.metadata : {};
}

function storageSize(info) {
  const metadata = storageMetadata(info);
  const value = info?.size ?? metadata.size ?? metadata.contentLength ?? metadata.content_length;
  return Number(value);
}

function storageEtag(info) {
  const metadata = storageMetadata(info);
  return info?.etag || metadata.eTag || metadata.etag || null;
}

function storageSourceHash(info) {
  const metadata = storageMetadata(info);
  return info?.source_sha256 || metadata.source_sha256 || metadata.sourceSha256 || null;
}

function encodeTusMetadata(metadata) {
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key} ${Buffer.from(String(value), "utf8").toString("base64")}`)
    .join(",");
}

class SupabaseDestination {
  constructor(config, dependencies = {}) {
    this.supabaseUrl = String(config.supabaseUrl).replace(/\/+$/, "");
    this.secretKey = config.secretKey;
    this.bucket = config.bucket || DEFAULT_BUCKET;
    this.retries = config.retries ?? 5;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15 * 60_000;
    this.standardUploadMaxBytes = config.standardUploadMaxBytes ?? STANDARD_UPLOAD_MAX_BYTES;
    this.tusChunkSize = config.tusChunkSize ?? TUS_CHUNK_SIZE;
    this.fetch = dependencies.fetchImpl || fetch;
    this.sleep = dependencies.sleepImpl || sleep;
    this.logger = dependencies.logger || console;
    this.storageApiUrl = `${this.supabaseUrl}/storage/v1`;
    this.tusEndpoint = config.tusEndpoint || this.buildTusEndpoint();
  }

  buildTusEndpoint() {
    const parsed = new URL(this.supabaseUrl);
    if (/^[^.]+\.supabase\.co$/i.test(parsed.hostname)) {
      const projectRef = parsed.hostname.split(".")[0];
      parsed.hostname = `${projectRef}.storage.supabase.co`;
    }
    parsed.pathname = "/storage/v1/upload/resumable";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }

  headers(extra = {}) {
    const authentication = { apikey: this.secretKey };
    // Las nuevas sb_secret_* no son JWT. Supabase las recibe en `apikey` y
    // rechaza tratarlas como Bearer; service_role legacy conserva Bearer.
    if (!String(this.secretKey).startsWith("sb_secret_")) {
      authentication.authorization = `Bearer ${this.secretKey}`;
    }
    return { ...authentication, ...extra };
  }

  retryOptions(label) {
    return {
      fetchImpl: this.fetch,
      sleepImpl: this.sleep,
      retries: this.retries,
      timeoutMs: this.requestTimeoutMs,
      label,
      onRetry: ({ attempt, waitMs, status, error }) => {
        this.logger.warn?.(`[retry] ${label}; intento ${attempt}; espera ${waitMs} ms; ${status || error?.message || "red"}`);
      },
    };
  }

  objectPath(relativePath) {
    return `${encodeURIComponent(this.bucket)}/${encodePathSegments(normalizeRelativePath(relativePath))}`;
  }

  async getBucket() {
    const response = await fetchWithRetry(
      `${this.storageApiUrl}/bucket/${encodeURIComponent(this.bucket)}`,
      { headers: this.headers({ accept: "application/json" }) },
      this.retryOptions("Supabase bucket info"),
    );
    if (!response.ok) throw await responseError(response, `Bucket ${this.bucket}`);
    return response.json();
  }

  async assertBucketReady(maxSourceBytes = 0) {
    const bucket = await this.getBucket();
    if (bucket.public === true) throw new Error(`El bucket ${this.bucket} es publico; la migracion exige bucket privado.`);
    const limit = bucket.file_size_limit ?? bucket.fileSizeLimit;
    if (limit !== null && limit !== undefined && Number(limit) < maxSourceBytes) {
      throw new Error(
        `El bucket limita archivos a ${limit} bytes, pero el origen contiene ${maxSourceBytes}. Ajusta file_size_limit antes de migrar.`,
      );
    }
    return bucket;
  }

  async info(relativePath) {
    const response = await fetchWithRetry(
      `${this.storageApiUrl}/object/info/${this.objectPath(relativePath)}`,
      { headers: this.headers({ accept: "application/json" }) },
      this.retryOptions(`Supabase info ${relativePath}`),
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = await responseError(response, `Supabase info ${relativePath}`);
      // Storage puede responder HTTP 400 aunque el error semantico sea 404.
      // Se limita al codigo NoSuchKey para no ocultar otros Bad Request.
      if (
        response.status === 400 &&
        String(error.responseJson?.statusCode) === "404" &&
        error.responseJson?.code === "NoSuchKey"
      ) {
        return null;
      }
      throw error;
    }
    return response.json();
  }

  async hashObject(relativePath) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Timeout de descarga Supabase")), this.requestTimeoutMs);
      try {
        const nonce = crypto.randomUUID();
        const response = await this.fetch(
          `${this.storageApiUrl}/object/${this.objectPath(relativePath)}?cacheNonce=${nonce}`,
          {
            headers: this.headers({ "cache-control": "no-cache" }),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw await responseError(response, `Supabase download ${relativePath}`);
        if (!response.body) throw new Error(`Supabase no devolvio contenido para ${relativePath}`);

        const hash = crypto.createHash("sha256");
        let size = 0;
        for await (const chunk of Readable.fromWeb(response.body)) {
          size += chunk.length;
          hash.update(chunk);
        }
        clearTimeout(timeout);
        return { size, sha256: hash.digest("hex") };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (attempt === this.retries) throw error;
        if (error.statusCode && !RETRYABLE_STATUSES.has(error.statusCode)) throw error;
        const waitMs = retryDelayMs(attempt);
        this.logger.warn?.(`[retry] verificacion ${relativePath}; intento ${attempt + 1}; espera ${waitMs} ms; ${error.message}`);
        await this.sleep(waitMs);
      }
    }
    throw lastError;
  }

  uploadMetadata(item, sourceHash) {
    return {
      source_sha256: sourceHash,
      source_etag: item.eTag || "",
      source: "microsoft-sharepoint",
    };
  }

  async uploadStandard(tempPath, item, sourceHash, upsert) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`Timeout de upload ${item.relativePath}`)),
        this.requestTimeoutMs,
      );
      try {
        const response = await this.fetch(
          `${this.storageApiUrl}/object/${this.objectPath(item.relativePath)}`,
          {
            method: "POST",
            headers: this.headers({
              "cache-control": "max-age=3600",
              "content-length": String(item.size),
              "content-type": item.contentType,
              "x-metadata": Buffer.from(JSON.stringify(this.uploadMetadata(item, sourceHash))).toString("base64"),
              "x-upsert": String(Boolean(upsert)),
            }),
            body: fs.createReadStream(tempPath),
            duplex: "half",
            signal: controller.signal,
          },
        );
        clearTimeout(timeout);
        if (response.ok) return response.json().catch(() => ({}));

        const error = await responseError(response, `Supabase upload ${item.relativePath}`);
        lastError = error;
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === this.retries) throw error;
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (attempt === this.retries || (error.statusCode && !RETRYABLE_STATUSES.has(error.statusCode))) throw error;
      }
      const waitMs = retryDelayMs(attempt);
      this.logger.warn?.(`[retry] upload ${item.relativePath}; intento ${attempt + 1}; espera ${waitMs} ms; ${lastError.message}`);
      await this.sleep(waitMs);
    }
    throw lastError;
  }

  async tusHead(uploadUrl) {
    const response = await fetchWithRetry(uploadUrl, {
      method: "HEAD",
      headers: this.headers({ "tus-resumable": "1.0.0" }),
    }, this.retryOptions("TUS HEAD"));
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw await responseError(response, "TUS HEAD");
    const offset = Number(response.headers.get("upload-offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("TUS HEAD sin Upload-Offset valido");
    return { offset, length: Number(response.headers.get("upload-length")) };
  }

  async createTusUpload(item, sourceHash, upsert) {
    const metadata = {
      bucketName: this.bucket,
      objectName: normalizeRelativePath(item.relativePath),
      contentType: item.contentType,
      cacheControl: "3600",
      metadata: JSON.stringify(this.uploadMetadata(item, sourceHash)),
    };
    const response = await fetchWithRetry(this.tusEndpoint, {
      method: "POST",
      headers: this.headers({
        "tus-resumable": "1.0.0",
        "upload-length": String(item.size),
        "upload-metadata": encodeTusMetadata(metadata),
        "x-upsert": String(Boolean(upsert)),
      }),
    }, this.retryOptions(`TUS create ${item.relativePath}`));

    if (!response.ok) throw await responseError(response, `TUS create ${item.relativePath}`);
    const location = response.headers.get("location");
    if (!location) throw new Error(`TUS no devolvio Location para ${item.relativePath}`);
    return new URL(location, this.tusEndpoint).toString();
  }

  async uploadTus(tempPath, item, sourceHash, upsert, resume = {}, onProgress = async () => {}) {
    let uploadUrl = resume?.sourceSha256 === sourceHash && resume?.sourceSize === item.size && resume?.upsert === upsert
      ? resume.url
      : null;
    let state = null;
    if (uploadUrl) state = await this.tusHead(uploadUrl).catch(() => null);
    if (!state || (Number.isFinite(state.length) && state.length !== item.size)) {
      uploadUrl = await this.createTusUpload(item, sourceHash, upsert);
      state = { offset: 0, length: item.size };
      await onProgress({ url: uploadUrl, offset: 0, sourceSha256: sourceHash, sourceSize: item.size, upsert });
    }

    let offset = state.offset;
    const file = await fsp.open(tempPath, "r");
    try {
      while (offset < item.size) {
        const length = Math.min(this.tusChunkSize, item.size - offset);
        const buffer = Buffer.allocUnsafe(length);
        let totalRead = 0;
        while (totalRead < length) {
          const { bytesRead } = await file.read(
            buffer,
            totalRead,
            length - totalRead,
            offset + totalRead,
          );
          if (bytesRead === 0) break;
          totalRead += bytesRead;
        }
        if (totalRead !== length) throw new Error(`Lectura temporal incompleta para ${item.relativePath}`);

        let chunkComplete = false;
        let lastError;
        for (let attempt = 0; attempt <= this.retries && !chunkComplete; attempt += 1) {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(new Error(`Timeout TUS PATCH ${item.relativePath}`)),
            this.requestTimeoutMs,
          );
          try {
            const response = await this.fetch(uploadUrl, {
              method: "PATCH",
              headers: this.headers({
                "content-length": String(length),
                "content-type": "application/offset+octet-stream",
                "tus-resumable": "1.0.0",
                "upload-offset": String(offset),
              }),
              body: buffer,
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (response.ok) {
              const nextOffset = Number(response.headers.get("upload-offset"));
              if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > item.size) {
                throw new Error(`TUS PATCH devolvio Upload-Offset invalido para ${item.relativePath}`);
              }
              offset = nextOffset;
              chunkComplete = true;
              break;
            }
            lastError = await responseError(response, `TUS PATCH ${item.relativePath}`);
            if (!RETRYABLE_STATUSES.has(response.status)) throw lastError;
          } catch (error) {
            clearTimeout(timeout);
            lastError = error;
            if (error.statusCode && !RETRYABLE_STATUSES.has(error.statusCode)) throw error;
          }

          const remote = await this.tusHead(uploadUrl).catch(() => null);
          if (!remote) {
            uploadUrl = await this.createTusUpload(item, sourceHash, upsert);
            offset = 0;
            await onProgress({ url: uploadUrl, offset, sourceSha256: sourceHash, sourceSize: item.size, upsert });
            chunkComplete = true;
            break;
          }
          if (remote.offset > offset) {
            offset = remote.offset;
            chunkComplete = true;
            break;
          }
          if (attempt === this.retries) throw lastError || new Error(`TUS fallo para ${item.relativePath}`);
          await this.sleep(retryDelayMs(attempt));
        }
        await onProgress({ url: uploadUrl, offset, sourceSha256: sourceHash, sourceSize: item.size, upsert });
      }
    } finally {
      await file.close();
    }
    return { uploadUrl, offset };
  }

  async uploadFile(tempPath, item, sourceHash, { upsert = false, resume, onProgress } = {}) {
    if (item.size > this.standardUploadMaxBytes) {
      return this.uploadTus(tempPath, item, sourceHash, upsert, resume, onProgress);
    }
    return this.uploadStandard(tempPath, item, sourceHash, upsert);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

function journalSourceMatches(entry, item) {
  return Boolean(
    entry?.source?.sha256 &&
    item.eTag &&
    Number(entry.source.size) === item.size &&
    (entry.source.eTag || null) === (item.eTag || null),
  );
}

function infoIdentity(info) {
  if (!info) return null;
  return { size: storageSize(info), etag: storageEtag(info) };
}

async function inspectExisting(destination, item, sourceHash, knownHash = null) {
  const info = await destination.info(item.relativePath);
  if (!info) return { exists: false, info: null, hash: null, matches: false };
  if (storageSize(info) !== item.size) return { exists: true, info, hash: null, matches: false };

  const metadataHash = storageSourceHash(info);
  if (metadataHash === sourceHash) {
    return { exists: true, info, hash: sourceHash, matches: true, trustedMetadata: true };
  }
  if (knownHash?.sha256 && knownHash?.etag && knownHash.etag === storageEtag(info)) {
    return { exists: true, info, hash: knownHash.sha256, matches: knownHash.sha256 === sourceHash };
  }
  const actual = await destination.hashObject(item.relativePath);
  return { exists: true, info, hash: actual.sha256, matches: actual.size === item.size && actual.sha256 === sourceHash };
}

function tempNameFor(item) {
  return `${crypto.createHash("sha256").update(item.relativePath).digest("hex")}.bin`;
}

async function migrateOne({ item, source, destination, journal, tempDir, dryRun, onConflict, logger }) {
  const previous = journal.get(item.relativePath);
  if (!dryRun && previous?.status === "verified" && journalSourceMatches(previous, item)) {
    const info = await destination.info(item.relativePath);
    if (
      info &&
      storageSize(info) === item.size &&
      ((previous.destination?.etag && previous.destination.etag === storageEtag(info)) || storageSourceHash(info) === previous.source.sha256)
    ) {
      return {
        path: item.relativePath,
        size: item.size,
        sha256: previous.source.sha256,
        contentType: item.contentType,
        sourceEtag: item.eTag,
        status: "ready-to-verify",
        action: "journal-skip",
        priorDestinationHash: {
          sha256: previous.destination.sha256,
          etag: previous.destination.etag,
        },
      };
    }
  }

  const tempPath = path.join(tempDir, tempNameFor(item));
  try {
    await journal.update(item.relativePath, {
      status: "downloading",
      source: { size: item.size, eTag: item.eTag, contentType: item.contentType },
      error: null,
    });
    const downloaded = await source.downloadToFile(item, tempPath);
    await journal.update(item.relativePath, {
      status: "downloaded",
      source: { sha256: downloaded.sha256 },
    });

    if (dryRun) {
      await journal.update(item.relativePath, {
        status: "dry-run",
        action: "source-manifest-only",
        destination: null,
      });
      return {
        path: item.relativePath,
        size: item.size,
        sha256: downloaded.sha256,
        contentType: item.contentType,
        sourceEtag: item.eTag,
        status: "dry-run",
        action: "source-manifest-only",
        destinationSha256: null,
      };
    }

    const existing = await inspectExisting(
      destination,
      item,
      downloaded.sha256,
      previous?.destination ? { sha256: previous.destination.sha256, etag: previous.destination.etag } : null,
    );
    if (existing.matches) {
      await journal.update(item.relativePath, {
        status: "ready-to-verify",
        action: "existing-match",
        destination: { ...infoIdentity(existing.info), sha256: existing.hash },
      });
      return {
        path: item.relativePath,
        size: item.size,
        sha256: downloaded.sha256,
        contentType: item.contentType,
        sourceEtag: item.eTag,
        status: "ready-to-verify",
        action: "existing-match",
        priorDestinationHash: { sha256: existing.hash, etag: storageEtag(existing.info) },
      };
    }

    if (existing.exists && onConflict !== "overwrite") {
      const error = new Error(
        `Conflicto en ${item.relativePath}: el destino existe con contenido distinto. ` +
        "Revisa el objeto o reejecuta explicitamente con --on-conflict=overwrite.",
      );
      error.code = "DESTINATION_CONFLICT";
      throw error;
    }

    const upsert = existing.exists;
    let overwrittenDuringRace = false;
    const resume = previous?.upload || null;
    await journal.update(item.relativePath, {
      status: "uploading",
      action: upsert ? "overwrite" : "upload",
    });

    try {
      await destination.uploadFile(tempPath, item, downloaded.sha256, {
        upsert,
        resume,
        onProgress: async (upload) => journal.update(item.relativePath, { status: "uploading", upload }),
      });
    } catch (uploadError) {
      // Si se perdio la respuesta luego de completar, una verificacion evita
      // reescribir o reportar un falso fallo.
      const afterFailure = await inspectExisting(destination, item, downloaded.sha256).catch(() => null);
      if (!afterFailure?.matches) {
        if (afterFailure?.exists && onConflict === "overwrite" && !upsert) {
          // Carrera: el path no existia al hacer stat, pero otro proceso creo
          // contenido distinto. Solo el modo explicito overwrite puede pisarlo.
          await destination.uploadFile(tempPath, item, downloaded.sha256, {
            upsert: true,
            resume: null,
            onProgress: async (upload) => journal.update(item.relativePath, { status: "uploading", upload }),
          });
          overwrittenDuringRace = true;
        } else if (afterFailure?.exists && onConflict !== "overwrite") {
          const conflict = new Error(
            `Conflicto por carrera en ${item.relativePath}: otro proceso creo contenido distinto durante la subida.`,
          );
          conflict.code = "DESTINATION_CONFLICT";
          throw conflict;
        } else {
          throw uploadError;
        }
      }
    }

    const info = await destination.info(item.relativePath);
    if (!info || storageSize(info) !== item.size) {
      throw new Error(`Verificacion de tamano fallo tras subir ${item.relativePath}`);
    }
    await journal.update(item.relativePath, {
      status: "ready-to-verify",
      action: upsert || overwrittenDuringRace ? "overwritten" : "uploaded",
      upload: null,
      destination: { ...infoIdentity(info), sha256: null },
    });
    return {
      path: item.relativePath,
      size: item.size,
      sha256: downloaded.sha256,
      contentType: item.contentType,
      sourceEtag: item.eTag,
      status: "ready-to-verify",
      action: upsert || overwrittenDuringRace ? "overwritten" : "uploaded",
    };
  } catch (error) {
    await journal.update(item.relativePath, {
      status: error.code === "DESTINATION_CONFLICT" ? "conflict" : "failed",
      error: { code: error.code || null, message: error.message },
    });
    logger.error?.(`[fallo] ${item.relativePath}: ${error.message}`);
    return {
      path: item.relativePath,
      size: item.size,
      sha256: journal.get(item.relativePath)?.source?.sha256 || null,
      contentType: item.contentType,
      sourceEtag: item.eTag,
      status: error.code === "DESTINATION_CONFLICT" ? "conflict" : "failed",
      action: null,
      error: error.message,
    };
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function verifyOne(result, destination, journal, logger) {
  if (result.status !== "ready-to-verify") return result;
  try {
    const info = await destination.info(result.path);
    if (!info || storageSize(info) !== result.size) throw new Error("objeto ausente o tamano diferente");

    let actual;
    if (
      result.priorDestinationHash?.sha256 &&
      result.priorDestinationHash.etag &&
      result.priorDestinationHash.etag === storageEtag(info)
    ) {
      actual = { size: result.size, sha256: result.priorDestinationHash.sha256 };
    } else {
      actual = await destination.hashObject(result.path);
    }
    if (actual.size !== result.size || actual.sha256 !== result.sha256) {
      throw new Error(`SHA-256 distinto (origen=${result.sha256}, destino=${actual.sha256})`);
    }

    await journal.update(result.path, {
      status: "verified",
      destination: { ...infoIdentity(info), sha256: actual.sha256 },
      error: null,
    });
    return { ...result, status: "verified", destinationSha256: actual.sha256 };
  } catch (error) {
    await journal.update(result.path, {
      status: "verification-failed",
      error: { code: "VERIFY_FAILED", message: error.message },
    });
    logger.error?.(`[verificacion] ${result.path}: ${error.message}`);
    return { ...result, status: "verification-failed", error: error.message };
  }
}

function buildManifest(config, results) {
  const statuses = {};
  let totalBytes = 0;
  for (const file of results) {
    totalBytes += Number(file.size || 0);
    statuses[file.status] = (statuses[file.status] || 0) + 1;
  }
  return {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    country: config.country,
    source: { provider: "microsoft-sharepoint", root: CONTENT_ROOT },
    destination: config.supabaseUrl
      ? { provider: "supabase-storage", projectHost: new URL(config.supabaseUrl).host, bucket: config.bucket }
      : null,
    exclusions: [EXCLUDED_ROOT_PREFIX],
    totals: { files: results.length, bytes: totalBytes, byStatus: statuses },
    files: results
      .map((file) => ({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        destinationSha256: file.destinationSha256 || null,
        contentType: file.contentType,
        sourceEtag: file.sourceEtag || null,
        action: file.action || null,
        status: file.status,
        error: file.error || null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path, "en")),
  };
}

function valueFromArgs(argv, index, name) {
  const arg = argv[index];
  const prefix = `--${name}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), consumed: 0 };
  if (arg === `--${name}`) {
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Falta valor para --${name}`);
    return { value: argv[index + 1], consumed: 1 };
  }
  return null;
}

function parseArgs(argv) {
  const options = {
    country: null,
    concurrency: 3,
    retries: 5,
    dryRun: false,
    onConflict: "error",
    journalPath: null,
    manifestPath: null,
    requestTimeoutMs: 15 * 60_000,
    help: false,
  };
  const valueNames = new Set(["country", "concurrency", "retries", "on-conflict", "journal", "manifest", "request-timeout-ms"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--source-manifest-only") options.dryRun = true;
    else {
      let matched = false;
      for (const name of valueNames) {
        const parsed = valueFromArgs(argv, index, name);
        if (!parsed) continue;
        matched = true;
        index += parsed.consumed;
        const key = {
          country: "country",
          concurrency: "concurrency",
          retries: "retries",
          "on-conflict": "onConflict",
          journal: "journalPath",
          manifest: "manifestPath",
          "request-timeout-ms": "requestTimeoutMs",
        }[name];
        options[key] = parsed.value;
        break;
      }
      if (!matched) throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  options.country = String(options.country || process.env.COUNTRY || "").trim().toUpperCase();
  if (!options.help && !["CL", "PE"].includes(options.country)) throw new Error("--country=CL o --country=PE es obligatorio");
  options.concurrency = Number(options.concurrency);
  options.retries = Number(options.retries);
  options.requestTimeoutMs = Number(options.requestTimeoutMs);
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16) {
    throw new Error("--concurrency debe ser un entero entre 1 y 16");
  }
  if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 20) {
    throw new Error("--retries debe ser un entero entre 0 y 20");
  }
  if (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs < 1000) {
    throw new Error("--request-timeout-ms debe ser al menos 1000");
  }
  if (!["error", "overwrite"].includes(options.onConflict)) {
    throw new Error("--on-conflict debe ser error u overwrite");
  }
  if (options.country) {
    const modeSuffix = options.dryRun ? ".source-only" : "";
    options.journalPath ||= path.resolve(`.migration/sharepoint-to-supabase-${options.country}${modeSuffix}.journal.json`);
    options.manifestPath ||= path.resolve(`.migration/sharepoint-to-supabase-${options.country}.manifest.json`);
  }
  return options;
}

function firstEnvironmentValue(country, names, { required = true, fallback = null } = {}) {
  for (const name of names) {
    const countryValue = process.env[`${name}_${country}`]?.trim();
    if (countryValue) return countryValue;
  }
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  if (required) throw new Error(`Falta ${names.map((name) => `${name}_${country}/${name}`).join(" o ")}`);
  return fallback;
}

function resolveConfig(options) {
  const country = options.country;
  const supabaseUrl = options.dryRun
    ? null
    : firstEnvironmentValue(country, ["SUPABASE_URL"]);
  if (supabaseUrl) {
    let parsed;
    try {
      parsed = new URL(supabaseUrl);
    } catch {
      throw new Error("SUPABASE_URL no es una URL valida");
    }
    const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      parsed.hostname.toLowerCase(),
    );
    if (parsed.protocol !== "https:" && !isLoopback) {
      throw new Error("SUPABASE_URL debe usar HTTPS; HTTP solo se admite para localhost");
    }
    assertCountrySupabaseProject(supabaseUrl, country, process.env);
  }
  return {
    ...options,
    contentRoot: CONTENT_ROOT,
    tenantId: firstEnvironmentValue(country, ["MS_TENANT_ID"]),
    clientId: firstEnvironmentValue(country, ["MS_CLIENT_ID"]),
    clientSecret: firstEnvironmentValue(country, ["MS_CLIENT_SECRET"]),
    siteId: firstEnvironmentValue(country, ["SP_SITE_ID"]),
    supabaseUrl,
    secretKey: options.dryRun
      ? null
      : firstEnvironmentValue(country, [
          "SUPABASE_SECRET_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ]),
    bucket: firstEnvironmentValue(country, ["SUPABASE_STORAGE_BUCKET"], { required: false, fallback: DEFAULT_BUCKET }),
  };
}

function printHelp() {
  console.log(`
Migra SharePoint a Supabase Storage (omite exactamente eventos/).

Uso:
  node scripts/migrate-sharepoint-to-supabase.js --country=CL [opciones]

Opciones:
  --dry-run                    Lista, descarga y hashea solo el origen; no requiere SUPABASE_*
  --source-manifest-only       Alias explicito de --dry-run; no requiere SUPABASE_*
  --country=CL|PE              Instancia de destino (tambien acepta COUNTRY)
  --concurrency=3              Transferencias simultaneas (1..16)
  --retries=5                  Reintentos con backoff (0..20)
  --on-conflict=error          error (seguro) u overwrite (solo tras comprobar SHA distinto)
  --journal=<ruta>             Journal reanudable (JSON atomico)
  --manifest=<ruta>            Manifiesto final path/size/SHA-256
  --request-timeout-ms=900000  Timeout de una transferencia individual
  --help                       Esta ayuda

Variables (se acepta sufijo _CL/_PE antes del nombre generico):
  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SP_SITE_ID
  SUPABASE_URL, SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY)
  SUPABASE_PROJECT_REF_CL / SUPABASE_PROJECT_REF_PE
  SUPABASE_STORAGE_BUCKET (default: ${DEFAULT_BUCKET})
`);
}

async function runMigration(config, dependencies = {}) {
  const logger = dependencies.logger || console;
  const source = dependencies.source || new GraphSource(config, dependencies);
  const destination = dependencies.destination || (config.dryRun ? null : new SupabaseDestination(config, dependencies));
  const identity = {
    country: config.country,
    sourceRoot: CONTENT_ROOT,
    destinationHost: config.supabaseUrl ? new URL(config.supabaseUrl).host : null,
    bucket: config.bucket,
  };
  const journal = dependencies.journal || await new MigrationJournal(config.journalPath, identity).load();
  const tempDir = dependencies.tempDir || await fsp.mkdtemp(path.join(os.tmpdir(), "tw-storage-migration-"));
  const ownsTempDir = !dependencies.tempDir;

  try {
    logger.log(`[inventario] Listando ${CONTENT_ROOT}; exclusion=${EXCLUDED_ROOT_PREFIX}`);
    const files = await source.listFiles();
    const duplicatePaths = files.filter((file, index) => index > 0 && file.relativePath === files[index - 1].relativePath);
    if (duplicatePaths.length) throw new Error(`Graph devolvio rutas duplicadas: ${duplicatePaths[0].relativePath}`);
    const maxSourceBytes = files.reduce((maximum, file) => Math.max(maximum, file.size), 0);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (destination) await destination.assertBucketReady(maxSourceBytes);
    logger.log(`[inventario] ${files.length} archivos; ${totalBytes} bytes; max=${maxSourceBytes}`);
    logger.log(config.dryRun ? "[modo] DRY RUN: no se escribira en Supabase" : `[modo] migracion; conflictos=${config.onConflict}`);

    let completed = 0;
    const migrated = await mapWithConcurrency(files, config.concurrency, async (item) => {
      const result = await migrateOne({
        item,
        source,
        destination,
        journal,
        tempDir,
        dryRun: config.dryRun,
        onConflict: config.onConflict,
        logger,
      });
      completed += 1;
      logger.log(`[${completed}/${files.length}] ${result.status} ${item.relativePath}`);
      return result;
    });

    const results = config.dryRun
      ? migrated
      : await mapWithConcurrency(migrated, config.concurrency, (result) => verifyOne(result, destination, journal, logger));

    const manifest = buildManifest(config, results);
    await writeJsonAtomic(config.manifestPath, manifest);
    await journal.flush();

    const failures = results.filter((result) => ["failed", "conflict", "verification-failed"].includes(result.status));
    logger.log(`[resultado] ${JSON.stringify(manifest.totals.byStatus)}; manifiesto=${config.manifestPath}`);
    return { files, results, manifest, failures, journalPath: config.journalPath, manifestPath: config.manifestPath };
  } finally {
    if (ownsTempDir) {
      await fsp.rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }).catch(() => {});
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  require("dotenv").config();
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const config = resolveConfig(options);
  if (config.supabaseUrl) {
    console.log(`[destino] country=${config.country}; host=${new URL(config.supabaseUrl).host}; bucket=${config.bucket}`);
  } else {
    console.log(`[origen] country=${config.country}; manifiesto fuente sin destino Supabase`);
  }
  const outcome = await runMigration(config);
  if (outcome.failures.length) {
    const error = new Error(`Migracion incompleta: ${outcome.failures.length} archivo(s) con fallo/conflicto.`);
    error.exitCode = 1;
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[fatal] ${error.message}`);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  CONTENT_ROOT,
  DEFAULT_BUCKET,
  EXCLUDED_ROOT_PREFIX,
  GraphSource,
  MANIFEST_VERSION,
  MigrationJournal,
  STANDARD_UPLOAD_MAX_BYTES,
  SupabaseDestination,
  TUS_CHUNK_SIZE,
  buildManifest,
  deepMerge,
  encodePathSegments,
  encodeTusMetadata,
  fetchWithRetry,
  inferMimeType,
  inspectExisting,
  isExcludedRootPath,
  mapWithConcurrency,
  normalizeRelativePath,
  parseArgs,
  resolveConfig,
  retryDelayMs,
  runMigration,
  storageEtag,
  storageSize,
  storageSourceHash,
  verifyOne,
  writeJsonAtomic,
};
