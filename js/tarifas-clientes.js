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
      ${subTabButton('densidad',      'location_on',   'Densidad Logística')}
      ${subTabButton('cluster',       'map',           'Cluster')}
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
      case 'densidad':      renderDensidad(content, db, ccfg);       break;
      case 'cluster':       renderCluster(content, db, ccfg);        break;
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
  const out = [];

  rutas.forEach(ruta => {
    // Solo los tipos de camión del centro de origen de esta ruta (evita filas duplicadas
    // cuando hay más de un centro logístico con tarifas de transporte configuradas).
    const tipos = truckTypesWithCap(db, ruta.origenId);
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
