// ============================================================================
//  FLETE TERCERO · Nivel de Servicio (OTIF / Fill Rate) + Seguimiento por Pedido
//  Lee en vivo la tabla ind_flete_tercero de Supabase (RLS: usuario @ebema.cl con rol).
//  Se alimenta a diario (08:00) vía Apps Script (Gmail noreply@ebema.cl, label
//  "Indicadores Transporte") — no requiere carga manual desde esta vista.
//
//  Reglas de negocio (definidas por el usuario, ver Resumen del Excel fuente):
//   - EVENTO DE CUMPLIMIENTO (ajuste 20-sep-2026): Despacho -> Fecha Entrega Cliente;
//     RETIRA (CLI-RET) -> Fecha Recepción Sucursal (material disponible en sucursal;
//     el retiro efectivo depende del cliente, no de EBEMA).
//   - OTIF = evento a tiempo (Fecha Evento <= Fecha Disponible Material)
//            Y en cantidad completa (bultos del evento >= bultos solicitados).
//   - Fill Rate = % de bultos del evento vs solicitados (tope 100%).
//   - PEDIDOS VENCIDOS / EN CURSO (gestión): pedidos con alguna etapa física pendiente (Recepción CD,
//     Traslado, Recepción Sucursal y Entrega Cliente — también en Retira: para gestión el pedido
//     sigue pendiente hasta la entrega al cliente, aunque el OTIF ya cerró en sucursal). Vencido = hoy > promesa;
//     En curso = hoy <= promesa. Responsable de cierre: CD 1003 si falta Recepción CD/Traslado;
//     si no, el centro destino. Misma lógica que las vistas SQL v_ft_* (correo diario).
//   - Un pedido es EVALUABLE si ya fue entregado, O si está vencido sin entregar
//     (hoy > fecha promesa y aún no se entrega) — este último cuenta como
//     incumplimiento (OTIF=0). Los pedidos aún no vencidos y no entregados
//     quedan fuera del cálculo (siguen en proceso normal).
//   - Estados del ciclo: Creación → Recepción CD → En Tránsito → En Bodega
//     Destino → Entregado a Cliente. Si condición=CLI-RET (EBE) y el pedido
//     está en Bodega Destino, se muestra como "Listo para Entrega Cliente".
// ============================================================================
import { supabase } from './supabase-client.js?v=202610091454';
import { getDatabase, loadRoutesData } from './data.js?v=202610091454';

// --- Paleta (alineada a Indicadores) ----------------------------------------
const R = { red:'#C0000C', red2:'#EE1B22', redL:'#E88A8F', grey:'#6B6E70', greyL:'#A9ACAE', ink:'#333333', grid:'#D9D5CF', amber:'#B5730B' };

let _container = null;
let _view = 'dashboard'; // 'dashboard' | 'seguimiento' | 'vencidos' | 'en_curso'
let _centroVenc = 'Todos';
let _cache = null;       // filas crudas + calculadas
let _selPedido = null;   // id_pedido seleccionado en Seguimiento
let _centroFiltro = 'Todos';

export function setFleteTerceroSubTab(sub) {
  if (['dashboard', 'seguimiento', 'vencidos', 'en_curso'].indexOf(sub) >= 0) _view = sub;
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

// Definición de etapas del ciclo para el análisis de Cuello de Botella
const ETAPA_DEFS = [
  { label: '1. Creación → Recepción CD', get: r => r.dCreaRecep },
  { label: '2. Recepción CD → Traslado', get: r => r.dRecepTras },
  { label: '3. Traslado → Recepción Sucursal', get: r => r.dTrasRecSuc },
  { label: '4. Recepción Sucursal → Entrega Cliente', get: r => r.dRecSucEnt },
];
// Calcula el cuello de botella (días hábiles promedio por etapa + SLA vs lead time) sobre un set de filas
function cuelloBotellaCalc(baseRows) {
  const etapas = ETAPA_DEFS.map(e => {
    const vals = baseRows.map(e.get).filter(v => v != null);
    return { ...e, prom: vals.length ? avg(vals) : null };
  });
  const leadVals = baseRows.map(r => r.dTotal).filter(v => v != null);
  const leadTotal = leadVals.length ? avg(leadVals) : null;
  const slaVals = baseRows.map(r => r.slaOfrecido).filter(v => v != null);
  const slaProm = slaVals.length ? avg(slaVals) : null;
  const sumaEtapas = etapas.reduce((s, e) => s + (e.prom || 0), 0) || 1;
  const maxEtapa = etapas.reduce((m, e) => (e.prom != null && (m == null || e.prom > m.prom) ? e : m), null);
  return { etapas, leadTotal, slaProm, sumaEtapas, maxEtapa, n: baseRows.length };
}

function computeRow(r) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fCreacion = toDate(r.fecha_creacion);
  const fPromesa = toDate(r.fecha_disponible_material);
  const fRecepCD = toDate(r.fecha_recep_cd);
  const fTraslado = toDate(r.fecha_traslado);
  const fRecepSuc = toDate(r.fecha_recep_sucursal);
  const fEntrega = toDate(r.fecha_entrega_cliente);

  const esRetiro = /RET/i.test(r.condicion_expedicion || '');
  // Evento de cumplimiento: Retira -> material disponible en sucursal; Despacho -> entrega al cliente
  const fEvento = esRetiro ? fRecepSuc : fEntrega;
  const entregado = !!fEntrega;   // entrega física al cliente (para el estado del ciclo)
  const cumplido = !!fEvento;     // evento de servicio ocurrido (base del OTIF)
  const vencido = !cumplido && !!fPromesa && hoy > fPromesa;
  const evaluable = cumplido || vencido;

  const bultosPed = Number(r.cantidad_bultos) || 0;
  const bultosEnt = Number(r.bultos_entrega_cliente) || 0;
  const bultosEvento = esRetiro ? (Number(r.bultos_recep_sucursal) || 0) : bultosEnt;

  let onTime = null, inFull = null, otif = null, fillRate = null;
  if (evaluable) {
    onTime = cumplido ? (fPromesa ? fEvento <= fPromesa : false) : false;
    inFull = bultosEvento >= bultosPed && bultosPed > 0;
    otif = (onTime && inFull) ? 1 : 0;
    fillRate = bultosPed > 0 ? Math.min(bultosEvento / bultosPed, 1) * 100 : null;
  }

  // Etapas físicas pendientes para GESTIÓN: hasta la Entrega Cliente, también en Retira (el OTIF sí cierra en sucursal)
  const pendRcd = !fRecepCD, pendTras = !fTraslado, pendRsuc = !fRecepSuc, pendEnt = !fEntrega;
  const pendiente = pendRcd || pendTras || pendRsuc || pendEnt;
  const vencidoPend = pendiente && !!fPromesa && hoy > fPromesa;
  const enCurso = pendiente && !!fPromesa && hoy <= fPromesa;
  const centroResp = (pendRcd || pendTras) ? '1003' : r.punto_expedicion;
  const etapasPend = [pendRcd && 'Recepción CD', pendTras && 'Traslado', pendRsuc && 'Recepción Sucursal', pendEnt && 'Entrega Cliente'].filter(Boolean).join(' + ');
  const diasAtraso = vencidoPend ? bdays(fPromesa, hoy) : null;
  const diasParaVencer = enCurso ? bdays(hoy, fPromesa) : null;
  const estadoOp = fEntrega ? 'Entregado a Cliente'
    : fRecepSuc ? (esRetiro ? 'Listo para Retiro en Sucursal' : 'En Bodega Destino')
    : fTraslado ? 'En Tránsito'
    : fRecepCD ? 'Recepción en CD (sin traslado)'
    : 'Sin Recepción en CD';

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
    entregado, cumplido, vencido, evaluable, onTime, inFull, otif, fillRate, bultosEvento,
    pendiente, vencidoPend, enCurso, centroResp, etapasPend, diasAtraso, diasParaVencer, estadoOp,
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
    renderCurrent();
  } catch (e) {
    body().innerHTML = errorHTML(e);
  }
}

