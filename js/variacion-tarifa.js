// ============================================================================
// VARIACIÓN TARIFA (25-oct-2026, Jordan) — Tarifas Transporte › Variación Tarifa
// ----------------------------------------------------------------------------
// Compara la TARIFA VIGENTE (foto de tarifa_vigente, ver tarifa-vigente.js) con
// las tarifas ACTUALES de la plataforma, por centro:
//   · Transportistas: costo base y tarifa por km de Tarifas por Camión (a, b, c,
//     tarifa km normal / especial) y ZCAP de las comunas regionales (o sectores /
//     interregionales) por tipo de camión: actual · nuevo · variación.
//   · Clientes: $/Kg (ZFMP), tarifa mínima (ZFMI), tarifa máxima (ZFMX), Express
//     y $/Kg centro por ruta y tipo de camión.
//   · Troncales: ZCAP de las rutas troncales (Motor de Costos completo).
// Ambos escenarios se calculan con los mismos motores (buildZcapMap y
// calcTarifas de Tarifas Clientes) sobre las rutas e histórico de hoy.
// Variación % = nuevo ÷ actual − 1 · promedios con suma de las rutas que tienen ambos valores.
// ============================================================================
import { getDatabase, getTariffConfig, getClientTariffConfig, getOrigenGroups, truckCapKg } from './data.js?v=202610252129';
import { buildZcapMap } from './zcap.js?v=202610252129';
import { calcTarifasEscenario } from './tarifas-clientes-v2.js?v=202610252129';
import { contextoTarifasClientes } from './tarifas-clientes.js?v=202610252129';
import { showAlert } from './utils.js';
import { can } from './permisos.js?v=202610252129';
import { esc, fmt, clp, chainHtml, wireChain, setParamPill, carPill, debounce } from './tarifas-ui.js?v=202610252129';
import { cargarVigente, asegurarVigente, escenarioVigente, diffCamiones, PARAMS_CAMION, valorParam, ultimaActualizacion,
  fechaHora, usuarioCorto, estilosVigente, confirmarFijar } from './tarifa-vigente.js?v=202610252129';

const VT = { tab: 'transportistas', centro: 'all', tipo: 'comuna', metrica: 'zfmp', solo: false, q: '', calc: null, calcId: null };
const TABS = [['transportistas', 'local_shipping', 'Transportistas'], ['clientes', 'request_quote', 'Clientes'], ['troncales', 'alt_route', 'Troncales']];
const TIPOS = [['comuna', 'Comunas regionales'], ['sector', 'Sectores'], ['interregional', 'Interregionales']];
const METRICAS = [['zfmp', '$/Kg', 2], ['zfmi', 'Tarifa mínima', 0], ['zfmx', 'Tarifa máxima', 0], ['express', 'Express', 0], ['kgCentro', '$/Kg centro', 2]];
const num = v => Number(v) || 0;
const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s+/-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());
const capDe = type => truckCapKg(type);
const tLbl = type => { const c = capDe(type); return c ? `${fmt(c / 1000)} t` : String(type || ''); };
const money = (v, d = 0) => (v == null || isNaN(v)) ? '—' : (d ? '$' + fmt(v, d) : clp(v));

// ── Grupos (Santiago + San Bernardo comparten tabla, igual que Tarifas por Camión) ──
function gruposVar(db) {
  const all = getOrigenGroups(db);
  const stgo = all.find(g => g.grupo === 'SANTIAGO'), sb = all.find(g => g.grupo === 'SAN BERNARDO');
  return all.filter(g => !(stgo && sb && g.grupo === 'SAN BERNARDO')).map(g => {
    const junto = g.grupo === 'SANTIAGO' && sb;
    return { key: g.grupo, repId: g.repId, nombre: junto ? 'Santiago + San Bernardo' : (g.nombre || titulo(g.grupo)),
      grupos: junto ? ['SANTIAGO', 'SAN BERNARDO'] : [g.grupo], ids: junto ? [...(g.centroIds || []), ...(sb.centroIds || [])] : (g.centroIds || []) };
  });
}
function tipoRuta(r, tron) {
  if (tron.has(r.codigo)) return 'troncal';
  if (r.clasificRuta !== 'Regional') return 'interregional';
  return String(r.tipo || '').toLowerCase() === 'sector' ? 'sector' : 'comuna';
}

