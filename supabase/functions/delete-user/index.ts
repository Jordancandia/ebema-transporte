// Edge Function: delete-user
// Permite a OWNER eliminar permanentemente un usuario de auth.users (cascade a app_users).

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

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

    // 1. Verificar que quien llama es OWNER
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Token requerido" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller?.email) {
      return new Response(JSON.stringify({ error: "Token inválido" }), { status: 401, headers: CORS_HEADERS });
    }

    const { data: callerProfile } = await admin
      .from("app_users")
      .select("role, activo")
      .eq("email", caller.email)
      .maybeSingle();

    if (!callerProfile?.activo || callerProfile?.role !== "OWNER") {
      return new Response(
        JSON.stringify({ error: "Solo OWNER puede eliminar usuarios." }),
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // 2. Validar payload
    const { email } = await req.json() as { email: string };
    if (!email) {
      return new Response(JSON.stringify({ error: "email es requerido" }), { status: 400, headers: CORS_HEADERS });
    }

    // No puede auto-eliminarse
    if (email.toLowerCase() === caller.email?.toLowerCase()) {
      return new Response(JSON.stringify({ error: "No puedes eliminar tu propio usuario." }), { status: 400, headers: CORS_HEADERS });
    }

    // 3. Obtener user_id desde app_users o auth.users por email
    const { data: profile } = await admin
      .from("app_users")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();

    let userId = profile?.user_id ?? null;

    // Si no tiene user_id vinculado, buscar en auth.users por email
    if (!userId) {
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (!listErr) {
        const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        userId = match?.id ?? null;
      }
    }

    // Eliminar de auth.users (cascade borra app_users)
    if (userId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) {
        return new Response(JSON.stringify({ error: `Error al eliminar auth user: ${delErr.message}` }), { status: 500, headers: CORS_HEADERS });
      }
    }

    // Eliminar también de app_users por email (por si no tenía user_id)
    await admin.from("app_users").delete().eq("email", email);

    return new Response(JSON.stringify({ message: `Usuario ${email} eliminado correctamente.` }), { headers: CORS_HEADERS });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), { status: 500, headers: CORS_HEADERS });
  }
});
