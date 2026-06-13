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
| 6 | XSS: datos de proveedores/camiones sin escapar en `innerHTML` | Alto (XSS) | ⚠️ Parcial — corregido en portal de proveedores, pendiente en otras vistas |
| 7 | Registro de proveedor sin validación de `rut`/longitudes (`user_metadata` libre) | Medio | 📋 Recomendación |
| 8 | Sync destructivo (`syncToSupabase`) falla silenciosamente para roles no-OWNER | **Crítico (funcional)** | 📋 Recomendación — requiere refactor |
| 9 | `quotes_history` sin columna de centro/usuario → no se puede acotar por RLS | Medio | 📋 Recomendación |
| 10 | Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada | Bajo | 📋 Acción manual en Dashboard |

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

**Pendiente:** el mismo patrón (interpolación sin escape de `razonSocial`, `rut`, `representante`, datos de camiones, etc.) existe muy probablemente en las vistas internas que listan proveedores y transportes (p. ej. `providers.js`, `transports.js`, `ficha-transporte.js`, vista CSV de carga masiva). Recomendamos aplicar `escapeHtml()` de forma sistemática a **todo** campo que provenga de `db.providers`, `db.transports` o de `user_metadata`, en una segunda pasada — es un cambio mecánico pero extenso (decenas de plantillas).

---

## 3. Estado final de RLS (resumen por tabla)

Las 11 tablas tienen RLS habilitado. Tras los cambios de hoy:

- **`app_users`**: OWNER y ADMIN_DEPOSITO (su centro) administran usuarios; un usuario puede ver/editar su propia fila pero no su `role`/`centroId`/`transportistaId` (trigger). ADMIN_DEPOSITO ya no puede otorgarse ni otorgar a otros un rol equivalente a OWNER.
- **`providers`**: el proveedor solo ve/edita su propia fila (campos no-administrativos); OWNER/ADMIN_DEPOSITO/AGENTE_COMERCIAL pueden listar; solo OWNER escribe libremente o cambia `estado`/identidad.
- **`transports`**: el transportista/proveedor solo ve/edita su propio camión (campos operativos); solo OWNER puede tocar `ownerEmail`, `codigoSap`, `activo`, `centrosServicio`.
- **`transports_camiones` / `transports_choferes`**: scoped por `id_transporte = app_transportista()`, OWNER/ADMIN_DEPOSITO/AGENTE_COMERCIAL ven todo.
- **`logistics_centres`, `routes`**: scoped por centro para ADMIN_DEPOSITO/AGENTE_COMERCIAL; TRANSPORTISTA/CHOFER tienen lectura general (necesaria para cotizar/operar); escritura solo OWNER o ADMIN_DEPOSITO de su centro.
- **`truck_types`, `tariff_config`, `client_tariff_config`**: lectura para roles internos, escritura solo OWNER.
- **`quotes_history`**: lectura/escritura para cualquier rol interno distinto de CHOFER — **sin acotar por centro/usuario** (ver sección 5.3).

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

## 5. Recomendaciones pendientes (no aplicadas — requieren decisión/refactor)

### 5.1 Crítico — `syncToSupabase` rompe el guardado para roles no-OWNER
`data.js → syncToSupabase()` hace, para **cada una** de las 11 tablas, un `upsert()` de todas las filas locales seguido de un `delete()` de todo lo que no esté en esa lista — es decir, un **sync de colección completa**. Con las políticas RLS actuales (que ya limitaban — y ahora limitan más — qué filas puede tocar cada rol), cualquier usuario que no sea OWNER:

- No puede `delete()` filas fuera de su alcance → Supabase devuelve éxito pero **0 filas afectadas** en el delete (no es necesariamente error), pero el `upsert()` de tablas fuera de su alcance (p. ej. `truck_types`, `tariff_config`) **sí falla con error de RLS**, y `syncToSupabase` usa `for...of` + `throw` en el primer error: **toda la sincronización se aborta**, incluida la tabla que el usuario sí quería guardar (si el orden de `TABLE_MAP` la coloca después de una tabla restringida).

**Síntoma para el usuario:** guarda datos en pantalla (se ven localmente porque `saveDatabase` escribe a `localStorage` de inmediato), pero aparece el toast genérico *"No se pudo sincronizar con el servidor. Cambios guardados solo localmente."* y, tras recargar o en otro dispositivo, los cambios **no están**.

**Esto afecta a TODOS los roles excepto OWNER** en cuanto intenten guardar cualquier cosa, porque `syncToSupabase` siempre recorre las 11 tablas sin importar qué cambió.

**Opciones de mitigación:**
1. **(Recomendado, menor esfuerzo)** Cambiar `saveDatabase`/`syncToSupabase` para sincronizar **solo las tablas que realmente cambiaron** (pasar la lista de tablas afectadas desde cada pantalla), y envolver cada `syncTable` en su propio `try/catch` para que un error en una tabla no aborte el resto.
2. Reemplazar el patrón "upsert + delete de todo lo que no está" por operaciones puntuales (`insert`/`update`/`delete` por fila) generadas a partir de un diff, evitando que el cliente necesite permiso de `DELETE` sobre toda la tabla.
3. Mejorar el mensaje de error para indicar **qué tabla** falló y si fue por permisos (`42501`) vs. error de red, para diagnosticar más rápido.

No se implementó porque toca el corazón de la capa de datos (usada por las 13 pantallas) y conviene probarlo con cada rol antes de desplegar.

### 5.2 Validación de `user_metadata` en alta de proveedor (`app.js`)
Al crear la fila en `providers`, no se valida `rut` (existe `validateRut()` en `utils.js` pero no se usa aquí) ni se acotan longitudes de `razonSocial`/`representante`/`telefono`. Recomendado:
```js
if (!validateRut(meta.rut || '')) { /* mostrar error / no crear fila o marcar para revisión */ }
const razonSocial = (meta.razonSocial || '').slice(0, 120);
```

### 5.3 `quotes_history` sin scoping por centro/usuario
La política actual permite a **cualquier** ADMIN_DEPOSITO/AGENTE_COMERCIAL leer y **eliminar** cotizaciones de **cualquier centro**, porque la tabla no tiene columna `id_centro` ni `creado_por`. Esto ya estaba identificado como tarea futura ("Restructurar quotes_history"). Recomendación: agregar esas columnas y luego acotar `quotes_history_all` igual que `routes`/`logistics_centres` (por `id_centro = app_centro()` para roles de centro, sin restricción para OWNER).

### 5.4 Protección de contraseñas filtradas (HaveIBeenPwned)
Advisory `auth_leaked_password_protection`: es una opción del **Dashboard de Supabase** (Authentication → Policies/Providers → Password Security), no se puede activar por SQL. Recomendado activarla — afecta tanto a staff @ebema.cl como a proveedores externos que se registran con contraseña.

---

## 6. Cambios desplegados hoy

1. `js/logistics.js`, `js/ficha-transporte.js` — fix `cd.idCentroSap` → `cd.id` (commit `f18fb6b`, ya en producción).
2. `js/utils.js` — nueva función `escapeHtml()`.
3. `js/provider-portal.js` — uso de `escapeHtml()` en todos los campos dinámicos.
4. Base de datos (Supabase, proyecto `humhokvdowfqicjopbhf`) — 4 migraciones aplicadas:
   - `harden_app_users_role_assignment`
   - `lock_provider_self_edit_fields`
   - `lock_transport_admin_fields_for_owners_self_edit`
   - `revoke_public_exec_security_definer_funcs`

(2) y (3) quedan pendientes de subir con `subir-cambios.bat`.
