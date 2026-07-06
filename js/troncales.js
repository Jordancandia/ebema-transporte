import { getDatabase, saveDatabase, getOrigenGroups } from './data.js?v=20260703b';
import { showAlert, escapeHtml } from './utils.js';

const CAPACIDADES = ['5', '10', '15', '28'];

function generarId() {
  return 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function parseCamiones(db) {
  return (db.troncales || []).map(t => ({
    ...t,
    camiones: t.camiones || [],
    rutasCobertura: t.rutasCobertura || []
  }));
}

export function renderTroncalesView(container) {
  const db = getDatabase();
  let troncales = parseCamiones(db);
  let filtroTexto = '';

  function render() {
    const grupos = getOrigenGroups(db);
    const filtered = troncales.filter(t => {
      if (!filtroTexto) return true;
      const q = filtroTexto.toLowerCase();
      return (t.razonSocial || '').toLowerCase().includes(q)
        || (t.rut || '').toLowerCase().includes(q);
    });

    const totalTroncales = filtered.length;
    const activeTroncales = filtered.filter(t => t.activo !== false).length;
    const totalCamiones = filtered.reduce((sum, t) => sum + (t.camiones || []).length, 0);
    const totalCapacidad = filtered.reduce((sum, t) => sum + (t.camiones || []).reduce((a, c) => a + Number(c.capacidad || 0), 0), 0);

    container.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary">sync_alt</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Camiones Troncales</h2>
          </div>
          <div class="flex items-center gap-sm">
            <input id="tr-filtro" type="text" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48 rounded" placeholder="Buscar..." value="${escapeHtml(filtroTexto)}">
            <button id="tr-nuevo" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
              <span class="material-symbols-outlined text-[18px]">add</span> Nuevo Troncal
            </button>
          </div>
        </div>

        <!-- Tarjetas de Estadísticas KPI -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Troncales</h4>
              <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${totalTroncales}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-secondary">sync_alt</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Activos</h4>
              <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${activeTroncales}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded border-l-4 border-primary flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Camiones</h4>
              <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${totalCamiones}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-primary">local_shipping</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Capacidad Flota</h4>
              <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${totalCapacidad} Ton</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-red-500">analytics</span>
          </div>
        </div>

        <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
          <table class="w-full zebra-table border-collapse">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Razón Social</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">RUT</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Rutas de Cobertura</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Flota</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Activo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${filtered.length === 0 ? `<tr><td colspan="6" class="p-md text-center text-secondary">No hay camiones troncales registrados.</td></tr>` :
                filtered.map(t => {
                  const rutasStr = t.rutasCobertura.map(r => `${r.origen} → ${r.destino}`).join(', ') || '—';
                  const flotaStr = t.camiones.map(c => `${c.patente} (${c.capacidad}T)`).join(', ') || '—';
                  return `<tr class="border-b border-outline-variant">
                    <td class="p-md font-bold">${escapeHtml(t.razonSocial || '')}</td>
                    <td class="p-md">${escapeHtml(t.rut || '')}</td>
                    <td class="p-md text-[12px]">${escapeHtml(rutasStr)}</td>
                    <td class="p-md text-[12px]">${escapeHtml(flotaStr)}</td>
                    <td class="p-md text-center">${t.activo !== false
                      ? '<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">SÍ</span>'
                      : '<span class="inline-flex items-center px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]">NO</span>'}</td>
                    <td class="p-md text-center">
                      <button class="tr-editar text-secondary hover:text-primary" data-id="${t.id}" title="Editar">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button class="tr-eliminar text-secondary hover:text-primary ml-sm" data-id="${t.id}" title="Eliminar">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-secondary mt-sm">${filtered.length} registro(s)</p>
      </div>
    `;

    document.getElementById('tr-filtro').addEventListener('input', (e) => {
      filtroTexto = e.target.value;
      render();
    });

    document.getElementById('tr-nuevo').addEventListener('click', () => abrirModalTroncal(null, grupos, db, render));

    container.querySelectorAll('.tr-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = troncales.find(x => x.id === btn.dataset.id);
        if (t) abrirModal(t, grupos, db, render);
      });
    });

    container.querySelectorAll('.tr-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('¿Eliminar este troncal?')) return;
        db.troncales = (db.troncales || []).filter(x => x.id !== btn.dataset.id);
        saveDatabase(db);
        troncales = parseCamiones(db);
        render();
      });
    });
  }

  render();
}

