// ============================================================================
//  FLETE TERCERO · Nivel de Servicio (OTIF / Fill Rate) + Seguimiento por Pedido
//  Lee en vivo la tabla ind_flete_tercero de Supabase (RLS: usuario @ebema.cl con rol).
//  Se alimenta a diario (08:00) vía Apps Script (Gmail noreply@ebema.cl, label
//  "Indicadores Transporte") — no requiere carga manual desde esta vista.
//
//  Reglas de negocio (definidas por el usuario, ver Resumen del Excel fuente):
//   - OTIF = entregado a tiempo (Fecha Entrega Cliente <= Fecha Disponible Material)
//            Y en cantidad completa (bultos entregados >= bultos solicitados).
//   - Fill Rate = % de bultos entregados vs solicitados (tope 100%).
//   - Un pedido es EVALUABLE si ya fue entregado, O si está vencido sin entregar
//     (hoy > fecha promesa y aún no se entrega) — este último cuenta como
//     incumplimiento (OTIF=0). Los pedidos aún no vencidos y no entregados
//     quedan fuera del cálculo (siguen en proceso normal).
//   - Estados del ciclo: Creación → Recepción CD → En Tránsito → En Bodega
//     Destino → Entregado a Cliente. Si condición=CLI-RET (EBE) y el pedido
//     está en Bodega Destino, se muestra como "Listo para Entrega Cliente".
// ============================================================================
import { supabase } from './supabase-client.js';
import { getDatabase, loadRoutesData } from './data.js?v=20260909c';

// --- Paleta (alineada a Indicadores) ----------------------------------------
const R = { red:'#C0000C', red2:'#EE1B22', redL:'#E88A8F', grey:'#6B6E70', greyL:'#A9ACAE', ink:'#333333', grid:'#D9D5CF', amber:'#B5730B' };

let _container = null;
let _view = 'dashboard'; // 'dashboard' | 'seguimiento'
let _cache = null;       // filas crudas + calculadas
let _selPedido = null;   // id_pedido seleccionado en Seguimiento
let _centroFiltro = 'Todos';

export function setFleteTerceroSubTab(sub) {
  if (['dashboard', 'seguimiento'].indexOf(sub) >= 0) _view = sub;
}

// --- Formato -----------------------------------------------------------------
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => (v == null ? '–' : nf1.format(v) + '%');
const numFmt = v => (v == null ? '–' : nf0.format(v));
const diasFmt = v => (v == null ? '–' : nf1.format(v) + ' d');
const MESES_CORTOS = { '01': 'ene', '02': 'feb', '03': 'mar', '04': 'abr', '05': 'may', '06': 'jun', '07': 'jul', '08': 'ago', '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dic' };
const mesCorto = lbl => (lbl ? (MESES_CORTOS[String(lbl).slice(5, 7)] + ' ' + String(lbl).slice(2, 4)) : lbl);

