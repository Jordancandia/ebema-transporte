// ============================================================================
// INDICADORES – PLAN DE CARGA  (dashboard ejecutivo, 27-sep-2026)
// ----------------------------------------------------------------------------
// Fuente: v_ind_consolidacion_dt (1 fila por DT) y v_ind_efectividad_plan
// (1 fila por línea documento+SKU de la foto 15:35; sólo camiones programados:
// camión CD en PROGRAMAR, 2º camión aceptado y camiones directos — columna medido).
// Alcance: DT cuyo usuario responsable está en abast_ind_usuarios_plan (activo).
//   Usuario del DT = "Creado por" del reporte DT > "Modif. por" > creador de
//   sus entregas (v_abast_dt_usuario). La lista es editable (OWNER / ADMIN).
// Capacidad: GeEs del DT; si viene vacía y es traslado → 28 t (15 t a 1050/1005),
//   misma regla del Plan de Carga, marcada como "estimada".
// (30-sep-2026, Jordan) Modo "Asertividad del plan": por día de carga y centro
// programado (foto de cierre 15:30 → abast_plan_foto), asertividad = SKU cuya
// cantidad en el DT ≥ cantidad planificada (1) o no (0); consolidación = % del DT
// del camión. Se abre el camión para ver el detalle por SKU (v_ind_plan_asert_sku).
// Semanas cerradas: sólo resultado por camión (abast_ind_plan_camion_hist).
// Sin dependencias: gráficos SVG propios + CSS encapsulado (.ipc-*), porque el
// Tailwind del sitio está compilado y no incluye clases nuevas.
// ============================================================================

import { supabase } from './supabase-client.js?v=202610091449';
import { filtrarPorCentro, getRol } from './permisos.js?v=202610091449';
import { showAlert, escapeHtml } from './utils.js';
import { getDatabase } from './data.js?v=202610091449';
import { truckGauge } from './troncales-ui.js?v=202610091449';

const META_CONS = 85;   // % consolidación objetivo por viaje
const META_EFEC = 90;   // % efectividad objetivo del Plan de Carga

const C = {
  series: '#191c1d', good: '#15803d', warn: '#ca8a04', bad: '#b5000b', info: '#1d4ed8', neutral: '#9ca3af',
  grid: '#edeeef', axis: '#5c5f61', ink: '#191c1d', ink2: '#5c5f61',
};
const CAT = ['#191c1d', '#b5000b', '#1d4ed8', '#ca8a04', '#7e22ce', '#15803d', '#ea580c', '#936e69'];
const ESTADOS = [
  { k: 'CUMPLE', lbl: 'Cumple', color: C.good },
  { k: 'PARCIAL', lbl: 'Parcial', color: C.warn },
  { k: 'CON ENTREGA SIN DT', lbl: 'Con entrega sin DT', color: C.info },
  { k: 'NO CARGADO', lbl: 'No cargado', color: C.bad },
];

// ── estado ─────────────────────────────────────────────────────────────────
const S = {
  desde: '', hasta: '', usuario: 'all', centro: 'all', tipo: 'all', cd: 'all', soloAlcance: true,
  cons: [], asert: [], usuarios: [], abiertos: new Set(), skuCache: new Map(), canEdit: false, vista: 'dash', detalleModo: 0, modo: 'cons',
};
let root = null, opts = {}, resizeT = null, onResize = null;

