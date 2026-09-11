# Reglas de Negocio — Plan de Carga
## EBEMA · Gestión Troncales · SIT Transporte
**Versión:** Ajuste 3.0 / Sept-2026 · **Uso:** Capacitación interna

---

## 1. ¿Qué es el Plan de Carga?

Dashboard de consolidación que reúne, por sucursal de destino, todo el material que el CD debe despachar. Muestra toneladas por tipo de carga, semáforo de completitud del camión y botones para abrir el detalle o descargar CSV.

**Acceso:** SIT Transporte → Gestión Troncales → **Plan de Carga**

---

## 2. Centro Origen

El plan se genera desde un único centro de despacho a la vez. El selector (arriba a la derecha) permite elegir:

| Opción | Centro | Aplica |
|--------|--------|--------|
| **CD Renca** | 1003 | Ventas 1003, Retiros de fábrica, Traslados cesu=1003, Crossdocking |
| **CD 1081** | 1081 | Solo Traslados cesu=1081 y REVEX cesu=1081 |

> **Importante:** Ventas 1003 y Retiros de fábrica **solo** están disponibles en el plan del CD 1003.

---

## 3. Centros de Destino (Sucursales)

El plan muestra una fila por cada sucursal destino habilitada para el origen seleccionado:

- CD 1003 → **1005, 1020, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1160**

---

## 4. Fecha de Planificación

- El plan **siempre planifica para mañana** (no para hoy).
- Si hoy es **viernes**, la planificación cubre sábado y lunes (se extienden las ventanas de fecha 2 días extra).
- El CD 1003 **opera en sábado** (el sábado no es sobre-cupo para 1003).

---

## 5. Capacidad de Camión

| Sucursal | Capacidad |
|----------|-----------|
| La Calera (1050) y San Bernardo (1005) | **15 toneladas** |
| Resto de sucursales | **28 toneladas** |

- Si la carga total **supera la capacidad**: la columna "Falta" muestra 0 y en Observaciones aparece **"2º CAMIÓN (~X T)"** con el tonelaje excedente.
- La capacidad de referencia para calcular umbrales de camión directo es siempre **28 T** (independiente de la sucursal).

---

## 6. Prioridad de Llenado del Camión CD

El camión del CD se llena en este orden estricto. El primer tipo que entra ocupa espacio antes que el siguiente:

| Posición | Tipo de Carga | Columna en tabla |
|----------|--------------|-----------------|
| **1º** | REVEX | 1º REVEX |
| **2º** | Pedidos de Venta Directa consolidados (≤26 T) | 2º Ped. Venta Directa |
| **3º** | Retiros de Proveedor FAB-CD coordinados | 3º Retiro Proveedor |
| **4º** | Crossdocking (Traslados 4000) | 4º Ped. Traslados CrossDock |
| **5º** | Traslados Quiebre (SKU con stock ≤7 días) | 5º Ped. Traslados Quiebres |
| **6º** | Traslados Abastecimiento (resto) | 6º Ped. Traslados Abastecimiento |

> El **detalle del camión** muestra en verde los ítems que entran dentro de la capacidad, y en sección separada ("excede") los que quedarían fuera si se llenara en orden.

---

## 7. Camiones Independientes (fuera del camión CD)

Existen tres tipos de carga que NO consolidan con el camión CD y tienen su propio ícono en la tabla:

| Camión | Condición de activación | Ícono |
|--------|------------------------|-------|
| **Camión Cliente** (verde) | Pedido de Venta cuyo total **> 26 T** | Camión verde |
| **Camión Fábrica-Sucursal** (azul) | OC de retiro tipo FAB-SUC con total **≥ 85% cap** (~≥24 T), sin PV asociado | Camión azul |
| **Camión Fábrica-Cliente** (morado) | OC de retiro tipo FAB-SUC con total **≥ 85% cap**, con PV asociado | Camión morado |

---

