// ============================================================================
//  PORTERÍA · RELOJ CONTROL (18-oct-2026, Jordan)
//  Reemplaza el Excel "RELOJ CONTROL" de portería CD Quilicura (1003) para medir
//  tiempos de permanencia de camiones. Tabla porteria_visitas (Supabase).
//
//  Hitos por tipo (la hora la pone el SERVIDOR al presionar el botón):
//    TRONCAL / PROVEEDOR / RETIRO_CLIENTE : presentación → ingreso → salida
//    DESPACHO_EBEMA (subtipo GENERAL / FIERRO): salida → regreso
//  Romana: pesos digitados (peso entrada = tara_kg, peso salida = bruto_kg;
//  en despachos: peso salida cargado = bruto_kg, peso regreso = tara_kg).
//  Esperados del día (RPC fn_porteria_esperados): troncales programados del Plan
//  de Carga + Retiros de Fábrica FAB-CD. Un retiro con la misma patente y chofer
//  que un troncal del día se trata como UNA visita TRONCAL (consolida retiro).
//  Acceso: sólo OWNER (o vista extra 'porteria' asignada por OWNER).
//  SQL: supabase/sql/2026-10-18_porteria_reloj_control.sql
// ============================================================================
import { supabase } from './supabase-client.js?v=202610222359';
import { escapeHtml as esc, showAlert, toCSV, downloadFile } from './utils.js';
import { confirmar, pedirDato } from './confirmar.js?v=202610222359';

