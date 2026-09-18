// Edge Function: resend-invite
// Reenvía el correo de invitación a un usuario @ebema.cl que todavía no activa
// su cuenta (no ha definido contraseña). Solo OWNER/ADMIN pueden invocarla,
// igual que invite-user.
//
// Por qué no basta con llamar inviteUserByEmail() de nuevo: GoTrue crea la fila
// en auth.users apenas se invita por primera vez (queda sin confirmar), así que
// una segunda invitación al mismo correo falla con "User already registered".
// La forma soportada de "reenviar" es borrar esa fila de auth.users SOLO SI
// sigue sin confirmar (email_confirmed_at/confirmed_at nulos) y volver a invitar,
// lo que genera un nuevo enlace y dispara un nuevo correo. Si el usuario ya
// activó su cuenta (ya tiene contraseña), se rechaza para no borrar una cuenta
// real por error.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const ROLES_PERMITIDOS_INVITAR = ["OWNER", "ADMIN"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 1. Verificar que quien llama es OWNER o ADMIN ────────────────────────
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
        JSON.stringify({ error: `Acceso denegado. Solo ${ROLES_PERMITIDOS_INVITAR.join("/")} pueden reenviar invitaciones.` }),
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // ── 2. Payload ────────────────────────────────────────────────────────────
    const { email } = await req.json() as { email: string };
    if (!email) {
      return new Response(JSON.stringify({ error: "Falta el campo email" }), { status: 400, headers: CORS_HEADERS });
    }
    const emailLower = email.toLowerCase();

    // ── 3. Debe existir un perfil activo en app_users (rol/centro ya definidos) ─
    const { data: profile, error: profileErr } = await admin
      .from("app_users")
      .select("email, name, role, activo, \"centrosPreferencia\"")
      .eq("email", emailLower)
      .maybeSingle();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: "No existe un perfil para ese correo." }), { status: 404, headers: CORS_HEADERS });
    }
    if (!profile.activo) {
      return new Response(JSON.stringify({ error: "El usuario está inhabilitado. Actívelo antes de reenviar la invitación." }), { status: 400, headers: CORS_HEADERS });
    }

    // ── 4. Buscar la cuenta en auth.users (si existe) ────────────────────────
    let existingAuthUser: { id: string; confirmed: boolean } | null = null;
    {
      let page = 1;
      const perPage = 200;
      // Con la base de usuarios corporativos actual (decenas), 1-2 páginas alcanzan.
      while (page <= 5 && !existingAuthUser) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
        if (listErr) break;
        const found = list?.users?.find(u => (u.email || "").toLowerCase() === emailLower);
        if (found) {
          existingAuthUser = {
            id: found.id,
            confirmed: !!(found.email_confirmed_at || found.confirmed_at),
          };
          break;
        }
        if (!list || list.users.length < perPage) break; // última página
        page++;
      }
    }

    if (existingAuthUser?.confirmed) {
      return new Response(
        JSON.stringify({ error: "Este usuario ya activó su cuenta (ya definió contraseña). No corresponde reenviar la invitación." }),
        { status: 409, headers: CORS_HEADERS }
      );
    }

    // ── 5. Si existe pero sigue sin confirmar, eliminar para poder re-invitar ──
    if (existingAuthUser) {
      const { error: delErr } = await admin.auth.admin.deleteUser(existingAuthUser.id);
      if (delErr) {
        return new Response(JSON.stringify({ error: `No se pudo preparar el reenvío: ${delErr.message}` }), { status: 500, headers: CORS_HEADERS });
      }
    }

    // ── 6. Reinvitar — dispara un nuevo correo de invitación ─────────────────
    const redirectTo = `${Deno.env.get("SITE_URL") ?? "https://jordancandia.github.io/ebema-transporte/"}`;

    const { data: inviteData, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      emailLower,
      {
        data: {
          name: profile.name,
          role: profile.role,
          tipo: "funcionario",
          centrosPreferencia: profile.centrosPreferencia ?? null,
        },
        redirectTo,
      }
    );

    if (invErr) {
      return new Response(JSON.stringify({ error: invErr.message }), { status: 400, headers: CORS_HEADERS });
    }

    // El trigger on_auth_user_created relinkea user_id por email automáticamente.
    return new Response(
      JSON.stringify({
        ok: true,
        userId: inviteData.user?.id,
        email: emailLower,
        message: `Invitación reenviada a ${emailLower}.`,
      }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("resend-invite error:", err);
    return new Response(
      JSON.stringify({ error: `Error interno: ${String(err)}` }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
