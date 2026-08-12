-- =============================================================================
-- Semillas mínimas para Intranet Perú
-- NO incluye: LinkedIn (tabla/tokens), UF, ni datos operativos de Chile.
-- =============================================================================

INSERT INTO public.work_areas (id, area_name) VALUES
  (1, 'Control y Gestión'),
  (2, 'Logística'),
  (3, 'Informática'),
  (4, 'Ventas'),
  (5, 'Gerencia'),
  (6, 'Finanzas'),
  (7, 'Eléctrica'),
  (8, 'Bodega'),
  (9, 'Comercial'),
  (10, 'Marketing'),
  (11, 'Tramonto')
ON CONFLICT (id) DO UPDATE SET area_name = EXCLUDED.area_name;

SELECT setval(
  pg_get_serial_sequence('public.work_areas', 'id'),
  (SELECT COALESCE(MAX(id), 1) FROM public.work_areas)
);

-- Menú semanal: estructura requerida por la home (días 1–5). Editar platos en PE.
INSERT INTO public.lunch_menu (day_number, dish_name) VALUES
  (1, 'Por definir'),
  (2, 'Por definir'),
  (3, 'Por definir'),
  (4, 'Por definir'),
  (5, 'Por definir')
ON CONFLICT (day_number) DO NOTHING;

-- Feriados legales Perú 2025–2026 (mismo set que vacationSchema.js)
INSERT INTO public.public_holidays (country_code, holiday_date, name) VALUES
  ('PE', '2025-01-01', 'Año Nuevo'),
  ('PE', '2025-04-17', 'Jueves Santo'),
  ('PE', '2025-04-18', 'Viernes Santo'),
  ('PE', '2025-05-01', 'Día del Trabajo'),
  ('PE', '2025-06-29', 'San Pedro y San Pablo'),
  ('PE', '2025-07-23', 'Día de la Fuerza Aérea'),
  ('PE', '2025-07-28', 'Fiestas Patrias'),
  ('PE', '2025-07-29', 'Fiestas Patrias'),
  ('PE', '2025-08-06', 'Batalla de Junín'),
  ('PE', '2025-08-30', 'Santa Rosa de Lima'),
  ('PE', '2025-10-08', 'Combate de Angamos'),
  ('PE', '2025-11-01', 'Día de Todos los Santos'),
  ('PE', '2025-12-08', 'Inmaculada Concepción'),
  ('PE', '2025-12-09', 'Batalla de Ayacucho'),
  ('PE', '2025-12-25', 'Navidad'),
  ('PE', '2026-01-01', 'Año Nuevo'),
  ('PE', '2026-04-02', 'Jueves Santo'),
  ('PE', '2026-04-03', 'Viernes Santo'),
  ('PE', '2026-05-01', 'Día del Trabajo'),
  ('PE', '2026-06-29', 'San Pedro y San Pablo'),
  ('PE', '2026-07-28', 'Fiestas Patrias'),
  ('PE', '2026-07-29', 'Fiestas Patrias'),
  ('PE', '2026-08-06', 'Batalla de Junín'),
  ('PE', '2026-08-30', 'Santa Rosa de Lima'),
  ('PE', '2026-10-08', 'Combate de Angamos'),
  ('PE', '2026-11-01', 'Día de Todos los Santos'),
  ('PE', '2026-12-08', 'Inmaculada Concepción'),
  ('PE', '2026-12-09', 'Batalla de Ayacucho'),
  ('PE', '2026-12-25', 'Navidad')
ON CONFLICT (country_code, holiday_date) DO NOTHING;
