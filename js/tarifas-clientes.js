// MÓDULO: Administrador de Tarifas Clientes — SIT EBEMA v2.1
// Vistas: Histórico (6M) | Consolidación | Densidad Logística | Frecuencia y Especiales | Cluster | Resultados
import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig, saveHistorico, loadHistorico } from './data.js?v=20260629a';
import { CAP_LIST, truckTypesWithCap, calcularCostoRuta } from './tarifas-engine.js';
import { formatCLP, showAlert, toCSV, downloadFile, formatDateDDMMYYYY } from './utils.js';

// ─────────────────────────────────────────────────────────────
// ESTADO DE MÓDULO
// ─────────────────────────────────────────────────────────────
let histData          = [];   // filas parseadas del CSV
let histPage          = 0;
let histFilterGrupo   = 'all';
let histFilterEstado  = 'all';
let clusterFiltGrupo  = 'all';
let clusterFiltTipo   = 'all';
let clusterFiltClasif = 'all';
let activeSubC        = 'historico';
// Mapa Oficina Entrega (SAP) → origen_grupo (nombre de ciudad/grupo)
// Calculado al cargar CSV cruzando con db.routes.origen_grupo
let oficinaToGrupo    = {};

// ─────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────
const CAP_BUCKETS = [5, 10, 15, 28];
const CAP_LABELS  = { 5: '≤5T', 10: '10T', 15: '15T', 28: '28T' };
const PAGE_SIZE   = 200;
const VALIDEZ_A   = '31-12-2026';

// Defaults para clusters iniciales
const DEFAULT_CLUSTERS = [
  { key: '1',    nombre: 'Cluster 1 — Alta densidad',   color: '#b5000b', nv: 98, frecuencia: 'Diario',          tipo0000: 0, tipo0000Habilitado: true },
  { key: '2',    nombre: 'Cluster 2 — Media densidad',  color: '#d97706', nv: 96, frecuencia: 'Bi-semanal',      tipo0000: 0, tipo0000Habilitado: true },
  { key: '3',    nombre: 'Cluster 3 — Baja densidad',   color: '#16a34a', nv: 95, frecuencia: 'Semanal',         tipo0000: 0, tipo0000Habilitado: false },
  { key: 'spot', nombre: 'SPOT / Interregional',        color: '#6b7280', nv: 90, frecuencia: 'Según demanda',   tipo0000: 0, tipo0000Habilitado: false }
];
const NEXT_CAP = { 5000: 10000, 10000: 15000, 15000: 28000, 28000: 28000 };

// ─────────────────────────────────────────────────────────────
// HELPERS GRUPOS
// ─────────────────────────────────────────────────────────────
function getCentroGroup(oficina) {
  return oficinaToGrupo[String(oficina)] || `Centro ${oficina}`;
}

function allGroups() {
  if (!histData.length) return [];
  const s = new Set(histData.map(r => getCentroGroup(r.oficina)));
  return [...s].sort();
}

// Calcula la relación Oficina SAP → origen_grupo a partir de las rutas del CSV
function computeOficinaGrupos(db, rows) {
  const counts = {}; // { oficina: { grupo: count } }
  rows.forEach(r => {
    const route = findRoute(db, r.idRuta);
    const grupo  = route?.origen_grupo;
    if (!grupo) return;
    if (!counts[r.oficina]) counts[r.oficina] = {};
    counts[r.oficina][grupo] = (counts[r.oficina][grupo] || 0) + 1;
  });
  const result = {};
  Object.entries(counts).forEach(([oficina, grupoCounts]) => {
    result[oficina] = Object.entries(grupoCounts).sort((a, b) => b[1] - a[1])[0][0];
  });
  // Fallback para oficinas sin rutas en db
  rows.forEach(r => {
    if (!result[r.oficina]) result[r.oficina] = `Centro ${r.oficina}`;
  });
  return result;
}

// ─────────────────────────────────────────────────────────────
// HELPERS RUTAS / ZONAS
// ─────────────────────────────────────────────────────────────
function findRoute(db, idRuta) {
  return (db.routes || []).find(r =>
    r.codigo && r.codigo.toLowerCase() === String(idRuta).toLowerCase()
  );
}

function getZone(db, zonaId) {
  return (db.transportZones || []).find(z => z.zona === String(zonaId));
}

// Para una ruta Sector: devuelve la comuna padre (via transport_zones)
function getSectorComunaPadre(db, route) {
  if (route?.tipo !== 'Sector') return null;
  const zoneId = route.id_zona_transporte || route.idZonaTrans;
  if (!zoneId) return null;
  const zone = getZone(db, zoneId);
  return zone?.comuna || null;
}

// ─────────────────────────────────────────────────────────────
// HELPERS CLUSTERS (trabaja con ccfg.clusters[])
// ─────────────────────────────────────────────────────────────
function clusterKeys(ccfg)         { return ccfg.clusters.map(c => c.key); }
function clusterByKey(ccfg, key)   { return ccfg.clusters.find(c => c.key === key); }
function clusterColor(ccfg, key)   { return clusterByKey(ccfg, key)?.color || '#6b7280'; }
function clusterNombre(ccfg, key)  { return clusterByKey(ccfg, key)?.nombre || key; }

function nextClusterKey(ccfg) {
  const nums = ccfg.clusters.map(c => parseInt(c.key, 10)).filter(n => !isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

// ─────────────────────────────────────────────────────────────
// PARSER CSV (punto y coma, windows-1252/latin-1)
// ─────────────────────────────────────────────────────────────
function parseHistCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map(h => h.trim());
  const col = (parts, h) => (parts[headers.indexOf(h)] || '').trim();
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(';');
    rows.push({
      fecha:           col(p, 'Fecha Transporte'),
      oficina:         col(p, 'Oficina Entrega'),
      documento:       col(p, 'Documento Transporte'),
      gasto:           Number(col(p, 'Gasto Transporte')) || 0,
      hes:             col(p, 'HES'),
      idCliente:       col(p, 'ID Cliente'),
      idObra:          col(p, 'ID Obra'),
      transportista:   col(p, 'Transportista'),
      capTons:         Number(col(p, 'Cap. Camión')) || 0,
      entrega:         col(p, 'Entrega'),
      idRuta:          col(p, 'ID Ruta'),
      idTransportista: col(p, 'ID Transportista'),
      ton:             parseFloat((col(p, 'Ton') || '0').replace(',', '.')) || 0
    });
  }
  return rows.filter(r => r.documento && r.idRuta && r.idRuta !== '(en blanco)');
}

function getCapBucket(capTons) {
  const n = Number(capTons);
  if (n <= 5)  return 5;
  if (n <= 10) return 10;
  if (n <= 15) return 15;
  return 28;
}

// ─────────────────────────────────────────────────────────────
// HELPERS UI
// ─────────────────────────────────────────────────────────────
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
  return path.split('.').reduce((c, p) => (c == null ? fallback : c[p]), obj) ?? fallback;
}

const inputCls  = 'w-full border border-[#CED4DA] p-xs font-data-mono text-data-mono text-right focus:border-primary focus:ring-0 bg-white rounded';
const selectCls = 'border border-[#CED4DA] px-sm py-xs font-body-md text-body-md focus:border-primary focus:ring-0 bg-white rounded';

function numInput(path, val, extra = '')  { return `<input type="number" step="any" class="${inputCls}" data-path="${path}" value="${val ?? 0}" ${extra}>`; }
function textInput(path, val, extra = '') { return `<input type="text" class="${inputCls} text-left" data-path="${path}" value="${val || ''}" ${extra}>`; }

function subTabButton(key, icon, label) {
  return `<button class="ct-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary cursor-pointer whitespace-nowrap" data-sub="${key}">
    <span class="material-symbols-outlined text-[16px]">${icon}</span> ${label}
  </button>`;
}

