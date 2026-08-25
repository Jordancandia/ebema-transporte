# HANDOFF — Proyecto SIT EBEMA / Gestión Troncales (estado a 2026-08-17)

Documento de traspaso para continuar en otro chat. Contiene stack, arquitectura,
reglas de negocio, cambios aplicados y pendientes.

---

## 1. CONTEXTO Y STACK

Plataforma web **SIT EBEMA** (Sistema Integrado de Transporte) para gestión
logística. El módulo **Gestión Troncales** gestiona el abastecimiento de
sucursales desde centros de distribución (CD Quilicura/RM 1003 y CD Biobío 1081).

- **Frontend:** Vanilla JS (ES Modules) + Tailwind (CDN) + Material Symbols. SPA.
- **Backend:** Supabase (PostgreSQL + RLS + REST + Auth + Edge Functions).
  - **project_id / ref:** `humhokvdowfqicjopbhf`
  - URL: `https://humhokvdowfqicjopbhf.supabase.co`
- **Automatización:** Google Apps Script lee Gmail 3x/día, parsea adjuntos SAP y
  carga a Supabase.
  - Apps Script: `https://script.google.com/home/projects/1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx/edit`
- **Repo:** `github.com/Jordancandia/ebema-transporte` (se renombró de jordancandia).
- **Hosting actual:** GitHub Pages desde `main` (`https://jordancandia.github.io/ebema-transporte/`) con `.nojekyll`.
- **Deploy:** ejecutar `DESPLEGAR_ABASTECIMIENTO.bat` (limpia locks .git, add, commit, pull --rebase, push a main). GitHub Pages tarda 1-5 min en publicar.
- **Cache-busting:** subir `?v=YYYYMMDDx` en `js/app.js` (import de abastecimiento.js y roles.js) e `index.html` (import de app.js). **Versión actual: `20260817f`.**

Carpeta local: `C:\Users\Jordan\Desktop\ANTIGRAVITY\WEB TRANSPORTE`.

Archivos clave:
- `js/app.js` — router, sidebar, auth (login/registro/sesión).
- `js/abastecimiento.js` (~1500 líneas) — TODO Gestión Troncales: vistas de datos, Plan de Carga, Calendario, Proveedores.
- `js/roles.js` — admin de perfiles (Roles y Perfiles).
- `js/data.js` — DB local + carga desde Supabase (rutas, logistics_centres, users).
- `js/supabase-client.js`, `js/utils.js` (showAlert, escapeHtml).
- `css/style.css` — estilos custom (incluye clase `.num-clear`).
- `automatizacion_troncales/Code.gs` — Apps Script.
- `supabase/functions/invite-user/index.ts` — Edge Function de invitación.

---

## 2. MODELO DE DATOS SUPABASE

### Tablas SAP (troncales)
- **`trc_live`**: datos SAP vigentes. Columnas: `fuente, fila, data (JSONB), corrida, cargado_en`. **NO tiene columna id.** Se pisa por fuente (DELETE+INSERT).
- **`trc_hist`**: snapshot diario (PK fuente+fecha+fila). Retención 7 días (`fn_trc_prune_hist()`).
- **`trc_log`**: bitácora de cada corrida.

### Vistas SQL (todas `security_invoker = on`, GRANT SELECT a authenticated)
Extraen campos del JSONB con `data ->> 'campo'`:
- `v_trc_slim_stock` (Quiebres/SLIM)
- `v_trc_sqvi_retiros_fabrica` (Retiros Fábrica, Step 1)
- `v_trc_sqvi_pedidos_venta_1003` (Ventas 1003, Step 2) — **incluye `cantidad_entrg`** (agregado en refactor)
- `v_trc_sqvi_stock_almacen_4000` (Step 3)
- `v_trc_sqvi_pedidos_traslados` (Step 4 + REVEX filtrando material 900000)
- `v_trc_sqvi_pedidos_traslados_4000` (Step 5)
- `v_trc_sqvi_plan_troncales` (Step 6)

