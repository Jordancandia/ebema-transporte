// ============================================================================
// GESTION TRONCALES / ABASTECIMIENTO
// ----------------------------------------------------------------------------
// Planificacion de cargas de productos a las sucursales desde CD (o cualquier
// origen). Dos submenus que se conectan entre si:
//   1. Proveedores  -> catalogo de proveedores + direcciones de fabrica
//                      (donde retirar material).
//   2. Calendario   -> calendario de carga por sucursal (centro logistico),
//      Sucursales      lunes a sabado, aperturado por bloques de horario.
//
// Persistencia: Supabase (tablas abast_proveedores, abast_proveedor_direcciones
// y abast_calendario, con RLS por rol/centro).
// ============================================================================

import { supabase } from './supabase-client.js';
import { getDatabase } from './data.js?v=20260714a';
import { showAlert, escapeHtml } from './utils.js';

// ── Configuracion de calendarios por centro origen ──────────────────────────
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
      { n: 6, lbl: 'Sábado',    corto: 'SAB', sobreCupo: true, bloques: ['07:30-11:30'] },
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
let calOrigen = '1003';            // centro origen seleccionado en calendario
let calMatrix = {};                // { 'dia-bloque': {habilitado, cupos, sobre_cupo, centro_destino_1, centro_destino_2} }
let rootEl = null;

// ── Utilidades ──────────────────────────────────────────────────────────────
async function getUserEmail() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email || null;
  } catch { return null; }
}

// Permite fijar el subtab desde el router del sidebar
export function setAbastSubTab(sub) {
  if (sub) currentSub = sub;
}

