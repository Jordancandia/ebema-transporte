import { getDatabase, saveDatabase, getCentreName } from './data.js';
import { generateSapCode, parseCSV, showAlert, geocodeAddress } from './utils.js';

// Estilos de la característica especial de la ruta
const CARACT_STYLES = {
  'NORMAL':  'bg-surface-container-high text-secondary border border-outline-variant',
  'EXTREMA': 'bg-amber-100 text-amber-800 border border-amber-300',
  'ISLA':    'bg-blue-100 text-blue-800 border border-blue-300'
};

// Calcular distancia por carretera entre el CD de origen y el destino (OSRM + Nominatim)
async function calcularDistanciaAuto(cdOrigen, destinoTexto) {
  const coordsDestino = await geocodeAddress(destinoTexto);
  if (!coordsDestino || !coordsDestino.lat) throw new Error('No se pudo geolocalizar el destino');
  const url = `https://router.project-osrm.org/route/v1/driving/${cdOrigen.lon},${cdOrigen.lat};${coordsDestino.lon},${coordsDestino.lat}?overview=false`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Servicio de rutas no disponible');
  const data = await resp.json();
  if (!data.routes || !data.routes[0]) throw new Error('No se encontró ruta por carretera');
  return Math.round(data.routes[0].distance / 1000);
}

let editingRouteId = null;

