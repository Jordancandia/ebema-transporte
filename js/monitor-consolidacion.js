// ============================================================================
// TORRE DE CONTROL › MONITOR DE PEDIDOS (18-nov-2026, Jordan)
// (antes Distribución › Monitor de Consolidación, 9-nov-2026)
// ----------------------------------------------------------------------------
// Monitor de pedidos de venta de sucursal (despacho / retiro) y su estado.
// NO consolida camiones: se eliminó todo lo relativo a tipo de camión / capacidad.
//
// Condiciones de expedición visibles (cada una con color + icono en el mapa):
//   · EBE-DESP              EBEMA despacha
//   · EBE-RET / EBE-DESP    EBEMA retira – EBEMA despacha
//   · EBE-RET / CLI-RET     EBEMA retira – Cliente retira
//   · FAB-DESP / EBE-DESP   Fábrica despacha – EBEMA despacha
//
// Fuentes (Supabase):
//   · trc_live 'pedidos_ventas_sucursal'  ← Pedidos_Ventas_Sucursal.csv (Drive)
//   · trc_live 'entregas_periodo'          ← Entregas_Periodo.csv (entregas en tratamiento ZE*)
//   · routes / logistics_centres           ← coordenadas de ruta (comuna) y del centro
//   · maestro_productos                    ← prioridad de pesos
//   · maestro_obras                        ← georreferencia (auto OSM / manual) y contacto de la obra (18-nov-2026)
//
// (18-nov-2026) Flete express = pedido spot (rayo + alerta, primero en la lista). Detalle con fechas, repartos,
// entregas y flete: traslado (ZFLT), última milla (ZFL0/ZFL1) y sugerido por posición:
//   $/kg < mínimo → mínimo · $/kg > máximo → máximo · entre ambos → $/kg (máximo 0 = sin tope); total = Σ posiciones.
//
// Estado del pedido (sobre posiciones con pendiente, sin MR 60/70/CR que se ocultan):
//   · bloq    Bloqueado      todas las posiciones pendientes bloqueadas
//   · sin     Sin entrega    ninguna posición con entrega creada
//   · parcial Entrega parcial alguna posición con entrega, no todas cubiertas
//   · lista   Con entrega    todas las posiciones libres cubiertas por entregas
//   Marcas: vencido (F. entrega < hoy), bloqueo parcial, unidades sin confirmar.
// ============================================================================
import { supabase } from './supabase-client.js?v=202611231252';
import { getDatabase, loadRoutesData, HIST_ALIAS_PREFIJO } from './data.js?v=202611231252';
import { loadLeaflet } from './utils.js';
import { filtrarPorCentro, can } from './permisos.js?v=202611231252';
import { cargarObras, abrirEditorObra, tieneUbicacion, geoDe, badgeGeo } from './maestro-obras.js?v=202611231252';

const CFG = {
  tiles: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  kgUnitSospechoso: 5000,
};
const LS_SUC = 'sit_cc_sucursal';

// Condiciones de expedición del monitor (orden = orden de despliegue)
const CONDS = [
  { key: 'EBE-DESP',            label: 'EBEMA Despacha',                    corto: 'EBEMA despacha',          color: '#2563eb', bg: '#dbeafe', ink: '#1e40af', icon: 'local_shipping' },
  { key: 'EBE-RET / EBE-DESP',  label: 'EBEMA Retira – EBEMA Despacha',     corto: 'Retira EBEMA › despacha', color: '#0d9488', bg: '#ccfbf1', ink: '#115e59', icon: 'sync_alt' },
  { key: 'EBE-RET / CLI-RET',   label: 'EBEMA Retira – Cliente Retira',     corto: 'Retira EBEMA › cliente',  color: '#ea580c', bg: '#ffedd5', ink: '#9a3412', icon: 'storefront' },
  { key: 'FAB-DESP / EBE-DESP', label: 'Fábrica Despacha – EBEMA Despacha', corto: 'Fábrica › EBEMA despacha', color: '#7c3aed', bg: '#ede9fe', ink: '#5b21b6', icon: 'factory' },
];
const normCond = s => String(s || '').toUpperCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
const COND = new Map(CONDS.map(c => [c.key, c]));

const ESTADOS = [
  { key: 'sin',     label: 'Sin entrega',     icon: 'schedule',     color: '#6b7280', bg: '#f3f4f6', ink: '#374151' },
  { key: 'parcial', label: 'Entrega parcial', icon: 'incomplete_circle', color: '#f59e0b', bg: '#fef3c7', ink: '#92400e' },
  { key: 'lista',   label: 'Con entrega',     icon: 'task_alt',     color: '#16a34a', bg: '#dcfce7', ink: '#166534' },
  { key: 'bloq',    label: 'Bloqueado',       icon: 'block',        color: '#dc2626', bg: '#fee2e2', ink: '#991b1b' },
];
const EST = new Map(ESTADOS.map(e => [e.key, e]));
const MR_OCULTO = /^(60|70|CR)\b/i;   // rechazo del cliente → se oculta (10-nov-2026)

/* ════════════════════════════════════════════════════════════════════════
   ESTADO
   ════════════════════════════════════════════════════════════════════════ */
const S = {
  raw: null, sucursal: '', centro: null,
  pedidos: [], byId: new Map(),
  cond: new Set(CONDS.map(c => c.key)),
  fEstado: 'todos', soloVencidos: false, soloExpress: false, soloSinGeo: false, q: '',
  sel: null, editGeo: false,
  orden: { col: 'prio', dir: 1 },
};
let root = null, map = null, capaPedidos = null, capaTmp = null, hubMarker = null;
const marcadores = new Map(), firmas = new Map(), tmpMarkers = new Map();

/* ════════════════════════════════════════════════════════════════════════
   UTILIDADES
   ════════════════════════════════════════════════════════════════════════ */
