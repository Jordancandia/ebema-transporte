// Edge Function: verify-mfa-code
// Verifica el código OTP ingresado por el usuario.
// Si es correcto, marca el challenge como usado y responde ok:true.
// El frontend procede a renderApp() solo si ok:true.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_ATTEMPTS = 5; // bloquear después de N intentos fallidos

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 1. Verificar sesión ──────────────────────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Token requerido" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), { status: 401, headers: CORS_HEADERS });
    }

    // ── 2. Obtener código del body ───────────────────────────────────────────
    const { code } = await req.json() as { code: string };
    if (!code || !/^\d{6}$/.test(code.trim())) {
      return new Response(JSON.stringify({ error: "El código debe tener exactamente 6 dígitos" }), { status: 400, headers: CORS_HEADERS });
    }

    // ── 3. Contar intentos fallidos recientes (ventana 15 min) ───────────────
    const { count: failedCount } = await admin
      .from("mfa_challenges")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("used", true)
      .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString());

    if ((failedCount ?? 0) >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ error: "Demasiados intentos fallidos. Espere 15 minutos o solicite un nuevo código." }),
        { status: 429, headers: CORS_HEADERS }
      );
    }

    // ── 4. Buscar challenge válido ───────────────────────────────────────────
    const { data: challenge } = await admin
      .from("mfa_challenges")
      .select("id, code, expires_at")
      .eq("user_id", user.id)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!challenge) {
      return new Response(
        JSON.stringify({ error: "No hay un código activo. Solicite uno nuevo." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ── 5. Comparación segura (timing-safe no disponible en Deno std simple,
    //       pero el código es de uso único y expira, mitigando timing attacks) ─
    if (challenge.code !== code.trim()) {
      // Marcar como fallido (used=true) para contar el intento
      await admin
        .from("mfa_challenges")
        .update({ used: true })
        .eq("id", challenge.id);

      return new Response(
        JSON.stringify({ error: "Código incorrecto. Verifique e intente de nuevo." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ── 6. Código correcto — marcar como usado ───────────────────────────────
    await admin
      .from("mfa_challenges")
      .update({ used: true })
      .eq("id", challenge.id);

    return new Response(
      JSON.stringify({ ok: true, verified: true }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("verify-mfa-code error:", err);
    return new Response(
      JSON.stringify({ error: `Error interno: ${String(err)}` }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
