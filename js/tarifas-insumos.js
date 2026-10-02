// ============================================================================
// TARIFAS TRANSPORTE — Insumos y Motor de Costos (rediseño v2, 30-sep-2026)
// ----------------------------------------------------------------------------
// Vistas: Peajes (regionales / interregionales / concesiones), Combustibles y
// Rendimientos, Seguros y Permisos, Costos Extras, Variables Generales y
// Motor de Costos (tabla + desglose de 12 pasos por fila).
//
// Todas las ediciones van a UN borrador común (INS). La barra amarilla muestra
// cuántos cambios hay y cuánto cambian los costos de ruta del motor; nada se
// escribe en Supabase hasta «Guardar y recalcular». Al guardar se sincroniza
// sólo la tabla tocada (syncOnly), nunca la base completa.
//
// Datos (sin tablas nuevas):
//   · parámetros → tariff_config.data (combustibles, rendimientos, seguros,
//     soapTransversal, permisosSoap, variables, kmOfrecidos,
//     concesionesVariacion, concesionesExtra, peajesOriginal)
//   · peajes → route_tolls (source = 'manual' cuando el valor difiere del
//     calculado; el calculado queda en tariff_config.peajesOriginal)
//   · costos extra → extra_costs (se siguen aplicando por EJES)
// ============================================================================
import { saveDatabase, getOrigenGroups, getCentreName, deleteRow } from './data.js?v=202610021918';
import { CAP_LIST, truckTypesWithCap, calcularCostoRuta } from './tarifas-engine.js?v=202610021918';
import { showAlert } from './utils.js';
import { can } from './permisos.js?v=202610021918';
import { esc, fmt, clp, numIn, wireNumIns, rerenderKeepFocus, debounce, chainHtml, wireChain, changesBarHtml, wireChangesBar, textoImpacto, setParamPill, usuarioSesion, clasifPill, carPill, pillHtml } from './tarifas-ui.js?v=202610021918';

