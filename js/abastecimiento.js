// ============================================================================
// GESTION TRONCALES / ABASTECIMIENTO
// ----------------------------------------------------------------------------
// Planificacion de cargas de productos a las sucursales desde CD (o cualquier
// origen). Dos submenus que se conectan entre si:
//   1. Proveedores  -> catalogo de proveedores + direcciones de fabrica
//                      (donde retirar material).
//   2. Calendario   -> calendario de carga por sucursal (centro logistico),
//      Sucursales      lunes a sabado, aperturado por bloques de horario.
//
// Persistencia: Supabase (tablas abast_proveedores, abast_proveedor_direcciones
// y abast_calendario, con RLS por rol/centro).
// ============================================================================

import { supabase } from './supabase-client.js';
import { getDatabase } from './data.js?v=20260714a';
import { showAlert, escapeHtml } from './utils.js';

// ── Configuracion de bloques estandar del calendario ────────────────────────
const BLOQUES = [
  '08:00-10:00',
  '10:00-12:00',
  '12:00-14:00',
  '14:00-16:00',
  '16:00-18:00',
];

const DIAS = [
  { n: 1, lbl: 'Lunes',    corto: 'LUN' },
  { n: 2, lbl: 'Martes',   corto: 'MAR' },
  { n: 3, lbl: 'Miercoles', corto: 'MIE' },
  { n: 4, lbl: 'Jueves',   corto: 'JUE' },
  { n: 5, lbl: 'Viernes',  corto: 'VIE' },
  { n: 6, lbl: 'Sabado',   corto: 'SAB', sobreCupo: true }, // sobre cupos
];

// ── Estado del modulo ───────────────────────────────────────────────────────
let currentSub = 'proveedores';     // 'proveedores' | 'calendario'
let proveedores = [];               // cache local de proveedores + direcciones
let selectedProveedorId = null;     // proveedor expandido (panel direcciones)
let calCentro = null;               // centro seleccionado en calendario
let calMatrix = {};                 // { 'dia-bloque': {habilitado, cupos, sobre_cupo} }
let rootEl = null;

// ── Utilidades ──────────────────────────────────────────────────────────────
async function getUserEmail() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email || null;
  } catch { return null; }
}

// Permite fijar el subtab desde el router del sidebar
export function setAbastSubTab(sub) {
  if (sub) currentSub = sub;
}

