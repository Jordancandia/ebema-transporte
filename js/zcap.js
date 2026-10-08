// Vista ZCAP — Costo de Servicio por Centro Logístico, Ruta y Tipo de Camión
// Regional:       ZCAP = Costo Base + km × Tarifa/KM
// Interregional:  ZCAP = item10_costoRutaTotal (motor completo)
// Troncales:      ZCAP = motor completo para rutas definidas por el usuario
import { getDatabase, saveDatabase, getTariffConfig, truckCapKg, getOrigenGroups, TRUCK_BASE_TYPES } from './data.js?v=202610082027';
import { calcularCostoRuta } from './tarifas-engine.js?v=202610082027';
import { showAlert } from './utils.js';
import { can } from './permisos.js?v=202610082027';
import { esc, fmt, clp, numIn, wireNumIns, rerenderKeepFocus, debounce, chainHtml, wireChain, changesBarHtml, wireChangesBar, textoImpacto, setParamPill, usuarioSesion, clasifPill, carPill } from './tarifas-ui.js?v=202610082027';

const TRUCK_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];

// Grupos que comparten configuración de Tarifas por Camión con otro grupo.
// La clave es el grupo origen de la ruta; el valor es el grupo cuya config se usa.
// Ej: rutas BDO (SAN BERNARDO) usan los truckTypes configurados en SANTIAGO.
const GRUPO_TARIFF_SOURCE = {
  'SAN BERNARDO': 'SANTIAGO',
};


// ── Helpers ────────────────────────────────────────────────────────────────


