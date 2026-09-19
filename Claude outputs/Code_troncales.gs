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
 *  Bloques y horarios (hora Chile, lunes a viernes):
 *   - TRONCALES        (label "SQVI Troncales", Job ZJC PLAN TRONCALES Steps 1-6)
 *       07:35, 09:35, 10:35, 11:35, 12:35, 13:35, 14:50
 *       (la corrida de las 13:35 ademas guarda snapshot diario, historico 7 dias)
 *   - PEDIDOS DE VENTAS (label "Pedidos de Ventas (NV)", Job ZJC PLAN ENTREGAS Steps 2-11)
 *       07:10, 11:10, 13:10, 14:35
 *   - ENTREGAS          (label "Entregas", Job ZJC PLAN ENTREGAS Step 1)
 *       07:15, 12:30, 15:00
 *   - DOC TRANSPORTE    (label "Doc Transporte (DT)", Job ZJC PLAN DT Step 1)
 *       08:10, 16:30, 22:30
 *   - SLIM              (label "Plan Troncales (SLIM)", adjunto Excel)
 *       06:30 (unica corrida del dia)
 *
 *  Requisitos (ver README_DESPLIEGUE.md):
 *   1) Zona horaria del proyecto = America/Santiago
 *   2) Servicio avanzado "Drive API" habilitado (para convertir el Excel del SLIM)
 *   3) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 *   4) Las etiquetas Gmail y sus filtros YA EXISTEN (creadas previamente):
 *      "SQVI Troncales", "Plan Troncales (SLIM)", "Pedidos de Ventas (NV)",
 *      "Entregas", "Doc Transporte (DT)". No es necesario crearlas de nuevo.
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';

var LABEL_SLIM             = 'Plan Troncales (SLIM)';
var LABEL_TRONCALES        = 'SQVI Troncales';
var LABEL_PEDIDOS_VENTAS   = 'Pedidos de Ventas (NV)';
var LABEL_ENTREGAS         = 'Entregas';
var LABEL_DOC_TRANSPORTE   = 'Doc Transporte (DT)';

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
function ejecutar_troncales_0735() { correrTroncales(false); }
function ejecutar_troncales_0935() { correrTroncales(false); }
function ejecutar_troncales_1035() { correrTroncales(false); }
function ejecutar_troncales_1135() { correrTroncales(false); }
function ejecutar_troncales_1235() { correrTroncales(false); }
function ejecutar_troncales_1335() { correrTroncales(true); }  // guarda snapshot del dia
function ejecutar_troncales_1450() { correrTroncales(false); }

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
function ejecutar_pedidosventas_0710() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1110() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1310() { correrPedidosVentas(); }
function ejecutar_pedidosventas_1435() { correrPedidosVentas(); }

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
// script para no duplicar, y crea los 18 nuevos.
function crearTriggers() {
  var viejos = ['ejecutar_0730', 'ejecutar_1130', 'ejecutar_tarde', 'ejecutar_1430',
    'ejecutar_0735', 'ejecutar_1135', 'ejecutar_1335', 'ejecutar_1340', 'ejecutar_1350'];
  var nuevos = [
    'ejecutar_troncales_0735', 'ejecutar_troncales_0935', 'ejecutar_troncales_1035',
    'ejecutar_troncales_1135', 'ejecutar_troncales_1235', 'ejecutar_troncales_1335', 'ejecutar_troncales_1450',
    'ejecutar_pedidosventas_0710', 'ejecutar_pedidosventas_1110', 'ejecutar_pedidosventas_1310', 'ejecutar_pedidosventas_1435',
    'ejecutar_entregas_0715', 'ejecutar_entregas_1230', 'ejecutar_entregas_1500',
    'ejecutar_doctransporte_0810', 'ejecutar_doctransporte_1630', 'ejecutar_doctransporte_2230',
    'ejecutar_slim_0630'
  ];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (viejos.indexOf(h) !== -1 || nuevos.indexOf(h) !== -1) ScriptApp.deleteTrigger(t);
  });

  function crear(fn, hora, minuto) {
    ScriptApp.newTrigger(fn).timeBased().atHour(hora).nearMinute(minuto).everyDays(1).create();
  }

  // TRONCALES
  crear('ejecutar_troncales_0735', 7, 35);
  crear('ejecutar_troncales_0935', 9, 35);
  crear('ejecutar_troncales_1035', 10, 35);
  crear('ejecutar_troncales_1135', 11, 35);
  crear('ejecutar_troncales_1235', 12, 35);
  crear('ejecutar_troncales_1335', 13, 35);
  crear('ejecutar_troncales_1450', 14, 50);
  // PEDIDOS DE VENTAS
  crear('ejecutar_pedidosventas_0710', 7, 10);
  crear('ejecutar_pedidosventas_1110', 11, 10);
  crear('ejecutar_pedidosventas_1310', 13, 10);
  crear('ejecutar_pedidosventas_1435', 14, 35);
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

  Logger.log('18 triggers creados (America/Santiago). Cada uno valida esDiaHabil() ' +
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
function procesarGrupoSqvi(nombreGrupo, labelName, fuentesGrupo, corrida, esSnapshot) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    fuentesGrupo.forEach(function (f) { logRun(corrida, f, 0, esSnapshot, 'error', 'No existe etiqueta ' + labelName); });
    return;
  }

  var fuentesSet = {};
  fuentesGrupo.forEach(function (f) { fuentesSet[f] = true; });

  // Recolecta, por cada fuente del grupo, el mensaje NO leido mas reciente
  var porFuente = {};   // fuente -> {msg, att, date}
  var aMarcar = [];
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

  // Procesa cada fuente del grupo
  fuentesGrupo.forEach(function (fuente) {
    var entry = porFuente[fuente];
    if (!entry) { logRun(corrida, fuente, 0, esSnapshot, 'sin_correo', 'Sin correo para ' + fuente); return; }
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

// Normaliza headers a keys snake_case y desambigua duplicados (_2, _3...).
// DEBE producir las mismas claves que las vistas de Supabase.
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