function paintShell() {
  _container.innerHTML = `
  <div class="w-full mx-auto" style="max-width:1760px">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="text-headline-sm font-bold">Flete Tercero · ${({ seguimiento: 'Seguimiento de Pedidos', vencidos: 'Pedidos Vencidos', en_curso: 'Pedidos en Curso' })[_view] || 'Nivel de Servicio'}</div>
      <span class="text-[13px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria automática · Supabase</span>
    </div>
    <div class="flex gap-sm mb-lg border-b border-surface-variant">
      ${tabBtn('dashboard', 'monitoring', 'Nivel de Servicio')}
      ${tabBtn('seguimiento', 'search', 'Seguimiento por Pedido')}
      ${tabBtn('vencidos', 'event_busy', 'Pedidos Vencidos')}
      ${tabBtn('en_curso', 'pending_actions', 'Pedidos en Curso')}
    </div>
    <div id="fter_body"></div>
  </div>`;
  _container.querySelectorAll('[data-fter-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _view = btn.getAttribute('data-fter-tab');
      paintShell();
      renderCurrent();
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
function renderCurrent() {
  if (_view === 'seguimiento') renderSeguimiento();
  else if (_view === 'vencidos') renderVencidos();
  else if (_view === 'en_curso') renderEnCurso();
  else renderDashboard();
}
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

  body().innerHTML = `
    <div class="text-[13px] text-secondary mb-md">${lastLoad ? `Última carga de datos: ${new Date(lastLoad).toLocaleString('es-CL')}` : ''} · ${rows.length} pedidos en total</div>

    <!-- 1. Nivel de servicio general -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${tile('Pedidos Evaluables', numFmt(evals.length), `de ${rows.length} pedidos totales`)}
      ${tile('OTIF', pct(otifPct), 'a tiempo y completos', '', stMeta(otifPct, META_FT.otif))}
      ${tile('Fill Rate', pct(fillPct), '% bultos entregados', '', stMeta(fillPct, META_FT.fill))}
      ${tile('En Proceso', numFmt(enProceso), 'aún no vencidos')}
    </div>

    <!-- 2. Por tipo de servicio -->
    ${sectionTitle('Nivel de Servicio por Tipo de Servicio')}
    <div class="text-[13px] text-secondary mb-sm">Retira (CLI-RET): se considera cumplido cuando el material está disponible en sucursal (Recepción Sucursal). Despacho: entrega al cliente.</div>
    ${barTable(porTipo.map(t => ({ label: escAttr(t.tipo || '–'), n: t.n, otif: t.otif, fill: t.fill })), 'Condición expedición')}

    <!-- 3. Por centro destino -->
    ${sectionTitle('Nivel de Servicio por Centro Destino')}
    <div class="text-[13px] text-secondary mb-sm">Ordenado por cantidad de pedidos evaluables. La marca negra es la meta.</div>
    ${barTable(porCentro.map(c => ({ label: escAttr(centroLabel(c.centro)), n: c.n, otif: c.otif, fill: c.fill })), 'Centro destino')}

    <!-- 4. Evolutivo mensual -->
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">Evolutivo Nivel de Servicio General (mes de creación)</div>
      <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Destino:
        <select id="fter_centro_filtro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
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
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">Cuello de Botella — Días Promedio por Etapa (hábiles)</div>
      <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Destino:
        <select id="fter_centro_cuello" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
          <option value="Todos">Todos</option>
          ${centros.map(c => `<option value="${c}">${escAttr(centroLabel(c))}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="fter_cuello"></div>
  `;

  const sel = document.getElementById('fter_centro_filtro');
  const drawEvol = () => {
    const ev = evolutivoFor(sel.value);
    document.getElementById('fter_evolutivo').innerHTML = lineChartSVG(
      [{ n: 'OTIF %', values: ev.map(e => e.otif), color: R.red }, { n: 'Fill Rate %', values: ev.map(e => e.fill), color: R.grey }],
      ev.map(e => mesCorto(e.mes)),
      { v: META_FT.otif, short: 'Meta ' + META_FT.otif + '%' }
    ) + `<details class="mb-lg -mt-md"><summary class="cursor-pointer text-[14px] font-semibold text-secondary py-1">Ver tabla mensual</summary>` + simpleTable(
      ['Mes', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
      ev.map(e => [mesCorto(e.mes), numFmt(e.n), pctCell(e.otif, META_FT.otif), pctCell(e.fill, META_FT.fill)])
    ) + `</details>`;
  };
  sel.value = _centroFiltro;
  sel.addEventListener('change', () => { _centroFiltro = sel.value; drawEvol(); });
  drawEvol();

  const selCB = document.getElementById('fter_centro_cuello');
  const drawCB = () => {
    const centroSel = selCB.value;
    const baseRows = centroSel === 'Todos' ? rows : rows.filter(r => r.punto_expedicion === centroSel);
    const cb = cuelloBotellaCalc(baseRows);
    document.getElementById('fter_cuello').innerHTML = `
      <div class="text-[13px] text-secondary mb-sm">${numFmt(cb.n)} pedidos considerados${centroSel !== 'Todos' ? ' en ' + escAttr(centroLabel(centroSel)) : ''}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
        ${tile('Lead Time Total', diasFmt(cb.leadTotal), 'Creación → Entrega, real')}
        ${tile('SLA Ofrecido', diasFmt(cb.slaProm), 'Creación +1 hábil → Promesa')}
        ${(function () { const dif = (cb.leadTotal != null && cb.slaProm != null) ? cb.leadTotal - cb.slaProm : null;
          return tile('Diferencia', (dif != null && dif > 0 ? '+' : '') + diasFmt(dif), 'Real − SLA ofrecido', '', dif == null ? null : (dif > 0 ? { c: '#C0000C', t: 'Sobre el SLA' } : { c: '#1E8449', t: 'Dentro del SLA' })); })()}
      </div>
      <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-xl">
      ${hbarChart(cb.etapas.map(e => ({ label: e.label, value: e.prom, isMax: cb.maxEtapa === e, share: (e.prom != null && cb.sumaEtapas) ? e.prom / cb.sumaEtapas * 100 : null })))}
      </div>`;
  };
  selCB.addEventListener('change', drawCB);
  drawCB();
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
          <input id="fter_search" type="text" placeholder="Buscar por N° de Pedido…" class="w-full pl-10 pr-10 py-2 border border-surface-variant rounded-lg text-body-md" value="${_selPedido || ''}" />
          <button id="fter_clear" type="button" title="Borrar búsqueda" aria-label="Borrar búsqueda" class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-high ${_selPedido ? '' : 'hidden'}">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>
    </div>
    <div id="fter_detalle"></div>
    ${sectionTitle('Todos los Pedidos')}
    <div class="flex items-center gap-md flex-wrap mb-sm">
      <select id="fter_f_estado" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Etapa: Todas</option>
        ${ESTADOS_BASE.map(e => `<option value="${e}">${e}</option>`).join('')}
        <option value="Listo para Entrega Cliente">Listo para Entrega Cliente</option>
      </select>
      <select id="fter_f_abierto" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Pedido: Abiertos y cerrados</option>
        <option value="abierto">Abiertos (sin entrega a cliente)</option>
        <option value="cerrado">Cerrados (entregados a cliente)</option>
      </select>
      <select id="fter_f_centro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Centro destino: Todos</option>
        ${uniq(rows.map(r => r.punto_expedicion)).sort().map(c => `<option value="${escAttr(c)}">${escAttr(centroLabel(c))}</option>`).join('')}
      </select>
      <button id="fter_f_reset" type="button" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px] text-secondary hover:bg-surface-container-high">Limpiar filtros</button>
      <span id="fter_count" class="text-[14px] text-secondary ml-auto"></span>
      <select id="fter_f_condicion" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Condición: Todas</option>
        ${uniq(rows.map(r => r.condicion_expedicion)).map(c => `<option value="${escAttr(c)}">${c}</option>`).join('')}
      </select>
      <select id="fter_f_venc" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
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
  const fAbierto = document.getElementById('fter_f_abierto');
  const fCentro = document.getElementById('fter_f_centro');
  const btnClear = document.getElementById('fter_clear');
  const syncClear = () => btnClear.classList.toggle('hidden', !input.value);

  const drawTabla = () => {
    const q = (input.value || '').trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter(r => String(r.id_pedido || '').toLowerCase().includes(q));
    if (fEstado.value) list = list.filter(r => r.estadoLabel === fEstado.value);
    if (fCond.value) list = list.filter(r => r.condicion_expedicion === fCond.value);
    if (fVenc.value === 'si') list = list.filter(r => r.vencido);
    if (fVenc.value === 'no') list = list.filter(r => !r.vencido);
    if (fAbierto.value === 'abierto') list = list.filter(r => r.pendiente);
    if (fAbierto.value === 'cerrado') list = list.filter(r => !r.pendiente);
    if (fCentro.value) list = list.filter(r => String(r.punto_expedicion) === fCentro.value);
    document.getElementById('fter_count').textContent = list.length > 200 ? `Mostrando 200 de ${list.length} pedidos` : `${list.length} pedido${list.length === 1 ? '' : 's'}`;
    document.getElementById('fter_tabla').innerHTML = pedidosTable(list.slice(0, 200));
    document.getElementById('fter_tabla').querySelectorAll('[data-pedido]').forEach(tr => {
      tr.addEventListener('click', () => { _selPedido = tr.getAttribute('data-pedido'); input.value = _selPedido; syncClear(); drawDetalle(); drawTabla(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });
  };
  const drawDetalle = () => {
    const r = rows.find(x => String(x.id_pedido) === String(_selPedido));
    document.getElementById('fter_detalle').innerHTML = r ? detalleHTML(r) : (
      _selPedido ? `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg text-secondary mb-lg">No se encontró el pedido "${escAttr(_selPedido)}".</div>` : ''
    );
  };

  input.addEventListener('input', () => { _selPedido = input.value.trim() || null; syncClear(); drawDetalle(); drawTabla(); });
  btnClear.addEventListener('click', () => { input.value = ''; _selPedido = null; syncClear(); drawDetalle(); drawTabla(); input.focus(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { input.value = ''; _selPedido = null; syncClear(); drawDetalle(); drawTabla(); } });
  document.getElementById('fter_f_reset').addEventListener('click', () => {
    input.value = ''; _selPedido = null; [fEstado, fCond, fVenc, fAbierto, fCentro].forEach(f => { f.value = ''; });
    syncClear(); drawDetalle(); drawTabla();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const exact = rows.find(x => String(x.id_pedido) === input.value.trim()); if (exact) { _selPedido = exact.id_pedido; drawDetalle(); } } });
  fEstado.addEventListener('change', drawTabla);
  fCond.addEventListener('change', drawTabla);
  fVenc.addEventListener('change', drawTabla);
  fAbierto.addEventListener('change', drawTabla);
  fCentro.addEventListener('change', drawTabla);

  drawDetalle();
  drawTabla();
}

