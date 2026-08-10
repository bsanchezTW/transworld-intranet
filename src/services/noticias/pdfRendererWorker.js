// Worker aislado: rasterizar PDF en el proceso principal puede matar Node
// (segfault nativo de pdf.js + @napi-rs/canvas). Este hijo reporta el
// resultado por IPC; si muere, el padre sobrevive y sigue sin portada.
//
// Mensajes aceptados:
//   { bufferBase64, mode: "meta" }              → pages + excerpt
//   { bufferBase64, mode: "page", pageNumber }  → una página rasterizada
//   { bufferBase64 } / mode: "all"              → meta + páginas (legacy)

const path = require("path");
const { excerptFrom } = require("../../utils/sanitizeContent");

const PREVIEW_TARGET_WIDTH = 800;
const MAX_PREVIEW_SCALE = 2;
const MAX_RASTER_PAGES = 20;
const MAX_CANVAS_EDGE = 1400;

/**
 * Factory requerida por pdf.js en Node: sin ella intenta APIs de navegador
 * al crear canvas auxiliares y puede tumbar el proceso.
 */
function createCanvasFactory(canvasLib) {
  return {
    create(width, height) {
      const canvas = canvasLib.createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = Math.ceil(width);
      canvasAndContext.canvas.height = Math.ceil(height);
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };
}

function packageAssetUrl(...segments) {
  const dir = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), ...segments);
  // pdf.js en Node lee con fs. Debe ser ruta con / (no file://): en Windows
  // fetch(file://) falla y las páginas salen blancas sin tipografías.
  return dir.split(path.sep).join("/") + "/";
}

async function openDocument(buffer, canvasFactory) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = packageAssetUrl("standard_fonts");
  const cMapUrl = packageAssetUrl("cmaps");

  const options = {
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  };
  if (canvasFactory) options.canvasFactory = canvasFactory;

  return pdfjs.getDocument(options).promise;
}

async function extractMeta(doc) {
  const pages = doc.numPages;
  let excerpt = "";
  try {
    const maxTextPages = Math.min(pages, 2);
    const chunks = [];
    for (let pageNumber = 1; pageNumber <= maxTextPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      chunks.push(content.items.map((item) => item.str).join(" "));
      page.cleanup();
    }
    excerpt = excerptFrom(chunks.join(" ").replace(/\s+/g, " ").trim(), 400);
  } catch (err) {
    console.warn("[Noticias] Worker: no se pudo extraer texto:", err.message || err);
  }
  return { pages, excerpt };
}

async function rasterizePage(doc, pageNumber, canvasFactory) {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    let scale = Math.min(MAX_PREVIEW_SCALE, PREVIEW_TARGET_WIDTH / base.width);
    if (base.height * scale > MAX_CANVAS_EDGE) {
      scale = MAX_CANVAS_EDGE / base.height;
    }
    const viewport = page.getViewport({ scale });

    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    canvasAndContext.context.fillStyle = "#ffffff";
    canvasAndContext.context.fillRect(
      0,
      0,
      canvasAndContext.canvas.width,
      canvasAndContext.canvas.height,
    );

    // annotationMode 0 = DISABLE: evita operadores que en Node suelen tumbar el canvas.
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
      annotationMode: 0,
    }).promise;

    // PNG es más estable que JPEG con @napi-rs/canvas en Windows.
    const bufferBase64 = canvasAndContext.canvas.toBuffer("image/png").toString("base64");
    const preview = {
      bufferBase64,
      width: canvasAndContext.canvas.width,
      height: canvasAndContext.canvas.height,
      page: pageNumber,
      mime: "image/png",
    };
    canvasFactory.destroy(canvasAndContext);
    return preview;
  } finally {
    page.cleanup();
  }
}

/**
 * Extrae la imagen embebida más grande de una página SIN rasterizar.
 * Sirve para PDFs escaneados (cartolas, etc.) donde page.render() tumba el
 * proceso nativo en Windows.
 */
