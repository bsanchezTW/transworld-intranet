const path = require("path");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const officeExcelFormat = require("./officeExcelFormat");

const WORD_EXTENSIONS = new Set([".doc", ".docx"]);
const EXCEL_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm"]);

const MAX_EXTRACTED_CHARS = parseInt(process.env.CLAUDE_MAX_DOC_CHARS || "120000", 10);

function extensionOf(filename) {
  return path.extname(filename || "").toLowerCase();
}

function getOfficeKind(filename, mimeType = "") {
  const ext = extensionOf(filename);
  if (WORD_EXTENSIONS.has(ext)) return "word";
  if (EXCEL_EXTENSIONS.has(ext)) return "excel";

  const mime = String(mimeType).toLowerCase();
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "excel";

  return null;
}

function isOfficeDocument(filename, mimeType = "") {
  return getOfficeKind(filename, mimeType) !== null;
}

function truncateExtractedText(text, filename) {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return (
    text.slice(0, MAX_EXTRACTED_CHARS) +
    `\n\n[... contenido truncado: "${filename}" supera el límite de ${MAX_EXTRACTED_CHARS.toLocaleString("es-CL")} caracteres procesables ...]`
  );
}

async function extractWordText(buffer, filename) {
  const ext = extensionOf(filename);

  if (ext === ".docx") {
    const result = await mammoth.convertToMarkdown(
      { buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => # :fresh",
          "p[style-name='Heading 2'] => ## :fresh",
          "p[style-name='Heading 3'] => ### :fresh",
          "b => **",
          "i => *",
        ],
      }
    );
    const markdown = result.value?.trim();
    if (markdown) return markdown;
  }

  const doc = await new WordExtractor().extract(buffer);
  const parts = [
    doc.getBody()?.trim(),
    doc.getHeaders()?.trim() && `--- Encabezados ---\n${doc.getHeaders().trim()}`,
    doc.getFooters()?.trim() && `--- Pies de página ---\n${doc.getFooters().trim()}`,
  ].filter(Boolean);

  return parts.join("\n\n");
}

function extractExcelStructured(buffer, filename) {
  return officeExcelFormat.extractWorkbookJson(buffer, filename).then((data) =>
    JSON.stringify(data, null, 2)
  );
}

async function extractOfficeText(buffer, filename, mimeType = "") {
  const kind = getOfficeKind(filename, mimeType);
  if (!kind) {
    throw new Error(`Formato Office no soportado: ${filename}`);
  }

  let text;
  if (kind === "word") {
    text = await extractWordText(buffer, filename);
  } else {
    text = await extractExcelStructured(buffer, filename);
  }

  if (!text.trim()) {
    throw new Error(`No se pudo extraer texto de "${filename}"`);
  }

  return truncateExtractedText(text, filename);
}

module.exports = {
  WORD_EXTENSIONS,
  EXCEL_EXTENSIONS,
  getOfficeKind,
  isOfficeDocument,
  extractOfficeText,
};
