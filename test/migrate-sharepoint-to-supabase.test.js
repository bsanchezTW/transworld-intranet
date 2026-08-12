"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  CONTENT_ROOT,
  GraphSource,
  MigrationJournal,
  SupabaseDestination,
  buildManifest,
  inferMimeType,
  inspectExisting,
  isExcludedRootPath,
  mapWithConcurrency,
  normalizeRelativePath,
  parseArgs,
  resolveConfig,
  runMigration,
} = require("../scripts/migrate-sharepoint-to-supabase");

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("migrate-sharepoint-to-supabase", () => {
  it("normaliza rutas y excluye solo el prefijo eventos/ en la raiz", () => {
    assert.equal(normalizeRelativePath("/content/noticias_adjuntos/a.pdf"), "noticias_adjuntos/a.pdf");
    assert.equal(isExcludedRootPath("eventos/foto.jpg"), true);
    assert.equal(isExcludedRootPath("eventos", true), true);
    assert.equal(isExcludedRootPath("eventos", false), false);
    assert.equal(isExcludedRootPath("eventos-archivo/foto.jpg"), false);
    assert.equal(isExcludedRootPath("marketing/eventos/foto.jpg"), false);
    assert.throws(() => normalizeRelativePath("docs/../secreto.txt"), /invalida/);
  });

  it("preserva MIME de Graph y aplica fallback por extension", () => {
    assert.equal(inferMimeType("foto.jpg", "image/custom"), "image/custom");
    assert.equal(inferMimeType("reporte.PDF"), "application/pdf");
    assert.equal(inferMimeType("sin-extension"), "application/octet-stream");
  });

  it("pagina completamente Graph y no recorre la carpeta raiz eventos", async () => {
    const requested = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      requested.push(value);

      if (value.endsWith("/root-page-2")) {
        return jsonResponse({
          value: [
            { id: "root-file-2", name: "eventos", size: 2, eTag: "e2", file: { mimeType: "text/plain" } },
            { id: "nested", name: "marketing", folder: { childCount: 1 } },
          ],
        });
      }
      if (value.includes("/drive/root:/")) {
        assert.match(value, new RegExp(CONTENT_ROOT.replaceAll("/", "\\/")));
        return jsonResponse({
          value: [
            { id: "events", name: "eventos", folder: { childCount: 99 } },
            { id: "events-old", name: "eventos-archivo", folder: { childCount: 1 } },
            { id: "root-file", name: "portada.jpg", size: 4, eTag: "e1", file: { mimeType: "image/jpeg" } },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/root-page-2",
        });
      }
      if (value.includes("/items/events-old/children")) {
        return jsonResponse({
          value: [{ id: "old-file", name: "foto.png", size: 3, eTag: "e3", file: { mimeType: "image/png" } }],
        });
      }
      if (value.includes("/items/nested/children")) {
        return jsonResponse({
          value: [{ id: "nested-events", name: "eventos", folder: { childCount: 1 } }],
        });
      }
      if (value.includes("/items/nested-events/children")) {
        return jsonResponse({
          value: [{ id: "nested-file", name: "foto.webp", size: 5, eTag: "e4", file: { mimeType: "image/webp" } }],
        });
      }
      throw new Error(`URL inesperada: ${value}`);
    };

    const source = new GraphSource(
      { tenantId: "tenant", clientId: "client", clientSecret: "secret", siteId: "site", retries: 0 },
      { fetchImpl, tokenProvider: async () => "token", logger: { warn() {} } },
    );
    const files = await source.listFiles();

    assert.deepEqual(
      files.map((file) => file.relativePath),
      ["eventos", "eventos-archivo/foto.png", "marketing/eventos/foto.webp", "portada.jpg"],
    );
    assert.equal(requested.some((url) => url.includes("/items/events/children")), false);
    assert.equal(requested.some((url) => url.endsWith("/root-page-2")), true);
  });

  it("limita la concurrencia sin perder el orden de resultados", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 ? 4 : 1));
      active -= 1;
      return value * 10;
    });
    assert.equal(maximum, 2);
    assert.deepEqual(values, [10, 20, 30, 40, 50, 60]);
  });

  it("reanuda TUS consultando el offset si se pierde la respuesta de un PATCH", async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tw-tus-test-"));
    const filePath = path.join(tempDir, "large.bin");
    await fsp.writeFile(filePath, Buffer.from("abcdefghij"));

    let remoteOffset = 0;
    let createCalls = 0;
    let firstPatch = true;
    const patchOffsets = [];
    const progress = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method || "GET";
      if (method === "POST") {
        createCalls += 1;
        assert.match(init.headers["upload-metadata"], /bucketName/);
        return new Response(null, { status: 201, headers: { location: "/storage/v1/upload/resumable/abc" } });
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "upload-offset": String(remoteOffset), "upload-length": "10" },
        });
      }
      if (method === "PATCH") {
        const offset = Number(init.headers["upload-offset"]);
        patchOffsets.push(offset);
        const length = Buffer.from(init.body).length;
        if (firstPatch) {
          firstPatch = false;
          remoteOffset += length;
          throw new Error("conexion perdida despues de aceptar el chunk");
        }
        assert.equal(offset, remoteOffset);
        remoteOffset += length;
        return new Response(null, { status: 204, headers: { "upload-offset": String(remoteOffset) } });
      }
      throw new Error(`Peticion inesperada: ${method} ${url}`);
    };

    try {
      const destination = new SupabaseDestination(
        {
          supabaseUrl: "https://project.supabase.co",
          secretKey: "secret",
          bucket: "intranet-content",
          retries: 2,
          standardUploadMaxBytes: 1,
          tusChunkSize: 4,
        },
        { fetchImpl, sleepImpl: async () => {}, logger: { warn() {} } },
      );
      await destination.uploadTus(
        filePath,
        { relativePath: "videos/grande.mp4", size: 10, contentType: "video/mp4", eTag: "etag" },
        "abc123",
        false,
        null,
        async (state) => progress.push(state.offset),
      );

      assert.equal(createCalls, 1);
      assert.deepEqual(patchOffsets, [0, 4, 8]);
      assert.equal(remoteOffset, 10);
      assert.equal(progress.at(-1), 10);
    } finally {
      await fsp.rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    }
  });

  it("no envia sb_secret como Bearer y mantiene Bearer para service_role legacy", () => {
    const base = { supabaseUrl: "https://project.supabase.co", bucket: "intranet-content" };
    const modern = new SupabaseDestination({ ...base, secretKey: "sb_secret_modern" });
    const legacy = new SupabaseDestination({ ...base, secretKey: "legacy-jwt" });

    assert.deepEqual(modern.headers(), { apikey: "sb_secret_modern" });
    assert.deepEqual(legacy.headers(), {
      apikey: "legacy-jwt",
      authorization: "Bearer legacy-jwt",
    });
  });

  it("trata NoSuchKey encapsulado en HTTP 400 como objeto ausente", async () => {
    const responses = [
      jsonResponse({ statusCode: "404", code: "NoSuchKey", message: "The resource was not found" }, 400),
      jsonResponse({ statusCode: "400", code: "InvalidRequest", message: "bad request" }, 400),
    ];
    const destination = new SupabaseDestination({
      supabaseUrl: "https://project.supabase.co",
      secretKey: "sb_secret_test",
      bucket: "intranet-content",
      retries: 0,
    }, {
      fetchImpl: async () => responses.shift(),
    });

    assert.equal(await destination.info("documentos/ausente.pdf"), null);
    await assert.rejects(
      () => destination.info("documentos/invalido.pdf"),
      (error) => error.statusCode === 400 && /InvalidRequest/.test(error.message),
    );
  });

  it("evita descargar destino si su metadata ya contiene el SHA de origen", async () => {
    let hashes = 0;
    const destination = {
      async info() {
        return { size: 12, etag: "dest-etag", metadata: { source_sha256: "same", size: 12 } };
      },
      async hashObject() {
        hashes += 1;
        return { size: 12, sha256: "same" };
      },
    };
    const result = await inspectExisting(destination, { relativePath: "a.pdf", size: 12 }, "same");
    assert.equal(result.matches, true);
    assert.equal(hashes, 0);
  });

  it("persiste un journal atomico y rechaza reutilizarlo para otro destino", async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tw-journal-test-"));
    const journalPath = path.join(tempDir, "journal.json");
    const identity = { country: "CL", sourceRoot: CONTENT_ROOT, destinationHost: "cl.supabase.co", bucket: "bucket" };
    try {
      const journal = await new MigrationJournal(journalPath, identity).load();
      await Promise.all([
        journal.update("a.txt", { status: "downloaded", source: { size: 1, sha256: "a" } }),
        journal.update("b.txt", { status: "verified", source: { size: 2, sha256: "b" } }),
      ]);
      await journal.flush();

      const reloaded = await new MigrationJournal(journalPath, identity).load();
      assert.equal(reloaded.get("a.txt").source.sha256, "a");
      assert.equal(reloaded.get("b.txt").status, "verified");
      await assert.rejects(
        () => new MigrationJournal(journalPath, { ...identity, country: "PE" }).load(),
        /otro destino\/origen/,
      );
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("dry-run no necesita SUPABASE y genera rutas de estado separadas", () => {
    const parsed = parseArgs(["--country=CL", "--source-manifest-only"]);
    assert.equal(parsed.dryRun, true);
    assert.match(parsed.journalPath, /CL\.source-only\.journal\.json$/);
  });

  it("resuelve dry-run sin ninguna variable SUPABASE", () => {
    const names = [
      "MS_TENANT_ID_CL",
      "MS_CLIENT_ID_CL",
      "MS_CLIENT_SECRET_CL",
      "SP_SITE_ID_CL",
      "SUPABASE_URL_CL",
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY_CL",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY_CL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.MS_TENANT_ID_CL = "tenant";
      process.env.MS_CLIENT_ID_CL = "client";
      process.env.MS_CLIENT_SECRET_CL = "secret";
      process.env.SP_SITE_ID_CL = "site";
      for (const name of names.filter((name) => name.startsWith("SUPABASE_"))) delete process.env[name];

      const config = resolveConfig(parseArgs(["--country=CL", "--dry-run"]));
      assert.equal(config.supabaseUrl, null);
      assert.equal(config.secretKey, null);
      assert.equal(config.siteId, "site");
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("impide que --country=PE reutilice silenciosamente el destino genérico CL", () => {
    const names = [
      "MS_TENANT_ID_PE",
      "MS_CLIENT_ID_PE",
      "MS_CLIENT_SECRET_PE",
      "SP_SITE_ID_PE",
      "SUPABASE_URL",
      "SUPABASE_URL_PE",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_PROJECT_REF_PE",
    ];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.MS_TENANT_ID_PE = "tenant";
      process.env.MS_CLIENT_ID_PE = "client";
      process.env.MS_CLIENT_SECRET_PE = "secret";
      process.env.SP_SITE_ID_PE = "site";
      process.env.SUPABASE_URL = "https://dgadjvptxhotjylwsglx.supabase.co";
      process.env.SUPABASE_SECRET_KEY = "sb_secret_cl";
      delete process.env.SUPABASE_URL_PE;
      delete process.env.SUPABASE_PROJECT_REF_PE;

      assert.throws(
        () => resolveConfig(parseArgs(["--country=PE"])),
        /SUPABASE_PROJECT_REF_PE es obligatoria/,
      );
      process.env.SUPABASE_PROJECT_REF_PE = "dgadjvptxhotjylwsglx";
      assert.throws(
        () => resolveConfig(parseArgs(["--country=PE"])),
        /reservado para CL/,
      );

      process.env.SUPABASE_URL_PE = "https://proyectoperu.supabase.co";
      process.env.SUPABASE_PROJECT_REF_PE = "proyectoperu";
      const config = resolveConfig(parseArgs(["--country=PE"]));
      assert.equal(config.supabaseUrl, "https://proyectoperu.supabase.co");
      process.env.SUPABASE_URL_PE = "http://proyectoperu.supabase.co";
      assert.throws(
        () => resolveConfig(parseArgs(["--country=PE"])),
        /debe usar HTTPS/,
      );
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("manifiesto conserva path, size y SHA-256", () => {
    const manifest = buildManifest(
      { country: "PE", supabaseUrl: null, bucket: "intranet-content" },
      [{
        path: "docs/a.pdf",
        size: 42,
        sha256: "deadbeef",
        contentType: "application/pdf",
        sourceEtag: "etag",
        status: "dry-run",
        action: "source-manifest-only",
      }],
    );
    assert.deepEqual(
      { path: manifest.files[0].path, size: manifest.files[0].size, sha256: manifest.files[0].sha256 },
      { path: "docs/a.pdf", size: 42, sha256: "deadbeef" },
    );
    assert.equal(manifest.destination, null);
  });

  it("ejecuta copia y verificacion final end-to-end con proveedores inyectados", async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tw-migration-run-test-"));
    const body = Buffer.from("contenido");
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    let stored = null;
    let uploads = 0;
    const source = {
      async listFiles() {
        return [{
          id: "graph-id",
          relativePath: "documentos/prueba.txt",
          size: body.length,
          contentType: "text/plain",
          eTag: "source-etag",
        }];
      },
      async downloadToFile(_item, destinationPath) {
        await fsp.writeFile(destinationPath, body);
        return { size: body.length, sha256 };
      },
    };
    const destination = {
      async assertBucketReady(maxBytes) {
        assert.equal(maxBytes, body.length);
      },
      async info() {
        return stored ? { size: stored.length, etag: "destination-etag" } : null;
      },
      async uploadFile(filePath, _item, sourceHash, options) {
        assert.equal(sourceHash, sha256);
        assert.equal(options.upsert, false);
        stored = await fsp.readFile(filePath);
        uploads += 1;
      },
      async hashObject() {
        return {
          size: stored.length,
          sha256: crypto.createHash("sha256").update(stored).digest("hex"),
        };
      },
    };
    const config = {
      country: "CL",
      supabaseUrl: "https://project.supabase.co",
      bucket: "intranet-content",
      dryRun: false,
      onConflict: "error",
      concurrency: 2,
      journalPath: path.join(tempDir, "journal.json"),
      manifestPath: path.join(tempDir, "manifest.json"),
    };

    try {
      const outcome = await runMigration(config, {
        source,
        destination,
        tempDir,
        logger: { log() {}, warn() {}, error() {} },
      });
      assert.equal(uploads, 1);
      assert.equal(outcome.failures.length, 0);
      assert.equal(outcome.results[0].status, "verified");
      assert.equal(outcome.manifest.files[0].destinationSha256, sha256);
    } finally {
      // Windows puede mantener brevemente abiertos los archivos del journal
      // (rename/antivirus). fs.rm solo reintenta ENOTEMPTY cuando maxRetries se
      // configura explicitamente.
      await fsp.rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    }
  });
});
