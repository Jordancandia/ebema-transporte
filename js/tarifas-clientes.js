// PANTALLA 2: Administrador de Tarifas Clientes — SIT EBEMA
// Sub-módulos: Histórico (CSV), Consolidación y Clusters (mapa de calor),
// Frecuencias y Tarifas Especiales, y Resultados ZFMI/ZFMP/ZFMX + exportación ERP.
import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig, getCentreName, truckCapKg } from './data.js';
import { CAP_LIST, truckTypesWithCap, calcularCostoRuta } from './tarifas-engine.js';
import { formatCLP, parseCSV, showAlert, toCSV, downloadFile, formatDateDDMMYYYY, geocodeAddress } from './utils.js';

let activeSubC = 'historico';

// Capacidad nominal en toneladas por capacidad en kg
const CAPACITY_TONS = { 5000: 5, 10000: 10, 15000: 15, 28000: 28 };
// Tramo de camión siguiente (para el cálculo de ZFMP "auto-selección de tramo superior")
const NEXT_CAP = { 5000: 10000, 10000: 15000, 15000: 28000, 28000: 28000 };
const CLUSTER_KEYS = ['1', '2', '3', 'spot'];
const CLUSTER_LABELS = { '1': 'Cluster 1 — Alta densidad', '2': 'Cluster 2 — Media densidad', '3': 'Cluster 3 — Baja densidad', spot: 'SPOT / Interregional' };
const VALIDEZ_A = '31-12-2026';

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
function textInput(path, value, extra = '') {
  return `<input type="text" class="${inputCls} text-left" data-path="${path}" value="${value || ''}" ${extra}>`;
}
function readCSVFile(file, cb) {
  const reader = new FileReader();
  reader.onload = (e) => cb(parseCSV(e.target.result));
  reader.readAsText(file, 'UTF-8');
}
// Normaliza "Tipo de camión" desde CSV a capacidad en KG, con saneamiento 2T -> 5T
function parseCapKgCleansed(val) {
  let n = Number(String(val).replace(/[^\d.]/g, ''));
  if (!n) return 0;
  if (n <= 28) n = n * 1000;
  if (n === 2000) n = 5000; // Saneamiento: camiones de 2 ton se reclasifican como 5 ton
  return n;
}

// ============================================================
// VISTA PRINCIPAL
// ============================================================
export function renderClientTariffView(container) {
  const db = getDatabase();
  const cfg = getTariffConfig(db);
  const ccfg = getClientTariffConfig(db);

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administrador de Tarifas Clientes</h1>
      <p class="font-body-lg text-body-lg text-secondary">Estructure las condiciones comerciales por Centro/Ruta/Tipo de Camión: tarifa mínima (ZFMI), precio por kg (ZFMP) y tarifa máxima (ZFMX = ZCAP).</p>
    </div>

    <div class="flex gap-sm mb-lg border-b border-outline-variant pb-sm overflow-x-auto" id="ct-subtabs">
      ${subTabButton('historico', 'history', 'Histórico (6M)')}
      ${subTabButton('consolidacion', 'map', 'Consolidación y Clusters')}
      ${subTabButton('especiales', 'star', 'Frecuencias y Especiales')}
      ${subTabButton('resultados', 'request_quote', 'Resultados ZFMI/ZFMP/ZFMX')}
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
      case 'historico': renderHistorico(content, db, cfg, ccfg); break;
      case 'consolidacion': renderConsolidacion(content, db, cfg, ccfg); break;
      case 'especiales': renderEspeciales(content, db, cfg, ccfg); break;
      case 'resultados': renderResultadosClientes(content, db, cfg, ccfg); break;
    }

    // Listener delegado: inputs/selects numéricos y de texto con data-path
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

function subTabButton(key, icon, label) {
  return `<button class="ct-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary cursor-pointer whitespace-nowrap" data-sub="${key}">
    <span class="material-symbols-outlined text-[16px]">${icon}</span> ${label}
  </button>`;
}

