# Automatización Correos Troncales / Entregas / DT / Pedidos Ventas / SLIM → Supabase

**Actualizado 2026-09-18.** Antes este script leía todo (TRONCALES + DT + ENTREGAS) desde una sola corrida/horario, lo que generaba lecturas simultáneas y dificultaba la carga correcta. Ahora cada "proyecto" es un **bloque independiente**: su propia etiqueta Gmail, su propio horario, y solo marca como leídos los correos que él mismo procesó.

## Bloques, etiquetas y horarios (hora Chile, lunes a viernes)

| Bloque | Etiqueta Gmail | Asuntos que lee | Horarios |
|---|---|---|---|
| **TRONCALES** | `SQVI Troncales` | Job ZJC PLAN TRONCALES, Step 1–6 | 07:35, 09:35, 10:35, 11:35, 12:35, 13:35, 14:50 |
| **PEDIDOS DE VENTAS** | `Pedidos de Ventas (NV)` | Job ZJC PLAN ENTREGAS, Step 2–11 | 07:10, 11:10, 13:10, 14:35 |
| **ENTREGAS** | `Entregas` | Job ZJC PLAN ENTREGAS, Step 1 | 07:15, 12:30, 15:00 |
| **DOC TRANSPORTE** | `Doc Transporte (DT)` | Job ZJC PLAN DT, Step 1 | 08:10, 16:30, 22:30 |
| **SLIM** | `Plan Troncales (SLIM)` | adjunto Excel "Reporte Stock Sucursales" | 06:30 (única corrida) |

Las 5 etiquetas **ya existen** en la cuenta `jcandia@ebema.cl` (con sus filtros de Gmail ya funcionando, verificado 18-sep-2026) — no hay que crear nada nuevo en Gmail.

La corrida de las **13:35** (TRONCALES) además guarda la foto del día en el histórico (`trc_hist`, 7 días) y poda lo que ya expiró — esto no cambió.

Cada función valida `esDiaHabil()` (lunes a viernes) antes de tocar Gmail/Supabase, así que si el trigger dispara sábado o domingo no hace nada.

## Qué quedó creado en Supabase (sin cambios)

- **`trc_live`** — datos vigentes. En cada corrida se **pisa** por fuente.
- **`trc_hist`** — foto diaria (solo corrida 13:35 de TRONCALES). Se conservan **7 días**.
- **`trc_log`** — bitácora de cada corrida (para verificar qué cargó y si hubo error).
- Vistas tipadas `v_trc_slim_stock`, `v_trc_sqvi_*` (una por fuente).

**Pedidos de Ventas / DT / Entregas** se siguen guardando como filas JSONB en `trc_live` (fuentes `pedidos_ventas_dt_s02`…`s11`, `dt_transportes`, `entregas_creadas`), igual que antes — el parser toma automáticamente todas las columnas que traiga el HTM de SAP (nombre vendedor, nombre cliente, ruta, condición de expedición, etc. quedan disponibles tal cual las nombre SAP en el encabezado). Si quieres una vista SQL tipada específica para Pedidos de Ventas (con esas 4 columnas ya nombradas), lo armamos cuando tengas a mano un correo de ejemplo de esos Steps para confirmar los nombres exactos de columna.

## Pasos para actualizar el Apps Script (una sola vez)

1. Entra a **script.google.com** → abre el proyecto **`Troncales SIT EBEMA`** (ya existente, id `1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx`).
2. Borra todo el contenido de `Code.gs` y pega el **`Code.gs`** nuevo (este mismo folder).
3. Guarda (Ctrl+S / ícono de guardar).
4. Ejecuta la función **`crearTriggers`** una sola vez (arriba, selecciona la función en el menú desplegable y pulsa **Ejecutar**). Esto:
   - Borra los triggers antiguos (07:30/11:30/13:30/14:30 combinados).
   - Crea los **18 triggers nuevos** descritos en la tabla de arriba.
5. Revisa **Registros de ejecución** — no debería haber errores de permisos (ya estaba autorizado).

No hace falta volver a habilitar el servicio Drive ni recargar la `SUPABASE_SERVICE_KEY`: quedan igual que antes.

## Probar manualmente (ignoran el día hábil, funcionan cualquier día)

- `probar_ahora_troncales` — corre TRONCALES sin snapshot.
- `probar_ahora_troncales_snapshot` — corre TRONCALES con snapshot (simula la corrida 13:35).
- `probar_ahora_pedidosventas`, `probar_ahora_entregas`, `probar_ahora_doctransporte`, `probar_ahora_slim`.
- `probar_ahora` / `probar_ahora_snapshot` — alias de compatibilidad, equivalen a los de TRONCALES.

Para reprocesar un correo puntual: márcalo como **no leído** en Gmail y corre la función de prueba del bloque correspondiente.

## Verificar / diagnosticar

- Tabla **`trc_log`** en Supabase (ordena por `cargado_en` desc): por cada fuente verás filas cargadas, estado (`ok` / `sin_correo` / `error`) y mensaje.
- **Importante (hallazgo 18-sep-2026):** el script anterior sólo leía la etiqueta `SQVI Troncales`, así que las fuentes `dt_transportes`, `entregas_creadas` y `pedidos_ventas_dt_s02..s11` probablemente **nunca se cargaron** en producción (esos correos llegan a las etiquetas `Doc Transporte (DT)`, `Entregas` y `Pedidos de Ventas (NV)`, no a `SQVI Troncales`). Con este cambio sí se leerán. Conviene revisar si `trc_live` tiene datos recientes para esas fuentes después de la primera corrida del día siguiente al despliegue.

## Si SAP cambia las columnas de un reporte

El parser SQVI arma las columnas a partir de la **fila de encabezado** del HTM. Si SAP agrega/renombra columnas, avísame para actualizar la vista correspondiente en Supabase (los datos igual se cargan en `trc_live`).
