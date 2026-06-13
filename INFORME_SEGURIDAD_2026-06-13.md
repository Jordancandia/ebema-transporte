# Informe de Seguridad — SIT EBEMA
**Fecha:** 13-06-2026
**Alcance:** código fuente (`js/`), base de datos Supabase (`humhokvdowfqicjopbhf`), políticas RLS, portal de proveedores externos.

---

## 1. Resumen ejecutivo

Se revisó el código completo, el esquema de base de datos y las 24 políticas RLS existentes sobre las 11 tablas públicas. Se encontraron y corrigieron **5 vulnerabilidades/inconsistencias** directamente en la base de datos (vía migraciones aplicadas hoy) y **1 bug funcional** ya corregido y desplegado. Además se identificaron **3 riesgos pendientes** que requieren una decisión de diseño antes de implementarse (no se aplicaron cambios automáticos por su impacto).

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | `idCentroSap` inexistente → "undefined" en centros nuevos | Medio (funcional) | ✅ Corregido y desplegado |
| 2 | ADMIN_DEPOSITO podía crear/ascender usuarios a nivel OWNER | Alto (privilegios) | ✅ Corregido (RLS + trigger) |
| 3 | Proveedor externo podía auto-aprobarse (`estado`) o falsificar RUT/razón social | Alto (integridad) | ✅ Corregido (trigger) |
| 4 | Transportista podía reasignar `ownerEmail`, código SAP, `activo`, `centrosServicio` de su propio camión | Alto (integridad) | ✅ Corregido (trigger) |
| 5 | Funciones `SECURITY DEFINER` invocables por `anon` vía RPC | Bajo | ✅ Corregido (revoke) |
| 6 | XSS: datos de proveedores/camiones sin escapar en `innerHTML` | Alto (XSS) | ✅ Corregido (portal + `transports.js`, `ficha-transporte.js`, `roles.js`) |
| 7 | Registro de proveedor sin validación de `rut`/longitudes (`user_metadata` libre) | Medio | ✅ Corregido (`app.js`) |
| 8 | Sync destructivo (`syncToSupabase`) falla silenciosamente para roles no-OWNER | **Crítico (funcional)** | ✅ Corregido (try/catch por tabla) |
| 9 | `quotes_history` sin columna de centro/usuario → no se puede acotar por RLS | Medio | ✅ Corregido (columnas + RLS) |
| 10 | Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada | Bajo | 📋 Acción manual en Dashboard (ver 5.4) |

---

## 2. Corregido hoy

### 2.1 Bug "undefined" en código SAP de Centros Logísticos (ya desplegado)
- **Archivos:** `js/logistics.js` (línea 249), `js/ficha-transporte.js` (línea 667).
- **Causa:** ambos referenciaban `cd.idCentroSap`, campo eliminado por la migración de datos (el código SAP ahora vive en `cd.id`).
- **Fix:** reemplazado por `cd.id` en ambos lugares. Verificado con `node --check` y desplegado (commit `f18fb6b`).

### 2.2 Escalamiento de privilegios vía `app_users` (Alto)
**Problema:** la política `app_users_insert` permitía a un `ADMINISTRADOR_DEPOSITO` insertar una nueva fila en `app_users` con **cualquier valor de `role`**, siempre que `centroId` fuera el suyo. Como `app_role()` mapea cualquier valor de `role` que no sea uno de los 4 roles acotados (`ADMINISTRADOR_DEPOSITO`, `AGENTE_COMERCIAL`, `TRANSPORTISTA`, `CHOFER`) a `'OWNER'`, un Admin de Depósito podía crear una cuenta con privilegios de **OWNER** (acceso total) escribiendo, por ejemplo, `role = 'superadmin'`.

Lo mismo aplicaba en `UPDATE`: el trigger `prevent_role_escalation` permitía a ADMIN_DEPOSITO cambiar el `role` de cualquier usuario de su centro a un valor arbitrario.

