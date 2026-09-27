// Cotizador de Despacho — SIT EBEMA (rediseño multi-tramo 27-sep-2026)
// Precio al cliente por tramos: Retiro (primera milla) · Traslado troncal ·
// Última milla, con reglas de minimización A/B/C. El cálculo vive en
// cotizador-engine.js y usa las tarifas de la vista Tarifas Clientes
// (ZCAP, ZFMI, ZFMP y Tarifa Express por ruta y tipo de camión).
import { getDatabase, saveDatabase, getTariffConfig, getClientTariffConfig } from './data.js?v=202609271410';
import {
  buildCotizadorContext, cotizar, cdsDeComuna, normComuna,
  getRetiroTroncalTarifas, RETIRO_TRONCAL_DEFAULT, TRUCK_ORDER, HUB_GRUPO, FLUJOS
} from './cotizador-engine.js?v=202609271410';
import { getRol } from './permisos.js?v=202609271410';
import { formatCLP, showAlert, escapeHtml } from './utils.js';

// --- Historial de cotizaciones recientes por perfil (localStorage) ---
const RECENT_QUOTES_MAX = 15;

function getSessionEmail() {
  try {
    const session = JSON.parse(localStorage.getItem('ebema_user_session') || '{}');
    return session.email || 'anon';
  } catch (e) {
    return 'anon';
  }
}
function recentQuotesKey() { return `ebema_recent_quotes_v2_${getSessionEmail()}`; }
function loadRecentQuotes() {
  try {
    const list = JSON.parse(localStorage.getItem(recentQuotesKey()) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function saveRecentQuote(entry) {
  try {
    const list = loadRecentQuotes().filter(q => q.firma !== entry.firma);
    list.unshift(entry);
    localStorage.setItem(recentQuotesKey(), JSON.stringify(list.slice(0, RECENT_QUOTES_MAX)));
  } catch (e) { /* almacenamiento no disponible */ }
}

// Distancia por carretera (OSRM) con caché de sesión; respaldo: línea recta × 1,3
const _kmCache = new Map();
function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function kmCarretera(a, b) {
  const key = `${a.lat},${a.lon}|${b.lat},${b.lon}`;
  if (_kmCache.has(key)) return _kmCache.get(key);
  let res = null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      const m = data?.routes?.[0]?.distance;
      if (m) res = { km: Math.round(m / 100) / 10, estimado: false };
    }
  } catch (_) { /* sin red */ }
  if (!res) res = { km: Math.round(haversineKm(a, b) * 1.3 * 10) / 10, estimado: true };
  _kmCache.set(key, res);
  return res;
}

const cardOn  = 'flex items-center gap-sm border-2 border-primary bg-primary/5 p-md rounded-lg cursor-pointer transition-all';
const cardOff = 'flex items-center gap-sm border-2 border-outline-variant p-md rounded-lg cursor-pointer transition-all';
const inputCls = 'w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-[#373A3C] focus:ring-0 transition-all bg-white';
const labelCls = 'font-label-caps text-label-caps text-secondary block';

function radioCard(name, value, titulo, sub, checked) {
  return `<label data-card="${name}" data-value="${value}" class="${checked ? cardOn : cardOff}">
      <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} class="accent-[#b5000b]">
      <div>
        <p class="font-body-md text-body-md font-bold text-on-surface">${titulo}</p>
        <p class="text-[11px] text-secondary">${sub}</p>
      </div>
    </label>`;
}

export function renderRatesView(container) {
  const db = getDatabase();
  const cfg = getTariffConfig(db);
  const ccfg = getClientTariffConfig(db);
  let ctx;
  try {
    ctx = buildCotizadorContext(db, cfg, ccfg);
  } catch (err) {
    console.error('Error construyendo tarifas del cotizador:', err);
    container.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-800 p-lg rounded">No se pudieron cargar las tarifas de clientes: ${escapeHtml(err.message || String(err))}</div>`;
    return;
  }
  const grupos = [...ctx.grupoInfo.values()].filter(g => [...ctx.rutaPorGrupoDest.keys()].some(k => k.startsWith(g.grupo + '|')));
  const comunasOrdenadas = [...ctx.comunas.values()].filter(c => c.cds.length).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const esOwner = getRol() === 'OWNER';
  const quoteId = `${Math.floor(1000 + Math.random() * 9000)}-QT`;

  const cdOptions = (sel) => grupos.map(g =>
    `<option value="${escapeHtml(g.grupo)}" ${g.grupo === sel ? 'selected' : ''}>${escapeHtml(g.nombre)}${g.grupo === HUB_GRUPO ? ' (Quilicura)' : ''}</option>`).join('');

  container.innerHTML = `
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Cotizador de Despacho</h1>
      <p class="font-body-lg text-body-lg text-secondary">Precio al cliente por tramo — retiro, traslado troncal y última milla — con la alternativa de menor costo.</p>
    </div>

    <div class="grid grid-cols-12 gap-lg">
      <!-- Formulario -->
      <section class="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center gap-sm mb-lg border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">analytics</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Datos de la Cotización</h2>
        </div>
        <form class="space-y-lg" id="q-form" onsubmit="return false">
          <div class="space-y-xs">
            <label class="${labelCls}">FLUJO</label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              ${radioCard('q-flujo', 'EBE-DESP', 'EBE-DESP · Stock', 'Centro origen → comuna destino', true)}
              ${radioCard('q-flujo', 'FAB-DESP/EBE-DESP', 'FAB-DESP / EBE-DESP · Calzada', 'Fábrica entrega en centro → EBEMA despacha', false)}
              ${radioCard('q-flujo', 'EBE-RET/CLI-RET', 'EBE-RET / CLI-RET · Calzada', 'EBEMA retira → cliente retira en centro', false)}
              ${radioCard('q-flujo', 'EBE-RET/EBE-DESP', 'EBE-RET / EBE-DESP · Calzada', 'EBEMA retira → EBEMA despacha', false)}
            </div>
          </div>
          <div class="space-y-xs">
            <label class="${labelCls}">TIPO DE SERVICIO</label>
            <div class="grid grid-cols-2 gap-md">
              ${radioCard('q-servicio', 'consolidado', 'Consolidado', 'Comparte camión, paga por kilos', true)}
              ${radioCard('q-servicio', 'exclusivo', 'Exclusivo', 'Camión dedicado — Tarifa Express', false)}
            </div>
          </div>

          <!-- Origen y destino: los nodos intermedios los calcula el motor -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-lg">
            <div class="space-y-xs" id="q-bloque-origen-centro">
              <label class="${labelCls}">CENTRO ORIGEN</label>
              <select id="q-cd-origen" class="${inputCls}">
                <option value="">Seleccione centro...</option>${cdOptions('')}
              </select>
            </div>
            <div class="space-y-xs hidden" id="q-bloque-origen-comuna">
              <label class="${labelCls}">COMUNA RETIRO</label>
              <input type="text" id="q-comuna-retiro" list="q-comunas" placeholder="Ej: Frutillar" class="${inputCls}" autocomplete="off">
            </div>
            <div class="space-y-xs" id="q-bloque-destino-comuna">
              <label class="${labelCls}" id="q-lbl-destino">COMUNA DESTINO</label>
              <input type="text" id="q-comuna-despacho" list="q-comunas" placeholder="Ej: Puerto Varas" class="${inputCls}" autocomplete="off">
            </div>
            <div class="space-y-xs hidden" id="q-bloque-destino-centro">
              <label class="${labelCls}">CENTRO DESTINO (RETIRA CLIENTE)</label>
              <select id="q-cd-destino" class="${inputCls}">
                <option value="">Seleccione centro...</option>${cdOptions('')}
              </select>
            </div>
          </div>
          <p class="text-[11px] text-secondary -mt-sm">Los centros intermedios (retiro, traslado troncal y última milla) se eligen automáticamente según el recorrido de menor precio.</p>
          <datalist id="q-comunas">${comunasOrdenadas.map(c => `<option value="${escapeHtml(c.nombre)}">`).join('')}</datalist>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-lg">
            <div class="space-y-xs">
              <label class="${labelCls}">KILOS A COTIZAR</label>
              <div class="relative">
                <input type="number" id="q-kilos" min="1" step="1" placeholder="Ej: 3500" class="${inputCls} pr-12">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-secondary text-xs font-bold">KG</span>
              </div>
            </div>
            <div class="space-y-xs hidden" id="q-bloque-camion">
              <label class="${labelCls}">TIPO DE CAMIÓN</label>
              <select id="q-camion" class="${inputCls}">
                <option value="">Automático según kilos</option>
                ${TRUCK_ORDER.map(t => `<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
          </div>
        </form>
      </section>

      <!-- Resumen -->
      <section class="col-span-12 lg:col-span-5 flex flex-col gap-lg">
        <div class="bg-surface-container-low border border-outline-variant p-lg shadow-md flex-1 flex flex-col">
          <div class="flex justify-between items-start mb-md">
            <div>
              <p class="font-label-caps text-label-caps text-secondary mb-1">PRECIO AL CLIENTE</p>
              <h2 class="font-headline-md text-headline-md font-bold text-on-surface">Cotización Optimizada</h2>
            </div>
            <span class="bg-surface-container-highest px-sm py-xs font-label-caps text-[10px] border border-outline-variant">ID: ${quoteId}</span>
          </div>
          <ul class="space-y-xs mb-md text-[13px]" id="q-resumen"></ul>
          <div id="q-tramos" class="space-y-xs mb-md"></div>
          <div class="bg-surface-container-lowest p-lg border-2 border-primary/10 rounded mb-md">
            <p class="font-label-caps text-label-caps text-secondary text-center mb-base">TOTAL COSTO DE TRANSPORTE</p>
            <p class="font-headline-lg text-headline-lg text-primary text-center font-extrabold tracking-tighter" id="q-total">$0</p>
            <p class="font-label-caps text-[10px] text-center text-secondary mt-base">Valor neto · IVA no incluido</p>
          </div>
          <div id="q-decisiones"></div>
          <div id="q-avisos" class="space-y-xs mt-sm"></div>
        </div>
      </section>
    </div>

    <!-- Mapa -->
    <div class="mt-xl">
      <div class="flex justify-between items-end mb-md">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Recorrido Cotizado</h3>
        <p class="font-body-md text-[12px] text-secondary">Retiro · CD origen · CD destino · Despacho</p>
      </div>
      <div class="bg-surface border border-outline-variant rounded overflow-hidden">
        <div id="quote-fleet-map" class="h-[350px] relative" style="z-index: 1;"></div>
      </div>
    </div>

    <!-- Historial -->
    <div class="mt-xl">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Historial Reciente de Cotizaciones</h3>
      <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Fecha</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Negocio / Servicio</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Retiro → Despacho</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Kilos</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Monto Neto</th>
            </tr>
          </thead>
          <tbody id="quotes-history-tbody" class="font-body-md text-body-md"></tbody>
        </table>
      </div>
    </div>

    ${esOwner ? `
    <!-- Administrador tarifa fija retiro troncal (Regla B) — sólo OWNER -->
    <div class="mt-xl bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <button type="button" data-exp="retiro-troncal" class="w-full flex items-center justify-between" id="q-admin-toggle">
        <span class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">local_shipping</span>
          <span class="font-headline-sm text-headline-sm font-bold text-on-surface">Tarifas de Retiro con Camión Troncal (Regla B)</span>
        </span>
        <span class="material-symbols-outlined text-secondary" id="q-admin-chevron">expand_more</span>
      </button>
      <div id="q-admin-body" class="hidden mt-md">
        <p class="text-[12px] text-secondary mb-md">Monto fijo por retiro cuando la carga se recoge con el camión troncal. El cotizador lo compara con la primera milla local y aplica el menor. Deje en 0 para desactivar un centro.</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-md" id="q-admin-grid"></div>
        <div class="flex justify-end mt-md">
          <button type="button" id="q-admin-save" class="flex items-center gap-xs bg-primary text-white font-bold px-md py-sm rounded text-[12px] uppercase tracking-wider">
            <span class="material-symbols-outlined text-[16px]">save</span> Guardar tarifas
          </button>
        </div>
      </div>
    </div>` : ''}
  `;

  // --- Referencias ---
  const $ = id => document.getElementById(id);
  const el = {
    cdOrigen: $('q-cd-origen'), comunaRetiro: $('q-comuna-retiro'),
    comunaDespacho: $('q-comuna-despacho'), kilos: $('q-kilos'),
    camion: $('q-camion'), cdDestino: $('q-cd-destino'),
    bOrigenCentro: $('q-bloque-origen-centro'), bOrigenComuna: $('q-bloque-origen-comuna'),
    bDestinoComuna: $('q-bloque-destino-comuna'), bDestinoCentro: $('q-bloque-destino-centro'), bloqueCamion: $('q-bloque-camion'),
    resumen: $('q-resumen'), tramos: $('q-tramos'), total: $('q-total'), decisiones: $('q-decisiones'), avisos: $('q-avisos')
  };
  const state = { flujo: 'EBE-DESP', servicio: 'consolidado', ultimo: null };

  // --- Radio cards ---
  container.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
    container.querySelectorAll(`label[data-card="${r.name}"]`).forEach(l => {
      l.className = l.dataset.value === r.value ? cardOn : cardOff;
    });
    if (r.name === 'q-flujo') state.flujo = r.value;
    if (r.name === 'q-servicio') state.servicio = r.value;
    aplicarVisibilidad();
    recalcular();
  }));

  function aplicarVisibilidad() {
    const f = FLUJOS[state.flujo];
    el.bOrigenCentro.classList.toggle('hidden', f.origen !== 'CENTRO');
    el.bOrigenComuna.classList.toggle('hidden', f.origen !== 'COMUNA');
    el.bDestinoComuna.classList.toggle('hidden', f.destino !== 'COMUNA');
    el.bDestinoCentro.classList.toggle('hidden', f.destino !== 'CENTRO');
    el.bloqueCamion.classList.toggle('hidden', state.servicio !== 'exclusivo');
  }

  [el.comunaRetiro, el.comunaDespacho].forEach(inp => inp.addEventListener('input', recalcular));
  [el.cdOrigen, el.cdDestino, el.camion].forEach(sel => sel.addEventListener('change', recalcular));
  el.kilos.addEventListener('input', recalcular);

  // --- Mapa ---
  let fleetMap = null, capa = null;
  try {
    fleetMap = L.map('quote-fleet-map').setView([-36.5, -71.5], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(fleetMap);
    capa = L.layerGroup().addTo(fleetMap);
  } catch (err) {
    console.error('Error al cargar Leaflet:', err);
    $('quote-fleet-map').innerHTML = '<div class="flex justify-center items-center h-full text-secondary bg-surface-container-low">Mapa no disponible.</div>';
  }

  function pintarMapa(input, res) {
    if (!fleetMap || !capa) return;
    capa.clearLayers();
    if (!res || !res.ok) return;
    const pts = [];
    const add = (lat, lon, txt, color) => {
      if (lat == null || lon == null) return;
      L.circleMarker([lat, lon], { radius: 7, color, fillColor: color, fillOpacity: 0.9, weight: 2 }).addTo(capa).bindPopup(txt);
      pts.push([lat, lon]);
    };
    const cRet = ctx.comunas.get(normComuna(input.comunaRetiro));
    const cDes = ctx.comunas.get(normComuna(input.comunaDespacho));
    const gO = ctx.grupoInfo.get(res.cdOrigen), gD = ctx.grupoInfo.get(res.cdDestino);
    const directo = res.tramos.some(t => t.key === 'directo');
    if (input.comunaRetiro && cRet) add(cRet.lat, cRet.lon, `<strong>Retiro:</strong> ${escapeHtml(cRet.nombre)}`, '#f59e0b');
    if (!directo && gO) add(gO.lat, gO.lon, `<strong>CD origen:</strong> ${escapeHtml(gO.cdNombre)}`, '#3b82f6');
    if (!directo && res.tramos.some(t => t.key === 'troncal2')) {
      const h = ctx.grupoInfo.get(HUB_GRUPO);
      if (h) add(h.lat, h.lon, '<strong>Hub:</strong> Quilicura', '#a855f7');
    }
    if (!directo && gD && res.cdDestino !== res.cdOrigen) add(gD.lat, gD.lon, `<strong>CD destino:</strong> ${escapeHtml(gD.cdNombre)}`, '#3b82f6');
    if (input.retira !== 'CD' && cDes) add(cDes.lat, cDes.lon, `<strong>Despacho:</strong> ${escapeHtml(cDes.nombre)}`, '#16a34a');
    if (pts.length > 1) {
      L.polyline(pts, { color: '#b5000b', weight: 3, dashArray: '6 6' }).addTo(capa);
      fleetMap.fitBounds(pts, { padding: [40, 40] });
    } else if (pts.length === 1) {
      fleetMap.setView(pts[0], 10);
    }
  }

  // --- Cálculo ---
  let kmToken = 0;
  function leerInput() {
    const f = FLUJOS[state.flujo];
    return {
      flujo: state.flujo,
      tipoNegocio: f.tipo,
      servicio: state.servicio,
      cdOrigen: f.origen === 'CENTRO' ? el.cdOrigen.value : '',
      comunaRetiro: f.origen === 'COMUNA' ? el.comunaRetiro.value.trim() : '',
      cdDestino: f.destino === 'CENTRO' ? el.cdDestino.value : '',
      comunaDespacho: f.destino === 'COMUNA' ? el.comunaDespacho.value.trim() : '',
      kilos: Number(el.kilos.value) || 0,
      camion: el.camion.value || null,
      retira: f.destino === 'CENTRO' ? 'CD' : 'NO'
    };
  }

  function recalcular() {
    const input = leerInput();
    // Regla A necesita la distancia directa retiro → despacho cuando ambas
    // comunas comparten un centro Regional
    let kmInfo = null;
    if (input.flujo === 'EBE-RET/EBE-DESP' && input.servicio === 'consolidado') {
      const cdsRet = cdsDeComuna(ctx, input.comunaRetiro);
      const comparten = cdsDeComuna(ctx, input.comunaDespacho).some(g => cdsRet.includes(g));
      const a = ctx.comunas.get(normComuna(input.comunaRetiro));
      const b = ctx.comunas.get(normComuna(input.comunaDespacho));
      if (comparten && a?.lat != null && b?.lat != null) {
        const key = `${a.lat},${a.lon}|${b.lat},${b.lon}`;
        if (_kmCache.has(key)) {
          kmInfo = _kmCache.get(key);
        } else {
          const token = ++kmToken;
          kmCarretera(a, b).then(() => { if (token === kmToken) recalcular(); });
        }
      }
    }
    if (kmInfo) input.kmDirecto = kmInfo.km;
    const res = cotizar(ctx, input);
    if (kmInfo?.estimado && res.ok) res.avisos.push(`Distancia directa estimada en línea recta × 1,3 (${kmInfo.km} km): no se pudo consultar la ruta por carretera.`);
    pintar(input, res, kmInfo);
  }

  const vacio = (txt) => `<p class="text-[12px] text-secondary italic">${txt}</p>`;

  function pintar(input, res, kmInfo) {
    const nombreCD = g => ctx.grupoInfo.get(g)?.nombre || g || '—';
    const fila = (k, v) => `<li class="flex justify-between gap-md border-b border-outline-variant pb-xs"><span class="text-secondary">${k}</span><span class="font-bold text-on-surface text-right">${v}</span></li>`;
    const calzada = input.tipoNegocio === 'CALZADA';
    el.resumen.innerHTML =
      fila('Flujo', escapeHtml(input.flujo) + ` · ${input.tipoNegocio}`) +
      fila('Servicio', input.servicio === 'exclusivo' ? 'Exclusivo' : 'Consolidado') +
      fila('Origen', input.comunaRetiro ? `Retiro en ${escapeHtml(input.comunaRetiro)}` : `Centro ${escapeHtml(nombreCD(input.cdOrigen))}`) +
      fila('Destino', input.retira === 'CD' ? `Cliente retira en ${escapeHtml(nombreCD(input.cdDestino))}` : escapeHtml(input.comunaDespacho || '—')) +
      (res.ok ? fila('Recorrido óptimo', escapeHtml(res.ruta || '—')) : '') +
      fila('Kilos cotizados', input.kilos ? input.kilos.toLocaleString('es-CL') + ' kg' : '—') +
      fila('Vehículo milla', escapeHtml(res.camionMilla || '—')) +
      (kmInfo ? fila('Distancia directa', `${kmInfo.km.toLocaleString('es-CL')} km${kmInfo.estimado ? ' (est.)' : ''}`) : '');

    if (!res.ok) {
      el.tramos.innerHTML = vacio(escapeHtml(res.error || 'Complete los datos de la cotización.'));
      el.total.textContent = '$0';
      el.decisiones.innerHTML = '';
      el.avisos.innerHTML = '';
      state.ultimo = null;
      pintarMapa(input, null);
      return;
    }

    el.tramos.innerHTML = res.tramos.map((t, i) => `
      <div class="bg-surface-container-lowest border border-outline-variant rounded p-sm">
        <div class="flex justify-between items-center gap-sm">
          <span class="font-bold text-[13px] text-on-surface">${i + 1}. ${escapeHtml(t.label)}</span>
          <span class="font-data-mono font-bold text-[14px] text-on-surface whitespace-nowrap">${formatCLP(t.monto)}</span>
        </div>
        <div class="flex items-center gap-xs mt-[2px] flex-wrap">
          ${t.ruta ? `<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-secondary">${escapeHtml(t.ruta)}</span>` : ''}
          <span class="text-[11px] text-secondary">${escapeHtml(t.regla || '')}</span>
        </div>
      </div>`).join('');
    el.total.textContent = formatCLP(res.total);

    el.decisiones.innerHTML = res.decisiones.length ? `
      <div class="border border-outline-variant rounded p-sm bg-surface-container-lowest">
        <div class="flex justify-between items-center mb-xs">
          <p class="font-label-caps text-label-caps text-secondary">ALTERNATIVAS EVALUADAS</p>
          ${res.ahorro > 0 ? `<span class="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">Ahorro ${formatCLP(res.ahorro)}</span>` : ''}
        </div>
        ${res.decisiones.map(d => `
          <p class="text-[11px] font-bold text-on-surface mt-xs">${escapeHtml(d.tramo)}</p>
          ${d.opciones.map(o => `
            <div class="flex justify-between text-[12px] ${o.elegida ? 'text-green-800 font-bold' : 'text-secondary line-through'}">
              <span>${o.elegida ? '✔' : '✕'} ${escapeHtml(o.nombre)}</span>
              <span class="font-data-mono">${formatCLP(o.monto)}</span>
            </div>`).join('')}`).join('')}
      </div>` : '';

    el.avisos.innerHTML = res.avisos.map(a =>
      `<div class="flex gap-xs text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-xs"><span class="material-symbols-outlined text-[14px]">info</span><span>${escapeHtml(a)}</span></div>`).join('');

    pintarMapa(input, res);
    guardarHistorial(input, res);
  }

  // Guarda en el historial sólo cuando la cotización se estabiliza (evita una
  // entrada por cada tecla digitada).
  let histTimer = null;
  function guardarHistorial(input, res) {
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      const origen = input.comunaRetiro || (ctx.grupoInfo.get(input.cdOrigen)?.nombre || input.cdOrigen);
      const destino = input.retira === 'CD' ? `Retira ${ctx.grupoInfo.get(input.cdDestino)?.nombre || input.cdDestino}` : input.comunaDespacho;
      saveRecentQuote({
        firma: [input.flujo, input.servicio, origen, destino, input.kilos, input.camion || '', input.retira].join('|'),
        fecha: new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }),
        negocio: input.tipoNegocio, flujo: input.flujo,
        servicio: input.servicio === 'exclusivo' ? 'Exclusivo' : 'Consolidado',
        origen, destino, kilos: input.kilos, monto: res.total
      });
      renderHistoryTable(loadRecentQuotes());
    }, 1500);
  }

  // --- Administrador Regla B (OWNER) ---
  if (esOwner) {
    const body = $('q-admin-body'), chevron = $('q-admin-chevron'), grid = $('q-admin-grid');
    $('q-admin-toggle').addEventListener('click', () => {
      body.classList.toggle('hidden');
      chevron.textContent = body.classList.contains('hidden') ? 'expand_more' : 'expand_less';
    });
    const pintarAdmin = () => {
      const tarifas = getRetiroTroncalTarifas(ccfg);
      const lista = [...new Set([...Object.keys(RETIRO_TRONCAL_DEFAULT), ...grupos.map(g => g.grupo)])];
      grid.innerHTML = lista.map(g => `
        <label class="space-y-xs block">
          <span class="${labelCls} text-[10px]">${escapeHtml(ctx.grupoInfo.get(g)?.nombre || g)}</span>
          <input type="number" min="0" step="1000" data-retiro-grupo="${escapeHtml(g)}" value="${Number(tarifas[g]) || 0}"
            class="w-full border border-[#CED4DA] p-xs font-data-mono text-right bg-white rounded">
        </label>`).join('');
    };
    pintarAdmin();
    $('q-admin-save').addEventListener('click', () => {
      const nuevo = {};
      grid.querySelectorAll('[data-retiro-grupo]').forEach(inp => {
        nuevo[inp.dataset.retiroGrupo] = Math.max(0, Math.round(Number(inp.value) || 0));
      });
      ccfg.retiroTroncal = nuevo;
      saveDatabase(db, { syncOnly: ['clientTariffConfig'] });
      showAlert('Tarifas de retiro troncal guardadas.', 'success');
      recalcular();
    });
  }

  aplicarVisibilidad();
  renderHistoryTable(loadRecentQuotes());
  recalcular();
}

function renderHistoryTable(list) {
  const tbody = document.getElementById('quotes-history-tbody');
  if (!tbody) return;
  if (!list || !list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-md text-center text-secondary">No hay cotizaciones registradas recientemente.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(q => `
    <tr class="border-b border-outline-variant">
      <td class="p-md font-data-mono text-data-mono whitespace-nowrap">${escapeHtml(q.fecha)}</td>
      <td class="p-md"><span class="inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${q.negocio === 'CALZADA' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">${escapeHtml(q.flujo || q.negocio)}</span> ${escapeHtml(q.servicio)}</td>
      <td class="p-md">${escapeHtml(q.origen)} → ${escapeHtml(q.destino)}</td>
      <td class="p-md text-right font-data-mono">${Number(q.kilos || 0).toLocaleString('es-CL')}</td>
      <td class="p-md text-right font-bold">${formatCLP(q.monto)}</td>
    </tr>`).join('');
}
