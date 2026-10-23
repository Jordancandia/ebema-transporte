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
import { confirmar } from './confirmar.js?v=202610231457';
import { comentariosHabilitados, conteosComentarios, celdaComentarios, montarHilo, tomarFoco, abrirHiloSuelto } from './comentarios.js?v=202610231457';
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
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_SEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function fechaLarga(f) {
  const [y, m, d] = String(f || '').split('-').map(Number);
  if (!y) return '';
  const dt = new Date(y, m - 1, d);
  return `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dt.getDay()]} ${d} de ${MESES[m - 1]}${y !== new Date().getFullYear() ? ' de ' + y : ''}`;
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
  // (11-oct-2026) Vista calendario opcional (AV.calendario): se elige entre Calendario y Lista.
  if (!st.vista) st.vista = V.calendario ? 'cal' : 'lista';
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
  const rawRows = (await deps.fetchAllRows(active.vista)).slice();
  setUltimaActualizacion(maxCargadoEn(rawRows));
  // (9-oct-2026) Hook para reponer filas respaldadas (p. ej. NV coordinadas que SAP sacó del SQVI).
  if (deps.augmentRaw) await deps.augmentRaw(active.vista, rawRows);
  const campoCentro = active.centroCampo || active.chipFilter?.campo;
  let rowsAll = active.transform ? active.transform(rawRows, ctx) : rawRows;
  rowsAll = campoCentro ? deps.filtrarPorCentro(rowsAll, campoCentro) : rowsAll;
  if (active.postFilter) rowsAll = active.postFilter(rowsAll, 'all', ctx);
  if (AV.enrich) AV.enrich(rowsAll, ctx);
  rowsAll.forEach((r, i) => { r.__rid = AV.rowId ? String(AV.rowId(r)) : String(i); });

  // (12-oct-2026) Comentarios por fila en Orden de Carga: clave estable (rowId o documento|material)
  const conComent = comentariosHabilitados(viewKey);
  const claveCom = r => AV.rowId ? String(AV.rowId(r))
    : active.excluir ? [active.excluir.doc(r), typeof active.excluir.material === 'function' ? active.excluir.material(r) : ''].map(x => String(x ?? '').trim()).join('|')
    : r.__rid;
  const docCom = r => {
    if (!active.excluir) return claveCom(r);
    const d = String(active.excluir.doc(r) ?? '').trim();
    const m = typeof active.excluir.material === 'function' ? String(active.excluir.material(r) ?? '').trim() : '';
    return m ? `${d} · mat. ${m}` : d;
  };
  let conteos = conComent ? await conteosComentarios(viewKey) : new Map();
  const foco = conComent ? tomarFoco(viewKey) : null;
  const focoPrio = foco && foco.prio ? foco : null;   // (15-oct-2026) se resuelve más abajo, tras cargar prioridades
  if (foco && !foco.prio) {
    const fr = rowsAll.find(r => claveCom(r) === foco.clave);
    if (fr) { st.drawer = fr.__rid; st._focoCom = foco.comentarioId || true; }
    else setTimeout(() => abrirHiloSuelto(foco), 0);
  }

  // Exclusiones del Plan de Carga (acción del panel lateral, sólo perfiles con permiso)
  // (12-oct-2026) active.sinExcluir: el modo muestra el estado del plan pero sin botón Excluir (p. ej. Pendientes de traslados).
  const puedeExcluir = !!(active.excluir && !active.sinExcluir && deps.can(AV.permisoExcluir || 'excluir'));
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

  // (15-oct-2026, Jordan) PRIORIDAD de carga: check por pedido/OC (AV.prioridad = { tipo, doc, centro }).
  // La marca el Jefe de Operaciones de la sucursal (acción marcar_prioridad, sólo sus centros) y alerta en el Plan de Carga.
  const prioCfg = AV.prioridad && deps.loadPrioridades ? AV.prioridad : null;
  let prios = prioCfg ? await deps.loadPrioridades(prioCfg.tipo) : new Map();
  const prioDoc = r => String(prioCfg.doc(r) ?? '').trim();
  const prioDe = r => prios.get(`${prioCfg.tipo}|${prioDoc(r)}`) || null;
  const puedePrio = r => deps.can('marcar_prioridad') && (!deps.enAlcance || !prioCfg.centro || deps.enAlcance(String(prioCfg.centro(r) ?? '').trim()));
  // (15-oct-2026, Jordan) Aprobación: la marca de Operaciones queda POR APROBAR hasta que un Planner de
  // Abastecimiento (acción evaluar_prioridad) la acepta → PRIORIDAD; si la rechaza se desactiva.
  const puedeEval = () => deps.can('evaluar_prioridad') && !!deps.evaluarPrioridad;
  function celdaPrio(r) {
    const p = prioDe(r), ed = puedePrio(r) && prioDoc(r);
    const pend = !!p && p.estado === 'PENDIENTE';
    const tit = p ? `Marcada por ${esc(p.marcado_por || '')}${p.motivo ? ' · ' + esc(p.motivo) : ''}${pend ? ' · pendiente de aprobación de Abastecimiento' : (p.evaluado_por ? ' · aceptada por ' + esc(p.evaluado_por) : '')}` : '';
    const pill = !p ? '' : pend
      ? `<span class="sv-pill warn" title="${tit}"><i></i>POR APROBAR</span>`
      : `<span class="sv-pill bad" title="${tit}"><i></i>PRIORIDAD</span>`;
    const rid = esc(r.__rid);
    const ev = pend && puedeEval() ? `<span style="display:inline-flex;gap:4px;margin-left:6px;white-space:nowrap">
      <button class="sv-btn" data-prio-ok="${rid}" title="Aceptar: pasa a ser prioridad de carga" style="padding:2px 8px;font-size:11px;color:#15803d"><span class="material-symbols-outlined">check_circle</span>Aceptar</button>
      <button class="sv-btn" data-prio-no="${rid}" title="Rechazar la priorización" style="padding:2px 8px;font-size:11px;color:#b91c1c"><span class="material-symbols-outlined">block</span>Rechazar</button></span>` : '';
    if (!ed) return (pill + ev) || '<span class="sv-muted">—</span>';
    return `<span style="display:inline-flex;align-items:center;white-space:nowrap"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap" title="${p ? 'Quitar prioridad de carga' : (puedeEval() ? 'Marcar prioridad de carga' : 'Solicitar prioridad de carga (la aprueba Abastecimiento)')}">
      <input type="checkbox" data-prio="${rid}" ${p ? 'checked' : ''} style="width:16px;height:16px;accent-color:#b5000b;cursor:pointer">${pill}</label>${ev}</span>`;
  }
  if (focoPrio) {
    // (15-oct-2026) Notificación de PRIORIDAD de carga: filtra la vista por el documento y abre su fila.
    const d = String(focoPrio.documento ?? '').trim();
    const fr = prioCfg && d ? rowsAll.find(r => prioDoc(r) === d) : null;
    if (fr && AV.docSearch && String(AV.docSearch.of(fr) ?? '').includes(d)) st.qDoc = d;
    else if (fr && AV.search && String(AV.search.of(fr) ?? '').includes(d)) st.q = d;
    if (fr) st.drawer = fr.__rid;
    else setTimeout(() => deps.showAlert(`El documento ${d} no aparece en esta vista con los datos actuales (revisa Entregas / Pendientes).`, 'warning'), 0);
  }
  const rowId = r => r.__rid;
  const esCal = () => !!(AV.calendario && st.vista === 'cal');
  const kpisDef = AV.kpis || [];
  const kpiFn = k => (kpisDef.find(x => x.key === k) || {}).fn;

  function base() {
    const qd = st.qDoc.trim(), dF = isoToDate(st.dFrom), dT = isoToDate(st.dTo);
    return rowsAll.filter(r => {
      if (AV.origen && st.orig && st.orig !== '*' && String(AV.origen.of(r) ?? '').trim() !== st.orig) return false;
      if (AV.docSearch && qd && !String(AV.docSearch.of(r) ?? '').includes(qd)) return false;
      if (AV.fecha && (dF || dT) && !esCal()) {
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
      <div class="sv-actions">${AV.calendario ? `<div class="sv-seg" role="group" aria-label="Vista">
        <button data-chip data-vista="cal" class="${esCal() ? 'is-on' : ''}"><span class="material-symbols-outlined">calendar_month</span>Calendario</button>
        <button data-chip data-vista="lista" class="${!esCal() ? 'is-on' : ''}"><span class="material-symbols-outlined">view_list</span>Lista</button></div>` : ''}${modes}${seg}
        ${headBtns().map((b, i) => `<button class="sv-btn" data-hbtn="${i}" title="${esc(b.label)}"><span class="material-symbols-outlined">${esc(b.icon || 'bolt')}</span>${esc(b.label)}</button>`).join('')}
        <button class="sv-btn" data-csv title="Descargar CSV"><span class="material-symbols-outlined">download</span>Descargar</button>
        <button class="sv-btn is-icon" data-refrescar title="Refrescar datos"><span class="material-symbols-outlined">refresh</span></button>
      </div></div>`;
  }

  stage._fRedraw = () => draw();
  function draw() {
    const pre = base();
    const { byChip, filt } = aplica(pre);
    const hasFilter = exOn() || st.kpi !== 'all' || st.chip !== 'all' || st.chip2 !== 'all' || !!st.q.trim() || !!st.qDoc.trim() || ((!!st.dFrom || !!st.dTo) && !esCal());

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
    if (AV.fecha && !esCal()) inputs.push(`<div class="sv-inp" title="${esc(AV.fecha.label)}"><span class="material-symbols-outlined">date_range</span>
      <span class="sv-sep">${esc(AV.fecha.label)}</span>
      <input type="date" data-dfrom value="${esc(st.dFrom)}" aria-label="Desde"/><span class="sv-sep">–</span><input type="date" data-dto value="${esc(st.dTo)}" aria-label="Hasta"/></div>`);
    if (AV.search) inputs.push(`<label class="sv-inp"><span class="material-symbols-outlined">search</span>
      <input data-q placeholder="${esc(AV.search.ph)}" value="${esc(st.q)}" style="width:220px"/></label>`);
    const filtros = (chips || inputs.length) ? `<div class="sv-filters"><div class="sv-ftool">${chips}${inputs.join('')}${hasFilter ? '<button class="sv-btn-g" data-chip data-clear>Limpiar filtros</button>' : ''}</div></div>` : '';

    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const selId = st.drawer;
    let cols = enFila ? AV.cols.concat([{ label: 'Plan de carga', html: r => celdaPlan(r) }]) : AV.cols;
    if (prioCfg) cols = [{ label: 'Prioridad', html: r => celdaPrio(r) }].concat(cols);
    if (conComent) cols = cols.concat([{ label: 'Coment.', html: r => celdaComentarios(conteos.get(claveCom(r)) || 0, r.__rid) }]);
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
      ${esCal() ? calHTML(filt) : `<div class="sv-card">
        <div class="sv-tablewrap"><table class="sv-table" style="min-width:${AV.minW || '900px'}">
          <thead><tr>${cols.map(c => `<th class="${c.al === 'r' ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody></table></div>
        <div class="sv-tfoot"><span>${filt.length.toLocaleString('es-CL')} de ${rowsAll.filter(r => !AV.origen || st.orig === '*' || String(AV.origen.of(r) ?? '').trim() === st.orig).length.toLocaleString('es-CL')} registros${filt.length > MAX ? ` · mostrando ${MAX}, usa los filtros para acotar` : ''}</span><span>${esc(nota)}</span></div>
      </div>`}
      <div data-drawer-slot></div>
    </div>`;
    wire(filt);
    if (st.drawer) openDrawer(st.drawer);
  }

  // ── Calendario (11-oct-2026, Jordan) ─────────────────────────────────────
  // AV.calendario = { fecha(r) → 'YYYY-MM-DD', chip(r) → html (resumen en la celda), totalDia(rows) → texto,
  //   resumenDia(rows) → html, tarjeta(r) → html (panel del día), leyenda → html, vacio → texto }.
  // Clic en un día → panel con sus planes; clic en una tarjeta → panel lateral de detalle de siempre.
  function calHTML(filt) {
    const C = AV.calendario;
    const porDia = new Map();
    filt.forEach(r => { const f = String(C.fecha(r) || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return; if (!porDia.has(f)) porDia.set(f, []); porDia.get(f).push(r); });
    const hoy = hoyISO();
    if (!st.calDia) {
      const dias = [...porDia.keys()].sort();
      st.calDia = porDia.has(hoy) ? hoy : (dias.find(d => d > hoy) || dias[dias.length - 1] || hoy);
    }
    if (!st.calMes) st.calMes = st.calDia.slice(0, 7);
    const [y, m] = st.calMes.split('-').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const off = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const nDias = new Date(y, m, 0).getDate();
    const semanas = Math.ceil((off + nDias) / 7);
    const delMes = [...porDia.entries()].filter(([d]) => d.startsWith(st.calMes)).flatMap(([, rs]) => rs);
    let celdas = '';
    for (let i = 0; i < semanas * 7; i++) {
      const d = new Date(y, m - 1, 1 - off + i), f = iso(d), rs = porDia.get(f) || [];
      const cls = ['sv-cdr-d', d.getMonth() !== m - 1 ? 'is-out' : '', f === hoy ? 'is-today' : '', f === st.calDia ? 'is-sel' : '',
        rs.length ? 'has' : '', i % 7 >= 5 ? 'is-we' : ''].filter(Boolean).join(' ');
      celdas += `<button class="${cls}" data-cal-dia="${f}" aria-label="${esc(fechaLarga(f))}${rs.length ? `, ${rs.length} planes` : ''}" aria-pressed="${f === st.calDia}">
        <span class="sv-cdr-dh"><span class="sv-cdr-n">${d.getDate()}</span>${rs.length ? `<span class="sv-cdr-t">${esc(C.totalDia(rs))}</span>` : ''}</span>
        ${rs.slice(0, 4).map(C.chip).join('')}${rs.length > 4 ? `<span class="sv-cdr-more">+${rs.length - 4} más</span>` : ''}</button>`;
    }
    const rsDia = (porDia.get(st.calDia) || []);
    const cards = rsDia.length ? rsDia.map(r => `<div class="sv-cdr-card ${st.drawer === r.__rid ? 'is-sel' : ''}" data-cal-row="${esc(r.__rid)}" role="button" tabindex="0">${C.tarjeta(r)}</div>`).join('')
      : `<div class="sv-cdr-empty"><span class="material-symbols-outlined">event_available</span>${esc(C.vacio || 'Sin planes este día.')}</div>`;
    return `<div class="sv-cdr">
      <div class="sv-card sv-cdr-main">
        <div class="sv-cdr-h">
          <button class="sv-iconbtn" data-cal-nav="-1" title="Mes anterior"><span class="material-symbols-outlined">chevron_left</span></button>
          <div class="sv-cdr-m">${esc(MESES[m - 1])} ${y}</div>
          <button class="sv-iconbtn" data-cal-nav="1" title="Mes siguiente"><span class="material-symbols-outlined">chevron_right</span></button>
          <button class="sv-btn" data-cal-hoy style="padding:4px 10px">Hoy</button>
          <span class="sv-cdr-ms">${delMes.length ? esc(C.resumenMes ? C.resumenMes(delMes) : `${delMes.length} planes`) : 'Sin planes en el mes'}</span>
        </div>
        <div class="sv-cdr-scroll"><div class="sv-cdr-grid">
          ${DIAS_SEM.map((dn, i) => `<div class="sv-cdr-wd ${i >= 5 ? 'is-we' : ''}">${dn}</div>`).join('')}
          ${celdas}
        </div></div>
        ${C.leyenda ? `<div class="sv-cdr-leg">${C.leyenda}</div>` : ''}
      </div>
      <aside class="sv-card sv-cdr-side" aria-live="polite">
        <div class="sv-cdr-sh">
          <div class="sv-cdr-sk">${esc(C.etiquetaDia || 'Día')}</div>
          <div class="sv-cdr-st">${esc(fechaLarga(st.calDia))}</div>
          ${rsDia.length && C.resumenDia ? `<div class="sv-cdr-ss">${C.resumenDia(rsDia)}</div>` : ''}
        </div>
        <div class="sv-cdr-cards">${cards}</div>
      </aside>
    </div>`;
  }
  function wireCal() {
    stage.querySelectorAll('[data-cal-dia]').forEach(b => b.addEventListener('click', () => {
      st.calDia = b.dataset.calDia;
      if (!st.calDia.startsWith(st.calMes)) st.calMes = st.calDia.slice(0, 7);
      draw();
      if (window.matchMedia('(max-width: 1180px)').matches) stage.querySelector('.sv-cdr-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    stage.querySelectorAll('[data-cal-nav]').forEach(b => b.addEventListener('click', () => {
      const [y, m] = st.calMes.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.calNav), 1);
      st.calMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; draw();
    }));
    stage.querySelector('[data-cal-hoy]')?.addEventListener('click', () => { st.calDia = hoyISO(); st.calMes = st.calDia.slice(0, 7); draw(); });
    const abrir = el => {
      st.drawer = el.dataset.calRow;
      stage.querySelectorAll('.sv-cdr-card.is-sel').forEach(x => x.classList.remove('is-sel'));
      el.classList.add('is-sel');
      openDrawer(st.drawer);
    };
    stage.querySelectorAll('[data-cal-row]').forEach(el => {
      el.addEventListener('click', () => abrir(el));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(el); } });
    });
  }

  function celdaPlan(r) {
    const ex = exclusionDe(r);
    const pill = AV.planEstado ? AV.planEstado(r, !!ex)
      : (ex ? '<span class="sv-pill bad"><i></i>Excluida hoy</span>' : '<span class="sv-pill ok"><i></i>En plan</span>');
    if (!puedeExcluir || (AV.bloqueado && AV.bloqueado(r))) return pill;   // (14-oct-2026) NV en camión programado: bloqueada
    const btn = ex
      ? `<button class="sv-btn" data-fila-reac="${esc(r.__rid)}" title="Reactivar en el Plan de Carga" style="padding:2px 8px;font-size:11px"><span class="material-symbols-outlined">visibility</span>Reactivar</button>`
      : `<button class="sv-btn" data-fila-excl="${esc(r.__rid)}" title="Excluir del Plan de Carga" style="padding:2px 8px;font-size:11px;color:#b91c1c"><span class="material-symbols-outlined">visibility_off</span>Excluir</button>`;
    return `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">${pill}${btn}</div>`;
  }
  async function excluirFila(r) {
    const ex = active.excluir;
    const doc = ex.doc(r), mat = typeof ex.material === 'function' ? ex.material(r) : null;
    const esEnt = String(doc ?? '').startsWith('ENT:');
    const etiqueta = esEnt ? `la entrega ${String(doc).slice(4)}${mat ? ' · material ' + mat : ''}` : mat ? `el material ${mat} del documento ${doc}` : `el documento ${doc} completo`;
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
    stage.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
      if (st.vista === b.dataset.vista) return;
      st.vista = b.dataset.vista; st.open = null; draw();
    }));
    if (esCal()) wireCal();
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
      // (21-oct-2026) run() puede devolver { abrir: rowId } para reabrir el detalle de esa fila tras recargar.
      try { const res = await hb.run(); if (res) { if (res.abrir) st._reopen = String(res.abrir); deps.clearRawCache(); renderTablaV2(stage, cfg, deps, viewKey); return; } } finally { b.disabled = false; }
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
    stage.querySelectorAll('[data-cmt]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      st.drawer = b.dataset.cmt; st._focoCom = 'hilo';
      stage.querySelectorAll('tbody tr.is-sel').forEach(x => x.classList.remove('is-sel'));
      b.closest('tr')?.classList.add('is-sel');
      openDrawer(st.drawer);
    }));
    stage.querySelectorAll('[data-prio]').forEach(ch => {
      ch.addEventListener('click', e => e.stopPropagation());
      ch.closest('label')?.addEventListener('click', e => e.stopPropagation());
      ch.addEventListener('change', async () => {
        const r = rowsAll.find(x => x.__rid === ch.dataset.prio); if (!r) return;
        ch.disabled = true;
        const ok = await deps.togglePrioridad(prioCfg.tipo, prioDoc(r), prioCfg.centro ? String(prioCfg.centro(r) ?? '').trim() : null, ch.checked);
        if (ok) prios = await deps.loadPrioridades(prioCfg.tipo);
        draw();
      });
    });
    // (15-oct-2026) Aceptar / Rechazar prioridad (Planner de Abastecimiento)
    [['[data-prio-ok]', 'prioOk', true], ['[data-prio-no]', 'prioNo', false]].forEach(([sel, k, acepta]) =>
      stage.querySelectorAll(sel).forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        const r = rowsAll.find(x => x.__rid === b.dataset[k]); if (!r) return;
        b.disabled = true;
        try {
          const ok = await deps.evaluarPrioridad(prioCfg.tipo, prioDoc(r), acepta);
          if (ok) prios = await deps.loadPrioridades(prioCfg.tipo);
        } finally { draw(); }
      })));
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
    stage.querySelectorAll('tbody tr.is-sel, .sv-cdr-card.is-sel').forEach(x => x.classList.remove('is-sel'));
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
    // (11-oct-2026) tb.html: bloque libre (p. ej. ficha del transporte); tb.vacio: texto cuando la tabla no tiene filas.
    const tablaHtml = tb => tb && tb.html != null ? `<div>
      ${tb.titulo ? `<div class="sv-dr-sect">${esc(tb.titulo)}</div>` : ''}
      ${tb.sub ? `<div class="sv-sub" style="margin:-4px 0 6px;max-width:none">${esc(tb.sub)}</div>` : ''}${tb.html}</div>`
      : tb && tb.vacio && !(tb.rows && tb.rows.length) ? `<div><div class="sv-dr-sect">${esc(tb.titulo || 'Detalle')}</div>
      <div class="sv-sub" style="margin:0;max-width:none">${esc(tb.vacio)}</div></div>`
      : tb && tb.rows && tb.rows.length ? `<div>
      <div class="sv-dr-sect">${esc(tb.titulo || 'Detalle')}</div>
      ${tb.sub ? `<div class="sv-sub" style="margin:-4px 0 6px;max-width:none">${esc(tb.sub)}</div>` : ''}
      <div class="sv-card" style="overflow:auto"><table class="sv-table">
        <thead><tr>${tb.head.map(([l, al]) => `<th class="${al === 'r' ? 'r' : ''}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${tb.rows.map(row => `<tr>${row.map((c, i) => `<td class="${tb.head[i] && tb.head[i][1] === 'r' ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>` : '';
    const tabla = (d.tablas || (d.tabla ? [d.tabla] : [])).map(tablaHtml).join('');

    // Acciones: propias de la vista + excluir/reactivar del Plan de Carga
    const acciones = (d.acciones || []).slice();
    // (11-oct-2026) En el calendario no hay columna Acciones: las acciones de la fila van al detalle.
    if (esCal() && AV.filaAcciones) (AV.filaAcciones(r) || []).forEach(a => acciones.push(Object.assign({}, a)));
    if (puedeExcluir && !enFila) {
      const ex = exclusionDe(r);
      acciones.push(ex
        ? { id: 'reactivar', label: 'Reactivar en el plan', icon: 'visibility', primary: false }
        : { id: 'excluir', label: active.excluir.material ? 'Excluir línea del plan' : 'Excluir del plan', icon: 'visibility_off', primary: !(d.acciones || []).some(a => a.primary) });
    }
    const btns = acciones.map((a, i) => `<button data-acc="${i}" class="${a.primary ? 'sv-btn-p' : 'sv-btn'}"${a.tono === 'peligro' ? ' style="color:#b91c1c"' : ''}${a.title ? ` title="${esc(a.title)}"` : ''}>${a.icon ? `<span class="material-symbols-outlined">${a.icon}</span>` : ''}${esc(a.label)}</button>`).join('');

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
          ${conComent ? '<div data-hilo style="border-top:1px solid var(--sv-line,#e1e3e4);padding-top:16px"></div>' : ''}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">${esc(d.nota || '')}</span><div style="display:flex;gap:8px;flex-wrap:wrap">${btns}</div></div>
      </aside>`;
    slot.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
    const hiloEl = slot.querySelector('[data-hilo]');
    if (hiloEl) {
      const fc = st._focoCom; st._focoCom = null;
      montarHilo(hiloEl, { vista: viewKey, clave: claveCom(r), documento: docCom(r), centro: campoCentro ? String(r[campoCentro] ?? '').trim() : null,
        focoId: typeof fc === 'number' ? fc : null,
        onCount: n => {
          const k = claveCom(r);
          if ((conteos.get(k) || 0) === n) return;
          conteos.set(k, n);
          const cel = stage.querySelector(`[data-cmt="${CSS.escape(r.__rid)}"]`);
          if (cel) cel.outerHTML = celdaComentarios(n, r.__rid);
          const nb = stage.querySelector(`[data-cmt="${CSS.escape(r.__rid)}"]`);
          nb?.addEventListener('click', e => { e.stopPropagation(); st.drawer = r.__rid; st._focoCom = 'hilo'; openDrawer(r.__rid); });
        } });
      if (fc === 'hilo') setTimeout(() => hiloEl.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    }
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
