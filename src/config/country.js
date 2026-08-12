/**
 * Identidad de país de esta instancia.
 *
 * Cada deployment pertenece a exactamente un país y lo declara con COUNTRY.
 * No es una preferencia del usuario ni un atributo del colaborador: es la
 * identidad de la ejecución completa.
 *
 * Este es el ÚNICO archivo autorizado a leer process.env.COUNTRY. El resto del
 * proyecto usa getCurrentCountry() / getCountryConfig().
 */

const COUNTRY_CODES = ["CL", "PE"];

/** Dominios públicos aceptados al iniciar sesión, comunes a ambos países. */
const PUBLIC_EMAIL_DOMAINS = [
  "gmail.com",
  "icloud.com",
  "outlook.com",
  "outlook.cl",
  "hotmail.com",
  "hotmail.cl",
  "yahoo.com",
  "yahoo.cl",
];

/** Jornada de oficina usada para el SLA de tickets (lun–jue / vie). */
const DEFAULT_BUSINESS_HOURS = {
  weekday: { startHour: 9, startMinute: 0, endHour: 18, endMinute: 30 },
  friday: { startHour: 9, startMinute: 0, endHour: 15, endMinute: 30 },
};

const COUNTRY_CONFIGS = {
  CL: {
    code: "CL",
    name: "Chile",
    timezone: "America/Santiago",
    locale: "es-CL",
    corporateEmailDomain: "transworld.cl",
    pageTitleSuffix: "Intranet Transworld Chile",
    sessionCookieName: "tw_sid_cl",
    businessHours: DEFAULT_BUSINESS_HOURS,
    // Celulares chilenos: +56 9 XXXX XXXX
    phone: {
      callingCode: "56",
      nationalDigits: 9,
      mobileLeadingDigit: "9",
      groups: [1, 4, 4],
      example: "9 1234 5678",
    },
    corporateSite: "https://www.transworld.cl/",
    supportEmail: "soporte@transworld.cl",
    hrEmail: "rrhh@transworld.cl",
    noReplyEmail: "noreply@transworld.cl",
    contactEmail: "contacto@transworld.cl",
  },
  PE: {
    code: "PE",
    name: "Perú",
    timezone: "America/Lima",
    locale: "es-PE",
    corporateEmailDomain: "transworld.pe",
    pageTitleSuffix: "Intranet Transworld Perú",
    sessionCookieName: "tw_sid_pe",
    // TODO(RRHH Perú): confirmar la jornada real de la oficina de Lima.
    businessHours: DEFAULT_BUSINESS_HOURS,
    // Celulares peruanos: +51 XXX XXX XXX (9 dígitos, empiezan en 9)
    phone: {
      callingCode: "51",
      nationalDigits: 9,
      mobileLeadingDigit: "9",
      groups: [3, 3, 3],
      example: "987 654 321",
    },
    corporateSite: "https://www.transworld.cl/",
    // TODO(TI Perú): confirmar las casillas locales antes de salir a producción.
    supportEmail: "soporte@transworld.pe",
    hrEmail: "rrhh@transworld.pe",
    noReplyEmail: "noreply@transworld.pe",
    contactEmail: "contacto@transworld.pe",
  },
};

// El dominio corporativo siempre encabeza la lista: es el que el formulario de
// login preselecciona.
for (const config of Object.values(COUNTRY_CONFIGS)) {
  config.allowedLoginDomains = [
    config.corporateEmailDomain,
    ...PUBLIC_EMAIL_DOMAINS,
  ];
}

function isValidCountryCode(value) {
  return COUNTRY_CODES.includes(String(value || "").trim().toUpperCase());
}

/**
 * País de esta instancia. Sin fallback: si COUNTRY falta o es inválida la
 * aplicación no debe arrancar (la validación vive en config/env.js, esto es la
 * segunda barrera por si alguien requiere este módulo por su cuenta).
 */
function getCurrentCountry() {
  const raw = String(process.env.COUNTRY || "").trim().toUpperCase();
  if (!isValidCountryCode(raw)) {
    throw new Error(
      `COUNTRY inválida o ausente: "${process.env.COUNTRY ?? ""}". ` +
        `Valores admitidos: ${COUNTRY_CODES.join(", ")}.`,
    );
  }
  return raw;
}

function getCountryConfig(countryCode = getCurrentCountry()) {
  const code = String(countryCode || "").trim().toUpperCase();
  const config = COUNTRY_CONFIGS[code];
  if (!config) {
    throw new Error(`País no registrado: ${countryCode}`);
  }
  return config;
}

/** Zona IANA de la instancia. Atajo del uso más frecuente. */
function getTimezone() {
  return getCountryConfig().timezone;
}

/** Locale de la instancia, para Intl y toLocaleString. */
function getLocale() {
  return getCountryConfig().locale;
}

module.exports = {
  COUNTRY_CODES,
  PUBLIC_EMAIL_DOMAINS,
  isValidCountryCode,
  getCurrentCountry,
  getCountryConfig,
  getTimezone,
  getLocale,
};
