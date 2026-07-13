// MÓDULO: Administrador de Tarifas Clientes — SIT EBEMA v2.1
// Vistas: Histórico (6M) | Consolidación | Densidad Logística | Frecuencia y Especiales | Cluster | Resultados
import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig, saveHistorico, loadHistorico, getOrigenGroups } from './data.js?v=20260712g';
import { CAP_LIST, truckTypesWithCap, calcularCostoRuta } from './tarifas-engine.js?v=20260712g';
import { formatCLP, showAlert, toCSV, downloadFile, formatDateDDMMYYYY, escapeHtml } from './utils.js';

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
let zfmpFiltClasif  = 'todas';
let zfmpFiltCentro  = 'all';
let zfmpFiltCamion  = '';
let zfmpBuscar      = '';
let zfmpPagina      = 0;
let activeSubC        = 'historico';

// Permite fijar el subtab activo desde el menu lateral (app.js) antes de renderizar
export function setActiveSubC(sub) { activeSubC = sub; }
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
        const ctContent = document.getElementById('ct-content');
        if (ctContent) renderSub();
      }
    });
  }

  container.innerHTML = `<div id="ct-content"></div>`;

  renderSub();

  function renderSub() {
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
                  const objKey  = `consolidacionObjetivo.${g.replace(/\s/g,'_')}.${bkt}`;
                  const objetivo = getPath(ccfg, objKey, 80);
                  if (!s) return `<tr class="hover:bg-surface-container-low">
                    <td class="p-md font-bold">${CAP_LABELS[bkt]}</td>
                    <td class="p-md text-secondary text-[11px]" colspan="3">Sin registros</td>
                    <td class="p-md w-28">${numInput(objKey, objetivo)}</td>
                    <td colspan="2"></td>
                  </tr>`;
                  const pct = (s.avgFill * 100).toFixed(1);
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
  if (!histData.length) {
    content.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">${noDataBanner()}</div>`;
    return;
  }

  const cfg    = getTariffConfig(db);           // necesario para guardar participacionRutas
  const grupos = getOrigenGroups(db);

  // Lookup ruta por código/id
  const routeByCode = new Map();
  (db.routes || []).filter(r => r.activo).forEach(r => {
    if (r.codigo) routeByCode.set(String(r.codigo).toUpperCase(), r);
    if (r.id)     routeByCode.set(String(r.id).toUpperCase(), r);
  });

  // ── Construir datos por centro ──────────────────────────────────────────
  function buildCentroData(grupoObj) {
    const { grupo, centroIds } = grupoObj;
    const centroIdSet = new Set((centroIds || []).map(String));

    // Rutas candidatas: tipo=Comuna Y clasificRuta=Regional para este centro
    const centroRoutes = (db.routes || []).filter(r => {
      if (!r.activo) return false;
      if ((r.tipo || '').toLowerCase() !== 'comuna') return false;
      if (r.clasificRuta !== 'Regional') return false;
      if (r.origen_grupo) return r.origen_grupo === grupo;
      return centroIdSet.has(String(r.origenId));
    });
    if (!centroRoutes.length) return null;

    const validCodes = new Set();
    centroRoutes.forEach(r => {
      if (r.codigo) validCodes.add(String(r.codigo).toUpperCase());
      if (r.id)     validCodes.add(String(r.id).toUpperCase());
    });

    // Acumular stats desde histData
    const routeStats = new Map(); // codigo → { route, clientes, obras, ton }
    const totClientes = new Set();
    const totObras    = new Set();

    histData.forEach(h => {
      if (!validCodes.has(String(h.idRuta).toUpperCase())) return;
      const route = routeByCode.get(String(h.idRuta).toUpperCase());
      if (!route) return;
      const key = route.codigo || String(h.idRuta);
      if (!routeStats.has(key)) routeStats.set(key, { route, clientes: new Set(), obras: new Set(), ton: 0 });
      const s = routeStats.get(key);
      if (h.idCliente && h.idCliente !== '-') { s.clientes.add(h.idCliente); totClientes.add(h.idCliente); }
      if (h.idObra    && h.idObra    !== '-') { s.obras.add(h.idObra);       totObras.add(h.idObra); }
      s.ton += h.ton;
    });

    // Incluir rutas sin histórico (ton=0)
    centroRoutes.forEach(r => {
      const key = r.codigo || String(r.id);
      if (!routeStats.has(key)) routeStats.set(key, { route: r, clientes: new Set(), obras: new Set(), ton: 0 });
    });

    // Pools de toneladas por característica (ISLA y EXTREMA calculan su peso% sobre su propio pool)
    let totTonNormal = 0, totTonIsla = 0, totTonExtrema = 0;
    routeStats.forEach(s => {
      const c = (s.route.caracteristica || '').toUpperCase();
      if      (c === 'ISLA')    totTonIsla    += s.ton;
      else if (c === 'EXTREMA') totTonExtrema += s.ton;
      else                      totTonNormal  += s.ton;
    });
    const totTon  = totTonNormal + totTonIsla + totTonExtrema;
    const baseCli = totClientes.size || 1;
    const baseObr = totObras.size    || 1;
    const baseTon = totTon           || 1;

    const rows = [...routeStats.values()].map(s => {
      const caract   = (s.route.caracteristica || '').toUpperCase();
      const isIsla   = caract === 'ISLA';
      const isExt    = caract === 'EXTREMA';
      const pool     = isIsla ? totTonIsla : isExt ? totTonExtrema : totTonNormal;
      const peso     = pool > 0 ? (s.ton / pool) * 100 : 0;
      const pctCli   = (s.clientes.size / baseCli) * 100;
      const pctObra  = (s.obras.size    / baseObr) * 100;
      const pctTon   = (s.ton           / baseTon) * 100;
      const densidad = (pctCli + pctObra + pctTon) / 3;
      return {
        rutaId:     s.route.id     || '',
        rutaCodigo: s.route.codigo || '',
        destino:    s.route.destino || '',
        zona:       s.route.id_zona_transporte || '',
        caracteristica: caract,
        clientes:   s.clientes.size,
        obras:      s.obras.size,
        ton:        s.ton,
        pctCli, pctObra, pctTon, peso, densidad
      };
    }).sort((a, b) => b.densidad - a.densidad);

    return { grupo, rows,
      totalClientes: totClientes.size, totalObras: totObras.size,
      totTon, totTonNormal, totTonIsla, totTonExtrema };
  }

  const centrosData = grupos.map(buildCentroData).filter(Boolean);

  if (!centrosData.length) {
    content.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">${noDataBanner('No se encontraron rutas tipo=Comuna + clasificación=Regional.')}</div>`;
    return;
  }

  // ── HTML tarjeta por centro ─────────────────────────────────────────────
  function tablaHtml(cd) {
    const maxDen  = cd.rows[0]?.densidad || 1;
    const conHist = cd.rows.filter(r => r.ton > 0).length;
    const uid     = cd.grupo.replace(/[^a-z0-9]/gi, '_');
    const poolInfo = [
      `<b>${cd.totTonNormal.toFixed(1)} T</b> normal`,
      cd.totTonIsla    > 0 ? `<b>${cd.totTonIsla.toFixed(1)} T</b> isla`    : '',
      cd.totTonExtrema > 0 ? `<b>${cd.totTonExtrema.toFixed(1)} T</b> extrema` : ''
    ].filter(Boolean).join(' · ');

    return `
    <div class="border-2 border-outline-variant shadow-sm mb-xl rounded overflow-hidden" id="den-tabla-${uid}">
      <div class="flex items-center justify-between px-lg pt-md pb-sm border-b-2 border-primary bg-surface-container-high flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary text-[20px]">location_on</span>
          <h3 class="font-headline-sm font-bold text-on-surface">${escapeHtml(cd.grupo)}</h3>
        </div>
        <div class="flex items-center gap-md">
          <span class="font-data-mono text-[11px] text-secondary">${conHist} rutas con histórico · ${cd.totTon.toLocaleString('es-CL',{maximumFractionDigits:1})} ton · ${cd.rows.length} total</span>
          <button class="den-guardar-centro border border-primary text-primary hover:bg-primary hover:text-white font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase transition-colors" data-grupo="${escapeHtml(cd.grupo)}">
            <span class="material-symbols-outlined text-[14px]">save</span> Guardar
          </button>
        </div>
      </div>
      <div class="px-md py-sm flex gap-lg border-b border-outline-variant bg-surface-container-lowest text-[12px] text-secondary flex-wrap">
        <span><b>${cd.totalClientes}</b> clientes únicos</span>
        <span><b>${cd.totalObras}</b> obras únicas</span>
        <span>${poolInfo}</span>
        <span class="text-[10px] italic ml-auto">Peso% = ton/pool · Densidad = avg(%cli+%obras+%ton)</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-sm font-label-caps text-secondary uppercase text-right w-8">#</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Cód. Ruta</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Destino</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Zona</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Clientes</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Obras</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Toneladas</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Peso %</th>
              <th class="p-sm font-label-caps text-secondary uppercase text-right">Densidad %</th>
              <th class="p-sm font-label-caps text-secondary uppercase">Barra</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            ${cd.rows.map((r, i) => {
              const bc       = r.densidad >= 15 ? '#b5000b' : r.densidad >= 5 ? '#d97706' : '#6b7280';
              const bw       = maxDen > 0 ? Math.min(r.densidad / maxDen * 100, 100) : 0;
              const isEspec  = ['ISLA','EXTREMA'].includes(r.caracteristica);
              const specCls  = r.caracteristica === 'ISLA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700';
              const specBadge = isEspec ? `<span class="ml-xs inline-flex px-1 py-0.5 rounded text-[9px] font-bold ${specCls}">${r.caracteristica}</span>` : '';
              return `<tr class="border-b border-outline-variant hover:bg-surface-container-low">
                <td class="p-sm text-right text-secondary font-data-mono text-[11px]">${i+1}</td>
                <td class="p-sm font-data-mono text-[11px] text-primary font-bold">${escapeHtml(r.rutaCodigo)}</td>
                <td class="p-sm">${escapeHtml(r.destino)}${specBadge}</td>
                <td class="p-sm text-secondary text-[11px]">${escapeHtml(r.zona)}</td>
                <td class="p-sm text-right font-data-mono text-[11px]">${r.clientes} <span class="text-secondary">(${r.pctCli.toFixed(1)}%)</span></td>
                <td class="p-sm text-right font-data-mono text-[11px]">${r.obras} <span class="text-secondary">(${r.pctObra.toFixed(1)}%)</span></td>
                <td class="p-sm text-right font-data-mono text-[11px]">${r.ton.toFixed(1)} <span class="text-secondary">(${r.pctTon.toFixed(1)}%)</span></td>
                <td class="p-sm text-right font-bold font-data-mono text-[11px]">${r.peso.toFixed(2)}%</td>
                <td class="p-sm text-right font-bold font-data-mono text-[11px]" style="color:${bc}">${r.densidad.toFixed(2)}%</td>
                <td class="p-sm"><div class="w-20 h-2 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${bw}%;background:${bc}"></div></div></td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="bg-surface-container-high border-t-2 border-outline-variant font-bold">
              <td colspan="4" class="p-sm text-right">Total</td>
              <td class="p-sm text-right font-data-mono text-[11px]">${cd.totalClientes}</td>
              <td class="p-sm text-right font-data-mono text-[11px]">${cd.totalObras}</td>
              <td class="p-sm text-right font-data-mono text-[11px]">${cd.totTon.toFixed(1)} T</td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
  }

  content.innerHTML = `
    <div>
      <div class="flex items-center gap-sm mb-lg flex-wrap">
        <span class="material-symbols-outlined text-primary">location_on</span>
        <h2 class="font-headline-sm font-bold text-on-surface">Densidad Logística y Participación de Rutas</h2>
        <span class="text-[11px] text-secondary ml-auto">Solo rutas tipo=Comuna + Regional · Ordena por Densidad desc</span>
      </div>
      ${centrosData.map(cd => tablaHtml(cd)).join('')}
    </div>
  `;

  // ── Guardar participación al hacer click ────────────────────────────────
  content.querySelectorAll('.den-guardar-centro').forEach(btn => {
    btn.addEventListener('click', () => {
      const grupo = btn.dataset.grupo;
      const cd    = centrosData.find(c => c.grupo === grupo);
      if (!cd) return;
      if (!cfg.participacionRutas) cfg.participacionRutas = {};
      cd.rows.forEach(r => {
        const entry = { peso: r.peso / 100, toneladas: r.ton, clientes: r.clientes, obras: r.obras };
        if (r.rutaId)     cfg.participacionRutas[String(r.rutaId)]     = entry;
        if (r.rutaCodigo) cfg.participacionRutas[String(r.rutaCodigo)] = entry;
      });
      saveDatabase(db);
      btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">check_circle</span> Guardado';
      btn.classList.add('bg-primary','text-white');
      setTimeout(() => {
        btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">save</span> Guardar';
        btn.classList.remove('bg-primary','text-white');
      }, 2000);
    });
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
// ASIGNACIÓN AUTOMÁTICA DE CLUSTERS (por centro)
// ─────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Asigna clusters a las filas de un centro (rows con .densidad, .lat, .lon, .rutaId, .rutaCodigo)
// Algoritmo: K-means simplificado con distancia mixta (0.6×geo + 0.4×densidad)
function asignarClustersCentro(rows, ccfg) {
  const clKeys = ccfg.clusters
    .filter(c => c.key !== 'spot' && !isNaN(parseInt(c.key)))
    .sort((a, b) => parseInt(a.key) - parseInt(b.key))
    .map(c => c.key);
  if (!clKeys.length || !rows.length) return;

  const n = rows.length;
  const k = Math.min(clKeys.length, n);

  // Inicializar centros de cluster repartidos por densidad (rows ya ordenadas desc)
  const centros = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * n / k);
    centros.push({
      lat: rows[idx].lat || -38,
      lon: rows[idx].lon || -72,
      densidad: rows[idx].densidad
    });
  }

  const asignacion = new Array(n).fill(0);

  for (let iter = 0; iter < 15; iter++) {
    let cambios = 0;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      let mejorJ = 0, mejorDist = Infinity;
      for (let j = 0; j < k; j++) {
        const distGeo = (r.lat && r.lon && centros[j].lat && centros[j].lon)
          ? haversineKm(r.lat, r.lon, centros[j].lat, centros[j].lon)
          : 500;
        // Normalizar densidad diff (escala ~0-33) para que sea comparable con distancia km
        const distDen = Math.abs(r.densidad - centros[j].densidad) * 8;
        const distTotal = distGeo * 0.6 + distDen * 0.4;
        if (distTotal < mejorDist) { mejorDist = distTotal; mejorJ = j; }
      }
      if (asignacion[i] !== mejorJ) { asignacion[i] = mejorJ; cambios++; }
    }
    if (cambios === 0) break;

    // Recalcular centroides
    for (let j = 0; j < k; j++) {
      let sumLat = 0, sumLon = 0, sumDen = 0, cntGeo = 0, cntDen = 0;
      for (let i = 0; i < n; i++) {
        if (asignacion[i] !== j) continue;
        if (rows[i].lat && rows[i].lon) { sumLat += rows[i].lat; sumLon += rows[i].lon; cntGeo++; }
        sumDen += rows[i].densidad; cntDen++;
      }
      if (cntGeo  > 0) { centros[j].lat = sumLat / cntGeo; centros[j].lon = sumLon / cntGeo; }
      if (cntDen  > 0)   centros[j].densidad = sumDen / cntDen;
    }
  }

  // El cluster con mayor densidad promedio → key más bajo (cluster 1 = más importante)
  const centrosDen = centros.map((c, j) => ({ j, den: c.densidad }));
  centrosDen.sort((a, b) => b.den - a.den); // mayor densidad primero
  const jToKey = {};
  centrosDen.forEach((cd, rank) => { jToKey[cd.j] = clKeys[rank] || clKeys[clKeys.length - 1]; });

  // Aplicar asignación a las filas y a ccfg.comunaCluster
  for (let i = 0; i < n; i++) {
    const cl = jToKey[asignacion[i]];
    rows[i].cluster = cl;
    if (rows[i].rutaId)     ccfg.comunaCluster[String(rows[i].rutaId)]     = cl;
    if (rows[i].rutaCodigo) ccfg.comunaCluster[String(rows[i].rutaCodigo)] = cl;
  }
}

