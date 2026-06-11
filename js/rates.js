import { getDatabase, saveDatabase } from './data.js';
import { formatCLP, showAlert } from './utils.js';

// Renderizar la vista de Matriz de Tarifas y Simulador
export function renderRatesView(container) {
  const db = getDatabase();
  const truckTypes = db.truckTypes;
  const routes = db.routes.filter(r => r.activo);
  const cds = db.logisticsCentres;

  container.innerHTML = `
    <div class="rates-layout">
      <!-- PANEL IZQUIERDO: MATRIZ BASE Y EDICIÓN -->
      <div>
        <div class="table-container-card" style="margin-bottom: 24px;">
          <div class="table-header-bar">
            <h4 style="font-weight: 700; font-size: 16px;">Matriz Base de Tarifas por Camión</h4>
            <span style="font-size: 12px; color: var(--text-muted);">Define los costos por tipo de camión</span>
          </div>
          <table class="responsive-table">
            <thead>
              <tr>
                <th>Tipo de Camión</th>
                <th>Capacidad Ref.</th>
                <th>Tarifa Base Despacho</th>
                <th>Costo Adicional x KM</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="truck-rates-tbody">
              <!-- Cargado dinámicamente -->
            </tbody>
          </table>
        </div>

        <!-- SIMULADOR INTERACTIVO DE COSTO -->
        <div class="rates-control-panel">
          <h4 style="font-weight: 700; font-size: 16px; margin-bottom: 20px; color: var(--brand-primary-hover);">Simulador de Tarifas Dinámicas (Ruta X Camión)</h4>
          
          <div class="form-grid-2">
            <div class="form-group">
              <label for="sim-cd">Centro de Salida (Origen)</label>
              <select id="sim-cd" class="form-control">
                <option value="">Seleccione origen...</option>
                <!-- Cargado dinámicamente -->
              </select>
            </div>
            <div class="form-group">
              <label for="sim-route">Ruta de Destino</label>
              <select id="sim-route" class="form-control" disabled>
                <option value="">Primero seleccione origen...</option>
              </select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label for="sim-truck">Tipo de Camión</label>
              <select id="sim-truck" class="form-control">
                <option value="">Seleccione camión...</option>
                <!-- Cargado dinámicamente -->
              </select>
            </div>
            <div class="form-group">
              <label for="sim-dist">Distancia de la Ruta</label>
              <input type="text" id="sim-dist" class="form-control field-locked" disabled placeholder="KM de ruta">
            </div>
          </div>
        </div>
      </div>

      <!-- PANEL DERECHO: PANEL DE RESULTADO/DETALLE DE COTIZACIÓN -->
      <div>
        <div class="simulator-result-box" id="simulator-result-container">
          <div class="simulator-empty" id="sim-empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p>Selecciona un Origen, una Ruta y un Tipo de Camión para calcular dinámicamente la tarifa de transporte.</p>
          </div>
          
          <div id="sim-calculated-state" style="display: none; height: 100%; flex-direction: column; justify-content: space-between;">
            <div>
              <div class="result-header">
                <h4>Detalle de Cotización de Ruta</h4>
                <h3 id="res-title-route">RUT-SCL-QUI</h3>
              </div>
              
              <div class="result-breakdown">
                <div class="breakdown-row">
                  <span>Origen (Salida):</span>
                  <span id="res-origin">CD Santiago Noviciado</span>
                </div>
                <div class="breakdown-row">
                  <span>Destino (Entrega):</span>
                  <span id="res-destination">Quilicura</span>
                </div>
                <div class="breakdown-row">
                  <span>Distancia Ruta:</span>
                  <span id="res-km">25 KM</span>
                </div>
                <div class="breakdown-row">
                  <span>Tipo de Camión:</span>
                  <span id="res-truck">Sencillo</span>
                </div>
                <div class="breakdown-row">
                  <span>Tarifa Base Camión:</span>
                  <span id="res-base">45.000 CLP</span>
                </div>
                <div class="breakdown-row">
                  <span>Costo Adicional x KM:</span>
                  <span id="res-cost-km">1.200 CLP/KM</span>
                </div>
                <div class="breakdown-row">
                  <span>Costo Kilometraje:</span>
                  <span id="res-total-km">30.000 CLP</span>
                </div>
              </div>
            </div>

            <div>
              <div class="breakdown-total">
                <span>Costo de Transporte</span>
                <span class="price-tag" id="res-total-cost">$75.000</span>
              </div>
              
              <div class="simulator-actions">
                <button class="btn-secondary" style="width: 100%;" id="btn-reset-simulator">
                  Reiniciar
                </button>
                <button class="btn-primary" style="width: 100%;" id="btn-print-simulator">
                  Imprimir Reporte
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MODAL EDITAR TARIFA DE CAMIÓN -->
    <div class="modal-overlay" id="rate-edit-modal">
      <div class="modal-window">
        <div class="modal-header">
          <h4>Editar Parámetros de Tarifa</h4>
          <button class="modal-close-btn" id="btn-close-rate-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="rate-edit-form">
          <div class="modal-body">
            <div class="form-group">
              <label for="rate-truck-type">Categoría del Camión</label>
              <input type="text" id="rate-truck-type" class="form-control field-locked" disabled>
            </div>
            
            <div class="form-grid-2">
              <div class="form-group">
                <label for="rate-base">Tarifa Fija de Despacho ($)</label>
                <input type="number" id="rate-base" class="form-control" required min="0">
              </div>
              <div class="form-group">
                <label for="rate-km">Costo Adicional x KM ($)</label>
                <input type="number" id="rate-km" class="form-control" required min="0">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-rate-modal">Cancelar</button>
            <button type="submit" class="btn-primary">Actualizar Tarifas</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Renderizar la tabla de tarifas de camión
  renderTruckRatesTable(truckTypes, container);

  // --- CONFIGURACIÓN DE EVENTOS ---
  const simCd = document.getElementById('sim-cd');
  const simRoute = document.getElementById('sim-route');
  const simTruck = document.getElementById('sim-truck');
  const simDist = document.getElementById('sim-dist');

  // Llenar orígenes (CDs)
  simCd.innerHTML = '<option value="">Seleccione origen...</option>';
  cds.forEach(cd => {
    const opt = document.createElement('option');
    opt.value = cd.nombre;
    opt.textContent = cd.nombre;
    simCd.appendChild(opt);
  });

  // Llenar tipos de camiones
  simTruck.innerHTML = '<option value="">Seleccione camión...</option>';
  truckTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${t.type} (${t.capacityTons})`;
    simTruck.appendChild(opt);
  });

  // Evento al cambiar origen (Cargar rutas correspondientes)
  simCd.addEventListener('change', (e) => {
    const selectedOrigin = e.target.value;
    simRoute.innerHTML = '<option value="">Seleccione ruta...</option>';
    
    if (selectedOrigin) {
      const filteredRoutes = routes.filter(r => r.origen === selectedOrigin);
      
      if (filteredRoutes.length === 0) {
        simRoute.innerHTML = '<option value="">No hay rutas para este origen...</option>';
        simRoute.disabled = true;
      } else {
        filteredRoutes.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = `${r.codigo} -> ${r.destino} (${r.km} KM)`;
          simRoute.appendChild(opt);
        });
        simRoute.disabled = false;
      }
    } else {
      simRoute.innerHTML = '<option value="">Primero seleccione origen...</option>';
      simRoute.disabled = true;
    }
    
    simDist.value = '';
    calculateCost();
  });

  // Evento al cambiar de ruta
  simRoute.addEventListener('change', () => {
    const routeId = simRoute.value;
    if (routeId) {
      const selectedRoute = routes.find(r => r.id === routeId);
      simDist.value = selectedRoute ? `${selectedRoute.km} KM` : '';
    } else {
      simDist.value = '';
    }
    calculateCost();
  });

  // Evento al cambiar de camión
  simTruck.addEventListener('change', () => {
    calculateCost();
  });

  // Función para calcular costos
  function calculateCost() {
    const routeId = simRoute.value;
    const truckType = simTruck.value;
    
    const emptyState = document.getElementById('sim-empty-state');
    const calculatedState = document.getElementById('sim-calculated-state');

    if (!routeId || !truckType) {
      emptyState.style.display = 'flex';
      calculatedState.style.display = 'none';
      return;
    }

    const selectedRoute = routes.find(r => r.id === routeId);
    const selectedTruck = truckTypes.find(t => t.type === truckType);

    if (selectedRoute && selectedTruck) {
      // Fórmula del Costo de Transporte
      const distance = Number(selectedRoute.km);
      const baseFee = Number(selectedTruck.baseRate);
      const kmFee = Number(selectedTruck.ratePerKm);
      const totalKmCost = distance * kmFee;
      const finalCost = baseFee + totalKmCost;

      // Actualizar valores en pantalla
      document.getElementById('res-title-route').textContent = selectedRoute.codigo;
      document.getElementById('res-origin').textContent = selectedRoute.origen;
      document.getElementById('res-destination').textContent = selectedRoute.destino;
      document.getElementById('res-km').textContent = `${distance} KM`;
      document.getElementById('res-truck').textContent = selectedTruck.type;
      
      document.getElementById('res-base').textContent = formatCLP(baseFee);
      document.getElementById('res-cost-km').textContent = `${formatCLP(kmFee)}/KM`;
      document.getElementById('res-total-km').textContent = formatCLP(totalKmCost);
      document.getElementById('res-total-cost').textContent = formatCLP(finalCost);

      emptyState.style.display = 'none';
      calculatedState.style.display = 'flex';
    }
  }

  // Reiniciar simulador
  document.getElementById('btn-reset-simulator').addEventListener('click', () => {
    simCd.value = '';
    simRoute.value = '';
    simRoute.disabled = true;
    simTruck.value = '';
    simDist.value = '';
    calculateCost();
  });

  // Imprimir reporte de cotización
  document.getElementById('btn-print-simulator').addEventListener('click', () => {
    const routeId = simRoute.value;
    const selectedRoute = routes.find(r => r.id === routeId);
    showAlert(`Reporte de cotización generado para ${selectedRoute ? selectedRoute.codigo : 'ruta'}. Enviando a consola de impresión corporativa...`);
  });
}

