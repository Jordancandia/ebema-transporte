import { getDatabase, saveDatabase } from './data.js?v=20260622m';
import { parseCSV, showAlert, escapeHtml, toCSV, downloadFile } from './utils.js';
import { REGIONES, COMUNAS_POR_REGION, TIPOS_ZONA, findRegionByComuna } from './chile-geo.js';

let editingZonaId = null;
let currentFiltroRegionZona = '';
let currentFiltroIncompletasZona = false;
let currentFiltroErpZona = ''; // '', 'erp', 'pendiente'

// --- Normalización de datos para Carga Masiva (CSV) ---
// Los archivos exportados desde Excel suelen traer encabezados en mayúsculas/distinta
// capitalización, sin tildes o con codificación incorrecta (Windows-1252/ISO-8859-1).
// Estas utilidades permiten reconocer las columnas y valores sin importar el formato.

// Normaliza una clave de columna: sin tildes, minúsculas, sin espacios ni símbolos.
// "País" / "PAIS" / "Pa�s" -> "pais"
export function normalizeKey(s) {
  return s.toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Normaliza un texto para comparación: sin tildes, minúsculas, espacios simples.
export function normalizeText(s) {
  return s.toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Busca el valor de una columna del CSV sin importar mayúsculas/tildes/espacios.
export function getField(row, ...names) {
  const normalizedRow = {};
  Object.keys(row).forEach(k => { normalizedRow[normalizeKey(k)] = row[k]; });
  for (const name of names) {
    const key = normalizeKey(name);
    if (normalizedRow[key] !== undefined) return normalizedRow[key];
  }
  return '';
}

// Alias de nombres de regiones (formato "REGION DE X" / "REGION DEL X" / sin tildes)
// hacia el formato estándar usado en chile-geo.js
const REGION_ALIASES = {
  'arica y parinacota': 'Arica y Parinacota',
  'tarapaca': 'Tarapacá',
  'antofagasta': 'Antofagasta',
  'atacama': 'Atacama',
  'coquimbo': 'Coquimbo',
  'valparaiso': 'Valparaíso',
  'metropolitana de santiago': 'Metropolitana de Santiago',
  'metropolitana': 'Metropolitana de Santiago',
  'libertador general bernardo ohiggins': "Libertador General Bernardo O'Higgins",
  'ohiggins': "Libertador General Bernardo O'Higgins",
  'maule': 'Maule',
  'nuble': 'Ñuble',
  'biobio': 'Biobío',
  'la araucania': 'La Araucanía',
  'araucania': 'La Araucanía',
  'los rios': 'Los Ríos',
  'los lagos': 'Los Lagos',
  'aysen': 'Aysén',
  'magallanes y de la antartica chilena': 'Magallanes y de la Antártica Chilena',
  'magallanes y antartica chilena': 'Magallanes y de la Antártica Chilena'
};

// Convierte un nombre de región en cualquier formato (ej. "REGION DE LOS RIOS")
// al nombre estándar usado por la plataforma (ej. "Los Ríos")
export function normalizeRegionName(raw) {
  if (!raw) return '';
  let s = normalizeText(raw);
  s = s.replace(/^region\s+(del|de)\s+/, '').replace(/^region\s+/, '');
  if (REGION_ALIASES[s]) return REGION_ALIASES[s];
  for (const key of Object.keys(REGION_ALIASES)) {
    if (s.startsWith(key)) return REGION_ALIASES[key];
  }
  const direct = REGIONES.find(r => normalizeText(r) === s);
  if (direct) return direct;
  return raw;
}

// Mapa de comunas normalizadas -> { comuna estándar, región } para reconocer
// comunas escritas en mayúsculas/sin tildes y completar la región si falta.
const COMUNA_LOOKUP = {};
Object.entries(COMUNAS_POR_REGION).forEach(([region, comunas]) => {
  comunas.forEach(c => {
    COMUNA_LOOKUP[normalizeText(c)] = { comuna: c, region };
  });
});

export function standardizeComuna(rawComuna) {
  if (!rawComuna) return { comuna: '', region: '' };
  const match = COMUNA_LOOKUP[normalizeText(rawComuna)];
  if (match) return match;
  return { comuna: rawComuna, region: '' };
}

// Indica si a una zona le falta completar Comuna, Región o Tipo
function zonaIncompleta(z) {
  return !z.comuna || !z.region || !z.tipo;
}

function fillRegionSelect(selectEl, selected) {
  selectEl.innerHTML = '<option value="">— Sin definir —</option>' +
    REGIONES.map(r => `<option value="${escapeHtml(r)}" ${r === selected ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
}

function fillComunaSelect(selectEl, region, selected) {
  const comunas = COMUNAS_POR_REGION[region] || [];
  let opciones = '<option value="">— Sin definir —</option>';
  // Si la comuna seleccionada no está en la lista de la región (dato cargado libre), se agrega igual
  if (selected && !comunas.includes(selected)) {
    opciones += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (no estándar)</option>`;
  }
  opciones += comunas.map(c => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  selectEl.innerHTML = opciones;
}

export function renderZonasView(container) {
  const db = getDatabase();
  if (!db.transportZones) db.transportZones = [];
  const zonas = db.transportZones;

  const total = zonas.length;
  const enErp = zonas.filter(z => z.estado_erp).length;
  const pendErp = total - enErp;
  const incompletas = zonas.filter(zonaIncompleta).length;

  container.innerHTML = `
    <!-- Tarjetas KPI -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Zonas</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${total}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">map</span>
      </div>
      <button type="button" id="kpi-zona-erp" class="bg-surface border ${currentFiltroErpZona === 'erp' ? 'border-green-500 ring-2 ring-green-300' : 'border-outline-variant'} p-md shadow-sm rounded flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas creadas en ERP">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Creadas en ERP</h4>
          <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${enErp}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
      </button>
      <button type="button" id="kpi-zona-pend-erp" class="bg-surface border ${currentFiltroErpZona === 'pendiente' ? 'border-red-500 ring-2 ring-red-300' : 'border-outline-variant'} p-md shadow-sm rounded flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas pendientes de ERP">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Pendientes ERP</h4>
          <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${pendErp}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-red-500">pending</span>
      </button>
      <button type="button" id="kpi-zona-incompletas" class="bg-surface border ${currentFiltroIncompletasZona ? 'border-amber-500 ring-2 ring-amber-300' : 'border-outline-variant'} p-md shadow-sm rounded border-l-4 border-amber-400 flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas con datos pendientes">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Datos a Completar</h4>
          <div class="font-headline-md text-headline-md font-bold text-amber-600 mt-1">${incompletas}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-amber-500">warning</span>
      </button>
    </div>

    <!-- Tabla -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto items-stretch md:items-center">
          <div class="relative w-full md:w-80 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="zona-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Zona, Denominación, Comuna, Región...">
          </div>
          <select id="zona-filter-region" class="w-full md:w-56 bg-surface-container-low border-none px-md py-xs font-body-md text-body-md focus:outline-none rounded">
            <option value="">Todas las regiones</option>
            ${REGIONES.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
          </select>
        </div>

        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-export-zonas-csv" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">download</span>
            Exportar CSV
          </button>
          <button id="btn-bulk-upload-zonas" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">upload_file</span>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-zona" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
            <span class="material-symbols-outlined text-[18px]">add</span>
            Nueva Zona
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">País</th>
              <th class="p-md">Zona</th>
              <th class="p-md">Denominación</th>
              <th class="p-md">Comuna</th>
              <th class="p-md">Región</th>
              <th class="p-md">Tipo</th>
              <th class="p-md">Estado ERP</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="zonas-table-body" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="zona-modal">
      <div class="modal-window w-[560px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 id="zona-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Nueva Zona de Transporte</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-zona-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="zona-form">
          <div class="p-lg space-y-md">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-pais" class="font-label-caps text-label-caps text-secondary block">PAÍS</label>
                <input type="text" id="z-pais" maxlength="2" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white uppercase" value="CL" required>
              </div>
              <div class="space-y-xs">
                <label for="z-zona" class="font-label-caps text-label-caps text-secondary block">ID ZONA (ÚNICO)</label>
                <input type="text" id="z-zona" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: ZT-0001">
              </div>
            </div>

            <div class="space-y-xs">
              <label for="z-denominacion" class="font-label-caps text-label-caps text-secondary block">DENOMINACIÓN (NOMBRE DEL DESTINO)</label>
              <input type="text" id="z-denominacion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: Maipú">
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-region" class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
                <select id="z-region" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <!-- Cargado dinámicamente -->
                </select>
              </div>
              <div class="space-y-xs">
                <label for="z-comuna" class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
                <select id="z-comuna" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <!-- Cargado dinámicamente según región -->
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-tipo" class="font-label-caps text-label-caps text-secondary block">TIPO</label>
                <select id="z-tipo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <option value="">— Sin definir —</option>
                  ${TIPOS_ZONA.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="space-y-xs">
                <label for="z-estado" class="font-label-caps text-label-caps text-secondary block">ESTADO EN ERP</label>
                <select id="z-estado" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <option value="false">Pendiente de creación en ERP</option>
                  <option value="true">Creada en ERP</option>
                </select>
              </div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-zona-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer">Guardar Zona</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-zonas-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Zonas de Transporte</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-zona-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Sube un archivo delimitado por punto y coma (<code>;</code>) o comas (<code>,</code>). Las primeras 3 columnas son obligatorias:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">
              pais;zona;denominacion
            </code>
            Opcionalmente puede incluir: <code class="font-data-mono text-xs">comuna, region, tipo, estado</code>. Si una zona no incluye comuna, región o tipo, quedará marcada como "Completar Datos" para definirla luego desde la plataforma.
            <br>El campo <code class="font-data-mono text-xs">estado</code> indica si la zona ya está creada en SAP/ERP: <code class="font-data-mono text-xs">1</code> = Creada en ERP, <code class="font-data-mono text-xs">0</code> = Pendiente de creación en ERP.
          </p>

          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-sm" id="csv-zona-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu archivo CSV de zonas aquí o haz clic para buscar</span>
            <input type="file" id="csv-zona-input" accept=".csv" class="hidden">
          </div>

          <div id="csv-zona-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa de Zonas Detectadas (<span id="csv-zona-count">0</span>):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Zona</th>
                    <th class="p-sm">Denominación</th>
                    <th class="p-sm">Comuna/Región/Tipo</th>
                    <th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-zona-preview-body">
                  <!-- Dinámico -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-zona-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-confirm-zona-bulk" disabled>Importar registros</button>
        </div>
      </div>
    </div>
  `;

  // Selects dependientes Región -> Comuna
  const regionSelect = document.getElementById('z-region');
  const comunaSelect = document.getElementById('z-comuna');
  fillRegionSelect(regionSelect, '');
  fillComunaSelect(comunaSelect, '', '');
  regionSelect.addEventListener('change', () => {
    fillComunaSelect(comunaSelect, regionSelect.value, '');
  });

  // Auto-completar región al elegir una comuna estándar (cuando aún no hay región definida)
  comunaSelect.addEventListener('change', () => {
    if (!regionSelect.value && comunaSelect.value) {
      const region = findRegionByComuna(comunaSelect.value);
      if (region) {
        fillRegionSelect(regionSelect, region);
        fillComunaSelect(comunaSelect, region, comunaSelect.value);
      }
    }
  });

  // Buscador + filtros (Región, Datos a Completar)
  const searchInput = document.getElementById('zona-search');
  const regionFilterEl = document.getElementById('zona-filter-region');
  regionFilterEl.value = currentFiltroRegionZona;

  const applyZonaFilters = () => {
    const term = searchInput.value.toLowerCase();
    let filtered = zonas.filter(z =>
      (z.zona || '').toLowerCase().includes(term) ||
      (z.denominacion || '').toLowerCase().includes(term) ||
      (z.comuna || '').toLowerCase().includes(term) ||
      (z.region || '').toLowerCase().includes(term)
    );
    if (currentFiltroRegionZona) {
      filtered = filtered.filter(z => z.region === currentFiltroRegionZona);
    }
    if (currentFiltroIncompletasZona) {
      filtered = filtered.filter(zonaIncompleta);
    }
    if (currentFiltroErpZona === 'erp') {
      filtered = filtered.filter(z => z.estado_erp);
    } else if (currentFiltroErpZona === 'pendiente') {
      filtered = filtered.filter(z => !z.estado_erp);
    }
    renderZonasTable(filtered);
    return filtered;
  };

  searchInput.addEventListener('input', applyZonaFilters);

  regionFilterEl.addEventListener('change', () => {
    currentFiltroRegionZona = regionFilterEl.value;
    applyZonaFilters();
  });

  // KPI "Datos a Completar": al hacer click, filtra/des-filtra la tabla
  const kpiIncompletas = document.getElementById('kpi-zona-incompletas');
  if (kpiIncompletas) {
    kpiIncompletas.addEventListener('click', () => {
      currentFiltroIncompletasZona = !currentFiltroIncompletasZona;
      currentFiltroErpZona = '';
      renderZonasView(container);
    });
  }

  // KPI "Creadas en ERP": al hacer click, filtra zonas con estado_erp=true
  const kpiErp = document.getElementById('kpi-zona-erp');
  if (kpiErp) {
    kpiErp.addEventListener('click', () => {
      currentFiltroErpZona = currentFiltroErpZona === 'erp' ? '' : 'erp';
      currentFiltroIncompletasZona = false;
      renderZonasView(container);
    });
  }

  // KPI "Pendientes ERP": al hacer click, filtra zonas con estado_erp=false
  const kpiPendErp = document.getElementById('kpi-zona-pend-erp');
  if (kpiPendErp) {
    kpiPendErp.addEventListener('click', () => {
      currentFiltroErpZona = currentFiltroErpZona === 'pendiente' ? '' : 'pendiente';
      currentFiltroIncompletasZona = false;
      renderZonasView(container);
    });
  }

  // Exportar tabla (filtrada) a CSV
  document.getElementById('btn-export-zonas-csv').addEventListener('click', () => {
    const filtered = applyZonaFilters();
    if (filtered.length === 0) {
      showAlert('No hay zonas para exportar con los filtros actuales.', 'error');
      return;
    }
    const headers = ['País', 'Zona', 'Denominación', 'Comuna', 'Región', 'Tipo', 'Estado ERP'];
    const csvRows = filtered.map(z => [
      z.pais || 'CL',
      z.zona || '',
      z.denominacion || '',
      z.comuna || '',
      z.region || '',
      z.tipo || '',
      z.estado_erp ? 'EN ERP' : 'PENDIENTE'
    ]);
    const csv = toCSV(headers, csvRows);
    downloadFile(`zonas_transporte_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });

  // Renderizar tabla aplicando filtros persistidos (Región / Datos a Completar)
  applyZonaFilters();

  // Modal Crear/Editar
  const zonaModal = document.getElementById('zona-modal');
  const zonaForm = document.getElementById('zona-form');

  const openModal = () => {
    zonaModal.classList.remove('pointer-events-none', 'opacity-0');
    zonaModal.querySelector('.modal-window').classList.remove('scale-95');
  };
  const closeModal = () => {
    zonaModal.classList.add('pointer-events-none', 'opacity-0');
    zonaModal.querySelector('.modal-window').classList.add('scale-95');
  };

  document.getElementById('btn-create-zona').addEventListener('click', () => {
    editingZonaId = null;
    zonaForm.reset();
    document.getElementById('zona-modal-title').innerText = 'Nueva Zona de Transporte';
    document.getElementById('z-pais').value = 'CL';
    fillRegionSelect(regionSelect, '');
    fillComunaSelect(comunaSelect, '', '');
    document.getElementById('z-estado').value = 'false';
    openModal();
  });

  document.getElementById('btn-close-zona-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-zona-modal').addEventListener('click', closeModal);

  zonaForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const activeDb = getDatabase();
    if (!activeDb.transportZones) activeDb.transportZones = [];

    const zonaData = {
      zona: document.getElementById('z-zona').value.trim().toUpperCase(),
      pais: document.getElementById('z-pais').value.trim().toUpperCase() || 'CL',
      denominacion: document.getElementById('z-denominacion').value.trim(),
      comuna: document.getElementById('z-comuna').value || null,
      region: document.getElementById('z-region').value || null,
      tipo: document.getElementById('z-tipo').value || null,
      estado_erp: document.getElementById('z-estado').value === 'true'
    };

    if (!zonaData.zona) {
      showAlert('Debe ingresar el ID de la Zona.', 'error');
      return;
    }

    if (editingZonaId) {
      const idx = activeDb.transportZones.findIndex(z => z.zona === editingZonaId);
      if (idx !== -1) {
        // Si cambia el ID de zona, validar que no choque con otra existente
        if (zonaData.zona !== editingZonaId && activeDb.transportZones.some(z => z.zona === zonaData.zona)) {
          showAlert('Ya existe una zona con ese ID.', 'error');
          return;
        }
        // Preservar created_at original (no enviar null al actualizar)
        zonaData.created_at = activeDb.transportZones[idx].created_at || new Date().toISOString();
        activeDb.transportZones[idx] = zonaData;
        saveDatabase(activeDb);
        showAlert('Zona de transporte actualizada correctamente.');
      }
    } else {
      if (activeDb.transportZones.some(z => z.zona === zonaData.zona)) {
        showAlert('Ya existe una zona registrada con ese ID.', 'error');
        return;
      }
      zonaData.created_at = new Date().toISOString();
      activeDb.transportZones.push(zonaData);
      saveDatabase(activeDb);
      showAlert('Zona de transporte registrada con éxito.');
    }

    closeModal();
    renderZonasView(container);
  });

  // --- CARGA MASIVA DE ZONAS ---
  const bulkModal = document.getElementById('bulk-upload-zonas-modal');
  const btnCloseBulk = document.getElementById('btn-close-zona-bulk-modal');
  const btnCancelBulk = document.getElementById('btn-cancel-zona-bulk');
  const btnConfirmBulk = document.getElementById('btn-confirm-zona-bulk');
  const csvDropzone = document.getElementById('csv-zona-dropzone');
  const csvFileInput = document.getElementById('csv-zona-input');

  let parsedZonas = [];

  document.getElementById('btn-bulk-upload-zonas').addEventListener('click', () => {
    parsedZonas = [];
    btnConfirmBulk.disabled = true;
    document.getElementById('csv-zona-preview-container').classList.add('hidden');
    document.getElementById('csv-zona-preview-body').innerHTML = '';
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
    if (e.dataTransfer.files.length > 0) handleCsvZonaFile(e.dataTransfer.files[0]);
  });
  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCsvZonaFile(e.target.files[0]);
  });

  function handleCsvZonaFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const buffer = e.target.result;
      let text = new TextDecoder('utf-8').decode(buffer);
      // Los archivos exportados desde Excel suelen venir en Windows-1252/ISO-8859-1.
      // Si la decodificación UTF-8 produce caracteres de reemplazo (�) en tildes/ñ,
      // se reintenta con Windows-1252.
      if (text.includes('�')) {
        text = new TextDecoder('windows-1252').decode(buffer);
      }
      const rows = parseCSV(text);
      if (rows.length === 0) {
        showAlert('El archivo CSV está vacío o no tiene el formato correcto.', 'error');
        return;
      }

      const activeDb = getDatabase();
      if (!activeDb.transportZones) activeDb.transportZones = [];
      parsedZonas = [];
      const previewBody = document.getElementById('csv-zona-preview-body');
      previewBody.innerHTML = '';
      const seen = new Set();

      rows.forEach(row => {
        const pais = (getField(row, 'pais', 'país') || 'CL').trim().toUpperCase() || 'CL';
        const zona = (getField(row, 'zona', 'idzona', 'id zona') || '').trim().toUpperCase();
        const denominacion = (getField(row, 'denominacion', 'denominación') || '').trim();
        let comuna = (getField(row, 'comuna') || '').trim();
        let region = normalizeRegionName((getField(row, 'region', 'región') || '').trim());
        let tipo = (getField(row, 'tipo') || '').trim();
        tipo = TIPOS_ZONA.find(t => t.toLowerCase() === tipo.toLowerCase()) || '';
        // Convención del campo "estado": 1 = Creada en ERP, 0 (o vacío) = Pendiente de creación en ERP.
        // También se aceptan equivalentes de texto (si/true/creada/erp) por compatibilidad.
        const estadoRaw = (getField(row, 'estado', 'estado_erp', 'estadoerp') || '').trim().toLowerCase();
        const estado_erp = ['1', 'si', 'sí', 'true', 'creada', 'erp'].includes(estadoRaw);

        // Estandarizar nombre de comuna (mayúsculas/sin tildes) e inferir región si falta
        if (comuna) {
          const std = standardizeComuna(comuna);
          comuna = std.comuna;
          if (!region && std.region) region = std.region;
        }
        // Si aún falta región pero la comuna estándar la define, se infiere
        if (!region && comuna) region = findRegionByComuna(comuna) || '';

        let error = '';
        if (!pais) error = 'Falta País';
        else if (!zona) error = 'Falta ID Zona';
        else if (!denominacion) error = 'Falta Denominación';
        else if (activeDb.transportZones.some(z => z.zona === zona) || seen.has(zona)) error = 'Zona Duplicada';

        const incompleto = !error && (!comuna || !region || !tipo);

        const tr = document.createElement('tr');
        tr.className = "border-b border-outline-variant";
        tr.innerHTML = `
          <td class="p-sm font-data-mono">${escapeHtml(zona)}</td>
          <td class="p-sm">${escapeHtml(denominacion)}</td>
          <td class="p-sm text-secondary">${escapeHtml(comuna) || '—'} / ${escapeHtml(region) || '—'} / ${escapeHtml(tipo) || '—'}</td>
          <td class="p-sm">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${error ? 'bg-red-100 text-red-800' : (incompleto ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800')}">
              ${error ? error : (incompleto ? 'Completar Datos' : 'Listo')}
            </span>
          </td>
        `;
        previewBody.appendChild(tr);

        if (!error) {
          seen.add(zona);
          parsedZonas.push({
            zona, pais: pais || 'CL', denominacion,
            comuna: comuna || null,
            region: region || null,
            tipo: tipo || null,
            estado_erp,
            created_at: new Date().toISOString()
          });
        }
      });

      document.getElementById('csv-zona-count').innerText = rows.length;
      document.getElementById('csv-zona-preview-container').classList.remove('hidden');

      if (parsedZonas.length > 0) {
        btnConfirmBulk.disabled = false;
      } else {
        showAlert('No se encontraron registros de zonas válidos.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  btnConfirmBulk.addEventListener('click', () => {
    const activeDb = getDatabase();
    if (!activeDb.transportZones) activeDb.transportZones = [];
    parsedZonas.forEach(z => activeDb.transportZones.push(z));
    saveDatabase(activeDb);
    showAlert(`Se importaron ${parsedZonas.length} zonas de transporte correctamente.`);
    closeBulkModal();
    renderZonasView(container);
  });

  // Función auxiliar para abrir el modal en modo edición (usada por la tabla)
  window.__openZonaEditModal = (zonaId) => {
    const activeDb = getDatabase();
    const z = (activeDb.transportZones || []).find(item => item.zona === zonaId);
    if (!z) return;

    editingZonaId = zonaId;
    document.getElementById('z-pais').value = z.pais || 'CL';
    document.getElementById('z-zona').value = z.zona;
    document.getElementById('z-denominacion').value = z.denominacion || '';
    fillRegionSelect(regionSelect, z.region || '');
    fillComunaSelect(comunaSelect, z.region || '', z.comuna || '');
    document.getElementById('z-tipo').value = z.tipo || '';
    document.getElementById('z-estado').value = z.estado_erp ? 'true' : 'false';

    document.getElementById('zona-modal-title').innerText = 'Editar Zona de Transporte';
    openModal();
  };
}

function renderZonasTable(zonasList) {
  const tbody = document.getElementById('zonas-table-body');
  if (!tbody) return;

  if (zonasList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="p-xl text-center text-secondary">
          No se encontraron zonas de transporte registradas.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  zonasList.forEach(z => {
    const tr = document.createElement('tr');
    const incompleto = zonaIncompleta(z);
    tr.className = `border-b border-outline-variant hover:bg-surface-container-low transition-colors ${incompleto ? 'bg-amber-50/60' : ''}`;

    const statusBg = z.estado_erp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
    const campoPendiente = (valor) => valor
      ? escapeHtml(valor)
      : `<span class="inline-flex items-center gap-1 text-amber-700 font-bold text-[10px] uppercase"><span class="material-symbols-outlined text-[14px]">warning</span> Completar</span>`;

    tr.innerHTML = `
      <td class="p-md font-data-mono">${escapeHtml(z.pais || 'CL')}</td>
      <td class="p-md font-bold text-primary font-data-mono">${escapeHtml(z.zona)}</td>
      <td class="p-md">${escapeHtml(z.denominacion)}</td>
      <td class="p-md text-xs">${campoPendiente(z.comuna)}</td>
      <td class="p-md text-xs">${campoPendiente(z.region)}</td>
      <td class="p-md text-xs">${campoPendiente(z.tipo)}</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusBg}">
          ${z.estado_erp ? 'EN ERP' : 'PENDIENTE'}
        </span>
      </td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          <button class="btn-edit-zona text-secondary hover:text-primary p-xs cursor-pointer" data-id="${escapeHtml(z.zona)}" title="Editar zona">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button class="btn-toggle-zona text-secondary hover:text-primary p-xs cursor-pointer" data-id="${escapeHtml(z.zona)}" title="${z.estado_erp ? 'Marcar como pendiente' : 'Marcar como creada en ERP'}">
            <span class="material-symbols-outlined text-[20px] ${z.estado_erp ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}">
              ${z.estado_erp ? 'unpublished' : 'check_circle'}
            </span>
          </button>
          <button class="btn-delete-zona text-secondary hover:text-red-700 p-xs cursor-pointer" data-id="${escapeHtml(z.zona)}" title="Eliminar zona">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit-zona').forEach(btn => {
    btn.addEventListener('click', (e) => window.__openZonaEditModal(e.currentTarget.getAttribute('data-id')));
  });

  tbody.querySelectorAll('.btn-toggle-zona').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const z = (db.transportZones || []).find(item => item.zona === id);
      if (z) {
        z.estado_erp = !z.estado_erp;
        saveDatabase(db);
        showAlert(`La zona ${z.zona} fue marcada como ${z.estado_erp ? 'creada en ERP' : 'pendiente'}.`);
        const subContent = document.getElementById('rutas-subview-content');
        if (subContent) renderZonasView(subContent);
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-zona').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const db = getDatabase();
      const idx = (db.transportZones || []).findIndex(item => item.zona === id);
      if (idx !== -1) {
        if (!confirm(`¿Eliminar la zona ${id}? Esta acción no se puede deshacer.`)) return;
        db.transportZones.splice(idx, 1);
        saveDatabase(db);
        showAlert(`La zona ${id} ha sido eliminada.`);
        const subContent = document.getElementById('rutas-subview-content');
        if (subContent) renderZonasView(subContent);
        // Refrescar KPIs
        const stageArea = document.getElementById('stage-area');
        if (stageArea) {
          const event = new Event('db_updated');
          window.dispatchEvent(event);
        }
      }
    });
  });
}