function detalleHTML(r) {
  const badge = r.cumplido
    ? (r.otif ? badgeHTML('OTIF cumplido', '#1E8449') : badgeHTML((r.esRetiro ? 'Disponible en sucursal' : 'Entregado') + ' fuera de plazo / incompleto', '#C0000C'))
    : (r.vencido ? badgeHTML('Vencido sin entregar', '#C0000C') : badgeHTML('En proceso (dentro de plazo)', '#B5730B'));

  return `
  <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg mb-lg">
    <div class="flex items-start justify-between flex-wrap gap-sm mb-md">
      <div>
        <div class="text-headline-sm font-bold">Pedido ${escAttr(r.id_pedido)}</div>
        <div class="text-[14px] text-secondary mt-1">${escAttr(r.condicion_expedicion)} · ${escAttr(centroLabel(r.punto_expedicion))} · Ruta: ${escAttr(r.ruta_flete || '–')}</div>
      </div>
      ${badge}
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg text-[15px]">
      ${miniField('Fecha Creación', fmtFecha(r.fecha_creacion))}
      ${miniField('Fecha Promesa (Disponible Material)', fmtFecha(r.fecha_disponible_material))}
      ${miniField('Material', r.material || '–')}
      ${miniField('Bultos Solicitados / Cumplidos' + (r.esRetiro ? ' (recep. sucursal)' : ' (entrega)'), `${numFmt(r.cantidad_bultos)} / ${numFmt(r.bultosEvento)}`)}
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
        <div class="text-[13px] text-center mt-1 font-semibold ${p.activo ? 'text-on-surface' : 'text-secondary'}">${p.label}</div>
        <div class="text-[12px] text-secondary">${p.fecha ? fmtFecha(p.fecha) : '—'}</div>
      </div>`).join('')}
  </div>`;
}

function pedidosTable(list) {
  if (!list.length) return `<div class="text-secondary text-[15px] py-md">Sin resultados.</div>`;
  return `<div class="overflow-x-auto"><table class="w-full text-[14px] border-collapse mb-xl">
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
  return `<span class="inline-flex items-center gap-1 text-[13px] font-semibold px-2 py-[2px] rounded-full" style="background:${color}22;color:${color}">${r.estadoLabel}${r.vencido ? ' · Vencido' : ''}</span>`;
}
function badgeHTML(text, color) { return `<span class="inline-flex items-center gap-1 text-[14px] font-semibold px-3 py-1 rounded-full" style="background:${color}22;color:${color}">${text}</span>`; }
function miniField(label, value) { return `<div><div class="text-[12px] uppercase tracking-wide text-secondary mb-[2px]">${label}</div><div class="font-semibold text-on-surface">${escAttr(String(value))}</div></div>`; }

