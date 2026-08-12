const KNOWN_COUNTRY_PROJECT_REFS = Object.freeze({
  CL: "dgadjvptxhotjylwsglx",
});

class SupabaseProjectBindingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SupabaseProjectBindingError";
    this.code = "SUPABASE_PROJECT_BINDING_ERROR";
    this.statusCode = 500;
    Object.assign(this, details);
  }
}

function extractProjectRefFromSupabaseUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  const match = hostname.match(/^([a-z0-9-]{8,})\.supabase\.co$/);
  return match?.[1] || null;
}

function expectedProjectVariable(country) {
  return `SUPABASE_PROJECT_REF_${country}`;
}

function resolveExpectedProjectRef(countryValue, env = process.env) {
  const country = String(countryValue || "").trim().toUpperCase();
  if (!country) return null;
  if (!["CL", "PE"].includes(country)) {
    throw new SupabaseProjectBindingError(`País no soportado para Supabase: ${country}.`);
  }

  const variable = expectedProjectVariable(country);
  const configured = String(env[variable] || "").trim().toLowerCase();
  const fixed = KNOWN_COUNTRY_PROJECT_REFS[country] || null;
  if (fixed && configured && configured !== fixed) {
    throw new SupabaseProjectBindingError(
      `${variable} no coincide con el proyecto registrado para ${country}.`,
      { country, variable, expectedRef: fixed, configuredRef: configured },
    );
  }

  const expected = fixed || configured;
  if (!expected) {
    throw new SupabaseProjectBindingError(
      `${variable} es obligatoria para vincular la instancia ${country} con su proyecto.`,
      { country, variable },
    );
  }
  if (!/^[a-z0-9-]{8,}$/.test(expected)) {
    throw new SupabaseProjectBindingError(`${variable} no contiene un project ref válido.`, {
      country,
      variable,
    });
  }

  for (const [otherCountry, otherRef] of Object.entries(KNOWN_COUNTRY_PROJECT_REFS)) {
    if (otherCountry !== country && otherRef === expected) {
      throw new SupabaseProjectBindingError(
        `${variable} apunta al proyecto reservado para ${otherCountry}; se rechaza el cruce de países.`,
        { country, variable, expectedRef: expected, otherCountry },
      );
    }
  }
  return expected;
}

function assertCountrySupabaseProject(url, country, env = process.env) {
  const expectedRef = resolveExpectedProjectRef(country, env);
  if (!expectedRef) return null;
  const actualRef = extractProjectRefFromSupabaseUrl(url);
  if (!actualRef || actualRef !== expectedRef) {
    throw new SupabaseProjectBindingError(
      `La instancia ${String(country).toUpperCase()} exige Supabase "${expectedRef}", ` +
        `pero SUPABASE_URL apunta a "${actualRef || "un host no identificable"}".`,
      { country: String(country).toUpperCase(), expectedRef, actualRef },
    );
  }
  return expectedRef;
}

module.exports = {
  KNOWN_COUNTRY_PROJECT_REFS,
  SupabaseProjectBindingError,
  extractProjectRefFromSupabaseUrl,
  expectedProjectVariable,
  resolveExpectedProjectRef,
  assertCountrySupabaseProject,
};
