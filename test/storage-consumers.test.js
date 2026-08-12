const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

const signedMedia = require("../src/services/media/signedMedia");
const fileStorage = require("../src/services/fileStorage");
const { detectImageContentType } = require("../src/services/userPhotoStorage");

const previousSigningSecret = process.env.MEDIA_SIGNING_SECRET;

describe("signedMedia — rutas y firmas independientes del proveedor", () => {
  beforeEach(() => {
    process.env.MEDIA_SIGNING_SECRET = "test-secret-storage-migration";
  });

  after(() => {
    if (previousSigningSecret === undefined) {
      delete process.env.MEDIA_SIGNING_SECRET;
    } else {
      process.env.MEDIA_SIGNING_SECRET = previousSigningSecret;
    }
  });

  it("normaliza URLs /content y /media a la misma ruta relativa", () => {
    const relativePath = "noticias_adjuntos/portada final.png";
    const mediaUrl = signedMedia.publicUrl(`/content/${relativePath}`);

    assert.equal(signedMedia.toRelativePath(`/content/${relativePath}`), relativePath);
    assert.equal(signedMedia.toRelativePath(mediaUrl), relativePath);
    assert.equal(
      signedMedia.toRelativePath(`https://intranet.example/content/${relativePath}`),
      relativePath,
    );
  });

  it("firma la ruta canónica y rechaza firmas alteradas", () => {
    const relativePath = "noticias_adjuntos/foto.png";
    const signature = signedMedia.sign(`/content/${relativePath}`);

    assert.equal(signature.length, signedMedia.SIGNATURE_LENGTH);
    assert.equal(signedMedia.verify(relativePath, signature), true);
    assert.equal(signedMedia.verify(`${relativePath}.otro`, signature), false);
  });

  it("solo genera URL pública para imágenes y rechaza traversal", () => {
    assert.match(
      signedMedia.publicUrl("noticias_adjuntos/foto.png"),
      /^\/media\/[a-f0-9]{32}\/noticias_adjuntos\/foto\.png$/,
    );
    assert.equal(signedMedia.publicUrl("documentos/contrato.pdf"), null);
    assert.equal(signedMedia.toRelativePath("/content/../secreto.png"), "");
  });

  it("solo permite MIME raster seguros por el proxy público", () => {
    assert.equal(signedMedia.isSafeContentType("image/png"), true);
    assert.equal(signedMedia.isSafeContentType("image/jpeg; charset=binary"), true);
    assert.equal(signedMedia.isSafeContentType("image/svg+xml"), false);
    assert.equal(signedMedia.isSafeContentType("text/html"), false);
  });
});

describe("fileStorage — URLs HTTP", () => {
  it("codifica cada segmento sin perder la ruta de objeto", () => {
    assert.equal(
      fileStorage.getPublicUrl("documentos/acta #1?.pdf"),
      "/content/documentos/acta%20%231%3F.pdf",
    );
  });

  it("resuelve public_id, /content y /media a la misma clave de bucket", () => {
    assert.equal(
      fileStorage.resolveStoredPath("apps_icons/logo.png"),
      "apps_icons/logo.png",
    );
    assert.equal(
      fileStorage.resolveStoredPath("/content/apps_icons/logo.png"),
      "apps_icons/logo.png",
    );
    assert.equal(
      fileStorage.resolveStoredPath(
        "/media/abcdef0123456789abcdef0123456789/apps_icons/logo.png",
      ),
      "apps_icons/logo.png",
    );
    assert.equal(fileStorage.resolveStoredPath("/uploads/legacy.png"), "");
    assert.equal(fileStorage.resolveStoredPath(""), "");
  });
});

describe("userPhotoStorage — MIME real con ruta histórica .jpg", () => {
  it("detecta JPEG, PNG, GIF, WebP, BMP y AVIF por magic bytes", () => {
    assert.equal(
      detectImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
      "image/jpeg",
    );
    assert.equal(
      detectImageContentType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      "image/png",
    );
    assert.equal(detectImageContentType(Buffer.from("GIF89a")), "image/gif");
    assert.equal(
      detectImageContentType(Buffer.from("RIFFxxxxWEBP")),
      "image/webp",
    );
    assert.equal(detectImageContentType(Buffer.from("BMxxxx")), "image/bmp");
    assert.equal(
      detectImageContentType(Buffer.from("xxxxftypavif")),
      "image/avif",
    );
  });

  it("rechaza contenido que no es una imagen reconocida", () => {
    assert.equal(detectImageContentType(Buffer.from("unknown")), null);
  });
});
