// ============================================================================
// TARIFAS CLIENTES — rediseño v2 (30-sep-2026)
// ----------------------------------------------------------------------------
// Histórico (6M) · Consolidación · Densidad Logística · Frecuencia y Especiales
// · Cluster · Tarifas $/Kg (ZFMP) · Tarifa Min/Max (ZFMI) · Retiro Retorno.
//
// Los cálculos son los mismos de tarifas-clientes.js (se reciben por `ctx`):
//   ZFMP        = ZCAP ÷ (capacidad × objetivo de consolidación del centro/camión)
//   $/kg centro = Σ ZFMP de cada camión × su participación en toneladas del centro
//   ZFMI        = ZCAP del camión mínimo ÷ pedidos promedio del cluster
//   ZFMX        = ZCAP · Express = ZCAP × (1 + recargo de exclusividad del centro)
//
// Ediciones (objetivos, clusters, recargos y asignación de cluster por ruta)
// van a un borrador (CC.work); la barra amarilla muestra el impacto sobre las
// tarifas a clientes y «Guardar y recalcular» escribe sólo client_tariff_config
// (syncOnly) y, si cambió la asignación de clusters, cluster_rutas por centro.
// ============================================================================
import { saveDatabase, getOrigenGroups } from './data.js?v=202610231717';
import { buildZcapMap, es2Ton, componentesRegional } from './zcap.js?v=202610231717';
import { showAlert } from './utils.js';
import { can } from './permisos.js?v=202610231717';
import { esc, fmt, clp, numIn, wireNumIns, rerenderKeepFocus, debounce, chainHtml, wireChain, changesBarHtml, wireChangesBar, setParamPill, clasifPill, clasifTarifa, pillHtml } from './tarifas-ui.js?v=202610231717';

const CAPS = [5, 10, 15, 28];
const CAP_LBL = { 5: '5 t', 10: '10 t', 15: '15 t', 28: '28 t' };
const STACK_COL = ['#c5c7c9', '#936e69', '#5c5f61', '#191c1d'];
const num = v => Number(v) || 0;
const kg$ = n => (n == null || isNaN(n)) ? '—' : '$' + fmt(n, 2);
const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s+/-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());

// ── Borrador común ──────────────────────────────────────────────────────────
const CC = { work: null, baseJson: null, guardando: false, snap: null, zmap: null, memoBase: null };
function partes(c) {
  return {
    clusters: c.clusters || [],
    consolidacionObjetivo: c.consolidacionObjetivo || {},
    recargoExclusividad: (c.especiales || {}).recargoExclusividad || {},
    comunaCluster: c.comunaCluster || {},
    camion2t: c.camion2t || {},
    retiroRetorno: c.retiroRetorno || {},
  };
}
function initDraft(ccfg) {
  if (CC.work) return;
  CC.baseJson = JSON.stringify(partes(ccfg));
  CC.work = JSON.parse(CC.baseJson);
  CC.memoBase = null;
}
function base() { return JSON.parse(CC.baseJson); }
function ccEff(ccfg, w = CC.work) {
  return { ...ccfg, clusters: w.clusters, consolidacionObjetivo: w.consolidacionObjetivo, comunaCluster: w.comunaCluster, camion2t: w.camion2t || {},
    retiroRetorno: w.retiroRetorno || {},
    especiales: { ...(ccfg.especiales || {}), recargoExclusividad: w.recargoExclusividad } };
}
function hojas(o, p = '', out = {}) {
  if (o && typeof o === 'object') Object.keys(o).forEach(k => hojas(o[k], p ? `${p}.${k}` : k, out));
  else out[p] = o;
  return out;
}
function diffHojas(a, b) {
  const ha = hojas(a), hb = hojas(b);
  return [...new Set([...Object.keys(ha), ...Object.keys(hb)])].filter(k => String(ha[k] ?? '') !== String(hb[k] ?? '')).length;
}
function rutasReasignadas(db) {
  const b = base().comunaCluster, w = CC.work.comunaCluster;
  return (db.routes || []).filter(r => r.activo && String(b[r.id] ?? b[r.codigo] ?? '') !== String(w[r.id] ?? w[r.codigo] ?? ''));
}
function contarCambios(db) {
  if (!CC.work) return 0;
  const b = base(), w = CC.work;
  const bk = new Map(b.clusters.map(c => [c.key, JSON.stringify(c)]));
  const wk = new Map(w.clusters.map(c => [c.key, JSON.stringify(c)]));
  let n = 0;
  new Set([...bk.keys(), ...wk.keys()]).forEach(k => { if (bk.get(k) !== wk.get(k)) n++; });
  n += diffHojas(b.consolidacionObjetivo, w.consolidacionObjetivo);
  n += diffHojas(b.recargoExclusividad, w.recargoExclusividad);
  n += diffHojas(b.camion2t || {}, w.camion2t || {});
  n += diffHojas(b.retiroRetorno || {}, w.retiroRetorno || {});
  n += rutasReasignadas(db).length;
  return n;
}
function asignarCluster(ruta, key) {
  const cc = CC.work.comunaCluster;
  if (key) { cc[String(ruta.id)] = key; if (ruta.codigo) cc[String(ruta.codigo)] = key; }
  else { delete cc[String(ruta.id)]; if (ruta.codigo) delete cc[String(ruta.codigo)]; }
}

// ── Cálculo de tarifas a clientes (misma lógica que las vistas PRD) ────────
function zcapVivo(ctx) {
  if (!CC.zmap) CC.zmap = buildZcapMap(ctx.db, ctx.cfg, { incluir2t: true });
  return CC.zmap;
}
function capKgDe(truck) {
  return truck.capKg != null ? truck.capKg : (Number(String(truck.type).match(/(\d+)/)?.[1] || 0) * 1000);
}
function recargoDe(ccfgX, grupo) {
  const t = ccfgX.especiales?.recargoExclusividad || {};
  const v = t[String(grupo).replace(/\s/g, '_')] ?? t[grupo];
  return (v && typeof v === 'object') ? (v.activo === false ? 0 : num(v.pct)) : num(v);
}
// ── Camión 2 Ton (22-oct-2026, Jordan) ───────────────────────────────────────
// Sólo Tarifa Min/Max y Express. Costo ruta = máx(km ruta × valor km del centro,
// costo mínimo del centro). ZFMI = ZFMX = costo ruta; Express = costo × (1 + recargo).
// No usa factor de consolidación ni ZCAP, no entra a $/Kg y no es camión mínimo.
// Config en client_tariff_config.data.camion2t = { GRUPO_KEY: { costoMin, valorKm } }.
// (23-oct-2026, Jordan) Sin costo mínimo ni valor km → el camión no se activa en ese centro.
const T2_TIPO = 'Camión 2 Ton';
function cfg2t(ccfgX, grupo) {
  const t = ccfgX.camion2t || {};
  const v = t[String(grupo).replace(/\s/g, '_')] || t[grupo] || {};
  const costoMin = num(v.costoMin), valorKm = num(v.valorKm);
  return { activo: costoMin > 0 || valorKm > 0, costoMin, valorKm };
}
export function costoRuta2t(ccfgX, grupo, km) {
  const c = cfg2t(ccfgX, grupo);
  if (!c.activo) return null;
  return Math.max(num(km) * c.valorKm, c.costoMin);
}
// ── Tarifas Retiro Retorno (23-oct-2026, Jordan) ─────────────────────────────
// Rutas Regionales (Comuna o Sector) de cada centro × camiones habilitados:
//   28 t        → costo íntegro de la ruta (ZCAP vigente)
//   2 a 15 t, centro CON T. base KM (c > 0, ej. Santiago 1000/1003/1005):
//                 KM ≤ a: 50% × (b + c) · KM > a: b + 50% × (KM − a) × tarifa km
//   2 a 15 t, centro SIN T. base KM (c = 0, regiones): 50% × KM × tarifa km
//                 y nunca bajo el mínimo del centro (client_tariff_config.data.retiroRetorno)
// a, b, c y tarifa km son los de Tarifas por Camión (los mismos del ZCAP regional).
const RR_PCT = 0.5;
function minimoRetiro(ccfgX, grupo) {
  const t = ccfgX.retiroRetorno || {};
  const v = t[String(grupo).replace(/\s/g, '_')] ?? t[grupo];
  return num(v && typeof v === 'object' ? v.minimo : v);
}
function calcRetiro(ctx, ccfgX, zOver = null) {
  const zmap = zcapVivo(ctx);
  const troncales = new Set(ctx.cfg.variables?.troncalesRoutes || []);
  const rows = [];
  zmap.forEach((v, key) => {
    const { truck, ruta } = v;
    const tipo = String(ruta.tipo || '').toLowerCase();
    if (ruta.clasificRuta !== 'Regional' || troncales.has(ruta.codigo) || (tipo !== 'comuna' && tipo !== 'sector')) return;
    const zcap = num(zOver && zOver.has(key) ? zOver.get(key) : v.zcap);
    if (!(zcap > 0)) return;                                   // camión sin tarifa configurada
    const capKg = capKgDe(truck), grupo = ruta.origen_grupo || '', km = num(ruta.km);
    const k = componentesRegional(ruta, truck);
    const minimo = minimoRetiro(ccfgX, grupo);
    let calc, retiro, regla;
    if (capKg >= 28000) { calc = zcap; retiro = zcap; regla = 'Ruta íntegra'; }
    else {
      // (23-oct-2026, Jordan) Sólo los centros con T. base KM (c) usan KM base y costo base;
      // sin c, el retiro es el 50% del costo de los km de la ruta.
      const conBase = k.c > 0;
      const bajoBase = conBase && km <= k.a;
      calc = !conBase ? RR_PCT * km * k.rate
        : bajoBase ? RR_PCT * (k.b + k.c) : k.b + RR_PCT * (km - k.a) * k.rate;
      retiro = Math.max(calc, minimo);
      regla = retiro > calc ? 'Mínimo centro' : (!conBase ? '50% km ruta' : bajoBase ? 'Bajo KM base' : 'Sobre KM base');
    }
    rows.push({ key, ruta, truck, grupo, capKg, km, zcap, ...k, calc, minimo: capKg >= 28000 ? null : minimo, retiro, regla,
      cod: ruta.codigo || String(ruta.id || ''), tipoRuta: tipo === 'sector' ? 'Sector' : 'Comuna' });
  });
  // (23-oct-2026, Jordan) Camión 2 Ton de Frecuencia y Especiales (centros sin 2 Ton en
  // Tarifas por Camión): costo ruta = máx(km × valor km, costo mínimo); sin T. base KM →
  // retiro = 50% × km × valor km, nunca bajo el mínimo del centro.
  const con2t = new Set(rows.filter(r => r.capKg === 2000).map(r => r.cod));
  const vistas = new Set();
  rows.slice().forEach(r => {
    if (con2t.has(r.cod) || vistas.has(r.cod)) return;
    vistas.add(r.cod);
    const c2 = cfg2t(ccfgX, r.grupo);
    if (!c2.activo) return;
    const costo = costoRuta2t(ccfgX, r.grupo, r.km);
    const calc = RR_PCT * r.km * c2.valorKm;
    const minimo = minimoRetiro(ccfgX, r.grupo);
    const retiro = Math.max(calc, minimo);
    rows.push({ ...r, key: r.cod + '||' + T2_TIPO, truck: { type: T2_TIPO }, capKg: 2000, zcap: costo,
      a: 0, b: 0, c: 0, rate: c2.valorKm, especial: false, calc, minimo, retiro,
      regla: retiro > calc ? 'Mínimo centro' : '50% km ruta', t2Especiales: true });
  });
  return rows;
}

