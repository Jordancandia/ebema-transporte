// PANTALLA 1: Administrador de Tarifas Transporte — SIT EBEMA
// Sub-módulos: Peajes, Combustibles y Rendimientos, Seguros y Permisos,
// Variables Generales y Motor de Costo (ZCAP) con exportación CSV.
import { getDatabase, saveDatabase, getCentreName, getTariffConfig, getClientTariffConfig, truckCapKg, getOrigenGroups, getGroupRepId, buildTruckTypes, TRUCK_BASE_TYPES } from './data.js?v=20260709b';
import { CAP_LIST, truckTypesWithCap, calcularMatrizCostos } from './tarifas-engine.js?v=20260709b';
import { formatCLP, parseCSV, showAlert, toCSV, downloadFile, escapeHtml } from './utils.js';
import { supabase } from './supabase-client.js';
import { getField } from './zonas-transporte.js';
import { renderZcapView } from './zcap.js?v=20260709b';

let activeSub = 'peajes';

// Permite fijar el subtab activo desde el menu lateral (app.js) antes de renderizar
export function setActiveSub(sub) { activeSub = sub; }

// Estado de filtros de la vista "Peajes por Ruta — Cálculo Automático"
let pjFiltroTexto = '';
let pjFiltroComuna = '';
let pjFiltroCentro = '';
let pjFiltroPendientes = false;
let pjFiltroRevision = false;

// Estado de filtros de la vista "Peajes Interregionales"
let pjiFiltroComuna = '';
let pjiFiltroCentro = '';
let pjiFiltroPendientes = false;
let pjiFiltroRevision = false;

// Estado de filtros de la vista "Motor de Costo — Resultados por Ruta"
let zcapFiltroCentro  = ''; // origen_grupo (Centro Origen); '' = todos
let zcapFiltroCapKg   = ''; // '5000'|'10000'|'15000'|'28000'; '' = todos
let zcapFiltroComuna  = ''; // texto libre sobre destino; '' = todos

// Motor de Costo unificado
let mcTipoRuta  = 'regional';  // 'regional' | 'interregional' | 'todas'
let mcCentros   = new Set();   // Set<string> de origen_grupo; vacío = todos
let mcCapKg     = '';
let mcComuna    = '';
let mcPagina    = 0;
let tarifaCentroFiltro = '';

// Estado de filtros de la vista "Motor de Costo Interregional"
let zintFiltroCentro = '';
let zintFiltroCapKg  = '';
let zintFiltroComuna = '';

// Paginación Motor de Costo y Motor de Costo Interregional
let zcapPagina = 0;
let zintPagina = 0;
const MC_PAGE  = 50;

function renderPager(total, pagina, perPage, idPrev, idNext) {
  if (total <= perPage) return '';
  const totalPags = Math.ceil(total / perPage);
  const desde = pagina * perPage + 1;
  const hasta  = Math.min((pagina + 1) * perPage, total);
  const dp = pagina === 0 ? 'disabled opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  const dn = pagina >= totalPags - 1 ? 'disabled opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  return `<div class="flex items-center justify-between mt-sm pt-sm border-t border-outline-variant text-[12px] text-secondary">
    <span>${desde.toLocaleString('es-CL')}–${hasta.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')} filas</span>
    <div class="flex items-center gap-xs">
      <button id="${idPrev}" class="px-sm py-xs border border-outline-variant rounded ${dp}" ${pagina === 0 ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_left</span>
      </button>
      <span class="px-sm">Pág. ${pagina + 1} / ${totalPags}</span>
      <button id="${idNext}" class="px-sm py-xs border border-outline-variant rounded ${dn}" ${pagina >= totalPags - 1 ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_right</span>
      </button>
    </div>
  </div>`;
}

// ---------- Helpers genéricos ----------
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj, path, fallback) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

const inputCls = 'w-full border border-[#CED4DA] p-xs font-data-mono text-data-mono text-right focus:border-primary focus:ring-0 transition-all bg-white rounded';

function numInput(path, value, extra = '') {
  const _n = Number(value ?? 0);
  const _fmt = isNaN(_n) ? '0' : _n.toLocaleString('es-CL', { maximumFractionDigits: 6 });
  return `<input type="text" inputmode="decimal" class="${inputCls}" data-path="${path}" data-numeric="1" value="${_fmt}" ${extra}>`;
}
function dateInput(path, value, extra = '') {
  return `<input type="date" class="${inputCls} text-left" data-path="${path}" value="${value || ''}" ${extra}>`;
}
function textInput(path, value, extra = '') {
  return `<input type="text" class="${inputCls} text-left" data-path="${path}" value="${value || ''}" ${extra}>`;
}

