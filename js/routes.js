import { getDatabase, saveDatabase } from './data.js';
import { generateSapCode, parseCSV, showAlert } from './utils.js';

let editingRouteId = null;

// Renderizar la vista principal de Rutas
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
    <!-- Tarjetas de Estadísticas KPI -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>Total Rutas</h4>
          <div class="kpi-value" id="kpi-routes-total">${totalRoutes}</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>Rutas Activas</h4>
          <div class="kpi-value" id="kpi-routes-active">${activeRoutes}</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <div class="kpi-card kpi-accent">
        <div class="kpi-info">
          <h4>Distancia Promedio</h4>
          <div class="kpi-value" id="kpi-routes-avg-km">${averageKm} KM</div>
        </div>
        <div class="kpi-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-info">
          <h4>Dadas de Baja</h4>
          <div class="kpi-value" id="kpi-routes-inactive">${inactiveRoutes}</div>
        </div>
        <div class="kpi-icon" style="color: var(--state-error)">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
      </div>
    </div>

    <!-- Filtros y Tabla -->
    <div class="table-container-card">
      <div class="table-header-bar">
        <div class="search-input-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" id="route-search" class="form-control" placeholder="Buscar por Código, Origen, Destino, Región...">
        </div>
        
        <div class="action-buttons-group">
          <button id="btn-bulk-upload-routes" class="btn-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-route" class="btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva Ruta
          </button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Código Ruta</th>
              <th>Origen</th>
              <th>Destino (Comuna/Sector)</th>
              <th>Región</th>
              <th>Tipo</th>
              <th>Distancia (KM)</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="routes-table-body">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay" id="route-modal">
      <div class="modal-window">
        <div class="modal-header">
          <h4 id="route-modal-title">Nueva Ruta</h4>
          <button class="modal-close-btn" id="btn-close-route-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="route-form">
          <div class="modal-body">
            <div class="form-grid-2">
              <div class="form-group">
                <label for="r-codigo">Código de Ruta SAP</label>
                <input type="text" id="r-codigo" class="form-control" required placeholder="Ej: RUT-SCL-001">
              </div>
              <div class="form-group">
                <label for="r-origen">Centro Logístico (Origen)</label>
                <select id="r-origen" class="form-control" required>
                  <!-- Cargado dinámicamente según Centros Logísticos de la BD -->
                </select>
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label for="r-destino">Destino (Ciudad/Comuna)</label>
                <input type="text" id="r-destino" class="form-control" required placeholder="Ej: Maipú">
              </div>
              <div class="form-group">
                <label for="r-region">Región</label>
                <select id="r-region" class="form-control" required>
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

            <div class="form-grid-2">
              <div class="form-group">
                <label for="r-tipo">Tipo de Zona</label>
                <select id="r-tipo" class="form-control" required>
                  <option value="Comuna">Comuna</option>
                  <option value="Sector">Sector</option>
                </select>
              </div>
              <div class="form-group">
                <label for="r-km">Distancia (KM)</label>
                <input type="number" id="r-km" class="form-control" required min="1" placeholder="Ej: 45">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-route-modal">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar Ruta</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay" id="bulk-upload-routes-modal">
      <div class="modal-window" style="width: 700px;">
        <div class="modal-header">
          <h4>Carga Masiva de Rutas</h4>
          <button class="modal-close-btn" id="btn-close-route-bulk-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="color: var(--text-muted); font-size: 13.5px; margin-bottom: 15px;">
            Sube un archivo de texto plano separado por comas o punto y coma (.csv). El archivo debe contener los siguientes encabezados exactos:
            <code style="display:block; padding: 10px; background-color: var(--bg-primary); border-radius: 4px; margin-top: 5px; color: var(--brand-secondary);">
              codigo;origen;destino;region;tipo;km
            </code>
          </p>
          
          <div class="csv-upload-area" id="csv-route-dropzone">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span>Arrastra tu archivo CSV de rutas aquí o haz clic para buscar</span>
            <input type="file" id="csv-route-input" accept=".csv" style="display: none;">
          </div>

          <div id="csv-route-preview-container" style="display: none; margin-top: 20px;">
            <h5 style="margin-bottom: 10px; font-weight: 600;">Vista Previa de Rutas Detectadas (<span id="csv-route-count">0</span>):</h5>
            <div class="csv-preview-table-container">
              <table class="csv-preview-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Origen</th>
                    <th>Destino</th>
                    <th>KM</th>
                    <th>Estatus</th>
                  </tr>
                </thead>
                <tbody id="csv-route-preview-body">
                  <!-- Inyectado dinámicamente -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="btn-cancel-route-bulk">Cancelar</button>
          <button class="btn-primary" id="btn-confirm-route-bulk" disabled>Procesar e Importar</button>
        </div>
      </div>
    </div>
  `;

  // Renderizar la tabla inicial
  renderRoutesTable(routes);

  // --- CONFIGURACIÓN DE EVENTOS DE LA VISTA ---

  // 1. Cargar selector de Orígenes (Centros Logísticos disponibles)
  const originSelect = document.getElementById('r-origen');
  originSelect.innerHTML = '';
  db.logisticsCentres.forEach(cd => {
    const opt = document.createElement('option');
    opt.value = cd.nombre;
    opt.textContent = cd.nombre;
    originSelect.appendChild(opt);
  });

  // 2. Buscador en tiempo real
  const searchInput = document.getElementById('route-search');
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = routes.filter(r => 
      r.codigo.toLowerCase().includes(term) ||
      r.origen.toLowerCase().includes(term) ||
      r.destino.toLowerCase().includes(term) ||
      r.region.toLowerCase().includes(term)
    );
    renderRoutesTable(filtered);
  });

  // 3. Control de Modales
  const routeModal = document.getElementById('route-modal');
  const btnCreateRoute = document.getElementById('btn-create-route');
  const btnCloseModal = document.getElementById('btn-close-route-modal');
  const btnCancelModal = document.getElementById('btn-cancel-route-modal');
  const routeForm = document.getElementById('route-form');

  // Abrir formulario para Crear
  btnCreateRoute.addEventListener('click', () => {
    editingRouteId = null;
    routeForm.reset();
    document.getElementById('route-modal-title').innerText = 'Nueva Ruta';
    
    // Sugerir Código SAP de Ruta
    const activeDb = getDatabase();
    document.getElementById('r-codigo').value = generateSapCode('RUT-SAP-', activeDb.routes, 'codigo');

    routeModal.classList.add('active');
  });

  // Cerrar modales
  const closeFormModal = () => {
    routeModal.classList.remove('active');
  };
  btnCloseModal.addEventListener('click', closeFormModal);
  btnCancelModal.addEventListener('click', closeFormModal);

  // Guardar datos
  routeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const db = getDatabase();
    const routeData = {
      codigo: document.getElementById('r-codigo').value.toUpperCase().replace(/\s+/g, ''),
      origen: document.getElementById('r-origen').value,
      destino: document.getElementById('r-destino').value,
      region: document.getElementById('r-region').value,
      tipo: document.getElementById('r-tipo').value,
      km: Number(document.getElementById('r-km').value),
      activo: editingRouteId ? db.routes.find(r => r.id === editingRouteId).activo : true
    };

    if (editingRouteId) {
      // Editar existente
      const index = db.routes.findIndex(r => r.id === editingRouteId);
      if (index !== -1) {
        db.routes[index] = { ...db.routes[index], ...routeData };
        saveDatabase(db);
        showAlert('Ruta actualizada correctamente');
      }
    } else {
      // Validar duplicados de Código SAP de Ruta al crear nueva
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

  // --- CARGA MASIVA DE RUTAS (EVENTOS) ---
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
    document.getElementById('csv-route-preview-container').style.display = 'none';
    document.getElementById('csv-route-preview-body').innerHTML = '';
    bulkModal.classList.add('active');
  });

  const closeBulkModal = () => {
    bulkModal.classList.remove('active');
  };
  btnCloseBulk.addEventListener('click', closeBulkModal);
  btnCancelBulk.addEventListener('click', closeBulkModal);

  csvDropzone.addEventListener('click', () => csvFileInput.click());

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
      
      rows.forEach((row, idx) => {
        const codigo = (row.codigo || '').toUpperCase().replace(/\s+/g, '');
        const origen = row.origen || '';
        const destino = row.destino || '';
        const region = row.region || 'Metropolitana';
        const tipo = row.tipo || 'Comuna';
        const km = Number(row.km || 0);
        
        let error = '';
        if (!codigo) error = 'Falta Código';
        else if (!origen) error = 'Falta Origen';
        else if (!destino) error = 'Falta Destino';
        else if (isNaN(km) || km <= 0) error = 'Distancia KM inválida';
        else if (db.routes.some(r => r.codigo === codigo)) error = 'Código Duplicado en BD';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${codigo}</td>
          <td>${origen}</td>
          <td>${destino}</td>
          <td>${km} KM</td>
          <td>
            <span class="status-pill ${error ? 'inactive' : 'active'}">
              ${error ? error : 'Listo'}
            </span>
          </td>
        `;
        previewBody.appendChild(tr);

        if (!error) {
          parsedRoutes.push({
            codigo,
            origen,
            destino,
            region,
            tipo,
            km,
            activo: true
          });
        }
      });

      document.getElementById('csv-route-count').innerText = rows.length;
      document.getElementById('csv-route-preview-container').style.display = 'block';
      
      if (parsedRoutes.length > 0) {
        btnConfirmBulk.disabled = false;
      } else {
        showAlert('No se encontraron registros de rutas válidos para importar.', 'error');
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
    showAlert(`Se importaron ${parsedRoutes.length} rutas exitosamente.`);
    closeBulkModal();
    renderRoutesView(container);
  });
}

