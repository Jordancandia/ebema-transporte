// Vista ZCAP — Costo de Servicio por Centro Logístico, Ruta y Tipo de Camión
// Regional:       ZCAP = Costo Base + km × Tarifa/KM
// Interregional:  ZCAP = item10_costoRutaTotal (motor completo)
// Troncales:      ZCAP = motor completo para rutas definidas por el usuario
import { getDatabase, saveDatabase, getTariffConfig, truckCapKg, getOrigenGroups, TRUCK_BASE_TYPES } from './data.js?v=20260712b';
import { calcularCostoRuta } from './tarifas-engine.js?v=20260712b';
import { formatCLP, escapeHtml } from './utils.js';

const TRUCK_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];
const ZCAP_PAGE   = 50;

// Grupos que comparten configuración de Tarifas por Camión con otro grupo.
// La clave es el grupo origen de la ruta; el valor es el grupo cuya config se usa.
// Ej: rutas BDO (SAN BERNARDO) usan los truckTypes configurados en SANTIAGO.
const GRUPO_TARIFF_SOURCE = {
  'SAN BERNARDO': 'SANTIAGO',
};

let zcapFiltTipo  = 'regional';   // 'regional'|'interregional'|'troncales'|'todas'
let zcapFiltTruck = '';
let zcapFiltRuta  = '';
let zcapTabCentro = '__todos__';  // grupo activo; '__todos__' = todos
let zcapPagina    = 0;

// ── Helpers ────────────────────────────────────────────────────────────────
function renderPagerZ(total, pagina, prevId, nextId) {
  if (total <= ZCAP_PAGE) return '';
  const totalPags = Math.ceil(total / ZCAP_PAGE);
  const desde = pagina * ZCAP_PAGE + 1;
  const hasta  = Math.min((pagina + 1) * ZCAP_PAGE, total);
  const dp = pagina === 0 ? 'opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  const dn = pagina >= totalPags - 1 ? 'opacity-40 cursor-default' : 'hover:bg-surface-container-high cursor-pointer';
  return `<div class="flex items-center justify-between mt-sm pt-sm border-t border-outline-variant text-[12px] text-secondary">
    <span>${desde.toLocaleString('es-CL')}–${hasta.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')} filas</span>
    <div class="flex items-center gap-xs">
      <button id="${prevId}" class="px-sm py-xs border border-outline-variant rounded ${dp}" ${pagina===0?'disabled':''}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_left</span>
      </button>
      <span class="px-sm">Pág. ${pagina+1} / ${totalPags}</span>
      <button id="${nextId}" class="px-sm py-xs border border-outline-variant rounded ${dn}" ${pagina>=totalPags-1?'disabled':''}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_right</span>
      </button>
    </div>
  </div>`;
}

function clasifBadge(ruta, troncalesSet) {
  if (troncalesSet.has(ruta.codigo))
    return '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">TRONC</span>';
  return ruta.clasificRuta === 'Regional'
    ? '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">REG</span>'
    : '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">INTER</span>';
}

