// Análisis y rasterizado de PDF.
//
// En la intranet el PDF se muestra con un visor PDF.js en el navegador. En el
// correo eso es imposible, así que aquí se rasterizan las páginas a JPEG
// durante la subida (y bajo demanda al enviar): el destinatario ve el
// documento completo embebido sin descargar nada.
//
// Cada página corre en su propio proceso hijo: pdf.js + @napi-rs/canvas puede
// provocar un segfault nativo; si una página muere, las demás se conservan.

const path = require("path");
const { fork } = require("child_process");

const PREVIEW_TARGET_WIDTH = 1000;
const MAX_RASTER_PAGES = 20;
const WORKER_TIMEOUT_MS = 60000;
const WORKER_PATH = path.join(__dirname, "pdfRendererWorker.js");

function decodePreview(raw) {
  if (!raw?.bufferBase64) return null;
  return {
    buffer: Buffer.from(raw.bufferBase64, "base64"),
    width: raw.width,
    height: raw.height,
    page: raw.page || null,
    mime: raw.mime || "image/jpeg",
  };
}

/**
 * Lanza un worker, le envía un mensaje y espera UNA respuesta.
 */
function runWorker(payload, timeoutMs = WORKER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      try {
        if (child.connected) child.disconnect();
        child.kill();
      } catch (_) {}
    };

    const child = fork(WORKER_PATH, [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    const timer = setTimeout(() => {
      console.warn("[Noticias] Timeout en worker PDF; se continúa.");
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      finish({ ok: false, error: "timeout" });
    }, timeoutMs);

    child.on("message", (msg) => finish(msg || { ok: false, error: "sin respuesta" }));

    child.on("exit", (code, signal) => {
      if (settled) return;
      console.warn(
        `[Noticias] Worker PDF terminó abruptamente (code=${code}, signal=${signal}).`,
      );
      finish({ ok: false, error: `exit ${code || signal || "?"}` });
    });

    child.on("error", (err) => {
      console.warn("[Noticias] No se pudo lanzar worker PDF:", err.message || err);
      finish({ ok: false, error: err.message || String(err) });
    });

    child.send(payload);
  });
}

/**
 * Analiza un PDF: meta + páginas rasterizadas (una por proceso hijo).
 * @returns {Promise<{pages, excerpt, preview, previews: Array}>}
 */
async function analyze(buffer) {
  const empty = { pages: null, excerpt: "", preview: null, previews: [] };
  const bufferBase64 = Buffer.from(buffer).toString("base64");

  const metaMsg = await runWorker({ bufferBase64, mode: "meta" }, 45000);
  if (!metaMsg.ok) {
    console.warn("[Noticias] Worker PDF (meta) falló:", metaMsg.error || "sin detalle");
    // Último intento: modo "all" en un solo proceso (compat / PDFs simples).
    const allMsg = await runWorker({ bufferBase64, mode: "all" }, 120000);
    if (!allMsg.ok) return empty;
    const raw = allMsg.result || empty;
    const previews = (raw.previews || []).map(decodePreview).filter(Boolean);
    return {
      pages: raw.pages ?? null,
      excerpt: raw.excerpt || "",
      preview: previews[0] || null,
      previews,
    };
  }

  const pages = metaMsg.result?.pages || null;
  const excerpt = metaMsg.result?.excerpt || "";
  if (!pages) return { ...empty, excerpt };

  const previews = [];
  const maxPages = Math.min(pages, MAX_RASTER_PAGES);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    let preview = null;

    const pageMsg = await runWorker(
      { bufferBase64, mode: "page", pageNumber },
      WORKER_TIMEOUT_MS,
    );
    if (pageMsg.ok) {
      preview = decodePreview(pageMsg.result?.preview || pageMsg.result?.previews?.[0]);
    } else {
      console.warn(
        `[Noticias] Rasterizado página ${pageNumber} falló (${pageMsg.error}); intentando extracción…`,
      );
      const extractMsg = await runWorker(
        { bufferBase64, mode: "extract", pageNumber },
        WORKER_TIMEOUT_MS,
      );
      if (extractMsg.ok) {
        const extracted = decodePreview(
          extractMsg.result?.preview || extractMsg.result?.previews?.[0],
        );
        // Imágenes ridículamente pequeñas suelen ser iconos/basura, no la página.
        if (extracted && extracted.buffer.length >= 8 * 1024) {
          preview = extracted;
        } else {
          console.warn(
            `[Noticias] Extracción página ${pageNumber}: resultado descartado (demasiado pequeño).`,
          );
        }
      } else {
        console.warn(
          `[Noticias] Extracción página ${pageNumber} falló:`,
          extractMsg.error || "sin detalle",
        );
      }
    }

    if (preview) previews.push(preview);
  }

  return {
    pages,
    excerpt,
    preview: previews[0] || null,
    previews,
  };
}

module.exports = { analyze, PREVIEW_TARGET_WIDTH, MAX_RASTER_PAGES };