function fmtFecha(s) {
  if (!s) return '–';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// --- Utilidades de fecha / días hábiles --------------------------------------
function toDate(s) { return s ? new Date(s + 'T00:00:00') : null; }
function isWeekend(d) { const dow = d.getDay(); return dow === 0 || dow === 6; }
function nextBusinessDay(d) {
  const cur = new Date(d); cur.setDate(cur.getDate() + 1);
  while (isWeekend(cur)) cur.setDate(cur.getDate() + 1);
  return cur;
}
// Días hábiles estrictamente después de d1 hasta d2 (equivalente a NETWORKDAYS(d1,d2)-1, min 0)
function bdays(d1, d2) {
  if (!d1 || !d2) return null;
  if (d2 <= d1) return 0;
  let count = 0; const cur = new Date(d1); cur.setDate(cur.getDate() + 1);
  while (cur <= d2) { if (!isWeekend(cur)) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

// ============================================================================
//  CÁLCULO POR PEDIDO
// ============================================================================
const ESTADOS_BASE = ['Creación del Pedido', 'Recepción en CD', 'En Tránsito', 'En Bodega Destino', 'Entregado a Cliente'];

function computeRow(r) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fCreacion = toDate(r.fecha_creacion);
  const fPromesa = toDate(r.fecha_disponible_material);
  const fRecepCD = toDate(r.fecha_recep_cd);
  const fTraslado = toDate(r.fecha_traslado);
  const fRecepSuc = toDate(r.fecha_recep_sucursal);
  const fEntrega = toDate(r.fecha_entrega_cliente);

  const entregado = !!fEntrega;
  const vencido = !entregado && !!fPromesa && hoy > fPromesa;
  const evaluable = entregado || vencido;

  const bultosPed = Number(r.cantidad_bultos) || 0;
  const bultosEnt = Number(r.bultos_entrega_cliente) || 0;

  let onTime = null, inFull = null, otif = null, fillRate = null;
  if (evaluable) {
    onTime = entregado ? (fPromesa ? fEntrega <= fPromesa : false) : false;
    inFull = bultosEnt >= bultosPed && bultosPed > 0;
    otif = (onTime && inFull) ? 1 : 0;
    fillRate = bultosPed > 0 ? Math.min(bultosEnt / bultosPed, 1) * 100 : null;
  }

  const esRetiro = /RET/i.test(r.condicion_expedicion || '');
  let estadoIdx, estadoLabel;
  if (entregado) { estadoIdx = 4; estadoLabel = 'Entregado a Cliente'; }
  else if (fRecepSuc) { estadoIdx = 3; estadoLabel = esRetiro ? 'Listo para Entrega Cliente' : 'En Bodega Destino'; }
  else if (fTraslado) { estadoIdx = 2; estadoLabel = 'En Tránsito'; }
  else if (fRecepCD) { estadoIdx = 1; estadoLabel = 'Recepción en CD'; }
  else { estadoIdx = 0; estadoLabel = 'Creación del Pedido'; }

  // Días por etapa (hábiles) — solo si ambos extremos existen
  const dCreaRecep = bdays(fCreacion, fRecepCD);
  const dRecepTras = bdays(fRecepCD, fTraslado);
  const dTrasRecSuc = bdays(fTraslado, fRecepSuc);
  const dRecSucEnt = bdays(fRecepSuc, fEntrega);
  const dTotal = bdays(fCreacion, fEntrega);
  const slaOfrecido = (fCreacion && fPromesa) ? bdays(nextBusinessDay(fCreacion), fPromesa) : null;

  return {
    ...r,
    entregado, vencido, evaluable, onTime, inFull, otif, fillRate,
    estadoIdx, estadoLabel, esRetiro,
    mesCreacion: r.fecha_creacion ? String(r.fecha_creacion).slice(0, 7) : null,
    dCreaRecep, dRecepTras, dTrasRecSuc, dRecSucEnt, dTotal, slaOfrecido,
  };
}

// ============================================================================
//  DATOS
// ============================================================================
async function loadData() {
  if (_cache) return _cache;
  const { data, error } = await supabase.from('ind_flete_tercero').select('*').order('fecha_creacion', { ascending: false });
  if (error) throw error;
  const rows = (data || []).map(computeRow);
  const lastLoad = (data && data[0]) ? data.reduce((m, r) => (r.loaded_at > m ? r.loaded_at : m), data[0].loaded_at) : null;
  _cache = { rows, lastLoad };
  return _cache;
}

function centroNombre(id) {
  try {
    const db = getDatabase();
    const c = (db.logisticsCentres || []).find(x => String(x.id) === String(id));
    return c ? c.nombre : null;
  } catch (e) { return null; }
}
function centroLabel(id) {
  const n = centroNombre(id);
  return n ? `${id} · ${n}` : `${id || '–'}`;
}

// ============================================================================
//  ENTRYPOINT
// ============================================================================
export async function renderFleteTerceroView(container) {
  _container = container;
  try { await loadRoutesData(); } catch (e) { /* centros opcionales */ }
  paintShell();
  try {
    await loadData();
    if (_view === 'seguimiento') renderSeguimiento(); else renderDashboard();
  } catch (e) {
    body().innerHTML = errorHTML(e);
  }
}

function paintShell() {
  _container.innerHTML = `
  <div class="max-w-[1120px] mx-auto">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="text-headline-sm font-bold">Flete Tercero · ${_view === 'seguimiento' ? 'Seguimiento de Pedidos' : 'Nivel de Servicio'}</div>
      <span class="text-[11px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria automática · Supabase</span>
    </div>
    <div class="flex gap-sm mb-lg border-b border-surface-variant">
      ${tabBtn('dashboard', 'monitoring', 'Nivel de Servicio')}
      ${tabBtn('seguimiento', 'search', 'Seguimiento por Pedido')}
    </div>
    <div id="fter_body"></div>
  </div>`;
  _container.querySelectorAll('[data-fter-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _view = btn.getAttribute('data-fter-tab');
      paintShell();
      if (_view === 'seguimiento') renderSeguimiento(); else renderDashboard();
    });
  });
}
function tabBtn(key, icon, label) {
  const active = _view === key;
  return `<button data-fter-tab="${key}" class="flex items-center gap-1 px-md py-sm text-body-md font-semibold border-b-2 transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}">
    <span class="material-symbols-outlined text-[18px]">${icon}</span>${label}
  </button>`;
}
function body() { return document.getElementById('fter_body'); }
function loadingHTML() { return `<div class="flex items-center justify-center py-xl text-secondary gap-2"><span class="material-symbols-outlined animate-spin">progress_activity</span>Cargando datos de flete tercero…</div>`; }
function errorHTML(e) { return `<div class="bg-error-container text-on-error-container rounded-xl p-lg">No se pudieron cargar los datos: ${(e && e.message) || e}</div>`; }