const CENTRO = '1003';
const TZ = 'America/Santiago';
const TIPOS = {
  TRONCAL:        { label: 'Troncal',        icon: 'local_shipping', pill: 'info',   hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Sucursal destino' },
  PROVEEDOR:      { label: 'Proveedor',      icon: 'factory',        pill: 'purple', hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Proveedor' },
  RETIRO_CLIENTE: { label: 'Cliente retira', icon: 'person',         pill: 'orange', hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Cliente' },
  DESPACHO_EBEMA: { label: 'Despacho Ebema', icon: 'outbound',       pill: 'mute',   hitos: ['salida', 'regreso'],                 contra: 'Cliente / obra' },
};
const HITO_LBL = { presentacion: 'Presentación', ingreso: 'Ingreso', salida: 'Salida', regreso: 'Regreso' };
const HITO_BTN = { presentacion: 'Llegó', ingreso: 'Ingresa', salida: 'Sale', regreso: 'Regresa' };
const ESTADOS = {
  PROGRAMADO: ['Sin hitos', 'mute'], EN_COLA: ['En cola', 'warn'], EN_PATIO: ['En patio', 'info'], EN_RUTA: ['En ruta', 'purple'],
  FINALIZADO: ['Finalizado', 'ok'], NO_SE_PRESENTA: ['No se presenta', 'bad'], NO_CARGA: ['No carga', 'orange'], ANULADO: ['Anulado', 'mute'],
};
const DOC_TIPOS = ['GUIA', 'OC', 'NV', 'ENTREGA', 'DT'];
const COLS = 'id,fecha,centro,tipo,subtipo,estado,patente,patente_carro,chofer_nombre,chofer_rut,chofer_telefono,id_transporte,transportista,contraparte,ce,documentos,hora_agenda,t_presentacion,t_ingreso,t_salida,t_regreso,tara_kg,bruto_kg,peso_guias_kg,neto_kg,origen,clave_esperado,plan_ref,retiros,consolida_retiro,obs,created_by,updated_by,updated_at';

const S = {
  fecha: hoy(), tipo: '', q: '', visitas: [], esperados: [], metas: {}, centros: null, proveedores: null,
  desde: addDays(hoy(), -30), hasta: hoy(), ind: null,
};
let _stage = null;
let _tick = null;
let _poll = null;

// ── Utilidades ──────────────────────────────────────────────────────────────
function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const hhmm = t => (t ? new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '');
const fechaCorta = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '');
const minEntre = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);
const nf = (v, d = 0) => (v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: d }));
function fmtMin(m) {
  if (m == null || isNaN(m)) return '—';
  m = Math.max(0, Math.round(m));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
function num(v) {
  if (v == null) return null;
  let s = String(v).trim(); if (!s) return null;
  s = s.replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function fmtPatente(p) {
  const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}([A-Z]{2}|[0-9]{2})[0-9]{2}$/.test(s) ? `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}` : String(p || '').trim().toUpperCase();
}
const patenteValida = p => /^[A-Z]{2}-[A-Z0-9]{2}-[0-9]{2}$/.test(fmtPatente(p));
// datetime-local ⇄ ISO (hora de Chile)
function toLocalInput(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; } // el navegador opera en hora de Chile
const pill = (txt, cls) => `<span class="sv-pill ${cls}"><i></i>${esc(txt)}</span>`;
const tipoPill = t => pill(TIPOS[t]?.label || t, TIPOS[t]?.pill || 'mute');
const estadoPill = e => pill((ESTADOS[e] || [e])[0], (ESTADOS[e] || [e, 'mute'])[1]);
const docsTxt = docs => (Array.isArray(docs) ? docs : []).map(d => `${d.tipo} ${d.numero}`).join(' · ');
function errMsg(e) {
  const m = e?.message || String(e);
  if (/chk_pv_ingreso/.test(m)) return 'El ingreso no puede ser anterior a la presentación.';
  if (/chk_pv_salida/.test(m)) return 'La salida no puede ser anterior al ingreso.';
  if (/chk_pv_regreso/.test(m)) return 'El regreso no puede ser anterior a la salida.';
  if (/ux_porteria_esperado/.test(m)) return 'Ese camión esperado ya fue registrado hoy.';
  return m;
}

// Próximo hito pendiente de una visita (null si no corresponde)
function proximoHito(v) {
  if (['FINALIZADO', 'NO_SE_PRESENTA', 'NO_CARGA', 'ANULADO'].includes(v.estado)) return null;
  return (TIPOS[v.tipo]?.hitos || []).find(h => !v['t_' + h]) || null;
}
// Tiempo vigente (en curso) o final, y contra qué se compara
function tiempo(v, ahora = new Date()) {
  const now = ahora.toISOString();
  if (v.tipo === 'DESPACHO_EBEMA') {
    if (v.t_regreso) return { min: minEntre(v.t_salida, v.t_regreso), que: 'Ruta', vivo: false, meta: true };
    if (v.t_salida && v.estado === 'EN_RUTA') return { min: minEntre(v.t_salida, now), que: 'En ruta', vivo: true, meta: true };
    return { min: null, que: '' };
  }
  if (v.t_salida && v.t_ingreso) return { min: minEntre(v.t_ingreso, v.t_salida), que: 'Permanencia', vivo: false, meta: true };
  if (v.t_ingreso && v.estado === 'EN_PATIO') return { min: minEntre(v.t_ingreso, now), que: 'En patio', vivo: true, meta: true };
  if (v.t_presentacion && v.estado === 'EN_COLA') return { min: minEntre(v.t_presentacion, now), que: 'Esperando', vivo: true, meta: false };
  return { min: null, que: '' };
}
function semaforo(v, t) {
  const meta = S.metas[v.tipo]?.meta_min;
  if (!t.meta || !meta || t.min == null) return 'mute';
  if (t.min > meta) return 'bad';
  if (t.min > meta * 0.8) return 'warn';
  return 'ok';
}

// ── Estilos propios (sobre el sistema visual v2) ────────────────────────────
function css() {
  if (document.getElementById('pt-css')) return;
  const st = document.createElement('style');
  st.id = 'pt-css';
  st.textContent = `
  .pt .sv-card { overflow: hidden; }
  .pt-ch { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:14px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-ch h2 { margin:0; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .pt-ch h2 small { font-weight:600; color:var(--sv-ink2); font-size:12px; }
  .pt-mono { font-family: var(--sv-mono); font-size:12.5px; }
  .pt-sub { font-size:12px; color:var(--sv-ink2); margin-top:2px; }
  .pt-time { font-family: var(--sv-mono); font-size:12.5px; white-space:nowrap; }
  .pt-na { color: var(--sv-line); }
  .pt-t { display:flex; flex-direction:column; gap:2px; }
  .pt-t small { font-size:11px; color:var(--sv-ink2); }
  .pt-live { animation: ptPulse 2s ease-in-out infinite; }
  @keyframes ptPulse { 50% { opacity:.55; } }
  .pt-act { display:flex; gap:6px; justify-content:flex-end; align-items:center; }
  .pt-act .sv-btn-p { padding:6px 12px; }
  .pt-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px 12px; }
  .pt-grid .full { grid-column: 1 / -1; }
  .pt-f { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .pt-f > span { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--sv-ink2); }
  .pt-f input, .pt-f select, .pt-f textarea { border:1px solid var(--sv-line); border-radius:4px; padding:8px 10px; font:inherit; font-size:13px; color:var(--sv-ink); background:#fff; min-width:0; }
  .pt-f input:focus, .pt-f select:focus, .pt-f textarea:focus { outline:none; border-color: var(--sv-ink2); }
  .pt-f input.is-mono { font-family: var(--sv-mono); text-transform: uppercase; }
  .pt-f input.is-err { border-color:#b5000b; }
  .pt-docs { display:flex; flex-wrap:wrap; gap:6px; }
  .pt-doc { display:inline-flex; align-items:center; gap:4px; background:var(--sv-s2); border-radius:4px; padding:3px 4px 3px 8px; font-family:var(--sv-mono); font-size:12px; }
  .pt-doc b { font-family: inherit; font-size:10px; color:var(--sv-ink2); }
  .pt-doc button { border:none; background:none; cursor:pointer; color:var(--sv-ink2); padding:0; display:flex; }
  .pt-doc button .material-symbols-outlined { font-size:16px; }
  .pt-docadd { display:flex; gap:6px; }
  .pt-docadd select { width:110px; }
  .pt-docadd input { flex:1; }
  .pt-match { border:1px solid #bfdbfe; background:#eff6ff; border-radius:8px; padding:10px 12px; font-size:13px; display:flex; gap:10px; align-items:flex-start; justify-content:space-between; }
  .pt-calc { font-size:12px; color:var(--sv-ink2); }
  .pt-calc b { color: var(--sv-ink); }
  .pt-heat { border-collapse:separate; border-spacing:2px; font-size:11px; width:100%; }
  .pt-heat th { font-weight:700; color:var(--sv-ink2); padding:2px 4px; text-align:center; }
  .pt-heat th:first-child { text-align:left; white-space:nowrap; }
  .pt-heat td { text-align:center; padding:6px 0; border-radius:3px; font-family:var(--sv-mono); min-width:26px; }
  .pt-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px; }
  .pt-tile { background:#fff; border:1px solid var(--sv-line); border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .pt-tile-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .pt-big { font-size:28px; line-height:34px; font-weight:700; }
  .pt-big small { font-size:13px; font-weight:600; color:var(--sv-ink2); margin-left:4px; }
  .pt-kv { display:grid; grid-template-columns: 1fr auto; gap:4px 12px; font-size:12.5px; }
  .pt-kv span:nth-child(odd) { color:var(--sv-ink2); }
  .pt-kv span:nth-child(even) { font-weight:700; text-align:right; font-family:var(--sv-mono); }
  .pt-bar { height:6px; background:var(--sv-s2); border-radius:3px; overflow:hidden; }
  .pt-bar i { display:block; height:100%; }
  @media (max-width: 640px) { .pt-grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(st);
}

// ── Carga de datos ──────────────────────────────────────────────────────────
async function cargarMetas() {
  const { data, error } = await supabase.from('porteria_metas').select('*');
  if (!error) S.metas = Object.fromEntries((data || []).map(m => [m.tipo, m]));
}
async function cargarDia() {
  const d = S.fecha;
  const abiertos = `and(fecha.gte.${addDays(d, -3)},fecha.lt.${d},estado.in.(EN_COLA,EN_PATIO,EN_RUTA))`;
  const [v, e] = await Promise.all([
    supabase.from('porteria_visitas').select(COLS).eq('centro', CENTRO).or(`fecha.eq.${d},${abiertos}`).order('created_at', { ascending: true }),
    supabase.rpc('fn_porteria_esperados', { p_fecha: d, p_centro: CENTRO }),
  ]);
  if (v.error) { showAlert('Error al leer portería: ' + v.error.message, 'error'); return false; }
  if (e.error) showAlert('No se pudieron leer los esperados del día: ' + e.error.message, 'error');
  S.visitas = v.data || [];
  S.esperados = e.data || [];
  return true;
}
async function catalogos() {
  if (!S.centros) {
    const { data } = await supabase.from('logistics_centres').select('id,nombre').order('nombre');
    S.centros = (data || []).filter(c => c.id !== CENTRO);
  }
  if (!S.proveedores) {
    const { data } = await supabase.from('abast_proveedores').select('nombre').eq('activo', true).order('nombre').limit(3000);
    S.proveedores = (data || []).map(p => p.nombre).filter(Boolean);
  }
}

function limpiarTimers() { clearInterval(_tick); clearInterval(_poll); _tick = _poll = null; }
function montado() { return _stage && document.body.contains(_stage) && _stage.querySelector('.pt'); }

// ── Vista principal ─────────────────────────────────────────────────────────
export async function renderPorteria(stage, sub = 'registro') {
  _stage = stage;
  css();
  limpiarTimers();
  stage.innerHTML = `<div class="sv-view pt"><div class="sv-desc">Cargando portería…</div></div>`;
  await cargarMetas();
  if (sub === 'indicadores') return renderIndicadores();
  await cargarDia();
  renderRegistro();
  _tick = setInterval(() => { if (!montado()) return limpiarTimers(); actualizarTiempos(); }, 30000);
  _poll = setInterval(async () => {
    if (!montado()) return limpiarTimers();
    if (document.querySelector('.sv-dr') || document.querySelector('.sv-cf-bg')) return; // no refrescar con un panel abierto
    if (await cargarDia()) renderRegistro();
  }, 120000);
}

function kpisRegistro() {
  const v = S.visitas.filter(x => x.estado !== 'ANULADO');
  const c = e => v.filter(x => x.estado === e).length;
  const pend = S.esperados.filter(e => !e.visita_id).length;
  const k = (lbl, n, color, sub) => `<div class="sv-kpi" style="cursor:default"><div class="sv-kpi-l"><i style="background:${color}"></i>${lbl}</div><div class="sv-kpi-v">${n}</div><div class="sv-kpi-s">${sub}</div></div>`;
  return `<div class="sv-kpis">
    ${k('En cola', c('EN_COLA'), '#ca8a04', 'presentados, sin ingresar')}
    ${k('En patio', c('EN_PATIO'), '#1d4ed8', 'dentro del CD')}
    ${k('En ruta', c('EN_RUTA'), '#7e22ce', 'despachos Ebema fuera')}
    ${k('Finalizados', c('FINALIZADO'), '#15803d', 'ciclo completo')}
    ${k('Esperados pendientes', pend, '#b5000b', 'desde Plan de Carga y Retiros')}
  </div>`;
}

function renderRegistro() {
  if (!_stage) return;
  const esHoy = S.fecha === hoy();
  _stage.innerHTML = `<div class="sv-view pt">
    <div class="sv-vhead">
      <div>
        <h1 class="sv-h1">Reloj Control · Portería</h1>
        <div class="sv-desc">CD Quilicura (1003). Cada hito se registra con la hora del servidor al presionar el botón; los pesos de romana se digitan.</div>
      </div>
      <div class="sv-actions">
        <label class="sv-inp"><span class="material-symbols-outlined">event</span><input type="date" id="pt-fecha" value="${S.fecha}"></label>
        ${esHoy ? '' : '<button class="sv-btn" id="pt-hoy">Hoy</button>'}
        <button class="sv-btn is-icon" id="pt-ref" title="Actualizar"><span class="material-symbols-outlined">refresh</span></button>
        <button class="sv-btn-p" id="pt-nuevo"><span class="material-symbols-outlined">add</span>Registrar camión</button>
      </div>
    </div>
    ${kpisRegistro()}
    ${tablaEsperados()}
    <div class="sv-card" id="pt-movs">${tablaMovimientos()}</div>
  </div>`;
  const $ = s => _stage.querySelector(s);
  $('#pt-fecha').addEventListener('change', async e => { S.fecha = e.target.value || hoy(); await cargarDia(); renderRegistro(); });
  $('#pt-hoy')?.addEventListener('click', async () => { S.fecha = hoy(); await cargarDia(); renderRegistro(); });
  $('#pt-ref').addEventListener('click', async () => { await cargarDia(); renderRegistro(); });
  $('#pt-nuevo').addEventListener('click', () => abrirForm(null));
  _stage.querySelectorAll('[data-esp]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); llegoEsperado(S.esperados[+b.dataset.esp]); }));
  _stage.querySelectorAll('[data-espver]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const v = S.visitas.find(x => x.id === +b.dataset.espver); if (v) abrirForm(v);
  }));
  bindMovimientos();
}

function tablaEsperados() {
  const E = S.esperados;
  const pend = E.filter(e => !e.visita_id).length;
  const filas = E.length ? E.map((e, i) => {
    const ocs = (e.retiros || []).map(r => `<span class="sv-tag mute" title="${esc(r.proveedor || '')}">OC ${esc(r.doc_compr)}</span>`).join('');
    const dest = e.tipo === 'TRONCAL'
      ? `${esc(e.contraparte || e.ce || '')}<div class="pt-sub">Camión ${esc(e.plan_ref?.camion ?? '')} · ${nf(e.plan_ref?.ton, 1)} t · ${nf(e.plan_ref?.pct)}%</div>`
      : esc(e.contraparte || '');
    return `<tr>
      <td>${tipoPill(e.tipo)}${e.consolida_retiro ? '<div class="sv-tags"><span class="sv-tag seg" title="Mismo camión y chofer que un retiro FAB-CD del día"><span class="material-symbols-outlined">merge</span>Consolida retiro</span></div>' : ''}</td>
      <td><span class="pt-mono">${esc(e.patente || '— sin patente')}</span>${e.patente_carro ? `<div class="pt-sub pt-mono">Carro ${esc(e.patente_carro)}</div>` : ''}</td>
      <td>${esc(e.chofer_nombre || '—')}<div class="pt-sub">${esc(e.transportista || '')}</div></td>
      <td>${dest}</td>
      <td><div class="sv-tags" style="margin:0">${ocs || '<span class="pt-na">—</span>'}</div></td>
      <td class="pt-act">${e.visita_id
        ? `${pill('Registrado', 'ok')}<button class="sv-btn" data-espver="${e.visita_id}">Ver</button>`
        : `<button class="sv-btn-p" data-esp="${i}" ${S.fecha === hoy() ? '' : 'disabled title="Sólo se registra la llegada del día de hoy"'}><span class="material-symbols-outlined">login</span>Llegó</button>`}</td>
    </tr>`;
  }).join('') : '<tr class="sv-empty"><td colspan="6">Sin troncales programados ni retiros FAB-CD para esta fecha.</td></tr>';
  return `<div class="sv-card">
    <div class="pt-ch"><h2><span class="material-symbols-outlined">schedule</span>Esperados del día <small>${pend} pendiente${pend === 1 ? '' : 's'} de ${E.length} · Plan de Carga y Retiros de Fábrica</small></h2></div>
    <div class="sv-tablewrap" style="max-height:360px"><table class="sv-table">
      <thead><tr><th>Tipo</th><th>Patente</th><th>Chofer / Transportista</th><th>Destino / Proveedor</th><th>Retiros (OC)</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;
}

function filtradas() {
  const q = S.q.trim().toUpperCase();
  return S.visitas.filter(v => (!S.tipo || v.tipo === S.tipo) && (!q || [v.patente, v.chofer_nombre, v.transportista, v.contraparte, docsTxt(v.documentos)]
    .some(x => String(x || '').toUpperCase().includes(q))));
}

function celdaHito(v, h) {
  if (!TIPOS[v.tipo]?.hitos.includes(h)) return '<span class="pt-na">·</span>';
  const t = v['t_' + h];
  if (!t) return '<span class="pt-na">—</span>';
  const otroDia = new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }) !== v.fecha;
  return `<span class="pt-time">${hhmm(t)}</span>${otroDia ? `<div class="pt-sub">${fechaCorta(new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }))}</div>` : ''}`;
}
function celdaTiempo(v) {
  const t = tiempo(v);
  if (t.min == null) return '<span class="pt-na">—</span>';
  const sem = semaforo(v, t);
  const meta = S.metas[v.tipo]?.meta_min;
  return `<div class="pt-t" data-timer="${v.id}"><span class="sv-pill ${sem} ${t.vivo ? 'pt-live' : ''}"><i></i>${fmtMin(t.min)}</span>
    <small>${esc(t.que)}${t.meta && meta ? ` · meta ${meta} min` : ''}</small></div>`;
}
function celdaRomana(v) {
  const ent = v.tipo === 'DESPACHO_EBEMA' ? v.bruto_kg : v.tara_kg;
  const sal = v.tipo === 'DESPACHO_EBEMA' ? v.tara_kg : v.bruto_kg;
  if (ent == null && sal == null) return '<span class="pt-na">—</span>';
  const neto = v.neto_kg;
  let dif = '';
  if (neto != null && v.peso_guias_kg > 0) {
    const p = (neto - v.peso_guias_kg) / v.peso_guias_kg * 100;
    const tol = Number(S.metas[v.tipo]?.tolerancia_peso_pct ?? 3);
    dif = `<div class="pt-sub" style="color:${Math.abs(p) > tol ? '#b5000b' : 'inherit'}">${p > 0 ? '+' : ''}${nf(p, 1)}% vs guías</div>`;
  }
  return `<span class="pt-mono">${neto != null ? nf(neto) + ' kg' : nf(ent ?? sal) + ' kg'}</span>${neto == null ? '<div class="pt-sub">falta 2º pesaje</div>' : ''}${dif}`;
}

