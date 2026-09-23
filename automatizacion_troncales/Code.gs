/**
 * ============================================================================
 *  AUTOMATIZACION CORREOS TRONCALES / ENTREGAS / DT / PEDIDOS VENTAS / SLIM
 *  ->  SUPABASE (SIT EBEMA)
 * ----------------------------------------------------------------------------
 *  REESCRITO 2026-09-18: cada "proyecto" ahora es un bloque de lectura
 *  INDEPENDIENTE, con su propia etiqueta Gmail y su propio horario, para
 *  eliminar la simultaneidad de corridas que dificultaba la carga correcta
 *  de datos. Cada bloque procesa SOLO correos NO leidos de SU etiqueta y
 *  marca como leidos unicamente los que el mismo proceso. Lectura de
 *  lunes a viernes (cada entrypoint valida esDiaHabil() antes de tocar Gmail).
 *
 *  ACTUALIZADO 2026-09-22: fallback de CARGA MANUAL por Drive. Los Jobs SAP
 *  "ZJC PLAN TRONCALES" y "ZJC PLAN ENTREGAS" (Steps 2-11) dejaron de llegar
 *  por correo. Mientras se resuelve en SAP, si una fuente de esos dos bloques
 *  NO tiene correo SAP no leido, el script busca en una carpeta de Drive un
 *  archivo Excel con el nombre exacto de la fuente (ej. "sqvi_retiros_fabrica.xlsx")
 *  que el usuario sube manualmente (export SAP GUI -> Hoja de calculo), y lo
 *  carga igual que si hubiera llegado por correo. No se toco ningun horario
 *  ni la logica de Gmail: el correo SAP sigue teniendo PRIORIDAD si llega.
 *
 *  FIX 2026-09-22 (mismo dia): txt() convertia mal las celdas NUMERICAS del
 *  Excel manual (ver comentario en txt() mas abajo) -> toneladas infladas
 *  10x en Plan de Carga para datos cargados manualmente. Corregido.
 *
 *  Bloques y horarios (hora Chile, lunes a viernes):
 *   - TRONCALES        (label "SQVI Troncales", Job ZJC PLAN TRONCALES Steps 1-6)
 *       07:55, 09:35, 10:35, 11:35, 12:35, 13:35, 14:50
 *       (la corrida de las 13:35 ademas guarda snapshot diario, historico 7 dias)
 *   - PEDIDOS DE VENTAS (label "Pedidos de Ventas (NV)", Job ZJC PLAN ENTREGAS Steps 2-11)
 *       07:40, 11:10, 13:10, 14:40
 *   - ENTREGAS          (label "Entregas", Job ZJC PLAN ENTREGAS Step 1)
 *       07:15, 12:30, 15:00
 *   - DOC TRANSPORTE    (label "Doc Transporte (DT)", Job ZJC PLAN DT Step 1)
 *       08:10, 16:30, 22:30
 *   - SLIM              (label "Plan Troncales (SLIM)", adjunto Excel)
 *       06:30 (unica corrida del dia)
 *
 *  Requisitos (ver README_DESPLIEGUE.md):
 *   1) Zona horaria del proyecto = America/Santiago
 *   2) Servicio avanzado "Drive API" habilitado (para convertir Excel SLIM
 *      y los Excel de carga manual)
 *   3) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 *   4) Las etiquetas Gmail y sus filtros YA EXISTEN (creadas previamente):
 *      "SQVI Troncales", "Plan Troncales (SLIM)", "Pedidos de Ventas (NV)",
 *      "Entregas", "Doc Transporte (DT)". No es necesario crearlas de nuevo.
 *   5) Carpeta Drive de carga manual (ver DRIVE_FOLDER_MANUAL_ID abajo), con
 *      un archivo .xlsx por fuente, nombrado exactamente como la fuente
 *      (ej. "sqvi_retiros_fabrica.xlsx", "pedidos_ventas_dt_s02.xlsx").
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';

var LABEL_SLIM             = 'Plan Troncales (SLIM)';
var LABEL_TRONCALES        = 'SQVI Troncales';
var LABEL_PEDIDOS_VENTAS   = 'Pedidos de Ventas (NV)';
var LABEL_ENTREGAS         = 'Entregas';
var LABEL_DOC_TRANSPORTE   = 'Doc Transporte (DT)';

// Carpeta Drive de CARGA MANUAL (fallback mientras el correo SAP no llega).
// https://drive.google.com/drive/folders/1dyTfU6fazfiwW8RFH2gNOJC5QowL4cMl
var DRIVE_FOLDER_MANUAL_ID = ''; // DESACTIVADO 22-sep-2026 (antes '1dyTfU6fazfiwW8RFH2gNOJC5QowL4cMl')

// Centros permitidos para el SLIM (columna F, sin el sufijo "_")
var CENTROS_SLIM = ['1020','1040','1050','1060','1070','1080','1090','1100',
                    '1160','1005','1000','1003','1002','1001','1081'];

// ─── Mapa de fuentes por Job + Step ────────────────────────────────────────
// Cada clave es "JOB_NAME|STEP" -> nombre de fuente en Supabase.
// El Job se extrae del asunto del correo; el Step es el numero tras "Step N".
var FUENTES_MAP = {
  // Job ZJC PLAN TRONCALES -> bloque TRONCALES (label "SQVI Troncales")
  'ZJC PLAN TRONCALES|1': 'sqvi_retiros_fabrica',
  'ZJC PLAN TRONCALES|2': 'sqvi_pedidos_venta_1003',
  'ZJC PLAN TRONCALES|3': 'sqvi_stock_almacen_4000',
  'ZJC PLAN TRONCALES|4': 'sqvi_pedidos_traslados',
  'ZJC PLAN TRONCALES|5': 'sqvi_pedidos_traslados_4000',
  'ZJC PLAN TRONCALES|6': 'sqvi_plan_troncales',
  // Job ZJC PLAN DT -> bloque DOC TRANSPORTE (label "Doc Transporte (DT)")
  'ZJC PLAN DT|1':        'dt_transportes',
  // Job ZJC PLAN ENTREGAS Step 1 -> bloque ENTREGAS (label "Entregas")
  'ZJC PLAN ENTREGAS|1':  'entregas_creadas',
  // Job ZJC PLAN ENTREGAS Steps 2-11 -> bloque PEDIDOS DE VENTAS (label "Pedidos de Ventas (NV)")
  'ZJC PLAN ENTREGAS|2':  'pedidos_ventas_dt_s02',
  'ZJC PLAN ENTREGAS|3':  'pedidos_ventas_dt_s03',
  'ZJC PLAN ENTREGAS|4':  'pedidos_ventas_dt_s04',
  'ZJC PLAN ENTREGAS|5':  'pedidos_ventas_dt_s05',
  'ZJC PLAN ENTREGAS|6':  'pedidos_ventas_dt_s06',
  'ZJC PLAN ENTREGAS|7':  'pedidos_ventas_dt_s07',
  'ZJC PLAN ENTREGAS|8':  'pedidos_ventas_dt_s08',
  'ZJC PLAN ENTREGAS|9':  'pedidos_ventas_dt_s09',
  'ZJC PLAN ENTREGAS|10': 'pedidos_ventas_dt_s10',
  'ZJC PLAN ENTREGAS|11': 'pedidos_ventas_dt_s11'
};

// Fuentes que pertenecen a cada bloque/etiqueta (subconjuntos de FUENTES_MAP).
var FUENTES_TRONCALES = ['sqvi_retiros_fabrica','sqvi_pedidos_venta_1003',
  'sqvi_stock_almacen_4000','sqvi_pedidos_traslados','sqvi_pedidos_traslados_4000',
  'sqvi_plan_troncales'];
var FUENTES_PEDIDOS_VENTAS = ['pedidos_ventas_dt_s02','pedidos_ventas_dt_s03',
  'pedidos_ventas_dt_s04','pedidos_ventas_dt_s05','pedidos_ventas_dt_s06',
  'pedidos_ventas_dt_s07','pedidos_ventas_dt_s08','pedidos_ventas_dt_s09',
  'pedidos_ventas_dt_s10','pedidos_ventas_dt_s11'];
var FUENTES_ENTREGAS = ['entregas_creadas'];
var FUENTES_DOC_TRANSPORTE = ['dt_transportes'];

var CHUNK = 1500; // filas por request de insercion

// --------------------------- ENTRYPOINTS (TRIGGERS) -------------------------
// Cada uno valida dia habil (lunes-viernes) antes de tocar Gmail/Supabase.

// ── TRONCALES (label "SQVI Troncales") ──────────────────────────────────────
function ejecutar_troncales_0755() { correrTroncales(false); }
// Un solo trigger horario (~:35) cubre 09:35, 10:35, 11:35 y 12:35 para no
// exceder el limite de 20 triggers por proyecto (compartido con CorreoPlanCarga.gs).
function ejecutar_troncales_horario() {
  var h = parseInt(Utilities.formatDate(new Date(), 'America/Santiago', 'H'), 10);
  if (h < 9 || h > 12) return;
  correrTroncales(false);
}
function ejecutar_troncales_1335() { correrTroncales(false); }
// Snapshot movido a las 15:30 (23-sep-2026, pedido de Jordan): guarda lo que
// haya en trc_live a esa hora, sin depender de que llegue correo a las 13:35.
function ejecutar_troncales_1530() { correrTroncales(true); }
function ejecutar_troncales_1510() { correrTroncales(false); } // legado, sin trigger
function ejecutar_troncales_1450() { correrTroncales(false); } // legado, sin trigger

function correrTroncales(esSnapshot) {
  if (!esDiaHabil()) return;
  var corrida = etiquetaCorrida();
  procesarGrupoSqvi('TRONCALES', LABEL_TRONCALES, FUENTES_TRONCALES, corrida, esSnapshot);
  if (esSnapshot) {
    // Guarda la foto del dia desde trc_live VIGENTE (no depende de que haya
    // llegado un correo nuevo a esta hora en ningun bloque).
    try {
      var nSnap = sbRpcSnapshotHoy();
      logRun(corrida, 'snapshot_hoy', nSnap, true, 'ok', 'Snapshot desde trc_live');
    } catch (e) {
      logRun(corrida, 'snapshot_hoy', 0, true, 'error', String(e));
    }
    try { sbRpcPrune(); } catch (e) { Logger.log('prune error: ' + e); }
  }
}

// ── PEDIDOS DE VENTAS (label "Pedidos de Ventas (NV)") ──────────────────────
function ejecutar_pedidosventas_0740() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1110() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1310() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1440() { correrPedidosVentas(); }

function correrPedidosVentas() {
  if (!esDiaHabil()) return;
  procesarGrupoSqvi('PEDIDOS_VENTAS', LABEL_PEDIDOS_VENTAS, FUENTES_PEDIDOS_VENTAS, etiquetaCorrida(), false);
}

// ── ENTREGAS (label "Entregas") ──────────────────────────────────────────────
function ejecutar_entregas_0715() { correrEntregas(); }
function ejecutar_entregas_1230() { correrEntregas(); }
function ejecutar_entregas_1500() { correrEntregas(); }

function correrEntregas() {
  if (!esDiaHabil()) return;
  procesarGrupoSqvi('ENTREGAS', LABEL_ENTREGAS, FUENTES_ENTREGAS, etiquetaCorrida(), false);
}

// ── DOC TRANSPORTE (label "Doc Transporte (DT)") ─────────────────────────────
function ejecutar_doctransporte_0810() { correrDocTransporte(); }
function ejecutar_doctransporte_1630() { correrDocTransporte(); }
function ejecutar_doctransporte_2230() { correrDocTransporte(); }

function correrDocTransporte() {
  if (!esDiaHabil()) return;
  procesarGrupoSqvi('DOC_TRANSPORTE', LABEL_DOC_TRANSPORTE, FUENTES_DOC_TRANSPORTE, etiquetaCorrida(), false);
}

// ── BARRIDO DE REZAGADOS (22-sep-2026, pedido de Jordan) ─────────────────────
// SAP no envia a hora fija (ej. 22-sep: 10:46, 11:07, 11:31, 12:20, 13:12,
// 13:32, 14:31, 14:46, 15:03). Cada 30 min, de 09:00 a 15:00 (lun-vie),
// revisa TODAS las lecturas y procesa solo los bloques que tengan correos
// no leidos. No reemplaza a los triggers fijos; cada bloque sigue leyendo
// solo su etiqueta. Sin snapshot. Si una rafaga SAP aun esta llegando, ese
// bloque se deja para el proximo barrido.
function ejecutar_barrido_rezagados() {
  if (!esDiaHabil()) return;
  var hm = Utilities.formatDate(new Date(), 'America/Santiago', 'H:mm').split(':');
  var min = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
  if (min < 8 * 60 + 15 || min > 15 * 60 + 20 + 10) return; // 08:15 - 15:20 (+10 min de tolerancia del trigger)
  var bloques = [
    ['TRONCALES', LABEL_TRONCALES, FUENTES_TRONCALES],
    ['PEDIDOS_VENTAS', LABEL_PEDIDOS_VENTAS, FUENTES_PEDIDOS_VENTAS],
    ['ENTREGAS', LABEL_ENTREGAS, FUENTES_ENTREGAS],
    ['DOC_TRANSPORTE', LABEL_DOC_TRANSPORTE, FUENTES_DOC_TRANSPORTE]
  ];
  bloques.forEach(function (b) {
    try {
      if (!hayNoLeidosDeGrupo(b[1], b[2])) return;
      procesarGrupoSqvi(b[0], b[1], b[2], etiquetaCorrida(), false, true);
    } catch (e) { Logger.log('barrido ' + b[0] + ': ' + e); }
  });
  // SLIM: solo si hay un correo SLIM no leido de HOY (no recarga fotos antiguas)
  try {
    var lbl = GmailApp.getUserLabelByName(LABEL_SLIM);
    if (lbl && lbl.getUnreadCount() > 0) {
      var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
      var msg = mensajeNoLeidoMasReciente(lbl, function (m) {
        return tieneAdjunto(m, /\.xlsx$/i) &&
          Utilities.formatDate(m.getDate(), 'America/Santiago', 'yyyy-MM-dd') === hoy;
      });
      if (msg) {
        var corrida = etiquetaCorrida();
        try { procesarSlim(corrida, false); }
        catch (e) { logRun(corrida, 'slim_stock', 0, false, 'error', String(e)); }
      }
    }
  } catch (e) { Logger.log('barrido SLIM: ' + e); }
}

function hayNoLeidosDeGrupo(labelName, fuentesGrupo) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label || label.getUnreadCount() === 0) return false;
  var threads = label.getThreads(0, 50);
  for (var t = 0; t < threads.length; t++) {
    if (!threads[t].isUnread()) continue;
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      if (!msgs[m].isUnread()) continue;
      var p = parseAsunto(msgs[m].getSubject());
      if (p && p.fuente && fuentesGrupo.indexOf(p.fuente) !== -1) return true;
    }
  }
  return false;
}

// ── SLIM (label "Plan Troncales (SLIM)") ─────────────────────────────────────
function ejecutar_slim_0630() { correrSlim(); }

function correrSlim() {
  if (!esDiaHabil()) return;
  var corrida = etiquetaCorrida();
  try { procesarSlim(corrida, false); }
  catch (e) { logRun(corrida, 'slim_stock', 0, false, 'error', String(e)); }
}

// -------------------- CREACION DE TRIGGERS (ejecutar 1 sola vez) ------------
// IMPORTANTE: reejecutar esta funcion tras cambiar horarios. Elimina los
// triggers antiguos (version anterior de este script) y los de este mismo
// script para no duplicar, y crea los nuevos (15 triggers; +3 de CorreoPlanCarga.gs = 18 de 20).
function crearTriggers() {
  var viejos = ['ejecutar_0730', 'ejecutar_1130', 'ejecutar_tarde', 'ejecutar_1430',
    'ejecutar_pedidosventas_1435', 'ejecutar_troncales_0735', 'ejecutar_pedidosventas_0710', 'ejecutar_0735', 'ejecutar_1135', 'ejecutar_1335', 'ejecutar_1340', 'ejecutar_1350', 'ejecutar_troncales_1510'];
  var nuevos = [
    'ejecutar_troncales_0755', 'ejecutar_troncales_horario',
    'ejecutar_troncales_0935', 'ejecutar_troncales_1035', 'ejecutar_troncales_1135', 'ejecutar_troncales_1235',
    'ejecutar_troncales_1335', 'ejecutar_troncales_1450', 'ejecutar_troncales_1530',
    'ejecutar_pedidosventas_0740', 'ejecutar_pedidosventas_1110', 'ejecutar_pedidosventas_1310', 'ejecutar_pedidosventas_1440',
    'ejecutar_entregas_0715', 'ejecutar_entregas_1230', 'ejecutar_entregas_1500',
    'ejecutar_doctransporte_0810', 'ejecutar_doctransporte_1630', 'ejecutar_doctransporte_2230',
    'ejecutar_slim_0630', 'ejecutar_barrido_rezagados'
  ];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (viejos.indexOf(h) !== -1 || nuevos.indexOf(h) !== -1) ScriptApp.deleteTrigger(t);
  });

  function crear(fn, hora, minuto) {
    ScriptApp.newTrigger(fn).timeBased().atHour(hora).nearMinute(minuto).everyDays(1).create();
  }

  // TRONCALES
  crear('ejecutar_troncales_0755', 7, 55);
  ScriptApp.newTrigger('ejecutar_troncales_horario').timeBased().everyHours(1).nearMinute(35).create(); // 09:35-12:35
  crear('ejecutar_troncales_1335', 13, 35);
  crear('ejecutar_troncales_1530', 15, 30); // snapshot: guarda lo que haya en trc_live a esa hora
  // PEDIDOS DE VENTAS
  crear('ejecutar_pedidosventas_0740', 7, 40);
  crear('ejecutar_pedidosventas_1110', 11, 10);
  crear('ejecutar_pedidosventas_1310', 13, 10);
  crear('ejecutar_pedidosventas_1440', 14, 40);
  // ENTREGAS
  crear('ejecutar_entregas_0715', 7, 15);
  crear('ejecutar_entregas_1230', 12, 30);
  crear('ejecutar_entregas_1500', 15, 0);
  // DOC TRANSPORTE
  crear('ejecutar_doctransporte_0810', 8, 10);
  crear('ejecutar_doctransporte_1630', 16, 30);
  crear('ejecutar_doctransporte_2230', 22, 30);
  // SLIM
  crear('ejecutar_slim_0630', 6, 30);
  // BARRIDO DE REZAGADOS (cada 15 min; solo actua de 08:15 a 15:20 lun-vie)
  ScriptApp.newTrigger('ejecutar_barrido_rezagados').timeBased().everyMinutes(15).create();

  Logger.log('16 triggers creados (America/Santiago). Cada uno valida esDiaHabil() ' +
    'antes de correr, por lo que en sabado/domingo no hacen nada.');
}

// ----------------------------- DIA HABIL -------------------------------------
// true de lunes a viernes (hora Chile), false sabado/domingo.
function esDiaHabil() {
  var dia = Utilities.formatDate(new Date(), 'America/Santiago', 'EEEE');
  return ['Saturday', 'Sunday'].indexOf(dia) === -1;
}

// ----------------------------- SLIM -----------------------------------------
function procesarSlim(corrida, esSnapshot) {
  var label = GmailApp.getUserLabelByName(LABEL_SLIM);
  if (!label) { logRun(corrida, 'slim_stock', 0, esSnapshot, 'error', 'No existe etiqueta ' + LABEL_SLIM); return; }

  // Mensaje NO leido mas reciente con adjunto .xlsx
  var msg = mensajeNoLeidoMasReciente(label, function (m) {
    return tieneAdjunto(m, /\.xlsx$/i);
  });
  if (!msg) { logRun(corrida, 'slim_stock', 0, esSnapshot, 'sin_correo', 'Sin correos SLIM no leidos'); return; }

  var att = adjunto(msg, /\.xlsx$/i);
  var filas = leerExcelSlim(att, corrida);

  reemplazarLive('slim_stock', filas);

  msg.markRead();
  logRun(corrida, 'slim_stock', filas.length, esSnapshot, 'ok', att.getName());
}

// Convierte el xlsx a Google Sheet (Drive API avanzada), lee columnas y filtra.
function leerExcelSlim(attachment, corrida) {
  var centros = {};
  CENTROS_SLIM.forEach(function (c) { centros[c] = true; });

  var tmp = Drive.Files.insert(
    { title: 'tmp_slim_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' },
    attachment.copyBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  );
  var filas = [];
  try {
    var msW = 0; var sh = null;
    while (msW < 120000) {
      try {
        if (Drive.Files.get(tmp.id).mimeType === 'application/vnd.google-apps.spreadsheet') {
          sh = SpreadsheetApp.openById(tmp.id).getSheets()[0]; break;
        }
      } catch (e3) {}
      Utilities.sleep(3000); msW += 3000;
    }
    if (!sh) throw new Error('Conversion del Excel no lista');
    var last = sh.getLastRow();
    if (last < 2) return filas;
    var n = last - 1;
    var B = sh.getRange(2, 2,  n, 1).getValues();
    var F = sh.getRange(2, 6,  n, 1).getValues();
    var G = sh.getRange(2, 7,  n, 1).getValues();
    var H = sh.getRange(2, 8,  n, 1).getValues();
    var K = sh.getRange(2, 11, n, 1).getValues();
    var U = sh.getRange(2, 21, n, 1).getValues();

    var idx = 0;
    for (var i = 0; i < n; i++) {
      var b = B[i][0];
      if (Number(b) !== 0) continue;
      var centroRaw = F[i][0] == null ? '' : String(F[i][0]);
      var centro = centroRaw.replace(/_/g, '').trim();
      if (!centros[centro]) continue;
      idx++;
      filas.push({
        fuente: 'slim_stock', fila: idx, corrida: corrida,
        data: {
          articulo_stock: '0',
          centro: centro,
          codigo_articulo: txt(G[i][0]),
          descripcion: txt(H[i][0]),
          stock_days: txt(K[i][0]),
          clase_abc: txt(U[i][0])
        }
      });
    }
  } finally {
    try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
  }
  return filas;
}

// ----------------------------- SQVI (generico por bloque/etiqueta) ----------
// Procesa TODOS los correos NO leidos de UNA etiqueta que correspondan a las
// fuentes indicadas (fuentesGrupo). Detecta el Job y Step del asunto para
// mapear a la fuente correcta (via FUENTES_MAP/parseAsunto) y descarta
// cualquier correo cuya fuente no pertenezca a este grupo (por si la
// etiqueta llegara a mezclar asuntos de otro bloque).
//
// Si una fuente del grupo NO tiene correo SAP no leido, se intenta como
// FALLBACK la carpeta Drive de carga manual (ver procesarFuenteDriveManual).
// El correo SAP siempre tiene prioridad: si llega, la carga manual no se usa.
function procesarGrupoSqvi(nombreGrupo, labelName, fuentesGrupo, corrida, esSnapshot, esBarrido) {
  var label = GmailApp.getUserLabelByName(labelName);
  var faltantes = fuentesGrupo.slice(); // si no hay etiqueta, se intenta igual la carga manual

  if (!label) {
    Logger.log('Aviso: no existe etiqueta ' + labelName + ' (se intenta solo carga manual)');
  } else {
    var fuentesSet = {};
    fuentesGrupo.forEach(function (f) { fuentesSet[f] = true; });

    // Recolecta, por cada fuente del grupo, el mensaje NO leido mas reciente
    var porFuente = {};   // fuente -> {msg, att, date}
    var aMarcar = [];
    // FIX 22-sep-2026: SAP envia los Steps en rafaga (~10-30 s) y Gmail aplica
    // el filtro/etiqueta con retraso a los adjuntos grandes. Si el trigger cae
    // en medio de la rafaga, lee solo parte de los Steps y el resto queda sin
    // leer hasta el dia siguiente. Se espera a que la etiqueta este "quieta".
    if (esBarrido) {
      // barrido: si la rafaga SAP aun esta llegando, se deja para el proximo barrido
      if (edadUltimoCorreo(label) < QUIETUD_MS) { Logger.log(nombreGrupo + ': rafaga en curso, se omite'); return; }
    } else {
      esperarLoteCompleto(label);
    }
    var threads = label.getThreads(0, 100);
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        if (!msg.isUnread()) continue;
        var parsed = parseAsunto(msg.getSubject());
        if (!parsed || !parsed.fuente) continue;
        if (!fuentesSet[parsed.fuente]) continue; // no pertenece a este bloque
        var att = adjunto(msg, /\.htm(l)?$/i);
        if (!att) continue;
        aMarcar.push(msg);
        var d = msg.getDate().getTime();
        if (!porFuente[parsed.fuente] || d > porFuente[parsed.fuente].date) {
          porFuente[parsed.fuente] = { msg: msg, att: att, date: d };
        }
      }
    }

    // Procesa cada fuente del grupo que SI tenga correo SAP
    faltantes = [];
    fuentesGrupo.forEach(function (fuente) {
      var entry = porFuente[fuente];
      if (!entry) { faltantes.push(fuente); return; } // se intenta por Drive abajo
      try {
        var filas = parseSqviHtml(entry.att.getDataAsString('UTF-8'), fuente, corrida);
        reemplazarLive(fuente, filas);
        logRun(corrida, fuente, filas.length, esSnapshot, 'ok', entry.att.getName());
      } catch (e) {
        logRun(corrida, fuente, 0, esSnapshot, 'error', String(e));
      }
    });

    // Marca leidos solo los correos de este grupo que se procesaron
    aMarcar.forEach(function (msg) { try { msg.markRead(); } catch (e) {} });
  }

  // Fallback: carpeta Drive de carga manual, solo para fuentes sin correo SAP
  // DESACTIVADO 22-sep-2026 (pedido de Jordan): se vuelve a la lectura
  // original, solo correo SAP. Ya no se lee la carpeta Drive de carga manual.
  if (esBarrido) return; // el barrido no registra sin_correo (evita ruido en trc_log)
  faltantes.forEach(function (fuente) {
    logRun(corrida, fuente, 0, esSnapshot, 'sin_correo', 'Sin correo para ' + fuente);
  });
}

// Espera (max ESPERA_MAX_MS) hasta que el ultimo correo de la etiqueta tenga
// al menos QUIETUD_MS de antiguedad, para no cortar una rafaga de Steps SAP.
var QUIETUD_MS = 3 * 60 * 1000;
var ESPERA_MAX_MS = 4 * 60 * 1000;
function edadUltimoCorreo(label) {
  var ultimo = 0;
  var ths = label.getThreads(0, 20);
  for (var i = 0; i < ths.length; i++) {
    var d = ths[i].getLastMessageDate().getTime();
    if (d > ultimo) ultimo = d;
  }
  return Date.now() - ultimo;
}
function esperarLoteCompleto(label) {
  var inicio = Date.now();
  while (Date.now() - inicio < ESPERA_MAX_MS) {
    var edad = edadUltimoCorreo(label);
    if (edad >= QUIETUD_MS) return;
    Utilities.sleep(Math.min(QUIETUD_MS - edad + 5000, ESPERA_MAX_MS - (Date.now() - inicio)));
  }
}

// Extrae Job y Step del asunto del correo.
// Soporta formatos:
//   "Job ZJC PLAN TRONCALES, Step 3"
//   "Job ZJC PLAN DT, Step 1"
//   "Job ZJC PLAN ENTREGAS, Step 2"
// Retorna { job, step, fuente } o null si no coincide.
function parseAsunto(asunto) {
  if (!asunto) return null;
  var m = /Job\s+(ZJC\s+PLAN\s+\S+(?:\s+\S+)?),\s*Step\s+(\d+)/i.exec(asunto);
  if (!m) return null;
  var job = m[1].toUpperCase().replace(/\s+/g, ' ').trim();
  var step = m[2];
  var key = job + '|' + step;
  var fuente = FUENTES_MAP[key] || null;
  return { job: job, step: step, fuente: fuente };
}

// Parser de los HTML export de SAP (tablas repetidas, headers y totales).
function parseSqviHtml(html, fuente, corrida) {
  var rows = extraerFilasHtml(html);          // array de array de celdas
  return filasDesdeTabla(rows, fuente, corrida);
}

// Extrae filas/celdas de todas las <table> del HTML mediante regex.
function extraerFilasHtml(html) {
  var out = [];
  var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  var trM;
  while ((trM = trRe.exec(html)) !== null) {
    var celdas = [];
    var tdM;
    tdRe.lastIndex = 0;
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      celdas.push(limpiarCelda(tdM[1]));
    }
    if (celdas.length) out.push(celdas);
  }
  return out;
}

function limpiarCelda(s) {
  s = s.replace(/<[^>]+>/g, '');           // quita tags internos
  s = decodeEntities(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
}

// Construye las filas {fuente, fila, corrida, data} a partir de una tabla ya
// convertida a array-de-arrays (viene del HTML de SAP o del Excel manual).
// Usa la primera fila como encabezado, descarta encabezados repetidos y filas
// de totales/subtotales SAP (fila que empieza con "*" o casi vacia).
// DEBE producir las mismas claves que las vistas de Supabase (via normalizarKeys).
function filasDesdeTabla(rows, fuente, corrida) {
  rows = rows.filter(function (r) {
    return r.some(function (x) { return x !== ''; });
  });
  if (rows.length === 0) return [];
  var header = rows[0];
  var keys = normalizarKeys(header);
  var headerJoin = header.join('|');

  var filas = [];
  var idx = 0;
  for (var r = 1; r < rows.length; r++) {
    var c = rows[r];
    if (c.join('|') === headerJoin) continue;            // header repetido
    var noVacias = c.filter(function (x) { return x !== ''; }).length;
    if (c[0] === '*' || (c[0] === '' && noVacias <= 3)) continue; // totales/subtotales
    var obj = {};
    for (var k = 0; k < keys.length; k++) obj[keys[k]] = (c[k] == null ? '' : c[k]);
    idx++;
    filas.push({ fuente: fuente, fila: idx, corrida: corrida, data: obj });
  }
  return filas;
}

// Normaliza headers a keys snake_case y desambigua duplicados (_2, _3...).
function normalizarKeys(header) {
  var seen = {};
  var out = [];
  for (var i = 0; i < header.length; i++) {
    var k = slug(header[i]);
    if (seen[k]) { seen[k] += 1; k = k + '_' + seen[k]; }
    else { seen[k] = 1; }
    out.push(k);
  }
  return out;
}

function slug(h) {
  if (h == null) h = '';
  h = h.normalize ? h.normalize('NFKD').replace(/[̀-ͯ]/g, '') : h;
  h = h.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return h || 'col';
}

// ----------------------------- CARGA MANUAL (Drive, fallback) ---------------
// Se usa SOLO cuando una fuente de TRONCALES o PEDIDOS_VENTAS no tuvo correo
// SAP no leido. Busca en DRIVE_FOLDER_MANUAL_ID un archivo "<fuente>.xlsx"
// (Jordan lo sube/reemplaza manualmente tras exportarlo desde SAP GUI).
// Para no recargar lo mismo en cada corrida, guarda en Script Properties la
// fecha de modificacion del archivo ya procesado y solo vuelve a cargar si
// cambio (forzar=true ignora este control, usado por las pruebas manuales).
function procesarFuenteDriveManual(fuente, corrida, esSnapshot, forzar) {
  if (!DRIVE_FOLDER_MANUAL_ID) {
    logRun(corrida, fuente, 0, esSnapshot, 'sin_correo', 'Sin correo SAP (carpeta manual no configurada)');
    return;
  }
  var file = archivoManual(fuente);
  if (!file) {
    logRun(corrida, fuente, 0, esSnapshot, 'sin_correo', 'Sin correo SAP ni archivo manual (' + fuente + '.xlsx) en Drive');
    return;
  }

  var props = PropertiesService.getScriptProperties();
  var key = 'manual_ts_' + fuente;
  var tsArchivo = file.getLastUpdated().getTime();
  var tsProcesado = parseInt(props.getProperty(key) || '0', 10);
  if (!forzar && tsArchivo <= tsProcesado) {
    logRun(corrida, fuente, 0, esSnapshot, 'sin_cambio_manual', 'Archivo manual sin cambios desde la ultima carga');
    return;
  }

  try {
    var filas = leerExcelManual(file, fuente, corrida);
    reemplazarLive(fuente, filas);
    props.setProperty(key, String(tsArchivo));
    logRun(corrida, fuente, filas.length, esSnapshot, 'ok_manual', file.getName());
  } catch (e) {
    logRun(corrida, fuente, 0, esSnapshot, 'error', 'Carga manual: ' + String(e));
  }
}

function archivoManual(fuente) {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_MANUAL_ID);
  var it = folder.getFilesByName(fuente + '.xlsx');
  return it.hasNext() ? it.next() : null;
}

// Convierte el Excel manual a Google Sheet (misma tecnica que leerExcelSlim),
// lee TODAS las columnas/filas y las procesa igual que el HTM de SAP
// (encabezado en fila 1, normalizarKeys, descarta totales/repetidos).
function leerExcelManual(file, fuente, corrida) {
  var tmp = Drive.Files.insert(
    { title: 'tmp_manual_' + fuente + '_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' },
    file.getBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  );
  var rows = [];
  try {
    var msW = 0; var sh = null;
    while (msW < 120000) {
      try {
        if (Drive.Files.get(tmp.id).mimeType === 'application/vnd.google-apps.spreadsheet') {
          sh = SpreadsheetApp.openById(tmp.id).getSheets()[0]; break;
        }
      } catch (e3) {}
      Utilities.sleep(3000); msW += 3000;
    }
    if (!sh) throw new Error('Conversion del Excel manual no lista');
    var last = sh.getLastRow(); var lastCol = sh.getLastColumn();
    if (last < 1 || lastCol < 1) return [];
    var values = sh.getRange(1, 1, last, lastCol).getValues();
    values.forEach(function (r) {
      rows.push(r.map(function (v) { return txt(v); }));
    });
  } finally {
    try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
  }
  return filasDesdeTabla(rows, fuente, corrida);
}

// ---------------------- HELPERS GMAIL ---------------------------------------
function tieneAdjunto(msg, regex) { return !!adjunto(msg, regex); }

function adjunto(msg, regex) {
  var as = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  for (var i = 0; i < as.length; i++) {
    if (regex.test(as[i].getName())) return as[i];
  }
  return null;
}

// Devuelve el mensaje NO leido mas reciente de una etiqueta que cumpla filtro.
function mensajeNoLeidoMasReciente(label, filtro) {
  var best = null, bestD = -1;
  var threads = label.getThreads(0, 100);
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      if (!msg.isUnread()) continue;
      if (filtro && !filtro(msg)) continue;
      var d = msg.getDate().getTime();
      if (d > bestD) { bestD = d; best = msg; }
    }
  }
  return best;
}

// ---------------------- HELPERS SUPABASE ------------------------------------
function serviceKey() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta la propiedad de script SUPABASE_SERVICE_KEY');
  return k;
}

function sbHeaders() {
  var k = serviceKey();
  return { 'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' };
}

// Pisa la base vigente de una fuente: borra y reinserta.
function reemplazarLive(fuente, filas) {
  sbDelete('trc_live', 'fuente=eq.' + encodeURIComponent(fuente));
  insertarEnLotes('trc_live', filas);
}

function insertarEnLotes(tabla, filas) {
  for (var i = 0; i < filas.length; i += CHUNK) {
    var lote = filas.slice(i, i + CHUNK);
    var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + tabla, {
      method: 'post',
      contentType: 'application/json',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
      payload: JSON.stringify(lote),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 300) throw new Error('INSERT ' + tabla + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  }
}

function sbDelete(tabla, filtro) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + tabla + '?' + filtro, {
    method: 'delete',
    headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('DELETE ' + tabla + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
}

// Copia trc_live -> trc_hist (foto del dia, hora Chile). Reemplaza la de hoy.
function sbRpcSnapshotHoy() {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/fn_trc_snapshot_hoy', {
    method: 'post', contentType: 'application/json',
    headers: sbHeaders(), payload: '{}', muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('snapshot HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  var n = parseInt(res.getContentText(), 10);
  return isNaN(n) ? 0 : n;
}

function sbRpcPrune() {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/fn_trc_prune_hist', {
    method: 'post', contentType: 'application/json',
    headers: sbHeaders(), payload: '{}', muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) Logger.log('prune HTTP ' + res.getResponseCode() + ': ' + res.getContentText());
}

function logRun(corrida, fuente, filas, snapshot, estado, mensaje) {
  Logger.log('[%s] %s filas=%s estado=%s %s', corrida, fuente, filas, estado, mensaje || '');
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/trc_log', {
      method: 'post', contentType: 'application/json',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
      payload: JSON.stringify([{ corrida: corrida, fuente: fuente, filas: filas,
        snapshot: !!snapshot, estado: estado, mensaje: (mensaje || '').slice(0, 500) }]),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

// ---------------------- UTILS -----------------------------------------------
function etiquetaCorrida() {
  return Utilities.formatDate(new Date(), 'America/Santiago', "yyyy-MM-dd'T'HH:mm");
}
function txt(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'dd.MM.yyyy');
  // BUG FIX 2026-09-22: al convertir el Excel manual a Google Sheet, las celdas
  // numericas (peso, cantidad, etc.) llegan como NUMBER de JS, no como el texto
  // SAP original. String(8.6) = "8.6" (punto decimal). La plataforma (parseNum
  // en abastecimiento.js) espera el formato SAP/Chile: PUNTO = separador de
  // miles (lo borra), COMA = decimal. Si dejamos "8.6" tal cual, parseNum lo
  // interpreta como miles y lo convierte en 86 (10x inflado) -> toneladas mal
  // calculadas en Plan de Carga (bucket 5/6, Traslados 1003/4000, etc.).
  // Fix: para numbers, reemplazar el punto decimal de JS por coma ANTES de
  // convertir a texto, para que quede en formato chileno como si viniera del
  // HTM de correo. Los enteros (sin punto) no se ven afectados.
  if (typeof v === 'number') return String(v).replace('.', ',');
  return String(v).trim();
}

// ---------------------- PRUEBAS MANUALES ------------------------------------
// Estas SI ignoran esDiaHabil() a proposito, para poder probar cualquier dia.
function probar_ahora_troncales()          { correrTroncalesManual(false); }
function probar_ahora_troncales_snapshot() { correrTroncalesManual(true); }
function correrTroncalesManual(esSnapshot) {
  var corrida = etiquetaCorrida();
  procesarGrupoSqvi('TRONCALES', LABEL_TRONCALES, FUENTES_TRONCALES, corrida, esSnapshot);
  if (esSnapshot) {
    try { var n = sbRpcSnapshotHoy(); logRun(corrida, 'snapshot_hoy', n, true, 'ok', 'Snapshot desde trc_live'); }
    catch (e) { logRun(corrida, 'snapshot_hoy', 0, true, 'error', String(e)); }
    try { sbRpcPrune(); } catch (e) { Logger.log('prune error: ' + e); }
  }
}
function probar_ahora_pedidosventas() { procesarGrupoSqvi('PEDIDOS_VENTAS', LABEL_PEDIDOS_VENTAS, FUENTES_PEDIDOS_VENTAS, etiquetaCorrida(), false); }
function probar_ahora_entregas()      { procesarGrupoSqvi('ENTREGAS', LABEL_ENTREGAS, FUENTES_ENTREGAS, etiquetaCorrida(), false); }
function probar_ahora_doctransporte() { procesarGrupoSqvi('DOC_TRANSPORTE', LABEL_DOC_TRANSPORTE, FUENTES_DOC_TRANSPORTE, etiquetaCorrida(), false); }
function probar_ahora_slim() {
  var corrida = etiquetaCorrida();
  try { procesarSlim(corrida, false); } catch (e) { logRun(corrida, 'slim_stock', 0, false, 'error', String(e)); }
}
// Compatibilidad con el nombre de prueba anterior (equivale a troncales).
function probar_ahora()          { probar_ahora_troncales(); }
function probar_ahora_snapshot() { probar_ahora_troncales_snapshot(); }

// Prueba SOLO la carga manual (Drive) de cada bloque, ignorando el control de
// "sin cambios" (forzar=true), asi puedes probar aunque ya la hayas cargado
// antes. Util para validar un archivo recien subido a la carpeta Drive.
function probar_ahora_manual_troncales() {
  var corrida = etiquetaCorrida();
  FUENTES_TRONCALES.forEach(function (f) { procesarFuenteDriveManual(f, corrida, false, true); });
}
function probar_ahora_manual_pedidosventas() {
  var corrida = etiquetaCorrida();
  FUENTES_PEDIDOS_VENTAS.forEach(function (f) { procesarFuenteDriveManual(f, corrida, false, true); });
}
