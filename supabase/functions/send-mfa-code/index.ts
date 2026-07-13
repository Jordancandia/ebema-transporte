// Edge Function: send-mfa-code
// Genera un código OTP de 6 dígitos, lo guarda en mfa_challenges
// y lo envía al correo del usuario autenticado via Resend.
// Llamar DESPUÉS de signInWithPassword exitoso, ANTES de renderApp().

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 1. Verificar sesión del usuario ──────────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Token requerido" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user?.email) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), { status: 401, headers: CORS_HEADERS });
    }

    // ── 2. Rate limiting básico: máx 1 código por minuto ────────────────────
    const { data: recent } = await admin
      .from("mfa_challenges")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("used", false)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      .maybeSingle();

    if (recent) {
      return new Response(
        JSON.stringify({ error: "Espere al menos 1 minuto antes de solicitar un nuevo código" }),
        { status: 429, headers: CORS_HEADERS }
      );
    }

    // ── 3. Invalidar códigos anteriores pendientes ───────────────────────────
    await admin
      .from("mfa_challenges")
      .update({ used: true })
      .eq("user_id", user.id)
      .eq("used", false);

    // ── 4. Generar código 6 dígitos (criptográficamente seguro) ─────────────
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const code = String(100000 + (array[0] % 900000)); // siempre 6 dígitos

    // ── 5. Guardar en mfa_challenges (expira en 10 minutos) ─────────────────
    const { error: insertErr } = await admin
      .from("mfa_challenges")
      .insert({
        user_id:    user.id,
        code,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

    if (insertErr) {
      console.error("Error al guardar challenge:", insertErr.message);
      return new Response(JSON.stringify({ error: "No se pudo generar el código" }), { status: 500, headers: CORS_HEADERS });
    }

    // ── 6. Enviar correo via Resend ──────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY no configurada");
      return new Response(JSON.stringify({ error: "Servicio de correo no configurado" }), { status: 500, headers: CORS_HEADERS });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    "SIT EBEMA <noreply@ebema.cl>",
        to:      [user.email],
        subject: `${code} — Código de verificación SIT EBEMA`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8f9fa;border-radius:8px">
            <div style="text-align:center;margin-bottom:24px">
              <div style="font-size:28px;font-weight:900;color:#b5000b;letter-spacing:-1px">SIT EBEMA</div>
              <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:2px">Sistema Integrado de Transporte</div>
            </div>
            <div style="background:white;border-radius:8px;padding:32px;border:1px solid #e9bcb6">
              <p style="color:#191c1d;margin:0 0 16px;font-size:15px">
                Hola <strong>${user.email}</strong>,
              </p>
              <p style="color:#5c5f61;margin:0 0 24px;font-size:14px">
                Ingresa el siguiente código en la aplicación para completar tu inicio de sesión:
              </p>
              <div style="text-align:center;margin:24px 0">
                <span style="display:inline-block;font-size:40px;font-weight:900;letter-spacing:12px;color:#b5000b;font-family:'Courier New',monospace;background:#fff5f3;padding:16px 24px;border-radius:8px;border:2px solid #ffb4aa">
                  ${code}
                </span>
              </div>
              <p style="color:#936e69;font-size:12px;text-align:center;margin:0">
                Este código expira en <strong>10 minutos</strong>. No lo compartas con nadie.
              </p>
            </div>
            <p style="color:#999;font-size:11px;text-align:center;margin-top:16px">
              Si no solicitaste este código, puedes ignorar este mensaje.
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Resend error:", errBody);
      return new Response(JSON.stringify({ error: "No se pudo enviar el correo de verificación" }), { status: 502, headers: CORS_HEADERS });
    }

    return new Response(
      JSON.stringify({ ok: true, message: `Código enviado a ${user.email}` }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("send-mfa-code error:", err);
    return new Response(JSON.stringify({ error: `Error interno: ${String(err)}` }), { status: 500, headers: CORS_HEADERS });
  }
});
