const { createClient } = require("@supabase/supabase-js");

const url = (process.env.REGISTRO_SUPABASE_URL || "").trim();
const key = (
  process.env.REGISTRO_SUPABASE_PB_KEY ||
  process.env.REGISTRO_SUPABASE_PUBLISHABLE_KEY ||
  ""
).trim();

const supabase =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

if (!supabase) {
  console.warn(
    "[registro-forms] Sin REGISTRO_SUPABASE_URL / REGISTRO_SUPABASE_PB_KEY — API de registro no disponible",
  );
}

module.exports = {
  supabase,
  isConfigured: () => Boolean(supabase),
};
