import{supabase as _}from"./supabase-client.js?v=fd17fd7d20";import{escapeHtml as h,showAlert as b}from"./utils.js";import{confirmar as U}from"./confirmar.js?v=84d7f13f40";const A=50,O=2e3,K="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",s={q:"",familia:"",filtro:"todos",page:0};let $=null,q=null,P=[],C=0,H=0;const r={id:0,nom:1,lon:2,anc:3,alt:4,pb:5,pv:6,fam:7,origen:8,manual:9,activo:10,revisar:11,upd:12,por:13},j=(e,t=3)=>e==null||e===""?"":Number(e).toLocaleString("es-CL",{minimumFractionDigits:0,maximumFractionDigits:t}),k=(e,t)=>e==null?'<span class="text-outline">—</span>':j(e,t),Q=e=>e[r.lon]!=null&&e[r.anc]!=null&&e[r.alt]!=null?Number(e[r.lon])*Number(e[r.anc])*Number(e[r.alt]):null;async function W(){try{const{data:e}=await _.auth.getUser();return e?.user?.email||null}catch{return null}}function R(e){if(e==null)return null;if(typeof e=="number")return isFinite(e)?e:null;let t=String(e).trim();if(!t)return null;t.includes(",")&&(t=t.replace(/\./g,"").replace(",","."));const a=parseFloat(t);return isFinite(a)?a:null}async function D(){const{data:e,error:t}=await _.rpc("fn_maestro_productos_resumen");return t?(console.error(t),b("Error al leer el maestro: "+t.message,"error"),null):e}async function Y(){const e=++H,{data:t,error:a}=await _.rpc("fn_maestro_productos_buscar",{p_q:s.q||null,p_familia:s.familia||null,p_filtro:s.filtro,p_limit:A,p_offset:s.page*A});return e!==H?!1:a?(console.error(a),b("Error al buscar productos: "+a.message,"error"),!1):(P=t?.rows||[],C=t?.total||0,!0)}async function le(e){$=e,e.innerHTML='<div class="text-secondary text-body-md p-md">Cargando maestro de productos…</div>',q=await D(),N()}function E(e,t,a,o,n=""){const c=s.filtro===e;return`<button data-kpi="${e}" class="text-left border rounded-lg px-md py-sm min-w-[140px] transition-colors ${c?"border-primary bg-primary/5":"border-outline-variant hover:bg-surface-container-low"}">
    <div class="flex items-center gap-xs text-[12px] uppercase tracking-wide text-secondary font-bold">
      <span class="material-symbols-outlined text-[16px] ${n}">${o}</span>${t}</div>
    <div class="text-headline-sm font-bold text-on-surface">${j(a||0,0)}</div></button>`}function N(){const e=q||{},t=e.familias||[];$.innerHTML=`
    <div class="bg-surface-container-lowest border border-outline-variant p-lg shadow-sm rounded-lg">
      <div class="flex items-center justify-between gap-md flex-wrap mb-md border-b border-outline-variant pb-sm">
        <div>
          <h3 class="text-headline-sm font-bold text-on-surface">MAESTROS – PRODUCTOS</h3>
          <p class="text-[13px] text-secondary">Medidas en metros · pesos en kg por unidad · fuente prioritaria de pesos del Plan de Carga</p>
        </div>
        <div class="flex items-center gap-sm flex-wrap">
          <button id="mp-excel" class="border border-outline-variant text-on-surface px-md py-sm rounded-lg text-body-md font-bold hover:bg-surface-container-high">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">upload_file</span>Cargar Excel SAP</button>
          <input id="mp-file" type="file" accept=".xlsx,.xls" class="hidden"/>
          <button id="mp-nuevo" class="bg-primary text-on-primary px-md py-sm rounded-lg text-body-md font-bold hover:opacity-90 transition-opacity">
            <span class="material-symbols-outlined text-[18px] align-middle mr-xs">add</span>Nuevo producto</button>
        </div>
      </div>
      <div class="flex gap-sm flex-wrap mb-md">
        ${E("todos","Activos",e.activos,"inventory_2")}
        ${E("sin_peso","Sin peso bruto",e.sin_peso,"scale","text-error")}
        ${E("con_medidas","Con medidas",e.con_medidas,"straighten")}
        ${E("sin_pv","Sin peso vol.",(e.activos||0)-(e.con_pv||0),"deployed_code")}
        ${E("revisar","Dato a revisar",e.revisar,"warning","text-error")}
        ${E("manual","Editados / manuales",e.manuales,"edit_note")}
        ${E("inactivos","Inactivos",e.inactivos,"block")}
      </div>
      <div class="flex items-center gap-md flex-wrap mb-md">
        <label class="flex items-center gap-xs border border-outline-variant rounded-lg px-md py-sm flex-1 min-w-[240px] max-w-[520px] focus-within:border-primary">
          <span class="material-symbols-outlined text-[18px] text-secondary">search</span>
          <input id="mp-buscar" value="${h(s.q)}" placeholder="Buscar por ID material o nombre…" class="w-full outline-none text-body-md bg-transparent" autocomplete="off"/></label>
        <select id="mp-fam" class="border border-outline-variant rounded-lg px-md py-sm text-body-md bg-transparent">
          <option value="">Todas las familias</option>
          ${t.map(n=>`<option value="${h(n)}" ${s.familia===n?"selected":""}>${h(n)}</option>`).join("")}
        </select>
        <span class="text-[12px] text-secondary">${e.actualizado?"Última actualización: "+new Date(e.actualizado).toLocaleString("es-CL"):""}</span>
      </div>
      <div id="mp-tabla"><div class="text-secondary text-body-md p-md">Cargando…</div></div>
    </div>`;let a;$.querySelector("#mp-buscar").addEventListener("input",n=>{clearTimeout(a),a=setTimeout(()=>{s.q=n.target.value.trim(),s.page=0,T()},250)}),$.querySelector("#mp-fam").addEventListener("change",n=>{s.familia=n.target.value,s.page=0,T()}),$.querySelectorAll("[data-kpi]").forEach(n=>n.addEventListener("click",()=>{s.filtro=n.dataset.kpi,s.page=0,N()})),$.querySelector("#mp-nuevo").addEventListener("click",()=>B(null));const o=$.querySelector("#mp-file");$.querySelector("#mp-excel").addEventListener("click",()=>o.click()),o.addEventListener("change",()=>{const n=o.files?.[0];o.value="",n&&oe(n)}),T()}async function T(){const e=$?.querySelector("#mp-tabla");if(!e)return;e.style.opacity="0.6";const t=await Y();e.style.opacity="",t&&Z()}function Z(){const e=$.querySelector("#mp-tabla");if(!e)return;const t=Math.max(1,Math.ceil(C/A)),a=(o,n="")=>`<th class="py-sm pr-md ${n}">${o}</th>`;e.innerHTML=`
    <div class="overflow-x-auto">
      <table class="w-full text-body-md">
        <thead><tr class="text-left text-[12px] uppercase tracking-wide text-secondary border-b border-outline-variant">
          ${a("ID Material")}${a("Nombre Material")}${a("Familia Producto")}
          ${a("Longitud (m)","text-right")}${a("Ancho (m)","text-right")}${a("Altura (m)","text-right")}${a("Vol. (m³)","text-right")}
          ${a("Peso Bruto (kg)","text-right")}${a("Peso Volumétrico (kg)","text-right")}${a("","text-right")}</tr></thead>
        <tbody>
          ${P.length===0?'<tr><td colspan="10" class="py-lg text-center text-secondary">Sin productos para el filtro.</td></tr>':P.map((o,n)=>`
            <tr class="border-b border-outline-variant/60 hover:bg-surface-container-low ${o[r.activo]?"":"opacity-60"}">
              <td class="py-sm pr-md font-data-mono text-[13px] whitespace-nowrap">${h(o[r.id])}</td>
              <td class="py-sm pr-md font-semibold">${h(o[r.nom])}
                ${o[r.revisar]?'<span title="Medida mayor a 20 m: revisar" class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-error-container text-on-error-container">Revisar</span>':""}
                ${o[r.manual]?'<span title="Editado en la plataforma: la recarga SAP no sobrescribe medidas ni pesos" class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-surface-container-high text-secondary">Editado</span>':""}
                ${o[r.origen]==="MANUAL"?'<span class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-surface-container-high text-secondary">Manual</span>':""}
                ${o[r.activo]?"":'<span class="ml-xs text-[11px] font-bold px-sm py-[1px] rounded-full bg-error-container text-on-error-container">Inactivo</span>'}</td>
              <td class="py-sm pr-md text-[13px] whitespace-nowrap">${o[r.fam]?h(o[r.fam]):'<span class="text-outline">—</span>'}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${k(o[r.lon])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${k(o[r.anc])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${k(o[r.alt])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px] text-secondary">${k(Q(o),4)}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px] ${o[r.pb]==null?"text-error":""}">${k(o[r.pb])}</td>
              <td class="py-sm pr-md text-right font-data-mono text-[13px]">${k(o[r.pv])}</td>
              <td class="py-sm pr-md text-right whitespace-nowrap">
                <button data-edit="${n}" title="Editar" class="text-secondary hover:text-primary p-xs"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                <button data-toggle="${n}" title="${o[r.activo]?"Desactivar":"Activar"}" class="text-secondary ${o[r.activo]?"hover:text-error":"hover:text-primary"} p-xs">
                  <span class="material-symbols-outlined text-[20px]">${o[r.activo]?"toggle_on":"toggle_off"}</span></button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between mt-md text-[13px] text-secondary">
      <span>${C?`${s.page*A+1}–${Math.min(C,(s.page+1)*A)} de ${j(C,0)}`:"0 resultados"}</span>
      <div class="flex items-center gap-xs">
        <button data-pg="-1" ${s.page===0?"disabled":""} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_left</span></button>
        <span>Página ${s.page+1} de ${j(t,0)}</span>
        <button data-pg="1" ${s.page>=t-1?"disabled":""} class="p-xs rounded-lg hover:bg-surface-container-high disabled:opacity-30"><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
    </div>`,e.querySelectorAll("[data-pg]").forEach(o=>o.addEventListener("click",()=>{s.page+=Number(o.dataset.pg),T()})),e.querySelectorAll("[data-edit]").forEach(o=>o.addEventListener("click",()=>B(P[Number(o.dataset.edit)]))),e.querySelectorAll("[data-toggle]").forEach(o=>o.addEventListener("click",()=>te(P[Number(o.dataset.toggle)])))}function ee(e,t){const a=document.createElement("div");a.className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md",a.innerHTML=`
    <div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <h3 class="text-headline-sm font-bold text-on-surface">${h(e)}</h3>
        <button data-close class="text-secondary hover:text-error"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="p-lg">${t}</div>
    </div>`,document.body.appendChild(a);const o=c=>{c.key==="Escape"&&n()},n=()=>{a.remove(),document.removeEventListener("keydown",o)};return document.addEventListener("keydown",o),a.querySelector("[data-close]").addEventListener("click",n),a.addEventListener("click",c=>{c.target===a&&n()}),{wrap:a,close:n}}function S(e,t,a="",o="",n=""){return`<label class="block mb-sm ${n}">
      <span class="text-[12px] uppercase tracking-wide text-secondary font-bold">${e}</span>
      <input id="${t}" value="${h(a??"")}" ${o}
        class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none disabled:opacity-60" /></label>`}function B(e){const t=!e,a=p=>e&&e[r[p]]!=null?String(e[r[p]]).replace(".",","):"",o=q?.familias||[],n='inputmode="decimal" autocomplete="off" placeholder="—"',{wrap:c,close:f}=ee(t?"Nuevo producto":`Editar producto ${e[r.id]}`,`
    <div class="grid grid-cols-2 gap-x-md">
      ${S("ID Material *","f-id",t?"":e[r.id],t?'autocomplete="off"':"disabled")}
      <label class="block mb-sm"><span class="text-[12px] uppercase tracking-wide text-secondary font-bold">Familia Producto</span>
        <input id="f-fam" list="f-fam-list" value="${h(t?"":e[r.fam]||"")}" autocomplete="off" style="text-transform:uppercase"
          class="mt-xs w-full border border-outline-variant rounded-lg px-md py-sm text-body-md focus:border-primary outline-none"/>
        <datalist id="f-fam-list">${o.map(p=>`<option value="${h(p)}">`).join("")}</datalist></label>
    </div>
    ${S("Nombre Material *","f-nom",t?"":e[r.nom],'autocomplete="off" maxlength="80" style="text-transform:uppercase"')}
    <div class="grid grid-cols-3 gap-x-md">
      ${S("Longitud (m)","f-lon",a("lon"),n)}
      ${S("Ancho (m)","f-anc",a("anc"),n)}
      ${S("Altura (m)","f-alt",a("alt"),n)}
    </div>
    <div class="grid grid-cols-2 gap-x-md">
      ${S("Peso Bruto (kg / un)","f-pb",a("pb"),n)}
      ${S("Peso Volumétrico (kg / un)","f-pv",a("pv"),n)}
    </div>
    <p id="f-aviso" class="text-[12px] text-error mb-sm hidden"></p>
    ${t?"":`<label class="flex items-start gap-sm mt-xs mb-md text-body-md">
      <input id="f-man" type="checkbox" ${e[r.manual]?"checked":""} class="w-4 h-4 mt-[3px]"/>
      <span>Mantener mis valores ante la recarga del Excel SAP<br><span class="text-[12px] text-secondary">Al guardar un cambio de medidas o pesos queda marcado. Desmárcalo para que la próxima recarga SAP vuelva a mandar.</span></span></label>`}
    <div class="flex justify-end gap-sm">
      <button data-cancel class="px-md py-sm rounded-lg text-secondary hover:bg-surface-container-high">Cancelar</button>
      <button data-save class="bg-primary text-on-primary px-md py-sm rounded-lg font-bold hover:opacity-90">Guardar</button>
    </div>`);setTimeout(()=>c.querySelector(t?"#f-id":"#f-lon")?.focus(),0);const u=c.querySelector("#f-aviso"),v=p=>R(c.querySelector(p).value),L=()=>{const d=[v("#f-lon"),v("#f-anc"),v("#f-alt")].filter(x=>x!=null).some(x=>x>20)?"Ojo: una medida supera 20 m. Las medidas van en METROS (ej.: 2,44).":"";u.textContent=d,u.classList.toggle("hidden",!d)};["#f-lon","#f-anc","#f-alt"].forEach(p=>c.querySelector(p).addEventListener("input",L)),c.querySelector("[data-cancel]").addEventListener("click",f),c.querySelector("[data-save]").addEventListener("click",async p=>{const d=c.querySelector("#f-id").value.trim(),x=c.querySelector("#f-nom").value.trim().replace(/\s+/g," ").toUpperCase(),l=c.querySelector("#f-fam").value.trim().toUpperCase()||null,i={longitud:v("#f-lon"),ancho:v("#f-anc"),altura:v("#f-alt"),peso_bruto:v("#f-pb"),peso_volumetrico:v("#f-pv")};if(!d){b("El ID Material es obligatorio","error");return}if(!x){b("El nombre del material es obligatorio","error");return}for(const[m,w]of Object.entries(i)){if(w!=null&&w<0){b(`Valor negativo en ${m.replace("_"," ")}`,"error");return}w===0&&(i[m]=null)}const g=p.currentTarget;g.disabled=!0;let y;if(t){const{data:m}=await _.from("maestro_productos").select("id_material,nombre_material,activo").eq("id_material",d).maybeSingle();if(m){g.disabled=!1,b(`El ID ${d} ya existe: ${m.nombre_material}${m.activo?"":" (inactivo)"}`,"error");return}({error:y}=await _.from("maestro_productos").insert({id_material:d,nombre_material:x,familia_producto:l,...i,origen:"MANUAL",editado_manual:!0,activo:!0}))}else{const m=["lon","anc","alt","pb","pv"].some((z,J)=>{const I=Object.values(i)[J],F=e[r[z]]==null?null:Number(e[r[z]]);return(I==null?null:Math.round(I*1e4))!==(F==null?null:Math.round(F*1e4))}),w=c.querySelector("#f-man").checked,M=m?w||!e[r.manual]:w;({error:y}=await _.from("maestro_productos").update({nombre_material:x,familia_producto:l,...i,editado_manual:M}).eq("id_material",e[r.id]))}if(y){g.disabled=!1,b("Error al guardar: "+y.message,"error");return}b(t?`Producto ${d} agregado`:"Producto actualizado","success"),f(),t&&(s.q=d,s.filtro="todos",s.familia="",s.page=0),q=await D(),N()})}async function te(e){if(!e)return;const t=!e[r.activo];if(!await U(`¿${t?"Activar":"Desactivar"} el material ${e[r.id]} · ${e[r.nom]}?${t?"":`

No se elimina. Mientras esté inactivo, el Plan de Carga usa el peso que informa SAP.`}`,{aceptar:t?"Activar":"Desactivar",tono:t?"normal":"peligro",icono:t?"toggle_on":"toggle_off"}))return;const{error:a}=await _.from("maestro_productos").update({activo:t}).eq("id_material",e[r.id]);if(a){b("Error: "+a.message,"error");return}b(t?"Material activado":"Material desactivado","success"),q=await D(),N()}function ae(){return window.XLSX?Promise.resolve(window.XLSX):new Promise((e,t)=>{const a=document.createElement("script");a.src=K,a.async=!0,a.onload=()=>window.XLSX?e(window.XLSX):t(new Error("No se pudo cargar el lector de Excel")),a.onerror=()=>t(new Error("No se pudo cargar el lector de Excel")),document.head.appendChild(a)})}const V=e=>String(e??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");function G(e,t){let a=document.getElementById("mp-prog");a||(a=document.createElement("div"),a.id="mp-prog",a.className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md",a.innerHTML=`<div class="bg-surface-container-lowest rounded-lg shadow-xl w-full max-w-md p-lg">
      <h3 class="text-headline-sm font-bold text-on-surface mb-sm">Cargando maestro de productos</h3>
      <p id="mp-prog-t" class="text-body-md text-secondary mb-md"></p>
      <div class="h-2 rounded-full bg-surface-container-high overflow-hidden"><div id="mp-prog-b" class="h-full bg-primary transition-all" style="width:0%"></div></div></div>`,document.body.appendChild(a)),a.querySelector("#mp-prog-t").textContent=e,a.querySelector("#mp-prog-b").style.width=Math.round(t)+"%"}const X=()=>document.getElementById("mp-prog")?.remove();async function oe(e){try{G("Leyendo el archivo…",3);const t=await ae(),a=t.read(await e.arrayBuffer(),{type:"array"}),o=a.Sheets[a.SheetNames[0]],n=t.utils.sheet_to_json(o,{header:1,raw:!0,defval:null});if(!n.length)throw new Error("El archivo está vacío");const c=n[0].map(V),f=(...l)=>{for(const i of l){const g=c.indexOf(V(i));if(g>=0)return g}return-1},u={id:f("Material"),nom:f("Texto breve de material"),sm:f("SM"),fam:f("Jquía.productos","Jerarquia productos"),lon:f("Longitud"),anc:f("Ancho"),alt:f("Altura"),pb:f("Peso bruto"),pv:f("Tamaño/Dimens.","Tamano/Dimens.")},v=Object.entries(u).filter(([,l])=>l<0).map(([l])=>l);if(v.length)throw new Error("Faltan columnas en el Excel: "+v.join(", ")+". Usa la exportación SAP de la maestra (MESTARO_PROD).");const L=[],p=[];for(let l=1;l<n.length;l++){const i=n[l];if(!i)continue;const g=String(i[u.id]??"").trim().replace(/\.0+$/,"");if(!g)continue;const y=i[u.sm];if(y!=null&&String(y).trim()!==""){p.push(g);continue}const m=w=>{const M=R(w);return M==null||M<=0?0:Math.round(M*1e4)/1e4};L.push([g,String(i[u.nom]??"").trim(),m(i[u.lon]),m(i[u.anc]),m(i[u.alt]),m(i[u.pb]),m(i[u.pv]),String(i[u.fam]??"").trim()])}if(X(),!await U(`¿Cargar ${L.length.toLocaleString("es-CL")} productos al maestro?

${p.length.toLocaleString("es-CL")} filas con valor en SM se omiten (y se inactivan si ya existían).
Los productos editados en la plataforma conservan sus medidas y pesos.`,{aceptar:"Cargar",tono:"normal",icono:"upload_file"}))return;const d={recibidos:0,nuevos:0,actualizados:0,sin_cambio:0,inactivados:0},x=Math.max(1,Math.ceil(L.length/O));for(let l=0;l<x;l++){G(`Enviando lote ${l+1} de ${x}…`,5+95*(l/x));const i={r:L.slice(l*O,(l+1)*O)};l===x-1&&(i.b=p);const{data:g,error:y}=await _.rpc("fn_maestro_productos_cargar",{p:i});if(y)throw new Error(`Lote ${l+1}: ${y.message}`);Object.keys(d).forEach(m=>{d[m]+=Number(g?.[m]||0)})}X(),b(`Maestro cargado: ${d.nuevos} nuevos · ${d.actualizados} actualizados · ${d.sin_cambio} sin cambio · ${d.inactivados} inactivados`,"success"),s.page=0,q=await D(),N(),console.info("[maestro-productos] carga",{...d,por:await W()})}catch(t){X(),console.error(t),b("Error al cargar el Excel: "+(t?.message||t),"error")}}export{le as renderMaestroProductos};