// ============================================================================
// VISTAS DE DATOS TRONCALES (leen las vistas v_trc_* de Supabase)
// Cada una: [campo_en_vista, etiqueta_columna]. filtros: campos con selector.
// ============================================================================
const VISTAS_TRONCAL = {
  quiebres: {
    titulo: 'Quiebres Sucursal',
    vista: 'v_trc_slim_stock',
    filtros: [{ campo: 'centro', label: 'Centro' }],
    columnas: [
      ['centro', 'Centro'], ['codigo_articulo', 'Código'], ['descripcion', 'Descripción'],
      ['stock_days', 'StockDays'], ['clase_abc', 'Clase ABC'],
    ],
  },
  retiros: {
    titulo: 'Retiros Fábrica',
    vista: 'v_trc_sqvi_retiros_fabrica',
    filtros: [{ campo: 'ce', label: 'Centro' }, { campo: 'alm', label: 'Almacén' }],
    columnas: [
      ['doc_compr', 'Doc.compr.'], ['proveedor', 'Proveedor'], ['nombre_1', 'Nombre'],
      ['material', 'Material'], ['texto_breve', 'Texto breve'], ['ce', 'Centro'], ['alm', 'Almacén'],
      ['fe_entrega', 'Fe.entrega'], ['ctd_pedido', 'Ctd.pedido'], ['ump', 'UMP'],
      ['ctd_entregada', 'Ctd.entregada'], ['peso_bruto', 'Peso bruto'],
    ],
  },
  pedidos_venta: {
    titulo: 'Pedidos Ventas 1003',
    vista: 'v_trc_sqvi_pedidos_venta_1003',
    filtros: [{ campo: 'ofvta', label: 'OF Venta' }],
    columnas: [
      ['ofvta', 'OF Venta'], ['creado_el', 'Creado el'], ['deudor', 'Deudor'], ['ce', 'Centro'],
      ['doc_ventas', 'Doc.ventas'], ['material', 'Material'], ['denominacion_de_posicion', 'Denominación'],
      ['cantidad_de_pedido', 'Cantidad'], ['um', 'UM'], ['ruta', 'Ruta'],
      ['fe_entrega', 'Fe.entrega'], ['ctd_confirmada', 'Ctd.confirmada'],
    ],
  },
  stock_almacen: {
    titulo: 'Stock Almacén 4000',
    vista: 'v_trc_sqvi_stock_almacen_4000',
    filtros: [{ campo: 'ce', label: 'Centro' }],
    columnas: [
      ['creado_el', 'Creado el'], ['ce', 'Centro'], ['alm', 'Almacén'], ['material', 'Material'],
      ['denominacion_de_posicion', 'Denominación'], ['libre_utiliz', 'Libre utiliz.'], ['umb', 'UMB'],
      ['ruta', 'Ruta'], ['deudor', 'Deudor'],
    ],
  },
  pedidos_traslados: {
    titulo: 'Pedidos Traslados',
    vista: 'v_trc_sqvi_pedidos_traslados',
    filtros: [{ campo: 'cesu', label: 'CeSu (Suministrador)' }, { campo: 'ce', label: 'Ce. (Destino)' }],
    columnas: [
      ['creado_el', 'Creado el'], ['cesu', 'CeSu'], ['cl', 'Cl.'], ['doc_compr', 'Doc.compr.'],
      ['material', 'Material'], ['texto_breve', 'Texto breve'], ['ce', 'Ce.Destino'], ['alm', 'Almacén'],
      ['ctd_pedido', 'Ctd.pedido'], ['ump', 'UMP'], ['fecha_confirmada', 'Fecha conf.'], ['ctd_confirmada', 'Ctd.confirmada'],
    ],
  },
  pedidos_traslados_4000: {
    titulo: 'Pedidos Traslados 4000',
    vista: 'v_trc_sqvi_pedidos_traslados_4000',
    filtros: [{ campo: 'cesu', label: 'CeSu (Suministrador)' }],
    columnas: [
      ['cl', 'Cl.'], ['creado_el', 'Creado el'], ['cesu', 'CeSu'], ['doc_compr', 'Doc.compr.'],
      ['material', 'Material'], ['texto_breve', 'Texto breve'], ['ce', 'Centro'], ['fe_entrega', 'Fe.entrega'],
      ['cantidad_salida', 'Cant.salida'], ['ump', 'UMP'], ['ctd_entregada', 'Ctd.entregada'], ['alm', 'Almacén'],
    ],
  },
};

// ============================================================================
// ENTRADA PRINCIPAL — despacha segun el submenu activo del sidebar
// ============================================================================
export async function renderAbastecimientoView(container) {
  rootEl = container;
  container.innerHTML = '<div id="ab-stage"></div>';
  const stage = container.querySelector('#ab-stage');
  if (currentSub === 'calendario')          await renderCalendario(stage);
  else if (VISTAS_TRONCAL[currentSub])       await renderVistaTabla(stage, VISTAS_TRONCAL[currentSub]);
  else                                       await renderProveedores(stage);
}

// Trae todas las filas de una vista (paginado, la API corta en 1000).
async function fetchAllRows(vista) {
  const pageSize = 1000;
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await supabase.from(vista).select('*').range(from, from + pageSize - 1);
    if (error) { console.error(error); showAlert('Error al cargar datos: ' + error.message, 'error'); break; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize || from > 60000) break;
    from += pageSize;
  }
  return all;
}

