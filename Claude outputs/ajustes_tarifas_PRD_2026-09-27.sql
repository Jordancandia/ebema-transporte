-- Ajustes Opción A — Rutas / Tarifas Transporte / Tarifas Clientes (27-sep-2026)
-- Ejecutar en Supabase PRD (humhokvdowfqicjopbhf) > SQL Editor
begin;

-- 1) Centro Origen en rutas (hoy NULL en las 2.531)
update routes r set origen_grupo = c.origen_grupo, updated_at = now(), updated_by = 'jcandia@ebema.cl'
  from logistics_centres c where c.id = r."origenId" and r.origen_grupo is null;

-- 2) Desactivar rutas a Isla de Pascua / Juan Fernández / Antártica (km = 0)
update routes set activo = false, updated_at = now(), updated_by = 'jcandia@ebema.cl'
 where activo and coalesce(km,0) = 0
   and (destino ilike '%ISLA DE PASCUA%' or destino ilike '%JUAN FERNANDEZ%' or destino ilike '%ANTARTICA%');

-- 3) Error de digitación en tarifa ajustada 1100 · Camión 5 Ton (1.625 -> 1625)
update truck_types set "rateAjustNorm" = 1625, updated_at = now(), updated_by = 'jcandia@ebema.cl'
 where id = '1100-5' and "rateAjustNorm" = 1.625;

-- 4) Recargo exclusividad en un solo formato (clave = nombre de Centro Origen)
update client_tariff_config
   set data = jsonb_set(data, '{especiales,recargoExclusividad}', '{"SANTIAGO":20,"CONCEPCION":20,"TALCA":20}'::jsonb),
       updated_at = now(), updated_by = 'jcandia@ebema.cl'
 where id = 'global';

commit;

-- Verificación
select (select count(*) from routes where origen_grupo is null)            as rutas_sin_grupo,
       (select count(*) from routes where activo and coalesce(km,0) = 0)    as activas_km0,
       (select "rateAjustNorm" from truck_types where id = '1100-5')        as ajust_1100_5,
       (select data->'especiales'->'recargoExclusividad' from client_tariff_config) as recargo;