// ═══════════════════════════════════════════════════════════════
// VISTA 5: CLUSTER — por centro, solo Regional+Comuna
// ═══════════════════════════════════════════════════════════════
function renderCluster(content, db, ccfg) {
  if (!histData.length) {
    content.innerHTML = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' + noDataBanner() + '</div>';
    return;
  }

  const grupos = getOrigenGroups(db);

  // ── Lookup ruta por código / id ──────────────────────────────────────────
  const routeByCode = new Map();
  (db.routes || []).filter(r => r.activo).forEach(r => {
    if (r.codigo) routeByCode.set(String(r.codigo).toUpperCase(), r);
    if (r.id)     routeByCode.set(String(r.id).toUpperCase(),     r);
  });

  // ── Construir datos de densidad por centro (igual que renderDensidad) ────
  function buildCentroData(grupoObj) {
    const { grupo, centroIds } = grupoObj;
    const centroIdSet = new Set((centroIds || []).map(String));

    const centroRoutes = (db.routes || []).filter(r => {
      if (!r.activo) return false;
      if ((r.tipo || '').toLowerCase() !== 'comuna') return false;
      if (r.clasificRuta !== 'Regional') return false;
      if (r.origen_grupo) return r.origen_grupo === grupo;
      return centroIdSet.has(String(r.origenId));
    });
    if (!centroRoutes.length) return null;

    const validCodes = new Set();
    centroRoutes.forEach(r => {
      if (r.codigo) validCodes.add(String(r.codigo).toUpperCase());
      if (r.id)     validCodes.add(String(r.id).toUpperCase());
    });

    const routeStats = new Map();
    const totClientes = new Set();
    const totObras    = new Set();

    histData.forEach(h => {
      if (!validCodes.has(String(h.idRuta).toUpperCase())) return;
      const route = routeByCode.get(String(h.idRuta).toUpperCase());
      if (!route) return;
      const key = route.codigo || String(h.idRuta);
      if (!routeStats.has(key)) routeStats.set(key, { route, clientes: new Set(), obras: new Set(), ton: 0 });
      const s = routeStats.get(key);
      if (h.idCliente && h.idCliente !== '-') { s.clientes.add(h.idCliente); totClientes.add(h.idCliente); }
      if (h.idObra    && h.idObra    !== '-') { s.obras.add(h.idObra);       totObras.add(h.idObra); }
      s.ton += h.ton;
    });

    // Incluir rutas sin histórico
    centroRoutes.forEach(r => {
      const key = r.codigo || String(r.id);
      if (!routeStats.has(key)) routeStats.set(key, { route: r, clientes: new Set(), obras: new Set(), ton: 0 });
    });

    let totTon = 0;
    routeStats.forEach(s => { totTon += s.ton; });
    const baseCli = totClientes.size || 1;
    const baseObr = totObras.size    || 1;
    const baseTon = totTon           || 1;

    const rows = [...routeStats.values()].map(s => {
      const pctCli   = (s.clientes.size / baseCli) * 100;
      const pctObra  = (s.obras.size    / baseObr) * 100;
      const pctTon   = (s.ton           / baseTon) * 100;
      const densidad = (pctCli + pctObra + pctTon) / 3;
      const caract   = (s.route.caracteristica || '').toUpperCase();
      return {
        rutaId:     String(s.route.id     || ''),
        rutaCodigo: String(s.route.codigo || ''),
        destino:    s.route.destino || '',
        zona:       s.route.id_zona_transporte || '',
        caracteristica: caract,
        ton:        s.ton,
        densidad,
        lat:  parseFloat(s.route.lat)  || null,
        lon:  parseFloat(s.route.lon)  || null,
        cluster: ccfg.comunaCluster[String(s.route.id || '')] ||
                 ccfg.comunaCluster[String(s.route.codigo || '')] || ''
      };
    }).sort((a, b) => {
      // 1) Por cluster: numérico asc (1, 2, 3), luego 'spot', luego sin asignar
      const clOrd = cl => {
        if (!cl) return 999;
        if (cl === 'spot') return 500;
        const n = parseInt(cl, 10);
        return isNaN(n) ? 400 : n;
      };
      const ca = clOrd(a.cluster), cb = clOrd(b.cluster);
      if (ca !== cb) return ca - cb;
      // 2) Dentro del mismo cluster: densidad desc
      return b.densidad - a.densidad;
    });

    return { grupo, rows, totTon };
  }

  const centrosData = grupos.map(buildCentroData).filter(Boolean);

  if (!centrosData.length) {
    content.innerHTML = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' +
      noDataBanner('No se encontraron rutas tipo=Comuna + Regional.') + '</div>';
    return;
  }

  // ── HTML: leyenda de clusters ────────────────────────────────────────────
  const leyenda = ccfg.clusters.map(c =>
    '<span class="flex items-center gap-xs text-[11px]">' +
    '<span class="inline-block w-3 h-3 rounded-full flex-shrink-0" style="background:' + c.color + '"></span>' +
    escapeHtml(c.nombre) + '</span>'
  ).join('') +
  '<span class="flex items-center gap-xs text-[11px]">' +
  '<span class="inline-block w-3 h-3 rounded-full bg-gray-300 flex-shrink-0"></span>Sin cluster</span>';

  // ── HTML: tarjeta por centro ─────────────────────────────────────────────
  function cardHtml(cd) {
    const uid      = cd.grupo.replace(/[^a-z0-9]/gi, '_');
    const asig     = cd.rows.filter(r => r.cluster).length;
    const maxDen   = cd.rows[0]?.densidad || 1;

    const rowsHtml = cd.rows.map((r, i) => {
      const bc      = r.densidad >= 15 ? '#b5000b' : r.densidad >= 5 ? '#d97706' : '#6b7280';
      const bw      = maxDen > 0 ? Math.min(r.densidad / maxDen * 100, 100) : 0;
      const clColor = r.cluster ? (clusterColor(ccfg, r.cluster) || '#9ca3af') : '#d1d5db';
      const dot     = '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 cl-dot" style="background:' + clColor + '"></span>';
      const isEspec   = ['ISLA','EXTREMA'].includes(r.caracteristica);
      const specBadge = isEspec
        ? '<span class="ml-xs inline-flex px-1 py-0.5 rounded text-[9px] font-bold ' +
          (r.caracteristica === 'ISLA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700') +
          '">' + r.caracteristica + '</span>'
        : '';
      const opts = '<option value="">— Sin cluster —</option>' +
        ccfg.clusters.map(c =>
          '<option value="' + c.key + '"' + (r.cluster === c.key ? ' selected' : '') + '>' + escapeHtml(c.nombre) + '</option>'
        ).join('');
      return '<tr class="hover:bg-surface-container-low border-b border-outline-variant">' +
        '<td class="p-sm text-right text-secondary font-data-mono text-[11px] w-8">' + (i + 1) + '</td>' +
        '<td class="p-sm font-data-mono text-[11px] text-primary font-bold">' + escapeHtml(r.rutaCodigo) + '</td>' +
        '<td class="p-sm text-[12px]">' + escapeHtml(r.destino) + specBadge + '</td>' +
        '<td class="p-sm text-secondary text-[11px]">' + escapeHtml(r.zona) + '</td>' +
        '<td class="p-sm text-right w-28">' +
          '<div class="flex items-center gap-xs justify-end">' +
            '<span class="font-bold font-data-mono text-[11px]" style="color:' + bc + '">' + r.densidad.toFixed(2) + '%</span>' +
            '<div class="w-12 h-1.5 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:' + bw + '%;background:' + bc + '"></div></div>' +
          '</div>' +
        '</td>' +
        '<td class="p-sm">' +
          '<div class="flex items-center gap-xs">' +
            dot +
            '<select class="cl-assign border border-[#CED4DA] px-xs py-px text-[11px] bg-white rounded w-full" ' +
              'data-ruta-id="' + escapeHtml(r.rutaId) + '" ' +
              'data-ruta-cod="' + escapeHtml(r.rutaCodigo) + '" ' +
              'data-grupo="' + escapeHtml(cd.grupo) + '">' +
              opts +
            '</select>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="border-2 border-outline-variant shadow-sm mb-xl rounded overflow-hidden" id="cl-card-' + uid + '">' +
      '<div class="flex items-center justify-between px-lg pt-md pb-sm border-b-2 border-primary bg-surface-container-high flex-wrap gap-sm">' +
        '<div class="flex items-center gap-sm">' +
          '<span class="material-symbols-outlined text-primary text-[20px]">hub</span>' +
          '<h3 class="font-headline-sm font-bold text-on-surface">' + escapeHtml(cd.grupo) + '</h3>' +
        '</div>' +
        '<div class="flex items-center gap-sm flex-wrap">' +
          '<span class="font-data-mono text-[11px] text-secondary">' + asig + '/' + cd.rows.length + ' asignadas · ' + cd.totTon.toFixed(1) + ' ton</span>' +
          '<button class="cl-auto-centro border border-secondary text-secondary hover:bg-secondary/10 font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase transition-colors" data-grupo="' + escapeHtml(cd.grupo) + '">' +
            '<span class="material-symbols-outlined text-[14px]">auto_awesome</span> Auto' +
          '</button>' +
          '<button class="cl-guardar-centro border border-primary text-primary hover:bg-primary hover:text-white font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase transition-colors" data-grupo="' + escapeHtml(cd.grupo) + '">' +
            '<span class="material-symbols-outlined text-[14px]">save</span> Guardar' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="overflow-x-auto">' +
        '<table class="w-full border-collapse text-[12px]">' +
          '<thead>' +
            '<tr class="bg-surface-container-high text-left border-b border-outline-variant">' +
              '<th class="p-sm font-label-caps text-secondary uppercase text-right w-8">#</th>' +
              '<th class="p-sm font-label-caps text-secondary uppercase">Cód. Ruta</th>' +
              '<th class="p-sm font-label-caps text-secondary uppercase">Destino</th>' +
              '<th class="p-sm font-label-caps text-secondary uppercase">Zona</th>' +
              '<th class="p-sm font-label-caps text-secondary uppercase text-right">Densidad %</th>' +
              '<th class="p-sm font-label-caps text-secondary uppercase">Cluster</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody class="divide-y divide-outline-variant">' +
            rowsHtml +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  // ── Render HTML ──────────────────────────────────────────────────────────
  content.innerHTML =
    '<div>' +
      '<div class="flex items-center gap-sm mb-md flex-wrap">' +
        '<span class="material-symbols-outlined text-primary">hub</span>' +
        '<h2 class="font-headline-sm font-bold text-on-surface">Asignación de Cluster por Ruta</h2>' +
        '<span class="text-[11px] text-secondary ml-xs">Solo rutas tipo=Comuna + Regional · Agrupado por centro</span>' +
        '<button id="btn-auto-todos" class="ml-auto flex items-center gap-xs border border-primary text-primary hover:bg-primary/[0.06] font-bold px-md py-sm rounded text-[11px] uppercase tracking-wider">' +
          '<span class="material-symbols-outlined text-[16px]">auto_awesome</span> Asignar todos automáticamente' +
        '</button>' +
      '</div>' +
      '<div class="flex flex-wrap gap-md mb-lg">' + leyenda + '</div>' +
      centrosData.map(cd => cardHtml(cd)).join('') +
    '</div>';

  // ── Evento: cambio de cluster individual ────────────────────────────────
  content.querySelectorAll('.cl-assign').forEach(sel => {
    sel.addEventListener('change', () => {
      const rutaId  = sel.dataset.rutaId;
      const rutaCod = sel.dataset.rutaCod;
      if (sel.value) {
        if (rutaId)  ccfg.comunaCluster[rutaId]  = sel.value;
        if (rutaCod) ccfg.comunaCluster[rutaCod] = sel.value;
      } else {
        if (rutaId)  delete ccfg.comunaCluster[rutaId];
        if (rutaCod) delete ccfg.comunaCluster[rutaCod];
      }
      // Actualizar dot de color en la misma fila sin re-render
      const dot = sel.closest('td')?.querySelector('.cl-dot');
      if (dot) dot.style.background = sel.value ? (clusterColor(ccfg, sel.value) || '#9ca3af') : '#d1d5db';
    });
  });

  // ── Evento: auto-asignar por centro ─────────────────────────────────────
  content.querySelectorAll('.cl-auto-centro').forEach(btn => {
    btn.addEventListener('click', () => {
      const grupo = btn.dataset.grupo;
      const cd    = centrosData.find(c => c.grupo === grupo);
      if (!cd) return;
      if (!confirm('¿Asignar clusters automáticamente para "' + grupo + '"?\n\nAlgoritmo: densidad logística + cercanía geográfica de comunas\n(Cluster 1 = mayor densidad, rutas cercanas heredan el mismo cluster)')) return;
      asignarClustersCentro(cd.rows, ccfg);
      // Re-render solo esa tarjeta
      const uid  = grupo.replace(/[^a-z0-9]/gi, '_');
      const card = document.getElementById('cl-card-' + uid);
      if (card) {
        const tmp = document.createElement('div');
        tmp.innerHTML = cardHtml(cd);
        card.replaceWith(tmp.firstElementChild);
        // Re-bind eventos en la nueva tarjeta
        document.getElementById('cl-card-' + uid)?.querySelectorAll('.cl-assign').forEach(s => {
          s.addEventListener('change', () => {
            const rid = s.dataset.rutaId; const rcd = s.dataset.rutaCod;
            if (s.value) { if (rid) ccfg.comunaCluster[rid]=s.value; if (rcd) ccfg.comunaCluster[rcd]=s.value; }
            else          { if (rid) delete ccfg.comunaCluster[rid];  if (rcd) delete ccfg.comunaCluster[rcd]; }
            const dot = s.closest('td')?.querySelector('.cl-dot');
            if (dot) dot.style.background = s.value ? (clusterColor(ccfg, s.value) || '#9ca3af') : '#d1d5db';
          });
        });
        document.getElementById('cl-card-' + uid)?.querySelectorAll('.cl-guardar-centro').forEach(b => {
          b.addEventListener('click', () => { saveDatabase(db); flashGuardar(b); });
        });
        document.getElementById('cl-card-' + uid)?.querySelectorAll('.cl-auto-centro').forEach(b => {
          b.click; // rebind handled by renderCluster re-call fallback
        });
      }
      showAlert('Clusters asignados para ' + grupo + '.');
    });
  });

  // ── Evento: guardar por centro ───────────────────────────────────────────
  function flashGuardar(btn) {
    saveDatabase(db);
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">check_circle</span> Guardado';
    btn.classList.add('bg-primary', 'text-white');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('bg-primary','text-white'); }, 2000);
  }

  content.querySelectorAll('.cl-guardar-centro').forEach(btn => {
    btn.addEventListener('click', () => flashGuardar(btn));
  });

  // ── Evento: auto-asignar TODOS los centros ───────────────────────────────
  document.getElementById('btn-auto-todos')?.addEventListener('click', () => {
    if (!confirm('¿Asignar clusters automáticamente para TODOS los centros?\n\nAlgoritmo: densidad logística + cercanía geográfica de comunas\n\nEsto reemplazará todas las asignaciones existentes.')) return;
    centrosData.forEach(cd => asignarClustersCentro(cd.rows, ccfg));
    saveDatabase(db);
    renderCluster(content, db, ccfg);
    showAlert('Clusters asignados automáticamente para todos los centros.');
  });
}

// ═══════════════════════════════════════════════════════════════
// VISTA 6: TARIFAS $/KG  (ZFMP por ruta × tipo de camión)
// ═══════════════════════════════════════════════════════════════
const ZFMP_PAGE = 50;

function renderResultados(content, db, cfg, ccfg) {
  // ── Construir TODAS las combinaciones ruta × tipo camión ─────────────────
  const allRows = [];
  (db.routes || []).filter(r => r.activo).forEach(ruta => {
    const grupo    = ruta.origen_grupo || '';
    const grupoKey = grupo.replace(/\s/g, '_');
    const cluster  = ccfg.comunaCluster[String(ruta.id || '')] ||
                     ccfg.comunaCluster[String(ruta.codigo || '')] || '';

    truckTypesWithCap(db, ruta.origenId).forEach(t => {
      const capKg           = t.capKg;
      const bkt             = capKg / 1000;
      const factorPct       = getPath(ccfg, `consolidacionObjetivo.${grupoKey}.${bkt}`, 80);
      const kilosConsolidar = capKg * (factorPct / 100);
      let zcap = null;
      try { zcap = calcularCostoRuta(db, cfg, ruta, capKg).zcap; } catch (_) {}
      const zfmp = (zcap !== null && kilosConsolidar > 0) ? zcap / kilosConsolidar : null;

      allRows.push({
        centroOrigen:  grupo,
        idRuta:        ruta.codigo || String(ruta.id || ''),
        destino:       ruta.destino || '',
        tipo:          ruta.tipo || '',
        clasificacion: ruta.clasificRuta || '',
        km:            Number(ruta.km) || 0,
        cluster, capKg, factorPct, kilosConsolidar, zcap, zfmp,
        tipoCamion: t.type || (bkt + 'T')
      });
    });
  });

  if (!allRows.length) {
    content.innerHTML = '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' +
      noDataBanner('No hay rutas activas con tipos de camión configurados.') + '</div>';
    return;
  }

  // ── Centros únicos (para tabs) ────────────────────────────────────────────
  const centros = [...new Set(allRows.map(r => r.centroOrigen))].filter(Boolean).sort();

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const buscarNorm = zfmpBuscar.trim().toLowerCase();
  const filtered = allRows.filter(r => {
    if (zfmpFiltClasif !== 'todas') {
      const cl = (r.clasificacion || '').toLowerCase();
      if (zfmpFiltClasif === 'regional'      && cl !== 'regional')      return false;
      if (zfmpFiltClasif === 'interregional' && cl !== 'interregional') return false;
    }
    if (zfmpFiltCentro !== 'all' && r.centroOrigen !== zfmpFiltCentro) return false;
    if (zfmpFiltCamion && String(r.capKg) !== zfmpFiltCamion)          return false;
    if (buscarNorm && !r.idRuta.toLowerCase().includes(buscarNorm) &&
        !r.destino.toLowerCase().includes(buscarNorm))                  return false;
    return true;
  });

  const totalPags  = Math.max(1, Math.ceil(filtered.length / ZFMP_PAGE));
  if (zfmpPagina >= totalPags) zfmpPagina = 0;
  const pageRows   = filtered.slice(zfmpPagina * ZFMP_PAGE, (zfmpPagina + 1) * ZFMP_PAGE);

  // ── Helpers UI ────────────────────────────────────────────────────────────
  const selCls  = 'border border-[#CED4DA] px-sm py-[7px] text-[12px] bg-white rounded focus:border-primary focus:ring-0';
  const tabCls  = (active) => 'px-md py-xs border rounded text-[12px] font-bold uppercase transition-colors ' +
    (active ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');
  const centroCls = (v) => 'zfmp-ctab px-sm py-xs border rounded text-[11px] font-bold uppercase transition-colors ' +
    (zfmpFiltCentro === v ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');

  // Filas de tabla
  const rowsHtml = pageRows.length === 0
    ? '<tr><td colspan="12" class="p-md text-center text-secondary">Sin resultados.</td></tr>'
    : pageRows.map(r => {
        const clColor  = r.cluster ? (clusterColor(ccfg, r.cluster) || '#9ca3af') : '#d1d5db';
        const clNombre = r.cluster ? escapeHtml(clusterNombre(ccfg, r.cluster)) : '—';
        return '<tr class="hover:bg-surface-container-low border-b border-outline-variant text-[12px]">' +
          '<td class="p-sm text-[11px] text-secondary whitespace-nowrap">' + escapeHtml(r.centroOrigen) + '</td>' +
          '<td class="p-sm font-data-mono font-bold text-primary text-[11px]">' + escapeHtml(r.idRuta) + '</td>' +
          '<td class="p-sm whitespace-nowrap">' + escapeHtml(r.destino) + '</td>' +
          '<td class="p-sm text-[11px]"><span class="border border-outline-variant px-xs py-px rounded">' + escapeHtml(r.tipo) + '</span></td>' +
          '<td class="p-sm text-[11px] text-secondary">' + escapeHtml(r.clasificacion) + '</td>' +
          '<td class="p-sm text-right font-data-mono text-[11px]">' + r.km.toLocaleString('es-CL') + '</td>' +
          '<td class="p-sm">' +
            '<div class="flex items-center gap-xs">' +
              '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:' + clColor + '"></span>' +
              '<span class="text-[11px]">' + clNombre + '</span>' +
            '</div>' +
          '</td>' +
          '<td class="p-sm text-[11px]"><span class="border border-outline-variant px-xs py-px rounded font-data-mono">' + escapeHtml(r.tipoCamion) + '</span></td>' +
          '<td class="p-sm text-right font-data-mono text-[11px]">' + (r.zcap !== null ? formatCLP(r.zcap) : '<span class="text-secondary">—</span>') + '</td>' +
          '<td class="p-sm text-right font-data-mono text-[11px]">' + r.factorPct.toFixed(1) + '%</td>' +
          '<td class="p-sm text-right font-data-mono text-[11px]">' + r.kilosConsolidar.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' kg</td>' +
          '<td class="p-sm text-right font-bold font-data-mono text-[11px] text-primary">' +
            (r.zfmp !== null
              ? '$' + r.zfmp.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '<span class="text-secondary font-normal">—</span>') +
          '</td>' +
        '</tr>';
      }).join('');

  // Paginador
  const desde   = zfmpPagina * ZFMP_PAGE + 1;
  const hasta   = Math.min((zfmpPagina + 1) * ZFMP_PAGE, filtered.length);
  const prevDis = zfmpPagina === 0 ? 'disabled opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  const nextDis = zfmpPagina >= totalPags - 1 ? 'disabled opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  const pager   =
    '<div class="flex items-center justify-between mt-sm flex-wrap gap-sm">' +
      '<span class="text-[12px] text-secondary">Mostrando ' + desde + '–' + hasta + ' de ' + filtered.length + '</span>' +
      '<div class="flex items-center gap-xs">' +
        '<button id="zfmp-pag-prev" class="px-sm py-xs border border-outline-variant rounded text-[12px] ' + prevDis + '"' + (zfmpPagina === 0 ? ' disabled' : '') + '>‹ Ant.</button>' +
        '<span class="px-sm text-[12px]">Pág. ' + (zfmpPagina + 1) + ' / ' + totalPags + '</span>' +
        '<button id="zfmp-pag-next" class="px-sm py-xs border border-outline-variant rounded text-[12px] ' + nextDis + '"' + (zfmpPagina >= totalPags - 1 ? ' disabled' : '') + '>Sig. ›</button>' +
      '</div>' +
    '</div>';

  content.innerHTML =
    '<div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">' +

      // ── Header ─────────────────────────────────────────────────────────────
      '<div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">' +
        '<div class="flex items-center gap-sm">' +
          '<span class="material-symbols-outlined text-primary">price_change</span>' +
          '<h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Tarifas $/Kg</h2>' +
        '</div>' +
        '<div class="flex items-center gap-sm">' +
          '<button id="btn-zfmp-download" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">' +
            '<span class="material-symbols-outlined text-[18px]">download</span> Descargar CSV' +
          '</button>' +
        '</div>' +
      '</div>' +

      // ── Tabs clasificación ──────────────────────────────────────────────────
      '<div class="flex items-center gap-xs mb-sm flex-wrap">' +
        '<span class="text-[11px] text-secondary font-bold uppercase mr-xs">Tipo:</span>' +
        [['todas','Todas'],['regional','Regional'],['interregional','Interregional']].map(([v,l]) =>
          '<button class="zfmp-ctipo ' + tabCls(zfmpFiltClasif === v) + '" data-v="' + v + '">' + l + '</button>'
        ).join('') +
      '</div>' +

      // ── Tabs centros ───────────────────────────────────────────────────────
      '<div class="flex items-center gap-xs mb-md flex-wrap">' +
        '<button class="' + centroCls('all') + '" data-c="all">Todos</button>' +
        centros.map(c =>
          '<button class="' + centroCls(c) + '" data-c="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>'
        ).join('') +
      '</div>' +

      // ── Filtros fila ────────────────────────────────────────────────────────
      '<div class="flex flex-wrap items-end gap-md mb-md">' +
        '<div>' +
          '<label class="font-label-caps text-label-caps text-secondary block mb-xs text-[10px] uppercase">Tipo Camión</label>' +
          '<select id="zfmp-f-camion" class="' + selCls + ' w-40">' +
            '<option value=""' + (!zfmpFiltCamion ? ' selected' : '') + '>Todos</option>' +
            [5000,10000,15000,28000].map(kg =>
              '<option value="' + kg + '"' + (zfmpFiltCamion === String(kg) ? ' selected' : '') + '>' + (kg/1000).toLocaleString('es-CL') + '.000 Kg</option>'
            ).join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label class="font-label-caps text-label-caps text-secondary block mb-xs text-[10px] uppercase">Buscar Ruta / Destino</label>' +
          '<input id="zfmp-f-buscar" type="text" placeholder="Código o destino..." value="' + escapeHtml(zfmpBuscar) + '" ' +
            'class="' + selCls + ' w-52">' +
        '</div>' +
        '<button id="zfmp-reset" class="border border-outline-variant px-md py-[7px] text-[12px] text-secondary hover:bg-surface-container-high rounded flex items-center gap-xs">' +
          '<span class="material-symbols-outlined text-[16px]">filter_alt_off</span> Limpiar' +
        '</button>' +
        '<span class="ml-auto text-[12px] text-secondary">' + filtered.length + ' fila(s)</span>' +
      '</div>' +

      // ── Tabla ───────────────────────────────────────────────────────────────
      '<div class="bg-surface border border-outline-variant rounded overflow-x-auto">' +
        '<table class="w-full border-collapse">' +
          '<thead>' +
            '<tr class="bg-surface-container-high border-b border-outline-variant text-left">' +
              ['Centro Origen','ID Ruta','Destino','Tipo','Clasificación','Dist. KM',
               'Cluster','Tipo Camión','ZCAP','Factor Cons.','Kilos Consol.','ZFMP $/kg'].map((h, i) =>
                '<th class="p-sm font-label-caps text-secondary uppercase text-[10px]' + (i >= 5 ? ' text-right' : '') + '">' + h + '</th>'
              ).join('') +
            '</tr>' +
          '</thead>' +
          '<tbody class="divide-y divide-outline-variant">' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      pager +

      // Fórmula info
      '<div class="text-[11px] text-secondary mt-sm flex flex-wrap gap-lg">' +
        '<span><b>Kilos Consol.</b> = Cap. Camión × Factor Consolidación</span>' +
        '<span><b>ZFMP $/kg</b> = ZCAP ÷ Kilos Consol.</span>' +
      '</div>' +
    '</div>';

  // ── Eventos ──────────────────────────────────────────────────────────────

  // Tabs clasificación
  content.querySelectorAll('.zfmp-ctipo').forEach(btn => {
    btn.addEventListener('click', () => { zfmpFiltClasif = btn.dataset.v; zfmpPagina = 0; renderResultados(content, db, cfg, ccfg); });
  });

  // Tabs centros
  content.querySelectorAll('.zfmp-ctab').forEach(btn => {
    btn.addEventListener('click', () => { zfmpFiltCentro = btn.dataset.c; zfmpPagina = 0; renderResultados(content, db, cfg, ccfg); });
  });

  // Tipo camión
  document.getElementById('zfmp-f-camion')?.addEventListener('change', e => {
    zfmpFiltCamion = e.target.value; zfmpPagina = 0; renderResultados(content, db, cfg, ccfg);
  });

  // Buscar (preserva cursor)
  document.getElementById('zfmp-f-buscar')?.addEventListener('input', e => {
    const pos = e.target.selectionStart;
    zfmpBuscar = e.target.value; zfmpPagina = 0;
    renderResultados(content, db, cfg, ccfg);
    const el = document.getElementById('zfmp-f-buscar');
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });

  // Limpiar
  document.getElementById('zfmp-reset')?.addEventListener('click', () => {
    zfmpFiltClasif = 'todas'; zfmpFiltCentro = 'all'; zfmpFiltCamion = ''; zfmpBuscar = ''; zfmpPagina = 0;
    renderResultados(content, db, cfg, ccfg);
  });

  // Paginación
  document.getElementById('zfmp-pag-prev')?.addEventListener('click', () => {
    zfmpPagina = Math.max(0, zfmpPagina - 1); renderResultados(content, db, cfg, ccfg);
  });
  document.getElementById('zfmp-pag-next')?.addEventListener('click', () => {
    zfmpPagina = Math.min(totalPags - 1, zfmpPagina + 1); renderResultados(content, db, cfg, ccfg);
  });

  // Descargar CSV
  document.getElementById('btn-zfmp-download')?.addEventListener('click', () => {
    const headers = ['Centro Origen','ID Ruta','Destino','Tipo','Clasificacion','Dist KM',
                     'Cluster','Tipo Camion','ZCAP','Factor Consolidacion %','Kilos a Consolidar','ZFMP $/kg'];
    const data = filtered.map(r => [
      r.centroOrigen, r.idRuta, r.destino, r.tipo, r.clasificacion, r.km,
      r.cluster ? clusterNombre(ccfg, r.cluster) : '',
      r.tipoCamion,
      r.zcap    !== null ? r.zcap.toFixed(2)    : '',
      r.factorPct.toFixed(1),
      r.kilosConsolidar.toFixed(0),
      r.zfmp    !== null ? r.zfmp.toFixed(4)    : ''
    ]);
    downloadFile('tarifas_kg_' + Date.now() + '.csv', toCSV(headers, data));
  });
}