// ============================================================================
//  PEDIDOS VENCIDOS (no regularizados) y PEDIDOS EN CURSO
//  Misma lógica que las vistas SQL v_ft_vencidos / v_ft_en_curso (correo diario
//  "NIVEL DE SERVICIO REVEX"). Solo etapas físicas: en Retira el retiro del
//  cliente sí es una etapa pendiente para gestión (el OTIF cierra en Recepción Sucursal).
// ============================================================================
const AGING_BUCKETS = [{ k: '0-5', max: 5 }, { k: '6-20', max: 20 }, { k: '21-60', max: 60 }, { k: '>60', max: Infinity }];
function agingKey(d) { return AGING_BUCKETS.find(b => d <= b.max).k; }


// --- Piezas visuales para Vencidos / En Curso (27-sep-2026) -------------------
const ETAPA_COLOR = { 'Recepción CD': '#6B6E70', 'Traslado': '#8A6D3B', 'Recepción Sucursal': '#2E75B6', 'Entrega Cliente': '#C0000C' };
function chipsEtapas(txt) {
  if (!txt) return '–';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px">${String(txt).split(' + ').map(e => `<span style="font-size:13px;font-weight:600;white-space:nowrap;padding:2px 8px;border-radius:999px;background:${(ETAPA_COLOR[e] || '#6B6E70')}18;color:${ETAPA_COLOR[e] || '#6B6E70'};border:1px solid ${(ETAPA_COLOR[e] || '#6B6E70')}40">${escAttr(e)}</span>`).join('')}</div>`;
}
// Severidad del atraso: 0-5 · 6-20 · 21-60 · >60 días hábiles
const AGING_C = { '0-5': '#E0B252', '6-20': '#D98A00', '21-60': '#D9636B', '>60': '#C0000C' };
function atrasoPill(d) {
  const c = AGING_C[agingKey(d)];
  return `<span style="display:inline-block;min-width:44px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;padding:2px 8px;border-radius:6px;background:${c}22;color:${c === '#E0B252' ? '#8A6400' : c}">${numFmt(d)} d</span>`;
}
function venceePill(d) {
  const c = d <= 1 ? '#C0000C' : d <= 3 ? '#B5730B' : '#6B6E70';
  return `<span style="display:inline-block;min-width:44px;text-align:center;font-weight:700;padding:2px 8px;border-radius:6px;background:${c}18;color:${c}">${d <= 0 ? 'hoy' : numFmt(d) + ' d'}</span>`;
}
function agingBar(b, n) {
  if (!n) return '';
  return `<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;min-width:140px;background:#EFECE8">${AGING_BUCKETS.map(x => b[x.k] ? `<div title="${x.k} d: ${b[x.k]}" style="width:${b[x.k] / n * 100}%;background:${AGING_C[x.k]};border-right:2px solid #fff"></div>` : '').join('')}</div>`;
}
function agingLegend() {
  return `<div class="flex items-center gap-md flex-wrap mb-sm text-[13px] text-secondary">Atraso (días hábiles): ${AGING_BUCKETS.map(x => `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${AGING_C[x.k]}"></span>${x.k}</span>`).join('')}</div>`;
}

