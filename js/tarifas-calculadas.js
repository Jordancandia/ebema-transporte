// ============================================================================
// TARIFAS CALCULADAS GUARDADAS (8-nov-2026, Jordan)
// ----------------------------------------------------------------------------
// Cada vez que se fija una tarifa vigente (manual o automática) se guardan en BD
// las tarifas resultantes de esa foto, ruta × camión:
//   · public.tarifas_clientes_calculadas   ($/kg, mínima, máxima, kilos mínimos, express)
//   · public.tarifas_transporte_calculadas (ZCAP vigente, calculado, manual y componentes)
// Cálculo: EXACTAMENTE el de Tarifas Clientes / Variación Tarifa (sin fórmula propia):
//   escenarioVigente(db, vig) → buildZcapMap(…, { incluir2t: true }) → calcTarifasEscenario(…)
// Carga (8-nov-2026, sólo cambios): el cálculo completo va en lotes de 1.000 a las tablas
// de paso (tarifas_*_stage); la RPC activar_tarifas_calculadas compara contra lo vigente y,
// en una transacción, inserta sólo combinaciones nuevas o con valores distintos (las que se
// mantienen conservan su fila y fecha), da de baja las que ya no existen, deja máx. 2
// versiones anteriores por combinación y vacía la tabla de paso. Si algo falla,
// descartar_lote_tarifas borra lo parcial y lo vigente queda intacto.
// Vistas de lectura: v_tarifas_clientes_vigentes · v_tarifas_transporte_vigentes
// ============================================================================
import { supabase } from './supabase-client.js?v=202611101631';
import { getTariffConfig, getClientTariffConfig, truckCapKg } from './data.js?v=202611101631';
import { buildZcapMap, componentesRegional } from './zcap.js?v=202611101631';
import { calcTarifasEscenario } from './tarifas-clientes-v2.js?v=202611101631';
import { contextoTarifasClientes } from './tarifas-clientes.js?v=202611101631';
import { escenarioVigente } from './tarifa-vigente.js?v=202611101631';
import { clasifTarifa } from './tarifas-ui.js?v=202611101631';

const LOTE_FILAS = 1000;
const n = v => (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v);
const t = v => (v == null || v === '') ? null : String(v);
const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s+/-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());

// Filas (sin insertar) de una tarifa vigente: { clientes, transporte }
export function calcularFilas(db, vig) {
  const dbV = escenarioVigente(db, vig);
  const cfgV = getTariffConfig(dbV);
  const zV = buildZcapMap(dbV, cfgV, { incluir2t: true });
  const ctx = contextoTarifasClientes();
  const ccV = getClientTariffConfig(dbV);
  ctx.ensureCcfg(ccV);
  const cli = calcTarifasEscenario({ ...ctx, db: dbV, cfg: cfgV, ccfg: ccV }, ccV, zV);
  const tron = new Set(cfgV.variables?.troncalesRoutes || []);
  const comunes = ruta => ({
    centro_id: t(ruta.origenId), ruta_id: t(ruta.id), destino: t(ruta.destino),
    comuna: t(ruta.comuna || ruta.destino), clasificacion: t(titulo(ruta.tipo)), ambito: t(ruta.clasificRuta), km: n(ruta.km),
  });
  const clientes = cli.map(r => ({
    ...comunes(r.ruta),
    centro_origen: t(r.grupo), codigo_ruta: t(r.cod), tipo: t(r.clasif),
    cluster: t(r.clusterOp), cluster_key: t(r.clusterKey),
    tipo_camion: t(r.truck?.type), cap_kg: n(r.capKg), costo_ruta: n(r.zcap),
    tarifa_kg: n(r.zfmp), tarifa_kg_centro: n(r.kgCentro), tarifa_minima: n(r.zfmi), tarifa_maxima: n(r.zfmx),
    kilos_minimos: n(r.kilosTarifMin), tarifa_express: n(r.express),
    factor_consol_pct: n(r.factorPct), kilos_consolidar: n(r.kilos), camion_minimo: t(r.camionMin === '—' ? null : r.camionMin),
    recargo_express_pct: n(r.recargo), es_2t: !!r.es2t,
  }));
  const transporte = [];
  zV.forEach(v => {
    const { ruta, truck } = v;
    const troncal = tron.has(ruta.codigo);
    const regional = !troncal && ruta.clasificRuta === 'Regional';
    const k = regional ? componentesRegional(ruta, truck) : null;
    transporte.push({
      ...comunes(ruta),
      centro_origen: t(ruta.origen_grupo), codigo_ruta: t(ruta.codigo || ruta.id), tipo: t(clasifTarifa(ruta, tron)),
      caracteristica: t(ruta.caracteristica), tipo_camion: t(truck?.type), cap_kg: n(truckCapKg(truck?.type)),
      zcap: n(v.zcap), zcap_calculado: n(v.zcapCalculado), zcap_manual: !!v.manual, troncal,
      km_base: k ? n(k.a) : null, costo_base: k ? n(k.b) : null, t_base_km: k ? n(k.c) : null, tarifa_km: k ? n(k.rate) : null,
      tarifa_especial: k ? !!k.especial : null,
    });
  });
  return { clientes, transporte };
}

async function insertarLotes(tabla, filas, base) {
  for (let i = 0; i < filas.length; i += LOTE_FILAS) {
    const { error } = await supabase.from(tabla).insert(filas.slice(i, i + LOTE_FILAS).map(f => ({ ...base, ...f })));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

// Calcula, guarda y activa las tarifas de una fijación. Devuelve { clientes, transporte }.
export async function guardarTarifasCalculadas(db, vig) {
  if (!vig || !vig.id) throw new Error('Sin tarifa vigente');
  const { clientes, transporte } = calcularFilas(db, vig);
  if (!clientes.length || !transporte.length) throw new Error(`Cálculo vacío (clientes ${clientes.length}, transporte ${transporte.length})`);
  const lote = crypto.randomUUID();
  const base = { tarifa_vigente_id: vig.id, lote, fijada_by: vig.fijada_by || null, vigente: false };
  try {
    await insertarLotes('tarifas_clientes_stage', clientes, base);
    await insertarLotes('tarifas_transporte_stage', transporte, base);
    const { data, error } = await supabase.rpc('activar_tarifas_calculadas', { p_tarifa_vigente_id: vig.id, p_lote: lote });
    if (error) throw new Error(error.message);
    _info = undefined;
    return data;
  } catch (e) {
    try { await supabase.rpc('descartar_lote_tarifas', { p_lote: lote }); } catch (_e) { /* best effort */ }
    throw e;
  }
}

// Última fijación con tarifas guardadas: { tarifa_vigente_id, fecha_actualizacion, fijada_by, cambios } | null
let _info;
export async function infoGuardadas(force = false) {
  if (!force && _info !== undefined) return _info;
  const { data, error } = await supabase.from('tarifa_vigente')
    .select('id, calculadas_at, fijada_by, calc_cambios').not('calculadas_at', 'is', null)
    .order('id', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const r = data && data[0];
  _info = r ? { tarifa_vigente_id: r.id, fecha_actualizacion: r.calculadas_at, fijada_by: r.fijada_by, cambios: r.calc_cambios } : null;
  return _info;
}

// Todas las filas vigentes de una vista (paginado de a 1.000)
export async function leerVigentes(vista = 'v_tarifas_clientes_vigentes') {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from(vista).select('*').order('id').range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
