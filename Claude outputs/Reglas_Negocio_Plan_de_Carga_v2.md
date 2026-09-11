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
| **CD Quilicura** | 1003 | Ventas 1003, Retiros de fábrica, Traslados cesu=1003, Crossdocking |
| **CD 1081** | 1081 | Solo Traslados cesu=1081 y REVEX cesu=1081 |

> **Importante:** Ventas 1003 y Retiros de fábrica **solo** están disponibles en el plan del CD 1003.

---

## 3. Centros de Destino (Sucursales)

El plan muestra una fila por cada sucursal destino habilitada para el origen seleccionado:

- CD Quilicura (1003) → **1005, 1020, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1160**

---

## 4. Fecha de Planificación

- El horizonte es **parametrizable**: por defecto planifica para mañana, con opción de extender a dos días hábiles.
- Los **viernes**: se puede ver la carga del lunes y definir como sobre-cupo dos camiones que se cargarán el sábado.
- El CD Quilicura (1003) **opera en sábado** — el sábado cuenta como día de despacho válido para 1003.

---

## 5. Capacidad de Camión

| Sucursal | Capacidad |
|----------|-----------|
| La Calera (1050) y San Bernardo (1005) | **15 o 28 toneladas** (parametrizable) |
| Resto de sucursales | **28 toneladas** |

- **Columna FALTA / SOBRA:** muestra cuánto falta o sobra respecto a la capacidad del camión.
  - **Número en rojo** = falta carga para completar el camión.
  - **Número en verde** = hay más carga que la capacidad (requiere 2º camión, se indica en Observaciones).
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

El **detalle del camión** muestra únicamente los ítems que entran dentro de la capacidad, en orden de prioridad.

---

## 7. Camiones Independientes (fuera del camión CD)

Existen tres tipos de carga que NO consolidan con el camión CD y tienen su propio ícono en la tabla:

| Camión | Condición de activación | Ícono |
|--------|------------------------|-------|
| **Camión Cliente** (verde) | Pedido de Venta (vista pedidos de ventas 1003) cuyo total **> 26 T** | Camión verde |
| **Camión Fábrica-Sucursal** (azul) | OC de retiro tipo FAB-SUC con total **≥ 85% cap** (~≥24 T), sin PV asociado | Camión azul |
| **Camión Fábrica-Cliente** (morado) | OC de retiro tipo FAB-SUC con total **≥ 85% cap**, con PV asociado | Camión morado |

---

## 8. Reglas Detalladas por Tipo de Carga

### 8.1 REVEX (Prioridad 1ª)
- **Fuente:** Vista `v_trc_sqvi_pedidos_traslados`, filtrado por material REVEX y `cesu` = origen.
- **Fórmula de toneladas:** `peso_neto_2 × ctd_pedido`
- **Ventana de fecha:** Sin filtro — se incluyen **todos los pendientes REVEX** del origen.

---

### 8.2 Pedidos de Venta Directa (Prioridad 2ª)
- **Solo disponible desde CD Quilicura (1003).**
- **Fuente:** Vista `v_trc_sqvi_pedidos_venta_1003` con ruta asignada.
- **Ventana de fecha:** `fe_entrega` entre **-3 y +3 días** desde hoy.
- **Filtro de pendiente:** Solo incluye líneas donde `ctd_confirmada > cantidad_entrg` (hay pendiente).
- **Agrupación:** Por pedido de venta (un pedido puede tener varias líneas; se suma el total).
- **Clasificación según peso total del PV:**
  - Total **> 26 T** → **Camión Cliente** (directo, no consolida con CD).
  - Total **≤ 26 T** → Entra al camión CD en posición 2ª.

---

