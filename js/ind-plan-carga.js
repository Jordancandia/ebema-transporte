// ============================================================================
// INDICADORES – PLAN DE CARGA  (dashboard ejecutivo, 27-sep-2026)
// ----------------------------------------------------------------------------
// Fuente: v_ind_consolidacion_dt (1 fila por DT) y v_ind_efectividad_plan
// (1 fila por línea documento+SKU de la foto 15:30).
// Alcance: DT cuyo usuario responsable está en abast_ind_usuarios_plan (activo).
//   Usuario del DT = "Creado por" del reporte DT > "Modif. por" > creador de
//   sus entregas (v_abast_dt_usuario). La lista es editable (OWNER / ADMIN).
// Capacidad: GeEs del DT; si viene vacía y es traslado → 28 t (15 t a 1050/1005),
//   misma regla del Plan de Carga, marcada como "estimada".
// Sin dependencias: gráficos SVG propios + CSS encapsulado (.ipc-*), porque el
// Tailwind del sitio está compilado y no incluye clases nuevas.
// ============================================================================

import { supabase } from './supabase-client.js?v=202609282220';
import { filtrarPorCentro, getRol } from './permisos.js?v=202609282220';
import { showAlert, escapeHtml } from './utils.js';

const META_CONS = 85;   // % consolidación objetivo por viaje
const META_EFEC = 90;   // % efectividad objetivo del Plan de Carga

const C = {
  series: '#2a78d6', good: '#0f8a4b', warn: '#d98a00', bad: '#c62828', info: '#2a78d6', neutral: '#9aa0a6',
  grid: '#e6e3df', axis: '#8a8680', ink: '#1c1b1a', ink2: '#5b5955',
};
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const ESTADOS = [
  { k: 'CUMPLE', lbl: 'Cumple', color: C.good },
  { k: 'PARCIAL', lbl: 'Parcial', color: C.warn },
  { k: 'CON ENTREGA SIN DT', lbl: 'Con entrega sin DT', color: C.info },
  { k: 'NO CARGADO', lbl: 'No cargado', color: C.bad },
];

// ── estado ─────────────────────────────────────────────────────────────────
const S = {
  desde: '', hasta: '', usuario: 'all', centro: 'all', tipo: 'all', cd: 'all', soloAlcance: true,
  cons: [], efec: [], usuarios: [], canEdit: false, vista: 'dash', detalleModo: 0,
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
    fetchPag('v_ind_efectividad_plan', q => q.gte('fecha', S.desde).lte('fecha', S.hasta).order('fecha')),
    supabase.from('abast_ind_usuarios_plan').select('*').order('usuario'),
  ]);
  S.cons = filtrarPorCentro(cons, 'centro_expedicion');
  S.efec = filtrarPorCentro(efec, 'ce');
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
function efecFiltrado() {
  return S.efec.filter(r => {
    if (S.cd !== 'all' && String(r.cd_origen) !== S.cd) return false;
    if (S.usuario !== 'all' && !String(r.usuarios || '').split(', ').includes(S.usuario)) return false;
    return true;
  });
}
const pctRow = r => r.pct_consolidacion == null ? null : Number(r.pct_consolidacion) * 100;