### Formato numérico SAP
Puntos = miles, coma = decimal (ej. `1.234,56`). Parseo en JS:
`parseNum(v) = parseFloat(String(v).replace(/\./g,'').replace(',','.'))`.

### Tablas de negocio
- `abast_proveedores`, `abast_proveedor_direcciones` (Proveedores + direcciones fábrica).
- `abast_calendario` (calendario de despacho por centro/día/bloque; centro_destino_1/2).
- `abast_retiro_estado` (doc_compr PK, estado, updated_by/at) — estado de coordinación editable de cada OC de retiro. RLS: authenticated con `app_role() IS NOT NULL`.
- `logistics_centres` (id, nombre): 1000 CD Quilicura, 1003 CD RM, 1005 CD San Bernardo, 1020 CD Antofagasta, 1040 CD Coquimbo, 1050 CD La Calera, 1060 CD Rancagua, 1070 CD Talca, 1080 CD Concepción, 1081 CD BIOBIO, 1090 CD Temuco, 1100 CD Puerto Montt, 1160 CD Chillan.
- `routes` (código, comuna, región) — maestro de rutas.
- `app_users` (ver sección Auth).

### Funciones/RPC
- `fn_trc_prune_hist()` — poda histórico 7 días.
- `fn_trc_snapshot_hoy()` — copia trc_live→trc_hist para hoy (hora Chile). SECURITY DEFINER, EXECUTE solo service_role. La usa el Apps Script en la corrida de la tarde.
- `app_role()`, `app_centro()` — resuelven permisos (ver Auth).
- `handle_new_auth_user()` — trigger de alta (ver Auth).

---

## 3. AUTOMATIZACIÓN APPS SCRIPT (Code.gs)

Lee Gmail 3x/día (hora Chile) y carga a Supabase por REST con `SUPABASE_SERVICE_KEY` (propiedad de script).

- **Etiquetas Gmail:** `Plan Troncales (SLIM)` (Excel .xlsx → slim_stock) y `SQVI Troncales` (Label_6779002822901894216; adjuntos .htm → 6 steps). Remitente SQVI: `ZE_SIS@ebema.cl`, asuntos "Job ZJC PLAN TRONCALES, Step 1..6".
- **Horarios de envío de SAP (confirmado por Gmail):** los correos llegan **07:31, 11:31 y 13:31** hora Chile.
- **Triggers:** `ejecutar_0735` (07:35), `ejecutar_1135` (11:35), `ejecutar_tarde` (tarde). El minuto de la tarde está en la variable **`MIN_TARDE`** (Apps Script tiene jitter ±15 min).
  - **IMPORTANTE:** `MIN_TARDE = 50` (13:50). Se subió a 50 porque SAP envía a las 13:31 y la corrida disparaba a las 13:31, perdiendo los correos por segundos. Con 50 la ventana queda 13:35–14:05 (después del correo). **Falta que el usuario pegue el Code.gs y ejecute `crearTriggers()` para aplicar el nuevo horario.**
- **Flujo:** procesa correos NO leídos, pisa trc_live por fuente, marca leídos. La corrida de la tarde (snapshot=true) llama a `fn_trc_snapshot_hoy()` (guarda histórico desde trc_live vigente, **no depende de correos nuevos**) y a `fn_trc_prune_hist()`.
- Entrypoints de prueba manual: `probar_ahora()` (sin snapshot), `probar_ahora_snapshot()`.
- **FIX Drive:** conversión xlsx→Sheet con `Drive.Files.insert({mimeType:'application/vnd.google-apps.spreadsheet'}, blob.setContentType(...xlsx))` + poll hasta que termine.

---

## 4. GESTIÓN TRONCALES — MENÚ Y REGLAS DE VISTAS (abastecimiento.js)

Orden del menú (sidebar, bajo "Gestión Troncales"): Proveedores, Calendario Sucursales, **Quiebres Sucursales, Stock Almacén 4000, Retiros de Fábrica, Pedidos de Venta CD (1003)**, Pedidos Traslados, Pedidos de Traslado REVEX, Pedidos de Traslados 4000, Plan de Carga. (Se eliminó "Plan Troncales", unificado en Stock 4000.)