function tablaMovimientos() {
  const rows = filtradas();
  const cnt = t => S.visitas.filter(v => v.tipo === t).length;
  const chips = `<button class="sv-chip ${!S.tipo ? 'is-on' : ''}" data-ft="">Todos <small>${S.visitas.length}</small></button>`
    + Object.entries(TIPOS).map(([k, t]) => `<button class="sv-chip ${S.tipo === k ? 'is-on' : ''}" data-ft="${k}">${t.label} <small>${cnt(k)}</small></button>`).join('');
  const filas = rows.length ? rows.map(v => {
    const nx = proximoHito(v);
    const otroDia = v.fecha !== S.fecha;
    return `<tr data-id="${v.id}" class="${v.estado === 'ANULADO' ? 'tf-row-off' : ''}" style="${v.estado === 'ANULADO' ? 'opacity:.5' : ''}">
      <td>${tipoPill(v.tipo)}${v.subtipo === 'FIERRO' ? '<div class="sv-tags"><span class="sv-tag mute">Fierro</span></div>' : ''}${v.consolida_retiro ? '<div class="sv-tags"><span class="sv-tag seg"><span class="material-symbols-outlined">merge</span>Consolida retiro</span></div>' : ''}</td>
      <td><span class="pt-mono">${esc(v.patente || '—')}</span><div class="pt-sub">${esc(v.chofer_nombre || '')}</div></td>
      <td>${esc(v.contraparte || '—')}<div class="pt-sub">${esc(v.transportista || '')}${otroDia ? ` · desde ${fechaCorta(v.fecha)}` : ''}</div></td>
      <td><div class="pt-sub" style="margin:0;max-width:200px">${esc(docsTxt(v.documentos)) || '<span class="pt-na">—</span>'}</div></td>
      <td>${celdaHito(v, 'presentacion')}</td><td>${celdaHito(v, 'ingreso')}</td><td>${celdaHito(v, 'salida')}</td><td>${celdaHito(v, 'regreso')}</td>
      <td>${celdaTiempo(v)}</td>
      <td class="r">${celdaRomana(v)}</td>
      <td>${estadoPill(v.estado)}</td>
      <td class="pt-act">${nx ? `<button class="sv-btn-p" data-hito="${nx}" data-vid="${v.id}">${HITO_BTN[nx]}</button>` : ''}
        <button class="sv-btn is-icon" data-edit="${v.id}" title="Editar / corregir"><span class="material-symbols-outlined">edit</span></button></td>
    </tr>`;
  }).join('') : '<tr class="sv-empty"><td colspan="12">Sin movimientos registrados para el filtro.</td></tr>';
  return `<div class="pt-ch"><h2><span class="material-symbols-outlined">timer</span>Movimientos <small>${fechaCorta(S.fecha)} + abiertos de días anteriores</small></h2>
      <div class="sv-frow">${chips}
        <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="pt-q" value="${esc(S.q)}" placeholder="Patente, chofer, guía…" autocomplete="off"></label></div></div>
    <div class="sv-tablewrap"><table class="sv-table">
      <thead><tr><th>Tipo</th><th>Patente / Chofer</th><th>Contraparte</th><th>Documentos</th><th>Presentación</th><th>Ingreso</th><th>Salida</th><th>Regreso</th><th>Tiempo</th><th class="r">Romana (neto)</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>`;
}

