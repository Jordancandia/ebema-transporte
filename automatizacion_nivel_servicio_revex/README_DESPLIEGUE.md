# Correo diario "NIVEL DE SERVICIO REVEX - [Fecha Envío]"

**Actualizado 2026-09-20.** Estado: **listo para desplegar en modo PRUEBA** (solo envía a jcandia@ebema.cl hasta que se cambie `NSR_MODO_PRUEBA`).

## Qué envía
Lunes a viernes 09:15 (America/Santiago), después de la carga de Flete Tercero (08:25) y el refresh de Indicadores (08:30). Asunto: `NIVEL DE SERVICIO REVEX - dd-mm-yyyy`. Sin sección de análisis.

1. Cuadro Nivel de Servicio por Tipo de Servicio.
2. Cuadro Nivel de Servicio por Centro Destino (+ columnas vencidos / en curso por destino).
3. Gráfico evolutivo mensual OTIF y Fill Rate (imagen inline, Charts de Apps Script) + tabla de valores.
4. Cuadro Pedidos Vencidos No Regularizados por Centro Responsable (antigüedad 0-5 / 6-20 / 21-60 / >60 días hábiles) + **CSV adjunto** `Pedidos_Vencidos_yyyy-mm-dd.csv`.
5. Cuadro Pedidos en Curso por Centro Destino y Estado (+ vencen ≤1 día háb.) + **CSV adjunto** `Pedidos_en_Curso_yyyy-mm-dd.csv`.

## Reglas (fuente única: vistas `v_ft_*` en Supabase PRD)
- **OTIF / Fill Rate.** Retira (CLI-RET) cierra en **Recepción Sucursal** (material disponible en sucursal). Despacho cierra en Entrega Cliente. OTIF = evento ≤ Fecha Promesa y bultos evento ≥ solicitados. Evaluable = evento cumplido o vencido sin cumplir.
- **Pendientes (gestión).** Falta alguna etapa hasta la **Entrega Cliente, también en Retira**: un pedido Retira que ya está en sucursal sin entrega al cliente sigue pendiente (estado "Listo para Retiro en Sucursal"), aunque su OTIF ya esté cerrado.
- **Vencido** = hoy > promesa con etapa pendiente · **En curso** = hoy ≤ promesa con etapa pendiente.
- **Centro responsable:** 1003 si falta Recepción CD/Traslado; si no, el centro destino (incluye retiros esperando al cliente).
- Días hábiles = lunes a viernes, sin feriados. Cifras por línea de pedido (564 líneas = 499 pedidos únicos).
- Datos al 20-09: **72 vencidos** y **15 en curso** (idéntico al Excel).

## Destinatarios (modo real)
Los 11 responsables de la hoja `Usuarios` + jcandia + portuzar, ngalvez, distribucion y logsant (@ebema.cl). Un solo correo, misma información para todos.

## Despliegue
1. **Supabase (ya aplicado en PRD):** migraciones `flete_tercero_ns_revex_base_views`, `flete_tercero_src_ind_mes_regla_retira` y `flete_tercero_pendientes_hasta_entrega_cliente`. `migracion_flete_tercero_ns_revex.sql` es la documentación consolidada.
2. **Apps Script:** en el proyecto donde ya corre la automatización, crear archivo `NivelServicioRevex.gs` y pegar `Code.gs` (todo con prefijo `nsr`, sin choque de nombres; usa `SUPABASE_SERVICE_KEY` ya cargada).
3. Ejecutar **`probar_nivel_servicio_revex`** → correo de prueba a jcandia@ebema.cl (autorizar Gmail/Charts si lo pide). Revisar formato, gráfico y CSV.
4. Si está OK: `NSR_MODO_PRUEBA = false` y ejecutar **`crearTriggerNivelServicioRevex`** una vez.
5. Web: correr `DESPLEGAR_ABASTECIMIENTO.bat` para publicar Flete Tercero → Pedidos Vencidos / Pedidos en Curso y la regla Retira en Nivel de Servicio.

## Nota sobre la hora
Apps Script no permite disparar a un minuto exacto: el trigger `nearMinute(15)` corre dentro de ±15 minutos de las 09:15 (entre 09:00 y 09:30). Como los datos terminan de cargarse a las 08:30, no afecta el contenido.
