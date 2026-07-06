import { getDatabase, saveDatabase, calcEjes, getOrigenGroups } from './data.js?v=20260703b';
import { formatRut, validateRut, generateSapCode, parseCSV, showAlert, escapeHtml } from './utils.js';
import { renderFichaTransporte } from './ficha-transporte.js';
import { abrirModalTroncal } from './troncales.js';

let editingTransportId = null;
let filtroTipo = ''; // '' | 'ultima_milla' | 'troncal'

function computeFleetCapacity(list, centroId) {
  return list
    .filter(t => t.activo !== false && (!centroId || (t.centrosServicio || []).includes(centroId)))
    .reduce((acc, t) => acc + (t.camiones || []).reduce((a, c) => a + Number(c.capacidad || 0), 0), 0);
}

export function renderTransportsView(container) {
  const db = getDatabase();
  const ultimaMilla = (db.transports || []).map(t => ({ ...t, _tipo: 'ultima_milla' }));
  const troncales   = (db.troncales   || []).map(t => ({ ...t, _tipo: 'troncal' }));
  const allProviders = [...ultimaMilla, ...troncales];

  const totalUM  = ultimaMilla.length;
  const totalTR  = troncales.length;
  const activoUM = ultimaMilla.filter(t => t.activo !== false).length;
  const activoTR = troncales.filter(t => t.activo !== false).length;
  const capacidadTotal = allProviders.reduce((s, t) => s + (t.camiones || []).reduce((a, c) => a + Number(c.capacidad || 0), 0), 0);
  const cds = db.logisticsCentres || [];

  const tipoBtnClass = (tipo) => `prov-tipo-btn px-sm py-xs text-xs font-bold rounded border transition-colors flex items-center gap-xs cursor-pointer ${
    filtroTipo === tipo
      ? tipo === 'ultima_milla' ? 'bg-blue-600 text-white border-blue-600'
        : tipo === 'troncal'   ? 'bg-amber-500 text-white border-amber-500'
        : 'bg-primary text-white border-primary'
      : 'border-outline-variant text-secondary hover:bg-surface-container-high'
  }`;

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Proveedores de Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Gestione los proveedores de <b>Última Milla</b> (despacho directo a clientes) y <b>Troncales</b> (traslado entre sucursales para abastecimiento de stock).</p>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Proveedores</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${totalUM + totalTR}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">groups</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-blue-500 p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Última Milla</h4>
          <div class="font-headline-md text-headline-md font-bold text-blue-600 mt-1">${activoUM}<span class="text-secondary text-sm font-normal ml-1">/ ${totalUM}</span></div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-blue-400">local_shipping</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-amber-500 p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Troncal</h4>
          <div class="font-headline-md text-headline-md font-bold text-amber-600 mt-1">${activoTR}<span class="text-secondary text-sm font-normal ml-1">/ ${totalTR}</span></div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-amber-400">sync_alt</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-primary p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Capacidad Flota</h4>
          <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${capacidadTotal} Ton</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-primary">analytics</span>
      </div>
    </div>

    <!-- Tabla -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto flex-1 flex-wrap">
          <div class="relative w-full md:w-72 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="transport-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Razón Social, RUT…">
          </div>
          <div class="flex gap-xs flex-wrap">
            <button class="${tipoBtnClass('')}" data-tipo=""><span class="material-symbols-outlined text-[14px]">filter_list</span> Todos</button>
            <button class="${tipoBtnClass('ultima_milla')}" data-tipo="ultima_milla"><span class="material-symbols-outlined text-[14px]">local_shipping</span> Última Milla</button>
            <button class="${tipoBtnClass('troncal')}" data-tipo="troncal"><span class="material-symbols-outlined text-[14px]">sync_alt</span> Troncal</button>
          </div>
        </div>
        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-bulk-upload-transports" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">upload_file</span> Carga Masiva
          </button>
          <button id="btn-create-transport" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase shadow">
            <span class="material-symbols-outlined text-[18px]">add</span> Nuevo Proveedor
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">Tipo</th>
              <th class="p-md">Razón Social</th>
              <th class="p-md">RUT</th>
              <th class="p-md">Flota</th>
              <th class="p-md">Contacto</th>
              <th class="p-md">Estado</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="transports-table-body" class="font-body-md text-body-md"></tbody>
        </table>
      </div>
    </div>

    <!-- ═══ MODAL: Nuevo Proveedor ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="nuevo-proveedor-modal">
      <div class="modal-window w-[620px] max-w-[95vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Nuevo Proveedor</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-nuevo-proveedor">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg max-h-[80vh] overflow-y-auto space-y-md">
          <!-- Selector Tipo -->
          <div>
            <p class="font-label-caps text-label-caps text-secondary mb-sm">TIPO DE PROVEEDOR</p>
            <div class="grid grid-cols-2 gap-md">
              <button class="tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer border-blue-500 bg-blue-50" data-tipo="ultima_milla">
                <span class="material-symbols-outlined text-[36px] text-blue-600">local_shipping</span>
                <span class="font-bold text-blue-700 text-sm uppercase tracking-wide">Última Milla</span>
                <span class="text-[11px] text-secondary text-center leading-tight">Despacho directo a clientes finales</span>
              </button>
              <button class="tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer border-outline-variant text-secondary hover:border-amber-400 hover:bg-amber-50" data-tipo="troncal">
                <span class="material-symbols-outlined text-[36px]">sync_alt</span>
                <span class="font-bold text-sm uppercase tracking-wide">Troncal</span>
                <span class="text-[11px] text-center leading-tight">Traslado entre sucursales / abastecimiento de stock</span>
              </button>
            </div>
          </div>
          <!-- Campos comunes (iguales para ambos tipos) -->
          <div class="space-y-md border-t border-outline-variant pt-md">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
              <input type="text" id="np-razonsocial" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej. Transportes Express Ltda.">
            </div>
            <div class="grid grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">RUT EMPRESA</label>
                <input type="text" id="np-rut" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej: 76.849.201-3">
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">CÓDIGO SAP</label>
                <input type="text" id="np-codigosap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Auto-generado">
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN COMERCIAL</label>
              <input type="text" id="np-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej. Calle Principal 456, Maipú">
            </div>
            <div class="grid grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">TELÉFONO</label>
                <input type="text" id="np-telefono" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="+56 9 8888 7777">
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">CORREO ELECTRÓNICO</label>
                <input type="email" id="np-email" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="contacto@empresa.cl">
              </div>
            </div>
            <div class="bg-surface-container-low border border-outline-variant rounded p-sm text-[11px] text-secondary flex items-start gap-xs">
              <span class="material-symbols-outlined text-[14px] mt-px shrink-0">info</span>
              Una vez registrado el proveedor, podrás agregar patentes, choferes, documentos y centros logísticos desde el botón <b>Editar</b>.
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button id="btn-cancel-nuevo-proveedor" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
          <button id="btn-save-nuevo-proveedor" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase shadow">Crear Proveedor</button>
        </div>
      </div>
    </div>

    <!-- ═══ MODAL: Editar Última Milla ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="transport-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <div class="flex items-center gap-sm">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">ÚLTIMA MILLA</span>
            <h4 id="transport-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Editar Proveedor</h4>
          </div>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-transport-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="transport-form">
          <div class="p-lg space-y-md max-h-[70vh] overflow-y-auto">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
              <input type="text" id="t-razonsocial" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">RUT EMPRESA</label>
                <input type="text" id="t-rut" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
                <div id="t-rut-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> RUT bloqueado
                </div>
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">PATENTE CAMIÓN</label>
                <input type="text" id="t-patente" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
                <div id="t-patente-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> Patente bloqueada
                </div>
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">CÓDIGO SAP</label>
              <input type="text" id="t-codigosap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
              <div id="t-sap-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                <span class="material-symbols-outlined text-[12px]">lock</span> Código SAP bloqueado
              </div>
            </div>
            <div class="pt-sm border-t border-outline-variant space-y-md">
              <h5 class="font-label-caps text-label-caps text-primary">Datos de Contacto</h5>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN COMERCIAL</label>
                <input type="text" id="t-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
                <div class="space-y-xs">
                  <label class="font-label-caps text-label-caps text-secondary block">TELÉFONO</label>
                  <input type="text" id="t-telefono" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
                </div>
                <div class="space-y-xs">
                  <label class="font-label-caps text-label-caps text-secondary block">CORREO ELECTRÓNICO</label>
                  <input type="email" id="t-email" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" required>
                </div>
              </div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" id="btn-cancel-transport-modal" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ═══ MODAL: Carga Masiva CSV (Última Milla) ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva — Proveedores Última Milla (CSV)</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Archivo CSV delimitado por <code>;</code>. Encabezados requeridos:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">razonSocial;rut;direccion;telefono;email;patente;capacidad</code>
          </p>
          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center gap-sm" id="csv-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu CSV aquí o haz clic para buscar</span>
            <input type="file" id="csv-file-input" accept=".csv" class="hidden">
          </div>
          <div id="csv-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa (<span id="csv-count">0</span> registros):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Razón Social</th><th class="p-sm">RUT</th><th class="p-sm">Patente</th><th class="p-sm">Cap.</th><th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-preview-body"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase" id="btn-cancel-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs uppercase" id="btn-confirm-bulk" disabled>Importar</button>
        </div>
      </div>
    </div>
  `;

  // ── Renderizar tabla inicial ──────────────────────────────────────────────
  renderProveedoresTable(db, filtroTipo, '');

  // ── Estado del modal nuevo proveedor ─────────────────────────────────────
  let nuevoTipo = 'ultima_milla';

  function actualizarSelectorTipo(tipo) {
    nuevoTipo = tipo;
    container.querySelectorAll('.tipo-selector').forEach(btn => {
      const t = btn.dataset.tipo;
      if (t === 'ultima_milla') {
        btn.className = `tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer ${tipo === 'ultima_milla' ? 'border-blue-500 bg-blue-50' : 'border-outline-variant text-secondary hover:border-blue-300 hover:bg-blue-50/50'}`;
      } else {
        btn.className = `tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer ${tipo === 'troncal' ? 'border-amber-500 bg-amber-50' : 'border-outline-variant text-secondary hover:border-amber-300 hover:bg-amber-50/50'}`;
      }
    });
  }

  // ── Filtros de tipo ───────────────────────────────────────────────────────
  container.querySelectorAll('.prov-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filtroTipo = btn.dataset.tipo;
      renderTransportsView(container);
    });
  });

  // ── Filtro búsqueda ───────────────────────────────────────────────────────
  container.querySelector('#transport-search').addEventListener('input', (e) => {
    renderProveedoresTable(db, filtroTipo, e.target.value);
  });

  // ── Modal NUEVO PROVEEDOR ─────────────────────────────────────────────────
  const nuevoModal  = container.querySelector('#nuevo-proveedor-modal');
  const openNuevo   = () => { nuevoModal.classList.remove('pointer-events-none','opacity-0'); nuevoModal.querySelector('.modal-window').classList.remove('scale-95'); };
  const closeNuevo  = () => { nuevoModal.classList.add('pointer-events-none','opacity-0');    nuevoModal.querySelector('.modal-window').classList.add('scale-95'); };

  container.querySelector('#btn-create-transport').addEventListener('click', () => {
    container.querySelector('#np-razonsocial').value = '';
    container.querySelector('#np-rut').value = '';
    container.querySelector('#np-email').value = '';
    container.querySelector('#np-telefono').value = '';
    container.querySelector('#np-direccion').value = '';
    const activeDb = getDatabase();
    container.querySelector('#np-codigosap').value = generateSapCode('TRSP', activeDb.transports, 'codigoSap');
    actualizarSelectorTipo('ultima_milla');
    openNuevo();
  });
  container.querySelector('#btn-close-nuevo-proveedor').addEventListener('click', closeNuevo);
  container.querySelector('#btn-cancel-nuevo-proveedor').addEventListener('click', closeNuevo);

  container.querySelectorAll('.tipo-selector').forEach(btn => {
    btn.addEventListener('click', () => actualizarSelectorTipo(btn.dataset.tipo));
  });

  container.querySelector('#np-rut').addEventListener('blur', e => { e.target.value = formatRut(e.target.value); });

  container.querySelector('#btn-save-nuevo-proveedor').addEventListener('click', () => {
    const db2       = getDatabase();
    const razonSocial = (container.querySelector('#np-razonsocial').value || '').trim();
    const rut         = container.querySelector('#np-rut').value.trim();
    const codigoSap   = (container.querySelector('#np-codigosap').value || '').toUpperCase().trim();
    const direccion   = container.querySelector('#np-direccion').value.trim();
    const telefono    = container.querySelector('#np-telefono').value.trim();
    const email       = container.querySelector('#np-email').value.trim().toLowerCase();

    if (!razonSocial) { showAlert('La Razón Social es requerida.', 'error'); return; }
    if (!validateRut(rut)) { showAlert('El RUT ingresado no es válido.', 'error'); return; }

    const rutEnUltimaMilla = (db2.transports || []).some(t => t.rut === rut);
    const rutEnTroncal     = (db2.troncales  || []).some(t => t.rut === rut);
    if (rutEnUltimaMilla || rutEnTroncal) { showAlert('RUT ya registrado en proveedores.', 'error'); return; }

    if (nuevoTipo === 'ultima_milla') {
      const id = 't' + Date.now();
      db2.transports = db2.transports || [];
      db2.transports.push({
        id, razonSocial, rut, codigoSap, direccion, telefono, email,
        ownerEmail: email,
        activo: true,
        camiones: [],
        choferes: [],
        documentos: {},
        centrosServicio: []
      });
      saveDatabase(db2);
      showAlert(`Proveedor Última Milla "${razonSocial}" creado. Agrega patentes y choferes desde Editar.`);
    } else {
      db2.troncales = db2.troncales || [];
      db2.troncales.push({
        id: 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        razonSocial, rut, codigoSap, direccion, telefono, email,
        activo: true,
        camiones: [],
        choferes: [],
        documentos: {},
        rutasCobertura: [],
        centrosServicio: []
      });
      saveDatabase(db2);
      showAlert(`Proveedor Troncal "${razonSocial}" creado. Agrega patentes, choferes y rutas desde Editar.`);
    }

    closeNuevo();
    renderTransportsView(container);
  });

  // ── Modal EDITAR ÚLTIMA MILLA ─────────────────────────────────────────────
  const editModal  = container.querySelector('#transport-modal');
  const closeEdit  = () => { editModal.classList.add('pointer-events-none','opacity-0'); editModal.querySelector('.modal-window').classList.add('scale-95'); };
  container.querySelector('#btn-close-transport-modal').addEventListener('click', closeEdit);
  container.querySelector('#btn-cancel-transport-modal').addEventListener('click', closeEdit);
  container.querySelector('#t-rut').addEventListener('blur', e => { e.target.value = formatRut(e.target.value); });

  container.querySelector('#transport-form').addEventListener('submit', e => {
    e.preventDefault();
    const db2 = getDatabase();
    const idx = db2.transports.findIndex(t => t.id === editingTransportId);
    if (idx === -1) return;
    db2.transports[idx] = {
      ...db2.transports[idx],
      razonSocial: container.querySelector('#t-razonsocial').value,
      direccion:   container.querySelector('#t-direccion').value,
      telefono:    container.querySelector('#t-telefono').value,
      email:       container.querySelector('#t-email').value,
      ownerEmail:  container.querySelector('#t-email').value.trim().toLowerCase(),
    };
    saveDatabase(db2);
    showAlert('Proveedor actualizado correctamente.');
    closeEdit();
    renderTransportsView(container);
  });

  // ── Modal CARGA MASIVA CSV ────────────────────────────────────────────────
  const bulkModal = container.querySelector('#bulk-upload-modal');
  const closeBulk = () => { bulkModal.classList.add('pointer-events-none','opacity-0'); bulkModal.querySelector('.modal-window').classList.add('scale-95'); };
  container.querySelector('#btn-bulk-upload-transports').addEventListener('click', () => {
    bulkModal.classList.remove('pointer-events-none','opacity-0'); bulkModal.querySelector('.modal-window').classList.remove('scale-95');
  });
  container.querySelector('#btn-close-bulk-modal').addEventListener('click', closeBulk);
  container.querySelector('#btn-cancel-bulk').addEventListener('click', closeBulk);

  let parsedTransports = [];
  const csvDropzone  = container.querySelector('#csv-dropzone');
  const csvFileInput = container.querySelector('#csv-file-input');
  const btnConfirmBulk = container.querySelector('#btn-confirm-bulk');

  function handleCsvFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const rows = parseCSV(text);
      if (rows.length === 0) { showAlert('CSV vacío o formato incorrecto.', 'error'); return; }
      const db2 = getDatabase();
      parsedTransports = [];
      const previewBody = container.querySelector('#csv-preview-body');
      previewBody.innerHTML = '';
      rows.forEach(row => {
        const razonSocial = row.razonSocial || '';
        let rut = formatRut(row.rut || '');
        const direccion = row.direccion || '';
        const telefono  = row.telefono  || '';
        const email     = row.email     || '';
        const patente   = (row.patente || '').toUpperCase().replace(/\s+/g,'');
        const capacidad = Number(row.capacidad || 10);
        let error = '';
        if (!razonSocial) error = 'Falta Razón Social';
        else if (!validateRut(rut)) error = 'RUT inválido';
        else if (!patente || patente.length < 5) error = 'Patente incorrecta';
        else if ((db2.transports||[]).some(t => t.rut === rut)) error = 'RUT Duplicado';
        else if ((db2.transports||[]).some(t => t.patente === patente)) error = 'Patente Duplicada';
        const tr = document.createElement('tr');
        tr.className = 'border-b border-outline-variant';
        tr.innerHTML = `<td class="p-sm">${escapeHtml(razonSocial)}</td><td class="p-sm font-data-mono">${escapeHtml(rut)}</td><td class="p-sm font-data-mono">${escapeHtml(patente)}</td><td class="p-sm">${capacidad} Ton</td><td class="p-sm"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${error ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">${error || 'Listo'}</span></td>`;
        previewBody.appendChild(tr);
        if (!error) parsedTransports.push({ razonSocial, rut, direccion, telefono, email, patente, capacidad, activo: true });
      });
      container.querySelector('#csv-count').innerText = rows.length;
      container.querySelector('#csv-preview-container').classList.remove('hidden');
      btnConfirmBulk.disabled = parsedTransports.length === 0;
    };
    reader.readAsText(file);
  }

  csvDropzone.addEventListener('click', () => csvFileInput.click());
  csvDropzone.addEventListener('dragover', e => { e.preventDefault(); csvDropzone.classList.add('border-primary'); });
  csvDropzone.addEventListener('dragleave',  () => csvDropzone.classList.remove('border-primary'));
  csvDropzone.addEventListener('drop', e => { e.preventDefault(); csvDropzone.classList.remove('border-primary'); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]); });
  csvFileInput.addEventListener('change', e => { if (e.target.files[0]) handleCsvFile(e.target.files[0]); });

  btnConfirmBulk.addEventListener('click', () => {
    const db2 = getDatabase();
    parsedTransports.forEach(t => {
      t.id = 't' + Date.now() + Math.random().toString(36).substr(2,5);
      t.codigoSap = generateSapCode('TRSP', db2.transports, 'codigoSap');
      db2.transports.push(t);
    });
    saveDatabase(db2);
    showAlert(`${parsedTransports.length} proveedores importados.`);
    closeBulk();
    renderTransportsView(container);
  });
}

