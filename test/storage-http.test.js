const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isActiveContentType,
  contentDispositionFor,
} = require("../src/services/storage/storageHttp");

describe("storage HTTP hardening", () => {
  it("marca HTML, SVG y XML como contenido activo", () => {
    assert.equal(isActiveContentType("text/html; charset=utf-8"), true);
    assert.equal(isActiveContentType("image/svg+xml"), true);
    assert.equal(isActiveContentType("application/xml"), true);
    assert.equal(isActiveContentType("text/javascript"), true);
    assert.equal(isActiveContentType("image/png"), false);
    assert.equal(isActiveContentType("application/pdf"), false);
  });

  it("genera Content-Disposition seguro y codificado", () => {
    const header = contentDispositionFor({
      relativePath: "tickets_adjuntos/informe Perú #1.html",
    });
    assert.match(header, /^attachment;/);
    assert.match(header, /filename="informe Per_ #1\.html"/);
    assert.match(header, /filename\*=UTF-8''informe%20Per%C3%BA%20%231\.html/);
    assert.doesNotMatch(header, /[\r\n]/);
  });
});