// ── utilidades ─────────────────────────────────────────────────────────────
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (n, d = 1) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => n == null ? '—' : fmt(n, d) + '%';
const ddmm = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}` : s; };
const ddmmyy = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : s; };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const semaforo = (v, meta, amarillo) => v == null ? C.neutral : v >= meta ? C.good : v >= amarillo ? C.warn : C.bad;
const semaforoTxt = (v, meta, amarillo) => v == null ? 'Sin datos' : v >= meta ? 'Sobre meta' : v >= amarillo ? 'Cerca de meta' : 'Bajo meta';
const semaforoIco = (v, meta, amarillo) => v == null ? 'remove' : v >= meta ? 'check_circle' : v >= amarillo ? 'error' : 'cancel';
const esc = s => escapeHtml(String(s ?? ''));

async function fetchPag(vista, build) {
  const size = 1000; let out = [];
  for (let p = 0; p < 200; p++) {
    const { data, error } = await build(supabase.from(vista).select('*')).range(p * size, p * size + size - 1);
    if (error) { console.error(error); showAlert('Error al cargar ' + vista + ': ' + error.message, 'error'); break; }
    out = out.concat(data || []);
    if (!data || data.length < size) break;
  }
  return out;
}

// ── entrada ────────────────────────────────────────────────────────────────
export async function renderIndPlanCarga(stage, options = {}) {
  root = stage; opts = options;
  const rol = getRol();
  S.canEdit = rol === 'OWNER' || rol === 'ADMIN';
  if (!S.desde) {
    const h = new Date(); const d = new Date(); d.setDate(d.getDate() - 30);
    S.desde = iso(d); S.hasta = iso(h);
  }
  root.innerHTML = `${css()}<div class="ipc"><div class="ipc-load">Cargando indicadores…</div></div>`;
  await cargar();
  pintar();
  if (onResize) window.removeEventListener('resize', onResize);
  onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (root && root.isConnected && S.vista === 'dash') pintarGraficos(); }, 180); };
  window.addEventListener('resize', onResize);
}

async function cargar() {
  const [cons, efec, usr] = await Promise.all([
    fetchPag('v_ind_consolidacion_dt', q => q.gte('fecha_creacion', S.desde).lte('fecha_creacion', S.hasta).order('fecha_creacion')),
    fetchPag('v_ind_plan_asert_resumen', q => q.gte('fecha_carga', S.desde).lte('fecha_plan', S.hasta).order('fecha_carga')), // incluye cargas de mañana ya planificadas
    supabase.from('abast_ind_usuarios_plan').select('*').order('usuario'),
  ]);
  S.cons = filtrarPorCentro(cons, 'centro_expedicion');
  S.asert = filtrarPorCentro(efec, 'ce');
  S.skuCache.clear();
  S.usuarios = usr.data || [];
}

// ── filtros ────────────────────────────────────────────────────────────────
function usuariosActivos() { return S.usuarios.filter(u => u.activo).map(u => u.usuario); }
function consFiltrado() {
  return S.cons.filter(r => {
    if (S.soloAlcance && !r.en_alcance) return false;
    if (S.usuario !== 'all' && r.usuario_dt !== S.usuario) return false;
    if (S.centro !== 'all' && String(r.centro_expedicion) !== S.centro) return false;
    if (S.tipo !== 'all' && r.tipo_despacho !== S.tipo) return false;
    return true;
  });
}
function asertFiltrado() {
  return S.asert.filter(r => S.cd === 'all' || String(r.cd_origen) === S.cd);
}
const pctA = r => r.pct_asertividad == null ? null : Number(r.pct_asertividad) * 100;
const pctC = r => r.pct_consolidacion == null ? null : Number(r.pct_consolidacion) * 100;
const medido = r => r.estado !== 'EN CURSO';
const pctRow = r => r.pct_consolidacion == null ? null : Number(r.pct_consolidacion) * 100;

function enlazar(box) {
  box.querySelectorAll('[data-usr]').forEach(b => b.onclick = () => { S.usuario = b.dataset.usr; pintar(); });
  box.querySelectorAll('[data-cen]').forEach(b => b.onclick = () => { S.centro = b.dataset.cen; pintar(); });
  box.querySelectorAll('[data-tip]').forEach(b => b.onclick = () => { S.tipo = b.dataset.tip; pintar(); });
  box.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { S.cd = b.dataset.cd; pintar(); });
  box.querySelectorAll('[data-dias]').forEach(b => b.onclick = async () => {
    const d = new Date(); d.setDate(d.getDate() - Number(b.dataset.dias)); S.desde = iso(d); S.hasta = iso(new Date());
    await recargar();
  });
  box.querySelectorAll('input[data-f="desde"],input[data-f="hasta"]').forEach(i => i.onchange = async () => {
    if (!i.value) return; S[i.dataset.f] = i.value; if (S.desde > S.hasta) [S.desde, S.hasta] = [S.hasta, S.desde];
    await recargar();
  });
  const solo = box.querySelector('input[data-f="solo"]');
  if (solo) solo.onchange = () => { S.soloAlcance = solo.checked; S.usuario = 'all'; pintar(); };
  const bv = box.querySelector('[data-act="vista"]');
  if (bv) bv.onclick = () => { S.vista = S.vista === 'dash' ? 'detalle' : 'dash'; pintar(); };
  const bu = box.querySelector('[data-act="usuarios"]');
  if (bu) bu.onclick = () => modalUsuarios();
}

async function recargar() {
  root.querySelector('.ipc-kpis') && (root.querySelector('.ipc-kpis').innerHTML = '<div class="ipc-load">Actualizando…</div>');
  await cargar(); pintar();
}

// ── pintado general (rediseño v2 29-sep-2026: selector de modo Consolidación /
//    Efectividad, tarjetas, barras diarias con línea de meta y tabla por sucursal)
function pintar() {
  const box = root.querySelector('.ipc');
  const act = usuariosActivos();
  const universoUsr = S.soloAlcance ? act : [...new Set(S.cons.map(r => r.usuario_dt).filter(Boolean))].sort();
  const centros = [...new Set(S.cons.map(r => String(r.centro_expedicion || '')).filter(Boolean))].sort();
  const tipos = [...new Set(S.cons.map(r => r.tipo_despacho).filter(Boolean))].sort();
  const cds = [...new Set(S.asert.map(r => String(r.cd_origen || '')).filter(Boolean))].sort();
  const chip = (v, lbl, sel, attr) => `<button class="sv-chip ${sel ? 'is-on' : ''}" data-chip data-${attr}="${esc(v)}">${esc(lbl)}</button>`;
  const cons = S.modo === 'cons';

  box.innerHTML = `
  <div class="sv-vhead">
    <div style="min-width:0">
      <h1 class="sv-h1">Indicadores Plan de Carga</h1>
      <div class="sv-desc">${!cons ? 'Foto del cierre del plan (15:30) vs Documento de Transporte del día de carga · por día de carga' : S.soloAlcance
        ? `DT de: <b>${act.length ? act.map(esc).join(' · ') : 'sin usuarios configurados'}</b>`
        : 'Todos los DT (todos los usuarios)'} · ${ddmmyy(S.desde)} a ${ddmmyy(S.hasta)}</div>
    </div>
    <div class="sv-actions">
      ${S.vista === 'dash' ? `<div class="sv-seg" role="group" aria-label="Indicador">
        <button data-chip data-modo-ipc="cons" class="${cons ? 'is-on' : ''}"><span class="material-symbols-outlined">local_shipping</span>Consolidación</button>
        <button data-chip data-modo-ipc="efec" class="${!cons ? 'is-on' : ''}"><span class="material-symbols-outlined">task_alt</span>Asertividad del plan</button></div>` : ''}
      ${S.canEdit ? '<button class="sv-btn" data-chip data-act="usuarios"><span class="material-symbols-outlined">group</span>Usuarios</button>' : ''}
      <button class="sv-btn" data-chip data-act="vista"><span class="material-symbols-outlined">${S.vista === 'dash' ? 'table_view' : 'insights'}</span>${S.vista === 'dash' ? 'Ver detalle' : 'Ver dashboard'}</button>
    </div>
  </div>
  ${S.vista === 'detalle' ? '<div class="ipc-detalle"></div>' : `
  <div class="sv-filters">
    <div class="sv-frow">
      <div class="sv-inp"><span class="material-symbols-outlined">date_range</span><span class="sv-sep">Período</span>
        <input type="date" data-f="desde" value="${S.desde}" aria-label="Desde"><span class="sv-sep">–</span><input type="date" data-f="hasta" value="${S.hasta}" aria-label="Hasta"></div>
      ${[7, 30, 90].map(n => `<button class="sv-chip" data-chip data-dias="${n}">${n} días</button>`).join('')}
      ${cons ? `<label class="ipc-check"><input type="checkbox" data-f="solo" ${S.soloAlcance ? 'checked' : ''}> Solo usuarios configurados</label>` : ''}
    </div>
    ${cons ? `<div class="sv-frow"><span class="sv-flbl">Usuario</span>${chip('all', 'Todos', S.usuario === 'all', 'usr')}${universoUsr.map(u => chip(u, u, S.usuario === u, 'usr')).join('')}</div>` : ''}
    ${cons ? `<div class="sv-frow"><span class="sv-flbl">Centro exp.</span>${chip('all', 'Todos', S.centro === 'all', 'cen')}${centros.map(c => chip(c, c, S.centro === c, 'cen')).join('')}
      ${tipos.length > 1 ? `<span class="sv-flbl" style="margin-left:12px">Tipo</span>${chip('all', 'Todos', S.tipo === 'all', 'tip')}${tipos.map(t => chip(t, t, S.tipo === t, 'tip')).join('')}` : ''}</div>`
    : (cds.length > 1 ? `<div class="sv-frow"><span class="sv-flbl">CD origen</span>${chip('all', 'Todos', S.cd === 'all', 'cd')}${cds.map(c => chip(c, 'CD ' + c, S.cd === c, 'cd')).join('')}</div>` : '')}
  </div>
  <div class="sv-kpis ipc-kpis"></div>
  ${cons ? `
  <section class="sv-card ipc-card"><h3>Consolidación diaria de camiones <small>promedio simple por DT · meta ${META_CONS}%</small></h3><div class="ipc-chart" data-ch="diaria"></div></section>
  <section class="sv-card ipc-card"><h3>Por sucursal destino <small>consolidación promedio · Δ segunda mitad del período vs primera</small></h3><div data-ch="suc"></div></section>
  <div class="ipc-grid">
    <section class="sv-card ipc-card"><h3>Por usuario <small>% consolidación · DT · t</small></h3><div class="ipc-chart" data-ch="usuario"></div></section>
    <section class="sv-card ipc-card"><h3>Distribución de viajes <small>DT por rango de consolidación</small></h3><div class="ipc-chart" data-ch="dist"></div></section>
  </div>
  <section class="sv-card ipc-card"><h3>Viajes bajo meta <small>DT con menor consolidación en el período</small></h3><div data-ch="bajo"></div></section>
  <p class="ipc-note">Capacidad = GeEs del DT; si viene vacía en un traslado se usa 28 t (15 t a 1050/1005) y el DT se marca <i>estimada</i>.
  Ton por línea = máx(peso bruto, peso volumétrico) × cantidad; tope 100% por DT.</p>` : `
  <section class="sv-card ipc-card"><h3>Asertividad diaria del despacho <small>por día de carga · sólo camiones programados · meta ${META_EFEC}%</small></h3><div class="ipc-chart" data-ch="diariaAsert"></div></section>
  <section class="sv-card ipc-card"><h3>Camiones programados por día de carga <small>abra un camión para ver el detalle por SKU</small></h3><div data-ch="camiones"></div></section>
  <p class="ipc-note">Foto del cierre del plan (15:30): sólo camiones en estado Programar (y 2º camión aceptado / camiones directos) y sólo productos incluidos; los que exceden no se consideran.
  Asertividad por SKU: 1 si la cantidad en el Documento de Transporte del día de carga es igual o mayor a la planificada, 0 si no; la del camión es el promedio de sus SKU.
  Consolidación = % de consolidación del DT del camión. Las semanas cerradas guardan sólo el resultado por camión (sin detalle).</p>`}
  `}
  <div class="ipc-tip" hidden></div>`;

  enlazar(box);
  box.querySelectorAll('[data-modo-ipc]').forEach(b => b.onclick = () => { if (S.modo === b.dataset.modoIpc) return; S.modo = b.dataset.modoIpc; pintar(); });
  if (S.vista === 'dash') { pintarKpis(); pintarGraficos(); }
  else if (opts.renderDetalle) opts.renderDetalle(box.querySelector('.ipc-detalle'), S.modo === 'efec' ? 1 : S.detalleModo);
}

// ── KPIs ───────────────────────────────────────────────────────────────────
function pintarKpis() {
  const tile = (lbl, val, sub, dot, extra = '') => `<div class="sv-kpi" style="cursor:default">
      <div class="sv-kpi-l"><i style="background:${dot}"></i>${lbl}</div>
      <div class="sv-kpi-v">${val}</div><div class="sv-kpi-s">${sub}</div>${extra}</div>`;
  const meter = (v, meta, color) => v == null ? '' : `<div class="ipc-meter"><i style="width:${Math.min(100, v)}%;background:${color}"></i><b style="left:${meta}%"></b></div>`;
  if (S.modo === 'cons') {
    const rows = consFiltrado();
    const vals = rows.map(pctRow).filter(v => v != null);
    const cons = avg(vals);
    const ton = rows.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0);
    const sobre = vals.filter(v => v >= META_CONS).length;
    const dias = diasCons(rows).filter(d => d.v != null);
    const bajo = dias.filter(d => d.v < META_CONS);
    const ult = bajo.length ? bajo[bajo.length - 1] : null;
    const nLin = rows.reduce((s, r) => s + (Number(r.n_lineas) || 0), 0);
    const sinPeso = rows.reduce((s, r) => s + (Number(r.lineas_sin_peso) || 0), 0);
    const sinCap = rows.filter(r => pctRow(r) == null).length;
    const col = semaforo(cons, META_CONS, 70);
    root.querySelector('.ipc-kpis').innerHTML =
      tile('Consolidación promedio', pct(cons), `<span style="color:${col};font-weight:700">${semaforoTxt(cons, META_CONS, 70)}</span> · ${sobre} de ${vals.length} viajes ≥ ${META_CONS}%`, C.ink, meter(cons, META_CONS, col))
      + tile('Viajes (DT)', fmt(rows.length, 0), `${fmt(ton, 0)} t transportadas · ${fmt(rows.length ? ton / rows.length : null, 1)} t/viaje`, C.ink2)
      + tile('Días bajo meta', `${bajo.length} de ${dias.length}`, ult ? `último: ${ddmmyy(ult.f)} (${pct(ult.v, 0)})` : 'todos los días sobre meta', C.warn)
      + tile('Calidad del dato', pct(nLin ? (nLin - sinPeso) / nLin * 100 : null, 0), `líneas con peso maestro · ${sinCap} DT sin capacidad`, C.neutral);
  } else {
    const rows = asertFiltrado();
    const med = rows.filter(medido);
    const asert = avg(med.map(pctA).filter(v => v != null));
    const consV = avg(med.map(pctC).filter(v => v != null));
    const nSku = med.reduce((s, r) => s + (Number(r.n_sku) || 0), 0), nOk = med.reduce((s, r) => s + (Number(r.n_acierto) || 0), 0);
    const col = semaforo(asert, META_EFEC, 75), colC = semaforo(consV, META_CONS, 70);
    root.querySelector('.ipc-kpis').innerHTML =
      tile('Asertividad del despacho', pct(asert), `<span style="color:${col};font-weight:700">${semaforoTxt(asert, META_EFEC, 75)}</span> · promedio por camión`, C.ink, meter(asert, META_EFEC, col))
      + tile('Consolidación camiones', pct(consV), `<span style="color:${colC};font-weight:700">${semaforoTxt(consV, META_CONS, 70)}</span> · DT de los camiones programados`, C.ink2, meter(consV, META_CONS, colC))
      + tile('Camiones medidos', fmt(med.length, 0), `${fmt(rows.length - med.length, 0)} en curso (aún sin DT)`, C.ink2)
      + tile('SKU acertados', `${fmt(nOk, 0)} de ${fmt(nSku, 0)}`, nSku ? `${pct(nOk / nSku * 100, 0)} de los SKU planificados` : 'sin SKU medidos', C.good);
  }
}

// ── gráficos ───────────────────────────────────────────────────────────────
function pintarGraficos() {
  const q = k => root.querySelector(`[data-ch="${k}"]`);
  if (S.modo === 'cons') {
    const rows = consFiltrado();
    chDiaria(q('diaria'), rows);
    tablaSucCons(q('suc'), rows);
    chUsuario(q('usuario'), rows);
    chDist(q('dist'), rows);
    tablaBajo(q('bajo'), rows);
  } else {
    const rows = asertFiltrado();
    chDiariaAsert(q('diariaAsert'), rows);
    tablaCamiones(q('camiones'), rows);
  }
  tooltips();
}
const vacio = el => { el.innerHTML = '<div class="ipc-empty">Sin datos para los filtros seleccionados</div>'; };

function diasCons(rows) {
  const by = new Map();
  rows.forEach(r => { const f = String(r.fecha_creacion).slice(0, 10); (by.get(f) || by.set(f, []).get(f)).push(r); });
  return [...by.keys()].sort().map(f => {
    const rs = by.get(f); const v = rs.map(pctRow).filter(x => x != null);
    return { f, v: avg(v), n: rs.length, t: rs.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0) };
  });
}
// Barras diarias con línea de meta punteada: verde sobre la meta, amarillo bajo la meta.
function barrasDiarias(el, pts, meta, ttFn) {
  if (!pts.length) return vacio(el);
  const W = Math.max(300, el.clientWidth), H = 200, m = { l: 40, r: 14, t: 14, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const step = iw / pts.length, x = i => m.l + step * (i + .5), bw = Math.max(4, Math.min(34, step * .62));
  const y = v => m.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  let s = `<svg width="${W}" height="${H}" role="img">`;
  [0, 50, 100].forEach(g => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(g)}" y2="${y(g)}" stroke="${C.grid}"/><text x="${m.l - 6}" y="${y(g) + 4}" text-anchor="end" class="ipc-ax">${g}%</text>`; });
  const every = Math.ceil(pts.length / Math.max(1, Math.floor(iw / 44)));
  pts.forEach((p, i) => {
    if (p.v != null) {
      const top = y(p.v), h = m.t + ih - top;
      s += `<path d="M${x(i) - bw / 2},${m.t + ih} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${Math.max(0, h - 3)} z" fill="${p.v >= meta ? C.good : C.warn}"/>`;
      if (step > 30) s += `<text x="${x(i)}" y="${top - 5}" text-anchor="middle" class="ipc-val">${fmt(p.v, 0)}</text>`;
    } else if (p.plazo) {
      s += `<rect x="${x(i) - bw / 2}" y="${m.t + ih - 14}" width="${bw}" height="14" rx="3" fill="#e7e8e9"/>`;
      if (step > 30) s += `<text x="${x(i)}" y="${m.t + ih - 20}" text-anchor="middle" class="ipc-ax">en plazo</text>`;
    }
    if (i % every === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ipc-ax">${ddmm(p.f)}</text>`;
    s += `<rect x="${x(i) - step / 2}" y="${m.t}" width="${step}" height="${ih}" fill="transparent" data-tt="${esc(ttFn(p))}"/>`;
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(meta)}" y2="${y(meta)}" stroke="${C.ink}" stroke-dasharray="5 4" stroke-width="1.2"/>
        <text x="${W - m.r}" y="${y(meta) - 5}" text-anchor="end" class="ipc-ax" style="fill:${C.ink};font-weight:700">Meta ${meta}%</text>`;
  el.innerHTML = s + '</svg>';
}
function chDiaria(el, rows) {
  barrasDiarias(el, diasCons(rows), META_CONS, p => `<b>${ddmmyy(p.f)}</b><br>Consolidación: <b>${pct(p.v)}</b><br>Viajes: ${p.n}<br>Toneladas: ${fmt(p.t, 1)} t`);
}
function chDiariaEfec(el, rows) {
  const g = new Map();
  rows.forEach(r => { const f = String(r.fecha).slice(0, 10); (g.get(f) || g.set(f, []).get(f)).push(r); });
  const pts = [...g.keys()].sort().map(f => {
    const rs = g.get(f), med = rs.filter(r => r.estado !== 'EN PLAZO'), ok = med.filter(r => r.linea_cumple).length;
    return { f, v: med.length ? ok / med.length * 100 : null, plazo: rs.length - med.length > 0 && !med.length, n: rs.length, med: med.length, ok };
  });
  barrasDiarias(el, pts, META_EFEC, p => `<b>Plan ${ddmmyy(p.f)}</b><br>${p.v == null ? 'Sigue en plazo (48 h hábiles)' : `Efectividad: <b>${pct(p.v)}</b>`}<br>Líneas: ${p.n} · medidas ${p.med} · cumplen ${p.ok}`);
}

function chDiariaAsert(el, rows) {
  const g = new Map();
  rows.forEach(r => { const f = String(r.fecha_carga).slice(0, 10); (g.get(f) || g.set(f, []).get(f)).push(r); });
  const pts = [...g.keys()].sort().map(f => {
    const rs = g.get(f), med = rs.filter(medido);
    return { f, v: avg(med.map(pctA).filter(v => v != null)), c: avg(med.map(pctC).filter(v => v != null)), plazo: !med.length, n: rs.length, med: med.length };
  });
  barrasDiarias(el, pts, META_EFEC, p => `<b>Carga ${ddmmyy(p.f)}</b><br>${p.v == null ? 'En curso (aún sin DT)' : `Asertividad: <b>${pct(p.v)}</b><br>Consolidación: <b>${pct(p.c)}</b>`}<br>Camiones: ${p.n} · medidos ${p.med}`);
}

const keyCam = r => [r.fecha_plan, r.cd_origen, r.ce, r.camion].join('|');
function celdaPct(v, meta, amarillo) {
  return v == null ? '<span class="sv-muted">—</span>' : `<div class="ipc-mini"><i style="width:${Math.min(100, v)}%;background:${semaforo(v, meta, amarillo)}"></i></div><b>${pct(v, 0)}</b>`;
}
function tablaCamiones(el, rows) {
  if (!rows.length) return vacio(el);
  const dias = new Map();
  rows.forEach(r => { const f = String(r.fecha_carga).slice(0, 10); (dias.get(f) || dias.set(f, []).get(f)).push(r); });
  const estTag = r => r.historico ? '<span class="ipc-tag">histórico</span>'
    : r.estado === 'EN CURSO' ? '<span class="ipc-tag warn">en curso</span>'
    : r.estado === 'SIN DT' ? '<span class="ipc-tag bad">sin DT</span>' : '<span class="ipc-tag ok">con DT</span>';
  const html = [...dias.keys()].sort().reverse().map(f => {
    const rs = dias.get(f).sort((a, b) => String(a.cd_origen).localeCompare(String(b.cd_origen)) || String(a.ce).localeCompare(String(b.ce)) || String(a.camion).localeCompare(String(b.camion)));
    const med = rs.filter(medido);
    const vA = avg(med.map(pctA).filter(v => v != null)), vC = avg(med.map(pctC).filter(v => v != null));
    const etiquetas = [...new Set(rs.map(r => r.etiqueta))];
    const filas = rs.map(r => {
      const k = keyCam(r), open = S.abiertos.has(k);
      return `<tr class="ipc-cam ${r.historico ? '' : 'is-click'}" ${r.historico ? '' : `data-cam="${esc(k)}"`}>
        <td>${r.historico ? '' : `<span class="material-symbols-outlined ipc-chev">${open ? 'expand_more' : 'chevron_right'}</span>`}<span class="sv-b">${esc(nombreCentro(r.ce))}</span> <span class="sv-sub" style="display:inline">${esc(r.ce)}</span></td>
        <td>CD ${esc(r.cd_origen)}</td><td><b>${esc(r.camion)}</b></td>
        <td class="r">${fmt(r.ton_plan, 1)} t <span class="sv-muted">(${pct(r.pct_ocupacion_plan == null ? null : r.pct_ocupacion_plan * 100, 0)} de ${fmt(r.cap, 0)} t)</span></td>
        <td class="r">${r.n_acierto ?? 0} / ${r.n_sku ?? 0}</td>
        <td>${medido(r) ? celdaPct(pctA(r), META_EFEC, 75) : '<span class="sv-muted">—</span>'}</td>
        <td>${celdaPct(pctC(r), META_CONS, 70)}</td>
        <td>${esc(r.transportes || '—')}</td><td>${estTag(r)}</td></tr>
        ${open ? `<tr class="ipc-det"><td colspan="9"><div data-sku="${esc(k)}"><div class="ipc-load">Cargando detalle…</div></div></td></tr>` : ''}`;
    }).join('');
    return `<div class="ipc-dia"><div class="ipc-diah"><b>Carga día ${ddmmyy(f)}</b><span class="ipc-etq">${etiquetas.map(esc).join(' · ')}</span>
        <span class="ipc-diak">Asertividad <b style="color:${semaforo(vA, META_EFEC, 75)}">${pct(vA, 0)}</b> · Consolidación <b style="color:${semaforo(vC, META_CONS, 70)}">${pct(vC, 0)}</b> · ${rs.length} camiones</span></div>
      <div class="ipc-scroll"><table class="ipc-tbl"><thead><tr><th>Centro</th><th>Origen</th><th>Camión</th><th class="r">Carga plan</th><th class="r">SKU OK</th><th>Asertividad</th><th>Consolidación</th><th>Doc. transporte</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;
  }).join('');
  el.innerHTML = html;
  el.querySelectorAll('[data-cam]').forEach(tr => tr.onclick = () => {
    const k = tr.dataset.cam; S.abiertos.has(k) ? S.abiertos.delete(k) : S.abiertos.add(k);
    tablaCamiones(el, rows); tooltips();
  });
  el.querySelectorAll('[data-sku]').forEach(d => detalleSku(d, d.dataset.sku));
}
async function detalleSku(box, k) {
  let data = S.skuCache.get(k);
  if (!data) {
    const [fp, cd, ce, cam] = k.split('|');
    const { data: d, error } = await supabase.from('v_ind_plan_asert_sku').select('*')
      .eq('fecha_plan', fp).eq('cd_origen', cd).eq('ce', ce).eq('camion', cam).order('material');
    if (error) { box.innerHTML = `<div class="ipc-empty">Error: ${esc(error.message)}</div>`; return; }
    data = d || []; S.skuCache.set(k, data);
  }
  if (!data.length) { box.innerHTML = '<div class="ipc-empty">Sin detalle (semana cerrada)</div>'; return; }
  const est = { 'CUMPLE': C.good, 'PARCIAL': C.warn, 'CON ENTREGA SIN DT': C.info, 'EN CURSO': C.neutral, 'NO CARGADO': C.bad };
  box.innerHTML = `<table class="ipc-tbl ipc-sku"><thead><tr><th>SKU</th><th>Material</th><th>Pedido traslado / doc.</th><th>Pedido venta</th><th class="r">Cant. plan</th><th class="r">Ton plan</th>
      <th>Entregas</th><th class="r">Cant. entrega</th><th>DT</th><th class="r">Cant. DT</th><th class="r">Asertividad</th><th class="r">Consolidación</th><th>Estado</th></tr></thead><tbody>
    ${data.map(r => `<tr><td><b>${esc(r.material)}</b></td><td>${esc(r.nombre || '')}</td><td>${esc(r.documentos || '')}</td><td>${esc(r.pedidos_venta || '—')}</td>
      <td class="r">${fmt(r.cant_plan, 0)}</td><td class="r">${fmt(r.ton_plan, 2)}</td><td>${esc(r.entregas || '—')}</td><td class="r">${fmt(r.cant_entregada, 0)}</td>
      <td>${esc(r.transportes || '—')}</td><td class="r">${fmt(r.cant_dt, 0)}</td>
      <td class="r"><span class="ipc-bin ${Number(r.acierto) === 1 ? 'ok' : ''}">${Number(r.acierto) === 1 ? '1' : '0'}</span></td>
      <td class="r">${r.pct_consolidacion == null ? '—' : pct(Number(r.pct_consolidacion) * 100, 1)}</td>
      <td><span class="ipc-dot" style="background:${est[r.estado] || C.neutral}"></span>${esc(r.estado)}</td></tr>`).join('')}
  </tbody></table>`;
}

