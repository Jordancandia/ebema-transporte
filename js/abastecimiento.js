// ============================================================================
// GESTION TRONCALES / ABASTECIMIENTO  —  AJUSTES 3.0
// ----------------------------------------------------------------------------
// Planificacion de cargas de productos a las sucursales desde CD (o cualquier
// origen). Submenus: Proveedores, Calendario Sucursales, vistas de datos SAP
// (Quiebres, Retiros, Ventas 1003, Traslados, Stock 4000, Traslados 4000) y el
// dashboard Plan de Carga.
//
// Persistencia: Supabase (abast_proveedores, abast_proveedor_direcciones,
// abast_calendario, abast_retiro_estado) + vistas v_trc_* sobre trc_live (JSONB).
// ============================================================================

import { supabase } from './supabase-client.js';
import { getDatabase } from './data.js?v=20260714a';
import { showAlert, escapeHtml } from './utils.js';

// ── Configuracion de calendarios por centro origen ──────────────────────────
// (AJUSTE 3.0) Se eliminan los sobre-cupos del sábado.
const CALENDARIOS = {
  '1003': {
    nombre: 'CD Quilicura',
    bloques: ['07:30-11:30', '11:00-15:00', '15:30-19:30'],
    dias: [
      { n: 1, lbl: 'Lunes',     corto: 'LUN' },
      { n: 2, lbl: 'Martes',    corto: 'MAR' },
      { n: 3, lbl: 'Miércoles', corto: 'MIE' },
      { n: 4, lbl: 'Jueves',    corto: 'JUE' },
      { n: 5, lbl: 'Viernes',   corto: 'VIE' },
    ],
    destinos: ['1020','1040','1050','1060','1070','1080','1090','1100','1160','1005'],
  },
  '1081': {
    nombre: 'CD Concepción',
    bloques: ['08:00-11:00', '11:00-15:00'],
    dias: [
      { n: 1, lbl: 'Lunes',     corto: 'LUN' },
      { n: 2, lbl: 'Martes',    corto: 'MAR' },
      { n: 3, lbl: 'Miércoles', corto: 'MIE' },
      { n: 4, lbl: 'Jueves',    corto: 'JUE' },
      { n: 5, lbl: 'Viernes',   corto: 'VIE' },
    ],
    destinos: ['1100','1090','1160','1070','1060','1005','1003'],
  },
};

// ── Estado del modulo ───────────────────────────────────────────────────────
let currentSub = 'proveedores';
let proveedores = [];
let selectedProveedorId = null;
let calOrigen = '1003';
let calMatrix = {};
let rootEl = null;

// ── Utilidades ──────────────────────────────────────────────────────────────
async function getUserEmail() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email || null;
  } catch { return null; }
}

export function setAbastSubTab(sub) {
  if (sub) currentSub = sub;
}

