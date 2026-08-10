const path = require("path");
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");

const EXCEL_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm"]);
const HEADER_FILL = "FFD9E1F2";

function extensionOf(filename) {
  return path.extname(filename || "").toLowerCase();
}

function isExcelFile(filename, mimeType = "") {
  if (EXCEL_EXTENSIONS.has(extensionOf(filename))) return true;
  const mime = String(mimeType).toLowerCase();
  return mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel";
}

function serializeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (value.formula) return { f: value.formula, v: value.result ?? "" };
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.text) return value.text;
    if (value.hyperlink) return value.text || value.hyperlink;
    if (value.error) return value.error;
  }
  return value;
}

function normalizeCellInput(cell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell !== "object" || Array.isArray(cell)) {
    return { v: cell };
  }
  const normalized = {};
  if (cell.f !== undefined) normalized.f = String(cell.f);
  if (cell.formula !== undefined) normalized.f = String(cell.formula);
  if (cell.v !== undefined) normalized.v = cell.v;
  if (cell.value !== undefined) normalized.v = cell.value;
  if (cell.z !== undefined) normalized.z = cell.z;
  if (cell.format !== undefined) normalized.z = cell.format;
  if (cell.bold !== undefined) normalized.bold = Boolean(cell.bold);
  return Object.keys(normalized).length ? normalized : null;
}

function compactRow(cells) {
  let lastIndex = -1;
  cells.forEach((cell, index) => {
    if (cell !== null && cell !== undefined && cell !== "") lastIndex = index;
  });
  if (lastIndex === -1) return [];
  return cells.slice(0, lastIndex + 1).map((cell) => {
    if (cell === null || cell === undefined || cell === "") return "";
    if (typeof cell === "object" && !Array.isArray(cell)) {
      const out = {};
      if (cell.f) out.f = cell.f;
      if (cell.v !== undefined && cell.v !== "") out.v = cell.v;
      if (cell.z) out.z = cell.z;
      if (cell.bold) out.bold = true;
      return Object.keys(out).length ? out : "";
    }
    return cell;
  });
}

function applyCellStyle(cell, { bold = false, header = false } = {}) {
  if (header || bold) {
    cell.font = { ...(cell.font || {}), bold: true };
  }
  if (header) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
  }
}

function setWorksheetCell(cell, data, { header = false } = {}) {
  if (!data) return;

  if (data.f) {
    cell.value = { formula: data.f, result: data.v ?? undefined };
  } else if (data.v !== undefined && data.v !== "") {
    cell.value = data.v;
  } else {
    return;
  }

  if (data.z) cell.numFmt = data.z;
  applyCellStyle(cell, { bold: data.bold, header });
}

async function extractWithExcelJs(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = workbook.worksheets.map((worksheet) => {
    const rows = [];
    const maxRow = worksheet.rowCount || 0;
    const maxCol = worksheet.columnCount || 0;

    for (let rowIndex = 1; rowIndex <= maxRow; rowIndex++) {
      const row = worksheet.getRow(rowIndex);
      const cells = [];
      for (let colIndex = 1; colIndex <= maxCol; colIndex++) {
        const cell = row.getCell(colIndex);
        const payload = {};
        if (cell.formula) {
          payload.f = cell.formula;
          if (cell.value && typeof cell.value === "object" && cell.value.result !== undefined) {
            payload.v = cell.value.result;
          } else if (cell.result !== undefined) {
            payload.v = cell.result;
          }
        } else if (cell.value !== null && cell.value !== undefined) {
          payload.v = serializeCellValue(cell.value);
        }
        if (cell.numFmt && cell.numFmt !== "General") payload.z = cell.numFmt;
        if (cell.font?.bold) payload.bold = true;
        cells[colIndex - 1] = Object.keys(payload).length ? payload : null;
      }
      const compacted = compactRow(cells);
      if (compacted.length) rows.push(compacted);
    }

    const columnWidths = [];
    worksheet.columns.forEach((column) => {
      if (column?.width) columnWidths.push(Math.round(column.width));
    });

    const sheetData = { name: worksheet.name, rows };
    if (columnWidths.length) sheetData.columnWidths = columnWidths;
    return sheetData;
  });

  return { sheets };
}

function extractWithXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: true });
  const sheets = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const ref = worksheet["!ref"];
    if (!ref) return { name, rows: [] };

    const range = XLSX.utils.decode_range(ref);
    const rows = [];
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
      const cells = [];
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = worksheet[address];
        if (!cell) {
          cells[colIndex - range.s.c] = null;
          continue;
        }
        const payload = {};
        if (cell.f) {
          payload.f = cell.f;
          if (cell.v !== undefined) payload.v = cell.v;
        } else if (cell.v !== undefined) {
          payload.v = cell.v;
        }
        if (cell.z) payload.z = cell.z;
        cells[colIndex - range.s.c] = Object.keys(payload).length ? payload : null;
      }
      const compacted = compactRow(cells);
      if (compacted.length) rows.push(compacted);
    }

    const columnWidths = (worksheet["!cols"] || [])
      .map((col) => (col?.wch ? Math.round(col.wch) : null))
      .filter(Boolean);

    const sheetData = { name, rows };
    if (columnWidths.length) sheetData.columnWidths = columnWidths;
    return sheetData;
  });

  return { sheets };
}

async function extractWorkbookJson(buffer, filename) {
  const ext = extensionOf(filename);
  if (ext === ".xls") {
    return extractWithXlsx(buffer);
  }
  return extractWithExcelJs(buffer);
}

function parseCsvRow(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === "," || ch === "\t") && !inQuotes) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

function coerceCellValue(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseLegacyCsvSheets(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return [{ name: "Hoja1", rows: [] }];
  }

  const sections = [];
  const lines = trimmed.split("\n");
  let currentName = "Hoja1";
  let currentRows = [];

  const flush = () => {
    if (currentRows.length) {
      sections.push({ name: currentName, rows: currentRows });
    }
    currentRows = [];
  };

  for (const line of lines) {
    const sheetMatch = line.match(/^###\s*Hoja:\s*(.+)$/i);
    if (sheetMatch) {
      flush();
      currentName = sheetMatch[1].trim().slice(0, 31) || "Hoja1";
      continue;
    }
    if (!line.trim()) continue;
    currentRows.push(parseCsvRow(line).map(coerceCellValue));
  }
  flush();

  return sections.length ? sections : [{ name: "Hoja1", rows: [parseCsvRow(trimmed)] }];
}

// El modelo a veces envuelve el JSON en ```json ... ``` o agrega texto antes/después.
function stripCodeFences(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  return t;
}

function extractJsonObject(text) {
  const t = stripCodeFences(text);
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function normalizeSheets(sheets) {
  return sheets.map((sheet, index) => ({
    name: String(sheet.name || `Hoja${index + 1}`).slice(0, 31),
    rows: Array.isArray(sheet.rows) ? sheet.rows : [],
    columnWidths: Array.isArray(sheet.columnWidths) ? sheet.columnWidths : undefined,
  }));
}

function normalizeEdits(json) {
  const raw = [];
  if (json.edit && typeof json.edit === "object") raw.push(json.edit);
  if (Array.isArray(json.edits)) raw.push(...json.edits);
  if (!json.edit && !json.edits && Array.isArray(json.ops)) {
    raw.push({ sheet: json.sheet, ops: json.ops });
  }
  return raw
    .filter((e) => e && Array.isArray(e.ops) && e.ops.length)
    .map((e) => ({ sheet: e.sheet != null ? String(e.sheet) : null, ops: e.ops }));
}

/**
 * Interpreta el contenido del bloque ```file de un Excel.
 * Devuelve { mode: "ops", edits, sheets? } cuando son operaciones de edición
 * sobre el archivo original, o { mode: "sheets", sheets } para reconstruir.
 */
function parseWorkbookInstruction(content) {
  const json = extractJsonObject(content);
  if (json) {
    const edits = normalizeEdits(json);
    if (edits.length) {
      const result = { mode: "ops", edits };
      if (Array.isArray(json.sheets) && json.sheets.length) {
        result.sheets = normalizeSheets(json.sheets);
      }
      return result;
    }
    if (Array.isArray(json.sheets) && json.sheets.length) {
      return { mode: "sheets", sheets: normalizeSheets(json.sheets) };
    }
  }
  return { mode: "sheets", sheets: parseLegacyCsvSheets(String(content || "").trim()) };
}

function parseWorkbookJson(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return { sheets: [{ name: "Hoja1", rows: [] }] };
  const instruction = parseWorkbookInstruction(trimmed);
  return { sheets: instruction.sheets || parseLegacyCsvSheets(trimmed) };
}

// ---- Motor de operaciones sobre el archivo original (preserva el formato) ----

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function colLetterToNumber(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return 0;
    n = n * 26 + code;
  }
  return n;
}

function resolveColIndex(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const s = String(value ?? "").trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[A-Za-z]+$/.test(s)) return colLetterToNumber(s);
  const m = s.toUpperCase().match(/^([A-Z]+)\d*$/);
  if (m) return colLetterToNumber(m[1]);
  return 0;
}