// Genera una tabla pivote compacta: filas = tipos de camión (CAP_LIST),
// columnas = Centro Origen (groups). pathFn/valueFn reciben (repId, cap).
function pivotCamionCentroTable(groups, pathFn, valueFn) {
  return `
    <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
      <table class="w-full zebra-table border-collapse">
        <thead>
          <tr class="bg-surface-container-high text-left border-b border-outline-variant">
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
            ${groups.map(g => `<th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">${g.nombre}</th>`).join('')}
          </tr>
        </thead>
        <tbody class="font-body-md text-body-md">
          ${CAP_LIST.map(cap => `
            <tr class="border-b border-outline-variant">
              <td class="p-md font-bold font-data-mono text-data-mono">${(cap / 1000)}.000 kg</td>
              ${groups.map(g => `<td class="p-sm w-28">${numInput(pathFn(g.repId, cap), valueFn(g.repId, cap))}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function readCSVFile(file, cb) {
  const reader = new FileReader();
  reader.onload = (e) => cb(parseCSV(e.target.result));
  reader.readAsText(file, 'UTF-8');
}

// Normaliza un valor de "Tipo de camión" leído desde CSV a capacidad en KG (5000/10000/15000/28000)
function parseCapKgFromCSV(val) {
  let n = Number(String(val).replace(/[^\d.]/g, ''));
  if (!n) return 0;
  if (n <= 28) n = n * 1000;
  return n;
}

// Subs que pertenecen al grupo Peajes (muestran tab bar propio)
const PEAJES_SUBS = ['peajes', 'peajes-inter', 'concesiones'];

// ---------- Vista principal ----------
export function renderTariffTransportView(container) {
  const db = getDatabase();
  const cfg = getTariffConfig(db);

  const inPeajes = PEAJES_SUBS.includes(activeSub);

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administrador de Tarifas Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Gestione las variables operacionales y monetarias que alimentan el motor de costos (ZCAP) por ruta y tipo de camión.</p>
    </div>

    ${inPeajes ? `
    <div class="flex gap-sm mb-lg border-b border-outline-variant pb-sm overflow-x-auto" id="tt-subtabs">
      ${subTabButton('peajes',       'toll',            'Peajes Regionales')}
      ${subTabButton('peajes-inter', 'alt_route',       'Peajes Interregionales')}
      ${subTabButton('concesiones',  'account_balance', 'Administrador de Concesiones')}
    </div>` : ''}

    <div id="tt-content"></div>
  `;

  if (inPeajes) {
    document.querySelectorAll('.tt-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSub = btn.dataset.sub;
        renderSub();
      });
    });
  }

  renderSub();

  function renderSub() {
    document.querySelectorAll('.tt-subtab').forEach(btn => {
      btn.className = btn.dataset.sub === activeSub
        ? 'tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-primary text-white cursor-pointer whitespace-nowrap'
        : 'tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary hover:text-primary cursor-pointer whitespace-nowrap';
    });

    const content = document.getElementById('tt-content');
    switch (activeSub) {
      case 'peajes':         renderPeajes(content, db, cfg); break;
      case 'peajes-inter':   renderPeajesInterregionales(content, db, cfg); break;
      case 'concesiones':    renderAdminConcesiones(content, db, cfg); break;
      case 'camiones':       renderTarifasCamion(content, db, cfg); break;
      case 'combustibles':   renderCombustibles(content, db, cfg); break;
      case 'seguros':        renderSeguros(content, db, cfg); break;
      case 'costos-extras':  renderCostosExtras(content, db, cfg); break;
      case 'participacion':  renderParticipacion(content, db, cfg); break;
      case 'variables':      renderVariables(content, db, cfg); break;
      case 'resultados':
        mcTipoRuta = 'regional'; mcPagina = 0;
        renderResultados(content, db, cfg); break;
      case 'resultados-inter':
        mcTipoRuta = 'interregional'; mcPagina = 0;
        renderResultados(content, db, cfg); break;
      case 'zcap':           renderZcapView(content); break;
    }

    // Listener delegado para todas las celdas editables con data-path
    content.addEventListener('change', (e) => {
      const path = e.target.dataset.path;
      if (!path) return;
      let val = e.target.value;
      if (e.target.type === 'number') {
        val = val === '' ? 0 : Number(val);
      } else if (e.target.dataset.numeric) {
        // Parsear número con formato es-CL (punto=miles, coma=decimal)
        val = val === '' ? 0 : Number(String(val).replace(/\./g, '').replace(',', '.'));
        if (isNaN(val)) val = 0;
      }
      setPath(cfg, path, val);
      saveDatabase(db);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTOS EXTRAS — ítems adicionales por ruta y tipo de eje (BARCAZA, TRAVESÍA…)
// Se suman al motor ZCAP como ítem 1b, con ida y vuelta separados.
// ─────────────────────────────────────────────────────────────────────────────
const CE_ITEMS_SUGERIDOS = ['BARCAZA', 'TRAVESÍA', 'ACARREO', 'PEAJE ESPECIAL', 'PERNOCTE', 'ESCOLTA', 'DESCARRILAMIENTO', 'FLETE ESPECIAL'];
const CE_EJES_LABELS = { 2: '2 Ejes (5 y 10 Ton)', 3: '3 Ejes (15 y 28 Ton)' };

function renderCostosExtras(content, db, cfg) {
  const grupos  = getOrigenGroups(db);
  const routes  = (db.routes || []).filter(r => r.activo);
  db.extraCosts = db.extraCosts || [];
  const zonesById = new Map((db.transportZones || []).map(z => [z.zona, z]));

  // ── Filtros ──
  let ceFiltroCentro = window._ceFiltroCentro || '';
  let ceFiltroBuscar = window._ceFiltroBuscar || '';
  let ceFiltroEjes   = window._ceFiltroEjes   || '';

  // Zonas disponibles, opcionalmente filtradas por centro
  function getZonasList(centroGrupo) {
    let r = routes.filter(rt => rt.id_zona_transporte);
    if (centroGrupo) {
      const g = grupos.find(g => g.grupo === centroGrupo);
      const ids = g ? g.centroIds : [];
      r = r.filter(rt => ids.includes(rt.origenId) || rt.origen_grupo === centroGrupo);
    }
    const seen = new Set();
    return r
      .filter(rt => { if (seen.has(rt.id_zona_transporte)) return false; seen.add(rt.id_zona_transporte); return true; })
      .map(rt => {
        const z = zonesById.get(rt.id_zona_transporte);
        return {
          id: rt.id_zona_transporte,
          label: z ? (z.denominacion || z.comuna || rt.id_zona_transporte) : rt.id_zona_transporte
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function zonaLabel(zona_id) {
    const z = zonesById.get(zona_id);
    return z ? (z.denominacion || z.comuna || zona_id) : zona_id;
  }

  function getRows() {
    let rows = db.extraCosts.filter(c => c.activo !== false);
    if (ceFiltroCentro) {
      const zonaIds = new Set(getZonasList(ceFiltroCentro).map(z => z.id));
      rows = rows.filter(c => zonaIds.has(c.zona_id));
    }
    if (ceFiltroEjes)   rows = rows.filter(c => Number(c.ejes) === Number(ceFiltroEjes));
    if (ceFiltroBuscar) {
      const term = ceFiltroBuscar.toLowerCase();
      rows = rows.filter(c => zonaLabel(c.zona_id).toLowerCase().includes(term) || c.zona_id?.toLowerCase().includes(term));
    }
    return rows;
  }

  function rerender() {
    window._ceFiltroCentro = ceFiltroCentro;
    window._ceFiltroBuscar = ceFiltroBuscar;
    window._ceFiltroEjes   = ceFiltroEjes;
    renderCostosExtras(content, db, cfg);
  }

  const rows          = getRows();
  const totalExtras   = db.extraCosts.filter(c => c.activo !== false).length;
  const totalZonas    = [...new Set(db.extraCosts.filter(c => c.activo !== false).map(c => c.zona_id))].length;
  const sumaTotal     = rows.reduce((s, c) => s + (Number(c.costo_ida) || 0) + (Number(c.costo_vuelta) || 0), 0);
  const centrosOrigen = grupos.map(g => ({ id: g.grupo, nombre: g.nombre }));

  content.innerHTML = `
    <datalist id="ce-items-list">
      ${CE_ITEMS_SUGERIDOS.map(i => `<option value="${escapeHtml(i)}">`).join('')}
    </datalist>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">add_circle</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Costos Extras por Zona de Transporte</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Ítems de costo adicionales por <b>zona de transporte</b> y tipo de eje (BARCAZA, TRAVESÍA, escolta, etc.).
        Se aplican automáticamente a <b>cualquier ruta</b> que tenga asignada esa zona, como ítem 1b en el motor ZCAP.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Ítems Registrados</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${totalExtras}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Zonas con Costos Extras</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${totalZonas}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Total Visible (Ida + Vuelta)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-primary">${formatCLP(sumaTotal)}</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="ce-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${centrosOrigen.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === ceFiltroCentro ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">BUSCAR ZONA</label>
          <input id="ce-f-buscar" type="text" placeholder="Nombre o código de zona…" value="${escapeHtml(ceFiltroBuscar)}"
            class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">TIPO CAMIÓN</label>
          <select id="ce-f-ejes" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
            <option value="">Todos</option>
            <option value="2" ${ceFiltroEjes === '2' ? 'selected' : ''}>2 Ejes (5 y 10 Ton)</option>
            <option value="3" ${ceFiltroEjes === '3' ? 'selected' : ''}>3 Ejes (15 y 28 Ton)</option>
          </select>
        </div>
        <div class="flex-1"></div>
        <button id="ce-agregar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">add</span> Agregar Ítem
        </button>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Zona (ID)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Denominación</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ítem de Costo</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Total</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${rows.length === 0
              ? `<tr><td colspan="8" class="p-md text-center text-secondary">No hay costos extras registrados. Usa "Agregar Ítem" para crear uno.</td></tr>`
              : rows.map(ce => {
                  const total = (Number(ce.costo_ida) || 0) + (Number(ce.costo_vuelta) || 0);
                  const zLabel = zonaLabel(ce.zona_id);
                  return `<tr class="border-b border-outline-variant">
                    <td class="p-md font-data-mono text-data-mono text-secondary">${escapeHtml(ce.zona_id || '—')}</td>
                    <td class="p-md font-bold">${escapeHtml(zLabel)}</td>
                    <td class="p-md">${CE_EJES_LABELS[ce.ejes] || ce.ejes}</td>
                    <td class="p-md">
                      <span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[11px]">
                        ${escapeHtml(ce.item || '—')}
                      </span>
                    </td>
                    <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(ce.costo_ida)}</td>
                    <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(ce.costo_vuelta)}</td>
                    <td class="p-md text-right font-data-mono text-data-mono font-bold">${formatCLP(total)}</td>
                    <td class="p-md text-center flex items-center justify-center gap-sm">
                      <button class="ce-editar text-secondary hover:text-primary" data-ce-id="${escapeHtml(ce.id)}" title="Editar">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button class="ce-eliminar text-secondary hover:text-red-600" data-ce-id="${escapeHtml(ce.id)}" title="Eliminar">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Filtros
  content.querySelector('#ce-f-centro')?.addEventListener('change', e => { ceFiltroCentro = e.target.value; rerender(); });
  content.querySelector('#ce-f-ejes')?.addEventListener('change',   e => { ceFiltroEjes   = e.target.value; rerender(); });
  content.querySelector('#ce-f-buscar')?.addEventListener('input',  e => {
    const pos = e.target.selectionStart;
    ceFiltroBuscar = e.target.value; rerender();
    const inp = content.querySelector('#ce-f-buscar');
    if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
  });

  content.querySelector('#ce-agregar')?.addEventListener('click', () => abrirModalCE(null));

  content.querySelectorAll('.ce-editar').forEach(btn => {
    btn.addEventListener('click', () => {
      const ce = db.extraCosts.find(c => c.id === btn.dataset.ceId);
      if (ce) abrirModalCE(ce);
    });
  });
  content.querySelectorAll('.ce-eliminar').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar este ítem de costo extra?')) return;
      db.extraCosts = db.extraCosts.filter(c => c.id !== btn.dataset.ceId);
      saveDatabase(db);
      rerender();
    });
  });

  // ── Modal agregar / editar ──────────────────────────────────────────────────
  function abrirModalCE(ce) {
    const esNuevo = !ce;
    const zonasAll = getZonasList('');
    const el = document.createElement('div');
    el.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md';
    el.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-lg">
        <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">add_circle</span>
          <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">${esNuevo ? 'Agregar Ítem de Costo Extra' : 'Editar Ítem de Costo Extra'}</h3>
        </div>

        <div class="space-y-md">
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">ZONA DE TRANSPORTE</label>
            <select id="ce-m-zona" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
              <option value="">— Seleccionar zona —</option>
              ${zonasAll.map(z => `<option value="${escapeHtml(z.id)}" ${ce && ce.zona_id === z.id ? 'selected' : ''}>${escapeHtml(z.id)} — ${escapeHtml(z.label)}</option>`).join('')}
            </select>
            <p class="text-[11px] text-secondary mt-xs">El costo se aplicará a <b>todas las rutas</b> que tengan asignada esta zona.</p>
          </div>
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">TIPO DE CAMIÓN</label>
            <select id="ce-m-ejes" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
              <option value="2" ${!ce || Number(ce.ejes) === 2 ? 'selected' : ''}>2 Ejes — 5 Ton y 10 Ton</option>
              <option value="3" ${ce && Number(ce.ejes) === 3 ? 'selected' : ''}>3 Ejes — 15 Ton y 28 Ton</option>
            </select>
          </div>
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">ÍTEM DE COSTO</label>
            <input id="ce-m-item" list="ce-items-list" type="text" placeholder="Ej: BARCAZA, TRAVESÍA…"
              value="${escapeHtml(ce ? ce.item : '')}"
              class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md">
            <p class="text-[11px] text-secondary mt-xs">Puedes escribir cualquier etiqueta o elegir una sugerida.</p>
          </div>
          <div class="grid grid-cols-2 gap-md">
            <div>
              <label class="font-label-caps text-label-caps text-secondary block mb-xs">COSTO IDA (CLP)</label>
              <input id="ce-m-ida" type="number" min="0" step="1000"
                value="${ce ? (ce.costo_ida || 0) : 0}"
                class="w-full border border-[#CED4DA] p-sm font-data-mono text-data-mono">
            </div>
            <div>
              <label class="font-label-caps text-label-caps text-secondary block mb-xs">COSTO VUELTA (CLP)</label>
              <input id="ce-m-vuelta" type="number" min="0" step="1000"
                value="${ce ? (ce.costo_vuelta || 0) : 0}"
                class="w-full border border-[#CED4DA] p-sm font-data-mono text-data-mono">
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-sm mt-lg">
          <button id="ce-m-cancel" class="px-md py-sm rounded border border-outline text-secondary font-bold text-[12px] uppercase">Cancelar</button>
          <button id="ce-m-save" class="px-md py-sm rounded bg-primary text-white font-bold text-[12px] uppercase">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('#ce-m-cancel').addEventListener('click', () => el.remove());

    el.querySelector('#ce-m-save').addEventListener('click', () => {
      const zona_id    = el.querySelector('#ce-m-zona').value.trim();
      const ejes       = Number(el.querySelector('#ce-m-ejes').value);
      const item       = el.querySelector('#ce-m-item').value.trim().toUpperCase();
      const costo_ida  = Number(el.querySelector('#ce-m-ida').value)    || 0;
      const costo_vuelta = Number(el.querySelector('#ce-m-vuelta').value) || 0;

      if (!zona_id) { alert('Selecciona una zona de transporte.'); return; }
      if (!item)    { alert('Ingresa un ítem de costo (ej: BARCAZA).'); return; }

      const now = new Date().toISOString();
      if (esNuevo) {
        db.extraCosts.push({
          id: `ce_${zona_id}_${ejes}_${Date.now()}`,
          zona_id, ejes, item,
          costo_ida, costo_vuelta, activo: true,
          created_at: now, updated_at: now
        });
      } else {
        Object.assign(ce, { zona_id, ejes, item, costo_ida, costo_vuelta, updated_at: now });
      }

      saveDatabase(db);
      el.remove();
      rerender();
    });
  }
}

function subTabButton(key, icon, label) {
  return `<button class="tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary cursor-pointer whitespace-nowrap" data-sub="${key}">
    <span class="material-symbols-outlined text-[16px]">${icon}</span> ${label}
  </button>`;
}

// ============================================================
// SUB-MÓDULO 1: PEAJES
// ============================================================
const EJES_LABELS = { 2: '2 Ejes (5 y 10 Ton)', 3: '3 Ejes (15 y 28 Ton)' };
const PJ_DISPLAY_LIMIT = 500;

function pjGetTollRow(db, routeId, ejes) {
  return (db.routeTolls || []).find(rt => rt.route_id === routeId && Number(rt.ejes) === ejes);
}

function tollNumInput(routeId, ejes, field, value) {
  return `<input type="number" step="any" class="${inputCls}" data-toll-route="${routeId}" data-toll-ejes="${ejes}" data-toll-field="${field}" value="${value ?? 0}">`;
}

// ---------- Administrador de Concesiones ----------
const CONCESIONES_CHILE = [
  // Ruta 5 Norte
  { nombre: 'COPSA', ruta: 'Ruta 5 Norte', tramo: 'Los Vilos – La Serena', region: 'Coquimbo', tipo: 'Autopista', activa: true },
  { nombre: 'COVICORVI', ruta: 'Ruta 5 Norte', tramo: 'La Serena – Vallenar', region: 'Atacama', tipo: 'Autopista', activa: true },
  { nombre: 'Nuevo Camino', ruta: 'Ruta 5 Norte', tramo: 'Vallenar – Caldera', region: 'Atacama', tipo: 'Autopista', activa: true },
  // Ruta 5 Sur
  { nombre: 'Autopista del Itata', ruta: 'Ruta 5 Sur', tramo: 'Talca – Chillán', region: 'Maule / Ñuble', tipo: 'Autopista', activa: true },
  { nombre: 'Ruta del Maipo', ruta: 'Ruta 5 Sur', tramo: 'Chillán – Collipulli', region: 'Ñuble / La Araucanía', tipo: 'Autopista', activa: true },
  { nombre: 'COVISUR', ruta: 'Ruta 5 Sur', tramo: 'Collipulli – Temuco', region: 'La Araucanía', tipo: 'Autopista', activa: true },
  { nombre: 'Ruta de la Araucanía', ruta: 'Ruta 5 Sur', tramo: 'Temuco – Río Bueno', region: 'La Araucanía / Los Ríos', tipo: 'Autopista', activa: true },
  { nombre: 'Ruta de los Ríos', ruta: 'Ruta 5 Sur', tramo: 'Río Bueno – Puerto Montt', region: 'Los Ríos / Los Lagos', tipo: 'Autopista', activa: true },
  // RM - Autopistas Urbanas
  { nombre: 'Autopista Central', ruta: 'Ruta 5 / Norte-Sur', tramo: 'Autopista Urbana Norte-Sur', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  { nombre: 'Costanera Norte', ruta: 'Ruta 78', tramo: 'Costanera Norte expreso', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  { nombre: 'Vespucio Norte Express', ruta: 'Américo Vespucio Norte', tramo: 'Avenida Las Rejas – El Salto', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  { nombre: 'Américo Vespucio Sur Express', ruta: 'Américo Vespucio Sur', tramo: 'Lo Ovalle – Príncipe de Gales', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  { nombre: 'Autopista Vespucio Oriente', ruta: 'Américo Vespucio Oriente', tramo: 'Las Vizcachas – El Salto', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  { nombre: 'Túnel San Cristóbal', ruta: 'Ruta Sin Número', tramo: 'Providencia – Recoleta', region: 'Región Metropolitana', tipo: 'Túnel', activa: true },
  { nombre: 'Acceso Nororiente', ruta: 'Ruta G-21', tramo: 'Príncipe de Gales – Av. El Golf', region: 'Región Metropolitana', tipo: 'Urbana TAG', activa: true },
  // Ruta 68 / Valparaíso
  { nombre: 'Rutas del Pacífico', ruta: 'Ruta 68', tramo: 'Santiago – Valparaíso / Viña', region: 'Valparaíso', tipo: 'Autopista', activa: true },
  { nombre: 'Litoral Central', ruta: 'Ruta 68', tramo: 'Casablanca – Larapinta', region: 'Valparaíso', tipo: 'Autopista', activa: true },
  // Ruta 57 / Los Andes
  { nombre: 'Autopista Los Libertadores', ruta: 'Ruta 57 CH', tramo: 'Santiago – Los Andes', region: 'Valparaíso', tipo: 'Autopista', activa: true },
  // Ruta 60 / Túnel El Melón
  { nombre: 'Túnel El Melón', ruta: 'Ruta 60 CH', tramo: 'Nogales – Calera (Túnel)', region: 'Valparaíso', tipo: 'Túnel', activa: true },
  // Otras
  { nombre: 'Autopista del Sol', ruta: 'Ruta 78', tramo: 'Santiago – San Antonio', region: 'Región Metropolitana', tipo: 'Autopista', activa: true },
  { nombre: 'Variante Melipilla', ruta: 'Ruta 78', tramo: 'Santiago – Melipilla', region: 'Región Metropolitana', tipo: 'Autopista', activa: true },
];

function renderAdminConcesiones(content, db, cfg) {
  cfg.concesionesVariacion = cfg.concesionesVariacion || {};

  const regiones = [...new Set(CONCESIONES_CHILE.map(c => c.region))];

  let filtroRegion = '';
  let filtroTipo   = '';
  let filtroBuscar = '';
  let _pendingChanges = {};  // variaciones editadas aún no guardadas

  // Contar rutas afectadas por concesión (según cfg.peajes)
  function rutasAfectadas(nombreConcesion) {
    return new Set((cfg.peajes || []).filter(p => p.concesionaria === nombreConcesion).map(p => p.rutaId)).size;
  }

  function render() {
    let lista = CONCESIONES_CHILE.filter(c => {
      if (filtroRegion && c.region !== filtroRegion) return false;
      if (filtroTipo   && c.tipo   !== filtroTipo)   return false;
      if (filtroBuscar) {
        const q = filtroBuscar.toLowerCase();
        if (!c.nombre.toLowerCase().includes(q) && !c.tramo.toLowerCase().includes(q) && !c.ruta.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const tipos = [...new Set(CONCESIONES_CHILE.map(c => c.tipo))];
    const tipoBadge = t => {
      if (t === 'Urbana TAG') return '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">TAG</span>';
      if (t === 'Túnel')      return '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">TÚNEL</span>';
      return '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">AUTOPISTA</span>';
    };

    const hayVariaciones = Object.keys(cfg.concesionesVariacion).some(k => cfg.concesionesVariacion[k]);

    content.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary">account_balance</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Administrador de Concesiones de Peajes — Chile</h2>
          </div>
          <button id="con-guardar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
            <span class="material-symbols-outlined text-[18px]">save</span> Guardar Variaciones
          </button>
        </div>

        <div class="flex items-start gap-md mb-md">
          <div class="flex-1">
            <p class="text-[12px] text-secondary">
              Concesionarias consultadas por <strong>TollGuru</strong>. La columna <b>Variación Anual %</b> registra
              el aumento tarifario informado por cada concesión (Decreto MOP). Al guardar, el motor aplica
              el factor a los peajes manuales de las plazas asociadas.
            </p>
          </div>
          ${hayVariaciones ? `
          <div class="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] p-sm rounded shrink-0">
            <span class="material-symbols-outlined text-[14px] align-middle">info</span>
            Variaciones activas — afectan el Motor de Costo
          </div>` : ''}
        </div>

        <div class="flex flex-wrap gap-md items-end mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
            <select id="con-f-region" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-56">
              <option value="">Todas</option>
              ${regiones.map(r => `<option value="${escapeHtml(r)}" ${filtroRegion === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO</label>
            <select id="con-f-tipo" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-40">
              <option value="">Todos</option>
              ${tipos.map(t => `<option value="${escapeHtml(t)}" ${filtroTipo === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">BUSCAR</label>
            <input id="con-f-buscar" type="text" placeholder="Nombre, ruta o tramo..."
              value="${escapeHtml(filtroBuscar)}"
              class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
          </div>
        </div>

        <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
          <table class="w-full border-collapse text-[12px]">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Concesionaria</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tramo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Región</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rutas c/Peaje</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center" style="min-width:140px">Variación Anual %</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${lista.length === 0
                ? `<tr><td colspan="7" class="p-md text-center text-secondary">Sin resultados para los filtros seleccionados.</td></tr>`
                : lista.map((c, i) => {
                  const varActual = cfg.concesionesVariacion[c.nombre] ?? '';
                  const afectadas = rutasAfectadas(c.nombre);
                  const hasVar = varActual !== '' && Number(varActual) !== 0;
                  return `
                  <tr class="border-b border-outline-variant ${i % 2 === 0 ? '' : 'bg-surface-container-lowest'}">
                    <td class="p-md font-bold text-on-surface">${escapeHtml(c.nombre)}</td>
                    <td class="p-md font-data-mono text-data-mono text-secondary">${escapeHtml(c.ruta)}</td>
                    <td class="p-md">${escapeHtml(c.tramo)}</td>
                    <td class="p-md text-secondary">${escapeHtml(c.region)}</td>
                    <td class="p-md">${tipoBadge(c.tipo)}</td>
                    <td class="p-md text-right">
                      ${afectadas > 0
                        ? `<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-secondary">${afectadas}</span>`
                        : '<span class="text-secondary">—</span>'}
                    </td>
                    <td class="p-md text-center">
                      <div class="flex items-center justify-center gap-xs">
                        <input
                          type="number" step="0.1" min="0" max="100"
                          placeholder="0.0"
                          value="${escapeHtml(String(varActual))}"
                          data-nombre="${escapeHtml(c.nombre)}"
                          class="con-var-input border border-[#CED4DA] p-xs font-data-mono text-data-mono bg-white w-20 text-right ${hasVar ? 'border-amber-400 bg-amber-50' : ''}">
                        <span class="text-secondary font-bold">%</span>
                        ${hasVar ? `<span class="inline-flex px-1 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">+${Number(varActual).toFixed(1)}%</span>` : ''}
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-secondary mt-sm">
          La variación se aplica a los <b>peajes manuales</b> registrados en la pestaña Peajes Regionales que tengan asignada la concesionaria.
          Los peajes calculados por TollGuru reflejan precios actuales de la API.
        </p>
      </div>
    `;

    // Filtros
    content.querySelector('#con-f-region')?.addEventListener('change', e => { filtroRegion = e.target.value; render(); });
    content.querySelector('#con-f-tipo')?.addEventListener('change',   e => { filtroTipo   = e.target.value; render(); });
    content.querySelector('#con-f-buscar')?.addEventListener('input',  e => {
      const pos = e.target.selectionStart;
      filtroBuscar = e.target.value; render();
      const inp = content.querySelector('#con-f-buscar');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    });

    // Inputs de variación: acumular cambios sin perder foco
    content.querySelectorAll('.con-var-input').forEach(inp => {
      inp.addEventListener('change', e => {
        _pendingChanges[e.target.dataset.nombre] = e.target.value === '' ? null : Number(e.target.value);
      });
    });

    // Guardar
    content.querySelector('#con-guardar')?.addEventListener('click', () => {
      // Leer todos los inputs visibles + cambios pendientes
      content.querySelectorAll('.con-var-input').forEach(inp => {
        _pendingChanges[inp.dataset.nombre] = inp.value === '' ? null : Number(inp.value);
      });
      Object.entries(_pendingChanges).forEach(([nombre, val]) => {
        if (val === null || val === 0) {
          delete cfg.concesionesVariacion[nombre];
        } else {
          cfg.concesionesVariacion[nombre] = val;
        }
      });
      _pendingChanges = {};
      saveDatabase(db);
      showAlert('✓ Variaciones de concesiones guardadas');
      render();
    });
  }

  render();
}

// Vista combinada: cálculo automático (route_tolls) + registro manual (cfg.peajes)
function renderPeajes(content, db, cfg) {
  renderPeajesAuto(content, db, cfg);
}

// ---------- Cálculo Automático de Peajes (Google Routes API) ----------
function renderPeajesAuto(content, db, cfg) {
  // Solo rutas Regionales tipo COMUNA (campo tipo de la ruta)
  const routes = (db.routes || []).filter(r => r.activo && r.clasificRuta === 'Regional' && (r.tipo || '').toUpperCase() === 'COMUNA');

  const grupos = getOrigenGroups(db);
  const centrosOrigen = grupos.map(g => ({ id: g.grupo, nombre: g.nombre }));

  // Comunas filtradas por centro seleccionado (solo las comunas de las rutas del centro)
  const zonesById = new Map((db.transportZones || []).map(z => [z.zona, z]));
  const routesParaComuna = pjFiltroCentro
    ? (() => { const g = grupos.find(g => g.grupo === pjFiltroCentro); return g ? routes.filter(r => r.origen_grupo ? r.origen_grupo === g.grupo : g.centroIds.includes(r.origenId)) : routes; })()
    : routes;
  const comunasDisponibles = [...new Map(
    routesParaComuna
      .map(r => { const z = zonesById.get(r.id_zona_transporte); return z ? { id: z.zona, label: z.denominacion || z.zona } : null; })
      .filter(Boolean)
      .map(c => [c.id, c])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));

  let rows = [];
  routes.forEach(ruta => {
    [2, 3].forEach(ejes => {
      rows.push({ ruta, ejes, toll: pjGetTollRow(db, ruta.id, ejes) });
    });
  });

  if (pjFiltroComuna) {
    rows = rows.filter(r => r.ruta.id_zona_transporte === pjFiltroComuna);
  }
  if (pjFiltroCentro) {
    const g = grupos.find(g => g.grupo === pjFiltroCentro);
    if (g) rows = rows.filter(r => r.ruta.origen_grupo ? r.ruta.origen_grupo === g.grupo : g.centroIds.includes(r.ruta.origenId));
  }
  // KPIs: contar sobre las filas ya filtradas por centro/comuna (sin aplicar pendientes/revision)
  const rowsBase = rows;
  const rutasBase = [...new Set(rowsBase.map(r => r.ruta.id))];
  const pendientesCount = rowsBase.filter(r => !r.toll || !r.toll.calculado_en).length;
  const revisionCount  = rowsBase.filter(r => r.toll && r.toll.needs_review).length;
  const rutasCount     = rutasBase.length;
  const combinaciones  = rowsBase.length;

  if (pjFiltroRevision) {
    rows = rows.filter(r => r.toll && r.toll.needs_review);
  } else if (pjFiltroPendientes) {
    rows = rows.filter(r => !r.toll || !r.toll.calculado_en);
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, PJ_DISPLAY_LIMIT);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">toll</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Peajes por Ruta — Cálculo Automático</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Costos de peaje para rutas Regionales con zona Comuna. KM mostrado es de ida (un solo sentido).
        El cálculo se ejecuta a demanda y queda registrado en cache para no repetirse.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-md mb-md">
        <button id="pj-kpi-todas" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${!pjFiltroPendientes && !pjFiltroRevision ? 'ring-2 ring-primary' : ''}">
          <p class="font-label-caps text-label-caps text-secondary">Rutas Registradas</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${rutasCount}</p>
        </button>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Combinaciones (Ruta × Tipo Camión)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${combinaciones}</p>
        </div>
        <button id="pj-kpi-pendientes" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${pjFiltroPendientes ? 'ring-2 ring-primary' : ''}">
          <p class="font-label-caps text-label-caps text-secondary">Sin Calcular</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${pendientesCount}</p>
        </button>
        <button id="pj-kpi-revision" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${pjFiltroRevision ? 'ring-2 ring-primary' : ''}">
          <p class="font-label-caps text-label-caps text-secondary">Para Revisión</p>
          <p class="font-headline-sm text-headline-sm font-bold ${revisionCount > 0 ? 'text-primary' : 'text-on-surface'}">${revisionCount}</p>
        </button>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
          <select id="pj-f-comuna" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
            <option value="">Todas</option>
            ${comunasDisponibles.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === pjFiltroComuna ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="pj-f-origen" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${centrosOrigen.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === pjFiltroCentro ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary flex items-center gap-xs cursor-pointer">
            <input type="checkbox" id="pj-f-pend" ${pjFiltroPendientes ? 'checked' : ''}> SOLO PENDIENTES / REVISIÓN
          </label>
        </div>
        <div class="flex-1"></div>
        <button id="pj-carga-comuna" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">upload_file</span> Carga Masiva por Comuna
        </button>
        <button id="pj-export" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">download</span> Exportar CSV
        </button>
        <button id="pj-export-cache" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">save_alt</span> Exportar Cache API
        </button>
        <button id="pj-import-cache" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">upload</span> Importar Cache API
        </button>
        <input type="file" id="pj-import-cache-input" accept=".csv" class="hidden">
        <button id="pj-calcular" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">calculate</span> Calcular Peajes
        </button>
        <button id="pj-batch" class="bg-[#2d3748] hover:bg-[#1a202c] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">playlist_add_check</span> Procesar Lote
        </button>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md"><input type="checkbox" id="pj-check-all" title="Seleccionar todas"></th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Origen</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${displayRows.length === 0 ? `<tr><td colspan="10" class="p-md text-center text-secondary">No hay rutas que coincidan con los filtros.</td></tr>` :
              displayRows.map(({ ruta, ejes, toll }) => {
                const grupo = (grupos.find(g => g.grupo === ruta.origen_grupo) || grupos.find(g => g.centroIds.includes(ruta.origenId)));
                const origenNombre = grupo ? grupo.nombre : (getCentreName(db, ruta.origenId) || '');
                const kmTotal = ruta.km != null ? ruta.km.toFixed(1) + ' KM' : '—';
                let estado;
                if (!toll || !toll.calculado_en) {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN CALCULAR</span>`;
                } else if (toll.notFound || toll.not_found) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 text-amber-800 font-label-caps text-[10px]" title="Destino no encontrado — ajustar coordenadas de la ruta"><span class="material-symbols-outlined text-[14px]">location_off</span> REVISIÓN</span>`;
                } else if (toll.needs_review) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">error</span> ERROR</span>`;
                } else {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">PEAJE CALCULADO</span>`;
                }
                const isNotFound = toll && (toll.notFound || toll.not_found);
                const trCls = isNotFound ? 'border-b border-outline-variant bg-amber-50' : toll && toll.needs_review ? 'border-b border-outline-variant bg-red-50' : 'border-b border-outline-variant';
                return `<tr class="${trCls}">
                  <td class="p-md"><input type="checkbox" class="pj-row-check" data-route-id="${escapeHtml(ruta.id)}"></td>
                  <td class="p-md font-bold">${escapeHtml(ruta.codigo || '')}</td>
                  <td class="p-md">${escapeHtml(origenNombre)}</td>
                  <td class="p-md">${escapeHtml(ruta.destino || '')}</td>
                  <td class="p-md">${EJES_LABELS[ejes]}</td>
                  <td class="p-md w-32">
                    ${tollNumInput(ruta.id, ejes, 'peaje_ida', toll ? toll.peaje_ida : 0)}
                    ${toll && (toll.mainline_ida || toll.ramp_ida || toll.electronic_ida) ? `<div class="text-[10px] text-secondary mt-1 leading-tight">
                      ${toll.mainline_ida   ? `<span title="Troncal">T:${formatCLP(toll.mainline_ida)}</span> ` : ''}${toll.ramp_ida ? `<span title="Lateral">L:${formatCLP(toll.ramp_ida)}</span> ` : ''}${toll.electronic_ida ? `<span title="TAG">E:${formatCLP(toll.electronic_ida)}</span>` : ''}
                    </div>` : ''}
                  </td>
                  <td class="p-md w-32">
                    ${tollNumInput(ruta.id, ejes, 'peaje_vuelta', toll ? toll.peaje_vuelta : 0)}
                    ${toll && (toll.mainline_vuelta || toll.ramp_vuelta || toll.electronic_vuelta) ? `<div class="text-[10px] text-secondary mt-1 leading-tight">
                      ${toll.mainline_vuelta   ? `<span title="Troncal">T:${formatCLP(toll.mainline_vuelta)}</span> ` : ''}${toll.ramp_vuelta ? `<span title="Lateral">L:${formatCLP(toll.ramp_vuelta)}</span> ` : ''}${toll.electronic_vuelta ? `<span title="TAG">E:${formatCLP(toll.electronic_vuelta)}</span>` : ''}
                    </div>` : ''}
                  </td>
                  <td class="p-md text-right font-data-mono text-data-mono">${kmTotal}</td>
                  <td class="p-md text-center">${estado}</td>
                  <td class="p-md text-center">
                    <button class="pj-calc-row text-secondary hover:text-primary" data-calc-route="${escapeHtml(ruta.id)}" title="Calcular peaje de esta ruta">
                      <span class="material-symbols-outlined text-[18px]">calculate</span>
                    </button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      ${totalRows > PJ_DISPLAY_LIMIT ? `<p class="text-[11px] text-secondary mt-sm">Mostrando ${PJ_DISPLAY_LIMIT} de ${totalRows} resultados. Use los filtros para acotar la búsqueda.</p>` : ''}
    </div>
  `;

  content.querySelectorAll('[data-toll-route]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const routeId = e.target.dataset.tollRoute;
      const ejes = Number(e.target.dataset.tollEjes);
      const field = e.target.dataset.tollField;
      const val = e.target.value === '' ? 0 : Number(e.target.value);
      let row = pjGetTollRow(db, routeId, ejes);
      if (!row) {
        row = { id: `tj_${routeId}_${ejes}`, route_id: routeId, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false, calculado_en: new Date().toISOString() };
        db.routeTolls = db.routeTolls || [];
        db.routeTolls.push(row);
      }
      row[field] = val;
      row.needs_review = false; // edición manual = revisado
      row.updated_at = new Date().toISOString();
      saveDatabase(db);
    });
  });

  document.getElementById('pj-f-comuna').addEventListener('change', (e) => { pjFiltroComuna = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-origen').addEventListener('change', (e) => { pjFiltroCentro = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-pend').addEventListener('change', (e) => { pjFiltroPendientes = e.target.checked; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-kpi-todas').addEventListener('click', () => { pjFiltroPendientes = false; pjFiltroRevision = false; pjFiltroComuna = ''; pjFiltroCentro = ''; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-kpi-pendientes').addEventListener('click', () => { pjFiltroPendientes = !pjFiltroPendientes; if (pjFiltroPendientes) pjFiltroRevision = false; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-kpi-revision').addEventListener('click', () => { pjFiltroRevision = !pjFiltroRevision; if (pjFiltroRevision) pjFiltroPendientes = false; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-export').addEventListener('click', () => exportPeajesCSV(db, rows));
  document.getElementById('pj-export-cache').addEventListener('click', () => exportRouteTollsCSV(db));
  document.getElementById('pj-import-cache').addEventListener('click', () => document.getElementById('pj-import-cache-input').click());
  document.getElementById('pj-import-cache-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importRouteTollsCSV(e.target.files[0], db);
    e.target.value = '';
  });
  document.getElementById('pj-carga-comuna').addEventListener('click', () => abrirModalCargaPeajesComuna(content, db, cfg));

  // Select-all checkbox
  document.getElementById('pj-check-all').addEventListener('change', (e) => {
    content.querySelectorAll('.pj-row-check').forEach(cb => { cb.checked = e.target.checked; });
  });

  // Calcular Peajes: solo rutas seleccionadas, o todas las filtradas si ninguna seleccionada
  document.getElementById('pj-calcular').addEventListener('click', () => {
    const checked = [...content.querySelectorAll('.pj-row-check:checked')].map(cb => cb.dataset.routeId);
    let rutasTarget;
    if (checked.length > 0) {
      rutasTarget = [...new Set(checked)].map(id => routes.find(r => r.id === id)).filter(Boolean);
    } else {
      rutasTarget = [...new Set(rows.map(r => r.ruta))];
    }
    calcularPeajes(content, db, cfg, rutasTarget);
  });

  document.getElementById('pj-batch').addEventListener('click', () => {
    const pendientes = routes.filter(r => {
      const hasToll = [2, 3].every(ejes => {
        const t = pjGetTollRow(db, r.id, ejes);
        return t && t.calculado_en && !t.needs_review;
      });
      return !hasToll;
    });
    if (pendientes.length === 0) {
      showAlert('Todas las rutas tienen peajes calculados. No hay pendientes.', 'info');
      return;
    }
    if (!confirm(`Procesar ${pendientes.length} ruta(s) pendientes en lote?\n\nLas rutas se procesarán secuencialmente con un breve intervalo.`)) return;
    calcularPeajes(content, db, cfg, pendientes);
  });

  content.querySelectorAll('[data-calc-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ruta = routes.find(r => r.id === btn.dataset.calcRoute);
      // force: true — el usuario pidió explícitamente recalcular esta ruta, ignorar caché
      if (ruta) calcularPeajes(content, db, cfg, [ruta], { force: true });
    });
  });
}
// ============================================================
// SUB-MÓDULO 1b: PEAJES INTERREGIONALES
// ============================================================
function renderPeajesInterregionales(content, db, cfg) {
  // Solo rutas Interregionales tipo COMUNA (campo tipo de la ruta)
  const routes = (db.routes || []).filter(r => r.activo && r.clasificRuta === 'Interregional' && (r.tipo || '').toUpperCase() === 'COMUNA');

  const grupos = getOrigenGroups(db);
  const centrosOrigen = grupos.map(g => ({ id: g.grupo, nombre: g.nombre }));

  // Comunas filtradas por centro seleccionado
  const zonesById_i = new Map((db.transportZones || []).map(z => [z.zona, z]));
  const routesParaComuna_i = pjiFiltroCentro
    ? (() => { const g = grupos.find(g => g.grupo === pjiFiltroCentro); return g ? routes.filter(r => r.origen_grupo ? r.origen_grupo === g.grupo : g.centroIds.includes(r.origenId)) : routes; })()
    : routes;
  const comunasDisponibles = [...new Map(
    routesParaComuna_i
      .map(r => { const z = zonesById_i.get(r.id_zona_transporte); return z ? { id: z.zona, label: z.denominacion || z.zona } : null; })
      .filter(Boolean)
      .map(c => [c.id, c])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));

  let rows = [];
  routes.forEach(ruta => {
    [2, 3].forEach(ejes => {
      rows.push({ ruta, ejes, toll: pjGetTollRow(db, ruta.id, ejes) });
    });
  });

  if (pjiFiltroComuna) {
    rows = rows.filter(r => r.ruta.id_zona_transporte === pjiFiltroComuna);
  }
  if (pjiFiltroCentro) {
    const g = grupos.find(g => g.grupo === pjiFiltroCentro);
    if (g) rows = rows.filter(r => r.ruta.origen_grupo ? r.ruta.origen_grupo === g.grupo : g.centroIds.includes(r.ruta.origenId));
  }
  // KPIs: contar sobre las filas ya filtradas por centro/comuna
  const rowsBase = rows;
  const rutasBase = [...new Set(rowsBase.map(r => r.ruta.id))];
  const pendientesCount = rowsBase.filter(r => !r.toll || !r.toll.calculado_en).length;
  const revisionCount  = rowsBase.filter(r => r.toll && r.toll.needs_review).length;
  const rutasCount     = rutasBase.length;
  const combinaciones  = rowsBase.length;

  if (pjiFiltroRevision) {
    rows = rows.filter(r => r.toll && r.toll.needs_review);
  } else if (pjiFiltroPendientes) {
    rows = rows.filter(r => !r.toll || !r.toll.calculado_en);
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, PJ_DISPLAY_LIMIT);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">alt_route</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Peajes Interregionales</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Costos de peaje para rutas Interregionales + Comuna. KM mostrado es de ida (un solo sentido).
        El cálculo se ejecuta a demanda y queda registrado en cache para no repetirse.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-md mb-md">
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Rutas Registradas</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${rutasCount}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Combinaciones (Ruta × Tipo Camión)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${combinaciones}</p>
        </div>
        <button id="pji-kpi-pendientes" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${pjiFiltroPendientes ? 'ring-2 ring-primary' : ''}">
          <p class="font-label-caps text-label-caps text-secondary">Sin Calcular</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${pendientesCount}</p>
        </button>
        <button id="pji-kpi-revision" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${pjiFiltroRevision ? 'ring-2 ring-primary' : ''}">
          <p class="font-label-caps text-label-caps text-secondary">Para Revisión</p>
          <p class="font-headline-sm text-headline-sm font-bold ${revisionCount > 0 ? 'text-primary' : 'text-on-surface'}">${revisionCount}</p>
        </button>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
          <select id="pji-f-comuna" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
            <option value="">Todas</option>
            ${comunasDisponibles.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === pjiFiltroComuna ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="pji-f-origen" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${centrosOrigen.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === pjiFiltroCentro ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary flex items-center gap-xs cursor-pointer">
            <input type="checkbox" id="pji-f-pend" ${pjiFiltroPendientes ? 'checked' : ''}> SOLO PENDIENTES / REVISIÓN
          </label>
        </div>
        <div class="flex-1"></div>
        <button id="pji-export-cache" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">save_alt</span> Exportar Cache API
        </button>
        <button id="pji-import-cache" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">upload</span> Importar Cache API
        </button>
        <input type="file" id="pji-import-cache-input" accept=".csv" class="hidden">
        <button id="pji-calcular" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">calculate</span> Calcular Peajes
        </button>
        <button id="pji-batch" class="bg-[#2d3748] hover:bg-[#1a202c] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">playlist_add_check</span> Procesar Lote
        </button>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md"><input type="checkbox" id="pji-check-all" title="Seleccionar todas"></th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Origen</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${displayRows.length === 0 ? `<tr><td colspan="10" class="p-md text-center text-secondary">No hay rutas interregionales que coincidan con los filtros.</td></tr>` :
              displayRows.map(({ ruta, ejes, toll }) => {
                const grupo = (grupos.find(g => g.grupo === ruta.origen_grupo) || grupos.find(g => g.centroIds.includes(ruta.origenId)));
                const origenNombre = grupo ? grupo.nombre : (getCentreName(db, ruta.origenId) || '');
                const kmTotal = ruta.km != null ? ruta.km.toFixed(1) + ' KM' : '—';
                let estado;
                if (!toll || !toll.calculado_en) {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN CALCULAR</span>`;
                } else if (toll.notFound || toll.not_found) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 text-amber-800 font-label-caps text-[10px]" title="Destino no encontrado — ajustar coordenadas de la ruta"><span class="material-symbols-outlined text-[14px]">location_off</span> REVISIÓN</span>`;
                } else if (toll.needs_review) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">error</span> ERROR</span>`;
                } else {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">PEAJE CALCULADO</span>`;
                }
                const isNotFound = toll && (toll.notFound || toll.not_found);
                const trCls = isNotFound ? 'border-b border-outline-variant bg-amber-50' : toll && toll.needs_review ? 'border-b border-outline-variant bg-red-50' : 'border-b border-outline-variant';
                return `<tr class="${trCls}">
                  <td class="p-md"><input type="checkbox" class="pji-row-check" data-route-id="${escapeHtml(ruta.id)}"></td>
                  <td class="p-md font-bold">${escapeHtml(ruta.codigo || '')}</td>
                  <td class="p-md">${escapeHtml(origenNombre)}</td>
                  <td class="p-md">${escapeHtml(ruta.destino || '')}</td>
                  <td class="p-md">${EJES_LABELS[ejes]}</td>
                  <td class="p-md w-32">${tollNumInput(ruta.id, ejes, 'peaje_ida', toll ? toll.peaje_ida : 0)}</td>
                  <td class="p-md w-32">${tollNumInput(ruta.id, ejes, 'peaje_vuelta', toll ? toll.peaje_vuelta : 0)}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${kmTotal}</td>
                  <td class="p-md text-center">${estado}</td>
                  <td class="p-md text-center">
                    <button class="pji-calc-row text-secondary hover:text-primary" data-calc-route="${escapeHtml(ruta.id)}" title="Calcular peaje de esta ruta">
                      <span class="material-symbols-outlined text-[18px]">calculate</span>
                    </button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      ${totalRows > PJ_DISPLAY_LIMIT ? `<p class="text-[11px] text-secondary mt-sm">Mostrando ${PJ_DISPLAY_LIMIT} de ${totalRows} resultados. Use los filtros para acotar la búsqueda.</p>` : ''}
    </div>
  `;

  content.querySelectorAll('[data-toll-route]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const routeId = e.target.dataset.tollRoute;
      const ejes = Number(e.target.dataset.tollEjes);
      const field = e.target.dataset.tollField;
      const val = e.target.value === '' ? 0 : Number(e.target.value);
      let row = pjGetTollRow(db, routeId, ejes);
      if (!row) {
        row = { id: `tj_${routeId}_${ejes}`, route_id: routeId, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false, calculado_en: new Date().toISOString() };
        db.routeTolls = db.routeTolls || [];
        db.routeTolls.push(row);
      }
      row[field] = val;
      // IDA → replica automáticamente a VUELTA
      if (field === 'peaje_ida') {
        row.peaje_vuelta = val;
        const vueltaInp = content.querySelector(`[data-toll-route="${routeId}"][data-toll-ejes="${ejes}"][data-toll-field="peaje_vuelta"]`);
        if (vueltaInp) vueltaInp.value = val;
      }
      row.needs_review = false;
      row.updated_at = new Date().toISOString();
      saveDatabase(db);
    });
  });

  document.getElementById('pji-f-comuna').addEventListener('change', (e) => { pjiFiltroComuna = e.target.value; renderPeajesInterregionales(content, db, cfg); });
  document.getElementById('pji-f-origen').addEventListener('change', (e) => { pjiFiltroCentro = e.target.value; renderPeajesInterregionales(content, db, cfg); });
  document.getElementById('pji-f-pend').addEventListener('change', (e) => { pjiFiltroPendientes = e.target.checked; renderPeajesInterregionales(content, db, cfg); });
  document.getElementById('pji-kpi-pendientes').addEventListener('click', () => { pjiFiltroPendientes = !pjiFiltroPendientes; if (pjiFiltroPendientes) pjiFiltroRevision = false; renderPeajesInterregionales(content, db, cfg); });
  document.getElementById('pji-kpi-revision').addEventListener('click', () => { pjiFiltroRevision = !pjiFiltroRevision; if (pjiFiltroRevision) pjiFiltroPendientes = false; renderPeajesInterregionales(content, db, cfg); });
  document.getElementById('pji-export-cache').addEventListener('click', () => exportRouteTollsCSV(db));
  document.getElementById('pji-import-cache').addEventListener('click', () => document.getElementById('pji-import-cache-input').click());
  document.getElementById('pji-import-cache-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importRouteTollsCSV(e.target.files[0], db);
    e.target.value = '';
  });

  document.getElementById('pji-check-all').addEventListener('change', (e) => {
    content.querySelectorAll('.pji-row-check').forEach(cb => { cb.checked = e.target.checked; });
  });

  document.getElementById('pji-calcular').addEventListener('click', () => {
    const checked = [...content.querySelectorAll('.pji-row-check:checked')].map(cb => cb.dataset.routeId);
    let rutasTarget;
    if (checked.length > 0) {
      rutasTarget = [...new Set(checked)].map(id => routes.find(r => r.id === id)).filter(Boolean);
    } else {
      rutasTarget = [...new Set(rows.map(r => r.ruta))];
    }
    calcularPeajes(content, db, cfg, rutasTarget, { renderFn: renderPeajesInterregionales });
  });

  document.getElementById('pji-batch').addEventListener('click', () => {
    const pendientes = routes.filter(r => {
      const hasToll = [2, 3].every(ejes => {
        const t = pjGetTollRow(db, r.id, ejes);
        return t && t.calculado_en && !t.needs_review;
      });
      return !hasToll;
    });
    if (pendientes.length === 0) {
      showAlert('Todas las rutas tienen peajes calculados. No hay pendientes.', 'info');
      return;
    }
    if (!confirm(`Procesar ${pendientes.length} ruta(s) pendientes en lote?\n\nLas rutas se procesarán secuencialmente con un breve intervalo.`)) return;
    calcularPeajes(content, db, cfg, pendientes, { renderFn: renderPeajesInterregionales });
  });

  content.querySelectorAll('.pji-calc-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const ruta = routes.find(r => r.id === btn.dataset.calcRoute);
      if (ruta) calcularPeajes(content, db, cfg, [ruta], { renderFn: renderPeajesInterregionales });
    });
  });
}