// ── Cálculo de ambos escenarios ────────────────────────────────────────────
function calcular(db, vig) {
  const cfg = getTariffConfig(db);
  const dbOld = escenarioVigente(db, vig);
  const cfgOld = getTariffConfig(dbOld);
  const zNew = buildZcapMap(db, cfg, { incluir2t: true });
  const zOld = buildZcapMap(dbOld, cfgOld, { incluir2t: true });
  let cNew = [], cOld = [], errCli = '';
  try {
    const ctx = contextoTarifasClientes();
    const ccOld = getClientTariffConfig(dbOld);
    ctx.ensureCcfg(ccOld);
    cNew = calcTarifasEscenario(ctx, ctx.ccfg, zNew);
    cOld = calcTarifasEscenario({ ...ctx, db: dbOld, cfg: cfgOld, ccfg: ccOld }, ccOld, zOld);
  } catch (e) { errCli = e.message || String(e); console.error('Variación Tarifa (clientes):', e); }
  return {
    zNew, zOld, errCli,
    cNew: new Map(cNew.map(r => [r.key, r])), cOld: new Map(cOld.map(r => [r.key, r])),
    tron: new Set(cfg.variables?.troncalesRoutes || []),
    trucksOld: dbOld.truckTypes || [],
  };
}

// Filas ruta × camión de un mapa (ZCAP o clientes) para un grupo y tipo de ruta.
// get(v) → valor; devuelve [{ cod, ruta, cel: Map(type → { a, n }) }]
function filasRutas(mapOld, mapNew, g, tipo, tron, get) {
  const rutas = new Map();
  const add = (map, lado) => map.forEach(v => {
    const r = v.ruta;
    if (!r || !g.grupos.includes(r.origen_grupo) || tipoRuta(r, tron) !== tipo) return;
    const cod = r.codigo || String(r.id || '');
    if (!rutas.has(cod)) rutas.set(cod, { cod, ruta: r, cel: new Map() });
    const val = get(v);
    if (val == null || isNaN(val)) return;
    const t = v.truck?.type || '';
    const c = rutas.get(cod).cel.get(t) || {};
    c[lado] = Number(val);
    rutas.get(cod).cel.set(t, c);
  });
  add(mapOld, 'a'); add(mapNew, 'n');
  return [...rutas.values()].filter(x => x.cel.size).sort((x, y) => num(x.ruta.km) - num(y.ruta.km) || x.cod.localeCompare(y.cod));
}
const tiposCamion = filas => [...new Set(filas.flatMap(f => [...f.cel.keys()]))].sort((a, b) => capDe(a) - capDe(b));
const cambia = (c, d = 0) => c && ((c.a == null) !== (c.n == null) || Math.abs(num(c.n) - num(c.a)) > (d ? 0.005 : 0.5));

// Variación de sumas sobre las celdas con ambos valores
function varSuma(celdas) {
  let sa = 0, sn = 0, n = 0, ch = 0, tot = 0;
  celdas.forEach(c => {
    if (!c) return;
    tot++;
    if (cambia(c)) ch++;
    if (c.a > 0 && c.n > 0) { sa += c.a; sn += c.n; n++; }
  });
  return { pct: sa > 0 ? (sn / sa - 1) * 100 : null, promA: n ? sa / n : null, promN: n ? sn / n : null, n, ch, tot };
}

