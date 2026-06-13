import { getDatabase, saveDatabase } from './data.js';
import { showAlert, geocodeAddress } from './utils.js';

// Renderizar la vista de Centros Logísticos con Mapa Interactivo Leaflet y Tailwind CSS
export function renderLogisticsView(container) {
  const db = getDatabase();
  const centres = db.logisticsCentres;

  container.innerHTML = `
    <p class="font-body-md text-body-md text-secondary mb-md">Administre los centros de distribución (CD) y puntos de salida. Seleccione un centro para geolocalizarlo en el mapa interactivo.</p>

    <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
      <button id="btn-create-cd" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
        <span class="material-symbols-outlined text-[18px]">add</span>
        Registrar Centro SAP
      </button>
    </div>

    <!-- Layout Side-by-Side: Tarjetas a la izquierda, Mapa a la derecha -->
    <div class="grid grid-cols-12 gap-lg">
      <!-- Columna Izquierda: Listado de Centros -->
      <div class="col-span-12 lg:col-span-6 flex flex-col gap-md max-h-[550px] overflow-y-auto pr-xs" id="cd-cards-container">
        <!-- Tarjetas cargadas dinámicamente -->
      </div>

      <!-- Columna Derecha: Mapa Leaflet -->
      <div class="col-span-12 lg:col-span-6">
        <div id="logistics-map" class="h-[550px] rounded-xl border border-outline-variant shadow-md overflow-hidden relative" style="z-index: 1;">
          <!-- Cargador de Mapa -->
        </div>
      </div>
    </div>

    <!-- Modal Formulario Centro Logístico -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="cd-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Nuevo Centro Logístico (CD)</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-cd-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="cd-form">
          <div class="p-lg space-y-md">
            <div class="space-y-xs">
              <label for="cd-nombre" class="font-label-caps text-label-caps text-secondary block">NOMBRE DE PLANTA / CENTRO</label>
              <input type="text" id="cd-nombre" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: CD Santiago Sur">
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="cd-sap" class="font-label-caps text-label-caps text-secondary block">ID CENTRO SAP</label>
                <input type="text" id="cd-sap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white disabled:bg-surface-container-low disabled:text-secondary" required placeholder="Ej: 1003">
                <p class="text-[10px] text-secondary" id="cd-sap-hint"></p>
              </div>
              <div class="space-y-xs">
                <label for="cd-comuna" class="font-label-caps text-label-caps text-secondary block">REGIÓN/COMUNA</label>
                <input type="text" id="cd-comuna" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: San Bernardo, Metropolitana">
              </div>
            </div>

            <div class="space-y-xs">
              <label for="cd-direccion" class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN GEOGRÁFICA (CALLE Y NÚMERO)</label>
              <input type="text" id="cd-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: Av. Las Industrias 890">
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-cd-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer" id="btn-submit-cd">Geolocalizar y Registrar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Renderizar CD Cards
  renderCdCards(centres, container);

  // Inicializar Mapa Leaflet
  let map;
  let markers = [];
  try {
    map = L.map('logistics-map').setView([-34.5, -71.5], 6);
    
    // Capa de Mapa estilo Premium Dark (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    const bounds = [];
    centres.forEach((cd, index) => {
      if (cd.lat && cd.lon) {
        const marker = L.marker([cd.lat, cd.lon]).addTo(map)
          .bindPopup(`
            <div class="text-on-surface font-body-md" style="font-family: 'Hanken Grotesk', sans-serif;">
              <strong class="text-primary font-bold text-sm">${cd.nombre}</strong><br>
              <span class="text-xs text-secondary">${cd.direccion}</span><br>
              <span class="text-[10px] font-bold text-primary block mt-1">Código SAP: ${cd.id}</span>
            </div>
          `);
        markers.push(marker);
        bounds.push([cd.lat, cd.lon]);
        
        // Asignar click a la tarjeta para enfocar en el mapa
        const cardElement = document.getElementById(`cd-card-${cd.id}`);
        if (cardElement) {
          cardElement.addEventListener('click', () => {
            // Quitar clase activa previa y agregarla a este
            document.querySelectorAll('.cd-card').forEach(c => c.classList.remove('border-primary', 'bg-primary-container/[0.02]'));
            cardElement.classList.add('border-primary', 'bg-primary-container/[0.02]');
            
            map.flyTo([cd.lat, cd.lon], 14, { duration: 1.5 });
            marker.openPopup();
          });
        }
      }
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

  } catch (err) {
    console.error("Error al cargar Leaflet:", err);
    document.getElementById('logistics-map').innerHTML = `
      <div class="flex justify-center items-center h-full text-secondary font-body-md bg-surface-container-low border border-outline-variant">
        Error al cargar los servicios de mapa interactivo.
      </div>
    `;
  }

  // Modales y Formulario
  const cdModal = document.getElementById('cd-modal');
  const btnCreateCd = document.getElementById('btn-create-cd');
  const btnCloseModal = document.getElementById('btn-close-cd-modal');
  const btnCancelModal = document.getElementById('btn-cancel-cd-modal');
  const cdForm = document.getElementById('cd-form');

  btnCreateCd.addEventListener('click', () => {
    cdForm.reset();
    window.__editingCdId = null;
    document.querySelector('#cd-modal h4').textContent = 'Nuevo Centro Logístico (CD)';
    const sapInput = document.getElementById('cd-sap');
    sapInput.value = '';
    sapInput.disabled = false;
    document.getElementById('cd-sap-hint').textContent = 'Ingrese el código de centro SAP (será el identificador único del centro).';

    cdModal.classList.remove('pointer-events-none', 'opacity-0');
    cdModal.querySelector('.modal-window').classList.remove('scale-95');
  });

  const closeModal = () => {
    cdModal.classList.add('pointer-events-none', 'opacity-0');
    cdModal.querySelector('.modal-window').classList.add('scale-95');
  };
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  cdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const db = getDatabase();
    const btnSubmit = document.getElementById('btn-submit-cd');
    const editingId = window.__editingCdId || null;

    const sapId = document.getElementById('cd-sap').value.toUpperCase().replace(/\s+/g, '');
    if (!editingId && db.logisticsCentres.some(cd => cd.id === sapId)) {
      showAlert('El ID de Centro SAP ya está registrado.', 'error');
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Geolocalizando dirección...';

    const nombre = document.getElementById('cd-nombre').value;
    const calleNumero = document.getElementById('cd-direccion').value;
    const comunaRegion = document.getElementById('cd-comuna').value;
    const direccionCompleta = `${calleNumero}, ${comunaRegion}`;

    const coords = await geocodeAddress(direccionCompleta);

    if (editingId) {
      // Editar centro existente (el ID Centro SAP no se modifica: es clave de otras tablas)
      const idx = db.logisticsCentres.findIndex(c => c.id === editingId);
      if (idx !== -1) {
        db.logisticsCentres[idx] = {
          ...db.logisticsCentres[idx],
          nombre,
          direccion: direccionCompleta,
          lat: coords.lat,
          lon: coords.lon
        };
        saveDatabase(db);
        showAlert('Centro Logístico actualizado con éxito.');
      }
    } else {
      const cdData = {
        id: sapId,
        nombre: nombre,
        direccion: direccionCompleta,
        lat: coords.lat,
        lon: coords.lon
      };
      db.logisticsCentres.push(cdData);
      saveDatabase(db);
      showAlert('Centro Logístico geolocalizado y registrado con éxito.');
    }

    window.__editingCdId = null;
    closeModal();
    renderLogisticsView(container);
  });
}

function renderCdCards(list, parentContainer) {
  const container = document.getElementById('cd-cards-container');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="text-center text-secondary p-xl bg-surface border border-outline-variant rounded">
        No hay centros logísticos registrados.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  list.forEach(cd => {
    const card = document.createElement('div');
    card.className = 'cd-card bg-surface border border-outline-variant rounded p-md shadow-sm transition-all flex flex-col justify-between hover:border-primary relative';
    card.id = `cd-card-${cd.id}`;
    card.style.cursor = 'pointer';
    
    const hasRealCoords = cd.lat && cd.lon && (cd.lat !== -33.4489 || cd.lon !== -70.6693);

    card.innerHTML = `
      <div class="flex items-start justify-between gap-md">
        <div>
          <h4 class="font-headline-sm text-[16px] font-bold text-on-surface mb-xs">${cd.nombre}</h4>
          <div class="flex items-start gap-xs text-xs text-secondary leading-tight">
            <span class="material-symbols-outlined text-[16px] text-primary mt-0.5">location_on</span>
            <span>${cd.direccion}</span>
          </div>
        </div>
        <!-- Código SAP destacado -->
        <div class="text-center bg-primary/5 border-2 border-primary/30 rounded-lg px-md py-sm flex-shrink-0">
          <p class="text-[9px] font-bold tracking-widest text-secondary uppercase">Código SAP</p>
          <p class="font-data-mono font-extrabold text-primary" style="font-size:26px;line-height:1.1;letter-spacing:0.04em">${cd.idCentroSap}</p>
        </div>
      </div>

      <div class="flex justify-between items-center text-[10px] text-secondary border-t border-outline-variant pt-sm mt-md">
        <span class="flex items-center gap-xs">
          <span class="w-1.5 h-1.5 rounded-full ${hasRealCoords ? 'bg-green-600' : 'bg-amber-600'}"></span>
          ${hasRealCoords ? 'GPS exacto' : 'Coordenadas estimadas'}
        </span>
        <div class="flex items-center gap-xs">
          <button class="btn-edit-cd flex items-center gap-1 border border-outline-variant hover:border-primary hover:text-primary text-secondary px-sm py-1 rounded cursor-pointer text-[11px] font-bold" data-id="${cd.id}" title="Editar centro">
            <span class="material-symbols-outlined text-[14px]">edit</span> Editar
          </button>
          <button class="btn-delete-cd flex items-center gap-1 border border-red-200 hover:bg-red-50 text-red-700 px-sm py-1 rounded cursor-pointer text-[11px] font-bold" data-id="${cd.id}" title="Eliminar centro">
            <span class="material-symbols-outlined text-[14px]">delete</span> Eliminar
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // --- Editar centro ---
  container.querySelectorAll('.btn-edit-cd').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const cd = db.logisticsCentres.find(c => c.id === id);
      if (!cd) return;

      window.__editingCdId = id;
      document.getElementById('cd-nombre').value = cd.nombre;
      const sapInput = document.getElementById('cd-sap');
      sapInput.value = cd.id;
      sapInput.disabled = true;
      document.getElementById('cd-sap-hint').textContent = 'El ID Centro SAP no se puede modificar una vez creado.';
      // Separar dirección "calle, comuna/región" si es posible
      const partes = (cd.direccion || '').split(',');
      document.getElementById('cd-direccion').value = partes[0] ? partes[0].trim() : cd.direccion;
      document.getElementById('cd-comuna').value = partes.slice(1).join(',').trim();
      document.querySelector('#cd-modal h4').textContent = 'Editar Centro Logístico (CD)';

      const modal = document.getElementById('cd-modal');
      modal.classList.remove('pointer-events-none', 'opacity-0');
      modal.querySelector('.modal-window').classList.remove('scale-95');
    });
  });

  // --- Eliminar centro (con protección de integridad) ---
  container.querySelectorAll('.btn-delete-cd').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const cd = db.logisticsCentres.find(c => c.id === id);
      if (!cd) return;

      // Verificar dependencias: rutas que salen de este centro
      const rutasAsociadas = (db.routes || []).filter(r => r.origenId === id);
      if (rutasAsociadas.length > 0) {
        showAlert(`No se puede eliminar: ${rutasAsociadas.length} ruta(s) dependen de ${cd.nombre}. Elimine o reasigne esas rutas primero.`, 'error');
        return;
      }
      // Verificar transportistas que prestan servicio en este centro
      const transAsociados = (db.transports || []).filter(t => (t.centrosServicio || []).includes(id));
      if (transAsociados.length > 0) {
        showAlert(`No se puede eliminar: ${transAsociados.length} transportista(s) prestan servicio en ${cd.nombre}.`, 'error');
        return;
      }

      if (!confirm(`¿Eliminar definitivamente el centro "${cd.nombre}" (${cd.id})?`)) return;

      db.logisticsCentres = db.logisticsCentres.filter(c => c.id !== id);
      saveDatabase(db);
      showAlert(`Centro ${cd.nombre} eliminado.`);
      renderLogisticsView(parentContainer);
    });
  });
}
