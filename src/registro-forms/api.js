/**
 * API pública del formulario de registro.
 * Usa el proyecto Supabase de registro (anon/publishable key), nunca la BD de la intranet.
 */
const crypto = require("crypto");
const { supabase, isConfigured } = require("./db");

function generarUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function requireRegistroDb(res) {
  if (!isConfigured()) {
    res.status(503).json({
      ok: false,
      error: "Servicio de registro no configurado",
    });
    return false;
  }
  return true;
}

async function getEvento(req, res) {
  if (!requireRegistroDb(res)) return;

  const eventoId = String(req.params.id || "").trim();
  if (!eventoId) {
    return res.status(400).json({ ok: false, error: "ID de evento requerido" });
  }

  try {
    const { data: evento, error: eventoError } = await supabase
      .from("eventos")
      .select("id, nombre, fecha, lugar, direccion")
      .eq("id", eventoId)
      .maybeSingle();

    if (eventoError) throw eventoError;
    if (!evento) {
      return res.status(404).json({ ok: false, error: "Evento no encontrado" });
    }

    const { data: bloques, error: bloquesError } = await supabase
      .from("evento_bloques")
      .select("id, etiqueta, orden")
      .eq("evento_id", eventoId)
      .or("activo.eq.true,activo.is.null")
      .order("orden", { ascending: true });

    if (bloquesError) throw bloquesError;

    return res.json({
      ok: true,
      evento: {
        id: evento.id,
        nombre: evento.nombre || "",
        fecha: evento.fecha || "",
        lugar: evento.lugar || "",
        direccion: evento.direccion || "",
      },
      bloques: bloques || [],
    });
  } catch (err) {
    console.error("[registro-forms] Error cargando evento:", err.message || err);
    return res.status(500).json({ ok: false, error: "Error al cargar el evento" });
  }
}

async function registrar(req, res) {
  if (!requireRegistroDb(res)) return;

  const body = req.body || {};
  const eventoId = String(body.evento_id || "").trim();
  const nombre_completo = String(body.nombre_completo || "").trim();
  const empresa = String(body.empresa || "").trim();
  const cargo = String(body.cargo || "").trim();
  const telefono = String(body.telefono || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const bloque_id = body.bloque_id ? String(body.bloque_id).trim() : null;

  if (!eventoId) {
    return res.status(400).json({ ok: false, error: "ID de evento requerido" });
  }
  if (!nombre_completo || !empresa || !cargo || !telefono || !email) {
    return res
      .status(400)
      .json({ ok: false, error: "Todos los campos son obligatorios" });
  }
  if (!email.includes("@")) {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  try {
    const { data: evento, error: eventoError } = await supabase
      .from("eventos")
      .select("id")
      .eq("id", eventoId)
      .maybeSingle();

    if (eventoError) throw eventoError;
    if (!evento) {
      return res.status(404).json({ ok: false, error: "Evento no encontrado" });
    }

    const { data: duplicados, error: dupError } = await supabase.rpc(
      "verificar_duplicado",
      {
        p_evento_id: eventoId,
        p_email: email,
      },
    );

    if (dupError) throw dupError;

    if (duplicados && duplicados.length > 0) {
      const previo = duplicados[0];
      return res.status(409).json({
        ok: false,
        error: `El correo ${email} ya se encuentra registrado a nombre de ${previo.nombre_completo}.`,
        duplicado: previo,
      });
    }

    if (bloque_id) {
      const { data: bloque, error: bloqueError } = await supabase
        .from("evento_bloques")
        .select("id")
        .eq("id", bloque_id)
        .eq("evento_id", eventoId)
        .maybeSingle();

      if (bloqueError) throw bloqueError;
      if (!bloque) {
        return res.status(400).json({
          ok: false,
          error: "El bloque seleccionado no es válido para este evento",
        });
      }
    }

    const registroId = generarUUID();

    const { error: insertError } = await supabase.from("registrados").insert([
      {
        id: registroId,
        nombre_completo,
        empresa,
        cargo,
        telefono,
        email,
        bloque_id: bloque_id || null,
        evento_id: eventoId,
        acreditado: false,
        utm_source: body.utm_source || null,
        utm_medium: body.utm_medium || null,
        utm_campaign: body.utm_campaign || null,
        utm_content: body.utm_content || null,
      },
    ]);

    if (insertError) throw insertError;

    return res.json({
      ok: true,
      id: registroId,
      nombre_completo,
      empresa,
      cargo,
      telefono,
      email,
      bloque_id: bloque_id || null,
    });
  } catch (err) {
    console.error("[registro-forms] Error al registrar:", err.message || err);
    const msg = String(err.message || "").toLowerCase();
    if (msg.includes("cupo")) {
      return res.status(409).json({
        ok: false,
        error:
          "El bloque seleccionado ya no tiene cupos disponibles. Elige otro bloque.",
      });
    }
    return res.status(500).json({ ok: false, error: "Error al registrar" });
  }
}

module.exports = { getEvento, registrar };