// Render generico de una vista con filtros (selector) + buscador + CSV.
async function renderVistaTabla(stage, cfg) {
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando ${escapeHtml(cfg.titulo)}…</div>`;
  const rows = await fetchAllRows(cfg.vista);

  const opciones = {};
  cfg.filtros.forEach(f => {
    opciones[f.campo] = Array.from(new Set(rows.map(r => String(r[f.campo] ?? '')).filter(v => v !== ''))).sort();
  });
  const filtroSel = {}; cfg.filtros.forEach(f => { filtroSel[f.campo] = ''; });
  let texto = '';

  function aplica() {
    const q = texto.trim().toLowerCase();
    return rows.filter(r => {
      for (const f of cfg.filtros) {
        if (filtroSel[f.campo] && String(r[f.campo] ?? '') !== filtroSel[f.campo]) return false;
      }
      if (q && !cfg.columnas.some(c => String(r[c[0]] ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function draw() {
    const filt = aplica();
    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const act = rows.length ? String(rows[0].cargado_en || '').slice(0, 16).replace('T', ' ') : '';
    stage.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
          <div>
            <h3 class="text-headline-sm font-bold text-on-surface">${escapeHtml(cfg.titulo)}</h3>
            <p class="text-[13px] text-secondary">${filt.length} registro(s)${act ? ' · actualizado ' + escapeHtml(act) : ''}</p>
          </div>
          <div class="flex flex-wrap items-end gap-sm">
            ${cfg.filtros.map(f => `
              <label class="block">
                <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">${escapeHtml(f.label)}</span>
                <select data-filtro="${f.campo}" class="mt-xs block border border-outline-variant rounded-lg px-sm py-sm text-body-md focus:border-primary outline-none bg-surface-container-lowest">
                  <option value="">Todos</option>
                  ${opciones[f.campo].map(v => `<option value="${escapeHtml(v)}" ${filtroSel[f.campo] === v ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}
                </select>
              </label>`).join('')}
            <label class="block">
              <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">Buscar</span>
              <input data-buscar value="${escapeHtml(texto)}" placeholder="texto…"
                class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
            </label>
            <button data-refrescar title="Refrescar" class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-[16px] align-middle">refresh</span></button>
            <button data-csv class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-[16px] align-middle mr-xs">download</span>CSV</button>
          </div>
        </div>
        <div class="overflow-x-auto max-h-[68vh] overflow-y-auto">
          <table class="w-full text-[13px]">
            <thead class="sticky top-0 bg-surface-container-lowest">
              <tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
                ${cfg.columnas.map(c => `<th class="py-sm pr-md whitespace-nowrap">${escapeHtml(c[1])}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${shown.length === 0 ? `<tr><td colspan="${cfg.columnas.length}" class="py-lg text-center text-secondary">Sin datos.</td></tr>` :
                shown.map(r => `<tr class="border-b border-outline-variant/50 hover:bg-surface-container-low">
                  ${cfg.columnas.map(c => `<td class="py-xs pr-md whitespace-nowrap">${escapeHtml(String(r[c[0]] ?? ''))}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${filt.length > MAX ? `<p class="text-[12px] text-secondary mt-sm">Mostrando ${MAX} de ${filt.length}. Usa los filtros para acotar.</p>` : ''}
      </div>`;

    stage.querySelectorAll('[data-filtro]').forEach(sel =>
      sel.addEventListener('change', () => { filtroSel[sel.dataset.filtro] = sel.value; draw(); }));
    const inp = stage.querySelector('[data-buscar]');
    inp.addEventListener('input', e => {
      texto = e.target.value; draw();
      const i = stage.querySelector('[data-buscar]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    });
    stage.querySelector('[data-refrescar]').addEventListener('click', () => renderVistaTabla(stage, cfg));
    stage.querySelector('[data-csv]').addEventListener('click', () => exportarCSV(cfg, filt));
  }

  draw();
}

function exportarCSV(cfg, filas) {
  const headers = cfg.columnas.map(c => c[1]);
  const esc = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [headers.join(';')].concat(filas.map(r => cfg.columnas.map(c => esc(r[c[0]])).join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = cfg.titulo.replace(/\s+/g, '_') + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ============================================================================
// SUBMENU 1: PROVEEDORES
// ============================================================================
async function loadProveedores() {
  const { data, error } = await supabase
    .from('abast_proveedores')
    .select('*, direcciones:abast_proveedor_direcciones(*)')
    .order('nombre', { ascending: true });
  if (error) { console.error(error); showAlert('Error al cargar proveedores: ' + error.message, 'error'); return []; }
  return data || [];
}

async function renderProveedores(stage) {
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando proveedores…</div>`;
  proveedores = await loadProveedores();

  let filtro = '';

  function draw() {
    const q = filtro.trim().toLowerCase();
    const rows = proveedores.filter(p => !q
      || (p.nombre || '').toLowerCase().includes(q)
      || (p.id || '').toLowerCase().includes(q)
      || (p.contacto_nombre || '').toLowerCase().includes(q));

    stage.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div>
            <h3 class="text-headline-sm font-bold text-on-surface">Proveedores</h3>
            <p class="text-[13px] text-secondary">Contactos y direcciones de fabrica para retiro de material</p>
          </div>
          <button id="ab-nuevo-prov"
            class="bg-primary text-on-primary px-md py-sm rounded-lg text-body-md font-bold hover:opacity-90 transition-opacity">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">add</span>Nuevo Proveedor
          </button>
        </div>

        <div class="mb-md">
          <input id="ab-prov-buscar" value="${escapeHtml(filtro)}" placeholder="Buscar por ID, nombre o contacto…"
            class="w-full md:w-1/2 border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none" />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-body-md">
            <thead>
              <tr class="text-left text-[12px] uppercase tracking-wide text-secondary border-b border-outline-variant">
                <th class="py-sm pr-md">ID</th>
                <th class="py-sm pr-md">Proveedor</th>
                <th class="py-sm pr-md">Contacto</th>
                <th class="py-sm pr-md">Correo</th>
                <th class="py-sm pr-md">Telefono</th>
                <th class="py-sm pr-md text-center">Fabricas</th>
                <th class="py-sm pr-md text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `
                <tr><td colspan="7" class="py-lg text-center text-secondary">Sin proveedores registrados.</td></tr>
              ` : rows.map(p => `
                <tr class="border-b border-outline-variant/60 hover:bg-surface-container-low">
                  <td class="py-sm pr-md font-data-mono text-[13px]">${escapeHtml(p.id)}</td>
                  <td class="py-sm pr-md font-semibold">${escapeHtml(p.nombre || '')}
                    ${p.activo === false ? '<span class="ml-xs text-[11px] text-error">(inactivo)</span>' : ''}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_nombre || '—')}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_correo || '—')}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_telefono || '—')}</td>
                  <td class="py-sm pr-md text-center">
                    <span class="inline-flex items-center justify-center min-w-[24px] h-[24px] px-xs rounded-full bg-surface-container-high text-[12px] font-bold">
                      ${(p.direcciones || []).length}</span>
                  </td>
                  <td class="py-sm pr-md text-right whitespace-nowrap">
                    <button data-dir="${escapeHtml(p.id)}" title="Direcciones de fabrica"
                      class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">factory</span></button>
                    <button data-edit="${escapeHtml(p.id)}" title="Editar"
                      class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                    <button data-del="${escapeHtml(p.id)}" title="Eliminar"
                      class="text-secondary hover:text-error p-xs"><span class="material-symbols-outlined text-[20px]">delete</span></button>
                  </td>
                </tr>
                ${selectedProveedorId === p.id ? renderDireccionesPanel(p) : ''}
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Listeners
    const search = stage.querySelector('#ab-prov-buscar');
    search.addEventListener('input', e => { filtro = e.target.value; draw();
      const s = stage.querySelector('#ab-prov-buscar'); if (s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length);} });
    stage.querySelector('#ab-nuevo-prov').addEventListener('click', () => openProveedorModal(null, draw));
    stage.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click',
      () => openProveedorModal(proveedores.find(x => x.id === b.dataset.edit), draw)));
    stage.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click',
      () => deleteProveedor(b.dataset.del, draw)));
    stage.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
      selectedProveedorId = selectedProveedorId === b.dataset.dir ? null : b.dataset.dir;
      draw();
    }));

    // Listeners del panel de direcciones (si esta abierto)
    wireDireccionesPanel(stage, draw);
  }

  draw();
}

