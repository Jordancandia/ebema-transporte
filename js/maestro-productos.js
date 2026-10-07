// ============================================================================
//  MAESTROS · PRODUCTOS (7-oct-2026, Jordan)
//  Tabla maestro_productos (Supabase). Sólo OWNER (menú + RLS de escritura).
//  - Medidas (longitud / ancho / altura) en METROS; pesos en KG por unidad.
//  - Peso Volumétrico = campo SAP "Tamaño/Dimens."; si no viene, queda vacío.
//  - Familia Producto = "Jquía.productos" de SAP.
//  - Filas con valor en la columna SM NO se cargan (y si ya existían, se inactivan).
//  - Es la fuente PRIORITARIA de pesos del Plan de Carga (vistas v_trc_sqvi_*).
//  Carga liviana: la vista pagina y busca en el servidor (RPC fn_maestro_productos_buscar,
//  50 filas por página en formato compacto). Nunca baja los ~22 mil productos.
//  La recarga del Excel se procesa en el navegador y se envía en lotes compactos
//  (RPC fn_maestro_productos_cargar), respetando los productos editados a mano.
// ============================================================================
import { supabase } from './supabase-client.js?v=202610071945';
import { escapeHtml, showAlert } from './utils.js';
import { confirmar } from './confirmar.js?v=202610071945';

const PAGE = 50;
const LOTE = 2000;
const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const UI = { q: '', familia: '', filtro: 'todos', page: 0 };
let _stage = null;
let _resumen = null;
let _rows = [];
let _total = 0;
let _reqId = 0;

// Columnas del arreglo compacto devuelto por fn_maestro_productos_buscar
const C = { id: 0, nom: 1, lon: 2, anc: 3, alt: 4, pb: 5, pv: 6, fam: 7, origen: 8, manual: 9, activo: 10, revisar: 11, upd: 12, por: 13 };

