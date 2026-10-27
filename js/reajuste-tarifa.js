// ============================================================================
// REAJUSTE POLINÓMICO (26-oct-2026, Jordan) — Tarifas Transporte › Reajuste Polinómico
// ----------------------------------------------------------------------------
// REAJUSTE = Σ ponderador_i × variación_i   ·   factor = 1 + REAJUSTE
//   variación_i = índice_i(período de corte) ÷ índice_i(período base) − 1
//   Ítems: Petróleo diésel · Dólar observado · IPC · Ingreso Mínimo Mensual
//   + "Parte fija" (no reajustable, variación 0). Los ponderadores son editables
//   (sólo OWNER) y deben sumar 100%.
// Índices: carga MANUAL mensual (un valor por período AAAA-MM).
// Aplicación: el factor se propone como borrador en Tarifas por Camión SÓLO sobre el
// COSTO BASE (b) de los centros elegidos (26-oct-2026, Jordan); al guardar ahí
// (con el aviso y la marca de fecha de siempre) el reajuste queda en el historial y
// el período de corte pasa a ser la nueva base.
//
// Datos (sin tablas nuevas): tariff_config.data.reajuste =
//   { pesos:{diesel,dolar,ipc,imm,fijo}, pesosAt, pesosBy, pesosHist:[…],
//     indices:{ 'AAAA-MM': {diesel,dolar,ipc,imm,at,by} }, base:'AAAA-MM', historial:[…] }
// ============================================================================
import { getDatabase, getTariffConfig, saveDatabase } from './data.js?v=202610271536';
import { showAlert } from './utils.js';
import { can, esOwner } from './permisos.js?v=202610271536';
import { esc, fmt, clp, numIn, wireNumIns, rerenderKeepFocus, debounce, chainHtml, wireChain, changesBarHtml, wireChangesBar, setParamPill, usuarioSesion } from './tarifas-ui.js?v=202610271536';
import { confirmar } from './confirmar.js?v=202610271536';
import { fechaHora, usuarioCorto, estilosVigente } from './tarifa-vigente.js?v=202610271536';
import { gruposReajuste, reajusteCamionesFilas, proponerReajusteCamiones } from './tarifas-transporte.js?v=202610271536';

export const ITEMS = [
  { k: 'diesel', l: 'Petróleo diésel', u: '$/L', d: 2, fuente: 'ENAP / CNE · precio diésel, promedio del mes' },
  { k: 'dolar', l: 'Dólar observado', u: '$/US$', d: 2, fuente: 'Banco Central · promedio del mes' },
  { k: 'ipc', l: 'IPC', u: 'índice', d: 2, fuente: 'INE · índice del mes (no la variación)' },
  { k: 'imm', l: 'Ingreso Mínimo Mensual', u: '$', d: 0, fuente: 'Ley / decreto · valor vigente en el mes' },
];
const FIJO = { k: 'fijo', l: 'Parte fija (no reajustable)', u: '', fuente: 'Porción de la tarifa que no se reajusta' };
const PESOS_DEF = { diesel: 20, dolar: 5, ipc: 35, imm: 40, fijo: 0 };
const CAMPOS_L = { baseKM: 'Costo base' };   // (26-oct-2026, Jordan) el reajuste sólo aplica al costo base

