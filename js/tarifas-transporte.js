// PANTALLA 1: Administrador de Tarifas Transporte — SIT EBEMA
// Sub-módulos: Peajes, Combustibles y Rendimientos, Seguros y Permisos,
// Variables Generales y Motor Actuarial (ZCAP) con exportación CSV.
import { getDatabase, saveDatabase, getCentreName, getTariffConfig, truckCapKg, getOrigenGroups, getGroupRepId, buildTruckTypes, TRUCK_BASE_TYPES } from './data.js';
import { CAP_LIST, truckTypesWithCap, calcularMatrizCostos } from './tarifas-engine.js';
import { formatCLP, parseCSV, showAlert, toCSV, downloadFile, escapeHtml } from './utils.js';
import { supabase } from './supabase-client.js';
import { getField } from './zonas-transporte.js';

let activeSub = 'peajes';

// Estado de filtros de la vista "Peajes por Ruta — Cálculo Automático"
let pjFiltroTexto = '';
let pjFiltroComuna = '';
let pjFiltroCentro = '';
let pjFiltroClasificacion = '';
let pjFiltroPendientes = false;
let pjFiltroTipo = '';

// Estado de filtros de la vista "Motor ZCAP — Resultados"
let zcapFiltroCentro = ''; // origen_grupo (Centro Origen); '' = todos
let zcapFiltroClasif = ''; // 'Regional' | 'Interregional'; '' = todas
let tarifaCentroFiltro = '';

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
  return `<input type="number" step="any" class="${inputCls}" data-path="${path}" value="${value ?? 0}" ${extra}>`;
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