**Fix aplicado** (migraciones `harden_app_users_role_assignment`):
- `app_users_insert` ahora exige que, si quien inserta es `ADMINISTRADOR_DEPOSITO`, el `role` insertado sea uno de `ADMINISTRADOR_DEPOSITO | AGENTE_COMERCIAL | TRANSPORTISTA | CHOFER`.
- `prevent_role_escalation()` aplica la misma restricción en `UPDATE`.

### 2.3 Proveedor externo podía auto-aprobarse y falsificar identidad (Alto)
**Problema:** la política `providers.own_row` (`ALL`, `email = jwt.email`) permite al proveedor editar **toda su fila**, incluyendo:
- `estado` → podía cambiar `pendiente` → `aprobado` por sí mismo.
- `razonSocial`, `rut`, `email`, `createdAt` → podía falsificar la identidad de la empresa después de la revisión inicial de EBEMA.

**Fix aplicado** (`lock_provider_self_edit_fields`): trigger `trg_prevent_provider_field_tampering` en `providers` bloquea cambios a `email`, `estado`, `razonSocial`, `rut`, `createdAt` para cualquiera que no sea `OWNER`. El proveedor sigue pudiendo editar `telefono` y `representante` (como ya hace el formulario del portal).

### 2.4 Transportista podía alterar campos administrativos de su propio camión (Alto)
**Problema:** la política `transports.provider_own_transports` (`ALL`, `ownerEmail = jwt.email`) permite editar **toda la fila**, incluyendo:
- `ownerEmail` → podría "transferir" el camión a otra cuenta (o robar uno ajeno cambiando el email a uno que no controla, dejándolo huérfano).
- `codigoSap`, `activo`, `centrosServicio` → campos asignados administrativamente por EBEMA (habilitación, centros donde puede operar).

**Fix aplicado** (`lock_transport_admin_fields_for_owners_self_edit`): trigger `trg_prevent_transport_field_tampering` en `transports` bloquea cambios a `id`, `ownerEmail`, `codigoSap`, `activo`, `centrosServicio` para cualquiera que no sea `OWNER`. El resto de los campos (flota, choferes, documentos, datos bancarios, etc.) sigue editable por el transportista, igual que hoy.

### 2.5 Funciones de seguridad expuestas a `anon` (Bajo)
**Problema:** `app_role()`, `app_centro()`, `app_transportista()` y las funciones de trigger eran ejecutables vía `/rest/v1/rpc/...` por el rol `anon` (no autenticado), heredado del grant a `PUBLIC`.

**Fix aplicado** (`revoke_public_exec_security_definer_funcs`): se revocó `EXECUTE` de `PUBLIC` en las 6 funciones; se re-otorgó explícitamente a `authenticated` solo en las 3 que las políticas RLS necesitan (`app_role`, `app_centro`, `app_transportista`). Las funciones de trigger no requieren `EXECUTE` directo.

**Resultado:** los 7 hallazgos `WARN` de seguridad de Supabase bajaron a 4 (3 son el uso *intencional* de esas 3 funciones por `authenticated`, requerido por las políticas RLS; el cuarto se detalla en 2.6 / sección 5).

### 2.6 XSS en Portal de Proveedores (parcial)
**Problema:** no existía ninguna función de escape HTML en el proyecto. `provider-portal.js` interpola directamente en `innerHTML` campos provenientes de `user_metadata` (controlados 100% por el usuario externo al registrarse): `razonSocial`, `rut`, `representante`, `telefono`, `email`, y campos de camiones (`patente`, `modelo`, `codigoSap`, `capacidad`). Un proveedor podía registrarse con `razonSocial = "<img src=x onerror=alert(document.cookie)>"` y ese script se ejecutaría en el navegador de **cualquier usuario EBEMA** que abra la lista de proveedores (donde se muestran estos mismos campos).

**Fix aplicado:**
- Nueva función `escapeHtml()` en `js/utils.js`.
- Aplicada a todas las interpolaciones de datos dinámicos en `js/provider-portal.js` (cabecera de sesión, formulario de perfil, listado "Mis Camiones").

