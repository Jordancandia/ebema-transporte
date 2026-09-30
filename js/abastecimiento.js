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

import { supabase } from './supabase-client.js?v=202609292339';
import { can, enAlcance, filtrarPorCentro } from './permisos.js?v=202609292339';
import { getDatabase } from './data.js?v=202609292339';
import { showAlert, escapeHtml } from './utils.js';
import { renderTablaV2, setUltimaActualizacion, maxCargadoEn, pill, mono, txt, tonHtml, truckGauge, colorUmbral, esc as escV2 } from './troncales-ui.js?v=202609292339';

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
  const { data, error } = await supabase.from('abast_retiro_estado').select('doc_compr, estado, tipo_retiro, entrega_entrante, tipo_local_rm, fab_direccion, fab_comuna, fab_contacto, fab_telefono, fecha_retiro, updated_at, updated_by');
  const m = {};
  if (!error) (data || []).forEach(r => { m[String(r.doc_compr)] = { estado: r.estado, tipo_retiro: r.tipo_retiro, entrega_entrante: r.entrega_entrante, tipo_local_rm: r.tipo_local_rm, fab_direccion: r.fab_direccion, fab_comuna: r.fab_comuna, fab_contacto: r.fab_contacto, fab_telefono: r.fab_telefono, fecha_retiro: r.fecha_retiro, updated_at: r.updated_at, updated_by: r.updated_by }; });
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
    if (extraFab._clear_retiro) { payload.tipo_retiro = null; payload.entrega_entrante = null; payload.fecha_retiro = null; }
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
    // Excluye la Orden de Compra completa del Plan de Carga (OWNER / Planner Abastecimiento).
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
        // (Fábrica Directo). Si OC >=85% cap camión (UMBRAL_FABRICA, AJUSTE 28-sep-2026)
        // y tiene pedido de venta ⇒ FÁBRICA-CLIENTE.
        const tienePedidoVenta = String(f.documento ?? '').trim() !== '';
        const cap = getCapacidadCamion(f.ce);
        let tipoRetiro;
        if (ton >= cap * UMBRAL_FABRICA && tienePedidoVenta) tipoRetiro = 'FAB-CLTE';
        else if (almVal === '4000') tipoRetiro = 'FAB-CD';
        else if (almVal === '2000') tipoRetiro = 'FAB-SUC';
        else tipoRetiro = 'FAB-SUC';
        const al = alertaFecha(f.fe_entrega, 5);
        const estObj = estados[oc] || {};
        const est = estObj.estado || 'no_coordinado';
        // Usar tipo_retiro guardado si existe (persistencia entre recargas)
        if (estObj.tipo_retiro) tipoRetiro = estObj.tipo_retiro;
        // Cross-reference con pedidos_ventas_dt
        const docPV = String(f.documento ?? '').trim();
        const pv = pvMap[docPV] || {};
        out.push({
          doc_compr: oc, contr: f.contr, proveedor: f.proveedor, nombre_1: f.nombre_1,
          ce: f.ce, _desc_centro: getNombreCentro(f.ce), alm: f.alm, documento: f.documento,
          fe_entrega: f.fe_entrega,
          _tipo_retiro: tipoRetiro,
          _cliente: tipoRetiro === 'FAB-CLTE',
          _consolidar: tipoRetiro === 'FAB-CD',
          _ton_num: ton, _ton_totales: fmtNum(ton, 4),
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
    // Tipo de entrega: ≥85% cap camión (UMBRAL_CD_CLIENTE, AJUSTE 28-sep-2026) ⇒ CD-CLIENTE (camión directo al cliente);
    // menos ⇒ CD-SUCURSAL (se consolida con carga).
    postFilter(filas) {
      filas.forEach(r => {
        const cap = getCapacidadCamion(r.ofvta);
        r._directo = r._ton_num >= cap * UMBRAL_CD_CLIENTE;
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
          ctd_pedido: r.ctd_pedido,
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
    titulo: 'GESTIÓN TRONCALES – PEDIDOS DE TRASLADO REVEX',
    vista: 'v_trc_sqvi_pedidos_traslados',
    // Excluye la línea (doc_compr + material), sólo perfil OWNER.
    excluir: { tipo: 'traslados_revex', doc: r => r.doc_compr, material: r => r.material },
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
    dateRange: { campo: 'fecha', label: 'Fecha Plan (foto 15:30)' },
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
    titulo: 'REVEX',
    desc: 'Pedidos de traslado de retornables (material 900000). Van primero en el orden de llenado del camión.',
    enrich(rows) { rows.forEach(r => { r._al = alertaV2(r.fecha_confirmada, 7); r._t = tonNum(r._ton_totales); }); },
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
      kind: 'Traslado REVEX', title: r.doc_compr, sub: `${nombreCentro(r.cesu) || r.cesu} → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
      kv: [
        ['Centro origen', r.cesu], ['Centro destino', `${r.ce}${nombreCentro(r.ce) ? ' · ' + nombreCentro(r.ce) : ''}`],
        ['Almacén destino', r.alm], ['Material', r.material],
        ['Cantidad pedido', `${r.ctd_pedido || 0} ${r.ump || ''}`.trim()], ['Toneladas', tonHtml(r._t), true],
        ['Fecha entrega', r.fecha_confirmada], ['Alerta', pill(r._al.k, r._al.tone), true],
        ['Fecha creación', r.creado_el], ['Tipo documento', r.cl],
      ],
      nota: '1º en el orden de llenado',
    }),
  },

  // ── VENTAS CD (1003) ──────────────────────────────────────────────────────
  pedidos_venta: {
    titulo: 'Ventas CD (1003)',
    desc: 'Pedidos de ventas con centro expedición CDRM',
    async preload() { return { pvMap: await pvRefMap() }; },
    enrich(rows, ctx) {
      rows.forEach(r => {
        const pv = ctx.pvMap[String(r.doc_ventas ?? '').trim()] || {};
        r._cliente = pv.nombre_1 || '';
        r._vendedor = pv.nombre || '';
        r._cond = condExpedicion(pv.denominacion);
        r._al = alertaV2(r.fe_entrega, 5);
        r._ruta = (r._detalle && r._detalle[0] && r._detalle[0].ruta) || '';
        r._comuna = (r._detalle && r._detalle[0] && r._detalle[0].comuna) || '';
      });
    },
    chip: { label: 'Destino', of: r => String(r.ofvta ?? '').trim(), name: v => nombreCentro(v) || v },
    search: { ph: 'Buscar pedido o cliente', of: r => `${r.doc_ventas} ${r._cliente} ${r._vendedor}` },
    docSearch: null,
    fecha: { label: 'Entrega', of: r => r.fe_entrega },
    kpis: [
      { key: 'all', label: 'Pedidos', color: C_INK, sub: 'pendientes con ruta' },
      { key: 'at', label: 'Atrasados', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
      { key: 'pv', label: 'Pronto a vencer', color: C_ORANGE, sub: '5 días o menos', fn: r => r._al.k === 'Pronto a vencer' },
      { key: 'vi', label: 'Vigentes', color: C_GREEN, sub: 'en plazo', fn: r => r._al.k === 'Vigente' },
      { key: 'cd', label: 'Camión directo', color: '#7e22ce', sub: '≥85% de la capacidad', fn: r => !!r._directo },
    ],
    cols: [
      { label: 'Pedido', html: r => mono(r.doc_ventas, r.creado_el ? 'creado ' + r.creado_el : '') },
      { label: 'Cliente', html: r => txt(r._cliente || '—', r._vendedor, true) },
      { label: 'Destino', html: r => sucHtml(r.ofvta) },
      { label: 'Tipo entrega', html: r => (r._cond ? `<span title="${escV2(r._cond.raw)}">${pill(r._cond.lbl, r._cond.tone)}</span>` : '<span class="sv-muted">—</span>') + (r._directo ? ` ${pill('CD-Cliente', 'purple')}` : '') },
      { label: 'Líneas', al: 'r', html: r => escV2((r._detalle || []).length) },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r.fe_entrega) },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) + (r._estado ? ` ${pill('Parcial', 'warn')}` : '') },
    ],
    edge: r => r._al.k === 'Atrasado' ? C_RED : null,
    note: 'CD-Cliente: pedido ≥85% de la capacidad del camión (camión directo)',
    minW: '1100px',
    detalle: r => ({
      kind: 'Pedido de venta · CE CDRM', title: r.doc_ventas, sub: `${r._cliente || 'Cliente sin nombre'} → ${nombreCentro(r.ofvta) || r.ofvta}`,
      kv: [
        ['Tipo entrega', r._cond ? `${r._cond.lbl} (${r._cond.raw})` : '—'],
        ['Camión', r._directo ? 'CD-Cliente (camión directo)' : 'CD-Sucursal (consolida)'],
        ['Fecha entrega', r.fe_entrega], ['Fecha creación', r.creado_el],
        ['Ruta', r._ruta], ['Comuna', r._comuna],
        ['Oficina ventas', `${r.ofvta}${nombreCentro(r.ofvta) ? ' · ' + nombreCentro(r.ofvta) : ''}`], ['Toneladas', tonHtml(r._ton_num), true],
        ['Vendedor', r._vendedor || r.deudor], ['Alerta', pill(r._al.k, r._al.tone), true],
        r._camino_lbl ? ['Descarga en camino', r._camino_lbl.replace('DESCARGA EN CAMINO ', '').replace(/[()]/g, '')] : null,
        r._estado ? ['Estado', 'Entrega parcial pendiente'] : null,
      ],
      tabla: {
        titulo: `${(r._detalle || []).length} ${(r._detalle || []).length === 1 ? 'material pendiente' : 'materiales pendientes'}`,
        head: [['Material'], ['Descripción'], ['Cantidad', 'r'], ['Ton', 'r']],
        rows: (r._detalle || []).map(d => [mono(d.material), escV2(d.nombre), escV2(fmtNum(d.pendiente, 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`]),
      },
      nota: '2º en el orden de llenado',
    }),
  },

  // ── RETIROS DE FÁBRICA ────────────────────────────────────────────────────
  retiros: {
    titulo: 'Retiros de Fábrica',
    desc: 'Órdenes de compra con retiro a proveedor',
    enrich(rows) { rows.forEach(r => { r._al = alertaV2(r.fe_entrega, 5); }); },
    chip: { label: 'Tipo retiro', of: r => r._tipo_retiro },
    search: { ph: 'Buscar OC o proveedor', of: r => `${r.doc_compr} ${r.nombre_1} ${r.proveedor} ${r.documento || ''}` },
    fecha: { label: 'Entrega SAP', of: r => r.fe_entrega },
    kpis: [
      { key: 'all', label: 'OC por retirar', color: C_INK, sub: 'todas las sucursales' },
      { key: 'no', label: 'Sin coordinar', color: C_RED, sub: 'no entran al plan', fn: r => !esEstadoCoordinado(r._estado) },
      { key: 'si', label: 'Coordinadas', color: C_GREEN, sub: 'con proveedor', fn: r => esEstadoCoordinado(r._estado) },
      { key: 'at', label: 'Atrasadas', color: C_ORANGE, sub: 'vencidas hace más de 5 días, sin coordinar', fn: retiroAtrasado },
    ],
    cols: [
      { label: 'Orden de compra', html: r => mono(r.doc_compr, r.contr ? 'contrato ' + r.contr : '') },
      { label: 'Proveedor', html: r => txt(r.nombre_1, r.proveedor, true) },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Tipo retiro', html: r => pill(r._tipo_retiro, TIPO_RETIRO_TONE[r._tipo_retiro] || 'mute') },
      { label: 'Fecha SAP', html: r => mono(r.fe_entrega) },
      { label: 'Fecha retiro', html: r => r._fecha_retiro ? mono(fmtFechaISO(r._fecha_retiro))
          : (esEstadoCoordinado(r._estado) && r._tipo_local_rm !== 'LOCAL' ? `<span class="sv-b" style="color:${C_RED}">Falta fecha</span>` : '<span class="sv-muted">—</span>') },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Alerta', html: r => retiroAtrasado(r) ? pill('Atrasada', 'bad') : (r._al.k === 'Atrasado' ? pill('Vencida', 'orange') : pill(r._al.k, r._al.k === 'Pronto a vencer' ? 'warn' : r._al.tone)) },
      { label: 'Coordinación', html: r => esEstadoCoordinado(r._estado) ? pill(r._tipo_local_rm === 'LOCAL' ? 'Coordinado · local' : 'Coordinado', 'ok') : pill('Sin coordinar', 'mute') },
    ],
    edge: r => retiroAtrasado(r) ? C_RED : (r._cliente ? C_GREEN : null),
    note: 'FAB-CLTE: OC ≥85% de la capacidad del camión y con pedido de venta · Atrasada: vencida hace más de 5 días y sin coordinar',
    minW: '1100px',
    detalle: r => {
      const coord = esEstadoCoordinado(r._estado);
      const puede = can('coordinar_retiro');
      const cambiarEstado = async (row, val, ctx) => {
        const prev = row._estado, prevLbl = row._estado_lbl;
        row._estado_prev = prev;
        row._estado = val;
        row._estado_lbl = (ESTADO_OPTS.find(o => o.v === val) || {}).l || 'No coordinado';
        const ok = await VISTAS_TRONCAL.retiros.editable.onChange(row, val, ctx);
        if (ok === false) { row._estado = prev; row._estado_lbl = prevLbl; return null; }
        const est = (ctx.estados || {})[String(row.doc_compr)] || {};
        row._upd_at = new Date().toISOString();
        row._upd_by = await getUserEmail();
        est.updated_at = row._upd_at; est.updated_by = row._upd_by;
        return { redibujar: true };
      };
      const acciones = !puede ? [] : coord ? [
        { label: 'Anular coordinación', icon: 'undo', run: async (row, ctx) => {
          if (!confirm(`¿Anular la coordinación de la OC ${row.doc_compr}?\n\nVuelve a «Sin coordinar» y se limpian fecha, dirección y contacto.`)) return null;
          return cambiarEstado(row, 'no_coordinado', ctx);
        } },
        { label: 'Editar coordinación', icon: 'edit_calendar', primary: true, run: (row, ctx) => cambiarEstado(row, 'coordinado', ctx) },
      ] : [
        { label: 'Coordinar retiro', icon: 'event_available', primary: true, run: (row, ctx) => cambiarEstado(row, 'coordinado', ctx) },
      ];
      const diasV = diasVencida(r.fe_entrega);
      return {
        kind: 'Orden de compra', title: r.doc_compr, sub: `${r.nombre_1 || ''} → ${nombreCentro(r.ce) || r.ce} · ${fmtNum(r._ton_num, 2)} t`,
        aviso: retiroAtrasado(r) ? `<b>Atrasada:</b> la fecha SAP venció hace ${diasV} días y la OC sigue sin coordinar.` : '',
        kv: [
          ['Tipo retiro', pill(r._tipo_retiro, TIPO_RETIRO_TONE[r._tipo_retiro] || 'mute'), true],
          ['Coordinación', coord ? (r._tipo_local_rm === 'LOCAL' ? 'Retiro local' : 'Retiro RM') : 'Sin coordinar'],
          ['Almacén destino', r.alm], ['Fecha SAP', r.fe_entrega],
          ['Fecha retiro', r._fecha_retiro ? fmtFechaISO(r._fecha_retiro) : ''], ['Toneladas', tonHtml(r._ton_num), true],
          ['Entrega entrante', r._entrega_entrante], ['Contrato de compra', r.contr],
          coord ? ['Dirección fábrica', r._fab_direccion] : null, coord ? ['Comuna fábrica', r._fab_comuna] : null,
          coord ? ['Contacto', r._fab_contacto] : null, coord ? ['Teléfono', r._fab_telefono] : null,
          r.documento ? ['Pedido de venta', r.documento] : null,
          r.documento ? ['Tipo expedición', r._pv_denominacion] : null,
          r.documento ? ['Cliente', r._pv_nombre_cliente] : null,
          r.documento ? ['Vendedor', r._pv_nombre_vendedor] : null,
          r.documento ? ['Ruta · comuna', [r._pv_ruta, r._pv_comuna].filter(Boolean).join(' · ')] : null,
          r._revision_saldo ? ['Vigencia OC', 'Revisión saldo pedido (entrega parcial)'] : null,
          r._upd_at ? ['Última edición', `${fechaUpd(r._upd_at)}${r._upd_by ? ' · ' + r._upd_by : ''}`] : null,
        ],
        tabla: {
          titulo: `${(r._detalle || []).length} ${(r._detalle || []).length === 1 ? 'material pendiente' : 'materiales pendientes'}`,
          head: [['Material'], ['Descripción'], ['Pendiente', 'r'], ['Ton', 'r']],
          rows: (r._detalle || []).map(d => [mono(d.material), escV2(d.texto_breve), escV2(fmtNum(d.pendiente, 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`]),
        },
        nota: '3º en el orden de llenado · sólo entran al plan las OC coordinadas',
        acciones,
      };
    },
  },

  // ── CROSSDOCKING ──────────────────────────────────────────────────────────
  pedidos_traslados_4000: {
    titulo: 'Crossdocking',
    desc: 'Traslados desde Almacén 4000 (CD Quilicura) a sucursales',
    enrich(rows) { rows.forEach(r => { r._al = alertaV2(r.fe_entrega, 5); r._pv = r._origen === 'PEDIDO DE VENTAS'; }); },
    chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    docSearch: { ph: 'N° pedido de traslado', of: r => r.doc_compr },
    fecha: { label: 'Entrega', of: r => r.fe_entrega },
    search: { ph: 'Buscar material', of: r => `${r.material} ${r.texto_breve} ${r.documento || ''} ${r._cliente || ''}` },
    kpis: [
      { key: 'all', label: 'Líneas', color: C_INK, sub: 'pendientes' },
      { key: 'st', label: 'Stock', color: C_SEC, sub: 'reposición de sucursal', fn: r => !r._pv },
      { key: 'pv', label: 'Pedido de venta', color: C_BLUE, sub: 'asociadas a un cliente', fn: r => r._pv },
      { key: 'at', label: 'Atrasadas', color: C_RED, sub: 'fecha de entrega vencida', fn: r => r._al.k === 'Atrasado' },
      { key: 'pr', label: 'Pronto a vencer', color: C_ORANGE, sub: '5 días o menos', fn: r => r._al.k === 'Pronto a vencer' },
    ],
    cols: [
      { label: 'Pedido traslado', html: r => mono(r.doc_compr) },
      { label: 'Destino', html: r => sucHtml(r.ce) },
      { label: 'Tipo', html: r => r._pv ? pill('Pedido de venta', 'info') : pill('Stock', 'mute') },
      { label: 'Material', html: r => matHtml(r.material, r.texto_breve) },
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r.fe_entrega) },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) },
    ],
    edge: r => r._al.k === 'Atrasado' ? C_RED : null,
    minW: '1040px',
    detalle: r => ({
      kind: 'Traslado desde almacén 4000 · ' + (r._pv ? 'Pedido de venta' : 'Stock'), title: r.doc_compr,
      sub: `CD Quilicura → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
      kv: [
        ['Tipo', r._pv ? 'Pedido de venta' : 'Stock'], ['Fecha entrega', r.fe_entrega],
        ['Material', r.material], ['Cantidad pendiente', r._ctd_pend],
        ['Toneladas', tonHtml(r._ton_num), true], ['Almacén destino', r.alm],
      ].concat(r._pv ? [
        ['N° pedido de venta', r.documento], ['Tipo de expedición', r._tipo_exp],
        ['Ruta', r._ruta], ['Comuna', r._comuna], ['Vendedor', r._vendedor], ['Cliente', r._cliente],
      ] : []),
      nota: '4º en el orden de llenado',
    }),
  },

  // ── PEDIDOS DE TRASLADOS ──────────────────────────────────────────────────
  pedidos_traslados: {
    titulo: 'Pedidos de Traslados',
    desc: 'Pedidos de traslados desde centros de distribución a sucursales',
    origen: { of: r => r.cesu, opciones: ORIGENES_CD },
    enrich(rows) { rows.forEach(r => { r._al = alertaV2(r.fecha_confirmada, 7); r._pr = PRIO_V2[r._prioridad_grupo] || PRIO_V2.E; r._q = grupoQuiebre(r._sd); }); },
    chip: { label: 'Destino', of: r => String(r.ce ?? '').trim(), name: v => nombreCentro(v) || v },
    docSearch: { ph: 'N° pedido de traslado', of: r => r.doc_compr },
    fecha: { label: 'Entrega', of: r => r.fecha_confirmada },
    search: { ph: 'Buscar material', of: r => `${r.material} ${r.texto_breve}` },
    kpis: [
      { key: 'all', label: 'Líneas', color: C_INK, sub: 'pendientes' },
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
      { label: 'Ton', al: 'r', html: r => `<span class="sv-ton">${tonHtml(r._ton_num)}</span>` },
      { label: 'Fecha entrega', html: r => mono(r.fecha_confirmada) },
      { label: 'Prioridad', html: r => pill(r._pr.lbl, r._pr.tone) },
      { label: 'Alerta', html: r => pill(r._al.k, r._al.tone) },
    ],
    edge: r => r._al.k === 'Atrasado' ? C_RED : null,
    note: 'Usuario, AA y Quiebre van en «Quiebre y priorizado» (5º); el resto en «Abastecimiento» (6º)',
    minW: '1080px',
    detalle: r => ({
      kind: 'Pedido de traslado · origen ' + r.cesu, title: r.doc_compr,
      sub: `${nombreCentro(r.cesu) || r.cesu} → ${nombreCentro(r.ce) || r.ce} · ${r.texto_breve || ''}`,
      kv: [
        ['Prioridad', pill(r._pr.lbl, r._pr.tone), true], ['Motivo prioridad', r._motivo_prio],
        ['Clase ABC', r._clasificacion_abc], ['Días de stock', r._sd == null ? 'Sin dato en SLIM' : `${r._sd} · ${r._q.lbl}`],
        ['Creado por', r._usuario], ['Fecha creación', r.creado_el],
        ['Material', r.material], ['Cantidad', r.ctd_pedido],
        ['Toneladas', tonHtml(r._ton_num), true], ['Fecha entrega', r.fecha_confirmada],
        ['Almacén destino', r.alm], ['Alerta', pill(r._al.k, r._al.tone), true],
        r.documento ? ['Pedido de venta', r.documento] : null,
      ],
      nota: r._prioridad_bucket === 'prioridad' ? '5º en el orden de llenado (quiebre y priorizado)' : '6º en el orden de llenado (abastecimiento)',
    }),
  },

  // ── ENTREGAS CREADAS ──────────────────────────────────────────────────────
  entregas_creadas: {
    titulo: 'Entregas Creadas',
    desc: 'Entregas creadas en SAP y su comparación con la foto del Plan de Carga (15:30 del día hábil anterior).',
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
      { key: 'SIN PLAN', label: 'Sin plan', color: C_GREY, sub: 'no estaba en la foto 15:30', fn: r => r.estado_plan === 'SIN PLAN' },
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
        ['Foto del plan', r.fecha_plan ? fmtFechaISO(r.fecha_plan) + ' · 15:30' : '—'], ['Creado por', r.creado_por],
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
    const m = await import('./ind-plan-carga.js?v=202609292339');
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
function esEstadoCoordinado(estado) { return estado === 'coordinado' || estado === 'coordinado_santiago'; }

let planDetalleAbierto = new Set();
let planOrigen = '1003';   // centro origen del plan de carga (1003 / 1081)
// Estado de la presentación v2 del Plan de Carga (filtros y panel lateral abiertos)
const PLAN_V2_STATE = { kpi: 'all', chip: 'all', drawer: null, tab: 'cd', origen: null };

async function renderPlanCarga(stage) {
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
  const revex = revexRaw
    .filter(r => String(r.material ?? '').startsWith('900000'))
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
    .filter(r => { const _e = estadosRetiro[String(r.doc_compr ?? '').trim()] || {}; return esEstadoCoordinado(_e.estado) && _e.tipo_local_rm !== 'LOCAL' && _e.tipo_retiro !== 'FAB-CD'; }) : [];
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
      .filter(r => fechaEnRangoHabil(r.fecha_confirmada, 10, 7, feriadosSet))
      .filter(r => parseNum(r.ctd_confirmada) > 0)
      .filter(r => !estaExcluido(exclusionesPlan, 'traslados_1003', r.doc_compr, r.material))
      .map(r => ({ r, prio: clasificaTraslado(r) }));

    const itemsPrioridad = baseTraslados
      .filter(x => x.prio.bucket === 'prioridad')
      .sort((a, b) => a.prio.orden - b.prio.orden);
    const tonQuiebre = itemsPrioridad.reduce((sum, { r, prio }) => {
      const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
      const tonBruto = calcTon(parseNum(r.peso_neto), r.ctd_confirmada);
      const tonVol = calcTon(parseNum(r.tamano_dimens), r.ctd_confirmada);
      det.quiebre.push({ ...itemT(r, t), _motivo: prio.motivo, tonBruto, tonVol });
      return sum + t;
    }, 0);

    // 2. ABASTECIMIENTO (punto E: material no quebrado), mismo orden de
    //    clasificación ABC que el punto D.
    const itemsAbast = baseTraslados
      .filter(x => x.prio.bucket === 'abastecimiento')
      .sort((a, b) => a.prio.orden - b.prio.orden);
    const tonStock = itemsAbast.reduce((sum, { r, prio }) => {
      const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), r.ctd_confirmada);
      const tonBruto = calcTon(parseNum(r.peso_neto), r.ctd_confirmada);
      const tonVol = calcTon(parseNum(r.tamano_dimens), r.ctd_confirmada);
      det.stock.push({ ...itemT(r, t), _motivo: prio.motivo, tonBruto, tonVol });
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
    const tonCross = t4000
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => parseNum(r.ctd_pedido) > parseNum(r.ctd_entregada))
      .filter(r => !estaExcluido(exclusionesPlan, 'crossdock_4000', r.doc_compr, r.material))
      .reduce((sum, r) => { const pend = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada); const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        const tonBruto = calcTon(parseNum(r.peso_neto), pend), tonVol = calcTon(parseNum(r.tamano_dimens), pend);
        det.cross.push({ pt: r.doc_compr, origen: String(r.cesu ?? '').trim(), ceDestino: String(r.ce ?? '').trim(), almDestino: String(r.alm ?? '').trim(), material: r.material, nombre: r.texto_breve, fecha: r.fe_entrega, ctdPend: pend, ton: t, pv: r.documento, tonBruto, tonVol }); return sum + t; }, 0);

    // 5. Notas de Venta 1003 (ofvta = centro): requiere ruta, excluye RETIRA.
    //    >26T  ⇒ CAMIÓN CLIENTE (directo al cliente, no se consolida). Fecha -3/+3.
    //    ≤26T  ⇒ PEDIDO DE VENTA DIRECTA (consolida con la carga del CD).   Fecha -3/+3.
    //    Dedup doc_ventas|material: el SQVI puede tener varias líneas para el mismo
    //    PV+material (distintas fechas). Se conserva la fila con fecha más reciente,
    //    igual que la lógica usada en la vista tabla de pedidos de ventas.
    const _ventasDedupMap = new Map();
    ventas
      .filter(r => String(r.ofvta ?? '').trim() === ce)
      .filter(r => String(r.ruta ?? '').trim() !== '')
      .filter(r => normTxt(r.ruta).indexOf('RETIRA') === -1)
      // (AJUSTE 24-sep-2026, pedido Jordan) La ventana -3/+3 es en DÍAS HÁBILES,
      // sin contar sábados/domingos/feriados — antes eran días corridos y un
      // pedido a 2 días hábiles pero 4 días corridos (ej. jueves → lunes) quedaba
      // excluido incorrectamente.
      .filter(r => fechaEnRangoHabil(r.fe_entrega, 3, 3, feriadosSet))
      .filter(r => !estaExcluido(exclusionesPlan, 'venta_1003', r.doc_ventas, null))
      .forEach(r => {
        const k = `${String(r.doc_ventas ?? '').trim()}|${String(r.material ?? '').trim()}`;
        const ex = _ventasDedupMap.get(k);
        if (!ex) { _ventasDedupMap.set(k, r); return; }
        const dNew = parseDateSAP(r.fe_entrega), dOld = parseDateSAP(ex.fe_entrega);
        if (dNew && (!dOld || dNew >= dOld)) _ventasDedupMap.set(k, r);
      });
    const ventasCe = Array.from(_ventasDedupMap.values());
    const ventasPorDoc = {};
    ventasCe.forEach(r => { const d = String(r.doc_ventas ?? '').trim(); (ventasPorDoc[d] = ventasPorDoc[d] || []).push(r); });
    // (AJUSTE 21-sep-2026) CAMIÓN CD-CLIENTE: pedidos de venta 1003 con despacho directo
    // a cliente. Se agrupan por CLIENTE (deudor): si la suma de sus pedidos supera el 85% de
    // la capacidad del camión, salen directo al cliente (puede ser más de un pedido). Si no,
    // pasan a Venta Directa (se consolidan con el camión CD).
    // (AJUSTE 28-sep-2026, pedido Jordan)
    //  · Las NV directas CD-CLIENTE se planifican el día hábil ANTERIOR a su fecha de
    //    entrega: una NV con entrega 30.09 entra en el plan del 28.09 para despacharse
    //    el 29.09 (= diaHabil1). Condición: fecha entrega − 1 día hábil ≤ diaHabil1, que
    //    equivale a fecha entrega ≤ diaHabil2. Las NV de un cliente que forman camión
    //    directo pero cuya fecha aún no llega se DIFIEREN (no entran hoy ni se consolidan).
    //    Las NV consolidables mantienen la regla de siempre (ventana ±3 días hábiles).
    //  · Umbral 85% (antes 80%).
    //  · Si el cliente requiere más de un camión, se reparte en N camiones (armarCamiones)
    //    y el ícono muestra X2 / X3.
    let tonVentaCliente = 0, tonVentaCons = 0;
    const limiteDirectoCli = diaHabil2;
    const ventasPorGrupo = {};
    for (const [doc, items] of Object.entries(ventasPorDoc)) {
      const pv = pvMap[doc] || {};
      const clienteKey = String(items[0].deudor ?? '').trim() || String(pv.nombre_1 ?? '').trim() || doc;
      items.forEach(r => {
        const pend = parseNum(r.ctd_confirmada) - parseNum(r.cantidad_entrg);
        if (pend <= 0) return;
        const t = calcTon(maxPesoDim(r.peso_neto, r.tamano_dimens), pend);
        if (t <= 0) return;
        const tonBruto = calcTon(parseNum(r.peso_neto), pend), tonVol = calcTon(parseNum(r.tamano_dimens), pend);
        const rl = lookupRuta(r.ruta);
        const item = { pv: doc, material: r.material, nombre: r.denominacion_de_posicion, cant: pend, ruta: r.ruta, comuna: rl.comuna, region: rl.region, fecha: r.fe_entrega, ton: t, tonBruto, tonVol, tipoExp: pv.denominacion || '', cliente: pv.nombre_1 || '', vendedor: pv.nombre || '' };
        const fe = parseDateSAP(r.fe_entrega);
        const vigente = !fe || fe.getTime() <= limiteDirectoCli.getTime();
        const gk = clienteKey + '|' + (vigente ? 'VIGENTE' : isoLocal(fe));
        const g = (ventasPorGrupo[gk] = ventasPorGrupo[gk] || { ton: 0, items: [], vigente, nombre: pv.nombre_1 || clienteKey });
        g.ton += t; g.items.push(item);
      });
    }
    const camionesCliente = [];
    let tonClienteDiferido = 0;
    Object.values(ventasPorGrupo).forEach(g => {
      if (g.ton > capRef * UMBRAL_CD_CLIENTE) {
        if (!g.vigente) { tonClienteDiferido += g.ton; return; } // camión directo de otro día
        armarCamiones(g.items, capRef, d => d.pv).forEach(c => camionesCliente.push({ ...c, grupo: g.nombre, cap: capRef }));
      } else { tonVentaCons += g.ton; det.ventaCons.push(...g.items); }
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
        const cant = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada);
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
    const fechaPlanCe = getHorizonte(ce) === 48 ? diaHabil2 : diaHabil1;
    const retirosFab = retirosDirectosBase
      .filter(r => String(r.ce ?? '').trim() === ce)
      .filter(r => !estaExcluido(exclusionesPlan, 'retiro_fabrica', r.doc_compr, r.material))
      .filter(r => (parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada)) > 0)
      .filter(r => { const fr = parseISODate((estadosRetiro[String(r.doc_compr ?? '').trim()] || {}).fecha_retiro); return !!fr && fr.getTime() === fechaPlanCe.getTime(); });
    const ocCli = {}, provSuc = {};   // cliente/proveedor -> { ton, items:[] }
    retirosFab.forEach(r => {
      const cant = parseNum(r.ctd_pedido) - parseNum(r.ctd_entregada);
      const t = calcTon(maxPesoDim(r.peso_bruto, r.tamano_dimens), cant);
      const item = itemR(r, cant, t);
      const docPV = String(r.documento ?? '').trim();
      const pvR = pvMap[docPV] || {};
      const cond = normTxt(pvR.denominacion).replace(/\s+/g, ' ');
      if (docPV === '' || cond === COND_EBEMA_RETIRA_CLIENTE_RETIRA) {
        const p = String(r.proveedor ?? '').trim();
        (provSuc[p] = provSuc[p] || { ton: 0, items: [] }); provSuc[p].ton += t; provSuc[p].items.push(item);
      } else if (cond === COND_EBEMA_RETIRA_EBEMA_DESPACHA) {
        const c = String(pvR.nombre_1 ?? '').trim() || docPV;
        (ocCli[c] = ocCli[c] || { ton: 0, items: [] }); ocCli[c].ton += t; ocCli[c].items.push(item);
      }
      // Otras condiciones de expedición (p. ej. despacho directo del proveedor) no forman camión propio.
    });
    const capFab = getCapacidadCamion(ce);
    let tonFabCli = 0, tonFabSuc = 0;
    // (AJUSTE 28-sep-2026) Umbral 85% y reparto en N camiones por grupo (X2/X3).
    const camionesFabCli = [], camionesFabSuc = [];
    Object.entries(ocCli).forEach(([k, b]) => { if (b.ton > capFab * UMBRAL_FABRICA) armarCamiones(b.items, capFab, d => d.oc).forEach(c => camionesFabCli.push({ ...c, grupo: k, cap: capFab })); });
    Object.entries(provSuc).forEach(([k, b]) => { if (b.ton > capFab * UMBRAL_FABRICA) armarCamiones(b.items, capFab, d => d.oc).forEach(c => camionesFabSuc.push({ ...c, grupo: (b.items[0] && b.items[0].prov) || k, cap: capFab })); });
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
    if (sobrecarga > 0) obs = (obs ? obs + ' · ' : '') + '2º CAMIÓN (~' + fmtNum(sobrecarga, 1) + ' T)';
    if (promovido24) obs = (obs ? obs + ' · ' : '') + 'ADELANTADO A 24H (carga completa)';
    if (tonClienteDiferido > 0) obs = (obs ? obs + ' · ' : '') + 'CD-CLIENTE PRÓXIMO (' + fmtNum(tonClienteDiferido, 1) + ' T, fecha entrega posterior)';

    return {
      ce, nombre: getNombreCentro(ce), cap,
      tonQuiebre, tonStock, tonRevex, tonCross, tonVentaCons, tonVentaCliente, tonRetiro, tonFabSuc, tonFabCli,
      total, faltan, sobrecarga, pct, status, statusCls, obs, enCalendario,
      horizonte: horizonteEfectivo, horizonteConfig, promovido24,
      camionCliente: tonVentaCliente > 0, camionFabSuc: tonFabSuc > 0, camionFabCli: tonFabCli > 0,
      camionesCliente, camionesFabSuc, camionesFabCli, tonClienteDiferido,
      det,
    };
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
  function marcarCapacidadCD(r) {
    const orden = [r.det.revex, r.det.ventaCons, r.det.retiro, r.det.cross, r.det.quiebre, r.det.stock];
    let acc = 0;
    orden.forEach(arr => (arr || []).forEach(d => {
      if (acc + d.ton <= r.cap + 1e-9) { d._enCamion = true; acc += d.ton; }
      else { d._enCamion = false; }
    }));
    return { cargado: acc, excede: Math.max(0, (r.total || 0) - acc) };
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
        ${fill.excede > 0 ? `<span class="text-green-700 font-bold"><strong>Sobra:</strong> +${fmtNum(fill.excede, 1)} t (requiere 2º camión)</span>` : '<span class="text-green-700 font-bold">✓ Todo cabe en el camión</span>'}
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
  const DIR_V2 = [
    { k: 'cliente', lista: 'camionesCliente', lbl: 'CD-Cliente',     grupo: 'Cliente',   tipo: 'V', icon: 'local_shipping' },
    { k: 'fabSuc',  lista: 'camionesFabSuc',  lbl: 'Fáb-Sucursal',   grupo: 'Proveedor', tipo: 'R', icon: 'factory' },
    { k: 'fabCli',  lista: 'camionesFabCli',  lbl: 'Fáb-Cliente',    grupo: 'Cliente',   tipo: 'R', icon: 'factory' },
  ];
  const diaCorto = d => `${diasSemana[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}`;
  const estadoV2 = r => r.pct >= 80 ? { lbl: 'Programar', tone: 'ok', k: 'prog' } : r.pct >= 70 ? { lbl: 'Revisar', tone: 'warn', k: 'rev' } : { lbl: 'Carga insuficiente', tone: 'mute', k: 'ins' };
  const nDirectos = r => DIR_V2.reduce((s, t) => s + (r[t.lista] || []).length, 0);
  const t1 = n => fmtNum(n, 1);
  const st = PLAN_V2_STATE;
  if (st.origen !== planOrigen) { st.kpi = 'all'; st.chip = 'all'; st.drawer = null; st.origen = planOrigen; }
  setUltimaActualizacion(maxCargadoEn(trasladosRaw) || maxCargadoEn(quiebresRaw));

  function tagsV2(r) {
    const t = [];
    if (r.enCalendario) t.push('<span class="sv-tag agenda"><span class="material-symbols-outlined">event</span>Agenda</span>');
    if (!r.enCalendario && r.pct >= 70) t.push('<span class="sv-tag extra"><span class="material-symbols-outlined">add_circle</span>Cupo extra</span>');
    if (r.enCalendario && r.pct < 70) t.push('<span class="sv-tag baja">Carga baja</span>');
    if (r.promovido24) t.push('<span class="sv-tag promo" title="Adelantado a 24h: la carga de mañana ya completa el camión">48h→24h</span>');
    if (r.sobrecarga > 0) t.push('<span class="sv-tag seg"><span class="material-symbols-outlined">local_shipping</span>2º camión</span>');
    if (r.tonClienteDiferido > 0) t.push(`<span class="sv-tag mute" title="CD-Cliente con fecha de entrega posterior: ${t1(r.tonClienteDiferido)} t">CD-Cliente próximo</span>`);
    return t.join('');
  }
  function directosV2(r) {
    const chips = DIR_V2.filter(t => (r[t.lista] || []).length).map(t => {
      const cams = r[t.lista]; const ton = cams.reduce((s, c) => s + c.ton, 0);
      return `<span class="sv-dirchip"><span class="material-symbols-outlined">${t.icon}</span>${escapeHtml(t.lbl)} · ${t1(ton)} t${cams.length > 1 ? `<em title="Se requieren ${cams.length} camiones">X${cams.length}</em>` : ''}</span>`;
    });
    return chips.length ? `<div class="sv-dir">${chips.join('')}</div>` : '<span class="sv-muted">—</span>';
  }
  const segsV2 = r => CAT_V2.map(c => ({ ton: c.ton(r), color: c.color, label: c.lbl }));

  function filaV2(r) {
    const e = estadoV2(r);
    const fs = r.sobrecarga > 0
      ? `<b style="color:#15803d">+${t1(r.sobrecarga)} t</b><small>sobra · 2º camión</small>`
      : r.faltan > 0 ? `<b style="color:#b5000b">−${t1(r.faltan)} t</b><small>falta para llenar</small>` : '<b>0,0 t</b><small>camión completo</small>';
    return `<button class="sv-prow ${r.enCalendario ? 'is-agenda' : ''} ${st.drawer === r.ce ? 'is-sel' : ''}" data-chip data-suc="${escapeHtml(r.ce)}">
      <div style="min-width:0"><div class="sv-suc">${escapeHtml(r.nombre)}<span class="sv-mono">${escapeHtml(r.ce)}</span></div>
        <div class="sv-tags">${tagsV2(r)}</div>
        <div class="sv-sub" style="margin-top:4px">${r.horizonte}h · ${escapeHtml(diaCorto(r.horizonte === 48 ? diaHabil2 : diaHabil1))}</div></div>
      <div class="sv-pcarga">${r.total > 0 ? truckGauge(segsV2(r), r.cap, { w: 150, h: 30 }) : '<span class="sv-muted">Sin carga</span>'}
        <div class="sv-pct"><b>${r.pct}%</b><small>${t1(r.total)} / ${fmtNum(r.cap, 0)} t</small></div></div>
      <div class="sv-fs">${fs}</div>
      <div>${pill(e.lbl, e.tone)}</div>
      <div>${directosV2(r)}</div>
      <span class="material-symbols-outlined" style="color:#5c5f61">chevron_right</span>
    </button>`;
  }

  // ── Detalle (panel lateral) ───────────────────────────────────────────────
  const excBtn = (tipo, doc, material) => PUEDE_EXCLUIR
    ? `<button class="sv-excl" data-excluir="${escapeHtml(tipo)}|${escapeHtml(String(doc ?? ''))}|${escapeHtml(String(material ?? ''))}" title="Excluir del Plan de Carga de hoy">Excluir</button>` : '';
  function tablaItems(tipo, items) {
    const conExc = PUEDE_EXCLUIR && (tipo === 'V' || tipo === 'X');
    const head = { T: ['Pedido', 'Material', 'Fecha', 'Cant.', 'Ton'], V: ['Pedido de venta', 'Material', 'Fecha', 'Cant.', 'Ton'], R: ['Orden de compra', 'Material', 'Fecha retiro', 'Cant.', 'Ton'], X: ['Pedido traslado', 'Material', 'Fecha', 'Cant.', 'Ton'] }[tipo];
    const fila = d => {
      const mat = mono(d.material, d.nombre);
      if (tipo === 'T') return [mono(d.pt, d._motivo ? d._motivo : (d.pv ? 'PV ' + d.pv : '')), mat, mono(d.fecha), escapeHtml(d.ctd ?? ''), `<span class="sv-ton">${tonHtml(d.ton)}</span>`];
      if (tipo === 'V') return [mono(d.pv, d.cliente || ''), mat, mono(d.fecha), escapeHtml(fmtNum(parseNum(d.cant), 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`, excBtn('venta_1003', d.pv, null)];
      if (tipo === 'R') return [mono(d.oc, d.prov || ''), mat, mono(d.fecha), escapeHtml(fmtNum(parseNum(d.cant), 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`];
      return [mono(d.pt, d.pv ? 'PV ' + d.pv : ''), mat, mono(d.fecha), escapeHtml(fmtNum(d.ctdPend, 0)), `<span class="sv-ton">${tonHtml(d.ton)}</span>`, excBtn('crossdock_4000', d.pt, d.material)];
    };
    const hs = head.concat(conExc ? [''] : []);
    return `<div class="sv-card" style="overflow:auto"><table class="sv-table">
      <thead><tr>${hs.map((h, i) => `<th class="${i >= 3 && i <= 4 ? 'r' : ''}">${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${items.map(d => { const c = fila(d); return `<tr>${(conExc ? c : c.slice(0, 5)).map((v, i) => `<td class="${i >= 3 && i <= 4 ? 'r' : ''}">${v}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`;
  }
  function kvHtml(pares) {
    return `<dl class="sv-kv" style="margin:0">${pares.filter(Boolean).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }
  function drawerBody(r, tab) {
    if (tab === 'cd') {
      const fill = marcarCapacidadCD(r);
      const e = estadoV2(r);
      const secs = CAT_V2.map(c => {
        const items = (r.det[c.k] || []).filter(d => d._enCamion);
        if (!items.length) return '';
        const sub = items.reduce((s, d) => s + (d.ton || 0), 0);
        const orden = CAT_V2.indexOf(c) + 1;
        return `<div><div class="sv-cat"><i style="background:${c.color}"></i>${orden}º ${escapeHtml(c.lbl)}<small>${items.length} líneas · ${t1(sub)} t</small></div>${tablaItems(c.tipo, items)}</div>`;
      }).join('');
      const fuera = CAT_V2.reduce((a, c) => a.concat((r.det[c.k] || []).filter(d => d._enCamion === false)), []);
      const tonFuera = fuera.reduce((s, d) => s + (d.ton || 0), 0);
      return `<div style="display:flex;justify-content:center;padding:4px 0">${truckGauge(segsV2(r), r.cap, { w: 220, h: 40 })}</div>
        ${kvHtml([
          ['Capacidad', `${fmtNum(r.cap, 0)} t`], ['Cargado', `${t1(fill.cargado)} t · ${r.pct}%`],
          [r.sobrecarga > 0 ? 'Sobra' : 'Falta', r.sobrecarga > 0 ? `<span style="color:#15803d">+${t1(r.sobrecarga)} t (2º camión)</span>` : `<span style="color:#b5000b">${t1(r.faltan)} t</span>`],
          ['Estado', pill(e.lbl, e.tone)],
          ['Horizonte', `${r.horizonte}h${r.promovido24 ? ' (adelantado desde 48h)' : r.horizonteConfig !== r.horizonte ? '' : ''}`], ['Día objetivo', escapeHtml(fmtDiaHabil(r.horizonte === 48 ? diaHabil2 : diaHabil1))],
          ['Agenda', r.enCalendario ? 'En calendario del día' : 'Fuera de agenda'],
          r.tonClienteDiferido > 0 ? ['CD-Cliente próximo', `${t1(r.tonClienteDiferido)} t (fecha de entrega posterior)`] : null,
        ])}
        ${secs || '<div class="sv-note-box">El camión CD no tiene carga para esta sucursal.</div>'}
        ${fuera.length ? `<div class="sv-note-box"><b>2º camión:</b> ${fuera.length} líneas (${t1(tonFuera)} t) no caben en el camión CD. Van en la descarga con «En Camión = EXCEDE».</div>` : ''}`;
    }
    const [tk, n] = tab.split(':');
    const t = DIR_V2.find(x => x.k === tk);
    const lista = r[t.lista] || [];
    const c = lista.find(x => String(x.n) === n) || lista[0];
    if (!c) return '<div class="sv-note-box">Sin camiones.</div>';
    const pct = c.cap > 0 ? Math.round(c.ton / c.cap * 100) : 0;
    return `<div style="display:flex;justify-content:center;padding:4px 0">${truckGauge([{ ton: c.ton, color: '#1d4ed8', label: t.lbl }], c.cap, { w: 220, h: 40 })}</div>
      ${kvHtml([
        ['Tipo', escapeHtml(TRUCK_TITULOS[tk] || t.lbl)], [t.grupo, escapeHtml(c.grupo || '')],
        ['Carga', `${t1(c.ton)} t · ${pct}%`], ['Capacidad', `${fmtNum(c.cap, 0)} t`],
        lista.length > 1 ? ['Camiones del grupo', `${lista.length} (X${lista.length})`] : null,
      ])}
      <div><div class="sv-cat"><i style="background:#1d4ed8"></i>Contenido del camión ${c.n} de ${lista.length}<small>${c.items.length} líneas · ${t1(c.ton)} t</small></div>${tablaItems(t.tipo, c.items)}</div>`;
  }
  function drawerHtml(r) {
    const tabs = [{ k: 'cd', lbl: `Camión CD · ${r.pct}%` }];
    DIR_V2.forEach(t => (r[t.lista] || []).forEach(c => tabs.push({ k: `${t.k}:${c.n}`, lbl: `${t.lbl}${(r[t.lista] || []).length > 1 ? ' ' + c.n : ''} · ${t1(c.ton)} t` })));
    if (!tabs.some(x => x.k === st.tab)) st.tab = 'cd';
    return `<div class="sv-dr-bg" data-close></div>
      <aside class="sv-dr is-wide" role="dialog" aria-label="Plan de carga de ${escapeHtml(r.nombre)}">
        <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">Plan de carga · ${escapeHtml(CALENDARIOS[planOrigen]?.nombre || planOrigen)} → sucursal</div>
          <div class="sv-dr-t" style="font-family:inherit;font-weight:600">${escapeHtml(r.nombre)} <span class="sv-mono" style="font-size:16px;color:#5c5f61">${escapeHtml(r.ce)}</span></div>
          <div class="sv-tags" style="margin-top:6px">${tagsV2(r)}</div></div>
          <button class="sv-iconbtn" data-close title="Cerrar (Esc)"><span class="material-symbols-outlined">close</span></button></div>
        <div class="sv-tabs">${tabs.map(t => `<button data-chip data-tab-plan="${escapeHtml(t.k)}" class="${st.tab === t.k ? 'is-on' : ''}">${escapeHtml(t.lbl)}</button>`).join('')}</div>
        <div class="sv-dr-b">${drawerBody(r, st.tab)}</div>
        <div class="sv-dr-f"><span class="sv-dr-note">Orden de llenado: REVEX → Venta → Retiro → Cross → Quiebre → Abastecimiento</span>
          <button class="sv-btn" data-descarga="${escapeHtml(r.ce)}|cd"><span class="material-symbols-outlined">download</span>Descargar sucursal</button></div>
      </aside>`;
  }

  function draw() {
    const kpiDef = [
      { key: 'prog', label: 'Programar', color: '#15803d', sub: 'sucursales ≥80%', fn: r => estadoV2(r).k === 'prog' },
      { key: 'rev', label: 'Revisar', color: '#ca8a04', sub: 'sucursales 70–80%', fn: r => estadoV2(r).k === 'rev' },
      { key: 'ins', label: 'Insuficiente', color: '#9ca3af', sub: 'sucursales <70%', fn: r => estadoV2(r).k === 'ins' },
      { key: 'dir', label: 'Camiones directos', color: '#1d4ed8', sub: 'CD-Cliente y fábrica', fn: r => nDirectos(r) > 0, valor: l => l.reduce((s, r) => s + nDirectos(r), 0) },
      { key: 'ton', label: 'Toneladas', color: '#191c1d', sub: 'en el plan de hoy', valor: l => fmtNum(l.reduce((s, r) => s + r.total + r.tonVentaCliente + r.tonFabSuc + r.tonFabCli, 0), 0) },
    ];
    const chipDef = [
      { key: 'all', label: 'Todas', fn: () => true },
      { key: 'agenda', label: 'En agenda', fn: r => r.enCalendario },
      { key: 'fuera', label: 'Fuera de agenda', fn: r => !r.enCalendario },
      { key: 'dir', label: 'Con directos', fn: r => nDirectos(r) > 0 },
    ];
    const chipFn = (chipDef.find(c => c.key === st.chip) || chipDef[0]).fn;
    const byChip = resultado.filter(chipFn);
    const kf = (kpiDef.find(k => k.key === st.kpi) || {}).fn;
    const filas = kf ? byChip.filter(kf) : byChip;

    stage.innerHTML = `<div class="sv-view">
      <div class="sv-vhead">
        <div style="min-width:0"><h1 class="sv-h1">Plan de Carga</h1>
          <div class="sv-desc" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
            <span><span class="sv-tag promo">24h</span> ${escapeHtml(fmtDiaHabil(diaHabil1))}</span>
            <span><span class="sv-tag mute">48h</span> ${escapeHtml(fmtDiaHabil(diaHabil2))}</span></div></div>
        <div class="sv-actions">
          <div class="sv-seg" role="group" aria-label="Centro origen">${Object.keys(CALENDARIOS).map(id =>
            `<button data-chip data-origen="${id}" class="${planOrigen === id ? 'is-on' : ''}"><span class="material-symbols-outlined">warehouse</span>${escapeHtml(CALENDARIOS[id].nombre)} (${id})</button>`).join('')}</div>
          ${PUEDE_EXCLUIR ? `<button class="sv-btn" data-ver-exclusiones data-chip title="Ver y reactivar exclusiones"><span class="material-symbols-outlined">visibility_off</span>Exclusiones${exclusionesPlan.length ? ` <span class="sv-pill mute" style="padding:0 7px">${exclusionesPlan.length}</span>` : ''}</button>` : ''}
          <button class="sv-btn" data-descarga="__todo__" title="Descarga el plan de todas las sucursales visibles"><span class="material-symbols-outlined">download</span>Descargar plan</button>
          <button class="sv-btn is-icon" data-refrescar title="Refrescar datos"><span class="material-symbols-outlined">refresh</span></button>
        </div></div>
      <div class="sv-kpis">${kpiDef.map(k => {
        const on = st.kpi === k.key;
        const val = k.valor ? k.valor(byChip) : byChip.filter(k.fn).length;
        return `<button class="sv-kpi ${on ? 'is-on' : ''}" ${k.fn ? `data-chip data-kpi="${k.key}"` : 'data-chip disabled style="cursor:default"'} style="${on ? `box-shadow:inset 0 -3px 0 ${k.color}` : ''}">
          <div class="sv-kpi-l"><i style="background:${k.color}"></i>${escapeHtml(k.label)}</div><div class="sv-kpi-v">${escapeHtml(String(val))}</div><div class="sv-kpi-s">${escapeHtml(k.sub)}</div></button>`;
      }).join('')}</div>
      <div class="sv-filters">
        <div class="sv-frow">${chipDef.map(c => `<button class="sv-chip ${st.chip === c.key ? 'is-on' : ''}" data-chip data-plan-chip="${c.key}">${escapeHtml(c.label)} <small>${resultado.filter(c.fn).length}</small></button>`).join('')}
          ${st.kpi !== 'all' || st.chip !== 'all' ? '<button class="sv-btn-g" data-chip data-plan-clear>Limpiar filtros</button>' : ''}</div>
        <div class="sv-legend"><b>Orden de llenado</b>${CAT_V2.map((c, i) => `<span><i style="background:${c.color}"></i>${i + 1}. ${escapeHtml(c.lbl)}</span>`).join('')}</div>
      </div>
      <div class="sv-plan">
        <div class="sv-phead"><span>Sucursal</span><span>Carga camión CD</span><span style="text-align:right">Falta / sobra</span><span>Estado</span><span>Camiones directos</span><span></span></div>
        ${filas.length ? filas.map(filaV2).join('') : '<div class="sv-card" style="padding:32px;text-align:center;color:#5c5f61">Ninguna sucursal coincide con los filtros.</div>'}
      </div>
      <div class="sv-dr-note">Capacidad 28 t (15 t La Calera / San Bernardo si no alcanzan 28 t) · Camiones directos: grupo &gt;85% de la capacidad · X2/X3 = camiones requeridos</div>
      <div data-drawer-slot>${st.drawer && resultado.find(x => x.ce === st.drawer) ? drawerHtml(resultado.find(x => x.ce === st.drawer)) : ''}</div>
    </div>`;

    stage.querySelector('[data-refrescar]')?.addEventListener('click', () => { clearRawCache(); renderPlanCarga(stage); });
    stage.querySelectorAll('[data-origen]').forEach(btn => btn.addEventListener('click', () => {
      if (planOrigen === btn.dataset.origen) return;
      planOrigen = btn.dataset.origen; renderPlanCarga(stage);
    }));
    stage.querySelectorAll('[data-kpi]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.kpi; st.kpi = st.kpi === k ? 'all' : k; draw(); }));
    stage.querySelectorAll('[data-plan-chip]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.planChip; st.chip = st.chip === k && k !== 'all' ? 'all' : k; draw(); }));
    stage.querySelector('[data-plan-clear]')?.addEventListener('click', () => { st.kpi = 'all'; st.chip = 'all'; draw(); });
    stage.querySelectorAll('[data-suc]').forEach(b => b.addEventListener('click', () => { st.drawer = b.dataset.suc; st.tab = 'cd'; draw(); }));
    stage.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { st.drawer = null; draw(); }));
    stage.querySelectorAll('[data-tab-plan]').forEach(b => b.addEventListener('click', () => { st.tab = b.dataset.tabPlan; draw(); }));
    stage.querySelectorAll('[data-descarga]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [ce] = btn.dataset.descarga.split('|');
      if (ce === '__todo__') { csvPlanCompleto(filas); return; }
      const r = resultado.find(x => x.ce === ce);
      if (r) csvDetalleCamion(r);
    }));
    stage.querySelectorAll('[data-excluir]').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const [tipo, doc, material] = btn.dataset.excluir.split('|');
      const etiqueta = tipo === 'venta_1003' ? `el Pedido de Venta ${doc} completo` : (material ? `el material ${material} del Pedido de Traslado ${doc}` : `el Pedido de Traslado ${doc} completo`);
      if (!confirm(`¿Excluir del Plan de Carga de hoy ${etiqueta}?\n\nQueda excluido hasta que lo reactives desde "Exclusiones".`)) return;
      const ok = await excluirDelPlan(tipo, doc, material || null, 'Excluido desde Plan de Carga');
      if (ok) { showAlert('Excluido del Plan de Carga', 'success'); renderPlanCarga(stage); }
    }));
    stage.querySelector('[data-ver-exclusiones]')?.addEventListener('click', () => showExclusionesModal(exclusionesPlan, () => renderPlanCarga(stage)));
  }
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
        if (!confirm(`¿Excluir del Plan de Carga ${etiqueta}?\n\nSe mantiene disponible para futuros planes hasta que la reactives.`)) return;
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
    if (CAL_V2.dirty && !confirm('Hay cambios sin guardar en el calendario. ¿Descartarlos y cambiar de centro?')) return;
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
    if (!confirm('¿Eliminar este feriado?')) return;
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
