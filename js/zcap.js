// Vista ZCAP — Costo de Servicio por Centro Logístico, Ruta y Tipo de Camión
// Regional:       ZCAP = costosBase[capKg].fijo + km × ratePerKm
// Interregional:  ZCAP = item10_costoRutaTotal
import { getDatabase, getTariffConfig, truckCapKg, getOrigenGroups, getGroupRepId, TRUCK_BASE_TYPES } from './data.js?v=20260630a';
import { calcularCostoRuta } from './tarifas-engine.js';
import { formatCLP, escapeHtml } from './utils.js';

const TRUCK_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];

let zcapFiltCentro = '';
let zcapFiltClasif = '';
let zcapFiltTruck  = '';
let zcapFiltRuta   = '';

export function renderZcapView(container) {
  const db  = getDatabase();
  const cfg = getTariffConfig(db);
  const centres  = (db.logisticsCentres || []).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const grupos   = getOrigenGroups(db);
  const allRoutes = (db.routes || []).filter(r => r.activo);

  function getGrupoForCentro(centroId) {
    const cd = centres.find(c => c.id === centroId);
    return grupos.find(g => g.grupo === (cd?.origen_grupo || ''));
  }

  function getTruckTypes(repId) {
    return (db.truckTypes || [])
      .filter(t => t.Id_centro === repId)
      .sort((a, b) => TRUCK_ORDER.indexOf(a.type) - TRUCK_ORDER.indexOf(b.type));
  }

  function calcZcapRow(ruta, truck) {
    const km = Number(ruta.km) || 0;
    if ((ruta.clasificRuta || '') === 'Regional') {
      // Costo base: usa truck.baseRate si está guardado; sino usa el default de TRUCK_BASE_TYPES
      const defaultBase = TRUCK_BASE_TYPES.find(b => b.type === truck.type)?.baseRate || 0;
      const costoBase = Number(truck.baseRate) || defaultBase;
      // Tarifa/KM: si la ruta es Isla o Extrema usa la tarifa especial
      const isExtrema = ['ISLA', 'EXTREMA'].includes((ruta.caracteristica || '').toUpperCase());
      const rate = isExtrema
        ? (Number(truck.ratePerKmExtrema) || Number(truck.ratePerKm) || 0)
        : (Number(truck.ratePerKm) || 0);
      return costoBase + km * rate;
    } else {
      // Interregional: motor de costo (ya incluye todos los costos)
      const capKg = truckCapKg(truck.type);
      if (!capKg) return 0;
      try {
        const result = calcularCostoRuta(db, cfg, ruta, capKg);
        return result.item10_costoRutaTotal || 0;
      } catch (_) { return 0; }
    }
  }

  function renderTable(centroId) {
    const centro = centres.find(c => c.id === centroId);
    if (!centro) return '<p class="text-secondary p-md">Seleccione un centro logístico.</p>';

    const grupo = getGrupoForCentro(centroId);
    if (!grupo) return '<p class="text-secondary p-md">Centro sin grupo de origen configurado.</p>';

    const repId  = grupo.repId;
    let trucks   = getTruckTypes(repId);
    if (zcapFiltTruck) trucks = trucks.filter(t => t.type === zcapFiltTruck);

    let rutas = allRoutes.filter(r => r.origen_grupo === centro.origen_grupo);
    if (zcapFiltClasif) rutas = rutas.filter(r => r.clasificRuta === zcapFiltClasif);
    if (zcapFiltRuta)   rutas = rutas.filter(r =>
      r.codigo?.toLowerCase().includes(zcapFiltRuta.toLowerCase()) ||
      r.destino?.toLowerCase().includes(zcapFiltRuta.toLowerCase())
    );
    rutas = rutas.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));

    if (rutas.length === 0 || trucks.length === 0) {
      return '<p class="text-secondary p-md">Sin rutas o tipos de camión para los filtros seleccionados.</p>';
    }

    // Construir filas: una fila por ruta × tipo de camión
    const rows = [];
    rutas.forEach(ruta => {
      trucks.forEach((truck, ti) => {
        const zcap = calcZcapRow(ruta, truck);
        rows.push({
          centroId: centro.id,
          centroNombre: centro.nombre,
          rutaId: ruta.id,
          rutaCodigo: ruta.codigo,
          destino: ruta.destino || '',
          clasif: ruta.clasificRuta || '',
          caracteristica: ruta.caracteristica || 'NORMAL',
          km: Number(ruta.km) || 0,
          truckType: truck.type,
          zcap,
          firstTruck: ti === 0
        });
      });
    });

    const clasifBadge = c => c === 'Regional'
      ? '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">REG</span>'
      : '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">INTER</span>';

    return `
      <div class="text-[12px] text-secondary mb-sm">${rutas.length} ruta(s) × ${trucks.length} tipo(s) = ${rows.length} combinaciones</div>
      <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">ID Centro</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">ID Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Denominación Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Clasif.</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Ruta ZCAP</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${rows.map((r, i) => {
              const zebra = Math.floor(i / trucks.length) % 2 === 0 ? '' : 'bg-surface-container-lowest';
              return `<tr class="border-b border-outline-variant ${zebra}">
                <td class="p-md font-data-mono text-data-mono ${r.firstTruck ? 'font-bold' : 'text-secondary'}">${r.firstTruck ? escapeHtml(r.centroId) : ''}</td>
                <td class="p-md font-data-mono text-data-mono ${r.firstTruck ? 'font-bold' : 'text-secondary'}">${r.firstTruck ? escapeHtml(r.rutaCodigo) : ''}</td>
                <td class="p-md ${r.firstTruck ? '' : 'text-secondary'}">${r.firstTruck ? escapeHtml(r.destino) : ''}</td>
                <td class="p-md">${r.firstTruck ? clasifBadge(r.clasif) : ''}</td>
                <td class="p-md text-right font-data-mono">${r.firstTruck ? r.km : ''}</td>
                <td class="p-md">${escapeHtml(r.truckType)}</td>
                <td class="p-md text-right font-data-mono font-bold text-primary">${r.zcap > 0 ? formatCLP(Math.round(r.zcap)) : '<span class="text-secondary font-normal">—</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function render() {
    container.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">price_check</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">ZCAP — Costo de Servicio por Centro y Ruta</h2>
        </div>
        <p class="text-[12px] text-secondary mb-md">
          <b>Rutas Regionales:</b> ZCAP = Costo Base (Variables Generales) + km × Tarifa/KM Normal. &nbsp;
          <b>Rutas Interregionales:</b> ZCAP = Costo Ruta Total (Motor de Costo Interregional).
        </p>

        <div class="flex flex-wrap gap-md items-end mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">CENTRO LOGÍSTICO</label>
            <select id="zcap-v-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-64">
              <option value="">Seleccione un centro</option>
              ${centres.map(c => {
                const g = getGrupoForCentro(c.id);
                return `<option value="${escapeHtml(c.id)}" ${c.id === zcapFiltCentro ? 'selected' : ''}>${escapeHtml(c.id)} — ${escapeHtml(c.nombre)}${g && g.grupo !== c.nombre ? ` (${escapeHtml(g.grupo)})` : ''}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">CLASIFICACIÓN</label>
            <select id="zcap-v-clasif" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
              <option value="">Todas</option>
              <option value="Regional"      ${zcapFiltClasif === 'Regional'      ? 'selected' : ''}>Regional</option>
              <option value="Interregional" ${zcapFiltClasif === 'Interregional' ? 'selected' : ''}>Interregional</option>
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO CAMIÓN</label>
            <select id="zcap-v-truck" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
              <option value="">Todos</option>
              ${TRUCK_ORDER.map(t => `<option value="${t}" ${zcapFiltTruck === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">BUSCAR RUTA / DESTINO</label>
            <input id="zcap-v-ruta" type="text" placeholder="Código o destino..."
              value="${escapeHtml(zcapFiltRuta)}"
              class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
          </div>
        </div>

        <div id="zcap-v-tabla">
          ${zcapFiltCentro
            ? renderTable(zcapFiltCentro)
            : '<p class="text-secondary">Seleccione un centro logístico para ver los costos ZCAP.</p>'}
        </div>
      </div>
    `;

    container.querySelector('#zcap-v-centro')?.addEventListener('change', e => {
      zcapFiltCentro = e.target.value; render();
    });
    container.querySelector('#zcap-v-clasif')?.addEventListener('change', e => {
      zcapFiltClasif = e.target.value; render();
    });
    container.querySelector('#zcap-v-truck')?.addEventListener('change', e => {
      zcapFiltTruck = e.target.value; render();
    });
    container.querySelector('#zcap-v-ruta')?.addEventListener('input', e => {
      zcapFiltRuta = e.target.value; render();
    });
  }

  render();
}
