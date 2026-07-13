// ==========================================================================
//  SIT EBEMA  |  Vista CLUSTER OPERATIVO  (cluster-rutas.js)
//  Asignacion definitiva del cluster por ruta sobre la tabla `cluster_rutas`.
//  - Motor de ejes (azimut) + densidad -> cluster HOMOLOGABLE (NORTE/SUR/...).
//  - Rutas INTERREGIONALES -> SPOT automatico.
//  - Sectores heredan de su comuna (cascada via trigger en la BD).
// ==========================================================================
import { supabase } from './supabase-client.js';
import { showAlert } from './utils.js';

// --- Cartas de Eje Vial por centro. CLAVE = codigo homologable (cardinal).
//     rangos = sectores de azimut [min, max) en grados (0=N, 90=E).
const EJES_POR_CENTRO = {
  '1100': { // Puerto Montt
    NORTE: { alias: 'Norte (Ruta 5 Norte)',                rangos: [[310,360],[0,50]] },
    ESTE:  { alias: 'Austral-Costa (Cordillera oriental)', rangos: [[50,160]] },
    SUR:   { alias: 'Sur-Isla (Insular / Canales)',        rangos: [[160,310]] },
  },
};
// Carta generica (4 cardinales) para cualquier otro centro
const EJES_DEFAULT = {
  NORTE: { alias: 'Norte',  rangos: [[315,360],[0,45]] },
  ESTE:  { alias: 'Este',   rangos: [[45,135]] },
  SUR:   { alias: 'Sur',    rangos: [[135,225]] },
  OESTE: { alias: 'Oeste',  rangos: [[225,315]] },
};

// --- Vista FRECUENCIAS (homologable)
const FRECUENCIAS = {
  C1:                 { frecuencia: 'Diaria (Fija)',                         flota: 'Flota Propia' },
  C2:                 { frecuencia: 'Lunes-Miercoles-Viernes (Frecuencial)', flota: 'Flota Propia' },
  C3:                 { frecuencia: 'Martes-Jueves (Acoplado por Arrastre)', flota: 'Flota Propia (Consolida en Hub)' },
  C4:                 { frecuencia: 'A Demanda / Servicio Extra',            flota: 'Servicio Extra (Contratado por viaje)' },
  SPOT_LOCAL:         { frecuencia: 'A Demanda (SLA 48 Hrs)',               flota: 'Servicio Extra (Tercerizado FTL)' },
  SPOT_INTERREGIONAL: { frecuencia: 'A Demanda (SLA 48 Hrs)',               flota: 'Servicio Extra' },
};
const DENS_OPTS = ['C1','C2','C3','C4','SPOT_LOCAL'];

// --- Estado del modulo
let CENTROS = [];            // [{id, nombre, lat, lon}]
let centroSel = '1100';
let filas = [];              // filas de cluster_rutas del centro

// ==========================================================================
// Motor geografico
// ==========================================================================
function azimut(latO, lonO, latD, lonD) {
  const r = Math.PI / 180;
  const l1 = latO*r, l2 = latD*r, dl = (lonD-lonO)*r;
  const x = Math.sin(dl)*Math.cos(l2);
  const y = Math.cos(l1)*Math.sin(l2) - Math.sin(l1)*Math.cos(l2)*Math.cos(dl);
  return (Math.atan2(x,y)/r + 360) % 360;
}
function ejeDe(az, carta) {
  for (const [cod, cfg] of Object.entries(carta)) {
    for (const [lo,hi] of cfg.rangos) if (az>=lo && az<hi) return { eje: cod, alias: cfg.alias };
  }
  return { eje: 'SIN-EJE', alias: 'Sin eje' };
}
function esInterregional(clasif) {
  return String(clasif||'').trim().toLowerCase().startsWith('interreg');
}
function clusterDeComuna({ clasif, densidad, eje, alias }) {
  if (esInterregional(clasif)) {
    const r = FRECUENCIAS.SPOT_INTERREGIONAL;
    return { eje_vial:'INTERREGIONAL', descripcion_eje:'Interregional (SLA 48h)',
             cluster:'SPOT_INTERREGIONAL', frecuencia:r.frecuencia, tipo_flota:r.flota };
  }
  if (!densidad) { // sin densidad asignada
    return { eje_vial:eje, descripcion_eje:alias, cluster:`${eje}-SD`,
             frecuencia:'Por asignar (falta densidad)', tipo_flota:'Por asignar' };
  }
  if (densidad === 'SPOT_LOCAL') {
    const r = FRECUENCIAS.SPOT_LOCAL;
    return { eje_vial:eje, descripcion_eje:alias, cluster:'SPOT_LOCAL',
             frecuencia:r.frecuencia, tipo_flota:r.flota };
  }
  const r = FRECUENCIAS[densidad];
  return { eje_vial:eje, descripcion_eje:alias, cluster:`${eje}-${densidad}`,
           frecuencia:r.frecuencia, tipo_flota:r.flota };
}

