const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { isIdPrimaryKeyCollision } = require("../src/utils/idCollision");

describe("isIdPrimaryKeyCollision", () => {
  it("detecta unique_violation del PK id por constraint", () => {
    assert.equal(
      isIdPrimaryKeyCollision({ code: "23505", constraint: "users_pkey" }),
      true,
    );
    assert.equal(
      isIdPrimaryKeyCollision({
        code: "23505",
        constraint: "news_articles_pkey",
      }),
      true,
    );
  });

  it("detecta unique_violation del PK id por detail", () => {
    assert.equal(
      isIdPrimaryKeyCollision({
        code: "23505",
        detail: "Key (id)=(482191) already exists.",
      }),
      true,
    );
  });

  it("no reintenta unique de email, slug u otras claves", () => {
    assert.equal(
      isIdPrimaryKeyCollision({ code: "23505", constraint: "users_email_key" }),
      false,
    );
    assert.equal(
      isIdPrimaryKeyCollision({
        code: "23505",
        constraint: "events_slug_key",
        detail: "Key (slug)=(verano) already exists.",
      }),
      false,
    );
    assert.equal(isIdPrimaryKeyCollision({ code: "23503" }), false);
    assert.equal(isIdPrimaryKeyCollision(null), false);
  });
});
