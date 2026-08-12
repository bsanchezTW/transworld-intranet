const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  FEATURE_KEYS,
  FEATURE_MATRIX,
  isFeatureEnabled,
  getFeatures,
} = require("../src/config/features");

/** Ejecuta fn con COUNTRY fijada, restaurando el valor previo. */
function withCountry(code, fn) {
  const previous = process.env.COUNTRY;
  if (code === undefined) delete process.env.COUNTRY;
  else process.env.COUNTRY = code;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.COUNTRY;
    else process.env.COUNTRY = previous;
  }
}

describe("config/features — LinkedIn y UF por país", () => {
  it("declara linkedinFeed y chileUfIndicator para todos los países", () => {
    assert.ok(FEATURE_KEYS.includes("linkedinFeed"));
    assert.ok(FEATURE_KEYS.includes("chileUfIndicator"));
    for (const code of Object.keys(FEATURE_MATRIX)) {
      assert.equal(typeof FEATURE_MATRIX[code].linkedinFeed, "boolean");
      assert.equal(typeof FEATURE_MATRIX[code].chileUfIndicator, "boolean");
    }
  });

  it("Chile tiene LinkedIn y UF activos", () => {
    withCountry("CL", () => {
      assert.equal(isFeatureEnabled("linkedinFeed"), true);
      assert.equal(isFeatureEnabled("chileUfIndicator"), true);
      assert.deepEqual(getFeatures().linkedinFeed, true);
    });
  });

  it("Perú no incluye LinkedIn ni contador UF", () => {
    withCountry("PE", () => {
      assert.equal(isFeatureEnabled("linkedinFeed"), false);
      assert.equal(isFeatureEnabled("chileUfIndicator"), false);
    });
  });
});
