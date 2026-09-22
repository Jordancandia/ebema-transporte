# Automatización Correos Troncales / Entregas / DT / Pedidos Ventas / SLIM → Supabase

**Actualizado 2026-09-22.** Proyecto Apps Script **`Proyecto Troncales`** (id `1vpwi2WUDjXsKBB9UV4bpMbBn_xOB61GP-Fg66PbMgpikA-6Ywxly_Qjx`), cuenta jcandia@ebema.cl.

## Cambios 22-sep-2026

1. **Carga manual por Drive DESACTIVADA.** Se vuelve a la lectura original: solo correo SAP. `DRIVE_FOLDER_MANUAL_ID = ''`; si falta un correo, la fuente queda `sin_correo`. Las funciones `probar_ahora_manual_*` siguen en el código pero no leen nada.
2. **Espera de ráfaga SAP (`esperarLoteCompleto`).** SAP envía los Steps en ráfaga y Gmail etiqueta con retraso los adjuntos grandes. Antes de leer, cada bloque espera a que el último correo de su etiqueta tenga ≥ 3 min (máx. 4 min de espera). Evita cargar un lote a medias.
3. **Troncales tarde: 14:50 → 15:10** (`ejecutar_troncales_1510`).
4. **Barrido de rezagados (`ejecutar_barrido_rezagados`)**: trigger cada 30 min, actúa **lun-vie de 09:00 a 15:00**. Revisa TODAS las lecturas (Troncales, Pedidos de Ventas, Entregas, DT, SLIM) y procesa solo los bloques con correos SAP no leídos. Si una ráfaga aún está llegando, lo deja para el próximo barrido. No registra `sin_correo` (sin ruido en `trc_log`). SLIM: solo carga un correo no leído **de hoy**.

Motivo: SAP no envía a hora fija (22-sep: 10:46, 11:07, 11:31, 12:20, 13:12, 13:32, 14:31, 14:46, 15:03), por lo que los triggers fijos dejaban lotes sin leer hasta el día siguiente.

## Bloques, etiquetas y horarios (hora Chile, lunes a viernes)

| Bloque | Etiqueta Gmail | Asuntos | Triggers fijos | Barrido 30 min |
|---|---|---|---|---|
| **TRONCALES** | `SQVI Troncales` | Job ZJC PLAN TRONCALES, Step 1–6 | 07:55, 09:35–12:35 (horario), 13:35 (snapshot), 15:10 | Sí |
| **PEDIDOS DE VENTAS** | `Pedidos de Ventas (NV)` | Job ZJC PLAN ENTREGAS, Step 2–11 | 07:40, 11:10, 13:10, 14:40 | Sí |
| **ENTREGAS** | `Entregas` | Job ZJC PLAN ENTREGAS, Step 1 | 07:15, 12:30, 15:00 | Sí |
| **DOC TRANSPORTE** | `Doc Transporte (DT)` | Job ZJC PLAN DT, Step 1 | 08:10, 16:30, 22:30 | Sí |
| **SLIM** | `Plan Troncales (SLIM)` | "Reporte Stock Sucursales" (.xlsx) | 06:30 | Sí (solo correo de hoy) |

La corrida de las **13:35** (TRONCALES) guarda la foto del día en `trc_hist` (7 días). El barrido no hace snapshot.

**Triggers del proyecto: 20 de 20** (16 de `Code.gs` + 3 de `CorreoPlanCarga.gs` + 1 de `NivelServicioRevex.gs`). No quedan cupos: para agregar un trigger hay que consolidar otro.

## Supabase

- **`trc_live`** — datos vigentes, se pisa por fuente en cada carga.
- **`trc_hist`** — foto diaria 13:35, 7 días.
- **`trc_log`** — bitácora: `ok` / `sin_correo` / `error` (histórico: `ok_manual`, `sin_cambio_manual` del fallback Drive ya desactivado).

## Actualizar el Apps Script

1. Abrir el proyecto → `Código.gs` → pegar el `Code.gs` de esta carpeta → Guardar.
2. Si cambian horarios: ejecutar **`crearTriggers`** (borra y recrea los 16 triggers de este archivo; no toca los de `CorreoPlanCarga.gs` ni `NivelServicioRevex.gs`).
3. Revisar **Registro de ejecución**.

**Ojo en el editor:** al elegir la función en el desplegable, confirmar que quedó seleccionada antes de pulsar Ejecutar (a veces ejecuta la función anterior).

## Probar manualmente (ignoran día hábil)

- `probar_ahora_troncales`, `probar_ahora_troncales_snapshot`
- `probar_ahora_pedidosventas`, `probar_ahora_entregas`, `probar_ahora_doctransporte`, `probar_ahora_slim`

Para reprocesar un correo: marcarlo **no leído** en Gmail y correr la función del bloque (o esperar el barrido).

## Diagnóstico

- `trc_log` ordenado por `cargado_en desc`.
- `sin_correo` = no había correo SAP no leído en la etiqueta a esa hora (normal si SAP aún no envía; el barrido lo recoge después).
