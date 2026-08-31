// ================================
// Zona horaria y Configuración
// ================================
// config/env valida el entorno y falla el arranque si COUNTRY (u otra variable
// obligatoria) falta o es inválida. Va primero: db.js y los servicios leen
// process.env al ser requeridos.
const { countryConfig } = require("./config/env");

// La zona horaria sale de la instancia, no de un literal: Chile es
// America/Santiago y Perú America/Lima.
process.env.TZ = countryConfig.timezone;

const express = require("express");
const compression = require("compression");
const path = require("path");
const { pipeline } = require("stream/promises");
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");
const db = require("./db");
// ================================
// Importación de Rutas
// ================================
const authRoutes = require("./routes/auth");
const indexRoutes = require("./routes/index");
const procesosRoutes = require("./routes/procesos");
const personasRoutes = require("./routes/RRHH");
const ticketsRoutes = require("./routes/tickets");
const marketingRoutes = require("./routes/marketing");
const docsRoutes = require("./routes/docs");
const noticiasRoutes = require("./routes/noticias");
const claudeRoutes = require("./routes/claude");
const { ROLES, normalizeRole, isAdministrador } = require("./constants/roles");
const { formatPageTitle } = require("./utils/pageTitle");
const { phoneClientConfig } = require("./utils/phone");
const requireFeature = require("./middlewares/requireFeature");
const { getFeatures, isFeatureEnabled } = require("./config/features");
const { syncUnverifiedUsersToDisabled } = require("./utils/syncDisabledUsers");
const storageService = require("./services/storage/storageService");
const {
  isActiveContentType,
  contentDispositionFor,
} = require("./services/storage/storageHttp");
const signedMedia = require("./services/media/signedMedia");
const { ensureVacationSchema } = require("./services/vacations/vacationSchema");
const vacationRequestService = require("./services/vacations/vacationRequestService");

// ================================
// Inicializar app
// ================================
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET?.trim();

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : reason;
  console.error("[unhandledRejection]", message);
});

if (
  process.env.NODE_ENV === "production" ||
  process.env.TRUST_PROXY === "true"
) {
  app.set("trust proxy", 1);
}

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET es obligatorio. Configúralo en el archivo .env.");
}

// ================================
// Motor de vistas + layouts
// ================================
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");
app.locals.formatPageTitle = formatPageTitle;
// Formato de celular del país, para inyectarlo al script de cliente.
app.locals.phoneClientConfig = phoneClientConfig;

// ================================
// Middlewares Básicos
// ================================
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const staticOptions = { maxAge: "1d", etag: true };
app.use(express.static(path.join(__dirname, "public"), staticOptions));
// FIX: Servir archivos estáticos desde <root>/public (donde vive public/uploads unificado)
app.use(express.static(path.join(__dirname, "..", "public"), staticOptions));

function setStorageHeaders(res, file, fallbackContentType) {
  const contentType =
    file.contentType || fallbackContentType || "application/octet-stream";
  const activeContent = isActiveContentType(contentType);
  // El objeto sigue conservando su metadata real en Storage, pero por HTTP el
  // contenido activo se fuerza a descarga binaria para que nunca se interprete
  // en el origen de la intranet.
  res.set("Content-Type", activeContent ? "application/octet-stream" : contentType);

  const contentLength = Number(file.contentLength ?? file.size);
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    res.set("Content-Length", String(contentLength));
  }
  if (file.contentRange) res.set("Content-Range", file.contentRange);
  if (file.etag) res.set("ETag", file.etag);
  if (file.lastModified) {
    const modified = new Date(file.lastModified);
    if (!Number.isNaN(modified.getTime())) {
      res.set("Last-Modified", modified.toUTCString());
    }
  }
  res.set("Accept-Ranges", "bytes");
  res.set("X-Content-Type-Options", "nosniff");
  if (activeContent) {
    res.set("Content-Disposition", contentDispositionFor(file));
    res.set("Content-Security-Policy", "sandbox; default-src 'none'");
  }
}

function storageRequestContext(req) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  return {
    signal: controller.signal,
    cleanup: () => req.removeListener("aborted", abort),
  };
}

