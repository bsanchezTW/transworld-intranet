// Modelo de adjuntos de noticias — ÚNICA fuente de verdad.
//
// Los adjuntos viven como JSON en news_articles.attachments. Históricamente el
// ítem era { url, public_id, resource_type, tipo, nombre }; el modelo v2 añade
// todo lo necesario para renderizar el archivo embebido (dimensiones, páginas,
// portada, HTML del Word, extracto) en vez de ofrecer una descarga.
//
// normalize() acepta ambas formas, de modo que una noticia antigua se ve bien
// sin tocar la base de datos. Todo consumidor (lista, detalle, correo, home)
// pasa por aquí; nadie más interpreta un adjunto.

const path = require("path");
const crypto = require("crypto");
const signedMedia = require("../media/signedMedia");

const KIND = {
  IMAGE: "image",
  PDF: "pdf",
  WORD: "word",
  VIDEO: "video",
  FILE: "file",
};

const EXTENSIONS_BY_KIND = {
  [KIND.IMAGE]: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"],
  [KIND.PDF]: [".pdf"],
  [KIND.WORD]: [".doc", ".docx"],
  [KIND.VIDEO]: [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"],
};

const KIND_BY_EXTENSION = Object.entries(EXTENSIONS_BY_KIND).reduce(
  (acc, [kind, extensions]) => {
    extensions.forEach((ext) => {
      acc[ext] = kind;
    });
    return acc;
  },
  {},
);

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
};

const KIND_LABEL = {
  [KIND.IMAGE]: { singular: "imagen", plural: "imágenes" },
  [KIND.PDF]: { singular: "PDF", plural: "PDF" },
  [KIND.WORD]: { singular: "documento", plural: "documentos" },
  [KIND.VIDEO]: { singular: "video", plural: "videos" },
  [KIND.FILE]: { singular: "archivo", plural: "archivos" },
};

// Campos que se persisten en la columna JSON. Todo lo demás es derivado y se
// recalcula en cada lectura (URLs firmadas, etiquetas, iconos).
const PERSISTED_FIELDS = [
  "v",
  "id",
  "kind",
  "name",
  "url",
  "public_id",
  "mime",
  "size",
  "alt",
  "caption",
  "order",
  "width",
  "height",
  "pages",
  "excerpt",
  "html_path",
  "preview_path",
  "preview_width",
  "preview_height",
  "preview_pages",
];