## 8. Reglas Detalladas por Tipo de Carga

### 8.1 REVEX (Prioridad 1ª)
- **Fuente:** Vista `v_trc_sqvi_pedidos_traslados`, filtrado por `material` REVEX y `cesu` = origen.
- **Fórmula de toneladas:** `peso_neto_2 × ctd_pedido`
- **Ventana de fecha:** Sin filtro de fecha — se incluyen **todos los pendientes REVEX** del origen.
- **Incluye NV Directas:** Ventas con `fe_entrega` en los próximos **0 a +5 días** se suman al bucket REVEX (aparecen en detalle como "1b NV Directas"). Estas NV se excluyen del cálculo de Venta Directa para evitar doble conteo.

---

### 8.2 Pedidos de Venta Directa (Prioridad 2ª)
- **Solo disponible desde CD 1003.**
- **Fuente:** Vista `v_trc_sqvi_pedidos_venta_1003` con ruta asignada.
- **Ventana de fecha:** `fe_entrega` entre **-3 y +3 días** desde hoy.
- **Filtro de pendiente:** Solo incluye líneas donde `ctd_confirmada > cantidad_entrg` (hay pendiente).
- **Agrupación:** Por pedido de venta (un pedido puede tener varias líneas; se suma el total).
- **Clasificación según peso total del PV:**
  - Total **> 26 T** → **Camión Cliente** (directo, no consolida con CD).
  - Total **≤ 26 T** → Entra al camión CD en posición 2ª.
- **NV Directas** (ve sección 8.1): si `fe_entrega` está en los próximos 5 días, va a REVEX, no aquí.

---

### 8.3 Retiros de Proveedor FAB-CD (Prioridad 3ª)
- **Solo disponible desde CD 1003.**
- **Fuente:** Vista `v_trc_sqvi_retiros_fabrica`.
- **Condición obligatoria:** `estado = 'coordinado'` **Y** (`entrega_entrante` no vacío **O** `tipo_local_rm = 'RM'`).
- **Ventana de fecha retiro:** `fe_entrega` entre **-3 y +2 días** desde hoy.
- **Solo entra al camión CD:** Las OC con `tipo_retiro = FAB-CD` (almacén origen = 4000).
- Las OC `FAB-SUC` o `FAB-CLTE` generan camiones independientes (ver sección 7).
- **Tipo de retiro** se asigna automáticamente según almacén:
  - `alm = 4000` → FAB-CD (consolida en CD)
  - `alm = 2000` → FAB-SUC (directo a sucursal)
  - OC ≥ 85% cap + PV asociado → FAB-CLTE (fábrica al cliente)
  - El tipo guardado en `abast_retiro_estado` tiene precedencia sobre el automático.

---

### 8.4 Crossdocking — Traslados 4000 (Prioridad 4ª)
- **Fuente:** Vista `v_trc_sqvi_pedidos_traslados_4000`.
- **Sin filtro de fecha:** Se incluyen **todos los pendientes** del centro destino.
- **Condición de pendiente:** `ctd_pedido > max(ctd_entregada, cantidad_salida)`.
- **Fórmula de toneladas:** `max(peso_neto, tamano_dimens) × pendiente`.

---

### 8.5 Traslados Quiebre (Prioridad 5ª)
- **Fuente:** Vista `v_trc_sqvi_pedidos_traslados`, filtrado por `cesu` = origen y materiales con quiebre.
- **Un SKU está en quiebre** si aparece en la vista de Quiebres Sucursal con `stock_days ≤ 7`.
- **Ventana de fecha:** `fecha_confirmada` entre **-10 y +7 días** desde hoy.
- **Excluye** líneas con `ctd_confirmada = 0` (ya entregadas).
- **Fórmula de toneladas:** `max(peso_neto, tamano_dimens) × ctd_confirmada`.

---

