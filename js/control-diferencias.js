// ============================================================================
// GESTIÓN TRONCALES – CONTROL DE DIFERENCIAS  (Ola 2, 11-oct-2026)
// ----------------------------------------------------------------------------
// Bandeja de diferencias del Plan de Carga detectadas por el servidor
// (v_abast_control_detecciones → abast_control_diferencia, cada 30 min en horario
// hábil o con «Actualizar ahora»). Cada control tiene un rol responsable; la
// diferencia se cierra con motivo (fn_abast_cerrar_diferencia). Las que dejan de
// detectarse quedan como «Resuelta automática».
// C02 (entrega > pedido): el exceso queda fuera del plan; antes del cierre se
// puede subir (fn_abast_subir_exceso_entrega) y queda sujeto al llenado del camión.
// CSS encapsulado (.cdf-*): el Tailwind del sitio está compilado.
// ============================================================================
import { supabase } from './supabase-client.js?v=202610261052';
import { filtrarPorCentro, getRol, rolClase } from './permisos.js?v=202610261052';
import { showAlert, escapeHtml } from './utils.js';

const C = { ink: '#191c1d', ink2: '#5c5f61', line: '#e1e3e4', soft: '#f8f9fa', red: '#b5000b', amber: '#ca8a04', green: '#15803d', blue: '#1d4ed8' };
const ROL_LBL = { PLANNER_ABASTECIMIENTO: 'Planner Abastecimiento', PLANNER_OPERACIONES: 'Planner Operaciones', OWNER: 'Owner' };
// (12-oct-2026) perfiles v2: responsable que cubre cada perfil (igual que fn_abast_cerrar_diferencia)
const RESP_PERFIL = { PLANNER_ABASTECIMIENTO: 'PLANNER_ABASTECIMIENTO', JEFE_ABASTECIMIENTO: 'PLANNER_ABASTECIMIENTO', PLANNER_OPERACIONES: 'PLANNER_OPERACIONES', JEFE_OPERACIONES: 'PLANNER_OPERACIONES' };
const EST_LBL = { abierta: 'Abiertas', cerrada: 'Cerradas', resuelta_auto: 'Resueltas automáticas' };
const S = { estado: 'abierta', resp: null, control: 'all', q: '', rows: [], cat: [], ult: null, page: 0 };
const PAGE = 50;
let root = null;
const esc = s => escapeHtml(String(s ?? ''));
const fmt = (n, d = 1) => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const fh = ts => { if (!ts) return '—'; const d = new Date(ts); return isNaN(d) ? '—' : d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const rol = () => getRol() || '';
const puedeCerrar = r => ['OWNER', 'ADMIN'].includes(rolClase()) || rol() === r.responsable || rolClase() === r.responsable || RESP_PERFIL[rol()] === r.responsable;
const puedeSubir = () => ['OWNER', 'ADMIN', 'PLANNER_ABASTECIMIENTO'].includes(rolClase());

async function fetchPag(build) {
  const size = 1000; let out = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await build().range(p * size, p * size + size - 1);
    if (error) { showAlert('Error al cargar diferencias: ' + error.message, 'error'); break; }
    out = out.concat(data || []);
    if (!data || data.length < size) break;
  }
  return out;
}

export async function renderControlDiferencias(stage) {
  root = stage;
  if (S.resp === null) S.resp = RESP_PERFIL[rol()] || 'all';
  root.innerHTML = `${css()}<div class="cdf"><div class="cdf-empty">Cargando diferencias…</div></div>`;
  await cargar();
  pintar();
}

async function cargar() {
  const [cat, rows] = await Promise.all([
    supabase.from('abast_control_catalogo').select('*').order('orden'),
    fetchPag(() => supabase.from('abast_control_diferencia').select('*').eq('estado', S.estado).order('detectado_en', { ascending: false })),
  ]);
  S.cat = cat.data || [];
  S.rows = filtrarPorCentro(rows, r => r.centro || '').concat(rows.filter(r => !r.centro));   // sin centro (fuentes, materiales) visibles para todos
  S.rows = Array.from(new Map(S.rows.map(r => [r.id, r])).values());
  S.ult = rows.reduce((m, r) => (!m || r.actualizado_en > m ? r.actualizado_en : m), null);
}

function filtradas() {
  const q = S.q.trim().toLowerCase();
  return S.rows.filter(r => (S.resp === 'all' || r.responsable === S.resp)
    && (S.control === 'all' || r.control === S.control)
    && (!q || `${r.centro} ${r.documento} ${r.material} ${r.detalle}`.toLowerCase().includes(q)));
}