async function extractPageImage(doc, pageNumber, canvasLib) {
  const page = await doc.getPage(pageNumber);
  try {
    const ops = await page.getOperatorList();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const paintOps = new Set([
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintJpegXObject,
    ].filter(Boolean));

    const names = [];
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (!paintOps.has(ops.fnArray[i])) continue;
      const name = ops.argsArray[i]?.[0];
      if (name) names.push(name);
    }
    if (!names.length) return null;

    const resolveImage = (name) =>
      new Promise((resolve) => {
        let settled = false;
        const done = (img) => {
          if (settled) return;
          settled = true;
          resolve(img || null);
        };
        try {
          page.objs.get(name, done);
        } catch (_) {
          try {
            doc.objs?.get?.(name, done);
          } catch {
            done(null);
          }
        }
        setTimeout(() => done(null), 5000);
      });

    let best = null;
    for (const name of names) {
      const img = await resolveImage(name);
      if (!img || !img.width || !img.height) continue;
      const area = img.width * img.height;
      if (!best || area > best.area) best = { img, area };
    }
    if (!best) return null;

    const { img } = best;
    const canvas = canvasLib.createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(img.width, img.height);

    if (img.data && img.data.length) {
      // RGBA u otros formatos de pdf.js
      const src = img.data;
      if (src.length >= img.width * img.height * 4) {
        imageData.data.set(src.subarray(0, imageData.data.length));
      } else if (src.length >= img.width * img.height * 3) {
        for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
          imageData.data[i] = src[j];
          imageData.data[i + 1] = src[j + 1];
          imageData.data[i + 2] = src[j + 2];
          imageData.data[i + 3] = 255;
        }
      } else {
        return null;
      }
      ctx.putImageData(imageData, 0, 0);
    } else {
      return null;
    }

    return {
      bufferBase64: canvas.toBuffer("image/jpeg", 0.85).toString("base64"),
      width: img.width,
      height: img.height,
      page: pageNumber,
      mime: "image/jpeg",
    };
  } finally {
    page.cleanup();
  }
}

async function handleMessage(msg) {
  if (!msg || !msg.bufferBase64) {
    return { ok: false, error: "buffer vacío" };
  }

  const buffer = Buffer.from(msg.bufferBase64, "base64");
  const mode = msg.mode || "all";

  const canvasLib = require("@napi-rs/canvas");
  globalThis.DOMMatrix = globalThis.DOMMatrix || canvasLib.DOMMatrix;
  globalThis.Path2D = globalThis.Path2D || canvasLib.Path2D;
  globalThis.ImageData = globalThis.ImageData || canvasLib.ImageData;

  // Meta y extract no necesitan canvasFactory de pdf.js (evita crashes).
  const needsFactory = mode === "page" || mode === "all";
  const canvasFactory = needsFactory ? createCanvasFactory(canvasLib) : undefined;
  const doc = await openDocument(buffer, canvasFactory);

  try {
    if (mode === "meta") {
      const meta = await extractMeta(doc);
      return { ok: true, result: { ...meta, preview: null, previews: [] } };
    }

    if (mode === "extract") {
      const pageNumber = Number(msg.pageNumber) || 1;
      if (pageNumber < 1 || pageNumber > doc.numPages) {
        return { ok: false, error: `página ${pageNumber} fuera de rango` };
      }
      const preview = await extractPageImage(doc, pageNumber, canvasLib);
      if (!preview) return { ok: false, error: "sin imagen embebida" };
      return {
        ok: true,
        result: { pages: doc.numPages, excerpt: "", preview, previews: [preview] },
      };
    }

    if (mode === "page") {
      const pageNumber = Number(msg.pageNumber) || 1;
      if (pageNumber < 1 || pageNumber > doc.numPages) {
        return { ok: false, error: `página ${pageNumber} fuera de rango` };
      }
      const preview = await rasterizePage(doc, pageNumber, canvasFactory);
      return {
        ok: true,
        result: {
          pages: doc.numPages,
          excerpt: "",
          preview,
          previews: [preview],
        },
      };
    }

    // mode === "all": meta + páginas (compat).
    const meta = await extractMeta(doc);
    const previews = [];
    const maxPages = Math.min(doc.numPages, MAX_RASTER_PAGES);
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      try {
        previews.push(await rasterizePage(doc, pageNumber, canvasFactory));
      } catch (err) {
        console.warn(
          `[Noticias] Worker: no se pudo rasterizar la página ${pageNumber}:`,
          err.message || err,
        );
      }
    }

    return {
      ok: true,
      result: {
        ...meta,
        preview: previews[0] || null,
        previews,
      },
    };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

process.on("message", async (msg) => {
  try {
    process.send(await handleMessage(msg));
  } catch (err) {
    process.send({ ok: false, error: err?.message || String(err) });
  }
});
