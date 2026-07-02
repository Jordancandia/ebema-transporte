// Motor Actuarial — Administrador de Tarifas Transporte (SIT EBEMA)
// Implementa, ruta por ruta y tipo de camión por tipo de camión, el cálculo
// de costos definido en "PANTALLA 1: ADMINISTRADOR DE TARIFAS TRANSPORTE".
import { truckCapKg, getGroupRepId } from './data.js?v=20260630a';

// Capacidades nominales soportadas (kg)
export const CAP_LIST = [5000, 10000, 15000, 28000];

// Devuelve la lista de tipos de camión del catálogo con su capacidad en kg.
// Si se indica centroId, filtra solo las tarifas de ese centro logístico (Id_centro).
export function truckTypesWithCap(db, centroId) {
  const cfgId = centroId ? getGroupRepId(db, centroId) : null;
  const tipos = cfgId
    ? db.truckTypes.filter(t => t.Id_centro === cfgId)
    : db.truckTypes;
  return tipos.map(t => ({ ...t, capKg: truckCapKg(t.type) }));
}

// Calcula el detalle completo de costos (12 pasos del motor actuarial) para
// una ruta + capacidad de camión (kg) determinadas.
export function calcularCostoRuta(db, cfg, ruta, capKg) {
  const centroId = ruta.origenId;
  // Configuración compartida por Centro Origen (grupo): resuelve "por detrás"
  // al centro representante del grupo (ej. Santiago = 1001/1002/1003 -> 1003).
  const cfgId = getGroupRepId(db, centroId);
  const km = Number(ruta.km) || 0;
  const capKey = String(capKg);
  const kmKey = `${cfgId}|${capKey}`;

  // --- 1. Peajes (según ejes del camión: 2 ó 3) ---
  // Prioridad: route_tolls (cálculo automático vía Google Routes API, ida/vuelta
  // independientes). Si la ruta no tiene cálculo registrado, se usa el respaldo
  // del registro manual de plazas de peaje (cfg.peajes, simétrico ida/vuelta).
  const ejes = cfg.ejes[capKey] || 2;
  const tollRow = (db.routeTolls || []).find(rt => rt.route_id === ruta.id && Number(rt.ejes) === ejes);
  let peajeIda, peajeVuelta;
  if (tollRow) {
    peajeIda = Number(tollRow.peaje_ida) || 0;
    peajeVuelta = Number(tollRow.peaje_vuelta) || 0;
  } else {
    const peajesRuta = (cfg.peajes || []).filter(p => p.rutaId === ruta.id && Number(p.ejes) === ejes);
    peajeIda = peajesRuta.reduce((s, p) => s + (Number(p.valorPeaje) || 0), 0);
    peajeVuelta = peajeIda;
  }
  const item1_peajes = peajeIda + peajeVuelta;

  // --- 1b. Costos Extra por ruta (BARCAZA, TRAVESÍA, acarreo, etc.) ---
  // Ítems configurados manualmente en la pestaña "Costos Extras", por ruta y tipo de eje.
  // Se suman directamente a los costos de ida y vuelta antes del factor de ruta.
  const extraCostsRuta = (db.extraCosts || []).filter(c =>
    c.route_id === ruta.id && Number(c.ejes) === ejes && c.activo !== false
  );
  const itemExtraIda    = extraCostsRuta.reduce((s, c) => s + (Number(c.costo_ida)    || 0), 0);
  const itemExtraVuelta = extraCostsRuta.reduce((s, c) => s + (Number(c.costo_vuelta) || 0), 0);
  const item1b_costosExtra = itemExtraIda + itemExtraVuelta;

  // --- 2. Combustible (cargado ida + vacío vuelta) ---
  // Se descuenta el IVA al precio: precio neto = precioLitro / (1 + ivaPct/100)
  const rend = cfg.rendimientos[capKey] || { cargado: 1, vacio: 1 };
  const fuel = cfg.combustibles[cfgId] || {};
  const precioLitro = Number(fuel.precioLitro) || 0;
  const ivaPct = fuel.ivaPct != null ? Number(fuel.ivaPct) : 19; // default 19% si no está configurado
  const precioLitroNeto = ivaPct > 0 ? precioLitro / (1 + ivaPct / 100) : precioLitro;
  const combIda = rend.cargado > 0 ? (km / rend.cargado) * precioLitroNeto : 0;
  const combVuelta = rend.vacio > 0 ? (km / rend.vacio) * precioLitroNeto : 0;
  const item2_combustible = combIda + combVuelta;

  // KM mensuales/anuales ofrecidos (denominador de prorrateos)
  const kmMensual = Number(cfg.kmOfrecidos[kmKey]) || 0;
  const kmAnual = kmMensual * 12;

  // --- 3. SOAP por KM ---
  const permisoSoap = cfg.permisosSoap[kmKey] || { permiso: 0, soap: 0 };
  const item3_soapKm = kmAnual > 0 ? (Number(permisoSoap.soap || 0) / kmAnual) * km : 0;

  // --- 4. Seguro de carga por KM ---
  const ufVal = Number(cfg.variables.valorUF) || 0;
  const seguroUFmensual = Number(cfg.seguros[cfgId]) || 0;
  const seguroCLPmensual = seguroUFmensual * ufVal;
  const item4_seguroKm = kmMensual > 0 ? (seguroCLPmensual / kmMensual) * km : 0;

  // --- 5. Mantención por KM ---
  const costoMantencion = Number((cfg.variables.mantencion.costos || {})[kmKey]) || 0;
  const cicloMantencion = Number(cfg.variables.mantencion.ciclo) || 20000;
  const item5_mantKm = kmAnual > 0 ? ((kmAnual / cicloMantencion) * costoMantencion / kmAnual) * km : 0;

  // --- 6. Neumáticos por KM ---
  const costoNeumaticos = Number((cfg.variables.neumaticos.costos || {})[capKey]) || 0;
  const cicloNeumaticos = Number(cfg.variables.neumaticos.ciclo) || 50000;
  const item6_neumKm = kmAnual > 0 ? ((kmAnual / cicloNeumaticos) * costoNeumaticos / kmAnual) * km : 0;

  // --- 7. GPS / Celular por KM (prorrateo justo) ---
  const gpsCostoUF = Number(cfg.variables.gps.costoUF) || 0.45;
  const item7_gpsKm = kmMensual > 0 ? (((gpsCostoUF * ufVal) / kmMensual) * km) : 0;

  // --- 8. Chofer: base diaria ---
  const sueldoMin = Number((cfg.variables.chofer.sueldoMinimo || {})[cfgId]) || 0;
  const diasHabiles = Number(cfg.variables.chofer.diasHabiles) || 22;
  const item8_choferBaseDiario = diasHabiles > 0 ? sueldoMin / diasHabiles : 0;

  // --- 9. Variable Chofer (comisión sobre costos directos del tramo de ida) ---
  const comisionPct = Number(cfg.variables.chofer.comisionPct) || 0;
  const baseComision = peajeIda + itemExtraIda + combIda + item3_soapKm + item4_seguroKm + item5_mantKm + item6_neumKm + item7_gpsKm;
  const item9_varChofer = baseComision * (comisionPct / 100);

  // --- 10. Costo Vuelta (Σ ítems × Factor Ruta geográfico) ---
  const factorRuta = (cfg.variables.factorRuta || {})[ruta.caracteristica] ?? 1;
  const margenPct = Number(cfg.variables.margenGanancia) || 0;
  const sumItems = item1_peajes + item1b_costosExtra + item2_combustible + item3_soapKm + item4_seguroKm +
    item5_mantKm + item6_neumKm + item7_gpsKm + item8_choferBaseDiario + item9_varChofer;
  const costoVuelta = sumItems * factorRuta;

  // --- 10b. Costo Ruta Total (costo vuelta + margen del transportista sobre precio de venta) ---
  // Fórmula: costoVuelta / (1 - margen%) — margen calculado sobre precio, no sobre costo.
  const divisorMargen = margenPct < 100 ? (1 - margenPct / 100) : 1;
  const item10_costoRutaTotal = costoVuelta / divisorMargen;

  // --- 11. Costo por KM Final (incluye factor ruta + margen) ---
  const item11_costoKmFinal = km > 0 ? item10_costoRutaTotal / (km * 2) : 0;

  // --- 12. ZCAP: Expectativa de pago al transportista (con margen incorporado) ---
  const item12_zcap = item11_costoKmFinal * km;

  return {
    rutaId: ruta.id, centroId, capKg, km, ejes,
    peajeIda, peajeVuelta, item1_peajes,
    extraCostsRuta, itemExtraIda, itemExtraVuelta, item1b_costosExtra,
    combIda, combVuelta, item2_combustible,
    item3_soapKm, item4_seguroKm, item5_mantKm, item6_neumKm, item7_gpsKm,
    item8_choferBaseDiario, 