function bindMovimientos() {
  const box = _stage.querySelector('#pt-movs'); if (!box) return;
  box.querySelectorAll('[data-ft]').forEach(b => b.addEventListener('click', () => { S.tipo = b.dataset.ft; box.innerHTML = tablaMovimientos(); bindMovimientos(); }));
  const q = box.querySelector('#pt-q');
  let tk;
  q.addEventListener('input', () => {
    clearTimeout(tk);
    tk = setTimeout(() => { S.q = q.value; const pos = q.selectionStart; box.innerHTML = tablaMovimientos(); bindMovimientos(); const n = box.querySelector('#pt-q'); n.focus(); n.setSelectionRange(pos, pos); }, 200);
  });
  box.querySelectorAll('[data-hito]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); marcarHito(+b.dataset.vid, b.dataset.hito); }));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); abrirForm(S.visitas.find(v => v.id === +b.dataset.edit)); }));
  box.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => abrirForm(S.visitas.find(v => v.id === +tr.dataset.id))));
}

function actualizarTiempos() {
  _stage.querySelectorAll('[data-timer]').forEach(el => {
    const v = S.visitas.find(x => x.id === +el.dataset.timer);
    if (v && tiempo(v).vivo) el.outerHTML = celdaTiempo(v);
  });
}

// ── Acciones ────────────────────────────────────────────────────────────────
function reemplazar(v) {
  const i = S.visitas.findIndex(x => x.id === v.id);
  if (i >= 0) S.visitas[i] = v; else S.visitas.push(v);
}

async function marcarHito(id, hito) {
  const v = S.visitas.find(x => x.id === id); if (!v) return;
  // Romana: pedir el pesaje que corresponde a este hito (opcional)
  const despacho = v.tipo === 'DESPACHO_EBEMA';
  const campo = (hito === 'ingreso' && !despacho) || (hito === 'regreso' && despacho) ? 'tara_kg' : (hito === 'salida' ? 'bruto_kg' : null);
  const patch = {};
  if (campo && v[campo] == null) {
    const lbl = campo === 'tara_kg' ? (despacho ? 'Peso al regreso' : 'Peso de entrada') : (despacho ? 'Peso de salida con carga' : 'Peso de salida');
    const r = await pedirDato(`${HITO_BTN[hito]} · ${v.patente || ''}\n\n${lbl} en romana (kg). Puede quedar vacío y completarse después.`,
      { aceptar: `Registrar ${HITO_LBL[hito].toLowerCase()}`, placeholder: 'Ej: 15.420', opcional: true, icono: 'scale', patron: /^[\d.,\s]+$/, error: 'Ingrese sólo números (kg)' });
    if (r === null) return;
    const n = num(r);
    if (n != null) patch[campo] = n;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('porteria_visitas').update(patch).eq('id', id);
    if (error) return showAlert(errMsg(error), 'error');
  }
  const { data, error } = await supabase.rpc('fn_porteria_marcar', { p_id: id, p_hito: hito });
  if (error) return showAlert(errMsg(error), 'error');
  reemplazar({ ...v, ...patch, ...data });
  showAlert(`${HITO_LBL[hito]} registrada ${hhmm(data['t_' + hito])} · ${data.patente || ''}`);
  renderRegistro();
}

function payloadDesdeEsperado(e) {
  const docs = [];
  (e.retiros || []).forEach(r => {
    if (r.doc_compr) docs.push({ tipo: 'OC', numero: String(r.doc_compr) });
    if (r.entrega_entrante) docs.push({ tipo: 'ENTREGA', numero: String(r.entrega_entrante) });
  });
  return {
    tipo: e.tipo, patente: e.patente, patente_carro: e.patente_carro, chofer_nombre: e.chofer_nombre, chofer_rut: e.chofer_rut,
    chofer_telefono: e.chofer_telefono, id_transporte: e.id_transporte, transportista: e.transportista,
    contraparte: e.contraparte, ce: e.ce, documentos: docs, clave_esperado: e.clave, plan_ref: e.plan_ref, retiros: e.retiros || [],
    consolida_retiro: !!e.consolida_retiro,
    origen: e.tipo === 'TRONCAL' ? (e.consolida_retiro ? 'PLAN_CARGA+RETIRO' : 'PLAN_CARGA') : 'RETIRO_FABRICA',
  };
}

async function llegoEsperado(e) {
  if (!e) return;
  const p = payloadDesdeEsperado(e);
  if (!p.patente) {
    const pat = await pedirDato(`Llegada · ${e.contraparte || ''}\n\nEl retiro no tiene patente coordinada. Ingrese la patente del camión que llegó.`,
      { aceptar: 'Registrar llegada', placeholder: 'AA-BB-12', icono: 'local_shipping' });
    if (pat === null) return;
    p.patente = fmtPatente(pat);
  }
  const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: 'presentacion' });
  if (error) return showAlert(errMsg(error), 'error');
  S.visitas.push(data);
  e.visita_id = data.id;
  showAlert(`Llegada registrada ${hhmm(data.t_presentacion)} · ${data.patente || ''}`);
  renderRegistro();
}

