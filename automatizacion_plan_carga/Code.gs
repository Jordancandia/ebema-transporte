/**
 * ============================================================================
 *  CORREO PLAN DE CARGA (tabla completa + CSV por centro)  ->  Gmail
 * ----------------------------------------------------------------------------
 *  Envía 3 correos diarios (días hábiles lunes-viernes) a los usuarios OWNER /
 *  ADMINISTRADOR_DEPOSITO. Por corrida y por destinatario se envía UN SOLO
 *  correo, asunto siempre "PLAN DE CARGA – [FECHA]" (sin centro/cantidad en
 *  el asunto — aplica igual para todos). El cuerpo trae una tabla con TODOS
 *  los centros que le correspondan (tengan o no carga), y un archivo CSV
 *  adjunto INDEPENDIENTE solo por cada centro que esté en estado PROGRAMAR
 *  (≥80% de camión lleno) — el correo solo se envía si hay al menos uno.
 *
 *  Qué centros le corresponden a cada destinatario:
 *   - Si tiene centro(s) en su "Centro de Preferencia" (app_users.centrosPreferencia)
 *     -> solo esos centros (en la tabla, tengan o no carga).
 *   - Si centrosPreferencia es null (== "Todos los centros", igual que en toda
 *     la plataforma) -> TODOS los centros de ambos CDs, en la misma tabla.
 *
 *    08:30  INICIAL
 *    12:00  ACTUALIZACION
 *    15:30  CIERRE
 *
 *  Fuente de datos: vistas server-side v_trc_plan_carga_1003(_detalle) y
 *  v_trc_plan_carga_1081(_detalle) en Supabase PRD (humhokvdowfqicjopbhf).
 *  Esta automatización NO reimplementa la lógica de negocio del Plan de
 *  Carga — solo consulta esas vistas.
 *
 *  Spec funcional completa: spec_correo_plan_carga_2026-09-17.md (memoria del
 *  proyecto SIT EBEMA en Claude).
 *
 *  Requisitos (igual que automatizacion_troncales/README_DESPLIEGUE.md):
 *   1) Zona horaria del proyecto Apps Script = America/Santiago
 *   2) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';

// Centros de distribución (origen) cubiertos por esta automatización.
var CDS = [
  {
    id: '1003',
    nombre: 'CD Quilicura',
    destinos: ['1020', '1040', '1050', '1060', '1070', '1080', '1090', '1100', '1160', '1005'],
    viewResumen: 'v_trc_plan_carga_1003',
    viewDetalle: 'v_trc_plan_carga_1003_detalle'
  },
  {
    id: '1081',
    nombre: 'CD Concepción',
    destinos: ['1100', '1090', '1160', '1070', '1060', '1005', '1003'],
    viewResumen: 'v_trc_plan_carga_1081',
    viewDetalle: 'v_trc_plan_carga_1081_detalle'
  }
];

// Roles que reciben este correo (deben tener el campo Centro de Preferencia
// disponible en "Roles y Perfiles" — ver js/roles.js CENTRO_ROLES).
var ROLES_DESTINATARIOS = ['OWNER', 'ADMINISTRADOR_DEPOSITO'];

// Columnas de tonelaje, en el orden pedido: REVEX, Venta Directa, Retiro
// Fábrica, Crossdocking, Quiebre, Abastecimiento.
var COLUMNAS_TON = [
  { key: 'ton_revex', label: 'REVEX' },
  { key: 'ton_venta_cons', label: 'Venta Directa' },
  { key: 'ton_retiro', label: 'Retiro Fábrica' },
  { key: 'ton_cross', label: 'Crossdocking' },
  { key: 'ton_quiebre', label: 'Quiebre' },
  { key: 'ton_stock', label: 'Abastecimiento' }
];

// Orden de columnas del CSV adjunto (detalle de líneas de cada centro).
var CSV_HEADERS = ['CATEGORIA', 'DOCUMENTO', 'MATERIAL', 'NOMBRE', 'FECHA', 'CANTIDAD', 'TON', 'PEDIDO_VENTA'];

// Plantillas de correo por tipo de envío (encabezado + cierre; la tabla va
// entre medio). {fecha} = fecha de plan en formato dd-mm-yyyy.
var RUN_CONFIG = {
  INICIAL: {
    encabezado: function (fecha) {
      return 'Plan de Carga – Datos al ' + fecha + '.';
    },
    cierre: function () {
      return 'El Excel adjunto (uno por centro) trae el detalle de la carga que cumple para estar; el detalle por pedido también está disponible en la plataforma SIT EBEMA Transporte, módulo Plan de Carga. Cualquier ajuste revisar con equipo de Abastecimiento.';
    }
  },
  ACTUALIZACION: {
    encabezado: function (fecha) {
      return 'Actualización de Carga – Datos actualizados al ' + fecha + '.';
    },
    cierre: function () {
      return 'El Excel adjunto (uno por centro) trae el detalle de la carga que cumple para estar; el detalle por pedido también está disponible en la plataforma SIT EBEMA Transporte, módulo Plan de Carga. Cualquier ajuste revisar con equipo de Abastecimiento.';
    }
  },
  CIERRE: {
    encabezado: function (fecha) {
      return 'Cierre Plan de Carga – Se envía cierre del plan de carga con fecha ' + fecha + '.';
    },
    cierre: function () {
      return 'En los adjuntos (uno por centro) está el detalle de la carga que se planificará para entrega en sucursal.';
    }
  }
};

// --------------------------- ENTRYPOINTS ------------------------------------
function ejecutar_0830() { procesarCorreoPlanCarga('INICIAL'); }
function ejecutar_1200() { procesarCorreoPlanCarga('ACTUALIZACION'); }
function ejecutar_1530() { procesarCorreoPlanCarga('CIERRE'); }

// Pruebas manuales (Ejecutar en el editor de Apps Script).
function probar_inicial()        { procesarCorreoPlanCarga('INICIAL'); }
function probar_actualizacion()  { procesarCorreoPlanCarga('ACTUALIZACION'); }
function probar_cierre()         { procesarCorreoPlanCarga('CIERRE'); }

// Crea los 3 triggers horarios (ejecutar manualmente 1 vez tras desplegar).
function crearTriggersCorreoPlanCarga() {
  var borrar = ['ejecutar_0830', 'ejecutar_1200', 'ejecutar_1530'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (borrar.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ejecutar_0830').timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('ejecutar_1200').timeBased().atHour(12).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('ejecutar_1530').timeBased().atHour(15).nearMinute(30).everyDays(1).create();
  Logger.log('Triggers creados: 08:30, 12:00, 15:30 (America/Santiago). El propio script se salta fines de semana.');
}

// ----------------------------- CORE -----------------------------------------
function procesarCorreoPlanCarga(tipo) {
  var corrida = etiquetaCorrida();
  var hoy = new Date();
  var diaSemana = hoy.getDay(); // 0=Domingo ... 6=Sábado (zona horaria del proyecto = America/Santiago)

  // Días hábiles = lunes a viernes simple (sin feriados por ahora; ver tabla
  // public.feriados_chile, creada para activarse más adelante).
  if (diaSemana === 0 || diaSemana === 6) {
    Logger.log('[%s] %s: fin de semana, no se envía.', corrida, tipo);
    return;
  }

  var fechaPlan = siguienteDiaHabil(hoy);
  var fechaPlanStr = Utilities.formatDate(fechaPlan, 'America/Santiago', 'dd-MM-yyyy');
  var fechaPlanISO = Utilities.formatDate(fechaPlan, 'America/Santiago', 'yyyy-MM-dd');

  Logger.log('[%s] Corrida %s — fecha de plan %s', corrida, tipo, fechaPlanStr);

  // 1) Junta TODOS los centros de ambos CDs (con o sin carga), calculando
  //    pct/status para cada uno. El cuadro del correo muestra todos; solo los
  //    que queden en PROGRAMAR generan CSV adjunto y disparan el envío.
  var todosCentros = []; // { cd, ce, nombre, pct, status, ton_* }
  CDS.forEach(function (cd) {
    var resumen;
    try {
      resumen = fetchResumen(cd);
    } catch (e) {
      Logger.log('[%s] Error consultando %s: %s', corrida, cd.viewResumen, e);
      return;
    }
    resumen.forEach(function (row) {
      var ce = String(row.ce || '').trim();
      if (cd.destinos.indexOf(ce) === -1) return; // defensivo: fuera del alcance de este CD
      var cap = Number(row.cap) || 0;
      var total = Number(row.total_cd) || 0;
      var pct = cap > 0 ? Math.round((total / cap) * 100) : 0;
      var status = pct >= 80 ? 'PROGRAMAR' : (pct >= 70 ? 'REVISAR' : 'CARGA INSUFICIENTE');
      row.cdId = cd.id;
      row.cdNombre = cd.nombre;
      row.pct = pct;
      row.status = status;
      row.ce = ce;
      todosCentros.push(row);
    });
  });

  if (!todosCentros.length) {
    Logger.log('[%s] %s: no se pudo leer ningún centro (revisar vistas/consulta).', corrida, tipo);
    return;
  }
  // Orden de despliegue en la tabla: PROGRAMAR primero, luego por % desc.
  todosCentros.sort(function (a, b) {
    if (a.status !== b.status) { return a.status === 'PROGRAMAR' ? -1 : (b.status === 'PROGRAMAR' ? 1 : 0); }
    return b.pct - a.pct;
  });

  var centrosProgramados = todosCentros.filter(function (r) { return r.status === 'PROGRAMAR'; });
  if (!centrosProgramados.length) {
    Logger.log('[%s] %s: ningún centro en PROGRAMAR hoy, no se envía nada.', corrida, tipo);
    return;
  }

  // Nombres de centro (cache).
  var nombresCentro = {};
  todosCentros.forEach(function (row) {
    if (!nombresCentro[row.ce]) nombresCentro[row.ce] = getNombreCentro(row.ce);
  });

  // 2) Trae todos los destinatarios activos (una sola consulta).
  var destinatarios;
  try {
    destinatarios = getDestinatarios();
  } catch (e) {
    Logger.log('[%s] Error consultando destinatarios: %s', corrida, e);
    return;
  }

  var asunto = 'PLAN DE CARGA – ' + fechaPlanStr;

  // 3) Por destinatario: arma SU cuadro completo (todos los centros que le
  //    correspondan, tengan o no carga) y envía UN correo con esa tabla +
  //    un CSV adjunto SOLO por cada centro en PROGRAMAR.
  destinatarios.forEach(function (u) {
    var esTodos = !u.centrosPreferencia || !u.centrosPreferencia.length;
    var misCentros = esTodos
      ? todosCentros
      : todosCentros.filter(function (row) { return u.centrosPreferencia.indexOf(row.ce) !== -1; });

    if (!misCentros.length) return; // este centro/estos centros no existen en el Plan de Carga

    var misProgramados = misCentros.filter(function (row) { return row.status === 'PROGRAMAR'; });
    if (!misProgramados.length) return; // nada en PROGRAMAR para este destinatario hoy: no se envía

    var htmlBody = buildHtmlBody(tipo, fechaPlanStr, misCentros, nombresCentro);
    var textBody = buildTextBody(tipo, fechaPlanStr, misCentros, nombresCentro);

    var adjuntos = [];
    var detallesPorCentro = {};
    misProgramados.forEach(function (row) {
      var cd = cdPorId(row.cdId);
      var detalle;
      try {
        detalle = getDetalleCentro(cd, row.ce);
      } catch (e) {
        Logger.log('[%s] Error detalle %s/%s: %s', corrida, row.cdId, row.ce, e);
        detalle = [];
      }
      detallesPorCentro[row.ce] = detalle;
      adjuntos.push(buildCsvBlob(row.ce, fechaPlan, detalle));
    });

    try {
      GmailApp.sendEmail(u.email, asunto, textBody, {
        htmlBody: htmlBody,
        attachments: adjuntos,
        name: 'SIT EBEMA Transporte'
      });
      misProgramados.forEach(function (row) {
        logCorreo(corrida, tipo, row.cdId, row.ce, fechaPlanISO, u.email, row.pct, row.status,
          (detallesPorCentro[row.ce] || []).length, 'ok', '');
      });
    } catch (e) {
      misProgramados.forEach(function (row) {
        logCorreo(corrida, tipo, row.cdId, row.ce, fechaPlanISO, u.email, row.pct, row.status,
          (detallesPorCentro[row.ce] || []).length, 'error', String(e));
      });
    }
  });

  // 4) Centros en PROGRAMAR sin ningún destinatario (ni puntual ni "todos"):
  //    señal operativa, no es un error del script.
  centrosProgramados.forEach(function (row) {
    var alguien = destinatarios.some(function (u) {
      var esTodos = !u.centrosPreferencia || !u.centrosPreferencia.length;
      return esTodos || u.centrosPreferencia.indexOf(row.ce) !== -1;
    });
    if (!alguien) {
      logCorreo(corrida, tipo, row.cdId, row.ce, fechaPlanISO, '', row.pct, row.status, 0,
        'sin_destinatarios', 'Ningún usuario activo con ese centro (ni con "todos los centros")');
    }
  });
}

function cdPorId(id) {
  for (var i = 0; i < CDS.length; i++) if (CDS[i].id === id) return CDS[i];
  return null;
}

// ----------------------------- CUERPO DEL CORREO ------------------------------
function fmtTon(v) {
  var n = Number(v) || 0;
  return n.toFixed(1);
}

// Colores de fondo por estado (igual criterio que la plataforma: verde
// PROGRAMAR >=80%, amarillo REVISAR >=70%, gris CARGA INSUFICIENTE).
var STATUS_BG = {
  'PROGRAMAR': '#e6f4ea',
  'REVISAR': '#fff8e1',
  'CARGA INSUFICIENTE': '#f5f5f5'
};

function buildHtmlBody(tipo, fechaPlanStr, centros, nombresCentro) {
  var cfg = RUN_CONFIG[tipo];
  var filas = centros.map(function (row) {
    var bg = STATUS_BG[row.status] || '#ffffff';
    var celdas = COLUMNAS_TON.map(function (c) {
      return '<td style="padding:4px 8px;text-align:right;border:1px solid #ddd">' + fmtTon(row[c.key]) + '</td>';
    }).join('');
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(nombresCentro[row.ce] || row.ce) + ' (' + row.ce + ')</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(row.cdNombre) + '</td>' +
      '<td style="padding:4px 8px;text-align:right;border:1px solid #ddd">' + row.pct + '%</td>' +
      '<td style="padding:4px 8px;border:1px solid #ddd;font-weight:bold">' + escapeHtml(row.status) + '</td>' +
      celdas +
      '</tr>';
  }).join('');

  var headerCols = ['Centro', 'CD Origen', '%', 'Estado'].concat(COLUMNAS_TON.map(function (c) { return c.label; }));
  var headerHtml = headerCols.map(function (h) {
    return '<th style="padding:4px 8px;text-align:left;border:1px solid #ddd;background:#f2f2f2">' + h + '</th>';
  }).join('');

  return '<p>' + escapeHtml(cfg.encabezado(fechaPlanStr)) + '</p>' +
    '<p style="font-size:12px;color:#555">Se muestran todos tus centros; los marcados <b>PROGRAMAR</b> traen el detalle adjunto en CSV.</p>' +
    '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">' +
    '<thead><tr>' + headerHtml + '</tr></thead>' +
    '<tbody>' + filas + '</tbody>' +
    '</table>' +
    '<p>' + escapeHtml(cfg.cierre()) + '</p>';
}

function buildTextBody(tipo, fechaPlanStr, centros, nombresCentro) {
  var cfg = RUN_CONFIG[tipo];
  var lineas = centros.map(function (row) {
    var partes = COLUMNAS_TON.map(function (c) { return c.label + ': ' + fmtTon(row[c.key]) + ' T'; });
    return '- ' + (nombresCentro[row.ce] || row.ce) + ' (' + row.ce + ', ' + row.cdNombre + ', ' + row.pct + '%, ' + row.status + '): ' + partes.join(', ');
  });
  return cfg.encabezado(fechaPlanStr) + '\n' +
    'Orden de columnas: REVEX, Venta Directa, Retiro Fábrica, Crossdocking, Quiebre, Abastecimiento.\n' +
    'Se listan todos tus centros; solo los PROGRAMAR traen CSV adjunto.\n\n' +
    lineas.join('\n') + '\n\n' +
    cfg.cierre();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------- FECHAS ----------------------------------------
// Siguiente día hábil = lunes a viernes simple (sin feriados por ahora).
function siguienteDiaHabil(desde) {
  var d = new Date(desde.getTime());
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function etiquetaCorrida() {
  return Utilities.formatDate(new Date(), 'America/Santiago', "yyyy-MM-dd'T'HH:mm");
}

// ---------------------- CSV DEL DETALLE (uno por centro) ----------------------
function buildCsvBlob(ce, fechaPlan, detalle) {
  var lines = [CSV_HEADERS.join(',')];
  detalle.forEach(function (r) {
    lines.push([
      csvCell(r.categoria), csvCell(r.documento), csvCell(r.material), csvCell(r.nombre),
      csvCell(r.fecha), csvCell(r.cantidad), csvCell(r.ton), csvCell(r.pedido_venta)
    ].join(','));
  });
  var csv = '﻿' + lines.join('\r\n'); // BOM para que Excel abra bien los acentos
  var nombreArchivo = 'PlanCarga_' + ce + '_' + Utilities.formatDate(fechaPlan, 'America/Santiago', 'yyyy-MM-dd') + '.csv';
  return Utilities.newBlob(csv, 'text/csv;charset=utf-8', nombreArchivo);
}

function csvCell(v) {
  if (v == null) return '';
  var s = String(v);
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------- HELPERS SUPABASE (REST) -------------------------------
function serviceKey() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta la propiedad de script SUPABASE_SERVICE_KEY');
  return k;
}

function sbHeaders() {
  var k = serviceKey();
  return { 'apikey': k, 'Authorization': 'Bearer ' + k };
}

function sbGet(path) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'get', headers: sbHeaders(), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('GET ' + path + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '[]');
}

function fetchResumen(cd) {
  return sbGet(cd.viewResumen + '?select=ce,total_cd,cap,ton_quiebre,ton_stock,ton_revex,ton_cross,ton_venta_cons,ton_venta_cliente,ton_retiro,ton_fab_suc,ton_fab_cli');
}

function getDetalleCentro(cd, ce) {
  return sbGet(cd.viewDetalle + '?ce=eq.' + encodeURIComponent(ce) +
    '&select=categoria,documento,material,nombre,fecha,cantidad,ton,pedido_venta&order=categoria.asc');
}

// Trae TODOS los destinatarios activos de una vez (una sola consulta por
// corrida, en vez de una por centro).
function getDestinatarios() {
  var rolesIn = 'in.(' + ROLES_DESTINATARIOS.join(',') + ')';
  var rows = sbGet('app_users?select=email,name,centrosPreferencia&activo=eq.true&role=' + rolesIn);
  return rows.filter(function (u) { return u.email; });
}

var _nombreCentroCache = {};
function getNombreCentro(ce) {
  if (_nombreCentroCache[ce]) return _nombreCentroCache[ce];
  try {
    var rows = sbGet('logistics_centres?id=eq.' + encodeURIComponent(ce) + '&select=nombre');
    var nombre = (rows[0] && rows[0].nombre) || ce;
    _nombreCentroCache[ce] = nombre;
    return nombre;
  } catch (e) {
    return ce;
  }
}

function logCorreo(corrida, tipo, cdOrigen, centro, fechaPlanISO, destinatario, pct, status, filasDetalle, estado, mensaje) {
  Logger.log('[%s] %s %s/%s -> %s pct=%s status=%s estado=%s %s',
    corrida, tipo, cdOrigen, centro, destinatario || '(nadie)', pct, status, estado, mensaje || '');
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/correo_plan_carga_log', {
      method: 'post', contentType: 'application/json',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, sbHeaders()),
      payload: JSON.stringify([{
        corrida: corrida, tipo_envio: tipo, cd_origen: cdOrigen, centro: centro,
        fecha_plan: fechaPlanISO, destinatario: destinatario || '(sin destinatario)',
        pct: pct, status: status, filas_detalle: filasDetalle, estado: estado,
        mensaje: (mensaje || '').slice(0, 500)
      }]),
      muteHttpExceptions: true
    });
  } catch (e) { Logger.log('logCorreo error: ' + e); }
}
