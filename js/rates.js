// Cotizador de Despacho — SIT EBEMA (rediseño v2, 30-sep-2026)
// ---------------------------------------------------------------------------
// Precio al cliente por tramos: Retiro (primera milla) · Traslado troncal ·
// Última milla, con reglas de minimización A/B/C. El cálculo vive en
// cotizador-engine.js (SIN CAMBIOS) y usa las tarifas de Tarifas Clientes
// (ZCAP vigente, ZFMI, ZFMP y Tarifa Express por ruta y tipo de camión).
//
// Rediseño v2:
//   · Paso 1 «¿Cómo se mueve la carga?» (Desde / Hasta) → código de flujo
//   · Paso 2 origen, destino y kilos (centro que atiende cada comuna, atajos
//     de kilos y escala de camión con % de ocupación)
//   · Paso 3 Consolidado y Exclusivo calculados a la vez («Menor costo»)
//   · Resultado fijo a la derecha: total, recorrido paso a paso, alertas
//   · Guardar cotización explícito, Copiar resumen, historial con «Reusar»
//   · Tarifas de retiro troncal (Regla B) en panel lateral sólo OWNER
//   · Mapa Leaflet + OSRM como antes
// ---------------------------------------------------------------------------
import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig } from './data.js?v=202610081903';
import {
  buildCotizadorContext, cotizar, cdsDeComuna, normComuna, camionPorKilos,
  getRetiroTroncalTarifas, RETIRO_TRONCAL_DEFAULT, HUB_GRUPO, FLUJOS
} from './cotizador-engine.js?v=202610081903';
import { getRol } from './permisos.js?v=202610081903';
import { showAlert, loadLeaflet } from './utils.js';
import { esc, fmt, clp, numIn, wireNumIns, setParamPill } from './tarifas-ui.js?v=202610081903';

