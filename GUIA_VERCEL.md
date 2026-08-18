# Guía — Desplegar SIT EBEMA en Vercel con dominio propio (sit-ebema.ebema.cl)

La app es un sitio **estático** (HTML + JS ES Modules + Supabase). No tiene build.

---

## PASO 1 — Crear cuenta y conectar el repositorio

1. Entra a https://vercel.com y regístrate **con GitHub** (usa la cuenta dueña del repo `Jordancandia/ebema-transporte`).
2. En el dashboard, clic en **Add New… → Project**.
3. Aparece la lista de repos de GitHub → elige **ebema-transporte** → **Import**.

## PASO 2 — Configurar el proyecto (estático, sin build)

En la pantalla de configuración del import:

- **Framework Preset:** `Other` (u "Otro").
- **Build Command:** déjalo **vacío** (o desactiva "Override").
- **Output Directory:** déjalo **vacío** (la app está en la raíz del repo).
- **Root Directory:** `/` (raíz).
- Clic en **Deploy**.

Vercel publicará en una URL tipo `https://ebema-transporte.vercel.app`. Ábrela y verifica que la app carga bien.

> Como el dominio ahora es la raíz (`/`) y no una subcarpeta, las rutas relativas (`js/app.js`) funcionan sin problema. No necesitas `vercel.json`. El archivo `.nojekyll` es de GitHub Pages y aquí es inofensivo.

## PASO 3 — Agregar el dominio sit-ebema.ebema.cl en Vercel

1. En el proyecto de Vercel → pestaña **Settings → Domains** (o **Domains** en el menú del proyecto).
2. Escribe **`sit-ebema.ebema.cl`** → **Add**.
3. Vercel te mostrará **qué registro DNS crear**. Para un subdominio normalmente es un **CNAME**:
   - **Type:** `CNAME`
   - **Name/Host:** `sit-ebema`
   - **Value/Target:** `cname.vercel-dns.com` (usa EXACTAMENTE el que te muestre Vercel).

   Anota ese valor tal cual aparece en pantalla.

## PASO 4 — Crear el registro DNS (lo hace TI de EBEMA)

El dominio `ebema.cl` lo administra el equipo de TI/redes de EBEMA (en su proveedor DNS: Cloudflare, GoDaddy, NIC Chile, etc.). Pídeles crear:

- **Registro `CNAME`**
- **Host:** `sit-ebema`
- **Apunta a:** `cname.vercel-dns.com` (el valor exacto que dio Vercel en el Paso 3)
- **TTL:** automático / 3600

> Si su DNS no permite CNAME en ese nivel, Vercel también ofrece una opción con registro **A** apuntando a una IP que te indica; pásasela a TI.

Cuando el DNS propague (minutos a un par de horas), Vercel emite el **certificado HTTPS automáticamente** y `https://sit-ebema.ebema.cl` queda activo. En Vercel → Domains verás el dominio en verde ("Valid Configuration").

## PASO 5 — Actualizar Supabase y Google con la nueva URL (IMPORTANTE)

Si no haces esto, el **login, la confirmación de correo y las invitaciones se rompen** en el dominio nuevo.

**A) Supabase → Authentication → URL Configuration**
- **Site URL:** `https://sit-ebema.ebema.cl`
- **Redirect URLs:** agrega `https://sit-ebema.ebema.cl` y `https://sit-ebema.ebema.cl/**`
  (puedes dejar también la URL vieja de GitHub Pages mientras conviven).

**B) Google OAuth (login de funcionarios con Google)**
En Google Cloud Console → APIs y servicios → Credenciales → tu **OAuth 2.0 Client ID**:
- **Orígenes autorizados de JavaScript:** agrega `https://sit-ebema.ebema.cl`
- **URIs de redireccionamiento autorizados:** agrega el callback de Supabase
  `https://humhokvdowfqicjopbhf.supabase.co/auth/v1/callback` (si ya estaba, déjalo).

> Nota: el callback de Google apunta a Supabase, no a tu dominio, así que normalmente no cambia. Lo que sí hay que agregar es el **origen** `https://sit-ebema.ebema.cl`.

## PASO 6 — Despliegue automático

A partir de ahora, cada vez que hagas **push a `main`** (con tu `.bat`), **Vercel redepliega solo** en 1–2 minutos. Ya no dependes del retraso de GitHub Pages.

- Puedes **dejar de usar GitHub Pages** (Settings → Pages → Source: None) o dejarlo como respaldo.

---

## Resumen de lo que necesitas de terceros

| Acción | Quién |
|---|---|
| Crear proyecto en Vercel e importar el repo | Tú |
| Agregar dominio `sit-ebema.ebema.cl` en Vercel | Tú |
| Crear el registro **CNAME** en el DNS de ebema.cl | **TI de EBEMA** |
| Actualizar Site URL / Redirect URLs en Supabase | Tú |
| Agregar el origen nuevo en Google OAuth | Tú (o quien administre el proyecto de Google Cloud) |

## Problemas comunes

- **"Invalid Configuration" en Vercel Domains:** el CNAME aún no propaga o está mal escrito. Espera y verifica con TI.
- **Login con Google falla ("redirect_uri_mismatch" o bloqueo):** falta agregar el origen `https://sit-ebema.ebema.cl` en Google OAuth (Paso 5B).
- **"redirect not allowed" al confirmar correo/invitación:** falta la URL nueva en Redirect URLs de Supabase (Paso 5A).