// ==========================================================================
// Datos
// ==========================================================================
async function cargarCentros() {
  const { data, error } = await supabase.from('logistics_centres')
    .select('id, nombre, lat, lon').order('id');
  if (error) { console.error(error); CENTROS = []; return; }
  CENTROS = data || [];
}
async function cargarFilas() {
  const { data, error } = await supabase.from('cluster_rutas')
    .select('*').eq('centro', centroSel).order('comuna_padre').order('tipo_destino');
  if (error) { console.error(error); showAlert('Error cargando cluster: '+error.message); filas = []; return; }
  filas = data || [];
}

// Recalcular desde routes: sincroniza rutas -> cluster_rutas (respeta overrides)
async function recalcularDesdeRutas() {
  const centro = CENTROS.find(c => String(c.id) === String(centroSel));
  if (!centro || centro.lat == null) { showAlert('El centro no tiene coordenadas.'); return; }
  const carta = EJES_POR_CENTRO[centroSel] || EJES_DEFAULT;

  const { data: rutas, error } = await supabase.from('routes')
    .select('destino, comuna, region, tipo, clasificRuta, lat, lon')
    .eq('origenId', centroSel);
  if (error) { showAlert('Error leyendo rutas: '+error.message); return; }
  if (!rutas || !rutas.length) { showAlert('El centro no tiene rutas cargadas.'); return; }

  // densidad ya asignada (para no perderla en filas no marcadas manual)
  const densPrev = {};
  filas.forEach(f => { densPrev[f.destino] = f.densidad; });

  const recs = rutas.filter(rt => rt.lat != null).map(rt => {
    let base;
    if (esInterregional(rt.clasificRuta)) {
      base = clusterDeComuna({ clasif: rt.clasificRuta });
    } else {
      const { eje, alias } = ejeDe(azimut(centro.lat, centro.lon, rt.lat, rt.lon), carta);
      base = clusterDeComuna({ clasif: rt.clasificRuta, densidad: densPrev[rt.destino] || null, eje, alias });
    }
    return {
      centro: String(centroSel), codigo_origen: (centro.nombre||'').slice(0,8),
      destino: rt.destino, tipo_destino: rt.tipo, comuna_padre: rt.comuna || rt.destino,
      clasificacion: rt.clasificRuta, region_destino: rt.region,
      densidad: esInterregional(rt.clasificRuta) ? null : (densPrev[rt.destino] || null),
      ...base,
    };
  });

  const { data, error: rpcErr } = await supabase.rpc('fn_upsert_cluster', { p_rows: recs });
  if (rpcErr) { showAlert('Error en recalculo: '+rpcErr.message); return; }
  showAlert(`Recalculo aplicado: ${data} rutas sincronizadas.`);
  await cargarFilas();
  render(document.getElementById('stage-area'));
}

// Guardar densidad de una COMUNA -> recomputa cluster y persiste (cascada a sectores via trigger)
async function guardarDensidadComuna(fila, nuevaDens) {
  const carta = EJES_POR_CENTRO[centroSel] || EJES_DEFAULT;
  const eje = fila.eje_vial, alias = fila.descripcion_eje;
  const base = clusterDeComuna({ clasif: fila.clasificacion, densidad: nuevaDens || null, eje, alias });
  const patch = { densidad: nuevaDens || null, ...base, editado_manual: true, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('cluster_rutas').update(patch).eq('id', fila.id);
  if (error) { showAlert('Error guardando: '+error.message); return; }
  showAlert(`Cluster de ${fila.destino} = ${base.cluster}. Sectores arrastrados.`);
  await cargarFilas();
  render(document.getElementById('stage-area'));
}

// ==========================================================================
// Render
// ==========================================================================
function badge(txt, color) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}55">${txt}</span>`;
}
function colorCluster(cl) {
  if (!cl) return '#6b7280';
  if (cl.startsWith('SPOT_INTER')) return '#7c3aed';
  if (cl.startsWith('SPOT')) return '#b45309';
  if (cl.endsWith('-C1')) return '#b5000b';
  if (cl.endsWith('-C2')) return '#ea580c';
  if (cl.endsWith('-C3')) return '#0891b2';
  if (cl.endsWith('-C4')) return '#4b5563';
  return '#6b7280';
}

export async function renderClusterRutasView(stage) {
  stage.innerHTML = `<div class="p-lg text-secondary">Cargando Cluster Operativo…</div>`;
  if (!CENTROS.length) await cargarCentros();
  if (!CENTROS.find(c => String(c.id) === String(centroSel))) centroSel = String((CENTROS[0]||{}).id || '1100');
  await cargarFilas();
  render(stage);
}