// ---------- Vista principal ----------
export function renderTariffTransportView(container) {
  const db = getDatabase();
  const cfg = getTariffConfig(db);

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administrador de Tarifas Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Gestione las variables operacionales y monetarias que alimentan el motor actuarial de costos (ZCAP) por ruta y tipo de camión.</p>
    </div>

    <div class="flex gap-sm mb-lg border-b border-outline-variant pb-sm overflow-x-auto" id="tt-subtabs">
      ${subTabButton('peajes', 'toll', 'Peajes')}
      ${subTabButton('camiones', 'local_shipping', 'Tarifas por Camión')}
      ${subTabButton('combustibles', 'local_gas_station', 'Combustibles y Rendimientos')}
      ${subTabButton('seguros', 'shield', 'Seguros y Permisos')}
      ${subTabButton('variables', 'tune', 'Variables Generales')}
      ${subTabButton('resultados', 'calculate', 'Motor ZCAP')}
    </div>

    <div id="tt-content"></div>
  `;

  document.querySelectorAll('.tt-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSub = btn.dataset.sub;
      renderSub();
    });
  });

  renderSub();

  function renderSub() {
    document.querySelectorAll('.tt-subtab').forEach(btn => {
      btn.className = btn.dataset.sub === activeSub
        ? 'tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-primary text-white cursor-pointer whitespace-nowrap'
        : 'tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary hover:text-primary cursor-pointer whitespace-nowrap';
    });

    const content = document.getElementById('tt-content');
    switch (activeSub) {
      case 'peajes': renderPeajes(content, db, cfg); break;
      case 'camiones': renderTarifasCamion(content, db, cfg); break;
      case 'combustibles': renderCombustibles(content, db, cfg); break;
      case 'seguros': renderSeguros(content, db, cfg); break;
      case 'variables': renderVariables(content, db, cfg); break;
      case 'resultados': renderResultados(content, db, cfg); break;
    }

    // Listener delegado para todas las celdas editables con data-path
    content.addEventListener('change', (e) => {
      const path = e.target.dataset.path;
      if (!path) return;
      let val = e.target.value;
      if (e.target.type === 'number') val = val === '' ? 0 : Number(val);
      setPath(cfg, path, val);
      saveDatabase(db);
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

// Vista combinada: cálculo automático (route_tolls) + registro manual (cfg.peajes)
function renderPeajes(content, db, cfg) {
  renderPeajesAuto(content, db, cfg);
}

// ---------- Cálculo Automático de Peajes (Google Routes API) ----------
function renderPeajesAuto(content, db, cfg) {
  const routes = (db.routes || []).filter(r => r.activo);

  // COMMUNE filter: only zones with tipo=COMUNA
  const zonasComunas = (db.transportZones || []).filter(z => z.tipo === 'Comuna');
  const comunasDisponibles = [...new Map(
    zonasComunas.map(z => [z.zona, { id: z.zona, label: z.denominacion || z.zona }])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));

  // Centro Origen: groups
  const grupos = getOrigenGroups(db);
  const centrosOrigen = grupos.map(g => ({ id: g.grupo, nombre: g.nombre }));

  // Construir filas (ruta x tipo de eje)
  let rows = [];
  routes.forEach(ruta => {
    [2, 3].forEach(ejes => {
      rows.push({ ruta, ejes, toll: pjGetTollRow(db, ruta.id, ejes) });
    });
  });

  // Aplicar filtros de pantalla
  if (pjFiltroComuna) {
    rows = rows.filter(r => r.ruta.id_zona_transporte === pjFiltroComuna);
  }
  if (pjFiltroTipo) {
    rows = rows.filter(r => {
      const z = (db.transportZones || []).find(z => z.zona === r.ruta.id_zona_transporte);
      return z && z.tipo === pjFiltroTipo;
    });
  }
  if (pjFiltroCentro) {
    const g = grupos.find(g => g.grupo === pjFiltroCentro);
    if (g) rows = rows.filter(r => g.centroIds.includes(r.ruta.origenId));
  }
  if (pjFiltroClasificacion) {
    rows = rows.filter(r => r.ruta.clasificRuta === pjFiltroClasificacion);
  }
  if (pjFiltroPendientes) {
    rows = rows.filter(r => !r.toll || !r.toll.calculado_en || r.toll.needs_review);
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, PJ_DISPLAY_LIMIT);

  let pendientesCount = 0;
  routes.forEach(ruta => {
    [2, 3].forEach(ejes => {
      const t = pjGetTollRow(db, ruta.id, ejes);
      if (!t || !t.calculado_en) pendientesCount++;
    });
  });
  const revisionCount = (db.routeTolls || []).filter(t => t.needs_review).length;

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">toll</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Peajes por Ruta — Cálculo Automático</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Calcula el costo de peaje de Ida y Vuelta de cada ruta vía Google Routes API, según el tipo de camión
        (2 ejes: 5 y 10 Ton · 3 ejes: 15 y 28 Ton). El cálculo se ejecuta a demanda y queda registrado para no
        repetirse. Las rutas sin peaje quedan en $0; las rutas donde se detectó un peaje sin valor disponible
        quedan marcadas <b>Para revisión</b> y todos los valores son editables manualmente.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-md mb-md">
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Rutas Activas</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${routes.length}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Combinaciones (Ruta × Tipo Camión)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${routes.length * 2}</p>
        </div>
        <button id="pj-kpi-pendientes" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors">
          <p class="font-label-caps text-label-caps text-secondary">Sin Calcular</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${pendientesCount}</p>
        </button>
        <button id="pj-kpi-revision" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors">
          <p class="font-label-caps text-label-caps text-secondary">Para Revisión</p>
          <p class="font-headline-sm text-headline-sm font-bold ${revisionCount > 0 ? 'text-primary' : 'text-on-surface'}">${revisionCount}</p>
        </button>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">TIPO</label>
          <select id="pj-f-tipo" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-36">
            <option value="">Todos</option>
            <option value="Comuna" ${pjFiltroTipo === 'Comuna' ? 'selected' : ''}>COMUNA</option>
            <option value="Sector" ${pjFiltroTipo === 'Sector' ? 'selected' : ''}>SECTOR</option>
          </select>
        </div>
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
          <label class="font-label-caps text-label-caps text-secondary block">CLASIFICACIÓN</label>
          <select id="pj-f-clasif" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-40">
            <option value="">Todas</option>
            <option value="Regional" ${pjFiltroClasificacion === 'Regional' ? 'selected' : ''}>Regional</option>
            <option value="Interregional" ${pjFiltroClasificacion === 'Interregional' ? 'selected' : ''}>Interregional</option>
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
        <button id="pj-calcular-km" class="bg-secondary hover:bg-[#4a5568] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">straighten</span> Calcular KM
        </button>
        <button id="pj-calcular" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">calculate</span> Calcular Peajes
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
                const grupo = grupos.find(g => g.centroIds.includes(ruta.origenId));
                const origenNombre = grupo ? grupo.nombre : (getCentreName(db, ruta.origenId) || '');
                const kmTotal = toll && toll.km_ida != null ? (toll.km_ida * 2).toFixed(1) : '—';
                let estado;
                if (!toll || !toll.calculado_en) {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN CALCULAR</span>`;
                } else if (toll.not_found) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 text-amber-800 font-label-caps text-[10px]" title="Destino no encontrado en catálogo GetAPI — ingresar peaje manualmente"><span class="material-symbols-outlined text-[14px]">location_off</span> SIN COBERTURA</span>`;
                } else if (toll.needs_review) {
                  estado = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">warning</span> REVISIÓN</span>`;
                } else {
                  estado = `<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">OK</span>`;
                }
                const trCls = toll && toll.needs_review ? 'border-b border-outline-variant bg-red-50' : 'border-b border-outline-variant';
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

  document.getElementById('pj-f-tipo').addEventListener('change', (e) => { pjFiltroTipo = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-comuna').addEventListener('change', (e) => { pjFiltroComuna = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-origen').addEventListener('change', (e) => { pjFiltroCentro = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-clasif').addEventListener('change', (e) => { pjFiltroClasificacion = e.target.value; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-f-pend').addEventListener('change', (e) => { pjFiltroPendientes = e.target.checked; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-kpi-pendientes').addEventListener('click', () => { pjFiltroPendientes = true; pjFiltroTipo = ''; pjFiltroComuna = ''; pjFiltroCentro = ''; pjFiltroClasificacion = ''; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-kpi-revision').addEventListener('click', () => { pjFiltroPendientes = true; pjFiltroTipo = ''; pjFiltroComuna = ''; pjFiltroCentro = ''; pjFiltroClasificacion = ''; renderPeajesAuto(content, db, cfg); });
  document.getElementById('pj-export').addEventListener('click', () => exportPeajesCSV(db, rows));
  document.getElementById('pj-carga-comuna').addEventListener('click', () => abrirModalCargaPeajesComuna(content, db, cfg));

  // Select-all checkbox
  document.getElementById('pj-check-all').addEventListener('change', (e) => {
    content.querySelectorAll('.pj-row-check').forEach(cb => { cb.checked = e.target.checked; });
  });

  // Calcular KM: solo rutas seleccionadas, o todas las filtradas si ninguna seleccionada
  document.getElementById('pj-calcular-km').addEventListener('click', () => {
    const checked = [...content.querySelectorAll('.pj-row-check:checked')].map(cb => cb.dataset.routeId);
    let rutasTarget;
    if (checked.length > 0) {
      rutasTarget = [...new Set(checked)].map(id => routes.find(r => r.id === id)).filter(Boolean);
    } else {
      rutasTarget = [...new Set(rows.map(r => r.ruta))];
    }
    calcularKm(content, db, cfg, rutasTarget);
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

  content.querySelectorAll('[data-calc-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ruta = routes.find(r => r.id === btn.dataset.calcRoute);
      // force: true — el usuario pidió explícitamente recalcular esta ruta, ignorar caché
      if (ruta) calcularPeajes(content, db, cfg, [ruta], { force: true });
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
    const grupo  = grupos.find(g => g.centroIds.includes(ruta.origenId));
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
  // GetAPI Chile acepta SOLO el nombre de la ciudad/comuna — no acepta "Ciudad, Región".
  return {
    origin:      String(origenObj.comuna || '').trim(),
    destination: String(destinoObj.comuna || '').trim()
  };
}

// Invoca la Edge Function 'getapi-tolls' (proxy seguro hacia chile.getapi.cl)
// Usa /route-cost con nombres de ciudad (el plan actual no incluye /route-cost-by-coords).
// Homologación:
//   ejes=2 (5t/10t) → CAMION_2_EJES
//   ejes=3 (15t/28t) → CAMION_PESADO
// Si la ciudad de destino no está en la lista de 31 ciudades GetAPI,
// retorna { tollCLP: 0, hasToll: false, notFound: true } — sin error, sin peaje.
async function callGetApiTolls(originCity, destCity, category) {
  const { data, error } = await supabase.functions.invoke('getapi-tolls', {
    body: { originCity, destCity, category }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data; // { tollCLP, hasToll, tollsCount, details, notFound? }
}

async function callGoogleDistance(originLat, originLng, destLat, destLng) {
  const { data, error } = await supabase.functions.invoke('google-distance', {
    body: { originLat, originLng, destLat, destLng }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data; // { distanceKm, durationMin, distanceText, durationText }
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
  row.peaje_ida    = ida    ? Math.round(ida.tollCLP    || 0) : 0;
  row.peaje_vuelta = vuelta ? Math.round(vuelta.tollCLP || 0) : 0;
  row.km_ida    = ida    && ida.distanceMeters    != null ? Math.round(ida.distanceMeters    / 100) / 10 : null;
  row.km_vuelta = vuelta && vuelta.distanceMeters != null ? Math.round(vuelta.distanceMeters / 100) / 10 : null;

  // Desglose por tipo de peaje (v5 Edge Function)
  row.mainline_ida    = ida    ? Math.round(ida.mainlineCLP    || 0) : 0;
  row.ramp_ida        = ida    ? Math.round(ida.rampCLP        || 0) : 0;
  row.electronic_ida  = ida    ? Math.round(ida.electronicCLP  || 0) : 0;
  row.mainline_vuelta    = vuelta ? Math.round(vuelta.mainlineCLP    || 0) : 0;
  row.ramp_vuelta        = vuelta ? Math.round(vuelta.rampCLP        || 0) : 0;
  row.electronic_vuelta  = vuelta ? Math.round(vuelta.electronicCLP  || 0) : 0;

  // needs_review si:
  //   - Sin resultado de API (error de red)
  //   - notFound: ciudad no encontrada en GetAPI → no podemos confirmar si hay peaje → revisión manual
  //   - hasToll=true pero tollCLP=0 → dato inconsistente
  // notFound=false Y hasToll=false → ruta confirmada sin peaje → $0 correcto, no revisa
  const idaReview    = !ida    || !!ida.notFound    || (ida.hasToll    && !ida.tollCLP);
  const vueltaReview = !vuelta || !!vuelta.notFound || (vuelta.hasToll && !vuelta.tollCLP);
  row.needs_review = !!(idaReview || vueltaReview);
  // Guardar motivo de revisión para mostrar en tabla
  // Usar snake_case para que coincida con columna DB y persista en Supabase
  if ((ida && ida.notFound) || (vuelta && vuelta.notFound)) {
    row.not_found = true;
  } else {
    row.not_found = false;
  }
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
    saveDatabase(db);
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

// Orquesta el cálculo (a demanda) de peajes para las rutas indicadas usando GetAPI Chile.
// Homologación:
//   2 ejes (5t / 10t) → CAMION_2_EJES
//   3 ejes (15t / 28t) → CAMION_PESADO
// Se hacen hasta 4 consultas por ruta (2 categorías × Ida + Vuelta).
// Con force=false (modo masivo): omite rutas/ejes que ya tienen caché válida (calculado_en + !needs_review).
// Con force=true (por-fila): siempre reconsulta la API, ignorando caché.
// GetAPI no retorna distancia → el campo KM queda vacío.
async function calcularPeajes(content, db, cfg, rutas, { force = false } = {}) {
  if (!rutas || rutas.length === 0) {
    showAlert('No hay rutas para calcular con los filtros actuales', 'error');
    return;
  }
  const targets = rutas.filter(r => r.lat != null && r.lon != null);
  const sinCoords = rutas.length - targets.length;

  // Calcular cuántos pares (ruta × ejes) ya tienen caché válida para informar al usuario
  const pairesEnCache = force ? 0 : targets.reduce((n, r) =>
    n + [2, 3].filter(e => {
      const c = pjGetTollRow(db, r.id, e);
      return c && c.calculado_en && !c.needs_review;
    }).length, 0);
  const consultasReales = (targets.length * 4) - (pairesEnCache * 2); // cada par en caché omite ida+vuelta
  const estSeg = Math.max(consultasReales, 1); // ~1s por consulta
  const estMin = estSeg < 60 ? `~${estSeg}s` : `~${Math.ceil(estSeg / 60)} min`;
  const aviso = sinCoords > 0 ? `\n${sinCoords} ruta(s) sin coordenadas quedarán marcadas para revisión.` : '';
  const avisoCache = !force && pairesEnCache > 0
    ? `\n${pairesEnCache} par(es) ruta×ejes ya tienen caché válida y serán omitidos.\nUsa el botón ↺ por fila para forzar actualización de una ruta específica.`
    : '';
  const resumenConsultas = !force && pairesEnCache > 0
    ? `Consultas reales: ~${consultasReales} (${pairesEnCache} par(es) omitidos por caché). Tiempo estimado: ${estMin}.`
    : `Ida + Vuelta × 2 ejes y 3 ejes = ${targets.length * 4} consultas. Tiempo estimado: ${estMin}.`;
  const msgConfirm = force
    ? `Se recalcularán peajes (forzado) para ${targets.length} ruta(s).\n${resumenConsultas}${aviso}\n\nHomologación: 2 ejes → CAMION_2_EJES · 3 ejes → CAMION_PESADO\n¿Continuar?`
    : `Se calcularán peajes (vía GetAPI Chile) para ${targets.length} ruta(s).\n${resumenConsultas}${aviso}${avisoCache}\n\nHomologación: 2 ejes → CAMION_2_EJES · 3 ejes → CAMION_PESADO\n¿Continuar?`;
  if (!confirm(msgConfirm)) {
    return;
  }

  // Rutas sin coordenadas: marcar directamente para revisión
  rutas.filter(r => r.lat == null || r.lon == null).forEach(ruta => {
    [2, 3].forEach(ejes => pjUpsertToll(db, ruta.id, ejes, null, null, { error: true }));
  });

  const modal = createProgressModal(targets.length);
  let cancelado = false;
  modal.cancelBtn.addEventListener('click', () => { cancelado = true; });

  // Mapa ejes → categoría GetAPI
  const ejesToCategory = { 2: 'CAMION_2_EJES', 3: 'CAMION_PESADO' };

  for (let i = 0; i < targets.length; i++) {
    if (cancelado) break;
    const ruta = targets[i];
    const cd = (db.logisticsCentres || []).find(c => c.id === ruta.origenId);
    modal.update(i, targets.length, `${ruta.codigo} — ${ruta.comuna || ruta.destino || ''} (${ruta.region || ''})`);

    // Origen: requiere campos comuna+region en logistics_centres (migración 2026-06)
    if (!cd.comuna || !cd.region) {
      console.warn('Centro sin commune/region configurado:', cd.id, cd.nombre);
      [2, 3].forEach(ejes => pjUpsertToll(db, ruta.id, ejes, null, null, { error: true }));
      continue;
    }
    // Destino: campos comuna+region del registro de ruta
    if (!ruta.comuna || !ruta.region) {
      console.warn('Ruta sin commune/region:', ruta.codigo);
      [2, 3].forEach(ejes => pjUpsertToll(db, ruta.id, ejes, null, null, { error: true }));
      continue;
    }

    // Construir parámetros en formato "NombreComuna, NombreRegion"
    const { origin: originCity, destination: destCity } = construirParametrosRuta(
      { comuna: cd.comuna,   region: cd.region   },
      { comuna: ruta.comuna, region: ruta.region }
    );

    for (const ejes of [2, 3]) {
      // Caché: si ya existe un resultado válido (calculado_en + sin revisión pendiente)
      // y NO estamos en modo forzado, reutilizar el valor guardado sin llamar a la API.
      if (!force) {
        const cached = pjGetTollRow(db, ruta.id, ejes);
        if (cached && cached.calculado_en && !cached.needs_review) {
          continue; // hit de caché — omitir consulta API para este par ruta×ejes
        }
      }

      const category = ejesToCategory[ejes];
      let ida = null, vuelta = null, errored = false;
      try {
        ida = await callGetApiTolls(originCity, destCity, category);
        await sleep(500);
        // Si destino no está en GetAPI (notFound), vuelta también queda en $0
        if (!ida || ida.notFound) {
          vuelta = ida; // mismo resultado: $0, no hay peaje en esa ruta
        } else {
          vuelta = await callGetApiTolls(destCity, originCity, category);
          await sleep(500);
        }
      } catch (err) {
        console.error('Error calculando peajes GetAPI para', ruta.codigo, ejes, 'ejes', err);
        errored = true;
      }

      // GetAPI no retorna distanceMeters → km_ida/km_vuelta quedan null.
      pjUpsertToll(db, ruta.id, ejes, ida, vuelta, { error: errored });
      if (cancelado) break;
    }

    if ((i + 1) % 10 === 0) saveDatabase(db);
  }

  modal.update(targets.length, targets.length, cancelado ? 'Cancelado' : 'Finalizado');
  saveDatabase(db);
  modal.close();
  showAlert(cancelado ? 'Cálculo de peajes cancelado (avance guardado)' : 'Cálculo de peajes finalizado');
  renderPeajesAuto(content, db, cfg);
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
    const cd = (db.logisticsCentres || []).find(c => c.id === ruta.origenId);
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

    if ((i + 1) % 10 === 0) saveDatabase(db);
  }

  modal.update(targets.length, targets.length, cancelado ? 'Cancelado' : 'Finalizado');
  saveDatabase(db);
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
      <p class="text-[12px] text-secondary mb-md">Este registro detallado por plaza de peaje se usa como respaldo del Motor ZCAP solo cuando una ruta no tiene un cálculo automático (sección anterior). Los cobros aquí son simétricos (Ida y Vuelta procesan el mismo valor). Mapeo fijo de ejes: 5.000 y 10.000 kg = 2 ejes · 15.000 y 28.000 kg = 3 ejes.</p>

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

// Recalcula Tarifa/KM (costo/km final del Motor ZCAP + margen de ganancia,
// promedio de rutas activas del Centro Origen para esa capacidad) y Tarifa
// Base (Tarifa/KM x Km Base) para cada tipo de camión, persistiendo en
// db.truckTypes si hubo cambios. Si se indica grupoFiltro (origen_grupo),
// solo recalcula ese Centro Origen; en caso contrario recalcula todos.
// Devuelve un Set con los ids de tipos de camión que sí tienen rutas activas
// (y por tanto valor ZCAP vigente).
function syncTarifasZcap(db, cfg, grupoFiltro = '') {
  const groups = getOrigenGroups(db).filter(g => !grupoFiltro || g.grupo === grupoFiltro);
  const matriz = calcularMatrizCostos(db, cfg);
  const margenPct = Number(cfg.variables.margenGanancia) || 0;
  const conZcap = new Set();
  let cambios = false;

  groups.forEach(g => {
    const rows = (db.truckTypes || []).filter(t => t.Id_centro === g.repId);
    rows.forEach(t => {
      const items = matriz.filter(m => g.centroIds.includes(m.centroId) && m.capKg === truckCapKg(t.type));
      if (items.length === 0) return;
      conZcap.add(t.id);
      const avgCostoKmFinal = items.reduce((s, m) => s + m.item11_costoKmFinal, 0) / items.length;
      const ratePerKm = Math.round(avgCostoKmFinal * (1 + margenPct / 100));
      if (t.ratePerKm !== ratePerKm) {
        t.ratePerKm = ratePerKm;
        cambios = true;
      }
    });
  });

  if (cambios) saveDatabase(db);
  return conZcap;
}

function renderTarifasCamion(content, db, cfg) {
  const allGroups = getOrigenGroups(db);
  const groups = tarifaCentroFiltro
    ? allGroups.filter(g => g.grupo === tarifaCentroFiltro)
    : allGroups;
  const conZcap = syncTarifasZcap(db, cfg);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">local_shipping</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Tarifas de Transporte por Centro y Tipo de Camión</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Tarifa Base (KM) es editable directamente. Tarifa/KM se calcula automáticamente desde el Motor ZCAP (costo/km final promedio de las rutas activas del centro, con margen de ganancia) y es de solo lectura. Km Base y Costo Base son editables y definen el tramo de referencia.</p>

      <div class="flex items-end gap-sm mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="tt-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
            <option value="">Todos</option>
            ${allGroups.map(g => `<option value="${escapeHtml(g.grupo)}" ${g.grupo === tarifaCentroFiltro ? 'selected' : ''}>${escapeHtml(g.nombre)}</option>`).join('')}
          </select>
        </div>
      </div>

      ${groups.map(g => {
        const rows = (db.truckTypes || []).filter(t => t.Id_centro === g.repId);
        const integrantes = g.centros.length > 1
          ? ` <span class="text-secondary text-[12px]">(${g.centros.map(c => c.nombre).join(', ')})</span>`
          : '';
        return `
        <div class="mb-lg">
          <div class="flex items-center justify-between mb-xs">
            <h3 class="font-body-lg text-body-lg font-bold text-on-surface">${g.nombre} <span class="text-secondary font-data-mono text-[12px]">(${g.centroIds.join(', ')})</span>${integrantes}</h3>
            ${rows.length === 0 ? `
            <button class="tt-add-types bg-primary hover:bg-[#930007] text-white font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase" data-grupo="${g.grupo}">
              <span class="material-symbols-outlined text-[16px]">add</span> Agregar tipo de camión
            </button>` : ''}
          </div>
          <div class="bg-surface border border-outline-variant overflow-hidden rounded">
            <table class="w-full zebra-table border-collapse">
              <thead>
                <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Capacidad</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Km Base</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Base</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Tarifa Base (KM)</th>
                  <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Tarifa / KM</th>
                </tr>
              </thead>
              <tbody class="font-body-md text-body-md">
                ${rows.length === 0 ? `<tr><td colspan="6" class="p-md text-center text-secondary">Sin tipos de camión configurados para este centro. Use "Agregar tipo de camión" para crear los 4 tipos estándar (5/10/15/28 Ton).</td></tr>` :
                  rows.map(t => `
                  <tr class="border-b border-outline-variant">
                    <td class="p-md font-bold">${t.type}</td>
                    <td class="p-md">${t.capacityTons}</td>
                    <td class="p-md w-28">${truckNumInput(t.id, 'Kmbase', t.Kmbase)}</td>
                    <td class="p-md w-32">${truckNumInput(t.id, 'baseKM', t.baseKM)}</td>
                    <td class="p-md w-32">${truckNumInput(t.id, 'baseRate', t.baseRate)}</td>
                    <td class="p-md w-28 text-right font-data-mono">${formatCLP(t.ratePerKm)}${conZcap.has(t.id) ? '' : `<div class="text-[11px] text-secondary normal-case">Sin rutas activas</div>`}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  content.querySelectorAll('[data-truck-id]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const id = e.target.dataset.truckId;
      const field = e.target.dataset.truckField;
      const val = e.target.value === '' ? 0 : Number(e.target.value);
      const row = (db.truckTypes || []).find(t => t.id === id);
      if (row) row[field] = val;
      saveDatabase(db);
      if (field === 'Kmbase') renderTarifasCamion(content, db, cfg);
    });
  });

  document.getElementById('tt-f-centro').addEventListener('change', (e) => {
    tarifaCentroFiltro = e.target.value;
    renderTarifasCamion(content, db, cfg);
  });

  content.querySelectorAll('.tt-add-types').forEach(btn => {
    btn.addEventListener('click', () => {
      const grupo = getOrigenGroups(db).find(g => g.grupo === btn.dataset.grupo);
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
const CNE_FUNCTION_URL = 'https://deetqblpfobwqioyfkiu.supabase.co/functions/v1/cne-diesel-price';

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
        Alerta crítica si un centro pasa más de 3 semanas sin actualizar su precio.
        <b>Actualizar desde CNE</b> obtiene el precio del Petróleo Diésel de la última semana publicada por la CNE.
        Editar manualmente un precio lo marca como <i>Manual</i> y resetea la fecha a hoy.
      </p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Precio Litro (CLP)</th>
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
              return `<tr class="border-b border-outline-variant" data-repid="${g.repId}">
                <td class="p-md font-bold">${g.nombre}${integrantes}</td>
                <td class="p-md w-40">${numInput(`combustibles.${g.repId}.precioLitro`, fuel.precioLitro, 'data-combustible-repid="' + g.repId + '" data-combustible-field="precio"')}</td>
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

  // ── Listener: edición manual de precio o fecha → fuente=Manual, fecha=hoy si es precio
  content.querySelectorAll('[data-combustible-repid]').forEach(input => {
    input.addEventListener('change', () => {
      const repId = input.dataset.combustibleRepid;
      const field = input.dataset.combustibleField;
      if (!repId || !cfg.combustibles[repId]) return;
      cfg.combustibles[repId].fuente = 'manual';
      // Si cambió el precio, resetear fecha a hoy
      if (field === 'precio') {
        const hoyStr = todayISO();
        cfg.combustibles[repId].fecha = hoyStr;
        // Actualizar el date input visualmente
        const fechaInput = content.querySelector(`[data-path="combustibles.${repId}.fecha"]`);
        if (fechaInput) fechaInput.value = hoyStr;
      }
      // Limpiar metadata CNE al editar manualmente
      delete cfg.combustibles[repId].cneRegion;
      delete cfg.combustibles[repId].cneMes;
      delete cfg.combustibles[repId].cneAnio;
      saveDatabase(db);
      // Re-render para actualizar badge Fuente y estado días
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
      <p class="text-[12px] text-secondary mb-md">Valor anual promediado de SOAP, igual para todos los centros (valor transversal). Se aplica internamente en el Motor ZCAP para cada centro según el tipo de camión.</p>
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

    <!-- Costos Base (Referencia) -->
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Estructura de Costos Base y Tramos KM Adicionales (Referencia)</h3>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ítem</th>
              ${CAP_LIST.map(cap => `<th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">${(cap / 1000)}.000 kg</th>`).join('')}
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            <tr class="border-b border-outline-variant">
              <td class="p-md font-bold">Costo Base Fijo</td>
              ${CAP_LIST.map(cap => `<td class="p-md w-32">${numInput(`variables.costosBase.${cap}.fijo`, v.costosBase[cap].fijo)}</td>`).join('')}
            </tr>
            <tr class="border-b border-outline-variant">
              <td class="p-md font-bold">KM Base Adicional (Hasta 50KM)</td>
              ${CAP_LIST.map(cap => `<td class="p-md w-32">${numInput(`variables.costosBase.${cap}.kmAdicional`, v.costosBase[cap].kmAdicional)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
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
  let matriz = calcularMatrizCostos(db, cfg);
  if (zcapFiltroCentro) matriz = matriz.filter(m => m.ruta.origen_grupo === zcapFiltroCentro);
  if (zcapFiltroClasif) matriz = matriz.filter(m => m.ruta.clasificRuta === zcapFiltroClasif);

  const grupoSel = groups.find(g => g.grupo === zcapFiltroCentro);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">calculate</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Motor Actuarial — Resultados ZCAP</h2>
        </div>
        <div class="flex items-center gap-sm">
          <button id="zcap-actualizar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Tarifas (Motor ZCAP)
          </button>
          <button id="zcap-export" class="bg-surface border border-outline-variant hover:bg-surface-container-high text-on-surface font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar CSV
          </button>
        </div>
      </div>
      <p class="text-[12px] text-secondary mb-md">Calculado para las rutas activas y los tipos de camión según los filtros aplicados, con las variables configuradas en los sub-módulos anteriores. "Actualizar Tarifas" recalcula y guarda Tarifa/KM y Tarifa Base (Tarifa por Camión) para el Centro Origen filtrado, o para todos si no hay filtro.</p>

      <div class="flex flex-wrap items-end gap-md mb-md">
        <div>
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="zcap-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-56">
            <option value="">Todos</option>
            ${groups.map(g => `<option value="${g.grupo}" ${zcapFiltroCentro === g.grupo ? 'selected' : ''}>${g.nombre}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="font-label-caps text-label-caps text-secondary block">CLASIFICACIÓN</label>
          <select id="zcap-f-clasif" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-40">
            <option value="">Todas</option>
            <option value="Regional" ${zcapFiltroClasif === 'Regional' ? 'selected' : ''}>Regional</option>
            <option value="Interregional" ${zcapFiltroClasif === 'Interregional' ? 'selected' : ''}>Interregional</option>
          </select>
        </div>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Clasificación</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Ejes</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peajes</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Combustible</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Ruta Total</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo/KM Final</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right bg-primary/5">ZCAP</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${matriz.length === 0 ? `<tr><td colspan="11" class="p-md text-center text-secondary">Sin resultados para los filtros seleccionados.</td></tr>` :
              matriz.map(m => `
              <tr class="border-b border-outline-variant">
                <td class="p-md">${getCentreName(db, m.centroId)}</td>
                <td class="p-md font-bold">${m.ruta.codigo} — ${m.ruta.destino}</td>
                <td class="p-md">${m.ruta.clasificRuta || ''}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${m.km}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(m.item1_peajes)}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(m.item2_combustible)}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(m.item10_costoRutaTotal)}</td