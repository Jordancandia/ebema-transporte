import { getDatabase, saveDatabase, calcEjes } from './data.js';
import { formatRut, validateRut, generateSapCode, parseCSV, showAlert } from './utils.js';
import { renderFichaTransporte } from './ficha-transporte.js';

let editingTransportId = null;

// Suma la capacidad (Tons) de los camiones de los transportistas activos,
// opcionalmente filtrado por centro logístico (centrosServicio)
function computeFleetCapacity(transports, centroId) {
  return transports
    .filter(t => t.activo && (!centroId || (t.centrosServicio || []).includes(centroId)))
    .reduce((acc, t) => acc + (t.camiones || []).reduce((a, c) => a + Number(c.capacidad || 0), 0), 0);
}

export function renderTransportsView(container) {
  const db = getDatabase();
  const transports = db.transports;
  const cds = db.logisticsCentres;

  // Calcular KPIs
  const totalTransports = transports.length;
  const activeTransports = transports.filter(t => t.activo).length;
  const inactiveTransports = totalTransports - activeTransports;
  const totalCapacity = computeFleetCapacity(transports, '');

  container.innerHTML = `
    <!-- Page Header -->
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administración de Transportistas</h1>
      <p class="font-body-lg text-body-lg text-secondary">Configure y controle las empresas transportistas, su capacidad en toneladas, contacto corporativo y estado operativo.</p>
    </div>

    <!-- Tarjetas de Estadísticas KPI -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Transportes</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${totalTransports}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">commute</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Activos (En Flota)</h4>
          <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${activeTransports}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded border-l-4 border-primary flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Capacidad Flota</h4>
          <div class="font-headline-md text-headline-md font-bold text-primary mt-1" id="kpi-capacidad-flota">${totalCapacity} Ton</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-primary">analytics</span>
      </div>
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">De Baja</h4>
          <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${inactiveTransports}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-red-500">cancel</span>
      </div>
    </div>

    <!-- Tabla de Transportistas -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <!-- Barra superior de filtros -->
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto flex-1">
          <div class="relative w-full md:w-96 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="transport-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Razón Social, RUT, SAP, Patente...">
          </div>
          <select id="transport-centro-filter" class="w-full md:w-64 bg-surface-container-low border-none px-md py-xs font-body-md text-body-md focus:outline-none rounded">
            <option value="">Todos los centros</option>
            ${cds.map(cd => `<option value="${cd.id}">${cd.nombre}</option>`).join('')}
          </select>
        </div>

        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-bulk-upload-transports" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">upload_file</span>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-transport" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
            <span class="material-symbols-outlined text-[18px]">add</span>
            Nuevo Transportista
          </button>
        </div>
      </div>

      <!-- Tabla Responsiva -->
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">Código SAP</th>
              <th class="p-md">Razón Social</th>
              <th class="p-md">RUT</th>
              <th class="p-md">Camiones</th>
              <th class="p-md">Contacto</th>
              <th class="p-md">Estado</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="transports-table-body" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="transport-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 id="transport-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Nuevo Transportista</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-transport-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="transport-form">
          <div class="p-lg space-y-md max-h-[70vh] overflow-y-auto">
            <div class="space-y-xs">
              <label for="t-razonsocial" class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
              <input type="text" id="t-razonsocial" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej. Transportes Ebema Express">
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="t-rut" class="font-label-caps text-label-caps text-secondary block">RUT EMPRESA</label>
                <input type="text" id="t-rut" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: 76.849.201-3">
                <div id="t-rut-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> RUT bloqueado (no editable)
                </div>
              </div>
              <div class="space-y-xs">
                <label for="t-patente" class="font-label-caps text-label-caps text-secondary block">PATENTE CAMIÓN</label>
                <input type="text" id="t-patente" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: AA-BB-11">
                <div id="t-patente-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> Patente bloqueada (no editable)
                </div>
              </div>
            </div>

            <div class="space-y-xs">
              <label for="t-codigosap" class="font-label-caps text-label-caps text-secondary block">CÓDIGO SAP</label>
              <input type="text" id="t-codigosap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Auto-generado">
              <div id="t-sap-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                <span class="material-symbols-outlined text-[12px]">lock</span> Código SAP bloqueado (no editable)
              </div>
            </div>
            <p class="text-[11px] text-secondary -mt-xs">La capacidad y el tipo de eje de cada camión se registran en el detalle de la Ficha de Transporte (Camiones).</p>

            <div class="pt-sm border-t border-outline-variant">
              <h5 class="font-label-caps text-label-caps text-primary mb-md">Datos de Contacto (Editables)</h5>
              
              <div class="space-y-md">
                <div class="space-y-xs">
                  <label for="t-direccion" class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN COMERCIAL</label>
                  <input type="text" id="t-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej. Calle Principal 456, Maipú">
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
                  <div class="space-y-xs">
                    <label for="t-telefono" class="font-label-caps text-label-caps text-secondary block">TELÉFONO DE CONTACTO</label>
                    <input type="text" id="t-telefono" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: +56 9 8888 7777">
                  </div>
                  <div class="space-y-xs">
                    <label for="t-email" class="font-label-caps text-label-caps text-secondary block">CORREO ELECTRÓNICO</label>
                    <input type="email" id="t-email" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: contacto@empresa.cl">
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-transport-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer">Guardar Transportista</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Transportistas</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Sube un archivo delimitado por punto y coma (<code>;</code>) o comas (<code>,</code>). Los encabezados exactos del archivo deben ser:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">
              razonSocial;rut;direccion;telefono;email;patente;capacidad
            </code>
          </p>
          
          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-sm" id="csv-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu archivo CSV aquí o haz clic para buscar</span>
            <input type="file" id="csv-file-input" accept=".csv" class="hidden">
          </div>

          <div id="csv-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa de Registros (<span id="csv-count">0</span>):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Razón Social</th>
                    <th class="p-sm">RUT</th>
                    <th class="p-sm">Patente</th>
                    <th class="p-sm">Capacidad</th>
                    <th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-preview-body">
                  <!-- Dinámico -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-confirm-bulk" disabled>Importar registros</button>
        </div>
      </div>
    </div>
  `;

  // Renderizar tabla
  renderTransportsTable(transports);

  // --- CONFIGURACIÓN DE EVENTOS ---
  const searchInput = document.getElementById('transport-search');
  const centroFilter = document.getElementById('transport-centro-filter');
  const kpiCapacidad = document.getElementById('kpi-capacidad-flota');

  const applyFilters = () => {
    const term = searchInput.value.toLowerCase();
    const centroId = centroFilter.value;

    const filtered = transports.filter(t => {
      const matchesTerm = !term ||
        t.razonSocial.toLowerCase().includes(term) ||
        t.rut.toLowerCase().includes(term) ||
        t.patente.toLowerCase().includes(term) ||
        t.codigoSap.toLowerCase().includes(term);
      const matchesCentro = !centroId || (t.centrosServicio || []).includes(centroId);
      return matchesTerm && matchesCentro;
    });

    renderTransportsTable(filtered);
    kpiCapacidad.textContent = `${computeFleetCapacity(transports, centroId)} Ton`;
  };

  searchInput.addEventListener('input', applyFilters);
  centroFilter.addEventListener('change', applyFilters);

  const transportModal = document.getElementById('transport-modal');
  const btnCreateTransport = document.getElementById('btn-create-transport');
  const btnCloseModal = document.getElementById('btn-close-transport-modal');
  const btnCancelModal = document.getElementById('btn-cancel-transport-modal');
  const transportForm = document.getElementById('transport-form');

  btnCreateTransport.addEventListener('click', () => {
    editingTransportId = null;
    transportForm.reset();
    document.getElementById('transport-modal-title').innerText = 'Nuevo Transportista';
    setLockFields(false);
    
    const activeDb = getDatabase();
    document.getElementById('t-codigosap').value = generateSapCode('TRSP', activeDb.transports, 'codigoSap');
    
    // Abrir con animación
    transportModal.classList.remove('pointer-events-none', 'opacity-0');
    transportModal.querySelector('.modal-window').classList.remove('scale-95');
  });

  const closeFormModal = () => {
    transportModal.classList.add('pointer-events-none', 'opacity-0');
    transportModal.querySelector('.modal-window').classList.add('scale-95');
  };
  btnCloseModal.addEventListener('click', closeFormModal);
  btnCancelModal.addEventListener('click', closeFormModal);

  const rutInput = document.getElementById('t-rut');
  rutInput.addEventListener('blur', (e) => {
    e.target.value = formatRut(e.target.value);
  });

  transportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const db = getDatabase();
    const rutVal = document.getElementById('t-rut').value;
    
    if (!editingTransportId && !validateRut(rutVal)) {
      showAlert('El RUT ingresado no es válido.', 'error');
      return;
    }

    const transportData = {
      razonSocial: document.getElementById('t-razonsocial').value,
      rut: rutVal,
      patente: document.getElementById('t-patente').value.toUpperCase().replace(/\s+/g, ''),
      codigoSap: document.getElementById('t-codigosap').value.toUpperCase(),
      direccion: document.getElementById('t-direccion').value,
      telefono: document.getElementById('t-telefono').value,
      email: document.getElementById('t-email').value,
      // El correo de contacto enlaza el camión con la cuenta del proveedor (Portal Proveedores)
      ownerEmail: document.getElementById('t-email').value.trim().toLowerCase(),
      activo: editingTransportId ? db.transports.find(t => t.id === editingTransportId).activo : true
    };

    if (editingTransportId) {
      const index = db.transports.findIndex(t => t.id === editingTransportId);
      if (index !== -1) {
        const original = db.transports[index];
        db.transports[index] = {
          ...original,
          razonSocial: transportData.razonSocial,
          direccion: transportData.direccion,
          telefono: transportData.telefono,
          email: transportData.email,
          ownerEmail: transportData.ownerEmail
        };
        saveDatabase(db);
        showAlert('Transportista actualizado correctamente');
      }
    } else {
      if (db.transports.some(t => t.rut === transportData.rut)) {
        showAlert('El RUT ingresado ya está registrado.', 'error');
        return;
      }
      if (db.transports.some(t => t.patente === transportData.patente)) {
        showAlert('La Patente ingresada ya está registrada.', 'error');
        return;
      }
      if (db.transports.some(t => t.codigoSap === transportData.codigoSap)) {
        showAlert('El Código SAP ya está en uso.', 'error');
        return;
      }

      transportData.id = 't' + (new Date().getTime());
      // Estructura multi-camión: el camión inicial se crea con la patente del formulario.
      // La capacidad y el tipo de eje se completan luego en la Ficha de Transporte (Camiones).
      const capacidadInicial = 10;
      transportData.camiones = [{
        id: 'c' + transportData.id,
        patente: transportData.patente,
        modelo: '',
        anio: 2020,
        capacidad: capacidadInicial,
        ejes: calcEjes(capacidadInicial),
        dimensiones: { largo: 0, ancho: 0, alto: 0 },
        documentos: {},
        choferRut: ''
      }];
      transportData.choferes = [];
      transportData.centrosServicio = [];
      db.transports.push(transportData);
      saveDatabase(db);
      showAlert('Transportista registrado con éxito');
    }

    closeFormModal();
    renderTransportsView(container);
  });

  // --- CARGA MASIVA DE TRASPORTISTAS ---
  const bulkModal = document.getElementById('bulk-upload-modal');
  const btnBulkUpload = document.getElementById('btn-bulk-upload-transports');
  const btnCloseBulk = document.getElementById('btn-close-bulk-modal');
  const btnCancelBulk = document.getElementById('btn-cancel-bulk');
  const btnConfirmBulk = document.getElementById('btn-confirm-bulk');
  const csvDropzone = document.getElementById('csv-dropzone');
  const csvFileInput = document.getElementById('csv-file-input');
  
  let parsedTransports = [];

  btnBulkUpload.addEventListener('click', () => {
    parsedTransports = [];
    btnConfirmBulk.disabled = true;
    document.getElementById('csv-preview-container').classList.add('hidden');
    document.getElementById('csv-preview-body').innerHTML = '';
    
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
      handleCsvFile(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleCsvFile(e.target.files[0]);
    }
  });

  function handleCsvFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const text = e.target.result;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        showAlert('El archivo CSV está vacío o no tiene el formato correcto.', 'error');
        return;
      }
      
      const db = getDatabase();
      parsedTransports = [];
      const previewBody = document.getElementById('csv-preview-body');
      previewBody.innerHTML = '';
      
      rows.forEach(row => {
        const razonSocial = row.razonSocial || '';
        let rut = formatRut(row.rut || '');
        const direccion = row.direccion || '';
        const telefono = row.telefono || '';
        const email = row.email || '';
        const patente = (row.patente || '').toUpperCase().replace(/\s+/g, '');
        const capacidad = Number(row.capacidad || 10);
        
        let error = '';
        if (!razonSocial) error = 'Falta Razón Social';
        else if (!validateRut(rut)) error = 'RUT inválido';
        else if (!patente || patente.length < 5) error = 'Patente incorrecta';
        else if (db.transports.some(t => t.rut === rut)) error = 'RUT Duplicado';
        else if (db.transports.some(t => t.patente === patente)) error = 'Patente Duplicada';
        
        const tr = document.createElement('tr');
        tr.className = "border-b border-outline-variant";
        tr.innerHTML = `
          <td class="p-sm">${razonSocial}</td>
          <td class="p-sm font-data-mono">${rut}</td>
          <td class="p-sm font-data-mono">${patente}</td>
          <td class="p-sm font-bold">${capacidad} Ton</td>
          <td class="p-sm">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${error ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
              ${error ? error : 'Listo'}
            </span>
          </td>
        `;
        previewBody.appendChild(tr);

        if (!error) {
          parsedTransports.push({
            razonSocial,
            rut,
            direccion,
            telefono,
            email,
            patente,
            capacidad,
            activo: true
          });
        }
      });

      document.getElementById('csv-count').innerText = rows.length;
      document.getElementById('csv-preview-container').classList.remove('hidden');
      
      if (parsedTransports.length > 0) {
        btnConfirmBulk.disabled = false;
      } else {
        showAlert('No hay registros válidos para importar.', 'error');
      }
    };
    reader.readAsText(file);
  }

  btnConfirmBulk.addEventListener('click', () => {
    const db = getDatabase();
    
    parsedTransports.forEach(t => {
      t.id = 't' + (new Date().getTime() + Math.random().toString(36).substr(2, 5));
      t.codigoSap = generateSapCode('TRSP', db.transports, 'codigoSap');
      db.transports.push(t);
    });

    saveDatabase(db);
    showAlert(`Se cargaron exitosamente ${parsedTransports.length} transportistas.`);
    closeBulkModal();
    renderTransportsView(container);
  });
}

