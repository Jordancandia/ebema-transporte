// Motor del Cotizador Multi-tramo — SIT EBEMA (27-sep-2026)
// ---------------------------------------------------------------------------
// Calcula el PRECIO AL CLIENTE de un flete separando los tramos:
//   1. Retiro (primera milla)      — sólo venta CALZADA
//   2. Traslado 1 / 2 (troncal)    — CD origen ≠ CD destino, siempre Camión 28 Ton
//   3. Última milla                — $0 si el cliente retira en CD
// y aplica las reglas de minimización:
//   Regla A: retiro y despacho del mismo CD → compara "vía CD" vs "directo punto a punto"
//   Regla B: retiro → compara tarifa local (consolidado) vs tarifa fija de retiro troncal
//   Regla C: cliente retira en CD → última milla $0; retira en fábrica → todo $0
//
// FUENTE ÚNICA DE TARIFAS: las mismas fórmulas de la vista Tarifas Clientes
// (subvistas ZFMP $/kg y ZFMI) — ZCAP (buildZcapMap), factor de consolidación,
// ZFMP = ZCAP ÷ kilos a consolidar, ZFMI = ZCAP camión mínimo ÷ pedidos promedio
// del cluster, Tarifa Express = ZCAP × (1 + recargo exclusividad del centro).
// ---------------------------------------------------------------------------
import { getOrigenGroups, truckCapKg } from './data.js?v=202610051235';
import { buildZcapMap } from './zcap.js?v=202610051235';

export const TRUCK_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];
export const TRUCK_TRONCAL = 'Camión 28 Ton';
export const HUB_GRUPO = 'SANTIAGO'; // Hub troncal: CD Quilicura

// Umbrales de camión directo (mismos del Plan de Carga, 21-sep-2026)
export const UMBRAL_DIRECTO_CALZADA = 0.9; // FABRICA-CLIENTE / FABRICA-SUCURSAL
export const UMBRAL_DIRECTO_STOCK = 0.8;   // CD-CLIENTE

// Entrega en ruta troncal: el troncal deja la carga en la comuna de destino si
// queda en su camino (desvío ≤ 10 km) y la carga supera 1.800 kg; se cobra el
// troncal proporcional hasta la comuna + cargo fijo, sin última milla.
export const DESVIO_MAX_KM = 10;
export const KILOS_MIN_EN_RUTA = 1800;
export const CARGO_ENTREGA_EN_RUTA = 20000;
// Tarifa fija de retiro troncal: sólo comunas RM con ruta de retiro < 35 km
export const KM_MAX_RETIRO_TRONCAL = 35;

// Camión que queda lleno sobre el umbral con los kilos cotizados (o n camiones 28 Ton)
export function elegirCamionDirecto(kilos, umbral) {
  const caps = { 'Camión 5 Ton': 5000, 'Camión 10 Ton': 10000, 'Camión 15 Ton': 15000, 'Camión 28 Ton': 28000 };
  for (const tipo of TRUCK_ORDER) {
    const cap = caps[tipo];
    if (kilos <= cap) return kilos > umbral * cap ? { tipo, n: 1, fill: kilos / cap } : null;
  }
  const n = Math.ceil(kilos / 28000);
  const fill = kilos / (n * 28000);
  return fill > umbral ? { tipo: TRUCK_TRONCAL, n, fill } : null;
}

// Tarifa fija de retiro con camión troncal (Regla B) — valores iniciales del
// requerimiento. Se administran desde el Cotizador (OWNER) y se guardan en
// client_tariff_config.data.retiroTroncal.
export const RETIRO_TRONCAL_DEFAULT = {
  'ANTOFAGASTA': 150000,
  'COQUIMBO': 50000,
  'LA CALERA': 50000,
  'SANTIAGO': 50000,
  'SAN BERNARDO': 50000,
  'CHILLAN': 50000,
  'CONCEPCION': 50000,
  'TEMUCO': 50000,
  'PUERTO MONTT': 50000,
  'RANCAGUA': 30000,
  'TALCA': 30000
};