// ============================================================================
//  DASHBOARD — Nivel de Servicio
// ============================================================================
function renderDashboard() {
  const { rows, lastLoad } = _cache;
  const evals = rows.filter(r => r.evaluable);
  const enProceso = rows.filter(r => !r.evaluable).length;

  const otifPct = evals.length ? avg(evals.map(r => r.otif * 100)) : null;
  const fillPct = evals.length ? avg(evals.map(r => r.fillRate)) : null;

  // Por tipo de servicio
  const tipos = uniq(rows.map(r => r.condicion_expedicion));
  const porTipo = tipos.map(t => {
    const e = evals.filter(r => r.condicion_expedicion === t);
    return { tipo: t, n: e.length, otif: e.length ? avg(e.map(r => r.otif * 100)) : null, fill: e.length ? avg(e.map(r => r.fillRate)) : null };
  }).sort((a, b) => b.n - a.n);

  // Por centro destino
  const centros = uniq(rows.map(r => r.punto_expedicion)).sort();
  const porCentro = centros.map(c => {
    const e = evals.filter(r => r.punto_expedicion === c);
    return { centro: c, n: e.length, otif: e.length ? avg(e.map(r => r.otif * 100)) : null, fill: e.length ? avg(e.map(r => r.fillRate)) : null };
  }).sort((a, b) => b.n - a.n);

  // Evolutivo mensual (con filtro de centro)
  const meses = uniq(rows.map(r => r.mesCreacion)).filter(Boolean).sort();
  const evolutivoFor = centroSel => {
    const base = centroSel === 'Todos' ? evals : evals.filter(r => r.punto_expedicion === centroSel);
    return meses.map(m => {
      const e = base.filter(r => r.mesCreacion === m);
      return { mes: m, n: e.length, otif: e.length ? avg(e.map(r => r.otif * 100)) : null, fill: e.length ? avg(e.map(r => r.fillRate)) : null };
    });
  };

  // Mix mensual por tipo de servicio
  const mix = meses.map(m => {
    const base = rows.filter(r => r.mesCreacion === m);
    const total = base.length || 1;
    const porT = {};
    tipos.forEach(t => { porT[t] = base.filter(r => r.condicion_expedicion === t).length; });
    return { mes: m, total: base.length, porT, pct: Object.fromEntries(tipos.map(t => [t, (porT[t] / total) * 100])) };
  });

  // Cuello de botella
  const etapas = [
    { label: '1. Creación → Recepción CD', get: r => r.dCreaRecep },
    { label: '2. Recepción CD → Traslado', get: r => r.dRecepTras },
    { label: '3. Traslado → Recepción Sucursal', get: r => r.dTrasRecSuc },
    { label: '4. Recepción Sucursal → Entrega Cliente', get: r => r.dRecSucEnt },
  ].map(e => {
    const vals = rows.map(e.get).filter(v => v != null);
    return { ...e, prom: vals.length ? avg(vals) : null };
  });
  const leadVals = rows.map(r => r.dTotal).filter(v => v != null);
  const leadTotal = leadVals.length ? avg(leadVals) : null;
  const slaVals = rows.map(r => r.slaOfrecido).filter(v => v != null);
  const slaProm = slaVals.length ? avg(slaVals) : null;
  const sumaEtapas = etapas.reduce((s, e) => s + (e.prom || 0), 0) || 1;
  const maxEtapa = etapas.reduce((m, e) => (e.prom != null && (m == null || e.prom > m.prom) ? e : m), null);

  body().innerHTML = `
    <div class="text-[11px] text-secondary mb-md">${lastLoad ? `Última carga de datos: ${new Date(lastLoad).toLocaleString('es-CL')}` : ''} · ${rows.length} pedidos en total</div>

    <!-- 1. Nivel de servicio general -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${tile('Pedidos Evaluables', numFmt(evals.length), `de ${rows.length} pedidos totales`)}
      ${tile('OTIF', pct(otifPct), 'a tiempo y completos', otifPct != null && otifPct < 50 ? 'text-[#C0000C]' : '')}
      ${tile('Fill Rate', pct(fillPct), '% bultos entregados')}
      ${tile('En Proceso', numFmt(enProceso), 'aún no vencidos')}
    </div>

    <!-- 2. Por tipo de servicio -->
    ${sectionTitle('Nivel de Servicio por Tipo de Servicio')}
    ${simpleTable(['Condición Expedición', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
      porTipo.map(t => [t.tipo || '–', numFmt(t.n), pctCell(t.otif), pctCell(t.fill)]))}

    <!-- 3. Por centro destino -->
    ${sectionTitle('Nivel de Servicio por Centro Destino')}
    ${simpleTable(['Centro Destino', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
      porCentro.map(c => [centroLabel(c.centro), numFmt(c.n), pctCell(c.otif), pctCell(c.fill)]))}

    <!-- 4. Evolutivo mensual -->
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">Evolutivo Nivel de Servicio General (mes de creación)</div>
      <label class="flex items-center gap-2 text-[12px] text-secondary">Centro Destino:
        <select id="fter_centro_filtro" class="border border-surface-variant rounded-lg px-2 py-1 text-[12px]">
          <option value="Todos">Todos</option>
          ${centros.map(c => `<option value="${c}">${escAttr(centroLabel(c))}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="fter_evolutivo"></div>

    <!-- 5. Mix mensual por tipo de servicio -->
    ${sectionTitle('Evolutivo Mensual de Pedidos por Tipo de Servicio')}
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg">
      ${legend(tipos.map((t, i) => ({ n: t, c: mixColor(i) })))}
      ${stackedBars(meses.map(mesCorto), meses.map(m => mix.find(x => x.mes === m)), tipos)}
    </div>

    <!-- 6. Cuello de botella -->
    ${sectionTitle('Cuello de Botella — Días Promedio por Etapa (hábiles)')}
    ${simpleTable(['Etapa', 'Días Promedio', '% del Lead Time', '¿Cuello de botella?'],
      etapas.map(e => [e.label, diasFmt(e.prom), e.prom != null ? pct((e.prom / sumaEtapas) * 100) : '–', (maxEtapa && e === maxEtapa) ? '◀ MÁXIMO' : '']))}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-md mt-md mb-xl">
      ${tile('Lead Time Total', diasFmt(leadTotal), 'Creación → Entrega, real')}
      ${tile('SLA Ofrecido', diasFmt(slaProm), 'Creación +1 hábil → Promesa')}
      ${tile('Diferencia', diasFmt(leadTotal != null && slaProm != null ? leadTotal - slaProm : null), 'Real − SLA ofrecido', (leadTotal != null && slaProm != null && leadTotal - slaProm > 0) ? 'text-[#C0000C]' : 'text-[#1E8449]')}
    </div>
  `;

  const sel = document.getElementById('fter_centro_filtro');
  const drawEvol = () => {
    const ev = evolutivoFor(sel.value);
    document.getElementById('fter_evolutivo').innerHTML = simpleTable(
      ['Mes', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
      ev.map(e => [mesCorto(e.mes), numFmt(e.n), pctCell(e.otif), pctCell(e.fill)])
    ) + lineChartSVG(
      [{ n: 'OTIF %', values: ev.map(e => e.otif), color: R.red }, { n: 'Fill Rate %', values: ev.map(e => e.fill), color: R.grey }],
      ev.map(e => mesCorto(e.mes))
    );
  };
  sel.value = _centroFiltro;
  sel.addEventListener('change', () => { _centroFiltro = sel.value; drawEvol(); });
  drawEvol();
}

// ============================================================================
//  SEGUIMIENTO POR PEDIDO
// ============================================================================
function renderSeguimiento() {
  const { rows } = _cache;
  body().innerHTML = `
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg mb-lg">
      <div class="flex items-center gap-md flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[20px]">search</span>
          <input id="fter_search" type="text" placeholder="Buscar por N° de Pedido…" class="w-full pl-10 pr-3 py-2 border border-surface-variant rounded-lg text-body-md" value="${_selPedido || ''}" />
        </div>
      </div>
    </div>
    <div id="fter_detalle"></div>
    ${sectionTitle('Todos los Pedidos')}
    <div class="flex items-center gap-md flex-wrap mb-sm">
      <select id="fter_f_estado" class="border border-surface-variant rounded-lg px-2 py-1 text-[12px]">
        <option value="">Estado: Todos</option>
        ${ESTADOS_BASE.map(e => `<option value="${e}">${e}</option>`).join('')}
        <option value="Listo para Entrega Cliente">Listo para Entrega Cliente</option>
      </select>
      <select id="fter_f_condicion" class="border border-surface-variant rounded-lg px-2 py-1 text-[12px]">
        <option value="">Condición: Todas</option>
        ${uniq(rows.map(r => r.condicion_expedicion)).map(c => `<option value="${escAttr(c)}">${c}</option>`).join('')}
      </select>
      <select id="fter_f_venc" class="border border-surface-variant rounded-lg px-2 py-1 text-[12px]">
        <option value="">Vencidos: Todos</option>
        <option value="si">Solo vencidos sin entregar</option>
        <option value="no">Solo no vencidos</option>
      </select>
    </div>
    <div id="fter_tabla"></div>
  `;

  const input = document.getElementById('fter_search');
  const fEstado = document.getElementById('fter_f_estado');
  const fCond = document.getElementById('fter_f_condicion');
  const fVenc = document.getElementById('fter_f_venc');

  const drawTabla = () => {
    const q = (input.value || '').trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter(r => String(r.id_pedido || '').toLowerCase().includes(q));
    if (fEstado.value) list = list.filter(r => r.estadoLabel === fEstado.value);
    if (fCond.value) list = list.filter(r => r.condicion_expedicion === fCond.value);
    if (fVenc.value === 'si') list = list.filter(r => r.vencido);
    if (fVenc.value === 'no') list = list.filter(r => !r.vencido);
    document.getElementById('fter_tabla').innerHTML = pedidosTable(list.slice(0, 200));
    document.getElementById('fter_tabla').querySelectorAll('[data-pedido]').forEach(tr => {
      tr.addEventListener('click', () => { _selPedido = tr.getAttribute('data-pedido'); input.value = _selPedido; drawDetalle(); drawTabla(); });
    });
  };
  const drawDetalle = () => {
    const r = rows.find(x => String(x.id_pedido) === String(_selPedido));
    document.getElementById('fter_detalle').innerHTML = r ? detalleHTML(r) : (
      _selPedido ? `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg text-secondary mb-lg">No se encontró el pedido "${escAttr(_selPedido)}".</div>` : ''
    );
  };

  input.addEventListener('input', () => { _selPedido = input.value.trim() || null; drawDetalle(); drawTabla(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const exact = rows.find(x => String(x.id_pedido) === input.value.trim()); if (exact) { _selPedido = exact.id_pedido; drawDetalle(); } } });
  fEstado.addEventListener('change', drawTabla);
  fCond.addEventListener('change', drawTabla);
  fVenc.addEventListener('change', drawTabla);

  drawDetalle();
  drawTabla();
}