// ================================
// Medios públicos firmados (/media/<firma>/<ruta>)
// ================================
// Va ANTES de la sesión a propósito: los clientes de correo piden las imágenes
// sin cookies. La firma HMAC hace la URL inadivinable y solo se aceptan
// imágenes; documentos y videos siguen exigiendo sesión vía /content.
app.use("/media", async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const raw = req.path.replace(/^\//, "");
  const separator = raw.indexOf("/");
  if (separator === -1) return res.status(404).send("No encontrado");

  const signature = raw.slice(0, separator);
  let relativePath;
  try {
    relativePath = storageService.normalizeRelativePath(
      decodeURIComponent(raw.slice(separator + 1)),
    );
  } catch {
    return res.status(400).send("Ruta inválida");
  }

  if (!relativePath || !signedMedia.isPubliclyServable(relativePath)) {
    return res.status(404).send("No encontrado");
  }
  if (!signedMedia.verify(relativePath, signature)) {
    return res.status(403).send("Firma inválida");
  }

  let requestContext;
  try {
    if (req.method === "HEAD") {
      const metadata = await storageService.statFile(relativePath);
      const tipo = metadata.contentType || signedMedia.contentTypeFor(relativePath);
      if (!signedMedia.isSafeContentType(tipo)) {
        return res.status(404).send("No encontrado");
      }
      setStorageHeaders(res, metadata, tipo);
      res.set("Cache-Control", "public, max-age=31536000, immutable, no-transform");
      return res.end();
    }

    requestContext = storageRequestContext(req);
    const file = await storageService.downloadStream(relativePath, {
      range: req.get("range") || undefined,
      signal: requestContext.signal,
    });
    const tipo = file.contentType || signedMedia.contentTypeFor(relativePath);

    // Comprobación final: por esta ruta pública solo salen imágenes. Cubre los
    // adjuntos heredados sin extensión, donde la ruta no basta para decidirlo.
    if (!signedMedia.isSafeContentType(tipo)) {
      file.stream.destroy();
      return res.status(404).send("No encontrado");
    }

    // Las rutas incluyen timestamp + aleatorio, por lo que son inmutables.
    res.status(file.statusCode || 200);
    setStorageHeaders(res, file, tipo);
    res.set("Cache-Control", "public, max-age=31536000, immutable, no-transform");
    await pipeline(file.stream, res);
    return undefined;
  } catch (err) {
    if (requestContext?.signal.aborted || err?.name === "AbortError") {
      return undefined;
    }
    if (res.headersSent) {
      res.destroy(err);
      return undefined;
    }
    if (err.statusCode === 404) return res.status(404).send("Archivo no encontrado");
    if (err.statusCode === 416) return res.status(416).send("Rango no válido");
    console.error("[Media proxy] Error:", err.message || err);
    return res.status(502).send("Error al obtener el archivo");
  } finally {
    requestContext?.cleanup();
  }
});

// ================================
// Sesiones (antes de /content para poder exigir auth)
// ================================
app.use(
  session({
    // El nombre lleva el país porque las cookies se comparten entre puertos del
    // mismo host: sin esto, Chile en :3000 y Perú en :3001 se pisan la sesión.
    name: countryConfig.sessionCookieName,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // ¡CLAVE! Renueva el tiempo de la cookie en cada petición al backend
    cookie: { maxAge: 1000 * 60 * 60 * 4 }, // Aumentamos la base a 4 horas por seguridad
  }),
);

// FIX: Unificado → <root>/public/uploads sirve /uploads/*
app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads"), { maxAge: "7d", etag: true }));