function render(stage) {
  if (!stage) return;
  const optsCentro = CENTROS.map(c =>
    `<option value="${c.id}" ${String(c.id)===String(centroSel)?'selected':''}>${c.id} — ${c.nombre||''}</option>`).join('');

  // Agrupar por comuna_padre; comuna primero, luego sus sectores
  const grupos = {};
  filas.forEach(f => { (grupos[f.comuna_padre] = grupos[f.comuna_padre] || []).push(f); });
  const claves = Object.keys(grupos).sort();

  let rows = '';
  claves.forEach(cp => {
    const items = grupos[cp].sort((a,b) => (a.tipo_destino>b.tipo_destino?1:-1)); // Comuna antes que Sector
    items.forEach(f => {
      const esComuna = String(f.tipo_destino).toLowerCase() === 'comuna';
      const esInter  = esInterregional(f.clasificacion);
      const densSel = esComuna && !esInter
        ? `<select data-id="${f.id}" class="cl-dens border border-outline-variant rounded px-xs py-[2px] text-xs">
             <option value="" ${!f.densidad?'selected':''}>—</option>
             ${DENS_OPTS.map(d=>`<option value="${d}" ${f.densidad===d?'selected':''}>${d}</option>`).join('')}
           </select>`
        : `<span class="text-xs text-secondary">${f.densidad||'—'}</span>`;
      rows += `
        <tr style="border-bottom:1px solid #eee;${esComuna?'':'background:#fafafa'}">
          <td class="px-sm py-xs text-xs">${esComuna?'':'&nbsp;&nbsp;↳ '}${f.destino}</td>
          <td class="px-sm py-xs">${badge(f.tipo_destino, esComuna?'#0891b2':'#6b7280')}</td>
          <td class="px-sm py-xs text-xs">${f.comuna_padre}</td>
          <td class="px-sm py-xs text-xs">${f.eje_vial} <span class="text-secondary">(${f.descripcion_eje||''})</span></td>
          <td class="px-sm py-xs">${densSel}</td>
          <td class="px-sm py-xs">${badge(f.cluster, colorCluster(f.cluster))}</td>
          <td class="px-sm py-xs text-xs">${f.frecuencia||''}</td>
          <td class="px-sm py-xs text-xs">${f.tipo_flota||''}</td>
          <td class="px-sm py-xs">${f.editado_manual?badge('manual','#16a34a'):''}</td>
        </tr>`;
    });
  });

  stage.innerHTML = `
    <div class="flex items-center justify-between mb-md flex-wrap gap-sm">
      <div>
        <h3 class="font-bold text-headline-sm">Cluster Operativo</h3>
        <p class="text-xs text-secondary">Asignacion definitiva del cluster por ruta. Cluster homologable (NORTE/SUR/ESTE…). Los sectores heredan de su comuna.</p>
      </div>
      <div class="flex items-center gap-sm">
        <label class="text-xs font-bold text-secondary">Centro</label>
        <select id="cl-centro" class="border border-outline-variant rounded px-sm py-xs text-sm">${optsCentro}</select>
        <button id="cl-recalc" class="bg-primary hover:bg-[#930007] text-white rounded px-md py-xs text-sm font-bold flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px]">sync</span> Recalcular desde Rutas
        </button>
      </div>
    </div>

    <div class="bg-white rounded-lg border border-surface-variant overflow-x-auto">
      <table class="w-full text-left" style="border-collapse:collapse">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:2px solid #eee">
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Destino</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Tipo</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Comuna Padre</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Eje Vial</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Densidad</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Cluster</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Frecuencia</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase">Flota</th>
            <th class="px-sm py-xs text-xs font-bold text-secondary uppercase"></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="9" class="px-md py-lg text-center text-secondary text-sm">Sin rutas. Presiona “Recalcular desde Rutas”.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="text-[11px] text-secondary mt-sm">Editar la <b>Densidad</b> de una comuna recomputa su cluster y <b>arrastra automaticamente sus sectores</b>. Interregionales quedan en SPOT. El recalculo respeta las filas marcadas <b>manual</b>.</p>
  `;

  document.getElementById('cl-centro').addEventListener('change', async (e) => {
    centroSel = e.target.value; await cargarFilas(); render(stage);
  });
  document.getElementById('cl-recalc').addEventListener('click', recalcularDesdeRutas);
  stage.querySelectorAll('.cl-dens').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const fila = filas.find(f => String(f.id) === e.target.getAttribute('data-id'));
      if (fila) guardarDensidadComuna(fila, e.target.value);
    });
  });
}
