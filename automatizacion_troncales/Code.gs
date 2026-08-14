/**
 * ============================================================================
 *  AUTOMATIZACION CORREOS TRONCALES  ->  SUPABASE (SIT EBEMA)
 * ----------------------------------------------------------------------------
 *  Lee Gmail 3 veces al dia (07:35 / 11:35 / 13:35, hora Chile), procesa SOLO
 *  correos NO leidos de dos etiquetas, extrae y parsea los adjuntos, y carga
 *  los datos a Supabase (pisando la base vigente). La corrida de las 13:35
 *  ademas guarda la foto del dia (historico 7 dias). Marca los correos leidos.
 *
 *  Fuentes:
 *   - "Plan Troncales (SLIM)"  -> adjunto Excel  -> fuente slim_stock
 *       Filtros: columna B (Articulo Stock) == 0  y  columna F (Almacen) en
 *       la lista de centros. Columnas usadas: B, F, G, H, K, U.
 *   - "SQVI Troncales"         -> adjuntos .htm  -> 5 fuentes (Step 1..5)
 *
 *  Requisitos (ver README_DESPLIEGUE.md):
 *   1) Zona horaria del proyecto = America/Santiago
 *   2) Servicio avanzado "Drive API" habilitado (para convertir el Excel)
 *   3) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';

var LABEL_SLIM = 'Plan Troncales (SLIM)';
var LABEL_SQVI = 'SQVI Troncales';

// Centros permitidos para el SLIM (columna F, sin el sufijo "_")
var CENTROS_SLIM = ['1020','1040','1050','1060','1070','1080','1090','1100',
                    '1160','1005','1000','1003','1002','1001','1081'];

// Mapa Step N -> nombre de fuente (debe coincidir con las vistas en Supabase)
var SQVI_FUENTES = {
  '1': 'sqvi_retiros_fabrica',
  '2': 'sqvi_pedidos_venta_1003',
  '3': 'sqvi_stock_almacen_4000',
  '4': 'sqvi_pedidos_traslados',
  '5': 'sqvi_pedidos_traslados_4000',
  '6': 'sqvi_plan_troncales'
};

var CHUNK = 1500; // filas por request de inserción

// --------------------------- ENTRYPOINTS ------------------------------------
// Estas 3 funciones son las que disparan los triggers horarios.
function ejecutar_0735() { procesar(false); }
function ejecutar_1135() { procesar(false); }
function ejecutar_1335() { procesar(true);  } // guarda snapshot del dia

// Utilidad: crea los 3 triggers de una sola vez (ejecutar manualmente 1 vez).
function crearTriggers() {
  // Elimina triggers previos de estas funciones para no duplicar
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'ejecutar_0735' || f === 'ejecutar_1135' || f === 'ejecutar_1335') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('ejecutar_0735').timeBased().atHour(7).nearMinute(35).everyDays(1).create();
  ScriptApp.newTrigger('ejecutar_1135').timeBased().atHour(11).nearMinute(35).everyDays(1).create();
  ScriptApp.newTrigger('ejecutar_1335').timeBased().atHour(13).nearMinute(35).everyDays(1).create();
  Logger.log('Triggers creados: 07:35, 11:35, 13:35 (America/Santiago).');
}

// ----------------------------- CORE -----------------------------------------
function procesar(esSnapshot) {
  var corrida = etiquetaCorrida();
  Logger.log('== Corrida %s (snapshot=%s) ==', corrida, esSnapshot);
  try { procesarSlim(corrida, esSnapshot); }
  catch (e) { logRun(corrida, 'slim_stock', 0, esSnapshot, 'error', String(e)); }

  try { procesarSqvi(corrida, esSnapshot); }
  catch (e) { logRun(corrida, 'sqvi_*', 0, esSnapshot, 'error', String(e)); }

  if (esSnapshot) {
    try { sbRpcPrune(); } catch (e) { Logger.log('prune error: ' + e); }
  }
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
  if (esSnapshot) guardarHist('slim_stock', filas);

  msg.markRead();
  logRun(corrida, 'slim_stock', filas.length, esSnapshot, 'ok', att.getName());
}

// Convierte el xlsx a Google Sheet (Drive API avanzada), lee columnas y filtra.
function leerExcelSlim(attachment, corrida) {
  var centros = {};
  CENTROS_SLIM.forEach(function (c) { centros[c] = true; });

  // Convierte el xlsx a Google Sheet: tipo destino en el recurso + tipo de
  // origen en el blob. (El parametro 'convert' quedo obsoleto en Drive.)
  var tmp = Drive.Files.insert(
    { title: 'tmp_slim_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' },
    attachment.copyBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  );
  var filas = [];
  try {
    // Espera a que la conversion termine (archivo pasa a ser Google Sheet).
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
    // Columnas: B=2, F=6, G=7, H=8, K=11, U=21
    var B = sh.getRange(2, 2,  n, 1).getValues();
    var F = sh.getRange(2, 6,  n, 1).getValues();
    var G = sh.getRange(2, 7,  n, 1).getValues();
    var H = sh.getRange(2, 8,  n, 1).getValues();
    var K = sh.getRange(2, 11, n, 1).getValues();
    var U = sh.getRange(2, 21, n, 1).getValues();

    var idx = 0;
    for (var i = 0; i < n; i++) {
      var b = B[i][0];
      if (Number(b) !== 0) continue;                    // solo Articulo Stock == 0
      var centroRaw = F[i][0] == null ? '' : String(F[i][0]);
      var centro = centroRaw.replace(/_/g, '').trim();
      if (!centros[centro]) continue;                    // solo centros de la lista
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
    // Elimina la copia temporal
    try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
  }
  return filas;
}

// ----------------------------- SQVI -----------------------------------------
function procesarSqvi(corrida, esSnapshot) {
  var label = GmailApp.getUserLabelByName(LABEL_SQVI);
  if (!label) { logRun(corrida, 'sqvi_*', 0, esSnapshot, 'error', 'No existe etiqueta ' + LABEL_SQVI); return; }

  // Recolecta, por cada Step, el mensaje NO leido mas reciente con adjunto .htm
  var porStep = {};   // step -> {msg, att, date}
  var aMarcar = [];
  var threads = label.getThreads(0, 100);
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      if (!msg.isUnread()) continue;
      var step = stepDeAsunto(msg.getSubject());
      if (!step || !SQVI_FUENTES[step]) continue;
      var att = adjunto(msg, /\.htm(l)?$/i);
      if (!att) continue;
      aMarcar.push(msg);
      var d = msg.getDate().getTime();
      if (!porStep[step] || d > porStep[step].date) porStep[step] = { msg: msg, att: att, date: d };
    }
  }

  Object.keys(SQVI_FUENTES).forEach(function (step) {
    var fuente = SQVI_FUENTES[step];
    var entry = porStep[step];
    if (!entry) { logRun(corrida, fuente, 0, esSnapshot, 'sin_correo', 'Sin correo Step ' + step); return; }
    try {
      var filas = parseSqviHtml(entry.att.getDataAsString('UTF-8'), fuente, corrida);
      reemplazarLive(fuente, filas);
      if (esSnapshot) guardarHist(fuente, filas);
      logRun(corrida, fuente, filas.length, esSnapshot, 'ok', entry.att.getName());
    } catch (e) {
      logRun(corrida, fuente, 0, esSnapshot, 'error', String(e));
    }
  });

  // Marca leidos todos los correos SQVI procesados
  aMarcar.forEach(function (msg) { try { msg.markRead(); } catch (e) {} });
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
  // Quita acentos
  h = h.normalize ? h.normalize('NFKD').replace(/[̀-ͯ]/g, '') : h;
  h = h.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return h || 'col';
}

// ---------------------- HELPERS GMAIL ---------------------------------------
function stepDeAsunto(asunto) {
  var m = /Step\s+(\d+)/i.exec(asunto || '');
  return m ? m[1] : null;
}

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

// Guarda la foto del dia en el historico (borra la de hoy y reinserta).
function guardarHist(fuente, filas) {
  var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
  sbDelete('trc_hist', 'fuente=eq.' + encodeURIComponent(fuente) + '&fecha=eq.' + hoy);
  var conFecha = filas.map(function (f) {
    return { fuente: fuente, fecha: hoy, fila: f.fila, data: f.data };
  });
  insertarEnLotes('trc_hist', conFecha);
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
// Ejecuta una corrida normal (sin snapshot) para probar.
function probar_ahora()          { procesar(false); }
// Ejecuta una corrida con snapshot (como la de las 13:35).
function probar_ahora_snapshot() { procesar(true); }
