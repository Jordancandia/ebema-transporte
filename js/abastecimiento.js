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

import { supabase } from './supabase-client.js?v=202610071243';
import { can, enAlcance, filtrarPorCentro } from './permisos.js?v=202610071243';
import { getDatabase } from './data.js?v=202610071243';
import { showAlert, escapeHtml } from './utils.js';
import { renderTablaV2, setUltimaActualizacion, maxCargadoEn, pill, mono, txt, tonHtml, truckGauge, colorUmbral, esc as escV2 } from './troncales-ui.js?v=202610071243';
import { confirmar } from './confirmar.js?v=202610071243';

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
// Rol del usuario actual (mismo criterio que app.js: fila en getDatabase().users
// por email, ya cargada en memoria tras el login). Usado para restringir acciones
// sensibles (ej. excluir posiciones del Plan de Carga) a perfil OWNER.
async function getCurrentUserRole() {
  try {
    const email = await getUserEmail();
    if (!email) return null;
    const db = getDatabase();
    const u = (db.users || []).find(x => x.email === email);
    return u ? u.role : null;
  } catch { return null; }
}
async function esOwner() {
  return (await getCurrentUserRole()) === 'OWNER';
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
  if (!m) {
    const i = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);   // columnas date de Supabase
    return i ? new Date(+i[1], +i[2] - 1, +i[3]) : null;
  }
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function hoy00() { const d = new Date(); d.setHours(0,0,0,0); return d; }

// Parsea fecha ISO (YYYY-MM-DD, formato nativo de <input type="date"> y de las
// columnas `date` de Supabase) evitando desfases de timezone del constructor Date().
function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// Formatea una fecha ISO (YYYY-MM-DD) a DD.MM.YYYY, mismo formato usado para
// las fechas SAP en el resto del módulo.
function fmtFechaISO(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || '');
}

// ── Días hábiles (PLAN DE CARGA 48H — AJUSTE 18-sep-2026) ──────────────────
// Un día es hábil si no es sábado/domingo y no está en la tabla `abast_feriados`
// (administrada manualmente en la vista Calendario Sucursales). Se usa para
// calcular la ventana de planificación de 24h/48h saltando fines de semana y
// feriados legales.
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function esDiaHabil(date, feriadosSet) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false; // fin de semana
  if (feriadosSet && feriadosSet.has(isoLocal(date))) return false;
  return true;
}
// Avanza `n` días hábiles a partir de `startDate` (sin incluirlo), saltando
// fines de semana y feriados. Ej.: hoy jueves + feriado el viernes siguiente
// → addBusinessDays(hoy, 1, feriados) = lunes; addBusinessDays(hoy, 2, feriados) = martes.
function addBusinessDays(startDate, n, feriadosSet) {
  // (AJUSTE 24-sep-2026) Soporta n negativo (retrocede días hábiles) para
  // poder calcular ventanas -N/+N días hábiles, ej. fechaEnRangoHabil().
  const d = new Date(startDate);
  const step = n >= 0 ? 1 : -1;
  const objetivo = Math.abs(n);
  let count = 0;
  while (count < objetivo) {
    d.setDate(d.getDate() + step);
    if (esDiaHabil(d, feriadosSet)) count++;
  }
  return d;
}
// (AJUSTE 24-sep-2026, pedido Jordan) Igual que fechaEnRango() pero contando
// DÍAS HÁBILES (salta sábado/domingo y feriados de abast_feriados) en vez de
// días corridos. Ejemplo: hoy jueves, un pedido con fecha 28-sep (lunes) está
// a 2 días hábiles (no 4 días corridos) y debe entrar en una ventana ±3 hábil.
function fechaEnRangoHabil(fechaStr, diasHabilesAntes, diasHabilesDespues, feriadosSet) {
  const d = parseDateSAP(fechaStr);
  if (!d) return false;
  const hoy = hoy00();
  if (d.getTime() === hoy.getTime()) return true;
  if (d.getTime() > hoy.getTime()) {
    const limite = addBusinessDays(hoy, diasHabilesDespues, feriadosSet);
    return d.getTime() <= limite.getTime();
  }
  const limite = addBusinessDays(hoy, -diasHabilesAntes, feriadosSet);
  return d.getTime() >= limite.getTime();
}

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
// `cantidad` puede venir como string SAP con formato chileno (parseNum lo
// convierte) o ya como number (p.ej. un pendiente = ctd_pedido - ctd_entregada
// calculado en JS). Si se le aplicara parseNum a un number, String(2.0000000000000004)
// → "2.0000000000000004" y el reemplazo de puntos (miles) borra el punto decimal,
// inflando el valor ~1e16x (bug real detectado en Plan de Carga: crossdock con
// pend=2.0000000000000004 por error de coma flotante en 4,392-2,392 → tonelaje
// de 140.000.000.000.000). Con number no se debe volver a parsear como string.
function calcTon(pesoMax, cantidad) {
  const c = typeof cantidad === 'number' ? cantidad : parseNum(cantidad);
  return pesoMax * c / 1000;
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
// (AJUSTE 22-sep-2026, pedido Jordan) Una exclusión manual del Plan de Carga
// (`abast_plan_exclusiones`) sólo debe estar vigente el mismo día en que se
// creó ("día de planificación"). Al día siguiente deja de aplicarse sola —
// no hace falta reactivarla a mano — y la posición vuelve a considerarse en
// el plan si la carga de datos (SAP) todavía la trae; si SAP ya no la trae,
// simplemente desaparece por sí sola (comportamiento normal del plan).
function esExclusionVigenteHoy(ts) {
  if (!ts) return false;
  try {
    const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // 'YYYY-MM-DD'
    return fmt(new Date(ts)) === fmt(new Date());
  } catch { return false; }
}

const CENTROS_QUIEBRES = ['1005','1020','1040','1050','1060','1070','1080','1090','1100','1160'];

// Orden de clase ABC solicitado: AA, AB, AC, BA, BB, BC, CA, CB, CC
const ABC_ORDEN = { AA:0, AB:1, AC:2, BA:3, BB:4, BC:5, CA:6, CB:7, CC:8 };
function abcRank(abc) {
  const k = String(abc ?? '').trim().toUpperCase();
  return ABC_ORDEN[k] != null ? ABC_ORDEN[k] : 99; // '' (SIN CLASIFICACIÓN) queda al final
}

// ── AJUSTES PRIORIZACIÓN PEDIDOS DE TRASLADOS 1003 (2026-09-18) ─────────────
// Usuario "de sistema" que NO otorga prioridad de carga (cualquier otro sí).
const USUARIO_SISTEMA = 'ZE_SIS';

// Clasifica un pedido de traslado (línea material/centro) según la regla de
// priorización de carga acordada:
//   B) creado por un usuario ≠ ZE_SIS dentro del plazo → prioridad máxima.
//   C) clasificación ABC = AA (esté o no quebrado)      → prioridad, bajo B.
//   D) material QUEBRADO (stock_days ≤ 7) con cualquier otra clasificación
//      → mismo bucket que B/C, orden AB,AC,BA,BB,BC,CA,CB,CC,SIN CLASIFICACIÓN.
//   E) material NO quebrado (resto)                     → bucket "abastecimiento",
//      mismo orden de clasificación que D.
// Columnas de Plan de Carga: bucket 'prioridad' → "ABAST. QUIEBRE Y PRIORIZADO"
// (puntos B, C, D); bucket 'abastecimiento' → "ABASTECIMIENTO" (punto E).
function prioridadTraslado(usuario, claseAbc, quebrado) {
  const u = String(usuario ?? '').trim().toUpperCase();
  const abc = String(claseAbc ?? '').trim().toUpperCase();
  if (u && u !== USUARIO_SISTEMA) {
    return { grupo: 'B', bucket: 'prioridad', orden: -2, motivo: `USUARIO (${u})` };
  }
  if (abc === 'AA') {
    return { grupo: 'C', bucket: 'prioridad', orden: -1, motivo: 'CLASIFICACIÓN ABC AA' };
  }
  const orden = abcRank(abc);
  const claseLbl = abc || 'SIN CLASIFICACIÓN';
  if (quebrado) {
    return { grupo: 'D', bucket: 'prioridad', orden, motivo: `QUIEBRE · ${claseLbl}` };
  }
  return { grupo: 'E', bucket: 'abastecimiento', orden, motivo: claseLbl };
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
  // (3-oct-2026) Incluye los datos de transporte de la coordinación (Retiro RM).
  const { data, error } = await supabase.from('abast_retiro_estado').select('doc_compr, estado, tipo_retiro, entrega_entrante, tipo_local_rm, fab_direccion, fab_comuna, fab_contacto, fab_telefono, fecha_retiro, lineas_retiro, updated_at, updated_by, id_transporte, transportista, chofer_nombre, chofer_rut, chofer_telefono, patente_camion, patente_carro');
  const m = {};
  if (!error) (data || []).forEach(r => { const { doc_compr, ...rest } = r; m[String(doc_compr)] = rest; });
  return m;
}

// ── Exclusiones manuales del Plan de Carga ──────────────────────────────────
// Permite sacar del Plan de Carga, de forma persistente y reversible, un
// Pedido de Venta 1003 completo (tipo='venta_1003', material=null) o un
// Pedido de Traslado de Crossdocking — completo (material=null) o sólo una
// línea/material puntual de ese pedido (tipo='crossdock_4000', material=X).
async function loadExclusionesPlan() {
  const { data, error } = await supabase.from('abast_plan_exclusiones').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return []; }
  // Sólo las exclusiones creadas HOY (día de planificación) siguen vigentes;
  // las de días anteriores quedan en la tabla como historial pero ya no se
  // aplican ni se muestran (ver esExclusionVigenteHoy más arriba).
  return (data || []).filter(e => esExclusionVigenteHoy(e.created_at));
}
async function excluirDelPlan(tipo, doc, material, motivo) {
  // material '' (o ausente) = excluye el documento completo, cualquier línea/material.
  const payload = { tipo, doc: String(doc), material: material ? String(material) : '', motivo: motivo || null, created_by: await getUserEmail() };
  const { error } = await supabase.from('abast_plan_exclusiones').upsert(payload, { onConflict: 'tipo,doc,material' });
  if (error) { showAlert('Error al excluir: ' + error.message, 'error'); return false; }
  return true;
}
// ── NV 1003 marcadas manualmente como CD-CLIENTE (AJUSTE 30-sep-2026) ───────
// Saca de la consolidación un despacho que por regla (<85%) se consolidaba.
// Persistente hasta que se quite la marca. Sólo perfil OWNER (can('forzar_cd_cliente')).
// (30-sep-2026) Ambos sentidos: 'CD-CLIENTE' (camión directo) o 'CONSOLIDABLE' (sube con carga a sucursal).
// Map doc_ventas → tipo. tipo null en setVentaDirectoManual = volver a regla automática.
async function loadVentasDirectoManual() {
  const { data, error } = await supabase.from('abast_venta_directo_manual').select('doc_ventas,tipo');
  if (error) { console.error(error); return new Map(); }
  return new Map((data || []).map(r => [String(r.doc_ventas ?? '').trim(), r.tipo]));
}
async function setVentaDirectoManual(doc, tipo) {
  const d = String(doc ?? '').trim();
  const { error } = tipo
    ? await supabase.from('abast_venta_directo_manual').upsert({ doc_ventas: d, tipo, motivo: 'Tipo de entrega manual desde Ventas CD (1003)', created_by: await getUserEmail() }, { onConflict: 'doc_ventas' })
    : await supabase.from('abast_venta_directo_manual').delete().eq('doc_ventas', d);
  if (error) { showAlert('Error al guardar tipo de entrega: ' + error.message, 'error'); return false; }
  return true;
}
// ── Coordinación de despacho NV 1003 (2-oct-2026, Jordan) ───────────────────
// «Coordinar Despacho» en Ventas CD (1003): fecha de entrega confirmada, N° de entrega,
// datos del cliente y (CD-CLIENTE) datos del transporte. Sólo las NV con estado
// Coordinado entran al Plan de Carga (fecha coordinada ≤ día objetivo del centro).
// Patente normalizada para comparar (sin guiones, puntos ni espacios, en mayúsculas).
const normPatente = p => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function loadCoordinacionesVenta() {
  const { data, error } = await supabase.from('abast_venta_coordinacion').select('*');
  if (error) { console.error(error); return new Map(); }
  return new Map((data || []).filter(r => r.estado === 'coordinado').map(r => [String(r.doc_ventas ?? '').trim(), r]));
}
// Maestro de clientes (v_trc_maestro_clientes): nombre desde SAP (Solic. → nombre) +
// dirección/teléfono guardados al coordinar. Map id_cliente → fila.
async function loadMaestroClientes() {
  const rows = await fetchAllRows('v_trc_maestro_clientes');
  const m = new Map();
  (rows || []).forEach(r => { const k = String(r.id_cliente ?? '').trim(); if (k) m.set(k, r); });
  return m;
}
async function guardarCoordinacionVenta(p, nuevo) {
  const email = await getUserEmail();
  const now = new Date().toISOString();
  const payload = { ...p, estado: 'coordinado', updated_at: now, updated_by: email };
  if (nuevo) { payload.created_at = now; payload.created_by = email; }
  const { error } = await supabase.from('abast_venta_coordinacion').upsert(payload, { onConflict: 'doc_ventas' });
  if (error) { showAlert('Error al coordinar: ' + error.message, 'error'); return false; }
  // Dirección / teléfono / comuna quedan en el maestro de clientes para la próxima coordinación.
  if (p.id_cliente) {
    const { error: e2 } = await supabase.from('abast_maestro_clientes').upsert({
      id_cliente: p.id_cliente, nombre: p.nombre_cliente || null, comuna: p.comuna || null,
      direccion: p.direccion || null, telefono: p.telefono || null, updated_at: now, updated_by: email,
    }, { onConflict: 'id_cliente' });
    if (e2) console.warn('Maestro de clientes no actualizado:', e2.message);
  }
  return true;
}
// ── Coordinaciones directas → Seguimiento de Carga (5-oct-2026, Jordan) ─────────────
// Toda coordinación directa del día (CD-Cliente de Ventas CD o Crossdocking, Fáb-Cliente,
// Fáb-Sucursal y Retiro FAB-CD) se registra en Seguimiento de Carga al coordinar, aunque nadie
// abra el Plan de Carga o ya haya pasado el cierre de las 15:35. Un registro por documento
// (clave «COORD|<doc>»), con fecha de plan = día de la coordinación y fecha de carga = la coordinada.
// La vista los etiqueta por tipo y los oculta cuando el documento ya va en un camión programado del plan.
const SEG_TIPO_COORD = { 'CD-CLIENTE': 'CD-Cliente', 'FAB-CLTE': 'Fáb-Cliente', 'FAB-SUC': 'Fáb-Sucursal', 'FAB-CD': 'Retiro FAB-CD' };
const segClaveCoord = doc => 'COORD|' + String(doc ?? '').trim();
const r4s = n => Math.round((Number(n) || 0) * 10000) / 10000;
async function quitarSeguimientoCoord(docs) {
  try {
    const claves = (docs || []).map(segClaveCoord);
    if (!claves.length) return;
    const { data } = await supabase.from('abast_seguimiento_camion').select('fecha_plan,cd_origen,ce,tipo_camion,clave').in('clave', claves).gte('fecha_plan', isoLocal(hoy00()));
    for (const x of data || []) await supabase.rpc('fn_abast_quitar_seguimiento', { p_fecha: x.fecha_plan, p_cd: x.cd_origen, p_ce: x.ce, p_tipo: x.tipo_camion, p_clave: x.clave });
  } catch (e) { console.warn('Seguimiento de Carga: no se pudo quitar la coordinación', e); }
}
// regs: [{ doc, tipo: 'CD-CLIENTE'|'FAB-CLTE'|'FAB-SUC'|'FAB-CD', ce, fechaCarga, origen, destino, transp, lineas }]
async function registrarSeguimientoCoord(regs) {
  try {
    await quitarSeguimientoCoord(regs.map(r => r.doc));   // el tipo o el destino pudieron cambiar
    const hoy = isoLocal(hoy00());
    for (const r of regs) {
      if (!r.lineas || !r.lineas.length) continue;
      const t = r.transp || {}, ton = r.lineas.reduce((s, x) => s + (Number(x.ton) || 0), 0);
      const cab = { fecha_plan: hoy, fecha_carga: r.fechaCarga || '', cd_origen: '1003', ce: String(r.ce ?? '').trim(),
        tipo_camion: SEG_TIPO_COORD[r.tipo] || r.tipo, clave: segClaveCoord(r.doc), origen: r.origen || '', destino: r.destino || '',
        ton: r4s(ton), cap: CAP_CAMION_DIRECTO, pct: Math.round(ton / CAP_CAMION_DIRECTO * 100),
        id_transporte: t.id_transporte || '', transportista: t.transportista || '', chofer_nombre: t.chofer_nombre || '', chofer_rut: t.chofer_rut || '',
        chofer_telefono: t.chofer_telefono || '', patente_camion: t.patente_camion || '', patente_carro: t.patente_carro || '' };
      const { error } = await supabase.rpc('fn_abast_guardar_seguimiento', { p_cab: cab, p_lineas: r.lineas });
      if (error) console.warn('Seguimiento de Carga: no se pudo registrar la coordinación', error.message);
    }
  } catch (e) { console.warn('Seguimiento de Carga: no se pudo registrar la coordinación', e); }
}
const lineaSegCoord = (o) => ({ tipo_carga: o.tipo_carga, documento: String(o.documento ?? '').trim(), n_entrega: String(o.n_entrega ?? ''), material: String(o.material ?? ''),
  nombre: o.nombre || '', cantidad: r4s(o.cantidad), ton: r4s(o.ton), ton_bruta: null, pedido_venta: String(o.pedido_venta ?? ''), ruta: o.ruta || '', comuna: o.comuna || '',
  proveedor: o.proveedor || '', cliente: o.cliente || '' });
async function anularCoordinacionVenta(doc) {
  const { error } = await supabase.from('abast_venta_coordinacion').delete().eq('doc_ventas', String(doc ?? '').trim());
  if (error) { showAlert('Error al anular la coordinación: ' + error.message, 'error'); return false; }
  await quitarSeguimientoCoord([doc]);
  return true;
}
async function loadTransportistasCoord() {
  const [t, c, k] = await Promise.all([
    supabase.from('transports').select('id,razonSocial,rut,activo,telefono,email,tipo_servicio'),
    supabase.from('transports_choferes').select('rut,nombre,apellido,telefono,id_transporte,id_camion'),
    supabase.from('transports_camiones').select('id_camion,id_transporte,modelo,capacidad_ton'),
  ]);
  return {
    // (4-oct-2026) Sólo transportistas activos y completos (RUT, teléfono y correo); los BLOQUEADOS no se ofrecen.
    // (5-oct-2026) Se ofrece TODO el maestro activo; los incompletos van marcados BLOQUEADO (antes se ocultaban y la lista quedaba vacía).
    trans: (t.data || []).filter(x => x.activo !== false).map(x => ({ ...x, _bloq: !(String(x.rut ?? '').trim() && String(x.telefono ?? '').trim() && String(x.email ?? '').trim()) })).sort((a, b) => String(a.razonSocial || '').localeCompare(String(b.razonSocial || ''))),
    // (4-oct-2026) Todo el maestro activo (incluye bloqueados, marcados), para elegir al programar camiones.
    transTodos: (t.data || []).filter(x => x.activo !== false).sort((a, b) => String(a.razonSocial || '').localeCompare(String(b.razonSocial || ''))),
    choferes: c.data || [],
    camiones: k.data || [],
  };
}
// (5-oct-2026, Jordan) Se puede coordinar con un transportista BLOQUEADO del maestro (faltan RUT,
// teléfono o correo): el camión directo queda «Transporte por confirmar» y NO se programa (foto,
// correo, Seguimiento de Carga) hasta completar esos datos en una acción posterior (Plan de Carga
// o maestro de transportistas). El estado se deriva siempre del maestro vigente.
const faltanTransp = t => !t ? [] : [!String(t.rut ?? '').trim() && 'RUT', !String(t.telefono ?? '').trim() && 'teléfono', !String(t.email ?? '').trim() && 'correo'].filter(Boolean);
async function loadMaestroTranspMap() {
  const { data, error } = await supabase.from('transports').select('id,razonSocial,rut,telefono,email,activo');
  if (error) throw error;
  return new Map((data || []).map(t => [String(t.id ?? '').trim().toUpperCase(), t]));
}
function notaTranspBloq(t) {
  if (!t || !t._bloq) return '';
  return `<div class="sv-note-box" style="background:#fef3c7;color:#713f12">Transportista <b>BLOQUEADO</b> en el maestro: faltan ${escapeHtml(faltanTransp(t).join(', '))}. Puedes coordinar igual; el camión queda <b>«Transporte por confirmar»</b> y no se programa (foto ${'15:35'}, correo, Seguimiento de Carga) hasta completar esos datos desde el Plan de Carga o el maestro de transportistas.</div>`;
}

// ── Selectores buscables (5-oct-2026, Jordan) ────────────────────────────────
// Reemplazan los <select> largos (247 transportistas) y la lista de radios de direcciones de
// fábrica. montarBuscador: la opción elegida se ve como tarjeta («Cambiar»); al abrir, un
// buscador filtra por todas las palabras escritas (sin tildes) y muestra hasta 50 resultados,
// con ↑ ↓ Enter y Esc. est = { open, q } persiste entre redibujos del panel.
const normBus = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const filtrarBus = (items, q, texto) => { const tk = normBus(q).split(/\s+/).filter(Boolean); return !tk.length ? items : items.filter(x => { const t = normBus(texto(x)); return tk.every(k => t.includes(k)); }); };
// Esc dentro de un selector abierto cierra el selector, no el panel (lo llaman los onKey de los modales).
function cerrarBuscadorAbierto(e) {
  const b = document.querySelector('[data-bus-open="1"]');
  if (!b || typeof b._busCerrar !== 'function') return false;
  e.stopPropagation(); e.preventDefault(); b._busCerrar(); return true;
}
function montarBuscador(host, o) {
  if (!host) return;
  const est = o.estado, MAX = 50;
  const selDe = () => o.items.find(x => String(o.id(x)) === String(o.selId ?? '')) || null;
  let act = 0;
  const caja = `width:100%;box-sizing:border-box;min-width:0;${o.invalid ? 'border-color:#b5000b' : ''}`;
  const filaBtn = (x, i) => `<button type="button" data-bpick="${i}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:none;border-bottom:1px solid #edeeef;cursor:pointer;font:inherit;background:${i === act ? '#e8eefc' : String(o.id(x)) === String(o.selId ?? '') ? '#f1f5f9' : '#fff'}">${o.fila(x)}</button>`;
  const res = () => filtrarBus(o.items, est.q, o.texto);
  const listaHtml = () => {
    const r = res();
    if (!o.items.length) return `<div class="sv-sub" style="padding:10px 12px;margin:0">${o.vacio || 'Sin opciones.'}</div>`;
    if (!r.length) return `<div class="sv-sub" style="padding:10px 12px;margin:0">Sin resultados para «${escapeHtml(est.q)}».</div>`;
    return r.slice(0, MAX).map(filaBtn).join('') + (r.length > MAX ? `<div class="sv-sub" style="padding:8px 12px;margin:0">${r.length - MAX} más: escribe para acotar.</div>` : '');
  };
  const pick = x => { est.open = false; est.q = ''; o.onPick(x); };
  function render(foco) {
    const sel = selDe();
    const abierto = est.open || (!sel && !o.fallback);
    host.dataset.busOpen = abierto && (sel || o.fallback) ? '1' : '0';
    host._busCerrar = () => { est.open = false; est.q = ''; render(); };
    if (!abierto) {
      host.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid ${o.invalid ? '#b5000b' : '#c5c7c9'};border-radius:10px;background:#fafafa">
        ${sel ? o.tarjeta(sel) : o.fallback}
        ${o.disabled ? '' : `<button type="button" class="sv-btn" data-bcambiar style="padding:2px 10px;font-size:12px;flex:none">Cambiar</button>`}</div>`;
      host.querySelector('[data-bcambiar]')?.addEventListener('click', () => { est.open = true; est.q = ''; render(true); });
      return;
    }
    host.innerHTML = `<label class="sv-inp" style="${caja}"><span class="material-symbols-outlined">search</span>
        <input data-bq value="${escapeHtml(est.q)}" placeholder="${escapeHtml(o.placeholder || 'Buscar…')}" autocomplete="off" style="width:100%">
        ${sel || o.fallback ? '<button type="button" data-bcancel class="sv-iconbtn" title="Mantener la selección actual (Esc)" style="width:24px;height:24px"><span class="material-symbols-outlined" style="font-size:18px">close</span></button>' : ''}</label>
      <div data-blist style="margin-top:4px;max-height:${o.alto || 260}px;overflow:auto;border:1px solid #c5c7c9;border-radius:10px;background:#fff">${listaHtml()}</div>`;
    const inp = host.querySelector('[data-bq]'), lst = host.querySelector('[data-blist]');
    const wireList = () => lst.querySelectorAll('[data-bpick]').forEach(b => b.addEventListener('click', () => { const x = res()[+b.dataset.bpick]; if (x) pick(x); }));
    const redrawList = () => { lst.innerHTML = listaHtml(); wireList(); lst.querySelector(`[data-bpick="${act}"]`)?.scrollIntoView({ block: 'nearest' }); };
    wireList();
    inp.addEventListener('input', () => { est.q = inp.value; act = 0; redrawList(); });
    inp.addEventListener('keydown', e => {
      const n = Math.min(res().length, MAX);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { act = (act + 1) % n; redrawList(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { act = (act - 1 + n) % n; redrawList(); } }
      else if (e.key === 'Enter') { e.preventDefault(); const x = res()[act]; if (x) pick(x); }
    });
    host.querySelector('[data-bcancel]')?.addEventListener('click', () => host._busCerrar());
    if (foco) setTimeout(() => inp.focus(), 0);
  }
  render(!!est.open);
}
// Campo de texto libre con sugerencias desplegables (contacto de fábrica): se puede escribir
// cualquier valor o elegir uno de la lista, que además completa los campos asociados.
function montarComboLibre(host, o) {
  if (!host) return;
  const MAX = 30;
  let act = -1;
  host.style.position = 'relative';
  host.innerHTML = `<label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0;${o.invalid ? 'border-color:#b5000b' : ''}">
      <input data-cl value="${escapeHtml(o.valor || '')}" placeholder="${escapeHtml(o.placeholder || '')}" autocomplete="off" style="width:100%">
      ${o.items.length ? '<span class="material-symbols-outlined" data-cltog style="cursor:pointer;color:#5c5f61" title="Ver contactos guardados">expand_more</span>' : ''}</label>
    <div data-cllist style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:5;max-height:220px;overflow:auto;border:1px solid #c5c7c9;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.12)"></div>`;
  const inp = host.querySelector('[data-cl]'), lst = host.querySelector('[data-cllist]');
  const res = () => { const r = filtrarBus(o.items, inp.value, o.texto); return r.length ? r : o.items; };
  const cerrar = () => { lst.style.display = 'none'; host.dataset.busOpen = '0'; act = -1; };
  host._busCerrar = cerrar;
  const abrir = () => {
    if (!o.items.length) return;
    const r = res().slice(0, MAX);
    lst.innerHTML = r.map((x, i) => `<button type="button" data-clpick="${i}" style="display:block;width:100%;text-align:left;padding:7px 12px;border:none;border-bottom:1px solid #edeeef;cursor:pointer;font:inherit;background:${i === act ? '#e8eefc' : '#fff'}">${o.fila(x)}</button>`).join('');
    lst.querySelectorAll('[data-clpick]').forEach(b => b.addEventListener('mousedown', ev => { ev.preventDefault(); const x = r[+b.dataset.clpick]; if (x) { cerrar(); o.onPick(x); } }));
    lst.style.display = 'block'; host.dataset.busOpen = '1';
  };
  inp.addEventListener('focus', abrir);
  inp.addEventListener('input', () => { o.onInput(inp.value); act = -1; abrir(); });
  inp.addEventListener('blur', () => setTimeout(cerrar, 120));
  inp.addEventListener('keydown', e => {
    if (lst.style.display === 'none') return;
    const n = Math.min(res().length, MAX);
    if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % n; abrir(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act - 1 + n) % n; abrir(); }
    else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); const x = res()[act]; cerrar(); if (x) o.onPick(x); }
  });
  host.querySelector('[data-cltog]')?.addEventListener('mousedown', ev => { ev.preventDefault(); if (lst.style.display === 'none') { inp.focus(); abrir(); } else cerrar(); });
}
// Transportista del maestro: fila de resultado y tarjeta de la selección.
const tipoServTransp = t => { const v = String(t.tipo_servicio ?? '').toUpperCase(); return v.includes('TRONCAL') ? 'Troncal' : v.includes('MILLA') ? 'Última milla' : ''; };
const filaTranspHtml = t => `<span class="sv-mono" style="min-width:68px;color:#5c5f61">${escapeHtml(t.id)}</span>
  <span style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.razonSocial || '')}</b>
    <small style="color:#5c5f61">${escapeHtml([tipoServTransp(t), t.rut ? 'RUT ' + t.rut : ''].filter(Boolean).join(' · ') || '—')}</small></span>
  ${t._bloq ? `<span class="sv-pill warn" title="Faltan ${escapeHtml(faltanTransp(t).join(', '))}"><i></i>Bloqueado</span>` : '<span class="sv-pill ok"><i></i>Activo</span>'}`;
const tarjetaTranspHtml = t => `<span class="material-symbols-outlined" style="color:${t._bloq ? '#b45309' : '#15803d'}">local_shipping</span>
  <div style="flex:1;min-width:0"><b>${escapeHtml(t.razonSocial || '')}</b><div class="sv-sub" style="margin:0">ID ${escapeHtml(t.id)}${tipoServTransp(t) ? ' · ' + tipoServTransp(t) : ''}${t.rut ? ' · RUT ' + escapeHtml(t.rut) : ''}${t.telefono ? ' · ' + escapeHtml(t.telefono) : ''}</div></div>
  ${t._bloq ? '<span class="sv-pill warn"><i></i>Bloqueado</span>' : '<span class="sv-pill ok"><i></i>Activo</span>'}`;
// Monta el selector de transportista en [data-bus="trans"] del panel. st: estado del modal (idTrans, transportista, busT).
function montarTransp(panel, st, tr, invalid, draw) {
  st.busT = st.busT || { open: false, q: '' };
  montarBuscador(panel.querySelector('[data-bus="trans"]'), {
    items: tr.trans, id: t => t.id, selId: st.idTrans, estado: st.busT, invalid,
    texto: t => `${t.id} ${t.razonSocial} ${t.rut} ${tipoServTransp(t)}`,
    fila: filaTranspHtml, tarjeta: tarjetaTranspHtml,
    fallback: st.idTrans && !tr.trans.some(t => String(t.id) === String(st.idTrans))
      ? `<span class="material-symbols-outlined" style="color:#b45309">local_shipping</span><div style="flex:1;min-width:0"><b>${escapeHtml(st.transportista || st.idTrans)}</b><div class="sv-sub" style="margin:0">ID ${escapeHtml(st.idTrans)} · no está en el maestro activo</div></div>` : '',
    placeholder: 'Buscar por ID, nombre o RUT del transportista…', vacio: 'El maestro de transportistas está vacío.',
    onPick: t => {
      if (String(t.id) !== String(st.idTrans)) { st.choferNombre = st.choferNombre || ''; }
      st.idTrans = String(t.id); st.transportista = t.razonSocial || ''; draw();
    },
  });
}
// (5-oct-2026, Jordan) Al coordinar transporte (Ventas CD, Retiros, Crossdocking) sólo el ID y nombre
// del transportista son obligatorios; chofer, RUT, teléfono y patente pueden completarse después.
const notaPendTransp = (st, quien) => {
  const pd = pendTranspRetiro({ chofer_nombre: st.choferNombre, chofer_rut: st.choferRut, chofer_telefono: st.choferTel, patente_camion: st.patCamion });
  return pd.length ? `<div class="sv-note-box" style="background:#fef3c7;color:#713f12"><b>Pendiente:</b> ${escapeHtml(pd.join(', '))}. Puedes coordinar igual; ${quien} queda marcado <b>«Chofer/patente pendiente»</b> y se completa después con «Editar coordinación».${pd.includes('patente') ? ' Sin patente, el camión directo aún no queda programado en el Plan de Carga.' : ''}</div>` : '';
};
function showConfirmarTransportistaModal(t, detalle) {
  return new Promise(resolve => {
    const f = faltanTransp(t);
    const st = { rut: '', tel: '', email: '', err: false, saving: false };
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(520px,100vw)" role="dialog" aria-label="Confirmar transporte"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sv-cf-bg') && !cerrarBuscadorAbierto(e)) { e.stopPropagation(); fin(false); } };
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(false));
    const mailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
    const malos = () => [f.includes('RUT') && !st.rut.trim() && 'rut', f.includes('teléfono') && !st.tel.trim() && 'tel', f.includes('correo') && !mailOk(st.email) && 'email'].filter(Boolean);
    const campo = (k, t2, ph, extra = '') => { const b = st.err && malos().includes(k); return `<div><label class="sv-flbl" style="display:block;margin-bottom:6px;${b ? 'color:#b5000b' : ''}">${t2} *</label>
      <label class="sv-inp" style="width:100%;box-sizing:border-box;${b ? 'border-color:#b5000b' : ''}"><input data-k="${k}" value="${escapeHtml(st[k])}" placeholder="${escapeHtml(ph)}" style="width:100%" ${extra}></label></div>`; };
    function draw() {
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">Confirmar transporte</div>
          <div class="sv-dr-t">${escapeHtml(t.razonSocial || '')}</div>
          <div class="sv-dr-s">ID ${escapeHtml(t.id)}${detalle ? ' · ' + escapeHtml(detalle) : ''}</div></div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:14px">
          ${st.err ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los datos marcados en rojo (correo válido).</div>' : ''}
          <div class="sv-note-box">El transportista está <b>bloqueado</b> en el maestro. Completa ${escapeHtml(f.join(', '))} para confirmarlo: se guarda en el maestro y sus camiones coordinados quedan programados.</div>
          ${f.includes('RUT') ? campo('rut', 'RUT transportista', '76.123.456-7') : ''}
          ${f.includes('teléfono') ? campo('tel', 'Teléfono contacto', '+56 9…') : ''}
          ${f.includes('correo') ? campo('email', 'Correo', 'contacto@empresa.cl', 'type="email"') : ''}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok ${st.saving ? 'disabled' : ''}><span class="material-symbols-outlined">task_alt</span>Confirmar transporte</button></div></div>`;
      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(false)));
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { st[i.dataset.k] = i.value; }));
      panel.querySelector('[data-ok]').addEventListener('click', async () => {
        if (malos().length) { st.err = true; draw(); return; }
        const upd = {};
        if (f.includes('RUT')) upd.rut = st.rut.trim().toUpperCase();
        if (f.includes('teléfono')) upd.telefono = st.tel.trim();
        if (f.includes('correo')) upd.email = st.email.trim().toLowerCase();
        st.saving = true; draw();
        const { error } = await supabase.from('transports').update(upd).eq('id', t.id);
        if (error) { st.saving = false; showAlert('No se pudo actualizar el maestro de transportistas: ' + error.message, 'error'); draw(); return; }
        Object.assign(t, upd);
        showAlert(`Transporte confirmado: ${t.razonSocial} queda activo en el maestro.`, 'success');
        fin(true);
      });
      const first = panel.querySelector('[data-k]'); if (first) setTimeout(() => first.focus(), 0);
    }
    draw();
  });
}
// Tipo de entrega de las NV 1003 (regla Jordan 2-oct-2026): por CLIENTE (oficina de
// ventas + Solic.), la suma de sus pedidos pendientes ≥ 85% de un camión de 28 t
// (23,8 t) ⇒ CD-CLIENTE; si no ⇒ CONSOLIDABLE. El tipo definido al coordinar (o la
// marca manual antigua) manda sobre la regla.
function clasificarTipoEntregaNV(filas, ctx) {
  const c = ctx || {};
  const coord = c.coordMap || new Map(), man = c.ventasDirectoManual || new Map(), pvMap = c.pvMap || {};
  const lim = CAP_CAMION_DIRECTO * UMBRAL_CD_CLIENTE;
  const grupos = {};
  filas.forEach(r => {
    const doc = String(r.doc_ventas ?? '').trim();
    r._coord = coord.get(doc) || null;
    r._manual = man.get(doc) || '';
    r._tipo_fijo = (r._coord && r._coord.tipo_entrega) || r._manual || '';
    r._cliente_key = clienteKeyNV(doc, r.solicitante, pvMap[doc]);
    const gk = `${String(r.ofvta ?? '').trim()}|${r._cliente_key}`;
    (grupos[gk] = grupos[gk] || []).push(r);
  });
  Object.values(grupos).forEach(g => {
    const ev = g.filter(r => r._tipo_fijo !== 'CONSOLIDABLE');
    const tonG = ev.reduce((s, r) => s + (r._ton_num || 0), 0);
    const auto = tonG >= lim - 1e-9 ? 'CD-CLIENTE' : 'CONSOLIDABLE';
    g.forEach(r => {
      r._ton_cliente = tonG; r._n_pedidos_cliente = ev.length;
      r._tipo_auto = auto;
      r._tipo_entrega = r._tipo_fijo || auto;
      r._tipo_origen = r._coord ? 'COORDINACION' : (r._manual ? 'MANUAL' : 'REGLA');
      r._directo = r._tipo_entrega === 'CD-CLIENTE';
      r._forzado = r._tipo_fijo === 'CD-CLIENTE';
      r._directo_motivo = r._tipo_fijo ? 'MANUAL' : (r._directo ? (ev.length > 1 ? 'CLIENTE' : 'PEDIDO') : '');
      r._fecha_plan = r._coord ? fmtFechaISO(r._coord.fecha_entrega) : r.fe_entrega;
    });
  });
  return filas;
}
// ── Inclusiones manuales del Plan de Carga (Pedidos de Traslado, 30-sep-2026) ──
// OWNER fuerza una línea (doc_compr + material) dentro del camión CD: entra antes
// que el resto de traslados, aun fuera de la ventana -10/+7. Vigente sólo hoy.
async function loadInclusionesPlan() {
  const { data, error } = await supabase.from('abast_plan_inclusiones').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).filter(e => esExclusionVigenteHoy(e.created_at));
}
async function incluirEnPlan(doc, material) {
  const payload = { tipo: 'traslados_1003', doc: String(doc).trim(), material: String(material).trim(), motivo: 'Incluido manual desde Pedidos de Traslado', created_by: await getUserEmail(), created_at: new Date().toISOString() };
  const { error } = await supabase.from('abast_plan_inclusiones').upsert(payload, { onConflict: 'tipo,doc,material' });
  if (error) { showAlert('Error al incluir: ' + error.message, 'error'); return false; }
  return true;
}
async function quitarInclusionPlan(doc, material) {
  const { error } = await supabase.from('abast_plan_inclusiones').delete().eq('tipo', 'traslados_1003').eq('doc', String(doc).trim()).eq('material', String(material).trim());
  if (error) { showAlert('Error al quitar inclusión: ' + error.message, 'error'); return false; }
  return true;
}
const _keyInc = (doc, mat) => `${String(doc ?? '').trim()}|${String(mat ?? '').trim()}`;

// ── Ajustes manuales del Plan de Carga (1-oct-2026, pedido Jordan) ──────────
// abast_plan_linea_camion: línea (doc+material) asignada a mano al camión CD (1), al
// 2º camión (2) o a «no carga» (0). Al aceptar el 2º camión se congela la carga de ambos
// camiones (origen 'confirmado'). La foto de las 15:35 respeta estas asignaciones.
// abast_plan_camion_manual: camión directo armado a mano uniendo OC (p. ej. dos proveedores).
async function loadAsignacionLineas() {
  try {
    const { data, error } = await supabase.from('abast_plan_linea_camion').select('cd_origen,ce,documento,material,camion,origen').eq('fecha', isoLocal(hoy00()));
    if (error) throw error; return data || [];
  } catch (e) { console.error(e); return []; }
}
async function loadCamionesManuales() {
  try {
    const { data, error } = await supabase.from('abast_plan_camion_manual').select('id,cd_origen,ce,tipo,docs').eq('fecha', isoLocal(hoy00()));
    if (error) throw error; return data || [];
  } catch (e) { console.error(e); return []; }
}

// Clave de cliente para agrupar NV (misma regla que el Plan de Carga y la vista SQL).
// (30-sep-2026, Jordan) El cliente es la columna SOLICITANTE del SQVI; DEUDOR (func Z0)
// NO es el cliente. Sin solicitante: nombre de cliente de la ref. NV; si no, el propio pedido.
function clienteKeyNV(doc, solicitante, pv) {
  return String(solicitante ?? '').trim() || String((pv || {}).nombre_1 ?? '').trim() || String(doc ?? '').trim();
}

async function reactivarEnPlan(id) {
  const { error } = await supabase.from('abast_plan_exclusiones').delete().eq('id', id);
  if (error) { showAlert('Error al reactivar: ' + error.message, 'error'); return false; }
  return true;
}
// true si (doc[, material]) está excluido: aplica match exacto de material,
// o una exclusión de todo el documento (material === '' en abast_plan_exclusiones).
function estaExcluido(exclusiones, tipo, doc, material) {
  const d = String(doc ?? '').trim();
  const m = material != null ? String(material).trim() : '';
  return exclusiones.some(e => e.tipo === tipo && String(e.doc).trim() === d && (String(e.material ?? '').trim() === '' || String(e.material).trim() === m));
}
// Modal para ver y reactivar (borrar) exclusiones del Plan de Carga.
function showExclusionesModal(exclusiones, onChange) {
  const TIPO_LBL = { venta_1003: 'Pedido de Venta 1003', crossdock_4000: 'Traslado Crossdocking 4000', traslados_revex: 'Traslado REVEX', traslados_1003: 'Traslado 1003', retiro_fabrica: 'Retiro de Fábrica' };
  const filas = exclusiones.map(e => `<tr class="border-b border-outline-variant/40">
    <td class="py-xs pr-md text-[12px]">${escapeHtml(TIPO_LBL[e.tipo] || e.tipo)}</td>
    <td class="py-xs pr-md text-[12px] font-bold">${escapeHtml(e.doc)}</td>
    <td class="py-xs pr-md text-[12px]">${e.material ? escapeHtml(e.material) : '<span class="text-secondary">— (todo el pedido)</span>'}</td>
    <td class="py-xs pr-md text-[12px] text-secondary">${escapeHtml(e.motivo || '')}</td>
    <td class="py-xs pr-md text-[11px] text-secondary">${escapeHtml(horaChile(e.created_at))}</td>
    <td class="py-xs pr-md text-right"><button data-reactivar="${e.id}" class="text-[11px] font-bold text-primary hover:underline">Reactivar</button></td>
  </tr>`).join('');
  const html = `
  <div id="excl-modal-bg" class="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
    <div class="bg-white rounded-xl shadow-2xl p-6 w-[720px] max-w-[95vw] max-h-[85vh] overflow-y-auto flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-bold text-gray-800">Exclusiones del Plan de Carga</h3>
        <button id="excl-cerrar" class="text-secondary hover:text-on-surface">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <p class="text-[12px] text-secondary">Estos pedidos no se consideran en el Plan de Carga hasta que se reactiven acá.</p>
      <table class="w-full text-[12px]">
        <thead><tr class="text-left text-[10px] uppercase text-secondary border-b border-outline-variant">
          <th class="pr-md py-xs">Tipo</th><th class="pr-md py-xs">Documento</th><th class="pr-md py-xs">Material</th><th class="pr-md py-xs">Motivo</th><th class="pr-md py-xs">Excluido el</th><th></th>
        </tr></thead>
        <tbody>${filas || '<tr><td colspan="6" class="text-secondary text-[12px] py-sm">Sin exclusiones activas.</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const bg = document.getElementById('excl-modal-bg');
  const cleanup = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) cleanup(); });
  document.getElementById('excl-cerrar').addEventListener('click', cleanup);
  bg.querySelectorAll('[data-reactivar]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await reactivarEnPlan(Number(btn.dataset.reactivar));
    if (ok) { showAlert('Reactivado en el Plan de Carga', 'success'); cleanup(); onChange && onChange(); }
  }));
}
async function saveEstadoRetiro(docCompr, estado, tipoRetiro = null, entregaEntrante = null, extraFab = null) {
  const payload = { doc_compr: String(docCompr), estado, updated_by: await getUserEmail(), updated_at: new Date().toISOString() };
  if (tipoRetiro !== null) payload.tipo_retiro = tipoRetiro;
  if (entregaEntrante !== null) payload.entrega_entrante = entregaEntrante;
  if (extraFab) {
    if (extraFab.tipo_local_rm   !== undefined) payload.tipo_local_rm   = extraFab.tipo_local_rm;
    if (extraFab.fab_direccion   !== undefined) payload.fab_direccion   = extraFab.fab_direccion;
    if (extraFab.fab_comuna      !== undefined) payload.fab_comuna      = extraFab.fab_comuna;
    if (extraFab.fab_contacto    !== undefined) payload.fab_contacto    = extraFab.fab_contacto;
    if (extraFab.fab_telefono    !== undefined) payload.fab_telefono    = extraFab.fab_telefono;
    if (extraFab.fecha_retiro    !== undefined) payload.fecha_retiro    = extraFab.fecha_retiro || null;
    // Al revertir (no_coordinado), limpiar también tipo_retiro, entrega_entrante y fecha_retiro
    if (extraFab._clear_retiro) { payload.tipo_retiro = null; payload.entrega_entrante = null; payload.fecha_retiro = null; payload.lineas_retiro = null; }
  }
  const { error } = await supabase.from('abast_retiro_estado').upsert(payload, { onConflict: 'doc_compr' });
  if (error) { showAlert('Error al guardar estado: ' + error.message, 'error'); return false; }
  return true;
}
// ── FORMULARIO COORDINAR / EDITAR RETIRO v2 (rediseño 29-sep-2026) ─────────
// Capa sobre el panel lateral de Retiros de Fábrica. Devuelve (Promise) el
// mismo objeto de siempre — { tipoRetiro, entregaEntrante, tipoLocalRM,
// fabDir, fabCom, fabCont, fabTel, fechaRetiro } — o null si se cancela.
//  · Retiro RM: obligatorios Fecha de retiro, Dirección de fábrica y
//    Clasificación fábrica (FAB-CD / FAB-SUC / FAB-CLTE).
//  · Retiro local: fecha, dirección y contacto quedan opcionales (plegados).
//  · «Otra dirección» + «Guardar esta dirección en el proveedor» inserta en
//    abast_proveedor_direcciones (igual que antes).
function showCoordModal(row) {
  return new Promise(async resolve => {
    const editando = esEstadoCoordinado(row._estado_prev);
    let dirs = [];
    try {
      const { data } = await supabase
        .from('abast_proveedor_direcciones')
        .select('id, nombre_fabrica, direccion, comuna')
        .eq('proveedor_id', row.proveedor ?? '')
        .eq('activo', true);
      dirs = data || [];
    } catch (_) { /* sin direcciones guardadas */ }

    const st = {
      lr: row._tipo_local_rm === 'LOCAL' ? 'LOCAL' : 'RM',
      fecha: row._fecha_retiro || '',
      dirSel: null, dirTxt: '', comuna: row._fab_comuna || '', contacto: row._fab_contacto || '', tel: row._fab_telefono || '',
      entrega: row._entrega_entrante || '', clasif: row._tipo_retiro || '',
      guardar: true, masLocal: !!(row._tipo_local_rm === 'LOCAL' && (row._fecha_retiro || row._fab_direccion || row._fab_contacto)),
      err: false,
    };
    if (row._fab_direccion) {
      const m = dirs.find(d => d.direccion === row._fab_direccion);
      if (m) st.dirSel = String(m.id); else { st.dirSel = 'new'; st.dirTxt = row._fab_direccion; }
    } else if (dirs.length === 1) { st.dirSel = String(dirs[0].id); st.comuna = st.comuna || dirs[0].comuna || ''; }
    else if (!dirs.length) st.dirSel = 'new';

    const wrap = document.createElement('div');
    wrap.id = 'coord-modal-bg';
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(560px,100vw)" role="dialog" aria-label="Coordinar retiro"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); fin(null); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(null));

    const faltantes = () => {
      const f = [];
      if (st.lr === 'RM') {
        if (!st.fecha) f.push('fecha');
        const dir = st.dirSel === 'new' ? st.dirTxt.trim() : (dirs.find(d => String(d.id) === st.dirSel)?.direccion || '');
        if (!dir) f.push('dir');
        if (!st.clasif) f.push('clasif');
      }
      return f;
    };
    const lbl = (txt, key, req) => `<label class="sv-flbl" style="display:block;margin-bottom:6px;${st.err && faltantes().includes(key) ? 'color:#b5000b' : ''}">${txt}${req ? ' *' : ''}</label>`;
    const inpStyle = key => st.err && faltantes().includes(key) ? 'border-color:#b5000b' : '';

    function draw() {
      const rm = st.lr === 'RM';
      const verCampos = rm || st.masLocal;
      const req = rm;
      const falt = st.err ? faltantes() : [];
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${editando ? 'Editar coordinación' : 'Coordinar retiro'}</div>
          <div class="sv-dr-t">${escapeHtml(row.doc_compr)}</div>
          <div class="sv-dr-s">${escapeHtml(row.nombre_1 || '')} → ${escapeHtml(getNombreCentro(row.ce))} · ${fmtNum(row._ton_num, 2)} t</div></div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:18px">
          ${falt.length ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los campos obligatorios marcados en rojo.</div>' : ''}
          <div>${lbl('Tipo de retiro', 'lr', true)}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[['RM', 'Retiro RM', 'Nuestro camión retira en fábrica'], ['LOCAL', 'Retiro local', 'Lo gestiona la sucursal']].map(([v, t, d]) =>
                `<button class="sv-opt ${st.lr === v ? 'is-on' : ''}" data-chip data-lr="${v}" style="flex-direction:column;align-items:flex-start;gap:2px"><b style="font-size:14px">${t}</b><span class="sv-sub" style="margin:0">${d}</span></button>`).join('')}
            </div></div>
          ${!rm ? `<button class="sv-btn-g" data-chip data-mas style="align-self:flex-start;padding-left:0"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">${st.masLocal ? 'expand_less' : 'expand_more'}</span>${st.masLocal ? 'Ocultar' : 'Agregar'} fecha, dirección y contacto (opcional)</button>` : ''}
          ${verCampos ? `
          <div>${lbl('Fecha de retiro', 'fecha', req)}
            <label class="sv-inp" style="width:220px;${inpStyle('fecha')}"><span class="material-symbols-outlined">calendar_today</span><input type="date" data-k="fecha" value="${escapeHtml(st.fecha)}" style="width:150px"></label>
            <div class="sv-sub" style="margin-top:6px;max-width:none">El retiro entra al Plan de Carga desde esta fecha.</div></div>
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Dirección de fábrica</div>
            ${lbl('Dirección', 'dir', req)}
            <div style="display:flex;flex-direction:column;gap:6px;${inpStyle('dir') ? 'outline:1px solid #b5000b;border-radius:4px' : ''}">
              ${dirs.map(d => `<button class="sv-opt ${st.dirSel === String(d.id) ? 'is-on' : ''}" data-chip data-dir="${d.id}">
                <span class="material-symbols-outlined" style="color:${st.dirSel === String(d.id) ? '#b5000b' : '#5c5f61'}">${st.dirSel === String(d.id) ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                <span><b>${escapeHtml(d.nombre_fabrica || d.direccion)}</b><div class="sv-sub" style="margin:0">${escapeHtml([d.direccion, d.comuna].filter(Boolean).join(', '))}</div></span></button>`).join('')}
              <button class="sv-opt ${st.dirSel === 'new' ? 'is-on' : ''}" data-chip data-dir="new">
                <span class="material-symbols-outlined" style="color:${st.dirSel === 'new' ? '#b5000b' : '#5c5f61'}">${st.dirSel === 'new' ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                <span><b>Otra dirección</b><div class="sv-sub" style="margin:0">Ingresar una nueva</div></span></button>
            </div>
            ${st.dirSel === 'new' ? `<label class="sv-inp" style="${inpStyle('dir')}"><input data-k="dirTxt" value="${escapeHtml(st.dirTxt)}" placeholder="Calle, número" style="width:100%"></label>
              ${row.proveedor ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#5c5f61;cursor:pointer"><input type="checkbox" data-k="guardar" ${st.guardar ? 'checked' : ''}> Guardar esta dirección en el proveedor</label>` : ''}` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <div>${lbl('Comuna', 'comuna', false)}<label class="sv-inp"><input data-k="comuna" value="${escapeHtml(st.comuna)}" style="width:100%"></label></div>
              <div>${lbl('Contacto', 'contacto', false)}<label class="sv-inp"><input data-k="contacto" value="${escapeHtml(st.contacto)}" style="width:100%"></label></div>
              <div>${lbl('Teléfono', 'tel', false)}<label class="sv-inp"><input data-k="tel" value="${escapeHtml(st.tel)}" placeholder="+56 9…" style="width:100%"></label></div>
            </div></div>` : ''}
          ${rm ? `
          <div>${lbl('Clasificación fábrica', 'clasif', true)}
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;${inpStyle('clasif') ? 'outline:1px solid #b5000b;border-radius:4px' : ''}">
              ${[['FAB-CD', 'Consolida en CD'], ['FAB-SUC', 'Directo a sucursal'], ['FAB-CLTE', 'Directo a cliente']].map(([v, d]) =>
                `<button class="sv-opt ${st.clasif === v ? 'is-on' : ''}" data-chip data-cl="${v}" style="flex-direction:column;align-items:flex-start;gap:2px"><b>${v}</b><span class="sv-sub" style="margin:0">${d}</span></button>`).join('')}
            </div></div>
          <div>${lbl('Entrega entrante SAP', 'entrega', false)}<label class="sv-inp" style="width:260px"><span class="material-symbols-outlined">tag</span><input class="is-mono" data-k="entrega" value="${escapeHtml(st.entrega)}" placeholder="N° de entrega" style="width:180px"></label></div>` : ''}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok><span class="material-symbols-outlined">${editando ? 'save' : 'event_available'}</span>${editando ? 'Guardar cambios' : 'Confirmar coordinación'}</button></div></div>`;

      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(null)));
      panel.querySelectorAll('[data-lr]').forEach(b => b.addEventListener('click', () => { st.lr = b.dataset.lr; draw(); }));
      panel.querySelector('[data-mas]')?.addEventListener('click', () => { st.masLocal = !st.masLocal; draw(); });
      panel.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
        st.dirSel = b.dataset.dir;
        const d = dirs.find(x => String(x.id) === st.dirSel);
        if (d && d.comuna) st.comuna = d.comuna;
        draw();
      }));
      panel.querySelectorAll('[data-cl]').forEach(b => b.addEventListener('click', () => { st.clasif = b.dataset.cl; draw(); }));
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => {
        st[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value;
        if (st.err && (i.type === 'date' || i.dataset.k === 'dirTxt')) { const pos = i.selectionStart; const k = i.dataset.k; draw(); const n = panel.querySelector(`[data-k="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { /* date */ } } }
      }));
      panel.querySelector('[data-ok]').addEventListener('click', async () => {
        if (faltantes().length) { st.err = true; draw(); return; }
        const rm2 = st.lr === 'RM';
        const conCampos = rm2 || st.masLocal;
        const dirGuardada = dirs.find(d => String(d.id) === st.dirSel);
        const fabDir = !conCampos ? '' : (st.dirSel === 'new' ? st.dirTxt.trim() : (dirGuardada?.direccion || ''));
        const fabCom = conCampos ? st.comuna.trim() : '';
        if (conCampos && st.dirSel === 'new' && st.guardar && fabDir && row.proveedor) {
          await supabase.from('abast_proveedor_direcciones').insert({
            proveedor_id: row.proveedor, nombre_fabrica: fabDir, direccion: fabDir, comuna: fabCom, activo: true,
          });
        }
        fin({
          tipoRetiro: rm2 ? st.clasif : null,
          entregaEntrante: rm2 ? st.entrega.trim() : '',
          tipoLocalRM: st.lr,
          fabDir, fabCom,
          fabCont: conCampos ? st.contacto.trim() : '',
          fabTel: conCampos ? st.tel.trim() : '',
          fechaRetiro: conCampos ? (st.fecha || '').trim() : '',
        });
      });
    }
    draw();
  });
}
// ── Modal «Coordinar despacho» de un pedido de venta 1003 (2-oct-2026) ──────
// Tipo de entrega (sólo OWNER puede cambiarlo), fecha de entrega confirmada, N° de
// entrega, datos del cliente y, si es CD-CLIENTE, datos del transporte.
async function chequearChoquePatente(row, st, ctx) {
  const doc = String(row.doc_ventas ?? '').trim();
  const pat = normPatente(st.patCamion), rut = normPatente(st.choferRut);
  const otros = [...(await loadCoordinacionesVenta()).values()].filter(c => String(c.doc_ventas ?? '').trim() !== doc && c.tipo_entrega === 'CD-CLIENTE');
  const rowsByDoc = (ctx && ctx._rowsByDoc) || new Map();
  const tonDoc = d => { const r = rowsByDoc.get(String(d ?? '').trim()); return r ? (r._ton_num || 0) : 0; };
  const fF = d => fmtFechaISO(d);
  const av = [];
  const mismaPat = otros.filter(c => normPatente(c.patente_camion) === pat);
  const mismoDia = mismaPat.filter(c => c.fecha_entrega === st.fecha);
  mismoDia.forEach(c => {
    if (String(c.id_transporte ?? '').trim() !== st.idTrans.trim()) av.push(`El pedido ${c.doc_ventas} usa esta patente el ${fF(c.fecha_entrega)} con otro transporte (${[c.id_transporte, c.transportista].filter(Boolean).join(' · ') || 'sin dato'}).`);
    else if (normPatente(c.chofer_rut) !== rut) av.push(`El pedido ${c.doc_ventas} usa esta patente el ${fF(c.fecha_entrega)} con otro chofer (${[c.chofer_nombre, c.chofer_rut].filter(Boolean).join(' · ')}).`);
  });
  mismaPat.filter(c => c.fecha_entrega !== st.fecha).forEach(c => av.push(`La patente ya está coordinada el ${fF(c.fecha_entrega)} (pedido ${c.doc_ventas}); revisa si la fecha es correcta.`));
  if (rut) otros.filter(c => c.fecha_entrega === st.fecha && normPatente(c.chofer_rut) === rut && normPatente(c.patente_camion) !== pat)
    .forEach(c => av.push(`El chofer ${st.choferNombre.trim() || st.choferRut} ya está coordinado el ${fF(c.fecha_entrega)} en otra patente (${c.patente_camion || '—'}, pedido ${c.doc_ventas}).`));
  const tonTot = (row._ton_num || 0) + mismoDia.reduce((s, c) => s + tonDoc(c.doc_ventas), 0);
  if (mismoDia.length && tonTot > CAP_CAMION_DIRECTO + 1e-9) av.push(`Con los pedidos ${mismoDia.map(c => c.doc_ventas).join(', ')} el camión suma ${fmtNum(tonTot, 1)} t (supera ${CAP_CAMION_DIRECTO} t).`);
  return av;
}
function showCoordVentaModal(row, ctx) {
  return new Promise(async resolve => {
    const c = row._coord || {};
    const mc = row._mc || {};
    const editando = !!row._coord;
    const puedeTipo = can('forzar_cd_cliente');
    const feSap = parseDateSAP(row.fe_entrega);
    const st = {
      tipo: c.tipo_entrega || row._tipo_entrega || 'CONSOLIDABLE',
      fecha: c.fecha_entrega || (feSap ? isoLocal(feSap) : ''),
      entrega: c.n_entrega || '',
      comuna: c.comuna || mc.comuna || row._comuna || '',
      direccion: c.direccion || mc.direccion || '',
      telefono: c.telefono || mc.telefono || '',
      idTrans: c.id_transporte || '', transportista: c.transportista || '',
      choferNombre: c.chofer_nombre || '', choferRut: c.chofer_rut || '', choferTel: c.chofer_telefono || '',
      patCamion: c.patente_camion || '', patCarro: c.patente_carro || '',
      err: false,
    };
    let tr = { trans: [], choferes: [], camiones: [] };
    try { tr = await loadTransportistasCoord(); } catch (_) { /* sin maestro de transportistas */ }

    const wrap = document.createElement('div');
    wrap.id = 'coord-modal-bg';
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="Coordinar despacho"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && !cerrarBuscadorAbierto(e)) { e.stopPropagation(); fin(false); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(false));

    const esCli = () => st.tipo === 'CD-CLIENTE';
    const faltantes = () => {
      const f = [];
      if (!st.fecha) f.push('fecha');
      if (!st.entrega.trim()) f.push('entrega');
      if (!st.direccion.trim()) f.push('direccion');
      if (!st.telefono.trim()) f.push('telefono');
      if (esCli()) {
        if (!st.idTrans.trim()) f.push('idTrans');   // (5-oct-2026) chofer, RUT, teléfono y patente pueden quedar pendientes
      }
      return f;
    };
    const bad = k => st.err && faltantes().includes(k);
    const lbl = (t, k, req) => `<label class="sv-flbl" style="display:block;margin-bottom:6px;${bad(k) ? 'color:#b5000b' : ''}">${t}${req ? ' *' : ''}</label>`;
    const inp = (k, ph, extra = '') => `<label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0;${bad(k) ? 'border-color:#b5000b' : ''}"><input data-k="${k}" value="${escapeHtml(st[k])}" placeholder="${escapeHtml(ph || '')}" style="width:100%" ${extra}></label>`;
    const planTxt = () => {
      const d = parseISODate(st.fecha);
      if (!d) return 'El pedido entra al Plan de Carga cuyo día objetivo es esta fecha.';
      const obj = ctx && ctx.diaObj ? ctx.diaObj(row.ofvta) : null;
      if (obj && d.getTime() <= obj.getTime()) return `Entra al Plan de Carga de hoy (día objetivo ${fmtFechaISO(isoLocal(obj))})${d.getTime() < hoy00().getTime() ? ' · fecha pasada: queda como atrasado' : ''}.`;
      return `Entra al Plan de Carga cuyo día objetivo es el ${fmtFechaISO(st.fecha)} (se arma el día hábil anterior).`;
    };
    const chofList = () => tr.choferes.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim());
    const camList = () => tr.camiones.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim() && String(x.id_camion ?? '').trim());

    function draw() {
      const falt = st.err ? faltantes() : [];
      const reglaTxt = `Regla: ${row._tipo_auto === 'CD-CLIENTE' ? 'CD-Cliente' : 'Consolidable'} · el cliente suma ${fmtNum(row._ton_cliente, 1)} t (umbral 23,8 t)`;
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${editando ? 'Editar coordinación' : 'Coordinar despacho'}</div>
          <div class="sv-dr-t">${escapeHtml(row.doc_ventas)}</div>
          <div class="sv-dr-s">${escapeHtml(row._cliente || ('Cliente ID ' + (row._id_cliente || '—')))} → ${escapeHtml(getNombreCentro(row.ofvta))} · ${fmtNum(row._ton_num, 2)} t</div></div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:18px">
          ${falt.length ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los campos obligatorios marcados en rojo.</div>' : ''}
          <div>${lbl('Tipo de entrega', 'tipo', true)}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[['CONSOLIDABLE', 'Consolidable', 'Sube con la carga a sucursal'], ['CD-CLIENTE', 'CD-Cliente', 'Camión directo al cliente']].map(([v, t, d]) =>
                `<button class="sv-opt ${st.tipo === v ? 'is-on' : ''}" data-tipo="${v}" ${puedeTipo ? '' : 'disabled'} style="flex-direction:column;align-items:flex-start;gap:2px;${puedeTipo || st.tipo === v ? '' : 'opacity:.5;cursor:not-allowed'}"><b style="font-size:14px">${t}</b><span class="sv-sub" style="margin:0">${d}</span></button>`).join('')}
            </div>
            <div class="sv-sub" style="margin-top:6px;max-width:none">${escapeHtml(reglaTxt)}${puedeTipo ? '' : ' · sólo el perfil Owner puede cambiar el tipo'}</div></div>
          <div style="display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start">
            <div>${lbl('Fecha de entrega', 'fecha', true)}
              <label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0;${bad('fecha') ? 'border-color:#b5000b' : ''}"><span class="material-symbols-outlined">calendar_today</span><input type="date" data-k="fecha" data-redraw value="${escapeHtml(st.fecha)}" style="width:140px"></label></div>
            <div>${lbl('N° de entrega', 'entrega', true)}
              <label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0;${bad('entrega') ? 'border-color:#b5000b' : ''}"><span class="material-symbols-outlined">tag</span><input class="is-mono" data-k="entrega" value="${escapeHtml(st.entrega)}" placeholder="N° entrega SAP" style="width:100%"></label></div>
          </div>
          <div class="sv-sub" data-plantxt style="margin-top:-10px;max-width:none">${escapeHtml(planTxt())}</div>
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Datos del cliente</div>
            <div class="sv-sub" style="margin:0;max-width:none">ID ${escapeHtml(row._id_cliente || '—')} · ${escapeHtml(row._cliente || 'sin nombre en el maestro')}</div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
              <div>${lbl('Comuna', 'comuna', false)}${inp('comuna', '')}</div>
              <div>${lbl('Dirección', 'direccion', true)}${inp('direccion', 'Calle, número, obra')}</div>
            </div>
            <div style="max-width:260px">${lbl('Teléfono de contacto', 'telefono', true)}${inp('telefono', '+56 9…')}</div>
          </div>
          ${esCli() ? `
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Datos del transporte (CD-Cliente)</div>
            <div>${lbl('Transportista (ID y nombre)', 'idTrans', true)}
              <div data-bus="trans"></div></div>
            ${notaTranspBloq(tr.trans.find(t => String(t.id) === st.idTrans))}
            ${chofList().length ? `<div>${lbl('Chofer del transportista', 'chof', false)}
              <label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0"><span class="material-symbols-outlined">badge</span>
                <select data-sel="chof" style="border:none;background:transparent;width:100%;font:inherit;outline:none">
                  <option value="">Elegir para autocompletar…</option>
                  ${chofList().map((x, i) => `<option value="${i}" ${x.rut === st.choferRut ? 'selected' : ''}>${escapeHtml([x.nombre, x.apellido].filter(Boolean).join(' '))} · ${escapeHtml(x.rut || '')}</option>`).join('')}
                </select></label></div>` : ''}
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
              <div>${lbl('Nombre chofer', 'choferNombre', false)}${inp('choferNombre', 'Pendiente')}</div>
              <div>${lbl('RUT chofer', 'choferRut', false)}${inp('choferRut', '12.345.678-9')}</div>
              <div>${lbl('Teléfono', 'choferTel', false)}${inp('choferTel', '+56 9…')}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>${lbl('Patente camión', 'patCamion', false)}${inp('patCamion', 'Pendiente', 'list="dl-pat-cam" autocomplete="off"')}</div>
              <div>${lbl('Patente carro (opcional)', 'patCarro', false)}${inp('patCarro', 'Rampla / carro')}</div>
            </div>
            ${notaPendTransp(st, 'el pedido')}
            <datalist id="dl-pat-cam">${camList().map(x => `<option value="${escapeHtml(x.id_camion)}">${escapeHtml([x.modelo, x.capacidad_ton ? x.capacidad_ton + ' t' : ''].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
          </div>` : ''}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio · al guardar queda como «Pedido Coordinado»</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok><span class="material-symbols-outlined">${editando ? 'save' : 'event_available'}</span>${editando ? 'Guardar cambios' : 'Coordinar despacho'}</button></div></div>`;

      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(false)));
      panel.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { if (!puedeTipo) return; st.tipo = b.dataset.tipo; draw(); }));
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener(i.type === 'date' ? 'change' : 'input', () => {
        st[i.dataset.k] = i.value;
        if (i.type === 'date') { const p = panel.querySelector('[data-plantxt]'); if (p) p.textContent = planTxt(); }
      }));
      montarTransp(panel, st, tr, bad('idTrans'), draw);
      panel.querySelector('[data-sel="chof"]')?.addEventListener('change', e => {
        const x = chofList()[+e.target.value];
        if (x) { st.choferNombre = [x.nombre, x.apellido].filter(Boolean).join(' '); st.choferRut = x.rut || ''; st.choferTel = x.telefono || st.choferTel; if (x.id_camion) st.patCamion = x.id_camion; draw(); }
      });
      panel.querySelector('[data-ok]').addEventListener('click', async e => {
        if (faltantes().length) { st.err = true; draw(); return; }
        const btn = e.currentTarget; btn.disabled = true;
        const cli = esCli();
        // Aviso de choque (2-oct-2026): misma patente con otro transportista/chofer el mismo día,
        // misma patente en otra fecha, mismo chofer en otra patente el mismo día, o > 28 t por patente.
        if (cli && (st.patCamion.trim() || st.choferRut.trim())) {
          const avisos = await chequearChoquePatente(row, st, ctx);
          if (avisos.length && !(await confirmar(`Posible choque con el camión ${st.patCamion.trim().toUpperCase()}\n\n${avisos.map(a => '• ' + a).join('\n')}\n\n¿Guardar igual?`, { aceptar: 'Guardar igual', tono: 'peligro', icono: 'warning' }))) { btn.disabled = false; return; }
        }
        const ok = await guardarCoordinacionVenta({
          doc_ventas: String(row.doc_ventas ?? '').trim(), tipo_entrega: st.tipo, fecha_entrega: st.fecha,
          n_entrega: st.entrega.trim(), id_cliente: row._id_cliente || null, nombre_cliente: row._cliente || null,
          comuna: st.comuna.trim() || null, direccion: st.direccion.trim(), telefono: st.telefono.trim(),
          id_transporte: cli ? st.idTrans.trim() : null, transportista: cli ? (st.transportista || null) : null,
          chofer_nombre: cli ? (st.choferNombre.trim() || null) : null, chofer_rut: cli ? (st.choferRut.trim() || null) : null, chofer_telefono: cli ? (st.choferTel.trim() || null) : null,
          patente_camion: cli ? (st.patCamion.trim().toUpperCase() || null) : null, patente_carro: cli ? (st.patCarro.trim().toUpperCase() || null) : null,
        }, !editando);
        if (!ok) { btn.disabled = false; return; }
        const docV = String(row.doc_ventas ?? '').trim();
        if (cli) await registrarSeguimientoCoord([{ doc: docV, tipo: 'CD-CLIENTE', ce: row.ofvta, fechaCarga: st.fecha, origen: '1003 CD Quilicura',
          destino: `Cliente: ${row._cliente || ('ID ' + (row._id_cliente || ''))}`,
          transp: { id_transporte: st.idTrans.trim(), transportista: st.transportista, chofer_nombre: st.choferNombre.trim(), chofer_rut: st.choferRut.trim(),
            chofer_telefono: st.choferTel.trim(), patente_camion: st.patCamion.trim().toUpperCase(), patente_carro: st.patCarro.trim().toUpperCase() },
          lineas: (row._detalle || []).map(d => lineaSegCoord({ tipo_carga: 'Pedidos de venta CD', documento: docV, n_entrega: st.entrega.trim(), material: d.material, nombre: d.nombre,
            cantidad: d.pendiente, ton: d.ton, pedido_venta: docV, ruta: d.ruta, comuna: d.comuna, cliente: row._cliente || '' })) }]);
        else await quitarSeguimientoCoord([docV]);
        const pendV = cli ? pendTranspRetiro({ chofer_nombre: st.choferNombre, chofer_rut: st.choferRut, chofer_telefono: st.choferTel, patente_camion: st.patCamion }) : [];
        showAlert(`Pedido ${row.doc_ventas} coordinado para el ${fmtFechaISO(st.fecha)}` + (pendV.length ? ` · pendiente: ${pendV.join(', ')}` : ''), 'success');
        fin(true);
      });
    }
    draw();
  });
}
// ── Coordinar retiro v3 (3-oct-2026, Jordan) ────────────────────────────────
// Retiro RM (entra al plan, todo obligatorio + transporte) o Retiro local (no entra al plan,
// datos opcionales, tipo FAB-SUC/FAB-CLTE). En Retiro RM se pueden sumar otras OC (mismo u
// otro proveedor) que van en el mismo camión: comparten fecha, tipo de retiro y transporte;
// cada una lleva su entrega entrante (y su dirección si es de otro proveedor).
// (7-oct-2026, Jordan) Productos a retirar: al coordinar se eligen los materiales de la OC y la
// cantidad de cada uno. abast_retiro_estado.lineas_retiro = { "<material>": cantidad }; NULL = toda
// la OC por su pendiente (compatibilidad). Material ausente = no se retira. Nunca supera el pendiente.
function cantRetiroLinea(e, material, pendiente) {
  const sel = e && e.lineas_retiro;
  if (!sel || typeof sel !== 'object') return pendiente;
  const v = sel[String(material ?? '').trim()];
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Math.max(0, Math.min(isFinite(n) ? n : 0, pendiente));
}
const TRANSP_NULL = { id_transporte: null, transportista: null, chofer_nombre: null, chofer_rut: null, chofer_telefono: null, patente_camion: null, patente_carro: null };
async function anularCoordRetiro(docs) {
  const email = await getUserEmail(), now = new Date().toISOString();
  const rows = docs.map(d => ({ doc_compr: String(d).trim(), estado: 'no_coordinado', tipo_local_rm: null, tipo_retiro: null, entrega_entrante: null,
    fab_direccion: null, fab_comuna: null, fab_contacto: null, fab_telefono: null, fecha_retiro: null, lineas_retiro: null, ...TRANSP_NULL, updated_by: email, updated_at: now }));
  const { error } = await supabase.from('abast_retiro_estado').upsert(rows, { onConflict: 'doc_compr' });
  if (error) { showAlert('Error al anular: ' + error.message, 'error'); return false; }
  await quitarSeguimientoCoord(docs);
  return true;
}
// (5-oct-2026, Jordan) Retiro RM: el transporte (ID del maestro) es obligatorio al coordinar; chofer
// y patente pueden quedar PENDIENTES. La OC se coordina igual y queda marcada «Chofer/patente pendiente»
// hasta completarlos editando la coordinación (sin patente el camión directo no queda programado).
const pendTranspRetiro = t => { t = t || {}; return [!String(t.chofer_nombre ?? '').trim() && 'chofer', !String(t.chofer_rut ?? '').trim() && 'RUT chofer',
  !String(t.chofer_telefono ?? '').trim() && 'teléfono chofer', !String(t.patente_camion ?? '').trim() && 'patente'].filter(Boolean); };
async function chequearChoqueRetiro(docsSel, st, ctx) {
  const pat = normPatente(st.patCamion), rut = normPatente(st.choferRut);
  const sel = new Set(docsSel.map(d => String(d).trim()));
  const av = [];
  const estados = (ctx && ctx.estados) || {};
  const rowsBy = new Map(((ctx && ctx._rows) || []).map(r => [String(r.doc_compr ?? '').trim(), r]));
  const otrosRet = Object.entries(estados).filter(([oc, e]) => !sel.has(String(oc).trim()) && modoRetiro(e) === 'RM' && e.patente_camion);
  let ventas = [];
  try { ventas = [...(await loadCoordinacionesVenta()).values()].filter(c => c.patente_camion); } catch (_) { /* */ }
  const otros = otrosRet.map(([oc, e]) => ({ doc: 'OC ' + oc, fecha: e.fecha_retiro, pat: e.patente_camion, idT: e.id_transporte, tr: e.transportista, chN: e.chofer_nombre, chR: e.chofer_rut, ton: (r0 => r0._ton_ret ?? r0._ton_num ?? 0)(rowsBy.get(String(oc).trim()) || {}) }))
    .concat(ventas.map(c => ({ doc: 'NV ' + c.doc_ventas, fecha: c.fecha_entrega, pat: c.patente_camion, idT: c.id_transporte, tr: c.transportista, chN: c.chofer_nombre, chR: c.chofer_rut, ton: 0 })));
  const fF = d => fmtFechaISO(d);
  const mismaPat = otros.filter(o => normPatente(o.pat) === pat);
  const mismoDia = mismaPat.filter(o => o.fecha === st.fecha);
  mismoDia.forEach(o => {
    if (String(o.idT ?? '').trim() !== st.idTrans.trim()) av.push(`${o.doc} usa esta patente el ${fF(o.fecha)} con otro transporte (${[o.idT, o.tr].filter(Boolean).join(' · ') || 'sin dato'}).`);
    else if (normPatente(o.chR) !== rut) av.push(`${o.doc} usa esta patente el ${fF(o.fecha)} con otro chofer (${[o.chN, o.chR].filter(Boolean).join(' · ')}).`);
  });
  mismaPat.filter(o => o.fecha !== st.fecha).forEach(o => av.push(`La patente ya está coordinada el ${fF(o.fecha)} (${o.doc}); revisa si la fecha es correcta.`));
  if (rut) otros.filter(o => o.fecha === st.fecha && normPatente(o.chR) === rut && normPatente(o.pat) !== pat)
    .forEach(o => av.push(`El chofer ya está coordinado el ${fF(o.fecha)} en otra patente (${o.pat || '—'}, ${o.doc}).`));
  const tonSel = st.tonSel != null ? st.tonSel : docsSel.reduce((s, d) => s + (((rowsBy.get(String(d).trim()) || {})._ton_ret ?? (rowsBy.get(String(d).trim()) || {})._ton_num) || 0), 0);
  const tonTot = tonSel + mismoDia.reduce((s, o) => s + (o.ton || 0), 0);
  if (tonTot > CAP_CAMION_DIRECTO + 1e-9) av.push(`El camión suma ${fmtNum(tonTot, 1)} t (supera ${CAP_CAMION_DIRECTO} t).`);
  return av;
}
function showCoordRetiroModal(row, ctx) {
  return new Promise(async resolve => {
    const t0 = row._transp || {};
    const editando = !!row._modo;
    let dirs = [];
    try {
      const { data } = await supabase.from('abast_proveedor_direcciones').select('id, nombre_fabrica, direccion, comuna, region, contacto_nombre, contacto_telefono')
        .eq('proveedor_id', row.proveedor ?? '').eq('activo', true);
      dirs = data || [];
    } catch (_) { /* sin direcciones guardadas */ }
    let tr = { trans: [], choferes: [], camiones: [] };
    try { tr = await loadTransportistasCoord(); } catch (_) { /* */ }
    const allRows = ((ctx && ctx._rows) || []).filter(x => String(x.doc_compr) !== String(row.doc_compr));
    const st = {
      modo: row._modo || 'RM',
      tipo: row._tipo_retiro || '',
      fecha: row._fecha_retiro || '',
      dirSel: null, dirTxt: '', comuna: row._fab_comuna || '', contacto: row._fab_contacto || '', tel: row._fab_telefono || '',
      entrega: row._entrega_entrante || '', guardar: true,
      idTrans: t0.id_transporte || '', transportista: t0.transportista || '',
      choferNombre: t0.chofer_nombre || '', choferRut: t0.chofer_rut || '', choferTel: t0.chofer_telefono || '',
      patCamion: t0.patente_camion || '', patCarro: t0.patente_carro || '',
      extras: new Map(), q: '', err: false,
      // (7-oct-2026) Productos a retirar: material → { on, cant }. Sin selección guardada = todo el pendiente.
      lineas: new Map((row._detalle || []).map(d => { const c = cantRetiroLinea({ lineas_retiro: row._lineas_retiro }, d.material, d.pendiente);
        return [String(d.material ?? '').trim(), { on: c > 0, cant: c > 0 ? c : d.pendiente }]; })),
    };
    if (row._fab_direccion) {
      const m = dirs.find(d => d.direccion === row._fab_direccion);
      if (m) st.dirSel = String(m.id); else { st.dirSel = 'new'; st.dirTxt = row._fab_direccion; }
    } else if (dirs.length === 1) { st.dirSel = String(dirs[0].id); st.comuna = st.comuna || dirs[0].comuna || ''; st.contacto = st.contacto || dirs[0].contacto_nombre || ''; st.tel = st.tel || dirs[0].contacto_telefono || ''; }
    else if (!dirs.length) st.dirSel = 'new';
    // OC ya coordinadas en el mismo camión (misma patente y fecha) se precargan como acompañantes.
    if (editando && t0.patente_camion && row._fecha_retiro) {
      allRows.filter(x => x._modo === 'RM' && x._fecha_retiro === row._fecha_retiro && normPatente((x._transp || {}).patente_camion) === normPatente(t0.patente_camion))
        .forEach(x => st.extras.set(String(x.doc_compr), { entrega: x._entrega_entrante || '', dir: x._fab_direccion || '', comuna: x._fab_comuna || '', contacto: x._fab_contacto || '', tel: x._fab_telefono || '' }));
    }

    const wrap = document.createElement('div');
    wrap.id = 'coord-modal-bg';
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(640px,100vw)" role="dialog" aria-label="Coordinar retiro"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sv-cf-bg') && !cerrarBuscadorAbierto(e)) { e.stopPropagation(); fin(false); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(false));

    const rm = () => st.modo === 'RM';
    const dirMain = () => st.dirSel === 'new' ? st.dirTxt.trim() : (dirs.find(d => String(d.id) === st.dirSel)?.direccion || '');
    const rowOf = oc => allRows.find(x => String(x.doc_compr) === String(oc));
    const mismoProv = x => String(x.proveedor ?? '').trim() === String(row.proveedor ?? '').trim();
    const faltantes = () => {
      const f = [];
      if (!lineasOk()) f.push('lineas');
      if (!rm()) return f;
      if (!st.fecha) f.push('fecha');
      if (!dirMain()) f.push('dir');
      if (!st.comuna.trim()) f.push('comuna');
      if (!st.contacto.trim()) f.push('contacto');
      if (!st.tel.trim()) f.push('tel');
      if (!st.entrega.trim()) f.push('entrega');
      if (!st.tipo) f.push('tipo');
      if (!String(st.idTrans).trim()) f.push('idTrans');   // (5-oct-2026) chofer y patente pueden quedar pendientes
      st.extras.forEach((e, oc) => {
        if (!e.entrega.trim()) f.push('x_entrega_' + oc);
        const x = rowOf(oc);
        if (x && !mismoProv(x)) ['dir', 'comuna', 'contacto', 'tel'].forEach(k => { if (!String(e[k]).trim()) f.push(`x_${k}_${oc}`); });
      });
      return f;
    };
    const bad = k => st.err && faltantes().includes(k);
    const lbl = (txt, k, req) => `<label class="sv-flbl" style="display:block;margin-bottom:6px;${bad(k) ? 'color:#b5000b' : ''}">${txt}${req ? ' *' : ''}</label>`;
    const inpS = k => `width:100%;box-sizing:border-box;min-width:0;${bad(k) ? 'border-color:#b5000b' : ''}`;
    const inp = (k, ph, extra = '') => `<label class="sv-inp" style="${inpS(k)}"><input data-k="${k}" value="${escapeHtml(st[k])}" placeholder="${escapeHtml(ph || '')}" style="width:100%" ${extra}></label>`;
    const xinp = (oc, k, ph) => `<label class="sv-inp" style="${inpS(`x_${k}_${oc}`)}"><input data-x="${escapeHtml(oc)}" data-xk="${k}" value="${escapeHtml(st.extras.get(oc)[k])}" placeholder="${escapeHtml(ph || '')}" style="width:100%"></label>`;
    const chofList = () => tr.choferes.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim());
    const camList = () => tr.camiones.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim() && String(x.id_camion ?? '').trim());
    const detOf = m => (row._detalle || []).find(d => String(d.material ?? '').trim() === m) || {};
    const cantOk = (l, d) => isFinite(l.cant) && l.cant > 0 && l.cant <= (d.pendiente || 0) + 1e-9;
    const lineasOk = () => { const on = [...st.lineas].filter(([, l]) => l.on); return on.length > 0 && on.every(([m, l]) => cantOk(l, detOf(m))); };
    const tonLinea = (m, l) => l.on && isFinite(l.cant) ? calcTon(detOf(m).pesoU || 0, Math.max(0, l.cant)) : 0;
    const tonMain = () => [...st.lineas].reduce((s, [m, l]) => s + tonLinea(m, l), 0);
    const lineasSel = () => {   // null = toda la OC por su pendiente
      const det = row._detalle || [];
      const todo = det.every(d => { const l = st.lineas.get(String(d.material ?? '').trim()); return l && l.on && Math.abs(l.cant - d.pendiente) < 1e-9; });
      if (todo) return null;
      const o = {}; st.lineas.forEach((l, m) => { if (l.on && l.cant > 0) o[m] = Math.round(l.cant * 1000) / 1000; });
      return o;
    };
    const tonSel = () => tonMain() + [...st.extras.keys()].reduce((s, oc) => s + (((rowOf(oc) || {})._ton_ret ?? (rowOf(oc) || {})._ton_num) || 0), 0);
    const candidatos = () => {
      const q = st.q.trim().toLowerCase();
      return allRows
        .filter(x => !st.extras.has(String(x.doc_compr)))
        .filter(x => !q || `${x.doc_compr} ${x.nombre_1} ${x.proveedor}`.toLowerCase().includes(q))
        .sort((a, b) => (mismoProv(b) - mismoProv(a)) || ((String(b.ce) === String(row.ce)) - (String(a.ce) === String(row.ce))) || ((b._ton_num || 0) - (a._ton_num || 0)))
        .slice(0, 12);
    };
    const tiposOpc = () => rm() ? [['FAB-SUC', 'Directo a sucursal'], ['FAB-CLTE', 'Directo a cliente'], ['FAB-CD', 'Consolida en CD']] : [['FAB-SUC', 'Directo a sucursal'], ['FAB-CLTE', 'Directo a cliente']];

    function draw() {
      const falt = st.err ? faltantes() : [];
      if (!rm() && st.tipo === 'FAB-CD') st.tipo = '';
      const ton = tonSel();
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${editando ? 'Editar coordinación' : 'Coordinar retiro'}</div>
          <div class="sv-dr-t">${escapeHtml(row.doc_compr)}</div>
          <div class="sv-dr-s">${escapeHtml(row.nombre_1 || '')} → ${escapeHtml(getNombreCentro(row.ce))} · ${fmtNum(row._ton_num, 2)} t · ${row._tipo_pedido === 'CALZADA' ? 'Calzada' : 'Stock'}</div></div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:18px">
          ${falt.length ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los campos obligatorios marcados en rojo.</div>' : ''}
          <div>${lbl('Tipo de coordinación', 'modo', true)}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[['RM', 'Retiro RM', 'Nuestro camión retira · entra al Plan de Carga', '#15803d'], ['LOCAL', 'Retiro local', 'Lo gestiona la sucursal · no entra al plan', '#ea580c']].map(([v, t, d, c]) =>
                `<button class="sv-opt ${st.modo === v ? 'is-on' : ''}" data-modo="${v}" style="flex-direction:column;align-items:flex-start;gap:2px;${st.modo === v ? `border-color:${c};background:${v === 'RM' ? '#f0fdf4' : '#fff7ed'}` : ''}"><b style="font-size:14px;color:${c}">${t}</b><span class="sv-sub" style="margin:0">${d}</span></button>`).join('')}
            </div></div>
          <div>${lbl('Tipo de retiro', 'tipo', rm())}
            <div style="display:grid;grid-template-columns:repeat(${tiposOpc().length},1fr);gap:8px;${bad('tipo') ? 'outline:1px solid #b5000b;border-radius:4px' : ''}">
              ${tiposOpc().map(([v, d]) => `<button class="sv-opt ${st.tipo === v ? 'is-on' : ''}" data-tipo="${v}" style="flex-direction:column;align-items:flex-start;gap:2px"><b>${v}</b><span class="sv-sub" style="margin:0">${d}</span></button>`).join('')}
            </div>
            <div class="sv-sub" style="margin-top:6px;max-width:none">Regla automática: ${escapeHtml(row._tipo_auto || '')} (${fmtNum(row._ton_num, 1)} t; umbral 23,8 t)</div></div>
          <div style="display:grid;grid-template-columns:220px 1fr;gap:12px">
            <div>${lbl('Fecha de retiro (carga)', 'fecha', rm())}
              <label class="sv-inp" style="${inpS('fecha')}"><span class="material-symbols-outlined">calendar_today</span><input type="date" data-k="fecha" value="${escapeHtml(st.fecha)}" style="width:140px"></label></div>
            <div>${lbl('Entrega entrante', 'entrega', rm())}
              <label class="sv-inp" style="${inpS('entrega')}"><span class="material-symbols-outlined">tag</span><input class="is-mono" data-k="entrega" value="${escapeHtml(st.entrega)}" placeholder="N° de entrega" style="width:100%"></label></div>
          </div>
          ${rm() ? '<div class="sv-sub" style="margin-top:-10px;max-width:none">La OC entra al Plan de Carga del día de su fecha de retiro (día en que se carga).</div>' : ''}
          ${lineasHtml()}
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Fábrica y contacto</div>
            ${lbl('Dirección de fábrica', 'dir', rm())}
            <div data-bus="dir"></div>
            ${st.dirSel === 'new' ? `${inp('dirTxt', 'Calle, número')}
              ${row.proveedor ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#5c5f61;cursor:pointer"><input type="checkbox" data-k="guardar" ${st.guardar ? 'checked' : ''}> Guardar esta dirección en el proveedor</label>` : ''}` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <div>${lbl('Comuna', 'comuna', rm())}${inp('comuna', '')}</div>
              <div>${lbl('Contacto', 'contacto', rm())}<div data-combo="contacto"></div></div>
              <div>${lbl('Teléfono', 'tel', rm())}${inp('tel', '+56 9…')}</div>
            </div>
          </div>
          ${rm() ? `
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Datos del transporte${st.tipo === 'FAB-CD' ? ' (fábrica → CD)' : ''}</div>
            <div>${lbl('Transportista (ID y nombre)', 'idTrans', true)}
              <div data-bus="trans"></div></div>
            ${notaTranspBloq(tr.trans.find(t => String(t.id) === st.idTrans))}
            ${chofList().length ? `<div>${lbl('Chofer del transportista', 'chof', false)}
              <label class="sv-inp" style="${inpS('chof')}"><span class="material-symbols-outlined">badge</span>
                <select data-sel="chof" style="border:none;background:transparent;width:100%;font:inherit;outline:none">
                  <option value="">Elegir para autocompletar…</option>
                  ${chofList().map((x, i) => `<option value="${i}" ${x.rut === st.choferRut ? 'selected' : ''}>${escapeHtml([x.nombre, x.apellido].filter(Boolean).join(' '))} · ${escapeHtml(x.rut || '')}</option>`).join('')}
                </select></label></div>` : ''}
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
              <div>${lbl('Nombre chofer', 'choferNombre', false)}${inp('choferNombre', 'Pendiente')}</div>
              <div>${lbl('RUT chofer', 'choferRut', false)}${inp('choferRut', '12.345.678-9')}</div>
              <div>${lbl('Teléfono', 'choferTel', false)}${inp('choferTel', '+56 9…')}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>${lbl('Patente camión', 'patCamion', false)}${inp('patCamion', 'Pendiente', 'list="dl-pat-ret" autocomplete="off"')}</div>
              <div>${lbl('Patente carro (opcional)', 'patCarro', false)}${inp('patCarro', 'Rampla / carro')}</div>
            </div>
            ${(() => { const pd = pendTranspRetiro({ chofer_nombre: st.choferNombre, chofer_rut: st.choferRut, chofer_telefono: st.choferTel, patente_camion: st.patCamion });
              return pd.length ? `<div class="sv-note-box" style="background:#fef3c7;color:#713f12"><b>Pendiente:</b> ${escapeHtml(pd.join(', '))}. Puedes coordinar igual; la OC queda marcada <b>«Chofer/patente pendiente»</b> y se completa después con «Editar coordinación».${pd.includes('patente') ? ' Sin patente, el camión directo aún no queda programado en el Plan de Carga.' : ''}</div>` : ''; })()}
            <datalist id="dl-pat-ret">${camList().map(x => `<option value="${escapeHtml(x.id_camion)}">${escapeHtml([x.modelo, x.capacidad_ton ? x.capacidad_ton + ' t' : ''].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
          </div>
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div class="sv-b" style="font-size:14px">Otras OC en el mismo camión</div>
              <span class="sv-pill ${ton > CAP_CAMION_DIRECTO + 1e-9 ? 'bad' : 'ok'}" data-ton-cam><i></i>${fmtNum(ton, 1)} t de ${CAP_CAMION_DIRECTO} t</span>
            </div>
            ${[...st.extras.keys()].map(oc => { const x = rowOf(oc) || {}; const otro = !mismoProv(x); return `
              <div style="border:1px solid var(--sv-line);border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:8px">
                <div style="display:flex;align-items:center;gap:8px"><b class="sv-mono">${escapeHtml(oc)}</b><span class="sv-sub" style="margin:0;flex:1">${escapeHtml(x.nombre_1 || '')} → ${escapeHtml(getNombreCentro(x.ce))} · ${fmtNum((x._ton_ret ?? x._ton_num) || 0, 1)} t${x._parcial ? ' (parcial)' : ''}</span>
                  <button class="sv-iconbtn" data-xdel="${escapeHtml(oc)}" title="Quitar del camión"><span class="material-symbols-outlined">close</span></button></div>
                <div style="display:grid;grid-template-columns:1fr ${otro ? '2fr' : ''};gap:8px">
                  <div>${lbl('Entrega entrante', 'x_entrega_' + oc, true)}${xinp(oc, 'entrega', 'N° de entrega')}</div>
                  ${otro ? `<div>${lbl('Dirección fábrica', 'x_dir_' + oc, true)}${xinp(oc, 'dir', 'Calle, número')}</div>` : ''}
                </div>
                ${otro ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                  <div>${lbl('Comuna', 'x_comuna_' + oc, true)}${xinp(oc, 'comuna', '')}</div>
                  <div>${lbl('Contacto', 'x_contacto_' + oc, true)}${xinp(oc, 'contacto', 'Nombre')}</div>
                  <div>${lbl('Teléfono', 'x_tel_' + oc, true)}${xinp(oc, 'tel', '+56 9…')}</div></div>` : '<div class="sv-sub" style="margin:0">Mismo proveedor: usa la dirección y el contacto de arriba.</div>'}
              </div>`; }).join('')}
            <label class="sv-inp" style="width:100%;box-sizing:border-box"><span class="material-symbols-outlined">search</span><input data-q value="${escapeHtml(st.q)}" placeholder="Buscar OC o proveedor para agregar" style="width:100%"></label>
            <div data-cands style="display:flex;flex-direction:column;gap:4px">${candHtml()}</div>
          </div>` : ''}
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok><span class="material-symbols-outlined">${editando ? 'save' : 'event_available'}</span>${editando ? 'Guardar cambios' : 'Confirmar coordinación'}${st.extras.size ? ` (${st.extras.size + 1} OC)` : ''}</button></div></div>`;
      wire();
    }
    function lineasResumen() {
      const det = row._detalle || [];
      const on = [...st.lineas.values()].filter(l => l.on).length;
      return `${on} de ${det.length} producto${det.length === 1 ? '' : 's'} · ${fmtNum(tonMain(), 2)} t de ${fmtNum(row._ton_num || 0, 2)} t`;
    }
    function lineasHtml() {
      const det = row._detalle || [];
      if (!det.length) return '';
      const todos = [...st.lineas.values()].every(l => l.on);
      const errL = bad('lineas');
      return `<div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;${errL ? 'border-color:#b5000b' : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div class="sv-b" style="font-size:14px;${errL ? 'color:#b5000b' : ''}">Productos a retirar *</div>
          <span class="sv-pill ${errL ? 'bad' : 'ok'}" data-lin-res><i></i>${lineasResumen()}</span>
        </div>
        ${errL ? '<div class="sv-sub" style="margin:0;color:#b5000b;max-width:none">Selecciona al menos un producto; la cantidad debe ser mayor a 0 y no superar el pendiente.</div>' : ''}
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="text-align:left;color:#5c5f61;border-bottom:1px solid var(--sv-line)">
              <th style="padding:6px 4px;width:28px"><input type="checkbox" data-lin-all ${todos ? 'checked' : ''} title="Seleccionar todo"></th>
              <th style="padding:6px 4px">Material</th>
              <th style="padding:6px 4px;text-align:right">Pendiente</th>
              <th style="padding:6px 4px;text-align:right;width:110px">A retirar</th>
              <th style="padding:6px 4px;text-align:right">Ton</th></tr></thead>
            <tbody>${det.map(d => { const m = String(d.material ?? '').trim(); const l = st.lineas.get(m) || { on: false, cant: 0 }; const ko = st.err && l.on && !cantOk(l, d);
              return `<tr style="border-bottom:1px solid var(--sv-line);${l.on ? '' : 'opacity:.55'}">
                <td style="padding:6px 4px"><input type="checkbox" data-lin-on="${escapeHtml(m)}" ${l.on ? 'checked' : ''}></td>
                <td style="padding:6px 4px;min-width:0"><b class="sv-mono">${escapeHtml(m)}</b><div class="sv-sub" style="margin:0">${escapeHtml(d.texto_breve || '')}</div></td>
                <td style="padding:6px 4px;text-align:right" class="sv-mono">${fmtNum(d.pendiente, 0)}</td>
                <td style="padding:6px 4px;text-align:right"><label class="sv-inp" style="width:100px;box-sizing:border-box;${ko ? 'border-color:#b5000b' : ''}"><input type="number" min="0" max="${d.pendiente}" step="any" data-lin-cant="${escapeHtml(m)}" value="${l.on ? escapeHtml(String(l.cant)) : ''}" ${l.on ? '' : 'disabled'} style="width:100%;text-align:right"></label></td>
                <td style="padding:6px 4px;text-align:right" class="sv-mono" data-lin-ton="${escapeHtml(m)}">${fmtNum(tonLinea(m, l), 2)}</td></tr>`; }).join('')}</tbody>
          </table>
        </div>
        <div class="sv-sub" style="margin:0;max-width:none">Sólo los productos marcados, por la cantidad indicada, entran al Plan de Carga y al Seguimiento de Carga.</div>
      </div>`;
    }
    function wireLineas() {
      panel.querySelector('[data-lin-all]')?.addEventListener('change', e => {
        const on = e.target.checked;
        (row._detalle || []).forEach(d => { const m = String(d.material ?? '').trim(); const l = st.lineas.get(m); if (l) { l.on = on; if (on && !(l.cant > 0)) l.cant = d.pendiente; } });
        draw();
      });
      panel.querySelectorAll('[data-lin-on]').forEach(i => i.addEventListener('change', () => {
        const m = i.dataset.linOn, l = st.lineas.get(m); if (!l) return;
        l.on = i.checked; if (l.on && !(l.cant > 0)) l.cant = detOf(m).pendiente || 0;
        draw();
      }));
      panel.querySelectorAll('[data-lin-cant]').forEach(i => {
        i.addEventListener('input', () => {
          const m = i.dataset.linCant, l = st.lineas.get(m); if (!l) return;
          l.cant = i.value === '' ? NaN : parseFloat(String(i.value).replace(',', '.'));
          const tc = panel.querySelector(`[data-lin-ton="${CSS.escape(m)}"]`); if (tc) tc.textContent = fmtNum(tonLinea(m, l), 2);
          const rs = panel.querySelector('[data-lin-res]'); if (rs) rs.innerHTML = '<i></i>' + lineasResumen();
          const tp = panel.querySelector('[data-ton-cam]'); if (tp) { const t = tonSel(); tp.className = 'sv-pill ' + (t > CAP_CAMION_DIRECTO + 1e-9 ? 'bad' : 'ok'); tp.innerHTML = `<i></i>${fmtNum(t, 1)} t de ${CAP_CAMION_DIRECTO} t`; }
        });
        i.addEventListener('change', () => {   // al salir: no superar el pendiente
          const m = i.dataset.linCant, l = st.lineas.get(m), d = detOf(m); if (!l) return;
          if (isFinite(l.cant) && l.cant > (d.pendiente || 0)) { l.cant = d.pendiente; showAlert(`La cantidad de ${m} no puede superar el pendiente (${fmtNum(d.pendiente, 0)}).`, 'warning'); draw(); }
        });
      });
    }
    function candHtml() {
      const c = candidatos();
      if (!c.length) return '<div class="sv-sub" style="margin:0">Sin OC para agregar.</div>';
      return c.map(x => `<button class="sv-opt" data-xadd="${escapeHtml(x.doc_compr)}" style="padding:6px 10px">
        <span class="material-symbols-outlined" style="color:#5c5f61">add_circle</span>
        <span style="flex:1;min-width:0"><b class="sv-mono">${escapeHtml(x.doc_compr)}</b> <span class="sv-sub" style="display:inline;margin:0">${escapeHtml(x.nombre_1 || '')} → ${escapeHtml(getNombreCentro(x.ce))}</span></span>
        <span class="sv-sub" style="margin:0">${x._modo === 'RM' ? 'RM · ' : x._modo === 'LOCAL' ? 'Local · ' : ''}${fmtNum(x._ton_num || 0, 1)} t</span></button>`).join('');
    }
    function wireCands() {
      panel.querySelectorAll('[data-xadd]').forEach(b => b.addEventListener('click', () => {
        const x = rowOf(b.dataset.xadd); if (!x) return;
        st.extras.set(String(x.doc_compr), { entrega: x._entrega_entrante || '', dir: x._fab_direccion || '', comuna: x._fab_comuna || '', contacto: x._fab_contacto || '', tel: x._fab_telefono || '' });
        draw();
      }));
    }
    function wire() {
      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(false)));
      panel.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => { st.modo = b.dataset.modo; draw(); }));
      panel.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { st.tipo = st.tipo === b.dataset.tipo && !rm() ? '' : b.dataset.tipo; draw(); }));
      // (5-oct-2026, Jordan) Dirección de fábrica: desplegable buscable (antes una lista con todas las direcciones).
      st.busD = st.busD || { open: false, q: '' };
      const dirItems = [...dirs, { id: 'new', _nueva: true }];
      const dirTxt = d => [d.direccion, d.comuna, d.region].filter(Boolean).join(', ');
      montarBuscador(panel.querySelector('[data-bus="dir"]'), {
        items: dirItems, id: d => d.id, selId: st.dirSel, estado: st.busD, invalid: bad('dir'), alto: 240,
        texto: d => d._nueva ? 'otra direccion nueva ingresar' : `${d.nombre_fabrica} ${d.direccion} ${d.comuna} ${d.region} ${d.contacto_nombre}`,
        fila: d => d._nueva ? '<span class="material-symbols-outlined" style="color:#5c5f61">add_location_alt</span><span style="flex:1"><b>Otra dirección</b><div class="sv-sub" style="margin:0">Ingresar una nueva</div></span>'
          : `<span class="material-symbols-outlined" style="color:#5c5f61">factory</span><span style="flex:1;min-width:0"><b>${escapeHtml(d.nombre_fabrica || d.direccion)}</b><div class="sv-sub" style="margin:0">${escapeHtml(dirTxt(d))}${d.contacto_nombre ? ' · ' + escapeHtml(d.contacto_nombre) : ''}</div></span>`,
        tarjeta: d => d._nueva ? '<span class="material-symbols-outlined" style="color:#5c5f61">add_location_alt</span><div style="flex:1"><b>Otra dirección</b><div class="sv-sub" style="margin:0">Ingrésala abajo</div></div>'
          : `<span class="material-symbols-outlined" style="color:#b5000b">factory</span><div style="flex:1;min-width:0"><b>${escapeHtml(d.nombre_fabrica || d.direccion)}</b><div class="sv-sub" style="margin:0">${escapeHtml(dirTxt(d))}</div></div>`,
        placeholder: `Buscar entre ${dirs.length} dirección(es) del proveedor…`,
        onPick: d => { st.dirSel = String(d.id); if (!d._nueva) { if (d.comuna) st.comuna = d.comuna; if (d.contacto_nombre) st.contacto = d.contacto_nombre; if (d.contacto_telefono) st.tel = d.contacto_telefono; } draw(); },
      });
      // Contacto: texto libre con los contactos guardados del proveedor como lista desplegable.
      const contactos = [];
      [...dirs].sort((x, y) => (String(y.id) === st.dirSel) - (String(x.id) === st.dirSel)).forEach(d => {
        const n = String(d.contacto_nombre ?? '').trim(); if (!n) return;
        const k = normBus(n) + '|' + String(d.contacto_telefono ?? '').trim();
        if (!contactos.some(c => c.k === k)) contactos.push({ k, nombre: n, tel: String(d.contacto_telefono ?? '').trim(), fab: d.nombre_fabrica || d.direccion || '' });
      });
      montarComboLibre(panel.querySelector('[data-combo="contacto"]'), {
        valor: st.contacto, items: contactos, invalid: bad('contacto'), placeholder: contactos.length ? 'Nombre o elegir ▾' : 'Nombre',
        texto: c => `${c.nombre} ${c.tel} ${c.fab}`,
        fila: c => `<b>${escapeHtml(c.nombre)}</b><div class="sv-sub" style="margin:0">${escapeHtml([c.tel, c.fab].filter(Boolean).join(' · '))}</div>`,
        onInput: v => { st.contacto = v; },
        onPick: c => { st.contacto = c.nombre; if (c.tel) st.tel = c.tel; draw(); },
      });
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener(i.type === 'checkbox' || i.type === 'date' ? 'change' : 'input', () => { st[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; }));
      panel.querySelectorAll('[data-x]').forEach(i => i.addEventListener('input', () => { const e = st.extras.get(i.dataset.x); if (e) e[i.dataset.xk] = i.value; }));
      panel.querySelectorAll('[data-xdel]').forEach(b => b.addEventListener('click', () => { st.extras.delete(b.dataset.xdel); draw(); }));
      panel.querySelector('[data-q]')?.addEventListener('input', e => { st.q = e.target.value; const c = panel.querySelector('[data-cands]'); if (c) { c.innerHTML = candHtml(); wireCands(); } });
      wireCands();
      wireLineas();
      montarTransp(panel, st, tr, bad('idTrans'), draw);
      panel.querySelector('[data-sel="chof"]')?.addEventListener('change', e => {
        const x = chofList()[+e.target.value];
        if (x) { st.choferNombre = [x.nombre, x.apellido].filter(Boolean).join(' '); st.choferRut = x.rut || ''; st.choferTel = x.telefono || st.choferTel; if (x.id_camion) st.patCamion = x.id_camion; draw(); }
      });
      panel.querySelector('[data-ok]').addEventListener('click', async e => {
        if (faltantes().length) { st.err = true; draw(); return; }
        const btn = e.currentTarget; btn.disabled = true;
        const docs = [String(row.doc_compr).trim(), ...(rm() ? [...st.extras.keys()] : [])];
        if (rm() && (st.patCamion.trim() || st.choferRut.trim())) {
          st.tonSel = tonSel();
          const avisos = await chequearChoqueRetiro(docs, st, ctx);
          if (avisos.length && !(await confirmar(`Posible choque con el camión ${st.patCamion.trim().toUpperCase()}\n\n${avisos.map(a => '• ' + a).join('\n')}\n\n¿Guardar igual?`, { aceptar: 'Guardar igual', tono: 'peligro', icono: 'warning' }))) { btn.disabled = false; return; }
        }
        const fabDir = dirMain();
        if (st.dirSel === 'new' && st.guardar && fabDir && row.proveedor) {
          await supabase.from('abast_proveedor_direcciones').insert({ proveedor_id: row.proveedor, nombre_fabrica: fabDir.toUpperCase(), direccion: fabDir, comuna: st.comuna.trim(), contacto_nombre: st.contacto.trim() || null, contacto_telefono: st.tel.trim() || null, activo: true });
        }
        const email = await getUserEmail(), now = new Date().toISOString();
        const transp = rm() ? {
          id_transporte: st.idTrans.trim(), transportista: st.transportista || null,
          chofer_nombre: st.choferNombre.trim() || null, chofer_rut: st.choferRut.trim() || null, chofer_telefono: st.choferTel.trim() || null,
          patente_camion: st.patCamion.trim().toUpperCase() || null, patente_carro: st.patCarro.trim().toUpperCase() || null,
        } : TRANSP_NULL;
        const base = { estado: 'coordinado', tipo_local_rm: st.modo, tipo_retiro: st.tipo || null, fecha_retiro: st.fecha || null, ...transp, updated_by: email, updated_at: now };
        const filas = [{ ...base, doc_compr: String(row.doc_compr).trim(), entrega_entrante: st.entrega.trim() || null, lineas_retiro: lineasSel(),
          fab_direccion: fabDir || null, fab_comuna: st.comuna.trim() || null, fab_contacto: st.contacto.trim() || null, fab_telefono: st.tel.trim() || null }];
        if (rm()) st.extras.forEach((x, oc) => {
          const xr = rowOf(oc) || {}; const mismo = mismoProv(xr);
          filas.push({ ...base, doc_compr: String(oc).trim(), entrega_entrante: x.entrega.trim() || null, lineas_retiro: xr._lineas_retiro ?? null,
            fab_direccion: mismo ? (fabDir || null) : (x.dir.trim() || null), fab_comuna: mismo ? (st.comuna.trim() || null) : (x.comuna.trim() || null),
            fab_contacto: mismo ? (st.contacto.trim() || null) : (x.contacto.trim() || null), fab_telefono: mismo ? (st.tel.trim() || null) : (x.tel.trim() || null) });
        });
        const { error } = await supabase.from('abast_retiro_estado').upsert(filas, { onConflict: 'doc_compr' });
        if (error) { showAlert('Error al coordinar: ' + error.message, 'error'); btn.disabled = false; return; }
        if (rm() && st.tipo) await registrarSeguimientoCoord(filas.map(f => {
          const x = String(f.doc_compr) === String(row.doc_compr).trim() ? row : (rowOf(f.doc_compr) || {});
          const ce = String(x.ce ?? row.ce ?? '').trim();
          return { doc: f.doc_compr, tipo: st.tipo, ce, fechaCarga: st.fecha, origen: x.nombre_1 || 'Fábrica',
            destino: st.tipo === 'FAB-CD' ? '1003 CD Quilicura' : st.tipo === 'FAB-CLTE' ? `Cliente: ${x._pv_nombre_cliente || ''}` : `${ce} ${getNombreCentro(ce)}`,
            transp, lineas: (x._detalle || []).map(d => ({ d, c: cantRetiroLinea(f, d.material, d.pendiente) })).filter(o => o.c > 0).map(({ d, c }) => lineaSegCoord({ tipo_carga: 'Retiro Fábrica', documento: f.doc_compr, n_entrega: f.entrega_entrante || '', material: d.material,
              nombre: d.texto_breve, cantidad: c, ton: d.pesoU != null ? calcTon(d.pesoU, c) : d.ton, pedido_venta: x.documento || '', proveedor: x.nombre_1 || '', cliente: x._pv_nombre_cliente || '' })) };
        }));
        else await quitarSeguimientoCoord(filas.map(f => f.doc_compr));
        const pendG = rm() ? pendTranspRetiro(transp) : [];
        showAlert((filas.length > 1 ? `${filas.length} OC coordinadas en el camión ${transp.patente_camion || '(patente pendiente)'}` : `OC ${row.doc_compr} coordinada como ${rm() ? 'Retiro RM' : 'Retiro local'}`)
          + (pendG.length ? ` · pendiente: ${pendG.join(', ')}` : ''), 'success');
        fin(true);
      });
    }
    draw();
  });
}
// ── Datos de transporte para programar un camión del Plan de Carga (3-oct-2026) ──
// ini: datos actuales; otros: [{ lbl, patente_camion, chofer_rut }] camiones ya programados hoy
// (para el aviso de choque). Devuelve el objeto de transporte o null si se cancela.
function showTransporteCamionModal({ titulo, sub, ini = {}, otros = [] }) {
  return new Promise(async resolve => {
    let tr = { trans: [], transTodos: [], choferes: [], camiones: [] };
    try { tr = await loadTransportistasCoord(); } catch (_) { /* sin maestro */ }
    // (4-oct-2026, Jordan) El camión se programa con un transportista del MAESTRO (se elige de la lista).
    const maestro = tr.transTodos || tr.trans || [];
    const faltan = t => [!String(t.rut ?? '').trim() && 'RUT', !String(t.telefono ?? '').trim() && 'teléfono', !String(t.email ?? '').trim() && 'correo'].filter(Boolean);
    const transDe = id => maestro.find(x => String(x.id).trim().toUpperCase() === String(id ?? '').trim().toUpperCase());
    const st = {
      idTrans: ini.id_transporte || '', transportista: ini.transportista || '',
      choferNombre: ini.chofer_nombre || '', choferRut: ini.chofer_rut || '', choferTel: ini.chofer_telefono || '',
      patCamion: ini.patente_camion || '', patCarro: ini.patente_carro || '', err: false,
      q: '', open: false, mRut: '', mTel: '', mEmail: '',
    };
    const wrap = document.createElement('div');
    wrap.id = 'coord-modal-bg';
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="Programar camión"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => {
      if (e.key !== 'Escape' || document.querySelector('.sv-cf-bg')) return;
      e.stopPropagation();
      if (st.open) { st.open = false; draw(); } else fin(null);
    };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(null));
    const sel = () => transDe(st.idTrans);
    const faltanSel = () => { const t = sel(); return t ? faltan(t) : []; };
    const campoMaestro = { RUT: 'mRut', 'teléfono': 'mTel', correo: 'mEmail' };
    const REQ = ['choferNombre', 'choferRut', 'choferTel', 'patCamion'];
    const faltantes = () => {
      const f = REQ.filter(k => !String(st[k]).trim());
      if (!sel()) f.unshift('idTrans');
      faltanSel().forEach(x => { if (!String(st[campoMaestro[x]]).trim()) f.push(campoMaestro[x]); });
      return f;
    };
    const bad = k => st.err && faltantes().includes(k);
    const lbl = (t, k, req) => `<label class="sv-flbl" style="display:block;margin-bottom:6px;${bad(k) ? 'color:#b5000b' : ''}">${t}${req ? ' *' : ''}</label>`;
    const inp = (k, ph, extra = '') => `<label class="sv-inp" style="width:100%;box-sizing:border-box;min-width:0;${bad(k) ? 'border-color:#b5000b' : ''}"><input data-k="${k}" value="${escapeHtml(st[k])}" placeholder="${escapeHtml(ph || '')}" style="width:100%" ${extra}></label>`;
    const chofList = () => tr.choferes.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim());
    const camList = () => tr.camiones.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim() && String(x.id_camion ?? '').trim());
    const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const tipoLbl = t => { const v = String(t.tipo_servicio ?? '').toUpperCase(); return v.includes('TRONCAL') ? 'Troncal' : v.includes('MILLA') ? 'Última milla' : ''; };
    function resultados() {
      const q = norm(st.q).trim();
      const l = !q ? maestro : maestro.filter(t => norm(`${t.id} ${t.razonSocial} ${t.rut}`).includes(q));
      // Troncales primero, luego completos, luego por nombre
      return l.slice().sort((a, b) => (tipoLbl(b) === 'Troncal') - (tipoLbl(a) === 'Troncal') || (faltan(a).length > 0) - (faltan(b).length > 0)
        || String(a.razonSocial || '').localeCompare(String(b.razonSocial || '')));
    }
    function listaHtml() {
      const r = resultados();
      if (!maestro.length) return '<div class="sv-sub" style="padding:10px 12px;margin:0">El maestro de transportistas está vacío.</div>';
      if (!r.length) return '<div class="sv-sub" style="padding:10px 12px;margin:0">Sin resultados en el maestro.</div>';
      return r.slice(0, 60).map(t => {
        const f = faltan(t), tp = tipoLbl(t);
        return `<button type="button" data-tpick="${escapeHtml(t.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:none;border-bottom:1px solid #edeeef;background:${String(t.id) === st.idTrans ? '#f1f5f9' : '#fff'};cursor:pointer;font:inherit">
          <span class="sv-mono" style="min-width:64px;color:#5c5f61">${escapeHtml(t.id)}</span>
          <span style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.razonSocial || '')}</b>
            <small style="color:#5c5f61">${escapeHtml([tp, t.rut].filter(Boolean).join(' · ') || '—')}</small></span>
          ${f.length ? `<span class="sv-pill warn" title="Faltan ${escapeHtml(f.join(', '))}"><i></i>Bloqueado</span>` : '<span class="sv-pill ok"><i></i>Activo</span>'}</button>`;
      }).join('') + (r.length > 60 ? `<div class="sv-sub" style="padding:8px 12px;margin:0">${r.length - 60} más: escribe para acotar.</div>` : '');
    }
    function selHtml() {
      const t = sel();
      if (!t) return st.idTrans ? `<div class="sv-note-box" style="background:#fef3c7;color:#713f12">El ID «${escapeHtml(st.idTrans)}» no está en el maestro de transportistas: elige uno de la lista.</div>` : '';
      const f = faltan(t);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #c5c7c9;border-radius:10px;background:#fafafa">
          <span class="material-symbols-outlined" style="color:#15803d">local_shipping</span>
          <div style="flex:1;min-width:0"><b>${escapeHtml(t.razonSocial || '')}</b><div class="sv-sub" style="margin:0">ID ${escapeHtml(t.id)}${tipoLbl(t) ? ' · ' + tipoLbl(t) : ''}${t.rut ? ' · RUT ' + escapeHtml(t.rut) : ''}${t.telefono ? ' · ' + escapeHtml(t.telefono) : ''}</div></div>
          ${f.length ? '<span class="sv-pill warn"><i></i>Bloqueado</span>' : '<span class="sv-pill ok"><i></i>Activo</span>'}
          <button type="button" class="sv-btn" data-tcambiar style="padding:2px 8px;font-size:12px">Cambiar</button></div>
        ${f.length ? `<div class="sv-note-box" style="margin-top:8px">Este transportista está <b>bloqueado</b> en el maestro: faltan ${escapeHtml(f.join(', '))}. Complétalo aquí y se guarda en el maestro al programar.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px;margin-top:8px">
            ${f.includes('RUT') ? `<div>${lbl('RUT transportista', 'mRut', true)}${inp('mRut', '76.123.456-7')}</div>` : ''}
            ${f.includes('teléfono') ? `<div>${lbl('Teléfono contacto', 'mTel', true)}${inp('mTel', '+56 9…')}</div>` : ''}
            ${f.includes('correo') ? `<div>${lbl('Correo', 'mEmail', true)}${inp('mEmail', 'contacto@empresa.cl', 'type="email"')}</div>` : ''}
          </div>` : ''}`;
    }
    function draw() {
      const falt = st.err ? faltantes() : [];
      const t = sel();
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">Programar camión</div>
          <div class="sv-dr-t">${escapeHtml(titulo)}</div>
          ${sub ? `<div class="sv-dr-s">${escapeHtml(sub)}</div>` : ''}</div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:16px">
          ${falt.length ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los campos obligatorios marcados en rojo.</div>' : ''}
          <div class="sv-sub" style="margin:0;max-width:none">Elige el transportista del maestro de transporte; luego el chofer y las patentes. Al guardar, el camión queda programado para carga.</div>
          <div>
            ${lbl('Transportista (maestro de transporte)', 'idTrans', true)}
            ${t && !st.open ? selHtml() : `
              <div style="position:relative">
                <label class="sv-inp" style="width:100%;box-sizing:border-box;${bad('idTrans') ? 'border-color:#b5000b' : ''}"><span class="material-symbols-outlined">search</span>
                  <input data-tq value="${escapeHtml(st.q)}" placeholder="Buscar por ID, razón social o RUT…" autocomplete="off" style="width:100%"></label>
                <div data-tlist style="margin-top:4px;max-height:280px;overflow:auto;border:1px solid #c5c7c9;border-radius:10px;background:#fff">${listaHtml()}</div>
              </div>${selHtml()}`}
          </div>
          ${chofList().length ? `<div>${lbl('Chofer del transportista', 'chof', false)}
            <label class="sv-inp" style="width:100%;box-sizing:border-box"><span class="material-symbols-outlined">badge</span>
              <select data-sel="chof" style="border:none;background:transparent;width:100%;font:inherit;outline:none">
                <option value="">Elegir para autocompletar…</option>
                ${chofList().map((x, i) => `<option value="${i}" ${x.rut === st.choferRut ? 'selected' : ''}>${escapeHtml([x.nombre, x.apellido].filter(Boolean).join(' '))} · ${escapeHtml(x.rut || '')}</option>`).join('')}
              </select></label></div>` : ''}
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
            <div>${lbl('Nombre chofer', 'choferNombre', true)}${inp('choferNombre', '')}</div>
            <div>${lbl('RUT chofer', 'choferRut', true)}${inp('choferRut', '12.345.678-9')}</div>
            <div>${lbl('Teléfono', 'choferTel', true)}${inp('choferTel', '+56 9…')}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>${lbl('Patente camión', 'patCamion', true)}${inp('patCamion', 'AB-CD-12', 'list="dl-pat-prog" autocomplete="off"')}</div>
            <div>${lbl('Patente carro (opcional)', 'patCarro', false)}${inp('patCarro', 'Rampla / carro')}</div>
          </div>
          <datalist id="dl-pat-prog">${camList().map(x => `<option value="${escapeHtml(x.id_camion)}">${escapeHtml([x.modelo, x.capacidad_ton ? x.capacidad_ton + ' t' : ''].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok><span class="material-symbols-outlined">local_shipping</span>Programar camión</button></div></div>`;
      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(null)));
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { st[i.dataset.k] = i.value; }));
      const wirePicks = () => panel.querySelectorAll('[data-tpick]').forEach(b => b.addEventListener('click', () => {
        const x = transDe(b.dataset.tpick);
        if (!x) return;
        if (x.id !== st.idTrans) { st.choferNombre = st.choferNombre || ''; }
        st.idTrans = String(x.id); st.transportista = x.razonSocial || ''; st.open = false; st.q = '';
        st.mRut = ''; st.mTel = ''; st.mEmail = '';
        draw();
      }));
      wirePicks();
      const q = panel.querySelector('[data-tq]');
      if (q) {
        q.addEventListener('input', () => { st.q = q.value; const l = panel.querySelector('[data-tlist]'); if (l) { l.innerHTML = listaHtml(); wirePicks(); } });
        q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const r = resultados(); if (r.length === 1) panel.querySelector('[data-tpick]')?.click(); } });
        if (st.open || !t) setTimeout(() => q.focus(), 0);
      }
      panel.querySelector('[data-tcambiar]')?.addEventListener('click', () => { st.open = true; draw(); });
      panel.querySelector('[data-sel="chof"]')?.addEventListener('change', e => {
        const x = chofList()[+e.target.value];
        if (x) { st.choferNombre = [x.nombre, x.apellido].filter(Boolean).join(' '); st.choferRut = x.rut || ''; st.choferTel = x.telefono || st.choferTel; if (x.id_camion) st.patCamion = x.id_camion; draw(); }
      });
      panel.querySelector('[data-ok]').addEventListener('click', async e => {
        if (faltantes().length) { st.err = true; draw(); return; }
        const tsel = sel();
        const pat = normPatente(st.patCamion), rut = normPatente(st.choferRut);
        const av = [];
        otros.forEach(o => {
          if (normPatente(o.patente_camion) === pat) av.push(`La patente ya está programada hoy en ${o.lbl}.`);
          else if (rut && normPatente(o.chofer_rut) === rut) av.push(`El chofer ya está programado hoy en ${o.lbl} (patente ${o.patente_camion}).`);
        });
        if (av.length && !(await confirmar(`Posible choque con el camión ${st.patCamion.trim().toUpperCase()}\n\n${av.map(a => '• ' + a).join('\n')}\n\n¿Programar igual?`, { aceptar: 'Programar igual', tono: 'peligro', icono: 'warning' }))) return;
        // Transportista bloqueado: se completan en el maestro los datos que faltaban.
        const fs = faltan(tsel);
        if (fs.length) {
          const upd = {};
          if (fs.includes('RUT')) upd.rut = st.mRut.trim().toUpperCase();
          if (fs.includes('teléfono')) upd.telefono = st.mTel.trim();
          if (fs.includes('correo')) upd.email = st.mEmail.trim().toLowerCase();
          e.currentTarget && (e.currentTarget.disabled = true);
          const { error } = await supabase.from('transports').update(upd).eq('id', tsel.id);
          if (error) { showAlert('No se pudo actualizar el maestro de transportistas: ' + error.message, 'error'); draw(); return; }
          Object.assign(tsel, upd);
          showAlert(`Maestro actualizado: ${tsel.razonSocial} queda activo.`, 'success');
        }
        fin({
          id_transporte: String(tsel.id).trim(), transportista: String(tsel.razonSocial || st.transportista).trim(),
          chofer_nombre: st.choferNombre.trim(), chofer_rut: st.choferRut.trim(), chofer_telefono: st.choferTel.trim(),
          patente_camion: st.patCamion.trim().toUpperCase(), patente_carro: st.patCarro.trim().toUpperCase() || null,
        });
      });
    }
    draw();
  });
}
// ── Crossdocking: coordinar pedidos de traslado como CD-CLIENTE (4-oct-2026) ──
async function loadCoordTraslados() {
  const { data, error } = await supabase.from('abast_traslado_coordinacion').select('*');
  if (error) { console.error(error); return new Map(); }
  return new Map((data || []).map(r => [String(r.doc_compr ?? '').trim(), r]));
}
async function anularCoordTraslados(docs) {
  const { error } = await supabase.from('abast_traslado_coordinacion').delete().in('doc_compr', docs.map(d => String(d).trim()));
  if (error) { showAlert('Error: ' + error.message, 'error'); return false; }
  await quitarSeguimientoCoord(docs);
  return true;
}
function showCoordTrasladoModal(row, ctx) {
  return new Promise(async resolve => {
    const c = row._coord || {};
    const editando = !!row._cdcli;
    let tr = { trans: [], choferes: [], camiones: [] };
    try { tr = await loadTransportistasCoord(); } catch (_) { /* */ }
    const rows = (ctx && ctx._rows) || [];
    // Pedidos (no líneas) del mismo destino, con su tonelaje total.
    const pedidos = new Map();
    rows.filter(x => String(x.ce).trim() === String(row.ce).trim()).forEach(x => {
      const k = String(x.doc_compr).trim();
      if (!pedidos.has(k)) pedidos.set(k, { doc: k, ton: 0, cliente: x._cliente || '', coord: x._coord, fe: x.fe_entrega });
      pedidos.get(k).ton += x._ton_num || 0;
    });
    const main = String(row.doc_compr).trim();
    const st = {
      fecha: c.fecha_entrega || (parseDateSAP(row.fe_entrega) ? isoLocal(parseDateSAP(row.fe_entrega)) : ''),
      entregas: new Map([[main, c.n_entrega || '']]),
      cliente: c.nombre_cliente || row._cliente || '', comuna: c.comuna || row._comuna || '', direccion: c.direccion || '', telefono: c.telefono || '',
      idTrans: c.id_transporte || '', transportista: c.transportista || '',
      choferNombre: c.chofer_nombre || '', choferRut: c.chofer_rut || '', choferTel: c.chofer_telefono || '',
      patCamion: c.patente_camion || '', patCarro: c.patente_carro || '', err: false,
    };
    // Al editar, se precargan los pedidos coordinados en el mismo camión (misma patente y fecha).
    if (editando && c.patente_camion) pedidos.forEach(p => {
      if (p.doc !== main && p.coord && p.coord.fecha_entrega === c.fecha_entrega && normPatente(p.coord.patente_camion) === normPatente(c.patente_camion)) st.entregas.set(p.doc, p.coord.n_entrega || '');
    });
    const wrap = document.createElement('div');
    wrap.id = 'coord-modal-bg';
    wrap.innerHTML = '<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(620px,100vw)" role="dialog" aria-label="Coordinar CD-Cliente"></aside>';
    document.body.appendChild(wrap);
    const panel = wrap.querySelector('aside');
    const fin = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sv-cf-bg') && !cerrarBuscadorAbierto(e)) { e.stopPropagation(); fin(false); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.sv-dr-bg').addEventListener('click', () => fin(false));
    // (5-oct-2026, Jordan) chofer, RUT, teléfono y patente pueden quedar pendientes
    const REQ = ['fecha', 'direccion', 'telefono', 'idTrans'];
    const faltantes = () => {
      const f = REQ.filter(k => !String(st[k]).trim());
      st.entregas.forEach((v, d) => { if (!String(v).trim()) f.push('ent_' + d); });
      return f;
    };
    const bad = k => st.err && faltantes().includes(k);
    const lbl = (t, k, req) => `<label class="sv-flbl" style="display:block;margin-bottom:6px;${bad(k) ? 'color:#b5000b' : ''}">${t}${req ? ' *' : ''}</label>`;
    const box = k => `width:100%;box-sizing:border-box;min-width:0;${bad(k) ? 'border-color:#b5000b' : ''}`;
    const inp = (k, ph, extra = '') => `<label class="sv-inp" style="${box(k)}"><input data-k="${k}" value="${escapeHtml(st[k])}" placeholder="${escapeHtml(ph || '')}" style="width:100%" ${extra}></label>`;
    const chofList = () => tr.choferes.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim());
    const camList = () => tr.camiones.filter(x => String(x.id_transporte ?? '').trim() === st.idTrans.trim() && String(x.id_camion ?? '').trim());
    const tonSel = () => [...st.entregas.keys()].reduce((s, d) => s + ((pedidos.get(d) || {}).ton || 0), 0);
    function draw() {
      const falt = st.err ? faltantes() : [];
      const ton = tonSel();
      const otros = [...pedidos.values()].filter(p => !st.entregas.has(p.doc));
      panel.innerHTML = `
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${editando ? 'Editar coordinación CD-Cliente' : 'Coordinar como CD-Cliente'}</div>
          <div class="sv-dr-t">${escapeHtml(main)}</div>
          <div class="sv-dr-s">CD Quilicura → ${escapeHtml(getNombreCentro(row.ce))} · camión directo a cliente</div></div>
          <button class="sv-iconbtn" data-cx title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-dr-b" style="gap:16px">
          ${falt.length ? '<div class="sv-note-box" style="background:#ffdad6;color:#93000a;font-weight:700">Completa los campos obligatorios marcados en rojo.</div>' : ''}
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div class="sv-b" style="font-size:14px">Pedidos de traslado en el camión</div>
              <span class="sv-pill ${ton > CAP_CAMION_DIRECTO + 1e-9 ? 'bad' : 'ok'}"><i></i>${fmtNum(ton, 1)} t de ${CAP_CAMION_DIRECTO} t</span></div>
            ${[...st.entregas.keys()].map(d => { const p = pedidos.get(d) || {}; return `<div style="display:grid;grid-template-columns:1fr 200px auto;gap:8px;align-items:end">
                <div><b class="sv-mono">${escapeHtml(d)}</b><div class="sv-sub" style="margin:0">${fmtNum(p.ton || 0, 1)} t${p.cliente ? ' · ' + escapeHtml(p.cliente) : ''}</div></div>
                <div>${lbl('N° de entrega', 'ent_' + d, true)}<label class="sv-inp" style="${box('ent_' + d)}"><input class="is-mono" data-ent="${escapeHtml(d)}" value="${escapeHtml(st.entregas.get(d))}" placeholder="N° entrega SAP" style="width:100%"></label></div>
                ${d === main ? '<span style="width:30px"></span>' : `<button class="sv-iconbtn" data-del="${escapeHtml(d)}" title="Quitar del camión"><span class="material-symbols-outlined">close</span></button>`}</div>`; }).join('')}
            ${otros.length ? `<div class="sv-sub" style="margin:4px 0 0;max-width:none">Agregar otros pedidos de ${escapeHtml(getNombreCentro(row.ce))}:</div>
              <div style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto">${otros.map(p => `<button class="sv-opt" data-add="${escapeHtml(p.doc)}" style="padding:6px 10px">
                <span class="material-symbols-outlined" style="color:#5c5f61">add_circle</span><span style="flex:1"><b class="sv-mono">${escapeHtml(p.doc)}</b> <span class="sv-sub" style="display:inline;margin:0">${escapeHtml(p.cliente || 'Stock')}</span></span>
                <span class="sv-sub" style="margin:0">${p.coord ? 'CD-Cliente · ' : ''}${fmtNum(p.ton, 1)} t</span></button>`).join('')}</div>` : ''}
          </div>
          <div style="max-width:240px">${lbl('Fecha de entrega', 'fecha', true)}
            <label class="sv-inp" style="${box('fecha')}"><span class="material-symbols-outlined">calendar_today</span><input type="date" data-k="fecha" value="${escapeHtml(st.fecha)}" style="width:140px"></label></div>
          <div class="sv-sub" style="margin-top:-10px;max-width:none">Entra al Plan de Carga cuyo día objetivo es esta fecha (se arma el día hábil anterior).</div>
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Datos del cliente</div>
            <div>${lbl('Cliente', 'cliente', false)}${inp('cliente', 'Nombre del cliente')}</div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
              <div>${lbl('Comuna', 'comuna', false)}${inp('comuna', '')}</div>
              <div>${lbl('Dirección', 'direccion', true)}${inp('direccion', 'Calle, número, obra')}</div></div>
            <div style="max-width:260px">${lbl('Teléfono de contacto', 'telefono', true)}${inp('telefono', '+56 9…')}</div>
          </div>
          <div class="sv-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div class="sv-b" style="font-size:14px">Datos del transporte</div>
            <div>${lbl('Transportista (ID y nombre)', 'idTrans', true)}
              <div data-bus="trans"></div></div>
            ${notaTranspBloq(tr.trans.find(t => String(t.id) === st.idTrans))}
            ${chofList().length ? `<div>${lbl('Chofer del transportista', 'chof', false)}
              <label class="sv-inp" style="${box('chof')}"><span class="material-symbols-outlined">badge</span>
                <select data-sel="chof" style="border:none;background:transparent;width:100%;font:inherit;outline:none">
                  <option value="">Elegir para autocompletar…</option>
                  ${chofList().map((x, i) => `<option value="${i}" ${x.rut === st.choferRut ? 'selected' : ''}>${escapeHtml([x.nombre, x.apellido].filter(Boolean).join(' '))} · ${escapeHtml(x.rut || '')}</option>`).join('')}
                </select></label></div>` : ''}
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
              <div>${lbl('Nombre chofer', 'choferNombre', false)}${inp('choferNombre', 'Pendiente')}</div>
              <div>${lbl('RUT chofer', 'choferRut', false)}${inp('choferRut', '12.345.678-9')}</div>
              <div>${lbl('Teléfono', 'choferTel', false)}${inp('choferTel', '+56 9…')}</div></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>${lbl('Patente camión', 'patCamion', false)}${inp('patCamion', 'Pendiente', 'list="dl-pat-tr" autocomplete="off"')}</div>
              <div>${lbl('Patente carro (opcional)', 'patCarro', false)}${inp('patCarro', 'Rampla / carro')}</div></div>
            ${notaPendTransp(st, 'el pedido')}
            <datalist id="dl-pat-tr">${camList().map(x => `<option value="${escapeHtml(x.id_camion)}"></option>`).join('')}</datalist>
          </div>
        </div>
        <div class="sv-dr-f"><span class="sv-dr-note">* Obligatorio</span>
          <div style="display:flex;gap:8px"><button class="sv-btn" data-cx>Cancelar</button>
          <button class="sv-btn-p" data-ok><span class="material-symbols-outlined">local_shipping</span>${editando ? 'Guardar cambios' : 'Coordinar CD-Cliente'}${st.entregas.size > 1 ? ` (${st.entregas.size} pedidos)` : ''}</button></div></div>`;
      panel.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => fin(false)));
      panel.querySelectorAll('[data-k]').forEach(i => i.addEventListener(i.type === 'date' ? 'change' : 'input', () => { st[i.dataset.k] = i.value; }));
      panel.querySelectorAll('[data-ent]').forEach(i => i.addEventListener('input', () => st.entregas.set(i.dataset.ent, i.value)));
      panel.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { const p = pedidos.get(b.dataset.add); st.entregas.set(b.dataset.add, (p && p.coord && p.coord.n_entrega) || ''); draw(); }));
      panel.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { st.entregas.delete(b.dataset.del); draw(); }));
      montarTransp(panel, st, tr, bad('idTrans'), draw);
      panel.querySelector('[data-sel="chof"]')?.addEventListener('change', e => {
        const x = chofList()[+e.target.value];
        if (x) { st.choferNombre = [x.nombre, x.apellido].filter(Boolean).join(' '); st.choferRut = x.rut || ''; st.choferTel = x.telefono || st.choferTel; if (x.id_camion) st.patCamion = x.id_camion; draw(); }
      });
      panel.querySelector('[data-ok]').addEventListener('click', async e => {
        if (faltantes().length) { st.err = true; draw(); return; }
        const btn = e.currentTarget; btn.disabled = true;
        // Aviso de choque: misma patente o mismo chofer en otra coordinación (ventas o crossdocking).
        const pat = normPatente(st.patCamion), rut = normPatente(st.choferRut), av = [];
        let ventas = []; try { ventas = [...(await loadCoordinacionesVenta()).values()]; } catch (_) { /* */ }
        const otrosTr = [...(await loadCoordTraslados()).values()].filter(x => !st.entregas.has(String(x.doc_compr).trim()));
        ventas.map(x => ({ doc: 'NV ' + x.doc_ventas, ...x })).concat(otrosTr.map(x => ({ doc: 'Traslado ' + x.doc_compr, ...x }))).forEach(o => {
          if (!o.patente_camion || (!pat && !rut)) return;
          const mismaPat = normPatente(o.patente_camion) === pat;
          if (mismaPat && o.fecha_entrega === st.fecha && String(o.id_transporte ?? '').trim() !== st.idTrans.trim()) av.push(`${o.doc} usa esta patente el ${fmtFechaISO(o.fecha_entrega)} con otro transporte.`);
          else if (mismaPat && o.fecha_entrega === st.fecha && normPatente(o.chofer_rut) !== rut) av.push(`${o.doc} usa esta patente el ${fmtFechaISO(o.fecha_entrega)} con otro chofer.`);
          else if (!mismaPat && rut && o.fecha_entrega === st.fecha && normPatente(o.chofer_rut) === rut) av.push(`El chofer ya está coordinado el ${fmtFechaISO(o.fecha_entrega)} en otra patente (${o.patente_camion}, ${o.doc}).`);
        });
        if (tonSel() > CAP_CAMION_DIRECTO + 1e-9) av.push(`Los pedidos suman ${fmtNum(tonSel(), 1)} t (supera ${CAP_CAMION_DIRECTO} t).`);
        if (av.length && !(await confirmar(`Posible choque con el camión ${st.patCamion.trim().toUpperCase()}\n\n${av.map(a => '• ' + a).join('\n')}\n\n¿Guardar igual?`, { aceptar: 'Guardar igual', tono: 'peligro', icono: 'warning' }))) { btn.disabled = false; return; }
        const email = await getUserEmail(), now = new Date().toISOString();
        const filas = [...st.entregas.entries()].map(([d, ent]) => ({
          doc_compr: d, ce: String(row.ce).trim(), tipo_entrega: 'CD-CLIENTE', fecha_entrega: st.fecha, n_entrega: String(ent).trim(),
          nombre_cliente: st.cliente.trim().toUpperCase() || null, comuna: st.comuna.trim() || null, direccion: st.direccion.trim(), telefono: st.telefono.trim(),
          id_transporte: st.idTrans.trim(), transportista: st.transportista || null,
          chofer_nombre: st.choferNombre.trim() || null, chofer_rut: st.choferRut.trim() || null, chofer_telefono: st.choferTel.trim() || null,
          patente_camion: st.patCamion.trim().toUpperCase() || null, patente_carro: st.patCarro.trim().toUpperCase() || null,
          updated_at: now, updated_by: email, ...((pedidos.get(d) || {}).coord ? {} : { created_at: now, created_by: email }),
        }));
        const { error } = await supabase.from('abast_traslado_coordinacion').upsert(filas, { onConflict: 'doc_compr' });
        if (error) { showAlert('Error al coordinar: ' + error.message, 'error'); btn.disabled = false; return; }
        await registrarSeguimientoCoord(filas.map(f => ({ doc: f.doc_compr, tipo: 'CD-CLIENTE', ce: f.ce, fechaCarga: f.fecha_entrega, origen: '1003 CD Quilicura',
          destino: `Cliente: ${f.nombre_cliente || ('Traslado ' + f.doc_compr)}`, transp: f,
          lineas: rows.filter(x => String(x.doc_compr).trim() === f.doc_compr).map(x => lineaSegCoord({ tipo_carga: 'Crossdocking', documento: f.doc_compr, n_entrega: f.n_entrega,
            material: x.material, nombre: x.texto_breve, cantidad: parseNum(x.ctd_pedido) - parseNum(x.ctd_entregada), ton: x._ton_num, cliente: f.nombre_cliente || x._cliente || '' })) })));
        showAlert(`${filas.length > 1 ? filas.length + ' pedidos coordinados' : 'Pedido ' + main + ' coordinado'} como CD-Cliente (${filas[0].patente_camion || 'chofer/patente pendiente'}).`, 'success');
        fin(true);
      });
    }
    draw();
  });
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
    // Excluye la Orden de Compra completa del Plan de Carga (sólo OWNER).
    excluir: { tipo: 'retiro_fabrica', doc: r => r.doc_compr, material: null },
    chipFilter: { campo: 'ce', label: 'Centro' },
    extraChips: [
      { campo: '_tipo_retiro', label: 'Tipo Retiro' },
      { campo: '_estado_lbl', label: 'Coordinación' },
      { campo: '_alerta', label: 'Alerta' },
    ],
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'Buscar Orden de Compra', tipo: 'buscar' }, { campo: 'nombre_1', label: 'Buscar por Nombre de Proveedor', tipo: 'buscar' }],
    dateRange: { campo: 'fe_entrega', label: 'Rango Fecha de Entrega' },
    async preload() {
      const estados = await loadEstadosRetiro();
      // fetchAllRows pagina en paralelo (PostgREST capea a 1000 por defecto,
      // .limit(5000) no basta para una vista de 2853+ filas)
      const pvRows = await fetchAllRows('v_trc_pedidos_ventas_ref');
      const pvMap = {};
      pvRows.forEach(r => {
        const k = String(r.doc_ventas ?? '').trim();
        if (k && !pvMap[k]) pvMap[k] = r;
      });
      return { estados, pvMap };
    },
    editable: {
      key: '_estado', options: ESTADO_OPTS,
      async onChange(row, val, ctx) {
        let tipoRetiro = null, entregaEntrante = null, result = null;
        if (val === 'coordinado') {
          result = await showCoordModal(row);
          if (!result) return false;
          tipoRetiro = result.tipoRetiro;
          entregaEntrante = result.entregaEntrante || '';
        }
        // Si no se coordinó (o se revierte), limpiar campos de fábrica en DB
        const extraFab = result ? {
          tipo_local_rm: result.tipoLocalRM, fab_direccion: result.fabDir,
          fab_comuna: result.fabCom, fab_contacto: result.fabCont, fab_telefono: result.fabTel,
          fecha_retiro: result.fechaRetiro,
        } : { tipo_local_rm: null, fab_direccion: null, fab_comuna: null, fab_contacto: null, fab_telefono: null, fecha_retiro: null, _clear_retiro: true };
        const ok = await saveEstadoRetiro(row.doc_compr, val, tipoRetiro, entregaEntrante, extraFab);
        if (ok) {
          const oc = String(row.doc_compr);
          ctx.estados[oc] = { ...(ctx.estados[oc] || {}), estado: val };
          if (tipoRetiro !== null) { ctx.estados[oc].tipo_retiro = tipoRetiro; row._tipo_retiro = tipoRetiro; }
          if (entregaEntrante !== null) { ctx.estados[oc].entrega_entrante = entregaEntrante; row._entrega_entrante = entregaEntrante; }
          if (extraFab) {
            ctx.estados[oc].tipo_local_rm  = extraFab.tipo_local_rm;
            ctx.estados[oc].fab_direccion  = extraFab.fab_direccion;
            ctx.estados[oc].fab_comuna     = extraFab.fab_comuna;
            ctx.estados[oc].fab_contacto   = extraFab.fab_contacto;
            ctx.estados[oc].fab_telefono   = extraFab.fab_telefono;
            ctx.estados[oc].fecha_retiro   = extraFab.fecha_retiro;
            row._tipo_local_rm  = extraFab.tipo_local_rm || '';
            row._fab_direccion  = extraFab.fab_direccion || '';
            row._fab_comuna     = extraFab.fab_comuna    || '';
            row._fab_contacto   = extraFab.fab_contacto  || '';
            row._fab_telefono   = extraFab.fab_telefono  || '';
            row._fecha_retiro   = extraFab.fecha_retiro  || '';
            // Al revertir: limpiar también tipo_retiro y entrega_entrante en memoria
            if (extraFab._clear_retiro) {
              ctx.estados[oc].tipo_retiro      = null;
              ctx.estados[oc].entrega_entrante = '';
              row._entrega_entrante = '';
              // Recalcular _tipo_retiro desde alm (revertir override de coordinación)
              const almV = String(row.alm ?? '').trim();
              row._tipo_retiro = almV === '4000' ? 'FAB-CD' : 'FAB-SUC';
            }
          }
          showAlert('Estado actualizado', 'success');
        }
        return ok;
      },
    },
    expand: {
      key: 'doc_compr', idKey: 'doc_compr', numCols: 3,
      headers: ['Orden de Compra','Contrato de Compra','Centro Destino','Nombre Cliente','Nombre Vendedor','Centro Expedición','Ruta','Tipo Retiro','Entrega Entrante','ID Material','Nombre Material','Cantidad Pedido','Cantidad Pendiente','Ton SKU'],
      build(row) {
        return (row._detalle || []).map(d => [
          d.doc_compr, row.contr, d.ce, row._pv_nombre_cliente, row._pv_nombre_vendedor, row._pv_ce_expedicion, row._pv_ruta, row._tipo_retiro, row._entrega_entrante, d.material, d.texto_breve, fmtNum(d.pedido, 1), fmtNum(d.pendiente, 1), fmtNum(d.ton, 4),
        ]);
      },
    },
    transform(rows, ctx) {
      const estados = (ctx && ctx.estados) || {};
      const pvMap = (ctx && ctx.pvMap) || {};
      const validas = rows
        .filter(r => !String(r.proveedor ?? '').startsWith('*'))
        .filter(r => String(r.doc_compr ?? '').trim() !== ''); // contr (Contrato de Compra) es opcional, no filtrar por eso
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
        let ton = 0, tonRet = 0, pendienteTotal = 0, pedidoTotal = 0, revSaldo = false;
        const est0 = estados[oc] || {}, coord0 = !!modoRetiro(est0);
        const detalle = items.map(r => {
          const ctdP = parseNum(r.ctd_pedido), ctdE = parseNum(r.ctd_entregada);
          const pend = ctdP - ctdE;
          const pesoU = maxPesoDim(r.peso_bruto, r.tamano_dimens);
          const t = calcTon(pesoU, pend);
          // (7-oct-2026) Cantidad a retirar según los productos elegidos al coordinar.
          const ret = coord0 ? cantRetiroLinea(est0, r.material, pend) : pend;
          const tRet = calcTon(pesoU, ret);
          ton += t; tonRet += tRet; pendienteTotal += pend; pedidoTotal += ctdP;
          if (ctdE > 0 && ctdE < ctdP) revSaldo = true;
          return { doc_compr: oc, ce: r.ce, material: r.material, texto_breve: r.texto_breve, pedido: ctdP, pendiente: pend, ton: t, pesoU, retiro: ret, ton_ret: tRet };
        });
        // (3-oct-2026, Jordan) Tipo de pedido: OC con pedido de venta = CALZADA, sin pedido = STOCK.
        // Tipo de retiro automático: OC ≥ 85% de un camión de 28 t (23,8 t) → STOCK: FAB-SUC,
        // CALZADA: FAB-CLTE; bajo 23,8 t → FAB-CD. El tipo definido al coordinar manda.
        const tienePedidoVenta = String(f.documento ?? '').trim() !== '';
        const tipoPedido = tienePedidoVenta ? 'CALZADA' : 'STOCK';
        const tipoAuto = ton >= CAP_CAMION_DIRECTO * UMBRAL_FABRICA - 1e-9 ? (tienePedidoVenta ? 'FAB-CLTE' : 'FAB-SUC') : 'FAB-CD';
        let tipoRetiro = tipoAuto;
        const al = alertaFecha(f.fe_entrega, 5);
        const estObj = estados[oc] || {};
        const est = estObj.estado || 'no_coordinado';
        const modo = modoRetiro(estObj);
        if (modo && estObj.tipo_retiro) tipoRetiro = estObj.tipo_retiro;
        // Cross-reference con pedidos_ventas_dt
        const docPV = String(f.documento ?? '').trim();
        const pv = pvMap[docPV] || {};
        out.push({
          doc_compr: oc, contr: f.contr, proveedor: f.proveedor, nombre_1: f.nombre_1,
          ce: f.ce, _desc_centro: getNombreCentro(f.ce), alm: f.alm, documento: f.documento,
          fe_entrega: f.fe_entrega,
          _tipo_retiro: tipoRetiro, _tipo_auto: tipoAuto, _tipo_pedido: tipoPedido, _modo: modo,
          _tipo_origen: modo && estObj.tipo_retiro ? 'COORDINACION' : 'REGLA',
          _transp: estObj,
          _cliente: tipoRetiro === 'FAB-CLTE',
          _consolidar: tipoRetiro === 'FAB-CD',
          _ton_num: ton, _ton_totales: fmtNum(ton, 4),
          _ton_ret: tonRet, _parcial: coord0 && !!est0.lineas_retiro, _lineas_retiro: est0.lineas_retiro || null,
          _pendiente_total: pendienteTotal, _pedido_total: pedidoTotal,
          _vigencia: revSaldo ? 'REVISIÓN SALDO PEDIDO' : '',
          _revision_saldo: revSaldo,
          _alerta: al.txt, _alerta_cls: al.cls,
          _estado: est, _estado_lbl: (ESTADO_OPTS.find(o => o.v === est) || {}).l || 'No coordinado',
          _entrega_entrante: estObj.entrega_entrante || '',
          _tipo_local_rm: estObj.tipo_local_rm || '',
          _fab_direccion:  estObj.fab_direccion  || '',
          _fab_comuna:     estObj.fab_comuna     || '',
          _fab_contacto:   estObj.fab_contacto   || '',
          _fab_telefono:   estObj.fab_telefono   || '',
          _fecha_retiro:   estObj.fecha_retiro    || '',
          _upd_at: estObj.updated_at || '', _upd_by: estObj.updated_by || '',
          _detalle: detalle,
          // Datos cruzados de Pedidos de Ventas
          _pv_denominacion: pv.denominacion || '',
          _pv_nombre_cliente: pv.nombre_1 || '',
          _pv_nombre_vendedor: pv.nombre || '',
          _pv_ce_expedicion: pv.psex || '',
          _pv_ruta: pv.ruta || '',
          // Comuna asociada a la ruta del Pedido de Ventas, según maestro de rutas
          _pv_comuna: lookupRuta(pv.ruta).comuna || '',
          // (3-oct-2026) Expedición errónea: OC calzada cuyo pedido de venta no es
          // EBE-RET / EBE-DESP ni EBE-RET / CLI-RET.
          _exp_error: tienePedidoVenta && !!pv.denominacion && !EXPEDICIONES_OK_RETIRO.has(normCond(pv.denominacion)),
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
      { key: 'doc_compr', label: 'Orden de Compra', expandable: true },
      { key: 'nombre_1', label: 'Nombre de Proveedor' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'fe_entrega', label: 'Fecha Entrega SAP', cls: 'num-clear' },
      { key: '_fecha_retiro', label: 'Fecha de Retiro', cls: 'num-clear',
        valueFn: r => r._fecha_retiro ? fmtFechaISO(r._fecha_retiro) : '',
        clsFn: r => r._estado === 'coordinado' && !r._fecha_retiro ? 'num-clear text-error font-bold' : 'num-clear' },
      { key: '_ton_totales', label: 'Ton Totales', cls: 'text-right num-clear font-bold' },
      { key: 'documento', label: 'Pedido de Ventas' },
      { key: '_pv_denominacion', label: 'Tipo Expedición' },
      { key: '_vigencia', label: 'Vigencia OC', rawHtml: true,
        valueFn: r => r._revision_saldo ? '<span class="material-symbols-outlined text-[16px] text-red-700" title="Revisión Saldo Pedido">warning</span>' : '',
        clsFn: () => 'text-center' },
      { key: '_alerta', label: 'Alerta', rawHtml: true,
        valueFn: r => {
          if (r._alerta === 'PEDIDO ATRASADO') return '<span class="inline-block w-3 h-3 rounded-full bg-red-600" title="Pedido Atrasado"></span>';
          if (r._alerta === 'PRONTO A VENCER') return '<span class="inline-block w-3 h-3 rounded-full bg-[#e65100]" title="Pronto a Vencer"></span>';
          if (r.fe_entrega) return '<span class="inline-block w-3 h-3 rounded-full bg-green-500" title="Vigente"></span>';
          return '';
        },
        clsFn: () => 'text-center' },
      { key: '_entrega_entrante', label: 'Entrega Entrante' },
      { key: '_estado', label: 'Coordinación', editable: true },
    ],
  },

  // ── PEDIDOS DE VENTA CD (1003) — agrupado por pedido ──────────────────────
  pedidos_venta: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE VENTA CD (1003)',
    vista: 'v_trc_sqvi_pedidos_venta_1003',
    // Excluye el Pedido de Venta completo (todas sus líneas), sólo perfil OWNER.
    excluir: { tipo: 'venta_1003', doc: r => r.doc_ventas, material: null },
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
          doc_ventas: doc, ofvta: f.ofvta, creado_el: f.creado_el, deudor: f.deudor, solicitante: f.solicitante,
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
    // (2-oct-2026) Tipo de entrega CONSOLIDABLE / CD-CLIENTE por cliente — ver clasificarTipoEntregaNV.
    postFilter(filas, _chip, ctx) { return clasificarTipoEntregaNV(filas, ctx || {}); },
    rowClsFn(r) { return r._directo ? 'bg-green-50' : ''; },
    columnas: [
      { key: '_tipo_entrega', label: 'Tipo de Entrega', clsFn: r => r._directo ? 'text-green-800 font-bold' : 'text-blue-700 font-bold' },
      { key: 'ofvta', label: 'Oficina de Ventas' },
      { key: 'creado_el', label: 'Fecha de Creación' },
      { key: 'deudor', label: 'ID Vendedor' },
      { key: 'solicitante', label: 'ID Cliente' },
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
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE TRASLADOS',
    vista: 'v_trc_sqvi_pedidos_traslados',
    // Excluye la línea (doc_compr + material), sólo perfil OWNER.
    excluir: { tipo: 'traslados_1003', doc: r => r.doc_compr, material: r => r.material },
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    extraChips: [{ campo: 'cesu', label: 'Centro Origen' }],
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'Buscar Pedido de Traslado', tipo: 'buscar' }],
    dateRange: { campo: 'fecha_confirmada', label: 'Rango Fecha de Entrega' },
    async preload() {
      const stockRows = await fetchAllRows('v_trc_slim_stock');
      // Mapa SLIM: "centro|codigo_articulo" → { sd, abc } (se conserva el de
      // menor stock_days si el SKU/centro aparece más de una vez).
      const skuMap = {};
      stockRows.forEach(r => {
        const k = `${String(r.centro ?? '').trim()}|${String(r.codigo_articulo ?? '').trim()}`;
        const sd = parseNum(r.stock_days);
        const abc = String(r.clase_abc ?? '').trim().toUpperCase();
        const prev = skuMap[k];
        if (!prev || sd < prev.sd) skuMap[k] = { sd, abc };
      });
      return { skuMap };
    },
    transform(rows, ctx) {
      const skuMap = (ctx && ctx.skuMap) || {};
      const validas = rows
        .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
        .filter(r => !String(r.material ?? '').startsWith('900000'));
      function alertaIconHtml(al) {
        if (!al.txt) return '<span class="material-symbols-outlined text-green-600 text-[16px] align-middle" title="OK">check_circle</span>';
        if (al.txt === 'PEDIDO ATRASADO')
          return '<span class="material-symbols-outlined text-error text-[16px] align-middle">cancel</span> <span class="text-error font-bold text-[11px]">ATRASADO</span>';
        return '<span class="material-symbols-outlined text-[#e65100] text-[16px] align-middle">warning</span> <span class="text-[#e65100] font-bold text-[11px]">PRONTO A VENCER</span>';
      }
      function quiebreBadgeHtml(q) {
        if (!q) return '';
        const short = q.tq.txt === 'MATERIAL QUEBRADO URGENTE' ? 'QUIEBRE'
                    : q.tq.txt === 'STOCK CRÍTICO URGENTE'     ? 'CRÍTICO'
                    : 'EN REVISIÓN';
        return `<span class="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-full text-[11px] font-bold ${q.tq.cls}">` +
               `<span class="material-symbols-outlined text-[13px]">inventory_2</span>${short} (${q.sd}d)</span>`;
      }
      // Badge del grupo de priorización de carga (B/C/D/E, ver prioridadTraslado).
      function prioridadBadgeHtml(prio) {
        const MAP = {
          B: { txt: 'PRIORIZADO · USUARIO', cls: 'text-white bg-purple-700' },
          C: { txt: 'PRIORIZADO · ABC AA',  cls: 'text-white bg-indigo-700' },
          D: { txt: 'QUIEBRE',              cls: 'text-white bg-red-600' },
          E: { txt: 'ABASTECIMIENTO',       cls: 'text-black bg-gray-300' },
        };
        const m = MAP[prio.grupo] || MAP.E;
        return `<span class="inline-flex items-center px-[6px] py-[2px] rounded-full text-[11px] font-bold ${m.cls}">${m.txt}</span>`;
      }
      const out = validas.map(r => {
        const al = alertaFecha(r.fecha_confirmada, 7);
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
        const kq = `${String(r.ce ?? '').trim()}|${String(r.material ?? '').trim()}`;
        const info = skuMap[kq] || null;
        const quebrado = !!(info && info.sd <= 7);
        const q = quebrado ? { sd: info.sd, tq: tipoQuiebre(info.sd) } : null;
        const abc = info ? info.abc : '';
        const usuario = String(r.creado_por ?? '').trim();
        const prio = prioridadTraslado(usuario, abc, quebrado);
        return {
          doc_compr: String(r.doc_compr ?? '').trim(),
          cesu: r.cesu, ce: r.ce, alm: r.alm, pos: r.pos, creado_el: r.creado_el,
          _sd: info ? info.sd : null, _ton_num: t, _motivo_prio: prio.motivo,
          material: r.material, texto_breve: r.texto_breve,
          fecha_confirmada: r.fecha_confirmada,
          ctd_pedido: r.ctd_pedido, ctd_confirmada: r.ctd_confirmada,
          _ton_sku: fmtNum(t, 4),
          documento: r.documento,
          _alerta: al.txt, _alerta_cls: al.cls,
          _alerta_icon: alertaIconHtml(al),
          _quiebre_badge: quiebreBadgeHtml(q),
          _en_quiebre: !!q,
          _clasificacion_abc: abc || 'SIN CLASIFICACIÓN',
          _usuario: usuario || '—',
          _prioridad_badge: prioridadBadgeHtml(prio),
          _prioridad_grupo: prio.grupo,
          _prioridad_bucket: prio.bucket,
          _prioridad_orden: prio.orden,
        };
      });
      // Orden = el mismo criterio de priorización de carga del Plan de Carga:
      // bucket 'prioridad' (B/C/D) antes que 'abastecimiento' (E); dentro de
      // cada bucket, por 'orden' (usuario > ABC AA > resto de clasificación);
      // por último, fecha confirmada más próxima primero.
      return out.sort((a, b) => {
        if (a._prioridad_bucket !== b._prioridad_bucket) return a._prioridad_bucket === 'prioridad' ? -1 : 1;
        if (a._prioridad_orden !== b._prioridad_orden) return a._prioridad_orden - b._prioridad_orden;
        const da = parseDateSAP(a.fecha_confirmada), db2 = parseDateSAP(b.fecha_confirmada);
        return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
      });
    },
    rowClsFn(r) { return r._en_quiebre ? 'bg-red-50' : ''; },
    columnas: [
      { key: '_alerta_icon', label: 'Alerta', rawHtml: true },
      { key: '_prioridad_badge', label: 'Prioridad Plan Carga', rawHtml: true },
      { key: '_quiebre_badge', label: 'Estado Quiebre', rawHtml: true },
      { key: 'doc_compr', label: 'Pedido de Traslado' },
      { key: 'cesu', label: 'Centro Origen' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'material', label: 'ID Material' },
      { key: 'texto_breve', label: 'Nombre Material' },
      { key: '_clasificacion_abc', label: 'Clasificación ABC', cls: 'text-center' },
      { key: '_usuario', label: 'Usuario' },
      { key: 'fecha_confirmada', label: 'Fecha de Entrega', cls: 'num-clear' },
      { key: 'ctd_pedido', label: 'Cantidad Pedido', cls: 'text-right num-clear' },
      { key: '_ton_sku', label: 'Total SKU', cls: 'text-right num-clear font-bold' },
      { key: 'documento', label: 'Pedido de Ventas' },
    ],
  },

  // ── PEDIDOS DE TRASLADO REVEX (material 900000) ───────────────────────────
  pedidos_traslados_revex: {
    titulo: 'Revex',
    vista: 'v_trc_sqvi_pedidos_traslados',
    // Excluye la línea (doc_compr + material), sólo perfil OWNER.
    excluir: { tipo: 'traslados_revex', doc: r => r.doc_compr, material: r => r.material },
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'BUSCAR PEDIDO DE TRASLADO', tipo: 'buscar' }],
    dateRange: { campo: 'fecha_confirmada', label: 'Rango Fecha Confirmada' },
    transform(rows) {
      return rows
        .filter(r => String(r.material ?? '').trim().startsWith('900000'))
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

  // ── PEDIDOS DE TRASLADOS 4000 (Step 5) — agrupado por PT ──────────────────
  pedidos_traslados_4000: {
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE TRASLADOS 4000',
    vista: 'v_trc_sqvi_pedidos_traslados_4000',
    // Excluye la línea (doc_compr + material), sólo perfil OWNER. Mismo tipo
    // ('crossdock_4000') que usa el detalle del Plan de Carga, así que excluir
    // acá también lo saca del Plan de Carga automáticamente.
    excluir: { tipo: 'crossdock_4000', doc: r => r.doc_compr, material: r => r.material },
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    extraChips: [{ campo: '_origen', label: 'Origen' }],
    noBuscar: true,
    filtros: [{ campo: 'doc_compr', label: 'Buscar Pedido de Traslado', tipo: 'buscar' }],
    dateRange: { campo: 'fe_entrega', label: 'Rango Fecha de Entrega' },
    async preload() {
      const pvRows = await fetchAllRows('v_trc_pedidos_ventas_ref');
      const pvMap = {};
      pvRows.forEach(r => {
        const k = String(r.doc_ventas ?? '').trim();
        if (k && !pvMap[k]) pvMap[k] = r;
      });
      return { pvMap };
    },
    transform(rows, ctx) {
      const pvMap = (ctx && ctx.pvMap) || {};
      // Deduplicar por doc_compr|pos, preferir fecha válida sobre '00.00.0000'
      const esValida = fe => fe && String(fe).trim() !== '' && String(fe).trim() !== '00.00.0000';
      const _dedupMap = new Map();
      rows.forEach(r => {
        const dc = String(r.doc_compr ?? '').trim();
        const pos = String(r.pos ?? '').trim();
        if (!dc || !String(r.material ?? '').trim()) return;
        const k = `${dc}|${pos}`;
        const ex = _dedupMap.get(k);
        if (!ex || (!esValida(ex.fe_entrega) && esValida(r.fe_entrega))) _dedupMap.set(k, r);
      });
      // (AJUSTE 24-sep-2026, pedido Jordan) Pendiente = ctd_pedido - ctd_entregada.
      // Cuando ctd_entregada == ctd_pedido, SAP ya generó la entrega (aunque la
      // salida física — cantidad_salida — todavía no se registre) y el pedido
      // deja de considerarse pendiente.
      const validas = Array.from(_dedupMap.values())
        .filter(r => String(r.cesu ?? '').trim() !== '' && !String(r.cesu ?? '').startsWith('*'))
        .filter(r => String(r.material ?? '').trim() !== '')
        .filter(r => parseNum(r.ctd_pedido) > parseNum(r.ctd_entregada));
      const out = validas.map(r => {
        const pend = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada);
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        const origen = String(r.documento ?? '').trim() ? 'PEDIDO DE VENTAS' : 'STOCK';
        const docPV = String(r.documento ?? '').trim();
        const pv = pvMap[docPV] || {};
        return {
          doc_compr: String(r.doc_compr ?? '').trim(),
          _pos: String(r.pos ?? '').trim(),
          cesu: r.cesu, ce: r.ce, alm: r.alm,
          fe_entrega: r.fe_entrega,
          material: r.material,
          texto_breve: r.texto_breve,
          _ctd_pend: fmtNum(pend, 1),
          _ton_sku: fmtNum(t, 4),
          documento: r.documento,
          _origen: origen,
          _ton_num: t,
          // (FIX) Tipo de Expedición es pv.denominacion (ej. FAB-DESP, CLI-RET);
          // pv.psex es el código de Centro de Expedición, antes mostrado por error acá.
          _tipo_exp: pv.denominacion || '',
          _centro_exp: pv.psex || '',
          _ruta: pv.ruta || '',
          _comuna: lookupRuta(pv.ruta).comuna || '',
          _vendedor: pv.nombre || '',
          _cliente: pv.nombre_1 || '',
        };
      });
      return out.sort((a, b) => {
        const da = parseDateSAP(a.fe_entrega), db2 = parseDateSAP(b.fe_entrega);
        return (da || new Date(9999,0)) - (db2 || new Date(9999,0));
      });
    },
    columnas: [
      { key: '_origen', label: 'Origen', clsFn: r => r._origen === 'PEDIDO DE VENTAS' ? 'text-blue-700 font-bold' : 'text-green-700 font-bold' },
      { key: 'doc_compr', label: 'Pedido de Traslado' },
      { key: 'ce', label: 'Centro Destino' },
      { key: 'alm', label: 'Almacén Destino' },
      { key: 'fe_entrega', label: 'Fecha de Entrega', cls: 'num-clear' },
      { key: 'material', label: 'ID Material' },
      { key: 'texto_breve', label: 'Nombre Material' },
      { key: '_ctd_pend', label: 'Cant. Pendiente', cls: 'text-right num-clear' },
      { key: '_ton_sku', label: 'Ton SKU', cls: 'text-right num-clear' },
      { key: 'documento', label: 'Pedido de Ventas' },
      { key: '_tipo_exp', label: 'Tipo de Expedición' },
      { key: '_centro_exp', label: 'Centro Expedición' },
      { key: '_ruta', label: 'ID Ruta' },
      { key: '_comuna', label: 'Comuna' },
      { key: '_vendedor', label: 'Nombre de Vendedor' },
    ],
  },

  // ── DOCUMENTOS DE TRANSPORTE (rediseño 24-sep-2026) ───────────────────────
  // Acumulado por día en abast_dt_dia (lecturas 08:10 / 16:30 / cierre 23:00).
  // Por defecto muestra sólo los DT creados HOY. Capacidad = columna GeEs (ton).
  documentos_transporte: {
    titulo: 'GESTIÓN TRONCALES – DOCUMENTOS DE TRANSPORTE',
    vista: 'v_abast_dt_dia',
    chipFilter: { campo: 'ptrp', label: 'Centro Expedición' },
    extraChips: [{ campo: 'denominacion', label: 'Tipo Despacho' }],
    searchLabel: 'BUSCADOR GENERAL',
    filtros: [],
    dateRange: { campo: 'fecha_creacion', label: 'Fecha Creación' },
    dateDefaultHoy: true,
    expand: {
      key: 'transporte', idKey: 'transporte', numCols: 2,
      headers: ['Entrega','Sucursal Destino','Material','Descripción','Cantidad','UM','Ton (máx bruto/vol)'],
      build(row) {
        return (row._detalle || []).map(d => [
          d.entrega, d.sucursal_destino, d.material, d.descripcion, d.cantidad, d.um,
          d.sin_peso ? 'sin peso' : fmtNum(d.ton_linea, 3),
        ]);
      },
    },
    transform(rows) {
      const g = new Map();
      rows.forEach(r => {
        const t = String(r.transporte ?? '').trim();
        if (!t) return;
        (g.get(t) || g.set(t, []).get(t)).push(r);
      });
      const out = [];
      for (const [trp, items] of g.entries()) {
        const f = items[0];
        const cap = Math.max(0, ...items.map(i => Number(i.capacidad_ton) || 0));
        const ton = items.reduce((s, i) => s + (Number(i.ton_linea) || 0), 0);
        const sucs = [...new Set(items.map(i => i.sucursal_destino).filter(Boolean))];
        out.push({
          transporte: trp,
          denominacion: f.denominacion,
          ptrp: f.ptrp,
          nombre_transportista: f.nombre_transportista,
          fecha_creacion: f.fecha_creacion,
          ruta: f.ruta,
          sucursal_destino: sucs.length === 1 ? sucs[0] : sucs.join(' / '),
          _num_entregas: new Set(items.map(i => i.entrega)).size,
          _capacidad: cap || '',
          _ton: fmtNum(ton, 2),
          _pct: cap > 0 ? Math.min(100, ton / cap * 100).toFixed(1) + '%' : '',
          _detalle: items,
        });
      }
      return out.sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)) || String(a.transporte).localeCompare(String(b.transporte)));
    },
    columnas: [
      { key: 'transporte', label: 'Doc. Transporte', expandable: true },
      { key: 'denominacion', label: 'Tipo Despacho' },
      { key: 'ptrp', label: 'Centro Exp.' },
      { key: 'nombre_transportista', label: 'Transportista' },
      { key: 'fecha_creacion', label: 'Fecha Creación', cls: 'num-clear' },
      { key: 'ruta', label: 'Ruta' },
      { key: 'sucursal_destino', label: 'Sucursal Destino' },
      { key: '_num_entregas', label: 'Entregas', cls: 'text-center font-bold' },
      { key: '_capacidad', label: 'Capacidad (t)', cls: 'text-right' },
      { key: '_ton', label: 'Ton Cargadas', cls: 'text-right' },
      { key: '_pct', label: '% Consolidación', cls: 'text-right font-bold' },
    ],
  },

  // ── ENTREGAS CREADAS (rediseño 24-sep-2026) ───────────────────────────────
  // Acumulado por día en abast_entregas_dia (cierre 23:00). Almacén vacío se
  // infiere (EL→4000; ClVt ZV01/03/04→2000; resto→3000). Almacén 4000 está
  // físicamente en 1003 → Centro Expedición = 1003. Estado Plan compara la
  // suma de entregas por Doc.Modelo+Material vs la foto del Plan de Carga (15:30
  // del día hábil anterior).
  entregas_creadas: {
    titulo: 'GESTIÓN TRONCALES – ENTREGAS CREADAS',
    vista: 'v_abast_entregas_dia',
    chipFilter: { campo: 'centro_fisico', label: 'Centro Expedición' },
    extraChips: [{ campo: 'almacen', label: 'Almacén' }, { campo: 'clent', label: 'Tipo Entrega' }, { campo: 'estado_plan', label: 'Estado Plan' }],
    searchLabel: 'BUSCADOR GENERAL',
    filtros: [],
    dateRange: { campo: 'fecha_creacion', label: 'Fecha Creación' },
    dateDefaultHoy: true,
    columnas: [
      { key: 'entrega', label: 'N° Entrega' },
      { key: 'fecha_creacion', label: 'Fecha Creación', cls: 'num-clear' },
      { key: 'clent', label: 'Tipo Entrega' },
      { key: 'ce', label: 'Tipo Exp.' },
      { key: 'almacen', label: 'Almacén', valueFn: r => r.almacen + (r.almacen_inferido ? '*' : '') },
      { key: 'centro_fisico', label: 'Centro Exp.' },
      { key: 'ruta', label: 'Ruta' },
      { key: 'material', label: 'Material' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'cantidad', label: 'Cant. Entrega', cls: 'text-right' },
      { key: 'doc_modelo', label: 'Doc. Precedente' },
      { key: 'cant_plan', label: 'Cant. Plan', cls: 'text-right' },
      { key: 'cant_entregas_doc', label: 'Σ Entregas Doc', cls: 'text-right' },
      { key: 'estado_plan', label: 'Estado Plan', badge: r => ({
          CUADRA: 'bg-green-100 text-green-800', PARCIAL: 'bg-amber-100 text-amber-800',
          EXCEDE: 'bg-red-100 text-red-800' }[r.estado_plan] || 'bg-surface-container-high text-secondary') },
    ],
  },

  // ── INDICADORES PLAN DE CARGA (24-sep-2026): una vista, 2 modos ─────────
  // Consolidación: por DT Σ max(ton bruto, ton vol) / capacidad (GeEs), tope 100%, promedio simple.
  // Efectividad: por línea (documento+SKU) de la foto 15:30; entregas del Doc. Precedente
  // creadas en D..D+2 hábiles, buscadas en los DT; cumple si cant. DT >= cant. plan.
  ind_plan_carga: {
    titulo: 'INDICADORES – PLAN DE CARGA',
    modes: [
      {
      label: 'Consolidación de Carga',
    vista: 'v_ind_consolidacion_dt',
    chipFilter: { campo: 'centro_expedicion', label: 'Centro Expedición' },
    extraChips: [{ campo: 'tipo_despacho', label: 'Tipo Despacho' }, { campo: 'usuario_dt', label: 'Usuario' }],
    searchLabel: 'BUSCADOR GENERAL',
    filtros: [],
    dateRange: { campo: 'fecha_creacion', label: 'Fecha Creación DT' },
    badges(filt) {
      const conCap = filt.filter(r => r.pct_consolidacion != null);
      const prom = conCap.length ? conCap.reduce((s, r) => s + Number(r.pct_consolidacion), 0) / conCap.length * 100 : null;
      const sinPeso = filt.reduce((s, r) => s + (Number(r.lineas_sin_peso) || 0), 0);
      return badgePill('Consolidación promedio', prom == null ? '—' : prom.toFixed(1) + '%', 'bg-primary text-white')
        + badgePill('Viajes (DT)', filt.length, 'bg-surface-container-high text-on-surface')
        + badgePill('DT sin capacidad', filt.length - conCap.length, 'bg-amber-100 text-amber-800')
        + badgePill('Líneas sin peso', sinPeso, 'bg-amber-100 text-amber-800');
    },
    columnas: [
      { key: 'transporte', label: 'Doc. Transporte' },
      { key: 'fecha_creacion', label: 'Fecha', cls: 'num-clear' },
      { key: 'usuario_dt', label: 'Usuario' },
      { key: 'tipo_despacho', label: 'Tipo Despacho' },
      { key: 'centro_expedicion', label: 'Centro Exp.' },
      { key: 'transportista', label: 'Transportista' },
      { key: 'sucursal_destino', label: 'Destino' },
      { key: 'n_entregas', label: 'Entregas', cls: 'text-center' },
      { key: 'capacidad_efectiva', label: 'Capacidad (t)', cls: 'text-right', valueFn: r => r.capacidad_efectiva == null ? '' : r.capacidad_efectiva + (r.capacidad_estimada ? '*' : '') },
      { key: 'ton_cargadas', label: 'Ton Cargadas', cls: 'text-right' },
      { key: 'pct_consolidacion', label: '% Consolidación', cls: 'text-right font-bold',
        valueFn: r => r.pct_consolidacion == null ? '' : (Number(r.pct_consolidacion) * 100).toFixed(1) + '%' },
      { key: 'lineas_sin_peso', label: 'Líneas sin peso', cls: 'text-center' },
    ],
        },
      {
      label: 'Efectividad Plan de Carga',
    vista: 'v_ind_efectividad_plan',
    chipFilter: { campo: 'ce', label: 'Centro Destino' },
    extraChips: [{ campo: 'cd_origen', label: 'CD Origen' }, { campo: 'categoria', label: 'Categoría' }, { campo: 'estado', label: 'Estado' }],
    searchLabel: 'BUSCADOR GENERAL',
    filtros: [],
    dateRange: { campo: 'fecha', label: 'Fecha Plan (foto 15:35)' },
    badges(filt) {
      // Líneas EN PLAZO (aún dentro de las 48h hábiles) no entran al cálculo.
      const medibles = filt.filter(r => r.estado !== 'EN PLAZO');
      const ok = medibles.filter(r => r.linea_cumple).length;
      const pct = medibles.length ? ok / medibles.length * 100 : null;
      return badgePill('Efectividad', pct == null ? '—' : pct.toFixed(1) + '%', 'bg-primary text-white')
        + badgePill('Líneas medidas', medibles.length, 'bg-surface-container-high text-on-surface')
        + badgePill('Cumplen', ok, 'bg-green-100 text-green-800')
        + badgePill('En plazo (48h)', filt.length - medibles.length, 'bg-blue-100 text-blue-800');
    },
    columnas: [
      { key: 'fecha', label: 'Fecha Plan', cls: 'num-clear' },
      { key: 'cd_origen', label: 'CD' },
      { key: 'ce', label: 'Centro Dest.' },
      { key: 'categoria', label: 'Categoría' },
      { key: 'documento', label: 'Documento' },
      { key: 'material', label: 'Material' },
      { key: 'nombre', label: 'Descripción' },
      { key: 'cant_plan', label: 'Cant. Plan', cls: 'text-right' },
      { key: 'fecha_limite', label: 'Límite 48h', cls: 'num-clear' },
      { key: 'entregas', label: 'Entregas' },
      { key: 'cant_entregada', label: 'Cant. Entregas', cls: 'text-right' },
      { key: 'cant_dt', label: 'Cant. DT', cls: 'text-right' },
      { key: 'usuarios', label: 'Usuario(s)' },
      { key: 'estado', label: 'Estado', badge: r => ({
          CUMPLE: 'bg-green-100 text-green-800', PARCIAL: 'bg-amber-100 text-amber-800',
          'CON ENTREGA SIN DT': 'bg-blue-100 text-blue-800', 'EN PLAZO': 'bg-surface-container-high text-secondary', 'NO CARGADO': 'bg-red-100 text-red-800' }[r.estado] || '') },
    ],
        },
    ],
  },
};

// ============================================================================
// REDISEÑO v2 (29-sep-2026) — presentación de las vistas de datos
// ----------------------------------------------------------------------------
// Cada bloque describe cómo se ve la vista en el motor v2 (troncales-ui.js):
// título, descripción, tarjetas que filtran, chips, buscadores, columnas,
// franja de color y panel lateral. La carga y las reglas de negocio siguen
// siendo las de VISTAS_TRONCAL (vista, preload, transform, postFilter).
// ============================================================================
const V2_DEPS = {
  fetchAllRows, filtrarPorCentro, can, parseDateSAP, exportarCSV, showAlert,
  clearRawCache: () => clearRawCache(),
  loadExclusionesPlan, excluirDelPlan, reactivarEnPlan,
};
const ORIGENES_CD = [['1003', 'CD Quilicura · 1003'], ['1081', 'CD Concepción · 1081']];
const C_INK = '#191c1d', C_RED = '#b5000b', C_ORANGE = '#ea580c', C_YELLOW = '#ca8a04', C_GREEN = '#15803d', C_GREY = '#9ca3af', C_BLUE = '#1d4ed8', C_SEC = '#5c5f61';

const nombreCentro = ce => { const n = getNombreCentro(String(ce ?? '').trim()); return n && n !== ce ? n : ''; };
function sucHtml(ce) {
  const c = String(ce ?? '').trim();
  if (!c) return '<span class="sv-muted">—</span>';
  const n = nombreCentro(c);
  return n ? txt(n, c, true) : mono(c);
}
const matHtml = (m, nombre) => mono(m, nombre);
const tonNum = v => typeof v === 'number' ? v : parseNum(v);
// Alerta por fecha SAP (mismas reglas de alertaFecha) → etiqueta y tono de píldora
function alertaV2(fe, dias = 5) {
  const a = alertaFecha(fe, dias);
  if (a.txt === 'PEDIDO ATRASADO') return { k: 'Atrasado', tone: 'bad' };
  if (a.txt === 'PRONTO A VENCER') return { k: 'Pronto a vencer', tone: 'orange' };
  return parseDateSAP(fe) ? { k: 'Vigente', tone: 'ok' } : { k: '', tone: 'mute' };
}
function diasVencida(fe) {
  const d = parseDateSAP(fe);
  return d ? Math.floor((hoy00() - d) / 86400000) : null;
}
// Días de stock (SLIM) → grupo de quiebre, mismos cortes que tipoQuiebre()
function grupoQuiebre(sd) {
  if (sd == null) return { g: 'n', lbl: 'Sin dato', tone: 'mute' };
  if (sd <= 3) return { g: 'q', lbl: 'Quebrado', tone: 'bad' };
  if (sd <= 5) return { g: 'c', lbl: 'Crítico', tone: 'orange' };
  if (sd <= 7) return { g: 'r', lbl: 'En revisión', tone: 'warn' };
  return { g: 'ok', lbl: 'OK', tone: 'ok' };
}
async function slimSkuMap() {
  const rows = await fetchAllRows('v_trc_slim_stock');
  const m = {};
  rows.forEach(r => {
    const k = `${String(r.centro ?? '').trim()}|${String(r.codigo_articulo ?? '').trim()}`;
    const sd = parseNum(r.stock_days);
    if (!m[k] || sd < m[k].sd) m[k] = { sd, abc: String(r.clase_abc ?? '').trim().toUpperCase() };
  });
  return m;
}
async function pvRefMap() {
  const rows = await fetchAllRows('v_trc_pedidos_ventas_ref');
  const m = {};
  rows.forEach(r => { const k = String(r.doc_ventas ?? '').trim(); if (k && !m[k]) m[k] = r; });
  return m;
}
// Condición de expedición del pedido de venta (v_trc_pedidos_ventas_ref.denominacion):
// manda el último tramo ("EBE-RET / CLI-RET" → retira el cliente).
function condExpedicion(den) {
  const d = String(den ?? '').trim();
  if (!d) return null;
  const fin = d.toUpperCase().split('/').pop().trim();
  if (fin.startsWith('CLI-RET')) return { lbl: 'Retira cliente', tone: 'mute', raw: d };
  if (fin.startsWith('EBE-DESP')) return { lbl: 'Despacho EBEMA', tone: 'info', raw: d };
  if (fin.startsWith('FAB-DESP')) return { lbl: 'Despacho fábrica', tone: 'purple', raw: d };
  return { lbl: d, tone: 'mute', raw: d };
}
const PRIO_V2 = {
  B: { lbl: 'Usuario', tone: 'bad' }, C: { lbl: 'ABC AA', tone: 'orange' },
  D: { lbl: 'Quiebre', tone: 'warn' }, E: { lbl: 'Abastecimiento', tone: 'mute' },
};
const TIPO_RETIRO_TONE = { 'FAB-CLTE': 'purple', 'FAB-SUC': 'info', 'FAB-CD': 'mute' };
const ESTADO_PLAN_V2 = { CUADRA: ['Cuadra', 'ok'], PARCIAL: ['Parcial', 'warn'], EXCEDE: ['Excede', 'bad'], 'SIN PLAN': ['Sin plan', 'mute'] };
const orderAbc = (a, b) => abcRank(a) - abcRank(b) || a.localeCompare(b);
const fechaUpd = ts => ts ? horaChile(ts) : '';
// Retiro atrasado (regla 29-sep-2026): fecha SAP vencida hace MÁS de 5 días y sin coordinar.
const retiroAtrasado = r => !esEstadoCoordinado(r._estado) && (diasVencida(r.fe_entrega) ?? -1) > 5;

const V2 = {
  // ── STOCK ALMACÉN 4000 ────────────────────────────────────────────────────
  stock_almacen: {
    titulo: 'Stock Almacén 4000',
    desc: 'Stock disponible en el almacén 4000 (físicamente en 1003) y días de stock de la sucursal destino por SKU.',
    async preload() { return { skuMap: await slimSkuMap() }; },
    enrich(rows, ctx) {
      rows.forEach(r => {
        const info = ctx.skuMap[`${String(r.ce ?? '').trim()}|${String(r.material ?? '').trim()}`] || null;
        r._sd = info ? info.sd : null;
        r._abc = info && info.abc ? info.abc : 'Sin clase';
        r._q = grupoQuiebre(r._sd);
      });
    },
    chip: { label: 'Clase ABC', of: r => r._abc, orden: orderAbc },
    search: { ph: 'Buscar material', of: r => `${r.material} ${r.texto_breve_de_material || r.denominacion_de_posicion || ''} ${r.documento || ''}` },
    kpis: [
      { key: 'all', label: 'SKU', color: C_INK, sub: 'con stock en 4000' },
      { key: 'q', label: 'Quebrados', color: C_RED, sub: '0 a 3 días', fn: r => r._q.g === 'q' },
      { key: 'c', label: 'Críticos', color: C_ORANGE, sub: '4 a 5 días', fn: r => r._q.g === 'c' },
      { key: 'r', label: 'En revisión', color: C_YELLOW, sub: '6 a 7 días', fn: r => r._q.g === 'r' },
    ],
    edge: r => r._q.g === 'q' ? C_RED : null,
    note: 'Días de stock según SLIM del centro destino',
    minW: '1000px',
    modos: {
      stock: {
        v2label: 'Stock', icon: 'inventory',
        cols: [
          { label: 'Material', html: r => matHtml(r.material, r.texto_breve_de_material) },
          { label: 'Destino', html: r => sucHtml(r.ce) },
          { label: 'Clase ABC', html: r => mono(r._abc) },
          { label: 'Stock (un)', al: 'r', html: r => escV2(r.libre_utiliz || '0') + (r.umb ? ` <span class="sv-muted">${escV2(r.umb)}</span>` : '') },
          { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(tonNum(r._ton_totales))}</span>` },
          { label: 'Días de stock', al: 'r', html: r => r._sd == null ? '<span class="sv-muted">—</span>' : `<span class="sv-b" style="color:${r._sd <= 3 ? C_RED : C_INK}">${r._sd}</span>` },
          { label: 'Estado', html: r => pill(r._q.lbl, r._q.tone) },
        ],
      },
      pedidos: {
        v2label: 'Pedido de ventas', icon: 'sell',
        cols: [
          { label: 'Pedido de venta', html: r => mono(r.documento, r.creado ? 'entrega ' + r.creado : '') },
          { label: 'Destino', html: r => sucHtml(r.ce) },
          { label: 'Material', html: r => matHtml(r.material, r.denominacion_de_posicion) },
          { label: 'Cantidad', al: 'r', html: r => escV2(r.libre_utiliz || '0') + (r.umb ? ` <span class="sv-muted">${escV2(r.umb)}</span>` : '') },
          { label: 'Ruta', html: r => mono(r.ruta, r._comuna) },
          { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(tonNum(r._ton_totales))}</span>` },
          { label: 'Días de stock', al: 'r', html: r => r._sd == null ? '<span class="sv-muted">—</span>' : `<span class="sv-b" style="color:${r._sd <= 3 ? C_RED : C_INK}">${r._sd}</span>` },
          { label: 'Estado', html: r => pill(r._q.lbl, r._q.tone) },
        ],
      },
    },
    detalle: r => ({
      kind: 'Material · almacén 4000', title: r.material, sub: (r.texto_breve_de_material || r.denominacion_de_posicion || '') + (nombreCentro(r.ce) ? ' → ' + nombreCentro(r.ce) : ''),
      kv: [
        ['Centro destino', `${r.ce}${nombreCentro(r.ce) ? ' · ' + nombreCentro(r.ce) : ''}`],
        ['Clase ABC', r._abc],
        ['Cantidad disponible', `${r.libre_utiliz || 0} ${r.umb || ''}`.trim()],
        ['Peso mayor (kg/un)', r._peso_mayor],
        ['Toneladas', tonHtml(tonNum(r._ton_totales)), true],
        ['Días de stock', r._sd == null ? 'Sin dato en SLIM' : `${r._sd} · ${r._q.lbl}`],
        r.documento ? ['Pedido de venta', r.documento] : null,
        r.ruta ? ['Ruta', `${r.ruta}${r._comuna ? ' · ' + r._comuna : ''}`] : null,
        r.creado ? ['Fecha de entrega', r.creado] : null,
        r.deudor ? ['ID vendedor', r.deudor] : null,
      ],
      nota: 'Almacén 4000 · centro físico 1003',
    }),
  },

  // ── REVEX ─────────────────────────────────────────────────────────────────
  pedidos_traslados_revex: {
    titulo: 'Revex',
    desc: 'Todos los pedidos de traslado Revex del SQVI (material 900000). Sin ventana de fechas: por defecto quedan disponibles para el próximo camión y van primero en el orden de llenado.',
    enrich(rows) { rows.forEach(r => { r._al = alertaV2(r.fecha_confirmada, 7); r._t = tonNum(r._ton_totales); }); },
    // (2-oct-2026, Jordan) Excluir/Reactivar en la fila principal del pedido; no en el panel de detalle.
    excluirEnFila: true,
    chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    docSearch: { ph: 'N° pedido de traslado', of: r => r.doc_compr },
    fecha: { label: 'Entrega', of: r => r.fecha_confirmada },
    kpis: [
      { key: 'all', label: 'Pedidos', color: C_INK, sub: 'pendientes' },
      { key: 'at', label: 'Atrasados', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
      { key: 'pv', label: 'Pronto a vencer', color: C_ORANGE, sub: '7 días o menos', fn: r => r._al.k === 'Pronto a vencer' },
      { key: 'vi', label: 'Vigentes', color: C_GREEN, sub: 'en plazo', fn: r => r._al.k === 'Vigente' },
    ],
    cols: [
      { label: 'Pedido', html: r => mono(r.doc_compr, r.creado_el ? 'creado ' + r.creado_el : '') },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Material', html: r => matHtml(r.material, r.texto_breve) },
      { label: 'Cant. pend.', al: 'r', html: r => escV2(r.ctd_pedido) + (r.ump ? ` <span class="sv-muted">${escV2(r.ump)}</span>` : '') },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._t)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r.fecha_confirmada) },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) },
    ],
    edge: r => r._al.k === 'Atrasado' ? C_RED : null,
    detalle: r => ({
      kind: 'Traslado Revex', title: r.doc_compr, sub: `${nombreCentro(r.cesu) || r.cesu} → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
      kv: [
        ['Centro origen', r.cesu], ['Centro destino', `${r.ce}${nombreCentro(r.ce) ? ' · ' + nombreCentro(r.ce) : ''}`],
        ['Almacén destino', r.alm], ['Material', r.material],
        ['Cantidad pedido', `${r.ctd_pedido || 0} ${r.ump || ''}`.trim()], ['Toneladas', tonHtml(r._t), true],
        ['Fecha entrega', r.fecha_confirmada], ['Alerta', pill(r._al.k, r._al.tone), true],
        ['Fecha creación', r.creado_el], ['Tipo documento', r.cl],
      ],
      nota: '1º en el orden de llenado · disponible por defecto para el próximo camión',
    }),
  },

  // ── VENTAS CD (1003) ──────────────────────────────────────────────────────
  // (2-oct-2026, Jordan) Tipo de entrega CONSOLIDABLE / CD-CLIENTE por cliente (23,8 t),
  // «Coordinar despacho» en el detalle y Excluir en la fila. Sólo las NV coordinadas
  // entran al Plan de Carga: la fecha de entrega confirmada es el día objetivo del plan
  // (ej.: entrega 05.10 → aparece en el plan armado el 02.10, día objetivo 05.10).
  pedidos_venta: {
    titulo: 'Ventas CD (1003)',
    desc: 'Pedidos de ventas con centro expedición CDRM. Sólo los pedidos coordinados entran al Plan de Carga del día de su fecha de entrega.',
    async preload() {
      const [pvMap, ventasDirectoManual, feriadosRows, coordMap, maestro, horizRows] = await Promise.all([
        pvRefMap(), loadVentasDirectoManual(), fetchAllRows('abast_feriados'), loadCoordinacionesVenta(), loadMaestroClientes(), fetchAllRows('abast_horizonte_centro')]);
      const feriadosSet = new Set((feriadosRows || []).map(r => String(r.fecha ?? '').trim()).filter(Boolean));
      const horiz = {};
      (horizRows || []).filter(r => String(r.centro_origen ?? '').trim() === '1003')
        .forEach(r => { horiz[String(r.centro_destino ?? '').trim()] = Number(r.horizonte_horas) === 48 ? 48 : 24; });
      const d1 = addBusinessDays(hoy00(), 1, feriadosSet), d2 = addBusinessDays(hoy00(), 2, feriadosSet);
      return { pvMap, ventasDirectoManual, feriadosSet, coordMap, maestro, diaHabil2: d2, diaObj: ce => (horiz[String(ce ?? '').trim()] === 48 ? d2 : d1) };
    },
    enrich(rows, ctx) {
      ctx._rowsByDoc = new Map(rows.map(r => [String(r.doc_ventas ?? '').trim(), r]));
      rows.forEach(r => {
        const doc = String(r.doc_ventas ?? '').trim();
        const pv = ctx.pvMap[doc] || {};
        r._id_cliente = String(r.solicitante ?? '').trim();   // columna "Solic." del SQVI (30-sep-2026)
        r._mc = (ctx.maestro && ctx.maestro.get(r._id_cliente)) || null;
        r._cliente = (r._mc && r._mc.nombre) || pv.nombre_1 || (r._coord && r._coord.nombre_cliente) || '';
        r._vendedor = pv.nombre || '';
        r._cond = condExpedicion(pv.denominacion);
        r._al = alertaV2(r._fecha_plan, 5);
        r._ruta = (r._detalle && r._detalle[0] && r._detalle[0].ruta) || '';
        r._comuna = (r._detalle && r._detalle[0] && r._detalle[0].comuna) || '';
        r._dia_obj = ctx.diaObj(r.ofvta);
        const fp = parseDateSAP(r._fecha_plan);
        r._plan = !r._coord ? 'SIN_COORD' : (fp && fp.getTime() <= r._dia_obj.getTime() ? 'EN_PLAN' : 'PROGRAMADO');
      });
    },
    rowId: r => String(r.doc_ventas ?? '').trim(),
    chip: { label: 'Destino', of: r => String(r.ofvta ?? '').trim(), name: v => nombreCentro(v) || v },
    search: { ph: 'Buscar pedido o cliente', of: r => `${r.doc_ventas} ${r._cliente} ${r._id_cliente} ${r._vendedor} ${(r._coord && r._coord.n_entrega) || ''}` },
    docSearch: null,
    fecha: { label: 'Entrega', of: r => r._fecha_plan },
    kpis: [
      { key: 'all', label: 'Pedidos', color: C_INK, sub: 'pendientes con ruta' },
      { key: 'sc', label: 'Sin coordinar', color: C_ORANGE, sub: 'no entran al plan', fn: r => !r._coord },
      { key: 'co', label: 'Coordinados', color: C_GREEN, sub: 'pedido coordinado', fn: r => !!r._coord },
      { key: 'pl', label: 'En plan de carga', color: C_BLUE, sub: 'pedidos coordinados', fn: r => !!r._coord },
      { key: 'cd', label: 'CD-Cliente', color: '#7e22ce', sub: 'cliente ≥ 23,8 t o definido', fn: r => !!r._directo },
      { key: 'at', label: 'Atrasados', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
    ],
    cols: [
      { label: 'Pedido', html: r => mono(r.doc_ventas, r.creado_el ? 'creado ' + r.creado_el : '') },
      { label: 'Cliente', html: r => txt(r._cliente || (r._id_cliente ? 'ID ' + r._id_cliente : '—'), [r._cliente && r._id_cliente ? 'ID ' + r._id_cliente : '', r._vendedor].filter(Boolean).join(' · '), true) },
      { label: 'Destino', html: r => sucHtml(r.ofvta) },
      { label: 'Tipo entrega', html: r => pill(r._directo ? 'CD-Cliente' : 'Consolidable', r._directo ? 'purple' : 'info')
          + (r._tipo_fijo && r._tipo_fijo !== r._tipo_auto ? ` ${pill('Manual', 'mute')}` : '')
          + (r._cond ? `<div class="sv-sub" title="${escV2(r._cond.raw)}">${escV2(r._cond.lbl)}</div>` : '') },
      { label: 'Líneas', al: 'r', html: r => escV2((r._detalle || []).length) },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` + (r._n_pedidos_cliente > 1 ? `<div class="sv-sub">cliente ${escV2(fmtNum(r._ton_cliente, 1))} t</div>` : '') },
      { label: 'Fecha entrega', html: r => mono(r._fecha_plan, r._coord ? 'confirmada' : 'SAP · por confirmar') },
      { label: 'Coordinación', html: r => r._coord ? pill('Pedido Coordinado', 'ok') + (r._coord.n_entrega ? `<div class="sv-sub">Entrega ${escV2(r._coord.n_entrega)}</div>` : '')
          + (r._coord.tipo_entrega === 'CD-CLIENTE' && pendTranspRetiro(r._coord).length ? `<div style="margin-top:4px" title="Pendiente: ${escV2(pendTranspRetiro(r._coord).join(', '))}">${pill('Chofer/patente pendiente', 'warn')}</div>` : '') : pill('Sin coordinar', 'mute') },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) + (r._estado ? ` ${pill('Parcial', 'warn')}` : '') },
    ],
    // Excluir / Reactivar en la fila principal (no en el detalle) + estado en el Plan de Carga.
    excluirEnFila: true,
    // (2-oct-2026, Jordan) Pedido coordinado = «En plan» (igual que Revex); si su fecha es
    // posterior al día objetivo de hoy, se indica para qué día entra.
    planEstado: (r, excluida) => excluida ? pill('Excluida hoy', 'bad')
      : r._coord ? `<span title="Plan de carga con día objetivo ${escV2(r._fecha_plan)}">${pill('En plan', 'ok')}</span>`
        + (r._plan === 'PROGRAMADO' ? `<div class="sv-sub">día ${escV2(r._fecha_plan)}</div>` : '')
      : pill('No considerado', 'mute'),
    edge: r => r._coord ? C_GREEN : (r._al.k === 'Atrasado' ? C_RED : null),
    note: 'Tipo de entrega por cliente: ≥ 23,8 t (85% de 28 t) → CD-Cliente; si no, Consolidable · Sólo los pedidos coordinados entran al Plan de Carga',
    minW: '1280px',
    detalle: r => {
      const c = r._coord;
      const tipoLbl = t => t === 'CD-CLIENTE' ? 'CD-Cliente (camión directo)' : 'Consolidable (sube con carga a sucursal)';
      const reglaLbl = `${r._tipo_auto === 'CD-CLIENTE' ? 'CD-Cliente' : 'Consolidable'} · el cliente suma ${fmtNum(r._ton_cliente, 1)} t en ${r._n_pedidos_cliente} ${r._n_pedidos_cliente === 1 ? 'pedido' : 'pedidos'} (umbral 23,8 t)`;
      const origenLbl = r._tipo_origen === 'COORDINACION' ? 'definido al coordinar' : r._tipo_origen === 'MANUAL' ? 'marcado manual' : 'regla automática';
      const diaObjTxt = r._dia_obj ? fmtFechaISO(isoLocal(r._dia_obj)) : '';
      const aviso = r._plan === 'EN_PLAN' ? `<b>Plan de carga:</b> pedido coordinado para el ${escV2(r._fecha_plan)}; entra al Plan de Carga de hoy (día objetivo ${escV2(diaObjTxt)}).`
        : r._plan === 'PROGRAMADO' ? `<b>Plan de carga:</b> pedido coordinado para el ${escV2(r._fecha_plan)}; entrará al plan cuyo día objetivo sea esa fecha.`
        : '<b>Plan de carga:</b> sin coordinar, no se considera. Usa «Coordinar despacho» para confirmar la fecha de entrega.';
      const acciones = [];
      if (can('coordinar_venta')) {
        acciones.push({ label: c ? 'Editar coordinación' : 'Coordinar despacho', icon: 'event_available', primary: true,
          run: async (row, ctx) => ((await showCoordVentaModal(row, ctx)) ? { recargar: true } : null) });
        if (c) acciones.push({ label: 'Anular coordinación', icon: 'event_busy', run: async row => {
          if (!await confirmar(`¿Anular la coordinación del pedido ${row.doc_ventas}?\n\nVuelve a «Sin coordinar» y sale del Plan de Carga.`)) return null;
          return (await anularCoordinacionVenta(row.doc_ventas)) ? (showAlert('Coordinación anulada', 'success'), { recargar: true }) : null;
        } });
      }
      if (r._manual && !c && can('forzar_cd_cliente')) acciones.push({ label: 'Volver a regla automática', icon: 'undo', run: async row => {
        if (!await confirmar(`¿Quitar el tipo de entrega manual del pedido ${row.doc_ventas}?\n\nVuelve a evaluarse con la regla de 23,8 t por cliente.`)) return null;
        return (await setVentaDirectoManual(row.doc_ventas, null)) ? (showAlert('Pedido vuelve a la regla automática', 'success'), { recargar: true }) : null;
      } });
      return {
        kind: 'Pedido de venta · CE CDRM', title: r.doc_ventas,
        sub: `${r._cliente || (r._id_cliente ? 'Cliente ID ' + r._id_cliente : 'Cliente sin identificar')} → ${nombreCentro(r.ofvta) || r.ofvta}`,
        aviso,
        kv: [
          ['Tipo de entrega', `${tipoLbl(r._tipo_entrega)} · ${origenLbl}`], ['Regla automática', reglaLbl],
          ['Estado', c ? pill('Pedido Coordinado', 'ok') : pill('Sin coordinar', 'mute'), true],
          ['Fecha entrega', c ? `${r._fecha_plan} (confirmada)` : `${r.fe_entrega || '—'} (SAP, por confirmar)`],
          c ? ['N° de entrega', c.n_entrega] : null,
          ['ID cliente (Solic.)', r._id_cliente], ['Cliente', r._cliente],
          ['Comuna', (c && c.comuna) || r._comuna], c ? ['Dirección', c.direccion] : null,
          c ? ['Teléfono cliente', c.telefono] : null,
          c && c.tipo_entrega === 'CD-CLIENTE' ? ['Transporte', [c.id_transporte, c.transportista].filter(Boolean).join(' · ')] : null,
          c && c.tipo_entrega === 'CD-CLIENTE' ? ['Chofer', [c.chofer_nombre, c.chofer_rut, c.chofer_telefono].filter(Boolean).join(' · ')] : null,
          c && c.tipo_entrega === 'CD-CLIENTE' ? ['Patentes', [c.patente_camion ? 'Camión ' + c.patente_camion : '', c.patente_carro ? 'Carro ' + c.patente_carro : ''].filter(Boolean).join(' · ')] : null,
          ['Condición expedición', r._cond ? `${r._cond.lbl} (${r._cond.raw})` : '—'],
          ['Ruta', r._ruta], ['Oficina ventas', `${r.ofvta}${nombreCentro(r.ofvta) ? ' · ' + nombreCentro(r.ofvta) : ''}`],
          ['Toneladas', tonHtml(r._ton_num), true], ['Vendedor', r._vendedor || r.deudor],
          ['Fecha creación', r.creado_el], ['Alerta', pill(r._al.k, r._al.tone), true],
          r._camino_lbl ? ['Descarga en camino', r._camino_lbl.replace('DESCARGA EN CAMINO ', '').replace(/[()]/g, '')] : null,
          r._estado ? ['Entrega SAP', 'Entrega parcial pendiente'] : null,
          c ? ['Coordinado por', `${c.updated_by || c.created_by || ''}${c.updated_at ? ' · ' + horaChile(c.updated_at) : ''}`] : null,
        ],
        tabla: {
          titulo: `${(r._detalle || []).length} ${(r._detalle || []).length === 1 ? 'material pendiente' : 'materiales pendientes'}`,
          head: [['Material'], ['Descripción'], ['Cantidad', 'r'], ['Ton', 'r']],
          rows: (r._detalle || []).map(d => [mono(d.material), escV2(d.nombre), escV2(fmtNum(d.pendiente, 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`]),
        },
        nota: r._directo ? 'Camión directo al cliente (CD-Cliente)' : '2º en el orden de llenado del camión CD',
        acciones,
      };
    },
  },

  // ── RETIROS DE FÁBRICA ────────────────────────────────────────────────────
  // (3-oct-2026, Jordan) Tipo de pedido STOCK/CALZADA, tipo de retiro automático por 23,8 t,
  // coordinación Retiro RM (verde, entra al plan) / Retiro local (naranjo, no entra),
  // datos de transporte y varias OC por camión, Excluir en la fila, sólo OWNER edita.
  retiros: {
    titulo: 'Retiros de Fábrica',
    desc: 'Órdenes de compra con retiro a proveedor. Sólo los Retiro RM entran al Plan de Carga, el día de su fecha de retiro (día en que se carga).',
    rowId: r => String(r.doc_compr ?? '').trim(),
    enrich(rows, ctx) { ctx._rows = rows; rows.forEach(r => { r._al = alertaV2(r.fe_entrega, 5); }); },
    chips: [
      { key: 'tp', label: 'Tipo pedido', of: r => r._tipo_pedido },
      { key: 'sd', label: 'Saldo', of: r => r._revision_saldo ? 'Con saldo pendiente' : 'Sin entregas parciales' },
    ],
    chip2: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    chip: { label: 'Tipo retiro', of: r => r._tipo_retiro },
    search: { ph: 'Buscar OC, proveedor o patente', of: r => `${r.doc_compr} ${r.nombre_1} ${r.proveedor} ${r.documento || ''} ${(r._transp && r._transp.patente_camion) || ''}` },
    fecha: { label: 'Entrega SAP', of: r => r.fe_entrega },
    kpis: [
      { key: 'all', label: 'OC por retirar', color: C_INK, sub: 'todas las sucursales' },
      { key: 'no', label: 'Sin coordinar', color: C_GREY, sub: 'no entran al plan', fn: r => !r._modo },
      { key: 'rm', label: 'Retiro RM', color: C_GREEN, sub: 'entran al plan de carga', fn: r => r._modo === 'RM' },
      { key: 'lo', label: 'Retiro local', color: C_ORANGE, sub: 'gestiona la sucursal', fn: r => r._modo === 'LOCAL' },
      { key: 'at', label: 'Atrasadas', color: C_RED, sub: 'vencidas > 5 días, sin coordinar', fn: retiroAtrasado },
      { key: 'ee', label: 'Expedición errónea', color: '#7e22ce', sub: 'pedido de venta calzado', fn: r => !!r._exp_error },
    ],
    cols: [
      { label: 'Orden de compra', html: r => mono(r.doc_compr, r.contr ? 'contrato ' + r.contr : '') },
      { label: 'Proveedor', html: r => txt(r.nombre_1, r.proveedor, true) },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Tipo pedido', html: r => pill(r._tipo_pedido === 'CALZADA' ? 'Calzada' : 'Stock', r._tipo_pedido === 'CALZADA' ? 'info' : 'mute') + (r.documento ? `<div class="sv-sub">PV ${escV2(r.documento)}</div>` : '') },
      { label: 'Tipo retiro', html: r => pill(r._tipo_retiro, TIPO_RETIRO_TONE[r._tipo_retiro] || 'mute') + `<div class="sv-sub">${r._tipo_origen === 'COORDINACION' ? 'coordinado' : 'automático'}</div>` },
      { label: 'Fecha SAP', html: r => mono(r.fe_entrega) },
      { label: 'Fecha retiro', html: r => r._fecha_retiro ? mono(fmtFechaISO(r._fecha_retiro))
          : (r._modo === 'RM' ? `<span class="sv-b" style="color:${C_RED}">Falta fecha</span>` : '<span class="sv-muted">—</span>') },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` + (r._parcial ? `<div class="sv-sub" style="color:#15803d">retira ${escV2(fmtNum(r._ton_ret, 1))} t</div>` : '') + (r._revision_saldo ? '<div class="sv-sub" style="color:#b5000b">saldo pendiente</div>' : '') },
      { label: 'Alerta', html: r => (retiroAtrasado(r) ? pill('Atrasada', 'bad') : (r._al.k === 'Atrasado' ? pill('Vencida', 'orange') : pill(r._al.k, r._al.k === 'Pronto a vencer' ? 'warn' : r._al.tone)))
          + (r._exp_error ? `<div style="margin-top:4px" title="${escV2(r._pv_denominacion)}">${pill('Expedición errónea', 'purple')}</div>` : '') },
      { label: 'Coordinación', html: r => r._modo === 'RM' ? pill('Retiro RM', 'ok') + (r._transp && r._transp.patente_camion ? `<div class="sv-sub">${escV2(r._transp.patente_camion)}</div>` : '')
          + (pendTranspRetiro(r._transp).length ? `<div style="margin-top:4px" title="Pendiente: ${escV2(pendTranspRetiro(r._transp).join(', '))}">${pill('Chofer/patente pendiente', 'warn')}</div>` : '')
          : r._modo === 'LOCAL' ? pill('Retiro local', 'orange') : pill('Sin coordinar', 'mute') },
    ],
    excluirEnFila: true,
    planEstado: (r, excluida) => excluida ? pill('Excluida hoy', 'bad')
      : r._modo === 'RM' ? pill('En plan', 'ok') + (r._fecha_retiro ? `<div class="sv-sub">carga ${escV2(fmtFechaISO(r._fecha_retiro))}</div>` : '')
      : r._modo === 'LOCAL' ? pill('Retiro local', 'orange')
      : pill('No considerado', 'mute'),
    edge: r => r._modo === 'LOCAL' ? C_ORANGE : r._modo === 'RM' ? C_GREEN : (retiroAtrasado(r) ? C_RED : null),
    note: 'Tipo retiro automático: ≥ 23,8 t (85% de 28 t) → Stock FAB-SUC / Calzada FAB-CLTE; bajo 23,8 t → FAB-CD · Retiro RM entra al plan el día de su fecha de retiro',
    minW: '1320px',
    detalle: r => {
      const t = r._transp || {};
      const puede = can('coordinar_retiro');
      const acciones = !puede ? [] : [
        { label: r._modo ? 'Editar coordinación' : 'Coordinar retiro', icon: 'event_available', primary: true,
          run: async (row, ctx) => ((await showCoordRetiroModal(row, ctx)) ? { recargar: true } : null) },
      ];
      if (puede && r._modo) acciones.push({ label: 'Anular coordinación', icon: 'event_busy', run: async row => {
        if (!await confirmar(`¿Anular la coordinación de la OC ${row.doc_compr}?\n\nVuelve a «Sin coordinar»: se limpian fecha, dirección, contacto y transporte, y sale del Plan de Carga.`)) return null;
        return (await anularCoordRetiro([row.doc_compr])) ? (showAlert('Coordinación anulada', 'success'), { recargar: true }) : null;
      } });
      const diasV = diasVencida(r.fe_entrega);
      const avisos = [];
      if (retiroAtrasado(r)) avisos.push(`<b>Atrasada:</b> la fecha SAP venció hace ${diasV} días y la OC sigue sin coordinar.`);
      if (r._exp_error) avisos.push(`<b>Expedición errónea:</b> el pedido de venta ${escV2(r.documento)} tiene expedición «${escV2(r._pv_denominacion)}»; debe ser EBE-RET / EBE-DESP o EBE-RET / CLI-RET.`);
      if (r._modo === 'RM' && pendTranspRetiro(t).length) avisos.push(`<b>Transporte pendiente:</b> falta ${escV2(pendTranspRetiro(t).join(', '))}. Complétalo con «Editar coordinación»${pendTranspRetiro(t).includes('patente') ? '; sin patente el camión directo no queda programado' : ''}.`);
      avisos.push(r._modo === 'RM' ? '<b>Plan de carga:</b> Retiro RM — entra al plan el día de su fecha de retiro.'
        : r._modo === 'LOCAL' ? '<b>Plan de carga:</b> Retiro local — no se considera en el plan.' : '<b>Plan de carga:</b> sin coordinar, no se considera.');
      const rm = r._modo === 'RM';
      return {
        kind: 'Orden de compra · ' + (r._tipo_pedido === 'CALZADA' ? 'Calzada' : 'Stock'), title: r.doc_compr, sub: `${r.nombre_1 || ''} → ${nombreCentro(r.ce) || r.ce} · ${fmtNum(r._ton_num, 2)} t`,
        aviso: avisos.join('<br>'),
        kv: [
          ['Tipo retiro', pill(r._tipo_retiro, TIPO_RETIRO_TONE[r._tipo_retiro] || 'mute') + ` <span class="sv-muted">${r._tipo_origen === 'COORDINACION' ? 'coordinado' : 'automático'}</span>`, true],
          ['Regla automática', `${r._tipo_auto} · ${fmtNum(r._ton_num, 1)} t (umbral 23,8 t)`],
          ['Coordinación', r._modo === 'RM' ? pill('Retiro RM', 'ok') : r._modo === 'LOCAL' ? pill('Retiro local', 'orange') : pill('Sin coordinar', 'mute'), true],
          ['Tipo pedido', r._tipo_pedido === 'CALZADA' ? 'Calzada (con pedido de venta)' : 'Stock'],
          ['Fecha SAP', r.fe_entrega], ['Fecha retiro (carga)', r._fecha_retiro ? fmtFechaISO(r._fecha_retiro) : ''],
          ['Toneladas', tonHtml(r._ton_num), true],
          r._parcial ? ['A retirar', `${tonHtml(r._ton_ret)} · ${(r._detalle || []).filter(d => d.retiro > 0).length} de ${(r._detalle || []).length} productos`, true] : null,
          ['Almacén destino', r.alm],
          ['Entrega entrante', r._entrega_entrante], ['Contrato de compra', r.contr],
          r._modo ? ['Dirección fábrica', [r._fab_direccion, r._fab_comuna].filter(Boolean).join(', ')] : null,
          r._modo ? ['Contacto', [r._fab_contacto, r._fab_telefono].filter(Boolean).join(' · ')] : null,
          rm && (t.id_transporte || t.transportista) ? ['Transporte', [t.id_transporte, t.transportista].filter(Boolean).join(' · ')] : null,
          rm && t.chofer_nombre ? ['Chofer', [t.chofer_nombre, t.chofer_rut, t.chofer_telefono].filter(Boolean).join(' · ')] : null,
          rm && t.patente_camion ? ['Patentes', `Camión ${t.patente_camion}${t.patente_carro ? ' · Carro ' + t.patente_carro : ''}`] : null,
          r.documento ? ['Pedido de venta', r.documento] : null,
          r.documento ? ['Tipo expedición', r._exp_error ? `${escV2(r._pv_denominacion)} ${pill('Errónea', 'purple')}` : escV2(r._pv_denominacion || '—'), true] : null,
          r.documento ? ['Cliente', r._pv_nombre_cliente] : null,
          r.documento ? ['Vendedor', r._pv_nombre_vendedor] : null,
          r.documento ? ['Ruta · comuna', [r._pv_ruta, r._pv_comuna].filter(Boolean).join(' · ')] : null,
          r._revision_saldo ? ['Saldo', 'Saldo pendiente (entrega parcial)'] : null,
          r._upd_at ? ['Última edición', `${fechaUpd(r._upd_at)}${r._upd_by ? ' · ' + r._upd_by : ''}`] : null,
        ],
        tabla: {
          titulo: `${(r._detalle || []).length} ${(r._detalle || []).length === 1 ? 'material pendiente' : 'materiales pendientes'}`,
          head: r._modo ? [['Material'], ['Descripción'], ['Pendiente', 'r'], ['A retirar', 'r'], ['Ton a retirar', 'r']] : [['Material'], ['Descripción'], ['Pendiente', 'r'], ['Ton', 'r']],
          rows: (r._detalle || []).map(d => r._modo
            ? [mono(d.material), escV2(d.texto_breve), escV2(fmtNum(d.pendiente, 0)), d.retiro > 0 ? escV2(fmtNum(d.retiro, d.retiro % 1 ? 2 : 0)) : '<span class="sv-muted">No retira</span>', `<span class="sv-ton">${tonHtml(d.ton_ret)}</span>`]
            : [mono(d.material), escV2(d.texto_breve), escV2(fmtNum(d.pendiente, 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`]),
        },
        nota: r._tipo_retiro === 'FAB-CD' ? '3º en el orden de llenado del camión CD' : 'Camión directo de fábrica',
        acciones,
      };
    },
  },

  // ── CROSSDOCKING ──────────────────────────────────────────────────────────
  // (4-oct-2026, Jordan) Por defecto todos los pedidos de traslado entran al plan como
  // CONSOLIDABLE (camión CD). Uno o varios pedidos de un mismo destino se pueden coordinar
  // como CD-CLIENTE (camión directo a cliente), igual que Ventas CD. Excluir en la fila.
  // Modifican: OWNER y Planner Abastecimiento (permiso ajustar_plan).
  pedidos_traslados_4000: {
    titulo: 'Crossdocking',
    desc: 'Traslados desde Almacén 4000 (CD Quilicura) a sucursales. Por defecto entran al Plan de Carga como Consolidable (camión CD).',
    rowId: r => `${r.doc_compr}|${r._pos || r.material}`,
    async preload() {
      const [coordMap, feriadosRows, horizRows] = await Promise.all([loadCoordTraslados(), fetchAllRows('abast_feriados'), fetchAllRows('abast_horizonte_centro')]);
      const feriadosSet = new Set((feriadosRows || []).map(r => String(r.fecha ?? '').trim()).filter(Boolean));
      const horiz = {};
      (horizRows || []).filter(r => String(r.centro_origen ?? '').trim() === '1003')
        .forEach(r => { horiz[String(r.centro_destino ?? '').trim()] = Number(r.horizonte_horas) === 48 ? 48 : 24; });
      const d1 = addBusinessDays(hoy00(), 1, feriadosSet), d2 = addBusinessDays(hoy00(), 2, feriadosSet);
      return { coordMap, diaObj: ce => (horiz[String(ce ?? '').trim()] === 48 ? d2 : d1) };
    },
    enrich(rows, ctx) {
      ctx._rows = rows;
      rows.forEach(r => {
        r._al = alertaV2(r.fe_entrega, 5); r._pv = r._origen === 'PEDIDO DE VENTAS';
        r._coord = ctx.coordMap.get(String(r.doc_compr).trim()) || null;
        r._cdcli = !!(r._coord && r._coord.tipo_entrega === 'CD-CLIENTE');
        const f = r._coord ? parseISODate(r._coord.fecha_entrega) : null;
        r._cd_hoy = !!(f && f.getTime() <= ctx.diaObj(r.ce).getTime());
      });
    },
    chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    chips: [{ key: 'te', label: 'Tipo entrega', of: r => r._cdcli ? 'CD-Cliente' : 'Consolidable' }],
    docSearch: { ph: 'N° pedido de traslado', of: r => r.doc_compr },
    fecha: { label: 'Entrega', of: r => r.fe_entrega },
    search: { ph: 'Buscar material o cliente', of: r => `${r.material} ${r.texto_breve} ${r.documento || ''} ${r._cliente || ''}` },
    kpis: [
      { key: 'all', label: 'Líneas', color: C_INK, sub: 'pendientes' },
      { key: 'co', label: 'Consolidable', color: C_BLUE, sub: 'camión CD', fn: r => !r._cdcli },
      { key: 'cd', label: 'CD-Cliente', color: '#7e22ce', sub: 'camión directo coordinado', fn: r => r._cdcli },
      { key: 'pv', label: 'Pedido de venta', color: C_SEC, sub: 'asociadas a un cliente', fn: r => r._pv },
      { key: 'at', label: 'Atrasadas', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
    ],
    cols: [
      { label: 'Pedido traslado', html: r => mono(r.doc_compr) },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Tipo', html: r => (r._pv ? pill('Pedido de venta', 'info') : pill('Stock', 'mute')) + (r._cliente ? `<div class="sv-sub">${escV2(r._cliente)}</div>` : '') },
      { label: 'Material', html: r => matHtml(r.material, r.texto_breve) },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r._cdcli ? fmtFechaISO(r._coord.fecha_entrega) : r.fe_entrega, r._cdcli ? 'coordinada' : '') },
      { label: 'Tipo entrega', html: r => r._cdcli ? pill('CD-Cliente', 'purple') + (r._coord.patente_camion ? `<div class="sv-sub">${escV2(r._coord.patente_camion)}</div>` : '')
          + (pendTranspRetiro(r._coord).length ? `<div style="margin-top:4px" title="Pendiente: ${escV2(pendTranspRetiro(r._coord).join(', '))}">${pill('Chofer/patente pendiente', 'warn')}</div>` : '') : pill('Consolidable', 'info') },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) },
    ],
    excluirEnFila: true,
    permisoExcluir: 'ajustar_plan',
    planEstado: (r, excluida) => excluida ? pill('Excluida hoy', 'bad')
      : r._cdcli ? pill(r._cd_hoy ? 'En plan · CD-Cliente' : 'CD-Cliente', 'purple') + `<div class="sv-sub">día ${escV2(fmtFechaISO(r._coord.fecha_entrega))}</div>`
      : pill('En plan', 'ok'),
    edge: r => r._cdcli ? '#7e22ce' : (r._al.k === 'Atrasado' ? C_RED : null),
    note: 'Consolidable: va en el camión CD (4º en el orden de llenado) · CD-Cliente: camión directo coordinado, sale el día de su fecha de entrega',
    minW: '1180px',
    detalle: r => {
      const c = r._coord;
      const puede = can('ajustar_plan');
      const acciones = !puede ? [] : [
        { label: r._cdcli ? 'Editar coordinación CD-Cliente' : 'Coordinar como CD-Cliente', icon: 'local_shipping', primary: true,
          run: async (row, ctx) => ((await showCoordTrasladoModal(row, ctx)) ? { recargar: true } : null) },
      ];
      if (puede && r._cdcli) acciones.push({ label: 'Volver a Consolidable', icon: 'undo', run: async row => {
        if (!await confirmar(`¿Quitar el camión directo CD-Cliente del pedido ${row.doc_compr}?\n\nVuelve a Consolidable y entra al camión CD.`)) return null;
        return (await anularCoordTraslados([row.doc_compr])) ? (showAlert('Pedido vuelve a Consolidable', 'success'), { recargar: true }) : null;
      } });
      return {
        kind: 'Traslado desde almacén 4000 · ' + (r._pv ? 'Pedido de venta' : 'Stock'), title: r.doc_compr,
        sub: `CD Quilicura → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
        aviso: r._cdcli ? `<b>CD-Cliente:</b> camión directo coordinado para el ${escV2(fmtFechaISO(c.fecha_entrega))}${r._cd_hoy ? ' — entra al Plan de Carga de hoy.' : '.'} No va en el camión CD.`
          : '<b>Consolidable:</b> va en el camión CD de la sucursal (4º en el orden de llenado).',
        kv: [
          ['Tipo entrega', r._cdcli ? pill('CD-Cliente', 'purple') : pill('Consolidable', 'info'), true],
          ['Tipo', r._pv ? 'Pedido de venta' : 'Stock'], ['Fecha entrega SAP', r.fe_entrega],
          ['Material', r.material], ['Cantidad pendiente', r._ctd_pend],
          ['Toneladas', tonHtml(r._ton_num), true], ['Almacén destino', r.alm],
          r._pv ? ['N° pedido de venta', r.documento] : null, r._pv ? ['Tipo de expedición', r._tipo_exp] : null,
          r._pv ? ['Ruta · comuna', [r._ruta, r._comuna].filter(Boolean).join(' · ')] : null,
          r._pv ? ['Cliente', r._cliente] : null, r._pv ? ['Vendedor', r._vendedor] : null,
          c ? ['Fecha coordinada', fmtFechaISO(c.fecha_entrega)] : null, c ? ['N° de entrega', c.n_entrega] : null,
          c ? ['Entrega en', [c.direccion, c.comuna].filter(Boolean).join(', ')] : null, c ? ['Teléfono cliente', c.telefono] : null,
          c ? ['Transporte', [c.id_transporte, c.transportista].filter(Boolean).join(' · ')] : null,
          c ? ['Chofer', [c.chofer_nombre, c.chofer_rut, c.chofer_telefono].filter(Boolean).join(' · ')] : null,
          c ? ['Patentes', `Camión ${c.patente_camion || '—'}${c.patente_carro ? ' · Carro ' + c.patente_carro : ''}`] : null,
        ],
        nota: r._cdcli ? 'Camión directo CD-Cliente' : '4º en el orden de llenado',
        acciones,
      };
    },
  },

  // ── PEDIDOS DE TRASLADOS ──────────────────────────────────────────────────
  pedidos_traslados: {
    titulo: 'Pedidos de Traslados',
    desc: 'Pedidos de traslados desde centros de distribución a sucursales',
    origen: { of: r => r.cesu, opciones: ORIGENES_CD },
    async preload() { return { estadoPlan: await estadoPlanTraslados() }; },
    enrich(rows, ctx) {
      rows.forEach(r => { r._al = alertaV2(r.fecha_confirmada, 7); r._pr = PRIO_V2[r._prioridad_grupo] || PRIO_V2.E; r._q = grupoQuiebre(r._sd); });
      ctx._rows = rows;
      aplicarEstadoPlanTraslados(rows, ctx.estadoPlan);
    },
    // Tras excluir/reactivar/incluir: recalcula el plan y el estado de cada línea.
    async onPlanChange(rows, ctx) { ctx.estadoPlan = await estadoPlanTraslados(); aplicarEstadoPlanTraslados(rows, ctx.estadoPlan); },
    chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    docSearch: { ph: 'N° pedido de traslado', of: r => r.doc_compr },
    fecha: { label: 'Entrega', of: r => r.fecha_confirmada },
    search: { ph: 'Buscar material', of: r => `${r.material} ${r.texto_breve}` },
    kpis: [
      { key: 'all', label: 'Líneas', color: C_INK, sub: 'pendientes' },
      { key: 'plan', label: 'En plan de carga', color: C_GREEN, sub: 'van en el camión CD hoy', fn: r => !!r._en_plan },
      { key: 'B', label: 'Usuario', color: C_RED, sub: 'pedido manual', fn: r => r._prioridad_grupo === 'B' },
      { key: 'C', label: 'ABC AA', color: C_ORANGE, sub: 'clasificación AA', fn: r => r._prioridad_grupo === 'C' },
      { key: 'D', label: 'Quiebre', color: C_YELLOW, sub: '≤7 días de stock', fn: r => r._prioridad_grupo === 'D' },
      { key: 'E', label: 'Abastecimiento', color: C_GREY, sub: 'reposición normal', fn: r => r._prioridad_grupo === 'E' },
      { key: 'at', label: 'Atrasadas', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
    ],
    cols: [
      { label: 'Pedido', html: r => mono(r.doc_compr) },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Material', html: r => matHtml(r.material, r.texto_breve) },
      { label: 'ABC', html: r => mono(r._clasificacion_abc === 'SIN CLASIFICACIÓN' ? '' : r._clasificacion_abc) },
      // (4-oct-2026, Jordan) Prioridad pasa al detalle; en la fila va la cantidad.
      { label: 'Cantidad', al: 'r', html: r => mono(fmtNum(parseNum(r.ctd_confirmada ?? r.ctd_pedido), 1)) },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r.fecha_confirmada) },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) },
    ],
    // (4-oct-2026, Jordan) Columna Plan de Carga con Excluir/Reactivar en la fila.
    // Pueden modificarla OWNER y Planner Abastecimiento.
    rowId: r => `${r.doc_compr}|${String(r.pos ?? '').trim() || r.material}`,
    excluirEnFila: true,
    permisoExcluir: 'ajustar_plan',
    planEstado: (r, excluida) => { if (excluida) return pill('Excluida hoy', 'bad'); const p = PLAN_LINEA_V2[r._plan] || PLAN_LINEA_V2.FUERA; return pill(p[0], p[1]) + (r._plan_inc ? ` ${pill('Manual', 'purple')}` : ''); },
    edge: r => r._en_plan ? C_GREEN : (r._al.k === 'Atrasado' ? C_RED : null),
    note: 'Borde verde: línea que va en el camión CD del plan de hoy · Usuario, AA y Quiebre van en «Quiebre y priorizado» (5º); el resto en «Abastecimiento» (6º)',
    minW: '1080px',
    detalle: r => {
      const p = PLAN_LINEA_V2[r._plan] || PLAN_LINEA_V2.FUERA;
      const c = r._plan_centro;
      const expl = {
        EN_CAMION: 'Va en el camión CD del plan de hoy.',
        CAMION2: 'Va en el 2º camión (aceptado).',
        CAMION2_PROP: 'No cabe en el camión CD; iría en el 2º camión propuesto (falta aceptarlo en el Plan de Carga).',
        NO_CABE: 'Está en la ventana del plan pero no cabe en el camión: queda para el próximo plan.',
        EXCLUIDO: 'Excluida hoy del Plan de Carga.',
        FUERA: 'No entra al plan: fuera de la ventana de fechas (−10/+7 días hábiles) o sin cantidad confirmada.',
      }[r._plan] || '';
      const puede = can('incluir_plan');
      const recalcular = async (row, ctx) => { await V2.pedidos_traslados.onPlanChange(ctx._rows, ctx); return { redibujar: true }; };
      const acciones = !puede ? [] : r._plan_inc ? [
        { label: 'Quitar inclusión manual', icon: 'undo', run: async (row, ctx) => {
          if (!await confirmar(`¿Quitar la inclusión manual del material ${row.material} (pedido ${row.doc_compr})?\n\nVuelve a la prioridad automática.`)) return null;
          if (!(await quitarInclusionPlan(row.doc_compr, row.material))) return null;
          showAlert('Inclusión manual quitada', 'success'); return recalcular(row, ctx);
        } },
      ] : (!r._en_plan && r._plan !== 'EXCLUIDO') ? [
        { label: 'Incluir en plan de carga', icon: 'playlist_add', primary: true, run: async (row, ctx) => {
          if (!await confirmar(`¿Incluir hoy en el Plan de Carga el material ${row.material} del pedido ${row.doc_compr}?\n\nEntra al camión CD antes que el resto de los traslados y puede dejar fuera otras líneas. Vale sólo para el plan de hoy.`)) return null;
          if (!(await incluirEnPlan(row.doc_compr, row.material))) return null;
          showAlert('Línea incluida en el Plan de Carga', 'success'); return recalcular(row, ctx);
        } },
      ] : [];
      return {
      kind: 'Pedido de traslado · origen ' + r.cesu, title: r.doc_compr,
      aviso: `<b>Plan de carga:</b> ${escV2(p[0])}${r._plan_inc ? ' (incluida manual)' : ''}. ${escV2(expl)}${c ? ` Camión CD ${escV2(nombreCentro(r.ce) || r.ce)}: ${escV2(fmtNum(c.total, 1))} t · ${escV2(c.pct)}% · ${escV2(c.status)}.` : ''}`,
      sub: `${nombreCentro(r.cesu) || r.cesu} → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
      kv: [
        ['Prioridad', pill(r._pr.lbl, r._pr.tone), true], ['Motivo prioridad', r._motivo_prio],
        ['Clase ABC', r._clasificacion_abc], ['Días de stock', r._sd == null ? 'Sin dato en SLIM' : `${r._sd} · ${r._q.lbl}`],
        ['Creado por', r._usuario], ['Fecha creación', r.creado_el],
        ['Material', r.material], ['Cantidad confirmada', fmtNum(parseNum(r.ctd_confirmada ?? r.ctd_pedido), 1)],
        ['Cantidad pedido', fmtNum(parseNum(r.ctd_pedido), 1)],
        ['Toneladas', tonHtml(r._ton_num), true], ['Fecha entrega', r.fecha_confirmada],
        ['Almacén destino', r.alm], ['Alerta', pill(r._al.k, r._al.tone), true],
        r.documento ? ['Pedido de venta', r.documento] : null,
      ],
      nota: r._plan_inc ? 'Incluida manual: entra antes que el resto de los traslados' : (r._prioridad_bucket === 'prioridad' ? '5º en el orden de llenado (quiebre y priorizado)' : '6º en el orden de llenado (abastecimiento)'),
      acciones,
      };
    },
  },

  // ── ENTREGAS CREADAS ──────────────────────────────────────────────────────
  entregas_creadas: {
    titulo: 'Entregas Creadas',
    desc: 'Entregas creadas en SAP y su comparación con la foto del Plan de Carga (15:35 del día hábil anterior).',
    enrich(rows) {
      rows.forEach(r => {
        r._est = ESTADO_PLAN_V2[r.estado_plan] || [r.estado_plan || '—', 'mute'];
        r._comuna = lookupRuta(r.ruta).comuna || '';
      });
    },
    chip: { label: 'Centro exp.', of: r => String(r.centro_fisico ?? '').trim(), name: v => nombreCentro(v) ? `${nombreCentro(v)}` : v },
    search: { ph: 'Buscar entrega, material o documento', of: r => `${r.entrega} ${r.material} ${r.descripcion} ${r.doc_modelo}` },
    fecha: { label: 'Creación', of: r => r.fecha_creacion },
    kpis: [
      { key: 'all', label: 'Todas', color: C_INK, sub: 'entregas en el rango' },
      { key: 'CUADRA', label: 'Cuadra', color: C_GREEN, sub: 'igual a lo planificado', fn: r => r.estado_plan === 'CUADRA' },
      { key: 'PARCIAL', label: 'Parcial', color: C_YELLOW, sub: 'menos que el plan', fn: r => r.estado_plan === 'PARCIAL' },
      { key: 'EXCEDE', label: 'Excede', color: C_RED, sub: 'más que el plan', fn: r => r.estado_plan === 'EXCEDE' },
      { key: 'SIN PLAN', label: 'Sin plan', color: C_GREY, sub: 'no estaba en la foto 15:35', fn: r => r.estado_plan === 'SIN PLAN' },
    ],
    cols: [
      { label: 'N° entrega', html: r => mono(r.entrega, r.fecha_creacion ? fmtFechaISO(r.fecha_creacion) : '') },
      { label: 'Ruta', html: r => mono(r.ruta, r._comuna) },
      { label: 'Tipo', html: r => mono(r.clent) },
      { label: 'Almacén · exp.', html: r => mono(`${r.almacen || ''}${r.almacen_inferido ? '*' : ''}`, r.centro_fisico ? 'desde ' + r.centro_fisico : '') },
      { label: 'Material', html: r => matHtml(r.material, r.descripcion) },
      { label: 'Cant. entrega', al: 'r', html: r => `<span class="sv-b">${escV2(fmtNum(Number(r.cantidad) || 0, 0))}</span>` },
      { label: 'Doc. precedente', html: r => mono(r.doc_modelo) },
      { label: 'Plan vs Σ entregas', al: 'r', html: r => r.cant_plan == null ? '<span class="sv-muted">—</span>'
          : `${escV2(fmtNum(Number(r.cant_entregas_doc) || 0, 0))} / ${escV2(fmtNum(Number(r.cant_plan) || 0, 0))}<div class="sv-sub" style="text-align:right">${Number(r.cant_plan) ? Math.round((Number(r.cant_entregas_doc) || 0) / Number(r.cant_plan) * 100) + '% del plan' : ''}</div>` },
      { label: 'Estado plan', html: r => pill(r._est[0], r._est[1]) },
    ],
    edge: r => r.estado_plan === 'EXCEDE' ? C_RED : null,
    note: '* almacén inferido (EL→4000, ZV01/03/04→2000, resto→3000)',
    minW: '1150px',
    detalle: r => ({
      kind: 'Entrega', title: r.entrega, sub: `${r.descripcion || ''}${r._comuna ? ' · ' + r._comuna : ''}`,
      kv: [
        ['Tipo entrega', r.clent], ['Tipo expedición', r.ce],
        ['Almacén', `${r.almacen || ''}${r.almacen_inferido ? ' (inferido)' : ''}`], ['Centro expedición', r.centro_fisico],
        ['Ruta', `${r.ruta || ''}${r._comuna ? ' · ' + r._comuna : ''}`], ['Fecha creación', fmtFechaISO(r.fecha_creacion)],
        ['Material', r.material], ['Cantidad', `${fmtNum(Number(r.cantidad) || 0, 0)} ${r.um || ''}`.trim()],
        ['Doc. precedente', r.doc_modelo], ['Estado plan', pill(r._est[0], r._est[1]), true],
        ['Cant. plan', r.cant_plan == null ? '—' : fmtNum(Number(r.cant_plan), 0)], ['Σ entregas del doc.', fmtNum(Number(r.cant_entregas_doc) || 0, 0)],
        ['Foto del plan', r.fecha_plan ? fmtFechaISO(r.fecha_plan) + ' · 15:35' : '—'], ['Creado por', r.creado_por],
      ],
      nota: 'Plan vs Σ entregas: suma de entregas del documento + material',
    }),
  },

  // ── DOCUMENTOS DE TRANSPORTE ──────────────────────────────────────────────
  documentos_transporte: {
    titulo: 'Documentos de Transporte',
    desc: 'Camiones despachados (DT de SAP) y su consolidación: toneladas cargadas sobre la capacidad del camión (GeEs).',
    enrich(rows) {
      rows.forEach(r => {
        const items = r._detalle || [];
        r._tonN = items.reduce((s, i) => s + (Number(i.ton_linea) || 0), 0);
        r._capN = Number(r._capacidad) || 0;
        r._pctN = r._capN > 0 ? Math.min(100, r._tonN / r._capN * 100) : null;
        r._sinPeso = items.filter(i => i.sin_peso).length;
        r._est = r._pctN == null ? { k: 'sin', lbl: 'Sin capacidad', tone: 'mute' }
          : r._pctN >= 80 ? { k: 'ok', lbl: 'Consolidado', tone: 'ok' }
          : r._pctN >= 70 ? { k: 'warn', lbl: 'Revisar', tone: 'warn' } : { k: 'low', lbl: 'Bajo 70%', tone: 'mute' };
        r._lectura = maxCargadoEn(items);
        r._comuna = lookupRuta(r.ruta).comuna || '';
      });
    },
    chip: { label: 'Tipo despacho', of: r => r.denominacion || '' },
    search: { ph: 'Buscar DT, transportista, ruta o destino', of: r => `${r.transporte} ${r.nombre_transportista} ${r.ruta} ${r.sucursal_destino}` },
    fecha: { label: 'Creación', of: r => r.fecha_creacion },
    kpis: [
      { key: 'all', label: 'Camiones', color: C_INK, sub: 'documentos de transporte' },
      { key: 'ok', label: 'Consolidados', color: C_GREEN, sub: '≥80% de capacidad', fn: r => r._est.k === 'ok' },
      { key: 'warn', label: 'Revisar', color: C_YELLOW, sub: '70–80%', fn: r => r._est.k === 'warn' },
      { key: 'low', label: 'Bajo 70%', color: C_GREY, sub: 'capacidad desaprovechada', fn: r => r._est.k === 'low' },
      { key: 'sin', label: 'Sin capacidad', color: '#e1e3e4', sub: 'no se puede medir el %', fn: r => r._est.k === 'sin' },
    ],
    cols: [
      { label: 'DT', html: r => mono(r.transporte, [r.nombre_transportista, r._lectura ? 'lectura ' + new Date(r._lectura).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }) : ''].filter(Boolean).join(' · ')) },
      { label: 'Destino', html: r => `${txt(r.sucursal_destino || '—', '', true)}<div class="sv-tags">${pill(r.denominacion, 'mute')}${r.ruta ? `<span class="sv-tag mute">${escV2(r.ruta)}${r._comuna ? ' · ' + escV2(r._comuna) : ''}</span>` : ''}<span class="sv-tag mute">desde ${escV2(r.ptrp)}</span></div>` },
      { label: 'Entregas', al: 'r', html: r => `<span class="sv-b">${escV2(r._num_entregas)}</span>` },
      { label: 'Camión', html: r => r._capN > 0
          ? `<div style="display:flex;align-items:center;gap:12px">${truckGauge([{ ton: Math.min(r._tonN, r._capN), color: colorUmbral(r._pctN), label: 'Cargado' }], r._capN, { w: 110, h: 24 })}<div style="text-align:right"><b>${Math.round(r._pctN)}%</b><div class="sv-sub">${fmtNum(r._tonN, 1)} / ${fmtNum(r._capN, 0)} t</div></div></div>`
          : `<span class="sv-b">${fmtNum(r._tonN, 1)} t</span><div class="sv-sub">sin capacidad (GeEs)</div>` },
      { label: 'Estado', html: r => pill(r._est.lbl, r._est.tone) + (r._sinPeso ? `<div class="sv-sub">${r._sinPeso} línea${r._sinPeso === 1 ? '' : 's'} sin peso</div>` : '') },
    ],
    edge: r => r._est.k === 'low' ? C_GREY : null,
    note: 'Consolidación = Σ máx(ton bruto, ton vol) / capacidad GeEs, tope 100%',
    minW: '1000px',
    detalle: r => ({
      kind: 'Documento de transporte', title: r.transporte,
      sub: `${r.ptrp} → ${r.sucursal_destino || '—'} · ${r.nombre_transportista || ''}`,
      kv: [
        ['Tipo despacho', r.denominacion], ['Ruta', `${r.ruta || ''}${r._comuna ? ' · ' + r._comuna : ''}`],
        ['Capacidad', r._capN ? `${fmtNum(r._capN, 0)} t` : 'Sin capacidad'], ['Cargado', `${fmtNum(r._tonN, 2)} t${r._pctN != null ? ' · ' + Math.round(r._pctN) + '%' : ''}`],
        ['Espacio libre', r._capN ? `${fmtNum(Math.max(0, r._capN - r._tonN), 1)} t` : '—'], ['Estado', pill(r._est.lbl, r._est.tone), true],
        ['Transportista', r.nombre_transportista], ['Fecha creación', fmtFechaISO(r.fecha_creacion)],
        ['Entregas', r._num_entregas], ['Última lectura', r._lectura ? horaChile(r._lectura) : ''],
      ],
      tabla: {
        titulo: `${(r._detalle || []).length} líneas`,
        head: [['Entrega'], ['Destino'], ['Material'], ['Cant.', 'r'], ['Ton', 'r']],
        rows: (r._detalle || []).map(d => [mono(d.entrega), escV2(d.sucursal_destino || ''), mono(d.material, d.descripcion), `${escV2(d.cantidad ?? '')} <span class="sv-muted">${escV2(d.um || '')}</span>`,
          d.sin_peso ? '<span class="sv-muted">sin peso</span>' : `<span class="sv-ton">${tonHtml(Number(d.ton_linea) || 0)}</span>`]),
      },
      nota: 'Lecturas 08:10 / 16:30 / cierre 23:00',
    }),
  },
};
// ── SEGUIMIENTO DE CARGA (4-oct-2026, Jordan) ─────────────────────────────
// (5-oct-2026, Jordan) Agrupación por centro destino: fila principal con fecha de plan, fecha de
// carga, centro destino, toneladas, cantidad de SKU y transportistas; detalle con camiones,
// pedidos y SKU (nombre y cantidades).
const ORDEN_CAM_SEG = t => t === 'Camión CD' ? 0 : t === '2º camión' ? 1 : 2;
function agruparSeguimiento(rows) {
  const ordL = (a, b) => ORDEN_CAM_SEG(a.tipo_camion) - ORDEN_CAM_SEG(b.tipo_camion) || String(a.clave).localeCompare(String(b.clave))
    || String(a.documento || '').localeCompare(String(b.documento || '')) || String(a.material || '').localeCompare(String(b.material || ''));
  // Coordinaciones (COORD|…): se ocultan las líneas cuyo documento ya va en un camión programado del plan,
  // y las de un mismo camión (misma patente, tipo y fecha de carga) se juntan en uno.
  const esCoord = r => String(r.clave || '').startsWith('COORD|');
  const docsPlan = new Set(rows.filter(r => !esCoord(r)).map(r => String(r.documento ?? '').trim()).filter(Boolean));
  rows = rows.filter(r => !esCoord(r) || !docsPlan.has(String(r.documento ?? '').trim()));
  const grupos = new Map();
  rows.forEach(r => {
    const ce = String(r.ce ?? '').trim();
    const k = `${r.fecha_plan}|${String(r.cd_origen ?? '').trim()}|${ce}`;
    if (!grupos.has(k)) grupos.set(k, { id: k, fecha_plan: r.fecha_plan, cd_origen: r.cd_origen, origen: r.origen, ce, _lineas: [], _cams: new Map() });
    const g = grupos.get(k);
    g._lineas.push(r);
    const co = esCoord(r), pat = normPatente(r.patente_camion);
    const kc = co ? `C|${r.tipo_camion}|${pat ? 'P|' + pat + '|' + r.fecha_carga : r.clave}` : `${r.tipo_camion}|${r.clave}`;
    if (!g._cams.has(kc)) g._cams.set(kc, { tipo: r.tipo_camion, clave: r.clave, coord: co, dir: !['Camión CD', '2º camión'].includes(r.tipo_camion),
      fecha_carga: r.fecha_carga, destino: r.destino, origen: r.origen, id_transporte: r.id_transporte, transportista: r.transportista,
      chofer_nombre: r.chofer_nombre, chofer_rut: r.chofer_rut, chofer_telefono: r.chofer_telefono, patente_camion: r.patente_camion, patente_carro: r.patente_carro,
      ton_camion: Number(r.ton_camion) || 0, pct: r.pct_camion, cap: Number(r.cap) || 0, programado_por: r.programado_por, programado_en: r.programado_en, lineas: [] });
    g._cams.get(kc).lineas.push(r);
  });
  return [...grupos.values()].map(g => {
    g._lineas.sort(ordL);
    g.camiones = [...g._cams.values()].sort((a, b) => ORDEN_CAM_SEG(a.tipo) - ORDEN_CAM_SEG(b.tipo) || String(a.clave).localeCompare(String(b.clave)));
    delete g._cams;
    g.camiones.forEach(c => { c.ton = c.lineas.reduce((s2, x) => s2 + (Number(x.ton) || 0), 0); if (c.coord) { c.cap = CAP_CAMION_DIRECTO; c.pct = Math.round(c.ton / CAP_CAMION_DIRECTO * 100); } c.nSku = new Set(c.lineas.map(x => String(x.material ?? '').trim()).filter(Boolean)).size; });
    const fechas = [...new Set(g.camiones.map(c => c.fecha_carga).filter(Boolean))].sort();
    g.fecha_carga = fechas[0] || '';
    g._fechasCarga = fechas;
    g.ton = g._lineas.reduce((s2, x) => s2 + (Number(x.ton) || 0), 0);
    g.n_sku = new Set(g._lineas.map(x => String(x.material ?? '').trim()).filter(Boolean)).size;
    g.n_pedidos = new Set(g._lineas.map(x => String(x.documento ?? '').trim()).filter(Boolean)).size;
    g.n_lineas = g._lineas.length;
    g.tipos_carga = [...new Set(g._lineas.map(x => x.tipo_carga).filter(Boolean))];
    return g;
  }).sort((a, b) => String(b.fecha_plan || '').localeCompare(String(a.fecha_plan || '')) || String(a.ce).localeCompare(String(b.ce)));
}
// Foto de cada camión programado (camión CD, 2º camión y directos con transporte):
// una fila por línea cargada, con su camión y transportista.
VISTAS_TRONCAL.seguimiento_carga = {
  titulo: 'GESTIÓN TRONCALES – SEGUIMIENTO DE CARGA',
  vista: 'v_abast_seguimiento_carga',
  centroCampo: 'ce',
  // (5-oct-2026, Jordan) Una fila por CENTRO DESTINO (y fecha de plan / CD origen); el detalle
  // despliega cada camión con sus pedidos y SKU. El CSV se mantiene a nivel de línea.
  transform: rows => agruparSeguimiento(rows),
  csvFilas: grupos => grupos.flatMap(g => g._lineas),
  columnas: [
    { key: 'fecha_plan', label: 'Fecha Planificación' }, { key: 'fecha_carga', label: 'Fecha Carga' },
    { key: 'origen', label: 'Origen' }, { key: 'destino', label: 'Destino' }, { key: 'tipo_camion', label: 'Camión' },
    { key: 'tipo_carga', label: 'Tipo de Carga' }, { key: 'documento', label: 'Pedido de Traslado / OC' }, { key: 'n_entrega', label: 'N° Entrega' },
    { key: 'material', label: 'SKU' }, { key: 'nombre', label: 'Nombre Material' },
    { key: 'cantidad', label: 'Cantidad', valueFn: r => fmtNum(Number(r.cantidad) || 0, 1) },
    { key: 'ton', label: 'Ton', valueFn: r => fmtNum(Number(r.ton) || 0, 4) },
    { key: 'ton_bruta', label: 'Ton Bruta', valueFn: r => r.ton_bruta == null ? '' : fmtNum(Number(r.ton_bruta), 4) },
    { key: 'pct_camion', label: '% Carga Camión', valueFn: r => r.pct_camion == null ? '' : r.pct_camion + '%' },
    { key: 'pedido_venta', label: 'Pedido de Venta' }, { key: 'ruta', label: 'Ruta' }, { key: 'comuna', label: 'Comuna' },
    { key: 'proveedor', label: 'Proveedor' }, { key: 'cliente', label: 'Cliente' },
    { key: 'id_transporte', label: 'ID Transporte' }, { key: 'transportista', label: 'Transportista' },
    { key: 'chofer_nombre', label: 'Chofer' }, { key: 'chofer_rut', label: 'RUT Chofer' }, { key: 'chofer_telefono', label: 'Teléfono' },
    { key: 'patente_camion', label: 'Patente Camión' }, { key: 'patente_carro', label: 'Patente Carro' },
    { key: 'programado_por', label: 'Programado por' },
  ],
};
// Etiqueta por tipo de camión en Seguimiento de Carga (5-oct-2026, Jordan)
const SEG_TONO = { 'Camión CD': 'ok', '2º camión': 'info', 'CD-Cliente': 'purple', 'Fáb-Cliente': 'purple', 'Fáb-Sucursal': 'info', 'Retiro FAB-CD': 'orange' };
const segPill = c => pill(c.tipo, SEG_TONO[c.tipo] || 'warn') + (c.coord ? ' ' + pill(c.patente_camion ? 'Coordinado' : 'Coordinado · patente pendiente', 'mute') : '');
V2.seguimiento_carga = {
  titulo: 'Seguimiento de Carga',
  desc: 'Camiones programados agrupados por centro destino: qué se carga (pedidos y SKU), cuándo y con qué transportista.',
  enrich(rows) {
    rows.forEach(r => {
      r._nombreCe = nombreCentro(r.ce) || r.ce;
      r._hasCD = r.camiones.some(c => c.tipo === 'Camión CD');
      r._has2 = r.camiones.some(c => c.tipo === '2º camión');
      r._hasDir = r.camiones.some(c => c.dir);
      r._hasCoord = r.camiones.some(c => c.coord);
    });
  },
  rowId: r => r.id,
  chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
  docSearch: { ph: 'Pedido / OC / entrega', of: r => r._lineas.map(x => `${x.documento || ''} ${x.n_entrega || ''} ${x.pedido_venta || ''}`).join(' ') },
  fecha: { label: 'Carga', of: r => r.fecha_carga },
  search: { ph: 'Buscar SKU, material, patente, transportista o tipo', of: r => r._nombreCe + ' ' + r.camiones.map(c => `${c.tipo} ${c.coord ? 'coordinado' : ''} ${c.patente_camion} ${c.transportista} ${c.id_transporte} ${c.chofer_nombre}`).join(' ')
    + ' ' + r._lineas.map(x => `${x.material} ${x.nombre} ${x.proveedor} ${x.cliente}`).join(' ') },
  kpis: [
    { key: 'all', label: 'Centros destino', color: C_INK, sub: 'con camiones programados' },
    { key: 'cd', label: 'Con camión CD', color: C_GREEN, sub: 'consolidado', fn: r => r._hasCD },
    { key: 'seg', label: 'Con 2º camión', color: C_BLUE, sub: 'aceptado y programado', fn: r => r._has2 },
    { key: 'dir', label: 'Con directos', color: C_ORANGE, sub: 'CD-Cliente / fábrica / retiros', fn: r => r._hasDir },
    { key: 'coord', label: 'Coordinados', color: '#7e22ce', sub: 'directos coordinados aún no programados', fn: r => r._hasCoord },
  ],
  cols: [
    { label: 'Fecha plan', html: r => mono(fmtFechaISO(r.fecha_plan), r.origen ? 'desde ' + r.origen : '') },
    { label: 'Fecha carga', html: r => mono(fmtFechaISO(r.fecha_carga), r._fechasCarga.length > 1 ? `+ ${r._fechasCarga.slice(1).map(fmtFechaISO).join(', ')}` : '') },
    { label: 'Centro destino', html: r => txt(r._nombreCe, r.ce, true) },
    { label: 'Camiones', html: r => r.camiones.map(c => `<div style="white-space:nowrap;margin:1px 0">${segPill(c)}</div>`).join('') },
    { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r.ton)}</span>` },
    { label: 'SKU', al: 'r', html: r => mono(fmtNum(r.n_sku, 0), `${fmtNum(r.n_pedidos, 0)} ${r.n_pedidos === 1 ? 'pedido' : 'pedidos'}`) },
    { label: 'Transportista', html: r => r.camiones.map(c => `<div style="white-space:nowrap"><b>${escV2(c.transportista || c.id_transporte || '—')}</b>${c.patente_camion ? ` <span class="sv-mono">${escV2(c.patente_camion)}</span>` : ''}`
        + `<div class="sv-sub" style="margin:0">${escV2([c.id_transporte, c.chofer_nombre ? 'Chofer ' + c.chofer_nombre : '', c.chofer_telefono].filter(Boolean).join(' · '))}</div></div>`).join('') },
  ],
  edge: r => r._hasDir ? C_ORANGE : C_GREEN,
  note: 'Camiones CD / 2º: al programarlos (hasta el cierre 15:35) · Directos (CD-Cliente, Fáb-Cliente, Fáb-Sucursal, Retiro FAB-CD): al coordinarlos · clic en una fila para ver pedidos y SKU',
  minW: '1150px',
  detalle: r => ({
    kind: 'Seguimiento de carga · centro destino', title: `${r.ce} ${r._nombreCe !== r.ce ? r._nombreCe : ''}`.trim(),
    sub: `${r.origen || ''} · plan ${fmtFechaISO(r.fecha_plan)} · carga ${r._fechasCarga.map(fmtFechaISO).join(', ') || '—'}`,
    kv: [
      ['Fecha planificación', fmtFechaISO(r.fecha_plan)], ['Fecha carga', r._fechasCarga.map(fmtFechaISO).join(', ') || '—'],
      ['Toneladas', tonHtml(r.ton), true], ['Cantidad de SKU', fmtNum(r.n_sku, 0)],
      ['Pedidos / OC', fmtNum(r.n_pedidos, 0)], ['Líneas', fmtNum(r.n_lineas, 0)],
      ['Camiones', r.camiones.map(segPill).join(' '), true], ['Tipos de carga', r.tipos_carga.join(', ') || '—'],
    ],
    tablas: r.camiones.map(c => {
      let prev = null;
      const rows = c.lineas.map(x => {
        const doc = String(x.documento ?? '').trim();
        const nuevo = doc !== prev; prev = doc;
        const sub = x.n_entrega ? 'Entrega ' + x.n_entrega : (x.pedido_venta && x.pedido_venta !== doc ? 'PV ' + x.pedido_venta : '');
        return [
          nuevo ? `<b class="sv-mono">${escV2(doc || '—')}</b>${sub ? `<div class="sv-sub" style="margin:0">${escV2(sub)}</div>` : ''}` : '',
          nuevo ? escV2(x.tipo_carga || '') : '',
          `<span class="sv-mono">${escV2(x.material || '')}</span>`,
          escV2(x.nombre || ''),
          fmtNum(Number(x.cantidad) || 0, 1),
          fmtNum(Number(x.ton) || 0, 2),
        ];
      });
      return {
        titulo: `${c.tipo}${c.coord ? ' (coordinado)' : ''}${c.patente_camion ? ' · ' + c.patente_camion : ''}${c.patente_carro ? ' / carro ' + c.patente_carro : ''} — ${fmtNum(c.ton, 1)} t${c.pct != null ? ` (${c.pct}%)` : ''} · ${c.nSku} SKU`,
        sub: [[c.id_transporte, c.transportista].filter(Boolean).join(' · '), [c.chofer_nombre, c.chofer_rut, c.chofer_telefono].filter(Boolean).join(' · '),
          c.dir && c.destino ? c.destino : '', c.fecha_carga && c.fecha_carga !== r.fecha_carga ? 'carga ' + fmtFechaISO(c.fecha_carga) : '',
          c.programado_por ? 'programado por ' + c.programado_por : ''].filter(Boolean).join(' — '),
        head: [['Pedido / OC'], ['Tipo de carga'], ['SKU'], ['Nombre'], ['Cantidad', 'r'], ['Ton', 'r']],
        rows,
      };
    }),
  }),
};

// Enganchar la presentación v2 a cada vista (los modos de Stock 4000 llevan sus columnas)
Object.entries(V2).forEach(([k, v]) => {
  const cfg = VISTAS_TRONCAL[k];
  if (!cfg) return;
  cfg.v2 = v;
  if (cfg.modes && v.modos) cfg.modes.forEach(m => { const mv = v.modos[m.id]; if (mv) { m.v2mode = { cols: mv.cols }; m.v2label = mv.v2label; m.icon = mv.icon; } });
});

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
  else if (currentSub === 'ind_plan_carga') {  // dashboard ejecutivo (27-sep-2026)
    const m = await import('./ind-plan-carga.js?v=202610071243');
    await m.renderIndPlanCarga(stage, { renderDetalle: (el, idx) => renderVistaTabla(el, VISTAS_TRONCAL.ind_plan_carga, idx) });
  }
  else if (VISTAS_TRONCAL[currentSub]?.v2)   await renderTablaV2(stage, VISTAS_TRONCAL[currentSub], V2_DEPS, currentSub);
  else if (VISTAS_TRONCAL[currentSub])       await renderVistaTabla(stage, VISTAS_TRONCAL[currentSub]);
  else                                       await renderProveedores(stage);
}

// Caché en memoria de filas crudas por vista (evita recargar al cambiar de
// pestaña o al reusar la misma vista en el Plan de Carga).
const _rawCache = new Map();       // vista -> { rows, ts }
const RAW_TTL = 120000;            // 2 minutos
function clearRawCache() { _rawCache.clear(); }

async function fetchAllRows(vista, force = false) {
  const cached = _rawCache.get(vista);
  if (!force && cached && (Date.now() - cached.ts) < RAW_TTL) return cached.rows;

  const pageSize = 1000;
  // 1) Total de filas (HEAD, sin traer datos) para paginar en paralelo.
  //    OJO: si el count falla o vuelve null (pasa con vistas DISTINCT ON /
  //    RLS), NO hay que asumir que todo cabe en 1 pagina: eso trunca en
  //    silencio a 1000 filas y descarta el resto sin error visible. Por eso
  //    el paso 3 (barrido de seguridad) valida esto siempre.
  let total = 0;
  try {
    const { count, error } = await supabase.from(vista).select('*', { count: 'exact', head: true });
    if (!error && typeof count === 'number') total = count;
  } catch { total = 0; }

  let rows = [];
  if (total > pageSize) {
    // 2) Traer todas las paginas EN PARALELO (mucho mas rapido que secuencial)
    const pages = Math.min(Math.ceil(total / pageSize), 100);
    const reqs = [];
    for (let p = 0; p < pages; p++) {
      reqs.push(supabase.from(vista).select('*').range(p * pageSize, p * pageSize + pageSize - 1));
    }
    const results = await Promise.all(reqs);
    for (const { data, error } of results) {
      if (error) { console.error(error); continue; }
      if (data) rows = rows.concat(data);
    }
  } else {
    const { data, error } = await supabase.from(vista).select('*').range(0, pageSize - 1);
    if (error) { console.error(error); showAlert('Error al cargar datos: ' + error.message, 'error'); return cached ? cached.rows : []; }
    rows = data || [];
  }

  // 3) Barrido de seguridad: si el count del paso 1 fue erroneo/menor al
  //    real (o fallo y quedo en 0), la ultima pagina recibida viene COMPLETA
  //    (exactamente pageSize filas). En ese caso puede haber mas datos
  //    detras: seguir pidiendo paginas siguientes hasta recibir una
  //    incompleta o vacia. Esto evita que un count fallido trunque el
  //    resultado en 1000 filas sin avisar (el bug que dejaba pedidos de
  //    venta reales fuera del cruce con Retiros de Fabrica).
  let nextOffset = rows.length;
  let guard = 0;
  while (rows.length > 0 && rows.length % pageSize === 0 && guard < 200) {
    const { data, error } = await supabase.from(vista).select('*').range(nextOffset, nextOffset + pageSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    nextOffset += data.length;
    guard++;
    if (data.length < pageSize) break;
  }

  _rawCache.set(vista, { rows, ts: Date.now() });
  return rows;
}

// ============================================================================
// PLAN DE CARGA — Dashboard de consolidación por sucursal
// ============================================================================
const CAP_CAMION_DEFAULT = 28;
const CAP_CAMION_REDUCIDO = 15;
const CENTROS_CAMION_REDUCIDO = ['1050', '1005'];
// (AJUSTE 30-sep-2026, Jordan) Camiones directos (CD-CLIENTE, FÁBRICA-CLIENTE, FÁBRICA-SUCURSAL):
// el % de ocupación se calcula siempre sobre el camión de 28 t.
const CAP_CAMION_DIRECTO = 28;
// Umbrales de camión completo para los camiones directos (regla 21-sep-2026,
// AJUSTE 28-sep-2026 pedido Jordan: los TRES tipos de camión directo pasan a 85%):
//  · CD-CLIENTE: pedidos de venta 1003 del MISMO cliente que suman > 85% de la capacidad.
//  · FÁBRICA-SUCURSAL / FÁBRICA-CLIENTE: OC COORDINADAS con fecha de retiro = fecha de
//    planificación que suman > 85% de la capacidad (mismo proveedor+destino / mismo cliente).
const UMBRAL_CD_CLIENTE = 0.85;
const UMBRAL_FABRICA = 0.85;
// Umbral de la promoción automática 48h → 24h del camión CD (AJUSTE 24-sep-2026).
// Se mantiene en 90%: el cambio a 85% del 28-sep aplica sólo a camiones directos.
const UMBRAL_PROMOCION_24H = 0.90;
// Condición de expedición del pedido de venta (v_trc_pedidos_ventas_ref.denominacion).
const COND_EBEMA_RETIRA_CLIENTE_RETIRA = 'EBE-RET / CLI-RET';
const COND_EBEMA_RETIRA_EBEMA_DESPACHA = 'EBE-RET / EBE-DESP';

// (30-sep-2026, Jordan) Camión CD-CLIENTE en La Calera / San Bernardo:
//  · carga < 20 t → camión de 15 t (CD-CLIENTE si supera el 85% de 15 t = 12,75 t).
//  · carga ≥ 20 t → reglas del camión de 28 t (CD-CLIENTE si supera el 85% de 28 t = 23,8 t).
// Resto de centros: camión de 28 t. `cap` = capacidad para armar el camión (15 t admite hasta 20 t).
const LIMITE_CAMION_REDUCIDO = 20;
function evalCdCliente(ce, ton) {
  const red = CENTROS_CAMION_REDUCIDO.includes(String(ce ?? '').trim());
  if (red && ton < LIMITE_CAMION_REDUCIDO) return { directo: ton > CAP_CAMION_REDUCIDO * UMBRAL_CD_CLIENTE, cap: LIMITE_CAMION_REDUCIDO, camion: CAP_CAMION_REDUCIDO };
  return { directo: ton > CAP_CAMION_DEFAULT * UMBRAL_CD_CLIENTE, cap: CAP_CAMION_DEFAULT, camion: CAP_CAMION_DEFAULT };
}
function getCapacidadCamion(centroId) {
  return CENTROS_CAMION_REDUCIDO.includes(String(centroId)) ? CAP_CAMION_REDUCIDO : CAP_CAMION_DEFAULT;
}

// (AJUSTE 28-sep-2026, pedido Jordan) Reparte las líneas de un grupo que ya
// califica como camión directo (mismo cliente / mismo proveedor) en N camiones
// de capacidad `cap`, para que el detalle muestre qué va en cada camión.
//  · Un documento (NV u OC) va completo en un mismo camión; sólo si el documento
//    supera por sí solo la capacidad se reparte por líneas.
//  · N = mínimo de camiones necesarios (ceil(ton/cap)); los documentos se asignan
//    de mayor a menor al camión menos cargado donde quepan (cargas parejas).
// Devuelve [{ items, ton }] — cada camión con sus líneas.
function armarCamiones(items, cap, docKey) {
  const EPS = 1e-9;
  if (!items || !items.length) return [];
  const porDoc = new Map();
  items.forEach(it => {
    const k = docKey(it);
    if (!porDoc.has(k)) porDoc.set(k, { items: [], ton: 0 });
    const b = porDoc.get(k); b.items.push(it); b.ton += it.ton || 0;
  });
  const bloques = [], gigantes = [];
  porDoc.forEach(b => {
    if (b.ton <= cap + EPS) { bloques.push(b); return; }
    // Documento mayor que un camión: se reparte por líneas (primer ajuste decreciente).
    const trozos = [];
    [...b.items].sort((x, y) => (y.ton || 0) - (x.ton || 0)).forEach(it => {
      let t = trozos.find(z => z.ton + (it.ton || 0) <= cap + EPS);
      if (!t) { t = { items: [], ton: 0 }; trozos.push(t); }
      t.items.push(it); t.ton += it.ton || 0;
    });
    trozos.forEach(t => (t.ton > cap + EPS ? gigantes : bloques).push(t)); // línea sola > cap ⇒ camión propio
  });
  bloques.sort((a, b) => b.ton - a.ton);
  const total = bloques.reduce((s, b) => s + b.ton, 0);
  let n = Math.max(1, Math.ceil(total / cap - EPS));
  for (;;) {
    const cams = Array.from({ length: n }, () => ({ items: [], ton: 0 }));
    let ok = true;
    for (const b of bloques) {
      const cand = cams.filter(c => c.ton + b.ton <= cap + EPS).sort((x, y) => x.ton - y.ton)[0];
      if (!cand) { ok = false; break; }
      cand.items.push(...b.items); cand.ton += b.ton;
    }
    if (ok) return cams.filter(c => c.items.length).concat(gigantes).sort((a, b) => b.ton - a.ton);
    n++;
  }
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

// COORDINADO_RM = COORDINADO_SANTIAGO (estado legado): el retiro llega a Santiago/RM, así que cuenta
// en el Plan de Carga (regla Jordan 21-sep-2026). 'coordinado_local' NO cuenta.
// (3-oct-2026) Modo de coordinación de un retiro: 'RM' (entra al plan), 'LOCAL' (no entra) o ''.
// coordinado_santiago (antiguo) = RM; coordinado_local (antiguo) = LOCAL.
function modoRetiro(e) {
  const est = (e || {}).estado;
  if (est === 'coordinado_santiago') return 'RM';
  if (est === 'coordinado_local') return 'LOCAL';
  if (est === 'coordinado') return e.tipo_local_rm === 'LOCAL' ? 'LOCAL' : 'RM';
  return '';
}
const normCond = d => String(d ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const EXPEDICIONES_OK_RETIRO = new Set(['EBE-RET / EBE-DESP', 'EBE-RET / CLI-RET']);
function esEstadoCoordinado(estado) { return estado === 'coordinado' || estado === 'coordinado_santiago'; }

// (AJUSTE 30-sep-2026, pedido Jordan) Llenado del camión CD = foto del servidor
// (fn_abast_snapshot_plan_carga): orden REVEX → Venta → Retiro → Cross → Quiebre →
// Abastecimiento (dentro de cada categoría: prioridad ABC, documento, material); una
// línea que no cabe se salta y se sigue con las siguientes. El 2º camión sólo se
// PROPONE si lo que no cabe llega al 85% de la capacidad; es opcional y sólo entra al
// plan (y a los indicadores) si se acepta antes del cierre de las 15:35.
const UMBRAL_SEGUNDO_CAMION = 0.85;
function asignarCamionesCD(r) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const doc = d => String(d.pt ?? d.oc ?? d.pv ?? '').trim();
  const mat = d => String(d.material ?? '').trim();
  const orden = [];
  // (30-sep-2026) Líneas de traslado incluidas manualmente entran antes que el resto de traslados.
  const trs = [...(r.det.quiebre || []), ...(r.det.stock || [])];
  const forz = trs.filter(d => d._forzadoPlan);
  [r.det.revex, r.det.ventaCons, r.det.retiro, r.det.cross, forz,
   (r.det.quiebre || []).filter(d => !d._forzadoPlan), (r.det.stock || []).filter(d => !d._forzadoPlan)].forEach(arr => {
    (arr || []).slice()
      .sort((a, b) => ((a._orden ?? 0) - (b._orden ?? 0)) || cmp(doc(a), doc(b)) || cmp(mat(a), mat(b)))
      .forEach(d => orden.push(d));
  });
  // (1-oct-2026) Asignación manual/confirmada (r.asig: doc|material → 1 CD, 2 2º camión, 0 no carga).
  // Primero se ubican las líneas asignadas; el resto se llena en el orden de prioridad (igual que la foto 15:35).
  const asig = r.asig || new Map();
  let acc = 0;
  orden.forEach(d => {
    const v = asig.get(`${doc(d)}|${mat(d)}`);
    d._manual = v === undefined || v === null ? null : Number(v);
    d._camion2 = false;
    d._enCamion = d._manual === 1;
    if (d._enCamion) acc += d.ton || 0;
  });
  orden.forEach(d => {
    if (d._manual !== null) return;
    if (acc + (d.ton || 0) <= r.cap + 1e-9) { d._enCamion = true; acc += d.ton || 0; }
  });
  const excedente = orden.filter(d => !d._enCamion && d._manual !== 0).reduce((s, d) => s + (d.ton || 0), 0);
  const manual2 = orden.some(d => d._manual === 2);
  const segundoPropuesto = manual2 || (excedente > 0 && excedente >= r.cap * UMBRAL_SEGUNDO_CAMION);
  let acc2 = 0;
  orden.forEach(d => { if (d._manual === 2) { d._camion2 = true; acc2 += d.ton || 0; } });
  if (segundoPropuesto) orden.forEach(d => {
    if (d._manual === null && !d._enCamion && acc2 + (d.ton || 0) <= r.cap + 1e-9) { d._camion2 = true; acc2 += d.ton || 0; }
  });
  const tonNoCarga = orden.filter(d => d._manual === 0).reduce((s, d) => s + (d.ton || 0), 0);
  return { cargado: acc, excedente, segundoPropuesto, tonSegundo: acc2, manual2, tonNoCarga, nManual: orden.filter(d => d._manual !== null).length, orden };
}

// ── Estado de cada línea de Pedidos de Traslado en el Plan de Carga (30-sep-2026) ──
// Calcula el plan de ambos CD (1003 y 1081) con la MISMA función del Plan de Carga
// (modo sólo-cálculo) y devuelve, por origen|destino|doc|material, si la línea va
// en el camión CD, en el 2º camión (propuesto/aceptado) o no cabe.
async function estadoPlanTraslados() {
  const lineas = new Map(), centros = {};
  let exclusiones = [], inclusiones = [];
  let seg = new Set();
  try {
    const { data } = await supabase.from('abast_plan_segundo_camion').select('cd_origen,ce').eq('fecha', isoLocal(hoy00()));
    seg = new Set((data || []).map(x => `${String(x.cd_origen ?? '').trim()}|${String(x.ce ?? '').trim()}`));
  } catch (_e) { /* sin 2º camión */ }
  const prev = planOrigen;
  try {
    for (const [orig] of ORIGENES_CD) {
      planOrigen = orig;
      const res = await renderPlanCarga(document.createElement('div'), { soloCalculo: true });
      if (!res) continue;
      exclusiones = res.exclusionesPlan || []; inclusiones = res.inclusionesPlan || [];
      res.resultadoTodos.forEach(r => {
        const kc = `${orig}|${r.ce}`;
        const acept = seg.has(kc);
        centros[kc] = { pct: r.pct, status: r.status, cap: r.cap, total: r.total, enCalendario: r.enCalendario, acept };
        [...(r.det.quiebre || []), ...(r.det.stock || [])].forEach(d => {
          const est = d._enCamion ? 'EN_CAMION' : d._camion2 ? (acept ? 'CAMION2' : 'CAMION2_PROP') : 'NO_CABE';
          lineas.set(`${kc}|${_keyInc(d.pt, d.material)}`, est);
        });
      });
    }
  } finally { planOrigen = prev; }
  return { lineas, centros, exclusiones, inclusiones };
}
const PLAN_LINEA_V2 = {
  EN_CAMION:    ['En camión', 'ok'],
  CAMION2:      ['2º camión', 'ok'],
  CAMION2_PROP: ['2º camión propuesto', 'warn'],
  NO_CABE:      ['No cabe', 'mute'],
  EXCLUIDO:     ['Excluida hoy', 'bad'],
  FUERA:        ['No considerada', 'mute'],
};
function aplicarEstadoPlanTraslados(rows, ep) {
  if (!ep) return;
  const incSet = new Set((ep.inclusiones || []).map(e => _keyInc(e.doc, e.material)));
  (rows || []).forEach(r => {
    const orig = String(r.cesu ?? '').trim(), ce = String(r.ce ?? '').trim();
    const kl = _keyInc(r.doc_compr, r.material);
    r._plan_inc = incSet.has(kl);
    r._plan_centro = ep.centros[`${orig}|${ce}`] || null;
    r._plan = estaExcluido(ep.exclusiones || [], 'traslados_1003', r.doc_compr, r.material) ? 'EXCLUIDO'
      : (ep.lineas.get(`${orig}|${ce}|${kl}`) || 'FUERA');
    r._en_plan = r._plan === 'EN_CAMION' || r._plan === 'CAMION2';
  });
}

let planDetalleAbierto = new Set();
let planOrigen = '1003';   // centro origen del plan de carga (1003 / 1081)
// Estado de la presentación v2 del Plan de Carga (filtros y panel lateral abiertos)
const PLAN_V2_STATE = { kpi: 'all', drawer: null, tab: 'cd', origen: null };

async function renderPlanCarga(stage, opts = {}) {
  stage.innerHTML = '<div class="text-secondary text-body-md p-md">Cargando Plan de Carga…</div>';

  const [quiebresRaw, trasladosRaw, revexRaw, retirosRaw, ventasRaw, traslados4000Raw, calendarioRows, estadosRetiro, exclusionesPlan, pvRows, feriadosRows, horizonteRows] = await Promise.all([
    fetchAllRows('v_trc_slim_stock'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados'),
    fetchAllRows('v_trc_sqvi_retiros_fabrica'),
    fetchAllRows('v_trc_sqvi_pedidos_venta_1003'),
    fetchAllRows('v_trc_sqvi_pedidos_traslados_4000'),
    fetchAllRows('abast_calendario'),
    loadEstadosRetiro(),
    loadExclusionesPlan(),
    fetchAllRows('v_trc_pedidos_ventas_ref'),
    fetchAllRows('abast_feriados'),
    fetchAllRows('abast_horizonte_centro'),
  ]);
  const [ventasDirectoManual, inclusionesPlan, asigLineas, camManuales, coordVentas, coordTraslados] = await Promise.all([loadVentasDirectoManual(), loadInclusionesPlan(), loadAsignacionLineas(), loadCamionesManuales(), loadCoordinacionesVenta(), loadCoordTraslados()]);
  // (1-oct-2026) Asignaciones manuales de líneas por origen|centro destino
  const asigMap = new Map();
  asigLineas.forEach(a => {
    const k = `${String(a.cd_origen ?? '').trim()}|${String(a.ce ?? '').trim()}`;
    if (!asigMap.has(k)) asigMap.set(k, new Map());
    asigMap.get(k).set(`${String(a.documento ?? '').trim()}|${String(a.material ?? '').trim()}`, Number(a.camion));
  });
  const incSet = new Set(inclusionesPlan.map(e => _keyInc(e.doc, e.material)));

  // Feriados administrados manualmente + horizonte de planificación (24h/48h)
  // por centro destino (tabla auxiliar de la vista Calendario Sucursales).
  const feriadosSet = new Set((feriadosRows || []).map(r => String(r.fecha ?? '').trim()).filter(Boolean));
  const horizonteMap = {};
  (horizonteRows || [])
    .filter(r => String(r.centro_origen ?? '').trim() === planOrigen)
    .forEach(r => { horizonteMap[String(r.centro_destino ?? '').trim()] = Number(r.horizonte_horas) === 48 ? 48 : 24; });
  const getHorizonte = ce => horizonteMap[ce] || 24;
  const diaHabil1 = addBusinessDays(hoy00(), 1, feriadosSet); // ventana 24h (próximo día hábil)
  const diaHabil2 = addBusinessDays(hoy00(), 2, feriadosSet); // ventana 48h (siguiente día hábil)
  // Cross-reference de Pedidos de Venta (Cliente, Vendedor, Tipo de Expedición)
  // por doc_ventas, mismo patrón usado en las vistas de Retiros y Traslados 4000.
  const pvMap = {};
  pvRows.forEach(r => {
    const k = String(r.doc_ventas ?? '').trim();
    if (k && !pvMap[k]) pvMap[k] = r;
  });

  // Info SLIM por centro (stock_days + clase ABC), usada por prioridadTraslado
  // para clasificar cada línea de Traslados 1003 (AJUSTES PRIORIZACIÓN 2026-09-18).
  const skuInfoByCentro = {};
  quiebresRaw
    .filter(r => CENTROS_QUIEBRES.includes(String(r.centro ?? '').trim()))
    .forEach(r => {
      const ce = String(r.centro).trim();
      const mat = String(r.codigo_articulo ?? '').trim();
      const sd = parseNum(r.stock_days);
      const abc = String(r.clase_abc ?? '').trim().toUpperCase();
      if (!skuInfoByCentro[ce]) skuInfoByCentro[ce] = {};
      const prev = skuInfoByCentro[ce][mat];
      if (!prev || sd < prev.sd) skuInfoByCentro[ce][mat] = { sd, abc };
    });

  // (AJUSTE) Plan de carga por CENTRO ORIGEN: sólo se consideran los pedidos de
  // traslado cuyo centro de expedición (cesu) sea el origen seleccionado (1003 o
  // 1081). Ventas 1003 y retiros sólo aplican al plan del CD 1003.
  const esCD1003 = planOrigen === '1003';
  const traslados = trasladosRaw
    .filter(r => !String(r.cesu ?? '').startsWith('*') && String(r.material ?? '').trim() !== '')
    .filter(r => !String(r.material ?? '').startsWith('900000'))
    .filter(r => String(r.cesu ?? '').trim() === planOrigen);
  // (2-oct-2026, Jordan) Revex: todos los pedidos del SQVI (sin ventana de fechas) quedan
  // disponibles por defecto para el próximo camión; sólo salen si se excluyen.
  const revex = revexRaw
    .filter(r => String(r.material ?? '').trim().startsWith('900000'))
    .filter(r => String(r.cesu ?? '').trim() === planOrigen);
  // REVEX: cesu = centro origen (1003 o 1081), ce = centro destino donde se contabiliza
  // Corte de fecha para el Plan de Carga: "mañana" (día que se está planificando).
  // (AJUSTE fecha de retiro 18-sep-2026) Un retiro coordinado sólo se contabiliza en
  // el Plan de Carga a partir del día programado en `fecha_retiro` (inclusive) —
  // si se coordina con fecha futura, no infla el plan hasta que llegue esa fecha.
  // Retiros ya atrasados (fecha_retiro < mañana) siguen contando (deben salir ASAP).
  // Los coordinados ANTES de este ajuste, sin `fecha_retiro` guardada, se siguen
  // contabilizando sin filtro de fecha (compatibilidad hacia atrás).
  // (AJUSTE 48H) El corte usa el próximo día hábil (saltando fin de semana y
  // feriados de `abast_feriados`) en vez de simplemente "mañana" calendario.
  // (AJUSTE 22-sep-2026) El corte de fecha se evalúa POR CENTRO DESTINO más abajo
  // (dentro de `retirosCons`), usando el horizonte de cada centro (getHorizonte(ce):
  // 24h→diaHabil1, 48h→diaHabil2) — antes usaba siempre diaHabil1 para todos los
  // centros, por lo que un retiro FAB-CD coordinado con fecha_retiro en la ventana
  // 48h (p. ej. Coquimbo) quedaba excluido del Plan de Carga aunque su centro
  // estuviera configurado a 48 horas.
  const retiros = esCD1003 ? retirosRaw
    .filter(r => !String(r.proveedor ?? '').startsWith('*'))
    .filter(r => String(r.contr ?? '').trim() !== '')
    .filter(r => { const _e = estadosRetiro[String(r.doc_compr ?? '').trim()] || {}; return esEstadoCoordinado(_e.estado) && _e.tipo_local_rm !== 'LOCAL' && (_e.estado === 'coordinado_santiago' || _e.tipo_local_rm === 'RM' || String(_e.entrega_entrante ?? '').trim() !== ''); }) : [];
  const ventas = esCD1003 ? ventasRaw.filter(r => !String(r.mr ?? '').trim()) : [];
  // Regla Jordan 21-sep-2026: todo retiro LOCAL (tipo_local_rm='LOCAL') queda excluido del Plan de Carga;
  // los retiros de Concepción (1081) no cuentan en la tabla (los retiros son sólo del plan 1003).
  // (AJUSTE 21-sep-2026) Base de retiros para los camiones DIRECTOS Fábrica-Sucursal /
  // Fábrica-Cliente: sólo OC en estado COORDINADO (la fecha de retiro = fecha de
  // planificación se valida por centro más abajo). Igual que `retiros`, sólo aplica al plan
  // del CD 1003: el dataset de retiros no trae CD de origen y al evaluarlo también para 1081
  // la misma OC quedaba contada en ambos planes (duplicado 1003/1081).
  const retirosDirectosBase = esCD1003 ? retirosRaw
    .filter(r => !String(r.proveedor ?? '').startsWith('*'))
    .filter(r => String(r.contr ?? '').trim() !== '')
    .filter(r => { const _e = estadosRetiro[String(r.doc_compr ?? '').trim()] || {}; return esEstadoCoordinado(_e.estado) && _e.tipo_local_rm !== 'LOCAL' && ['FAB-SUC', 'FAB-CLTE'].includes(_e.tipo_retiro); }) : [];
  // sqvi_pedidos_traslados_4000: cesu==ce (destino), origen siempre es CD 1003.
  // Deduplicar por doc_compr|pos — clave sin fecha para fusionar la fila '00.00.0000'
  // (cabecera SAP) con la fila de fecha real (línea de planificación), conservando
  // siempre la fecha válida. Excluir subtotales del SQVI (doc_compr o material vacíos).
  const _t4000Map = new Map();
  if (esCD1003) traslados4000Raw.forEach(r => {
    const dc = String(r.doc_compr ?? '').trim();
    const pos = String(r.pos ?? '').trim();
    if (!dc || !String(r.material ?? '').trim()) return; // excluir subtotales
    const k = `${dc}|${pos}`;
    const existing = _t4000Map.get(k);
    // Preferir la fila con fecha válida (no 00.00.0000 ni vacía)
    const esValida = fe => fe && String(fe).trim() !== '' && String(fe).trim() !== '00.00.0000';
    if (!existing || (!esValida(existing.fe_entrega) && esValida(r.fe_entrega))) {
      _t4000Map.set(k, r);
    }
  });
  const t4000 = Array.from(_t4000Map.values());

  const destinosOrigen = (CALENDARIOS[planOrigen] && CALENDARIOS[planOrigen].destinos) || CENTROS_QUIEBRES;
  const centrosSet = new Set(destinosOrigen);

  // (AJUSTE 48H, 18-sep-2026) El día objetivo ya no es fijo ("mañana"): cada
  // centro destino tiene su propio horizonte de planificación (24h o 48h,
  // tabla `abast_horizonte_centro`, por defecto 24h) y el día objetivo se
  // calcula en días HÁBILES (salta sábado/domingo y los feriados de
  // `abast_feriados`) — reemplaza el parche anterior que sólo saltaba el fin
  // de semana cuando hoy era viernes.
  const calendarioOrigenRows = calendarioRows.filter(r => String(r.centro ?? '').trim() === planOrigen);
  const programadosDia1 = getCentrosProgramados(calendarioOrigenRows, diaHabil1.getDay()); // ventana 24h
  const programadosDia2 = getCentrosProgramados(calendarioOrigenRows, diaHabil2.getDay()); // ventana 48h
  // (AJUSTE 24-sep-2026) `enCalendario` ya no se precalcula acá: se evalúa por
  // centro dentro del map de abajo, contra el horizonte EFECTIVO (que puede
  // promoverse de 48h a 24h según la carga disponible para mañana).

  const resultadoTodos = Array.from(centrosSet).map(ce => {
    // Capacidad de referencia (camión lleno) para los umbrales de camión
    // cliente (80%) y fábrica (85%). La capacidad efectiva del CD se calcula
    // más abajo (La Calera/San Bernardo usan 15 T si no alcanzan a llenar 28 T).
    const capRef = CAP_CAMION_DEFAULT;
    const skuInfoCe = skuInfoByCentro[ce] || {};
    const det = { quiebre: [], stock: [], revex: [], cross: [], ventaCons: [], retiro: [], cliente: [], fabSuc: [], fabCli: [] };
    const itemT = (r, t) => ({ pt: r.doc_compr, material: r.material, nombre: r.texto_breve, fecha: r.fecha_confirmada, ctd: r.ctd_confirmada, ton: t, pv: r.documento, usuario: r.creado_por });
    // Clasifica una línea de Traslados 1003 según prioridadTraslado (usuario
    // creador / clasificación ABC / quiebre) — ver AJUSTES PRIORIZACIÓN 2026-09-18.
    const clasificaTraslado = r => {
      const info = skuInfoCe[String(r.material ?? '').trim()] || null;
      const quebrado = !!(info && info.sd <= 7);
      const abc = info ? info.abc : '';
      return prioridadTraslado(r.creado_por, abc, quebrado);
    };

    // 1. ABAST. QUIEBRE Y PRIORIZADO (puntos B, C, D del ajuste de priorización:
    //    usuario ≠ ZE_SIS, clasificación ABC=AA, o material quebrado con otra
    //    clasificación). Excluye líneas con ctd_confirmada = 0 → ya entregadas.
    // (AJUSTE 24-sep-2026, pedido Jordan) Ventana -10/+7 en DÍAS HÁBILES, igual
    // criterio que Ventas 1003.
    const baseTraslados = traslados
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => fechaEnRangoHabil(r.fecha_confirmada, 10, 7, feriadosSet) || incSet.has(_keyInc(r.doc_compr, r.material)))
      .filter(r => parseNum(r.ctd_confirmada) > 0)
      .filter(r => !estaExcluido(exclusionesPlan, 'traslados_1003', r.doc_compr, r.material))
      .map(r => ({ r, prio: clasificaTraslado(r), forz: incSet.has(_keyInc(r.doc_compr, r.material)) }));

    // (AJUSTE 30-sep-2026) Empates: documento y material (mismo orden que la foto del servidor).
    const _cmpTxt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const ordenPrioTraslado = (a, b) => (a.prio.orden - b.prio.orden)
      || _cmpTxt(String(a.r.doc_compr ?? '').trim(), String(b.r.doc_compr ?? '').trim())
      || _cmpTxt(String(a.r.material ?? '').trim(), String(b.r.material ?? '').trim());
    const itemsPrioridad = baseTraslados
      .filter(x => x.prio.bucket === 'prioridad')
      .sort(ordenPrioTraslado);
    const tonQuiebre = itemsPrioridad.reduce((sum, { r, prio, forz }) => {
      const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
      const tonBruto = calcTon(parseNum(r.peso_neto), r.ctd_confirmada);
      const tonVol = calcTon(parseNum(r.tamano_dimens), r.ctd_confirmada);
      det.quiebre.push({ ...itemT(r, t), _motivo: prio.motivo, _orden: forz ? -100 : prio.orden, _forzadoPlan: !!forz, tonBruto, tonVol });
      return sum + t;
    }, 0);

    // 2. ABASTECIMIENTO (punto E: material no quebrado), mismo orden de
    //    clasificación ABC que el punto D.
    const itemsAbast = baseTraslados
      .filter(x => x.prio.bucket === 'abastecimiento')
      .sort(ordenPrioTraslado);
    const tonStock = itemsAbast.reduce((sum, { r, prio, forz }) => {
      const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
      const tonBruto = calcTon(parseNum(r.peso_neto), r.ctd_confirmada);
      const tonVol = calcTon(parseNum(r.tamano_dimens), r.ctd_confirmada);
      det.stock.push({ ...itemT(r, t), _motivo: prio.motivo, _orden: forz ? -100 : prio.orden, _forzadoPlan: !!forz, tonBruto, tonVol });
      return sum + t;
    }, 0);

    // 3. REVEX (peso_neto_2 × ctd_pedido — igual que la vista REVEX)
    const tonRevex = revex
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => !estaExcluido(exclusionesPlan, 'traslados_revex', r.doc_compr, r.material))
      .reduce((sum, r) => { const t = calcTon(parseNum(r.peso_neto_2), r.ctd_pedido); det.revex.push({ ...itemT(r, t), tonBruto: t, tonVol: null }); return sum + t; }, 0);

    // 4. Crossdocking 4000 — SÓLO pendientes. SIN ventana de fecha (AJUSTE
    //    16-sep-2026): antes filtraba fe_entrega -3/+3 días y dejaba fuera del
    //    Plan de Carga pedidos de crossdock ya creados en SAP con fecha de
    //    entrega un poco más lejana.
    //    (AJUSTE 24-sep-2026, pedido Jordan) "Pendiente" = ctd_pedido -
    //    ctd_entregada, igual que la vista de tabla "Pedidos de Traslados 4000".
    //    Cuando ctd_entregada == ctd_pedido, SAP ya generó la entrega (la
    //    salida física — cantidad_salida — llegará después) y deja de
    //    considerarse pendiente, aunque cantidad_salida todavía sea menor.
    const crossCdCli = [];
    const tonCross = t4000
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => parseNum(r.ctd_pedido) > parseNum(r.ctd_entregada))
      .filter(r => !estaExcluido(exclusionesPlan, 'crossdock_4000', r.doc_compr, r.material))
      // (4-oct-2026, Jordan) Pedidos de traslado coordinados como CD-CLIENTE salen en camión
      // directo al cliente: no se consolidan en el camión del CD.
      .filter(r => { const co = coordTraslados.get(String(r.doc_compr ?? '').trim()); if (co && co.tipo_entrega === 'CD-CLIENTE') { crossCdCli.push({ r, co }); return false; } return true; })
      .reduce((sum, r) => { const pend = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada); const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        const tonBruto = calcTon(parseNum(r.peso_neto), pend), tonVol = calcTon(parseNum(r.tamano_dimens), pend);
        det.cross.push({ pt: r.doc_compr, origen: String(r.cesu ?? '').trim(), ceDestino: String(r.ce ?? '').trim(), almDestino: String(r.alm ?? '').trim(), material: r.material, nombre: r.texto_breve, fecha: r.fe_entrega, ctdPend: pend, ton: t, pv: r.documento, tonBruto, tonVol }); return sum + t; }, 0);

    // 5. Notas de Venta 1003 (ofvta = centro): requiere ruta, excluye RETIRA.
    //    >26T  ⇒ CAMIÓN CLIENTE (directo al cliente, no se consolida). Fecha -3/+3.
    //    ≤26T  ⇒ PEDIDO DE VENTA DIRECTA (consolida con la carga del CD).   Fecha -3/+3.
    //    Dedup doc_ventas|material: el SQVI puede tener varias líneas para el mismo
    //    PV+material (distintas fechas). Se conserva la fila con fecha más reciente,
    //    igual que la lógica usada en la vista tabla de pedidos de ventas.
    // (AJUSTE 30-sep-2026, pedido Jordan) La clasificación CD-CLIENTE se hace con el
    // PEDIDO COMPLETO (todas sus líneas pendientes, sin ventana de fechas), igual que la
    // vista Ventas CD (1003). Antes sólo se sumaban las líneas dentro de la ventana ±3 y
    // una NV de 26,7 t con una línea a +4 días quedaba en 9,9 t → se consolidaba.
    //  · NV CD-CLIENTE: camión exclusivo al cliente, NUNCA se consolida. Sale completa en
    //    el plan del día hábil anterior a su fecha de entrega (fecha = la más lejana de sus
    //    líneas pendientes, igual que la vista); si aún no toca, se difiere.
    //  · NV consolidable: sólo sus líneas dentro de la ventana ±3 días hábiles.
    const _ventasDedupMap = new Map();
    ventas
      .filter(r => String(r.ofvta ?? '').trim() === ce)
      .filter(r => String(r.ruta ?? '').trim() !== '')
      .filter(r => normTxt(r.ruta).indexOf('RETIRA') === -1)
      .filter(r => !estaExcluido(exclusionesPlan, 'venta_1003', r.doc_ventas, null))
      .forEach(r => {
        const k = `${String(r.doc_ventas ?? '').trim()}|${String(r.material ?? '').trim()}`;
        const ex = _ventasDedupMap.get(k);
        if (!ex) { _ventasDedupMap.set(k, r); return; }
        const dNew = parseDateSAP(r.fe_entrega), dOld = parseDateSAP(ex.fe_entrega);
        if (dNew && (!dOld || dNew >= dOld)) _ventasDedupMap.set(k, r);
      });
    const ventasPorDoc = {};
    Array.from(_ventasDedupMap.values()).forEach(r => { const d = String(r.doc_ventas ?? '').trim(); (ventasPorDoc[d] = ventasPorDoc[d] || []).push(r); });
    let tonVentaCliente = 0, tonVentaCons = 0;
    const sumTon = arr => arr.reduce((s, d) => s + d.ton, 0);
    // (2-oct-2026, Jordan) Sólo NV con estado Coordinado (abast_venta_coordinacion) entran al
    // plan. La fecha de entrega confirmada es el día objetivo: entra si fecha ≤ día objetivo
    // del centro (24h → 1º día hábil, 48h → 2º; las fechas pasadas siguen como atrasadas).
    // El tipo de entrega (CD-CLIENTE / CONSOLIDABLE) es el definido al coordinar.
    const diaObjVentas = getHorizonte(ce) === 48 ? diaHabil2 : diaHabil1;
    const camionesCliente = [];
    let tonClienteDiferido = 0;
    const ventasCliPorGrupo = {};
    for (const [doc, rowsDoc] of Object.entries(ventasPorDoc)) {
      const co = coordVentas.get(doc);
      if (!co) continue;                                    // sin coordinar → no se considera
      const pv = pvMap[doc] || {};
      const clienteKey = clienteKeyNV(doc, rowsDoc[0].solicitante, pv);
      const fc = parseISODate(co.fecha_entrega);
      const fechaTxt = fmtFechaISO(co.fecha_entrega);
      const items = [];
      rowsDoc.forEach(r => {
        const pend = parseNum(r.ctd_confirmada) - parseNum(r.cantidad_entrg);
        if (pend <= 0) return;
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        if (t <= 0) return;
        const tonBruto = calcTon(parseNum(r.peso_neto), pend), tonVol = calcTon(parseNum(r.tamano_dimens), pend);
        const rl = lookupRuta(r.ruta);
        items.push({ pv: doc, material: r.material, nombre: r.denominacion_de_posicion, cant: pend, ruta: r.ruta, comuna: rl.comuna, region: rl.region, fecha: fechaTxt, ton: t, tonBruto, tonVol, tipoExp: pv.denominacion || '', cliente: pv.nombre_1 || co.nombre_cliente || (String(r.solicitante ?? '').trim() ? 'ID ' + String(r.solicitante).trim() : ''), idCliente: String(r.solicitante ?? '').trim(), vendedor: pv.nombre || '', _manual: co.tipo_entrega, entrega: co.n_entrega || '' });
      });
      if (!items.length) continue;
      const enPlan = fc && fc.getTime() <= diaObjVentas.getTime();
      if (co.tipo_entrega === 'CD-CLIENTE') {
        if (!enPlan) { tonClienteDiferido += sumTon(items); continue; }   // camión exclusivo de otro día
        // (2-oct-2026, Jordan) El camión lo define la PATENTE: NV CD-Cliente con la misma patente
        // camión y la misma fecha forman un solo despacho (aunque sean de clientes distintos).
        // Sin patente → agrupación automática por cliente.
        const pat = normPatente(co.patente_camion);
        const gk = pat ? `PAT|${pat}|${co.fecha_entrega}` : `CLI|${clienteKey}`;
        const nomCli = pv.nombre_1 || co.nombre_cliente || (clienteKey !== doc ? 'Cliente ' + clienteKey : clienteKey);
        const g = (ventasCliPorGrupo[gk] = ventasCliPorGrupo[gk] || { items: [], clientes: new Set(), pat: pat ? String(co.patente_camion).toUpperCase().trim() : '', co });
        g.clientes.add(nomCli);
        g.items.push(...items);
      } else if (enPlan) { tonVentaCons += sumTon(items); det.ventaCons.push(...items); }
    }
    // (4-oct-2026, Jordan) Pedidos de traslado (Crossdocking) coordinados como CD-CLIENTE:
    // mismo tratamiento que las NV CD-Cliente (camión directo, agrupado por patente+fecha).
    {
      const porDoc = {};
      crossCdCli.forEach(({ r, co }) => {
        const pend = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada); if (pend <= 0) return;
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend); if (t <= 0) return;
        const doc = String(r.doc_compr ?? '').trim();
        (porDoc[doc] = porDoc[doc] || { co, items: [] }).items.push({ pv: doc, material: r.material, nombre: r.texto_breve, cant: pend, ruta: '', comuna: co.comuna || '', region: '',
          fecha: fmtFechaISO(co.fecha_entrega), ton: t, tonBruto: calcTon(parseNum(r.peso_neto), pend), tonVol: calcTon(parseNum(r.tamano_dimens), pend),
          tipoExp: 'Crossdocking CD-Cliente', cliente: co.nombre_cliente || '', idCliente: '', vendedor: '', _manual: 'CD-CLIENTE', entrega: co.n_entrega || '' });
      });
      for (const [doc, { co, items }] of Object.entries(porDoc)) {
        const fc = parseISODate(co.fecha_entrega);
        if (!(fc && fc.getTime() <= diaObjVentas.getTime())) { tonClienteDiferido += sumTon(items); continue; }
        const pat = normPatente(co.patente_camion);
        const gk = pat ? `PAT|${pat}|${co.fecha_entrega}` : `TRS|${doc}`;
        const g = (ventasCliPorGrupo[gk] = ventasCliPorGrupo[gk] || { items: [], clientes: new Set(), pat: pat ? String(co.patente_camion).toUpperCase().trim() : '', co });
        g.clientes.add(co.nombre_cliente || ('Traslado ' + doc));
        g.items.push(...items);
      }
    }
    // (AJUSTE 30-sep-2026, Jordan) % de ocupación de camiones directos siempre sobre camión de 28 t.
    Object.values(ventasCliPorGrupo).forEach(g => {
      const nombres = [...g.clientes].join(' + ');
      if (g.pat) {   // un camión físico: no se reparte (si excede 28 t se ve sobre el 100%)
        const ton = sumTon(g.items);
        camionesCliente.push({ items: g.items, ton, grupo: `Patente ${g.pat} · ${nombres}`, cap: CAP_CAMION_DIRECTO,
          patente: g.pat, patenteCarro: g.co.patente_carro || '', idTrans: String(g.co.id_transporte ?? '').trim(), transportista: [g.co.id_transporte, g.co.transportista].filter(Boolean).join(' · '),
          chofer: [g.co.chofer_nombre, g.co.chofer_rut, g.co.chofer_telefono].filter(Boolean).join(' · ') });
      } else armarCamiones(g.items, CAP_CAMION_DIRECTO, d => d.pv).forEach(c => camionesCliente.push({ ...c, grupo: nombres, cap: CAP_CAMION_DIRECTO }));
    });
    camionesCliente.forEach((c, i) => { c.n = i + 1; c.items.forEach(d => { d._camion = i + 1; }); tonVentaCliente += c.ton; det.cliente.push(...c.items); });

    // 6. Retiros proveedor CONSOLIDAR CD (tipo_retiro=FAB-CD) → parte del CD.
    // (AJUSTE 22-sep-2026) Corte de fecha por centro: usa el horizonte de `ce`
    // (24h→diaHabil1, 48h→diaHabil2) en vez del corte global fijo a 24h.
    // (AJUSTE 23-sep-2026, pedido Jordan) El corte NO debe ser un rango abierto
    // (`fr <= cutoffRetiroCe`): eso hacía que un retiro con fecha_retiro = mañana
    // (diaHabil1) apareciera también en el plan de un centro a 48h (cutoff =
    // diaHabil2), aunque ese retiro es "para retirar mañana", no para la ventana
    // de 48h. Ahora sólo cuenta si: (a) está atrasado, o (b) su fecha_retiro
    // coincide EXACTAMENTE con el día objetivo de este centro (diaHabil1 si es
    // 24h, diaHabil2 si es 48h).
    // (AJUSTE 24-sep-2026, pedido Jordan) "Atrasado" se compara contra HOY, no
    // contra "mañana" (diaHabil1): un retiro con fecha_retiro = hoy todavía se
    // está retirando hoy, no está atrasado — sólo pasa a considerarse atrasado
    // (y por lo tanto reaparece en el plan) a partir del día SIGUIENTE a su
    // fecha_retiro si sigue sin cerrarse (estado sigue "coordinado").
    const itemR = (r, cant, t) => { const _oc = String(r.doc_compr ?? '').trim(); const _e = estadosRetiro[_oc] || {}; const ee = _e.entrega_entrante || '';
      const tonBruto = calcTon(parseNum(r.peso_bruto), cant), tonVol = calcTon(parseNum(r.tamano_dimens), cant);
      // Fecha de Retiro coordinada (prioridad) — si no hay, se usa la fecha de entrega SAP de referencia.
      const fecha = _e.fecha_retiro ? fmtFechaISO(_e.fecha_retiro) : r.fe_entrega;
      return { oc: r.doc_compr, idProv: r.proveedor, prov: r.nombre_1, material: r.material, nombre: r.texto_breve, fecha, cant, ton: t, tonBruto, tonVol, pv: r.documento, entrega_entrante: ee }; };
    // (AJUSTE 24-sep-2026, pedido Jordan) Se calcula el Retiro CD para AMBAS
    // fechas objetivo posibles (mañana=diaHabil1 y pasado mañana=diaHabil2),
    // en vez de una sola según el horizonte configurado. Esto permite evaluar
    // más abajo si conviene "adelantar" un centro a 48h a 24h (ver promovido24).
    function retirosParaFecha(fechaObjetivoCe) {
      return retiros
        .filter(r => String(r.ce ?? '').trim() === ce)
        .filter(r => !estaExcluido(exclusionesPlan, 'retiro_fabrica', r.doc_compr, r.material))
        .filter(r => (estadosRetiro[String(r.doc_compr ?? '').trim()] || {}).tipo_retiro === 'FAB-CD')
        .filter(r => { const _e = estadosRetiro[String(r.doc_compr ?? '').trim()] || {}; const fr = parseISODate(_e.fecha_retiro); return !fr || fr.getTime() < hoy00().getTime() || fr.getTime() === fechaObjetivoCe.getTime(); });
    }
    function sumarRetiro(lista) {
      let sum = 0; const items = [];
      lista.forEach(r => {
        // (7-oct-2026) Sólo los productos/cantidades elegidos al coordinar el retiro.
        const cant = cantRetiroLinea(estadosRetiro[String(r.doc_compr ?? '').trim()], r.material, parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada));
        if (!(cant > 0)) return;
        const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), cant);
        items.push(itemR(r, cant, t)); sum += t;
      });
      return { sum, items };
    }
    const retiro24 = sumarRetiro(retirosParaFecha(diaHabil1));
    const retiro48 = sumarRetiro(retirosParaFecha(diaHabil2));

    // 6b. Camiones DIRECTOS de fábrica (AJUSTE 21-sep-2026). Sólo OC en estado COORDINADO con
    //   fecha de retiro = fecha de planificación del centro (24h→día hábil 1, 48h→día hábil 2)
    //   y que no consolidan en CD (tipo_retiro ≠ FAB-CD):
    //   - CAMIÓN FÁBRICA-SUCURSAL: OC de retiro de stock (sin pedido de venta) u OC de un pedido
    //     de venta con condición EBEMA RETIRA-CLIENTE RETIRA. Se agrupan por proveedor (mismo
    //     centro destino); el grupo es camión si suma > 90% de la capacidad.
    //   - CAMIÓN FÁBRICA-CLIENTE: OC de un pedido de venta con condición EBEMA RETIRA-EBEMA
    //     DESPACHA. Se agrupan por cliente; el grupo es camión si suma > 90% de la capacidad.
    // (1-oct-2026, Jordan) Un camión directo entra al plan del día hábil anterior a su fecha de
    // retiro (fecha_retiro = día hábil 1), sin importar el horizonte 24h/48h del camión CD. Antes un
    // centro 48h adelantado a 24h (Coquimbo) buscaba retiros del día hábil 2 y perdía sus directos.
    const fechaPlanCe = diaHabil1;
    const retirosFab = retirosDirectosBase
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => !estaExcluido(exclusionesPlan, 'retiro_fabrica', r.doc_compr, r.material))
      .filter(r => cantRetiroLinea(estadosRetiro[String(r.doc_compr ?? '').trim()], r.material, parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada)) > 0)
      .filter(r => { const fr = parseISODate((estadosRetiro[String(r.doc_compr ?? '').trim()] || {}).fecha_retiro); return !!fr && fr.getTime() === fechaPlanCe.getTime(); });
    // (1-oct-2026) Camiones directos armados a mano (abast_plan_camion_manual): las OC unidas
    // forman un camión propio aunque no lleguen al 85% por proveedor/cliente.
    const manualesCe = camManuales.filter(m => String(m.cd_origen ?? '').trim() === planOrigen && String(m.ce ?? '').trim() === ce);
    const ocManual = new Map();
    manualesCe.forEach(m => (m.docs || []).forEach(dc => ocManual.set(String(dc).trim(), m)));
    const manBuckets = new Map();     // id manual → { m, items }
    const ocCli = {}, provSuc = {};   // cliente/proveedor -> { ton, items:[] }
    // (3-oct-2026, Jordan) El tipo de camión directo sale del tipo de retiro coordinado
    // (FAB-SUC → Fábrica-Sucursal, FAB-CLTE → Fábrica-Cliente) y las OC con la misma patente
    // camión forman un solo camión (aunque sean de proveedores distintos o no lleguen al 85%).
    const patBuckets = new Map();     // patente → { e, tipo, items }
    retirosFab.forEach(r => {
      const cant = cantRetiroLinea(estadosRetiro[String(r.doc_compr ?? '').trim()], r.material, parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada));
      const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), cant);
      const item = itemR(r, cant, t);
      const docPV = String(r.documento ?? '').trim();
      const pvR = pvMap[docPV] || {};
      const eR = estadosRetiro[String(r.doc_compr ?? '').trim()] || {};
      const tipoDir = eR.tipo_retiro === 'FAB-CLTE' ? 'fabCli' : 'fabSuc';
      item._tipoDir = tipoDir; item.cliente = pvR.nombre_1 || '';
      const m = ocManual.get(String(r.doc_compr ?? '').trim());
      if (m) {
        if (!manBuckets.has(m.id)) manBuckets.set(m.id, { m, items: [] });
        manBuckets.get(m.id).items.push(item);
        return;
      }
      const pat = normPatente(eR.patente_camion);
      if (pat) {
        if (!patBuckets.has(pat)) patBuckets.set(pat, { e: eR, tipo: tipoDir, items: [] });
        patBuckets.get(pat).items.push(item);
        return;
      }
      if (tipoDir === 'fabSuc') {
        const p = String(r.proveedor ?? '').trim();
        (provSuc[p] = provSuc[p] || { ton: 0, items: [] }); provSuc[p].ton += t; provSuc[p].items.push(item);
      } else {
        const c = String(pvR.nombre_1 ?? '').trim() || docPV;
        (ocCli[c] = ocCli[c] || { ton: 0, items: [] }); ocCli[c].ton += t; ocCli[c].items.push(item);
      }
    });
    const capFab = getCapacidadCamion(ce);
    let tonFabCli = 0, tonFabSuc = 0;
    // (AJUSTE 28-sep-2026) Umbral 85% y reparto en N camiones por grupo (X2/X3).
    const camionesFabCli = [], camionesFabSuc = [];
    const fabCandidatos = [];   // OC de retiro directo que hoy no forman camión (para unir a mano)
    patBuckets.forEach(({ e, tipo, items }, pat) => {
      const nombres = [...new Set(items.map(d => d.prov).filter(Boolean))].join(' + ');
      (tipo === 'fabCli' ? camionesFabCli : camionesFabSuc).push({ items, ton: items.reduce((s2, d) => s2 + (d.ton || 0), 0),
        grupo: `Patente ${String(e.patente_camion || pat).toUpperCase()} · ${nombres}`, cap: CAP_CAMION_DIRECTO,
        patente: String(e.patente_camion || pat).toUpperCase(), patenteCarro: e.patente_carro || '', idTrans: String(e.id_transporte ?? '').trim(),
        transportista: [e.id_transporte, e.transportista].filter(Boolean).join(' · '),
        chofer: [e.chofer_nombre, e.chofer_rut, e.chofer_telefono].filter(Boolean).join(' · ') });
    });
    manBuckets.forEach(({ m, items }) => {
      const nombres = [...new Set(items.map(d => d.prov).filter(Boolean))].join(' + ');
      armarCamiones(items, CAP_CAMION_DIRECTO, d => d.oc).forEach(c => (m.tipo === 'fabCli' ? camionesFabCli : camionesFabSuc)
        .push({ ...c, grupo: nombres || ('Manual ' + m.id), cap: CAP_CAMION_DIRECTO, manualId: m.id }));
    });
    const aCandidatos = b => { const porOc = new Map(); b.items.forEach(d => { const k = String(d.oc ?? '').trim(); if (!porOc.has(k)) porOc.set(k, { oc: k, prov: d.prov, cliente: d.cliente || '', tipo: d._tipoDir, ton: 0, items: [] }); const x = porOc.get(k); x.ton += d.ton || 0; x.items.push(d); }); porOc.forEach(x => fabCandidatos.push(x)); };
    // (AJUSTE 30-sep-2026, Jordan) El umbral sigue usando la capacidad del centro, pero el camión
    // directo se arma y su % de ocupación se calcula sobre el camión de 28 t.
    Object.entries(ocCli).forEach(([k, b]) => { if (b.ton > capFab * UMBRAL_FABRICA) armarCamiones(b.items, CAP_CAMION_DIRECTO, d => d.oc).forEach(c => camionesFabCli.push({ ...c, grupo: k, cap: CAP_CAMION_DIRECTO })); else aCandidatos(b); });
    Object.entries(provSuc).forEach(([k, b]) => { if (b.ton > capFab * UMBRAL_FABRICA) armarCamiones(b.items, CAP_CAMION_DIRECTO, d => d.oc).forEach(c => camionesFabSuc.push({ ...c, grupo: (b.items[0] && b.items[0].prov) || k, cap: CAP_CAMION_DIRECTO })); else aCandidatos(b); });
    camionesFabCli.forEach((c, i) => { c.n = i + 1; c.items.forEach(d => { d._camion = i + 1; }); tonFabCli += c.ton; det.fabCli.push(...c.items); });
    camionesFabSuc.forEach((c, i) => { c.n = i + 1; c.items.forEach(d => { d._camion = i + 1; }); tonFabSuc += c.ton; det.fabSuc.push(...c.items); });

    // (AJUSTE 24-sep-2026, pedido Jordan) Promoción automática 48h → 24h: un
    // centro configurado a 48h despacha MAÑANA (24h) en vez de esperar el plan
    // de 48h si, con lo que ya está disponible para mañana (Retiro CD exacto a
    // diaHabil1 + REVEX + Venta Directa + Crossdocking + Quiebre + Abastecimiento,
    // que no dependen de la fecha del centro), el camión ya se completa. Se
    // evalúa de nuevo cada vez que se renderiza el plan — si hoy no alcanza,
    // sigue esperando a 48h; si al día siguiente llegó más carga y entre lo
    // nuevo y lo antiguo ya se completa, se adelanta ese día.
    const totalSinRetiroCd = tonRevex + tonVentaCons + tonCross + tonQuiebre + tonStock;
    function capParaTotal(t) {
      return CENTROS_CAMION_REDUCIDO.includes(ce) ? (t >= CAP_CAMION_DEFAULT ? CAP_CAMION_DEFAULT : CAP_CAMION_REDUCIDO) : CAP_CAMION_DEFAULT;
    }
    const total24 = totalSinRetiroCd + retiro24.sum;
    const cap24 = capParaTotal(total24);
    const horizonteConfig = getHorizonte(ce);
    // (AJUSTE 24-sep-2026, pedido Jordan) El umbral para promover NO es llenar
    // el camión al 100%: basta con superar el 90% de la capacidad (mismo
    // umbral UMBRAL_PROMOCION_24H; no cambia con el 85% de camiones directos).
    const promovido24 = horizonteConfig === 48 && total24 > cap24 * UMBRAL_PROMOCION_24H;
    const horizonteEfectivo = promovido24 ? 24 : horizonteConfig;
    const { sum: tonRetiro, items: retiroItems } = horizonteEfectivo === 24 ? retiro24 : retiro48;
    det.retiro.push(...retiroItems);

    // Total del CAMIÓN CD (consolidado). Orden de prioridad con que se llena el
    // camión: REVEX → Venta 1003 consolidable → Retiro CD → Crossdocking →
    // Traslados Quiebre → Traslados Abastecimiento.
    const total = totalSinRetiroCd + tonRetiro;

    // Capacidad efectiva del CD. La Calera (1050) y San Bernardo (1005) usan un
    // camión de 15 T si en el corte no alcanzan a llenar uno de 28 T.
    const cap = capParaTotal(total);

    const pct = cap > 0 ? Math.round(total / cap * 100) : 0;
    const sobrecarga = Math.max(0, total - cap);
    // FALTA/SOBRA: positivo (rojo) = falta carga, negativo mostrado en verde = sobra.
    const faltan = Math.max(0, cap - total);
    // (AJUSTE 24-sep-2026) Si el centro se promovió a 24h, el calendario de
    // sucursales también se revisa contra el día objetivo efectivo (mañana),
    // no contra el día original de 48h.
    const enCalendario = (horizonteEfectivo === 48 ? programadosDia2 : programadosDia1).has(ce);

    let status, statusCls;
    if (pct >= 80) { status = 'PROGRAMAR'; statusCls = 'bg-green-700 text-white'; }
    else if (pct >= 70) { status = 'REVISAR'; statusCls = 'bg-yellow-600 text-white'; }
    else { status = 'CARGA INSUFICIENTE'; statusCls = 'bg-gray-400 text-white'; }

    let obs = '';
    if (!enCalendario && pct >= 70) obs = 'CUPO EXTRA';
    if (enCalendario && pct < 70) obs = 'EN CALENDARIO - CARGA BAJA';
    if (promovido24) obs = (obs ? obs + ' · ' : '') + 'ADELANTADO A 24H (carga completa)';
    if (tonClienteDiferido > 0) obs = (obs ? obs + ' · ' : '') + 'CD-CLIENTE PRÓXIMO (' + fmtNum(tonClienteDiferido, 1) + ' T, fecha entrega posterior)';

    const out = {
      ce, nombre: getNombreCentro(ce), cap,
      tonQuiebre, tonStock, tonRevex, tonCross, tonVentaCons, tonVentaCliente, tonRetiro, tonFabSuc, tonFabCli,
      total, faltan, sobrecarga, pct, status, statusCls, obs, enCalendario,
      horizonte: horizonteEfectivo, horizonteConfig, promovido24,
      camionCliente: tonVentaCliente > 0, camionFabSuc: tonFabSuc > 0, camionFabCli: tonFabCli > 0,
      camionesCliente, camionesFabSuc, camionesFabCli, tonClienteDiferido, fabCandidatos,
      det, asig: asigMap.get(`${planOrigen}|${ce}`) || new Map(),
    };
    // (AJUSTE 30-sep-2026) Llenado del camión CD y propuesta de 2º camión (≥85% de la capacidad).
    const fill = asignarCamionesCD(out);
    Object.assign(out, { cargadoCD: fill.cargado, excedente: fill.excedente, segundoPropuesto: fill.segundoPropuesto, tonSegundo: fill.tonSegundo });
    if (out.segundoPropuesto) out.obs = (out.obs ? out.obs + ' · ' : '') + '2º CAMIÓN OPCIONAL (~' + fmtNum(fill.tonSegundo, 1) + ' T)';
    return out;
  }).sort((a, b) => {
    // (AJUSTE 24-sep-2026, pedido Jordan) Prioridad real de despacho:
    // 1) Centros en agenda que SÍ alcanzan carga suficiente (pct >= 70) van
    //    primero: son los camiones que por agenda tienen espacio asegurado.
    // 2) El resto (en agenda pero con carga insuficiente, o fuera de agenda)
    //    compite por los cupos restantes; entre ellos gana quien tenga más
    //    toneladas totales, sin importar si estaba o no en la agenda.
    const aPrioriza = a.enCalendario && a.pct >= 70;
    const bPrioriza = b.enCalendario && b.pct >= 70;
    if (aPrioriza !== bPrioriza) return aPrioriza ? -1 : 1;
    if (aPrioriza && bPrioriza) return b.pct - a.pct;
    return b.total - a.total;
  });
  // Perfiles con centros asignados: sólo sus sucursales destino
  const resultado = resultadoTodos.filter(r => enAlcance(r.ce));
  // (30-sep-2026) Modo sólo-cálculo: lo usa la vista Pedidos de Traslado para marcar
  // qué líneas van en el camión, con exactamente la misma lógica del Plan de Carga.
  if (opts.soloCalculo) return { resultadoTodos, exclusionesPlan, inclusionesPlan };

  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const fmtDiaHabil = d => `${diasSemana[d.getDay()]} ${d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}`;
  const fechaLabel = `Ventana 24h: ${fmtDiaHabil(diaHabil1)} · Ventana 48h: ${fmtDiaHabil(diaHabil2)}`;

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
  // rawCols = Set de índices que se insertan tal cual (sin escapar), para botones
  // de acción como "Excluir del Plan".
  function tablaDet(headers, filas, alignRight, rawCols) {
    rawCols = rawCols || new Set();
    const head = headers.map((h, i) => `<th class="pr-md text-[10px] uppercase text-secondary ${alignRight.has(i) ? 'text-right' : 'text-left'}">${escapeHtml(h)}</th>`).join('');
    const body = filas.length
      ? filas.map(fila => `<tr class="border-b border-outline-variant/40">${fila.map((v, i) => `<td class="py-[2px] pr-md text-[12px] ${alignRight.has(i) ? 'text-right num-clear' : ''}">${rawCols.has(i) ? (v ?? '') : escapeHtml(String(v ?? ''))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}" class="text-secondary text-[12px] py-xs">Sin ítems.</td></tr>`;
    return `<table class="w-full text-[12px] mb-xs"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  const PUEDE_EXCLUIR = can('excluir');
  // (1-oct-2026) Ajustes manuales del plan (2º camión, mover líneas, unir directos): OWNER y Planner Abastecimiento.
  const PUEDE_AJUSTAR = can('ajustar_plan');
  // (4-oct-2026, Jordan) Sólo el perfil OWNER agrega/modifica los datos del transporte, también
  // después del cierre. El Planner Abastecimiento no puede en ningún momento.
  const PUEDE_TRANSPORTE = can('programar_transporte');
  const btnExcluir = (tipo, doc, material) => !PUEDE_EXCLUIR ? '' : `<button data-excluir="${escapeHtml(tipo)}|${escapeHtml(String(doc ?? ''))}|${escapeHtml(String(material ?? ''))}" title="Excluir del Plan de Carga de hoy" class="text-[11px] font-bold text-error hover:underline whitespace-nowrap">Excluir</button>`;
  function blkWrap(lbl, items, tableHtml) {
    const sub = items.reduce((s, d) => s + (d.ton || 0), 0);
    return `<div class="mb-md">
      <div class="text-[12px] font-bold text-primary mb-xs">${escapeHtml(lbl)} <span class="text-secondary font-normal">(${fmtNum(sub, 4)} Ton)</span></div>
      ${tableHtml}</div>`;
  }
  const camMark = d => d._camion ? 'CAMIÓN ' + d._camion : (d._enCamion === undefined ? '' : (d._enCamion ? '✓ SÍ' : '✗ EXCEDE'));
  const shiftSet = (s) => new Set([...s].map(i => i + 1));
  // Bloque Traslados (Quiebre / Abastecimiento / REVEX / Crossdocking)
  function blkTraslado(lbl, items, marcar, conPrioridad) {
    if (!items.length) return '';
    let heads = ['Pedido de Traslado','ID Material','Nombre Material','Fecha de Entrega','Cantidad Confirmada','Ton SKU','Pedido de Venta'];
    let align = new Set([4, 5]);
    let filas = items.map(d => [d.pt, d.material, d.nombre, d.fecha, d.ctd, fmtNum(d.ton, 4), d.pv]);
    // Columnas Usuario / Motivo Prioridad — sólo para los bloques de
    // ABAST. QUIEBRE Y PRIORIZADO / ABASTECIMIENTO (ver prioridadTraslado).
    if (conPrioridad) { heads = [...heads, 'Usuario', 'Motivo Prioridad']; filas = items.map((d, i) => [...filas[i], d.usuario || '', d._motivo || '']); }
    if (marcar) { heads = ['En Camión', ...heads]; align = shiftSet(align); filas = items.map((d, i) => [camMark(d), ...filas[i]]); }
    return blkWrap(lbl, items, tablaDet(heads, filas, align));
  }
  // Bloque Crossdocking (columnas completas, sin ocultar)
  function blkCrossdocking(lbl, items, marcar) {
    if (!items.length) return '';
    let heads = ['Origen','Pedido de Traslado','Centro Destino','Almacén Destino','Fecha de Entrega','ID Material','Nombre Material','Cant. Pendiente','Ton SKU','Pedido de Venta','Excluir'];
    let align = new Set([7, 8]);
    let filas = items.map(d => [d.origen, d.pt, d.ceDestino, d.almDestino, d.fecha, d.material, d.nombre, fmtNum(d.ctdPend, 1), fmtNum(d.ton, 4), d.pv, btnExcluir('crossdock_4000', d.pt, d.material)]);
    let raw = new Set([heads.length - 1]);
    if (!PUEDE_EXCLUIR) { heads = heads.slice(0, -1); filas = filas.map(f => f.slice(0, -1)); raw = new Set(); }
    if (marcar) { heads = ['En Camión', ...heads]; align = shiftSet(align); raw = shiftSet(raw); filas = items.map((d, i) => [camMark(d), ...filas[i]]); }
    return blkWrap(lbl, items, tablaDet(heads, filas, align, raw));
  }
 
  // Bloque Retiros de Fábrica
  function blkRetiro(lbl, items, marcar) {
    if (!items.length) return '';
    let heads = ['Orden de Compra','Entrega Entrante','Id Proveedor','Proveedor','ID Material','Nombre Material','Fecha de Retiro','Cantidad','Ton SKU','Pedido de Venta'];
    let align = new Set([7, 8]);
    let filas = items.map(d => [d.oc, d.entrega_entrante || '', d.idProv, d.prov, d.material, d.nombre, d.fecha, fmtNum(parseNum(d.cant), 1), fmtNum(d.ton, 4), d.pv]);
    if (marcar) { heads = ['En Camión', ...heads]; align = shiftSet(align); filas = items.map((d, i) => [camMark(d), ...filas[i]]); }
    return blkWrap(lbl, items, tablaDet(heads, filas, align));
  }
  // Bloque Pedidos de Venta
  function blkVenta(lbl, items, marcar) {
    if (!items.length) return '';
    let heads = ['Pedido de Venta','ID Material','Nombre Material','Cantidad','Cliente','Vendedor','Tipo Expedición','Id Ruta','Comuna','Región','Fecha de Entrega','Ton SKU','Excluir'];
    let align = new Set([3, 11]);
    // Excluye el Pedido de Venta completo (todas sus líneas), no sólo el material de la fila.
    let filas = items.map(d => [d.pv, d.material, d.nombre, fmtNum(parseNum(d.cant), 1), d.cliente || '', d.vendedor || '', d.tipoExp || '', d.ruta, d.comuna, d.region, d.fecha, fmtNum(d.ton, 4), btnExcluir('venta_1003', d.pv, null)]);
    let raw = new Set([heads.length - 1]);
    if (!PUEDE_EXCLUIR) { heads = heads.slice(0, -1); filas = filas.map(f => f.slice(0, -1)); raw = new Set(); }
    if (marcar) { heads = ['En Camión', ...heads]; align = shiftSet(align); raw = shiftSet(raw); filas = items.map((d, i) => [camMark(d), ...filas[i]]); }
    return blkWrap(lbl, items, tablaDet(heads, filas, align, raw));
  }

  // Marca, en orden de prioridad, qué ítems entran en el camión CD según su
  // capacidad efectiva (r.cap). Devuelve totales cargado/excede.
  // (AJUSTE 30-sep-2026) Misma asignación que la foto del servidor (asignarCamionesCD).
  function marcarCapacidadCD(r) {
    const f = asignarCamionesCD(r);
    return { ...f, excede: f.excedente };
  }

  // (AJUSTE 28-sep-2026) Detalle de camiones directos separado por camión.
  function blkCamiones(lista, lblGrupo, blkFn) {
    if (!lista || !lista.length) return '';
    const tot = lista.length;
    const resumen = tot > 1 ? `<div class="mb-sm px-md py-sm rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-900 font-bold">Se requieren ${tot} camiones para esta fecha (X${tot})</div>` : '';
    return resumen + lista.map(c => {
      const pct = c.cap > 0 ? Math.round(c.ton / c.cap * 100) : 0;
      const lbl = `Camión ${c.n} de ${tot} · ${lblGrupo}: ${c.grupo} · ${fmtNum(c.ton, 1)} t de ${fmtNum(c.cap, 0)} t (${pct}%)`;
      return `<div class="mb-md pl-sm" style="border-left:4px solid #94a3b8">${blkFn(lbl, c.items)}</div>`;
    }).join('');
  }
  // Ícono de camión con marca X2 / X3 cuando se requiere más de un camión.
  const iconCamionN = (cls, n) => n > 1
    ? `<span style="position:relative;display:inline-block">${iconCamion(cls)}<span title="Se requieren ${n} camiones" style="position:absolute;top:-6px;right:-16px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;line-height:14px;padding:0 3px;border-radius:4px">X${n}</span></span>`
    : iconCamion(cls);

  const TRUCK_TITULOS = {
    cd: 'Camión CD (consolidado)',
    cliente: 'Camión CD-Cliente (pedidos del mismo cliente >85%)',
    fabSuc: 'Camión Fábrica-Sucursal (OC coordinadas, mismo proveedor, >85%)',
    fabCli: 'Camión Fábrica-Cliente (OC coordinadas, mismo cliente, >85%)',
  };

  function detalleRow(r, tipo) {
    let blocks = '', banner = '', excedeBlocks = '';
    if (tipo === 'cd') {
      const fill = marcarCapacidadCD(r);
      const cats = ['revex','ventaCons','retiro','cross','quiebre','stock'];
      const inC = {}, outC = {};
      cats.forEach(k => { inC[k] = (r.det[k]||[]).filter(d => d._enCamion); outC[k] = (r.det[k]||[]).filter(d => !d._enCamion); });
      banner = `<div class="mb-sm px-md py-sm rounded-lg bg-blue-50 border border-blue-200 text-[12px] text-blue-900 inline-flex flex-wrap items-center gap-md">
        <span><strong>Capacidad camión:</strong> ${fmtNum(r.cap, 0)} t</span>
        <span><strong>Cargado:</strong> ${fmtNum(fill.cargado, 1)} t</span>
        ${fill.excede > 0 ? `<span class="text-green-700 font-bold"><strong>Sobra:</strong> +${fmtNum(fill.excede, 1)} t ${fill.segundoPropuesto ? '(2º camión opcional)' : '(no alcanza el 85% para un 2º camión)'}</span>` : '<span class="text-green-700 font-bold">✓ Todo cabe en el camión</span>'}
      </div>`;
      blocks =
        blkTraslado('1º Pedidos de Traslados REVEX', inC.revex) +
        blkVenta('2º Pedidos de Venta Directa Consolidados', inC.ventaCons) +
        blkRetiro('3º Retiros de Proveedor Consolidados (CD)', inC.retiro) +
        blkCrossdocking('4º Pedidos de Traslados Crossdocking', inC.cross) +
        blkTraslado('5º Abast. Quiebre y Priorizado', inC.quiebre, false, true) +
        blkTraslado('6º Abastecimiento', inC.stock, false, true);
      // No se muestra sección de excedentes: el detalle incluye solo lo que entra en el camión.
    }
    // (AJUSTE 28-sep-2026) Un bloque por camión: "Camión 1 de 2 · Cliente · % de carga".
    else if (tipo === 'cliente') blocks = blkCamiones(r.camionesCliente, 'Cliente', blkVenta);
    else if (tipo === 'fabSuc') blocks = blkCamiones(r.camionesFabSuc, 'Proveedor', blkRetiro);
    else if (tipo === 'fabCli') blocks = blkCamiones(r.camionesFabCli, 'Cliente', blkRetiro);
    return `<tr class="bg-surface-container-low"><td colspan="${NCOLS}" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <div class="flex items-center justify-between mb-sm">
          <h4 class="font-bold text-on-surface text-[13px]">${escapeHtml(TRUCK_TITULOS[tipo] || '')} — ${escapeHtml(r.nombre)} (${r.ce})</h4>
          <button data-descarga="${r.ce}|${tipo}" title="Descarga el detalle completo de la sucursal (todas las categorías: REVEX, Venta Directa, CD-Cliente, Retiro Fábrica, Fábrica-Cliente, Fábrica-Sucursal, Crossdocking, Quiebre y Abastecimiento)" class="bg-surface-container-high text-on-surface px-sm py-xs rounded-lg text-[12px] font-bold hover:bg-surface-container-highest inline-flex items-center gap-xs">
            <span class="material-symbols-outlined text-[15px]">download</span>Descargar Plan de Carga</button>
        </div>
        ${banner}
        ${blocks || '<p class="text-secondary text-[12px]">Sin ítems.</p>'}
        ${excedeBlocks}
      </div></td></tr>`;
  }

  // Filas del CSV del detalle de Plan de Carga de una sucursal. (AJUSTE 18-sep-2026)
  // UN solo CSV con todas las categorías de la sucursal (igual criterio que el
  // adjunto del correo automático de Plan de Carga). Incluye lo que excede el
  // camión CD con la columna "En Camión" (SÍ / EXCEDE). Usuario / Motivo
  // Prioridad sólo para Traslados 1003; Ton Bruto / Ton Vol de referencia
  // (Ton SKU sigue siendo el mayor); REVEX no tiene Ton Vol.
  const CSV_HEADERS = ['Categoría','En Camión','Documento','Id Material','Nombre Material','Pedido de Venta','Proveedor','Entrega Entrante','Ruta','Comuna','Tipo Expedición','Fecha','Cantidad','Ton Bruto','Ton Vol','Ton SKU','Usuario','Motivo Prioridad'];
  function csvFilas(r) {
    marcarCapacidadCD(r);
    const cats = [
      ['REVEX', r.det.revex, 'T'],
      ['Venta Directa', r.det.ventaCons, 'V'],
      ['CD-Cliente', r.det.cliente, 'V'],
      ['Retiro Fábrica', r.det.retiro, 'R'],
      ['Fábrica-Cliente', r.det.fabCli, 'R'],
      ['Fábrica-Sucursal', r.det.fabSuc, 'R'],
      ['Crossdocking', r.det.cross, 'T'],
      ['Abast. Quiebre y Priorizado', r.det.quiebre, 'T'],
      ['Abastecimiento', r.det.stock, 'T'],
    ];
    const fmtT = v => (v == null ? '' : fmtNum(v, 4));
    const filas = [];
    cats.forEach(([cat, items, t]) => (items || []).forEach(d => {
      const enCamion = camMark(d);
      const usuario = d.usuario || '', motivo = d._motivo || '';
      // (FIX) Crossdocking usa "ctdPend" (numérico) en vez de "ctd".
      if (t === 'T') filas.push([cat, enCamion, d.pt, d.material, d.nombre, d.pv || '', '', '', '', '', '', d.fecha || '', d.ctd || (d.ctdPend != null ? fmtNum(d.ctdPend, 1) : ''), fmtT(d.tonBruto), fmtT(d.tonVol), fmtNum(d.ton, 4), usuario, motivo]);
      else if (t === 'R') filas.push([cat, enCamion, d.oc, d.material, d.nombre, d.pv || '', d.prov, d.entrega_entrante || '', '', '', '', d.fecha || '', fmtNum(parseNum(d.cant), 1), fmtT(d.tonBruto), fmtT(d.tonVol), fmtNum(d.ton, 4), '', '']);
      else filas.push([cat, enCamion, d.pv, d.material, d.nombre, '', '', '', d.ruta, d.comuna, d.tipoExp || '', d.fecha || '', fmtNum(parseNum(d.cant), 1), fmtT(d.tonBruto), fmtT(d.tonVol), fmtNum(d.ton, 4), '', '']);
    }));
    return filas;
  }
  function bajarCsv(headers, filas, nombre) {
    const esc = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [headers.join(';')].concat(filas.map(f => f.map(esc).join(';')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  // Descarga de una sucursal (mismo formato de siempre)
  function csvDetalleCamion(r) { bajarCsv(CSV_HEADERS, csvFilas(r), `PlanCarga_${r.ce}.csv`); }
  // Descarga del plan completo del centro origen (todas las sucursales visibles)
  function csvPlanCompleto(lista) {
    const filas = [];
    lista.forEach(r => csvFilas(r).forEach(f => filas.push([r.ce, r.nombre, ...f])));
    bajarCsv(['Centro Destino', 'Sucursal', ...CSV_HEADERS], filas, `PlanCarga_${planOrigen}_${isoLocal(hoy00())}.csv`);
  }

  // ==========================================================================
  // PRESENTACIÓN v2 (rediseño 29-sep-2026 · Propuesta A): una fila por
  // sucursal con el camión que se llena por categoría (orden de llenado),
  // tarjetas que filtran y panel lateral con una pestaña por camión.
  // ==========================================================================
  const CAT_V2 = [
    { k: 'revex',     lbl: 'REVEX',                color: '#2e3132', ton: r => r.tonRevex,     tipo: 'T' },
    { k: 'ventaCons', lbl: 'Venta directa',        color: '#5c5f61', ton: r => r.tonVentaCons, tipo: 'V' },
    { k: 'retiro',    lbl: 'Retiro proveedor',     color: '#936e69', ton: r => r.tonRetiro,    tipo: 'R' },
    { k: 'cross',     lbl: 'Crossdocking',         color: '#c5c7c9', ton: r => r.tonCross,     tipo: 'X' },
    { k: 'quiebre',   lbl: 'Quiebre y priorizado', color: '#b5000b', ton: r => r.tonQuiebre,   tipo: 'T' },
    { k: 'stock',     lbl: 'Abastecimiento',       color: '#ffb4aa', ton: r => r.tonStock,     tipo: 'T' },
  ];
  // ── Plan de Carga v2.1 (30-sep-2026, handoff «Plan de Carga v2») ──────────
  // Camión dibujado a escala con segmentos por categoría y espacio libre
  // rayado, 6 KPIs (3 filtran), cierre automático del plan a las 15:35,
  // panel de sólo lectura (sin Excluir) con líneas que no caben atenuadas y
  // descarga CSV con el formato 4.8 del PRD (+ columnas de referencia).
  const DIR_V2 = [
    { k: 'cliente', lista: 'camionesCliente', lbl: 'CD-Cliente',   csv: 'CD-Cliente',   grupo: 'Cliente',   tipo: 'V', color: '#15803d', tip: 'Camión CD-Cliente: misma patente coordinada = un despacho; sin patente, pedidos del mismo cliente' },
    { k: 'fabSuc',  lista: 'camionesFabSuc',  lbl: 'Fáb-Sucursal', csv: 'Fáb-Sucursal', grupo: 'Proveedor', tipo: 'R', color: '#1d4ed8', tip: 'Camión Fábrica-Sucursal (OC coordinadas, mismo proveedor)' },
    { k: 'fabCli',  lista: 'camionesFabCli',  lbl: 'Fáb-Cliente',  csv: 'Fáb-Cliente',  grupo: 'Cliente',   tipo: 'R', color: '#7e22ce', tip: 'Camión Fábrica-Cliente (OC coordinadas, mismo cliente)' },
  ];
  const CAT_LARGO = ['1º Pedidos de Traslados REVEX', '2º Pedidos de Venta Directa', '3º Retiros de Proveedor (CD)', '4º Pedidos de Traslados Crossdocking', '5º Abast. Quiebre y Priorizado', '6º Abastecimiento'];
  const CAT_FG = ['#fff', '#fff', '#fff', '#191c1d', '#fff', '#410001'];
  const CAT_CORTO = ['REVEX', 'Venta', 'Retiro', 'Cross', 'Quiebre', 'Abast.'];
  const CIERRE_H = 15, CIERRE_M = 35;
  const HHMM_CIERRE = `${String(CIERRE_H).padStart(2, '0')}:${String(CIERRE_M).padStart(2, '0')}`;
  const diasMin = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaCorto = d => `${diasMin[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}`;
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const manana = (() => { const x = hoy00(); x.setDate(x.getDate() + 1); return x; })();
  const d24Txt = (diaHabil1.getTime() === manana.getTime() ? 'Mañana · ' : '') + diaCorto(diaHabil1);
  const d48Txt = cap1(diaCorto(diaHabil2));
  const diaObj = r => (r.horizonte === 48 ? diaHabil2 : diaHabil1);
  const estadoV2 = r => r.pct >= 80 ? { lbl: 'Programar', tone: 'ok', k: 'prog', bg: '#dcfce7', fg: '#14532d', dot: '#15803d' }
    : r.pct >= 70 ? { lbl: 'Revisar', tone: 'warn', k: 'rev', bg: '#fef3c7', fg: '#713f12', dot: '#ca8a04' }
    : { lbl: 'Carga insuficiente', tone: 'bad', k: 'ins', bg: '#ffdad6', fg: '#93000a', dot: '#b5000b' };
  const pillEstado = e => `<span class="pc-st" style="background:${e.bg};color:${e.fg}"><i style="background:${e.dot}"></i>${escapeHtml(e.lbl)}</span>`;
  const nDirectos = r => DIR_V2.reduce((s, t) => s + (r[t.lista] || []).length, 0);
  const t1 = n => fmtNum(n, 1);
  const st = PLAN_V2_STATE;
  if (st.origen !== planOrigen) { st.kpi = 'all'; st.drawer = null; st.origen = planOrigen; }
  setUltimaActualizacion(maxCargadoEn(trasladosRaw) || maxCargadoEn(quiebresRaw));

  // Foto oficial del plan (abast_plan_carga_snapshot): la toma el servidor a las 15:35
  // (pg_cron → fn_abast_foto_plan_cierre) y es la base de los Indicadores del Plan de Carga.
  let fotoCierre = null;
  async function leerFotoCierre() {
    try {
      const { data } = await supabase.from('abast_plan_carga_snapshot').select('tomado_en')
        .eq('fecha', isoLocal(hoy00())).eq('cd_origen', planOrigen).eq('tipo_foto', 'cierre').limit(1);
      fotoCierre = data && data[0] ? new Date(data[0].tomado_en) : null;
    } catch (_e) { fotoCierre = null; }
  }
  // (AJUSTE 30-sep-2026) 2º camión aceptado hoy (abast_plan_segundo_camion): opcional,
  // sólo entra a la foto de cierre y a los indicadores si se acepta antes de las 15:35.
  let segAcept = new Set();
  async function leerSegundos() {
    try {
      const { data } = await supabase.from('abast_plan_segundo_camion').select('ce')
        .eq('fecha', isoLocal(hoy00())).eq('cd_origen', planOrigen);
      segAcept = new Set((data || []).map(x => String(x.ce ?? '').trim()));
    } catch (_e) { segAcept = new Set(); }
  }
  // (3-oct-2026) Camiones programados con datos de transporte (1 = camión CD, 2 = 2º camión).
  let progMap = new Map();
  async function leerProgramados() {
    try {
      const { data } = await supabase.from('abast_plan_camion_programado').select('*')
        .eq('fecha', isoLocal(hoy00())).eq('cd_origen', planOrigen);
      progMap = new Map((data || []).map(x => [`${String(x.ce ?? '').trim()}|${x.camion}`, x]));
    } catch (_e) { progMap = new Map(); }
  }
  // (5-oct-2026) Maestro de transportistas: directos con transportista BLOQUEADO = «por confirmar».
  let maestroTr = new Map();
  async function leerMaestroTr() { try { maestroTr = await loadMaestroTranspMap(); } catch (_e) { maestroTr = new Map(); } }
  const porConfirmar = cm => {
    if (!cm || !cm.patente || !cm.idTrans) return null;
    const t = maestroTr.get(String(cm.idTrans).trim().toUpperCase());
    const f = faltanTransp(t);
    return f.length ? { t, f } : null;
  };
  await Promise.all([leerFotoCierre(), leerSegundos(), leerProgramados(), leerMaestroTr()]);
  const otrosProgramados = (ce, cam) => [...progMap.values()]
    .filter(x => !(String(x.ce).trim() === ce && Number(x.camion) === cam))
    .map(x => ({ lbl: `${x.camion === 2 ? '2º camión' : 'camión CD'} ${getNombreCentro(x.ce)}`, patente_camion: x.patente_camion, chofer_rut: x.chofer_rut }));
  async function guardarProgramado(ce, cam, t) {
    const { error } = await supabase.from('abast_plan_camion_programado').upsert({ fecha: hoyIsoPlanP(), cd_origen: planOrigen, ce, camion: cam, ...t,
      programado_por: await getUserEmail(), programado_en: new Date().toISOString() }, { onConflict: 'fecha,cd_origen,ce,camion' });
    if (error) { showAlert('No se pudo programar el camión: ' + error.message, 'error'); return false; }
    return true;
  }
  function hoyIsoPlanP() { return isoLocal(hoy00()); }
  const hoyIsoPlan = isoLocal(hoy00());
  const docLinea = d => String(d.pt ?? d.oc ?? d.pv ?? '').trim();
  const matLinea = d => String(d.material ?? '').trim();
  // Recalcula el llenado CD / 2º camión de una sucursal con sus asignaciones actuales.
  function refrescarFill(r) {
    const f = asignarCamionesCD(r);
    Object.assign(r, { cargadoCD: f.cargado, excedente: f.excedente, segundoPropuesto: f.segundoPropuesto, tonSegundo: f.tonSegundo });
    return f;
  }
  function bloqueadoPorCierre() {
    if (estadoCierre().cerrado) { showAlert(`El plan ya cerró (${HHMM_CIERRE}): no se puede ajustar.`, 'error'); return true; }
    return false;
  }
  // (1-oct-2026) Aceptar = programar el 2º camión Y congelar la carga de ambos camiones
  // (origen 'confirmado'), para que lo que se cargue no cambie con nuevas líneas SAP.
  async function accionSegundo(ce, accion) {
    const r = resultado.find(x => x.ce === ce);
    if (!r || bloqueadoPorCierre()) return;
    if (accion === 'quitar' && progMap.get(`${ce}|2`) && !PUEDE_TRANSPORTE) { showAlert('El 2º camión ya tiene transporte: sólo el perfil OWNER puede quitarlo.', 'error'); return; }
    const f = refrescarFill(r);
    if (accion === 'aceptar') {
      // (4-oct-2026, Jordan) Aceptar es un paso propio: confirma la carga y despliega los SKU;
      // los datos del transporte se agregan después con «Agregar datos del transporte».
      if (!await confirmar(`¿Aceptar el 2º camión para ${r.nombre}?\n\n${t1(r.tonSegundo)} t de ${fmtNum(r.cap, 0)} t. Se confirma la carga de ambos camiones; luego el perfil OWNER agrega los datos del transporte.`)) { draw(); return; }
      const quien = await getUserEmail();
      const filas = new Map();
      f.orden.forEach(d => {
        if (d._manual !== null || !(d._enCamion || d._camion2)) return;
        const k = `${docLinea(d)}|${matLinea(d)}`;
        if (!filas.has(k)) filas.set(k, { fecha: hoyIsoPlan, cd_origen: planOrigen, ce, documento: docLinea(d), material: matLinea(d), camion: d._enCamion ? 1 : 2, origen: 'confirmado', updated_by: quien, updated_at: new Date().toISOString() });
      });
      if (filas.size) {
        const { error: e1 } = await supabase.from('abast_plan_linea_camion').upsert([...filas.values()], { onConflict: 'fecha,cd_origen,ce,documento,material' });
        if (e1) { showAlert('No se pudo confirmar la carga: ' + e1.message, 'error'); return; }
        filas.forEach((v, k) => r.asig.set(k, v.camion));
      }
      const { error } = await supabase.from('abast_plan_segundo_camion').upsert({ fecha: hoyIsoPlan, cd_origen: planOrigen, ce, ton_propuesta: Math.round(r.tonSegundo * 10000) / 10000, aceptado_por: quien, aceptado_en: new Date().toISOString() }, { onConflict: 'fecha,cd_origen,ce' });
      if (error) { showAlert('No se pudo guardar el 2º camión: ' + error.message, 'error'); return; }
    } else {
      await supabase.from('abast_plan_camion_programado').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce).eq('camion', 2);
      await quitarSeguimiento(ce, 2);
      const { error } = await supabase.from('abast_plan_segundo_camion').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce);
      if (error) { showAlert('No se pudo quitar el 2º camión: ' + error.message, 'error'); return; }
      // Al quitarlo, la carga vuelve al llenado automático (se borran asignaciones de la sucursal).
      await supabase.from('abast_plan_linea_camion').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce);
      r.asig.clear();
    }
    await Promise.all([leerSegundos(), leerProgramados()]);
    refrescarFill(r);
    if (accion === 'aceptar') { st.drawer = ce; st.tab = 'seg'; }
    showAlert(accion === 'aceptar' ? `2º camión aceptado para ${r.nombre}: falta agregar los datos del transporte (perfil OWNER).` : `2º camión quitado de ${r.nombre}; la carga vuelve al llenado automático.`, 'success');
    draw();
  }
  // (3-oct-2026, Jordan) Programar el camión CD: pide los datos del transporte y congela su carga
  // (origen 'confirmado'). Sólo los camiones programados entran a la foto 15:35 y a los indicadores.
  async function programarCD(ce) {
    const r = resultado.find(x => x.ce === ce);
    if (!r) return;
    if (!PUEDE_TRANSPORTE) { showAlert('Sólo el perfil OWNER puede agregar o modificar los datos del transporte.', 'error'); return; }
    const f = refrescarFill(r);
    const t = await showTransporteCamionModal({ titulo: `Camión CD → ${r.nombre}`, sub: `${t1(f.cargado)} t de ${fmtNum(r.cap, 0)} t · día objetivo ${diaCorto(diaObj(r))}`,
      ini: progMap.get(`${ce}|1`) || {}, otros: otrosProgramados(ce, 1) });
    if (!t) return;
    const quien = await getUserEmail();
    const filas = new Map();
    f.orden.forEach(d => {
      if (d._manual !== null || !d._enCamion) return;
      const k = `${docLinea(d)}|${matLinea(d)}`;
      if (!filas.has(k)) filas.set(k, { fecha: hoyIsoPlan, cd_origen: planOrigen, ce, documento: docLinea(d), material: matLinea(d), camion: 1, origen: 'confirmado', updated_by: quien, updated_at: new Date().toISOString() });
    });
    if (filas.size && !estadoCierre().cerrado) {
      const { error: e1 } = await supabase.from('abast_plan_linea_camion').upsert([...filas.values()], { onConflict: 'fecha,cd_origen,ce,documento,material' });
      if (e1) { showAlert('No se pudo confirmar la carga: ' + e1.message, 'error'); return; }
      filas.forEach((v, k) => r.asig.set(k, 1));
    }
    if (!(await guardarProgramado(ce, 1, t))) return;
    await leerProgramados();
    refrescarFill(r);
    { const sg = segCamionCD(r, 1); if (sg) await guardarSeguimiento(sg); }
    showAlert(`Camión CD de ${r.nombre} programado (${t.patente_camion}).`, 'success');
    draw();
  }
  async function quitarProgramacion(ce, cam = 1) {
    const r = resultado.find(x => x.ce === ce);
    if (!r) return;
    if (!PUEDE_TRANSPORTE) { showAlert('Sólo el perfil OWNER puede agregar o modificar los datos del transporte.', 'error'); return; }
    const nom = cam === 2 ? '2º camión' : 'camión CD';
    if (!await confirmar(`¿Quitar los datos del transporte del ${nom} de ${r.nombre}?\n\nEl camión deja de estar programado y no se mide en la foto de las ${HHMM_CIERRE}.`)) return;
    const { error } = await supabase.from('abast_plan_camion_programado').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce).eq('camion', cam);
    if (error) { showAlert('No se pudo quitar la programación: ' + error.message, 'error'); return; }
    await quitarSeguimiento(ce, cam);
    // Si no hay 2º camión aceptado, la carga confirmada vuelve al llenado automático.
    if (cam === 1 && !segAcept.has(ce) && !estadoCierre().cerrado) await supabase.from('abast_plan_linea_camion').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce).eq('origen', 'confirmado');
    showAlert(`Programación del ${nom} de ${r.nombre} quitada.`, 'success');
    if (cam === 1) renderPlanCarga(stage); else { await leerProgramados(); draw(); }
  }
  // (4-oct-2026, Jordan) 2º camión aceptado → agregar datos del transporte (queda programado).
  async function programarSegundo(ce) {
    const r = resultado.find(x => x.ce === ce);
    if (!r) return;
    if (!PUEDE_TRANSPORTE) { showAlert('Sólo el perfil OWNER puede agregar o modificar los datos del transporte.', 'error'); return; }
    if (!segAcept.has(ce)) { showAlert('Primero acepta el 2º camión.', 'error'); return; }
    const t = await showTransporteCamionModal({ titulo: `2º camión → ${r.nombre}`, sub: `${t1(r.tonSegundo)} t de ${fmtNum(r.cap, 0)} t · día objetivo ${diaCorto(diaObj(r))}`,
      ini: progMap.get(`${ce}|2`) || {}, otros: otrosProgramados(ce, 2) });
    if (!t) return;
    if (!(await guardarProgramado(ce, 2, t))) return;
    await leerProgramados();
    { const sg = segCamionCD(r, 2); if (sg) await guardarSeguimiento(sg); }
    showAlert(`2º camión de ${r.nombre} programado (${t.patente_camion}).`, 'success');
    draw();
  }
  // (4-oct-2026, Jordan) Editar el transporte de un camión ya programado. Cerrado el plan
  // (15:35) sólo el perfil OWNER puede editarlo (también lo controla la RLS de la tabla).
  async function editarTransporte(ce, cam) {
    const r = resultado.find(x => x.ce === ce);
    const p = progMap.get(`${ce}|${cam}`);
    if (!r || !p) return;
    const cerrado = estadoCierre().cerrado;
    if (!PUEDE_TRANSPORTE) { showAlert('Sólo el perfil OWNER puede agregar o modificar los datos del transporte.', 'error'); return; }
    const t = await showTransporteCamionModal({ titulo: `${cam === 2 ? '2º camión' : 'Camión CD'} → ${r.nombre}`,
      sub: cerrado ? `Plan cerrado · edición OWNER` : `Editar datos del transporte · día objetivo ${diaCorto(diaObj(r))}`,
      ini: p, otros: otrosProgramados(ce, cam) });
    if (!t) return;
    const { error } = await supabase.from('abast_plan_camion_programado').update({ ...t, editado_por: await getUserEmail(), editado_en: new Date().toISOString() })
      .eq('fecha', p.fecha || hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce).eq('camion', cam);
    if (error) { showAlert('No se pudo actualizar el transporte: ' + error.message, 'error'); return; }
    await leerProgramados();
    { const sg = segCamionCD(r, cam); if (sg) await guardarSeguimiento(sg, estadoCierre().cerrado); }
    showAlert(`Transporte del ${cam === 2 ? '2º camión' : 'camión CD'} de ${r.nombre} actualizado.`, 'success');
    draw();
  }
  function progHtml(r, cam) {
    const p = progMap.get(`${r.ce}|${cam}`);
    const cerrado = estadoCierre().cerrado;
    const nom = cam === 1 ? 'Camión CD' : '2º camión';
    const ceA = escapeHtml(r.ce);
    if (p) {
      const btns = [];
      if (PUEDE_TRANSPORTE)
        btns.push(`<button class="sv-btn" data-prog-edit="${ceA}" data-prog-cam="${cam}" title="${cerrado ? 'Plan cerrado: edición OWNER' : 'Editar datos del transporte'}"><span class="material-symbols-outlined">edit</span>Editar transporte</button>`);
      if (PUEDE_TRANSPORTE)
        btns.push(`<button class="sv-btn" data-prog-quitar="${ceA}" data-prog-cam="${cam}"><span class="material-symbols-outlined">remove_circle</span>Quitar</button>`);
      const ed = p.editado_en ? `<br><small style="color:#5c5f61">Editado por ${escapeHtml(p.editado_por || '')} · ${escapeHtml(new Date(p.editado_en).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small>` : '';
      return `<div class="pc-extra pc-seg2 is-ok"><span class="material-symbols-outlined">task_alt</span><div style="flex:1;min-width:0"><b>${nom} programado</b> · Patente ${escapeHtml(p.patente_camion)}${p.patente_carro ? ' · carro ' + escapeHtml(p.patente_carro) : ''}<br>
        ${escapeHtml([p.id_transporte, p.transportista].filter(Boolean).join(' · '))} · Chofer ${escapeHtml([p.chofer_nombre, p.chofer_rut, p.chofer_telefono].filter(Boolean).join(' · '))}${ed}</div>${btns.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${btns.join('')}</div>` : ''}</div>`;
    }
    if (cam === 1) {
      // (4-oct-2026, Jordan) Sólo los camiones en estado PROGRAMAR muestran el botón de transporte.
      if (!(r.cargadoCD > 0.05) || estadoV2(r).k !== 'prog') return '';
      const btn = PUEDE_TRANSPORTE ? `<button class="sv-btn-p" data-prog-cd="${ceA}"><span class="material-symbols-outlined">local_shipping</span>Agregar datos del transporte</button>` : '';
      return `<div class="pc-extra is-mute pc-seg2"><span class="material-symbols-outlined">pending</span><div style="flex:1;min-width:0"><b>Camión CD sin programar</b> · ${PUEDE_TRANSPORTE ? 'agrega los datos del transporte para programarlo' : 'faltan los datos del transporte (los agrega el perfil OWNER)'}. Sólo los camiones programados entran a la foto de las ${HHMM_CIERRE}, al correo y a los indicadores.${cerrado ? ' Plan cerrado.' : ''}</div>${btn}</div>`;
    }
    if (!segAcept.has(r.ce)) return '';
    const btn = PUEDE_TRANSPORTE ? `<button class="sv-btn-p" data-prog-seg="${ceA}"><span class="material-symbols-outlined">local_shipping</span>Agregar datos del transporte</button>` : '';
    return `<div class="pc-extra is-mute pc-seg2"><span class="material-symbols-outlined">pending</span><div style="flex:1;min-width:0"><b>2º camión aceptado, sin transporte</b> · ${PUEDE_TRANSPORTE ? 'agrega los datos del transporte para programarlo' : 'faltan los datos del transporte (los agrega el perfil OWNER)'}. Sólo con transporte entra a la foto de las ${HHMM_CIERRE}, al correo y a los indicadores.${cerrado ? ' Plan cerrado.' : ''}</div>${btn}</div>`;
  }
  // Mueve una línea: cam = 1 (camión CD) | 2 (2º camión) | 0 (no carga) | 'auto' (vuelve a la regla).
  async function moverLinea(ce, docu, mat, cam) {
    const r = resultado.find(x => x.ce === ce);
    if (!r || bloqueadoPorCierre()) return;
    const k = `${docu}|${mat}`;
    const { error } = cam === 'auto'
      ? await supabase.from('abast_plan_linea_camion').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce).eq('documento', docu).eq('material', mat)
      : await supabase.from('abast_plan_linea_camion').upsert({ fecha: hoyIsoPlan, cd_origen: planOrigen, ce, documento: docu, material: mat, camion: Number(cam), origen: 'manual', updated_by: await getUserEmail(), updated_at: new Date().toISOString() }, { onConflict: 'fecha,cd_origen,ce,documento,material' });
    if (error) { showAlert('No se pudo mover la línea: ' + error.message, 'error'); return; }
    if (cam === 'auto') r.asig.delete(k); else r.asig.set(k, Number(cam));
    refrescarFill(r);
    // Si el 2º camión ya estaba aceptado, se actualiza su tonelaje.
    if (segAcept.has(ce)) await supabase.from('abast_plan_segundo_camion').update({ ton_propuesta: Math.round(r.tonSegundo * 10000) / 10000 }).eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce);
    draw();
  }
  async function restablecerAuto(ce) {
    const r = resultado.find(x => x.ce === ce);
    if (!r || bloqueadoPorCierre()) return;
    const { error } = await supabase.from('abast_plan_linea_camion').delete().eq('fecha', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', ce);
    if (error) { showAlert('No se pudo restablecer: ' + error.message, 'error'); return; }
    r.asig.clear(); refrescarFill(r);
    showAlert(`${r.nombre}: carga vuelve al llenado automático.`, 'success');
    draw();
  }
  async function unirDirectos(ce, docs, tipo) {
    if (bloqueadoPorCierre()) return;
    if (!docs.length) { showAlert('Selecciona al menos una OC.', 'error'); return; }
    const { error } = await supabase.from('abast_plan_camion_manual').insert({ fecha: hoyIsoPlan, cd_origen: planOrigen, ce, tipo, docs, creado_por: await getUserEmail() });
    if (error) { showAlert('No se pudo armar el camión: ' + error.message, 'error'); return; }
    showAlert('Camión directo armado.', 'success');
    st.tab = 'cd';
    renderPlanCarga(stage);
  }
  async function deshacerManual(id) {
    if (bloqueadoPorCierre()) return;
    const { error } = await supabase.from('abast_plan_camion_manual').delete().eq('id', id);
    if (error) { showAlert('No se pudo deshacer: ' + error.message, 'error'); return; }
    showAlert('Camión directo deshecho: las OC vuelven a la regla automática.', 'success');
    st.tab = 'cd';
    renderPlanCarga(stage);
  }
  function ajustesHtml(r, fill) {
    if (!fill.nManual) return '';
    const cerrado = estadoCierre().cerrado;
    return `<div class="pc-extra"><span class="material-symbols-outlined">tune</span><div style="flex:1;min-width:0"><b>${fill.nManual} línea${fill.nManual > 1 ? 's' : ''} con asignación manual/confirmada</b>${fill.tonNoCarga > 0.05 ? ` · ${t1(fill.tonNoCarga)} t marcadas «no carga»` : ''}. La foto de las ${HHMM_CIERRE} respeta estos ajustes.</div>
      ${PUEDE_AJUSTAR && !cerrado ? `<button class="sv-btn" data-restablecer="${escapeHtml(r.ce)}"><span class="material-symbols-outlined">restart_alt</span>Restablecer automático</button>` : ''}</div>`;
  }
  function segundoHtml(r, fill) {
    if (!(fill.excede > 0.05) && !fill.manual2) return ajustesHtml(r, fill);
    if (!r.segundoPropuesto) {
      return `<div class="pc-extra is-mute"><span class="material-symbols-outlined">info</span><div>No caben ${t1(fill.excede)} t, pero no llegan al 85% de un camión (${t1(r.cap * UMBRAL_SEGUNDO_CAMION)} t): no se propone 2º camión. Las líneas atenuadas quedan para el próximo plan${PUEDE_AJUSTAR ? '; si igual quieres un 2º camión, mueve líneas con «→ 2º»' : ''}.</div></div>` + ajustesHtml(r, fill);
    }
    const acept = segAcept.has(r.ce), cerrado = estadoCierre().cerrado;
    const pct2 = r.cap > 0 ? Math.round(r.tonSegundo / r.cap * 100) : 0;
    const prog2 = !!progMap.get(`${r.ce}|2`);
    const btn = PUEDE_AJUSTAR && !cerrado
      ? `<button class="${acept ? 'sv-btn' : 'sv-btn-p'}" data-seg-accion="${acept ? 'quitar' : 'aceptar'}" data-seg-ce="${escapeHtml(r.ce)}"><span class="material-symbols-outlined">${acept ? 'remove_circle' : 'task_alt'}</span>${acept ? 'Quitar 2º camión' : 'Aceptar 2º camión'}</button>` : '';
    // (4-oct-2026, Jordan) El 2º camión sugerido es una opción: al aceptarlo se despliegan sus SKU
    // y el botón para agregar los datos del transporte.
    const txt = acept
      ? (prog2 ? `Programado: entra a la foto de las ${HHMM_CIERRE}, al correo y a los indicadores.` : `Aceptado: carga confirmada. Agrega los datos del transporte para programarlo.`) + (cerrado ? '' : ' Puedes seguir moviendo líneas hasta el cierre.')
      : `${fill.manual2 ? 'Armado a mano.' : 'Lo que no cabe llega al 85% de un camión.'} Es opcional: al aceptarlo se confirma la carga de ambos camiones y se despliega el detalle de SKU para agregar los datos del transporte.${cerrado ? ' Plan cerrado: ya no se puede aceptar.' : ''}`;
    return `<div class="pc-extra pc-seg2 ${acept ? 'is-ok' : ''}"><span class="material-symbols-outlined">${acept ? 'check_circle' : 'add_circle'}</span>
      <div style="flex:1;min-width:0"><b>${acept ? (prog2 ? '2º camión programado' : '2º camión aceptado') : '2º camión sugerido'}</b> · ${t1(r.tonSegundo)} t de ${fmtNum(r.cap, 0)} t (${pct2}%). ${escapeHtml(txt)}
      ${st.tab === 'seg' || !acept ? '' : `<small>El detalle de SKU está en la pestaña «2º camión».</small>`}</div>${btn}</div>` + (acept && st.tab === 'seg' ? progHtml(r, 2) : '') + ajustesHtml(r, fill);
  }
  function estadoCierre() {
    const now = new Date(), c = new Date(now); c.setHours(CIERRE_H, CIERRE_M, 0, 0);
    if (now >= c) {
      const foto = fotoCierre ? ` · foto ${fotoCierre.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : '';
      return { cerrado: true, html: `<span class="pc-cierre is-cerrado" title="El plan del día se cerró a las ${HHMM_CIERRE}. ${fotoCierre ? 'La foto de cierre quedó guardada y es la que se mide en Indicadores.' : 'La foto de cierre se guarda a las ' + HHMM_CIERRE + ' (servidor).'}"><span class="material-symbols-outlined">lock</span>Plan cerrado · ${HHMM_CIERRE}${foto}</span>` };
    }
    const mins = Math.max(0, Math.round((c - now) / 60000));
    return { cerrado: false, html: `<span class="pc-cierre" title="El plan se cierra automáticamente a las ${HHMM_CIERRE}"><span class="material-symbols-outlined">schedule</span>Abierto · cierra ${HHMM_CIERRE} (faltan ${mins >= 60 ? Math.floor(mins / 60) + 'h ' : ''}${mins % 60}m)</span>` };
  }

  const TAG = (icon, lbl, tip, cls) => `<span class="pc-tag ${cls}" title="${escapeHtml(tip)}"><span class="material-symbols-outlined">${icon}</span>${escapeHtml(lbl)}</span>`;
  function tagsV2(r, enPanel = false) {
    const t = [];
    const pg = progMap.get(`${r.ce}|1`);
    if (pg) t.push(TAG('task_alt', 'Programado', `Camión CD programado · patente ${pg.patente_camion} · ${pg.transportista || pg.id_transporte}`, 'seg-ok'));
    if (r.enCalendario) t.push(TAG('calendar_today', 'Agenda', 'En calendario de despacho', 'agenda'));
    if (!r.enCalendario && r.pct >= 70) t.push(TAG('add_circle', 'Cupo extra', 'Fuera de agenda con carga ≥70%', 'extra'));
    if (r.enCalendario && r.pct < 70) t.push(TAG('warning', 'Carga baja', 'En calendario con carga <70%', 'baja'));
    if (r.promovido24) t.push(TAG('fast_forward', '48h→24h', 'Adelantado: la carga de mañana supera el 90%', 'promo'));
    else if (r.horizonte === 48) t.push(TAG('schedule', '48h', 'Horizonte 48h · ' + diaCorto(diaHabil2), 'h48'));
    // (el 2º camión se muestra como chip junto al estado de la fila; aquí sólo en el panel)
    if (r.segundoPropuesto && enPanel) t.push(segAcept.has(r.ce)
      ? TAG('local_shipping', '2º camión programado', `2º camión aceptado (${t1(r.tonSegundo)} t): entra a la foto de las ${HHMM_CIERRE} y a los indicadores`, 'seg-ok')
      : TAG('local_shipping', '2º camión opcional', `Lo que no cabe (${t1(r.excedente)} t) llega al 85% de un camión: se puede programar un 2º camión de ${t1(r.tonSegundo)} t`, 'extra'));
    if (r.tonClienteDiferido > 0) t.push(TAG('event_upcoming', 'CD-Cliente próximo', `CD-Cliente con fecha de entrega posterior: ${t1(r.tonClienteDiferido)} t`, 'h48'));
    return t.join('');
  }
  // Camión a escala: segmentos por categoría (orden de llenado) + espacio libre rayado
  function camionHtml(r) {
    let acc = 0;
    const segs = [], chicos = [];
    CAT_V2.forEach((c, i) => {
      const v = c.ton(r);
      if (!(v > 0)) return;
      const inC = Math.max(0, Math.min(v, r.cap - acc));
      acc += v;
      if (inC <= 0) { chicos.push({ color: c.color, lbl: c.lbl + ' (no cabe)', ton: v }); return; }
      const w = inC / r.cap * 100;
      segs.push(`<div class="pc-seg" title="${escapeHtml(c.lbl)}: ${t1(v)} t" style="width:calc(${w.toFixed(2)}% - 2px);background:${c.color};color:${CAT_FG[i]}">${w >= 5.5 ? `<b>${t1(inC)}</b>` : ''}${w >= 11 ? `<small>${escapeHtml(CAT_CORTO[i])}</small>` : ''}</div>`);
      if (w < 5.5) chicos.push({ color: c.color, lbl: c.lbl, ton: inC });
    });
    const libre = r.faltan > 0.05 ? `<div class="pc-free">${r.faltan / r.cap >= 0.12 ? `Libre ${t1(r.faltan)} t` : ''}</div>` : '';
    return `<div class="pc-truckw"><div class="pc-truck"><div class="pc-box">${segs.join('')}${libre}</div><div class="pc-cab"></div></div>
      ${chicos.length ? `<div class="pc-small">${chicos.map(s => `<span><i style="background:${s.color}"></i>${escapeHtml(s.lbl)} <b>${t1(s.ton)} t</b></span>`).join('')}</div>` : ''}</div>`;
  }
  function directosV2(r) {
    const chips = DIR_V2.filter(t => (r[t.lista] || []).length).map(t => {
      const cams = r[t.lista]; const ton = cams.reduce((s, c) => s + c.ton, 0);
      const man = cams.some(c => c.manualId);
      return `<span class="pc-dir" title="${escapeHtml(t.tip)}${man ? ' · armado a mano' : ''}"><span class="material-symbols-outlined" style="color:${t.color}">local_shipping</span>${escapeHtml(t.lbl)}${man ? ' (manual)' : ''} · ${t1(ton)} t${cams.length > 1 ? `<em style="background:${t.color}" title="Se requieren ${cams.length} camiones">X${cams.length}</em>` : ''}</span>`;
    });
    const pc = DIR_V2.flatMap(t => r[t.lista] || []).filter(porConfirmar);
    if (pc.length) chips.push(`<button class="pc-dir" data-trconf="${escapeHtml(r.ce)}" title="Camiones directos coordinados con un transportista BLOQUEADO en el maestro: completa sus datos para confirmarlos (hasta entonces no entran a la foto, correo ni Seguimiento)" style="border-color:#f59e0b;background:#fef3c7;color:#713f12;cursor:pointer"><span class="material-symbols-outlined" style="color:#b45309">pending_actions</span>Transporte por confirmar · ${pc.length}</button>`);
    const cand = r.fabCandidatos || [];
    if (cand.length) {
      const tc = cand.reduce((s, x) => s + x.ton, 0);
      chips.push(`<button class="pc-dir" data-dirman-open="${escapeHtml(r.ce)}" title="Retiros directos coordinados para mañana que no llegan al 85% por proveedor/cliente: ábrelo para unirlos en un camión" style="border-style:dashed;cursor:pointer"><span class="material-symbols-outlined" style="color:#b45309">merge</span>${cand.length} OC sin camión · ${t1(tc)} t</button>`);
    }
    return chips.length ? chips.join('') : '<span class="pc-nodir">Sin directos</span>';
  }
  // Chip del 2º camión en la fila: abre el panel en la pestaña «2º camión» con su contenido.
  function segChip(r) {
    const ok = segAcept.has(r.ce), pct2 = r.cap > 0 ? Math.round(r.tonSegundo / r.cap * 100) : 0;
    return `<button class="pc-segchip ${ok ? 'is-ok' : ''}" data-seg-open="${escapeHtml(r.ce)}" title="${ok ? '2º camión programado' : '2º camión opcional (sin aceptar)'} · ${pct2}% de ${fmtNum(r.cap, 0)} t — ver contenido"><span class="material-symbols-outlined">local_shipping</span>2º camión · ${t1(r.tonSegundo)} t${ok ? ' ✓' : ''}<span class="material-symbols-outlined">chevron_right</span></button>`;
  }
  function filaV2(r) {
    const e = estadoV2(r);
    const pctC = r.pct >= 80 ? '#15803d' : r.pct >= 70 ? '#a16207' : '#b5000b';
    const fs = r.sobrecarga > 0 ? `<span style="color:#15803d">Sobran ${t1(r.sobrecarga)} t</span>` : `<span style="color:${r.pct < 70 ? '#b5000b' : '#5c5f61'}">Faltan ${t1(r.faltan)} t</span>`;
    return `<div class="pc-row ${r.enCalendario && r.pct >= 70 ? 'is-agenda' : ''} ${st.drawer === r.ce ? 'is-sel' : ''}" role="button" tabindex="0" data-chip data-suc="${escapeHtml(r.ce)}">
      <div class="pc-suc"><div><b>${escapeHtml(r.nombre)}</b><span class="sv-mono">${escapeHtml(r.ce)}</span></div><div class="pc-tags">${tagsV2(r)}</div></div>
      <div class="pc-carga">${r.total > 0 ? camionHtml(r) : '<div class="pc-truckw"><span class="sv-muted">Sin carga para el camión CD</span></div>'}</div>
      <div class="pc-estado">
        <div class="pc-pct"><b style="color:${pctC}">${Math.min(r.pct, 100)}%</b><small>${t1(Math.min(r.total, r.cap))} / ${fmtNum(r.cap, 0)} t</small></div>
        <div class="pc-est-r">${pillEstado(e)}${fs}${r.segundoPropuesto ? segChip(r) : ''}</div>
      </div>
      <div class="pc-dirs"><span class="pc-lbl">Camiones directos</span>${directosV2(r)}</div>
    </div>`;
  }

  // ── Panel lateral (sólo lectura) ─────────────────────────────────────────
  function tablaItems(tipo, items, color, accFn) {
    const head = { T: ['Pedido', 'Material', 'Fecha', 'Cant.', 'Ton'], V: ['Pedido de venta', 'Material', 'Fecha', 'Cant.', 'Ton'], R: ['Orden de compra', 'Material', 'Fecha retiro', 'Cant.', 'Ton'], X: ['Pedido traslado', 'Material', 'Fecha', 'Cant.', 'Ton'] }[tipo];
    const sub = d => tipo === 'V' ? (d.cliente || '') : tipo === 'R' ? (d.prov || '') : (d._motivo ? d._motivo + ' · ' + (d.material || '') : (d.material || ''));
    const doc = d => tipo === 'V' ? d.pv : tipo === 'R' ? d.oc : d.pt;
    const cant = d => tipo === 'X' ? fmtNum(d.ctdPend, 0) : tipo === 'T' ? escapeHtml(d.ctd ?? '') : fmtNum(parseNum(d.cant), 0);
    return `<div class="pc-tbl"><table class="sv-table"><thead><tr>${head.map((h, i) => `<th class="${i >= 3 ? 'r' : ''}">${escapeHtml(h)}</th>`).join('')}${accFn ? '<th class="r">Mover</th>' : ''}</tr></thead>
      <tbody>${items.map(d => `<tr class="${d._enCamion === false ? (d._camion2 ? 'is-seg' : 'is-fuera') : ''}" title="${d._enCamion === false ? (d._camion2 ? 'Va en el 2º camión (opcional)' : 'No cabe: queda para el próximo plan') : ''}">
        <td><span class="sv-mono">${escapeHtml(String(doc(d) ?? ''))}</span></td>
        <td><div class="pc-mat"><b>${escapeHtml(d.nombre || '')}</b><small>${escapeHtml(sub(d))}</small></div></td>
        <td class="sv-mono">${escapeHtml(d.fecha || '')}</td><td class="r">${cant(d)}</td><td class="r"><b>${fmtNum(d.ton, 2)}</b></td>${accFn ? `<td class="r" style="white-space:nowrap">${accFn(d)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  const kv = pares => `<div class="pc-kv">${pares.filter(Boolean).map(([k, v]) => `<div><span>${escapeHtml(k)}</span><b>${v}</b></div>`).join('')}</div>`;
  const grupoHtml = (color, titulo, items, tipo, accFn) => {
    const ton = items.reduce((s, d) => s + (d.ton || 0), 0);
    return `<div class="pc-grp"><div class="pc-grp-h"><i style="background:${color}"></i><b>${escapeHtml(titulo)}</b><small>${items.length} líneas · ${t1(ton)} t</small></div>${tablaItems(tipo, items, color, accFn)}</div>`;
  };
  // (1-oct-2026) Botones para mover una línea entre camión CD, 2º camión y «no carga».
  const MV_STYLE = 'font-size:11px;font-weight:700;padding:1px 6px;margin-left:3px;border:1px solid #c5c7c9;border-radius:6px;background:#fff;cursor:pointer';
  function accMover(r, enTab) {
    if (!PUEDE_AJUSTAR || estadoCierre().cerrado) return null;
    const b = (d, cam, lbl, tip) => `<button style="${MV_STYLE}" title="${escapeHtml(tip)}" data-mover="${escapeHtml(r.ce)}" data-doc="${escapeHtml(docLinea(d))}" data-mat="${escapeHtml(matLinea(d))}" data-cam="${cam}">${lbl}</button>`;
    return d => {
      const out = [];
      if (d._manual !== null) out.push(`<span style="font-size:10px;color:#7c3aed;font-weight:700" title="Asignación manual/confirmada">${d._manual === 0 ? 'NO CARGA' : 'FIJO'}</span>`);
      if (enTab === 'seg') { out.push(b(d, 1, '→ CD', 'Pasar al camión CD'), b(d, 0, 'Sacar', 'No cargar hoy')); }
      else if (d._enCamion) { out.push(b(d, 2, '→ 2º', 'Pasar al 2º camión'), b(d, 0, 'Sacar', 'No cargar hoy')); }
      else { out.push(b(d, 1, '→ CD', 'Cargar en el camión CD'), b(d, 2, '→ 2º', 'Cargar en el 2º camión')); }
      if (d._manual !== null) out.push(b(d, 'auto', '↺', 'Volver a la regla automática'));
      return out.join('');
    };
  }
  // (1-oct-2026) Retiros directos sin camión: unir OC (distintos proveedores/clientes) en un camión.
  function dirManHtml(r) {
    const cand = r.fabCandidatos || [];
    const editable = PUEDE_AJUSTAR && !estadoCierre().cerrado;
    const manuales = [...(r.camionesFabSuc || []), ...(r.camionesFabCli || [])].filter(c => c.manualId);
    const tipoLbl = t => t === 'fabCli' ? 'Fáb-Cliente' : 'Fáb-Sucursal';
    let h = `<div class="sv-note-box" style="margin-bottom:10px">Retiros directos (no FAB-CD) coordinados con fecha de retiro ${escapeHtml(cap1(diaCorto(diaHabil1)))} que no llegan al 85% por proveedor/cliente. Marca las OC que viajan juntas y únelas en un camión directo (28 t).</div>`;
    if (manuales.length) h += `<div class="pc-grp"><div class="pc-grp-h"><i style="background:#1d4ed8"></i><b>Camiones armados a mano</b></div>` + manuales.map(c =>
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #edeeef"><span class="material-symbols-outlined" style="color:#1d4ed8">local_shipping</span><div style="flex:1;min-width:0"><b>${escapeHtml(c.grupo)}</b><br><small>${[...new Set(c.items.map(d => d.oc))].map(escapeHtml).join(', ')} · ${t1(c.ton)} t (${Math.round(c.ton / c.cap * 100)}% de ${fmtNum(c.cap, 0)} t)</small></div>${editable ? `<button class="sv-btn" data-deshacer-man="${c.manualId}"><span class="material-symbols-outlined">undo</span>Deshacer</button>` : ''}</div>`).join('') + '</div>';
    if (!cand.length) return h + (manuales.length ? '' : '<div class="sv-note-box">No hay retiros directos sin camión para esta sucursal.</div>');
    h += `<div class="pc-tbl"><table class="sv-table"><thead><tr>${editable ? '<th></th>' : ''}<th>Orden de compra</th><th>Proveedor / cliente</th><th>Tipo</th><th class="r">Ton</th></tr></thead><tbody>`
      + cand.map(x => `<tr>${editable ? `<td><input type="checkbox" data-dm-oc="${escapeHtml(x.oc)}" data-dm-ton="${x.ton}" data-dm-tipo="${x.tipo}"></td>` : ''}<td><span class="sv-mono">${escapeHtml(x.oc)}</span></td><td><div class="pc-mat"><b>${escapeHtml(x.prov || '')}</b><small>${escapeHtml(x.cliente || '')}</small></div></td><td>${tipoLbl(x.tipo)}</td><td class="r"><b>${t1(x.ton)}</b></td></tr>`).join('')
      + '</tbody></table></div>';
    if (editable) h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
        <span>Seleccionado: <b data-dm-sum>0,0 t</b> de ${fmtNum(CAP_CAMION_DIRECTO, 0)} t</span>
        <select data-dm-tipo-sel class="sv-btn" style="padding:4px 8px"><option value="fabSuc">Fábrica-Sucursal</option><option value="fabCli">Fábrica-Cliente</option></select>
        <button class="sv-btn-p" data-dm-unir="${escapeHtml(r.ce)}"><span class="material-symbols-outlined">merge</span>Unir en un camión</button></div>`;
    return h;
  }
  function drawerBody(r, tab) {
    if (tab === 'seg') {
      const fill = marcarCapacidadCD(r);
      const acept = segAcept.has(r.ce);
      const pct2 = r.cap > 0 ? Math.round(r.tonSegundo / r.cap * 100) : 0;
      const noCabe = Math.max(0, fill.excede - r.tonSegundo);
      const accS = accMover(r, 'seg');
      const grupos = acept ? CAT_V2.map((c, i) => { const it = (r.det[c.k] || []).filter(d => d._camion2); return it.length ? grupoHtml(c.color, CAT_LARGO[i], it, c.tipo, accS) : ''; }).join('') : '';
      const prog2 = !!progMap.get(`${r.ce}|2`);
      return kv([
          ['Carga', `${t1(r.tonSegundo)} t · ${pct2}%`], ['Capacidad', `${fmtNum(r.cap, 0)} t`],
          ['Estado', !acept ? '<span class="pc-st" style="background:#edeeef;color:#444749"><i style="background:#8e9192"></i>Sugerido · sin aceptar</span>'
            : prog2 ? '<span class="pc-st" style="background:#dcfce7;color:#14532d"><i style="background:#15803d"></i>Programado</span>'
            : '<span class="pc-st" style="background:#fef3c7;color:#713f12"><i style="background:#ca8a04"></i>Aceptado · sin transporte</span>'],
          ['No cabe en ningún camión', noCabe > 0.05 ? `${t1(noCabe)} t` : '—'],
          fill.tonNoCarga > 0.05 ? ['No carga (manual)', `${t1(fill.tonNoCarga)} t`] : null,
        ])
        + segundoHtml(r, fill)
        + (!acept ? '<div class="sv-note-box">Acepta el 2º camión para ver los SKU y el detalle que considera.</div>' : (grupos || '<div class="sv-note-box">Sin líneas para el 2º camión.</div>'));
    }
    if (tab === 'cd') {
      const fill = marcarCapacidadCD(r);
      const e = estadoV2(r);
      return kv([
          ['Capacidad', `${fmtNum(r.cap, 0)} t`], ['Cargado', `${t1(fill.cargado)} t · ${Math.min(r.pct, 100)}%`],
          r.sobrecarga > 0 ? ['Sobra', `<span style="color:#15803d">+${t1(r.sobrecarga)} t</span>`] : ['Faltan', `<span style="color:${r.pct < 70 ? '#b5000b' : 'inherit'}">${t1(r.faltan)} t</span>`],
          ['Estado', pillEstado(e)],
          ['Horizonte', `${r.horizonte}h${r.promovido24 ? ' (adelantado desde 48h)' : ''}`], ['Día objetivo', escapeHtml(cap1(diaCorto(diaObj(r))))],
          ['Agenda', r.enCalendario ? 'En calendario del día' : 'Fuera de agenda'],
          r.tonClienteDiferido > 0 ? ['CD-Cliente próximo', `${t1(r.tonClienteDiferido)} t`] : null,
        ])
        + progHtml(r, 1)
        + segundoHtml(r, fill)
        // (4-oct-2026, Jordan) Sólo lo que va en el camión; lo que queda fuera se ve en el CSV.
        + ((() => { const accC = accMover(r, 'cd'); return CAT_V2.map((c, i) => { const it = (r.det[c.k] || []).filter(d => d._enCamion); return it.length ? grupoHtml(c.color, CAT_LARGO[i], it, c.tipo, accC) : ''; }).join(''); })() || '<div class="sv-note-box">El camión CD no tiene carga para esta sucursal.</div>')
        + ((() => { const fuera = CAT_V2.reduce((s2, c) => s2 + (r.det[c.k] || []).filter(d => !d._enCamion && !d._camion2).reduce((a2, d) => a2 + (d.ton || 0), 0), 0);
            return fuera > 0.05 ? `<div class="sv-dr-note" style="margin-top:8px">${t1(fuera)} t quedan fuera del camión (no se muestran); el detalle completo está en «Descargar sucursal (CSV)».</div>` : ''; })());
    }
    if (tab === 'dirman') return dirManHtml(r);
    const [tk, n] = tab.split(':');
    const t = DIR_V2.find(x => x.k === tk);
    const lista = r[t.lista] || [];
    const c = lista.find(x => String(x.n) === n) || lista[0];
    if (!c) return '<div class="sv-note-box">Sin camiones.</div>';
    const pct = c.cap > 0 ? Math.round(c.ton / c.cap * 100) : 0;
    return kv([['Carga', `${t1(c.ton)} t · ${pct}%`], ['Capacidad', `${fmtNum(c.cap, 0)} t`], [c.manualId ? 'Unión manual' : (c.patente ? 'Despacho' : t.grupo), escapeHtml(c.grupo || '')], ['Camión', `${c.n} de ${lista.length}`],
        c.patente ? ['Patentes', escapeHtml(`Camión ${c.patente}${c.patenteCarro ? ' · Carro ' + String(c.patenteCarro).toUpperCase() : ''}`)] : null,
        c.transportista ? ['Transporte', escapeHtml(c.transportista)] : null,
        c.chofer ? ['Chofer', escapeHtml(c.chofer)] : null])
      + grupoHtml(t.color, `Contenido del camión ${c.n} de ${lista.length}`, c.items, t.tipo);
  }
  function drawerHtml(r) {
    const tabs = [{ k: 'cd', lbl: `Camión CD · ${Math.min(r.pct, 100)}%`, color: '#444749' }];
    if (r.segundoPropuesto) tabs.push({ k: 'seg', lbl: `2º camión · ${t1(r.tonSegundo)} t${segAcept.has(r.ce) ? '' : ' (opcional)'}`, color: '#15803d' });
    DIR_V2.forEach(t => (r[t.lista] || []).forEach(c => tabs.push({ k: `${t.k}:${c.n}`, lbl: `${t.lbl}${(r[t.lista] || []).length > 1 ? ' ' + c.n : ''} · ${t1(c.ton)} t`, color: t.color })));
    if ((r.fabCandidatos || []).length || [...(r.camionesFabSuc || []), ...(r.camionesFabCli || [])].some(c => c.manualId))
      tabs.push({ k: 'dirman', lbl: `Unir directos${(r.fabCandidatos || []).length ? ' · ' + r.fabCandidatos.length + ' OC' : ''}`, color: '#b45309' });
    if (!tabs.some(x => x.k === st.tab)) st.tab = 'cd';
    const foot = st.tab === 'cd' ? 'Orden de llenado: REVEX → Venta → Retiro → Cross → Quiebre → Abastecimiento'
      : st.tab === 'seg' ? 'Lo que no cabe en el camión CD, en el mismo orden de llenado (se propone si llega al 85% de la capacidad o si se mueven líneas a mano)'
      : st.tab === 'dirman' ? 'Unión manual de retiros directos: vale sólo para el plan de hoy'
      : (DIR_V2.find(x => st.tab.startsWith(x.k))?.tip || '');
    return `<div class="sv-dr-bg" data-close></div>
      <aside class="sv-dr pc-dr" role="dialog" aria-label="Plan de carga de ${escapeHtml(r.nombre)}">
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">Plan de carga · ${escapeHtml(CALENDARIOS[planOrigen]?.nombre || planOrigen)} → sucursal</div>
          <div class="sv-dr-t" style="font-family:inherit;font-weight:700">${escapeHtml(r.nombre)} <span class="sv-mono" style="font-size:16px;color:#5c5f61">${escapeHtml(r.ce)}</span></div>
          <div class="pc-tags" style="margin-top:6px">${tagsV2(r, true)}</div></div>
          <button class="sv-iconbtn" data-close title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-tabs pc-tabs">${tabs.map(t => `<button data-chip data-tab-plan="${escapeHtml(t.k)}" class="${st.tab === t.k ? 'is-on' : ''}"><span class="material-symbols-outlined" style="color:${t.color}">local_shipping</span>${escapeHtml(t.lbl)}</button>`).join('')}</div>
        <div class="sv-dr-b">${drawerBody(r, st.tab)}</div>
        <div class="sv-dr-f"><span class="sv-dr-note">${escapeHtml(foot)}</span>
          <button class="sv-btn" data-descarga="${escapeHtml(r.ce)}"><span class="material-symbols-outlined">download</span>Descargar sucursal (CSV)</button></div>
      </aside>`;
  }

  // ── Descarga CSV (formato 4.8 + columnas de referencia) ─────────────────
  const CSV_V21 = ['Origen', 'Centro destino', 'Sucursal', 'Estado plan', 'Horizonte', 'Día objetivo', 'Camión', 'Categoría', 'Documento', 'Material', 'Detalle', 'Fecha', 'Cantidad', 'Toneladas', 'En camión', '% carga camión', 'Estado sucursal',
    'Id Material', 'Pedido de Venta', 'Proveedor', 'Entrega Entrante', 'Ruta', 'Comuna', 'Tipo Expedición', 'Ton Bruto', 'Ton Vol', 'Usuario', 'Motivo Prioridad', 'Entra a indicador',
    'Patente camión', 'Patente carro', 'Transporte', 'Chofer'];
  const CAT_CSV = ['REVEX', 'Venta directa', 'Retiro proveedor', 'Crossdocking', 'Quiebre y priorizado', 'Abastecimiento'];
  function filasCsvV21(r, cerrado) {
    marcarCapacidadCD(r);
    const orNom = `${planOrigen} ${CALENDARIOS[planOrigen]?.nombre || ''}`.trim();
    const base = [orNom, r.ce, r.nombre, cerrado ? 'Cerrado' : 'Abierto', r.horizonte + 'h', isoLocal(diaObj(r))];
    const fT = v => (v == null ? '' : fmtNum(v, 4));
    const linea = (camion, cat, tipo, d, enCam, pctTxt, estado) => {
      const doc = tipo === 'V' ? d.pv : tipo === 'R' ? d.oc : d.pt;
      const det = tipo === 'V' ? (d.cliente || '') : tipo === 'R' ? (d.prov || '') : (d._motivo || '');
      const cant = tipo === 'X' ? fmtNum(d.ctdPend, 1) : tipo === 'T' ? (d.ctd ?? '') : fmtNum(parseNum(d.cant), 1);
      return base.concat([camion, cat, doc ?? '', d.nombre || '', det, d.fecha || '', cant, fmtNum(d.ton, 2), enCam, pctTxt, estado,
        d.material || '', tipo === 'V' ? '' : (d.pv || ''), tipo === 'R' ? (d.prov || '') : '', d.entrega_entrante || '', d.ruta || '', d.comuna || '', d.tipoExp || '',
        fT(d.tonBruto), fT(d.tonVol), d.usuario || '', d._motivo || '']);
    };
    const out = [];
    const e = estadoV2(r).lbl, pctCd = Math.min(r.pct, 100) + '%';
    const acept = segAcept.has(r.ce);
    // (4-oct-2026, Jordan) El CSV trae todo: camión CD, 2º camión, directos y lo que queda fuera.
    const p1 = progMap.get(`${r.ce}|1`), p2 = progMap.get(`${r.ce}|2`);
    const trp = p => p ? [p.patente_camion || '', p.patente_carro || '', [p.id_transporte, p.transportista].filter(Boolean).join(' · '), [p.chofer_nombre, p.chofer_rut, p.chofer_telefono].filter(Boolean).join(' · ')] : ['', '', '', ''];
    const camTxt = d => d._enCamion ? 'Camión CD' : d._camion2 ? '2º camión' : 'Fuera del camión';
    const enCamTxt = d => d._enCamion ? 'Sí' : d._camion2 ? (acept ? (p2 ? '2º camión (programado)' : '2º camión (aceptado, sin transporte)') : '2º camión (sugerido, sin aceptar)') : (d._manual === 0 ? 'No carga (manual)' : 'No cabe');
    const mide = d => (d._enCamion ? !!p1 : (d._camion2 && acept && !!p2)) ? 'Sí' : 'No';
    CAT_V2.forEach((c, i) => (r.det[c.k] || []).forEach(d => out.push(linea(camTxt(d), CAT_CSV[i], c.tipo, d, enCamTxt(d),
      d._camion2 ? (r.cap > 0 ? Math.round(r.tonSegundo / r.cap * 100) : 0) + '%' : d._enCamion ? pctCd : '', e).concat([mide(d)], trp(d._enCamion ? p1 : d._camion2 ? p2 : null)))));
    DIR_V2.forEach(t => (r[t.lista] || []).forEach(cm => cm.items.forEach(d => out.push(linea(`${t.csv} ${cm.n}`, t.csv, t.tipo, d, 'Sí', (cm.cap > 0 ? Math.round(cm.ton / cm.cap * 100) : 0) + '%', '').concat(['Sí'],
      cm.patente ? [cm.patente, cm.patenteCarro || '', cm.transportista || '', cm.chofer || ''] : ['', '', '', ''])))));
    (r.fabCandidatos || []).forEach(x => (x.items || []).forEach(d => out.push(linea('Directo sin camión', x.tipo === 'fabCli' ? 'Fáb-Cliente' : 'Fáb-Sucursal', 'R', d, 'No (sin camión)', '', '').concat(['No', '', '', '', '']))));
    return out;
  }
  function descargarCsvV21(lista, nombre) {
    const cerrado = estadoCierre().cerrado;
    const filas = [];
    lista.forEach(r => filasCsvV21(r, cerrado).forEach(f => filas.push(f)));
    bajarCsv(CSV_V21, filas, nombre);
  }

  // (4-oct-2026, Jordan) El correo de las 08:30 / 12:30 / 15:30 se genera desde esta vista:
  // cada vez que se dibuja (antes del cierre) se guarda el estado de cada sucursal y el contenido
  // de los camiones programados (abast_plan_estado_correo / abast_plan_camion_programado.lineas).
  const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
  const lineaCorreo = (cat, tipo, d) => ({ cat, doc: String((tipo === 'V' ? d.pv : tipo === 'R' ? d.oc : d.pt) ?? '').trim(), material: String(d.material ?? ''), nombre: d.nombre || '',
    cant: r4(tipo === 'X' ? d.ctdPend : parseNum(tipo === 'T' ? d.ctd : d.cant)), ton: r4(d.ton), fecha: d.fecha || '',
    pv: tipo === 'V' ? '' : String(d.pv ?? ''), prov: d.prov || '', cliente: d.cliente || '', entrega_entrante: d.entrega_entrante || '',
    ruta: d.ruta || '', comuna: d.comuna || '', ton_bruto: d.tonBruto == null ? null : r4(d.tonBruto), ton_vol: d.tonVol == null ? null : r4(d.tonVol) });
  function estadoCorreoFila(r) {
    marcarCapacidadCD(r);
    const lineasDe = pred => { const out = []; CAT_V2.forEach((c, i) => (r.det[c.k] || []).forEach(d => { if (pred(d)) out.push(lineaCorreo(CAT_CSV[i], c.tipo, d)); })); return out; };
    const directos = [];
    DIR_V2.forEach(t => (r[t.lista] || []).forEach(cm => directos.push({ tipo: t.csv, n: cm.n, grupo: cm.grupo || '', ton: r4(cm.ton), cap: cm.cap,
      pct: cm.cap > 0 ? Math.round(cm.ton / cm.cap * 100) : 0, patente: cm.patente || '', patente_carro: cm.patenteCarro || '',
      transportista: (cm.transportista || '') + (porConfirmar(cm) ? ' (POR CONFIRMAR)' : ''), chofer: cm.chofer || '', por_confirmar: !!porConfirmar(cm),
      lineas: cm.patente && !porConfirmar(cm) ? cm.items.map(d => lineaCorreo(t.csv, t.tipo, d)) : [] })));
    const fila = { fecha: hoyIsoPlan, cd_origen: planOrigen, ce: r.ce, nombre: r.nombre, horizonte: r.horizonte, dia_objetivo: isoLocal(diaObj(r)),
      cap: r.cap, total_cd: r4(r.total), pct: r.pct, status: estadoV2(r).lbl.toUpperCase(),
      ton: { ton_revex: r4(r.tonRevex), ton_venta_cons: r4(r.tonVentaCons), ton_retiro: r4(r.tonRetiro), ton_cross: r4(r.tonCross), ton_quiebre: r4(r.tonQuiebre),
        ton_stock: r4(r.tonStock), ton_venta_cliente: r4(r.tonVentaCliente), ton_fab_cli: r4(r.tonFabCli), ton_fab_suc: r4(r.tonFabSuc) },
      segundo: r.segundoPropuesto ? { ton: r4(r.tonSegundo), pct: r.cap > 0 ? Math.round(r.tonSegundo / r.cap * 100) : 0, aceptado: segAcept.has(r.ce) } : null,
      directos };
    const cams = [1, 2].map(cam => {
      const p = progMap.get(`${r.ce}|${cam}`);
      if (!p) return null;
      const lineas = lineasDe(cam === 1 ? (d => d._enCamion) : (d => d._camion2));
      const ton = lineas.reduce((s2, x) => s2 + x.ton, 0);
      return { cam, prog: p.programado_en || '', ton: r4(ton), pct: r.cap > 0 ? Math.round(ton / r.cap * 100) : 0, lineas };
    }).filter(Boolean);
    return { fila, cams };
  }
  // (4-oct-2026, Jordan) Seguimiento de Carga: al programar un camión (consolidable o directo)
  // se guarda su foto (líneas + transportista) en abast_seguimiento_camion / _carga.
  const TIPO_CARGA = { revex: 'REVEX', ventaCons: 'Pedidos de venta CD', retiro: 'Retiro Fábrica', cross: 'Crossdocking', quiebre: 'Quiebres', stock: 'Abastecimiento' };
  const isoDeFecha = f => { const d = parseDateSAP(f); return d ? isoLocal(d) : ''; };
  const orNomPlan = () => `${planOrigen} ${CALENDARIOS[planOrigen]?.nombre || ''}`.trim();
  const lineaSeg = (tipoCarga, tipo, d) => ({ tipo_carga: tipoCarga, documento: String((tipo === 'V' ? d.pv : tipo === 'R' ? d.oc : d.pt) ?? '').trim(),
    n_entrega: String(d.entrega || d.entrega_entrante || ''), material: String(d.material ?? ''), nombre: d.nombre || '',
    cantidad: r4(tipo === 'X' ? d.ctdPend : parseNum(tipo === 'T' ? d.ctd : d.cant)), ton: r4(d.ton), ton_bruta: d.tonBruto == null ? null : r4(d.tonBruto),
    pedido_venta: String(d.pv ?? ''), ruta: d.ruta || '', comuna: d.comuna || '', proveedor: tipo === 'R' ? (d.prov || '') : '', cliente: d.cliente || '' });
  function segCamionCD(r, cam) {
    const p = progMap.get(`${r.ce}|${cam}`);
    if (!p) return null;
    marcarCapacidadCD(r);
    const lineas = [];
    CAT_V2.forEach(c => (r.det[c.k] || []).forEach(d => { if (cam === 1 ? d._enCamion : d._camion2) lineas.push(lineaSeg(TIPO_CARGA[c.k], c.tipo, d)); }));
    const ton = lineas.reduce((s2, x) => s2 + x.ton, 0);
    return { cab: { fecha_plan: hoyIsoPlan, fecha_carga: isoLocal(diaObj(r)), cd_origen: planOrigen, ce: r.ce, tipo_camion: cam === 2 ? '2º camión' : 'Camión CD', clave: cam === 2 ? '2' : 'CD',
      origen: orNomPlan(), destino: `${r.ce} ${r.nombre}`, ton: r4(ton), cap: r.cap, pct: r.cap > 0 ? Math.round(ton / r.cap * 100) : 0,
      id_transporte: p.id_transporte || '', transportista: p.transportista || '', chofer_nombre: p.chofer_nombre || '', chofer_rut: p.chofer_rut || '',
      chofer_telefono: p.chofer_telefono || '', patente_camion: p.patente_camion || '', patente_carro: p.patente_carro || '' }, lineas };
  }
  function segDirectos(r) {
    const out = [];
    DIR_V2.forEach(t => (r[t.lista] || []).forEach(cm => {
      if (!cm.patente) return;          // sólo directos con transporte (patente) coordinado
      if (porConfirmar(cm)) return;     // (5-oct-2026) transportista bloqueado: aún no se programa
      const items = cm.items || [];
      const tp = String(cm.transportista || '').split(' · '), ch = String(cm.chofer || '').split(' · ');
      const provs = [...new Set(items.map(d => d.prov).filter(Boolean))].join(' + ');
      const tc = d => t.k === 'cliente' ? (/cross/i.test(d.tipoExp || '') ? 'Crossdocking' : 'Pedidos de venta CD') : 'Retiro Fábrica';
      out.push({ cab: { fecha_plan: hoyIsoPlan, fecha_carga: isoDeFecha(items[0]?.fecha) || isoLocal(diaObj(r)), cd_origen: planOrigen, ce: r.ce,
        tipo_camion: t.csv, clave: `${cm.patente}|${cm.n}`,
        origen: t.k === 'cliente' ? orNomPlan() : (provs || 'Fábrica'), destino: t.k === 'fabSuc' ? `${r.ce} ${r.nombre}` : `Cliente: ${cm.grupo || ''}`,
        ton: r4(cm.ton), cap: cm.cap, pct: cm.cap > 0 ? Math.round(cm.ton / cm.cap * 100) : 0,
        id_transporte: tp.length > 1 ? tp[0] : '', transportista: tp.length > 1 ? tp.slice(1).join(' · ') : (tp[0] || ''),
        chofer_nombre: ch[0] || '', chofer_rut: ch[1] || '', chofer_telefono: ch[2] || '',
        patente_camion: cm.patente, patente_carro: cm.patenteCarro || '' }, lineas: items.map(d => lineaSeg(tc(d), t.tipo, d)) });
    }));
    return out;
  }
  async function guardarSeguimiento(sg, soloCab = false) {
    const { error } = await supabase.rpc('fn_abast_guardar_seguimiento', { p_cab: sg.cab, p_lineas: soloCab ? null : sg.lineas });
    if (error) console.warn('Seguimiento de Carga: no se pudo guardar', error.message);
    return !error;
  }
  async function quitarSeguimiento(ce, cam) {
    const { error } = await supabase.rpc('fn_abast_quitar_seguimiento', { p_fecha: hoyIsoPlan, p_cd: planOrigen, p_ce: ce, p_tipo: cam === 2 ? '2º camión' : 'Camión CD', p_clave: cam === 2 ? '2' : 'CD' });
    if (error) console.warn('Seguimiento de Carga: no se pudo quitar', error.message);
  }
  async function sincronizarCorreo() {
    if (!PUEDE_AJUSTAR || estadoCierre().cerrado || !resultado.length) return;
    const memo = PLAN_V2_STATE._syncCorreo = PLAN_V2_STATE._syncCorreo || new Map();
    const filas = [], cams = [], segs = [], limp = [];
    // Directos ya guardados hoy en Seguimiento de Carga (una consulta por sesión y origen).
    const kEx = `segex|${hoyIsoPlan}|${planOrigen}`;
    if (!memo.has(kEx)) {
      const { data } = await supabase.from('abast_seguimiento_camion').select('ce,tipo_camion,clave').eq('fecha_plan', hoyIsoPlan).eq('cd_origen', planOrigen);
      memo.set(kEx, (data || []).filter(x => !['Camión CD', '2º camión'].includes(x.tipo_camion) && !String(x.clave || '').startsWith('COORD|')).map(x => `${String(x.ce).trim()}|${x.tipo_camion}|${x.clave}`));
    }
    const existentes = memo.get(kEx);
    resultado.forEach(r => {
      const { fila, cams: cs } = estadoCorreoFila(r);
      // Seguimiento de Carga: camiones CD / 2º programados y directos con patente.
      const sgs = [1, 2].map(cam => segCamionCD(r, cam)).filter(Boolean).concat(segDirectos(r));
      sgs.forEach(sg => { const ks = `seg|${hoyIsoPlan}|${planOrigen}|${r.ce}|${sg.cab.tipo_camion}|${sg.cab.clave}`, ss = JSON.stringify(sg); if (memo.get(ks) !== ss) segs.push({ k: ks, sig: ss, sg }); });
      const vig = sgs.filter(sg => !['Camión CD', '2º camión'].includes(sg.cab.tipo_camion)).map(sg => `${sg.cab.tipo_camion}|${sg.cab.clave}`).sort();
      const kv2 = `segv|${hoyIsoPlan}|${planOrigen}|${r.ce}`, sv = JSON.stringify(vig);
      // Sólo se limpia si hay un directo guardado que ya no existe en el plan (coordinación anulada).
      const sobran = existentes.filter(x => x.startsWith(r.ce + '|') && !vig.includes(x.slice(r.ce.length + 1)));
      if (sobran.length && memo.get(kv2) !== sv) limp.push({ k: kv2, sig: sv, ce: r.ce, vig });
      const k = `${hoyIsoPlan}|${planOrigen}|${r.ce}`, sig = JSON.stringify(fila);
      if (memo.get(k) !== sig) filas.push({ k, sig, fila });
      cs.forEach(c => { const kc = `${k}|${c.cam}`, sc = JSON.stringify(c); if (memo.get(kc) !== sc) cams.push({ k: kc, sig: sc, ce: r.ce, c }); });
    });
    if (!filas.length && !cams.length && !segs.length && !limp.length) return;
    const quien = await getUserEmail(), ahora = new Date().toISOString();
    if (filas.length) {
      const { error } = await supabase.from('abast_plan_estado_correo').upsert(filas.map(f => ({ ...f.fila, actualizado_en: ahora, actualizado_por: quien })), { onConflict: 'fecha,cd_origen,ce' });
      if (error) console.warn('Plan de carga: no se pudo guardar el estado para el correo', error.message);
      else filas.forEach(f => memo.set(f.k, f.sig));
    }
    for (const x of cams) {
      // RPC: sólo actualiza ton/pct/lineas (el transporte lo edita únicamente OWNER).
      const { error } = await supabase.rpc('fn_abast_guardar_lineas_camion', { p_fecha: hoyIsoPlan, p_cd: planOrigen, p_ce: x.ce, p_camion: x.c.cam, p_ton: x.c.ton, p_pct: x.c.pct, p_lineas: x.c.lineas });
      if (error) console.warn('Plan de carga: no se pudo guardar el contenido del camión', error.message);
      else memo.set(x.k, x.sig);
    }
    for (const x of limp) {
      // (5-oct-2026) Los registros de coordinación (COORD|…) se pasan como vigentes para que la limpieza no los borre.
      const { data: co } = await supabase.from('abast_seguimiento_camion').select('tipo_camion,clave').eq('fecha_plan', hoyIsoPlan).eq('cd_origen', planOrigen).eq('ce', x.ce).like('clave', 'COORD|%');
      const vigCo = x.vig.concat((co || []).map(c => `${c.tipo_camion}|${c.clave}`));
      const { error } = await supabase.rpc('fn_abast_limpiar_seguimiento_directos', { p_fecha: hoyIsoPlan, p_cd: planOrigen, p_ce: x.ce, p_vigentes: vigCo });
      if (!error) { memo.set(x.k, x.sig); memo.set(kEx, existentes.filter(e => !e.startsWith(x.ce + '|') || x.vig.includes(e.slice(x.ce.length + 1)))); }
    }
    for (const x of segs) { if (await guardarSeguimiento(x.sg)) memo.set(x.k, x.sig); }
  }

  function draw() {
    resultado.forEach(refrescarFill);
    const kpiDef = [
      { key: 'prog', label: 'Programar', color: '#15803d', sub: 'sucursales ≥80%', fn: r => estadoV2(r).k === 'prog' },
      { key: 'rev', label: 'Revisar', color: '#ca8a04', sub: 'sucursales 70–80%', fn: r => estadoV2(r).k === 'rev' },
      { key: 'ins', label: 'Insuficiente', color: '#b5000b', sub: 'bajo 70%', fn: r => estadoV2(r).k === 'ins' },
      { key: 'seg', label: '2º camión', color: '#15803d', sub: 'propuestos (≥85%) · aceptados', fn: r => r.segundoPropuesto,
        valor: l => { const p = l.filter(r => r.segundoPropuesto); return `${p.length} · ${p.filter(r => segAcept.has(r.ce)).length}`; } },
      { key: 'dir', label: 'Directos', color: '#1d4ed8', sub: 'camiones cliente / fábrica', valor: l => l.reduce((s, r) => s + nDirectos(r), 0) },
      { key: 'ton', label: 'Toneladas CD', color: '#191c1d', sub: 'en camiones consolidados', valor: l => fmtNum(l.reduce((s, r) => s + r.total, 0), 0) },
    ];
    const kf = (kpiDef.find(k => k.key === st.kpi) || {}).fn;
    const filas = kf ? resultado.filter(kf) : resultado;
    const cierre = estadoCierre();

    stage.innerHTML = `<div class="sv-view">
      <div class="sv-vhead">
        <div style="min-width:0"><div class="pc-title"><h1 class="sv-h1">Plan de Carga</h1><span data-cierre>${cierre.html}</span></div>
          <div class="sv-desc pc-fechas"><span><span class="pc-h pc-h24">24h</span>${escapeHtml(cap1(d24Txt))}</span><span><span class="pc-h">48h</span>${escapeHtml(d48Txt)}</span></div></div>
        <div class="sv-actions">
          <div class="sv-seg" role="group" aria-label="Centro origen">${Object.keys(CALENDARIOS).map(id =>
            `<button data-chip data-origen="${id}" class="${planOrigen === id ? 'is-on' : ''}">${escapeHtml(CALENDARIOS[id].nombre)} · ${id}</button>`).join('')}</div>
          ${PUEDE_EXCLUIR && !cierre.cerrado ? `<button class="sv-btn" data-ver-exclusiones data-chip title="Ver y reactivar exclusiones"><span class="material-symbols-outlined">visibility_off</span>Exclusiones${exclusionesPlan.length ? ` <span class="sv-pill mute" style="padding:0 7px">${exclusionesPlan.length}</span>` : ''}</button>` : ''}
          <button class="sv-btn" data-descarga="__todo__" title="Descarga el plan completo del origen (sin filtro de KPI)"><span class="material-symbols-outlined">download</span>Descargar plan (CSV)</button>
          <button class="sv-btn is-icon" data-refrescar title="Refrescar datos"><span class="material-symbols-outlined">refresh</span></button>
        </div></div>
      <div class="sv-kpis pc-kpis">${kpiDef.map(k => {
        const on = st.kpi === k.key;
        const val = k.valor ? k.valor(resultado) : resultado.filter(k.fn).length;
        return `<button class="sv-kpi ${on ? 'is-on' : ''} ${k.fn ? '' : 'is-info'}" ${k.fn ? `data-chip data-kpi="${k.key}"` : 'data-chip disabled tabindex="-1"'} style="${on ? `box-shadow:inset 0 -3px 0 ${k.color}` : ''}">
          <div class="sv-kpi-l"><i style="background:${k.color}"></i>${escapeHtml(k.label)}</div><div class="sv-kpi-v">${escapeHtml(String(val))}</div><div class="sv-kpi-s">${escapeHtml(k.sub)}</div></button>`;
      }).join('')}</div>
      <div class="sv-legend pc-legend"><b>Orden de llenado</b>${CAT_V2.map((c, i) => `<span><i style="background:${c.color}"></i>${i + 1}. ${escapeHtml(c.lbl)}</span>`).join('')}
        <span class="pc-sep"></span>${DIR_V2.map(t => `<span><span class="material-symbols-outlined" style="color:${t.color};font-size:16px">local_shipping</span>${escapeHtml(t.lbl)}</span>`).join('')}</div>
      <div class="pc-list">
        ${!resultado.length ? '<div class="sv-card pc-empty"><span class="material-symbols-outlined">inventory_2</span>Sin carga para este origen.</div>'
          : filas.length ? filas.map(filaV2).join('') : '<div class="sv-card pc-empty">Ninguna sucursal con ese estado. Haz clic de nuevo en la tarjeta para quitar el filtro.</div>'}
      </div>
      <div class="sv-dr-note">Capacidad 28 t (15 t La Calera / San Bernardo si no alcanzan 28 t) · Camiones directos: grupo &gt;85% de la capacidad, 28 t, no suman al camión CD · X2/X3 = camiones requeridos</div>
      <div data-drawer-slot>${st.drawer && resultado.find(x => x.ce === st.drawer) ? drawerHtml(resultado.find(x => x.ce === st.drawer)) : ''}</div>
    </div>`;

    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => { clearRawCache(); renderPlanCarga(stage); });
    stage.querySelectorAll('[data-origen]').forEach(btn => btn.addEventListener('click', () => {
      if (planOrigen === btn.dataset.origen) return;
      planOrigen = btn.dataset.origen; st.drawer = null; renderPlanCarga(stage);
    }));
    stage.querySelectorAll('[data-kpi]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.kpi; st.kpi = st.kpi === k ? 'all' : k; draw(); }));
    stage.querySelectorAll('[data-suc]').forEach(b => {
      const abrir = () => { st.drawer = b.dataset.suc; st.tab = 'cd'; draw(); };
      b.addEventListener('click', abrir);
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    stage.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { st.drawer = null; draw(); }));
    stage.querySelectorAll('[data-tab-plan]').forEach(b => b.addEventListener('click', () => { st.tab = b.dataset.tabPlan; draw(); }));
    stage.querySelectorAll('[data-seg-open]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); st.drawer = b.dataset.segOpen; st.tab = 'seg'; draw();
    }));
    stage.querySelectorAll('[data-seg-accion]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation(); b.disabled = true;
      await accionSegundo(b.dataset.segCe, b.dataset.segAccion);
    }));
    stage.querySelectorAll('[data-mover]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation(); b.disabled = true;
      await moverLinea(b.dataset.mover, b.dataset.doc, b.dataset.mat, b.dataset.cam === 'auto' ? 'auto' : Number(b.dataset.cam));
    }));
    stage.querySelectorAll('[data-prog-cd]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await programarCD(b.dataset.progCd); }));
    stage.querySelectorAll('[data-prog-quitar]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await quitarProgramacion(b.dataset.progQuitar, Number(b.dataset.progCam || 1)); }));
    stage.querySelectorAll('[data-prog-seg]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await programarSegundo(b.dataset.progSeg); }));
    stage.querySelectorAll('[data-prog-edit]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await editarTransporte(b.dataset.progEdit, Number(b.dataset.progCam || 1)); }));
    stage.querySelectorAll('[data-restablecer]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); b.disabled = true; await restablecerAuto(b.dataset.restablecer); }));
    stage.querySelectorAll('[data-trconf]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      if (!PUEDE_TRANSPORTE) { showAlert('Sólo el perfil OWNER puede confirmar los datos del transporte.', 'warning'); return; }
      const r = resultado.find(x => x.ce === b.dataset.trconf); if (!r) return;
      const porT = new Map();
      DIR_V2.forEach(t => (r[t.lista] || []).forEach(cm => { const pcf = porConfirmar(cm); if (pcf) { const k = String(pcf.t.id); if (!porT.has(k)) porT.set(k, { t: pcf.t, pats: [] }); porT.get(k).pats.push(cm.patente); } }));
      let ok = false;
      for (const { t, pats } of porT.values()) { if (await showConfirmarTransportistaModal(t, `${r.nombre} · patente ${[...new Set(pats)].join(', ')}`)) ok = true; else break; }
      if (ok) { await leerMaestroTr(); draw(); }
    }));
    stage.querySelectorAll('[data-dirman-open]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); st.drawer = b.dataset.dirmanOpen; st.tab = 'dirman'; draw(); }));
    stage.querySelectorAll('[data-deshacer-man]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); b.disabled = true; await deshacerManual(Number(b.dataset.deshacerMan)); }));
    const dmChecks = [...stage.querySelectorAll('[data-dm-oc]')];
    const dmSum = () => {
      const sel = dmChecks.filter(c => c.checked);
      const t = sel.reduce((s, c) => s + Number(c.dataset.dmTon || 0), 0);
      const el = stage.querySelector('[data-dm-sum]'); if (el) el.textContent = `${t1(t)} t (${Math.round(t / CAP_CAMION_DIRECTO * 100)}%)`;
      // Tipo sugerido: si todas las OC seleccionadas son Fáb-Cliente, se propone Fáb-Cliente.
      const ts = stage.querySelector('[data-dm-tipo-sel]');
      if (ts && sel.length) ts.value = sel.every(c => c.dataset.dmTipo === 'fabCli') ? 'fabCli' : 'fabSuc';
    };
    dmChecks.forEach(c => c.addEventListener('change', dmSum));
    stage.querySelector('[data-dm-unir]')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true;
      await unirDirectos(b.dataset.dmUnir, dmChecks.filter(c => c.checked).map(c => c.dataset.dmOc), stage.querySelector('[data-dm-tipo-sel]')?.value || 'fabSuc');
      b.disabled = false;
    });
    stage.querySelectorAll('[data-descarga]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ce = btn.dataset.descarga;
      if (ce === '__todo__') { descargarCsvV21(resultado, `plan_carga_${planOrigen}_${isoLocal(diaHabil1)}.csv`); return; }
      const r = resultado.find(x => x.ce === ce);
      if (r) descargarCsvV21([r], `plan_carga_${planOrigen}_${r.ce}_${isoLocal(diaHabil1)}.csv`);
    }));
    stage.querySelector('[data-ver-exclusiones]')?.addEventListener('click', () => showExclusionesModal(exclusionesPlan, () => renderPlanCarga(stage)));
    clearTimeout(PLAN_V2_STATE._syncTk);
    PLAN_V2_STATE._syncTk = setTimeout(() => { sincronizarCorreo().catch(e => console.warn(e)); }, 1200);
  }
  // Badge de cierre: se actualiza cada 30 s sin recargar (a las 15:35 pasa a «Plan cerrado»)
  clearInterval(PLAN_V2_STATE._tk);
  PLAN_V2_STATE._tk = setInterval(() => {
    if (!stage.isConnected || !stage.querySelector('[data-cierre]')) { clearInterval(PLAN_V2_STATE._tk); return; }
    const c = estadoCierre();
    const slot = stage.querySelector('[data-cierre]');
    const eraCerrado = slot.querySelector('.is-cerrado');
    if (c.cerrado && !fotoCierre) { leerFotoCierre().then(() => { const s2 = stage.querySelector('[data-cierre]'); if (s2) s2.innerHTML = estadoCierre().html; }); }
    slot.innerHTML = c.html;
    if (c.cerrado && !eraCerrado) draw();
  }, 30000);
  if (!PLAN_V2_STATE._esc) {
    PLAN_V2_STATE._esc = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !PLAN_V2_STATE.drawer || document.querySelector('#excl-modal-bg, .sv-pal-bg')) return;
      const slot = document.querySelector('#ab-stage [data-drawer-slot]');
      if (!slot || !slot.innerHTML.trim()) return;
      PLAN_V2_STATE.drawer = null; PLAN_V2_STATE._redraw && PLAN_V2_STATE._redraw();
    });
  }
  PLAN_V2_STATE._redraw = () => { if (stage.isConnected) draw(); };

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
  setUltimaActualizacion(maxCargadoEn(rawRows));
  // Perfiles con centros asignados sólo ven filas de sus centros (campo de centro de la vista)
  const _campoCentro = active.centroCampo || active.chipFilter?.campo;
  const _rowsAll = active.transform ? active.transform(rawRows, ctx) : rawRows;
  const rows = _campoCentro ? filtrarPorCentro(_rowsAll, _campoCentro) : _rowsAll;

  // Botón "Excluir" (posiciones fuera del Plan de Carga) — sólo perfil OWNER,
  // sólo en las vistas que declaran cfg.excluir.
  let exclusionesPlan = [];
  let ownerFlag = false;
  if (active.excluir) {
    [exclusionesPlan, ownerFlag] = await Promise.all([loadExclusionesPlan(), Promise.resolve(can('excluir'))]);
  }
  const excluirColActivo = !!(active.excluir && ownerFlag);
  function renderExcluirCell(r) {
    const ex = active.excluir;
    const doc = ex.doc(r);
    const material = typeof ex.material === 'function' ? ex.material(r) : null;
    const match = exclusionesPlan.find(e => e.tipo === ex.tipo
      && String(e.doc ?? '').trim() === String(doc ?? '').trim()
      && (String(e.material ?? '').trim() === '' || String(e.material ?? '').trim() === String(material ?? '').trim()));
    if (match) {
      return `<td class="py-xs pr-md whitespace-nowrap text-center">
        <button data-excl-reactivar="${match.id}" title="Reactivar en el Plan de Carga" class="text-[11px] font-bold text-primary hover:underline">Reactivar</button></td>`;
    }
    return `<td class="py-xs pr-md whitespace-nowrap text-center">
      <button data-excl-excluir="${escapeHtml(ex.tipo)}|${escapeHtml(String(doc ?? ''))}|${escapeHtml(String(material ?? ''))}" title="Excluir del Plan de Carga" class="text-[11px] font-bold text-error hover:underline">Excluir</button></td>`;
  }

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
  if (active.dateDefaultHoy) {             // vistas diarias: por defecto sólo HOY
    const h = new Date();
    rangoDesde = rangoHasta = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  }
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
    if (c.editable && active.editable && active.editable.key === c.key && can('coordinar_retiro')) {
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
    if (c.rawHtml) {
      return `<td class="py-xs pr-md whitespace-nowrap ${cls}">${cellValue(r, c)}</td>`;
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
    const ncols = active.columnas.length + (excluirColActivo ? 1 : 0);

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
                ${excluirColActivo ? `<th class="py-sm pr-md whitespace-nowrap text-center">Plan de Carga</th>` : ''}
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
                    ${excluirColActivo ? renderExcluirCell(r) : ''}
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
      if (row && active.editable) {
        const prevVal = row[active.editable.key];
        row[active.editable.key] = sel.value;
        const ok = await active.editable.onChange(row, sel.value, ctx);
        if (ok === false) { row[active.editable.key] = prevVal; }
        draw();
      }
    }));
    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => { clearRawCache(); renderVistaTabla(stage, cfg, modeIdx); });
    stage.querySelector('[data-csv]')?.addEventListener('click', () => exportarCSV(active, filt));
    if (excluirColActivo) {
      stage.querySelectorAll('[data-excl-excluir]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const [tipo, doc, material] = btn.dataset.exclExcluir.split('|');
        const etiqueta = material ? `el material ${material} de la posición ${doc}` : `la posición ${doc} completa`;
        if (!await confirmar(`¿Excluir del Plan de Carga ${etiqueta}?\n\nSe mantiene disponible para futuros planes hasta que la reactives.`)) return;
        const ok = await excluirDelPlan(tipo, doc, material || null, 'Excluido desde ' + cfg.titulo);
        if (ok) { showAlert('Excluido del Plan de Carga', 'success'); exclusionesPlan = await loadExclusionesPlan(); draw(); }
      }));
      stage.querySelectorAll('[data-excl-reactivar]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await reactivarEnPlan(Number(btn.dataset.exclReactivar));
        if (ok) { showAlert('Reactivado en el Plan de Carga', 'success'); exclusionesPlan = await loadExclusionesPlan(); draw(); }
      }));
    }
  }

  draw();
}

function exportarCSV(cfg, filas) {
  if (cfg.csvFilas) filas = cfg.csvFilas(filas);   // vistas agrupadas (Seguimiento de Carga) exportan sus líneas
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
// SUBMENU 1: PROVEEDORES — maestra de proveedores (5-oct-2026, Jordan)
// Base: maestra SAP (ID + nombre). Nombres siempre en MAYÚSCULA (también lo fuerza un
// trigger en BD). Alta manual, edición de nombre, activar/desactivar (no se elimina) y
// direcciones de fábrica con nombre, dirección, comuna, región y contacto (nombre/teléfono/correo).
// ============================================================================
const REGIONES_CL = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 'Valparaíso',
  'Metropolitana de Santiago', "Libertador General Bernardo O'Higgins", 'Maule', 'Ñuble', 'Biobío', 'La Araucanía',
  'Los Ríos', 'Los Lagos', 'Aysén del General Carlos Ibáñez del Campo', 'Magallanes y de la Antártica Chilena'];
const PROV_PAGE = 50;
const provUI = { q: '', estado: 'act', conFab: false, page: 0 };
const mailValido = v => !String(v ?? '').trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

async function loadProveedores() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('abast_proveedores')
      .select('*, direcciones:abast_proveedor_direcciones(*)')
      .order('nombre', { ascending: true }).range(from, from + 999);
    if (error) { console.error(error); showAlert('Error al cargar proveedores: ' + error.message, 'error'); return out; }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  out.forEach(p => (p.direcciones || []).sort((a, b) => String(a.nombre_fabrica || '').localeCompare(String(b.nombre_fabrica || ''))));
  return out;
}

async function renderProveedores(stage) {
  stage.innerHTML = `<div class="text-secondary text-body-md p-md">Cargando proveedores…</div>`;
  proveedores = await loadProveedores();
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function filtrados() {
    const q = norm(provUI.q).trim();
    return proveedores.filter(p => (provUI.estado === 'all' || (provUI.estado === 'act' ? p.activo !== false : p.activo === false))
      && (!provUI.conFab || (p.direcciones || []).length > 0)
      && (!q || norm(`${p.id} ${p.nombre} ${(p.direcciones || []).map(d => `${d.nombre_fabrica} ${d.comuna} ${d.contacto_nombre}`).join(' ')}`).includes(q)));
  }
  const seg = (k, lbl, n) => `<button data-estado="${k}" class="px-md py-xs rounded-lg text-[13px] font-bold ${provUI.estado === k ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'}">${lbl} <span class="opacity-80">${n}</span></button>`;

  function shell() {
    const nAct = proveedores.filter(p => p.activo !== false).length;
    stage.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex items-center justify-between gap-md flex-wrap mb-md border-b border-outline-variant pb-sm">
          <div>
            <h3 class="text-headline-sm font-bold text-on-surface">GESTIÓN TRONCALES – PROVEEDORES</h3>
            <p class="text-[13px] text-secondary">Maestra de proveedores y direcciones de fábrica para retiro de material</p>
          </div>
          <button id="ab-nuevo-prov" class="bg-primary text-on-primary px-md py-sm rounded-lg text-body-md font-bold hover:opacity-90 transition-opacity">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">add</span>Nuevo proveedor</button>
        </div>
        <div class="flex items-center gap-md flex-wrap mb-md">
          <label class="flex items-center gap-xs border border-outline-variant rounded-lg px-md py-sm flex-1 min-w-[240px] max-w-[520px] focus-within:border-primary">
            <span class="material-symbols-outlined text-[18px] text-secondary">search</span>
            <input id="ab-prov-buscar" value="${escapeHtml(provUI.q)}" placeholder="Buscar por ID, nombre, fábrica, comuna o contacto…" class="w-full outline-none text-body-md bg-transparent" autocomplete="off"/></label>
          <div class="flex items-center gap-xs border border-outline-variant rounded-lg p-xs">
            ${seg('act', 'Activos', nAct)}${seg('ina', 'Inactivos', proveedores.length - nAct)}${seg('all', 'Todos', proveedores.length)}</div>
          <label class="flex items-center gap-xs text-[13px] text-secondary cursor-pointer"><input id="ab-prov-confab" type="checkbox" ${provUI.conFab ? 'checked' : ''} class="w-4 h-4"/> Sólo con fábricas</label>
        </div>
        <div id="ab-prov-tabla"></div>
      </div>`;
    const s = stage.querySelector('#ab-prov-buscar');
    let tk;
    s.addEventListener('input', e => { clearTimeout(tk); tk = setTimeout(() => { provUI.q = e.target.value; provUI.page = 0; tabla(); }, 180); });
    stage.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', () => { provUI.estado = b.dataset.estado; provUI.page = 0; shell(); }));
    stage.querySelector('#ab-prov-confab').addEventListener('change', e => { provUI.conFab = e.target.checked; provUI.page = 0; tabla(); });
    stage.querySelector('#ab-nuevo-prov').addEventListener('click', () => openProveedorModal(null, shell));
    tabla();
  }

  function tabla() {
    const box = stage.querySelector('#ab-prov-tabla'); if (!box) return;
    const rows = filtrados();
    const pages = Math.max(1, Math.ceil(rows.length / PROV_PAGE));
    provUI.page = Math.min(provUI.page, pages - 1);
    const vis = rows.slice(provUI.page * PROV_PAGE, (provUI.page + 1) * PROV_PAGE);
    box.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-body-md">
          <thead><tr class="text-left text-[12px] uppercase tracking-wide text-secondary border-b border-outline-variant">
            <th class="py-sm pr-md">ID</th><th class="py-sm pr-md">Proveedor</th><th class="py-sm pr-md">Estado</th>
            <th class="py-sm pr-md text-center">Fábricas</th><th class="py-sm pr-md text-right">Acciones</th></tr></thead>
          <tbody>
            ${vis.length === 0 ? `<tr><td colspan="5" class="py-lg text-center text-secondary">Sin proveedores para el filtro.</td></tr>` : vis.map(p => `
              <tr class="border-b border-outline-variant/60 hover:bg-surface-container-low ${p.activo === false ? 'opacity-60' : ''}">
                <td class="py-sm pr-md font-data-mono text-[13px]">${escapeHtml(p.id)}</td>
                <td class="py-sm pr-md font-semibold">${escapeHtml(p.nombre || '')}</td>
                <td class="py-sm pr-md">${p.activo === false
                  ? '<span class="inline-flex items-center gap-xs text-[12px] font-bold px-sm py-[2px] rounded-full bg-error-container text-on-error-container">Inactivo</span>'
                  : '<span class="inline-flex items-center gap-xs text-[12px] font-bold px-sm py-[2px] rounded-full" style="background:#dcfce7;color:#14532d">Activo</span>'}</td>
                <td class="py-sm pr-md text-center">
                  <button data-dir="${escapeHtml(p.id)}" title="Direcciones de fábrica" class="inline-flex items-center gap-xs px-sm py-[2px] rounded-full text-[12px] font-bold ${selectedProveedorId === p.id ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}">
                    <span class="material-symbols-outlined text-[16px]">factory</span>${(p.direcciones || []).length}</button></td>
                <td class="py-sm pr-md text-right whitespace-nowrap">
                  <button data-edit="${escapeHtml(p.id)}" title="Editar" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                  <button data-toggle="${escapeHtml(p.id)}" title="${p.activo === false ? 'Activar' : 'Desactivar'}" class="text-secondary ${p.activo === false ? 'hover:text-primary' : 'hover:text-error'} p-xs">
                    <span class="material-symbols-outlined text-[20px]">${p.activo === false ? 'toggle_off' : 'toggle_on'}</span></button>
                </td>
              </tr>
              ${selectedProveedorId === p.id ? renderDireccionesPanel(p) : ''}`).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between mt-md text-[13px] text-secondary">
        <span>${rows.length ? `${provUI.page * PROV_PAGE + 1}–${Math.min(rows.length, (provUI.page + 1) * PROV_PAGE)} de ${rows.length}` : '0 resultados'}</span>
        <div class="flex items-center gap-xs">
          <button data-pg="-1" ${provUI.page === 0 ? 'disabled' : ''} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_left</span></button>
          <span>Página ${provUI.page + 1} de ${pages}</span>
          <button data-pg="1" ${provUI.page >= pages - 1 ? 'disabled' : ''} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
      </div>`;
    box.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => { provUI.page += Number(b.dataset.pg); tabla(); }));
    box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openProveedorModal(proveedores.find(x => x.id === b.dataset.edit), shell)));
    box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleProveedor(proveedores.find(x => x.id === b.dataset.toggle), shell)));
    box.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { selectedProveedorId = selectedProveedorId === b.dataset.dir ? null : b.dataset.dir; tabla(); }));
    wireDireccionesPanel(box, tabla);
  }

  shell();
}

function renderDireccionesPanel(p) {
  const dirs = p.direcciones || [];
  const contacto = d => [d.contacto_nombre, d.contacto_telefono, d.contacto_correo].filter(Boolean).map(escapeHtml).join('<br>') || '—';
  return `
    <tr class="bg-surface-container-low"><td colspan="5" class="p-md">
      <div class="border border-outline-variant rounded-lg p-md bg-surface-container-lowest">
        <div class="flex items-center justify-between mb-sm">
          <h4 class="font-bold text-on-surface"><span class="material-symbols-outlined text-[18px] align-middle mr-xs">factory</span>
            Direcciones de fábrica — ${escapeHtml(p.nombre || p.id)}</h4>
          <button data-adddir="${escapeHtml(p.id)}" class="bg-surface-container-high text-on-surface px-sm py-xs rounded-lg text-[13px] font-bold hover:bg-surface-container-highest">
            <span class="material-symbols-outlined text-[16px] align-middle mr-xs">add_location_alt</span>Agregar fábrica</button>
        </div>
        ${dirs.length === 0 ? `<p class="text-secondary text-[13px] py-sm">Sin fábricas registradas. Agrega la dirección de la fábrica o bodega de retiro.</p>` : `
        <div class="overflow-x-auto"><table class="w-full text-[13px]">
          <thead><tr class="text-left text-[11px] uppercase tracking-wide text-secondary border-b border-outline-variant">
            <th class="py-xs pr-md">Fábrica</th><th class="py-xs pr-md">Dirección</th><th class="py-xs pr-md">Comuna</th>
            <th class="py-xs pr-md">Región</th><th class="py-xs pr-md">Contacto</th><th class="py-xs text-right">Acciones</th></tr></thead>
          <tbody>
            ${dirs.map(d => `
              <tr class="border-b border-outline-variant/50 align-top ${d.activo === false ? 'opacity-60' : ''}">
                <td class="py-xs pr-md font-semibold">${escapeHtml(d.nombre_fabrica || '—')}${d.activo === false ? ' <span class="text-[11px] text-error">(inactiva)</span>' : ''}</td>
                <td class="py-xs pr-md">${escapeHtml(d.direccion || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.comuna || '—')}</td>
                <td class="py-xs pr-md">${escapeHtml(d.region || '—')}</td>
                <td class="py-xs pr-md">${contacto(d)}</td>
                <td class="py-xs text-right whitespace-nowrap">
                  <button data-editdir="${d.id}" title="Editar" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                  <button data-deldir="${d.id}" title="Eliminar" class="text-secondary hover:text-error p-xs"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </td></tr>`;
}

function wireDireccionesPanel(stage, redraw) {
  stage.querySelectorAll('[data-adddir]').forEach(b => b.addEventListener('click', () => openDireccionModal(b.dataset.adddir, null, redraw)));
  stage.querySelectorAll('[data-editdir]').forEach(b => b.addEventListener('click', () => {
    const prov = proveedores.find(p => p.id === selectedProveedorId);
    const dir = (prov?.direcciones || []).find(d => String(d.id) === b.dataset.editdir);
    openDireccionModal(selectedProveedorId, dir, redraw);
  }));
  stage.querySelectorAll('[data-deldir]').forEach(b => b.addEventListener('click', () => deleteDireccion(b.dataset.deldir, redraw)));
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
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
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
  const { wrap, close } = modalShell(esNuevo ? 'Nuevo proveedor' : 'Editar proveedor', `
    ${field('ID proveedor (código SAP) *', 'f-id', prov?.id || '', 'text', esNuevo ? 'autocomplete="off"' : 'disabled')}
    ${field('Nombre proveedor *', 'f-nombre', prov?.nombre || '', 'text', 'style="text-transform:uppercase" autocomplete="off"')}
    <label class="flex items-center gap-sm mt-sm mb-md text-body-md">
      <input id="f-activo" type="checkbox" ${prov?.activo === false ? '' : 'checked'} class="w-4 h-4"/><span>Proveedor activo</span></label>
    <p class="text-[12px] text-secondary mb-md">Los contactos se registran en cada dirección de fábrica.</p>
    <div class="flex justify-end gap-sm">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>`);
  setTimeout(() => wrap.querySelector(esNuevo ? '#f-id' : '#f-nombre')?.focus(), 0);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async e => {
    const id = wrap.querySelector('#f-id').value.trim().toUpperCase();
    const nombre = wrap.querySelector('#f-nombre').value.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!id)     { showAlert('El ID del proveedor es obligatorio', 'error'); return; }
    if (!nombre) { showAlert('El nombre del proveedor es obligatorio', 'error'); return; }
    if (esNuevo) {
      const ex = proveedores.find(p => p.id === id);
      if (ex) { showAlert(`El ID ${id} ya existe: ${ex.nombre}${ex.activo === false ? ' (inactivo)' : ''}.`, 'error'); return; }
    }
    const payload = { nombre, activo: wrap.querySelector('#f-activo').checked, updated_at: new Date().toISOString(), updated_by: await getUserEmail() };
    e.currentTarget.disabled = true;
    const { error } = esNuevo
      ? await supabase.from('abast_proveedores').insert({ id, ...payload })
      : await supabase.from('abast_proveedores').update(payload).eq('id', prov.id);
    if (error) { e.currentTarget.disabled = false; showAlert('Error al guardar: ' + error.message, 'error'); return; }
    showAlert(esNuevo ? `Proveedor ${id} agregado` : 'Proveedor actualizado', 'success');
    close();
    if (esNuevo) { provUI.q = id; provUI.estado = 'all'; provUI.page = 0; }
    proveedores = await loadProveedores();
    redraw();
  });
}

async function toggleProveedor(p, redraw) {
  if (!p) return;
  const activar = p.activo === false;
  if (!await confirmar(`¿${activar ? 'Activar' : 'Desactivar'} el proveedor ${p.id} · ${p.nombre}?${activar ? '' : '\n\nNo se elimina: sus fábricas se conservan y puedes reactivarlo cuando quieras.'}`,
    activar ? {} : { aceptar: 'Desactivar', tono: 'peligro', icono: 'toggle_off' })) return;
  const { error } = await supabase.from('abast_proveedores').update({ activo: activar, updated_at: new Date().toISOString(), updated_by: await getUserEmail() }).eq('id', p.id);
  if (error) { showAlert('Error al actualizar: ' + error.message, 'error'); return; }
  p.activo = activar;
  showAlert(`Proveedor ${activar ? 'activado' : 'desactivado'}`, 'success');
  redraw();
}

function openDireccionModal(proveedorId, dir, redraw) {
  const esNueva = !dir;
  const prov = proveedores.find(p => p.id === proveedorId);
  const regSel = dir?.region || '';
  const { wrap, close } = modalShell(esNueva ? 'Nueva fábrica' : 'Editar fábrica', `
    <p class="text-[13px] text-secondary mb-md">${escapeHtml(proveedorId)} · ${escapeHtml(prov?.nombre || '')}</p>
    ${field('Nombre fábrica *', 'd-fab', dir?.nombre_fabrica || '', 'text', 'style="text-transform:uppercase" autocomplete="off"')}
    ${field('Dirección *', 'd-dir', dir?.direccion || '', 'text', 'placeholder="Calle, número"')}
    <div class="grid grid-cols-2 gap-sm">
      ${field('Comuna *', 'd-com', dir?.comuna || '')}
      <label class="block mb-sm"><span class="text-[12px] uppercase tracking-wide text-secondary font-bold">Región *</span>
        <select id="d-reg" class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none bg-transparent">
          <option value="">Seleccionar…</option>
          ${REGIONES_CL.map(r => `<option ${r === regSel ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
          ${regSel && !REGIONES_CL.includes(regSel) ? `<option selected>${escapeHtml(regSel)}</option>` : ''}
        </select></label>
    </div>
    <div class="border-t border-outline-variant mt-sm pt-md">
      <p class="text-[12px] uppercase tracking-wide text-secondary font-bold mb-sm">Contacto de la fábrica</p>
      ${field('Nombre contacto', 'd-cnom', dir?.contacto_nombre || '')}
      <div class="grid grid-cols-2 gap-sm">
        ${field('Teléfono contacto', 'd-ctel', dir?.contacto_telefono || '', 'tel', 'placeholder="+56 9…"')}
        ${field('Correo contacto', 'd-cmail', dir?.contacto_correo || '', 'email', 'placeholder="contacto@empresa.cl"')}
      </div>
    </div>
    <label class="flex items-center gap-sm mb-md text-body-md"><input id="d-activo" type="checkbox" ${dir?.activo === false ? '' : 'checked'} class="w-4 h-4"/><span>Fábrica activa (se ofrece al coordinar retiros)</span></label>
    <div class="flex justify-end gap-sm mt-md">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>`);
  setTimeout(() => wrap.querySelector('#d-fab')?.focus(), 0);
  wrap.querySelector('[data-cancel]').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', async e => {
    const v = id => wrap.querySelector(id).value.trim();
    const payload = {
      proveedor_id: proveedorId,
      nombre_fabrica: v('#d-fab').toUpperCase(), direccion: v('#d-dir'), comuna: v('#d-com'), region: v('#d-reg'),
      contacto_nombre: v('#d-cnom') || null, contacto_telefono: v('#d-ctel') || null, contacto_correo: v('#d-cmail').toLowerCase() || null,
      activo: wrap.querySelector('#d-activo').checked,
      updated_at: new Date().toISOString(), updated_by: await getUserEmail(),
    };
    const faltan = [!payload.nombre_fabrica && 'nombre fábrica', !payload.direccion && 'dirección', !payload.comuna && 'comuna', !payload.region && 'región'].filter(Boolean);
    if (faltan.length) { showAlert('Completa: ' + faltan.join(', '), 'error'); return; }
    if (!mailValido(payload.contacto_correo)) { showAlert('El correo de contacto no es válido', 'error'); return; }
    e.currentTarget.disabled = true;
    const { error } = esNueva
      ? await supabase.from('abast_proveedor_direcciones').insert(payload)
      : await supabase.from('abast_proveedor_direcciones').update(payload).eq('id', dir.id);
    if (error) { e.currentTarget.disabled = false; showAlert('Error al guardar la fábrica: ' + error.message, 'error'); return; }
    showAlert('Fábrica guardada', 'success');
    close();
    proveedores = await loadProveedores();
    redraw();
  });
}

async function deleteDireccion(id, redraw) {
  if (!await confirmar('¿Eliminar esta fábrica del proveedor?', { aceptar: 'Eliminar', tono: 'peligro', icono: 'delete' })) return;
  const { error } = await supabase.from('abast_proveedor_direcciones').delete().eq('id', id);
  if (error) { showAlert('Error al eliminar: ' + error.message, 'error'); return; }
  showAlert('Fábrica eliminada', 'success');
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

// ── CALENDARIO SUCURSALES v2 (rediseño 29-sep-2026) ─────────────────────────
// Grilla bloques × días (L–V). Clic en una celda → panel lateral con las
// sucursales destino (máx. 2 por bloque). Los cambios de la grilla quedan
// pendientes hasta «Guardar calendario» (mismo upsert de siempre en
// abast_calendario). Horizonte 24h/48h y feriados se guardan al instante,
// igual que antes.
const CAL_V2 = { sel: null, dirty: false, edit: {}, guardado: false };
const DOW_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function calCellKey(d, bloque) { return `${d}-${bloque}`; }
function calDesdeMatrix() {
  const cfg = CALENDARIOS[calOrigen];
  const m = {};
  cfg.dias.forEach(d => (d.bloques || cfg.bloques).forEach(b => {
    const c = calMatrix[calCellKey(d.n, b)] || {};
    m[calCellKey(d.n, b)] = [c.centro_destino_1, c.centro_destino_2].map(x => String(x ?? '').trim()).filter(Boolean);
  }));
  return m;
}
function calFrecuencias() {
  const f = {};
  CALENDARIOS[calOrigen].destinos.forEach(id => { f[id] = 0; });
  Object.values(CAL_V2.edit).forEach(a => a.forEach(ce => { f[ce] = (f[ce] || 0) + 1; }));
  return f;
}

async function renderCalendario(stage) {
  if (!CALENDARIOS[calOrigen]) calOrigen = '1003';
  stage.innerHTML = `<div class="sv-view"><div class="sv-vhead"><div><h1 class="sv-h1">Calendario Sucursales</h1><div class="sv-desc">Cargando…</div></div></div></div>`;
  const [matrix, horizMap, feriados] = await Promise.all([loadCalendario(calOrigen), loadHorizonteCentro(calOrigen), loadFeriados()]);
  calMatrix = matrix;
  CAL_V2.edit = calDesdeMatrix();
  CAL_V2.dirty = false; CAL_V2.sel = null; CAL_V2.guardado = false;
  CAL_V2.horiz = horizMap; CAL_V2.feriados = feriados;
  setUltimaActualizacion(null);
  drawCalendarioV2(stage);
}

function drawCalendarioV2(stage) {
  const cfg = CALENDARIOS[calOrigen];
  const editar = can('editar');
  const hz = CAL_V2.horiz || {};
  const freq = calFrecuencias();
  const nom = id => { const n = getNombreCentro(id); return n && n !== id ? n : id; };

  // Grilla
  const head = `<div class="sv-cal-h">Bloque</div>` + cfg.dias.map(d => {
    const n = (d.bloques || cfg.bloques).reduce((s, b) => s + (CAL_V2.edit[calCellKey(d.n, b)] || []).length, 0);
    return `<div class="sv-cal-h">${escapeHtml(d.lbl)}<small>${n} ${n === 1 ? 'sucursal' : 'sucursales'}</small></div>`;
  }).join('');
  const TURNOS = ['Mañana', 'Mediodía', 'Tarde', 'Noche'];
  const filas = cfg.bloques.map((b, bi) => `<div class="sv-cal-b"><b>${escapeHtml(b)}</b><small>${TURNOS[bi] || ''}</small></div>` + cfg.dias.map(d => {
    if (!(d.bloques || cfg.bloques).includes(b)) return `<div class="sv-cal-c" style="cursor:default;background:#f3f4f5"></div>`;
    const k = calCellKey(d.n, b), a = CAL_V2.edit[k] || [];
    return `<div class="sv-cal-c ${CAL_V2.sel === k ? 'is-sel' : ''}" data-cal-cell="${escapeHtml(k)}" role="button" tabindex="0" aria-label="${escapeHtml(d.lbl)} ${escapeHtml(b)}">
      ${a.map(ce => `<div class="sv-cal-chip" style="box-shadow:inset 3px 0 0 ${(hz[ce] || 24) === 48 ? '#c5c7c9' : '#191c1d'}"><span>${escapeHtml(nom(ce))}</span><span class="sv-mono">${escapeHtml(ce)}</span></div>`).join('')}
      ${a.length < 2 && editar ? '<div class="sv-cal-add">+ Asignar</div>' : ''}
    </div>`;
  }).join('')).join('');

  // Horizonte y frecuencia
  const horiz = cfg.destinos.map(id => {
    const h = hz[id] || 24, f = freq[id] || 0;
    return `<div><div style="min-width:0"><div class="sv-hzn">${escapeHtml(nom(id))} <span class="sv-mono" style="color:#5c5f61">${escapeHtml(id)}</span></div>
      <div class="sv-hzf" style="${f === 0 ? 'color:#93000a;font-weight:700' : ''}"><span class="material-symbols-outlined">${f === 0 ? 'warning' : 'event_repeat'}</span>${f === 0 ? 'Sin bloque' : f + (f === 1 ? ' bloque/sem' : ' bloques/sem')}</div></div>
      <div class="sv-tog" role="group" aria-label="Horizonte ${escapeHtml(nom(id))}">
        <button data-chip data-horiz="${id}|24" class="${h === 24 ? 'is-on' : ''}" ${editar ? '' : 'disabled'}>24h</button>
        <button data-chip data-horiz="${id}|48" class="${h === 48 ? 'is-on' : ''}" ${editar ? '' : 'disabled'}>48h</button></div></div>`;
  }).join('');

  // Feriados
  const hoyIso = isoLocal(hoy00());
  const fer = (CAL_V2.feriados || []).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const nextI = fer.findIndex(f => String(f.fecha) >= hoyIso);
  const ferHtml = fer.length ? fer.map((f, i) => {
    const d = parseISODate(f.fecha);
    const dias = d ? Math.round((d - hoy00()) / 86400000) : null;
    return `<div style="opacity:${String(f.fecha) < hoyIso ? .45 : 1}">
      <span class="sv-mono">${escapeHtml(fmtFechaISO(f.fecha))}</span><span class="sv-dow">${d ? DOW_CORTO[d.getDay()] : ''}</span>
      <span class="sv-fd">${escapeHtml(f.descripcion || 'Feriado')}</span>
      ${i === nextI ? pill(`Próximo · ${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : 'en ' + dias + ' días'}`, 'info') : ''}
      ${editar ? `<button class="sv-iconbtn" data-fer-del="${escapeHtml(String(f.id))}" title="Eliminar feriado"><span class="material-symbols-outlined">delete</span></button>` : ''}
    </div>`;
  }).join('') : '<div class="sv-muted">Sin feriados registrados.</div>';

  stage.innerHTML = `<div class="sv-view">
    <div class="sv-vhead">
      <div style="min-width:0"><h1 class="sv-h1">Calendario Sucursales</h1>
        <div class="sv-desc">Bloques de carga semanales por sucursal destino (máx. 2 por bloque), horizonte de planificación y feriados.</div></div>
      <div class="sv-actions">
        <div class="sv-seg" role="group" aria-label="Centro origen">${Object.entries(CALENDARIOS).map(([id, c]) =>
          `<button data-chip data-origen="${id}" class="${calOrigen === id ? 'is-on' : ''}"><span class="material-symbols-outlined">warehouse</span>${escapeHtml(c.nombre)} · ${id}</button>`).join('')}</div>
        ${CAL_V2.dirty ? '<span class="sv-dirty"><i></i>Cambios sin guardar</span>' : ''}
        ${CAL_V2.guardado && !CAL_V2.dirty ? '<span class="sv-okmsg"><span class="material-symbols-outlined" style="font-size:18px">check_circle</span>Calendario guardado</span>' : ''}
        ${editar ? `<button class="sv-btn-p" id="cal-save" ${CAL_V2.dirty ? '' : 'disabled'}><span class="material-symbols-outlined">save</span>Guardar calendario</button>` : ''}
      </div></div>

    <div class="sv-card" style="overflow:auto"><div class="sv-cal">${head}${filas}</div></div>
    <div class="sv-legend"><span><i style="background:#191c1d"></i>Sucursal a 24h</span><span><i style="background:#c5c7c9"></i>Sucursal a 48h</span>${editar ? '<span>Haz clic en un bloque para asignar sucursales</span>' : ''}</div>

    <div class="sv-card sv-sect-card">
      <div class="sv-sect-t"><span class="material-symbols-outlined">update</span>Horizonte y frecuencia</div>
      <div class="sv-sect-d">El Plan de Carga se calcula con vista al próximo día hábil (24h) o al siguiente (48h). Por defecto 24h. Se guarda al instante.</div>
      <div class="sv-hz">${horiz}</div>
    </div>

    <div class="sv-card sv-sect-card">
      <div class="sv-sect-t"><span class="material-symbols-outlined">event_busy</span>Feriados</div>
      <div class="sv-sect-d">El Plan de Carga salta sábados, domingos y estas fechas al calcular la ventana de 24h/48h.</div>
      ${editar ? `<div class="sv-frow">
        <label class="sv-inp"><span class="material-symbols-outlined">calendar_today</span><input type="date" id="fer-fecha" aria-label="Fecha"/></label>
        <label class="sv-inp" style="flex:1;min-width:220px"><input id="fer-desc" placeholder="Descripción (ej. Fiestas Patrias)" style="width:100%"/></label>
        <button class="sv-btn-p" id="fer-add"><span class="material-symbols-outlined">add</span>Agregar</button></div>` : ''}
      <div class="sv-fer">${ferHtml}</div>
    </div>
    <div data-drawer-slot>${CAL_V2.sel ? calDrawerHtml() : ''}</div>
  </div>`;
  wireCalendarioV2(stage);
}

function calDrawerHtml() {
  const cfg = CALENDARIOS[calOrigen];
  const [dn, ...rest] = CAL_V2.sel.split('-');
  const bloque = rest.join('-');
  const dia = cfg.dias.find(d => String(d.n) === dn);
  const a = CAL_V2.edit[CAL_V2.sel] || [];
  const freq = calFrecuencias();
  const editar = can('editar');
  const nom = id => { const n = getNombreCentro(id); return n && n !== id ? n : id; };
  const opts = cfg.destinos.map(id => {
    const on = a.includes(id), full = !on && a.length >= 2;
    return `<button class="sv-opt ${on ? 'is-on' : ''}" data-chip data-cal-opt="${id}" ${full || !editar ? 'disabled' : ''}>
      <span class="material-symbols-outlined" style="color:${on ? '#b5000b' : '#5c5f61'}">${on ? 'check_box' : 'check_box_outline_blank'}</span>
      <span style="flex:1">${escapeHtml(nom(id))} <span class="sv-mono" style="color:#5c5f61">${escapeHtml(id)}</span></span>
      <span class="sv-sub" style="margin:0">${freq[id] || 0}/sem</span></button>`;
  }).join('');
  return `<div class="sv-dr-bg" data-cal-close></div>
    <aside class="sv-dr" style="width:min(420px,100vw)" role="dialog" aria-label="Asignar bloque">
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">${escapeHtml(cfg.nombre)} · bloque de carga</div>
        <div class="sv-dr-t" style="font-family:inherit;font-weight:600">${escapeHtml(dia ? dia.lbl : '')} ${escapeHtml(bloque)}</div>
        <div class="sv-dr-s">${a.length} de 2 sucursales asignadas</div></div>
        <button class="sv-iconbtn" data-cal-close title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b" style="gap:8px">${opts}</div>
      <div class="sv-dr-f"><span class="sv-dr-note">Los cambios se guardan con «Guardar calendario»</span>
        ${editar ? `<button class="sv-btn" data-chip data-cal-clear ${a.length ? '' : 'disabled'}><span class="material-symbols-outlined">backspace</span>Vaciar bloque</button>` : ''}</div>
    </aside>`;
}

function wireCalendarioV2(stage) {
  const redraw = () => drawCalendarioV2(stage);
  stage.querySelectorAll('[data-origen]').forEach(btn => btn.addEventListener('click', async () => {
    if (btn.dataset.origen === calOrigen) return;
    if (CAL_V2.dirty && !await confirmar('Hay cambios sin guardar en el calendario. ¿Descartarlos y cambiar de centro?')) return;
    calOrigen = btn.dataset.origen;
    await renderCalendario(stage);
  }));
  stage.querySelectorAll('[data-cal-cell]').forEach(c => {
    const abrir = () => { CAL_V2.sel = c.dataset.calCell; redraw(); };
    c.addEventListener('click', abrir);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });
  stage.querySelectorAll('[data-cal-close]').forEach(b => b.addEventListener('click', () => { CAL_V2.sel = null; redraw(); }));
  stage.querySelectorAll('[data-cal-opt]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.calOpt, a = (CAL_V2.edit[CAL_V2.sel] || []).slice();
    const i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1); else if (a.length < 2) a.push(id); else return;
    CAL_V2.edit[CAL_V2.sel] = a; CAL_V2.dirty = true; CAL_V2.guardado = false; redraw();
  }));
  stage.querySelector('[data-cal-clear]')?.addEventListener('click', () => {
    CAL_V2.edit[CAL_V2.sel] = []; CAL_V2.dirty = true; CAL_V2.guardado = false; redraw();
  });
  stage.querySelector('#cal-save')?.addEventListener('click', () => saveCalendario(stage));
  stage.querySelectorAll('[data-horiz]').forEach(btn => btn.addEventListener('click', async () => {
    if (!can('editar')) return;
    const [centroDestino, horas] = btn.dataset.horiz.split('|');
    if ((CAL_V2.horiz[centroDestino] || 24) === Number(horas)) return;
    const { error } = await supabase.from('abast_horizonte_centro').upsert({
      centro_origen: calOrigen, centro_destino: centroDestino,
      horizonte_horas: Number(horas), updated_by: await getUserEmail(), updated_at: new Date().toISOString(),
    }, { onConflict: 'centro_origen,centro_destino' });
    if (error) { showAlert('Error al guardar horizonte: ' + error.message, 'error'); return; }
    CAL_V2.horiz[centroDestino] = Number(horas);
    showAlert('✓ Horizonte actualizado', 'success');
    redraw();
  }));
  stage.querySelector('#fer-add')?.addEventListener('click', async () => {
    const fecha = stage.querySelector('#fer-fecha').value;
    const descripcion = stage.querySelector('#fer-desc').value.trim();
    if (!fecha) { showAlert('Seleccione una fecha', 'error'); return; }
    const { error } = await supabase.from('abast_feriados')
      .upsert({ fecha, descripcion: descripcion || null, updated_by: await getUserEmail(), updated_at: new Date().toISOString() }, { onConflict: 'fecha' });
    if (error) { showAlert('Error al guardar feriado: ' + error.message, 'error'); return; }
    showAlert('✓ Feriado agregado', 'success');
    CAL_V2.feriados = await loadFeriados(); redraw();
  });
  stage.querySelectorAll('[data-fer-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmar('¿Eliminar este feriado?')) return;
    const { error } = await supabase.from('abast_feriados').delete().eq('id', btn.dataset.ferDel);
    if (error) { showAlert('Error al eliminar feriado: ' + error.message, 'error'); return; }
    CAL_V2.feriados = await loadFeriados(); redraw();
  }));
  if (!CAL_V2._esc) {
    CAL_V2._esc = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !CAL_V2.sel || !CAL_V2._stage?.isConnected) return;
      CAL_V2.sel = null; drawCalendarioV2(CAL_V2._stage);
    });
  }
  CAL_V2._stage = stage;
}

async function saveCalendario(stage) {
  const btn = stage.querySelector('#cal-save');
  const email = await getUserEmail();
  const now = new Date().toISOString();
  const cfg = CALENDARIOS[calOrigen];
  const rows = [];
  if (btn) btn.disabled = true;
  cfg.dias.forEach(d => (d.bloques || cfg.bloques).forEach(bloque => {
    const [cd1, cd2] = CAL_V2.edit[calCellKey(d.n, bloque)] || [];
    rows.push({
      centro: calOrigen, dia: d.n, bloque,
      habilitado: !!(cd1 || cd2),
      cupos: (cd1 ? 1 : 0) + (cd2 ? 1 : 0),
      sobre_cupo: false,
      centro_destino_1: cd1 || null,
      centro_destino_2: cd2 || null,
      updated_by: email, updated_at: now,
    });
  }));
  const { error } = await supabase.from('abast_calendario').upsert(rows, { onConflict: 'centro,dia,bloque' });
  if (error) { if (btn) btn.disabled = false; showAlert('Error al guardar calendario: ' + error.message, 'error'); return; }
  showAlert('✓ Calendario guardado correctamente', 'success');
  calMatrix = await loadCalendario(calOrigen);
  CAL_V2.edit = calDesdeMatrix();
  CAL_V2.dirty = false; CAL_V2.guardado = true;
  drawCalendarioV2(stage);
}

// ── HORIZONTE DE PLANIFICACIÓN (24H / 48H) POR CENTRO DESTINO ──────────────
// (AJUSTE 48H, 18-sep-2026) Tabla auxiliar `abast_horizonte_centro`: marca,
// por centro origen + centro destino, si el Plan de Carga debe planificar ese
// destino con vista a 24h (próximo día hábil) o 48h (siguiente día hábil).
// Por defecto (sin fila guardada) un centro se planifica a 24h.
async function loadHorizonteCentro(origen) {
  const { data, error } = await supabase
    .from('abast_horizonte_centro').select('*').eq('centro_origen', origen);
  if (error) { console.error(error); showAlert('Error al cargar horizonte de planificación: ' + error.message, 'error'); return {}; }
  const m = {};
  (data || []).forEach(r => { m[String(r.centro_destino).trim()] = Number(r.horizonte_horas) === 48 ? 48 : 24; });
  return m;
}

// ── FERIADOS (administración manual, para el cálculo de días hábiles) ──────
async function loadFeriados() {
  const { data, error } = await supabase
    .from('abast_feriados').select('*').order('fecha', { ascending: true });
  if (error) { console.error(error); showAlert('Error al cargar feriados: ' + error.message, 'error'); return []; }
  return data || [];
}

// build 20260817f