const nf = (v, d = 3) => (v == null || v === '' ? '' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const cel = (v, d) => (v == null ? '<span class="text-outline">—</span>' : nf(v, d));
const vol = r => (r[C.lon] != null && r[C.anc] != null && r[C.alt] != null ? Number(r[C.lon]) * Number(r[C.anc]) * Number(r[C.alt]) : null);

async function getUserEmail() {
  try { const { data } = await supabase.auth.getUser(); return data?.user?.email || null; } catch (_e) { return null; }
}

// Número desde input/Excel: acepta "9,417", "1.363,635", 2.44 (number)
function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// ── Datos ───────────────────────────────────────────────────────────────────
async function cargarResumen() {
  const { data, error } = await supabase.rpc('fn_maestro_productos_resumen');
  if (error) { console.error(error); showAlert('Error al leer el maestro: ' + error.message, 'error'); return null; }
  return data;
}

async function cargarPagina() {
  const id = ++_reqId;
  const { data, error } = await supabase.rpc('fn_maestro_productos_buscar', {
    p_q: UI.q || null, p_familia: UI.familia || null, p_filtro: UI.filtro, p_limit: PAGE, p_offset: UI.page * PAGE,
  });
  if (id !== _reqId) return false; // respuesta vieja (el usuario siguió escribiendo)
  if (error) { console.error(error); showAlert('Error al buscar productos: ' + error.message, 'error'); return false; }
  _rows = data?.rows || [];
  _total = data?.total || 0;
  return true;
}

// ── Vista ───────────────────────────────────────────────────────────────────
export async function renderMaestroProductos(stage) {
  _stage = stage;
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando maestro de productos…</div>`;
  _resumen = await cargarResumen();
  shell();
}

function kpi(k, lbl, n, icon, tono = '') {
  const act = UI.filtro === k;
  return `<button data-kpi="${k}" class="text-left border rounded-lg px-md py-sm min-w-[140px] transition-colors ${act ? 'border-primary bg-primary/5' : 'border-outline-variant hover:bg-surface-container-low'}">
    <div class="flex items-center gap-xs text-[12px] uppercase tracking-wide text-secondary font-bold">
      <span class="material-symbols-outlined text-[16px] ${tono}">${icon}</span>${lbl}</div>
    <div class="text-headline-sm font-bold text-on-surface">${nf(n || 0, 0)}</div></button>`;
}

function shell() {
  const r = _resumen || {};
  const fams = r.familias || [];
  _stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex items-center justify-between gap-md flex-wrap mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">MAESTROS – PRODUCTOS</h3>
          <p class="text-[13px] text-secondary">Medidas en metros · pesos en kg por unidad · fuente prioritaria de pesos del Plan de Carga</p>
        </div>
        <div class="flex items-center gap-sm flex-wrap">
          <button id="mp-excel" class="border border-outline-variant text-on-surface px-md py-sm rounded-lg text-body-md font-bold hover:bg-surface-container-high">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">upload_file</span>Cargar Excel SAP</button>
          <input id="mp-file" type="file" accept=".xlsx,.xls" class="hidden"/>
          <button id="mp-nuevo" class="bg-primary text-on-primary px-md py-sm rounded-lg text-body-md font-bold hover:opacity-90 transition-opacity">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">add</span>Nuevo producto</button>
        </div>
      </div>
      <div class="flex gap-sm flex-wrap mb-md">
        ${kpi('todos', 'Activos', r.activos, 'inventory_2')}
        ${kpi('sin_peso', 'Sin peso bruto', r.sin_peso, 'scale', 'text-error')}
        ${kpi('con_medidas', 'Con medidas', r.con_medidas, 'straighten')}
        ${kpi('sin_pv', 'Sin peso vol.', (r.activos || 0) - (r.con_pv || 0), 'deployed_code')}
        ${kpi('revisar', 'Dato a revisar', r.revisar, 'warning', 'text-error')}
        ${kpi('manual', 'Editados / manuales', r.manuales, 'edit_note')}
        ${kpi('inactivos', 'Inactivos', r.inactivos, 'block')}
      </div>
      <div class="flex items-center gap-md flex-wrap mb-md">
        <label class="flex items-center gap-xs border border-outline-variant rounded-lg px-md py-sm flex-1 min-w-[240px] max-w-[520px] focus-within:border-primary">
          <span class="material-symbols-outlined text-[18px] text-secondary">search</span>
          <input id="mp-buscar" value="${escapeHtml(UI.q)}" placeholder="Buscar por ID material o nombre…" class="w-full outline-none text-body-md bg-transparent" autocomplete="off"/></label>
        <select id="mp-fam" class="border border-outline-variant rounded-lg px-md py-sm text-body-md bg-transparent">
          <option value="">Todas las familias</option>
          ${fams.map(f => `<option value="${escapeHtml(f)}" ${UI.familia === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
        </select>
        <span class="text-[12px] text-secondary">${r.actualizado ? 'Última actualización: ' + new Date(r.actualizado).toLocaleString('es-CL') : ''}</span>
      </div>
      <div id="mp-tabla"><div class="text-secondary text-body-md p-md">Cargando…</div></div>
    </div>`;

  let tk;
  _stage.querySelector('#mp-buscar').addEventListener('input', e => {
    clearTimeout(tk); tk = setTimeout(() => { UI.q = e.target.value.trim(); UI.page = 0; refrescarTabla(); }, 250);
  });
  _stage.querySelector('#mp-fam').addEventListener('change', e => { UI.familia = e.target.value; UI.page = 0; refrescarTabla(); });
  _stage.querySelectorAll('[data-kpi]').forEach(b => b.addEventListener('click', () => { UI.filtro = b.dataset.kpi; UI.page = 0; shell(); }));
  _stage.querySelector('#mp-nuevo').addEventListener('click', () => abrirModal(null));
  const file = _stage.querySelector('#mp-file');
  _stage.querySelector('#mp-excel').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) cargarExcel(f); });
  refrescarTabla();
}

async function refrescarTabla() {
  const box = _stage?.querySelector('#mp-tabla'); if (!box) return;
  box.style.opacity = '0.6';
  const ok = await cargarPagina();
  box.style.opacity = '';
  if (ok) tabla();
}

function tabla() {
  const box = _stage.querySelector('#mp-tabla'); if (!box) return;
  const pages = Math.max(1, Math.ceil(_total / PAGE));
  const th = (t, cls = '') => `<th class="py-sm pr-md ${cls}">${t}</th>`;
  box.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-body-md">
        <thead><tr class="text-left text-[12px] uppercase tracking-wide text-secondary border-b border-outline-variant">
          ${th('ID Material')}${th('Nombre Material')}${th('Familia Producto')}
          ${th('Longitud (m)', 'text-right')}${th('Ancho (m)', 'text-right')}${th('Altura (m)', 'text-right')}${th('Vol. (m³)', 'text-right')}
          ${th('Peso Bruto (kg)', 'text-right')}${th('Peso Volumétrico (kg)', 'text-right')}${th('', 'text-right')}</tr></thead>
        <tbody>
          ${_rows.length === 0 ? `<tr><td colspan="10" class="py-lg text-center text-secondary">Sin productos para el filtro.</td></tr>` : _rows.map((r, i) => `
            <tr class="border-b border-outline-variant/60 hover:bg-surface-container-low ${r[C.activo] ? '' : 'opacity-60'}">
              <td class="py-sm pr-md font-data-mono text-[13px] whitespace-nowrap">${escapeHtml(r[C.id])}</td>
              <td class="py-sm pr-md font-semibold">${escapeHtml(r[C.nom])}
                ${r[C.revisar] ? '<span title="Medida mayor a 20 m: revisar" class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-error-container text-on-error-container">Revisar</span>' : ''}
                ${r[C.manual] ? '<span title="Editado en la plataforma: la recarga SAP no sobrescribe medidas ni pesos" class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-surface-container-high text-secondary">Editado</span>' : ''}
                ${r[C.origen] === 'MANUAL' ? '<span class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-surface-container-high text-secondary">Manual</span>' : ''}
                ${r[C.activo] ? '' : '<span class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-error-container text-on-error-container">Inactivo</span>'}</td>
              <td class="py-sm pr-md text-[13px] whitespace-nowrap">${r[C.fam] ? escapeHtml(r[C.fam]) : '<span class="text-outline">—</span>'}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${cel(r[C.lon])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${cel(r[C.anc])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${cel(r[C.alt])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px] text-secondary">${cel(vol(r), 4)}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px] ${r[C.pb] == null ? 'text-error' : ''}">${cel(r[C.pb])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${cel(r[C.pv])}</td>
              <td class="py-sm pr-md text-right whitespace-nowrap">
                <button data-edit="${i}" title="Editar" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                <button data-toggle="${i}" title="${r[C.activo] ? 'Desactivar' : 'Activar'}" class="text-secondary ${r[C.activo] ? 'hover:text-error' : 'hover:text-primary'} p-xs">
                  <span class="material-symbols-outlined text-[20px]">${r[C.activo] ? 'toggle_on' : 'toggle_off'}</span></button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between mt-md text-[13px] text-secondary">
      <span>${_total ? `${UI.page * PAGE + 1}–${Math.min(_total, (UI.page + 1) * PAGE)} de ${nf(_total, 0)}` : '0 resultados'}</span>
      <div class="flex items-center gap-xs">
        <button data-pg="-1" ${UI.page === 0 ? 'disabled' : ''} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_left</span></button>
        <span>Página ${UI.page + 1} de ${nf(pages, 0)}</span>
        <button data-pg="1" ${UI.page >= pages - 1 ? 'disabled' : ''} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
    </div>`;
  box.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => { UI.page += Number(b.dataset.pg); refrescarTabla(); }));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => abrirModal(_rows[Number(b.dataset.edit)])));
  box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleActivo(_rows[Number(b.dataset.toggle)])));
}

// ── Alta / edición ─────────────────────────────────────────────────────────
function modalShell(titulo, bodyHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md';
  wrap.innerHTML = `
    <div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <h3 class="text-headline-sm font-bold text-on-surface">${escapeHtml(titulo)}</h3>
        <button data-close class="text-secondary hover:text-error"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="p-lg">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(wrap);
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  return { wrap, close };
}
function field(label, id, value = '', extra = '', cls = '') {
  return `<label class="block mb-sm ${cls}">
      <span class="text-[12px] uppercase tracking-wide text-secondary font-bold">${label}</span>
      <input id="${id}" value="${escapeHtml(value ?? '')}" ${extra}
        class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none disabled:opacity-60" /></label>`;
}

function abrirModal(r) {
  const nuevo = !r;
  const v = k => (r && r[C[k]] != null ? String(r[C[k]]).replace('.', ',') : '');
  const fams = _resumen?.familias || [];
  const numAttr = 'inputmode="decimal" autocomplete="off" placeholder="—"';
  const { wrap, close } = modalShell(nuevo ? 'Nuevo producto' : `Editar producto ${r[C.id]}`, `
    <div class="grid grid-cols-2 gap-x-md">
      ${field('ID Material *', 'f-id', nuevo ? '' : r[C.id], nuevo ? 'autocomplete="off"' : 'disabled')}
      <label class="block mb-sm"><span class="text-[12px] uppercase tracking-wide text-secondary font-bold">Familia Producto</span>
        <input id="f-fam" list="f-fam-list" value="${escapeHtml(nuevo ? '' : (r[C.fam] || ''))}" autocomplete="off" style="text-transform:uppercase"
          class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
        <datalist id="f-fam-list">${fams.map(f => `<option value="${escapeHtml(f)}">`).join('')}</datalist></label>
    </div>
    ${field('Nombre Material *', 'f-nom', nuevo ? '' : r[C.nom], 'autocomplete="off" maxlength="80" style="text-transform:uppercase"')}
    <div class="grid grid-cols-3 gap-x-md">
      ${field('Longitud (m)', 'f-lon', v('lon'), numAttr)}
      ${field('Ancho (m)', 'f-anc', v('anc'), numAttr)}
      ${field('Altura (m)', 'f-alt', v('alt'), numAttr)}
    </div>
    <div class="grid grid-cols-2 gap-x-md">
      ${field('Peso Bruto (kg / un)', 'f-pb', v('pb'), numAttr)}
      ${field('Peso Volumétrico (kg / un)', 'f-pv', v('pv'), numAttr)}
    </div>
    <p id="f-aviso" class="text-[12px] text-error mb-sm hidden"></p>
    ${nuevo ? '' : `<label class="flex items-start gap-sm mt-xs mb-md text-body-md">
      <input id="f-man" type="checkbox" ${r[C.manual] ? 'checked' : ''} class="w-4 h-4 mt-[3px]"/>
      <span>Mantener mis valores ante la recarga del Excel SAP<br><span class="text-[12px] text-secondary">Al guardar un cambio de medidas o pesos queda marcado. Desmárcalo para que la próxima recarga SAP vuelva a mandar.</span></span></label>`}
    <div class="flex justify-end gap-sm">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>`);
  setTimeout(() => wrap.querySelector(nuevo ? '#f-id' : '#f-lon')?.focus(), 0);
  const aviso = wrap.querySelector('#f-aviso');
  const leer = id => num(wrap.querySelector(id).value);
  const chk = () => {
    const ms = [leer('#f-lon'), leer('#f-anc'), leer('#f-alt')].filter(x => x != null);
    const msg = ms.some(x => x > 20) ? 'Ojo: una medida supera 20 m. Las medidas van en METROS (ej.: 2,44).' : '';
    aviso.textContent = msg; aviso.classList.toggle('hidden', !msg);
  };
  ['#f-lon', '#f-anc', '#f-alt'].forEach(s => wrap.querySelector(s).addEventListener('input', chk));
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async e => {
    const id = wrap.querySelector('#f-id').value.trim();
    const nombre = wrap.querySelector('#f-nom').value.trim().replace(/\s+/g, ' ').toUpperCase();
    const familia = wrap.querySelector('#f-fam').value.trim().toUpperCase() || null;
    const vals = { longitud: leer('#f-lon'), ancho: leer('#f-anc'), altura: leer('#f-alt'), peso_bruto: leer('#f-pb'), peso_volumetrico: leer('#f-pv') };
    if (!id) { showAlert('El ID Material es obligatorio', 'error'); return; }
    if (!nombre) { showAlert('El nombre del material es obligatorio', 'error'); return; }
    for (const [k, x] of Object.entries(vals)) {
      if (x != null && x < 0) { showAlert(`Valor negativo en ${k.replace('_', ' ')}`, 'error'); return; }
      if (x === 0) vals[k] = null;
    }
    const btn = e.currentTarget; btn.disabled = true;
    let error;
    if (nuevo) {
      const { data: ex } = await supabase.from('maestro_productos').select('id_material,nombre_material,activo').eq('id_material', id).maybeSingle();
      if (ex) { btn.disabled = false; showAlert(`El ID ${id} ya existe: ${ex.nombre_material}${ex.activo ? '' : ' (inactivo)'}`, 'error'); return; }
      ({ error } = await supabase.from('maestro_productos').insert({ id_material: id, nombre_material: nombre, familia_producto: familia, ...vals, origen: 'MANUAL', editado_manual: true, activo: true }));
    } else {
      const cambioMedidas = ['lon', 'anc', 'alt', 'pb', 'pv'].some((k, i) => {
        const nv = Object.values(vals)[i]; const ov = r[C[k]] == null ? null : Number(r[C[k]]);
        return (nv == null ? null : Math.round(nv * 1e4)) !== (ov == null ? null : Math.round(ov * 1e4));
      });
      const marcado = wrap.querySelector('#f-man').checked;
      // Si cambió medidas/pesos, queda protegido ante recarga SAP salvo que el usuario lo desmarque a propósito
      const editado = cambioMedidas ? (marcado || !r[C.manual]) : marcado;
      ({ error } = await supabase.from('maestro_productos')
        .update({ nombre_material: nombre, familia_producto: familia, ...vals, editado_manual: editado })
        .eq('id_material', r[C.id]));
    }
    if (error) { btn.disabled = false; showAlert('Error al guardar: ' + error.message, 'error'); return; }
    showAlert(nuevo ? `Producto ${id} agregado` : 'Producto actualizado', 'success');
    close();
    if (nuevo) { UI.q = id; UI.filtro = 'todos'; UI.familia = ''; UI.page = 0; }
    _resumen = await cargarResumen();
    shell();
  });
}

async function toggleActivo(r) {
  if (!r) return;
  const activar = !r[C.activo];
  if (!await confirmar(`¿${activar ? 'Activar' : 'Desactivar'} el material ${r[C.id]} · ${r[C.nom]}?${activar ? '' : '\n\nNo se elimina. Mientras esté inactivo, el Plan de Carga usa el peso que informa SAP.'}`,
    { aceptar: activar ? 'Activar' : 'Desactivar', tono: activar ? 'normal' : 'peligro', icono: activar ? 'toggle_on' : 'toggle_off' })) return;
  const { error } = await supabase.from('maestro_productos').update({ activo: activar }).eq('id_material', r[C.id]);
  if (error) { showAlert('Error: ' + error.message, 'error'); return; }
  showAlert(activar ? 'Material activado' : 'Material desactivado', 'success');
  _resumen = await cargarResumen();
  shell();
}

// ── Recarga desde Excel SAP (diferencial, en lotes compactos) ───────────────
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = XLSX_CDN; s.async = true;
    s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('No se pudo cargar el lector de Excel')));
    s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel'));
    document.head.appendChild(s);
  });
}