function pintar() {
  const cat = new Map(S.cat.map(c => [c.control, c]));
  const base = S.rows.filter(r => S.resp === 'all' || r.responsable === S.resp);
  const porCtl = {}; base.forEach(r => { porCtl[r.control] = (porCtl[r.control] || 0) + 1; });
  const porResp = {}; S.rows.forEach(r => { porResp[r.responsable] = (porResp[r.responsable] || 0) + 1; });
  const rows = filtradas();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); S.page = Math.min(S.page, pages - 1);
  const vis = rows.slice(S.page * PAGE, (S.page + 1) * PAGE);
  const bloq = base.filter(r => r.efecto === 'Bloquea líneas').length;
  root.querySelector('.cdf').innerHTML = `
    <div class="cdf-card">
      <div class="cdf-head">
        <div><h3>GESTIÓN TRONCALES – CONTROL DE DIFERENCIAS</h3>
          <p>Diferencias entre SAP, el Plan de Carga, lo programado y lo despachado. Cada una tiene un responsable y se cierra con motivo antes del corte.</p></div>
        <div class="cdf-actions"><span class="cdf-muted">Última detección: ${fh(S.ult)}</span>
          <button class="cdf-btn ghost" data-act="csv"><span class="material-symbols-outlined">download</span>CSV</button>
          <button class="cdf-btn" data-act="refresh"><span class="material-symbols-outlined">refresh</span>Actualizar ahora</button></div>
      </div>
      <div class="cdf-kpis">
        ${['abierta', 'cerrada', 'resuelta_auto'].map(k => `<button class="cdf-seg ${S.estado === k ? 'on' : ''}" data-estado="${k}">${EST_LBL[k]}</button>`).join('')}
        <span class="cdf-sep"></span>
        <button class="cdf-chip ${S.resp === 'all' ? 'on' : ''}" data-resp="all">Todos <b>${S.rows.length}</b></button>
        ${Object.keys(ROL_LBL).map(k => `<button class="cdf-chip ${S.resp === k ? 'on' : ''}" data-resp="${k}">${ROL_LBL[k]} <b>${porResp[k] || 0}</b></button>`).join('')}
        ${S.estado === 'abierta' && bloq ? `<span class="cdf-tag red">${bloq} bloquean líneas del plan</span>` : ''}
      </div>
      <div class="cdf-ctls">
        <button class="cdf-ctl ${S.control === 'all' ? 'on' : ''}" data-ctl="all">Todos los controles</button>
        ${S.cat.filter(c => porCtl[c.control]).map(c => `<button class="cdf-ctl ${S.control === c.control ? 'on' : ''}" data-ctl="${c.control}" title="${esc(c.regla)}">${c.control} ${esc(c.nombre)} <b>${porCtl[c.control]}</b></button>`).join('')}
      </div>
      <label class="cdf-search"><span class="material-symbols-outlined">search</span>
        <input id="cdf-q" value="${esc(S.q)}" placeholder="Buscar centro, documento, material o detalle…" autocomplete="off"/></label>
      ${S.control !== 'all' && cat.get(S.control) ? `<p class="cdf-note"><b>${S.control} · ${esc(cat.get(S.control).nombre)}:</b> ${esc(cat.get(S.control).regla)}. <b>Acción:</b> ${esc(cat.get(S.control).accion)}.</p>` : ''}
      <div class="cdf-scroll"><table class="cdf-tbl">
        <thead><tr><th>Control</th><th>Centro</th><th>Documento</th><th>Material</th><th>Detalle</th><th class="r">Valor</th><th>Responsable</th><th>Efecto</th><th>Detectado</th><th>${S.estado === 'abierta' ? 'Acción' : 'Cierre'}</th></tr></thead>
        <tbody>${vis.length === 0 ? `<tr><td colspan="10" class="cdf-empty ok">${S.estado === 'abierta' ? 'Sin diferencias abiertas para este filtro.' : 'Sin registros.'}</td></tr>` : vis.map(r => fila(r, cat)).join('')}</tbody>
      </table></div>
      ${pages > 1 ? `<div class="cdf-pag"><button class="cdf-btn ghost" data-pg="-1" ${S.page === 0 ? 'disabled' : ''}>Anterior</button><span>${S.page + 1} / ${pages} · ${rows.length} filas</span><button class="cdf-btn ghost" data-pg="1" ${S.page >= pages - 1 ? 'disabled' : ''}>Siguiente</button></div>` : `<p class="cdf-muted">${rows.length} filas</p>`}
    </div>`;
  wire();
}