// Archivos multimedia y documentos desde Storage (/content/...)
// Requiere sesión activa; no exponer contenido corporativo de forma pública.
app.use("/content", async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const hasSessionUser = Boolean(req.session && req.session.user);
  if (!hasSessionUser) {
    return res.status(401).send("No autorizado");
  }

  let relativePath;
  try {
    relativePath = storageService.normalizeRelativePath(
      decodeURIComponent(req.path.replace(/^\//, "")),
    );
  } catch {
    return res.status(400).send("Ruta inválida");
  }
  if (!relativePath) return next();

  let requestContext;
  try {
    if (req.method === "HEAD") {
      const metadata = await storageService.statFile(relativePath);
      setStorageHeaders(res, metadata);
      res.set("Cache-Control", "private, max-age=300, no-transform");
      return res.end();
    }

    requestContext = storageRequestContext(req);
    const file = await storageService.downloadStream(relativePath, {
      range: req.get("range") || undefined,
      signal: requestContext.signal,
    });
    res.status(file.statusCode || 200);
    setStorageHeaders(res, file);
    res.set("Cache-Control", "private, max-age=300, no-transform");
    await pipeline(file.stream, res);
    return undefined;
  } catch (err) {
    if (requestContext?.signal.aborted || err?.name === "AbortError") {
      return undefined;
    }
    if (res.headersSent) {
      res.destroy(err);
      return undefined;
    }
    if (err.statusCode === 400) {
      return res.status(400).send("Ruta inválida");
    }
    if (err.statusCode === 404) {
      return res.status(404).send("Archivo no encontrado");
    }
    if (err.statusCode === 416) {
      return res.status(416).send("Rango no válido");
    }
    console.error("[Content proxy] Error:", err.message || err);
    return res.status(502).send("Error al obtener el archivo");
  } finally {
    requestContext?.cleanup();
  }
});

// ================================
// Variables Globales y Permisos
// ================================
app.use((req, res, next) => {
  const user = req.session.user;

  // Identidad de la instancia disponible en todas las vistas.
  res.locals.country = countryConfig.code;
  res.locals.countryConfig = countryConfig;
  // Capacidades de la instancia, para filtrar navegación y bloques de UI.
  res.locals.features = getFeatures();

  res.locals.usuario = req.session.user || null;

  if (user) {
    const role = normalizeRole(user.role);
    res.locals.userRole = role;
    res.locals.isAdministrador = isAdministrador(role);

    res.locals.can = {
      procedimientos_write: isAdministrador(role),
      protocolos_write: isAdministrador(role),
      reglamento_write: isAdministrador(role),
      noticias_write: isAdministrador(role),
      personas_write: isAdministrador(role),
      organigrama_write: isAdministrador(role),
      achs_write: isAdministrador(role),
      eventos_write: isAdministrador(role),
      tickets_reply: isAdministrador(role),
      apps_write: isAdministrador(role),
      cursos_write: isAdministrador(role),
      vacaciones_write: isAdministrador(role),
      vacaciones_request:
        role === ROLES.USUARIO || isAdministrador(role),
    };
    res.locals.unreadTickets = req.session.ticketNotifications?.count || 0;
  } else {
    res.locals.can = {};
    res.locals.unreadTickets = 0;
  }
  next();
});

// ================================
// Middleware de protección
// ================================
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect("/login");
}

// ================================
// Montaje de Rutas
// ================================
app.use("/", authRoutes); // Login/Registro (Públicas)
// Rutas Protegidas
app.use("/", requireAuth, indexRoutes);
app.use("/procesos", requireAuth, procesosRoutes);
app.use("/RRHH", requireAuth, personasRoutes);
app.use("/sistemas", requireAuth, requireFeature("supportTickets"), ticketsRoutes);
app.use("/marketing", requireAuth, marketingRoutes);
app.use("/docs", requireAuth, docsRoutes);
app.use("/noticias", requireAuth, noticiasRoutes);
app.use("/claude", requireAuth, requireFeature("claudeAssistant"), claudeRoutes);

// Multer corta el body antes de entrar al handler cuando supera el límite.
// Convertimos ese error en 413 para evitar que termine como un 500 genérico.
app.use((err, req, res, next) => {
  if (err?.code !== "LIMIT_FILE_SIZE") return next(err);

  const message = "El archivo excede el límite de subida permitido.";
  const acceptsJson =
    req.xhr ||
    req.get("accept")?.includes("application/json") ||
    req.originalUrl.includes("/upload") ||
    req.originalUrl.startsWith("/noticias");

  if (acceptsJson) return res.status(413).json({ error: message });
  return res.status(413).send(message);
});

