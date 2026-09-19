/**
 * ============================================================================
 *  AUTOMATIZACION INDICADORES TRANSPORTE  ->  SUPABASE (SIT EBEMA)
 * ----------------------------------------------------------------------------
 *  Corre de LUNES A VIERNES (hora Chile). Lee 4 fuentes, las parsea y PISA
 *  (overwrite total) las tablas ind_* en Supabase. Sin historico.
 *
 *  REESCRITO 2026-09-18: horario ajustado para terminar ~08:30 (antes 08:00-
 *  08:15) y agregado guard de dia habil (antes corria tambien sabado/domingo).
 *  Se mantiene el escalonamiento interno entre las 4 fuentes (08:15-08:27)
 *  porque "ind_flete_pagado" (~70-78k filas) se corto por timeout de Apps
 *  Script cuando las 4 fuentes se cargaban en una sola ejecucion (incidente
 *  14-sep-2026, ver memoria del proyecto) - correrlas todas exactamente a las
 *  08:30 reintroduciria ese riesgo. El refresh final de las vistas SI queda
 *  a las 08:30 en punto, que es cuando el usuario ve los datos actualizados.
 *  Ademas: el correo de "Detalle Flete Tercero" (label "Indicadores
 *  Transporte") ahora se marca como LEIDO despues de cargarse (antes no se
 *  marcaba y siempre releia el ultimo correo, leido o no).
 *
 *  Fuentes:
 *   - Drive (xlsx, se refrescan solos a diario):
 *       OTIF          -> ind_otif
 *       FLETE 360     -> ind_flete_pagado
 *       FLETE COBRADO -> ind_flete_cobrado
 *   - Gmail (label "Indicadores Transporte", correo "Detale Flete Tercero"
 *            de noreply@ebema.cl, adjunto xlsx):
 *       Detalle Flete Tercero -> ind_flete_tercero
 *
 *  Requisitos (ver README):
 *   1) Zona horaria del proyecto = America/Santiago
 *   2) Servicio avanzado "Drive API" habilitado (convertir xlsx -> Sheet)
 *   3) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';

// Carpeta de Drive donde el usuario reemplaza manualmente los archivos.
// Se resuelven POR NOMBRE (no por id), así no importa que el id cambie
// cuando se borra/sube un archivo nuevo. Se toma el más reciente que coincida.
var FOLDER_ID = '13vcSCCUEHyAKExDheni6fzOBM5JTgO8L';
var DRIVE_NOMBRE = {
  otif:          'OTIF',           // OTIF.xlsx
  flete_pagado:  'FLETE 360',      // FLETE 360.xlsx  (flete pagado)
  flete_cobrado: 'FLETE COBRADO'   // FLETE COBRADO.xlsx
};

// Gmail: label y filtro del correo de Flete Tercero
var LABEL_FT = 'Indicadores Transporte';

var CHUNK = 2500; // filas por request de inserción

// ---- Especificaciones de columnas por fuente -------------------------------
// {col: nombre en Supabase, h: header en el archivo, t: tipo (text|num|date)}
var SPEC_OTIF = [
  {col:'nota_venta',h:'Nota Venta',t:'text'},
  {col:'clase_doc',h:'Clase Documento',t:'text'},   // ZV01/03/04=Stock, ZV08/09=Calzada
  {col:'id_centro',h:'ID Centro',t:'text'},
  {col:'centro_expedicion',h:'Centro Expedición',t:'text'},
  {col:'expedicion',h:'Expedición',t:'text'},
  {col:'fecha_creacion',h:'Fecha Creación',t:'date'},
  {col:'hora_creacion',h:'Hora Creación',t:'text'},
  {col:'vendedor',h:'Vendedor',t:'text'},
  {col:'cod_material',h:'Cód. Material',t:'text'},
  {col:'material',h:'Material',t:'text'},
  {col:'cantidad_pedido',h:'Cantidad Pedido',t:'num'},
  {col:'motivo_rechazo',h:'Motivo Rechazo',t:'text'},
  {col:'fecha_reparto',h:'Fecha Reparto',t:'date'},
  {col:'motivo_no_entrega',h:'Motivo No Entrega',t:'text'},
  {col:'transporte_exclusivo',h:'Transporte Exclusivo',t:'text'},
  {col:'fecha_estimada_entrega',h:'Fecha Estimada Entrega',t:'date'},
  {col:'fecha_guia',h:'Fecha Guía',t:'date'},
  {col:'id_ruta',h:'ID Ruta',t:'text'},
  {col:'ruta',h:'Ruta',t:'text'},
  {col:'spot_planificado',h:'Spot / Planificado',t:'text'},
  {col:'total_entregado',h:'Total Entregado',t:'num'},
  {col:'otif',h:'OTIF',t:'num'},
  {col:'fillrate',h:'FillRate',t:'num'}
];

var SPEC_FLETE_COBRADO = [
  {col:'fecha_transporte',h:'Fecha Transporte',t:'date'},
  {col:'id_oficina',h:'ID Oficina',t:'text'},
  {col:'oficina',h:'Oficina',t:'text'},
  {col:'factura',h:'Factura',t:'text'},
  {col:'entrega',h:'Entrega',t:'text'},
  {col:'oficina_entrega',h:'Oficina Entrega',t:'text'},
  {col:'id_expedicion',h:'ID Expedición',t:'text'},
  {col:'almacen',h:'Almacen',t:'text'},
  {col:'vendedor',h:'Vendedor',t:'text'},
  {col:'tipo_venta',h:'Tipo Venta',t:'text'},
  {col:'cond_expedicion',h:'Cond. Expedición',t:'text'},
  {col:'cod_material',h:'Cód. Material',t:'text'},
  {col:'material',h:'Material',t:'text'},
  {col:'um_base',h:'UM Base',t:'text'},
  {col:'documento_transporte',h:'Documento Transporte',t:'text'},
  {col:'gasto_transporte',h:'Gasto Transporte',t:'text'},
  {col:'oc',h:'OC',t:'text'},
  {col:'hes',h:'HES',t:'text'},
  {col:'transportista',h:'Transportista',t:'text'},
  {col:'cap_camion',h:'Cap. Camión',t:'text'},
  {col:'cod_ruta',h:'Cód. Ruta',t:'text'},
  {col:'ruta',h:'Ruta',t:'text'},
  {col:'peso_kg',h:'Peso (Kg)',t:'num'},
  {col:'cantidad',h:'Cantidad',t:'num'},
  {col:'peso_flete_kg',h:'Peso del Flete (Kg)',t:'num'},
  {col:'flete_sugerido',h:'Flete Sugerido',t:'num'},
  {col:'flete_cobrado',h:'Flete Cobrado',t:'num'},
  {col:'flete_pagado',h:'Flete Pagado',t:'num'},
  {col:'flete_retira',h:'Flete Retira',t:'num'},
  {col:'flete_traslado',h:'Flete Traslado',t:'num'},
  {col:'centro_fus',h:'Centro Fus.',t:'text'}
];

var SPEC_FLETE_PAGADO = [
  {col:'gasto_transporte',h:'Gasto Transporte',t:'text'},
  {col:'fecha_transporte',h:'Fecha Transporte',t:'date'},
  {col:'documento_transporte',h:'Documento Transporte',t:'text'},
  {col:'id_cliente',h:'ID Cliente',t:'text'},
  {col:'id_obra',h:'ID Obra',t:'text'},
  {col:'direccion_obra',h:'Dirección Obra',t:'text'},
  {col:'entrega',h:'Entrega',t:'text'},
  {col:'usuario_entrega',h:'Usuario Entrega',t:'text'},
  {col:'fecha_entrega',h:'Fecha Entrega',t:'date'},
  {col:'id_clase_entrega',h:'ID Clase de Entrega',t:'text'},
  {col:'clase_entrega',h:'Clase Entrega',t:'text'},
  {col:'oficina_entrega',h:'Oficina Entrega',t:'text'},
  {col:'id_expedicion',h:'ID Expedición',t:'text'},
  {col:'almacen',h:'Almacen',t:'text'},
  {col:'oc',h:'OC',t:'text'},
  {col:'hes',h:'HES',t:'text'},
  {col:'cap_camion',h:'Cap. Camión',t:'text'},
  {col:'id_material',h:'ID Material',t:'text'},
  {col:'material',h:'Material',t:'text'},
  {col:'ind_stock_especial',h:'Ind. Stock Especial',t:'text'},
  {col:'oficina_venta',h:'Oficina Venta',t:'text'},
  {col:'centro_destino',h:'Centro Destino',t:'text'},
  {col:'id_transportista',h:'ID Transportista',t:'text'},
  {col:'transportista',h:'Transportista',t:'text'},
  {col:'id_ruta',h:'ID Ruta',t:'text'},
  {col:'ruta',h:'Ruta',t:'text'},
  {col:'chofer',h:'Chofer',t:'text'},
  {col:'patente',h:'Patente',t:'text'},
  {col:'peso_kg',h:'Peso (Kg)',t:'num'},
  {col:'cantidad',h:'Cantidad',t:'num'},
  {col:'ton',h:'Ton',t:'num'},
  {col:'flete',h:'Flete',t:'num'}
];

var SPEC_FLETE_TERCERO = [
  {col:'id_pedido',h:'ID Pedido Flete Tercero',t:'text'},
  {col:'condicion_expedicion',h:'Condicion Expedición',t:'text'},
  {col:'punto_expedicion',h:'Punto Expedicion',t:'text'},
  {col:'ruta_flete',h:'Ruta Flete',t:'text'},
  {col:'fecha_creacion',h:'Fecha Creacion',t:'date'},
  {col:'fecha_disponible_material',h:'Fecha Disponible Material',t:'date'},
  {col:'material',h:'Material',t:'text'},
  {col:'cantidad_bultos',h:'Cantidad Bultos',t:'num'},
  {col:'bultos_recep_cd',h:'Bultos Recepcionados CD',t:'num'},
  {col:'fecha_recep_cd',h:'Fecha Recepcion CD',t:'date'},
  {col:'bultos_trasladados',h:'Bultos Trasladados',t:'num'},
  {col:'fecha_traslado',h:'Fecha Traslado',t:'date'},
  {col:'bultos_recep_sucursal',h:'Bultos Recepcionado Sucursal',t:'num'},
  {col:'fecha_recep_sucursal',h:'Fecha Recepcion Sucursal',t:'date'},
  {col:'bultos_entrega_cliente',h:'Bulto Entrega Cliente',t:'num'},
  {col:'fecha_entrega_cliente',h:'Fecha Entrega Cliente',t:'date'}
];

// --------------------------- ENTRYPOINTS ------------------------------------
// Corrida manual completa (todas las fuentes + refresh, en una sola ejecucion).
// Se deja por si se necesita reprocesar todo a mano; el trigger automatico usa
// los entrypoints escalonados de abajo.
function ejecutar_0800() { if (!esDiaHabil()) return; cargarTodo(); }

function cargarTodo() {
  var corrida = etiquetaCorrida();
  Logger.log('== Corrida INDICADORES %s ==', corrida);
  cargarUno(corrida, 'ind_otif',          function(){ return leerDriveXlsxPorNombre(DRIVE_NOMBRE.otif); },          SPEC_OTIF);
  cargarUno(corrida, 'ind_flete_pagado',  function(){ return leerDriveXlsxPorNombre(DRIVE_NOMBRE.flete_pagado); },  SPEC_FLETE_PAGADO);
  cargarUno(corrida, 'ind_flete_cobrado', function(){ return leerDriveXlsxPorNombre(DRIVE_NOMBRE.flete_cobrado); }, SPEC_FLETE_COBRADO);
  cargarFleteTercero(corrida);
  // Refresca las vistas materializadas de KPI (lectura instantánea en la app)
  try { sbRpcRefresh(); logRun(corrida, 'refresh_matviews', 0, 'ok', 'fn_ind_refresh_all'); }
  catch (e) { logRun(corrida, 'refresh_matviews', 0, 'error', String(e)); }
}

// Refresca todas las vistas materializadas v_ind_* vía RPC.
function sbRpcRefresh() {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/fn_ind_refresh_all', {
    method: 'post', contentType: 'application/json',
    headers: sbHeaders(), payload: '{}', muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('refresh HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
}

// ---- Entrypoints escalonados (los que usan los triggers automaticos) ------
// Terminan justo antes de las 08:30, que es cuando corre el refresh final.
// Cada uno valida dia habil (lunes-viernes) antes de tocar Drive/Gmail/Supabase.
function cargar_otif()          { if (!esDiaHabil()) return; cargarUno(etiquetaCorrida(),'ind_otif',          function(){return leerDriveXlsxPorNombre(DRIVE_NOMBRE.otif);},          SPEC_OTIF); }
function cargar_flete_cobrado() { if (!esDiaHabil()) return; cargarUno(etiquetaCorrida(),'ind_flete_cobrado', function(){return leerDriveXlsxPorNombre(DRIVE_NOMBRE.flete_cobrado);}, SPEC_FLETE_COBRADO); }
function cargar_flete_pagado()  { if (!esDiaHabil()) return; cargarUno(etiquetaCorrida(),'ind_flete_pagado',  function(){return leerDriveXlsxPorNombre(DRIVE_NOMBRE.flete_pagado);},  SPEC_FLETE_PAGADO); }
function cargar_flete_tercero() { if (!esDiaHabil()) return; cargarFleteTercero(etiquetaCorrida()); }

// Carga Flete Tercero (Gmail) y, a diferencia de antes, marca el correo como
// LEIDO una vez cargado con exito (antes releia siempre el ultimo, leido o no).
function cargarFleteTercero(corrida) {
  try {
    var res = leerGmailXlsxYObtenerMsg(LABEL_FT);
    if (!res) { logRun(corrida, 'ind_flete_tercero', 0, 'sin_datos', 'sin adjunto xlsx en ' + LABEL_FT); return; }
    if (!res.sheet.values || res.sheet.values.length < 2) {
      logRun(corrida, 'ind_flete_tercero', 0, 'sin_datos', res.sheet.name);
      return;
    }
    var filas = mapearFilas(res.sheet.values, SPEC_FLETE_TERCERO);
    reemplazarTabla('ind_flete_tercero', filas);
    try { res.msg.markRead(); } catch (e) {}
    logRun(corrida, 'ind_flete_tercero', filas.length, 'ok', res.sheet.name);
  } catch (e) {
    logRun(corrida, 'ind_flete_tercero', 0, 'error', String(e).slice(0, 480));
  }
}

// Refresca fn_ind_refresh_all() como paso independiente, a las 08:30 (despues
// de que las 4 fuentes ya cargaron).
function ejecutar_refresh_indicadores() {
  if (!esDiaHabil()) return;
  var corrida = etiquetaCorrida();
  try {
    sbRpcRefresh();
    logRun(corrida, 'refresh_matviews', 0, 'ok', 'fn_ind_refresh_all (trigger escalonado)');
  } catch (e) {
    logRun(corrida, 'refresh_matviews', 0, 'error', String(e));
  }
}

// ----------------------------- DIA HABIL -------------------------------------
// true de lunes a viernes (hora Chile), false sabado/domingo.
function esDiaHabil() {
  var dia = Utilities.formatDate(new Date(), 'America/Santiago', 'EEEE');
  return ['Saturday', 'Sunday'].indexOf(dia) === -1;
}

// Crea los triggers ESCALONADOS por fuente, de lunes a viernes, terminando a
// las 08:30 (antes terminaban 08:15; el rango 08:10-08:27 sigue siendo
// necesario para que "FLETE 360" / ind_flete_pagado, la fuente mas grande
// -70-78k filas-, no se corte por el limite de ejecucion de Apps Script -
// ver incidente 14-sep-2026). Ejecutar manualmente 1 vez para (re)crear.
//
// IMPORTANTE: atHour/nearMinute en triggers diarios de Apps Script es
// APROXIMADO (puede disparar hasta ~15 min despues de la hora indicada, y
// el orden real entre triggers cercanos no esta garantizado). Esto no
// rompe nada porque cada trigger solo toca su propia tabla (no hay
// dependencia entre ellos, excepto el refresh final).
function crearTriggers() {
  var handlers = ['ejecutar_0800', 'cargar_otif', 'cargar_flete_pagado',
    'cargar_flete_cobrado', 'cargar_flete_tercero', 'ejecutar_refresh_indicadores'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cargar_otif').timeBased().atHour(8).nearMinute(10).everyDays(1).create();
  ScriptApp.newTrigger('cargar_flete_cobrado').timeBased().atHour(8).nearMinute(15).everyDays(1).create();
  ScriptApp.newTrigger('cargar_flete_pagado').timeBased().atHour(8).nearMinute(20).everyDays(1).create();
  ScriptApp.newTrigger('cargar_flete_tercero').timeBased().atHour(8).nearMinute(25).everyDays(1).create();
  ScriptApp.newTrigger('ejecutar_refresh_indicadores').timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  Logger.log('Triggers creados: 08:10 otif / 08:15 flete_cobrado / 08:20 flete_pagado / ' +
    '08:25 flete_tercero (marca leido) / 08:30 refresh. Cada uno valida esDiaHabil().');
}

// ----------------------------- CORE -----------------------------------------
function cargarUno(corrida, tabla, lectorFn, spec) {
  try {
    var sheet = lectorFn();               // {values: [[...]], name: '...'}
    if (!sheet || !sheet.values || sheet.values.length < 2) {
      logRun(corrida, tabla, 0, 'sin_datos', sheet ? sheet.name : 'sin archivo');
      return;
    }
    var filas = mapearFilas(sheet.values, spec);
    reemplazarTabla(tabla, filas);
    logRun(corrida, tabla, filas.length, 'ok', sheet.name);
  } catch (e) {
    logRun(corrida, tabla, 0, 'error', String(e).slice(0, 480));
  }
}

// Convierte la matriz de valores en objetos {col: valor} segun la spec.
function mapearFilas(values, spec) {
  var header = values[0];
  var idxByH = {};
  for (var c = 0; c < header.length; c++) idxByH[slug(header[c])] = c;

  var plan = spec.map(function (s) {
    return { col: s.col, t: s.t, idx: idxByH[slug(s.h)] };
  });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // Salta filas totalmente vacias
    var vacia = true;
    for (var k = 0; k < row.length; k++) { if (row[k] !== '' && row[k] != null) { vacia = false; break; } }
    if (vacia) continue;

    var obj = {};
    for (var p = 0; p < plan.length; p++) {
      var pl = plan[p];
      var v = (pl.idx == null) ? null : row[pl.idx];
      obj[pl.col] = (pl.t === 'num') ? numChile(v)
                  : (pl.t === 'date') ? toISO(v)
                  : txtOrNull(v);
    }
    out.push(obj);
  }
  return out;
}

// ------------------------- LECTORES DE FUENTES ------------------------------
// Lee un xlsx de Drive por id: lo copia/convierte a Google Sheet y devuelve
// la matriz de valores de la 1a hoja. Borra la copia temporal.
function leerDriveXlsx(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return convertirYLeer(blob, file.getName());
}

// Busca en FOLDER_ID el xlsx más reciente cuyo nombre (sin extensión, normalizado)
// EMPIEZA con nombreBase. Devuelve su matriz de valores. Resuelve por nombre para
// que no importe el id (el usuario borra/sube archivos nuevos manualmente).
function leerDriveXlsxPorNombre(nombreBase) {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var it = folder.getFiles();
  var objetivo = slug(nombreBase);
  var mejor = null, mejorT = -1;
  while (it.hasNext()) {
    var f = it.next();
    var nombre = f.getName();
    if (!/\.xlsx$/i.test(nombre)) continue;
    var base = slug(nombre.replace(/\.xlsx$/i, ''));
    if (base.indexOf(objetivo) !== 0) continue;       // debe empezar con el nombre base
    var t = f.getLastUpdated().getTime();
    if (t > mejorT) { mejorT = t; mejor = f; }
  }
  if (!mejor) throw new Error('No se encontró xlsx que empiece con "' + nombreBase + '" en la carpeta');
  var blob = mejor.getBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return convertirYLeer(blob, mejor.getName());
}

// Lee el adjunto xlsx del correo mas reciente NO LEIDO de la etiqueta indicada;
// si no hay ninguno no leido, cae al mas reciente en general (para no dejar de
// actualizar si por algun motivo ya estaba leido). Devuelve {sheet, msg}.
function leerGmailXlsxYObtenerMsg(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) throw new Error('No existe etiqueta ' + labelName);
  var bestUnread = null, bestUnreadD = -1, bestUnreadAtt = null, bestUnreadMsg = null;
  var bestAny = null, bestAnyD = -1, bestAnyAtt = null, bestAnyMsg = null;
  var threads = label.getThreads(0, 60);
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var att = adjunto(msg, /\.xlsx$/i);
      if (!att) continue;
      var d = msg.getDate().getTime();
      if (d > bestAnyD) { bestAnyD = d; bestAnyMsg = msg; bestAnyAtt = att; }
      if (msg.isUnread() && d > bestUnreadD) { bestUnreadD = d; bestUnreadMsg = msg; bestUnreadAtt = att; }
    }
  }
  var msg = bestUnreadMsg || bestAnyMsg;
  var att = bestUnreadAtt || bestAnyAtt;
  if (!att) return null;
  var blob = att.copyBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  var sheet = convertirYLeer(blob, att.getName());
  return { sheet: sheet, msg: msg };
}

// Convierte un blob xlsx a Google Sheet, espera la conversion, lee valores.
function convertirYLeer(blob, nombre) {
  var tmp = Drive.Files.insert(
    { title: 'tmp_ind_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' },
    blob
  );
  try {
    var msW = 0, sh = null;
    while (msW < 120000) {
      try {
        if (Drive.Files.get(tmp.id).mimeType === 'application/vnd.google-apps.spreadsheet') {
          sh = SpreadsheetApp.openById(tmp.id).getSheets()[0]; break;
        }
      } catch (e3) {}
      Utilities.sleep(3000); msW += 3000;
    }
    if (!sh) throw new Error('Conversion del xlsx no lista: ' + nombre);
    return { values: sh.getDataRange().getValues(), name: nombre };
  } finally {
    try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
  }
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

// Pisa la tabla completa: borra todo y reinserta.
function reemplazarTabla(tabla, filas) {
  sbDelete(tabla, 'id=gt.0');            // id identity >= 1 -> borra todo
  insertarEnLotes(tabla, filas);
}

function insertarEnLotes(tabla, filas) {
  for (var i = 0; i < filas.length; i += CHUNK) {
    var lote = filas.slice(i, i + CHUNK);
    var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + tabla, {
      method: 'post', contentType: 'application/json',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
      payload: JSON.stringify(lote), muteHttpExceptions: true
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

function logRun(corrida, fuente, filas, estado, mensaje) {
  Logger.log('[%s] %s filas=%s estado=%s %s', corrida, fuente, filas, estado, mensaje || '');
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/ind_log', {
      method: 'post', contentType: 'application/json',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
      payload: JSON.stringify([{ corrida: corrida, fuente: fuente, filas: filas,
        estado: estado, mensaje: (mensaje || '').slice(0, 500) }]),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

// ---------------------- UTILS -----------------------------------------------
function etiquetaCorrida() {
  return Utilities.formatDate(new Date(), 'America/Santiago', "yyyy-MM-dd'T'HH:mm");
}

function adjunto(msg, regex) {
  var as = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  for (var i = 0; i < as.length; i++) { if (regex.test(as[i].getName())) return as[i]; }
  return null;
}

function txtOrNull(v) {
  if (v == null) return null;
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
  var s = String(v).trim();
  return (s === '' || s === '-') ? null : s;
}

// Numero estilo Chile: '13.767' miles, '47,4' decimal. Acepta numeros nativos.
function numChile(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim();
  if (s === '' || s === '-') return null;
  if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Fecha -> 'yyyy-MM-dd'. Acepta Date nativo o strings dd.MM.yyyy / dd-MM-yyyy / yyyy-MM-dd.
function toISO(v) {
  if (v == null || v === '' || v === '-') return null;
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
  var s = String(v).trim();
  if (s === '' || s === '-') return null;
  var m = /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/.exec(s);
  if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
  m = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/.exec(s);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  return null;
}
function pad2(x){ x = String(x); return x.length < 2 ? '0'+x : x; }

function slug(h) {
  if (h == null) h = '';
  h = h.normalize ? h.normalize('NFKD').replace(/[̀-ͯ]/g, '') : h;
  h = h.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return h || 'col';
}

// ---------------------- PRUEBAS MANUALES ------------------------------------
function probar_ahora() { cargarTodo(); }
