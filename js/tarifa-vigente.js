// ============================================================================
// TARIFA VIGENTE (25-oct-2026, Jordan) — base "actual" de la vista Variación Tarifa
// ----------------------------------------------------------------------------
// Tabla public.tarifa_vigente: cada fila es una foto de los INSUMOS de tarifas
// (truck_types, tariff_config, client_tariff_config, costos extras y peajes de
// las rutas troncales). La fila más reciente es la TARIFA VIGENTE; las anteriores
// quedan como historial.
//   · Si no hay ninguna foto, se registra sola (origen 'auto') al entrar a Tarifas
//     Transporte / Clientes y antes del primer ajuste en Tarifas por Camión, con
//     los valores previos al cambio.
//   · «Fijar como vigentes» (Variación Tarifa / aviso de Tarifas por Camión)
//     registra las tarifas actuales como nueva vigente (origen 'manual').
// El escenario "actual" se recalcula con los motores de siempre (ZCAP, $/Kg,
// Min/Max, Express) sobre las rutas e histórico de hoy, así la variación aísla
// el efecto del ajuste de tarifas.
// ============================================================================
import { supabase } from './supabase-client.js?v=202610252129';
import { getTariffConfig, getClientTariffConfig, truckCapKg, getOrigenGroups } from './data.js?v=202610252129';
import { can } from './permisos.js?v=202610252129';
import { usuarioSesion, esc, fmt } from './tarifas-ui.js?v=202610252129';
import { confirmar } from './confirmar.js?v=202610252129';
import { showAlert } from './utils.js';

const CAMPOS_TRUCK = ['id', 'Id_centro', 'type', 'capacityTons', 'Kmbase', 'baseKM', 'baseRate', 'rateAjustNorm', 'rateAjustEsp',
  'ratePerKm', 'ratePerKmExtrema', 'ratePerKmPond', 'ratePerKmExtrPond', 'updated_at', 'updated_by'];

// Parámetros de Tarifas por Camión que definen el ZCAP regional (a, b, c, tarifa km)
export const PARAMS_CAMION = [
  ['Kmbase', 'KM base', 'km'],
  ['baseKM', 'Costo base', '$'],
  ['baseRate', 'T. base KM', '$'],
  ['rateAjustNorm', 'Tarifa km', '$/km'],
  ['rateAjustEsp', 'Tarifa km especial', '$/km'],
];

// Valor efectivo con que el ZCAP regional usa cada parámetro (zcap.js · componentesRegional):
// tarifa km = ajustada o, si no hay, la del motor (ratePerKm / ratePerKmExtrema). Así los
// ponderados que recalcula el Motor de Costos no aparecen como ajustes de tarifa.
export function valorParam(t, campo) {
  if (!t) return null;
  if (campo === 'rateAjustNorm') return Number(t.rateAjustNorm) || Number(t.ratePerKm) || 0;
  if (campo === 'rateAjustEsp') return Number(t.rateAjustEsp) || Number(t.ratePerKmExtrema) || 0;
  return Number(t[campo]) || 0;
}

// Centros cuyos camiones definen tarifas (San Bernardo usa los de Santiago)
export function centrosTarifa(db) {
  const gs = getOrigenGroups(db);
  const hayStgo = gs.some(g => g.grupo === 'SANTIAGO');
  return new Set(gs.filter(g => !(hayStgo && g.grupo === 'SAN BERNARDO')).map(g => String(g.repId)));
}

let _vig;            // undefined = sin cargar · null = no existe · objeto = fila vigente
let _prom = null;
const _subs = new Set();

export function vigenteCache() { return _vig; }
// Avisa a las vistas abiertas cuando cambia la tarifa vigente
export function onVigente(fn) { _subs.add(fn); return () => _subs.delete(fn); }
function _emit() { _subs.forEach(fn => { try { fn(_vig); } catch (_e) { /* vista cerrada */ } }); }