function descargarCSV(nombre, headers, filas) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [headers.map(esc).join(',')].concat(filas.map(f => f.map(esc).join(','))).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function hoyISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function csvBtn(id) {
  return `<button id="${id}" class="flex items-center gap-1 border border-surface-variant rounded-lg px-3 py-1 text-[14px] font-semibold text-primary hover:bg-surface-container-high"><span class="material-symbols-outlined text-[16px]">download</span>Descargar CSV</button>`;
}

function renderVencidos() {
  const { rows } = _cache;
  const v = rows.filter(r => r.vencidoPend);
  const resp = uniq(v.map(r => r.centroResp));
  const porResp = resp.map(c => {
    const g = v.filter(r => r.centroResp === c);
    const b = Object.fromEntries(AGING_BUCKETS.map(x => [x.k, g.filter(r => agingKey(r.diasAtraso) === x.k).length]));
    return { centro: c, n: g.length, prom: avg(g.map(r => r.diasAtraso)), max: Math.max(...g.map(r => r.diasAtraso)), b };
  }).sort((a, b) => b.n - a.n);
  const total = v.length;
  const en1003 = v.filter(r => r.centroResp === '1003').length;
  const mas60 = v.filter(r => r.diasAtraso > 60).length;
  const maxAtraso = total ? Math.max(...v.map(r => r.diasAtraso)) : null;
  const totB = Object.fromEntries(AGING_BUCKETS.map(x => [x.k, v.filter(r => agingKey(r.diasAtraso) === x.k).length]));

  body().innerHTML = `
    <div class="text-[13px] text-secondary mb-md">Pedidos con fecha promesa vencida y alguna etapa física pendiente (Recepción CD, Traslado, Recepción Sucursal y Entrega Cliente). Un pedido Retira ya en sucursal sigue pendiente hasta la entrega al cliente (el OTIF cierra en sucursal). Días de atraso en días hábiles.</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${tile('Vencidos por Regularizar', numFmt(total), 'con etapas pendientes', '', total ? { c: '#C0000C', t: 'Requieren gestión' } : { c: '#1E8449', t: 'Sin vencidos' })}
      ${tile('Responsable CD 1003', numFmt(en1003), total ? pct(en1003 / total * 100) + ' del total (falta Recepción CD/Traslado)' : '–')}
      ${tile('Atraso > 60 días háb.', numFmt(mas60), 'posibles registros sin cerrar en SAP')}
      ${tile('Atraso Máximo', maxAtraso == null ? '–' : numFmt(maxAtraso) + ' d', 'días hábiles')}
    </div>
    ${sectionTitle('1. Resumen por Centro Responsable de Cierre')}
    ${agingLegend()}
    ${simpleTable(['Centro Responsable', 'Pedidos Vencidos', 'Distribución del atraso', 'Atraso Prom. (d háb.)', 'Atraso Máx.', '0-5 d', '6-20 d', '21-60 d', '> 60 d'],
      porResp.map(p => [centroLabel(p.centro), `<b>${numFmt(p.n)}</b>`, agingBar(p.b, p.n), nf1.format(p.prom), atrasoPill(p.max), numFmt(p.b['0-5']), numFmt(p.b['6-20']), numFmt(p.b['21-60']), p.b['>60'] ? `<span style="color:#C0000C;font-weight:700">${numFmt(p.b['>60'])}</span>` : '0'])
        .concat(total ? [[`<b>Total</b>`, `<b>${numFmt(total)}</b>`, agingBar(totB, total), nf1.format(avg(v.map(r => r.diasAtraso))), atrasoPill(maxAtraso), numFmt(totB['0-5']), numFmt(totB['6-20']), numFmt(totB['21-60']), numFmt(totB['>60'])]] : []))}
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">2. Detalle de Pedidos a Gestionar</div>
      <div class="flex items-center gap-sm">
        <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Responsable:
          <select id="fter_venc_centro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
            <option value="Todos">Todos</option>
            ${porResp.map(p => `<option value="${escAttr(p.centro)}">${escAttr(centroLabel(p.centro))}</option>`).join('')}
          </select>
        </label>
        ${csvBtn('fter_venc_csv')}
      </div>
    </div>
    <div id="fter_venc_tabla"></div>`;

  const sel = document.getElementById('fter_venc_centro');
  sel.value = _centroVenc;
  const filtrado = () => v.filter(r => sel.value === 'Todos' || r.centroResp === sel.value)
    .sort((a, b) => (a.centroResp === b.centroResp ? b.diasAtraso - a.diasAtraso : String(a.centroResp).localeCompare(String(b.centroResp))));
  const draw = () => {
    _centroVenc = sel.value;
    const list = filtrado();
    document.getElementById('fter_venc_tabla').innerHTML = list.length
      ? simpleTable(['Centro Resp.', 'N° Pedido', 'Centro Destino', 'Condición', 'F. Creación', 'F. Promesa', 'Atraso (d háb.)', 'Estado Actual', 'Etapas Pendientes'],
        list.map(r => [escAttr(r.centroResp), `<b>${escAttr(r.id_pedido)}</b>`, escAttr(r.punto_expedicion), escAttr(r.condicion_expedicion), fmtFecha(r.fecha_creacion), fmtFecha(r.fecha_disponible_material),
          atrasoPill(r.diasAtraso), escAttr(r.estadoOp), chipsEtapas(r.etapasPend)]))
      : `<div class="text-secondary text-[15px] py-md">Sin pedidos vencidos pendientes.</div>`;
  };
  sel.addEventListener('change', draw);
  document.getElementById('fter_venc_csv').addEventListener('click', () => descargarCSV(
    `Pedidos_Vencidos_${hoyISO()}.csv`,
    ['Centro Responsable', 'ID Pedido', 'Centro Destino', 'Condicion Expedicion', 'Ruta Flete', 'Cantidad Bultos', 'Fecha Creacion', 'Fecha Promesa', 'Dias Atraso (habiles)', 'Estado Actual', 'Etapas Pendientes'],
    filtrado().map(r => [r.centroResp, r.id_pedido, r.punto_expedicion, r.condicion_expedicion, r.ruta_flete, r.cantidad_bultos, r.fecha_creacion, r.fecha_disponible_material, r.diasAtraso, r.estadoOp, r.etapasPend])));
  draw();
}