// ── Historial de cotizaciones por perfil (localStorage) ─────────────────────
const RECENT_QUOTES_MAX = 15;
function getSessionEmail() {
  try { return JSON.parse(localStorage.getItem('ebema_user_session') || '{}').email || 'anon'; } catch (e) { return 'anon'; }
}
const recentQuotesKey = () => `ebema_recent_quotes_v2_${getSessionEmail()}`;
function loadRecentQuotes() {
  try { const l = JSON.parse(localStorage.getItem(recentQuotesKey()) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
function saveRecentQuote(entry) {
  try {
    const list = loadRecentQuotes().filter(q => q.firma !== entry.firma);
    list.unshift(entry);
    localStorage.setItem(recentQuotesKey(), JSON.stringify(list.slice(0, RECENT_QUOTES_MAX)));
    return true;
  } catch (e) { return false; }
}

// ── Distancia y geometría por carretera (OSRM) con caché de sesión ──────────
const _kmCache = new Map();
const _geoCache = new Map();
function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function kmCarretera(a, b) {
  const key = `${a.lat},${a.lon}|${b.lat},${b.lon}`;
  if (_kmCache.has(key)) return _kmCache.get(key);
  let res = null;
  try {
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    if (resp.ok) { const m = (await resp.json())?.routes?.[0]?.distance; if (m) res = { km: Math.round(m / 100) / 10, estimado: false }; }
  } catch (_) { /* sin red */ }
  if (!res) res = { km: Math.round(haversineKm(a, b) * 1.3 * 10) / 10, estimado: true };
  _kmCache.set(key, res);
  return res;
}
async function geometriaRuta(a, b) {
  const key = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  if (_geoCache.has(key)) return _geoCache.get(key);
  let geo = null;
  try {
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`);
    if (resp.ok) { const c = (await resp.json())?.routes?.[0]?.geometry?.coordinates; if (c && c.length > 1) geo = c.map(([lon, lat]) => [lat, lon]); }
  } catch (_) { /* sin red: línea recta */ }
  _geoCache.set(key, geo);
  return geo;
}

// ── Constantes de la vista ──────────────────────────────────────────────────
const COL = { retiro: '#d97706', troncal: '#b5000b', ultima: '#15803d', directo: '#7e22ce', ajuste: '#5c5f61' };
const LEYENDA = [['retiro', 'Retiro (primera milla)'], ['troncal', 'Traslado troncal'], ['ultima', 'Última milla'], ['directo', 'Directo']];
const DESDE = [
  ['stock', 'inventory_2', 'Stock en centro EBEMA', 'Mercadería disponible en un centro'],
  ['fab_ent', 'move_to_inbox', 'Fábrica entrega en centro', 'Calzada: el proveedor la deja en el CD'],
  ['fab_ret', 'factory', 'EBEMA retira en fábrica', 'Calzada: vamos a buscarla'],
];
const HASTA = [
  ['despacho', 'local_shipping', 'EBEMA despacha a comuna', 'Entrega en obra o domicilio'],
  ['retira', 'person_pin_circle', 'Cliente retira en centro', 'Sólo cuando EBEMA retira en fábrica'],
];
const FLUJO_DE = { 'stock|despacho': 'EBE-DESP', 'fab_ent|despacho': 'FAB-DESP/EBE-DESP', 'fab_ret|retira': 'EBE-RET/CLI-RET', 'fab_ret|despacho': 'EBE-RET/EBE-DESP' };
const DESDE_HASTA = Object.fromEntries(Object.entries(FLUJO_DE).map(([k, v]) => [v, k.split('|')]));
const KILOS_RAPIDOS = [1000, 5000, 12000, 28000];
const ESCALA = [['Camión 5 Ton', 5000, '5 t'], ['Camión 10 Ton', 10000, '10 t'], ['Camión 15 Ton', 15000, '15 t'], ['Camión 28 Ton', 28000, '28 t']];
const tipoTramo = k => (k === 'retiro' ? 'retiro' : (/^troncal/.test(k) || k === 'cargo_ruta') ? 'troncal' : k === 'ultima' ? 'ultima' : k === 'ajuste_tope' ? 'ajuste' : 'directo');

// Lista desplegable con búsqueda (se abre al hacer clic, filtra al escribir)
function comboHtml(id, placeholder, valor) {
  return `<div class="qz-combo" data-combo="${id}">
    <label class="sv-inp qz-inp"><span class="material-symbols-outlined">search</span><input type="text" id="${id}" placeholder="${esc(placeholder)}" value="${esc(valor || '')}" autocomplete="off"></label>
    <div class="qz-combo-panel" hidden></div></div>`;
}
function initCombo(wrap, items, onPick) {
  const txt = wrap.querySelector('input');
  const panel = wrap.querySelector('.qz-combo-panel');
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let activos = [];
  const pintar = todo => {
    const q = norm(txt.value);
    activos = (todo || !q) ? items : items.filter(i => norm(i.label).includes(q) || norm(i.sub).includes(q));
    panel.innerHTML = activos.length
      ? activos.slice(0, 80).map((i, k) => `<div data-k="${k}"><span>${esc(i.label)}</span>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>`).join('')
      : '<div class="qz-combo-empty">Sin coincidencias</div>';
    panel.hidden = false;
  };
  const elegir = item => { txt.value = item.label; panel.hidden = true; onPick(item, true); };
  txt.addEventListener('focus', () => pintar(true));
  txt.addEventListener('click', () => pintar(true));
  txt.addEventListener('input', () => { pintar(false); const ex = items.find(i => norm(i.label) === norm(txt.value)); onPick(ex || { value: '', label: txt.value }, false); });
  txt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && activos.length) { e.preventDefault(); elegir(activos[0]); }
    if (e.key === 'Escape') panel.hidden = true;
  });
  panel.addEventListener('mousedown', e => { const d = e.target.closest('[data-k]'); if (d) { e.preventDefault(); elegir(activos[Number(d.dataset.k)]); } });
  txt.addEventListener('blur', () => setTimeout(() => { panel.hidden = true; }, 150));
}

// ============================================================================
export function renderRatesView(container) {
  const db = getDatabase();
  const cfg = getTariffConfig(db);
  const ccfg = getClientTariffConfig(db);
  let ctx;
  try {
    ctx = buildCotizadorContext(db, cfg, ccfg);
  } catch (err) {
    console.error('Error construyendo tarifas del cotizador:', err);
    container.innerHTML = `<div class="sv-view"><div class="sv-note-box" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">No se pudieron cargar las tarifas de clientes: ${esc(err.message || String(err))}</div></div>`;
    return;
  }
  setParamPill(cfg);
  const grupos = [...ctx.grupoInfo.values()].filter(g => [...ctx.rutaPorGrupoDest.keys()].some(k => k.startsWith(g.grupo + '|')));
  const comunas = [...ctx.comunas.values()].filter(c => c.cds.length).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const esOwner = getRol() === 'OWNER';
  const nomG = g => ctx.grupoInfo.get(g)?.nombre || g || '—';
  const nuevoId = () => `${Math.floor(1000 + Math.random() * 9000)}-QT`;

  const S = { desde: 'stock', hasta: 'despacho', cdOrigen: HUB_GRUPO, comunaRetiro: '', cdDestino: '', comunaDespacho: '', kilos: '', servicio: null, quoteId: nuevoId(), guardadaFirma: null, copiado: false, tocado: false };
  const R = { cons: null, excl: null, input: null, kmInfo: null };
  let admin = null; // borrador del panel OWNER

  // ── Estructura fija (el formulario no se re-dibuja al escribir) ─────────
  container.innerHTML = `<div class="sv-view">
    <div class="sv-vhead">
      <div style="min-width:0"><h1 class="sv-h1">Cotizador de Despacho</h1><div class="sv-desc">Cotizador de despacho a clientes: precio por tramo (retiro, traslado troncal y última milla) con el recorrido de menor costo.</div></div>
      <div class="sv-actions">
        <button class="sv-btn" data-chip id="qz-reset"><span class="material-symbols-outlined">restart_alt</span>Nueva cotización</button>
        ${esOwner ? '<button class="sv-btn" data-chip id="qz-admin-open"><span class="material-symbols-outlined">settings</span>Tarifas retiro troncal</button>' : ''}
      </div>
    </div>
    <div class="qz-grid">
      <div class="qz-form">
        <section class="sv-card qz-step" id="qz-paso1"></section>
        <section class="sv-card qz-step" id="qz-paso2"></section>
        <section class="sv-card qz-step" id="qz-paso3"></section>
        <section class="sv-card qz-mapcard">
          <div class="tf-tabletitle"><div><h3>Mapa del recorrido</h3><small>Recorrido por carretera · pasa el mouse sobre cada tramo para ver su monto</small></div></div>
          <div id="quote-fleet-map" class="qz-map"></div>
        </section>
      </div>
      <aside class="qz-res" id="qz-res"></aside>
    </div>
    <section class="sv-card" id="qz-hist"></section>
    <div id="qz-admin"></div>
  </div>`;
  const $ = id => container.querySelector('#' + id);

  // ── Paso 1 ──────────────────────────────────────────────────────────────
  function flujoActual() { return FLUJO_DE[S.desde + '|' + S.hasta] || 'EBE-DESP'; }
  function pintarPaso1() {
    const f = flujoActual();
    const tarjeta = (grupo, [k, ic, lbl, sub], on, dis = false) => `<button class="qz-opt ${on ? 'is-on' : ''}" data-chip data-${grupo}="${k}" ${dis ? 'disabled title="Disponible sólo con «EBEMA retira en fábrica»"' : ''}>
      <span class="material-symbols-outlined">${ic}</span><span><b>${esc(lbl)}</b><small>${esc(sub)}</small></span></button>`;
    $('qz-paso1').innerHTML = `<div class="qz-step-h"><div><span class="qz-num">1</span>¿Cómo se mueve la carga?</div>
        <span class="qz-flujo ${FLUJOS[f].tipo === 'CALZADA' ? 'is-calzada' : ''}" title="${esc(FLUJOS[f].label)}">${esc(f)}</span></div>
      <div class="qz-cols">
        <div class="qz-col"><span class="qz-lbl">Desde</span>${DESDE.map(o => tarjeta('qdesde', o, S.desde === o[0])).join('')}</div>
        <div class="qz-col"><span class="qz-lbl">Hasta</span>${HASTA.map(o => tarjeta('qhasta', o, S.hasta === o[0], o[0] === 'retira' && S.desde !== 'fab_ret')).join('')}</div>
      </div>`;
    $('qz-paso1').querySelectorAll('[data-qdesde]').forEach(b => b.addEventListener('click', () => {
      S.desde = b.dataset.qdesde;
      if (S.desde !== 'fab_ret' && S.hasta === 'retira') S.hasta = 'despacho';
      cambioFlujo();
    }));
    $('qz-paso1').querySelectorAll('[data-qhasta]').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; S.hasta = b.dataset.qhasta; cambioFlujo(); }));
  }
  function cambioFlujo() { S.guardadaFirma = null; pintarPaso1(); pintarPaso2(); recalcular(); }

  // ── Paso 2 ──────────────────────────────────────────────────────────────
  const itemsCentros = grupos.map(g => ({ value: g.grupo, label: g.nombre + (g.grupo === HUB_GRUPO ? ' (Quilicura)' : ''), sub: '' }));
  const itemsComunas = comunas.map(c => ({ value: c.nombre, label: c.nombre, sub: `${nomG(c.cds[0].grupo)} · ${fmt(c.cds[0].km)} km` }));
  function ayudaComuna(nombre) {
    if (!nombre) return '';
    const c = ctx.comunas.get(normComuna(nombre));
    if (!c || !c.cds.length) return '<span style="color:#b5000b">Comuna sin ruta regional asignada</span>';
    return `Atiende <b>${esc(nomG(c.cds[0].grupo))}</b> · ${fmt(c.cds[0].km)} km${c.cds.length > 1 ? ` · también ${esc(c.cds.slice(1, 3).map(x => nomG(x.grupo)).join(', '))}` : ''}`;
  }
  function pintarPaso2() {
    const def = FLUJOS[flujoActual()];
    const falta = faltantes();
    const mal = k => S.tocado && falta.some(x => x.k === k && !x.ok);
    const centroLbl = g => itemsCentros.find(i => i.value === g)?.label || '';
    $('qz-paso2').innerHTML = `<div class="qz-step-h"><div><span class="qz-num">2</span>Origen, destino y kilos</div></div>
      <div class="qz-cols">
        <div class="qz-field ${mal('origen') ? 'is-bad' : ''}" data-f="origen">
          <span class="qz-lbl">${def.origen === 'COMUNA' ? 'Comuna de retiro' : 'Centro de origen'} <i>*</i></span>
          ${def.origen === 'COMUNA' ? comboHtml('qz-comuna-retiro', 'Escribe la comuna de la fábrica', S.comunaRetiro) : comboHtml('qz-cd-origen', 'Selecciona un centro…', centroLbl(S.cdOrigen))}
          <small id="qz-help-o">${def.origen === 'COMUNA' ? (ayudaComuna(S.comunaRetiro) || 'El centro de retiro se asigna solo') : 'Centro desde donde sale la carga'}</small>
        </div>
        <div class="qz-field ${mal('destino') ? 'is-bad' : ''}" data-f="destino">
          <span class="qz-lbl">${def.destino === 'CENTRO' ? 'Centro donde retira el cliente' : 'Comuna de entrega'} <i>*</i></span>
          ${def.destino === 'CENTRO' ? comboHtml('qz-cd-destino', 'Selecciona un centro…', centroLbl(S.cdDestino)) : comboHtml('qz-comuna-despacho', 'Escribe la comuna de entrega', S.comunaDespacho)}
          <small id="qz-help-d">${def.destino === 'CENTRO' ? 'El cliente pasa a buscar al centro' : (ayudaComuna(S.comunaDespacho) || 'El centro de última milla se asigna solo')}</small>
        </div>
      </div>
      <div class="qz-field ${mal('kilos') ? 'is-bad' : ''}" data-f="kilos">
        <span class="qz-lbl">Kilos a cotizar <i>*</i></span>
        <div class="qz-kilos">${numIn('qz-kilos', S.kilos, { unit: 'kg', w: '170px', placeholder: 'Ej: 3.500', label: 'Kilos a cotizar' })}
          ${KILOS_RAPIDOS.map(k => `<button class="sv-chip ${Number(S.kilos) === k ? 'is-on' : ''}" data-chip data-qkg="${k}">${fmt(k)} kg</button>`).join('')}</div>
        <div id="qz-escala"></div>
      </div>`;
    const w = $('qz-paso2');
    const cb = (id, items, fn) => { const el = w.querySelector(`[data-combo="${id}"]`); if (el) initCombo(el, items, fn); };
    cb('qz-cd-origen', itemsCentros, (it) => { S.cdOrigen = it.value; recalcular(); });
    cb('qz-cd-destino', itemsCentros, (it) => { S.cdDestino = it.value; recalcular(); });
    cb('qz-comuna-retiro', itemsComunas, (it) => { S.comunaRetiro = it.label; w.querySelector('#qz-help-o').innerHTML = ayudaComuna(S.comunaRetiro) || 'El centro de retiro se asigna solo'; recalcular(); });
    cb('qz-comuna-despacho', itemsComunas, (it) => { S.comunaDespacho = it.label; w.querySelector('#qz-help-d').innerHTML = ayudaComuna(S.comunaDespacho) || 'El centro de última milla se asigna solo'; recalcular(); });
    wireNumIns(w, (k, v) => { S.kilos = v || ''; pintarEscala(); recalcularDiferido(); });
    w.querySelectorAll('[data-qkg]').forEach(b => b.addEventListener('click', () => { S.kilos = Number(b.dataset.qkg); pintarPaso2(); recalcular(); }));
    pintarEscala();
  }
  function pintarEscala() {
    const kg = Number(S.kilos) || 0;
    const tipo = kg ? camionPorKilos(Math.min(kg, 28000)) : null;
    const cap = ESCALA.find(e => e[0] === tipo)?.[1] || 28000;
    const txt = !kg ? 'Ingresa los kilos y se asigna el camión.'
      : kg > 28000 ? `Supera un camión de 28 t: sobre 28 t se cobra con el $/kg del camión de 28 Ton (${Math.ceil(kg / 28000)} camiones en tramos exclusivos)`
      : `${tipo} · ocupa ${fmt(kg / cap * 100)}% de su capacidad`;
    const el = $('qz-escala');
    if (!el) return;
    el.innerHTML = `<div class="qz-truck ${kg > 28000 ? 'is-over' : ''}"><span class="material-symbols-outlined">local_shipping</span>${esc(txt)}</div>
      <div class="qz-scale">${ESCALA.map(([t, c, l]) => { const on = t === tipo, pas = tipo && c < cap; return `<div class="${on ? 'is-on' : pas ? 'is-past' : ''}" title="Hasta ${fmt(c)} kg"><i></i><span>${l}</span></div>`; }).join('')}</div>`;
    container.querySelectorAll('[data-qkg]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.qkg) === kg));
  }

  // ── Cálculo (Consolidado y Exclusivo a la vez) ──────────────────────────
  function leerInput(servicio) {
    const f = flujoActual(), def = FLUJOS[f];
    return {
      flujo: f, tipoNegocio: def.tipo, servicio,
      cdOrigen: def.origen === 'CENTRO' ? S.cdOrigen : '',
      comunaRetiro: def.origen === 'COMUNA' ? String(S.comunaRetiro || '').trim() : '',
      cdDestino: def.destino === 'CENTRO' ? S.cdDestino : '',
      comunaDespacho: def.destino === 'COMUNA' ? String(S.comunaDespacho || '').trim() : '',
      kilos: Number(S.kilos) || 0,
      retira: def.destino === 'CENTRO' ? 'CD' : 'NO',
    };
  }
  function faltantes() {
    const def = FLUJOS[flujoActual()];
    const out = [];
    if (def.origen === 'COMUNA') out.push({ k: 'origen', lbl: 'Comuna de retiro', ok: !!S.comunaRetiro && !!ctx.comunas.get(normComuna(S.comunaRetiro)) });
    else out.push({ k: 'origen', lbl: 'Centro de origen', ok: !!S.cdOrigen });
    if (def.destino === 'CENTRO') out.push({ k: 'destino', lbl: 'Centro donde retira el cliente', ok: !!S.cdDestino });
    else out.push({ k: 'destino', lbl: 'Comuna de entrega', ok: !!S.comunaDespacho && !!ctx.comunas.get(normComuna(S.comunaDespacho)) });
    out.push({ k: 'kilos', lbl: 'Kilos a cotizar', ok: Number(S.kilos) > 0 });
    return out.filter(x => !x.ok).length ? out : [];
  }
  let kmToken = 0, tDif = null;
  const recalcularDiferido = () => { clearTimeout(tDif); tDif = setTimeout(recalcular, 200); };
  function recalcular() {
    S.copiado = false;
    const base = leerInput('consolidado');
    // Regla A: distancia directa retiro → despacho cuando ambas comunas comparten un centro Regional
    let kmInfo = null;
    if (base.flujo === 'EBE-RET/EBE-DESP' && base.comunaRetiro && base.comunaDespacho) {
      const cdsRet = cdsDeComuna(ctx, base.comunaRetiro);
      const comparten = cdsDeComuna(ctx, base.comunaDespacho).some(g => cdsRet.includes(g));
      const a = ctx.comunas.get(normComuna(base.comunaRetiro)), b = ctx.comunas.get(normComuna(base.comunaDespacho));
      if (comparten && a?.lat != null && b?.lat != null) {
        const key = `${a.lat},${a.lon}|${b.lat},${b.lon}`;
        if (_kmCache.has(key)) kmInfo = _kmCache.get(key);
        else { const token = ++kmToken; kmCarretera(a, b).then(() => { if (token === kmToken) recalcular(); }); }
      }
    }
    const correr = servicio => {
      const inp = { ...base, servicio };
      if (kmInfo) inp.kmDirecto = kmInfo.km;
      const r = cotizar(ctx, inp);
      if (kmInfo?.estimado && r.ok) r.avisos.push(`Distancia directa estimada en línea recta × 1,3 (${fmt(kmInfo.km, 1)} km): no se pudo consultar la ruta por carretera.`);
      return r;
    };
    R.cons = correr('consolidado');
    R.excl = correr('exclusivo');
    R.input = base;
    R.kmInfo = kmInfo;
    const falta = faltantes();
    container.querySelectorAll('.qz-field[data-f]').forEach(el => el.classList.toggle('is-bad', S.tocado && falta.some(x => x.k === el.dataset.f && !x.ok)));
    pintarPaso3();
    pintarResultado();
  }
  function servicioSel() {
    if (S.servicio) return S.servicio;
    if (R.cons?.ok && R.excl?.ok) return R.cons.total <= R.excl.total ? 'consolidado' : 'exclusivo';
    return R.excl?.ok && !R.cons?.ok ? 'exclusivo' : 'consolidado';
  }

  // ── Paso 3 ──────────────────────────────────────────────────────────────
  function pintarPaso3() {
    const sel = servicioSel();
    const kg = Number(S.kilos) || 0;
    const mejor = R.cons?.ok && R.excl?.ok ? (R.cons.total <= R.excl.total ? 'consolidado' : 'exclusivo') : null;
    const card = (k, lbl, sub, r) => `<button class="qz-svc ${sel === k ? 'is-on' : ''}" data-chip data-qsvc="${k}">
      ${mejor === k ? '<span class="qz-best">Menor costo</span>' : ''}
      <b>${lbl}</b><small>${sub}</small>
      <strong>${r?.ok ? clp(r.total) : '—'}</strong><em>${r?.ok && kg ? clp(r.total / kg) + ' por kg' : 'completa los datos'}</em></button>`;
    $('qz-paso3').innerHTML = `<div class="qz-step-h"><div><span class="qz-num">3</span>Tipo de servicio</div><span class="sv-muted" style="font-size:12px">Se calculan los dos; elige cuál cotizar al cliente</span></div>
      <div class="qz-cols">${card('consolidado', 'Consolidado', 'Comparte camión, paga por kilos', R.cons)}${card('exclusivo', 'Exclusivo', 'Camión dedicado · Tarifa Express', R.excl)}</div>`;
    $('qz-paso3').querySelectorAll('[data-qsvc]').forEach(b => b.addEventListener('click', () => { S.servicio = b.dataset.qsvc; S.guardadaFirma = null; pintarPaso3(); pintarResultado(); }));
  }

  // ── Resultado ───────────────────────────────────────────────────────────
  function pasos(input, res) {
    const out = [];
    const nodo = (tag, label, icon, color = '#191c1d') => out.push({ nodo: true, tag, label, icon, color });
    const clienteRetira = input.retira === 'CD';
    if (input.comunaRetiro) nodo('Retiro en fábrica', input.comunaRetiro, 'factory', COL.retiro);
    else nodo(input.flujo === 'EBE-DESP' ? 'Stock en centro' : 'Fábrica entrega en centro', nomG(res.cdOrigen || input.cdOrigen), 'warehouse');
    const hayT2 = res.tramos.some(t => t.key === 'troncal2');
    res.tramos.forEach(t => {
      const tipo = tipoTramo(t.key);
      out.push({ tramo: true, tipo, label: t.label, monto: t.monto, det: [t.camion, t.ruta, t.regla].filter(Boolean).join(' · ') });
      if (t.key === 'retiro') nodo('Centro de origen', nomG(res.cdOrigen), 'warehouse');
      else if (t.key === 'troncal1') { if (hayT2) nodo('Hub', 'CD Quilicura', 'hub'); else nodo(clienteRetira ? 'Cliente retira en' : 'Centro destino', nomG(res.cdDestino), clienteRetira ? 'person_pin_circle' : 'store', clienteRetira ? COL.ultima : '#191c1d'); }
      else if (t.key === 'troncal2') nodo(clienteRetira ? 'Cliente retira en' : 'Centro destino', nomG(res.cdDestino), clienteRetira ? 'person_pin_circle' : 'store', clienteRetira ? COL.ultima : '#191c1d');
      else if (t.key === 'ultima' && !clienteRetira) nodo('Entrega', input.comunaDespacho, 'local_shipping', COL.ultima);
      else if (t.key === 'ultima' && clienteRetira && res.cdOrigen === res.cdDestino) nodo('Cliente retira en', nomG(res.cdDestino), 'person_pin_circle', COL.ultima);
      else if (['directo', 'directo_camion', 'exclusivo'].includes(t.key)) nodo(clienteRetira ? 'Cliente retira en' : 'Entrega', clienteRetira ? nomG(res.cdDestino) : input.comunaDespacho, clienteRetira ? 'person_pin_circle' : 'local_shipping', COL.ultima);
    });
    if (res.tramos.some(t => t.key === 'troncal_ruta')) nodo('Entrega en ruta', input.comunaDespacho, 'local_shipping', COL.ultima);
    return out;
  }
  function firma(input, servicio) { return [input.flujo, servicio, input.cdOrigen, input.comunaRetiro, input.cdDestino, input.comunaDespacho, input.kilos].join('|'); }
  function pintarResultado() {
    const sel = servicioSel();
    const res = sel === 'exclusivo' ? R.excl : R.cons;
    const otro = sel === 'exclusivo' ? R.cons : R.excl;
    const input = { ...R.input, servicio: sel };
    const kg = input.kilos;
    const falta = faltantes();
    let cuerpo;
    if (falta.length || !res?.ok) {
      cuerpo = falta.length
        ? `<div class="qz-missing"><span>Para cotizar falta:</span>${falta.map(f => `<div class="${f.ok ? 'is-ok' : ''}"><span class="material-symbols-outlined">${f.ok ? 'check_circle' : 'radio_button_unchecked'}</span>${esc(f.lbl)}</div>`).join('')}</div>`
        : `<div class="qz-alert is-bad"><span class="material-symbols-outlined">error</span><span>${esc(res?.error || 'No se pudo cotizar.')}</span></div>`;
    } else {
      const alertas = [];
      (res.alertas || []).forEach(a => alertas.push(['bad', 'warning', a]));
      if (otro?.ok && otro.total < res.total) alertas.push(['info', 'savings', `${sel === 'exclusivo' ? 'Consolidado' : 'Exclusivo'} cuesta ${clp(res.total - otro.total)} menos (${clp(otro.total)}).`]);
      if (kg > 28000) alertas.push(['warn', 'scale', 'Sobre 28.000 kg: se cotiza con el $/kg del camión de 28 Ton.']);
      (res.avisos || []).forEach(a => alertas.push(['warn', 'info', a]));
      const guardada = S.guardadaFirma === firma(input, sel);
      cuerpo = `<div class="qz-ruta">${esc(res.ruta || '')}</div>
        <div class="qz-steps">${pasos(input, res).map(p => p.nodo
          ? `<div class="qz-node"><span style="background:${p.color}"><span class="material-symbols-outlined">${p.icon}</span></span><div><small>${esc(p.tag)}</small><b>${esc(p.label || '—')}</b></div></div>`
          : `<div class="qz-leg"><div class="qz-leg-l"><i style="background:${COL[p.tipo]}"></i></div><div class="qz-leg-b"><div><b>${esc(p.label)}</b><strong>${clp(p.monto)}</strong></div><small>${esc(p.det)}</small></div></div>`).join('')}</div>
        ${alertas.length ? `<div class="qz-alerts">${alertas.map(([t, ic, x]) => `<div class="qz-alert is-${t}"><span class="material-symbols-outlined">${ic}</span><span>${esc(x)}</span></div>`).join('')}</div>` : ''}
        <div class="qz-acts">
          <button class="sv-btn-p" id="qz-save" ${guardada ? 'disabled' : ''}><span class="material-symbols-outlined">${guardada ? 'check' : 'bookmark_add'}</span>${guardada ? 'Cotización guardada' : 'Guardar cotización'}</button>
          <button class="sv-btn" data-chip id="qz-copy" title="Copiar resumen para enviar al cliente"><span class="material-symbols-outlined">${S.copiado ? 'check' : 'content_copy'}</span>${S.copiado ? 'Copiado' : 'Copiar'}</button>
        </div>`;
    }
    const ok = !falta.length && res?.ok;
    $('qz-res').innerHTML = `<div class="sv-card qz-res-card">
      <div class="qz-res-h"><div><small>Precio al cliente · ${sel === 'exclusivo' ? 'Exclusivo' : 'Consolidado'}</small>
        <strong class="${ok ? '' : 'is-empty'}">${ok ? clp(res.total) : '$0'}</strong>
        <span>${ok ? `${clp(res.total / kg)} por kg · ${fmt(kg)} kg` : 'Completa los datos para cotizar'}</span></div>
        <span class="qz-id">ID ${esc(S.quoteId)}</span></div>
      ${cuerpo}
      <div class="qz-foot">Valor neto · IVA no incluido · el tipo de camión se asigna por tramo según los kilos</div>
    </div>`;
    $('qz-save')?.addEventListener('click', () => guardar(input, res, sel));
    $('qz-copy')?.addEventListener('click', () => copiar(input, res, sel));
    pintarMapa(input, ok ? res : null);
  }

  // ── Guardar / copiar / historial ────────────────────────────────────────
  function textos(input) {
    const origen = input.comunaRetiro || nomG(input.cdOrigen);
    const destino = input.retira === 'CD' ? `Retira ${nomG(input.cdDestino)}` : input.comunaDespacho;
    return { origen, destino };
  }
  function guardar(input, res, sel) {
    const { origen, destino } = textos(input);
    const ok = saveRecentQuote({
      firma: firma(input, sel), id: S.quoteId,
      fecha: new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }),
      negocio: input.tipoNegocio, flujo: input.flujo, servicio: sel === 'exclusivo' ? 'Exclusivo' : 'Consolidado',
      origen, destino, kilos: input.kilos, monto: res.total,
      input: { flujo: input.flujo, servicio: sel, cdOrigen: input.cdOrigen, comunaRetiro: input.comunaRetiro, cdDestino: input.cdDestino, comunaDespacho: input.comunaDespacho, kilos: input.kilos },
    });
    if (!ok) { showAlert('No se pudo guardar la cotización en este navegador.', 'error'); return; }
    S.guardadaFirma = firma(input, sel);
    showAlert('Cotización guardada en «Mis cotizaciones recientes».', 'success');
    pintarResultado();
    pintarHistorial();
  }
  async function copiar(input, res, sel) {
    const { origen, destino } = textos(input);
    const lineas = [
      `Cotización EBEMA ${S.quoteId}`,
      `${input.flujo} · ${sel === 'exclusivo' ? 'Exclusivo' : 'Consolidado'}`,
      `${origen} → ${destino} · ${fmt(input.kilos)} kg`,
      '',
      ...res.tramos.filter(t => t.monto !== 0 || t.key === 'ultima').map(t => `• ${t.label}: ${clp(t.monto)}`),
      '',
      `Total: ${clp(res.total)} + IVA (${clp(res.total / input.kilos)} por kg)`,
      'Valor neto, IVA no incluido.',
    ];
    try { await navigator.clipboard.writeText(lineas.join('\n')); S.copiado = true; }
    catch (e) { showAlert('No se pudo copiar al portapapeles.', 'error'); }
    pintarResultado();
  }
  function pintarHistorial() {
    const list = loadRecentQuotes();
    $('qz-hist').innerHTML = `<div class="tf-tabletitle"><div><h3>Mis cotizaciones recientes</h3><small>${fmt(list.length)} guardadas · últimas ${RECENT_QUOTES_MAX}</small></div></div>
      <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:820px">
        <thead><tr><th>Fecha</th><th>Flujo · servicio</th><th>Origen → destino</th><th class="r">Kilos</th><th class="r">Monto neto</th><th></th></tr></thead>
        <tbody>${list.length ? list.map((q, i) => `<tr style="cursor:default"><td class="sv-mono">${esc(q.fecha)}</td>
          <td><span class="qz-flujo ${q.negocio === 'CALZADA' ? 'is-calzada' : ''}">${esc(q.flujo || q.negocio || '')}</span> ${esc(q.servicio || '')}</td>
          <td>${esc(q.origen)} → ${esc(q.destino)}</td><td class="r">${fmt(q.kilos)}</td><td class="r"><b>${clp(q.monto)}</b></td>
          <td style="text-align:right">${q.input ? `<button class="sv-btn" data-chip data-qreuse="${i}"><span class="material-symbols-outlined">replay</span>Reusar</button>` : '<span class="sv-muted" style="font-size:12px">sin datos para reusar</span>'}</td></tr>`).join('')
          : '<tr class="sv-empty"><td colspan="6">Aún no guardas cotizaciones. Usa «Guardar cotización» en el resultado.</td></tr>'}</tbody>
      </table></div>`;
    $('qz-hist').querySelectorAll('[data-qreuse]').forEach(b => b.addEventListener('click', () => {
      const q = list[Number(b.dataset.qreuse)]?.input;
      if (!q) return;
      const [d, h] = DESDE_HASTA[q.flujo] || ['stock', 'despacho'];
      Object.assign(S, { desde: d, hasta: h, cdOrigen: q.cdOrigen || HUB_GRUPO, comunaRetiro: q.comunaRetiro || '', cdDestino: q.cdDestino || '', comunaDespacho: q.comunaDespacho || '', kilos: q.kilos || '', servicio: q.servicio || null, quoteId: nuevoId(), guardadaFirma: null });
      pintarPaso1(); pintarPaso2(); recalcular();
      container.querySelector('.sv-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // ── Panel OWNER: tarifas de retiro troncal (Regla B) ────────────────────
  function pintarAdmin() {
    const box = $('qz-admin');
    if (!admin) { box.innerHTML = ''; return; }
    const lista = [...new Set([...Object.keys(RETIRO_TRONCAL_DEFAULT), ...grupos.map(g => g.grupo)])];
    const guard = getRetiroTroncalTarifas(ccfg);
    box.innerHTML = `<div class="sv-dr-bg" id="qz-admin-bg"></div>
      <aside class="sv-dr" role="dialog" aria-label="Tarifas de retiro troncal">
        <div class="sv-dr-h"><div><div class="sv-dr-k">Sólo perfil OWNER</div><div class="sv-dr-t" style="font-family:inherit">Tarifas de retiro troncal (Regla B)</div></div>
          <button class="sv-iconbtn" data-chip id="qz-admin-x" title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b">
          <div class="sv-dr-note">Monto fijo cuando el camión troncal del centro de destino recoge la carga en una comuna de la RM con ruta de retiro menor a 35 km. El cotizador lo compara con la primera milla local y aplica el menor. En 0 se desactiva.</div>
          <table class="sv-table"><tbody>${lista.map(g => `<tr style="cursor:default"><td><span class="sv-b">${esc(nomG(g))}</span><div class="sv-sub">${esc(g)}</div></td>
            <td class="r">${numIn('rt|' + g, admin[g] ?? 0, { pre: '$', w: '130px', changed: Number(admin[g] || 0) !== Number(guard[g] || 0), label: 'Retiro troncal ' + nomG(g) })}</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="sv-dr-f"><button class="sv-btn" data-chip id="qz-admin-c">Cancelar</button><button class="sv-btn-p" id="qz-admin-s"><span class="material-symbols-outlined">save</span>Guardar tarifas</button></div>
      </aside>`;
    const cerrar = () => { admin = null; pintarAdmin(); };
    $('qz-admin-bg').addEventListener('click', cerrar);
    $('qz-admin-x').addEventListener('click', cerrar);
    $('qz-admin-c').addEventListener('click', cerrar);
    wireNumIns(box, (k, v) => { admin[k.slice(3)] = Math.max(0, Math.round(v)); });
    $('qz-admin-s').addEventListener('click', () => {
      ccfg.retiroTroncal = { ...admin };
      saveDatabase(db, { syncOnly: ['clientTariffConfig'] });
      showAlert('Tarifas de retiro troncal guardadas.', 'success');
      admin = null; pintarAdmin(); recalcular();
    });
  }
  $('qz-admin-open')?.addEventListener('click', () => { admin = { ...getRetiroTroncalTarifas(ccfg) }; pintarAdmin(); });
  $('qz-reset').addEventListener('click', () => {
    Object.assign(S, { desde: 'stock', hasta: 'despacho', cdOrigen: HUB_GRUPO, comunaRetiro: '', cdDestino: '', comunaDespacho: '', kilos: '', servicio: null, quoteId: nuevoId(), guardadaFirma: null, tocado: false });
    pintarPaso1(); pintarPaso2(); recalcular();
  });

  // ── Mapa (Leaflet + OSRM) ───────────────────────────────────────────────
  let fleetMap = null, capa = null, ultimoMapa = null, mapaToken = 0, L = null;
  loadLeaflet().then(Lf => {
    L = Lf;
    if (!document.getElementById('quote-fleet-map')) return;
    fleetMap = L.map('quote-fleet-map').setView([-36.5, -71.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Rutas: OSRM' }).addTo(fleetMap);
    capa = L.layerGroup().addTo(fleetMap);
    const leyenda = L.control({ position: 'bottomleft' });
    leyenda.onAdd = () => {
      const d = L.DomUtil.create('div');
      d.style.cssText = 'background:rgba(255,255,255,.92);padding:6px 8px;border-radius:6px;font:11px "Hanken Grotesk",Arial;line-height:16px;box-shadow:0 1px 4px rgba(0,0,0,.2)';
      d.innerHTML = LEYENDA.map(([k, l]) => `<div><span style="display:inline-block;width:18px;height:4px;background:${COL[k]};vertical-align:middle;margin-right:6px;border-radius:2px"></span>${l}</div>`).join('');
      return d;
    };
    leyenda.addTo(fleetMap);
    if (ultimoMapa) pintarMapa(ultimoMapa.input, ultimoMapa.res);
  }).catch(err => {
    console.error('Error al cargar Leaflet:', err);
    const m = document.getElementById('quote-fleet-map');
    if (m) m.innerHTML = '<div class="qz-map-empty">Mapa no disponible.</div>';
  });
  async function pintarMapa(input, res) {
    ultimoMapa = { input, res };
    if (!fleetMap || !capa) return;
    const token = ++mapaToken;
    capa.clearLayers();
    if (!res || !res.ok) return;
    const cRet = ctx.comunas.get(normComuna(input.comunaRetiro));
    const cDes = ctx.comunas.get(normComuna(input.comunaDespacho));
    const gO = ctx.grupoInfo.get(res.cdOrigen), gD = ctx.grupoInfo.get(res.cdDestino), hub = ctx.grupoInfo.get(HUB_GRUPO);
    const P = (o, nombre, tipo) => (o && o.lat != null && o.lon != null) ? { ll: [Number(o.lat), Number(o.lon)], nombre, tipo } : null;
    const pRet = P(cRet, `Retiro: ${cRet?.nombre || ''}`, 'retiro');
    const pO = P(gO, `CD ${gO?.cdNombre || ''}`, 'cd');
    const pH = P(hub, 'Hub Quilicura', 'cd');
    const pD = P(gD, `CD ${gD?.cdNombre || ''}`, 'cd');
    const pDes = P(cDes, `Entrega: ${cDes?.nombre || ''}`, 'despacho');
    const seg = [];
    res.tramos.forEach(t => {
      if (t.key === 'retiro') seg.push([pRet, pO, 'retiro', t]);
      else if (t.key === 'troncal1') seg.push([pO, res.tramos.some(x => x.key === 'troncal2') ? pH : pD, 'troncal', t]);
      else if (t.key === 'troncal2') seg.push([pH, pD, 'troncal', t]);
      else if (t.key === 'troncal_ruta') seg.push([pO, pDes, 'troncal', t]);
      else if (t.key === 'ultima' && input.retira !== 'CD') seg.push([pD, pDes, 'ultima', t]);
      else if (['directo', 'directo_camion', 'exclusivo'].includes(t.key)) seg.push([input.comunaRetiro ? pRet : pO, input.retira === 'CD' ? pD : pDes, 'directo', t]);
    });
    const validos = seg.filter(([a, b]) => a && b && (a.ll[0] !== b.ll[0] || a.ll[1] !== b.ll[1]));
    const paradas = [];
    validos.forEach(([a, b]) => { [a, b].forEach(p => { if (!paradas.some(x => x.nombre === p.nombre)) paradas.push(p); }); });
    if (!paradas.length) [pRet, pO, pDes].filter(Boolean).forEach(p => paradas.push(p));
    const bounds = [];
    paradas.forEach((p, i) => {
      const color = p.tipo === 'retiro' ? COL.retiro : p.tipo === 'despacho' ? COL.ultima : '#191c1d';
      L.marker(p.ll, { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12],
        html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font:bold 12px Arial;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>` }) })
        .addTo(capa).bindTooltip(`${i + 1}. ${esc(p.nombre)}`, { direction: 'top', offset: [0, -10] });
      bounds.push(p.ll);
    });
    if (bounds.length > 1) fleetMap.fitBounds(bounds, { padding: [40, 40] });
    else if (bounds.length === 1) fleetMap.setView(bounds[0], 10);
    const lineas = validos.map(([a, b, tipo, t]) => L.polyline([a.ll, b.ll], { color: COL[tipo], weight: 3, dashArray: '6 6', opacity: 0.8 })
      .addTo(capa).bindTooltip(`${esc(t.label)} · ${clp(t.monto)}`, { sticky: true }));
    const geos = await Promise.all(validos.map(([a, b]) => geometriaRuta(a.ll, b.ll)));
    if (token !== mapaToken) return;
    geos.forEach((g, i) => {
      if (!g) return;
      const [, , tipo, t] = validos[i];
      capa.removeLayer(lineas[i]);
      L.polyline(g, { color: COL[tipo], weight: 5, opacity: 0.85 }).addTo(capa).bindTooltip(`${esc(t.label)} · ${clp(t.monto)}`, { sticky: true });
      g.forEach(ll => bounds.push(ll));
    });
    if (bounds.length > 1) fleetMap.fitBounds(bounds, { padding: [30, 30] });
  }

  // Marca los campos faltantes cuando el usuario ya empezó a completar
  container.addEventListener('focusout', () => { if (!S.tocado) { S.tocado = true; } }, { once: true });

  pintarPaso1();
  pintarPaso2();
  recalcular();
  pintarHistorial();
}
