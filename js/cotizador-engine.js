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
import { getOrigenGroups, truckCapKg } from './data.js?v=202609271352';
import { buildZcapMap } from './zcap.js?v=202609271352';

export const TRUCK_ORDER = ['Camión 5 Ton', 'Camión 10 Ton', 'Camión 15 Ton', 'Camión 28 Ton'];
export const TRUCK_TRONCAL = 'Camión 28 Ton';
export const HUB_GRUPO = 'SANTIAGO'; // Hub troncal: CD Quilicura

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
    const factorPct = Number(getPath(ccfg, `consolidacionObjetivo.${grupoKey}.${bkt}`, 80)) || 80;
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
  const comunas = new Map(); // norm → { nombre, lat, lon, cds: [{grupo, km, codigo}] }
  (db.routes || []).filter(r => r.activo).forEach(r => {
    const codigo = r.codigo || String(r.id || '');
    const entry = tarifas.get(codigo);
    if (!entry) return;
    const grupo = centroGrupo.get(String(r.origenId)) || r.origen_grupo || '';
    const dn = normComuna(r.destino);
    const key = grupo + '|' + dn;
    const prev = rutaPorGrupoDest.get(key);
    // Preferir tipo Comuna sobre Sector, luego menor km
    const better = !prev
      || (prev.ruta.tipo !== 'Comuna' && r.tipo === 'Comuna')
      || (prev.ruta.tipo === r.tipo && (Number(r.km) || 0) < prev.km);
    if (better) rutaPorGrupoDest.set(key, entry);

    let c = comunas.get(dn);
    if (!c) { c = { norm: dn, nombre: r.destino, lat: null, lon: null, cds: [] }; comunas.set(dn, c); }
    if (c.lat == null && r.lat != null && r.lon != null) { c.lat = Number(r.lat); c.lon = Number(r.lon); }
    if (r.clasificRuta === 'Regional' && !c.cds.some(x => x.grupo === grupo)) {
      c.cds.push({ grupo, km: Number(r.km) || 0, codigo });
    }
  });
  comunas.forEach(c => c.cds.sort((a, b) => a.km - b.km));

  return { tarifas, grupoInfo, rutaPorGrupoDest, comunas, ccfg };
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
//   · Piso monotónico: si los kilos superan un camión menor completo, el precio
//     no baja del ZCAP de ese camión (evita que agregar kilos abarate el flete).
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
  const i = trucks.indexOf(t);
  const prev = i > 0 ? trucks[i - 1] : null;
  if (!sobre28 && prev && kilos > prev.cap && precio < prev.zcap) {
    precio = prev.zcap;
    regla = `Piso ZCAP ${prev.type} completo (kilos superan su capacidad)`;
  }
  const zfmi = entry.zfmi || 0;
  if (precio < zfmi) {
    precio = zfmi;
    regla = `Mínimo ZFMI de la ruta (${fmtKg(entry.kilosTarifaMin || 0)})`;
  }
  return { precio: Math.round(precio), regla, camion: t.type, ruta: entry.codigo, zfmp: t.zfmp, zcap: t.zcap, zfmi };
}

// ── Precio tramo troncal: proporcional kilos × ZFMP 28T, sin mínimo ────────
export function precioTroncal(entry, kilos) {
  if (!entry) return null;
  const t = entry.trucks[TRUCK_TRONCAL]
    || TRUCK_ORDER.slice().reverse().map(x => entry.trucks[x]).find(x => x && x.zfmp);
  if (!t || !t.zfmp) return null;
  return {
    precio: Math.round(kilos * t.zfmp),
    regla: `${fmtKg(kilos)} × ZFMP ${fmtKgRate(t.zfmp)} (${t.type}, proporcional sin mínimo)`,
    camion: t.type, ruta: entry.codigo, zfmp: t.zfmp, zcap: t.zcap
  };
}

