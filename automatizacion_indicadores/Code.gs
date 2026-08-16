/**
 * ============================================================================
 *  AUTOMATIZACION INDICADORES TRANSPORTE  ->  SUPABASE (SIT EBEMA)
 * ----------------------------------------------------------------------------
 *  Corre 1 vez al dia (08:00 hora Chile). Lee 4 fuentes, las parsea y PISA
 *  (overwrite total) las tablas ind_* en Supabase. Sin historico.
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

// IDs de los archivos en Drive (se sobrescriben a diario manteniendo el id)
var DRIVE = {
  otif:          '1BVc5cdBi-kHw2wkyHxYasjcFFYaCsMAf',
  flete_pagado:  '1O_BTtVN8Ee9EiW5-mTjoRBo9b_SZP83L',   // FLETE 360
  flete_cobrado: '1qAZ7cZHq0TbfdB7-j-xW5jffNO9QkiBB'
};

// Gmail: label y filtro del correo de Flete Tercero
var LABEL_FT = 'Indicadores Transporte';

var CHUNK = 2500; // filas por request de inserción

// ---- Especificaciones de columnas por fuente -------------------------------
// {col: nombre en Supabase, h: header en el archivo, t: tipo (text|num|date)}
var SPEC_OTIF = [
  {col:'nota_venta',h:'Nota Venta',t:'text'},
  {col:'clvt',h:'ClVt',t:'text'},
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
function ejecutar_0800() { cargarTodo(); }

function cargarTodo() {
  var corrida = etiquetaCorrida();
  Logger.log('== Corrida INDICADORES %s ==', corrida);
  cargarUno(corrida, 'ind_otif',          function(){ return leerDriveXlsx(DRIVE.otif); },          SPEC_OTIF);
  cargarUno(corrida, 'ind_flete_pagado',  function(){ return leerDriveXlsx(DRIVE.flete_pagado); },  SPEC_FLETE_PAGADO);
  cargarUno(corrida, 'ind_flete_cobrado', function(){ return leerDriveXlsx(DRIVE.flete_cobrado); }, SPEC_FLETE_COBRADO);
  cargarUno(corrida, 'ind_flete_tercero', function(){ return leerGmailXlsx(LABEL_FT); },            SPEC_FLETE_TERCERO);
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

// Entrypoints individuales (para dividir en triggers escalonados si hay timeout)
function cargar_otif()          { cargarUno(etiquetaCorrida(),'ind_otif',          function(){return leerDriveXlsx(DRIVE.otif);},          SPEC_OTIF); }
function cargar_flete_pagado()  { cargarUno(etiquetaCorrida(),'ind_flete_pagado',  function(){return leerDriveXlsx(DRIVE.flete_pagado);},  SPEC_FLETE_PAGADO); }
function cargar_flete_cobrado() { cargarUno(etiquetaCorrida(),'ind_flete_cobrado', function(){return leerDriveXlsx(DRIVE.flete_cobrado);}, SPEC_FLETE_COBRADO); }
function cargar_flete_tercero() { cargarUno(etiquetaCorrida(),'ind_flete_tercero', function(){return leerGmailXlsx(LABEL_FT);},            SPEC_FLETE_TERCERO); }

// Crea el trigger diario 08:00 (ejecutar manualmente 1 vez).
function crearTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ejecutar_0800') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ejecutar_0800').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  Logger.log('Trigger creado: 08:00 America/Santiago -> ejecutar_0800');
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

// Lee el adjunto xlsx del correo mas reciente de la etiqueta indicada.
function leerGmailXlsx(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) throw new Error('No existe etiqueta ' + labelName);
  var best = null, bestD = -1, bestAtt = null;
  var threads = label.getThreads(0, 60);
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var att = adjunto(msg, /\.xlsx$/i);
      if (!att) continue;
      var d = msg.getDate().getTime();
      if (d > bestD) { bestD = d; best = msg; bestAtt = att; }
    }
  }
  if (!bestAtt) throw new Error('Sin adjunto xlsx en etiqueta ' + labelName);
  var blob = bestAtt.copyBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return convertirYLeer(blob, bestAtt.getName());
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
  h = h.normalize ? h.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : h;
  h = h.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return h || 'col';
}

// ---------------------- PRUEBAS MANUALES ------------------------------------
function probar_ahora() { cargarTodo(); }
