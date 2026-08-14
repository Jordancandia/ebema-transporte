# RESUMEN COMPLETO — PROYECTO SIT EBEMA / GESTIÓN TRONCALES

## Contexto del proyecto

Plataforma web **SIT EBEMA** (Sistema Integrado de Transporte) para gestión logística de EBEMA. El módulo **Gestión Troncales** gestiona el abastecimiento de sucursales desde centros de distribución (CD Quilicura 1003 y CD Concepción 1081).

**URL producción:** GitHub Pages desde branch `main` del repo en `C:\Users\Jordan\Desktop\ANTIGRAVITY\WEB TRANSPORTE`

---

## Stack Tecnológico

- **Frontend:** Vanilla JS (módulos ES6), Tailwind CSS (CDN), Material Symbols icons
- **Backend:** Supabase (PostgreSQL + RLS + REST API)
  - **Project ID:** `humhokvdowfqicjopbhf`
- **Automatización:** Google Apps Script lee Gmail 3x/día (7:35, 11:35, 13:35 hora Chile), parsea adjuntos SAP (.xlsx SLIM, .htm SQVI), carga a Supabase
  - **Apps Script URL:** `https://script.google.com/home/projects/1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx/edit`
- **Deploy:** `DESPLEGAR_ABASTECIMIENTO.bat` (limpia .lock git, commit, push a GitHub Pages)
- **Hosting:** GitHub Pages con `.nojekyll`

---

## Estructura de Archivos Clave

```
WEB TRANSPORTE/
├── index.html                          # Entry point (carga app.js con ?v=YYYYMMDD)
├── js/
│   ├── app.js                          # Router principal, menú sidebar, tabs
│   ├── abastecimiento.js               # Módulo Gestión Troncales (vistas, plan carga, calendario, proveedores)
│   ├── supabase-client.js              # Cliente Supabase inicializado
│   ├── data.js                         # Base de datos local (rutas, centros logísticos)
│   ├── utils.js                        # showAlert, escapeHtml
│   ├── transports.js, routes.js, rates.js  # Otros módulos
│   └── cluster-op.js                   # Motor de ejes/cluster
├── css/style.css                       # Estilos custom
├── automatizacion_troncales/Code.gs    # Google Apps Script completo
├── DESPLEGAR_ABASTECIMIENTO.bat        # Script de deploy
└── .nojekyll
```

---

## Base de Datos Supabase

### Tablas principales

| Tabla | Descripción |
|---|---|
| `trc_live` | Datos SAP actuales. Columnas: `fuente`, `fila`, `data` (JSONB), `corrida`, `cargado_en`. **NO tiene columna `id`** |
| `trc_hist` | Snapshot diario (13:35), retención 7 días |
| `trc_log` | Log de cada corrida de importación |
| `abast_calendario` | Calendario de carga por sucursal. Columnas: `id`, `centro`, `dia` (1=Lun..6=Sab), `bloque`, `habilitado`, `cupos`, `sobre_cupo`, `centro_destino_1`, `centro_destino_2`, `updated_by`, `updated_at` |
| `abast_proveedores` | Catálogo de proveedores |
| `abast_proveedor_direcciones` | Direcciones de fábrica por proveedor |
| `app_users` | Usuarios con roles (RLS depende de `app_role()`) |
| `routes` | Rutas con código, comuna, región |
| `logistics_centres` | Centros logísticos (id, nombre) |

### Vistas SQL (todas con `security_invoker = on`)

| Vista | Fuente en trc_live | Uso |
|---|---|---|
| `v_trc_slim_stock` | `slim_stock` | Quiebres Sucursal (Step SLIM) |
| `v_trc_sqvi_retiros_fabrica` | `sqvi_retiros_fabrica` | Retiros Fábrica (Step 1) |
| `v_trc_sqvi_pedidos_venta_1003` | `sqvi_pedidos_venta_1003` | Pedidos Ventas 1003 (Step 2) |
| `v_trc_sqvi_stock_almacen_4000` | `sqvi_stock_almacen_4000` | Stock Almacén 4000 (Step 3) |
| `v_trc_sqvi_pedidos_traslados` | `sqvi_pedidos_traslados` | Pedidos Traslados (Step 4) + REVEX |
| `v_trc_sqvi_pedidos_traslados_4000` | `sqvi_pedidos_traslados_4000` | Pedidos Traslados 4000 (Step 5) |
| `v_trc_sqvi_plan_troncales` | `sqvi_plan_troncales` | Plan Troncales (Step 6) |

### Modelo JSONB

`trc_live.data` es JSONB. Cada vista extrae campos con `data ->> 'campo'`. Las vistas deben crearse con `security_invoker = on` y `GRANT SELECT ON ... TO authenticated`.