function cerrarModal(el) {
  el.classList.remove('active');
  setTimeout(() => el.remove(), 300);
}

export function abrirModalTroncal(troncal, grupos, db, onSave) {
  const esNuevo = !troncal;
  const t = troncal || { id: generarId(), razonSocial: '', rut: '', activo: true, camiones: [], rutasCobertura: [] };

  const centrosOrigen = grupos.map(g => ({ value: g.grupo, label: g.nombre }));

  const el = document.createElement('div');
  el.className = 'modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300';
  el.innerHTML = `
    <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
      <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">sync_alt</span>
          ${esNuevo ? 'Nuevo Troncal' : 'Editar Troncal'}
        </h4>
        <button class="text-secondary hover:text-primary cursor-pointer" id="t-cerrar">
          <span class="material-symbols-outlined text-[24px]">close</span>
        </button>
      </div>
      <div class="p-lg space-y-md max-h-[70vh] overflow-y-auto">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
          <div class="space-y-xs">
            <label for="t-razon" class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
            <input id="t-razon" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Ej. Transportes Troncal Express" value="${escapeHtml(t.razonSocial || '')}">
          </div>
          <div class="space-y-xs">
            <label for="t-rut" class="font-label-caps text-label-caps text-secondary block">RUT</label>
            <input id="t-rut" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Ej: 76.849.201-3" value="${escapeHtml(t.rut || '')}">
          </div>
        </div>

        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">RUTAS DE COBERTURA (origen → destino entre centros)</label>
          <div id="t-rutas-container" class="space-y-sm">
            ${(t.rutasCobertura.length === 0
              ? '<p class="text-[12px] text-secondary">Sin rutas asignadas.</p>'
              : t.rutasCobertura.map((r, i) => rutaRow(r, i, centrosOrigen)).join(''))}
          </div>
          <button id="t-add-ruta" class="text-primary text-[12px] font-bold flex items-center gap-xs mt-sm cursor-pointer hover:underline">
            <span class="material-symbols-outlined text-[16px]">add_circle</span> Agregar Ruta
          </button>
        </div>

        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">FLOTA DE CAMIONES</label>
          <div id="t-camiones-container" class="space-y-sm">
            ${(t.camiones.length === 0
              ? '<p class="text-[12px] text-secondary">Sin camiones registrados.</p>'
              : t.camiones.map((c, i) => camionRow(c, i)).join(''))}
          </div>
          <button id="t-add-camion" class="text-primary text-[12px] font-bold flex items-center gap-xs mt-sm cursor-pointer hover:underline">
            <span class="material-symbols-outlined text-[16px]">add_circle</span> Agregar Camión
          </button>
        </div>

        <div class="flex items-center gap-sm">
          <input type="checkbox" id="t-activo" ${t.activo !== false ? 'checked' : ''} class="w-4 h-4 text-primary border-outline-variant rounded focus:ring-primary">
          <label for="t-activo" class="font-body-md text-body-md">Activo</label>
        </div>
      </div>
      <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
        <button id="t-cancel" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
        <button id="t-save" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase shadow">${esNuevo ? 'Crear Troncal' : 'Guardar Cambios'}</button>
      </div>
    </div>`;

  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('active'));

  const cerrar = () => cerrarModal(el);

  el.querySelector('#t-cerrar').addEventListener('click', cerrar);
  el.querySelector('#t-cancel').addEventListener('click', cerrar);
  el.addEventListener('click', (e) => {
    if (e.target === el) cerrar();
  });

  el.querySelector('#t-add-ruta').addEventListener('click', () => {
    const container = el.querySelector('#t-rutas-container');
    const idx = container.querySelectorAll('.ruta-row').length;
    container.insertAdjacentHTML('beforeend', rutaRow({ origen: '', destino: '' }, idx, centrosOrigen));
  });

  el.querySelector('#t-add-camion').addEventListener('click', () => {
    const container = el.querySelector('#t-camiones-container');
    const idx = container.querySelectorAll('.camion-row').length;
    container.insertAdjacentHTML('beforeend', camionRow({ patente: '', modelo: '', capacidad: '28', ejes: 3 }, idx));
  });

  el.querySelector('#t-save').addEventListener('click', () => {
    const razonSocial = el.querySelector('#t-razon').value.trim();
    const rut = el.querySelector('#t-rut').value.trim();
    if (!razonSocial) return showAlert('La Razón Social es obligatoria.', 'error');

    const rutas = [];
    el.querySelectorAll('.ruta-row').forEach(row => {
      const origen = row.querySelector('.ruta-origen').value;
      const destino = row.querySelector('.ruta-destino').value;
      if (origen && destino) rutas.push({ origen, destino });
    });

    const camiones = [];
    el.querySelectorAll('.camion-row').forEach(row => {
      const patente = row.querySelector('.cam-patente').value.trim();
      const modelo = row.querySelector('.cam-modelo').value.trim();
      const capacidad = Number(row.querySelector('.cam-capacidad').value) || 28;
      const ejes = Number(row.querySelector('.cam-ejes').value) || 3;
      if (patente) camiones.push({ patente, modelo, capacidad, ejes });
    });

    const data = {
      id: t.id,
      razonSocial,
      rut,
      activo: el.querySelector('#t-activo').checked,
      rutasCobertura: rutas,
      camiones
    };

    if (esNuevo) {
      db.troncales = db.troncales || [];
      db.troncales.push(data);
    } else {
      const idx = (db.troncales || []).findIndex(x => x.id === t.id);
      if (idx !== -1) db.troncales[idx] = data;
    }

    saveDatabase(db);
    cerrar();
    showAlert(esNuevo ? 'Troncal creado.' : 'Troncal actualizado.');
    onSave();
  });
}

