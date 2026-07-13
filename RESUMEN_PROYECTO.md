# SIT EBEMA — Resumen completo para continuación de proyecto

**Fecha:** 13 julio 2026  
**Desarrollado por:** Jordan Candia (jcandia@ebema.cl)  
**Repo GitHub:** https://github.com/jordancandia/ebema-transporte  
**PRD (GitHub Pages):** https://jordancandia.github.io/ebema-transporte/  
**Supabase PRD proyecto ID:** `humhokvdowfqicjopbhf`  
**Supabase URL:** `https://humhokvdowfqicjopbhf.supabase.co`

---

## 1. ¿Qué es el proyecto?

**SIT EBEMA** (Sistema Integrado de Transporte) es una aplicación web interna de Ebema para gestión logística y cotización de fletes. Permite:

- Cotizar tarifas de transporte por ruta, camión y centro logístico
- Administrar proveedores de transporte y sus fleets (camiones, choferes)
- Ver historial de cotizaciones y rutas
- Calcular motor de costos detallado (combustible, peajes, seguro, mantención, GPS, etc.)
- Gestionar tarifas de clientes (ZFMI, cotizaciones especiales)
- Ver densidad logística, clústeres de comunas, peajes regionales e interregionales
- Administrar concesionarias de peajes (TollGuru)
- Panel ZCAP (zonas de capacidad)

---

