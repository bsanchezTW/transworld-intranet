# Intranet Corporativa Transworld

<p align="center">
  <strong>Plataforma interna de Transworld Power &amp; Telcom</strong><br>
  Comunicación · Capacitaciones · RRHH · Soporte TI · Asistente de IA
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-pg-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="Supabase Storage" src="https://img.shields.io/badge/Supabase-Storage-3FCF8E?style=flat-square&logo=supabase&logoColor=white">
  <img alt="Claude" src="https://img.shields.io/badge/Claude-Anthropic-D97757?style=flat-square">
</p>

---

Intranet modular para centralizar el día a día de los colaboradores: comunicados, aprendizaje continuo (**Transworld Academy**), recursos humanos, tickets de TI, repositorio documental y un **asistente de IA** integrado.

## Tabla de contenidos

- [Características](#-características)
- [Stack tecnológico](#-stack-tecnológico)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Roles y permisos](#-roles-y-permisos)
- [Almacenamiento Supabase](#-almacenamiento-supabase)
- [Variables de entorno](#-variables-de-entorno)
- [Puesta en marcha](#-puesta-en-marcha)
- [Procesos en segundo plano](#-procesos-en-segundo-plano)

---

## Características

### Dashboard (Inicio)

Panel central con:

- Indicadores financieros en tiempo real (Dólar, Euro, UF)
- Clima local
- Feed de LinkedIn de la empresa
- Menú de almuerzo semanal
- Próximos cumpleaños
- Carrusel de noticias y eventos destacados

### Transworld Academy (LMS)

Sistema de aprendizaje por áreas:

| Área | Ruta |
|------|------|
| Equipamiento Activo | `/cursos/equipamiento-activo` |
| Fibra Óptica | `/cursos/fibra-optica` |
| Infraestructura | `/cursos/infraestructura` |
| Safety Machine | `/cursos/safety-machine` |

Incluye seguimiento de progreso de videos, evaluaciones con nota mínima de aprobación y **dashboard de KPIs** (`/kpi-cursos`) para medir el rendimiento de los colaboradores.

### Asistente Claude (IA)

Chat integrado (`/claude`) con el SDK de Anthropic:

- Respuestas en español, orientadas a tareas operativas internas
- Análisis de documentos adjuntos (Word, Excel, PDF, CSV, etc.)
- Generación y edición de archivos descargables en el mismo formato de origen
- Límites diarios en marcha blanca (mensajes y archivos) para uso estable compartido
- Administradores pueden elegir modelo; el resto usa el modelo por defecto (Haiku)

### Recursos Humanos

- Directorio de personal y organigrama dinámico
- Accesos a portales externos (Rex+, ACHS, Caja Los Andes)
- **Vacaciones** (`/RRHH/vacaciones`): solicitudes, saldos, feriados, calendario y gestión RRHH
  - Reglas por país con estrategias **Chile** y **Perú**
  - Notificaciones por correo y transiciones automáticas de estado

### Comunicaciones y Marketing

- Noticias corporativas con multimedia, destacados y alertas por correo
- Eventos (creación, edición, detalle)
- Formulario público de registro a eventos con envío de **QR** (`/registro-forms`)

### Repositorio documental (Procesos)

Gestor categorizado (Procedimientos, Protocolos, Reglamento Interno) con permisos de lectura/escritura según rol.

### Soporte TI (Tickets)

Help Desk interno: creación, asignación, historial de respuestas, adjuntos y alertas por correo. Cierre automático de tickets en “pendiente de cierre”.

### Directorio de aplicaciones

Descarga de herramientas internas (APK, enlaces de PC y códigos QR para iOS), con notificaciones a colaboradores.

### Perfil de usuario

Edición de datos personales, foto de perfil, cambio de contraseña y preferencias de tema.

---

## Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Runtime | Node.js 22+ (CommonJS) |
| API / servidor | Express 5 |
| Vistas | EJS + `express-ejs-layouts` |
| Frontend | HTML5, CSS nativo, JavaScript (Vanilla) |
| Base de datos | PostgreSQL (`pg` pool; también `DATABASE_URL`) |
| Auth | Sesiones (`express-session`), contraseñas **PBKDF2** (SHA-256) |
| Archivos | **Supabase Storage** privado, servido por Express |
| Correo | **Brevo** (`@getbrevo/brevo`) |
| IA | **Anthropic Claude** (`@anthropic-ai/sdk`) |
| Office | ExcelJS, Mammoth, PDFKit, html-to-docx, XLSX |
| Otros | QRCode, Multer, Compression, IMAP (listener de correo) |

---

## Estructura del proyecto

```text
intranet-transworld-ai/
├── src/
│   ├── app.js                 # Entrada del servidor, middlewares y cron jobs
│   ├── db.js                  # Pool PostgreSQL
│   ├── email-listener.js      # Proceso IMAP opcional
│   ├── constants/             # Roles, límites Claude, config vacaciones
│   ├── middlewares/           # Auth por rol, límites de IA
│   ├── routes/                # auth, index, RRHH, tickets, claude, …
│   ├── services/              # Storage, mailer, Claude, vacaciones, APIs
│   ├── utils/                 # Helpers (teléfono, fechas, schema mappers)
│   ├── views/                 # Plantillas EJS por módulo
│   ├── public/                # CSS, JS e imágenes estáticas
│   └── registro-forms/        # Formulario autónomo de eventos + QR
├── package.json
└── README.md
```

**Rutas principales montadas en la app:**

| Prefijo | Módulo |
|---------|--------|
| `/` | Auth, home, cursos, apps, perfil |
| `/procesos` | Documentación interna |
| `/RRHH` | Personal, organigrama, vacaciones |
| `/sistemas` | Tickets de soporte |
| `/marketing` | Eventos |
| `/noticias` | Noticias |
| `/claude` | Asistente de IA |
| `/registro` · `/registro-forms` | Registro de eventos |

---

## Roles y permisos

Modelo RBAC con tres roles oficiales:

| Rol | Acceso |
|-----|--------|
| `Usuario` | Inicia sesión y usa las funciones de colaborador |
| `Administrador` | Paneles y acciones de administración (escritura en módulos) |
| `Deshabilitado` | No puede iniciar sesión |

Los roles históricos por área (`rrhh`, `marketing`, `gerencia`, `ventas`, etc.) se conservan como **alias de compatibilidad** y se tratan como `Administrador` en rutas protegidas.

Permisos de escritura relevantes (solo administrador): noticias, personas, organigrama, eventos, apps, cursos, procesos y gestión de vacaciones. Cualquier usuario activo puede solicitar vacaciones.

---

## Almacenamiento Supabase

Cada instancia usa un proyecto Supabase independiente para **BD + Storage**:

- Chile: proyecto `dgadjvptxhotjylwsglx`.
- Perú: project ref propio, configurado únicamente en el deployment PE.

El bucket `intranet-content` es privado y tiene un límite de 250 MiB. El
navegador nunca recibe una clave Supabase: los objetos se sirven por `/content`
con sesión o por `/media/<firma>/...` para imágenes de correo. Las rutas
`public_id` guardadas en BD no dependen del proveedor.

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PROJECT_REF_CL=dgadjvptxhotjylwsglx # en PE usar SUPABASE_PROJECT_REF_PE
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=intranet-content
SUPABASE_STORAGE_MAX_FILE_SIZE_MB=250
SUPABASE_STORAGE_TUS_THRESHOLD_MB=6
SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB=6
```

Además del límite SQL del bucket, cada proyecto debe configurar en **Storage →
Settings** un límite global de archivos de al menos **250 MiB**. El límite del
bucket no puede elevar el máximo global del proyecto. El chunk TUS se mantiene
fijo en 6 MiB, requisito de Supabase salvo el último fragmento.

La app rechaza el arranque si detecta que el project ref de la BD y el de
Storage son distintos. Además vincula `COUNTRY=CL` al proyecto Chile conocido;
Perú exige `SUPABASE_PROJECT_REF_PE` y rechaza explícitamente el ref chileno.
Así, cambiar solo `COUNTRY` no puede reutilizar por accidente las credenciales
del otro país. Las subidas de más de 6 MiB usan TUS reanudable; los
proxies soportan `HEAD`, streaming y rangos HTTP sin cargar el archivo completo.
Los límites funcionales del servidor son: foto de perfil 5 MiB; eventos 10 MiB
por imagen y 100 MiB por video; organigrama y documentos de procesos 20 MiB;
material de cursos y adjuntos de tickets 40 MiB; y noticias hasta 200 MiB
(imagen 20, PDF 40, Word 25 y video 200 MiB). Los videos de eventos y noticias
se almacenan primero en un temporal y TUS los lee por chunks, de modo que no
ocupan el tamaño completo del archivo en el heap de Node.

### Migración one-shot desde Microsoft Graph

Graph ya no es una dependencia del runtime. El único código que lo consulta es
el migrador autónomo `scripts/migrate-sharepoint-to-supabase.js`, mediante REST.
Para una migración se cargan temporalmente `MS_CLIENT_ID`, `MS_TENANT_ID`,
`MS_CLIENT_SECRET` y `SP_SITE_ID`, además de las variables Supabase del destino.

```bash
# Inventario + SHA-256, sin escribir en Supabase
npm run migrate:storage -- --country=CL --source-manifest-only

# Copia reanudable y verificación completa del destino
npm run migrate:storage -- --country=CL
```

El script pagina Graph completamente, omite exactamente `eventos/`, usa TUS
para objetos grandes y guarda journal/manifiesto bajo `.migration/`. No elimina
los originales de Graph.

---

## Variables de entorno

> Crea un archivo `.env` en la raíz (no se versiona). `SESSION_SECRET` es **obligatorio**.

### Núcleo

```env
COUNTRY=CL
PORT=3000
NODE_ENV=development
SESSION_SECRET=
APP_BASE_URL=http://localhost:3000
TRUST_PROXY=false
```

> **`COUNTRY` es obligatoria** (`CL` o `PE`). Declara a qué país pertenece la
> instancia y de ella se derivan la zona horaria, el locale, el dominio de
> correo corporativo y el nombre de la cookie de sesión. Si falta o trae un
> valor no registrado, la aplicación **no arranca**: no existe un valor por
> defecto, porque asumir Chile en una instancia de Perú produce cálculos de
> vacaciones incorrectos.
>
> `TZ` ya no se configura por `.env`: la fija el país
> (`America/Santiago` en Chile, `America/Lima` en Perú).

### Base de datos

```env
# Opción A
DATABASE_URL=postgresql://user:pass@host:5432/db

# Opción B
DB_HOST=
DB_PORT=5432
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_SSL=false
```

### Registro público de eventos (proyecto Supabase aparte)

El formulario `/registro-forms` usa **otro** proyecto Supabase (API + anon/publishable key),
no la BD Postgres de la intranet. Las credenciales viven solo en el servidor; nunca en el HTML.

```env
REGISTRO_SUPABASE_URL=https://xxxxxxxx.supabase.co
REGISTRO_SUPABASE_PB_KEY=
# o: REGISTRO_SUPABASE_PUBLISHABLE_KEY=
```

### Correo (Brevo)

```env
BREVO_API_KEY=
MAIL_FROM=noreply@transworld.cl
ADMIN_NOTIFY_EMAIL=
```

### Claude (IA)

```env
ANTHROPIC_API_KEY=
CLAUDE_MAX_FILE_SIZE=10
CLAUDE_MAX_DOC_CHARS=120000
CLAUDE_MAX_EXPORT_CHARS=500000
```

### Vacaciones (opcionales)

```env
VACATION_RRHH_EMAIL=rrhh@transworld.cl
VACATION_MIN_NOTICE_DAYS_CL=15
VACATION_MIN_NOTICE_DAYS_PE=7
VACATION_MIN_FRACTION_DAYS_PE=7
```

### LinkedIn / clima / listener IMAP (opcionales)

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_ORG_ID=
LINKEDIN_CALLBACK_URL=
LINKEDIN_ENABLED=true

IMAP_HOST=outlook.office365.com
IMAP_PORT=993
IMAP_USER=
IMAP_PASS=
```

---

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Configurar .env (ver sección anterior)

# 3. Desarrollo / producción
npm run dev
# o
npm start
```

La app escucha en `http://localhost:3000` (o el `PORT` definido).

### Scripts disponibles

| Script | Descripción |
|--------|-------------|
| `npm start` / `npm run dev` | Inicia el servidor Express (`src/app.js`) con el `.env` de la raíz |
| `npm run dev:cl` | Instancia **Chile** en `:3000` (`.env.cl.local`) |
| `npm run dev:pe` | Instancia **Perú** en `:3001` (`.env.pe.local`) |
| `npm test` | Suite de Node (`node --test`) |
| `npm run migrate:storage -- --country=CL` | Copia y verifica Graph → Storage; omite `eventos/` |
| `npm run email-listener` | Proceso aparte: escucha IMAP (`src/email-listener.js`) |

### Trabajar con los dos países a la vez

```bash
cp .env.cl.example .env.cl.local
```

```bash
cp .env.pe.example .env.pe.local
```

Completa cada uno con las credenciales **de su propio país** y levanta ambos en
terminales separadas. Las instancias usan cookies de sesión distintas
(`tw_sid_cl` / `tw_sid_pe`), así que iniciar sesión en una no cierra la otra
pese a compartir `localhost`.

Precedencia de configuración: variables del entorno → `.env.<pais>.local` → `.env`.

---

## Procesos en segundo plano

Al arrancar el servidor se ejecutan tareas programadas:

| Tarea | Frecuencia | Acción |
|-------|------------|--------|
| Cierre de tickets | Cada 1 h | Cierra tickets en `pending_close` con más de 1 día |
| Limpieza de historial | Cada 12 h | Elimina `change_log` con más de 5 días |
| Vacaciones | Cada 12 h | Transiciones de estado (en curso / completadas) |
| Home (indicadores) | Cada 15 min | Actualiza divisas, clima y LinkedIn en caché |

Además, al iniciar se aseguran índices/columnas críticas (email único, noticias destacadas, schema de vacaciones) y se sincronizan usuarios no verificados hacia el rol `Deshabilitado`.

---

<p align="center">
  <sub>Intranet Transworld · Uso interno</sub>
</p>
