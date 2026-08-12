const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  COUNTRY_CODES,
  isValidCountryCode,
  getCurrentCountry,
  getCountryConfig,
} = require("../src/config/country");
const {
  zonedDateOnly,
  toDateOnly,
} = require("../src/utils/vacationDateUtils");

/** Ejecuta fn con COUNTRY fijada, restaurando el valor previo. */
function withCountry(code, fn) {
  const previous = process.env.COUNTRY;
  if (code === undefined) delete process.env.COUNTRY;
  else process.env.COUNTRY = code;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.COUNTRY;
    else process.env.COUNTRY = previous;
  }
}

describe("config/country — COUNTRY sin fallback", () => {
  it("CFG-01: acepta los países registrados", () => {
    assert.deepEqual(COUNTRY_CODES, ["CL", "PE"]);
    assert.ok(isValidCountryCode("CL"));
    assert.ok(isValidCountryCode("pe"));
  });

  it("CFG-02: COUNTRY ausente lanza error, no asume Chile", () => {
    withCountry(undefined, () => {
      assert.throws(() => getCurrentCountry(), /COUNTRY inválida o ausente/);
    });
  });

  it("CFG-03: COUNTRY con valor no registrado lanza error", () => {
    withCountry("XX", () => {
      assert.throws(() => getCurrentCountry(), /COUNTRY inválida o ausente/);
    });
  });

  it("CFG-04: normaliza a mayúsculas", () => {
    withCountry("pe", () => {
      assert.equal(getCurrentCountry(), "PE");
    });
  });

  it("CFG-05: cada país trae zona, locale y dominio corporativo propios", () => {
    const cl = getCountryConfig("CL");
    const pe = getCountryConfig("PE");

    assert.equal(cl.timezone, "America/Santiago");
    assert.equal(pe.timezone, "America/Lima");
    assert.equal(cl.locale, "es-CL");
    assert.equal(pe.locale, "es-PE");
    assert.equal(cl.corporateEmailDomain, "transworld.cl");
    assert.equal(pe.corporateEmailDomain, "transworld.pe");
  });

  it("CFG-06: el dominio corporativo encabeza los dominios de login", () => {
    assert.equal(getCountryConfig("CL").allowedLoginDomains[0], "transworld.cl");
    assert.equal(getCountryConfig("PE").allowedLoginDomains[0], "transworld.pe");
    // Ningún país debe aceptar el dominio corporativo del otro.
    assert.ok(!getCountryConfig("PE").allowedLoginDomains.includes("transworld.cl"));
    assert.ok(!getCountryConfig("CL").allowedLoginDomains.includes("transworld.pe"));
  });

  it("CFG-07: la cookie de sesión difiere por país (evita cruce en localhost)", () => {
    assert.notEqual(
      getCountryConfig("CL").sessionCookieName,
      getCountryConfig("PE").sessionCookieName,
    );
  });
});

describe("fechas — 'hoy' en la zona del país, no en UTC", () => {
  // 2026-08-11 23:30 UTC. En Santiago (UTC−4 en invierno austral) son las
  // 19:30 del día 11; en Lima (UTC−5) las 18:30 del 11. En UTC ya es el 11
  // a las 23:30, pero media hora más tarde sería el 12.
  const lateEvening = new Date("2026-08-11T23:30:00Z");

  it("TZ-01: a las 21:30 de Santiago sigue siendo el mismo día", () => {
    // 2026-08-12 01:30 UTC = 2026-08-11 21:30 en Santiago.
    const instant = new Date("2026-08-12T01:30:00Z");
    assert.equal(zonedDateOnly(instant, "America/Santiago"), "2026-08-11");
    // Este es el bug que se corrige: leer los componentes UTC adelanta el día.
    assert.equal(toDateOnly(instant), "2026-08-12");
  });

  it("TZ-02: a las 20:30 de Lima sigue siendo el mismo día", () => {
    // 2026-08-12 01:30 UTC = 2026-08-11 20:30 en Lima.
    const instant = new Date("2026-08-12T01:30:00Z");
    assert.equal(zonedDateOnly(instant, "America/Lima"), "2026-08-11");
  });

  it("TZ-03: el mismo instante puede caer en días distintos por país", () => {
    // 2026-08-12 03:30 UTC → Santiago 23:30 del 11, Lima 22:30 del 11.
    const instant = new Date("2026-08-12T03:30:00Z");
    assert.equal(zonedDateOnly(instant, "America/Santiago"), "2026-08-11");
    assert.equal(zonedDateOnly(instant, "America/Lima"), "2026-08-11");
    assert.equal(toDateOnly(instant), "2026-08-12");
  });

  it("TZ-04: dentro de la jornada ambos coinciden con UTC", () => {
    assert.equal(zonedDateOnly(lateEvening, "America/Santiago"), "2026-08-11");
    assert.equal(zonedDateOnly(lateEvening, "America/Lima"), "2026-08-11");
    assert.equal(toDateOnly(lateEvening), "2026-08-11");
  });
});