**Actualización 13-06-2026 (2ª pasada):** se aplicó `escapeHtml()` de forma sistemática al resto de las vistas internas: `js/transports.js` (tabla de transportes y previsualización de CSV de carga masiva), `js/ficha-transporte.js` (datos del transportista, camiones, choferes, alertas) y `js/roles.js` (selector de transporte). Cubre `razonSocial`, `rut`, `patente`, `telefono`, `email`, `codigoSap`, nombres de choferes y archivos adjuntos.

---

## 3. Estado final de RLS (resumen por tabla)

Las 11 tablas tienen RLS habilitado. Tras los cambios de hoy:

- **`app_users`**: OWNER y ADMIN_DEPOSITO (su centro) administran usuarios; un usuario puede ver/editar su propia fila pero no su `role`/`centroId`/`transportistaId` (trigger). ADMIN_DEPOSITO ya no puede otorgarse ni otorgar a otros un rol equivalente a OWNER.
- **`providers`**: el proveedor solo ve/edita su propia fila (campos no-administrativos); OWNER/ADMIN_DEPOSITO/AGENTE_COMERCIAL pueden listar; solo OWNER escribe libremente o cambia `estado`/identidad.
- **`transports`**: el transportista/proveedor solo ve/edita su propio camión (campos operativos); solo OWNER puede tocar `ownerEmail`, `codigoSap`, `activo`, `centrosServicio`.
- **`transports_camiones` / `transports_choferes`**: scoped por `id_transporte = app_transportista()`, OWNER/ADMIN_DEPOSITO/AGENTE_COMERCIAL ven todo.
- **`logistics_centres`, `routes`**: scoped por centro para ADMIN_DEPOSITO/AGENTE_COMERCIAL; TRANSPORTISTA/CHOFER tienen lectura general (necesaria para cotizar/operar); escritura solo OWNER o ADMIN_DEPOSITO de su centro.
- **`truck_types`, `tariff_config`, `client_tariff_config`**: lectura para roles internos, escritura solo OWNER.
- **`quotes_history`**: ahora tiene columnas `id_centro`/`creado_por`; ADMIN_DEPOSITO/AGENTE_COMERCIAL acotados a `id_centro = app_centro()`, OWNER/TRANSPORTISTA sin restricción, CHOFER sin acceso (ver sección 5.3).

---

## 4. Riesgos en campos de usuarios externos — evaluación

| Campo / flujo | Origen | Riesgo | Mitigación actual | Mitigación recomendada |
|---|---|---|---|---|
| `razonSocial`, `rut`, `telefono`, `representante` (registro inicial) | `user_metadata` en `signUp()`, 100% controlado por el atacante | XSS si se renderiza sin escapar; `rut` no se valida con `validateRut()` en el alta | Trigger bloquea edición posterior de `razonSocial`/`rut`; `escapeHtml` aplicado en el portal | Validar `rut` (mod-11) y largo máximo de campos **antes** del `insert` en `app.js`; aplicar `escapeHtml` en todas las vistas internas |
| `telefono`, `representante` (auto-edición) | Formulario del portal, validado por `formatPhone` | Bajo — ya formateado y ahora escapado | `escapeHtml` + `formatPhone` | Limitar longitud máxima en el `input` y en el servidor |
| Camiones del proveedor (`patente`, `modelo`, `capacidad`, `codigoSap`) | Asignados por EBEMA, solo lectura en el portal | Bajo | RLS + `escapeHtml` | — |
| CSV de carga masiva de transportistas (`transports.js`) | Archivo subido por usuario interno | Bajo (usuario interno autenticado), pero la vista previa usa `innerHTML` sin escapar `razonSocial`/`rut`/`patente` del CSV | Validación de RUT/patente/duplicados antes de insertar | Aplicar `escapeHtml` en la previsualización del CSV |
| `geocodeAddress()` (Nominatim) | Dirección ingresada por usuario interno | Bajo — solo lectura externa, sin clave API, fallback a Santiago | — | Considerar rate-limiting si el volumen crece |

---