function parseCellRef(ref) {
  if (ref === null || ref === undefined) return null;
  const m = String(ref).trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { row: parseInt(m[2], 10), col: colLetterToNumber(m[1]) };
}

function forEachCellInRange(ref, fn) {
  const s = String(ref ?? "").trim().toUpperCase();
  if (!s) return;
  if (s.includes(":")) {
    const [a, b] = s.split(":");
    const pa = parseCellRef(a);
    const pb = parseCellRef(b);
    if (!pa || !pb) return;
    const r1 = Math.min(pa.row, pb.row);
    const r2 = Math.max(pa.row, pb.row);
    const c1 = Math.min(pa.col, pb.col);
    const c2 = Math.max(pa.col, pb.col);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) fn(r, c);
    }
    return;
  }
  const p = parseCellRef(s);
  if (p) fn(p.row, p.col);
}

function stripFormulaPrefix(formula) {
  return String(formula).replace(/^=/, "");
}

// Convierte una operación (compacta o con "type") a una forma canónica.
function canonicalizeOp(op) {
  if (!op || typeof op !== "object") return null;
  const type = String(op.type || op.op || op.action || "").toLowerCase().replace(/[\s_-]/g, "");

  if (["deletecol", "deletecolumn", "deletecols", "deletecolumns", "removecolumn", "removecol"].includes(type)) {
    return { kind: "deleteCol", cols: toArray(op.col ?? op.column ?? op.cols ?? op.columns ?? op.value ?? op.index) };
  }
  if (["deleterow", "deleterows", "removerow", "removerows"].includes(type)) {
    return { kind: "deleteRow", rows: toArray(op.row ?? op.rows ?? op.value ?? op.index) };
  }
  if (["clear", "clearcell", "clearrange", "delete", "deletecell", "deleterange"].includes(type)) {
    return { kind: "clear", ref: op.range ?? op.cell ?? op.ref ?? op.value };
  }
  if (["set", "setcell", "setvalue", "setformula", "update", "updatecell"].includes(type)) {
    return {
      kind: "set",
      ref: op.cell ?? op.ref ?? op.range ?? op.target,
      v: op.value ?? op.v,
      f: op.formula ?? op.f,
      z: op.z ?? op.format ?? op.numFmt,
      bold: op.bold,
    };
  }

  if (op.deleteCol !== undefined || op.deleteColumn !== undefined || op.deleteCols !== undefined || op.deleteColumns !== undefined) {
    return { kind: "deleteCol", cols: toArray(op.deleteCol ?? op.deleteColumn ?? op.deleteCols ?? op.deleteColumns) };
  }
  if (op.deleteRow !== undefined || op.deleteRows !== undefined) {
    return { kind: "deleteRow", rows: toArray(op.deleteRow ?? op.deleteRows) };
  }
  if (op.clear !== undefined) {
    return { kind: "clear", ref: op.clear };
  }
  if (op.set !== undefined) {
    return { kind: "set", ref: op.set, v: op.v, f: op.f, z: op.z, bold: op.bold };
  }
  return null;
}