// Renderizar tabla de tarifas
function renderTruckRatesTable(truckTypes, viewContainer) {
  const tbody = document.getElementById('truck-rates-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  truckTypes.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600; color: var(--brand-primary-hover);">${t.type}</td>
      <td><span style="background-color: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 13px;">${t.capacityTons}</span></td>
      <td style="font-weight: 500;">${formatCLP(t.baseRate)}</td>
      <td style="font-weight: 500;">${formatCLP(t.ratePerKm)} / KM</td>
      <td>
        <button class="btn-icon-only btn-edit-rate" data-idx="${idx}" title="Editar Tarifas">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Modales y Edición
  const modal = document.getElementById('rate-edit-modal');
  const btnClose = document.getElementById('btn-close-rate-modal');
  const btnCancel = document.getElementById('btn-cancel-rate-modal');
  const form = document.getElementById('rate-edit-form');
  let activeIndex = null;

  document.querySelectorAll('.btn-edit-rate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.currentTarget.getAttribute('data-idx');
      const truck = truckTypes[idx];
      if (truck) {
        activeIndex = idx;
        document.getElementById('rate-truck-type').value = truck.type;
        document.getElementById('rate-base').value = truck.baseRate;
        document.getElementById('rate-km').value = truck.ratePerKm;
        modal.classList.add('active');
      }
    });
  });

  const closeModal = () => modal.classList.remove('active');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (activeIndex !== null) {
      const db = getDatabase();
      db.truckTypes[activeIndex].baseRate = Number(document.getElementById('rate-base').value);
      db.truckTypes[activeIndex].ratePerKm = Number(document.getElementById('rate-km').value);
      
      saveDatabase(db);
      showAlert(`Tarifas para camión ${db.truckTypes[activeIndex].type} actualizadas.`);
      closeModal();
      
      // Forzar renderizado completo de la vista para actualizar tablas e inputs
      renderRatesView(viewContainer);
    }
  });
}