// ── Piezas HTML ─────────────────────────────────────────────────────────────
function pctHtml(p) {
  if (p == null || isNaN(p)) return '<span class="vt-eq">—</span>';
  if (Math.abs(p) < 0.05) return '<span class="vt-eq">0,0%</span>';
  return `<span class="${p > 0 ? 'vt-up' : 'vt-dn'}">${p > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(p), 1)}%</span>`;
}
// a/n null = no existe en ese escenario; unit para variaciones absolutas (base 0)
function varHtml(a, n, { d = 0, unit = '' } = {}) {
  if (a == null && n == null) return '<span class="vt-eq">—</span>';
  if (a == null) return '<span class="sv-pill info">Nuevo</span>';
  if (n == null) return '<span class="sv-pill bad">Sale</span>';
  if (Math.abs(n - a) <= (d ? 0.005 : 0.5)) return '<span class="vt-eq">—</span>';
  if (!(a > 0)) {
    const dd = n - a;
    return `<span class="${dd > 0 ? 'vt-up' : 'vt-dn'}">${dd > 0 ? '+' : '−'}${unit === 'km' ? fmt(Math.abs(dd)) + ' km' : money(Math.abs(dd), d)}</span>`;
  }
  return pctHtml((n / a - 1) * 100);
}
function kpi(lbl, val, sub, color) {
  return `<div class="sv-kpi" style="cursor:default"><div class="sv-kpi-l"><i style="background:${color}"></i>${esc(lbl)}</div>
    <div class="sv-kpi-v" style="font-size:26px;line-height:34px">${val}</div><div class="sv-kpi-s">${esc(sub)}</div></div>`;
}
function headTriple(tipos, primeras, lblFn = tLbl) {
  return `<thead><tr>${primeras.map(c => `<th rowspan="2" class="${c[1] || ''}">${esc(c[0])}</th>`).join('')}
    ${tipos.map(t => `<th colspan="3" class="vt-g vt-gh">${esc(lblFn(t))}</th>`).join('')}</tr>
    <tr>${tipos.map(() => '<th class="r vt-g">Actual</th><th class="r">Nuevo</th><th class="r">Var.</th>').join('')}</tr></thead>`;
}
function celdasTriple(c, d = 0) {
  if (!c) return '<td class="vt-g r vt-eq">—</td><td class="r vt-eq">—</td><td class="r vt-eq">—</td>';
  return `<td class="r vt-g vt-a">${money(c.a, d)}</td><td class="r"><b>${money(c.n, d)}</b></td><td class="r">${varHtml(c.a, c.n, { d })}</td>`;
}
// Tabla ruta × camión (actual · nuevo · var) con fila de promedios
function tablaRutas(filas, { d = 0, vacio = 'Sin rutas para el filtro.', extraCols = null } = {}) {
  const q = VT.q.trim().toLowerCase();
  let lista = filas.filter(f => !q || `${f.cod} ${f.ruta.destino || ''}`.toLowerCase().includes(q));
  if (VT.solo) lista = lista.filter(f => [...f.cel.values()].some(c => cambia(c, d)));
  const tipos = tiposCamion(filas);
  const ext = extraCols || [['Destino'], ['KM', 'r']];
  const cols = [['ID ruta'], ...ext];
  if (!lista.length) return `<div class="sv-note-box" style="margin:0 16px 16px">${esc(vacio)}</div>`;
  const prom = tipos.map(t => varSuma(lista.map(f => f.cel.get(t))));
  const filaProm = `<tr class="vt-prom" style="cursor:default"><td colspan="${cols.length}">Promedio · ${fmt(lista.length)} rutas</td>
    ${prom.map(p => `<td class="r vt-g">${money(p.promA, d)}</td><td class="r">${money(p.promN, d)}</td><td class="r">${pctHtml(p.pct)}</td>`).join('')}</tr>`;
  const filasHtml = lista.map(f => {
    const ch = [...f.cel.values()].some(c => cambia(c, d));
    const extra = extraCols ? extraCols.map(c => `<td class="${c[1] || ''}">${c[2](f)}</td>`).join('')
      : `<td><b>${esc(f.ruta.destino || '')}</b>${String(f.ruta.caracteristica || '').toUpperCase() !== 'NORMAL' && f.ruta.caracteristica ? ' ' + carPill(f.ruta.caracteristica) : ''}</td><td class="r">${fmt(num(f.ruta.km))}</td>`;
    return `<tr class="${ch ? 'vt-ch' : ''}" style="cursor:default"><td><span class="sv-mono">${esc(f.cod)}</span></td>${extra}
      ${tipos.map(t => celdasTriple(f.cel.get(t), d)).join('')}</tr>`;
  }).join('');
  return `<div class="sv-tablewrap" style="max-height:520px"><table class="sv-table vt-table" style="min-width:${300 + tipos.length * 300}px">
    ${headTriple(tipos, cols)}<tbody>${filaProm}${filasHtml}</tbody></table></div>`;
}

