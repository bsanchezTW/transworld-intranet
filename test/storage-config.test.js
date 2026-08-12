const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_STORAGE_BUCKET,
  StorageConfigurationError,
  getStorageConfig,
} = require("../src/config/storage");

describe("config/storage", () => {
  it("prioriza SUPABASE_SECRET_KEY y aplica límites seguros", () => {
    const config = getStorageConfig({
      SUPABASE_URL: "https://proyectochile.supabase.co/",
      SUPABASE_SECRET_KEY: "sb_secret_current",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt",
      DB_USER: "postgres.proyectochile",
    });

    assert.equal(config.url, "https://proyectochile.supabase.co");
    assert.equal(config.key, "sb_secret_current");
    assert.equal(config.keySource, "SUPABASE_SECRET_KEY");
    assert.equal(config.usesLegacyKey, false);
    assert.equal(config.bucket, DEFAULT_STORAGE_BUCKET);
    assert.equal(config.maxFileSizeBytes, 250 * 1024 * 1024);
    assert.equal(config.tusThresholdBytes, 6 * 1024 * 1024);
  });

  it("acepta service_role legacy durante la transición", () => {
    const config = getStorageConfig({
      SUPABASE_URL: "https://proyectoperu.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt",
      DATABASE_URL:
        "postgresql://postgres.proyectoperu:secret@aws.pooler.supabase.com/postgres",
    });

    assert.equal(config.key, "legacy-jwt");
    assert.equal(config.usesLegacyKey, true);
  });

  it("rechaza mezclar el proyecto de BD con otro Storage", () => {
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_current",
          DB_USER: "postgres.proyectoperu",
        }),
      (error) =>
        error instanceof StorageConfigurationError &&
        /no mezclar datos/.test(error.message),
    );
  });

  it("detecta el project ref en el host directo de DATABASE_URL", () => {
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_current",
          DATABASE_URL:
            "postgresql://postgres:secret@db.proyectoperu.supabase.co/postgres",
        }),
      /no mezclar datos/,
    );
  });

  it("prioriza DATABASE_URL sobre variables DB_* residuales", () => {
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_current",
          DATABASE_URL:
            "postgresql://postgres.proyectoperu:secret@aws.pooler.supabase.com/postgres",
          DB_USER: "postgres.proyectochile",
        }),
      /no mezclar datos/,
    );
  });

  it("permite el mismo esquema genérico de env para proyectos CL y PE separados", () => {
    const chile = getStorageConfig({
      SUPABASE_URL: "https://proyectochile.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_cl",
      DB_USER: "postgres.proyectochile",
    });
    const peru = getStorageConfig({
      SUPABASE_URL: "https://proyectoperu.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_pe",
      DB_USER: "postgres.proyectoperu",
    });

    assert.notEqual(chile.url, peru.url);
    assert.notEqual(chile.key, peru.key);
    assert.equal(chile.bucket, peru.bucket);
  });

  it("vincula COUNTRY al project ref esperado y bloquea Chile bajo lógica PE", () => {
    assert.throws(
      () =>
        getStorageConfig({
          COUNTRY: "CL",
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_cl",
          DB_USER: "postgres.proyectochile",
        }),
      /exige Supabase/,
    );
    assert.throws(
      () =>
        getStorageConfig({
          COUNTRY: "PE",
          SUPABASE_URL: "https://dgadjvptxhotjylwsglx.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_cl",
          DB_USER: "postgres.dgadjvptxhotjylwsglx",
          SUPABASE_PROJECT_REF_PE: "dgadjvptxhotjylwsglx",
        }),
      /reservado para CL/,
    );
    const peru = getStorageConfig({
      COUNTRY: "PE",
      SUPABASE_URL: "https://proyectoperu.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_pe",
      DB_USER: "postgres.proyectoperu",
      SUPABASE_PROJECT_REF_PE: "proyectoperu",
    });
    assert.equal(peru.url, "https://proyectoperu.supabase.co");
  });

  it("solo permite HTTP para Supabase local", () => {
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "http://storage.example.com",
          SUPABASE_SECRET_KEY: "sb_secret_test",
        }),
      /HTTPS/,
    );
    const local = getStorageConfig({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    });
    assert.equal(local.url, "http://127.0.0.1:54321");
  });

  it("valida límites operacionales", () => {
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_cl",
          SUPABASE_STORAGE_DELETE_BATCH_SIZE: "1001",
        }),
      /no puede superar 1000/,
    );
    assert.throws(
      () =>
        getStorageConfig({
          SUPABASE_URL: "https://proyectochile.supabase.co",
          SUPABASE_SECRET_KEY: "sb_secret_cl",
          SUPABASE_STORAGE_TUS_CHUNK_SIZE_MB: "5",
        }),
      /debe ser 6/,
    );
  });
});