// ── Formulario (alta manual / edición) ──────────────────────────────────────
async function abrirForm(v) {
  await catalogos();
  const nuevo = !v;
  const f = v ? JSON.parse(JSON.stringify(v)) : { tipo: 'TRONCAL', documentos: [], retiros: [] };
  let vinculo = null; // esperado vinculado al patente (sólo alta)
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="Registro portería"></aside>`;
  document.body.appendChild(wrap);
  const dr = wrap.querySelector('.sv-dr');
  const cerrar = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.sv-cf-bg')) { ev.preventDefault(); cerrar(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sv-dr-bg').addEventListener('click', cerrar);

  const fld = (lbl, id, val, extra = '', cls = '') => `<label class="pt-f ${cls}"><span>${lbl}</span><input id="${id}" value="${esc(val ?? '')}" ${extra}></label>`;

  const draw = () => {
    const T = TIPOS[f.tipo];
    const desp = f.tipo === 'DESPACHO_EBEMA';
    const listaContra = f.tipo === 'TRONCAL' ? (S.centros || []).map(c => c.nombre) : f.tipo === 'PROVEEDOR' ? (S.proveedores || []) : [];
    dr.innerHTML = `
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${nuevo ? 'Registrar camión' : `Visita #${f.id} · ${fechaCorta(f.fecha)}`}</div>
          <div class="sv-dr-t">${esc(f.patente || 'Nuevo registro')}</div>
          <div class="sv-dr-s">${nuevo ? 'CD Quilicura (1003)' : `${estadoPill(f.estado)} · ${esc(f.origen || 'MANUAL')}${f.updated_by ? ` · editado por ${esc(f.updated_by)}` : ''}`}</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Tipo de movimiento</div>
          <div class="sv-seg" style="flex-wrap:wrap">${Object.entries(TIPOS).map(([k, t]) => `<button type="button" data-tipo="${k}" class="${f.tipo === k ? 'is-on' : ''}"><span class="material-symbols-outlined">${t.icon}</span>${t.label}</button>`).join('')}</div>
          ${desp ? `<div class="sv-seg" style="margin-top:8px;display:inline-flex">${['GENERAL', 'FIERRO'].map(s => `<button type="button" data-sub="${s}" class="${(f.subtipo || 'GENERAL') === s ? 'is-on' : ''}">${s === 'GENERAL' ? 'Despacho general' : 'Fierro'}</button>`).join('')}</div>` : ''}
          <div class="pt-sub" style="margin-top:6px">Hitos: ${T.hitos.map(h => HITO_LBL[h]).join(' → ')}</div>
        </div>
        <div id="pt-match"></div>
        <div>
          <div class="sv-dr-sect">Camión y chofer</div>
          <div class="pt-grid">
            ${fld('Patente camión *', 'f-patente', f.patente, 'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${fld('Patente carro', 'f-carro', f.patente_carro, 'class="is-mono" autocomplete="off"')}
            ${fld('Nombre chofer', 'f-chofer', f.chofer_nombre, 'autocomplete="off"')}
            ${fld('RUT chofer', 'f-rut', f.chofer_rut, 'autocomplete="off"')}
            ${fld('Teléfono', 'f-tel', f.chofer_telefono, 'autocomplete="off"')}
            ${fld('Transportista', 'f-transp', f.transportista, 'autocomplete="off"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">${T.contra} y documentos</div>
          <div class="pt-grid">
            ${f.tipo === 'TRONCAL'
              ? `<label class="pt-f full"><span>${T.contra}</span><select id="f-ce"><option value="">— Seleccionar —</option>${(S.centros || []).map(c => `<option value="${esc(c.id)}" ${f.ce === c.id ? 'selected' : ''}>${esc(c.nombre)} (${esc(c.id)})</option>`).join('')}</select></label>`
              : `${fld(T.contra, 'f-contra', f.contraparte, `list="pt-dl" autocomplete="off"`, f.tipo === 'PROVEEDOR' ? '' : 'full')}<datalist id="pt-dl">${listaContra.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`}
            ${f.tipo === 'PROVEEDOR' ? fld('Hora agenda', 'f-agenda', f.hora_agenda ? toLocalInput(f.hora_agenda).slice(11) : '', 'type="time"') : ''}
            <div class="pt-f full"><span>Guías / OC / NV / Entregas / DT</span>
              <div class="pt-docs" id="f-docs">${(f.documentos || []).map((d, i) => `<span class="pt-doc"><b>${esc(d.tipo)}</b>${esc(d.numero)}<button type="button" data-deldoc="${i}" title="Quitar"><span class="material-symbols-outlined">close</span></button></span>`).join('') || '<span class="pt-sub">Sin documentos.</span>'}</div>
              <div class="pt-docadd"><select id="f-doctipo">${DOC_TIPOS.map(t => `<option ${t === (desp ? 'GUIA' : f.tipo === 'PROVEEDOR' ? 'OC' : f.tipo === 'RETIRO_CLIENTE' ? 'NV' : 'GUIA') ? 'selected' : ''}>${t}</option>`).join('')}</select>
                <input id="f-docnum" class="pt-mono" placeholder="N° (varios separados por coma)" autocomplete="off"><button type="button" class="sv-btn" id="f-docadd">Agregar</button></div>
            </div>
            ${(f.retiros || []).length ? `<div class="pt-f full"><span>Retiros de Fábrica vinculados</span><div class="sv-tags" style="margin:0">${f.retiros.map(r => `<span class="sv-tag mute">OC ${esc(r.doc_compr)} · ${esc(r.proveedor || '')}</span>`).join('')}</div></div>` : ''}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Romana (kg, digitado)</div>
          <div class="pt-grid">
            ${fld(desp ? 'Peso salida (cargado)' : 'Peso entrada', desp ? 'f-bruto' : 'f-tara', desp ? f.bruto_kg : f.tara_kg, 'inputmode="decimal" class="pt-mono"')}
            ${fld(desp ? 'Peso regreso' : 'Peso salida', desp ? 'f-tara' : 'f-bruto', desp ? f.tara_kg : f.bruto_kg, 'inputmode="decimal" class="pt-mono"')}
            ${fld('Peso según guías', 'f-guias', f.peso_guias_kg, 'inputmode="decimal" class="pt-mono"')}
            <div class="pt-f"><span>Neto / diferencia</span><div class="pt-calc" id="f-calc" style="padding:8px 0"></div></div>
          </div>
        </div>
        ${nuevo ? '' : `<div>
          <div class="sv-dr-sect">Hitos (corrección manual)</div>
          <div class="pt-grid">${T.hitos.map(h => fld(HITO_LBL[h], 'f-h-' + h, toLocalInput(f['t_' + h]), 'type="datetime-local"')).join('')}</div>
          <div class="pt-sub" style="margin-top:6px">Sólo para corregir errores: los hitos se registran con los botones del Reloj Control.</div>
        </div>`}
        <label class="pt-f"><span>Observaciones</span><textarea id="f-obs" rows="2">${esc(f.obs || '')}</textarea></label>
      </div>
      <div class="sv-dr-f">
        <div style="display:flex;gap:6px;flex-wrap:wrap">${nuevo ? '' : `
          ${desp ? '' : '<button class="sv-btn" data-est="NO_SE_PRESENTA">No se presenta</button><button class="sv-btn" data-est="NO_CARGA">No carga</button>'}
          ${['NO_SE_PRESENTA', 'NO_CARGA', 'ANULADO'].includes(f.estado) ? '<button class="sv-btn" data-est="REABRIR">Reabrir</button>' : '<button class="sv-btn" data-est="ANULADO">Anular</button>'}`}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="sv-btn" data-x>Cancelar</button>
          ${nuevo ? `<button class="sv-btn" data-save="">Guardar sin hito</button>
            <button class="sv-btn-p" data-save="${desp ? 'salida' : 'presentacion'}"><span class="material-symbols-outlined">${desp ? 'logout' : 'login'}</span>Guardar y marcar ${desp ? 'salida' : 'llegada'}</button>`
            : '<button class="sv-btn-p" data-save="edit">Guardar cambios</button>'}
        </div>
      </div>`;
    bind();
    calc();
    if (nuevo && f.patente) buscarPatente(false);
  };

  const val = id => dr.querySelector('#' + id)?.value?.trim() ?? '';
  const leer = () => {
    f.patente = val('f-patente') ? fmtPatente(val('f-patente')) : null;
    f.patente_carro = val('f-carro') ? fmtPatente(val('f-carro')) : null;
    f.chofer_nombre = val('f-chofer') || null;
    f.chofer_rut = val('f-rut') || null;
    f.chofer_telefono = val('f-tel') || null;
    f.transportista = val('f-transp') || null;
    if (f.tipo === 'TRONCAL') {
      const ce = val('f-ce');
      f.ce = ce || null;
      f.contraparte = ce ? (S.centros.find(c => c.id === ce)?.nombre || ce) : (f.contraparte || null);
    } else if (dr.querySelector('#f-contra')) { f.contraparte = val('f-contra') || null; }
    if (dr.querySelector('#f-agenda')) {
      const h = val('f-agenda');
      f.hora_agenda = h ? fromLocalInput(`${f.fecha || S.fecha}T${h}`) : null;
    }
    f.tara_kg = num(val('f-tara'));
    f.bruto_kg = num(val('f-bruto'));
    f.peso_guias_kg = num(val('f-guias'));
    f.obs = val('f-obs') || null;
    if (!nuevo) TIPOS[f.tipo].hitos.forEach(h => { const el = dr.querySelector('#f-h-' + h); if (el) f['t_' + h] = fromLocalInput(el.value); });
  };
  const calc = () => {
    const a = num(val('f-tara')), b = num(val('f-bruto')), g = num(val('f-guias'));
    const el = dr.querySelector('#f-calc'); if (!el) return;
    if (a == null || b == null) { el.innerHTML = 'Faltan pesajes'; return; }
    const neto = Math.abs(b - a);
    let txt = `Neto <b>${nf(neto)} kg</b>`;
    if (g > 0) {
      const p = (neto - g) / g * 100;
      const tol = Number(S.metas[f.tipo]?.tolerancia_peso_pct ?? 3);
      txt += ` · <b style="color:${Math.abs(p) > tol ? '#b5000b' : '#15803d'}">${p > 0 ? '+' : ''}${nf(p, 1)}%</b> vs guías (tol. ${nf(tol, 1)}%)`;
    }
    el.innerHTML = txt;
  };
  // Al ingresar la patente: proponer chofer desde la base de choferes y detectar si es un camión esperado hoy
  const buscarPatente = async (rellenar = true) => {
    const pat = fmtPatente(val('f-patente'));
    const inp = dr.querySelector('#f-patente');
    if (!pat) return;
    inp.value = pat;
    inp.classList.toggle('is-err', !patenteValida(pat));
    if (rellenar && !val('f-chofer')) {
      const { data } = await supabase.from('abast_base_choferes').select('chofer_nombre,chofer_rut,chofer_telefono,transportista,id_transporte,patente_carro')
        .eq('patente', pat).order('ultimo_uso', { ascending: false }).limit(1);
      const b = data?.[0];
      if (b) {
        const set = (id, v) => { const el = dr.querySelector('#' + id); if (el && !el.value && v) el.value = v; };
        set('f-chofer', b.chofer_nombre); set('f-rut', b.chofer_rut); set('f-tel', b.chofer_telefono); set('f-transp', b.transportista); set('f-carro', b.patente_carro);
        f.id_transporte = f.id_transporte || b.id_transporte || null;
      }
    }
    if (!nuevo) return;
    const box = dr.querySelector('#pt-match');
    const e = S.esperados.find(x => !x.visita_id && x.patente === pat);
    // No repintar si no cambió: al salir del campo patente (blur → change) el botón Vincular no debe reemplazarse bajo el clic
    const k = e && S.fecha === hoy() ? e.clave + (vinculo === e ? '|v' : '') : '';
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    if (!k) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="pt-match"><div><b>${pat}</b> está esperado hoy: ${esc(TIPOS[e.tipo].label)} ${e.tipo === 'TRONCAL' ? 'a ' : ''}${esc(e.contraparte || '')}
        ${e.consolida_retiro ? `<div class="pt-sub">Consolida retiro de fábrica: ${(e.retiros || []).map(r => 'OC ' + esc(r.doc_compr)).join(', ')}</div>` : ''}</div>
      <button type="button" class="sv-btn" id="pt-vinc">${vinculo === e ? 'Vinculado ✓' : 'Vincular'}</button></div>`;
    box.querySelector('#pt-vinc').addEventListener('click', () => {
      leer();
      vinculo = e;
      const p = payloadDesdeEsperado(e);
      Object.keys(p).forEach(k => { if (p[k] != null && (k !== 'documentos' || !(f.documentos || []).length)) f[k] = p[k]; });
      draw();
    });
  };

  const bind = () => {
    dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
    dr.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { leer(); f.tipo = b.dataset.tipo; if (f.tipo !== 'DESPACHO_EBEMA') f.subtipo = null; draw(); }));
    dr.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { leer(); f.subtipo = b.dataset.sub; draw(); }));
    dr.querySelector('#f-patente').addEventListener('change', () => buscarPatente(true));
    ['f-tara', 'f-bruto', 'f-guias'].forEach(id => dr.querySelector('#' + id)?.addEventListener('input', calc));
    const addDoc = () => {
      const tipo = val('f-doctipo');
      const nums = val('f-docnum').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      if (!nums.length) return;
      leer();
      f.documentos = f.documentos || [];
      nums.forEach(n => { if (!f.documentos.some(d => d.tipo === tipo && d.numero === n)) f.documentos.push({ tipo, numero: n }); });
      draw();
      dr.querySelector('#f-docnum')?.focus();
    };
    dr.querySelector('#f-docadd').addEventListener('click', addDoc);
    dr.querySelector('#f-docnum').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDoc(); } });
    dr.querySelectorAll('[data-deldoc]').forEach(b => b.addEventListener('click', () => { leer(); f.documentos.splice(+b.dataset.deldoc, 1); draw(); }));
    dr.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => guardar(b.dataset.save, b)));
    dr.querySelectorAll('[data-est]').forEach(b => b.addEventListener('click', () => cambiarEstado(b.dataset.est)));
  };

  const guardar = async (modo, btn) => {
    leer();
    if (!f.patente) { showAlert('Ingrese la patente del camión', 'error'); dr.querySelector('#f-patente').focus(); return; }
    if (!patenteValida(f.patente) && !(await confirmar(`¿Continuar con la patente ${f.patente}?\n\nNo tiene el formato AA-BB-12 / AA-12-34.`, { aceptar: 'Continuar' }))) return;
    if (f.tipo === 'TRONCAL' && !f.contraparte) { showAlert('Seleccione la sucursal destino del troncal', 'error'); return; }
    btn.disabled = true;
    if (nuevo) {
      const p = {
        tipo: f.tipo, subtipo: f.tipo === 'DESPACHO_EBEMA' ? (f.subtipo || 'GENERAL') : null, fecha: S.fecha,
        patente: f.patente, patente_carro: f.patente_carro, chofer_nombre: f.chofer_nombre, chofer_rut: f.chofer_rut, chofer_telefono: f.chofer_telefono,
        id_transporte: f.id_transporte || null, transportista: f.transportista, contraparte: f.contraparte, ce: f.ce || null,
        documentos: f.documentos || [], hora_agenda: f.hora_agenda, tara_kg: f.tara_kg, bruto_kg: f.bruto_kg, peso_guias_kg: f.peso_guias_kg, obs: f.obs,
        clave_esperado: vinculo ? f.clave_esperado : null, plan_ref: vinculo ? f.plan_ref : null, retiros: vinculo ? f.retiros : [],
        consolida_retiro: vinculo ? !!f.consolida_retiro : false, origen: vinculo ? f.origen : 'MANUAL',
        estado: modo ? 'EN_COLA' : 'PROGRAMADO',
      };
      const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: modo || null });
      btn.disabled = false;
      if (error) return showAlert(errMsg(error), 'error');
      S.visitas.push(data);
      if (vinculo) vinculo.visita_id = data.id;
      showAlert(modo ? `${HITO_LBL[modo]} registrada ${hhmm(data['t_' + modo])} · ${data.patente}` : 'Camión registrado');
    } else {
      const upd = {
        tipo: f.tipo, subtipo: f.tipo === 'DESPACHO_EBEMA' ? (f.subtipo || 'GENERAL') : null,
        patente: f.patente, patente_carro: f.patente_carro, chofer_nombre: f.chofer_nombre, chofer_rut: f.chofer_rut, chofer_telefono: f.chofer_telefono,
        transportista: f.transportista, contraparte: f.contraparte, ce: f.ce || null, documentos: f.documentos || [], hora_agenda: f.hora_agenda,
        tara_kg: f.tara_kg, bruto_kg: f.bruto_kg, peso_guias_kg: f.peso_guias_kg, obs: f.obs,
        t_presentacion: f.t_presentacion ?? null, t_ingreso: f.t_ingreso ?? null, t_salida: f.t_salida ?? null, t_regreso: f.t_regreso ?? null,
      };
      // Al cambiar de tipo, los hitos que no aplican se limpian
      Object.keys(HITO_LBL).forEach(h => { if (!TIPOS[f.tipo].hitos.includes(h)) upd['t_' + h] = null; });
      const { data, error } = await supabase.from('porteria_visitas').update(upd).eq('id', f.id).select(COLS).single();
      btn.disabled = false;
      if (error) return showAlert(errMsg(error), 'error');
      reemplazar(data);
      showAlert('Cambios guardados');
    }
    cerrar();
    renderRegistro();
  };

  const cambiarEstado = async est => {
    const txt = { NO_SE_PRESENTA: 'Marcar "No se presenta"', NO_CARGA: 'Marcar "No carga"', ANULADO: 'Anular el registro', REABRIR: 'Reabrir el registro' }[est];
    if (!(await confirmar(`¿${txt} de ${f.patente || 'este camión'}?\n\n${est === 'ANULADO' ? 'No cuenta en los indicadores.' : est === 'REABRIR' ? 'El estado vuelve a calcularse desde los hitos.' : 'Queda registrado para el indicador de cumplimiento.'}`,
      { aceptar: est === 'REABRIR' ? 'Reabrir' : 'Confirmar', tono: est === 'ANULADO' ? 'peligro' : 'normal' }))) return;
    const { data, error } = await supabase.from('porteria_visitas').update({ estado: est === 'REABRIR' ? 'EN_COLA' : est }).eq('id', f.id).select(COLS).single();
    if (error) return showAlert(errMsg(error), 'error');
    reemplazar(data);
    const e = S.esperados.find(x => x.visita_id === f.id);
    if (e && est === 'ANULADO') e.visita_id = null;
    cerrar();
    renderRegistro();
  };

  draw();
  dr.querySelector('#f-patente')?.focus();
}

