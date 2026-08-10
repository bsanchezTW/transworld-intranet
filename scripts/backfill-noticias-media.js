#!/usr/bin/env node
/**
 * Backfill de derivadas para noticias existentes.
 *
 * Las noticias antiguas se ven correctamente sin esto (el normalizador las
 * adapta al vuelo), pero sus PDF no tienen portada rasterizada, sus Word no
 * tienen HTML y sus imágenes no tienen dimensiones. Este script las genera.
 *
 * Es idempotente: solo procesa lo que falta, así que se puede volver a lanzar
 * sin duplicar archivos ni trabajo.
 *
 *   node scripts/backfill-noticias-media.js --dry-run
 *   node scripts/backfill-noticias-media.js
 *   node scripts/backfill-noticias-media.js --id 42
 */

require("dotenv").config();

const db = require("../src/db");
const sharepoint = require("../src/services/sharepointService");
const fileStorage = require("../src/services/fileStorage");
const attachmentModel = require("../src/services/noticias/attachmentModel");
const attachmentProcessor = require("../src/services/noticias/attachmentProcessor");
const pdfRenderer = require("../src/services/noticias/pdfRenderer");
const wordRenderer = require("../src/services/noticias/wordRenderer");

const { KIND } = attachmentModel;

const argumentos = process.argv.slice(2);
const SIMULACION = argumentos.includes("--dry-run");
const idIndice = argumentos.indexOf("--id");
const SOLO_ID = idIndice !== -1 ? argumentos[idIndice + 1] : null;

const resumen = {
  noticias: 0,
  actualizadas: 0,
  imagenes: 0,
  pdfs: 0,
  words: 0,
  omitidos: 0,
  fallos: 0,
};

function log(...partes) {
  console.log(...partes);
}

/** ¿Le falta a este adjunto alguna derivada que sí podríamos generar? */
function necesitaProceso(item) {
  if (item.kind === KIND.IMAGE) return !item.width || !item.height;
  if (item.kind === KIND.PDF) {
    // Sin portada, sin nº de páginas, o con menos páginas rasterizadas
    // que las del documento (correos antiguos solo tenían la 1.ª).
    const rasterizadas = Array.isArray(item.preview_pages) ? item.preview_pages.length : 0;
    const incompleto =
      item.pages && rasterizadas > 0 && rasterizadas < Math.min(item.pages, 20);
    return !item.preview_path || !item.pages || incompleto;
  }
  if (item.kind === KIND.WORD) return !item.html_path;
  return false;
}

async function descargar(item) {
  const ruta = item.public_id || item.url;
  const { buffer } = await sharepoint.downloadFile(ruta);
  return buffer;
}

async function procesarAdjunto(item, noticiaId) {
  const buffer = await descargar(item);
  if (!item.size) item.size = buffer.length;

  const baseName = (item.public_id || item.name).split("/").pop().replace(/\.[^.]+$/, "");

  if (item.kind === KIND.IMAGE) {
    const medidas = await attachmentProcessor.readImageSize(buffer);
    item.width = medidas.width;
    item.height = medidas.height;
    resumen.imagenes += 1;
    return `imagen ${item.width}×${item.height}`;
  }

  if (item.kind === KIND.PDF) {
    const { pages, excerpt, preview, previews } = await pdfRenderer.analyze(buffer);
    item.pages = pages;
    item.excerpt = excerpt;

    const pagesToSave = previews?.length ? previews : preview ? [preview] : [];
    const savedPages = [];

    for (let i = 0; i < pagesToSave.length; i += 1) {
      const pagePreview = pagesToSave[i];
      const suffix = pagesToSave.length === 1 ? "portada" : `p${i + 1}`;
      const ext = pagePreview.mime === "image/jpeg" ? "jpg" : "png";
      const guardado = await fileStorage.saveFile(
        pagePreview.buffer,
        `${attachmentProcessor.UPLOAD_FOLDER}/previews`,
        `${baseName}-${suffix}.${ext}`,
      );
      savedPages.push({
        path: guardado.public_id,
        width: pagePreview.width,
        height: pagePreview.height,
        page: i + 1,
      });
    }

    if (savedPages.length) {
      item.preview_path = savedPages[0].path;
      item.preview_width = savedPages[0].width;
      item.preview_height = savedPages[0].height;
      item.preview_pages = savedPages;
    }

    resumen.pdfs += 1;
    return `PDF ${pages || "?"} pág.${savedPages.length ? ` + ${savedPages.length} raster` : " (sin portada)"}`;
  }

  if (item.kind === KIND.WORD) {
    const { html, excerpt } = await wordRenderer.render(buffer, {
      name: item.name,
      folder: `${attachmentProcessor.UPLOAD_FOLDER}/word_media`,
    });
    item.excerpt = excerpt;

    if (html) {
      const guardado = await fileStorage.saveFile(
        Buffer.from(html, "utf8"),
        `${attachmentProcessor.UPLOAD_FOLDER}/renders`,
        `${baseName}.html`,
      );
      item.html_path = guardado.public_id;
    }

    resumen.words += 1;
    return `Word ${html ? `${html.length} car. de HTML` : "(sin contenido)"}`;
  }

  return "sin cambios";
}

