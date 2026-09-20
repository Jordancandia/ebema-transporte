-- ============================================================================
--  FLETE TERCERO — Nivel de Servicio REVEX  (regla Retira + Vencidos + En Curso)
--  Fuente única server-side de la lógica (la usa el correo diario de Apps Script
--  y el refresh de Indicadores > Consolidado). La vista web (js/flete-tercero.js)
--  replica la MISMA lógica client-side (verificada contra estas vistas).
--
--  Reglas:
--   * Evento de cumplimiento:
--       Retira (condicion ~ 'RET')  -> Fecha/Bultos Recepción Sucursal (material
--                                      disponible en sucursal; el retiro depende del cliente)
--       Despacho                    -> Fecha/Bultos Entrega Cliente
--   * OTIF = evento <= Fecha Promesa (Disponible Material) Y bultos evento >= solicitados.
--   * Fill Rate = bultos evento / solicitados (tope 100%).
--   * Evaluable = tiene evento, o (sin evento y vencido: hoy > promesa) -> cuenta OTIF=0.
--   * Pendiente (GESTIÓN) = falta alguna etapa física hasta la Entrega Cliente, también en Retira:
--       Recepción CD, Traslado, Recepción Sucursal, Entrega Cliente.
--       (El OTIF de Retira sí cierra en sucursal; para gestión el pedido sigue pendiente hasta que el cliente retira.)
--   * Vencido regularizable = hoy > promesa y pendiente | En curso = hoy <= promesa y pendiente.
--   * Centro responsable de cierre: '1003' (CD) si falta Recepción CD/Traslado; si no, el centro destino.
--   * Días hábiles = lunes a viernes (sin feriados, igual que el Excel/plataforma).
-- ============================================================================

create or replace function public.fn_ft_bdays(d1 date, d2 date)
returns integer
language sql immutable parallel safe
as $$
  -- Equivale a MAX(NETWORKDAYS(d1,d2)-1,0) cuando d1 es día hábil: días hábiles en (d1, d2]
  select case
    when d1 is null or d2 is null then null
    when d2 <= d1 then 0
    else (select count(*)::int from generate_series(d1 + 1, d2, interval '1 day') g
          where extract(isodow from g) < 6)
  end
$$;

create or replace function public.fn_ft_hoy()
returns date
language sql stable
as $$ select (now() at time zone 'America/Santiago')::date $$;