function nombreCentro(id) {
  const c = (getDatabase().logisticsCentres || []).find(x => String(x.id) === String(id));
  return c && c.nombre ? c.nombre : String(id);
}
function tablaSucCons(el, rows) {
  if (!rows.length) return vacio(el);
  const mid = (() => { const d0 = new Date(S.desde + 'T12:00:00'), d1 = new Date(S.hasta + 'T12:00:00'); return iso(new Date((d0.getTime() + d1.getTime()) / 2)); })();
  const g = new Map();
  rows.forEach(r => { const k = String(r.sucursal_destino || '(sin dato)'); (g.get(k) || g.set(k, []).get(k)).push(r); });
  const items = [...g.entries()].map(([k, rs]) => {
    const v = avg(rs.map(pctRow).filter(x => x != null));
    const a = avg(rs.filter(r => String(r.fecha_creacion).slice(0, 10) < mid).map(pctRow).filter(x => x != null));
    const b = avg(rs.filter(r => String(r.fecha_creacion).slice(0, 10) >= mid).map(pctRow).filter(x => x != null));
    return { k, v, n: rs.length, t: rs.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0), d: a != null && b != null ? b - a : null };
  }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  const col = v => v == null ? C.neutral : v >= META_CONS ? C.good : v >= 70 ? C.warn : C.neutral;
  el.innerHTML = `<div style="overflow:auto"><table class="sv-table" style="min-width:640px"><thead><tr><th>Sucursal</th><th class="r">Viajes</th><th class="r">Toneladas</th><th>Consolidación</th><th class="r">Δ</th></tr></thead><tbody>
    ${items.map(it => `<tr style="cursor:default"><td><span class="sv-b">${esc(nombreCentro(it.k))}</span>${nombreCentro(it.k) !== it.k ? `<div class="sv-sub">${esc(it.k)}</div>` : ''}</td>
      <td class="r">${it.n}</td><td class="r"><span class="sv-ton">${fmt(it.t, 1)} t</span></td>
      <td><div style="display:flex;align-items:center;gap:12px">${it.v != null ? truckGauge([{ ton: it.v, color: col(it.v), label: 'Consolidación' }], 100, { w: 110, h: 22 }) : ''}<b>${pct(it.v, 0)}</b></div></td>
      <td class="r">${it.d == null ? '<span class="sv-muted">—</span>' : `<b style="color:${it.d >= 0 ? C.good : C.bad}">${it.d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(it.d), 1)}</b> <span class="sv-muted">pts</span>`}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function tablaSucEfec(el, rows) {
  const med = rows.filter(r => r.estado !== 'EN PLAZO');
  if (!med.length) return vacio(el);
  const g = new Map();
  med.forEach(r => { const k = String(r.ce || '(sin dato)'); (g.get(k) || g.set(k, []).get(k)).push(r); });
  const items = [...g.entries()].map(([k, rs]) => ({ k, n: rs.length, ok: rs.filter(r => r.linea_cumple).length, cnt: ESTADOS.map(e => rs.filter(r => r.estado === e.k).length) }))
    .map(it => ({ ...it, v: it.ok / it.n * 100 })).sort((a, b) => b.v - a.v);
  el.innerHTML = `<div class="ipc-legend">${ESTADOS.map(e => `<span class="ipc-leg"><i style="background:${e.color}"></i>${e.lbl}</span>`).join('')}</div>
  <div style="overflow:auto"><table class="sv-table" style="min-width:640px"><thead><tr><th>Sucursal</th><th class="r">Líneas</th><th style="width:45%">Estado de las líneas</th><th class="r">Efectividad</th></tr></thead><tbody>
    ${items.map(it => `<tr style="cursor:default"><td><span class="sv-b">${esc(nombreCentro(it.k))}</span><div class="sv-sub">${esc(it.k)}</div></td><td class="r">${it.n}</td>
      <td><div class="ipc-stack">${ESTADOS.map((e, i) => it.cnt[i] ? `<i style="width:${it.cnt[i] / it.n * 100}%;background:${e.color}" data-tt="${esc(`<b>${e.lbl}</b><br>${it.cnt[i]} líneas (${pct(it.cnt[i] / it.n * 100, 0)})`)}"></i>` : '').join('')}</div></td>
      <td class="r"><b style="color:${semaforo(it.v, META_EFEC, 75)}">${pct(it.v, 0)}</b></td></tr>`).join('')}
  </tbody></table></div>`;
}

function barrasH(el, items, { meta, valFmt, sub, colorFn }) {
  if (!items.length) return vacio(el);
  const W = Math.max(280, el.clientWidth), rowH = 30, lblW = 118, valW = 118, m = { t: 6, b: 18 };
  const H = m.t + m.b + items.length * rowH, iw = W - lblW - valW - 8;
  const x = v => lblW + (Math.max(0, Math.min(100, v)) / 100) * iw;
  let s = `<svg width="${W}" height="${H}" role="img">`;
  [0, 50, 100].forEach(g => { s += `<line x1="${x(g)}" x2="${x(g)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.grid}"/><text x="${x(g)}" y="${H - 4}" text-anchor="middle" class="ipc-ax">${g}%</text>`; });
  items.forEach((it, i) => {
    const yy = m.t + i * rowH, bh = 16, by = yy + (rowH - bh) / 2;
    s += `<text x="${lblW - 8}" y="${by + 12}" text-anchor="end" class="ipc-lbl">${esc(it.lbl)}</text>`;
    if (it.v != null) s += `<rect x="${lblW}" y="${by}" width="${Math.max(3, x(it.v) - lblW)}" height="${bh}" rx="4" fill="${colorFn ? colorFn(it, i) : C.series}"/>`;
    s += `<text x="${lblW + iw + 8}" y="${by + 12}" class="ipc-val">${valFmt(it)}</text>`;
    s += `<rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="transparent" data-tt="${esc(sub(it))}"/>`;
  });
  if (meta != null) s += `<line x1="${x(meta)}" x2="${x(meta)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.good}" stroke-dasharray="4 3" stroke-width="1.5"/>`;
  el.innerHTML = s + '</svg>';
}

function agrupar(rows, key) {
  const g = new Map();
  rows.forEach(r => { const k = r[key] || '(sin dato)'; (g.get(k) || g.set(k, []).get(k)).push(r); });
  return [...g.entries()].map(([k, rs]) => ({
    lbl: k, n: rs.length, v: avg(rs.map(pctRow).filter(v => v != null)),
    t: rs.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0),
  }));
}