// ── Helpers ────────────────────────────────────────────────────────────────
export function normComuna(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function getPath(obj, path, fallback) {
  return path.split('.').reduce((c, p) => (c == null ? fallback : c[p]), obj) ?? fallback;
}

// Recargo de exclusividad (%) por centro. Acepta número (formato actual de la
// vista Frecuencia y Especiales) u objeto { pct, activo }.
function recargoExclusividad(ccfg, grupo, repId) {
  const tabla = ccfg?.especiales?.recargoExclusividad || {};
  const grupoKey = String(grupo || '').replace(/\s/g, '_');
  const v = tabla[grupoKey] ?? tabla[grupo] ?? (repId != null ? tabla[String(repId)] : undefined);
  if (v == null) return 0;
  if (typeof v === 'object') return v.activo === false ? 0 : (Number(v.pct) || 0);
  return Number(v) || 0;
}

export function getRetiroTroncalTarifas(ccfg) {
  return { ...RETIRO_TRONCAL_DEFAULT, ...((ccfg && ccfg.retiroTroncal) || {}) };
}

// Grupo (Centro Origen) de una ruta. Las rutas cargadas desde Supabase traen
// origen_grupo = null, por eso se resuelve siempre desde origenId.
function grupoDeRuta(db, ruta, centroGrupo) {
  return centroGrupo.get(String(ruta.origenId)) || ruta.origen_grupo || '';
}

// ── Índice Tarifa Cliente por ruta × camión ────────────────────────────────
export function buildTarifaClienteIndex(db, cfg, ccfg) {
  const centroGrupo = new Map((db.logisticsCentres || []).map(c => [String(c.id), c.origen_grupo || String(c.id)]));
  const grupos = getOrigenGroups(db);
  const repIdDe = new Map(grupos.map(g => [g.grupo, g.repId]));
  const zcapMap = buildZcapMap(db, cfg);

  // Camión mínimo (menor capacidad) por grupo — base del ZFMI
  const minCap = new Map();
  zcapMap.forEach(({ truck, ruta }) => {
    const g = grupoDeRuta(db, ruta, centroGrupo);
    const cap = truckCapKg(truck.type);
    if (!minCap.has(g) || cap < minCap.get(g)) minCap.set(g, cap);
  });

  const idx = new Map(); // codigo → entry
  zcapMap.forEach(({ zcap, truck, ruta }) => {
    const grupo = grupoDeRuta(db, ruta, centroGrupo);
    const grupoKey = grupo.replace(/\s/g, '_');
    const codigo = ruta.codigo || String(ruta.id || '');
    const cap = truckCapKg(truck.type);
    const bkt = cap / 1000;
    const factorPct = Number(getPath(ccfg, `consolidacionObjetivo.${grupoKey}.${bkt}`, null) ?? ((grupoKey === 'SANTIAGO' || grupoKey === 'SAN_BERNARDO') ? getPath(ccfg, `consolidacionObjetivo.SANTIAGO_+_SAN_BERNARDO.${bkt}`, 80) : 80)) || 80;
    const kilosConsolidar = cap * (factorPct / 100);
    const zcapN = Number(zcap) || 0;
    const zfmp = (zcapN > 0 && kilosConsolidar > 0) ? zcapN / kilosConsolidar : null;
    const recargoPct = recargoExclusividad(ccfg, grupo, repIdDe.get(grupo));
    const tarifaExpress = zcapN > 0 ? zcapN * (1 + recargoPct / 100) : null;

    let e = idx.get(codigo);
    if (!e) {
      e = { codigo, ruta, grupo, km: Number(ruta.km) || 0, trucks: {}, zfmi: null, kilosTarifaMin: null, pedidosPromedio: 1, cluster: '' };
      idx.set(codigo, e);
    }
    e.trucks[truck.type] = { type: truck.type, cap, zcap: zcapN, factorPct, kilosConsolidar, zfmp, recargoPct, tarifaExpress };
    if (cap === minCap.get(grupo) && !e._zfmiSrc) e._zfmiSrc = { zcap: zcapN, kilosMin: kilosConsolidar, type: truck.type };
  });

  idx.forEach(e => {
    const cc = ccfg?.comunaCluster || {};
    const cluster = cc[String(e.ruta.id || '')] || cc[String(e.ruta.codigo || '')] || '';
    const clObj = (ccfg?.clusters || []).find(c => c.key === cluster);
    const pp = Number(clObj?.nv) || 1;
    e.cluster = cluster;
    e.pedidosPromedio = pp;
    if (e._zfmiSrc && e._zfmiSrc.zcap > 0 && e._zfmiSrc.kilosMin > 0) {
      e.kilosTarifaMin = e._zfmiSrc.kilosMin / pp;
      e.zfmi = e._zfmiSrc.zcap / pp;
    }
    delete e._zfmiSrc;
  });
  return idx;
}

// ── Contexto: índices de rutas, comunas y CD ───────────────────────────────
export function buildCotizadorContext(db, cfg, ccfg) {
  const tarifas = buildTarifaClienteIndex(db, cfg, ccfg);
  const centroGrupo = new Map((db.logisticsCentres || []).map(c => [String(c.id), c.origen_grupo || String(c.id)]));
  const grupos = getOrigenGroups(db);

  // Comuna del CD representante de cada grupo (ej. SANTIAGO → QUILICURA)
  const grupoInfo = new Map();
  grupos.forEach(g => {
    const rep = (db.logisticsCentres || []).find(c => c.id === g.repId) || g.centros[0];
    grupoInfo.set(g.grupo, {
      grupo: g.grupo, nombre: g.nombre, repId: g.repId,
      comuna: normComuna(rep?.comuna || ''),
      lat: rep?.lat ?? null, lon: rep?.lon ?? null,
      cdNombre: rep?.nombre || g.nombre
    });
  });

  // Rutas activas con tarifa por (grupo | comuna destino)
  const rutaPorGrupoDest = new Map();
  // Control de calidad: rutas cuyo km es menor al 90% de la distancia en línea
  // recta desde su centro de origen (ej. km medidos desde otro centro). NO se
  // excluyen: se usan igual y la cotización muestra una alerta si las ocupa.
  const cdCoords = new Map((db.logisticsCentres || []).map(c => [String(c.id), c]));
  const inconsistentes = new Map(); // codigo → { codigo, km, lineal }
  const comunas = new Map(); // norm → { nombre, lat, lon, cds: [{grupo, km, codigo}] }
  (db.routes || []).filter(r => r.activo).forEach(r => {
    const codigo = r.codigo || String(r.id || '');
    const entry = tarifas.get(codigo);
    if (!entry) return;
    const grupo = centroGrupo.get(String(r.origenId)) || r.origen_grupo || '';
    const dn = normComuna(r.destino);
    const cd = cdCoords.get(String(r.origenId));
    if (cd && cd.lat != null && r.lat != null) {
      const lineal = haversineKm(Number(cd.lat), Number(cd.lon), Number(r.lat), Number(r.lon));
      const km = Number(r.km) || 0;
      if (lineal > 30 && km < lineal * 0.9) {
        inconsistentes.set(codigo, { codigo, km, lineal: Math.round(lineal) });
      }
    }
    const key = grupo + '|' + dn;
    const prev = rutaPorGrupoDest.get(key);
    // Preferir tipo Comuna sobre Sector, luego menor km
    const better = !prev
      || (prev.ruta.tipo !== 'Comuna' && r.tipo === 'Comuna')
      || (prev.ruta.tipo === r.tipo && (Number(r.km) || 0) < prev.km);
    if (better) rutaPorGrupoDest.set(key, entry);

    let c = comunas.get(dn);
    if (!c) { c = { norm: dn, nombre: r.destino, lat: null, lon: null, region: '', cds: [] }; comunas.set(dn, c); }
    if (!c.region && r.region) c.region = r.region;
    if (c.lat == null && r.lat != null && r.lon != null) { c.lat = Number(r.lat); c.lon = Number(r.lon); }
    if (r.clasificRuta === 'Regional' && !c.cds.some(x => x.grupo === grupo)) {
      c.cds.push({ grupo, km: Number(r.km) || 0, codigo });
    }
  });
  comunas.forEach(c => c.cds.sort((a, b) => a.km - b.km));

  // Comuna del centro según nombre en las rutas: si no hay rutas con el nombre
  // exacto (ej. centro "La Calera" vs rutas "CALERA"), se prueba sin artículo y,
  // si aún no calza, se usa el destino con ruta Regional más cercano al centro.
  const destinosConRuta = new Set([...rutaPorGrupoDest.keys()].map(k => k.slice(k.indexOf('|') + 1)));
  grupoInfo.forEach(g => {
    if (!g.comuna || destinosConRuta.has(g.comuna)) return;
    const sinArticulo = g.comuna.replace(/^(LA|EL|LOS|LAS) /, '');
    if (destinosConRuta.has(sinArticulo)) { g.comuna = sinArticulo; return; }
    if (g.lat == null || g.lon == null) return;
    let mejor = null;
    comunas.forEach(c => {
      if (c.lat == null || !c.cds.some(x => x.grupo === g.grupo)) return;
      const dd = (c.lat - g.lat) ** 2 + (c.lon - g.lon) ** 2;
      if (!mejor || dd < mejor.dd) mejor = { dd, norm: c.norm };
    });
    if (mejor) g.comuna = mejor.norm;
  });

  return { tarifas, grupoInfo, rutaPorGrupoDest, comunas, ccfg, inconsistentes };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function findRuta(ctx, grupo, comunaNorm) {
  return ctx.rutaPorGrupoDest.get(grupo + '|' + comunaNorm) || null;
}

// CD responsable de una comuna = centro con ruta REGIONAL a esa comuna (menor km).
export function resolverCD(ctx, comuna) {
  const c = ctx.comunas.get(normComuna(comuna));
  if (!c || !c.cds.length) return null;
  return c.cds[0].grupo;
}

export function cdsDeComuna(ctx, comuna) {
  const c = ctx.comunas.get(normComuna(comuna));
  return c ? c.cds.map(x => x.grupo) : [];
}

// Camión según kilos: el menor con capacidad ≥ kilos; sobre 28 t → 28 Ton.
export function camionPorKilos(kilos) {
  return TRUCK_ORDER.find(t => truckCapKg(t) >= kilos) || TRUCK_TRONCAL;
}

const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');
const fmtKg = n => Math.round(n).toLocaleString('es-CL') + ' kg';
const fmtKgRate = n => '$' + (Math.round(n * 100) / 100).toLocaleString('es-CL') + '/kg';

// ── Precio tramo local CONSOLIDADO (retiro o última milla) ─────────────────
// Precio = MAX(ZFMI, MIN(kilos × ZFMP camión, ZCAP camión))
//   · Camión según kilos (5/10/15/28). Sobre 28 t: kilos × ZFMP 28T sin tope.
//   · El camión se define sólo por los kilos (menor capacidad ≥ kilos).
export function precioLocalConsolidado(entry, kilos) {
  if (!entry) return null;
  const trucks = TRUCK_ORDER.map(t => entry.trucks[t]).filter(t => t && t.zcap > 0 && t.zfmp);
  if (!trucks.length) return null;
  let t = trucks.find(x => x.cap >= kilos);
  const sobre28 = !t;
  if (!t) t = trucks[trucks.length - 1];

  const bruto = kilos * t.zfmp;
  let precio, regla;
  if (sobre28) {
    precio = bruto;
    regla = `Sobre ${fmtKg(t.cap)}: ${fmtKg(kilos)} × ZFMP ${fmtKgRate(t.zfmp)} (${t.type}, sin tope)`;
  } else if (bruto >= t.zcap) {
    precio = t.zcap;
    regla = `Tope ZCAP ${t.type} (camión completo)`;
  } else {
    precio = bruto;
    regla = `${fmtKg(kilos)} × ZFMP ${fmtKgRate(t.zfmp)} (${t.type})`;
  }
  const zfmi = entry.zfmi || 0;
  if (precio < zfmi) {
    precio = zfmi;
    regla = `Tarifa mínima (${t.type})`;
  }
  return { precio: Math.round(precio), regla, camion: t.type, ruta: entry.codigo, zfmp: t.zfmp, zcap: t.zcap, zfmi };
}

// ── Precio tramo local EXCLUSIVO: camión dedicado según kilos, Tarifa Express ──
export function precioLocalExclusivo(entry, kilos) {
  if (!entry) return null;
  const tipo = camionPorKilos(kilos);
  const t = entry.trucks[tipo];
  if (!t || !t.tarifaExpress) return null;
  const n = Math.max(1, Math.ceil(kilos / t.cap));
  return {
    precio: Math.round(t.tarifaExpress * n),
    regla: `Tarifa Express ${t.type}${n > 1 ? ' × ' + n : ''} = ZCAP ${fmt(t.zcap)} × (1 + ${t.recargoPct}%)`,
    camion: t.type, ruta: entry.codigo
  };
}

// ── Precio tramo troncal: proporcional kilos × ZFMP 28T, sin mínimo ────────
export function precioTroncal(entry, kilos) {
  if (!entry) return null;
  const t = entry.trucks[TRUCK_TRONCAL]
    || TRUCK_ORDER.slice().reverse().map(x => entry.trucks[x]).find(x => x && x.zfmp);
  if (!t || !t.zfmp) return null;
  // Proporcional kilos × $/kg sin mínimo, con tope en el ZCAP del camión
  // (sobre 28 t, tope = n camiones × ZCAP).
  const bruto = kilos * t.zfmp;
  const n = Math.max(1, Math.ceil(kilos / t.cap));
  const tope = t.zcap > 0 ? t.zcap * n : Infinity;
  const conTope = bruto > tope;
  return {
    precio: Math.round(conTope ? tope : bruto),
    regla: conTope
      ? `Tope ZCAP ${t.type}${n > 1 ? ' × ' + n : ''} (camión completo)`
      : `${fmtKg(kilos)} × ZFMP ${fmtKgRate(t.zfmp)} (${t.type}, proporcional sin mínimo)`,
    camion: t.type, ruta: entry.codigo, zfmp: t.zfmp, zcap: t.zcap
  };
}

// ── Cotización principal ───────────────────────────────────────────────────
// El usuario sólo indica origen y destino; el motor elige internamente los
// nodos (CD de retiro, CD de última milla y ruta troncal) de menor precio.
// input = {
//   tipoNegocio: 'STOCK' | 'CALZADA',
//   servicio:    'consolidado' | 'exclusivo',
//   cdOrigen:    grupo (STOCK) — CD donde está el stock
//   comunaRetiro (CALZADA), comunaDespacho
//   kilos, camion (exclusivo, opcional → automático por kilos)
//   retira: 'NO' | 'CD' | 'FABRICA'
//   kmDirecto: km carretera retiro → despacho (Regla A, opcional)
// }
const nombreG = (ctx, g) => ctx.grupoInfo.get(g)?.nombre || g;

// CD candidatos para una comuna: todos los centros con ruta tarifada a ella
function candidatos(ctx, comunaNorm) {
  return [...ctx.grupoInfo.keys()].filter(g => findRuta(ctx, g, comunaNorm));
}
function esRegional(ctx, g, comunaNorm) {
  const c = ctx.comunas.get(comunaNorm);
  return !!c && c.cds.some(x => x.grupo === g);
}

// Mejor traslado troncal entre dos nodos: directo CD→CD o vía Hub Quilicura
function mejorTroncal(ctx, o, d, kilos) {
  if (o === d) return { monto: 0, legs: [], nombre: 'Sin troncal' };
  const infoD = ctx.grupoInfo.get(d);
  const alts = [];
  const pDir = precioTroncal(findRuta(ctx, o, infoD?.comuna), kilos);
  if (pDir) alts.push({ monto: pDir.precio, legs: [pDir], nombre: `Troncal directo ${nombreG(ctx, o)} → ${nombreG(ctx, d)}` });
  if (o !== HUB_GRUPO && d !== HUB_GRUPO) {
    const hub = ctx.grupoInfo.get(HUB_GRUPO);
    const p1 = precioTroncal(findRuta(ctx, o, hub?.comuna), kilos);
    const p2 = precioTroncal(findRuta(ctx, HUB_GRUPO, infoD?.comuna), kilos);
    if (p1 && p2) alts.push({ monto: p1.precio + p2.precio, legs: [p1, p2], nombre: `Troncal ${nombreG(ctx, o)} → Hub Quilicura → ${nombreG(ctx, d)}` });
  }
  if (!alts.length) return null;
  alts.sort((a, b) => a.monto - b.monto);
  return alts[0];
}

// Mejor retiro desde un nodo: primera milla local vs tarifa fija troncal (Regla B,
// sólo para la comuna dentro de la zona Regional del centro)
// Regla B: el retiro lo puede hacer el camión troncal que va al centro de
// DESTINO de la carga (ej. retiro en Pudahuel con destino Talca → troncal de
// Talca, $30.000). Sin troncal (mismo centro) aplica la tarifa del centro de retiro.
function mejorRetiro(ctx, o, nRet, kilos, d) {
  const opciones = [];
  const local = precioLocalConsolidado(findRuta(ctx, o, nRet), kilos);
  if (local) opciones.push({ monto: local.precio, regla: local.regla, ruta: local.ruta, camion: local.camion, tipo: 'local' });
  const cdTroncal = d && d !== o ? d : o;
  const fija = Number(getRetiroTroncalTarifas(ctx.ccfg)[cdTroncal]) || 0;
  // Sólo para retiros en comunas de la Región Metropolitana
  const enRM = /metropolitana/i.test(ctx.comunas.get(nRet)?.region || '');
  // ...y sólo si la ruta del centro a la comuna de retiro tiene menos de 35 km
  const kmRetiro = Number(findRuta(ctx, o, nRet)?.km) || Infinity;
  if (fija > 0 && enRM && kmRetiro < KM_MAX_RETIRO_TRONCAL && esRegional(ctx, o, nRet)) {
    opciones.push({ monto: Math.round(fija), regla: `Tarifa fija retiro con camión troncal de ${nombreG(ctx, cdTroncal)} (Regla B)`, camion: TRUCK_TRONCAL, tipo: 'troncal' });
  }
  if (!opciones.length) return null;
  opciones.sort((a, b) => a.monto - b.monto);
  return opciones[0];
}

export const FLUJOS = {
  'EBE-DESP':          { tipo: 'STOCK',   label: 'EBE-DESP — Stock: EBEMA despacha',                         origen: 'CENTRO', destino: 'COMUNA' },
  'FAB-DESP/EBE-DESP': { tipo: 'CALZADA', label: 'FAB-DESP / EBE-DESP — Fábrica entrega en centro, EBEMA despacha', origen: 'CENTRO', destino: 'COMUNA' },
  'EBE-RET/CLI-RET':   { tipo: 'CALZADA', label: 'EBE-RET / CLI-RET — EBEMA retira, cliente retira en centro',    origen: 'COMUNA', destino: 'CENTRO' },
  'EBE-RET/EBE-DESP':  { tipo: 'CALZADA', label: 'EBE-RET / EBE-DESP — EBEMA retira y despacha',                  origen: 'COMUNA', destino: 'COMUNA' }
};

// input = { flujo, servicio, cdOrigen, comunaRetiro, cdDestino, comunaDespacho, kilos, camion, kmDirecto }
export function cotizar(ctx, input) {
  const out = { ok: false, error: null, total: 0, tramos: [], decisiones: [], avisos: [], alertas: [], cdOrigen: null, cdDestino: null, camionMilla: null, ruta: '', _ctx: ctx };
  const flujo = FLUJOS[input.flujo] ? input.flujo : 'EBE-DESP';
  const def = FLUJOS[flujo];
  const kilos = Number(input.kilos) || 0;
  const calzada = def.origen === 'COMUNA';          // EBEMA retira → hay primera milla
  const retira = def.destino === 'CENTRO' ? 'CD' : 'NO'; // cliente retira en centro → sin última milla
  const nRet = normComuna(input.comunaRetiro);
  let nDes = normComuna(input.comunaDespacho);
  if (!(kilos > 0)) { out.error = 'Ingrese los kilos a cotizar.'; return out; }
  if (calzada && !nRet) { out.error = 'Ingrese la comuna de retiro.'; return out; }
  if (!calzada && !input.cdOrigen) { out.error = 'Seleccione el centro de origen.'; return out; }
  if (retira === 'CD' && !input.cdDestino) { out.error = 'Seleccione el centro donde retira el cliente.'; return out; }
  if (retira === 'NO' && !nDes) { out.error = 'Ingrese la comuna de destino.'; return out; }
  if (retira === 'CD') {
    nDes = ctx.grupoInfo.get(input.cdDestino)?.comuna || '';
    if (!input.comunaDespacho) input = { ...input, comunaDespacho: ctx.grupoInfo.get(input.cdDestino)?.nombre || input.cdDestino };
  }

  // Nodos de origen: centro indicado, o todos los centros con ruta a la comuna de retiro
  // Primera y última milla: sólo desde el/los CD que atienden la comuna con ruta
  // REGIONAL (ej. Pudahuel → Santiago). Si la comuna no tiene ruta Regional, se
  // usa cualquier centro con ruta a ella.
  const soloRegionales = (lista, comunaNorm) => {
    const reg = lista.filter(g => esRegional(ctx, g, comunaNorm));
    return reg.length ? reg : lista;
  };
  // Retiros en la Región Metropolitana: centro preferente Quilicura (SANTIAGO)
  // cuando atiende la comuna, aunque San Bernardo también tenga ruta Regional.
  const preferente = lista => (lista.includes(HUB_GRUPO) ? [HUB_GRUPO] : lista);
  const origenes = calzada ? preferente(soloRegionales(candidatos(ctx, nRet), nRet)) : [input.cdOrigen];
  if (!origenes.length) { out.error = `No hay rutas creadas hacia la comuna de retiro "${input.comunaRetiro}".`; return out; }

  // Nodos de destino: centro de retiro del cliente, o todos los centros con ruta a la comuna
  const destinos = retira === 'CD' ? [input.cdDestino] : soloRegionales(candidatos(ctx, nDes), nDes);
  if (!destinos.length) { out.error = `No hay rutas creadas hacia la comuna de destino "${input.comunaDespacho}".`; return out; }

  // EXCLUSIVO: primera y última milla con camión dedicado según kilos (Tarifa
  // Express); traslados troncales igual que consolidado (kilos × $/kg, tope ZCAP).
  const exclusivo = input.servicio === 'exclusivo';
  if (exclusivo) out.camionMilla = camionPorKilos(kilos);

  // ── Enumera todas las combinaciones de nodos y elige la menor ──
  const caminos = [];
  const cacheTroncal = new Map();
  const ultimaCache = new Map();
  const ultimaDe = d => {
    if (!ultimaCache.has(d)) {
      if (retira === 'CD') ultimaCache.set(d, { monto: 0, regla: 'Regla C — cliente retira en CD' });
      else {
        const e = findRuta(ctx, d, nDes);
        const p = exclusivo ? precioLocalExclusivo(e, kilos) : precioLocalConsolidado(e, kilos);
        ultimaCache.set(d, p ? { monto: p.precio, regla: p.regla, ruta: p.ruta, camion: p.camion } : null);
      }
    }
    return ultimaCache.get(d);
  };

  origenes.forEach(o => {
    let ret = null;
    if (calzada) {
      if (exclusivo) {
        const p = precioLocalExclusivo(findRuta(ctx, o, nRet), kilos);
        ret = p ? { monto: p.precio, regla: p.regla, ruta: p.ruta, camion: p.camion, tipo: 'exclusivo' } : null;
      }
    }
    if (calzada && exclusivo && !ret) return;
    destinos.forEach(d => {
      if (calzada && !exclusivo) ret = mejorRetiro(ctx, o, nRet, kilos, d);
      if (calzada && !ret) return;
      const ult = ultimaDe(d);
      if (!ult) return;
      const k = o + '>' + d;
      if (!cacheTroncal.has(k)) cacheTroncal.set(k, mejorTroncal(ctx, o, d, kilos));
      const tr = cacheTroncal.get(k);
      if (!tr) return;
      const tramos = [];
      if (ret) tramos.push({ key: 'retiro', label: 'Retiro (primera milla)', monto: ret.monto, regla: ret.regla, ruta: ret.ruta, camion: ret.camion });
      tr.legs.forEach((l, i) => tramos.push({ key: 'troncal' + (i + 1), label: `Traslado ${i + 1} (inter-nodo)`, monto: l.precio, regla: l.regla, ruta: l.ruta, camion: l.camion }));
      tramos.push({ key: 'ultima', label: retira === 'CD' ? 'Entrega (cliente retira en centro)' : 'Última milla', monto: ult.monto, regla: ult.regla, ruta: ult.ruta, camion: ult.camion });
      const total = tramos.reduce((s, t) => s + t.monto, 0);
      const partes = [];
      if (calzada) partes.push(`Retiro ${ret.tipo === 'troncal' ? 'troncal' : (ret.tipo === 'exclusivo' ? 'exclusivo' : 'local')} ${nombreG(ctx, o)}`);
      else partes.push(`${flujo === 'EBE-DESP' ? 'Stock' : 'Recepción fábrica en'} ${nombreG(ctx, o)}`);
      if (tr.legs.length === 2) partes.push('Hub Quilicura');
      if (o !== d) partes.push(nombreG(ctx, d));
      partes.push(retira === 'CD' ? 'retira cliente' : 'despacho');
      caminos.push({ o, d, total, tramos, nombre: partes.join(' → '), camion: ult.camion || ret?.camion });
    });
  });

  // ── Entrega en ruta troncal ──
  // desvío = km(centro origen → comuna) + km(centro destino → comuna) − km(centro origen → centro destino)
  if (retira === 'NO' && kilos > KILOS_MIN_EN_RUTA) {
    origenes.forEach(o => {
      const eOC = findRuta(ctx, o, nDes);
      if (!eOC || !(eOC.km > 0)) return;
      destinos.forEach(d => {
        if (d === o) return;
        const eOD = findRuta(ctx, o, ctx.grupoInfo.get(d)?.comuna);
        const eDC = findRuta(ctx, d, nDes);
        if (!eOD || !eDC || !(eOD.km > 0)) return;
        const desvio = Math.round(eOC.km + eDC.km - eOD.km);
        if (desvio > DESVIO_MAX_KM) return;
        // Tarifa del troncal que realmente viaja (centro origen → centro destino),
        // prorrateada por los km hasta la comuna: el camión no llega al centro destino.
        const trOD = precioTroncal(eOD, kilos);
        if (!trOD) return;
        const fr = Math.min(1, eOC.km / eOD.km);
        const tr = { ...trOD, precio: Math.round(trOD.precio * fr),
          regla: `${trOD.regla} [${trOD.ruta}] × ${eOC.km}/${eOD.km} km hasta ${input.comunaDespacho} = ${(fr * 100).toFixed(1).replace('.', ',')}%` };
        let ret = null;
        if (calzada) {
          if (exclusivo) {
            const p = precioLocalExclusivo(findRuta(ctx, o, nRet), kilos);
            ret = p ? { monto: p.precio, regla: p.regla, ruta: p.ruta, camion: p.camion, tipo: 'exclusivo' } : null;
          } else ret = mejorRetiro(ctx, o, nRet, kilos, d);
          if (!ret) return;
        }
        const tramos = [];
        if (ret) tramos.push({ key: 'retiro', label: 'Retiro (primera milla)', monto: ret.monto, regla: ret.regla, ruta: ret.ruta, camion: ret.camion });
        tramos.push({ key: 'troncal_ruta', label: `Traslado troncal con entrega en ruta (${input.comunaDespacho})`, monto: tr.precio, ruta: tr.ruta, camion: tr.camion,
          regla: `${tr.regla} · en ruta ${nombreG(ctx, o)} → ${nombreG(ctx, d)}: ${eOC.km} + ${eDC.km} − ${eOD.km} = desvío ${Math.max(0, desvio)} km (máx. ${DESVIO_MAX_KM})${desvio < 0 ? ' — la comuna queda antes del centro destino' : ''}` });
        tramos.push({ key: 'cargo_ruta', label: 'Cargo entrega en ruta', monto: CARGO_ENTREGA_EN_RUTA, regla: `Cargo fijo por parada del troncal (carga > ${KILOS_MIN_EN_RUTA.toLocaleString('es-CL')} kg)` });
        const total = tramos.reduce((a, t) => a + t.monto, 0);
        const inicio = calzada ? `Retiro ${ret.tipo === 'troncal' ? 'troncal' : (ret.tipo === 'exclusivo' ? 'exclusivo' : 'local')} ${nombreG(ctx, o)}` : `${flujo === 'EBE-DESP' ? 'Stock' : 'Recepción fábrica en'} ${nombreG(ctx, o)}`;
        caminos.push({ o, d, total, tramos, enRuta: true, camion: tr.camion,
          nombre: `${inicio} → entrega en ruta a ${input.comunaDespacho} (troncal hacia ${nombreG(ctx, d)})` });
      });
    });
  }

  // ── Camión directo (misma regla del Plan de Carga) ──
  // Se habilita si los kilos llenan un camión sobre el umbral: >90% en Calzada
  // (FABRICA-CLIENTE / FABRICA-SUCURSAL) y >80% en Stock (CD-CLIENTE). Precio =
  // ZCAP del camión en la ruta directa; compite con los recorridos por centros.
  const umbral = calzada ? UMBRAL_DIRECTO_CALZADA : UMBRAL_DIRECTO_STOCK;
  const camionDirecto = exclusivo
    ? (() => { const tipo = camionPorKilos(kilos); const cap = truckCapKg(tipo); const n = Math.max(1, Math.ceil(kilos / cap)); return { tipo, n, fill: kilos / (n * cap) }; })()
    : elegirCamionDirecto(kilos, umbral);
  if (camionDirecto) {
    const destDirecto = retira === 'CD' ? ctx.grupoInfo.get(destinos[0])?.comuna : nDes;
    origenes.forEach(o => {
      // Si el centro de salida ya atiende el destino, el recorrido por centros es el mismo viaje
      if (retira === 'CD' ? o === destinos[0] : esRegional(ctx, o, destDirecto)) return;
      const e = findRuta(ctx, o, destDirecto);
      const t = e?.trucks[camionDirecto.tipo];
      if (!t || !(t.zcap > 0)) return;
      const base = exclusivo ? t.tarifaExpress : t.zcap;
      const monto = Math.round(base * camionDirecto.n);
      const desde = calzada ? `${input.comunaRetiro} (zona ${nombreG(ctx, o)})` : nombreG(ctx, o);
      const hasta = retira === 'CD' ? nombreG(ctx, destinos[0]) : input.comunaDespacho;
      caminos.push({
        o, d: retira === 'CD' ? destinos[0] : o, total: monto, camion: t.type,
        nombre: `Camión directo ${t.type}${camionDirecto.n > 1 ? ' × ' + camionDirecto.n : ''} ${desde} → ${hasta}`,
        tramos: [{ key: 'directo_camion', label: `Camión directo ${calzada ? (retira === 'CD' ? 'fábrica → sucursal' : 'fábrica → cliente') : 'centro → cliente'}`,
          monto, ruta: e.codigo, camion: t.type,
          regla: exclusivo
            ? `Tarifa Express ${t.type}${camionDirecto.n > 1 ? ' × ' + camionDirecto.n : ''} = ZCAP ${fmt(t.zcap)} × (1 + ${t.recargoPct}%)`
            : `ZCAP ${t.type} ${fmt(t.zcap)}${camionDirecto.n > 1 ? ' × ' + camionDirecto.n : ''} — ${Math.round(camionDirecto.fill * 100)}% de ocupación (umbral ${Math.round(umbral * 100)}%)` }]
      });
    });
  }

  // Regla A — retiro y despacho atendidos por el mismo centro Regional (28-sep-2026)
  //  Consolidado: el directo sólo se habilita si los kilos alcanzan los kilos a
  //   consolidar (80%) del camión según kilos → cobra el trayecto completo
  //   (ZCAP × km directo ÷ km ruta). Bajo el 80% la carga pasa obligatoriamente
  //   por la sucursal, pero el precio queda topado en ese camión directo completo.
  //  Exclusivo: un solo camión dedicado retiro → despacho (Tarifa Express × km directo ÷ km ruta).
  const km = Number(input.kmDirecto) || 0;
  if (calzada && retira === 'NO') {
    const comunes = origenes.filter(g => esRegional(ctx, g, nRet) && esRegional(ctx, g, nDes));
    if (comunes.length && !km) out.avisos.push('Calculando distancia directa retiro → despacho…');
    comunes.forEach(g => {
      const e = findRuta(ctx, g, nDes);
      if (!e || !(km > 0) || !(e.km > 0)) return;
      const tipo = camionPorKilos(kilos);
      const t = e.trucks[tipo] || e.trucks[TRUCK_TRONCAL];
      if (!t || !(t.zcap > 0)) return;
      const n = Math.max(1, Math.ceil(kilos / t.cap));
      const factorKm = km / e.km;
      const kmTxt = `${km.toLocaleString('es-CL')} km ÷ ${e.km} km ruta ${e.codigo}`;

      if (exclusivo) {
        if (!t.tarifaExpress) return;
        const monto = Math.round(t.tarifaExpress * n * factorKm);
        caminos.push({
          o: g, d: g, total: monto, camion: t.type, nombre: `Camión exclusivo ${input.comunaRetiro} → ${input.comunaDespacho}`,
          tramos: [{ key: 'directo', label: 'Camión exclusivo retiro → despacho', monto, camion: t.type, ruta: e.codigo,
            regla: `Tarifa Express ${t.type}${n > 1 ? ' × ' + n : ''} ${fmt(t.tarifaExpress)} × (${kmTxt})` }]
        });
        return;
      }

      const montoDirecto = Math.round(t.zcap * n * factorKm);
      const ocupacion = kilos / (t.kilosConsolidar * n);
      if (ocupacion >= 1) {
        caminos.push({
          o: g, d: g, total: montoDirecto, camion: t.type, nombre: `Directo ${input.comunaRetiro} → ${input.comunaDespacho}`,
          tramos: [{ key: 'directo', label: 'Directo retiro → despacho', monto: montoDirecto, camion: t.type, ruta: e.codigo,
            regla: `${t.type} completo: ZCAP ${fmt(t.zcap)}${n > 1 ? ' × ' + n : ''} × (${kmTxt}) — carga ≥ ${Math.round(t.kilosConsolidar).toLocaleString('es-CL')} kg (80%)` }]
        });
      } else {
        // Bajo el 80%: consolida en la sucursal, con tope en el camión directo completo
        caminos.forEach(c => {
          if (c.o !== g || c.d !== g || c.enRuta || c.topado) return;
          if (!c.tramos.some(x => x.key === 'ultima')) return;
          if (c.total <= montoDirecto) return;
          c.tramos.push({ key: 'ajuste_tope', label: `Ajuste: tope camión directo completo (${t.type})`, monto: montoDirecto - c.total,
            regla: `El precio no supera el camión directo completo: ZCAP ${fmt(t.zcap)} × (${kmTxt}) = ${fmt(montoDirecto)}` });
          c.total = montoDirecto;
          c.topado = true;
        });
      }
    });
  }

  if (!caminos.length) {
    out.error = `No se encontró un recorrido tarifado entre ${calzada ? input.comunaRetiro : nombreG(ctx, input.cdOrigen)} y ${input.comunaDespacho}.`;
    return out;
  }
  caminos.sort((a, b) => a.total - b.total);
  const best = caminos[0];
  out.tramos = best.tramos;
  out.total = best.total;
  out.cdOrigen = best.o;
  out.cdDestino = best.d;
  out.camionMilla = best.camion || null;
  out.ruta = best.nombre;
  // Alternativas: mejores recorridos distintos (máx. 5)
  const vistos = new Set();
  const top = caminos.filter(c => (vistos.has(c.nombre) ? false : vistos.add(c.nombre))).slice(0, 5);
  if (top.length > 1) out.decisiones.push({ tramo: `Recorridos evaluados (${caminos.length})`, opciones: top.map((c, i) => ({ nombre: c.nombre, monto: c.total, elegida: i === 0 })) });
  out.ok = true;
  return finalizar(out);
}

// Ahorro = diferencia con el segundo mejor recorrido
function finalizar(out) {
  const inc = out._ctx?.inconsistentes;
  if (inc) {
    out.tramos.forEach(t => {
      const v = t.ruta && inc.get(t.ruta);
      if (v) out.alertas.push(`Inconsistencia de datos en ruta ${v.codigo} (${t.label}): tiene ${v.km} km cargados y hay ${v.lineal} km en línea recta desde su centro. El precio de este tramo puede estar subestimado — revisar en Rutas de Transporte.`);
    });
  }
  delete out._ctx;
  out.ahorro = out.decisiones.reduce((s, d) => {
    const ord = d.opciones.map(o => o.monto).sort((a, b) => a - b);
    return s + (ord.length > 1 ? ord[1] - ord[0] : 0);
  }, 0);
  return out;
}