// Devuelve una fila por ruta × camión con todas las tarifas. zOver: Map key → zcap (foto)
function calcTarifas(ctx, ccfgX, zOver = null) {
  const zmapAll = zcapVivo(ctx);
  // Camión 2 Ton de Tarifas por Camión (23-oct-2026): fuera de $/Kg y del camión mínimo
  const zmap = new Map([...zmapAll].filter(([, v]) => !es2Ton(v.truck)));
  const z2t = new Map();
  zmapAll.forEach((v, key) => { if (es2Ton(v.truck)) z2t.set(v.ruta.codigo || String(v.ruta.id || ''), { key, v }); });
  const opMap = ctx.computeOpClusterMap(ctx.db, ccfgX);
  const { partPct, resolveGrupoKey } = ctx.computeConsolidacionStats();
  const minCap = new Map();
  zmap.forEach(({ truck, ruta }) => {
    const g = ruta.origen_grupo || '', c = capKgDe(truck);
    if (!minCap.has(g) || c < minCap.get(g)) minCap.set(g, c);
  });
  const zDe = (key, v) => (zOver && zOver.has(key) ? zOver.get(key) : v.zcap);
  const minPorRuta = new Map();
  zmap.forEach((v, key) => {
    const g = v.ruta.origen_grupo || '', c = capKgDe(v.truck);
    if (c !== minCap.get(g)) return;
    const cod = v.ruta.codigo || String(v.ruta.id || '');
    if (minPorRuta.has(cod)) return;
    const f = ctx.objetivoConsol(ccfgX, g.replace(/\s/g, '_'), c / 1000);
    minPorRuta.set(cod, { tipo: v.truck.type || (c / 1000 + 'T'), zcap: zDe(key, v), kilos: c * f / 100 });
  });
  // (22-oct-2026, Jordan) Las rutas Sector heredan el cluster de la ruta Comuna
  // activa de su misma comuna y centro origen (se prefiere la Regional).
  const normCom = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const padreComuna = new Map();
  (ctx.db.routes || []).forEach(r => {
    if (!r.activo || String(r.tipo || '').toLowerCase() !== 'comuna') return;
    const k = (r.origen_grupo || '') + '|' + normCom(r.comuna || r.destino);
    const prev = padreComuna.get(k);
    if (!prev || (prev.clasificRuta !== 'Regional' && r.clasificRuta === 'Regional')) padreComuna.set(k, r);
  });
  const rutaCluster = ruta => (String(ruta.tipo || '').toLowerCase() === 'sector'
    ? padreComuna.get((ruta.origen_grupo || '') + '|' + normCom(ruta.comuna)) || null : null);
  const rows = [];
  zmap.forEach((v, key) => {
    const { truck, ruta } = v;
    const padre = rutaCluster(ruta);
    const rc = padre || ruta;
    const grupo = ruta.origen_grupo || '', gk = grupo.replace(/\s/g, '_');
    const capKg = capKgDe(truck), bkt = capKg / 1000;
    const zcap = zDe(key, v);
    const factorPct = ctx.objetivoConsol(ccfgX, gk, bkt);
    const kilos = capKg * factorPct / 100;
    const zfmp = (zcap > 0 && kilos > 0) ? zcap / kilos : null;
    const cod = ruta.codigo || String(ruta.id || '');
    const clusterKey = ccfgX.comunaCluster[String(rc.id || '')] || ccfgX.comunaCluster[String(rc.codigo || '')] || '';
    const clObj = (ccfgX.clusters || []).find(c => c.key === clusterKey);
    const pedProm = clObj?.nv || 1;
    const mn = minPorRuta.get(cod);
    const kilosTarifMin = (mn && pedProm > 0) ? mn.kilos / pedProm : null;
    const zfmpMin = (mn && mn.zcap > 0 && mn.kilos > 0) ? mn.zcap / mn.kilos : null;
    let zfmi = (kilosTarifMin != null && zfmpMin != null) ? kilosTarifMin * zfmpMin : null;
    // Regla Jordan 12-oct-2026: camión 28 t a clientes → tarifa mínima = máxima (ZCAP)
    if (bkt >= 28 && zcap > 0) zfmi = zcap;
    const rec = recargoDe(ccfgX, grupo);
    rows.push({ key, ruta, truck, grupo, capKg, zcap, clasif: clasifTarifa(ruta), factorPct, kilos, zfmp, cod,
      clusterKey, clObj, clusterOp: opMap.get(String(rc.id || '')) || opMap.get(String(rc.codigo || '')) || '', clusterDe: padre ? (padre.codigo || '') : '',
      camionMin: mn?.tipo || '—', zfmi, zfmx: zcap > 0 ? zcap : null, express: zcap > 0 ? zcap * (1 + rec / 100) : null, kilosTarifMin, pedProm, recargo: rec });
  });
  // $/kg centro por ruta
  const porRuta = new Map();
  rows.forEach(r => { if (!porRuta.has(r.cod)) porRuta.set(r.cod, { g: r.grupo, b: {} }); porRuta.get(r.cod).b[r.capKg / 1000] = r.zfmp; });
  const centro = new Map();
  porRuta.forEach(({ g, b }, cod) => {
    const p = partPct[resolveGrupoKey(g)] || {};
    const t = CAPS.reduce((s, k) => s + (b[k] != null ? b[k] * (num(p[k]) / 100) : 0), 0);
    centro.set(cod, t > 0 ? t : null);
  });
  rows.forEach(r => { r.kgCentro = centro.get(r.cod) ?? null; });
  // Camión 2 Ton: una fila por ruta de los centros con el camión activo.
  // (23-oct-2026) Si el centro lo tiene en Tarifas por Camión, el costo ruta es su ZCAP
  // (rutas regionales); si no, la tarifa plana de Frecuencia y Especiales.
  const vistos = new Set();
  rows.slice().forEach(r => {
    if (vistos.has(r.cod)) return;
    vistos.add(r.cod);
    const t2 = z2t.get(r.cod);
    const zc2 = t2 ? num(zDe(t2.key, t2.v)) : 0;
    const costo = zc2 > 0 ? zc2 : costoRuta2t(ccfgX, r.grupo, r.ruta.km);
    if (costo == null) return;
    rows.push({ ...r, key: r.cod + '||' + T2_TIPO, truck: t2 ? t2.v.truck : { type: T2_TIPO }, capKg: 2000, es2t: true, t2Zcap: zc2 > 0,
      zcap: costo, factorPct: null, kilos: null, zfmp: null, kgCentro: null, camionMin: '—',
      zfmi: costo, zfmx: costo, express: costo * (1 + r.recargo / 100), kilosTarifMin: null });
  });
  return rows;
}
function impactoClientes(ctx) {
  const n = contarCambios(ctx.db);
  if (!n) return '';
  const vals = (rows, ret) => { const o = {}; rows.forEach(r => { o[r.key + '|p'] = r.zfmp || 0; o[r.key + '|i'] = r.zfmi || 0; o[r.key + '|e'] = r.express || 0; });
    ret.forEach(r => { o[r.key + '|r'] = r.retiro || 0; }); return o; };
  const todo = w => vals(calcTarifas(ctx, ccEff(ctx.ccfg, w)), calcRetiro(ctx, ccEff(ctx.ccfg, w)));
  if (!CC.memoBase) CC.memoBase = todo(base());
  const a = CC.memoBase, d = todo(CC.work);
  const partes = [['p', '$/Kg'], ['i', 'mínimos'], ['e', 'express'], ['r', 'retiros']].map(([m, lbl]) => {
    const ks = Object.keys(d).filter(k => k.endsWith('|' + m) && Math.abs((d[k] || 0) - (a[k] || 0)) > (m === 'p' ? 0.005 : 0.5));
    if (!ks.length) return null;
    const sa = ks.reduce((s, k) => s + (a[k] || 0), 0), sd = ks.reduce((s, k) => s + (d[k] || 0), 0);
    const pct = sa ? (sd / sa - 1) * 100 : 0;
    return `${fmt(ks.length)} ${lbl} (${pct >= 0 ? '+' : '−'}${fmt(Math.abs(pct), 1)}%)`;
  }).filter(Boolean);
  return partes.length ? `Cambian ${partes.join(', ')}` : 'sin efecto en las tarifas a clientes';
}

// ── Guardar ─────────────────────────────────────────────────────────────────
async function guardar(ctx, render) {
  const { db, ccfg } = ctx;
  if (!contarCambios(db)) return;
  const reasig = rutasReasignadas(db);
  const b = base();
  const clustersCambio = JSON.stringify(b.clusters) !== JSON.stringify(CC.work.clusters);
  const w = JSON.parse(JSON.stringify(CC.work));
  ccfg.clusters = w.clusters;
  ccfg.consolidacionObjetivo = w.consolidacionObjetivo;
  ccfg.especiales = ccfg.especiales || {};
  ccfg.especiales.recargoExclusividad = w.recargoExclusividad;
  ccfg.comunaCluster = w.comunaCluster;
  ccfg.camion2t = w.camion2t || {};
  ccfg.retiroRetorno = w.retiroRetorno || {};
  CC.work = null;
  CC.memoBase = null;
  initDraft(ccfg);
  saveDatabase(db, { syncOnly: ['clientTariffConfig'] });
  showAlert('Cambios guardados. Las tarifas $/Kg, Min/Max y el Cotizador ya usan los valores nuevos.', 'success');
  render();
  // cluster_rutas (cluster operativo) de los centros afectados
  if (reasig.length || clustersCambio) {
    const grupos = new Set(reasig.map(r => r.origen_grupo));
    const centros = clusterCentros(ctx, ccfg).filter(cd => clustersCambio || grupos.has(cd.grupo));
    try {
      for (const cd of centros) await ctx.persistClusterOpDB(cd);
    } catch (e) {
      console.error('Error al sincronizar cluster_rutas:', e);
      showAlert('Se guardó la configuración, pero falló la actualización de cluster_rutas: ' + (e.message || e), 'error');
    }
  }
}