const normH = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function progreso(msg, pct) {
  let el = document.getElementById('mp-prog');
  if (!el) {
    el = document.createElement('div'); el.id = 'mp-prog';
    el.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md';
    el.innerHTML = `<div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-md p-lg">
      <h3 class="text-headline-sm font-bold text-on-surface mb-sm">Cargando maestro de productos</h3>
      <p id="mp-prog-t" class="text-body-md text-secondary mb-md"></p>
      <div class="h-2 rounded-full bg-surface-container-high overflow-hidden"><div id="mp-prog-b" class="h-full bg-primary transition-all" style="width:0%"></div></div></div>`;
    document.body.appendChild(el);
  }
  el.querySelector('#mp-prog-t').textContent = msg;
  el.querySelector('#mp-prog-b').style.width = Math.round(pct) + '%';
}
const cerrarProgreso = () => document.getElementById('mp-prog')?.remove();

async function cargarExcel(file) {
  try {
    progreso('Leyendo el archivo…', 3);
    const XLSX = await loadXlsxLib();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!aoa.length) throw new Error('El archivo está vacío');
    const H = aoa[0].map(normH);
    const col = (...names) => { for (const n of names) { const i = H.indexOf(normH(n)); if (i >= 0) return i; } return -1; };
    const ix = {
      id: col('Material'), nom: col('Texto breve de material'), sm: col('SM'), fam: col('Jquía.productos', 'Jerarquia productos'),
      lon: col('Longitud'), anc: col('Ancho'), alt: col('Altura'), pb: col('Peso bruto'), pv: col('Tamaño/Dimens.', 'Tamano/Dimens.'),
    };
    const faltan = Object.entries(ix).filter(([, i]) => i < 0).map(([k]) => k);
    if (faltan.length) throw new Error('Faltan columnas en el Excel: ' + faltan.join(', ') + '. Usa la exportación SAP de la maestra (MESTARO_PROD).');

    const filas = [], bloqueados = [];
    for (let i = 1; i < aoa.length; i++) {
      const a = aoa[i]; if (!a) continue;
      const id = String(a[ix.id] ?? '').trim().replace(/\.0+$/, '');
      if (!id) continue;
      const sm = a[ix.sm];
      if (sm != null && String(sm).trim() !== '') { bloqueados.push(id); continue; } // columna SM con valor: no es dato de carga
      const n = x => { const v = num(x); return v == null || v <= 0 ? 0 : Math.round(v * 1e4) / 1e4; };
      filas.push([id, String(a[ix.nom] ?? '').trim(), n(a[ix.lon]), n(a[ix.anc]), n(a[ix.alt]), n(a[ix.pb]), n(a[ix.pv]), String(a[ix.fam] ?? '').trim()]);
    }
    cerrarProgreso();
    if (!await confirmar(`¿Cargar ${filas.length.toLocaleString('es-CL')} productos al maestro?\n\n${bloqueados.length.toLocaleString('es-CL')} filas con valor en SM se omiten (y se inactivan si ya existían).\nLos productos editados en la plataforma conservan sus medidas y pesos.`,
      { aceptar: 'Cargar', tono: 'normal', icono: 'upload_file' })) return;

    const tot = { recibidos: 0, nuevos: 0, actualizados: 0, sin_cambio: 0, inactivados: 0 };
    const nLotes = Math.max(1, Math.ceil(filas.length / LOTE));
    for (let k = 0; k < nLotes; k++) {
      progreso(`Enviando lote ${k + 1} de ${nLotes}…`, 5 + 95 * (k / nLotes));
      const p = { r: filas.slice(k * LOTE, (k + 1) * LOTE) };
      if (k === nLotes - 1) p.b = bloqueados;
      const { data, error } = await supabase.rpc('fn_maestro_productos_cargar', { p });
      if (error) throw new Error(`Lote ${k + 1}: ${error.message}`);
      Object.keys(tot).forEach(x => { tot[x] += Number(data?.[x] || 0); });
    }
    cerrarProgreso();
    showAlert(`Maestro cargado: ${tot.nuevos} nuevos · ${tot.actualizados} actualizados · ${tot.sin_cambio} sin cambio · ${tot.inactivados} inactivados`, 'success');
    UI.page = 0;
    _resumen = await cargarResumen();
    shell();
    console.info('[maestro-productos] carga', { ...tot, por: await getUserEmail() });
  } catch (err) {
    cerrarProgreso();
    console.error(err);
    showAlert('Error al cargar el Excel: ' + (err?.message || err), 'error');
  }
}