function extensionOf(nameOrUrl) {
  const value = String(nameOrUrl || "").split(/[?#]/)[0];
  return path.extname(value).toLowerCase();
}

/**
 * Determina el tipo de adjunto. La extensión manda; los campos heredados
 * (tipo / resource_type) solo se usan si el nombre no dice nada.
 */
function kindFor(nameOrUrl, legacy = {}) {
  const byExtension = KIND_BY_EXTENSION[extensionOf(nameOrUrl)];
  if (byExtension) return byExtension;

  const mime = String(legacy.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return KIND.IMAGE;
  if (mime.startsWith("video/")) return KIND.VIDEO;
  if (mime === "application/pdf") return KIND.PDF;
  if (mime.includes("wordprocessingml") || mime === "application/msword") {
    return KIND.WORD;
  }

  const tipo = String(legacy.tipo || "").toLowerCase();
  if (tipo === "image") return KIND.IMAGE;
  if (tipo === "video") return KIND.VIDEO;

  const resourceType = String(legacy.resource_type || "").toLowerCase();
  if (resourceType === "image") return KIND.IMAGE;
  if (resourceType === "video") return KIND.VIDEO;

  return KIND.FILE;
}

function mimeFor(nameOrUrl, fallback = "") {
  return MIME_BY_EXTENSION[extensionOf(nameOrUrl)] || fallback || "application/octet-stream";
}

function generateId() {
  return `att_${crypto.randomBytes(6).toString("hex")}`;
}

function parseRaw(attachments) {
  if (!attachments) return [];
  if (Array.isArray(attachments)) return attachments;
  if (typeof attachments === "string") {
    const trimmed = attachments.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("[Noticias] attachments con JSON inválido:", err.message);
      return [];
    }
  }
  if (typeof attachments === "object") return [attachments];
  return [];
}

function toInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza un ítem (v1 o v2) al modelo v2 y le añade los campos derivados
 * que necesitan las vistas y el correo.
 */
function normalizeOne(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;

  const url = raw.url || raw.secure_url || "";
  if (!url) return null;

  const name = raw.name || raw.nombre || path.basename(url) || "Archivo";
  const kind = raw.kind && KIND_LABEL[raw.kind] ? raw.kind : kindFor(name || url, raw);
  const publicId = raw.public_id || signedMedia.toRelativePath(url);

  // La ruta de la vista previa: explícita (PDF/video) o el propio archivo si es imagen.
  const previewPath =
    raw.preview_path || (kind === KIND.IMAGE ? signedMedia.toRelativePath(url) : null);

  // Páginas rasterizadas del PDF (correo embebido). Si solo hay portada, se
  // trata como una lista de una página para unificar el render del email.
  const previewPages = normalizePreviewPages(raw.preview_pages, {
    path: previewPath,
    width: toInt(raw.preview_width),
    height: toInt(raw.preview_height),
    kind,
  });

  const item = {
    v: 2,
    id: raw.id || generateId(),
    kind,
    name,
    url,
    public_id: publicId,
    mime: raw.mime || mimeFor(name || url),
    size: toInt(raw.size),
    alt: raw.alt || "",
    caption: raw.caption || "",
    order: Number.isFinite(raw.order) ? raw.order : index,
    width: toInt(raw.width),
    height: toInt(raw.height),
    pages: toInt(raw.pages),
    excerpt: raw.excerpt || "",
    html_path: raw.html_path || null,
    preview_path: previewPath,
    preview_width: toInt(raw.preview_width) || previewPages[0]?.width || null,
    preview_height: toInt(raw.preview_height) || previewPages[0]?.height || null,
    preview_pages: previewPages.length ? previewPages : null,
  };

  // --- Campos derivados (no se persisten) ---
  item.downloadUrl = url;
  item.previewUrl = previewPath ? signedMedia.publicUrl(previewPath) : null;
  item.previewPageUrls = previewPages
    .map((page) => {
      const signed = signedMedia.publicUrl(page.path);
      return signed
        ? {
            url: signed,
            width: page.width,
            height: page.height,
            page: page.page,
          }
        : null;
    })
    .filter(Boolean);
  item.hasEmbeddedHtml = Boolean(item.html_path);
  item.label = KIND_LABEL[kind].singular;
  item.extension = extensionOf(name || url).replace(".", "").toUpperCase();
  item.sizeLabel = formatSize(item.size);

  return item;
}

/**
 * Normaliza la lista de páginas rasterizadas. Acepta el formato persistido
 * y, si no hay lista, inventa una entrada a partir de la portada.
 */
function normalizePreviewPages(rawPages, fallback) {
  if (Array.isArray(rawPages) && rawPages.length) {
    return rawPages
      .map((page, index) => {
        if (!page || typeof page !== "object") return null;
        const pagePath = page.path || page.preview_path || null;
        if (!pagePath) return null;
        return {
          path: pagePath,
          width: toInt(page.width),
          height: toInt(page.height),
          page: toInt(page.page) || index + 1,
        };
      })
      .filter(Boolean);
  }

  // Imágenes y PDFs con solo portada: una sola "página" visible en el correo.
  if (fallback?.path && (fallback.kind === KIND.PDF || fallback.kind === KIND.IMAGE)) {
    return [
      {
        path: fallback.path,
        width: fallback.width,
        height: fallback.height,
        page: 1,
      },
    ];
  }

  return [];
}

/**
 * Lista normalizada y ordenada. Punto de entrada para todo consumidor.
 */
function normalize(attachments) {
  return parseRaw(attachments)
    .map((raw, index) => normalizeOne(raw, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}

/**
 * Serializa para la base de datos: solo campos persistidos, sin derivados.
 */
function serialize(items) {
  const clean = (Array.isArray(items) ? items : normalize(items)).map((item, index) => {
    const out = {};
    PERSISTED_FIELDS.forEach((field) => {
      const value = item[field];
      if (value !== undefined && value !== null && value !== "") {
        out[field] = value;
      }
    });
    out.v = 2;
    out.order = index;
    return out;
  });
  return JSON.stringify(clean);
}

function byKind(items, kind) {
  return items.filter((item) => item.kind === kind);
}

/**
 * Resumen para los "chips" de la tarjeta de noticia ("3 imágenes · 1 PDF").
 */
function summarize(items) {
  const counts = {};
  items.forEach((item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  });

  const chips = [KIND.IMAGE, KIND.PDF, KIND.WORD, KIND.VIDEO, KIND.FILE]
    .filter((kind) => counts[kind])
    .map((kind) => {
      const count = counts[kind];
      const labels = KIND_LABEL[kind];
      return { kind, count, text: `${count} ${count === 1 ? labels.singular : labels.plural}` };
    });

  return { counts, chips, total: items.length };
}

function formatSize(bytes) {
  const value = toInt(bytes);
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

module.exports = {
  KIND,
  KIND_LABEL,
  EXTENSIONS_BY_KIND,
  extensionOf,
  kindFor,
  mimeFor,
  generateId,
  normalize,
  normalizeOne,
  serialize,
  byKind,
  summarize,
  formatSize,
};