// Mapeo ejes → tipos de camión individuales para el CSV de exportación.
// Un camión de 2 ejes (CAMION_2_EJES) cubre capacidades 5T y 10T.
// Un camión de 3 ejes (CAMION_PESADO) cubre capacidades 15T y 28T.
const EJES_TO_TIPOS = {
  2: ['5T', '10T'],
  3: ['15T', '28T']
};

function exportPeajesCSV(db, rows) {
  const grupos  = getOrigenGroups(db);
  const headers = ['RUTA', 'ORIGEN', 'DESTINO', 'TIPO_CAMION', 'PEAJE_IDA', 'PEAJE_VUELTA'];
  const data = [];
  for (const { ruta, ejes, toll } of rows) {
    const grupo  = (grupos.find(g => g.grupo === ruta.origen_grupo) || grupos.find(g => g.centroIds.includes(ruta.origenId)));
    const origen = grupo ? grupo.nombre : (getCentreName(db, ruta.origenId) || '');
    const ida    = toll ? Math.round(toll.peaje_ida    || 0) : 0;
    const vuelta = toll ? Math.round(toll.peaje_vuelta || 0) : 0;
    // Expandir a una fila por cada tipo de camión individual
    for (const tipo of (EJES_TO_TIPOS[ejes] || [EJES_LABELS[ejes]])) {
      data.push([ruta.codigo, origen, ruta.destino || '', tipo, ida, vuelta]);
    }
  }
  downloadFile(`peajes_rutas_${Date.now()}.csv`, toCSV(headers, data));
  showAlert('Archivo CSV de peajes exportado');
}