const $ = s => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const s = String(v ?? '').trim(); if (!s) return 0; const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s; const x = parseFloat(t); return Number.isFinite(x) ? x : 0; };
const z = v => String(v ?? '').trim().replace(/^0+(?=\d)/, '');
const fT = (n, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const fP = n => `${Math.round((Number.isFinite(n) ? n : 0) * 100)}%`;
const fechaKey = s => { const m = String(s || '').match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const fechaTxt = k => k ? `${k.slice(8, 10)}-${k.slice(5, 7)}-${k.slice(0, 4)}` : '—';
const hoyKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const diasHasta = k => { if (!k) return null; const a = new Date(k + 'T00:00:00'), b = new Date(hoyKey() + 'T00:00:00'); return Math.round((a - b) / 86400000); };
const tieneGeo = p => Number.isFinite(p.latitud) && Number.isFinite(p.longitud);
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const ms = (ic, extra = '') => `<span class="material-symbols-outlined"${extra}>${ic}</span>`;
const fCLP = n => '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('es-CL');
const RAYO = '<span class="cc-rayo" title="Flete express · pedido spot">' + '<span class="material-symbols-outlined">bolt</span></span>';

/**
 * Flete sugerido por posición (18-nov-2026, Jordan):
 *   $ por kilo < mínimo → mínimo · $ por kilo > máximo → máximo · entre ambos → $ por kilo.
 *   Máximo = 0 se toma como "sin tope" (no lleva el sugerido a 0).
 */
function fleteSugerido(min, max, pk) {
  if (pk < min) return min;
  if (max > 0 && pk > max) return max;
  return pk;
}

async function leerPaginado(fn) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await fn().range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   CARGA DE DATOS
   ════════════════════════════════════════════════════════════════════════ */
async function cargarFuentes() {
  await loadRoutesData();
  const [suc, ent] = await Promise.all([
    leerPaginado(() => supabase.from('trc_live').select('data,cargado_en').eq('fuente', 'pedidos_ventas_sucursal').order('fila')),
    leerPaginado(() => supabase.from('trc_live').select('data').eq('fuente', 'entregas_periodo').order('fila')),
  ]);
  // Sólo las 4 condiciones del monitor
  const filas = suc.map(r => r.data).filter(d => COND.has(normCond(d?.cond_expedicion)));
  const mats = [...new Set(filas.map(d => z(d.material)).filter(Boolean))];
  const maestro = new Map();
  for (let i = 0; i < mats.length; i += 300) {
    const { data, error } = await supabase.from('maestro_productos').select('id_material,peso_bruto').in('id_material', mats.slice(i, i + 300));
    if (error) break;
    (data || []).forEach(m => { if (+m.peso_bruto > 0) maestro.set(z(m.id_material), +m.peso_bruto); });
  }
  const cargado = suc.reduce((m, r) => (r.cargado_en && r.cargado_en > m ? r.cargado_en : m), '');
  // (18-nov-2026) Maestro de obras: georreferencia y contacto
  let geo = new Map(), geoOk = true;
  try { geo = await cargarObras(filas.map(d => d.id_obra)); } catch (_e) { geoOk = false; }
  S.raw = { suc: filtrarPorCentro(filas, r => z(r.ofvta)), ent: ent.map(r => r.data), geo, geoOk, maestro, cargado };
}

function indiceRutas() {
  const db = getDatabase();
  const idx = new Map();
  (db.routes || []).forEach(r => { if (r.codigo) idx.set(String(r.codigo).trim().toUpperCase(), r); });
  return code => {
    const c = String(code || '').trim().toUpperCase(); if (!c) return null;
    let r = idx.get(c);
    if (!r) { const al = HIST_ALIAS_PREFIJO[c.slice(0, 3)]; if (al) r = idx.get(al + c.slice(3)); }
    return r || null;
  };
}

function construirPedidos(sucursal) {
  const { suc, ent, geo, maestro } = S.raw;
  const rutaDe = indiceRutas();
  const entPos = new Map();
  ent.forEach(d => {
    if (!/^ZE/i.test(String(d.tipo_entrega || ''))) return;
    const k = z(d.documento_precedente_doc_modelo) + '|' + z(d.posicion_modelo);
    const e = entPos.get(k) || { cant: 0, entregas: new Set() };
    e.cant += num(d.cantidad_entregada); e.entregas.add(z(d.entrega));
    entPos.set(k, e);
  });
  const peds = new Map();
  suc.forEach(d => {
    if (z(d.ofvta) !== sucursal) return;
    const doc = z(d.doc_ventas); if (!doc) return;
    const mr = String(d.motivo_rechazo || d.mr || '').trim();
    if (MR_OCULTO.test(mr)) return;               // posición rechazada por el cliente: no se muestra
    let p = peds.get(doc);
    if (!p) {
      const ruta = rutaDe(d.ruta);
      const comunaDesc = String(d.ruta_desc || '').split('/').slice(1).join('/').trim();
      p = {
        id_pedido: doc, id_obra: z(d.id_obra), cliente: String(d.nombre_cliente || '').trim(), solic: z(d.solic),
        cond: normCond(d.cond_expedicion), clase: d.clvt || '',
        rutaCodigo: ruta ? String(ruta.codigo).toUpperCase() : String(d.ruta || '').trim().toUpperCase(), rutaDesc: d.ruta_desc || '',
        comuna: (ruta && ruta.comuna) || comunaDesc || (d.ruta ? String(d.ruta) : 'Sin ruta'),
        direccion: String(d.direccion_obra || '').trim(), interlocutor: d.interlocutor || '', creado: fechaKey(d.creado_el),
        latitud: null, longitud: null, geoExacta: false, _rutaObj: ruta, posiciones: [],
      };
      peds.set(doc, p);
    }
    const cant = num(d.cantidad_de_pedido), pend = num(d.pendiente_entrega), kgPos = num(d.peso_bruto);
    const um = String(d.um || '').trim().toUpperCase(), mat = z(d.material);
    const kgUnit = um === 'KG' ? 1 : (maestro.get(mat) || (cant > 0 ? kgPos / cant : 0));
    const bloqTxt = [mr, d.dcto_vendedor].map(x => String(x || '').trim()).filter(Boolean).join(' / ');
    const bloq = String(d.bloqueada || '').trim().toUpperCase() === 'X' || !!bloqTxt;
    const posK = z(d.pos);
    const rep = { reparto: z(d.reparto) || '—', fecha: fechaKey(d.fe_entrega), confirmada: num(d.reparto_confirmado || d.ctd_confirmada), pendiente: pend, entregado: num(d.cantidad_entrg) };
    // (18-nov-2026) Una posición puede venir en varias filas (repartos SAP): se agrupa por posición.
    let x = p.posiciones.find(q => q.pos === posK);
    if (!x) {
      const e = entPos.get(doc + '|' + posK);
      x = {
        pos: posK, sku: mat, descripcion: d.denominacion_de_posicion || '', um, cantidad: cant, confirmada: 0,
        entregado: 0, pendiente: 0, kgUnit: kgUnit > CFG.kgUnitSospechoso ? 0 : kgUnit,
        bloqueo: bloq ? (bloqTxt || 'X') : null, fecha: '', repartos: [],
        entTrat: e ? e.cant : 0, entregas: e ? [...e.entregas] : [],
        // Fletes (vienen repetidos en cada reparto: se toman una vez por posición)
        fleteTraslado: num(d.flete_zflt), fleteUltMilla: num(d.flete_zfl0_zfl1),
        fleteMin: num(d.flete_minimo), fleteMax: num(d.flete_maximo), fletePk: num(d.flete_peso_kilo),
        express: String(d.flete_express || '').trim().toUpperCase() === 'X',
      };
      x.fleteSug = fleteSugerido(x.fleteMin, x.fleteMax, x.fletePk);
      p.posiciones.push(x);
    }
    x.repartos.push(rep);
    x.confirmada += rep.confirmada; x.entregado += rep.entregado; x.pendiente += rep.pendiente;
    if (pend > 0 && rep.fecha && (!x.fecha || rep.fecha < x.fecha)) x.fecha = rep.fecha;
    if (!x.fecha && rep.fecha) x.fecha = rep.fecha;
  });
  const lista = [...peds.values()].filter(p => p.posiciones.some(x => x.pendiente > 0));
  lista.forEach(p => {
    const g = geo.get(p.id_obra);
    p.obra = g || null;
    if (tieneUbicacion(g)) { p.latitud = +g.lat; p.longitud = +g.lon; p.geoExacta = true; }
    else if (p._rutaObj && Number.isFinite(+p._rutaObj.lat) && Number.isFinite(+p._rutaObj.lon) && +p._rutaObj.lat !== 0) {
      const h = hash(p.id_pedido), ang = (h % 360) * Math.PI / 180, rad = 0.0012 + ((h >>> 9) % 100) / 100 * 0.0045;
      p.latitud = +p._rutaObj.lat + rad * Math.sin(ang); p.longitud = +p._rutaObj.lon + rad * 1.2 * Math.cos(ang);
    }
    evaluar(p);
  });
  return lista;
}

/* ════════════════════════════════════════════════════════════════════════
   ESTADO DEL PEDIDO
   ════════════════════════════════════════════════════════════════════════ */
function evaluar(p) {
  const act = p.posiciones.filter(x => x.pendiente > 0);
  const lib = act.filter(x => !x.bloqueo), bloq = act.filter(x => x.bloqueo);
  const cubierta = x => x.entTrat + 1e-6 >= x.pendiente;
  const conEnt = lib.filter(x => x.entTrat > 0);
  const kgP = lib.reduce((a, x) => a + x.pendiente * x.kgUnit, 0);
  const kgOk = lib.reduce((a, x) => a + Math.min(x.entTrat, x.pendiente) * x.kgUnit, 0);
  p._ton = kgP / 1000;
  p._avance = !lib.length ? 0 : kgP > 0 ? kgOk / kgP : lib.filter(cubierta).length / lib.length;
  p._nPos = act.length; p._nLib = lib.length; p._nBloq = bloq.length; p._nCub = lib.filter(cubierta).length;
  p._entregas = [...new Set(lib.flatMap(x => x.entregas))];
  p._estado = !lib.length ? 'bloq' : lib.every(cubierta) ? 'lista' : (conEnt.length || lib.some(x => x.entregado > 0)) ? 'parcial' : 'sin';
  const fechas = (lib.length ? lib : act).map(x => x.fecha).filter(Boolean).sort();
  p.fecha = fechas[0] || '';
  p._dias = diasHasta(p.fecha);
  p._vencido = p._estado !== 'lista' && p._dias !== null && p._dias < 0;
  const marcas = [];
  if (p._vencido) marcas.push({ t: 'rd', txt: `Vencido ${-p._dias} d` });
  if (p._estado !== 'bloq' && bloq.length) marcas.push({ t: 'am', txt: `Bloqueo parcial · ${bloq.length} pos.` });
  if (lib.some(x => x.confirmada + 1e-6 < x.cantidad)) marcas.push({ t: 'am', txt: 'Unidades sin confirmar' });
  p._sinGeo = !p.geoExacta;
  if (p._sinGeo) marcas.push({ t: 'rd', txt: p.obra && p.obra.geo_estado === 'PENDIENTE' ? 'Georref. pendiente' : 'Falta georreferencia' });
  else if (p.obra && p.obra.geo_estado === 'AUTO_CALLE') marcas.push({ t: 'am', txt: 'Ubicación calle (aprox.)' });
  p._marcas = marcas;
  p.codigo_bloqueo = [...new Set(bloq.map(x => x.bloqueo))].join(', ');
  // Flete express (pedido spot): alguna posición con X → se ve con rayo y va primero
  p._express = p.posiciones.some(x => x.express);
  if (p._express) marcas.unshift({ t: 'xp', txt: 'Express · spot' });
  // Fletes del pedido: todas las posiciones visibles (incluye bloqueo MR 79 por liberar; 60/70/CR ya se ocultaron)
  const fl = p.posiciones;
  const s = k => fl.reduce((a, x) => a + (x[k] || 0), 0);
  p._flete = { min: s('fleteMin'), max: s('fleteMax'), pk: s('fletePk'), sug: s('fleteSug'), traslado: s('fleteTraslado'), ultMilla: s('fleteUltMilla') };
  p._flete.cobrado = p._flete.traslado + p._flete.ultMilla;
  // Prioridad de atención: express, bloqueado, vencido, sin entrega, parcial
  p._prio = (p._express ? 0 : 1) * 1e8 + (p._estado === 'bloq' ? 0 : p._vencido ? 1 : p._estado === 'sin' ? 2 : p._estado === 'parcial' ? 3 : 4) * 1e6 + (p._dias ?? 9999);
}

const visible = p => S.cond.has(p.cond) && (S.fEstado === 'todos' || p._estado === S.fEstado) && (!S.soloVencidos || p._vencido) && (!S.soloExpress || p._express) && (!S.soloSinGeo || p._sinGeo);
function coincide(p) {
  const q = S.q.trim().toLowerCase();
  return !q || [p.id_pedido, p.id_obra, p.cliente, p.comuna, p.direccion, p.rutaCodigo, ...p._entregas].some(x => String(x || '').toLowerCase().includes(q));
}
const filtrados = () => S.pedidos.filter(p => visible(p) && coincide(p));

function setSucursal(suc) {
  S.sucursal = suc;
  try { localStorage.setItem(LS_SUC, suc); } catch (_e) { /* */ }
  const db = getDatabase();
  const lc = (db.logisticsCentres || []).find(c => String(c.id) === suc);
  S.centro = { id: suc, nombre: lc ? lc.nombre : `Centro ${suc}`, lat: lc ? +lc.lat : -33.45, lon: lc ? +lc.lon : -70.66 };
  S.pedidos = construirPedidos(suc);
  S.byId = new Map(S.pedidos.map(p => [p.id_pedido, p]));
  S.sel = null;
  reiniciarMapa();
  renderSucursales(); renderTodo(true);
  const nx = S.pedidos.filter(p => p._express && S.cond.has(p.cond)).length;
  if (nx) toast('xp', `${nx} pedido${nx > 1 ? 's' : ''} express (spot) en ${S.centro.nombre}`, 'Flete express: revisar y coordinar a la brevedad. Filtre con la tarjeta Express.');
}

/* ════════════════════════════════════════════════════════════════════════
   MAPA
   ════════════════════════════════════════════════════════════════════════ */
function crearMapa() {
  map = L.map($('#cc-map'), { zoomControl: true }).setView([S.centro.lat, S.centro.lon], 11);
  L.tileLayer(CFG.tiles, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  capaPedidos = L.layerGroup().addTo(map);
  capaTmp = L.layerGroup().addTo(map);
}
function reiniciarMapa() {
  if (!map) crearMapa();
  capaPedidos.clearLayers(); capaTmp.clearLayers(); marcadores.clear(); firmas.clear(); tmpMarkers.clear();
  if (hubMarker) hubMarker.remove();
  hubMarker = L.marker([S.centro.lat, S.centro.lon], {
    icon: L.divIcon({ className: 'cc-pin-wrap', html: `<div class="cc-hub">${ms('warehouse')}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 2000, keyboard: false,
  }).addTo(map).bindTooltip(`<div class="cc-tt-h">${esc(S.centro.nombre)}</div><div class="cc-tt-r">Centro ${esc(S.centro.id)}</div>`, { className: 'cc-tt', direction: 'top', offset: [0, -16] });
  if (S.editGeo) { S.editGeo = false; $('#cc-btn-geo').classList.remove('is-on'); }
  setTimeout(() => { map.invalidateSize(); ajustarVista(); }, 0);
}
function ajustarVista() {
  const pts = filtrados().filter(tieneGeo).map(p => [p.latitud, p.longitud]);
  pts.push([S.centro.lat, S.centro.lon]);
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 }); else map.setView(pts[0], 11);
}
function iconoPedido(p) {
  const c = COND.get(p.cond), e = EST.get(p._estado), sel = S.sel === p.id_pedido;
  const cls = `cc-pin${sel ? ' sel' : ''}${p.geoExacta ? '' : ' aprox nogeo'}${S.editGeo && !p.geoExacta ? ' drag' : ''}${p._vencido ? ' venc' : ''}${p._express ? ' xp' : ''}`;
  const html = `<div class="${cls}" style="--pc:${c.color}" data-id="${esc(p.id_pedido)}">${ms(c.icon)}<i class="cc-pin-st" style="background:${e.color}" title="${esc(e.label)}"></i>${p._express ? `<b class="cc-pin-xp">${ms('bolt')}</b>` : ''}${p._sinGeo ? `<b class="cc-pin-ng" title="Falta georreferencia">${ms('question_mark')}</b>` : ''}</div>`;
  return { firma: html, icon: L.divIcon({ className: 'cc-pin-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }) };
}
function tooltipPedido(p) {
  const c = COND.get(p.cond), e = EST.get(p._estado);
  return `<div class="cc-tt-h"><span class="cc-ci" style="background:${c.color}">${ms(c.icon)}</span><span class="mono">${esc(p.id_pedido)}</span>${p._express ? RAYO : ''}<span class="cc-est-pill" style="background:${e.bg};color:${e.ink}">${esc(e.label)}</span></div>
    <div class="cc-tt-r"><b>${esc(p.cliente)}</b><br>${esc(c.label)}<br>${esc(p.direccion || '—')} · ${esc(p.comuna)}<br>F. entrega <b>${fechaTxt(p.fecha)}</b> · ${p._nCub}/${p._nLib} pos. con entrega · ${fT(p._ton, 1)} t</div>
    ${p._marcas.length ? `<div class="cc-tt-r" style="margin-top:3px">${p._marcas.map(m => `<span class="cc-tag ${m.t}">${esc(m.txt)}</span>`).join(' ')}</div>` : ''}
    <div class="cc-tt-f">${S.editGeo && !p.geoExacta ? 'Arrastre al punto de la obra y guarde' : 'Clic para ver el detalle'}</div>`;
}
function renderMarcadores() {
  const vis = new Set(filtrados().map(p => p.id_pedido));
  S.pedidos.forEach(p => {
    const id = p.id_pedido;
    let mk = marcadores.get(id);
    if (!tieneGeo(p)) { if (mk) { capaPedidos.removeLayer(mk); marcadores.delete(id); firmas.delete(id); } return; }
    const { firma, icon } = iconoPedido(p);
    if (!mk) {
      mk = L.marker([p.latitud, p.longitud], { icon, riseOnHover: true, draggable: false });
      mk.on('click', () => { if (S.editGeo && !p.geoExacta) { mk.openPopup(); return; } seleccionar(id, { desdeMapa: true }); abrirDetalle(id); });
      mk.on('mouseover', () => hlFila(id, true));
      mk.on('mouseout', () => hlFila(id, false));
      mk.on('dragend', () => { mk._movido = true; mk.openPopup(); });
      mk.bindTooltip(() => tooltipPedido(p), { className: 'cc-tt', direction: 'top', offset: [0, -14] });
      marcadores.set(id, mk); firmas.set(id, firma);
    } else if (firmas.get(id) !== firma) { mk.setIcon(icon); firmas.set(id, firma); }
    const arr = S.editGeo && !p.geoExacta;
    if (arr && !mk.getPopup()) mk.bindPopup(() => popupGeo(p, mk), { minWidth: 240 });
    if (!arr && mk.getPopup()) mk.unbindPopup();
    if (mk.dragging) { if (arr) mk.dragging.enable(); else mk.dragging.disable(); }
    mk.setZIndexOffset(S.sel === id ? 1500 : p._express ? 900 : p._estado === 'bloq' || p._vencido ? 300 : 0);
    const v = vis.has(id);
    if (v && !capaPedidos.hasLayer(mk)) capaPedidos.addLayer(mk);
    if (!v && capaPedidos.hasLayer(mk)) capaPedidos.removeLayer(mk);
  });
}
function pinDe(id) { const mk = marcadores.get(id); return mk && mk.getElement() ? mk.getElement().querySelector('.cc-pin') : null; }
function hlPin(id, on) { const el = pinDe(id); if (el) el.classList.toggle('hl', on); }
function hlFila(id, on) { root.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => { if (!el.classList.contains('cc-pin')) el.classList.toggle('is-hl', on); }); }
function seleccionar(id, { desdeMapa = false, sinScroll = false } = {}) {
  S.sel = id;
  renderMarcadores(); renderLista(); renderTabla();
  if (!S.sel) return;
  const p = S.byId.get(id);
  if (!desdeMapa && tieneGeo(p)) {
    map.setView([p.latitud, p.longitud], Math.max(map.getZoom(), 14));
    setTimeout(() => { const mk = marcadores.get(id); if (mk) mk.openTooltip(); }, 260);
  }
  if (sinScroll) return;
  const tr = root.querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const li = root.querySelector(`.cc-li[data-id="${CSS.escape(id)}"]`); if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ── Georreferenciación de obras (obras_georef) ── */
const obrasPendientes = () => { const m = new Map(); filtrados().forEach(p => { if (!p.geoExacta && p.id_obra && !m.has(p.id_obra)) m.set(p.id_obra, p); }); return [...m.values()]; };
async function guardarCoordenadasObra(idObra, lat, lng) {
  const payload = { lat: +(+lat).toFixed(6), lon: +(+lng).toFixed(6), geo_estado: 'MANUAL', geo_detalle: 'Ubicada a mano en el Monitor de Pedidos' };
  const { data, error } = await supabase.from('maestro_obras').update(payload).eq('id_obra', idObra).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('La obra aún no está en el maestro (se sincroniza cada 10 min) o su perfil no puede editarla.');
  return data;
}
/** Aplica una obra guardada (editor o arrastre) a todos los pedidos que la usan. */
function aplicarObra(o) {
  if (!o) return;
  S.raw.geo.set(z(o.id_obra), o);
  S.pedidos.forEach(x => {
    if (x.id_obra !== z(o.id_obra)) return;
    x.obra = o;
    if (tieneUbicacion(o)) { x.latitud = +o.lat; x.longitud = +o.lon; x.geoExacta = true; }
    evaluar(x);
    const m2 = marcadores.get(x.id_pedido); if (m2 && tieneGeo(x)) m2.setLatLng([x.latitud, x.longitud]);
  });
  renderTodo();
}
async function editarObra(p) {
  const o = await abrirEditorObra(p.id_obra, {
    base: { direccion: p.direccion, comuna: p.comuna, nombre_cliente: p.cliente, id_cliente: p.solic, ruta: p.rutaCodigo },
    centro: tieneGeo(p) ? { lat: p.latitud, lon: p.longitud } : { lat: S.centro.lat, lon: S.centro.lon },
  });
  if (o) { aplicarObra(o); toast('ok', `Obra ${o.id_obra} guardada`, tieneUbicacion(o) ? 'Los pedidos de esta obra (actuales y futuros) toman esta ubicación.' : 'Datos de contacto guardados.'); }
  return o;
}
function activarEdicion(on) {
  if (on && !S.raw.geoOk) { toast('err', 'Georreferenciación no disponible', 'No se pudo leer el maestro de obras.'); return; }
  if (on && !can('editar')) { toast('warn', 'Sin permiso de edición', 'Su perfil no puede guardar coordenadas de obra.'); return; }
  S.editGeo = on;
  $('#cc-btn-geo').classList.toggle('is-on', on);
  capaTmp.clearLayers(); tmpMarkers.clear();
  if (!on) S.pedidos.forEach(p => { const mk = marcadores.get(p.id_pedido); if (mk && tieneGeo(p)) { mk._movido = false; mk.closePopup(); mk.setLatLng([p.latitud, p.longitud]); } });
  if (on) {
    obrasPendientes().filter(p => !tieneGeo(p)).forEach((p, i) => {
      const mk = L.marker([S.centro.lat + .012 * Math.cos(i * 0.9), S.centro.lon + .015 * Math.sin(i * 0.9)], {
        draggable: true, autoPan: true, zIndexOffset: 3000,
        icon: L.divIcon({ className: 'cc-pin-wrap', html: `<div class="cc-pin edit">${ms('location_on')}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      });
      mk.bindPopup(() => popupGeo(p, mk), { minWidth: 240 });
      mk.on('dragend', () => { mk._movido = true; mk.openPopup(); });
      mk.addTo(capaTmp); tmpMarkers.set(p.id_obra, mk);
    });
  }
  hint(); renderMarcadores();
}
function popupGeo(p, mk) {
  const ped = S.pedidos.filter(x => x.id_obra === p.id_obra).map(x => x.id_pedido);
  const { lat, lng } = mk.getLatLng();
  const d = document.createElement('div');
  d.className = 'cc-geo-pop';
  d.innerHTML = `<div><b>Obra ${esc(p.id_obra)}</b> <span class="cc-tag am">${tieneGeo(p) ? 'Ubicación aprox.' : 'Sin ubicación'}</span></div>
    <div style="font-size:12px;color:#5c5f61">${esc(p.cliente)}<br>${esc(p.direccion || '—')}<br>${esc(p.comuna)} · pedidos <span class="mono">${ped.map(esc).join(', ')}</span></div>
    <div class="mono">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
    <div style="font-size:11.5px;color:#5c5f61">${mk._movido ? 'Verifique el punto y guarde.' : 'Arrastre el marcador al acceso de la obra.'}</div>`;
  const b = document.createElement('button');
  b.className = 'cc-btn pri sm'; b.innerHTML = `${ms('save')}Guardar coordenadas`;
  b.disabled = !mk._movido;
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Guardando…';
    const pos = mk.getLatLng();
    try {
      const r = await guardarCoordenadasObra(p.id_obra, pos.lat, pos.lng);
      aplicarObra(r);
      if (tmpMarkers.has(p.id_obra)) { capaTmp.removeLayer(tmpMarkers.get(p.id_obra)); tmpMarkers.delete(p.id_obra); }
      ped.forEach(id => { const m2 = marcadores.get(id); if (m2) { m2.closePopup(); m2.setLatLng([r.lat, r.lon]); } });
      mk.closePopup();
      toast('ok', `Obra ${p.id_obra} georreferenciada`, `${ped.length} pedido${ped.length > 1 ? 's' : ''} con ubicación exacta.`);
      renderTodo();
    } catch (err) {
      b.disabled = false; b.innerHTML = `${ms('save')}Reintentar`;
      toast('err', 'No se pudo guardar', err.message || String(err));
    }
  };
  d.appendChild(b);
  return d;
}
function hint() {
  const h = $('#cc-maphint');
  if (S.editGeo) { h.innerHTML = `${ms('edit_location_alt')}Modo edición: arrastre los pines de borde punteado (${obrasPendientes().length} obras) y guarde`; h.classList.add('show'); }
  else h.classList.remove('show');
}

/* ════════════════════════════════════════════════════════════════════════
   RENDER UI
   ════════════════════════════════════════════════════════════════════════ */
function renderSucursales() {
  const db = getDatabase();
  const sucs = [...new Set(S.raw.suc.map(d => z(d.ofvta)).filter(Boolean))].sort();
  $('#cc-suc').innerHTML = sucs.map(s => {
    const lc = (db.logisticsCentres || []).find(c => String(c.id) === s);
    return `<option value="${esc(s)}"${s === S.sucursal ? ' selected' : ''}>${esc(s)} · ${esc(lc ? lc.nombre : '')}</option>`;
  }).join('');
  $('#cc-centro-lbl').textContent = `Torre de Control · ${S.centro.nombre}`;
}
/** KPIs por estado (sobre las condiciones activas y la búsqueda). Clic = filtro. */
function renderKpis() {
  const base = S.pedidos.filter(p => S.cond.has(p.cond) && coincide(p));
  const n = k => base.filter(p => p._estado === k).length;
  const venc = base.filter(p => p._vencido).length;
  const tarj = [
    { k: 'todos', label: 'Pedidos', icon: 'receipt_long', v: base.length, color: '#191c1d', sub: `${fT(base.reduce((a, p) => a + p._ton, 0), 1)} t pendientes` },
    ...ESTADOS.map(e => ({ k: e.key, label: e.label, icon: e.icon, v: n(e.key), color: e.color, sub: base.length ? fP(n(e.key) / base.length) : '0%' })),
  ];
  $('#cc-kpis').innerHTML = tarj.map(t => `<button class="cc-kpi${S.fEstado === t.k ? ' is-on' : ''}" data-est="${t.k}" style="--kc:${t.color}">
      <span class="cc-kpi-ic">${ms(t.icon)}</span><span class="cc-kpi-b"><span class="cc-kpi-l">${esc(t.label)}</span><b class="num">${t.v}</b><span class="cc-kpi-s">${esc(t.sub)}</span></span></button>`).join('') +
    `<button class="cc-kpi xp${S.soloExpress ? ' is-on' : ''}${base.some(p => p._express) ? ' alerta' : ''}" data-xp="1" style="--kc:#ca8a04"><span class="cc-kpi-ic">${ms('bolt')}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Express (spot)</span><b class="num">${base.filter(p => p._express).length}</b><span class="cc-kpi-s">Atender a la brevedad</span></span></button>` +
    `<button class="cc-kpi ng${S.soloSinGeo ? ' is-on' : ''}" data-ng="1" style="--kc:#7c2d12"><span class="cc-kpi-ic">${ms('wrong_location')}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Sin georreferencia</span><b class="num">${base.filter(p => p._sinGeo).length}</b><span class="cc-kpi-s">Ubicar obra</span></span></button>` +
    `<button class="cc-kpi venc${S.soloVencidos ? ' is-on' : ''}" data-venc="1" style="--kc:#b91c1c"><span class="cc-kpi-ic">${ms('event_busy')}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Vencidos</span><b class="num">${venc}</b><span class="cc-kpi-s">F. entrega &lt; hoy</span></span></button>`;
}
function renderCond() {
  const base = S.pedidos.filter(coincide);
  $('#cc-cond').innerHTML = CONDS.map(c => {
    const n = base.filter(p => p.cond === c.key).length;
    return `<button class="cc-cchip${S.cond.has(c.key) ? ' is-on' : ''}" data-cond="${esc(c.key)}" style="--cc:${c.color};--cb:${c.bg};--ci:${c.ink}" title="${esc(c.key)}">
      <span class="cc-ci" style="background:${c.color}">${ms(c.icon)}</span>${esc(c.label)}<span class="cc-cnt">${n}</span></button>`;
  }).join('');
  $('#cc-legend').innerHTML = CONDS.map(c => `<div><span class="cc-ci sm" style="background:${c.color}">${ms(c.icon)}</span>${esc(c.corto)}</div>`).join('') +
    '<div class="cc-legend-sep"></div>' + ESTADOS.map(e => `<div><i style="background:${e.color}"></i>${esc(e.label)}</div>`).join('') +
    '<div><i class="dash"></i>Ubicación aprox. (ruta)</div>';
}
/** Panel lateral: matriz condición × estado + lista de pedidos priorizada. */
function renderLista() {
  let h = '';
  const lista = filtrados().sort((a, b) => a._prio - b._prio).slice(0, 150);
  h += `<div class="cc-sec-t"><span>Pedidos por atender</span><span>${filtrados().length}</span></div>`;
  if (!lista.length) h += `<div class="cc-empty">${ms('inbox')}Sin pedidos para los filtros actuales.</div>`;
  h += lista.map(p => {
    const c = COND.get(p.cond), e = EST.get(p._estado);
    const f = p._dias === null ? 'Sin fecha' : p._dias < 0 ? `Vencido hace ${-p._dias} d` : p._dias === 0 ? 'Entrega hoy' : p._dias === 1 ? 'Entrega mañana' : `En ${p._dias} días`;
    return `<div class="cc-li${S.sel === p.id_pedido ? ' is-sel' : ''}${p._express ? ' xp' : ''}" data-id="${esc(p.id_pedido)}">
      <span class="cc-ci" style="background:${c.color}">${ms(c.icon)}</span>
      <div style="min-width:0"><div class="cc-li-id">${esc(p.id_pedido)}${p._express ? RAYO : ''}${p._sinGeo ? '<span class="cc-ng" title="Falta georreferencia de la obra">' + ms('wrong_location') + '</span>' : ''}<span class="cc-est-pill" style="background:${e.bg};color:${e.ink}">${esc(e.label)}</span></div>
      <div class="cc-li-sub">${esc(p.cliente)} · ${esc(p.comuna)}</div>
      <div class="cc-li-f"><span class="${p._vencido ? 'cc-venc' : ''}">${ms('event')}${f}</span><span class="cc-mini"><i style="width:${p._avance * 100}%;background:${e.color}"></i></span><span class="mono">${p._nCub}/${p._nLib}</span></div></div>
      <span class="cc-x">${ms('chevron_right')}</span></div>`;
  }).join('');
  $('#cc-pane').innerHTML = h;
}
function filasTabla() {
  const rows = filtrados();
  const key = {
    prio: p => p._prio, estado: p => ESTADOS.findIndex(e => e.key === p._estado), id: p => p.id_pedido, cond: p => CONDS.findIndex(c => c.key === p.cond),
    cliente: p => p.cliente, comuna: p => p.comuna, fecha: p => p.fecha || '9999', creado: p => p.creado || '9999', flete: p => p._flete.sug, avance: p => p._avance, ton: p => p._ton,
  }[S.orden.col];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * S.orden.dir || a.id_pedido.localeCompare(b.id_pedido); });
  return rows;
}
function renderTabla() {
  const rows = filasTabla();
  $('#cc-tbody').innerHTML = rows.map(p => {
    const c = COND.get(p.cond), e = EST.get(p._estado), id = p.id_pedido;
    return `<tr data-id="${esc(id)}" class="${S.sel === id ? 'is-sel' : ''}${p._express ? ' xp' : ''}">
      <td><span class="cc-est-pill" style="background:${e.bg};color:${e.ink}">${ms(e.icon)}${esc(e.label)}</span></td>
      <td class="mono"><b>${esc(id)}</b>${p._express ? RAYO : ''}</td>
      <td><span class="cc-cond" style="background:${c.bg};color:${c.ink}"><span class="cc-ci xs" style="background:${c.color}">${ms(c.icon)}</span>${esc(c.label)}</span></td>
      <td class="cc-td-cli" title="${esc(p.cliente)}">${esc(p.cliente)}</td>
      <td class="mono">${esc(p.id_obra)}</td>
      <td>${esc(p.comuna)}</td>
      <td class="mono">${fechaTxt(p.creado)}</td>
      <td class="mono${p._vencido ? ' cc-venc' : ''}">${fechaTxt(p.fecha)}</td>
      <td class="r mono">${p._flete.sug ? fCLP(p._flete.sug) : '—'}</td>
      <td><span class="cc-av"><span class="cc-mini"><i style="width:${p._avance * 100}%;background:${e.color}"></i></span><span class="mono">${p._nCub}/${p._nLib} pos.</span></span></td>
      <td class="mono">${p._entregas.length ? esc(p._entregas.slice(0, 2).join(', ')) + (p._entregas.length > 2 ? ` +${p._entregas.length - 2}` : '') : '—'}</td>
      <td class="r mono">${fT(p._ton, 2)}</td>
      <td>${p._marcas.map(m => `<span class="cc-tag ${m.t}">${esc(m.txt)}</span>`).join(' ')}${p._estado === 'bloq' ? ` <span class="cc-tag rd">${esc(p.codigo_bloqueo)}</span>` : ''}</td>
      <td><div class="cc-acts">
        <button class="cc-ib" data-act="ver" title="${tieneGeo(p) ? 'Ver en mapa' : 'Sin ubicación'}" ${tieneGeo(p) ? '' : 'disabled'}>${ms('my_location')}</button>
        <button class="cc-ib" data-act="detalle" title="Detalle de posiciones y entregas">${ms('fact_check')}</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="14" style="text-align:center;color:var(--cc-ink2);padding:24px">Sin pedidos para los filtros actuales.</td></tr>';
  $('#cc-tbar-s').textContent = `${rows.length} de ${S.pedidos.length} pedidos · ${fT(rows.reduce((a, p) => a + p._ton, 0), 1)} t pendientes`;
  root.querySelectorAll('.cc-t th.sort').forEach(th => {
    th.querySelector('.material-symbols-outlined')?.remove();
    if (th.dataset.col === S.orden.col) th.insertAdjacentHTML('beforeend', ms(S.orden.dir > 0 ? 'arrow_upward' : 'arrow_downward'));
  });
  $('#cc-geo-cnt').textContent = obrasPendientes().length;
}
function renderTodo(encuadrar = false) {
  renderKpis(); renderCond(); renderMarcadores(); renderLista(); renderTabla(); hint();
  if (encuadrar && map) ajustarVista();
}
function abrirDetalle(id) {
  const p = S.byId.get(id), c = COND.get(p.cond), e = EST.get(p._estado), hoy = hoyKey(), F = p._flete;
  const posOrd = [...p.posiciones].sort((a, b) => a.pos.localeCompare(b.pos, 'es', { numeric: true }));
  const sinDatoFlete = !posOrd.some(x => x.fleteMin || x.fleteMax || x.fletePk);
  // ── Productos (posición) con repartos, entrega y flete sugerido
  const filas = posOrd.map(x => {
    const st = x.bloqueo ? 'Bloqueada' : x.pendiente <= 0 ? 'Entregada' : x.entTrat + 1e-6 >= x.pendiente ? 'Con entrega' : x.entTrat > 0 ? 'Entrega parcial' : 'Sin entrega';
    const regla = x.fletePk < x.fleteMin ? 'Mín.' : x.fleteMax > 0 && x.fletePk > x.fleteMax ? 'Máx.' : '$/kg';
    const reps = x.repartos.map(r => `<span class="cc-rep${r.fecha && r.fecha < hoy && r.pendiente > 0 ? ' venc' : ''}" title="Reparto ${esc(r.reparto)} · confirmado ${fT(r.confirmada, 0)} · pendiente ${fT(r.pendiente, 0)}">${fechaTxt(r.fecha)} <small>${fT(r.confirmada, 0)}</small></span>`).join('');
    return `<tr class="${x.bloqueo ? 'blq' : st === 'Entrega parcial' ? 'bad' : ''}">
      <td class="mono">${esc(x.pos)}${x.express ? RAYO : ''}</td><td class="mono">${esc(x.sku)}</td><td class="cc-desc" title="${esc(x.descripcion)}">${esc(x.descripcion)}</td>
      <td class="r mono">${fT(x.cantidad, 0)} <small>${esc(x.um)}</small></td><td class="r mono">${fT(x.entregado, 0)}</td><td class="r mono">${fT(x.pendiente, 0)}</td>
      <td><div class="cc-reps">${reps || '—'}</div></td>
      <td class="mono">${x.entregas.length ? x.entregas.map(esc).join(', ') + ` <small>(${fT(x.entTrat, 0)})</small>` : '—'}</td>
      <td>${x.bloqueo ? `<span class="cc-tag rd">${esc(x.bloqueo)}</span>` : esc(st)}</td>
      <td class="r mono sep">${fCLP(x.fleteTraslado)}</td><td class="r mono">${fCLP(x.fleteUltMilla)}</td>
      <td class="r mono sep">${fCLP(x.fleteMin)}</td><td class="r mono">${x.fleteMax ? fCLP(x.fleteMax) : '<small>sin tope</small>'}</td><td class="r mono">${fCLP(x.fletePk)}</td>
      <td class="r mono sug"><b>${fCLP(x.fleteSug)}</b> <small class="cc-regla">${regla}</small></td></tr>`;
  }).join('');
  const dif = F.cobrado - F.sug;
  const entregas = [...new Set(p.posiciones.flatMap(x => x.entregas))];
  const fechasRep = [...new Set(p.posiciones.flatMap(x => x.repartos.map(r => r.fecha)).filter(Boolean))].sort();
  $('#cc-modal-c').innerHTML = `
    <div class="cc-modal-h${p._express ? ' xp' : ''}"><span class="cc-ci lg" style="background:${c.color}">${ms(c.icon)}</span>
      <div style="flex:1;min-width:0"><h3>Pedido ${esc(p.id_pedido)} ${p._express ? '<span class="cc-xp-badge">' + ms('bolt') + 'FLETE EXPRESS · SPOT</span>' : ''}<span class="cc-est-pill" style="background:${e.bg};color:${e.ink}">${ms(e.icon)}${esc(e.label)}</span></h3>
      <p><b>${esc(c.label)}</b> · clase ${esc(p.clase)} · sucursal ${esc(S.centro.nombre)}</p>
      ${p._marcas.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${p._marcas.map(x => `<span class="cc-tag ${x.t}">${esc(x.txt)}</span>`).join('')}</div>` : ''}</div>
      ${tieneGeo(p) ? `<button class="cc-btn sm" data-act="ver-mapa" data-id="${esc(p.id_pedido)}">${ms('my_location')}Ver en mapa</button>` : ''}
      <button class="cc-x" data-act="cerrar-modal" title="Cerrar (Esc)">${ms('close')}</button></div>
    <div class="cc-modal-b">
      <div class="cc-steps">${pasos(p)}</div>
      <div class="cc-dgrid">
        <section class="cc-dbox"><h4>${ms('person')}Cliente y destino</h4>
          <dl><dt>Cliente</dt><dd><b>${esc(p.cliente)}</b> <span class="mono">(${esc(p.solic)})</span></dd>
          <dt>Dirección</dt><dd>${esc(p.direccion || '—')}</dd>
          <dt>Comuna</dt><dd>${esc(p.comuna)} · ruta <span class="mono">${esc(p.rutaCodigo || '—')}</span></dd>
          <dt>Obra</dt><dd><span class="mono">${esc(p.id_obra)}</span> ${badgeGeo(p.obra)}</dd>
          <dt>Contacto obra</dt><dd>${p.obra && (p.obra.contacto_nombre || p.obra.contacto_telefono || p.obra.contacto_email)
            ? [p.obra.contacto_nombre, p.obra.contacto_telefono, p.obra.contacto_email].filter(Boolean).map(esc).join(' · ') : '<span class="cc-tag gy">Sin contacto</span>'}</dd>
          <dt>Vendedor</dt><dd>${esc(p.interlocutor || '—')}</dd></dl>
          <button class="cc-btn sm${p._sinGeo ? ' pri' : ''}" data-act="obra-edit" data-id="${esc(p.id_pedido)}" style="margin-top:8px">${ms(p._sinGeo ? 'edit_location_alt' : 'contact_page')}${p._sinGeo ? 'Georreferenciar obra y contacto' : 'Editar ubicación y contacto'}</button></section>
        <section class="cc-dbox"><h4>${ms('event')}Fechas y entrega</h4>
          <dl><dt>Creación pedido</dt><dd><b>${fechaTxt(p.creado)}</b>${p.creado ? ` <small>(hace ${-diasHasta(p.creado)} d)</small>` : ''}</dd>
          <dt>Próximo reparto</dt><dd class="${p._vencido ? 'cc-venc' : ''}"><b>${fechaTxt(p.fecha)}</b>${p._vencido ? ` · vencido ${-p._dias} d` : ''}</dd>
          <dt>Fechas de reparto</dt><dd>${fechasRep.map(fechaTxt).join(' · ') || '—'}</dd>
          <dt>Entrega(s) SAP</dt><dd class="mono">${entregas.length ? entregas.map(esc).join(', ') : '<span class="cc-tag gy">Sin entrega asociada</span>'}</dd>
          <dt>Avance</dt><dd>${p._nCub} de ${p._nLib} posiciones con entrega · ${fT(p._ton, 2)} t pendientes</dd></dl></section>
        <section class="cc-dbox cc-flete"><h4>${ms('payments')}Flete</h4>
          <div class="cc-fl-row"><span>Flete traslado (ZFLT)</span><b class="mono">${fCLP(F.traslado)}</b></div>
          <div class="cc-fl-row"><span>Flete última milla (ZFL0/ZFL1)</span><b class="mono">${fCLP(F.ultMilla)}</b></div>
          <div class="cc-fl-row tot"><span>Flete cobrado</span><b class="mono">${fCLP(F.cobrado)}</b></div>
          <div class="cc-fl-row sug"><span>${ms('auto_awesome')}Flete sugerido sistema</span><b class="mono">${sinDatoFlete ? '—' : fCLP(F.sug)}</b></div>
          ${sinDatoFlete ? '<p class="cc-fl-nota">Sin datos de flete mínimo / máximo / $ por kilo en la carga SAP.</p>'
            : `<div class="cc-fl-row dif ${dif < 0 ? 'neg' : 'pos'}"><span>Cobrado − sugerido</span><b class="mono">${dif < 0 ? '−' : '+'}${fCLP(Math.abs(dif))}</b></div>
          <p class="cc-fl-nota">Por posición: $/kg bajo el mínimo → mínimo; sobre el máximo → máximo; entre ambos → $/kg. Σ mín ${fCLP(F.min)} · Σ máx ${fCLP(F.max)} · Σ $/kg ${fCLP(F.pk)}</p>`}
        </section>
      </div>
      <h4 class="cc-dtit">${ms('inventory_2')}Detalle de productos <small>${posOrd.length} posiciones</small></h4>
      <div class="cc-dtab"><table><thead>
        <tr class="grp"><th colspan="9"></th><th colspan="2" class="sep">Flete cobrado</th><th colspan="4" class="sep">Flete sugerido sistema</th></tr>
        <tr><th>Pos</th><th>Material</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Entregado</th><th class="r">Pendiente</th><th>Repartos (fecha · ctd)</th><th>Entrega</th><th>Estado</th>
        <th class="r sep">Traslado</th><th class="r">Últ. milla</th><th class="r sep">Mínimo</th><th class="r">Máximo</th><th class="r">$ por kilo</th><th class="r">Sugerido</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td colspan="9"><b>Total pedido</b></td>
          <td class="r mono sep"><b>${fCLP(F.traslado)}</b></td><td class="r mono"><b>${fCLP(F.ultMilla)}</b></td>
          <td class="r mono sep"><b>${fCLP(F.min)}</b></td><td class="r mono"><b>${fCLP(F.max)}</b></td><td class="r mono"><b>${fCLP(F.pk)}</b></td><td class="r mono sug"><b>${fCLP(F.sug)}</b></td></tr></tfoot>
      </table></div>
    </div>`;
  $('#cc-modal').classList.add('show');
}
/** Línea de avance del pedido: Creado → Entrega creada → Completo. */
function pasos(p) {
  if (p._estado === 'bloq') return `<div class="cc-step on rd">${ms('receipt_long')}<span>Pedido creado</span></div><i class="cc-step-l"></i><div class="cc-step on rd">${ms('block')}<span>Bloqueado ${esc(p.codigo_bloqueo)}</span></div>`;
  const n = p._estado === 'sin' ? 1 : p._estado === 'parcial' ? 2 : 3;
  const st = [['receipt_long', 'Pedido creado'], ['inventory', p._estado === 'parcial' ? `Entrega parcial (${fP(p._avance)})` : 'Entrega creada'], ['task_alt', 'Todas las posiciones con entrega']];
  return st.map((s, i) => `<div class="cc-step${i < n ? ' on' : ''}">${ms(s[0])}<span>${esc(s[1])}</span></div>`).join('<i class="cc-step-l"></i>');
}
function toast(tipo, titulo, texto) {
  const ic = { ok: 'check_circle', err: 'error', warn: 'warning', info: 'info', xp: 'bolt' }[tipo] || 'info';
  const el = document.createElement('div');
  el.className = `cc-toast ${tipo}`;
  el.innerHTML = `${ms(ic)}<div><b>${esc(titulo)}</b>${texto ? `<p>${esc(texto)}</p>` : ''}</div><button class="cc-x" title="Cerrar">${ms('close')}</button>`;
  const cerrar = () => el.remove();
  el.querySelector('.cc-x').onclick = cerrar;
  const box = document.getElementById('cc-toasts'); if (!box) return;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(cerrar, tipo === 'xp' ? 9000 : 4800);
}

/* ════════════════════════════════════════════════════════════════════════
   EVENTOS
   ════════════════════════════════════════════════════════════════════════ */
function bindEventos() {
  $('#cc-suc').addEventListener('change', e => setSucursal(e.target.value));
  $('#cc-kpis').addEventListener('click', e => {
    const b = e.target.closest('.cc-kpi'); if (!b) return;
    if (b.dataset.venc) S.soloVencidos = !S.soloVencidos;
    else if (b.dataset.xp) S.soloExpress = !S.soloExpress;
    else if (b.dataset.ng) S.soloSinGeo = !S.soloSinGeo;
    else S.fEstado = S.fEstado === b.dataset.est ? 'todos' : b.dataset.est;
    S.sel = null; renderTodo(true);
  });
  $('#cc-cond').addEventListener('click', e => {
    const b = e.target.closest('[data-cond]'); if (!b) return;
    const k = b.dataset.cond;
    if (e.altKey || e.ctrlKey || e.metaKey) { S.cond = new Set([k]); }        // Ctrl/Alt+clic = sólo esta
    else if (S.cond.has(k)) { if (S.cond.size > 1) S.cond.delete(k); } else S.cond.add(k);
    renderTodo(true);
  });
  $('#cc-btn-todas').onclick = () => { S.cond = new Set(CONDS.map(c => c.key)); S.fEstado = 'todos'; S.soloVencidos = false; S.soloExpress = false; S.soloSinGeo = false; S.q = ''; $('#cc-q').value = ''; renderTodo(true); };
  $('#cc-btn-geo').onclick = () => activarEdicion(!S.editGeo);
  $('#cc-btn-encuadrar').onclick = () => ajustarVista();
  $('#cc-btn-panel').onclick = () => {
    const off = root.classList.toggle('sin-panel');
    $('#cc-btn-panel').innerHTML = ms(off ? 'right_panel_open' : 'right_panel_close');
    setTimeout(() => map.invalidateSize(), 220);
  };
  $('#cc-btn-full').onclick = () => {
    const on = root.classList.toggle('map-full');
    $('#cc-btn-full').innerHTML = ms(on ? 'fullscreen_exit' : 'fullscreen');
    setTimeout(() => { map.invalidateSize(); ajustarVista(); }, 120);
  };
  $('#cc-btn-reload').onclick = () => recargar();
  const pane = $('#cc-pane');
  pane.addEventListener('click', e => {
    const li = e.target.closest('.cc-li[data-id]'); if (!li) return;
    seleccionar(li.dataset.id, { sinScroll: true }); abrirDetalle(li.dataset.id);
  });
  pane.addEventListener('mouseover', e => { const li = e.target.closest('.cc-li[data-id]'); if (li) hlPin(li.dataset.id, true); });
  pane.addEventListener('mouseout', e => { const li = e.target.closest('.cc-li[data-id]'); if (li) hlPin(li.dataset.id, false); });
  const tb = $('#cc-tbody');
  tb.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'ver') { seleccionar(id); return; }
    seleccionar(id, { sinScroll: true }); abrirDetalle(id);
  });
  tb.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-id]'); if (tr) hlPin(tr.dataset.id, true); });
  tb.addEventListener('mouseout', e => { const tr = e.target.closest('tr[data-id]'); if (tr) hlPin(tr.dataset.id, false); });
  root.querySelector('.cc-t thead').addEventListener('click', e => {
    const th = e.target.closest('th.sort'); if (!th) return;
    const col = th.dataset.col;
    S.orden = { col, dir: S.orden.col === col ? -S.orden.dir : (col === 'ton' || col === 'avance' || col === 'flete' ? -1 : 1) };
    renderTabla();
  });
  let tq;
  $('#cc-q').addEventListener('input', e => { clearTimeout(tq); tq = setTimeout(() => { S.q = e.target.value; renderTodo(); }, 160); });
  $('#cc-modal').addEventListener('click', e => {
    if (e.target.id === 'cc-modal' || e.target.closest('[data-act="cerrar-modal"]')) { $('#cc-modal').classList.remove('show'); return; }
    const oe = e.target.closest('[data-act="obra-edit"]');
    if (oe) { const p = S.byId.get(oe.dataset.id); editarObra(p).then(o => { if (o) abrirDetalle(p.id_pedido); }); return; }
    const vm = e.target.closest('[data-act="ver-mapa"]');
    if (vm) { $('#cc-modal').classList.remove('show'); seleccionar(vm.dataset.id); }
  });
}
function onKey(e) {
  if (!root || !document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
  if (e.key !== 'Escape') return;
  if ($('#cc-modal').classList.contains('show')) { $('#cc-modal').classList.remove('show'); return; }
  if (root.classList.contains('map-full')) $('#cc-btn-full').click();
}

/* ════════════════════════════════════════════════════════════════════════
   VISTA
   ════════════════════════════════════════════════════════════════════════ */
function plantilla() {
  return `<div class="cc">
  <header class="cc-top">
    <div class="cc-brand">
      <div class="cc-brand-ic">${ms('cell_tower')}</div>
      <div><div class="cc-brand-t">Monitor de Pedidos</div><div class="cc-brand-s" id="cc-centro-lbl"></div></div>
    </div>
    <div class="cc-grp"><span class="cc-lbl">Sucursal (of. ventas)</span><select class="cc-select" id="cc-suc"></select></div>
    <label class="cc-search">${ms('search')}<input id="cc-q" placeholder="Pedido, cliente, obra, comuna, entrega…"></label>
    <div class="cc-chips">
      <button class="cc-chip" id="cc-btn-todas" title="Quitar todos los filtros">${ms('filter_alt_off')}Limpiar filtros</button>
      <button class="cc-chip is-tool" id="cc-btn-geo" title="Ubicar obras arrastrando su pin">${ms('edit_location_alt')}Georreferenciar <span class="cc-cnt" id="cc-geo-cnt">0</span></button>
      <button class="cc-chip" id="cc-btn-reload" title="Volver a leer los datos SAP">${ms('refresh')}Actualizar</button>
    </div>
    <div class="cc-kpis" id="cc-kpis"></div>
    <div class="cc-grp cc-grp-full"><span class="cc-lbl">Condición de expedición <span style="text-transform:none;font-weight:500;letter-spacing:0">· Ctrl+clic para ver sólo una</span></span><div class="cc-chips" id="cc-cond"></div></div>
  </header>
  <section class="cc-main">
    <div class="cc-card">
      <div class="cc-mapwrap">
        <div id="cc-map"></div>
        <div class="cc-maphint" id="cc-maphint"></div>
        <div class="cc-mapbtns">
          <button class="cc-mapbtn" id="cc-btn-encuadrar" title="Encuadrar todos los pedidos">${ms('fit_screen')}</button>
          <button class="cc-mapbtn" id="cc-btn-panel" title="Ocultar / mostrar panel lateral">${ms('right_panel_close')}</button>
          <button class="cc-mapbtn" id="cc-btn-full" title="Mapa a pantalla completa">${ms('fullscreen')}</button>
        </div>
        <div class="cc-legend" id="cc-legend"></div>
      </div>
    </div>
    <aside class="cc-card cc-side"><div class="cc-pane" id="cc-pane"></div></aside>
  </section>
  <section class="cc-card cc-tablecard">
    <div class="cc-tbar"><span class="cc-tbar-t">Pedidos</span><span class="cc-tbar-s" id="cc-tbar-s"></span></div>
    <div class="cc-tscroll"><table class="cc-t"><thead><tr>
      <th class="sort" data-col="estado">Estado</th><th class="sort" data-col="id">Pedido</th><th class="sort" data-col="cond">Condición</th>
      <th class="sort" data-col="cliente">Cliente</th><th>Obra</th><th class="sort" data-col="comuna">Comuna</th>
      <th class="sort" data-col="creado">Creado</th><th class="sort" data-col="fecha">F. reparto</th><th class="sort r" data-col="flete">Flete sug.</th><th class="sort" data-col="avance">Avance entrega</th><th>Entrega(s)</th>
      <th class="sort r" data-col="ton">Ton</th><th>Observaciones</th><th></th>
    </tr></thead><tbody id="cc-tbody"></tbody></table></div>
  </section>
  <div class="cc-modal" id="cc-modal"><div class="cc-modal-c" id="cc-modal-c"></div></div>
</div>`;
}

async function recargar() {
  const btn = $('#cc-btn-reload'); if (btn) btn.disabled = true;
  try {
    await cargarFuentes();
    const sel = S.sel;
    setSucursal(S.sucursal);
    if (sel && S.byId.has(sel)) seleccionar(sel);
    actualizadoEn();
    toast('ok', 'Datos actualizados', `${S.pedidos.length} pedidos en ${S.centro.nombre}.`);
  } catch (err) { toast('err', 'No se pudo actualizar', err.message || String(err)); }
  if (btn) btn.disabled = false;
}
function actualizadoEn() {
  const upd = document.getElementById('sv-upd');
  if (!upd || !S.raw.cargado) return;
  const d = new Date(S.raw.cargado);
  upd.innerHTML = `${ms('schedule')}Datos SAP ${d.toLocaleDateString('es-CL')} ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  upd.classList.remove('hidden');
}

export async function renderMonitorPedidos(stage) {
  inyectarEstilos();
  if (!document.getElementById('cc-toasts')) { const t = document.createElement('div'); t.id = 'cc-toasts'; t.className = 'cc-toasts'; document.body.appendChild(t); }
  if (map) { try { map.remove(); } catch (_e) { /* */ } map = null; hubMarker = null; }
  S.editGeo = false; S.sel = null;
  await Promise.all([loadLeaflet(), cargarFuentes()]);
  stage.innerHTML = plantilla();
  root = stage.querySelector('.cc');
  bindEventos();
  document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  const sucs = [...new Set(S.raw.suc.map(d => z(d.ofvta)).filter(Boolean))].sort();
  if (!sucs.length) { root.querySelector('.cc-main').innerHTML = '<div class="cc-card"><div class="cc-empty" style="margin:24px">No hay pedidos de despacho/retiro en su alcance.</div></div>'; return; }
  let pref = ''; try { pref = localStorage.getItem(LS_SUC) || ''; } catch (_e) { /* */ }
  setSucursal(sucs.includes(pref) ? pref : sucs[0]);
  actualizadoEn();
}
// Compatibilidad con app.js (tab 'monitor-consolidacion')
export const renderMonitorConsolidacion = renderMonitorPedidos;

/* ════════════════════════════════════════════════════════════════════════
   ESTILOS (prefijo cc-)
   ════════════════════════════════════════════════════════════════════════ */
function inyectarEstilos() {
  document.getElementById('cc-style')?.remove();
  const st = document.createElement('style');
  st.id = 'cc-style';
  st.textContent = `
.cc{--cc-primary:#b5000b;--cc-sel:#ffdad5;--cc-sel2:#fff5f3;--cc-ink:#191c1d;--cc-ink2:#5c5f61;--cc-ink3:#444749;--cc-s1:#f3f4f5;--cc-s2:#edeeef;--cc-s3:#e7e8e9;--cc-line:#e1e3e4;--cc-line2:#edeeef;--cc-mono:'JetBrains Mono',ui-monospace,Consolas,monospace;--cc-gray:#9ca3af;
display:flex;flex-direction:column;gap:10px;color:var(--cc-ink);font-size:14px}
.cc *,.cc-toasts *{box-sizing:border-box}
.cc .material-symbols-outlined,.cc-toasts .material-symbols-outlined,.cc-pin .material-symbols-outlined,.cc-tt .material-symbols-outlined{font-size:18px;line-height:1;vertical-align:middle;display:inline-block;width:1em;overflow:hidden;white-space:nowrap;flex-shrink:0}
.cc .mono,.cc-tt .mono{font-family:var(--cc-mono,monospace);font-size:12px}.cc .num{font-variant-numeric:tabular-nums}
.cc-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;background:#fff;border:1px solid var(--cc-line);border-radius:8px;padding:8px 12px}
.cc-brand{display:flex;align-items:center;gap:10px;margin-right:auto;min-width:220px}
.cc-brand-ic{width:36px;height:36px;border-radius:8px;background:var(--cc-sel);color:var(--cc-primary);display:flex;align-items:center;justify-content:center}
.cc-brand-ic .material-symbols-outlined{font-size:22px}
.cc-brand-t{font-size:16px;font-weight:700;line-height:20px}.cc-brand-s{font-size:12px;color:var(--cc-ink2)}
.cc-grp{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}.cc-grp-full{flex-basis:100%}
.cc-lbl{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2)}
.cc-chips{display:flex;gap:6px;flex-wrap:wrap}
.cc-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cc-line);background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--cc-ink3);white-space:nowrap}
.cc-chip:hover{border-color:var(--cc-ink2)}.cc-chip:disabled{opacity:.5}
.cc-chip.is-tool.is-on{background:var(--cc-primary);border-color:var(--cc-primary);color:#fff}
.cc-chip .cc-cnt{font-family:var(--cc-mono);font-size:10.5px;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 6px}
.cc-select{border:1px solid var(--cc-line);border-radius:6px;padding:5px 8px;font-size:13px;background:#fff}
.cc-search{display:flex;align-items:center;gap:6px;border:1px solid var(--cc-line);border-radius:6px;padding:5px 9px;background:#fff;align-self:flex-end}
.cc-search input{border:none;outline:none;width:240px;font-size:13px;background:none}
/* KPIs */
.cc-kpis{flex-basis:100%;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
.cc-kpi{display:flex;align-items:center;gap:8px;border:1px solid var(--cc-line);background:#fff;border-radius:8px;padding:5px 9px;cursor:pointer;text-align:left;transition:border-color .15s,box-shadow .15s;position:relative;overflow:hidden}
.cc-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc)}
.cc-kpi:hover{border-color:var(--kc)}
.cc-kpi.is-on{border-color:var(--kc);box-shadow:0 0 0 2px var(--kc) inset;background:color-mix(in srgb,var(--kc) 6%,#fff)}
.cc-kpi-ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--kc) 14%,#fff);color:var(--kc)}
.cc-kpi-ic .material-symbols-outlined{font-size:20px}
.cc-kpi-b{display:flex;flex-direction:column;min-width:0}
.cc-kpi-l{font-size:11px;font-weight:600;color:var(--cc-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-kpi b{font-size:17px;line-height:20px}
.cc-kpi-s{display:none}
/* Condición */
.cc-ci{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}
.cc-ci .material-symbols-outlined{font-size:15px}
.cc-ci.sm{width:18px;height:18px;border-radius:5px;margin-right:6px}.cc-ci.sm .material-symbols-outlined{font-size:12px}
.cc-ci.xs{width:16px;height:16px;border-radius:4px;margin-right:5px}.cc-ci.xs .material-symbols-outlined{font-size:11px}
.cc-ci.lg{width:40px;height:40px;border-radius:10px}.cc-ci.lg .material-symbols-outlined{font-size:24px}
.cc-cchip{display:inline-flex;align-items:center;gap:7px;border:1.5px solid var(--cc-line);background:#fff;border-radius:999px;padding:3px 11px 3px 4px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--cc-ink2);opacity:.55;transition:all .15s}
.cc-cchip:hover{opacity:.85}
.cc-cchip.is-on{opacity:1;border-color:var(--cc);background:var(--cb);color:var(--ci)}
.cc-cchip .cc-cnt{font-family:var(--cc-mono);font-size:11px;background:#fff;border-radius:999px;padding:0 7px;color:var(--cc-ink)}
.cc-cond{display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;padding:2px 8px 2px 3px;border-radius:999px;white-space:nowrap}
.cc-est-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.cc-est-pill .material-symbols-outlined{font-size:14px}
/* Layout */
.cc-main{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px;height:max(620px,calc(100vh - 290px))}
.cc-card{background:#fff;border:1px solid var(--cc-line);border-radius:8px;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--cc-line);background:#fff;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--cc-ink)}
.cc-btn:disabled{opacity:.45;cursor:not-allowed}.cc-btn.pri{background:var(--cc-primary);border-color:var(--cc-primary);color:#fff}.cc-btn.sm{padding:4px 9px;font-size:12px}
.cc-mapwrap{position:relative;flex:1;min-height:0}
#cc-map{position:absolute;inset:0;background:#e8eaeb}
.cc-maphint{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:500;background:var(--cc-ink);color:#fff;font-size:12px;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;align-items:center;gap:6px;pointer-events:none}
.cc-maphint.show{display:flex}
.cc-legend{position:absolute;left:10px;bottom:10px;z-index:500;background:rgba(255,255,255,.92);border:1px solid var(--cc-line);border-radius:8px;padding:6px 9px;font-size:10.5px;display:flex;flex-direction:column;gap:4px;color:var(--cc-ink3);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.cc-legend div{display:flex;align-items:center;gap:7px}
.cc-legend i{width:10px;height:10px;border-radius:50%;display:inline-block;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15);margin:0 4px 0 4px}
.cc-legend i.dash{background:#fff;border:1.5px dashed var(--cc-ink2);box-shadow:none}
.cc-legend-sep{height:1px;background:var(--cc-line);margin:2px 0}
/* Pines */
.cc-pin-wrap{background:none;border:none}
.cc-pin{position:relative;width:30px;height:30px;border-radius:50% 50% 50% 6px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.38);color:#fff;background:var(--pc);cursor:pointer;transition:transform .12s}
.cc-pin>.material-symbols-outlined{transform:rotate(45deg);font-size:16px}
.cc-pin-st{position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;transform:rotate(45deg)}
.cc-pin.aprox{border-style:dashed}
.cc-pin.venc{box-shadow:0 0 0 3px rgba(220,38,38,.45),0 1px 5px rgba(0,0,0,.38)}
.cc-pin.sel{transform:rotate(-45deg) scale(1.28);box-shadow:0 0 0 3px var(--cc-ink,#191c1d),0 3px 10px rgba(0,0,0,.45)}
.cc-pin.hl{transform:rotate(-45deg) scale(1.3)}
.cc-pin.drag{animation:ccBob 1.4s ease-in-out infinite;cursor:grab}
.cc-pin.edit{background:#fff;color:#5c5f61;border:2px dashed #5c5f61;animation:ccBob 1.4s ease-in-out infinite}
@keyframes ccBob{50%{margin-top:-4px}}
.cc-hub{width:36px;height:36px;border-radius:9px;background:#b5000b;color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.cc-hub .material-symbols-outlined{font-size:22px;font-family:'Material Symbols Outlined'}
.leaflet-tooltip.cc-tt{font-size:12px;padding:8px 10px;border-radius:8px;border:1px solid #e1e3e4;box-shadow:0 4px 14px rgba(0,0,0,.14);color:#191c1d;max-width:340px;white-space:normal}
.cc-tt-h{font-weight:700;display:flex;gap:7px;align-items:center;margin-bottom:4px}.cc-tt-r{color:#5c5f61;line-height:1.45}
.cc-tt-f{margin-top:5px;font-size:11px;color:#5c5f61;border-top:1px solid #edeeef;padding-top:4px}
.cc-tt .cc-ci{width:20px;height:20px}.cc-tt .cc-ci .material-symbols-outlined{font-size:13px}
.cc-tt .cc-est-pill{font-size:10.5px}
.cc-geo-pop{display:flex;flex-direction:column;gap:6px;min-width:220px;font-size:13px}.cc-geo-pop .mono{font-family:'JetBrains Mono',monospace;font-size:12px;color:#5c5f61}
.cc-geo-pop .cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer;background:#b5000b;border:1px solid #b5000b;color:#fff}
.cc-geo-pop .cc-btn:disabled{opacity:.45}
/* Panel */
.cc-pane{flex:1;overflow:auto;padding:6px 12px 14px}
.cc-sec-t{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2);margin:10px 2px 6px;display:flex;justify-content:space-between;align-items:center}
.cc-empty{color:var(--cc-ink2);font-size:13px;text-align:center;padding:22px 10px;border:1px dashed var(--cc-line);border-radius:8px}
.cc-empty .material-symbols-outlined{font-size:28px;display:block;margin:0 auto 6px;color:var(--cc-gray)}
.cc-li{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:9px;padding:8px 6px;border-radius:8px;border:1px solid transparent;cursor:pointer}
.cc-li:hover,.cc-li.is-hl{background:var(--cc-s1);border-color:var(--cc-line2)}
.cc-li.is-sel{background:var(--cc-sel2);border-color:var(--cc-sel)}
.cc-li-id{font-family:var(--cc-mono);font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:6px}
.cc-li-sub{font-size:11.5px;color:var(--cc-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-li-f{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--cc-ink2);margin-top:2px}
.cc-li-f>span:first-child{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.cc-li-f .material-symbols-outlined{font-size:13px}
.cc-li-f .cc-mini{flex:1;max-width:80px}
.cc-x{border:none;background:none;color:#5c5f61;cursor:pointer;padding:3px;border-radius:4px;display:flex}
.cc-x:hover{background:#e7e8e9;color:#b5000b}
.cc-mini{height:6px;background:var(--cc-s2);border-radius:3px;overflow:hidden;position:relative;display:inline-block}
.cc-mini i{position:absolute;inset:0 auto 0 0;border-radius:3px}
.cc-tag{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.02em;padding:1px 6px;border-radius:4px;white-space:nowrap;text-transform:uppercase}
.cc-tag.am{background:#fef3c7;color:#92400e}.cc-tag.gr{background:#dcfce7;color:#166534}.cc-tag.rd{background:#fee2e2;color:#991b1b}.cc-tag.gy{background:#edeeef;color:#444749}
.cc-venc{color:#b91c1c!important;font-weight:700}
/* Tabla */
.cc-tablecard{height:min(46vh,480px)}
.cc-tbar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--cc-line)}
.cc-tbar-t{font-weight:700;font-size:14px}.cc-tbar-s{font-size:12px;color:var(--cc-ink2)}
.cc-tscroll{flex:1;overflow:auto}
table.cc-t{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.cc-t th{position:sticky;top:0;z-index:2;background:var(--cc-s1);text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cc-ink2);padding:8px 10px;border-bottom:1px solid var(--cc-line);white-space:nowrap;user-select:none}
.cc-t th.sort{cursor:pointer}.cc-t th.sort:hover{color:var(--cc-primary)}.cc-t th .material-symbols-outlined{font-size:14px}
.cc-t td{padding:6px 10px;border-bottom:1px solid var(--cc-line2);white-space:nowrap;vertical-align:middle}
.cc-t td.r,.cc-t th.r{text-align:right}
.cc-t td.cc-td-cli{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.cc-t tbody tr{cursor:pointer}.cc-t tbody tr:hover,.cc-t tbody tr.is-hl{background:var(--cc-s1)}
.cc-t tbody tr.is-sel{background:var(--cc-sel2)}.cc-t tbody tr.is-sel td:first-child{box-shadow:inset 3px 0 0 var(--cc-primary)}
.cc-av{display:inline-flex;align-items:center;gap:7px}.cc-av .cc-mini{width:60px}
.cc-acts{display:flex;gap:2px}
.cc-ib{border:none;background:none;color:var(--cc-ink2);cursor:pointer;padding:4px;border-radius:4px;display:inline-flex}
.cc-ib:hover:not(:disabled){background:var(--cc-s3);color:var(--cc-primary)}.cc-ib:disabled{opacity:.35;cursor:default}
/* Toasts */
.cc-toasts{position:fixed;right:18px;bottom:18px;z-index:2000;display:flex;flex-direction:column;gap:8px;max-width:380px}
.cc-toast{background:#fff;border:1px solid #e1e3e4;border-left:4px solid #2563eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 12px;display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:start;font-size:13px;color:#191c1d}
.cc-toast>.material-symbols-outlined{font-size:20px;font-variation-settings:'FILL' 1}
.cc-toast b{display:block;font-size:13px}.cc-toast p{margin:2px 0 0;font-size:12px;color:#5c5f61;line-height:1.4}
.cc-toast.ok{border-left-color:#16a34a}.cc-toast.ok>.material-symbols-outlined{color:#16a34a}
.cc-toast.err{border-left-color:#dc2626}.cc-toast.err>.material-symbols-outlined{color:#dc2626}
.cc-toast.warn{border-left-color:#f59e0b}.cc-toast.warn>.material-symbols-outlined{color:#f59e0b}
/* Modal */
.cc-modal{position:fixed;inset:0;z-index:2100;background:rgba(25,28,29,.38);display:none;align-items:center;justify-content:center;padding:16px}
.cc-modal.show{display:flex}
.cc-modal-c{background:#fff;border-radius:10px;width:min(1020px,100%);max-height:86vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.3)}
.cc-modal-h{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--cc-line)}
.cc-modal-h h3{margin:0;font-size:16px;font-family:var(--cc-mono);display:flex;align-items:center;gap:8px}.cc-modal-h p{margin:3px 0 0;color:var(--cc-ink2);font-size:12.5px}
.cc-modal-b{padding:14px 18px 18px}
.cc-steps{display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.cc-step{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--cc-s1);color:var(--cc-gray);font-size:12px;font-weight:600}
.cc-step.on{background:#dcfce7;color:#166534}.cc-step.on.rd{background:#fee2e2;color:#991b1b}
.cc-step-l{flex:0 0 24px;height:2px;background:var(--cc-line)}
.cc-kv{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.cc-kv div{background:var(--cc-s1);border-radius:6px;padding:7px 9px}
.cc-kv span{display:block;font-size:10.5px;color:var(--cc-ink2);text-transform:uppercase;letter-spacing:.04em;font-weight:700}.cc-kv b{font-size:13px}
.cc-modal table{width:100%;border-collapse:collapse;font-size:12.5px}
.cc-modal th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--cc-ink2);padding:6px 8px;border-bottom:1px solid var(--cc-line);background:var(--cc-s1);white-space:nowrap}
.cc-modal td{padding:6px 8px;border-bottom:1px solid var(--cc-line2)}
.cc-modal tr.bad td{background:#fef3c7}.cc-modal tr.blq td{background:#fff5f5;color:#7f1d1d;text-decoration:line-through}
.cc-modal tr.blq td:last-child,.cc-modal .cc-dtab tr.blq td:nth-child(n+9){text-decoration:none}
.cc-modal .r{text-align:right}
/* Express (spot) */
.cc-rayo{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#facc15;color:#713f12;margin:0 3px;vertical-align:middle;box-shadow:0 0 0 2px #fef9c3;animation:ccXp 1.6s ease-in-out infinite}
.cc-rayo .material-symbols-outlined{font-size:14px!important;font-variation-settings:'FILL' 1}
@keyframes ccXp{50%{box-shadow:0 0 0 5px rgba(250,204,21,.35)}}
.cc-pin-xp{position:absolute;bottom:-7px;left:-7px;width:17px;height:17px;border-radius:50%;background:#facc15;color:#713f12;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:rotate(45deg)}
.cc-pin-xp .material-symbols-outlined{font-size:12px!important;font-variation-settings:'FILL' 1}
.cc-pin.xp{animation:ccPinXp 1.4s ease-in-out infinite}
@keyframes ccPinXp{50%{box-shadow:0 0 0 6px rgba(250,204,21,.55),0 1px 5px rgba(0,0,0,.38)}}
.cc-kpi.xp.alerta{background:#fefce8;border-color:#facc15}.cc-kpi.xp.alerta .cc-kpi-ic{animation:ccXp 1.6s ease-in-out infinite}
.cc-kpi.xp .material-symbols-outlined{font-variation-settings:'FILL' 1}
.cc-li.xp{border-left:3px solid #facc15;background:#fffdf0}
.cc-t tbody tr.xp td:first-child{box-shadow:inset 3px 0 0 #facc15}
.cc-t tbody tr.xp{background:#fffdf0}
.cc-tag.xp{background:#facc15;color:#713f12}
.cc-toast.xp{border-left-color:#facc15;background:#fffdf0}.cc-toast.xp>.material-symbols-outlined{color:#ca8a04}
.cc-xp-badge{display:inline-flex;align-items:center;gap:3px;background:#facc15;color:#713f12;font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:800;padding:2px 9px 2px 5px;border-radius:999px;letter-spacing:.03em}
.cc-xp-badge .material-symbols-outlined{font-size:15px;font-variation-settings:'FILL' 1}
.cc-modal-h.xp{background:linear-gradient(90deg,#fefce8,#fff 60%)}
/* Vista detalle */
.cc-modal-c{width:min(1320px,100%);max-height:92vh}
.cc-dgrid{display:grid;grid-template-columns:1.1fr 1.1fr 1fr;gap:10px;margin-bottom:14px}
.cc-dbox{border:1px solid var(--cc-line);border-radius:8px;padding:10px 12px}
.cc-dbox h4,.cc-dtit{margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--cc-ink2);display:flex;align-items:center;gap:6px}
.cc-dtit small{text-transform:none;font-weight:500;letter-spacing:0}
.cc-dbox dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:12.5px}
.cc-dbox dt{color:var(--cc-ink2)}.cc-dbox dd{margin:0}
.cc-flete{background:#fafafa}
.cc-fl-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:3px 0}
.cc-fl-row.tot{border-top:1px solid var(--cc-line);margin-top:2px;padding-top:6px;font-weight:600}
.cc-fl-row.sug{background:#eef2ff;border-radius:6px;padding:6px 8px;margin-top:6px;color:#3730a3;font-weight:700}
.cc-fl-row.sug span{display:flex;align-items:center;gap:5px}
.cc-fl-row.dif.neg b{color:#b91c1c}.cc-fl-row.dif.pos b{color:#15803d}
.cc-fl-nota{font-size:11px;color:var(--cc-ink2);margin:6px 0 0;line-height:1.4}
.cc-dtab{overflow:auto;border:1px solid var(--cc-line);border-radius:8px}
.cc-modal .cc-dtab table{font-size:12px}
.cc-modal .cc-dtab th.sep,.cc-modal .cc-dtab td.sep{border-left:2px solid var(--cc-line)}
.cc-modal .cc-dtab tr.grp th{background:#fff;font-size:10px;text-align:center;border-bottom:none}
.cc-modal .cc-dtab td.sug{background:#eef2ff}
.cc-modal .cc-dtab tfoot td{background:var(--cc-s1);border-top:2px solid var(--cc-line);padding:7px 8px}
.cc-modal .cc-dtab td small{color:var(--cc-ink2)}
.cc-desc{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-regla{font-size:9.5px;font-weight:700;color:#4338ca;background:#e0e7ff;border-radius:3px;padding:0 4px}
.cc-reps{display:flex;flex-wrap:wrap;gap:3px}
.cc-rep{font-family:var(--cc-mono);font-size:11px;background:var(--cc-s1);border-radius:4px;padding:1px 5px;white-space:nowrap}
.cc-rep.venc{background:#fee2e2;color:#991b1b}
@media (max-width:1100px){.cc-dgrid{grid-template-columns:1fr}}
/* Mapa protagonista (18-nov-2026) */
.cc-mapbtns{position:absolute;top:10px;right:10px;z-index:600;display:flex;flex-direction:column;gap:6px}
.cc-mapbtn{width:34px;height:34px;border-radius:8px;border:1px solid var(--cc-line);background:#fff;color:var(--cc-ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.cc-mapbtn:hover{color:var(--cc-primary);border-color:var(--cc-primary)}
.cc-mapbtn .material-symbols-outlined{font-size:20px}
.cc.sin-panel .cc-main{grid-template-columns:minmax(0,1fr) 0}
.cc.sin-panel .cc-side{display:none}
.cc.map-full .cc-main{position:fixed;inset:0;z-index:1900;height:100vh;grid-template-columns:minmax(0,1fr) 330px;background:#fff;padding:8px;gap:8px}
.cc.map-full.sin-panel .cc-main{grid-template-columns:minmax(0,1fr) 0}
/* Georreferencia de obra (maestro_obras) */
.cc-pin.nogeo{border-color:#fff;border-style:dashed;opacity:.9}
.cc-pin-ng{position:absolute;top:-7px;left:-7px;width:16px;height:16px;border-radius:50%;background:#7c2d12;color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:rotate(45deg)}
.cc-pin-ng .material-symbols-outlined{font-size:11px!important;font-weight:700}
.cc-ng{display:inline-flex;color:#b91c1c;margin-left:2px}.cc-ng .material-symbols-outlined{font-size:15px!important}
.cc-btn.pri{background:#b5000b;border-color:#b5000b;color:#fff}
@media (max-width:1280px){.cc-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1100px){.cc{height:auto}.cc-main{grid-template-columns:1fr;height:auto}.cc-mapwrap{height:58vh;flex:none}.cc-side{max-height:560px}.cc-tablecard{height:auto;max-height:70vh}}
@media (max-width:640px){.cc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-kv{grid-template-columns:repeat(2,1fr)}.cc-search input{width:140px}.cc-brand{min-width:0;width:100%}}
`;
  document.head.appendChild(st);
}
