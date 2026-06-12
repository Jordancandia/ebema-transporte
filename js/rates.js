import { getDatabase, saveDatabase, getCentreName } from './data.js';
import { formatCLP, showAlert } from './utils.js';

// Cotizador de Tarifas — SIT EBEMA (Sistema Integrado de Transporte)
// Servicio EXCLUSIVO: tarifa según tipo de camión (5/10/15/28 Ton).
// Servicio CONSOLIDADO: tarifa prorrateada según kilos transportados.
export function renderRatesView(container) {
  const db = getDatabase();
  const cds = db.logisticsCentres;
  const routes = db.routes.filter(r => r.activo);
  const truckTypes = db.truckTypes;

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
          <div class="absolute -top-12 -right-12 w-48 h-48 bg-primary opacity-5 rounded-full"></div>

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
              <div class="bg-surface-container-lowest p-lg border-2 border-primary/10 mb-xl rounded">
                <p class="font-label-caps text-label-caps text-secondary text-center mb-base">PRECIO FINAL (IVA INCL.)</p>
                <p class="font-headline-lg text-headline-lg text-primary text-center font-extrabold tracking-tighter" id="q-summary-precio">$0 CLP</p>
                <p class="font-label-caps text-[10px] text-center text-secondary mt-base">Vigencia: 24 Horas</p>
              </div>

              <div class="flex flex-col gap-sm">
                <button type="button" id="btn-assign-quote" disabled title="Función deshabilitada"
                  class="w-full bg-[#28a745] text-white font-bold py-md rounded-lg shadow-lg flex items-center justify-center gap-md opacity-40 cursor-not-allowed">
                  <span class="material-symbols-outlined">assignment_turned_in</span>
                  Asignar a Plan de Entrega
                </button>
                <button type="button" id="btn-export-pdf-quote" disabled title="Función deshabilitada"
                  class="w-full border border-secondary text-secondary font-bold py-md rounded-lg flex items-center justify-center gap-md opacity-40 cursor-not-allowed">
                  <span class="material-symbols-outlined">picture_as_pdf</span>
                  Exportar PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
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
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Monto</th>
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

  const blockExclusivo = document.getElementById('q-exclusivo-block');
  const blockConsolidado = document.getElementById('q-consolidado-block');
  const lblExclusivo = document.getElementById('lbl-exclusivo');
  const lblConsolidado = document.getElementById('lbl-consolidado');

  let activeRoute = null;     // ruta encontrada (o null)
  let routePending = false;   // destino consultado sin ruta creada
  let servicio = 'exclusivo';

  // --- CARGA INICIAL ---
  selOrigen.innerHTML = '<option value="">Seleccione origen...</option>';
  cds.forEach(cd => {
    const opt = document.createElement('option');
    opt.value = cd.id;
    opt.textContent = cd.nombre;
    selOrigen.appendChild(opt);
  });

  selVehiculo.innerHTML = '<option value="">Seleccione camión...</option>';
  truckTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${t.type} (${t.capacityTons})`;
    selVehiculo.appendChild(opt);
  });

  renderHistoryTable(db.quotesHistory);

  // --- EVENTOS ---

  selOrigen.addEventListener('change', () => {
    const origenId = selOrigen.value;
    datalist.innerHTML = '';
    inpDestino.value = '';
    resetRouteInfo();

    if (origenId) {
      const destinos = routes.filter(r => r.origenId === origenId).map(r => r.destino);
      [...new Set(destinos)].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        datalist.appendChild(opt);
      });
      inpDestino.disabled = false;
      inpDestino.placeholder = 'Escriba la comuna o sector...';
      sumOrigen.textContent = getCentreName(db, origenId);
    } else {
      inpDestino.disabled = true;
      inpDestino.placeholder = 'Primero seleccione origen...';
      sumOrigen.textContent = 'Seleccione origen';
    }
    calculatePrice();
  });

  inpDestino.addEventListener('input', () => {
    consultarRuta();
    calculatePrice();
  });

  function consultarRuta() {
    const origenId = selOrigen.value;
    const destinoVal = inpDestino.value.trim();
    activeRoute = null;
    routePending = false;

    if (!origenId || !destinoVal) {
      resetRouteInfo();
      return;
    }

    const match = routes.find(r =>
      r.origenId === origenId &&
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
      sumRuta.textContent = `${match.codigo} · CREADA`;
      sumRuta.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800';
    } else {
      routePending = true;
      rutaCodigo.textContent = '—';
      txtDistancia.textContent = '0 KM';
      sumDistancia.textContent = '0.0 KM';
      rutaEstado.textContent = 'PENDIENTE DE CREACIÓN';
      rutaInd.className = 'w-3 h-3 rounded-full bg-[#f59e0b]';
      sumRuta.textContent = 'PENDIENTE DE CREACIÓN';
      sumRuta.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800';
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

    if (activeRoute) {
      const km = Number(activeRoute.km);

      if (servicio === 'exclusivo') {
        const truck = truckTypes.find(t => t.type === selVehiculo.value);
        if (truck) {
          precio = Number(truck.baseRate) + (km * Number(truck.ratePerKm));
          sumVehiculo.textContent = truck.type;
        } else {
          sumVehiculo.textContent = 'Seleccione camión';
        }
      } else {
        const kilos = Number(inpKilos.value) || 0;
        if (kilos > 0) {
          // Tarifa consolidada: prorrateo sobre el camión de mayor capacidad (28 Ton)
          const ref = truckTypes.reduce((a, b) => (Number(a.baseRate) > Number(b.baseRate) ? a : b));
          const total28 = Number(ref.baseRate) + (km * Number(ref.ratePerKm));
          precio = Math.max(25000, Math.round(total28 * (Math.min(kilos, 28000) / 28000)));
          sumVehiculo.textContent = `Consolidado · ${kilos.toLocaleString('es-CL')} kg`;
        } else {
          sumVehiculo.textContent = 'Ingrese kilos';
        }
      }
    } else {
      sumVehiculo.textContent = routePending ? 'Ruta pendiente de creación' : 'Seleccione servicio';
    }

    sumPrecio.textContent = precio > 0 ? formatCLP(precio) : '$0 CLP';
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
    const badgeBg = q.estado === 'ASIGNADO' ? 'bg-green-100 text-green-800' : 'bg-secondary-container text-on-secondary-container';
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
