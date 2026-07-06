import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig, truckCapKg } from './data.js?v=20260703b';
import { calcularCostoRuta } from './tarifas-engine.js?v=20260703b';
import { formatCLP, showAlert, geocodeAddress } from './utils.js';
import { GRUPOS_ORIGEN } from './chile-geo.js';
import { resolveOrigenIdFromGrupo } from './routes.js';

// Orden estándar de tipos de camión: 5, 10, 15 y 28 toneladas.
const TRUCK_TYPE_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];

// Tramo de camión siguiente, usado para ZFMP (precio por kg de referencia) en
// el panel "Referencia Tarifa Cliente" del cotizador.
const NEXT_CAP_REF = { 5000: 10000, 10000: 15000, 15000: 28000, 28000: 28000 };

// --- Caché de cotizaciones recientes por perfil (localStorage) ---
// Guarda las últimas 10 cotizaciones del usuario para evitar repetir
// consultas de geolocalización (Nominatim/Google) para la misma ruta.
const RECENT_QUOTES_MAX = 10;

function getSessionEmail() {
  try {
    const session = JSON.parse(localStorage.getItem('ebema_user_session') || '{}');
    return session.email || 'anon';
  } catch (e) {
    return 'anon';
  }
}

function recentQuotesKey() {
  return `ebema_recent_quotes_${getSessionEmail()}`;
}

