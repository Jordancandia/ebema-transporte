/**
 * ============================================================================
 *  CORREO DIARIO "NIVEL DE SERVICIO REVEX - [Fecha Envío]"  ->  Gmail
 * ----------------------------------------------------------------------------
 *  Lunes a viernes, 09:15 (America/Santiago) — después de la carga de Flete
 *  Tercero (08:25) y del refresh de Indicadores (08:30).
 *
 *  Contenido (todo sale de las vistas server-side v_ft_* de Supabase PRD, que
 *  aplican la regla vigente: Retira = Recepción en Sucursal; Despacho = Entrega
 *  Cliente — este script NO reimplementa lógica de negocio, solo la presenta):
 *    1. Cuadro Nivel de Servicio por Tipo de Servicio
 *    2. Cuadro Nivel de Servicio por Centro Destino
 *    3. Gráfico + tabla evolutivo mensual (OTIF y Fill Rate)
 *    4. Cuadro Pedidos Vencidos No Regularizados por Centro Responsable  (+ CSV adjunto)
 *    5. Cuadro Pedidos en Curso y sus estados                            (+ CSV adjunto)
 *  OTIF: Retira cierra en Recepción Sucursal. Vencidos/En curso (gestión): pendientes hasta la
 *  Entrega Cliente, también en Retira.
 *
 *  Vistas usadas: v_ft_ns_general, v_ft_ns_tipo, v_ft_ns_centro, v_ft_ns_mes,
 *  v_ft_cuello, v_ft_vencidos, v_ft_en_curso  (migración flete_tercero_ns_revex_base_views)
 *
 *  Requisitos (iguales a las demás automatizaciones del proyecto):
 *   1) Zona horaria del proyecto Apps Script = America/Santiago
 *   2) Propiedad de script SUPABASE_SERVICE_KEY con la service_role key
 *
 *  Todo el código va con prefijo NSR / nsr para no chocar con otros archivos
 *  del mismo proyecto de Apps Script.
 * ============================================================================
 */

// ------------------------------ CONFIG --------------------------------------
var NSR_SUPABASE_URL = 'https://humhokvdowfqicjopbhf.supabase.co';
var NSR_ASUNTO = 'NIVEL DE SERVICIO REVEX - ';   // + dd-mm-yyyy (fecha de envío)
var NSR_HORA_ENVIO = 9;                          // 09:15, tras la carga de las 08:25/08:30
var NSR_MINUTO_ENVIO = 15;                       // Apps Script ejecuta el trigger dentro de ±15 min de este minuto

// ⚠ MODO_PRUEBA = true  -> solo se envía a NSR_DESTINATARIOS_PRUEBA.
//   Cambiar a false cuando Jordan confirme el formato del correo.
var NSR_MODO_PRUEBA = true;
var NSR_DESTINATARIOS_PRUEBA = ['jcandia@ebema.cl'];
// Responsables por centro (hoja "Usuarios" del Excel Detalle Flete Tercero) + Jordan.
var NSR_DESTINATARIOS = [
  'jcandia@ebema.cl',
  'elagos@ebema.cl',       // 1003
  'gcerda@ebema.cl',       // 1020
  'rgutierrez@ebema.cl',   // 1040
  'cvillalon@ebema.cl',    // 1050
  'esolorza@ebema.cl',     // 1060
  'jgutierrez@ebema.cl',   // 1070
  'frodriguez@ebema.cl',   // 1080
  'ymedina@ebema.cl',      // 1090
  'rruiz@ebema.cl',        // 1100
  'jvenegas@ebema.cl',     // 1160
  'preyes@ebema.cl',       // 1005
  'portuzar@ebema.cl',
  'ngalvez@ebema.cl',
  'distribucion@ebema.cl',
  'logsant@ebema.cl'
];

// Umbrales de color de los porcentajes
var NSR_OTIF_CRITICO = 50;         // < 50% = rojo
var NSR_OTIF_ALERTA = 80;          // < 80% = ámbar; >= 80% verde
var NSR_DATOS_VIEJOS_HORAS = 30;   // aviso si la última carga de datos es más vieja que esto