// Manejo de 404
app.use((req, res) => {
  res.status(404).render("404", { titulo: "Página no encontrada" });
});

// ==========================================
// TAREA 1: CERRAR TICKETS ANTIGUOS
// ==========================================
function iniciarTareaCierreTickets() {
  const ejecutarCierre = async () => {
    try {
      const sql = `
        UPDATE support_tickets 
        SET status = 'closed', closed_at = NOW(), auto_closed = TRUE
        WHERE status = 'pending_close' 
        AND resolved_at < (NOW() - INTERVAL '1 day')
      `;

      const result = await db.query(sql);
      const afectados = result.rowCount || result.affectedRows || 0;

      if (afectados > 0) {
        console.log(
          `[CRON ${countryConfig.code}] Se cerraron automáticamente ${afectados} tickets en "Pendiente de cierre" hace más de 1 día.`,
        );
      }
    } catch (err) {
      console.error(`[CRON ${countryConfig.code}] Error en tarea automática de tickets:`, err);
    }
  };

  // Ejecutar inmediatamente al iniciar el servidor para limpiar los tickets rezagados
  ejecutarCierre();

  // Y luego continuar ejecutando la revisión cada 1 hora
  setInterval(ejecutarCierre, 3600000);
}

// ==========================================
// TAREA 2: LIMPIEZA DE HISTORIAL
// ==========================================
function iniciarLimpiezaHistorial() {
  const ejecutarLimpieza = async () => {
    try {
      const sql = `
        DELETE FROM change_log 
        WHERE created_at < (NOW() - INTERVAL '5 days')
      `;

      const result = await db.query(sql);
      const borrados = result.rowCount || result.affectedRows || 0;

      if (borrados > 0) {
        console.log(
          `[CRON ${countryConfig.code}] Limpieza ejecutada: Se eliminaron ${borrados} registros antiguos.`,
        );
      }
    } catch (err) {
      console.error(`[CRON ${countryConfig.code}] Error en tarea de limpieza de historial:`, err);
    }
  };

  // Ejecutar inmediatamente al iniciar
  ejecutarLimpieza();

  // Y luego cada 12 horas
  setInterval(ejecutarLimpieza, 43200000);
}

// ==========================================
// TAREA 3: TRANSICIONES DE ESTADO DE VACACIONES
// ==========================================
function iniciarTransicionesVacaciones() {
  const ejecutar = async () => {
    try {
      const { inProgress, completed } =
        await vacationRequestService.runDailyStatusTransitions();
      if (inProgress > 0 || completed > 0) {
        console.log(
          `[CRON ${countryConfig.code}] Vacaciones: ${inProgress} en curso, ${completed} completadas.`,
        );
      }
    } catch (err) {
      console.error(`[CRON ${countryConfig.code}] Error en transiciones de vacaciones:`, err.message);
    }
  };

  ejecutar();
  // Cada 12 horas
  setInterval(ejecutar, 43200000);
}

async function sincronizarUsuariosDeshabilitados() {
  try {
    const actualizados = await syncUnverifiedUsersToDisabled();
    if (actualizados > 0) {
      console.log(
        `[Usuarios] ${actualizados} colaborador(es) actualizados a Deshabilitado (sin correo o sin verificar).`,
      );
    }
  } catch (err) {
    console.error("[Usuarios] Error sincronizando roles:", err.message);
  }
}

