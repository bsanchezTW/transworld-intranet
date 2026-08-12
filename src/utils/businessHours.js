const { addDays, isWeekend, toDateOnly } = require("./vacationDateUtils");
const { getCountryConfig } = require("../config/country");

/** Zona horaria de la instancia (Chile: America/Santiago, Perú: America/Lima). */
function getTZ() {
  return getCountryConfig().timezone;
}

/** Partes de fecha/hora en la zona de la instancia. */
function getZonedParts(date, timeZone = getTZ()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

/** Fecha 'YYYY-MM-DD' de un instante en la zona de la instancia. */
function getLocalDateOnly(date, timeZone = getTZ()) {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Convierte una fecha/hora local de la instancia a timestamp UTC (ms).
 *
 * Parte de una estimación y corrige iterando, así que no depende de conocer el
 * offset ni el estado del horario de verano: sirve igual para UTC−3 (Santiago)
 * que para UTC−5 (Lima).
 */
function zonedLocalToUtcMs(year, month, day, hour, minute, second = 0, timeZone = getTZ()) {
  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 10; i++) {
    const p = getZonedParts(new Date(ms), timeZone);
    const dy = year - Number(p.year);
    const dm = month - Number(p.month);
    const dd = day - Number(p.day);
    const dh = hour - Number(p.hour);
    const dmin = minute - Number(p.minute);
    const ds = second - Number(p.second);
    if (dy === 0 && dm === 0 && dd === 0 && dh === 0 && dmin === 0 && ds === 0) break;
    ms +=
      ((dy * 365 + dm * 30 + dd) * 24 + dh) * 60 * 60 * 1000 +
      dmin * 60 * 1000 +
      ds * 1000;
  }
  return ms;
}

function zonedLocalToDate(dateStr, hour, minute, second = 0, timeZone = getTZ()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(zonedLocalToUtcMs(y, m, d, hour, minute, second, timeZone));
}

/**
 * Ventana laboral del día (dow UTC-date-only: 0=dom … 6=sáb).
 * La jornada se declara en config/country.js por país.
 */
function getBusinessWindowForDay(dow, businessHours = getCountryConfig().businessHours) {
  if (dow >= 1 && dow <= 4) {
    return businessHours.weekday;
  }
  if (dow === 5) {
    return businessHours.friday;
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
 * @param {Set<string>} holidaySet  Fechas 'YYYY-MM-DD' del país de la instancia
 */
function countBusinessMinutes(startDate, endDate, holidaySet) {
  if (!startDate || !endDate) return 0;
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  const { timezone, businessHours } = getCountryConfig();
  let totalMinutes = 0;
  let currentDay = getLocalDateOnly(start, timezone);
  const lastDay = getLocalDateOnly(end, timezone);

  while (currentDay <= lastDay) {
    if (isBusinessDay(currentDay, holidaySet)) {
      const window = getBusinessWindowForDay(getDayOfWeek(currentDay), businessHours);
      if (window) {
        const windowStart = zonedLocalToDate(
          currentDay,
          window.startHour,
          window.startMinute,
          0,
          timezone,
        );
        const windowEnd = zonedLocalToDate(
          currentDay,
          window.endHour,
          window.endMinute,
          0,
          timezone,
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
  getTZ,
  countBusinessMinutes,
  formatBusinessDuration,
  getLocalDateOnly,
  isBusinessDay,
};
