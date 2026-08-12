const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toTitleCaseName,
  isValidFullName,
  isLettersAndSpaces,
  isValidEmail,
  formatLocalPhoneInput,
  isValidNationalPhone,
  normalizePhone,
  DEFAULT_PHONE_COUNTRY,
} = require("../src/registro-forms/validation");

test("nombre: exige al menos dos palabras y Title Case", () => {
  assert.equal(isValidFullName("Juan"), false);
  assert.equal(isValidFullName("Juan Pérez"), true);
  assert.equal(isValidFullName("Juan2 Pérez"), false);
  assert.equal(isValidFullName("Juan Pérez!"), false);
  assert.equal(isValidFullName("  maria  jose  "), true);
  assert.equal(toTitleCaseName("JUAN PÉREZ"), "Juan Pérez");
  assert.equal(toTitleCaseName("maría josé"), "María José");
  assert.equal(toTitleCaseName("GERENTE DE VENTAS"), "Gerente De Ventas");
});

test("nombre, cargo y empresa: solo letras y espacios", () => {
  assert.equal(isLettersAndSpaces("Transworld"), true);
  assert.equal(isLettersAndSpaces("Gerente De Ventas"), true);
  assert.equal(isLettersAndSpaces("María José"), true);
  assert.equal(isLettersAndSpaces("Empresa 3"), false);
  assert.equal(isLettersAndSpaces("S.A."), false);
  assert.equal(isLettersAndSpaces("P&G"), false);
});

test("email: regex básico", () => {
  assert.equal(isValidEmail("a@b.c"), true);
  assert.equal(isValidEmail("invalido"), false);
  assert.equal(isValidEmail("a@b"), false);
});

test("telefono CL/PE por defecto y formato", () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, "CL");
  assert.equal(formatLocalPhoneInput("912345678", "CL"), "9 1234 5678");
  assert.equal(isValidNationalPhone("9 1234 5678", "CL"), true);
  assert.equal(isValidNationalPhone("812345678", "CL"), false);
  assert.equal(formatLocalPhoneInput("987654321", "PE"), "987 654 321");
  assert.equal(isValidNationalPhone("987 654 321", "PE"), true);
});

test("telefono CL acepta fijo Santiago y regional", () => {
  assert.equal(formatLocalPhoneInput("223456789", "CL"), "2 2345 6789");
  assert.equal(isValidNationalPhone("2 2345 6789", "CL"), true);
  assert.equal(formatLocalPhoneInput("322345678", "CL"), "32 234 5678");
  assert.equal(isValidNationalPhone("32 234 5678", "CL"), true);
  assert.equal(isValidNationalPhone("123456789", "CL"), false);
});

test("telefono PE acepta fijo Lima y provincial", () => {
  assert.equal(formatLocalPhoneInput("13113000", "PE"), "1 311 3000");
  assert.equal(isValidNationalPhone("1 311 3000", "PE"), true);
  assert.equal(formatLocalPhoneInput("44123456", "PE"), "44 123 456");
  assert.equal(isValidNationalPhone("44 123 456", "PE"), true);
  assert.equal(isValidNationalPhone("812345678", "PE"), false);
});

test("normalizePhone acepta fijos CL/PE", () => {
  const cl = normalizePhone("2 2345 6789", "CL");
  assert.equal(cl.ok, true);
  assert.equal(cl.formatted, "+56 2 2345 6789");

  const pe = normalizePhone("1 311 3000", "PE");
  assert.equal(pe.ok, true);
  assert.equal(pe.formatted, "+51 1 311 3000");
});

test("normalizePhone acepta internacional y hint de país", () => {
  const a = normalizePhone("+56 9 1234 5678");
  assert.equal(a.ok, true);
  assert.equal(a.formatted, "+56 9 1234 5678");

  const b = normalizePhone("9 1234 5678", "CL");
  assert.equal(b.ok, true);
  assert.equal(b.formatted, "+56 9 1234 5678");

  const c = normalizePhone("300 123 4567", "CO");
  assert.equal(c.ok, true);
  assert.equal(c.formatted, "+57 300 123 4567");

  const d = normalizePhone("123", "CL");
  assert.equal(d.ok, false);
});