function detalleHTML(r) {
  const badge = r.entregado
    ? (r.otif ? badgeHTML('OTIF cumplido', '#1E8449') : badgeHTML('Entregado fuera de plazo / incompleto', '#C0000C'))
    : (r.vencido ? badgeHTML('Vencido sin entregar', '#C0000C') : badgeHTML('En proceso (dentro de plazo)', '#B5730B'));

  return `
  <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg mb-lg">
    <div class="flex items-start justify-between flex-wrap gap-sm mb-md">
      <div>
        <div class="text-headline-sm font-bold">Pedido ${escAttr(r.id_pedido)}</div>
        <div class="text-[12px] text-secondary mt-1">${escAttr(r.condicion_expedicion)} · ${escAttr(centroLabel(r.punto_expedicion))} · Ruta: ${escAttr(r.ruta_flete || '–')}</div>
      </div>
      ${badge}
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg text-[13px]">
      ${miniField('Fecha Creación', fmtFecha(r.fecha_creacion))}
      ${miniField('Fecha Promesa (Disponible Material)', fmtFecha(r.fecha_disponible_material))}
      ${miniField('Material', r.material || '–')}
      ${miniField('Bultos Solicitados / Entregados', `${numFmt(r.cantidad_bultos)} / ${numFmt(r.bultos_entrega_cliente)}`)}
    </div>
    ${timelineHTML(r)}
  </div>`;
}

