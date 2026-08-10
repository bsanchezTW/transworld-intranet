const path = require("path");
const { marked } = require("marked");
const HTMLtoDOCX = require("html-to-docx");
const PDFDocument = require("pdfkit");
const officeExcelFormat = require("./officeExcelFormat");

const MIME_TYPES = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

function extensionOf(filename) {
  return path.extname(filename || "").toLowerCase();
}

function normalizeFilename(filename, ext) {
  const base = path.basename(filename || "archivo", path.extname(filename || ""));
  return `${base}${ext}`;
}

function markdownToHtml(markdown) {
  return marked.parse(markdown || "", { gfm: true, breaks: true });
}

function wordDocumentCss() {
  return `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
    h1 { font-size: 18pt; color: #003a70; margin: 18pt 0 8pt; }
    h2 { font-size: 14pt; color: #003a70; margin: 14pt 0 6pt; }
    h3 { font-size: 12pt; margin: 12pt 0 4pt; }
    p { margin: 0 0 8pt; }
    ul, ol { margin: 0 0 8pt 18pt; }
    table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
    th, td { border: 1px solid #b4b4b4; padding: 5pt 8pt; vertical-align: top; }
    th { background: #d9e1f2; font-weight: bold; }
    strong { font-weight: bold; }
  `;
}

async function buildWordBuffer(content) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${wordDocumentCss()}</style></head><body>${markdownToHtml(content)}</body></html>`;
  const buffer = await HTMLtoDOCX(html, null, {
    font: "Calibri",
    fontSize: 22,
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
    margins: {
      top: 1440,
      right: 1260,
      bottom: 1440,
      left: 1260,
    },
  });
  return Buffer.from(buffer);
}

function drawMarkdownTable(doc, rows, startY) {
  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width - margin - doc.page.margins.right;
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = pageWidth / colCount;
  let y = startY;

  rows.forEach((row, rowIndex) => {
    const height = 22;
    if (y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    row.forEach((cell, colIndex) => {
      const x = margin + colIndex * colWidth;
      if (rowIndex === 0) {
        doc.rect(x, y, colWidth, height).fillAndStroke("#D9E1F2", "#999999");
        doc.fillColor("#111111");
      } else {
        doc.rect(x, y, colWidth, height).stroke("#cccccc");
        doc.fillColor("#111111");
      }
      doc.font(rowIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      doc.text(String(cell ?? ""), x + 4, y + 6, {
        width: colWidth - 8,
        height: height - 8,
        ellipsis: true,
      });
    });
    y += height;
  });

  return y + 8;
}

function renderMarkdownToPdf(content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const lines = String(content || "").split("\n");
    let index = 0;

    const ensureSpace = (height = 24) => {
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
    };

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        doc.moveDown(0.4);
        index++;
        continue;
      }

      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const tableRows = [];
        while (index < lines.length && lines[index].trim().startsWith("|")) {
          const rowLine = lines[index].trim();
          if (!/^\|[-:\s|]+\|$/.test(rowLine)) {
            tableRows.push(
              rowLine
                .slice(1, -1)
                .split("|")
                .map((cell) => cell.trim())
            );
          }
          index++;
        }
        if (tableRows.length) {
          ensureSpace(tableRows.length * 24);
          doc.y = drawMarkdownTable(doc, tableRows, doc.y);
        }
        continue;
      }

      if (/^#{1,3}\s+/.test(trimmed)) {
        const level = trimmed.match(/^#+/)[0].length;
        const text = trimmed.replace(/^#{1,3}\s+/, "");
        const sizes = { 1: 20, 2: 16, 3: 13 };
        ensureSpace(30);
        doc.font("Helvetica-Bold").fontSize(sizes[level] || 13).fillColor("#003a70");
        doc.text(text, { continued: false });
        doc.moveDown(0.3);
        index++;
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        ensureSpace();
        doc.font("Helvetica").fontSize(11).fillColor("#111111");
        doc.text(`• ${trimmed.replace(/^[-*]\s+/, "")}`, { indent: 12 });
        index++;
        continue;
      }

      ensureSpace();
      doc.font("Helvetica").fontSize(11).fillColor("#111111");
      doc.text(trimmed.replace(/\*\*(.+?)\*\*/g, "$1"), { lineGap: 2 });
      index++;
    }

    doc.end();
  });
}

async function buildFromContent(filename, content, { templateBuffer = null } = {}) {
  const ext = extensionOf(filename) || ".txt";
  const normalizedName = normalizeFilename(filename, ext);

  if ([".xlsx", ".xls", ".xlsm"].includes(ext)) {
    const buffer = await officeExcelFormat.buildWorkbookBuffer({
      content,
      filename,
      templateBuffer,
    });
    return {
      buffer,
      mimeType: MIME_TYPES[ext],
      filename: normalizedName,
    };
  }

  if (ext === ".csv") {
    return {
      buffer: Buffer.from(String(content ?? ""), "utf-8"),
      mimeType: MIME_TYPES[".csv"],
      filename: normalizedName,
    };
  }

  if ([".docx", ".doc"].includes(ext)) {
    const buffer = await buildWordBuffer(content);
    return {
      buffer,
      mimeType: MIME_TYPES[".docx"],
      filename: normalizeFilename(filename, ".docx"),
    };
  }

  if (ext === ".pdf") {
    const buffer = await renderMarkdownToPdf(content);
    return {
      buffer,
      mimeType: MIME_TYPES[".pdf"],
      filename: normalizedName,
    };
  }

  return {
    buffer: Buffer.from(String(content ?? ""), "utf-8"),
    mimeType: MIME_TYPES[ext] || "text/plain",
    filename: normalizedName,
  };
}

module.exports = {
  MIME_TYPES,
  buildFromContent,
};