// ============================================================================
// HELPERS PARA VISTAS DE DATOS
// ============================================================================
function parseDateSAP(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function hoy00() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function alertaFecha(fechaStr, diasUmbral = 5) {
  const d = parseDateSAP(fechaStr);
  if (!d) return { txt: '', cls: '' };
  const hoy = hoy00();
  const diff = Math.floor((d - hoy) / 86400000);
  if (diff < 0) return { txt: 'PEDIDO ATRASADO', cls: 'text-error font-bold' };
  if (diff <= diasUmbral) return { txt: 'PRONTO A VENCER', cls: 'text-[#e65100] font-bold' };
  return { txt: '', cls: '' };
}

// Número SAP → float (puntos = miles, coma = decimal)
function parseNum(v) {
  return parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
}

// MAX(peso_bruto, tamano_dimens) en número
function maxPesoDim(peso, dim) {
  return Math.max(parseNum(peso), parseNum(dim));
}

// Tonelaje = pesoMax * cantidad / 1000
function calcTon(pesoMax, cantidad) {
  return pesoMax * parseNum(cantidad) / 1000;
}

function fmtNum(n, dec = 2) {
  if (n == null || isNaN(n)) return '';
  return n.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function lookupRuta(rutaId) {
  if (!rutaId) return { comuna: '', region: '' };
  const db = getDatabase();
  const r = (db.routes || []).find(x => x.codigo === String(rutaId).trim());
  return r ? { comuna: r.comuna || '', region: r.region || '' } : { comuna: '', region: '' };
}

function horaChile(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(ts).slice(0, 16).replace('T', ' '); }
}

const CENTROS_QUIEBRES = ['1005','1020','1040','1050','1060','1070','1080','1090','1100','1160'];

// Orden de clase ABC solicitado: AA, AB, AC, BA, BB, BC, CA, CB, CC
const ABC_ORDEN = { AA:0, AB:1, AC:2, BA:3, BB:4, BC:5, CA:6, CB:7, CC:8 };
function abcRank(abc) {
  const k = String(abc ?? '').trim().toUpperCase();
  return ABC_ORDEN[k] != null ? ABC_ORDEN[k] : 99;
}

// Normaliza texto: quita acentos/ñ y pasa a MAYÚSCULAS.
function normTxt(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

// Comunas que están "en el camino" hacia cada centro destino: un pedido de venta
// cuya comuna (según maestro de rutas) esté en la lista puede dejarse en ruta.
// Claves normalizadas (sin acentos/ñ) para hacer match por nombre de centro.
const COMUNAS_EN_CAMINO = {
  'ANTOFAGASTA':  new Set(['CHANARAL','TALTAL','CALDERA','COPIAPO']),
  'COQUIMBO':     new Set(['LOS VILOS','PICHIDANGUI','LA LIGUA']),
  'RANCAGUA':     new Set(['BUIN','PAINE','MOSTAZAL','GRANEROS']),
  'TALCA':        new Set(['CURICO','SAN RAFAEL']),
  'CHILLAN':      new Set(['SAN CARLOS','SAN GREGORIO','LINARES','PARRAL']),
  'TEMUCO':       new Set(['LAUTARO','VICTORIA','COLLIPULLI']),
  'PUERTO MONTT': new Set(['RIO BUENO','PUERTO VARAS','FRUTILLAR','LLANQUIHUE','OSORNO','PURRANQUE','SAN PABLO']),
  'CONCEPCION':   new Set(['PENCO','TALCAHUANO','HUALPEN']),
};

// Devuelve el Set de comunas "en el camino" para el centro dado (por nombre).
function comunasEnCamino(centroId) {
  const nombre = normTxt(getNombreCentro(centroId));
  for (const key of Object.keys(COMUNAS_EN_CAMINO)) {
    if (nombre.indexOf(key) !== -1) return COMUNAS_EN_CAMINO[key];
  }
  return new Set();
}

// Clasificación de quiebre por días de stock (AJUSTE 3.0)
function tipoQuiebre(sd) {
  if (sd <= 3)  return { txt: 'MATERIAL QUEBRADO URGENTE', cls: 'text-white bg-red-600', dot: 'bg-red-600' };
  if (sd <= 5)  return { txt: 'STOCK CRÍTICO URGENTE',     cls: 'text-white bg-[#e65100]', dot: 'bg-[#e65100]' };
  return          { txt: 'STOCK EN REVISIÓN',              cls: 'text-black bg-[#f9a825]', dot: 'bg-[#f9a825]' };
}

// ── Estado de coordinación de retiros (persistente) ─────────────────────────
async function loadEstadosRetiro() {
  const { data, error } = await supabase.from('abast_retiro_estado').select('doc_compr, estado');
  const m = {};
  if (!error) (data || []).forEach(r => { m[String(r.doc_compr)] = r.estado; });
  return m;
}
async function saveEstadoRetiro(docCompr, estado) {
  const payload = { doc_compr: String(docCompr), estado, updated_by: await getUserEmail(), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('abast_retiro_estado').upsert(payload, { onConflict: 'doc_compr' });
  if (error) { showAlert('Error al guardar estado: ' + error.message, 'error'); return false; }
  return true;
}
const ESTADO_OPTS = [
  { v: 'no_coordinado', l: 'No coordinado' },
  { v: 'coordinado',    l: 'Coordinado con proveedor' },
];

// ============================================================================
// VISTAS DE DATOS TRONCALES
// ============================================================================
const VISTAS_TRONCAL = {
  // ── QUIEBRES SUCURSAL (SLIM) ──────────────────────────────────────────────
  quiebres: {
    titulo: 'GESTIÓN TRONCALES – QUIEBRES SUCURSALES',
    vista: 'v_trc_slim_stock',
    chipFilter: { campo: 'centro', label: 'Centro' },
    extraChips: [{ campo: '_tipo_quiebre', label: 'Tipo de Quiebre' }],
    searchLabel: 'Buscar Orden de Compra',
    filtros: [],
    transform(rows) {
      return rows
        .filter(r => CENTROS_QUIEBRES.includes(String(r.centro ?? '').trim()))
        .map(r => {
          const sd = parseNum(r.stock_days);       // vacío → 0
          const tq = tipoQuiebre(sd);
          return { ...r, _desc_centro: getNombreCentro(r.centro), _sd_num: sd,
                   _tipo_quiebre: tq.txt, _tq_cls: tq.cls, _stock_days_disp: (String(r.stock_days ?? '').trim() === '' ? '0' : r.stock_days) };
        })
        .filter(r => r._sd_num <= 7)               // sólo SKU con ≤ 7 días
        .sort((a, b) => {
          const c = String(a.centro).localeCompare(String(b.centro));
          if (c !== 0) return c;
          const ab = abcRank(a.clase_abc) - abcRank(b.clase_abc);
          if (ab !== 0) return ab;
          return a._sd_num - b._sd_num;
        });
    },
    badges(rows) {
      let q = 0, c = 0, rev = 0;
      rows.forEach(r => { if (r._sd_num <= 3) q++; else if (r._sd_num <= 5) c++; else rev++; });
      return badgePill('SKU Quebrados (0-3)', q, 'bg-red-600 text-white') +
             badgePill('Stock Crítico (3-5)', c, 'bg-[#e65100] text-white') +
             badgePill('En Revisión (6-7)', rev, 'bg-[#f9a825] text-black');
    },
    columnas: [
      { key: 'centro', label: 'Centro' },
      { key: '_desc_centro', label: 'Descripción Centro' },
      { key: 'codigo_articulo', label: 'Código Artículo' },
      { key: 'descripcion', label: 'Descripción' },
      { key: '_stock_days_disp', label: 'StockDays', cls: 'text-right font-data-mono' },
      { key: 'clase_abc', label: 'Clase ABC', cls: 'text-center' },
      { key: '_tipo_quiebre', label: 'Tipo de Quiebre', badge: r => r._tq_cls },
    ],
  },

  // ── RETIROS DE FÁBRICA (Step 1) — agrupado por OC ─────────────────────────
  retiros: {
    titulo: 'GESTIÓN TRONCALES – RETIROS DE FÁBRICA',
    vista: 'v_trc_sqvi_retiros_fabrica',
    chipFilter: { campo: 'ce', label: 'Centro' },
    extraChips: [
      { campo: '_tipo_retiro', label: 'Tipo Retiro' },
      { campo: '_estado_lbl', label: 'Coordinación' },
      { campo: '_alerta', label: 'Alerta' },
    ],
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'Buscar Orden de Compra', tipo: 'buscar' }],
    dateRange: { campo: 'fe_entrega', label: 'Rango Fecha de Entrega' },
    async preload() { return { estados: await loadEstadosRetiro() }; },
    editable: {
      key: '_estado', options: ESTADO_OPTS,
      async onChange(row, val, ctx) {
        const ok = await saveEstadoRetiro(row.doc_compr, val);
        if (ok) { ctx.estados[String(row.doc_compr)] = val; showAlert('Estado actualizado', 'success'); }
        return ok;
      },
    },
    expand: {
      key: 'doc_compr', idKey: 'doc_compr', numCols: 3,
      headers: ['Orden de Compra','Centro Destino','ID Material','Nombre Material','Cantidad Pedido','Cantidad Pendiente','Ton SKU'],
      build(row) {
        return (row._detalle || []).map(d => [
          d.doc_compr, d.ce, d.material, d.texto_breve, fmtNum(d.pedido, 1), fmtNum(d.pendiente, 1), fmtNum(d.ton, 4),
        ]);
      },
    },
    transform(rows, ctx) {
      const estados = (ctx && ctx.estados) || {};
      const validas = rows
        .filter(r => !String(r.proveedor ?? '').startsWith('*'))
        .filter(r => String(r.contr ?? '').trim() !== '');
      // Agrupar por Orden de Compra (doc_compr)
      const g = new Map();
      validas.forEach(r => {
        const oc = String(r.doc_compr ?? '').trim();
        if (!oc) return;
        if (!g.has(oc)) g.set(oc, []);
        g.get(oc).push(r);
      });
      const out = [];
      for (const [oc, items] of g.entries()) {
        const f = items[0];
        const almVal = String(f.alm ?? '').trim();
        let ton = 0, pendienteTotal = 0, pedidoTotal = 0, revSaldo = false;
        const detalle = items.map(r => {
          const ctdP = parseNum(r.ctd_pedido), ctdE = parseNum(r.ctd_entregada);
          const pend = ctdP - ctdE;
          const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), pend);
          ton += t; pendienteTotal += pend; pedidoTotal += ctdP;
          if (ctdE > 0 && ctdE < ctdP) revSaldo = true;
          return { doc_compr: oc, ce: r.ce, material: r.material, texto_breve: r.texto_breve, pedido: ctdP, pendiente: pend, ton: t };
        });
        // Tipo de retiro (AJUSTE): 4000=FÁBRICA-CD (Consolidar CD), 2000=FÁBRICA-SUCURSAL
        // (Fábrica Directo). Si OC >=80% cap camión y tiene pedido de venta ⇒ FÁBRICA-CLIENTE.
        const tienePedidoVenta = String(f.documento ?? '').trim() !== '';
        const cap = getCapacidadCamion(f.ce);
        let tipoRetiro;
        if (ton >= cap * 0.80 && tienePedidoVenta) tipoRetiro = 'FÁBRICA-CLIENTE';
        else if (almVal === '4000') tipoRetiro = 'FÁBRICA-CD';
        else if (almVal === '2000') tipoRetiro = 'FÁBRICA-SUCURSAL';
        else tipoRetiro = 'FÁBRICA-SUCURSAL';
        const al = alertaFecha(f.fe_entrega, 5);
        const est = estados[oc] || 'no_coordinado';
        out.push({
          doc_compr: oc, contr: f.contr, proveedor: f.proveedor, nombre_1: f.nombre_1,
          ce: f.ce, _desc_centro: getNombreCentro(f.ce), alm: f.alm, documento: f.documento,
          fe_entrega: f.fe_entrega,
          _tipo_retiro: tipoRetiro,
          _cliente: tipoRetiro === 'FÁBRICA-CLIENTE',
          _consolidar: tipoRetiro === 'FÁBRICA-CD',
          _ton_num: ton, _ton_totales: fmtNum(ton, 4),
          _pendiente_total: pendienteTotal, _pedido_total: pedidoTotal,
          _vigencia: revSaldo ? 'REVISIÓN SALDO PEDIDO' : '',
          _revision_saldo: revSaldo,
          _alerta: al.txt, _alerta_cls: al.cls,
          _estado: est, _estado_lbl: (ESTADO_OPTS.find(o => o.v === est) || {}).l || 'No coordinado',
          _detalle: detalle,
        });
      }
      return out.sort((a, b) => {
        const da = parseDateSAP(a.fe_entrega), db2 = parseDateSAP(b.fe_entrega);
        return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
      });
    },
    badges(filas, chipSel) {
      const pend = filas.filter(r => (r._pendiente_total || 0) > 0).length;
      const scope = (chipSel && chipSel !== 'all') ? `Centro ${chipSel}` : 'Todos los centros';
      return badgePill(`OC pendientes por retirar · ${scope}`, pend, 'bg-primary text-white');
    },
    rowClsFn(r) { return r._cliente ? 'bg-green-50' : (r._revision_saldo ? 'bg-red-50' : ''); },
    columnas: [
      { key: '_tipo_retiro', label: 'Tipo de Retiro', clsFn: r => r._cliente ? 'text-green-800 font-bold' : (r._consolidar ? 'text-blue-700 font-bold' : 'text-[#e65100] font-bold') },
      { key: 'contr', label: 'Contrato de Compra' },
      { key: 'doc_compr', label: 'Orden de Compra', expandable: true },
      { key: 'nombre_1', label: 'Nombre de Proveedor' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'fe_entrega', label: 'Fecha de Retiro', cls: 'num-clear' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right num-clear font-bold' },
      { key: 'documento', label: 'Pedido de Ventas' },
      { key: '_vigencia', label: 'Vigencia OC', clsFn: r => r._revision_saldo ? 'text-red-700 font-bold' : '' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
      { key: '_estado', label: 'Coordinación', editable: true },
    ],
  },

  // ── PEDIDOS DE VENTA CD (1003) — agrupado por pedido ──────────────────────
  pedidos_venta: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE VENTA CD (1003)',
    vista: 'v_trc_sqvi_pedidos_venta_1003',
    chipFilter: { campo: 'ofvta', label: 'Oficina de Ventas' },
    filtros: [{ campo: 'doc_ventas', label: 'Buscar Pedido de Venta', tipo: 'buscar' }],
    dateRange: { campo: 'fe_entrega', label: 'Rango Fecha de Entrega' },
    noBuscar: true,
    expand: {
      key: 'doc_ventas', idKey: 'doc_ventas',
      headers: ['Pedido de Venta','ID Vendedor','Ruta','Comuna Destino','Región Destino','ID Material','Nombre Material','Cantidad Pendiente','Ton SKU'],
      build(row) {
        return (row._detalle || []).map(d => [
          d.doc_ventas, d.deudor, d.ruta, d.comuna, d.region, d.material, d.nombre, fmtNum(d.pendiente, 0), fmtNum(d.ton, 3),
        ]);
      },
    },
    transform(rows) {
      // 1) MR sólo vacías  2) sólo con ruta
      const base = rows
        .filter(r => !String(r.mr ?? '').trim())
        .filter(r => String(r.ruta ?? '').trim() !== '');
      // 2) Dedup doc_ventas+material → fecha de entrega más lejana
      const dedup = new Map();
      base.forEach(r => {
        const k = `${r.doc_ventas}|${r.material}`;
        const ex = dedup.get(k);
        if (!ex) { dedup.set(k, r); return; }
        const dNew = parseDateSAP(r.fe_entrega), dOld = parseDateSAP(ex.fe_entrega);
        if (dNew && (!dOld || dNew >= dOld)) dedup.set(k, r);
      });
      // 3) Excluir líneas ya entregadas (entregada == confirmada); pendiente = conf - entreg
      const lineas = [];
      for (const r of dedup.values()) {
        const conf = parseNum(r.ctd_confirmada), entreg = parseNum(r.cantidad_entrg);
        const pend = conf - entreg;
        if (conf > 0 && entreg >= conf) continue;   // entregado completo → fuera
        if (pend <= 0) continue;
        const rl = lookupRuta(r.ruta);
        // (AJUSTE) peso mayor entre PESO NETO y tamaño/dimensión × unidades pendientes
        const pesoPos = maxPesoDim(r.peso_neto, r.tamano_dimens) * pend;
        lineas.push({ ...r, _pend: pend, _entreg: entreg, _conf: conf, _ton: pesoPos / 1000,
                      _comuna: rl.comuna, _region: rl.region,
                      _parcial: (entreg > 0 && entreg < conf) });
      }
      // 4) Agrupar por pedido de venta
      const g = new Map();
      lineas.forEach(r => {
        const k = String(r.doc_ventas ?? '').trim();
        (g.get(k) || g.set(k, []).get(k)).push(r);
      });
      const out = [];
      for (const [doc, items] of g.entries()) {
        const f = items[0];
        let ton = 0, parcial = false;
        let fmax = null;
        const detalle = items.map(r => {
          ton += r._ton;
          if (r._parcial) parcial = true;
          const d = parseDateSAP(r.fe_entrega);
          if (d && (!fmax || d > fmax)) fmax = d;
          return { doc_ventas: doc, deudor: r.deudor, ruta: r.ruta, comuna: r._comuna, region: r._region,
                   material: r.material, nombre: r.denominacion_de_posicion, pendiente: r._pend, ton: r._ton };
        });
        const feLbl = fmax ? `${String(fmax.getDate()).padStart(2,'0')}.${String(fmax.getMonth()+1).padStart(2,'0')}.${fmax.getFullYear()}` : f.fe_entrega;
        const al = alertaFecha(feLbl, 5);
        // Descarga en camino: si la comuna del pedido (según maestro de rutas)
        // está en la lista de comunas "en el camino" del centro destino.
        const comunasList = comunasEnCamino(f.ofvta);
        let enCamino = false, comunaCamino = '';
        for (const it of items) {
          if (comunasList.has(normTxt(it._comuna))) { enCamino = true; comunaCamino = it._comuna; break; }
        }
        out.push({
          doc_ventas: doc, ofvta: f.ofvta, creado_el: f.creado_el, deudor: f.deudor,
          fe_entrega: feLbl, _ton_num: ton, _ton_totales: fmtNum(ton, 3),
          _estado: parcial ? 'ENTREGA PARCIAL PENDIENTE' : '',
          _alerta: al.txt, _alerta_cls: al.cls, _detalle: detalle,
          _en_camino: enCamino,
          _camino_lbl: enCamino ? `DESCARGA EN CAMINO (${comunaCamino})` : '',
        });
      }
      return out.sort((a, b) => {
        const da = parseDateSAP(a.fe_entrega), db2 = parseDateSAP(b.fe_entrega);
        return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
      });
    },
    // Tipo de entrega: ≥80% cap camión ⇒ CD-CLIENTE (camión directo al cliente);
    // menos ⇒ CD-SUCURSAL (se consolida con carga).
    postFilter(filas) {
      filas.forEach(r => {
        const cap = getCapacidadCamion(r.ofvta);
        r._directo = r._ton_num >= cap * 0.80;
        r._tipo_entrega = r._directo ? 'CD-CLIENTE' : 'CD-SUCURSAL';
      });
      return filas;
    },
    rowClsFn(r) { return r._directo ? 'bg-green-50' : ''; },
    columnas: [
      { key: '_tipo_entrega', label: 'Tipo de Entrega', clsFn: r => r._directo ? 'text-green-800 font-bold' : 'text-blue-700 font-bold' },
      { key: 'ofvta', label: 'Oficina de Ventas' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'deudor', label: 'ID Vendedor' },
      { key: 'doc_ventas', label: 'Pedido de Venta', expandable: true },
      { key: 'fe_entrega', label: 'Fecha de Entrega', cls: 'num-clear' },
      { key: '_ton_totales', label: 'Toneladas Totales', cls: 'text-right num-clear font-bold' },
      { key: '_camino_lbl', label: 'Descarga en Camino', clsFn: () => 'text-teal-700 font-bold' },
      { key: '_estado', label: 'Estado', clsFn: () => 'text-[#e65100] font-bold' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── PEDIDOS TRASLADOS (Step 4) ────────────────────────────────────────────
  pedidos_traslados: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS TRASLADOS',
    vista: 'v_trc_sqvi_pedidos_traslados',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    extraChips: [{ campo: 'cesu', label: 'Centro Origen' }],
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'Buscar Pedido de Traslado', tipo: 'buscar' }],
    dateRange: { campo: 'fecha_confirmada', label: 'Rango Fecha Confirmada' },
    expand: {
      key: 'doc_compr', idKey: 'doc_compr', numCols: 1,
      headers: ['Pedido de Traslado','Tipo de Documento','Centro Origen','Centro Destino','Almacén Destino','ID Material','Nombre Material','Ctd Pedido PT','Ctd Confirmado','Pedido de Venta','Ton Total SKU'],
      build(row) {
        return (row._detalle || []).map(d => [
          d.doc_compr, d.cl, d.cesu, d.ce, d.alm, d.material, d.texto_breve, d.ctd_pedido, d.ctd_confirmada, d.documento, fmtNum(d.ton, 4),
        ]);
      },
    },
    transform(rows) {
      const validas = rows
        .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
        .filter(r => !String(r.material ?? '').startsWith('900000'));
      // Agrupar por Pedido de Traslado (doc_compr)
      const g = new Map();
      validas.forEach(r => {
        const pt = String(r.doc_compr ?? '').trim();
        if (!pt) return;
        (g.get(pt) || g.set(pt, []).get(pt)).push(r);
      });
      const out = [];
      for (const [pt, items] of g.entries()) {
        const f = items[0];
        let ton = 0;
        const detalle = items.map(r => {
          const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
          ton += t;
          return { doc_compr: pt, cl: r.cl, cesu: r.cesu, ce: r.ce, alm: r.alm,
                   material: r.material, texto_breve: r.texto_breve,
                   ctd_pedido: r.ctd_pedido, ctd_confirmada: r.ctd_confirmada,
                   documento: r.documento, ton: t };
        });
        const al = alertaFecha(f.fecha_confirmada, 7);
        out.push({
          doc_compr: pt, cesu: f.cesu, ce: f.ce, alm: f.alm,
          fecha_confirmada: f.fecha_confirmada, documento: f.documento,
          _ton_num: ton, _ton_totales: fmtNum(ton, 4),
          _alerta: al.txt, _alerta_cls: al.cls, _detalle: detalle,
        });
      }
      return out.sort((a, b) => {
        const da = parseDateSAP(a.fecha_confirmada), db2 = parseDateSAP(b.fecha_confirmada);
        return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
      });
    },
    columnas: [
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
      { key: 'cesu', label: 'Centro Expedición' },
      { key: 'doc_compr', label: 'Pedido de Traslado', expandable: true },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'fecha_confirmada', label: 'Fecha Confirmada', cls: 'num-clear' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right num-clear font-bold' },
    ],
  },

  // ── PEDIDOS DE TRASLADO REVEX (material 900000) ───────────────────────────
  pedidos_traslados_revex: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE TRASLADO REVEX',
    vista: 'v_trc_sqvi_pedidos_traslados',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'BUSCAR PEDIDO DE TRASLADO', tipo: 'buscar' }],
    dateRange: { campo: 'fecha_confirmada', label: 'Rango Fecha Confirmada' },
    transform(rows) {
      return rows
        .filter(r => String(r.material ?? '').startsWith('900000'))
        .map(r => {
          const al = alertaFecha(r.fecha_confirmada, 7);
          // (AJUSTE) Ton = segunda columna de peso neto (peso_neto_2) × cantidad pedida.
          const pm = parseNum(r.peso_neto_2);
          return { ...r, _ton_totales: fmtNum(calcTon(pm, r.ctd_pedido), 4), _alerta: al.txt, _alerta_cls: al.cls };
        })
        .sort((a, b) => {
          const da = parseDateSAP(a.fecha_confirmada), db2 = parseDateSAP(b.fecha_confirmada);
          return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
        });
    },
    columnas: [
      { key: 'cesu', label: 'Centro Expedición' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'cl', label: 'Tipo de Documento' },
      { key: 'doc_compr', label: 'Pedido de Traslado' },
      { key: 'material', label: 'ID Material' },
      { key: 'texto_breve', label: 'Nombre Material' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'ctd_pedido', label: 'Ctd Pedido', cls: 'text-right num-clear' },
      { key: 'ump', label: 'UM Pedido' },
      { key: 'fecha_confirmada', label: 'Fecha Confirmada', cls: 'num-clear' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right num-clear font-bold' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── STOCK ALMACÉN 4000 (unifica Stock + Plan Troncales) ───────────────────
  stock_almacen: {
    titulo: 'GESTIÓN TRONCALES – STOCK ALMACÉN 4000',
    chipFilter: { campo: 'ce', label: 'Centro' },
    modes: [
      {
        id: 'stock', label: 'STOCK',
        vista: 'v_trc_sqvi_plan_troncales',
        transform(rows) {
          return rows
            .filter(r => String(r.material ?? '').trim() !== '')
            .filter(r => !String(r.ce ?? '').startsWith('*'))
            .map(r => {
              const pm = maxPesoDim(r.peso_bruto, r.tamano_dimens);
              return { ...r, _peso_mayor: fmtNum(pm, 2), _ton_totales: fmtNum(calcTon(pm, r.libre_utiliz), 3) };
            });
        },
        columnas: [
          { key: 'ce', label: 'Centro Destino' },
          { key: 'alm', label: 'Almacén Destino' },
          { key: 'material', label: 'ID Material' },
          { key: 'texto_breve_de_material', label: 'Nombre Material' },
          { key: 'umb', label: 'UN Pedido' },
          { key: 'libre_utiliz', label: 'Cantidad Disponible', cls: 'text-right font-data-mono' },
          { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
          { key: '_ton_totales', label: 'Toneladas Totales', cls: 'text-right font-data-mono font-bold' },
        ],
      },
      {
        id: 'pedidos', label: 'PEDIDO DE VENTAS',
        vista: 'v_trc_sqvi_stock_almacen_4000',
        transform(rows) {
          return rows.map(r => {
            const rl = lookupRuta(r.ruta);
            const pm = maxPesoDim(r.peso_bruto, r.tamano_dimens);
            return { ...r, _comuna: rl.comuna, _region: rl.region, _peso_mayor: fmtNum(pm, 2), _ton_totales: fmtNum(calcTon(pm, r.libre_utiliz), 3) };
          });
        },
        columnas: [
          { key: 'ce', label: 'Centro Destino' },
          { key: 'alm', label: 'Almacén Destino' },
          { key: 'material', label: 'ID Material' },
          { key: 'denominacion_de_posicion', label: 'Nombre Material' },
          { key: 'libre_utiliz', label: 'Cantidad Disponible', cls: 'text-right font-data-mono' },
          { key: 'umb', label: 'UM Pedido' },
          { key: 'ruta', label: 'Ruta' },
          { key: '_comuna', label: 'Comuna' },
          { key: '_region', label: 'Región' },
          { key: 'deudor', label: 'ID Vendedor' },
          { key: 'documento', label: 'Pedido de Ventas' },
          { key: 'creado', label: 'Fecha de Entrega' },
          { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
          { key: '_ton_totales', label: 'Toneladas Totales', cls: 'text-right font-data-mono font-bold' },
        ],
      },
    ],
  },

  // ── PEDIDOS DE TRASLADOS 4000 (Step 5) ────────────────────────────────────
  pedidos_traslados_4000: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE TRASLADOS 4000',
    vista: 'v_trc_sqvi_pedidos_traslados_4000',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    extraChips: [{ campo: '_origen', label: 'Origen' }],
    filtros: [{ campo: 'doc_compr', label: 'Buscar Pedido de Traslado', tipo: 'buscar' }],
    transform(rows) {
      return rows
        // Sólo pedidos cuya cantidad confirmada (ctd_pedido) > cantidad de salida
        .filter(r => parseNum(r.ctd_pedido) > parseNum(r.cantidad_salida))
        .map(r => {
          const pm = maxPesoDim(r.peso_neto, r.tamano_dimens);
          const origen = String(r.documento ?? '').trim() ? 'PEDIDO DE VENTAS' : 'STOCK';
          return { ...r, _origen: origen, _peso_mayor: fmtNum(pm, 2), _ton_totales: fmtNum(calcTon(pm, r.cantidad_salida), 3) };
        });
    },
    columnas: [
      { key: 'cesu', label: 'Centro Expedición' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'doc_compr', label: 'Pedido de Traslado' },
      { key: 'material', label: 'ID Material' },
      { key: 'texto_breve', label: 'Nombre Material' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: '_origen', label: 'Origen', clsFn: r => r._origen === 'PEDIDO DE VENTAS' ? 'text-blue-700 font-bold' : 'text-green-700 font-bold' },
      { key: 'ctd_pedido', label: 'Ctd Confirmada', cls: 'text-right font-data-mono' },
      { key: 'cantidad_salida', label: 'Ctd Salida', cls: 'text-right font-data-mono' },
      { key: 'ump', label: 'UM Pedido' },
      { key: 'fe_entrega', label: 'Fecha Entrega' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
    ],
  },
};

// Etiqueta contadora (badge)
function badgePill(label, count, cls) {
  return `<span class="inline-flex items-center gap-xs px-sm py-xs rounded-full text-[12px] font-bold ${cls}">
    <span class="material-symbols-outlined text-[15px]">label_important</span>${escapeHtml(label)}: ${count}</span>`;
}

// ============================================================================
// ENTRADA PRINCIPAL
// ============================================================================
export async function renderAbastecimientoView(container) {
  rootEl = container;
  container.innerHTML = '<div id="ab-stage"></div>';
  const stage = container.querySelector('#ab-stage');
  if (currentSub === 'calendario')          await renderCalendario(stage);
  else if (currentSub === 'plan_carga')      await renderPlanCarga(stage);
  else if (VISTAS_TRONCAL[currentSub])       await renderVistaTabla(stage, VISTAS_TRONCAL[currentSub]);
  else                                       await renderProveedores(stage);
}

async function fetchAllRows(vista) {
  const pageSize = 1000;
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await supabase.from(vista).select('*').range(from, from + pageSize - 1);
    if (error) { console.error(error); showAlert('Error al cargar datos: ' + error.message, 'error'); break; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize || from > 60000) break;
    from += pageSize;
  }
  return all;
}

// ============================================================================
// PLAN DE CARGA — Dashboard de consolidación por sucursal
// ============================================================================
const CAP_CAMION_DEFAULT = 28;
const CAP_CAMION_REDUCIDO = 15;
const CENTROS_CAMION_REDUCIDO = ['1050', '1005'];

function getCapacidadCamion(centroId) {
  return CENTROS_CAMION_REDUCIDO.includes(String(centroId)) ? CAP_CAMION_REDUCIDO : CAP_CAMION_DEFAULT;
}

function getCentrosProgramados(calendarioRows, diaNum) {
  const programados = new Set();
  calendarioRows
    .filter(r => Number(r.dia) === diaNum && (r.habilitado === true || r.habilitado === 'true'))
    .forEach(r => {
      if (r.centro_destino_1) programados.add(String(r.centro_destino_1).trim());
      if (r.centro_destino_2) programados.add(String(r.centro_destino_2).trim());
    });
  return programados;
}

function fechaEnRango(fechaStr, diasAntes, diasDespues) {
  const d = parseDateSAP(fechaStr);
  if (!d) return false;
  const hoy = hoy00();
  const diff = Math.floor((d - hoy) / 86400000);
  return diff >= -diasAntes && diff <= diasDespues;
}

let planDetalleAbierto = new Set();

async function renderPlanCarga(stage) {
  stage.innerHTML = '<div class="text-secondary text-body-md p-md">Cargando Plan de Carga…</div>';

  const [quiebresRaw, trasladosRaw, revexRaw, retirosRaw, ventasRaw, traslados4000Raw, calendarioRows] = await Promise.all([
    fetchAllRows('v_trc_slim_stock'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),
    fetchAllRows('v_trc_sqvi_retiros_fabrica'),
    fetchAllRows('v_trc_sqvi_pedidos_venta_1003'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados_4000'),
    fetchAllRows('abast_calendario'),
  ]);

  // Materiales quebrados por centro (≤7 días)
  const quiebresByCentro = {};
  quiebresRaw
    .filter(r => CENTROS_QUIEBRES.includes(String(r.centro ?? '').trim()))
    .forEach(r => {
      const ce = String(r.centro).trim();
      const sd = parseNum(r.stock_days);
      if (sd <= 7) {
        if (!quiebresByCentro[ce]) quiebresByCentro[ce] = new Set();
        quiebresByCentro[ce].add(String(r.codigo_articulo ?? '').trim());
      }
    });

  const traslados = trasladosRaw
    .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
    .filter(r => !String(r.material ?? '').startsWith('900000'));
  const revex = revexRaw.filter(r => String(r.material ?? '').startsWith('900000'));
  const retiros = retirosRaw
    .filter(r => !String(r.proveedor ?? '').startsWith('*'))
    .filter(r => String(r.contr ?? '').trim() !== '');
  const ventas = ventasRaw.filter(r => !String(r.mr ?? '').trim());
  const t4000 = traslados4000Raw;

  const centrosSet = new Set(CENTROS_QUIEBRES);
  const mananaTemp = new Date(); mananaTemp.setDate(mananaTemp.getDate() + 1);
  const centrosProgramados = getCentrosProgramados(calendarioRows, mananaTemp.getDay());

  const resultado = Array.from(centrosSet).map(ce => {
    const cap = getCapacidadCamion(ce);
    const quiebresMat = quiebresByCentro[ce] || new Set();
    const det = { quiebre: [], stock: [], revex: [], cross: [], ventaCons: [], retiro: [], cliente: [], fabSuc: [], fabCli: [] };
    const itemT = (r, t) => ({ pt: r.doc_compr, material: r.material, nombre: r.texto_breve, fecha: r.fecha_confirmada, ctd: r.ctd_confirmada, ton: t, pv: r.documento });

    // 1. Traslados Quiebre
    const tonQuiebre = traslados
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => quiebresMat.has(String(r.material ?? '').trim()))
      .filter(r => fechaEnRango(r.fecha_confirmada, 10, 5))
      .reduce((sum, r) => { const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada); det.quiebre.push(itemT(r, t)); return sum + t; }, 0);

    // 2. Traslados Stock / Abastecimiento
    const tonStock = traslados
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => !quiebresMat.has(String(r.material ?? '').trim()))
      .filter(r => fechaEnRango(r.fecha_confirmada, 10, 5))
      .reduce((sum, r) => { const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada); det.stock.push(itemT(r, t)); return sum + t; }, 0);

    // 3. REVEX (peso_neto_2 × ctd_pedido)
    const tonRevex = revex
      .filter(r => String(r.ce ?? '').trim() === ce)
      .reduce((sum, r) => { const t = calcTon(parseNum(r.peso_neto_2), r.ctd_pedido); det.revex.push(itemT(r, t)); return sum + t; }, 0);

    // 4. Crossdocking 4000 — SÓLO pendientes (ctd_pedido > cantidad_salida)
    const tonCross = t4000
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => parseNum(r.ctd_pedido) > parseNum(r.cantidad_salida))
      .filter(r => fechaEnRango(r.fe_entrega, 5, 5))
      .reduce((sum, r) => { const pend = parseNum(r.ctd_pedido) - parseNum(r.cantidad_salida); const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        det.cross.push({ pt: r.doc_compr, material: r.material, nombre: r.texto_breve, fecha: r.fe_entrega, ctd: r.ctd_pedido, ton: t, pv: r.documento }); return sum + t; }, 0);

    // 5. Notas de Venta 1003 (ofvta = centro): requiere ruta, excluye RETIRA.
    //    <80% cap ⇒ PEDIDO DE VENTA DIRECTA (consolida con la carga del CD).
    //    ≥80% cap ⇒ CAMIÓN CLIENTE (directo al cliente, no se consolida).
    const ventasCe = ventas
      .filter(r => String(r.ofvta ?? '').trim() === ce)
      .filter(r => String(r.ruta ?? '').trim() !== '')
      .filter(r => normTxt(r.ruta).indexOf('RETIRA') === -1)
      .filter(r => fechaEnRango(r.fe_entrega, 3, 5));
    const ventasPorDoc = {};
    ventasCe.forEach(r => { const d = String(r.doc_ventas ?? '').trim(); (ventasPorDoc[d] = ventasPorDoc[d] || []).push(r); });
    let tonVentaCliente = 0, tonVentaCons = 0;
    for (const [doc, items] of Object.entries(ventasPorDoc)) {
      const lineItems = []; let tonDoc = 0;
      items.forEach(r => {
        const pend = parseNum(r.ctd_confirmada) - parseNum(r.cantidad_entrg);
        if (pend <= 0) return;
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        tonDoc += t;
        const rl = lookupRuta(r.ruta);
        lineItems.push({ pv: doc, material: r.material, nombre: r.denominacion_de_posicion, cant: pend, ruta: r.ruta, comuna: rl.comuna, region: rl.region, fecha: r.fe_entrega, ton: t });
      });
      if (tonDoc <= 0) continue;
      if (tonDoc >= cap * 0.80) { tonVentaCliente += tonDoc; det.cliente.push(...lineItems); }
      else { tonVentaCons += tonDoc; det.ventaCons.push(...lineItems); }
    }

    // 6. Retiros proveedor CONSOLIDAR CD (alm=4000) → parte del CD. fecha -3/+2
    const retirosCons = retiros
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => String(r.alm ?? '').trim() === '4000')
      .filter(r => fechaEnRango(r.fe_entrega, 3, 2));
    const itemR = (r, cant, t) => ({ oc: r.doc_compr, idProv: r.proveedor, prov: r.nombre_1, material: r.material, nombre: r.texto_breve, fecha: r.fe_entrega, cant, ton: t, pv: r.documento });
    const tonRetiro = retirosCons.reduce((sum, r) => {
      const cant = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada);
      const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), cant);
      det.retiro.push(itemR(r, cant, t)); return sum + t;
    }, 0);

    // 6b. Retiros FÁBRICA (alm ≠ 4000, pendientes):
    //   - CAMIÓN FÁBRICA-CLIENTE: una OC asociada a pedido de venta cuyo total ≥85% cap.
    //   - CAMIÓN FÁBRICA-SUCURSAL: OC(s) del mismo proveedor (sin PV) cuyo total ≥85% cap.
    const retirosFab = retiros
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => String(r.alm ?? '').trim() !== '4000')
      .filter(r => fechaEnRango(r.fe_entrega, 3, 2))
      .filter(r => (parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada)) > 0);
    const ocCli = {}, provSuc = {};   // oc/proveedor -> { ton, items:[] }
    retirosFab.forEach(r => {
      const cant = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada);
      const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), cant);
      const item = itemR(r, cant, t);
      if (String(r.documento ?? '').trim() !== '') {
        const oc = String(r.doc_compr ?? '').trim();
        (ocCli[oc] = ocCli[oc] || { ton: 0, items: [] }); ocCli[oc].ton += t; ocCli[oc].items.push(item);
      } else {
        const p = String(r.proveedor ?? '').trim();
        (provSuc[p] = provSuc[p] || { ton: 0, items: [] }); provSuc[p].ton += t; provSuc[p].items.push(item);
      }
    });
    let tonFabCli = 0, tonFabSuc = 0;
    Object.values(ocCli).forEach(b => { if (b.ton >= cap * 0.85) { tonFabCli += b.ton; det.fabCli.push(...b.items); } });
    Object.values(provSuc).forEach(b => { if (b.ton >= cap * 0.85) { tonFabSuc += b.ton; det.fabSuc.push(...b.items); } });

    // Total del CAMIÓN CD (consolidado): traslados + revex + cross + venta
    // directa consolidada + retiro consolidar CD.
    const total = tonQuiebre + tonStock + tonRevex + tonCross + tonVentaCons + tonRetiro;
    const pct = cap > 0 ? Math.round(total / cap * 100) : 0;
    const faltan = cap - total;
    const enCalendario = centrosProgramados.has(ce);

    let status, statusCls;
    if (pct >= 80) { status = 'PROGRAMAR'; statusCls = 'bg-green-700 text-white'; }
    else if (pct >= 70) { status = 'REVISAR'; statusCls = 'bg-yellow-600 text-white'; }
    else { status = 'CARGA INSUFICIENTE'; statusCls = 'bg-gray-400 text-white'; }

    let obs = '';
    if (!enCalendario && pct >= 70) obs = 'CUPO EXTRA';
    if (enCalendario && pct < 70) obs = 'EN CALENDARIO - CARGA BAJA';

    return {
      ce, nombre: getNombreCentro(ce), cap,
      tonQuiebre, tonStock, tonRevex, tonCross, tonVentaCons, tonVentaCliente, tonRetiro, tonFabSuc, tonFabCli,
      total, faltan, pct, status, statusCls, obs, enCalendario,
      camionCliente: tonVentaCliente > 0, camionFabSuc: tonFabSuc > 0, camionFabCli: tonFabCli > 0,
      det,
    };
  }).sort((a, b) => {
    // (AJUSTE 3.0) Prioridad del día primero, luego % completitud
    if (a.enCalendario !== b.enCalendario) return a.enCalendario ? -1 : 1;
    return b.pct - a.pct;
  });

  const manana = new Date(); manana.setDate(manana.getDate() + 1);
  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const fechaLabel = `${diasSemana[manana.getDay()]}, ${manana.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  function truckSVG(pct) {
    const p = Math.min(pct, 100);
    const fill = pct >= 80 ? '#15803d' : pct >= 70 ? '#ca8a04' : '#9ca3af';
    const bgFill = '#e5e7eb';
    return `<svg viewBox="0 0 60 30" width="64" height="32" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="4" width="38" height="20" rx="2" fill="${bgFill}" stroke="#6b7280" stroke-width="1"/>
      <rect x="0" y="${4 + 20 * (1 - p/100)}" width="38" height="${20 * p/100}" rx="0" fill="${fill}" opacity="0.85"/>
      <path d="M38 10 h8 l8 8 v6 h-16 z" fill="${bgFill}" stroke="#6b7280" stroke-width="1"/>
      <circle cx="10" cy="27" r="3" fill="#374151"/><circle cx="28" cy="27" r="3" fill="#374151"/><circle cx="50" cy="27" r="3" fill="#374151"/>
    </svg>`;
  }
  const iconCamion = (cls) => `<span class="material-symbols-outlined text-[22px] ${cls}">local_shipping</span>`;

  const NCOLS = 16; // columnas de la tabla (para el colspan del detalle)

  // Tabla genérica de detalle. alignRight = Set de índices de columnas numéricas.
  function tablaDet(headers, filas, alignRight) {
    const head = headers.map((h, i) => `<th class="pr-md text-[10px] uppercase text-secondary ${alignRight.has(i) ? 'text-right' : 'text-left'}">${escapeHtml(h)}</th>`).join('');
    const body = filas.length
      ? filas.map(fila => `<tr class="border-b border-outline-variant/40">${fila.map((v, i) => `<td class="py-[2px] pr-md text-[12px] ${alignRight.has(i) ? 'text-right num-clear' : ''}">${escapeHtml(String(v ?? ''))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}" class="text-secondary text-[12px] py-xs">Sin ítems.</td></tr>`;
    return `<table class="w-full text-[12px] mb-xs"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  function blkWrap(lbl, items, tableHtml) {
    const sub = items.reduce((s, d) => s + (d.ton || 0), 0);
    return `<div class="mb-md">
      <div class="text-[12px] font-bold text-primary mb-xs">${escapeHtml(lbl)} <span class="text-secondary font-normal">(${fmtNum(sub, 4)} Ton)</span></div>
      ${tableHtml}</div>`;
  }
  // Bloque Traslados (Quiebre / Abastecimiento / REVEX / Crossdocking)
  function blkTraslado(lbl, items) {
    if (!items.length) return '';
    const filas = items.map(d => [d.pt, d.material, d.nombre, d.fecha, d.ctd, fmtNum(d.ton, 4), d.pv]);
    return blkWrap(lbl, items, tablaDet(
      ['Pedido de Traslado','ID Material','Nombre Material','Fecha de Entrega','Cantidad Confirmada','Ton SKU','Pedido de Venta'],
      filas, new Set([4, 5])));
  }
  // Bloque Retiros de Fábrica
  function blkRetiro(lbl, items) {
    if (!items.length) return '';
    const filas = items.map(d => [d.oc, d.idProv, d.prov, d.material, d.nombre, d.fecha, fmtNum(parseNum(d.cant), 1), fmtNum(d.ton, 4), d.pv]);
    return blkWrap(lbl, items, tablaDet(
      ['Orden de Compra','Id Proveedor','Proveedor','ID Material','Nombre Material','Fecha de Retiro','Cantidad','Ton SKU','Pedido de Venta'],
      filas, new Set([6, 7])));
  }
  // Bloque Pedidos de Venta
  function blkVenta(lbl, items) {
    if (!items.length) return '';
    const filas = items.map(d => [d.pv, d.material, d.nombre, fmtNum(parseNum(d.cant), 1), d.ruta, d.comuna, d.region, d.fecha, fmtNum(d.ton, 4)]);
    return blkWrap(lbl, items, tablaDet(
      ['Pedido de Venta','ID Material','Nombre Material','Cantidad','Id Ruta','Comuna','Región','Fecha de Entrega','Ton SKU'],
      filas, new Set([3, 8])));
  }

  const TRUCK_TITULOS = {
    cd: 'Camión CD (consolidado)',
    cliente: 'Camión Cliente (pedido de venta ≥80%)',
    fabSuc: 'Camión Fábrica-Sucursal (OC ≥85% sin pedido de venta)',
    fabCli: 'Camión Fábrica-Cliente (OC ≥85% con pedido de venta)',
  };

  function detalleRow(r, tipo) {
    let blocks = '';
    if (tipo === 'cd') blocks =
      blkTraslado('Pedidos de Traslados Quiebre', r.det.quiebre) +
      blkTraslado('Pedidos de Traslados Abastecimiento (Stock)', r.det.stock) +
      blkTraslado('Pedidos de Traslados REVEX', r.det.revex) +
      blkTraslado('Pedidos de Traslados Crossdocking', r.det.cross) +
      blkVenta('Pedidos de Venta Directa Consolidados', r.det.ventaCons) +
      blkRetiro('Retiros de Proveedor Consolidados (CD)', r.det.retiro);
    else if (tipo === 'cliente') blocks = blkVenta('Pedidos de Venta directos al cliente', r.det.cliente);
    else if (tipo === 'fabSuc') blocks = blkRetiro('Órdenes de Compra Fábrica-Sucursal', r.det.fabSuc);
    else if (tipo === 'fabCli') blocks = blkRetiro('Órdenes de Compra Fábrica-Cliente', r.det.fabCli);
    return `<tr class="bg-surface-container-low"><td colspan="${NCOLS}" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <h4 class="font-bold text-on-surface mb-sm text-[13px]">${escapeHtml(TRUCK_TITULOS[tipo] || '')} — ${escapeHtml(r.nombre)} (${r.ce})</h4>
        ${blocks || '<p class="text-secondary text-[12px]">Sin ítems.</p>'}
      </div></td></tr>`;
  }

  // Celda de camión clicable con drill-down.
  function truckCell(r, tipo, activo, contenido) {
    if (!activo) return '<td class="py-sm pr-md text-center"><span class="text-secondary">—</span></td>';
    const abierto = planDetalleAbierto.has(r.ce + '|' + tipo);
    return `<td class="py-sm pr-md text-center">
      <button data-truck="${r.ce}|${tipo}" title="Ver contenido del camión" class="inline-flex flex-col items-center cursor-pointer hover:opacity-80">
        ${contenido}
        <span class="text-[9px] text-primary font-bold">${abierto ? 'ocultar' : 'ver'}</span>
      </button></td>`;
  }

  const act = quiebresRaw.length ? horaChile(quiebresRaw[0].cargado_en) : '';

  function draw() {
    stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">GESTIÓN TRONCALES – PLAN DE CARGA</h3>
          <p class="text-[13px] text-secondary">Planificación: <strong>${escapeHtml(fechaLabel)}</strong>${act ? ' · datos actualizados ' + escapeHtml(act) : ''}</p>
        </div>
        <button data-refrescar title="Refrescar" class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
          <span class="material-symbols-outlined text-[16px] align-middle">refresh</span></button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead class="sticky top-0 bg-surface-container-lowest z-10">
            <tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b-2 border-primary/30">
              <th class="py-sm pr-md font-bold whitespace-nowrap">Sucursal</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">REVEX</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Ped. Traslados CrossDock</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Retiro Proveedor</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Ped. Traslados Quiebres</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Ped. Traslados Stock</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Ped. Venta Directa</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Total CD</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">Faltan [Ton]</th>
              <th class="py-sm pr-md text-right font-bold whitespace-nowrap">% Compl.</th>
              <th class="py-sm pr-md text-center font-bold whitespace-nowrap">Camión CD</th>
              <th class="py-sm pr-md text-center font-bold whitespace-nowrap">Status</th>
              <th class="py-sm pr-md text-center font-bold whitespace-nowrap">Camión Cliente</th>
              <th class="py-sm pr-md text-center font-bold whitespace-nowrap">Camión Fáb-Sucursal</th>
              <th class="py-sm pr-md text-center font-bold whitespace-nowrap">Camión Fáb-Cliente</th>
              <th class="py-sm pr-md font-bold whitespace-nowrap">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            ${resultado.map(r => {
              const rowBg = r.enCalendario ? 'bg-blue-50 border-l-4 border-l-primary' : 'bg-gray-50/60 opacity-90';
              const totalCls = r.pct >= 80 ? 'text-green-700' : r.pct >= 70 ? 'text-yellow-700' : 'text-red-600';
              const camCD = r.total > 0 ? truckSVG(r.pct) : '<span class="text-secondary text-[11px]">—</span>';
              const abiertos = ['cd','cliente','fabSuc','fabCli'].filter(tp => planDetalleAbierto.has(r.ce + '|' + tp));
              return `<tr class="border-b border-outline-variant/50 hover:bg-surface-container-low ${rowBg}">
                <td class="py-sm pr-md font-bold whitespace-nowrap">
                  ${r.enCalendario ? '<span class="inline-flex items-center gap-xs"><span class="material-symbols-outlined text-[16px] text-primary">calendar_today</span><span class="text-[9px] font-bold text-primary bg-primary/10 px-xs rounded">PRIORITARIO</span></span> ' : ''}
                  ${escapeHtml(r.nombre)}
                </td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonRevex, 1)}</td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonCross, 1)}</td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonRetiro, 1)}</td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonQuiebre, 1)}</td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonStock, 1)}</td>
                <td class="py-sm pr-md text-right num-clear">${fmtNum(r.tonVentaCons, 1)}</td>
                <td class="py-sm pr-md text-right num-clear font-bold ${totalCls}">${fmtNum(r.total, 1)}</td>
                <td class="py-sm pr-md text-right num-clear ${r.faltan < 0 ? 'text-red-600' : ''}">${fmtNum(r.faltan, 1)}</td>
                <td class="py-sm pr-md text-right num-clear font-bold">${r.pct}%</td>
                ${truckCell(r, 'cd', r.total > 0, camCD)}
                <td class="py-sm pr-md text-center"><span class="px-sm py-xs rounded text-[11px] font-bold ${r.statusCls}">${escapeHtml(r.status)}</span></td>
                ${truckCell(r, 'cliente', r.camionCliente, iconCamion('text-green-700') + '<div class="text-[9px] font-bold text-green-700">' + fmtNum(r.tonVentaCliente,1) + ' t</div>')}
                ${truckCell(r, 'fabSuc', r.camionFabSuc, iconCamion('text-blue-700') + '<div class="text-[9px] font-bold text-blue-700">' + fmtNum(r.tonFabSuc,1) + ' t</div>')}
                ${truckCell(r, 'fabCli', r.camionFabCli, iconCamion('text-purple-700') + '<div class="text-[9px] font-bold text-purple-700">' + fmtNum(r.tonFabCli,1) + ' t</div>')}
                <td class="py-sm pr-md text-[12px] ${r.obs.includes('EXTRA') ? 'text-blue-700 font-bold' : r.obs.includes('BAJA') ? 'text-orange-600 font-bold' : 'text-secondary'}">${escapeHtml(r.obs)}</td>
              </tr>
              ${abiertos.map(tp => detalleRow(r, tp)).join('')}`; }).join('')}
          </tbody>
        </table>
      </div>

      <div class="mt-md pt-sm border-t border-outline-variant flex flex-wrap gap-lg text-[12px] text-secondary items-center">
        <span class="inline-flex items-center gap-xs"><span class="material-symbols-outlined text-[14px] align-middle text-primary">calendar_today</span> PRIORITARIO = Centro en calendario de mañana</span>
        <span class="inline-flex items-center gap-xs">${iconCamion('text-green-700 text-[16px]')} Camión Cliente (venta ≥80%)</span>
        <span class="inline-flex items-center gap-xs">${iconCamion('text-blue-700 text-[16px]')} Camión Fábrica-Sucursal (OC ≥85% sin PV)</span>
        <span class="inline-flex items-center gap-xs">${iconCamion('text-purple-700 text-[16px]')} Camión Fábrica-Cliente (OC ≥85% con PV)</span>
        <span>Pincha cualquier camión para ver su contenido · Camión CD 1 por sucursal · Capacidad 28 Ton (15 Ton Calera/San Bernardo)</span>
      </div>
    </div>`;

    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => renderPlanCarga(stage));
    stage.querySelectorAll('[data-truck]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.truck;
      if (planDetalleAbierto.has(k)) planDetalleAbierto.delete(k); else planDetalleAbierto.add(k);
      draw();
    }));
  }

  draw();
}