function timelineHTML(r) {
  const pasos = [
    { label: 'Creación del Pedido', fecha: r.fecha_creacion, activo: true },
    { label: 'Recepción en CD', fecha: r.fecha_recep_cd, activo: r.estadoIdx >= 1 },
    { label: 'En Tránsito', fecha: r.fecha_traslado, activo: r.estadoIdx >= 2 },
    { label: r.esRetiro && r.estadoIdx >= 3 ? 'Listo para Entrega Cliente' : 'En Bodega Destino', fecha: r.fecha_recep_sucursal, activo: r.estadoIdx >= 3 },
    { label: 'Entregado a Cliente', fecha: r.fecha_entrega_cliente, activo: r.estadoIdx >= 4 },
  ];
  return `<div class="flex items-start gap-0 overflow-x-auto pt-sm">
    ${pasos.map((p, i) => `
      <div class="flex flex-col items-center flex-1 min-w-[110px]">
        <div class="flex items-center w-full">
          <div class="flex-1 h-[2px] ${i === 0 ? 'invisible' : (p.activo ? 'bg-primary' : 'bg-surface-variant')}"></div>
          <div class="w-8 h-8 rounded-full flex items-center justify-center ${p.activo ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-secondary'} shrink-0">
            <span class="material-symbols-outlined text-[16px]">${p.activo ? 'check' : 'radio_button_unchecked'}</span>
          </div>
          <div class="flex-1 h-[2px] ${i === pasos.length - 1 ? 'invisible' : (pasos[i + 1].activo ? 'bg-primary' : 'bg-surface-variant')}"></div>
        </div>
        <div class="text-[11px] text-center mt-1 font-semibold ${p.activo ? 'text-on-surface' : 'text-secondary'}">${p.label}</div>
        <div class="text-[10px] text-secondary">${p.fecha ? fmtFecha(p.fecha) : '—'}</div>
      </div>`).join('')}
  </div>`;
}