const ESTADOS_CURSO = ['Sin Recepción en CD', 'Recepción en CD (sin traslado)', 'En Tránsito', 'En Bodega Destino', 'Listo para Retiro en Sucursal'];
function renderEnCurso() {
  const { rows } = _cache;
  const c = rows.filter(r => r.enCurso);
  const total = c.length;
  const urgentes = c.filter(r => r.diasParaVencer <= 1).length;
  const estados = ESTADOS_CURSO.concat(uniq(c.map(r => r.estadoOp)).filter(e => ESTADOS_CURSO.indexOf(e) < 0));
  const centros = uniq(c.map(r => r.punto_expedicion)).sort();
  const filas = centros.map(ce => {
    const g = c.filter(r => r.punto_expedicion === ce);
    return { ce, n: g.length, porE: estados.map(e => g.filter(r => r.estadoOp === e).length), urg: g.filter(r => r.diasParaVencer <= 1).length };
  });
  const totE = estados.map(e => c.filter(r => r.estadoOp === e).length);

  body().innerHTML = `
    <div class="text-[13px] text-secondary mb-md">Pedidos dentro de plazo (fecha promesa vigente) que aún tienen etapas físicas pendientes. Días para vencer en días hábiles; 0-1 = vence hoy o mañana.</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${tile('Pedidos en Curso', numFmt(total), 'no cerrados, dentro de plazo')}
      ${tile('Vencen en ≤ 1 día háb.', numFmt(urgentes), 'hoy o mañana', urgentes ? 'text-[#C0000C]' : '')}
      ${tile('Sin Recepción en CD', numFmt(totE[0]), 'aún no ingresan al CD', totE[0] ? 'text-[#B5730B]' : '')}
      ${tile('En Tránsito / Sucursal', numFmt(totE[2] + totE[3] + totE[4]), 'camino a sucursal o ya en sucursal esperando entrega')}
    </div>
    ${sectionTitle('1. Pedidos en Curso por Centro Destino y Estado')}
    ${simpleTable(['Centro Destino'].concat(estados, ['Total', 'Vencen ≤ 1 d']),
      filas.map(f => [centroLabel(f.ce)].concat(f.porE.map(n => n ? numFmt(n) : '–'), [`<b>${numFmt(f.n)}</b>`, f.urg ? `<span style="color:#C0000C;font-weight:600">${numFmt(f.urg)}</span>` : '–']))
        .concat(total ? [['<b>Total</b>'].concat(totE.map(n => `<b>${numFmt(n)}</b>`), [`<b>${numFmt(total)}</b>`, `<b>${numFmt(urgentes)}</b>`])] : []))}
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">2. Detalle de Pedidos en Curso (más urgentes primero)</div>
      ${csvBtn('fter_curso_csv')}
    </div>
    <div id="fter_curso_tabla"></div>`;

  const list = c.slice().sort((a, b) => a.diasParaVencer - b.diasParaVencer || String(a.centroResp).localeCompare(String(b.centroResp)));
  document.getElementById('fter_curso_tabla').innerHTML = list.length
    ? simpleTable(['Para Vencer (d háb.)', 'N° Pedido', 'Centro Destino', 'Condición', 'F. Creación', 'F. Promesa', 'Estado Actual', 'Centro Resp.', 'Etapas Pendientes'],
      list.map(r => [venceePill(r.diasParaVencer), `<b>${escAttr(r.id_pedido)}</b>`, escAttr(r.punto_expedicion), escAttr(r.condicion_expedicion),
        fmtFecha(r.fecha_creacion), fmtFecha(r.fecha_disponible_material), escAttr(r.estadoOp), escAttr(r.centroResp), chipsEtapas(r.etapasPend)]))
    : `<div class="text-secondary text-[15px] py-md">Sin pedidos en curso.</div>`;
  document.getElementById('fter_curso_csv').addEventListener('click', () => descargarCSV(
    `Pedidos_en_Curso_${hoyISO()}.csv`,
    ['Centro Responsable', 'ID Pedido', 'Centro Destino', 'Condicion Expedicion', 'Ruta Flete', 'Cantidad Bultos', 'Fecha Creacion', 'Fecha Promesa', 'Dias Habiles para Vencer', 'Estado Actual', 'Etapas Pendientes'],
    list.map(r => [r.centroResp, r.id_pedido, r.punto_expedicion, r.condicion_expedicion, r.ruta_flete, r.cantidad_bultos, r.fecha_creacion, r.fecha_disponible_material, r.diasParaVencer, r.estadoOp, r.etapasPend])));
}