const R = { pesos: {}, idx: {}, nuevos: new Set(), borrar: new Set(), base: null, corte: null, grupos: null, nuevoPer: '', guardando: false };
const num = v => Number(v) || 0;
const pct = (v, d = 2) => (v == null || isNaN(v)) ? '—' : `${v > 0 ? '+' : ''}${fmt(v * 100, d)}%`;
const perLbl = p => {
  const m = String(p || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return p || '—';
  return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' }).replace('.', '');
};

// ── Configuración guardada ─────────────────────────────────────────────────
export function getReajusteCfg(cfg) {
  cfg.reajuste = cfg.reajuste || {};
  const r = cfg.reajuste;
  r.pesos = { ...PESOS_DEF, ...(r.pesos || {}) };
  r.indices = r.indices || {};
  r.pesosHist = r.pesosHist || [];
  r.historial = r.historial || [];
  return r;
}
const pesoVal = (rc, k) => (k in R.pesos ? R.pesos[k] : num(rc.pesos[k]));
const idxVal = (rc, per, k) => {
  const d = R.idx[per];
  if (d && k in d) return d[k];
  const v = rc.indices[per]?.[k];
  return v == null || v === '' ? null : Number(v);
};
function periodos(rc) {
  const s = new Set([...Object.keys(rc.indices), ...R.nuevos]);
  R.borrar.forEach(p => s.delete(p));
  return [...s].sort();
}
function nCambios(rc) {
  let n = 0;
  Object.entries(R.pesos).forEach(([k, v]) => { if (num(v) !== num(rc.pesos[k])) n++; });
  Object.entries(R.idx).forEach(([per, d]) => Object.entries(d).forEach(([k, v]) => {
    if (R.borrar.has(per)) return;
    const g = rc.indices[per]?.[k];
    if ((g == null ? null : Number(g)) !== v) n++;
  }));
  return n + R.nuevos.size + R.borrar.size;
}
const sumaPesos = rc => [...ITEMS, FIJO].reduce((s, it) => s + num(pesoVal(rc, it.k)), 0);

// ── Cálculo del reajuste (usa los valores en pantalla, incluidos los no guardados) ──
export function calcularReajuste(rc, base, corte, { conBorrador = true } = {}) {
  const peso = k => num(conBorrador ? pesoVal(rc, k) : rc.pesos[k]) / 100;
  const val = (per, k) => conBorrador ? idxVal(rc, per, k) : (rc.indices[per]?.[k] ?? null);
  const faltan = [];
  const filas = ITEMS.map(it => {
    const vb = val(base, it.k), vc = val(corte, it.k);
    const ok = vb > 0 && vc > 0;
    if (!ok && peso(it.k) > 0) faltan.push(`${it.l} (${!(vb > 0) ? perLbl(base) : perLbl(corte)})`);
    const variacion = ok ? vc / vb - 1 : null;
    return { ...it, peso: peso(it.k), base: vb, corte: vc, variacion, aporte: ok ? peso(it.k) * variacion : (peso(it.k) > 0 ? null : 0) };
  });
  const suma = [...ITEMS, FIJO].reduce((s, it) => s + peso(it.k), 0);
  const pesosOk = Math.abs(suma - 1) < 1e-6;
  const ok = !!base && !!corte && base < corte && !faltan.length && pesosOk;
  const reajuste = ok ? filas.reduce((s, f) => s + (f.aporte || 0), 0) : null;
  return { filas, fijo: peso('fijo'), suma, pesosOk, faltan, ok, reajuste, factor: ok ? 1 + reajuste : null };
}

function estilos() {
  estilosVigente();
  if (document.getElementById('rj-css')) return;
  const st = document.createElement('style');
  st.id = 'rj-css';
  st.textContent = `
.rj-formula{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:var(--sv-s1);border-radius:8px;padding:10px 14px;margin:0 16px 12px;line-height:1.6;color:var(--sv-ink)}
.rj-formula b{color:#1d4ed8}
.rj-sum{font-weight:700}.rj-sum.is-ok{color:#15803d}.rj-sum.is-bad{color:#b5000b}
.rj-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:0 16px 14px}
.rj-kpi{border:1px solid var(--sv-line);border-radius:8px;padding:12px 14px;background:#fff}
.rj-kpi-l{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--sv-ink2)}
.rj-kpi-v{font-size:26px;line-height:34px;font-weight:700;margin-top:4px}
.rj-kpi-s{font-size:12px;color:var(--sv-ink2)}
.rj-sel{display:flex;gap:16px;flex-wrap:wrap;align-items:center;padding:0 16px 12px}
.rj-sel label{display:flex;gap:8px;align-items:center;font-size:12.5px;font-weight:700;color:var(--sv-ink2)}
.rj-sel select,.rj-sel input{border:1px solid var(--sv-line);border-radius:6px;padding:6px 10px;font:inherit;font-weight:500;color:var(--sv-ink);background:#fff}
.rj-arrow{color:var(--sv-ink2);white-space:nowrap}
.rj-del td{opacity:.45;text-decoration:line-through}
.rj-scroll{overflow:auto;max-height:440px}
.rj-hist td{vertical-align:top}
`;
  document.head.appendChild(st);
}

// ── Vista ───────────────────────────────────────────────────────────────────
export function renderReajusteTarifa(container) {
  estilos();
  const db = getDatabase();
  const cfg = getTariffConfig(db);
  const rc = getReajusteCfg(cfg);
  setParamPill(cfg);
  const editar = can('editar');
  const editarPesos = editar && esOwner();
  const grupos = gruposReajuste(db);
  if (!R.grupos) R.grupos = new Set(grupos.map(g => g.grupo));

  function defaults() {
    const pers = periodos(rc);
    // Corte = último período, salvo que el usuario elija otro con un período base anterior
    if (!pers.includes(R.corte) || !R.base || !pers.some(p => p < R.corte)) R.corte = pers[pers.length - 1] || null;
    if (!pers.includes(R.base) || (R.corte && R.base >= R.corte)) {
      const b = rc.base && pers.includes(rc.base) && rc.base < R.corte ? rc.base : pers.filter(p => !R.corte || p < R.corte)[0];
      R.base = b || null;
    }
  }

  function render() {
    defaults();
    const nch = nCambios(rc);
    const C = calcularReajuste(rc, R.base, R.corte);
    container.innerHTML = `<div class="sv-view">
      ${changesBarHtml(nch, sumaPesos(rc) !== 100 ? 'los ponderadores no suman 100%' : '', R.guardando)}
      <div class="sv-vhead"><div style="min-width:0"><h1 class="sv-h1">Reajuste Polinómico</h1>
        <div class="sv-desc">Reajuste del costo base de transportistas por variación de diésel, dólar, IPC e ingreso mínimo. Ponderadores editables, índices de carga manual y propuesta de ajuste a Tarifas por Camión.</div></div>
        <div class="sv-actions"><button class="sv-btn" data-chip id="rj-csv"><span class="material-symbols-outlined">download</span>Descargar índices</button></div></div>
      ${chainHtml('transporte', 'reajuste')}
      ${cardFormula(C)}
      ${cardIndices()}
      ${cardCalculo(C)}
      ${cardAplicar(C, nch)}
      ${cardHistorial()}
    </div>`;
    wire();
  }

  function cardFormula(C) {
    const suma = sumaPesos(rc);
    const okSum = Math.abs(suma - 100) < 1e-6;
    const partes = ITEMS.filter(it => num(pesoVal(rc, it.k)) > 0).map(it => `<b>${fmt(pesoVal(rc, it.k), 2)}%</b> × Δ${esc(it.l)}`);
    const ult = rc.pesosAt ? `Ponderadores vigentes desde ${fechaHora(rc.pesosAt)} · ${esc(usuarioCorto(rc.pesosBy))}` : 'Ponderadores por defecto (aún no modificados)';
    return `<div class="sv-card">
      <div class="tf-tabletitle"><h3>Fórmula de reajuste</h3><small>${ult}${editar && !editarPesos ? ' · sólo OWNER modifica los ponderadores' : ''}</small></div>
      <div class="rj-formula">REAJUSTE = ${partes.join(' + ') || '—'}${num(pesoVal(rc, 'fijo')) > 0 ? ` <span class="sv-muted">(+ ${fmt(pesoVal(rc, 'fijo'), 2)}% parte fija sin reajuste)</span>` : ''}<br>Δ = índice período de corte ÷ índice período base − 1 · Factor = 1 + REAJUSTE</div>
      <div style="overflow:auto"><table class="sv-table" style="min-width:640px">
        <thead><tr><th>Ítem</th><th>Dato a cargar</th><th class="r">Ponderador</th></tr></thead>
        <tbody>${[...ITEMS, FIJO].map(it => {
          const v = pesoVal(rc, it.k);
          return `<tr style="cursor:default"><td class="sv-b">${esc(it.l)}</td><td class="sv-muted">${esc(it.fuente)}${it.u ? ` · <span class="sv-mono">${esc(it.u)}</span>` : ''}</td>
            <td class="r">${numIn(`w|${it.k}`, v, { unit: '%', w: '96px', changed: num(v) !== num(rc.pesos[it.k]), disabled: !editarPesos, label: `Ponderador ${it.l}` })}</td></tr>`;
        }).join('')}
        <tr class="vt-prom" style="cursor:default"><td colspan="2">Total</td><td class="r"><span class="rj-sum ${okSum ? 'is-ok' : 'is-bad'}">${fmt(suma, 2)}%</span>${okSum ? '' : '<div class="vt-was" style="color:#b5000b">debe sumar 100%</div>'}</td></tr>
        </tbody></table></div>
    </div>`;
  }

  function cardIndices() {
    const pers = periodos(rc).slice().reverse();
    const cols = ITEMS.map(it => `<th class="r">${esc(it.l)}<div class="sv-sub" style="font-weight:500">${esc(it.u)}</div></th>`).join('');
    const filaHtml = per => {
      const g = rc.indices[per] || {};
      const nuevo = R.nuevos.has(per);
      return `<tr style="cursor:default"><td class="sv-b" style="white-space:nowrap">${esc(perLbl(per))} <span class="sv-mono sv-muted" style="font-size:11px">${esc(per)}</span>${nuevo ? ' <span class="vt-was" style="display:inline">nuevo</span>' : ''}</td>
        ${ITEMS.map(it => {
          const v = idxVal(rc, per, it.k);
          const gv = g[it.k] == null || g[it.k] === '' ? null : Number(g[it.k]);
          return `<td class="r">${numIn(`i|${per}|${it.k}`, v ?? '', { w: it.k === 'imm' ? '120px' : '108px', changed: nuevo ? v != null : v !== gv, disabled: !editar, placeholder: '—', label: `${it.l} ${per}` })}</td>`;
        }).join('')}
        <td class="sv-muted" style="font-size:11.5px;white-space:nowrap">${g.at ? `${fechaHora(g.at, false)} · ${esc(usuarioCorto(g.by))}` : '—'}</td>
        <td class="r">${editar ? `<button class="tf-actbtn" data-chip data-rjdel="${esc(per)}" title="Eliminar período"><span class="material-symbols-outlined">delete</span></button>` : ''}</td></tr>`;
    };
    const borrados = [...R.borrar].sort().reverse().map(per => `<tr class="rj-del" style="cursor:default"><td colspan="${ITEMS.length + 2}">${esc(perLbl(per))} · se elimina al guardar</td>
      <td class="r"><button class="tf-actbtn" data-chip data-rjundo="${esc(per)}" title="Deshacer"><span class="material-symbols-outlined">undo</span></button></td></tr>`).join('');
    return `<div class="sv-card">
      <div class="tf-tabletitle"><h3>Índices mensuales</h3><small>Carga manual · un valor por mes · diésel y dólar como promedio del mes</small></div>
      ${editar ? `<div class="rj-sel"><label>Agregar período <input type="month" id="rj-per" value="${esc(R.nuevoPer)}"></label>
        <button class="sv-btn" data-chip id="rj-add"><span class="material-symbols-outlined">add</span>Agregar</button></div>` : ''}
      <div class="rj-scroll"><table class="sv-table" style="min-width:880px">
        <thead><tr><th>Período</th>${cols}<th>Actualizado</th><th></th></tr></thead>
        <tbody>${pers.length ? pers.map(filaHtml).join('') : `<tr class="sv-empty"><td colspan="${ITEMS.length + 3}">Sin índices cargados. Agrega al menos el período base y el período de corte.</td></tr>`}${borrados}</tbody>
      </table></div>
    </div>`;
  }

  function cardCalculo(C) {
    const pers = periodos(rc);
    const opt = (sel, filtro) => pers.filter(filtro).map(p => `<option value="${esc(p)}" ${p === sel ? 'selected' : ''}>${esc(perLbl(p))} (${esc(p)})</option>`).join('');
    const avisos = [];
    if (pers.length < 2) avisos.push('Carga al menos dos períodos para calcular el reajuste.');
    if (!C.pesosOk) avisos.push(`Los ponderadores suman ${fmt(C.suma * 100, 2)}%; deben sumar 100%.`);
    if (C.faltan.length) avisos.push('Faltan índices: ' + C.faltan.join(', ') + '.');
    const clsVar = v => v == null ? 'vt-eq' : v > 0 ? 'vt-up' : v < 0 ? 'vt-dn' : 'vt-eq';
    return `<div class="sv-card">
      <div class="tf-tabletitle"><h3>Cálculo del reajuste</h3><small>${rc.base ? `Base vigente: ${esc(perLbl(rc.base))} (último reajuste aplicado)` : 'Sin reajustes aplicados: elige el mes en que se fijó la tarifa actual como base'}</small></div>
      <div class="rj-sel">
        <label>Período base <select id="rj-base">${opt(R.base, p => !R.corte || p < R.corte)}</select></label>
        <span class="rj-arrow material-symbols-outlined">arrow_forward</span>
        <label>Período de corte <select id="rj-corte">${opt(R.corte, p => !R.base || p > R.base)}</select></label>
      </div>
      ${avisos.length ? `<div class="vt-warn" style="margin:0 16px 12px"><span class="material-symbols-outlined">warning</span><div>${avisos.map(esc).join('<br>')}</div></div>` : ''}
      <div class="rj-kpis">
        <div class="rj-kpi"><div class="rj-kpi-l">Reajuste</div><div class="rj-kpi-v ${clsVar(C.reajuste)}">${pct(C.reajuste)}</div><div class="rj-kpi-s">${esc(perLbl(R.base))} → ${esc(perLbl(R.corte))}</div></div>
        <div class="rj-kpi"><div class="rj-kpi-l">Factor</div><div class="rj-kpi-v">${C.factor ? fmt(C.factor, 4) : '—'}</div><div class="rj-kpi-s">costo base nuevo = actual × factor</div></div>
        <div class="rj-kpi"><div class="rj-kpi-l">Ejemplo</div><div class="rj-kpi-v">${C.factor ? clp(100000 * C.factor) : '—'}</div><div class="rj-kpi-s">costo base de $100.000 reajustado</div></div>
      </div>
      <div style="overflow:auto"><table class="sv-table" style="min-width:760px">
        <thead><tr><th>Ítem</th><th class="r">Ponderador</th><th class="r">Base</th><th class="r">Corte</th><th class="r">Variación</th><th class="r">Aporte al reajuste</th></tr></thead>
        <tbody>${C.filas.map(f => `<tr style="cursor:default"><td class="sv-b">${esc(f.l)}</td><td class="r">${fmt(f.peso * 100, 2)}%</td>
          <td class="r">${f.base > 0 ? fmt(f.base, f.d) : '—'}</td><td class="r">${f.corte > 0 ? fmt(f.corte, f.d) : '—'}</td>
          <td class="r ${clsVar(f.variacion)}">${pct(f.variacion)}</td><td class="r ${clsVar(f.aporte)}">${pct(f.aporte, 3)}</td></tr>`).join('')}
          ${C.fijo > 0 ? `<tr style="cursor:default"><td class="sv-b">${esc(FIJO.l)}</td><td class="r">${fmt(C.fijo * 100, 2)}%</td><td class="r">—</td><td class="r">—</td><td class="r vt-eq">0%</td><td class="r vt-eq">0%</td></tr>` : ''}
          <tr class="vt-prom" style="cursor:default"><td>Total</td><td class="r">${fmt(C.suma * 100, 2)}%</td><td></td><td></td><td></td><td class="r ${clsVar(C.reajuste)}">${pct(C.reajuste, 3)}</td></tr></tbody>
      </table></div>
    </div>`;
  }

  function cardAplicar(C, nch) {
    const filas = C.ok ? reajusteCamionesFilas(db, C.factor, R.grupos) : [];
    const porCamion = {};
    filas.forEach(f => { (porCamion[f.t.id] = porCamion[f.t.id] || { g: f.nombreTabla, t: f.t, c: {} }).c[f.campo] = f; });
    const celda = f => f ? `<span class="vt-a">${clp(f.actual)}</span> <span class="rj-arrow">→</span> <b>${clp(f.nuevo)}</b>` : '<span class="sv-muted">—</span>';
    const bloqueo = !editar ? 'Sin permiso de edición.' : nch ? 'Guarda los cambios de ponderadores / índices antes de proponer el reajuste.' : !C.ok ? 'Completa el cálculo del reajuste.' : !filas.length ? 'Elige al menos un centro con tarifas.' : '';
    return `<div class="sv-card">
      <div class="tf-tabletitle"><h3>Aplicar a Tarifas por Camión</h3><small>Sólo el costo base × factor, redondeado al peso. KM base, T. base KM y tarifa km no cambian.</small></div>
      <div class="sv-filters" style="padding:0 16px 10px"><div class="sv-frow"><span class="sv-flbl">Centros</span>
        <button class="sv-chip ${R.grupos.size === grupos.length ? 'is-on' : ''}" data-chip data-rjg="__all">Todos</button>
        ${grupos.map(g => `<button class="sv-chip ${R.grupos.has(g.grupo) ? 'is-on' : ''}" data-chip data-rjg="${esc(g.grupo)}">${esc(g.nombreTabla)}</button>`).join('')}</div></div>
      ${C.ok ? `<div class="rj-scroll"><table class="sv-table" style="min-width:620px">
        <thead><tr><th>Centro</th><th>Camión</th>${Object.values(CAMPOS_L).map(l => `<th class="r">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${Object.values(porCamion).map(x => `<tr style="cursor:default"><td>${esc(x.g)}</td><td class="sv-b" style="white-space:nowrap">${esc(x.t.type)}</td>
          ${Object.keys(CAMPOS_L).map(c => `<td class="r" style="white-space:nowrap">${celda(x.c[c])}</td>`).join('')}</tr>`).join('') || '<tr class="sv-empty"><td colspan="3">Sin camiones para los centros elegidos.</td></tr>'}</tbody>
      </table></div>` : ''}
      <div class="sv-tfoot" style="align-items:center"><span>${bloqueo ? esc(bloqueo) : `${fmt(Object.keys(porCamion).length)} camiones · ${fmt(filas.length)} valores. Quedan como cambio sin guardar en Tarifas por Camión, donde ves el impacto en ZCAP y guardas.`}</span>
        ${editar ? `<button class="sv-btn-p" data-chip id="rj-proponer" ${bloqueo ? 'disabled' : ''}><span class="material-symbols-outlined">send</span>Proponer en Tarifas por Camión</button>` : ''}</div>
    </div>`;
  }

  function cardHistorial() {
    const h = rc.historial.slice().reverse();
    return `<div class="sv-card">
      <div class="tf-tabletitle"><h3>Historial de reajustes aplicados</h3><small>${fmt(h.length)} registro(s)</small></div>
      <div class="rj-scroll"><table class="sv-table rj-hist" style="min-width:900px">
        <thead><tr><th>Aplicado</th><th>Base → corte</th><th>Ponderadores</th><th>Variaciones</th><th class="r">Reajuste</th><th class="r">Factor</th><th>Centros</th></tr></thead>
        <tbody>${h.length ? h.map(x => `<tr style="cursor:default"><td style="white-space:nowrap">${fechaHora(x.aplicado_at)}<div class="sv-sub">${esc(usuarioCorto(x.aplicado_by))}</div></td>
          <td style="white-space:nowrap">${esc(perLbl(x.base))} → ${esc(perLbl(x.corte))}</td>
          <td style="font-size:12px">${ITEMS.map(it => `${esc(it.l)} ${fmt(num(x.pesos?.[it.k]), 2)}%`).join('<br>')}${num(x.pesos?.fijo) ? `<br>Fija ${fmt(x.pesos.fijo, 2)}%` : ''}</td>
          <td style="font-size:12px">${ITEMS.map(it => `${esc(it.l)} ${pct(x.variaciones?.[it.k])}`).join('<br>')}</td>
          <td class="r sv-b">${pct(x.reajuste)}</td><td class="r">${fmt(x.factor, 4)}</td>
          <td style="font-size:12px">${esc((x.grupos || []).join(', '))}<div class="sv-sub">${fmt(x.valores || 0)} valores</div></td></tr>`).join('')
          : '<tr class="sv-empty"><td colspan="7">Aún no se aplica ningún reajuste.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  }

  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);

  function wire() {
    wireChain(container);
    wireNumIns(container, (key, val, raw) => {
      const p = key.split('|');
      if (p[0] === 'w') {
        if (num(val) === num(rc.pesos[p[1]])) delete R.pesos[p[1]]; else R.pesos[p[1]] = Math.max(0, num(val));
      } else if (p[0] === 'i') {
        const [, per, k] = p;
        const v = String(raw ?? '').trim() === '' ? null : num(val);
        const g = rc.indices[per]?.[k];
        R.idx[per] = R.idx[per] || {};
        if (!R.nuevos.has(per) && v === (g == null || g === '' ? null : Number(g))) delete R.idx[per][k]; else R.idx[per][k] = v;
        if (!Object.keys(R.idx[per]).length) delete R.idx[per];
      }
      recalc();
    });
    wireChangesBar(container, () => { R.pesos = {}; R.idx = {}; R.nuevos.clear(); R.borrar.clear(); render(); }, guardar);
    container.querySelector('#rj-per')?.addEventListener('change', e => { R.nuevoPer = e.target.value; });
    container.querySelector('#rj-add')?.addEventListener('click', () => {
      const per = (container.querySelector('#rj-per')?.value || '').trim();
      if (!/^\d{4}-\d{2}$/.test(per)) { showAlert('Elige un mes y año.', 'error'); return; }
      if (R.borrar.has(per)) { R.borrar.delete(per); render(); return; }
      if (rc.indices[per] || R.nuevos.has(per)) { showAlert(`El período ${perLbl(per)} ya existe.`, 'error'); return; }
      R.nuevos.add(per); R.nuevoPer = '';
      render();
    });
    container.querySelectorAll('[data-rjdel]').forEach(b => b.addEventListener('click', () => {
      const per = b.dataset.rjdel;
      if (R.nuevos.has(per)) { R.nuevos.delete(per); delete R.idx[per]; } else R.borrar.add(per);
      render();
    }));
    container.querySelectorAll('[data-rjundo]').forEach(b => b.addEventListener('click', () => { R.borrar.delete(b.dataset.rjundo); render(); }));
    container.querySelector('#rj-base')?.addEventListener('change', e => { R.base = e.target.value; render(); });
    container.querySelector('#rj-corte')?.addEventListener('change', e => { R.corte = e.target.value; render(); });
    container.querySelectorAll('[data-rjg]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.rjg;
      if (k === '__all') R.grupos = R.grupos.size === grupos.length ? new Set() : new Set(grupos.map(g => g.grupo));
      else if (R.grupos.has(k)) R.grupos.delete(k); else R.grupos.add(k);
      render();
    }));
    container.querySelector('#rj-csv')?.addEventListener('click', descargarIndices);
    container.querySelector('#rj-proponer')?.addEventListener('click', proponer);
  }

  async function guardar() {
    if (R.guardando || !nCambios(rc)) return;
    const suma = sumaPesos(rc);
    if (Math.abs(suma - 100) > 1e-6) { showAlert(`Los ponderadores suman ${fmt(suma, 2)}%; deben sumar 100%.`, 'error'); return; }
    const by = usuarioSesion(), at = new Date().toISOString();
    const cambianPesos = Object.entries(R.pesos).some(([k, v]) => num(v) !== num(rc.pesos[k]));
    if (cambianPesos) {
      const txt = [...ITEMS, FIJO].map(it => `${it.l}: ${fmt(num(rc.pesos[it.k]), 2)}% → ${fmt(num(pesoVal(rc, it.k)), 2)}%`).join('\n');
      if (!await confirmar(`¿Actualizar ponderadores de la fórmula?\n\n${txt}\n\nLos reajustes ya aplicados quedan con los ponderadores que tenían.`, { aceptar: 'Actualizar', icono: 'percent' })) return;
    }
    R.guardando = true;
    if (cambianPesos) {
      rc.pesosHist.push({ at: rc.pesosAt || null, by: rc.pesosBy || null, pesos: { ...rc.pesos }, reemplazado_at: at });
      [...ITEMS, FIJO].forEach(it => { rc.pesos[it.k] = num(pesoVal(rc, it.k)); });
      rc.pesosAt = at; rc.pesosBy = by;
    }
    R.borrar.forEach(per => { delete rc.indices[per]; });
    const tocados = new Set([...R.nuevos, ...Object.keys(R.idx)]);
    tocados.forEach(per => {
      if (R.borrar.has(per)) return;
      const row = { ...(rc.indices[per] || {}) };
      Object.entries(R.idx[per] || {}).forEach(([k, v]) => { row[k] = v; });
      row.at = at; row.by = by;
      rc.indices[per] = row;
    });
    R.pesos = {}; R.idx = {}; R.nuevos.clear(); R.borrar.clear(); R.guardando = false;
    saveDatabase(db, { syncOnly: ['tariffConfig'] });
    showAlert('Reajuste polinómico: cambios guardados.', 'success');
    render();
  }

  async function proponer() {
    const C = calcularReajuste(rc, R.base, R.corte, { conBorrador: false });
    if (!C.ok) { showAlert('Completa el cálculo del reajuste antes de proponerlo.', 'error'); return; }
    const filas = reajusteCamionesFilas(db, C.factor, R.grupos);
    if (!filas.length) { showAlert('No hay valores para reajustar en los centros elegidos.', 'error'); return; }
    const nombres = gruposReajuste(db).filter(g => R.grupos.has(g.grupo)).map(g => g.nombreTabla);
    const ok = await confirmar(`¿Proponer reajuste de ${pct(C.reajuste)} en Tarifas por Camión?\n\nFactor ${fmt(C.factor, 4)} (${perLbl(R.base)} → ${perLbl(R.corte)}) sobre ${fmt(filas.length)} valores de ${nombres.length} centro(s). Queda como cambio sin guardar en Tarifas por Camión: revisa el impacto y guarda ahí para aplicarlo.`, { aceptar: 'Proponer', icono: 'send' });
    if (!ok) return;
    proponerReajusteCamiones(db, filas, {
      base: R.base, corte: R.corte, pesos: { ...rc.pesos },
      indicesBase: Object.fromEntries(ITEMS.map(it => [it.k, rc.indices[R.base]?.[it.k] ?? null])),
      indicesCorte: Object.fromEntries(ITEMS.map(it => [it.k, rc.indices[R.corte]?.[it.k] ?? null])),
      variaciones: Object.fromEntries(C.filas.map(f => [f.k, f.variacion])),
      reajuste: C.reajuste, factor: C.factor, grupos: nombres,
    });
    document.querySelector('.sidebar-item[data-tab="tarifas-transporte"][data-sub="camiones"]')?.click();
  }

  function descargarIndices() {
    const pers = periodos(rc);
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const n = v => v == null || v === '' ? '' : String(v).replace('.', ',');
    const hdr = ['Periodo', ...ITEMS.map(it => `${it.l} (${it.u})`), 'Actualizado', 'Usuario'];
    const rows = pers.map(p => [p, ...ITEMS.map(it => n(idxVal(rc, p, it.k))), rc.indices[p]?.at || '', rc.indices[p]?.by || '']);
    const txt = [hdr.map(q).join(';'), ...rows.map(r => r.map(q).join(';'))].join('\n');
    const blob = new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `indices_reajuste_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  render();
}
