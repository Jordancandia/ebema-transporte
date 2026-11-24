import{getDatabase as L,saveDatabase as $,deleteRow as ve}from"./data.js?v=99b844b255";import{parseCSV as xe,showAlert as b,escapeHtml as i,toCSV as ye,downloadFile as he}from"./utils.js";import{REGIONES as Y,COMUNAS_POR_REGION as ie,TIPOS_ZONA as le,findRegionByComuna as ce}from"./chile-geo.js";import{confirmar as Ee}from"./confirmar.js?v=84d7f13f40";let S=null,P="",D=!1,v="";function pe(n){return n.toString().normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")}function M(n){return n.toString().normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}function C(n,...o){const e={};Object.keys(n).forEach(s=>{e[pe(s)]=n[s]});for(const s of o){const l=pe(s);if(e[l]!==void 0)return e[l]}return""}const N={"arica y parinacota":"Arica y Parinacota",tarapaca:"Tarapacá",antofagasta:"Antofagasta",atacama:"Atacama",coquimbo:"Coquimbo",valparaiso:"Valparaíso","metropolitana de santiago":"Metropolitana de Santiago",metropolitana:"Metropolitana de Santiago","libertador general bernardo ohiggins":"Libertador General Bernardo O'Higgins",ohiggins:"Libertador General Bernardo O'Higgins",maule:"Maule",nuble:"Ñuble",biobio:"Biobío","la araucania":"La Araucanía",araucania:"La Araucanía","los rios":"Los Ríos","los lagos":"Los Lagos",aysen:"Aysén","magallanes y de la antartica chilena":"Magallanes y de la Antártica Chilena","magallanes y antartica chilena":"Magallanes y de la Antártica Chilena"};function ze(n){if(!n)return"";let o=M(n);if(o=o.replace(/^region\s+(del|de)\s+/,"").replace(/^region\s+/,""),N[o])return N[o];for(const s of Object.keys(N))if(o.startsWith(s))return N[s];const e=Y.find(s=>M(s)===o);return e||n}const me={};Object.entries(ie).forEach(([n,o])=>{o.forEach(e=>{me[M(e)]={comuna:e,region:n}})});function we(n){if(!n)return{comuna:"",region:""};const o=me[M(n)];return o||{comuna:n,region:""}}function W(n){return!n.comuna||!n.region||!n.tipo}function O(n,o){n.innerHTML='<option value="">— Sin definir —</option>'+Y.map(e=>`<option value="${i(e)}" ${e===o?"selected":""}>${i(e)}</option>`).join("")}function T(n,o,e){const s=ie[o]||[];let l='<option value="">— Sin definir —</option>';e&&!s.includes(e)&&(l+=`<option value="${i(e)}" selected>${i(e)} (no estándar)</option>`),l+=s.map(p=>`<option value="${i(p)}" ${p===e?"selected":""}>${i(p)}</option>`).join(""),n.innerHTML=l}function I(n){const o=L();o.transportZones||(o.transportZones=[]);const e=o.transportZones,s=e.length,l=e.filter(t=>t.estado_erp).length,p=s-l,m=e.filter(W).length;n.innerHTML=`
    <!-- Tarjetas KPI -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Zonas</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${s}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">map</span>
      </div>
      <button type="button" id="kpi-zona-erp" class="bg-surface border ${v==="erp"?"border-green-500 ring-2 ring-green-300":"border-outline-variant"} p-md shadow-sm rounded flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas creadas en ERP">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Creadas en ERP</h4>
          <div class="font-headline-md text-headline-md font-bold text-green-700 mt-1">${l}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
      </button>
      <button type="button" id="kpi-zona-pend-erp" class="bg-surface border ${v==="pendiente"?"border-red-500 ring-2 ring-red-300":"border-outline-variant"} p-md shadow-sm rounded flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas pendientes de ERP">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Pendientes ERP</h4>
          <div class="font-headline-md text-headline-md font-bold text-red-600 mt-1">${p}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-red-500">pending</span>
      </button>
      <button type="button" id="kpi-zona-incompletas" class="bg-surface border ${D?"border-amber-500 ring-2 ring-amber-300":"border-outline-variant"} p-md shadow-sm rounded border-l-4 border-amber-400 flex items-center justify-between cursor-pointer text-left transition-all hover:shadow-md" title="Click para filtrar las zonas con datos pendientes">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Datos a Completar</h4>
          <div class="font-headline-md text-headline-md font-bold text-amber-600 mt-1">${m}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-amber-500">warning</span>
      </button>
    </div>

    <!-- Tabla -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto items-stretch md:items-center">
          <div class="relative w-full md:w-80 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="zona-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Zona, Denominación, Comuna, Región...">
          </div>
          <select id="zona-filter-region" class="w-full md:w-56 bg-surface-container-low border-none px-md py-xs font-body-md text-body-md focus:outline-none rounded">
            <option value="">Todas las regiones</option>
            ${Y.map(t=>`<option value="${i(t)}">${i(t)}</option>`).join("")}
          </select>
        </div>

        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-export-zonas-csv" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">download</span>
            Exportar CSV
          </button>
          <button id="btn-bulk-upload-zonas" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider">
            <span class="material-symbols-outlined text-[18px]">upload_file</span>
            Carga Masiva (CSV)
          </button>
          <button id="btn-create-zona" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded active:scale-[0.98] transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase tracking-wider shadow">
            <span class="material-symbols-outlined text-[18px]">add</span>
            Nueva Zona
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">País</th>
              <th class="p-md">Zona</th>
              <th class="p-md">Denominación</th>
              <th class="p-md">Comuna</th>
              <th class="p-md">Región</th>
              <th class="p-md">Tipo</th>
              <th class="p-md">Estado ERP</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="zonas-table-body" class="font-body-md text-body-md">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Formulario (Crear/Editar) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="zona-modal">
      <div class="modal-window w-[560px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 id="zona-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Nueva Zona de Transporte</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-zona-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="zona-form">
          <div class="p-lg space-y-md">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-pais" class="font-label-caps text-label-caps text-secondary block">PAÍS</label>
                <input type="text" id="z-pais" maxlength="2" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white uppercase" value="CL" required>
              </div>
              <div class="space-y-xs">
                <label for="z-zona" class="font-label-caps text-label-caps text-secondary block">ID ZONA (ÚNICO)</label>
                <input type="text" id="z-zona" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: ZT-0001">
              </div>
            </div>

            <div class="space-y-xs">
              <label for="z-denominacion" class="font-label-caps text-label-caps text-secondary block">DENOMINACIÓN (NOMBRE DEL DESTINO)</label>
              <input type="text" id="z-denominacion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" required placeholder="Ej: Maipú">
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-region" class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
                <select id="z-region" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <!-- Cargado dinámicamente -->
                </select>
              </div>
              <div class="space-y-xs">
                <label for="z-comuna" class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
                <select id="z-comuna" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <!-- Cargado dinámicamente según región -->
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label for="z-tipo" class="font-label-caps text-label-caps text-secondary block">TIPO</label>
                <select id="z-tipo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <option value="">— Sin definir —</option>
                  ${le.map(t=>`<option value="${t}">${t}</option>`).join("")}
                </select>
              </div>
              <div class="space-y-xs">
                <label for="z-estado" class="font-label-caps text-label-caps text-secondary block">ESTADO EN ERP</label>
                <select id="z-estado" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white">
                  <option value="false">Pendiente de creación en ERP</option>
                  <option value="true">Creada en ERP</option>
                </select>
              </div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-zona-modal">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer">Guardar Zona</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal Carga Masiva (CSV) -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-zonas-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Zonas de Transporte</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-zona-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Sube un archivo delimitado por punto y coma (<code>;</code>) o comas (<code>,</code>). Las primeras 3 columnas son obligatorias:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">
              pais;zona;denominacion
            </code>
            Opcionalmente puede incluir: <code class="font-data-mono text-xs">comuna, region, tipo, estado</code>. Si una zona no incluye comuna, región o tipo, quedará marcada como "Completar Datos" para definirla luego desde la plataforma.
            <br>El campo <code class="font-data-mono text-xs">estado</code> indica si la zona ya está creada en SAP/ERP: <code class="font-data-mono text-xs">1</code> = Creada en ERP, <code class="font-data-mono text-xs">0</code> = Pendiente de creación en ERP.
          </p>

          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-sm" id="csv-zona-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu archivo CSV de zonas aquí o haz clic para buscar</span>
            <input type="file" id="csv-zona-input" accept=".csv" class="hidden">
          </div>

          <div id="csv-zona-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa de Zonas Detectadas (<span id="csv-zona-count">0</span>):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Zona</th>
                    <th class="p-sm">Denominación</th>
                    <th class="p-sm">Comuna/Región/Tipo</th>
                    <th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-zona-preview-body">
                  <!-- Dinámico -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer" id="btn-cancel-zona-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" id="btn-confirm-zona-bulk" disabled>Importar registros</button>
        </div>
      </div>
    </div>
  `;const d=document.getElementById("z-region"),f=document.getElementById("z-comuna");O(d,""),T(f,"",""),d.addEventListener("change",()=>{T(f,d.value,"")}),f.addEventListener("change",()=>{if(!d.value&&f.value){const t=ce(f.value);t&&(O(d,t),T(f,t,f.value))}});const y=document.getElementById("zona-search"),j=document.getElementById("zona-filter-region");j.value=P;const A=()=>{const t=y.value.toLowerCase();let r=e.filter(a=>(a.zona||"").toLowerCase().includes(t)||(a.denominacion||"").toLowerCase().includes(t)||(a.comuna||"").toLowerCase().includes(t)||(a.region||"").toLowerCase().includes(t));return P&&(r=r.filter(a=>a.region===P)),D&&(r=r.filter(W)),v==="erp"?r=r.filter(a=>a.estado_erp):v==="pendiente"&&(r=r.filter(a=>!a.estado_erp)),Le(r),r};y.addEventListener("input",A),j.addEventListener("change",()=>{P=j.value,A()});const J=document.getElementById("kpi-zona-incompletas");J&&J.addEventListener("click",()=>{D=!D,v="",I(n)});const Q=document.getElementById("kpi-zona-erp");Q&&Q.addEventListener("click",()=>{v=v==="erp"?"":"erp",D=!1,I(n)});const X=document.getElementById("kpi-zona-pend-erp");X&&X.addEventListener("click",()=>{v=v==="pendiente"?"":"pendiente",D=!1,I(n)}),document.getElementById("btn-export-zonas-csv").addEventListener("click",()=>{const t=A();if(t.length===0){b("No hay zonas para exportar con los filtros actuales.","error");return}const r=["País","Zona","Denominación","Comuna","Región","Tipo","Estado ERP"],a=t.map(c=>[c.pais||"CL",c.zona||"",c.denominacion||"",c.comuna||"",c.region||"",c.tipo||"",c.estado_erp?"EN ERP":"PENDIENTE"]),u=ye(r,a);he(`zonas_transporte_${new Date().toISOString().slice(0,10)}.csv`,u)}),A();const R=document.getElementById("zona-modal"),ee=document.getElementById("zona-form"),te=()=>{R.classList.remove("pointer-events-none","opacity-0"),R.querySelector(".modal-window").classList.remove("scale-95")},F=()=>{R.classList.add("pointer-events-none","opacity-0"),R.querySelector(".modal-window").classList.add("scale-95")};document.getElementById("btn-create-zona").addEventListener("click",()=>{S=null,ee.reset(),document.getElementById("zona-modal-title").innerText="Nueva Zona de Transporte",document.getElementById("z-pais").value="CL",O(d,""),T(f,"",""),document.getElementById("z-estado").value="false",te()}),document.getElementById("btn-close-zona-modal").addEventListener("click",F),document.getElementById("btn-cancel-zona-modal").addEventListener("click",F),ee.addEventListener("submit",t=>{t.preventDefault();const r=L();r.transportZones||(r.transportZones=[]);const a={zona:document.getElementById("z-zona").value.trim().toUpperCase(),pais:document.getElementById("z-pais").value.trim().toUpperCase()||"CL",denominacion:document.getElementById("z-denominacion").value.trim(),comuna:document.getElementById("z-comuna").value||null,region:document.getElementById("z-region").value||null,tipo:document.getElementById("z-tipo").value||null,estado_erp:document.getElementById("z-estado").value==="true"};if(!a.zona){b("Debe ingresar el ID de la Zona.","error");return}if(S){const u=r.transportZones.findIndex(c=>c.zona===S);if(u!==-1){if(a.zona!==S&&r.transportZones.some(c=>c.zona===a.zona)){b("Ya existe una zona con ese ID.","error");return}a.created_at=r.transportZones[u].created_at||new Date().toISOString(),r.transportZones[u]=a,$(r),b("Zona de transporte actualizada correctamente.")}}else{if(r.transportZones.some(u=>u.zona===a.zona)){b("Ya existe una zona registrada con ese ID.","error");return}a.created_at=new Date().toISOString(),r.transportZones.push(a),$(r),b("Zona de transporte registrada con éxito.")}F(),I(n)});const _=document.getElementById("bulk-upload-zonas-modal"),ue=document.getElementById("btn-close-zona-bulk-modal"),be=document.getElementById("btn-cancel-zona-bulk"),q=document.getElementById("btn-confirm-zona-bulk"),h=document.getElementById("csv-zona-dropzone"),ne=document.getElementById("csv-zona-input");let k=[];document.getElementById("btn-bulk-upload-zonas").addEventListener("click",()=>{k=[],q.disabled=!0,document.getElementById("csv-zona-preview-container").classList.add("hidden"),document.getElementById("csv-zona-preview-body").innerHTML="",_.classList.remove("pointer-events-none","opacity-0"),_.querySelector(".modal-window").classList.remove("scale-95")});const H=()=>{_.classList.add("pointer-events-none","opacity-0"),_.querySelector(".modal-window").classList.add("scale-95")};ue.addEventListener("click",H),be.addEventListener("click",H),h.addEventListener("click",()=>ne.click()),h.addEventListener("dragover",t=>{t.preventDefault(),h.classList.add("border-primary","bg-primary-container/[0.04]")}),h.addEventListener("dragleave",()=>{h.classList.remove("border-primary","bg-primary-container/[0.04]")}),h.addEventListener("drop",t=>{t.preventDefault(),h.classList.remove("border-primary","bg-primary-container/[0.04]"),t.dataTransfer.files.length>0&&ae(t.dataTransfer.files[0])}),ne.addEventListener("change",t=>{t.target.files.length>0&&ae(t.target.files[0])});function ae(t){const r=new FileReader;r.onload=function(a){const u=a.target.result;let c=new TextDecoder("utf-8").decode(u);c.includes("�")&&(c=new TextDecoder("windows-1252").decode(u));const V=xe(c);if(V.length===0){b("El archivo CSV está vacío o no tiene el formato correcto.","error");return}const U=L();U.transportZones||(U.transportZones=[]),k=[];const oe=document.getElementById("csv-zona-preview-body");oe.innerHTML="";const re=new Set;V.forEach(E=>{const se=(C(E,"pais","país")||"CL").trim().toUpperCase()||"CL",B=(C(E,"zona","idzona","id zona")||"").trim().toUpperCase(),G=(C(E,"denominacion","denominación")||"").trim();let x=(C(E,"comuna")||"").trim(),z=ze((C(E,"region","región")||"").trim()),Z=(C(E,"tipo")||"").trim();Z=le.find(w=>w.toLowerCase()===Z.toLowerCase())||"";const fe=(C(E,"estado","estado_erp","estadoerp")||"").trim().toLowerCase(),ge=["1","si","sí","true","creada","erp"].includes(fe);if(x){const w=we(x);x=w.comuna,!z&&w.region&&(z=w.region)}!z&&x&&(z=ce(x)||"");let g="";se?B?G?(U.transportZones.some(w=>w.zona===B)||re.has(B))&&(g="Zona Duplicada"):g="Falta Denominación":g="Falta ID Zona":g="Falta País";const de=!g&&(!x||!z||!Z),K=document.createElement("tr");K.className="border-b border-outline-variant",K.innerHTML=`
          <td class="p-sm font-data-mono">${i(B)}</td>
          <td class="p-sm">${i(G)}</td>
          <td class="p-sm text-secondary">${i(x)||"—"} / ${i(z)||"—"} / ${i(Z)||"—"}</td>
          <td class="p-sm">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${g?"bg-red-100 text-red-800":de?"bg-amber-100 text-amber-800":"bg-green-100 text-green-800"}">
              ${g||(de?"Completar Datos":"Listo")}
            </span>
          </td>
        `,oe.appendChild(K),g||(re.add(B),k.push({zona:B,pais:se||"CL",denominacion:G,comuna:x||null,region:z||null,tipo:Z||null,estado_erp:ge,created_at:new Date().toISOString()}))}),document.getElementById("csv-zona-count").innerText=V.length,document.getElementById("csv-zona-preview-container").classList.remove("hidden"),k.length>0?q.disabled=!1:b("No se encontraron registros de zonas válidos.","error")},r.readAsArrayBuffer(t)}q.addEventListener("click",()=>{const t=L();t.transportZones||(t.transportZones=[]),k.forEach(r=>t.transportZones.push(r)),$(t),b(`Se importaron ${k.length} zonas de transporte correctamente.`),H(),I(n)}),window.__openZonaEditModal=t=>{const a=(L().transportZones||[]).find(u=>u.zona===t);a&&(S=t,document.getElementById("z-pais").value=a.pais||"CL",document.getElementById("z-zona").value=a.zona,document.getElementById("z-denominacion").value=a.denominacion||"",O(d,a.region||""),T(f,a.region||"",a.comuna||""),document.getElementById("z-tipo").value=a.tipo||"",document.getElementById("z-estado").value=a.estado_erp?"true":"false",document.getElementById("zona-modal-title").innerText="Editar Zona de Transporte",te())}}function Le(n){const o=document.getElementById("zonas-table-body");if(o){if(n.length===0){o.innerHTML=`
      <tr>
        <td colspan="8" class="p-xl text-center text-secondary">
          No se encontraron zonas de transporte registradas.
        </td>
      </tr>
    `;return}o.innerHTML="",n.forEach(e=>{const s=document.createElement("tr"),l=W(e);s.className=`border-b border-outline-variant hover:bg-surface-container-low transition-colors ${l?"bg-amber-50/60":""}`;const p=e.estado_erp?"bg-green-100 text-green-800":"bg-red-100 text-red-800",m=d=>d?i(d):'<span class="inline-flex items-center gap-1 text-amber-700 font-bold text-[10px] uppercase"><span class="material-symbols-outlined text-[14px]">warning</span> Completar</span>';s.innerHTML=`
      <td class="p-md font-data-mono">${i(e.pais||"CL")}</td>
      <td class="p-md font-bold text-primary font-data-mono">${i(e.zona)}</td>
      <td class="p-md">${i(e.denominacion)}</td>
      <td class="p-md text-xs">${m(e.comuna)}</td>
      <td class="p-md text-xs">${m(e.region)}</td>
      <td class="p-md text-xs">${m(e.tipo)}</td>
      <td class="p-md">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${p}">
          ${e.estado_erp?"EN ERP":"PENDIENTE"}
        </span>
      </td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          <button class="btn-edit-zona text-secondary hover:text-primary p-xs cursor-pointer" data-id="${i(e.zona)}" title="Editar zona">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button class="btn-toggle-zona text-secondary hover:text-primary p-xs cursor-pointer" data-id="${i(e.zona)}" title="${e.estado_erp?"Marcar como pendiente":"Marcar como creada en ERP"}">
            <span class="material-symbols-outlined text-[20px] ${e.estado_erp?"text-red-600 hover:text-red-800":"text-green-600 hover:text-green-800"}">
              ${e.estado_erp?"unpublished":"check_circle"}
            </span>
          </button>
          <button class="btn-delete-zona text-secondary hover:text-red-700 p-xs cursor-pointer" data-id="${i(e.zona)}" title="Eliminar zona">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </td>
    `,o.appendChild(s)}),o.querySelectorAll(".btn-edit-zona").forEach(e=>{e.addEventListener("click",s=>window.__openZonaEditModal(s.currentTarget.getAttribute("data-id")))}),o.querySelectorAll(".btn-toggle-zona").forEach(e=>{e.addEventListener("click",s=>{const l=s.currentTarget.getAttribute("data-id"),p=L(),m=(p.transportZones||[]).find(d=>d.zona===l);if(m){m.estado_erp=!m.estado_erp,$(p),b(`La zona ${m.zona} fue marcada como ${m.estado_erp?"creada en ERP":"pendiente"}.`);const d=document.getElementById("rutas-subview-content");d&&I(d)}})}),o.querySelectorAll(".btn-delete-zona").forEach(e=>{e.addEventListener("click",async s=>{const l=s.currentTarget.getAttribute("data-id"),p=L(),m=(p.transportZones||[]).findIndex(d=>d.zona===l);if(m!==-1){if(!await Ee(`¿Eliminar la zona ${l}? Esta acción no se puede deshacer.`))return;p.transportZones.splice(m,1),$(p,{syncOnly:["transportZones"]}),ve("transportZones",l).catch(y=>console.error("Error al borrar zona en Supabase:",y.message||y)),b(`La zona ${l} ha sido eliminada.`);const d=document.getElementById("rutas-subview-content");if(d&&I(d),document.getElementById("stage-area")){const y=new Event("db_updated");window.dispatchEvent(y)}}})})}}export{C as getField,pe as normalizeKey,ze as normalizeRegionName,M as normalizeText,I as renderZonasView,we as standardizeComuna};
