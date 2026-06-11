import { getDatabase, saveDatabase } from './data.js';
import { formatRut, validateRut, generateSapCode, parseCSV, showAlert } from './utils.js';

let editingTransportId = null;

// Renderizar la vista principal de Transportistas
export function renderTransportsView(container) {
  const db = getDatabase();
  const transports = db.transports;
  
  // Calcular KPIs
  const totalTransports = transports.length;
  const activeTransports = transports.filter(t => t.activo).length;
  const inactiveTransports = totalTransports - activeTransports;
  const totalCapacity = transports.reduce((acc, t) => acc + (t.activo ? Number(t.capacidad) : 0), 0);

  container.innerHTML = `
    <!-- Tarjetas de Estadísticas KPI -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>Total Transportistas</h4>
          <div class="kpi-value" id="kpi-transports-total">${totalTransports}</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>Activos (En Servicio)</h4>
          <div class="kpi-value" id="kpi-transports-active">${activeTransports}</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-info">
          <h4>Capacidad Activa (Tons)</h4>
          <div class="kpi-value" id="kpi-transports-capacity">${totalCapacity} Ton</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>De Baja</h4>
          <div class="kpi-value" id="kpi-transports-inactive">${inactiveTransports}</div>
        </div>
        <div class="kpi-icon" style="color: var(--state-error)">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
    </div>

    <!-- Barra de Filtros y Tabla -->
    <div class="table-container-card">
      <div class="table-header-bar">
        <div class="search-input-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" id="transport-search" class="form-control" placeholder="Buscar por Razón Social, RUT, SAP, Patente...">
        </div>
        
        <div class="action-buttons-group">
          <button id="btn-bulk-upload-transports" class="btn-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-transport" class="btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Transportista
          </button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Cód SAP</th>
              <th>Razón Social</th>
              <th>RUT</th>
              <th>Patente</th>
              <th>Capacidad</th>
              <th>Contacto</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="transports-table-body">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay" id="transport-modal">
      <div class="modal-window">
        <div class="modal-header">
          <h4 id="transport-modal-title">Nuevo Transportista</h4>
          <button class="modal-close-btn" id="btn-close-transport-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="transport-form">
          <div class="modal-body">
            <div class="form-group">
              <label for="t-razonsocial">Razón Social</label>
              <input type="text" id="t-razonsocial" class="form-control" required placeholder="Ej. Transportes Ebema Express">
            </div>
            
            <div class="form-grid-2">
              <div class="form-group">
                <label for="t-rut">RUT Empresa</label>
                <input type="text" id="t-rut" class="form-control" required placeholder="Ej: 76.849.201-3">
                <div id="t-rut-lock-msg" class="locked-indicator" style="display: none;">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg> RUT no editable tras la creación
                </div>
              </div>
              <div class="form-group">
                <label for="t-patente">Patente Camión</label>
                <input type="text" id="t-patente" class="form-control" required placeholder="Ej: AA-BB-11 o AABB11">
                <div id="t-patente-lock-msg" class="locked-indicator" style="display: none;">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg> Patente no editable tras la creación
                </div>
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label for="t-capacidad">Tipo de Camión / Capacidad</label>
                <select id="t-capacidad" class="form-control" required>
                  <option value="10">Sencillo (10 Tons)</option>
                  <option value="15">Doble Puente (15 Tons)</option>
                  <option value="28">Rampla (28 Tons)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="t-codigosap">Código SAP</label>
                <input type="text" id="t-codigosap" class="form-control" required placeholder="Auto-generado">
                <div id="t-sap-lock-msg" class="locked-indicator" style="display: none;">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg> Código SAP no editable tras la creación
                </div>
              </div>
            </div>

            <h5 style="margin: 20px 0 10px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 5px; color: var(--brand-primary-hover)">Datos de Contacto (Editables)</h5>

            <div class="form-group">
              <label for="t-direccion">Dirección Comercial</label>
              <input type="text" id="t-direccion" class="form-control" required placeholder="Ej. Calle Principal 456, Maipú">
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label for="t-telefono">Teléfono de Contacto</label>
                <input type="text" id="t-telefono" class="form-control" required placeholder="Ej: +56 9 8888 7777">
              </div>
              <div class="form-group">
                <label for="t-email">Correo Electrónico</label>
                <input type="email" id="t-email" class="form-control" required placeholder="Ej: contacto@empresa.cl">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-transport-modal">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar Transportista</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay" id="bulk-upload-modal">
      <div class="modal-window" style="width: 700px;">
        <div class="modal-header">
          <h4>Carga Masiva de Transportistas</h4>
          <button class="modal-close-btn" id="btn-close-bulk-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="color: var(--text-muted); font-size: 13.5px; margin-bottom: 15px;">
            Sube un archivo de texto plano separado por comas o punto y coma (.csv). El archivo debe contener los siguientes encabezados exactos:
            <code style="display:block; padding: 10px; background-color: var(--bg-primary); border-radius: 4px; margin-top: 5px; color: var(--brand-secondary);">
              razonSocial;rut;direccion;telefono;email;patente;capacidad
            </code>
          </p>
          
          <div class="csv-upload-area" id="csv-dropzone">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span>Arrastra tu archivo CSV aquí o haz clic para buscar</span>
            <input type="file" id="csv-file-input" accept=".csv" style="display: none;">
          </div>

          <div id="csv-preview-container" style="display: none; margin-top: 20px;">
            <h5 style="margin-bottom: 10px; font-weight: 600;">Vista Previa de Registros Detectados (<span id="csv-count">0</span>):</h5>
            <div class="csv-preview-table-container">
              <table class="csv-preview-table">
                <thead>
                  <tr>
                    <th>Razón Social</th>
                    <th>RUT</th>
                    <th>Patente</th>
                    <th>Capacidad</th>
                    <th>Estatus</th>
                  </tr>
                </thead>
                <tbody id="csv-preview-body">
                  <!-- Inyectado dinámicamente -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="btn-cancel-bulk">Cancelar</button>
          <button class="btn-primary" id="btn-confirm-bulk" disabled>Procesar e Importar</button>
        </div>
      </div>
    </div>
  `;

  // Renderizar la tabla inicial
  renderTransportsTable(transports);

  // --- CONFIGURACIÓN DE EVENTOS DE LA VISTA ---

  // 1. Buscador en tiempo real
  const searchInput = document.getElementById('transport-search');
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = transports.filter(t => 
      t.razonSocial.toLowerCase().includes(term) ||
      t.rut.toLowerCase().includes(term) ||
      t.patente.toLowerCase().includes(term) ||
      t.codigoSap.toLowerCase().includes(term)
    );
    renderTransportsTable(filtered);
  });

  // 2. Control de Modales
  const transportModal = document.getElementById('transport-modal');
  const btnCreateTransport = document.getElementById('btn-create-transport');
  const btnCloseModal = document.getElementById('btn-close-transport-modal');
  const btnCancelModal = document.getElementById('btn-cancel-transport-modal');
  const transportForm = document.getElementById('transport-form');

  // Abrir formulario para Crear
  btnCreateTransport.addEventListener('click', () => {
    editingTransportId = null;
    transportForm.reset();
    document.getElementById('transport-modal-title').innerText = 'Nuevo Transportista';
    
    // Habilitar campos bloqueables
    setLockFields(false);

    // Sugerir Código SAP
    const activeDb = getDatabase();
    document.getElementById('t-codigosap').value = generateSapCode('TRSP', activeDb.transports, 'codigoSap');

    transportModal.classList.add('active');
  });

  // Cerrar modales
  const closeFormModal = () => {
    transportModal.classList.remove('active');
  };
  btnCloseModal.addEventListener('click', closeFormModal);
  btnCancelModal.addEventListener('click', closeFormModal);

  // Formatear RUT al escribir
  const rutInput = document.getElementById('t-rut');
  rutInput.addEventListener('blur', (e) => {
    e.target.value = formatRut(e.target.value);
  });

  // Envío del Formulario (Guardar / Editar)
  transportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const db = getDatabase();
    const rutVal = document.getElementById('t-rut').value;
    
    // Solo validar RUT al crear (ya que al editar está bloqueado)
    if (!editingTransportId && !validateRut(rutVal)) {
      showAlert('El RUT ingresado no es válido.', 'error');
      return;
    }

    const transportData = {
      razonSocial: document.getElementById('t-razonsocial').value,
      rut: rutVal,
      patente: document.getElementById('t-patente').value.toUpperCase().replace(/\s+/g, ''),
      capacidad: Number(document.getElementById('t-capacidad').value),
      codigoSap: document.getElementById('t-codigosap').value.toUpperCase(),
      direccion: document.getElementById('t-direccion').value,
      telefono: document.getElementById('t-telefono').value,
      email: document.getElementById('t-email').value,
      activo: editingTransportId ? db.transports.find(t => t.id === editingTransportId).activo : true
    };

    if (editingTransportId) {
      // Editar existente
      const index = db.transports.findIndex(t => t.id === editingTransportId);
      if (index !== -1) {
        // Combinamos manteniendo los campos bloqueados inalterables por seguridad
        const original = db.transports[index];
        db.transports[index] = {
          ...original,
          razonSocial: transportData.razonSocial,
          capacidad: transportData.capacidad,
          direccion: transportData.direccion,
          telefono: transportData.telefono,
          email: transportData.email
        };
        saveDatabase(db);
        showAlert('Transportista actualizado correctamente');
      }
    } else {
      // Validar duplicados de RUT, Patente o Código SAP al crear nuevo
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

      // Crear nuevo
      transportData.id = 't' + (new Date().getTime());
      db.transports.push(transportData);
      saveDatabase(db);
      showAlert('Transportista registrado con éxito');
    }

    closeFormModal();
    // Forzar actualización total de la vista
    renderTransportsView(container);
  });

  // --- CARGA MASIVA (EVENTOS) ---
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
    document.getElementById('csv-preview-container').style.display = 'none';
    document.getElementById('csv-preview-body').innerHTML = '';
    bulkModal.classList.add('active');
  });

  const closeBulkModal = () => {
    bulkModal.classList.remove('active');
  };
  btnCloseBulk.addEventListener('click', closeBulkModal);
  btnCancelBulk.addEventListener('click', closeBulkModal);

  // Activar buscador de archivos al hacer clic en la zona
  csvDropzone.addEventListener('click', () => csvFileInput.click());

  // Drag and drop
  csvDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvDropzone.classList.add('drag-over');
  });
  csvDropzone.addEventListener('dragleave', () => {
    csvDropzone.classList.remove('drag-over');
  });
  csvDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDropzone.classList.remove('drag-over');
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
      
      rows.forEach((row, idx) => {
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
        else if (db.transports.some(t => t.rut === rut)) error = 'RUT Duplicado en BD';
        else if (db.transports.some(t => t.patente === patente)) error = 'Patente Duplicada en BD';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${razonSocial}</td>
          <td>${rut}</td>
          <td>${patente}</td>
          <td>${capacidad} Ton</td>
          <td>
            <span class="status-pill ${error ? 'inactive' : 'active'}">
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
      document.getElementById('csv-preview-container').style.display = 'block';
      
      if (parsedTransports.length > 0) {
        btnConfirmBulk.disabled = false;
      } else {
        showAlert('No se encontraron registros válidos para importar.', 'error');
      }
    };
    reader.readAsText(file);
  }

  // Confirmar Carga Masiva
  btnConfirmBulk.addEventListener('click', () => {
    const db = getDatabase();
    
    // Asignar códigos SAP automáticos a los nuevos
    parsedTransports.forEach(t => {
      t.id = 't' + (new Date().getTime() + Math.random().toString(36).substr(2, 5));
      t.codigoSap = generateSapCode('TRSP', db.transports, 'codigoSap');
      db.transports.push(t);
    });

    saveDatabase(db);
    showAlert(`Se importaron ${parsedTransports.length} transportistas exitosamente.`);
    closeBulkModal();
    renderTransportsView(container);
  });
}