// ── Tabla unificada de Proveedores ────────────────────────────────────────────
function renderProveedoresTable(db, tipoFiltro, textoBusqueda) {
  const tbody = document.getElementById('transports-table-body');
  if (!tbody) return;

  const ultimaMilla = (db.transports || []).map(t => ({ ...t, _tipo: 'ultima_milla' }));
  const troncales   = (db.troncales   || []).map(t => ({ ...t, _tipo: 'troncal' }));
  let all = [...ultimaMilla, ...troncales];

  if (tipoFiltro) all = all.filter(p => p._tipo === tipoFiltro);
  if (textoBusqueda) {
    const q = textoBusqueda.toLowerCase();
    all = all.filter(p =>
      (p.razonSocial || '').toLowerCase().includes(q) ||
      (p.rut || '').toLowerCase().includes(q) ||
      (p.patente || '').toLowerCase().includes(q) ||
      (p.codigoSap || '').toLowerCase().includes(q)
    );
  }

  if (all.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-xl text-center text-secondary">No se encontraron proveedores.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  all.forEach(p => {
    const esUM = p._tipo === 'ultima_milla';
    const tipoBadge = esUM
      ? `<span class="inline-flex items-center gap-xs px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800"><span class="material-symbols-outlined text-[11px]">local_shipping</span> ÚLTIMA MILLA</span>`
      : `<span class="inline-flex items-center gap-xs px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800"><span class="material-symbols-outlined text-[11px]">sync_alt</span> TRONCAL</span>`;
    const statusBadge = p.activo !== false
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">ACTIVO</span>`
      : `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">DE BAJA</span>`;
    const flotaInfo = esUM
      ? `<span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded font-data-mono text-xs">${(p.camiones||[]).length} camión${(p.camiones||[]).length===1?'':'es'}</span>`
      : `<span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded font-data-mono text-xs">${(p.camiones||[]).length} cam. · ${(p.rutasCobertura||[]).length} ruta${(p.rutasCobertura||[]).length===1?'':'s'}</span>`;
    const contacto = esUM
      ? `<div class="text-xs font-bold leading-tight">${escapeHtml(p.email||'—')}</div><div class="text-[10px] text-secondary">${escapeHtml(p.telefono||'')}</div>`
      : `<div class="text-xs text-secondary">—</div>`;

    const tr = document.createElement('tr');
    tr.className = 'border-b border-outline-variant hover:bg-surface-container-low transition-colors';
    tr.innerHTML = `
      <td class="p-md">${tipoBadge}</td>
      <td class="p-md font-bold">${escapeHtml(p.razonSocial||'')}</td>
      <td class="p-md font-data-mono text-sm">${escapeHtml(p.rut||'')}</td>
      <td class="p-md">${flotaInfo}</td>
      <td class="p-md">${contacto}</td>
      <td class="p-md">${statusBadge}</td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          ${esUM ? `<button class="btn-ficha text-secondary hover:text-primary p-xs cursor-pointer" data-id="${p.id}" title="Ficha de transporte"><span class="material-symbols-outlined text-[20px]">folder_open</span></button>` : ''}
          <button class="btn-edit text-secondary hover:text-primary p-xs cursor-pointer" data-id="${p.id}" data-tipo="${p._tipo}" title="Editar"><span class="material-symbols-outlined text-[20px]">edit</span></button>
          <button class="btn-toggle text-secondary hover:text-primary p-xs cursor-pointer" data-id="${p.id}" data-tipo="${p._tipo}" title="${p.activo!==false?'Dar de baja':'Activar'}">
            <span class="material-symbols-outlined text-[20px] ${p.activo!==false?'text-red-500':'text-green-600'}">${p.activo!==false?'block':'check_circle'}</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Ficha (solo Última Milla)
  tbody.querySelectorAll('.btn-ficha').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      const stage = document.getElementById('stage-area');
      const pageTitle = document.getElementById('current-page-title');
      if (pageTitle) pageTitle.textContent = 'Ficha de Transporte';
      renderFichaTransporte(stage, id);
    });
  });

  // Editar
  tbody.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      const id   = e.currentTarget.dataset.id;
      const tipo = e.currentTarget.dataset.tipo;
      const db2  = getDatabase();

      if (tipo === 'ultima_milla') {
        const t = (db2.transports||[]).find(x => x.id === id);
        if (!t) return;
        editingTransportId = id;
        const editModal = document.getElementById('transport-modal');
        document.getElementById('t-razonsocial').value = t.razonSocial || '';
        document.getElementById('t-rut').value         = t.rut         || '';
        document.getElementById('t-patente').value     = t.patente     || '';
        document.getElementById('t-codigosap').value   = t.codigoSap   || '';
        document.getElementById('t-direccion').value   = t.direccion   || '';
        document.getElementById('t-telefono').value    = t.telefono    || '';
        document.getElementById('t-email').value       = t.email       || '';
        document.getElementById('transport-modal-title').textContent = 'Editar Proveedor Última Milla';
        // Bloquear campos de identidad
        ['t-rut','t-patente','t-codigosap'].forEach(fid => {
          const el = document.getElementById(fid);
          el.disabled = true;
          el.className = 'w-full border border-outline-variant p-sm font-body-md text-body-md rounded bg-[#E9ECEF] text-secondary cursor-not-allowed';
        });
        ['t-rut-lock-msg','t-patente-lock-msg','t-sap-lock-msg'].forEach(fid => {
          const el = document.getElementById(fid);
          if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
        });
        editModal.classList.remove('pointer-events-none','opacity-0');
        editModal.querySelector('.modal-window').classList.remove('scale-95');
      } else {
        // Troncal → modal de troncales
        const t = (db2.troncales||[]).find(x => x.id === id);
        if (!t) return;
        const grupos = getOrigenGroups(db2);
        abrirModalTroncal(t, grupos, db2, () => renderTransportsView(document.getElementById('stage-area')));
      }
    });
  });

  // Toggle activo/baja
  tbody.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      const id   = e.currentTarget.dataset.id;
      const tipo = e.currentTarget.dataset.tipo;
      const db2  = getDatabase();
      const arr  = tipo === 'ultima_milla' ? db2.transports : db2.troncales;
      const item = (arr||[]).find(x => x.id === id);
      if (!item) return;
      item.activo = item.activo === false ? true : false;
      saveDatabase(db2);
      showAlert(`${item.razonSocial} ${item.activo ? 'activado' : 'dado de baja'}.`);
      renderTransportsView(document.getElementById('stage-area'));
    });
  });
}

function setLockFields(isEdit) {
  // Kept for compatibility — handled inline in renderProveedoresTable
}