function setLockFields(isEdit) {
  const rutInput = document.getElementById('t-rut');
  const patenteInput = document.getElementById('t-patente');
  const sapInput = document.getElementById('t-codigosap');
  
  const rutMsg = document.getElementById('t-rut-lock-msg');
  const patenteMsg = document.getElementById('t-patente-lock-msg');
  const sapMsg = document.getElementById('t-sap-lock-msg');

  if (isEdit) {
    rutInput.disabled = true;
    patenteInput.disabled = true;
    sapInput.disabled = true;
    
    rutInput.className = "w-full border border-outline-variant p-sm font-body-md text-body-md rounded bg-[#E9ECEF] text-secondary cursor-not-allowed";
    patenteInput.className = "w-full border border-outline-variant p-sm font-body-md text-body-md rounded bg-[#E9ECEF] text-secondary cursor-not-allowed";
    sapInput.className = "w-full border border-outline-variant p-sm font-body-md text-body-md rounded bg-[#E9ECEF] text-secondary cursor-not-allowed";

    rutMsg.classList.remove('hidden');
    rutMsg.classList.add('flex');
    patenteMsg.classList.remove('hidden');
    patenteMsg.classList.add('flex');
    sapMsg.classList.remove('hidden');
    sapMsg.classList.add('flex');
  } else {
    rutInput.disabled = false;
    patenteInput.disabled = false;
    sapInput.disabled = false;

    rutInput.className = "w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white";
    patenteInput.className = "w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white";
    sapInput.className = "w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white";

    rutMsg.classList.add('hidden');
    rutMsg.classList.remove('flex');
    patenteMsg.classList.add('hidden');
    patenteMsg.classList.remove('flex');
    sapMsg.classList.add('hidden');
    sapMsg.classList.remove('flex');
  }
}