export function renderRoutesView(container) {
  const db = getDatabase();
  const routes = db.routes;

  // Calcular KPIs
  const totalRoutes = routes.length;
  const activeRoutes = routes.filter(r => r.activo).length;
  const inactiveRoutes = totalRoutes - activeRoutes;
  const averageKm = totalRoutes > 0 
    ? Math.round(routes.reduce((acc, r) => acc + Number(r.km), 0) / totalRoutes) 
    : 0;

  container.innerHTML = `
    <!-- Page Header -->
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administración de Rutas Logísticas</h1>
      <p class="font-body-lg text-body-lg text-secondary">Defina los puntos de salida, comunas de entrega, regiones geográficas y kilometraje para la cotización de fletes.</p>
    </div>

    <!-- Tarjetas de Estadísticas KPI -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Rutas</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${totalRoutes}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">route</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Rutas Activas</h4>
          <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${activeRoutes}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded border-l-4 border-primary flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Distancia Promedio</h4>
          <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${averageKm} KM</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-primary">straighten</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Dadas de Baja</h4>
          <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${inactiveRoutes}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-red-500">block</span>
      </div>
    </div>

    <!-- Tabla de Rutas -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <!-- Barra superior de filtros -->
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="relative w-full md:w-96 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
          <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
          <input type="text" id="route-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Código, Origen, Destino, Región...">
        </div>
        
        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-bulk-upload-routes" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">upload_file</span>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-route" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
            <span class="material-symbols-outlined text-[18px]">add</span>
            Nueva Ruta
          </button>
        </div>
      </div>

      <!-- Tabla Responsiva -->
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">Código Ruta</th>
              <th class="p-md">Denominación</th>
              <th class="p-md">Origen (CD)</th>
              <th class="p-md">Destino (Comuna/Sector)</th>
              <th class="p-md">Región</th>
              <th class="p-md">Tipo</th>
              <th class="p-md">Característica</th>
              <th class="p-md">Distancia</th>
              <th class="p-md">Estado</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="routes-table-body" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="route-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 id="route-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Nueva Ruta</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-route-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="route-form">
          <div class="p-lg space-y-md">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-codigo" class="font-label-caps text-label-caps text-secondary block">CÓDIGO DE RUTA SAP</label>
                <input type="text" id="r-codigo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: RUT-SCL-001">
              </div>
              <div class="space-y-xs">
                <label for="r-origen" class="font-label-caps text-label-caps text-secondary block">CENTRO LOGÍSTICO (ORIGEN)</label>
                <select id="r-origen" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <!-- Cargado dinámicamente -->
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-destino" class="font-label-caps text-label-caps text-secondary block">DESTINO (CIUDAD/COMUNA)</label>
                <input type="text" id="r-destino" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: Maipú">
              </div>
              <div class="space-y-xs">
                <label for="r-region" class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
                <select id="r-region" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="Metropolitana">Metropolitana</option>
                  <option value="Arica y Parinacota">Arica y Parinacota</option>
                  <option value="Tarapacá">Tarapacá</option>
                  <option value="Antofagasta">Antofagasta</option>
                  <option value="Atacama">Atacama</option>
                  <option value="Coquimbo">Coquimbo</option>
                  <option value="Valparaíso">Valparaíso</option>
                  <option value="O'Higgins">O'Higgins</option>
                  <option value="Maule">Maule</option>
                  <option value="Ñuble">Ñuble</option>
                  <option value="Biobío">Biobío</option>
                  <option value="La Araucanía">La Araucanía</option>
                  <option value="Los Ríos">Los Ríos</option>
                  <option value="Los Lagos">Los Lagos</option>
                  <option value="Aysén">Aysén</option>
                  <option value="Magallanes">Magallanes</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="r-tipo" class="font-label-caps text-label-caps text-secondary block">TIPO DE ZONA</label>
                <select id="r-tipo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="Comuna">Comuna</option>
                  <option value="Sector">Sector</option>
                </select>
              </div>
              <div class="space-y-xs">
                <label for="r-caracteristica" class="font-label-caps text-label-caps text-secondary block">CARACTERÍSTICA ESPECIAL</label>
                <select id="r-caracteristica" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required>
                  <option value="NORMAL">NORMAL</option>
                  <option value="EXTREMA">EXTREMA</option>
                  <option value="ISLA">ISLA</option>
                </select>
              </div>
            </div>

            <div class="space-y-xs">
              <label for="r-denominacion" class="font-label-caps text-label-caps text-secondary block">DENOMINACIÓN DE RUTA (ORIGEN - DESTINO)</label>
              <input type="text" id="r-denominacion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Se genera automáticamente desde el origen y destino" required>
            </div>

            <div class="space-y-xs">
              <label for="r-km" class="font-label-caps text-label-caps text-secondary block">DISTANCIA (KM)</label>
              <div class="flex gap-sm">
                <input type="number" id="r-km" class="flex-1 border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required min="1" placeholder="Ej: 45">
                <button type="button" id="btn-auto-km" class="bg-surface-container-high hover:bg-primary hover:text-white border border-outline-variant text-secondary font-bold px-md py-sm rounded cursor-pointer text-xs flex items-center gap-xs transition-all whitespace-nowrap">
                  <span class="material-symbols-outlined text-[16px]">travel_explore</span>
                  Calcular KM automático
                </button>
              </div>
              <p class="text-[11px] text-secondary" id="auto-km-status">Calcula la distancia real por carretera entre el centro de origen y el destino.</p>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-route-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer">Guardar Ruta</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-routes-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Rutas</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-route-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Sube un archivo delimitado por punto y coma (<code>;</code>) o comas (<code>,</code>). Los encabezados exactos del archivo de rutas deben ser:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">
              codigo;origen;destino;region;tipo;km
            </code>
          </p>
          
          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-sm" id="csv-route-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu archivo CSV de rutas aquí o haz clic para buscar</span>
            <input type="file" id="csv-route-input" accept=".csv" class="hidden">
          </div>

          <div id="csv-route-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa de Rutas Detectadas (<span id="csv-route-count">0</span>):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Código</th>
                    <th class="p-sm">Origen</th>
                    <th class="p-sm">Destino</th>
                    <th class="p-sm">KM</th>
                    <th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-route-preview-body">
                  <!-- Dinámico -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-route-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-confirm-route-bulk" disabled>Importar registros</button>
        </div>
      </div>
    </div>
  `;

  // Renderizar tabla
  renderRoutesTable(routes);

  // Llenar selector de orígenes en el formulario
  const originSelect = document.getElementById('r-origen');
  originSelect.innerHTML = '';
  db.logisticsCentres.forEach(cd => {
    const opt = document.createElement('option');
    opt.value = cd.id;
    opt.textContent = cd.nombre;
    originSelect.appendChild(opt);
  });

  // Denominación de ruta = Centro Origen - Destino (autogenerada, editable)
  const origenSelectEl = document.getElementById('r-origen');
  const destinoInputEl = document.getElementById('r-destino');
  const denominacionEl = document.getElementById('r-denominacion');
  const actualizarDenominacion = () => {
    const origenNombre = origenSelectEl.options[origenSelectEl.selectedIndex]
      ? origenSelectEl.options[origenSelectEl.selectedIndex].textContent
      : '';
    const destino = destinoInputEl.value.trim();
    denominacionEl.value = `${origenNombre}${destino ? ' - ' + destino : ''}`;
  };
  origenSelectEl.addEventListener('change', actualizarDenominacion);
  destinoInputEl.addEventListener('input', actualizarDenominacion);

  // Buscador
  const searchInput = document.getElementById('route-search');
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = routes.filter(r =>
      r.codigo.toLowerCase().includes(term) ||
      getCentreName(db, r.origenId).toLowerCase().includes(term) ||
      r.destino.toLowerCase().includes(term) ||
      r.region.toLowerCase().includes(term)
    );
    renderRoutesTable(filtered);
  });

  // Modales
  const routeModal = document.getElementById('route-modal');
  const btnCreateRoute = document.getElementById('btn-create-route');
  const btnCloseModal = document.getElementById('btn-close-route-modal');
  const btnCancelModal = document.getElementById('btn-cancel-route-modal');
  const routeForm = document.getElementById('route-form');

  btnCreateRoute.addEventListener('click', () => {
    editingRouteId = null;
    routeForm.reset();
    document.getElementById('route-modal-title').innerText = 'Nueva Ruta';
    
    const activeDb = getDatabase();
    document.getElementById('r-codigo').value = generateSapCode('RUT-SAP-', activeDb.routes, 'codigo');
    actualizarDenominacion();

    routeModal.classList.remove('pointer-events-none', 'opacity-0');
    routeModal.querySelector('.modal-window').classList.remove('scale-95');
  });

  const closeFormModal = () => {
    routeModal.classList.add('pointer-events-none', 'opacity-0');
    routeModal.querySelector('.modal-window').classList.add('scale-95');
  };
  btnCloseModal.addEventListener('click', closeFormModal);
  btnCancelModal.addEventListener('click', closeFormModal);

  // Cálculo automático de distancia por carretera (origen CD → destino)
  document.getElementById('btn-auto-km').addEventListener('click', async () => {
    const btn = document.getElementById('btn-auto-km');
    const status = document.getElementById('auto-km-status');
    const origenId = document.getElementById('r-origen').value;
    const destino = document.getElementById('r-destino').value.trim();
    const region = document.getElementById('r-region').value;

    if (!origenId) return showAlert('Seleccione primero el centro de origen.', 'error');
    if (!destino) return showAlert('Escriba primero el destino.', 'error');

    const activeDb = getDatabase();
    const cd = activeDb.logisticsCentres.find(c => c.id === origenId);
    if (!cd || !cd.lat || !cd.lon) return showAlert('El centro de origen no tiene coordenadas GPS.', 'error');

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Calculando...';
    status.textContent = 'Geolocalizando destino y calculando ruta por carretera...';

    try {
      const km = await calcularDistanciaAuto(cd, `${destino}, ${region}`);
      document.getElementById('r-km').value = km;
      status.textContent = `✓ Distancia calculada: ${km} km por carretera desde ${cd.nombre}.`;
      status.style.color = '#16a34a';
    } catch (err) {
      status.textContent = '✗ ' + (err.message || 'No se pudo calcular la distancia. Ingrésela manualmente.');
      status.style.color = '#b5000b';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">travel_explore</span> Calcular KM automático';
    }
  });

  routeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const db = getDatabase();
    
    const routeData = {
      codigo: document.getElementById('r-codigo').value.toUpperCase().replace(/\s+/g, ''),
      origenId: document.getElementById('r-origen').value,
      destino: document.getElementById('r-destino').value,
      denominacion: document.getElementById('r-denominacion').value.trim(),
      region: document.getElementById('r-region').value,
      tipo: document.getElementById('r-tipo').value,
      caracteristica: document.getElementById('r-caracteristica').value,
      km: Number(document.getElementById('r-km').value),
      activo: editingRouteId ? db.routes.find(r => r.id === editingRouteId).activo : true
    };

    if (editingRouteId) {
      const index = db.routes.findIndex(r => r.id === editingRouteId);
      if (index !== -1) {
        db.routes[index] = { ...db.routes[index], ...routeData };
        saveDatabase(db);
        showAlert('Ruta actualizada correctamente');
      }
    } else {
      if (db.routes.some(r => r.codigo === routeData.codigo)) {
        showAlert('El Código de Ruta ingresado ya está registrado.', 'error');
        return;
      }

      routeData.id = 'r' + (new Date().getTime());
      db.routes.push(routeData);
      saveDatabase(db);
      showAlert('Ruta registrada con éxito');
    }

    closeFormModal();
    renderRoutesView(container);
  });

  // --- CARGA MASIVA DE RUTAS ---
  const bulkModal = document.getElementById('bulk-upload-routes-modal');
  const btnBulkUpload = document.getElementById('btn-bulk-upload-routes');
  const btnCloseBulk = document.getElementById('btn-close-route-bulk-modal');
  const btnCancelBulk = document.getElementById('btn-cancel-route-bulk');
  const btnConfirmBulk = document.getElementById('btn-confirm-route-bulk');
  const csvDropzone = document.getElementById('csv-route-dropzone');
  const csvFileInput = document.getElementById('csv-route-input');
  
  let parsedRoutes = [];

  btnBulkUpload.addEventListener('click', () => {
    parsedRoutes = [];
    btnConfirmBulk.disabled = true;
    document.getElementById('csv-route-preview-container').classList.add('hidden');
    document.getElementById('csv-route-preview-body').innerHTML = '';
    
    bulkModal.classList.remove('pointer-events-none', 'opacity-0');
    bulkModal.querySelector('.modal-window').classList.remove('scale-95');
  });

  const closeBulkModal = () => {
    bulkModal.classList.add('pointer-events-none', 'opacity-0');
    bulkModal.querySelector('.modal-window').classList.add('scale-95');
  };
  btnCloseBulk.addEventListener('click', closeBulkModal);
  btnCancelBulk.addEventListener('click', closeBulkModal);

  csvDropzone.addEventListener('click', () => csvFileInput.click());

  csvDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvDropzone.classList.add('border-primary', 'bg-primary-container/[0.04]');
  });
  csvDropzone.addEventListener('dragleave', () => {
    csvDropzone.classList.remove('border-primary', 'bg-primary-container/[0.04]');
  });
  csvDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDropzone.classList.remove('border-primary', 'bg-primary-container/[0.04]');
    if (e.dataTransfer.files.length > 0) {
      handleCsvRouteFile(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleCsvRouteFile(e.target.files[0]);
    }
  });

  function handleCsvRouteFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const text = e.target.result;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        showAlert('El archivo CSV está vacío o no tiene el formato correcto.', 'error');
        return;
      }
      
      const db = getDatabase();
      parsedRoutes = [];
      const previewBody = document.getElementById('csv-route-preview-body');
      previewBody.innerHTML = '';
      
      rows.forEach(row => {
        const codigo = (row.codigo || '').toUpperCase().replace(/\s+/g, '');
        const origen = row.origen || '';
        const destino = row.destino || '';
        const region = row.region || 'Metropolitana';
        const tipo = row.tipo || 'Comuna';
        const km = Number(row.km || 0);

        // Resolver el nombre del CD a su ID (relación por ID)
        const originCd = db.logisticsCentres.find(c =>
          c.nombre.trim().toLowerCase() === origen.trim().toLowerCase()
        );

        let error = '';
        if (!codigo) error = 'Falta Código';
        else if (!origen) error = 'Falta Origen';
        else if (!originCd) error = 'Origen no existe';
        else if (!destino) error = 'Falta Destino';
        else if (isNaN(km) || km <= 0) error = 'Distancia inválida';
        else if (db.routes.some(r => r.codigo === codigo)) error = 'Código Duplicado';
        
        const tr = document.createElement('tr');
        tr.className = "border-b border-outline-variant";
        tr.innerHTML = `
          <td class="p-sm font-data-mono">${codigo}</td>
          <td class="p-sm">${origen}</td>
          <td class="p-sm">${destino}</td>
          <td class="p-sm font-bold">${km} KM</td>
          <td class="p-sm">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${error ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
              ${error ? error : 'Listo'}
            </span>
          </td>
        `;
        previewBody.appendChild(tr);

        if (!error) {
          const caractCsv = (row.caracteristica || 'NORMAL').toUpperCase();
          parsedRoutes.push({
            codigo,
            origenId: originCd.id,
            destino,
            denominacion: row.denominacion ? row.denominacion.trim() : `${originCd.nombre} - ${destino}`,
            region,
            tipo,
            caracteristica: ['NORMAL', 'EXTREMA', 'ISLA'].includes(caractCsv) ? caractCsv : 'NORMAL',
            km,
            activo: true
          });
        }
      });

      document.getElementById('csv-route-count').innerText = rows.length;
      document.getElementById('csv-route-preview-container').classList.remove('hidden');
      
      if (parsedRoutes.length > 0) {
        btnConfirmBulk.disabled = false;
      } else {
        showAlert('No se encontraron registros de rutas válidos.', 'error');
      }
    };
    reader.readAsText(file);
  }

  btnConfirmBulk.addEventListener('click', () => {
    const db = getDatabase();
    
    parsedRoutes.forEach(r => {
      r.id = 'r' + (new Date().getTime() + Math.random().toString(36).substr(2, 5));
      db.routes.push(r);
    });

    saveDatabase(db);
    showAlert(`Se importaron ${parsedRoutes.length} rutas correctamente.`);
    closeBulkModal();
    renderRoutesView(container);
  });
}

