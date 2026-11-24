import{supabase as f}from"./supabase-client.js?v=fd17fd7d20";import{showAlert as d}from"./utils.js";const C={1100:{NORTE:{alias:"Norte (Ruta 5 Norte)",rangos:[[310,360],[0,50]]},ESTE:{alias:"Austral-Costa (Cordillera oriental)",rangos:[[50,160]]},SUR:{alias:"Sur-Isla (Insular / Canales)",rangos:[[160,310]]}}},v={NORTE:{alias:"Norte",rangos:[[315,360],[0,45]]},ESTE:{alias:"Este",rangos:[[45,135]]},SUR:{alias:"Sur",rangos:[[135,225]]},OESTE:{alias:"Oeste",rangos:[[225,315]]}},E={C1:{frecuencia:"Diaria (Fija)",flota:"Flota Propia"},C2:{frecuencia:"Lunes-Miercoles-Viernes (Frecuencial)",flota:"Flota Propia"},C3:{frecuencia:"Martes-Jueves (Acoplado por Arrastre)",flota:"Flota Propia (Consolida en Hub)"},C4:{frecuencia:"A Demanda / Servicio Extra",flota:"Servicio Extra (Contratado por viaje)"},SPOT_LOCAL:{frecuencia:"A Demanda (SLA 48 Hrs)",flota:"Servicio Extra (Tercerizado FTL)"},SPOT_INTERREGIONAL:{frecuencia:"A Demanda (SLA 48 Hrs)",flota:"Servicio Extra"}},$=["C1","C2","C3","C4","SPOT_LOCAL"];let p=[],l="1100",m=[];function O(e,r,n,i){const o=Math.PI/180,a=e*o,c=n*o,s=(i-r)*o,t=Math.sin(s)*Math.cos(c),u=Math.cos(a)*Math.sin(c)-Math.sin(a)*Math.cos(c)*Math.cos(s);return(Math.atan2(t,u)/o+360)%360}function R(e,r){for(const[n,i]of Object.entries(r))for(const[o,a]of i.rangos)if(e>=o&&e<a)return{eje:n,alias:i.alias};return{eje:"SIN-EJE",alias:"Sin eje"}}function g(e){return String(e||"").trim().toLowerCase().startsWith("interreg")}function S({clasif:e,densidad:r,eje:n,alias:i}){if(g(e)){const a=E.SPOT_INTERREGIONAL;return{eje_vial:"INTERREGIONAL",descripcion_eje:"Interregional (SLA 48h)",cluster:"SPOT_INTERREGIONAL",frecuencia:a.frecuencia,tipo_flota:a.flota}}if(!r)return{eje_vial:n,descripcion_eje:i,cluster:`${n}-SD`,frecuencia:"Por asignar (falta densidad)",tipo_flota:"Por asignar"};if(r==="SPOT_LOCAL"){const a=E.SPOT_LOCAL;return{eje_vial:n,descripcion_eje:i,cluster:"SPOT_LOCAL",frecuencia:a.frecuencia,tipo_flota:a.flota}}const o=E[r];return{eje_vial:n,descripcion_eje:i,cluster:`${n}-${r}`,frecuencia:o.frecuencia,tipo_flota:o.flota}}async function T(){const{data:e,error:r}=await f.from("logistics_centres").select("id, nombre, lat, lon").order("id");if(r){console.error(r),p=[];return}p=e||[]}async function b(){const{data:e,error:r}=await f.from("cluster_rutas").select("*").eq("centro",l).order("comuna_padre").order("tipo_destino");if(r){console.error(r),d("Error cargando cluster: "+r.message),m=[];return}m=e||[]}async function L(){const e=p.find(t=>String(t.id)===String(l));if(!e||e.lat==null){d("El centro no tiene coordenadas.");return}const r=C[l]||v,{data:n,error:i}=await f.from("routes").select("destino, comuna, region, tipo, clasificRuta, lat, lon").eq("origenId",l);if(i){d("Error leyendo rutas: "+i.message);return}if(!n||!n.length){d("El centro no tiene rutas cargadas.");return}const o={};m.forEach(t=>{o[t.destino]=t.densidad});const a=n.filter(t=>t.lat!=null).map(t=>{let u;if(g(t.clasificRuta))u=S({clasif:t.clasificRuta});else{const{eje:h,alias:x}=R(O(e.lat,e.lon,t.lat,t.lon),r);u=S({clasif:t.clasificRuta,densidad:o[t.destino]||null,eje:h,alias:x})}return{centro:String(l),codigo_origen:(e.nombre||"").slice(0,8),destino:t.destino,tipo_destino:t.tipo,comuna_padre:t.comuna||t.destino,clasificacion:t.clasificRuta,region_destino:t.region,densidad:g(t.clasificRuta)?null:o[t.destino]||null,...u}}),{data:c,error:s}=await f.rpc("fn_upsert_cluster",{p_rows:a});if(s){d("Error en recalculo: "+s.message);return}d(`Recalculo aplicado: ${c} rutas sincronizadas.`),await b(),y(document.getElementById("stage-area"))}async function w(e,r){const n=C[l]||v,i=e.eje_vial,o=e.descripcion_eje,a=S({clasif:e.clasificacion,densidad:r||null,eje:i,alias:o}),c={densidad:r||null,...a,editado_manual:!0,updated_at:new Date().toISOString()},{error:s}=await f.from("cluster_rutas").update(c).eq("id",e.id);if(s){d("Error guardando: "+s.message);return}d(`Cluster de ${e.destino} = ${a.cluster}. Sectores arrastrados.`),await b(),y(document.getElementById("stage-area"))}function _(e,r){return`<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${r}22;color:${r};border:1px solid ${r}55">${e}</span>`}function A(e){return e?e.startsWith("SPOT_INTER")?"#7c3aed":e.startsWith("SPOT")?"#b45309":e.endsWith("-C1")?"#b5000b":e.endsWith("-C2")?"#ea580c":e.endsWith("-C3")?"#0891b2":e.endsWith("-C4")?"#4b5563":"#6b7280":"#6b7280"}async function P(e){e.innerHTML='<div class="p-lg text-secondary">Cargando Cluster Operativo…</div>',p.length||await T(),p.find(r=>String(r.id)===String(l))||(l=String((p[0]||{}).id||"1100")),await b(),y(e)}function y(e){if(!e)return;const r=p.map(a=>`<option value="${a.id}" ${String(a.id)===String(l)?"selected":""}>${a.id} — ${a.nombre||""}</option>`).join(""),n={};m.forEach(a=>{(n[a.comuna_padre]=n[a.comuna_padre]||[]).push(a)});const i=Object.keys(n).sort();let o="";i.forEach(a=>{n[a].sort((s,t)=>s.tipo_destino>t.tipo_destino?1:-1).forEach(s=>{const t=String(s.tipo_destino).toLowerCase()==="comuna",u=g(s.clasificacion),h=t&&!u?`<select data-id="${s.id}" class="cl-dens border border-outline-variant rounded px-xs py-[2px] text-xs">
             <option value="" ${s.densidad?"":"selected"}>—</option>
             ${$.map(x=>`<option value="${x}" ${s.densidad===x?"selected":""}>${x}</option>`).join("")}
           </select>`:`<span class="text-xs text-secondary">${s.densidad||"—"}</span>`;o+=`
        <tr style="border-bottom:1px solid #eee;${t?"":"background:#fafafa"}">
          <td class="px-sm py-xs text-xs">${t?"":"&nbsp;&nbsp;↳ "}${s.destino}</td>
          <td class="px-sm py-xs">${_(s.tipo_destino,t?"#0891b2":"#6b7280")}</td>
          <td class="px-sm py-xs text-xs">${s.comuna_padre}</td>
          <td class="px-sm py-xs text-xs">${s.eje_vial} <span class="text-secondary">(${s.descripcion_eje||""})</span></td>
          <td class="px-sm py-xs">${h}</td>
          <td class="px-sm py-xs">${_(s.cluster,A(s.cluster))}</td>
          <td class="px-sm py-xs text-xs">${s.frecuencia||""}</td>
          <td class="px-sm py-xs text-xs">${s.tipo_flota||""}</td>
          <td class="px-sm py-xs">${s.editado_manual?_("manual","#16a34a"):""}</td>
        </tr>`})}),e.innerHTML=`
    <div class="flex items-center justify-between mb-md flex-wrap gap-sm">
      <div>
        <h3 class="font-bold text-headline-sm">Cluster Operativo</h3>
        <p class="text-xs text-secondary">Asignacion definitiva del cluster por ruta. Cluster homologable (NORTE/SUR/ESTE…). Los sectores heredan de su comuna.</p>
      </div>
      <div class="flex items-center gap-sm">
        <label class="text-xs font-bold text-secondary">Centro</label>
        <select id="cl-centro" class="border border-outline-variant rounded px-sm py-xs text-sm">${r}</select>
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
        <tbody>${o||'<tr><td colspan="9" class="px-md py-lg text-center text-secondary text-sm">Sin rutas. Presiona “Recalcular desde Rutas”.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="text-[11px] text-secondary mt-sm">Editar la <b>Densidad</b> de una comuna recomputa su cluster y <b>arrastra automaticamente sus sectores</b>. Interregionales quedan en SPOT. El recalculo respeta las filas marcadas <b>manual</b>.</p>
  `,document.getElementById("cl-centro").addEventListener("change",async a=>{l=a.target.value,await b(),y(e)}),document.getElementById("cl-recalc").addEventListener("click",L),e.querySelectorAll(".cl-dens").forEach(a=>{a.addEventListener("change",c=>{const s=m.find(t=>String(t.id)===c.target.getAttribute("data-id"));s&&w(s,c.target.value)})})}export{P as renderClusterRutasView};
