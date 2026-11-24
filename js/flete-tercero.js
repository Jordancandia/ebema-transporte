import{supabase as Ae}from"./supabase-client.js?v=fd17fd7d20";import{getDatabase as Me,loadRoutesData as Fe}from"./data.js?v=6ce8cb5f60";const C={red:"#C0000C",red2:"#EE1B22",redL:"#E88A8F",grey:"#6B6E70",greyL:"#A9ACAE",ink:"#333333",grid:"#D9D5CF",amber:"#B5730B"};let ie=null,H="dashboard",ue="Todos",I=null,B=null,fe="Todos";function lt(e){["dashboard","seguimiento","vencidos","en_curso"].indexOf(e)>=0&&(H=e)}const Ie=new Intl.NumberFormat("es-CL",{maximumFractionDigits:0}),j=new Intl.NumberFormat("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}),G=e=>e==null?"–":j.format(e)+"%",g=e=>e==null?"–":Ie.format(e),Z=e=>e==null?"–":j.format(e)+" d",je={"01":"ene","02":"feb","03":"mar","04":"abr","05":"may","06":"jun","07":"jul","08":"ago","09":"sep",10:"oct",11:"nov",12:"dic"},se=e=>e&&je[String(e).slice(5,7)]+" "+String(e).slice(2,4);function A(e){return e?new Date(e+"T00:00:00").toLocaleDateString("es-CL",{day:"2-digit",month:"2-digit",year:"numeric"}):"–"}function z(e){return e?new Date(e+"T00:00:00"):null}function me(e){const t=e.getDay();return t===0||t===6}function Oe(e){const t=new Date(e);for(t.setDate(t.getDate()+1);me(t);)t.setDate(t.getDate()+1);return t}function O(e,t){if(!e||!t)return null;if(t<=e)return 0;let o=0;const i=new Date(e);for(i.setDate(i.getDate()+1);i<=t;)me(i)||o++,i.setDate(i.getDate()+1);return o}const Ve=["Creación del Pedido","Recepción en CD","En Tránsito","En Bodega Destino","Entregado a Cliente"],He=[{label:"1. Creación → Recepción CD",get:e=>e.dCreaRecep},{label:"2. Recepción CD → Traslado",get:e=>e.dRecepTras},{label:"3. Traslado → Recepción Sucursal",get:e=>e.dTrasRecSuc},{label:"4. Recepción Sucursal → Entrega Cliente",get:e=>e.dRecSucEnt}];function Ne(e){const t=He.map(d=>{const a=e.map(d.get).filter(u=>u!=null);return{...d,prom:a.length?T(a):null}}),o=e.map(d=>d.dTotal).filter(d=>d!=null),i=o.length?T(o):null,r=e.map(d=>d.slaOfrecido).filter(d=>d!=null),v=r.length?T(r):null,f=t.reduce((d,a)=>d+(a.prom||0),0)||1,m=t.reduce((d,a)=>a.prom!=null&&(d==null||a.prom>d.prom)?a:d,null);return{etapas:t,leadTotal:i,slaProm:v,sumaEtapas:f,maxEtapa:m,n:e.length}}function ze(e){const t=new Date;t.setHours(0,0,0,0);const o=z(e.fecha_creacion),i=z(e.fecha_disponible_material),r=z(e.fecha_recep_cd),v=z(e.fecha_traslado),f=z(e.fecha_recep_sucursal),m=z(e.fecha_entrega_cliente),d=/RET/i.test(e.condicion_expedicion||""),a=d?f:m,u=!!m,p=!!a,n=!p&&!!i&&t>i,l=p||n,R=Number(e.cantidad_bultos)||0,_=Number(e.bultos_entrega_cliente)||0,S=d?Number(e.bultos_recep_sucursal)||0:_;let s=null,c=null,x=null,b=null;l&&(s=p&&i?a<=i:!1,c=S>=R&&R>0,x=s&&c?1:0,b=R>0?Math.min(S/R,1)*100:null);const $=!r,y=!v,D=!f,X=!m,N=$||y||D||X,Y=N&&!!i&&t>i,J=N&&!!i&&t<=i,E=$||y?"1003":e.punto_expedicion,P=[$&&"Recepción CD",y&&"Traslado",D&&"Recepción Sucursal",X&&"Entrega Cliente"].filter(Boolean).join(" + "),Q=Y?O(i,t):null,oe=J?O(t,i):null,ae=m?"Entregado a Cliente":f?d?"Listo para Retiro en Sucursal":"En Bodega Destino":v?"En Tránsito":r?"Recepción en CD (sin traslado)":"Sin Recepción en CD";let L,F;u?(L=4,F="Entregado a Cliente"):f?(L=3,F=d?"Listo para Entrega Cliente":"En Bodega Destino"):v?(L=2,F="En Tránsito"):r?(L=1,F="Recepción en CD"):(L=0,F="Creación del Pedido");const Se=O(o,r),De=O(r,v),Be=O(v,f),Pe=O(f,m),Le=O(o,m),ke=o&&i?O(Oe(o),i):null;return{...e,entregado:u,cumplido:p,vencido:n,evaluable:l,onTime:s,inFull:c,otif:x,fillRate:b,bultosEvento:S,pendiente:N,vencidoPend:Y,enCurso:J,centroResp:E,etapasPend:P,diasAtraso:Q,diasParaVencer:oe,estadoOp:ae,estadoIdx:L,estadoLabel:F,esRetiro:d,mesCreacion:e.fecha_creacion?String(e.fecha_creacion).slice(0,7):null,dCreaRecep:Se,dRecepTras:De,dTrasRecSuc:Be,dRecSucEnt:Pe,dTotal:Le,slaOfrecido:ke}}async function qe(){if(I)return I;const{data:e,error:t}=await Ae.from("ind_flete_tercero").select("*").order("fecha_creacion",{ascending:!1});if(t)throw t;const o=(e||[]).map(ze),i=e&&e[0]?e.reduce((r,v)=>v.loaded_at>r?v.loaded_at:r,e[0].loaded_at):null;return I={rows:o,lastLoad:i},I}function Ge(e){try{const o=(Me().logisticsCentres||[]).find(i=>String(i.id)===String(e));return o?o.nombre:null}catch{return null}}function M(e){const t=Ge(e);return t?`${e} · ${t}`:`${e||"–"}`}async function dt(e){ie=e;try{await Fe()}catch{}ve();try{await qe(),xe()}catch(t){U().innerHTML=Ue(t)}}function ve(){ie.innerHTML=`
  <div class="w-full mx-auto" style="max-width:1760px">
    <div class="flex items-center justify-between gap-md flex-wrap mb-md">
      <div class="text-headline-sm font-bold">Flete Tercero · ${{seguimiento:"Seguimiento de Pedidos",vencidos:"Pedidos Vencidos",en_curso:"Pedidos en Curso"}[H]||"Nivel de Servicio"}</div>
      <span class="text-[13px] text-secondary border border-surface-variant rounded-full px-md py-[3px]">Actualización diaria automática · Supabase</span>
    </div>
    <div class="flex gap-sm mb-lg border-b border-surface-variant">
      ${ee("dashboard","monitoring","Nivel de Servicio")}
      ${ee("seguimiento","search","Seguimiento por Pedido")}
      ${ee("vencidos","event_busy","Pedidos Vencidos")}
      ${ee("en_curso","pending_actions","Pedidos en Curso")}
    </div>
    <div id="fter_body"></div>
  </div>`,ie.querySelectorAll("[data-fter-tab]").forEach(e=>{e.addEventListener("click",()=>{H=e.getAttribute("data-fter-tab"),ve(),xe()})})}function ee(e,t,o){return`<button data-fter-tab="${e}" class="flex items-center gap-1 px-md py-sm text-body-md font-semibold border-b-2 transition-colors ${H===e?"border-primary text-primary":"border-transparent text-secondary hover:text-primary"}">
    <span class="material-symbols-outlined text-[18px]">${t}</span>${o}
  </button>`}function U(){return document.getElementById("fter_body")}function xe(){H==="seguimiento"?Ke():H==="vencidos"?tt():H==="en_curso"?nt():We()}function ct(){return'<div class="flex items-center justify-center py-xl text-secondary gap-2"><span class="material-symbols-outlined animate-spin">progress_activity</span>Cargando datos de flete tercero…</div>'}function Ue(e){return`<div class="bg-error-container text-on-error-container rounded-xl p-lg">No se pudieron cargar los datos: ${e&&e.message||e}</div>`}function We(){const{rows:e,lastLoad:t}=I,o=e.filter(s=>s.evaluable),i=e.filter(s=>!s.evaluable).length,r=o.length?T(o.map(s=>s.otif*100)):null,v=o.length?T(o.map(s=>s.fillRate)):null,f=V(e.map(s=>s.condicion_expedicion)),m=f.map(s=>{const c=o.filter(x=>x.condicion_expedicion===s);return{tipo:s,n:c.length,otif:c.length?T(c.map(x=>x.otif*100)):null,fill:c.length?T(c.map(x=>x.fillRate)):null}}).sort((s,c)=>c.n-s.n),d=V(e.map(s=>s.punto_expedicion)).sort(),a=d.map(s=>{const c=o.filter(x=>x.punto_expedicion===s);return{centro:s,n:c.length,otif:c.length?T(c.map(x=>x.otif*100)):null,fill:c.length?T(c.map(x=>x.fillRate)):null}}).sort((s,c)=>c.n-s.n),u=V(e.map(s=>s.mesCreacion)).filter(Boolean).sort(),p=s=>{const c=s==="Todos"?o:o.filter(x=>x.punto_expedicion===s);return u.map(x=>{const b=c.filter($=>$.mesCreacion===x);return{mes:x,n:b.length,otif:b.length?T(b.map($=>$.otif*100)):null,fill:b.length?T(b.map($=>$.fillRate)):null}})},n=u.map(s=>{const c=e.filter($=>$.mesCreacion===s),x=c.length||1,b={};return f.forEach($=>{b[$]=c.filter(y=>y.condicion_expedicion===$).length}),{mes:s,total:c.length,porT:b,pct:Object.fromEntries(f.map($=>[$,b[$]/x*100]))}});U().innerHTML=`
    <div class="text-[13px] text-secondary mb-md">${t?`Última carga de datos: ${new Date(t).toLocaleString("es-CL")}`:""} · ${e.length} pedidos en total</div>

    <!-- 1. Nivel de servicio general -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${w("Pedidos Evaluables",g(o.length),`de ${e.length} pedidos totales`)}
      ${w("OTIF",G(r),"a tiempo y completos","",pe(r,k.otif))}
      ${w("Fill Rate",G(v),"% bultos entregados","",pe(v,k.fill))}
      ${w("En Proceso",g(i),"aún no vencidos")}
    </div>

    <!-- 2. Por tipo de servicio -->
    ${q("Nivel de Servicio por Tipo de Servicio")}
    <div class="text-[13px] text-secondary mb-sm">Retira (CLI-RET): se considera cumplido cuando el material está disponible en sucursal (Recepción Sucursal). Despacho: entrega al cliente.</div>
    ${Ee(m.map(s=>({label:h(s.tipo||"–"),n:s.n,otif:s.otif,fill:s.fill})),"Condición expedición")}

    <!-- 3. Por centro destino -->
    ${q("Nivel de Servicio por Centro Destino")}
    <div class="text-[13px] text-secondary mb-sm">Ordenado por cantidad de pedidos evaluables. La marca negra es la meta.</div>
    ${Ee(a.map(s=>({label:h(M(s.centro)),n:s.n,otif:s.otif,fill:s.fill})),"Centro destino")}

    <!-- 4. Evolutivo mensual -->
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">Evolutivo Nivel de Servicio General (mes de creación)</div>
      <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Destino:
        <select id="fter_centro_filtro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
          <option value="Todos">Todos</option>
          ${d.map(s=>`<option value="${s}">${h(M(s))}</option>`).join("")}
        </select>
      </label>
    </div>
    <div id="fter_evolutivo"></div>

    <!-- 5. Mix mensual por tipo de servicio -->
    ${q("Evolutivo Mensual de Pedidos por Tipo de Servicio")}
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg">
      ${we(f.map((s,c)=>({n:s,c:Re(c)})))}
      ${ot(u.map(se),u.map(s=>n.find(c=>c.mes===s)),f)}
    </div>

    <!-- 6. Cuello de botella -->
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">Cuello de Botella — Días Promedio por Etapa (hábiles)</div>
      <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Destino:
        <select id="fter_centro_cuello" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
          <option value="Todos">Todos</option>
          ${d.map(s=>`<option value="${s}">${h(M(s))}</option>`).join("")}
        </select>
      </label>
    </div>
    <div id="fter_cuello"></div>
  `;const l=document.getElementById("fter_centro_filtro"),R=()=>{const s=p(l.value);document.getElementById("fter_evolutivo").innerHTML=it([{n:"OTIF %",values:s.map(c=>c.otif),color:C.red},{n:"Fill Rate %",values:s.map(c=>c.fill),color:C.grey}],s.map(c=>se(c.mes)),{v:k.otif,short:"Meta "+k.otif+"%"})+'<details class="mb-lg -mt-md"><summary class="cursor-pointer text-[14px] font-semibold text-secondary py-1">Ver tabla mensual</summary>'+K(["Mes","Pedidos Evaluables","OTIF %","Fill Rate %"],s.map(c=>[se(c.mes),g(c.n),Ce(c.otif,k.otif),Ce(c.fill,k.fill)]))+"</details>"};l.value=fe,l.addEventListener("change",()=>{fe=l.value,R()}),R();const _=document.getElementById("fter_centro_cuello"),S=()=>{const s=_.value,c=s==="Todos"?e:e.filter(b=>b.punto_expedicion===s),x=Ne(c);document.getElementById("fter_cuello").innerHTML=`
      <div class="text-[13px] text-secondary mb-sm">${g(x.n)} pedidos considerados${s!=="Todos"?" en "+h(M(s)):""}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
        ${w("Lead Time Total",Z(x.leadTotal),"Creación → Entrega, real")}
        ${w("SLA Ofrecido",Z(x.slaProm),"Creación +1 hábil → Promesa")}
        ${function(){const b=x.leadTotal!=null&&x.slaProm!=null?x.leadTotal-x.slaProm:null;return w("Diferencia",(b!=null&&b>0?"+":"")+Z(b),"Real − SLA ofrecido","",b==null?null:b>0?{c:"#C0000C",t:"Sobre el SLA"}:{c:"#1E8449",t:"Dentro del SLA"})}()}
      </div>
      <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-xl">
      ${at(x.etapas.map(b=>({label:b.label,value:b.prom,isMax:x.maxEtapa===b,share:b.prom!=null&&x.sumaEtapas?b.prom/x.sumaEtapas*100:null})))}
      </div>`};_.addEventListener("change",S),S()}function Ke(){const{rows:e}=I;U().innerHTML=`
    <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg mb-lg">
      <div class="flex items-center gap-md flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[20px]">search</span>
          <input id="fter_search" type="text" placeholder="Buscar por N° de Pedido…" class="w-full pl-10 pr-10 py-2 border border-surface-variant rounded-lg text-body-md" value="${B||""}" />
          <button id="fter_clear" type="button" title="Borrar búsqueda" aria-label="Borrar búsqueda" class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-high ${B?"":"hidden"}">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>
    </div>
    <div id="fter_detalle"></div>
    ${q("Todos los Pedidos")}
    <div class="flex items-center gap-md flex-wrap mb-sm">
      <select id="fter_f_estado" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Etapa: Todas</option>
        ${Ve.map(p=>`<option value="${p}">${p}</option>`).join("")}
        <option value="Listo para Entrega Cliente">Listo para Entrega Cliente</option>
      </select>
      <select id="fter_f_abierto" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Pedido: Abiertos y cerrados</option>
        <option value="abierto">Abiertos (sin entrega a cliente)</option>
        <option value="cerrado">Cerrados (entregados a cliente)</option>
      </select>
      <select id="fter_f_centro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Centro destino: Todos</option>
        ${V(e.map(p=>p.punto_expedicion)).sort().map(p=>`<option value="${h(p)}">${h(M(p))}</option>`).join("")}
      </select>
      <button id="fter_f_reset" type="button" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px] text-secondary hover:bg-surface-container-high">Limpiar filtros</button>
      <span id="fter_count" class="text-[14px] text-secondary ml-auto"></span>
      <select id="fter_f_condicion" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Condición: Todas</option>
        ${V(e.map(p=>p.condicion_expedicion)).map(p=>`<option value="${h(p)}">${p}</option>`).join("")}
      </select>
      <select id="fter_f_venc" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
        <option value="">Vencidos: Todos</option>
        <option value="si">Solo vencidos sin entregar</option>
        <option value="no">Solo no vencidos</option>
      </select>
    </div>
    <div id="fter_tabla"></div>
  `;const t=document.getElementById("fter_search"),o=document.getElementById("fter_f_estado"),i=document.getElementById("fter_f_condicion"),r=document.getElementById("fter_f_venc"),v=document.getElementById("fter_f_abierto"),f=document.getElementById("fter_f_centro"),m=document.getElementById("fter_clear"),d=()=>m.classList.toggle("hidden",!t.value),a=()=>{const p=(t.value||"").trim().toLowerCase();let n=e;p&&(n=n.filter(l=>String(l.id_pedido||"").toLowerCase().includes(p))),o.value&&(n=n.filter(l=>l.estadoLabel===o.value)),i.value&&(n=n.filter(l=>l.condicion_expedicion===i.value)),r.value==="si"&&(n=n.filter(l=>l.vencido)),r.value==="no"&&(n=n.filter(l=>!l.vencido)),v.value==="abierto"&&(n=n.filter(l=>l.pendiente)),v.value==="cerrado"&&(n=n.filter(l=>!l.pendiente)),f.value&&(n=n.filter(l=>String(l.punto_expedicion)===f.value)),document.getElementById("fter_count").textContent=n.length>200?`Mostrando 200 de ${n.length} pedidos`:`${n.length} pedido${n.length===1?"":"s"}`,document.getElementById("fter_tabla").innerHTML=Je(n.slice(0,200)),document.getElementById("fter_tabla").querySelectorAll("[data-pedido]").forEach(l=>{l.addEventListener("click",()=>{B=l.getAttribute("data-pedido"),t.value=B,d(),u(),a(),window.scrollTo({top:0,behavior:"smooth"})})})},u=()=>{const p=e.find(n=>String(n.id_pedido)===String(B));document.getElementById("fter_detalle").innerHTML=p?Xe(p):B?`<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg text-secondary mb-lg">No se encontró el pedido "${h(B)}".</div>`:""};t.addEventListener("input",()=>{B=t.value.trim()||null,d(),u(),a()}),m.addEventListener("click",()=>{t.value="",B=null,d(),u(),a(),t.focus()}),t.addEventListener("keydown",p=>{p.key==="Escape"&&t.value&&(t.value="",B=null,d(),u(),a())}),document.getElementById("fter_f_reset").addEventListener("click",()=>{t.value="",B=null,[o,i,r,v,f].forEach(p=>{p.value=""}),d(),u(),a()}),t.addEventListener("keydown",p=>{if(p.key==="Enter"){const n=e.find(l=>String(l.id_pedido)===t.value.trim());n&&(B=n.id_pedido,u())}}),o.addEventListener("change",a),i.addEventListener("change",a),r.addEventListener("change",a),v.addEventListener("change",a),f.addEventListener("change",a),u(),a()}function Xe(e){const t=e.cumplido?e.otif?te("OTIF cumplido","#1E8449"):te((e.esRetiro?"Disponible en sucursal":"Entregado")+" fuera de plazo / incompleto","#C0000C"):e.vencido?te("Vencido sin entregar","#C0000C"):te("En proceso (dentro de plazo)","#B5730B");return`
  <div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-lg mb-lg">
    <div class="flex items-start justify-between flex-wrap gap-sm mb-md">
      <div>
        <div class="text-headline-sm font-bold">Pedido ${h(e.id_pedido)}</div>
        <div class="text-[14px] text-secondary mt-1">${h(e.condicion_expedicion)} · ${h(M(e.punto_expedicion))} · Ruta: ${h(e.ruta_flete||"–")}</div>
      </div>
      ${t}
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg text-[15px]">
      ${ne("Fecha Creación",A(e.fecha_creacion))}
      ${ne("Fecha Promesa (Disponible Material)",A(e.fecha_disponible_material))}
      ${ne("Material",e.material||"–")}
      ${ne("Bultos Solicitados / Cumplidos"+(e.esRetiro?" (recep. sucursal)":" (entrega)"),`${g(e.cantidad_bultos)} / ${g(e.bultosEvento)}`)}
    </div>
    ${Ye(e)}
  </div>`}function Ye(e){const t=[{label:"Creación del Pedido",fecha:e.fecha_creacion,activo:!0},{label:"Recepción en CD",fecha:e.fecha_recep_cd,activo:e.estadoIdx>=1},{label:"En Tránsito",fecha:e.fecha_traslado,activo:e.estadoIdx>=2},{label:e.esRetiro&&e.estadoIdx>=3?"Listo para Entrega Cliente":"En Bodega Destino",fecha:e.fecha_recep_sucursal,activo:e.estadoIdx>=3},{label:"Entregado a Cliente",fecha:e.fecha_entrega_cliente,activo:e.estadoIdx>=4}];return`<div class="flex items-start gap-0 overflow-x-auto pt-sm">
    ${t.map((o,i)=>`
      <div class="flex flex-col items-center flex-1 min-w-[110px]">
        <div class="flex items-center w-full">
          <div class="flex-1 h-[2px] ${i===0?"invisible":o.activo?"bg-primary":"bg-surface-variant"}"></div>
          <div class="w-8 h-8 rounded-full flex items-center justify-center ${o.activo?"bg-primary text-on-primary":"bg-surface-container-high text-secondary"} shrink-0">
            <span class="material-symbols-outlined text-[16px]">${o.activo?"check":"radio_button_unchecked"}</span>
          </div>
          <div class="flex-1 h-[2px] ${i===t.length-1?"invisible":t[i+1].activo?"bg-primary":"bg-surface-variant"}"></div>
        </div>
        <div class="text-[13px] text-center mt-1 font-semibold ${o.activo?"text-on-surface":"text-secondary"}">${o.label}</div>
        <div class="text-[12px] text-secondary">${o.fecha?A(o.fecha):"—"}</div>
      </div>`).join("")}
  </div>`}function Je(e){return e.length?`<div class="overflow-x-auto"><table class="w-full text-[14px] border-collapse mb-xl">
    <thead><tr class="text-left text-secondary border-b border-surface-variant">
      <th class="py-2 pr-3">N° Pedido</th><th class="py-2 pr-3">Condición</th><th class="py-2 pr-3">Centro</th>
      <th class="py-2 pr-3">F. Creación</th><th class="py-2 pr-3">F. Promesa</th><th class="py-2 pr-3">Estado</th><th class="py-2 pr-3"></th>
    </tr></thead>
    <tbody>
      ${e.map(t=>`
      <tr data-pedido="${h(t.id_pedido)}" class="border-b border-surface-variant hover:bg-surface-container-high cursor-pointer">
        <td class="py-2 pr-3 font-semibold">${h(t.id_pedido)}</td>
        <td class="py-2 pr-3">${h(t.condicion_expedicion)}</td>
        <td class="py-2 pr-3">${h(t.punto_expedicion)}</td>
        <td class="py-2 pr-3">${A(t.fecha_creacion)}</td>
        <td class="py-2 pr-3">${A(t.fecha_disponible_material)}</td>
        <td class="py-2 pr-3">${Qe(t)}</td>
        <td class="py-2 pr-3 text-primary">Ver →</td>
      </tr>`).join("")}
    </tbody>
  </table></div>`:'<div class="text-secondary text-[15px] py-md">Sin resultados.</div>'}function Qe(e){let t=C.grey;return e.estadoLabel==="Entregado a Cliente"?t="#1E8449":e.vencido?t="#C0000C":e.estadoIdx>=3&&(t=C.amber),`<span class="inline-flex items-center gap-1 text-[13px] font-semibold px-2 py-[2px] rounded-full" style="background:${t}22;color:${t}">${e.estadoLabel}${e.vencido?" · Vencido":""}</span>`}function te(e,t){return`<span class="inline-flex items-center gap-1 text-[14px] font-semibold px-3 py-1 rounded-full" style="background:${t}22;color:${t}">${e}</span>`}function ne(e,t){return`<div><div class="text-[12px] uppercase tracking-wide text-secondary mb-[2px]">${e}</div><div class="font-semibold text-on-surface">${h(String(t))}</div></div>`}const W=[{k:"0-5",max:5},{k:"6-20",max:20},{k:"21-60",max:60},{k:">60",max:1/0}];function re(e){return W.find(t=>e<=t.max).k}const le={"Recepción CD":"#6B6E70",Traslado:"#8A6D3B","Recepción Sucursal":"#2E75B6","Entrega Cliente":"#C0000C"};function be(e){return e?`<div style="display:flex;flex-wrap:wrap;gap:4px">${String(e).split(" + ").map(t=>`<span style="font-size:13px;font-weight:600;white-space:nowrap;padding:2px 8px;border-radius:999px;background:${le[t]||"#6B6E70"}18;color:${le[t]||"#6B6E70"};border:1px solid ${le[t]||"#6B6E70"}40">${h(t)}</span>`).join("")}</div>`:"–"}const de={"0-5":"#E0B252","6-20":"#D98A00","21-60":"#D9636B",">60":"#C0000C"};function ce(e){const t=de[re(e)];return`<span style="display:inline-block;min-width:44px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;padding:2px 8px;border-radius:6px;background:${t}22;color:${t==="#E0B252"?"#8A6400":t}">${g(e)} d</span>`}function Ze(e){const t=e<=1?"#C0000C":e<=3?"#B5730B":"#6B6E70";return`<span style="display:inline-block;min-width:44px;text-align:center;font-weight:700;padding:2px 8px;border-radius:6px;background:${t}18;color:${t}">${e<=0?"hoy":g(e)+" d"}</span>`}function ge(e,t){return t?`<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;min-width:140px;background:#EFECE8">${W.map(o=>e[o.k]?`<div title="${o.k} d: ${e[o.k]}" style="width:${e[o.k]/t*100}%;background:${de[o.k]};border-right:2px solid #fff"></div>`:"").join("")}</div>`:""}function et(){return`<div class="flex items-center gap-md flex-wrap mb-sm text-[13px] text-secondary">Atraso (días hábiles): ${W.map(e=>`<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${de[e.k]}"></span>${e.k}</span>`).join("")}</div>`}function he(e,t,o){const i=m=>{const d=m==null?"":String(m);return/[",\n]/.test(d)?'"'+d.replace(/"/g,'""')+'"':d},r="\uFEFF"+[t.map(i).join(",")].concat(o.map(m=>m.map(i).join(","))).join(`\r