function ensureCcfg(ccfg) {
  // Migrar estructura vieja de dicts a nuevo array ccfg.clusters
  if (!ccfg.clusters || !Array.isArray(ccfg.clusters) || !ccfg.clusters.length) {
    const oN = ccfg.clusterNames       || {};
    const oC = ccfg.clusterColors      || {};
    const oV = ccfg.clusterNV          || {};
    const oF = ccfg.clusterFrecuencia  || {};
    const o0 = ccfg.especiales?.tipo0000 || {};
    ccfg.clusters = DEFAULT_CLUSTERS.map(def => ({
      key:       def.key,
      nombre:    oN[def.key]  || def.nombre,
      color:     oC[def.key]  || def.color,
      nv:        oV[def.key]  ?? def.nv,
      frecuencia:oF[def.key]  || def.frecuencia,
      tipo0000:  o0[def.key]  ?? def.tipo0000
    }));
  }
  // Asegurar campos tipo0000 y tipo0000Habilitado en cada cluster
  ccfg.clusters.forEach(c => {
    if (c.tipo0000 === undefined) c.tipo0000 = 0;
    if (c.tipo0000Habilitado === undefined) c.tipo0000Habilitado = c.tipo0000 > 0;
  });
  if (!ccfg.comunaCluster)     ccfg.comunaCluster     = {};
  if (!ccfg.especiales)        ccfg.especiales        = { recargoExclusividad: {} };
  if (!ccfg.especiales.recargoExclusividad) ccfg.especiales.recargoExclusividad = {};
  if (!ccfg.consolidacionObjetivo)          ccfg.consolidacionObjetivo          = {};
  if (!ccfg.histMeta) ccfg.histMeta = { uploadDate: null, rowCount: 0, fileName: '' };
  if (!ccfg.consolidacion) ccfg.consolidacion = {};
}

function noDataBanner(msg = 'Cargue un CSV en la pestaña Histórico para habilitar esta vista.') {
  return `<div class="flex flex-col items-center justify-center py-xl text-secondary gap-sm">
    <span class="material-symbols-outlined text-[40px] text-outline-variant">upload_file</span>
    <p class="font-body-md">${msg}</p>
  </div>`;
}