// ── Cálculo ZCAP ───────────────────────────────────────────────────────────
function calcZcapRow(db, cfg, ruta, truck, troncalesSet) {
  const km        = Number(ruta.km) || 0;
  const esTroncal = troncalesSet.has(ruta.codigo);

  if (!esTroncal && ruta.clasificRuta === 'Regional') {
    // ZCAP Regional:
    //   Con KM Base: B.CostoBase + C.TBaseKM + max(0, km − KMBase) × D.Tarifa/KM
    //     Si km ≤ KMBase → tarifa plana = B + C  (sin extra km)
    //   Sin KM Base (KMBase=0): B.CostoBase + km × D.Tarifa/KM
    const defaultBase = TRUCK_BASE_TYPES.find(b => b.type === truck.type)?.baseRate || 0;
    // Usar ?? para no tratar 0 como "sin valor" — baseRate=0 es válido para 28 Ton
    const costoBase   = truck.baseRate != null ? Number(truck.baseRate) : defaultBase;  // C: T.Base KM
    const baseCosto   = truck.baseKM   != null ? Number(truck.baseKM)   : 0;            // B: Costo Base
    const isExtrema   = ['ISLA','EXTREMA'].includes((ruta.caracteristica||'').toUpperCase());
    const rate = isExtrema
      ? (Number(truck.ratePerKmExtrema) || Number(truck.ratePerKm) || 0)
      : (Number(truck.ratePerKm) || 0);
    const kmBase = truck.Kmbase != null ? Number(truck.Kmbase) : 0;
    // Siempre: B + C + max(0, km − KMBase) × D
    // KMBase=0 → extra = km×D (sin tramo fijo). KMBase>0 y km≤KMBase → extra=0 (tarifa plana B+C)
    return (costoBase + baseCosto) + Math.max(0, km - kmBase) * rate;
  }
  // Interregional o Troncal → motor completo
  const capKg = truckCapKg(truck.type);
  if (!capKg) return 0;
  // soloIda: ruta troncal marcada con toggle IDA en el panel de configuración
  const soloIdaKey = ruta.codigo + '||' + truck.type;
  const soloIda = esTroncal && (cfg.variables?.troncalesSoloIda || []).includes(soloIdaKey);
  try { return calcularCostoRuta(db, cfg, ruta, capKg, { soloIda }).item10_costoRutaTotal || 0; }
  catch (_) { return 0; }
}

// ── Builder de filas ZCAP (compartido por tabla y exportación CSV) ──────────
function buildZcapRows(db, cfg, grupos, rutas, troncalesSet) {
  let rutasFilt = [...rutas];
  if (zcapFiltRuta) {
    const q = zcapFiltRuta.toLowerCase();
    rutasFilt = rutasFilt.filter(r =>
      r.codigo?.toLowerCase().includes(q) || r.destino?.toLowerCase().includes(q)
    );
  }
  rutasFilt.sort((a, b) => (a.codigo||'').localeCompare(b.codigo||''));
  const rows = [];
  rutasFilt.forEach(ruta => {
    const skipOrigenId = String(ruta.origenId) === '1000';
    const grupo = (!skipOrigenId && grupos.find(g => (g.centroIds||[]).map(String).includes(String(ruta.origenId))))
      || grupos.find(g => g.grupo === ruta.origen_grupo);
    if (!grupo) return;
    const tariffGrupoNombre = GRUPO_TARIFF_SOURCE[grupo.grupo] || grupo.grupo;
    const tariffGrupo = grupos.find(g => g.grupo === tariffGrupoNombre) || grupo;
    let trucks = (db.truckTypes||[])
      .filter(t => t.Id_centro === tariffGrupo.repId)
      .sort((a,b) => TRUCK_ORDER.indexOf(a.type) - TRUCK_ORDER.indexOf(b.type));
    if (zcapFiltTruck) trucks = trucks.filter(t => t.type === zcapFiltTruck);
    // Para troncales: excluir combos ruta+camión que el usuario eliminó individualmente
    if (troncalesSet.has(ruta.codigo)) {
      const excluidas = new Set(cfg.variables?.troncalesExcluidas || []);
      trucks = trucks.filter(t => !excluidas.has(ruta.codigo + '||' + t.type));
    }
    if (!trucks.length) return;
    trucks.forEach((truck, ti) => {
      rows.push({
        ruta, grupo, truck,
        zcap: calcZcapRow(db, cfg, ruta, truck, troncalesSet),
        firstTruck: ti === 0,
        truckCount: trucks.length
      });
    });
  });
  return { rows, rutasFilt };
}

