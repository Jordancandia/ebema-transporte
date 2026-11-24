import{getDatabase as $t,saveDatabase as z,getCentreName as Se,getTariffConfig as _t,getClientTariffConfig as ae,truckCapKg as ee,getOrigenGroups as q,getGroupRepId as Qe,buildTruckTypes as wt,TRUCK_BASE_TYPES as jt,loadHistoricoFlete360 as ve,deleteRow as et}from"./data.js?v=6ce8cb5f60";import{CAP_LIST as pe,calcularMatrizCostos as tt,calcularCostoRuta as St}from"./tarifas-engine.js?v=be2617cfd2";import{formatCLP as O,parseCSV as Ve,showAlert as P,toCSV as Ae,downloadFile as Ie,escapeHtml as T}from"./utils.js";import{supabase as At}from"./supabase-client.js?v=fd17fd7d20";import{getField as H}from"./zonas-transporte.js?v=8932f1b354";import{renderZcapView as at,calcZcapRow as st}from"./zcap.js?v=95bd902f96";import{can as ot}from"./permisos.js?v=a8b193e9fb";import{renderPeajesV2 as Be,setPeajesTab as rt,renderCombustiblesV2 as It,renderSegurosV2 as Tt,renderCostosExtrasV2 as Rt,renderVariablesV2 as Nt,renderMotorV2 as Lt}from"./tarifas-insumos.js?v=8a4daee33d";import{esc as U,fmt as re,clp as ye,numIn as Mt,wireNumIns as Pt,rerenderKeepFocus as nt,debounce as kt,chainHtml as Ot,wireChain as zt,changesBarHtml as Dt,wireChangesBar as Vt,textoImpacto as Bt,setParamPill as Kt,usuarioSesion as it}from"./tarifas-ui.js?v=19c87cf278";import{confirmar as Te}from"./confirmar.js?v=84d7f13f40";import{cargarVigente as Ut,vigenteCache as lt,onVigente as Ft,asegurarVigente as Ke,avisoCamionesHtml as Gt,wireAvisoCamiones as qt,valorParam as ct,ultimaActualizacion as Ht,fechaHora as Re,usuarioCorto as Zt,estilosVigente as Jt}from"./tarifa-vigente.js?v=5a531f4990";window.addEventListener("db_sync_error",a=>{const e=a.detail||"Error desconocido";typeof P=="function"&&P("Error al guardar en servidor: "+e+". Los cambios están guardados localmente pero podrían perderse al recargar.","error")});let J="peajes";function Na(a){J=a}let La="",Ee="",ue="",te=!1,ne=!1,Ne="",be="",ie=!1,fe=!1,Ma="",Pa="",ka="",se="regional",B=new Set,le="",Ce="",F=0,Oa="",za="",Da="",Va="",Ba=0,Ka=0;const Le=50;function Xt(a,e,s,d,r){if(a<=s)return"";const i=Math.ceil(a/s),l=e*s+1,b=Math.min((e+1)*s,a),m=e===0?"disabled opacity-40 cursor-default":"hover:bg-surface-container-high cursor-pointer",c=e>=i-1?"disabled opacity-40 cursor-default":"hover:bg-surface-container-high cursor-pointer";return`<div class="flex items-center justify-between mt-sm pt-sm border-t border-outline-variant text-[12px] text-secondary">
    <span>${l.toLocaleString("es-CL")}–${b.toLocaleString("es-CL")} de ${a.toLocaleString("es-CL")} filas</span>
    <div class="flex items-center gap-xs">
      <button id="${d}" class="px-sm py-xs border border-outline-variant rounded ${m}" ${e===0?"disabled":""}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_left</span>
      </button>
      <span class="px-sm">Pág. ${e+1} / ${i}</span>
      <button id="${r}" class="px-sm py-xs border border-outline-variant rounded ${c}" ${e>=i-1?"disabled":""}>
        <span class="material-symbols-outlined text-[16px] align-middle">chevron_right</span>
      </button>
    </div>
  </div>`}function Wt(a,e,s){const d=e.split(".");let r=a;for(let i=0;i<d.length-1;i++)(typeof r[d[i]]!="object"||r[d[i]]===null)&&(r[d[i]]={}),r=r[d[i]];r[d[d.length-1]]=s}function Ua(a,e,s){const d=e.split(".");let r=a;for(const i of d){if(r==null)return s;r=r[i]}return r===void 0?s:r}const $e="w-full border border-[#CED4DA] p-xs font-data-mono text-data-mono text-right focus:border-primary focus:ring-0 transition-all bg-white rounded";function K(a,e,s=""){const d=Number(e??0),r=isNaN(d)?"0":d.toLocaleString("es-CL",{maximumFractionDigits:6});return`<input type="text" inputmode="decimal" class="${$e}" data-path="${a}" data-numeric="1" value="${r}" ${s}>`}function dt(a,e,s=""){return`<input type="date" class="${$e} text-left" data-path="${a}" value="${e||""}" ${s}>`}function Fa(a,e,s=""){return`<input type="text" class="${$e} text-left" data-path="${a}" value="${e||""}" ${s}>`}function pt(a,e,s){return`
    <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
      <table class="w-full zebra-table border-collapse">
        <thead>
          <tr class="bg-surface-container-high text-left border-b border-outline-variant">
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
            ${a.map(d=>`<th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">${d.nombre}</th>`).join("")}
          </tr>
        </thead>
        <tbody class="font-body-md text-body-md">
          ${pe.map(d=>`
            <tr class="border-b border-outline-variant">
              <td class="p-md font-bold font-data-mono text-data-mono">${d/1e3}.000 kg</td>
              ${a.map(r=>`<td class="p-sm w-28">${K(e(r.repId,d),s(r.repId,d))}</td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`}function Ue(a,e){const s=new FileReader;s.onload=d=>e(Ve(d.target.result)),s.readAsText(a,"UTF-8")}function ut(a){let e=Number(String(a).replace(/[^\d.]/g,""));return e?(e<=28&&(e=e*1e3),e):0}const Yt=["peajes","peajes-inter","concesiones"];function Qt(a){const e=$t(),s=_t(e),d=Yt.includes(J),r=["camiones","zcap","peajes","peajes-inter","concesiones","combustibles","seguros","costos-extras","variables","resultados","resultados-inter","variacion","reajuste"];if(Ke(e).catch(l=>console.warn("Tarifa vigente:",l.message||l)),r.includes(J)){a.innerHTML='<div id="tt-content"></div>';const l=document.getElementById("tt-content");switch(J){case"camiones":ht(l,e,s);break;case"zcap":at(l);break;case"variacion":import("./variacion-tarifa.js?v=3311efc36c").then(b=>b.renderVariacionTarifa(l)).catch(b=>{console.error(b),l.innerHTML=`<div class="sv-card" style="padding:32px;color:#b5000b">No se pudo cargar Variación Tarifa: ${T(b.message||String(b))}</div>`});break;case"reajuste":import("./reajuste-tarifa.js?v=81c5a8c1d4").then(b=>b.renderReajusteTarifa(l)).catch(b=>{console.error(b),l.innerHTML=`<div class="sv-card" style="padding:32px;color:#b5000b">No se pudo cargar Reajuste Polinómico: ${T(b.message||String(b))}</div>`});break;case"peajes":Be(l,e,s);break;case"peajes-inter":rt("inter"),Be(l,e,s);break;case"concesiones":rt("conc"),Be(l,e,s);break;case"combustibles":It(l,e,s);break;case"seguros":Tt(l,e,s);break;case"costos-extras":Rt(l,e,s);break;case"variables":Nt(l,e,s);break;default:Lt(l,e,s,{onActualizarPonderados:()=>ma(e,s)})}if(J==="camiones"||J==="resultados"){const b=J;ua(e,s).then(m=>{m&&J===b&&a.isConnected&&Qt(a)}).catch(m=>console.warn("Participación automática:",m.message||m))}return}a.innerHTML=`
    <div class="mb-xl">
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Administrador de Tarifas Transporte</h1>
      <p class="font-body-lg text-body-lg text-secondary">Gestione las variables operacionales y monetarias que alimentan el motor de costos (ZCAP) por ruta y tipo de camión.</p>
    </div>

    ${d?`
    <div class="flex gap-sm mb-lg border-b border-outline-variant pb-sm overflow-x-auto" id="tt-subtabs">
      ${Fe("peajes","toll","Peajes Regionales")}
      ${Fe("peajes-inter","alt_route","Peajes Interregionales")}
      ${Fe("concesiones","account_balance","Administrador de Concesiones")}
    </div>`:""}

    <div id="tt-content"></div>
  `,d&&document.querySelectorAll(".tt-subtab").forEach(l=>{l.addEventListener("click",()=>{J=l.dataset.sub,i()})}),i();function i(){document.querySelectorAll(".tt-subtab").forEach(b=>{b.className=b.dataset.sub===J?"tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-primary text-white cursor-pointer whitespace-nowrap":"tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary hover:text-primary cursor-pointer whitespace-nowrap"});const l=document.getElementById("tt-content");switch(J){case"peajes":sa(l,e,s);break;case"peajes-inter":ge(l,e,s);break;case"concesiones":aa(l,e,s);break;case"camiones":ht(l,e,s);break;case"combustibles":We(l,e,s);break;case"seguros":yt(l,e,s);break;case"costos-extras":mt(l,e,s);break;case"participacion":ha(l,e,s);break;case"variables":Et(l,e,s);break;case"resultados":se="regional",F=0,X(l,e,s);break;case"resultados-inter":se="interregional",F=0,X(l,e,s);break;case"zcap":at(l);break}l._hasChangeListener||(l._hasChangeListener=!0,l.addEventListener("change",b=>{const m=b.target.dataset.path;if(!m)return;if(b.target.dataset.handled==="1"){delete b.target.dataset.handled;return}let c=b.target.value;b.target.type==="number"?c=c===""?0:Number(c):b.target.dataset.numeric&&(c=c===""?0:Number(String(c).replace(/\./g,"").replace(",",".")),isNaN(c)&&(c=0)),Wt(s,m,c),z(e)}))}}const ea=["BARCAZA","TRAVESÍA","ACARREO","PEAJE ESPECIAL","PERNOCTE","ESCOLTA","DESCARRILAMIENTO","FLETE ESPECIAL"],ta={2:"2 Ejes (5 y 10 Ton)",3:"3 Ejes (15 y 28 Ton)"};function mt(a,e,s){const d=q(e),r=(e.routes||[]).filter(n=>n.activo);e.extraCosts=e.extraCosts||[];const i=new Map((e.transportZones||[]).map(n=>[n.zona,n]));let l=window._ceFiltroCentro||"",b=window._ceFiltroBuscar||"",m=window._ceFiltroEjes||"";function c(n){let f=r.filter(p=>p.id_zona_transporte);if(n){const p=d.find(u=>u.grupo===n),h=p?p.centroIds:[];f=f.filter(u=>h.includes(u.origenId)||u.origen_grupo===n)}const t=new Set;return f.filter(p=>t.has(p.id_zona_transporte)?!1:(t.add(p.id_zona_transporte),!0)).map(p=>{const h=i.get(p.id_zona_transporte);return{id:p.id_zona_transporte,label:h&&(h.denominacion||h.comuna)||p.id_zona_transporte}}).sort((p,h)=>p.label.localeCompare(h.label))}function E(n){const f=i.get(n);return f&&(f.denominacion||f.comuna)||n}function C(){let n=e.extraCosts.filter(f=>f.activo!==!1);if(l){const f=new Set(c(l).map(t=>t.id));n=n.filter(t=>f.has(t.zona_id))}if(m&&(n=n.filter(f=>Number(f.ejes)===Number(m))),b){const f=b.toLowerCase();n=n.filter(t=>E(t.zona_id).toLowerCase().includes(f)||t.zona_id?.toLowerCase().includes(f))}return n}function x(){window._ceFiltroCentro=l,window._ceFiltroBuscar=b,window._ceFiltroEjes=m,mt(a,e,s)}const y=C(),v=e.extraCosts.filter(n=>n.activo!==!1).length,$=[...new Set(e.extraCosts.filter(n=>n.activo!==!1).map(n=>n.zona_id))].length,_=y.reduce((n,f)=>n+(Number(f.costo_ida)||0)+(Number(f.costo_vuelta)||0),0),L=d.map(n=>({id:n.grupo,nombre:n.nombre}));a.innerHTML=`
    <datalist id="ce-items-list">
      ${ea.map(n=>`<option value="${T(n)}">`).join("")}
    </datalist>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">add_circle</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Costos Extras por Zona de Transporte</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Ítems de costo adicionales por <b>zona de transporte</b> y tipo de eje (BARCAZA, TRAVESÍA, escolta, etc.).
        Se aplican automáticamente a <b>cualquier ruta</b> que tenga asignada esa zona, como ítem 1b en el motor ZCAP.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Ítems Registrados</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${v}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Zonas con Costos Extras</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${$}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Total Visible (Ida + Vuelta)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-primary">${O(_)}</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="ce-f-centro" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${L.map(n=>`<option value="${T(n.id)}" ${n.id===l?"selected":""}>${T(n.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">BUSCAR ZONA</label>
          <input id="ce-f-buscar" type="text" placeholder="Nombre o código de zona…" value="${T(b)}"
            class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">TIPO CAMIÓN</label>
          <select id="ce-f-ejes" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
            <option value="">Todos</option>
            <option value="2" ${m==="2"?"selected":""}>2 Ejes (5 y 10 Ton)</option>
            <option value="3" ${m==="3"?"selected":""}>3 Ejes (15 y 28 Ton)</option>
          </select>
        </div>
        <div class="flex-1"></div>
        <button id="ce-agregar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">add</span> Agregar Ítem
        </button>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Zona (ID)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Denominación</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ítem de Costo</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Costo Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Total</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${y.length===0?'<tr><td colspan="8" class="p-md text-center text-secondary">No hay costos extras registrados. Usa "Agregar Ítem" para crear uno.</td></tr>':y.map(n=>{const f=(Number(n.costo_ida)||0)+(Number(n.costo_vuelta)||0),t=E(n.zona_id);return`<tr class="border-b border-outline-variant">
                    <td class="p-md font-data-mono text-data-mono text-secondary">${T(n.zona_id||"—")}</td>
                    <td class="p-md font-bold">${T(t)}</td>
                    <td class="p-md">${ta[n.ejes]||n.ejes}</td>
                    <td class="p-md">
                      <span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[11px]">
                        ${T(n.item||"—")}
                      </span>
                    </td>
                    <td class="p-md text-right font-data-mono text-data-mono">${O(n.costo_ida)}</td>
                    <td class="p-md text-right font-data-mono text-data-mono">${O(n.costo_vuelta)}</td>
                    <td class="p-md text-right font-data-mono text-data-mono font-bold">${O(f)}</td>
                    <td class="p-md text-center flex items-center justify-center gap-sm">
                      <button class="ce-editar text-secondary hover:text-primary" data-ce-id="${T(n.id)}" title="Editar">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button class="ce-eliminar text-secondary hover:text-red-600" data-ce-id="${T(n.id)}" title="Eliminar">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>`}).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `,a.querySelector("#ce-f-centro")?.addEventListener("change",n=>{l=n.target.value,x()}),a.querySelector("#ce-f-ejes")?.addEventListener("change",n=>{m=n.target.value,x()}),a.querySelector("#ce-f-buscar")?.addEventListener("input",n=>{const f=n.target.selectionStart;b=n.target.value,x();const t=a.querySelector("#ce-f-buscar");t&&(t.focus(),t.setSelectionRange(f,f))}),a.querySelector("#ce-agregar")?.addEventListener("click",()=>o(null)),a.querySelectorAll(".ce-editar").forEach(n=>{n.addEventListener("click",()=>{const f=e.extraCosts.find(t=>t.id===n.dataset.ceId);f&&o(f)})}),a.querySelectorAll(".ce-eliminar").forEach(n=>{n.addEventListener("click",async()=>{if(!await Te("¿Eliminar este ítem de costo extra?"))return;const f=n.dataset.ceId;e.extraCosts=e.extraCosts.filter(t=>t.id!==f),z(e,{syncOnly:["extraCosts"]}),et("extraCosts",f).catch(t=>console.error("Error al borrar costo extra en Supabase:",t.message||t)),x()})});function o(n){const f=!n,t=c(""),p=document.createElement("div");p.className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md",p.innerHTML=`
      <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-lg">
        <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
          <span class="material-symbols-outlined text-primary">add_circle</span>
          <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">${f?"Agregar Ítem de Costo Extra":"Editar Ítem de Costo Extra"}</h3>
        </div>

        <div class="space-y-md">
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">ZONA DE TRANSPORTE</label>
            <select id="ce-m-zona" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
              <option value="">— Seleccionar zona —</option>
              ${t.map(h=>`<option value="${T(h.id)}" ${n&&n.zona_id===h.id?"selected":""}>${T(h.id)} — ${T(h.label)}</option>`).join("")}
            </select>
            <p class="text-[11px] text-secondary mt-xs">El costo se aplicará a <b>todas las rutas</b> que tengan asignada esta zona.</p>
          </div>
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">TIPO DE CAMIÓN</label>
            <select id="ce-m-ejes" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
              <option value="2" ${!n||Number(n.ejes)===2?"selected":""}>2 Ejes — 5 Ton y 10 Ton</option>
              <option value="3" ${n&&Number(n.ejes)===3?"selected":""}>3 Ejes — 15 Ton y 28 Ton</option>
            </select>
          </div>
          <div>
            <label class="font-label-caps text-label-caps text-secondary block mb-xs">ÍTEM DE COSTO</label>
            <input id="ce-m-item" list="ce-items-list" type="text" placeholder="Ej: BARCAZA, TRAVESÍA…"
              value="${T(n?n.item:"")}"
              class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md">
            <p class="text-[11px] text-secondary mt-xs">Puedes escribir cualquier etiqueta o elegir una sugerida.</p>
          </div>
          <div class="grid grid-cols-2 gap-md">
            <div>
              <label class="font-label-caps text-label-caps text-secondary block mb-xs">COSTO IDA (CLP)</label>
              <input id="ce-m-ida" type="number" min="0" step="1000"
                value="${n&&n.costo_ida||0}"
                class="w-full border border-[#CED4DA] p-sm font-data-mono text-data-mono">
            </div>
            <div>
              <label class="font-label-caps text-label-caps text-secondary block mb-xs">COSTO VUELTA (CLP)</label>
              <input id="ce-m-vuelta" type="number" min="0" step="1000"
                value="${n&&n.costo_vuelta||0}"
                class="w-full border border-[#CED4DA] p-sm font-data-mono text-data-mono">
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-sm mt-lg">
          <button id="ce-m-cancel" class="px-md py-sm rounded border border-outline text-secondary font-bold text-[12px] uppercase">Cancelar</button>
          <button id="ce-m-save" class="px-md py-sm rounded bg-primary text-white font-bold text-[12px] uppercase">Guardar</button>
        </div>
      </div>
    `,document.body.appendChild(p),p.querySelector("#ce-m-cancel").addEventListener("click",()=>p.remove()),p.querySelector("#ce-m-save").addEventListener("click",()=>{const h=p.querySelector("#ce-m-zona").value.trim(),u=Number(p.querySelector("#ce-m-ejes").value),g=p.querySelector("#ce-m-item").value.trim().toUpperCase(),w=Number(p.querySelector("#ce-m-ida").value)||0,j=Number(p.querySelector("#ce-m-vuelta").value)||0;if(!h){alert("Selecciona una zona de transporte.");return}if(!g){alert("Ingresa un ítem de costo (ej: BARCAZA).");return}const S=new Date().toISOString();f?e.extraCosts.push({id:`ce_${h}_${u}_${Date.now()}`,zona_id:h,ejes:u,item:g,costo_ida:w,costo_vuelta:j,activo:!0,created_at:S,updated_at:S}):Object.assign(n,{zona_id:h,ejes:u,item:g,costo_ida:w,costo_vuelta:j,updated_at:S}),z(e),p.remove(),x()})}}function Fe(a,e,s){return`<button class="tt-subtab flex items-center gap-xs px-md py-sm rounded-lg font-bold text-[12px] uppercase tracking-wide bg-surface-container-high text-secondary cursor-pointer whitespace-nowrap" data-sub="${a}">
    <span class="material-symbols-outlined text-[16px]">${e}</span> ${s}
  </button>`}const Ge={2:"2 Ejes (5 y 10 Ton)",3:"3 Ejes (15 y 28 Ton)"},xe=500;function Me(a,e,s){return(a.routeTolls||[]).find(d=>d.route_id===e&&Number(d.ejes)===s)}function Pe(a,e,s,d){return`<input type="number" step="any" class="${$e}" data-toll-route="${a}" data-toll-ejes="${e}" data-toll-field="${s}" value="${d??0}">`}const qe=[{nombre:"COPSA",ruta:"Ruta 5 Norte",tramo:"Los Vilos – La Serena",region:"Coquimbo",tipo:"Autopista",activa:!0},{nombre:"COVICORVI",ruta:"Ruta 5 Norte",tramo:"La Serena – Vallenar",region:"Atacama",tipo:"Autopista",activa:!0},{nombre:"Nuevo Camino",ruta:"Ruta 5 Norte",tramo:"Vallenar – Caldera",region:"Atacama",tipo:"Autopista",activa:!0},{nombre:"Autopista del Itata",ruta:"Ruta 5 Sur",tramo:"Talca – Chillán",region:"Maule / Ñuble",tipo:"Autopista",activa:!0},{nombre:"Ruta del Maipo",ruta:"Ruta 5 Sur",tramo:"Chillán – Collipulli",region:"Ñuble / La Araucanía",tipo:"Autopista",activa:!0},{nombre:"COVISUR",ruta:"Ruta 5 Sur",tramo:"Collipulli – Temuco",region:"La Araucanía",tipo:"Autopista",activa:!0},{nombre:"Ruta de la Araucanía",ruta:"Ruta 5 Sur",tramo:"Temuco – Río Bueno",region:"La Araucanía / Los Ríos",tipo:"Autopista",activa:!0},{nombre:"Ruta de los Ríos",ruta:"Ruta 5 Sur",tramo:"Río Bueno – Puerto Montt",region:"Los Ríos / Los Lagos",tipo:"Autopista",activa:!0},{nombre:"Autopista Central",ruta:"Ruta 5 / Norte-Sur",tramo:"Autopista Urbana Norte-Sur",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Costanera Norte",ruta:"Ruta 78",tramo:"Costanera Norte expreso",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Vespucio Norte Express",ruta:"Américo Vespucio Norte",tramo:"Avenida Las Rejas – El Salto",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Américo Vespucio Sur Express",ruta:"Américo Vespucio Sur",tramo:"Lo Ovalle – Príncipe de Gales",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Autopista Vespucio Oriente",ruta:"Américo Vespucio Oriente",tramo:"Las Vizcachas – El Salto",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Túnel San Cristóbal",ruta:"Ruta Sin Número",tramo:"Providencia – Recoleta",region:"Región Metropolitana",tipo:"Túnel",activa:!0},{nombre:"Acceso Nororiente",ruta:"Ruta G-21",tramo:"Príncipe de Gales – Av. El Golf",region:"Región Metropolitana",tipo:"Urbana TAG",activa:!0},{nombre:"Rutas del Pacífico",ruta:"Ruta 68",tramo:"Santiago – Valparaíso / Viña",region:"Valparaíso",tipo:"Autopista",activa:!0},{nombre:"Litoral Central",ruta:"Ruta 68",tramo:"Casablanca – Larapinta",region:"Valparaíso",tipo:"Autopista",activa:!0},{nombre:"Autopista Los Libertadores",ruta:"Ruta 57 CH",tramo:"Santiago – Los Andes",region:"Valparaíso",tipo:"Autopista",activa:!0},{nombre:"Túnel El Melón",ruta:"Ruta 60 CH",tramo:"Nogales – Calera (Túnel)",region:"Valparaíso",tipo:"Túnel",activa:!0},{nombre:"Autopista del Sol",ruta:"Ruta 78",tramo:"Santiago – San Antonio",region:"Región Metropolitana",tipo:"Autopista",activa:!0},{nombre:"Variante Melipilla",ruta:"Ruta 78",tramo:"Santiago – Melipilla",region:"Región Metropolitana",tipo:"Autopista",activa:!0}];function aa(a,e,s){s.concesionesVariacion=s.concesionesVariacion||{};const d=[...new Set(qe.map(E=>E.region))];let r="",i="",l="",b={};function m(E){return new Set((s.peajes||[]).filter(C=>C.concesionaria===E).map(C=>C.rutaId)).size}function c(){let E=qe.filter(v=>{if(r&&v.region!==r||i&&v.tipo!==i)return!1;if(l){const $=l.toLowerCase();if(!v.nombre.toLowerCase().includes($)&&!v.tramo.toLowerCase().includes($)&&!v.ruta.toLowerCase().includes($))return!1}return!0});const C=[...new Set(qe.map(v=>v.tipo))],x=v=>v==="Urbana TAG"?'<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">TAG</span>':v==="Túnel"?'<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">TÚNEL</span>':'<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">AUTOPISTA</span>',y=Object.keys(s.concesionesVariacion).some(v=>s.concesionesVariacion[v]);a.innerHTML=`
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary">account_balance</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Administrador de Concesiones de Peajes — Chile</h2>
          </div>
          <button id="con-guardar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
            <span class="material-symbols-outlined text-[18px]">save</span> Guardar Variaciones
          </button>
        </div>

        <div class="flex items-start gap-md mb-md">
          <div class="flex-1">
            <p class="text-[12px] text-secondary">
              Concesionarias registradas manualmente. La columna <b>Variación Anual %</b> registra
              el aumento tarifario informado por cada concesión (Decreto MOP). Al guardar, el motor aplica
              el factor a los peajes manuales de las plazas asociadas.
            </p>
          </div>
          ${y?`
          <div class="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] p-sm rounded shrink-0">
            <span class="material-symbols-outlined text-[14px] align-middle">info</span>
            Variaciones activas — afectan el Motor de Costo
          </div>`:""}
        </div>

        <div class="flex flex-wrap gap-md items-end mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">REGIÓN</label>
            <select id="con-f-region" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-56">
              <option value="">Todas</option>
              ${d.map(v=>`<option value="${T(v)}" ${r===v?"selected":""}>${T(v)}</option>`).join("")}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">TIPO</label>
            <select id="con-f-tipo" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-40">
              <option value="">Todos</option>
              ${C.map(v=>`<option value="${T(v)}" ${i===v?"selected":""}>${T(v)}</option>`).join("")}
            </select>
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">BUSCAR</label>
            <input id="con-f-buscar" type="text" placeholder="Nombre, ruta o tramo..."
              value="${T(l)}"
              class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
          </div>
        </div>

        <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
          <table class="w-full border-collapse text-[12px]">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Concesionaria</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tramo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Región</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rutas c/Peaje</th>
                <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center" style="min-width:140px">Variación Anual %</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md">
              ${E.length===0?'<tr><td colspan="7" class="p-md text-center text-secondary">Sin resultados para los filtros seleccionados.</td></tr>':E.map((v,$)=>{const _=s.concesionesVariacion[v.nombre]??"",L=m(v.nombre),o=_!==""&&Number(_)!==0;return`
                  <tr class="border-b border-outline-variant ${$%2===0?"":"bg-surface-container-lowest"}">
                    <td class="p-md font-bold text-on-surface">${T(v.nombre)}</td>
                    <td class="p-md font-data-mono text-data-mono text-secondary">${T(v.ruta)}</td>
                    <td class="p-md">${T(v.tramo)}</td>
                    <td class="p-md text-secondary">${T(v.region)}</td>
                    <td class="p-md">${x(v.tipo)}</td>
                    <td class="p-md text-right">
                      ${L>0?`<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-secondary">${L}</span>`:'<span class="text-secondary">—</span>'}
                    </td>
                    <td class="p-md text-center">
                      <div class="flex items-center justify-center gap-xs">
                        <input
                          type="number" step="0.1" min="0" max="100"
                          placeholder="0.0"
                          value="${T(String(_))}"
                          data-nombre="${T(v.nombre)}"
                          class="con-var-input border border-[#CED4DA] p-xs font-data-mono text-data-mono bg-white w-20 text-right ${o?"border-amber-400 bg-amber-50":""}">
                        <span class="text-secondary font-bold">%</span>
                        ${o?`<span class="inline-flex px-1 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">+${Number(_).toFixed(1)}%</span>`:""}
                      </div>
                    </td>
                  </tr>`}).join("")}
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-secondary mt-sm">
          La variación se aplica a los <b>peajes manuales</b> registrados en la pestaña Peajes Regionales que tengan asignada la concesionaria.
        </p>
      </div>
    `,a.querySelector("#con-f-region")?.addEventListener("change",v=>{r=v.target.value,c()}),a.querySelector("#con-f-tipo")?.addEventListener("change",v=>{i=v.target.value,c()}),a.querySelector("#con-f-buscar")?.addEventListener("input",v=>{const $=v.target.selectionStart;l=v.target.value,c();const _=a.querySelector("#con-f-buscar");_&&(_.focus(),_.setSelectionRange($,$))}),a.querySelectorAll(".con-var-input").forEach(v=>{v.addEventListener("change",$=>{b[$.target.dataset.nombre]=$.target.value===""?null:Number($.target.value)})}),a.querySelector("#con-guardar")?.addEventListener("click",()=>{a.querySelectorAll(".con-var-input").forEach(v=>{b[v.dataset.nombre]=v.value===""?null:Number(v.value)}),Object.entries(b).forEach(([v,$])=>{$===null||$===0?delete s.concesionesVariacion[v]:s.concesionesVariacion[v]=$}),b={},z(e),P("✓ Variaciones de concesiones guardadas"),c()})}c()}function sa(a,e,s){oe(a,e,s)}function oe(a,e,s){const d=(e.routes||[]).filter(o=>o.activo&&o.clasificRuta==="Regional"&&(o.tipo||"").toUpperCase()==="COMUNA"),r=q(e),i=r.map(o=>({id:o.grupo,nombre:o.nombre})),l=new Map((e.transportZones||[]).map(o=>[o.zona,o])),b=ue?(()=>{const o=r.find(n=>n.grupo===ue);return o?d.filter(n=>n.origen_grupo?n.origen_grupo===o.grupo:o.centroIds.includes(n.origenId)):d})():d,m=[...new Map(b.map(o=>{const n=l.get(o.id_zona_transporte);return n?{id:n.zona,label:n.denominacion||n.zona}:null}).filter(Boolean).map(o=>[o.id,o])).values()].sort((o,n)=>o.label.localeCompare(n.label));let c=[];if(d.forEach(o=>{[2,3].forEach(n=>{c.push({ruta:o,ejes:n,toll:Me(e,o.id,n)})})}),Ee&&(c=c.filter(o=>o.ruta.id_zona_transporte===Ee)),ue){const o=r.find(n=>n.grupo===ue);o&&(c=c.filter(n=>n.ruta.origen_grupo?n.ruta.origen_grupo===o.grupo:o.centroIds.includes(n.ruta.origenId)))}const E=c,C=[...new Set(E.map(o=>o.ruta.id))],x=E.filter(o=>!o.toll||!o.toll.calculado_en).length,y=E.filter(o=>o.toll&&o.toll.needs_review).length,v=C.length,$=E.length;ne?c=c.filter(o=>o.toll&&o.toll.needs_review):te&&(c=c.filter(o=>!o.toll||!o.toll.calculado_en));const _=c.length,L=c.slice(0,xe);a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">toll</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Peajes por Ruta — Cálculo Automático</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Costos de peaje para rutas Regionales con zona Comuna. KM mostrado es de ida (un solo sentido).
        El cálculo se ejecuta a demanda y queda registrado en cache para no repetirse.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-md mb-md">
        <button id="pj-kpi-todas" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${!te&&!ne?"ring-2 ring-primary":""}">
          <p class="font-label-caps text-label-caps text-secondary">Rutas Registradas</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${v}</p>
        </button>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Combinaciones (Ruta × Tipo Camión)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${$}</p>
        </div>
        <button id="pj-kpi-pendientes" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${te?"ring-2 ring-primary":""}">
          <p class="font-label-caps text-label-caps text-secondary">Sin Calcular</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${x}</p>
        </button>
        <button id="pj-kpi-revision" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${ne?"ring-2 ring-primary":""}">
          <p class="font-label-caps text-label-caps text-secondary">Para Revisión</p>
          <p class="font-headline-sm text-headline-sm font-bold ${y>0?"text-primary":"text-on-surface"}">${y}</p>
        </button>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
          <select id="pj-f-comuna" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
            <option value="">Todas</option>
            ${m.map(o=>`<option value="${T(o.id)}" ${o.id===Ee?"selected":""}>${T(o.label)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="pj-f-origen" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${i.map(o=>`<option value="${T(o.id)}" ${o.id===ue?"selected":""}>${T(o.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary flex items-center gap-xs cursor-pointer">
            <input type="checkbox" id="pj-f-pend" ${te?"checked":""}> SOLO PENDIENTES / REVISIÓN
          </label>
        </div>
        <div class="flex-1"></div>
        <button id="pj-export" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">download</span> Exportar CSV
        </button>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Origen</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${L.length===0?'<tr><td colspan="8" class="p-md text-center text-secondary">No hay rutas que coincidan con los filtros.</td></tr>':L.map(({ruta:o,ejes:n,toll:f})=>{const t=r.find(j=>j.grupo===o.origen_grupo)||r.find(j=>j.centroIds.includes(o.origenId)),p=t?t.nombre:Se(e,o.origenId)||"",h=o.km!=null?o.km.toFixed(1)+" KM":"—";let u;return!f||!f.calculado_en?u='<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN CALCULAR</span>':f.notFound||f.not_found?u='<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 text-amber-800 font-label-caps text-[10px]" title="Destino no encontrado — ajustar coordenadas de la ruta"><span class="material-symbols-outlined text-[14px]">location_off</span> REVISIÓN</span>':f.needs_review?u='<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">error</span> ERROR</span>':u='<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">PEAJE CALCULADO</span>',`<tr class="${f&&(f.notFound||f.not_found)?"border-b border-outline-variant bg-amber-50":f&&f.needs_review?"border-b border-outline-variant bg-red-50":"border-b border-outline-variant"}">
                  <td class="p-md font-bold">${T(o.codigo||"")}</td>
                  <td class="p-md">${T(p)}</td>
                  <td class="p-md">${T(o.destino||"")}</td>
                  <td class="p-md">${Ge[n]}</td>
                  <td class="p-md w-32">
                    ${Pe(o.id,n,"peaje_ida",f?f.peaje_ida:0)}
                    ${f&&(f.mainline_ida||f.ramp_ida||f.electronic_ida)?`<div class="text-[10px] text-secondary mt-1 leading-tight">
                      ${f.mainline_ida?`<span title="Troncal">T:${O(f.mainline_ida)}</span> `:""}${f.ramp_ida?`<span title="Lateral">L:${O(f.ramp_ida)}</span> `:""}${f.electronic_ida?`<span title="TAG">E:${O(f.electronic_ida)}</span>`:""}
                    </div>`:""}
                  </td>
                  <td class="p-md w-32">
                    ${Pe(o.id,n,"peaje_vuelta",f?f.peaje_vuelta:0)}
                    ${f&&(f.mainline_vuelta||f.ramp_vuelta||f.electronic_vuelta)?`<div class="text-[10px] text-secondary mt-1 leading-tight">
                      ${f.mainline_vuelta?`<span title="Troncal">T:${O(f.mainline_vuelta)}</span> `:""}${f.ramp_vuelta?`<span title="Lateral">L:${O(f.ramp_vuelta)}</span> `:""}${f.electronic_vuelta?`<span title="TAG">E:${O(f.electronic_vuelta)}</span>`:""}
                    </div>`:""}
                  </td>
                  <td class="p-md text-right font-data-mono text-data-mono">${h}</td>
                  <td class="p-md text-center">${u}</td>
                </tr>`}).join("")}
          </tbody>
        </table>
      </div>
      ${_>xe?`<p class="text-[11px] text-secondary mt-sm">Mostrando ${xe} de ${_} resultados. Use los filtros para acotar la búsqueda.</p>`:""}
    </div>
  `,a.querySelectorAll("[data-toll-route]").forEach(o=>{o.addEventListener("change",n=>{const f=n.target.dataset.tollRoute,t=Number(n.target.dataset.tollEjes),p=n.target.dataset.tollField,h=n.target.value===""?0:Number(n.target.value);let u=Me(e,f,t);u||(u={id:`tj_${f}_${t}`,route_id:f,ejes:t,peaje_ida:0,peaje_vuelta:0,needs_review:!1,calculado_en:new Date().toISOString()},e.routeTolls=e.routeTolls||[],e.routeTolls.push(u)),u[p]=h,u.needs_review=!1,u.updated_at=new Date().toISOString(),z(e)})}),document.getElementById("pj-f-comuna").addEventListener("change",o=>{Ee=o.target.value,oe(a,e,s)}),document.getElementById("pj-f-origen").addEventListener("change",o=>{ue=o.target.value,oe(a,e,s)}),document.getElementById("pj-f-pend").addEventListener("change",o=>{te=o.target.checked,oe(a,e,s)}),document.getElementById("pj-kpi-todas").addEventListener("click",()=>{te=!1,ne=!1,Ee="",ue="",oe(a,e,s)}),document.getElementById("pj-kpi-pendientes").addEventListener("click",()=>{te=!te,te&&(ne=!1),oe(a,e,s)}),document.getElementById("pj-kpi-revision").addEventListener("click",()=>{ne=!ne,ne&&(te=!1),oe(a,e,s)}),document.getElementById("pj-export").addEventListener("click",()=>ra(e,c))}function ge(a,e,s){const d=(e.routes||[]).filter(o=>o.activo&&o.clasificRuta==="Interregional"&&(o.tipo||"").toUpperCase()==="COMUNA"),r=q(e),i=r.map(o=>({id:o.grupo,nombre:o.nombre})),l=new Map((e.transportZones||[]).map(o=>[o.zona,o])),b=be?(()=>{const o=r.find(n=>n.grupo===be);return o?d.filter(n=>n.origen_grupo?n.origen_grupo===o.grupo:o.centroIds.includes(n.origenId)):d})():d,m=[...new Map(b.map(o=>{const n=l.get(o.id_zona_transporte);return n?{id:n.zona,label:n.denominacion||n.zona}:null}).filter(Boolean).map(o=>[o.id,o])).values()].sort((o,n)=>o.label.localeCompare(n.label));let c=[];if(d.forEach(o=>{[2,3].forEach(n=>{c.push({ruta:o,ejes:n,toll:Me(e,o.id,n)})})}),Ne&&(c=c.filter(o=>o.ruta.id_zona_transporte===Ne)),be){const o=r.find(n=>n.grupo===be);o&&(c=c.filter(n=>n.ruta.origen_grupo?n.ruta.origen_grupo===o.grupo:o.centroIds.includes(n.ruta.origenId)))}const E=c,C=[...new Set(E.map(o=>o.ruta.id))],x=E.filter(o=>!o.toll||!o.toll.calculado_en).length,y=E.filter(o=>o.toll&&o.toll.needs_review).length,v=C.length,$=E.length;fe?c=c.filter(o=>o.toll&&o.toll.needs_review):ie&&(c=c.filter(o=>!o.toll||!o.toll.calculado_en));const _=c.length,L=c.slice(0,xe);a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">alt_route</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Peajes Interregionales</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">
        Costos de peaje para rutas Interregionales + Comuna. KM mostrado es de ida (un solo sentido).
        El cálculo se ejecuta a demanda y queda registrado en cache para no repetirse.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-md mb-md">
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Rutas Registradas</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${v}</p>
        </div>
        <div class="bg-surface-container-low p-md rounded">
          <p class="font-label-caps text-label-caps text-secondary">Combinaciones (Ruta × Tipo Camión)</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${$}</p>
        </div>
        <button id="pji-kpi-pendientes" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${ie?"ring-2 ring-primary":""}">
          <p class="font-label-caps text-label-caps text-secondary">Sin Calcular</p>
          <p class="font-headline-sm text-headline-sm font-bold text-on-surface">${x}</p>
        </button>
        <button id="pji-kpi-revision" class="bg-surface-container-low p-md rounded text-left hover:bg-secondary-container transition-colors ${fe?"ring-2 ring-primary":""}">
          <p class="font-label-caps text-label-caps text-secondary">Para Revisión</p>
          <p class="font-headline-sm text-headline-sm font-bold ${y>0?"text-primary":"text-on-surface"}">${y}</p>
        </button>
      </div>

      <div class="flex flex-wrap gap-sm items-end mb-md">
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">COMUNA</label>
          <select id="pji-f-comuna" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
            <option value="">Todas</option>
            ${m.map(o=>`<option value="${T(o.id)}" ${o.id===Ne?"selected":""}>${T(o.label)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CENTRO ORIGEN</label>
          <select id="pji-f-origen" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-48">
            <option value="">Todos</option>
            ${i.map(o=>`<option value="${T(o.id)}" ${o.id===be?"selected":""}>${T(o.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary flex items-center gap-xs cursor-pointer">
            <input type="checkbox" id="pji-f-pend" ${ie?"checked":""}> SOLO PENDIENTES / REVISIÓN
          </label>
        </div>
        <div class="flex-1"></div>
      </div>

      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Origen</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Destino</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Ida</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Peaje Vuelta</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">KM</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${L.length===0?'<tr><td colspan="8" class="p-md text-center text-secondary">No hay rutas interregionales que coincidan con los filtros.</td></tr>':L.map(({ruta:o,ejes:n,toll:f})=>{const t=r.find(j=>j.grupo===o.origen_grupo)||r.find(j=>j.centroIds.includes(o.origenId)),p=t?t.nombre:Se(e,o.origenId)||"",h=o.km!=null?o.km.toFixed(1)+" KM":"—";let u;return!f||!f.calculado_en?u='<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN CALCULAR</span>':f.notFound||f.not_found?u='<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 text-amber-800 font-label-caps text-[10px]" title="Destino no encontrado — ajustar coordenadas de la ruta"><span class="material-symbols-outlined text-[14px]">location_off</span> REVISIÓN</span>':f.needs_review?u='<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">error</span> ERROR</span>':u='<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">PEAJE CALCULADO</span>',`<tr class="${f&&(f.notFound||f.not_found)?"border-b border-outline-variant bg-amber-50":f&&f.needs_review?"border-b border-outline-variant bg-red-50":"border-b border-outline-variant"}">
                  <td class="p-md font-bold">${T(o.codigo||"")}</td>
                  <td class="p-md">${T(p)}</td>
                  <td class="p-md">${T(o.destino||"")}</td>
                  <td class="p-md">${Ge[n]}</td>
                  <td class="p-md w-32">${Pe(o.id,n,"peaje_ida",f?f.peaje_ida:0)}</td>
                  <td class="p-md w-32">${Pe(o.id,n,"peaje_vuelta",f?f.peaje_vuelta:0)}</td>
                  <td class="p-md text-right font-data-mono text-data-mono">${h}</td>
                  <td class="p-md text-center">${u}</td>
                </tr>`}).join("")}
          </tbody>
        </table>
      </div>
      ${_>xe?`<p class="text-[11px] text-secondary mt-sm">Mostrando ${xe} de ${_} resultados. Use los filtros para acotar la búsqueda.</p>`:""}
    </div>
  `,a.querySelectorAll("[data-toll-route]").forEach(o=>{o.addEventListener("change",n=>{const f=n.target.dataset.tollRoute,t=Number(n.target.dataset.tollEjes),p=n.target.dataset.tollField,h=n.target.value===""?0:Number(n.target.value);let u=Me(e,f,t);if(u||(u={id:`tj_${f}_${t}`,route_id:f,ejes:t,peaje_ida:0,peaje_vuelta:0,needs_review:!1,calculado_en:new Date().toISOString()},e.routeTolls=e.routeTolls||[],e.routeTolls.push(u)),u[p]=h,p==="peaje_ida"){u.peaje_vuelta=h;const g=a.querySelector(`[data-toll-route="${f}"][data-toll-ejes="${t}"][data-toll-field="peaje_vuelta"]`);g&&(g.value=h)}u.needs_review=!1,u.updated_at=new Date().toISOString(),z(e)})}),document.getElementById("pji-f-comuna").addEventListener("change",o=>{Ne=o.target.value,ge(a,e,s)}),document.getElementById("pji-f-origen").addEventListener("change",o=>{be=o.target.value,ge(a,e,s)}),document.getElementById("pji-f-pend").addEventListener("change",o=>{ie=o.target.checked,ge(a,e,s)}),document.getElementById("pji-kpi-pendientes").addEventListener("click",()=>{ie=!ie,ie&&(fe=!1),ge(a,e,s)}),document.getElementById("pji-kpi-revision").addEventListener("click",()=>{fe=!fe,fe&&(ie=!1),ge(a,e,s)})}const oa={2:["5T","10T"],3:["15T","28T"]};function ra(a,e){const s=q(a),d=["RUTA","ORIGEN","DESTINO","TIPO_CAMION","PEAJE_IDA","PEAJE_VUELTA"],r=[];for(const{ruta:i,ejes:l,toll:b}of e){const m=s.find(x=>x.grupo===i.origen_grupo)||s.find(x=>x.centroIds.includes(i.origenId)),c=m?m.nombre:Se(a,i.origenId)||"",E=b?Math.round(b.peaje_ida||0):0,C=b?Math.round(b.peaje_vuelta||0):0;for(const x of oa[l]||[Ge[l]])r.push([i.codigo,c,i.destino||"",x,E,C])}Ie(`peajes_rutas_${Date.now()}.csv`,Ae(d,r)),P("Archivo CSV de peajes exportado")}function Ga(a){const e=a.routeTolls||[];if(e.length===0){P("No hay datos en cache de API para exportar.","info");return}const s=["ROUTE_ID","EJES","PEAJE_IDA","PEAJE_VUELTA","KM_IDA","KM_VUELTA","NEEDS_REVIEW","CALCULADO_EN"],d=e.map(r=>[r.route_id,r.ejes,Math.round(r.peaje_ida||0),Math.round(r.peaje_vuelta||0),r.km_ida!=null?r.km_ida:"",r.km_vuelta!=null?r.km_vuelta:"",r.needs_review?1:0,r.calculado_en||""]);Ie(`route_tolls_cache_${Date.now()}.csv`,Ae(s,d)),P(`Cache API exportado: ${d.length} registros.`)}function qa(a,e){const s=new FileReader;s.onload=function(d){try{const r=new TextDecoder("utf-8").decode(d.target.result),i=Ve(r);if(i.length===0){P("El archivo CSV está vacío.","error");return}e.routeTolls=e.routeTolls||[];let l=0;i.forEach(b=>{const m=(H(b,"route_id","ROUTE_ID")||"").trim(),c=Number(H(b,"ejes","EJES"));if(!m||!c)return;let E=e.routeTolls.find(y=>y.route_id===m&&Number(y.ejes)===c);E||(E={id:`tj_${m}_${c}`,route_id:m,ejes:c,peaje_ida:0,peaje_vuelta:0,needs_review:!1},e.routeTolls.push(E)),E.peaje_ida=Number(H(b,"peaje_ida","PEAJE_IDA"))||0,E.peaje_vuelta=Number(H(b,"peaje_vuelta","PEAJE_VUELTA"))||0;const C=Number(H(b,"km_ida","KM_IDA")),x=Number(H(b,"km_vuelta","KM_VUELTA"));isNaN(C)||(E.km_ida=C),isNaN(x)||(E.km_vuelta=x),E.needs_review=Number(H(b,"needs_review","NEEDS_REVIEW"))===1,E.calculado_en=H(b,"calculado_en","CALCULADO_EN")||new Date().toISOString(),E.updated_at=new Date().toISOString(),l++}),z(e,{syncOnly:["routeTolls"]}),P(`Cache API importado: ${l} registros actualizados/insertados.`)}catch(r){P("Error al importar cache: "+(r.message||r),"error")}},s.readAsArrayBuffer(a)}function bt(a){return new Promise(e=>setTimeout(e,a))}async function ft(a,e,s,d){const{data:r,error:i}=await At.functions.invoke("google-distance",{body:{originLat:a,originLng:e,destLat:s,destLng:d}});if(i)throw i;if(r&&r.error)throw new Error(r.error);return r}function na(a,e,s,d,r){a.routeTolls=a.routeTolls||[];let i=a.routeTolls.find(b=>b.route_id===e&&Number(b.ejes)===s);i||(i={id:`tj_${e}_${s}`,route_id:e,ejes:s,peaje_ida:0,peaje_vuelta:0,needs_review:!1},a.routeTolls.push(i));const l=new Date().toISOString();return i.peaje_ida=Math.round(d||0),i.peaje_vuelta=Math.round(r||0),i.needs_review=!1,i.calculado_en=l,i.updated_at=l,i}function ia(a,e,s){const d=(a.transportZones||[]).find(c=>c.zona===s),r=a.routes||[],i=r.filter(c=>c.activo&&c.origenId===e&&c.id_zona_transporte===s);let l=[];if(d&&d.comuna){const c=(a.transportZones||[]).filter(E=>E.tipo==="Sector"&&E.comuna===d.comuna&&E.zona!==s).map(E=>E.zona);c.length&&(l=r.filter(E=>E.activo&&E.origenId===e&&c.includes(E.id_zona_transporte)))}const b=[...i,...l],m=new Set;return b.filter(c=>m.has(c.id)?!1:(m.add(c.id),!0))}function la(a){const e=(H(a,"id_centro_origen","centro_origen","id_centro","centro")||"").toString().trim(),s=(H(a,"id_zona_transporte","zona_transporte","id_zona","zona")||"").toString().trim(),d=Number((H(a,"eje","ejes")||"").toString().trim()),r=Number(H(a,"peaje_ida","valor_peaje_ida","peajeida"))||0,i=Number(H(a,"peaje_vuelta","valor_peaje_vuelta","peajevuelta"))||0;return{centroId:e,zonaId:s,ejes:d,peajeIda:r,peajeVuelta:i}}function ca(a){const e=["id_centro_origen","centro_origen","id_zona_transporte","comuna","eje","peaje_ida","peaje_vuelta"],s=new Map;(a.routes||[]).filter(r=>r.activo&&r.origenId&&r.id_zona_transporte).forEach(r=>{const i=(a.transportZones||[]).find(b=>b.zona===r.id_zona_transporte);if(i&&i.tipo==="Sector")return;const l=`${r.origenId}__${r.id_zona_transporte}`;s.has(l)||s.set(l,{centroId:r.origenId,zonaId:r.id_zona_transporte,comuna:r.comuna||(i?i.comuna:"")||""})});const d=[];s.forEach(r=>{[2,3].forEach(i=>{d.push([r.centroId,Se(a,r.centroId)||"",r.zonaId,r.comuna,i,0,0])})}),Ie(`plantilla_peajes_por_comuna_${Date.now()}.csv`,Ae(e,d)),P("Plantilla de carga masiva de peajes por comuna descargada")}function Ha(a,e,s){const d=document.createElement("div");d.className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md",d.innerHTML=`
    <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center gap-sm mb-md">
        <span class="material-symbols-outlined text-primary">upload_file</span>
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Carga Masiva de Peajes por Comuna</h3>
      </div>
      <p class="text-[12px] text-secondary mb-sm">
        Suba un CSV con el valor de peaje por <b>Centro de Origen + Zona de Transporte (comuna)</b> y tipo de eje.
        El valor se aplicará a todas las rutas activas de ese centro y comuna, incluyendo las rutas de tipo
        <b>Sector</b> que pertenezcan a la misma comuna.
      </p>
      <p class="text-[12px] text-secondary mb-md">
        Columnas requeridas: <code>id_centro_origen</code>, <code>id_zona_transporte</code>, <code>eje</code> (2 o 3),
        <code>peaje_ida</code>, <code>peaje_vuelta</code>.
      </p>
      <div class="flex flex-wrap gap-sm mb-md">
        <button id="pjc-plantilla" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase">
          <span class="material-symbols-outlined text-[18px]">download</span> Descargar Plantilla
        </button>
        <label class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase cursor-pointer">
          <span class="material-symbols-outlined text-[18px]">attach_file</span> Elegir Archivo CSV
          <input id="pjc-file" type="file" accept=".csv" class="hidden">
        </label>
      </div>
      <div id="pjc-preview"></div>
      <div class="flex justify-end gap-sm mt-md">
        <button id="pjc-cancel" class="bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded text-[12px] uppercase">Cerrar</button>
        <button id="pjc-importar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded text-[12px] uppercase opacity-50 cursor-not-allowed" disabled>Importar</button>
      </div>
    </div>`,document.body.appendChild(d);let r=[];d.querySelector("#pjc-cancel").addEventListener("click",()=>d.remove()),d.querySelector("#pjc-plantilla").addEventListener("click",()=>ca(e));function i(){const l=r.filter(c=>!c.error),b=l.reduce((c,E)=>c+E.rutas.length,0);d.querySelector("#pjc-preview").innerHTML=`
      <div class="border border-outline-variant rounded overflow-hidden overflow-x-auto max-h-64">
        <table class="w-full text-[12px] zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left">
              <th class="p-sm">Centro</th>
              <th class="p-sm">Zona / Comuna</th>
              <th class="p-sm text-center">Eje</th>
              <th class="p-sm text-right">Peaje Ida</th>
              <th class="p-sm text-right">Peaje Vuelta</th>
              <th class="p-sm text-center">Rutas Afectadas</th>
              <th class="p-sm">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${r.map(c=>`<tr class="${c.error?"bg-red-50":""}">
              <td class="p-sm">${T(c.centroNombre)}</td>
              <td class="p-sm">${T(c.zonaNombre)} <span class="text-secondary">(${T(c.zonaId)})</span></td>
              <td class="p-sm text-center">${c.ejes||"—"}</td>
              <td class="p-sm text-right">${O(c.peajeIda)}</td>
              <td class="p-sm text-right">${O(c.peajeVuelta)}</td>
              <td class="p-sm text-center">${c.error?"—":c.rutas.length}</td>
              <td class="p-sm">${c.error?`<span class="text-red-700">${T(c.error)}</span>`:'<span class="text-green-700">OK</span>'}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="text-[11px] text-secondary mt-sm">${l.length} de ${r.length} fila(s) válida(s) · ${b} registro(s) (ruta × eje) serán actualizados.</p>
    `;const m=d.querySelector("#pjc-importar");l.length>0?(m.disabled=!1,m.classList.remove("opacity-50","cursor-not-allowed")):(m.disabled=!0,m.classList.add("opacity-50","cursor-not-allowed"))}d.querySelector("#pjc-file").addEventListener("change",l=>{const b=l.target.files[0];if(!b)return;const m=new FileReader;m.onload=c=>{const E=c.target.result;let C=new TextDecoder("utf-8").decode(E);C.includes("�")&&(C=new TextDecoder("windows-1252").decode(E)),r=Ve(C).map(y=>{const{centroId:v,zonaId:$,ejes:_,peajeIda:L,peajeVuelta:o}=la(y),n=(e.logisticsCentres||[]).find(h=>h.id===v),f=(e.transportZones||[]).find(h=>h.zona===$);let t="";!v||!n?t="Centro origen no encontrado":!$||!f?t="Zona de transporte no encontrada":_!==2&&_!==3&&(t="Eje inválido (debe ser 2 o 3)");const p=t?[]:ia(e,v,$);return!t&&p.length===0&&(t="Sin rutas activas para este centro y comuna"),{centroId:v,zonaId:$,ejes:_,peajeIda:L,peajeVuelta:o,rutas:p,error:t,centroNombre:n?n.nombre:v||"—",zonaNombre:f?f.comuna||f.denominacion||$:$||"—"}}),i()},m.readAsArrayBuffer(b)}),d.querySelector("#pjc-importar").addEventListener("click",()=>{const l=r.filter(m=>!m.error);if(l.length===0)return;let b=0;l.forEach(m=>{m.rutas.forEach(c=>{na(e,c.id,m.ejes,m.peajeIda,m.peajeVuelta),b++})}),z(e,{syncOnly:["routeTolls"]}),d.remove(),P(`Carga masiva de peajes por comuna aplicada: ${b} registro(s) actualizado(s) en ${l.length} fila(s).`),oe(a,e,s)})}function da(a){const e=document.createElement("div");return e.className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center",e.innerHTML=`
    <div class="bg-white rounded-lg shadow-xl p-lg w-full max-w-md">
      <div class="flex items-center gap-sm mb-md">
        <span class="material-symbols-outlined text-primary">toll</span>
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Calculando Peajes…</h3>
      </div>
      <p id="ptj-status" class="text-[12px] text-secondary mb-sm break-all">Iniciando…</p>
      <div class="w-full bg-surface-container-high rounded-full h-3 overflow-hidden mb-sm">
        <div id="ptj-bar" class="bg-primary h-3 rounded-full transition-all" style="width:0%"></div>
      </div>
      <p id="ptj-count" class="text-[11px] text-secondary text-right mb-md">0 / ${a}</p>
      <button id="ptj-cancel" class="w-full bg-surface-container-high hover:bg-surface-container text-on-surface font-bold px-md py-sm rounded text-[12px] uppercase">Cancelar</button>
    </div>`,document.body.appendChild(e),{cancelBtn:e.querySelector("#ptj-cancel"),update(s,d,r){e.querySelector("#ptj-status").textContent=r,e.querySelector("#ptj-count").textContent=`${s} / ${d}`,e.querySelector("#ptj-bar").style.width=`${d>0?Math.round(s/d*100):0}%`},close(){e.remove()}}}async function Za(a,e,s,d){if(!d||d.length===0){P("No hay rutas para calcular KM","error");return}const r=d.filter(x=>!(e.routeTolls||[]).find(v=>v.route_id===x.id&&v.km_ida!=null)),i=r.filter(x=>x.lat!=null&&x.lon!=null),l=r.length-i.length,b=d.length-r.length;if(i.length===0){const x=b===d.length?"Todas las rutas seleccionadas ya tienen KM calculado (cache).":"No hay rutas con coordenadas para calcular KM.";P(x,"info");return}const m=b>0?`
${b} ruta(s) ya tienen KM y serán omitidas (cache).`:"",c=l>0?`
${l} ruta(s) sin coordenadas serán omitidas.`:"";if(!await Te(`Se calcularán KMs (vía Google Distance Matrix) para ${i.length} ruta(s).${m}${c}

¿Continuar?`))return;const E=da(i.length);let C=!1;E.cancelBtn.addEventListener("click",()=>{C=!0}),e.routeTolls=e.routeTolls||[];for(let x=0;x<i.length&&!C;x++){const y=i[x],$=(y.origen_grupo?(e.logisticsCentres||[]).find(_=>_.origen_grupo===y.origen_grupo&&_.lat!=null):null)||(e.logisticsCentres||[]).find(_=>_.id===y.origenId);if(E.update(x,i.length,`${y.codigo} — ${y.destino||""}`),!$||$.lat==null||$.lon==null){console.warn("Centro sin coordenadas para KM:",$?.id,$?.nombre);continue}try{const _=await ft($.lat,$.lon,y.lat,y.lon);await bt(300);const L=await ft(y.lat,y.lon,$.lat,$.lon);await bt(300),[2,3].forEach(o=>{let n=e.routeTolls.find(f=>f.route_id===y.id&&Number(f.ejes)===o);n||(n={id:`tj_${y.id}_${o}`,route_id:y.id,ejes:o,peaje_ida:0,peaje_vuelta:0,needs_review:!1},e.routeTolls.push(n)),n.km_ida=_?_.distanceKm:null,n.km_vuelta=L?L.distanceKm:null,n.updated_at=new Date().toISOString()})}catch(_){console.error("Error calculando KM para",y.codigo,_)}(x+1)%10===0&&z(e,{syncOnly:["routeTolls"]})}E.update(i.length,i.length,C?"Cancelado":"Finalizado"),z(e,{syncOnly:["routeTolls"]}),E.close(),P(C?"Cálculo de KM cancelado (avance guardado)":"Cálculo de KM finalizado"),oe(a,e,s)}function He(a,e,s){const d=e.routes;a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">edit_road</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Registro Manual de Plazas de Peaje (Respaldo)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Este registro detallado por plaza de peaje se usa como respaldo del Motor de Costo solo cuando una ruta no tiene un cálculo automático (sección anterior). Los cobros aquí son simétricos (Ida y Vuelta procesan el mismo valor). Mapeo fijo de ejes: 5.000 y 10.000 kg = 2 ejes · 15.000 y 28.000 kg = 3 ejes.</p>

      <form id="pj-form" class="grid grid-cols-1 md:grid-cols-6 gap-sm items-end mb-md">
        <div class="md:col-span-2 space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">RUTA</label>
          <select id="pj-ruta" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" required>
            ${d.map(r=>`<option value="${r.id}">${r.codigo} — ${r.destino}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">EJES</label>
          <select id="pj-ejes" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white">
            <option value="2">2 Ejes</option>
            <option value="3">3 Ejes</option>
          </select>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">CONCESIONARIA</label>
          <input id="pj-conc" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="Ej: Autopista Central" required>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">PLAZA DE PEAJE</label>
          <input id="pj-plaza" type="text" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="Ej: Pórtico Lampa" required>
        </div>
        <div class="space-y-xs">
          <label class="font-label-caps text-label-caps text-secondary block">VALOR PEAJE (CLP)</label>
          <div class="flex gap-xs">
            <input id="pj-valor" type="number" min="0" class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md bg-white" placeholder="0" required>
            <button type="submit" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded shrink-0">
              <span class="material-symbols-outlined text-[18px]">add</span>
            </button>
          </div>
        </div>
      </form>

      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_Origen, Comuna_Destino, Id_Ruta, Ejes, Concesionaria, Plaza_Peaje, Valor_Peaje</p>
        </div>
        <input type="file" id="pj-csv" accept=".csv" class="text-[12px]">
      </div>
    </div>

    <div class="bg-surface border border-outline-variant overflow-hidden rounded">
      <table class="w-full zebra-table border-collapse">
        <thead>
          <tr class="bg-surface-container-high text-left border-b border-outline-variant">
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ruta</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Ejes</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Concesionaria</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Plaza de Peaje</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor Ida</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor Vuelta</th>
            <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Acciones</th>
          </tr>
        </thead>
        <tbody class="font-body-md text-body-md">
          ${(s.peajes||[]).length===0?'<tr><td colspan="7" class="p-md text-center text-secondary">No hay peajes registrados.</td></tr>':s.peajes.map(r=>{const i=d.find(l=>l.id===r.rutaId);return`<tr class="border-b border-outline-variant">
                <td class="p-md">${i?`${i.codigo} — ${i.destino}`:"(ruta eliminada)"}</td>
                <td class="p-md font-data-mono text-data-mono">${r.ejes}</td>
                <td class="p-md">${r.concesionaria}</td>
                <td class="p-md">${r.plazaPeaje}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${O(r.valorPeaje)}</td>
                <td class="p-md text-right font-data-mono text-data-mono">${O(r.valorPeaje)}</td>
                <td class="p-md text-center">
                  <button class="pj-del text-secondary hover:text-primary" data-id="${r.id}" title="Eliminar">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </td>
              </tr>`}).join("")}
        </tbody>
      </table>
    </div>
  `,document.getElementById("pj-form").addEventListener("submit",r=>{r.preventDefault(),s.peajes=s.peajes||[],s.peajes.push({id:"pj"+Date.now(),rutaId:document.getElementById("pj-ruta").value,ejes:Number(document.getElementById("pj-ejes").value),concesionaria:document.getElementById("pj-conc").value.trim(),plazaPeaje:document.getElementById("pj-plaza").value.trim(),valorPeaje:Number(document.getElementById("pj-valor").value)||0}),z(e),P("Peaje agregado correctamente"),He(a,e,s)}),document.querySelectorAll(".pj-del").forEach(r=>{r.addEventListener("click",()=>{s.peajes=s.peajes.filter(i=>i.id!==r.dataset.id),z(e),He(a,e,s)})}),document.getElementById("pj-csv").addEventListener("change",r=>{const i=r.target.files[0];i&&Ue(i,l=>{let b=0;s.peajes=s.peajes||[],l.forEach(m=>{const c=(m.Id_Ruta||"").trim(),E=e.routes.find(C=>C.codigo.toLowerCase()===c.toLowerCase()||C.id===c);E&&(s.peajes.push({id:"pj"+Date.now()+Math.random().toString(16).slice(2),rutaId:E.id,ejes:Number(m.Ejes)||2,concesionaria:m.Concesionaria||"",plazaPeaje:m.Plaza_Peaje||"",valorPeaje:Number(m.Valor_Peaje)||0}),b++)}),z(e),P(`${b} peajes cargados desde CSV`),He(a,e,s)})})}function Ja(a,e,s){return`<input type="number" step="any" class="${$e}" data-truck-id="${a}" data-truck-field="${e}" value="${s??0}">`}function pa(a,e,s){const d=new Set([e,s]),r=a.filter(c=>d.has(c.ruta?.origen_grupo)),i=a.filter(c=>!d.has(c.ruta?.origen_grupo)),l=["km","item1_peajes","combIda","combVuelta","item3_soapKm","item4_seguroKm","item5_mantKm","item6_neumKm","item7_gpsKm","item8_choferBaseDiario","item9_varChofer","costoVuelta","item10_costoRutaTotal","item11_costoKmFinal","factorRuta"],b=new Map;r.forEach(c=>{const E=`${c.ruta.id_zona_transporte||c.ruta.destino||c.ruta.codigo}__${c.capKg||""}`;b.has(E)||b.set(E,[]),b.get(E).push(c)});const m=[...b.values()].map(c=>{if(c.length===1)return c[0];const E=c[0],C=y=>c.reduce((v,$)=>v+(Number($[y])||0),0)/c.length,x={...E};return l.forEach(y=>{x[y]=C(y)}),x.ruta={...E.ruta,origen_grupo:e,codigo:c.map(y=>y.ruta.codigo).join("/"),destino:E.ruta.destino,_allCodigos:c.map(y=>y.ruta.codigo),_allIds:c.map(y=>y.ruta.id).filter(Boolean)},x._merged=!0,x});return[...i,...m]}function ke(a){const e=ae(a).historico||[];if(!e.length)return null;const s=(a.routes||[]).filter(C=>C.activo),d=q(a),r=["1001","1002","1003"],i=["1005"],l=d.find(C=>C.centroIds.some(x=>r.includes(String(x)))),b=d.find(C=>C.centroIds.some(x=>i.includes(String(x)))),m=!1,c=new Map;s.forEach(C=>{C.id&&c.set(String(C.id).toUpperCase(),C),C.codigo&&c.set(String(C.codigo).toUpperCase(),C)});const E={};return d.forEach(C=>{if(m&&b&&C.grupo===b.grupo)return;const x=m&&l&&C.grupo===l.grupo?[l,b]:[C],y=new Set(x.map(p=>p.grupo)),v=new Set(x.flatMap(p=>(p.centroIds||[]).map(String))),$=s.filter(p=>(p.tipo||"").toLowerCase()!=="comuna"||p.clasificRuta!=="Regional"?!1:p.origen_grupo?y.has(p.origen_grupo):v.has(String(p.origenId))),_=new Set;$.forEach(p=>{p.id&&_.add(String(p.id).toUpperCase()),p.codigo&&_.add(String(p.codigo).toUpperCase())});const L=new Map((a.transportZones||[]).map(p=>[p.zona,p])),o=new Map;$.forEach(p=>{const h=(p.comuna||p.destino||"").trim().toLowerCase();h&&!o.has(h)&&o.set(h,p.id_zona_transporte||(p.destino||"").trim().toUpperCase())});const n=new Map;if(e.forEach(p=>{const h=String(p.idRuta).toUpperCase();let u=c.get(h),g;if(u&&_.has(h))g=u.id_zona_transporte||(u.destino||"").trim().toUpperCase()||p.idRuta;else if(u&&(u.tipo||"").toLowerCase()==="sector"){const S=(L.get(u.id_zona_transporte)?.comuna||"").trim().toLowerCase(),M=S?o.get(S):null;if(!M)return;g=M,u=$.find(R=>(R.id_zona_transporte||(R.destino||"").trim().toUpperCase())===M)||u}else return;n.has(g)||n.set(g,{ton:0,rutas:new Map});const w=n.get(g);w.ton+=p.ton,w.rutas.has(u.id)||w.rutas.set(u.id,u)}),m&&x.length>1){const p=new Map;for(const[h,u]of n.entries()){const g=([...u.rutas.values()][0]?.destino||"").trim().toUpperCase();g&&(p.has(g)||p.set(g,[]),p.get(g).push(h))}for(const h of p.values()){if(h.length<=1)continue;const u=h[0],g=n.get(u);for(const w of h.slice(1)){const j=n.get(w);g.ton+=j.ton,j.rutas.forEach((S,M)=>{g.rutas.has(M)||g.rutas.set(M,S)}),n.delete(w)}}}let f=0,t=0;for(const p of n.values()){const h=[...p.rutas.values()][0];["ISLA","EXTREMA"].includes((h?.caracteristica||"").toUpperCase())?t+=p.ton:f+=p.ton}for(const p of n.values()){const h=[...p.rutas.values()][0],g=["ISLA","EXTREMA"].includes((h?.caracteristica||"").toUpperCase())?t:f,w=g>0?Math.round(p.ton/g*1e4)/100:0,j={pct:w,peso:w/100};p.rutas.forEach(S=>{S.id&&(E[S.id]=j),S.codigo&&(E[S.codigo]=j)})}}),E}async function ua(a,e){const s=ae(a);if(!s.historico?.length){const m=await ve();m?.length&&(s.historico=m)}const d=ke(a);if(!d||!Object.keys(d).length)return!1;const r=e.participacionRutas||{},i=Object.keys(d),l=Object.keys(r);return i.length===l.length&&i.every(m=>r[m]&&Math.abs(Number(r[m].pct)-d[m].pct)<.005)?!1:(e.participacionRutas=d,ot("editar")&&z(a,{syncOnly:["tariffConfig"]}),Oe(a,e,""),!0)}async function ma(a,e){if(!ae(a).historico?.length){const r=await ve();r?.length&&(ae(a).historico=r)}const s=ke(a);s&&Object.keys(s).length>0&&(e.participacionRutas=s,z(a,{syncOnly:["tariffConfig"]}));const d=Oe(a,e,"");P(`Ponderados actualizados — ${d.size} tipo(s) de camión`)}let Ze={};function Oe(a,e,s=""){const d=q(a),r=s?d.filter(o=>o.grupo===s):d,i=tt(a,e),l=e.participacionRutas||{},b=Object.keys(l).length>0?l:ke(a)||{},m=new Set;let c=!1;const E=["SANTIAGO","SAN BERNARDO"],C=d.find(o=>o.grupo==="SANTIAGO"),x=d.find(o=>o.grupo==="SAN BERNARDO");function y(o){const n=o.filter(h=>(h.ruta.caracteristica||"NORMAL").toUpperCase()==="NORMAL"),f=o.filter(h=>(h.ruta.caracteristica||"NORMAL").toUpperCase()!=="NORMAL");function t(h){let u=0;const g=h.reduce((w,j)=>{const S=b[j.ruta.id]||b[j.ruta.codigo]||(j.ruta._allCodigos||[]).reduce((R,V)=>R||b[V],null)||(j.ruta._allIds||[]).reduce((R,V)=>R||b[V],null),M=Number(S?.pct)||0;return u+=M,w+(j.item11_costoKmFinal||0)*M},0);return u>0?g/u:0}function p(h){return h.length?h.reduce((u,g)=>u+(g.item11_costoKmFinal||0),0)/h.length:0}return{pondNorm:Math.round(t(n))||Math.round(p(n)),promNorm:Math.round(p(n)),pondEsp:Math.round(t(f))||Math.round(p(f)),promEsp:Math.round(p(f)),hasEsp:f.length>0,hasItems:o.length>0}}const v=o=>(o.ruta.tipo||"").toUpperCase()==="COMUNA"&&o.ruta.clasificRuta==="Regional",$=(o,n)=>i.filter(f=>f.ruta.origen_grupo===o&&f.capKg===n&&v(f)),_=o=>{const n=o.filter(f=>Number(f)>0);return n.length?Math.round(n.reduce((f,t)=>f+t,0)/n.length):0};Ze={};const L=new Set(r.map(o=>o.grupo==="SAN BERNARDO"&&C?"SANTIAGO":o.grupo));return d.filter(o=>L.has(o.grupo)).forEach(o=>{if(o.grupo==="SAN BERNARDO"&&C)return;const n=o.grupo==="SANTIAGO"&&!!x;(a.truckTypes||[]).filter(t=>t.Id_centro===o.repId).forEach(t=>{const p=ee(t.type),h=[{grupo:o.grupo,items:$(o.grupo,p)}];n&&h.push({grupo:x.grupo,items:$(x.grupo,p)});const u=h.filter(S=>S.items.length>0);if(!u.length)return;m.add(t.id);const g=u.map(S=>({grupo:S.grupo,...y(S.items)})),w=g.filter(S=>S.hasEsp),j={pondNorm:_(g.map(S=>S.pondNorm)),promNorm:_(g.map(S=>S.promNorm)),pondEsp:_(w.map(S=>S.pondEsp)),promEsp:_(w.map(S=>S.promEsp)),hasEsp:w.length>0};n&&(Ze[t.id]=Object.fromEntries(g.map(S=>[S.grupo,{norm:S.pondNorm,esp:S.hasEsp?S.pondEsp:0}]))),t.ratePerKmPond!==j.pondNorm&&(t.ratePerKmPond=j.pondNorm,c=!0),t.ratePerKmProm!==j.promNorm&&(t.ratePerKmProm=j.promNorm,c=!0),t.ratePerKm!==j.pondNorm&&(t.ratePerKm=j.pondNorm,c=!0),j.hasEsp&&(t.ratePerKmExtrPond!==j.pondEsp&&(t.ratePerKmExtrPond=j.pondEsp,c=!0),t.ratePerKmExtrProm!==j.promEsp&&(t.ratePerKmExtrProm=j.promEsp,c=!0),t.ratePerKmExtrema!==j.pondEsp&&(t.ratePerKmExtrema=j.pondEsp,c=!0)),(t.rateAjustNorm===void 0||t.rateAjustNorm===null)&&(t.rateAjustNorm=j.pondNorm,c=!0),j.hasEsp&&(t.rateAjustEsp===void 0||t.rateAjustEsp===null)&&(t.rateAjustEsp=j.pondEsp,c=!0)})}),c&&z(a,{syncOnly:["truckTypes"]}),m}const A={centro:"all",draft:{},guardando:!1,refrescado:!1,reajuste:null},ba=["Kmbase","baseKM","baseRate","rateAjustNorm","rateAjustEsp"],xt=a=>["ISLA","EXTREMA"].includes(String(a.caracteristica||"").toUpperCase());function ze(a,e){const s=A.draft[a.id];return s&&e in s?s[e]:e==="rateAjustNorm"?a.rateAjustNorm??a.ratePerKmPond??0:e==="rateAjustEsp"?a.rateAjustEsp??a.ratePerKmExtrPond??0:Number(a[e])||0}function he(a,e){return e==="rateAjustNorm"?a.rateAjustNorm??a.ratePerKmPond??0:e==="rateAjustEsp"?a.rateAjustEsp??a.ratePerKmExtrPond??0:Number(a[e])||0}function Je(a){const e=[];return Object.entries(A.draft).forEach(([s,d])=>{const r=(a.truckTypes||[]).find(i=>i.id===s);r&&Object.entries(d).forEach(([i,l])=>{Number(l)!==Number(he(r,i))&&e.push({t:r,c:i,v:l})})}),e}function Xa(a){return _e(a)}function Wa(a,e,s=null){const d=[];return _e(a).forEach(r=>{s&&!s.has(r.grupo)||(a.truckTypes||[]).filter(i=>i.Id_centro===r.repId).sort((i,l)=>ee(i.type)-ee(l.type)).forEach(i=>{["baseKM"].forEach(l=>{const b=Number(he(i,l))||0;b>0&&d.push({grupo:r.grupo,nombreTabla:r.nombreTabla,t:i,campo:l,actual:b,nuevo:Math.round(b*e)})})})}),d}function Ya(a,e,s){e.forEach(d=>{d.nuevo!==Number(he(d.t,d.campo))&&((A.draft[d.t.id]=A.draft[d.t.id]||{})[d.campo]=d.nuevo)}),A.centro="all",A.refrescado=!1,A.reajuste={...s,propuesto_at:new Date().toISOString()}}function _e(a){const e=q(a),s=e.find(r=>r.grupo==="SANTIAGO"),d=e.find(r=>r.grupo==="SAN BERNARDO");return e.filter(r=>!(s&&d&&r.grupo==="SAN BERNARDO")).map(r=>({...r,gruposCalc:r.grupo==="SANTIAGO"&&d?["SANTIAGO","SAN BERNARDO"]:[r.grupo],nombreTabla:r.grupo==="SANTIAGO"&&d?"Santiago + San Bernardo":r.nombre,ids:r.grupo==="SANTIAGO"&&d?[...r.centroIds,...d.centroIds]:r.centroIds}))}function Xe(a,e,s){const d=new Set(e.variables?.troncalesRoutes||[]);return(a.routes||[]).filter(r=>r.activo&&r.clasificRuta==="Regional"&&!d.has(r.codigo)&&s.includes(r.origen_grupo))}function gt(a,e){if(!Je(a).length)return"";const d=new Set(e.variables?.troncalesRoutes||[]),r={},i={};return _e(a).forEach(l=>{const b=(a.truckTypes||[]).filter(c=>c.Id_centro===l.repId);if(!b.some(c=>A.draft[c.id]))return;const m=Xe(a,e,l.gruposCalc);b.forEach(c=>{const E={...c};ba.forEach(C=>{A.draft[c.id]&&C in A.draft[c.id]&&(E[C]=A.draft[c.id][C])}),m.forEach(C=>{const x=C.codigo+"||"+c.type;r[x]=st(a,e,C,c,d),i[x]=st(a,e,C,E,d)})})}),Bt(r,i,"ZCAP regionales")}function fa(a,e,s){let d=0;return _e(a).forEach(r=>{if(s?!s.has(r.grupo):A.centro!=="all"&&A.centro!==r.grupo)return;const i=Xe(a,e,r.gruposCalc).filter(l=>(l.tipo||"").toUpperCase()==="COMUNA"&&Number(l.km)>0);i.length&&(a.truckTypes||[]).filter(l=>l.Id_centro===r.repId).forEach(l=>{const b=ee(l.type);if(!b||b===2e3)return;const m=ze(l,"Kmbase"),c=ze(l,"baseRate"),E=i.map(u=>({x:Math.max(0,Number(u.km)-m),y:St(a,e,u,b).zcap||0,e:xt(u)})).filter(u=>u.y>0),C=E.filter(u=>!u.e),x=E.filter(u=>u.e);if(!C.length)return;const y=u=>u.reduce((g,w)=>g+w,0)/(u.length||1),v=Number(l.ratePerKmPond)||0;let $,_;const L=y(C.map(u=>u.x)),o=y(C.map(u=>u.y)),n=C.reduce((u,g)=>u+(g.x-L)**2,0);if(C.length>=2&&n>0?($=C.reduce((u,g)=>u+(g.x-L)*(g.y-o),0)/n,_=o-$*L):($=v,_=y(C.map(u=>u.y-u.x*$))),_<c||$<0){_=c;const u=C.reduce((g,w)=>g+w.x*w.x,0);$=u>0?C.reduce((g,w)=>g+w.x*(w.y-c),0)/u:v}let f=0;if(x.length){const u=x.reduce((g,w)=>g+w.x*w.x,0);f=u>0?x.reduce((g,w)=>g+w.x*(w.y-_),0)/u:$,f<=0&&(f=$)}const t=u=>_+u.x*(u.e&&f?f:$),p=y(E.map(u=>u.y))-y(E.map(t));if(_+p>=c)_+=p;else{const u=y(E.map(t)),g=u-_?(y(E.map(w=>w.y))-_)/(u-_):1;$*=g,f*=g}if(!($>0)||!isFinite($)||!isFinite(_))return;f>0||(f=$);const h={baseKM:Math.max(0,Math.round((_-c)/100)*100),rateAjustNorm:Math.round($)};x.length&&(h.rateAjustEsp=Math.round(f)),Object.entries(h).forEach(([u,g])=>{Number(g)!==Number(he(l,u))?((A.draft[l.id]=A.draft[l.id]||{})[u]=g,d++):A.draft[l.id]&&delete A.draft[l.id][u]})})}),d}function ht(a,e,s){const d=Oe(e,s),r=ot("editar"),i=_e(e);Kt(s),Jt();const l=Ft(()=>{if(!a.isConnected){l();return}nt(a,b)});lt()===void 0&&Ut().catch(x=>console.warn("Tarifa vigente:",x.message||x));function b(){const x=Je(e),y=A.centro==="all"?i:i.filter(v=>v.grupo===A.centro);a.innerHTML=`<div class="sv-view">
      ${Dt(x.length,gt(e,s),A.guardando)}
      ${Gt(e,r)}
      ${A.reajuste&&x.length?`<div class="vt-note is-info"><span class="material-symbols-outlined">percent</span><span>Propuesta de <b>reajuste polinómico ${A.reajuste.reajuste>=0?"+":""}${re(A.reajuste.reajuste*100,2)}%</b> (factor ${re(A.reajuste.factor,4)} · ${U(A.reajuste.base)} → ${U(A.reajuste.corte)}) en ${U((A.reajuste.grupos||[]).join(", "))}. Revisa el impacto y guarda para aplicarla; al guardar queda en el historial del reajuste.</span></div>`:""}
      <div class="sv-vhead">
        <div style="min-width:0"><h1 class="sv-h1">Tarifas por Camión</h1>
          <div class="sv-desc">Tarifas km por centro. Definen el ZCAP de las rutas regionales.</div></div>
        <div class="sv-actions">${r?`<button class="sv-btn-p" data-chip id="tt-refresh" title="Propone b, f y g ajustados al Motor de Costos (queda como cambio sin guardar)">
          <span class="material-symbols-outlined">${A.refrescado?"check":"refresh"}</span>${A.refrescado?"Tarifas refrescadas":"Refrescar tarifas"}</button>`:""}</div>
      </div>
      ${Ot("transporte","camiones")}
      <div class="sv-filters"><div class="sv-frow"><span class="sv-flbl">Centro origen</span>
        <button class="sv-chip ${A.centro==="all"?"is-on":""}" data-chip data-tccentro="all">Todos</button>
        ${i.map(v=>`<button class="sv-chip ${A.centro===v.grupo?"is-on":""}" data-chip data-tccentro="${U(v.grupo)}">${U(v.nombreTabla)}</button>`).join("")}
      </div></div>
      ${y.map(v=>m(v)).join("")}
    </div>`,E()}function m(x){const y=Xe(e,s,x.gruposCalc),v=y.some(xt),$=y.map(g=>Number(g.km)||0).filter(g=>g>0),_=(e.truckTypes||[]).filter(g=>g.Id_centro===x.repId).sort((g,w)=>ee(g.type)-ee(w.type)),L=_.some(g=>ee(g.type)===2e3),o=(g,w)=>{const j=Ze[g.id];if(!j||x.gruposCalc.length<2)return"";const S=j.SANTIAGO?.[w],M=j["SAN BERNARDO"]?.[w];return`<div class="sv-sub" style="font-size:10.5px;color:#5c5f61">Stgo ${S>0?ye(S):"—"} · SB ${M>0?ye(M):"—"}</div>`},n=lt(),f=g=>n&&n.data?(n.data.truckTypes||[]).find(w=>w.id===g):null,t=(g,w,j)=>{if(!n)return"";const S=f(g.id);if(!S)return'<div class="vt-was">nuevo vs vigente</div>';const M=ct(S,w);return M===ct(g,w)?"":`<div class="vt-was" title="Tarifa vigente del ${Re(n.fijada_at)}">vigente ${j==="km"?re(M)+" km":ye(M)}</div>`},p=(g,w,j,S)=>Mt(`${g.id}|${w}`,ze(g,w),{changed:Number(ze(g,w))!==Number(he(g,w)),unit:j,w:S,disabled:!r,label:`${g.type} ${w}`})+t(g,w,j),h=Ht(e,x.repId),u=["Tipo camión","Cap.","a. KM base","b. Costo base","c. T. base KM","d. Normal pond."].concat(v?["e. Esp. pond."]:[]).concat([`${v?"f":"e"}. Ajust. normal`]).concat(v?["g. Ajust. especial"]:[]);return`<div class="sv-card">
      <div class="tf-tabletitle"><h3>${U(x.nombreTabla)} <span class="sv-mono" style="color:#5c5f61;font-size:12px">${U(x.ids.join(", "))}</span></h3>
        <small>${re(y.length)} rutas regionales${$.length?` · KM entre ${re(Math.min(...$))} y ${re(Math.max(...$))}`:""}${v?" · con rutas especiales (isla / extrema)":""}</small>
        ${h.at?`<span class="vt-upd" title="Última actualización de las tarifas de este centro"><span class="material-symbols-outlined">update</span> Actualizado ${Re(h.at)} · ${U(Zt(h.by))}</span>`:""}
        ${r&&_.length&&!L?`<button class="sv-btn" data-chip data-tc2t="${U(x.repId)}" style="margin-left:auto" title="Agrega el Camión 2 Ton a este centro: ZCAP en rutas regionales, Min/Max y Retiro Retorno"><span class="material-symbols-outlined">add</span>Habilitar Camión 2 Ton</button>`:""}</div>
      <div style="overflow:auto"><table class="sv-table" style="min-width:${v?1060:860}px">
        <thead><tr>${u.map((g,w)=>`<th class="${w?"r":""}">${U(g)}</th>`).join("")}</tr></thead>
        <tbody>${_.length?_.map(g=>{const w=g.ratePerKmPond||0,j=g.ratePerKmExtrPond||0,S=ee(g.type)===2e3,M=S?`<td class="r sv-muted" ${v?'colspan="2"':""}>Sin motor · tarifa manual</td>`:`<td class="r" style="color:#1e3a8a">${d.has(g.id)?ye(w)+"/km"+o(g,"norm"):'<span class="sv-muted">Sin rutas</span>'}</td>
            ${v?`<td class="r" style="color:#713f12">${j>0?ye(j)+"/km"+o(g,"esp"):"—"}</td>`:""}`,R=n&&g.updated_at&&g.updated_at>n.fijada_at;return`<tr style="cursor:default"><td class="sv-b" style="white-space:nowrap">${U(g.type)}${S&&r?` <button class="tf-actbtn" data-chip data-tc2tdel="${U(g.id)}" title="Deshabilitar Camión 2 Ton en este centro"><span class="material-symbols-outlined">delete</span></button>`:""}
              ${g.updated_at?`<div class="sv-sub" style="font-weight:500;${R?"color:#c2410c":""}" title="Actualizado por ${U(g.updated_by||"—")}">act. ${Re(g.updated_at,!1)}</div>`:""}</td>
            <td class="r">${re(ee(g.type))} kg</td>
            <td class="r">${p(g,"Kmbase","km","96px")}</td>
            <td class="r">${p(g,"baseKM","CLP","130px")}</td>
            <td class="r">${p(g,"baseRate","CLP","120px")}</td>
            ${M}
            <td class="r">${p(g,"rateAjustNorm","$/km","116px")}</td>
            ${v?`<td class="r">${p(g,"rateAjustEsp","$/km","116px")}</td>`:""}</tr>`}).join(""):`<tr class="sv-empty"><td colspan="${u.length}">Sin tipos de camión para este centro.
          ${r?`<button class="sv-btn" data-chip data-tcadd="${U(x.grupo)}" style="margin-left:8px"><span class="material-symbols-outlined">add</span>Agregar tipos</button>`:""}</td></tr>`}</tbody>
      </table></div>
      <div class="sv-tfoot"><span>ZCAP tarifa = b + c + máx(0, KM − a) × tarifa ajustada</span><span>${x.gruposCalc.length>1?"Ponderado = promedio simple de Santiago y San Bernardo (cada uno ponderado por su densidad logística)":"Ponderado por las toneladas de cada ruta"}</span></div>
    </div>`}const c=kt(()=>nt(a,b),250);function E(){zt(a),qt(a,e,b),a.querySelectorAll("[data-tccentro]").forEach(x=>x.addEventListener("click",()=>{A.centro=x.dataset.tccentro,b()})),Pt(a,(x,y)=>{const[v,$]=x.split("|"),_=(e.truckTypes||[]).find(L=>L.id===v);_&&(A.draft[v]=A.draft[v]||{},Number(y)===Number(he(_,$))?delete A.draft[v][$]:A.draft[v][$]=y,Object.keys(A.draft[v]).length||delete A.draft[v],A.refrescado=!1,c())}),Vt(a,()=>{A.draft={},A.refrescado=!1,A.reajuste=null,b()},C),a.querySelector("#tt-refresh")?.addEventListener("click",()=>{const x=document.getElementById("tt-ref-ov");x&&x.remove();const y=document.createElement("div");y.id="tt-ref-ov",y.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";const v=A.centro==="all"?new Set:new Set([A.centro]);y.innerHTML=`<div style="background:var(--surface,#fff);color:inherit;border-radius:10px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);max-height:90vh;overflow:auto">
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:700">Refrescar tarifas</h3>
        <p style="margin:0 0 12px;font-size:12px;opacity:.75">Elige las sucursales a ajustar al Motor de Costos. Queda como cambio sin guardar; las demás no se tocan.</p>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600;font-size:13px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,.3);margin-bottom:6px"><input type="checkbox" id="tt-ref-all"> Todas</label>
        ${i.map(_=>`<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:3px 0"><input type="checkbox" class="tt-ref-c" value="${U(_.grupo)}" ${v.has(_.grupo)?"checked":""}> ${U(_.nombreTabla)}</label>`).join("")}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="sv-btn" id="tt-ref-no">Cancelar</button>
          <button class="sv-btn-p" id="tt-ref-ok">Refrescar</button></div></div>`,document.body.appendChild(y);const $=()=>[...y.querySelectorAll(".tt-ref-c")];y.querySelector("#tt-ref-all").addEventListener("change",_=>$().forEach(L=>{L.checked=_.target.checked})),y.querySelector("#tt-ref-no").addEventListener("click",()=>y.remove()),y.addEventListener("click",_=>{_.target===y&&y.remove()}),y.querySelector("#tt-ref-ok").addEventListener("click",()=>{const _=new Set($().filter(o=>o.checked).map(o=>o.value));if(!_.size){P("Elige al menos una sucursal.","error");return}y.remove(),A.reajuste=null;const L=fa(e,s,_);A.refrescado=!0,b(),P(L?`Propuesta ajustada al Motor de Costos en ${_.size} sucursal(es): ${L} valor(es) cambian. Revisa el impacto y guarda para aplicarla.`:"Las sucursales elegidas ya están ajustadas al Motor de Costos.","success")})}),a.querySelectorAll("[data-tc2t]").forEach(x=>x.addEventListener("click",async()=>{const y=x.dataset.tc2t;if(!(e.truckTypes||[]).some(v=>v.Id_centro===y&&ee(v.type)===2e3)){try{await Ke(e)}catch(v){console.warn("Tarifa vigente:",v.message||v)}e.truckTypes=e.truckTypes||[],e.truckTypes.push({id:`${y}-2`,Id_centro:y,type:"Camión 2 Ton",capacityTons:"Hasta 2 Tons",baseRate:0,ratePerKm:0,Kmbase:0,baseKM:0,rateAjustNorm:0,updated_by:it(),updated_at:new Date().toISOString()}),z(e,{syncOnly:["truckTypes"]}),P("Camión 2 Ton habilitado. Ingresa KM base, costo base y tarifa ajustada, y guarda.","success"),b()}})),a.querySelectorAll("[data-tc2tdel]").forEach(x=>x.addEventListener("click",async()=>{const y=x.dataset.tc2tdel;if(await Te(`¿Deshabilitar Camión 2 Ton en este centro?

Sale de Tarifas Rutas, Min/Max y Retiro Retorno. Si el centro tiene Camión 2 Ton en Frecuencia y Especiales, Min/Max vuelve a usar esa tarifa.`,{aceptar:"Deshabilitar"}))try{await et("truckTypes",y),e.truckTypes=(e.truckTypes||[]).filter(v=>v.id!==y),delete A.draft[y],P("Camión 2 Ton deshabilitado.","success"),b()}catch(v){P("No se pudo deshabilitar: "+(v.message||v),"error")}})),a.querySelectorAll("[data-tcadd]").forEach(x=>x.addEventListener("click",()=>{const y=q(e).find(_=>_.grupo===x.dataset.tcadd),v=y&&(e.logisticsCentres||[]).find(_=>_.id===y.repId);if(!v)return;const $=wt([v],jt);e.truckTypes=e.truckTypes||[],e.truckTypes.push(...$),z(e,{syncOnly:["truckTypes"]}),P(`${$.length} tipo(s) de camión agregados para ${y.nombre}`),b()}))}async function C(){const x=Je(e);if(!x.length||A.guardando)return;const y=new Set(x.map(t=>t.t.id)).size,v=[...new Set(x.map(t=>t.t.Id_centro))],$=gt(e,s),_=A.reajuste?` Incluye el reajuste polinómico de ${A.reajuste.reajuste>=0?"+":""}${re(A.reajuste.reajuste*100,2)}% (${A.reajuste.base} → ${A.reajuste.corte}).`:"";if(!await Te(`Actualizar tarifas de transportistas

Cambian ${x.length} ${x.length===1?"valor":"valores"} de ${y} ${y===1?"camión":"camiones"} (centros ${v.join(", ")}).${$?" "+$+".":""}${_}

El ajuste se aplica de inmediato a Tarifas Rutas (ZCAP), Tarifas Clientes ($/Kg, Min/Max, Express), Retiro Retorno, EbemaClick y el Cotizador. Queda registrada la fecha de actualización y la variación contra la tarifa vigente en Variación Tarifa.`,{aceptar:"Actualizar tarifas",icono:"warning"}))return;A.guardando=!0;try{await Ke(e)}catch(t){console.warn("Tarifa vigente:",t.message||t),P("Aviso: no se pudo registrar la tarifa vigente previa ("+(t.message||t)+"). Los cambios se guardan igual.","error")}const o=it(),n=new Date().toISOString();x.forEach(({t,c:p,v:h})=>{t[p]=Number(h)||0,t.updated_by=o,t.updated_at=n});const f=["truckTypes"];if(A.reajuste){const t=s.reajuste=s.reajuste||{};t.historial=t.historial||[],t.historial.push({...A.reajuste,aplicado_at:n,aplicado_by:o,valores:x.length}),t.base=A.reajuste.corte,A.reajuste=null,f.push("tariffConfig")}A.draft={},A.refrescado=!1,A.guardando=!1,z(e,{syncOnly:f}),P(`Tarifas actualizadas el ${Re(n)} (${x.length} ${x.length===1?"valor":"valores"}). Revisa el impacto por centro en Variación Tarifa.`,"success"),b()}b()}const xa="https://humhokvdowfqicjopbhf.supabase.co/functions/v1/cne-diesel-price";function vt(){return new Date().toISOString().slice(0,10)}function ga(a){return!a||!a.precioLitro?'<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN DATOS</span>':a.fuente==="cne"?`<span class="inline-flex flex-col items-center px-2 py-1 rounded bg-blue-100 text-blue-800 font-label-caps text-[10px] leading-tight">
      <span class="flex items-center gap-xs"><span class="material-symbols-outlined text-[12px]">cloud_done</span> API CNE</span>${a.cneRegion?`<br><span class="font-normal text-[10px] opacity-75">${a.cneRegion} ${a.cneMes||""}/${a.cneAnio||""}</span>`:""}
    </span>`:`<span class="inline-flex items-center gap-xs px-2 py-1 rounded bg-surface-container text-secondary font-label-caps text-[10px]">
    <span class="material-symbols-outlined text-[12px]">edit</span> Manual
  </span>`}function We(a,e,s){const d=q(e),r=new Date;a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm flex-wrap gap-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">local_gas_station</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Precio de Combustible por Centro Logístico</h2>
        </div>
        <button id="cne-update-btn"
          class="flex items-center gap-xs bg-primary text-white px-md py-sm rounded text-[12px] font-bold uppercase hover:opacity-90 transition-opacity">
          <span class="material-symbols-outlined text-[16px]">cloud_download</span>
          Actualizar desde CNE
        </button>
      </div>

      <div id="cne-status" class="hidden mb-md text-[12px] px-md py-sm rounded border"></div>

      <p class="text-[12px] text-secondary mb-md">
        Ingrese el precio por litro <b>con IVA</b> y el porcentaje de IVA. El <b>Precio sin IVA</b> es el valor que se usa en el Motor de Costo para calcular el costo de combustible.
        <b>Actualizar desde CNE</b> obtiene el precio del Petróleo Diésel de la última semana publicada por la CNE.
        Alerta crítica si un centro pasa más de 3 semanas sin actualizar.
      </p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Precio Litro c/IVA (CLP)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">IVA %</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Precio sin IVA (CLP)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Última Actualización</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Estado</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Fuente</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md" id="combustibles-tbody">
            ${d.map(i=>{const l=s.combustibles[i.repId]||{};let b='<span class="inline-flex items-center px-2 py-1 rounded bg-secondary-container text-on-secondary-container font-label-caps text-[10px]">SIN DATOS</span>';if(l.fecha){const C=Math.floor((r-new Date(l.fecha))/864e5);b=C>21?`<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px]"><span class="material-symbols-outlined text-[14px]">warning</span> ${C}D SIN ACTUALIZAR</span>`:`<span class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 font-label-caps text-[10px]">VIGENTE (${C}D)</span>`}const m=i.centros.length>1?`<br><span class="text-secondary text-[11px]">${i.centros.map(C=>C.nombre).join(", ")}</span>`:"",c=Number(l.ivaPct)||0,E=c>0?Math.round(Number(l.precioLitro||0)/(1+c/100)):Number(l.precioLitro||0);return`<tr class="border-b border-outline-variant" data-repid="${i.repId}">
                <td class="p-md font-bold">${i.nombre}${m}</td>
                <td class="p-md w-40">${K(`combustibles.${i.repId}.precioLitro`,l.precioLitro,'data-combustible-repid="'+i.repId+'" data-combustible-field="precio"')}</td>
                <td class="p-md w-28">${K(`combustibles.${i.repId}.ivaPct`,l.ivaPct??19,'data-combustible-repid="'+i.repId+'" data-combustible-field="iva"')}</td>
                <td class="p-md w-36 text-right font-data-mono text-data-mono font-bold text-primary">${E.toLocaleString("es-CL")}</td>
                <td class="p-md w-44">${dt(`combustibles.${i.repId}.fecha`,l.fecha,`data-combustible-repid="${i.repId}" data-combustible-field="fecha"`)}</td>
                <td class="p-md text-center">${b}</td>
                <td class="p-md text-center">${ga(l)}</td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">speed</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Matriz de Rendimiento Estructural (KM/Litro)</h2>
      </div>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Capacidad Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rendimiento Cargado (Ida)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Rendimiento Vacío (Vuelta)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-center">Ejes (fijo)</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${pe.map(i=>{const l=s.rendimientos[i]||{};return`<tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${(i/1e3).toLocaleString("es-CL")}.000 kg</td>
                <td class="p-md w-32">${K(`rendimientos.${i}.cargado`,l.cargado)}</td>
                <td class="p-md w-32">${K(`rendimientos.${i}.vacio`,l.vacio)}</td>
                <td class="p-md text-center font-data-mono text-data-mono">${s.ejes[i]}</td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `,a.querySelectorAll("[data-combustible-repid]").forEach(i=>{i.addEventListener("change",()=>{const l=i.dataset.combustibleRepid,b=i.dataset.combustibleField;if(l){if(s.combustibles[l]||(s.combustibles[l]={}),b==="precio"){const m=String(i.value).replace(/\./g,"").replace(",","."),c=m===""?0:Number(m);s.combustibles[l].precioLitro=isNaN(c)?0:c,s.combustibles[l].fuente="manual";const E=vt();s.combustibles[l].fecha=E,delete s.combustibles[l].cneRegion,delete s.combustibles[l].cneMes,delete s.combustibles[l].cneAnio}else if(b==="iva"){const m=Number(i.value);s.combustibles[l].ivaPct=!m||isNaN(m)||m<=0?19:m}else b==="fecha"&&(s.combustibles[l].fecha=i.value,s.combustibles[l].fuente="manual");i.dataset.handled="1",z(e),We(a,e,s)}})}),document.getElementById("cne-update-btn")?.addEventListener("click",async()=>{const i=document.getElementById("cne-update-btn"),l=document.getElementById("cne-status");i.disabled=!0,i.innerHTML='<span class="material-symbols-outlined text-[16px] animate-spin">sync</span> Consultando CNE…',l.className="mb-md text-[12px] px-md py-sm rounded border bg-blue-50 border-blue-200 text-blue-800",l.textContent="Conectando con API CNE…",l.classList.remove("hidden");try{const m=await(await fetch(xa)).json();if(!m.success)throw new Error(m.error||"Error desconocido en Edge Function");const c=m.data,E=vt();let C=0;d.forEach(x=>{const y=String(x.grupo).toUpperCase(),v=c[y];v&&(s.combustibles[x.repId]||(s.combustibles[x.repId]={}),s.combustibles[x.repId].precioLitro=v.precio,s.combustibles[x.repId].fecha=E,s.combustibles[x.repId].fuente="cne",s.combustibles[x.repId].cneRegion=v.region,s.combustibles[x.repId].cneMes=v.mes,s.combustibles[x.repId].cneAnio=v.anio,s.combustibles[x.repId].ivaPct||(s.combustibles[x.repId].ivaPct=19),C++)}),z(e),l.className="mb-md text-[12px] px-md py-sm rounded border bg-green-50 border-green-200 text-green-800",l.textContent=`✓ ${C} centros actualizados — precio CNE Diésel más reciente. Fecha de actualización: ${E}.`,We(a,e,s)}catch(b){l.className="mb-md text-[12px] px-md py-sm rounded border bg-red-50 border-red-200 text-red-800",l.textContent=`Error: ${b.message}`,i.disabled=!1,i.innerHTML='<span class="material-symbols-outlined text-[16px]">cloud_download</span> Actualizar desde CNE'}})}function yt(a,e,s){const d=q(e),r=Number(s.variables.valorUF)||0;s.soapTransversal||(s.soapTransversal={}),a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center justify-between gap-sm mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">shield</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Seguro de Carga (Colectivo Corporativo)</h2>
        </div>
        <div class="flex items-center gap-sm">
          <label class="font-label-caps text-label-caps text-secondary text-[11px]">Valor UF:</label>
          <input id="seg-uf-live" type="number" min="0" step="1" value="${r}" data-path="variables.valorUF"
            class="border border-[#CED4DA] p-xs font-data-mono text-data-mono w-28 text-right">
        </div>
      </div>
      <p class="text-[12px] text-secondary mb-md">Valor base mensual en UF por centro. Se convierte a CLP usando el Valor UF indexado. UF actual: <b id="seg-uf-display">${O(r)}</b></p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Centro Logístico</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Seguro Carga (UF/mes)</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Equivalente CLP/mes</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${d.map(i=>{const l=Number(s.seguros[i.repId])||0,b=i.centros.length>1?`<br><span class="text-secondary text-[11px]">${i.centros.map(m=>m.nombre).join(", ")}</span>`:"";return`<tr class="border-b border-outline-variant">
                <td class="p-md font-bold">${i.nombre}${b}</td>
                <td class="p-md w-32">${K(`seguros.${i.repId}`,l)}</td>
                <td class="p-md text-right font-data-mono text-data-mono seg-clp-cell" data-uf="${l}">${O(l*r)}</td>
              </tr>`}).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">directions_car</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">SOAP por Tipo de Camión (Transversal)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Valor anual promediado de SOAP, igual para todos los centros (valor transversal). Se aplica internamente en el Motor de Costo para cada centro según el tipo de camión.</p>
      <div class="bg-surface border border-outline-variant overflow-hidden rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo de Camión</th>
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">Valor SOAP Anual (CLP)</th>
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${pe.map(i=>`
              <tr class="border-b border-outline-variant">
                <td class="p-md font-bold font-data-mono text-data-mono">${i/1e3}.000 kg</td>
                <td class="p-md w-40">${K(`soapTransversal.${i}`,s.soapTransversal[i]||0)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
      <div class="flex items-center gap-sm mb-md border-b border-outline-variant pb-sm">
        <span class="material-symbols-outlined text-primary">badge</span>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Permiso de Circulación (Anual Promediado)</h2>
      </div>
      <p class="text-[12px] text-secondary mb-md">Tabla relacional indexada por Centro Logístico y Tipo de Camión. Edición inline o carga masiva CSV (columnas: Centro_SAP, Tipo_Camion_Kg, Permiso_Circulacion).</p>

      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV — Permiso de Circulación</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_SAP, Tipo_Camion_Kg, Permiso_Circulacion</p>
        </div>
        <input type="file" id="ps-csv" accept=".csv" class="text-[12px]">
      </div>

      <div class="bg-surface border border-outline-variant overflow-x-auto rounded">
        <table class="w-full zebra-table border-collapse">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              <th class="p-md font-label-caps text-label-caps text-secondary uppercase">Tipo Camión</th>
              ${d.map(i=>`<th class="p-md font-label-caps text-label-caps text-secondary uppercase text-right">${i.nombre}</th>`).join("")}
            </tr>
          </thead>
          <tbody class="font-body-md text-body-md">
            ${pe.map(i=>`
              <tr class="border-b border-outline-variant">
                <td class="p-md font-bold font-data-mono text-data-mono">${i/1e3}.000 kg</td>
                ${d.map(l=>{const b=`${l.repId}|${i}`,m=s.permisosSoap[b]||{};return`<td class="p-sm w-32">${K(`permisosSoap.${b}.permiso`,m.permiso)}</td>`}).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `,document.getElementById("seg-uf-live").addEventListener("input",i=>{const l=Number(i.target.value)||0;document.getElementById("seg-uf-display").textContent=O(l),a.querySelectorAll(".seg-clp-cell").forEach(b=>{const m=Number(b.dataset.uf)||0;b.textContent=O(m*l)})}),document.getElementById("seg-uf-live").addEventListener("change",i=>{s.variables.valorUF=Number(i.target.value)||0,z(e)}),a.querySelectorAll('[data-path^="seguros."]').forEach(i=>{i.addEventListener("change",()=>{const l=Number(document.getElementById("seg-uf-live").value)||0;a.querySelectorAll(".seg-clp-cell").forEach((b,m)=>{const c=d[m];if(!c)return;const E=Number(s.seguros[c.repId])||0;b.dataset.uf=E,b.textContent=O(E*l)})})}),document.getElementById("ps-csv").addEventListener("change",i=>{const l=i.target.files[0];l&&Ue(l,b=>{let m=0;b.forEach(c=>{const E=e.logisticsCentres.find(y=>y.id===(c.Centro_SAP||"").trim()),C=ut(c.Tipo_Camion_Kg);if(!E||!pe.includes(C))return;const x=`${Qe(e,E.id)}|${C}`;s.permisosSoap[x]=s.permisosSoap[x]||{},s.permisosSoap[x].permiso=Number(c.Permiso_Circulacion)||0,m++}),z(e),P(`${m} registros de Permiso de Circulación actualizados`),yt(a,e,s)})})}function ha(a,e,s){let d=ae(e).historico||[];const r=new Set,i=(e.routes||[]).filter(t=>t.activo),l=q(e),b=new Map((e.transportZones||[]).map(t=>[t.zona,t])),m=new Map;i.forEach(t=>{t.id&&m.set(String(t.id).toUpperCase(),t),t.codigo&&m.set(String(t.codigo).toUpperCase(),t)});const c=["1001","1002","1003"],E=["1005"],C=l.find(t=>t.centroIds.some(p=>c.includes(String(p)))),x=l.find(t=>t.centroIds.some(p=>E.includes(String(p)))),y=[C?.grupo,x?.grupo].filter(Boolean),v=!!(C&&x&&C.grupo!==x.grupo),$=t=>(t||"").toLowerCase().replace(/región\s+(de\s+la\s+|de\s+los\s+|de\s+|del\s+)?/i,"").replace(/región/i,"").replace(/metro\w*/i,"metropolitana").trim();function _(t,p){if(!t||p.size===0)return!0;const h=$(t);return[...p].some(u=>h.includes(u)||u.includes(h))}function L(t,p=null){const h=new Set(t),u=t.flatMap(I=>(l.find(N=>N.grupo===I)?.centroIds||[]).map(String));v&&u.some(I=>[...c,...E].includes(I))&&y.forEach(I=>h.add(I));const g=new Set;[...h].forEach(I=>{(l.find(N=>N.grupo===I)?.centroIds||[]).forEach(N=>g.add(String(N)))});const w=i.filter(I=>(I.tipo||"").toLowerCase()!=="comuna"||I.clasificRuta!=="Regional"?!1:I.origen_grupo?h.has(I.origen_grupo):g.has(String(I.origenId))),j=new Set;w.forEach(I=>{I.id&&j.add(String(I.id).toUpperCase()),I.codigo&&j.add(String(I.codigo).toUpperCase())});const S=new Map((e.transportZones||[]).map(I=>[I.zona,I])),M=new Map;w.forEach(I=>{const k=(I.comuna||I.destino||"").trim().toLowerCase();k&&!M.has(k)&&M.set(k,I.id_zona_transporte||(I.destino||"").trim().toUpperCase())});const R=new Map;d.forEach(I=>{const k=String(I.idRuta).toUpperCase();let N=m.get(k),G;if(N&&j.has(k))G=N.id_zona_transporte||(N.destino||"").trim().toUpperCase()||I.idRuta;else if(N&&(N.tipo||"").toLowerCase()==="sector"){const je=(S.get(N.id_zona_transporte)?.comuna||"").trim().toLowerCase(),Q=je?M.get(je):null;if(!Q)return;G=Q,N=w.find(de=>(de.id_zona_transporte||(de.destino||"").trim().toUpperCase())===Q)||N}else return;R.has(G)||R.set(G,{ton:0,clientes:new Set,obras:new Set,rutasByGrupo:{}});const D=R.get(G);D.ton+=I.ton,I.idCliente&&I.idCliente!=="-"&&D.clientes.add(I.idCliente),I.idObra&&I.idObra!=="-"&&D.obras.add(I.idObra);const Y=N.origen_grupo||`_id_${N.origenId}`;D.rutasByGrupo[Y]||(D.rutasByGrupo[Y]=N)});const V=new Map;if(v&&C&&x&&h.has(C.grupo)&&h.has(x.grupo)){const I=new Map;for(const[k,N]of R.entries()){const D=(Object.values(N.rutasByGrupo)[0]?.destino||"").trim().toUpperCase();D&&(I.has(D)||I.set(D,[]),I.get(D).push(k))}for(const k of I.values()){if(k.length<=1)continue;const N=k.find(D=>Object.keys(R.get(D).rutasByGrupo).includes(C.grupo))||k[0],G=R.get(N);for(const D of k){if(D===N)continue;const Y=R.get(D);G.ton+=Y.ton,Y.clientes.forEach(me=>G.clientes.add(me)),Y.obras.forEach(me=>G.obras.add(me)),Object.assign(G.rutasByGrupo,Y.rutasByGrupo),V.set(D,N),R.delete(D)}}}let Z=0,W=0;for(const I of R.values()){const k=Object.values(I.rutasByGrupo)[0];["ISLA","EXTREMA"].includes((k?.caracteristica||"").toUpperCase())?W+=I.ton:Z+=I.ton}let ce=w;if(p){const I=l.find(N=>N.grupo===p),k=new Set((I?.centroIds||[]).map(String));ce=w.filter(N=>N.origen_grupo?N.origen_grupo===p:k.has(String(N.origenId)))}const we=new Map;return ce.forEach(I=>{const k=I.id_zona_transporte||(I.destino||"").trim().toUpperCase()||I.codigo,N=V.get(k)||k;we.has(N)||we.set(N,I)}),[...we.entries()].map(([I,k])=>{const N=R.get(I),G=N?.ton||0;let D=k.codigo||"";if(N?.rutasByGrupo&&p){const Q=l.find(De=>De.grupo===p),de=new Set((Q?.centroIds||[]).map(String)),Ye=Object.entries(N.rutasByGrupo).find(([De,Ct])=>De===p||de.has(String(Ct?.origenId)));Ye&&(D=Ye[1]?.codigo||D)}const Y=N?Object.values(N.rutasByGrupo):[k],me=[...new Set(Y.map(Q=>Q.id).filter(Boolean))],je=[...new Set(Y.map(Q=>Q.codigo).filter(Boolean))];return{rutaId:k.id||I,rutaCodigo:D,_allRutaIds:me,_allRutaCodigos:je,ruta:k,clientes:N?.clientes.size||0,obras:N?.obras.size||0,toneladas:G,peso:(()=>{const de=["ISLA","EXTREMA"].includes((k.caracteristica||"").toUpperCase())?W:Z;return de>0?G/de:0})(),zonaTransporte:k.id_zona_transporte||"",caracteristica:k.caracteristica||"NORMAL"}}).sort((I,k)=>k.toneladas-I.toneladas||(I.ruta?.destino||"").localeCompare(k.ruta?.destino||"","es"))}const o=50;function n(t,p,h=!1){const u=t.replace(/[^a-z0-9]/gi,"_");if(!p.length)return`
      <div class="bg-surface-container-lowest border border-outline-variant p-md mb-md shadow-sm">
        <h3 class="font-body-lg font-bold text-on-surface mb-xs">${T(t)}</h3>
        <p class="text-secondary text-[12px]">Sin rutas Regional+COMUNA con zona registrada en el histórico.</p>
      </div>`;const g=p.reduce((R,V)=>R+V.toneladas,0),w=h?p:p.slice(0,o),j=!h&&p.length>o,S=p.filter(R=>R.toneladas>0).length;function M(R,V){const Z=Math.min(100,R.toneladas/(p[0].toneladas||1)*100),W=(R.caracteristica||"").toUpperCase(),I=["ISLA","EXTREMA"].includes(W)?'<span class="ml-xs inline-flex px-1 py-0.5 rounded text-[9px] font-bold '+(W==="ISLA"?"bg-blue-100 text-blue-700":"bg-orange-100 text-orange-700")+'">'+W+"</span>":"";return`<tr class="border-b border-outline-variant">
        <td class="p-sm text-right text-secondary font-data-mono text-[11px]">${V+1}</td>
        <td class="p-sm font-data-mono text-[11px] text-primary font-bold">${T(R.rutaCodigo)}</td>
        <td class="p-sm">
          ${T(R.ruta?.destino||"")}
          ${I}
        </td>
        <td class="p-sm text-secondary text-[11px]">${T(R.zonaTransporte)}</td>
        <td class="p-sm text-right">${R.clientes}</td>
        <td class="p-sm text-right">${R.obras}</td>
        <td class="p-sm text-right font-data-mono text-[11px]">${R.toneladas.toLocaleString("es-CL",{maximumFractionDigits:1})}</td>
        <td class="p-sm text-right font-bold font-data-mono text-[11px]">${(R.peso*100).toFixed(2)}%</td>
        <td class="p-sm">
          ${R.toneladas>0?`<div class="w-20 h-2 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full rounded-full bg-primary" style="width:${Z}%"></div></div>`:""}
        </td>
      </tr>`}return`
      <div class="border-2 border-outline-variant shadow-sm mb-xl rounded overflow-hidden" id="part-tabla-${u}">
        <div class="flex items-center justify-between px-lg pt-md pb-sm border-b-2 border-primary bg-surface-container-high">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary text-[20px]">route</span>
            <h3 class="font-headline-sm font-bold text-on-surface">${T(t)}</h3>
          </div>
          <div class="flex items-center gap-md">
            <span class="font-data-mono text-[11px] text-secondary">${S} rutas con histórico · ${g.toLocaleString("es-CL",{maximumFractionDigits:1})} ton · ${p.length} total</span>
            <button class="part-guardar-centro border border-primary text-primary hover:bg-primary hover:text-white font-bold px-md py-xs rounded flex items-center gap-xs text-[11px] uppercase transition-colors" data-grupo="${T(t)}">
              <span class="material-symbols-outlined text-[14px]">save</span> Guardar
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full zebra-table border-collapse">
            <thead>
              <tr class="bg-surface-container-high text-left border-b border-outline-variant">
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase text-right w-8">#</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase">Cód. Ruta</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase">Destino</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase">Zona</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase text-right">Clientes</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase text-right">Obras</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase text-right">Toneladas</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase text-right">Peso</th>
                <th class="p-sm font-label-caps text-label-caps text-secondary uppercase">Barra</th>
              </tr>
            </thead>
            <tbody class="font-body-md text-body-md" id="part-tbody-${u}">
              ${w.map((R,V)=>M(R,V)).join("")}
            </tbody>
            <tfoot>
              <tr class="bg-surface-container-high border-t-2 border-outline-variant font-bold">
                <td colspan="6" class="p-sm text-right">Total histórico</td>
                <td class="p-sm text-right font-data-mono text-[11px]">${g.toLocaleString("es-CL",{maximumFractionDigits:1})}</td>
                <td class="p-sm text-right font-data-mono text-[11px]">100%</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        ${j?`
        <div class="px-lg py-sm flex items-center gap-sm border-t border-outline-variant bg-surface-container-lowest">
          <span class="text-[11px] text-secondary">Mostrando ${o} de ${p.length} rutas (${p.length-o} sin histórico ocultas)</span>
          <button class="part-ver-todas ml-auto border border-outline-variant text-secondary hover:bg-surface-container-high px-md py-xs rounded text-[11px] uppercase" data-uid="${u}" data-nombre="${T(t)}">
            Ver todas (${p.length})
          </button>
        </div>`:""}
      </div>`}function f(){const t=d.length>0,p=[],h=new Set;l.forEach(u=>{h.has(u.grupo)||(v&&y.includes(u.grupo)?(y.forEach(g=>{const w=l.find(j=>j.grupo===g);p.push({nombre:w?.nombre||g,grupos:y,filtroGrupo:g})}),y.forEach(g=>h.add(g))):(p.push({nombre:u.nombre||u.grupo,grupos:[u.grupo]}),h.add(u.grupo)))}),console.log("[PART] gruposMostrar:",p.map(u=>u.nombre),"| hasHist:",t,"| histLen:",d.length),t&&p.forEach(u=>{const g=L(u.grupos,u.filtroGrupo||null);console.log("[PART] TABLA",u.nombre,"| filtroGrupo:",u.filtroGrupo,"| resultados:",g.length,"| primeraRuta:",g[0]?.rutaCodigo)}),a.innerHTML=`
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
        <div class="flex items-center justify-between flex-wrap gap-sm">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-primary">donut_large</span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Participación Rutas</h2>
            ${t?`<span class="text-[11px] text-secondary font-data-mono">${d.length.toLocaleString("es-CL")} registros · Histórico 6M</span>`:""}
          </div>
          <button id="part-sync-hist" class="border border-primary text-primary hover:bg-primary hover:text-white font-bold px-md py-sm rounded flex items-center gap-xs text-[12px] uppercase transition-colors">
            <span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Histórico
          </button>
        </div>
      </div>
      ${t?p.map(u=>n(u.nombre,L(u.grupos,u.filtroGrupo||null),r.has(u.nombre))).join(""):`
      <div class="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] p-md rounded">
        Sin datos históricos. Presione <b>Actualizar Histórico</b> (fuente FLETE 360, 6 meses móviles).
      </div>`}
    `,document.getElementById("part-sync-hist")?.addEventListener("click",async()=>{const u=document.getElementById("part-sync-hist");u&&(u.disabled=!0,u.textContent="Cargando...");try{const g=await ve(!0);g&&g.length>0?(d=g,ae(e).historico=g,P(`✓ Histórico actualizado: ${g.length} registros.`),f()):(P("No hay datos en caché. Cargue el CSV en Tarifas Clientes → Histórico.","error"),u&&(u.disabled=!1,u.innerHTML='<span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Histórico'))}catch(g){P("Error: "+g.message,"error"),u&&(u.disabled=!1,u.innerHTML='<span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Histórico')}}),a.querySelectorAll(".part-ver-todas").forEach(u=>{u.addEventListener("click",()=>{r.add(u.dataset.nombre),f()})}),a.querySelectorAll(".part-guardar-centro").forEach(u=>{u.addEventListener("click",()=>{const g=u.dataset.grupo,w=p.find(S=>S.nombre===g);if(!w)return;const j=L(w.grupos);if(!j.length){P("Sin datos para guardar.","error");return}try{s.participacionRutas=s.participacionRutas||{},j.forEach(S=>{const M={pct:Math.round(S.peso*1e4)/100,peso:S.peso,cluster:S.peso>=.3?1:S.peso>=.1?2:3,caracteristica:S.caracteristica};s.participacionRutas[S.rutaId]=M,s.participacionRutas[S.rutaCodigo]=M,(S._allRutaIds||[]).forEach(R=>{R&&(s.participacionRutas[R]=M)}),(S._allRutaCodigos||[]).forEach(R=>{R&&(s.participacionRutas[R]=M)})}),z(e),P(`✓ Participación guardada: ${j.length} rutas de ${g}.`)}catch(S){P("Error: "+S.message,"error")}})})}d.length===0?(a.innerHTML='<div class="flex items-center gap-sm text-secondary p-lg"><span class="material-symbols-outlined animate-spin">refresh</span> Cargando histórico...</div>',ve().then(t=>{t&&t.length>0&&(d=t,ae(e).historico=t),f()}).catch(()=>f())):f()}function Et(a,e,s){const d=e.logisticsCentres,r=q(e),i=s.variables,l=new Date;let b="";if(i.fechaUF){const m=Math.floor((l-new Date(i.fechaUF))/864e5);m>30&&(b=`<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px] ml-sm"><span class="material-symbols-outlined text-[14px]">warning</span> ${m} DÍAS SIN ACTUALIZAR</span>`)}else b='<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 font-label-caps text-[10px] ml-sm"><span class="material-symbols-outlined text-[14px]">warning</span> SIN FECHA</span>';a.innerHTML=`
    <div class="grid grid-cols-1 md:grid-cols-2 gap-lg mb-lg">
      <!-- Valor UF y Margen -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Valor UF y Margen de Ganancia</h3>
        <div class="grid grid-cols-2 gap-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">VALOR UF (CLP) ${b}</label>
            ${K("variables.valorUF",i.valorUF)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">FECHA ACTUALIZACIÓN UF</label>
            ${dt("variables.fechaUF",i.fechaUF)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">MARGEN DE GANANCIA (%)</label>
            ${K("variables.margenGanancia",i.margenGanancia)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">GPS / CELULAR (UF MENSUAL)</label>
            ${K("variables.gps.costoUF",i.gps.costoUF)}
          </div>
        </div>
        <p class="text-[11px] text-secondary mt-md">El costo GPS se prorratea dividiendo por los KM Mensuales Ofrecidos de cada centro/camión.</p>
      </div>

      <!-- Chofer -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Chofer — Remuneración y Comisión</h3>
        <div class="grid grid-cols-2 gap-md mb-md">
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">DÍAS HÁBILES MENSUALES</label>
            ${K("variables.chofer.diasHabiles",i.chofer.diasHabiles)}
          </div>
          <div class="space-y-xs">
            <label class="font-label-caps text-label-caps text-secondary block">COMISIÓN POR SERVICIO (%)</label>
            ${K("variables.chofer.comisionPct",i.chofer.comisionPct)}
          </div>
        </div>
        <p class="font-label-caps text-label-caps text-secondary mb-xs">SUELDO MÍNIMO POR CENTRO ORIGEN (CLP)</p>
        <div class="space-y-xs">
          ${r.map(m=>`
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary">${m.nombre}</span>
              ${K(`variables.chofer.sueldoMinimo.${m.repId}`,i.chofer.sueldoMinimo[m.repId])}
            </div>`).join("")}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-lg mb-lg">
      <!-- Neumáticos -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Desgaste de Neumáticos</h3>
        <div class="space-y-xs mb-md">
          <label class="font-label-caps text-label-caps text-secondary block">CICLO BASE (KM)</label>
          ${K("variables.neumaticos.ciclo",i.neumaticos.ciclo)}
        </div>
        <p class="font-label-caps text-label-caps text-secondary mb-xs">COSTO DE CAMBIO COMPLETO POR TIPO DE CAMIÓN</p>
        <div class="space-y-xs">
          ${pe.map(m=>`
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary">${m/1e3}.000 kg</span>
              ${K(`variables.neumaticos.costos.${m}`,i.neumaticos.costos[m])}
            </div>`).join("")}
        </div>
      </div>

      <!-- Factor Ruta -->
      <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm">
        <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Factor Ruta (Geográfico)</h3>
        <p class="text-[12px] text-secondary mb-md">Multiplicador aplicado al Costo Ruta Total según la característica de la ruta (ver Administración de Rutas).</p>
        <div class="space-y-xs">
          ${["NORMAL","ISLA","EXTREMA"].map(m=>`
            <div class="grid grid-cols-2 gap-md items-center">
              <span class="text-[12px] text-secondary font-bold">${m}</span>
              ${K(`variables.factorRuta.${m}`,i.factorRuta[m])}
            </div>`).join("")}
        </div>
      </div>
    </div>

    <!-- Mantención -->
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">Mantención Vehicular</h3>
      <div class="space-y-xs mb-md max-w-xs">
        <label class="font-label-caps text-label-caps text-secondary block">CICLO BASE AJUSTABLE (KM)</label>
        ${K("variables.mantencion.ciclo",i.mantencion.ciclo)}
      </div>
      <p class="font-label-caps text-label-caps text-secondary mb-xs">COSTO DE MANTENCIÓN POR CENTRO ORIGEN Y TIPO DE CAMIÓN</p>
      ${pt(r,(m,c)=>`variables.mantencion.costos.${m}|${c}`,(m,c)=>(i.mantencion.costos||{})[`${m}|${c}`])}
    </div>

    <!-- KM Mensuales Ofrecidos -->
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">
      <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface mb-md">KM Mensuales Ofrecidos</h3>
      <p class="text-[12px] text-secondary mb-md">Determina los denominadores de los prorrateos fijos (SOAP, Seguro, Mantención, Neumáticos, GPS). Carga masiva CSV: columnas Centro_SAP, Tipo_Camion_Kg, KM_Mensual.</p>
      <div class="flex items-center gap-md bg-surface-container-low p-md rounded mb-md">
        <span class="material-symbols-outlined text-secondary">upload_file</span>
        <div class="flex-1">
          <p class="font-body-md text-body-md font-bold text-on-surface">Carga masiva CSV — KM Mensuales Ofrecidos</p>
          <p class="text-[11px] text-secondary">Columnas: Centro_SAP, Tipo_Camion_Kg, KM_Mensual</p>
        </div>
        <input type="file" id="km-csv" accept=".csv" class="text-[12px]">
      </div>
      ${pt(r,(m,c)=>`kmOfrecidos.${m}|${c}`,(m,c)=>s.kmOfrecidos[`${m}|${c}`])}
    </div>

  `,document.getElementById("km-csv").addEventListener("change",m=>{const c=m.target.files[0];c&&Ue(c,E=>{let C=0;E.forEach(x=>{const y=d.find($=>$.id===(x.Centro_SAP||"").trim()),v=ut(x.Tipo_Camion_Kg);!y||!pe.includes(v)||(s.kmOfrecidos[`${Qe(e,y.id)}|${v}`]=Number(x.KM_Mensual)||0,C++)}),z(e),P(`${C} registros de KM Mensuales actualizados`),Et(a,e,s)})})}function X(a,e,s){const d=q(e),r=d.find(t=>t.centroIds.some(p=>["1001","1002","1003"].includes(String(p)))),i=d.find(t=>t.centroIds.some(p=>["1005"].includes(String(p)))),l=!!(r&&i),b=l?[...d.filter(t=>t!==r&&t!==i),{grupo:"__STGO_SB__",nombre:"Santiago + San Bernardo",centroIds:[...r?.centroIds||[],...i?.centroIds||[]],repId:r?.repId}].sort((t,p)=>(t.nombre||"").localeCompare(p.nombre||"","es")):d;let m=tt(e,s);if(se==="regional"?m=m.filter(t=>(t.ruta.tipo||"").toUpperCase()==="COMUNA"&&t.ruta.clasificRuta==="Regional"):se==="interregional"&&(m=m.filter(t=>t.ruta.clasificRuta==="Interregional")),B.size>0){const t=new Set(B);t.has("__STGO_SB__")&&l&&(t.delete("__STGO_SB__"),r&&t.add(r.grupo),i&&t.add(i.grupo)),m=m.filter(p=>t.has(p.ruta.origen_grupo))}l&&(B.size===0||B.has("__STGO_SB__")||B.has(r?.grupo)&&B.has(i?.grupo))&&(m=pa(m,r.grupo,i.grupo));const E=new Set(m.map(t=>t.ruta.destino||t.ruta.nombre||"").filter(Boolean));if(le&&(m=m.filter(t=>String(t.truckType?.capKg)===le)),Ce){const t=Ce.toLowerCase();m=m.filter(p=>(p.ruta.destino||p.ruta.nombre||"").toLowerCase().includes(t))}const C=se!=="interregional",x={};d.forEach(t=>{x[t.grupo]=t.nombre});const y=s.participacionRutas||{},v=new Map;(e.extraCosts||[]).filter(t=>t.activo!==!1).forEach(t=>{const p=`${t.zona_id}__${t.ejes}`,h=v.get(p)||{ida:0,vuelta:0};v.set(p,{ida:h.ida+(Number(t.costo_ida)||0),vuelta:h.vuelta+(Number(t.costo_vuelta)||0)})});function $(t,p){const h=p<=1e4?2:3,u=v.get(`${t.id_zona_transporte}__${h}`);return u?u.ida+u.vuelta:0}const _=["Centro","ID Ruta","Destino","Clasificación","Tipo Camión (Kg)","KM","Peajes","Comb. Ida","Comb. Vuelta","Seguros","Costos Extras","Mantención","Neumáticos","GPS","Rem. Chofer","Var. Chofer","Factor","Costo Vuelta","Costo Total","Costo/KM"],L=C?[..._,"Peso","T. Ponderada"]:_;function o(){return B.size===0?"Todos los centros":B.size===1?b.find(t=>B.has(t.grupo))?.nombre||"1 centro":`${B.size} centros seleccionados`}a.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm mb-lg">

      <div class="flex items-center justify-between mb-md border-b border-outline-variant pb-sm">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-primary">calculate</span>
          <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Motor de Costo — Resultados</h2>
        </div>
        <div class="flex items-center gap-sm">
          ${se!=="interregional"?`
          <button id="mc-actualizar" class="bg-primary hover:bg-[#930007] text-white font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">refresh</span> Actualizar Tarifas
          </button>`:""}
          <button id="mc-export" class="bg-surface border border-outline-variant hover:bg-surface-container-high text-on-surface font-bold px-md py-sm rounded flex items-center gap-sm text-xs uppercase">
            <span class="material-symbols-outlined text-[18px]">download</span> Exportar CSV
          </button>
        </div>
      </div>

      <!-- Toggle tipo de ruta -->
      <div class="flex items-center gap-xs mb-md">
        <span class="font-label-caps text-label-caps text-secondary mr-sm text-[11px] uppercase">Tipo:</span>
        ${[["regional","Regional"],["interregional","Interregional"],["todas","Todas"]].map(([t,p])=>`
        <button class="mc-tipo-btn px-md py-xs rounded border text-[12px] font-bold uppercase transition-colors ${se===t?"bg-primary text-white border-primary":"bg-white border-outline-variant text-on-surface hover:bg-surface-container-high"}"
          data-tipo="${t}">${p}</button>`).join("")}
      </div>

      <!-- Filtros -->
      <div class="flex flex-wrap items-end gap-md mb-md">

        <!-- Multi-select centros -->
        <div class="relative">
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">CENTRO ORIGEN</label>
          <button id="mc-centro-btn" class="border border-[#CED4DA] px-sm py-[9px] bg-white text-left w-56 font-body-md text-body-md flex justify-between items-center gap-sm">
            <span id="mc-centro-label">${o()}</span>
            <span class="material-symbols-outlined text-[18px] text-secondary flex-shrink-0">expand_more</span>
          </button>
          <div id="mc-centro-panel" class="hidden absolute z-50 bg-white border border-[#CED4DA] shadow-lg w-64 max-h-72 overflow-y-auto mt-1">
            <label class="flex items-center gap-sm p-sm hover:bg-surface-container-high cursor-pointer border-b border-outline-variant">
              <input type="checkbox" id="mc-c-all" ${B.size===0?"checked":""}>
              <span class="font-body-md text-body-md font-bold">Todos</span>
            </label>
            ${b.map(t=>`
            <label class="flex items-center gap-sm p-sm hover:bg-surface-container-high cursor-pointer">
              <input type="checkbox" class="mc-c-item" value="${T(t.grupo)}" ${B.has(t.grupo)?"checked":""}>
              <span class="font-body-md text-body-md">${T(t.nombre)}</span>
            </label>`).join("")}
          </div>
        </div>

        <!-- Tipo camión -->
        <div>
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">TIPO CAMIÓN (KG)</label>
          <select id="mc-f-capkg" class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-44">
            <option value="">Todos</option>
            <option value="5000"  ${le==="5000"?"selected":""}>5.000 Kg</option>
            <option value="10000" ${le==="10000"?"selected":""}>10.000 Kg</option>
            <option value="15000" ${le==="15000"?"selected":""}>15.000 Kg</option>
            <option value="28000" ${le==="28000"?"selected":""}>28.000 Kg</option>
          </select>
        </div>

        <!-- Búsqueda destino (datalist filtrado por centros) -->
        <div>
          <label class="font-label-caps text-label-caps text-secondary block mb-xs">BUSCAR DESTINO</label>
          <input id="mc-f-comuna" type="text" list="mc-destinos-list"
            placeholder="Filtrar destino..." value="${T(Ce)}"
            class="border border-[#CED4DA] p-sm font-body-md text-body-md bg-white w-52">
          <datalist id="mc-destinos-list">
            ${[...E].sort().map(t=>`<option value="${T(t)}">`).join("")}
          </datalist>
        </div>

        <!-- Limpiar filtros -->
        <button id="mc-reset" class="border border-outline-variant px-md py-sm text-[12px] text-secondary hover:bg-surface-container-high rounded flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px]">filter_alt_off</span> Limpiar
        </button>
      </div>

      <div class="text-[12px] text-secondary mb-sm">${m.length} fila(s) encontrada(s)</div>

      <!-- Tabla -->
      <div class="bg-surface border border-outline-variant overflow-hidden rounded overflow-x-auto">
        <table class="w-full zebra-table border-collapse text-[12px]">
          <thead>
            <tr class="bg-surface-container-high text-left border-b border-outline-variant">
              ${L.map((t,p)=>`<th class="p-md font-label-caps text-label-caps text-secondary uppercase whitespace-nowrap${p>2?" text-right":""}">${t}</th>`).join("")}
            </tr>
          </thead>
          <tbody class="font-data-mono text-data-mono">
            ${m.length===0?`<tr><td colspan="${L.length}" class="p-md text-center text-secondary">Sin resultados para los filtros seleccionados.</td></tr>`:m.slice(F*Le,(F+1)*Le).map(t=>{const h=(y[t.ruta.id]||y[t.ruta.codigo]||(t.ruta._allCodigos||[]).reduce((V,Z)=>V||y[Z],null)||(t.ruta._allIds||[]).reduce((V,Z)=>V||y[Z],null))?.pct||0,u=Math.round((t.item11_costoKmFinal||0)*h/100),g=t._merged?(x[t.ruta.origen_grupo]||t.ruta.origen_grupo)+"+SB":x[t.ruta.origen_grupo]||t.ruta.origen_grupo,w=(t.item3_soapKm||0)+(t.item4_seguroKm||0),j=t.truckType?.capKg||t.capKg||0,S=j?j.toLocaleString("es-CL"):"—",M=$(t.ruta,j),R=t.ruta.clasificRuta==="Interregional";return`<tr class="border-b border-outline-variant${R?" bg-blue-50/30":""}">
                    <td class="p-md font-bold whitespace-nowrap">${g}</td>
                    <td class="p-md">${t.ruta.codigo}</td>
                    <td class="p-md whitespace-nowrap">${t.ruta.destino||""}</td>
                    <td class="p-md text-right">${t.ruta.clasificRuta||""}</td>
                    <td class="p-md text-right">${S}</td>
                    <td class="p-md text-right">${t.km}</td>
                    <td class="p-md text-right">${O(t.item1_peajes)}</td>
                    <td class="p-md text-right">${O(t.combIda)}</td>
                    <td class="p-md text-right">${O(t.combVuelta)}</td>
                    <td class="p-md text-right">${O(w)}</td>
                    <td class="p-md text-right ${M>0?"text-amber-700 font-bold":""}">${M>0?O(M):"—"}</td>
                    <td class="p-md text-right">${O(t.item5_mantKm)}</td>
                    <td class="p-md text-right">${O(t.item6_neumKm)}</td>
                    <td class="p-md text-right">${O(t.item7_gpsKm)}</td>
                    <td class="p-md text-right">${O(t.item8_choferBaseDiario)}</td>
                    <td class="p-md text-right">${O(t.item9_varChofer)}</td>
                    <td class="p-md text-right font-bold">${(t.factorRuta||1).toFixed(2)}</td>
                    <td class="p-md text-right">${O(t.costoVuelta)}</td>
                    <td class="p-md text-right font-bold">${O(t.item10_costoRutaTotal)}</td>
                    <td class="p-md text-right font-bold text-primary">${O(t.item11_costoKmFinal)}</td>
                    ${C?`
                    <td class="p-md text-right">${R?"—":h.toFixed(2)+"%"}</td>
                    <td class="p-md text-right">${R?"—":O(u)}</td>`:""}
                  </tr>`}).join("")}
          </tbody>
        </table>
      </div>
      ${Xt(m.length,F,Le,"mc-pag-prev","mc-pag-next")}
    </div>
  `,a.querySelectorAll(".mc-tipo-btn").forEach(t=>{t.addEventListener("click",()=>{se=t.dataset.tipo,F=0,X(a,e,s)})});const n=document.getElementById("mc-centro-btn"),f=document.getElementById("mc-centro-panel");n?.addEventListener("click",t=>{t.stopPropagation(),f.classList.toggle("hidden")}),document.addEventListener("click",()=>f?.classList.add("hidden"),{once:!0}),document.getElementById("mc-c-all")?.addEventListener("change",()=>{B.clear(),a.querySelectorAll(".mc-c-item").forEach(t=>t.checked=!1),F=0,X(a,e,s)}),a.querySelectorAll(".mc-c-item").forEach(t=>{t.addEventListener("change",()=>{B.clear(),a.querySelectorAll(".mc-c-item:checked").forEach(p=>B.add(p.value)),F=0,X(a,e,s)})}),document.getElementById("mc-f-capkg")?.addEventListener("change",t=>{le=t.target.value,F=0,X(a,e,s)}),document.getElementById("mc-f-comuna")?.addEventListener("input",t=>{const p=t.target.selectionStart;Ce=t.target.value,F=0,X(a,e,s);const h=document.getElementById("mc-f-comuna");h&&(h.focus(),h.setSelectionRange(p,p))}),document.getElementById("mc-reset")?.addEventListener("click",()=>{B.clear(),le="",Ce="",F=0,X(a,e,s)}),document.getElementById("mc-pag-prev")?.addEventListener("click",()=>{F=Math.max(0,F-1),X(a,e,s)}),document.getElementById("mc-pag-next")?.addEventListener("click",()=>{F=Math.min(Math.ceil(m.length/Le)-1,F+1),X(a,e,s)}),document.getElementById("mc-actualizar")?.addEventListener("click",async()=>{const t=document.getElementById("mc-actualizar");t&&(t.disabled=!0,t.textContent="Calculando...");try{if(!ae(e).historico?.length){const g=await ve();g?.length&&(ae(e).historico=g)}const p=ke(e);p&&Object.keys(p).length>0&&(s.participacionRutas=p,z(e));const h=B.size===1?[...B][0]:"",u=Oe(e,s,h);P(`Tarifas actualizadas — ${u.size} tipo(s) de camión sincronizado(s)`),X(a,e,s)}finally{t&&(t.disabled=!1,t.textContent="Actualizar Tarifas")}}),document.getElementById("mc-export")?.addEventListener("click",()=>{const t=[..._,...C?["Peso_Pct","Tarifa_Ponderada"]:[]],p=m.map(h=>{const u=h._merged?(x[h.ruta.origen_grupo]||h.ruta.origen_grupo)+"+SB":x[h.ruta.origen_grupo]||h.ruta.origen_grupo,w=(y[h.ruta.id]||y[h.ruta.codigo]||(h.ruta._allCodigos||[]).reduce((W,ce)=>W||y[ce],null)||(h.ruta._allIds||[]).reduce((W,ce)=>W||y[ce],null))?.pct||0,j=Math.round((h.item11_costoKmFinal||0)*w/100),S=(h.item3_soapKm||0)+(h.item4_seguroKm||0),M=h.truckType?.capKg||h.capKg||0,R=$(h.ruta,M),V=h.ruta.clasificRuta==="Interregional",Z=[u,h.ruta.codigo,h.ruta.destino||"",h.ruta.clasificRuta||"",M||"",h.km,Math.round(h.item1_peajes),Math.round(h.combIda||0),Math.round(h.combVuelta||0),Math.round(S),Math.round(R),Math.round(h.item5_mantKm),Math.round(h.item6_neumKm),Math.round(h.item7_gpsKm),Math.round(h.item8_choferBaseDiario),Math.round(h.item9_varChofer),(h.factorRuta||1).toFixed(2),Math.round(h.costoVuelta||0),Math.round(h.item10_costoRutaTotal),Math.round(h.item11_costoKmFinal)];return C&&Z.push(V?"":w.toFixed(2),V?"":j),Z});Ie(`motor_costo_${se}_${Date.now()}.csv`,Ae(t,p)),P("CSV exportado")})}export{Xa as gruposReajuste,Ya as proponerReajusteCamiones,Wa as reajusteCamionesFilas,Qt as renderTariffTransportView,Na as setActiveSub};