async function procesarNoticia(fila) {
  const items = attachmentModel.normalize(fila.attachments);
  const pendientes = items.filter(necesitaProceso);

  if (pendientes.length === 0) {
    resumen.omitidos += 1;
    return;
  }

  log(`\n[${fila.id}] ${fila.title}`);
  log(`      ${pendientes.length} de ${items.length} adjuntos por procesar`);

  let algunCambio = false;

  for (const item of pendientes) {
    if (SIMULACION) {
      log(`      · ${item.name} (${item.kind}) → se procesaría`);
      algunCambio = true;
      continue;
    }

    try {
      const detalle = await procesarAdjunto(item, fila.id);
      log(`      ✓ ${item.name} → ${detalle}`);
      algunCambio = true;
    } catch (err) {
      resumen.fallos += 1;
      // Un 404 aquí casi siempre es un adjunto heredado de Cloudinary que nunca
      // llegó a migrarse a SharePoint: el archivo ya no existe y no hay nada
      // que generar. Se informa explícitamente para no confundirlo con un fallo
      // del propio backfill.
      const motivo =
        err.statusCode === 404
          ? `archivo inexistente en SharePoint (${item.public_id})`
          : err.message || err;
      log(`      ✗ ${item.name} → ${motivo}`);
    }
  }

  if (!algunCambio || SIMULACION) return;

  await db.query("UPDATE news_articles SET attachments = $1 WHERE id = $2", [
    attachmentModel.serialize(items),
    fila.id,
  ]);
  resumen.actualizadas += 1;
}

async function main() {
  log("=".repeat(64));
  log("  Backfill de medios en noticias" + (SIMULACION ? "  [SIMULACIÓN]" : ""));
  log("=".repeat(64));

  const { rows } = await db.query(
    SOLO_ID
      ? "SELECT id, title, attachments FROM news_articles WHERE id = $1"
      : "SELECT id, title, attachments FROM news_articles ORDER BY created_at DESC",
    SOLO_ID ? [SOLO_ID] : [],
  );

  resumen.noticias = rows.length;
  log(`\nNoticias a revisar: ${rows.length}`);

  for (const fila of rows) {
    await procesarNoticia(fila);
  }

  log("\n" + "=".repeat(64));
  log(`  Noticias revisadas   : ${resumen.noticias}`);
  log(`  Sin cambios          : ${resumen.omitidos}`);
  log(`  Noticias actualizadas: ${resumen.actualizadas}`);
  log(`  Imágenes medidas     : ${resumen.imagenes}`);
  log(`  PDF procesados       : ${resumen.pdfs}`);
  log(`  Word convertidos     : ${resumen.words}`);
  log(`  Fallos               : ${resumen.fallos}`);
  if (SIMULACION) log("\n  Nada se escribió: vuelve a lanzarlo sin --dry-run.");
  log("=".repeat(64));
}

main()
  .then(() => db.pool.end())
  .then(() => process.exit(resumen.fallos > 0 ? 1 : 0))
  .catch((err) => {
    console.error("\nError fatal:", err);
    process.exit(1);
  });
