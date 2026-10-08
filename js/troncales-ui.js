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
import { confirmar } from './confirmar.js?v=202610082027';
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
  st.open = null;
  if (stage._fClose) { document.removeEventListener('click', stage._fClose); document.removeEventListener('keydown', stage._fClose); }
  stage._fClose = e => {
    if (!st.open || !stage.isConnected) return;
    if (e.type === 'keydown' ? e.key !== 'Escape' : (e.target.closest && e.target.closest('.sv-fdd'))) return;
    if (e.type === 'keydown') e.stopPropagation();
    st.open = null; stage._fRedraw && stage._fRedraw();
  };
  document.addEventListener('click', stage._fClose);
  document.addEventListener('keydown', stage._fClose);
  // Tras una acción con { recargar } se reabre el detalle de la misma fila con datos frescos.
  st.drawer = st._reopen || null; st._reopen = null;

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
  const puedeExcluir = !!(active.excluir && deps.can(AV.permisoExcluir || 'excluir'));
  // excluirEnFila (2-oct-2026): estado + botón Excluir/Reactivar en la fila principal
  // (columna «Plan de carga») en vez del panel lateral de detalle.
  const enFila = !!(active.excluir && AV.excluirEnFila);
  let exclusiones = (puedeExcluir || enFila) ? await deps.loadExclusionesPlan() : [];
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
  // chips (opcional, 3-oct-2026): filtros extra por chips, p. ej. Tipo de pedido y Saldo en Retiros.
  st.ex = st.ex || {};
  const exOn = () => (AV.chips || []).some(c => st.ex[c.key] && st.ex[c.key] !== 'all');
  function aplicaExtras(pre) {
    return (AV.chips || []).reduce((acc, c) => (st.ex[c.key] && st.ex[c.key] !== 'all') ? acc.filter(r => String(c.of(r) ?? '') === st.ex[c.key]) : acc, pre);
  }
  function aplicaChip2(pre0) {
    const pre = aplicaExtras(pre0);
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

  // (7-oct-2026) Botones extra del encabezado por vista/modo: AV.headBtns = [{ label, icon, perm, run }]; run() → true recarga.
  const headBtns = () => (AV.headBtns || []).filter(b => !b.perm || deps.can(b.perm));
  function headHTML() {
    const seg = AV.origen ? `<div class="sv-seg" role="group" aria-label="Centro de origen">${AV.origen.opciones.map(([v, l]) =>
      `<button data-chip data-orig="${esc(v)}" class="${st.orig === v ? 'is-on' : ''}"><span class="material-symbols-outlined">warehouse</span>${esc(l)}</button>`).join('')}</div>` : '';
    const modes = cfg.modes ? `<div class="sv-seg" role="group" aria-label="Modo">${cfg.modes.map((m, i) =>
      `<button data-chip data-mode="${i}" class="${st.mode === i ? 'is-on' : ''}">${m.icon ? `<span class="material-symbols-outlined">${m.icon}</span>` : ''}${esc(m.v2label || m.label)}</button>`).join('')}</div>` : '';
    return `<div class="sv-vhead">
      <div style="min-width:0"><h1 class="sv-h1">${esc(AV.titulo)}</h1>${AV.desc ? `<div class="sv-desc">${esc(AV.desc)}</div>` : ''}</div>
      <div class="sv-actions">${modes}${seg}
        ${headBtns().map((b, i) => `<button class="sv-btn" data-hbtn="${i}" title="${esc(b.label)}"><span class="material-symbols-outlined">${esc(b.icon || 'bolt')}</span>${esc(b.label)}</button>`).join('')}
        <button class="sv-btn" data-csv title="Descargar CSV"><span class="material-symbols-outlined">download</span>Descargar</button>
        <button class="sv-btn is-icon" data-refrescar title="Refrescar datos"><span class="material-symbols-outlined">refresh</span></button>
      </div></div>`;
  }

  stage._fRedraw = () => draw();
  function draw() {
    const pre = base();
    const { byChip, filt } = aplica(pre);
    const hasFilter = exOn() || st.kpi !== 'all' || st.chip !== 'all' || st.chip2 !== 'all' || !!st.q.trim() || !!st.qDoc.trim() || !!st.dFrom || !!st.dTo;

    const kpis = kpisDef.length ? `<div class="sv-kpis">${kpisDef.map(k => {
      const n = k.fn ? byChip.filter(k.fn).length : byChip.length;
      const on = st.kpi === k.key;
      const val = k.valor ? k.valor(byChip) : n.toLocaleString('es-CL');
      return `<button class="sv-kpi ${on ? 'is-on' : ''}" data-chip data-kpi="${esc(k.key)}" style="${on ? `box-shadow:inset 0 -3px 0 ${k.color}` : ''}">
        <div class="sv-kpi-l"><i style="background:${k.color}"></i>${esc(k.label)}</div>
        <div class="sv-kpi-v">${esc(val)}</div><div class="sv-kpi-s">${esc(k.sub || '')}</div></button>`;
    }).join('')}</div>` : '';

    // (4-oct-2026) Filtros por chips como menús desplegables en una sola barra (antes una fila
    // de botones por grupo, que colapsaba la vista cuando había muchos destinos).
    const grupos = [];
    const mkGrupo = (id, def, base0, cur) => {
      const nm = def.name || (v => v);
      const vals = [...new Set(base0.map(r => String(def.of(r) ?? '')).filter(Boolean))].sort((a, b) => (def.orden ? def.orden(a, b) : a.localeCompare(b)));
      grupos.push({ id, label: def.label, cur, total: base0.length,
        opts: vals.map(v => ({ v, name: nm(v), n: base0.filter(r => String(def.of(r) ?? '') === v).length })) });
    };
    const preX = aplicaExtras(pre);
    if (AV.chip2) mkGrupo('chip2', AV.chip2, preX, st.chip2);
    if (AV.chip) mkGrupo('chip', AV.chip, aplicaChip2(pre), st.chip);
    (AV.chips || []).forEach(c => mkGrupo('ex:' + c.key, c, pre, st.ex[c.key] || 'all'));
    const ddHtml = g => {
      const on = g.cur !== 'all';
      const curName = on ? ((g.opts.find(o => o.v === g.cur) || {}).name || g.cur) : 'Todos';
      const pop = st.open === g.id ? `<div class="sv-fpop" role="listbox">
          ${g.opts.length > 8 ? `<label class="sv-inp sv-fpop-q"><span class="material-symbols-outlined">search</span><input data-fq placeholder="Buscar ${esc(g.label.toLowerCase())}"></label>` : ''}
          <button class="sv-fopt ${!on ? 'is-on' : ''}" data-fset="${esc(g.id)}" data-fv="all"><span>Todos</span><small>${g.total}</small></button>
          ${g.opts.map(o => `<button class="sv-fopt ${g.cur === o.v ? 'is-on' : ''}" data-fset="${esc(g.id)}" data-fv="${esc(o.v)}" data-fname="${esc((String(o.name) + ' ' + o.v).toLowerCase())}"><span>${esc(o.name)}</span><small>${o.n}</small></button>`).join('')}
        </div>` : '';
      return `<div class="sv-fdd ${on ? 'is-on' : ''} ${st.open === g.id ? 'is-open' : ''}">
        <button class="sv-fdd-b" data-fopen="${esc(g.id)}" aria-expanded="${st.open === g.id}"><span class="sv-fdd-l">${esc(g.label)}</span><span class="sv-fdd-v" title="${esc(curName)}">${esc(curName)}</span><span class="material-symbols-outlined">expand_more</span></button>
        ${on ? `<button class="sv-fdd-x" data-fset="${esc(g.id)}" data-fv="all" title="Quitar filtro"><span class="material-symbols-outlined">close</span></button>` : ''}
        ${pop}</div>`;
    };
    const chips = grupos.map(ddHtml).join('');
    const inputs = [];
    if (AV.docSearch) inputs.push(`<label class="sv-inp" title="${esc(AV.docSearch.ph)}"><span class="material-symbols-outlined">tag</span>
      <input class="is-mono" data-qdoc inputmode="numeric" placeholder="${esc(AV.docSearch.ph)}" value="${esc(st.qDoc)}" style="width:190px"/></label>`);
    if (AV.fecha) inputs.push(`<div class="sv-inp" title="${esc(AV.fecha.label)}"><span class="material-symbols-outlined">date_range</span>
      <span class="sv-sep">${esc(AV.fecha.label)}</span>
      <input type="date" data-dfrom value="${esc(st.dFrom)}" aria-label="Desde"/><span class="sv-sep">–</span><input type="date" data-dto value="${esc(st.dTo)}" aria-label="Hasta"/></div>`);
    if (AV.search) inputs.push(`<label class="sv-inp"><span class="material-symbols-outlined">search</span>
      <input data-q placeholder="${esc(AV.search.ph)}" value="${esc(st.q)}" style="width:220px"/></label>`);
    const filtros = (chips || inputs.length) ? `<div class="sv-filters"><div class="sv-ftool">${chips}${inputs.join('')}${hasFilter ? '<button class="sv-btn-g" data-chip data-clear>Limpiar filtros</button>' : ''}</div></div>` : '';

    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const selId = st.drawer;
    let cols = enFila ? AV.cols.concat([{ label: 'Plan de carga', html: r => celdaPlan(r) }]) : AV.cols;
    // (8-oct-2026) Acciones en la fila principal (AV.filaAcciones(r) → [{ label, icon, run, tono }])
    if (AV.filaAcciones) cols = cols.concat([{ label: 'Acciones', html: r => {
      const acc = AV.filaAcciones(r) || [];
      return acc.length ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${acc.map((a, i) =>
        `<button class="sv-btn" data-facc="${esc(r.__rid)}" data-facc-i="${i}" title="${esc(a.title || a.label)}" style="padding:2px 8px;font-size:11px;white-space:nowrap${a.tono === 'peligro' ? ';color:#b91c1c' : ''}">${a.icon ? `<span class="material-symbols-outlined">${a.icon}</span>` : ''}${esc(a.label)}</button>`).join('')}</div>` : '';
    } }]);
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

  function celdaPlan(r) {
    const ex = exclusionDe(r);
    const pill = AV.planEstado ? AV.planEstado(r, !!ex)
      : (ex ? '<span class="sv-pill bad"><i></i>Excluida hoy</span>' : '<span class="sv-pill ok"><i></i>En plan</span>');
    if (!puedeExcluir) return pill;
    const btn = ex
      ? `<button class="sv-btn" data-fila-reac="${esc(r.__rid)}" title="Reactivar en el Plan de Carga" style="padding:2px 8px;font-size:11px"><span class="material-symbols-outlined">visibility</span>Reactivar</button>`
      : `<button class="sv-btn" data-fila-excl="${esc(r.__rid)}" title="Excluir del Plan de Carga" style="padding:2px 8px;font-size:11px;color:#b91c1c"><span class="material-symbols-outlined">visibility_off</span>Excluir</button>`;
    return `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">${pill}${btn}</div>`;
  }
  async function excluirFila(r) {
    const ex = active.excluir;
    const doc = ex.doc(r), mat = typeof ex.material === 'function' ? ex.material(r) : null;
    const etiqueta = mat ? `el material ${mat} del documento ${doc}` : `el documento ${doc} completo`;
    if (!await confirmar(`¿Excluir del Plan de Carga ${etiqueta}?\n\nLa exclusión vale sólo para el plan de hoy.`)) return false;
    if (!(await deps.excluirDelPlan(ex.tipo, doc, mat || null, 'Excluido desde ' + AV.titulo))) return false;
    deps.showAlert('Excluido del Plan de Carga', 'success');
    return true;
  }
  async function reactivarFila(r) {
    const ex = exclusionDe(r);
    if (!ex || !(await deps.reactivarEnPlan(Number(ex.id)))) return false;
    deps.showAlert('Reactivado en el Plan de Carga', 'success');
    return true;
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
    stage.querySelectorAll('[data-fopen]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); st.open = st.open === b.dataset.fopen ? null : b.dataset.fopen; draw();
      stage.querySelector('[data-fq]')?.focus();
    }));
    stage.querySelectorAll('[data-fset]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.fset, v = b.dataset.fv;
      if (id === 'chip') st.chip = v; else if (id === 'chip2') st.chip2 = v; else st.ex[id.slice(3)] = v;
      st.open = null; draw();
    }));
    stage.querySelector('[data-fq]')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      stage.querySelectorAll('.sv-fpop [data-fname]').forEach(o => { o.style.display = !q || o.dataset.fname.includes(q) ? '' : 'none'; });
    });
    stage.querySelectorAll('[data-exk]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.exk, v = b.dataset.exv; st.ex[k] = (st.ex[k] === v && v !== 'all') ? 'all' : v; draw();
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
      Object.assign(st, { kpi: 'all', chip: 'all', chip2: 'all', q: '', qDoc: '', dFrom: '', dTo: '', ex: {}, open: null }); draw();
    });
    stage.querySelector('[data-q]')?.addEventListener('input', e => { st.q = e.target.value; draw(); refocus('[data-q]'); });
    stage.querySelector('[data-qdoc]')?.addEventListener('input', e => {
      st.qDoc = e.target.value.replace(/\D/g, ''); draw(); refocus('[data-qdoc]');
    });
    stage.querySelector('[data-dfrom]')?.addEventListener('change', e => { st.dFrom = e.target.value; draw(); });
    stage.querySelector('[data-dto]')?.addEventListener('change', e => { st.dTo = e.target.value; draw(); });
    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => { deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); });
    stage.querySelectorAll('[data-hbtn]').forEach(b => b.addEventListener('click', async () => {
      const hb = headBtns()[+b.dataset.hbtn]; if (!hb) return;
      b.disabled = true;
      try { if (await hb.run()) { deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); return; } } finally { b.disabled = false; }
    }));
    stage.querySelector('[data-csv]')?.addEventListener('click', () => deps.exportarCSV(active, filt));
    const accFila = (sel, fn) => stage.querySelectorAll(sel).forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const r = rowsAll.find(x => rowId(x) === (b.dataset.filaExcl || b.dataset.filaReac));
      if (!r || !(await fn(r))) return;
      exclusiones = await deps.loadExclusionesPlan();
      if (AV.onPlanChange) await AV.onPlanChange(rowsAll, ctx);
      draw();
    }));
    stage.querySelectorAll('[data-facc]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const r = rowsAll.find(x => rowId(x) === b.dataset.facc); if (!r) return;
      const a = (AV.filaAcciones(r) || [])[+b.dataset.faccI]; if (!a || !a.run) return;
      b.disabled = true;
      try {
        const res = await a.run(r, ctx);
        if (res && res.recargar) { deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); return; }
        if (res && res.redibujar) draw();
      } finally { b.disabled = false; }
    }));
    accFila('[data-fila-excl]', excluirFila);
    accFila('[data-fila-reac]', reactivarFila);
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
    // d.tablas (5-oct-2026): varias tablas en el detalle (p. ej. un camión por tabla); d.tabla sigue funcionando.
    const tablaHtml = tb => tb && tb.rows && tb.rows.length ? `<div>
      <div class="sv-dr-sect">${esc(tb.titulo || 'Detalle')}</div>
      ${tb.sub ? `<div class="sv-sub" style="margin:-4px 0 6px;max-width:none">${esc(tb.sub)}</div>` : ''}
      <div class="sv-card" style="overflow:auto"><table class="sv-table">
        <thead><tr>${tb.head.map(([l, al]) => `<th class="${al === 'r' ? 'r' : ''}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${tb.rows.map(row => `<tr>${row.map((c, i) => `<td class="${tb.head[i] && tb.head[i][1] === 'r' ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>` : '';
    const tabla = (d.tablas || (d.tabla ? [d.tabla] : [])).map(tablaHtml).join('');

    // Acciones: propias de la vista + excluir/reactivar del Plan de Carga
    const acciones = (d.acciones || []).slice();
    if (puedeExcluir && !enFila) {
      const ex = exclusionDe(r);
      acciones.push(ex
        ? { id: 'reactivar', label: 'Reactivar en el plan', icon: 'visibility', primary: false }
        : { id: 'excluir', label: active.excluir.material ? 'Excluir línea del plan' : 'Excluir del plan', icon: 'visibility_off', primary: !(d.acciones || []).some(a => a.primary) });
    }
    const btns = acciones.map((a, i) => `<button data-acc="${i}" class="${a.primary ? 'sv-btn-p' : 'sv-btn'}">${a.icon ? `<span class="material-symbols-outlined">${a.icon}</span>` : ''}${esc(a.label)}</button>`).join('');

    slot.innerHTML = `<div class="sv-dr-bg" data-close></div>
      <aside class="sv-dr" role="dialog" aria-label="${esc(d.kind || 'Detalle')}"${AV.drawerW ? ` style="width:${AV.drawerW}"` : ''}>
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
        if (!await confirmar(`¿Excluir del Plan de Carga ${etiqueta}?\n\nLa exclusión vale sólo para el plan de hoy.`)) return;
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
        if (res && res.recargar) { closeDrawer(); st._reopen = id; deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); }
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
