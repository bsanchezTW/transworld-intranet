# Intranet Corporativa Transworld

<p align="center">
  <strong>Plataforma interna de Transworld Power &amp; Telcom</strong><br>
  Comunicación · Capacitaciones · RRHH · Soporte TI · Asistente de IA
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-pg-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="SharePoint" src="https://img.shields.io/badge/SharePoint-Microsoft%20Graph-0078D4?style=flat-square&logo=microsoftsharepoint&logoColor=white">
  <img alt="Claude" src="https://img.shields.io/badge/Claude-Anthropic-D97757?style=flat-square">
</p>

---

Intranet modular para centralizar el día a día de los colaboradores: comunicados, aprendizaje continuo (**Transworld Academy**), recursos humanos, tickets de TI, repositorio documental y un **asistente de IA** integrado.

## Tabla de contenidos

- [Características](#-características)
- [Stack tecnológico](#-stack-tecnológico)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Roles y permisos](#-roles-y-permisos)
- [Almacenamiento SharePoint](#-almacenamiento-sharepoint)
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
| Runtime | Node.js (CommonJS) |
| API / servidor | Express 5 |
| Vistas | EJS + `express-ejs-layouts` |
| Frontend | HTML5, CSS nativo, JavaScript (Vanilla) |
| Base de datos | PostgreSQL (`pg` pool; también `DATABASE_URL`) |
| Auth | Sesiones (`express-session`), contraseñas **PBKDF2** (SHA-256) |
| Archivos | SharePoint vía **Microsoft Graph** (`@azure/msal-node`) |
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
│   ├── services/              # SharePoint, mailer, Claude, vacaciones, APIs
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

## Almacenamiento SharePoint

Los archivos multimedia y documentales se guardan en SharePoint bajo:

```text
Content-Intranet-Transworld/public/content
```

La aplicación los expone con URLs internas `/content/...` (proxy mediante Microsoft Graph).

Variables requeridas:

```env
MS_CLIENT_ID=
MS_TENANT_ID=
MS_CLIENT_SECRET=
SP_SITE_ID=
```

---

## Variables de entorno

> Crea un archivo `.env` en la raíz (no se versiona). `SESSION_SECRET` es **obligatorio**.

### Núcleo

```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=
APP_BASE_URL=http://localhost:3000
TRUST_PROXY=false
TZ=America/Santiago
```

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
| `npm start` / `npm run dev` | Inicia el servidor Express (`src/app.js`) |
| `npm run email-listener` | Proceso aparte: escucha IMAP (`src/email-listener.js`) |

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
