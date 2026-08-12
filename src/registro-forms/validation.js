/**
 * Validaciones del formulario público de registro (cliente y servidor alineados).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Chile y Perú primero; el resto LatAm alfabético. */
const PHONE_COUNTRIES = [
  {
    code: "CL",
    callingCode: "56",
    label: "+56 CL",
    nationalDigits: 9,
    nationalDigitsMax: 9,
    mobileLeading: null,
    groups: [1, 4, 4],
    example: "9 1234 5678",
  },
  {
    code: "PE",
    callingCode: "51",
    label: "+51 PE",
    nationalDigits: 8,
    nationalDigitsMax: 9,
    mobileLeading: null,
    groups: [3, 3, 3],
    example: "987 654 321",
  },
  {
    code: "AR",
    callingCode: "54",
    label: "+54 AR",
    nationalDigits: 10,
    nationalDigitsMax: 10,
    mobileLeading: null,
    groups: [2, 4, 4],
    example: "11 2345 6789",
  },
  {
    code: "BO",
    callingCode: "591",
    label: "+591 BO",
    nationalDigits: 8,
    nationalDigitsMax: 8,
    mobileLeading: /^[67]/,
    groups: [4, 4],
    example: "7123 4567",
  },
  {
    code: "BR",
    callingCode: "55",
    label: "+55 BR",
    nationalDigits: 10,
    nationalDigitsMax: 11,
    mobileLeading: null,
    groups: [2, 5, 4],
    example: "11 91234 5678",
  },
  {
    code: "CO",
    callingCode: "57",
    label: "+57 CO",
    nationalDigits: 10,
    nationalDigitsMax: 10,
    mobileLeading: /^3/,
    groups: [3, 3, 4],
    example: "300 123 4567",
  },
  {
    code: "CR",
    callingCode: "506",
    label: "+506 CR",
    nationalDigits: 8,
    nationalDigitsMax: 8,
    mobileLeading: null,
    groups: [4, 4],
    example: "8888 8888",
  },
  {
    code: "EC",
    callingCode: "593",
    label: "+593 EC",
    nationalDigits: 9,
    nationalDigitsMax: 9,
    mobileLeading: /^9/,
    groups: [2, 3, 4],
    example: "99 123 4567",
  },
  {
    code: "GT",
    callingCode: "502",
    label: "+502 GT",
    nationalDigits: 8,
    nationalDigitsMax: 8,
    mobileLeading: null,
    groups: [4, 4],
    example: "5123 4567",
  },
  {
    code: "MX",
    callingCode: "52",
    label: "+52 MX",
    nationalDigits: 10,
    nationalDigitsMax: 10,
    mobileLeading: null,
    groups: [2, 4, 4],
    example: "55 1234 5678",
  },
  {
    code: "PA",
    callingCode: "507",
    label: "+507 PA",
    nationalDigits: 8,
    nationalDigitsMax: 8,
    mobileLeading: null,
    groups: [4, 4],
    example: "6123 4567",
  },
  {
    code: "PY",
    callingCode: "595",
    label: "+595 PY",
    nationalDigits: 9,
    nationalDigitsMax: 9,
    mobileLeading: /^9/,
    groups: [3, 3, 3],
    example: "981 123 456",
  },
  {
    code: "UY",
    callingCode: "598",
    label: "+598 UY",
    nationalDigits: 8,
    nationalDigitsMax: 8,
    mobileLeading: /^9/,
    groups: [2, 3, 3],
    example: "94 123 456",
  },
  {
    code: "VE",
    callingCode: "58",
    label: "+58 VE",
    nationalDigits: 10,
    nationalDigitsMax: 10,
    mobileLeading: /^4/,
    groups: [3, 3, 4],
    example: "412 123 4567",
  },
];

const DEFAULT_PHONE_COUNTRY = "CL";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function groupDigits(digits, groups) {
  const out = [];
  let rest = String(digits || "");
  for (const size of groups) {
    if (!rest.length) break;
    out.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest.length) out.push(rest);
  return out.join(" ");
}

function getPhoneCountry(code) {
  return (
    PHONE_COUNTRIES.find((c) => c.code === String(code || "").toUpperCase()) ||
    PHONE_COUNTRIES.find((c) => c.code === DEFAULT_PHONE_COUNTRY)
  );
}

function getPhoneCountryByCallingCode(callingCode) {
  const cc = String(callingCode || "").replace(/^\+/, "");
  return PHONE_COUNTRIES.find((c) => c.callingCode === cc) || null;
}

/** Title Case por palabra: "JUAN PÉREZ" → "Juan Pérez". */
function toTitleCaseName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLocaleLowerCase("es");
      return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
    })
    .join(" ");
}

