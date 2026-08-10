/**
 * Utilidades de fechas para vacaciones.
 *
 * Todas las fechas se manejan como "date-only" (sin hora). Internamente se
 * parsean a un Date anclado a mediodía UTC para evitar corrimientos por DST
 * o por la zona horaria del servidor (America/Santiago).
 */

/** Normaliza cualquier entrada a string 'YYYY-MM-DD' o null. */
function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const str = String(value).trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Parsea a Date anclado a mediodía UTC. Devuelve null si inválido. */
function parseDateOnly(value) {
  const iso = toDateOnly(value);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Suma días a una fecha date-only y devuelve string 'YYYY-MM-DD'. */
function addDays(value, days) {
  const date = parseDateOnly(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

/** ¿La fecha cae en fin de semana (sábado o domingo)? */
function isWeekend(value) {
  const date = parseDateOnly(value);
  if (!date) return false;
  const dow = date.getUTCDay(); // 0=domingo, 6=sábado
  return dow === 0 || dow === 6;
}

/** Itera cada día date-only entre start y end (inclusive). */
function eachDay(start, end) {
  const out = [];
  let cur = parseDateOnly(start);
  const last = parseDateOnly(end);
  if (!cur || !last) return out;
  while (cur.getTime() <= last.getTime()) {
    out.push(toDateOnly(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Cuenta días hábiles (lun–vie) excluyendo feriados.
 * @param {Set<string>} holidaySet  Set de strings 'YYYY-MM-DD'.
 */
function countBusinessDays(start, end, holidaySet) {
  const holidays = holidaySet instanceof Set ? holidaySet : new Set(holidaySet || []);
  let count = 0;
  for (const day of eachDay(start, end)) {
    if (!isWeekend(day) && !holidays.has(day)) count += 1;
  }
  return count;
}

/** Cuenta días calendario inclusive (end - start + 1). */
function countCalendarDays(start, end) {
  const a = parseDateOnly(start);
  const b = parseDateOnly(end);
  if (!a || !b) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

/** ¿Se solapan dos rangos [aStart,aEnd] y [bStart,bEnd]? (inclusive) */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = parseDateOnly(aStart);
  const ae = parseDateOnly(aEnd);
  const bs = parseDateOnly(bStart);
  const be = parseDateOnly(bEnd);
  if (!as || !ae || !bs || !be) return false;
  return as.getTime() <= be.getTime() && bs.getTime() <= ae.getTime();
}

/** Diferencia en años completos entre dos fechas. */
function fullYearsBetween(from, to) {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return 0;
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const anniversaryThisYear = new Date(
    Date.UTC(b.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), 12),
  );
  if (b.getTime() < anniversaryThisYear.getTime()) years -= 1;
  return Math.max(0, years);
}

/** Diferencia en meses completos entre dos fechas. */
function fullMonthsBetween(from, to) {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return 0;
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Formatea a 'DD-MM-YYYY' para mostrar. */
function formatDisplay(value) {
  const iso = toDateOnly(value);
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

module.exports = {
  toDateOnly,
  parseDateOnly,
  addDays,
  isWeekend,
  eachDay,
  countBusinessDays,
  countCalendarDays,
  rangesOverlap,
  fullYearsBetween,
  fullMonthsBetween,
  formatDisplay,
};
