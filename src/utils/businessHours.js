const { addDays, isWeekend, toDateOnly } = require("./vacationDateUtils");

const TZ = "America/Santiago";

/** Partes de fecha/hora en zona America/Santiago. */
function getZonedParts(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

function getSantiagoDateOnly(date) {
  const p = getZonedParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Convierte fecha/hora local Santiago a timestamp UTC (ms). */
function santiagoLocalToUtcMs(year, month, day, hour, minute, second = 0) {
  let ms = Date.UTC(year, month - 1, day, hour + 3, minute, second);
  for (let i = 0; i < 10; i++) {
    const p = getZonedParts(new Date(ms));
    const dy = year - Number(p.year);
    const dm = month - Number(p.month);
    const dd = day - Number(p.day);
    const dh = hour - Number(p.hour);
    const dmin = minute - Number(p.minute);
    const ds = second - Number(p.second);
    if (dy === 0 && dm === 0 && dd === 0 && dh === 0 && dmin === 0 && ds === 0) break;
    ms += ((dd * 24 + dh) * 60 + dmin) * 60 * 1000 + ds * 1000;
  }
  return ms;
}

function santiagoLocalToDate(dateStr, hour, minute, second = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(santiagoLocalToUtcMs(y, m, d, hour, minute, second));
}

/**
 * Ventana laboral del día (dow UTC-date-only: 0=dom … 6=sáb).
 * lun–jue 9:00–18:30, vie 9:00–15:30.
 */
function getBusinessWindowForDay(dow) {
  if (dow >= 1 && dow <= 4) {
    return { startHour: 9, startMinute: 0, endHour: 18, endMinute: 30 };
  }
  if (dow === 5) {
    return { startHour: 9, startMinute: 0, endHour: 15, endMinute: 30 };
  }
  return null;
}

function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function isBusinessDay(dateStr, holidaySet) {
  if (isWeekend(dateStr)) return false;
  const holidays = holidaySet instanceof Set ? holidaySet : new Set(holidaySet || []);
  return !holidays.has(dateStr);
}

/**
 * Minutos hábiles entre dos instantes (solo horario de oficina, sin noches/fines de semana/feriados).
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @param {Set<string>} holidaySet  Fechas 'YYYY-MM-DD' (Chile)
 */
function countBusinessMinutes(startDate, endDate, holidaySet) {
  if (!startDate || !endDate) return 0;
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  let totalMinutes = 0;
  let currentDay = getSantiagoDateOnly(start);
  const lastDay = getSantiagoDateOnly(end);

  while (currentDay <= lastDay) {
    if (isBusinessDay(currentDay, holidaySet)) {
      const window = getBusinessWindowForDay(getDayOfWeek(currentDay));
      if (window) {
        const windowStart = santiagoLocalToDate(
          currentDay,
          window.startHour,
          window.startMinute,
        );
        const windowEnd = santiagoLocalToDate(
          currentDay,
          window.endHour,
          window.endMinute,
        );
        const overlapStart = Math.max(start.getTime(), windowStart.getTime());
        const overlapEnd = Math.min(end.getTime(), windowEnd.getTime());
        if (overlapEnd > overlapStart) {
          totalMinutes += Math.floor((overlapEnd - overlapStart) / 60000);
        }
      }
    }
    if (currentDay === lastDay) break;
    currentDay = addDays(currentDay, 1);
  }

  return totalMinutes;
}

function formatBusinessDuration(totalMinutes) {
  if (totalMinutes == null || totalMinutes < 0) return "-";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalMinutes < 1440) {
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }
  return `${Math.floor(totalMinutes / 1440)}d ${Math.floor((totalMinutes % 1440) / 60)}h`;
}

module.exports = {
  TZ,
  countBusinessMinutes,
  formatBusinessDuration,
  getSantiagoDateOnly,
  isBusinessDay,
};
