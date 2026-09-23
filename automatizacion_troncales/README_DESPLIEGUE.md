# Automatización Correos Troncales / Entregas / DT / Pedidos Ventas / SLIM → Supabase

**Actualizado 2026-09-23.** Proyecto Apps Script **`Proyecto Troncales`** (id `1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx`), cuenta jcandia@ebema.cl.

## Cambios 23-sep-2026

1. **Snapshot desacoplado del correo de las 13:35.** Antes, la foto diaria en `trc_hist` se guardaba junto con la corrida de Troncales de las 13:35 (dependía de que hubiera llegado correo a esa hora). Ahora hay una corrida propia a las **15:30** (`ejecutar_troncales_1530`) que solo hace `sbRpcSnapshotHoy()` sobre lo que **ya esté** en `trc_live` en ese momento, sin depender de correo. La corrida de las 13:35 (`ejecutar_troncales_1335`) ya no snapshotea, solo lee correo.
2. **Barrido de rezagados: 30 min → 15 min, ventana 09:00–15:00 → 08:15–15:20.** Motivo: mucha variación en los horarios de envío de SAP; con 15 min se reduce la demora máxima en detectar un lote rezagado.
3. Se reutilizó el slot de trigger de `ejecutar_troncales_1510` (ya no existe) para crear `ejecutar_troncales_1530`, manteniendo el total en 20/20 (sin cupos libres en el proyecto).

## Cambios 22-sep-2026

1. **Carga manual por Drive DESACTIVADA.** Se vuelve a la lectura original: solo correo SAP. `DRIVE_FOLDER_MANUAL_ID = ''`; si falta un correo, la fuente queda `sin_correo`. Las funciones `probar_ahora_manual_*` siguen en el código pero no leen nada.
2. **Espera de ráfaga SAP (`esperarLoteCompleto`).** SAP envía los Steps en ráfaga y Gmail etiqueta con retraso los adjuntos grandes. Antes de leer, cada bloque espera a que el último correo de su etiqueta tenga ≥ 3 min de quietud (máx. 4 min de espera). Evita cargar un lote a medias.
3. **Barrido de rezagados (`ejecutar_barrido_rezagados`)**: trigger frecuente, actúa **lun-vie** dentro de una ventana horaria (ver arriba, ajustada 23-sep). Revisa TODAS las lecturas (Troncales, Pedidos de Ventas, Entregas, DT, SLIM) y procesa solo los bloques con correos SAP no leídos. Si una ráfaga aún está llegando, lo deja para el próximo barrido. No registra `sin_correo` (sin ruido en `trc_log`). SLIM: solo carga un correo no leído **de hoy**.

Motivo: SAP no envía a hora fija (ej. 22-sep: 10:46, 11:07, 11:31, 12:20, 13:12, 13:32, 14:31, 14:46, 15:03), por lo que los triggers fijos dejaban lotes sin leer hasta el día siguiente.

## Bloques, etiquetas y horarios (hora Chile, lunes a viernes)

| Bloque | Etiqueta Gmail | Asuntos | Triggers fijos | Barrido 15 min (08:15–15:20) |
|---|---|---|---|---|
| **TRONCALES** | `SQVI Troncales` | Job ZJC PLAN TRONCALES, Step 1–6 | 07:55, 09:35–12:35 (horario), 13:35 (solo lectura), **15:30 (snapshot)** | Sí |
| **PEDIDOS DE VENTAS** | `Pedidos de Ventas (NV)` | Job ZJC PLAN ENTREGAS, Step 2–11 | 07:40, 11:10, 13:10, 14:40 | Sí |
| **ENTREGAS** | `Entregas` | Job ZJC PLAN ENTREGAS, Step 1 | 07:15, 12:30, 15:00 | Sí |
| **DOC TRANSPORTE** | `Doc Transporte (DT)` | Job ZJC PLAN DT, Step 1 | 08:10, 16:30, 22:30 | Sí |
| **SLIM** | `Plan Troncales (SLIM)` | "Reporte Stock Sucursales" (.xlsx) | 06:30 | Sí (solo correo de hoy) |

La corrida de las **15:30** (TRONCALES) guarda la foto del día en `trc_hist` (7 días) con lo que haya en `trc_live` a esa hora, sin depender de que haya llegado correo. El barrido no hace snapshot.

**Triggers del proyecto: 20 de 20** (16 de `Code.gs` + 3 de `CorreoPlanCarga.gs` + 1 de `NivelServicioRevex.gs`). No quedan cupos: para agregar un trigger hay que consolidar otro.

## Supabase

- **`trc_live`** — datos vigentes, se pisa por fuente en cada carga.
- **`trc_hist`** — foto diaria 15:30, 7 días.
- **`trc_log`** — bitácora: `ok` / `sin_correo` / `error` (histórico: `ok_manual`, `sin_cambio_manual` del fallback Drive ya desactivado).

## Actualizar el Apps Script

1. Abrir el proyecto → `Código.gs` → pegar el `Code.gs` de esta carpeta → Guardar.
2. Si cambian horarios: ejecutar **`crearTriggers`** (borra y recrea los 16 triggers de este archivo; no toca los de `CorreoPlanCarga.gs` ni `NivelServicioRevex.gs`).
3. Revisar **Registro de ejecución**.

**Ojo en el editor:** al elegir la función en el desplegable, confirmar que quedó seleccionada (zoom a la barra) antes de pulsar Ejecutar (a veces ejecuta la función anterior si se hace clic antes de que el menú termine de abrir).

## Probar manualmente (ignoran día hábil)

- `probar_ahora_troncales`, `probar_ahora_troncales_snapshot`
- `probar_ahora_pedidosventas`, `probar_ahora_entregas`, `probar_ahora_doctransporte`, `probar_ahora_slim`

Para reprocesar un correo: marcarlo **no leído** en Gmail y correr la función del bloque (o esperar el barrido).

## Diagnóstico

- `trc_log` ordenado por `cargado_en desc`.
- `sin_correo` = no había correo SAP no leído en la etiqueta a esa hora (normal si SAP aún no envía; el barrido lo recoge después).