function pedidosTable(list) {
  if (!list.length) return `<div class="text-secondary text-[13px] py-md">Sin resultados.</div>`;
  return `<div class="overflow-x-auto"><table class="w-full text-[12px] border-collapse mb-xl">
    <thead><tr class="text-left text-secondary border-b border-surface-variant">
      <th class="py-2 pr-3">N° Pedido</th><th class="py-2 pr-3">Condición</th><th class="py-2 pr-3">Centro</th>
      <th class="py-2 pr-3">F. Creación</th><th class="py-2 pr-3">F. Promesa</th><th class="py-2 pr-3">Estado</th><th class="py-2 pr-3"></th>
    </tr></thead>
    <tbody>
      ${list.map(r => `
      <tr data-pedido="${escAttr(r.id_pedido)}" class="border-b border-surface-variant hover:bg-surface-container-high cursor-pointer">
        <td class="py-2 pr-3 font-semibold">${escAttr(r.id_pedido)}</td>
        <td class="py-2 pr-3">${escAttr(r.condicion_expedicion)}</td>
        <td class="py-2 pr-3">${escAttr(r.punto_expedicion)}</td>
        <td class="py-2 pr-3">${fmtFecha(r.fecha_creacion)}</td>
        <td class="py-2 pr-3">${fmtFecha(r.fecha_disponible_material)}</td>
        <td class="py-2 pr-3">${estadoBadge(r)}</td>
        <td class="py-2 pr-3 text-primary">Ver →</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function estadoBadge(r) {
  let color = R.grey;
  if (r.estadoLabel === 'Entregado a Cliente') color = '#1E8449';
  else if (r.vencido) color = '#C0000C';
  else if (r.estadoIdx >= 3) color = R.amber;
  return `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[2px] rounded-full" style="background:${color}22;color:${color}">${r.estadoLabel}${r.vencido ? ' · Vencido' : ''}</span>`;
}
function badgeHTML(text, color) { return `<span class="inline-flex items-center gap-1 text-[12px] font-semibold px-3 py-1 rounded-full" style="background:${color}22;color:${color}">${text}</span>`; }
function miniField(label, value) { return `<div><div class="text-[10px] uppercase tracking-wide text-secondary mb-[2px]">${label}</div><div class="font-semibold text-on-surface">${escAttr(String(value))}</div></div>`; }

// ============================================================================
//  COMPONENTES REUTILIZABLES
// ============================================================================
function sectionTitle(t) { return `<div class="text-body-lg font-bold text-on-surface mt-lg mb-sm">${t}</div>`; }
function tile(label, value, sub, extraCls = '') {
  return `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md">
    <div class="text-[11px] uppercase tracking-wide text-secondary mb-1">${label}</div>
    <div class="text-headline-sm font-bold ${extraCls}">${value}</div>
    <div class="text-[11px] text-secondary mt-1">${sub}</div>
  </div>`;
}
function pctCell(v) {
  if (v == null) return '–';
  const color = v < 50 ? '#C0000C' : (v < 80 ? '#B5730B' : '#1E8449');
  return `<span style="color:${color};font-weight:600">${pct(v)}</span>`;
}
function simpleTable(headers, rows) {
  return `<div class="overflow-x-auto"><table class="w-full text-[13px] border-collapse mb-md">
    <thead><tr class="text-left text-secondary border-b border-surface-variant">${headers.map(h => `<th class="py-2 pr-3">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr class="border-b border-surface-variant">${row.map(c => `<td class="py-2 pr-3">${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function legend(items) {
  return `<div class="flex items-center gap-md flex-wrap mb-sm text-[11px] text-secondary">
    ${items.map(i => `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${i.c}"></span>${i.n}</span>`).join('')}
  </div>`;
}
const MIX_COLORS = [R.red, R.grey, R.amber, R.redL, R.greyL, '#0B2B4A', '#2E75B6'];
function mixColor(i) { return MIX_COLORS[i % MIX_COLORS.length]; }
function stackedBars(labels, mixRows, tipos) {
  if (!labels.length) return `<div class="text-secondary text-[13px]">Sin datos.</div>`;
  const w = Math.max(100 / labels.length, 4);
  return `<div class="flex items-end gap-1" style="height:120px">
    ${mixRows.map((m, idx) => {
      if (!m) return `<div style="width:${w}%"></div>`;
      let acc = 0;
      const segs = tipos.map((t, i) => {
        const v = m.pct[t] || 0; const seg = `<div style="height:${v}%;background:${mixColor(i)}" title="${t}: ${nf1.format(v)}%"></div>`; acc += v; return seg;
      }).join('');
      return `<div class="flex flex-col items-center gap-1" style="width:${w}%">
        <div class="w-full flex flex-col-reverse rounded overflow-hidden bg-surface-container-high" style="height:90px">${segs}</div>
        <div class="text-[9px] text-secondary">${labels[idx]}</div>
      </div>`;
    }).join('')}
  </div>`;
}
function lineChartSVG(seriesArr, labels) {
  const W = 900, H = 180, padL = 30, padR = 8, padT = 10, padB = 22;
  const w = W - padL - padR, h = H - padT - padB;
  const max = 100, min0 = 0;
  const n = labels.length;
  const x = i => padL + (n <= 1 ? w / 2 : (w * i / (n - 1)));
  const y = v => padT + h - (h * (v - min0) / (max - min0 || 1));
  let svg = `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">`;
  [0, 25, 50, 75, 100].forEach(g => {
    const yy = y(g);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${R.grid}" stroke-width="1"/><text x="2" y="${yy + 3}" font-size="9" fill="${R.grey}">${g}</text>`;
  });
  seriesArr.forEach(s => {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    s.values.forEach((v, i) => { if (v != null) svg += `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"/>`; });
  });
  labels.forEach((l, i) => { svg += `<text x="${x(i)}" y="${H - 4}" font-size="9" fill="${R.grey}" text-anchor="middle">${l}</text>`; });
  svg += '</svg>' + legend(seriesArr.map(s => ({ n: s.n, c: s.color }))) + '</div>';
  return svg;
}

// --- Helpers -------------------------------------------------------------
function avg(arr) { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function uniq(arr) { return Array.from(new Set(arr.filter(x => x != null && x !== ''))); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