Títulos de todas las vistas: **"GESTIÓN TRONCALES – X"**.

Helpers clave: `maxPesoDim(a,b)=max(parseNum a, parseNum b)`, `calcTon(pesoMax, cant)=pesoMax*cant/1000`, `parseNum`, `lookupRuta`, `getNombreCentro`, `alertaFecha` (ATRASADO / PRONTO A VENCER), `normTxt` (quita acentos/ñ con `\u0300-\u036f`).

**Render genérico `renderVistaTabla`** soporta hooks: `preload`, `badges`, `postFilter`, `expand` (drill-down con `idKey`/`numCols`), `editable` (select persistente), `modes` (toggle dataset), `searchLabel`, `dateRange` (filtro rango de fecha con `<input type=date>` que parsea DD.MM.YYYY), columnas con `valueFn`/`badge`/`expandable`/`editable`. **Caché en memoria de 2 min + paginación paralela** (`fetchAllRows` con `_rawCache`; botón Refrescar hace `clearRawCache()`).

### Quiebres Sucursales
- Vista `v_trc_slim_stock`. Solo SKU con stockday ≤ 7 (vacío = 0). Orden: centro → clase ABC (AA..CC) → stockday asc.
- Clasificación por días: 0-3 **MATERIAL QUEBRADO URGENTE**, 3-5 **STOCK CRÍTICO URGENTE**, 6-7 **STOCK EN REVISIÓN**. Filtro por tipo de quiebre. Badges contadores sensibles al filtro de centro. Buscador general renombrado "Buscar Orden de Compra".

### Retiros de Fábrica (agrupado por OC / doc_compr)
- Columnas: Tipo de Retiro, Contrato, OC (clickeable→drill-down), Proveedor, Centro Destino, Almacén, **Fecha de Retiro**, Ton Totales (**4 decimales**), Pedido Ventas, Vigencia OC, Alerta, Coordinación (editable, persistente en `abast_retiro_estado`).
- Drill-down OC: Orden de Compra, Centro Destino, ID Material, Nombre Material, **Cantidad Pedido**, Cantidad Pendiente, Ton SKU (4 dec).
- Ton = `maxPesoDim(peso_bruto, tamaño) × (ctd_pedido − ctd_entregada) / 1000`.
- **Tipo de retiro:** alm 4000 = **FÁBRICA-CD** (Consolidar CD); alm 2000 = **FÁBRICA-SUCURSAL** (Fábrica Directo); si OC ≥80% cap camión Y tiene pedido de venta (`documento`) = **FÁBRICA-CLIENTE**.
- Filtro **rango de fecha de entrega**. Filtro Centro (chip) + Tipo Retiro + Coordinación + Alerta. Badge OC pendientes por centro. Números con clase `.num-clear` (JetBrains Mono confundía 0 con 8).

### Pedidos de Venta CD (1003) (agrupado por pedido)
- Columna 1 = **Tipo de Entrega**: **CD-CLIENTE** si ≥80% cap camión (directo al cliente); **CD-SUCURSAL** si <80% (consolida con carga).
- Filtros: MR solo vacías; dedup doc_ventas+material por fecha más lejana; excluir líneas entregada≥confirmada; solo con ruta.
- Ton = `maxPesoDim(peso_neto, tamaño) × (ctd_confirmada − cantidad_entrg) / 1000`.
- Estado "ENTREGA PARCIAL PENDIENTE". Drill-down por pedido. Sin buscador general; con buscador específico + **rango de fecha**.
- **Columna "Descarga en Camino"**: cruza la comuna del pedido (vía maestro de rutas) contra una lista de comunas intermedias por centro destino; alerta que puede dejarse en ruta aunque no complete carga. Mapa `COMUNAS_EN_CAMINO`: Antofagasta (Chañaral, Taltal, Caldera, Copiapó), Coquimbo (Los Vilos, Pichidangui, La Ligua), Rancagua (Buin, Paine, Mostazal, Graneros), Talca (Curicó, San Rafael), Chillán (San Carlos, San Gregorio, Linares, Parral), Temuco (Lautaro, Victoria, Collipulli), Puerto Montt (Río Bueno, Puerto Varas, Frutillar, Llanquihue, Osorno, Purranque, San Pablo), Concepción (Penco, Talcahuano, Hualpén).

