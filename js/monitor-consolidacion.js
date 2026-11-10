// ============================================================================
// MONITOR DE CONSOLIDACIÓN (9-nov-2026, Jordan)
// ----------------------------------------------------------------------------
// Monitor (NO cierra viajes) de cómo los pedidos de venta de sucursal van
// completando camiones, por selección del usuario o por sector (ruta/comuna).
//
// Fuentes (todas en Supabase):
//   · trc_live fuente 'pedidos_ventas_sucursal'  ← Pedidos_Ventas_Sucursal.csv (Drive, Edge lectura-drive-sap)
//   · trc_live fuente 'entregas_periodo'          ← Entregas_Periodo.csv (entregas en tratamiento, clases ZE01/05/06)
//   · v_tarifas_clientes_vigentes                 ← camiones habilitados por centro origen y ruta
//   · routes / logistics_centres (loadRoutesData) ← coordenadas de ruta (comuna) y del centro
//   · maestro_productos                           ← prioridad de pesos (sobre SAP)
//   · obras_georef                                ← coordenadas exactas de obra (id_obra); si no, punto de la ruta
//
// Reglas:
//   · Toneladas del pedido = pendiente de entrega × peso unitario (maestro > SAP peso_bruto/cantidad).
//     Posiciones bloqueadas (Bloqueada X / MR / Dcto vendedor) no suman. Peso unitario > 5 t → sospechoso, no suma.
//   · Match entrega = cantidad en entregas en tratamiento (Entregas_Periodo) vs pendiente, por documento + posición.
//   · Semáforo: rojo = todas las posiciones pendientes bloqueadas; ámbar = bloqueo parcial, sin entrega,
//     descuadre, sin confirmar o peso sospechoso; verde = sin observaciones.
//   · Condiciones sin "DESP" (CLI-RET…) son retiros: ocultos por defecto y sólo suman con forzado manual.
//   · Camión objetivo: camiones habilitados en Tarifas Clientes del centro origen (grupo) de la sucursal;
//     "No habilitado" si la ruta del pedido no tiene ese camión.
// ============================================================================
import { supabase } from './supabase-client.js?v=202611101815';
import { getDatabase, loadRoutesData, HIST_ALIAS_PREFIJO } from './data.js?v=202611101815';
import { loadLeaflet } from './utils.js';
import { filtrarPorCentro, can } from './permisos.js?v=202611101815';

const CFG = {
  umbralCompleto: 0.90,
  zonaSobrecarga: 0.25,
  capacidadPorDefectoKg: 15000,
  kgUnitSospechoso: 5000,
  tablaGeo: 'obras_georef',
  tiles: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};
const LS_SUC = 'sit_cc_sucursal';

/* ════════════════════════════════════════════════════════════════════════
   ESTADO
   ════════════════════════════════════════════════════════════════════════ */
const S = {
  raw: null,                 // { suc, ent, hab, geo, cargado, geoOk, maestro }
  sucursal: '', centro: null, grupo: '',
  camiones: [], rutasHab: new Map(),
  pedidos: [], byId: new Map(),
  capacidad: 15, capKg: 15000, tipo: '', manual: false, base: 'pedido',
  condTodas: [], cond: new Set(),
  camion: new Set(), forzados: new Set(),
  editGeo: false, lazo: false,
  q: '', fEstado: 'todos', orden: { col: 'fecha', dir: 1 },
  tab: 'sectores', nivel: 'vacio', rutaOrden: new Map(), rutaKm: 0, sectoresCompletos: 0,
};
let root = null, map = null, capaPedidos = null, capaRuta = null, capaTmp = null, hubMarker = null;
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
const tieneGeo = p => Number.isFinite(p.latitud) && Number.isFinite(p.longitud);
const ll = p => ({ lat: p.latitud, lng: p.longitud });
const hav = (a, b) => {
  const R = 6371, rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lng - a.lng) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const SVG = {
  ok: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  desc: '<svg viewBox="0 0 24 24"><path d="M10.6 5h2.8l-.5 9h-1.8zM12 16.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z"/></svg>',
  bloq: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.6a7.4 7.4 0 0 1 5.8 12L7.4 6.2A7.4 7.4 0 0 1 12 4.6zM6.2 7.4l10.4 10.4A7.4 7.4 0 0 1 6.2 7.4z"/></svg>',
  hub: '<svg viewBox="0 0 24 24"><path d="M12 3 2 8.2V21h4v-8h12v8h4V8.2zM8 15h8v2H8zm0 3h8v3H8z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z"/></svg>',
};
const ESTADO_TXT = { ok: 'Confirmado', desc: 'Advertencia', bloq: 'Bloqueado' };

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
  const [suc, ent, tar, geoRes] = await Promise.all([
    leerPaginado(() => supabase.from('trc_live').select('data,cargado_en').eq('fuente', 'pedidos_ventas_sucursal').order('fila')),
    leerPaginado(() => supabase.from('trc_live').select('data').eq('fuente', 'entregas_periodo').order('fila')),
    leerPaginado(() => supabase.from('v_tarifas_clientes_vigentes').select('centro_origen,codigo_ruta,tipo_camion,cap_kg,es_2t').order('id')),
    supabase.from(CFG.tablaGeo).select('id_obra,lat,lon,updated_at,updated_by').then(r => r, e => ({ error: e })),
  ]);
  const geo = new Map(), geoOk = !geoRes.error;
  (geoRes.data || []).forEach(g => { if (Number.isFinite(+g.lat) && Number.isFinite(+g.lon)) geo.set(z(g.id_obra), { lat: +g.lat, lon: +g.lon, at: g.updated_at, by: g.updated_by }); });
  // Maestro de productos (prioridad de pesos) sólo para los materiales presentes
  const mats = [...new Set(suc.map(r => z(r.data?.material)).filter(Boolean))];
  const maestro = new Map();
  for (let i = 0; i < mats.length; i += 300) {
    const { data, error } = await supabase.from('maestro_productos').select('id_material,peso_bruto').in('id_material', mats.slice(i, i + 300));
    if (error) break;
    (data || []).forEach(m => { if (+m.peso_bruto > 0) maestro.set(z(m.id_material), +m.peso_bruto); });
  }
  // Camiones habilitados por centro origen (grupo) y por ruta
  const hab = {};
  tar.forEach(f => {
    const g = f.centro_origen; const k = +f.cap_kg; if (!g || !(k > 0)) return;
    const c = hab[g] || (hab[g] = { camiones: new Map(), rutas: new Map() });
    const t = c.camiones.get(k) || { tipo: f.tipo_camion || `Camión ${k / 1000} Ton`, capKg: k, es2t: !!f.es_2t, rutas: 0 };
    t.rutas++; c.camiones.set(k, t);
    const cod = String(f.codigo_ruta || '').trim().toUpperCase();
    if (cod) (c.rutas.get(cod) || c.rutas.set(cod, new Set()).get(cod)).add(k);
  });
  Object.values(hab).forEach(c => { c.camiones = [...c.camiones.values()].sort((a, b) => a.capKg - b.capKg); });
  const cargado = suc.reduce((m, r) => (r.cargado_en && r.cargado_en > m ? r.cargado_en : m), '');
  S.raw = { suc: filtrarPorCentro(suc.map(r => r.data), r => z(r.ofvta)), ent: ent.map(r => r.data), hab, geo, geoOk, maestro, cargado };
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

/** Pedidos (documento) de una sucursal con sus posiciones pendientes, cruce de entregas y coordenadas. */
function construirPedidos(sucursal) {
  const { suc, ent, geo, maestro } = S.raw;
  const rutaDe = indiceRutas();
  const entPos = new Map();
  ent.forEach(d => {
    if (!/^ZE/i.test(String(d.tipo_entrega || ''))) return;
    const k = z(d.documento_precedente_doc_modelo) + '|' + z(d.posicion_modelo);
    const e = entPos.get(k) || { cant: 0, kg: 0, entregas: new Set() };
    e.cant += num(d.cantidad_entregada); e.kg += num(d.peso_bruto); e.entregas.add(z(d.entrega));
    entPos.set(k, e);
  });
  const peds = new Map();
  suc.forEach(d => {
    if (z(d.ofvta) !== sucursal) return;
    const doc = z(d.doc_ventas); if (!doc) return;
    let p = peds.get(doc);
    if (!p) {
      const ruta = rutaDe(d.ruta);
      const comunaDesc = String(d.ruta_desc || '').split('/').slice(1).join('/').trim();
      p = {
        id_pedido: doc, id_obra: z(d.id_obra), cliente: String(d.nombre_cliente || '').trim(), solic: z(d.solic),
        sucursal, condicion_exp: String(d.cond_expedicion || '').trim() || 'SIN COND.', clase: d.clvt || '',
        ruta: String(d.ruta || '').trim().toUpperCase(), rutaCodigo: ruta ? String(ruta.codigo).toUpperCase() : String(d.ruta || '').trim().toUpperCase(),
        rutaDesc: d.ruta_desc || '', comuna: (ruta && ruta.comuna) || comunaDesc || (d.ruta ? String(d.ruta) : 'Sin ruta'),
        direccion: String(d.direccion_obra || '').trim(), interlocutor: d.interlocutor || '', creado: fechaKey(d.creado_el),
        latitud: null, longitud: null, geoExacta: false, _rutaObj: ruta, posiciones: [],
      };
      peds.set(doc, p);
    }
    const cant = num(d.cantidad_de_pedido), pend = num(d.pendiente_entrega), kgPos = num(d.peso_bruto);
    const um = String(d.um || '').trim().toUpperCase();
    const mat = z(d.material);
    const kgUnit = um === 'KG' ? 1 : (maestro.get(mat) || (cant > 0 ? kgPos / cant : 0));
    const bloqTxt = [d.motivo_rechazo, d.dcto_vendedor].map(x => String(x || '').trim()).filter(Boolean).join(' / ');
    const bloq = String(d.bloqueada || '').trim().toUpperCase() === 'X' || !!bloqTxt;
    const e = entPos.get(doc + '|' + z(d.pos));
    p.posiciones.push({
      pos: z(d.pos), sku: mat, descripcion: d.denominacion_de_posicion || '', um, cantidad: cant, confirmada: num(d.ctd_confirmada),
      entregado: num(d.cantidad_entrg), pendiente: pend, kgUnit, sospechoso: kgUnit > CFG.kgUnitSospechoso,
      bloqueo: bloq ? (bloqTxt || 'X') : null, fecha: fechaKey(d.fe_entrega),
      entTrat: e ? e.cant : 0, kgEnt: e ? e.kg : 0, entregas: e ? [...e.entregas] : [],
    });
  });
  const lista = [...peds.values()].filter(p => p.posiciones.some(x => x.pendiente > 0));
  lista.forEach(p => {
    const g = geo.get(p.id_obra);
    if (g) { p.latitud = g.lat; p.longitud = g.lon; p.geoExacta = true; }
    else if (p._rutaObj && Number.isFinite(+p._rutaObj.lat) && Number.isFinite(+p._rutaObj.lon) && +p._rutaObj.lat !== 0) {
      const h = hash(p.id_pedido), ang = (h % 360) * Math.PI / 180, rad = 0.0012 + ((h >>> 9) % 100) / 100 * 0.0045;
      p.latitud = +p._rutaObj.lat + rad * Math.sin(ang); p.longitud = +p._rutaObj.lon + rad * 1.2 * Math.cos(ang);
    }
    evaluar(p);
  });
  return lista;
}

/* ════════════════════════════════════════════════════════════════════════
   REGLAS
   ════════════════════════════════════════════════════════════════════════ */