// ── pintado general ────────────────────────────────────────────────────────
function pintar() {
  const box = root.querySelector('.ipc');
  const act = usuariosActivos();
  const universoUsr = S.soloAlcance ? act : [...new Set(S.cons.map(r => r.usuario_dt).filter(Boolean))].sort();
  const centros = [...new Set(S.cons.map(r => String(r.centro_expedicion || '')).filter(Boolean))].sort();
  const tipos = [...new Set(S.cons.map(r => r.tipo_despacho).filter(Boolean))].sort();
  const cds = [...new Set(S.efec.map(r => String(r.cd_origen || '')).filter(Boolean))].sort();
  const chip = (v, lbl, sel, attr) => `<button class="ipc-chip ${sel ? 'on' : ''}" data-${attr}="${esc(v)}">${esc(lbl)}</button>`;

  box.innerHTML = `
  <div class="ipc-head">
    <div>
      <h2>Indicadores – Plan de Carga</h2>
      <p class="ipc-sub">${S.soloAlcance
        ? `DT de: <b>${act.length ? act.map(esc).join(' · ') : 'sin usuarios configurados'}</b>`
        : 'Todos los DT (todos los usuarios)'} · ${ddmmyy(S.desde)} a ${ddmmyy(S.hasta)}</p>
    </div>
    <div class="ipc-actions">
      ${S.canEdit ? '<button class="ipc-btn" data-act="usuarios"><span class="material-symbols-outlined">group</span>Usuarios</button>' : ''}
      <button class="ipc-btn ${S.vista === 'detalle' ? 'on' : ''}" data-act="vista"><span class="material-symbols-outlined">${S.vista === 'dash' ? 'table_view' : 'insights'}</span>${S.vista === 'dash' ? 'Ver detalle' : 'Ver dashboard'}</button>
    </div>
  </div>
  ${S.vista === 'detalle' ? '<div class="ipc-detalle"></div>' : `
  <div class="ipc-filters">
    <label>Desde <input type="date" data-f="desde" value="${S.desde}"></label>
    <label>Hasta <input type="date" data-f="hasta" value="${S.hasta}"></label>
    <span class="ipc-quick">${[7, 30, 90].map(n => `<button class="ipc-chip" data-dias="${n}">${n} días</button>`).join('')}</span>
    <label class="ipc-check"><input type="checkbox" data-f="solo" ${S.soloAlcance ? 'checked' : ''}> Solo usuarios configurados</label>
  </div>
  <div class="ipc-filters">
    <span class="ipc-flbl">Usuario</span>${chip('all', 'Todos', S.usuario === 'all', 'usr')}${universoUsr.map(u => chip(u, u, S.usuario === u, 'usr')).join('')}
    <span class="ipc-flbl">Centro exp.</span>${chip('all', 'Todos', S.centro === 'all', 'cen')}${centros.map(c => chip(c, c, S.centro === c, 'cen')).join('')}
    ${tipos.length > 1 ? `<span class="ipc-flbl">Tipo</span>${chip('all', 'Todos', S.tipo === 'all', 'tip')}${tipos.map(t => chip(t, t, S.tipo === t, 'tip')).join('')}` : ''}
  </div>
  <div class="ipc-kpis"></div>
  <div class="ipc-grid">
    <section class="ipc-card ipc-span2"><h3>Consolidación diaria <small>promedio simple por DT · meta ${META_CONS}%</small></h3><div class="ipc-chart" data-ch="diaria"></div></section>
    <section class="ipc-card"><h3>Por usuario <small>% consolidación · DT · t</small></h3><div class="ipc-chart" data-ch="usuario"></div></section>
    <section class="ipc-card"><h3>Distribución de viajes <small>DT por rango de consolidación</small></h3><div class="ipc-chart" data-ch="dist"></div></section>
    <section class="ipc-card"><h3>Por sucursal destino <small>% consolidación · DT</small></h3><div class="ipc-chart" data-ch="destino"></div></section>
    <section class="ipc-card"><h3>Efectividad Plan de Carga <small>líneas foto 15:30 · meta ${META_EFEC}%</small>
      <span class="ipc-inline">${cds.length > 1 ? chip('all', 'Todos CD', S.cd === 'all', 'cd') + cds.map(c => chip(c, 'CD ' + c, S.cd === c, 'cd')).join('') : ''}</span></h3>
      <div class="ipc-chart" data-ch="efec"></div></section>
    <section class="ipc-card ipc-span2"><h3>Viajes bajo meta <small>DT con menor consolidación en el período</small></h3><div data-ch="bajo"></div></section>
  </div>
  <p class="ipc-note">Capacidad = GeEs del DT; si viene vacía en un traslado se usa 28 t (15 t a 1050/1005) y el DT se marca <i>estimada</i>.
  Ton por línea = máx(peso bruto, peso volumétrico) × cantidad; tope 100% por DT. Efectividad excluye líneas aún “En plazo” (48 h hábiles).</p>
  `}
  <div class="ipc-tip" hidden></div>`;

  enlazar(box);
  if (S.vista === 'dash') { pintarKpis(); pintarGraficos(); }
  else if (opts.renderDetalle) opts.renderDetalle(box.querySelector('.ipc-detalle'), S.detalleModo);
}

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