function chUsuario(el, rows) {
  const orden = usuariosActivos();
  const items = agrupar(rows, 'usuario_dt').sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  const colorIdx = u => { const i = orden.indexOf(u); return i >= 0 ? CAT[i % CAT.length] : C.neutral; };
  barrasH(el, items, {
    meta: META_CONS,
    valFmt: it => `${pct(it.v, 0)} · ${it.n} DT · ${fmt(it.t, 0)} t`,
    sub: it => `<b>${it.lbl}</b><br>Consolidación: <b>${pct(it.v)}</b><br>Viajes: ${it.n}<br>Toneladas: ${fmt(it.t, 1)} t<br>t/viaje: ${fmt(it.t / it.n, 1)}`,
    colorFn: it => colorIdx(it.lbl),
  });
}

function chDestino(el, rows) {
  const items = agrupar(rows, 'sucursal_destino').sort((a, b) => b.n - a.n).slice(0, 12)
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  barrasH(el, items, {
    meta: META_CONS,
    valFmt: it => `${pct(it.v, 0)} · ${it.n} DT`,
    sub: it => `<b>Destino ${it.lbl}</b><br>Consolidación: <b>${pct(it.v)}</b><br>Viajes: ${it.n}<br>Toneladas: ${fmt(it.t, 1)} t`,
    colorFn: it => semaforo(it.v, META_CONS, 70),
  });
}