function renderRoutesTable(routesList) {
  const tbody = document.getElementById('routes-table-body');
  if (!tbody) return;

  if (routesList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-xl text-center text-secondary">
          No se encontraron rutas registradas.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  const dbForNames = getDatabase();
  routesList.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant hover:bg-surface-container-low transition-colors";

    const statusBg = r.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';

    tr.innerHTML = `
      <td class="p-md font-bold text-primary font-data-mono">${r.codigo}</td>
      <td class="p-md text-xs">${r.denominacion || `${getCentreName(dbForNames, r.origenId)} - ${r.destino}`}</td>
      <td class="p-md font-bold">${getCentreName(dbForNames, r.origenId)}</td>
      <td class="p-md">${r.destino}</td>
      <td class="p-md text-xs text-secondary">${r.region}</td>
      <td class="p-md"><span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded text-xs">${r.tipo}</span></td>
      <td class="p-md"><span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${CARACT_STYLES[r.caracteristica || 'NORMAL']}">${r.caracteristica || 'NORMAL'}</span></td>
      <td class="p-md font-bold font-data-mono">${r.km} KM</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusBg}">
          ${r.activo ? 'ACTIVO' : 'DE BAJA'}
        </span>
      </td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          <button class="btn-edit text-secondary hover:text-primary p-xs cursor-pointer" data-id="${r.id}" title="Editar ruta">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button class="btn-toggle text-secondary hover:text-primary p-xs cursor-pointer" data-id="${r.id}" title="${r.activo ? 'Dar de baja' : 'Activar'}">
            <span class="material-symbols-outlined text-[20px] ${r.activo ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}">
              ${r.activo ? 'block' : 'check_circle'}
            </span>
          </button>
          <button class="btn-delete-route text-secondary hover:text-red-700 p-xs cursor-pointer" data-id="${r.id}" title="Eliminar ruta">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const r = db.routes.find(item => item.id === id);
      
      if (r) {
        editingRouteId = id;
        document.getElementById('r-codigo').value = r.codigo;
        document.getElementById('r-origen').value = r.origenId;
        document.getElementById('r-destino').value = r.destino;
        document.getElementById('r-denominacion').value = r.denominacion || `${getCentreName(db, r.origenId)} - ${r.destino}`;
        document.getElementById('r-region').value = r.region;
        document.getElementById('r-tipo').value = r.tipo;
        document.getElementById('r-caracteristica').value = r.caracteristica || 'NORMAL';
        document.getElementById('r-km').value = r.km;

        document.getElementById('route-modal-title').innerText = 'Editar Ruta';
        
        const modal = document.getElementById('route-modal');
        modal.classList.remove('pointer-events-none', 'opacity-0');
        modal.querySelector('.modal-window').classList.remove('scale-95');
      }
    });
  });

  tbody.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const idx = db.routes.findIndex(item => item.id === id);

      if (idx !== -1) {
        const r = db.routes[idx];
        r.activo = !r.activo;
        saveDatabase(db);
        showAlert(`La ruta ${r.codigo} ha sido ${r.activo ? 'activada' : 'dada de baja'}.`);
        renderRoutesView(document.getElementById('stage-area'));
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-route').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const idx = db.routes.findIndex(item => item.id === id);

      if (idx !== -1) {
        const r = db.routes[idx];
        if (!confirm(`¿Eliminar la ruta ${r.codigo} (${r.denominacion || r.destino})? Esta acción no se puede deshacer.`)) return;
        db.routes.splice(idx, 1);
        saveDatabase(db);
        showAlert(`La ruta ${r.codigo} ha sido eliminada.`);
        renderRoutesView(document.getElementById('stage-area'));
      }
    });
  });
}
