import { getDatabase, saveDatabase } from './data.js';
import { generateSapCode, showAlert, geocodeAddress } from './utils.js';

// Renderizar la vista de Centros Logísticos con Mapa Interactivo Leaflet
export function renderLogisticsView(container) {
  const db = getDatabase();
  const centres = db.logisticsCentres;

  container.innerHTML = `
    <!-- Cabecera de la Sección -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
      <div>
        <p style="color: var(--text-muted); font-size: 14px;">Administración de puntos de despacho. Haz clic en cualquier centro para geolocalizarlo en el mapa.</p>
      </div>
      <button id="btn-create-cd" class="btn-primary">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Registrar Centro SAP
      </button>
    </div>

    <!-- Layout Side-by-Side: Tarjetas a la izquierda, Mapa a la derecha -->
    <div class="rates-layout" style="grid-template-columns: 1fr 1fr; gap: 24px;">
      <!-- Columna Izquierda: Listado de Centros -->
      <div style="display: flex; flex-direction: column; gap: 16px; max-height: 550px; overflow-y: auto; padding-right: 8px;" id="cd-cards-container">
        <!-- Tarjetas cargadas dinámicamente -->
      </div>

      <!-- Columna Derecha: Mapa Leaflet -->
      <div>
        <div id="logistics-map" style="height: 550px; border-radius: var(--radius-md); border: 1px solid var(--border-color); box-shadow: var(--shadow-lg); overflow: hidden; position: relative;">
          <!-- Cargador de Mapa -->
        </div>
      </div>
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
                <input type="text" id="cd-comuna" class="form-control" required placeholder="Ej: San Bernardo, Metropolitana">
              </div>
            </div>

            <div class="form-group">
              <label for="cd-direccion">Dirección Geográfica (Calle y Número)</label>
              <input type="text" id="cd-direccion" class="form-control" required placeholder="Ej: Av. Las Industrias 890">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btn-cancel-cd-modal">Cancelar</button>
            <button type="submit" class="btn-primary" id="btn-submit-cd">Geolocalizar y Registrar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // 1. Renderizar tarjetas de Centros
  renderCdCards(centres);

  // 2. Inicializar Mapa Leaflet
  let map;
  let markers = [];
  try {
    // Coordenadas iniciales promedio en Chile Central
    map = L.map('logistics-map').setView([-34.5, -71.5], 6);
    
    // Capa de Mapa estilo Premium Dark (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    // Agregar marcadores para los centros existentes
    const bounds = [];
    centres.forEach((cd, index) => {
      if (cd.lat && cd.lon) {
        const marker = L.marker([cd.lat, cd.lon]).addTo(map)
          .bindPopup(`
            <div style="color: var(--text-dark); font-family: sans-serif;">
              <strong style="color: var(--brand-primary);">${cd.nombre}</strong><br>
              <span style="font-size: 12px; color: #4b5563;">${cd.direccion}</span><br>
              <span style="font-size: 11px; font-weight: 600; color: var(--brand-secondary);">Código SAP: ${cd.idCentroSap}</span>
            </div>
          `);
        markers.push(marker);
        bounds.push([cd.lat, cd.lon]);
        
        // Agregar click a la tarjeta para mover el mapa
        const cardElement = document.getElementById(`cd-card-${cd.id}`);
        if (cardElement) {
          cardElement.addEventListener('click', () => {
            map.flyTo([cd.lat, cd.lon], 14, { duration: 1.5 });
            marker.openPopup();
          });
        }
      }
    });

    // Ajustar el zoom del mapa para mostrar todos los centros
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

  } catch (err) {
    console.error("Error al cargar Leaflet:", err);
    document.getElementById('logistics-map').innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-muted);">
        Error al cargar los servicios de mapa interactivo.
      </div>
    `;
  }

  // --- CONFIGURACIÓN DE EVENTOS DEL FORMULARIO ---
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

  // Enviar Formulario con Geolocalización Asíncrona
  cdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const db = getDatabase();
    const btnSubmit = document.getElementById('btn-submit-cd');

    // Validar duplicado de SAP ID
    const sapId = document.getElementById('cd-sap').value.toUpperCase().replace(/\s+/g, '');
    if (db.logisticsCentres.some(cd => cd.idCentroSap === sapId)) {
      showAlert('El ID de Centro SAP ya está registrado.', 'error');
      return;
    }

    // Cambiar estado del botón a cargando
    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Geolocalizando dirección...';

    const nombre = document.getElementById('cd-nombre').value;
    const calleNumero = document.getElementById('cd-direccion').value;
    const comunaRegion = document.getElementById('cd-comuna').value;
    const direccionCompleta = `${calleNumero}, ${comunaRegion}`;

    // LLAMADA A LA UTILIDAD DE GEOLOCALIZACIÓN
    const coords = await geocodeAddress(direccionCompleta);

    const cdData = {
      id: 'cd' + (new Date().getTime()),
      nombre: nombre,
      direccion: direccionCompleta,
      idCentroSap: sapId,
      lat: coords.lat,
      lon: coords.lon
    };

    db.logisticsCentres.push(cdData);
    saveDatabase(db);
    showAlert('Centro Logístico geolocalizado y registrado con éxito.');
    closeModal();
    
    // Recargar vista completa para actualizar tarjetas y mapa
    renderLogisticsView(container);
  });
}

// Renderizar las tarjetas de CD en la grilla izquierda
function renderCdCards(list) {
  const container = document.getElementById('cd-cards-container');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 60px 0;">
        No hay centros logísticos registrados.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  list.forEach(cd => {
    const card = document.createElement('div');
    card.className = 'cd-card';
    card.id = `cd-card-${cd.id}`;
    card.style.cursor = 'pointer';
    card.style.height = 'auto';
    card.style.marginBottom = '0px';
    card.style.flexShrink = '0';
    
    // Si tiene coordenadas reales, mostrar tag de geolocalizado real, si no, uno por defecto
    const hasRealCoords = cd.lat && cd.lon && (cd.lat !== -33.4489 || cd.lon !== -70.6693);

    card.innerHTML = `
      <span class="cd-badge">SAP: ${cd.idCentroSap}</span>
      <div class="cd-main-info" style="margin-bottom: 12px;">
        <h4 style="font-size: 16px; margin-bottom: 4px;">${cd.nombre}</h4>
        <div class="cd-address">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span style="font-size: 12.5px;">${cd.direccion}</span>
        </div>
      </div>
      
      <div style="display:flex; justify-content:space-between; align-items:center; font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 8px;">
        <span style="display:flex; align-items:center; gap: 4px;">
          <span style="width:6px; height:6px; border-radius:50%; background-color:${hasRealCoords ? 'var(--state-success)' : 'var(--state-warning)'}; display:inline-block;"></span>
          ${hasRealCoords ? 'Geolocalización GPS exacta' : 'Coordenadas estimadas'}
        </span>
        <span style="font-family: monospace; opacity: 0.7;">${cd.lat.toFixed(4)}, ${cd.lon.toFixed(4)}</span>
      </div>
    `;
    container.appendChild(card);
  });
}
