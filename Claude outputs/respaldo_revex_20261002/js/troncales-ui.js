// ============================================================================
// GESTIÓN TRONCALES — Vista de datos v2 (rediseño 29-sep-2026)
// ----------------------------------------------------------------------------
// Motor genérico para las vistas tipo tabla (Datos SAP + Entregas Creadas):
// cabecera con acciones, tarjetas que filtran, chips, buscadores, tabla con
// franja de color por fila y panel lateral de detalle.
//
// Cada vista de VISTAS_TRONCAL declara un bloque `v2` (ver abastecimiento.js).
// La carga de datos (vista, preload, transform, postFilter, centroCampo),
// las exclusiones del Plan de Carga y el CSV siguen siendo los de siempre:
// este módulo sólo cambia la PRESENTACIÓN.
// ============================================================================

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── Piezas de UI ────────────────────────────────────────────────────────────
export function pill(label, tone = 'mute') {
  if (label == null || label === '') return '';
  return `<span class="sv-pill ${tone}"><i></i>${esc(label)}</span>`;
}
export function mono(v, sub) {
  const main = v == null || v === '' ? '<span class="sv-muted">—</span>' : `<span class="sv-mono">${esc(v)}</span>`;
  return sub ? `${main}<div class="sv-sub" title="${esc(sub)}">${esc(sub)}</div>` : main;
}
export function txt(v, sub, bold = false) {
  const main = v == null || v === '' ? '<span class="sv-muted">—</span>' : `<span class="${bold ? 'sv-b' : ''}">${esc(v)}</span>`;
  return sub ? `${main}<div class="sv-sub" title="${esc(sub)}">${esc(sub)}</div>` : main;
}
export function tonHtml(n) {
  if (n == null || isNaN(n)) return '<span class="sv-muted">—</span>';
  return `${Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
}

// Encabezado del shell: fecha y hora de la última actualización SAP de la vista
export function setUltimaActualizacion(ts) {
  const el = document.getElementById('sv-upd');
  if (!el) return;
  if (!ts) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  let lbl = '';
  try {
    const d = new Date(ts);
    const f = d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' });
    const h = d.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
    lbl = `${f} · ${h}`;
  } catch (_e) { lbl = String(ts).slice(0, 16).replace('T', ' '); }
  el.innerHTML = `<span class="material-symbols-outlined">update</span>Última actualización SAP <strong>${esc(lbl)}</strong>`;
  el.classList.remove('hidden');
}
// Máximo cargado_en de un set de filas crudas (las vistas v_trc_* lo traen por fila)
export function maxCargadoEn(rows) {
  let m = '';
  for (const r of rows || []) { const v = r && r.cargado_en; if (v && String(v) > m) m = String(v); }
  return m || null;
}

// Estado de filtros por vista (se mantiene mientras dure la sesión en la pestaña)
const _estado = new Map();

function isoToDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function hoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

// ── Motor de la vista ───────────────────────────────────────────────────────
// deps: { fetchAllRows, filtrarPorCentro, can, parseDateSAP, clearRawCache,
//         exportarCSV, loadExclusionesPlan, excluirDelPlan, reactivarEnPlan, showAlert }
export async function renderTablaV2(stage, cfg, deps, viewKey) {
  const V = cfg.v2;
  const st = _estado.get(viewKey) || {
    kpi: 'all', chip: 'all', chip2: 'all', q: '', qDoc: '', dFrom: '', dTo: '',
    orig: V.origen ? V.origen.opciones[0][0] : null, mode: 0, drawer: null,
  };
  if (!_estado.has(viewKey) && cfg.dateDefaultHoy) { st.dFrom = st.dTo = hoyISO(); }
  _estado.set(viewKey, st);
  st.drawer = null;

  const active = cfg.modes ? Object.assign({}, cfg, cfg.modes[st.mode] || cfg.modes[0]) : cfg;
  const AV = Object.assign({}, V, (active.v2mode || {}));

  stage.innerHTML = `<div class="sv-view"><div class="sv-vhead"><div><h1 class="sv-h1">${esc(AV.titulo)}</h1>
    <div class="sv-desc">Cargando datos…</div></div></div></div>`;

  const ctx = Object.assign({}, active.preload ? await active.preload() : {}, AV.preload ? await AV.preload() : {});
  const rawRows = await deps.fetchAllRows(active.vista);
  setUltimaActualizacion(maxCargadoEn(rawRows));
  const campoCentro = active.centroCampo || active.chipFilter?.campo;
  let rowsAll = active.transform ? active.transform(rawRows, ctx) : rawRows;
  rowsAll = campoCentro ? deps.filtrarPorCentro(rowsAll, campoCentro) : rowsAll;
  if (active.postFilter) rowsAll = active.postFilter(rowsAll, 'all', ctx);
  if (AV.enrich) AV.enrich(rowsAll, ctx);
  rowsAll.forEach((r, i) => { r.__rid = AV.rowId ? String(AV.rowId(r)) : String(i); });

  // Exclusiones del Plan de Carga (acción del panel lateral, sólo perfiles con permiso)
  const puedeExcluir = !!(active.excluir && deps.can('excluir'));
  let exclusiones = puedeExcluir ? await deps.loadExclusionesPlan() : [];
  function exclusionDe(r) {
    const ex = active.excluir; if (!ex) return null;
    const doc = String(ex.doc(r) ?? '').trim();
    const mat = typeof ex.material === 'function' ? String(ex.material(r) ?? '').trim() : '';
    return exclusiones.find(e => e.tipo === ex.tipo && String(e.doc ?? '').trim() === doc
      && (String(e.material ?? '').trim() === '' || String(e.material ?? '').trim() === mat)) || null;
  }

  const rowId = r => r.__rid;
  const kpisDef = AV.kpis || [];
  const kpiFn = k => (kpisDef.find(x => x.key === k) || {}).fn;

  function base() {
    const qd = st.qDoc.trim(), dF = isoToDate(st.dFrom), dT = isoToDate(st.dTo);
    return rowsAll.filter(r => {
      if (AV.origen && st.orig && String(AV.origen.of(r) ?? '').trim() !== st.orig) return false;
      if (AV.docSearch && qd && !String(AV.docSearch.of(r) ?? '').includes(qd)) return false;
      if (AV.fecha && (dF || dT)) {
        const d = deps.parseDateSAP(AV.fecha.of(r));
        if (!d) return false;
        if (dF && d < dF) return false;
        if (dT && d > dT) return false;
      }
      return true;
    });
  }
  // chip2 (opcional): 2º filtro por chips, p. ej. Centro Destino en Retiros (30-sep-2026).
  function aplicaChip2(pre) {
    return AV.chip2 && st.chip2 !== 'all' ? pre.filter(r => String(AV.chip2.of(r) ?? '') === st.chip2) : pre;
  }
  function aplica(pre0) {
    const pre = aplicaChip2(pre0);
    const byChip = AV.chip && st.chip !== 'all' ? pre.filter(r => String(AV.chip.of(r) ?? '') === st.chip) : pre;
    const q = st.q.trim().toLowerCase();
    const f = kpiFn(st.kpi);
    const filt = byChip.filter(r => (!f || f(r)) && (!q || !AV.search || String(AV.search.of(r) ?? '').toLowerCase().includes(q)));
    return { byChip, filt };
  }

  function headHTML() {
    const seg = AV.origen ? `<div class="sv-seg" role="group" aria-label="Centro de origen">${AV.origen.opciones.map(([v, l]) =>
      `<button data-chip data-orig="${esc(v)}" class="${st.orig === v ? 'is-on' : ''}"><span class="material-symbols-outlined">warehouse</span>${esc(l)}</button>`).join('')}</div>` : '';
    const modes = cfg.modes ? `<div class="sv-seg" role="group" aria-label="Modo">${cfg.modes.map((m, i) =>
      `<button data-chip data-mode="${i}" class="${st.mode === i ? 'is-on' : ''}">${m.icon ? `<span class="material-symbols-outlined">${m.icon}</span>` : ''}${esc(m.v2label || m.label)}</button>`).join('')}</div>` : '';
    return `<div class="sv-vhead">
      <div style="min-width:0"><h1 class="sv-h1">${esc(AV.titulo)}</h1>${AV.desc ? `<div class="sv-desc">${esc(AV.desc)}</div>` : ''}</div>
      <div class="sv-actions">${modes}${seg}
        <button class="sv-btn" data-csv title="Descargar CSV"><span class="material-symbols-outlined">download</span>Descargar</button>
        <button class="sv-btn is-icon" data-refrescar title="Refrescar datos"><span class="material-symbols-outlined">refresh</span></button>
      </div></div>`;
  }

  function draw() {
    const pre = base();
    const { byChip, filt } = aplica(pre);
    const hasFilter = st.kpi !== 'all' || st.chip !== 'all' || st.chip2 !== 'all' || !!st.q.trim() || !!st.qDoc.trim() || !!st.dFrom || !!st.dTo;

    const kpis = kpisDef.length ? `<div class="sv-kpis">${kpisDef.map(k => {
      const n = k.fn ? byChip.filter(k.fn).length : byChip.length;
      const on = st.kpi === k.key;
      const val = k.valor ? k.valor(byChip) : n.toLocaleString('es-CL');
      return `<button class="sv-kpi ${on ? 'is-on' : ''}" data-chip data-kpi="${esc(k.key)}" style="${on ? `box-shadow:inset 0 -3px 0 ${k.color}` : ''}">
        <div class="sv-kpi-l"><i style="background:${k.color}"></i>${esc(k.label)}</div>
        <div class="sv-kpi-v">${esc(val)}</div><div class="sv-kpi-s">${esc(k.sub || '')}</div></button>`;
    }).join('')}</div>` : '';

    let chips = '';
    if (AV.chip2) {
      const vals2 = [...new Set(pre.map(r => String(AV.chip2.of(r) ?? '')).filter(Boolean))].sort((a, b) => (AV.chip2.orden ? AV.chip2.orden(a, b) : a.localeCompare(b)));
      const nm2 = AV.chip2.name || (v => v);
      chips += `<div class="sv-frow"><span class="sv-flbl">${esc(AV.chip2.label)}</span>
        <button class="sv-chip ${st.chip2 === 'all' ? 'is-on' : ''}" data-chip data-chip2v="all">Todos <small>${pre.length}</small></button>
        ${vals2.map(v => `<button class="sv-chip ${st.chip2 === v ? 'is-on' : ''}" data-chip data-chip2v="${esc(v)}">${esc(nm2(v))} <small>${pre.filter(r => String(AV.chip2.of(r) ?? '') === v).length}</small></button>`).join('')}
      </div>`;
    }
    if (AV.chip) {
      const pre2 = aplicaChip2(pre);
      const vals = [...new Set(pre2.map(r => String(AV.chip.of(r) ?? '')).filter(Boolean))].sort((a, b) => (AV.chip.orden ? AV.chip.orden(a, b) : a.localeCompare(b)));
      const nm = AV.chip.name || (v => v);
      chips += `<div class="sv-frow"><span class="sv-flbl">${esc(AV.chip.label)}</span>
        <button class="sv-chip ${st.chip === 'all' ? 'is-on' : ''}" data-chip data-chipv="all">Todos <small>${pre2.length}</small></button>
        ${vals.map(v => `<button class="sv-chip ${st.chip === v ? 'is-on' : ''}" data-chip data-chipv="${esc(v)}">${esc(nm(v))} <small>${pre2.filter(r => String(AV.chip.of(r) ?? '') === v).length}</small></button>`).join('')}
      </div>`;
    }
    const inputs = [];
    if (AV.docSearch) inputs.push(`<label class="sv-inp" title="${esc(AV.docSearch.ph)}"><span class="material-symbols-outlined">tag</span>
      <input class="is-mono" data-qdoc inputmode="numeric" placeholder="${esc(AV.docSearch.ph)}" value="${esc(st.qDoc)}" style="width:190px"/></label>`);
    if (AV.fecha) inputs.push(`<div class="sv-inp" title="${esc(AV.fecha.label)}"><span class="material-symbols-outlined">date_range</span>
      <span class="sv-sep">${esc(AV.fecha.label)}</span>
      <input type="date" data-dfrom value="${esc(st.dFrom)}" aria-label="Desde"/><span class="sv-sep">–</span><input type="date" data-dto value="${esc(st.dTo)}" aria-label="Hasta"/></div>`);
    if (AV.search) inputs.push(`<label class="sv-inp"><span class="material-symbols-outlined">search</span>
      <input data-q placeholder="${esc(AV.search.ph)}" value="${esc(st.q)}" style="width:220px"/></label>`);
    const filtros = (chips || inputs.length) ? `<div class="sv-filters">${chips}
      <div class="sv-frow">${inputs.join('')}${hasFilter ? '<button class="sv-btn-g" data-chip data-clear>Limpiar filtros</button>' : ''}</div></div>` : '';

    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const selId = st.drawer;
    const cols = AV.cols;
    const body = shown.length ? shown.map(r => {
      const id = rowId(r);
      const edge = AV.edge ? AV.edge(r) : null;
      return `<tr data-row="${esc(id)}" class="${selId === id ? 'is-sel' : ''}">${cols.map((c, i) =>
        `<td class="${c.al === 'r' ? 'r' : ''}" ${i === 0 && edge ? `style="box-shadow:inset 3px 0 0 ${edge}"` : ''}>${c.html(r)}</td>`).join('')}</tr>`;
    }).join('') : `<tr class="sv-empty"><td colspan="${cols.length}">${hasFilter ? 'Ningún registro coincide con los filtros.' : 'Sin datos.'}</td></tr>`;
    const nota = typeof AV.note === 'function' ? AV.note(filt) : (AV.note || '');

    stage.innerHTML = `<div class="sv-view">
      ${headHTML()}
      ${kpis}
      ${filtros}
      <div class="sv-card">
        <div class="sv-tablewrap"><table class="sv-table" style="min-width:${AV.minW || '900px'}">
          <thead><tr>${cols.map(c => `<th class="${c.al === 'r' ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody></table></div>
        <div class="sv-tfoot"><span>${filt.length.toLocaleString('es-CL')} de ${rowsAll.filter(r => !AV.origen || String(AV.origen.of(r) ?? '').trim() === st.orig).length.toLocaleString('es-CL')} registros${filt.length > MAX ? ` · mostrando ${MAX}, usa los filtros para acotar` : ''}</span><span>${esc(nota)}</span></div>
      </div>
      <div data-drawer-slot></div>
    </div>`;
    wire(filt);
    if (st.drawer) openDrawer(st.drawer);
  }

  function refocus(sel) {
    const el = stage.querySelector(sel);
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_e) { /* date */ } }
  }

  function wire(filt) {
    stage.querySelectorAll('[data-kpi]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.kpi; st.kpi = (st.kpi === k && k !== 'all') ? 'all' : k; draw();
    }));
    stage.querySelectorAll('[data-chipv]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.chipv; st.chip = (st.chip === v && v !== 'all') ? 'all' : v; draw();
    }));
    stage.querySelectorAll('[data-chip2v]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.chip2v; st.chip2 = (st.chip2 === v && v !== 'all') ? 'all' : v; draw();
    }));
    stage.querySelectorAll('[data-orig]').forEach(b => b.addEventListener('click', () => { st.orig = b.dataset.orig; st.chip = 'all'; st.chip2 = 'all'; draw(); }));
    stage.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      const m = +b.dataset.mode; if (m === st.mode) return;
      st.mode = m; st.kpi = 'all'; st.chip = 'all'; st.chip2 = 'all'; renderTablaV2(stage, cfg, deps, viewKey);
    }));
    stage.querySelector('[data-clear]')?.addEventListener('click', () => {
      Object.assign(st, { kpi: 'all', chip: 'all', chip2: 'all', q: '', qDoc: '', dFrom: '', dTo: '' }); draw();
    });
    stage.querySelector('[data-q]')?.addEventListener('input', e => { st.q = e.target.value; draw(); refocus('[data-q]'); });
    stage.querySelector('[data-qdoc]')?.addEventListener('input', e => {
      st.qDoc = e.target.value.replace(/\D/g, ''); draw(); refocus('[data-qdoc]');
    });
    stage.querySelector('[data-dfrom]')?.addEventListener('change', e => { st.dFrom = e.target.value; draw(); });
    stage.querySelector('[data-dto]')?.addEventListener('change', e => { st.dTo = e.target.value; draw(); });
    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => { deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); });
    stage.querySelector('[data-csv]')?.addEventListener('click', () => deps.exportarCSV(active, filt));
    stage.querySelectorAll('tbody tr[data-row]').forEach(tr => tr.addEventListener('click', () => {
      st.drawer = tr.dataset.row;
      stage.querySelectorAll('tbody tr.is-sel').forEach(x => x.classList.remove('is-sel'));
      tr.classList.add('is-sel');
      openDrawer(st.drawer);
    }));
  }

  // ── Panel lateral ─────────────────────────────────────────────────────────
  function closeDrawer() {
    st.drawer = null;
    const slot = stage.querySelector('[data-drawer-slot]');
    if (slot) slot.innerHTML = '';
    stage.querySelectorAll('tbody tr.is-sel').forEach(x => x.classList.remove('is-sel'));
    document.removeEventListener('keydown', escKey);
  }
  function escKey(e) { if (e.key === 'Escape' && !document.querySelector('.sv-pal-bg, #coord-modal-bg, #excl-modal-bg')) closeDrawer(); }

  function openDrawer(id) {
    const r = rowsAll.find(x => rowId(x) === id);
    const slot = stage.querySelector('[data-drawer-slot]');
    if (!r || !slot || !AV.detalle) return;
    const d = AV.detalle(r, ctx) || {};
    const kv = (d.kv || []).filter(Boolean).map(([k, v, raw]) =>
      `<div><dt>${esc(k)}</dt><dd>${raw ? (v ?? '—') : (v == null || v === '' ? '—' : esc(v))}</dd></div>`).join('');
    const tabla = d.tabla && d.tabla.rows && d.tabla.rows.length ? `<div>
      <div class="sv-dr-sect">${esc(d.tabla.titulo || 'Detalle')}</div>
      <div class="sv-card" style="overflow:auto"><table class="sv-table">
        <thead><tr>${d.tabla.head.map(([l, al]) => `<th class="${al === 'r' ? 'r' : ''}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${d.tabla.rows.map(row => `<tr>${row.map((c, i) => `<td class="${d.tabla.head[i] && d.tabla.head[i][1] === 'r' ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>` : '';

    // Acciones: propias de la vista + excluir/reactivar del Plan de Carga
    const acciones = (d.acciones || []).slice();
    if (puedeExcluir) {
      const ex = exclusionDe(r);
      acciones.push(ex
        ? { id: 'reactivar', label: 'Reactivar en el plan', icon: 'visibility', primary: false }
        : { id: 'excluir', label: active.excluir.material ? 'Excluir línea del plan' : 'Excluir del plan', icon: 'visibility_off', primary: !(d.acciones || []).some(a => a.primary) });
    }
    const btns = acciones.map((a, i) => `<button data-acc="${i}" class="${a.primary ? 'sv-btn-p' : 'sv-btn'}">${a.icon ? `<span class="material-symbols-outlined">${a.icon}</span>` : ''}${esc(a.label)}</button>`).join('');

    slot.innerHTML = `<div class="sv-dr-bg" data-close></div>
      <aside class="sv-dr" role="dialog" aria-label="${esc(d.kind || 'Detalle')}">
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${esc(d.kind || '')}</div>
          <div class="sv-dr-t">${esc(d.title || id)}</div>
          ${d.sub ? `<div class="sv-dr-s">${esc(d.sub)}</div>` : ''}</div>
          <button class="sv-iconbtn" data-close title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b">
          ${d.aviso ? `<div class="sv-note-box">${d.aviso}</div>` : ''}
          ${kv ? `<dl class="sv-kv" style="margin:0">${kv}</dl>` : ''}
          ${tabla}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">${esc(d.nota || '')}</span><div style="display:flex;gap:8px;flex-wrap:wrap">${btns}</div></div>
      </aside>`;
    slot.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
    document.removeEventListener('keydown', escKey);
    document.addEventListener('keydown', escKey);
    slot.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', async () => {
      const a = acciones[+b.dataset.acc];
      if (a.id === 'excluir') {
        const ex = active.excluir;
        const doc = ex.doc(r), mat = typeof ex.material === 'function' ? ex.material(r) : null;
        const etiqueta = mat ? `el material ${mat} del documento ${doc}` : `el documento ${doc} completo`;
        if (!confirm(`¿Excluir del Plan de Carga ${etiqueta}?\n\nLa exclusión vale sólo para el plan de hoy.`)) return;
        if (await deps.excluirDelPlan(ex.tipo, doc, mat || null, 'Excluido desde ' + AV.titulo)) {
          deps.showAlert('Excluido del Plan de Carga', 'success');
          exclusiones = await deps.loadExclusionesPlan();
          if (AV.onPlanChange) { await AV.onPlanChange(rowsAll, ctx); st.drawer = id; draw(); } else openDrawer(id);
        }
      } else if (a.id === 'reactivar') {
        const ex = exclusionDe(r);
        if (ex && await deps.reactivarEnPlan(Number(ex.id))) {
          deps.showAlert('Reactivado en el Plan de Carga', 'success');
          exclusiones = await deps.loadExclusionesPlan();
          if (AV.onPlanChange) { await AV.onPlanChange(rowsAll, ctx); st.drawer = id; draw(); } else openDrawer(id);
        }
      } else if (a.run) {
        const res = await a.run(r, ctx);
        if (res && res.recargar) { deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey).then(() => { st.drawer = id; openDrawer(id); }); }
        else if (res && res.redibujar) { draw(); st.drawer = id; openDrawer(id); }
      }
    }));
  }

  draw();
}

// ── Gráfico «camión que se llena» ───────────────────────────────────────────
// segs: [{ ton, color, label }] en orden de llenado; cap: capacidad (t).
// El relleno ocupa el % de la capacidad (tope 100 %); si la carga supera la
// capacidad se dibuja un 2º camión punteado verde con el excedente.
// opts: { w, h, color } — color único (DT / indicadores) cuando no hay segs.
export function truckGauge(segs, cap, opts = {}) {
  const w = opts.w || 150, h = opts.h || 30;
  const total = segs.reduce((s, x) => s + (x.ton || 0), 0);
  let restante = cap;
  const partes = segs.filter(s => s.ton > 0).map(s => {
    const t = Math.max(0, Math.min(s.ton, restante));
    restante -= t;
    return t > 0 ? `<i title="${esc(s.label || '')}: ${Number(s.ton).toLocaleString('es-CL', { maximumFractionDigits: 1 })} t" style="width:${cap > 0 ? (t / cap * 100) : 0}%;background:${s.color}"></i>` : '';
  }).join('');
  const excede = Math.max(0, total - cap);
  const segundo = excede > 0 ? `<div class="sv-trk2" title="2º camión: ${excede.toLocaleString('es-CL', { maximumFractionDigits: 1 })} t">
      <span>2º camión</span><div class="sv-trk2-box" style="width:${Math.round(w * 0.46)}px;height:${Math.round(h * 0.7)}px"><i style="width:${Math.min(100, excede / cap * 100)}%"></i></div></div>` : '';
  return `<div class="sv-trk-wrap"><div class="sv-trk" style="--tw:${w}px;--th:${h}px">
      <div class="sv-trk-box"><div class="sv-trk-fill">${partes}</div></div><div class="sv-trk-cab"></div>
      <span class="sv-trk-wh" style="left:10px"></span><span class="sv-trk-wh" style="left:${w - 22}px"></span><span class="sv-trk-wh" style="left:${w + 14}px"></span>
    </div>${segundo}</div>`;
}
// Color por umbral de consolidación (DT / indicadores): ≥80 verde, 70–80 amarillo, <70 gris
export function colorUmbral(pct) { return pct >= 80 ? '#15803d' : pct >= 70 ? '#ca8a04' : '#9ca3af'; }