function rutaRow(r, idx, centros) {
  const opts = centros.map(c =>
    `<option value="${c.value}" ${r.origen === c.value ? 'selected' : ''}>${c.label}</option>`
  ).join('');
  const optsD = centros.map(c =>
    `<option value="${c.value}" ${r.destino === c.value ? 'selected' : ''}>${c.label}</option>`
  ).join('');
  return `<div class="ruta-row flex gap-sm items-center">
    <select class="ruta-origen border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all">${opts}</select>
    <span class="text-secondary">→</span>
    <select class="ruta-destino border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all">${optsD}</select>
    <button type="button" class="ruta-remove text-red-600 hover:text-red-800 cursor-pointer" title="Eliminar ruta">
      <span class="material-symbols-outlined text-[18px]">remove_circle</span>
    </button>
  </div>`;
}

function camionRow(c, idx) {
  const caps = CAPACIDADES.map(cap =>
    `<option value="${cap}" ${String(c.capacidad) === cap ? 'selected' : ''}>${cap} Ton</option>`
  ).join('');
  return `<div class="camion-row flex gap-sm items-center">
    <input type="text" class="cam-patente border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-28 focus:border-primary focus:ring-0 transition-all" placeholder="Patente" value="${escapeHtml(c.patente || '')}">
    <input type="text" class="cam-modelo border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all" placeholder="Modelo" value="${escapeHtml(c.modelo || '')}">
    <select class="cam-capacidad border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-28 focus:border-primary focus:ring-0 transition-all">${caps}</select>
    <select class="cam-ejes border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-24 focus:border-primary focus:ring-0 transition-all">
      <option value="2" ${c.ejes === 2 ? 'selected' : ''}>2 Ejes</option>
      <option value="3" ${c.ejes === 3 ? 'selected' : ''}>3 Ejes</option>
    </select>
    <button type="button" class="camion-remove text-red-600 hover:text-red-800 cursor-pointer" title="Eliminar camión">
      <span class="material-symbols-outlined text-[18px]">remove_circle</span>
    </button>
  </div>`;
}
