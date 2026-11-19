// ============================================================================
// MAESTRO DE OBRAS Y CLIENTES (18-nov-2026, Jordan)
// ----------------------------------------------------------------------------
// · Tablas maestro_obras / maestro_clientes (Supabase). Se alimentan solas desde
//   los archivos SAP (fn_maestro_obras_sync, pg_cron cada 10 min) y se georreferencian
//   automáticamente con OpenStreetMap (fn_maestro_obras_geocodificar).
// · Estados de georreferencia:
//     PENDIENTE  sin intentar todavía
//     AUTO       encontrada con número
//     AUTO_CALLE encontrada a nivel de calle (aprox., conviene verificar)
//     REVISAR    no encontrada → georreferenciar a mano
//     MANUAL     fijada / confirmada por un usuario
// · Cada pedido nuevo con la misma obra toma la ubicación guardada.
// · Editor compartido (Monitor de Pedidos, Coordinación de carga y esta vista):
//   mapa con pin arrastrable, búsqueda de dirección y datos de contacto
//   (nombre, teléfono y correo opcional).
// ============================================================================
import { supabase } from './supabase-client.js?v=202611190929';
import { loadLeaflet, escapeHtml as esc } from './utils.js';
import { can } from './permisos.js?v=202611190929';

export const GEO = {
  PENDIENTE:  { txt: 'Pendiente',           largo: 'Pendiente de georreferenciar (automático en curso)', color: '#6b7280', bg: '#f3f4f6', ink: '#374151', icon: 'hourglass_top', falta: true },
  REVISAR:    { txt: 'Falta ubicar',        largo: 'No se encontró la dirección: georreferenciar a mano', color: '#dc2626', bg: '#fee2e2', ink: '#991b1b', icon: 'wrong_location', falta: true },
  AUTO_CALLE: { txt: 'Calle (aprox.)',      largo: 'Ubicada a nivel de calle: conviene confirmar el punto', color: '#d97706', bg: '#fef3c7', ink: '#92400e', icon: 'add_location', falta: false },
  AUTO:       { txt: 'Ubicada (auto)',      largo: 'Ubicada automáticamente con número', color: '#16a34a', bg: '#dcfce7', ink: '#166534', icon: 'where_to_vote', falta: false },
  MANUAL:     { txt: 'Ubicada (manual)',    largo: 'Ubicación fijada por un usuario', color: '#16a34a', bg: '#dcfce7', ink: '#166534', icon: 'person_pin_circle', falta: false },
};
export const geoDe = o => GEO[(o && o.geo_estado) || 'PENDIENTE'] || GEO.PENDIENTE;
export const tieneUbicacion = o => !!o && Number.isFinite(+o.lat) && Number.isFinite(+o.lon) && o.lat !== null && !geoDe(o).falta;
export const faltaGeo = o => !tieneUbicacion(o);
export const puedeEditarObras = () => can('editar') || can('coordinar_venta');

const ms = i => `<span class="material-symbols-outlined">${i}</span>`;
const z = v => String(v ?? '').trim().replace(/^0+(?=\d)/, '');
export function badgeGeo(o, corto = true) {
  const g = geoDe(o);
  return `<span class="mo-badge" style="background:${g.bg};color:${g.ink}" title="${esc(g.largo)}">${ms(g.icon)}${esc(corto ? g.txt : g.largo)}</span>`;
}