var NSR_COLORES = { rojo: '#C0000C', ambar: '#B5730B', verde: '#1E8449', gris: '#6B6E70', tinta: '#333333', linea: '#D9D5CF', head: '#f2f2f2' };
var NSR_ESTADOS_CURSO = ['Sin Recepción en CD', 'Recepción en CD (sin traslado)', 'En Tránsito', 'En Bodega Destino', 'Listo para Retiro en Sucursal'];

// --------------------------- ENTRYPOINTS ------------------------------------
function ejecutar_nivel_servicio_revex() { nsrProcesar(false); }
// Prueba manual: ignora el día hábil y envía solo a NSR_DESTINATARIOS_PRUEBA.
function probar_nivel_servicio_revex() { nsrProcesar(true); }

function crearTriggerNivelServicioRevex() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ejecutar_nivel_servicio_revex') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ejecutar_nivel_servicio_revex').timeBased().atHour(NSR_HORA_ENVIO).nearMinute(NSR_MINUTO_ENVIO).everyDays(1).create();
  Logger.log('Trigger creado: %s:%s (America/Santiago). El script se salta sábado y domingo.', NSR_HORA_ENVIO, NSR_MINUTO_ENVIO);
}

// ----------------------------- CORE -----------------------------------------
function nsrProcesar(forzarPrueba) {
  var hoy = new Date();
  var dow = hoy.getDay();
  if (!forzarPrueba && (dow === 0 || dow === 6)) {
    Logger.log('NSR: fin de semana, no se envía.');
    return;
  }
  var fechaStr = Utilities.formatDate(hoy, 'America/Santiago', 'dd-MM-yyyy');
  var fechaISO = Utilities.formatDate(hoy, 'America/Santiago', 'yyyy-MM-dd');

  var datos = nsrCargarDatos();
  var email = nsrConstruirCorreo(datos, fechaStr);

  var chartBlob = nsrGraficoEvolutivo(datos.mes);
  var adjuntos = [
    nsrCsvVencidos(datos.vencidos, datos.nombres, fechaISO),
    nsrCsvEnCurso(datos.enCurso, datos.nombres, fechaISO)
  ];

  var destinatarios = (forzarPrueba || NSR_MODO_PRUEBA) ? NSR_DESTINATARIOS_PRUEBA : NSR_DESTINATARIOS;
  var asunto = NSR_ASUNTO + fechaStr + ((forzarPrueba || NSR_MODO_PRUEBA) ? ' [PRUEBA]' : '');

  GmailApp.sendEmail(destinatarios.join(','), asunto, email.texto, {
    htmlBody: email.html,
    inlineImages: { evolutivo: chartBlob },
    attachments: adjuntos,
    name: 'SIT EBEMA Transporte'
  });
  Logger.log('NSR enviado a %s | asunto: %s', destinatarios.join(', '), asunto);
}

function nsrCargarDatos() {
  var general = nsrGet('v_ft_ns_general?select=*')[0] || {};
  var tipos = nsrGet('v_ft_ns_tipo?select=*&order=evaluables.desc');
  var centros = nsrGet('v_ft_ns_centro?select=*&order=centro.asc');
  var mes = nsrGet('v_ft_ns_mes?select=*&order=mes.asc');
  var cuello = nsrGet('v_ft_cuello?select=*');
  var vencidos = nsrGet('v_ft_vencidos?select=*&order=centro_responsable.asc,dias_atraso_habiles.desc');
  var enCurso = nsrGet('v_ft_en_curso?select=*&order=dias_habiles_para_vencer.asc');
  var carga = nsrGet('ind_flete_tercero?select=loaded_at&order=loaded_at.desc&limit=1');
  var nombres = {};
  nsrGet('logistics_centres?select=id,nombre').forEach(function (c) { nombres[String(c.id)] = c.nombre; });
  return { general: general, tipos: tipos, centros: centros, mes: mes, cuello: cuello, vencidos: vencidos, enCurso: enCurso,
           ultimaCarga: carga[0] ? carga[0].loaded_at : null, nombres: nombres };
}

