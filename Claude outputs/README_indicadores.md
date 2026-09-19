# Automatización INDICADORES → Supabase

**Actualizado 2026-09-18.** Carga de lunes a viernes (antes corría también sábado/domingo), terminando a las **08:30** (America/Santiago), pisando las tablas `ind_*` en Supabase PRD (`humhokvdowfqicjopbhf`), sin histórico.

## Por qué no es una sola corrida exacta a las 08:30

El 14-sep-2026 hubo un incidente: cargar las 4 fuentes en una sola ejecución cortaba `ind_flete_pagado` (~70-78k filas, la más grande) por el límite de tiempo de Apps Script, dejando el indicador con datos truncados **sin marcar error** (ver bitácora del proyecto). Por eso se mantiene el escalonamiento interno, ahora comprimido para terminar justo a las 08:30:

| Hora | Función | Fuente |
|---|---|---|
| 08:10 | `cargar_otif` | Drive `OTIF.xlsx` → `ind_otif` |
| 08:15 | `cargar_flete_cobrado` | Drive `FLETE COBRADO.xlsx` → `ind_flete_cobrado` |
| 08:20 | `cargar_flete_pagado` | Drive `FLETE 360.xlsx` → `ind_flete_pagado` |
| 08:25 | `cargar_flete_tercero` | Gmail label **"Indicadores Transporte"** → `ind_flete_tercero` |
| 08:30 | `ejecutar_refresh_indicadores` | Refresca todas las vistas `v_ind_*` |

Cada función valida `esDiaHabil()` (lunes a viernes) antes de correr.

## Cambio importante: Flete Tercero ahora marca el correo como leído

Antes, `leerGmailXlsx` siempre releía el correo más reciente de la etiqueta "Indicadores Transporte" sin importar si estaba leído o no. Ahora (`cargarFleteTercero`): busca primero un correo **no leído**; si no hay ninguno, cae al más reciente en general (para no dejar de actualizar si por algún motivo ya estaba leído). Al cargar con éxito, **marca el correo como leído**.

## Despliegue (una vez)

1. Entra a **script.google.com** → abre el proyecto de Indicadores ya existente (cuenta `jcandia@ebema.cl`).
2. Borra el contenido de `Code.gs` y pega el **`Code.gs`** nuevo (este mismo folder).
3. Guarda.
4. Ejecuta **`crearTriggers`** una sola vez → borra los 5 triggers antiguos (07:40-08:15) y crea los 5 nuevos (08:10-08:30, tabla de arriba).
5. Revisa **Registros de ejecución** y la tabla `ind_log` tras la primera corrida automática.

No hace falta volver a habilitar Drive API ni recargar `SUPABASE_SERVICE_KEY`.

## Notas (sin cambios respecto a la versión anterior)

- **Overwrite**: cada corrida borra la tabla (`id=gt.0`) y reinserta.
- **Centro de expedición**: la fusión 1003→1000 se hace en las vistas SQL (`fn_ind_centro`), no en la carga.
- Diagnóstico: `select * from ind_log order by loaded_at desc;`
- Corrida manual completa (todas las fuentes + refresh, ignora el día hábil): función `probar_ahora`.