## 5. Recomendaciones — estado tras la 2ª pasada (13-06-2026)

Los puntos 5.1, 5.2 y 5.3 fueron implementados hoy (ver descripción de la solución aplicada en cada uno). El punto 5.4 sigue pendiente de acción manual en el Dashboard.

### 5.1 Crítico — `syncToSupabase` rompe el guardado para roles no-OWNER — ✅ Corregido
`data.js → syncToSupabase()` hace, para **cada una** de las 11 tablas, un `upsert()` de todas las filas locales seguido de un `delete()` de todo lo que no esté en esa lista — es decir, un **sync de colección completa**. Con las políticas RLS actuales (que ya limitaban — y ahora limitan más — qué filas puede tocar cada rol), cualquier usuario que no sea OWNER:

- No puede `delete()` filas fuera de su alcance → Supabase devuelve éxito pero **0 filas afectadas** en el delete (no es necesariamente error), pero el `upsert()` de tablas fuera de su alcance (p. ej. `truck_types`, `tariff_config`) **sí falla con error de RLS**, y `syncToSupabase` usa `for...of` + `throw` en el primer error: **toda la sincronización se aborta**, incluida la tabla que el usuario sí quería guardar (si el orden de `TABLE_MAP` la coloca después de una tabla restringida).

**Síntoma para el usuario:** guarda datos en pantalla (se ven localmente porque `saveDatabase` escribe a `localStorage` de inmediato), pero aparece el toast genérico *"No se pudo sincronizar con el servidor. Cambios guardados solo localmente."* y, tras recargar o en otro dispositivo, los cambios **no están**.

**Esto afecta a TODOS los roles excepto OWNER** en cuanto intenten guardar cualquier cosa, porque `syncToSupabase` siempre recorre las 11 tablas sin importar qué cambió.

**Opciones de mitigación:**
1. **(Recomendado, menor esfuerzo)** Cambiar `saveDatabase`/`syncToSupabase` para sincronizar **solo las tablas que realmente cambiaron** (pasar la lista de tablas afectadas desde cada pantalla), y envolver cada `syncTable` en su propio `try/catch` para que un error en una tabla no aborte el resto.
2. Reemplazar el patrón "upsert + delete de todo lo que no está" por operaciones puntuales (`insert`/`update`/`delete` por fila) generadas a partir de un diff, evitando que el cliente necesite permiso de `DELETE` sobre toda la tabla.
3. Mejorar el mensaje de error para indicar **qué tabla** falló y si fue por permisos (`42501`) vs. error de red, para diagnosticar más rápido.

**Solución aplicada** (`js/data.js`, función `syncToSupabase`): cada tabla del `TABLE_MAP` se sincroniza ahora dentro de su propio `try/catch`. Si una tabla falla (p. ej. por RLS, código `42501`), se registra el error y se **continúa con el resto de las tablas** — ya no se aborta el `for...of` completo. Al final, si hubo fallas, se lanza un único error que las resume (`No se pudo sincronizar: <tabla> (<code>): <motivo> | ...`), que `saveDatabase` adjunta al evento `db_sync_error`. El listener en `js/app.js` ahora muestra ese detalle en el toast en vez del mensaje genérico, indicando qué tabla(s) fallaron y por qué.

Se optó por la opción 1 del informe original (try/catch por tabla + mensaje específico) por ser la de menor riesgo/esfuerzo; la opción 2 (diff por fila en vez de upsert+delete de colección completa) queda como mejora futura si se requiere granularidad adicional.

### 5.2 Validación de `user_metadata` en alta de proveedor (`app.js`) — ✅ Corregido
**Solución aplicada:** en `checkSession()`, antes de insertar la fila inicial en `providers` a partir de `user_metadata`, se valida `rut` con `validateRut()` (si no es válido, se cierra la sesión y se informa al usuario que contacte a EBEMA) y se acotan longitudes: `razonSocial` ≤120, `telefono` ≤30, `representante` ≤80. Los mismos límites (`maxlength`) se agregaron a los campos del formulario de registro (`reg-razonsocial`, `reg-telefono`, `reg-representante`) como defensa adicional en el cliente.

