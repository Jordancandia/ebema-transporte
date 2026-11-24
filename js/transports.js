import{getDatabase as _,saveDatabase as F,getOrigenGroups as re}from"./data.js?v=6ce8cb5f60";import{formatRut as U,validateRut as J,generateSapCode as ee,parseCSV as se,showAlert as p,escapeHtml as C}from"./utils.js";import{renderFichaTransporte as le}from"./ficha-transporte.js?v=0f35781af9";import{abrirModalTroncal as ne}from"./troncales.js?v=079d20e40c";import{supabase as de}from"./supabase-client.js?v=fd17fd7d20";let P=null,V="";const te=e=>e.tipo_servicio==="TRONCAL"?"troncal":"ultima_milla";function ae(e){const d=[];return String(e.rut??"").trim()||d.push("RUT"),String(e.telefono??"").trim()||d.push("teléfono"),String(e.email??"").trim()||d.push("correo"),d}function xe(e,d){return e.filter(L=>L.activo!==!1&&(!d||(L.centrosServicio||[]).includes(d))).reduce((L,g)=>L+(g.camiones||[]).reduce((T,D)=>T+Number(D.capacidad||0),0),0)}function N(e){const d=_(),L=(d.transports||[]).map(t=>({...t,_tipo:te(t),_src:"transports"})),g=(d.troncales||[]).map(t=>({...t,_tipo:"troncal",_src:"troncales"})),T=[...L,...g],D=t=>t._tipo==="ultima_milla",A=T.filter(D).length,a=T.filter(t=>!D(t)).length,s=T.filter(t=>D(t)&&t.activo!==!1).length,h=T.filter(t=>!D(t)&&t.activo!==!1).length,w=T.reduce((t,r)=>t+(r.camiones||[]).reduce((n,S)=>n+Number(S.capacidad||0),0),0),u=d.logisticsCentres||[],o=t=>`prov-tipo-btn px-sm py-xs text-xs font-bold rounded border transition-colors flex items-center gap-xs cursor-pointer ${V===t?t==="ultima_milla"?"bg-blue-600 text-white border-blue-600":t==="troncal"?"bg-amber-500 text-white border-amber-500":"bg-primary text-white border-primary":"border-outline-variant text-secondary hover:bg-surface-container-high"}`;e.innerHTML=`
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Proveedores de Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Gestione los proveedores de <b>Última Milla</b> (despacho directo a clientes) y <b>Troncales</b> (traslado entre sucursales para abastecimiento de stock).</p>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-lg mb-xl">
      <div class="bg-surface border border-outline-variant p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Total Proveedores</h4>
          <div class="font-headline-md text-headline-md font-bold text-on-surface mt-1">${A+a}</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-secondary">groups</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-blue-500 p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Última Milla</h4>
          <div class="font-headline-md text-headline-md font-bold text-blue-600 mt-1">${s}<span class="text-secondary text-sm font-normal ml-1">/ ${A}</span></div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-blue-400">local_shipping</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-amber-500 p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Troncal</h4>
          <div class="font-headline-md text-headline-md font-bold text-amber-600 mt-1">${h}<span class="text-secondary text-sm font-normal ml-1">/ ${a}</span></div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-amber-400">sync_alt</span>
      </div>
      <div class="bg-surface border border-outline-variant border-l-4 border-l-primary p-md shadow-sm rounded flex items-center justify-between">
        <div>
          <h4 class="font-label-caps text-label-caps text-secondary uppercase">Capacidad Flota</h4>
          <div class="font-headline-md text-headline-md font-bold text-primary mt-1">${w} Ton</div>
        </div>
        <span class="material-symbols-outlined text-[32px] text-primary">analytics</span>
      </div>
    </div>

    <!-- Tabla -->
    <div class="bg-surface border border-outline-variant rounded shadow-sm overflow-hidden">
      <div class="p-md border-b border-outline-variant flex flex-col md:flex-row justify-between items-center gap-md bg-white">
        <div class="flex flex-col md:flex-row gap-sm w-full md:w-auto flex-1 flex-wrap">
          <div class="relative w-full md:w-72 focus-within:ring-2 focus-within:ring-primary rounded overflow-hidden">
            <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
            <input type="text" id="transport-search" class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar por Razón Social, RUT…">
          </div>
          <div class="flex gap-xs flex-wrap">
            <button class="${o("")}" data-tipo=""><span class="material-symbols-outlined text-[14px]">filter_list</span> Todos</button>
            <button class="${o("ultima_milla")}" data-tipo="ultima_milla"><span class="material-symbols-outlined text-[14px]">local_shipping</span> Última Milla</button>
            <button class="${o("troncal")}" data-tipo="troncal"><span class="material-symbols-outlined text-[14px]">sync_alt</span> Troncal</button>
          </div>
        </div>
        <div class="flex gap-sm w-full md:w-auto">
          <button id="btn-bulk-upload-transports" class="flex-1 md:flex-none border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">upload_file</span> Carga Masiva
          </button>
          <button id="btn-create-transport" class="flex-1 md:flex-none bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded transition-all flex items-center justify-center gap-sm cursor-pointer text-xs uppercase shadow">
            <span class="material-symbols-outlined text-[18px]">add</span> Nuevo Proveedor
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-surface-container-high border-b border-outline-variant text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th class="p-md">Tipo</th>
              <th class="p-md">ID Transporte</th>
              <th class="p-md">Razón Social</th>
              <th class="p-md">RUT</th>
              <th class="p-md">Flota</th>
              <th class="p-md">Contacto</th>
              <th class="p-md">Estado</th>
              <th class="p-md text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="transports-table-body" class="font-body-md text-body-md"></tbody>
        </table>
      </div>
    </div>

    <!-- ═══ MODAL: Nuevo Proveedor ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="nuevo-proveedor-modal">
      <div class="modal-window w-[620px] max-w-[95vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Nuevo Proveedor</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-nuevo-proveedor">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg max-h-[80vh] overflow-y-auto space-y-md">
          <!-- Selector Tipo -->
          <div>
            <p class="font-label-caps text-label-caps text-secondary mb-sm">TIPO DE PROVEEDOR</p>
            <div class="grid grid-cols-2 gap-md">
              <button class="tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer border-blue-500 bg-blue-50" data-tipo="ultima_milla">
                <span class="material-symbols-outlined text-[36px] text-blue-600">local_shipping</span>
                <span class="font-bold text-blue-700 text-sm uppercase tracking-wide">Última Milla</span>
                <span class="text-[11px] text-secondary text-center leading-tight">Despacho directo a clientes finales</span>
              </button>
              <button class="tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer border-outline-variant text-secondary hover:border-amber-400 hover:bg-amber-50" data-tipo="troncal">
                <span class="material-symbols-outlined text-[36px]">sync_alt</span>
                <span class="font-bold text-sm uppercase tracking-wide">Troncal</span>
                <span class="text-[11px] text-center leading-tight">Traslado entre sucursales / abastecimiento de stock</span>
              </button>
            </div>
          </div>
          <!-- Campos comunes (iguales para ambos tipos) -->
          <div class="space-y-md border-t border-outline-variant pt-md">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
              <input type="text" id="np-razonsocial" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej. Transportes Express Ltda.">
            </div>
            <div class="grid grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">RUT EMPRESA</label>
                <input type="text" id="np-rut" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej: 76.849.201-3">
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">CÓDIGO SAP</label>
                <input type="text" id="np-codigosap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Auto-generado">
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN COMERCIAL</label>
              <input type="text" id="np-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="Ej. Calle Principal 456, Maipú">
            </div>
            <div class="grid grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">TELÉFONO</label>
                <input type="text" id="np-telefono" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="+56 9 8888 7777">
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">CORREO ELECTRÓNICO</label>
                <input type="email" id="np-email" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white" placeholder="contacto@empresa.cl">
              </div>
            </div>
            <div class="bg-surface-container-low border border-outline-variant rounded p-sm text-[11px] text-secondary flex items-start gap-xs">
              <span class="material-symbols-outlined text-[14px] mt-px shrink-0">info</span>
              Una vez registrado el proveedor, podrás agregar patentes, choferes, documentos y centros logísticos desde el botón <b>Editar</b>.
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button id="btn-cancel-nuevo-proveedor" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
          <button id="btn-save-nuevo-proveedor" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase shadow">Crear Proveedor</button>
        </div>
      </div>
    </div>

    <!-- ═══ MODAL: Editar Última Milla ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="transport-modal">
      <div class="modal-window w-[600px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <div class="flex items-center gap-sm">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">TRANSPORTISTA</span>
            <h4 id="transport-modal-title" class="font-headline-sm text-headline-sm font-bold text-on-surface">Editar Proveedor</h4>
          </div>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-transport-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <form id="transport-form">
          <div class="p-lg space-y-md max-h-[70vh] overflow-y-auto">
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">RAZÓN SOCIAL</label>
              <input type="text" id="t-razonsocial" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white uppercase" required>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">TIPO DE TRANSPORTISTA</label>
              <select id="t-tipo" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
                <option value="ULTIMA_MILLA">Última milla</option>
                <option value="TRONCAL">Troncal</option>
              </select>
            </div>
            <div class="text-[11px] text-secondary bg-surface-container-low border border-outline-variant rounded p-sm">RUT, teléfono y correo son obligatorios: si falta alguno, el transportista queda <b>BLOQUEADO</b> y no aparece para programar camiones ni coordinar despachos. Todos estos datos se pueden corregir en cualquier momento.</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">RUT EMPRESA</label>
                <input type="text" id="t-rut" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
                <div id="t-rut-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> RUT bloqueado
                </div>
              </div>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">PATENTE CAMIÓN</label>
                <input type="text" id="t-patente" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
                <div id="t-patente-lock-msg" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                  <span class="material-symbols-outlined text-[12px]">lock</span> Patente bloqueada
                </div>
              </div>
            </div>
            <div class="space-y-xs">
              <label class="font-label-caps text-label-caps text-secondary block">CÓDIGO SAP</label>
              <input type="text" id="t-codigosap" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
              <div id="t-sap-hint" class="text-[11px] text-secondary mt-1 flex items-start gap-xs">
                <span class="material-symbols-outlined text-[12px] mt-px shrink-0">info</span>
                <span>Al cambiarlo, el <b>ID interno</b> se re-asigna sólo si el transportista aún no tiene historial (camiones, coordinaciones, seguimiento o portería). Si ya tiene historial, se corrige el código y el ID queda fijo.</span>
              </div>
              <div id="t-id-interno" class="text-[11px] text-primary hidden items-center gap-xs font-bold mt-1">
                <span class="material-symbols-outlined text-[12px]">key</span> <span id="t-id-interno-val"></span>
              </div>
            </div>
            <div class="pt-sm border-t border-outline-variant space-y-md">
              <h5 class="font-label-caps text-label-caps text-primary">Datos de Contacto</h5>
              <div class="space-y-xs">
                <label class="font-label-caps text-label-caps text-secondary block">DIRECCIÓN COMERCIAL</label>
                <input type="text" id="t-direccion" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
                <div class="space-y-xs">
                  <label class="font-label-caps text-label-caps text-secondary block">TELÉFONO</label>
                  <input type="text" id="t-telefono" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
                </div>
                <div class="space-y-xs">
                  <label class="font-label-caps text-label-caps text-secondary block">CORREO ELECTRÓNICO</label>
                  <input type="email" id="t-email" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white">
                </div>
              </div>
            </div>
          </div>
          <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
            <button type="button" id="btn-cancel-transport-modal" class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Cancelar</button>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer text-xs uppercase">Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ═══ MODAL: Carga Masiva CSV (Última Milla) ═══ -->
    <div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300" id="bulk-upload-modal">
      <div class="modal-window w-[700px] max-w-[90vw] bg-white border border-outline-variant shadow-lg rounded-xl overflow-hidden transform scale-95 transition-transform duration-300">
        <div class="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva — Proveedores Última Milla (CSV)</h4>
          <button class="text-secondary hover:text-primary cursor-pointer" id="btn-close-bulk-modal">
            <span class="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>
        <div class="p-lg space-y-md">
          <p class="font-body-md text-secondary leading-relaxed">
            Archivo CSV delimitado por <code>;</code>. Encabezados requeridos:
            <code class="block p-sm bg-background border border-outline-variant rounded font-data-mono text-primary text-xs mt-xs">razonSocial;rut;direccion;telefono;email;patente;capacidad</code>
          </p>
          <div class="border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-container/[0.03] rounded-lg p-xl text-center cursor-pointer transition-all flex flex-col items-center gap-sm" id="csv-dropzone">
            <span class="material-symbols-outlined text-[48px] text-secondary">cloud_upload</span>
            <span class="font-body-md text-secondary font-bold">Arrastra tu CSV aquí o haz clic para buscar</span>
            <input type="file" id="csv-file-input" accept=".csv" class="hidden">
          </div>
          <div id="csv-preview-container" class="hidden space-y-sm">
            <h5 class="font-label-caps text-label-caps text-on-surface">Vista Previa (<span id="csv-count">0</span> registros):</h5>
            <div class="max-h-48 overflow-y-auto border border-outline-variant rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-surface-container-high border-b border-outline-variant font-bold text-secondary uppercase">
                    <th class="p-sm">Razón Social</th><th class="p-sm">RUT</th><th class="p-sm">Patente</th><th class="p-sm">Cap.</th><th class="p-sm">Estado</th>
                  </tr>
                </thead>
                <tbody id="csv-preview-body"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="p-md border-t border-outline-variant bg-surface-container-low flex justify-end gap-sm">
          <button class="border border-secondary text-secondary hover:bg-surface-container-high font-bold px-md py-sm rounded cursor-pointer text-xs uppercase" id="btn-cancel-bulk">Cancelar</button>
          <button class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs uppercase" id="btn-confirm-bulk" disabled>Importar</button>
        </div>
      </div>
    </div>
  `,oe(d,V,"");let i="ultima_milla";function m(t){i=t,e.querySelectorAll(".tipo-selector").forEach(r=>{r.dataset.tipo==="ultima_milla"?r.className=`tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer ${t==="ultima_milla"?"border-blue-500 bg-blue-50":"border-outline-variant text-secondary hover:border-blue-300 hover:bg-blue-50/50"}`:r.className=`tipo-selector flex flex-col items-center gap-sm p-md border-2 rounded-lg transition-all cursor-pointer ${t==="troncal"?"border-amber-500 bg-amber-50":"border-outline-variant text-secondary hover:border-amber-300 hover:bg-amber-50/50"}`})}e.querySelectorAll(".prov-tipo-btn").forEach(t=>{t.addEventListener("click",()=>{V=t.dataset.tipo,N(e)})}),e.querySelector("#transport-search").addEventListener("input",t=>{oe(d,V,t.target.value)});const M=e.querySelector("#nuevo-proveedor-modal"),b=()=>{M.classList.remove("pointer-events-none","opacity-0"),M.querySelector(".modal-window").classList.remove("scale-95")},x=()=>{M.classList.add("pointer-events-none","opacity-0"),M.querySelector(".modal-window").classList.add("scale-95")};e.querySelector("#btn-create-transport").addEventListener("click",()=>{e.querySelector("#np-razonsocial").value="",e.querySelector("#np-rut").value="",e.querySelector("#np-email").value="",e.querySelector("#np-telefono").value="",e.querySelector("#np-direccion").value="";const t=_();e.querySelector("#np-codigosap").value=ee("TRSP",t.transports,"codigoSap"),m("ultima_milla"),b()}),e.querySelector("#btn-close-nuevo-proveedor").addEventListener("click",x),e.querySelector("#btn-cancel-nuevo-proveedor").addEventListener("click",x),e.querySelectorAll(".tipo-selector").forEach(t=>{t.addEventListener("click",()=>m(t.dataset.tipo))}),e.querySelector("#np-rut").addEventListener("blur",t=>{t.target.value=U(t.target.value)}),e.querySelector("#btn-save-nuevo-proveedor").addEventListener("click",()=>{const t=_(),r=(e.querySelector("#np-razonsocial").value||"").replace(/\s+/g," ").trim().toUpperCase(),n=e.querySelector("#np-rut").value.trim(),S=(e.querySelector("#np-codigosap").value||"").toUpperCase().trim(),v=e.querySelector("#np-direccion").value.trim(),f=e.querySelector("#np-telefono").value.trim(),I=e.querySelector("#np-email").value.trim().toLowerCase();if(!r){p("La Razón Social es requerida.","error");return}if(!J(n)){p("El RUT ingresado no es válido.","error");return}if((t.transports||[]).some(q=>q.rut===n)){p("RUT ya registrado en proveedores.","error");return}const k=i!=="ultima_milla",y=S||"t"+Date.now();if((t.transports||[]).some(q=>String(q.id).trim().toUpperCase()===y)){p(`El código ${y} ya existe en el maestro de transportistas.`,"error");return}t.transports=t.transports||[],t.transports.push({id:y,razonSocial:r,rut:n,codigoSap:S,direccion:v,telefono:f,email:I,ownerEmail:I,activo:!0,tipo_servicio:k?"TRONCAL":"ULTIMA MILLA",camiones:[],choferes:[],documentos:{},centrosServicio:[]}),F(t,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),p(`Proveedor ${k?"Troncal":"Última Milla"} "${r}" creado. Agrega patentes y choferes desde Editar.`),x(),N(e)});const K=e.querySelector("#transport-modal"),H=()=>{K.classList.add("pointer-events-none","opacity-0"),K.querySelector(".modal-window").classList.add("scale-95")};e.querySelector("#btn-close-transport-modal").addEventListener("click",H),e.querySelector("#btn-cancel-transport-modal").addEventListener("click",H),e.querySelector("#t-rut").addEventListener("blur",t=>{t.target.value=U(t.target.value)}),e.querySelector("#transport-form").addEventListener("submit",async t=>{t.preventDefault();const r=e.querySelector('#transport-form button[type="submit"]'),n=_(),S=n.transports.findIndex(c=>c.id===P);if(S===-1)return;const v=n.transports[S],f=U(e.querySelector("#t-rut").value.trim());if(f&&!J(f)){p("El RUT ingresado no es válido.","error");return}if(f&&(n.transports||[]).some(c=>c.id!==P&&U(String(c.rut||""))===f)){const c=(n.transports||[]).find(E=>E.id!==P&&U(String(E.rut||""))===f);p(`El RUT ${f} ya está registrado en ${c.razonSocial||c.id}.`,"error");return}const I=e.querySelector("#t-email").value.trim();if(I&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(I)){p("El correo ingresado no es válido.","error");return}const l=(e.querySelector("#t-codigosap").value||"").trim().toUpperCase(),k=String(v.codigoSap||v.id||"").trim().toUpperCase();if(k&&!l){p("El Código SAP es obligatorio.","error");return}if(l&&(n.transports||[]).some(c=>c.id!==P&&(String(c.codigoSap||"").trim().toUpperCase()===l||String(c.id||"").trim().toUpperCase()===l))){p(`El Código SAP ${l} ya está usado por otro transportista.`,"error");return}let y=v.id,q="";if(l&&l!==k){r&&(r.disabled=!0);const{data:c,error:E}=await de.rpc("fn_transportista_recodificar",{p_id:v.id,p_codigo:l});if(r&&(r.disabled=!1),E){p("No se pudo cambiar el Código SAP: "+E.message,"error");return}const $=c||{};$.rekey?(y=$.id,q=` Código SAP e ID interno re-asignados a ${$.id}.`):q=` Código SAP actualizado a ${l}; el ID interno sigue siendo ${v.id} porque ya tiene historial${($.detalle||[]).length?" ("+$.detalle.join(", ")+")":""}.`}n.transports[S]={...v,id:y,codigoSap:l||v.codigoSap||null,razonSocial:e.querySelector("#t-razonsocial").value.replace(/\s+/g," ").trim().toUpperCase(),direccion:e.querySelector("#t-direccion").value.trim(),telefono:e.querySelector("#t-telefono").value.trim(),email:e.querySelector("#t-email").value.trim().toLowerCase(),ownerEmail:e.querySelector("#t-email").value.trim().toLowerCase(),rut:f||null,tipo_servicio:e.querySelector("#t-tipo").value},P=y;const B=ae(n.transports[S]);F(n,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),p((B.length?`Guardado. Queda BLOQUEADO hasta completar: ${B.join(", ")}.`:"Transportista actualizado y activo.")+q,B.length?"error":"success"),H(),N(e)});const j=e.querySelector("#bulk-upload-modal"),G=()=>{j.classList.add("pointer-events-none","opacity-0"),j.querySelector(".modal-window").classList.add("scale-95")};e.querySelector("#btn-bulk-upload-transports").addEventListener("click",()=>{j.classList.remove("pointer-events-none","opacity-0"),j.querySelector(".modal-window").classList.remove("scale-95")}),e.querySelector("#btn-close-bulk-modal").addEventListener("click",G),e.querySelector("#btn-cancel-bulk").addEventListener("click",G);let z=[];const O=e.querySelector("#csv-dropzone"),W=e.querySelector("#csv-file-input"),X=e.querySelector("#btn-confirm-bulk");function Y(t){const r=new FileReader;r.onload=n=>{const S=n.target.result,v=se(S);if(v.length===0){p("CSV vacío o formato incorrecto.","error");return}const f=_();z=[];const I=e.querySelector("#csv-preview-body");I.innerHTML="",v.forEach(l=>{const k=l.razonSocial||"";let y=U(l.rut||"");const q=l.direccion||"",B=l.telefono||"",c=l.email||"",E=(l.patente||"").toUpperCase().replace(/\s+/g,""),$=Number(l.capacidad||10);let R="";k?J(y)?!E||E.length<5?R="Patente incorrecta":(f.transports||[]).some(Z=>Z.rut===y)?R="RUT Duplicado":(f.transports||[]).some(Z=>Z.patente===E)&&(R="Patente Duplicada"):R="RUT inválido":R="Falta Razón Social";const Q=document.createElement("tr");Q.className="border-b border-outline-variant",Q.innerHTML=`<td class="p-sm">${C(k)}</td><td class="p-sm font-data-mono">${C(y)}</td><td class="p-sm font-data-mono">${C(E)}</td><td class="p-sm">${$} Ton</td><td class="p-sm"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${R?"bg-red-100 text-red-800":"bg-green-100 text-green-800"}">${R||"Listo"}</span></td>`,I.appendChild(Q),R||z.push({razonSocial:k,rut:y,direccion:q,telefono:B,email:c,patente:E,capacidad:$,activo:!0})}),e.querySelector("#csv-count").innerText=v.length,e.querySelector("#csv-preview-container").classList.remove("hidden"),X.disabled=z.length===0},r.readAsText(t)}O.addEventListener("click",()=>W.click()),O.addEventListener("dragover",t=>{t.preventDefault(),O.classList.add("border-primary")}),O.addEventListener("dragleave",()=>O.classList.remove("border-primary")),O.addEventListener("drop",t=>{t.preventDefault(),O.classList.remove("border-primary"),t.dataTransfer.files[0]&&Y(t.dataTransfer.files[0])}),W.addEventListener("change",t=>{t.target.files[0]&&Y(t.target.files[0])}),X.addEventListener("click",()=>{const t=_();z.forEach(r=>{r.id="t"+Date.now()+Math.random().toString(36).substr(2,5),r.codigoSap=ee("TRSP",t.transports,"codigoSap"),t.transports.push(r)}),F(t,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),p(`${z.length} proveedores importados.`),G(),N(e)})}function oe(e,d,L){const g=document.getElementById("transports-table-body");if(!g)return;const T=(e.transports||[]).map(a=>({...a,_tipo:te(a),_src:"transports"})),D=(e.troncales||[]).map(a=>({...a,_tipo:"troncal",_src:"troncales"}));let A=[...T,...D];if(d&&(A=A.filter(a=>a._tipo===d)),L){const a=L.toLowerCase();A=A.filter(s=>(s.razonSocial||"").toLowerCase().includes(a)||(s.rut||"").toLowerCase().includes(a)||(s.patente||"").toLowerCase().includes(a)||(s.codigoSap||"").toLowerCase().includes(a))}if(A.length===0){g.innerHTML='<tr><td colspan="8" class="p-xl text-center text-secondary">No se encontraron proveedores.</td></tr>';return}g.innerHTML="",A.forEach(a=>{const s=a._tipo==="ultima_milla",h=s?'<span class="inline-flex items-center gap-xs px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800"><span class="material-symbols-outlined text-[11px]">local_shipping</span> ÚLTIMA MILLA</span>':'<span class="inline-flex items-center gap-xs px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800"><span class="material-symbols-outlined text-[11px]">sync_alt</span> TRONCAL</span>',w=a._src==="transports"?ae(a):[],u=a.activo===!1?'<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">DE BAJA</span>':w.length?`<span class="inline-flex items-center gap-xs px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900" title="Falta: ${C(w.join(", "))}"><span class="material-symbols-outlined text-[11px]">lock</span>BLOQUEADO</span><div class="text-[10px] text-secondary mt-[2px]">Falta: ${C(w.join(", "))}</div>`:'<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">ACTIVO</span>',o=s?`<span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded font-data-mono text-xs">${(a.camiones||[]).length} camión${(a.camiones||[]).length===1?"":"es"}</span>`:`<span class="bg-surface-container-high px-sm py-1 border border-outline-variant rounded font-data-mono text-xs">${(a.camiones||[]).length} cam. · ${(a.rutasCobertura||[]).length} ruta${(a.rutasCobertura||[]).length===1?"":"s"}</span>`,i=s||a._src==="transports"?`<div class="text-xs font-bold leading-tight">${C(a.email||"—")}</div><div class="text-[10px] text-secondary">${C(a.telefono||"")}</div>`:'<div class="text-xs text-secondary">—</div>',m=document.createElement("tr");m.className="border-b border-outline-variant hover:bg-surface-container-low transition-colors",m.innerHTML=`
      <td class="p-md">${h}</td>
      <td class="p-md font-data-mono text-sm">${C(a.codigoSap||a.id||"")}${a.codigoSap&&String(a.codigoSap).trim()!==String(a.id).trim()?`<div class="text-[10px] text-secondary font-normal" title="ID interno con el que quedó registrado el historial">ID ${C(a.id||"")}</div>`:""}</td>
      <td class="p-md font-bold">${C(a.razonSocial||"")}</td>
      <td class="p-md font-data-mono text-sm">${C(a.rut||"")}</td>
      <td class="p-md">${o}</td>
      <td class="p-md">${i}</td>
      <td class="p-md">${u}</td>
      <td class="p-md text-center">
        <div class="flex items-center justify-center gap-xs">
          ${s?`<button class="btn-ficha text-secondary hover:text-primary p-xs cursor-pointer" data-id="${a.id}" title="Ficha de transporte"><span class="material-symbols-outlined text-[20px]">folder_open</span></button>`:""}
          <button class="btn-edit text-secondary hover:text-primary p-xs cursor-pointer" data-id="${a.id}" data-tipo="${a._tipo}" data-src="${a._src}" title="Editar"><span class="material-symbols-outlined text-[20px]">edit</span></button>
          <button class="btn-toggle text-secondary hover:text-primary p-xs cursor-pointer" data-id="${a.id}" data-tipo="${a._tipo}" data-src="${a._src}" title="${a.activo!==!1?"Dar de baja":"Activar"}">
            <span class="material-symbols-outlined text-[20px] ${a.activo!==!1?"text-red-500":"text-green-600"}">${a.activo!==!1?"block":"check_circle"}</span>
          </button>
        </div>
      </td>
    `,g.appendChild(m)}),g.querySelectorAll(".btn-ficha").forEach(a=>{a.addEventListener("click",s=>{const h=s.currentTarget.dataset.id,w=document.getElementById("stage-area"),u=document.getElementById("current-page-title");u&&(u.textContent="Ficha de Transporte"),le(w,h)})}),g.querySelectorAll(".btn-edit").forEach(a=>{a.addEventListener("click",s=>{const h=s.currentTarget.dataset.id,w=s.currentTarget.dataset.src,u=_();if(w==="transports"){const o=(u.transports||[]).find(b=>b.id===h);if(!o)return;P=h;const i=document.getElementById("transport-modal");document.getElementById("t-razonsocial").value=o.razonSocial||"",document.getElementById("t-rut").value=o.rut||"",document.getElementById("t-patente").value=o.patente||"",document.getElementById("t-codigosap").value=o.codigoSap||"",document.getElementById("t-direccion").value=o.direccion||"",document.getElementById("t-telefono").value=o.telefono||"",document.getElementById("t-email").value=o.email||"",document.getElementById("t-tipo").value=String(o.tipo_servicio||"").toUpperCase().includes("TRONCAL")?"TRONCAL":"ULTIMA_MILLA",document.getElementById("transport-modal-title").textContent="Editar Transportista",["t-rut","t-codigosap"].forEach(b=>{const x=document.getElementById(b);x.disabled=!1,x.className="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary rounded bg-white"}),["t-rut-lock-msg"].forEach(b=>document.getElementById(b)?.classList.add("hidden")),["t-patente"].forEach(b=>{const x=document.getElementById(b);x.disabled=!0,x.className="w-full border border-outline-variant p-sm font-body-md text-body-md rounded bg-[#E9ECEF] text-secondary cursor-not-allowed"}),["t-patente-lock-msg"].forEach(b=>{const x=document.getElementById(b);x&&(x.classList.remove("hidden"),x.classList.add("flex"))});const m=document.getElementById("t-id-interno"),M=document.getElementById("t-id-interno-val");if(m&&M){const b=o.codigoSap&&String(o.codigoSap).trim()!==String(o.id).trim();M.textContent=`ID interno: ${o.id}`,m.classList.toggle("hidden",!b),m.classList.toggle("flex",!!b)}i.classList.remove("pointer-events-none","opacity-0"),i.querySelector(".modal-window").classList.remove("scale-95")}else{const o=(u.troncales||[]).find(m=>m.id===h);if(!o)return;const i=re(u);ne(o,i,u,()=>N(document.getElementById("stage-area")))}})}),g.querySelectorAll(".btn-toggle").forEach(a=>{a.addEventListener("click",s=>{const h=s.currentTarget.dataset.id,w=s.currentTarget.dataset.src,u=_(),i=((w==="transports"?u.transports:u.troncales)||[]).find(m=>m.id===h);i&&(i.activo=i.activo===!1,F(u,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),p(`${i.razonSocial} ${i.activo?"activado":"dado de baja"}.`),N(document.getElementById("stage-area")))})})}function ve(e){}export{ae as faltantesTransportista,N as renderTransportsView};
