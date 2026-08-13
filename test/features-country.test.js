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

describe("config/features — capacidades por país", () => {
  it("declara las features para todos los países", () => {
    for (const key of [
      "linkedinFeed",
      "chileUfIndicator",
      "lunchMenu",
      "claudeAssistant",
    ]) {
      assert.ok(FEATURE_KEYS.includes(key));
      for (const code of Object.keys(FEATURE_MATRIX)) {
        assert.equal(typeof FEATURE_MATRIX[code][key], "boolean");
      }
    }
  });

  it("Chile tiene LinkedIn, UF, menú y Claude activos", () => {
    withCountry("CL", () => {
      assert.equal(isFeatureEnabled("linkedinFeed"), true);
      assert.equal(isFeatureEnabled("chileUfIndicator"), true);
      assert.equal(isFeatureEnabled("lunchMenu"), true);
      assert.equal(isFeatureEnabled("claudeAssistant"), true);
      assert.deepEqual(getFeatures().linkedinFeed, true);
    });
  });

  it("Perú no incluye LinkedIn, UF, menú ni Claude", () => {
    withCountry("PE", () => {
      assert.equal(isFeatureEnabled("linkedinFeed"), false);
      assert.equal(isFeatureEnabled("chileUfIndicator"), false);
      assert.equal(isFeatureEnabled("lunchMenu"), false);
      assert.equal(isFeatureEnabled("claudeAssistant"), false);
    });
  });
});