// Lee la tarifa vigente (fila más reciente). Lanza error si la consulta falla
// (en ese caso NUNCA se registra una foto automática).
export async function cargarVigente(force = false) {
  if (!force && _vig !== undefined) return _vig;
  if (_prom) return _prom;
  _prom = (async () => {
    const { data, error } = await supabase.from('tarifa_vigente')
      .select('id, fijada_at, fijada_by, origen, nota, data').order('id', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    _vig = data && data[0] ? data[0] : null;
    _emit();
    return _vig;
  })();
  try { return await _prom; } finally { _prom = null; }
}

const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

// Foto de los insumos de tarifas tal como están ahora en memoria
export function capturarEstado(db) {
  const cfg = getTariffConfig(db), ccfg = getClientTariffConfig(db);
  // participacionRutas sólo alimenta los ponderados (ya guardados en truck_types); el histórico es dato, no tarifa
  const { participacionRutas: _p, ...tcfg } = cfg || {};
  const { historico: _h, histMeta: _m, ...ccf } = ccfg || {};
  const tronc = new Set(cfg?.variables?.troncalesRoutes || []);
  const idsTronc = new Set((db.routes || []).filter(r => tronc.has(r.codigo)).map(r => r.id));
  return JSON.parse(JSON.stringify({
    truckTypes: (db.truckTypes || []).map(t => pick(t, CAMPOS_TRUCK)),
    tariffCfg: tcfg,
    clientCfg: ccf,
    extraCosts: db.extraCosts || [],
    routeTolls: (db.routeTolls || []).filter(rt => idsTronc.has(rt.route_id)),
  }));
}

async function _insertar(db, origen, nota = '') {
  const fila = { fijada_by: usuarioSesion() || null, origen, nota: nota || null, data: capturarEstado(db) };
  const { data, error } = await supabase.from('tarifa_vigente').insert(fila).select('id, fijada_at, fijada_by, origen, nota, data').single();
  if (error) throw new Error(error.message);
  _vig = data;
  _emit();
  return _vig;
}

// Registra la foto actual como vigente sólo si todavía no existe ninguna.
// Llamar ANTES de aplicar un ajuste para que el "actual" sean los valores previos.
let _auto = null;
export async function asegurarVigente(db) {
  if (!can('editar')) return _vig ?? null;
  if (_auto) return _auto;                 // evita dos fotos automáticas simultáneas
  _auto = (async () => {
    const v = await cargarVigente();
    if (v) return v;
    return _insertar(db, 'auto', 'Registrada automáticamente antes del primer ajuste');
  })();
  try { return await _auto; } finally { _auto = null; }
}

// Las tarifas actuales pasan a ser la tarifa vigente (p. ej. tras cargarlas en SAP)
export async function fijarVigente(db, nota = '') {
  return _insertar(db, 'manual', nota);
}

// db con los insumos de la tarifa vigente (rutas, centros e histórico de hoy)
export function escenarioVigente(db, vig) {
  const d = (vig && vig.data) || {};
  const clon = o => JSON.parse(JSON.stringify(o || {}));
  const cur = getTariffConfig(db), ccur = getClientTariffConfig(db);
  const tronIds = new Set((d.routeTolls || []).map(r => r.route_id));
  return {
    ...db,
    truckTypes: clon(d.truckTypes || []),
    tariffConfig: [{ id: 'global', data: { participacionRutas: cur.participacionRutas, ...clon(d.tariffCfg) } }],
    clientTariffConfig: [{ id: 'global', data: { ...clon(d.clientCfg), historico: ccur.historico, histMeta: ccur.histMeta } }],
    extraCosts: d.extraCosts ? clon(d.extraCosts) : db.extraCosts,
    routeTolls: [...(db.routeTolls || []).filter(rt => !tronIds.has(rt.route_id)), ...clon(d.routeTolls || [])],
  };
}

// Diferencias de parámetros de Tarifas por Camión: tarifa vigente vs actual
// → [{ id, Id_centro, type, campo, antes, despues }] (camión nuevo: antes null · eliminado: despues null)
export function diffCamiones(db, vig) {
  if (!vig || !vig.data) return [];
  const usados = centrosTarifa(db);
  const old = new Map((vig.data.truckTypes || []).filter(t => usados.has(String(t.Id_centro))).map(t => [t.id, t]));
  const cur = new Map((db.truckTypes || []).filter(t => usados.has(String(t.Id_centro))).map(t => [t.id, t]));
  const out = [];
  new Set([...old.keys(), ...cur.keys()]).forEach(id => {
    const a = old.get(id), b = cur.get(id), t = b || a;
    PARAMS_CAMION.forEach(([campo]) => {
      const va = a ? valorParam(a, campo) : null, vb = b ? valorParam(b, campo) : null;
      if (va === vb) return;
      if (!a && !vb) return;   // camión nuevo con el parámetro vacío
      if (!b && !va) return;
      out.push({ id, Id_centro: t.Id_centro, type: t.type, capKg: truckCapKg(t.type), campo, antes: va, despues: vb });
    });
  });
  return out;
}

// Última actualización de Tarifas por Camión (todos o los de un centro): { at, by }
export function ultimaActualizacion(db, centroId = null) {
  let at = null, by = '';
  (db.truckTypes || []).forEach(t => {
    if (centroId && t.Id_centro !== centroId) return;
    if (t.updated_at && (!at || t.updated_at > at)) { at = t.updated_at; by = t.updated_by || ''; }
  });
  return { at, by };
}

// Fecha y hora Chile: 25.10.2026 15:14
export function fechaHora(iso, conHora = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  return `${p.day}.${p.month}.${p.year}${conHora ? ` ${p.hour}:${p.minute}` : ''}`;
}
export const usuarioCorto = u => String(u || '').split('@')[0] || '—';

// ── Estilos comunes (aviso de Tarifas por Camión y vista Variación Tarifa) ──
export function estilosVigente() {
  if (document.getElementById('vt-css')) return;
  const st = document.createElement('style');
  st.id = 'vt-css';
  st.textContent = `
.vt-warn{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 16px;border-radius:8px;background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;font-size:13px;line-height:1.45}
.vt-warn>.material-symbols-outlined{color:#ea580c;font-size:22px}
.vt-warn b{font-weight:700}
.vt-warn-a{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.vt-note{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-radius:8px;background:var(--sv-s1);color:var(--sv-ink2);font-size:12.5px}
.vt-note .material-symbols-outlined{font-size:18px;color:#15803d}
.vt-note.is-info .material-symbols-outlined{color:#1d4ed8}
.vt-was{font-size:10.5px;color:#b45309;text-align:right;margin-top:2px;white-space:nowrap}
.vt-upd{font-size:11.5px;color:var(--sv-ink2);font-weight:500;white-space:nowrap}
.vt-upd .material-symbols-outlined{font-size:14px;vertical-align:-2px}
.vt-up{color:#b5000b;font-weight:700;white-space:nowrap}.vt-dn{color:#15803d;font-weight:700;white-space:nowrap}.vt-eq{color:#9ca3af}
.vt-table td.vt-g,.vt-table th.vt-g{border-left:1px solid var(--sv-line)}
.vt-table thead tr:first-child th{height:30px;box-sizing:border-box;padding-top:6px;padding-bottom:6px}
.vt-table thead tr:nth-child(2) th{top:30px}
.vt-table thead th.vt-gh{text-align:center}
.vt-table tr.vt-prom td{background:var(--sv-s1);font-weight:700}
.vt-table tr.vt-ch td:first-child{box-shadow:inset 3px 0 0 #ea580c}
.vt-table td.vt-a{color:var(--sv-ink2)}
.vt-cards{display:flex;flex-direction:column;gap:16px}
.vt-sec{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--sv-ink2);padding:6px 16px 8px}
`;
  document.head.appendChild(st);
}

// Navega a la vista Variación Tarifa por el menú lateral (mismo camino que un clic)
export function irVariacion() {
  document.querySelector('.sidebar-item[data-tab="tarifas-transporte"][data-sub="variacion"]')?.click();
}

// ── Aviso de Tarifas por Camión ─────────────────────────────────────────────
// Se muestra cuando los parámetros guardados difieren de la tarifa vigente.
export function avisoCamionesHtml(db, editar) {
  estilosVigente();
  const v = _vig;
  if (v === undefined) return '';
  const ult = ultimaActualizacion(db);
  const ultTxt = ult.at ? `${fechaHora(ult.at)} por ${esc(usuarioCorto(ult.by))}` : '—';
  if (v === null) {
    return `<div class="vt-note is-info"><span class="material-symbols-outlined">info</span><span>Sin tarifa vigente registrada. Al guardar el primer ajuste, la tarifa previa al cambio queda como vigente para medir la variación.</span></div>`;
  }
  const d = diffCamiones(db, v);
  if (!d.length) {
    return `<div class="vt-note"><span class="material-symbols-outlined">verified</span><span>Tarifas vigentes desde <b>${fechaHora(v.fijada_at)}</b> · última actualización ${ultTxt} · sin variación pendiente</span>
      <button class="sv-btn" data-chip data-vt-ir style="margin-left:auto"><span class="material-symbols-outlined">difference</span>Variación Tarifa</button></div>`;
  }
  const nCam = new Set(d.map(x => x.id)).size, nCen = new Set(d.map(x => x.Id_centro)).size;
  return `<div class="vt-warn" role="alert"><span class="material-symbols-outlined">warning</span>
    <div style="flex:1;min-width:260px"><b>Tarifas actualizadas el ${ultTxt}</b>
      <div>${fmt(d.length)} ${d.length === 1 ? 'parámetro' : 'parámetros'} de ${fmt(nCam)} ${nCam === 1 ? 'camión' : 'camiones'} en ${fmt(nCen)} ${nCen === 1 ? 'centro' : 'centros'} difieren de la tarifa vigente fijada el <b>${fechaHora(v.fijada_at)}</b>.
      Tarifas Rutas, Tarifas Clientes y troncales ya usan los valores nuevos: revisa la variación por centro antes de cargarlas en SAP.</div></div>
    <div class="vt-warn-a"><button class="sv-btn" data-chip data-vt-ir><span class="material-symbols-outlined">difference</span>Ver Variación Tarifa</button>
      ${editar ? '<button class="sv-btn-p" data-chip data-vt-fijar title="Las tarifas actuales pasan a ser la tarifa vigente (la variación vuelve a cero)"><span class="material-symbols-outlined">verified</span>Fijar como vigentes</button>' : ''}</div></div>`;
}

export async function confirmarFijar(db) {
  const v = _vig;
  const ok = await confirmar(`¿Fijar las tarifas actuales como vigentes?\n\nLa variación vuelve a cero${v ? ` y la tarifa vigente del ${fechaHora(v.fijada_at)} queda en el historial` : ''}. Úsalo después de cargar las nuevas tarifas en SAP.`, { aceptar: 'Fijar vigentes', icono: 'verified' });
  if (!ok) return false;
  try {
    await fijarVigente(db);
    showAlert('Tarifas actuales fijadas como vigentes.', 'success');
    return true;
  } catch (e) {
    showAlert('No se pudo fijar la tarifa vigente: ' + (e.message || e), 'error');
    return false;
  }
}

export function wireAvisoCamiones(root, db, onCambio) {
  root.querySelectorAll('[data-vt-ir]').forEach(b => b.addEventListener('click', irVariacion));
  root.querySelector('[data-vt-fijar]')?.addEventListener('click', async () => { if (await confirmarFijar(db)) onCambio(); });
}