create or replace view public.v_ft_base
with (security_invoker = true) as
with b as (
  select
    ift.id, ift.id_pedido, ift.condicion_expedicion, ift.punto_expedicion, ift.ruta_flete,
    ift.material, ift.cantidad_bultos,
    ift.fecha_creacion, ift.fecha_disponible_material as fecha_promesa,
    ift.fecha_recep_cd, ift.fecha_traslado, ift.fecha_recep_sucursal, ift.fecha_entrega_cliente,
    coalesce(ift.bultos_recep_sucursal, 0) as bultos_rsuc, coalesce(ift.bultos_entrega_cliente, 0) as bultos_ent,
    (ift.condicion_expedicion ~* 'RET') as es_retiro,
    public.fn_ft_hoy() as hoy
  from public.ind_flete_tercero ift
), e as (
  select b.*,
    case when es_retiro then fecha_recep_sucursal else fecha_entrega_cliente end as fecha_evento,
    case when es_retiro then bultos_rsuc else bultos_ent end as bultos_evento
  from b
), c as (
  select e.*,
    (fecha_evento is not null) as entregado,
    (fecha_evento is null and hoy > fecha_promesa) as vencido_sin_entregar,
    (fecha_evento is not null or (fecha_evento is null and hoy > fecha_promesa)) as evaluable,
    (fecha_evento is not null and fecha_evento <= fecha_promesa) as on_time,
    (cantidad_bultos > 0 and bultos_evento >= cantidad_bultos) as in_full,
    case when cantidad_bultos > 0 then least(bultos_evento / cantidad_bultos, 1) end as fill_ratio,
    (fecha_recep_cd is null) as pend_rcd,
    (fecha_traslado is null) as pend_tras,
    (fecha_recep_sucursal is null) as pend_rsuc,
    (fecha_entrega_cliente is null) as pend_ent
  from e
), d as (
  select c.*,
    (pend_rcd or pend_tras or pend_rsuc or pend_ent) as pendiente
  from c
)
select
  id, id_pedido, condicion_expedicion, punto_expedicion, ruta_flete, material, cantidad_bultos,
  fecha_creacion, fecha_promesa, fecha_recep_cd, fecha_traslado, fecha_recep_sucursal, fecha_entrega_cliente,
  es_retiro,
  case when es_retiro then 'Retira' else 'Despacha' end as modalidad,
  to_char(fecha_creacion, 'YYYY-MM') as mes,
  fecha_evento, bultos_evento, entregado, vencido_sin_entregar, evaluable, on_time, in_full, fill_ratio,
  case when evaluable then (case when on_time and in_full then 1 else 0 end) end as otif,
  case when evaluable then fill_ratio end as fill_eval,
  pend_rcd, pend_tras, pend_rsuc, pend_ent, pendiente,
  (pendiente and hoy > fecha_promesa)  as vencido_pendiente,
  (pendiente and hoy <= fecha_promesa) as en_curso,
  case when pend_rcd or pend_tras then '1003' else punto_expedicion end as centro_responsable,
  concat_ws(' + ',
     case when pend_rcd  then 'Recepción CD' end,
     case when pend_tras then 'Traslado' end,
     case when pend_rsuc then 'Recepción Sucursal' end,
     case when pend_ent  then 'Entrega Cliente' end) as etapas_pendientes,
  case when pendiente and hoy > fecha_promesa  then public.fn_ft_bdays(fecha_promesa, hoy) end as dias_atraso_habiles,
  case when pendiente and hoy <= fecha_promesa then public.fn_ft_bdays(hoy, fecha_promesa) end as dias_habiles_para_vencer,
  case
    when fecha_entrega_cliente is not null then 'Entregado a Cliente'
    when fecha_recep_sucursal is not null then (case when es_retiro then 'Listo para Retiro en Sucursal' else 'En Bodega Destino' end)
    when fecha_traslado is not null then 'En Tránsito'
    when fecha_recep_cd is not null then 'Recepción en CD (sin traslado)'
    else 'Sin Recepción en CD'
  end as estado,
  -- días hábiles por etapa (para cuello de botella)
  public.fn_ft_bdays(fecha_creacion, fecha_recep_cd)            as d_cd,
  public.fn_ft_bdays(fecha_recep_cd, fecha_traslado)            as d_tras,
  public.fn_ft_bdays(fecha_traslado, fecha_recep_sucursal)      as d_suc,
  public.fn_ft_bdays(fecha_recep_sucursal, fecha_entrega_cliente) as d_ent,
  public.fn_ft_bdays(fecha_creacion, fecha_entrega_cliente)     as d_total,
  public.fn_ft_bdays(
     fecha_creacion + case extract(isodow from fecha_creacion)::int when 5 then 3 when 6 then 2 else 1 end,
     fecha_promesa)                                            as sla_ofrecido,
  hoy
from d;

comment on view public.v_ft_base is
 'Flete Tercero: cálculo por línea (regla Retira = Recepción Sucursal). Base de correo diario NIVEL DE SERVICIO REVEX y de v_ind_ftercero_mes.';

-- Agregados de nivel de servicio (sobre evaluables)
create or replace view public.v_ft_ns_tipo with (security_invoker = true) as
select condicion_expedicion as tipo_servicio,
       count(*) filter (where evaluable) as evaluables,
       round(100.0 * avg(otif) filter (where evaluable), 1) as otif_pct,
       round(100.0 * avg(fill_eval) filter (where evaluable), 1) as fill_pct
from public.v_ft_base group by 1;

create or replace view public.v_ft_ns_centro with (security_invoker = true) as
select punto_expedicion as centro,
       count(*) filter (where evaluable) as evaluables,
       round(100.0 * avg(otif) filter (where evaluable), 1) as otif_pct,
       round(100.0 * avg(fill_eval) filter (where evaluable), 1) as fill_pct