`),v=URL.createObjectURL(new Blob([r],{type:"text/csv;charset=utf-8"})),f=document.createElement("a");f.href=v,f.download=e,document.body.appendChild(f),f.click(),f.remove(),setTimeout(()=>URL.revokeObjectURL(v),1e3)}function ye(){const e=new Date;return e.getFullYear()+"-"+String(e.getMonth()+1).padStart(2,"0")+"-"+String(e.getDate()).padStart(2,"0")}function $e(e){return`<button id="${e}" class="flex items-center gap-1 border border-surface-variant rounded-lg px-3 py-1 text-[14px] font-semibold text-primary hover:bg-surface-container-high"><span class="material-symbols-outlined text-[16px]">download</span>Descargar CSV</button>`}function tt(){const{rows:e}=I,t=e.filter(n=>n.vencidoPend),i=V(t.map(n=>n.centroResp)).map(n=>{const l=t.filter(_=>_.centroResp===n),R=Object.fromEntries(W.map(_=>[_.k,l.filter(S=>re(S.diasAtraso)===_.k).length]));return{centro:n,n:l.length,prom:T(l.map(_=>_.diasAtraso)),max:Math.max(...l.map(_=>_.diasAtraso)),b:R}}).sort((n,l)=>l.n-n.n),r=t.length,v=t.filter(n=>n.centroResp==="1003").length,f=t.filter(n=>n.diasAtraso>60).length,m=r?Math.max(...t.map(n=>n.diasAtraso)):null,d=Object.fromEntries(W.map(n=>[n.k,t.filter(l=>re(l.diasAtraso)===n.k).length]));U().innerHTML=`
    <div class="text-[13px] text-secondary mb-md">Pedidos con fecha promesa vencida y alguna etapa física pendiente (Recepción CD, Traslado, Recepción Sucursal y Entrega Cliente). Un pedido Retira ya en sucursal sigue pendiente hasta la entrega al cliente (el OTIF cierra en sucursal). Días de atraso en días hábiles.</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${w("Vencidos por Regularizar",g(r),"con etapas pendientes","",r?{c:"#C0000C",t:"Requieren gestión"}:{c:"#1E8449",t:"Sin vencidos"})}
      ${w("Responsable CD 1003",g(v),r?G(v/r*100)+" del total (falta Recepción CD/Traslado)":"–")}
      ${w("Atraso > 60 días háb.",g(f),"posibles registros sin cerrar en SAP")}
      ${w("Atraso Máximo",m==null?"–":g(m)+" d","días hábiles")}
    </div>
    ${q("1. Resumen por Centro Responsable de Cierre")}
    ${et()}
    ${K(["Centro Responsable","Pedidos Vencidos","Distribución del atraso","Atraso Prom. (d háb.)","Atraso Máx.","0-5 d","6-20 d","21-60 d","> 60 d"],i.map(n=>[M(n.centro),`<b>${g(n.n)}</b>`,ge(n.b,n.n),j.format(n.prom),ce(n.max),g(n.b["0-5"]),g(n.b["6-20"]),g(n.b["21-60"]),n.b[">60"]?`<span style="color:#C0000C;font-weight:700">${g(n.b[">60"])}</span>`:"0"]).concat(r?[["<b>Total</b>",`<b>${g(r)}</b>`,ge(d,r),j.format(T(t.map(n=>n.diasAtraso))),ce(m),g(d["0-5"]),g(d["6-20"]),g(d["21-60"]),g(d[">60"])]]:[]))}
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">2. Detalle de Pedidos a Gestionar</div>
      <div class="flex items-center gap-sm">
        <label class="flex items-center gap-2 text-[14px] text-secondary">Centro Responsable:
          <select id="fter_venc_centro" class="border border-surface-variant rounded-lg px-2 py-1 text-[14px]">
            <option value="Todos">Todos</option>
            ${i.map(n=>`<option value="${h(n.centro)}">${h(M(n.centro))}</option>`).join("")}
          </select>
        </label>
        ${$e("fter_venc_csv")}
      </div>
    </div>
    <div id="fter_venc_tabla"></div>`;const a=document.getElementById("fter_venc_centro");a.value=ue;const u=()=>t.filter(n=>a.value==="Todos"||n.centroResp===a.value).sort((n,l)=>n.centroResp===l.centroResp?l.diasAtraso-n.diasAtraso:String(n.centroResp).localeCompare(String(l.centroResp))),p=()=>{ue=a.value;const n=u();document.getElementById("fter_venc_tabla").innerHTML=n.length?K(["Centro Resp.","N° Pedido","Centro Destino","Condición","F. Creación","F. Promesa","Atraso (d háb.)","Estado Actual","Etapas Pendientes"],n.map(l=>[h(l.centroResp),`<b>${h(l.id_pedido)}</b>`,h(l.punto_expedicion),h(l.condicion_expedicion),A(l.fecha_creacion),A(l.fecha_disponible_material),ce(l.diasAtraso),h(l.estadoOp),be(l.etapasPend)])):'<div class="text-secondary text-[15px] py-md">Sin pedidos vencidos pendientes.</div>'};a.addEventListener("change",p),document.getElementById("fter_venc_csv").addEventListener("click",()=>he(`Pedidos_Vencidos_${ye()}.csv`,["Centro Responsable","ID Pedido","Centro Destino","Condicion Expedicion","Ruta Flete","Cantidad Bultos","Fecha Creacion","Fecha Promesa","Dias Atraso (habiles)","Estado Actual","Etapas Pendientes"],u().map(n=>[n.centroResp,n.id_pedido,n.punto_expedicion,n.condicion_expedicion,n.ruta_flete,n.cantidad_bultos,n.fecha_creacion,n.fecha_disponible_material,n.diasAtraso,n.estadoOp,n.etapasPend]))),p()}const _e=["Sin Recepción en CD","Recepción en CD (sin traslado)","En Tránsito","En Bodega Destino","Listo para Retiro en Sucursal"];function nt(){const{rows:e}=I,t=e.filter(a=>a.enCurso),o=t.length,i=t.filter(a=>a.diasParaVencer<=1).length,r=_e.concat(V(t.map(a=>a.estadoOp)).filter(a=>_e.indexOf(a)<0)),f=V(t.map(a=>a.punto_expedicion)).sort().map(a=>{const u=t.filter(p=>p.punto_expedicion===a);return{ce:a,n:u.length,porE:r.map(p=>u.filter(n=>n.estadoOp===p).length),urg:u.filter(p=>p.diasParaVencer<=1).length}}),m=r.map(a=>t.filter(u=>u.estadoOp===a).length);U().innerHTML=`
    <div class="text-[13px] text-secondary mb-md">Pedidos dentro de plazo (fecha promesa vigente) que aún tienen etapas físicas pendientes. Días para vencer en días hábiles; 0-1 = vence hoy o mañana.</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-md mb-lg">
      ${w("Pedidos en Curso",g(o),"no cerrados, dentro de plazo")}
      ${w("Vencen en ≤ 1 día háb.",g(i),"hoy o mañana",i?"text-[#C0000C]":"")}
      ${w("Sin Recepción en CD",g(m[0]),"aún no ingresan al CD",m[0]?"text-[#B5730B]":"")}
      ${w("En Tránsito / Sucursal",g(m[2]+m[3]+m[4]),"camino a sucursal o ya en sucursal esperando entrega")}
    </div>
    ${q("1. Pedidos en Curso por Centro Destino y Estado")}
    ${K(["Centro Destino"].concat(r,["Total","Vencen ≤ 1 d"]),f.map(a=>[M(a.ce)].concat(a.porE.map(u=>u?g(u):"–"),[`<b>${g(a.n)}</b>`,a.urg?`<span style="color:#C0000C;font-weight:600">${g(a.urg)}</span>`:"–"])).concat(o?[["<b>Total</b>"].concat(m.map(a=>`<b>${g(a)}</b>`),[`<b>${g(o)}</b>`,`<b>${g(i)}</b>`])]:[]))}
    <div class="flex items-center justify-between flex-wrap gap-sm mt-lg mb-sm">
      <div class="text-body-lg font-bold text-on-surface">2. Detalle de Pedidos en Curso (más urgentes primero)</div>
      ${$e("fter_curso_csv")}
    </div>
    <div id="fter_curso_tabla"></div>`;const d=t.slice().sort((a,u)=>a.diasParaVencer-u.diasParaVencer||String(a.centroResp).localeCompare(String(u.centroResp)));document.getElementById("fter_curso_tabla").innerHTML=d.length?K(["Para Vencer (d háb.)","N° Pedido","Centro Destino","Condición","F. Creación","F. Promesa","Estado Actual","Centro Resp.","Etapas Pendientes"],d.map(a=>[Ze(a.diasParaVencer),`<b>${h(a.id_pedido)}</b>`,h(a.punto_expedicion),h(a.condicion_expedicion),A(a.fecha_creacion),A(a.fecha_disponible_material),h(a.estadoOp),h(a.centroResp),be(a.etapasPend)])):'<div class="text-secondary text-[15px] py-md">Sin pedidos en curso.</div>',document.getElementById("fter_curso_csv").addEventListener("click",()=>he(`Pedidos_en_Curso_${ye()}.csv`,["Centro Responsable","ID Pedido","Centro Destino","Condicion Expedicion","Ruta Flete","Cantidad Bultos","Fecha Creacion","Fecha Promesa","Dias Habiles para Vencer","Estado Actual","Etapas Pendientes"],d.map(a=>[a.centroResp,a.id_pedido,a.punto_expedicion,a.condicion_expedicion,a.ruta_flete,a.cantidad_bultos,a.fecha_creacion,a.fecha_disponible_material,a.diasParaVencer,a.estadoOp,a.etapasPend])))}function q(e){return`<div class="text-body-lg font-bold text-on-surface mt-lg mb-sm">${e}</div>`}function w(e,t,o,i="",r=null){return`<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md" style="${r?"border-top:4px solid "+r.c:""}">
    <div class="text-[13px] uppercase tracking-wide text-secondary mb-1">${e}</div>
    <div class="text-headline-sm font-bold ${i}">${t}</div>
    ${r?`<div class="text-[14px] font-semibold" style="color:${r.c}">● ${r.t}</div>`:""}
    <div class="text-[13px] text-secondary mt-1">${o}</div>
  </div>`}function pe(e,t){return e==null?null:e>=t?{c:"#1E8449",t:"Sobre meta "+t+"%"}:e>=t-5?{c:"#B5730B",t:"Cerca de meta "+t+"%"}:{c:"#C0000C",t:"Bajo meta "+t+"%"}}function Ee(e,t){const o=(i,r)=>{const v=pe(i,r);return`<div style="display:flex;align-items:center;gap:8px">
      <div style="position:relative;flex:1;height:12px;background:#EFECE8;border-radius:6px;min-width:80px">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${i==null?0:Math.max(0,Math.min(100,i))}%;background:${v?v.c:"#A9ACAE"};border-radius:6px"></div>
        <div title="Meta ${r}%" style="position:absolute;left:${r}%;top:-3px;bottom:-3px;width:2px;background:#333"></div>
      </div>
      <div style="width:52px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${v?v.c:"#6B6E70"}">${G(i)}</div></div>`};return`<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg overflow-x-auto">
    <table class="w-full text-[15px] border-collapse" style="min-width:560px">
      <thead><tr class="text-left text-secondary text-[13px] uppercase tracking-wide">
        <th class="py-2 pr-3">${t}</th><th class="py-2 pr-3 text-right">Pedidos</th>
        <th class="py-2 pr-3" style="width:36%">OTIF <span class="normal-case">(meta ${k.otif}%)</span></th>
        <th class="py-2" style="width:36%">Fill Rate <span class="normal-case">(meta ${k.fill}%)</span></th></tr></thead>
      <tbody>${e.map(i=>`<tr class="border-t border-surface-variant">
        <td class="py-2 pr-3 whitespace-nowrap font-semibold">${i.label}</td>
        <td class="py-2 pr-3 text-right tabular-nums">${g(i.n)}</td>
        <td class="py-2 pr-3">${o(i.otif,k.otif)}</td><td class="py-2">${o(i.fill,k.fill)}</td></tr>`).join("")}</tbody>
    </table></div>`}const k={otif:90,fill:95};function Ce(e,t){if(e==null)return"–";const o=t||90;return`<span style="color:${e>=o?"#1E8449":e>=o-5?"#B5730B":"#C0000C"};font-weight:600">${G(e)}</span>`}function K(e,t){return`<div class="overflow-x-auto"><table class="w-full text-[15px] border-collapse mb-md">
    <thead><tr class="text-left text-secondary border-b border-surface-variant">${e.map(o=>`<th class="py-2 pr-3">${o}</th>`).join("")}</tr></thead>
    <tbody>${t.map(o=>`<tr class="border-b border-surface-variant hover:bg-surface-container-low">${o.map(i=>`<td class="py-2 pr-3 align-middle" style="${/^\d{2}-\d{2}-\d{4}$/.test(String(i))?"white-space:nowrap":""}">${i}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`}function we(e){return`<div class="flex items-center gap-md flex-wrap mb-sm text-[13px] text-secondary">
    ${e.map(t=>`<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${t.c}"></span>${t.n}</span>`).join("")}
  </div>`}const Te=[C.red,C.grey,C.amber,C.redL,C.greyL,"#0B2B4A","#2E75B6"];function Re(e){return Te[e%Te.length]}function ot(e,t,o){if(!e.length)return'<div class="text-secondary text-[15px]">Sin datos.</div>';const i=Math.max(100/e.length,4);return`<div class="flex items-end gap-1" style="height:140px">
    ${t.map((r,v)=>{if(!r)return`<div style="width:${i}%"></div>`;const f=o.map((m,d)=>{const a=r.pct[m]||0,u=a>=12?`<span style="font-size:13px;font-weight:700;color:#fff;line-height:1">${Math.round(a)}%</span>`:"";return`<div style="height:${a}%;background:${Re(d)};display:flex;align-items:center;justify-content:center" title="${m}: ${j.format(a)}% (${r.porT[m]||0} pedidos)">${u}</div>`}).join("");return`<div class="flex flex-col items-center gap-1" style="width:${i}%">
        <div class="text-[13px] font-semibold text-secondary">${r.total}</div>
        <div class="w-full flex flex-col-reverse rounded overflow-hidden bg-surface-container-high" style="height:90px">${f}</div>
        <div class="text-[13px] text-secondary whitespace-nowrap">${e[v]}</div>
      </div>`}).join("")}
  </div>`}function at(e){const t=Math.max(...e.map(o=>o.value||0),.001);return`<div class="flex flex-col gap-2 mb-md">
    ${e.map(o=>{const i=o.value!=null?Math.max(o.value/t*100,3):0,r=o.isMax?C.red:C.grey;return`<div>
        <div class="flex justify-between items-baseline text-[14px] text-secondary mb-[2px]">
          <span>${o.label}${o.isMax?' <span style="color:'+C.red+';font-weight:700">◀ MÁXIMO</span>':""}</span>
          <span class="font-semibold" style="color:${r}">${Z(o.value)}${o.share!=null?` <span class="text-secondary font-normal">· ${j.format(o.share)}% del lead time</span>`:""}</span>
        </div>
        <div class="w-full h-4 bg-surface-container-high rounded overflow-hidden">
          <div style="width:${i}%;background:${r};height:100%"></div>
        </div>
      </div>`}).join("")}
  </div>`}function it(e,t,o){const i=document.getElementById("fter_body"),r=Math.max(320,Math.round((i&&i.clientWidth||900)-34)),v=260,f=46,m=o?74:14,d=22,a=30,u=13,p=r-f-m,n=v-d-a,l=100,R=0,_=t.length,S=p/Math.max(_,1),s=y=>f+S*y+S/2,c=y=>d+n-n*(y-R)/(l-R||1),x=S<40;let b=`<div class="bg-surface-container-lowest border border-surface-variant rounded-xl p-md mb-lg">${we(e.map(y=>({n:y.n,c:y.color})))}<svg viewBox="0 0 ${r} ${v}" width="100%" style="height:auto;display:block;overflow:visible" role="img">`;if([0,25,50,75,100].forEach(y=>{const D=c(y);b+=`<line x1="${f}" y1="${D}" x2="${r-m}" y2="${D}" stroke="${C.grid}" stroke-width="1"/><text x="${f-7}" y="${D+4}" font-size="${u}" fill="${C.grey}" text-anchor="end">${y}</text>`}),o){const y=c(o.v);b+=`<line x1="${f}" y1="${y}" x2="${r-m}" y2="${y}" stroke="#1E8449" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${r-m+4}" y="${y+4}" font-size="${u}" font-weight="700" fill="#1E8449">${o.short||"Meta "+o.v+"%"}</text>`}e.forEach((y,D)=>{const X=y.values.map((E,P)=>E==null?null:`${s(P)},${c(E)}`).filter(Boolean).join(" ");b+=`<polyline points="${X}" fill="none" stroke="${y.color}" stroke-width="2" stroke-linejoin="round"/>`;const N=y.values.filter(E=>E!=null),Y=Math.max(...N),J=Math.min(...N);y.values.forEach((E,P)=>{if(E==null)return;const Q=e.filter((L,F)=>F!==D&&L.values[P]!=null).map(L=>L.values[P]),oe=!Q.length||E>=Math.max(...Q),ae=!x||P===0||P===_-1||E===Y||E===J;b+=`<circle cx="${s(P)}" cy="${c(E)}" r="4" fill="${y.color}" stroke="#fff" stroke-width="2"><title>${y.n} ${t[P]}: ${j.format(E)}%</title></circle>`,ae&&(b+=`<text x="${s(P)}" y="${c(E)+(oe?-9:17)}" font-size="${u}" font-weight="700" fill="${y.color}" text-anchor="middle">${j.format(E)}%</text>`)})});const $=Math.max(1,Math.ceil(_*44/p));return t.forEach((y,D)=>{D%$&&D!==_-1||(b+=`<text x="${s(D)}" y="${v-6}" font-size="${u}" fill="${C.grey}" text-anchor="middle">${y}</text>`)}),b+="</svg></div>",b}function T(e){const t=e.filter(o=>o!=null);return t.length?t.reduce((o,i)=>o+i,0)/t.length:null}function V(e){return Array.from(new Set(e.filter(t=>t!=null&&t!=="")))}function h(e){return String(e??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}export{dt as renderFleteTerceroView,lt as setFleteTerceroSubTab};
