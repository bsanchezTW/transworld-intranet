// Orquesta la subida de un adjunto: valida, guarda el original y genera las
// derivadas que permiten mostrar el archivo embebido en vez de ofrecer una
// descarga (portada del PDF, HTML del Word, dimensiones de la imagen).
//
// Ninguna derivada es obligatoria: si falla, se registra y el adjunto se
// guarda igual. Publicar una noticia nunca debe romperse por una vista previa.

const fileStorage = require("../fileStorage");
const fs = require("node:fs/promises");
const attachmentModel = require("./attachmentModel");
const documentCache = require("./documentCache");
const pdfRenderer = require("./pdfRenderer");
const wordRenderer = require("./wordRenderer");

const { KIND } = attachmentModel;

const UPLOAD_FOLDER = "noticias_adjuntos";
const PREVIEW_FOLDER = `${UPLOAD_FOLDER}/previews`;
const RENDER_FOLDER = `${UPLOAD_FOLDER}/renders`;
const WORD_MEDIA_FOLDER = `${UPLOAD_FOLDER}/word_media`;

// Límites por tipo (MB). El editor valida en el cliente; esto es la garantía real.
const MAX_SIZE_MB = {
  [KIND.IMAGE]: 20,
  [KIND.PDF]: 40,
  [KIND.WORD]: 25,
  [KIND.VIDEO]: 200,
  [KIND.FILE]: 25,
};

const ACCEPTED_KINDS = new Set([KIND.IMAGE, KIND.PDF, KIND.WORD, KIND.VIDEO]);

class AttachmentError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Dimensiones de una imagen, para reservar el espacio en el layout y evitar
 * saltos de contenido (CLS) al cargar.
 */
async function readImageSize(buffer) {
  try {
    const { loadImage } = require("@napi-rs/canvas");
    const image = await loadImage(buffer);
    return { width: image.width, height: image.height };
  } catch (err) {
    console.warn("[Noticias] No se pudieron leer las dimensiones de la imagen:", err.message || err);
    return { width: null, height: null };
  }
}

async function processPdf(buffer, baseName, item) {
  const { pages, excerpt, preview, previews } = await pdfRenderer.analyze(buffer);
  item.pages = pages;
  item.excerpt = excerpt;

  const pagesToSave = previews?.length ? previews : preview ? [preview] : [];
  if (!pagesToSave.length) return;

  const savedPages = [];
  for (let i = 0; i < pagesToSave.length; i += 1) {
    const pagePreview = pagesToSave[i];
    try {
      const suffix = pagesToSave.length === 1 ? "portada" : `p${i + 1}`;
      const ext = pagePreview.mime === "image/jpeg" ? "jpg" : "png";
      const saved = await fileStorage.saveFile(
        pagePreview.buffer,
        PREVIEW_FOLDER,
        `${baseName}-${suffix}.${ext}`,
      );
      savedPages.push({
        path: saved.public_id,
        width: pagePreview.width,
        height: pagePreview.height,
        page: i + 1,
      });
    } catch (err) {
      console.warn(
        `[Noticias] No se pudo guardar la página ${i + 1} del PDF:`,
        err.message || err,
      );
    }
  }

  if (!savedPages.length) return;

  // La primera página sigue siendo la portada del visor (carga inmediata).
  item.preview_path = savedPages[0].path;
  item.preview_width = savedPages[0].width;
  item.preview_height = savedPages[0].height;
  // Todas las páginas: el correo las incrusta una tras otra.
  item.preview_pages = savedPages;
}

async function processWord(buffer, baseName, item) {
  const { html, excerpt } = await wordRenderer.render(buffer, {
    name: item.name,
    folder: WORD_MEDIA_FOLDER,
  });

  item.excerpt = excerpt;
  if (!html) return;

  try {
    const saved = await fileStorage.saveFile(
      Buffer.from(html, "utf8"),
      RENDER_FOLDER,
      `${baseName}.html`,
    );
    item.html_path = saved.public_id;
    // Se precalienta la caché: la primera visita no espera una lectura remota.
    documentCache.set(saved.public_id, html);
  } catch (err) {
    console.warn("[Noticias] No se pudo guardar el HTML del Word:", err.message || err);
  }
}

/**
 * Procesa un archivo subido y devuelve el adjunto v2 listo para persistir.
 * @param {Buffer} buffer
 * @param {{originalname: string, mimetype: string, size: number}} file
 */