// ============================================================================
// RENDER GENÉRICO DE VISTAS (chips, filtros, buscador, badges, drill-down,
// editable, modos, CSV)
// ============================================================================
async function renderVistaTabla(stage, cfg, modeIdx = 0) {
  // Config activa (soporta modos: STOCK / PEDIDO DE VENTAS)
  const active = cfg.modes
    ? Object.assign({}, cfg, cfg.modes[modeIdx])
    : cfg;

  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando ${escapeHtml(cfg.titulo)}…</div>`;
  const ctx = active.preload ? await active.preload() : {};
  const rawRows = await fetchAllRows(active.vista);
  const rows = active.transform ? active.transform(rawRows, ctx) : rawRows;

  const chip = active.chipFilter;
  const chipValues = chip ? Array.from(new Set(rows.map(r => String(r[chip.campo] ?? '')).filter(v => v))).sort() : [];
  let chipSel = 'all';

  const extraChips = (active.extraChips || []).map(ec => ({
    ...ec,
    values: Array.from(new Set(rows.map(r => String(r[ec.campo] ?? '')).filter(v => v))).sort(),
    sel: 'all',
  }));

  const filtroTextos = {};
  (active.filtros || []).forEach(f => { filtroTextos[f.campo] = ''; });
  let texto = '';
  let rangoDesde = '', rangoHasta = '';   // filtro por rango de fecha (dateRange)
  const expanded = new Set();

  // ISO (yyyy-mm-dd de <input type=date>) → Date 00:00
  function isoToDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function aplica() {
    const q = texto.trim().toLowerCase();
    const dr = active.dateRange;
    const dDesde = dr ? isoToDate(rangoDesde) : null;
    const dHasta = dr ? isoToDate(rangoHasta) : null;
    return rows.filter(r => {
      if (chip && chipSel !== 'all' && String(r[chip.campo] ?? '') !== chipSel) return false;
      for (const ec of extraChips) {
        if (ec.sel !== 'all' && String(r[ec.campo] ?? '') !== ec.sel) return false;
      }
      for (const f of (active.filtros || [])) {
        const fv = filtroTextos[f.campo]?.trim().toLowerCase();
        if (fv && !String(r[f.campo] ?? '').toLowerCase().includes(fv)) return false;
      }
      if (dr && (dDesde || dHasta)) {
        const d = parseDateSAP(r[dr.campo]);
        if (!d) return false;
        if (dDesde && d < dDesde) return false;
        if (dHasta && d > dHasta) return false;
      }
      if (q && !active.columnas.some(c => String(r[c.key] ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  const chipCls = (v) => 'vt-chip px-sm py-xs border rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ' +
    (chipSel === v ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');
  const chipCls2 = (ec, v) => 'vt-chip px-sm py-xs border rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ' +
    (ec.sel === v ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');

  function cellValue(r, c) {
    if (c.valueFn) return c.valueFn(r);
    return String(r[c.key] ?? '');
  }

  function renderCell(r, c) {
    const cls = c.clsFn ? c.clsFn(r) : (c.cls || '');
    // Editable (select persistente)
    if (c.editable && active.editable && active.editable.key === c.key) {
      const cur = r[c.key];
      const opts = active.editable.options.map(o => `<option value="${escapeHtml(o.v)}" ${o.v === cur ? 'selected' : ''}>${escapeHtml(o.l)}</option>`).join('');
      const estilo = cur === 'coordinado' ? 'text-green-700 font-bold border-green-400' : 'text-secondary border-outline-variant';
      return `<td class="py-xs pr-md whitespace-nowrap">
        <select data-edit="${escapeHtml(String(r[active.expand?.idKey] ?? r[c.key]))}" data-editgid="${escapeHtml(String(r[active.expand?.idKey] ?? ''))}"
          class="border rounded px-[6px] py-[3px] text-[12px] bg-surface-container-lowest outline-none ${estilo}">${opts}</select></td>`;
    }
    // Badge
    if (c.badge) {
      const bcls = c.badge(r);
      const v = cellValue(r, c);
      return `<td class="py-xs pr-md whitespace-nowrap">${v ? `<span class="px-sm py-[2px] rounded-full text-[11px] font-bold ${bcls}">${escapeHtml(v)}</span>` : ''}</td>`;
    }
    // Expandable (clickeable → drill-down)
    if (c.expandable && active.expand) {
      const id = String(r[active.expand.idKey] ?? '');
      const abierto = expanded.has(id);
      const v = escapeHtml(cellValue(r, c));
      return `<td class="py-xs pr-md whitespace-nowrap ${cls}">
        <button data-exp="${escapeHtml(id)}" class="inline-flex items-center gap-xs text-primary font-bold hover:underline cursor-pointer">
          <span class="material-symbols-outlined text-[15px]">${abierto ? 'expand_less' : 'expand_more'}</span>${v}</button></td>`;
    }
    return `<td class="py-xs pr-md whitespace-nowrap ${cls}">${escapeHtml(cellValue(r, c))}</td>`;
  }

  function detailRow(r, ncols) {
    const ex = active.expand;
    const nnum = ex.numCols || 2;
    const data = ex.build(r) || [];
    const head = ex.headers.map(h => `<th class="py-xs pr-md text-left text-[10px] uppercase text-secondary">${escapeHtml(h)}</th>`).join('');
    const body = data.length
      ? data.map(fila => `<tr class="border-b border-outline-variant/40">${fila.map((v, i) => `<td class="py-[2px] pr-md text-[12px] ${i >= fila.length - nnum ? 'text-right num-clear' : ''}">${escapeHtml(String(v ?? ''))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${ex.headers.length}" class="text-secondary text-[12px] py-xs">Sin detalle.</td></tr>`;
    return `<tr class="bg-surface-container-low"><td colspan="${ncols}" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <table class="w-full"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </div></td></tr>`;
  }

  function draw() {
    let filt = aplica();
    if (active.postFilter) filt = active.postFilter(filt, chipSel, ctx);
    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const act = rawRows.length ? horaChile(rawRows[0].cargado_en) : '';
    const badgesHtml = active.badges ? active.badges(filt, chipSel) : '';
    const ncols = active.columnas.length;

    const modosHtml = cfg.modes ? `<div class="flex items-center gap-xs mb-md">
      <span class="text-[11px] text-secondary font-bold uppercase mr-xs">Ver:</span>
      ${cfg.modes.map((m, i) => `<button data-modo="${i}" class="px-md py-xs border rounded text-[12px] font-bold uppercase transition-colors cursor-pointer ${i === modeIdx ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high'}">${escapeHtml(m.label)}</button>`).join('')}
    </div>` : '';

    stage.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
          <div>
            <h3 class="text-headline-sm font-bold text-on-surface">${escapeHtml(cfg.titulo)}</h3>
            <p class="text-[13px] text-secondary">${filt.length} registro(s)${act ? ' · actualizado ' + escapeHtml(act) : ''}</p>
          </div>
          <div class="flex items-center gap-sm">
            <button data-refrescar title="Refrescar" class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-[16px] align-middle">refresh</span></button>
            <button data-csv class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
              <span class="material-symbols-outlined text-[16px] align-middle mr-xs">download</span>CSV</button>
          </div>
        </div>

        ${modosHtml}
        ${badgesHtml ? `<div class="flex flex-wrap gap-sm mb-md">${badgesHtml}</div>` : ''}

        <div class="flex flex-wrap items-start gap-x-lg gap-y-sm mb-md">
          ${chip ? `<div class="flex items-center gap-xs flex-wrap">
            <span class="text-[11px] text-secondary font-bold uppercase mr-xs">${escapeHtml(chip.label)}:</span>
            <button class="${chipCls('all')}" data-chip="all">Todos</button>
            ${chipValues.map(v => `<button class="${chipCls(v)}" data-chip="${escapeHtml(v)}">${escapeHtml(v)} ${escapeHtml(getNombreCentro(v))}</button>`).join('')}
          </div>` : ''}
          ${extraChips.map((ec, idx) => ec.values.length ? `<div class="flex items-center gap-xs flex-wrap">
            <span class="text-[11px] text-secondary font-bold uppercase mr-xs">${escapeHtml(ec.label)}:</span>
            <button class="${chipCls2(ec, 'all')}" data-echip="${idx}" data-eval="all">Todos</button>
            ${ec.values.map(v => `<button class="${chipCls2(ec, v)}" data-echip="${idx}" data-eval="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
          </div>` : '').join('')}
          ${(active.filtros || []).map(f => `
            <label class="block">
              <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">${escapeHtml(f.label)}</span>
              <input data-filtro="${f.campo}" value="${escapeHtml(filtroTextos[f.campo] || '')}" placeholder="Buscar…"
                class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none w-48"/>
            </label>`).join('')}
          ${active.dateRange ? `<div class="flex items-end gap-sm">
            <label class="block">
              <span class="text-[11px] uppercase tracking-wide text-secondary font-bold inline-flex items-center gap-xs"><span class="material-symbols-outlined text-[15px]">calendar_month</span>${escapeHtml(active.dateRange.label)} — Desde</span>
              <input type="date" data-rango="desde" value="${escapeHtml(rangoDesde)}"
                class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">Hasta</span>
              <input type="date" data-rango="hasta" value="${escapeHtml(rangoHasta)}"
                class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
            </label>
            ${(rangoDesde || rangoHasta) ? `<button data-rango-clear class="mb-[2px] px-sm py-sm text-secondary hover:text-error text-[12px] font-bold" title="Limpiar rango"><span class="material-symbols-outlined text-[18px] align-middle">close</span></button>` : ''}
          </div>` : ''}
          ${active.noBuscar ? '' : `<label class="block">
            <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">${escapeHtml(active.searchLabel || 'Buscar general')}</span>
            <input data-buscar value="${escapeHtml(texto)}" placeholder="texto…"
              class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
          </label>`}
          <span class="text-[12px] text-secondary ml-auto self-end">${filt.length} fila(s)</span>
        </div>

        <div class="overflow-x-auto max-h-[68vh] overflow-y-auto">
          <table class="w-full text-[13px]">
            <thead class="sticky top-0 bg-surface-container-lowest z-10">
              <tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
                ${active.columnas.map(c => `<th class="py-sm pr-md whitespace-nowrap">${escapeHtml(c.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${shown.length === 0 ? `<tr><td colspan="${ncols}" class="py-lg text-center text-secondary">Sin datos.</td></tr>` :
                shown.map(r => {
                  const rowCls = active.rowClsFn ? active.rowClsFn(r) : '';
                  const id = active.expand ? String(r[active.expand.idKey] ?? '') : '';
                  const abierto = active.expand && expanded.has(id);
                  return `<tr class="border-b border-outline-variant/50 hover:bg-surface-container-low ${rowCls}">
                    ${active.columnas.map(c => renderCell(r, c)).join('')}
                  </tr>${abierto ? detailRow(r, ncols) : ''}`;
                }).join('')}
            </tbody>
          </table>
        </div>
        ${filt.length > MAX ? `<p class="text-[12px] text-secondary mt-sm">Mostrando ${MAX} de ${filt.length}. Usa los filtros para acotar.</p>` : ''}
      </div>`;

    // Listeners
    stage.querySelectorAll('[data-modo]').forEach(btn => btn.addEventListener('click', () => renderVistaTabla(stage, cfg, parseInt(btn.dataset.modo))));
    stage.querySelectorAll('[data-chip]').forEach(btn => btn.addEventListener('click', () => { chipSel = btn.dataset.chip; draw(); }));
    stage.querySelectorAll('[data-echip]').forEach(btn => btn.addEventListener('click', () => { extraChips[parseInt(btn.dataset.echip)].sel = btn.dataset.eval; draw(); }));
    stage.querySelectorAll('[data-filtro]').forEach(inp => inp.addEventListener('input', e => {
      filtroTextos[inp.dataset.filtro] = e.target.value; draw();
      const el = stage.querySelector(`[data-filtro="${inp.dataset.filtro}"]`);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }));
    const inp = stage.querySelector('[data-buscar]');
    if (inp) inp.addEventListener('input', e => {
      texto = e.target.value; draw();
      const i = stage.querySelector('[data-buscar]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    });
    stage.querySelectorAll('[data-rango]').forEach(el => el.addEventListener('change', e => {
      if (el.dataset.rango === 'desde') rangoDesde = e.target.value; else rangoHasta = e.target.value;
      draw();
    }));
    stage.querySelector('[data-rango-clear]')?.addEventListener('click', () => { rangoDesde = ''; rangoHasta = ''; draw(); });
    stage.querySelectorAll('[data-exp]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.exp;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      draw();
    }));
    stage.querySelectorAll('[data-edit]').forEach(sel => sel.addEventListener('change', async () => {
      const id = sel.dataset.editgid || sel.dataset.edit;
      const row = rows.find(r => String(r[active.expand?.idKey] ?? '') === String(id));
      if (row && active.editable) { row[active.editable.key] = sel.value; await active.editable.onChange(row, sel.value, ctx); draw(); }
    }));
    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => renderVistaTabla(stage, cfg, modeIdx));
    stage.querySelector('[data-csv]')?.addEventListener('click', () => exportarCSV(active, filt));
  }

  draw();
}

function exportarCSV(cfg, filas) {
  const headers = cfg.columnas.map(c => c.label);
  const esc = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const val = (r, c) => c.valueFn ? c.valueFn(r) : r[c.key];
  const lines = [headers.join(';')].concat(filas.map(r => cfg.columnas.map(c => esc(val(r, c))).join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (cfg.titulo || 'export').replace(/[^\w]+/g, '_') + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ============================================================================
// SUBMENU 1: PROVEEDORES
// ============================================================================
async function loadProveedores() {
  const { data, error } = await supabase
    .from('abast_proveedores')
    .select('*, direcciones:abast_proveedor_direcciones(*)')
    .order('nombre', { ascending: true });
  if (error) { console.error(error); showAlert('Error al cargar proveedores: ' + error.message, 'error'); return []; }
  return data || [];
}

async function renderProveedores(stage) {
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando proveedores…</div>`;
  proveedores = await loadProveedores();

  let filtro = '';

  function draw() {
    const q = filtro.trim().toLowerCase();
    const rows = proveedores.filter(p => !q
      || (p.nombre || '').toLowerCase().includes(q)
      || (p.id || '').toLowerCase().includes(q)
      || (p.contacto_nombre || '').toLowerCase().includes(q));

    stage.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div>
            <h3 class="text-headline-sm font-bold text-on-surface">GESTIÓN TRONCALES – PROVEEDORES</h3>
            <p class="text-[13px] text-secondary">Contactos y direcciones de fabrica para retiro de material</p>
          </div>
          <button id="ab-nuevo-prov"
            class="bg-primary text-on-primary px-md py-sm rounded-lg text-body-md font-bold hover:opacity-90 transition-opacity">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">add</span>Nuevo Proveedor
          </button>
        </div>

        <div class="mb-md">
          <input id="ab-prov-buscar" value="${escapeHtml(filtro)}" placeholder="Buscar por ID, nombre o contacto…"
            class="w-full md:w-1/2 border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none" />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-body-md">
            <thead>
              <tr class="text-left text-[12px] uppercase tracking-wide text-secondary border-b border-outline-variant">
                <th class="py-sm pr-md">ID</th>
                <th class="py-sm pr-md">Proveedor</th>
                <th class="py-sm pr-md">Contacto</th>
                <th class="py-sm pr-md">Correo</th>
                <th class="py-sm pr-md">Telefono</th>
                <th class="py-sm pr-md text-center">Fabricas</th>
                <th class="py-sm pr-md text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `
                <tr><td colspan="7" class="py-lg text-center text-secondary">Sin proveedores registrados.</td></tr>
              ` : rows.map(p => `
                <tr class="border-b border-outline-variant/60 hover:bg-surface-container-low">
                  <td class="py-sm pr-md font-data-mono text-[13px]">${escapeHtml(p.id)}</td>
                  <td class="py-sm pr-md font-semibold">${escapeHtml(p.nombre || '')}
                    ${p.activo === false ? '<span class="ml-xs text-[11px] text-error">(inactivo)</span>' : ''}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_nombre || '—')}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_correo || '—')}</td>
                  <td class="py-sm pr-md">${escapeHtml(p.contacto_telefono || '—')}</td>
                  <td class="py-sm pr-md text-center">
                    <span class="inline-flex items-center justify-center min-w-[24px] h-[24px] px-xs rounded-full bg-surface-container-high text-[12px] font-bold">
                      ${(p.direcciones || []).length}</span>
                  </td>
                  <td class="py-sm pr-md text-right whitespace-nowrap">
                    <button data-dir="${escapeHtml(p.id)}" title="Direcciones de fabrica"
                      class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">factory</span></button>
                    <button data-edit="${escapeHtml(p.id)}" title="Editar"
                      class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                    <button data-del="${escapeHtml(p.id)}" title="Eliminar"
                      class="text-secondary hover:text-error p-xs"><span class="material-symbols-outlined text-[20px]">delete</span></button>
                  </td>
                </tr>
                ${selectedProveedorId === p.id ? renderDireccionesPanel(p) : ''}
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const search = stage.querySelector('#ab-prov-buscar');
    search.addEventListener('input', e => { filtro = e.target.value; draw();
      const s = stage.querySelector('#ab-prov-buscar'); if (s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length);} });
    stage.querySelector('#ab-nuevo-prov').addEventListener('click', () => openProveedorModal(null, draw));
    stage.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click',
      () => openProveedorModal(proveedores.find(x => x.id === b.dataset.edit), draw)));
    stage.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click',
      () => deleteProveedor(b.dataset.del, draw)));
    stage.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
      selectedProveedorId = selectedProveedorId === b.dataset.dir ? null : b.dataset.dir;
      draw();
    }));

    wireDireccionesPanel(stage, draw);
  }

  draw();
}