// ── Utilidades ──────────────────────────────────────────────────────────────
function getPath(obj, path) {
  let cur = obj;
  for (const p of path.split('.')) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
const hoyISO = () => new Date().toISOString().slice(0, 10);
const num = v => Number(v) || 0;
const capLbl = cap => `${fmt(cap / 1000)} t`;
const ejesDeCap = (cfg, cap) => Number((cfg.ejes || {})[String(cap)]) || (cap <= 10000 ? 2 : 3);
const EJES_SUB = { 2: '5 t · 10 t', 3: '15 t · 28 t' };
const DIAS_REVISAR_DIESEL = 21;   // regla vigente: alerta si un centro pasa 3 semanas sin actualizar
const PAGE_PJ = 50, PAGE_MC = 25;

// Input de texto / fecha con el mismo look que numIn
function txtIn(key, value, { type = 'text', w = '140px', changed = false, placeholder = '', disabled = false, label = '' } = {}) {
  return `<label class="tf-in is-txt${changed ? ' is-ch' : ''}${disabled ? ' is-dis' : ''}" style="--w:${w}">
    <input type="${type}" data-txt="${esc(key)}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''} autocomplete="off" aria-label="${esc(label || key)}"></label>`;
}
function wireTxtIns(root, onInput) {
  root.querySelectorAll('input[data-txt]').forEach(inp => {
    const ev = inp.type === 'date' ? 'change' : 'input';
    inp.addEventListener(ev, () => onInput(inp.dataset.txt, inp.value));
  });
}
function descargarCsv(nombre, headers, rows) {
  const sep = ';';
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const txt = [headers.map(q).join(sep), ...rows.map(r => r.map(q).join(sep))].join('\n');
  const blob = new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function leerCsv(file, cb) {
  const r = new FileReader();
  r.onload = e => {
    const lines = String(e.target.result || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return cb([]);
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const hdr = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
    cb(lines.slice(1).map(l => { const c = l.split(sep); const o = {}; hdr.forEach((h, i) => { o[h] = (c[i] || '').trim().replace(/^"|"$/g, ''); }); return o; }));
  };
  r.readAsText(file, 'UTF-8');
}
function capDesdeCsv(val) {
  let n = Number(String(val).replace(/[^\d.]/g, ''));
  if (!n) return 0;
  if (n <= 28) n *= 1000;
  return n;
}
function kpiHtml(on, attr, key, lbl, val, sub, color, clickable = true) {
  return `<button class="sv-kpi ${on ? 'is-on' : ''}" ${clickable ? `data-chip ${attr}="${esc(key)}"` : 'data-chip disabled style="cursor:default"'}
    style="${on ? `box-shadow:inset 0 -3px 0 ${color}` : ''}"><div class="sv-kpi-l"><i style="background:${color}"></i>${esc(lbl)}</div>
    <div class="sv-kpi-v" style="font-size:28px;line-height:36px">${esc(val)}</div><div class="sv-kpi-s">${esc(sub)}</div></button>`;
}
function pagerHtml(total, pagina, per, attr) {
  const pags = Math.max(1, Math.ceil(total / per));
  if (pags <= 1) return '';
  return `<span class="tf-pager"><button data-chip ${attr}="-1" ${pagina === 0 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_left</span></button>Pág. ${pagina + 1} / ${pags}<button data-chip ${attr}="1" ${pagina >= pags - 1 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px">chevron_right</span></button></span>`;
}
function grupoDeRuta(grupos, ruta) {
  return grupos.find(g => g.grupo === ruta.origen_grupo) || grupos.find(g => g.centroIds.includes(ruta.origenId)) || null;
}
function nombreCentro(db, grupos, ruta) {
  const g = grupoDeRuta(grupos, ruta);
  return g ? (g.nombre || g.grupo) : (getCentreName(db, ruta.origenId) || '');
}
function centroChips(grupos, activo, attr) {
  return `<div class="sv-frow"><span class="sv-flbl">Centro origen</span>
    <button class="sv-chip ${activo === 'all' ? 'is-on' : ''}" data-chip ${attr}="all">Todos</button>
    ${grupos.map(g => `<button class="sv-chip ${activo === g.grupo ? 'is-on' : ''}" data-chip ${attr}="${esc(g.grupo)}">${esc(g.nombre || g.grupo)}</button>`).join('')}</div>`;
}
function rutaEnGrupo(grupos, ruta, grupo) {
  if (grupo === 'all') return true;
  const g = grupos.find(x => x.grupo === grupo);
  if (!g) return false;
  return ruta.origen_grupo ? ruta.origen_grupo === g.grupo : g.centroIds.includes(ruta.origenId);
}

// ── Borrador común ──────────────────────────────────────────────────────────
const INS = {
  cfg: {},            // path → valor
  conc: {},           // nombre concesión → variación %
  concNew: [],        // filas nuevas de concesión
  concDel: [],        // nombres de concesiones agregadas a mano que se quitan
  tolls: {},          // 'routeId|ejes' → { ida, vuelta }
  extras: {},         // id → { costo_ida?, costo_vuelta?, activo? }
  extrasNew: [],      // filas nuevas de extra_costs
  extrasDel: [],      // ids a borrar
  cne: {},            // repId → { precio, region, mes, anio } (último «Actualizar desde CNE»)
  guardando: false,
  memo: new Map(),    // costo de ruta con los datos guardados (clave ruta|cap)
};
export function hayCambiosInsumos() { return INS._n > 0; }

const igualNum = (a, b) => Math.abs(num(a) - num(b)) < 1e-9;
function tollGuardado(db, routeId, ejes) {
  return (db.routeTolls || []).find(t => t.route_id === routeId && Number(t.ejes) === Number(ejes)) || null;
}
function tollValores(db, routeId, ejes) {
  const k = `${routeId}|${ejes}`;
  if (INS.tolls[k]) return INS.tolls[k];
  const t = tollGuardado(db, routeId, ejes);
  return { ida: num(t?.peaje_ida), vuelta: num(t?.peaje_vuelta) };
}
function extrasEfectivos(db) {
  const del = new Set(INS.extrasDel);
  return (db.extraCosts || []).filter(c => !del.has(c.id)).map(c => (INS.extras[c.id] ? { ...c, ...INS.extras[c.id] } : c)).concat(INS.extrasNew);
}
function extraCambiado(db, id) {
  const o = INS.extras[id];
  if (!o) return false;
  const c = (db.extraCosts || []).find(x => x.id === id);
  if (!c) return false;
  return Object.keys(o).some(f => (f === 'activo' ? (o[f] !== (c.activo !== false)) : !igualNum(o[f], c[f])));
}
function contarCambios(db) {
  const n = Object.keys(INS.cfg).length + Object.keys(INS.conc).length + INS.concNew.length + INS.concDel.length
    + Object.keys(INS.tolls).length + Object.keys(INS.extras).filter(id => extraCambiado(db, id)).length
    + INS.extrasNew.length + INS.extrasDel.length;
  INS._n = n;
  return n;
}
function hayCambiosParametros() {
  return Object.keys(INS.cfg).length + Object.keys(INS.conc).length + INS.concNew.length + INS.concDel.length > 0;
}
// Valor que se ve en pantalla para un path de configuración
function valCfg(cfg, path) { return path in INS.cfg ? INS.cfg[path] : getPath(cfg, path); }
function setCfgDraft(cfg, path, v, esTexto = false) {
  const g = getPath(cfg, path);
  const igual = esTexto ? String(v ?? '') === String(g ?? '') : igualNum(v, g);
  if (igual) delete INS.cfg[path]; else INS.cfg[path] = v;
}
function cfgEfectivo(cfg) {
  if (!hayCambiosParametros()) return cfg;
  const c = JSON.parse(JSON.stringify(cfg));
  Object.entries(INS.cfg).forEach(([p, v]) => setPath(c, p, v));
  c.concesionesVariacion = { ...(c.concesionesVariacion || {}), ...INS.conc };
  return c;
}
function descartar() {
  INS.cfg = {}; INS.conc = {}; INS.concNew = []; INS.concDel = [];
  INS.tolls = {}; INS.extras = {}; INS.extrasNew = []; INS.extrasDel = []; INS.cne = {};
}

// ── Motor rápido (índices por ruta / zona para no recorrer 7.000 peajes por fila) ──
const VACIO = [];
function indice(tollsArr, extrasArr) {
  const tolls = new Map(), extras = new Map();
  (tollsArr || []).forEach(t => { if (!tolls.has(t.route_id)) tolls.set(t.route_id, []); tolls.get(t.route_id).push(t); });
  (extrasArr || []).forEach(c => { if (!extras.has(c.zona_id)) extras.set(c.zona_id, []); extras.get(c.zona_id).push(c); });
  return { tolls, extras };
}
function tollsEfectivos(db) {
  const keys = Object.keys(INS.tolls);
  if (!keys.length) return db.routeTolls || [];
  const map = new Map((db.routeTolls || []).map(t => [`${t.route_id}|${Number(t.ejes)}`, t]));
  keys.forEach(k => {
    const [routeId, ejes] = k.split('|');
    const t = map.get(k) || { route_id: routeId, ejes: Number(ejes) };
    map.set(k, { ...t, peaje_ida: INS.tolls[k].ida, peaje_vuelta: INS.tolls[k].vuelta });
  });
  return [...map.values()];
}
function costoRuta(db, idx, cfgX, ruta, capKg, opciones) {
  const mini = Object.create(db);
  mini.routeTolls = idx.tolls.get(ruta.id) || VACIO;
  mini.extraCosts = idx.extras.get(ruta.id_zona_transporte) || VACIO;
  return calcularCostoRuta(mini, cfgX, ruta, capKg, opciones);
}
// Combinaciones ruta × tipo de camión del catálogo de su centro (como el motor PRD)
function combinaciones(db) {
  const porCentro = new Map();
  const out = [];
  (db.routes || []).filter(r => r.activo).forEach(ruta => {
    if (!porCentro.has(ruta.origenId)) porCentro.set(ruta.origenId, truckTypesWithCap(db, ruta.origenId).filter(t => t.capKg > 0));
    porCentro.get(ruta.origenId).forEach(t => out.push({ ruta, truck: t, key: `${ruta.id}|${t.capKg}` }));
  });
  return out;
}
function textoImpactoInsumos(db, cfg) {
  if (!contarCambios(db)) return '';
  let combos = combinaciones(db);
  if (!hayCambiosParametros()) {
    const rutas = new Set(Object.keys(INS.tolls).map(k => k.split('|')[0]));
    const zonas = new Set();
    Object.keys(INS.extras).forEach(id => { const c = (db.extraCosts || []).find(x => x.id === id); if (c) zonas.add(c.zona_id); });
    INS.extrasNew.forEach(c => zonas.add(c.zona_id));
    INS.extrasDel.forEach(id => { const c = (db.extraCosts || []).find(x => x.id === id); if (c) zonas.add(c.zona_id); });
    combos = combos.filter(x => rutas.has(x.ruta.id) || zonas.has(x.ruta.id_zona_transporte));
  }
  if (!combos.length) return 'sin efecto en el motor de costos';
  const idx0 = indice(db.routeTolls, db.extraCosts);
  const idx1 = indice(tollsEfectivos(db), extrasEfectivos(db));
  const cfg1 = cfgEfectivo(cfg);
  const antes = {}, despues = {};
  combos.forEach(x => {
    if (!INS.memo.has(x.key)) INS.memo.set(x.key, costoRuta(db, idx0, cfg, x.ruta, x.truck.capKg).item10_costoRutaTotal);
    antes[x.key] = INS.memo.get(x.key);
    despues[x.key] = costoRuta(db, idx1, cfg1, x.ruta, x.truck.capKg).item10_costoRutaTotal;
  });
  return textoImpacto(antes, despues, 'costos de ruta del motor');
}

// ── Guardar todo el borrador ────────────────────────────────────────────────
function guardarBorrador(db, cfg) {
  if (!contarCambios(db)) return;
  const by = usuarioSesion(), at = new Date().toISOString();
  const sync = new Set();
  const n = INS._n;

  // 1) Parámetros de configuración
  const fuelTocados = new Set();
  Object.entries(INS.cfg).forEach(([p, v]) => {
    setPath(cfg, p, v);
    sync.add('tariffConfig');
    const m = p.match(/^combustibles\.([^.]+)\.(precioLitro|fecha)$/);
    if (m) fuelTocados.add(m[1]);
  });
  fuelTocados.forEach(rep => {
    const f = cfg.combustibles[rep] || (cfg.combustibles[rep] = {});
    const cne = INS.cne[rep];
    if (cne && igualNum(cne.precio, f.precioLitro)) {
      Object.assign(f, { fuente: 'cne', cneRegion: cne.region, cneMes: cne.mes, cneAnio: cne.anio });
    } else {
      f.fuente = 'manual';
      delete f.cneRegion; delete f.cneMes; delete f.cneAnio;
    }
    if (!(`combustibles.${rep}.fecha` in INS.cfg)) f.fecha = hoyISO();
    if (!(num(f.ivaPct) > 0)) f.ivaPct = 19;
  });
  // IVA nunca en 0 (regla vigente)
  Object.values(cfg.combustibles || {}).forEach(f => { if (f && f.ivaPct != null && !(num(f.ivaPct) > 0)) f.ivaPct = 19; });

  // 2) Concesiones
  if (Object.keys(INS.conc).length || INS.concNew.length || INS.concDel.length) {
    sync.add('tariffConfig');
    cfg.concesionesVariacion = cfg.concesionesVariacion || {};
    cfg.concesionesExtra = cfg.concesionesExtra || [];
    Object.entries(INS.conc).forEach(([nom, v]) => { if (num(v)) cfg.concesionesVariacion[nom] = num(v); else delete cfg.concesionesVariacion[nom]; });
    INS.concDel.forEach(nom => {
      cfg.concesionesExtra = cfg.concesionesExtra.filter(c => c.nombre !== nom);
      delete cfg.concesionesVariacion[nom];
    });
    INS.concNew.filter(c => (c.n || '').trim()).forEach(c => {
      const nombre = c.n.trim();
      if (!cfg.concesionesExtra.some(x => x.nombre === nombre)) {
        cfg.concesionesExtra.push({ nombre, ruta: (c.ru || '').trim(), tramo: (c.tr || '').trim(), region: (c.rg || '').trim(), tipo: c.tp || 'Autopista', by, at });
      }
      if (num(c.v)) cfg.concesionesVariacion[nombre] = num(c.v);
    });
  }

  // 3) Peajes: el valor original queda en cfg.peajesOriginal; la fila se marca 'manual'
  const tk = Object.keys(INS.tolls);
  if (tk.length) {
    sync.add('routeTolls');
    cfg.peajesOriginal = cfg.peajesOriginal || {};
    db.routeTolls = db.routeTolls || [];
    tk.forEach(k => {
      const [routeId, ejesS] = k.split('|');
      const ejes = Number(ejesS);
      const v = INS.tolls[k];
      let row = tollGuardado(db, routeId, ejes);
      if (!row) {
        const ruta = (db.routes || []).find(r => r.id === routeId);
        row = { id: `tj_${routeId}_${ejes}`, route_id: routeId, codigo: ruta?.codigo || null, ejes, peaje_ida: 0, peaje_vuelta: 0, needs_review: false, calculado_en: at, source: null };
        db.routeTolls.push(row);
      }
      if (!cfg.peajesOriginal[k]) {
        cfg.peajesOriginal[k] = { ida: num(row.peaje_ida), vuelta: num(row.peaje_vuelta), source: row.source || null };
        sync.add('tariffConfig');
      }
      const o = cfg.peajesOriginal[k];
      row.peaje_ida = Math.round(num(v.ida));
      row.peaje_vuelta = Math.round(num(v.vuelta));
      row.needs_review = false;
      row.updated_at = at;
      row.updated_by = by;
      if (igualNum(o.ida, row.peaje_ida) && igualNum(o.vuelta, row.peaje_vuelta)) {
        row.source = o.source || null;
        delete cfg.peajesOriginal[k];
        sync.add('tariffConfig');
      } else {
        row.source = 'manual';
      }
    });
  }

  // 4) Costos extra (por ejes)
  const aBorrar = [...INS.extrasDel];
  if (Object.keys(INS.extras).length || INS.extrasNew.length || aBorrar.length) {
    sync.add('extraCosts');
    db.extraCosts = (db.extraCosts || []).filter(c => !aBorrar.includes(c.id));
    Object.entries(INS.extras).forEach(([id, o]) => {
      const c = db.extraCosts.find(x => x.id === id);
      if (c && extraCambiado({ extraCosts: [c] }, id)) Object.assign(c, o, { updated_at: at, updated_by: by });
    });
    INS.extrasNew.forEach(c => {
      const { _tmp, ...fila } = c;
      db.extraCosts.push({ ...fila, id: `ce_${fila.zona_id}_${fila.ejes}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, created_at: at, updated_at: at, updated_by: by });
    });
  }

  descartar();
  INS.memo = new Map();
  if (sync.size) saveDatabase(db, { syncOnly: [...sync] });
  aBorrar.forEach(id => deleteRow('extraCosts', id).catch(err => console.error('Error al borrar costo extra:', err.message || err)));
  showAlert(`Cambios guardados (${n}). El motor de costos ya usa los valores nuevos; para llevarlos a las tarifas usa «Refrescar tarifas» en Tarifas por Camión.`, 'success');
}

// ── Marco común de las vistas de insumos ────────────────────────────────────
function marco({ titulo, desc, activo, acciones = '', cuerpo, db, cfg }) {
  const n = contarCambios(db);
  return `<div class="sv-view">
    ${changesBarHtml(n, n ? textoImpactoInsumos(db, cfg) : '', INS.guardando)}
    <div class="sv-vhead">
      <div style="min-width:0"><h1 class="sv-h1">${esc(titulo)}</h1><div class="sv-desc">${esc(desc)}</div></div>
      <div class="sv-actions">${acciones}</div>
    </div>
    ${chainHtml('transporte', activo)}
    ${cuerpo}
  </div>`;
}
function cablearMarco(container, db, cfg, render) {
  wireChain(container);
  wireChangesBar(container, () => { descartar(); render(); }, () => { guardarBorrador(db, cfg); render(); });
}

// ============================================================================
// PEAJES
// ============================================================================
const CONCESIONES_CHILE = [
  { nombre: 'COPSA', ruta: 'Ruta 5 Norte', tramo: 'Los Vilos – La Serena', region: 'Coquimbo', tipo: 'Autopista' },
  { nombre: 'COVICORVI', ruta: 'Ruta 5 Norte', tramo: 'La Serena – Vallenar', region: 'Atacama', tipo: 'Autopista' },
  { nombre: 'Nuevo Camino', ruta: 'Ruta 5 Norte', tramo: 'Vallenar – Caldera', region: 'Atacama', tipo: 'Autopista' },
  { nombre: 'Autopista del Itata', ruta: 'Ruta 5 Sur', tramo: 'Talca – Chillán', region: 'Maule / Ñuble', tipo: 'Autopista' },
  { nombre: 'Ruta del Maipo', ruta: 'Ruta 5 Sur', tramo: 'Chillán – Collipulli', region: 'Ñuble / La Araucanía', tipo: 'Autopista' },
  { nombre: 'COVISUR', ruta: 'Ruta 5 Sur', tramo: 'Collipulli – Temuco', region: 'La Araucanía', tipo: 'Autopista' },
  { nombre: 'Ruta de la Araucanía', ruta: 'Ruta 5 Sur', tramo: 'Temuco – Río Bueno', region: 'La Araucanía / Los Ríos', tipo: 'Autopista' },
  { nombre: 'Ruta de los Ríos', ruta: 'Ruta 5 Sur', tramo: 'Río Bueno – Puerto Montt', region: 'Los Ríos / Los Lagos', tipo: 'Autopista' },
  { nombre: 'Autopista Central', ruta: 'Ruta 5 / Norte-Sur', tramo: 'Autopista Urbana Norte-Sur', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Costanera Norte', ruta: 'Ruta 78', tramo: 'Costanera Norte expreso', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Vespucio Norte Express', ruta: 'Américo Vespucio Norte', tramo: 'Avenida Las Rejas – El Salto', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Américo Vespucio Sur Express', ruta: 'Américo Vespucio Sur', tramo: 'Lo Ovalle – Príncipe de Gales', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Autopista Vespucio Oriente', ruta: 'Américo Vespucio Oriente', tramo: 'Las Vizcachas – El Salto', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Túnel San Cristóbal', ruta: 'Ruta Sin Número', tramo: 'Providencia – Recoleta', region: 'Región Metropolitana', tipo: 'Túnel' },
  { nombre: 'Acceso Nororiente', ruta: 'Ruta G-21', tramo: 'Príncipe de Gales – Av. El Golf', region: 'Región Metropolitana', tipo: 'Urbana TAG' },
  { nombre: 'Rutas del Pacífico', ruta: 'Ruta 68', tramo: 'Santiago – Valparaíso / Viña', region: 'Valparaíso', tipo: 'Autopista' },
  { nombre: 'Litoral Central', ruta: 'Ruta 68', tramo: 'Casablanca – Larapinta', region: 'Valparaíso', tipo: 'Autopista' },
  { nombre: 'Autopista Los Libertadores', ruta: 'Ruta 57 CH', tramo: 'Santiago – Los Andes', region: 'Valparaíso', tipo: 'Autopista' },
  { nombre: 'Túnel El Melón', ruta: 'Ruta 60 CH', tramo: 'Nogales – Calera (Túnel)', region: 'Valparaíso', tipo: 'Túnel' },
  { nombre: 'Autopista del Sol', ruta: 'Ruta 78', tramo: 'Santiago – San Antonio', region: 'Región Metropolitana', tipo: 'Autopista' },
  { nombre: 'Variante Melipilla', ruta: 'Ruta 78', tramo: 'Santiago – Melipilla', region: 'Región Metropolitana', tipo: 'Autopista' },
];
const TIPOS_CONC = ['Autopista', 'Urbana TAG', 'Túnel'];
const tonoConc = t => (t === 'Urbana TAG' ? 'mute' : t === 'Túnel' ? 'purple' : 'info');

const PJ = { tab: 'reg', centro: 'all', q: '', kpi: 'all', pagina: 0, edit: null, cq: '', ctipo: 'all' };
export function setPeajesTab(t) { if (['reg', 'inter', 'conc'].includes(t)) { PJ.tab = t; PJ.pagina = 0; PJ.kpi = 'all'; } }

export function renderPeajesV2(container, db, cfg) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();

  const original = (routeId, ejes, t) => {
    const o = (cfg.peajesOriginal || {})[`${routeId}|${ejes}`];
    if (o) return { ida: num(o.ida), vuelta: num(o.vuelta) };
    return { ida: num(t?.peaje_ida), vuelta: num(t?.peaje_vuelta) };
  };

  function tramos() {
    const cls = PJ.tab === 'inter' ? 'Interregional' : 'Regional';
    const out = [];
    (db.routes || []).filter(r => r.activo && r.clasificRuta === cls && (r.tipo || '').toUpperCase() === 'COMUNA')
      .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''))
      .forEach(ruta => [2, 3].forEach(ejes => out.push({ ruta, ejes, key: `${ruta.id}|${ejes}` })));
    return out;
  }
  const estado = x => { const v = tollValores(db, x.ruta.id, x.ejes); return v.ida + v.vuelta > 0 ? 'calc' : 'sin'; };
  const esManual = x => {
    const v = tollValores(db, x.ruta.id, x.ejes);
    const o = original(x.ruta.id, x.ejes, tollGuardado(db, x.ruta.id, x.ejes));
    return !igualNum(v.ida, o.ida) || !igualNum(v.vuelta, o.vuelta);
  };

  function render() {
    const acciones = PJ.tab === 'conc' ? '' : `<button class="sv-btn" data-csv id="pj-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button>`;
    const tabs = `<div class="tf-tabs">${[['reg', 'toll', 'Peajes regionales'], ['inter', 'alt_route', 'Peajes interregionales'], ['conc', 'account_balance', 'Administrador de concesiones']]
      .map(([k, ic, l]) => `<button data-chip data-pjtab="${k}" class="${PJ.tab === k ? 'is-on' : ''}"><span class="material-symbols-outlined">${ic}</span>${l}</button>`).join('')}</div>`;
    const cuerpo = tabs + (PJ.tab === 'conc' ? cuerpoConcesiones() : cuerpoTramos());
    container.innerHTML = marco({ titulo: 'Peajes', desc: 'Valor peajes por ruta y ejes. Usa el lápiz para ingresar un valor manual; queda marcado en morado.', activo: 'peajes', acciones, cuerpo, db, cfg });
    wire();
  }

  function cuerpoTramos() {
    const todos = tramos();
    const q = PJ.q.trim().toLowerCase();
    const base = todos.filter(x => rutaEnGrupo(grupos, x.ruta, PJ.centro) && (!q || `${x.ruta.codigo} ${x.ruta.destino}`.toLowerCase().includes(q)));
    const lista = PJ.kpi === 'all' ? base : PJ.kpi === 'manual' ? base.filter(esManual) : base.filter(x => estado(x) === PJ.kpi);
    const nCalc = base.filter(x => estado(x) === 'calc').length, nMan = base.filter(esManual).length;
    const pags = Math.max(1, Math.ceil(lista.length / PAGE_PJ));
    if (PJ.pagina >= pags) PJ.pagina = pags - 1;
    const pag = lista.slice(PJ.pagina * PAGE_PJ, (PJ.pagina + 1) * PAGE_PJ);
    return `<div class="sv-kpis">
        ${kpiHtml(PJ.kpi === 'all', 'data-pjkpi', 'all', 'Tramos', fmt(base.length), 'ruta × ejes con el filtro', '#191c1d')}
        ${kpiHtml(PJ.kpi === 'calc', 'data-pjkpi', 'calc', 'Peaje calculado', fmt(nCalc), 'con plazas de peaje', '#1d4ed8')}
        ${kpiHtml(PJ.kpi === 'sin', 'data-pjkpi', 'sin', 'Sin peaje', fmt(base.length - nCalc), 'rutas sin plazas', '#9ca3af')}
        ${kpiHtml(PJ.kpi === 'manual', 'data-pjkpi', 'manual', 'Valor manual', fmt(nMan), 'distinto al calculado', '#7e22ce')}
      </div>
      <div class="sv-filters">
        <div class="sv-frow"><label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="pj-q" placeholder="Código o destino" value="${esc(PJ.q)}" style="width:220px"></label></div>
        ${centroChips(grupos, PJ.centro, 'data-pjcentro')}
      </div>
      <div class="sv-card">
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:960px">
          <thead><tr><th>Ruta</th><th>Origen</th><th>Destino</th><th>Ejes</th><th class="r">Peaje ida</th><th class="r">Peaje vuelta</th><th class="r">KM</th><th>Estado</th><th style="text-align:center">Editar</th></tr></thead>
          <tbody>${pag.length ? pag.map(filaTramo).join('') : '<tr class="sv-empty"><td colspan="9">No hay tramos para los filtros.</td></tr>'}</tbody>
        </table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} de ${fmt(todos.length)} tramos</span>
          <span style="display:flex;gap:12px;align-items:center">KM de ida (un sentido)${pagerHtml(lista.length, PJ.pagina, PAGE_PJ, 'data-pjpag')}</span></div>
      </div>`;
  }

  function filaTramo(x) {
    const { ruta, ejes, key } = x;
    const ed = PJ.edit === key;
    const v = tollValores(db, ruta.id, ejes);
    const g = tollGuardado(db, ruta.id, ejes);
    const ch = !!INS.tolls[key];
    const est = estado(x);
    const o = original(ruta.id, ejes, g);
    const celda = (campo, val) => { const m = !igualNum(val, o[campo]); return ed
      ? numIn(`pj|${key}|${campo}`, val, { changed: ch, pre: '$', w: '110px', label: `Peaje ${campo} ${ruta.codigo}` })
      : `<span class="${m ? 'tf-man-v' : ''}">${clp(val)}</span>${m ? `<div class="sv-sub" style="text-align:right;color:#7e22ce">manual · calc. ${clp(o[campo])}</div>` : ''}`; };
    return `<tr class="${ed || ch ? 'tf-row-ed' : ''}" style="cursor:default">
      <td><span class="sv-mono">${esc(ruta.codigo || '')}</span></td>
      <td><span class="sv-b">${esc(nombreCentro(db, grupos, ruta))}</span><div class="sv-sub">${esc(ruta.origenId || '')}</div></td>
      <td>${esc(ruta.destino || '')}</td>
      <td style="white-space:nowrap">${ejes} ejes<div class="sv-sub">${EJES_SUB[ejes]}</div></td>
      <td class="r">${celda('ida', v.ida)}</td>
      <td class="r">${celda('vuelta', v.vuelta)}</td>
      <td class="r">${ruta.km != null ? fmt(Number(ruta.km), 1) : '—'}</td>
      <td>${est === 'calc' ? pillHtml('Peaje calculado', 'info') : pillHtml('Sin peaje', 'mute')}${g && g.needs_review ? '<div class="sv-sub" style="color:#ca8a04">marcado para revisión</div>' : ''}</td>
      <td style="text-align:center">${editar ? `<button class="tf-actbtn" data-chip data-pjedit="${esc(key)}" title="${ed ? 'Listo' : 'Editar valor manual'}"><span class="material-symbols-outlined">${ed ? 'check' : 'edit'}</span></button>` : ''}</td>
    </tr>`;
  }

  function listaConcesiones() {
    const extra = (cfg.concesionesExtra || []).filter(c => !INS.concDel.includes(c.nombre)).map(c => ({ ...c, _extra: true }));
    return [...CONCESIONES_CHILE, ...extra];
  }
  function cuerpoConcesiones() {
    const q = PJ.cq.trim().toLowerCase();
    const todas = listaConcesiones();
    const lista = todas.filter(c => (PJ.ctipo === 'all' || c.tipo === PJ.ctipo) && (!q || `${c.nombre} ${c.ruta} ${c.tramo} ${c.region}`.toLowerCase().includes(q)));
    const varDe = c => (c.nombre in INS.conc ? INS.conc[c.nombre] : (cfg.concesionesVariacion || {})[c.nombre]);
    const vals = todas.map(c => num(varDe(c)));
    const conVar = vals.filter(v => v).length;
    const prom = conVar ? vals.filter(v => v).reduce((s, v) => s + v, 0) / conVar : 0;
    const rutasAf = nom => new Set((cfg.peajes || []).filter(p => p.concesionaria === nom).map(p => p.rutaId)).size;
    const filaNueva = (c, i) => `<tr class="tf-row-new">
      <td>${txtIn(`cn|${i}|n`, c.n, { w: '180px', placeholder: 'Nombre concesionaria', changed: !c.n })}</td>
      <td>${txtIn(`cn|${i}|ru`, c.ru, { w: '120px', placeholder: 'Ej: Ruta 5 Sur' })}</td>
      <td>${txtIn(`cn|${i}|tr`, c.tr, { w: '170px', placeholder: 'Desde – hasta' })}</td>
      <td>${txtIn(`cn|${i}|rg`, c.rg, { w: '130px', placeholder: 'Región' })}</td>
      <td><select class="tf-sel" data-cntipo="${i}">${TIPOS_CONC.map(t => `<option ${t === c.tp ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td class="r" style="color:#9ca3af">—</td>
      <td class="r">${numIn(`cnv|${i}`, c.v || '', { unit: '%', w: '84px', changed: true, label: 'Variación nueva concesión' })}</td>
      <td style="text-align:center"><button class="tf-actbtn" data-chip data-cnrm="${i}" title="Quitar"><span class="material-symbols-outlined">delete</span></button></td></tr>`;
    return `<div class="sv-kpis">
        ${kpiHtml(false, '', '', 'Concesionarias', fmt(todas.length), 'registradas', '#191c1d', false)}
        ${kpiHtml(false, '', '', 'Con variación', fmt(conVar), 'reajuste anual informado', '#ca8a04', false)}
        ${kpiHtml(false, '', '', 'Variación promedio', `${fmt(prom, 1)}%`, 'de las que tienen reajuste', '#1d4ed8', false)}
      </div>
      <div class="sv-filters"><div class="sv-frow">
        <div class="sv-seg">${['all', ...TIPOS_CONC].map(t => `<button data-chip data-cntipof="${esc(t)}" class="${PJ.ctipo === t ? 'is-on' : ''}">${t === 'all' ? 'Todas' : esc(t)}</button>`).join('')}</div>
        <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="cn-q" placeholder="Nombre, ruta o tramo" value="${esc(PJ.cq)}" style="width:220px"></label>
      </div></div>
      <div class="sv-card">
        <div class="tf-tabletitle"><div><h3>Concesiones viales</h3><small>La variación anual se aplica a los peajes manuales que tengan asignada la concesionaria</small></div>
          ${editar ? '<button class="sv-btn" id="cn-add"><span class="material-symbols-outlined">add</span>Agregar concesión</button>' : ''}</div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:1040px">
          <thead><tr><th>Concesionaria</th><th>Ruta</th><th>Tramo</th><th>Región</th><th>Tipo</th><th class="r">Rutas c/peaje</th><th class="r">Variación anual</th><th></th></tr></thead>
          <tbody>
            ${lista.map(c => { const v = varDe(c); const ch = c.nombre in INS.conc; const n = rutasAf(c.nombre);
              return `<tr style="cursor:default"><td><b>${esc(c.nombre)}</b></td><td><span class="sv-mono">${esc(c.ruta || '')}</span></td><td>${esc(c.tramo || '')}</td><td>${esc(c.region || '')}</td>
                <td>${pillHtml(c.tipo, tonoConc(c.tipo))}</td><td class="r">${n ? fmt(n) : '<span style="color:#9ca3af">—</span>'}</td>
                <td class="r">${numIn(`cv|${c.nombre}`, v ?? '', { unit: '%', w: '84px', changed: ch, disabled: !editar, placeholder: '0', label: 'Variación ' + c.nombre })}</td>
                <td style="text-align:center">${c._extra && editar ? `<button class="tf-actbtn" data-chip data-cndel="${esc(c.nombre)}" title="Quitar concesión"><span class="material-symbols-outlined">delete</span></button>` : ''}</td></tr>`; }).join('')}
            ${INS.concNew.map(filaNueva).join('')}
            ${!lista.length && !INS.concNew.length ? '<tr class="sv-empty"><td colspan="8">Sin concesiones para los filtros.</td></tr>' : ''}
          </tbody></table></div>
        <div class="sv-tfoot"><span>${fmt(todas.length)} concesionarias</span><span>Las filas nuevas quedan en amarillo hasta guardar</span></div>
      </div>`;
  }

  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);

  function wire() {
    cablearMarco(container, db, cfg, render);
    container.querySelectorAll('[data-pjtab]').forEach(b => b.addEventListener('click', () => { PJ.tab = b.dataset.pjtab; PJ.pagina = 0; PJ.kpi = 'all'; PJ.edit = null; render(); }));
    container.querySelectorAll('[data-pjcentro]').forEach(b => b.addEventListener('click', () => { PJ.centro = b.dataset.pjcentro; PJ.pagina = 0; render(); }));
    container.querySelectorAll('[data-pjkpi]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.pjkpi; PJ.kpi = PJ.kpi === k ? 'all' : k; PJ.pagina = 0; render(); }));
    container.querySelectorAll('[data-pjpag]').forEach(b => b.addEventListener('click', () => { PJ.pagina += Number(b.dataset.pjpag); render(); window.scrollTo({ top: 0 }); }));
    container.querySelectorAll('[data-pjedit]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.pjedit; PJ.edit = PJ.edit === k ? null : k; render(); }));
    const q = container.querySelector('#pj-q');
    q?.addEventListener('input', () => { PJ.q = q.value; PJ.pagina = 0; const pos = q.selectionStart; render(); const n = container.querySelector('#pj-q'); n.focus(); n.setSelectionRange(pos, pos); });
    const cq = container.querySelector('#cn-q');
    cq?.addEventListener('input', () => { PJ.cq = cq.value; const pos = cq.selectionStart; render(); const n = container.querySelector('#cn-q'); n.focus(); n.setSelectionRange(pos, pos); });
    container.querySelectorAll('[data-cntipof]').forEach(b => b.addEventListener('click', () => { PJ.ctipo = b.dataset.cntipof; render(); }));
    container.querySelector('#cn-add')?.addEventListener('click', () => { INS.concNew.push({ n: '', ru: '', tr: '', rg: '', tp: 'Autopista', v: 0 }); render(); });
    container.querySelectorAll('[data-cnrm]').forEach(b => b.addEventListener('click', () => { INS.concNew.splice(Number(b.dataset.cnrm), 1); render(); }));
    container.querySelectorAll('[data-cndel]').forEach(b => b.addEventListener('click', () => { INS.concDel.push(b.dataset.cndel); render(); }));
    container.querySelectorAll('[data-cntipo]').forEach(s => s.addEventListener('change', () => { INS.concNew[Number(s.dataset.cntipo)].tp = s.value; }));
    wireTxtIns(container, (key, val) => {
      const [, i, f] = key.split('|');
      if (INS.concNew[Number(i)]) INS.concNew[Number(i)][f] = val;
    });
    wireNumIns(container, (key, val) => {
      if (key.startsWith('pj|')) {
        const [, routeId, ejes, campo] = key.split('|');
        const k = `${routeId}|${ejes}`;
        const cur = { ...tollValores(db, routeId, ejes) };
        cur[campo] = val;
        if (campo === 'ida' && PJ.tab === 'inter') cur.vuelta = val;   // interregional: ida se replica a vuelta (regla vigente)
        const g = tollGuardado(db, routeId, ejes);
        if (igualNum(cur.ida, g?.peaje_ida) && igualNum(cur.vuelta, g?.peaje_vuelta)) delete INS.tolls[k]; else INS.tolls[k] = cur;
      } else if (key.startsWith('cv|')) {
        const nom = key.slice(3);
        if (igualNum(val, (cfg.concesionesVariacion || {})[nom])) delete INS.conc[nom]; else INS.conc[nom] = val;
      } else if (key.startsWith('cnv|')) {
        const i = Number(key.slice(4));
        if (INS.concNew[i]) INS.concNew[i].v = val;
        return;
      }
      recalc();
    });
    container.querySelector('#pj-csv')?.addEventListener('click', () => {
      const q2 = PJ.q.trim().toLowerCase();
      const filas = tramos().filter(x => rutaEnGrupo(grupos, x.ruta, PJ.centro) && (!q2 || `${x.ruta.codigo} ${x.ruta.destino}`.toLowerCase().includes(q2)));
      const rows = [];
      filas.forEach(x => {
        const g = tollGuardado(db, x.ruta.id, x.ejes);
        const tipos = x.ejes === 2 ? ['5T', '10T'] : ['15T', '28T'];
        tipos.forEach(t => rows.push([x.ruta.codigo, nombreCentro(db, grupos, x.ruta), x.ruta.destino || '', t, Math.round(num(g?.peaje_ida)), Math.round(num(g?.peaje_vuelta)), g?.source === 'manual' ? 'MANUAL' : (num(g?.peaje_ida) + num(g?.peaje_vuelta) > 0 ? 'PEAJE CALCULADO' : 'SIN PEAJE')]));
      });
      descargarCsv(`peajes_${PJ.tab}_${hoyISO()}.csv`, ['RUTA', 'ORIGEN', 'DESTINO', 'TIPO_CAMION', 'PEAJE_IDA', 'PEAJE_VUELTA', 'ESTADO'], rows);
    });
  }

  render();
}

// ============================================================================
// COMBUSTIBLES Y RENDIMIENTOS
// ============================================================================
const CNE_FUNCTION_URL = 'https://humhokvdowfqicjopbhf.supabase.co/functions/v1/cne-diesel-price';

export function renderCombustiblesV2(container, db, cfg) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();
  cfg.combustibles = cfg.combustibles || {};
  cfg.rendimientos = cfg.rendimientos || {};
  let cneMsg = '';

  function render() {
    const hoy = new Date();
    const filas = grupos.map(g => {
      const precio = num(valCfg(cfg, `combustibles.${g.repId}.precioLitro`));
      const iva = num(valCfg(cfg, `combustibles.${g.repId}.ivaPct`)) || 19;
      const fecha = valCfg(cfg, `combustibles.${g.repId}.fecha`) || '';
      const dias = fecha ? Math.floor((hoy - new Date(fecha + 'T12:00:00')) / 86400000) : null;
      return { g, precio, iva, fecha, dias, revisar: dias == null || dias > DIAS_REVISAR_DIESEL };
    });
    const conPrecio = filas.filter(f => f.precio > 0);
    const prom = conPrecio.length ? conPrecio.reduce((s, f) => s + f.precio, 0) / conPrecio.length : 0;
    const r28 = num(valCfg(cfg, 'rendimientos.28000.cargado'));
    const P = p => `combustibles.${p}`;
    const cuerpo = `<div class="sv-kpis">
        ${kpiHtml(false, '', '', 'Diésel promedio', clp(prom), 'por litro, con IVA', '#191c1d', false)}
        ${kpiHtml(false, '', '', 'Por revisar', fmt(filas.filter(f => f.revisar).length), `centros sin actualizar en ${DIAS_REVISAR_DIESEL} días`, '#ca8a04', false)}
        ${kpiHtml(false, '', '', 'Rendimiento 28 t', `${fmt(r28, 1)} km/l`, 'cargado (ida)', '#1d4ed8', false)}
      </div>
      ${cneMsg}
      <div class="tf-grid">
        <div class="sv-card" style="flex:1 1 600px">
          <div class="tf-tabletitle"><div><h3>Precio del diésel por centro</h3><small>El motor descuenta el IVA antes de calcular</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:640px">
            <thead><tr><th>Centro logístico</th><th class="r">Precio c/IVA</th><th class="r">IVA</th><th class="r">Precio neto</th><th>Actualizado</th><th>Estado</th></tr></thead>
            <tbody>${filas.map(f => `<tr style="cursor:default">
              <td><span class="sv-b">${esc(f.g.nombre)}</span><div class="sv-sub">${esc(f.g.centroIds.join(' · '))}</div></td>
              <td class="r">${numIn(P(`${f.g.repId}.precioLitro`), f.precio || '', { unit: '$/l', w: '112px', changed: P(`${f.g.repId}.precioLitro`) in INS.cfg, disabled: !editar, label: 'Precio diésel ' + f.g.nombre })}</td>
              <td class="r">${numIn(P(`${f.g.repId}.ivaPct`), f.iva, { unit: '%', w: '72px', changed: P(`${f.g.repId}.ivaPct`) in INS.cfg, disabled: !editar, label: 'IVA ' + f.g.nombre })}</td>
              <td class="r"><b>${f.precio ? clp(f.precio / (1 + f.iva / 100)) : '—'}</b></td>
              <td>${txtIn(P(`${f.g.repId}.fecha`), f.fecha, { type: 'date', w: '150px', changed: P(`${f.g.repId}.fecha`) in INS.cfg, disabled: !editar, label: 'Fecha ' + f.g.nombre })}</td>
              <td>${f.dias == null ? pillHtml('Sin datos', 'mute') : f.revisar ? pillHtml(`Revisar · ${f.dias} d`, 'warn') : pillHtml('Vigente', 'ok')}</td></tr>`).join('')}</tbody>
          </table></div>
          <div class="tf-card-foot"><span>Al guardar un precio nuevo, la fecha queda en hoy</span></div>
        </div>
        <div class="sv-card" style="flex:1 1 400px">
          <div class="tf-tabletitle"><div><h3>Rendimiento por camión</h3><small>Km por litro; la vuelta se calcula vacía</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:420px">
            <thead><tr><th>Camión</th><th class="r">Cargado (ida)</th><th class="r">Vacío (vuelta)</th><th style="text-align:center">Ejes</th></tr></thead>
            <tbody>${CAP_LIST.map(cap => `<tr style="cursor:default"><td><span class="sv-b">${capLbl(cap)}</span><div class="sv-sub">${fmt(cap)} kg</div></td>
              <td class="r">${numIn(`rendimientos.${cap}.cargado`, valCfg(cfg, `rendimientos.${cap}.cargado`), { unit: 'km/l', w: '96px', changed: `rendimientos.${cap}.cargado` in INS.cfg, disabled: !editar })}</td>
              <td class="r">${numIn(`rendimientos.${cap}.vacio`, valCfg(cfg, `rendimientos.${cap}.vacio`), { unit: 'km/l', w: '96px', changed: `rendimientos.${cap}.vacio` in INS.cfg, disabled: !editar })}</td>
              <td style="text-align:center">${ejesDeCap(cfg, cap)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
    const acciones = editar ? `<button class="sv-btn" data-chip id="cne-btn"><span class="material-symbols-outlined">cloud_download</span>Traer precios CNE</button>` : '';
    container.innerHTML = marco({ titulo: 'Combustibles y Rendimientos', desc: 'Precio de combustibles y rendimientos por camión.', activo: 'combustibles', acciones, cuerpo, db, cfg });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablearMarco(container, db, cfg, render);
    wireNumIns(container, (key, val) => { setCfgDraft(cfg, key, val); recalc(); });
    wireTxtIns(container, (key, val) => { setCfgDraft(cfg, key, val, true); render(); });
    container.querySelector('#cne-btn')?.addEventListener('click', async () => {
      const b = container.querySelector('#cne-btn');
      b.disabled = true; b.innerHTML = '<span class="material-symbols-outlined">sync</span>Consultando CNE…';
      try {
        const res = await fetch(CNE_FUNCTION_URL);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Error desconocido en la función CNE');
        let n = 0;
        grupos.forEach(g => {
          const e = json.data[String(g.grupo).toUpperCase()];
          if (!e) return;
          INS.cne[g.repId] = { precio: e.precio, region: e.region, mes: e.mes, anio: e.anio };
          setCfgDraft(cfg, `combustibles.${g.repId}.precioLitro`, e.precio);
          n++;
        });
        cneMsg = `<div class="sv-note-box" style="margin:0">Precios CNE cargados en ${n} centros como borrador. Revísalos y usa «Guardar y recalcular».</div>`;
      } catch (err) {
        cneMsg = `<div class="sv-note-box" style="margin:0;border-color:#fecaca;background:#fef2f2;color:#991b1b">No se pudo consultar la CNE: ${esc(err.message)}</div>`;
      }
      render();
    });
  }
  render();
}

// ============================================================================
// SEGUROS Y PERMISOS
// ============================================================================
export function renderSegurosV2(container, db, cfg) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();
  cfg.seguros = cfg.seguros || {};
  cfg.soapTransversal = cfg.soapTransversal || {};
  cfg.permisosSoap = cfg.permisosSoap || {};

  function render() {
    const uf = num(valCfg(cfg, 'variables.valorUF'));
    const inCh = p => p in INS.cfg;
    const cuerpo = `<div class="tf-grid">
        <div class="sv-card" style="flex:1 1 440px">
          <div class="tf-tabletitle"><div><h3>Seguro de carga</h3><small>UF mensuales por centro; se prorratea por km ofrecido · UF ${clp(uf)} (se edita en Variables)</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:420px">
            <thead><tr><th>Centro logístico</th><th class="r">Seguro</th><th class="r">Equivalente CLP/mes</th></tr></thead>
            <tbody>${grupos.map(g => { const p = `seguros.${g.repId}`; const v = num(valCfg(cfg, p));
              return `<tr style="cursor:default"><td><span class="sv-b">${esc(g.nombre)}</span><div class="sv-sub">${esc(g.centroIds.join(' · '))}</div></td>
                <td class="r">${numIn(p, v, { unit: 'UF/mes', w: '120px', changed: inCh(p), disabled: !editar })}</td>
                <td class="r"><b>${clp(v * uf)}</b></td></tr>`; }).join('')}</tbody>
          </table></div>
        </div>
        <div class="sv-card" style="flex:1 1 360px">
          <div class="tf-tabletitle"><div><h3>SOAP por camión</h3><small>Valor anual, igual para todos los centros</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:320px">
            <thead><tr><th>Camión</th><th class="r">SOAP anual</th></tr></thead>
            <tbody>${CAP_LIST.map(cap => { const p = `soapTransversal.${cap}`;
              return `<tr style="cursor:default"><td><span class="sv-b">${capLbl(cap)}</span><div class="sv-sub">${fmt(cap)} kg</div></td>
                <td class="r">${numIn(p, valCfg(cfg, p) || 0, { pre: '$', w: '130px', changed: inCh(p), disabled: !editar })}</td></tr>`; }).join('')}</tbody>
          </table></div>
        </div>
      </div>
      <div class="sv-card">
        <div class="tf-tabletitle"><div><h3>Permiso de circulación</h3><small>Anual promediado, por centro y tipo de camión</small></div>
          ${editar ? `<label class="sv-btn" style="cursor:pointer"><span class="material-symbols-outlined">upload_file</span>Cargar CSV<input type="file" accept=".csv" id="ps-csv" hidden></label>` : ''}</div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:${260 + grupos.length * 140}px">
          <thead><tr><th>Camión</th>${grupos.map(g => `<th class="r">${esc(g.nombre)}</th>`).join('')}</tr></thead>
          <tbody>${CAP_LIST.map(cap => `<tr style="cursor:default"><td><span class="sv-b">${capLbl(cap)}</span></td>
            ${grupos.map(g => { const p = `permisosSoap.${g.repId}|${cap}.permiso`; return `<td class="r">${numIn(p, valCfg(cfg, p) || 0, { pre: '$', w: '120px', changed: inCh(p), disabled: !editar, label: `Permiso ${g.nombre} ${cap}` })}</td>`; }).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="tf-card-foot"><span>CSV: columnas Centro_SAP, Tipo_Camion_Kg, Permiso_Circulacion</span></div>
      </div>`;
    container.innerHTML = marco({ titulo: 'Seguros y Permisos', desc: 'Seguro de carga por centro, SOAP y permiso de circulación por camión. SOAP + permiso se prorratean por los km anuales ofrecidos (paso 3 del motor).', activo: 'seguros', cuerpo, db, cfg });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablearMarco(container, db, cfg, render);
    wireNumIns(container, (key, val) => { setCfgDraft(cfg, key, val); recalc(); });
    container.querySelector('#ps-csv')?.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      leerCsv(f, rows => {
        let n = 0;
        rows.forEach(r => {
          const cd = (db.logisticsCentres || []).find(c => c.id === String(r.Centro_SAP || '').trim());
          const cap = capDesdeCsv(r.Tipo_Camion_Kg);
          if (!cd || !CAP_LIST.includes(cap)) return;
          const g = grupos.find(x => x.centroIds.includes(cd.id));
          if (!g) return;
          setCfgDraft(cfg, `permisosSoap.${g.repId}|${cap}.permiso`, num(String(r.Permiso_Circulacion).replace(/\./g, '').replace(',', '.')));
          n++;
        });
        showAlert(`${n} permisos cargados como borrador. Revisa y guarda.`, 'success');
        render();
      });
    });
  }
  render();
}

// ============================================================================
// COSTOS EXTRAS (por ejes)
// ============================================================================
const CE = { centro: 'all', q: '', ejes: 'all', modal: null };
const CE_ITEMS = ['BARCAZA', 'VIÁTICO', 'HOSPEDAJE', 'TRAVESÍA', 'ACARREO', 'PEAJE ESPECIAL', 'PERNOCTE', 'ESCOLTA', 'FLETE ESPECIAL'];

export function renderCostosExtrasV2(container, db, cfg) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();
  const zonas = new Map((db.transportZones || []).map(z => [String(z.zona), z]));
  const rutasPorZona = new Map();
  (db.routes || []).filter(r => r.activo && r.id_zona_transporte).forEach(r => {
    const k = String(r.id_zona_transporte);
    if (!rutasPorZona.has(k)) rutasPorZona.set(k, []);
    rutasPorZona.get(k).push(r);
  });
  const zonaLbl = id => { const z = zonas.get(String(id)); return z ? (z.denominacion || z.comuna || id) : (rutasPorZona.get(String(id))?.[0]?.destino || id); };
  const centrosZona = id => [...new Set((rutasPorZona.get(String(id)) || []).map(r => nombreCentro(db, grupos, r)))];
  const zonaEnCentro = (id, grupo) => grupo === 'all' || (rutasPorZona.get(String(id)) || []).some(r => rutaEnGrupo(grupos, r, grupo));

  function valor(c, f) { return c._tmp ? c[f] : (INS.extras[c.id] && f in INS.extras[c.id] ? INS.extras[c.id][f] : c[f]); }

  function render() {
    const del = new Set(INS.extrasDel);
    const todos = (db.extraCosts || []).filter(c => !del.has(c.id)).concat(INS.extrasNew);
    const q = CE.q.trim().toLowerCase();
    const lista = todos.filter(c => zonaEnCentro(c.zona_id, CE.centro) && (CE.ejes === 'all' || Number(c.ejes) === Number(CE.ejes))
      && (!q || `${c.zona_id} ${zonaLbl(c.zona_id)} ${c.item}`.toLowerCase().includes(q)));
    const activos = todos.filter(c => valor(c, 'activo') !== false);
    const total = lista.filter(c => valor(c, 'activo') !== false).reduce((s, c) => s + num(valor(c, 'costo_ida')) + num(valor(c, 'costo_vuelta')), 0);
    const cuerpo = `<div class="sv-kpis">
        ${kpiHtml(false, '', '', 'Ítems activos', fmt(activos.length), `de ${fmt(todos.length)} registrados`, '#15803d', false)}
        ${kpiHtml(false, '', '', 'Zonas afectadas', fmt(new Set(activos.map(c => c.zona_id)).size), 'con costo extra', '#191c1d', false)}
        ${kpiHtml(false, '', '', 'Total visible', clp(total), 'ida + vuelta, ítems activos', '#b5000b', false)}
      </div>
      <div class="sv-filters">
        <div class="sv-frow">
          <div class="sv-seg">${[['all', 'Todos'], ['2', '2 ejes · 5 y 10 t'], ['3', '3 ejes · 15 y 28 t']].map(([k, l]) => `<button data-chip data-ceejes="${k}" class="${String(CE.ejes) === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
          <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="ce-q" placeholder="Zona, comuna o ítem" value="${esc(CE.q)}" style="width:220px"></label>
        </div>
        ${centroChips(grupos, CE.centro, 'data-cecentro')}
      </div>
      <div class="sv-card">
        <div class="tf-tabletitle"><div><h3>Costos extra por zona de transporte</h3><small>Se suman a ida y vuelta antes del factor de ruta; aplican a todas las rutas de la zona según los ejes del camión</small></div>
          ${editar ? '<button class="sv-btn" id="ce-add"><span class="material-symbols-outlined">add</span>Agregar costo</button>' : ''}</div>
        <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:1100px">
          <thead><tr><th>Zona</th><th>Comuna destino</th><th>Centro origen</th><th>Tipo camión</th><th>Ítem de costo</th><th class="r">Costo ida</th><th class="r">Costo vuelta</th><th class="r">Total</th><th style="text-align:center">Activo</th><th style="text-align:center">Borrar</th></tr></thead>
          <tbody>${lista.length ? lista.map(fila).join('') : '<tr class="sv-empty"><td colspan="10">No hay costos extra para los filtros.</td></tr>'}</tbody>
        </table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} de ${fmt(todos.length)} ítems</span><span>Los ítems inactivos no entran al motor</span></div>
      </div>
      ${CE.modal ? modalHtml() : ''}`;
    container.innerHTML = marco({ titulo: 'Costos Extras', desc: 'Costos adicionales asociados a las rutas. Ej: barcaza, viático.', activo: 'costos-extras', cuerpo, db, cfg });
    wire();
  }

  function fila(c) {
    const id = c._tmp || c.id;
    const on = valor(c, 'activo') !== false;
    const ida = num(valor(c, 'costo_ida')), vta = num(valor(c, 'costo_vuelta'));
    const chF = f => !c._tmp && INS.extras[c.id] && f in INS.extras[c.id] && (f === 'activo' ? INS.extras[c.id][f] !== (c.activo !== false) : !igualNum(INS.extras[c.id][f], c[f]));
    const cls = c._tmp ? 'tf-row-new' : !on ? 'tf-row-off' : '';
    const rutas = rutasPorZona.get(String(c.zona_id)) || [];
    return `<tr class="${cls}" style="cursor:default">
      <td><span class="sv-mono">${esc(c.zona_id || '—')}</span></td>
      <td><span class="sv-b">${esc(zonaLbl(c.zona_id))}</span><div class="sv-sub">${rutas.length ? esc(rutas.slice(0, 3).map(r => r.codigo).join(' · ')) + (rutas.length > 3 ? ` +${rutas.length - 3}` : '') : 'sin rutas activas'}</div></td>
      <td>${esc(centrosZona(c.zona_id).join(', ') || '—')}</td>
      <td style="white-space:nowrap">${Number(c.ejes)} ejes<div class="sv-sub">${EJES_SUB[Number(c.ejes)] || ''}</div></td>
      <td><b>${esc(c.item || '—')}</b>${c._tmp ? '<div class="sv-sub" style="color:#ca8a04">nuevo</div>' : ''}</td>
      <td class="r">${numIn(`ce|${id}|costo_ida`, ida, { pre: '$', w: '120px', changed: c._tmp || chF('costo_ida'), disabled: !editar })}</td>
      <td class="r">${numIn(`ce|${id}|costo_vuelta`, vta, { pre: '$', w: '120px', changed: c._tmp || chF('costo_vuelta'), disabled: !editar })}</td>
      <td class="r"><b style="color:${on ? 'inherit' : '#9ca3af'}">${clp(ida + vta)}</b></td>
      <td style="text-align:center"><button class="tf-sw ${on ? 'is-on' : ''}" data-chip data-cetog="${esc(id)}" ${editar ? '' : 'disabled'} title="${on ? 'Desactivar' : 'Activar'}" aria-label="${on ? 'Desactivar' : 'Activar'}"></button></td>
      <td style="text-align:center">${editar ? `<button class="tf-actbtn" data-chip data-cedel="${esc(id)}" title="Borrar línea"><span class="material-symbols-outlined">delete</span></button>` : ''}</td>
    </tr>`;
  }

  function zonasDelCentro() {
    return [...rutasPorZona.keys()].filter(z => zonaEnCentro(z, CE.centro)).map(z => ({ id: z, label: zonaLbl(z) })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'es'));
  }
  function modalHtml() {
    const m = CE.modal;
    const err = [];
    if (m.tried) {
      if (!m.zona) err.push('Elige la comuna destino.');
      if (!(m.item || '').trim()) err.push('Indica el ítem de costo.');
      if (!(num(m.ida) > 0 || num(m.vuelta) > 0)) err.push('Ingresa al menos un costo (ida o vuelta).');
    }
    return `<div class="tf-modal-bg" id="ce-mbg"><div class="tf-modal" role="dialog" aria-label="Agregar costo extra">
      <div class="tf-modal-h">Agregar costo extra<button class="tf-actbtn" data-chip id="ce-mx" title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="tf-modal-b">
        <label class="tf-lbl">Comuna destino *<select class="tf-sel" id="ce-mz"><option value="">— Seleccionar —</option>${zonasDelCentro().map(z => `<option value="${esc(z.id)}" ${String(m.zona) === String(z.id) ? 'selected' : ''}>${esc(z.label)} · zona ${esc(z.id)}</option>`).join('')}</select>
          <span class="sv-sub" style="text-transform:none;letter-spacing:0;font-weight:400;white-space:normal;max-width:none">${CE.centro === 'all' ? 'Todas las zonas con rutas activas' : 'Zonas de ' + esc(grupos.find(g => g.grupo === CE.centro)?.nombre || CE.centro)}. El costo aplica a todas las rutas de la zona.</span></label>
        <label class="tf-lbl">Ítem *<input class="tf-sel" id="ce-mi" list="ce-mil" value="${esc(m.item || '')}" placeholder="Barcaza, viático, hospedaje…"><datalist id="ce-mil">${CE_ITEMS.map(i => `<option value="${esc(i)}">`).join('')}</datalist></label>
        <label class="tf-lbl">Tipo de camión *<select class="tf-sel" id="ce-me"><option value="2" ${Number(m.ejes) === 2 ? 'selected' : ''}>2 ejes · 5 y 10 t</option><option value="3" ${Number(m.ejes) === 3 ? 'selected' : ''}>3 ejes · 15 y 28 t</option></select></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="tf-lbl">Costo ida${numIn('cem|ida', m.ida || '', { pre: '$', w: '100%', placeholder: '0' })}</label>
          <label class="tf-lbl">Costo vuelta${numIn('cem|vuelta', m.vuelta || '', { pre: '$', w: '100%', placeholder: '0' })}</label>
        </div>
        <span class="sv-sub" style="margin:0;white-space:normal;max-width:none">Al menos uno de los dos costos es obligatorio.</span>
        ${err.length ? `<div class="tf-err">${err.map(esc).join('<br>')}</div>` : ''}
      </div>
      <div class="tf-modal-f"><button class="sv-btn" data-chip id="ce-mc">Cancelar</button><button class="sv-btn-p" id="ce-ms"><span class="material-symbols-outlined">add</span>Agregar costo</button></div>
    </div></div>`;
  }

  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablearMarco(container, db, cfg, render);
    container.querySelectorAll('[data-cecentro]').forEach(b => b.addEventListener('click', () => { CE.centro = b.dataset.cecentro; render(); }));
    container.querySelectorAll('[data-ceejes]').forEach(b => b.addEventListener('click', () => { CE.ejes = b.dataset.ceejes; render(); }));
    const q = container.querySelector('#ce-q');
    q?.addEventListener('input', () => { CE.q = q.value; const pos = q.selectionStart; render(); const n = container.querySelector('#ce-q'); n.focus(); n.setSelectionRange(pos, pos); });
    container.querySelector('#ce-add')?.addEventListener('click', () => { CE.modal = { zona: '', item: 'BARCAZA', ejes: 2, ida: '', vuelta: '', tried: false }; render(); });
    container.querySelectorAll('[data-cetog]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.cetog;
      const nuevo = INS.extrasNew.find(c => c._tmp === id);
      if (nuevo) { nuevo.activo = !nuevo.activo; render(); return; }
      const c = (db.extraCosts || []).find(x => x.id === id);
      if (!c) return;
      const o = INS.extras[id] || (INS.extras[id] = {});
      const actual = 'activo' in o ? o.activo : c.activo !== false;
      o.activo = !actual;
      if (o.activo === (c.activo !== false)) delete o.activo;
      if (!Object.keys(o).length) delete INS.extras[id];
      render();
    }));
    container.querySelectorAll('[data-cedel]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.cedel;
      const i = INS.extrasNew.findIndex(c => c._tmp === id);
      if (i >= 0) INS.extrasNew.splice(i, 1);
      else { INS.extrasDel.push(id); delete INS.extras[id]; }
      render();
    }));
    wireNumIns(container, (key, val) => {
      const [pre, id, f] = key.split('|');
      if (pre === 'cem') { if (CE.modal) CE.modal[id] = val; return; }
      const nuevo = INS.extrasNew.find(c => c._tmp === id);
      if (nuevo) { nuevo[f] = val; recalc(); return; }
      const c = (db.extraCosts || []).find(x => x.id === id);
      if (!c) return;
      const o = INS.extras[id] || (INS.extras[id] = {});
      if (igualNum(val, c[f])) delete o[f]; else o[f] = val;
      if (!Object.keys(o).length) delete INS.extras[id];
      recalc();
    });
    // Modal
    if (CE.modal) {
      const cerrar = () => { CE.modal = null; render(); };
      container.querySelector('#ce-mx')?.addEventListener('click', cerrar);
      container.querySelector('#ce-mc')?.addEventListener('click', cerrar);
      container.querySelector('#ce-mbg')?.addEventListener('click', e => { if (e.target.id === 'ce-mbg') cerrar(); });
      container.querySelector('#ce-mz')?.addEventListener('change', e => { CE.modal.zona = e.target.value; });
      container.querySelector('#ce-mi')?.addEventListener('input', e => { CE.modal.item = e.target.value; });
      container.querySelector('#ce-me')?.addEventListener('change', e => { CE.modal.ejes = Number(e.target.value); });
      container.querySelector('#ce-ms')?.addEventListener('click', () => {
        const m = CE.modal;
        m.tried = true;
        if (!m.zona || !(m.item || '').trim() || !(num(m.ida) > 0 || num(m.vuelta) > 0)) { render(); return; }
        const ruta = (rutasPorZona.get(String(m.zona)) || [])[0];
        INS.extrasNew.push({ _tmp: 'n' + Date.now(), zona_id: String(m.zona), route_id: ruta?.id || null, ejes: Number(m.ejes), item: m.item.trim().toUpperCase(), costo_ida: num(m.ida), costo_vuelta: num(m.vuelta), activo: true });
        CE.modal = null;
        render();
      });
      setTimeout(() => container.querySelector('#ce-mz')?.focus(), 0);
    }
  }
  render();
}

// ============================================================================
// VARIABLES GENERALES
// ============================================================================
export function renderVariablesV2(container, db, cfg) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();
  cfg.variables = cfg.variables || {};
  cfg.kmOfrecidos = cfg.kmOfrecidos || {};

  const fl = (label, path, unit, help = '', w = '130px') => `<div class="tf-fl"><span>${esc(label)}</span>
    ${numIn(path, valCfg(cfg, path) ?? '', { unit, w, changed: path in INS.cfg, disabled: !editar, label })}${help ? `<em>${esc(help)}</em>` : ''}</div>`;

  function render() {
    const fechaUF = valCfg(cfg, 'variables.fechaUF') || '';
    const diasUF = fechaUF ? Math.floor((new Date() - new Date(fechaUF + 'T12:00:00')) / 86400000) : null;
    const dias = num(valCfg(cfg, 'variables.chofer.diasHabiles')) || 22;
    const pivot = (titulo, sub, pathFn, unit) => `<div class="sv-card">
      <div class="tf-tabletitle"><div><h3>${esc(titulo)}</h3><small>${esc(sub)}</small></div>
        ${unit === 'km/mes' && editar ? `<label class="sv-btn" style="cursor:pointer"><span class="material-symbols-outlined">upload_file</span>Cargar CSV<input type="file" accept=".csv" id="km-csv" hidden></label>` : ''}</div>
      <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:${220 + grupos.length * 140}px">
        <thead><tr><th>Camión</th>${grupos.map(g => `<th class="r">${esc(g.nombre)}</th>`).join('')}</tr></thead>
        <tbody>${CAP_LIST.map(cap => `<tr style="cursor:default"><td><span class="sv-b">${capLbl(cap)}</span></td>
          ${grupos.map(g => { const p = pathFn(g.repId, cap); return `<td class="r">${numIn(p, valCfg(cfg, p) ?? '', { unit: unit === 'km/mes' ? 'km' : '', pre: unit === 'CLP' ? '$' : '', w: '120px', changed: p in INS.cfg, disabled: !editar, label: `${titulo} ${g.nombre} ${cap}` })}</td>`; }).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${unit === 'km/mes' ? '<div class="tf-card-foot"><span>Denominador de los prorrateos fijos (SOAP, seguro, mantención, neumáticos, GPS) · CSV: Centro_SAP, Tipo_Camion_Kg, KM_Mensual</span></div>' : ''}
    </div>`;
    const cuerpo = `<div class="tf-prms">
        <div class="tf-prm"><h3>Económicas</h3><small>Aplican a todas las rutas</small>
          ${fl('Valor UF', 'variables.valorUF', 'CLP', 'Convierte seguro y GPS a pesos')}
          <div class="tf-fl"><span>Fecha UF</span>${txtIn('variables.fechaUF', fechaUF, { type: 'date', w: '150px', changed: 'variables.fechaUF' in INS.cfg, disabled: !editar, label: 'Fecha UF' })}
            <em>${diasUF == null ? 'Sin fecha' : diasUF > 30 ? `<span style="color:#b5000b;font-weight:700">${diasUF} días sin actualizar</span>` : `Actualizada hace ${diasUF} días`}</em></div>
          ${fl('Margen transportista', 'variables.margenGanancia', '%', 'Sobre el precio de venta', '96px')}
        </div>
        <div class="tf-prm"><h3>Chofer</h3><small>Sueldo por centro en la tabla de abajo</small>
          ${fl('Días hábiles', 'variables.chofer.diasHabiles', 'días', 'Divide el sueldo mínimo', '96px')}
          ${fl('Comisión variable', 'variables.chofer.comisionPct', '%', 'Sobre costos directos de ida', '96px')}
        </div>
        <div class="tf-prm"><h3>Ciclos de desgaste</h3><small>Cada cuántos km se repone</small>
          ${fl('Mantención', 'variables.mantencion.ciclo', 'km')}
          ${fl('Neumáticos', 'variables.neumaticos.ciclo', 'km')}
          ${fl('GPS / celular', 'variables.gps.costoUF', 'UF/mes', 'Se prorratea por km ofrecido', '120px')}
        </div>
        <div class="tf-prm"><h3>Factor de ruta</h3><small>Multiplica el costo según la característica de la ruta</small>
          ${['NORMAL', 'ISLA', 'EXTREMA'].map(k => fl(k.charAt(0) + k.slice(1).toLowerCase(), `variables.factorRuta.${k}`, '×', '', '96px')).join('')}
        </div>
      </div>
      <div class="tf-grid">
        <div class="sv-card" style="flex:1 1 380px">
          <div class="tf-tabletitle"><div><h3>Neumáticos por camión</h3><small>Costo del cambio completo</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:320px"><thead><tr><th>Camión</th><th class="r">Cambio completo</th></tr></thead>
            <tbody>${CAP_LIST.map(cap => { const p = `variables.neumaticos.costos.${cap}`; return `<tr style="cursor:default"><td><span class="sv-b">${capLbl(cap)}</span></td><td class="r">${numIn(p, valCfg(cfg, p) ?? '', { pre: '$', w: '130px', changed: p in INS.cfg, disabled: !editar })}</td></tr>`; }).join('')}</tbody></table></div>
        </div>
        <div class="sv-card" style="flex:1 1 480px">
          <div class="tf-tabletitle"><div><h3>Sueldo mínimo chofer</h3><small>Por centro logístico</small></div></div>
          <div class="sv-tablewrap" style="max-height:none"><table class="sv-table" style="min-width:420px"><thead><tr><th>Centro</th><th class="r">Sueldo</th><th class="r">Base diaria</th></tr></thead>
            <tbody>${grupos.map(g => { const p = `variables.chofer.sueldoMinimo.${g.repId}`; const v = num(valCfg(cfg, p)); return `<tr style="cursor:default"><td><span class="sv-b">${esc(g.nombre)}</span><div class="sv-sub">${esc(g.centroIds.join(' · '))}</div></td><td class="r">${numIn(p, v || '', { pre: '$', w: '130px', changed: p in INS.cfg, disabled: !editar })}</td><td class="r"><b>${clp(v / dias)}</b></td></tr>`; }).join('')}</tbody></table></div>
        </div>
      </div>
      ${pivot('Mantención', 'Costo de mantención por centro y tipo de camión', (rep, cap) => `variables.mantencion.costos.${rep}|${cap}`, 'CLP')}
      ${pivot('KM mensuales ofrecidos', 'Por centro y tipo de camión', (rep, cap) => `kmOfrecidos.${rep}|${cap}`, 'km/mes')}`;
    container.innerHTML = marco({ titulo: 'Variables Generales', desc: 'Parámetros de cálculo de costo.', activo: 'variables', cuerpo, db, cfg });
    wire();
  }
  const recalc = debounce(() => rerenderKeepFocus(container, render), 250);
  function wire() {
    cablearMarco(container, db, cfg, render);
    wireNumIns(container, (key, val) => { setCfgDraft(cfg, key, val); recalc(); });
    wireTxtIns(container, (key, val) => { setCfgDraft(cfg, key, val, true); render(); });
    container.querySelector('#km-csv')?.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      leerCsv(f, rows => {
        let n = 0;
        rows.forEach(r => {
          const cd = (db.logisticsCentres || []).find(c => c.id === String(r.Centro_SAP || '').trim());
          const cap = capDesdeCsv(r.Tipo_Camion_Kg);
          if (!cd || !CAP_LIST.includes(cap)) return;
          const g = grupos.find(x => x.centroIds.includes(cd.id));
          if (!g) return;
          setCfgDraft(cfg, `kmOfrecidos.${g.repId}|${cap}`, num(String(r.KM_Mensual).replace(/\./g, '').replace(',', '.')));
          n++;
        });
        showAlert(`${n} registros de KM cargados como borrador. Revisa y guarda.`, 'success');
        render();
      });
    });
  }
  render();
}

// ============================================================================
// MOTOR DE COSTOS — tabla (como PRD) + desglose de 12 pasos por fila
// ============================================================================
const MC = { tipo: 'Regional', centro: 'all', truck: 'all', dest: 'all', q: '', pagina: 0, sel: null };
const MC_TIPOS = { Regional: 'Regionales', Interregional: 'Interregionales', Troncal: 'Troncales', Todas: 'Todas' };

// helpers: { mergeStgoSb(rows, stgoGrupo, sbGrupo), onActualizarPonderados(): Promise }
export function renderMotorV2(container, db, cfg, helpers = {}) {
  const grupos = getOrigenGroups(db);
  const editar = can('editar');
  setParamPill(cfg);
  INS.memo = new Map();
  const stgo = grupos.find(g => g.centroIds.some(id => ['1001', '1002', '1003'].includes(String(id))));
  const sb = grupos.find(g => g.centroIds.some(id => String(id) === '1005'));
  const combinado = !!(stgo && sb && helpers.mergeStgoSb);
  const chips = combinado
    ? [...grupos.filter(g => g !== stgo && g !== sb), { grupo: '__STGO_SB__', nombre: 'Santiago + San Bernardo' }].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
    : grupos;
  const nombreGrupo = Object.fromEntries(grupos.map(g => [g.grupo, g.nombre || g.grupo]));
  let calculando = false;

  function matriz() {
    const cfgX = cfgEfectivo(cfg);
    const idx = indice(tollsEfectivos(db), extrasEfectivos(db));
    const troncales = new Set((cfg.variables?.troncalesRoutes) || []);
    let rows = [];
    combinaciones(db).forEach(({ ruta, truck }) => {
      const esTroncal = troncales.has(ruta.codigo);
      const clasif = esTroncal ? 'Troncal' : ruta.clasificRuta;
      if (MC.tipo === 'Regional' && !(clasif === 'Regional' && (ruta.tipo || '').toUpperCase() === 'COMUNA')) return;
      if (MC.tipo === 'Interregional' && clasif !== 'Interregional') return;
      if (MC.tipo === 'Troncal' && clasif !== 'Troncal') return;
      if (MC.centro !== 'all') {
        const set = MC.centro === '__STGO_SB__' ? [stgo.grupo, sb.grupo] : [MC.centro];
        if (!set.includes(ruta.origen_grupo)) return;
      }
      rows.push({ ruta, truckType: truck, clasif, ...costoRuta(db, idx, cfgX, ruta, truck.capKg) });
    });
    if (combinado && (MC.centro === 'all' || MC.centro === '__STGO_SB__')) rows = helpers.mergeStgoSb(rows, stgo.grupo, sb.grupo);
    return { rows, cfgX, idx };
  }

  function render() {
    const { rows: todas, cfgX, idx } = matriz();
    const dests = [...new Set(todas.map(m => m.ruta.destino || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    if (MC.dest !== 'all' && !dests.includes(MC.dest)) MC.dest = 'all';
    const q = MC.q.trim().toLowerCase();
    const lista = todas.filter(m => (MC.truck === 'all' || String(m.capKg) === MC.truck) && (MC.dest === 'all' || m.ruta.destino === MC.dest)
      && (!q || `${m.ruta.codigo} ${m.ruta.destino}`.toLowerCase().includes(q)))
      .sort((a, b) => (nombreGrupo[a.ruta.origen_grupo] || '').localeCompare(nombreGrupo[b.ruta.origen_grupo] || '', 'es') || (a.ruta.codigo || '').localeCompare(b.ruta.codigo || '') || a.capKg - b.capKg);
    const n = lista.length || 1;
    const pags = Math.max(1, Math.ceil(lista.length / PAGE_MC));
    if (MC.pagina >= pags) MC.pagina = pags - 1;
    const pag = lista.slice(MC.pagina * PAGE_MC, (MC.pagina + 1) * PAGE_MC);
    const showPeso = MC.tipo !== 'Interregional';
    const part = cfg.participacionRutas || {};
    const pctDe = m => { const e = part[m.ruta.id] || part[m.ruta.codigo] || (m.ruta._allCodigos || []).reduce((f, c) => f || part[c], null) || (m.ruta._allIds || []).reduce((f, id) => f || part[id], null); return e?.pct || 0; };
    const keyDe = m => `${m.ruta.codigo}|${m.capKg}`;
    let sel = lista.find(m => keyDe(m) === MC.sel) || pag[0] || null;

    const cols = ['Centro', 'ID ruta', 'Destino', 'Clasificación', 'Tipo camión (kg)', 'KM', 'Peajes', 'Comb. ida', 'Comb. vuelta', 'Seguros', 'Costos extras', 'Mantención', 'Neumáticos', 'GPS', 'Rem. chofer', 'Var. chofer', 'Factor', 'Costo vuelta', 'Costo total', 'Costo/KM'].concat(showPeso ? ['Peso', 'T. ponderada'] : []);
    const N = (v, extra = '') => `<td class="r" ${extra}>${clp(v)}</td>`;
    const filas = pag.map(m => {
      const on = sel && keyDe(sel) === keyDe(m);
      const inter = m.ruta.clasificRuta === 'Interregional';
      const pct = pctDe(m);
      const extra = num(m.item1b_costosExtra);
      return `<tr class="${on ? 'tf-sel' : ''}" data-mcrow="${esc(keyDe(m))}" style="cursor:pointer">
        <td style="white-space:nowrap"><span class="sv-b">${esc((nombreGrupo[m.ruta.origen_grupo] || m.ruta.origen_grupo || '') + (m._merged ? ' + SB' : ''))}</span><div class="sv-sub">${esc(m.ruta.origenId || '')}</div></td>
        <td><span class="sv-mono">${esc(m.ruta.codigo || '')}</span></td>
        <td style="white-space:nowrap"><b>${esc(m.ruta.destino || '')}</b></td>
        <td>${clasifPill(m.clasif)}</td>
        <td class="r">${fmt(m.capKg)}</td>
        <td class="r">${fmt(num(m.km))}</td>
        ${N(m.item1_peajes)}${N(m.combIda)}${N(m.combVuelta)}${N(num(m.item3_soapKm) + num(m.item4_seguroKm))}
        ${N(extra, extra ? '' : 'style="color:#9ca3af"')}${N(m.item5_mantKm)}${N(m.item6_neumKm)}${N(m.item7_gpsKm)}${N(m.item8_choferBaseDiario)}${N(m.item9_varChofer)}
        <td class="r">${fmt(num(m.factorRuta) || 1, 2)}</td>${N(m.costoVuelta)}<td class="r"><b>${clp(m.item10_costoRutaTotal)}</b></td><td class="r"><b style="color:#b5000b">${clp(m.item11_costoKmFinal)}</b></td>
        ${showPeso ? `<td class="r">${inter ? '—' : fmt(pct, 2) + '%'}</td><td class="r">${inter ? '—' : clp(num(m.item11_costoKmFinal) * pct / 100)}</td>` : ''}
      </tr>`;
    }).join('');

    const seg = (attr, cur, opts) => `<div class="sv-seg">${opts.map(([k, l]) => `<button data-chip ${attr}="${esc(k)}" class="${cur === k ? 'is-on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const acciones = `${editar && helpers.onActualizarPonderados ? `<button class="sv-btn" id="mc-pond" ${calculando ? 'disabled' : ''} title="Recalcula el peso de cada ruta desde el histórico y los ponderados de Tarifas por Camión"><span class="material-symbols-outlined">refresh</span>${calculando ? 'Calculando…' : 'Actualizar ponderados'}</button>` : ''}
      <button class="sv-btn" data-csv id="mc-csv"><span class="material-symbols-outlined">download</span>Descargar CSV</button>`;
    const cuerpo = `<div class="sv-kpis">
        ${kpiHtml(false, '', '', 'Combinaciones', fmt(lista.length), 'ruta × camión con el filtro', '#191c1d', false)}
        ${kpiHtml(false, '', '', 'Costo total prom.', clp(lista.reduce((s, m) => s + num(m.item10_costoRutaTotal), 0) / n), 'ida y vuelta con margen', '#b5000b', false)}
        ${kpiHtml(false, '', '', 'Costo/KM prom.', clp(lista.reduce((s, m) => s + num(m.item11_costoKmFinal), 0) / n), 'por km recorrido', '#1d4ed8', false)}
      </div>
      <div class="sv-filters">
        <div class="sv-frow">
          ${seg('data-mctipo', MC.tipo, Object.entries(MC_TIPOS))}
          ${seg('data-mctruck', MC.truck, [['all', 'Todos'], ...CAP_LIST.map(c => [String(c), capLbl(c)])])}
        </div>
        <div class="sv-frow">
          <span class="sv-flbl">Destino</span>
          <select class="tf-sel" id="mc-dest"><option value="all">Todos</option>${dests.map(d => `<option ${MC.dest === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
          <label class="sv-inp"><span class="material-symbols-outlined">search</span><input id="mc-q" placeholder="Código o destino" value="${esc(MC.q)}" style="width:200px"></label>
        </div>
        ${centroChips(chips, MC.centro, 'data-mccentro')}
      </div>
      <div class="sv-card">
        <div class="sv-tablewrap" style="max-height:560px"><table class="sv-table" style="min-width:${showPeso ? 2200 : 2020}px">
          <thead><tr>${cols.map((c, i) => `<th class="${i > 3 ? 'r' : ''}" style="white-space:nowrap">${c}</th>`).join('')}</tr></thead>
          <tbody>${filas || `<tr class="sv-empty"><td colspan="${cols.length}">Sin combinaciones para los filtros.</td></tr>`}</tbody>
        </table></div>
        <div class="sv-tfoot"><span>${fmt(lista.length)} combinaciones · ${PAGE_MC} por página · clic en una fila para ver su desglose</span>
          <span style="display:flex;gap:12px;align-items:center">${showPeso ? 'T. ponderada = costo/KM × peso de la ruta en su centro' : 'Interregionales: sin ponderación'}${pagerHtml(lista.length, MC.pagina, PAGE_MC, 'data-mcpag')}</span></div>
      </div>
      ${sel ? desglose(sel, cfgX, idx) : ''}`;
    container.innerHTML = marco({ titulo: 'Motor de Costos', desc: 'Cálculo de costos de transporte por ruta. Usa los parámetros de los insumos (con los cambios sin guardar, si los hay).', activo: 'resultados', acciones, cuerpo, db, cfg });
    wire(lista, keyDe);
  }

  function desglose(m, cfgX, idx) {
    const r = m.ruta, km = num(m.km), cap = m.capKg;
    const rep = (grupos.find(g => g.grupo === r.origen_grupo) || grupos.find(g => g.centroIds.includes(r.origenId)))?.repId || r.origenId;
    const kmKey = `${rep}|${cap}`;
    const rend = (cfgX.rendimientos || {})[String(cap)] || {};
    const fuel = (cfgX.combustibles || {})[rep] || {};
    const iva = num(fuel.ivaPct) > 0 ? num(fuel.ivaPct) : 19;
    const neto = num(fuel.precioLitro) / (1 + iva / 100);
    const uf = num(cfgX.variables?.valorUF);
    const kmMes = num((cfgX.kmOfrecidos || {})[kmKey]);
    const v = cfgX.variables || {};
    const margen = num(v.margenGanancia);
    const extras = (m.extraCostsRuta || []);
    // Valor con los parámetros guardados (para el Δ del ZCAP)
    let z0 = null;
    if (!m._merged) {
      const idx0 = indice(db.routeTolls, db.extraCosts);
      z0 = costoRuta(db, idx0, cfg, r, cap).zcap;
    }
    const d = z0 == null ? 0 : m.zcap - z0;
    const items = [
      ['1', 'Peajes', m.item1_peajes, `ida ${clp(m.peajeIda)} + vuelta ${clp(m.peajeVuelta)} · ${m.ejes} ejes`, 'peajes', 'Peajes'],
      ['1b', 'Costos extra', m.item1b_costosExtra, extras.length ? extras.map(c => `${c.item} ${clp(num(c.costo_ida) + num(c.costo_vuelta))}`).join(' · ') : 'sin ítems para la zona y ejes', 'costos-extras', 'Costos extras'],
      ['2', 'Combustible', m.item2_combustible, `${fmt(km)} km ÷ ${fmt(num(rend.cargado), 1)} km/l + ${fmt(km)} km ÷ ${fmt(num(rend.vacio), 1)} km/l · ${clp(neto)}/l neto`, 'combustibles', 'Combustibles'],
      ['3', 'SOAP y permiso', m.item3_soapKm, kmMes ? `(SOAP ${clp(m.soapAnual)} + permiso ${clp(m.permisoAnual)}) ÷ ${fmt(kmMes * 12)} km/año × ${fmt(km)} km` : 'sin km ofrecidos', 'seguros', 'Seguros'],
      ['4', 'Seguro de carga', m.item4_seguroKm, `${fmt(num((cfgX.seguros || {})[rep]), 1)} UF × ${clp(uf)} ÷ ${fmt(kmMes)} km/mes × ${fmt(km)} km`, 'seguros', 'Seguros'],
      ['5', 'Mantención', m.item5_mantKm, `${clp((v.mantencion?.costos || {})[kmKey])} cada ${fmt(num(v.mantencion?.ciclo) || 20000)} km × ${fmt(km)} km`, 'variables', 'Variables'],
      ['6', 'Neumáticos', m.item6_neumKm, `${clp((v.neumaticos?.costos || {})[String(cap)])} cada ${fmt(num(v.neumaticos?.ciclo) || 50000)} km × ${fmt(km)} km`, 'variables', 'Variables'],
      ['7', 'GPS / celular', m.item7_gpsKm, `${fmt(num(v.gps?.costoUF) || 0.45, 2)} UF × ${clp(uf)} ÷ ${fmt(kmMes)} km/mes × ${fmt(km)} km`, 'variables', 'Variables'],
      ['8', 'Remuneración chofer', m.item8_choferBaseDiario, `${clp((v.chofer?.sueldoMinimo || {})[rep])} ÷ ${fmt(num(v.chofer?.diasHabiles) || 22)} días hábiles`, 'variables', 'Variables'],
      ['9', 'Variable chofer', m.item9_varChofer, `${fmt(num(v.chofer?.comisionPct), 1)}% sobre costos directos de ida`, 'variables', 'Variables'],
    ];
    const mx = Math.max(1, ...items.map(i => num(i[2])));
    const suma = items.reduce((s, i) => s + num(i[2]), 0);
    const paso = (nn, label, monto, det, go, goL, cls = '', bar = true, raw = 0) => `<div class="tf-step ${cls}">
      <span class="tf-n">${nn}</span><div class="tf-lb"><b>${esc(label)}</b><small>${esc(det)}</small></div>
      <div class="${bar ? 'tf-barw' : ''}">${bar ? `<i style="width:${(Math.max(0, num(raw)) / mx * 100).toFixed(1)}%"></i>` : ''}</div>
      <span class="tf-m">${monto}</span>
      ${go ? `<button class="tf-go" data-chip data-mcgo="${esc(go)}">${esc(goL)}<span class="material-symbols-outlined">chevron_right</span></button>` : '<span></span>'}</div>`;
    return `<div class="sv-card"><div class="tf-motor">
      <div class="tf-motor-h"><h3>Desglose · ${esc(r.codigo)} · ${esc(nombreGrupo[r.origen_grupo] || '')} → ${esc(r.destino || '')} · ${capLbl(cap)}</h3>
        <div class="tf-facts"><span>km<b>${fmt(km)}</b></span><span>${esc((r.caracteristica || 'NORMAL').toLowerCase())}<b>× ${fmt(num(m.factorRuta) || 1, 2)}</b></span><span>ejes<b>${m.ejes}</b></span><span>${esc(m.clasif || r.clasificRuta || '')}</span></div></div>
      ${m._merged ? '<div class="sv-sub" style="margin:0;white-space:normal;max-width:none">Fila promedio de Santiago + San Bernardo; los pasos muestran la primera ruta del grupo.</div>' : ''}
      <div class="tf-tiles">
        <div class="tf-tile"><div>Costo ruta total</div><b>${clp(m.item10_costoRutaTotal)}</b><small>ida y vuelta, con margen</small></div>
        <div class="tf-tile"><div>Costo por km</div><b>${clp(m.item11_costoKmFinal)}</b><small>sobre ${fmt(km * 2)} km recorridos</small></div>
        <div class="tf-tile is-dark"><div>ZCAP del motor</div><b>${clp(m.zcap)}</b><small>${Math.abs(d) >= 1 ? `${d > 0 ? '▲' : '▼'} ${clp(Math.abs(d))} vs. parámetros guardados` : 'con los parámetros guardados'}</small></div>
      </div>
      <div class="tf-steps">
        ${items.map(i => paso(i[0], i[1], clp(i[2]), i[3], i[4], i[5], '', true, i[2])).join('')}
        ${paso('Σ', 'Suma de ítems', clp(suma), 'Ítems 1 al 9', null, '', 'is-tot', false)}
        ${paso('10', 'Costo vuelta', clp(m.costoVuelta), `× factor ruta ${fmt(num(m.factorRuta) || 1, 2)} (${(r.caracteristica || 'NORMAL').toLowerCase()})`, 'variables', 'Factor', 'is-tot', false)}
        ${paso('10b', 'Costo ruta total', clp(m.item10_costoRutaTotal), `÷ (1 − ${fmt(margen, 1)}% margen del transportista)`, 'variables', 'Margen', 'is-tot', false)}
        ${paso('11', 'Costo por km final', clp(m.item11_costoKmFinal) + '/km', `÷ (${fmt(km)} km × 2)`, null, '', 'is-tot', false)}
        ${paso('12', 'ZCAP', clp(m.zcap), `Costo por km × ${fmt(km)} km`, 'zcap', 'Ver rutas', 'is-zcap', false)}
      </div>
    </div></div>`;
  }

  function wire(lista, keyDe) {
    cablearMarco(container, db, cfg, render);
    const nav = sub => document.querySelector(`.sidebar-item[data-tab="tarifas-transporte"][data-sub="${sub}"]`)?.click();
    container.querySelectorAll('[data-mctipo]').forEach(b => b.addEventListener('click', () => { MC.tipo = b.dataset.mctipo; MC.pagina = 0; MC.sel = null; render(); }));
    container.querySelectorAll('[data-mctruck]').forEach(b => b.addEventListener('click', () => { MC.truck = b.dataset.mctruck; MC.pagina = 0; render(); }));
    container.querySelectorAll('[data-mccentro]').forEach(b => b.addEventListener('click', () => { MC.centro = b.dataset.mccentro; MC.pagina = 0; MC.sel = null; render(); }));
    container.querySelectorAll('[data-mcpag]').forEach(b => b.addEventListener('click', () => { MC.pagina += Number(b.dataset.mcpag); MC.sel = null; render(); }));
    container.querySelector('#mc-dest')?.addEventListener('change', e => { MC.dest = e.target.value; MC.pagina = 0; render(); });
    const q = container.querySelector('#mc-q');
    q?.addEventListener('input', debounce(() => { MC.q = q.value; MC.pagina = 0; const pos = q.selectionStart; render(); const n = container.querySelector('#mc-q'); n.focus(); n.setSelectionRange(pos, pos); }, 200));
    container.querySelectorAll('[data-mcrow]').forEach(tr => tr.addEventListener('click', () => {
      MC.sel = tr.dataset.mcrow;
      render();
      container.querySelector('.tf-motor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    container.querySelectorAll('[data-mcgo]').forEach(b => b.addEventListener('click', () => {
      const go = b.dataset.mcgo;
      if (go === 'peajes') PJ.tab = MC.tipo === 'Interregional' ? 'inter' : 'reg';
      nav(go);
    }));
    container.querySelector('#mc-pond')?.addEventListener('click', async () => {
      calculando = true; render();
      try { await helpers.onActualizarPonderados(); } finally { calculando = false; render(); }
    });
    container.querySelector('#mc-csv')?.addEventListener('click', () => {
      const showPeso = MC.tipo !== 'Interregional';
      const part = cfg.participacionRutas || {};
      const H = ['Centro', 'ID Ruta', 'Destino', 'Clasificacion', 'Tipo Camion (Kg)', 'KM', 'Peajes', 'Comb. Ida', 'Comb. Vuelta', 'Seguros', 'Costos Extras', 'Mantencion', 'Neumaticos', 'GPS', 'Rem. Chofer', 'Var. Chofer', 'Factor', 'Costo Vuelta', 'Costo Total', 'Costo/KM'].concat(showPeso ? ['Peso_Pct', 'Tarifa_Ponderada'] : []);
      const R = lista.map(m => {
        const e = part[m.ruta.id] || part[m.ruta.codigo] || (m.ruta._allCodigos || []).reduce((f, c) => f || part[c], null);
        const pct = e?.pct || 0;
        const inter = m.ruta.clasificRuta === 'Interregional';
        const row = [(nombreGrupo[m.ruta.origen_grupo] || m.ruta.origen_grupo) + (m._merged ? '+SB' : ''), m.ruta.codigo, m.ruta.destino || '', m.clasif || '', m.capKg, m.km,
          Math.round(num(m.item1_peajes)), Math.round(num(m.combIda)), Math.round(num(m.combVuelta)), Math.round(num(m.item3_soapKm) + num(m.item4_seguroKm)), Math.round(num(m.item1b_costosExtra)),
          Math.round(num(m.item5_mantKm)), Math.round(num(m.item6_neumKm)), Math.round(num(m.item7_gpsKm)), Math.round(num(m.item8_choferBaseDiario)), Math.round(num(m.item9_varChofer)),
          (num(m.factorRuta) || 1).toFixed(2).replace('.', ','), Math.round(num(m.costoVuelta)), Math.round(num(m.item10_costoRutaTotal)), Math.round(num(m.item11_costoKmFinal))];
        if (showPeso) row.push(inter ? '' : pct.toFixed(2).replace('.', ','), inter ? '' : Math.round(num(m.item11_costoKmFinal) * pct / 100));
        return row;
      });
      descargarCsv(`motor_costo_${MC.tipo.toLowerCase()}_${hoyISO()}.csv`, H, R);
    });
  }

  render();
}