function evaluar(p) {
  const act = p.posiciones.filter(x => x.pendiente > 0);
  const lib = act.filter(x => !x.bloqueo);
  const bloq = act.filter(x => x.bloqueo);
  const cuenta = lib.filter(x => !x.sospechoso);
  const kgPend = cuenta.reduce((a, x) => a + x.pendiente * x.kgUnit, 0);
  const kgOk = cuenta.reduce((a, x) => a + Math.min(x.entTrat, x.pendiente) * x.kgUnit, 0);
  const kgEnt = cuenta.reduce((a, x) => a + x.kgEnt, 0);
  const conEnt = lib.filter(x => x.entTrat > 0).length;
  const difs = lib.filter(x => Math.abs(x.entTrat - x.pendiente) > 1e-6);
  const m = { sinEntrega: lib.length > 0 && conEnt === 0, cuadra: lib.length > 0 && difs.length === 0, pct: kgPend > 0 ? kgOk / kgPend : (difs.length ? 0 : 1), tonEnt: kgEnt / 1000, difs };
  const motivos = [];
  if (!lib.length) motivos.push({ t: 'rd', txt: `Bloqueado ${[...new Set(bloq.map(x => x.bloqueo))].join(', ')}` });
  else {
    if (bloq.length) motivos.push({ t: 'am', txt: `Bloqueo parcial · ${bloq.length} pos.` });
    if (m.sinEntrega) motivos.push({ t: 'am', txt: 'Sin entrega creada' });
    else if (!m.cuadra) motivos.push({ t: 'am', txt: `Descuadre entrega · ${difs.length} pos.` });
    if (lib.some(x => x.confirmada + 1e-6 < x.cantidad)) motivos.push({ t: 'am', txt: 'Unidades sin confirmar' });
    if (lib.some(x => x.sospechoso)) motivos.push({ t: 'am', txt: 'Peso sospechoso (maestro)' });
  }
  p._estado = !lib.length ? 'bloq' : motivos.length ? 'desc' : 'ok';
  if (p._estado === 'ok') motivos.push({ t: 'gr', txt: 'Confirmado · entrega 100%' });
  p._motivos = motivos; p._m = m; p._ton = kgPend / 1000;
  p.codigo_bloqueo = !lib.length ? [...new Set(bloq.map(x => x.bloqueo))].join(', ') : null;
  const fechas = (lib.length ? lib : act).map(x => x.fecha).filter(Boolean).sort();
  p.fecha = fechas[0] || '';
}

const peso = p => S.base === 'entrega' ? p._m.tonEnt : p._ton;
const esRetiro = p => !/DESP/i.test(p.condicion_exp);
const visible = p => S.camion.has(p.id_pedido) || S.cond.has(p.condicion_exp);
const capsRuta = p => S.rutasHab.get(p.rutaCodigo) || null;
const habilitado = p => { if (S.manual) return true; const c = capsRuta(p); return !!c && c.has(S.capKg); };
const camionesDe = codigo => { const c = S.rutasHab.get(codigo); return c ? S.camiones.filter(t => c.has(t.capKg)) : []; };

function puedeCargar(p) {
  if (p._estado === 'bloq') return { ok: false, razon: 'bloqueo', msg: `${p.codigo_bloqueo}: todas las posiciones pendientes bloqueadas` };
  if (esRetiro(p) && !S.forzados.has(p.id_pedido)) return { ok: false, razon: 'retiro', msg: `${p.condicion_exp}: requiere forzado manual` };
  return { ok: true };
}
const totalCamion = () => [...S.camion].reduce((a, id) => a + peso(S.byId.get(id)), 0);
function nivelDe(tot, cap) {
  if (!S.camion.size) return 'vacio';
  const pct = cap > 0 ? tot / cap : Infinity;
  return pct > 1 + 1e-9 ? 'exceso' : pct >= CFG.umbralCompleto ? 'completo' : 'parcial';
}
function ajuste(ton, cams) {
  if (!cams.length || !(ton > 0)) return null;
  const ok = cams.filter(c => ton / (c.capKg / 1000) >= CFG.umbralCompleto && ton <= c.capKg / 1000 + 1e-9);
  if (ok.length) { const c = ok[ok.length - 1]; return { tipo: 'completa', c, pct: ton / (c.capKg / 1000) }; }
  const max = cams[cams.length - 1], capMax = max.capKg / 1000;
  if (ton > capMax) return { tipo: 'multi', c: max, n: ton / capMax };
  const c = cams.find(x => x.capKg / 1000 >= ton);
  const lleno = cams.filter(x => x.capKg / 1000 < ton).pop() || null;
  return { tipo: 'parcial', c, pct: ton / (c.capKg / 1000), falta: c.capKg / 1000 * CFG.umbralCompleto - ton, lleno, saldo: lleno ? ton - lleno.capKg / 1000 : 0 };
}
function ajusteTxt(a) {
  if (!a) return '';
  if (a.tipo === 'completa') return `Completa <b>${esc(a.c.tipo)}</b> (${fP(a.pct)})`;
  if (a.tipo === 'multi') return `Supera <b>${esc(a.c.tipo)}</b> · ${fT(a.n, 1)} camiones`;
  const f = `Faltan <b>${fT(a.falta)} t</b> para <b>${esc(a.c.tipo)}</b> (${fP(a.pct)})`;
  return a.lleno ? `Llena <b>${esc(a.lleno.tipo)}</b> (+${fT(a.saldo)} t) · ${f}` : f;
}

/* ════════════════════════════════════════════════════════════════════════
   ACCIONES
   ════════════════════════════════════════════════════════════════════════ */
function toggleCamion(id) { if (S.camion.has(id)) { S.camion.delete(id); renderTodo(); } else agregar(id); }
function agregar(id, silencioso = false) {
  const p = S.byId.get(id), c = puedeCargar(p);
  if (!c.ok) {
    if (silencioso) return c.razon;
    if (c.razon === 'retiro') toast('warn', `${p.id_pedido} es retiro (${p.condicion_exp})`, 'Los retiros no se suman a camiones de despacho salvo forzado manual.', { txt: 'Forzar inclusión', fn: () => { S.forzados.add(id); agregar(id); } });
    else toast('err', `No se puede sumar ${p.id_pedido}`, c.msg);
    return c.razon;
  }
  S.camion.add(id);
  if (!silencioso) {
    if (!habilitado(p)) toast('warn', `${S.tipo} no habilitado en ${p.comuna}`, `La ruta ${p.rutaCodigo || '—'} no tiene ese camión en Tarifas Clientes de ${S.grupo}.`);
    else if (p._estado === 'desc') toast('warn', `${p.id_pedido} sumado con advertencia`, p._motivos.map(m => m.txt).join(' · '));
    renderTodo();
  }
  return 'ok';
}
function agregarVarios(ids, origen) {
  const res = { ok: 0, bloqueo: 0, retiro: 0 };
  ids.forEach(id => { if (!S.camion.has(id)) res[agregar(id, true)]++; });
  const omit = [];
  if (res.bloqueo) omit.push(`${res.bloqueo} bloqueado${res.bloqueo > 1 ? 's' : ''}`);
  if (res.retiro) omit.push(`${res.retiro} retiro${res.retiro > 1 ? 's' : ''} sin forzar`);
  if (!ids.length) toast('info', `${origen}: sin pedidos`, 'No hay pedidos visibles en el área seleccionada.');
  else toast(res.ok ? 'ok' : 'warn', `${origen}: ${res.ok} pedido${res.ok === 1 ? '' : 's'} sumado${res.ok === 1 ? '' : 's'}`, omit.length ? `Omitidos: ${omit.join(', ')}.` : 'Todos los pedidos son consolidables.');
  renderTodo();
}
function setCamion(tipo, cap, manual = false, avisar = true) {
  S.tipo = tipo; S.capacidad = cap; S.capKg = Math.round(cap * 1000); S.manual = manual;
  renderTrucks(); renderTodo();
  if (!avisar) return;
  const n = sectores().filter(s => s.hab && s.pct >= CFG.umbralCompleto).length;
  if (n) toast('info', `${n} sector${n > 1 ? 'es' : ''} completa${n > 1 ? 'n' : ''} un ${tipo}`, 'Revise la pestaña Sectores.');
}
function setSucursal(suc, avisar = false) {
  S.sucursal = suc;
  try { localStorage.setItem(LS_SUC, suc); } catch (_e) { /* sin almacenamiento */ }
  const db = getDatabase();
  const lc = (db.logisticsCentres || []).find(c => String(c.id) === suc);
  S.centro = { id: suc, nombre: lc ? lc.nombre : `Centro ${suc}`, lat: lc ? +lc.lat : -33.45, lon: lc ? +lc.lon : -70.66 };
  S.grupo = lc ? (lc.origen_grupo || String(suc)) : String(suc);
  const h = S.raw.hab[S.grupo] || { camiones: [], rutas: new Map() };
  S.camiones = h.camiones; S.rutasHab = h.rutas;
  S.pedidos = construirPedidos(suc);
  S.byId = new Map(S.pedidos.map(p => [p.id_pedido, p]));
  S.camion.clear(); S.forzados.clear(); S.nivel = 'vacio';
  S.condTodas = [...new Set(S.pedidos.map(p => p.condicion_exp))].sort();
  S.cond = new Set(S.condTodas.filter(c => /DESP/i.test(c)));
  const pref = (!S.manual && S.camiones.find(t => t.capKg === S.capKg)) || S.camiones.find(t => t.capKg === CFG.capacidadPorDefectoKg) || S.camiones[S.camiones.length - 1];
  if (pref) { S.tipo = pref.tipo; S.capacidad = pref.capKg / 1000; S.capKg = pref.capKg; S.manual = false; }
  else if (!S.manual) { S.tipo = 'Sin camiones habilitados'; }
  reiniciarMapa();
  renderSucursales(); renderTrucks(); renderCond(); renderTodo();
  if (avisar && !S.camiones.length) toast('warn', `${S.grupo} sin camiones habilitados`, 'Revise Tarifas Clientes o use capacidad manual.');
}

/* ════════════════════════════════════════════════════════════════════════
   DERIVADOS
   ════════════════════════════════════════════════════════════════════════ */
function calcRuta() {
  const c = { lat: S.centro.lat, lng: S.centro.lon };
  const rest = [...S.camion].map(id => S.byId.get(id)).filter(tieneGeo);
  const orden = []; let cur = c, km = 0;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => { const d = hav(cur, ll(p)); if (d < bd) { bd = d; bi = i; } });
    const p = rest.splice(bi, 1)[0]; km += bd; orden.push(p); cur = ll(p);
  }
  if (orden.length) km += hav(cur, c);
  S.rutaOrden = new Map(orden.map((p, i) => [p.id_pedido, i + 1])); S.rutaKm = km;
  return orden;
}
function sugeridos() {
  const rest = S.capacidad - totalCamion();
  if (rest <= 0.05) return [];
  const sel = [...S.camion].map(id => S.byId.get(id)).filter(tieneGeo).map(ll);
  const ref = sel.length ? sel : [{ lat: S.centro.lat, lng: S.centro.lon }];
  const tot = totalCamion();
  return S.pedidos
    .filter(p => !S.camion.has(p.id_pedido) && S.cond.has(p.condicion_exp) && puedeCargar(p).ok && habilitado(p) && tieneGeo(p) && peso(p) > 0 && peso(p) <= rest + 1e-9)
    .map(p => ({ p, d: Math.min(...ref.map(r => hav(r, ll(p)))), completa: (tot + peso(p)) / S.capacidad >= CFG.umbralCompleto }))
    .sort((a, b) => (b.completa - a.completa) || (a.d - b.d)).slice(0, 4);
}
function sectores() {
  const m = new Map();
  S.pedidos.forEach(p => {
    if (!S.cond.has(p.condicion_exp) && !S.camion.has(p.id_pedido)) return;
    if (!puedeCargar(p).ok) return;
    const k = p.rutaCodigo || '—';
    const s = m.get(k) || { key: k, comuna: p.comuna, n: 0, ton: 0, enCamion: 0, ids: [], hab: habilitado(p), cams: camionesDe(p.rutaCodigo) };
    s.n++; s.ton += peso(p); s.ids.push(p.id_pedido); if (S.camion.has(p.id_pedido)) s.enCamion++;
    m.set(k, s);
  });
  return [...m.values()].map(s => ({ ...s, pct: S.capacidad > 0 ? s.ton / S.capacidad : 0, aj: ajuste(s.ton, s.cams) })).sort((a, b) => b.ton - a.ton);
}

/* ════════════════════════════════════════════════════════════════════════
   MAPA
   ════════════════════════════════════════════════════════════════════════ */