// ============================================================================
//  COMPONENTES REUTILIZABLES
// ============================================================================
function sectionTitle(t) { return `<div class="text-body-lg font-bold text-on-surface mt-lg mb-sm">${t}</div>`; }
function tile(label, value, sub, extraCls = '', st = null) {
  return `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md" style="${st ? 'border-top:4px solid ' + st.c : ''}">
    <div class="text-[13px] uppercase tracking-wide text-secondary mb-1">${label}</div>
    <div class="text-headline-sm font-bold ${extraCls}">${value}</div>
    ${st ? `<div class="text-[14px] font-semibold" style="color:${st.c}">● ${st.t}</div>` : ''}
    <div class="text-[13px] text-secondary mt-1">${sub}</div>
  </div>`;
}
// Semáforo vs meta: verde ≥ meta · ámbar hasta 5 pp bajo · rojo más abajo
function stMeta(v, meta) {
  if (v == null) return null;
  return v >= meta ? { c: '#1E8449', t: 'Sobre meta ' + meta + '%' } : v >= meta - 5 ? { c: '#B5730B', t: 'Cerca de meta ' + meta + '%' } : { c: '#C0000C', t: 'Bajo meta ' + meta + '%' };
}
// Tabla con barras: OTIF y Fill Rate como barras horizontales con marca de meta (más legible que % sueltos)
function barTable(filas, colLabel) {
  const bar = (v, meta) => {
    const st = stMeta(v, meta), w = v == null ? 0 : Math.max(0, Math.min(100, v));
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="position:relative;flex:1;height:12px;background:#EFECE8;border-radius:6px;min-width:80px">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${w}%;background:${st ? st.c : '#A9ACAE'};border-radius:6px"></div>
        <div title="Meta ${meta}%" style="position:absolute;left:${meta}%;top:-3px;bottom:-3px;width:2px;background:#333"></div>
      </div>
      <div style="width:52px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${st ? st.c : '#6B6E70'}">${pct(v)}</div></div>`;
  };
  return `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg overflow-x-auto">
    <table class="w-full text-[15px] border-collapse" style="min-width:560px">
      <thead><tr class="text-left text-secondary text-[13px] uppercase tracking-wide">
        <th class="py-2 pr-3">${colLabel}</th><th class="py-2 pr-3 text-right">Pedidos</th>
        <th class="py-2 pr-3" style="width:36%">OTIF <span class="normal-case">(meta ${META_FT.otif}%)</span></th>
        <th class="py-2" style="width:36%">Fill Rate <span class="normal-case">(meta ${META_FT.fill}%)</span></th></tr></thead>
      <tbody>${filas.map(f => `<tr class="border-t border-surface-variant">
        <td class="py-2 pr-3 whitespace-nowrap font-semibold">${f.label}</td>
        <td class="py-2 pr-3 text-right tabular-nums">${numFmt(f.n)}</td>
        <td class="py-2 pr-3">${bar(f.otif, META_FT.otif)}</td><td class="py-2">${bar(f.fill, META_FT.fill)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
// Metas (editar aquí). Semáforo: verde ≥ meta · ámbar hasta 5 pp bajo meta · rojo más abajo
const META_FT = { otif: 90, fill: 95 };
function pctCell(v, meta) {
  if (v == null) return '–';
  const m = meta || 90;
  const color = v >= m ? '#1E8449' : (v >= m - 5 ? '#B5730B' : '#C0000C');
  return `<span style="color:${color};font-weight:600">${pct(v)}</span>`;
}
function simpleTable(headers, rows) {
  return `<div class="overflow-x-auto"><table class="w-full text-[15px] border-collapse mb-md">
    <thead><tr class="text-left text-secondary border-b border-surface-variant">${headers.map(h => `<th class="py-2 pr-3">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr class="border-b border-surface-variant hover:bg-surface-container-low">${row.map(c => `<td class="py-2 pr-3 align-middle" style="${/^\d{2}-\d{2}-\d{4}$/.test(String(c)) ? 'white-space:nowrap' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function legend(items) {
  return `<div class="flex items-center gap-md flex-wrap mb-sm text-[13px] text-secondary">
    ${items.map(i => `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${i.c}"></span>${i.n}</span>`).join('')}
  </div>`;
}
const MIX_COLORS = [R.red, R.grey, R.amber, R.redL, R.greyL, '#0B2B4A', '#2E75B6'];
function mixColor(i) { return MIX_COLORS[i % MIX_COLORS.length]; }
function stackedBars(labels, mixRows, tipos) {
  if (!labels.length) return `<div class="text-secondary text-[15px]">Sin datos.</div>`;
  const w = Math.max(100 / labels.length, 4);
  return `<div class="flex items-end gap-1" style="height:140px">
    ${mixRows.map((m, idx) => {
      if (!m) return `<div style="width:${w}%"></div>`;
      const segs = tipos.map((t, i) => {
        const v = m.pct[t] || 0;
        // Etiqueta de dato dentro del segmento: solo si hay espacio suficiente (>= 10%)
        const label = v >= 12 ? `<span style="font-size:13px;font-weight:700;color:#fff;line-height:1">${Math.round(v)}%</span>` : '';
        return `<div style="height:${v}%;background:${mixColor(i)};display:flex;align-items:center;justify-content:center" title="${t}: ${nf1.format(v)}% (${m.porT[t] || 0} pedidos)">${label}</div>`;
      }).join('');
      return `<div class="flex flex-col items-center gap-1" style="width:${w}%">
        <div class="text-[13px] font-semibold text-secondary">${m.total}</div>
        <div class="w-full flex flex-col-reverse rounded overflow-hidden bg-surface-container-high" style="height:90px">${segs}</div>
        <div class="text-[13px] text-secondary whitespace-nowrap">${labels[idx]}</div>
      </div>`;
    }).join('')}
  </div>`;
}
// Barras horizontales con etiqueta de dato (días) al costado — usado en Cuello de Botella
function hbarChart(items) {
  const maxV = Math.max(...items.map(i => i.value || 0), 0.001);
  return `<div class="flex flex-col gap-2 mb-md">
    ${items.map(i => {
      const wpct = i.value != null ? Math.max((i.value / maxV) * 100, 3) : 0;
      const color = i.isMax ? R.red : R.grey;
      return `<div>
        <div class="flex justify-between items-baseline text-[14px] text-secondary mb-[2px]">
          <span>${i.label}${i.isMax ? ' <span style="color:' + R.red + ';font-weight:700">◀ MÁXIMO</span>' : ''}</span>
          <span class="font-semibold" style="color:${color}">${diasFmt(i.value)}${i.share != null ? ` <span class="text-secondary font-normal">· ${nf1.format(i.share)}% del lead time</span>` : ''}</span>
        </div>
        <div class="w-full h-4 bg-surface-container-high rounded overflow-hidden">
          <div style="width:${wpct}%;background:${color};height:100%"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}
function lineChartSVG(seriesArr, labels, meta) {
  // v2 (27-sep-2026): se dibuja al ancho real del contenedor → texto 11 px fijo (antes viewBox 900 escalado, 7-9 px)
  const cont = document.getElementById('fter_body');
  const W = Math.max(320, Math.round(((cont && cont.clientWidth) || 900) - 34)), H = 260, padL = 46, padR = meta ? 74 : 14, padT = 22, padB = 30, FS = 13;
  const w = W - padL - padR, h = H - padT - padB;
  const max = 100, min0 = 0;
  const n = labels.length, band = w / Math.max(n, 1);
  const x = i => padL + band * i + band / 2;
  const y = v => padT + h - (h * (v - min0) / (max - min0 || 1));
  const dense = band < 40;
  let svg = `<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg">${legend(seriesArr.map(s => ({ n: s.n, c: s.color })))}<svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;display:block;overflow:visible" role="img">`;
  [0, 25, 50, 75, 100].forEach(g => {
    const yy = y(g);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${R.grid}" stroke-width="1"/><text x="${padL - 7}" y="${yy + 4}" font-size="${FS}" fill="${R.grey}" text-anchor="end">${g}</text>`;
  });
  if (meta) {
    const ym = y(meta.v);
    svg += `<line x1="${padL}" y1="${ym}" x2="${W - padR}" y2="${ym}" stroke="#1E8449" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - padR + 4}" y="${ym + 4}" font-size="${FS}" font-weight="700" fill="#1E8449">${meta.short || ('Meta ' + meta.v + '%')}</text>`;
  }
  seriesArr.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    const vv = s.values.filter(v => v != null), vmax = Math.max(...vv), vmin = Math.min(...vv);
    s.values.forEach((v, i) => {
      if (v == null) return;
      // etiqueta arriba si es el valor más alto del mes, abajo si no → no se pisan
      const others = seriesArr.filter((o, k) => k !== si && o.values[i] != null).map(o => o.values[i]);
      const arriba = !others.length || v >= Math.max(...others);
      const show = !dense || i === 0 || i === n - 1 || v === vmax || v === vmin;
      svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"><title>${s.n} ${labels[i]}: ${nf1.format(v)}%</title></circle>`;
      if (show) svg += `<text x="${x(i)}" y="${y(v) + (arriba ? -9 : 17)}" font-size="${FS}" font-weight="700" fill="${s.color}" text-anchor="middle">${nf1.format(v)}%</text>`;
    });
  });
  const k = Math.max(1, Math.ceil(n * 44 / w));
  labels.forEach((l, i) => { if (i % k && i !== n - 1) return; svg += `<text x="${x(i)}" y="${H - 6}" font-size="${FS}" fill="${R.grey}" text-anchor="middle">${l}</text>`; });
  svg += '</svg></div>';
  return svg;
}

// --- Helpers -------------------------------------------------------------
function avg(arr) { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function uniq(arr) { return Array.from(new Set(arr.filter(x => x != null && x !== ''))); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