function loadRecentQuotes() {
  try {
    const raw = localStorage.getItem(recentQuotesKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveRecentQuotes(list) {
  localStorage.setItem(recentQuotesKey(), JSON.stringify(list.slice(0, RECENT_QUOTES_MAX)));
}

// Busca en el caché del perfil una cotización previa para el mismo origen/destino
function findCachedQuote(origenId, destino) {
  if (!origenId || !destino) return null;
  const destinoNorm = destino.trim().toLowerCase();
  return loadRecentQuotes().find(q => q.origenId === origenId && (q.destino || '').trim().toLowerCase() === destinoNorm) || null;
}

// Inserta/actualiza una entrada en el caché del perfil (más reciente primero, máx. 10)
function upsertRecentQuote(entry) {
  const list = loadRecentQuotes();
  const destinoNorm = (entry.destino || '').trim().toLowerCase();
  const idx = list.findIndex(q => q.origenId === entry.origenId && (q.destino || '').trim().toLowerCase() === destinoNorm);
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(entry);
  saveRecentQuotes(list);
  return list;
}

// Cotizador de Tarifas — SIT EBEMA (Sistema Integrado de Transporte)
// Servicio EXCLUSIVO: tarifa según tipo de camión (5/10/15/28 Ton).
// Servicio CONSOLIDADO: tarifa prorrateada según kilos transportados.
export function renderRatesView(container) {
  const db = getDatabase();
  const cds = db.logisticsCentres;
  const routes = db.routes.filter(r => r.activo);
  const truckTypes = db.truckTypes;
  // Catálogo de tipos de camión (distintos), para poblar el selector — las tarifas
  // efectivas (baseRate/ratePerKm) se buscan luego por centro de origen + tipo.
  const truckTypeCatalog = [];
  truckTypes.forEach(t => {
    if (!truckTypeCatalog.some(x => x.type === t.type)) {
      truckTypeCatalog.push({ type: t.type, capacityTons: t.capacityTons });
    }
  });
  // Orden fijo: 5, 10, 15 y 28 Ton
  truckTypeCatalog.sort((a, b) => {
    const ia = TRUCK_TYPE_ORDER.indexOf(a.type);
    const ib = TRUCK_TYPE_ORDER.indexOf(b.type);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Orígenes agrupados: varios centros logísticos pueden compartir el mismo
  // Origen (zona de despacho) y, por lo tanto, las mismas rutas.
  const origenGrupos = GRUPOS_ORIGEN.filter(g => cds.some(cd => cd.origen_grupo === g));

  const currentQuoteId = `${Math.floor(1000 + Math.random() * 9000)}-QT`;

  container.innerHTML = `
    <!-- Page Header -->
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Cotizador de Tarifas</h1>
      <p class="font-body-lg text-body-lg text-secondary">Configure origen, destino y tipo de servicio para obtener la estimación de costo del flete.</p>
    </div>

    <!-- Dashboard Grid -->
    <div class="grid grid-cols-12 gap-lg">
      <!-- Left Column: Formulario de Consulta -->
      <section class="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center gap-sm mb-lg border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">analytics</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Formulario de Consulta</h2>
        </div>

        <form class="space-y-lg" id="quota-form">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-lg">
            <!-- Origen -->
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">ORIGEN (CENTRO LOGÍSTICO)</label>
              <select id="q-origen" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white" required>
                <option value="">Seleccione origen...</option>
              </select>
            </div>
            <!-- Destino -->
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DESTINO (COMUNA O SECTOR)</label>
              <input type="text" id="q-destino" list="q-destinos-list" placeholder="Primero seleccione origen..." disabled
                class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white" />
              <datalist id="q-destinos-list"></datalist>
            </div>
          </div>

          <!-- Datos de la ruta -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-lg bg-surface-container-low p-md rounded">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">CÓDIGO DE RUTA</label>
              <div class="flex items-center gap-sm bg-surface p-sm border border-outline-variant rounded">
                <span class="material-symbols-outlined text-secondary text-[18px]">route</span>
                <span class="font-data-mono text-data-mono font-bold text-on-surface" id="q-ruta-codigo">—</span>
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DISTANCIA</label>
              <div class="flex items-center gap-sm bg-surface p-sm border border-outline-variant rounded">
                <span class="material-symbols-outlined text-secondary text-[18px]">straighten</span>
                <span class="font-data-mono text-data-mono font-bold text-on-surface" id="q-distancia-text">0 KM</span>
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">ESTADO DE LA RUTA</label>
              <div class="flex items-center gap-sm bg-surface p-sm border border-outline-variant rounded">
                <span class="w-3 h-3 rounded-full bg-secondary" id="q-ruta-indicator"></span>
                <span class="font-body-md text-[12px] font-bold text-on-surface" id="q-ruta-estado">Sin consultar</span>
              </div>
            </div>
          </div>

          <!-- Tipo de Servicio -->
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO DE SERVICIO</label>
            <div class="grid grid-cols-2 gap-md">
              <label id="lbl-exclusivo" class="flex items-center gap-sm border-2 border-primary bg-primary/5 p-md rounded-lg cursor-pointer transition-all">
                <input type="radio" name="q-servicio" value="exclusivo" checked class="accent-[#b5000b]">
                <div>
                  <p class="font-body-md text-body-md font-bold text-on-surface">Exclusivo</p>
                  <p class="text-[11px] text-secondary">Camión dedicado a su carga</p>
                </div>
              </label>
              <label id="lbl-consolidado" class="flex items-center gap-sm border-2 border-outline-variant p-md rounded-lg cursor-pointer transition-all">
                <input type="radio" name="q-servicio" value="consolidado" class="accent-[#b5000b]">
                <div>
                  <p class="font-body-md text-body-md font-bold text-on-surface">Consolidado</p>
                  <p class="text-[11px] text-secondary">Comparte camión, paga por kilos</p>
                </div>
              </label>
            </div>
          </div>

          <!-- Exclusivo: Tipo de Camión -->
          <div class="space-y-xs" id="q-exclusivo-block">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO DE CAMIÓN</label>
            <select id="q-vehiculo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white">
              <option value="">Seleccione camión...</option>
            </select>
          </div>

          <!-- Consolidado: Kilos -->
          <div class="space-y-xs hidden" id="q-consolidado-block">
            <label class="font-label-caps text-label-caps text-secondary block">KILOS TRANSPORTADOS</label>
            <div class="relative">
              <input type="number" id="q-kilos" min="1" max="28000" placeholder="Ej: 3500"
                class="w-full border border-[#CED4DA] p-sm pr-12 font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white" />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-secondary text-xs font-bold">KG</span>
            </div>
            <p class="text-[11px] text-secondary">Máximo 28.000 kg por envío consolidado.</p>
          </div>
        </form>
      </section>

      <!-- Right Column: Resumen de Cotización -->
      <section class="col-span-12 lg:col-span-5 flex flex-col gap-lg">
        <div class="bg-surface-container-low border border-outline-variant p-lg shadow-md relative overflow-hidden flex-1 flex flex-col justify-between">
          <div class="relative z-10 flex-1 flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-start mb-xl">
                <div>
                  <p class="font-label-caps text-label-caps text-secondary mb-1">PROYECCIÓN DE COSTO</p>
                  <h2 class="font-headline-md text-headline-md font-bold text-on-surface">Resumen de Cotización</h2>
                </div>
                <span class="bg-surface-container-highest px-sm py-xs font-label-caps text-[10px] border border-outline-variant" id="q-summary-id">ID: ${currentQuoteId}</span>
              </div>

              <ul class="space-y-md mb-xl">
                <li class="flex justify-between items-center border-b border-outline-variant pb-sm">
                  <span class="font-body-md text-body-md text-secondary">Origen</span>
                  <span class="font-body-md text-body-md font-bold text-on-surface" id="q-summary-origen">Seleccione origen</span>
                </li>
                <li class="flex justify-between items-center border-b border-outline-variant pb-sm">
                  <span class="font-body-md text-body-md text-secondary">Destino</span>
                  <span class="font-body-md text-body-md font-bold text-on-surface" id="q-summary-destino">Seleccione destino</span>
                </li>
                <li class="flex justify-between items-center border-b border-outline-variant pb-sm">
                  <span class="font-body-md text-body-md text-secondary">Distancia</span>
                  <span class="font-data-mono text-data-mono font-bold text-on-surface" id="q-summary-distancia">0.0 KM</span>
                </li>
                <li class="flex justify-between items-center border-b border-outline-variant pb-sm">
                  <span class="font-body-md text-body-md text-secondary">Ruta</span>
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-secondary" id="q-summary-ruta">—</span>
                </li>
                <li class="flex justify-between items-center">
                  <span class="font-body-md text-body-md text-secondary">Vehículo</span>
                  <span class="font-body-md text-body-md font-bold text-on-surface text-right" id="q-summary-vehiculo">Seleccione servicio</span>
                </li>
              </ul>
            </div>

            <div>
              <div class="bg-surface-container-lowest p-md border border-outline-variant mb-md rounded text-secondary hidden" id="q-ref-zfm">
                <p class="font-label-caps text-label-caps text-secondary mb-xs text-center">Referencia Tarifa Cliente (Motor de Costo)</p>
                <div class="grid grid-cols-3 gap-sm text-center">
                  <div>
                    <span class="block font-data-mono text-data-mono font-bold text-on-surface" id="q-ref-zfmi">—</span>
                    <span class="text-[10px]">ZFMI (mín.)</span>
                  </div>
                  <div>
                    <span class="block font-data-mono text-data-mono font-bold text-on-surface" id="q-ref-zfmp">—</span>
                    <span class="text-[10px]">ZFMP ($/kg)</span>
                  </div>
                  <div>
                    <span class="block font-data-mono text-data-mono font-bold text-on-surface" id="q-ref-zfmx">—</span>
                    <span class="text-[10px]">ZFMX (máx.)</span>
                  </div>
                </div>
              </div>

              <div class="bg-surface-container-lowest p-lg border-2 border-primary/10 mb-xl rounded">
                <p class="font-label-caps text-label-caps text-secondary text-center mb-base">VALOR NETO</p>
                <p class="font-headline-lg text-headline-lg text-primary text-center font-extrabold tracking-tighter" id="q-summary-precio">$0 CLP</p>
                <p class="font-label-caps text-[10px] text-center text-secondary mt-base">IVA no incluido</p>
              </div>

            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Ruta Despacho: Mapa Origen / Destino -->
    <div class="mt-xl">
      <div class="flex justify-between items-end mb-md">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Ruta Despacho</h3>
        <p class="font-body-md text-[12px] text-secondary">Origen y destino de la cotización actual</p>
      </div>
      <div class="bg-surface border border-outline-variant rounded overflow-hidden">
        <div id="quote-fleet-map" class="h-[350px] relative" style="z-index: 1;">
          <div class="flex justify-center items-center h-full text-secondary font-body-md bg-surface-container-low">
            Cargando mapa...
          </div>
        </div>
      </div>
    </div>

    <!-- Historial -->
    <div class="mt-xl">
      <div class="flex justify-between items-end mb-md">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Historial Reciente de Cotizaciones</h3>
      </div>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Fecha</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Origen - Destino</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Vehículo</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Estado</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Monto Neto</th>
            </tr>
          </thead>
          <tbody id="quotes-history-tbody" class="font-body-md text-body-md"></tbody>
        </table>
      </div>
    </div>
  `;

  // --- REFERENCIAS ---
  const selOrigen = document.getElementById('q-origen');
  const inpDestino = document.getElementById('q-destino');
  const datalist = document.getElementById('q-destinos-list');
  const selVehiculo = document.getElementById('q-vehiculo');
  const inpKilos = document.getElementById('q-kilos');

  const rutaCodigo = document.getElementById('q-ruta-codigo');
  const rutaEstado = document.getElementById('q-ruta-estado');
  const rutaInd = document.getElementById('q-ruta-indicator');
  const txtDistancia = document.getElementById('q-distancia-text');

  const sumOrigen = document.getElementById('q-summary-origen');
  const sumDestino = document.getElementById('q-summary-destino');
  const sumDistancia = document.getElementById('q-summary-distancia');
  const sumRuta = document.getElementById('q-summary-ruta');
  const sumVehiculo = document.getElementById('q-summary-vehiculo');
  const sumPrecio = document.getElementById('q-summary-precio');

  const refZfm = document.getElementById('q-ref-zfm');
  const refZfmi = document.getElementById('q-ref-zfmi');
  const refZfmp = document.getElementById('q-ref-zfmp');
  const refZfmx = document.getElementById('q-ref-zfmx');

  const blockExclusivo = document.getElementById('q-exclusivo-block');
  const blockConsolidado = document.getElementById('q-consolidado-block');
  const lblExclusivo = document.getElementById('lbl-exclusivo');
  const lblConsolidado = document.getElementById('lbl-consolidado');

  let activeRoute = null;     // ruta encontrada (o null)
  let routePending = false;   // destino consultado sin ruta creada
  let servicio = 'exclusivo';
  let lastDestCoords = null;  // últimas coordenadas de destino (propias o cacheadas)

  // --- CARGA INICIAL ---
  selOrigen.innerHTML = '<option value="">Seleccione origen...</option>';
  origenGrupos.forEach(grupo => {
    const opt = document.createElement('option');
    opt.value = grupo;
    opt.textContent = grupo;
    selOrigen.appendChild(opt);
  });

  selVehiculo.innerHTML = '<option value="">Seleccione camión...</option>';
  truckTypeCatalog.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${t.type} (${t.capacityTons})`;
    selVehiculo.appendChild(opt);
  });

  renderHistoryTable(loadRecentQuotes());

  // --- MAPA: VISUALIZAR FLOTA (ORIGEN / DESTINO) ---
  let fleetMap, fleetMarkers = [], fleetLine = null;
  let geocodeTimeout = null;
  try {
    fleetMap = L.map('quote-fleet-map').setView([-34.5, -71.5], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(fleetMap);
  } catch (err) {
    console.error("Error al cargar Leaflet:", err);
    document.getElementById('quote-fleet-map').innerHTML = `
      <div class="flex justify-center items-center h-full text-secondary font-body-md bg-surface-container-low border border-outline-variant">
        Error al cargar los servicios de mapa interactivo.
      </div>
    `;
  }

  function clearFleetMap() {
    if (!fleetMap) return;
    fleetMarkers.forEach(m => fleetMap.removeLayer(m));
    fleetMarkers = [];
    if (fleetLine) {
      fleetMap.removeLayer(fleetLine);
      fleetLine = null;
    }
  }

  // Obtiene la geometría real de la ruta por carretera (OSRM), como lista de [lat, lon]
  async function fetchRoadGeometry(origin, dest) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data.routes || !data.routes[0] || !data.routes[0].geometry) return null;
      return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    } catch (e) {
      return null;
    }
  }

  async function updateFleetMap() {
    if (!fleetMap) return;
    clearFleetMap();
    const origenGrupo = selOrigen.value;
    const cdOrigenId = resolveOrigenIdFromGrupo(db, origenGrupo);
    const cd = cds.find(c => c.id === cdOrigenId);
    const points = [];
    let origenCoords = null;
    let destCoords = null;

    if (cd && cd.lat && cd.lon) {
      const marker = L.marker([cd.lat, cd.lon]).addTo(fleetMap)
        .bindPopup(`<strong>Origen:</strong> ${cd.nombre}`);
      fleetMarkers.push(marker);
      origenCoords = { lat: cd.lat, lon: cd.lon };
      points.push([cd.lat, cd.lon]);
    }

    const destinoVal = inpDestino.value.trim();
    if (destinoVal) {
      // Reutilizar coordenadas cacheadas del perfil para no repetir la consulta a Nominatim/Google
      const cached = findCachedQuote(origenGrupo, destinoVal);
      let dest;
      if (cached && cached.lat && cached.lon) {
        dest = { lat: cached.lat, lon: cached.lon };
      } else {
        dest = await geocodeAddress(destinoVal);
      }
      lastDestCoords = dest;
      destCoords = dest;
      const marker = L.marker([dest.lat, dest.lon]).addTo(fleetMap)
        .bindPopup(`<strong>Destino:</strong> ${destinoVal}`);
      fleetMarkers.push(marker);
      points.push([dest.lat, dest.lon]);
    } else {
      lastDestCoords = null;
    }

    if (points.length === 2) {
      // Trazar la ruta real por carretera (OSRM); si no está disponible, usar línea recta como respaldo.
      const roadGeometry = await fetchRoadGeometry(origenCoords, destCoords);
      if (roadGeometry && roadGeometry.length > 1) {
        fleetLine = L.polyline(roadGeometry, { color: '#b5000b', weight: 4 }).addTo(fleetMap);
        fleetMap.fitBounds(roadGeometry, { padding: [40, 40] });
      } else {
        fleetLine = L.polyline(points, { color: '#b5000b', weight: 3, dashArray: '6 6' }).addTo(fleetMap);
        fleetMap.fitBounds(points, { padding: [40, 40] });
      }
    } else if (points.length === 1) {
      fleetMap.setView(points[0], 10);
    } else {
      fleetMap.setView([-34.5, -71.5], 6);
    }
  }

  // --- EVENTOS ---

  selOrigen.addEventListener('change', () => {
    const origenGrupo = selOrigen.value;
    datalist.innerHTML = '';
    inpDestino.value = '';
    resetRouteInfo();

    if (origenGrupo) {
      // Destinos unificados: todas las rutas de los centros que comparten este Origen
      const destinos = routes.filter(r => r.origen_grupo === origenGrupo).map(r => r.destino);
      [...new Set(destinos)].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        datalist.appendChild(opt);
      });
      inpDestino.disabled = false;
      inpDestino.placeholder = 'Escriba la comuna o sector...';
      sumOrigen.textContent = origenGrupo;
    } else {
      inpDestino.disabled = true;
      inpDestino.placeholder = 'Primero seleccione origen...';
      sumOrigen.textContent = 'Seleccione origen';
    }
    calculatePrice();
    updateFleetMap();
  });

  inpDestino.addEventListener('input', () => {
    consultarRuta();
    calculatePrice();
    clearTimeout(geocodeTimeout);
    geocodeTimeout = setTimeout(updateFleetMap, 800);
  });

  function consultarRuta() {
    const origenGrupo = selOrigen.value;
    const destinoVal = inpDestino.value.trim();
    activeRoute = null;
    routePending = false;

    if (!origenGrupo || !destinoVal) {
      resetRouteInfo();
      return;
    }

    const match = routes.find(r =>
      r.origen_grupo === origenGrupo &&
      r.destino.trim().toLowerCase() === destinoVal.toLowerCase()
    );

    sumDestino.textContent = destinoVal;

    if (match) {
      activeRoute = match;
      rutaCodigo.textContent = match.codigo;
      txtDistancia.textContent = `${match.km} KM`;
      sumDistancia.textContent = `${match.km} KM`;
      rutaEstado.textContent = 'RUTA CREADA';
      rutaInd.className = 'w-3 h-3 rounded-full bg-[#28a745]';
      sumRuta.textContent = match.codigo;
      sumRuta.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800';
    } else {
      routePending = true;
      rutaCodigo.textContent = '—';
      // Si ya se cotizó este mismo origen/destino antes, reutilizar la distancia cacheada
      const cached = findCachedQuote(origenGrupo, destinoVal);
      const kmEstimado = cached && cached.km ? cached.km : 0;
      txtDistancia.textContent = `${kmEstimado} KM`;
      sumDistancia.textContent = `${kmEstimado} KM`;
      rutaEstado.textContent = 'PENDIENTE DE CREACIÓN';
      rutaInd.className = 'w-3 h-3 rounded-full bg-[#f59e0b]';
      sumRuta.textContent = 'RUTA NO CREADA';
      sumRuta.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800';
    }
  }

  function resetRouteInfo() {
    activeRoute = null;
    routePending = false;
    rutaCodigo.textContent = '—';
    txtDistancia.textContent = '0 KM';
    rutaEstado.textContent = 'Sin consultar';
    rutaInd.className = 'w-3 h-3 rounded-full bg-secondary';
    sumDestino.textContent = 'Seleccione destino';
    sumDistancia.textContent = '0.0 KM';
    sumRuta.textContent = '—';
    sumRuta.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-secondary';
  }

  // Tipo de servicio
  document.querySelectorAll('input[name="q-servicio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      servicio = e.target.value;
      if (servicio === 'exclusivo') {
        blockExclusivo.classList.remove('hidden');
        blockConsolidado.classList.add('hidden');
        lblExclusivo.className = 'flex items-center gap-sm border-2 border-primary bg-primary/5 p-md rounded-lg cursor-pointer transition-all';
        lblConsolidado.className = 'flex items-center gap-sm border-2 border-outline-variant p-md rounded-lg cursor-pointer transition-all';
      } else {
        blockExclusivo.classList.add('hidden');
        blockConsolidado.classList.remove('hidden');
        lblConsolidado.className = 'flex items-center gap-sm border-2 border-primary bg-primary/5 p-md rounded-lg cursor-pointer transition-all';
        lblExclusivo.className = 'flex items-center gap-sm border-2 border-outline-variant p-md rounded-lg cursor-pointer transition-all';
      }
      calculatePrice();
    });
  });

  selVehiculo.addEventListener('change', calculatePrice);
  inpKilos.addEventListener('input', calculatePrice);

  // --- CÁLCULO DE TARIFA ---
  function calculatePrice() {
    let precio = 0;
    let refCapKg = null;

    if (activeRoute) {
      const km = Number(activeRoute.km);
      const origenGrupo = selOrigen.value;
      // Tarifas vigentes para el centro representativo del Origen seleccionado
      const cdOrigenId = resolveOrigenIdFromGrupo(db, origenGrupo);
      const tarifasCentro = truckTypes.filter(t => t.Id_centro === cdOrigenId);

      if (servicio === 'exclusivo') {
        const truck = tarifasCentro.find(t => t.type === selVehiculo.value);
        if (truck) {
          precio = Number(truck.baseRate) + (km * Number(truck.ratePerKm));
          sumVehiculo.textContent = truck.type;
          refCapKg = truckCapKg(truck.type);
        } else {
          sumVehiculo.textContent = 'Seleccione camión';
        }
      } else {
        const kilos = Number(inpKilos.value) || 0;
        if (kilos > 0 && tarifasCentro.length > 0) {
          // Tarifa consolidada: prorrateo sobre el camión de mayor capacidad (28 Ton)
          const ref = tarifasCentro.reduce((a, b) => (Number(a.baseRate) > Number(b.baseRate) ? a : b));
          const total28 = Number(ref.baseRate) + (km * Number(ref.ratePerKm));
          precio = Math.max(25000, Math.round(total28 * (Math.min(kilos, 28000) / 28000)));
          sumVehiculo.textContent = `Consolidado · ${kilos.toLocaleString('es-CL')} kg`;
          refCapKg = 28000;
        } else {
          sumVehiculo.textContent = 'Ingrese kilos';
        }
      }
    } else {
      sumVehiculo.textContent = routePending ? 'Ruta pendiente de creación' : 'Seleccione servicio';
    }

    sumPrecio.textContent = precio > 0 ? formatCLP(precio) : '$0 CLP';
    updateZfmReference(refCapKg);

    // Guardar/actualizar la cotización en el caché de las últimas 10 del perfil,
    // para evitar volver a consultar la misma ruta (origen/destino) más adelante.
    const origenGrupo = selOrigen.value;
    const destinoVal = inpDestino.value.trim();
    if (precio > 0 && origenGrupo && destinoVal) {
      upsertRecentQuote({
        fecha: new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }),
        origenId: origenGrupo,
        origen: origenGrupo,
        destino: destinoVal,
        vehiculo: sumVehiculo.textContent,
        estado: activeRoute ? 'RUTA CREADA' : 'RUTA NO CREADA',
        monto: precio,
        km: activeRoute ? Number(activeRoute.km) : (findCachedQuote(origenGrupo, destinoVal)?.km || 0),
        lat: lastDestCoords ? lastDestCoords.lat : null,
        lon: lastDestCoords ? lastDestCoords.lon : null
      });
      renderHistoryTable(loadRecentQuotes());
    }
  }

  // --- REFERENCIA TARIFA CLIENTE (ZFMI/ZFMP/ZFMX) ---
  // Muestra, a modo de referencia para el agente comercial, el rango de tarifa
  // calculado por el Motor de Costo / Tarifa Cliente para la ruta y camión actuales.
  // No reemplaza ni altera el VALOR NETO mostrado (basado en Tarifa Base/Tarifa-KM).
  function updateZfmReference(capKg) {
    if (!activeRoute || !capKg) {
      refZfm.classList.add('hidden');
      return;
    }
    try {
      const cfg = getTariffConfig(db);
      const ccfg = getClientTariffConfig(db);
      const cons = (ccfg.consolidacion || {})[activeRoute.id] || { factorConsolidacion: 1 };
      const factor = cons.factorConsolidacion ?? 1;
      const nextCap = NEXT_CAP_REF[capKg] || capKg;

      const m = calcularCostoRuta(db, cfg, activeRoute, capKg);
      const m5 = calcularCostoRuta(db, cfg, activeRoute, 5000);
      const mNext = calcularCostoRuta(db, cfg, activeRoute, nextCap);

      const zfmx = Math.round(m.zcapConMargen);
      const zfmi = Math.round(m5.zcapConMargen * factor);
      const zfmp = nextCap > 0 ? Math.round((mNext.zcapConMargen / nextCap) * factor) : 0;

      refZfmi.textContent = formatCLP(zfmi);
      refZfmp.textContent = formatCLP(zfmp);
      refZfmx.textContent = formatCLP(zfmx);
      refZfm.classList.remove('hidden');
    } catch (err) {
      console.error('Error al calcular referencia ZFMI/ZFMP/ZFMX:', err);
      refZfm.classList.add('hidden');
    }
  }
}

// Renderizar la tabla de historial
function renderHistoryTable(historyList) {
  const tbody = document.getElementById('quotes-history-tbody');
  if (!tbody) return;

  if (!historyList || historyList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="p-md text-center text-secondary">
          No hay cotizaciones registradas recientemente.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  historyList.forEach(q => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant";
    const badgeBg = (q.estado === 'ASIGNADO' || q.estado === 'RUTA CREADA') ? 'bg-green-100 text-green-800'
      : q.estado === 'RUTA NO CREADA' ? 'bg-red-100 text-red-800'
      : 'bg-secondary-container text-on-secondary-container';
    tr.innerHTML = `
      <td class="p-md font-data-mono text-data-mono">${q.fecha}</td>
      <td class="p-md">${q.origen} → ${q.destino}</td>
      <td class="p-md">${q.vehiculo}</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-1 rounded ${badgeBg} font-label-caps text-[10px]">
          ${q.estado}
        </span>
      </td>
      <td class="p-md text-right font-bold">${formatCLP(q.monto)}</td>
    `;
    tbody.appendChild(tr);
  });
}
