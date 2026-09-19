# Automatización Correos Troncales / Entregas / DT / Pedidos Ventas / SLIM → Supabase

**Actualizado 2026-09-18.** Antes este script leía todo (TRONCALES + DT + ENTREGAS) desde una sola corrida/horario, lo que generaba lecturas simultáneas y dificultaba la carga correcta. Ahora cada "proyecto" es un **bloque independiente**: su propia etiqueta Gmail, su propio horario, y solo marca como leídos los correos que él mismo procesó.

## Bloques, etiquetas y horarios (hora Chile, lunes a viernes)

| Bloque | Etiqueta Gmail | Asuntos que lee | Horarios |
|---|---|---|---|
| **TRONCALES** | `SQVI Troncales` | Job ZJC PLAN TRONCALES, Step 1–6 | 07:35, 09:35, 10:35, 11:35, 12:35, 13:35, 14:50 |
| **PEDIDOS DE VENTAS** | `Pedidos de Ventas (NV)` | Job ZJC PLAN ENTREGAS, Step 2–11 | 07:10, 11:10, 13:10, 14:35 |
| **ENTREGAS** | `Entregas` | Job ZJC PLAN ENTREGAS, Step 1 | 07:15, 12:30, 15:00 |
| **DOC TRANSPORTE** | `Doc Transporte (DT)` | Job ZJC PLAN DT, Step 1 | 08:10, 16:30, 22:30 |
| **SLIM** | `Plan Troncales (SLIM)` | adjunto Excel "Reporte Stock Sucursales" | 07:10 (dentro de la corrida de Pedidos de Ventas, ver nota abajo) |

Las 5 etiquetas **ya existen** en la cuenta `jcandia@ebema.cl` (con sus filtros de Gmail ya funcionando, verificado 18-sep-2026) — no hay que crear nada nuevo en Gmail.

## Por qué SLIM quedó a las 07:10 y no a las 06:30

El proyecto Apps Script `Troncales SIT EBEMA` tiene un límite de **20 triggers por proyecto**, compartido con el archivo `CorreoPlanCarga.gs` (el envío automático del Plan de Carga a las 8:30/12:00/15:30, que **no se tocó** en este cambio) — ese archivo ya usaba 3 triggers. Eso dejaba solo 17 cupos libres para los 18 triggers nuevos planeados. En vez de sacrificar uno de los horarios pedidos, SLIM se fusionó dentro de la función de las 07:10 (`ejecutar_pedidosventas_0710`), que corre primero `correrSlim()` y luego `correrPedidosVentas()`. La función `ejecutar_slim_0630` sigue existiendo en el código para pruebas manuales, solo que no tiene trigger propio.

La corrida de las **13:35** (TRONCALES) además guarda la foto del día en el histórico (`trc_hist`, 7 días) y poda lo que ya expiró — esto no cambió.

Cada función valida `esDiaHabil()` (lunes a viernes) antes de tocar Gmail/Supabase, así que si el trigger dispara sábado o domingo no hace nada.

## Qué quedó creado en Supabase (sin cambios)

- **`trc_live`** — datos vigentes. En cada corrida se **pisa** por fuente.
- **`trc_hist`** — foto diaria (solo corrida 13:35 de TRONCALES). Se conservan **7 días**.
- **`trc_log`** — bitácora de cada corrida (para verificar qué cargó y si hubo error).
- Vistas tipadas `v_trc_slim_stock`, `v_trc_sqvi_*` (una por fuente).

**Pedidos de Ventas / DT / Entregas** se siguen guardando como filas JSONB en `trc_live` (fuentes `pedidos_ventas_dt_s02`…`s11`, `dt_transportes`, `entregas_creadas`), igual que antes — el parser toma automáticamente todas las columnas que traiga el HTM de SAP (nombre vendedor, nombre cliente, ruta, condición de expedición, etc. quedan disponibles tal cual las nombre SAP en el encabezado). Si quieres una vista SQL tipada específica para Pedidos de Ventas (con esas 4 columnas ya nombradas), lo armamos cuando tengas a mano un correo de ejemplo de esos Steps para confirmar los nombres exactos de columna.

## Despliegue — ya realizado (18-sep-2026)

Este código ya fue pegado en **`script.google.com`** → proyecto **`Troncales SIT EBEMA`** (id `1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx`), guardado, y se ejecutó `crearTriggers()`. Se verificó en la página de Activadores: **20 triggers únicos** en total (los **17 nuevos** de la tabla de arriba + los **3 de `CorreoPlanCarga.gs`**, que no se tocaron), sin duplicados. No hubo que volver a habilitar el servicio Drive ni recargar `SUPABASE_SERVICE_KEY`.

Si en el futuro hay que repetir este paso (por ejemplo si se libera un cupo de trigger y se quiere darle a SLIM su propio horario a las 06:30): borrar el contenido de `Code.gs`, pegar la versión vigente, guardar y volver a ejecutar `crearTriggers` — la función limpia sola los triggers antiguos antes de crear los nuevos.

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