function applyValueOp(worksheet, vo) {
  if (vo.kind === "clear") {
    forEachCellInRange(vo.ref, (r, c) => {
      worksheet.getRow(r).getCell(c).value = null;
    });
    return;
  }
  if (vo.kind === "set") {
    const pos = parseCellRef(vo.ref);
    if (!pos) return;
    const cell = worksheet.getRow(pos.row).getCell(pos.col);
    if (vo.f !== undefined && vo.f !== null && String(vo.f).trim() !== "") {
      cell.value = { formula: stripFormulaPrefix(vo.f), result: vo.v ?? undefined };
    } else if (vo.v !== undefined) {
      cell.value = vo.v;
    }
    if (vo.z) cell.numFmt = vo.z;
    if (vo.bold) cell.font = { ...(cell.font || {}), bold: true };
  }
}

function applyOpsToWorksheet(worksheet, ops) {
  const valueOps = [];
  const colDeletes = new Set();
  const rowDeletes = new Set();

  ops.forEach((rawOp) => {
    const op = canonicalizeOp(rawOp);
    if (!op) return;
    if (op.kind === "deleteCol") {
      op.cols.forEach((c) => {
        const idx = resolveColIndex(c);
        if (idx > 0) colDeletes.add(idx);
      });
    } else if (op.kind === "deleteRow") {
      op.rows.forEach((r) => {
        const idx = parseInt(r, 10);
        if (idx > 0) rowDeletes.add(idx);
      });
    } else {
      valueOps.push(op);
    }
  });

  // 1. Operaciones de valor sobre las coordenadas originales.
  valueOps.forEach((vo) => applyValueOp(worksheet, vo));

  // 2. Eliminar filas de mayor a menor para no invalidar los índices.
  [...rowDeletes].sort((a, b) => b - a).forEach((r) => worksheet.spliceRows(r, 1));

  // 3. Eliminar columnas de mayor a menor.
  [...colDeletes].sort((a, b) => b - a).forEach((c) => worksheet.spliceColumns(c, 1));
}

function resolveWorksheet(workbook, name) {
  if (name) {
    const byName = workbook.getWorksheet(name);
    if (byName) return byName;
    const num = parseInt(name, 10);
    if (Number.isInteger(num)) {
      const byIndex = workbook.worksheets[num - 1] || workbook.getWorksheet(num);
      if (byIndex) return byIndex;
    }
  }
  return workbook.worksheets[0] || null;
}

/**
 * Aplica las operaciones de edición sobre el archivo Excel original,
 * conservando estilos, fórmulas, anchos y demás formato no modificado.
 */
async function applyOperationsToWorkbook(templateBuffer, edits, ext) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);

  edits.forEach((edit) => {
    const worksheet = resolveWorksheet(workbook, edit.sheet);
    if (!worksheet) return;
    applyOpsToWorksheet(worksheet, edit.ops);
  });

  const bookType = ext === ".xlsm" ? "xlsm" : "xlsx";
  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
  return Buffer.from(buffer);
}

async function buildWithExcelJs(workbookData, ext) {
  const workbook = new ExcelJS.Workbook();

  workbookData.sheets.forEach((sheetData, index) => {
    const worksheet = workbook.addWorksheet(sheetData.name || `Hoja${index + 1}`);
    const rows = sheetData.rows || [];

    rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(rowIndex + 1);
      const normalizedRow = Array.isArray(row) ? row : [row];
      normalizedRow.forEach((rawCell, colIndex) => {
        const cellData = normalizeCellInput(rawCell);
        if (!cellData) return;
        setWorksheetCell(excelRow.getCell(colIndex + 1), cellData, { header: rowIndex === 0 });
      });
      excelRow.commit();
    });

    if (Array.isArray(sheetData.columnWidths) && sheetData.columnWidths.length) {
      sheetData.columnWidths.forEach((width, colIndex) => {
        if (width) worksheet.getColumn(colIndex + 1).width = width;
      });
    } else if (rows.length) {
      const maxCols = Math.max(...rows.map((row) => (Array.isArray(row) ? row.length : 1)));
      for (let colIndex = 1; colIndex <= maxCols; colIndex++) {
        let maxLen = 10;
        rows.forEach((row) => {
          const cell = normalizeCellInput(Array.isArray(row) ? row[colIndex - 1] : row);
          const text = cell?.f || cell?.v || "";
          maxLen = Math.max(maxLen, String(text).length + 2);
        });
        worksheet.getColumn(colIndex).width = Math.min(maxLen, 40);
      }
    }
  });

  const bookType = ext === ".xlsm" ? "xlsm" : "xlsx";
  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
  return Buffer.from(buffer);
}