### 5.3 `quotes_history` sin scoping por centro/usuario — ✅ Corregido
**Solución aplicada** (migración `restructure_quotes_history_centro_scope`):
- Se agregaron las columnas `id_centro` y `creado_por` a `quotes_history`.
- Se hizo backfill de `id_centro` en las filas existentes a partir de `routes."origenId"` (vía `routeId`).
- Se reemplazó la política `quotes_history_all`: OWNER y TRANSPORTISTA mantienen el alcance previo (sin restricción / sin acceso para CHOFER, sin cambios); ADMINISTRADOR_DEPOSITO y AGENTE_COMERCIAL quedan acotados a `id_centro = app_centro()`, igual que en `routes`/`logistics_centres`.
- Se actualizó la semilla local (`defaultData.quotesHistory` en `js/data.js`) con `routeId`/`id_centro`/`creado_por` para que el sync no sobrescriba el backfill con `NULL`.

**Nota:** las pantallas actuales (cotizador) aún guardan el historial reciente solo en `localStorage` por perfil y no escriben en la tabla `quotes_history`; si en el futuro se conecta esa función a la tabla, debe completar `id_centro` (centro del usuario que cotiza) y `creado_por` (su email) al insertar, de lo contrario la política RLS rechazará el `insert` para roles de centro.

### 5.4 Protección de contraseñas filtradas (HaveIBeenPwned) — 📋 Pendiente, acción manual
Advisory `auth_leaked_password_protection`: es una opción del **Dashboard de Supabase** (Authentication → Policies/Providers → Password Security), no se puede activar por SQL ni por las herramientas de gestión disponibles (no hay endpoint MCP para configuración de Auth). Recomendado activarla — afecta tanto a staff @ebema.cl como a proveedores externos que se registran con contraseña.

**Pasos para Jordan (manual, ~1 minuto):**
1. Ir a https://supabase.com/dashboard/project/humhokvdowfqicjopbhf/auth/providers
2. En la sección "Email", o en Authentication → Policies → Password Security (según versión del Dashboard), activar la opción **"Leaked password protection"** (verificación contra HaveIBeenPwned).
3. Guardar. No requiere reiniciar el proyecto ni afecta sesiones activas.

---

## 6. Cambios desplegados hoy

1. `js/logistics.js`, `js/ficha-transporte.js` — fix `cd.idCentroSap` → `cd.id` (commit `f18fb6b`, ya en producción).
2. `js/utils.js` — nueva función `escapeHtml()`.
3. `js/provider-portal.js`, `js/transports.js`, `js/ficha-transporte.js`, `js/roles.js` — uso de `escapeHtml()` en todos los campos dinámicos (proveedores, transportes, camiones, choferes, CSV).
4. `js/app.js` — validación de `rut` (mod-11) y límites de longitud (`razonSocial` ≤120, `telefono` ≤30, `representante` ≤80) antes de crear la fila de `providers` desde `user_metadata`; mismos límites como `maxlength` en el formulario de registro.
5. `js/data.js` — `syncToSupabase` ahora aísla errores por tabla (try/catch) y reporta qué tabla(s) fallaron y por qué; semilla local de `quotesHistory` actualizada con `routeId`/`id_centro`/`creado_por`.
6. `js/app.js` — el listener de `db_sync_error` muestra el detalle de la tabla/causa que falló.
7. Base de datos (Supabase, proyecto `humhokvdowfqicjopbhf`) — migraciones aplicadas:
   - `harden_app_users_role_assignment`
   - `lock_provider_self_edit_fields`
   - `lock_transport_admin_fields_for_owners_self_edit`
   - `revoke_public_exec_security_definer_funcs`
   - `restructure_quotes_history_centro_scope` (columnas `id_centro`/`creado_por` + política `quotes_history_all` acotada por centro)

**Pendiente:** solo el punto 5.4 (Leaked Password Protection), que requiere acción manual de Jordan en el Dashboard de Supabase.