function crearMapa() {
  map = L.map($('#cc-map'), { zoomControl: true }).setView([S.centro.lat, S.centro.lon], 11);
  L.tileLayer(CFG.tiles, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  capaRuta = L.layerGroup().addTo(map);
  capaPedidos = L.layerGroup().addTo(map);
  capaTmp = L.layerGroup().addTo(map);
  initLazo();
}
function reiniciarMapa() {
  if (!map) crearMapa();
  capaPedidos.clearLayers(); capaRuta.clearLayers(); capaTmp.clearLayers(); marcadores.clear(); firmas.clear(); tmpMarkers.clear();
  if (hubMarker) hubMarker.remove();
  hubMarker = L.marker([S.centro.lat, S.centro.lon], {
    icon: L.divIcon({ className: 'cc-pin-wrap', html: `<div class="cc-hub">${SVG.hub}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 2000, keyboard: false,
  }).addTo(map).bindTooltip(`<div class="cc-tt-h">${esc(S.centro.nombre)}</div><div class="cc-tt-r">Centro ${esc(S.centro.id)} · ${esc(S.grupo)}</div>`, { className: 'cc-tt', direction: 'top', offset: [0, -16] });
  if (S.editGeo) { S.editGeo = false; $('#cc-btn-geo').classList.remove('is-on'); }
  setTimeout(() => { map.invalidateSize(); ajustarVista(); }, 0);
}
function ajustarVista() {
  const pts = S.pedidos.filter(p => tieneGeo(p) && visible(p)).map(p => [p.latitud, p.longitud]);
  pts.push([S.centro.lat, S.centro.lon]);
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 }); else map.setView(pts[0], 11);
}
function iconoPedido(p) {
  const ev = p._estado, sel = S.camion.has(p.id_pedido);
  const badge = sel ? `<span class="cc-pin-badge">${S.rutaOrden.get(p.id_pedido) || '•'}</span>` : '';
  const cls = `cc-pin ${ev}${sel ? ' sel' : ''}${esRetiro(p) ? ' ret' : ''}${p.geoExacta ? '' : ' aprox'}${S.editGeo && !p.geoExacta ? ' drag' : ''}`;
  return { firma: cls + badge, icon: L.divIcon({ className: 'cc-pin-wrap', html: `<div class="${cls}" data-id="${esc(p.id_pedido)}">${SVG[ev]}${badge}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) };
}
function tooltipPedido(p) {
  const sel = S.camion.has(p.id_pedido), c = puedeCargar(p);
  const acc = S.editGeo && !p.geoExacta ? 'Arrastre al punto de la obra y guarde' : sel ? 'Clic para quitar de la selección' : c.ok ? 'Clic para sumar a la selección' : c.razon === 'retiro' ? 'Clic para forzar inclusión' : 'No consolidable';
  const nh = habilitado(p) ? '' : `<span class="cc-tag rd">${esc(S.tipo)} no habilitado</span>`;
  return `<div class="cc-tt-h"><span class="cc-dot ${p._estado}"></span><span class="mono">${esc(p.id_pedido)}</span><span class="cc-cond${esRetiro(p) ? ' ret' : ''}">${esc(p.condicion_exp)}</span></div>
    <div class="cc-tt-r"><b>${esc(p.cliente)}</b><br>${esc(p.direccion || '—')}<br>${esc(p.comuna)} · ruta ${esc(p.rutaCodigo || '—')} · obra ${esc(p.id_obra)}<br><b class="num">${fT(peso(p))} t</b> · Match ${fP(p._m.pct)} · F. entrega ${fechaTxt(p.fecha)}</div>
    <div class="cc-tt-r" style="margin-top:3px">${p._motivos.map(m => `<span class="cc-tag ${m.t}">${esc(m.txt)}</span>`).join(' ')} ${nh}${p.geoExacta ? '' : ' <span class="cc-tag gy">Ubicación aprox. (ruta)</span>'}</div>
    <div class="cc-tt-f">${acc}</div>`;
}
function renderMarcadores() {
  S.pedidos.forEach(p => {
    const id = p.id_pedido;
    let mk = marcadores.get(id);
    if (!tieneGeo(p)) { if (mk) { capaPedidos.removeLayer(mk); marcadores.delete(id); firmas.delete(id); } return; }
    const { firma, icon } = iconoPedido(p);
    if (!mk) {
      mk = L.marker([p.latitud, p.longitud], { icon, riseOnHover: true, draggable: false });
      mk.on('click', () => { if (S.editGeo && !p.geoExacta) { mk.openPopup(); return; } toggleCamion(id); });
      mk.on('mouseover', () => hlFila(id, true));
      mk.on('mouseout', () => hlFila(id, false));
      mk.on('dragend', () => { mk._movido = true; mk.openPopup(); });
      mk.bindTooltip(() => tooltipPedido(p), { className: 'cc-tt', direction: 'top', offset: [0, -14] });
      marcadores.set(id, mk); firmas.set(id, firma);
    } else if (firmas.get(id) !== firma) { mk.setIcon(icon); firmas.set(id, firma); }
    const arrastrable = S.editGeo && !p.geoExacta;
    if (arrastrable && !mk.getPopup()) mk.bindPopup(() => popupGeo(p, mk), { minWidth: 240 });
    if (!arrastrable && mk.getPopup()) mk.unbindPopup();
    if (mk.dragging) { if (arrastrable) mk.dragging.enable(); else mk.dragging.disable(); }
    mk.setZIndexOffset(S.camion.has(id) ? 1000 : p._estado === 'bloq' ? -200 : 0);
    const vis = visible(p);
    if (vis && !capaPedidos.hasLayer(mk)) capaPedidos.addLayer(mk);
    if (!vis && capaPedidos.hasLayer(mk)) capaPedidos.removeLayer(mk);
  });
}
function renderRuta(orden) {
  capaRuta.clearLayers();
  if (!orden.length) return;
  const c = [S.centro.lat, S.centro.lon];
  const pts = [c, ...orden.map(p => [p.latitud, p.longitud]), c];
  const col = { parcial: '#2563eb', completo: '#16a34a', exceso: '#dc2626' }[S.nivel] || '#191c1d';
  L.polyline(pts, { color: '#fff', weight: 6, opacity: .8, interactive: false }).addTo(capaRuta);
  L.polyline(pts, { color: col, weight: 3, opacity: .9, dashArray: '7 6', interactive: false }).addTo(capaRuta);
}
function pinDe(id) { const mk = marcadores.get(id); return mk && mk.getElement() ? mk.getElement().querySelector('.cc-pin') : null; }
function hlPin(ids, on) { ids.forEach(id => { const el = pinDe(id); if (el) el.classList.toggle('hl', on); }); }
function hlFila(id, on) { const tr = root.querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (tr) tr.classList.toggle('is-hl', on); }
function verEnMapa(id) {
  const p = S.byId.get(id);
  if (!tieneGeo(p)) { activarEdicion(true); const mk = tmpMarkers.get(p.id_obra); if (mk) { map.setView(mk.getLatLng(), 14); mk.openPopup(); } return; }
  if (!visible(p)) { S.cond.add(p.condicion_exp); renderCond(); renderTodo(); }
  map.setView([p.latitud, p.longitud], Math.max(map.getZoom(), 14));
  const mk = marcadores.get(id);
  setTimeout(() => { if (mk) mk.openTooltip(); hlPin([id], true); setTimeout(() => hlPin([id], false), 1400); }, 260);
}

/* ── Lazo ── */
function initLazo() {
  const el = map.getContainer();
  let pts = null, poly = null;
  const dentro = (pt, pol) => { let c = false; for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) { const a = pol[i], b = pol[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  el.addEventListener('pointerdown', e => {
    if (!S.lazo || e.button !== 0 || e.target.closest('.leaflet-control,.leaflet-popup')) return;
    pts = [map.mouseEventToContainerPoint(e)];
    poly = L.polygon([map.containerPointToLatLng(pts[0])], { color: '#b5000b', weight: 2, dashArray: '5 5', fillColor: '#b5000b', fillOpacity: .08, interactive: false }).addTo(map);
    try { el.setPointerCapture(e.pointerId); } catch (_e) { /* */ }
    e.preventDefault(); e.stopPropagation();
  }, true);
  el.addEventListener('pointermove', e => {
    if (!pts) return;
    const cp = map.mouseEventToContainerPoint(e), last = pts[pts.length - 1];
    if (Math.abs(cp.x - last.x) + Math.abs(cp.y - last.y) < 4) return;
    pts.push(cp); poly.setLatLngs(pts.map(p => map.containerPointToLatLng(p))); e.stopPropagation();
  }, true);
  const fin = e => {
    if (!pts) return;
    e.stopPropagation();
    const pol = pts; pts = null; map.removeLayer(poly); poly = null;
    if (pol.length < 3) return;
    agregarVarios(S.pedidos.filter(p => tieneGeo(p) && visible(p) && dentro(map.latLngToContainerPoint([p.latitud, p.longitud]), pol)).map(p => p.id_pedido), 'Lazo');
  };
  el.addEventListener('pointerup', fin, true);
  el.addEventListener('pointercancel', fin, true);
}
function activarLazo(on) {
  S.lazo = on;
  $('#cc-btn-lazo').classList.toggle('is-on', on);
  $('#cc-mapwrap').classList.toggle('is-lazo', on);
  if (on) { map.dragging.disable(); if (S.editGeo) activarEdicion(false); } else map.dragging.enable();
  hint();
}

/* ── Georreferenciación de obras (tabla obras_georef) ── */
const obrasPendientes = () => { const m = new Map(); S.pedidos.forEach(p => { if (visible(p) && !p.geoExacta && p.id_obra && !m.has(p.id_obra)) m.set(p.id_obra, p); }); return [...m.values()]; };
async function guardarCoordenadasObra(idObra, lat, lng, direccion) {
  const payload = { id_obra: idObra, lat: +(+lat).toFixed(6), lon: +(+lng).toFixed(6), direccion: direccion || null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from(CFG.tablaGeo).upsert(payload, { onConflict: 'id_obra' });
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? `Falta crear la tabla ${CFG.tablaGeo} en Supabase.` : error.message);
  return payload;
}
function activarEdicion(on) {
  if (on && !S.raw.geoOk) { toast('err', 'Georreferenciación no disponible', `Falta crear la tabla ${CFG.tablaGeo} en Supabase.`); return; }
  if (on && !can('editar')) { toast('warn', 'Sin permiso de edición', 'Su perfil no puede guardar coordenadas de obra.'); return; }
  S.editGeo = on;
  $('#cc-btn-geo').classList.toggle('is-on', on);
  if (on && S.lazo) activarLazo(false);
  capaTmp.clearLayers(); tmpMarkers.clear();
  // Al salir, los pines movidos y no guardados vuelven a su punto
  if (!on) S.pedidos.forEach(p => { const mk = marcadores.get(p.id_pedido); if (mk && tieneGeo(p)) { mk._movido = false; mk.closePopup(); mk.setLatLng([p.latitud, p.longitud]); } });
  if (on) {
    // Obras sin ninguna coordenada (sin ruta en el maestro): marcador temporal junto al centro
    const sinPunto = obrasPendientes().filter(p => !tieneGeo(p));
    sinPunto.forEach((p, i) => {
      const mk = L.marker([S.centro.lat + .012 * Math.cos(i * 0.9), S.centro.lon + .015 * Math.sin(i * 0.9)], {
        draggable: true, autoPan: true, zIndexOffset: 3000,
        icon: L.divIcon({ className: 'cc-pin-wrap', html: `<div class="cc-pin edit">${SVG.pin}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      });
      mk.bindPopup(() => popupGeo(p, mk), { minWidth: 240 });
      mk.on('dragend', () => { mk._movido = true; mk.openPopup(); });
      mk.addTo(capaTmp); tmpMarkers.set(p.id_obra, mk);
    });
  }
  renderTodo();
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
  b.className = 'cc-btn pri sm'; b.innerHTML = '<span class="material-symbols-outlined">save</span>Guardar coordenadas';
  b.disabled = !mk._movido;
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Guardando…';
    const pos = mk.getLatLng();
    try {
      const r = await guardarCoordenadasObra(p.id_obra, pos.lat, pos.lng, p.direccion);
      S.raw.geo.set(p.id_obra, { lat: r.lat, lon: r.lon });
      S.pedidos.forEach(x => { if (x.id_obra === p.id_obra) { x.latitud = r.lat; x.longitud = r.lon; x.geoExacta = true; } });
      if (tmpMarkers.has(p.id_obra)) { capaTmp.removeLayer(tmpMarkers.get(p.id_obra)); tmpMarkers.delete(p.id_obra); }
      ped.forEach(id => { const m2 = marcadores.get(id); if (m2) { m2.closePopup(); m2.setLatLng([r.lat, r.lon]); } });
      mk.closePopup();
      toast('ok', `Obra ${p.id_obra} georreferenciada`, `${ped.length} pedido${ped.length > 1 ? 's' : ''} con ubicación exacta.`);
      renderTodo();
    } catch (err) {
      b.disabled = false; b.innerHTML = '<span class="material-symbols-outlined">save</span>Reintentar';
      toast('err', 'No se pudo guardar', err.message || String(err));
    }
  };
  d.appendChild(b);
  return d;
}
function hint() {
  const h = $('#cc-maphint');
  if (S.lazo) { h.innerHTML = '<span class="material-symbols-outlined">gesture</span>Lazo activo: mantenga presionado y dibuje el área'; h.classList.add('show'); }
  else if (S.editGeo) { h.innerHTML = `<span class="material-symbols-outlined">edit_location_alt</span>Modo edición: arrastre los pines de borde punteado (${obrasPendientes().length} obras) y guarde`; h.classList.add('show'); }
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
  $('#cc-centro-lbl').textContent = `${S.centro.nombre} · ${S.grupo} · Pedidos venta sucursal × entregas`;
}
function renderTrucks() {
  $('#cc-trucks').innerHTML = S.camiones.map(c => `<button data-cap="${c.capKg}" class="${!S.manual && S.capKg === c.capKg ? 'is-on' : ''}" title="${esc(c.tipo)} · habilitado en ${c.rutas} rutas de ${esc(S.grupo)}">${esc(c.tipo.replace(/^Camión\s*/i, ''))}</button>`).join('') +
    `<label data-tipo="__manual" class="${S.manual ? 'is-on' : ''}" title="Capacidad objetivo manual en toneladas"><span class="cc-manual">Manual <input id="cc-man" type="number" min="0.5" step="0.5" value="${S.manual ? S.capacidad : ''}" placeholder="t"> t</span></label>`;
}
function renderCond() {
  $('#cc-cond').innerHTML = S.condTodas.map(c => {
    const n = S.pedidos.filter(p => p.condicion_exp === c).length;
    return `<button class="cc-chip${S.cond.has(c) ? ' is-on' : ''}" data-cond="${esc(c)}" title="${/DESP/i.test(c) ? 'Despacho' : 'Retiro: visible pero requiere forzado manual para sumar'}">${esc(c)} <span class="mono" style="opacity:.7">${n}</span></button>`;
  }).join('');
}
function renderBarra() {
  const tot = totalCamion(), cap = S.capacidad, pct = cap > 0 ? tot / cap : 0, nivel = nivelDe(tot, cap);
  const acc = $('#cc-acc');
  acc.className = `cc-acc lv-${nivel}`;
  $('#cc-acc-ton').innerHTML = `${fT(tot)} <small>/ ${fT(cap)} t</small>`;
  $('#cc-acc-pct').textContent = Math.round(pct * 100) === 100 && Math.abs(pct - 1) > 1e-9 ? `${(pct * 100).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : fP(pct);
  $('#cc-fill').style.width = `${Math.min(pct, 1) * 100}%`;
  $('#cc-overfill').style.width = `${pct > 1 ? Math.min((pct - 1) / CFG.zonaSobrecarga, 1) * 100 : 0}%`;
  const ST = { vacio: ['inventory_2', 'Sin selección'], parcial: ['pending', 'Carga parcial'], completo: ['check_circle', 'Camión completo · Listo para ruta'], exceso: ['error', `Exceso de peso · Sobrecarga +${fT(tot - cap)} t`] };
  $('#cc-status').innerHTML = `<span class="material-symbols-outlined">${ST[nivel][0]}</span><span>${ST[nivel][1]}</span>`;
  const ids = [...S.camion].map(id => S.byId.get(id));
  const adv = ids.filter(p => p._estado === 'desc').length, fz = ids.filter(esRetiro).length, nogeo = ids.filter(p => !p.geoExacta).length;
  const nohab = [...new Set(ids.filter(p => !habilitado(p)).map(p => p.comuna))];
  const rutasSel = [...new Set(ids.map(p => p.rutaCodigo))];
  const camsSel = S.camiones.filter(t => rutasSel.every(r => { const cs = S.rutasHab.get(r); return cs && cs.has(t.capKg); }));
  const aj = ajuste(tot, camsSel);
  const meta = [
    `<span><span class="material-symbols-outlined">local_shipping</span><b>${esc(S.tipo)}</b></span>`,
    `<span><span class="material-symbols-outlined">receipt_long</span><b>${S.camion.size}</b> pedidos</span>`,
    nivel === 'exceso' ? `<span style="color:var(--cc-red-ink)"><span class="material-symbols-outlined">scale</span>Sobran <b style="color:inherit">${fT(tot - cap)} t</b></span>` : `<span><span class="material-symbols-outlined">scale</span>Disponible <b>${fT(Math.max(cap - tot, 0))} t</b></span>`,
  ];
  if (aj && !(aj.tipo === 'completa' && aj.c.capKg === S.capKg)) meta.push(`<span title="Camión habilitado en todas las rutas seleccionadas que mejor se ajusta"><span class="material-symbols-outlined">swap_horiz</span>${ajusteTxt(aj)}</span>`);
  if (S.rutaKm) meta.push(`<span title="Vecino más cercano desde el centro, línea recta, ida y regreso"><span class="material-symbols-outlined">route</span>≈ <b>${fT(S.rutaKm, 1)} km</b> ref.</span>`);
  if (adv) meta.push(`<span class="cc-tag am">${adv} con advertencia</span>`);
  if (fz) meta.push(`<span class="cc-tag fz">${fz} retiro forzado</span>`);
  if (nogeo) meta.push(`<span class="cc-tag gy">${nogeo} ubicación aprox.</span>`);
  if (nohab.length) meta.push(`<span class="cc-tag rd" title="${esc(nohab.join(', '))}">${esc(S.tipo)} no habilitado en ${nohab.length} comuna${nohab.length > 1 ? 's' : ''}</span>`);
  if (S.base === 'entrega') meta.push('<span class="cc-tag bl">Peso según entrega</span>');
  $('#cc-acc-meta').innerHTML = meta.join('');
  $('#cc-btn-vaciar').disabled = !S.camion.size;
  if (nivel !== S.nivel) {
    if (nivel === 'completo') toast('ok', 'Camión completo / Listo para ruta', `${fT(tot)} de ${fT(cap)} t (${fP(pct)}) en ${S.tipo}.`);
    if (nivel === 'exceso') toast('err', 'Exceso de peso / Sobrecarga', `Sobran ${fT(tot - cap)} t sobre ${fT(cap)} t de ${S.tipo}.`);
    if (nivel === 'completo' || nivel === 'exceso') { acc.classList.remove('is-pulse'); void acc.offsetWidth; acc.classList.add('is-pulse'); }
    S.nivel = nivel;
  }
}
function renderPanel() {
  const secs = sectores();
  S.sectoresCompletos = secs.filter(s => s.hab && s.pct >= CFG.umbralCompleto).length;
  $('#cc-tab-c1').textContent = S.camion.size;
  const c2 = $('#cc-tab-c2'); c2.textContent = S.sectoresCompletos; c2.classList.toggle('g', S.sectoresCompletos > 0);
  root.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('is-on', t.dataset.tab === S.tab));
  const pane = $('#cc-pane');
  if (S.tab === 'camion') {
    const lista = [...S.camion].map(id => S.byId.get(id)).sort((a, b) => (S.rutaOrden.get(a.id_pedido) || 999) - (S.rutaOrden.get(b.id_pedido) || 999));
    let h = '';
    if (!lista.length) h += '<div class="cc-empty"><span class="material-symbols-outlined">touch_app</span>Haga clic en los pines, use el <b>Lazo</b> o marque pedidos en la tabla para ver cómo completan el camión.</div>';
    else {
      h += `<div class="cc-sec-t"><span>Orden de visita referencial</span><span>${lista.length} · ${fT(totalCamion())} t</span></div>`;
      h += lista.map(p => {
        const n = S.rutaOrden.get(p.id_pedido);
        return `<div class="cc-li" data-id="${esc(p.id_pedido)}"><span class="cc-li-n${n ? '' : ' nogeo'}">${n || '–'}</span>
          <div style="min-width:0"><div class="cc-li-id"><span class="cc-dot ${p._estado}"></span>${esc(p.id_pedido)}${esRetiro(p) ? '<span class="cc-tag fz">Forzado</span>' : ''}</div>
          <div class="cc-li-sub">${habilitado(p) ? '' : '<span style="color:var(--cc-red-ink)">No habilitado · </span>'}${esc(p.cliente)} · ${esc(p.comuna)}</div></div>
          <span class="cc-li-t num">${fT(peso(p))} t</span><button class="cc-x" data-act="quitar" title="Quitar de la selección"><span class="material-symbols-outlined">close</span></button></div>`;
      }).join('');
    }
    const sug = sugeridos();
    if (sug.length) {
      h += `<div class="cc-sec-t"><span>Sugeridos para completar</span><span>≤ ${fT(S.capacidad - totalCamion())} t</span></div>`;
      h += sug.map(({ p, d, completa }) => `<div class="cc-li" data-id="${esc(p.id_pedido)}"><span class="cc-li-n" style="background:var(--cc-s3);color:var(--cc-ink3)">+</span>
        <div style="min-width:0"><div class="cc-li-id"><span class="cc-dot ${p._estado}"></span>${esc(p.id_pedido)}${completa ? '<span class="cc-tag gr">Completa</span>' : ''}</div>
        <div class="cc-li-sub">${esc(p.cliente)} · ${esc(p.comuna)} · a ${fT(d, 1)} km</div></div>
        <span class="cc-li-t num">${fT(peso(p))} t</span><button class="cc-x" data-act="agregar" title="Sumar a la selección"><span class="material-symbols-outlined">add_circle</span></button></div>`).join('');
    }
    pane.innerHTML = h;
  } else {
    const tot = secs.reduce((a, s) => a + s.ton, 0);
    let h = `<div class="cc-sum"><div><b>${secs.length}</b><span>rutas</span></div><div><b>${fT(tot, 1)}</b><span>t consolidables</span></div><div><b>${fT(S.capacidad > 0 ? tot / S.capacidad : 0, 1)}</b><span>camiones eq.</span></div></div>`;
    h += `<div class="cc-sec-t"><span>Por ruta · objetivo ${esc(S.tipo)}</span><span>${S.sectoresCompletos} completo${S.sectoresCompletos === 1 ? '' : 's'}</span></div>`;
    if (!secs.length) h += '<div class="cc-empty">Sin pedidos consolidables con los filtros actuales.</div>';
    h += secs.map(s => {
      const lv = !s.hab ? 'nohab' : s.pct > 1 ? 'exceso' : s.pct >= CFG.umbralCompleto ? 'completo' : 'parcial';
      const tag = lv === 'nohab' ? '<span class="cc-tag rd">No habilitado</span>' : lv === 'exceso' ? `<span class="cc-tag gr">≥ 1 camión · x${fT(s.pct, 1)}</span>` : lv === 'completo' ? '<span class="cc-tag gr">Completa camión</span>' : `<span class="cc-tag bl">${fP(s.pct)}</span>`;
      const ajTxt = !s.cams.length ? `<span style="color:var(--cc-red-ink)">Ruta sin tarifa vigente en ${esc(S.grupo)}</span>` : ajusteTxt(s.aj);
      const camsTxt = s.cams.length && s.cams.length !== S.camiones.length ? 'Sólo ' + s.cams.map(c => c.tipo.replace(/^Camión\s*/i, '')).join(' · ') : '';
      return `<div class="cc-sector lv-${lv}" data-sector="${esc(s.key)}">
        <div class="cc-sector-h"><b>${esc(s.comuna)}</b><span class="mono" style="font-size:10.5px;color:var(--cc-ink2)">${esc(s.key)}</span>${tag}</div>
        <div class="cc-mini"><i style="width:${Math.min(s.pct, 1) * 100}%"></i></div>
        <div class="cc-sector-aj"><span>${ajTxt}</span>${camsTxt ? `<span class="cc-sector-cams">${esc(camsTxt)}</span>` : ''}</div>
        <div class="cc-sector-f"><span><b class="num" style="color:var(--cc-ink)">${fT(s.ton)} t</b> · ${s.n} ped.${s.enCamion ? ` · ${s.enCamion} en selección` : ''}</span>
        <button class="cc-btn sm" data-act="sector" ${s.n - s.enCamion ? '' : 'disabled'} title="Sumar los pedidos de la ruta a la selección"><span class="material-symbols-outlined">add</span>Simular</button></div></div>`;
    }).join('');
    pane.innerHTML = h;
  }
}
function filasTabla() {
  const q = S.q.trim().toLowerCase(), hoy = hoyKey();
  const rows = S.pedidos.filter(p => {
    if (!visible(p)) return false;
    if (q && ![p.id_pedido, p.id_obra, p.cliente, p.comuna, p.direccion, p.rutaCodigo].some(x => String(x || '').toLowerCase().includes(q))) return false;
    switch (S.fEstado) {
      case 'ok': case 'desc': case 'bloq': return p._estado === S.fEstado;
      case 'nogeo': return !p.geoExacta;
      case 'camion': return S.camion.has(p.id_pedido);
      case 'nohab': return !habilitado(p);
      case 'vencido': return p.fecha && p.fecha < hoy;
      default: return true;
    }
  });
  const ord = { ok: 0, desc: 1, bloq: 2 };
  const key = { estado: p => ord[p._estado], id: p => p.id_pedido, obra: p => p.id_obra, cliente: p => p.cliente, cond: p => p.condicion_exp, comuna: p => p.comuna, fecha: p => p.fecha || '9999', ton: p => peso(p), match: p => p._m.pct }[S.orden.col];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * S.orden.dir || a.id_pedido.localeCompare(b.id_pedido); });
  return rows;
}
function renderTabla() {
  const rows = filasTabla(), hoy = hoyKey();
  $('#cc-tbody').innerHTML = rows.map(p => {
    const id = p.id_pedido, sel = S.camion.has(id), c = puedeCargar(p), m = p._m;
    const mCls = m.sinEntrega ? 'none' : m.cuadra ? 'ok' : 'bad';
    const mTxt = p._estado === 'bloq' ? '—' : m.sinEntrega ? 'Sin entrega' : m.cuadra ? '100%' : `${fP(m.pct)} · ${m.difs.length} dif.`;
    const tags = [];
    if (p._estado === 'desc') tags.push(`<span class="cc-tag am" title="${esc(p._motivos.map(x => x.txt).join(' · '))}">${esc(p._motivos[0].txt)}${p._motivos.length > 1 ? ` +${p._motivos.length - 1}` : ''}</span>`);
    if (p._estado === 'bloq') tags.push(`<span class="cc-tag rd">${esc(p.codigo_bloqueo)}</span>`);
    if (!p.geoExacta) tags.push(`<span class="cc-tag gy" title="${tieneGeo(p) ? 'Ubicada en el punto de la ruta' : 'Sin ubicación'}">${tieneGeo(p) ? 'Aprox.' : 'Sin ubic.'}</span>`);
    if (esRetiro(p) && S.forzados.has(id)) tags.push('<span class="cc-tag fz">Forzado</span>');
    const nh = habilitado(p) ? '' : ` <span class="cc-tag rd" title="${esc(S.tipo)} no habilitado en la ruta ${esc(p.rutaCodigo || '—')}">No hab.</span>`;
    const venc = p.fecha && p.fecha < hoy;
    return `<tr data-id="${esc(id)}" class="${sel ? 'is-sel' : ''}">
      <td><input type="checkbox" data-act="chk" ${sel ? 'checked' : ''} ${p._estado === 'bloq' ? 'disabled' : ''} title="${esc(c.ok || sel ? (sel ? 'Quitar de la selección' : 'Sumar a la selección') : c.msg)}"></td>
      <td><span class="cc-est"><span class="cc-dot ${p._estado}"></span>${ESTADO_TXT[p._estado]}</span> ${tags.join(' ')}</td>
      <td class="mono">${esc(id)}</td>
      <td class="mono">${esc(p.id_obra)}</td>
      <td class="cc-td-cli" title="${esc(p.cliente)}">${esc(p.cliente)}</td>
      <td><span class="cc-cond${esRetiro(p) ? ' ret' : ''}">${esc(p.condicion_exp)}</span></td>
      <td>${esc(p.comuna)}${nh}</td>
      <td class="mono${venc ? ' cc-venc' : ''}" title="${venc ? 'Fecha de entrega vencida' : ''}">${fechaTxt(p.fecha)}</td>
      <td class="r mono">${fT(peso(p))}</td>
      <td><span class="cc-match ${mCls}"><span class="cc-mini"><i style="width:${m.pct * 100}%"></i></span><span>${mTxt}</span></span></td>
      <td><div class="cc-acts">
        <button class="cc-ib" data-act="ver" title="${tieneGeo(p) ? 'Ver en mapa' : 'Georreferenciar obra'}"><span class="material-symbols-outlined">${tieneGeo(p) ? 'my_location' : 'edit_location_alt'}</span></button>
        <button class="cc-ib" data-act="detalle" title="Detalle posiciones vs entregas"><span class="material-symbols-outlined">fact_check</span></button>
        ${esRetiro(p) ? `<button class="cc-ib${S.forzados.has(id) ? ' on' : ''}" data-act="forzar" title="${S.forzados.has(id) ? 'Quitar forzado' : 'Forzar inclusión del retiro'}"><span class="material-symbols-outlined">${S.forzados.has(id) ? 'lock_open' : 'input'}</span></button>` : ''}
      </div></td></tr>`;
  }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--cc-ink2);padding:24px">Sin pedidos para los filtros actuales.</td></tr>';
  const elig = rows.filter(p => puedeCargar(p).ok || S.camion.has(p.id_pedido));
  const all = $('#cc-chk-all'), nSel = elig.filter(p => S.camion.has(p.id_pedido)).length;
  all.checked = elig.length > 0 && nSel === elig.length; all.indeterminate = nSel > 0 && nSel < elig.length; all.disabled = !elig.length;
  $('#cc-tbar-s').textContent = `${rows.length} de ${S.pedidos.length} pedidos con pendiente · ${fT(rows.reduce((a, p) => a + peso(p), 0), 1)} t`;
  root.querySelectorAll('.cc-t th.sort').forEach(th => {
    th.querySelector('.material-symbols-outlined')?.remove();
    if (th.dataset.col === S.orden.col) th.insertAdjacentHTML('beforeend', `<span class="material-symbols-outlined">${S.orden.dir > 0 ? 'arrow_upward' : 'arrow_downward'}</span>`);
  });
  $('#cc-geo-cnt').textContent = obrasPendientes().length;
}
function renderTodo() {
  const orden = calcRuta();
  renderBarra(); renderMarcadores(); renderRuta(orden); renderPanel(); renderTabla(); hint();
}
function abrirDetalle(id) {
  const p = S.byId.get(id), m = p._m, hoy = hoyKey();
  const filas = p.posiciones.filter(x => x.pendiente > 0).map(x => {
    const dif = x.bloqueo ? null : x.entTrat - x.pendiente;
    return `<tr class="${x.bloqueo ? 'blq' : dif ? 'bad' : ''}"><td class="mono">${esc(x.pos)}</td><td class="mono">${esc(x.sku)}</td><td>${esc(x.descripcion)}${x.sospechoso ? ' <span class="cc-tag am">Peso sospechoso</span>' : ''}</td>
      <td class="r mono">${fT(x.cantidad, 0)} ${esc(x.um)}</td><td class="r mono">${fT(x.pendiente, 0)}</td><td class="r mono">${fT(x.entTrat, 0)}</td>
      <td class="mono">${x.entregas.map(esc).join(', ') || '—'}</td><td class="r mono">${fT(x.pendiente * x.kgUnit / 1000, 3)}</td>
      <td class="mono${x.fecha && x.fecha < hoy ? ' cc-venc' : ''}">${fechaTxt(x.fecha)}</td><td>${x.bloqueo ? `<span class="cc-tag rd">${esc(x.bloqueo)}</span>` : ''}</td></tr>`;
  }).join('');
  $('#cc-modal-c').innerHTML = `
    <div class="cc-modal-h"><div style="flex:1"><h3>${esc(p.id_pedido)} <span class="cc-cond${esRetiro(p) ? ' ret' : ''}">${esc(p.condicion_exp)}</span></h3>
      <p><b>${esc(p.cliente)}</b> (${esc(p.solic)})${p.interlocutor ? ' · ' + esc(p.interlocutor) : ''}</p><p>${esc(p.direccion || '—')} · ${esc(p.comuna)} · ruta ${esc(p.rutaCodigo || '—')} ${esc(p.rutaDesc)}</p>
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${p._motivos.map(x => `<span class="cc-tag ${x.t}">${esc(x.txt)}</span>`).join('')}</div></div>
      <button class="cc-x" data-act="cerrar-modal"><span class="material-symbols-outlined">close</span></button></div>
    <div class="cc-modal-b">
      <div class="cc-kv">
        <div><span>Obra</span><b class="mono">${esc(p.id_obra)}</b></div>
        <div><span>Clase / creado</span><b>${esc(p.clase)} · ${fechaTxt(p.creado)}</b></div>
        <div><span>Ton pendiente</span><b class="num">${fT(p._ton, 3)}</b></div>
        <div><span>Ton en entregas</span><b class="num">${fT(m.tonEnt, 3)}</b></div>
        <div><span>Match</span><b>${m.sinEntrega ? 'Sin entrega' : fP(m.pct)}</b></div>
        <div><span>F. entrega</span><b>${fechaTxt(p.fecha)}</b></div>
        <div><span>Ubicación</span><b>${p.geoExacta ? 'Obra georreferenciada' : tieneGeo(p) ? 'Aprox. (ruta)' : 'Sin ubicación'}</b></div>
        <div><span>Camión ${esc(S.tipo)}</span><b>${habilitado(p) ? 'Habilitado' : 'No habilitado'}</b></div>
      </div>
      <div style="overflow:auto"><table><thead><tr><th>Pos</th><th>Material</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Pendiente</th><th class="r">En entrega</th><th>Entrega(s)</th><th class="r">Ton pend.</th><th>F. entrega</th><th>Bloqueo</th></tr></thead><tbody>${filas}</tbody></table></div>
    </div>`;
  $('#cc-modal').classList.add('show');
}
function toast(tipo, titulo, texto, accion) {
  const ic = { ok: 'check_circle', err: 'error', warn: 'warning', info: 'info' }[tipo] || 'info';
  const el = document.createElement('div');
  el.className = `cc-toast ${tipo}`;
  el.innerHTML = `<span class="material-symbols-outlined">${ic}</span><div><b>${esc(titulo)}</b>${texto ? `<p>${esc(texto)}</p>` : ''}</div><div class="cc-toast-acts"><button class="cc-x" title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>`;
  const cerrar = () => el.remove();
  el.querySelector('.cc-x').onclick = cerrar;
  if (accion) { const b = document.createElement('button'); b.className = 'cc-btn sm'; b.textContent = accion.txt; b.onclick = () => { cerrar(); accion.fn(); }; el.querySelector('.cc-toast-acts').appendChild(b); }
  const box = document.getElementById('cc-toasts');
  if (!box) return;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(cerrar, accion ? 8000 : 4800);
}

/* ════════════════════════════════════════════════════════════════════════
   EVENTOS
   ════════════════════════════════════════════════════════════════════════ */
function bindEventos() {
  $('#cc-suc').addEventListener('change', e => setSucursal(e.target.value, true));
  $('#cc-trucks').addEventListener('click', e => {
    const b = e.target.closest('button,label'); if (!b) return;
    if (b.dataset.tipo === '__manual') {
      const v = parseFloat(String($('#cc-man').value).replace(',', '.'));
      if (e.target.id !== 'cc-man' && v > 0 && !S.manual) setCamion(`Manual ${fT(v, 1)} t`, v, true);
      return;
    }
    const c = S.camiones.find(x => x.capKg === +b.dataset.cap);
    if (c) setCamion(c.tipo, c.capKg / 1000, false);
  });
  $('#cc-trucks').addEventListener('change', e => {
    if (e.target.id !== 'cc-man') return;
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (!(v > 0)) { toast('warn', 'Capacidad inválida', 'Ingrese toneladas mayores a 0.'); return; }
    setCamion(`Manual ${fT(v, 1)} t`, v, true);
  });
  $('#cc-base').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.base = b.dataset.base;
    root.querySelectorAll('#cc-base button').forEach(x => x.classList.toggle('is-on', x === b));
    renderTodo();
  });
  $('#cc-cond').addEventListener('click', e => {
    const b = e.target.closest('[data-cond]'); if (!b) return;
    const c = b.dataset.cond;
    if (S.cond.has(c)) S.cond.delete(c); else S.cond.add(c);
    renderCond(); renderTodo();
  });
  $('#cc-btn-lazo').onclick = () => activarLazo(!S.lazo);
  $('#cc-btn-geo').onclick = () => activarEdicion(!S.editGeo);
  $('#cc-btn-vaciar').onclick = () => { S.camion.clear(); renderTodo(); };
  $('#cc-btn-reload').onclick = () => recargar();
  $('#cc-tabs').addEventListener('click', e => { const t = e.target.closest('.cc-tab'); if (t) { S.tab = t.dataset.tab; renderPanel(); } });
  const pane = $('#cc-pane');
  pane.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    if (b.dataset.act === 'quitar') { S.camion.delete(id); renderTodo(); }
    if (b.dataset.act === 'agregar') agregar(id);
    if (b.dataset.act === 'sector') {
      const s = b.closest('[data-sector]').dataset.sector;
      agregarVarios(S.pedidos.filter(p => (p.rutaCodigo || '—') === s && S.cond.has(p.condicion_exp)).map(p => p.id_pedido), `Ruta ${s}`);
    }
  });
  const hlSec = (e, on) => {
    const li = e.target.closest('[data-id]'); if (li) { hlPin([li.dataset.id], on); return; }
    const s = e.target.closest('[data-sector]'); if (s) hlPin(S.pedidos.filter(p => (p.rutaCodigo || '—') === s.dataset.sector).map(p => p.id_pedido), on);
  };
  pane.addEventListener('mouseover', e => hlSec(e, true));
  pane.addEventListener('mouseout', e => hlSec(e, false));
  pane.addEventListener('dblclick', e => { const li = e.target.closest('[data-id]'); if (li) verEnMapa(li.dataset.id); });
  const tb = $('#cc-tbody');
  tb.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'chk') { e.preventDefault(); toggleCamion(id); return; }
    if (act === 'ver') { verEnMapa(id); return; }
    if (act === 'detalle') { abrirDetalle(id); return; }
    if (act === 'forzar') {
      const on = !S.forzados.has(id);
      if (on) S.forzados.add(id); else { S.forzados.delete(id); S.camion.delete(id); }
      toast(on ? 'warn' : 'info', on ? `${id} forzado a despacho` : `Forzado retirado en ${id}`, on ? 'Ahora puede sumarse a la selección.' : 'El retiro sale de la selección.');
      renderTodo();
    }
  });
  tb.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-id]'); if (tr) hlPin([tr.dataset.id], true); });
  tb.addEventListener('mouseout', e => { const tr = e.target.closest('tr[data-id]'); if (tr) hlPin([tr.dataset.id], false); });
  $('#cc-chk-all').addEventListener('click', e => {
    e.preventDefault();
    const rows = filasTabla(), elig = rows.filter(p => puedeCargar(p).ok || S.camion.has(p.id_pedido));
    if (elig.length && elig.every(p => S.camion.has(p.id_pedido))) { elig.forEach(p => S.camion.delete(p.id_pedido)); renderTodo(); }
    else agregarVarios(rows.filter(p => !S.camion.has(p.id_pedido)).map(p => p.id_pedido), 'Selección tabla');
  });
  root.querySelector('.cc-t thead').addEventListener('click', e => {
    const th = e.target.closest('th.sort'); if (!th) return;
    const col = th.dataset.col;
    S.orden = { col, dir: S.orden.col === col ? -S.orden.dir : (col === 'ton' || col === 'match' ? -1 : 1) };
    renderTabla();
  });
  let tq;
  $('#cc-q').addEventListener('input', e => { clearTimeout(tq); tq = setTimeout(() => { S.q = e.target.value; renderTabla(); }, 150); });
  $('#cc-fest').addEventListener('change', e => { S.fEstado = e.target.value; renderTabla(); });
  $('#cc-modal').addEventListener('click', e => { if (e.target.id === 'cc-modal' || e.target.closest('[data-act="cerrar-modal"]')) $('#cc-modal').classList.remove('show'); });
}
function onKey(e) {
  if (!root || !document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
  if (e.key === 'Escape') { $('#cc-modal').classList.remove('show'); if (S.lazo) activarLazo(false); }
}

/* ════════════════════════════════════════════════════════════════════════
   VISTA
   ════════════════════════════════════════════════════════════════════════ */
function plantilla() {
  return `<div class="cc">
  <header class="cc-top">
    <div class="cc-brand">
      <div class="cc-brand-ic"><span class="material-symbols-outlined">local_shipping</span></div>
      <div><div class="cc-brand-t">Monitor de Consolidación</div><div class="cc-brand-s" id="cc-centro-lbl"></div></div>
    </div>
    <div class="cc-grp"><span class="cc-lbl">Sucursal (of. ventas)</span><select class="cc-select" id="cc-suc"></select></div>
    <div class="cc-grp"><span class="cc-lbl">Camiones habilitados · Tarifas Clientes</span><div class="cc-seg" id="cc-trucks"></div></div>
    <div class="cc-grp"><span class="cc-lbl">Peso base</span><div class="cc-seg" id="cc-base">
      <button data-base="pedido" class="is-on" title="Pendiente de entrega del pedido (posiciones no bloqueadas)">Pedido</button>
      <button data-base="entrega" title="Peso de las entregas en tratamiento (Entregas_Periodo)">Entrega</button></div></div>
    <div class="cc-grp"><span class="cc-lbl">Herramientas</span><div class="cc-chips">
      <button class="cc-chip is-tool" id="cc-btn-lazo" title="Dibuje un lazo para sumar todos los pedidos del área"><span class="material-symbols-outlined">gesture</span>Lazo</button>
      <button class="cc-chip is-tool" id="cc-btn-geo" title="Ubicar obras arrastrando su pin (guarda en obras_georef)"><span class="material-symbols-outlined">edit_location_alt</span>Georreferenciar <span class="cc-cnt" id="cc-geo-cnt">0</span></button>
      <button class="cc-chip" id="cc-btn-reload" title="Volver a leer los datos SAP"><span class="material-symbols-outlined">refresh</span>Actualizar</button></div></div>
    <div class="cc-grp cc-grp-full"><span class="cc-lbl">Condición de expedición</span><div class="cc-chips" id="cc-cond"></div></div>
  </header>
  <section class="cc-main">
    <div class="cc-card">
      <div class="cc-acc lv-vacio" id="cc-acc">
        <div class="cc-acc-l">
          <div class="cc-acc-row"><span class="cc-acc-ton num" id="cc-acc-ton"></span><span class="cc-acc-pct num" id="cc-acc-pct">0%</span><span class="cc-status" id="cc-status"></span></div>
          <div>
            <div class="cc-bar" title="Tonelaje seleccionado vs capacidad del camión"><div class="cc-bar-main"><div class="cc-bar-fill" id="cc-fill"></div><i class="cc-tick t90"></i></div><div class="cc-bar-over"><div class="cc-bar-overfill" id="cc-overfill"></div></div></div>
            <div class="cc-bar-lbls"><span style="left:0;transform:none">0</span><span style="left:calc(84% * .9)">90%</span><span style="left:84%">100%</span><span style="left:100%;transform:translateX(-100%)">+25%</span></div>
          </div>
          <div class="cc-acc-meta" id="cc-acc-meta"></div>
        </div>
        <div class="cc-acc-r"><button class="cc-btn sm" id="cc-btn-vaciar" disabled><span class="material-symbols-outlined">delete_sweep</span>Limpiar selección</button></div>
      </div>
      <div class="cc-mapwrap" id="cc-mapwrap">
        <div id="cc-map"></div>
        <div class="cc-maphint" id="cc-maphint"></div>
        <div class="cc-legend">
          <div><i style="background:var(--cc-green)"></i>Confirmado · entrega 100%</div>
          <div><i style="background:var(--cc-amber)"></i>Advertencia (entrega, bloqueo parcial…)</div>
          <div><i style="background:var(--cc-red)"></i>Bloqueado (no consolidable)</div>
          <div><i class="dash"></i>Borde punteado = ubicación aprox. (ruta)</div>
          <div><i class="sq" style="background:var(--cc-ink2)"></i>Pin cuadrado = retiro</div>
        </div>
      </div>
    </div>
    <aside class="cc-card cc-side">
      <nav class="cc-tabs" id="cc-tabs">
        <button class="cc-tab is-on" data-tab="sectores"><span class="material-symbols-outlined">grid_view</span>Rutas <span class="cc-cnt" id="cc-tab-c2">0</span></button>
        <button class="cc-tab" data-tab="camion"><span class="material-symbols-outlined">local_shipping</span>Selección <span class="cc-cnt" id="cc-tab-c1">0</span></button>
      </nav>
      <div class="cc-pane" id="cc-pane"></div>
    </aside>
  </section>
  <section class="cc-card cc-tablecard">
    <div class="cc-tbar">
      <span class="cc-tbar-t">Pedidos</span><span class="cc-tbar-s" id="cc-tbar-s"></span>
      <label class="cc-search"><span class="material-symbols-outlined">search</span><input id="cc-q" placeholder="Pedido, obra, cliente, comuna…"></label>
      <select class="cc-select" id="cc-fest">
        <option value="todos">Todos los estados</option><option value="ok">Confirmados</option><option value="desc">Con advertencia</option>
        <option value="bloq">Bloqueados</option><option value="vencido">F. entrega vencida</option><option value="nogeo">Sin ubicación exacta</option>
        <option value="camion">En selección</option><option value="nohab">Camión no habilitado</option>
      </select>
    </div>
    <div class="cc-tscroll"><table class="cc-t"><thead><tr>
      <th style="width:34px"><input type="checkbox" id="cc-chk-all" title="Sumar visibles consolidables a la selección"></th>
      <th class="sort" data-col="estado">Estado</th><th class="sort" data-col="id">ID Pedido</th><th class="sort" data-col="obra">ID Obra</th>
      <th class="sort" data-col="cliente">Cliente</th><th class="sort" data-col="cond">Condición Exp</th><th class="sort" data-col="comuna">Comuna</th>
      <th class="sort" data-col="fecha">F. entrega</th><th class="sort r" data-col="ton">Toneladas</th><th class="sort" data-col="match">Match Entrega</th><th>Acciones</th>
    </tr></thead><tbody id="cc-tbody"></tbody></table></div>
  </section>
  <div class="cc-modal" id="cc-modal"><div class="cc-modal-c" id="cc-modal-c"></div></div>
</div>`;
}

async function recargar() {
  const btn = $('#cc-btn-reload'); if (btn) btn.disabled = true;
  try {
    await cargarFuentes();
    const sel = new Set(S.camion), fz = new Set(S.forzados);
    setSucursal(S.sucursal);
    sel.forEach(id => { if (S.byId.has(id)) S.camion.add(id); });
    fz.forEach(id => { if (S.byId.has(id)) S.forzados.add(id); });
    renderTodo(); actualizadoEn();
    toast('ok', 'Datos actualizados', `${S.pedidos.length} pedidos con pendiente en ${S.centro.nombre}.`);
  } catch (err) { toast('err', 'No se pudo actualizar', err.message || String(err)); }
  if (btn) btn.disabled = false;
}
function actualizadoEn() {
  const upd = document.getElementById('sv-upd');
  if (!upd || !S.raw.cargado) return;
  const d = new Date(S.raw.cargado);
  upd.innerHTML = `<span class="material-symbols-outlined">schedule</span>Datos SAP ${d.toLocaleDateString('es-CL')} ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  upd.classList.remove('hidden');
}

export async function renderMonitorConsolidacion(stage) {
  inyectarEstilos();
  if (!document.getElementById('cc-toasts')) { const t = document.createElement('div'); t.id = 'cc-toasts'; t.className = 'cc-toasts'; document.body.appendChild(t); }
  if (map) { try { map.remove(); } catch (_e) { /* */ } map = null; hubMarker = null; }
  S.lazo = false; S.editGeo = false;
  await Promise.all([loadLeaflet(), cargarFuentes()]);
  stage.innerHTML = plantilla();
  root = stage.querySelector('.cc');
  bindEventos();
  document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  const sucs = [...new Set(S.raw.suc.map(d => z(d.ofvta)).filter(Boolean))].sort();
  if (!sucs.length) { root.querySelector('.cc-main').innerHTML = '<div class="cc-card"><div class="cc-empty" style="margin:24px">No hay pedidos de venta de sucursal en su alcance.</div></div>'; return; }
  let pref = ''; try { pref = localStorage.getItem(LS_SUC) || ''; } catch (_e) { /* */ }
  setSucursal(sucs.includes(pref) ? pref : sucs[0]);
  actualizadoEn();
  if (!S.raw.geoOk) toast('warn', 'Ubicación por ruta', `Las obras se muestran en el punto de su ruta (comuna). Para georreferenciarlas falta crear la tabla ${CFG.tablaGeo}.`);
}

/* ════════════════════════════════════════════════════════════════════════
   ESTILOS (prefijo cc-, alineados a css/sit-v2.css)
   ════════════════════════════════════════════════════════════════════════ */
function inyectarEstilos() {
  if (document.getElementById('cc-style')) return;
  const st = document.createElement('style');
  st.id = 'cc-style';
  st.textContent = `
.cc{--cc-primary:#b5000b;--cc-primary-h:#930007;--cc-sel:#ffdad5;--cc-sel2:#fff5f3;--cc-ink:#191c1d;--cc-ink2:#5c5f61;--cc-ink3:#444749;--cc-s1:#f3f4f5;--cc-s2:#edeeef;--cc-s3:#e7e8e9;--cc-line:#e1e3e4;--cc-line2:#edeeef;--cc-mono:'JetBrains Mono',ui-monospace,Consolas,monospace;
--cc-blue:#2563eb;--cc-blue-bg:#dbeafe;--cc-blue-ink:#1e40af;--cc-green:#16a34a;--cc-green-bg:#dcfce7;--cc-green-ink:#166534;--cc-red:#dc2626;--cc-red-bg:#fee2e2;--cc-red-ink:#991b1b;--cc-amber:#f59e0b;--cc-amber-bg:#fef3c7;--cc-amber-ink:#92400e;--cc-gray:#9ca3af;
display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:calc(100vh - 112px);min-height:680px;gap:12px;color:var(--cc-ink);font-size:14px}
.cc *,.cc-toasts *{box-sizing:border-box}
.cc .material-symbols-outlined,.cc-toasts .material-symbols-outlined{font-size:18px;line-height:1;vertical-align:middle;display:inline-block;width:1em;overflow:hidden;white-space:nowrap;flex-shrink:0}
.cc .mono{font-family:var(--cc-mono);font-size:12px}.cc .num{font-variant-numeric:tabular-nums}
.cc-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;background:#fff;border:1px solid var(--cc-line);border-radius:8px;padding:10px 14px}
.cc-brand{display:flex;align-items:center;gap:10px;margin-right:auto;min-width:220px}
.cc-brand-ic{width:34px;height:34px;border-radius:8px;background:var(--cc-sel);color:var(--cc-primary);display:flex;align-items:center;justify-content:center}
.cc-brand-ic .material-symbols-outlined{font-size:22px}
.cc-brand-t{font-size:16px;font-weight:700;line-height:20px}.cc-brand-s{font-size:12px;color:var(--cc-ink2)}
.cc-grp{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%}.cc-grp-full{flex-basis:100%}
.cc-lbl{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2)}
.cc-seg{display:inline-flex;flex-wrap:wrap;background:var(--cc-s2);border-radius:6px;padding:2px;gap:2px;max-width:100%}
.cc-seg button,.cc-seg label{border:none;background:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;color:var(--cc-ink3);white-space:nowrap;display:flex;align-items:center;gap:6px}
.cc-seg button:hover,.cc-seg label:hover{color:var(--cc-primary)}
.cc-seg button.is-on,.cc-seg label.is-on{background:#fff;color:var(--cc-ink);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.cc-manual{display:flex;align-items:center;gap:4px}
.cc-manual input{width:58px;border:1px solid var(--cc-line);border-radius:4px;padding:2px 6px;font-family:var(--cc-mono);font-size:12px;background:#fff}
.cc-chips{display:flex;gap:6px;flex-wrap:wrap}
.cc-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cc-line);background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--cc-ink3);white-space:nowrap}
.cc-chip:hover{border-color:var(--cc-ink2)}.cc-chip:disabled{opacity:.5}
.cc-chip.is-on{background:var(--cc-ink);border-color:var(--cc-ink);color:#fff}
.cc-chip.is-tool.is-on{background:var(--cc-primary);border-color:var(--cc-primary)}
.cc-chip .cc-cnt{font-family:var(--cc-mono);font-size:10.5px;background:var(--cc-amber-bg);color:var(--cc-amber-ink);border-radius:999px;padding:0 6px}
.cc-chip.is-on .cc-cnt{background:rgba(255,255,255,.22);color:#fff}
.cc-select{border:1px solid var(--cc-line);border-radius:6px;padding:5px 8px;font-size:13px;background:#fff}
.cc-main{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:12px;min-height:0}
.cc-card{background:#fff;border:1px solid var(--cc-line);border-radius:8px;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cc-acc{padding:12px 14px;border-bottom:1px solid var(--cc-line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;align-items:center;transition:background .25s}
.cc-acc-l{display:flex;flex-direction:column;gap:7px;min-width:0}
.cc-acc-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.cc-acc-ton{font-family:var(--cc-mono);font-size:22px;font-weight:600}.cc-acc-ton small{font-size:13px;color:var(--cc-ink2);font-weight:500}
.cc-acc-pct{font-family:var(--cc-mono);font-size:14px;font-weight:600;padding:1px 8px;border-radius:4px}
.cc-status{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:13px;padding:3px 10px;border-radius:999px}
.cc-status .material-symbols-outlined{font-size:17px;font-variation-settings:'FILL' 1}
.cc-acc-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--cc-ink2);align-items:center}
.cc-acc-meta b{color:var(--cc-ink);font-weight:600}.cc-acc-meta .material-symbols-outlined{font-size:15px;margin-right:2px}
.cc-bar{display:flex;gap:3px;height:14px}
.cc-bar-main{position:relative;flex:1;background:var(--cc-s2);border-radius:4px 0 0 4px;overflow:hidden}
.cc-bar-fill{position:absolute;inset:0 auto 0 0;width:0;background:var(--cc-blue);transition:width .35s cubic-bezier(.2,.8,.2,1),background .25s}
.cc-bar-over{position:relative;width:16%;border-radius:0 4px 4px 0;overflow:hidden;background:repeating-linear-gradient(-45deg,var(--cc-s2) 0 4px,var(--cc-s1) 4px 8px)}
.cc-bar-overfill{position:absolute;inset:0 auto 0 0;width:0;background:var(--cc-red);transition:width .35s}
.cc-tick{position:absolute;top:-1px;bottom:-1px;width:2px;background:rgba(25,28,29,.55)}.cc-tick.t90{left:90%}
.cc-bar-lbls{display:flex;font-family:var(--cc-mono);font-size:10px;color:var(--cc-ink2);position:relative;height:12px}
.cc-bar-lbls span{position:absolute;transform:translateX(-50%)}
.cc-acc.lv-parcial .cc-status,.cc-acc.lv-parcial .cc-acc-pct{background:var(--cc-blue-bg);color:var(--cc-blue-ink)}
.cc-acc.lv-completo{background:#f3fcf6}.cc-acc.lv-completo .cc-bar-fill{background:var(--cc-green)}
.cc-acc.lv-completo .cc-status,.cc-acc.lv-completo .cc-acc-pct{background:var(--cc-green);color:#fff}
.cc-acc.lv-exceso{background:#fff6f6}.cc-acc.lv-exceso .cc-bar-fill{background:var(--cc-red)}
.cc-acc.lv-exceso .cc-status,.cc-acc.lv-exceso .cc-acc-pct{background:var(--cc-red);color:#fff}
.cc-acc.lv-vacio .cc-status,.cc-acc.lv-vacio .cc-acc-pct{background:var(--cc-s2);color:var(--cc-ink2)}
.cc-acc.is-pulse .cc-bar{animation:ccPulse .9s ease 2}@keyframes ccPulse{50%{transform:scaleY(1.45)}}
.cc-acc-r{display:flex;flex-direction:column;gap:6px}
.cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--cc-line);background:#fff;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--cc-ink)}
.cc-btn:hover:not(:disabled){border-color:var(--cc-ink2)}.cc-btn:disabled{opacity:.45;cursor:not-allowed}
.cc-btn.pri{background:var(--cc-primary);border-color:var(--cc-primary);color:#fff}.cc-btn.sm{padding:4px 9px;font-size:12px}
.cc-mapwrap{position:relative;flex:1;min-height:300px}
#cc-map{position:absolute;inset:0;background:#e8eaeb}
.cc-mapwrap.is-lazo #cc-map,.cc-mapwrap.is-lazo .leaflet-interactive{cursor:crosshair!important}
.cc-maphint{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:500;background:var(--cc-ink);color:#fff;font-size:12px;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;align-items:center;gap:6px;max-width:calc(100% - 120px);pointer-events:none}
.cc-maphint.show{display:flex}
.cc-legend{position:absolute;left:10px;bottom:10px;z-index:500;background:rgba(255,255,255,.95);border:1px solid var(--cc-line);border-radius:6px;padding:7px 10px;font-size:11px;display:flex;flex-direction:column;gap:4px;color:var(--cc-ink3)}
.cc-legend div{display:flex;align-items:center;gap:7px}
.cc-legend i{width:11px;height:11px;border-radius:50%;display:inline-block;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)}
.cc-legend i.sq{border-radius:2px}.cc-legend i.dash{background:#fff;border:1.5px dashed var(--cc-ink2);box-shadow:none}
.cc-pin-wrap{background:none;border:none}
.cc-pin{position:relative;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);color:#fff;transition:transform .12s;cursor:pointer}
.cc-pin svg{width:15px;height:15px;fill:currentColor}
.cc-pin.ok{background:var(--cc-green)}.cc-pin.desc{background:var(--cc-amber)}.cc-pin.bloq{background:var(--cc-red)}
.cc-pin.ret{border-radius:5px}.cc-pin.aprox{border-style:dashed;opacity:.92}
.cc-pin.drag{animation:ccBob 1.4s ease-in-out infinite;cursor:grab;box-shadow:0 0 0 3px rgba(181,0,11,.35),0 1px 4px rgba(0,0,0,.35)}
.cc-pin.sel{box-shadow:0 0 0 3px var(--cc-ink),0 2px 8px rgba(0,0,0,.4);transform:scale(1.12)}
.cc-pin.hl{transform:scale(1.35);box-shadow:0 0 0 4px rgba(181,0,11,.35),0 1px 4px rgba(0,0,0,.35)}
.cc-pin-badge{position:absolute;top:-8px;right:-9px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:var(--cc-ink);color:#fff;font-family:var(--cc-mono);font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff}
.cc-pin.edit{background:#fff;color:var(--cc-ink2);border:2px dashed var(--cc-ink2);width:30px;height:30px;animation:ccBob 1.4s ease-in-out infinite}
.cc-pin.edit svg{width:17px;height:17px}@keyframes ccBob{50%{transform:translateY(-3px)}}
.cc-hub{width:36px;height:36px;border-radius:9px;background:var(--cc-primary,#b5000b);color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.cc-hub svg{width:20px;height:20px;fill:currentColor}
.leaflet-tooltip.cc-tt{font-size:12px;padding:8px 10px;border-radius:6px;border:1px solid #e1e3e4;box-shadow:0 4px 14px rgba(0,0,0,.14);color:#191c1d;max-width:340px;white-space:normal}
.cc-tt-h{font-weight:700;display:flex;gap:8px;align-items:center;margin-bottom:3px}.cc-tt-r{color:#5c5f61;line-height:1.45}
.cc-tt-f{margin-top:5px;font-size:11px;color:#5c5f61;border-top:1px solid #edeeef;padding-top:4px}
.cc-tt .mono{font-family:'JetBrains Mono',monospace;font-size:12px}
.cc-geo-pop{display:flex;flex-direction:column;gap:6px;min-width:220px;font-size:13px}.cc-geo-pop .mono{font-family:'JetBrains Mono',monospace;font-size:12px;color:#5c5f61}
.cc-geo-pop .cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer;background:#b5000b;border:1px solid #b5000b;color:#fff}
.cc-geo-pop .cc-btn:disabled{opacity:.45}
.cc-tabs{display:flex;border-bottom:1px solid var(--cc-line);padding:0 6px}
.cc-tab{flex:1;border:none;background:none;padding:11px 6px 9px;font-size:13px;font-weight:600;color:var(--cc-ink2);cursor:pointer;border-bottom:2px solid transparent;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.cc-tab:hover{color:var(--cc-primary)}.cc-tab.is-on{color:var(--cc-primary);border-bottom-color:var(--cc-primary)}
.cc-tab .cc-cnt{font-family:var(--cc-mono);font-size:10.5px;background:var(--cc-s2);color:var(--cc-ink3);border-radius:999px;padding:0 6px}
.cc-tab .cc-cnt.g{background:var(--cc-green);color:#fff}
.cc-pane{flex:1;overflow:auto;padding:10px 12px 14px}
.cc-sec-t{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2);margin:10px 2px 6px;display:flex;justify-content:space-between;align-items:center}
.cc-empty{color:var(--cc-ink2);font-size:13px;text-align:center;padding:22px 10px;border:1px dashed var(--cc-line);border-radius:8px;line-height:1.5}
.cc-empty .material-symbols-outlined{font-size:28px;display:block;margin:0 auto 6px;color:var(--cc-gray)}
.cc-li{display:grid;grid-template-columns:22px minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:7px 6px;border-radius:6px;border:1px solid transparent}
.cc-li:hover{background:var(--cc-s1);border-color:var(--cc-line2)}
.cc-li-n{width:20px;height:20px;border-radius:50%;background:var(--cc-ink);color:#fff;font-family:var(--cc-mono);font-size:10px;display:flex;align-items:center;justify-content:center}
.cc-li-n.nogeo{background:var(--cc-gray)}
.cc-li-id{font-family:var(--cc-mono);font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px}
.cc-li-sub{font-size:11.5px;color:var(--cc-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-li-t{font-family:var(--cc-mono);font-size:12px;font-weight:600;text-align:right}
.cc-x{border:none;background:none;color:var(--cc-ink2,#5c5f61);cursor:pointer;padding:3px;border-radius:4px;display:flex}
.cc-x:hover{background:#e7e8e9;color:#b5000b}
.cc-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.cc-dot.ok{background:#16a34a}.cc-dot.desc{background:#f59e0b}.cc-dot.bloq{background:#dc2626}
.cc-tag{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.02em;padding:1px 6px;border-radius:4px;white-space:nowrap;text-transform:uppercase}
.cc-tag.fz{background:#ffdad5;color:#930007}.cc-tag.am{background:#fef3c7;color:#92400e}.cc-tag.gr{background:#dcfce7;color:#166534}
.cc-tag.rd{background:#fee2e2;color:#991b1b}.cc-tag.gy{background:#edeeef;color:#444749}.cc-tag.bl{background:#dbeafe;color:#1e40af}
.cc-cond{font-family:'JetBrains Mono',monospace;font-size:11px;padding:1px 6px;border-radius:4px;background:#edeeef;color:#444749;white-space:nowrap}
.cc-cond.ret{background:#ffdad5;color:#930007}
.cc-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:4px}
.cc-sum div{background:var(--cc-s1);border-radius:6px;padding:7px 8px}.cc-sum b{display:block;font-family:var(--cc-mono);font-size:14px}.cc-sum span{font-size:10.5px;color:var(--cc-ink2)}
.cc-sector{border:1px solid var(--cc-line);border-radius:8px;padding:9px 10px;margin-bottom:7px;display:flex;flex-direction:column;gap:6px}
.cc-sector:hover{border-color:var(--cc-ink2)}
.cc-sector.lv-completo{border-color:var(--cc-green);background:#f6fdf8}.cc-sector.lv-exceso{border-color:#86c79c;background:#f6fdf8}
.cc-sector.lv-nohab{border-color:#f3b4b4;background:#fffafa}.cc-sector.lv-nohab .cc-mini i{background:var(--cc-gray)}
.cc-sector-h{display:flex;align-items:center;gap:8px}.cc-sector-h b{flex:1;font-size:13px}
.cc-mini{height:6px;background:var(--cc-s2);border-radius:3px;overflow:hidden;position:relative}
.cc-mini i{position:absolute;inset:0 auto 0 0;background:var(--cc-blue);border-radius:3px}
.cc-sector.lv-completo .cc-mini i,.cc-sector.lv-exceso .cc-mini i{background:var(--cc-green)}
.cc-sector-aj{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;line-height:1.4;font-size:11.5px;color:var(--cc-ink3);align-items:baseline}
.cc-sector-aj b{color:var(--cc-ink);font-weight:600}
.cc-sector-cams{font-family:var(--cc-mono);font-size:10px;color:var(--cc-ink2);white-space:nowrap}
.cc-sector-f{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--cc-ink2)}
.cc-tablecard{height:min(34vh,380px)}
.cc-tbar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--cc-line);flex-wrap:wrap}
.cc-tbar-t{font-weight:700;font-size:14px}.cc-tbar-s{font-size:12px;color:var(--cc-ink2);margin-right:auto}
.cc-search{display:flex;align-items:center;gap:6px;border:1px solid var(--cc-line);border-radius:6px;padding:4px 8px;background:#fff}
.cc-search input{border:none;outline:none;width:200px;font-size:13px;background:none}
.cc-tscroll{flex:1;overflow:auto}
table.cc-t{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.cc-t th{position:sticky;top:0;z-index:2;background:var(--cc-s1);text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cc-ink2);padding:8px 10px;border-bottom:1px solid var(--cc-line);white-space:nowrap;user-select:none}
.cc-t th.sort{cursor:pointer}.cc-t th.sort:hover{color:var(--cc-primary)}.cc-t th .material-symbols-outlined{font-size:14px}
.cc-t td{padding:6px 10px;border-bottom:1px solid var(--cc-line2);white-space:nowrap;vertical-align:middle}
.cc-t td.r,.cc-t th.r{text-align:right}
.cc-t td.cc-td-cli{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.cc-t tbody tr:hover{background:var(--cc-s1)}
.cc-t tbody tr.is-sel{background:var(--cc-sel2)}.cc-t tbody tr.is-sel td:first-child{box-shadow:inset 3px 0 0 var(--cc-primary)}
.cc-t tbody tr.is-hl{background:#fff1ee}
.cc-t input[type=checkbox]{width:15px;height:15px;accent-color:var(--cc-primary);cursor:pointer;vertical-align:middle}
.cc-t input[type=checkbox]:disabled{cursor:not-allowed;opacity:.4}
.cc-venc{color:#b91c1c;font-weight:600}
.cc-est{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.cc-match{display:inline-flex;align-items:center;gap:7px}.cc-match .cc-mini{width:54px;height:5px}
.cc-match.ok .cc-mini i{background:var(--cc-green)}.cc-match.bad .cc-mini i{background:var(--cc-amber)}.cc-match.none .cc-mini i{background:var(--cc-red)}
.cc-match span{font-family:var(--cc-mono);font-size:11.5px}
.cc-acts{display:flex;gap:2px}
.cc-ib{border:none;background:none;color:var(--cc-ink2);cursor:pointer;padding:4px;border-radius:4px;display:inline-flex}
.cc-ib:hover{background:var(--cc-s3);color:var(--cc-primary)}.cc-ib.on{color:var(--cc-primary)}
.cc-toasts{position:fixed;right:18px;bottom:18px;z-index:2000;display:flex;flex-direction:column;gap:8px;max-width:380px}
.cc-toast{background:#fff;border:1px solid #e1e3e4;border-left:4px solid #2563eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 12px;display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:start;animation:ccIn .22s ease;font-size:13px;color:#191c1d}
.cc-toast .material-symbols-outlined{font-size:20px;font-variation-settings:'FILL' 1}
.cc-toast b{display:block;font-size:13px}.cc-toast p{margin:2px 0 0;font-size:12px;color:#5c5f61;line-height:1.4}
.cc-toast.ok{border-left-color:#16a34a}.cc-toast.ok>.material-symbols-outlined{color:#16a34a}
.cc-toast.err{border-left-color:#dc2626}.cc-toast.err>.material-symbols-outlined{color:#dc2626}
.cc-toast.warn{border-left-color:#f59e0b}.cc-toast.warn>.material-symbols-outlined{color:#f59e0b}
.cc-toast.info>.material-symbols-outlined{color:#2563eb}
.cc-toast-acts{display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.cc-toast .cc-btn{display:inline-flex;border:1px solid #e1e3e4;background:#fff;border-radius:6px;padding:4px 9px;font-size:12px;font-weight:600;cursor:pointer}
@keyframes ccIn{from{transform:translateY(8px);opacity:0}}
.cc-modal{position:fixed;inset:0;z-index:2100;background:rgba(25,28,29,.38);display:none;align-items:center;justify-content:center;padding:16px}
.cc-modal.show{display:flex}
.cc-modal-c{background:#fff;border-radius:10px;width:min(980px,100%);max-height:86vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.3)}
.cc-modal-h{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--cc-line)}
.cc-modal-h h3{margin:0;font-size:16px;font-family:var(--cc-mono)}.cc-modal-h p{margin:3px 0 0;color:var(--cc-ink2);font-size:12.5px}
.cc-modal-b{padding:14px 18px 18px}
.cc-kv{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.cc-kv div{background:var(--cc-s1);border-radius:6px;padding:7px 9px}
.cc-kv span{display:block;font-size:10.5px;color:var(--cc-ink2);text-transform:uppercase;letter-spacing:.04em;font-weight:700}.cc-kv b{font-size:13px}
.cc-modal table{width:100%;border-collapse:collapse;font-size:12.5px}
.cc-modal th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--cc-ink2);padding:6px 8px;border-bottom:1px solid var(--cc-line);background:var(--cc-s1);white-space:nowrap}
.cc-modal td{padding:6px 8px;border-bottom:1px solid var(--cc-line2)}
.cc-modal tr.bad td{background:var(--cc-amber-bg)}.cc-modal tr.blq td{background:#fff5f5;color:#7f1d1d;text-decoration:line-through}
.cc-modal tr.blq td:last-child{text-decoration:none}
.cc-modal .r{text-align:right}
@media (max-width:1100px){.cc{height:auto}.cc-main{grid-template-columns:1fr}.cc-mapwrap{height:58vh;flex:none}.cc-side{max-height:520px}.cc-tablecard{height:auto;max-height:70vh}}
@media (max-width:640px){.cc-acc{grid-template-columns:1fr}.cc-kv{grid-template-columns:repeat(2,1fr)}.cc-search input{width:120px}.cc-brand{min-width:0;width:100%}}
`;
  document.head.appendChild(st);
}