async function mergeWithTemplate(templateBuffer, workbookData, ext) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);

  workbookData.sheets.forEach((sheetData) => {
    let worksheet = workbook.getWorksheet(sheetData.name);
    if (!worksheet) {
      worksheet = workbook.addWorksheet(sheetData.name);
    }

    const rows = sheetData.rows || [];
    rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(rowIndex + 1);
      const normalizedRow = Array.isArray(row) ? row : [row];
      normalizedRow.forEach((rawCell, colIndex) => {
        const cellData = normalizeCellInput(rawCell);
        if (!cellData) return;
        const cell = excelRow.getCell(colIndex + 1);
        setWorksheetCell(cell, cellData, { header: false });
      });
      excelRow.commit();
    });

    if (Array.isArray(sheetData.columnWidths) && sheetData.columnWidths.length) {
      sheetData.columnWidths.forEach((width, colIndex) => {
        if (width) worksheet.getColumn(colIndex + 1).width = width;
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
  return Buffer.from(buffer);
}

async function buildWorkbookBuffer({
  content,
  filename,
  templateBuffer = null,
}) {
  const ext = extensionOf(filename) || ".xlsx";
  const instruction = parseWorkbookInstruction(content);

  // Modo edición: aplicar operaciones puntuales sobre el archivo original
  // (limpiar datos, borrar columnas, etc.) sin perder el resto del formato.
  if (instruction.mode === "ops") {
    if (templateBuffer && [".xlsx", ".xlsm"].includes(ext)) {
      try {
        return await applyOperationsToWorkbook(templateBuffer, instruction.edits, ext);
      } catch (err) {
        console.warn("[officeExcelFormat] applyOperations fallback:", err.message);
      }
    }
    if (instruction.sheets?.length) {
      return buildWithExcelJs({ sheets: instruction.sheets }, ext);
    }
    throw new Error(
      "No se encontró el archivo Excel original para aplicar los cambios. Vuelve a adjuntar el archivo y pide la edición de nuevo."
    );
  }

  const workbookData = { sheets: instruction.sheets };

  if (templateBuffer && [".xlsx", ".xlsm"].includes(ext)) {
    try {
      return await mergeWithTemplate(templateBuffer, workbookData, ext);
    } catch (err) {
      console.warn("[officeExcelFormat] mergeWithTemplate fallback:", err.message);
    }
  }

  if (ext === ".xls") {
    return buildWithXlsxLegacy(workbookData);
  }

  return buildWithExcelJs(workbookData, ext);
}

function buildWithXlsxLegacy(workbookData) {
  const workbook = XLSX.utils.book_new();
  workbookData.sheets.forEach((sheetData, index) => {
    const aoa = (sheetData.rows || []).map((row) =>
      (Array.isArray(row) ? row : [row]).map((cell) => {
        const data = normalizeCellInput(cell);
        if (!data) return "";
        if (data.f) return data.f;
        return data.v ?? "";
      })
    );
    const worksheet = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [[""]]);
    (sheetData.rows || []).forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : [row]).forEach((cell, colIndex) => {
        const data = normalizeCellInput(cell);
        if (!data?.f) return;
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        worksheet[address] = { f: data.f, t: "n", v: data.v ?? 0 };
      });
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetData.name || `Hoja${index + 1}`);
  });
  return XLSX.write(workbook, { type: "buffer", bookType: "xls" });
}

module.exports = {
  isExcelFile,
  extractWorkbookJson,
  buildWorkbookBuffer,
  parseWorkbookJson,
  parseWorkbookInstruction,
  applyOperationsToWorkbook,
};
