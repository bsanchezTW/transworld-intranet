const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../src/utils/logger");

describe("logger — errores de Postgres", () => {
  beforeEach(() => logger.reset());
  afterEach(() => logger.reset());

  it("explica 28P01 con el rol y el ALTER USER", () => {
    const described = logger.describeError({
      code: "28P01",
      message: 'password authentication failed for user "intranet_peru"',
    });
    assert.equal(described.kind, "auth");
    assert.equal(described.scope, "db");
    assert.match(described.message, /intranet_peru/);
    assert.match(described.message, /ALTER USER intranet_peru/);
  });

  it("explica el circuit breaker del pooler", () => {
    const described = logger.describeError({
      code: "XX000",
      message:
        "(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked",
    });
    assert.equal(described.kind, "circuit");
    assert.match(described.message, /espera 1–2 min/i);
  });

  it("explica econnrefused del pooler Elixir", () => {
    const described = logger.describeError({
      code: "08006",
      message: "Failed to connect to database: {:error, :econnrefused}",
    });
    assert.equal(described.kind, "down");
    assert.match(described.message, /pausado o reiniciando/);
  });

  it("agrupa el mismo fallo de BD en una sola línea", () => {
    const errors = [];
    mock.method(console, "error", (line) => errors.push(line));

    logger.error("apps", {
      code: "28P01",
      message: 'password authentication failed for user "intranet_peru"',
    });
    logger.error("noticias", {
      code: "28P01",
      message: 'password authentication failed for user "intranet_peru"',
    });
    logger.error("cron", {
      code: "28P01",
      message: 'password authentication failed for user "intranet_peru"',
    });

    mock.restoreAll();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^\[db\] /);
    assert.match(errors[0], /intranet_peru/);
  });
});
