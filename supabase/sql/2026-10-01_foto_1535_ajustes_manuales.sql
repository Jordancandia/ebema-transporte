-- SIT EBEMA · 1-oct-2026 · Foto 15:35 respeta los ajustes manuales del Plan de Carga
-- Ejecutar en Supabase PRD (humhokvdowfqicjopbhf) → SQL Editor → Run.
-- Igual a la función actual + líneas asignadas a mano (abast_plan_linea_camion):
--   1 = camión CD, 2 = 2º camión, 0 = no carga. El 2º camión también se propone si hay líneas asignadas a él.
CREATE OR REPLACE FUNCTION public.fn_abast_snapshot_plan_carga()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  ahora timestamp := now() at time zone 'America/Santiago';
  hoy date := ahora::date;
  es_cierre boolean := ahora::time >= time '15:35';
  n int;
  rw record;
  k text;
  acc numeric;
begin
  if exists (select 1 from abast_plan_carga_snapshot where fecha = hoy and tipo_foto = 'cierre') then
    return 0;
  end if;

  drop table if exists _pc;
  drop table if exists _pc2;
  create temp table _pc on commit drop as
  with det as (
    select '1003'::text cd_origen, ce, categoria, trim(documento) documento, trim(material) material, nombre, cantidad, ton, ton_bruto, ton_vol, pedido_venta, entrega_entrante, prio_orden
      from v_trc_plan_carga_1003_detalle where coalesce(trim(material), '') <> ''
    union all
    select '1081', ce, categoria, trim(documento), trim(material), nombre, cantidad, ton, ton_bruto, ton_vol, pedido_venta, entrega_entrante, prio_orden
      from v_trc_plan_carga_1081_detalle where coalesce(trim(material), '') <> ''
  ),
  exc as (
    select tipo, trim(doc) doc, coalesce(trim(material), '') material
      from abast_plan_exclusiones where (created_at at time zone 'America/Santiago')::date = hoy
  ),
  vig as (
    select d.*, case when d.prio_orden = -100 then 5 else case d.categoria when 'REVEX' then 1 when 'Venta Directa' then 2 when 'Retiro CD' then 3
                                 when 'Crossdocking' then 4 when 'Quiebre' then 5 when 'Abastecimiento' then 6 end end ord
      from det d
     where not exists (
       select 1 from exc e
        where e.tipo = case d.categoria when 'REVEX' then 'traslados_revex' when 'Venta Directa' then 'venta_1003' when 'CD-Cliente' then 'venta_1003'
                                        when 'Crossdocking' then 'crossdock_4000' when 'Quiebre' then 'traslados_1003' when 'Abastecimiento' then 'traslados_1003'
                                        else 'retiro_fabrica' end
          and e.doc = d.documento and (e.material = '' or e.material = d.material))
  ),
  res as (
    select '1003'::text cd, ce, cap, coalesce(horizonte_efectivo, 24)::int hz from v_trc_plan_carga_1003
    union all
    select '1081', ce, cap, coalesce(horizonte_efectivo, 24)::int from v_trc_plan_carga_1081
  )
  select v.*, r.cap, r.hz,
         sum(case when v.ord is not null then coalesce(v.ton, 0) else 0 end) over (partition by v.cd_origen, v.ce) tot,
         row_number() over (order by v.cd_origen, v.ce, v.ord nulls last, v.prio_orden nulls last, v.documento, v.material) rid,
         null::smallint camion,
         case when v.ord is not null then lc.camion end forz
    from vig v join res r on r.cd = v.cd_origen and r.ce = v.ce
    left join abast_plan_linea_camion lc on lc.fecha = hoy and lc.cd_origen = v.cd_origen and lc.ce = v.ce
                                         and lc.documento = v.documento and lc.material = v.material;
  create index on _pc (rid);

  update _pc set camion = 1 where forz = 1;
  k := null;
  for rw in select p.rid, p.cd_origen || '|' || p.ce kk, coalesce(p.ton, 0) ton, p.cap,
                   (select coalesce(sum(coalesce(z.ton, 0)), 0) from _pc z where z.cd_origen = p.cd_origen and z.ce = p.ce and z.forz = 1) base
              from _pc p where p.ord is not null and p.forz is null order by p.rid loop
    if k is distinct from rw.kk then k := rw.kk; acc := rw.base; end if;
    if acc + rw.ton <= rw.cap + 1e-9 then acc := acc + rw.ton; update _pc set camion = 1 where rid = rw.rid; end if;
  end loop;

  create temp table _pc2 on commit drop as
    select cd_origen, ce, max(cap) cap,
           coalesce(sum(coalesce(ton, 0)) filter (where camion is null and coalesce(forz, 2) = 2), 0) excedente,
           coalesce(bool_or(forz = 2), false) manual2
      from _pc where ord is not null group by cd_origen, ce;
  update _pc set camion = 2 where forz = 2;
  k := null;
  for rw in select p.rid, p.cd_origen || '|' || p.ce kk, coalesce(p.ton, 0) ton, p.cap,
                   (select coalesce(sum(coalesce(z.ton, 0)), 0) from _pc z where z.cd_origen = p.cd_origen and z.ce = p.ce and z.forz = 2) base
              from _pc p join _pc2 q on q.cd_origen = p.cd_origen and q.ce = p.ce
             where p.ord is not null and p.camion is null and p.forz is null
               and (q.excedente >= q.cap * 0.85 or q.manual2)
             order by p.rid loop
    if k is distinct from rw.kk then k := rw.kk; acc := rw.base; end if;
    if acc + rw.ton <= rw.cap + 1e-9 then acc := acc + rw.ton; update _pc set camion = 2 where rid = rw.rid; end if;
  end loop;

  delete from abast_plan_carga_snapshot where fecha = hoy;

  insert into abast_plan_carga_snapshot(fecha, cd_origen, ce, categoria, documento, material, nombre, cantidad, ton, ton_bruto, ton_vol,
         pedido_venta, entrega_entrante, tipo_foto, cap, total_cd, pct_camion, estado_sucursal, en_camion, horizonte, dia_objetivo,
         camion, segundo_propuesto, segundo_aceptado, medido, prio_orden)
  select hoy, p.cd_origen, p.ce, p.categoria, p.documento, p.material, p.nombre, p.cantidad, p.ton, p.ton_bruto, p.ton_vol, p.pedido_venta, p.entrega_entrante,
         case when es_cierre then 'cierre' else 'provisional' end,
         p.cap, round(p.tot, 4),
         round(p.tot / nullif(p.cap, 0) * 100)::int,
         x.estado,
         case when p.ord is null then null else coalesce(p.camion = 1, false) end,
         p.hz,
         trc_sumar_habiles(hoy, case when p.hz = 48 then 2 else 1 end),
         p.camion,
         coalesce(q.excedente >= q.cap * 0.85 or q.manual2, false),
         a.ce is not null,
         case when p.ord is null then true
              when p.camion = 1 then x.estado = 'PROGRAMAR'
              when p.camion = 2 then a.ce is not null
              else false end,
         p.prio_orden
    from _pc p
    left join _pc2 q on q.cd_origen = p.cd_origen and q.ce = p.ce
    left join abast_plan_segundo_camion a on a.fecha = hoy and a.cd_origen = p.cd_origen and a.ce = p.ce
    cross join lateral (select case when round(p.tot / nullif(p.cap, 0) * 100) >= 80 then 'PROGRAMAR'
                                    when round(p.tot / nullif(p.cap, 0) * 100) >= 70 then 'REVISAR'
                                    else 'CARGA INSUFICIENTE' end estado) x;
  get diagnostics n = row_count;
  perform fn_abast_refrescar_pesos();
  return n;
end $function$;