function isValidFullName(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  return /^\S+\s+\S+/.test(trimmed) && isLettersAndSpaces(trimmed);
}

/** Solo letras (incluye tildes y ñ) y espacios. Sin números ni símbolos. */
function isLettersAndSpaces(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return false;
  return /^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(trimmed);
}

/** Conserva mayúsculas y símbolos; solo recorta y colapsa espacios. */
function normalizeEmpresa(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidEmpresa(value) {
  return normalizeEmpresa(value).length > 0;
}

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

function localMaxLength(country) {
  const cfg = typeof country === "string" ? getPhoneCountry(country) : country;
  return cfg.nationalDigitsMax + cfg.groups.length - 1;
}

/** Agrupación visible según país y largo (móvil vs fijo). */
function groupsForDigits(cfg, digits) {
  if (cfg.code === "CL") {
    return digits.startsWith("2") || digits.startsWith("9")
      ? [1, 4, 4]
      : [2, 3, 4];
  }
  if (cfg.code === "PE") {
    if (digits.length === 9) return [3, 3, 3];
    if (digits.startsWith("1")) return [1, 3, 4];
    return [2, 3, 3];
  }
  if (cfg.code === "BR" && digits.length <= 10) {
    return [2, 4, 4];
  }
  return cfg.groups;
}

function isValidCountryDigits(cfg, digits) {
  if (!digits) return false;

  if (cfg.code === "CL") {
    return digits.length === 9 && /^[2-79]/.test(digits);
  }
  if (cfg.code === "PE") {
    if (digits.length === 9) return digits.startsWith("9");
    if (digits.length === 8) return /^[14-8]/.test(digits);
    return false;
  }

  if (digits.length < cfg.nationalDigits || digits.length > cfg.nationalDigitsMax) {
    return false;
  }
  if (cfg.mobileLeading && !cfg.mobileLeading.test(digits)) {
    return false;
  }
  return true;
}

function formatLocalPhoneInput(raw, countryCode) {
  const cfg = getPhoneCountry(countryCode);
  let digits = digitsOnly(raw);

  if (
    digits.startsWith(cfg.callingCode) &&
    digits.length > cfg.nationalDigitsMax
  ) {
    digits = digits.slice(cfg.callingCode.length);
  }
  if (digits.charAt(0) === "0") digits = digits.slice(1);

  digits = digits.slice(0, cfg.nationalDigitsMax);
  if (!digits.length) return "";

  return groupDigits(digits, groupsForDigits(cfg, digits));
}

function isValidNationalPhone(localValue, countryCode) {
  const cfg = getPhoneCountry(countryCode);
  return isValidCountryDigits(cfg, digitsOnly(localValue));
}

/**
 * Acepta "+56 9 1234 5678" o partes separadas.
 * Devuelve { ok, formatted, country } o { ok: false, error }.
 */
function normalizePhone(telefono, countryCodeHint) {
  const raw = String(telefono || "").trim();
  if (!raw) {
    return { ok: false, error: "El teléfono es obligatorio" };
  }

  let country = countryCodeHint ? getPhoneCountry(countryCodeHint) : null;
  let local = raw;

  const intlMatch = raw.match(/^\+(\d{1,3})\s*(.*)$/);
  if (intlMatch) {
    const byCc = getPhoneCountryByCallingCode(intlMatch[1]);
    if (!byCc) {
      return { ok: false, error: "Código de país no soportado" };
    }
    country = byCc;
    local = intlMatch[2];
  }

  if (!country) {
    return { ok: false, error: "Selecciona un código de país" };
  }

  const formattedLocal = formatLocalPhoneInput(local, country.code);
  if (!isValidNationalPhone(formattedLocal, country.code)) {
    return {
      ok: false,
      error: `Ingresa un teléfono válido con formato ${country.example}`,
    };
  }

  return {
    ok: true,
    country: country.code,
    formatted: `+${country.callingCode} ${formattedLocal}`,
  };
}

function phoneErrorMessage(countryCode) {
  const cfg = getPhoneCountry(countryCode);
  return `Ingresa un teléfono válido con formato ${cfg.example}`;
}

module.exports = {
  EMAIL_RE,
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  digitsOnly,
  groupDigits,
  getPhoneCountry,
  getPhoneCountryByCallingCode,
  toTitleCaseName,
  isValidFullName,
  isLettersAndSpaces,
  normalizeEmpresa,
  isValidEmpresa,
  isValidEmail,
  localMaxLength,
  formatLocalPhoneInput,
  isValidNationalPhone,
  normalizePhone,
  phoneErrorMessage,
};
