// ============================================================================
// TARIFAS — piezas comunes del rediseño v2 (29-sep-2026)
// ----------------------------------------------------------------------------
// · Cadena de cálculo (Insumos → Cálculo → Tarifas transportista /
//   Análisis → Tarifa por kilo → Tarifa por pedido), con chips que navegan.
// · Barra amarilla de cambios sin guardar (Descartar / Guardar y recalcular).
// · Inputs numéricos con separador de miles es-CL: mientras el campo tiene
//   foco se ve tal cual lo escribe el usuario; al salir se vuelve a formatear.
// · Píldora del encabezado con los parámetros vigentes (UF y fecha del diésel).
// Usa las clases del sistema visual v2 (css/sit-v2.css).
// ============================================================================

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
export const clp = n => (n == null || isNaN(n)) ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-CL');
export const kg$ = n => (n == null || isNaN(n)) ? '—' : '$' + fmt(n, 2) + '/kg';

// Texto es-CL → número ("1.234,5" → 1234.5). Vacío → 0.
export function parseIn(s) {
  const t = String(s ?? '').replace(/\s/g, '').replace(/\$/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (t === '' || t === '-' || t === '.') return 0;
  const n = Number(t);
  return isNaN(n) ? 0 : n;
}
// Número → texto con miles (hasta 2 decimales si los tiene)
export function fmtIn(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  const dec = Math.abs(n % 1) > 1e-9 ? Math.min(2, (String(n).split('.')[1] || '').length) : 0;
  return n.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
// Texto crudo (sin miles) para mostrar mientras el input tiene foco
const crudo = v => (v === '' || v == null) ? '' : String(v).replace('.', ',');

// Input numérico editable. key identifica el valor en el borrador de la vista.
// opts: { changed, unit, w, disabled, placeholder, al }
export function numIn(key, value, opts = {}) {
  const cls = `tf-in${opts.changed ? ' is-ch' : ''}${opts.disabled ? ' is-dis' : ''}`;
  return `<label class="${cls}" style="${opts.w ? `--w:${opts.w}` : ''}">
    ${opts.pre ? `<span class="tf-pre">${esc(opts.pre)}</span>` : ''}
    <input type="text" inputmode="decimal" data-num="${esc(key)}" value="${esc(fmtIn(value))}" ${opts.disabled ? 'disabled' : ''}
      placeholder="${esc(opts.placeholder ?? '0')}" autocomplete="off" aria-label="${esc(opts.label || key)}">
    ${opts.unit ? `<span class="tf-unit">${esc(opts.unit)}</span>` : ''}</label>`;
}

// Enlaza los inputs numéricos de `root`. onInput(key, number) se llama en cada
// tecla (recálculo en vivo); la vista debe re-renderizar con rerender().
export function wireNumIns(root, onInput) {
  root.querySelectorAll('input[data-num]').forEach(inp => {
    inp.addEventListener('focus', () => {
      if (inp.dataset.editing) return;
      inp.dataset.editing = '1';
      const n = parseIn(inp.value);
      inp.value = inp.value === '' ? '' : crudo(n);
      try { inp.select(); } catch (_e) { /* no-op */ }
    });
    inp.addEventListener('input', () => onInput(inp.dataset.num, parseIn(inp.value), inp.value));
    inp.addEventListener('blur', () => { delete inp.dataset.editing; inp.value = fmtIn(parseIn(inp.value)); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

// Re-renderiza conservando el foco y el texto crudo del input que se está editando.
export function rerenderKeepFocus(root, renderFn) {
  const a = document.activeElement;
  const key = a && a.dataset ? a.dataset.num : null;
  const raw = key ? a.value : null;
  const pos = key ? a.selectionStart : null;
  renderFn();
  if (!key) return;
  const n = root.querySelector(`input[data-num="${CSS.escape(key)}"]`);
  if (!n) return;
  n.dataset.editing = '1';
  n.value = raw;
  n.focus();
  try { n.setSelectionRange(pos, pos); } catch (_e) { /* no-op */ }
}

// Debounce simple para el recálculo en vivo
export function debounce(fn, ms = 180) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Cadena de cálculo ───────────────────────────────────────────────────────
const CHAIN = {
  transporte: [
    ['Insumos', [['peajes', 'Peajes'], ['combustibles', 'Combustibles'], ['seguros', 'Seguros'], ['costos-extras', 'Extras'], ['variables', 'Variables']]],
    ['Cálculo', [['resultados', 'Motor de Costos']]],
    ['Tarifas transportista', [['camiones', 'Por camión'], ['zcap', 'Rutas (ZCAP)']]],
  ],
  clientes: [
    ['Análisis', [['historico', 'Histórico'], ['consolidacion', 'Consolidación'], ['densidad', 'Densidad'], ['especiales', 'Frecuencia'], ['cluster', 'Cluster']]],
    ['Tarifa por kilo', [['zfmp', '$/Kg (ZFMP)']]],
    ['Tarifa por pedido', [['zfmi', 'Min/Max (ZFMI)']]],
  ],
};
const TAB = { transporte: 'tarifas-transporte', clientes: 'tarifas-clientes' };
const ALIAS_ACTIVO = { 'peajes-inter': 'peajes', concesiones: 'peajes', 'resultados-inter': 'resultados' };

export function chainHtml(seccion, activo) {
  const act = ALIAS_ACTIVO[activo] || activo;
  const etapas = CHAIN[seccion] || [];
  return `<div class="tf-chain" role="navigation" aria-label="Cadena de cálculo">${etapas.map(([lbl, items], i) => {
    const on = items.some(([k]) => k === act);
    return `${i ? '<span class="tf-arrow material-symbols-outlined">arrow_forward</span>' : ''}
      <div class="tf-stage ${on ? 'is-on' : ''}" style="flex:${items.length > 2 ? 2 : 1}">
        <span class="tf-stage-l">${i + 1} · ${esc(lbl)}</span>
        <div class="tf-stage-i">${items.map(([k, l]) => `<button data-chip data-chain-go="${esc(TAB[seccion])}|${esc(k)}" class="${k === act ? 'is-on' : ''}">${esc(l)}</button>`).join('')}</div>
      </div>`;
  }).join('')}</div>`;
}
// Navega usando el menú lateral (mismo camino que un clic del usuario)
export function wireChain(root) {
  root.querySelectorAll('[data-chain-go]').forEach(b => b.addEventListener('click', () => {
    const [tab, sub] = b.dataset.chainGo.split('|');
    const el = document.querySelector(`.sidebar-item[data-tab="${tab}"][data-sub="${sub}"]`);
    if (el) el.click();
  }));
}

// ── Barra de cambios sin guardar ────────────────────────────────────────────
// Se dibuja en `slot` (elemento dentro de la vista). info: { n, impacto,
// onDescartar, onGuardar, guardando }. n = 0 → oculta.
export function changesBarHtml(n, impacto, guardando = false) {
  if (!n) return '';
  return `<div class="tf-bar" role="status">
    <span class="material-symbols-outlined">edit_note</span>
    <span class="tf-bar-t"><strong>${n} ${n === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}</strong>${impacto ? ` · ${impacto}` : ''}</span>
    <button class="sv-btn" data-chip data-bar-descartar ${guardando ? 'disabled' : ''}>Descartar</button>
    <button class="sv-btn-p" data-bar-guardar ${guardando ? 'disabled' : ''}><span class="material-symbols-outlined">save</span>${guardando ? 'Guardando…' : 'Guardar y recalcular'}</button>
  </div>`;
}
export function wireChangesBar(root, onDescartar, onGuardar) {
  root.querySelector('[data-bar-descartar]')?.addEventListener('click', onDescartar);
  root.querySelector('[data-bar-guardar]')?.addEventListener('click', onGuardar);
}
// Texto de impacto: "Cambian X de Y ZCAP; el promedio sube Z%"
export function textoImpacto(antes, despues, etiqueta = 'ZCAP') {
  const keys = Object.keys(despues);
  const cambian = keys.filter(k => Math.abs((despues[k] || 0) - (antes[k] || 0)) >= 1);
  if (!cambian.length) return `sin efecto en los ${etiqueta} calculados`;
  const sa = cambian.reduce((s, k) => s + (antes[k] || 0), 0), sd = cambian.reduce((s, k) => s + (despues[k] || 0), 0);
  const pct = sa ? (sd / sa - 1) * 100 : 0;
  return `Cambian ${fmt(cambian.length)} de ${fmt(keys.length)} ${etiqueta}; el promedio de esos ${pct >= 0 ? 'sube' : 'baja'} ${fmt(Math.abs(pct), 1)}%`;
}

// ── Píldora de parámetros vigentes en el encabezado ─────────────────────────
export function setParamPill(cfg) {
  const el = document.getElementById('sv-upd');
  if (!el || !cfg) return;
  const uf = Number(cfg.variables?.valorUF) || 0;
  const fechas = Object.values(cfg.combustibles || {}).map(c => c && c.fecha).filter(Boolean).sort();
  const ult = fechas[fechas.length - 1];
  let fDiesel = '';
  if (ult) {
    const m = String(ult).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) fDiesel = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  el.innerHTML = `<span class="material-symbols-outlined">event</span><strong style="font-family:inherit">UF ${fmt(uf)}</strong>${fDiesel ? `<span>· diésel act. ${esc(fDiesel)}</span>` : ''}`;
  el.title = 'Parámetros con que se calcula hoy';
  el.classList.remove('hidden');
}

// Correo del usuario de la sesión (para updated_by)
export function usuarioSesion() {
  try { return (JSON.parse(localStorage.getItem('ebema_user_session') || '{}').email) || ''; } catch (_e) { return ''; }
}

// Píldora de clasificación de ruta / característica
export function pillHtml(label, tone = 'mute') {
  return label ? `<span class="sv-pill ${tone}"><i></i>${esc(label)}</span>` : '';
}
export function clasifPill(clasif) {
  const t = { Regional: 'info', Interregional: 'purple', Troncal: 'orange' }[clasif] || 'mute';
  return pillHtml(clasif === 'Interregional' ? 'Interregional' : clasif, t);
}
export function carPill(car) {
  const c = String(car || 'NORMAL').toUpperCase();
  const t = { NORMAL: 'mute', ISLA: 'purple', EXTREMA: 'orange' }[c] || 'mute';
  return pillHtml(c.charAt(0) + c.slice(1).toLowerCase(), t);
}
