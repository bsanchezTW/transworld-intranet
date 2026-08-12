const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRelativePath,
  requireFilePath,
  encodeObjectPath,
  inferContentType,
} = require("../src/services/storage/storagePath");

describe("storage/storagePath", () => {
  it("normaliza rutas públicas, URLs y separadores", () => {
    assert.equal(
      normalizeRelativePath(" /content/noticias_adjuntos\\año 2026/foto.jpg?v=4 "),
      "noticias_adjuntos/año 2026/foto.jpg",
    );
    assert.equal(
      normalizeRelativePath(
        "https://intranet.transworld.cl/content/user/42.jpg?version=1",
      ),
      "user/42.jpg",
    );
    assert.equal(normalizeRelativePath("content"), "");
  });

  it("normaliza URLs firmadas /media/<firma>/ruta a la clave del bucket", () => {
    assert.equal(
      normalizeRelativePath("/media/abcdef0123456789abcdef0123456789/noticias_adjuntos/foto.jpg"),
      "noticias_adjuntos/foto.jpg",
    );
    assert.equal(
      normalizeRelativePath(
        "https://intranet.example/media/abcdef0123456789abcdef0123456789/user/7.jpg?v=2",
      ),
      "user/7.jpg",
    );
    assert.equal(normalizeRelativePath("media"), "");
  });

  it("rechaza traversal, NUL y separadores codificados", () => {
    for (const unsafe of [
      "../secret",
      "folder/./file",
      "folder/%2e%2e/file",
      "folder/%2Fetc/file",
      "folder/a\0b",
    ]) {
      assert.throws(
        () => normalizeRelativePath(unsafe),
        (error) => error.code === "STORAGE_INVALID_PATH" && error.statusCode === 400,
      );
    }
  });

  it("exige una ruta no vacía para operaciones de archivo", () => {
    assert.throws(() => requireFilePath("/content/"), /identificar un archivo/);
  });

  it("codifica cada segmento sin alterar la jerarquía", () => {
    assert.equal(
      encodeObjectPath("documentos/Perú/acta final.pdf"),
      "documentos/Per%C3%BA/acta%20final.pdf",
    );
    assert.equal(
      normalizeRelativePath("documentos/acta%20final.pdf"),
      "documentos/acta final.pdf",
    );
  });

  it("preserva ? y # en claves crudas y quita cache-busting de /content", () => {
    assert.equal(normalizeRelativePath("docs/a#1.pdf"), "docs/a#1.pdf");
    assert.equal(normalizeRelativePath("docs/a?1.pdf"), "docs/a?1.pdf");
    assert.equal(
      normalizeRelativePath("/content/docs/a.pdf?v=4#preview"),
      "docs/a.pdf",
    );
  });

  it("infiere MIME por magic bytes y luego por extensión", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    assert.equal(inferContentType("archivo.bin", png), "image/png");
    assert.equal(
      inferContentType("informe.xlsx", Buffer.from("not-a-signature")),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assert.equal(inferContentType("sin-extension"), "application/octet-stream");
    const avif = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif")]);
    assert.equal(inferContentType("imagen.bin", avif), "image/avif");
  });
});