// Renderizar la tabla de rutas
function renderRoutesTable(routesList) {
  const tbody = document.getElementById('routes-table-body');
  if (!tbody) return;

  if (routesList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px 0;">
          No se encontraron rutas registradas.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  routesList.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600; color: var(--brand-primary-hover);">${r.codigo}</td>
      <td style="font-weight: 500;">${r.origen}</td>
      <td>${r.destino}</td>
      <td>${r.region}</td>
      <td>
        <span style="font-size: 13px; background-color: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
          ${r.tipo}
        </span>
      </td>
      <td style="font-weight: 600;">${r.km} KM</td>
      <td>
        <span class="status-pill ${r.activo ? 'active' : 'inactive'}">
          ${r.activo ? 'Activo' : 'De Baja'}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn-icon-only btn-edit" data-id="${r.id}" title="Editar ruta">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button class="btn-icon-only ${r.activo ? 'action-delete' : ''}" data-id="${r.id}" id="toggle-route-status-${r.id}" title="${r.activo ? 'Dar de baja' : 'Activar'}">
            ${r.activo ? `
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

  // Evento Editar Ruta
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const r = db.routes.find(item => item.id === id);
      
      if (r) {
        editingRouteId = id;
        
        document.getElementById('r-codigo').value = r.codigo;
        document.getElementById('r-origen').value = r.origen;
        document.getElementById('r-destino').value = r.destino;
        document.getElementById('r-region').value = r.region;
        document.getElementById('r-tipo').value = r.tipo;
        document.getElementById('r-km').value = r.km;

        document.getElementById('route-modal-title').innerText = 'Editar Ruta';
        document.getElementById('route-modal').classList.add('active');
      }
    });
  });

  // Evento Activar/Desactivar
  document.querySelectorAll('[id^="toggle-route-status-"]').forEach(btn => {
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
}