function chDist(el, rows) {
  const vals = rows.map(pctRow).filter(v => v != null);
  if (!vals.length) return vacio(el);
  const bk = [
    { lbl: '< 50%', f: v => v < 50, color: C.bad },
    { lbl: '50–70%', f: v => v >= 50 && v < 70, color: C.bad },
    { lbl: '70–85%', f: v => v >= 70 && v < META_CONS, color: C.warn },
    { lbl: '85–99%', f: v => v >= META_CONS && v < 99.95, color: C.good },
    { lbl: '100%', f: v => v >= 99.95, color: C.good },
  ].map(b => ({ ...b, n: vals.filter(b.f).length }));
  const W = Math.max(280, el.clientWidth), H = 230, m = { l: 12, r: 12, t: 22, b: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, step = iw / bk.length, bw = Math.min(56, step * .62);
  const maxN = Math.max(...bk.map(b => b.n), 1);
  let s = `<svg width="${W}" height="${H}" role="img"><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="${C.axis}"/>`;
  bk.forEach((b, i) => {
    const cx = m.l + step * (i + .5), h = b.n / maxN * ih;
    if (b.n) s += `<path d="M${cx - bw / 2},${m.t + ih} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z" fill="${b.color}"/>`;
    s += `<text x="${cx}" y="${m.t + ih - h - 6}" text-anchor="middle" class="ipc-val">${b.n}</text>
          <text x="${cx}" y="${m.t + ih + 16}" text-anchor="middle" class="ipc-lbl">${b.lbl}</text>
          <text x="${cx}" y="${m.t + ih + 31}" text-anchor="middle" class="ipc-ax">${pct(b.n / vals.length * 100, 0)}</text>
          <rect x="${cx - step / 2}" y="${m.t}" width="${step}" height="${ih}" fill="transparent" data-tt="${esc(`<b>${b.lbl}</b><br>${b.n} viajes (${pct(b.n / vals.length * 100, 0)})`)}"/>`;
  });
  el.innerHTML = s + '</svg>';
}

function chEfec(el, rows) {
  const med = rows.filter(r => r.estado !== 'EN PLAZO');
  const plazo = rows.length - med.length;
  if (!rows.length) return vacio(el);
  const cnt = ESTADOS.map(e => ({ ...e, n: med.filter(r => r.estado === e.k).length }));
  const W = Math.max(280, el.clientWidth), bh = 26;
  let s = `<svg width="${W}" height="${bh + 4}" role="img">`;
  let x0 = 0; const tot = med.length || 1;
  cnt.forEach(c => {
    if (!c.n) return; const w = c.n / tot * W;
    s += `<rect x="${x0}" y="2" width="${Math.max(0, w - 2)}" height="${bh}" rx="4" fill="${c.color}" data-tt="${esc(`<b>${c.lbl}</b><br>${c.n} líneas (${pct(c.n / tot * 100)})`)}"/>`;
    if (w > 42) s += `<text x="${x0 + w / 2}" y="${bh / 2 + 7}" text-anchor="middle" class="ipc-inbar">${pct(c.n / tot * 100, 0)}</text>`;
    x0 += w;
  });
  s += '</svg>';
  const leg = cnt.map(c => `<span class="ipc-leg"><i style="background:${c.color}"></i>${c.lbl} <b>${c.n}</b></span>`).join('')
    + `<span class="ipc-leg"><i style="background:${C.neutral}"></i>En plazo (no se mide) <b>${plazo}</b></span>`;
  // por fecha de plan
  const g = new Map();
  rows.forEach(r => { const f = String(r.fecha).slice(0, 10); (g.get(f) || g.set(f, []).get(f)).push(r); });
  const fil = [...g.keys()].sort().reverse().slice(0, 8).map(f => {
    const rs = g.get(f), m = rs.filter(r => r.estado !== 'EN PLAZO'), ok = m.filter(r => r.linea_cumple).length;
    const v = m.length ? ok / m.length * 100 : null;
    return `<tr><td>${ddmmyy(f)}</td><td class="r">${rs.length}</td><td class="r">${m.length}</td><td class="r">${ok}</td>
      <td class="r"><span class="ipc-dot" style="background:${semaforo(v, META_EFEC, 75)}"></span><b>${pct(v)}</b></td></tr>`;
  }).join('');
  void fil;
  el.innerHTML = `${med.length ? s : '<div class="ipc-empty">Todas las líneas siguen en plazo (48 h hábiles)</div>'}<div class="ipc-legend">${leg}</div>`;
}

function tablaBajo(el, rows) {
  const r2 = rows.filter(r => pctRow(r) != null && pctRow(r) < META_CONS).sort((a, b) => pctRow(a) - pctRow(b)).slice(0, 10);
  if (!r2.length) { el.innerHTML = `<div class="ipc-empty ok"><span class="material-symbols-outlined">check_circle</span>Todos los viajes del período están sobre la meta de ${META_CONS}%</div>`; return; }
  el.innerHTML = `<div class="ipc-scroll"><table class="ipc-tbl"><thead><tr><th>Doc. Transporte</th><th>Fecha</th><th>Usuario</th><th>Centro</th><th>Destino</th><th>Transportista</th>
    <th class="r">Entregas</th><th class="r">Capacidad</th><th class="r">Ton</th><th>Consolidación</th></tr></thead><tbody>
    ${r2.map(r => { const v = pctRow(r); return `<tr><td><b>${esc(r.transporte)}</b></td><td>${ddmmyy(r.fecha_creacion)}</td><td>${esc(r.usuario_dt || '—')}</td>
      <td>${esc(r.centro_expedicion)}</td><td>${esc(r.sucursal_destino)}</td><td>${esc(r.transportista || '')}</td><td class="r">${r.n_entregas}</td>
      <td class="r">${fmt(r.capacidad_efectiva, 0)} t${r.capacidad_estimada ? ' <span class="ipc-tag">estimada</span>' : ''}</td><td class="r">${fmt(r.ton_cargadas, 1)}</td>
      <td><div class="ipc-mini"><i style="width:${v}%;background:${semaforo(v, META_CONS, 70)}"></i></div><b>${pct(v)}</b>${Number(r.lineas_sin_peso) ? ` <span class="ipc-tag warn" title="Líneas sin peso maestro: el % puede estar subestimado">${r.lineas_sin_peso} sin peso</span>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function tooltips() {
  const tip = root.querySelector('.ipc-tip'); const box = root.querySelector('.ipc');
  box.querySelectorAll('[data-tt]').forEach(n => {
    n.addEventListener('mousemove', e => {
      tip.innerHTML = n.getAttribute('data-tt'); tip.hidden = false;
      const b = box.getBoundingClientRect(); let lx = e.clientX - b.left + 14, ly = e.clientY - b.top + 14;
      if (lx + tip.offsetWidth > b.width) lx = e.clientX - b.left - tip.offsetWidth - 14;
      tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
    });
    n.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

// ── gestión de usuarios (OWNER / ADMIN) ────────────────────────────────────
function modalUsuarios() {
  const ov = document.createElement('div'); ov.className = 'ipc-ov';
  const detectados = [...new Set(S.cons.map(r => r.usuario_dt).filter(Boolean))].filter(u => !S.usuarios.some(x => x.usuario === u)).sort();
  ov.innerHTML = `<div class="ipc-modal" role="dialog" aria-label="Usuarios del indicador">
    <div class="ipc-mhead"><h3>Usuarios del indicador</h3><button class="ipc-x" data-x><span class="material-symbols-outlined">close</span></button></div>
    <p class="ipc-sub">Los DT de estos usuarios (usuario SAP) forman el alcance del dashboard.</p>
    <table class="ipc-tbl"><thead><tr><th>Usuario SAP</th><th>Nombre</th><th>Activo</th><th></th></tr></thead><tbody>
      ${S.usuarios.map(u => `<tr><td><b>${esc(u.usuario)}</b></td><td><input class="ipc-in" data-nom="${esc(u.usuario)}" value="${esc(u.nombre || '')}" placeholder="opcional"></td>
        <td><input type="checkbox" data-act-u="${esc(u.usuario)}" ${u.activo ? 'checked' : ''}></td>
        <td><button class="ipc-link bad" data-del="${esc(u.usuario)}">Quitar</button></td></tr>`).join('')}
    </tbody></table>
    <div class="ipc-add"><input class="ipc-in" data-new placeholder="Usuario SAP (ej. JPEREZ)" maxlength="12"><button class="ipc-btn on" data-add>Agregar</button></div>
    ${detectados.length ? `<p class="ipc-sub">Detectados en DT del período: ${detectados.map(u => `<button class="ipc-chip" data-sug="${esc(u)}">+ ${esc(u)}</button>`).join('')}</p>` : ''}
  </div>`;
  document.body.appendChild(ov);
  const cerrar = async (reload) => { ov.remove(); if (reload) await recargar(); };
  let cambios = false;
  const run = async (p) => { const { error } = await p; if (error) { showAlert('No se pudo guardar: ' + error.message, 'error'); return false; } cambios = true; return true; };
  const add = async (u) => {
    u = String(u || '').trim().toUpperCase(); if (!u) return;
    if (await run(supabase.from('abast_ind_usuarios_plan').upsert({ usuario: u, activo: true }))) { S.usuarios = (await supabase.from('abast_ind_usuarios_plan').select('*').order('usuario')).data || []; ov.remove(); modalUsuarios(); cambiosPend = true; }
  };
  ov.querySelector('[data-x]').onclick = () => cerrar(cambios || cambiosPend);
  ov.onclick = e => { if (e.target === ov) cerrar(cambios || cambiosPend); };
  ov.querySelector('[data-add]').onclick = () => add(ov.querySelector('[data-new]').value);
  ov.querySelector('[data-new]').onkeydown = e => { if (e.key === 'Enter') add(e.target.value); };
  ov.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => add(b.dataset.sug));
  ov.querySelectorAll('[data-act-u]').forEach(c => c.onchange = () => run(supabase.from('abast_ind_usuarios_plan').update({ activo: c.checked }).eq('usuario', c.dataset.actU)));
  ov.querySelectorAll('[data-nom]').forEach(i => i.onchange = () => run(supabase.from('abast_ind_usuarios_plan').update({ nombre: i.value.trim() || null }).eq('usuario', i.dataset.nom)));
  ov.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await run(supabase.from('abast_ind_usuarios_plan').delete().eq('usuario', b.dataset.del))) b.closest('tr').remove();
  });
}
let cambiosPend = false;

// ── estilos encapsulados ───────────────────────────────────────────────────
function css() {
  // Estilos propios del dashboard (.ipc-*). Tarjetas, chips, botones y tablas
  // usan el sistema visual v2 compartido (css/sit-v2.css, clases .sv-*).
  return `<style>
  .ipc{position:relative;display:flex;flex-direction:column;gap:20px;color:${C.ink}}
  .ipc-load,.ipc-empty{padding:24px;color:${C.ink2};font-size:13px;text-align:center}
  .ipc-empty.ok{display:flex;gap:8px;justify-content:center;align-items:center;color:${C.good};font-weight:600}
  .ipc-check{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:${C.ink2};margin-left:auto;cursor:pointer}
  .ipc-meter{position:relative;height:6px;background:#edeeef;border-radius:3px;margin-top:10px}
  .ipc-meter i{position:absolute;left:0;top:0;bottom:0;border-radius:3px}
  .ipc-meter b{position:absolute;top:-4px;bottom:-4px;width:2px;background:${C.ink}}
  .ipc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
  @media (max-width:900px){.ipc-grid{grid-template-columns:minmax(0,1fr)}}
  .ipc-card{padding:16px 20px;min-width:0}
  .ipc-card h3{font-size:15px;font-weight:700;margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}
  .ipc-card h3 small{font-size:12px;font-weight:500;color:${C.ink2}}
  .ipc-chart{width:100%;min-height:60px}
  .ipc-chart svg{display:block;overflow:visible}
  .ipc-ax{font-size:11px;fill:${C.axis}}
  .ipc-lbl{font-size:12px;fill:${C.ink};font-weight:600}
  .ipc-val{font-size:11px;fill:${C.ink2};font-variant-numeric:tabular-nums;font-weight:600}
  .ipc-inbar{font-size:11px;fill:#fff;font-weight:700}
  .ipc-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0 10px;font-size:12px;color:${C.ink2}}
  .ipc-leg{display:inline-flex;align-items:center;gap:6px}.ipc-leg i{width:10px;height:10px;border-radius:2px;display:inline-block}
  .ipc-leg b{color:${C.ink}}
  .ipc-stack{display:flex;height:14px;border-radius:3px;overflow:hidden;background:#edeeef;gap:1px}
  .ipc-stack i{display:block;height:100%}
  .ipc-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .ipc-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${C.ink2};font-weight:700;border-bottom:1px solid #e1e3e4;padding:8px 10px;white-space:nowrap;background:#f8f9fa}
  .ipc-tbl td{padding:8px 10px;border-bottom:1px solid #edeeef;white-space:nowrap;font-variant-numeric:tabular-nums}
  .ipc-tbl .r{text-align:right}
  .ipc-scroll{overflow-x:auto}
  .ipc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .ipc-mini{display:inline-block;width:70px;height:6px;background:#edeeef;border-radius:3px;margin-right:8px;vertical-align:middle;position:relative;overflow:hidden}
  .ipc-mini i{position:absolute;left:0;top:0;bottom:0;border-radius:3px}
  .ipc-tag{font-size:11px;font-weight:700;background:#dbeafe;color:#1e3a8a;border-radius:2px;padding:1px 5px;margin-left:4px}
  .ipc-tag.warn{background:#fef3c7;color:#713f12}
  .ipc-note{font-size:12px;color:${C.ink2};margin:0;line-height:1.5}
  .ipc-tip{position:absolute;z-index:30;pointer-events:none;background:${C.ink};color:#fff;font-size:12px;line-height:1.45;padding:8px 10px;border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,.2);max-width:260px}
  .ipc-ov{position:fixed;inset:0;background:rgba(25,28,29,.28);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
  .ipc-modal{background:#fff;border-radius:8px;padding:20px 24px;width:min(560px,100%);max-height:90vh;overflow:auto;box-shadow:0 16px 48px rgba(0,0,0,.2)}
  .ipc-mhead{display:flex;justify-content:space-between;align-items:center}.ipc-mhead h3{margin:0;font-size:16px;font-weight:700}
  .ipc-sub{font-size:13px;color:${C.ink2};margin:6px 0 10px}
  .ipc-x{border:0;background:none;cursor:pointer;color:${C.ink2}}
  .ipc-in{border:1px solid #e1e3e4;border-radius:4px;padding:6px 8px;font:inherit;font-size:13px;width:100%}
  .ipc-add{display:flex;gap:8px;margin:12px 0 4px}.ipc-add .ipc-in{flex:1;text-transform:uppercase}
  .ipc-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #b5000b;background:#b5000b;color:#fff;border-radius:4px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer}
  .ipc-chip{border:1px solid #e1e3e4;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;margin:2px}
  .ipc-link{border:0;background:none;cursor:pointer;font-weight:700;font-size:12px}.ipc-link.bad{color:${C.bad}}
  .ipc-detalle{margin-top:4px}
  .ipc-dia{margin-bottom:18px}.ipc-dia:last-child{margin-bottom:0}
  .ipc-diah{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:8px 0 6px}
  .ipc-diah b{font-size:14px}.ipc-etq{font-size:12px;color:${C.ink2}}.ipc-diak{margin-left:auto;font-size:12px;color:${C.ink2}}
  .ipc-cam.is-click{cursor:pointer}.ipc-cam.is-click:hover td{background:#f8f9fa}
  .ipc-chev{font-size:18px;vertical-align:middle;color:${C.ink2};margin-right:2px}
  .ipc-det>td{background:#fafafa;padding:6px 10px 12px 34px;white-space:normal}
  .ipc-sku{font-size:12px;background:#fff;border:1px solid #edeeef}
  .ipc-sku td,.ipc-sku th{padding:6px 8px}
  .ipc-bin{display:inline-block;min-width:22px;text-align:center;font-weight:800;border-radius:3px;padding:1px 6px;background:#fde2e2;color:${C.bad}}
  .ipc-bin.ok{background:#dcfce7;color:${C.good}}
  .ipc-tag.ok{background:#dcfce7;color:#14532d}.ipc-tag.bad{background:#fde2e2;color:#7f1d1d}
  </style>`;
}