### 8.6 Traslados Abastecimiento (Prioridad 6ª)
- **Fuente:** Misma vista que Quiebre (`v_trc_sqvi_pedidos_traslados`), mismo `cesu`.
- **Condición:** SKU que **no** está en el mapa de quiebres.
- **Ventana de fecha:** `fecha_confirmada` entre **-10 y +7 días** desde hoy.
- **Excluye** líneas con `ctd_confirmada = 0`.
- **Fórmula de toneladas:** igual que Quiebre.

---

## 9. Resumen de Ventanas de Fecha

| Tipo de Carga | Campo de Fecha | Ventana |
|---------------|---------------|---------|
| Traslados Quiebre | `fecha_confirmada` | **-10 / +7 días** |
| Traslados Abastecimiento | `fecha_confirmada` | **-10 / +7 días** |
| Crossdocking 4000 | `fe_entrega` | **Sin filtro (todos los pendientes)** |
| Ventas Directas | `fe_entrega` | **-3 / +3 días** |
| NV Directas → bucket REVEX | `fe_entrega` | **0 / +5 días** |
| Retiros Proveedor | `fe_entrega` | **-3 / +2 días** |

> *Nota:* Si hoy es viernes, las ventanas de Traslados se extienden 2 días adicionales para cubrir el despacho del lunes.

---

## 10. Semáforo de Estado por Sucursal

| % de Completitud | Estado | Color | Acción sugerida |
|-----------------|--------|-------|----------------|
| ≥ 80% | **PROGRAMAR** | Verde | Listo para coordinar camión |
| 70–79% | **REVISAR** | Amarillo | Evaluar si agregar más carga |
| < 70% | — | Rojo/gris | Carga insuficiente |

**PRIORITARIO** (ícono calendario): el centro tiene bloque asignado en el calendario de mañana → aparece al tope de la lista.

**CUPO EXTRA**: centro sin bloque en calendario pero que ya alcanza ≥70% → se puede programar fuera de turno.

**2º CAMIÓN**: la carga excede la capacidad del camión → hay excedente que requiere un segundo camión.

---

## 11. Ordenamiento de la Lista de Sucursales

1. **Primero** los centros marcados como PRIORITARIO (están en el calendario de mañana).
2. **Luego** por porcentaje de completitud descendente (más llenos arriba).

---

## 12. Clasificación de Quiebres (referencia)

| Días de Stock | Categoría | Visualización |
|--------------|-----------|--------------|
| 0–3 días | **MATERIAL QUEBRADO URGENTE** | Rojo |
| 3–5 días | **STOCK CRÍTICO URGENTE** | Naranja |
| 6–7 días | EN REVISIÓN | (amarillo suave) |

Los traslados con quiebre suben a la posición 5ª en el camión, con mayor prioridad que el abastecimiento normal.

---

## 13. Funcionamiento del Detalle (Drill-down)

Al hacer clic en el ícono de camión de cada sucursal se expande el contenido:

- **"Ítems en camión"**: marcados en verde, en orden de prioridad, hasta la capacidad.
- **"Ítems que exceden"**: en sección naranja, los que quedarían fuera del primer camión.
- Cada bloque tiene botón **CSV** para exportar el detalle.
- El botón **Refrescar** limpia la caché y vuelve a leer los datos desde Supabase.

---

## 14. Reglas del Calendario (Cupos)

- El calendario de despacho se gestiona en **Gestión Troncales → Calendario Sucursales**.
- Bloques estándar: 08-10, 10-12, 12-14, 14-16, 16-18.
- Días disponibles: L–V para todas; **el sábado es válido** para el CD 1003 (no es sobre-cupo).
- Si el calendario no tiene cupo para una sucursal mañana pero la carga ≥70%, el sistema sugiere "CUPO EXTRA".

---

*Documento generado a partir del código fuente de `js/abastecimiento.js` (Ajuste 3.0, v=20260814a / Ajuste fecha 2026-09-09) y memoria de proyecto EBEMA.*
