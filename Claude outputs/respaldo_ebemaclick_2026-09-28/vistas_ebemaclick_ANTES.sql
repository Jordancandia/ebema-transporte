-- Respaldo 28-sep-2026 (antes del cambio de regla EbemaClick)
CREATE MATERIALIZED VIEW private.v_ind_ebemaclick_mes AS
 WITH entregas_vg AS (SELECT DISTINCT entrega FROM ind_flete_cobrado WHERE vendedor = 'V Garrido T' AND entrega IS NOT NULL),
 docs_vg AS (SELECT DISTINCT documento_transporte AS doc FROM ind_flete_pagado WHERE entrega IN (SELECT entrega FROM entregas_vg) AND documento_transporte IS NOT NULL),
 docs_ebema AS (SELECT DISTINCT documento_transporte AS doc FROM ind_flete_pagado WHERE documento_transporte IN (SELECT doc FROM docs_vg) AND TRIM(id_material) = '400141')
 SELECT to_char(fecha_transporte::timestamp, 'YYYY-MM') AS mes_label, count(DISTINCT entrega) AS entregas, count(DISTINCT documento_transporte) AS docs,
   round(sum(ton), 2) AS toneladas, sum(flete) AS pagado
 FROM ind_flete_pagado fp
 WHERE documento_transporte IN (SELECT doc FROM docs_ebema) AND (entrega IN (SELECT entrega FROM entregas_vg) OR TRIM(id_material) = '400141')
 GROUP BY 1;

CREATE MATERIALIZED VIEW private.v_ind_ebemaclick_grupo_mes AS
 WITH docs AS (
   SELECT documento_transporte AS d FROM ind_flete_cobrado WHERE vendedor = 'V Garrido T' AND documento_transporte IS NOT NULL
   INTERSECT
   SELECT documento_transporte FROM ind_flete_cobrado WHERE TRIM(cod_material) = '400141' AND documento_transporte IS NOT NULL)
 SELECT COALESCE(lc.origen_grupo, 'OTROS') AS grupo, to_char(fc.fecha_transporte::timestamptz, 'YYYY-MM') AS mes_label,
   count(DISTINCT fc.documento_transporte) AS docs, round(sum(fc.peso_kg) / 1000.0, 2) AS toneladas,
   sum(fc.flete_pagado) AS pagado, sum(fc.flete_cobrado) AS cobrado
 FROM ind_flete_cobrado fc LEFT JOIN logistics_centres lc ON lc.id = TRIM(fc.id_expedicion)
 WHERE fc.documento_transporte IN (SELECT d FROM docs)
 GROUP BY 1, 2;

CREATE VIEW public.v_ind_ebemaclick_mes AS SELECT mes_label, entregas, docs, toneladas, pagado FROM private.v_ind_ebemaclick_mes
 WHERE (SELECT app_role()) = ANY (ARRAY['OWNER','PLANNER_OPERACIONES']);
CREATE VIEW public.v_ind_ebemaclick_grupo_mes AS SELECT grupo, mes_label, docs, toneladas, pagado, cobrado FROM private.v_ind_ebemaclick_grupo_mes
 WHERE (SELECT app_role()) = ANY (ARRAY['OWNER','PLANNER_OPERACIONES']) OR ((SELECT app_role()) = 'ADMINISTRADOR_DEPOSITO' AND grupo IN (SELECT unnest(app_grupos())));
GRANT SELECT ON public.v_ind_ebemaclick_mes, public.v_ind_ebemaclick_grupo_mes TO authenticated;