// ----------------------------- FORMATO --------------------------------------
function nsrNum(v, dec) {
  if (v == null || v === '') return '–';
  return Number(v).toFixed(dec == null ? 0 : dec).replace('.', ',');
}
function nsrPct(v) { return v == null ? '–' : nsrNum(v, 1) + '%'; }
function nsrColorPct(v) {
  if (v == null) return NSR_COLORES.gris;
  return v < NSR_OTIF_CRITICO ? NSR_COLORES.rojo : (v < NSR_OTIF_ALERTA ? NSR_COLORES.ambar : NSR_COLORES.verde);
}
function nsrPctCelda(v) {
  return '<span style="color:' + nsrColorPct(v) + ';font-weight:bold">' + nsrPct(v) + '</span>';
}
function nsrMesCorto(m) {
  var n = { '01': 'ene', '02': 'feb', '03': 'mar', '04': 'abr', '05': 'may', '06': 'jun', '07': 'jul', '08': 'ago', '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dic' };
  return n[String(m).slice(5, 7)] + ' ' + String(m).slice(2, 4);
}
function nsrFecha(iso) { return iso ? String(iso).slice(8, 10) + '-' + String(iso).slice(5, 7) + '-' + String(iso).slice(0, 4) : ''; }
function nsrEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nsrNombre(nombres, ce) { return nombres[String(ce)] || String(ce); }
function nsrCodNombre(nombres, ce) { return nombres[String(ce)] ? String(ce) + ' - ' + nombres[String(ce)] : String(ce); }