// ── KPIs ───────────────────────────────────────────────────────────────────
function pintarKpis() {
  const rows = consFiltrado();
  const vals = rows.map(pctRow).filter(v => v != null);
  const cons = avg(vals);
  const ton = rows.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0);
  const cap = rows.reduce((s, r) => s + (Number(r.capacidad_efectiva) || 0), 0);
  const sobre = vals.filter(v => v >= META_CONS).length;
  const nLin = rows.reduce((s, r) => s + (Number(r.n_lineas) || 0), 0);
  const sinPeso = rows.reduce((s, r) => s + (Number(r.lineas_sin_peso) || 0), 0);
  const capReal = rows.filter(r => r.capacidad_ton != null && Number(r.capacidad_ton) > 0).length;
  const ef = efecFiltrado().filter(r => r.estado !== 'EN PLAZO');
  const efOk = ef.filter(r => r.linea_cumple).length;
  const efec = ef.length ? efOk / ef.length * 100 : null;

  const tile = (lbl, val, sub, color, ico, estado, hero) => `
    <div class="ipc-kpi ${hero ? 'hero' : ''}">
      <div class="ipc-kpi-lbl">${lbl}</div>
      <div class="ipc-kpi-val">${val}</div>
      ${estado ? `<div class="ipc-kpi-st" style="--st:${color}"><span class="material-symbols-outlined">${ico}</span>${estado}</div>` : ''}
      <div class="ipc-kpi-sub">${sub}</div>
      ${hero && cons != null ? `<div class="ipc-meter"><i style="width:${Math.min(100, cons)}%;background:${color}"></i><b style="left:${META_CONS}%"></b></div>` : ''}
    </div>`;
  root.querySelector('.ipc-kpis').innerHTML =
    tile('Consolidación promedio', pct(cons), `${sobre} de ${vals.length} viajes sobre meta (${META_CONS}%)`,
      semaforo(cons, META_CONS, 70), semaforoIco(cons, META_CONS, 70), semaforoTxt(cons, META_CONS, 70), true)
    + tile('Viajes (DT)', fmt(rows.length, 0), `${fmt(rows.reduce((s, r) => s + (Number(r.n_entregas) || 0), 0), 0)} entregas despachadas`)
    + tile('Toneladas cargadas', fmt(ton, 1) + ' t', `${fmt(rows.length ? ton / rows.length : null, 1)} t por viaje · ${pct(cap ? ton / cap * 100 : null)} de la capacidad total`)
    + tile('Efectividad Plan de Carga', pct(efec), `${fmt(efOk, 0)} de ${fmt(ef.length, 0)} líneas cargadas completas${S.usuario !== 'all' ? ' (líneas de ' + esc(S.usuario) + ')' : ''}`,
      semaforo(efec, META_EFEC, 75), semaforoIco(efec, META_EFEC, 75), semaforoTxt(efec, META_EFEC, 75))
    + tile('Calidad del dato', pct(nLin ? (nLin - sinPeso) / nLin * 100 : null, 0), `líneas con peso maestro · ${capReal} de ${rows.length} DT con GeEs real`);
}

// ── gráficos ───────────────────────────────────────────────────────────────
function pintarGraficos() {
  const rows = consFiltrado();
  const q = k => root.querySelector(`[data-ch="${k}"]`);
  chDiaria(q('diaria'), rows);
  chUsuario(q('usuario'), rows);
  chDist(q('dist'), rows);
  chDestino(q('destino'), rows);
  chEfec(q('efec'), efecFiltrado());
  tablaBajo(q('bajo'), rows);
  tooltips();
}
const vacio = el => { el.innerHTML = '<div class="ipc-empty">Sin datos para los filtros seleccionados</div>'; };

