const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEBIBYTE,
  UPLOAD_LIMITS_MB,
  UPLOAD_LIMITS_BYTES,
} = require("../src/config/uploadLimits");

test("los límites funcionales caben en el límite del bucket", () => {
  for (const [name, limit] of Object.entries(UPLOAD_LIMITS_MB)) {
    assert.ok(Number.isInteger(limit) && limit > 0, `${name} debe ser positivo`);
    assert.ok(
      limit <= UPLOAD_LIMITS_MB.STORAGE_OBJECT,
      `${name} excede el máximo del bucket`,
    );
    assert.equal(UPLOAD_LIMITS_BYTES[name], limit * MEBIBYTE);
  }
});

test("noticias admite 200 MiB con margen de bucket", () => {
  assert.equal(UPLOAD_LIMITS_MB.NEWS_ATTACHMENT, 200);
  assert.equal(UPLOAD_LIMITS_MB.STORAGE_OBJECT, 250);
});

test("eventos alinea los límites del servidor con la UI", () => {
  assert.equal(UPLOAD_LIMITS_MB.EVENT_IMAGE, 10);
  assert.equal(UPLOAD_LIMITS_MB.EVENT_VIDEO, 100);
  assert.equal(UPLOAD_LIMITS_MB.EVENT_MEDIA, 100);
});