function statCard(label, value, icon, valueClass = 'text-primary') {
  return `<div class="bg-surface border border-outline-variant rounded p-sm flex items-center gap-sm">
    <span class="material-symbols-outlined text-[24px] text-outline-variant">${icon}</span>
    <div>
      <div class="font-label-caps text-label-caps text-secondary uppercase">${label}</div>
      <div class="font-bold font-data-mono text-data-mono ${valueClass}">${value}</div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// VISTA PRINCIPAL
// ─────────────────────────────────────────────────────────────
export function renderClientTariffView(container) {
  const db   = getDatabase();
  const cfg  = getTariffConfig(db);
  const ccfg = getClientTariffConfig(db);
  ensureCcfg(ccfg);

  // Restaurar datos históricos desde IndexedDB si no vienen de Supabase
  if (ccfg.historico && ccfg.historico.length) {
    histData = ccfg.historico;
    oficinaToGrupo = computeOficinaGrupos(db, histData);
  } else {
    // Intento asíncrono desde IndexedDB (sin bloquear el render)
    loadHistorico().then(rows => {
      if (rows && rows.length > 0 && !histData.length) {
        histData = rows;
        ccfg.historico = rows;
        oficinaToGrupo = computeOficinaGrupos(db, rows);
        // Re-renderizar la subvista activa si ya está montada
        const activeTab = document.querySelector('#ct-subtabs button.border-primary');
        if (activeTab) activeTab.click();
      }
    });
  }

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administrador de Tarifas Clientes</h1>
      <p class="font-body-lg text-body-lg text-secondary">Análisis histórico, consolidación de flota, densidad logística y estructuración de tarifas por cluster.</p>
    </div>
    <div class="flex gap-sm mb-lg border-b border-outline-variant pb-sm overflow-x-auto" id="ct-subtabs">
      ${subTabButton('historico',     'history',       'Histórico (6M)')}
      ${subTabButton('consolidacion', 'inventory',     'Consolidación')}
      ${subTabButton('densidad',      'location_on',   'Densidad Logística')}
      ${subTabButton('especiales',    'star',          'Frecuencia y Especiales')}
      ${subTabButton('cluster',       'map',           'Cluster')}
      ${subTabButton('resultados',    'request_quote', 'Resultados ZFMI/ZFMP')}
    </div>
    <div id="ct-content"></div>
  `;

  document.querySelectorAll('.ct-subtab').forEach(btn => {
    btn.addEventListener('click', () => { activeSubC = btn.dataset.sub; renderSub(); });
  });
  renderSub();

  function renderSub() {
    document.querySelectorAll('.ct-subtab').forEach(btn => {
      btn.className = btn.dataset.sub === activeSubC
        ? 'ct-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-primary text-white cursor-pointer whitespace-nowrap'
        : 'ct-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary hover:text-primary cursor-pointer whitespace-nowrap';
    });
    const content = document.getElementById('ct-content');
    switch (activeSubC) {
      case 'historico':     renderHistorico(content, db, ccfg);      break;
      case 'consolidacion': renderConsolidacion(content, db, ccfg);  break;
      case 'densidad':      renderDensidad(content, db, ccfg);       break;
      case 'especiales':    renderEspeciales(content, db, ccfg);     break;
      case 'cluster':       renderCluster(content, db, ccfg);        break;
      case 'resultados':    renderResultados(content, db, cfg, ccfg);break;
    }
    content.addEventListener('change', (e) => {
      const path = e.target.dataset.path;
      if (!path) return;
      let val;
      if (e.target.type === 'checkbox') val = e.target.checked;
      else if (e.target.type === 'number') val = e.target.value === '' ? 0 : Number(e.target.value);
      else val = e.target.value;
      setPath(ccfg, path, val);
      saveDatabase(db);
      if (e.target.dataset.refresh === 'true') renderSub();
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// VISTA 1: HISTÓRICO
// ═══════════════════════════════════════════════════════════════
function renderHistorico(content, db, ccfg) {
  const hasData = histData.length > 0;
  let summary = null;
  if (hasData) {
    const docsMap = new Map();
    histData.forEach(r => {
      if (!docsMap.has(r.documento)) docsMap.set(r.documento, { gasto: r.gasto, pagado: r.hes !== '' });
    });
    summary = {
      totalDocs:   docsMap.size,
      totalGasto:  [...docsMap.values()].reduce((s, d) => s + d.gasto, 0),
      pendDocs:    [...docsMap.values()].filter(d => !d.pagado).length,
      totalTon:    histData.reduce((s, r) => s + r.ton, 0),
      totalEntreg: histData.length
    };
  }

  const grupos = allGroups();
  let rows = histData;
  if (histFilterGrupo  !== 'all') rows = rows.filter(r => getCentroGroup(r.oficina) === histFilterGrupo);
  if (histFilterEstado === 'pagado')    rows = rows.filter(r => r.hes !== '');
  if (histFilterEstado === 'pendiente') rows = rows.filter(r => r.hes === '');
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  histPage = Math.min(histPage, totalPages - 1);
  const pageRows = rows.slice(histPage * PAGE_SIZE, (histPage + 1) * PAGE_SIZE);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">history</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Histórico Operacional — 6 Meses</h2>
        </div>
        ${hasData ? `<button id="hist-clear" class="border border-red-200 hover:bg-red-50 text-red-700 px-md py-sm rounded text-xs font-bold uppercase flex items-center gap-xs"><span class="material-symbols-outlined text-[16px]">delete</span> Vaciar</button>` : ''}
      </div>

      <div class="flex items-center gap-md bg-surface-container-low border border-outline-variant p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md font-bold text-on-surface">Cargar CSV de despachos históricos</p>
          <p class="text-[11px] text-secondary">Columnas: Fecha Transporte; Oficina Entrega; Documento Transporte; Gasto Transporte; HES; ID Cliente; ID Obra; Transportista; Cap. Camión; Entrega; ID Ruta; ID Transportista; Ton</p>
          ${ccfg.histMeta.uploadDate ? `<p class="text-[11px] text-primary mt-xs">Cargado: <b>${ccfg.histMeta.fileName}</b> — ${ccfg.histMeta.rowCount.toLocaleString()} filas el ${ccfg.histMeta.uploadDate}</p>` : ''}
        </div>
        <input type="file" id="hist-csv" accept=".csv" class="text-[12px]">
      </div>

      ${hasData && summary ? `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-sm mb-md">
        ${statCard('Despachos',    summary.totalDocs.toLocaleString(),          'local_shipping')}
        ${statCard('Entregas',     summary.totalEntreg.toLocaleString(),         'package_2')}
        ${statCard('Toneladas',    summary.totalTon.toFixed(1) + ' T',           'scale')}
        ${statCard('Gasto Total',  formatCLP(summary.totalGasto),                'payments')}
        ${statCard('HES Pendiente',summary.pendDocs.toLocaleString() + ' desp.', 'pending', summary.pendDocs > 0 ? 'text-amber-600' : 'text-green-600')}
      </div>

      <div class="flex items-center gap-sm flex-wrap mb-md">
        <span class="font-label-caps text-label-caps text-secondary uppercase text-[11px]">Filtros:</span>
        <select id="hist-fg" class="${selectCls}">
          <option value="all">Todos los centros</option>
          ${grupos.map(g => `<option value="${g}" ${histFilterGrupo === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
        <select id="hist-fe" class="${selectCls}">
          <option value="all"       ${histFilterEstado === 'all'       ? 'selected' : ''}>HES: Todos</option>
          <option value="pagado"    ${histFilterEstado === 'pagado'    ? 'selected' : ''}>Pagados</option>
          <option value="pendiente" ${histFilterEstado === 'pendiente' ? 'selected' : ''}>Pendientes</option>
        </select>
        <span class="text-secondary text-[12px]">${rows.length.toLocaleString()} filas · Pág ${histPage + 1}/${totalPages}</span>
        ${histPage > 0           ? `<button id="hist-prev" class="border border-outline-variant px-sm py-xs rounded text-[12px] font-bold">‹ Ant.</button>` : ''}
        ${histPage < totalPages-1 ? `<button id="hist-next" class="border border-outline-variant px-sm py-xs rounded text-[12px] font-bold">Sig. ›</button>` : ''}
      </div>

      <div class="bg-surface border border-outline-variant rounded overflow-x-auto max-h-[480px] overflow-y-auto">
        <table class="w-full border-collapse text-[12px]">
          <thead class="sticky top-0">
            <tr class="bg-surface-container-high border-b border-outline-variant text-left">
              <th class="p-sm font-label-caps text-secondary uppercase">Fecha</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Centro</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Transportista</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Cap.</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Ton</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Gasto</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-center">HES</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            ${pageRows.map(r => `
              <tr class="hover:bg-surface-container-low">
                <td class="p-sm font-data-mono text-[11px]">${r.fecha}</td>
                <td class="p-sm font-bold text-[11px]">${getCentroGroup(r.oficina)}</td>
                <td class="p-sm font-bold">${r.idRuta}</td>
                <td class="p-sm text-secondary truncate max-w-[150px]" title="${r.transportista}">${r.transportista.split(' ').slice(0, 2).join(' ')}</td>
                <td class="p-sm text-right font-data-mono">${CAP_LABELS[getCapBucket(r.capTons)] || r.capTons + 'T'}</td>
                <td class="p-sm text-right font-data-mono">${r.ton.toFixed(2)}</td>
                <td class="p-sm text-right font-data-mono">${formatCLP(r.gasto)}</td>
                <td class="p-sm text-center">${r.hes
                  ? `<span class="text-[10px] bg-green-100 text-green-700 px-xs py-px rounded font-bold">OK</span>`
                  : `<span class="text-[10px] bg-amber-100 text-amber-700 px-xs py-px rounded font-bold">PEND</span>`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ` : noDataBanner()}
    </div>
  `;

  document.getElementById('hist-csv')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseHistCSV(ev.target.result);
      if (!parsed.length) { showAlert('No se encontraron filas válidas en el CSV.', 'error'); return; }
      histData = parsed;
      histPage = 0; histFilterGrupo = 'all'; histFilterEstado = 'all';
      // Calcular mapa oficina → nombre de grupo (via db.routes.origen_grupo)
      oficinaToGrupo = computeOficinaGrupos(db, parsed);
      ccfg.histMeta = { uploadDate: formatDateDDMMYYYY(new Date()), rowCount: parsed.length, fileName: file.name };
      ccfg.historico = parsed;
      saveDatabase(db);
      saveHistorico(parsed); // guardar en IndexedDB (sin límite localStorage)
      const msg = `${parsed.length.toLocaleString()} filas cargadas y guardadas.`;
      if (parsed.length > 5000) showAlert(`${msg} (Más de 5000 registros — puede afectar el rendimiento al guardar.)`, 'warning');
      else showAlert(msg);
      renderHistorico(content, db, ccfg);
    };
    reader.readAsText(file, 'windows-1252');
  });

  document.getElementById('hist-clear')?.addEventListener('click', () => {
    if (!confirm('¿Vaciar datos en memoria?')) return;
    histData = []; histPage = 0; oficinaToGrupo = {};
    ccfg.histMeta = { uploadDate: null, rowCount: 0, fileName: '' };
    ccfg.historico = [];
    saveDatabase(db);
    saveHistorico([]); // limpiar IndexedDB
    renderHistorico(content, db, ccfg);
  });
  document.getElementById('hist-fg')?.addEventListener('change', (e) => { histFilterGrupo  = e.target.value; histPage = 0; renderHistorico(content, db, ccfg); });
  document.getElementById('hist-fe')?.addEventListener('change', (e) => { histFilterEstado = e.target.value; histPage = 0; renderHistorico(content, db, ccfg); });
  document.getElementById('hist-prev')?.addEventListener('click', () => { histPage--; renderHistorico(content, db, ccfg); });
  document.getElementById('hist-next')?.addEventListener('click', () => { histPage++; renderHistorico(content, db, ccfg); });
}

// ═══════════════════════════════════════════════════════════════
// VISTA 2: CONSOLIDACIÓN
// ═══════════════════════════════════════════════════════════════
function renderConsolidacion(content, db, ccfg) {
  if (!histData.length) { content.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">${noDataBanner()}</div>`; return; }
  const grupos = allGroups();
  const stats = {};
  grupos.forEach(g => {
    stats[g] = {};
    CAP_BUCKETS.forEach(bkt => {
      const rows = histData.filter(r => getCentroGroup(r.oficina) === g && getCapBucket(r.capTons) === bkt);
      if (!rows.length) { stats[g][bkt] = null; return; }
      const docMap = new Map();
      rows.forEach(r => {
        if (!docMap.has(r.documento)) docMap.set(r.documento, { tons: 0, gasto: r.gasto });
        docMap.get(r.documento).tons += r.ton;
      });
      const fills    = [...docMap.values()].map(d => Math.min(d.tons / bkt, 1));
      const avgFill  = fills.reduce((s, f) => s + f, 0) / fills.length;
      stats[g][bkt]  = { docs: docMap.size, avgFill, totalTon: rows.reduce((s,r) => s + r.ton, 0), totalGasto: [...docMap.values()].reduce((s,d) => s + d.gasto, 0) };
    });
  });

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">inventory</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Consolidación de Flota por Centro y Tipo de Camión</h2>
        </div>
        <button id="btn-refresh-consolidacion" class="flex items-center gap-xs border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded text-[11px] uppercase tracking-wider">
          <span class="material-symbols-outlined text-[16px]">refresh</span> Refrescar
        </button>
      </div>
      <p class="text-[12px] text-secondary mb-md">Consolidación = promedio del factor de carga por despacho (Ton_cargadas / Cap_camión, máx 100%). Campo <b>Objetivo (%)</b> editable.</p>
      ${grupos.map(g => `
        <div class="mb-lg">
          <h3 class="font-headline-sm font-bold text-on-surface mb-sm">${g}</h3>
          <div class="bg-surface border border-outline-variant rounded overflow-x-auto">
            <table class="w-full border-collapse text-[13px]">
              <thead><tr class="bg-surface-container-high border-b border-outline-variant text-left">
                <th class="p-md font-label-caps text-secondary uppercase">Camión</th>
                <th class="p-md font-label-caps text-secondary uppercase text-right">Despachos</th>
                <th class="p-md font-label-caps text-secondary uppercase text-right">Consolidación</th>
                <th class="p-md font-label-caps text-secondary uppercase">Barra</th>
                <th class="p-md font-label-caps text-secondary uppercase text-right">Objetivo (%)</th>
                <th class="p-md font-label-caps text-secondary uppercase text-right">Ton Total</th>
                <th class="p-md font-label-caps text-secondary uppercase text-right">Gasto Total</th>
              </tr></thead>
              <tbody class="divide-y divide-outline-variant">
                ${CAP_BUCKETS.map(bkt => {
                  const s = stats[g][bkt];
                  if (!s) return `<tr><td class="p-md text-secondary" colspan="7">${CAP_LABELS[bkt]} — sin movimiento</td></tr>`;
                  const pct = (s.avgFill * 100).toFixed(1);
                  const objKey  = `consolidacionObjetivo.${g.replace(/\s/g,'_')}.${bkt}`;
                  const objetivo = getPath(ccfg, objKey, 80);
                  const barColor = s.avgFill >= 0.85 ? '#16a34a' : s.avgFill >= 0.65 ? '#d97706' : '#b5000b';
                  return `<tr class="hover:bg-surface-container-low">
                    <td class="p-md font-bold">${CAP_LABELS[bkt]}</td>
                    <td class="p-md text-right font-data-mono">${s.docs.toLocaleString()}</td>
                    <td class="p-md text-right font-data-mono font-bold" style="color:${barColor}">${pct}%</td>
                    <td class="p-md w-40"><div class="h-2 bg-surface-container-high rounded overflow-hidden"><div class="h-2 rounded" style="width:${Math.min(s.avgFill*100,100)}%;background:${barColor}"></div></div></td>
                    <td class="p-md w-28">${numInput(objKey, objetivo)}</td>
                    <td class="p-md text-right font-data-mono">${s.totalTon.toFixed(1)} T</td>
                    <td class="p-md text-right font-data-mono">${formatCLP(s.totalGasto)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('')}
    </div>`;

  document.getElementById('btn-refresh-consolidacion')?.addEventListener('click', () => {
    renderConsolidacion(content, db, ccfg);
  });
}

// ═══════════════════════════════════════════════════════════════
// VISTA 3: DENSIDAD LOGÍSTICA (con rollup sector → comuna)
// ═══════════════════════════════════════════════════════════════
function buildDensidadData(db, rowsGrupo) {
  // 1. Acumular stats por ID Ruta
  const rawStats = new Map(); // idRuta → { clientes, obras, ton, dbRoute }
  rowsGrupo.forEach(r => {
    const dbRoute = findRoute(db, r.idRuta);
    if (!rawStats.has(r.idRuta)) rawStats.set(r.idRuta, { clientes: new Set(), obras: new Set(), ton: 0, dbRoute });
    const e = rawStats.get(r.idRuta);
    if (r.idCliente && r.idCliente !== '-') e.clientes.add(r.idCliente);
    if (r.idObra    && r.idObra    !== '-') e.obras.add(r.idObra);
    e.ton += r.ton;
  });

  // 2. Mapa comunaName.toLowerCase() → codigo de ruta COMUNA
  const comunaToRoute = new Map();
  rawStats.forEach((stats, codigo) => {
    if (stats.dbRoute?.tipo === 'Comuna') {
      const c = (stats.dbRoute.comuna || stats.dbRoute.destino || '').toLowerCase();
      if (c) comunaToRoute.set(c, codigo);
    }
  });

  // 3. Rollup sectores → su comuna padre (via transport_zones)
  rawStats.forEach((stats, codigo) => {
    if (stats.dbRoute?.tipo !== 'Sector') return;
    const comunaPadre = getSectorComunaPadre(db, stats.dbRoute);
    if (!comunaPadre) return;
    const parentCodigo = comunaToRoute.get(comunaPadre.toLowerCase());
    if (!parentCodigo || parentCodigo === codigo) return;
    const parent = rawStats.get(parentCodigo);
    if (!parent) return;
    stats.clientes.forEach(c => parent.clientes.add(c));
    stats.obras.forEach(o => parent.obras.add(o));
    parent.ton += stats.ton;
    stats._rolledUp = true; // marcar como ya consolidado
  });

  // 4. Solo rutas COMUNA (sectores ya consolidados); o rutas sin tipo conocido
  const result = [];
  rawStats.forEach((stats, idRuta) => {
    if (stats._rolledUp) return;                       // sector absorbido
    if (stats.dbRoute?.tipo === 'Sector') return;      // sector sin padre conocido — omitir
    result.push({ idRuta, destino: stats.dbRoute?.destino || idRuta, tipo: stats.dbRoute?.tipo || '?', clientes: stats.clientes.size, obras: stats.obras.size, ton: stats.ton });
  });
  return result;
}

function renderDensidad(content, db, ccfg) {
  if (!histData.length) { content.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">${noDataBanner()}</div>`; return; }

  const grupos = allGroups();
  const filtro  = ccfg.densidadFiltro || grupos[0] || 'all';
  const rowsGrupo = filtro === 'all' ? histData : histData.filter(r => getCentroGroup(r.oficina) === filtro);

  const routeData  = buildDensidadData(db, rowsGrupo);
  const centroTon  = routeData.reduce((s, r) => s + r.ton, 0);
  // Clientes/obras únicos a nivel de centro (desde rowsGrupo, no agregados)
  const centroClientes = new Set(rowsGrupo.map(r => r.idCliente).filter(x => x && x !== '-')).size;
  const centroObras    = new Set(rowsGrupo.map(r => r.idObra).filter(x => x && x !== '-')).size;

  const withDensidad = routeData.map(r => {
    const pctCli  = centroClientes > 0 ? (r.clientes / centroClientes) * 100 : 0;
    const pctObra = centroObras    > 0 ? (r.obras    / centroObras)    * 100 : 0;
    const pctTon  = centroTon      > 0 ? (r.ton      / centroTon)      * 100 : 0;
    return { ...r, pctCli, pctObra, pctTon, densidad: (pctCli + pctObra + pctTon) / 3 };
  }).sort((a, b) => b.densidad - a.densidad);

  const maxDen = withDensidad[0]?.densidad || 1;

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">location_on</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Densidad Logística — Rutas Comunas</h2>
        </div>
        <div class="flex items-center gap-sm">
          <label class="font-label-caps text-label-caps text-secondary uppercase text-[11px]">Centro:</label>
          <select id="den-filtro" class="${selectCls}">
            <option value="all" ${filtro === 'all' ? 'selected' : ''}>Todos</option>
            ${grupos.map(g => `<option value="${g}" ${filtro === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="text-[12px] text-secondary mb-md">Indicador = promedio de (% clientes únicos + % obras únicas + % toneladas) respecto al total del centro. Los sectores se suman a su comuna padre via zonas de transporte.</p>
      <div class="grid grid-cols-3 gap-sm mb-md">
        ${statCard('Clientes únicos', centroClientes.toLocaleString(), 'person')}
        ${statCard('Obras únicas',    centroObras.toLocaleString(),    'construction')}
        ${statCard('Ton. Comunas',    centroTon.toFixed(1) + ' T',     'scale')}
      </div>
      <div class="bg-surface border border-outline-variant rounded overflow-x-auto">
        <table class="w-full border-collapse text-[12px]">
          <thead><tr class="bg-surface-container-high border-b border-outline-variant text-left">
            <th class="p-md font-label-caps text-secondary uppercase">#</th>
            <th class="p-md font-label-caps text-secondary uppercase">Ruta</th>
            <th class="p-md font-label-caps text-secondary uppercase">Tipo</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">Clientes</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">Obras</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">Ton</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">Densidad</th>
            <th class="p-md font-label-caps text-secondary uppercase w-32">Barra</th>
          </tr></thead>
          <tbody class="divide-y divide-outline-variant">
            ${withDensidad.length === 0
              ? `<tr><td colspan="8" class="p-md text-center text-secondary">No hay datos para este filtro.</td></tr>`
              : withDensidad.map((r, i) => {
                  const bc = r.densidad >= 15 ? '#b5000b' : r.densidad >= 5 ? '#d97706' : '#6b7280';
                  const bw = Math.min(r.densidad / maxDen * 100, 100);
                  return `<tr class="hover:bg-surface-container-low">
                    <td class="p-md text-secondary">${i + 1}</td>
                    <td class="p-md font-bold">${r.idRuta}${r.destino !== r.idRuta ? ` <span class="font-normal text-secondary">— ${r.destino}</span>` : ''}</td>
                    <td class="p-md"><span class="text-[10px] px-xs py-px rounded border border-outline-variant">${r.tipo}</span></td>
                    <td class="p-md text-right font-data-mono">${r.clientes} <span class="text-secondary text-[10px]">(${r.pctCli.toFixed(1)}%)</span></td>
                    <td class="p-md text-right font-data-mono">${r.obras} <span class="text-secondary text-[10px]">(${r.pctObra.toFixed(1)}%)</span></td>
                    <td class="p-md text-right font-data-mono">${r.ton.toFixed(1)} <span class="text-secondary text-[10px]">(${r.pctTon.toFixed(1)}%)</span></td>
                    <td class="p-md text-right font-data-mono font-bold" style="color:${bc}">${r.densidad.toFixed(2)}%</td>
                    <td class="p-md"><div class="h-2 bg-surface-container-high rounded overflow-hidden"><div class="h-2 rounded" style="width:${bw}%;background:${bc}"></div></div></td>
                  </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('den-filtro')?.addEventListener('change', (e) => {
    ccfg.densidadFiltro = e.target.value;
    saveDatabase(db);
    renderDensidad(content, db, ccfg);
  });
}

// ═══════════════════════════════════════════════════════════════
// VISTA 4: FRECUENCIA Y ESPECIALES (clusters dinámicos)
// ═══════════════════════════════════════════════════════════════
function clusterRow(c, idx) {
  const iCls = 'border border-[#CED4DA] p-xs font-data-mono text-data-mono focus:border-primary focus:ring-0 bg-white rounded';
  const habilitado = c.tipo0000Habilitado !== false;
  return `<tr class="hover:bg-surface-container-low border-b border-outline-variant">
    <td class="p-md"><input type="text" class="${iCls} w-full" data-path="clusters.${idx}.nombre" value="${c.nombre.replace(/"/g,'&quot;')}"></td>
    <td class="p-md text-center"><input type="color" class="w-10 h-8 border border-outline-variant rounded cursor-pointer" data-path="clusters.${idx}.color" value="${c.color}"></td>
    <td class="p-md"><input type="number" step="0.01" min="0" max="100" class="${iCls} w-20 text-right" data-path="clusters.${idx}.nv" value="${c.nv}"></td>
    <td class="p-md"><input type="text" class="${iCls} w-full" data-path="clusters.${idx}.frecuencia" value="${(c.frecuencia||'').replace(/"/g,'&quot;')}"></td>
    <td class="p-md text-center">
      <label class="flex items-center justify-center gap-xs cursor-pointer">
        <input type="checkbox" data-path="clusters.${idx}.tipo0000Habilitado" ${habilitado ? 'checked' : ''} class="w-4 h-4 text-primary border-[#CED4DA] rounded">
        <span class="text-[10px] text-secondary">${habilitado ? 'ON' : 'OFF'}</span>
      </label>
    </td>
    <td class="p-md">${habilitado ? `<input type="number" step="1" min="0" class="${iCls} w-24 text-right" data-path="clusters.${idx}.tipo0000" value="${c.tipo0000 || 0}">` : '<span class="text-secondary text-[11px]">—</span>'}</td>
    <td class="p-md text-center">
      <button class="del-cluster border border-red-200 hover:bg-red-50 text-red-700 px-sm py-xs rounded text-[11px] font-bold flex items-center gap-xs mx-auto" data-idx="${idx}">
        <span class="material-symbols-outlined text-[14px]">delete</span>
      </button>
    </td>
  </tr>`;
}

function renderEspeciales(content, db, ccfg) {
  const selectCls2 = 'border border-[#CED4DA] px-sm py-xs font-body-md text-body-md focus:border-primary focus:ring-0 bg-white rounded';
  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">star</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Frecuencia y Especiales — Definición de Clusters</h2>
        </div>
        <button id="add-cluster" class="flex items-center gap-xs bg-primary text-white px-md py-sm rounded text-[12px] font-bold uppercase hover:opacity-90">
          <span class="material-symbols-outlined text-[16px]">add</span> Agregar Cluster
        </button>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Define nombre, color, nivel de servicio (NV %), frecuencia de despacho y recargo tipo 0000 para cada cluster.
      </p>

      <div class="bg-surface border border-outline-variant rounded overflow-x-auto mb-lg">
        <table class="w-full border-collapse text-[12px]">
          <thead><tr class="bg-surface-container-high border-b border-outline-variant text-left">
            <th class="p-md font-label-caps text-secondary uppercase">Nombre</th>
            <th class="p-md font-label-caps text-secondary uppercase text-center">Color</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">NV (%)</th>
            <th class="p-md font-label-caps text-secondary uppercase">Frecuencia</th>
            <th class="p-md font-label-caps text-secondary uppercase text-center">Tipo 0000</th>
            <th class="p-md font-label-caps text-secondary uppercase text-right">Recargo ($)</th>
            <th class="p-md font-label-caps text-secondary uppercase text-center">Eliminar</th>
          </tr></thead>
          <tbody id="clusters-tbody">
            ${ccfg.clusters.map((c, i) => clusterRow(c, i)).join('')}
          </tbody>
        </table>
      </div>

      <div class="bg-surface border border-outline-variant rounded p-md">
        <h3 class="font-bold text-[13px] text-on-surface mb-sm">Recargos por Exclusividad</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-sm">
          ${ccfg.clusters.map(c => `
            <div class="flex flex-col gap-xs">
              <label class="font-label-caps text-label-caps text-secondary uppercase text-[10px] flex items-center gap-xs">
                <span class="inline-block w-2 h-2 rounded-full" style="background:${c.color}"></span>${c.nombre}
              </label>
              <input type="number" step="any" min="0"
                class="border border-[#CED4DA] p-xs font-data-mono text-data-mono text-right focus:border-primary focus:ring-0 bg-white rounded"
                data-path="especiales.recargoExclusividad.${c.key}"
                value="${ccfg.especiales?.recargoExclusividad?.[c.key] || 0}">
            </div>`).join('')}
        </div>
      </div>
    </div>
  `;

  // Inputs de clusters
  content.querySelectorAll('[data-path^="clusters."]').forEach(el => {
    el.addEventListener('change', () => {
      const parts = el.dataset.path.split('.');
      const idx = parseInt(parts[1]);
      const field = parts[2];
      if (!ccfg.clusters[idx]) return;
      if (el.type === 'checkbox') ccfg.clusters[idx][field] = el.checked;
      else if (el.type === 'number') ccfg.clusters[idx][field] = el.value === '' ? 0 : Number(el.value);
      else ccfg.clusters[idx][field] = el.value;
      saveDatabase(db);
      // Si cambia tipo0000Habilitado, re-renderizar para ocultar/mostrar el input de recargo
      if (field === 'tipo0000Habilitado') renderEspeciales(content, db, ccfg);
    });
  });

  // Recargos exclusividad
  content.querySelectorAll('[data-path^="especiales."]').forEach(el => {
    el.addEventListener('change', () => {
      setPath(ccfg, el.dataset.path, el.value === '' ? 0 : Number(el.value));
      saveDatabase(db);
    });
  });

  // Agregar cluster
  document.getElementById('add-cluster')?.addEventListener('click', () => {
    const newKey = nextClusterKey(ccfg);
    ccfg.clusters.push({ key: newKey, nombre: 'Cluster ' + newKey, color: '#6b7280', nv: 90, frecuencia: 'Semanal', tipo0000: 0, tipo0000Habilitado: false });
    saveDatabase(db);
    renderEspeciales(content, db, ccfg);
  });

  // Eliminar cluster
  content.querySelectorAll('.del-cluster').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const clKey = ccfg.clusters[idx]?.key;
      const nombre = ccfg.clusters[idx]?.nombre || '';
      if (!confirm('Eliminar cluster "' + nombre + '"?\nLas rutas asignadas quedarán sin cluster.')) return;
      ccfg.clusters.splice(idx, 1);
      if (clKey) {
        Object.keys(ccfg.comunaCluster).forEach(ruta => {
          if (ccfg.comunaCluster[ruta] === clKey) delete ccfg.comunaCluster[ruta];
        });
      }
      saveDatabase(db);
      renderEspeciales(content, db, ccfg);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// ASIGNACIÓN AUTOMÁTICA DE CLUSTERS
// ─────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function asignarClustersAuto(db, ccfg) {
  if (!histData.length) return;
  const grupos = allGroups();

  // 1. Construir datos de densidad por ruta (todas)
  const allHistData = grupos.length > 0
    ? histData
    : [];
  const rowsPorGrupo = new Map();
  grupos.forEach(g => {
    const rows = histData.filter(r => getCentroGroup(r.oficina) === g);
    if (!rows.length) return;
    rowsPorGrupo.set(g, buildDensidadData(db, rows));
  });

  // 2. Mapa ruta → { densidad, clasif, lat, lon }
  const rutaInfo = new Map();
  histData.forEach(r => {
    if (rutaInfo.has(r.idRuta)) return;
    const route = findRoute(db, r.idRuta);
    let densidad = 0;
    const grupo = getCentroGroup(r.oficina);
    const dataArr = rowsPorGrupo.get(grupo) || [];
    const found = dataArr.find(d => d.idRuta === r.idRuta);
    if (found) {
      const centroClientes = rowsPorGrupo.get(grupo).reduce((s, d) => s + d.clientes, 0) || 1;
      const centroObras = rowsPorGrupo.get(grupo).reduce((s, d) => s + d.obras, 0) || 1;
      const centroTon = rowsPorGrupo.get(grupo).reduce((s, d) => s + d.ton, 0) || 1;
      const pctCli = (found.clientes / centroClientes) * 100;
      const pctObra = (found.obras / centroObras) * 100;
      const pctTon = (found.ton / centroTon) * 100;
      densidad = (pctCli + pctObra + pctTon) / 3;
    }
    rutaInfo.set(r.idRuta, {
      idRuta: r.idRuta,
      clasif: route?.clasificRuta || '',
      lat: parseFloat(route?.lat) || null,
      lon: parseFloat(route?.lon) || null,
      densidad
    });
  });

  // 3. Asignar Interregional → SPOT
  const sinCluster = [...rutaInfo.values()].filter(r => !ccfg.comunaCluster[r.idRuta]);
  const interregionales = sinCluster.filter(r => r.clasif === 'Interregional');
  interregionales.forEach(r => { ccfg.comunaCluster[r.idRuta] = 'spot'; });

  // 4. Regionales restantes: ordenar por densidad y asignar 1, 2, 3
  const regionales = sinCluster.filter(r => r.clasif !== 'Interregional').sort((a, b) => b.densidad - a.densidad);
  if (regionales.length === 0) return;

  // Clusters destino (1, 2, 3) ordenados por key numérico
  const clusterKeys = ccfg.clusters
    .filter(c => c.key !== 'spot' && !isNaN(parseInt(c.key)))
    .sort((a, b) => parseInt(a.key) - parseInt(b.key))
    .map(c => c.key);

  if (clusterKeys.length === 0) return;

  // 5. Algoritmo: K-Means simplificado con 3 clusters por densidad + cercanía geográfica
  const n = regionales.length;
  const k = Math.min(clusterKeys.length, n);

  // Inicializar centros: distribuir equitativamente por densidad
  const centros = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * n / k);
    centros.push({ lat: regionales[idx].lat || -33.45, lon: regionales[idx].lon || -70.65, densidad: regionales[idx].densidad });
  }

  // Iterar para estabilizar (máx 10 iteraciones)
  const asignacion = new Array(n).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    let cambios = 0;
    for (let i = 0; i < n; i++) {
      const r = regionales[i];
      let mejorJ = 0;
      let mejorDist = Infinity;
      for (let j = 0; j < k; j++) {
        const distGeo = (r.lat && r.lon && centros[j].lat && centros[j].lon)
          ? haversineKm(r.lat, r.lon, centros[j].lat, centros[j].lon)
          : 500;
        const distDen = Math.abs(r.densidad - centros[j].densidad);
        const distTotal = distGeo * 0.6 + distDen * 0.4;
        if (distTotal < mejorDist) { mejorDist = distTotal; mejorJ = j; }
      }
      if (asignacion[i] !== mejorJ) { asignacion[i] = mejorJ; cambios++; }
    }
    if (cambios === 0) break;

    // Recalcular centros
    for (let j = 0; j < k; j++) {
      const miembros = [];
      let sumLat = 0, sumLon = 0, sumDen = 0, count = 0;
      for (let i = 0; i < n; i++) {
        if (asignacion[i] === j) {
          miembros.push(regionales[i]);
          if (regionales[i].lat && regionales[i].lon) { sumLat += regionales[i].lat; sumLon += regionales[i].lon; count++; }
          sumDen += regionales[i].densidad;
        }
      }
      if (miembros.length > 0) {
        centros[j].lat = count > 0 ? sumLat / count : centros[j].lat;
        centros[j].lon = count > 0 ? sumLon / count : centros[j].lon;
        centros[j].densidad = sumDen / miembros.length;
      }
    }
  }

  // Asignar resultados
  for (let i = 0; i < n; i++) {
    ccfg.comunaCluster[regionales[i].idRuta] = clusterKeys[asignacion[i]];
  }
}

// ═══════════════════════════════════════════════════════════════
// VISTA 5: CLUSTER (mapa simplificado + filtros)
// ═══════════════════════════════════════════════════════════════
function renderCluster(content, db, ccfg) {
  if (!histData.length) {
    content.innerHTML = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' + noDataBanner() + '</div>';
    return;
  }

  const grupos = allGroups();
  const tiposSet = new Set();
  const clasifSet = new Set();
  histData.forEach(r => {
    const route = findRoute(db, r.idRuta);
    if (route?.tipo) tiposSet.add(route.tipo);
    if (route?.clasificRuta) clasifSet.add(route.clasificRuta);
  });
  const tiposArr = [...tiposSet].sort();
  const clasifArr = [...clasifSet].sort();

  const routeMap = new Map();
  histData.forEach(r => {
    if (routeMap.has(r.idRuta)) return;
    const route = findRoute(db, r.idRuta);
    routeMap.set(r.idRuta, {
      idRuta:  r.idRuta,
      destino: route?.destino || r.idRuta,
      tipo:    route?.tipo || '',
      clasif:  route?.clasificRuta || '',
      grupo:   getCentroGroup(r.oficina),
      cluster: ccfg.comunaCluster[r.idRuta] || '',
      lat:     parseFloat(route?.lat) || null,
      lon:     parseFloat(route?.lon) || null
    });
  });

  let routes = [...routeMap.values()];
  if (clusterFiltGrupo  !== 'all') routes = routes.filter(r => r.grupo  === clusterFiltGrupo);
  if (clusterFiltTipo   !== 'all') routes = routes.filter(r => r.tipo   === clusterFiltTipo);
  if (clusterFiltClasif !== 'all') routes = routes.filter(r => r.clasif === clusterFiltClasif);

  const clSelOpts = ccfg.clusters.map(c => '<option value="' + c.key + '">' + c.nombre + '</option>').join('');

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">map</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Asignación de Cluster por Ruta</h2>
        </div>
        <span class="text-secondary text-[12px]">${routes.length} rutas</span>
        <button id="btn-auto-cluster" class="flex items-center gap-xs border border-primary text-primary hover:bg-primary/[0.06] font-bold px-md py-sm rounded text-[11px] uppercase tracking-wider">
          <span class="material-symbols-outlined text-[16px]">auto_awesome</span> Asignar clusters automáticamente
        </button>
      </div>

      <div class="flex items-center gap-sm flex-wrap mb-md">
        <span class="font-label-caps text-label-caps text-secondary uppercase text-[11px]">Filtros:</span>
        <select id="cl-fg" class="${selectCls}">
          <option value="all" ${clusterFiltGrupo === 'all' ? 'selected' : ''}>Todos los centros</option>
          ${grupos.map(g => '<option value="' + g + '" ' + (clusterFiltGrupo === g ? 'selected' : '') + '>' + g + '</option>').join('')}
        </select>
        <select id="cl-ft" class="${selectCls}">
          <option value="all" ${clusterFiltTipo === 'all' ? 'selected' : ''}>Todos los tipos</option>
          ${tiposArr.map(t => '<option value="' + t + '" ' + (clusterFiltTipo === t ? 'selected' : '') + '>' + t + '</option>').join('')}
        </select>
        <select id="cl-fc" class="${selectCls}">
          <option value="all" ${clusterFiltClasif === 'all' ? 'selected' : ''}>Todas las clasificaciones</option>
          ${clasifArr.map(c => '<option value="' + c + '" ' + (clusterFiltClasif === c ? 'selected' : '') + '>' + c + '</option>').join('')}
        </select>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div>
          <div id="cluster-map" class="bg-surface-container-low border border-outline-variant rounded" style="height:420px;min-height:300px"></div>
          <div class="flex flex-wrap gap-md mt-sm">
            ${ccfg.clusters.map(c => '<span class="flex items-center gap-xs text-[11px]"><span class="inline-block w-3 h-3 rounded-full" style="background:' + c.color + '"></span>' + c.nombre + '</span>').join('')}
            <span class="flex items-center gap-xs text-[11px]"><span class="inline-block w-3 h-3 rounded-full bg-gray-300"></span>Sin cluster</span>
          </div>
        </div>

        <div class="bg-surface border border-outline-variant rounded overflow-x-auto" style="max-height:460px;overflow-y:auto">
          <table class="w-full border-collapse text-[12px]">
            <thead class="sticky top-0 bg-surface-container-high">
              <tr class="border-b border-outline-variant text-left">
                <th class="p-sm font-label-caps text-secondary uppercase">Ruta</th>
                <th class="p-sm font-label-caps text-secondary uppercase">Tipo</th>
                <th class="p-sm font-label-caps text-secondary uppercase">Clasif.</th>
                <th class="p-sm font-label-caps text-secondary uppercase">Cluster</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant">
              ${routes.map(r => {
                const selVal = r.cluster ? ' value="' + r.cluster + '"' : '';
                const opts = '<option value="">— Sin cluster —</option>' + ccfg.clusters.map(c =>
                  '<option value="' + c.key + '"' + (r.cluster === c.key ? ' selected' : '') + '>' + c.nombre + '</option>'
                ).join('');
                return '<tr class="hover:bg-surface-container-low">' +
                  '<td class="p-sm"><span class="font-bold">' + r.idRuta + '</span>' +
                  (r.destino !== r.idRuta ? '<span class="font-normal text-secondary text-[10px] block">' + r.destino + '</span>' : '') + '</td>' +
                  '<td class="p-sm"><span class="text-[10px] px-xs py-px rounded border border-outline-variant">' + r.tipo + '</span></td>' +
                  '<td class="p-sm text-secondary text-[11px]">' + r.clasif + '</td>' +
                  '<td class="p-sm"><select class="cl-assign border border-[#CED4DA] px-xs py-px text-[11px] bg-white rounded w-full" data-ruta="' + r.idRuta + '">' + opts + '</select></td>' +
                  '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('cl-fg')?.addEventListener('change', e => { clusterFiltGrupo  = e.target.value; renderCluster(content, db, ccfg); });
  document.getElementById('cl-ft')?.addEventListener('change', e => { clusterFiltTipo   = e.target.value; renderCluster(content, db, ccfg); });
  document.getElementById('cl-fc')?.addEventListener('change', e => { clusterFiltClasif = e.target.value; renderCluster(content, db, ccfg); });

  document.getElementById('btn-auto-cluster')?.addEventListener('click', () => {
    if (!confirm('¿Asignar clusters automáticamente?\n- Interregionales → SPOT\n- Regionales → según densidad logística + cercanía geográfica\n\nLas rutas ya asignadas manualmente NO se modifican.')) return;
    asignarClustersAuto(db, ccfg);
    saveDatabase(db);
    renderCluster(content, db, ccfg);
    showAlert('Clusters asignados automáticamente.');
  });

  content.querySelectorAll('.cl-assign').forEach(sel => {
    sel.addEventListener('change', () => {
      const ruta = sel.dataset.ruta;
      if (sel.value) ccfg.comunaCluster[ruta] = sel.value;
      else           delete ccfg.comunaCluster[ruta];
      saveDatabase(db);
    });
  });

  function initLeafletMap() {
    const mapEl = document.getElementById('cluster-map');
    if (!mapEl) return;
    if (typeof L === 'undefined') {
      if (!document.getElementById('leaflet-css')) {
        const css = document.createElement('link');
        css.id = 'leaflet-css'; css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
      }
      if (!document.getElementById('leaflet-js')) {
        mapEl.innerHTML = '<div class="flex items-center justify-center h-full text-secondary text-[12px]">Cargando mapa...</div>';
        const sc = document.createElement('script');
        sc.id = 'leaflet-js';
        sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        sc.onload = () => { if (document.getElementById('cluster-map')) initLeafletMap(); };
        document.head.appendChild(sc);
      }
      return;
    }
    const withCoords = routes.filter(r => r.lat && r.lon);
    if (!withCoords.length) {
      mapEl.innerHTML = '<div class="flex items-center justify-center h-full text-secondary text-[12px] p-md text-center">Las rutas no tienen coordenadas en la base de datos.</div>';
      return;
    }
    if (mapEl._leafletMap) { try { mapEl._leafletMap.remove(); } catch (e) {} }
    mapEl.innerHTML = '';
    const map = L.map(mapEl).setView([-35, -71], 5);
    mapEl._leafletMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18
    }).addTo(map);
    withCoords.forEach(r => {
      const color = r.cluster ? (clusterColor(ccfg, r.cluster) || '#9ca3af') : '#9ca3af';
      L.circleMarker([r.lat, r.lon], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 1.5 })
        .addTo(map)
        .bindPopup('<b>' + r.idRuta + '</b><br>' + r.destino + '<br><small>' + r.tipo + (r.cluster ? ' — ' + clusterNombre(ccfg, r.cluster) : '') + '</small>');
    });
  }
  initLeafletMap();
}

// ═══════════════════════════════════════════════════════════════
// VISTA 6: RESULTADOS ZFMI / ZFMP
// ═══════════════════════════════════════════════════════════════
function renderResultados(content, db, cfg, ccfg) {
  if (!histData.length) {
    content.innerHTML = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' + noDataBanner() + '</div>';
    return;
  }

  const routeStats = new Map();
  histData.forEach(r => {
    if (!routeStats.has(r.idRuta)) {
      routeStats.set(r.idRuta, { idRuta: r.idRuta, ton: 0, docs: new Set(), clientes: new Set(), obras: new Set(), gastoVistos: new Set(), gastoTotal: 0 });
    }
    const rs = routeStats.get(r.idRuta);
    rs.ton += r.ton;
    rs.docs.add(r.documento);
    if (r.idCliente && r.idCliente !== '-') rs.clientes.add(r.idCliente);
    if (r.idObra    && r.idObra    !== '-') rs.obras.add(r.idObra);
    if (!rs.gastoVistos.has(r.documento)) { rs.gastoVistos.add(r.documento); rs.gastoTotal += r.gasto; }
  });

  const clusterRoutes = {};
  ccfg.clusters.forEach(c => { clusterRoutes[c.key] = []; });
  clusterRoutes['__sin__'] = [];

  routeStats.forEach((rs, idRuta) => {
    const clKey   = ccfg.comunaCluster[idRuta] || '__sin__';
    const route   = findRoute(db, idRuta);
    const cluster = clusterByKey(ccfg, clKey);
    const nv      = cluster?.nv ?? 90;
    let tarifa = null;
    if (typeof calcularCostoRuta === 'function' && cluster) {
      try { tarifa = calcularCostoRuta(db, cfg, idRuta, { nv, tons: rs.ton / Math.max(rs.docs.size, 1) }); } catch (_) {}
    }
    const bucket = clusterRoutes[clKey] !== undefined ? clusterRoutes[clKey] : clusterRoutes['__sin__'];
    bucket.push({ idRuta, destino: route?.destino || idRuta, tipo: route?.tipo || '?', ton: rs.ton, docs: rs.docs.size, clientes: rs.clientes.size, obras: rs.obras.size, gastoReal: rs.gastoTotal, tarifa });
  });

  const totalRoutes  = routeStats.size;
  const sinCluster   = clusterRoutes['__sin__'].length;
  const assigned     = totalRoutes - sinCluster;

  let html = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">';
  html += '<div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">';
  html += '<div class="flex items-center gap-sm"><span class="material-symbols-outlined text-primary">request_quote</span>';
  html += '<h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Resultados ZFMI / ZFMP</h2></div>';
  html += '<div class="flex items-center gap-sm text-[12px] text-secondary">';
  html += '<span>' + assigned + ' / ' + totalRoutes + ' rutas asignadas</span>';
  html += sinCluster > 0
    ? '<span class="text-amber-600 font-bold">' + sinCluster + ' sin cluster</span>'
    : '<span class="text-green-600 font-bold">Completo</span>';
  html += '</div></div>';

  ccfg.clusters.forEach(c => {
    const rows = (clusterRoutes[c.key] || []).sort((a, b) => b.ton - a.ton);
    if (!rows.length) return;
    const totTon   = rows.reduce((s, r) => s + r.ton,       0);
    const totDocs  = rows.reduce((s, r) => s + r.docs,      0);
    const totGasto = rows.reduce((s, r) => s + r.gastoReal, 0);
    const totCli   = rows.reduce((s, r) => s + r.clientes,  0);
    html += '<div class="mb-xl">';
    html += '<div class="flex items-center gap-sm mb-sm flex-wrap">';
    html += '<span class="inline-block w-4 h-4 rounded-full" style="background:' + c.color + '"></span>';
    html += '<h3 class="font-bold text-[14px] text-on-surface">' + c.nombre + '</h3>';
    html += '<span class="text-[11px] text-secondary">NV ' + c.nv + '% · ' + c.frecuencia + ' · ' + rows.length + ' rutas · ' + totTon.toFixed(1) + ' T · ' + formatCLP(totGasto) + '</span>';
    html += '</div>';
    html += '<div class="bg-surface border border-outline-variant rounded overflow-x-auto">';
    html += '<table class="w-full border-collapse text-[12px]">';
    html += '<thead><tr class="bg-surface-container-high border-b border-outline-variant text-left">';
    html += '<th class="p-sm font-label-caps text-secondary uppercase">Ruta</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase">Tipo</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Ton</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Despachos</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Clientes</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Gasto Real</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Tarifa Calc.</th>';
    html += '</tr></thead><tbody class="divide-y divide-outline-variant">';
    rows.forEach(r => {
      html += '<tr class="hover:bg-surface-container-low">';
      html += '<td class="p-sm"><span class="font-bold">' + r.idRuta + '</span>' + (r.destino !== r.idRuta ? '<span class="font-normal text-secondary text-[10px] ml-xs">— ' + r.destino + '</span>' : '') + '</td>';
      html += '<td class="p-sm"><span class="text-[10px] px-xs py-px rounded border border-outline-variant">' + r.tipo + '</span></td>';
      html += '<td class="p-sm text-right font-data-mono">' + r.ton.toFixed(1) + ' T</td>';
      html += '<td class="p-sm text-right font-data-mono">' + r.docs + '</td>';
      html += '<td class="p-sm text-right font-data-mono">' + r.clientes + '</td>';
      html += '<td class="p-sm text-right font-data-mono">' + formatCLP(r.gastoReal) + '</td>';
      html += '<td class="p-sm text-right font-data-mono">' + (r.tarifa != null ? formatCLP(r.tarifa) : '<span class="text-secondary">—</span>') + '</td>';
      html += '</tr>';
    });
    html += '</tbody><tfoot><tr class="bg-surface-container-low font-bold border-t-2 border-outline-variant">';
    html += '<td class="p-sm" colspan="2">Total</td>';
    html += '<td class="p-sm text-right font-data-mono">' + totTon.toFixed(1) + ' T</td>';
    html += '<td class="p-sm text-right font-data-mono">' + totDocs + '</td>';
    html += '<td class="p-sm text-right font-data-mono">' + totCli + '</td>';
    html += '<td class="p-sm text-right font-data-mono">' + formatCLP(totGasto) + '</td>';
    html += '<td class="p-sm text-right font-data-mono">—</td>';
    html += '</tr></tfoot></table></div></div>';
  });

  if (sinCluster > 0) {
    const sinRows = clusterRoutes['__sin__'].sort((a, b) => b.ton - a.ton);
    html += '<div class="mb-lg border border-amber-200 rounded p-md bg-amber-50">';
    html += '<h3 class="font-bold text-[13px] text-amber-800 mb-sm flex items-center gap-xs">';
    html += '<span class="material-symbols-outlined text-[16px]">warning</span>Sin Cluster Asignado — ' + sinCluster + ' rutas</h3>';
    html += '<div class="bg-white border border-outline-variant rounded overflow-x-auto">';
    html += '<table class="w-full border-collapse text-[12px]">';
    html += '<thead><tr class="bg-surface-container-high border-b border-outline-variant text-left">';
    html += '<th class="p-sm font-label-caps text-secondary uppercase">Ruta</th><th class="p-sm font-label-caps text-secondary uppercase">Tipo</th>';
    html += '<th class="p-sm font-label-caps text-secondary uppercase text-right">Ton</th><th class="p-sm font-label-caps text-secondary uppercase text-right">Despachos</th></tr></thead>';
    html += '<tbody class="divide-y divide-outline-variant">';
    sinRows.forEach(r => {
      html += '<tr class="hover:bg-surface-container-low">';
      html += '<td class="p-sm font-bold">' + r.idRuta + (r.destino !== r.idRuta ? ' <span class="font-normal text-secondary text-[10px]">— ' + r.destino + '</span>' : '') + '</td>';
      html += '<td class="p-sm"><span class="text-[10px] px-xs py-px rounded border border-outline-variant">' + r.tipo + '</span></td>';
      html += '<td class="p-sm text-right font-data-mono">' + r.ton.toFixed(1) + ' T</td>';
      html += '<td class="p-sm text-right font-data-mono">' + r.docs + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

  html += '</div>';
  content.innerHTML = html;
}