// El correo es identificador único de usuario: la BD lo garantiza con un
// índice único (ignora mayúsculas/minúsculas y espacios).
async function asegurarCorreoUnico() {
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
      ON users (LOWER(TRIM(email)))
      WHERE email IS NOT NULL AND TRIM(email) <> ''
    `);
  } catch (err) {
    console.error(
      "[Usuarios] No se pudo asegurar el índice único de email (¿correos duplicados en la BD?):",
      err.message,
    );
  }
}

async function asegurarColumnaNoticiasDestacada() {
  try {
    await db.query(`
      ALTER TABLE news_articles
        ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_news_articles_featured ON news_articles (featured)
        WHERE featured = true
    `);
  } catch (err) {
    console.error(
      "[Noticias] No se pudo asegurar la columna destacada:",
      err.message,
    );
  }
}

async function asegurarColumnaAppsIconUrl() {
  try {
    await db.query(`
      ALTER TABLE applications
        ADD COLUMN IF NOT EXISTS icon_url TEXT
    `);
  } catch (err) {
    console.error(
      "[Apps] No se pudo asegurar la columna icon_url:",
      err.message,
    );
  }
}

async function asegurarColumnaAppsUrlIos() {
  try {
    await db.query(`
      ALTER TABLE applications
        ADD COLUMN IF NOT EXISTS url_ios TEXT
    `);
  } catch (err) {
    console.error(
      "[Apps] No se pudo asegurar la columna url_ios:",
      err.message,
    );
  }
}

async function asegurarColumnaAppsUrlWeb() {
  try {
    await db.query(`
      ALTER TABLE applications
        ADD COLUMN IF NOT EXISTS url_web TEXT
    `);
  } catch (err) {
    console.error(
      "[Apps] No se pudo asegurar la columna url_web:",
      err.message,
    );
  }
}

// ================================
// INICIAR SERVIDOR
// ================================
async function asegurarSchemaVacaciones() {
  try {
    await ensureVacationSchema();
  } catch (err) {
    console.error(
      "[Vacaciones] No se pudo asegurar el schema del módulo:",
      err.message,
    );
  }
}

function startBackgroundJobs() {
  if (isFeatureEnabled("supportTickets")) {
    iniciarTareaCierreTickets();
  }
  iniciarLimpiezaHistorial();

  // Migraciones y sincronización en background (no bloquean el arranque).
  Promise.allSettled([
    asegurarCorreoUnico(),
    asegurarColumnaNoticiasDestacada(),
    asegurarColumnaAppsIconUrl(),
    asegurarColumnaAppsUrlIos(),
    asegurarColumnaAppsUrlWeb(),
    sincronizarUsuariosDeshabilitados(),
    asegurarSchemaVacaciones(),
  ]).finally(() => {
    iniciarTransicionesVacaciones();
  });
}

function onHttpListening(bindLabel) {
  console.log(`Servidor de Intranet corriendo en ${bindLabel}`);
  console.log(
    `[Instancia] COUNTRY=${countryConfig.code} · TZ=${countryConfig.timezone} · APP_BASE_URL=${process.env.APP_BASE_URL}`,
  );
  startBackgroundJobs();
}

function listenAndLog(args, bindLabel) {
  const server = app.listen(...args, () => onHttpListening(bindLabel));
  server.on("error", (err) => {
    console.error("[http] No se pudo abrir el puerto:", err.message);
  });
  return server;
}

function startHttpServer() {
  const rawPort = process.env.PORT;
  const passengerGlobal =
    typeof PhusionPassenger !== "undefined" ? PhusionPassenger : null;
  const isPassenger =
    Boolean(passengerGlobal) || String(rawPort || "").trim() === "passenger";

  if (passengerGlobal) {
    passengerGlobal.configure({ autoInstall: false });
  }

  // cPanel/Passenger: hay que marcar el socket como listo YA. Los crons de
  // Chile (tickets, LinkedIn, mindicador) no pueden retrasar el listen.
  if (isPassenger) {
    listenAndLog(["passenger"], "passenger");
    return;
  }

  const trimmed = String(rawPort || "").trim();
  if (trimmed.includes("/") || trimmed.endsWith(".sock")) {
    listenAndLog([trimmed], trimmed);
    return;
  }

  const parsed = Number(trimmed);
  const listenPort = Number.isFinite(parsed) && parsed > 0 ? parsed : Number(PORT) || 3000;
  // IPv4 explícito: listen(PORT) puede quedar solo en :: y Apache (127.0.0.1)
  // responde 503 para siempre.
  const host = process.env.HOST || "0.0.0.0";
  listenAndLog([listenPort, host], `${host}:${listenPort}`);
}

startHttpServer();
module.exports = app;
