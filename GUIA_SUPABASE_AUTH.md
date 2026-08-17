# Guía paso a paso — Configuración de Auth en Supabase (SIT EBEMA)

Proyecto Supabase: **humhokvdowfqicjopbhf**
Objetivo: activar confirmación de correo, SMTP de envío y las URLs de retorno para que
funcionen el **auto-registro**, la **confirmación de correo** y las **invitaciones**.

> Toda esta configuración es del **panel web de Supabase**. No requiere código.
> Ábrelo en: https://supabase.com/dashboard  → inicia sesión → selecciona el proyecto
> **humhokvdowfqicjopbhf** (SIT EBEMA).

---

## PASO 1 — Activar "Confirmar correo"

Esto obliga a que cada usuario confirme su correo antes de poder entrar.

1. En el menú lateral izquierdo, entra a **Authentication** (ícono de personas/candado).
2. Dentro de Authentication, abre **Sign In / Providers** (en paneles antiguos:
   **Providers**).
3. En la lista de proveedores, haz clic en **Email**.
4. Busca la opción **Confirm email** (o "Enable email confirmations").
5. Déjala **ACTIVADA** (toggle en verde/on).
6. Confirma que **Enable Email provider** también esté activado.
7. Haz clic en **Save**.

Resultado: cuando alguien se registre, Supabase le mandará un correo con un enlace de
confirmación y no podrá iniciar sesión hasta hacer clic en él.

---

## PASO 2 — Configurar el SMTP de envío (OBLIGATORIO para producción)

Sin un SMTP propio, Supabase usa un servidor de prueba que **casi no envía correos**
(límite muy bajo y a veces no llegan). Para producción hay que poner uno propio.

Ubicación:
1. En **Authentication**, abre **Emails** → pestaña **SMTP Settings**
   (en algunos paneles: **Project Settings → Authentication → SMTP Settings**).
2. Activa **Enable Custom SMTP**.
3. Completa los campos. **Como EBEMA usa correos @ebema.cl (Google Workspace),** la
   opción más simple es usar el SMTP de Google:

   **Opción A — Google Workspace / Gmail corporativo**
   - **Host:** `smtp.gmail.com`
   - **Port:** `587`
   - **Username:** un correo real de EBEMA (ej. `no-reply@ebema.cl` o `jcandia@ebema.cl`)
   - **Password:** una **"Contraseña de aplicación"** de ese correo (NO la contraseña
     normal). Se genera en la cuenta de Google del correo:
     Cuenta de Google → **Seguridad** → **Verificación en dos pasos** (debe estar activa)
     → **Contraseñas de aplicaciones** → crear una → copiar el código de 16 letras.
   - **Sender email:** `no-reply@ebema.cl` (o el correo que usaste)
   - **Sender name:** `SIT EBEMA`

   > Si el dominio ebema.cl está en Google Workspace y el admin de TI bloquea el SMTP,
   > pídele que habilite el envío SMTP o que use **smtp-relay.gmail.com** (puerto 587),
   > que permite enviar desde direcciones del dominio sin contraseña de app.

   **Opción B — Servicio de correo transaccional (recomendado a futuro)**
   - Servicios como **SendGrid**, **Resend**, **Mailgun** o **Amazon SES** dan host,
     puerto, usuario y clave. Se pegan en los mismos campos. Son más robustos para
     volumen y evitan que los correos caigan en spam.

4. Haz clic en **Save**.
5. (Opcional) Usa el botón de **Send test email** si aparece, para verificar que llega.

---

## PASO 3 — Configurar las URLs de retorno

Esto hace que el enlace de confirmación/invitación **vuelva a la aplicación** y funcione
la pantalla de "definir contraseña".

1. En **Authentication**, abre **URL Configuration**.
2. En **Site URL** pon la URL pública de la app en GitHub Pages. Debería ser:

   ```
   https://jordancandia.github.io/ebema-transporte/
   ```

   > Verifica la URL exacta abriendo tu sitio publicado; cópiala tal cual (con la barra
   > final `/`).

3. En **Redirect URLs** haz clic en **Add URL** y agrega **la misma** URL:

   ```
   https://jordancandia.github.io/ebema-transporte/
   ```

   Y también, por si acaso, la variante con comodín:

   ```
   https://jordancandia.github.io/ebema-transporte/**
   ```

4. Haz clic en **Save**.

---

## PASO 4 (opcional recomendado) — Protección de contraseñas filtradas

1. En **Authentication** → **Sign In / Providers** → sección **Password / Security**
   (o **Policies**).
2. Activa **Leaked password protection** (comprueba contraseñas contra HaveIBeenPwned).
3. **Save**.

---

## PASO 5 — Ajustar la cuenta logistica@ebema.cl (si debe seguir entrando)

Esa cuenta tiene un rol antiguo ("operador") que el sistema nuevo no reconoce y la
dejaría **sin permisos**.

- Entra a la app como **OWNER** → menú **Roles y Perfiles** → edita
  **logistica@ebema.cl** → asígnale un rol válido (ej. **Admin. Depósito** con su centro)
  → Guardar.

---

## PASO 6 — Probar que todo funciona

**Prueba de auto-registro (funcionario):**
1. Abre la app publicada → "Regístrate como Proveedor de Servicio" (el formulario de
   registro).
2. Escribe un correo **@ebema.cl** de prueba: los campos de empresa desaparecen.
3. Pon una contraseña y crea la cuenta.
4. Revisa el correo → haz clic en el enlace de **confirmación**.
5. Vuelve a la app e inicia sesión: debe entrar con rol **Agente Comercial**.

**Prueba de invitación (admin):**
1. Entra como **OWNER** → **Roles y Perfiles** → **Agregar Usuario**.
2. Escribe nombre, un correo **@ebema.cl**, elige rol (y centro si aplica) → Guardar.
3. Debe decir "Invitación enviada".
4. En el correo del invitado llega un enlace → al abrirlo, la app muestra
   **"Define tu contraseña"** → la define → entra directo con el rol asignado.

---

## Notas de solución de problemas

- **No llega el correo:** casi siempre es el SMTP (Paso 2). Revisa spam y que la
  contraseña de aplicación sea correcta. Prueba el "Send test email".
- **El enlace da error "redirect not allowed":** falta agregar la URL exacta en
  **Redirect URLs** (Paso 3).
- **"Debes confirmar tu correo antes de ingresar":** es correcto; el usuario aún no hizo
  clic en el enlace de confirmación.
- **Un usuario entra pero no ve datos:** su rol en `app_users` no es válido o está
  `activo = false`. Revísalo en Roles y Perfiles.
