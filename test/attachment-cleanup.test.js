const { describe, it, mock, beforeEach, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const attachmentProcessor = require("../src/services/noticias/attachmentProcessor");
const fileStorage = require("../src/services/fileStorage");

const previousSigningSecret = process.env.MEDIA_SIGNING_SECRET;

describe("attachmentProcessor — limpieza de storage", () => {
  beforeEach(() => {
    process.env.MEDIA_SIGNING_SECRET = "test-secret-attachment-cleanup";
  });

  after(() => {
    if (previousSigningSecret === undefined) {
      delete process.env.MEDIA_SIGNING_SECRET;
    } else {
      process.env.MEDIA_SIGNING_SECRET = previousSigningSecret;
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("detecta adjuntos quitados al editar por public_id", () => {
    const removed = attachmentProcessor.findRemovedAttachments(
      [
        { url: "/content/noticias_adjuntos/a.jpg", public_id: "noticias_adjuntos/a.jpg" },
        { url: "/content/noticias_adjuntos/b.pdf", public_id: "noticias_adjuntos/b.pdf" },
      ],
      [{ url: "/content/noticias_adjuntos/a.jpg", public_id: "noticias_adjuntos/a.jpg" }],
    );

    assert.equal(removed.length, 1);
    assert.equal(removed[0].public_id, "noticias_adjuntos/b.pdf");
  });

  it("borra originales y derivadas vía fileStorage.deleteFiles", async () => {
    const deleted = [];
    mock.method(fileStorage, "deleteFiles", async (refs) => {
      deleted.push(...refs);
      return { deleted: refs.length, failed: 0, paths: refs };
    });

    const count = await attachmentProcessor.deleteAttachmentFiles([
      {
        url: "/content/noticias_adjuntos/doc.pdf",
        public_id: "noticias_adjuntos/doc.pdf",
        preview_path: "noticias_adjuntos/previews/doc-portada.jpg",
        preview_pages: [
          { path: "noticias_adjuntos/previews/doc-portada.jpg", page: 1 },
          { path: "noticias_adjuntos/previews/doc-p2.jpg", page: 2 },
        ],
      },
    ]);

    assert.equal(count, deleted.length);
    assert.ok(deleted.includes("noticias_adjuntos/doc.pdf"));
    assert.ok(deleted.includes("noticias_adjuntos/previews/doc-portada.jpg"));
    assert.ok(deleted.includes("noticias_adjuntos/previews/doc-p2.jpg"));
  });
});