## 2. Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | HTML + JS ES Modules (sin framework) |
| CSS | Tailwind CDN con config corporativa Ebema (rojo #b5000b) |
| Mapas | Leaflet.js 1.9.4 |
| Backend/DB | Supabase (PostgreSQL + Auth + Edge Functions + RLS) |
| Hosting | GitHub Pages (rama `main`) |
| Email transaccional | Resend API |
| Peajes | TollGuru API (solo server-side en Edge Functions) |

---

## 3. Estructura de archivos

```
WEB TRANSPORTE/
├── index.html                        ← Entry point. Version actual: v=20260713c
├── css/style.css                     ← Estilos custom + overrides Leaflet
├── js/
│   ├── app.js                        ← Orquestador principal. Auth, sidebar, routing
│   ├── supabase-client.js            ← Cliente Supabase exportado como `supabase`
│   ├── data.js                       ← Capa de datos: Supabase ↔ localStorage
│   ├── tarifas-transporte.js         ← Motor de costos, peajes, concesiones, densidad logística
│   ├── tarifas-clientes.js           ← ZFMI, cotizaciones clientes
│   ├── tarifas-engine.js             ← Cálculo numérico de tarifas (helper puro)
│   ├── rates.js                      ← Vista cotizador
│   ├── transports.js                 ← Vista proveedores de transporte
│   ├── routes.js                     ← Vista rutas de transporte
│   ├── roles.js                      ← Vista roles y perfiles de usuario
│   ├── logistics.js                  ← Centros logísticos
│   ├── zcap.js                       ← Vista ZCAP
│   ├── provider-portal.js            ← Portal transportistas externos
│   ├── ficha-transporte.js           ← Ficha detalle proveedor
│   ├── utils.js                      ← showAlert, formatRut, validateRut, formatPhone
│   ├── chile-coords.js               ← Coordenadas comunas Chile
│   ├── chile-geo.js                  ← GeoJSON Chile
│   ├── troncales.js                  ← Rutas troncales
│   └── zonas-transporte.js           ← Zonas geográficas
└── supabase/functions/
    ├── invite-user/index.ts          ← Invitar funcionarios @ebema.cl (OWNER/ADMIN)
    ├── send-mfa-code/index.ts        ← Generar y enviar OTP 6 dígitos por correo
    └── verify-mfa-code/index.ts      ← Verificar OTP y marcar challenge usado
```

---

## 4. Supabase — Tablas principales

| Tabla | Descripción |
|---|---|
| `app_users` | Usuarios internos @ebema.cl (email, name, role, activo, centroId) |
| `providers` | Transportistas externos (email, rut, empresa, activo) |
| `logistics_centres` | Centros logísticos (id, nombre, región) |
| `transport_zones` | Zonas de transporte |
| `routes` | Rutas origen-destino con KM, peajes, clasificación |
| `truck_types` | Tipos de camión por centro (baseRate, ratePerKm) |
| `transports` | Proveedores de transporte |
| `transports_camiones` | Flota de camiones por proveedor |
| `transports_choferes` | Choferes por proveedor |
| `quotes_history` | Historial de cotizaciones generadas |
| `tariff_config` | Configuración motor de costos por centro |
| `client_tariff_config` | Configuración tarifas de clientes |
| `route_tolls` | Peajes por ruta |
| `extra_costs` | Costos extra por ruta/tipo/comuna |
| `mfa_challenges` | Códigos OTP temporales (expires_at, used) |

**RLS:** Todas las tablas tienen Row Level Security habilitado. Las políticas usan las funciones helper:
- `app_role()` → retorna el rol del usuario autenticado (OWNER, ADMIN, ADMINISTRADOR_DEPOSITO, AGENTE_COMERCIAL, driver_approved, driver_pending) o NULL si no tiene perfil
- `app_centro()` → centro logístico asignado al usuario
- `app_transportista()` → email del proveedor

---

## 5. Roles y modelo de seguridad

### Roles internos (@ebema.cl)
| Rol | Permisos |
|---|---|
| OWNER | Todo. Puede invitar OWNER y ADMIN |
| ADMIN | Todo excepto crear OWNER |
| ADMINISTRADOR_DEPOSITO | Solo su centro logístico |
| AGENTE_COMERCIAL | Solo su centro logístico |

### Roles externos (transportistas)
| Rol | Permisos |
|---|---|
| driver_approved | Acceso al portal de proveedor |
| driver_pending | Acceso restringido (pendiente aprobación) |

### Flujo de acceso funcionarios (tab "Funcionario" en login)
1. `signInWithPassword` con credenciales Supabase
2. Si login OK → Edge Function `send-mfa-code` → envía OTP al correo corporativo
3. Usuario ingresa código de 6 dígitos → Edge Function `verify-mfa-code`
4. Si OTP correcto → `checkSession()` + `renderApp()`

### Flujo de invitación
- OWNER/ADMIN llama Edge Function `invite-user` con `{ email, name, role, centroId }`
- Solo acepta emails @ebema.cl
- Supabase envía email de invitación con link que lleva a PRD con hash `type=invite`
- Al hacer clic, app detecta el hash, llama `renderSetPasswordView()` para definir contraseña
- Usuario define contraseña → queda activo

### Flujo transportistas externos (tab "Transportista")
- Registro propio con email/RUT → rol `driver_pending` por defecto
- ADMIN/OWNER debe aprobar manualmente cambiando a `driver_approved`

---

## 6. Edge Functions desplegadas en PRD

### `invite-user`
- **URL:** `https://humhokvdowfqicjopbhf.supabase.co/functions/v1/invite-user`
- `verify_jwt: false` (implementa su propia verificación)
- Valida que caller sea OWNER o ADMIN consultando `app_users`
- Solo permite emails @ebema.cl
- Llama `supabase.auth.admin.inviteUserByEmail()` con `redirectTo: SITE_URL`
- Pre-crea fila en `app_users`

### `send-mfa-code`
- Rate limit: 1 código por minuto
- Genera OTP criptográfico de 6 dígitos con `crypto.getRandomValues`
- Guarda en `mfa_challenges` con `expires_at = now + 10 min`
- Envía por Resend API desde `noreply@ebema.cl`
- **Requiere secreto `RESEND_API_KEY`** (ya configurado en PRD)

### `verify-mfa-code`
- Máximo 5 intentos en ventana de 15 min
- Busca challenge válido (used=false, no expirado)
- Si código correcto → `used=true`, retorna `{ ok: true, verified: true }`
- Si incorrecto → marca `used=true` (consume el intento)

### Secretos configurados en PRD
| Secreto | Valor |
|---|---|
| `RESEND_API_KEY` | `re_dVSFY8Th_MtdM4WnRpTuHcqVhaNrZ9oe4` |
| `SITE_URL` | `https://jordancandia.github.io/ebema-transporte/` |

---

## 7. Versioning (cache busting)

Los imports usan query string `?v=YYYYMMDD[letra]`. Al modificar cualquier archivo JS hay que:
1. Bumpar la versión del archivo en su import dentro de `app.js`
2. Bumpar `app.js?v=...` en `index.html`

**Versión actual:**
- `index.html` carga: `app.js?v=20260713c`
- `app.js` importa: `tarifas-transporte.js?v=20260713a`, `tarifas-clientes.js?v=20260713a`, `data.js?v=20260712k`, `routes.js?v=20260708a`

---

## 8. Regla crítica: CIFS null bytes

**NUNCA usar `sed -i` ni `python open(...,'w')` directamente sobre el mount CIFS.**  
El mount está en `/sessions/.../mnt/WEB TRANSPORTE/` y escribe null bytes con esas herramientas.

**Procedimiento correcto para editar archivos:**
```bash
# 1. Copiar al /tmp
cp "/sessions/.../mnt/WEB TRANSPORTE/js/archivo.js" /tmp/archivo.js

# 2. Editar en /tmp (con python, sed, etc.)
python3 -c "
data = open('/tmp/archivo.js','r').read()
data = data.replace('viejo', 'nuevo')
open('/tmp/archivo.js','w').write(data)
"

# 3. Verificar sin null bytes
python3 -c "print(open('/tmp/archivo.js','rb').read().count(b'\x00'))"

# 4. Copiar de vuelta
cp /tmp/archivo.js "/sessions/.../mnt/WEB TRANSPORTE/js/archivo.js"
```

---

## 9. Git — problema conocido con index.lock

El sandbox no puede hacer `git push` por restricciones de red (HTTP 403) ni eliminar `.git/index.lock` (CIFS). Después de cualquier cambio, el usuario debe ejecutar manualmente:

```cmd
cd "C:\Users\Jordan\Desktop\ANTIGRAVITY\WEB TRANSPORTE"
del .git\index.lock
git add <archivos modificados>
git commit -m "mensaje"
git push origin main
```

GitHub Pages tarda ~60–120 segundos en reflejar los cambios. El TTL del CDN es ~600s — si la caché no se limpia, bumpar la versión fuerza la recarga.

---

## 10. Motor de costos — lógica central (tarifas-transporte.js)

La función `mergeStgoSbMatriz()` fusiona rutas de Santiago y San Bernardo promediando sus campos numéricos (km, peajes, combustible, etc.). **Esto es intencional** — no separar STGO de SB.

```javascript
const AVG_FIELDS = ['km','item1_peajes','combIda','combVuelta',
  'item3_soapKm','item4_seguroKm','item5_mantKm','item6_neumKm',
  'item7_gpsKm','item8_choferBaseDiario','item9_varChofer',
  'costoVuelta','item10_costoRutaTotal','item11_costoKmFinal','factorRuta'];
```

La tabla `tariff_config` almacena todos los factores del motor de costos por centro logístico. El modelo "Centro Origen" significa que cada cálculo parte desde el centro logístico asignado al usuario.

---

## 11. Estado actual del proyecto (13/07/2026)

### Funcional en PRD
- Login funcionarios con MFA OTP correo
- Login/registro transportistas externos
- Detección de invitación por hash URL (`type=invite` / `type=recovery`)
- Pantalla definir contraseña para usuarios invitados
- Cotizador de tarifas
- Motor de costos regional e interregional (paginado 50 filas)
- Tarifas por camión y por cliente (ZFMI)
- Peajes Regionales, Interregionales y Concesiones (TollGuru)
- Administrador de concesionarias
- Densidad logística con heat map por comunas
- Vista ZCAP
- Costos extras
- RLS completo en todas las tablas
- Edge Functions `invite-user`, `send-mfa-code`, `verify-mfa-code` desplegadas

### Pendiente / Por hacer
- **Verificación de dominio Resend:** agregar y verificar `ebema.cl` en https://resend.com/domains (requiere agregar registros DNS TXT/MX). Mientras tanto, los correos de MFA pueden fallar si el dominio no está verificado. Alternativa temporal: cambiar `from: "noreply@ebema.cl"` a `from: "onboarding@resend.dev"` en `send-mfa-code/index.ts`
- **Invitar primer usuario OWNER/ADMIN:** actualmente hay que hacerlo directamente en Supabase Dashboard → Authentication → Users → Invite user, o via SQL insertando en `app_users`
- **Portal transportistas:** `provider-portal.js` existe pero el flujo de aprobación `driver_pending → driver_approved` es manual desde Supabase dashboard
- **TOTP nativo de Supabase:** la MFA actual es custom (OTP correo). Si se desea migrar a app autenticadora (TOTP), Supabase Auth tiene soporte nativo (`supabase.auth.mfa.*`)

---

## 12. TollGuru API

- **API Key:** `tg_7B6BA696308748FE9AEF66BEB9A8D924`
- **Regla de seguridad CRÍTICA:** solo se usa server-side en Edge Functions. NUNCA en código cliente ni en GitHub. Está almacenada como variable de entorno `TOLLGURU_KEY` en Supabase.
- La función `getapi-tolls` (Edge Function) consume TollGuru y retorna los peajes calculados.

---

## 13. Coordenadas de entornos

| Entorno | URL | Supabase proyecto |
|---|---|---|
| PRD | https://jordancandia.github.io/ebema-transporte/ | `humhokvdowfqicjopbhf` |

No existe un entorno QA activo actualmente (fue eliminado). Todo desarrollo va directo a PRD con bump de versión.

---

## 14. Cómo retomar trabajo

1. Abrir carpeta `C:\Users\Jordan\Desktop\ANTIGRAVITY\WEB TRANSPORTE` en Cowork
2. Editar archivos siguiendo la regla CIFS (escribir en /tmp primero)
3. Bumpar versión en `app.js` y en `index.html`
4. Ejecutar git add/commit/push manualmente en terminal Windows (eliminar index.lock primero si existe)
5. Esperar ~2 minutos y verificar en https://jordancandia.github.io/ebema-transporte/
6. Si hay error, abrir DevTools → Console para ver el SyntaxError con línea exacta