async function processUpload(buffer, file) {
  const name = file.originalname || "archivo";
  const kind = attachmentModel.kindFor(name, { mime: file.mimetype });

  if (!ACCEPTED_KINDS.has(kind)) {
    throw new AttachmentError(
      `Tipo de archivo no permitido: ${name}. Se aceptan imágenes, PDF, Word y video.`,
    );
  }

  const maxMb = MAX_SIZE_MB[kind];
  if (!fileStorage.validateFileSize(buffer, maxMb)) {
    throw new AttachmentError(`"${name}" supera el máximo de ${maxMb} MB para este tipo.`, 413);
  }

  const saved = await fileStorage.saveFile(buffer, UPLOAD_FOLDER, name);
  const baseName = saved.fileName.replace(/\.[^.]+$/, "");

  const item = {
    v: 2,
    id: attachmentModel.generateId(),
    kind,
    name,
    url: saved.secure_url,
    public_id: saved.public_id,
    mime: saved.contentType || attachmentModel.mimeFor(name),
    size: buffer.length,
    alt: "",
    caption: "",
  };

  try {
    if (kind === KIND.IMAGE) {
      Object.assign(item, await readImageSize(buffer));
    } else if (kind === KIND.PDF) {
      await processPdf(buffer, baseName, item);
    } else if (kind === KIND.WORD) {
      await processWord(buffer, baseName, item);
    }
  } catch (err) {
    console.error(`[Noticias] Fallo procesando "${name}":`, err.message || err);
  }

  return attachmentModel.normalizeOne(item);
}

/**
 * Variante para Multer diskStorage. Los videos se envían desde disco por TUS
 * sin ocupar cientos de MiB en el heap; los demás tipos se leen como Buffer
 * porque sus renderizadores necesitan acceso aleatorio al contenido.
 */
async function processUploadedFile(file) {
  if (!file?.path) {
    throw new AttachmentError("No se recibió un archivo temporal válido.");
  }
  const name = file.originalname || "archivo";
  const kind = attachmentModel.kindFor(name, { mime: file.mimetype });
  if (!ACCEPTED_KINDS.has(kind)) {
    throw new AttachmentError(
      `Tipo de archivo no permitido: ${name}. Se aceptan imágenes, PDF, Word y video.`,
    );
  }
  const maxMb = MAX_SIZE_MB[kind];
  if (!Number.isFinite(file.size) || file.size > maxMb * 1024 * 1024) {
    throw new AttachmentError(`"${name}" supera el máximo de ${maxMb} MB para este tipo.`, 413);
  }

  if (kind !== KIND.VIDEO) {
    const buffer = await fs.readFile(file.path);
    return processUpload(buffer, file);
  }

  const saved = await fileStorage.saveFileFromPath(
    file.path,
    UPLOAD_FOLDER,
    name,
  );
  return attachmentModel.normalizeOne({
    v: 2,
    id: attachmentModel.generateId(),
    kind,
    name,
    url: saved.secure_url,
    public_id: saved.public_id,
    mime: saved.contentType,
    size: file.size,
    alt: "",
    caption: "",
  });
}

/**
 * Rutas de storage asociadas a un adjunto (original + derivadas).
 */
function collectAttachmentPaths(items) {
  const paths = [];

  attachmentModel.normalize(items).forEach((item) => {
    paths.push(item.public_id);
    if (item.url) paths.push(item.url);
    if (item.html_path) paths.push(item.html_path);
    // La vista previa de una imagen ES la imagen: no se borra dos veces.
    if (item.preview_path && item.preview_path !== item.public_id) {
      paths.push(item.preview_path);
    }
    if (Array.isArray(item.preview_pages)) {
      item.preview_pages.forEach((page) => {
        if (page?.path && page.path !== item.public_id && page.path !== item.preview_path) {
          paths.push(page.path);
        }
      });
    }
  });

  return paths.filter(Boolean);
}

/**
 * Adjuntos presentes en `previous` cuyo public_id ya no está en `next`.
 */
function findRemovedAttachments(previous, next) {
  const nextIds = new Set(
    attachmentModel
      .normalize(next)
      .map((item) => item.public_id)
      .filter(Boolean),
  );

  return attachmentModel
    .normalize(previous)
    .filter((item) => item.public_id && !nextIds.has(item.public_id));
}

/**
 * Extrae rutas de imágenes embebidas en el HTML renderizado de un Word.
 */
async function collectWordMediaPaths(items) {
  const paths = [];
  const wordItems = attachmentModel
    .normalize(items)
    .filter((item) => item.kind === KIND.WORD && item.html_path);

  for (const item of wordItems) {
    try {
      const html = await documentCache.getHtml(item.html_path);
      if (!html) continue;
      const matches = html.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
      for (const match of matches) {
        const ref = match[1];
        const relative = fileStorage.resolveStoredPath(ref);
        if (relative && relative.startsWith(`${WORD_MEDIA_FOLDER}/`)) {
          paths.push(relative);
        }
      }
    } catch (err) {
      console.warn(
        "[Noticias] No se pudo inspeccionar HTML de Word para limpieza:",
        err.message || err,
      );
    }
  }

  return paths;
}

/**
 * Borra el original y todas sus derivadas. Se usa al eliminar una noticia
 * o adjuntos quitados en una edición, para no dejar huérfanos en Storage.
 */
async function deleteAttachmentFiles(items) {
  const normalized = attachmentModel.normalize(items);
  const paths = collectAttachmentPaths(normalized);
  const wordMedia = await collectWordMediaPaths(normalized);
  const result = await fileStorage.deleteFiles([...paths, ...wordMedia]);
  return result.deleted;
}

module.exports = {
  AttachmentError,
  UPLOAD_FOLDER,
  MAX_SIZE_MB,
  processUpload,
  processUploadedFile,
  deleteAttachmentFiles,
  findRemovedAttachments,
  collectAttachmentPaths,
  readImageSize,
};