### Formato numérico SAP

Los números vienen con **puntos como separador de miles y coma como decimal** (ej: `1.234,56`). Parse: `.replace(/\./g, '').replace(',', '.')`.

---

## Google Apps Script (`Code.gs`)

### Mapa de fuentes SQVI

```javascript
var SQVI_FUENTES = {
  '1': 'sqvi_retiros_fabrica',
  '2': 'sqvi_pedidos_venta_1003',
  '3': 'sqvi_stock_almacen_4000',
  '4': 'sqvi_pedidos_traslados',
  '5': 'sqvi_pedidos_traslados_4000',
  '6': 'sqvi_plan_troncales'
};
```

### Flujo
1. Lee Gmail con label `SQVI Troncales` (Label_6779002822901894216)
2. Parsea adjuntos: `.xlsx` = SLIM stock, `.htm` = SQVI (identifica step por nombre del correo)
3. Carga a `trc_live` (DELETE + INSERT por fuente)
4. A las 13:35 también copia a `trc_hist` (retención 7 días)
5. Registra en `trc_log`

### Triggers
- 7:35, 11:35, 13:35 hora Chile (`America/Santiago`)
- Función: `procesarCorreosTroncales()`
- Test manual: `probar_ahora()`

---

## Menú Sidebar (app.js)

Bajo **"Gestión Troncales"**:
1. Proveedores
2. Calendario Sucursales
3. Quiebres Sucursal
4. Retiros Fábrica
5. Pedidos Ventas 1003
6. Stock Almacén 4000
7. Pedidos Traslados
8. Pedidos Traslados REVEX
9. Pedidos Traslados 4000
10. Plan de Carga
11. Plan Troncales

---

## Módulo abastecimiento.js — Reglas de Negocio

### Centros válidos (CENTROS_QUIEBRES)
`['1005','1020','1040','1050','1060','1070','1080','1090','1100','1160']`

### Helpers críticos

```javascript
// Peso Mayor = MAX(peso_bruto, tamaño_dimensión) — parseando formato SAP
function maxPesoDim(peso, dim) { ... }

// Tonelaje = pesoMax * cantidad / 1000
function calcTon(pesoMax, cantidad) { ... }

// Fecha SAP DD.MM.YYYY → Date
function parseDateSAP(s) { ... }

// Alerta fecha: < hoy = ATRASADO, <= umbral días = PRONTO A VENCER
function alertaFecha(fechaStr, diasUmbral) { ... }

// Rango fecha: diff >= -diasAntes && diff <= diasDespues
function fechaEnRango(fechaStr, diasAntes, diasDespues) { ... }

// Lookup ruta → {comuna, region} desde db.routes
function lookupRuta(rutaId) { ... }

// Nombre centro desde logistics_centres
function getNombreCentro(id) { ... }

// Timestamp UTC → hora Chile legible
function horaChile(ts) { ... }
```

### 1. Quiebres Sucursal
- **Vista:** `v_trc_slim_stock`
- **Filtros:** chipFilter por `centro`
- **Alertas:**
  - stockdays = 0 → `PRODUCTO QUEBRADO` (rojo)
  - stockdays < 7 + ABC AA/AB/AC → `STOCK CRÍTICO`
  - stockdays < 7 + ABC BA/BB/BC → `STOCK ALERTA`
  - stockdays < 7 + ABC CA/CB/CC → `STOCK REVISAR`
- **Orden:** stockdays ascendente
- **Campos calculados:** `_desc_centro` (lookup), `_alerta`

### 2. Retiros Fábrica (Step 1)
- **Vista:** `v_trc_sqvi_retiros_fabrica`
- **Filtros:** chipFilter `ce`, extraChips: `_tipo_retiro`, `_alerta`, `_vigencia`. Sin buscar general (`noBuscar: true`)
- **Reglas:**
  - Ocultar subtotales (proveedor empieza con `*`)
  - Ocultar filas sin contrato (`contr` vacío)
  - `_tipo_retiro`: almacén 4000 = `CONSOLIDAR CD`, otro = `FABRICA-SUCURSAL`
  - `_diferencia` = ctd_pedido - ctd_entregada
  - `_revision_saldo`: si ctd_entregada > 0 && ctd_entregada < ctd_pedido → fila roja + "REVISIÓN SALDO PEDIDO"
  - Ton Totales = peso_mayor × (ctd_pedido - ctd_entregada) / 1000
  - Alerta fecha: umbral 5 días
- **Orden:** fecha de retiro ascendente