// ── Indicadores ─────────────────────────────────────────────────────────────
async function renderIndicadores() {
  _stage.innerHTML = `<div class="sv-view pt"><div class="sv-desc">Calculando indicadores…</div></div>`;
  const { data, error } = await supabase.rpc('fn_porteria_indicadores', { p_desde: S.desde, p_hasta: S.hasta, p_centro: CENTRO });
  if (error) { _stage.innerHTML = `<div class="sv-view pt"><div class="sv-note-box">Error: ${esc(error.message)}</div></div>`; return; }
  S.ind = data || {};
  const I = S.ind;
  const porTipo = Object.fromEntries((I.por_tipo || []).map(t => [t.tipo, t]));
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

  const tile = (k) => {
    const T = TIPOS[k], t = porTipo[k] || { n: 0 };
    const desp = k === 'DESPACHO_EBEMA';
    const p50 = desp ? t.ruta_p50 : t.perm_p50, p90 = desp ? t.ruta_p90 : t.perm_p90;
    const meta = S.metas[k]?.meta_min;
    const sobre = pct(t.sobre_meta || 0, t.con_metrica || 0);
    const color = meta == null || p50 == null ? '#9ca3af' : p50 > meta ? '#b5000b' : p50 > meta * 0.8 ? '#ca8a04' : '#15803d';
    return `<div class="pt-tile">
      <div class="pt-tile-h">${tipoPill(k)}<span class="pt-sub">${nf(t.n)} visitas</span></div>
      <div><div class="pt-sub">${desp ? 'Tiempo en ruta' : 'Permanencia en CD'} · mediana</div>
        <div class="pt-big" style="color:${color}">${fmtMin(p50)}<small>${meta ? `meta ${meta} min` : 'sin meta'}</small></div></div>
      ${meta && t.con_metrica ? `<div><div class="pt-bar"><i style="width:${100 - sobre}%;background:#15803d"></i></div><div class="pt-sub">${100 - sobre}% dentro de meta · ${sobre}% sobre meta</div></div>` : ''}
      <div class="pt-kv">
        <span>P90 ${desp ? 'ruta' : 'permanencia'}</span><span>${fmtMin(p90)}</span>
        ${desp ? '' : `<span>Espera en portería (p50 / p90)</span><span>${fmtMin(t.espera_p50)} / ${fmtMin(t.espera_p90)}</span>
        <span>Tiempo total (p50)</span><span>${fmtMin(t.total_p50)}</span>`}
        <span>Finalizados / en curso</span><span>${nf(t.finalizados || 0)} / ${nf(t.en_curso || 0)}</span>
        ${desp ? '' : `<span>No se presenta / No carga</span><span>${nf(t.no_se_presenta || 0)} / ${nf(t.no_carga || 0)}</span>`}
        ${k === 'TRONCAL' ? `<span>Consolidan retiro de fábrica</span><span>${nf(t.consolida || 0)}</span>` : ''}
        <span>Pesos fuera de tolerancia</span><span>${nf(t.fuera_tol || 0)} de ${nf(t.con_peso || 0)}</span>
      </div></div>`;
  };

  // Llegadas por hora (presentación; salida para despachos)
  const horas = Array.from({ length: 16 }, (_, i) => i + 6);
  const ph = I.por_hora || [];
  const maxH = Math.max(1, ...ph.map(x => x.n));
  const heat = `<table class="pt-heat"><thead><tr><th></th>${horas.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${Object.keys(TIPOS).map(k => `<tr><th>${TIPOS[k].label}</th>${horas.map(h => {
      const n = ph.find(x => x.tipo === k && x.hora === h)?.n || 0;
      const a = n ? 0.12 + 0.78 * n / maxH : 0;
      return `<td style="background:${n ? `rgba(181,0,11,${a.toFixed(2)})` : 'var(--sv-s1)'};color:${a > 0.5 ? '#fff' : 'var(--sv-ink)'}" title="${TIPOS[k].label} · ${h}:00 · ${n}">${n || ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;

  const pc = (I.por_contraparte || []).slice().sort((a, b) => b.n - a.n);
  const tablaPc = `<table class="sv-table"><thead><tr><th>Tipo</th><th>Contraparte</th><th class="r">Visitas</th><th class="r">Espera p50</th><th class="r">Permanencia / ruta p50</th><th class="r">% sobre meta</th></tr></thead><tbody>
    ${pc.length ? pc.map(r => {
      const s = pct(r.sobre_meta || 0, r.con_metrica || 0);
      return `<tr style="cursor:default"><td>${tipoPill(r.tipo)}</td><td>${esc(r.contraparte)}</td><td class="r">${nf(r.n)}</td>
        <td class="r pt-mono">${r.tipo === 'DESPACHO_EBEMA' ? '<span class="pt-na">·</span>' : fmtMin(r.espera_p50)}</td><td class="r pt-mono">${fmtMin(r.metrica_p50)}</td>
        <td class="r">${s == null || S.metas[r.tipo]?.meta_min == null ? '<span class="pt-na">—</span>' : pill(s + '%', s > 50 ? 'bad' : s > 20 ? 'warn' : 'ok')}</td></tr>`;
    }).join('') : '<tr class="sv-empty"><td colspan="6">Sin visitas en el período.</td></tr>'}</tbody></table>`;

  _stage.innerHTML = `<div class="sv-view pt">
    <div class="sv-vhead">
      <div><h1 class="sv-h1">Indicadores de Portería</h1>
        <div class="sv-desc">Tiempos de permanencia de camiones en CD Quilicura (1003): espera en portería (presentación → ingreso), permanencia (ingreso → salida) y ruta de despachos Ebema (salida → regreso). Medianas (p50) y percentil 90.</div></div>
      <div class="sv-actions">
        <label class="sv-inp"><span class="material-symbols-outlined">date_range</span><input type="date" id="pi-desde" value="${S.desde}"><span class="sv-sep">→</span><input type="date" id="pi-hasta" value="${S.hasta}"></label>
        <button class="sv-btn" id="pi-csv"><span class="material-symbols-outlined">download</span>Detalle CSV</button>
      </div>
    </div>
    <div class="pt-tiles">${Object.keys(TIPOS).map(tile).join('')}</div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">schedule</span>Llegadas por hora <small>presentación en portería · salida en despachos</small></h2></div>
      <div style="padding:12px 16px;overflow-x:auto">${heat}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">leaderboard</span>Por sucursal, proveedor o cliente</h2></div>
      <div class="sv-tablewrap" style="max-height:480px">${tablaPc}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">flag</span>Metas</h2><button class="sv-btn-p" id="pi-metas">Guardar metas</button></div>
      <div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Tipo</th><th>Métrica</th><th class="r">Meta (min)</th><th class="r">Tolerancia peso (%)</th></tr></thead><tbody>
      ${Object.keys(TIPOS).map(k => `<tr style="cursor:default"><td>${tipoPill(k)}</td><td>${k === 'DESPACHO_EBEMA' ? 'Salida → regreso' : 'Ingreso → salida'}</td>
        <td class="r"><input data-meta="${k}" value="${S.metas[k]?.meta_min ?? ''}" inputmode="numeric" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td>
        <td class="r"><input data-tol="${k}" value="${S.metas[k]?.tolerancia_peso_pct ?? 3}" inputmode="decimal" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td></tr>`).join('')}
      </tbody></table></div></div>
  </div>`;

  const $ = s => _stage.querySelector(s);
  const recargar = () => { S.desde = $('#pi-desde').value || S.desde; S.hasta = $('#pi-hasta').value || S.hasta; if (S.desde > S.hasta) [S.desde, S.hasta] = [S.hasta, S.desde]; renderIndicadores(); };
  $('#pi-desde').addEventListener('change', recargar);
  $('#pi-hasta').addEventListener('change', recargar);
  $('#pi-csv').addEventListener('click', descargarCSV);
  $('#pi-metas').addEventListener('click', async () => {
    const rows = Object.keys(TIPOS).map(k => ({
      tipo: k, meta_min: num(_stage.querySelector(`[data-meta="${k}"]`).value), tolerancia_peso_pct: num(_stage.querySelector(`[data-tol="${k}"]`).value) ?? 3,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('porteria_metas').upsert(rows, { onConflict: 'tipo' });
    if (error) return showAlert('No se pudieron guardar las metas: ' + error.message, 'error');
    await cargarMetas();
    showAlert('Metas guardadas');
    renderIndicadores();
  });
}

async function descargarCSV() {
  const { data, error } = await supabase.from('porteria_visitas').select(COLS).eq('centro', CENTRO)
    .gte('fecha', S.desde).lte('fecha', S.hasta).order('fecha').order('created_at').limit(20000);
  if (error) return showAlert('Error al descargar: ' + error.message, 'error');
  const f = t => (t ? new Date(t).toLocaleString('es-CL', { timeZone: TZ }) : '');
  const m = (a, b) => { const x = minEntre(a, b); return x == null ? '' : Math.round(x); };
  const kg = v => (v == null ? '' : String(v).replace('.', ','));
  const rows = (data || []).map(v => [
    v.fecha, TIPOS[v.tipo]?.label || v.tipo, v.subtipo || '', (ESTADOS[v.estado] || [v.estado])[0], v.patente || '', v.patente_carro || '',
    v.chofer_nombre || '', v.chofer_rut || '', v.transportista || '', v.contraparte || '', docsTxt(v.documentos),
    (v.retiros || []).map(r => r.doc_compr).join(' '), v.consolida_retiro ? 'SI' : '',
    f(v.hora_agenda), f(v.t_presentacion), f(v.t_ingreso), f(v.t_salida), f(v.t_regreso),
    m(v.t_presentacion, v.t_ingreso), m(v.t_ingreso, v.t_salida), m(v.t_presentacion, v.t_salida), m(v.t_salida, v.t_regreso),
    kg(v.tara_kg), kg(v.bruto_kg), kg(v.neto_kg), kg(v.peso_guias_kg), v.origen || '', v.obs || '',
  ]);
  const head = ['Fecha', 'Tipo', 'Subtipo', 'Estado', 'Patente', 'Patente carro', 'Chofer', 'RUT chofer', 'Transportista', 'Contraparte', 'Documentos',
    'OC retiro', 'Consolida retiro', 'Hora agenda', 'Presentación', 'Ingreso', 'Salida', 'Regreso',
    'Espera (min)', 'Permanencia (min)', 'Total (min)', 'Ruta (min)', 'Peso entrada/regreso (kg)', 'Peso salida (kg)', 'Neto (kg)', 'Peso guías (kg)', 'Origen', 'Observaciones'];
  downloadFile(`reloj_control_${S.desde}_${S.hasta}.csv`, toCSV(head, rows));
}