function chDiaria(el, rows) {
  const by = new Map();
  rows.forEach(r => { const f = String(r.fecha_creacion).slice(0, 10); (by.get(f) || by.set(f, []).get(f)).push(r); });
  const dias = [...by.keys()].sort();
  if (!dias.length) return vacio(el);
  const pts = dias.map(f => {
    const rs = by.get(f); const v = rs.map(pctRow).filter(x => x != null);
    return { f, v: avg(v), n: rs.length, t: rs.reduce((s, r) => s + (Number(r.ton_cargadas) || 0), 0) };
  });
  const W = Math.max(300, el.clientWidth), H = 250, H2 = 70, m = { l: 40, r: 14, t: 14, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const step = iw / pts.length, x = i => m.l + step * (i + .5);
  const y = v => m.t + ih - (v / 100) * ih;
  const maxN = Math.max(...pts.map(p => p.n));
  let s = `<svg width="${W}" height="${H + H2}" role="img" aria-label="Consolidación diaria">`;
  [0, 25, 50, 75, 100].forEach(g => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(g)}" y2="${y(g)}" stroke="${C.grid}"/><text x="${m.l - 6}" y="${y(g) + 4}" text-anchor="end" class="ipc-ax">${g}%</text>`; });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(META_CONS)}" y2="${y(META_CONS)}" stroke="${C.good}" stroke-dasharray="5 4" stroke-width="1.5"/>
        <text x="${W - m.r}" y="${y(META_CONS) - 5}" text-anchor="end" class="ipc-ax" fill="${C.good}">Meta ${META_CONS}%</text>`;
  const linea = pts.map((p, i) => p.v == null ? null : `${x(i)},${y(p.v)}`).filter(Boolean);
  if (linea.length > 1) s += `<polyline points="${linea.join(' ')}" fill="none" stroke="${C.series}" stroke-width="2" stroke-linejoin="round"/>`;
  const every = Math.ceil(pts.length / Math.max(1, Math.floor(iw / 46)));
  pts.forEach((p, i) => {
    if (p.v != null) s += `<circle cx="${x(i)}" cy="${y(p.v)}" r="4.5" fill="${semaforo(p.v, META_CONS, 70)}" stroke="#fff" stroke-width="2"/>`;
    if (i % every === 0) s += `<text x="${x(i)}" y="${H + H2 - 4}" text-anchor="middle" class="ipc-ax">${ddmm(p.f)}</text>`;
  });
  // mini-columnas: viajes por día (eje propio, mismo X)
  const by0 = H + 4, bh = H2 - 26;
  s += `<text x="${m.l - 6}" y="${by0 + 10}" text-anchor="end" class="ipc-ax">DT</text>`;
  pts.forEach((p, i) => {
    const h = Math.max(2, p.n / maxN * bh), bw = Math.min(28, step * .6);
    s += `<rect x="${x(i) - bw / 2}" y="${by0 + bh - h}" width="${bw}" height="${h}" rx="3" fill="${C.neutral}" opacity=".55"/>`;
    if (step > 22) s += `<text x="${x(i)}" y="${by0 + bh - h - 3}" text-anchor="middle" class="ipc-ax">${p.n}</text>`;
  });
  pts.forEach((p, i) => {
    s += `<rect x="${x(i) - step / 2}" y="${m.t}" width="${step}" height="${H + H2 - m.t - 14}" fill="transparent" data-tt="${esc(`<b>${ddmmyy(p.f)}</b><br>Consolidación: <b>${pct(p.v)}</b><br>Viajes: ${p.n}<br>Toneladas: ${fmt(p.t, 1)} t`)}"/>`;
  });
  el.innerHTML = s + '</svg>';
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
  el.innerHTML = `${med.length ? s : '<div class="ipc-empty">Todas las líneas siguen en plazo (48 h hábiles)</div>'}<div class="ipc-legend">${leg}</div>
    <table class="ipc-tbl"><thead><tr><th>Fecha plan</th><th class="r">Líneas</th><th class="r">Medibles</th><th class="r">Cumplen</th><th class="r">Efectividad</th></tr></thead><tbody>${fil}</tbody></table>`;
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
  return `<style>
  .ipc{position:relative;font-family:'Hanken Grotesk',system-ui,sans-serif;color:${C.ink};padding:4px 2px 24px}
  .ipc-load,.ipc-empty{padding:24px;color:${C.ink2};font-size:13px;text-align:center}
  .ipc-empty.ok{display:flex;gap:8px;justify-content:center;align-items:center;color:${C.good};font-weight:600}
  .ipc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .ipc-head h2{font-size:20px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;margin:0}
  .ipc-sub{font-size:13px;color:${C.ink2};margin:4px 0 0}
  .ipc-actions{display:flex;gap:8px}
  .ipc-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #d6d2cc;background:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;text-transform:uppercase;color:${C.ink}}
  .ipc-btn:hover{background:#f4f2ef}.ipc-btn.on{background:#b5000b;border-color:#b5000b;color:#fff}
  .ipc-btn .material-symbols-outlined{font-size:18px}
  .ipc-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:8px;font-size:12px}
  .ipc-filters label{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:${C.ink2}}
  .ipc-filters input[type=date]{border:1px solid #d6d2cc;border-radius:6px;padding:4px 6px;font:inherit;color:${C.ink}}
  .ipc-flbl{font-weight:700;color:${C.ink2};text-transform:uppercase;font-size:11px;margin-left:6px}
  .ipc-flbl:first-child{margin-left:0}
  .ipc-chip{border:1px solid #d6d2cc;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;color:${C.ink}}
  .ipc-chip:hover{background:#f4f2ef}.ipc-chip.on{background:${C.ink};border-color:${C.ink};color:#fff}
  .ipc-check{margin-left:auto}
  .ipc-quick{display:inline-flex;gap:4px}
  .ipc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:12px 0 16px}
  .ipc-kpi{background:#fff;border:1px solid #e6e3df;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:4px}
  .ipc-kpi.hero{grid-column:span 2;border-top:4px solid #b5000b}
  @media (max-width:640px){.ipc-kpi.hero{grid-column:span 1}}
  .ipc-kpi-lbl{font-size:12px;font-weight:700;color:${C.ink2};text-transform:uppercase;letter-spacing:.03em}
  .ipc-kpi-val{font-size:30px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
  .ipc-kpi.hero .ipc-kpi-val{font-size:48px}
  .ipc-kpi-st{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:var(--st)}
  .ipc-kpi-st .material-symbols-outlined{font-size:16px}
  .ipc-kpi-sub{font-size:12px;color:${C.ink2}}
  .ipc-meter{position:relative;height:8px;background:#efece8;border-radius:4px;margin-top:6px}
  .ipc-meter i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
  .ipc-meter b{position:absolute;top:-3px;bottom:-3px;width:2px;background:${C.ink}}
  .ipc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  @media (max-width:900px){.ipc-grid{grid-template-columns:minmax(0,1fr)}.ipc-span2{grid-column:auto!important}}
  .ipc-span2{grid-column:span 2}
  .ipc-card{background:#fff;border:1px solid #e6e3df;border-radius:12px;padding:14px 16px;min-width:0}
  .ipc-card h3{font-size:14px;font-weight:800;margin:0 0 10px;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}
  .ipc-card h3 small{font-size:12px;font-weight:500;color:${C.ink2}}
  .ipc-inline{margin-left:auto;display:inline-flex;gap:4px}
  .ipc-chart{width:100%;min-height:60px}
  .ipc-chart svg{display:block;overflow:visible}
  .ipc-ax{font-size:11px;fill:${C.axis}}
  .ipc-lbl{font-size:12px;fill:${C.ink};font-weight:600}
  .ipc-val{font-size:12px;fill:${C.ink2};font-variant-numeric:tabular-nums}
  .ipc-inbar{font-size:11px;fill:#fff;font-weight:700}
  .ipc-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0 10px;font-size:12px;color:${C.ink2}}
  .ipc-leg{display:inline-flex;align-items:center;gap:6px}.ipc-leg i{width:10px;height:10px;border-radius:3px;display:inline-block}
  .ipc-leg b{color:${C.ink}}
  .ipc-tbl{width:100%;border-collapse:collapse;font-size:12px}
  .ipc-tbl th{text-align:left;font-size:11px;text-transform:uppercase;color:${C.ink2};font-weight:700;border-bottom:1px solid #e6e3df;padding:6px 8px;white-space:nowrap}
  .ipc-tbl td{padding:6px 8px;border-bottom:1px solid #f1eeea;white-space:nowrap;font-variant-numeric:tabular-nums}
  .ipc-tbl .r{text-align:right}
  .ipc-scroll{overflow-x:auto}
  .ipc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .ipc-mini{display:inline-block;width:70px;height:6px;background:#efece8;border-radius:3px;margin-right:8px;vertical-align:middle;position:relative;overflow:hidden}
  .ipc-mini i{position:absolute;left:0;top:0;bottom:0;border-radius:3px}
  .ipc-tag{font-size:10px;font-weight:700;background:#eef3fb;color:#1f5fae;border-radius:4px;padding:1px 5px;margin-left:4px}
  .ipc-tag.warn{background:#fdf3e1;color:#8a5a00}
  .ipc-note{font-size:11px;color:${C.ink2};margin-top:14px;line-height:1.5}
  .ipc-tip{position:absolute;z-index:30;pointer-events:none;background:#1c1b1a;color:#fff;font-size:12px;line-height:1.45;padding:8px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.2);max-width:260px}
  .ipc-ov{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
  .ipc-modal{background:#fff;border-radius:14px;padding:18px 20px;width:min(560px,100%);max-height:90vh;overflow:auto;font-family:'Hanken Grotesk',system-ui,sans-serif}
  .ipc-mhead{display:flex;justify-content:space-between;align-items:center}.ipc-mhead h3{margin:0;font-size:16px;font-weight:800}
  .ipc-x{border:0;background:none;cursor:pointer;color:${C.ink2}}
  .ipc-in{border:1px solid #d6d2cc;border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;width:100%}
  .ipc-add{display:flex;gap:8px;margin:12px 0 4px}.ipc-add .ipc-in{flex:1;text-transform:uppercase}
  .ipc-link{border:0;background:none;cursor:pointer;font-weight:700;font-size:12px}.ipc-link.bad{color:${C.bad}}
  .ipc-detalle{margin-top:8px}
  </style>`;
}