### 3. Pedidos Ventas 1003 (Step 2)
- **Vista:** `v_trc_sqvi_pedidos_venta_1003`
- **Filtros:** chipFilter `ofvta`, filtro buscar `doc_ventas`
- **Reglas:**
  - Filtrar rechazos: solo filas con columna `mr` vacía
  - **Dedup:** mismo doc_ventas + material → quedarse con fecha más reciente
  - Lookup ruta → `_comuna`, `_region`
  - **DATO CRÍTICO:** `peso_bruto` en esta vista YA es peso total de línea (peso_bruto = para la línea completa), por lo que **Ton Totales = peso_mayor / 1000** (NO multiplicar por cantidad)
  - Alerta fecha: umbral 5 días
- **Orden:** fecha entrega ascendente

### 4. Pedidos Traslados (Step 4)
- **Vista:** `v_trc_sqvi_pedidos_traslados`
- **Filtros:** chipFilter `ce` (Centro Destino)
- **Reglas:**
  - Excluir subtotales (cesu empieza con `*`, material vacío)
  - Excluir material 900000 (esos van a REVEX)
  - Ton Totales = peso_mayor(peso_neto, tamaño) × ctd_confirmada / 1000
  - Alerta fecha confirmada: umbral 7 días
- **Orden:** fecha confirmada ascendente

### 5. Pedidos Traslados REVEX
- Misma vista `v_trc_sqvi_pedidos_traslados`, pero **solo material que empieza con 900000**
- Misma estructura y alertas que Pedidos Traslados

### 6. Pedidos Traslados 4000 (Step 5)
- **Vista:** `v_trc_sqvi_pedidos_traslados_4000`
- **Filtros:** chipFilter `ce` (Centro Destino)
- Ton Totales = peso_mayor(peso_neto, tamaño) × cantidad_salida / 1000

### 7. Stock Almacén 4000 (Step 3)
- **Vista:** `v_trc_sqvi_stock_almacen_4000`
- **Filtros:** chipFilter `ce`
- Lookup ruta → comuna, región
- Ton Totales = peso_mayor × libre_utiliz / 1000

### 8. Plan Troncales (Step 6)
- **Vista:** `v_trc_sqvi_plan_troncales`
- **Filtros:** chipFilter `ce`, filtro buscar `material`
- Excluir material vacío y centros con `*`
- Ton Totales = peso_mayor(peso_bruto, tamaño) × libre_utiliz / 1000

---

## Plan de Carga — Reglas de Negocio

Dashboard que consolida toneladas por centro para planificar carga del día siguiente (mañana).

### Capacidad de camión
- **Default:** 28 toneladas
- **Reducido (Calera 1050, San Bernardo 1005):** 15 toneladas

### Centros prioritarios (calendario)
Lee tabla `abast_calendario` filtrando por `dia` = getDay() de mañana. Extrae `centro_destino_1` y `centro_destino_2` de bloques habilitados.

### Categorías de carga (cómo se calculan las toneladas)

| Categoría | Fuente | Filtros | Rango fecha |
|---|---|---|---|
| **Abastecimiento Quiebre** | Pedidos Traslados | destino=ce, material en quiebres (stockdays=0 ó <7 con ABC) | fecha_confirmada -10/+5 |
| **Abastecimiento Stock** | Pedidos Traslados | destino=ce, material NO en quiebres | fecha_confirmada -10/+5 |
| **REVEX** | Pedidos Traslados (mat 900000) | destino=ce | Sin filtro de fecha |
| **Crossdocking 4000** | Pedidos Traslados 4000 | destino=ce | fe_entrega -5/+5 |
| **Notas Venta Directa** | Ventas 1003 | ofvta=ce, mr vacío, doc sume ≥85% cap | fe_entrega -3/+5 |
| **Notas Venta Traslado** | Ventas 1003 | ofvta=ce, mr vacío, doc sume <85% cap | fe_entrega -3/+5 |
| **Retiro Proveedor** | Retiros Fábrica | ce=centro, alm=4000 (CONSOLIDAR CD) | fe_entrega -10/+5 |

**NOTA sobre rangos de fecha:** El documento de requisitos dice +7 para Quiebre/Stock/REVEX, pero el código actual usa +5 para Quiebre/Stock y sin filtro para REVEX. **Pendiente de ajustar según documento.**

### Status por centro

| % Completitud | Status | Color |
|---|---|---|
| ≥ 80% | PROGRAMAR | Verde |
| 70-80% | REVISAR | Amarillo |
| < 70% | CARGA INSUFICIENTE | Gris |

### Observaciones especiales
- Centro **NO en calendario** pero ≥70% → `CUPO EXTRA` (puede adelantarse)
- Centro **en calendario** pero <70% → `EN CALENDARIO - CARGA BAJA`