### Pedidos Traslados (agrupado por PT)
- Columnas: Alerta, Centro Expedición, PT (clickeable), Centro Destino, Almacén, Fecha Confirmada, Pedido Ventas, Ton Totales. Drill-down: PT, Tipo Documento, Centro Origen, Centro Destino, Almacén, ID/Nombre Material, Ctd Pedido PT, Ctd Confirmado, Pedido Ventas, Ton Total SKU. Filtro Centro Origen (chip), sin buscador general, rango de fecha (fecha_confirmada). Ton = max(peso_neto, tamaño) × ctd_confirmada.

### Pedidos de Traslado REVEX (material 900000)
- Ton = **segunda columna de peso neto (`peso_neto_2`) × ctd_pedido** (4 dec). Sin peso mayor. Sin buscador general; rango de fecha.

### Stock Almacén 4000 (unifica Stock + Plan Troncales)
- Toggle de modos **STOCK** (v_trc_sqvi_plan_troncales) / **PEDIDO DE VENTAS** (v_trc_sqvi_stock_almacen_4000), cada uno con sus columnas.

### Pedidos de Traslados 4000 (agrupado por PT)
- Oculta subtotales (cesu vacío o con `*`) y líneas con ctd_pedido = cantidad_salida (ya entregadas).
- Columnas: Origen (STOCK/PEDIDO DE VENTAS según `documento`), PT (clickeable), Centro Origen, Centro Destino, Almacén, Fecha de Entrega (orden más atrasada→futura), Pedido Ventas, Ton Totales. Drill-down: PT, Centro Origen, Centro Destino, Almacén, Pedido Ventas, ID/Nombre Material, Ton SKU. Ton = `max(peso_neto, tamaño) × (ctd_pedido − cantidad_salida)` (4 dec). Filtro Centro Origen + rango de fecha.

---

## 5. PLAN DE CARGA (renderPlanCarga)

Dashboard de consolidación por sucursal para el día siguiente. **Selector de CENTRO ORIGEN 1003 / 1081** (como el calendario): filtra traslados/REVEX/crossdocking por `cesu = origen`; destinos según `CALENDARIOS[origen].destinos`. Ventas 1003 y retiros solo aplican al plan del CD 1003.

- **Capacidad camión:** 28 t por defecto; La Calera (1050) y San Bernardo (1005) usan **15 t si no alcanzan a llenar 28 t** (capacidad efectiva condicional). Umbrales cliente(80%)/fábrica(85%) contra 28 t de referencia.
- **Ventana de fechas:** Quiebre/Abastecimiento (traslados) −10/+5 sobre `fecha_confirmada`; Crossdocking −5/+5 sobre `fe_entrega`; Ventas −3/+5 sobre `fe_entrega`; Retiros −3/+2 sobre `fe_entrega`; REVEX sin filtro de fecha. **Los viernes** todas las ventanas hacia adelante se amplían +2 días (CD 1003 despacha sábado → cubre sábado + lunes).
- **Quiebres:** materiales con stockday ≤ 7 (del SLIM) definen si un traslado es Quiebre vs Abastecimiento.
- **Orden de prioridad de llenado del Camión CD (Total CD):** 1º REVEX → 2º Ventas 1003 consolidables (<80%) → 3º Retiros consolidar CD (alm 4000) → 4º Crossdocking → 5º Traslados Quiebre → 6º Traslados Abastecimiento.
- **Camiones adicionales (NO consolidan en CD):**
  - **Camión Cliente:** pedido de venta con ruta (≠ RETIRA) ≥80% cap.
  - **Camión Fábrica-Sucursal:** OC(s) del mismo proveedor (sin pedido de venta) que sumen ≥85% cap.
  - **Camión Fábrica-Cliente:** OC asociada a pedido de venta ≥85% cap.
