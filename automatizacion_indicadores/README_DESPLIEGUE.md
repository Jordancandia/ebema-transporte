# Automatización INDICADORES → Supabase

Carga diaria **08:00 (America/Santiago)** de las 4 fuentes a Supabase PRD (`humhokvdowfqicjopbhf`), **pisando** las tablas `ind_*` (sin histórico).

## Fuentes → tablas
| Fuente | Origen | Tabla |
|---|---|---|
| OTIF | Drive `1BVc5cdBi-kHw2wkyHxYasjcFFYaCsMAf` | `ind_otif` |
| FLETE 360 (pagado) | Drive `1O_BTtVN8Ee9EiW5-mTjoRBo9b_SZP83L` | `ind_flete_pagado` |
| FLETE COBRADO | Drive `1qAZ7cZHq0TbfdB7-j-xW5jffNO9QkiBB` | `ind_flete_cobrado` |
| Detalle Flete Tercero | Gmail label "Indicadores Transporte" | `ind_flete_tercero` |

## Despliegue (una vez)
1. Crear proyecto en https://script.google.com (cuenta **jcandia@ebema.cl**), pegar `Code.gs`.
2. **Configuración del proyecto → Zona horaria = America/Santiago**.
3. **Servicios (+) → Drive API** (servicio avanzado, `Drive`) habilitado. Necesario para convertir xlsx → Sheet.
4. **Configuración del proyecto → Propiedades del script →** agregar `SUPABASE_SERVICE_KEY` = *service_role key* del proyecto PRD (la misma que usa troncales).
5. Ejecutar `probar_ahora` una vez (autoriza permisos Gmail/Drive/UrlFetch) y revisar el Log y la tabla `ind_log`.
6. Ejecutar `crearTriggers` una vez → crea el disparador diario 08:00.

## Notas
- **Overwrite**: cada corrida borra la tabla (`id=gt.0`) y reinserta. Sin snapshot.
- **Centro de expedición**: la fusión 1003→1000 se hace en las vistas SQL (`fn_ind_centro`), no en la carga.
- **Runtime**: FLETE PAGADO es la fuente más grande (~65k filas). Si la corrida única supera los 6 min de Apps Script, dividir en triggers escalonados usando los entrypoints individuales: `cargar_otif`, `cargar_flete_pagado`, `cargar_flete_cobrado`, `cargar_flete_tercero`.
- **Flete Tercero**: toma el correo más reciente de la etiqueta con adjunto `.xlsx` (no marca leído; siempre relee el último).
- Diagnóstico: `select * from ind_log order by loaded_at desc;`
