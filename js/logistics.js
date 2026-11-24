import{getDatabase as C,saveDatabase as A,deleteRow as _}from"./data.js?v=99b844b255";import{showAlert as y,geocodeAddress as q,escapeHtml as H,toCSV as U,downloadFile as F}from"./utils.js";import{GRUPOS_ORIGEN as M}from"./chile-geo.js";import{confirmar as V}from"./confirmar.js?v=84d7f13f40";let B="";function T(x){const b=C().logisticsCentres;x.innerHTML=`
    <p class="font-body-md text-body-md text-secondary mb-md">Administre los centros de distribución (CD) y puntos de salida. Seleccione un centro para geolocalizarlo en el mapa interactivo.</p>

    <div class="flex flex-wrap items-center gap-sm mb-md">
      <div class="relative flex-1 min-w-[220px]">
        <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary text-[20px]">search</span>
        <input type="text" id="cd-search" placeholder="Buscar por nombre, dirección, código SAP u origen..." class="w-full pl-xl pr-sm py-sm border border-outline-variant rounded font-body-md text-body-md focus:border-primary focus:ring-0 transition-all">
      </div>
      <button id="btn-export-cds-csv" class="border border-outline-variant hover:border-primary hover:text-primary text-secondary font-bold px-md py-sm rounded cursor-pointer text-xs uppercase tracking-wider flex items-center gap-sm transition-all">
        <span class="material-symbols-outlined text-[18px]">download</span>
        Exportar CSV
      </button>
      <button id="btn-create-cd" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
        <span class="material-symbols-outlined text-[18px]">add</span>
        Registrar Centro SAP
      </button>
    </div>

    <!-- Layout Side-by-Side: Tarjetas a la izquierda, Mapa a la derecha -->
    <div class="grid grid-cols-12 gap-lg">
      <!-- Columna Izquierda: Listado de Centros -->
      <div class="col-span-12 lg:col-span-6 flex flex-col gap-md max-h-[550px] overflow-y-auto pr-xs" id="cd-cards-container">
        <!-- Tarjetas cargadas dinámicamente -->
      </div>

      <!-- Columna Derecha: Mapa Leaflet -->
      <div class="col-span-12 lg:col-span-6">
        <div id="logistics-map" class="h-[550px] rounded-xl border border-outline-variant shadow-md overflow-hidden relative" style="z-index: 1;">
          <!-- Cargador de Mapa -->
        </div>
      </div>
    </div>

    <!-- Modal Formulario Centro Logístico -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="cd-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Nuevo Centro Logístico (CD)</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-cd-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="cd-form">
          <div class="p-lg space-y-md">
            <div class="space-y-xs">
              <label for="cd-nombre" class="font-label-caps text-label-caps text-secondary block">NOMBRE DE PLANTA / CENTRO</label>
              <input type="text" id="cd-nombre" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: CD Santiago Sur">
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="cd-sap" class="font-label-caps text-label-caps text-secondary block">ID CENTRO SAP</label>
                <input type="text" id="cd-sap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white disabled:bg-surface-container-low disabled:text-secondary" required placeholder="Ej: 1003">
                <p class="text-[10px] text-secondary" id="cd-sap-hint"></p>
              </div>
              <div class="space-y-xs">
                <label for="cd-comuna" class="font-label-caps text-label-caps text-secondary block">REGIÓN/COMUNA</label>
                <input type="text" id="cd-comuna" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: San Bernardo, Metropolitana">
              </div>
            </div>

            <div class="space-y-xs">
              <label for="cd-direccion" class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN GEOGRÁFICA (CALLE Y NÚMERO)</label>
              <input type="text" id="cd-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: Av. Las Industrias 890">
            </div>

            <div class="space-y-xs" id="cd-map-adjust-wrap" style="display:none;">
              <label class="font-label-caps text-label-caps text-secondary block">UBICACIÓN EN EL MAPA (arrastre el pin para ajustar)</label>
              <p class="text-[11px] mb-1" id="cd-geo-status"></p>
              <div id="cd-map-adjust" class="rounded border border-outline-variant" style="height: 220px; z-index:1;"></div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-cd-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer" id="btn-submit-cd">Geolocalizar y Registrar</button>
          </div>
        </form>
      </div>
    </div>
  `;let p=null,l=null,m=null,o=null;const a=e=>{p=null,l=null,m&&(m.remove(),m=null),o=null,document.getElementById("cd-map-adjust-wrap").style.display="none",document.getElementById("cd-geo-status").textContent="";const t=document.getElementById("btn-submit-cd");t.disabled=!1,t.innerText=e},r=e=>{const t=document.getElementById("cd-map-adjust-wrap"),i=document.getElementById("cd-geo-status");t.style.display="",i.textContent=e.found?`Ubicación encontrada: ${e.displayName}`:`⚠ ${e.displayName}`,i.className=`text-[11px] mb-1 ${e.found?"text-secondary":"text-red-700 font-bold"}`,m&&(m.remove(),m=null),m=L.map("cd-map-adjust").setView([e.lat,e.lon],e.found?15:11),L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(m),o=L.marker([e.lat,e.lon],{draggable:!0}).addTo(m).bindTooltip("Arrastre para ajustar la ubicación exacta",{permanent:!1}),setTimeout(()=>m.invalidateSize(),150)},d=document.getElementById("cd-search");d.value=B;const n=()=>{const e=B.toLowerCase(),t=e?b.filter(i=>(i.nombre||"").toLowerCase().includes(e)||(i.direccion||"").toLowerCase().includes(e)||(i.id||"").toLowerCase().includes(e)||(i.origen_grupo||"").toLowerCase().includes(e)):b;return Z(t,x,a),t};d.addEventListener("input",e=>{B=e.target.value,n()}),document.getElementById("btn-export-cds-csv").addEventListener("click",()=>{if(b.length===0){y("No hay centros logísticos para exportar.","error");return}const e=["ID Centro SAP","Nombre","Dirección","Origen","Latitud","Longitud"],t=b.map(c=>[c.id||"",c.nombre||"",c.direccion||"",c.origen_grupo||"",c.lat||"",c.lon||""]),i=U(e,t);F(`centros_logisticos_${new Date().toISOString().slice(0,10)}.csv`,i)}),n();let u,g=[];try{u=L.map("logistics-map").setView([-34.5,-71.5],6),L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(u);const e=[];b.forEach((t,i)=>{if(t.lat&&t.lon){const c=L.marker([t.lat,t.lon]).addTo(u).bindPopup(`
            <div class="text-on-surface font-body-md" style="font-family: 'Hanken Grotesk', sans-serif;">
              <strong class="text-primary font-bold text-sm">${t.nombre}</strong><br>
              <span class="text-xs text-secondary">${t.direccion}</span><br>
              <span class="text-[10px] font-bold text-primary block mt-1">Código SAP: ${t.id}</span>
            </div>
          `);g.push(c),e.push([t.lat,t.lon]);const f=document.getElementById(`cd-card-${t.id}`);f&&f.addEventListener("click",()=>{document.querySelectorAll(".cd-card").forEach(I=>I.classList.remove("border-primary","bg-primary-container/[0.02]")),f.classList.add("border-primary","bg-primary-container/[0.02]"),u.flyTo([t.lat,t.lon],14,{duration:1.5}),c.openPopup()})}}),e.length>0&&u.fitBounds(e,{padding:[50,50]})}catch(e){console.error("Error al cargar Leaflet:",e),document.getElementById("logistics-map").innerHTML=`
      <div class="flex justify-center items-center h-full text-secondary font-body-md bg-surface-container-low border border-outline-variant">
        Error al cargar los servicios de mapa interactivo.
      </div>
    `}const s=document.getElementById("cd-modal"),E=document.getElementById("btn-create-cd"),z=document.getElementById("btn-close-cd-modal"),P=document.getElementById("btn-cancel-cd-modal"),D=document.getElementById("cd-form");E.addEventListener("click",()=>{D.reset(),window.__editingCdId=null,document.querySelector("#cd-modal h4").textContent="Nuevo Centro Logístico (CD)";const e=document.getElementById("cd-sap");e.value="",e.disabled=!1,document.getElementById("cd-sap-hint").textContent="Ingrese el código de centro SAP (será el identificador único del centro).",a("Geolocalizar y Registrar"),s.classList.remove("pointer-events-none","opacity-0"),s.querySelector(".modal-window").classList.remove("scale-95")});const w=()=>{s.classList.add("pointer-events-none","opacity-0"),s.querySelector(".modal-window").classList.add("scale-95"),a("Geolocalizar y Registrar")};z.addEventListener("click",w),P.addEventListener("click",w),D.addEventListener("submit",async e=>{e.preventDefault();const t=C(),i=document.getElementById("btn-submit-cd"),c=window.__editingCdId||null;if(p&&l){const v=o?o.getLatLng():p,{nombre:j,direccionCompleta:N}=l;if(c){const h=t.logisticsCentres.findIndex(O=>O.id===c);h!==-1&&(t.logisticsCentres[h]={...t.logisticsCentres[h],nombre:j,direccion:N,lat:v.lat,lon:v.lng},A(t),y("Centro Logístico actualizado con éxito."))}else{const h={id:l.sapId,nombre:j,direccion:N,lat:v.lat,lon:v.lng};t.logisticsCentres.push(h),A(t),y("Centro Logístico geolocalizado y registrado con éxito.")}window.__editingCdId=null,a("Geolocalizar y Registrar"),w(),T(x);return}const f=document.getElementById("cd-sap").value.toUpperCase().replace(/\s+/g,"");if(!c&&t.logisticsCentres.some(v=>v.id===f)){y("El ID de Centro SAP ya está registrado.","error");return}i.disabled=!0,i.innerText="Geolocalizando dirección...";const I=document.getElementById("cd-nombre").value,R=document.getElementById("cd-direccion").value,G=document.getElementById("cd-comuna").value,$=`${R}, ${G}`,S=await q($);p=S,l={nombre:I,direccionCompleta:$,sapId:f},r(S),i.disabled=!1,i.innerText="Confirmar Ubicación y Guardar",S.found||y("No se encontró la dirección automáticamente. Ajuste el pin en el mapa antes de confirmar.","error")})}function Z(x,k,b){const p=document.getElementById("cd-cards-container");if(!p)return;if(x.length===0){p.innerHTML=`
      <div class="text-center text-secondary p-xl bg-surface border border-outline-variant rounded">
        No hay centros logísticos registrados.
      </div>
    `;return}p.innerHTML="";const l={};x.forEach(o=>{const a=o.origen_grupo||"Sin Origen";l[a]||(l[a]=[]),l[a].push(o)}),[...M.filter(o=>l[o]),...Object.keys(l).filter(o=>!M.includes(o))].forEach(o=>{const a=document.createElement("div");a.className="flex items-center gap-sm mt-sm mb-1 first:mt-0",a.innerHTML=`
      <span class="material-symbols-outlined text-primary text-[18px]">flag</span>
      <h4 class="font-label-caps text-label-caps text-secondary uppercase tracking-wider">${H(o)}</h4>
      <span class="text-[10px] text-secondary bg-surface-container-high rounded-full px-sm py-0.5">${l[o].length}</span>
      <div class="flex-1 border-t border-outline-variant"></div>
    `,p.appendChild(a),l[o].forEach(r=>{const d=document.createElement("div");d.className="cd-card bg-surface border border-outline-variant rounded p-md shadow-sm transition-all flex flex-col justify-between hover:border-primary relative",d.id=`cd-card-${r.id}`,d.style.cursor="pointer";const n=r.lat&&r.lon&&(r.lat!==-33.4489||r.lon!==-70.6693);d.innerHTML=`
      <div class="flex items-start justify-between gap-md">
        <div>
          <h4 class="font-headline-sm text-[16px] font-bold text-on-surface mb-xs">${r.nombre}</h4>
          <div class="flex items-start gap-xs text-xs text-secondary leading-tight">
            <span class="material-symbols-outlined text-[16px] text-primary mt-0.5">location_on</span>
            <span>${r.direccion}</span>
          </div>
        </div>
        <!-- Código SAP destacado -->
        <div class="text-center bg-primary/5 border-2 border-primary/30 rounded-lg px-md py-sm flex-shrink-0">
          <p class="text-[9px] font-bold tracking-widest text-secondary uppercase">Código SAP</p>
          <p class="font-data-mono font-extrabold text-primary" style="font-size:26px;line-height:1.1;letter-spacing:0.04em">${r.id}</p>
        </div>
      </div>

      <div class="flex justify-between items-center text-[10px] text-secondary border-t border-outline-variant pt-sm mt-md">
        <span class="flex items-center gap-xs">
          <span class="w-1.5 h-1.5 rounded-full ${n?"bg-green-600":"bg-amber-600"}"></span>
          ${n?"GPS exacto":"Coordenadas estimadas"}
        </span>
        <div class="flex items-center gap-xs">
          <button class="btn-edit-cd flex items-center gap-1 border border-outline-variant hover:border-primary hover:text-primary text-secondary px-sm py-1 rounded cursor-pointer text-[11px] font-bold" data-id="${r.id}" title="Editar centro">
            <span class="material-symbols-outlined text-[14px]">edit</span> Editar
          </button>
          <button class="btn-delete-cd flex items-center gap-1 border border-red-200 hover:bg-red-50 text-red-700 px-sm py-1 rounded cursor-pointer text-[11px] font-bold" data-id="${r.id}" title="Eliminar centro">
            <span class="material-symbols-outlined text-[14px]">delete</span> Eliminar
          </button>
        </div>
      </div>
    `,p.appendChild(d)})}),p.querySelectorAll(".btn-edit-cd").forEach(o=>{o.addEventListener("click",a=>{a.stopPropagation();const r=a.currentTarget.getAttribute("data-id"),n=C().logisticsCentres.find(E=>E.id===r);if(!n)return;window.__editingCdId=r,document.getElementById("cd-nombre").value=n.nombre;const u=document.getElementById("cd-sap");u.value=n.id,u.disabled=!0,document.getElementById("cd-sap-hint").textContent="El ID Centro SAP no se puede modificar una vez creado.";const g=(n.direccion||"").split(",");document.getElementById("cd-direccion").value=g[0]?g[0].trim():n.direccion,document.getElementById("cd-comuna").value=g.slice(1).join(",").trim(),document.querySelector("#cd-modal h4").textContent="Editar Centro Logístico (CD)",typeof b=="function"&&b("Geolocalizar y Guardar Cambios");const s=document.getElementById("cd-modal");s.classList.remove("pointer-events-none","opacity-0"),s.querySelector(".modal-window").classList.remove("scale-95")})}),p.querySelectorAll(".btn-delete-cd").forEach(o=>{o.addEventListener("click",async a=>{a.stopPropagation();const r=a.currentTarget.getAttribute("data-id"),d=C(),n=d.logisticsCentres.find(s=>s.id===r);if(!n)return;const u=(d.routes||[]).filter(s=>s.origenId===r);if(u.length>0){y(`No se puede eliminar: ${u.length} ruta(s) dependen de ${n.nombre}. Elimine o reasigne esas rutas primero.`,"error");return}const g=(d.transports||[]).filter(s=>(s.centrosServicio||[]).includes(r));if(g.length>0){y(`No se puede eliminar: ${g.length} transportista(s) prestan servicio en ${n.nombre}.`,"error");return}await V(`¿Eliminar definitivamente el centro "${n.nombre}" (${n.id})?`)&&(d.logisticsCentres=d.logisticsCentres.filter(s=>s.id!==r),A(d,{syncOnly:["logisticsCentres"]}),_("logisticsCentres",r).catch(s=>console.error("Error al borrar centro en Supabase:",s.message||s)),y(`Centro ${n.nombre} eliminado.`),T(k))})})}export{T as renderLogisticsView};