// ============================================================
// SUB-MÓDULO A: HISTÓRICO (6 MESES)
// ============================================================
function renderHistorico(content, db, cfg, ccfg) {
  const routes = db.routes;
  ccfg.historico = ccfg.historico || [];

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">history</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Ingesta de Histórico Operacional (6 Meses)</h2>
        </div>
        ${ccfg.historico.length > 0 ? `<button id="hist-clear" class="border border-red-200 hover:bg-red-50 text-red-700 px-md py-sm rounded text-xs font-bold uppercase">Vaciar Histórico</button>` : ''}
      </div>
      <p class="text-[12px] text-secondary mb-md">Saneamiento automático: registros de camiones de 2 toneladas se reclasifican como 5 toneladas. Las rutas interregionales marcadas se etiquetan automáticamente como SPOT en la consolidación.</p>

      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV — Histórico de Operación</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_SAP, Id_Ruta, Tipo_Camion_Kg, Toneladas, Clientes, Obras, Interregional (0/1)</p>
        </div>
        <input type="file" id="hist-csv" accept=".csv" class="text-[12px]">
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded max-h-[420px] overflow-y-auto">
        <table class="w-full zebra-table border-collapse">
          <thead class="sticky top-0">
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Toneladas</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Clientes</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Obras</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Interregional</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${ccfg.historico.length === 0 ? `<tr><td colspan="8" class="p-md text-center text-secondary">No hay registros históricos cargados.</td></tr>` :
              ccfg.historico.map(h => {
                const r = routes.find(x => x.id === h.rutaId);
                return `<tr class="border-b border-outline-variant">
                  <td class="p-md">${getCentreName(db, h.centroId)}</td>
                  <td class="p-md font-bold">${r ? `${r.codigo} — ${r.destino}` : '(ruta eliminada)'}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${(h.tipoCamionKg / 1000)}.000 kg</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${h.toneladas}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${h.clientes}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${h.obras}</td>
                  <td class="p-md text-center">${h.interregional ? '<span class="material-symbols-outlined text-[16px] text-primary">check</span>' : '—'}</td>
                  <td class="p-md text-center">
                    <button class="hist-del text-secondary hover:text-primary" data-id="${h.id}" title="Eliminar">
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

  document.getElementById('hist-csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (rows) => {
      let count = 0, omit = 0;
      rows.forEach(row => {
        const cd = db.logisticsCentres.find(c => c.id === (row.Centro_SAP || '').trim());
        const idRuta = (row.Id_Ruta || '').trim();
        const ruta = db.routes.find(r => r.codigo.toLowerCase() === idRuta.toLowerCase() || r.id === idRuta);
        const cap = parseCapKgCleansed(row.Tipo_Camion_Kg);
        if (!cd || !ruta || !CAP_LIST.includes(cap)) { omit++; return; }
        ccfg.historico.push({
          id: 'h' + Date.now() + Math.random().toString(16).slice(2),
          centroId: cd.id,
          rutaId: ruta.id,
          tipoCamionKg: cap,
          toneladas: Number(row.Toneladas) || 0,
          clientes: Number(row.Clientes) || 0,
          obras: Number(row.Obras) || 0,
          interregional: ['1', 'true', 'si', 'sí'].includes(String(row.Interregional || '').trim().toLowerCase())
        });
        count++;
      });
      saveDatabase(db);
      showAlert(`${count} registros cargados${omit ? `, ${omit} omitidos (centro/ruta no encontrada)` : ''}`);
      renderHistorico(content, db, cfg, ccfg);
    });
  });

  document.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', () => {
      ccfg.historico = ccfg.historico.filter(h => h.id !== btn.dataset.id);
      saveDatabase(db);
      renderHistorico(content, db, cfg, ccfg);
    });
  });

  const clearBtn = document.getElementById('hist-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (!confirm('¿Vaciar todo el histórico cargado? Esta acción no se puede deshacer.')) return;
    ccfg.historico = [];
    saveDatabase(db);
    renderHistorico(content, db, cfg, ccfg);
  });
}

// ============================================================
// SUB-MÓDULO B/C: CONSOLIDACIÓN, COMPLEJIDAD Y CLUSTERS
// ============================================================
function calcularConsolidacion(db, ccfg) {
  const result = {};
  db.routes.forEach(ruta => {
    const recsRuta = ccfg.historico.filter(h => h.rutaId === ruta.id);
    const recsCentro = ccfg.historico.filter(h => h.centroId === ruta.origenId);
    if (recsRuta.length === 0) return;

    // Factor de Consolidación: ocupación ponderada por toneladas, ruta vs. promedio de sucursal,
    // se toma el máximo entre ambos y se acota a 100%.
    const occ = (recs) => {
      const totalTon = recs.reduce((s, r) => s + (Number(r.toneladas) || 0), 0);
      if (totalTon === 0) return 0;
      const weighted = recs.reduce((s, r) => s + ((Number(r.toneladas) || 0) / (CAPACITY_TONS[r.tipoCamionKg] || 1)) * (Number(r.toneladas) || 0), 0);
      return weighted / totalTon;
    };
    const occRuta = occ(recsRuta);
    const occCentro = occ(recsCentro);
    const factorConsolidacion = Math.min(1, Math.max(occRuta, occCentro));

    // Indicador de Complejidad Logística: promedio normalizado de participación de la ruta
    // en toneladas, clientes y obras respecto del total del centro.
    const sum = (recs, field) => recs.reduce((s, r) => s + (Number(r[field]) || 0), 0);
    const ratio = (a, b) => b > 0 ? a / b : 0;
    const ratioTon = ratio(sum(recsRuta, 'toneladas'), sum(recsCentro, 'toneladas'));
    const ratioCli = ratio(sum(recsRuta, 'clientes'), sum(recsCentro, 'clientes'));
    const ratioObr = ratio(sum(recsRuta, 'obras'), sum(recsCentro, 'obras'));
    const indicador = ((ratioTon + ratioCli + ratioObr) / 3) * 100;

    const interregional = recsRuta.some(r => r.interregional);

    // Clustering: rutas interregionales o con indicador < 3% -> SPOT
    let cluster;
    if (interregional || indicador < 3) cluster = 'spot';
    else if (indicador > 15) cluster = '1';
    else if (indicador >= 5) cluster = '2';
    else cluster = '3';

    result[ruta.id] = { factorConsolidacion, indicador, cluster, interregional };
  });
  return result;
}

function renderConsolidacion(content, db, cfg, ccfg) {
  ccfg.consolidacion = ccfg.consolidacion || {};
  const routes = db.routes;

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">map</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Consolidación, Complejidad y Clusters</h2>
        </div>
        <button id="ct-recalc" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
          <span class="material-symbols-outlined text-[18px]">refresh</span> Recalcular desde Histórico
        </button>
      </div>
      <p class="text-[12px] text-secondary mb-md">Reglas de Cluster: Cluster 1 (indicador &gt;15%) → NV ${ccfg.clusterNV['1']}, Cluster 2 (5%–15%) → NV ${ccfg.clusterNV['2']}, Cluster 3 (&lt;5%) → NV ${ccfg.clusterNV['3']}, SPOT (&lt;3% o interregional) → NV ${ccfg.clusterNV.spot}. Puede ajustar manualmente el cluster asignado a cada ruta.</p>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div class="bg-surface border border-outline-variant overflow-hidden rounded">
          <table class="w-full zebra-table border-collapse">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Consolidación</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Indicador</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Cluster</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${routes.map(r => {
                const c = ccfg.consolidacion[r.id];
                if (!c) return `<tr class="border-b border-outline-variant">
                  <td class="p-md font-bold">${r.codigo} — ${r.destino}</td>
                  <td class="p-md text-right text-secondary" colspan="3">Sin datos históricos</td>
                </tr>`;
                return `<tr class="border-b border-outline-variant">
                  <td class="p-md font-bold">${r.codigo} — ${r.destino}${c.interregional ? ' <span class=\"text-[10px] text-secondary\">(Interregional)</span>' : ''}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${(c.factorConsolidacion * 100).toFixed(1)}%</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${c.indicador.toFixed(1)}%</td>
                  <td class="p-md">
                    <select class="${inputCls} text-left" data-path="consolidacion.${r.id}.cluster" data-refresh="true">
                      ${CLUSTER_KEYS.map(k => `<option value="${k}" ${c.cluster === k ? 'selected' : ''}>${CLUSTER_LABELS[k]}</option>`).join('')}
                    </select>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div id="ct-map" class="h-[420px] rounded-xl border border-outline-variant shadow-md overflow-hidden relative" style="z-index:1;"></div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Colores del Mapa de Calor por Cluster</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-md">
        ${CLUSTER_KEYS.map(k => `
          <div class="flex items-center gap-sm bg-surface border border-outline-variant rounded p-sm">
            <input type="color" class="w-10 h-10 rounded cursor-pointer border border-outline-variant" data-path="clusterColors.${k}" data-refresh="true" value="${ccfg.clusterColors[k]}">
            <span class="text-[12px] font-bold text-on-surface">${CLUSTER_LABELS[k]}</span>
          </div>`).join('')}
      </div>
    </div>
  `;

  // Mapa de calor por cluster
  try {
    const map = L.map('ct-map').setView([-37, -72], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    const bounds = [];
    routes.forEach(r => {
      const c = ccfg.consolidacion[r.id];
      if (c && c.lat && c.lon) {
        const color = ccfg.clusterColors[c.cluster] || '#6b7280';
        const marker = L.circleMarker([c.lat, c.lon], {
          radius: 10, color, fillColor: color, fillOpacity: 0.7, weight: 2
        }).addTo(map);
        marker.bindPopup(`<strong>${r.codigo} — ${r.destino}</strong><br>Cluster: ${CLUSTER_LABELS[c.cluster]}<br>Indicador: ${c.indicador.toFixed(1)}%`);
        bounds.push([c.lat, c.lon]);
      }
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40] });
  } catch (err) {
    console.error('Error al cargar mapa de calor:', err);
    const el = document.getElementById('ct-map');
    if (el) el.innerHTML = `<div class="flex justify-center items-center h-full text-secondary font-body-md bg-surface-container-low border border-outline-variant">Error al cargar el mapa interactivo.</div>`;
  }

  document.getElementById('ct-recalc').addEventListener('click', async () => {
    if (!ccfg.historico || ccfg.historico.length === 0) {
      showAlert('No hay histórico cargado para calcular la consolidación.', 'error');
      return;
    }
    const btn = document.getElementById('ct-recalc');
    btn.disabled = true;
    btn.textContent = 'Calculando...';

    const nuevos = calcularConsolidacion(db, ccfg);
    // Conservar overrides manuales de cluster ya existentes
    for (const rutaId of Object.keys(nuevos)) {
      const prev = ccfg.consolidacion[rutaId];
      if (prev && prev.lat && prev.lon) { nuevos[rutaId].lat = prev.lat; nuevos[rutaId].lon = prev.lon; }
    }
    ccfg.consolidacion = nuevos;

    // Geolocalizar destinos sin coordenadas para el mapa de calor
    for (const r of routes) {
      const c = ccfg.consolidacion[r.id];
      if (c && (!c.lat || !c.lon)) {
        const coords = await geocodeAddress(`${r.destino}, ${r.region}`);
        c.lat = coords.lat;
        c.lon = coords.lon;
      }
    }

    saveDatabase(db);
    showAlert('Consolidación y clusters recalculados');
    renderConsolidacion(content, db, cfg, ccfg);
  });
}

// ============================================================
// SUB-MÓDULO D + ESPECIALES: FRECUENCIAS Y TARIFAS ESPECIALES
// ============================================================
function renderEspeciales(content, db, cfg, ccfg) {
  const centres = db.logisticsCentres;
  ccfg.especiales = ccfg.especiales || { tipo0000: { tarifaPlana: 0 }, recargoExclusividad: {} };
  ccfg.especiales.recargoExclusividad = ccfg.especiales.recargoExclusividad || {};

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">event_repeat</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Frecuencias Operacionales por Cluster</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Editable por roles autorizados. Define el nivel de servicio (NV) y la frecuencia de despacho asociada a cada cluster.</p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Cluster</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Nivel de Servicio (NV)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Frecuencia Operativa</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${CLUSTER_KEYS.map(k => `
              <tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${CLUSTER_LABELS[k]}</td>
                <td class="p-md w-32">${numInput(`clusterNV.${k}`, ccfg.clusterNV[k])}</td>
                <td class="p-md">${textInput(`clusterFrecuencia.${k}`, ccfg.clusterFrecuencia[k])}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-lg">
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Tarifa Especial Tipo "0000"</h3>
        <p class="text-[12px] text-secondary mb-md">Tarifa plana exclusiva para rutas Cluster 1. Se aplica como ZFMI = ZFMP = ZFMX en la exportación cuando corresponde.</p>
        <div class="space-y-xs max-w-xs">
          <label class="font-label-caps text-label-caps text-secondary block">TARIFA PLANA (CLP)</label>
          ${numInput('especiales.tipo0000.tarifaPlana', ccfg.especiales.tipo0000.tarifaPlana)}
        </div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Tarifa Especial Tipo "9999"</h3>
        <p class="text-[12px] text-secondary mb-md">Valores fijos: ZFMX = $10.000.000 · ZFMI = ZCAP del camión de 28 ton · ZFMP = costo/kg del camión de 28 ton. Se calculan automáticamente desde el Motor ZCAP.</p>
        <div class="flex flex-col gap-xs text-[12px] text-secondary">
          <span>ZFMX fijo: <b class="text-on-surface">${formatCLP(10000000)}</b></span>
          <span>ZFMI y ZFMP: se calculan al generar resultados.</span>
        </div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mt-lg">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Recargo por Exclusividad (por Centro Logístico)</h3>
      <p class="text-[12px] text-secondary mb-md">Si está activo, se aplica el porcentaje indicado sobre ZFMP y ZFMI para las filas exportadas con "Transporte Exclusivo = 1".</p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Activo</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Recargo (%)</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${centres.map(cd => {
              const r = ccfg.especiales.recargoExclusividad[cd.id] || { activo: false, pct: 0 };
              return `<tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${cd.nombre}</td>
                <td class="p-md text-center"><input type="checkbox" class="w-4 h-4 accent-primary" data-path="especiales.recargoExclusividad.${cd.id}.activo" data-refresh="true" ${r.activo ? 'checked' : ''}></td>
                <td class="p-md w-32">${numInput(`especiales.recargoExclusividad.${cd.id}.pct`, r.pct)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================
// RESULTADOS: PIPELINE ZFMI / ZFMP / ZFMX Y EXPORTACIÓN ERP
// ============================================================
function calcularMatrizClientes(db, cfg, ccfg) {
  const rutas = db.routes.filter(r => r.activo);
  const tipos = truckTypesWithCap(db);
  const out = [];

  rutas.forEach(ruta => {
    const cons = ccfg.consolidacion[ruta.id] || { factorConsolidacion: 1, indicador: 0, cluster: 'spot' };
    const factor = cons.factorConsolidacion ?? 1;
    const cd = db.logisticsCentres.find(c => c.id === ruta.origenId);
    const recargo = (ccfg.especiales.recargoExclusividad || {})[ruta.origenId] || { activo: false, pct: 0 };

    // Resultado para camión de 5 ton (base de ZFMI)
    const m5 = calcularCostoRuta(db, cfg, ruta, 5000);
    // Resultado para camión de 28 ton (base de tarifa especial 9999)
    const m28 = calcularCostoRuta(db, cfg, ruta, 28000);

    tipos.forEach(t => {
      const m = calcularCostoRuta(db, cfg, ruta, t.capKg);
      const mNext = calcularCostoRuta(db, cfg, ruta, NEXT_CAP[t.capKg]);

      // ZFMX = ZCAP (con margen de ganancia) del motor de costos de transporte
      const zfmx = Math.round(m.zcapConMargen);
      // ZFMI = ZCAP (con margen) del camión de 5 ton, ajustado por el Factor de Consolidación de la ruta
      const zfmi = Math.round(m5.zcapConMargen * factor);
      // ZFMP = costo/kg del tramo de camión SIGUIENTE (auto-selección de tramo superior), ajustado por consolidación
      const zfmp = NEXT_CAP[t.capKg] > 0 ? Math.round((mNext.zcapConMargen / NEXT_CAP[t.capKg]) * factor) : 0;

      out.push({
        ruta, truckType: t, centro: cd, cluster: cons.cluster, indicador: cons.indicador,
        factorConsolidacion: factor, zfmi, zfmp, zfmx, recargo,
        tipoEspecial: null
      });
    });

    // --- Tarifa especial "0000": exclusiva para rutas Cluster 1, tarifa plana ---
    if (cons.cluster === '1') {
      const plana = Math.round(Number(ccfg.especiales.tipo0000.tarifaPlana) || 0);
      out.push({
        ruta, truckType: { type: 'Tarifa Especial 0000', capKg: 0 }, centro: cd, cluster: cons.cluster, indicador: cons.indicador,
        factorConsolidacion: factor, zfmi: plana, zfmp: plana, zfmx: plana, recargo,
        tipoEspecial: '0000'
      });
    }

    // --- Tarifa especial "9999": ZFMX fijo, ZFMI/ZFMP basados en camión de 28 ton ---
    out.push({
      ruta, truckType: { type: 'Tarifa Especial 9999', capKg: 28000 }, centro: cd, cluster: cons.cluster, indicador: cons.indicador,
      factorConsolidacion: factor,
      zfmi: Math.round(m28.zcapConMargen),
      zfmp: Math.round(m28.zcapConMargen / 28000),
      zfmx: 10000000,
      recargo,
      tipoEspecial: '9999'
    });
  });

  return out;
}

function renderResultadosClientes(content, db, cfg, ccfg) {
  ccfg.especiales = ccfg.especiales || { tipo0000: { tarifaPlana: 0 }, recargoExclusividad: {} };
  const matriz = calcularMatrizClientes(db, cfg, ccfg);

  content.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">request_quote</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Resultados — ZFMI / ZFMP / ZFMX</h2>
        </div>
        <div class="flex gap-sm flex-wrap">
          <button id="exp-zfmi" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar ZFMI (ERP)
          </button>
          <button id="exp-zfmx" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar ZFMX (ERP)
          </button>
          <button id="exp-zfmp" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar ZFMP (ERP)
          </button>
        </div>
      </div>
      <p class="text-[12px] text-secondary mb-md">ZFMI = tarifa mínima (referencia camión 5 ton, ajustada por consolidación) · ZFMP = precio por kg (tramo superior) · ZFMX = tarifa máxima (ZCAP con margen). Todos los valores se exportan como enteros, sin decimales. "Válido de" = fecha de descarga · "Validez a" = ${VALIDEZ_A}.</p>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Cluster</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">ZFMI</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">ZFMP ($/kg)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right bg-primary/5">ZFMX</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${matriz.map(m => `
              <tr class="border-b border-outline-variant">
                <td class="p-md">${m.centro ? m.centro.nombre : '—'}</td>
                <td class="p-md font-bold">${m.ruta.codigo} — ${m.ruta.destino}</td>
                <td class="p-md">${m.truckType.type}</td>
                <td class="p-md text-center">
                  <span class="inline-flex items-center px-2 py-1 rounded font-label-caps text-[10px] text-white" style="background-color:${(ccfg.clusterColors || {})[m.cluster] || '#6b7280'}">${m.cluster.toUpperCase()}</span>
                </td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(m.zfmi)}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${formatCLP(m.zfmp)}</td>
                <td class="p-md text-right font-data-mono text-data-mono font-bold bg-primary/5">${formatCLP(m.zfmx)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const validoDe = formatDateDDMMYYYY(new Date());

  // Genera, para cada fila de la matriz, una versión normal (Exclusivo=0) y otra
  // con recargo de exclusividad (Exclusivo=1) cuando corresponda al centro logístico.
  function expandExclusividad(m, valorBase) {
    const pct = m.recargo.activo ? (Number(m.recargo.pct) || 0) : 0;
    const valorRecargo = Math.round(valorBase * (1 + pct / 100));
    return [
      { exclusivo: 0, valor: valorBase },
      { exclusivo: 1, valor: valorRecargo }
    ];
  }

  function rutaIdExport(m) {
    return m.tipoEspecial ? m.tipoEspecial : m.ruta.codigo;
  }
  function capKgExport(m) {
    return m.tipoEspecial === '0000' ? 0 : m.truckType.capKg;
  }

  document.getElementById('exp-zfmi').addEventListener('click', () => {
    const headers = ['Codigo_Centro', 'Ruta_ID', 'Destino_Comuna', 'Tipo_Camion_Kg', 'Tipo_Tarifa', 'Valor', 'Transporte_Exclusivo', 'Valido_de', 'Validez_a'];
    const rows = [];
    matriz.forEach(m => {
      expandExclusividad(m, m.zfmi).forEach(e => {
        rows.push([m.centro ? m.centro.id : '', rutaIdExport(m), m.ruta.destino, capKgExport(m), 'ZFMI', e.valor, e.exclusivo, validoDe, VALIDEZ_A]);
      });
    });
    downloadFile(`zfmi_clientes_${Date.now()}.csv`, toCSV(headers, rows));
    showAlert('Archivo CSV de ZFMI exportado para ERP');
  });

  document.getElementById('exp-zfmx').addEventListener('click', () => {
    const headers = ['Codigo_Centro', 'Ruta_ID', 'Destino_Comuna', 'Tipo_Camion_Kg', 'Tipo_Tarifa', 'Valor', 'Transporte_Exclusivo', 'Valido_de', 'Validez_a'];
    const rows = [];
    matriz.forEach(m => {
      expandExclusividad(m, m.zfmx).forEach(e => {
        rows.push([m.centro ? m.centro.id : '', rutaIdExport(m), m.ruta.destino, capKgExport(m), 'ZFMX', e.valor, e.exclusivo, validoDe, VALIDEZ_A]);
      });
    });
    downloadFile(`zfmx_clientes_${Date.now()}.csv`, toCSV(headers, rows));
    showAlert('Archivo CSV de ZFMX exportado para ERP');
  });

  document.getElementById('exp-zfmp').addEventListener('click', () => {
    const headers = ['Codigo_Centro', 'Ruta_ID', 'Destino_Comuna', 'Tipo_Camion_Kg', 'UM', 'Valor_KG', 'Transporte_Exclusivo', 'Valido_de', 'Validez_a'];
    const rows = [];
    matriz.forEach(m => {
      expandExclusividad(m, m.zfmp).forEach(e => {
        rows.push([m.centro ? m.centro.id : '', rutaIdExport(m), m.ruta.destino, capKgExport(m), 'KG', e.valor, e.exclusivo, validoDe, VALIDEZ_A]);
      });
    });
    downloadFile(`zfmp_clientes_${Date.now()}.csv`, toCSV(headers, rows));
    showAlert('Archivo CSV de ZFMP exportado para ERP');
  });
}