// ── Cálculo ZCAP ───────────────────────────────────────────────────────────
export function calcZcapRow(db, cfg, ruta, truck, troncalesSet) {
  const km        = Number(ruta.km) || 0;
  const esTroncal = troncalesSet.has(ruta.codigo);

  if (!esTroncal && ruta.clasificRuta === 'Regional') {
    // ZCAP Regional (regla de negocio confirmada 27-sep-2026):
    //   ZCAP = Costo Base (baseRate) + Costo Base KM (baseKM) + max(0, km ruta − Km Base) × Tarifa/KM
    //   Si km ≤ Km Base → tarifa plana = Costo Base + Costo Base KM. Km Base = 0 → se cobra el km completo.
    //   Tarifa/KM = tarifa AJUSTADA (rateAjustNorm / rateAjustEsp si la ruta es ISLA/EXTREMA);
    //   si no hay ajustada, usa la ponderada calculada por el motor (ratePerKm / ratePerKmExtrema).
    const defaultBase = TRUCK_BASE_TYPES.find(b => b.type === truck.type)?.baseRate || 0;
    const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
    const costoBase   = num(truck.baseRate) ?? defaultBase;
    const costoBaseKm = num(truck.baseKM) ?? 0;
    const isExtrema   = ['ISLA','EXTREMA'].includes((ruta.caracteristica||'').toUpperCase());
    const rateNorm    = num(truck.rateAjustNorm) || num(truck.ratePerKm) || 0;
    const rate = isExtrema
      ? (num(truck.rateAjustEsp) || num(truck.ratePerKmExtrema) || rateNorm)
      : rateNorm;
    const kmBase      = num(truck.Kmbase) ?? 0;
    return costoBase + costoBaseKm + Math.max(0, km - kmBase) * rate;
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

// ── ZCAP manual (rediseño 29-sep-2026) ─────────────────────────────────────
// Un ZCAP manual > 0 reemplaza al calculado para esa ruta × camión. Se guarda en
// tariff_config.data.zcapManual = { "CODIGO||Camión X Ton": { valor, by, at } }.
// El ZCAP VIGENTE (manual si existe, si no el calculado) es el que alimenta
// Tarifas $/Kg, Min/Max y el Cotizador (vía buildZcapMap).
export const zcapKey = (ruta, truck) => (ruta.codigo || '') + '||' + (truck.type || truck);
export function zcapManualValor(cfg, key) {
  const e = (cfg.zcapManual || {})[key];
  const v = e && typeof e === 'object' ? Number(e.valor) : Number(e);
  return v > 0 ? v : 0;
}

// Rutas activas del mismo grupo de tarifas con sus camiones (compartido por la
// vista, el CSV y buildZcapMap).
function combosRuta(db, cfg, grupos, ruta, troncalesSet) {
  const skipOrigenId = String(ruta.origenId) === '1000';
  const grupo = (!skipOrigenId && grupos.find(g => (g.centroIds || []).map(String).includes(String(ruta.origenId))))
    || grupos.find(g => g.grupo === ruta.origen_grupo);
  if (!grupo) return null;
  const tariffGrupoNombre = GRUPO_TARIFF_SOURCE[grupo.grupo] || grupo.grupo;
  const tariffGrupo = grupos.find(g => g.grupo === tariffGrupoNombre) || grupo;
  let trucks = (db.truckTypes || [])
    .filter(t => t.Id_centro === tariffGrupo.repId)
    .sort((a, b) => TRUCK_ORDER.indexOf(a.type) - TRUCK_ORDER.indexOf(b.type));
  if (troncalesSet.has(ruta.codigo)) {
    const excluidas = new Set(cfg.variables?.troncalesExcluidas || []);
    trucks = trucks.filter(t => !excluidas.has(ruta.codigo + '||' + t.type));
  }
  return { grupo, trucks };
}

// ── Mapa ZCAP: "rutaCodigo||truckType" → { zcap (vigente), zcapCalculado, manual, truck, ruta }
// Usado por Tarifas $/Kg, Min/Max y el Cotizador para leer el mismo valor sin recalcular.
export function buildZcapMap(db, cfg) {
  const grupos       = getOrigenGroups(db);
  // Fix 27-sep-2026: la lista de troncales se guarda en troncalesRoutes.
  const troncalesSet = new Set(cfg.variables?.troncalesRoutes || []);
  const rutas        = (db.routes || []).filter(r => r.activo);
  const map          = new Map();
  rutas.forEach(ruta => {
    const c = combosRuta(db, cfg, grupos, ruta, troncalesSet);
    if (!c) return;
    c.trucks.forEach(truck => {
      const key  = zcapKey(ruta, truck);
      const calc = calcZcapRow(db, cfg, ruta, truck, troncalesSet);
      const man  = zcapManualValor(cfg, key);
      map.set(key, { zcap: man > 0 ? man : calc, zcapCalculado: calc, manual: man > 0, truck, ruta });
    });
  });
  return map;
}

// ── Vista Tarifas Rutas (ZCAP) v2 ──────────────────────────────────────────
const ZV = { tipo: 'todas', centro: 'all', truck: 'all', q: '', kpi: 'all', pagina: 0, draft: {}, guardando: false };
const PAGE = 50;
const TIPO_LBL = { todas: 'Todas', regional: 'Regionales', interregional: 'Interregionales', troncales: 'Troncales' };

export function renderZcapView(container) {
  const db  = getDatabase();
  const cfg = getTariffConfig(db);
  if (!cfg.variables) cfg.variables = {};
  if (!cfg.variables.troncalesRoutes) cfg.variables.troncalesRoutes = [];
  if (!cfg.variables.troncalesExcluidas) cfg.variables.troncalesExcluidas = [];
  if (!cfg.zcapManual) cfg.zcapManual = {};
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);

  // Todas las combinaciones ruta × camión con su ZCAP calculado (se recalcula
  // sólo al entrar o al cambiar la configuración de troncales).
  let combos = [];
  function recalcular() {
    const troncalesSet = new Set(cfg.variables.troncalesRoutes || []);
    combos = [];
    (db.routes || []).filter(r => r.activo).sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '')).forEach(ruta => {
      const c = combosRuta(db, cfg, grupos, ruta, troncalesSet);
      if (!c) return;
      const clasif = troncalesSet.has(ruta.codigo) ? 'Troncal' : (ruta.clasificRuta || '');
      c.trucks.forEach(truck => combos.push({
        key: zcapKey(ruta, truck), ruta, truck, grupo: c.grupo, clasif,
        calc: calcZcapRow(db, cfg, ruta, truck, troncalesSet),
      }));
    });
  }
  recalcular();

  const guardado = k => zcapManualValor(cfg, k);
  const actual = k => (k in ZV.draft ? (Number(ZV.draft[k]) || 0) : guardado(k));
  const vigente = (x, man) => (man > 0 ? man : x.calc);
  const cambios = () => Object.keys(ZV.draft).filter(k => (Number(ZV.draft[k]) || 0) !== guardado(k));

  function filtrados() {
    const q = ZV.q.trim().toLowerCase();
    return combos.filter(x => {
      if (ZV.tipo === 'regional' && x.clasif !== 'Regional') return false;
      if (ZV.tipo === 'interregional' && x.clasif !== 'Interregional') return false;
      if (ZV.tipo === 'troncales' && x.clasif !== 'Troncal') return false;
      if (ZV.centro !== 'all' && x.grupo.grupo !== ZV.centro) return false;
      if (ZV.truck !== 'all' && x.truck.type !== ZV.truck) return false;
      if (q && !`${x.ruta.codigo} ${x.ruta.destino}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function impacto() {
    const ch = cambios();
    const antes = {}, despues = {};
    ch.forEach(k => {
      const x = combos.find(c => c.key === k);
      if (!x) return;
      antes[k] = vigente(x, guardado(k));
      despues[k] = vigente(x, actual(k));
    });
    return textoImpacto(antes, despues, 'ZCAP vigentes');
  }

  function render() {
    const base = filtrados();
    const lista = ZV.kpi === 'manual' ? base.filter(x => actual(x.key) > 0) : base;
    const n = base.length || 1;
    const prom = base.reduce((s, x) => s + vigente(x, actual(x.key)), 0) / n;
    const prom0 = base.reduce((s, x) => s + vigente(x, guardado(x.key)), 0) / n;
    const nMan = base.filter(x => actual(x.key) > 0).length;
    const dPct = prom0 ? (prom / prom0 - 1) * 100 : 0;
    const totalPags = Math.max(1, Math.ceil(lista.length / PAGE));
    if (ZV.pagina >= totalPags) ZV.pagina = totalPags - 1;
    const pag = lista.slice(ZV.pagina * PAGE, (ZV.pagina + 1) * PAGE);
    const troncal = ZV.tipo === 'troncales';
    const ch = cambios();

    const kpi = (k, lbl, val, sub, color, click) => `<button class="sv-kpi ${ZV.kpi === k ? 'is-on' : ''}" ${click ? `data-chip data-zkpi="${k}"` : 'data-chip disabled style="cursor:default"'}
      style="${ZV.kpi === k ? `box-shadow:inset 0 -3px 0 ${color}` : ''}"><div class="sv-kpi-l"><i style="background:${color}"></i>${esc(lbl)}</div>
      <div class="sv-kpi-v" style="font-size:28px;line-height:36px">${esc(val)}</div><div class="sv-kpi-s">${esc(sub)}</div></button>`;

    container.innerHTML = `<div class="sv-view">
      ${changesBarHtml(ch.length, impacto(), ZV.guardando)}
      <div class="sv-vhead">
        <div style="min-width:0"><h1 class="sv-h1">Tarifas Rutas</h1>
          <div class="sv-desc">ZCAP por ruta y tipo de camión: la expectativa de pago al transportista. El vigente alimenta $/Kg, Min/Max y el Cotizador.</div></div>
        <div class="sv-actions"><button class="sv-btn" data-csv id="zcap-btn-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button></div>
      </div>
      ${chainHtml('transporte', 'zcap')}
      <div class="sv-kpis">
        ${kpi('all', 'Combinaciones', fmt(base.length), 'ruta × camión con el filtro', '#191c1d', true)}
        ${kpi('prom', 'ZCAP promedio', clp(prom), ZV.truck === 'all' ? 'todos los camiones' : ZV.truck, '#b5000b', false)}
        ${kpi('manual', 'Con ZCAP manual', fmt(nMan), 'reemplazan el calculado', '#7e22ce', true)}
        ${kpi('delta', 'Cambio vs. guardado', `${dPct >= 0 ? '+' : ''}${fmt(dPct, 1)}%`, Math.abs(dPct) < 0.05 ? 'sin cambios pendientes' : 'si guardas los cambios', Math.abs(dPct) < 0.05 ? '#9ca3af' : '#ca8a04', false)}
      </div>
      <div class="sv-filters">
        <div class="sv-frow">
          <div class="sv-seg">${Object.entries(TIPO_LBL).map(([k, l]) => `<button data-chip data-ztipo="${k}" class="${ZV.tipo === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
          <div class="sv-seg">${['all', ...TRUCK_ORDER].map(t => `<button data-chip data-ztruck="${esc(t)}" class="${ZV.truck === t ? 'is-on' : ''}">${t === 'all' ? 'Todos' : esc(t.replace('Camión ', ''))}</button>`).join('')}</div>
          <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="zcap-q" placeholder="Código o destino" value="${esc(ZV.q)}" style="width:200px"></label>
        </div>
        <div class="sv-frow"><span class="sv-flbl">Centro origen</span>
          <button class="sv-chip ${ZV.centro === 'all' ? 'is-on' : ''}" data-chip data-zcentro="all">Todos</button>
          ${grupos.map(g => `<button class="sv-chip ${ZV.centro === g.grupo ? 'is-on' : ''}" data-chip data-zcentro="${esc(g.grupo)}">${esc(g.nombre || g.grupo)}</button>`).join('')}
        </div>
      </div>
      ${troncal ? panelTroncales() : ''}
      <div class="sv-card">
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:1240px">
          <thead><tr><th>Centro</th><th>Cód. ruta</th><th>Destino</th><th>Clasificación</th><th>Tipo</th><th class="r">KM</th><th>Tipo camión</th>
            <th class="r">ZCAP calculado</th><th class="r">ZCAP manual</th><th class="r">ZCAP vigente</th><th class="r">Δ pendiente</th>${troncal ? '<th>Modo</th>' : ''}</tr></thead>
          <tbody>${pag.length ? pag.map(x => fila(x, troncal)).join('') : `<tr class="sv-empty"><td colspan="${troncal ? 12 : 11}">Sin combinaciones para los filtros.</td></tr>`}</tbody>
        </table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} combinaciones ruta × camión${lista.length > PAGE ? ` · ${fmt(ZV.pagina * PAGE + 1)}–${fmt(Math.min(lista.length, (ZV.pagina + 1) * PAGE))}` : ''}</span>
          <span style="display:flex;gap:12px;align-items:center">ZCAP manual en 0 = usa el calculado
          ${totalPags > 1 ? `<span class="tf-pager"><button data-chip data-zpag="-1" ${ZV.pagina === 0 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_left</span></button>Pág. ${ZV.pagina + 1} / ${totalPags}<button data-chip data-zpag="1" ${ZV.pagina >= totalPags - 1 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_right</span></button></span>` : ''}</span></div>
      </div>
    </div>`;
    wire();
  }

  function fila(x, troncal) {
    const man = actual(x.key), man0 = guardado(x.key);
    const vig = vigente(x, man), d = vig - vigente(x, man0);
    const ch = man !== man0;
    let modo = '';
    if (troncal) {
      const ida = (cfg.variables.troncalesSoloIda || []).includes(x.key);
      modo = `<td><div style="display:flex;gap:6px;align-items:center">
        <button class="tf-toggle ${ida ? 'is-on' : ''}" data-chip data-zida="${esc(x.key)}" ${editar ? '' : 'disabled'} title="${ida ? 'Sólo IDA: peajes y combustible del tramo de ida. Clic → IDA + VUELTA' : 'IDA + VUELTA. Clic → sólo IDA'}">${ida ? 'IDA' : 'IDA+V'}</button>
        ${editar ? `<button class="tf-actbtn" data-chip data-zrm="${esc(x.key)}" title="Quitar este camión de troncales"><span class="material-symbols-outlined">remove_circle_outline</span></button>` : ''}</div></td>`;
    }
    return `<tr class="${man > 0 ? 'tf-man' : ''}" style="cursor:default">
      <td style="${man > 0 ? 'box-shadow:inset 3px 0 0 #7e22ce' : ''}"><span class="sv-b">${esc(x.grupo.nombre || x.grupo.grupo)}</span><div class="sv-sub">${esc(x.ruta.origenId || '')}</div></td>
      <td><span class="sv-mono">${esc(x.ruta.codigo || '')}</span></td>
      <td>${esc(x.ruta.destino || '')}</td>
      <td>${clasifPill(x.clasif)}</td>
      <td>${carPill(x.ruta.caracteristica)}</td>
      <td class="r">${fmt(Number(x.ruta.km) || 0)}</td>
      <td style="white-space:nowrap">${esc(x.truck.type)}</td>
      <td class="r" style="color:${man > 0 ? '#9ca3af' : 'inherit'}">${x.calc > 0 ? clp(x.calc) : '—'}</td>
      <td class="r">${numIn(x.key, man || '', { changed: ch, pre: '$', w: '112px', disabled: !editar, placeholder: '—', label: 'ZCAP manual ' + x.key })}</td>
      <td class="r"><b class="${man > 0 ? 'tf-vig-man' : ''}">${vig > 0 ? clp(vig) : '—'}</b>${man > 0 ? '<div class="sv-sub" style="text-align:right;color:#7e22ce">manual</div>' : ''}</td>
      <td class="r" style="color:${Math.abs(d) >= 1 ? '#ca8a04' : '#9ca3af'};font-weight:${Math.abs(d) >= 1 ? 700 : 400}">${Math.abs(d) >= 1 ? (d > 0 ? '+' : '−') + clp(Math.abs(d)) : '—'}</td>
      ${modo}</tr>`;
  }

  function panelTroncales() {
    const list = cfg.variables.troncalesRoutes || [];
    return `<div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px"><span class="material-symbols-outlined" style="color:#ea580c">settings</span>Rutas troncales (${list.length})
        <span class="sv-sub" style="font-weight:400;margin:0">Usan el motor de costos completo para el ZCAP</span></div>
      ${editar ? `<div class="sv-frow"><label class="sv-inp"><span class="material-symbols-outlined">add_road</span>
        <input id="zcap-tronc-input" list="zcap-tronc-list" placeholder="Código de ruta (ej: CON518)" style="width:220px" class="is-mono"></label>
        <datalist id="zcap-tronc-list">${(db.routes || []).filter(r => r.activo).map(r => `<option value="${esc(r.codigo || '')}"></option>`).join('')}</datalist>
        <button class="sv-btn" data-chip id="zcap-tronc-add"><span class="material-symbols-outlined">add</span>Agregar</button></div>` : ''}
      <div class="sv-sub" style="max-width:none">${list.length ? 'Activas: ' + list.map(esc).join(', ') + ' · configura IDA / IDA+V o quita camiones desde la tabla.' : 'Sin rutas troncales.'}</div>
    </div>`;
  }

  const recalcDebounced = debounce(() => rerenderKeepFocus(container, render), 250);

  function wire() {
    wireChain(container);
    container.querySelectorAll('[data-ztipo]').forEach(b => b.addEventListener('click', () => { ZV.tipo = b.dataset.ztipo; ZV.pagina = 0; render(); }));
    container.querySelectorAll('[data-ztruck]').forEach(b => b.addEventListener('click', () => { ZV.truck = b.dataset.ztruck; ZV.pagina = 0; render(); }));
    container.querySelectorAll('[data-zcentro]').forEach(b => b.addEventListener('click', () => { ZV.centro = b.dataset.zcentro; ZV.pagina = 0; render(); }));
    container.querySelectorAll('[data-zkpi]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.zkpi; ZV.kpi = ZV.kpi === k || k === 'all' ? 'all' : k; ZV.pagina = 0; render(); }));
    container.querySelectorAll('[data-zpag]').forEach(b => b.addEventListener('click', () => { ZV.pagina += Number(b.dataset.zpag); render(); window.scrollTo({ top: 0 }); }));
    const q = container.querySelector('#zcap-q');
    q?.addEventListener('input', () => { ZV.q = q.value; ZV.pagina = 0; const pos = q.selectionStart; render(); const n = container.querySelector('#zcap-q'); n.focus(); n.setSelectionRange(pos, pos); });
    wireNumIns(container, (key, val) => {
      if (val === guardado(key)) delete ZV.draft[key]; else ZV.draft[key] = val;
      recalcDebounced();
    });
    wireChangesBar(container, () => { ZV.draft = {}; render(); }, guardar);
    container.querySelector('#zcap-btn-csv')?.addEventListener('click', () => exportarCsv(filtrados()));
    // Troncales (se guardan al instante, igual que antes)
    container.querySelector('#zcap-tronc-add')?.addEventListener('click', () => {
      const inp = container.querySelector('#zcap-tronc-input');
      const cod = (inp?.value || '').trim().toUpperCase();
      if (!cod) return;
      if (!cfg.variables.troncalesRoutes.includes(cod)) {
        cfg.variables.troncalesRoutes.push(cod);
        saveDatabase(db, { syncOnly: ['tariffConfig'] });
      }
      recalcular(); render();
    });
    container.querySelectorAll('[data-zida]').forEach(b => b.addEventListener('click', () => {
      if (!cfg.variables.troncalesSoloIda) cfg.variables.troncalesSoloIda = [];
      const k = b.dataset.zida, i = cfg.variables.troncalesSoloIda.indexOf(k);
      if (i >= 0) cfg.variables.troncalesSoloIda.splice(i, 1); else cfg.variables.troncalesSoloIda.push(k);
      saveDatabase(db, { syncOnly: ['tariffConfig'] });
      recalcular(); render();
    }));
    container.querySelectorAll('[data-zrm]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.zrm;
      if (!cfg.variables.troncalesExcluidas.includes(k)) cfg.variables.troncalesExcluidas.push(k);
      if (cfg.variables.troncalesSoloIda) cfg.variables.troncalesSoloIda = cfg.variables.troncalesSoloIda.filter(x => x !== k);
      saveDatabase(db, { syncOnly: ['tariffConfig'] });
      recalcular(); render();
    }));
  }

  function guardar() {
    const ch = cambios();
    if (!ch.length) return;
    const by = usuarioSesion(), at = new Date().toISOString();
    ch.forEach(k => {
      const v = Number(ZV.draft[k]) || 0;
      if (v > 0) cfg.zcapManual[k] = { valor: Math.round(v), by, at };
      else delete cfg.zcapManual[k];
    });
    ZV.draft = {};
    saveDatabase(db, { syncOnly: ['tariffConfig'] });
    showAlert(`ZCAP manual guardado (${ch.length} ${ch.length === 1 ? 'cambio' : 'cambios'}). El ZCAP vigente ya alimenta $/Kg, Min/Max y el Cotizador.`, 'success');
    render();
  }

  function exportarCsv(lista) {
    if (!lista.length) return;
    const sep = ';';
    const lines = [['Centro', 'Cod Ruta', 'Destino', 'Clasificacion', 'Tipo', 'KM', 'Tipo Camion', 'ZCAP calculado', 'ZCAP manual', 'ZCAP vigente'].join(sep)];
    lista.forEach(x => {
      const man = guardado(x.key);
      lines.push([x.grupo.nombre || x.grupo.grupo, x.ruta.codigo || '', x.ruta.destino || '', x.clasif, x.ruta.caracteristica || 'NORMAL', Number(x.ruta.km) || 0,
        x.truck.type, Math.round(x.calc || 0), man || '', Math.round(vigente(x, man) || 0)].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(sep));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `zcap_${ZV.centro}_${ZV.tipo}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  render();
}