// ============================================================================
// HELPERS PARA VISTAS DE DATOS
// ============================================================================
// Parsea fecha SAP DD.MM.YYYY → Date (o null)
function parseDateSAP(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function hoy00() { const d = new Date(); d.setHours(0,0,0,0); return d; }

// Alerta de fecha vs hoy. diasUmbral = cuántos días para "PRONTO A VENCER"
function alertaFecha(fechaStr, diasUmbral = 5) {
  const d = parseDateSAP(fechaStr);
  if (!d) return { txt: '', cls: '' };
  const hoy = hoy00();
  const diff = Math.floor((d - hoy) / 86400000);
  if (diff < 0) return { txt: 'PEDIDO ATRASADO', cls: 'text-error font-bold' };
  if (diff <= diasUmbral) return { txt: 'PRONTO A VENCER', cls: 'text-[#e65100] font-bold' };
  return { txt: '', cls: '' };
}

// MAX(peso_bruto, tamano_dimens) en número
function maxPesoDim(peso, dim) {
  const p = parseFloat(String(peso ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  const d = parseFloat(String(dim ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  return Math.max(p, d);
}

// Tonelaje = pesoMax * cantidad / 1000
function calcTon(pesoMax, cantidad) {
  const c = parseFloat(String(cantidad ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  return pesoMax * c / 1000;
}

function fmtNum(n, dec = 2) {
  if (n == null || isNaN(n)) return '';
  return n.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Lookup ruta → {comuna, region} desde db.routes
function lookupRuta(rutaId) {
  if (!rutaId) return { comuna: '', region: '' };
  const db = getDatabase();
  const r = (db.routes || []).find(x => x.codigo === String(rutaId).trim());
  return r ? { comuna: r.comuna || '', region: r.region || '' } : { comuna: '', region: '' };
}

// Centros válidos para quiebres
const CENTROS_QUIEBRES = ['1005','1020','1040','1050','1060','1070','1080','1090','1100','1160'];

// ============================================================================
// VISTAS DE DATOS TRONCALES
// ============================================================================
const VISTAS_TRONCAL = {
  // ── QUIEBRES SUCURSAL (SLIM) ──────────────────────────────────────────────
  quiebres: {
    titulo: 'Quiebres Sucursal',
    vista: 'v_trc_slim_stock',
    chipFilter: { campo: 'centro', label: 'Centro' },
    filtros: [],
    transform(rows) {
      return rows
        .filter(r => CENTROS_QUIEBRES.includes(String(r.centro ?? '').trim()))
        .map(r => {
          const sd = parseFloat(String(r.stock_days ?? '').replace(',', '.')) || 0;
          const abc = String(r.clase_abc ?? '').trim().toUpperCase();
          let alerta = '', alertaCls = '';
          if (sd === 0) { alerta = 'PRODUCTO QUEBRADO'; alertaCls = 'text-error font-bold'; }
          else if (sd < 7) {
            if (['AA','AB','AC'].includes(abc)) { alerta = 'STOCK CRÍTICO'; alertaCls = 'text-error font-bold'; }
            else if (['BA','BB','BC'].includes(abc)) { alerta = 'STOCK ALERTA'; alertaCls = 'text-[#e65100] font-bold'; }
            else if (['CA','CB','CC'].includes(abc)) { alerta = 'STOCK REVISAR'; alertaCls = 'text-[#f9a825] font-bold'; }
          }
          return { ...r, _desc_centro: getNombreCentro(r.centro), _alerta: alerta, _alerta_cls: alertaCls, _sd_num: sd };
        })
        .sort((a, b) => a._sd_num - b._sd_num);
    },
    columnas: [
      { key: 'centro', label: 'Centro' },
      { key: '_desc_centro', label: 'Descripción Centro' },
      { key: 'codigo_articulo', label: 'Código Artículo' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'stock_days', label: 'StockDays', cls: 'text-right font-data-mono' },
      { key: 'clase_abc', label: 'Clase ABC', cls: 'text-center' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── RETIROS FÁBRICA (Step 1) ──────────────────────────────────────────────
  retiros: {
    titulo: 'Pedidos de Retiro',
    vista: 'v_trc_sqvi_retiros_fabrica',
    chipFilter: { campo: 'ce', label: 'Centro' },
    extraChips: [
      { campo: '_tipo_retiro', label: 'Tipo Retiro' },
      { campo: '_alerta', label: 'Alerta Pedido' },
      { campo: '_vigencia', label: 'Vigencia OC' },
    ],
    noBuscar: true,
    filtros: [],
    rowClsFn(r) { return r._revision_saldo ? 'bg-red-100' : ''; },
    transform(rows) {
      return rows
        // Ocultar subtotales y filas sin contrato de compra
        .filter(r => !String(r.proveedor ?? '').startsWith('*'))
        .filter(r => String(r.contr ?? '').trim() !== '')
        .map(r => {
          const al = alertaFecha(r.fe_entrega, 5);
          const ctdP = parseFloat(String(r.ctd_pedido ?? '').replace(/\./g, '').replace(',', '.')) || 0;
          const ctdE = parseFloat(String(r.ctd_entregada ?? '').replace(/\./g, '').replace(',', '.')) || 0;
          const pm = maxPesoDim(r.peso_bruto, r.tamano_dimens);
          const almVal = String(r.alm ?? '').trim();
          const tipoRetiro = almVal === '4000' ? 'CONSOLIDAR CD' : 'FABRICA-SUCURSAL';
          const revSaldo = (ctdE > 0 && ctdE < ctdP);
          return {
            ...r,
            _desc_centro: getNombreCentro(r.ce),
            _tipo_retiro: tipoRetiro,
            _diferencia: fmtNum(ctdP - ctdE, 0),
            _peso_mayor: fmtNum(pm, 2),
            _ton_totales: fmtNum(calcTon(pm, ctdP - ctdE), 3),
            _alerta: al.txt, _alerta_cls: al.cls,
            _revision_saldo: revSaldo,
            _vigencia: revSaldo ? 'REVISIÓN SALDO PEDIDO' : '',
          };
        })
        .sort((a, b) => {
          const da = parseDateSAP(a.fe_entrega), db2 = parseDateSAP(b.fe_entrega);
          return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
        });
    },
    columnas: [
      { key: 'contr', label: 'Contrato Compra' },
      { key: 'doc_compr', label: 'Orden de Compra' },
      { key: 'proveedor', label: 'ID Proveedor' },
      { key: 'nombre_1', label: 'Nombre Proveedor' },
      { key: 'material', label: 'ID Material' },
      { key: 'texto_breve', label: 'Nombre Material' },
      { key: 'ce', label: 'Centro Destino' },
      { key: '_desc_centro', label: 'Desc. Centro' },
      { key: '_tipo_retiro', label: 'Tipo Retiro', clsFn: r => r._tipo_retiro === 'CONSOLIDAR CD' ? 'text-blue-700 font-bold' : 'text-green-700 font-bold' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'fe_entrega', label: 'Fecha de Retiro' },
      { key: 'ctd_pedido', label: 'Ctd Pedido OC', cls: 'text-right font-data-mono' },
      { key: 'ump', label: 'UM Compra' },
      { key: 'ctd_entregada', label: 'Ctd Entregada', cls: 'text-right font-data-mono' },
      { key: '_diferencia', label: 'Pendiente', cls: 'text-right font-data-mono font-bold' },
      { key: 'e', label: 'Ind. Stock Esp.' },
      { key: 'documento', label: 'Pedido de Ventas' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
      { key: '_vigencia', label: 'Vigencia OC', clsFn: r => r._revision_saldo ? 'text-red-700 font-bold' : '' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── PEDIDOS VENTAS 1003 (Step 2) ──────────────────────────────────────────
  pedidos_venta: {
    titulo: 'Pedidos Ventas 1003',
    vista: 'v_trc_sqvi_pedidos_venta_1003',
    chipFilter: { campo: 'ofvta', label: 'Oficina de Ventas' },
    filtros: [{ campo: 'doc_ventas', label: 'Pedido de Venta', tipo: 'buscar' }],
    transform(rows) {
      // Filtrar rechazos/bloqueos: solo filas con columna MR vacía
      const filtered = rows.filter(r => !String(r.mr ?? '').trim());
      // Dedup: mismo doc_ventas + material → quedarse con fecha más reciente
      const map = new Map();
      filtered.forEach(r => {
        const k = `${r.doc_ventas}|${r.material}`;
        const existing = map.get(k);
        if (!existing) { map.set(k, r); return; }
        const dNew = parseDateSAP(r.fe_entrega), dOld = parseDateSAP(existing.fe_entrega);
        if (dNew && (!dOld || dNew >= dOld)) map.set(k, r);
      });
      return Array.from(map.values())
        .map(r => {
          const al = alertaFecha(r.fe_entrega, 5);
          const rl = lookupRuta(r.ruta);
          const pm = maxPesoDim(r.peso_bruto, r.tamano_dimens);
          const ctdConf = parseFloat(String(r.ctd_confirmada ?? '').replace(/\./g, '').replace(',', '.')) || 0;
          return {
            ...r,
            _comuna: rl.comuna, _region: rl.region,
            _peso_mayor: fmtNum(pm, 2),
            _ton_totales: fmtNum(calcTon(pm, ctdConf), 3),
            _alerta: al.txt, _alerta_cls: al.cls,
          };
        })
        .sort((a, b) => {
          const da = parseDateSAP(a.fe_entrega), db2 = parseDateSAP(b.fe_entrega);
          return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
        });
    },
    columnas: [
      { key: 'ofvta', label: 'Oficina de Ventas' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'deudor', label: 'ID Vendedor' },
      { key: 'ce', label: 'Centro Expedición' },
      { key: 'doc_ventas', label: 'Pedido de Venta' },
      { key: 'material', label: 'ID Material' },
      { key: 'denominacion_de_posicion', label: 'Nombre de Material' },
      { key: 'cantidad_de_pedido', label: 'Cantidad Pedido', cls: 'text-right font-data-mono' },
      { key: 'um', label: 'Unidad de Venta' },
      { key: '_comuna', label: 'Comuna Destino' },
      { key: '_region', label: 'Región Destino' },
      { key: 'fe_entrega', label: 'Fecha Entrega' },
      { key: 'ctd_confirmada', label: 'Ctd Confirmada', cls: 'text-right font-data-mono' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── STOCK ALMACEN 4000 (Step 3) ───────────────────────────────────────────
  stock_almacen: {
    titulo: 'Stock Almacén 4000',
    vista: 'v_trc_sqvi_stock_almacen_4000',
    chipFilter: { campo: 'ce', label: 'Centro' },
    filtros: [],
    transform(rows) {
      return rows.map(r => {
        const rl = lookupRuta(r.ruta);
        const pm = maxPesoDim(r.peso_bruto, r.tamano_dimens);
        return {
          ...r,
          _comuna: rl.comuna, _region: rl.region,
          _peso_mayor: fmtNum(pm, 2),
          _ton_totales: fmtNum(calcTon(pm, r.libre_utiliz), 3),
        };
      });
    },
    columnas: [
      { key: 'ce', label: 'Centro Destino' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'material', label: 'ID Material' },
      { key: 'denominacion_de_posicion', label: 'Nombre Material' },
      { key: 'libre_utiliz', label: 'Cantidad Disponible', cls: 'text-right font-data-mono' },
      { key: 'umb', label: 'UM Pedido' },
      { key: 'ruta', label: 'ID Ruta' },
      { key: '_comuna', label: 'Comuna Destino' },
      { key: '_region', label: 'Región Destino' },
      { key: 'deudor', label: 'ID Vendedor' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: 'creado', label: 'Fecha de Entrega' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
    ],
  },

  // ── PEDIDOS TRASLADOS (Step 4) ────────────────────────────────────────────
  pedidos_traslados: {
    titulo: 'Pedidos Traslados',
    vista: 'v_trc_sqvi_pedidos_traslados',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    filtros: [],
    transform(rows) {
      return rows
        .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
        .filter(r => !String(r.material ?? '').startsWith('900000'))
        .map(r => {
          const al = alertaFecha(r.fecha_confirmada, 7);
          const pm = maxPesoDim(r.peso_neto, r.tamano_dimens);
          return {
            ...r,
            _peso_mayor: fmtNum(pm, 2),
            _ton_totales: fmtNum(calcTon(pm, r.ctd_confirmada), 3),
            _alerta: al.txt, _alerta_cls: al.cls,
          };
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
      { key: 'ctd_pedido', label: 'Ctd Pedido PT', cls: 'text-right font-data-mono' },
      { key: 'ump', label: 'UM Pedido' },
      { key: 'fecha_confirmada', label: 'Fecha Confirmada' },
      { key: 'ctd_confirmada', label: 'Ctd Confirmada', cls: 'text-right font-data-mono' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── PEDIDOS TRASLADOS REVEX (Step 4, material 900000) ─────────────────────
  pedidos_traslados_revex: {
    titulo: 'Pedidos Traslados REVEX',
    vista: 'v_trc_sqvi_pedidos_traslados',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    filtros: [],
    transform(rows) {
      return rows
        .filter(r => String(r.material ?? '').startsWith('900000'))
        .map(r => {
          const al = alertaFecha(r.fecha_confirmada, 7);
          const pm = maxPesoDim(r.peso_neto, r.tamano_dimens);
          return {
            ...r,
            _peso_mayor: fmtNum(pm, 2),
            _ton_totales: fmtNum(calcTon(pm, r.ctd_confirmada), 3),
            _alerta: al.txt, _alerta_cls: al.cls,
          };
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
      { key: 'ctd_pedido', label: 'Ctd Pedido PT', cls: 'text-right font-data-mono' },
      { key: 'ump', label: 'UM Pedido' },
      { key: 'fecha_confirmada', label: 'Fecha Confirmada' },
      { key: 'ctd_confirmada', label: 'Ctd Confirmada', cls: 'text-right font-data-mono' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
      { key: '_alerta', label: 'Alerta', clsFn: r => r._alerta_cls },
    ],
  },

  // ── PEDIDOS TRASLADOS 4000 (Step 5) ───────────────────────────────────────
  pedidos_traslados_4000: {
    titulo: 'Pedidos Traslados 4000',
    vista: 'v_trc_sqvi_pedidos_traslados_4000',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    filtros: [],
    transform(rows) {
      return rows.map(r => {
        const pm = maxPesoDim(r.peso_neto, r.tamano_dimens);
        return {
          ...r,
          _peso_mayor: fmtNum(pm, 2),
          _ton_totales: fmtNum(calcTon(pm, r.cantidad_salida), 3),
        };
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
      { key: 'cantidad_salida', label: 'Ctd Pedido PT', cls: 'text-right font-data-mono' },
      { key: 'ump', label: 'UM Pedido' },
      { key: 'fe_entrega', label: 'Fecha Entrega' },
      { key: 'documento', label: 'Pedido de Venta' },
      { key: '_peso_mayor', label: 'Peso Mayor', cls: 'text-right font-data-mono' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right font-data-mono font-bold' },
    ],
  },
};

// ============================================================================
// ENTRADA PRINCIPAL — despacha segun el submenu activo del sidebar
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

// Trae todas las filas de una vista (paginado, la API corta en 1000).
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
// Capacidades de camión por centro (toneladas)
const CAP_CAMION_DEFAULT = 28;
const CAP_CAMION_REDUCIDO = 15;
const CENTROS_CAMION_REDUCIDO = ['1050', '1005']; // La Calera, San Bernardo

function getCapacidadCamion(centroId) {
  return CENTROS_CAMION_REDUCIDO.includes(String(centroId)) ? CAP_CAMION_REDUCIDO : CAP_CAMION_DEFAULT;
}

// Obtener centros programados para mañana según calendario config
function getCentrosManana() {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const diaManana = manana.getDay(); // 0=dom, 1=lun...6=sab
  const programados = new Set();
  for (const [, cal] of Object.entries(CALENDARIOS)) {
    for (const dia of cal.dias) {
      if (dia.n === diaManana) {
        cal.destinos.forEach(d => programados.add(d));
      }
    }
  }
  return programados;
}

function parseNum(v) {
  return parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
}

function fechaEnRango(fechaStr, diasAntes, diasDespues) {
  const d = parseDateSAP(fechaStr);
  if (!d) return false;
  const hoy = hoy00();
  const diff = Math.floor((d - hoy) / 86400000);
  return diff >= -diasAntes && diff <= diasDespues;
}

async function renderPlanCarga(stage) {
  stage.innerHTML = '<div class="text-secondary text-body-md p-md">Cargando Plan de Carga…</div>';

  // Cargar datos de TODAS las vistas en paralelo
  const [quiebresRaw, trasladosRaw, revexRaw, retirosRaw, ventasRaw, traslados4000Raw] = await Promise.all([
    fetchAllRows('v_trc_slim_stock'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),       // same view, filter 900000
    fetchAllRows('v_trc_sqvi_retiros_fabrica'),
    fetchAllRows('v_trc_sqvi_pedidos_venta_1003'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados_4000'),
  ]);

  // ── Preparar set de materiales quebrados por centro ──────────────────────
  const quiebresByCentro = {};
  quiebresRaw
    .filter(r => CENTROS_QUIEBRES.includes(String(r.centro ?? '').trim()))
    .forEach(r => {
      const ce = String(r.centro).trim();
      const sd = parseNum(r.stock_days);
      if (sd === 0 || (sd < 7 && /^[ABC]{2}$/.test(String(r.clase_abc ?? '').trim()))) {
        if (!quiebresByCentro[ce]) quiebresByCentro[ce] = new Set();
        quiebresByCentro[ce].add(String(r.codigo_articulo ?? '').trim());
      }
    });

  // ── Pedidos Traslados (excluir 900000 y subtotales) ─────────────────────
  const traslados = trasladosRaw
    .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
    .filter(r => !String(r.material ?? '').startsWith('900000'));

  // ── REVEX (solo 900000) ─────────────────────────────────────────────────
  const revex = revexRaw.filter(r => String(r.material ?? '').startsWith('900000'));

  // ── Retiros (filtrar subtotales y sin contrato) ─────────────────────────
  const retiros = retirosRaw
    .filter(r => !String(r.proveedor ?? '').startsWith('*'))
    .filter(r => String(r.contr ?? '').trim() !== '');

  // ── Ventas 1003 (filtrar rechazos: mr vacío) ────────────────────────────
  const ventas = ventasRaw.filter(r => !String(r.mr ?? '').trim());

  // ── Traslados 4000 ─────────────────────────────────────────────────────
  const t4000 = traslados4000Raw;

  // ── Calcular toneladas por centro y categoría ───────────────────────────
  const centrosSet = new Set(CENTROS_QUIEBRES);
  const centrosProgramados = getCentrosManana();

  const resultado = Array.from(centrosSet).map(ce => {
    const cap = getCapacidadCamion(ce);
    const quiebresMat = quiebresByCentro[ce] || new Set();

    // 1. Abastecimiento Quiebre: traslados destino=ce, material en quiebres, fecha -10/+7
    const tonQuiebre = traslados
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => quiebresMat.has(String(r.material ?? '').trim()))
      .filter(r => fechaEnRango(r.fecha_confirmada, 10, 7))
      .reduce((sum, r) => sum + calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada), 0);

    // 2. Abastecimiento Stock: traslados destino=ce, NO quiebre, fecha -10/+7
    const tonStock = traslados
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => !quiebresMat.has(String(r.material ?? '').trim()))
      .filter(r => fechaEnRango(r.fecha_confirmada, 10, 7))
      .reduce((sum, r) => sum + calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada), 0);

    // Abast total = quiebre + stock
    const tonAbast = tonQuiebre + tonStock;

    // 3. Material REVEX: destino=ce, fecha -10/+7
    const tonRevex = revex
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => fechaEnRango(r.fecha_confirmada, 10, 7))
      .reduce((sum, r) => sum + calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada), 0);

    // 4. Crossdocking 4000: destino=ce, fecha -5/+5
    const tonCross = t4000
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => fechaEnRango(r.fe_entrega, 5, 5))
      .reduce((sum, r) => sum + calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.cantidad_salida), 0);

    // 5. Notas de Venta: ventas 1003 con destino vía ruta→centro, fecha -3/+5, mr vacío
    //    Condición expedición: clvt contiene '08' (ZV08)
    const ventasCe = ventas
      .filter(r => {
        const rl = lookupRuta(r.ruta);
        // Match by looking up the ruta's commune to the centro
        // Simplified: use ce_2 (centro destino) or ce field
        return String(r.ce_2 ?? r.ce ?? '').trim() === ce;
      })
      .filter(r => fechaEnRango(r.fe_entrega, 3, 5));

    // Split ventas: directa (>= 85% cap) vs traslado (< 85%)
    const ventasPorDoc = {};
    ventasCe.forEach(r => {
      const doc = String(r.doc_ventas ?? '').trim();
      if (!ventasPorDoc[doc]) ventasPorDoc[doc] = [];
      ventasPorDoc[doc].push(r);
    });
    let tonVentaDirecta = 0;
    let tonVentaTraslado = 0;
    for (const [, items] of Object.entries(ventasPorDoc)) {
      const tonDoc = items.reduce((s, r) => s + calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens),
        parseNum(r.ctd_confirmada)), 0);
      if (tonDoc >= cap * 0.85) tonVentaDirecta += tonDoc;
      else tonVentaTraslado += tonDoc;
    }

    // 6. Retiros proveedor: destino=ce, fecha -10/+5
    const retirosItems = retiros
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => fechaEnRango(r.fe_entrega, 10, 5));
    const tonRetiro = retirosItems.reduce((sum, r) => {
      const ctdP = parseNum(r.ctd_pedido), ctdE = parseNum(r.ctd_entregada);
      return sum + calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), ctdP - ctdE);
    }, 0);

    // Total y status
    const total = tonAbast + tonRevex + tonCross + tonVentaDirecta + tonVentaTraslado + tonRetiro;
    const pct = cap > 0 ? Math.round(total / cap * 100) : 0;
    const faltan = cap - total;
    const enCalendario = centrosProgramados.has(ce);

    let status, statusCls;
    if (pct >= 80) { status = 'PROGRAMAR'; statusCls = 'bg-green-700 text-white'; }
    else if (pct >= 70) { status = 'REVISAR'; statusCls = 'bg-yellow-600 text-white'; }
    else { status = 'CARGA INSUFICIENTE'; statusCls = 'bg-gray-400 text-white'; }

    // Cupo extra: centro NO en calendario pero con carga suficiente
    let obs = '';
    if (!enCalendario && pct >= 70) obs = 'CUPO EXTRA';
    if (enCalendario && pct < 70) obs = 'EN CALENDARIO - CARGA BAJA';

    return {
      ce, nombre: getNombreCentro(ce), cap,
      tonAbast, tonRevex, tonCross,
      tonVentaDirecta, tonVentaTraslado, tonRetiro,
      total, faltan, pct, status, statusCls, obs, enCalendario,
      // Detail counts
      lineasTraslados: traslados.filter(r => String(r.ce ?? '').trim() === ce).length,
    };
  }).sort((a, b) => b.pct - a.pct); // Ordenar por % completitud desc

  // ── Fecha de planificación ──────────────────────────────────────────────
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const fechaLabel = `${diasSemana[manana.getDay()]}, ${manana.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  // ── Render SVG camión ───────────────────────────────────────────────────
  function truckSVG(pct) {
    const p = Math.min(pct, 100);
    const fill = pct >= 80 ? '#15803d' : pct >= 70 ? '#ca8a04' : '#9ca3af';
    const bgFill = '#e5e7eb';
    return `<svg viewBox="0 0 60 30" width="70" height="35" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="4" width="38" height="20" rx="2" fill="${bgFill}" stroke="#6b7280" stroke-width="1"/>
      <rect x="0" y="${4 + 20 * (1 - p/100)}" width="38" height="${20 * p/100}" rx="0" fill="${fill}" opacity="0.85"/>
      <path d="M38 10 h8 l8 8 v6 h-16 z" fill="${bgFill}" stroke="#6b7280" stroke-width="1"/>
      <circle cx="10" cy="27" r="3" fill="#374151"/><circle cx="28" cy="27" r="3" fill="#374151"/><circle cx="50" cy="27" r="3" fill="#374151"/>
    </svg>`;
  }

  // ── Render tabla ────────────────────────────────────────────────────────
  const act = quiebresRaw.length ? String(quiebresRaw[0].cargado_en || '').slice(0, 16).replace('T', ' ') : '';

  stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">Programa Carga Sucursales</h3>
          <p class="text-[13px] text-secondary">Planificación: <strong>${escapeHtml(fechaLabel)}</strong>${act ? ' · datos actualizados ' + escapeHtml(act) : ''}</p>
        </div>
        <div class="flex items-center gap-sm">
          <button data-refrescar title="Refrescar" class="bg-surface-container-high text-on-surface px-md py-sm rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
            <span class="material-symbols-outlined text-[16px] align-middle">refresh</span></button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead class="sticky top-0 bg-surface-container-lowest z-10">
            <tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b-2 border-primary/30">
              <th class="py-sm pr-md">Sucursal</th>
              <th class="py-sm pr-md text-right">Total Líneas</th>
              <th class="py-sm pr-md text-right">Abast.</th>
              <th class="py-sm pr-md text-right">REVEX</th>
              <th class="py-sm pr-md text-right">CrossDock 4000</th>
              <th class="py-sm pr-md text-right">Notas Venta</th>
              <th class="py-sm pr-md text-right">Ret. Proveedor</th>
              <th class="py-sm pr-md text-right font-bold">Total</th>
              <th class="py-sm pr-md text-right">Faltan [Ton]</th>
              <th class="py-sm pr-md text-right">% Compl.</th>
              <th class="py-sm pr-md text-center">Camión</th>
              <th class="py-sm pr-md text-center">Status</th>
              <th class="py-sm pr-md">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            ${resultado.map(r => {
              const rowBg = r.enCalendario ? '' : 'bg-surface-container-low/50';
              const totalCls = r.pct >= 80 ? 'text-green-700' : r.pct >= 70 ? 'text-yellow-700' : 'text-red-600';
              return `<tr class="border-b border-outline-variant/50 hover:bg-surface-container-low ${rowBg}">
                <td class="py-sm pr-md font-bold whitespace-nowrap">
                  ${r.enCalendario ? '<span class="material-symbols-outlined text-[14px] text-primary align-middle mr-xs">calendar_today</span>' : ''}
                  ${escapeHtml(r.nombre)}
                </td>
                <td class="py-sm pr-md text-right font-data-mono">${r.lineasTraslados}</td>
                <td class="py-sm pr-md text-right font-data-mono">${fmtNum(r.tonAbast, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono">${fmtNum(r.tonRevex, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono">${fmtNum(r.tonCross, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono">${fmtNum(r.tonVentaDirecta + r.tonVentaTraslado, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono">${fmtNum(r.tonRetiro, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono font-bold ${totalCls}">${fmtNum(r.total, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono ${r.faltan < 0 ? 'text-red-600' : ''}">${fmtNum(r.faltan, 1)}</td>
                <td class="py-sm pr-md text-right font-data-mono font-bold">${r.pct}%</td>
                <td class="py-sm pr-md text-center">${truckSVG(r.pct)}</td>
                <td class="py-sm pr-md text-center">
                  <span class="px-sm py-xs rounded text-[11px] font-bold ${r.statusCls}">${escapeHtml(r.status)}</span>
                </td>
                <td class="py-sm pr-md text-[12px] ${r.obs.includes('EXTRA') ? 'text-blue-700 font-bold' : r.obs.includes('BAJA') ? 'text-orange-600 font-bold' : 'text-secondary'}">${escapeHtml(r.obs)}</td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>

      <div class="mt-md pt-sm border-t border-outline-variant flex flex-wrap gap-lg text-[12px] text-secondary">
        <span><span class="material-symbols-outlined text-[14px] align-middle text-primary">calendar_today</span> = Centro en calendario de mañana</span>
        <span class="px-sm py-xs rounded bg-green-700 text-white text-[11px] font-bold">PROGRAMAR</span> ≥80%
        <span class="px-sm py-xs rounded bg-yellow-600 text-white text-[11px] font-bold">REVISAR</span> 70-80%
        <span class="px-sm py-xs rounded bg-gray-400 text-white text-[11px] font-bold">CARGA INSUFICIENTE</span> &lt;70%
        <span>Capacidad: 28 Ton (15 Ton para Calera/San Bernardo)</span>
      </div>
    </div>`;

  stage.querySelector('[data-refrescar]')?.addEventListener('click', () => renderPlanCarga(stage));
}

// Render generico de una vista con chip filter + filtros + buscador + CSV.
async function renderVistaTabla(stage, cfg) {
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando ${escapeHtml(cfg.titulo)}…</div>`;
  const rawRows = await fetchAllRows(cfg.vista);
  // Apply transform (computed fields, sort, dedup, filter subtotals)
  const rows = cfg.transform ? cfg.transform(rawRows) : rawRows;

  // Chip filter values (primary + extras)
  const chip = cfg.chipFilter;
  const chipValues = chip ? Array.from(new Set(rows.map(r => String(r[chip.campo] ?? '')).filter(v => v))).sort() : [];
  let chipSel = 'all';

  const extraChips = (cfg.extraChips || []).map(ec => ({
    ...ec,
    values: Array.from(new Set(rows.map(r => String(r[ec.campo] ?? '')).filter(v => v))).sort(),
    sel: 'all',
  }));

  // Search filters (tipo: 'buscar')
  const filtroTextos = {};
  (cfg.filtros || []).forEach(f => { filtroTextos[f.campo] = ''; });
  let texto = '';

  function aplica() {
    const q = texto.trim().toLowerCase();
    return rows.filter(r => {
      if (chip && chipSel !== 'all' && String(r[chip.campo] ?? '') !== chipSel) return false;
      for (const ec of extraChips) {
        if (ec.sel !== 'all' && String(r[ec.campo] ?? '') !== ec.sel) return false;
      }
      for (const f of (cfg.filtros || [])) {
        const fv = filtroTextos[f.campo]?.trim().toLowerCase();
        if (fv && !String(r[f.campo] ?? '').toLowerCase().includes(fv)) return false;
      }
      if (q && !cfg.columnas.some(c => String(r[c.key] ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  const chipCls = (v) => 'vt-chip px-sm py-xs border rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ' +
    (chipSel === v ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');
  const chipCls2 = (ec, v) => 'vt-chip px-sm py-xs border rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ' +
    (ec.sel === v ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-on-surface hover:bg-surface-container-high');

  function draw() {
    const filt = aplica();
    const MAX = 1500;
    const shown = filt.slice(0, MAX);
    const act = rawRows.length ? String(rawRows[0].cargado_en || '').slice(0, 16).replace('T', ' ') : '';

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

        ${chip ? `<div class="flex items-center gap-xs mb-sm flex-wrap">
          <span class="text-[11px] text-secondary font-bold uppercase mr-xs">${escapeHtml(chip.label)}:</span>
          <button class="${chipCls('all')}" data-chip="all">Todos</button>
          ${chipValues.map(v => `<button class="${chipCls(v)}" data-chip="${escapeHtml(v)}">${escapeHtml(v)} ${escapeHtml(getNombreCentro(v))}</button>`).join('')}
        </div>` : ''}

        ${extraChips.map((ec, idx) => ec.values.length ? `<div class="flex items-center gap-xs mb-sm flex-wrap">
          <span class="text-[11px] text-secondary font-bold uppercase mr-xs">${escapeHtml(ec.label)}:</span>
          <button class="${chipCls2(ec, 'all')}" data-echip="${idx}" data-eval="all">Todos</button>
          ${ec.values.map(v => `<button class="${chipCls2(ec, v)}" data-echip="${idx}" data-eval="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
        </div>` : '').join('')}

        <div class="flex flex-wrap items-end gap-md mb-md">
          ${(cfg.filtros || []).map(f => `
            <label class="block">
              <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">${escapeHtml(f.label)}</span>
              <input data-filtro="${f.campo}" value="${escapeHtml(filtroTextos[f.campo] || '')}" placeholder="Buscar…"
                class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none w-48"/>
            </label>`).join('')}
          ${cfg.noBuscar ? '' : `<label class="block">
            <span class="text-[11px] uppercase tracking-wide text-secondary font-bold">Buscar general</span>
            <input data-buscar value="${escapeHtml(texto)}" placeholder="texto…"
              class="mt-xs block border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
          </label>`}
          <span class="text-[12px] text-secondary ml-auto">${filt.length} fila(s)</span>
        </div>

        <div class="overflow-x-auto max-h-[68vh] overflow-y-auto">
          <table class="w-full text-[13px]">
            <thead class="sticky top-0 bg-surface-container-lowest z-10">
              <tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
                ${cfg.columnas.map(c => `<th class="py-sm pr-md whitespace-nowrap">${escapeHtml(c.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${shown.length === 0 ? `<tr><td colspan="${cfg.columnas.length}" class="py-lg text-center text-secondary">Sin datos.</td></tr>` :
                shown.map(r => {
                  const rowCls = cfg.rowClsFn ? cfg.rowClsFn(r) : '';
                  return `<tr class="border-b border-outline-variant/50 hover:bg-surface-container-low ${rowCls}">
                  ${cfg.columnas.map(c => {
                    const val = String(r[c.key] ?? '');
                    const cls = c.clsFn ? c.clsFn(r) : (c.cls || '');
                    return `<td class="py-xs pr-md whitespace-nowrap ${cls}">${escapeHtml(val)}</td>`;
                  }).join('')}
                </tr>`; }).join('')}
            </tbody>
          </table>
        </div>
        ${filt.length > MAX ? `<p class="text-[12px] text-secondary mt-sm">Mostrando ${MAX} de ${filt.length}. Usa los filtros para acotar.</p>` : ''}
      </div>`;

    // Event listeners
    stage.querySelectorAll('[data-chip]').forEach(btn => btn.addEventListener('click', () => {
      chipSel = btn.dataset.chip; draw();
    }));
    stage.querySelectorAll('[data-echip]').forEach(btn => btn.addEventListener('click', () => {
      extraChips[parseInt(btn.dataset.echip)].sel = btn.dataset.eval; draw();
    }));
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
    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => renderVistaTabla(stage, cfg));
    stage.querySelector('[data-csv]')?.addEventListener('click', () => exportarCSV(cfg, filt));
  }

  draw();
}

function exportarCSV(cfg, filas) {
  const headers = cfg.columnas.map(c => c.label);
  const esc = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [headers.join(';')].concat(filas.map(r => cfg.columnas.map(c => esc(r[c.key])).join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = cfg.titulo.replace(/\s+/g, '_') + '.csv';
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
            <h3 class="text-headline-sm font-bold text-on-surface">Proveedores</h3>
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

    // Listeners
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

    // Listeners del panel de direcciones (si esta abierto)
    wireDireccionesPanel(stage, draw);
  }

  draw();
}

// ── Panel de direcciones de fabrica (inline bajo la fila del proveedor) ──────
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

// ── Modal generico ───────────────────────────────────────────────────────────
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

// ── CRUD Proveedor ────────────────────────────────────────────────────────────
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
      id,
      nombre,
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

// ── CRUD Direccion de fabrica ────────────────────────────────────────────────
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
// SUBMENU 2: CALENDARIO SUCURSALES
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
  const cfg = CALENDARIOS[calOrigen];
  if (!cfg) { calOrigen = '1003'; }

  stage.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex flex-wrap items-end justify-between gap-md mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">Calendario de Despachos</h3>
          <p class="text-[13px] text-secondary">Programación de despachos por centro origen. Seleccione hasta 2 centros destino por bloque horario.</p>
        </div>
        <div class="flex gap-sm">
          ${Object.entries(CALENDARIOS).map(([id, c]) => `
            <button data-origen="${id}" class="px-md py-sm rounded-lg text-[13px] font-bold transition-colors
              ${calOrigen === id ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}">
              <span class="material-symbols-outlined text-[16px] align-middle mr-xs">warehouse</span>${escapeHtml(c.nombre)} (${id})
            </button>`).join('')}
        </div>
      </div>
      <div id="cal-grid"></div>
      <div class="flex justify-end mt-md">
        <button id="cal-save" class="bg-primary text-on-primary px-lg py-sm rounded-lg font-bold hover:opacity-90">
          <span class="material-symbols-outlined text-[18px] align-middle mr-xs">save</span>Guardar calendario
        </button>
      </div>
    </div>
  `;

  stage.querySelectorAll('[data-origen]').forEach(btn => btn.addEventListener('click', async () => {
    calOrigen = btn.dataset.origen;
    calMatrix = await loadCalendario(calOrigen);
    // Re-render everything to update active button
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

  // Build options HTML for destination selectors
  const optsHtml = `<option value="">— vacío —</option>` +
    destinos.map(id => `<option value="${id}">${id} ${escapeHtml(getNombreCentro(id))}</option>`).join('');

  grid.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-[13px] border-collapse">
        <thead>
          <tr class="text-left text-[11px] uppercase tracking-wide text-secondary">
            <th class="py-sm pr-md border-b border-outline-variant w-[120px]">Bloque</th>
            ${dias.map(d => `<th class="py-sm px-sm border-b border-outline-variant text-center min-w-[140px]">
              ${escapeHtml(d.lbl)}${d.sobreCupo ? '<br><span class="text-[10px] text-primary font-bold normal-case">sobre cupo</span>' : ''}
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${bloquesBase.map(bloque => `
            <tr class="border-b border-outline-variant/50">
              <td class="py-sm pr-md font-data-mono font-bold text-on-surface whitespace-nowrap">${bloque}</td>
              ${dias.map(d => {
                // Check if this day supports this block (Sat may only have 1 block)
                const dayBloques = d.bloques || bloquesBase;
                if (!dayBloques.includes(bloque)) {
                  return `<td class="py-sm px-sm text-center bg-surface-dim/30"><span class="text-[11px] text-secondary">—</span></td>`;
                }
                const key = `${d.n}-${bloque}`;
                const cell = calMatrix[key] || {};
                const d1 = cell.centro_destino_1 || '';
                const d2 = cell.centro_destino_2 || '';
                return `<td class="py-sm px-xs text-center ${d.sobreCupo ? 'bg-primary/5' : ''}">
                  <div class="flex flex-col gap-[3px]">
                    <select data-dest="${key}-1" class="w-full border border-outline-variant rounded px-[4px] py-[3px] text-[11px] focus:border-primary outline-none bg-surface-container-lowest">
                      ${optsHtml.replace(`value="${d1}"`, `value="${d1}" selected`)}
                    </select>
                    <select data-dest="${key}-2" class="w-full border border-outline-variant rounded px-[4px] py-[3px] text-[11px] focus:border-primary outline-none bg-surface-container-lowest">
                      ${optsHtml.replace(`value="${d2}"`, `value="${d2}" selected`)}
                    </select>
                  </div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="text-[12px] text-secondary mt-sm">
      <span class="material-symbols-outlined text-[14px] align-middle">info</span>
      Seleccione hasta 2 centros destino por bloque horario. Los sábados se agendan como sobre cupo (previa confirmación).
    </p>
  `;
}

async function saveCalendario(stage) {
  const grid = stage.querySelector('#cal-grid');
  const email = await getUserEmail();
  const now = new Date().toISOString();
  const cfg = CALENDARIOS[calOrigen];
  const rows = [];

  cfg.dias.forEach(d => {
    const dayBloques = d.bloques || cfg.bloques;
    dayBloques.forEach(bloque => {
      const key = `${d.n}-${bloque}`;
      const sel1 = grid.querySelector(`[data-dest="${key}-1"]`);
      const sel2 = grid.querySelector(`[data-dest="${key}-2"]`);
      const cd1 = sel1?.value || null;
      const cd2 = sel2?.value || null;
      rows.push({
        centro: calOrigen,
        dia: d.n,
        bloque,
        habilitado: !!(cd1 || cd2),
        cupos: (cd1 ? 1 : 0) + (cd2 ? 1 : 0),
        sobre_cupo: !!d.sobreCupo,
        centro_destino_1: cd1 || null,
        centro_destino_2: cd2 || null,
        updated_by: email,
        updated_at: now,
      });
    });
  });

  const { error } = await supabase
    .from('abast_calendario')
    .upsert(rows, { onConflict: 'centro,dia,bloque' });
  if (error) { showAlert('Error al guardar calendario: ' + error.message, 'error'); return; }
  showAlert('Calendario guardado', 'success');
  calMatrix = await loadCalendario(calOrigen);
}