- **Status:** ≥80% PROGRAMAR (verde), 70-80% REVISAR (amarillo), <70% CARGA INSUFICIENTE (gris). Observaciones: CUPO EXTRA / EN CALENDARIO - CARGA BAJA / SOBRECARGA X t.
- **Orden de filas:** prioridad del día (centros en `abast_calendario` de mañana, filtrados por origen) primero, luego % desc.
- **Columna Status** ubicada a la derecha de Camión CD.
- **Drill-down por camión:** al pinchar cada camión se despliega su detalle por SKU con columnas específicas (traslados: PT, ID Material, Nombre, Fecha, Ctd Confirmada, Ton, Pedido Venta; retiros: OC, Id Proveedor, Proveedor, ID/Nombre Material, Fecha, Cantidad, Ton, Pedido Venta; ventas: Pedido, ID/Nombre Material, Cantidad, Ruta, Comuna, Región, Fecha, Ton). Ton en 4 decimales.
- **Cuadre a capacidad (Camión CD):** en el detalle CD se llena por prioridad hasta la capacidad y cada ítem se marca **✓ SÍ** (va en el camión) / **✗ EXCEDE** (queda para el próximo), con banner Capacidad / Cargado / Excede.
- **Botón "Descargar detalle"** (CSV) en cada drill-down de camión.

Calendario Sucursales: rediseño moderno, mensaje de guardado, **sin sábado/sobre-cupos**. CALENDARIOS: 1003 (CD Quilicura, bloques 07:30-11:30 / 11:00-15:00 / 15:30-19:30, Lun-Vie) y 1081 (CD Concepción, 08:00-11:00 / 11:00-15:00, Lun-Vie).

---

## 6. AUTENTICACIÓN Y ROLES (refactor 2026-08-17)

**5 perfiles canónicos:** OWNER, ADMINISTRADOR_DEPOSITO, AGENTE_COMERCIAL, TRANSPORTISTA, CHOFER. CENTRO_ROLES (ADMIN_DEPOSITO, AGENTE_COMERCIAL) exigen `centroId`; TRANSPORTE_ROLES (TRANSPORTISTA, CHOFER) exigen `transportistaId`.

- **`app_users`**: PK natural `email`; **`user_id uuid` UNIQUE FK a auth.users(id) ON DELETE CASCADE** (nullable, para pre-asignación por invitación). Columnas: email, name, role, activo, lastAccess, centroId, transportistaId, user_id.
- **Trigger `on_auth_user_created` AFTER INSERT ON auth.users** → `handle_new_auth_user()`: si existe fila por email sin user_id la vincula (invitación); si no y es @ebema.cl inserta con rol `AGENTE_COMERCIAL`. Proveedores externos NO obtienen fila (usan tabla `providers`). SECURITY DEFINER, search_path=public, EXECUTE revocado a anon/authenticated.
- **`app_role()` / `app_centro()`**: filtran por `(user_id = auth.uid() OR lower(email)=lower(auth.jwt()->>'email'))` con search_path=public (fallback a email para no bloquear). RLS de app_users reconoce user_id=auth.uid().
- **Edge Function `invite-user`** (verify_jwt on): valida que el invitador sea OWNER/ADMIN_DEPOSITO, pre-asigna rol/centro en app_users (upsert por email) y llama `auth.admin.inviteUserByEmail`. El front la invoca con `supabase.functions.invoke('invite-user', {body})`.
- **Frontend:** `checkSession` bloquea si el correo no está confirmado (`email_confirmed_at`) o `activo=false`; ya no inserta app_users (lo hace el trigger). Registro: correos **@ebema.cl** → self-registro funcionario (email+password+confirmación, rol lo pone el trigger); externos → flujo proveedor. `renderSetPasswordView` maneja el enlace de invitación/recovery (`#type=invite|recovery` → updateUser({password})). En `roles.js`, "Agregar Usuario" invita vía Edge Function.

