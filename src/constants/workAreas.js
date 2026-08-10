/**
 * Colores distintivos para chips de áreas de trabajo (tabla work_areas).
 * Cada área tiene fondo suave + texto oscuro para buen contraste.
 */
const WORK_AREA_PILLS = {
  Informática: "pill-area-informatica",
  Logística: "pill-area-logistica",
  Bodega: "pill-area-bodega",
  Comercial: "pill-area-comercial",
  Ventas: "pill-area-ventas",
  "Control y Gestión": "pill-area-control",
  Eléctrica: "pill-area-electrica",
  Finanzas: "pill-area-finanzas",
  Gerencia: "pill-area-gerencia",
  Marketing: "pill-area-marketing",
  Tramonto: "pill-area-tramonto",
};

const WORK_AREA_LOOKUP = Object.fromEntries(
  Object.entries(WORK_AREA_PILLS).map(([name, pill]) => [
    name.toLowerCase(),
    pill,
  ]),
);

// Nombres históricos que siguen apuntando al mismo chip
WORK_AREA_LOOKUP.ti = WORK_AREA_PILLS.Informática;
WORK_AREA_LOOKUP.informatica = WORK_AREA_PILLS.Informática;

function getWorkAreaPillClass(areaName) {
  if (!areaName || areaName === "-") return "pill pill-area-default";
  const pill = WORK_AREA_LOOKUP[String(areaName).trim().toLowerCase()];
  return pill ? `pill ${pill}` : "pill pill-area-default";
}

function enrichAreaWithPill(area) {
  return {
    ...area,
    pillClass: getWorkAreaPillClass(area.area_name),
  };
}

module.exports = {
  WORK_AREA_PILLS,
  getWorkAreaPillClass,
  enrichAreaWithPill,
};
