const db = require("../../db");
const { toDateOnly } = require("../../utils/vacationDateUtils");

/**
 * Gestión de feriados por país (tabla public_holidays).
 * Los feriados afectan el cálculo de días hábiles en Chile.
 */

/** Lista feriados de un país ordenados por fecha. */
async function listHolidays(countryCode) {
  const { rows } = await db.query(
    `SELECT id, country_code, holiday_date, name, is_recurring
     FROM public_holidays
     WHERE country_code = $1
     ORDER BY holiday_date ASC`,
    [countryCode],
  );
  return rows;
}

/**
 * Devuelve un Set de strings 'YYYY-MM-DD' de feriados de un país dentro de un
 * rango (inclusive). Usado por las estrategias para contar días hábiles.
 */
async function getHolidaySet(countryCode, startDate, endDate) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  const set = new Set();
  if (!start || !end) return set;

  const { rows } = await db.query(
    `SELECT holiday_date
     FROM public_holidays
     WHERE country_code = $1
       AND holiday_date BETWEEN $2 AND $3`,
    [countryCode, start, end],
  );
  for (const row of rows) {
    const iso = toDateOnly(row.holiday_date);
    if (iso) set.add(iso);
  }
  return set;
}

async function createHoliday({ countryCode, holidayDate, name, isRecurring = false }) {
  const date = toDateOnly(holidayDate);
  if (!countryCode || !date || !name) {
    throw new Error("País, fecha y nombre del feriado son obligatorios.");
  }
  await db.query(
    `INSERT INTO public_holidays (country_code, holiday_date, name, is_recurring)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (country_code, holiday_date)
     DO UPDATE SET name = EXCLUDED.name, is_recurring = EXCLUDED.is_recurring`,
    [countryCode, date, String(name).trim(), Boolean(isRecurring)],
  );
}

async function deleteHoliday(id) {
  await db.query("DELETE FROM public_holidays WHERE id = $1", [id]);
}

module.exports = {
  listHolidays,
  getHolidaySet,
  createHoliday,
  deleteHoliday,
};