function fila(r, cat) {
  const c = cat.get(r.control) || {};
  const accion = S.estado === 'abierta'
    ? `${r.control === 'C02' && puedeSubir() ? `<button class="cdf-mini" data-subir="${esc(String(r.clave).split('|')[0])}" title="Subir el exceso al plan (queda sujeto al llenado del camión)">Subir al plan</button>` : ''}
       ${puedeCerrar(r) ? `<button class="cdf-mini ghost" data-cerrar="${r.id}">Cerrar</button>` : '<span class="cdf-muted">—</span>'}`
    : `<span class="cdf-muted">${esc(r.motivo || (r.estado === 'resuelta_auto' ? 'Dejó de detectarse' : ''))}${r.cerrado_por ? ' · ' + esc(r.cerrado_por) : ''} · ${fh(r.cerrado_en)}</span>`;
  return `<tr>
    <td title="${esc(c.regla || '')}"><b>${r.control}</b> <span class="cdf-muted">${esc(c.nombre || '')}</span></td>
    <td>${esc(r.centro || '—')}</td><td class="mono">${esc(r.documento || '—')}</td><td class="mono">${esc(r.material || '—')}</td>
    <td class="wrap">${esc(r.detalle || '')}</td><td class="r">${fmt(r.valor, r.control === 'C01' ? 1 : r.control === 'C13' ? 2 : 1)}</td>
    <td>${esc(ROL_LBL[r.responsable] || r.responsable)}</td>
    <td>${r.efecto === 'Bloquea líneas' ? '<span class="cdf-tag red">Bloquea</span>' : '<span class="cdf-tag">Aviso</span>'}</td>
    <td>${fh(r.detectado_en)}</td><td class="nowrap">${accion}</td></tr>`;
}