// ── Transportistas: parámetros de Tarifas por Camión + ZCAP por ruta ───────
function tablaParametros(db, vig, g, C) {
  const cur = (db.truckTypes || []).filter(t => t.Id_centro === g.repId);
  const old = C.trucksOld.filter(t => t.Id_centro === g.repId);
  const ids = [...new Set([...old.map(t => t.id), ...cur.map(t => t.id)])];
  const filas = ids.map(id => ({ id, a: old.find(t => t.id === id) || null, n: cur.find(t => t.id === id) || null }))
    .sort((x, y) => capDe((x.n || x.a).type) - capDe((y.n || y.a).type));
  if (!filas.length) return '<div class="sv-note-box" style="margin:0 16px 16px">Sin tipos de camión configurados para este centro.</div>';
  const params = PARAMS_CAMION.filter(([c]) => c !== 'rateAjustEsp' || filas.some(f => valorParam(f.a, 'rateAjustEsp') || valorParam(f.n, 'rateAjustEsp')));
  const desde = vig?.fijada_at || '';
  return `<div class="sv-tablewrap" style="max-height:none"><table class="sv-table vt-table" style="min-width:${260 + params.length * 270}px">
    <thead><tr><th rowspan="2">Tipo camión</th>${params.map(([, l, u]) => `<th colspan="3" class="vt-g vt-gh">${esc(l)} <span class="sv-muted" style="text-transform:none">(${esc(u)})</span></th>`).join('')}<th rowspan="2" class="vt-g">Actualizado</th></tr>
    <tr>${params.map(() => '<th class="r vt-g">Actual</th><th class="r">Nuevo</th><th class="r">Var.</th>').join('')}</tr></thead>
    <tbody>${filas.map(f => {
      const t = f.n || f.a;
      const ch = params.some(([c]) => (f.a ? valorParam(f.a, c) : null) !== (f.n ? valorParam(f.n, c) : null));
      const upd = f.n?.updated_at;
      return `<tr class="${ch ? 'vt-ch' : ''}" style="cursor:default"><td class="sv-b" style="white-space:nowrap">${esc(t.type)}</td>
        ${params.map(([c, , u]) => {
          const a = f.a ? valorParam(f.a, c) : null, n = f.n ? valorParam(f.n, c) : null;
          const show = v => v == null ? '—' : (u === 'km' ? fmt(v) + ' km' : clp(v));
          return `<td class="r vt-g vt-a">${show(a)}</td><td class="r"><b>${show(n)}</b></td><td class="r">${varHtml(a, n, { unit: u })}</td>`;
        }).join('')}
        <td class="vt-g" style="white-space:nowrap">${upd ? `<span class="vt-upd">${fechaHora(upd)}</span><div class="sv-sub">${esc(usuarioCorto(f.n.updated_by))}${desde && upd > desde ? ' · <b style="color:#c2410c">posterior a la vigente</b>' : ''}</div>` : '<span class="sv-muted">—</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function cardTransportista(db, vig, g, C) {
  const filas = filasRutas(C.zOld, C.zNew, g, VT.tipo, C.tron, v => num(v.zcap) > 0 ? num(v.zcap) : null);
  const d = diffCamiones(db, vig).filter(x => x.Id_centro === g.repId);
  const ult = ultimaActualizacion(db, g.repId);
  const tipoLbl = (TIPOS.find(x => x[0] === VT.tipo) || [])[1] || '';
  return `<div class="sv-card">
    <div class="tf-tabletitle"><div><h3>${esc(g.nombre)} <span class="sv-mono" style="color:#5c5f61;font-size:12px">${esc(g.ids.join(', '))}</span></h3>
      <small><span class="vt-upd"><span class="material-symbols-outlined">update</span> Actualizado ${ult.at ? `${fechaHora(ult.at)} · ${esc(usuarioCorto(ult.by))}` : '—'}</span></small></div>
      ${d.length ? `<span class="sv-pill orange"><i></i>${fmt(d.length)} ${d.length === 1 ? 'parámetro modificado' : 'parámetros modificados'}</span>` : '<span class="sv-pill ok"><i></i>Sin cambios vs vigente</span>'}</div>
    <div class="vt-sec">Costo base y tarifa por km · Tarifas por Camión</div>
    ${tablaParametros(db, vig, g, C)}
    <div class="vt-sec" style="padding-top:16px">ZCAP ${esc(tipoLbl.toLowerCase())} por tipo de camión</div>
    ${tablaRutas(filas, { vacio: `Sin ${tipoLbl.toLowerCase()} para este centro.` })}
    <div class="tf-card-foot"><span>ZCAP regional = b + c + máx(0, KM − a) × tarifa km · interregional = Motor de Costos</span><span>Var. = nuevo ÷ actual − 1 · promedio = suma de las rutas con ambos valores</span></div>
  </div>`;
}

// ── Clientes: $/Kg, mínima, máxima, express ─────────────────────────────────
function cardCliente(g, C) {
  const met = METRICAS.find(m => m[0] === VT.metrica) || METRICAS[0];
  const [mk, mlbl, md] = met;
  // Resumen por camión de todas las métricas
  const resumen = METRICAS.filter(m => m[0] !== 'kgCentro').map(([k, l, d]) => {
    const f = filasRutas(C.cOld, C.cNew, g, VT.tipo, C.tron, r => (r[k] != null && r[k] > 0 ? r[k] : null));
    return { k, l, d, f, tipos: tiposCamion(f) };
  });
  const tiposAll = [...new Set(resumen.flatMap(r => r.tipos))].sort((a, b) => capDe(a) - capDe(b));
  const resHtml = tiposAll.length ? `<div class="sv-tablewrap" style="max-height:none"><table class="sv-table vt-table" style="min-width:${180 + resumen.length * 300}px">
    <thead><tr><th rowspan="2">Tipo camión</th>${resumen.map(r => `<th colspan="3" class="vt-g vt-gh">${esc(r.l)}</th>`).join('')}</tr>
      <tr>${resumen.map(() => '<th class="r vt-g">Prom. actual</th><th class="r">Prom. nuevo</th><th class="r">Var.</th>').join('')}</tr></thead>
    <tbody>${tiposAll.map(t => `<tr style="cursor:default"><td class="sv-b" style="white-space:nowrap">${esc(t)}</td>${resumen.map(r => {
      const p = varSuma(r.f.map(f => f.cel.get(t)));
      return p.tot ? `<td class="r vt-g vt-a">${money(p.promA, r.d)}</td><td class="r"><b>${money(p.promN, r.d)}</b></td><td class="r">${pctHtml(p.pct)}${p.ch ? `<div class="sv-sub" style="text-align:right">${fmt(p.ch)} de ${fmt(p.tot)}</div>` : ''}</td>`
        : '<td class="r vt-g vt-eq">—</td><td class="r vt-eq">—</td><td class="r vt-eq">—</td>';
    }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="sv-note-box" style="margin:0 16px 16px">Sin tarifas a clientes para el filtro.</div>';
  // Detalle de la métrica elegida
  let detalle;
  if (mk === 'kgCentro') {
    const f = filasRutas(C.cOld, C.cNew, g, VT.tipo, C.tron, r => (r.kgCentro != null && r.kgCentro > 0 ? r.kgCentro : null));
    f.forEach(x => { const c = [...x.cel.values()][0]; x.cel = new Map(c ? [['Centro', c]] : []); });
    detalle = tablaRutas(f.filter(x => x.cel.size), { d: md, vacio: 'Sin $/Kg centro para el filtro (requiere histórico FLETE 360).' });
  } else {
    const f = resumen.find(r => r.k === mk)?.f || [];
    detalle = tablaRutas(f, { d: md });
  }
  return `<div class="sv-card">
    <div class="tf-tabletitle"><div><h3>${esc(g.nombre)} <span class="sv-mono" style="color:#5c5f61;font-size:12px">${esc(g.ids.join(', '))}</span></h3>
      <small>${esc((TIPOS.find(x => x[0] === VT.tipo) || [])[1] || '')} · tarifas a clientes de la plataforma</small></div></div>
    <div class="vt-sec">Resumen por tipo de camión</div>
    ${resHtml}
    <div class="vt-sec" style="padding-top:16px">${esc(mlbl)} por ruta y tipo de camión</div>
    ${detalle}
    <div class="tf-card-foot"><span>$/Kg = ZCAP ÷ kilos a consolidar · mínima = $/Kg del camión mínimo × kilos ÷ pedidos del cluster · máxima = ZCAP · Express = ZCAP × (1 + recargo)</span></div>
  </div>`;
}

// ── Troncales ───────────────────────────────────────────────────────────────
function cardTroncales(g, C) {
  const filas = filasRutas(C.zOld, C.zNew, g, 'troncal', C.tron, v => num(v.zcap) > 0 ? num(v.zcap) : null);
  if (!filas.length) return '';
  return `<div class="sv-card">
    <div class="tf-tabletitle"><div><h3>Troncales desde ${esc(g.nombre)}</h3><small>${fmt(filas.length)} rutas troncales · ZCAP por centro destino y tipo de camión</small></div></div>
    ${tablaRutas(filas, { extraCols: [['Centro destino', '', f => `<b>${esc(f.ruta.destino || '')}</b>${f.ruta.destinoId ? `<div class="sv-sub">${esc(f.ruta.destinoId)}</div>` : ''}`], ['KM', 'r', f => fmt(num(f.ruta.km))]] })}
    <div class="tf-card-foot"><span>ZCAP troncal = Motor de Costos completo (combustible, rendimientos, peajes, seguros, variables y costos extras)</span><span>Incluye ZCAP manual si está definido en Tarifas Rutas</span></div>
  </div>`;
}

// ── KPIs ────────────────────────────────────────────────────────────────────
function kpisHtml(db, vig, grupos, C) {
  const ids = new Set(grupos.map(g => g.repId));
  const d = diffCamiones(db, vig).filter(x => ids.has(x.Id_centro));
  const celdas = (mo, mn, tipo, get) => grupos.flatMap(g => filasRutas(mo, mn, g, tipo, C.tron, get).flatMap(f => [...f.cel.values()]));
  const zc = varSuma(celdas(C.zOld, C.zNew, 'comuna', v => num(v.zcap) > 0 ? num(v.zcap) : null));
  const kg = varSuma(['comuna', 'sector', 'interregional'].flatMap(t => celdas(C.cOld, C.cNew, t, r => (r.zfmp > 0 ? r.zfmp : null))));
  const tr = varSuma(celdas(C.zOld, C.zNew, 'troncal', v => num(v.zcap) > 0 ? num(v.zcap) : null));
  return `<div class="sv-kpis">
    ${kpi('Parámetros modificados', fmt(d.length), `costo base / tarifa km · ${fmt(new Set(d.map(x => x.id)).size)} camiones`, '#ea580c')}
    ${kpi('ZCAP comunas regionales', pctHtml(zc.pct), `${fmt(zc.ch)} de ${fmt(zc.tot)} ruta × camión cambian`, '#1d4ed8')}
    ${kpi('Tarifa $/Kg clientes', pctHtml(kg.pct), `${fmt(kg.ch)} de ${fmt(kg.tot)} ruta × camión cambian`, '#b5000b')}
    ${kpi('ZCAP troncales', pctHtml(tr.pct), `${fmt(tr.ch)} de ${fmt(tr.tot)} ruta × camión cambian`, '#7e22ce')}
  </div>`;
}

// ── CSV de la pestaña activa ────────────────────────────────────────────────
function descargarCsv(db, vig, grupos, C) {
  const sep = ';', qq = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const n0 = v => (v == null || isNaN(v) ? '' : String(Math.round(v)));
  const n2 = v => (v == null || isNaN(v) ? '' : Number(v).toFixed(2).replace('.', ','));
  const pc = (a, n) => (a > 0 && n != null ? ((n / a - 1) * 100).toFixed(1).replace('.', ',') : '');
  let H, R = [];
  if (VT.tab === 'clientes') {
    H = ['CENTRO ORIGEN', 'ID RUTA', 'DESTINO', 'TIPO RUTA', 'KM', 'TIPO CAMION'];
    METRICAS.forEach(([, l]) => H.push(`${l.toUpperCase()} ACTUAL`, `${l.toUpperCase()} NUEVO`, `${l.toUpperCase()} VAR %`));
    grupos.forEach(g => {
      const keys = new Set();
      [C.cOld, C.cNew].forEach(m => m.forEach((r, k) => { if (g.grupos.includes(r.ruta?.origen_grupo) && tipoRuta(r.ruta, C.tron) === VT.tipo) keys.add(k); }));
      [...keys].sort().forEach(k => {
        const a = C.cOld.get(k), n = C.cNew.get(k), r = n || a;
        const row = [g.nombre, r.cod, r.ruta.destino || '', VT.tipo, num(r.ruta.km), r.truck?.type || ''];
        METRICAS.forEach(([m, , d]) => { const va = a ? a[m] : null, vn = n ? n[m] : null; const f = d ? n2 : n0; row.push(f(va), f(vn), pc(va, vn)); });
        R.push(row);
      });
    });
  } else {
    H = ['CENTRO ORIGEN', 'CONCEPTO', 'ID RUTA', 'DESTINO', 'TIPO RUTA', 'KM', 'TIPO CAMION', 'ACTUAL', 'NUEVO', 'VAR %'];
    const tipo = VT.tab === 'troncales' ? 'troncal' : VT.tipo;
    grupos.forEach(g => {
      if (VT.tab === 'transportistas') {
        const cur = (db.truckTypes || []).filter(t => t.Id_centro === g.repId), old = C.trucksOld.filter(t => t.Id_centro === g.repId);
        [...new Set([...old, ...cur].map(t => t.id))].forEach(id => {
          const a = old.find(t => t.id === id), n = cur.find(t => t.id === id), t = n || a;
          PARAMS_CAMION.forEach(([c, l]) => {
            const va = a ? valorParam(a, c) : null, vn = n ? valorParam(n, c) : null;
            if (c === 'rateAjustEsp' && !va && !vn) return;
            R.push([g.nombre, l.toUpperCase(), '', '', '', '', t.type, n0(va), n0(vn), pc(va, vn)]);
          });
        });
      }
      filasRutas(C.zOld, C.zNew, g, tipo, C.tron, v => num(v.zcap) > 0 ? num(v.zcap) : null).forEach(f => {
        f.cel.forEach((c, t) => R.push([g.nombre, 'ZCAP', f.cod, f.ruta.destino || '', tipo, num(f.ruta.km), t, n0(c.a), n0(c.n), pc(c.a, c.n)]));
      });
    });
  }
  if (!R.length) { showAlert('Sin datos para descargar con el filtro actual.', 'error'); return; }
  const txt = [H.map(qq).join(sep), ...R.map(r => r.map(qq).join(sep))].join('\n');
  const blob = new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `variacion_tarifa_${VT.tab}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ── Vista ───────────────────────────────────────────────────────────────────
export async function renderVariacionTarifa(container) {
  estilosVigente();
  const db = getDatabase();
  setParamPill(getTariffConfig(db));
  const editar = can('editar');
  const marco = (cuerpo, acciones = '') => `<div class="sv-view">
    <div class="sv-vhead"><div style="min-width:0"><h1 class="sv-h1">Variación Tarifa</h1>
      <div class="sv-desc">Tarifa vigente vs tarifas actuales por centro: transportistas (costo base, tarifa km y ZCAP), clientes ($/Kg, mínima, máxima, express) y troncales.</div></div>
      <div class="sv-actions">${acciones}</div></div>
    ${chainHtml('transporte', 'variacion')}
    ${cuerpo}</div>`;
  const cargando = msg => { container.innerHTML = marco(`<div class="sv-card" style="padding:40px;text-align:center;color:var(--sv-ink2)">${esc(msg)}</div>`); wireChain(container); };

  cargando('Cargando tarifa vigente…');
  let vig;
  try {
    vig = await cargarVigente(true);
    if (!vig && editar) vig = await asegurarVigente(db);   // primera vez: la tarifa de hoy queda como vigente
  } catch (e) {
    container.innerHTML = marco(`<div class="sv-card" style="padding:32px;text-align:center"><div style="color:#b5000b;font-weight:700">No se pudo leer la tarifa vigente</div><div class="sv-muted" style="margin:6px 0 14px">${esc(e.message || e)}</div><button class="sv-btn" data-chip id="vt-retry"><span class="material-symbols-outlined">refresh</span>Reintentar</button></div>`);
    wireChain(container);
    container.querySelector('#vt-retry')?.addEventListener('click', () => renderVariacionTarifa(container));
    return;
  }
  if (!vig) {
    container.innerHTML = marco(`<div class="sv-card" style="padding:40px;text-align:center;color:var(--sv-ink2)"><span class="material-symbols-outlined" style="font-size:40px;color:#c5c7c9">difference</span>
      <div style="margin:8px 0 14px">Aún no hay una tarifa vigente registrada. Regístrala para medir la variación de los próximos ajustes.</div>
      ${editar ? '<button class="sv-btn-p" data-chip id="vt-reg"><span class="material-symbols-outlined">verified</span>Registrar tarifas actuales como vigentes</button>' : ''}</div>`);
    wireChain(container);
    container.querySelector('#vt-reg')?.addEventListener('click', async () => {
      try { await asegurarVigente(db); renderVariacionTarifa(container); } catch (e) { showAlert('No se pudo registrar: ' + (e.message || e), 'error'); }
    });
    return;
  }

  cargando('Calculando variación de tarifas…');
  await new Promise(r => setTimeout(r, 30));
  try { VT.calc = calcular(db, vig); VT.calcId = vig.id; } catch (e) {
    console.error('Variación Tarifa:', e);
    container.innerHTML = marco(`<div class="sv-card" style="padding:32px;text-align:center;color:#b5000b">Error al calcular la variación: ${esc(e.message || e)}</div>`);
    wireChain(container);
    return;
  }
  const C = VT.calc;
  const todos = gruposVar(db);
  if (VT.centro !== 'all' && !todos.some(g => g.key === VT.centro)) VT.centro = 'all';

  function render() {
    const grupos = VT.centro === 'all' ? todos : todos.filter(g => g.key === VT.centro);
    const ult = ultimaActualizacion(db);
    const acciones = `<button class="sv-btn" data-chip id="vt-recalc" title="Recalcula con las tarifas actuales"><span class="material-symbols-outlined">refresh</span>Recalcular</button>
      <button class="sv-btn" data-chip id="vt-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button>
      ${editar ? '<button class="sv-btn-p" data-chip id="vt-fijar" title="Las tarifas actuales pasan a ser la tarifa vigente; la anterior queda en el historial"><span class="material-symbols-outlined">verified</span>Fijar actuales como vigentes</button>' : ''}`;
    const info = `<div class="vt-note is-info"><span class="material-symbols-outlined">event</span>
      <span><b>Actual</b> = tarifa vigente fijada el <b>${fechaHora(vig.fijada_at)}</b> por ${esc(usuarioCorto(vig.fijada_by))}${vig.origen === 'auto' ? ' (registrada automáticamente antes del primer ajuste)' : ''}
      · <b>Nuevo</b> = tarifas actuales de la plataforma · última actualización de Tarifas por Camión ${ult.at ? `${fechaHora(ult.at)} por ${esc(usuarioCorto(ult.by))}` : '—'}</span></div>`;
    const tabs = `<div class="tf-tabs">${TABS.map(([k, ic, l]) => `<button data-chip data-vttab="${k}" class="${VT.tab === k ? 'is-on' : ''}"><span class="material-symbols-outlined">${ic}</span>${esc(l)}</button>`).join('')}</div>`;
    const seg = (attr, cur, opts) => `<div class="sv-seg">${opts.map(([k, l]) => `<button data-chip ${attr}="${esc(k)}" class="${cur === k ? 'is-on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const filtros = `<div class="sv-filters">
      <div class="sv-frow">${VT.tab !== 'troncales' ? seg('data-vttipo', VT.tipo, TIPOS) : ''}
        ${VT.tab === 'clientes' ? seg('data-vtmet', VT.metrica, METRICAS.map(m => [m[0], m[1]])) : ''}
        <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="vt-q" placeholder="Código o destino" value="${esc(VT.q)}" style="width:180px"></label>
        <button class="sv-chip ${VT.solo ? 'is-on' : ''}" data-chip id="vt-solo">${VT.solo ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">check</span> ' : ''}Sólo rutas con variación</button></div>
      <div class="sv-frow"><span class="sv-flbl">Centro origen</span>
        <button class="sv-chip ${VT.centro === 'all' ? 'is-on' : ''}" data-chip data-vtcentro="all">Todos</button>
        ${todos.map(g => `<button class="sv-chip ${VT.centro === g.key ? 'is-on' : ''}" data-chip data-vtcentro="${esc(g.key)}">${esc(g.nombre)}</button>`).join('')}</div>
    </div>`;
    let cuerpo;
    if (VT.tab === 'transportistas') cuerpo = grupos.map(g => cardTransportista(db, vig, g, C)).join('');
    else if (VT.tab === 'clientes') cuerpo = (C.errCli ? `<div class="sv-note-box" style="color:#b5000b">No se pudieron calcular las tarifas a clientes: ${esc(C.errCli)}</div>` : '') + grupos.map(g => cardCliente(g, C)).join('');
    else cuerpo = grupos.map(g => cardTroncales(g, C)).join('') || '<div class="sv-note-box">Sin rutas troncales configuradas para el filtro (Tarifas Rutas › Troncales).</div>';
    container.innerHTML = marco(`${info}${kpisHtml(db, vig, grupos, C)}${tabs}${filtros}<div class="vt-cards">${cuerpo}</div>`, acciones);
    wire();
  }
  function wire() {
    wireChain(container);
    container.querySelectorAll('[data-vttab]').forEach(b => b.addEventListener('click', () => { VT.tab = b.dataset.vttab; render(); }));
    container.querySelectorAll('[data-vttipo]').forEach(b => b.addEventListener('click', () => { VT.tipo = b.dataset.vttipo; render(); }));
    container.querySelectorAll('[data-vtmet]').forEach(b => b.addEventListener('click', () => { VT.metrica = b.dataset.vtmet; render(); }));
    container.querySelectorAll('[data-vtcentro]').forEach(b => b.addEventListener('click', () => { VT.centro = b.dataset.vtcentro; render(); }));
    container.querySelector('#vt-solo')?.addEventListener('click', () => { VT.solo = !VT.solo; render(); });
    const q = container.querySelector('#vt-q');
    q?.addEventListener('input', debounce(() => {
      VT.q = q.value; const pos = q.selectionStart; render();
      const n = container.querySelector('#vt-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_e) { /* no-op */ }
    }, 250));
    container.querySelector('#vt-recalc')?.addEventListener('click', () => renderVariacionTarifa(container));
    container.querySelector('#vt-csv')?.addEventListener('click', () => descargarCsv(db, vig, VT.centro === 'all' ? todos : todos.filter(g => g.key === VT.centro), C));
    container.querySelector('#vt-fijar')?.addEventListener('click', async () => { if (await confirmarFijar(db)) renderVariacionTarifa(container); });
  }
  render();
}
