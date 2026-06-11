import { getDatabase, saveDatabase } from './data.js';
import { formatCLP, showAlert } from './utils.js';

// Renderizar la vista principal del Cotizador de Tarifas
export function renderRatesView(container) {
  const db = getDatabase();
  const cds = db.logisticsCentres;
  const routes = db.routes.filter(r => r.activo);
  const truckTypes = db.truckTypes;

  // Generar ID único temporal para esta cotización
  const currentQuoteId = `${Math.floor(1000 + Math.random() * 9000)}-QT`;

  container.innerHTML = `
    <!-- Page Header -->
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Cotizador de Tarifas</h1>
      <p class="font-body-lg text-body-lg text-secondary">Configure los parámetros de transporte para obtener una estimación precisa de costos operativos.</p>
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
                <!-- Opciones cargadas dinámicamente -->
              </select>
            </div>
            <!-- Destino -->
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DESTINO (COMUNA O SECTOR)</label>
              <select id="q-destino" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white" required disabled>
                <option value="">Primero seleccione origen...</option>
              </select>
            </div>
          </div>

          <!-- Automated Fields -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-lg bg-surface-container-low p-md rounded">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">TIPO DE RUTA</label>
              <div class="flex items-center gap-sm bg-surface p-sm border border-outline-variant rounded">
                <span class="w-3 h-3 rounded-full bg-secondary" id="q-tipo-indicator"></span>
                <span class="font-body-md text-body-md font-bold text-on-surface" id="q-tipo-text">No asignado</span>
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DISTANCIA ESTIMADA</label>
              <div class="flex items-center gap-sm bg-surface p-sm border border-outline-variant rounded">
                <span class="material-symbols-outlined text-secondary text-[18px]">straighten</span>
                <span class="font-data-mono text-data-mono font-bold text-on-surface" id="q-distancia-text">0 KM</span>
              </div>
            </div>
          </div>

          <!-- Tipo de Camión -->
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO DE VEHÍCULO ASIGNADO</label>
            <select id="q-vehiculo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white" required>
              <option value="">Seleccione vehículo...</option>
              <!-- Cargado dinámicamente -->
            </select>
          </div>

          <!-- Atmospheric Decor (Graphic) -->
          <div class="h-32 w-full overflow-hidden relative border border-outline-variant rounded">
            <img class="w-full h-full object-cover grayscale opacity-30" alt="A cinematic long shot of a heavy-duty industrial truck driving down a modern Chilean highway at dusk." src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGBETVbx8UuFDc81gmGOJ-gvv-jsbuTZVtaK9pSsSDSHn9Wr4Bt_tluEfLbyHGZtuzb00P3yirq1P7TMt0ide2tTSgKprvNmpOHaldLmmG3DcYLiE0E1Fz_ZXvnjZcusN0ZXTCprULgbmvQuUBv_f5FYKJHlMuHEiOnaLKrP8Q-c-8fR2uOh-8KggAF-gzGxB7AIidMwSvfsiUGdR5uPk4nPNdqHIUF5u1dFoASs01H2b7ApVTMWFEJ0QkYQ9loOyfSinl2QFTmr8"/>
            <div class="absolute inset-0 bg-gradient-to-t from-surface-container-lowest to-transparent"></div>
            <div class="absolute bottom-sm left-sm px-xs bg-primary text-white text-[10px] font-bold tracking-widest uppercase">Visualización de Flota</div>
          </div>
        </form>
      </section>

      <!-- Right Column: Tarjeta de Detalle -->
      <section class="col-span-12 lg:col-span-5 flex flex-col gap-lg">
        <div class="bg-surface-container-low border border-outline-variant p-lg shadow-md relative overflow-hidden flex-1 flex flex-col justify-between">
          <!-- Background Accents -->
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
                  <div class="text-right">
                    <p class="font-body-md text-body-md font-bold text-on-surface" id="q-summary-destino">Seleccione destino</p>
                    <p class="font-label-caps text-[10px] text-primary hidden" id="q-summary-tipo-badge">INTERREGIONAL</p>
                  </div>
                </li>
                <li class="flex justify-between items-center border-b border-outline-variant pb-sm">
                  <span class="font-body-md text-body-md text-secondary">Distancia total</span>
                  <span class="font-data-mono text-data-mono font-bold text-on-surface" id="q-summary-distancia">0.0 KM</span>
                </li>
                <li class="flex justify-between items-center">
                  <span class="font-body-md text-body-md text-secondary">Vehículo asignado</span>
                  <span class="font-body-md text-body-md font-bold text-on-surface" id="q-summary-vehiculo">Seleccione vehículo</span>
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
                <button type="button" id="btn-assign-quote" class="w-full bg-[#28a745] hover:bg-[#218838] text-white font-bold py-md rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                  <span class="material-symbols-outlined">assignment_turned_in</span>
                  Asignar a Plan de Entrega
                </button>
                <button type="button" id="btn-export-pdf-quote" class="w-full border border-secondary text-secondary hover:bg-surface-container-high font-bold py-md rounded-lg active:scale-[0.98] transition-all flex items-center justify-center gap-md cursor-pointer">
                  <span class="material-symbols-outlined">picture_as_pdf</span>
                  Exportar PDF
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Mini Insights Card -->
        <div class="bg-surface-container-lowest border border-outline-variant p-md flex items-center gap-lg rounded">
          <div class="w-12 h-12 bg-surface-container-high flex items-center justify-center text-primary rounded">
            <span class="material-symbols-outlined text-[32px]">inventory_2</span>
          </div>
          <div class="flex-1">
            <p class="font-label-caps text-[10px] text-secondary">CAPACIDAD UTILIZADA</p>
            <div class="flex items-center gap-sm">
              <span class="font-data-mono text-data-mono font-bold" id="kpi-capacity-percentage">85%</span>
              <div class="flex-1 h-2 bg-surface-container-low rounded-full overflow-hidden">
                <div class="h-full bg-primary" style="width: 85%" id="kpi-capacity-bar"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Contextual List: Recent Quotes (Systematic approach to data) -->
    <div class="mt-xl">
      <div class="flex justify-between items-end mb-md">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Historial Reciente de Cotizaciones</h3>
        <button id="btn-reset-history" class="font-label-caps text-label-caps text-primary hover:underline bg-none border-none cursor-pointer">Restablecer Historial</button>
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
          <tbody id="quotes-history-tbody" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>
  `;

  // --- VARIABLES DE SELECCIÓN Y LOGICA ---
  const selOrigen = document.getElementById('q-origen');
  const selDestino = document.getElementById('q-destino');
  const selVehiculo = document.getElementById('q-vehiculo');
  
  const txtTipo = document.getElementById('q-tipo-text');
  const indTipo = document.getElementById('q-tipo-indicator');
  const txtDistancia = document.getElementById('q-distancia-text');

  const sumOrigen = document.getElementById('q-summary-origen');
  const sumDestino = document.getElementById('q-summary-destino');
  const sumDistancia = document.getElementById('q-summary-distancia');
  const sumVehiculo = document.getElementById('q-summary-vehiculo');
  const sumPrecio = document.getElementById('q-summary-precio');
  const sumTipoBadge = document.getElementById('q-summary-tipo-badge');

  const btnAssign = document.getElementById('btn-assign-quote');
  const btnExportPdf = document.getElementById('btn-export-pdf-quote');

  let calculatedPrice = 0;
  let activeRouteObj = null;
  let activeTruckObj = null;

  // --- RENDERIZADO INICIAL ---

  // 1. Cargar Orígenes (CDs)
  selOrigen.innerHTML = '<option value="">Seleccione origen...</option>';
  cds.forEach(cd => {
    const opt = document.createElement('option');
    opt.value = cd.nombre;
    opt.textContent = cd.nombre;
    selOrigen.appendChild(opt);
  });

  // 2. Cargar Vehículos (Tipos de camiones de la Matriz)
  selVehiculo.innerHTML = '<option value="">Seleccione vehículo...</option>';
  truckTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${t.type} (Capacidad: ${t.capacityTons})`;
    selVehiculo.appendChild(opt);
  });

  // 3. Renderizar la tabla de historial de cotizaciones
  renderHistoryTable(db.quotesHistory);
  updateCapacityKpi(db.quotesHistory);

  // --- CONFIGURACIÓN DE EVENTOS REACTIVOS ---

  // Evento Origen: Filtra y habilita los destinos correspondientes
  selOrigen.addEventListener('change', () => {
    const chosenOrigin = selOrigen.value;
    selDestino.innerHTML = '<option value="">Seleccione destino...</option>';
    
    // Limpiar campos automáticos
    resetAutoFields();

    if (chosenOrigin) {
      // Filtrar rutas activas que salgan de ese origen
      const filteredRoutes = routes.filter(r => r.origen === chosenOrigin);
      
      if (filteredRoutes.length === 0) {
        selDestino.innerHTML = '<option value="">No hay rutas para este origen</option>';
        selDestino.disabled = true;
      } else {
        filteredRoutes.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = `${r.destino} (${r.km} KM)`;
          selDestino.appendChild(opt);
        });
        selDestino.disabled = false;
      }
      sumOrigen.textContent = chosenOrigin;
    } else {
      selDestino.disabled = true;
      sumOrigen.textContent = "Seleccione origen";
    }

    calculateQuotePrice();
  });

  // Evento Destino: Carga información de la ruta en tiempo real
  selDestino.addEventListener('change', () => {
    const routeId = selDestino.value;
    
    if (routeId) {
      const selectedRoute = routes.find(r => r.id === routeId);
      activeRouteObj = selectedRoute;

      if (selectedRoute) {
        // Cargar distancia
        txtDistancia.textContent = `${selectedRoute.km} KM`;
        sumDistancia.textContent = `${selectedRoute.km} KM`;
        sumDestino.textContent = selectedRoute.destino;

        // Cargar Tipo de Ruta y lógica regional
        const originCdObj = cds.find(c => c.nombre === selectedRoute.origen);
        // Si la región de origen es distinta de la de destino, es Interregional
        const isInterregional = originCdObj && !selectedRoute.region.toLowerCase().includes(originCdObj.direccion.toLowerCase().split(',').pop().trim().toLowerCase());
        
        let typeLabel = selectedRoute.tipo; // Comuna o Sector
        if (selectedRoute.km > 100) {
          typeLabel = "Interregional";
        }
        
        txtTipo.textContent = typeLabel;
        
        // Estilos del indicador de tipo de ruta
        indTipo.className = "w-3 h-3 rounded-full";
        if (typeLabel === "Interregional") {
          indTipo.classList.add("bg-primary");
          sumTipoBadge.textContent = "INTERREGIONAL";
          sumTipoBadge.classList.remove("hidden");
        } else {
          indTipo.classList.add("bg-[#28a745]");
          sumTipoBadge.classList.add("hidden");
        }
      }
    } else {
      resetAutoFields();
    }

    calculateQuotePrice();
  });

  // Evento Vehículo: Actualiza el tipo y recalculas el precio
  selVehiculo.addEventListener('change', () => {
    const truckType = selVehiculo.value;

    if (truckType) {
      const selectedTruck = truckTypes.find(t => t.type === truckType);
      activeTruckObj = selectedTruck;
      
      if (selectedTruck) {
        sumVehiculo.textContent = `${selectedTruck.type} (${selectedTruck.capacityTons})`;
      }
    } else {
      activeTruckObj = null;
      sumVehiculo.textContent = "Seleccione vehículo";
    }

    calculateQuotePrice();
  });

  // Fórmula Matemática: Calcular tarifa y actualizar tarjeta
  function calculateQuotePrice() {
    if (activeRouteObj && activeTruckObj) {
      const distance = Number(activeRouteObj.km);
      const baseRate = Number(activeTruckObj.baseRate);
      const ratePerKm = Number(activeTruckObj.ratePerKm);

      // FÓRMULA DE COSTO: Tarifa Fija + (Distancia * Costo x KM)
      calculatedPrice = baseRate + (distance * ratePerKm);
      
      sumPrecio.textContent = formatCLP(calculatedPrice);
      btnAssign.disabled = false;
    } else {
      calculatedPrice = 0;
      sumPrecio.textContent = "$0 CLP";
      btnAssign.disabled = true;
    }
  }

  // Limpiar campos automáticos de ruta
  function resetAutoFields() {
    activeRouteObj = null;
    txtTipo.textContent = "No asignado";
    indTipo.className = "w-3 h-3 rounded-full bg-secondary";
    txtDistancia.textContent = "0 KM";
    sumDestino.textContent = "Seleccione destino";
    sumDistancia.textContent = "0.0 KM";
    sumTipoBadge.classList.add("hidden");
  }

  // --- EVENTO GUARDAR / ASIGNAR COTIZACIÓN A LA BASE DE DATOS ---
  btnAssign.addEventListener('click', () => {
    if (!activeRouteObj || !activeTruckObj || calculatedPrice === 0) return;

    const db = getDatabase();
    
    // Obtener la fecha actual en formato legible (DD/MM HH:MM)
    const now = new Date();
    const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const newQuote = {
      id: 'q' + (new Date().getTime()),
      fecha: formattedDate,
      origen: activeRouteObj.origen,
      destino: activeRouteObj.destino,
      vehiculo: activeTruckObj.type,
      estado: 'ASIGNADO', // Al asignarse al plan
      monto: calculatedPrice
    };

    db.quotesHistory.unshift(newQuote); // Agregar al principio del historial
    saveDatabase(db);

    showAlert(`Cotización asignada con éxito al Plan de Entrega.`);
    
    // Resetear formulario y regenerar ID de cotización
    document.getElementById('quota-form').reset();
    resetAutoFields();
    activeTruckObj = null;
    sumVehiculo.textContent = "Seleccione vehículo";
    selDestino.disabled = true;
    calculateQuotePrice();

    // Regenerar ID en la tarjeta de resumen
    const nextQuoteId = `${Math.floor(1000 + Math.random() * 9000)}-QT`;
    document.getElementById('q-summary-id').innerText = `ID: ${nextQuoteId}`;

    // Re-renderizar la vista para reflejar el historial nuevo
    renderHistoryTable(db.quotesHistory);
    updateCapacityKpi(db.quotesHistory);
  });

  // Evento Exportar PDF (Simulado)
  btnExportPdf.addEventListener('click', () => {
    showAlert("Generando cotización en PDF... Descarga iniciada.");
  });

  // Evento Restablecer Historial
  document.getElementById('btn-reset-history').addEventListener('click', () => {
    if (confirm("¿Está seguro de restablecer el historial de cotizaciones?")) {
      const db = getDatabase();
      db.quotesHistory = [
        {
          id: 'q1',
          fecha: '24/05 08:45',
          origen: 'CD Santiago Noviciado',
          destino: 'Rancagua',
          vehiculo: 'Camión 15 Ton',
          estado: 'COTIZADO',
          monto: 185000
        },
        {
          id: 'q2',
          fecha: '24/05 08:12',
          origen: 'CD Concepción',
          destino: 'Talcahuano',
          vehiculo: 'Camión 5 Ton',
          estado: 'ASIGNADO',
          monto: 45000
        }
      ];
      saveDatabase(db);
      renderHistoryTable(db.quotesHistory);
      updateCapacityKpi(db.quotesHistory);
      showAlert("Historial de cotizaciones restablecido.");
    }
  });
}

// Renderizar la tabla de historial
function renderHistoryTable(historyList) {
  const tbody = document.getElementById('quotes-history-tbody');
  if (!tbody) return;

  if (historyList.length === 0) {
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
    
    // Estilo del badge según estado
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

// Actualizar el porcentaje de capacidad utilizada dinámicamente según asignaciones
function updateCapacityKpi(historyList) {
  const capText = document.getElementById('kpi-capacity-percentage');
  const capBar = document.getElementById('kpi-capacity-bar');
  if (!capText || !capBar) return;

  // Calculamos una capacidad basada en las cotizaciones asignadas
  const assignedCount = historyList.filter(q => q.estado === 'ASIGNADO').length;
  // Simulación: Cada asignación ocupa un 15%, partiendo de un base de 35%, hasta un límite de 98%
  let percentage = 35 + (assignedCount * 15);
  if (percentage > 98) percentage = 98;

  capText.innerText = `${percentage}%`;
  capBar.style.width = `${percentage}%`;
}