### 8.3 Retiros de Proveedor FAB-CD (Prioridad 3ª)
- **Solo disponible desde CD Quilicura (1003).**
- **Fuente:** Vista `v_trc_sqvi_retiros_fabrica`.
- **Condición obligatoria:** `estado = 'coordinado'` **Y** (`entrega_entrante` no vacío **O** `tipo_local_rm = 'RM'`).
- **Ventana de fecha:** Los retiros con `fe_entrega > +3 días` desde hoy quedan **pendientes** hasta que entren en el rango; no se excluyen definitivamente.
- **Solo entra al camión CD:** Las OC marcadas como `tipo_retiro = FAB-CD`. El almacén **no es condicionante** — basta con que esté marcada FAB-CD.
- Las OC `FAB-SUC` o `FAB-CLTE` generan camiones independientes (ver sección 7).
- **Tipo de retiro** se asigna automáticamente según almacén (como sugerencia inicial), pero el **valor guardado en `abast_retiro_estado` tiene precedencia** sobre el automático:
  - `alm = 4000` → sugiere FAB-CD
  - `alm = 2000` → sugiere FAB-SUC
  - OC ≥ 85% cap + PV asociado → sugiere FAB-CLTE

---

### 8.4 Crossdocking — Traslados 4000 (Prioridad 4ª)
- **Fuente:** Vista `v_trc_sqvi_pedidos_traslados_4000`.
- **La vista muestra todos los pendientes;** el plan aplica filtro **-3 / +3 días** sobre `fe_entrega` para ser considerado en el camión.
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

| Tipo de Carga | Campo de Fecha | Ventana en el Plan |
|---------------|---------------|-------------------|
| Traslados Quiebre | `fecha_confirmada` | **-10 / +7 días** |
| Traslados Abastecimiento | `fecha_confirmada` | **-10 / +7 días** |
| Crossdocking 4000 | `fe_entrega` | **-3 / +3 días** (la vista muestra todos) |
| Ventas Directas | `fe_entrega` | **-3 / +3 días** |
| Retiros Proveedor | `fe_entrega` | Pendiente si > +3 días; entra al camión cuando cumple el rango |

> *Nota:* Los viernes se puede definir carga para el lunes, con opción de programar dos camiones de sobre-cupo el sábado.

---

## 10. Semáforo de Estado por Sucursal

| % de Completitud | Estado | Color | Acción sugerida |
|-----------------|--------|-------|----------------|
| ≥ 80% | **PROGRAMAR** | Verde | Listo para coordinar camión |
| 70–79% | **REVISAR** | Amarillo | Evaluar si agregar más carga |
| < 70% | — | Rojo/gris | Carga insuficiente |

**PRIORITARIO** (ícono calendario): el centro tiene bloque asignado en el calendario de mañana → aparece al tope de la lista.

**CUPO EXTRA**: centro sin bloque en calendario pero que ya alcanza ≥70% → se puede programar fuera de turno.

**2º CAMIÓN**: la carga excede la capacidad del camión → se indica en Observaciones el tonelaje excedente; la columna FALTA/SOBRA muestra el valor en verde.

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

Al hacer clic en el ícono de camión de cada sucursal se expande el contenido del camión:

- Se muestran **únicamente los ítems que entran dentro de la capacidad**, en orden de prioridad.
- Si hay sobrecarga, el banner del detalle indica el tonelaje que requiere un 2º camión.
- Cada bloque tiene botón **CSV** para exportar el detalle.
- El botón **Refrescar** limpia la caché y vuelve a leer los datos desde Supabase.

---

## 14. Reglas del Calendario (Cupos)

- El calendario de despacho se gestiona en **Gestión Troncales → Calendario Sucursales**.
- Bloques estándar: 08-10, 10-12, 12-14, 14-16, 16-18.
- Días disponibles: L–V para todas; **el sábado es válido** para el CD Quilicura (1003).
- Si el calendario no tiene cupo para una sucursal mañana pero la carga ≥70%, el sistema sugiere "CUPO EXTRA".

---

*Documento actualizado 2026-09-11 incorporando correcciones de Jordan Candia. Versión anterior: Sept-2026 Ajuste 3.0.*