// ── Exportar CSV con los datos actuales filtrados ──────────────────────────
function exportZcapCSV(db, cfg, grupos, rutas, troncalesSet) {
  const { rows } = buildZcapRows(db, cfg, grupos, rutas, troncalesSet);
  if (!rows.length) return;
  const sep = ';';
  const cols = ['Centro','Cod Ruta','Destino','Clasificacion','Tipo','KM','Tipo Camion','ZCAP'];
  const lines = [cols.join(sep)];
  rows.forEach(r => {
    lines.push([
      r.grupo.nombre || r.grupo.grupo,
      r.ruta.codigo || '',
      r.ruta.destino || '',
      r.ruta.clasificRuta || '',
      r.ruta.tipo || '',
      Number(r.ruta.km) || 0,
      r.truck.type,
      r.zcap > 0 ? Math.round(r.zcap) : 0
    ].map(v => '"' + String(v).replace(/"/g, '\\"') + '"').join(sep));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'zcap_' + zcapTabCentro + '_' + zcapFiltTipo + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Tabla de resultados ────────────────────────────────────────────────────
function renderTablaRutas(db, cfg, grupos, rutas, troncalesSet) {
  const { rows, rutasFilt } = buildZcapRows(db, cfg, grupos, rutas, troncalesSet);

  if (!rutasFilt.length)
    return '<p class="text-secondary text-[12px] p-md">Sin rutas para los filtros seleccionados.</p>';

  if (!rows.length)
    return '<p class="text-secondary text-[12px] p-md">Sin combinaciones ruta × camión.</p>';

  const esTroncalView = zcapFiltTipo === 'troncales';
  const pageRows = rows.slice(zcapPagina * ZCAP_PAGE, (zcapPagina+1) * ZCAP_PAGE);
  return `
    <div class="text-[12px] text-secondary mb-sm">${rutasFilt.length} ruta(s) — ${rows.length} combinaciones</div>
    <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
      <table class="w-full border-collapse text-[12px]">
        <thead>
          <tr class="bg-surface-container-high text-left border-b border-outline-variant">
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Cód. Ruta</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">ZCAP</th>
            ${esTroncalView ? '<th class="p-md font-label-caps text-label-caps text-secondary uppercase">Modo / Acción</th>' : ''}
          </tr>
        </thead>
        <tbody class="font-body-md text-body-md">
          ${pageRows.map((r, i) => {
            const gi = zcapPagina * ZCAP_PAGE + i;
            const z  = Math.floor(gi / (r.truckCount||1)) % 2 === 0 ? '' : 'bg-surface-container-lowest';
            let modoCel = '';
            if (esTroncalView) {
              const idaKey = r.ruta.codigo + '||' + r.truck.type;
              const isSoloIda = (cfg.variables?.troncalesSoloIda || []).includes(idaKey);
              modoCel = `<td class="p-md">
                <div class="flex items-center gap-xs">
                  <button class="zcap-row-ida px-sm py-[2px] rounded text-[10px] font-bold border transition-colors ${isSoloIda
                    ? 'bg-blue-500 border-blue-600 text-white'
                    : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}"
                    data-cod="${escapeHtml(r.ruta.codigo||'')}"
                    data-truck="${escapeHtml(r.truck.type)}"
                    title="${isSoloIda
                      ? 'Solo IDA: peajes y combustible solo tramo ida. Clic → IDA+VUELTA'
                      : 'IDA+VUELTA: cálculo completo. Clic → solo IDA'}">
                    ${isSoloIda ? 'IDA' : 'IDA+V'}
                  </button>
                  <button class="zcap-row-rm text-secondary hover:text-red-600 transition-colors"
                    data-cod="${escapeHtml(r.ruta.codigo||'')}"
                    data-truck="${escapeHtml(r.truck.type)}"
                    title="Quitar este camión de troncales">
                    <span class="material-symbols-outlined text-[16px] align-middle">remove_circle_outline</span>
                  </button>
                </div>
              </td>`;
            }
            return `<tr class="border-b border-outline-variant ${z}">
              <td class="p-md font-data-mono text-[11px] ${r.firstTruck?'font-bold':'text-secondary'}">${r.firstTruck ? escapeHtml(r.grupo.nombre||r.grupo.grupo) : ''}</td>
              <td class="p-md font-data-mono text-[11px] ${r.firstTruck?'font-bold text-primary':'text-secondary'}">${r.firstTruck ? escapeHtml(r.ruta.codigo||'') : ''}</td>
              <td class="p-md ${r.firstTruck?'':'text-secondary text-[11px]'}">${r.firstTruck ? escapeHtml(r.ruta.destino||'') : ''}</td>
              <td class="p-md">${r.firstTruck ? clasifBadge(r.ruta, troncalesSet) : ''}</td>
              <td class="p-md text-right font-data-mono text-[11px]">${r.firstTruck ? (Number(r.ruta.km)||0) : ''}</td>
              <td class="p-md text-[11px]">${escapeHtml(r.truck.type)}</td>
              <td class="p-md text-right font-data-mono font-bold text-primary">${r.zcap>0 ? formatCLP(Math.round(r.zcap)) : '<span class="text-secondary font-normal">—</span>'}</td>
              ${modoCel}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${renderPagerZ(rows.length, zcapPagina, 'zcap-prev', 'zcap-next')}`;
}

// ── Panel config Troncales ─────────────────────────────────────────────────
function renderPanelTroncales(cfg, db, container, onChangeFn) {
  const panel = container.querySelector('#zcap-troncales-config');
  if (!panel) return;
  const list      = cfg.variables.troncalesRoutes || [];
  const allRoutes = (db.routes||[]).filter(r => r.activo);

  panel.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 rounded p-md mb-md">
      <div class="flex items-center gap-sm mb-sm">
        <span class="material-symbols-outlined text-amber-700 text-[18px]">settings</span>
        <span class="font-bold text-[13px] text-amber-900">Rutas Troncales (${list.length})</span>
        <span class="text-[11px] text-amber-700 italic ml-sm">Usan Motor de Costo completo para ZCAP</span>
      </div>
      <div class="flex gap-sm mb-sm">
        <input id="zcap-tronc-input" type="text" placeholder="Código de ruta (ej: CON518)"
          list="zcap-tronc-list"
          class="border border-amber-300 bg-white p-sm font-data-mono text-[12px] w-52 rounded">
        <datalist id="zcap-tronc-list">
          ${allRoutes.map(r => `<option value="${escapeHtml(r.codigo||'')}"></option>`).join('')}
        </datalist>
        <button id="zcap-tronc-add"
          class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-md py-sm rounded text-[12px] flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px]">add</span> Agregar
        </button>
      </div>
      ${list.length ? `<div class="text-[11px] text-amber-700 italic">Rutas activas: ${list.join(', ')} — configurar IDA/IDA+V o quitar desde la tabla.</div>` : '<div class="text-[11px] text-amber-600 italic">Sin rutas troncales. Agrégalas con el campo de arriba.</div>'}
    </div>`;

  panel.querySelector('#zcap-tronc-add')?.addEventListener('click', () => {
    const inp = panel.querySelector('#zcap-tronc-input');
    const cod = (inp?.value||'').trim().toUpperCase();
    if (!cod) return;
    if (!cfg.variables.troncalesRoutes.includes(cod)) {
      cfg.variables.troncalesRoutes.push(cod);
      saveDatabase(db);
    }
    if (inp) inp.value = '';
    renderPanelTroncales(cfg, db, container, onChangeFn);
    onChangeFn();
  });
}

// ── Render tabla central ───────────────────────────────────────────────────
function renderContenido(db, cfg, grupos, container) {
  const troncalesSet = new Set(cfg.variables?.troncalesRoutes || []);
  const allRoutes    = (db.routes||[]).filter(r => r.activo);

  let rutas;
  if      (zcapFiltTipo === 'regional')       rutas = allRoutes.filter(r => r.clasificRuta==='Regional'      && !troncalesSet.has(r.codigo));
  else if (zcapFiltTipo === 'interregional')  rutas = allRoutes.filter(r => r.clasificRuta==='Interregional' && !troncalesSet.has(r.codigo));
  else if (zcapFiltTipo === 'troncales')      rutas = allRoutes.filter(r => troncalesSet.has(r.codigo));
  else                                         rutas = allRoutes;

  if (zcapTabCentro !== '__todos__') {
    const g   = grupos.find(go => go.grupo === zcapTabCentro);
    const ids = new Set((g?.centroIds||[]).map(String).filter(id => id !== '1000'));
    rutas = rutas.filter(r => r.origen_grupo === zcapTabCentro || ids.has(String(r.origenId)));
  }

  const el = container.querySelector('#zcap-contenido');
  if (!el) return;
  el.innerHTML = renderTablaRutas(db, cfg, grupos, rutas, troncalesSet);
  el.querySelector('#zcap-prev')?.addEventListener('click', () => { zcapPagina = Math.max(0, zcapPagina-1); renderContenido(db,cfg,grupos,container); });
  el.querySelector('#zcap-next')?.addEventListener('click', () => { zcapPagina++; renderContenido(db,cfg,grupos,container); });

  // Listeners para toggle IDA/IDA+V y quitar de troncales (columna Modo en vista Troncales)
  const reRenderPanel = () => {
    if (zcapFiltTipo === 'troncales')
      renderPanelTroncales(cfg, db, container, () => renderContenido(db, cfg, grupos, container));
  };
  el.querySelectorAll('.zcap-row-ida').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!cfg.variables.troncalesSoloIda) cfg.variables.troncalesSoloIda = [];
      const key = btn.dataset.cod + '||' + btn.dataset.truck;
      const idx = cfg.variables.troncalesSoloIda.indexOf(key);
      if (idx >= 0) cfg.variables.troncalesSoloIda.splice(idx, 1);
      else cfg.variables.troncalesSoloIda.push(key);
      saveDatabase(db);
      renderContenido(db, cfg, grupos, container);
    });
  });
  el.querySelectorAll('.zcap-row-rm').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.cod + '||' + btn.dataset.truck;
      if (!cfg.variables.troncalesExcluidas) cfg.variables.troncalesExcluidas = [];
      if (!cfg.variables.troncalesExcluidas.includes(key))
        cfg.variables.troncalesExcluidas.push(key);
      // Limpiar soloIda de esta combinación
      if (cfg.variables.troncalesSoloIda)
        cfg.variables.troncalesSoloIda = cfg.variables.troncalesSoloIda.filter(k => k !== key);
      saveDatabase(db);
      renderContenido(db, cfg, grupos, container);
      reRenderPanel();
    });
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
export function renderZcapView(container) {
  const db  = getDatabase();
  const cfg = getTariffConfig(db);
  if (!cfg.variables) cfg.variables = {};
  if (!cfg.variables.troncalesRoutes) cfg.variables.troncalesRoutes = [];
  if (!cfg.variables.troncalesExcluidas) cfg.variables.troncalesExcluidas = [];
  const grupos = getOrigenGroups(db);

  function render() {
    container.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">price_check</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Tarifas Rutas — Costo de Servicio por Ruta y Tipo de Camión</h2>
        </div>

        <!-- Toggle tipo -->
        <div class="flex items-center gap-xs mb-md flex-wrap">
          <span class="font-label-caps text-label-caps text-secondary mr-sm text-[11px]">TIPO:</span>
          ${[['regional','Regional'],['interregional','Interregional'],['troncales','Troncales'],['todas','Todas']].map(([v,l]) => `
          <button class="zcap-tipo-btn px-md py-xs rounded border text-[12px] font-bold uppercase transition-colors ${zcapFiltTipo===v
            ? 'bg-primary text-white border-primary'
            : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}" data-tipo="${v}">${l}</button>`).join('')}
        </div>

        <!-- Panel troncales -->
        <div id="zcap-troncales-config" class="${zcapFiltTipo==='troncales'?'':'hidden'}"></div>

        <!-- Tabs por centro -->
        <div class="flex gap-xs mb-md flex-wrap border-b border-outline-variant pb-sm">
          ${[{grupo:'__todos__', nombre:'Todos'}, ...grupos].map(g => `
          <button class="zcap-tab-btn px-md py-xs rounded-t border text-[12px] font-bold uppercase transition-colors ${zcapTabCentro===g.grupo
            ? 'bg-primary text-white border-primary'
            : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}"
            data-tab="${escapeHtml(g.grupo)}">${escapeHtml(g.nombre||g.grupo)}</button>`).join('')}
        </div>

        <!-- Filtros secundarios -->
        <div class="flex flex-wrap gap-md items-end mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO CAMIÓN</label>
            <select id="zcap-v-truck" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
              <option value="">Todos</option>
              ${TRUCK_ORDER.map(t => `<option value="${t}" ${zcapFiltTruck===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">BUSCAR RUTA / DESTINO</label>
            <input id="zcap-v-ruta" type="text" placeholder="Código o destino..."
              value="${escapeHtml(zcapFiltRuta)}"
              class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
          </div>
          <div class="flex items-end gap-sm ml-auto">
            <button id="zcap-btn-actualizar"
              class="flex items-center gap-xs px-md py-sm border border-outline-variant bg-white hover:bg-surface-container-high rounded text-[12px] font-bold text-on-surface transition-colors">
              <span class="material-symbols-outlined text-[16px]">refresh</span>
              Actualizar Tarifas
            </button>
            <button id="zcap-btn-csv"
              class="flex items-center gap-xs px-md py-sm border border-primary bg-primary hover:bg-primary/90 rounded text-[12px] font-bold text-white transition-colors">
              <span class="material-symbols-outlined text-[16px]">download</span>
              Descargar CSV
            </button>
          </div>
        </div>

        <!-- Tabla -->
        <div id="zcap-contenido"></div>
      </div>`;

    if (zcapFiltTipo === 'troncales') {
      renderPanelTroncales(cfg, db, container, () => renderContenido(db, cfg, grupos, container));
    }
    renderContenido(db, cfg, grupos, container);

    // Listeners tipo
    container.querySelectorAll('.zcap-tipo-btn').forEach(btn => {
      btn.addEventListener('click', () => { zcapFiltTipo = btn.dataset.tipo; zcapPagina = 0; render(); });
    });

    // Listeners tabs
    container.querySelectorAll('.zcap-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        zcapTabCentro = btn.dataset.tab; zcapPagina = 0;
        container.querySelectorAll('.zcap-tab-btn').forEach(b => {
          b.className = `zcap-tab-btn px-md py-xs rounded-t border text-[12px] font-bold uppercase transition-colors ${b.dataset.tab===zcapTabCentro
            ? 'bg-primary text-white border-primary'
            : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}`;
        });
        renderContenido(db, cfg, grupos, container);
      });
    });

    container.querySelector('#zcap-v-truck')?.addEventListener('change', e => {
      zcapFiltTruck = e.target.value; zcapPagina = 0; renderContenido(db, cfg, grupos, container);
    });

    container.querySelector('#zcap-v-ruta')?.addEventListener('input', e => {
      const pos = e.target.selectionStart;
      zcapFiltRuta = e.target.value; zcapPagina = 0;
      renderContenido(db, cfg, grupos, container);
      const inp = container.querySelector('#zcap-v-ruta');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    });

    container.querySelector('#zcap-btn-actualizar')?.addEventListener('click', () => {
      render();
    });

    container.querySelector('#zcap-btn-csv')?.addEventListener('click', () => {
      const troncalesSet2 = new Set(cfg.variables?.troncalesRoutes || []);
      const allRoutes2    = (db.routes||[]).filter(r => r.activo);
      let rutas2;
      if      (zcapFiltTipo === 'regional')       rutas2 = allRoutes2.filter(r => r.clasificRuta==='Regional'      && !troncalesSet2.has(r.codigo));
      else if (zcapFiltTipo === 'interregional')  rutas2 = allRoutes2.filter(r => r.clasificRuta==='Interregional' && !troncalesSet2.has(r.codigo));
      else if (zcapFiltTipo === 'troncales')      rutas2 = allRoutes2.filter(r => troncalesSet2.has(r.codigo));
      else                                         rutas2 = allRoutes2;
      if (zcapTabCentro !== '__todos__') {
        const g2   = grupos.find(go => go.grupo === zcapTabCentro);
        const ids2 = new Set((g2?.centroIds||[]).map(String).filter(id => id !== '1000'));
        rutas2 = rutas2.filter(r => r.origen_grupo === zcapTabCentro || ids2.has(String(r.origenId)));
      }
      exportZcapCSV(db, cfg, grupos, rutas2, troncalesSet2);
    });
  }

  render();
}