/** Obras del maestro por id (Map id_obra → fila). */
export async function cargarObras(ids) {
  const out = new Map();
  const l = [...new Set((ids || []).map(z).filter(Boolean))];
  for (let i = 0; i < l.length; i += 300) {
    const { data, error } = await supabase.from('maestro_obras').select('*').in('id_obra', l.slice(i, i + 300));
    if (error) throw new Error(error.message);
    (data || []).forEach(o => out.set(z(o.id_obra), o));
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   EDITOR DE OBRA (modal)
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Abre el editor de una obra. opts.base completa datos si la obra aún no está en el maestro
 * ({ direccion, comuna, nombre_cliente, id_cliente, ruta }); opts.centro = { lat, lon } punto inicial.
 * Devuelve la obra guardada o null si se cierra sin guardar.
 */
export async function abrirEditorObra(idObra, opts = {}) {
  estilos();
  const id = z(idObra);
  if (!id) return null;
  await loadLeaflet();
  const { data: actual } = await supabase.from('maestro_obras').select('*').eq('id_obra', id).maybeSingle();
  const b = opts.base || {};
  const o = actual || { id_obra: id, geo_estado: 'PENDIENTE', lat: null, lon: null };
  const st = {
    direccion: o.direccion || b.direccion || '', comuna: o.comuna || b.comuna || '',
    contacto_nombre: o.contacto_nombre || '', contacto_telefono: o.contacto_telefono || '', contacto_email: o.contacto_email || '',
    lat: o.lat, lon: o.lon, movido: false, confirmar: false,
  };
  const editable = puedeEditarObras();
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'mo-bg';
    bg.innerHTML = `<div class="mo-dlg" role="dialog" aria-label="Obra ${esc(id)}">
      <header class="mo-h"><div class="mo-h-ic">${ms('apartment')}</div>
        <div style="flex:1;min-width:0"><div class="mo-h-t">Obra ${esc(id)} <span data-badge>${badgeGeo(o)}</span></div>
        <div class="mo-h-s">${esc(o.nombre_cliente || b.nombre_cliente || 'Cliente sin nombre')}${(o.id_cliente || b.id_cliente) ? ` · cliente <span class="mono">${esc(o.id_cliente || b.id_cliente)}</span>` : ''}</div></div>
        <button class="mo-x" data-cerrar title="Cerrar (Esc)">${ms('close')}</button></header>
      <div class="mo-body">
        <div class="mo-mapcol">
          <div class="mo-search">${ms('search')}<input data-q placeholder="Buscar dirección (calle número, comuna)…" value="${esc([st.direccion, st.comuna].filter(Boolean).join(', '))}"><button class="mo-btn sm" data-buscar>Buscar</button></div>
          <div class="mo-res" data-res></div>
          <div class="mo-map" data-map></div>
          <div class="mo-hint">${ms('touch_app')}Arrastre el pin o haga clic en el mapa en el acceso de la obra.</div>
        </div>
        <div class="mo-form">
          <div class="mo-sec">Dirección</div>
          <label class="mo-f"><span>Dirección</span><input data-k="direccion" value="${esc(st.direccion)}" ${editable ? '' : 'disabled'}></label>
          <label class="mo-f"><span>Comuna</span><input data-k="comuna" value="${esc(st.comuna)}" ${editable ? '' : 'disabled'}></label>
          <div class="mo-geo" data-geo></div>
          <div class="mo-ll">
            <label class="mo-f"><span>Latitud</span><input data-ll="lat" inputmode="decimal" value="${Number.isFinite(+st.lat) && st.lat !== null ? (+st.lat).toFixed(6) : ''}" ${editable ? '' : 'disabled'} placeholder="-33.456789"></label>
            <label class="mo-f"><span>Longitud</span><input data-ll="lon" inputmode="decimal" value="${Number.isFinite(+st.lon) && st.lon !== null ? (+st.lon).toFixed(6) : ''}" ${editable ? '' : 'disabled'} placeholder="-70.654321"></label>
          </div>
          ${editable ? '<div class="mo-muted">Puede pegar «lat, lon» copiado de Google Maps en cualquiera de los dos campos.</div>' : ''}
          <div class="mo-sec">Contacto en obra</div>
          <label class="mo-f"><span>Nombre contacto</span><input data-k="contacto_nombre" value="${esc(st.contacto_nombre)}" ${editable ? '' : 'disabled'} placeholder="Nombre y apellido"></label>
          <label class="mo-f"><span>Teléfono</span><input data-k="contacto_telefono" value="${esc(st.contacto_telefono)}" ${editable ? '' : 'disabled'} placeholder="+56 9 …"></label>
          <label class="mo-f"><span>Correo <small>(opcional)</small></span><input data-k="contacto_email" type="email" value="${esc(st.contacto_email)}" ${editable ? '' : 'disabled'} placeholder="nombre@empresa.cl"></label>
          <div class="mo-err" data-err></div>
          <div class="mo-acts">
            <button class="mo-btn" data-cerrar>Cancelar</button>
            ${editable ? `<button class="mo-btn pri" data-guardar>${ms('save')}Guardar</button>` : '<span class="mo-muted">Sin permiso de edición</span>'}
          </div>
          ${o.updated_by ? `<div class="mo-muted" style="margin-top:6px">Última edición: ${esc(o.updated_by)} · ${new Date(o.updated_at).toLocaleString('es-CL')}</div>` : ''}
        </div>
      </div></div>`;
    document.body.appendChild(bg);
    const $ = s => bg.querySelector(s);
    const fin = v => { try { map.remove(); } catch (_e) { /* */ } bg.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); fin(null); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('mousedown', e => { if (e.target === bg) fin(null); });
    bg.querySelectorAll('[data-cerrar]').forEach(x => x.addEventListener('click', () => fin(null)));
    bg.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { st[i.dataset.k] = i.value; }));

    // Mapa
    const ini = Number.isFinite(+st.lat) && st.lat !== null ? [+st.lat, +st.lon]
      : opts.centro && Number.isFinite(+opts.centro.lat) ? [+opts.centro.lat, +opts.centro.lon] : [-33.45, -70.66];
    const map = L.map($('[data-map]')).setView(ini, st.lat !== null && st.lat !== undefined ? 17 : 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const pin = L.marker(ini, { draggable: editable, icon: L.divIcon({ className: 'mo-pin-wrap', html: `<div class="mo-pin">${ms('location_on')}</div>`, iconSize: [36, 36], iconAnchor: [18, 34] }) }).addTo(map);
    const mover = (ll, desdeInput = false) => {
      pin.setLatLng(ll); st.lat = ll.lat; st.lon = ll.lng; st.movido = true; pintarGeo();
      if (!desdeInput) { $('[data-ll="lat"]').value = (+ll.lat).toFixed(6); $('[data-ll="lon"]').value = (+ll.lng).toFixed(6); }
    };
    // Coordenadas escritas o pegadas (acepta «-33.45, -70.66» en un solo campo). Rango Chile continental e insular.
    const enChile = (la, lo) => la >= -56.5 && la <= -17 && lo >= -110 && lo <= -66;
    bg.querySelectorAll('[data-ll]').forEach(i => i.addEventListener('input', () => {
      const par = i.value.match(/(-?\d+(?:\.\d+)?)\s*(?:[,;]\s*|\s+)(-\d+(?:\.\d+)?)/);
      if (par) { $('[data-ll="lat"]').value = par[1].replace(',', '.'); $('[data-ll="lon"]').value = par[2].replace(',', '.'); }
      const la = parseFloat(String($('[data-ll="lat"]').value).replace(',', '.')), lo = parseFloat(String($('[data-ll="lon"]').value).replace(',', '.'));
      const err = $('[data-err]');
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
      if (!enChile(la, lo)) { err.textContent = 'Coordenadas fuera de Chile: revise latitud (−17 a −56) y longitud (−66 a −110).'; return; }
      err.textContent = '';
      const ll = L.latLng(la, lo); map.setView(ll, Math.max(map.getZoom(), 16)); mover(ll, true);
    }));
    pin.on('dragend', () => mover(pin.getLatLng()));
    if (editable) map.on('click', e => mover(e.latlng));
    setTimeout(() => map.invalidateSize(), 50);

    function pintarGeo() {
      const g = geoDe(o);
      const coord = Number.isFinite(+st.lat) && st.lat !== null ? `${(+st.lat).toFixed(6)}, ${(+st.lon).toFixed(6)}` : 'sin coordenadas';
      $('[data-geo]').innerHTML = st.movido
        ? `<div class="mo-geo-l ok">${ms('check_circle')}<b>Nueva ubicación marcada</b> <span class="mono">${coord}</span></div><div class="mo-muted">Se guardará como ubicación manual.</div>`
        : `<div class="mo-geo-l" style="color:${g.ink}">${ms(g.icon)}<b>${esc(g.largo)}</b></div>
           <div class="mo-muted mono">${coord}</div>${o.geo_detalle ? `<div class="mo-muted">${esc(o.geo_detalle)}</div>` : ''}
           ${editable && o.geo_estado === 'AUTO_CALLE' ? `<label class="mo-chk"><input type="checkbox" data-confirmar ${st.confirmar ? 'checked' : ''}> El punto es correcto (confirmar)</label>` : ''}
           ${editable && g.falta && !(st.lat !== null && st.lat !== undefined) ? '<div class="mo-warn">Busque la dirección o marque el punto en el mapa.</div>' : ''}`;
      $('[data-confirmar]')?.addEventListener('change', e => { st.confirmar = e.target.checked; });
    }
    pintarGeo();

    // Búsqueda (OpenStreetMap)
    const buscar = async () => {
      const q = $('[data-q]').value.trim(); if (!q) return;
      const res = $('[data-res]');
      res.innerHTML = '<div class="mo-muted">Buscando…</div>';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=cl&accept-language=es&q=${encodeURIComponent(/chile/i.test(q) ? q : q + ', Chile')}`);
        const l = await r.json();
        if (!l.length) { res.innerHTML = '<div class="mo-muted">Sin resultados. Pruebe sólo calle y comuna, o marque el punto en el mapa.</div>'; return; }
        res.innerHTML = l.map((x, i) => `<button class="mo-r" data-i="${i}">${ms('location_on')}<span>${esc(x.display_name)}</span></button>`).join('');
        res.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => {
          const x = l[+btn.dataset.i];
          const ll = L.latLng(+x.lat, +x.lon);
          map.setView(ll, 17);
          if (editable) mover(ll);
          res.innerHTML = '';
        }));
      } catch (e) { res.innerHTML = `<div class="mo-err">No se pudo buscar: ${esc(e.message)}</div>`; }
    };
    $('[data-buscar]').addEventListener('click', buscar);
    $('[data-q]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });

    // Guardar
    $('[data-guardar]')?.addEventListener('click', async e => {
      const btn = e.currentTarget, err = $('[data-err]');
      err.textContent = '';
      if (st.contacto_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.contacto_email.trim())) { err.textContent = 'Correo inválido.'; return; }
      if (st.movido && !(Number.isFinite(+st.lat) && Number.isFinite(+st.lon) && enChile(+st.lat, +st.lon))) { err.textContent = 'Latitud / longitud inválidas.'; return; }
      const fila = {
        id_obra: id,
        direccion: st.direccion.trim() || null, comuna: st.comuna.trim() || null,
        contacto_nombre: st.contacto_nombre.trim() || null, contacto_telefono: st.contacto_telefono.trim() || null,
        contacto_email: st.contacto_email.trim() || null,
      };
      if (!actual) Object.assign(fila, { id_cliente: b.id_cliente || null, nombre_cliente: b.nombre_cliente || null, ruta: b.ruta || null, requiere_geo: true });
      if (st.movido) Object.assign(fila, { lat: +(+st.lat).toFixed(6), lon: +(+st.lon).toFixed(6), geo_estado: 'MANUAL', geo_detalle: 'Ubicada a mano en SIT EBEMA' });
      else if (st.confirmar) Object.assign(fila, { geo_estado: 'MANUAL', geo_detalle: (o.geo_detalle || '') + ' · confirmada por usuario' });
      else if (actual && fila.direccion !== (actual.direccion || null) && actual.geo_estado !== 'MANUAL') Object.assign(fila, { geo_estado: 'PENDIENTE', geo_intentos: 0 });
      btn.disabled = true; btn.textContent = 'Guardando…';
      const q = actual ? supabase.from('maestro_obras').update(fila).eq('id_obra', id) : supabase.from('maestro_obras').insert(fila);
      const { data, error } = await q.select('*').maybeSingle();
      if (error) { btn.disabled = false; btn.innerHTML = `${ms('save')}Guardar`; err.textContent = 'No se pudo guardar: ' + error.message; return; }
      fin(data || { ...o, ...fila });
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════
   VISTA MAESTRO DE OBRAS Y CLIENTES
   ════════════════════════════════════════════════════════════════════════ */
const V = { obras: [], clientes: [], tab: 'obras', q: '', est: 'falta', soloDespacho: true, pag: 0 };
let vroot = null;
export async function renderMaestroObras(stage, sub = 'obras') {
  estilos();
  V.tab = sub === 'clientes' ? 'clientes' : 'obras'; V.pag = 0;
  stage.innerHTML = `<div class="mo-v">
    <header class="mo-v-top">
      <div class="mo-h-ic">${ms('apartment')}</div>
      <div style="margin-right:auto"><div class="mo-h-t">Socios de Negocios · Obras y Clientes</div><div class="mo-h-s">Se cargan solas desde SAP y se georreferencian automáticamente; las que no se encuentran quedan para ubicar a mano.</div></div>
      <nav class="mo-tabs"><button data-tab="obras" class="${V.tab === 'obras' ? 'is-on' : ''}">${ms('apartment')}Obras</button><button data-tab="clientes" class="${V.tab === 'clientes' ? 'is-on' : ''}">${ms('groups')}Clientes</button></nav>
    </header>
    <div class="mo-v-bar">
      <label class="mo-search" style="flex:1;max-width:420px">${ms('search')}<input data-q placeholder="Obra, cliente, dirección, comuna, contacto…"></label>
      <div class="mo-chips" data-est></div>
      <label class="mo-chk"><input type="checkbox" data-desp checked> Sólo obras con despacho</label>
      <button class="mo-btn sm" data-reload>${ms('refresh')}Actualizar</button>
    </div>
    <div class="mo-v-tab" data-cont><div class="mo-muted" style="padding:24px">Cargando…</div></div>
  </div>`;
  vroot = stage.querySelector('.mo-v');
  const $ = s => vroot.querySelector(s);
  vroot.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    V.tab = b.dataset.tab; V.pag = 0;
    vroot.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('is-on', x === b));
    pintarV();
  }));
  let t; $('[data-q]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { V.q = e.target.value.trim().toLowerCase(); V.pag = 0; pintarV(); }, 160); });
  $('[data-desp]').addEventListener('change', e => { V.soloDespacho = e.target.checked; V.pag = 0; pintarV(); });
  $('[data-reload]').addEventListener('click', () => cargarV());
  await cargarV();
}
async function cargarV() {
  const leer = async (tabla, orden) => {
    const out = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await supabase.from(tabla).select('*').order(orden).range(d, d + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    return out;
  };
  try {
    [V.obras, V.clientes] = await Promise.all([leer('maestro_obras', 'id_obra'), leer('maestro_clientes', 'id_cliente')]);
  } catch (e) { vroot.querySelector('[data-cont]').innerHTML = `<div class="mo-err" style="padding:24px">${esc(e.message)}</div>`; return; }
  pintarV();
}
function pintarV() {
  const $ = s => vroot.querySelector(s);
  $('[data-desp]').closest('label').style.display = V.tab === 'obras' ? '' : 'none';
  if (V.tab === 'clientes') return pintarClientes();
  const base = V.obras.filter(o => !V.soloDespacho || o.requiere_geo);
  const cuenta = k => k === 'todas' ? base.length : k === 'falta' ? base.filter(o => geoDe(o).falta).length : base.filter(o => o.geo_estado === k).length;
  const chips = [['falta', 'Falta ubicar', '#dc2626'], ['AUTO_CALLE', 'Calle (aprox.)', '#d97706'], ['AUTO', 'Auto', '#16a34a'], ['MANUAL', 'Manual', '#16a34a'], ['todas', 'Todas', '#191c1d']];
  $('[data-est]').innerHTML = chips.map(([k, l, c]) => `<button class="mo-chip${V.est === k ? ' is-on' : ''}" data-e="${k}" style="--c:${c}">${esc(l)} <b>${cuenta(k)}</b></button>`).join('');
  $('[data-est]').querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => { V.est = b.dataset.e; V.pag = 0; pintarV(); }));
  const q = V.q;
  const rows = base.filter(o => V.est === 'todas' || (V.est === 'falta' ? geoDe(o).falta : o.geo_estado === V.est))
    .filter(o => !q || [o.id_obra, o.id_cliente, o.nombre_cliente, o.direccion, o.comuna, o.ruta, o.contacto_nombre, o.contacto_telefono, o.contacto_email].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => String(b.visto_en || '').localeCompare(String(a.visto_en || '')));
  const PAG = 200, tot = rows.length, ver = rows.slice(V.pag * PAG, (V.pag + 1) * PAG);
  $('[data-cont]').innerHTML = `<div class="mo-tscroll"><table class="mo-t"><thead><tr>
      <th>Georreferencia</th><th>Obra</th><th>Cliente</th><th>Dirección</th><th>Comuna</th><th class="r">Latitud</th><th class="r">Longitud</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
    <tbody>${ver.map(o => `<tr data-id="${esc(o.id_obra)}">
      <td>${badgeGeo(o)}</td><td class="mono"><b>${esc(o.id_obra)}</b></td>
      <td class="mo-trunc" title="${esc(o.nombre_cliente || '')}">${esc(o.nombre_cliente || '—')} <span class="mo-muted mono">${esc(o.id_cliente || '')}</span></td>
      <td class="mo-trunc" title="${esc(o.direccion || '')}">${esc(o.direccion || '—')}</td><td>${esc(o.comuna || '—')}</td>
      <td class="r mono">${o.lat != null ? (+o.lat).toFixed(6) : '—'}</td><td class="r mono">${o.lon != null ? (+o.lon).toFixed(6) : '—'}</td>
      <td>${esc(o.contacto_nombre || '—')}</td><td class="mono">${esc(o.contacto_telefono || '—')}</td><td>${esc(o.contacto_email || '—')}</td>
      <td><button class="mo-btn sm" data-edit>${ms(geoDe(o).falta ? 'edit_location_alt' : 'edit')}${geoDe(o).falta ? 'Ubicar' : 'Editar'}</button></td></tr>`).join('')
      || '<tr><td colspan="11" class="mo-muted" style="text-align:center;padding:24px">Sin obras para el filtro.</td></tr>'}</tbody></table></div>
    <div class="mo-pag"><span class="mo-muted">${tot} obras${tot > PAG ? ` · página ${V.pag + 1} de ${Math.ceil(tot / PAG)}` : ''}</span>
      ${tot > PAG ? `<button class="mo-btn sm" data-p="-1" ${V.pag ? '' : 'disabled'}>‹</button><button class="mo-btn sm" data-p="1" ${(V.pag + 1) * PAG < tot ? '' : 'disabled'}>›</button>` : ''}</div>`;
  $('[data-cont]').querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { V.pag += +b.dataset.p; pintarV(); }));
  $('[data-cont]').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    const r = await abrirEditorObra(id);
    if (r) { const i = V.obras.findIndex(x => x.id_obra === r.id_obra); if (i >= 0) V.obras[i] = r; pintarV(); }
  }));
}
function pintarClientes() {
  const $ = s => vroot.querySelector(s);
  $('[data-est]').innerHTML = '';
  const nObras = new Map(); V.obras.forEach(o => nObras.set(o.id_cliente, (nObras.get(o.id_cliente) || 0) + 1));
  const q = V.q;
  const rows = V.clientes.filter(c => !q || [c.id_cliente, c.nombre, c.contacto_nombre, c.contacto_telefono, c.contacto_email].some(x => String(x || '').toLowerCase().includes(q)));
  const ver = rows.slice(0, 300);
  const editable = puedeEditarObras();
  $('[data-cont]').innerHTML = `<div class="mo-tscroll"><table class="mo-t"><thead><tr><th>Cliente</th><th>Nombre</th><th class="r">Obras</th><th>Contacto</th><th>Teléfono</th><th>Correo (opcional)</th><th></th></tr></thead>
    <tbody>${ver.map(c => `<tr data-id="${esc(c.id_cliente)}"><td class="mono"><b>${esc(c.id_cliente)}</b></td><td>${esc(c.nombre || '—')}</td><td class="r mono">${nObras.get(c.id_cliente) || 0}</td>
      <td><input class="mo-in" data-f="contacto_nombre" value="${esc(c.contacto_nombre || '')}" ${editable ? '' : 'disabled'}></td>
      <td><input class="mo-in" data-f="contacto_telefono" value="${esc(c.contacto_telefono || '')}" ${editable ? '' : 'disabled'}></td>
      <td><input class="mo-in" data-f="contacto_email" value="${esc(c.contacto_email || '')}" ${editable ? '' : 'disabled'}></td>
      <td>${editable ? `<button class="mo-btn sm" data-save disabled>${ms('save')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="mo-pag"><span class="mo-muted">${rows.length} clientes${rows.length > ver.length ? ' · mostrando 300 (use la búsqueda)' : ''}</span></div>`;
  $('[data-cont]').querySelectorAll('tr[data-id]').forEach(tr => {
    const btn = tr.querySelector('[data-save]'); if (!btn) return;
    tr.querySelectorAll('[data-f]').forEach(i => i.addEventListener('input', () => { btn.disabled = false; btn.classList.add('pri'); }));
    btn.addEventListener('click', async () => {
      const f = {}; tr.querySelectorAll('[data-f]').forEach(i => { f[i.dataset.f] = i.value.trim() || null; });
      if (f.contacto_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contacto_email)) { alert('Correo inválido'); return; }
      btn.disabled = true;
      const { error } = await supabase.from('maestro_clientes').update(f).eq('id_cliente', tr.dataset.id);
      if (error) { btn.disabled = false; alert('No se pudo guardar: ' + error.message); return; }
      const c = V.clientes.find(x => x.id_cliente === tr.dataset.id); Object.assign(c, f);
      btn.classList.remove('pri'); btn.innerHTML = ms('check');
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════
   ESTILOS (prefijo mo-)
   ════════════════════════════════════════════════════════════════════════ */
function estilos() {
  if (document.getElementById('mo-style')) return;
  const s = document.createElement('style');
  s.id = 'mo-style';
  s.textContent = `
.mo-bg{position:fixed;inset:0;z-index:2300;background:rgba(25,28,29,.42);display:flex;align-items:center;justify-content:center;padding:16px}
.mo-dlg{background:#fff;border-radius:12px;width:min(1080px,100%);max-height:94vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;color:#191c1d;font-size:13.5px}
.mo-dlg *,.mo-v *{box-sizing:border-box}
.mo-dlg .material-symbols-outlined,.mo-v .material-symbols-outlined,.mo-badge .material-symbols-outlined{font-size:18px;line-height:1;vertical-align:middle;display:inline-block;width:1em;overflow:hidden;flex-shrink:0}
.mo-h{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #e1e3e4}
.mo-h-ic{width:38px;height:38px;border-radius:9px;background:#ffdad5;color:#b5000b;display:flex;align-items:center;justify-content:center}
.mo-h-ic .material-symbols-outlined{font-size:22px}
.mo-h-t{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mo-h-s{font-size:12.5px;color:#5c5f61}
.mo-x{border:none;background:none;cursor:pointer;color:#5c5f61;padding:4px;border-radius:6px;display:flex}.mo-x:hover{background:#edeeef;color:#b5000b}
.mo-body{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);min-height:0;flex:1;overflow:auto}
.mo-mapcol{display:flex;flex-direction:column;gap:8px;padding:12px;border-right:1px solid #e1e3e4;min-height:520px}
.mo-map{flex:1;min-height:380px;border-radius:8px;border:1px solid #e1e3e4}
.mo-hint{font-size:11.5px;color:#5c5f61;display:flex;align-items:center;gap:5px}
.mo-search{display:flex;align-items:center;gap:6px;border:1px solid #e1e3e4;border-radius:8px;padding:5px 6px 5px 10px;background:#fff}
.mo-search input{border:none;outline:none;flex:1;font:inherit;background:none;min-width:0}
.mo-res{display:flex;flex-direction:column;gap:3px;max-height:160px;overflow:auto}
.mo-r{display:flex;align-items:flex-start;gap:6px;text-align:left;border:1px solid #e1e3e4;background:#fff;border-radius:6px;padding:6px 8px;cursor:pointer;font:inherit;font-size:12px}
.mo-r:hover{border-color:#b5000b;background:#fff5f3}
.mo-form{padding:14px 16px;display:flex;flex-direction:column;gap:9px}
.mo-sec{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5c5f61;margin-top:4px}
.mo-f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#444749}
.mo-f input,.mo-in{border:1px solid #e1e3e4;border-radius:6px;padding:7px 9px;font:inherit;font-size:13px;color:#191c1d;background:#fff}
.mo-in{padding:4px 7px;width:100%;min-width:120px}
.mo-f input:focus,.mo-in:focus{outline:2px solid #ffdad5;border-color:#b5000b}
.mo-f input:disabled{background:#f3f4f5}
.mo-geo{background:#f8f9fa;border:1px solid #edeeef;border-radius:8px;padding:9px 10px;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.mo-ll{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mo-ll input{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px}
.mo-geo-l{display:flex;align-items:center;gap:6px}.mo-geo-l.ok{color:#166534}
.mo-warn{color:#991b1b;font-size:12px;font-weight:600}
.mo-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}
.mo-chk input{accent-color:#b5000b;width:15px;height:15px}
.mo-err{color:#b91c1c;font-size:12.5px;min-height:1px}
.mo-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:auto;padding-top:8px}
.mo-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #e1e3e4;background:#fff;border-radius:7px;padding:7px 13px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:#191c1d;white-space:nowrap}
.mo-btn:hover:not(:disabled){border-color:#5c5f61}.mo-btn:disabled{opacity:.45;cursor:default}
.mo-btn.pri{background:#b5000b;border-color:#b5000b;color:#fff}.mo-btn.sm{padding:4px 9px;font-size:12px}
.mo-muted{color:#5c5f61;font-size:11.5px}.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}
.mo-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px 2px 6px;border-radius:999px;white-space:nowrap;font-family:Inter,system-ui,sans-serif}
.mo-badge .material-symbols-outlined{font-size:14px!important}
.mo-pin-wrap{background:none;border:none}
.mo-pin{color:#b5000b;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}.mo-pin .material-symbols-outlined{font-size:36px!important;font-variation-settings:'FILL' 1}
.mo-v{display:flex;flex-direction:column;gap:10px;color:#191c1d;font-size:13.5px}
.mo-v-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid #e1e3e4;border-radius:8px;padding:10px 14px}
.mo-tabs{display:flex;gap:4px;background:#edeeef;padding:3px;border-radius:8px}
.mo-tabs button{border:none;background:none;padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit;font-weight:600;color:#444749;display:flex;align-items:center;gap:6px}
.mo-tabs button.is-on{background:#fff;color:#b5000b;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mo-v-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mo-chips{display:flex;gap:6px;flex-wrap:wrap}
.mo-chip{border:1.5px solid #e1e3e4;background:#fff;border-radius:999px;padding:4px 11px;font:inherit;font-size:12.5px;cursor:pointer;color:#444749}
.mo-chip b{color:var(--c)}.mo-chip.is-on{border-color:var(--c);background:color-mix(in srgb,var(--c) 8%,#fff);color:#191c1d}
.mo-v-tab{background:#fff;border:1px solid #e1e3e4;border-radius:8px;overflow:hidden}
.mo-tscroll{overflow:auto;max-height:calc(100vh - 290px)}
table.mo-t{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.mo-t th{position:sticky;top:0;background:#f3f4f5;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#5c5f61;padding:8px 10px;border-bottom:1px solid #e1e3e4;white-space:nowrap;z-index:1}
.mo-t td{padding:6px 10px;border-bottom:1px solid #edeeef;white-space:nowrap}
.mo-t .r{text-align:right}.mo-t tbody tr:hover{background:#f8f9fa}
.mo-trunc{max-width:260px;overflow:hidden;text-overflow:ellipsis}
.mo-pag{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #e1e3e4}
@media (max-width:900px){.mo-body{grid-template-columns:1fr}.mo-mapcol{border-right:none;border-bottom:1px solid #e1e3e4}}
`;
  document.head.appendChild(s);
}