// ── Panel de direcciones de fabrica (inline bajo la fila del proveedor) ──────
function renderDireccionesPanel(p) {
  const dirs = p.direcciones || [];
  return `
    <tr class="bg-surface-container-low"><td colspan="7" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <div class="flex items-center justify-between mb-sm">
          <h4 class="font-bold text-on-surface">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">factory</span>
            Direcciones de fabrica — ${escapeHtml(p.nombre || p.id)}
          </h4>
          <button data-adddir="${escapeHtml(p.id)}"
            class="bg-surface-container-high text-on-surface px-sm py-xs rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
            <span class="material-symbols-outlined text-[16px] align-middle mr-xs">add_location_alt</span>Agregar direccion
          </button>
        </div>
        ${dirs.length === 0 ? `<p class="text-secondary text-[13px] py-sm">Sin direcciones registradas. Agrega la ubicacion de la fabrica o bodega de retiro.</p>` : `
        <table class="w-full text-[13px]">
          <thead><tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
            <th class="py-xs pr-md">Fabrica / Planta</th><th class="py-xs pr-md">Direccion</th>
            <th class="py-xs pr-md">Comuna</th><th class="py-xs pr-md">Region</th><th class="py-xs text-right">Acciones</th>
          </tr></thead>
          <tbody>
            ${dirs.map(d => `
              <tr class="border-b border-outline-variant/50">
                <td class="py-xs pr-md">${escapeHtml(d.nombre_fabrica || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.direccion || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.comuna || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.region || '—')}</td>
                <td class="py-xs text-right whitespace-nowrap">
                  <button data-editdir="${d.id}" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                  <button data-deldir="${d.id}" class="text-secondary hover:text-error p-xs"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    </td></tr>
  `;
}

function wireDireccionesPanel(stage, redraw) {
  stage.querySelectorAll('[data-adddir]').forEach(b => b.addEventListener('click',
    () => openDireccionModal(b.dataset.adddir, null, redraw)));
  stage.querySelectorAll('[data-editdir]').forEach(b => b.addEventListener('click', () => {
    const prov = proveedores.find(p => p.id === selectedProveedorId);
    const dir = (prov?.direcciones || []).find(d => String(d.id) === b.dataset.editdir);
    openDireccionModal(selectedProveedorId, dir, redraw);
  }));
  stage.querySelectorAll('[data-deldir]').forEach(b => b.addEventListener('click',
    () => deleteDireccion(b.dataset.deldir, redraw)));
}

// ── Modal generico ───────────────────────────────────────────────────────────
function modalShell(titulo, bodyHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md';
  wrap.innerHTML = `
    <div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <h3 class="text-headline-sm font-bold text-on-surface">${escapeHtml(titulo)}</h3>
        <button data-close class="text-secondary hover:text-error"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="p-lg">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  return { wrap, close };
}

function field(label, id, value = '', type = 'text', extra = '') {
  return `
    <label class="block mb-sm">
      <span class="text-[12px] uppercase tracking-wide text-secondary font-bold">${label}</span>
      <input id="${id}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra}
        class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none" />
    </label>`;
}

// ── CRUD Proveedor ────────────────────────────────────────────────────────────
function openProveedorModal(prov, redraw) {
  const esNuevo = !prov;
  const { wrap, close } = modalShell(esNuevo ? 'Nuevo Proveedor' : 'Editar Proveedor', `
    ${field('ID Proveedor', 'f-id', prov?.id || '', 'text', esNuevo ? '' : 'disabled')}
    ${field('Nombre Proveedor', 'f-nombre', prov?.nombre || '')}
    ${field('Nombre Contacto', 'f-cnombre', prov?.contacto_nombre || '')}
    ${field('Correo Contacto', 'f-ccorreo', prov?.contacto_correo || '', 'email')}
    ${field('Telefono Contacto', 'f-ctel', prov?.contacto_telefono || '')}
    <label class="flex items-center gap-sm mt-sm mb-md text-body-md">
      <input id="f-activo" type="checkbox" ${prov?.activo === false ? '' : 'checked'} class="w-4 h-4"/>
      <span>Proveedor activo</span>
    </label>
    <div class="flex justify-end gap-sm">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>
  `);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async () => {
    const id = wrap.querySelector('#f-id').value.trim();
    const nombre = wrap.querySelector('#f-nombre').value.trim();
    if (!id)     { showAlert('El ID del proveedor es obligatorio', 'error'); return; }
    if (!nombre) { showAlert('El nombre del proveedor es obligatorio', 'error'); return; }
    const payload = {
      id,
      nombre,
      contacto_nombre: wrap.querySelector('#f-cnombre').value.trim() || null,
      contacto_correo: wrap.querySelector('#f-ccorreo').value.trim() || null,
      contacto_telefono: wrap.querySelector('#f-ctel').value.trim() || null,
      activo: wrap.querySelector('#f-activo').checked,
      updated_at: new Date().toISOString(),
      updated_by: await getUserEmail(),
    };
    const { error } = await supabase.from('abast_proveedores').upsert(payload);
    if (error) { showAlert('Error al guardar: ' + error.message, 'error'); return; }
    showAlert('Proveedor guardado', 'success');
    close();
    proveedores = await loadProveedores();
    redraw();
  });
}

async function deleteProveedor(id, redraw) {
  if (!confirm('¿Eliminar el proveedor y todas sus direcciones de fabrica?')) return;
  const { error } = await supabase.from('abast_proveedores').delete().eq('id', id);
  if (error) { showAlert('Error al eliminar: ' + error.message, 'error'); return; }
  if (selectedProveedorId === id) selectedProveedorId = null;
  showAlert('Proveedor eliminado', 'success');
  proveedores = await loadProveedores();
  redraw();
}

// ── CRUD Direccion de fabrica ────────────────────────────────────────────────
function openDireccionModal(proveedorId, dir, redraw) {
  const esNueva = !dir;
  const { wrap, close } = modalShell(esNueva ? 'Nueva direccion de fabrica' : 'Editar direccion', `
    ${field('Fabrica / Planta (etiqueta)', 'd-fab', dir?.nombre_fabrica || '')}
    ${field('Direccion', 'd-dir', dir?.direccion || '')}
    ${field('Comuna', 'd-com', dir?.comuna || '')}
    ${field('Region', 'd-reg', dir?.region || '')}
    <div class="flex justify-end gap-sm mt-md">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>
  `);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async () => {
    const payload = {
      proveedor_id: proveedorId,
      nombre_fabrica: wrap.querySelector('#d-fab').value.trim() || null,
      direccion: wrap.querySelector('#d-dir').value.trim() || null,
      comuna: wrap.querySelector('#d-com').value.trim() || null,
      region: wrap.querySelector('#d-reg').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (esNueva) {
      ({ error } = await supabase.from('abast_proveedor_direcciones').insert(payload));
    } else {
      ({ error } = await supabase.from('abast_proveedor_direcciones').update(payload).eq('id', dir.id));
    }
    if (error) { showAlert('Error al guardar direccion: ' + error.message, 'error'); return; }
    showAlert('Direccion guardada', 'success');
    close();
    proveedores = await loadProveedores();
    redraw();
  });
}

async function deleteDireccion(id, redraw) {
  if (!confirm('¿Eliminar esta direccion de fabrica?')) return;
  const { error } = await supabase.from('abast_proveedor_direcciones').delete().eq('id', id);
  if (error) { showAlert('Error al eliminar: ' + error.message, 'error'); return; }
  showAlert('Direccion eliminada', 'success');
  proveedores = await loadProveedores();
  redraw();
}

// ============================================================================
// SUBMENU 2: CALENDARIO SUCURSALES
// ============================================================================
function getCentros() {
  const db = getDatabase();
  return (db.logisticsCentres || []).slice().sort((a, b) =>
    String(a.nombre || a.id).localeCompare(String(b.nombre || b.id)));
}

async function loadCalendario(centro) {
  const { data, error } = await supabase
    .from('abast_calendario').select('*').eq('centro', centro);
  if (error) { console.error(error); showAlert('Error al cargar calendario: ' + error.message, 'error'); return {}; }
  const m = {};
  (data || []).forEach(r => { m[`${r.dia}-${r.bloque}`] = r; });
  return m;
}

async function renderCalendario(stage) {
  const centros = getCentros();
  if (!calCentro && centros.length) calCentro = centros[0].id;

  stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">Calendario de carga por sucursal</h3>
          <p class="text-[13px] text-secondary">Agenda de transportes en CD. Lunes a viernes + sabado (sobre cupos), por bloques de horario.</p>
        </div>
        <label class="block">
          <span class="text-[12px] uppercase tracking-wide text-secondary font-bold">Centro / Sucursal</span>
          <select id="cal-centro" class="mt-xs w-full md:w-[320px] border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none bg-surface-container-lowest">
            ${centros.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === calCentro ? 'selected' : ''}>${escapeHtml(c.nombre || c.id)} (${escapeHtml(c.id)})</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="cal-grid"></div>
      <div class="flex justify-end mt-md">
        <button id="cal-save" class="bg-primary text-on-primary px-lg py-sm rounded-lg font-bold hover:opacity-90">
          <span class="material-symbols-outlined text-[18px] align-middle mr-xs">save</span>Guardar calendario
        </button>
      </div>
    </div>
  `;

  if (!centros.length) {
    stage.querySelector('#cal-grid').innerHTML = `<p class="text-secondary py-md">No hay centros logisticos cargados. Registralos en Rutas de Transporte → Centros Logisticos.</p>`;
    return;
  }

  const sel = stage.querySelector('#cal-centro');
  sel.addEventListener('change', async () => {
    calCentro = sel.value;
    calMatrix = await loadCalendario(calCentro);
    drawGrid(stage);
  });

  calMatrix = await loadCalendario(calCentro);
  drawGrid(stage);

  stage.querySelector('#cal-save').addEventListener('click', () => saveCalendario(stage));
}

function drawGrid(stage) {
  const grid = stage.querySelector('#cal-grid');
  grid.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-[13px] border-collapse">
        <thead>
          <tr class="text-left text-[11px] uppercase tracking-wide text-secondary">
            <th class="py-sm pr-md border-b border-outline-variant">Bloque horario</th>
            ${DIAS.map(d => `<th class="py-sm px-sm border-b border-outline-variant text-center">
              ${d.lbl}${d.sobreCupo ? '<br><span class="text-[10px] text-primary font-bold normal-case">sobre cupos</span>' : ''}
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${BLOQUES.map(bloque => `
            <tr class="border-b border-outline-variant/50">
              <td class="py-sm pr-md font-data-mono font-bold text-on-surface whitespace-nowrap">${bloque}</td>
              ${DIAS.map(d => {
                const key = `${d.n}-${bloque}`;
                const cell = calMatrix[key] || { habilitado: false, cupos: 1 };
                return `<td class="py-sm px-sm text-center ${d.sobreCupo ? 'bg-primary/5' : ''}">
                  <div class="flex flex-col items-center gap-xs">
                    <input type="checkbox" data-hab="${key}" ${cell.habilitado ? 'checked' : ''} class="w-4 h-4"/>
                    <input type="number" min="0" step="1" data-cupos="${key}" value="${cell.cupos ?? 1}"
                      class="w-14 border border-outline-variant rounded px-xs py-[2px] text-center text-[12px] focus:border-primary outline-none ${cell.habilitado ? '' : 'opacity-40'}"/>
                  </div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="text-[12px] text-secondary mt-sm">
      <span class="material-symbols-outlined text-[14px] align-middle">info</span>
      Marca el bloque para habilitarlo e indica los cupos (camiones agendables). El sabado se agenda como sobre cupos.
    </p>
  `;

  // Vincular estado visual del campo cupos al checkbox
  grid.querySelectorAll('[data-hab]').forEach(chk => chk.addEventListener('change', () => {
    const cuposInput = grid.querySelector(`[data-cupos="${chk.dataset.hab}"]`);
    if (cuposInput) cuposInput.classList.toggle('opacity-40', !chk.checked);
  }));
}

async function saveCalendario(stage) {
  const grid = stage.querySelector('#cal-grid');
  const email = await getUserEmail();
  const now = new Date().toISOString();
  const rows = [];
  DIAS.forEach(d => {
    BLOQUES.forEach(bloque => {
      const key = `${d.n}-${bloque}`;
      const hab = grid.querySelector(`[data-hab="${key}"]`);
      const cuposI = grid.querySelector(`[data-cupos="${key}"]`);
      rows.push({
        centro: calCentro,
        dia: d.n,
        bloque,
        habilitado: !!(hab && hab.checked),
        cupos: Math.max(0, parseInt(cuposI?.value, 10) || 0),
        sobre_cupo: !!d.sobreCupo,
        updated_by: email,
        updated_at: now,
      });
    });
  });

  const { error } = await supabase
    .from('abast_calendario')
    .upsert(rows, { onConflict: 'centro,dia,bloque' });
  if (error) { showAlert('Error al guardar calendario: ' + error.message, 'error'); return; }
  showAlert('Calendario guardado', 'success');
  calMatrix = await loadCalendario(calCentro);
}
