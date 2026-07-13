// Edge Function: invite-user
// Permite a OWNER/ADMIN invitar funcionarios @ebema.cl via Supabase Admin API.
// El usuario invitado recibe un correo con link para definir su contraseña.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const ROLES_PERMITIDOS_INVITAR = ["OWNER", "ADMIN"];
const ROLES_VALIDOS_FUNCIONARIO = [
  "OWNER", "ADMIN", "ADMINISTRADOR_DEPOSITO", "AGENTE_COMERCIAL",
];

serve(async (req: Request) => {
  // Pre-flight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // ── 1. Cliente admin (service_role bypassa RLS) ──────────────────────────
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 2. Verificar que quien llama es OWNER o ADMIN ────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Token de autorización requerido" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller?.email) {
      return new Response(JSON.stringify({ error: "Token inválido o expirado" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: callerProfile } = await admin
      .from("app_users")
      .select("role, activo")
      .eq("email", caller.email)
      .maybeSingle();

    if (!callerProfile?.activo || !ROLES_PERMITIDOS_INVITAR.includes(callerProfile?.role ?? "")) {
      return new Response(
        JSON.stringify({ error: `Acceso denegado. Solo ${ROLES_PERMITIDOS_INVITAR.join("/")} pueden invitar usuarios.` }),
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // ── 3. Validar payload ───────────────────────────────────────────────────
    const { email, name, role, centroId } = await req.json() as {
      email:    string;
      name:     string;
      role:     string;
      centroId?: string;
    };

    if (!email || !name || !role) {
      return new Response(JSON.stringify({ error: "Faltan campos: email, name y role son requeridos" }), { status: 400, headers: CORS_HEADERS });
    }

    if (!email.toLowerCase().endsWith("@ebema.cl")) {
      return new Response(JSON.stringify({ error: "Solo se pueden invitar correos @ebema.cl" }), { status: 400, headers: CORS_HEADERS });
    }

    if (!ROLES_VALIDOS_FUNCIONARIO.includes(role)) {
      return new Response(
        JSON.stringify({ error: `Rol no válido. Opciones: ${ROLES_VALIDOS_FUNCIONARIO.join(", ")}` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // OWNER no puede ser creado por un ADMIN (solo por otro OWNER)
    if (role === "OWNER" && callerProfile.role !== "OWNER") {
      return new Response(JSON.stringify({ error: "Solo un OWNER puede crear otro OWNER" }), { status: 403, headers: CORS_HEADERS });
    }

    // ── 4. Verificar que el email no esté ya registrado ──────────────────────
    const { data: existing } = await admin
      .from("app_users")
      .select("email")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "Este correo ya tiene un perfil en el sistema" }), { status: 409, headers: CORS_HEADERS });
    }

    // ── 5. Disparar invitación — Supabase envía el correo automáticamente ────
    const redirectTo = `${Deno.env.get("SITE_URL") ?? "https://jordancandia.github.io/ebema-transporte/"}`

    const { data: inviteData, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      {
        data: { name, role, tipo: "funcionario", centroId: centroId ?? null },
        redirectTo,
      }
    );

    if (invErr) {
      return new Response(JSON.stringify({ error: invErr.message }), { status: 400, headers: CORS_HEADERS });
    }

    // ── 6. Pre-crear perfil en app_users para que RLS no bloquee primer acceso ─
    const { error: upsertErr } = await admin
      .from("app_users")
      .upsert(
        {
          email:    email.toLowerCase(),
          name,
          role,
          activo:   true,
          centroId: centroId ?? null,
          lastAccess: null,
        },
        { onConflict: "email" }
      );

    if (upsertErr) {
      console.error("Error al crear perfil:", upsertErr.message);
      // No bloqueamos — el perfil se puede crear en el primer login
    }

    return new Response(
      JSON.stringify({
        ok:     true,
        userId: inviteData.user?.id,
        email:  email.toLowerCase(),
        message: `Invitación enviada a ${email}. El usuario debe revisar su correo para activar su cuenta.`,
      }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("invite-user error:", err);
    return new Response(
      JSON.stringify({ error: `Error interno: ${String(err)}` }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