function exportRouteTollsCSV(db) {
  const tolls = db.routeTolls || [];
  if (tolls.length === 0) {
    showAlert('No hay datos en cache de API para exportar.', 'info');
    return;
  }
  const headers = ['ROUTE_ID', 'EJES', 'PEAJE_IDA', 'PEAJE_VUELTA', 'KM_IDA', 'KM_VUELTA', 'NEEDS_REVIEW', 'CALCULADO_EN'];
  const data = tolls.map(t => [
    t.route_id,
    t.ejes,
    Math.round(t.peaje_ida || 0),
    Math.round(t.peaje_vuelta || 0),
    t.km_ida != null ? t.km_ida : '',
    t.km_vuelta != null ? t.km_vuelta : '',
    t.needs_review ? 1 : 0,
    t.calculado_en || ''
  ]);
  downloadFile(`route_tolls_cache_${Date.now()}.csv`, toCSV(headers, data));
  showAlert(`Cache API exportado: ${data.length} registros.`);
}

function importRouteTollsCSV(file, db) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = new TextDecoder('utf-8').decode(e.target.result);
      const rows = parseCSV(text);
      if (rows.length === 0) {
        showAlert('El archivo CSV está vacío.', 'error');
        return;
      }
      db.routeTolls = db.routeTolls || [];
      let importados = 0;
      rows.forEach(row => {
        const routeId = (getField(row, 'route_id', 'ROUTE_ID') || '').trim();
        const ejes = Number(getField(row, 'ejes', 'EJES'));
        if (!routeId || !ejes) return;
        let existing = db.routeTolls.find(rt => rt.route_id === routeId && Number(rt.ejes) === ejes);
        if (!existing) {
          existing = { id: `tj_${routeId}_${ejes}`, route_id: routeId, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false };
          db.routeTolls.push(existing);
        }
        existing.peaje_ida = Number(getField(row, 'peaje_ida', 'PEAJE_IDA')) || 0;
        existing.peaje_vuelta = Number(getField(row, 'peaje_vuelta', 'PEAJE_VUELTA')) || 0;
        const kmIda = Number(getField(row, 'km_ida', 'KM_IDA'));
        const kmVuelta = Number(getField(row, 'km_vuelta', 'KM_VUELTA'));
        if (!isNaN(kmIda)) existing.km_ida = kmIda;
        if (!isNaN(kmVuelta)) existing.km_vuelta = kmVuelta;
        existing.needs_review = Number(getField(row, 'needs_review', 'NEEDS_REVIEW')) === 1;
        existing.calculado_en = getField(row, 'calculado_en', 'CALCULADO_EN') || new Date().toISOString();
        existing.updated_at = new Date().toISOString();
        importados++;
      });
      saveDatabase(db, { syncOnly: ['routeTolls'] });
      showAlert(`Cache API importado: ${importados} registros actualizados/insertados.`);
    } catch (err) {
      showAlert('Error al importar cache: ' + (err.message || err), 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Construye el parámetro de ubicación para GetAPI Chile en formato
 * "NombreComuna, NombreRegion" a partir de objetos con propiedades
 * { comuna, region }. Esto elimina diccionarios hardcoded y usa
 * directamente los campos estructurados de la base de datos.
 *
 * Ejemplo:
 *   construirParametrosRuta(
 *     { comuna: 'Quilicura', region: 'Metropolitana' },
 *     { comuna: 'Loncoche',  region: 'La Araucanía'  }
 *   )
 *   → { origin: 'Quilicura, Metropolitana', destination: 'Loncoche, La Araucanía' }
 *
 * La codificación URL la maneja el Edge Function con URLSearchParams.
 */
// Mapea nombres oficiales largos de regiones a la forma corta que reconoce GetAPI.
const REGION_ALIAS = {
  "Libertador General Bernardo O'Higgins": "O'Higgins",
  'Metropolitana de Santiago':             'Metropolitana',
  'Magallanes y de la Antártica Chilena':  'Magallanes',
};
function normalizarRegion(region) {
  if (!region) return region;
  const r = String(region).trim();
  return REGION_ALIAS[r] ?? r;
}

function construirParametrosRuta(origenObj, destinoObj) {
  const fmt = (obj) => {
    const partes = [obj.comuna, normalizarRegion(obj.region)].filter(Boolean).map(s => String(s).trim());
    return partes.join(', ');
  };
  return {
    origin:      fmt(origenObj),
    destination: fmt(destinoObj)
  };
}

// Invoca la Edge Function 'tollguru-tolls' (proxy hacia TollGuru API v1).
// Fallback para rutas donde GetAPI retornó 0 o needs_review.
// Respuesta: { tollCLP, tagCLP, distanceMeters, hasToll, tollsCount, tolls[], source:'tollguru' }
async function callTollGuruTolls(originCity, destCity, category, destLat, destLon) {
  const { data, error } = await supabase.functions.invoke('tollguru-tolls', {
    body: { originCity, destCity, category, destLat: destLat || null, destLon: destLon || null }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}

// Invoca la Edge Function 'getapi-tolls' (proxy hacia chile.getapi.cl).
// category: 'CAMION_2_EJES' | 'CAMION_PESADO'
// Respuesta: { tollCLP, mainlineCLP, rampCLP, electronicCLP, hasToll, tollsCount, tolls[], notFound? }
async function callGetApiTolls(originCity, destCity, category) {
  const { data, error } = await supabase.functions.invoke('getapi-tolls', {
    body: { originCity, destCity, category }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function callGoogleDistance(originLat, originLng, destLat, destLng) {
  const { data, error } = await supabase.functions.invoke('google-distance', {
    body: { originLat, originLng, destLat, destLng }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data; // { distanceKm, durationMin, distanceText, durationText }
}

// Prefiltro Google Routes API v2: detecta si una ruta tiene peajes SIN llamar a TollGuru.
// Retorna { hasTolls, distanceKm }. Si hasTolls=false → peaje=$0, no se llama TollGuru.
async function callGoogleTollCheck(originCity, destCity) {
  const { data, error } = await supabase.functions.invoke('google-toll-check', {
    body: { origin: originCity, destination: destCity }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data; // { hasTolls, distanceKm }
}

// Crea o actualiza la fila route_tolls para (routeId, ejes) con los resultados
// de ida/vuelta. Si opts.error, marca la fila para revisión sin tocar valores.
// Guarda además el desglose por tipo: mainline (Troncal), ramp (Lateral), electronic (TAG).
function pjUpsertToll(db, routeId, ejes, ida, vuelta, opts = {}) {
  db.routeTolls = db.routeTolls || [];
  let row = db.routeTolls.find(rt => rt.route_id === routeId && Number(rt.ejes) === ejes);
  if (!row) {
    row = { id: `tj_${routeId}_${ejes}`, route_id: routeId, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false };
    db.routeTolls.push(row);
  }
  const now = new Date().toISOString();
  if (opts.error) {
    row.needs_review = true;
    row.calculado_en = now;
    row.updated_at = now;
    return row;
  }
  // Soporta formato TollGuru ({ tollCLP }) y formato legacy GetAPI ({ tollCLP })
  row.peaje_ida    = ida    ? Math.round(ida.tollCLP    || 0) : 0;
  row.peaje_vuelta = vuelta ? Math.round(vuelta.tollCLP || 0) : 0;
  // KM: TollGuru retorna distanceMeters directo; también acepta distance_km * 1000
  const idaM   = ida    ? (ida.distanceMeters    ?? (ida.distance_km    != null ? ida.distance_km    * 1000 : null)) : null;
  const vueltaM = vuelta ? (vuelta.distanceMeters ?? (vuelta.distance_km != null ? vuelta.distance_km * 1000 : null)) : null;
  row.km_ida    = idaM    != null ? Math.round(idaM    / 100) / 10 : null;
  row.km_vuelta = vueltaM != null ? Math.round(vueltaM / 100) / 10 : null;

  // Desglose por tipo de peaje (TollGuru no desglosa por tipo — se deja en 0)
  row.mainline_ida       = ida    ? Math.round(ida.mainlineCLP    || 0) : 0;
  row.ramp_ida           = ida    ? Math.round(ida.rampCLP        || 0) : 0;
  row.electronic_ida     = ida    ? Math.round(ida.electronicCLP  || 0) : 0;
  row.mainline_vuelta    = vuelta ? Math.round(vuelta.mainlineCLP    || 0) : 0;
  row.ramp_vuelta        = vuelta ? Math.round(vuelta.rampCLP        || 0) : 0;
  row.electronic_vuelta  = vuelta ? Math.round(vuelta.electronicCLP  || 0) : 0;

  // needs_review si:
  //   - Sin resultado de API (error de red)
  //   - notFound: ciudad no encontrada (solo aplica a GetAPI legacy)
  //   - hasToll=true pero tollCLP=0 → dato inconsistente
  // TollGuru: hasToll=false + toll=0 → ruta sin peaje → $0 correcto, NO revisión
  const idaHasToll   = ida    ? (ida.hasToll    ?? ida.hasTolls    ?? false) : false;
  const vueltaHasToll = vuelta ? (vuelta.hasToll ?? vuelta.hasTolls ?? false) : false;
  const idaReview    = !ida    || !!ida.notFound    || (idaHasToll    && !row.peaje_ida);
  const vueltaReview = !vuelta || !!vuelta.notFound || (vueltaHasToll && !row.peaje_vuelta);
  row.needs_review = !!(idaReview || vueltaReview);
  row.not_found = !!((ida && ida.notFound) || (vuelta && vuelta.notFound));
  row.source = (ida?.source === 'tollguru' || vuelta?.source === 'tollguru') ? 'tollguru' : 'getapi';
  row.calculado_en = now;
  row.updated_at   = now;
  return row;
}

// Crea o actualiza la fila route_tolls para (routeId, ejes) con valores
// fijados manualmente (carga masiva por comuna). Marca como revisado.
function pjSetTollManual(db, routeId, ejes, peajeIda, peajeVuelta) {
  db.routeTolls = db.routeTolls || [];
  let row = db.routeTolls.find(rt => rt.route_id === routeId && Number(rt.ejes) === ejes);
  if (!row) {
    row = { id: `tj_${routeId}_${ejes}`, route_id: routeId, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false };
    db.routeTolls.push(row);
  }
  const now = new Date().toISOString();
  row.peaje_ida = Math.round(peajeIda || 0);
  row.peaje_vuelta = Math.round(peajeVuelta || 0);
  row.needs_review = false;
  row.calculado_en = now;
  row.updated_at = now;
  return row;
}

// Dado un centro de origen y una zona de transporte (comuna), retorna las
// rutas activas afectadas: las que pertenecen directamente a esa zona, más
// las rutas de tipo "Sector" que correspondan a la misma comuna (heredan el
// valor del peaje de la comuna).
function findRutasParaComuna(db, centroId, zonaId) {
  const zona = (db.transportZones || []).find(z => z.zona === zonaId);
  const routes = db.routes || [];

  const directas = routes.filter(r => r.activo && r.origenId === centroId && r.id_zona_transporte === zonaId);

  let sectores = [];
  if (zona && zona.comuna) {
    const zonasSector = (db.transportZones || [])
      .filter(z => z.tipo === 'Sector' && z.comuna === zona.comuna && z.zona !== zonaId)
      .map(z => z.zona);
    if (zonasSector.length) {
      sectores = routes.filter(r => r.activo && r.origenId === centroId && zonasSector.includes(r.id_zona_transporte));
    }
  }

  const all = [...directas, ...sectores];
  const seen = new Set();
  return all.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

// Interpreta una fila del CSV de carga masiva de peajes por comuna.
function parsePeajesComunaRow(row) {
  const centroId = (getField(row, 'id_centro_origen', 'centro_origen', 'id_centro', 'centro') || '').toString().trim();
  const zonaId = (getField(row, 'id_zona_transporte', 'zona_transporte', 'id_zona', 'zona') || '').toString().trim();
  const ejes = Number((getField(row, 'eje', 'ejes') || '').toString().trim());
  const peajeIda = Number(getField(row, 'peaje_ida', 'valor_peaje_ida', 'peajeida')) || 0;
  const peajeVuelta = Number(getField(row, 'peaje_vuelta', 'valor_peaje_vuelta', 'peajevuelta')) || 0;
  return { centroId, zonaId, ejes, peajeIda, peajeVuelta };
}

// Genera y descarga una plantilla CSV con una fila por cada combinación
// (Centro Origen, Zona de Transporte = Comuna) × eje, lista para completar
// con los valores de peaje y volver a subir.
function descargarPlantillaPeajesComuna(db) {
  const headers = ['id_centro_origen', 'centro_origen', 'id_zona_transporte', 'comuna', 'eje', 'peaje_ida', 'peaje_vuelta'];
  const combos = new Map();
  (db.routes || []).filter(r => r.activo && r.origenId && r.id_zona_transporte).forEach(r => {
    const zona = (db.transportZones || []).find(z => z.zona === r.id_zona_transporte);
    if (zona && zona.tipo === 'Sector') return; // las rutas Sector heredan el valor de su comuna
    const key = `${r.origenId}__${r.id_zona_transporte}`;
    if (!combos.has(key)) {
      combos.set(key, { centroId: r.origenId, zonaId: r.id_zona_transporte, comuna: r.comuna || (zona ? zona.comuna : '') || '' });
    }
  });
  const data = [];
  combos.forEach(c => {
    [2, 3].forEach(ejes => {
      data.push([c.centroId, getCentreName(db, c.centroId) || '', c.zonaId, c.comuna, ejes, 0, 0]);
    });
  });
  downloadFile(`plantilla_peajes_por_comuna_${Date.now()}.csv`, toCSV(headers, data));
  showAlert('Plantilla de carga masiva de peajes por comuna descargada');
}

// Modal de Carga Masiva de Peajes por Comuna: permite subir un CSV con
// id_centro_origen, id_zona_transporte, eje, peaje_ida y peaje_vuelta. El
// valor se aplica a todas las rutas activas de ese centro+comuna, incluyendo
// las rutas "Sector" que pertenezcan a la misma comuna.
function abrirModalCargaPeajesComuna(content, db, cfg) {
  const el = document.createElement('div');
  el.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md';
  el.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center gap-sm mb-md">
        <span class="material-symbols-outlined text-primary">upload_file</span>
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Peajes por Comuna</h3>
      </div>
      <p class="text-[12px] text-secondary mb-sm">
        Suba un CSV con el valor de peaje por <b>Centro de Origen + Zona de Transporte (comuna)</b> y tipo de eje.
        El valor se aplicará a todas las rutas activas de ese centro y comuna, incluyendo las rutas de tipo
        <b>Sector</b> que pertenezcan a la misma comuna.
      </p>
      <p class="text-[12px] text-secondary mb-md">
        Columnas requeridas: <code>id_centro_origen</code>, <code>id_zona_transporte</code>, <code>eje</code> (2 o 3),
        <code>peaje_ida</code>, <code>peaje_vuelta</code>.
      </p>
      <div class="flex flex-wrap gap-sm mb-md">
        <button id="pjc-plantilla" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">download</span> Descargar Plantilla
        </button>
        <label class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase cursor-pointer">
          <span class="material-symbols-outlined text-[18px]">attach_file</span> Elegir Archivo CSV
          <input id="pjc-file" type="file" accept=".csv" class="hidden">
        </label>
      </div>
      <div id="pjc-preview"></div>
      <div class="flex justify-end gap-sm mt-md">
        <button id="pjc-cancel" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded text-[12px] uppercase">Cerrar</button>
        <button id="pjc-importar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded text-[12px] uppercase opacity-50 cursor-not-allowed" disabled>Importar</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  let parsedRows = [];

  el.querySelector('#pjc-cancel').addEventListener('click', () => el.remove());
  el.querySelector('#pjc-plantilla').addEventListener('click', () => descargarPlantillaPeajesComuna(db));

  function renderPreview() {
    const validRows = parsedRows.filter(r => !r.error);
    const totalRutas = validRows.reduce((acc, r) => acc + r.rutas.length, 0);
    el.querySelector('#pjc-preview').innerHTML = `
      <div class="border border-outline-variant rounded overflow-hidden overflow-x-auto max-h-64">
        <table class="w-full text-[12px] zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left">
              <th class="p-sm">Centro</th>
              <th class="p-sm">Zona / Comuna</th>
              <th class="p-sm text-center">Eje</th>
              <th class="p-sm text-right">Peaje Ida</th>
              <th class="p-sm text-right">Peaje Vuelta</th>
              <th class="p-sm text-center">Rutas Afectadas</th>
              <th class="p-sm">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${parsedRows.map(r => `<tr class="${r.error ? 'bg-red-50' : ''}">
              <td class="p-sm">${escapeHtml(r.centroNombre)}</td>
              <td class="p-sm">${escapeHtml(r.zonaNombre)} <span class="text-secondary">(${escapeHtml(r.zonaId)})</span></td>
              <td class="p-sm text-center">${r.ejes || '—'}</td>
              <td class="p-sm text-right">${formatCLP(r.peajeIda)}</td>
              <td class="p-sm text-right">${formatCLP(r.peajeVuelta)}</td>
              <td class="p-sm text-center">${r.error ? '—' : r.rutas.length}</td>
              <td class="p-sm">${r.error ? `<span class="text-red-700">${escapeHtml(r.error)}</span>` : '<span class="text-green-700">OK</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-[11px] text-secondary mt-sm">${validRows.length} de ${parsedRows.length} fila(s) válida(s) · ${totalRutas} registro(s) (ruta × eje) serán actualizados.</p>
    `;
    const btn = el.querySelector('#pjc-importar');
    if (validRows.length > 0) {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  }

  el.querySelector('#pjc-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target.result;
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
      const csvRows = parseCSV(text);
      parsedRows = csvRows.map(row => {
        const { centroId, zonaId, ejes, peajeIda, peajeVuelta } = parsePeajesComunaRow(row);
        const centro = (db.logisticsCentres || []).find(c => c.id === centroId);
        const zona = (db.transportZones || []).find(z => z.zona === zonaId);
        let error = '';
        if (!centroId || !centro) error = 'Centro origen no encontrado';
        else if (!zonaId || !zona) error = 'Zona de transporte no encontrada';
        else if (ejes !== 2 && ejes !== 3) error = 'Eje inválido (debe ser 2 o 3)';
        const rutas = !error ? findRutasParaComuna(db, centroId, zonaId) : [];
        if (!error && rutas.length === 0) error = 'Sin rutas activas para este centro y comuna';
        return {
          centroId, zonaId, ejes, peajeIda, peajeVuelta, rutas, error,
          centroNombre: centro ? centro.nombre : (centroId || '—'),
          zonaNombre: zona ? (zona.comuna || zona.denominacion || zonaId) : (zonaId || '—')
        };
      });
      renderPreview();
    };
    reader.readAsArrayBuffer(file);
  });

  el.querySelector('#pjc-importar').addEventListener('click', () => {
    const validRows = parsedRows.filter(r => !r.error);
    if (validRows.length === 0) return;
    let totalRutas = 0;
    validRows.forEach(r => {
      r.rutas.forEach(ruta => {
        pjSetTollManual(db, ruta.id, r.ejes, r.peajeIda, r.peajeVuelta);
        totalRutas++;
      });
    });
    saveDatabase(db, { syncOnly: ['routeTolls'] });
    el.remove();
    showAlert(`Carga masiva de peajes por comuna aplicada: ${totalRutas} registro(s) actualizado(s) en ${validRows.length} fila(s).`);
    renderPeajesAuto(content, db, cfg);
  });
}

// Modal de progreso para el cálculo masivo de peajes
function createProgressModal(total) {
  const el = document.createElement('div');
  el.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center';
  el.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-md">
      <div class="flex items-center gap-sm mb-md">
        <span class="material-symbols-outlined text-primary">toll</span>
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Calculando Peajes…</h3>
      </div>
      <p id="ptj-status" class="text-[12px] text-secondary mb-sm break-all">Iniciando…</p>
      <div class="w-full bg-surface-container-high rounded-full h-3 overflow-hidden mb-sm">
        <div id="ptj-bar" class="bg-primary h-3 rounded-full transition-all" style="width:0%"></div>
      </div>
      <p id="ptj-count" class="text-[11px] text-secondary text-right mb-md">0 / ${total}</p>
      <button id="ptj-cancel" class="w-full bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded text-[12px] uppercase">Cancelar</button>
    </div>`;
  document.body.appendChild(el);
  return {
    cancelBtn: el.querySelector('#ptj-cancel'),
    update(i, total, label) {
      el.querySelector('#ptj-status').textContent = label;
      el.querySelector('#ptj-count').textContent = `${i} / ${total}`;
      el.querySelector('#ptj-bar').style.width = `${total > 0 ? Math.round((i / total) * 100) : 0}%`;
    },
    close() { el.remove(); }
  };
}

// Orquesta el cálculo de peajes con TollGuru como única fuente.
async function calcularPeajes(content, db, cfg, rutas, { force = false, renderFn = null } = {}) {
  if (!rutas || rutas.length === 0) {
    showAlert('No hay rutas para calcular con los filtros actuales', 'error');
    return;
  }

  // Filtrar rutas con ciudad de origen y destino disponibles
  const targets = rutas.filter(r => {
    if (!r.comuna) return false;
    const cdG = r.origen_grupo
      ? (db.logisticsCentres || []).find(c => c.origen_grupo === r.origen_grupo && c.comuna)
      : null;
    const cd = cdG || (db.logisticsCentres || []).find(c => c.id === r.origenId);
    return !!(cd?.comuna);
  });
  const sinCiudad = rutas.length - targets.length;
  const avisoCoords = sinCiudad > 0 ? `\n${sinCiudad} ruta(s) sin ciudad origen/destino quedarán en revisión.` : '';

  const enCache = force ? 0 : targets.filter(r => {
    const c2 = pjGetTollRow(db, r.id, 2);
    const c3 = pjGetTollRow(db, r.id, 3);
    return c2 && c3 && c2.calculado_en && c3.calculado_en && !c2.needs_review && !c3.needs_review;
  }).length;
  const avisoCache = !force && enCache > 0
    ? `\n${enCache} ruta(s) ya tienen caché válida y serán omitidas.\nUsa el botón ↺ por fila para forzar actualización de una ruta específica.`
    : '';

  if (!confirm(`Se calcularán peajes via TollGuru para ${targets.length} ruta(s).${avisoCoords}${avisoCache}\n\n¿Continuar?`)) {
    return;
  }

  // Rutas sin ciudad → revisión directa
  rutas.filter(r => !targets.includes(r)).forEach(ruta => {
    [2, 3].forEach(ejes => pjUpsertToll(db, ruta.id, ejes, null, null, { error: true }));
  });

  // Construir lista de targets con ciudades (sin llamada Google)
  const tollTargets = [];
  for (const ruta of targets) {
    if (!force) {
      const c2 = pjGetTollRow(db, ruta.id, 2);
      const c3 = pjGetTollRow(db, ruta.id, 3);
      if (c2 && c3 && c2.calculado_en && c3.calculado_en && !c2.needs_review && !c3.needs_review) {
        continue;
      }
    }
    const cdPorGrupo = ruta.origen_grupo
      ? (db.logisticsCentres || []).find(c => c.origen_grupo === ruta.origen_grupo && c.comuna)
      : null;
    const cd = cdPorGrupo || (db.logisticsCentres || []).find(c => c.id === ruta.origenId);
    if (!cd?.comuna || !ruta.comuna) {
      [2, 3].forEach(ejes => pjUpsertToll(db, ruta.id, ejes, null, null, { error: true }));
      continue;
    }
    tollTargets.push({ ruta, originCity: cd.comuna.trim() + ', Chile', destCity: ruta.comuna.trim() + ', Chile' });
  }

  const modal = createProgressModal(tollTargets.length);
  let cancelado = false;
  modal.cancelBtn.addEventListener('click', () => { cancelado = true; });


  // ── FASE 2: TollGuru — única fuente de peajes ───────────────────────────────
  const ejesToCategory = { 2: 'CAMION_2_EJES', 3: 'CAMION_PESADO' };
  let tgUsados = 0;
  modal.update(0, tollTargets.length, `TollGuru — ${tollTargets.length} ruta(s)…`);

  for (let i = 0; i < tollTargets.length; i++) {
    if (cancelado) break;
    const { ruta, originCity, destCity } = tollTargets[i];

    for (const ejes of [2, 3]) {
      const category = ejesToCategory[ejes];
      let ida = null, errored = false;
      modal.update(i, tollTargets.length, `[TollGuru] ${ruta.codigo} ${ejes}ej — ${ruta.comuna || ruta.destino || ''}`);
      try {
        const tg = await callTollGuruTolls(originCity, destCity, category, Number(ruta.lat) || null, Number(ruta.lon) || null);
        tgUsados++;
        if (tg && !tg.notFound && !tg.error) { ida = tg; }
      } catch (tgErr) {
        console.error('[TollGuru] Error para', ruta.codigo, ejes, 'ejes:', tgErr.message);
        errored = true;
      }
      await sleep(1000);

      pjUpsertToll(db, ruta.id, ejes, ida, ida, { error: errored && !ida });
      if (cancelado) break;
    }

    if ((i + 1) % 10 === 0) saveDatabase(db, { syncOnly: ['routeTolls'] });
  }

  modal.update(tollTargets.length, tollTargets.length, cancelado ? 'Cancelado' : 'Finalizado');
  saveDatabase(db, { syncOnly: ['routeTolls'] });
  modal.close();

  const resumen = `Completado: ${tollTargets.length} ruta(s). TollGuru: ${tgUsados} llamadas (~${tgUsados * 5} tx de 5.000/mes).`;
  showAlert(cancelado ? 'Cálculo cancelado (avance guardado)' : resumen);
  (renderFn || renderPeajesAuto)(content, db, cfg);
}

// ---------- Calcular KM vía Google Distance Matrix ----------
async function calcularKm(content, db, cfg, rutas) {
  if (!rutas || rutas.length === 0) {
    showAlert('No hay rutas para calcular KM', 'error');
    return;
  }

  const sinKm = rutas.filter(r => {
    const tollRow = (db.routeTolls || []).find(t => t.route_id === r.id && t.km_ida != null);
    return !tollRow;
  });

  const targets = sinKm.filter(r => r.lat != null && r.lon != null);
  const sinCoords = sinKm.length - targets.length;
  const yaConKm = rutas.length - sinKm.length;

  if (targets.length === 0) {
    const msg = yaConKm === rutas.length
      ? 'Todas las rutas seleccionadas ya tienen KM calculado (cache).'
      : `No hay rutas con coordenadas para calcular KM.`;
    showAlert(msg, 'info');
    return;
  }

  const avisoCache = yaConKm > 0 ? `\n${yaConKm} ruta(s) ya tienen KM y serán omitidas (cache).` : '';
  const avisoCoords = sinCoords > 0 ? `\n${sinCoords} ruta(s) sin coordenadas serán omitidas.` : '';
  if (!confirm(`Se calcularán KMs (vía Google Distance Matrix) para ${targets.length} ruta(s).${avisoCache}${avisoCoords}\n\n¿Continuar?`)) return;

  const modal = createProgressModal(targets.length);
  let cancelado = false;
  modal.cancelBtn.addEventListener('click', () => { cancelado = true; });

  db.routeTolls = db.routeTolls || [];

  for (let i = 0; i < targets.length; i++) {
    if (cancelado) break;
    const ruta = targets[i];
    // En PRD todos los origenId='1000' — buscar por origen_grupo para obtener el centro correcto
    const cdKmPorGrupo = ruta.origen_grupo
      ? (db.logisticsCentres || []).find(c => c.origen_grupo === ruta.origen_grupo && c.lat != null)
      : null;
    const cd = cdKmPorGrupo || (db.logisticsCentres || []).find(c => c.id === ruta.origenId);
    modal.update(i, targets.length, `${ruta.codigo} — ${ruta.destino || ''}`);

    if (!cd || cd.lat == null || cd.lon == null) {
      console.warn('Centro sin coordenadas para KM:', cd?.id, cd?.nombre);
      continue;
    }

    try {
      const ida = await callGoogleDistance(cd.lat, cd.lon, ruta.lat, ruta.lon);
      await sleep(300);
      const vuelta = await callGoogleDistance(ruta.lat, ruta.lon, cd.lat, cd.lon);
      await sleep(300);

      [2, 3].forEach(ejes => {
        let row = db.routeTolls.find(rt => rt.route_id === ruta.id && Number(rt.ejes) === ejes);
        if (!row) {
          row = { id: `tj_${ruta.id}_${ejes}`, route_id: ruta.id, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false };
          db.routeTolls.push(row);
        }
        row.km_ida = ida ? ida.distanceKm : null;
        row.km_vuelta = vuelta ? vuelta.distanceKm : null;
        row.updated_at = new Date().toISOString();
      });

    } catch (err) {
      console.error('Error calculando KM para', ruta.codigo, err);
    }

    if ((i + 1) % 10 === 0) saveDatabase(db, { syncOnly: ['routeTolls'] });
  }

  modal.update(targets.length, targets.length, cancelado ? 'Cancelado' : 'Finalizado');
  saveDatabase(db, { syncOnly: ['routeTolls'] });
  modal.close();
  showAlert(cancelado ? 'Cálculo de KM cancelado (avance guardado)' : 'Cálculo de KM finalizado');
  renderPeajesAuto(content, db, cfg);
}

// ---------- Registro Manual de Plazas de Peaje (legado / respaldo) ----------
function renderPeajesManual(content, db, cfg) {
  const routes = db.routes;

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">edit_road</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Registro Manual de Plazas de Peaje (Respaldo)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Este registro detallado por plaza de peaje se usa como respaldo del Motor de Costo solo cuando una ruta no tiene un cálculo automático (sección anterior). Los cobros aquí son simétricos (Ida y Vuelta procesan el mismo valor). Mapeo fijo de ejes: 5.000 y 10.000 kg = 2 ejes · 15.000 y 28.000 kg = 3 ejes.</p>

      <form id="pj-form" class="grid grid-cols-1 md:grid-cols-6 gap-sm items-end mb-md">
        <div class="md:col-span-2 space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">RUTA</label>
          <select id="pj-ruta" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" required>
            ${routes.map(r => `<option value="${r.id}">${r.codigo} — ${r.destino}</option>`).join('')}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">EJES</label>
          <select id="pj-ejes" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
            <option value="2">2 Ejes</option>
            <option value="3">3 Ejes</option>
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CONCESIONARIA</label>
          <input id="pj-conc" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="Ej: Autopista Central" required>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">PLAZA DE PEAJE</label>
          <input id="pj-plaza" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="Ej: Pórtico Lampa" required>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">VALOR PEAJE (CLP)</label>
          <div class="flex gap-xs">
            <input id="pj-valor" type="number" min="0" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="0" required>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded shrink-0">
              <span class="material-symbols-outlined text-[18px]">add</span>
            </button>
          </div>
        </div>
      </form>

      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_Origen, Comuna_Destino, Id_Ruta, Ejes, Concesionaria, Plaza_Peaje, Valor_Peaje</p>
        </div>
        <input type="file" id="pj-csv" accept=".csv" class="text-[12px]">
      </div>
    </div>

    <div class="bg-surface border border-outline-variant overflow-hidden rounded">
      <table class="w-full zebra-table border-collapse">
        <thead>
          <tr class="bg-surface-container-high text-left border-b border-outline-variant">
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ejes</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Concesionaria</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Plaza de Peaje</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor Ida</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor Vuelta</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
          </tr>
        </thead>
        <tbody class="font-body-md text-body-md">
          ${(cfg.peajes || []).length === 0 ? `<tr><td colspan="7" class="p-md text-center text-secondary">No hay peajes registrados.</td></tr>` :
            cfg.peajes.map(p => {
              const r = routes.find(x => x.id === p.rutaId);
              return `<tr class="border-b border-outline-variant">
                <td class="p-md">${r ? `${r.codigo} — ${r.destino}` : '(ruta eliminada)'}</td>
                <td class="p-md font-data-mono text-data-mono">${p.ejes}</td>
                <td class="p-md">${p.concesionaria}</td>
                <td class="p-md">${p.plazaPeaje}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(p.valorPeaje)}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(p.valorPeaje)}</td>
                <td class="p-md text-center">
                  <button class="pj-del text-secondary hover:text-primary" data-id="${p.id}" title="Eliminar">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('pj-form').addEventListener('submit', (e) => {
    e.preventDefault();
    cfg.peajes = cfg.peajes || [];
    cfg.peajes.push({
      id: 'pj' + Date.now(),
      rutaId: document.getElementById('pj-ruta').value,
      ejes: Number(document.getElementById('pj-ejes').value),
      concesionaria: document.getElementById('pj-conc').value.trim(),
      plazaPeaje: document.getElementById('pj-plaza').value.trim(),
      valorPeaje: Number(document.getElementById('pj-valor').value) || 0
    });
    saveDatabase(db);
    showAlert('Peaje agregado correctamente');
    renderPeajesManual(content, db, cfg);
  });

  document.querySelectorAll('.pj-del').forEach(btn => {
    btn.addEventListener('click', () => {
      cfg.peajes = cfg.peajes.filter(p => p.id !== btn.dataset.id);
      saveDatabase(db);
      renderPeajesManual(content, db, cfg);
    });
  });

  document.getElementById('pj-csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (rows) => {
      let count = 0;
      cfg.peajes = cfg.peajes || [];
      rows.forEach(row => {
        const idRuta = (row.Id_Ruta || '').trim();
        const route = db.routes.find(r => r.codigo.toLowerCase() === idRuta.toLowerCase() || r.id === idRuta);
        if (!route) return;
        cfg.peajes.push({
          id: 'pj' + Date.now() + Math.random().toString(16).slice(2),
          rutaId: route.id,
          ejes: Number(row.Ejes) || 2,
          concesionaria: row.Concesionaria || '',
          plazaPeaje: row.Plaza_Peaje || '',
          valorPeaje: Number(row.Valor_Peaje) || 0
        });
        count++;
      });
      saveDatabase(db);
      showAlert(`${count} peajes cargados desde CSV`);
      renderPeajesManual(content, db, cfg);
    });
  });
}

// ============================================================
// SUB-MÓDULO: TARIFAS DE TRANSPORTE POR CENTRO Y TIPO DE CAMIÓN
// ============================================================
function truckNumInput(id, field, value) {
  return `<input type="number" step="any" class="${inputCls}" data-truck-id="${id}" data-truck-field="${field}" value="${value ?? 0}">`;
}

// Recalcula Tarifa/KM (costo/km final del Motor de Costo + margen de ganancia,
// promedio de rutas activas del Centro Origen para esa capacidad) y Tarifa
// Base (Tarifa/KM x Km Base) para cada tipo de camión, persistiendo en
// db.truckTypes si hubo cambios. Si se indica grupoFiltro (origen_grupo),
// solo recalcula ese Centro Origen; en caso contrario recalcula todos.
// Devuelve un Set con los ids de tipos de camión que sí tienen rutas activas
// (y por tanto valor ZCAP vigente).
function syncTarifasZcap(db, cfg, grupoFiltro = '') {
  const allGroups  = getOrigenGroups(db);
  const grupos_filt = grupoFiltro ? allGroups.filter(g => g.grupo === grupoFiltro) : allGroups;
  const matriz     = calcularMatrizCostos(db, cfg);
  const participacion = cfg.participacionRutas || {};
  const conZcap    = new Set();
  let cambios      = false;

  // SANTIAGO y SAN BERNARDO comparten estructura de tarifas → combinar rutas
  const STGO_SB = ['SANTIAGO', 'SAN BERNARDO'];
  const stgoGroup = allGroups.find(g => g.grupo === 'SANTIAGO');
  const sbGroup   = allGroups.find(g => g.grupo === 'SAN BERNARDO');

  function metricas(items) {
    const norm = items.filter(m => (m.ruta.caracteristica || 'NORMAL').toUpperCase() === 'NORMAL');
    const esp  = items.filter(m => (m.ruta.caracteristica || 'NORMAL').toUpperCase() !== 'NORMAL');
    function pond(sub) {
      return sub.reduce((s, m) => {
        const p = participacion[m.ruta.id] || participacion[m.ruta.codigo];
        return s + (m.item11_costoKmFinal || 0) * ((p?.pct || 0) / 100);
      }, 0);
    }
    function prom(sub) {
      return sub.length ? sub.reduce((s, m) => s + (m.item11_costoKmFinal || 0), 0) / sub.length : 0;
    }
    return {
      pondNorm: Math.round(pond(norm)) || Math.round(prom(norm)),
      promNorm: Math.round(prom(norm)),
      pondEsp:  Math.round(pond(esp))  || Math.round(prom(esp)),
      promEsp:  Math.round(prom(esp)),
      hasEsp:   esp.length > 0,
      hasItems: items.length > 0
    };
  }

  grupos_filt.forEach(g => {
    // SAN BERNARDO: sus rutas se procesan junto con SANTIAGO → skip individual
    if (g.grupo === 'SAN BERNARDO' && stgoGroup) return;

    // Grupos a incluir en el cálculo
    const gruposCalc = (g.grupo === 'SANTIAGO' && sbGroup) ? STGO_SB : [g.grupo];

    const rows = (db.truckTypes || []).filter(t => t.Id_centro === g.repId);
    rows.forEach(t => {
      const items = matriz.filter(m =>
        gruposCalc.includes(m.ruta.origen_grupo) &&
        m.capKg === truckCapKg(t.type) &&
        (m.ruta.tipo || '').toUpperCase() === 'COMUNA' &&
        m.ruta.clasificRuta === 'Regional'
      );
      if (items.length === 0) return;
      conZcap.add(t.id);

      const mx = metricas(items);

      if (t.ratePerKmPond !== mx.pondNorm) { t.ratePerKmPond = mx.pondNorm; cambios = true; }
      if (t.ratePerKmProm !== mx.promNorm) { t.ratePerKmProm = mx.promNorm; cambios = true; }
      if (t.ratePerKm     !== mx.pondNorm) { t.ratePerKm     = mx.pondNorm; cambios = true; } // compat
      if (mx.hasEsp) {
        if (t.ratePerKmExtrPond !== mx.pondEsp) { t.ratePerKmExtrPond = mx.pondEsp; cambios = true; }
        if (t.ratePerKmExtrProm !== mx.promEsp) { t.ratePerKmExtrProm = mx.promEsp; cambios = true; }
        if (t.ratePerKmExtrema  !== mx.pondEsp) { t.ratePerKmExtrema  = mx.pondEsp; cambios = true; } // compat
      }
      // AJUSTADA: solo auto-inicializar si aún no tiene valor manual
      if (t.rateAjustNorm === undefined || t.rateAjustNorm === null) {
        t.rateAjustNorm = mx.pondNorm; cambios = true;
      }
      if (mx.hasEsp && (t.rateAjustEsp === undefined || t.rateAjustEsp === null)) {
        t.rateAjustEsp = mx.pondEsp; cambios = true;
      }
    });
  });

  if (cambios) saveDatabase(db);
  return conZcap;
}

function renderTarifasCamion(content, db, cfg) {
  const allGroups = getOrigenGroups(db);
  const conZcap   = syncTarifasZcap(db, cfg);

  // SANTIAGO + SAN BERNARDO → grupo combinado
  const STGO_SB = ['SANTIAGO', 'SAN BERNARDO'];
  const stgoG   = allGroups.find(g => g.grupo === 'SANTIAGO');
  const sbG     = allGroups.find(g => g.grupo === 'SAN BERNARDO');
  const tieneStgoSb = !!(stgoG && sbG);

  // Lista de grupos para dropdown (sin SAN BERNARDO si va combinado)
  const gruposDropdown = tieneStgoSb
    ? allGroups.filter(g => g.grupo !== 'SAN BERNARDO')
    : allGroups;

  // Lista de grupos a renderizar
  let gruposRender = tarifaCentroFiltro
    ? allGroups.filter(g => g.grupo === tarifaCentroFiltro || (tarifaCentroFiltro === '__STGO_SB__' && STGO_SB.includes(g.grupo)))
    : allGroups;
  // Excluir SAN BERNARDO individual si va combinado
  if (tieneStgoSb) gruposRender = gruposRender.filter(g => g.grupo !== 'SAN BERNARDO');

  const routes = (db.routes || []).filter(r => r.activo);

  // ¿Tiene rutas especiales el centro (o combinado)?
  function tieneEspeciales(gruposCalc) {
    return routes.some(r => gruposCalc.includes(r.origen_grupo) && r.caracteristica && r.caracteristica !== 'NORMAL');
  }

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">local_shipping</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Tarifas de Transporte por Centro y Tipo de Camión</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        KM Base, Costo Base y Tarifa Base KM son editables. Las columnas ZCAP (Ponderada, Promedio) se calculan
        automáticamente desde el Motor de Costo. Las Tarifas Ajustadas se inicializan con ZCAP y pueden editarse manualmente.
      </p>

      <div class="flex items-end gap-sm mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="tt-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-56">
            <option value="">Todos</option>
            ${tieneStgoSb ? `<option value="__STGO_SB__" ${tarifaCentroFiltro === '__STGO_SB__' ? 'selected' : ''}>Santiago + San Bernardo</option>` : ''}
            ${gruposDropdown.filter(g => !STGO_SB.includes(g.grupo) || !tieneStgoSb).map(g =>
              `<option value="${escapeHtml(g.grupo)}" ${g.grupo === tarifaCentroFiltro ? 'selected' : ''}>${escapeHtml(g.nombre)}</option>`).join('')}
          </select>
        </div>
      </div>

      ${gruposRender.map(g => {
        // Para SANTIAGO combinado, incluir ambos grupos en cálculo
        const gruposCalc = (g.grupo === 'SANTIAGO' && tieneStgoSb) ? STGO_SB : [g.grupo];
        const rows = (db.truckTypes || []).filter(t => t.Id_centro === g.repId).sort((a, b) => truckCapKg(a.type) - truckCapKg(b.type));
        const tieneEsp = tieneEspeciales(gruposCalc);

        // Nombre del grupo
        let nombreGrupo = g.nombre;
        let subtituloGrupo = `(${g.centroIds.join(', ')})`;
        if (g.grupo === 'SANTIAGO' && tieneStgoSb) {
          nombreGrupo    = 'Santiago + San Bernardo';
          const sbIds = sbG ? sbG.centroIds : [];
          subtituloGrupo = `(${[...g.centroIds, ...sbIds].join(', ')})`;
        }

        const colCount = tieneEsp ? 11 : 9;
        return `
        <div class="mb-xl">
          <div class="flex items-center justify-between mb-xs">
            <h3 class="font-body-lg font-bold text-on-surface">${escapeHtml(nombreGrupo)} <span class="text-secondary font-data-mono text-[12px]">${subtituloGrupo}</span></h3>
            ${rows.length === 0 ? `
            <button class="tt-add-types bg-primary hover:bg-[#930007] text-white font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase" data-grupo="${escapeHtml(g.grupo)}">
              <span class="material-symbols-outlined text-[16px]">add</span> Agregar tipos
            </button>` : ''}
          </div>
          <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
            <table class="w-full border-collapse text-[12px]">
              <thead>
                <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap">Tipo Camión</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right">Cap.</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right">a. KM Base</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right">b. Costo Base</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right">c. T. Base KM</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-blue-50">d. Normal Pond.</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-blue-50">e. Normal Prom.</th>
                  ${tieneEsp ? `
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-amber-50">f. Esp. Pond.</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-amber-50">g. Esp. Prom.</th>` : ''}
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-green-50">h. Ajust. Normal</th>
                  ${tieneEsp ? `<th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap text-right bg-green-50">i. Ajust. Especial</th>` : ''}
                </tr>
              </thead>
              <tbody class="font-body-md text-body-md">
                ${rows.length === 0
                  ? `<tr><td colspan="${colCount}" class="p-md text-center text-secondary">Sin tipos de camión. Use "Agregar tipos" para crear los 4 estándar (5/10/15/28 Ton).</td></tr>`
                  : rows.map(t => {
                    const hasZcap = conZcap.has(t.id);
                    const pondN   = t.ratePerKmPond    || 0;
                    const promN   = t.ratePerKmProm    || 0;
                    const pondE   = t.ratePerKmExtrPond || 0;
                    const promE   = t.ratePerKmExtrProm || 0;
                    const ajN     = t.rateAjustNorm    ?? pondN;
                    const ajE     = t.rateAjustEsp     ?? pondE;
                    const noData  = !hasZcap ? '<div class="text-[10px] text-secondary">Sin rutas</div>' : '';
                    return `
                    <tr class="border-b border-outline-variant">
                      <td class="p-md font-bold whitespace-nowrap">${t.type}</td>
                      <td class="p-md text-right text-secondary">${t.capacityTons}</td>
                      <td class="p-md w-24">${truckNumInput(t.id, 'Kmbase',   t.Kmbase)}</td>
                      <td class="p-md w-28">${truckNumInput(t.id, 'baseKM',   t.baseKM)}</td>
                      <td class="p-md w-28">${truckNumInput(t.id, 'baseRate', t.baseRate)}</td>
                      <td class="p-md text-right font-data-mono bg-blue-50">${hasZcap ? formatCLP(pondN) : '—'}${noData}</td>
                      <td class="p-md text-right font-data-mono bg-blue-50">${hasZcap ? formatCLP(promN) : '—'}</td>
                      ${tieneEsp ? `
                      <td class="p-md text-right font-data-mono bg-amber-50">${pondE > 0 ? formatCLP(pondE) : '—'}</td>
                      <td class="p-md text-right font-data-mono bg-amber-50">${promE > 0 ? formatCLP(promE) : '—'}</td>` : ''}
                      <td class="p-md w-28 bg-green-50">${truckNumInput(t.id, 'rateAjustNorm', ajN)}</td>
                      ${tieneEsp ? `<td class="p-md w-28 bg-green-50">${truckNumInput(t.id, 'rateAjustEsp', ajE)}</td>` : ''}
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>

          <div class="flex gap-sm mt-xs text-[11px] text-secondary">
            <span class="inline-flex items-center gap-1"><span class="w-3 h-3 bg-blue-50 border border-blue-200 inline-block rounded"></span> ZCAP calculado (solo lectura)</span>
            <span class="inline-flex items-center gap-1"><span class="w-3 h-3 bg-amber-50 border border-amber-200 inline-block rounded"></span> Rutas extremas/isla</span>
            <span class="inline-flex items-center gap-1"><span class="w-3 h-3 bg-green-50 border border-green-200 inline-block rounded"></span> Editable — tarifa oficial</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  content.querySelectorAll('[data-truck-id]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const id    = e.target.dataset.truckId;
      const field = e.target.dataset.truckField;
      const val   = e.target.value === '' ? 0 : Number(e.target.value);
      const row   = (db.truckTypes || []).find(t => t.id === id);
      if (row) row[field] = val;
      saveDatabase(db);
      if (field === 'Kmbase') renderTarifasCamion(content, db, cfg);
    });
  });

  document.getElementById('tt-f-centro')?.addEventListener('change', (e) => {
    tarifaCentroFiltro = e.target.value;
    renderTarifasCamion(content, db, cfg);
  });

  content.querySelectorAll('.tt-add-types').forEach(btn => {
    btn.addEventListener('click', () => {
      const grupo  = getOrigenGroups(db).find(g => g.grupo === btn.dataset.grupo);
      if (!grupo) return;
      const centro = (db.logisticsCentres || []).find(c => c.id === grupo.repId);
      if (!centro) return;
      const nuevos = buildTruckTypes([centro], TRUCK_BASE_TYPES);
      db.truckTypes = db.truckTypes || [];
      db.truckTypes.push(...nuevos);
      saveDatabase(db);
      showAlert(`${nuevos.length} tipo(s) de camión agregados para ${grupo.nombre}`);
      renderTarifasCamion(content, db, cfg);
    });
  });
}

// ============================================================
// SUB-MÓDULO 2: COMBUSTIBLES Y RENDIMIENTOS
// ============================================================
const CNE_FUNCTION_URL = 'https://humhokvdowfqicjopbhf.supabase.co/functions/v1/cne-diesel-price';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fuenteBadge(fuel) {
  if (!fuel || !fuel.precioLitro) {
    return `<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN DATOS</span>`;
  }
  if (fuel.fuente === 'cne') {
    const ref = fuel.cneRegion
      ? `<br><span class="font-normal text-[10px] opacity-75">${fuel.cneRegion} ${fuel.cneMes || ''}/${fuel.cneAnio || ''}</span>`
      : '';
    return `<span class="inline-flex flex-col items-center px-2 py-1 rounded bg-blue-100 text-blue-800 font-label-caps text-[10px] leading-tight">
      <span class="flex items-center gap-xs"><span class="material-symbols-outlined text-[12px]">cloud_done</span> API CNE</span>${ref}
    </span>`;
  }
  return `<span class="inline-flex items-center gap-xs px-2 py-1 rounded bg-surface-container text-secondary font-label-caps text-[10px]">
    <span class="material-symbols-outlined text-[12px]">edit</span> Manual
  </span>`;
}

function renderCombustibles(content, db, cfg) {
  const groups = getOrigenGroups(db);
  const hoy = new Date();

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">local_gas_station</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Precio de Combustible por Centro Logístico</h2>
        </div>
        <button id="cne-update-btn"
          class="flex items-center gap-xs bg-primary text-white px-md py-sm rounded text-[12px] font-bold uppercase hover:opacity-90 transition-opacity">
          <span class="material-symbols-outlined text-[16px]">cloud_download</span>
          Actualizar desde CNE
        </button>
      </div>

      <div id="cne-status" class="hidden mb-md text-[12px] px-md py-sm rounded border"></div>

      <p class="text-[12px] text-secondary mb-md">
        Ingrese el precio por litro <b>con IVA</b> y el porcentaje de IVA. El <b>Precio sin IVA</b> es el valor que se usa en el Motor de Costo para calcular el costo de combustible.
        <b>Actualizar desde CNE</b> obtiene el precio del Petróleo Diésel de la última semana publicada por la CNE.
        Alerta crítica si un centro pasa más de 3 semanas sin actualizar.
      </p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Precio Litro c/IVA (CLP)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">IVA %</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Precio sin IVA (CLP)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Última Actualización</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Fuente</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md" id="combustibles-tbody">
            ${groups.map(g => {
              const fuel = cfg.combustibles[g.repId] || {};
              let estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN DATOS</span>`;
              if (fuel.fecha) {
                const dias = Math.floor((hoy - new Date(fuel.fecha)) / 86400000);
                estado = dias > 21
                  ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">warning</span> ${dias}D SIN ACTUALIZAR</span>`
                  : `<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">VIGENTE (${dias}D)</span>`;
              }
              const integrantes = g.centros.length > 1
                ? `<br><span class="text-secondary text-[11px]">${g.centros.map(c => c.nombre).join(', ')}</span>`
                : '';
              const ivaPct = Number(fuel.ivaPct) || 0;
              const precioNeto = ivaPct > 0
                ? Math.round(Number(fuel.precioLitro || 0) / (1 + ivaPct / 100))
                : Number(fuel.precioLitro || 0);
              return `<tr class="border-b border-outline-variant" data-repid="${g.repId}">
                <td class="p-md font-bold">${g.nombre}${integrantes}</td>
                <td class="p-md w-40">${numInput(`combustibles.${g.repId}.precioLitro`, fuel.precioLitro, 'data-combustible-repid="' + g.repId + '" data-combustible-field="precio"')}</td>
                <td class="p-md w-28">${numInput(`combustibles.${g.repId}.ivaPct`, fuel.ivaPct ?? 19, 'data-combustible-repid="' + g.repId + '" data-combustible-field="iva"')}</td>
                <td class="p-md w-36 text-right font-data-mono text-data-mono font-bold text-primary">${precioNeto.toLocaleString('es-CL')}</td>
                <td class="p-md w-44">${dateInput(`combustibles.${g.repId}.fecha`, fuel.fecha, `data-combustible-repid="${g.repId}" data-combustible-field="fecha"`)}</td>
                <td class="p-md text-center">${estado}</td>
                <td class="p-md text-center">${fuenteBadge(fuel)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">speed</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Matriz de Rendimiento Estructural (KM/Litro)</h2>
      </div>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Capacidad Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rendimiento Cargado (Ida)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rendimiento Vacío (Vuelta)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Ejes (fijo)</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${CAP_LIST.map(cap => {
              const r = cfg.rendimientos[cap] || {};
              return `<tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${(cap / 1000).toLocaleString('es-CL')}.000 kg</td>
                <td class="p-md w-32">${numInput(`rendimientos.${cap}.cargado`, r.cargado)}</td>
                <td class="p-md w-32">${numInput(`rendimientos.${cap}.vacio`, r.vacio)}</td>
                <td class="p-md text-center font-data-mono text-data-mono">${cfg.ejes[cap]}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // ── Listener: edición manual de precio, iva o fecha
  content.querySelectorAll('[data-combustible-repid]').forEach(input => {
    input.addEventListener('change', () => {
      const repId = input.dataset.combustibleRepid;
      const field = input.dataset.combustibleField;
      if (!repId) return;
      if (!cfg.combustibles[repId]) cfg.combustibles[repId] = {};
      if (field === 'precio') {
        cfg.combustibles[repId].fuente = 'manual';
        const hoyStr = todayISO();
        cfg.combustibles[repId].fecha = hoyStr;
        const fechaInput = content.querySelector(`[data-path="combustibles.${repId}.fecha"]`);
        if (fechaInput) fechaInput.value = hoyStr;
        delete cfg.combustibles[repId].cneRegion;
        delete cfg.combustibles[repId].cneMes;
        delete cfg.combustibles[repId].cneAnio;
      } else if (field === 'iva') {
        // Solo actualizar ivaPct, no cambia fuente ni fecha
        const val = Number(input.value);
        cfg.combustibles[repId].ivaPct = isNaN(val) ? 0 : val;
      } else if (field === 'fecha') {
        cfg.combustibles[repId].fuente = 'manual';
      }
      saveDatabase(db);
      // Re-render para actualizar precio sin IVA y badges
      renderCombustibles(content, db, cfg);
    });
  });

  // ── Botón "Actualizar desde CNE" ──────────────────────────────
  document.getElementById('cne-update-btn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('cne-update-btn');
    const status = document.getElementById('cne-status');

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">sync</span> Consultando CNE…';
    status.className = 'mb-md text-[12px] px-md py-sm rounded border bg-blue-50 border-blue-200 text-blue-800';
    status.textContent = 'Conectando con API CNE…';
    status.classList.remove('hidden');

    try {
      const res  = await fetch(CNE_FUNCTION_URL);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Error desconocido en Edge Function');

      const precios  = json.data;
      const hoyStr   = todayISO(); // fecha de la consulta = hoy (no la fecha de publicación CNE)
      let actualizados = 0;

      groups.forEach(g => {
        const grupoKey = String(g.grupo).toUpperCase();
        const entry    = precios[grupoKey];
        if (!entry) return;
        if (!cfg.combustibles[g.repId]) cfg.combustibles[g.repId] = {};
        cfg.combustibles[g.repId].precioLitro = entry.precio;
        cfg.combustibles[g.repId].fecha       = hoyStr;      // ← hoy, no la fecha CNE
        cfg.combustibles[g.repId].fuente      = 'cne';
        cfg.combustibles[g.repId].cneRegion   = entry.region;
        cfg.combustibles[g.repId].cneMes      = entry.mes;
        cfg.combustibles[g.repId].cneAnio     = entry.anio;
        actualizados++;
      });

      saveDatabase(db);

      status.className = 'mb-md text-[12px] px-md py-sm rounded border bg-green-50 border-green-200 text-green-800';
      status.textContent = `✓ ${actualizados} centros actualizados — precio CNE Diésel más reciente. Fecha de actualización: ${hoyStr}.`;

      renderCombustibles(content, db, cfg);

    } catch (err) {
      status.className = 'mb-md text-[12px] px-md py-sm rounded border bg-red-50 border-red-200 text-red-800';
      status.textContent = `Error: ${err.message}`;
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">cloud_download</span> Actualizar desde CNE';
    }
  });
}

// ============================================================
// SUB-MÓDULO 3: SEGUROS Y PERMISOS
// ============================================================
function renderSeguros(content, db, cfg) {
  const groups = getOrigenGroups(db);
  const ufVal = Number(cfg.variables.valorUF) || 0;
  if (!cfg.soapTransversal) cfg.soapTransversal = {};

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between gap-sm mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">shield</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Seguro de Carga (Colectivo Corporativo)</h2>
        </div>
        <div class="flex items-center gap-sm">
          <label class="font-label-caps text-label-caps text-secondary text-[11px]">Valor UF:</label>
          <input id="seg-uf-live" type="number" min="0" step="1" value="${ufVal}" data-path="variables.valorUF"
            class="border border-[#CED4DA] p-xs font-data-mono text-data-mono w-28 text-right">
        </div>
      </div>
      <p class="text-[12px] text-secondary mb-md">Valor base mensual en UF por centro. Se convierte a CLP usando el Valor UF indexado. UF actual: <b id="seg-uf-display">${formatCLP(ufVal)}</b></p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Seguro Carga (UF/mes)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Equivalente CLP/mes</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${groups.map(g => {
              const uf = Number(cfg.seguros[g.repId]) || 0;
              const integrantes = g.centros.length > 1
                ? `<br><span class="text-secondary text-[11px]">${g.centros.map(c => c.nombre).join(', ')}</span>`
                : '';
              return `<tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${g.nombre}${integrantes}</td>
                <td class="p-md w-32">${numInput(`seguros.${g.repId}`, uf)}</td>
                <td class="p-md text-right font-data-mono text-data-mono seg-clp-cell" data-uf="${uf}">${formatCLP(uf * ufVal)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">directions_car</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">SOAP por Tipo de Camión (Transversal)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Valor anual promediado de SOAP, igual para todos los centros (valor transversal). Se aplica internamente en el Motor de Costo para cada centro según el tipo de camión.</p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor SOAP Anual (CLP)</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${CAP_LIST.map(cap => `
              <tr class="border-b border-outline-variant">
                <td class="p-md font-bold font-data-mono text-data-mono">${(cap / 1000)}.000 kg</td>
                <td class="p-md w-40">${numInput(`soapTransversal.${cap}`, cfg.soapTransversal[cap] || 0)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">badge</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Permiso de Circulación (Anual Promediado)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Tabla relacional indexada por Centro Logístico y Tipo de Camión. Edición inline o carga masiva CSV (columnas: Centro_SAP, Tipo_Camion_Kg, Permiso_Circulacion).</p>

      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV — Permiso de Circulación</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_SAP, Tipo_Camion_Kg, Permiso_Circulacion</p>
        </div>
        <input type="file" id="ps-csv" accept=".csv" class="text-[12px]">
      </div>

      <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
              ${groups.map(g => `<th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">${g.nombre}</th>`).join('')}
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${CAP_LIST.map(cap => `
              <tr class="border-b border-outline-variant">
                <td class="p-md font-bold font-data-mono text-data-mono">${(cap / 1000)}.000 kg</td>
                ${groups.map(g => {
                  const key = `${g.repId}|${cap}`;
                  const row = cfg.permisosSoap[key] || {};
                  return `<td class="p-sm w-32">${numInput(`permisosSoap.${key}.permiso`, row.permiso)}</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // UF live update — update CLP cells without full re-render
  document.getElementById('seg-uf-live').addEventListener('input', (e) => {
    const newUF = Number(e.target.value) || 0;
    document.getElementById('seg-uf-display').textContent = formatCLP(newUF);
    content.querySelectorAll('.seg-clp-cell').forEach(cell => {
      const uf = Number(cell.dataset.uf) || 0;
      cell.textContent = formatCLP(uf * newUF);
    });
  });

  // Also update UF cells when the seguros UF input loses focus (sync with cfg)
  document.getElementById('seg-uf-live').addEventListener('change', (e) => {
    cfg.variables.valorUF = Number(e.target.value) || 0;
    saveDatabase(db);
  });

  // Seguros UF — also update CLP when the per-center UF field changes
  content.querySelectorAll('[data-path^="seguros."]').forEach(inp => {
    inp.addEventListener('change', () => {
      const currentUF = Number(document.getElementById('seg-uf-live').value) || 0;
      content.querySelectorAll('.seg-clp-cell').forEach((cell, i) => {
        const g = groups[i];
        if (!g) return;
        const uf = Number(cfg.seguros[g.repId]) || 0;
        cell.dataset.uf = uf;
        cell.textContent = formatCLP(uf * currentUF);
      });
    });
  });

  document.getElementById('ps-csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (rows) => {
      let count = 0;
      rows.forEach(row => {
        const cd = db.logisticsCentres.find(c => c.id === (row.Centro_SAP || '').trim());
        const cap = parseCapKgFromCSV(row.Tipo_Camion_Kg);
        if (!cd || !CAP_LIST.includes(cap)) return;
        const key = `${getGroupRepId(db, cd.id)}|${cap}`;
        cfg.permisosSoap[key] = cfg.permisosSoap[key] || {};
        cfg.permisosSoap[key].permiso = Number(row.Permiso_Circulacion) || 0;
        count++;
      });
      saveDatabase(db);
      showAlert(`${count} registros de Permiso de Circulación actualizados`);
      renderSeguros(content, db, cfg);
    });
  });
}
// ============================================================
// SUB-MÓDULO 4a: PARTICIPACIÓN RUTAS
// ============================================================
function renderParticipacion(content, db, cfg) {
  const histData = getClientTariffConfig(db).historico || [];
  if (histData.length === 0) {
    // Sin histórico: mostrar participación guardada si existe
    const partGuardada = cfg.participacionRutas || {};
    const clavesPart = Object.keys(partGuardada).filter(k => !k.startsWith('r1')); // solo códigos, no UUIDs
    if (clavesPart.length === 0) {
      content.innerHTML = `
        <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
          <div class="flex items-center gap-sm mb-md">
            <span class="material-symbols-outlined text-primary">donut_large</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Participación Rutas</h2>
          </div>
          <p class="text-secondary">No hay datos históricos cargados. Diríjase a <b>Tarifas Clientes → Histórico</b> para cargar el archivo CSV de 6 meses.</p>
        </div>`;
      return;
    }
    // Mostrar participación guardada agrupada por ruta
    const routes = db.routes || [];
    const grupos = getOrigenGroups(db);
    const centros = [...new Set(grupos.map(g => g.grupo))].sort();
    const allGroups = getOrigenGroups(db);

    let fallbackFiltroCentro = '';

    const rowsPart = clavesPart.map(k => {
      const e = partGuardada[k];
      const ruta = routes.find(r => r.codigo === k || r.id === k);
      return { codigo: k, ruta, pct: e.pct, caracteristica: e.caracteristica, grupo: ruta?.origen_grupo || '—', destino: ruta?.destino || '' };
    }).sort((a, b) => b.pct - a.pct);

    function renderFallback(filtroCentro) {
      const rowsFiltradas = filtroCentro ? rowsPart.filter(r => r.grupo === filtroCentro) : rowsPart;
      // Agrupar por centro
      const porCentro = {};
      rowsFiltradas.forEach(r => { (porCentro[r.grupo] = porCentro[r.grupo] || []).push(r); });

      content.innerHTML = `
        <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
          <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
            <span class="material-symbols-outlined text-primary">donut_large</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Participación Rutas (datos guardados)</h2>
          </div>
          <div class="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] p-sm rounded mb-md">
            Mostrando participación previamente guardada. Para recalcular, cargue el CSV histórico en <b>Tarifas Clientes → Histórico</b>.
          </div>
          <div class="flex gap-sm items-end mb-md">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
              <select id="part-fb-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-56">
                <option value="">Todos los centros</option>
                ${centros.map(c => `<option value="${escapeHtml(c)}" ${c === filtroCentro ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
          </div>
          ${Object.entries(porCentro).map(([grupo, filas]) => {
            const gNombre = allGroups.find(g => g.grupo === grupo)?.nombre || grupo;
            return `<div class="mb-lg">
              <h3 class="font-body-lg font-bold mb-xs">${gNombre}</h3>
              <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
                <table class="w-full zebra-table border-collapse">
                  <thead><tr class="bg-surface-container-high border-b border-outline-variant">
                    <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
                    <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Caract.</th>
                    <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">PESO %</th>
                  </tr></thead>
                  <tbody class="font-body-md text-body-md">
                    ${filas.map(r => `<tr class="border-b border-outline-variant">
                      <td class="p-md">${escapeHtml(r.destino)}</td>
                      <td class="p-md">${escapeHtml(r.caracteristica || 'NORMAL')}</td>
                      <td class="p-md text-right font-data-mono font-bold">${r.pct}%</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>`;
          }).join('')}
        </div>`;

      document.getElementById('part-fb-centro')?.addEventListener('change', e => {
        fallbackFiltroCentro = e.target.value;
        renderFallback(fallbackFiltroCentro);
      });
    }

    renderFallback(fallbackFiltroCentro);
    return;
  }

  const routes = (db.routes || []).filter(r => r.activo);
  const grupos = getOrigenGroups(db);

  // ── Índice de rutas ───────────────────────────────────────────────────────
  const routeByIdP = new Map();
  routes.forEach(r => {
    if (r.id)     routeByIdP.set(r.id, r);
    if (r.codigo) routeByIdP.set(r.codigo, r);
  });

  // ── Detectar STGO y SAN BERNARDO por ID de centro (robusto) ─────────────
  const STGO_IDS = ['1001','1002','1003'];
  const SB_IDS   = ['1005'];
  const stgoGrupoObj = grupos.find(g => g.centroIds.some(id => STGO_IDS.includes(String(id))));
  const sbGrupoObj   = grupos.find(g => g.centroIds.some(id => SB_IDS.includes(String(id))));
  const STGO_SB_GRUPOS = [stgoGrupoObj?.grupo, sbGrupoObj?.grupo].filter(Boolean);
  const tieneStgoSb = !!(stgoGrupoObj && sbGrupoObj && stgoGrupoObj.grupo !== sbGrupoObj.grupo);

  // ── Grupos disponibles en el histórico (via ruta.origen_grupo directo) ───
  const centrosEnHistorico = new Set();
  histData.forEach(h => {
    const ruta = routeByIdP.get(h.idRuta);
    if (ruta?.origen_grupo) centrosEnHistorico.add(ruta.origen_grupo);
  });
  // Si histData no tiene rutas mapeables, caer a todos los grupos de la BD
  const centros = centrosEnHistorico.size > 0
    ? [...centrosEnHistorico].sort()
    : grupos.map(g => g.grupo);

  // Dropdown: mostrar TODOS los centros separados (STGO y SB aparecen individualmente)
  const centrosDropdown = centros;

  function labelCentro(c) {
    const g = grupos.find(go => go.grupo === c);
    return g?.nombre || String(c).replace(/_/g, ' ');
  }

  let participacionFiltroCentro = centrosDropdown[0] || '';

  // ── Mapa de zonas para rollup Sector → COMUNA ────────────────────────────
  const zonasByIdP = new Map((db.transportZones || []).map(z => [z.zona, z]));

  function calcParticipacion(grupoInput) {
    // Si el grupo seleccionado es STGO o SB, siempre combinar ambos para el cálculo
    // (mismos destinos/zonas → la participación se calcula sobre el total combinado
    //  y se aplica igual a cada centro por separado)
    const esStgoSb = tieneStgoSb && STGO_SB_GRUPOS.includes(grupoInput);
    const grupos_calc = esStgoSb ? STGO_SB_GRUPOS : [grupoInput];

    // IDs de centros involucrados
    const grupoCentroIds = new Set();
    grupos_calc.forEach(gn => {
      const gObj = grupos.find(go => go.grupo === gn);
      if (gObj) gObj.centroIds.forEach(id => grupoCentroIds.add(String(id)));
    });

    // Filtrar histData directamente por ruta.origen_grupo
    const grupoRows = histData.filter(h => {
      const ruta = routeByIdP.get(h.idRuta);
      if (!ruta) return false;
      return grupos_calc.includes(ruta.origen_grupo) ||
             grupoCentroIds.has(String(ruta.origenId));
    });
    if (!grupoRows.length) return [];

    // Paso 1: Acumular toneladas por destino.
    // Clave = id_zona_transporte ?? destino.toUpperCase()
    // Esto fusiona las rutas de STGO y SB que van al mismo lugar.
    const rawMap = new Map();
    grupoRows.forEach(h => {
      const ruta = routeByIdP.get(h.idRuta);
      if (!ruta || ruta.clasificRuta !== 'Regional') return;

      const zonaKey    = ruta.id_zona_transporte;
      const destinoKey = (ruta.destino || ruta.nombre || '').trim().toUpperCase();
      const mapKey     = zonaKey || destinoKey || h.idRuta;

      if (!rawMap.has(mapKey)) {
        rawMap.set(mapKey, { mapKey, ruta, clientes: new Set(), obras: new Set(), ton: 0 });
      }
      const e = rawMap.get(mapKey);
      // Preferir la ruta de STGO como representativa (datos maestros)
      if (stgoGrupoObj && ruta.origen_grupo === stgoGrupoObj.grupo && e.ruta.origen_grupo !== stgoGrupoObj.grupo) {
        e.ruta = ruta;
      }
      if (h.idCliente && h.idCliente !== '-') e.clientes.add(h.idCliente);
      if (h.idObra    && h.idObra    !== '-') e.obras.add(h.idObra);
      e.ton += h.ton;
    });

    // Paso 2: mapa zonaId → mapKey (para rollup Sector → COMUNA)
    const comunaZonaToKey = new Map();
    rawMap.forEach((e, key) => {
      if ((e.ruta.tipo || '').toUpperCase() === 'COMUNA' && e.ruta.id_zona_transporte) {
        comunaZonaToKey.set(e.ruta.id_zona_transporte, key);
      }
    });

    // Paso 3: routeMap solo con COMUNA
    const routeMap = new Map();
    rawMap.forEach((e, key) => {
      if ((e.ruta.tipo || '').toUpperCase() === 'COMUNA') {
        routeMap.set(key, { mapKey: key, ruta: e.ruta, clientes: new Set(e.clientes), obras: new Set(e.obras), ton: e.ton });
      }
    });

    // Paso 4: rollup Sector → COMUNA padre
    rawMap.forEach(e => {
      if ((e.ruta.tipo || '').toLowerCase() !== 'sector') return;
      const zone = zonasByIdP.get(e.ruta.id_zona_transporte);
      if (!zone?.comuna) return;
      const parentKey = comunaZonaToKey.get(zone.comuna);
      if (!parentKey) return;
      const parent = routeMap.get(parentKey);
      if (!parent) return;
      parent.ton += e.ton;
      e.clientes.forEach(c => parent.clientes.add(c));
      e.obras.forEach(o => parent.obras.add(o));
    });

    // Paso 5: PESO — denominador = total combinado STGO+SB por categoría
    const catTon = {};
    routeMap.forEach(e => {
      const cat = (e.ruta.caracteristica || 'NORMAL').toUpperCase();
      catTon[cat] = (catTon[cat] || 0) + e.ton;
    });

    return [...routeMap.values()]
      .map(e => {
        const cat = (e.ruta.caracteristica || 'NORMAL').toUpperCase();
        return {
          rutaId:         e.ruta?.id     || e.mapKey,
          rutaCodigo:     e.ruta?.codigo || e.mapKey,
          ruta:           e.ruta,
          clientes:       e.clientes.size,
          obras:          e.obras.size,
          toneladas:      e.ton,
          peso:           e.ton / (catTon[cat] || 1),
          caracteristica: e.ruta?.caracteristica || 'NORMAL'
        };
      })
      .sort((a, b) => b.toneladas - a.toneladas);
  }
  function render(centroId) {
    const results = centroId ? calcParticipacion(centroId) : [];
    const totalTon = results.reduce((s, r) => s + r.toneladas, 0);

    content.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">donut_large</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Participación Rutas</h2>
        </div>
        <p class="text-[12px] text-secondary mb-md">
          Ranking de rutas Regionales + COMUNA por toneladas movilizadas (histórico 6 meses). Las rutas tipo Sector
          suman sus toneladas a la COMUNA padre. El Peso es la fracción que representa cada ruta sobre el total del centro.
          Los datos provienen de <b>Tarifas Clientes → Histórico</b>.
        </p>

        <div class="flex gap-sm items-end mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
            <select id="part-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-64">
              <option value="">Seleccione un centro</option>
              ${centrosDropdown.map(c => `<option value="${escapeHtml(c)}" ${c === centroId ? 'selected' : ''}>${escapeHtml(labelCentro(c))}</option>`).join('')}
            </select>
          </div>
        </div>

        ${results.length > 0 ? `
        <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
          <table class="w-full zebra-table border-collapse">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">#</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Caract.</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Clientes</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Obras</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Toneladas</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">PESO</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Barra</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${results.map((r, idx) => {
                const maxTon = results.length > 0 ? results[0].toneladas : 1;
                const barWidth = Math.min(100, (r.toneladas / maxTon) * 100);
                const badgeCls = r.caracteristica === 'NORMAL' ? 'bg-surface-container-high text-secondary border border-outline-variant'
                  : r.caracteristica === 'ISLA' ? 'bg-blue-100 text-blue-800 border border-blue-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300';
                const pesoPct = (r.peso * 100).toFixed(2);
                return `<tr class="border-b border-outline-variant">
                  <td class="p-md text-right text-secondary font-data-mono text-data-mono">${idx + 1}</td>
                  <td class="p-md">${escapeHtml(r.ruta?.destino || '')}</td>
                  <td class="p-md"><span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${badgeCls}">${r.caracteristica === 'NORMAL' ? 'NORMAL' : r.caracteristica === 'ISLA' ? 'ISLA' : 'EXTREMA'}</span></td>
                  <td class="p-md text-right">${r.clientes}</td>
                  <td class="p-md text-right">${r.obras}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${r.toneladas.toLocaleString('es-CL', { maximumFractionDigits: 1 })}</td>
                  <td class="p-md text-right font-bold font-data-mono text-data-mono">${pesoPct}%</td>
                  <td class="p-md">
                    <div class="w-24 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div class="h-full rounded-full bg-primary" style="width: ${barWidth}%"></div>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              ${(() => {
                const cats = [...new Set(results.map(r => (r.ruta.caracteristica || 'NORMAL').toUpperCase()))].sort();
                return cats.map(cat => {
                  const catRows = results.filter(r => (r.ruta.caracteristica || 'NORMAL').toUpperCase() === cat);
                  const catTon = catRows.reduce((s, r) => s + r.toneladas, 0);
                  return `<tr class="bg-surface-container-high border-t border-outline-variant">
                    <td colspan="5" class="p-md font-bold text-right">Subtotal ${cat}</td>
                    <td class="p-md font-bold font-data-mono text-data-mono text-right">${catTon.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ton</td>
                    <td class="p-md font-bold font-data-mono text-data-mono text-right">100%</td>
                    <td class="p-md"></td>
                  </tr>`;
                }).join('');
              })()}
            </tfoot>
          </table>
        </div>
        <div class="flex gap-sm mt-md">
          <button id="part-guardar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
            <span class="material-symbols-outlined text-[18px]">save</span> Guardar Participación
          </button>
        </div>
        ` : '<p class="text-secondary mt-md">Seleccione un centro para ver la participación de rutas.</p>'}
      </div>
    `;

    const centroSelect = document.getElementById('part-f-centro');
    if (centroSelect) {
      centroSelect.addEventListener('change', (e) => {
        participacionFiltroCentro = e.target.value;
        render(e.target.value || null);
      });
    }

    const guardarBtn = document.getElementById('part-guardar');
    if (guardarBtn) {
      guardarBtn.addEventListener('click', () => {
        if (!results || results.length === 0) {
          showAlert('Seleccione un centro para guardar la participación.', 'error'); return;
        }
        try {
          cfg.participacionRutas = cfg.participacionRutas || {};
          results.forEach(r => {
            const entry = {
              pct: Math.round(r.peso * 10000) / 100,
              peso: r.peso,
              cluster: r.peso >= 0.30 ? 1 : r.peso >= 0.10 ? 2 : 3,
              caracteristica: r.caracteristica
            };
            cfg.participacionRutas[r.rutaId] = entry;
            if (r.rutaCodigo && r.rutaCodigo !== r.rutaId)
              cfg.participacionRutas[r.rutaCodigo] = entry;
          });
          saveDatabase(db);
          showAlert(`✓ Participación guardada: ${results.length} ruta(s).`);
        } catch(err) {
          showAlert('Error al guardar: ' + err.message, 'error');
        }
      });
    }
  }

  render(null);
}

// ============================================================
// SUB-MÓDULO 4: VARIABLES GENERALES
// ============================================================
function renderVariables(content, db, cfg) {
  const centres = db.logisticsCentres;
  const groups = getOrigenGroups(db);
  const v = cfg.variables;
  const hoy = new Date();
  let alertaUF = '';
  if (v.fechaUF) {
    const dias = Math.floor((hoy - new Date(v.fechaUF)) / 86400000);
    if (dias > 30) {
      alertaUF = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px] ml-sm"><span class="material-symbols-outlined text-[14px]">warning</span> ${dias} DÍAS SIN ACTUALIZAR</span>`;
    }
  } else {
    alertaUF = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px] ml-sm"><span class="material-symbols-outlined text-[14px]">warning</span> SIN FECHA</span>`;
  }

  content.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-lg mb-lg">
      <!-- Valor UF y Margen -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Valor UF y Margen de Ganancia</h3>
        <div class="grid grid-cols-2 gap-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">VALOR UF (CLP) ${alertaUF}</label>
            ${numInput('variables.valorUF', v.valorUF)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">FECHA ACTUALIZACIÓN UF</label>
            ${dateInput('variables.fechaUF', v.fechaUF)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">MARGEN DE GANANCIA (%)</label>
            ${numInput('variables.margenGanancia', v.margenGanancia)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">GPS / CELULAR (UF MENSUAL)</label>
            ${numInput('variables.gps.costoUF', v.gps.costoUF)}
          </div>
        </div>
        <p class="text-[11px] text-secondary mt-md">El costo GPS se prorratea dividiendo por los KM Mensuales Ofrecidos de cada centro/camión.</p>
      </div>

      <!-- Chofer -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Chofer — Remuneración y Comisión</h3>
        <div class="grid grid-cols-2 gap-md mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">DÍAS HÁBILES MENSUALES</label>
            ${numInput('variables.chofer.diasHabiles', v.chofer.diasHabiles)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">COMISIÓN POR SERVICIO (%)</label>
            ${numInput('variables.chofer.comisionPct', v.chofer.comisionPct)}
          </div>
        </div>
        <p class="font-label-caps text-label-caps text-secondary mb-xs">SUELDO MÍNIMO POR CENTRO ORIGEN (CLP)</p>
        <div class="space-y-xs">
          ${groups.map(g => `
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary">${g.nombre}</span>
              ${numInput(`variables.chofer.sueldoMinimo.${g.repId}`, v.chofer.sueldoMinimo[g.repId])}
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-lg mb-lg">
      <!-- Neumáticos -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Desgaste de Neumáticos</h3>
        <div class="space-y-xs mb-md">
          <label class="font-label-caps text-label-caps text-secondary block">CICLO BASE (KM)</label>
          ${numInput('variables.neumaticos.ciclo', v.neumaticos.ciclo)}
        </div>
        <p class="font-label-caps text-label-caps text-secondary mb-xs">COSTO DE CAMBIO COMPLETO POR TIPO DE CAMIÓN</p>
        <div class="space-y-xs">
          ${CAP_LIST.map(cap => `
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary">${(cap / 1000)}.000 kg</span>
              ${numInput(`variables.neumaticos.costos.${cap}`, v.neumaticos.costos[cap])}
            </div>`).join('')}
        </div>
      </div>

      <!-- Factor Ruta -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Factor Ruta (Geográfico)</h3>
        <p class="text-[12px] text-secondary mb-md">Multiplicador aplicado al Costo Ruta Total según la característica de la ruta (ver Administración de Rutas).</p>
        <div class="space-y-xs">
          ${['NORMAL', 'ISLA', 'EXTREMA'].map(k => `
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary font-bold">${k}</span>
              ${numInput(`variables.factorRuta.${k}`, v.factorRuta[k])}
            </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Mantención -->
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Mantención Vehicular</h3>
      <div class="space-y-xs mb-md max-w-xs">
        <label class="font-label-caps text-label-caps text-secondary block">CICLO BASE AJUSTABLE (KM)</label>
        ${numInput('variables.mantencion.ciclo', v.mantencion.ciclo)}
      </div>
      <p class="font-label-caps text-label-caps text-secondary mb-xs">COSTO DE MANTENCIÓN POR CENTRO ORIGEN Y TIPO DE CAMIÓN</p>
      ${pivotCamionCentroTable(groups,
        (repId, cap) => `variables.mantencion.costos.${repId}|${cap}`,
        (repId, cap) => (v.mantencion.costos || {})[`${repId}|${cap}`])}
    </div>

    <!-- KM Mensuales Ofrecidos -->
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">KM Mensuales Ofrecidos</h3>
      <p class="text-[12px] text-secondary mb-md">Determina los denominadores de los prorrateos fijos (SOAP, Seguro, Mantención, Neumáticos, GPS). Carga masiva CSV: columnas Centro_SAP, Tipo_Camion_Kg, KM_Mensual.</p>
      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV — KM Mensuales Ofrecidos</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_SAP, Tipo_Camion_Kg, KM_Mensual</p>
        </div>
        <input type="file" id="km-csv" accept=".csv" class="text-[12px]">
      </div>
      ${pivotCamionCentroTable(groups,
        (repId, cap) => `kmOfrecidos.${repId}|${cap}`,
        (repId, cap) => cfg.kmOfrecidos[`${repId}|${cap}`])}
    </div>

  `;

  document.getElementById('km-csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (rows) => {
      let count = 0;
      rows.forEach(row => {
        const cd = centres.find(c => c.id === (row.Centro_SAP || '').trim());
        const cap = parseCapKgFromCSV(row.Tipo_Camion_Kg);
        if (!cd || !CAP_LIST.includes(cap)) return;
        cfg.kmOfrecidos[`${getGroupRepId(db, cd.id)}|${cap}`] = Number(row.KM_Mensual) || 0;
        count++;
      });
      saveDatabase(db);
      showAlert(`${count} registros de KM Mensuales actualizados`);
      renderVariables(content, db, cfg);
    });
  });
}

// ============================================================
// MOTOR ACTUARIAL: RESULTADOS Y EXPORTACIÓN
// ============================================================
function renderResultados(content, db, cfg) {
  const groups = getOrigenGroups(db);
  let todaMatriz = calcularMatrizCostos(db, cfg);

  // ── filtrar por tipo de ruta
  if (mcTipoRuta === 'regional') {
    todaMatriz = todaMatriz.filter(m =>
      (m.ruta.tipo || '').toUpperCase() === 'COMUNA' && m.ruta.clasificRuta === 'Regional');
  } else if (mcTipoRuta === 'interregional') {
    todaMatriz = todaMatriz.filter(m => m.ruta.clasificRuta === 'Interregional');
  }

  // ── filtrar por centros seleccionados (multi-select)
  if (mcCentros.size > 0) {
    todaMatriz = todaMatriz.filter(m => mcCentros.has(m.ruta.origen_grupo));
  }

  // ── destinos disponibles según centros (para datalist)
  const destinoSet = new Set(todaMatriz.map(m => m.ruta.destino || m.ruta.nombre || '').filter(Boolean));

  // ── filtro tipo camión
  if (mcCapKg) todaMatriz = todaMatriz.filter(m => String(m.truckType?.capKg) === mcCapKg);

  // ── filtro texto destino
  if (mcComuna) {
    const q = mcComuna.toLowerCase();
    todaMatriz = todaMatriz.filter(m => (m.ruta.destino || m.ruta.nombre || '').toLowerCase().includes(q));
  }

  const showPeso  = mcTipoRuta !== 'interregional';
  const groupMap  = {};
  groups.forEach(g => { groupMap[g.grupo] = g.nombre; });
  const participacion = cfg.participacionRutas || {};

  // ── mapa costos extras
  const extraCostsMap = new Map();
  (db.extraCosts || []).filter(c => c.activo !== false).forEach(c => {
    const key = `${c.zona_id}__${c.ejes}`;
    const prev = extraCostsMap.get(key) || { ida: 0, vuelta: 0 };
    extraCostsMap.set(key, { ida: prev.ida + (Number(c.costo_ida) || 0), vuelta: prev.vuelta + (Number(c.costo_vuelta) || 0) });
  });
  function getExtraTotal(ruta, capKg) {
    const ejes  = capKg <= 10000 ? 2 : 3;
    const entry = extraCostsMap.get(`${ruta.id_zona_transporte}__${ejes}`);
    return entry ? entry.ida + entry.vuelta : 0;
  }

  const HEADERS_BASE = ['Centro','ID Ruta','Destino','Clasificación','Tipo Camión (Kg)','KM',
    'Peajes','Comb. Ida','Comb. Vuelta','Seguros','Costos Extras',
    'Mantención','Neumáticos','GPS','Rem. Chofer','Var. Chofer',
    'Factor','Costo Vuelta','Costo Total','Costo/KM'];
  const HEADERS = showPeso ? [...HEADERS_BASE, 'Peso', 'T. Ponderada'] : HEADERS_BASE;

  function centrosLabel() {
    if (mcCentros.size === 0) return 'Todos los centros';
    if (mcCentros.size === 1) return groups.find(g => mcCentros.has(g.grupo))?.nombre || '1 centro';
    return `${mcCentros.size} centros seleccionados`;
  }

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">

      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">calculate</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Motor de Costo — Resultados</h2>
        </div>
        <div class="flex items-center gap-sm">
          ${mcTipoRuta !== 'interregional' ? `
          <button id="mc-actualizar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Tarifas
          </button>` : ''}
          <button id="mc-export" class="bg-surface border border-outline-variant hover:bg-surface-container-high text-on-surface font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar CSV
          </button>
        </div>
      </div>

      <!-- Toggle tipo de ruta -->
      <div class="flex items-center gap-xs mb-md">
        <span class="font-label-caps text-label-caps text-secondary mr-sm text-[11px] uppercase">Tipo:</span>
        ${[['regional','Regional'],['interregional','Interregional'],['todas','Todas']].map(([val,lbl]) => `
        <button class="mc-tipo-btn px-md py-xs rounded border text-[12px] font-bold uppercase transition-colors ${mcTipoRuta === val
          ? 'bg-primary text-white border-primary'
          : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}"
          data-tipo="${val}">${lbl}</button>`).join('')}
      </div>

      <!-- Filtros -->
      <div class="flex flex-wrap items-end gap-md mb-md">

        <!-- Multi-select centros -->
        <div class="relative">
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">CENTRO ORIGEN</label>
          <button id="mc-centro-btn" class="border border-[#CED4DA] px-sm py-[9px] bg-white text-left w-56 font-body-md text-body-md flex justify-between items-center gap-sm">
            <span id="mc-centro-label">${centrosLabel()}</span>
            <span class="material-symbols-outlined text-[18px] text-secondary flex-shrink-0">expand_more</span>
          </button>
          <div id="mc-centro-panel" class="hidden absolute z-50 bg-white border border-[#CED4DA] shadow-lg w-64 max-h-72 overflow-y-auto mt-1">
            <label class="flex items-center gap-sm p-sm hover:bg-surface-container-high cursor-pointer border-b border-outline-variant">
              <input type="checkbox" id="mc-c-all" ${mcCentros.size === 0 ? 'checked' : ''}>
              <span class="font-body-md text-body-md font-bold">Todos</span>
            </label>
            ${groups.map(g => `
            <label class="flex items-center gap-sm p-sm hover:bg-surface-container-high cursor-pointer">
              <input type="checkbox" class="mc-c-item" value="${escapeHtml(g.grupo)}" ${mcCentros.has(g.grupo) ? 'checked' : ''}>
              <span class="font-body-md text-body-md">${escapeHtml(g.nombre)}</span>
            </label>`).join('')}
          </div>
        </div>

        <!-- Tipo camión -->
        <div>
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">TIPO CAMIÓN (KG)</label>
          <select id="mc-f-capkg" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
            <option value="">Todos</option>
            <option value="5000"  ${mcCapKg === '5000'  ? 'selected' : ''}>5.000 Kg</option>
            <option value="10000" ${mcCapKg === '10000' ? 'selected' : ''}>10.000 Kg</option>
            <option value="15000" ${mcCapKg === '15000' ? 'selected' : ''}>15.000 Kg</option>
            <option value="28000" ${mcCapKg === '28000' ? 'selected' : ''}>28.000 Kg</option>
          </select>
        </div>

        <!-- Búsqueda destino (datalist filtrado por centros) -->
        <div>
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">BUSCAR DESTINO</label>
          <input id="mc-f-comuna" type="text" list="mc-destinos-list"
            placeholder="Filtrar destino..." value="${escapeHtml(mcComuna)}"
            class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
          <datalist id="mc-destinos-list">
            ${[...destinoSet].sort().map(d => `<option value="${escapeHtml(d)}">`).join('')}
          </datalist>
        </div>

        <!-- Limpiar filtros -->
        <button id="mc-reset" class="border border-outline-variant px-md py-sm text-[12px] text-secondary hover:bg-surface-container-high rounded flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px]">filter_alt_off</span> Limpiar
        </button>
      </div>

      <div class="text-[12px] text-secondary mb-sm">${todaMatriz.length} fila(s) encontrada(s)</div>

      <!-- Tabla -->
      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse text-[12px]">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              ${HEADERS.map((h, i) => `<th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap${i > 2 ? ' text-right' : ''}">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody class="font-data-mono text-data-mono">
            ${todaMatriz.length === 0
              ? `<tr><td colspan="${HEADERS.length}" class="p-md text-center text-secondary">Sin resultados para los filtros seleccionados.</td></tr>`
              : todaMatriz.slice(mcPagina * MC_PAGE, (mcPagina + 1) * MC_PAGE).map(m => {
                  const partEntry  = participacion[m.ruta.id] || participacion[m.ruta.codigo];
                  const pct        = partEntry?.pct || 0;
                  const tarifaPond = Math.round((m.item11_costoKmFinal || 0) * pct / 100);
                  const grupoNombre = groupMap[m.ruta.origen_grupo] || m.ruta.origen_grupo;
                  const seguros    = (m.item3_soapKm || 0) + (m.item4_seguroKm || 0);
                  const capKg      = m.truckType?.capKg || m.capKg || 0;
                  const capLabel   = capKg ? capKg.toLocaleString('es-CL') : '—';
                  const extraTotal = getExtraTotal(m.ruta, capKg);
                  const esInter    = m.ruta.clasificRuta === 'Interregional';
                  return `<tr class="border-b border-outline-variant${esInter ? ' bg-blue-50/30' : ''}">
                    <td class="p-md font-bold whitespace-nowrap">${grupoNombre}</td>
                    <td class="p-md">${m.ruta.codigo}</td>
                    <td class="p-md whitespace-nowrap">${m.ruta.destino || ''}</td>
                    <td class="p-md text-right">${m.ruta.clasificRuta || ''}</td>
                    <td class="p-md text-right">${capLabel}</td>
                    <td class="p-md text-right">${m.km}</td>
                    <td class="p-md text-right">${formatCLP(m.item1_peajes)}</td>
                    <td class="p-md text-right">${formatCLP(m.combIda)}</td>
                    <td class="p-md text-right">${formatCLP(m.combVuelta)}</td>
                    <td class="p-md text-right">${formatCLP(seguros)}</td>
                    <td class="p-md text-right ${extraTotal > 0 ? 'text-amber-700 font-bold' : ''}">${extraTotal > 0 ? formatCLP(extraTotal) : '—'}</td>
                    <td class="p-md text-right">${formatCLP(m.item5_mantKm)}</td>
                    <td class="p-md text-right">${formatCLP(m.item6_neumKm)}</td>
                    <td class="p-md text-right">${formatCLP(m.item7_gpsKm)}</td>
                    <td class="p-md text-right">${formatCLP(m.item8_choferBaseDiario)}</td>
                    <td class="p-md text-right">${formatCLP(m.item9_varChofer)}</td>
                    <td class="p-md text-right font-bold">${(m.factorRuta || 1).toFixed(2)}</td>
                    <td class="p-md text-right">${formatCLP(m.costoVuelta)}</td>
                    <td class="p-md text-right font-bold">${formatCLP(m.item10_costoRutaTotal)}</td>
                    <td class="p-md text-right font-bold text-primary">${formatCLP(m.item11_costoKmFinal)}</td>
                    ${showPeso ? `
                    <td class="p-md text-right">${esInter ? '—' : pct.toFixed(2) + '%'}</td>
                    <td class="p-md text-right">${esInter ? '—' : formatCLP(tarifaPond)}</td>` : ''}
                  </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
      ${renderPager(todaMatriz.length, mcPagina, MC_PAGE, 'mc-pag-prev', 'mc-pag-next')}
    </div>
  `;

  // ── Toggle tipo ruta
  content.querySelectorAll('.mc-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => { mcTipoRuta = btn.dataset.tipo; mcPagina = 0; renderResultados(content, db, cfg); });
  });

  // ── Multi-select centros
  const centroBtn   = document.getElementById('mc-centro-btn');
  const centroPanel = document.getElementById('mc-centro-panel');
  centroBtn?.addEventListener('click', e => { e.stopPropagation(); centroPanel.classList.toggle('hidden'); });
  document.addEventListener('click', () => centroPanel?.classList.add('hidden'), { once: true });

  document.getElementById('mc-c-all')?.addEventListener('change', () => {
    mcCentros.clear();
    content.querySelectorAll('.mc-c-item').forEach(cb => cb.checked = false);
    mcPagina = 0;
    renderResultados(content, db, cfg);
  });
  content.querySelectorAll('.mc-c-item').forEach(cb => {
    cb.addEventListener('change', () => {
      mcCentros.clear();
      content.querySelectorAll('.mc-c-item:checked').forEach(c => mcCentros.add(c.value));
      mcPagina = 0;
      renderResultados(content, db, cfg);
    });
  });

  // ── Tipo camión
  document.getElementById('mc-f-capkg')?.addEventListener('change', e => { mcCapKg = e.target.value; mcPagina = 0; renderResultados(content, db, cfg); });

  // ── Destino
  document.getElementById('mc-f-comuna')?.addEventListener('input', e => {
    const pos = e.target.selectionStart;
    mcComuna = e.target.value; mcPagina = 0;
    renderResultados(content, db, cfg);
    const inp = document.getElementById('mc-f-comuna');
    if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
  });

  // ── Limpiar
  document.getElementById('mc-reset')?.addEventListener('click', () => {
    mcCentros.clear(); mcCapKg = ''; mcComuna = ''; mcPagina = 0;
    renderResultados(content, db, cfg);
  });

  // ── Paginación
  document.getElementById('mc-pag-prev')?.addEventListener('click', () => { mcPagina = Math.max(0, mcPagina - 1); renderResultados(content, db, cfg); });
  document.getElementById('mc-pag-next')?.addEventListener('click', () => { mcPagina = Math.min(Math.ceil(todaMatriz.length / MC_PAGE) - 1, mcPagina + 1); renderResultados(content, db, cfg); });

  // ── Actualizar tarifas (solo Regional)
  document.getElementById('mc-actualizar')?.addEventListener('click', () => {
    const centroArg = mcCentros.size === 1 ? [...mcCentros][0] : '';
    const conZcap = syncTarifasZcap(db, cfg, centroArg);
    showAlert(`Tarifas actualizadas — ${conZcap.size} tipo(s) de camión sincronizado(s)`);
    renderResultados(content, db, cfg);
  });

  // ── Exportar CSV
  document.getElementById('mc-export')?.addEventListener('click', () => {
    const csvH = [...HEADERS_BASE, ...(showPeso ? ['Peso_Pct','Tarifa_Ponderada'] : [])];
    const rows = todaMatriz.map(m => {
      const grupoNombre = groupMap[m.ruta.origen_grupo] || m.ruta.origen_grupo;
      const partEntry   = participacion[m.ruta.id] || participacion[m.ruta.codigo];
      const pct         = partEntry?.pct || 0;
      const tarifaPond  = Math.round((m.item11_costoKmFinal || 0) * pct / 100);
      const seguros     = (m.item3_soapKm || 0) + (m.item4_seguroKm || 0);
      const capKg       = m.truckType?.capKg || m.capKg || 0;
      const extraT      = getExtraTotal(m.ruta, capKg);
      const esInter     = m.ruta.clasificRuta === 'Interregional';
      const row = [
        grupoNombre, m.ruta.codigo, m.ruta.destino || '', m.ruta.clasificRuta || '',
        capKg || '', m.km,
        Math.round(m.item1_peajes), Math.round(m.combIda || 0), Math.round(m.combVuelta || 0),
        Math.round(seguros), Math.round(extraT),
        Math.round(m.item5_mantKm), Math.round(m.item6_neumKm), Math.round(m.item7_gpsKm),
        Math.round(m.item8_choferBaseDiario), Math.round(m.item9_varChofer),
        (m.factorRuta || 1).toFixed(2),
        Math.round(m.costoVuelta || 0), Math.round(m.item10_costoRutaTotal), Math.round(m.item11_costoKmFinal)
      ];
      if (showPeso) row.push(esInter ? '' : pct.toFixed(2), esInter ? '' : tarifaPond);
      return row;
    });
    downloadFile(`motor_costo_${mcTipoRuta}_${Date.now()}.csv`, toCSV(csvH, rows));
    showAlert('CSV exportado');
  });
}
