import { getDatabase, saveDatabase } from './data.js';
import { generateSapCode, showAlert } from './utils.js';

// Renderizar la vista de Centros Logísticos
export function renderLogisticsView(container) {
  const db = getDatabase();
  const centres = db.logisticsCentres;

  container.innerHTML = `
    <!-- Cabecera de la Sección -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
      <div>
        <p style="color: var(--text-muted); font-size: 14px;">Registro y administración de puntos de salida (Centros de Distribución)</p>
      </div>
      <button id="btn-create-cd" class="btn-primary">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Registrar Centro SAP
      </button>
    </div>

    <!-- Grilla de Centros Logísticos -->
    <div class="cd-grid" id="cd-cards-container">
      <!-- Tarjetas cargadas dinámicamente -->
    </div>

    <!-- Modal Formulario Centro Logístico -->
    <div class="modal-overlay" id="cd-modal">
      <div class="modal-window">
        <div class="modal-header">
          <h4>Nuevo Centro Logístico (CD)</h4>
          <button class="modal-close-btn" id="btn-close-cd-modal">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="cd-form">
          <div class="modal-body">
            <div class="form-group">
              <label for="cd-nombre">Nombre de Planta / Centro</label>
              <input type="text" id="cd-nombre" class="form-control" required placeholder="Ej: CD Santiago Sur">
            </div>
            
            <div class="form-grid-2">
              <div class="form-group">
                <label for="cd-sap">ID Centro SAP</label>
                <input type="text" id="cd-sap" class="form-control" required placeholder="Ej: CD400">
              </div>
              <div class="form-group">
                <label for="cd-comuna">Región/Comuna</label>
                <input type="text" id="cd-comuna" class="form-control" required placeholder="Ej: San Bernardo, RM">
              </div>
            </div>

            <div class="form-group">
              <label for="cd-direccion">Dirección Geográfica Completa</label>
              <input type="text" id="cd-direccion" class="form-control" required placeholder="Ej: Av. Las Industrias 890, San Bernardo">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-cd-modal">Cancelar</button>
            <button type="submit" class="btn-primary">Registrar Centro</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Renderizar tarjetas
  renderCdCards(centres);

  // --- CONFIGURACIÓN DE EVENTOS ---
  const cdModal = document.getElementById('cd-modal');
  const btnCreateCd = document.getElementById('btn-create-cd');
  const btnCloseModal = document.getElementById('btn-close-cd-modal');
  const btnCancelModal = document.getElementById('btn-cancel-cd-modal');
  const cdForm = document.getElementById('cd-form');

  // Abrir modal sugeriendo código SAP
  btnCreateCd.addEventListener('click', () => {
    cdForm.reset();
    const activeDb = getDatabase();
    document.getElementById('cd-sap').value = generateSapCode('CD', activeDb.logisticsCentres, 'idCentroSap');
    cdModal.classList.add('active');
  });

  // Cerrar modal
  const closeModal = () => {
    cdModal.classList.remove('active');
  };
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  // Enviar Formulario
  cdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const db = getDatabase();

    const cdData = {
      id: 'cd' + (new Date().getTime()),
      nombre: document.getElementById('cd-nombre').value,
      direccion: `${document.getElementById('cd-direccion').value}, ${document.getElementById('cd-comuna').value}`,
      idCentroSap: document.getElementById('cd-sap').value.toUpperCase().replace(/\s+/g, '')
    };

    // Validar duplicado de SAP ID
    if (db.logisticsCentres.some(cd => cd.idCentroSap === cdData.idCentroSap)) {
      showAlert('El ID de Centro SAP ya está registrado.', 'error');
      return;
    }

    db.logisticsCentres.push(cdData);
    saveDatabase(db);
    showAlert('Centro Logístico registrado correctamente.');
    closeModal();
    
    // Forzar actualización total de la vista
    renderLogisticsView(container);
  });
}

// Renderizar las tarjetas de CD en la grilla
function renderCdCards(list) {
  const container = document.getElementById('cd-cards-container');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 60px 0;">
        No hay centros logísticos registrados en el sistema.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  list.forEach(cd => {
    const card = document.createElement('div');
    card.className = 'cd-card';
    card.innerHTML = `
      <span class="cd-badge">SAP: ${cd.idCentroSap}</span>
      <div class="cd-main-info">
        <h4>${cd.nombre}</h4>
        <div class="cd-address">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>${cd.direccion}</span>
        </div>
      </div>
      <div class="cd-map-simulation">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span>Geolocalizado - Listo para despachos</span>
      </div>
    `;
    container.appendChild(card);
  });
}