### Cantidad de transporte
`Math.ceil(total / 28)` — cantidad de camiones necesarios

### Visual
- SVG de camión que se llena según % de completitud
- Filas calendario: fondo azul + borde rojo + badge `PRIORITARIO`
- Filas no calendario: gris con opacidad reducida

---

## Calendario Sucursales

### Configuración estática (CALENDARIOS)

**CD Quilicura (1003):**
- Bloques: 07:30-11:30, 11:00-15:00, 15:30-19:30
- Días: Lunes a Sábado (sábado = sobre cupo, solo bloque 07:30-11:30)
- Destinos: 1020, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1160, 1005

**CD Concepción (1081):**
- Bloques: 08:00-11:00, 11:00-15:00
- Días: Lunes a Viernes
- Destinos: 1100, 1090, 1160, 1070, 1060, 1005, 1003

### Tabla `abast_calendario`
Cada fila tiene `centro_destino_1` y `centro_destino_2` por bloque/día. Actualmente solo tiene datos para centro 1003. El Plan de Carga lee esta tabla para determinar centros prioritarios por día.

---

## Seguridad (RLS)

- Acceso depende de fila en `app_users` + función `app_role()`
- Todas las vistas usan `security_invoker = on`
- Cada vista tiene `GRANT SELECT ON ... TO authenticated`
- Si un usuario "no ve datos" → verificar que tiene fila en `app_users` con rol reconocido

---

## Deploy

1. Ejecutar `DESPLEGAR_ABASTECIMIENTO.bat`
2. El bat limpia `.lock` residuales de git, hace commit y push a `main`
3. GitHub Pages sirve desde `main`
4. **Cache-busting:** cambiar `?v=YYYYMMDD` en `app.js` (import de abastecimiento.js) e `index.html` (import de app.js)
5. Locks residuales de git pueden bloquear commits → el bat los limpia automáticamente

---

## Pendientes identificados (diferencias documento vs código)

1. **Rangos de fecha Plan de Carga:** Doc dice +7 para Quiebre/Stock, código usa +5
2. **REVEX filtro fecha:** Doc dice -10/+7, código no filtra por fecha
3. **Ventas filtro condición expedición 08:** Doc dice filtrar por `clvt` conteniendo '08', código no lo filtra
4. **Retiro OC 90% camión directo:** Doc dice que si una OC tiene ≥90% de capacidad del camión, se carga directo como camión adicional — no implementado
5. **Punto 10 — Vista detalle:** Doc dice mostrar detalle de qué se considera por centro (drill-down) — no implementado

---

## Prompt para nuevo chat

```
Eres mi asistente experto en desarrollo web. Estoy construyendo la plataforma SIT EBEMA de gestión de transporte.

STACK: Vanilla JS (módulos ES6) + Tailwind CSS (CDN) + Supabase (PostgreSQL + RLS + REST API) + GitHub Pages.

PROYECTO: El módulo "Gestión Troncales" en js/abastecimiento.js gestiona abastecimiento de sucursales desde centros de distribución. Los datos SAP se cargan automáticamente vía Google Apps Script 3x/día a la tabla trc_live (columnas: fuente, fila, data JSONB, corrida, cargado_en — NO tiene columna id). Las vistas SQL extraen campos del JSONB con security_invoker=on.

REGLAS CRÍTICAS:
- Formato numérico SAP: puntos = miles, coma = decimal → parsear con .replace(/\./g, '').replace(',', '.')
- Peso Mayor = MAX(peso_bruto, tamaño_dimensión)
- En Pedidos Ventas 1003: peso_bruto YA es peso total de línea, así que Ton Totales = peso_mayor / 1000 (NO multiplicar por cantidad)
- En las demás vistas: Ton Totales = peso_mayor × cantidad / 1000
- Todas las vistas Supabase requieren security_invoker=on + GRANT SELECT TO authenticated
- Deploy: cambiar ?v=YYYYMMDD en app.js e index.html, ejecutar DESPLEGAR_ABASTECIMIENTO.bat
- Hora Chile: usar toLocaleString con timeZone 'America/Santiago'
- trc_live NO tiene columna id (solo fuente, fila, data, corrida, cargado_en)

Supabase project_id: humhokvdowfqicjopbhf
Apps Script: https://script.google.com/home/projects/1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx/edit

El archivo principal es js/abastecimiento.js (~1300 líneas) que contiene todas las vistas de datos, el Plan de Carga, el Calendario Sucursales y los Proveedores.

Responde directo, profesional y estructurado. Usa listas con viñetas y negritas para palabras clave.
```
