import{getDatabase as C,saveDatabase as y,getOrigenGroups as A}from"./data.js?v=6ce8cb5f60";import{showAlert as h,escapeHtml as m}from"./utils.js";import{confirmar as T}from"./confirmar.js?v=84d7f13f40";const j=["5","10","15","28"];function D(){return"tr_"+Date.now()+"_"+Math.random().toString(36).slice(2,7)}function g(a){return(a.troncales||[]).map(n=>({...n,camiones:n.camiones||[],rutasCobertura:n.rutasCobertura||[]}))}function N(a){const n=C();let d=g(n),c="";function i(){const r=A(n),u=d.filter(e=>{if(!c)return!0;const l=c.toLowerCase();return(e.razonSocial||"").toLowerCase().includes(l)||(e.rut||"").toLowerCase().includes(l)}),t=u.length,v=u.filter(e=>e.activo!==!1).length,s=u.reduce((e,l)=>e+(l.camiones||[]).length,0),p=u.reduce((e,l)=>e+(l.camiones||[]).reduce((b,o)=>b+Number(o.capacidad||0),0),0);a.innerHTML=`
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary">sync_alt</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Camiones Troncales</h2>
          </div>
          <div class="flex items-center gap-sm">
            <input id="tr-filtro" type="text" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48 rounded" placeholder="Buscar..." value="${m(c)}">
            <button id="tr-nuevo" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
              <span class="material-symbols-outlined text-[18px]">add</span> Nuevo Troncal
            </button>
          </div>
        </div>

        <!-- Tarjetas de Estadísticas KPI -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Troncales</h4>
              <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${t}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-secondary">sync_alt</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Activos</h4>
              <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${v}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded border-l-4 border-primary flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Camiones</h4>
              <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${s}</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-primary">local_shipping</span>
          </div>
          <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
            <div>
              <h4 class="font-label-caps text-label-caps text-secondary uppercase">Capacidad Flota</h4>
              <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${p} Ton</div>
            </div>
            <span class="material-symbols-outlined text-[32px] text-red-500">analytics</span>
          </div>
        </div>

        <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
          <table class="w-full zebra-table border-collapse">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Razón Social</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">RUT</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Rutas de Cobertura</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Flota</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Activo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${u.length===0?'<tr><td colspan="6" class="p-md text-center text-secondary">No hay camiones troncales registrados.</td></tr>':u.map(e=>{const l=e.rutasCobertura.map(o=>`${o.origen} → ${o.destino}`).join(", ")||"—",b=e.camiones.map(o=>`${o.patente} (${o.capacidad}T)`).join(", ")||"—";return`<tr class="border-b border-outline-variant">
                    <td class="p-md font-bold">${m(e.razonSocial||"")}</td>
                    <td class="p-md">${m(e.rut||"")}</td>
                    <td class="p-md text-[12px]">${m(l)}</td>
                    <td class="p-md text-[12px]">${m(b)}</td>
                    <td class="p-md text-center">${e.activo!==!1?'<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">SÍ</span>':'<span class="inline-flex items-center px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]">NO</span>'}</td>
                    <td class="p-md text-center">
                      <button class="tr-editar text-secondary hover:text-primary" data-id="${e.id}" title="Editar">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button class="tr-eliminar text-secondary hover:text-primary ml-sm" data-id="${e.id}" title="Eliminar">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>`}).join("")}
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-secondary mt-sm">${u.length} registro(s)</p>
      </div>
    `,document.getElementById("tr-filtro").addEventListener("input",e=>{c=e.target.value,i()}),document.getElementById("tr-nuevo").addEventListener("click",()=>L(null,r,n,i)),a.querySelectorAll(".tr-editar").forEach(e=>{e.addEventListener("click",()=>{const l=d.find(b=>b.id===e.dataset.id);l&&abrirModal(l,r,n,i)})}),a.querySelectorAll(".tr-eliminar").forEach(e=>{e.addEventListener("click",async()=>{await T("¿Eliminar este troncal?")&&(n.troncales=(n.troncales||[]).filter(l=>l.id!==e.dataset.id),y(n),d=g(n),i())})})}i()}function q(a){a.classList.remove("active"),setTimeout(()=>a.remove(),300)}function L(a,n,d,c){const i=!a,r=a||{id:D(),razonSocial:"",rut:"",activo:!0,camiones:[],rutasCobertura:[]},u=n.map(s=>({value:s.grupo,label:s.nombre})),t=document.createElement("div");t.className="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300",t.innerHTML=`
    <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
      <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">sync_alt</span>
          ${i?"Nuevo Troncal":"Editar Troncal"}
        </h4>
        <button class="text-secondary hover:text-primary cursor-pointer" id="t-cerrar">
          <span class="material-symbols-outlined text-[24px]">close</span>
        </button>
      </div>
      <div class="p-lg space-y-md max-h-[70vh] overflow-y-auto">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
          <div class="space-y-xs">
            <label for="t-razon" class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
            <input id="t-razon" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Ej. Transportes Troncal Express" value="${m(r.razonSocial||"")}">
          </div>
          <div class="space-y-xs">
            <label for="t-rut" class="font-label-caps text-label-caps text-secondary block">RUT</label>
            <input id="t-rut" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" placeholder="Ej: 76.849.201-3" value="${m(r.rut||"")}">
          </div>
        </div>

        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">RUTAS DE COBERTURA (origen → destino entre centros)</label>
          <div id="t-rutas-container" class="space-y-sm">
            ${r.rutasCobertura.length===0?'<p class="text-[12px] text-secondary">Sin rutas asignadas.</p>':r.rutasCobertura.map((s,p)=>w(s,p,u)).join("")}
          </div>
          <button id="t-add-ruta" class="text-primary text-[12px] font-bold flex items-center gap-xs mt-sm cursor-pointer hover:underline">
            <span class="material-symbols-outlined text-[16px]">add_circle</span> Agregar Ruta
          </button>
        </div>

        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">FLOTA DE CAMIONES</label>
          <div id="t-camiones-container" class="space-y-sm">
            ${r.camiones.length===0?'<p class="text-[12px] text-secondary">Sin camiones registrados.</p>':r.camiones.map((s,p)=>E(s,p)).join("")}
          </div>
          <button id="t-add-camion" class="text-primary text-[12px] font-bold flex items-center gap-xs mt-sm cursor-pointer hover:underline">
            <span class="material-symbols-outlined text-[16px]">add_circle</span> Agregar Camión
          </button>
        </div>

        <div class="flex items-center gap-sm">
          <input type="checkbox" id="t-activo" ${r.activo!==!1?"checked":""} class="w-4 h-4 text-primary border-outline-variant rounded focus:ring-primary">
          <label for="t-activo" class="font-body-md text-body-md">Activo</label>
        </div>
      </div>
      <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
        <button id="t-cancel" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
        <button id="t-save" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase shadow">${i?"Crear Troncal":"Guardar Cambios"}</button>
      </div>
    </div>`,document.body.appendChild(t),requestAnimationFrame(()=>t.classList.add("active"));const v=()=>q(t);t.querySelector("#t-cerrar").addEventListener("click",v),t.querySelector("#t-cancel").addEventListener("click",v),t.addEventListener("click",s=>{s.target===t&&v()}),t.querySelector("#t-add-ruta").addEventListener("click",()=>{const s=t.querySelector("#t-rutas-container"),p=s.querySelectorAll(".ruta-row").length;s.insertAdjacentHTML("beforeend",w({origen:"",destino:""},p,u))}),t.querySelector("#t-add-camion").addEventListener("click",()=>{const s=t.querySelector("#t-camiones-container"),p=s.querySelectorAll(".camion-row").length;s.insertAdjacentHTML("beforeend",E({patente:"",modelo:"",capacidad:"28",ejes:3},p))}),t.querySelector("#t-save").addEventListener("click",()=>{const s=t.querySelector("#t-razon").value.trim(),p=t.querySelector("#t-rut").value.trim();if(!s)return h("La Razón Social es obligatoria.","error");const e=[];t.querySelectorAll(".ruta-row").forEach(o=>{const x=o.querySelector(".ruta-origen").value,f=o.querySelector(".ruta-destino").value;x&&f&&e.push({origen:x,destino:f})});const l=[];t.querySelectorAll(".camion-row").forEach(o=>{const x=o.querySelector(".cam-patente").value.trim(),f=o.querySelector(".cam-modelo").value.trim(),$=Number(o.querySelector(".cam-capacidad").value)||28,S=Number(o.querySelector(".cam-ejes").value)||3;x&&l.push({patente:x,modelo:f,capacidad:$,ejes:S})});const b={id:r.id,razonSocial:s,rut:p,activo:t.querySelector("#t-activo").checked,rutasCobertura:e,camiones:l};if(i)d.troncales=d.troncales||[],d.troncales.push(b);else{const o=(d.troncales||[]).findIndex(x=>x.id===r.id);o!==-1&&(d.troncales[o]=b)}y(d),v(),h(i?"Troncal creado.":"Troncal actualizado."),c()})}function w(a,n,d){const c=d.map(r=>`<option value="${r.value}" ${a.origen===r.value?"selected":""}>${r.label}</option>`).join(""),i=d.map(r=>`<option value="${r.value}" ${a.destino===r.value?"selected":""}>${r.label}</option>`).join("");return`<div class="ruta-row flex gap-sm items-center">
    <select class="ruta-origen border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all">${c}</select>
    <span class="text-secondary">→</span>
    <select class="ruta-destino border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all">${i}</select>
    <button type="button" class="ruta-remove text-red-600 hover:text-red-800 cursor-pointer" title="Eliminar ruta">
      <span class="material-symbols-outlined text-[18px]">remove_circle</span>
    </button>
  </div>`}function E(a,n){const d=j.map(c=>`<option value="${c}" ${String(a.capacidad)===c?"selected":""}>${c} Ton</option>`).join("");return`<div class="camion-row flex gap-sm items-center">
    <input type="text" class="cam-patente border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-28 focus:border-primary focus:ring-0 transition-all" placeholder="Patente" value="${m(a.patente||"")}">
    <input type="text" class="cam-modelo border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-40 focus:border-primary focus:ring-0 transition-all" placeholder="Modelo" value="${m(a.modelo||"")}">
    <select class="cam-capacidad border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-28 focus:border-primary focus:ring-0 transition-all">${d}</select>
    <select class="cam-ejes border border-[#CED4DA] p-sm font-body-md text-body-md bg-white rounded w-24 focus:border-primary focus:ring-0 transition-all">
      <option value="2" ${a.ejes===2?"selected":""}>2 Ejes</option>
      <option value="3" ${a.ejes===3?"selected":""}>3 Ejes</option>
    </select>
    <button type="button" class="camion-remove text-red-600 hover:text-red-800 cursor-pointer" title="Eliminar camión">
      <span class="material-symbols-outlined text-[18px]">remove_circle</span>
    </button>
  </div>`}export{L as abrirModalTroncal,N as renderTroncalesView};
