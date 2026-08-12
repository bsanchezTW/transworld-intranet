# Supabase — Intranet Perú (duplicado de Chile)

Fuente: proyecto **INTRANET CHILE - TW_P&T** (`dgadjvptxhotjylwsglx`, región `us-west-2`, Postgres 17).

## Arquitectura relevante

| Pieza | Proyecto Supabase | Uso en la app |
| --- | --- | --- |
| BD intranet | **INTRANET CHILE** (este esquema) | `pg` Pool vía `DATABASE_URL` / `DB_*` |
| Registro de eventos | **NEXUS - TW_P&T** (`evjocwzmlsyjixzihxep`) | Servicio aparte (`projects/registro-forms`); en intranet solo Chile (`features.eventRegistration`) |
| Edge Functions | Ninguna en el proyecto intranet | Auth propia en `users.password_hash` |

La instancia Perú **no** necesita las Edge Functions de NEXUS para arrancar. Esas viven en el proyecto de registro/acreditación (`registro-forms`) y hoy están deshabilitadas para PE (`src/config/features.js`).

## Cómo provisionar

1. Crear proyecto en org **Transworld Power & Telcom**, p. ej. `INTRANET PERU - TW_P&T` (misma región `us-west-2` o la que elijan).
2. En el SQL Editor (o `psql` con la connection string):

```bash
# Orden obligatorio
psql "$DATABASE_URL" -f supabase/peru/01_schema.sql
psql "$DATABASE_URL" -f supabase/peru/02_seed.sql
psql "$DATABASE_URL" -f supabase/peru/03_storage.sql
```

3. Configurar `.env` de la instancia PE:

```env
COUNTRY=PE
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
DB_SSL=true
APP_BASE_URL=https://intranet.transworld.pe   # o la URL real
SESSION_SECRET=...
SUPABASE_URL=https://PROJECT_REF_PERU.supabase.co
SUPABASE_PROJECT_REF_PE=PROJECT_REF_PERU
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=intranet-content
```

   En **Storage → Settings** del proyecto PE, fijar también el límite global de
   archivos en al menos 250 MiB; `03_storage.sql` solo configura el límite del
   bucket y no puede elevar el máximo global del proyecto.

4. Arrancar la app: al boot aplicará `ensureVacationSchema()` (idempotente) y sembrará feriados PE si faltan.

## Qué se copia y qué no

**Sí (schema + catálogos):** tablas, índices, FKs, enum, función `marcar_recuperacion_pass`, buckets privados `installer_apps` e `intranet-content`, áreas de trabajo, menú almuerzo (estructura), feriados PE.

**No (capacidades solo Chile):**
- tabla `linkedin_posts` y tokens LinkedIn en `system_config`
- contador UF (no existe en BD; en la app se apaga con feature `chileUfIndicator`)

**No (datos operativos de Chile):** usuarios, tickets, noticias, cursos/progreso, vacaciones, archivos de Storage, sesiones.

**Default distinto a Chile:** `users.employment_country` → `'PE'`.

Features de app relacionadas (`src/config/features.js`): `linkedinFeed=false`, `chileUfIndicator=false` en PE.

## RLS

En Chile todas las tablas `public` tienen RLS **activado** pero **sin policies**. La app Node usa conexión Postgres directa (bypass RLS como rol con privilegios). Este dump replica ese estado. Si más adelante abren la Data API con anon key, hay que definir policies antes.