// Establecer campos de RUT, Patente y Código SAP como editables o bloqueados
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
    
    rutInput.classList.add('field-locked');
    patenteInput.classList.add('field-locked');
    sapInput.classList.add('field-locked');

    rutMsg.style.display = 'flex';
    patenteMsg.style.display = 'flex';
    sapMsg.style.display = 'flex';
  } else {
    rutInput.disabled = false;
    patenteInput.disabled = false;
    sapInput.disabled = false;

    rutInput.classList.remove('field-locked');
    patenteInput.classList.remove('field-locked');
    sapInput.classList.remove('field-locked');

    rutMsg.style.display = 'none';
    patenteMsg.style.display = 'none';
    sapMsg.style.display = 'none';
  }
}

// Renderizar la tabla de transportistas
function renderTransportsTable(transportsList) {
  const tbody = document.getElementById('transports-table-body');
  if (!tbody) return;

  if (transportsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px 0;">
          No se encontraron transportistas registrados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  transportsList.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600; color: var(--brand-primary-hover);">${t.codigoSap}</td>
      <td>
        <div style="font-weight: 500;">${t.razonSocial}</div>
      </td>
      <td>${t.rut}</td>
      <td><code style="background-color: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color);">${t.patente}</code></td>
      <td>${t.capacidad} Ton</td>
      <td>
        <div style="font-size: 13px;">${t.email}</div>
        <div style="font-size: 11px; color: var(--text-muted);">${t.telefono}</div>
      </td>
      <td>
        <span class="status-pill ${t.activo ? 'active' : 'inactive'}">
          ${t.activo ? 'Activo' : 'De Baja'}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn-icon-only btn-edit" data-id="${t.id}" title="Editar campos de contacto">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button class="btn-icon-only ${t.activo ? 'action-delete' : ''}" data-id="${t.id}" id="toggle-status-${t.id}" title="${t.activo ? 'Dar de baja' : 'Activar'}">
            ${t.activo ? `
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            ` : `
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color: var(--state-success)">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            `}
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Agregar eventos a botones de Editar en la Tabla
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const t = db.transports.find(item => item.id === id);
      
      if (t) {
        editingTransportId = id;
        
        // Llenar campos
        document.getElementById('t-razonsocial').value = t.razonSocial;
        document.getElementById('t-rut').value = t.rut;
        document.getElementById('t-patente').value = t.patente;
        document.getElementById('t-capacidad').value = t.capacidad;
        document.getElementById('t-codigosap').value = t.codigoSap;
        document.getElementById('t-direccion').value = t.direccion;
        document.getElementById('t-telefono').value = t.telefono;
        document.getElementById('t-email').value = t.email;

        document.getElementById('transport-modal-title').innerText = 'Editar Datos de Contacto';
        
        // Bloquear campos requeridos
        setLockFields(true);

        document.getElementById('transport-modal').classList.add('active');
      }
    });
  });

  // Agregar eventos para dar de baja / activar
  document.querySelectorAll('[id^="toggle-status-"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const idx = db.transports.findIndex(item => item.id === id);
      
      if (idx !== -1) {
        const t = db.transports[idx];
        t.activo = !t.activo;
        saveDatabase(db);
        showAlert(`El transportista ${t.razonSocial} ha sido ${t.activo ? 'activado' : 'dado de baja'}.`);
        // Recargar la vista completa para actualizar KPIs y tablas
        renderTransportsView(document.getElementById('stage-area'));
      }
    });
  });
}