// ── Cotización principal ───────────────────────────────────────────────────
// input = {
//   tipoNegocio: 'STOCK' | 'CALZADA',
//   servicio:    'consolidado' | 'exclusivo',
//   cdOrigen:    grupo (STOCK)                       — CD donde está el stock
//   comunaRetiro, cdRetiro (opcional, override)      — CALZADA
//   comunaDespacho, cdDespacho (opcional, override)
//   kilos, camion (exclusivo, opcional → automático por kilos)
//   retira: 'NO' | 'CD' | 'FABRICA'
//   kmDirecto: km carretera retiro → despacho (Regla A, opcional)
// }
export function cotizar(ctx, input) {
  const out = { ok: false, error: null, total: 0, tramos: [], decisiones: [], avisos: [], cdOrigen: null, cdDestino: null, camionMilla: null };
  const kilos = Number(input.kilos) || 0;
  const calzada = input.tipoNegocio === 'CALZADA';
  const retira = input.retira || 'NO';
  if (!(kilos > 0)) { out.error = 'Ingrese los kilos a cotizar.'; return out; }

  // CD origen
  let cdO = null;
  if (calzada) {
    if (!input.comunaRetiro) { out.error = 'Ingrese la comuna de retiro.'; return out; }
    cdO = input.cdRetiro || resolverCD(ctx, input.comunaRetiro);
    if (!cdO) { out.error = `La comuna de retiro "${input.comunaRetiro}" no tiene un CD asignado (ruta Regional).`; return out; }
  } else {
    cdO = input.cdOrigen;
    if (!cdO) { out.error = 'Seleccione el CD de origen del stock.'; return out; }
  }
  // CD destino
  if (!input.comunaDespacho) { out.error = 'Ingrese la comuna de despacho.'; return out; }
  const cdD = input.cdDespacho || resolverCD(ctx, input.comunaDespacho);
  if (!cdD) { out.error = `La comuna de despacho "${input.comunaDespacho}" no tiene un CD asignado (ruta Regional).`; return out; }
  out.cdOrigen = cdO; out.cdDestino = cdD;

  const nRet = normComuna(input.comunaRetiro);
  const nDes = normComuna(input.comunaDespacho);
  const infoO = ctx.grupoInfo.get(cdO), infoD = ctx.grupoInfo.get(cdD);

  // Regla C — cliente retira en fábrica: sin costo de transporte
  if (calzada && retira === 'FABRICA') {
    out.tramos.push({ key: 'fabrica', label: 'Cliente retira en fábrica', monto: 0, regla: 'Regla C — sin transporte EBEMA' });
    out.ok = true; out.total = 0; return finalizar(out);
  }

  // ── EXCLUSIVO: Tarifa Express de la ruta CD origen → comuna, por camión ──
  if (input.servicio === 'exclusivo') {
    const destNorm = retira === 'CD' ? (infoD?.comuna || nDes) : nDes;
    const entry = findRuta(ctx, cdO, destNorm);
    if (!entry) { out.error = `No existe ruta creada ${cdO} → ${input.comunaDespacho}.`; return out; }
    const tipo = input.camion || camionPorKilos(kilos);
    const t = entry.trucks[tipo];
    if (!t || !t.tarifaExpress) { out.error = `La ruta ${entry.codigo} no tiene Tarifa Express para ${tipo}.`; return out; }
    let n = 1;
    if (kilos > t.cap) { n = Math.ceil(kilos / t.cap); out.avisos.push(`Los kilos superan la capacidad de ${tipo}: se cotizan ${n} camiones.`); }
    const monto = Math.round(t.tarifaExpress * n);
    out.camionMilla = tipo;
    out.tramos.push({
      key: 'exclusivo', label: 'Servicio exclusivo (punto a punto)', monto, ruta: entry.codigo, camion: tipo,
      regla: `Tarifa Express ${tipo} = ZCAP ${fmt(t.zcap)} × (1 + ${t.recargoPct}%)` + (n > 1 ? ` × ${n}` : '')
    });
    if (calzada && nRet && nRet !== infoO?.comuna) out.avisos.push('Exclusivo CALZADA: se cotiza desde el CD asignado a la comuna de retiro; no incluye el desvío a la fábrica.');
    out.ok = true; out.total = monto; return finalizar(out);
  }

  // ── CONSOLIDADO multi-tramo ──
  let total = 0;

  // 1. Retiro (primera milla) — Regla B
  let retiro = null;
  if (calzada) {
    const eRet = findRuta(ctx, cdO, nRet);
    const local = precioLocalConsolidado(eRet, kilos);
    const fija = getRetiroTroncalTarifas(ctx.ccfg)[cdO];
    const opciones = [];
    if (local) opciones.push({ nombre: 'Primera milla local', monto: local.precio, regla: local.regla, ruta: local.ruta, camion: local.camion });
    if (fija != null && Number(fija) > 0) opciones.push({ nombre: 'Retiro con camión troncal', monto: Math.round(Number(fija)), regla: `Tarifa fija retiro troncal ${infoO?.nombre || cdO} (Regla B)`, camion: TRUCK_TRONCAL });
    if (!opciones.length) { out.error = `No hay tarifa de retiro para ${input.comunaRetiro} (sin ruta ${cdO} → ${input.comunaRetiro} ni tarifa troncal).`; return out; }
    opciones.sort((a, b) => a.monto - b.monto);
    retiro = { key: 'retiro', label: 'Retiro (primera milla)', ...opciones[0] };
    if (opciones.length > 1) out.decisiones.push({ tramo: 'Retiro', opciones: opciones.map((o, i) => ({ ...o, elegida: i === 0 })) });
    if (local) out.camionMilla = local.camion;
  }

  // 2. Troncal
  const troncales = [];
  if (cdO !== cdD) {
    const alternativas = [];
    const eDir = findRuta(ctx, cdO, infoD?.comuna);
    const pDir = precioTroncal(eDir, kilos);
    if (pDir) alternativas.push({ nombre: `Troncal directo ${infoO?.nombre || cdO} → ${infoD?.nombre || cdD}`, monto: pDir.precio, legs: [pDir] });
    if (cdO !== HUB_GRUPO && cdD !== HUB_GRUPO) {
      const hub = ctx.grupoInfo.get(HUB_GRUPO);
      const p1 = precioTroncal(findRuta(ctx, cdO, hub?.comuna), kilos);
      const p2 = precioTroncal(findRuta(ctx, HUB_GRUPO, infoD?.comuna), kilos);
      if (p1 && p2) alternativas.push({ nombre: `Vía Hub Quilicura`, monto: p1.precio + p2.precio, legs: [p1, p2] });
    }
    if (!alternativas.length) { out.error = `No existe ruta troncal entre ${infoO?.nombre || cdO} y ${infoD?.nombre || cdD}.`; return out; }
    alternativas.sort((a, b) => a.monto - b.monto);
    const elegida = alternativas[0];
    elegida.legs.forEach((l, i) => troncales.push({
      key: 'troncal' + (i + 1), label: `Traslado ${i + 1} (inter-nodo)`, monto: l.precio, regla: l.regla, ruta: l.ruta, camion: l.camion
    }));
    if (alternativas.length > 1) out.decisiones.push({ tramo: 'Troncal', opciones: alternativas.map((a, i) => ({ nombre: a.nombre, monto: a.monto, regla: a.legs.map(l => l.ruta).join(' + '), elegida: i === 0 })) });
  }

  // 3. Última milla — Regla C
  let ultima = null;
  if (retira === 'CD') {
    ultima = { key: 'ultima', label: 'Última milla', monto: 0, regla: 'Regla C — cliente retira en CD' };
  } else {
    const eUlt = findRuta(ctx, cdD, nDes);
    const p = precioLocalConsolidado(eUlt, kilos);
    if (!p) { out.error = `No existe ruta creada ${infoD?.nombre || cdD} → ${input.comunaDespacho}.`; return out; }
    ultima = { key: 'ultima', label: 'Última milla', monto: p.precio, regla: p.regla, ruta: p.ruta, camion: p.camion };
    out.camionMilla = p.camion;
  }

  // Regla A — triangulación regional (retiro y despacho en el mismo CD)
  if (calzada && cdO === cdD && retira === 'NO') {
    const viaCD = retiro.monto + ultima.monto;
    const eUlt = findRuta(ctx, cdD, nDes);
    const km = Number(input.kmDirecto) || 0;
    let directo = null;
    if (eUlt && km > 0 && eUlt.km > 0) {
      const tipo = camionPorKilos(kilos);
      const t = eUlt.trucks[tipo] || eUlt.trucks[TRUCK_TRONCAL];
      if (t && t.zcap > 0) {
        const porKm = t.zcap / eUlt.km;
        const bruto = km * porKm;
        const piso = eUlt.zfmi || 0;
        const monto = Math.round(Math.max(piso, bruto));
        directo = {
          monto, camion: t.type,
          regla: bruto >= piso
            ? `${km.toLocaleString('es-CL')} km × ${fmt(porKm)}/km (ZCAP ${t.type} ${eUlt.codigo} ÷ ${eUlt.km} km)`
            : `Mínimo ZFMI ${eUlt.codigo} (${km} km × ${fmt(porKm)}/km = ${fmt(bruto)})`
        };
      }
    } else if (!km) {
      out.avisos.push('Regla A: no se pudo obtener la distancia directa retiro → despacho; se cotiza vía CD.');
    }
    if (directo) {
      const opciones = [
        { nombre: `Vía CD ${infoO?.nombre || cdO} (retiro + última milla)`, monto: viaCD, regla: 'Retiro + Última milla' },
        { nombre: 'Directo punto a punto', monto: directo.monto, regla: directo.regla }
      ].sort((a, b) => a.monto - b.monto);
      out.decisiones.push({ tramo: 'Regla A — Triangulación', opciones: opciones.map((o, i) => ({ ...o, elegida: i === 0 })) });
      if (directo.monto < viaCD) {
        out.tramos.push({ key: 'directo', label: 'Directo retiro → despacho (Regla A)', monto: directo.monto, regla: directo.regla, camion: directo.camion });
        out.camionMilla = directo.camion;
        out.total = directo.monto;
        out.ok = true;
        return finalizar(out);
      }
    }
  }

  if (retiro) { out.tramos.push(retiro); total += retiro.monto; }
  troncales.forEach(t => { out.tramos.push(t); total += t.monto; });
  out.tramos.push(ultima); total += ultima.monto;
  out.total = total;
  out.ok = true;
  return finalizar(out);
}

// Ahorro total = Σ (segunda mejor − elegida) de cada decisión
function finalizar(out) {
  out.ahorro = out.decisiones.reduce((s, d) => {
    const ord = d.opciones.map(o => o.monto).sort((a, b) => a - b);
    return s + (ord.length > 1 ? ord[1] - ord[0] : 0);
  }, 0);
  return out;
}