// ------------------------------ TABLAS HTML ---------------------------------
var NSR_TD = 'padding:5px 9px;border:1px solid #D9D5CF;font-size:13px';
function nsrTabla(headers, filas, opts) {
  opts = opts || {};
  var ths = headers.map(function (h, i) {
    return '<th style="padding:5px 9px;border:1px solid #D9D5CF;background:#f2f2f2;font-size:12px;text-align:' + (i === 0 ? 'left' : 'right') + '">' + h + '</th>';
  }).join('');
  var trs = filas.map(function (f) {
    var bg = f.bg ? ';background:' + f.bg : '';
    return '<tr>' + f.celdas.map(function (c, i) {
      return '<td style="' + NSR_TD + ';text-align:' + (i === 0 ? 'left' : 'right') + bg + (f.bold ? ';font-weight:bold' : '') + '">' + c + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin:4px 0 10px">' +
         '<thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table>';
}
function nsrTitulo(t) {
  return '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#333;margin:18px 0 4px;border-left:4px solid #C0000C;padding-left:8px">' + t + '</p>';
}
function nsrNota(t) { return '<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6B6E70;margin:2px 0 8px">' + t + '</p>'; }

function nsrTablaTipo(d) {
  return nsrTabla(['Tipo de Servicio', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
    d.tipos.map(function (t) { return { celdas: [nsrEsc(t.tipo_servicio), nsrNum(t.evaluables), nsrPctCelda(t.otif_pct), nsrPctCelda(t.fill_pct)] }; })
      .concat([{ bold: true, bg: '#fafafa', celdas: ['Total general', nsrNum(d.general.evaluables), nsrPctCelda(d.general.otif_pct), nsrPctCelda(d.general.fill_pct)] }]));
}
function nsrTablaCentro(d) {
  var vencPorCentro = {};
  d.vencidos.forEach(function (r) { vencPorCentro[r.punto_expedicion] = (vencPorCentro[r.punto_expedicion] || 0) + 1; });
  var cursoPorCentro = {};
  d.enCurso.forEach(function (r) { cursoPorCentro[r.punto_expedicion] = (cursoPorCentro[r.punto_expedicion] || 0) + 1; });
  var filas = d.centros.slice().sort(function (a, b) { return b.evaluables - a.evaluables; }).map(function (c) {
    return { celdas: [nsrEsc(nsrNombre(d.nombres, c.centro)), nsrNum(c.evaluables), nsrPctCelda(c.otif_pct), nsrPctCelda(c.fill_pct),
                      vencPorCentro[c.centro] ? nsrNum(vencPorCentro[c.centro]) : '–', cursoPorCentro[c.centro] ? nsrNum(cursoPorCentro[c.centro]) : '–'] };
  });
  return nsrTabla(['Centro Destino', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %', 'Vencidos (destino)', 'En curso (destino)'], filas);
}
function nsrTablaEvolutivo(d) {
  return nsrTabla(['Mes de creación', 'Pedidos Evaluables', 'OTIF %', 'Fill Rate %'],
    d.mes.map(function (m) { return { celdas: [nsrMesCorto(m.mes), nsrNum(m.evaluables), nsrPctCelda(m.otif_pct), nsrPctCelda(m.fill_pct)] }; }));
}
function nsrTablaVencidos(d) {
  var v = d.vencidos;
  if (!v.length) return nsrNota('Sin pedidos vencidos pendientes de regularizar.');
  var grupos = {};
  v.forEach(function (r) { (grupos[r.centro_responsable] = grupos[r.centro_responsable] || []).push(r); });
  var bucket = function (n) { return n <= 5 ? 0 : n <= 20 ? 1 : n <= 60 ? 2 : 3; };
  var fila = function (g) {
    var b = [0, 0, 0, 0]; var s = 0, mx = 0;
    g.forEach(function (r) { b[bucket(r.dias_atraso_habiles)]++; s += r.dias_atraso_habiles; if (r.dias_atraso_habiles > mx) mx = r.dias_atraso_habiles; });
    return { n: g.length, prom: s / g.length, max: mx, b: b };
  };
  var filas = Object.keys(grupos).map(function (k) { var f = fila(grupos[k]); f.centro = k; return f; })
    .sort(function (a, b) { return b.n - a.n; })
    .map(function (f) {
      return { celdas: [nsrEsc(nsrNombre(d.nombres, f.centro)), '<b>' + nsrNum(f.n) + '</b>', nsrNum(f.prom, 1), nsrNum(f.max),
        nsrNum(f.b[0]), nsrNum(f.b[1]), nsrNum(f.b[2]), f.b[3] ? '<span style="color:#C0000C;font-weight:bold">' + nsrNum(f.b[3]) + '</span>' : '0'] };
    });
  var t = fila(v);
  filas.push({ bold: true, bg: '#fafafa', celdas: ['Total', nsrNum(t.n), nsrNum(t.prom, 1), nsrNum(t.max), nsrNum(t.b[0]), nsrNum(t.b[1]), nsrNum(t.b[2]), nsrNum(t.b[3])] });
  return nsrTabla(['Centro Responsable de Cierre', 'Pedidos Vencidos', 'Atraso Prom. (d háb.)', 'Atraso Máx.', '0-5 d', '6-20 d', '21-60 d', '> 60 d'], filas);
}
function nsrTablaEnCurso(d) {
  var c = d.enCurso;
  if (!c.length) return nsrNota('Sin pedidos en curso con etapas pendientes.');
  var estados = NSR_ESTADOS_CURSO.slice();
  c.forEach(function (r) { if (estados.indexOf(r.estado) < 0) estados.push(r.estado); });
  var centros = {};
  c.forEach(function (r) { (centros[r.punto_expedicion] = centros[r.punto_expedicion] || []).push(r); });
  var cnt = function (lista, e) { return lista.filter(function (r) { return r.estado === e; }).length; };
  var filas = Object.keys(centros).sort().map(function (k) {
    var g = centros[k]; var urg = g.filter(function (r) { return r.dias_habiles_para_vencer <= 1; }).length;
    return { celdas: [nsrEsc(nsrNombre(d.nombres, k))].concat(estados.map(function (e) { var n = cnt(g, e); return n ? nsrNum(n) : '–'; }),
      ['<b>' + nsrNum(g.length) + '</b>', urg ? '<span style="color:#C0000C;font-weight:bold">' + nsrNum(urg) + '</span>' : '–']) };
  });
  var urgT = c.filter(function (r) { return r.dias_habiles_para_vencer <= 1; }).length;
  filas.push({ bold: true, bg: '#fafafa', celdas: ['Total'].concat(estados.map(function (e) { return nsrNum(cnt(c, e)); }), [nsrNum(c.length), nsrNum(urgT)]) });
  return nsrTabla(['Centro Destino'].concat(estados, ['Total', 'Vencen ≤ 1 d háb.']), filas);
}

// ------------------------------ CORREO --------------------------------------
function nsrConstruirCorreo(d, fechaStr) {
  var vieja = d.ultimaCarga && (new Date().getTime() - new Date(d.ultimaCarga).getTime()) / 3600000 > NSR_DATOS_VIEJOS_HORAS;
  var cargaTxt = d.ultimaCarga ? Utilities.formatDate(new Date(d.ultimaCarga), 'America/Santiago', 'dd-MM-yyyy HH:mm') : 'sin dato';

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;color:#333">' +
    '<p style="font-size:16px;font-weight:bold;margin:0 0 2px">Nivel de Servicio REVEX (Flete Tercero) – ' + fechaStr + '</p>' +
    '<p style="font-size:11px;color:#6B6E70;margin:0 0 8px">Datos cargados: ' + cargaTxt + '. Retira = disponible en sucursal (Recepción Sucursal); Despacho = entrega al cliente. Pedidos evaluables = con evento cumplido o vencidos sin cumplir.</p>' +
    (vieja ? '<p style="background:#fff3cd;border:1px solid #ffe08a;padding:6px 10px;font-size:12px;color:#7a5b00">⚠ La última carga de datos tiene más de ' + NSR_DATOS_VIEJOS_HORAS + ' h: revisar la automatización de Indicadores antes de usar estas cifras.</p>' : '') +
    nsrTitulo('1. Nivel de Servicio por Tipo de Servicio') + nsrTablaTipo(d) +
    nsrTitulo('2. Nivel de Servicio por Centro Destino') + nsrTablaCentro(d) +
    nsrNota('Vencidos / En curso (destino): pedidos con destino a ese centro, sin importar quién deba cerrar la etapa pendiente (ver cuadros 4 y 5).') +
    nsrTitulo('3. Evolutivo mensual de Nivel de Servicio (mes de creación)') +
    '<img src="cid:evolutivo" alt="Evolutivo mensual OTIF y Fill Rate" style="max-width:780px;width:100%;border:1px solid #D9D5CF">' +
    nsrTablaEvolutivo(d) +
    nsrTitulo('4. Pedidos Vencidos No Regularizados por Centro') +
    nsrNota('Pedidos con fecha promesa vencida y etapas físicas pendientes. Pendiente = falta alguna etapa hasta la Entrega Cliente (un pedido Retira ya en sucursal sigue pendiente hasta que el cliente retira; el OTIF sí cierra en sucursal). Responsable de cierre: CD 1003 si falta Recepción CD/Traslado; si no, el centro destino. Detalle completo en el CSV adjunto <b>Pedidos_Vencidos</b>.') +
    nsrTablaVencidos(d) +
    nsrTitulo('5. Pedidos en Curso y sus Estados') +
    nsrNota('Pedidos dentro de plazo que aún no cierran su ciclo. Detalle completo (ordenado por urgencia) en el CSV adjunto <b>Pedidos_en_Curso</b>.') +
    nsrTablaEnCurso(d) +
    '<p style="font-size:11px;color:#6B6E70;margin-top:16px">Vista en línea: plataforma SIT EBEMA Transporte → Flete Tercero (Nivel de Servicio, Pedidos Vencidos, Pedidos en Curso). Cualquier ajuste de regla o destinatarios, coordinar con Jordan Candia.</p>' +
    '</div>';

  // Texto plano (fallback)
  var txt = 'NIVEL DE SERVICIO REVEX - ' + fechaStr + '\n\n' +
    'OTIF general ' + nsrPct(d.general.otif_pct) + ' | Fill Rate ' + nsrPct(d.general.fill_pct) + ' | Pedidos evaluables ' + nsrNum(d.general.evaluables) + '\n' +
    'Pedidos vencidos no regularizados: ' + nsrNum(d.vencidos.length) + ' | Pedidos en curso: ' + nsrNum(d.enCurso.length) + '\n\n' +
    'Revisa el correo en formato HTML para ver los cuadros y el gráfico; los detalles de Pedidos Vencidos y Pedidos en Curso van adjuntos en CSV.';
  return { html: html, texto: txt };
}

// ------------------------------ GRÁFICO -------------------------------------
function nsrGraficoEvolutivo(mes) {
  var dt = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Mes')
    .addColumn(Charts.ColumnType.NUMBER, 'OTIF %')
    .addColumn(Charts.ColumnType.NUMBER, 'Fill Rate %');
  mes.forEach(function (m) { dt.addRow([nsrMesCorto(m.mes), m.otif_pct == null ? null : Number(m.otif_pct), m.fill_pct == null ? null : Number(m.fill_pct)]); });
  return Charts.newLineChart()
    .setDataTable(dt.build())
    .setTitle('Evolutivo mensual de nivel de servicio (OTIF y Fill Rate, %)')
    .setDimensions(780, 300)
    .setColors([NSR_COLORES.rojo, NSR_COLORES.gris])
    .setPointStyle(Charts.PointStyle.MEDIUM)
    .setLegendPosition(Charts.Position.BOTTOM)
    .setRange(0, 100)
    .build()
    .getAs('image/png')
    .setName('evolutivo.png');
}

// ------------------------------ CSV -----------------------------------------
function nsrCsvCell(v) {
  if (v == null) return '';
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function nsrCsvBlob(nombre, headers, filas) {
  var lines = [headers.join(',')].concat(filas.map(function (f) { return f.map(nsrCsvCell).join(','); }));
  return Utilities.newBlob('﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', nombre);
}
function nsrCsvVencidos(v, nombres, fechaISO) {
  return nsrCsvBlob('Pedidos_Vencidos_' + fechaISO + '.csv',
    ['Centro Responsable', 'ID Pedido', 'Centro Destino', 'Condicion Expedicion', 'Ruta Flete', 'Material', 'Cantidad Bultos', 'Fecha Creacion', 'Fecha Promesa', 'Dias Atraso (habiles)', 'Estado Actual', 'Etapas Pendientes'],
    v.map(function (r) { return [nsrCodNombre(nombres, r.centro_responsable), r.id_pedido, nsrCodNombre(nombres, r.punto_expedicion), r.condicion_expedicion, r.ruta_flete, r.material, r.cantidad_bultos,
      nsrFecha(r.fecha_creacion), nsrFecha(r.fecha_promesa), r.dias_atraso_habiles, r.estado, r.etapas_pendientes]; }));
}
function nsrCsvEnCurso(c, nombres, fechaISO) {
  return nsrCsvBlob('Pedidos_en_Curso_' + fechaISO + '.csv',
    ['Centro Responsable', 'ID Pedido', 'Centro Destino', 'Condicion Expedicion', 'Ruta Flete', 'Material', 'Cantidad Bultos', 'Fecha Creacion', 'Fecha Promesa', 'Dias Habiles para Vencer', 'Estado Actual', 'Etapas Pendientes'],
    c.map(function (r) { return [nsrCodNombre(nombres, r.centro_responsable), r.id_pedido, nsrCodNombre(nombres, r.punto_expedicion), r.condicion_expedicion, r.ruta_flete, r.material, r.cantidad_bultos,
      nsrFecha(r.fecha_creacion), nsrFecha(r.fecha_promesa), r.dias_habiles_para_vencer, r.estado, r.etapas_pendientes]; }));
}

// ---------------------- HELPERS SUPABASE (REST) -------------------------------
function nsrKey() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta la propiedad de script SUPABASE_SERVICE_KEY');
  return k;
}
function nsrGet(path) {
  var k = nsrKey();
  var res = UrlFetchApp.fetch(NSR_SUPABASE_URL + '/rest/v1/' + path, {
    method: 'get', headers: { apikey: k, Authorization: 'Bearer ' + k }, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('GET ' + path + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '[]');
}