from public.v_ft_base group by 1;

create or replace view public.v_ft_ns_mes with (security_invoker = true) as
select mes,
       count(*) filter (where evaluable) as evaluables,
       round(100.0 * avg(otif) filter (where evaluable), 1) as otif_pct,
       round(100.0 * avg(fill_eval) filter (where evaluable), 1) as fill_pct
from public.v_ft_base group by 1;

create or replace view public.v_ft_ns_general with (security_invoker = true) as
select count(*) as pedidos_total,
       count(*) filter (where evaluable) as evaluables,
       count(*) filter (where not evaluable) as en_proceso,
       round(100.0 * avg(otif) filter (where evaluable), 1) as otif_pct,
       round(100.0 * avg(fill_eval) filter (where evaluable), 1) as fill_pct,
       max(hoy) as hoy
from public.v_ft_base;

create or replace view public.v_ft_cuello with (security_invoker = true) as
select coalesce(punto_expedicion, 'TODOS') as centro,
       count(*) as n,
       round(avg(d_cd), 2) as d_cd, round(avg(d_tras), 2) as d_tras,
       round(avg(d_suc), 2) as d_suc, round(avg(d_ent), 2) as d_ent,
       round(avg(d_total), 2) as lead_total, round(avg(sla_ofrecido), 2) as sla_ofrecido
from public.v_ft_base
group by grouping sets ((punto_expedicion), ());

-- Detalle Vencidos (regularizables) y En Curso — base de los cuadros y CSV del correo
create or replace view public.v_ft_vencidos with (security_invoker = true) as
select centro_responsable, id_pedido, punto_expedicion, condicion_expedicion, ruta_flete, material,
       cantidad_bultos, fecha_creacion, fecha_promesa, dias_atraso_habiles, estado, etapas_pendientes
from public.v_ft_base where vencido_pendiente;

create or replace view public.v_ft_en_curso with (security_invoker = true) as
select centro_responsable, id_pedido, punto_expedicion, condicion_expedicion, ruta_flete, material,
       cantidad_bultos, fecha_creacion, fecha_promesa, dias_habiles_para_vencer, estado, etapas_pendientes
from public.v_ft_base where en_curso;

grant select on public.v_ft_base, public.v_ft_ns_tipo, public.v_ft_ns_centro, public.v_ft_ns_mes,
                public.v_ft_ns_general, public.v_ft_cuello, public.v_ft_vencidos, public.v_ft_en_curso
  to authenticated, service_role;
revoke all on public.v_ft_base, public.v_ft_ns_tipo, public.v_ft_ns_centro, public.v_ft_ns_mes,
                public.v_ft_ns_general, public.v_ft_cuello, public.v_ft_vencidos, public.v_ft_en_curso
  from anon;


-- ============================================================================
--  Indicadores > Consolidado: la vista fuente de la matview usa la MISMA regla de OTIF
--  (Retira = Recepción Sucursal). Columnas idénticas -> CREATE OR REPLACE + REFRESH.
--  Resultado tras aplicar: OTIF Retira acumulado 58,0% (antes 26,1%), Despacho 49,6% (sin cambio).
-- ============================================================================
create or replace view public._src_v_ind_ftercero_mes as
select
  b.mes as mes_label,
  b.modalidad,
  count(*) as pedidos,
  round(100.0 * avg(case when b.evaluable then b.otif::numeric end), 1) as otif_pct,
  round(100.0 * avg(case when b.evaluable then b.fill_ratio end), 1) as fillrate_pct,
  round(avg(b.fecha_evento - b.fecha_creacion), 1) as ciclo_prom_dias,
  count(*) filter (where b.evaluable) as evaluables,
  count(*) filter (where b.evaluable and b.on_time and b.in_full) as otif_n,
  sum(case when b.evaluable then b.fill_ratio else 0::numeric end) as fill_sum
from public.v_ft_base b
group by b.mes, b.modalidad
order by b.mes, b.modalidad;

refresh materialized view private.v_ind_ftercero_mes;