function renderTransportsTable(transportsList) {
  const tbody = document.getElementById('transports-table-body');
  if (!tbody) return;

  if (transportsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-xl text-center text-secondary">
          No se encontraron transportistas registrados en la base de datos.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  transportsList.forEach(t => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-outline-variant hover:bg-surface-container-low transition-colors";
    
    const statusBg = t.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';

    tr.innerHTML = `
      <td class="p-md font-bold text-primary font-data-mono">${t.codigoSap}</td>
      <td class="p-md font-bold">${t.razonSocial}</td>
      <td class="p-md font-data-mono">${t.rut}</td>
      <td class="p-md"><span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded font-data-mono text-xs">${(t.camiones || []).length} camión${(t.camiones || []).length === 1 ? '' : 'es'}</span></td>
      <td class="p-md">
        <div class="text-xs font-bold leading-tight">${t.email}</div>
        <div class="text-[10px] text-secondary">${t.telefono}</div>
      </td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusBg}">
          ${t.activo ? 'ACTIVO' : 'DE BAJA'}
        </span>
      </td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          <button class="btn-ficha text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="Ver ficha de transporte">
            <span class="material-symbols-outlined text-[20px]">folder_open</span>
          </button>
          <button class="btn-edit text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="Editar contacto">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button class="btn-toggle text-secondary hover:text-primary p-xs cursor-pointer" data-id="${t.id}" title="${t.activo ? 'Dar de baja' : 'Activar'}">
            <span class="material-symbols-outlined text-[20px] ${t.activo ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}">
              ${t.activo ? 'block' : 'check_circle'}
            </span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Evento ver ficha
  tbody.querySelectorAll('.btn-ficha').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const stage = document.getElementById('stage-area');
      const pageTitle = document.getElementById('current-page-title');
      if (pageTitle) pageTitle.textContent = 'Ficha de Transporte';
      renderFichaTransporte(stage, id);
    });
  });

  // Evento editar
  tbody.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const t = db.transports.find(item => item.id === id);
      
      if (t) {
        editingTransportId = id;
        document.getElementById('t-razonsocial').value = t.razonSocial;
        document.getElementById('t-rut').value = t.rut;
        document.getElementById('t-patente').value = t.patente;
        document.getElementById('t-codigosap').value = t.codigoSap;
        document.getElementById('t-direccion').value = t.direccion;
        document.getElementById('t-telefono').value = t.telefono;
        document.getElementById('t-email').value = t.email;

        document.getElementById('transport-modal-title').innerText = 'Editar Datos de Contacto';
        setLockFields(true);

        const modal = document.getElementById('transport-modal');
        modal.classList.remove('pointer-events-none', 'opacity-0');
        modal.querySelector('.modal-window').classList.remove('scale-95');
      }
    });
  });

  // Evento activar/desactivar
  tbody.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const idx = db.transports.findIndex(item => item.id === id);
      
      if (idx !== -1) {
        const t = db.transports[idx];
        t.activo = !t.activo;
        saveDatabase(db);
        showAlert(`Transportista ${t.razonSocial} ha sido ${t.activo ? 'activado' : 'dado de baja'}.`);
        renderTransportsView(document.getElementById('stage-area'));
      }
    });
  });
}