// ── Piezas de UI ────────────────────────────────────────────────────────────
function kpiHtml(on, attr, key, lbl, val, sub, color, clickable = true) {
  return `<button class="sv-kpi ${on ? 'is-on' : ''}" ${clickable ? `data-chip ${attr}="${esc(key)}"` : 'data-chip disabled style="cursor:default"'}
    style="${on ? `box-shadow:inset 0 -3px 0 ${color}` : ''}"><div class="sv-kpi-l"><i style="background:${color}"></i>${esc(lbl)}</div>
    <div class="sv-kpi-v" style="font-size:28px;line-height:36px">${esc(val)}</div><div class="sv-kpi-s">${esc(sub)}</div></button>`;
}
function chips(lista, activo, attr, lbl = 'Centro origen') {
  return `<div class="sv-frow"><span class="sv-flbl">${esc(lbl)}</span>
    <button class="sv-chip ${activo === 'all' ? 'is-on' : ''}" data-chip ${attr}="all">Todos</button>
    ${lista.map(([k, n]) => `<button class="sv-chip ${activo === k ? 'is-on' : ''}" data-chip ${attr}="${esc(k)}">${esc(n)}</button>`).join('')}</div>`;
}
function seg(attr, cur, opts) {
  return `<div class="sv-seg">${opts.map(([k, l]) => `<button data-chip ${attr}="${esc(k)}" class="${cur === k ? 'is-on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
function pager(total, pagina, per, attr) {
  const pags = Math.max(1, Math.ceil(total / per));
  if (pags <= 1) return '';
  return `<span class="tf-pager"><button data-chip ${attr}="-1" ${pagina === 0 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_left</span></button>Pág. ${pagina + 1} / ${pags}<button data-chip ${attr}="1" ${pagina >= pags - 1 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_right</span></button></span>`;
}
function barra(pct, color, objetivo = null, lbl = '') {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="tf-pbar"><div class="tf-pbar-t"><i style="width:${w}%;background:${color}"></i>${objetivo != null ? `<b style="left:${Math.max(0, Math.min(100, objetivo))}%" title="Objetivo ${fmt(objetivo)}%"></b>` : ''}</div>${lbl ? `<span>${esc(lbl)}</span>` : ''}</div>`;
}
function noData(msg = 'Sin histórico cargado. Usa «Actualizar desde FLETE 360» en Histórico (6M).') {
  return `<div class="sv-card" style="padding:40px;text-align:center;color:var(--sv-ink2)"><span class="material-symbols-outlined" style="font-size:40px;color:#c5c7c9">upload_file</span><div style="margin-top:8px">${esc(msg)}</div></div>`;
}
function marco(ctx, { titulo: t, desc, activo, acciones = '', cuerpo }) {
  const n = contarCambios(ctx.db);
  return `<div class="sv-view">
    ${changesBarHtml(n, n ? impactoClientes(ctx) : '', CC.guardando)}
    <div class="sv-vhead"><div style="min-width:0"><h1 class="sv-h1">${esc(t)}</h1><div class="sv-desc">${esc(desc)}</div></div><div class="sv-actions">${acciones}</div></div>
    ${chainHtml('clientes', activo)}
    ${cuerpo}
  </div>`;
}
function cablear(container, ctx, render) {
  wireChain(container);
  wireChangesBar(container, () => { CC.work = null; initDraft(ctx.ccfg); render(); }, () => guardar(ctx, render));
}
const nombreGrupo = db => Object.fromEntries(getOrigenGroups(db).map(g => [g.grupo, g.nombre || titulo(g.grupo)]));

// ============================================================================
// HISTÓRICO (6M)
// ============================================================================
const HV = { centro: 'all', hes: 'all', pagina: 0, cargando: false };
const HIST_PAGE = 100;
function renderHistorico(container, ctx) {
  const { db, ccfg } = ctx;
  const editar = can('editar');
  function render() {
    const hist = ctx.hist();
    const NG = nombreGrupo(db);
    let cuerpo;
    if (!hist.length) cuerpo = noData('Sin histórico cargado. Usa «Actualizar desde FLETE 360».');
    else {
      const docs = new Map();
      hist.forEach(r => { if (!docs.has(r.documento)) docs.set(r.documento, r.gasto); });
      const tTon = hist.reduce((s, r) => s + r.ton, 0), tGasto = [...docs.values()].reduce((s, g) => s + g, 0);
      const porC = new Map();
      hist.forEach(r => {
        const k = r.oficina || '—';
        if (!porC.has(k)) porC.set(k, { docs: new Map(), ent: new Set(), ton: 0, tr: new Set(), ru: new Set(), caps: [0, 0, 0, 0] });
        const e = porC.get(k);
        if (!e.docs.has(r.documento)) { e.docs.set(r.documento, r.gasto); e.caps[CAPS.indexOf(ctx.getCapBucket(r.capTons))]++; }
        if (r.entrega) e.ent.add(r.entrega);
        e.ton += r.ton; if (r.transportista) e.tr.add(r.transportista); if (r.idRuta) e.ru.add(r.idRuta);
      });
      const resumen = [...porC.entries()].map(([c, e]) => ({ c, g: ctx.grupoDe(c), docs: e.docs.size, ent: e.ent.size, ton: e.ton, gasto: [...e.docs.values()].reduce((s, g) => s + g, 0), tr: e.tr.size, ru: e.ru.size, caps: e.caps })).sort((a, b) => b.docs - a.docs);
      let det = hist;
      if (HV.centro !== 'all') det = det.filter(r => ctx.grupoDe(r.oficina) === HV.centro);
      if (HV.hes === 'pagado') det = det.filter(r => r.hes !== '');
      if (HV.hes === 'pendiente') det = det.filter(r => r.hes === '');
      const pags = Math.max(1, Math.ceil(det.length / HIST_PAGE));
      if (HV.pagina >= pags) HV.pagina = pags - 1;
      const pag = det.slice(HV.pagina * HIST_PAGE, (HV.pagina + 1) * HIST_PAGE);
      const pend = [...new Set(hist.filter(r => r.hes === '').map(r => r.documento))].length;
      const gruposH = [...new Set(hist.map(r => ctx.grupoDe(r.oficina)))].sort().map(g => [g, NG[g] || titulo(g)]);
      cuerpo = `<div class="sv-kpis">
          ${kpiHtml(false, '', '', 'Documentos', fmt(docs.size), 'de transporte en 6 meses', '#191c1d', false)}
          ${kpiHtml(false, '', '', 'Toneladas', fmt(tTon), 'despachadas', '#1d4ed8', false)}
          ${kpiHtml(false, '', '', 'Gasto flete', '$' + fmt(tGasto / 1e6, 0) + ' M', 'pagado a transportistas', '#b5000b', false)}
          ${kpiHtml(false, '', '', 'Costo por kilo', tTon ? clp(tGasto / (tTon * 1000)) : '—', `promedio real · ${fmt(pend)} docs sin HES`, '#15803d', false)}
        </div>
        <div class="sv-card">
          <div class="tf-tabletitle"><div><h3>Por centro de expedición</h3><small>${esc(ccfg.histMeta?.fileName || 'FLETE 360')}${ccfg.histMeta?.desde ? ` · ${esc(ccfg.histMeta.desde)} a ${esc(ccfg.histMeta.hasta)}` : ''}${ccfg.histMeta?.uploadDate ? ` · leído ${esc(ccfg.histMeta.uploadDate)}` : ''}</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:1100px">
            <thead><tr><th>Centro exp.</th><th class="r">Doc. transp.</th><th class="r">Entregas</th><th class="r">Ent./doc.</th><th class="r">Toneladas</th><th class="r">Ton/doc.</th><th class="r">Gasto</th><th class="r">$/kg</th><th class="r">Transp.</th><th class="r">Rutas</th><th style="min-width:160px">Docs por camión</th></tr></thead>
            <tbody>${resumen.map(x => { const sm = x.caps.reduce((a, b) => a + b, 0) || 1; return `<tr style="cursor:default">
              <td><span class="sv-b">${esc(NG[x.g] || titulo(x.g))}</span><div class="sv-sub">${esc(x.c)}</div></td>
              <td class="r">${fmt(x.docs)}</td><td class="r">${fmt(x.ent)}</td><td class="r">${fmt(x.docs ? x.ent / x.docs : 0, 1)}</td>
              <td class="r"><b>${fmt(x.ton)}</b></td><td class="r">${fmt(x.docs ? x.ton / x.docs : 0, 1)}</td><td class="r">$${fmt(x.gasto / 1e6, 1)} M</td>
              <td class="r"><b>${x.ton ? clp(x.gasto / (x.ton * 1000)) : '—'}</b></td><td class="r">${fmt(x.tr)}</td><td class="r">${fmt(x.ru)}</td>
              <td><div class="tf-stack" title="${CAPS.map((k, i) => `${CAP_LBL[k]}: ${x.caps[i]} docs`).join(' · ')}">${x.caps.map((m, i) => `<i style="width:${(m / sm * 100).toFixed(1)}%;background:${STACK_COL[i]}"></i>`).join('')}</div></td></tr>`; }).join('')}</tbody>
          </table></div>
          <div class="tf-card-foot"><span>Docs por camión: 5 t · 10 t · 15 t · 28 t (de claro a oscuro)</span><span>Fuente: FLETE 360 (6 meses móviles)</span></div>
        </div>
        <div class="sv-filters">
          <div class="sv-frow">${seg('data-hhes', HV.hes, [['all', 'HES: todos'], ['pagado', 'Con HES'], ['pendiente', 'Sin HES']])}</div>
          ${chips(gruposH, HV.centro, 'data-hcentro')}
        </div>
        <div class="sv-card">
          <div class="sv-tablewrap" style="max-height:520px"><table class="sv-table" style="min-width:1000px">
            <thead><tr><th>Fecha</th><th>Centro</th><th>Doc. transp.</th><th>Entrega</th><th>Ruta</th><th>Transportista</th><th class="r">Cap.</th><th class="r">Ton</th><th class="r">Gasto doc.</th><th>HES</th></tr></thead>
            <tbody>${pag.map(r => `<tr style="cursor:default"><td class="sv-mono">${esc(r.fecha)}</td><td>${esc(NG[ctx.grupoDe(r.oficina)] || ctx.grupoDe(r.oficina))}</td><td class="sv-mono">${esc(r.documento)}</td><td class="sv-mono">${esc(r.entrega || '')}</td>
              <td><span class="sv-mono">${esc(r.idRuta)}</span>${r.idRutaSap && String(r.idRutaSap).toUpperCase() !== String(r.idRuta).toUpperCase() ? `<div class="sv-sub" title="ID de ruta en SAP">SAP ${esc(r.idRutaSap)}</div>` : ''}</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.transportista)}">${esc(r.transportista)}</td>
              <td class="r">${CAP_LBL[ctx.getCapBucket(r.capTons)]}</td><td class="r">${fmt(r.ton, 2)}</td><td class="r" title="Monto pagado de la fila (documento × entrega × ruta)">${clp(r.flete != null ? r.flete : r.gasto)}</td>
              <td>${r.hes ? pillHtml('Con HES', 'ok') : pillHtml('Pendiente', 'warn')}</td></tr>`).join('')}</tbody>
          </table></div>
          <div class="sv-tfoot"><span>${fmt(det.length)} entregas</span>${pager(det.length, HV.pagina, HIST_PAGE, 'data-hpag')}</div>
        </div>`;
    }
    const acciones = `<button class="sv-btn-p" data-refrescar id="h-f360" ${HV.cargando ? 'disabled' : ''}><span class="material-symbols-outlined">refresh</span>${HV.cargando ? 'Actualizando…' : 'Actualizar desde FLETE 360'}</button>
      ${editar ? `<label class="sv-btn" style="cursor:pointer" title="Respaldo manual: sólo si FLETE 360 no está disponible"><span class="material-symbols-outlined">upload_file</span>CSV manual<input type="file" accept=".csv" id="h-csv" hidden></label>` : ''}`;
    container.innerHTML = marco(ctx, { titulo: 'Histórico (6M)', desc: 'Despachos de los últimos 6 meses (FLETE 360): base de consolidación, densidad y clusters.', activo: 'historico', acciones, cuerpo });
    wire();
  }
  function wire() {
    cablear(container, ctx, render);
    container.querySelectorAll('[data-hcentro]').forEach(b => b.addEventListener('click', () => { HV.centro = b.dataset.hcentro; HV.pagina = 0; render(); }));
    container.querySelectorAll('[data-hhes]').forEach(b => b.addEventListener('click', () => { HV.hes = b.dataset.hhes; HV.pagina = 0; render(); }));
    container.querySelectorAll('[data-hpag]').forEach(b => b.addEventListener('click', () => { HV.pagina += Number(b.dataset.hpag); render(); }));
    container.querySelector('#h-f360')?.addEventListener('click', async () => {
      HV.cargando = true; render();
      try {
        const ok = await ctx.recargarFlete360();
        if (ok) { CC.zmap = null; CC.memoBase = null; }
      } finally { HV.cargando = false; render(); }
    });
    container.querySelector('#h-csv')?.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) ctx.cargarCsvManual(f, () => { CC.memoBase = null; render(); });
    });
  }
  render();
}

// ============================================================================
// CONSOLIDACIÓN (objetivo por centro × camión)
// ============================================================================
const CV = { centro: 'all' };
function renderConsolidacion(container, ctx) {
  const { db } = ctx;
  const editar = can('editar');
  const NG = nombreGrupo(db);
  const nom = g => (g === 'SANTIAGO + SAN BERNARDO' ? 'Santiago + San Bernardo' : (NG[g] || titulo(g)));
  function render() {
    let cuerpo;
    if (!ctx.hist().length) cuerpo = noData();
    else {
      const { grupos, stats } = ctx.computeConsolidacionStats();
      const lista = grupos.filter(g => CV.centro === 'all' || g === CV.centro);
      cuerpo = `<div class="sv-filters">${chips(grupos.map(g => [g, nom(g)]), CV.centro, 'data-ccentro')}</div>
        ${lista.map(g => {
          const gk = g.replace(/\s/g, '_');
          const tot = CAPS.reduce((s, b) => s + (stats[g][b]?.totalTon || 0), 0) || 1;
          return `<div class="sv-card">
            <div class="tf-tabletitle"><div><h3>${esc(nom(g))}</h3><small>El objetivo define los kilos a consolidar en la tarifa $/kg de este centro</small></div></div>
            <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:900px">
              <thead><tr><th>Camión</th><th class="r">Despachos</th><th class="r">Consolidación real</th><th style="min-width:200px">Real vs. objetivo</th><th class="r">Objetivo</th><th class="r">Ton total</th><th class="r">Participación ton</th></tr></thead>
              <tbody>${CAPS.map(b => {
                const s = stats[g][b];
                const path = `${gk}.${b}`;
                const obj = CC.work.consolidacionObjetivo[gk]?.[b];
                const obj0 = base().consolidacionObjetivo[gk]?.[b];
                const objV = (obj === undefined || obj === null || obj === '') ? 80 : num(obj);
                const ch = String(obj ?? '') !== String(obj0 ?? '');
                const act = s ? s.avgFill * 100 : null;
                const ok = act != null && act >= objV;
                return `<tr style="cursor:default"><td><span class="sv-b">${CAP_LBL[b]}</span></td>
                  <td class="r">${s ? fmt(s.docs) : '—'}</td>
                  <td class="r"><b style="color:${act == null ? '#9ca3af' : ok ? '#15803d' : '#b5000b'}">${act == null ? 'Sin registros' : fmt(act, 1) + '%'}</b></td>
                  <td>${act == null ? '' : barra(act, ok ? '#15803d' : '#ca8a04', objV, fmt(act, 0) + '%')}</td>
                  <td class="r">${numIn('co|' + path, objV, { unit: '%', w: '86px', changed: ch, disabled: !editar, label: `Objetivo ${nom(g)} ${CAP_LBL[b]}` })}</td>
                  <td class="r">${s ? fmt(s.totalTon, 1) : '—'}</td>
                  <td class="r">${s ? fmt(s.totalTon / tot * 100, 1) + '%' : '—'}</td></tr>`;
              }).join('')}</tbody>
            </table></div>
            <div class="tf-card-foot"><span>La línea negra marca el objetivo · consolidación = promedio de ton cargadas ÷ capacidad por despacho (máx. 100%)</span><span>Últimos 6 meses</span></div>
          </div>`;
        }).join('')}`;
    }
    container.innerHTML = marco(ctx, { titulo: 'Consolidación', desc: 'Consolidación real de la flota por centro y tipo de camión, y objetivo que usa la tarifa $/kg.', activo: 'consolidacion', cuerpo });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablear(container, ctx, render);
    container.querySelectorAll('[data-ccentro]').forEach(b => b.addEventListener('click', () => { CV.centro = b.dataset.ccentro; render(); }));
    wireNumIns(container, (key, val) => {
      const [, gk, bkt] = key.split(/[|.]/);
      const t = CC.work.consolidacionObjetivo;
      const b0 = base().consolidacionObjetivo[gk]?.[bkt];
      if ((b0 === undefined || b0 === null || b0 === '') && val === 80) { if (t[gk]) delete t[gk][bkt]; if (t[gk] && !Object.keys(t[gk]).length) delete t[gk]; }
      else { t[gk] = t[gk] || {}; t[gk][bkt] = val; }
      recalc();
    });
  }
  render();
}

// ============================================================================
// DENSIDAD LOGÍSTICA
// ============================================================================
function densidadCentros(ctx) {
  const { db } = ctx;
  const hist = ctx.hist();
  const routeByCode = new Map();
  (db.routes || []).filter(r => r.activo).forEach(r => { if (r.codigo) routeByCode.set(String(r.codigo).toUpperCase(), r); if (r.id) routeByCode.set(String(r.id).toUpperCase(), r); });
  return getOrigenGroups(db).map(({ grupo, centroIds, nombre }) => {
    const ids = new Set((centroIds || []).map(String));
    const rutas = (db.routes || []).filter(r => r.activo && (r.tipo || '').toLowerCase() === 'comuna' && r.clasificRuta === 'Regional' && (r.origen_grupo ? r.origen_grupo === grupo : ids.has(String(r.origenId))));
    if (!rutas.length) return null;
    const valid = new Set(); rutas.forEach(r => { if (r.codigo) valid.add(String(r.codigo).toUpperCase()); if (r.id) valid.add(String(r.id).toUpperCase()); });
    const st = new Map(); const tc = new Set(), to = new Set();
    hist.forEach(h => {
      const k0 = String(h.idRuta).toUpperCase();
      if (!valid.has(k0)) return;
      const route = routeByCode.get(k0); if (!route) return;
      const key = route.codigo || String(h.idRuta);
      if (!st.has(key)) st.set(key, { route, cli: new Set(), obr: new Set(), ton: 0 });
      const s = st.get(key);
      if (h.idCliente && h.idCliente !== '-') { s.cli.add(h.idCliente); tc.add(h.idCliente); }
      if (h.idObra && h.idObra !== '-') { s.obr.add(h.idObra); to.add(h.idObra); }
      s.ton += h.ton;
    });
    rutas.forEach(r => { const k = r.codigo || String(r.id); if (!st.has(k)) st.set(k, { route: r, cli: new Set(), obr: new Set(), ton: 0 }); });
    let tN = 0, tI = 0, tE = 0;
    st.forEach(s => { const c = (s.route.caracteristica || '').toUpperCase(); if (c === 'ISLA') tI += s.ton; else if (c === 'EXTREMA') tE += s.ton; else tN += s.ton; });
    const tT = tN + tI + tE;
    const rows = [...st.values()].map(s => {
      const car = (s.route.caracteristica || '').toUpperCase();
      const pool = car === 'ISLA' ? tI : car === 'EXTREMA' ? tE : tN;
      const pctCli = s.cli.size / (tc.size || 1) * 100, pctObra = s.obr.size / (to.size || 1) * 100, pctTon = s.ton / (tT || 1) * 100;
      return { rutaId: s.route.id || '', rutaCodigo: s.route.codigo || '', destino: s.route.destino || '', zona: s.route.id_zona_transporte || '', caracteristica: car,
        clientes: s.cli.size, obras: s.obr.size, ton: s.ton, pctCli, pctObra, pctTon, peso: pool > 0 ? s.ton / pool * 100 : 0, densidad: (pctCli + pctObra + pctTon) / 3 };
    }).sort((a, b) => b.densidad - a.densidad);
    return { grupo, nombre: nombre || titulo(grupo), rows, tc: tc.size, to: to.size, tT, tN, tI, tE };
  }).filter(Boolean);
}
const DV = { centro: 'all', q: '' };
function renderDensidad(container, ctx) {
  const { db, cfg } = ctx;
  const editar = can('editar');
  let datos = ctx.hist().length ? densidadCentros(ctx) : [];
  function render() {
    let cuerpo;
    if (!ctx.hist().length) cuerpo = noData();
    else if (!datos.length) cuerpo = noData('No se encontraron rutas tipo Comuna + Regional.');
    else {
      const q = DV.q.trim().toLowerCase();
      const lista = datos.filter(cd => DV.centro === 'all' || cd.grupo === DV.centro);
      const tot = lista.reduce((a, cd) => ({ r: a.r + cd.rows.length, h: a.h + cd.rows.filter(r => r.ton > 0).length, t: a.t + cd.tT }), { r: 0, h: 0, t: 0 });
      cuerpo = `<div class="sv-kpis">
          ${kpiHtml(false, '', '', 'Rutas comuna', fmt(tot.r), 'regionales del filtro', '#191c1d', false)}
          ${kpiHtml(false, '', '', 'Con histórico', fmt(tot.h), 'rutas con despachos en 6 meses', '#1d4ed8', false)}
          ${kpiHtml(false, '', '', 'Toneladas', fmt(tot.t), 'despachadas a esas rutas', '#b5000b', false)}
        </div>
        <div class="sv-filters">
          <div class="sv-frow"><label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="d-q" placeholder="Código o destino" value="${esc(DV.q)}" style="width:220px"></label></div>
          ${chips(datos.map(cd => [cd.grupo, cd.nombre]), DV.centro, 'data-dcentro')}
        </div>
        ${lista.map(cd => {
          const filas = cd.rows.filter(r => !q || `${r.rutaCodigo} ${r.destino}`.toLowerCase().includes(q));
          const mx = cd.rows[0]?.densidad || 1;
          return `<div class="sv-card">
            <div class="tf-tabletitle"><div><h3>${esc(cd.nombre)}</h3><small>${fmt(cd.tc)} clientes · ${fmt(cd.to)} obras · ${fmt(cd.tN, 1)} t normal${cd.tI ? ` · ${fmt(cd.tI, 1)} t isla` : ''}${cd.tE ? ` · ${fmt(cd.tE, 1)} t extrema` : ''}</small></div>
              ${editar ? `<button class="sv-btn" data-dguardar="${esc(cd.grupo)}" title="Guarda el peso % de cada ruta para la T. ponderada del Motor de Costos"><span class="material-symbols-outlined">save</span>Guardar pesos</button>` : ''}</div>
            <div class="sv-tablewrap" style="max-height:520px"><table class="sv-table" style="min-width:900px">
              <thead><tr><th class="r">#</th><th>Cód. ruta</th><th>Destino</th><th>Zona</th><th class="r">Clientes</th><th class="r">Obras</th><th class="r">Toneladas</th><th class="r">Peso %</th><th style="min-width:170px">Densidad</th></tr></thead>
              <tbody>${filas.map(r => { const i = cd.rows.indexOf(r); const c = r.densidad >= 15 ? '#15803d' : r.densidad >= 5 ? '#ca8a04' : '#ea580c';
                return `<tr style="cursor:default"><td class="r sv-muted">${i + 1}</td><td><span class="sv-mono">${esc(r.rutaCodigo)}</span></td>
                  <td><b>${esc(r.destino)}</b>${['ISLA', 'EXTREMA'].includes(r.caracteristica) ? ' ' + pillHtml(titulo(r.caracteristica), r.caracteristica === 'ISLA' ? 'purple' : 'orange') : ''}</td>
                  <td class="sv-mono">${esc(r.zona)}</td><td class="r">${fmt(r.clientes)}</td><td class="r">${fmt(r.obras)}</td><td class="r"><b>${fmt(r.ton, 1)}</b></td>
                  <td class="r">${fmt(r.peso, 2)}%</td><td>${barra(r.densidad / mx * 100, c, null, fmt(r.densidad, 2) + '%')}</td></tr>`; }).join('') || '<tr class="sv-empty"><td colspan="9">Sin rutas para la búsqueda.</td></tr>'}</tbody>
            </table></div>
            <div class="tf-card-foot"><span>${fmt(filas.length)} rutas</span><span>Densidad = promedio de % clientes, % obras y % toneladas del centro · Peso % = ton ÷ ton del pool (normal, isla o extrema)</span></div>
          </div>`;
        }).join('')}`;
    }
    container.innerHTML = marco(ctx, { titulo: 'Densidad Logística', desc: 'Clientes, obras y toneladas por ruta comuna regional: base para asignar clusters.', activo: 'densidad', cuerpo });
    wire();
  }
  function wire() {
    cablear(container, ctx, render);
    container.querySelectorAll('[data-dcentro]').forEach(b => b.addEventListener('click', () => { DV.centro = b.dataset.dcentro; render(); }));
    const q = container.querySelector('#d-q');
    q?.addEventListener('input', () => { DV.q = q.value; const pos = q.selectionStart; render(); const n = container.querySelector('#d-q'); n.focus(); n.setSelectionRange(pos, pos); });
    container.querySelectorAll('[data-dguardar]').forEach(b => b.addEventListener('click', () => {
      const cd = datos.find(c => c.grupo === b.dataset.dguardar);
      if (!cd) return;
      cfg.participacionRutas = cfg.participacionRutas || {};
      cd.rows.forEach(r => {
        // pct: el Motor de Costos / Tarifas por Camión ponderan con .pct (antes faltaba → peso 0)
        const e = { pct: Math.round(r.peso * 100) / 100, peso: r.peso / 100, toneladas: r.ton, clientes: r.clientes, obras: r.obras };
        if (r.rutaId) cfg.participacionRutas[String(r.rutaId)] = e;
        if (r.rutaCodigo) cfg.participacionRutas[String(r.rutaCodigo)] = e;
      });
      saveDatabase(db, { syncOnly: ['tariffConfig'] });
      showAlert(`Pesos de ${cd.nombre} guardados para el Motor de Costos.`, 'success');
    }));
  }
  render();
}

// ============================================================================
// FRECUENCIA Y ESPECIALES (clusters + recargo por exclusividad)
// ============================================================================
function renderEspeciales(container, ctx) {
  const { db } = ctx;
  const editar = can('editar');
  const grupos = getOrigenGroups(db);
  function render() {
    const w = CC.work, b = base();
    const b0 = new Map(b.clusters.map(c => [c.key, c]));
    const rutasDe = key => (db.routes || []).filter(r => r.activo && (w.comunaCluster[String(r.id)] || w.comunaCluster[String(r.codigo)]) === key).length;
    const ch = (c, f) => { const o = b0.get(c.key); return !o || String(o[f] ?? '') !== String(c[f] ?? ''); };
    fotoZcap(ctx);
    const retiros = calcRetiro(ctx, ccEff(ctx.ccfg), CC.snap);
    const cuerpo = `<div class="tf-grid">
      <div class="sv-card" style="flex:2 1 720px">
        <div class="tf-tabletitle"><div><h3>Frecuencias de despacho</h3><small>Pedidos promedio por visita: divide los kilos de la tarifa mínima (ZFMI)</small></div>
          ${editar ? '<button class="sv-btn" id="f-add"><span class="material-symbols-outlined">add</span>Agregar cluster</button>' : ''}</div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:900px">
          <thead><tr><th>Nombre</th><th style="text-align:center">Color</th><th class="r">Ped. prom.</th><th>Frecuencia</th><th class="r">Rutas</th><th style="text-align:center">Tipo 0000</th><th class="r">Recargo 0000</th><th style="text-align:center">Eliminar</th></tr></thead>
          <tbody>${w.clusters.map((c, i) => { const nuevo = !b0.has(c.key); const on = c.tipo0000Habilitado !== false;
            return `<tr class="${nuevo ? 'tf-row-new' : ''}" style="cursor:default">
              <td><label class="tf-in is-txt${ch(c, 'nombre') ? ' is-ch' : ''}" style="--w:230px"><input data-ftxt="${i}|nombre" value="${esc(c.nombre)}" placeholder="Nombre del cluster" ${editar ? '' : 'disabled'}></label><div class="sv-sub">clave ${esc(c.key)}</div></td>
              <td style="text-align:center"><input type="color" class="tf-color" data-fcolor="${i}" value="${esc(c.color || '#6b7280')}" ${editar ? '' : 'disabled'} aria-label="Color ${esc(c.nombre)}"></td>
              <td class="r">${numIn(`fn|${i}|nv`, c.nv, { unit: 'ped.', w: '96px', changed: ch(c, 'nv'), disabled: !editar, label: 'Pedidos promedio ' + c.nombre })}</td>
              <td><label class="tf-in is-txt${ch(c, 'frecuencia') ? ' is-ch' : ''}" style="--w:180px"><input data-ftxt="${i}|frecuencia" value="${esc(c.frecuencia || '')}" placeholder="Ej: 2 veces por semana" ${editar ? '' : 'disabled'}></label></td>
              <td class="r sv-muted">${fmt(rutasDe(c.key))} rutas</td>
              <td style="text-align:center"><button class="tf-sw ${on ? 'is-on' : ''}" data-chip data-ftog="${i}" ${editar ? '' : 'disabled'} title="Aplica a clientes tipo 0000" aria-label="Tipo 0000"></button></td>
              <td class="r">${on ? numIn(`fn|${i}|tipo0000`, c.tipo0000 || 0, { pre: '$', w: '110px', changed: ch(c, 'tipo0000'), disabled: !editar, label: 'Recargo tipo 0000 ' + c.nombre }) : '<span class="sv-muted">—</span>'}</td>
              <td style="text-align:center">${editar && w.clusters.length > 1 ? `<button class="tf-actbtn" data-chip data-fdel="${i}" title="Eliminar cluster"><span class="material-symbols-outlined">delete</span></button>` : ''}</td></tr>`; }).join('')}</tbody>
        </table></div>
        <div class="tf-card-foot"><span>Tipo 0000: clientes especiales sin cliente final asignado</span><span>Las rutas de un cluster eliminado pasan al último de la lista</span></div>
      </div>
      <div class="sv-card" style="flex:1 1 360px">
        <div class="tf-tabletitle"><div><h3>Recargo por exclusividad</h3><small>% aplicado sobre el ZCAP para calcular la Tarifa Express</small></div></div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:320px">
          <thead><tr><th>Centro logístico</th><th class="r">Recargo</th></tr></thead>
          <tbody>${grupos.map(g => { const gk = g.grupo.replace(/\s/g, '_'); const v = recargoDe({ especiales: { recargoExclusividad: w.recargoExclusividad } }, g.grupo); const v0 = recargoDe({ especiales: { recargoExclusividad: b.recargoExclusividad } }, g.grupo);
            return `<tr style="cursor:default"><td><span class="sv-b">${esc(g.nombre)}</span><div class="sv-sub">${esc(g.centroIds.join(' · '))}</div></td>
              <td class="r">${numIn(`fr|${gk}`, v, { unit: '%', w: '86px', changed: v !== v0, disabled: !editar, label: 'Recargo ' + g.nombre })}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>
      <div class="sv-card" style="flex:1 1 100%">
        <div class="tf-tabletitle"><div><h3>Camión 2 Ton</h3><small>Sólo Tarifa Min/Max y Express · costo ruta = máx(km ruta × valor km, costo mínimo) · sin valores = no se activa en el centro · si el centro tiene Camión 2 Ton en Tarifas por Camión, en rutas regionales manda ese ZCAP</small></div></div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:640px">
          <thead><tr><th>Centro logístico</th><th>Estado</th><th class="r">Costo mínimo</th><th class="r">Valor km</th><th class="r">Ejemplo 50 km</th></tr></thead>
          <tbody>${grupos.map(g => { const gk = g.grupo.replace(/\s/g, '_');
            const c = cfg2t({ camion2t: w.camion2t }, g.grupo), c0 = cfg2t({ camion2t: b.camion2t }, g.grupo);
            const ej = costoRuta2t({ camion2t: w.camion2t }, g.grupo, 50);
            return `<tr style="cursor:default"><td><span class="sv-b">${esc(g.nombre)}</span><div class="sv-sub">${esc(g.centroIds.join(' · '))}</div></td>
              <td>${c.activo ? pillHtml('Activo', 'ok') : pillHtml('No activo', 'mute')}</td>
              <td class="r">${numIn(`t2|${gk}|costoMin`, c.costoMin, { pre: '$', w: '120px', changed: c.costoMin !== c0.costoMin, disabled: !editar, label: 'Costo mínimo 2 Ton ' + g.nombre })}</td>
              <td class="r">${numIn(`t2|${gk}|valorKm`, c.valorKm, { pre: '$', unit: '/km', w: '120px', changed: c.valorKm !== c0.valorKm, disabled: !editar, label: 'Valor km 2 Ton ' + g.nombre })}</td>
              <td class="r sv-muted">${ej != null ? clp(ej) : '—'}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>
      <div class="sv-card" style="flex:1 1 100%">
        <div class="tf-tabletitle"><div><h3>Mínimo retiro retorno</h3><small>Tarifas Retiro Retorno de camiones 2 a 15 t nunca menores a este valor · no aplica a 28 t</small></div></div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:640px">
          <thead><tr><th>Centro logístico</th><th class="r">Mínimo retiro</th><th class="r">Combinaciones 2–15 t</th><th class="r">En mínimo</th></tr></thead>
          <tbody>${grupos.map(g => { const gk = g.grupo.replace(/\s/g, '_');
            const v = minimoRetiro({ retiroRetorno: w.retiroRetorno }, g.grupo), v0 = minimoRetiro({ retiroRetorno: b.retiroRetorno }, g.grupo);
            const filas = retiros.filter(r => r.grupo === g.grupo && r.capKg < 28000);
            const enMin = filas.filter(r => r.regla === 'Mínimo centro').length;
            return `<tr style="cursor:default"><td><span class="sv-b">${esc(g.nombre)}</span><div class="sv-sub">${esc(g.centroIds.join(' · '))}</div></td>
              <td class="r">${numIn(`rr|${gk}`, v, { pre: '$', w: '130px', changed: v !== v0, disabled: !editar, label: 'Mínimo retiro ' + g.nombre })}</td>
              <td class="r">${filas.length ? fmt(filas.length) : '<span class="sv-muted">sin rutas regionales</span>'}</td>
              <td class="r">${enMin ? `<b>${fmt(enMin)}</b> <span class="sv-muted">(${fmt(enMin / filas.length * 100, 0)}%)</span>` : '<span class="sv-muted">0</span>'}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
    container.innerHTML = marco(ctx, { titulo: 'Frecuencia y Especiales', desc: 'Clusters de frecuencia (pedidos promedio por visita), recargo por exclusividad, camión 2 Ton y mínimo de retiro retorno de cada centro.', activo: 'especiales', cuerpo });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablear(container, ctx, render);
    const w = CC.work;
    container.querySelectorAll('[data-ftxt]').forEach(inp => inp.addEventListener('input', () => {
      const [i, f] = inp.dataset.ftxt.split('|');
      w.clusters[Number(i)][f] = inp.value;
      recalc();
    }));
    container.querySelectorAll('[data-fcolor]').forEach(inp => inp.addEventListener('change', () => { w.clusters[Number(inp.dataset.fcolor)].color = inp.value; render(); }));
    container.querySelectorAll('[data-ftog]').forEach(b => b.addEventListener('click', () => { const c = w.clusters[Number(b.dataset.ftog)]; c.tipo0000Habilitado = c.tipo0000Habilitado === false; render(); }));
    container.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.fdel);
      if (w.clusters.length <= 1) return;
      const [del] = w.clusters.splice(i, 1);
      const destino = w.clusters[w.clusters.length - 1].key;
      Object.keys(w.comunaCluster).forEach(k => { if (w.comunaCluster[k] === del.key) w.comunaCluster[k] = destino; });
      render();
    }));
    container.querySelector('#f-add')?.addEventListener('click', () => {
      const nums = w.clusters.map(c => parseInt(c.key, 10)).filter(n => !isNaN(n));
      const key = String((nums.length ? Math.max(...nums) : 0) + 1);
      w.clusters.push({ key, nombre: 'Cluster ' + key, color: '#9ca3af', nv: 1, frecuencia: '', tipo0000: 0, tipo0000Habilitado: false });
      render();
    });
    wireNumIns(container, (key, val) => {
      const p = key.split('|');
      if (p[0] === 'fn') w.clusters[Number(p[1])][p[2]] = val;
      else if (p[0] === 'rr') {
        w.retiroRetorno = w.retiroRetorno || {};
        const g = p[1].replace(/_/g, ' ');
        if (p[1] !== g) delete w.retiroRetorno[g];
        w.retiroRetorno[p[1]] = { minimo: val };
      }
      else if (p[0] === 't2') {
        w.camion2t = w.camion2t || {};
        const { activo: _a, ...prev } = w.camion2t[p[1]] || {};
        w.camion2t[p[1]] = { ...prev, [p[2]]: val };
      }
      else if (p[0] === 'fr') {
        const gk = p[1], g = gk.replace(/_/g, ' ');
        const t = w.recargoExclusividad;
        const prev = t[gk] ?? t[g];
        if (prev && typeof prev === 'object') t[gk] = { ...prev, pct: val, activo: val > 0 };
        else t[gk] = val;
        if (gk !== g && g in t) delete t[g];
      }
      recalc();
    });
  }
  render();
}

// ============================================================================
// CLUSTER (asignación por ruta + cluster operativo)
// ============================================================================
function clusterCentros(ctx, ccfgX) {
  const { db } = ctx;
  const hist = ctx.hist();
  const routeByCode = new Map();
  (db.routes || []).filter(r => r.activo).forEach(r => { if (r.codigo) routeByCode.set(String(r.codigo).toUpperCase(), r); if (r.id) routeByCode.set(String(r.id).toUpperCase(), r); });
  return getOrigenGroups(db).map(({ grupo, centroIds, centros, repId, nombre }) => {
    const ids = new Set((centroIds || []).map(String));
    const repCd = (centros || []).find(c => String(c.id) === String(repId)) || (centros || [])[0] || {};
    const oLat = parseFloat(repCd.lat), oLon = parseFloat(repCd.lon);
    const carta = ctx.EJES_OP[String(repId)] || ctx.EJES_OP_DEFAULT;
    const rutas = (db.routes || []).filter(r => r.activo && (r.tipo || '').toLowerCase() === 'comuna' && r.clasificRuta === 'Regional' && (r.origen_grupo ? r.origen_grupo === grupo : ids.has(String(r.origenId))));
    if (!rutas.length) return null;
    const valid = new Set(); rutas.forEach(r => { if (r.codigo) valid.add(String(r.codigo).toUpperCase()); if (r.id) valid.add(String(r.id).toUpperCase()); });
    const st = new Map(); const tc = new Set(), to = new Set();
    hist.forEach(h => {
      const k0 = String(h.idRuta).toUpperCase(); if (!valid.has(k0)) return;
      const route = routeByCode.get(k0); if (!route) return;
      const key = route.codigo || String(h.idRuta);
      if (!st.has(key)) st.set(key, { route, cli: new Set(), obr: new Set(), ton: 0 });
      const s = st.get(key);
      if (h.idCliente && h.idCliente !== '-') { s.cli.add(h.idCliente); tc.add(h.idCliente); }
      if (h.idObra && h.idObra !== '-') { s.obr.add(h.idObra); to.add(h.idObra); }
      s.ton += h.ton;
    });
    rutas.forEach(r => { const k = r.codigo || String(r.id); if (!st.has(k)) st.set(k, { route: r, cli: new Set(), obr: new Set(), ton: 0 }); });
    let tT = 0; st.forEach(s => { tT += s.ton; });
    const rows = [...st.values()].map(s => {
      const dens = (s.cli.size / (tc.size || 1) * 100 + s.obr.size / (to.size || 1) * 100 + s.ton / (tT || 1) * 100) / 3;
      const dLat = parseFloat(s.route.lat), dLon = parseFloat(s.route.lon);
      const az = (!isNaN(oLat) && !isNaN(dLat)) ? ctx.clOpAzimut(oLat, oLon, dLat, dLon) : null;
      const e = ctx.ejeOpDe(az, carta);
      return { route: s.route, rutaId: String(s.route.id || ''), rutaCodigo: String(s.route.codigo || ''), destino: s.route.destino || '', comunaPadre: s.route.comuna || s.route.destino || '',
        region: s.route.region || '', zona: s.route.id_zona_transporte || '', caracteristica: (s.route.caracteristica || '').toUpperCase(), ton: s.ton, densidad: dens,
        lat: parseFloat(s.route.lat) || null, lon: parseFloat(s.route.lon) || null,
        cluster: ccfgX.comunaCluster[String(s.route.id || '')] || ccfgX.comunaCluster[String(s.route.codigo || '')] || '', eje: e.eje, ejeAlias: e.alias };
    }).sort((a, b) => b.densidad - a.densidad);
    return { grupo, nombre: nombre || titulo(grupo), rows, totTon: tT, repId: String(repId) };
  }).filter(Boolean);
}
const KV = { centro: 'all', kpi: 'all', q: '' };
function renderCluster(container, ctx) {
  const { ccfg } = ctx;
  const editar = can('editar');
  function render() {
    let cuerpo;
    const ccX = ccEff(ccfg);
    const datos = ctx.hist().length ? clusterCentros(ctx, ccX) : [];
    if (!ctx.hist().length) cuerpo = noData();
    else if (!datos.length) cuerpo = noData('No se encontraron rutas tipo Comuna + Regional.');
    else {
      const cls = ccX.clusters;
      const colorDe = k => cls.find(c => c.key === k)?.color || '#d1d5db';
      const nomDe = k => cls.find(c => c.key === k)?.nombre || (k ? k : 'Sin cluster');
      const vis = datos.filter(cd => KV.centro === 'all' || cd.grupo === KV.centro);
      const todas = vis.flatMap(cd => cd.rows.map(r => ({ cd, r })));
      const q = KV.q.trim().toLowerCase();
      const filas = todas.filter(({ r }) => (KV.kpi === 'all' || (KV.kpi === '_none' ? !r.cluster : r.cluster === KV.kpi)) && (!q || `${r.rutaCodigo} ${r.destino}`.toLowerCase().includes(q)));
      const b = base().comunaCluster;
      const kpis = cls.map(c => kpiHtml(KV.kpi === c.key, 'data-kkpi', c.key, c.nombre.split(/\s[—-]\s/)[0].trim(), fmt(todas.filter(x => x.r.cluster === c.key).length), c.frecuencia || '', c.color))
        .concat([kpiHtml(KV.kpi === '_none', 'data-kkpi', '_none', 'Sin cluster', fmt(todas.filter(x => !x.r.cluster).length), 'rutas por asignar', '#9ca3af')]).join('');
      cuerpo = `<div class="sv-kpis">${kpis}</div>
        <div class="sv-filters">
          <div class="sv-frow"><label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="k-q" placeholder="Código o destino" value="${esc(KV.q)}" style="width:220px"></label>
            ${editar ? `<button class="sv-btn" data-chip id="k-auto" title="Asigna por densidad y cercanía (cluster 1 = mayor densidad). Queda como borrador."><span class="material-symbols-outlined">auto_awesome</span>Asignar automáticamente ${KV.centro === 'all' ? '(todos los centros)' : ''}</button>` : ''}</div>
          ${chips(datos.map(cd => [cd.grupo, cd.nombre]), KV.centro, 'data-kcentro')}
        </div>
        <div class="sv-card">
          <div class="sv-tablewrap" style="max-height:620px"><table class="sv-table" style="min-width:1180px">
            <thead><tr><th>Centro</th><th>Cód. ruta</th><th>Destino</th><th>Zona</th><th class="r">Densidad</th><th>Cluster</th><th>Eje vial</th><th>Cluster op.</th><th>Frecuencia</th><th>Flota sugerida</th></tr></thead>
            <tbody>${filas.map(({ cd, r }) => {
              const anchors = cd._anch || (cd._anch = ctx.anchorsOpFor(cd));
              const op = ctx.clusterOpDe(r.eje, r.cluster, { lat: r.lat, lon: r.lon, anchors });
              const ch = String(b[r.rutaId] ?? b[r.rutaCodigo] ?? '') !== String(r.cluster || '');
              return `<tr class="${ch ? 'tf-row-ed' : ''}" style="cursor:default">
                <td><span class="sv-b">${esc(cd.nombre)}</span></td><td><span class="sv-mono">${esc(r.rutaCodigo)}</span></td>
                <td><b>${esc(r.destino)}</b>${['ISLA', 'EXTREMA'].includes(r.caracteristica) ? ' ' + pillHtml(titulo(r.caracteristica), r.caracteristica === 'ISLA' ? 'purple' : 'orange') : ''}</td>
                <td class="sv-mono">${esc(r.zona)}</td><td class="r"><b>${fmt(r.densidad, 2)}%</b></td>
                <td><div style="display:flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;background:${colorDe(r.cluster)};flex:none"></i>
                  <select class="tf-sel" data-kasig="${esc(r.rutaId)}" ${editar ? '' : 'disabled'} style="${ch ? 'border-color:#ca8a04;background:#fffbeb' : ''}"><option value="">— Sin cluster —</option>${cls.map(c => `<option value="${esc(c.key)}" ${r.cluster === c.key ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div></td>
                <td title="${esc(r.ejeAlias || '')}">${esc(r.eje || '—')}</td><td class="sv-mono"><b>${esc(op.cluster)}</b></td><td>${esc(op.frecuencia)}</td><td>${esc(op.flota)}</td></tr>`;
            }).join('') || '<tr class="sv-empty"><td colspan="10">Sin rutas para el filtro.</td></tr>'}</tbody>
          </table></div>
          <div class="sv-tfoot"><span>${fmt(filas.length)} rutas · ${nomDe(KV.kpi === 'all' ? '' : KV.kpi) && KV.kpi !== 'all' ? esc(nomDe(KV.kpi)) : 'todos los clusters'}</span><span>Al guardar se actualiza cluster_rutas (cluster operativo) de los centros cambiados</span></div>
        </div>`;
    }
    container.innerHTML = marco(ctx, { titulo: 'Cluster', desc: 'Cluster de densidad por ruta comuna regional y su cluster operativo (eje vial, frecuencia y flota).', activo: 'cluster', cuerpo });
    wire(datos);
  }
  function wire(datos) {
    cablear(container, ctx, render);
    container.querySelectorAll('[data-kcentro]').forEach(b => b.addEventListener('click', () => { KV.centro = b.dataset.kcentro; render(); }));
    container.querySelectorAll('[data-kkpi]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.kkpi; KV.kpi = KV.kpi === k ? 'all' : k; render(); }));
    const q = container.querySelector('#k-q');
    q?.addEventListener('input', () => { KV.q = q.value; const pos = q.selectionStart; render(); const n = container.querySelector('#k-q'); n.focus(); n.setSelectionRange(pos, pos); });
    container.querySelectorAll('[data-kasig]').forEach(s => s.addEventListener('change', () => {
      const ruta = (ctx.db.routes || []).find(r => String(r.id) === s.dataset.kasig);
      if (ruta) asignarCluster(ruta, s.value);
      render();
    }));
    container.querySelector('#k-auto')?.addEventListener('click', () => {
      const tmp = ccEff(ctx.ccfg);
      tmp.comunaCluster = CC.work.comunaCluster;
      datos.filter(cd => KV.centro === 'all' || cd.grupo === KV.centro).forEach(cd => ctx.asignarClustersCentro(cd.rows, tmp));
      showAlert('Clusters asignados como borrador. Revisa la tabla y usa «Guardar y recalcular».', 'success');
      render();
    });
  }
  render();
}

// ============================================================================
// TARIFAS $/KG (ZFMP) y TARIFA MIN/MAX (ZFMI)
// ============================================================================
const ZP = { tipos: [], centro: 'all', trucks: [], q: '', pagina: 0 };
const ZI = { tipos: [], centro: 'all', trucks: [], q: '', pagina: 0 };
const ZPAGE = 50;
const TIPOS_T = [['regional', 'Regionales'], ['interregional', 'Interregionales'], ['sector', 'Sectores']];
// Segmentado de selección múltiple (23-oct-2026): «todos» = sin selección; marcar todas las opciones vuelve a «todos».
function segMulti(attr, sel, opts, lblTodos) {
  return `<div class="sv-seg" title="Selección múltiple">${[['__all', lblTodos], ...opts].map(([k, l]) => {
    const on = k === '__all' ? !sel.length : sel.includes(k);
    return `<button data-chip ${attr}="${esc(k)}" class="${on ? 'is-on' : ''}" aria-pressed="${on}">${k !== '__all' && on ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">check</span> ' : ''}${esc(l)}</button>`; }).join('')}</div>`;
}
function toggleMulti(sel, k, total) {
  if (k === '__all') return [];
  const out = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k];
  return out.length === total ? [] : out;
}
function fotoZcap(ctx) {
  const vivo = zcapVivo(ctx);
  if (!CC.snap) CC.snap = new Map([...vivo].map(([k, v]) => [k, v.zcap]));
  let n = 0;
  vivo.forEach((v, k) => { if (!CC.snap.has(k) || Math.abs(num(CC.snap.get(k)) - num(v.zcap)) >= 1) n++; });
  return n;
}
function renderTarifasCliente(container, ctx, modo) {
  const S = modo === 'zfmp' ? ZP : ZI;
  const NG = nombreGrupo(ctx.db);
  function render() {
    const nStale = fotoZcap(ctx);
    const todasT = calcTarifas(ctx, ccEff(ctx.ccfg), CC.snap);              // incluye camión 2 Ton
    const todas = todasT.filter(r => modo !== 'zfmp' || !r.es2t);
    const centros = [...new Set(todas.map(r => r.grupo))].filter(Boolean).sort().map(g => [g, NG[g] || titulo(g)]);
    const q = S.q.trim().toLowerCase();
    const truckOpts = [...(modo === 'zfmp' ? [] : [['2000', '2 t']]), ...CAPS.map(k => [String(k * 1000), CAP_LBL[k]])];
    S.trucks = S.trucks.filter(k => truckOpts.some(([v]) => v === k));
    const pasa = r => (!S.tipos.length || S.tipos.includes((r.clasif || '').toLowerCase())) && (S.centro === 'all' || r.grupo === S.centro)
      && (!S.trucks.length || S.trucks.includes(String(r.capKg))) && (!q || `${r.cod} ${r.ruta.destino}`.toLowerCase().includes(q));
    const orden = (a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.cod.localeCompare(b.cod) || a.capKg - b.capKg;
    const lista = todas.filter(pasa).sort(orden);
    // CSV único de Tarifas $/Kg y Min/Max (23-oct-2026): mismas columnas en ambas vistas, con los filtros activos y el camión 2 Ton
    CC.csvRows = todasT.filter(pasa).sort(orden);
    const n = lista.length || 1;
    const pags = Math.max(1, Math.ceil(lista.length / ZPAGE));
    if (S.pagina >= pags) S.pagina = pags - 1;
    const pag = lista.slice(S.pagina * ZPAGE, (S.pagina + 1) * ZPAGE);
    const prom = f => lista.reduce((s, r) => s + num(r[f]), 0) / n;
    const acciones = `<button class="${nStale ? 'sv-btn-p' : 'sv-btn'}" data-refrescar id="t-refresh" title="${nStale ? 'Tarifas Rutas cambió desde que se tomó la foto del ZCAP' : 'La foto del ZCAP coincide con Tarifas Rutas'}"><span class="material-symbols-outlined">${nStale ? 'refresh' : 'check'}</span>${nStale ? `Refrescar tarifas · ${fmt(nStale)} desactualizadas` : 'Tarifas al día'}</button>
      <button class="sv-btn" data-csv id="t-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button>`;
    const filtros = `<div class="sv-filters">
        <div class="sv-frow">${segMulti('data-ttipo', S.tipos, TIPOS_T, 'Todas')}
          ${segMulti('data-ttruck', S.trucks, truckOpts, 'Todos')}
          <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="t-q" placeholder="Código o destino" value="${esc(S.q)}" style="width:200px"></label></div>
        ${chips(centros, S.centro, 'data-tcentro')}
      </div>`;
    const clPill = r => (r.clusterOp ? `<span class="sv-pill mute"><i style="background:${r.clObj?.color || '#9ca3af'}"></i>${esc(r.clusterOp)}</span>` : '<span class="sv-muted">—</span>')
      + (r.clusterDe ? `<div class="sv-sub">de comuna ${esc(r.clusterDe)}</div>` : (r.clasif === 'Sector' ? '<div class="sv-sub" style="color:#b5000b">sin ruta comuna</div>' : ''));
    let kpis, thead, filas, foot, minW;
    if (modo === 'zfmp') {
      kpis = kpiHtml(false, '', '', 'Combinaciones', fmt(lista.length), 'ruta × camión con el filtro', '#191c1d', false)
        + kpiHtml(false, '', '', '$/kg promedio', kg$(prom('zfmp')), 'ZFMP consolidado', '#b5000b', false)
        + kpiHtml(false, '', '', '$/kg centro promedio', kg$(prom('kgCentro')), 'ponderado por camión', '#1d4ed8', false);
      minW = 1300;
      thead = '<th>Centro origen</th><th>ID ruta</th><th>Destino</th><th>Clasificación</th><th class="r">Distancia KM</th><th>Cluster</th><th>Tipo camión</th><th class="r">ZCAP</th><th class="r">Factor consol.</th><th class="r">Kilos a consolidar</th><th class="r">ZFMP $/kg</th><th class="r">$/kg centro</th>';
      filas = pag.map(r => `<tr style="cursor:default"><td><span class="sv-b">${esc(NG[r.grupo] || titulo(r.grupo))}</span><div class="sv-sub">${esc(r.ruta.origenId || '')}</div></td>
        <td><span class="sv-mono">${esc(r.cod)}</span></td><td><b>${esc(r.ruta.destino || '')}</b></td><td>${clasifPill(r.clasif)}</td><td class="r">${fmt(num(r.ruta.km))}</td>
        <td>${clPill(r)}</td><td style="white-space:nowrap">${esc(r.truck.type)}</td><td class="r">${r.zcap > 0 ? clp(r.zcap) : '—'}</td><td class="r">${fmt(r.factorPct, 1)}%</td>
        <td class="r">${fmt(r.kilos)} kg</td><td class="r"><b style="color:#b5000b">${kg$(r.zfmp)}</b></td><td class="r"><b>${kg$(r.kgCentro)}</b></td></tr>`).join('');
      foot = '<span>ZFMP = ZCAP ÷ (capacidad × factor de consolidación del centro)</span><span>$/kg centro = Σ ZFMP de cada camión × su participación en toneladas del centro</span>';
    } else {
      kpis = kpiHtml(false, '', '', 'Combinaciones', fmt(lista.length), 'ruta × camión con el filtro', '#191c1d', false)
        + kpiHtml(false, '', '', 'ZFMI mín. promedio', clp(prom('zfmi')), 'tarifa mínima por pedido', '#15803d', false)
        + kpiHtml(false, '', '', 'Express promedio', clp(prom('express')), 'camión exclusivo', '#7e22ce', false);
      minW = 1760;
      thead = '<th>Centro origen</th><th>ID ruta</th><th>Destino</th><th>Tipo</th><th>Clasificación</th><th class="r">Dist. KM</th><th>Cluster</th><th>Tipo camión</th><th>Camión mínimo</th><th class="r">ZCAP</th><th class="r">ZFMI mín.</th><th class="r">ZFMX máx.</th><th class="r">Express</th><th class="r">Factor consol.</th><th class="r">Kilos a consolidar</th><th class="r">Kilos tarif. mín.</th>';
      filas = pag.map(r => `<tr style="cursor:default"><td><span class="sv-b">${esc(NG[r.grupo] || titulo(r.grupo))}</span><div class="sv-sub">${esc(r.ruta.origenId || '')}</div></td>
        <td><span class="sv-mono">${esc(r.cod)}</span></td><td><b>${esc(r.ruta.destino || '')}</b></td><td>${esc(r.ruta.tipo || '')}</td><td>${clasifPill(r.clasif)}</td><td class="r">${fmt(num(r.ruta.km))}</td>
        <td>${clPill(r)}${r.clObj ? `<div class="sv-sub">${fmt(r.pedProm, 1)} ped. prom.</div>` : ''}</td><td style="white-space:nowrap">${esc(r.truck.type)}${r.es2t ? `<div class="sv-sub" style="color:#7e22ce">${r.t2Zcap ? 'ZCAP Tarifas por Camión' : 'tarifa plana'}</div>` : ''}</td><td style="white-space:nowrap" class="sv-muted">${esc(r.camionMin)}</td>
        <td class="r">${r.zcap > 0 ? clp(r.zcap) : '—'}</td><td class="r"><b style="color:#15803d">${r.zfmi != null ? clp(r.zfmi) : '—'}</b></td><td class="r"><b>${r.zfmx != null ? clp(r.zfmx) : '—'}</b></td>
        <td class="r"><b style="color:#7e22ce">${r.express != null ? clp(r.express) : '—'}</b>${r.recargo ? `<div class="sv-sub" style="text-align:right">+${fmt(r.recargo)}%</div>` : ''}</td>
        <td class="r">${r.factorPct != null ? fmt(r.factorPct, 1) + '%' : '—'}</td><td class="r">${r.kilos != null ? fmt(r.kilos) + ' kg' : '—'}</td><td class="r">${r.kilosTarifMin != null ? fmt(r.kilosTarifMin) + ' kg' : '—'}</td></tr>`).join('');
      foot = '<span>ZFMI = $/kg del camión mínimo × (kilos a consolidar del camión mínimo ÷ pedidos promedio del cluster)</span><span>ZFMX = ZCAP del camión · Express = ZCAP × (1 + recargo)</span><span>Camión 2 Ton: ZFMI = ZFMX = ZCAP de Tarifas por Camión (rutas regionales) o, si el centro no lo tiene habilitado ahí, máx(km × valor km, costo mínimo) de Frecuencia y Especiales · Express = costo × (1 + recargo)</span>';
    }
    const cuerpo = `<div class="sv-kpis">${kpis}</div>${filtros}
      <div class="sv-card">
        <div class="sv-tablewrap" style="max-height:620px"><table class="sv-table" style="min-width:${minW}px"><thead><tr>${thead}</tr></thead>
          <tbody>${filas || `<tr class="sv-empty"><td colspan="16">Sin combinaciones para los filtros.</td></tr>`}</tbody></table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} combinaciones ruta × camión</span>${pager(lista.length, S.pagina, ZPAGE, 'data-tpag')}</div>
        <div class="tf-card-foot">${foot}</div>
      </div>`;
    container.innerHTML = marco(ctx, modo === 'zfmp'
      ? { titulo: 'Tarifas $/Kg (ZFMP)', desc: 'Tarifa por kilo a clientes por ruta y tipo de camión, sobre la foto del ZCAP vigente.', activo: 'zfmp', acciones, cuerpo }
      : { titulo: 'Tarifa Min/Max (ZFMI)', desc: 'Tarifa mínima y máxima por pedido y tarifa express por ruta y tipo de camión.', activo: 'zfmi', acciones, cuerpo });
    wire(lista);
  }
  function wire(lista) {
    cablear(container, ctx, render);
    // (23-oct-2026, Jordan) Tipos y camiones con selección múltiple
    container.querySelectorAll('[data-ttipo]').forEach(b => b.addEventListener('click', () => { S.tipos = toggleMulti(S.tipos, b.dataset.ttipo, TIPOS_T.length); S.pagina = 0; render(); }));
    container.querySelectorAll('[data-ttruck]').forEach(b => b.addEventListener('click', () => { S.trucks = toggleMulti(S.trucks, b.dataset.ttruck, container.querySelectorAll('[data-ttruck]').length - 1); S.pagina = 0; render(); }));
    container.querySelectorAll('[data-tcentro]').forEach(b => b.addEventListener('click', () => { S.centro = b.dataset.tcentro; S.pagina = 0; render(); }));
    container.querySelectorAll('[data-tpag]').forEach(b => b.addEventListener('click', () => { S.pagina += Number(b.dataset.tpag); render(); }));
    const q = container.querySelector('#t-q');
    q?.addEventListener('input', debounce(() => { S.q = q.value; S.pagina = 0; const pos = q.selectionStart; render(); const n = container.querySelector('#t-q'); n.focus(); n.setSelectionRange(pos, pos); }, 200));
    container.querySelector('#t-refresh')?.addEventListener('click', () => {
      CC.zmap = null; CC.snap = null; CC.memoBase = null;
      fotoZcap(ctx);
      showAlert('Tarifas recalculadas con el ZCAP vigente de Tarifas Rutas.', 'success');
      render();
    });
    container.querySelector('#t-csv')?.addEventListener('click', () => {
      const sep = ';', qq = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const ent = v => (v != null && !isNaN(v) ? Math.round(v) : '');
      const H = ['CENTRO ORIGEN', 'ID RUTA', 'DESTINO', 'TIPO', 'CLASIFICACION', 'COMUNA', 'KM', 'TIPO DE CAMION', 'COSTO RUTA',
        'TARIFA MINIMA', 'TARIFA MAXIMA', 'TARIFA $/KG', 'TARIFA EXPRESS', 'KILOS MINIMOS', 'CLUSTER'];
      const R = (CC.csvRows || []).map(r => [
        NG[r.grupo] || titulo(r.grupo), r.cod, r.ruta.destino || '',
        r.ruta.clasificRuta || '',                                   // Regional / Interregional
        titulo(r.ruta.tipo || ''),                                    // Comuna / Sector
        r.ruta.comuna || r.ruta.destino || '',                        // comuna asociada a la ruta
        num(r.ruta.km), r.truck.type, ent(r.zcap), ent(r.zfmi), ent(r.zfmx),
        r.zfmp != null ? fmt(r.zfmp, 2) : '', ent(r.express),
        r.kilosTarifMin != null ? Math.round(r.kilosTarifMin) : '', r.clusterOp || '']);
      const txt = [H.map(qq).join(sep), ...R.map(r => r.map(qq).join(sep))].join('\n');
      const blob = new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `tarifas_clientes_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });
  }
  render();
}

// ============================================================================
// TARIFAS RETIRO RETORNO (23-oct-2026, Jordan)
// ============================================================================
const RV = { tipos: [], centro: 'all', trucks: [], q: '', pagina: 0 };
const TIPOS_RR = [['comuna', 'Comunas'], ['sector', 'Sectores']];
function renderRetiro(container, ctx) {
  const { db } = ctx;
  const editar = can('editar');
  const NG = nombreGrupo(db);
  const grupos = getOrigenGroups(db);
  function render() {
    const nStale = fotoZcap(ctx);
    const todas = calcRetiro(ctx, ccEff(ctx.ccfg), CC.snap);
    const b = base();
    const centros = [...new Set(todas.map(r => r.grupo))].filter(Boolean).sort().map(g => [g, NG[g] || titulo(g)]);
    const truckOpts = [...new Set(todas.map(r => r.capKg))].sort((x, y) => x - y).map(c => [String(c), fmt(c / 1000) + ' t']);
    RV.trucks = RV.trucks.filter(k => truckOpts.some(([v]) => v === k));
    const q = RV.q.trim().toLowerCase();
    const pasa = r => (!RV.tipos.length || RV.tipos.includes(r.tipoRuta.toLowerCase())) && (RV.centro === 'all' || r.grupo === RV.centro)
      && (!RV.trucks.length || RV.trucks.includes(String(r.capKg))) && (!q || `${r.cod} ${r.ruta.destino} ${r.ruta.comuna || ''}`.toLowerCase().includes(q));
    const orden = (x, y) => (x.grupo || '').localeCompare(y.grupo || '') || x.cod.localeCompare(y.cod) || x.capKg - y.capKg;
    const lista = todas.filter(pasa).sort(orden);
    CC.rrRows = lista;
    const pags = Math.max(1, Math.ceil(lista.length / ZPAGE));
    if (RV.pagina >= pags) RV.pagina = pags - 1;
    const pag = lista.slice(RV.pagina * ZPAGE, (RV.pagina + 1) * ZPAGE);
    const n = lista.length || 1;
    const nMin = lista.filter(r => r.regla === 'Mínimo centro').length;
    const menores = lista.filter(r => r.capKg < 28000);

    const acciones = `<button class="${nStale ? 'sv-btn-p' : 'sv-btn'}" id="rr-refresh" title="${nStale ? 'Tarifas Rutas cambió desde que se tomó la foto del ZCAP' : 'La foto del ZCAP coincide con Tarifas Rutas'}"><span class="material-symbols-outlined">${nStale ? 'refresh' : 'check'}</span>${nStale ? `Refrescar tarifas · ${fmt(nStale)} desactualizadas` : 'Tarifas al día'}</button>
      <button class="sv-btn" data-csv id="rr-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button>`;
    const filtros = `<div class="sv-filters">
        <div class="sv-frow">${segMulti('data-rrtipo', RV.tipos, TIPOS_RR, 'Todas')}
          ${segMulti('data-rrtruck', RV.trucks, truckOpts, 'Todos')}
          <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="rr-q" placeholder="Código, destino o comuna" value="${esc(RV.q)}" style="width:220px"></label></div>
        ${chips(centros, RV.centro, 'data-rrcentro')}
      </div>`;
    const kpis = kpiHtml(false, '', '', 'Combinaciones', fmt(lista.length), 'ruta × camión con el filtro', '#191c1d', false)
      + kpiHtml(false, '', '', 'Retiro promedio', clp(lista.reduce((s, r) => s + r.retiro, 0) / n), 'tarifa retiro retorno', '#b5000b', false)
      + kpiHtml(false, '', '', 'En mínimo', menores.length ? fmt(nMin / menores.length * 100, 0) + '%' : '—', `${fmt(nMin)} de ${fmt(menores.length)} combinaciones 2–15 t`, '#1d4ed8', false);
    const tonoRegla = { 'Ruta íntegra': 'purple', 'Mínimo centro': 'orange', 'Bajo KM base': 'info', 'Sobre KM base': 'ok', '50% km ruta': 'ok' };
    const filas = pag.map(r => `<tr style="cursor:default"><td><span class="sv-b">${esc(NG[r.grupo] || titulo(r.grupo))}</span><div class="sv-sub">${esc(r.ruta.origenId || '')}</div></td>
      <td><span class="sv-mono">${esc(r.cod)}</span></td><td><b>${esc(r.ruta.destino || '')}</b>${r.especial ? `<div class="sv-sub" style="color:#713f12">${esc(String(r.ruta.caracteristica).toUpperCase())}</div>` : ''}</td>
      <td>${pillHtml(r.tipoRuta, r.tipoRuta === 'Sector' ? 'ok' : 'info')}</td><td>${esc(r.ruta.comuna || r.ruta.destino || '')}</td><td class="r">${fmt(r.km)}</td>
      <td style="white-space:nowrap">${esc(r.truck.type)}${r.t2Especiales ? '<div class="sv-sub" style="color:#7e22ce">Frecuencia y Especiales</div>' : ''}</td><td class="r">${clp(r.zcap)}</td>
      <td class="r sv-muted">${r.capKg < 28000 ? fmt(r.a) : '—'}</td><td class="r sv-muted">${r.capKg < 28000 ? clp(r.b) : '—'}</td><td class="r sv-muted">${r.capKg < 28000 ? clp(r.c) : '—'}</td>
      <td class="r sv-muted">${r.capKg < 28000 ? clp(r.rate) : '—'}</td>
      <td class="r">${clp(r.calc)}</td><td class="r sv-muted">${r.minimo != null ? (r.minimo > 0 ? clp(r.minimo) : '—') : '—'}</td>
      <td class="r"><b style="color:#b5000b">${clp(r.retiro)}</b></td><td>${pillHtml(r.regla, tonoRegla[r.regla])}</td></tr>`).join('');
    const cuerpo = `<div class="sv-kpis">${kpis}</div>${filtros}
      <div class="sv-card">
        <div class="sv-tablewrap" style="max-height:620px"><table class="sv-table" style="min-width:1700px"><thead><tr>
          <th>Centro origen</th><th>ID ruta</th><th>Destino</th><th>Tipo</th><th>Comuna</th><th class="r">Dist. KM</th><th>Tipo camión</th><th class="r">Costo ruta</th>
          <th class="r">a. KM base</th><th class="r">b. Costo base</th><th class="r">c. T. base KM</th><th class="r">Tarifa km</th>
          <th class="r">Retiro calculado</th><th class="r">Mínimo centro</th><th class="r">Tarifa retiro</th><th>Regla</th></tr></thead>
          <tbody>${filas || '<tr class="sv-empty"><td colspan="16">Sin combinaciones para los filtros.</td></tr>'}</tbody></table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} combinaciones ruta × camión</span>${pager(lista.length, RV.pagina, ZPAGE, 'data-rrpag')}</div>
        <div class="tf-card-foot"><span>28 t = costo íntegro de la ruta (ZCAP vigente)</span><span>2 a 15 t con T. base KM (c): KM ≤ a → 50% × (b + c) · KM &gt; a → b + 50% × (KM − a) × tarifa km</span><span>2 a 15 t sin T. base KM: 50% × KM × tarifa km · en ambos casos nunca bajo el mínimo del centro</span><span>a, b, c y tarifa km vienen de Tarifas por Camión (tarifa especial en rutas isla / extrema) · el mínimo por centro se configura en Frecuencia y Especiales</span><span>Camión 2 Ton de Frecuencia y Especiales: costo ruta = máx(km × valor km, costo mínimo) · retiro = 50% × km × valor km</span></div>
      </div>`;
    container.innerHTML = marco(ctx, { titulo: 'Tarifas Retiro Retorno', desc: 'Tarifa de retiro por ruta regional (comuna o sector) y tipo de camión habilitado en cada centro.', activo: 'retiro', acciones, cuerpo });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablear(container, ctx, render);
    container.querySelectorAll('[data-rrtipo]').forEach(b => b.addEventListener('click', () => { RV.tipos = toggleMulti(RV.tipos, b.dataset.rrtipo, TIPOS_RR.length); RV.pagina = 0; render(); }));
    container.querySelectorAll('[data-rrtruck]').forEach(b => b.addEventListener('click', () => { RV.trucks = toggleMulti(RV.trucks, b.dataset.rrtruck, container.querySelectorAll('[data-rrtruck]').length - 1); RV.pagina = 0; render(); }));
    container.querySelectorAll('[data-rrcentro]').forEach(b => b.addEventListener('click', () => { RV.centro = b.dataset.rrcentro; RV.pagina = 0; render(); }));
    container.querySelectorAll('[data-rrpag]').forEach(b => b.addEventListener('click', () => { RV.pagina += Number(b.dataset.rrpag); render(); }));
    const q = container.querySelector('#rr-q');
    q?.addEventListener('input', debounce(() => { RV.q = q.value; RV.pagina = 0; const pos = q.selectionStart; render(); const n = container.querySelector('#rr-q'); n.focus(); n.setSelectionRange(pos, pos); }, 200));
    container.querySelector('#rr-refresh')?.addEventListener('click', () => {
      CC.zmap = null; CC.snap = null; CC.memoBase = null;
      fotoZcap(ctx);
      showAlert('Tarifas recalculadas con el ZCAP vigente de Tarifas Rutas.', 'success');
      render();
    });
    container.querySelector('#rr-csv')?.addEventListener('click', () => {
      const sep = ';', qq = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const ent = v => (v != null && !isNaN(v) ? Math.round(v) : '');
      const menor = r => r.capKg < 28000;
      const H = ['CENTRO ORIGEN', 'ID RUTA', 'DESTINO', 'TIPO', 'COMUNA', 'KM', 'TIPO DE CAMION', 'COSTO RUTA', 'KM BASE', 'COSTO BASE', 'T. BASE KM', 'TARIFA KM',
        'RETIRO CALCULADO', 'MINIMO CENTRO', 'TARIFA RETIRO', 'REGLA'];
      const R = (CC.rrRows || []).map(r => [NG[r.grupo] || titulo(r.grupo), r.cod, r.ruta.destino || '', r.tipoRuta, r.ruta.comuna || r.ruta.destino || '',
        num(r.km), r.truck.type, ent(r.zcap), menor(r) ? ent(r.a) : '', menor(r) ? ent(r.b) : '', menor(r) ? ent(r.c) : '', menor(r) ? ent(r.rate) : '',
        ent(r.calc), r.minimo != null ? ent(r.minimo) : '', ent(r.retiro), r.regla]);
      const txt = [H.map(qq).join(sep), ...R.map(r => r.map(qq).join(sep))].join('\n');
      const blob = new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `tarifas_retiro_retorno_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });
  }
  render();
}

// ── Punto de entrada ────────────────────────────────────────────────────────
export function renderClientesV2(container, sub, ctx) {
  initDraft(ctx.ccfg);
  CC.zmap = null;           // el ZCAP vivo se recalcula al entrar (Tarifas Rutas pudo cambiar)
  // (23-oct-2026, Jordan) La foto del ZCAP se retoma al entrar: los ajustes guardados en
  // Tarifas por Camión / Tarifas Rutas / Motor de Costos se reflejan de inmediato en
  // $/Kg, Min/Max, Express y el CSV, sin depender de «Refrescar tarifas».
  CC.snap = null;
  CC.memoBase = null;
  setParamPill(ctx.cfg);
  switch (sub) {
    case 'historico':     renderHistorico(container, ctx); break;
    case 'consolidacion': renderConsolidacion(container, ctx); break;
    case 'densidad':      renderDensidad(container, ctx); break;
    case 'especiales':    renderEspeciales(container, ctx); break;
    case 'cluster':       renderCluster(container, ctx); break;
    case 'zfmi':          renderTarifasCliente(container, ctx, 'zfmi'); break;
    case 'retiro':        renderRetiro(container, ctx); break;
    default:              renderTarifasCliente(container, ctx, 'zfmp');
  }
}
