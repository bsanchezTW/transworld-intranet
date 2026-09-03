const db = require("../db");
const {
  DEFAULT_COLOR,
  WORK_AREA_COLORS,
} = require("../constants/workAreas");

/**
 * Asegura la columna color de work_areas y siembra los matices históricos
 * solo cuando el área sigue con el gris por defecto (no pisa un color
 * elegido en la UI).
 */
async function ensureWorkAreaSchema() {
  const client = await db.getClient();
  try {
    await client.query(
      `ALTER TABLE work_areas
         ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '${DEFAULT_COLOR}'`,
    );

    const names = Object.keys(WORK_AREA_COLORS);
    const colors = Object.values(WORK_AREA_COLORS);
    if (!names.length) return;

    await client.query(
      `UPDATE work_areas w
       SET color = v.color
       FROM UNNEST($1::varchar[], $2::varchar[]) AS v(area_name, color)
       WHERE w.area_name = v.area_name
         AND (w.color IS NULL OR lower(w.color) = lower($3))`,
      [names, colors, DEFAULT_COLOR],
    );
  } finally {
    client.release();
  }
}

module.exports = { ensureWorkAreaSchema };