function wire() {
  const $ = s => root.querySelectorAll(s);
  $('[data-estado]').forEach(b => b.addEventListener('click', async () => { S.estado = b.dataset.estado; S.page = 0; await cargar(); pintar(); }));
  $('[data-resp]').forEach(b => b.addEventListener('click', () => { S.resp = b.dataset.resp; S.control = 'all'; S.page = 0; pintar(); }));
  $('[data-ctl]').forEach(b => b.addEventListener('click', () => { S.control = b.dataset.ctl; S.page = 0; pintar(); }));
  $('[data-pg]').forEach(b => b.addEventListener('click', () => { S.page += Number(b.dataset.pg); pintar(); }));
  const q = root.querySelector('#cdf-q'); let tk;
  if (q) q.addEventListener('input', e => { clearTimeout(tk); tk = setTimeout(() => { S.q = e.target.value; S.page = 0; pintar(); const n = root.querySelector('#cdf-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); });
  $('[data-act="refresh"]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Actualizando…';
    const { error } = await supabase.rpc('fn_abast_controles_actualizar');
    if (error) showAlert('No se pudo actualizar: ' + error.message, 'error');
    await cargar(); pintar();
  }));
  $('[data-act="csv"]').forEach(b => b.addEventListener('click', descargarCsv));
  $('[data-cerrar]').forEach(b => b.addEventListener('click', () => modalCerrar(S.rows.find(r => String(r.id) === b.dataset.cerrar))));
  $('[data-subir]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase.rpc('fn_abast_subir_exceso_entrega', { p_entrega: b.dataset.subir });
    if (error) { showAlert(error.message, 'error'); b.disabled = false; return; }
    showAlert('Exceso subido al plan: entra al llenado del camión (si no cabe, va al excedente).', 'success');
    await cargar(); pintar();
  }));
}

function modalCerrar(r) {
  if (!r) return;
  const c = S.cat.find(x => x.control === r.control) || {};
  const ov = document.createElement('div');
  ov.className = 'cdf-ov';
  ov.innerHTML = `${css()}<div class="cdf-modal">
    <div class="cdf-mhead"><h3>Cerrar ${r.control} · ${esc(c.nombre || '')}</h3><button class="cdf-x" data-x><span class="material-symbols-outlined">close</span></button></div>
    <p class="cdf-sub">${esc(r.detalle || '')}</p>
    <p class="cdf-note"><b>Acción sugerida:</b> ${esc(c.accion || '')}</p>
    <textarea id="cdf-motivo" class="cdf-in" rows="3" placeholder="Motivo del cierre (obligatorio)"></textarea>
    <div class="cdf-mfoot"><button class="cdf-btn ghost" data-x>Cancelar</button><button class="cdf-btn" data-ok>Cerrar diferencia</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('[data-ok]').addEventListener('click', async () => {
    const motivo = ov.querySelector('#cdf-motivo').value.trim();
    if (!motivo) { showAlert('El motivo es obligatorio.', 'error'); return; }
    const { error } = await supabase.rpc('fn_abast_cerrar_diferencia', { p_id: r.id, p_motivo: motivo });
    if (error) { showAlert(error.message, 'error'); return; }
    close(); await cargar(); pintar();
  });
  ov.querySelector('#cdf-motivo').focus();
}

function descargarCsv() {
  const cat = new Map(S.cat.map(c => [c.control, c]));
  const cols = ['Control', 'Nombre', 'Centro', 'Documento', 'Material', 'Detalle', 'Valor', 'Responsable', 'Efecto', 'Estado', 'Detectado', 'Motivo', 'Cerrado por', 'Cerrado en'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(';')].concat(filtradas().map(r => [r.control, (cat.get(r.control) || {}).nombre, r.centro, r.documento, r.material, r.detalle,
    r.valor == null ? '' : String(r.valor).replace('.', ','), ROL_LBL[r.responsable] || r.responsable, r.efecto, EST_LBL[r.estado] || r.estado,
    fh(r.detectado_en), r.motivo, r.cerrado_por, fh(r.cerrado_en)].map(q).join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `control_diferencias_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function css() {
  return `<style>
  .cdf{display:flex;flex-direction:column;gap:16px;color:${C.ink}}
  .cdf-card{background:#fff;border:1px solid ${C.line};border-radius:8px;padding:20px 24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .cdf-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid ${C.line};padding-bottom:12px;margin-bottom:12px}
  .cdf-head h3{margin:0;font-size:18px;font-weight:700}.cdf-head p{margin:4px 0 0;font-size:13px;color:${C.ink2};max-width:720px}
  .cdf-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cdf-muted{font-size:12px;color:${C.ink2}}
  .cdf-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid ${C.red};background:${C.red};color:#fff;border-radius:4px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer}
  .cdf-btn.ghost{background:#fff;color:${C.ink};border-color:${C.line}}.cdf-btn[disabled]{opacity:.5;cursor:default}
  .cdf-btn .material-symbols-outlined{font-size:18px}
  .cdf-kpis,.cdf-ctls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
  .cdf-sep{width:1px;height:22px;background:${C.line};margin:0 6px}
  .cdf-seg,.cdf-chip,.cdf-ctl{border:1px solid ${C.line};background:#fff;color:${C.ink2};border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
  .cdf-seg.on,.cdf-chip.on,.cdf-ctl.on{background:${C.ink};border-color:${C.ink};color:#fff}
  .cdf-chip b,.cdf-ctl b{margin-left:4px}
  .cdf-search{display:flex;align-items:center;gap:6px;border:1px solid ${C.line};border-radius:6px;padding:6px 10px;max-width:520px;margin-bottom:10px}
  .cdf-search input{border:0;outline:0;width:100%;font:inherit;font-size:13px;background:transparent}.cdf-search .material-symbols-outlined{font-size:18px;color:${C.ink2}}
  .cdf-note{font-size:12.5px;color:${C.ink2};background:${C.soft};border:1px solid ${C.line};border-radius:6px;padding:8px 10px;margin:0 0 10px;line-height:1.5}
  .cdf-scroll{overflow-x:auto}
  .cdf-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .cdf-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${C.ink2};font-weight:700;border-bottom:1px solid ${C.line};padding:8px 10px;white-space:nowrap;background:${C.soft}}
  .cdf-tbl td{padding:8px 10px;border-bottom:1px solid #edeeef;white-space:nowrap;vertical-align:top}
  .cdf-tbl td.wrap{white-space:normal;min-width:240px;max-width:420px}.cdf-tbl .r{text-align:right;font-variant-numeric:tabular-nums}
  .cdf-tbl .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
  .cdf-tag{font-size:11px;font-weight:700;background:#e5e7eb;color:${C.ink};border-radius:3px;padding:2px 6px}
  .cdf-tag.red{background:#fee2e2;color:${C.red}}
  .cdf-mini{border:1px solid ${C.red};background:${C.red};color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:700;cursor:pointer;margin-right:4px}
  .cdf-mini.ghost{background:#fff;color:${C.ink};border-color:${C.line}}
  .cdf-empty{padding:24px;color:${C.ink2};font-size:13px;text-align:center}.cdf-empty.ok{color:${C.green};font-weight:600}
  .cdf-pag{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:10px;font-size:12px;color:${C.ink2}}
  .cdf-ov{position:fixed;inset:0;background:rgba(25,28,29,.28);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
  .cdf-modal{background:#fff;border-radius:8px;padding:20px 24px;width:min(560px,100%);box-shadow:0 16px 48px rgba(0,0,0,.2)}
  .cdf-mhead{display:flex;justify-content:space-between;align-items:center}.cdf-mhead h3{margin:0;font-size:16px;font-weight:700}
  .cdf-sub{font-size:13px;color:${C.ink2};margin:6px 0 10px}.cdf-x{border:0;background:none;cursor:pointer;color:${C.ink2}}
  .cdf-in{border:1px solid ${C.line};border-radius:4px;padding:8px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}
  .cdf-mfoot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .nowrap{white-space:nowrap}
  </style>`;
}
