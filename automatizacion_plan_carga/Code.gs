/**
 * ============================================================================
 *  CORREO PLAN DE CARGA (tabla completa + CSV por centro)  ->  Gmail
 * ----------------------------------------------------------------------------
 *  Envía 3 correos diarios (días hábiles lunes-viernes) a los usuarios OWNER /
 *  ADMINISTRADOR_DEPOSITO. Por corrida y por destinatario se envía UN SOLO
 *  correo, asunto siempre "PLAN DE CARGA – [FECHA]" (sin centro/cantidad en
 *  el asunto — aplica igual para todos). El cuerpo trae una tabla con TODOS
 *  los centros que le correspondan (tengan o no carga), separados por Centro
 *  Origen y por horizonte de planificación (24h / 48h, según
 *  abast_horizonte_centro), y un archivo CSV adjunto INDEPENDIENTE solo por
 *  cada centro que esté en estado PROGRAMAR (≥80% de camión lleno) — el
 *  correo solo se envía si hay al menos uno.
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
 *  v_trc_plan_carga_1081(_detalle) en Supabase PRD (humhokvdowfqicjopbhf), más
 *  la tabla abast_horizonte_centro (24h/48h por centro_origen+centro_destino,
 *  default 24h si no hay fila). Esta automatización NO reimplementa la
 *  lógica de negocio del Plan de Carga — solo consulta esas vistas/tablas.
 *
 *  Adjuntos CSV: nombre de archivo con prefijo del Centro Origen (ej.
 *  "1003_PlanCarga_1040_2026-09-23.csv" / "1081_PlanCarga_1100_2026-09-23.csv"),
 *  con la fecha objetivo del centro según su horizonte (24h -> próximo día
 *  hábil; 48h -> día hábil siguiente a ese). Separador de campos ";" y
 *  separador decimal "," (formato Excel/Chile) en las columnas de peso
 *  (TON_BRUTO, TON_VOL, TON).
 *
 *  Spec funcional completa: spec_correo_plan_carga_2026-09-17.md y
 *  feature_plan_carga_48h_feriados_2026-09-18.md (memoria del proyecto
 *  SIT EBEMA en Claude).
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

// Columnas de tonelaje. Orden: REVEX, Venta Directa, Retiro Fábrica,
// Crossdocking, Quiebre, Abastecimiento — y al final, marcadas como
// "independiente" (despacho directo, no cuenta para el % de ocupación del
// camión CD, se resaltan con COLOR_INDEPENDIENTE): CD-Cliente, Fábrica-Cliente,
// Fábrica-Sucursal (ajuste 17-sep-2026).
var COLUMNAS_TON = [
  { key: 'ton_revex', label: 'REVEX' },
  { key: 'ton_venta_cons', label: 'Venta Directa' },
  { key: 'ton_retiro', label: 'Retiro Fábrica' },
  { key: 'ton_cross', label: 'Crossdocking' },
  { key: 'ton_quiebre', label: 'Quiebre' },
  { key: 'ton_stock', label: 'Abastecimiento' },
  { key: 'ton_venta_cliente', label: 'CD-Cliente', independiente: true },
  { key: 'ton_fab_cli', label: 'Fábrica-Cliente', independiente: true },
  { key: 'ton_fab_suc', label: 'Fábrica-Sucursal', independiente: true }
];

// Color de fondo para las columnas de despacho independiente (17-sep-2026).
var COLOR_INDEPENDIENTE = '#ede7f6';

// Tipo de camión considerado para el % de ocupación, según la capacidad tope
// (cap) que trae la vista resumen: 15 T (Calera/San Bernardo si no llenan
// 28 T) o 28 T (default).
function fmtCamion(cap) {
  return Number(cap) === 15 ? 'Camión 15 T' : 'Camión 28 T';
}

// Orden de prioridad en el que los ítems compiten por la capacidad del
// camión CD (mismo criterio y mismo orden que marcarCapacidadCD() en
// js/abastecimiento.js): REVEX, Venta Directa, Retiro CD, Crossdocking,
// Quiebre, Abastecimiento. Las categorías de despacho directo (CD-Cliente,
// Fábrica-Cliente, Fábrica-Sucursal) no compiten por esta capacidad — se
// despachan en camión propio, independiente del Plan de Carga.
var CATEGORIA_ORDEN_CD = ['REVEX', 'Venta Directa', 'Retiro CD', 'Crossdocking', 'Quiebre', 'Abastecimiento'];

// Marca cada línea del detalle como "SÍ entra en el camión" o "EXCEDE" según
// capacidad acumulada (misma lógica que marcarCapacidadCD() de la
// plataforma: se recorre en orden de prioridad y se va sumando tonelaje;
// apenas la suma supera el cap, esa línea y las siguientes de su categoría
// quedan EXCEDE). Las categorías de despacho directo quedan en blanco (no
// aplica, no compiten por este camión).
function marcarEnCamion(detalle, cap) {
  var acc = 0;
  CATEGORIA_ORDEN_CD.forEach(function (cat) {
    detalle.forEach(function (r) {
      if (r.categoria !== cat) return;
      var ton = Number(r.ton) || 0;
      if (acc + ton <= cap + 1e-9) { r.enCamion = '✓ SÍ'; acc += ton; }
      else { r.enCamion = '✗ EXCEDE'; }
    });
  });
  detalle.forEach(function (r) {
    if (r.enCamion === undefined) r.enCamion = '';
  });
  return detalle;
}

// Orden de columnas del CSV adjunto (detalle de líneas de cada centro).
// (AJUSTE 18-sep-2026) Se agregan TON_BRUTO/TON_VOL de referencia, PEDIDO_VENTA
// pasa a estar junto al documento, PROVEEDOR/ENTREGA_ENTRANTE (retiros de
// fábrica) y RUTA/COMUNA/TIPO_EXPEDICION (pedidos de venta) — mismas columnas
// que se agregaron al CSV descargable de la plataforma (js/abastecimiento.js).
// (AJUSTE 22-sep-2026) Separador de campos ";" (antes ","), habilita usar ","
// como separador decimal en TON_BRUTO/TON_VOL/TON sin romper el parseo.
var CSV_HEADERS = ['CATEGORIA', 'EN_CAMION', 'DOCUMENTO', 'MATERIAL', 'NOMBRE', 'PEDIDO_VENTA', 'PROVEEDOR', 'ENTREGA_ENTRANTE', 'RUTA', 'COMUNA', 'TIPO_EXPEDICION', 'FECHA', 'CANTIDAD', 'TON_BRUTO', 'TON_VOL', 'TON'];

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

  // Fecha objetivo según horizonte: 24h -> próximo día hábil; 48h -> el día
  // hábil siguiente a ese (AJUSTE 22-sep-2026, antes había una sola fecha
  // global para todos los centros).
  var fechaPlan24 = siguienteDiaHabil(hoy);
  var fechaPlan48 = siguienteDiaHabil(fechaPlan24);
  var fechaPlan24Str = Utilities.formatDate(fechaPlan24, 'America/Santiago', 'dd-MM-yyyy');
  var fechaPlan48Str = Utilities.formatDate(fechaPlan48, 'America/Santiago', 'dd-MM-yyyy');
  var fechaPlan24ISO = Utilities.formatDate(fechaPlan24, 'America/Santiago', 'yyyy-MM-dd');
  var fechaPlan48ISO = Utilities.formatDate(fechaPlan48, 'America/Santiago', 'yyyy-MM-dd');

  Logger.log('[%s] Corrida %s — fecha 24h %s / fecha 48h %s', corrida, tipo, fechaPlan24Str, fechaPlan48Str);

  // 1) Junta TODOS los centros de ambos CDs (con o sin carga), calculando
  //    pct/status para cada uno, y el horizonte (24h/48h) configurado para
  //    ese centro_origen+centro_destino (abast_horizonte_centro, default 24h
  //    si no hay fila). El cuadro del correo muestra todos, separados por
  //    Centro Origen y por horizonte; solo los que queden en PROGRAMAR
  //    generan CSV adjunto y disparan el envío.
  var todosCentros = []; // { cd, ce, nombre, pct, status, horizonteHoras, fechaObjetivo, ton_* }
  CDS.forEach(function (cd) {
    var resumen;
    try {
      resumen = fetchResumen(cd);
    } catch (e) {
      Logger.log('[%s] Error consultando %s: %s', corrida, cd.viewResumen, e);
      return;
    }
    var horizontes;
    try {
      horizontes = fetchHorizontes(cd);
    } catch (e) {
      Logger.log('[%s] Error consultando abast_horizonte_centro para %s: %s', corrida, cd.id, e);
      horizontes = {};
    }
    resumen.forEach(function (row) {
      var ce = String(row.ce || '').trim();
      if (cd.destinos.indexOf(ce) === -1) return; // defensivo: fuera del alcance de este CD
      var cap = Number(row.cap) || 0;
      var total = Number(row.total_cd) || 0;
      var pct = cap > 0 ? Math.round((total / cap) * 100) : 0;
      var status = pct >= 80 ? 'PROGRAMAR' : (pct >= 70 ? 'REVISAR' : 'CARGA INSUFICIENTE');
      var horizonteHoras = Number(horizontes[ce]) === 48 ? 48 : 24;
      row.cdId = cd.id;
      row.cdNombre = cd.nombre;
      row.pct = pct;
      row.status = status;
      row.ce = ce;
      row.horizonteHoras = horizonteHoras;
      row.fechaObjetivo = horizonteHoras === 48 ? fechaPlan48 : fechaPlan24;
      row.fechaObjetivoISO = horizonteHoras === 48 ? fechaPlan48ISO : fechaPlan24ISO;
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

  var asunto = 'PLAN DE CARGA – ' + fechaPlan24Str;

  // 3) Por destinatario: arma SU cuadro completo (todos los centros que le
  //    correspondan, tengan o no carga, separados por Centro Origen y por
  //    horizonte 24h/48h) y envía UN correo con esa tabla + un CSV adjunto
  //    SOLO por cada centro en PROGRAMAR, con la fecha objetivo de su
  //    horizonte y el Centro Origen como prefijo del nombre de archivo.
  destinatarios.forEach(function (u) {
    var esTodos = !u.centrosPreferencia || !u.centrosPreferencia.length;
    var misCentros = esTodos
      ? todosCentros
      : todosCentros.filter(function (row) { return u.centrosPreferencia.indexOf(row.ce) !== -1; });

    if (!misCentros.length) return; // este centro/estos centros no existen en el Plan de Carga

    var misProgramados = misCentros.filter(function (row) { return row.status === 'PROGRAMAR'; });
    if (!misProgramados.length) return; // nada en PROGRAMAR para este destinatario hoy: no se envía

    var htmlBody = buildHtmlBody(tipo, fechaPlan24Str, fechaPlan48Str, misCentros, nombresCentro);
    var textBody = buildTextBody(tipo, fechaPlan24Str, fechaPlan48Str, misCentros, nombresCentro);

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
      adjuntos.push(buildCsvBlob(row.cdId, row.ce, row.fechaObjetivo, detalle, row.cap));
    });

    try {
      GmailApp.sendEmail(u.email, asunto, textBody, {
        htmlBody: htmlBody,
        attachments: adjuntos,
        name: 'SIT EBEMA Transporte'
      });
      misProgramados.forEach(function (row) {
        logCorreo(corrida, tipo, row.cdId, row.ce, row.fechaObjetivoISO, u.email, row.pct, row.status,
          (detallesPorCentro[row.ce] || []).length, 'ok', '');
      });
    } catch (e) {
      misProgramados.forEach(function (row) {
        logCorreo(corrida, tipo, row.cdId, row.ce, row.fechaObjetivoISO, u.email, row.pct, row.status,
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
      logCorreo(corrida, tipo, row.cdId, row.ce, row.fechaObjetivoISO, '', row.pct, row.status, 0,
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

// Orden de las filas dentro de la tabla de un CD: PROGRAMAR primero, luego
// por % descendente (mismo criterio que el orden global de todosCentros,
// se reaplica aquí por si acaso).
function ordenarFilasCd(centros) {
  return centros.slice().sort(function (a, b) {
    if (a.status !== b.status) { return a.status === 'PROGRAMAR' ? -1 : (b.status === 'PROGRAMAR' ? 1 : 0); }
    return b.pct - a.pct;
  });
}

// Encabezado de columnas (compartido entre los sub-cuadros 24h/48h de un
// mismo Centro Origen).
function headerColumnasHtml() {
  var headerCols = ['Centro', '%', 'Estado', 'Tipo de Camión'].concat(COLUMNAS_TON.map(function (c) { return c.label; }));
  return headerCols.map(function (h, i) {
    var col = COLUMNAS_TON[i - 4]; // las primeras 4 columnas no están en COLUMNAS_TON
    var bg = (col && col.independiente) ? COLOR_INDEPENDIENTE : '#f2f2f2';
    return '<th style="padding:4px 8px;text-align:left;border:1px solid #ddd;background:' + bg + '">' + h + '</th>';
  }).join('');
}

function filaHtml(row, nombresCentro) {
  var bg = STATUS_BG[row.status] || '#ffffff';
  var celdas = COLUMNAS_TON.map(function (c) {
    var estilo = 'padding:4px 8px;text-align:right;border:1px solid #ddd' + (c.independiente ? ';background:' + COLOR_INDEPENDIENTE : '');
    return '<td style="' + estilo + '">' + fmtTon(row[c.key]) + '</td>';
  }).join('');
  return '<tr style="background:' + bg + '">' +
    '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(nombresCentro[row.ce] || row.ce) + '</td>' +
    '<td style="padding:4px 8px;text-align:right;border:1px solid #ddd">' + row.pct + '%</td>' +
    '<td style="padding:4px 8px;border:1px solid #ddd;font-weight:bold">' + escapeHtml(row.status) + '</td>' +
    '<td style="padding:4px 8px;border:1px solid #ddd">' + escapeHtml(fmtCamion(row.cap)) + '</td>' +
    celdas +
    '</tr>';
}

// Tabla(s) HTML de un Centro Origen (17-sep-2026: una tabla por CD, con
// encabezado "Centro Origen: <nombre>"). AJUSTE 22-sep-2026: dentro de cada
// Centro Origen se separa además por horizonte de planificación (24h/48h),
// cada sub-cuadro con su propia fecha objetivo — un centro a 48h (ej.
// Coquimbo) aparece en el bloque "48h" con la fecha del día hábil siguiente,
// no la del bloque 24h.
function buildTablaCd(cd, centrosCd, nombresCentro, fechaPlan24Str, fechaPlan48Str) {
  if (!centrosCd.length) return '';
  var grupos = [
    { horas: 24, titulo: 'Planificación a 24h (fecha objetivo: ' + fechaPlan24Str + ')' },
    { horas: 48, titulo: 'Planificación a 48h (fecha objetivo: ' + fechaPlan48Str + ')' }
  ];
  return grupos.map(function (g) {
    var centrosGrupo = centrosCd.filter(function (row) { return (row.horizonteHoras || 24) === g.horas; });
    if (!centrosGrupo.length) return '';
    var filas = ordenarFilasCd(centrosGrupo).map(function (row) { return filaHtml(row, nombresCentro); }).join('');
    return '<p style="font-weight:bold;margin:14px 0 4px">Centro Origen: ' + escapeHtml(cd.nombre) + ' — ' + g.titulo + '</p>' +
      '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-bottom:8px">' +
      '<thead><tr>' + headerColumnasHtml() + '</tr></thead>' +
      '<tbody>' + filas + '</tbody>' +
      '</table>';
  }).join('');
}

function buildHtmlBody(tipo, fechaPlan24Str, fechaPlan48Str, centros, nombresCentro) {
  var cfg = RUN_CONFIG[tipo];
  var tablas = CDS.map(function (cd) {
    return buildTablaCd(cd, centros.filter(function (row) { return row.cdId === cd.id; }), nombresCentro, fechaPlan24Str, fechaPlan48Str);
  }).join('');

  return '<p>' + escapeHtml(cfg.encabezado(fechaPlan24Str)) + '</p>' +
    '<p style="font-size:12px;color:#555">Se muestran todos tus centros, separados por Centro Origen y por horizonte de planificación (24h / 48h); los marcados <b>PROGRAMAR</b> traen el detalle adjunto en CSV con la fecha objetivo correspondiente a su horizonte. Las columnas CD-Cliente, Fábrica-Cliente y Fábrica-Sucursal (fondo lila) son despachos directos, independientes del Plan de Carga.</p>' +
    tablas +
    '<p>' + escapeHtml(cfg.cierre()) + '</p>';
}

function buildTextBody(tipo, fechaPlan24Str, fechaPlan48Str, centros, nombresCentro) {
  var cfg = RUN_CONFIG[tipo];
  var grupos = [
    { horas: 24, titulo: 'Planificación a 24h (fecha objetivo: ' + fechaPlan24Str + ')' },
    { horas: 48, titulo: 'Planificación a 48h (fecha objetivo: ' + fechaPlan48Str + ')' }
  ];
  var bloques = [];
  CDS.forEach(function (cd) {
    var centrosCd = centros.filter(function (row) { return row.cdId === cd.id; });
    grupos.forEach(function (g) {
      var centrosGrupo = ordenarFilasCd(centrosCd.filter(function (row) { return (row.horizonteHoras || 24) === g.horas; }));
      if (!centrosGrupo.length) return;
      var lineas = centrosGrupo.map(function (row) {
        var partes = COLUMNAS_TON.map(function (c) { return c.label + ': ' + fmtTon(row[c.key]) + ' T'; });
        return '- ' + (nombresCentro[row.ce] || row.ce) + ' (' + row.pct + '%, ' + row.status + ', ' + fmtCamion(row.cap) + '): ' + partes.join(', ');
      });
      bloques.push('Centro Origen: ' + cd.nombre + ' — ' + g.titulo + '\n' + lineas.join('\n'));
    });
  });

  return cfg.encabezado(fechaPlan24Str) + '\n' +
    'Orden de columnas: REVEX, Venta Directa, Retiro Fábrica, Crossdocking, Quiebre, Abastecimiento, CD-Cliente, Fábrica-Cliente, Fábrica-Sucursal (estas 3 últimas son despachos directos, independientes del Plan de Carga).\n' +
    'Se listan todos tus centros, separados por Centro Origen y por horizonte de planificación (24h/48h); solo los PROGRAMAR traen CSV adjunto con la fecha objetivo correspondiente.\n\n' +
    bloques.join('\n\n') + '\n\n' +
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
// (AJUSTE 22-sep-2026) Prefijo del Centro Origen en el nombre de archivo
// (ej. "1003_PlanCarga_1040_2026-09-23.csv"), fecha objetivo según el
// horizonte de ESE centro (24h/48h, ya resuelta antes de llamar a esta
// función), separador decimal "," en TON_BRUTO/TON_VOL/TON (separador de
// campo ";", ver CSV_HEADERS), y columna EN_CAMION (marcarEnCamion) que
// distingue qué líneas quedan dentro de la capacidad del camión CD ("✓ SÍ")
// de las que la exceden ("✗ EXCEDE"); en blanco para las categorías de
// despacho directo (CD-Cliente, Fábrica-Cliente, Fábrica-Sucursal).
function buildCsvBlob(cdOrigenId, ce, fechaObjetivo, detalle, cap) {
  marcarEnCamion(detalle, Number(cap) || 0);
  var lines = [CSV_HEADERS.join(';')];
  detalle.forEach(function (r) {
    lines.push([
      csvCell(r.categoria), csvCell(r.enCamion), csvCell(r.documento), csvCell(r.material), csvCell(r.nombre),
      csvCell(r.pedido_venta), csvCell(r.proveedor), csvCell(r.entrega_entrante),
      csvCell(r.ruta), csvCell(r.comuna), csvCell(r.tipo_expedicion),
      csvCell(r.fecha), csvCell(r.cantidad), csvNum(r.ton_bruto), csvNum(r.ton_vol), csvNum(r.ton)
    ].join(';'));
  });
  var csv = '﻿' + lines.join('\r\n'); // BOM para que Excel abra bien los acentos
  var nombreArchivo = cdOrigenId + '_PlanCarga_' + ce + '_' + Utilities.formatDate(fechaObjetivo, 'America/Santiago', 'yyyy-MM-dd') + '.csv';
  return Utilities.newBlob(csv, 'text/csv;charset=utf-8', nombreArchivo);
}

function csvCell(v) {
  if (v == null) return '';
  var s = String(v);
  if (/[;"\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Igual que csvCell pero para columnas numéricas de peso: usa "," como
// separador decimal (formato Excel/Chile) en vez de ".".
function csvNum(v) {
  if (v == null || v === '') return '';
  return String(v).replace('.', ',');
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

// Horizonte de planificación (24h/48h) por centro_destino, para el
// centro_origen de este CD. Sin fila guardada en abast_horizonte_centro =
// 24h por defecto (mismo criterio que js/abastecimiento.js en la plataforma).
function fetchHorizontes(cd) {
  var rows = sbGet('abast_horizonte_centro?centro_origen=eq.' + encodeURIComponent(cd.id) + '&select=centro_destino,horizonte_horas');
  var map = {};
  rows.forEach(function (r) {
    map[String(r.centro_destino)] = Number(r.horizonte_horas) === 48 ? 48 : 24;
  });
  return map;
}

function getDetalleCentro(cd, ce) {
  return sbGet(cd.viewDetalle + '?ce=eq.' + encodeURIComponent(ce) +
    '&select=categoria,documento,material,nombre,fecha,cantidad,ton,pedido_venta,ton_bruto,ton_vol,proveedor,entrega_entrante,ruta,comuna,tipo_expedicion&order=categoria.asc');
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