function renderDireccionesPanel(p) {
  const dirs = p.direcciones || [];
  return `
    <tr class="bg-surface-container-low"><td colspan="7" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <div class="flex items-center justify-between mb-sm">
          <h4 class="font-bold text-on-surface">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">factory</span>
            Direcciones de fabrica — ${escapeHtml(p.nombre || p.id)}
          </h4>
          <button data-adddir="${escapeHtml(p.id)}"
            class="bg-surface-container-high text-on-surface px-sm py-xs rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
            <span class="material-symbols-outlined text-[16px] align-middle mr-xs">add_location_alt</span>Agregar direccion
          </button>
        </div>
        ${dirs.length === 0 ? `<p class="text-secondary text-[13px] py-sm">Sin direcciones registradas. Agrega la ubicacion de la fabrica o bodega de retiro.</p>` : `
        <table class="w-full text-[13px]">
          <thead><tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
            <th class="py-xs pr-md">Fabrica / Planta</th><th class="py-xs pr-md">Direccion</th>
            <th class="py-xs pr-md">Comuna</th><th class="py-xs pr-md">Region</th><th class="py-xs text-right">Acciones</th>
          </tr></thead>
          <tbody>
            ${dirs.map(d => `
              <tr class="border-b border-outline-variant/50">
                <td class="py-xs pr-md">${escapeHtml(d.nombre_fabrica || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.direccion || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.comuna || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.region || '—')}</td>
                <td class="py-xs text-right whitespace-nowrap">
                  <button data-editdir="${d.id}" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                  <button data-deldir="${d.id}" class="text-secondary hover:text-error p-xs"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    </td></tr>
  `;
}

function wireDireccionesPanel(stage, redraw) {
  stage.querySelectorAll('[data-adddir]').forEach(b => b.addEventListener('click',
    () => openDireccionModal(b.dataset.adddir, null, redraw)));
  stage.querySelectorAll('[data-editdir]').forEach(b => b.addEventListener('click', () => {
    const prov = proveedores.find(p => p.id === selectedProveedorId);
    const dir = (prov?.direcciones || []).find(d => String(d.id) === b.dataset.editdir);
    openDireccionModal(selectedProveedorId, dir, redraw);
  }));
  stage.querySelectorAll('[data-deldir]').forEach(b => b.addEventListener('click',
    () => deleteDireccion(b.dataset.deldir, redraw)));
}

function modalShell(titulo, bodyHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md';
  wrap.innerHTML = `
    <div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <h3 class="text-headline-sm font-bold text-on-surface">${escapeHtml(titulo)}</h3>
        <button data-close class="text-secondary hover:text-error"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="p-lg">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  return { wrap, close };
}

function field(label, id, value = '', type = 'text', extra = '') {
  return `
    <label class="block mb-sm">
      <span class="text-[12px] uppercase tracking-wide text-secondary font-bold">${label}</span>
      <input id="${id}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra}
        class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none" />
    </label>`;
}

function openProveedorModal(prov, redraw) {
  const esNuevo = !prov;
  const { wrap, close } = modalShell(esNuevo ? 'Nuevo Proveedor' : 'Editar Proveedor', `
    ${field('ID Proveedor', 'f-id', prov?.id || '', 'text', esNuevo ? '' : 'disabled')}
    ${field('Nombre Proveedor', 'f-nombre', prov?.nombre || '')}
    ${field('Nombre Contacto', 'f-cnombre', prov?.contacto_nombre || '')}
    ${field('Correo Contacto', 'f-ccorreo', prov?.contacto_correo || '', 'email')}
    ${field('Telefono Contacto', 'f-ctel', prov?.contacto_telefono || '')}
    <label class="flex items-center gap-sm mt-sm mb-md text-body-md">
      <input id="f-activo" type="checkbox" ${prov?.activo === false ? '' : 'checked'} class="w-4 h-4"/>
      <span>Proveedor activo</span>
    </label>
    <div class="flex justify-end gap-sm">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>
  `);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async () => {
    const id = wrap.querySelector('#f-id').value.trim();
    const nombre = wrap.querySelector('#f-nombre').value.trim();
    if (!id)     { showAlert('El ID del proveedor es obligatorio', 'error'); return; }
    if (!nombre) { showAlert('El nombre del proveedor es obligatorio', 'error'); return; }
    const payload = {
      id, nombre,
      contacto_nombre: wrap.querySelector('#f-cnombre').value.trim() || null,
      contacto_correo: wrap.querySelector('#f-ccorreo').value.trim() || null,
      contacto_telefono: wrap.querySelector('#f-ctel').value.trim() || null,
      activo: wrap.querySelector('#f-activo').checked,
      updated_at: new Date().toISOString(),
      updated_by: await getUserEmail(),
    };
    const { error } = await supabase.from('abast_proveedores').upsert(payload);
    if (error) { showAlert('Error al guardar: ' + error.message, 'error'); return; }
    showAlert('Proveedor guardado', 'success');
    close();
    proveedores = await loadProveedores();
    redraw();
  });
}

async function deleteProveedor(id, redraw) {
  if (!confirm('¿Eliminar el proveedor y todas sus direcciones de fabrica?')) return;
  const { error } = await supabase.from('abast_proveedores').delete().eq('id', id);
  if (error) { showAlert('Error al eliminar: ' + error.message, 'error'); return; }
  if (selectedProveedorId === id) selectedProveedorId = null;
  showAlert('Proveedor eliminado', 'success');
  proveedores = await loadProveedores();
  redraw();
}

function openDireccionModal(proveedorId, dir, redraw) {
  const esNueva = !dir;
  const { wrap, close } = modalShell(esNueva ? 'Nueva direccion de fabrica' : 'Editar direccion', `
    ${field('Fabrica / Planta (etiqueta)', 'd-fab', dir?.nombre_fabrica || '')}
    ${field('Direccion', 'd-dir', dir?.direccion || '')}
    ${field('Comuna', 'd-com', dir?.comuna || '')}
    ${field('Region', 'd-reg', dir?.region || '')}
    <div class="flex justify-end gap-sm mt-md">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>
  `);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async () => {
    const payload = {
      proveedor_id: proveedorId,
      nombre_fabrica: wrap.querySelector('#d-fab').value.trim() || null,
      direccion: wrap.querySelector('#d-dir').value.trim() || null,
      comuna: wrap.querySelector('#d-com').value.trim() || null,
      region: wrap.querySelector('#d-reg').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (esNueva) {
      ({ error } = await supabase.from('abast_proveedor_direcciones').insert(payload));
    } else {
      ({ error } = await supabase.from('abast_proveedor_direcciones').update(payload).eq('id', dir.id));
    }
    if (error) { showAlert('Error al guardar direccion: ' + error.message, 'error'); return; }
    showAlert('Direccion guardada', 'success');
    close();
    proveedores = await loadProveedores();
    redraw();
  });
}

async function deleteDireccion(id, redraw) {
  if (!confirm('¿Eliminar esta direccion de fabrica?')) return;
  const { error } = await supabase.from('abast_proveedor_direcciones').delete().eq('id', id);
  if (error) { showAlert('Error al eliminar: ' + error.message, 'error'); return; }
  showAlert('Direccion eliminada', 'success');
  proveedores = await loadProveedores();
  redraw();
}

// ============================================================================
// SUBMENU 2: CALENDARIO SUCURSALES  (rediseño moderno)
// ============================================================================
function getCentros() {
  const db = getDatabase();
  return (db.logisticsCentres || []).slice().sort((a, b) =>
    String(a.nombre || a.id).localeCompare(String(b.nombre || b.id)));
}

function getNombreCentro(id) {
  const db = getDatabase();
  const c = (db.logisticsCentres || []).find(x => x.id === id);
  return c ? (c.nombre || id) : id;
}

async function loadCalendario(centro) {
  const { data, error } = await supabase
    .from('abast_calendario').select('*').eq('centro', centro);
  if (error) { console.error(error); showAlert('Error al cargar calendario: ' + error.message, 'error'); return {}; }
  const m = {};
  (data || []).forEach(r => { m[`${r.dia}-${r.bloque}`] = r; });
  return m;
}

async function renderCalendario(stage) {
  if (!CALENDARIOS[calOrigen]) calOrigen = '1003';

  stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant shadow-sm rounded-xl overflow-hidden">
      <div class="bg-gradient-to-r from-primary to-primary/80 px-lg py-md flex flex-wrap items-center justify-between gap-md">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-white text-[28px]">event_available</span>
          <div>
            <h3 class="text-headline-sm font-bold text-white leading-tight">GESTIÓN TRONCALES – CALENDARIO SUCURSALES</h3>
          </div>
        </div>
        <div class="flex gap-sm">
          ${Object.entries(CALENDARIOS).map(([id, c]) => `
            <button data-origen="${id}" class="px-md py-sm rounded-lg text-[13px] font-bold transition-all
              ${calOrigen === id ? 'bg-white text-primary shadow' : 'bg-white/20 text-white hover:bg-white/30'}">
              <span class="material-symbols-outlined text-[16px] align-middle mr-xs">warehouse</span>${escapeHtml(c.nombre)} (${id})
            </button>`).join('')}
        </div>
      </div>

      <div id="cal-msg"></div>
      <div class="p-lg">
        <div id="cal-grid"></div>
        <div class="flex items-center justify-end gap-md mt-lg">
          <span id="cal-inline-ok" class="hidden items-center gap-xs text-green-700 font-bold text-[13px]">
            <span class="material-symbols-outlined text-[18px]">check_circle</span>Calendario guardado correctamente
          </span>
          <button id="cal-save" class="bg-primary text-white px-lg py-sm rounded-lg font-bold hover:opacity-90 shadow-sm transition-all inline-flex items-center gap-xs">
            <span class="material-symbols-outlined text-[18px]">save</span>Guardar calendario
          </button>
        </div>
      </div>
    </div>
  `;

  stage.querySelectorAll('[data-origen]').forEach(btn => btn.addEventListener('click', async () => {
    calOrigen = btn.dataset.origen;
    await renderCalendario(stage);
  }));

  calMatrix = await loadCalendario(calOrigen);
  drawGrid(stage);

  stage.querySelector('#cal-save').addEventListener('click', () => saveCalendario(stage));
}

function drawGrid(stage) {
  const grid = stage.querySelector('#cal-grid');
  const cfg = CALENDARIOS[calOrigen];
  const dias = cfg.dias;
  const bloquesBase = cfg.bloques;
  const destinos = cfg.destinos;

  const optsHtml = `<option value="">— vacío —</option>` +
    destinos.map(id => `<option value="${id}">${id} ${escapeHtml(getNombreCentro(id))}</option>`).join('');

  grid.innerHTML = `
    <div class="overflow-x-auto rounded-lg border border-outline-variant">
      <table class="w-full text-[13px] border-collapse">
        <thead>
          <tr class="text-left text-[11px] uppercase tracking-wide text-secondary bg-surface-container-high">
            <th class="py-sm px-md border-b border-outline-variant w-[130px]">Bloque Horario</th>
            ${dias.map(d => `<th class="py-sm px-sm border-b border-l border-outline-variant text-center min-w-[150px]">
              <span class="material-symbols-outlined text-[15px] align-middle text-primary mr-xs">today</span>${escapeHtml(d.lbl)}
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${bloquesBase.map((bloque, bi) => `
            <tr class="${bi % 2 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/40'} hover:bg-primary/5 transition-colors">
              <td class="py-sm px-md font-data-mono font-bold text-primary whitespace-nowrap border-b border-outline-variant/50">
                <span class="material-symbols-outlined text-[15px] align-middle mr-xs">schedule</span>${bloque}</td>
              ${dias.map(d => {
                const dayBloques = d.bloques || bloquesBase;
                if (!dayBloques.includes(bloque)) {
                  return `<td class="py-sm px-sm text-center bg-surface-dim/20 border-b border-l border-outline-variant/40"><span class="text-[11px] text-secondary">—</span></td>`;
                }
                const key = `${d.n}-${bloque}`;
                const cell = calMatrix[key] || {};
                const d1 = cell.centro_destino_1 || '';
                const d2 = cell.centro_destino_2 || '';
                return `<td class="py-sm px-xs text-center border-b border-l border-outline-variant/40">
                  <div class="flex flex-col gap-[4px]">
                    <select data-dest="${key}-1" class="w-full border border-outline-variant rounded-md px-[6px] py-[4px] text-[11px] focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none bg-surface-container-lowest">
                      ${optsHtml.replace(`value="${d1}"`, `value="${d1}" selected`)}
                    </select>
                    <select data-dest="${key}-2" class="w-full border border-outline-variant rounded-md px-[6px] py-[4px] text-[11px] focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none bg-surface-container-lowest">
                      ${optsHtml.replace(`value="${d2}"`, `value="${d2}" selected`)}
                    </select>
                  </div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="text-[12px] text-secondary mt-sm inline-flex items-center gap-xs">
      <span class="material-symbols-outlined text-[14px]">info</span>
      Seleccione hasta 2 centros destino por bloque horario.
    </p>
  `;
}

async function saveCalendario(stage) {
  const grid = stage.querySelector('#cal-grid');
  const btn = stage.querySelector('#cal-save');
  const email = await getUserEmail();
  const now = new Date().toISOString();
  const cfg = CALENDARIOS[calOrigen];
  const rows = [];

  if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }

  cfg.dias.forEach(d => {
    const dayBloques = d.bloques || cfg.bloques;
    dayBloques.forEach(bloque => {
      const key = `${d.n}-${bloque}`;
      const sel1 = grid.querySelector(`[data-dest="${key}-1"]`);
      const sel2 = grid.querySelector(`[data-dest="${key}-2"]`);
      const cd1 = sel1?.value || null;
      const cd2 = sel2?.value || null;
      rows.push({
        centro: calOrigen, dia: d.n, bloque,
        habilitado: !!(cd1 || cd2),
        cupos: (cd1 ? 1 : 0) + (cd2 ? 1 : 0),
        sobre_cupo: false,
        centro_destino_1: cd1 || null,
        centro_destino_2: cd2 || null,
        updated_by: email, updated_at: now,
      });
    });
  });

  const { error } = await supabase
    .from('abast_calendario')
    .upsert(rows, { onConflict: 'centro,dia,bloque' });

  if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }

  if (error) { showAlert('Error al guardar calendario: ' + error.message, 'error'); return; }

  // Confirmación visible de guardado exitoso (AJUSTE 3.0)
  showAlert('✓ Calendario guardado correctamente', 'success');
  const msg = stage.querySelector('#cal-msg');
  if (msg) {
    msg.innerHTML = `<div class="mx-lg mt-md px-md py-sm rounded-lg bg-green-50 border border-green-300 text-green-800 text-[13px] font-bold inline-flex items-center gap-xs">
      <span class="material-symbols-outlined text-[18px]">check_circle</span>Calendario guardado correctamente</div>`;
    setTimeout(() => { if (msg) msg.innerHTML = ''; }, 4000);
  }
  const inlineOk = stage.querySelector('#cal-inline-ok');
  if (inlineOk) { inlineOk.classList.remove('hidden'); inlineOk.classList.add('inline-flex'); setTimeout(() => { inlineOk.classList.add('hidden'); inlineOk.classList.remove('inline-flex'); }, 4000); }

  calMatrix = await loadCalendario(calOrigen);
}