### CONFIG PENDIENTE EN EL DASHBOARD DE SUPABASE (crítico)
1. **Auth → Providers → Email → Confirm email:** ACTIVAR.
2. **Auth → SMTP:** configurar SMTP propio. **YA CONFIGURADO con Gmail** (`smtp.gmail.com:587`, usuario `jcandia@ebema.cl`, contraseña de aplicación de 16 dígitos). Estado: funcionando tras corregir la clave (antes daba error 535 BadCredentials).
3. **Auth → URL Configuration:** Site URL + Redirect URLs con la URL del sitio (GitHub Pages y/o el dominio nuevo).
4. (Opcional) Leaked password protection (puede requerir plan Pro).

### Usuarios app_users actuales
jcandia@ (OWNER, vinculado), fandrade@ (OWNER, vinculado), racevedo@/macevedo@/cburgos@ (AGENTE_COMERCIAL, vinculados), nramirez@ (AGENTE_COMERCIAL, sin vincular), admin@ (OWNER, inactivo, sin auth), logistica@ (**rol legado 'operador' → app_role() devuelve NULL = sin permisos**; cambiar a rol canónico si debe entrar).

---

## 7. DESPLIEGUE

- **Actual:** `DESPLEGAR_ABASTECIMIENTO.bat` (commit + push a main) → GitHub Pages. El .bat commitea siempre con mensaje fijo "calendario prioritario…" pero sube todos los cambios. Ojo: locks de git residuales (los limpia el .bat) y retraso de GitHub Pages (1-5 min; a veces hay que forzar rebuild con un commit nuevo). Verificar con hard-refresh (Ctrl+F5) o incógnito.
- **Migración planeada a Vercel** con dominio `sit-ebema.ebema.cl` (ver `GUIA_VERCEL.md`): importar repo, framework Other sin build, agregar dominio, TI de EBEMA crea CNAME `sit-ebema → cname.vercel-dns.com`, y **actualizar Site URL/Redirect URLs en Supabase + origen en Google OAuth**.

---

## 8. PENDIENTES / TODOs

1. **Apps Script:** pegar Code.gs actualizado y ejecutar `crearTriggers()` para aplicar `MIN_TARDE=50` (corrida tarde a 13:50). Hoy quedaron sin leer los correos SQVI de las 13:31; correr `probar_ahora` para recuperarlos.
2. **Supabase Dashboard:** confirmar Confirm email activado y Site/Redirect URLs.
3. **logistica@ebema.cl:** cambiar rol legado 'operador' a uno canónico.
4. **Vercel:** ejecutar la guía si se quiere el dominio bonito.
5. Revisar criterio: en el Plan 1081 no se incluyen ventas ni retiros (por diseño); confirmar si debe cambiar.

---

## 9. PROMPT SUGERIDO PARA EL NUEVO CHAT

"Eres mi asistente experto en desarrollo web. Continúo la plataforma **SIT EBEMA** (Vanilla JS + Tailwind CDN + Supabase `humhokvdowfqicjopbhf` + Apps Script + GitHub Pages, migrando a Vercel). El módulo principal es `js/abastecimiento.js` (Gestión Troncales: vistas de datos SAP desde vistas `v_trc_*` sobre `trc_live` JSONB, Plan de Carga, Calendario, Proveedores). Reglas críticas: números SAP con punto=miles y coma=decimal; `maxPesoDim`=max(peso, tamaño); vistas Supabase `security_invoker=on` + GRANT authenticated; deploy con `DESPLEGAR_ABASTECIMIENTO.bat` + cache-busting `?v=` (actual 20260817f); hora Chile `America/Santiago`. Auth refactorizado a `app_users.user_id` con trigger `on_auth_user_created`, RLS por `auth.uid()`, confirmación de correo e invitación por Edge Function `invite-user`. Responde directo, estructurado, con viñetas y negritas."
