import{supabase as E}from"./supabase-client.js?v=fd17fd7d20";import{loadLeaflet as I,escapeHtml as i}from"./utils.js";import{can as O}from"./permisos.js?v=a8b193e9fb";const U={PENDIENTE:{txt:"Pendiente",largo:"Pendiente de georreferenciar (automático en curso)",color:"#6b7280",bg:"#f3f4f6",ink:"#374151",icon:"hourglass_top",falta:!0},REVISAR:{txt:"Falta ubicar",largo:"No se encontró la dirección: georreferenciar a mano",color:"#dc2626",bg:"#fee2e2",ink:"#991b1b",icon:"wrong_location",falta:!0},AUTO_CALLE:{txt:"Calle (aprox.)",largo:"Ubicada a nivel de calle: conviene confirmar el punto",color:"#d97706",bg:"#fef3c7",ink:"#92400e",icon:"add_location",falta:!1},AUTO:{txt:"Ubicada (auto)",largo:"Ubicada automáticamente con número",color:"#16a34a",bg:"#dcfce7",ink:"#166534",icon:"where_to_vote",falta:!1},MANUAL:{txt:"Ubicada (manual)",largo:"Ubicación fijada por un usuario",color:"#16a34a",bg:"#dcfce7",ink:"#166534",icon:"person_pin_circle",falta:!1}},$=o=>U[o&&o.geo_estado||"PENDIENTE"]||U.PENDIENTE,B=o=>!!o&&Number.isFinite(+o.lat)&&Number.isFinite(+o.lon)&&o.lat!==null&&!$(o).falta,K=o=>!B(o),j=()=>O("editar")||O("coordinar_venta"),b=o=>`<span class="material-symbols-outlined">${o}</span>`,T=o=>String(o??"").trim().replace(/^0+(?=\d)/,"");function H(o,p=!0){const c=$(o);return`<span class="mo-badge" style="background:${c.bg};color:${c.ink}" title="${i(c.largo)}">${b(c.icon)}${i(p?c.txt:c.largo)}</span>`}async function Q(o){const p=new Map,c=[...new Set((o||[]).map(T).filter(Boolean))];for(let u=0;u<c.length;u+=300){const{data:s,error:n}=await E.from("maestro_obras").select("*").in("id_obra",c.slice(u,u+300));if(n)throw new Error(n.message);(s||[]).forEach(e=>p.set(T(e.id_obra),e))}return p}async function G(o,p={}){P();const c=T(o);if(!c)return null;await I();const{data:u}=await E.from("maestro_obras").select("*").eq("id_obra",c).maybeSingle(),s=p.base||{},n=u||{id_obra:c,geo_estado:"PENDIENTE",lat:null,lon:null},e={direccion:n.direccion||s.direccion||"",comuna:n.comuna||s.comuna||"",contacto_nombre:n.contacto_nombre||"",contacto_telefono:n.contacto_telefono||"",contacto_email:n.contacto_email||"",lat:n.lat,lon:n.lon,movido:!1,confirmar:!1},r=j();return new Promise(h=>{const t=document.createElement("div");t.className="mo-bg",t.innerHTML=`<div class="mo-dlg" role="dialog" aria-label="Obra ${i(c)}">
      <header class="mo-h"><div class="mo-h-ic">${b("apartment")}</div>
        <div style="flex:1;min-width:0"><div class="mo-h-t">Obra ${i(c)} <span data-badge>${H(n)}</span></div>
        <div class="mo-h-s">${i(n.nombre_cliente||s.nombre_cliente||"Cliente sin nombre")}${n.id_cliente||s.id_cliente?` · cliente <span class="mono">${i(n.id_cliente||s.id_cliente)}</span>`:""}</div></div>
        <button class="mo-x" data-cerrar title="Cerrar (Esc)">${b("close")}</button></header>
      <div class="mo-body">
        <div class="mo-mapcol">
          <div class="mo-search">${b("search")}<input data-q placeholder="Buscar dirección (calle número, comuna)…" value="${i([e.direccion,e.comuna].filter(Boolean).join(", "))}"><button class="mo-btn sm" data-buscar>Buscar</button></div>
          <div class="mo-res" data-res></div>
          <div class="mo-map" data-map></div>
          <div class="mo-hint">${b("touch_app")}Arrastre el pin o haga clic en el mapa en el acceso de la obra.</div>
        </div>
        <div class="mo-form">
          <div class="mo-sec">Dirección</div>
          <label class="mo-f"><span>Dirección</span><input data-k="direccion" value="${i(e.direccion)}" ${r?"":"disabled"}></label>
          <label class="mo-f"><span>Comuna</span><input data-k="comuna" value="${i(e.comuna)}" ${r?"":"disabled"}></label>
          <div class="mo-geo" data-geo></div>
          <div class="mo-ll">
            <label class="mo-f"><span>Latitud</span><input data-ll="lat" inputmode="decimal" value="${Number.isFinite(+e.lat)&&e.lat!==null?(+e.lat).toFixed(6):""}" ${r?"":"disabled"} placeholder="-33.456789"></label>
            <label class="mo-f"><span>Longitud</span><input data-ll="lon" inputmode="decimal" value="${Number.isFinite(+e.lon)&&e.lon!==null?(+e.lon).toFixed(6):""}" ${r?"":"disabled"} placeholder="-70.654321"></label>
          </div>
          ${r?'<div class="mo-muted">Puede pegar «lat, lon» copiado de Google Maps en cualquiera de los dos campos.</div>':""}
          <div class="mo-sec">Contacto en obra</div>
          <label class="mo-f"><span>Nombre contacto</span><input data-k="contacto_nombre" value="${i(e.contacto_nombre)}" ${r?"":"disabled"} placeholder="Nombre y apellido"></label>
          <label class="mo-f"><span>Teléfono</span><input data-k="contacto_telefono" value="${i(e.contacto_telefono)}" ${r?"":"disabled"} placeholder="+56 9 …"></label>
          <label class="mo-f"><span>Correo <small>(opcional)</small></span><input data-k="contacto_email" type="email" value="${i(e.contacto_email)}" ${r?"":"disabled"} placeholder="nombre@empresa.cl"></label>
          <div class="mo-err" data-err></div>
          <div class="mo-acts">
            <button class="mo-btn" data-cerrar>Cancelar</button>
            ${r?`<button class="mo-btn pri" data-guardar>${b("save")}Guardar</button>`:'<span class="mo-muted">Sin permiso de edición</span>'}
          </div>
          ${n.updated_by?`<div class="mo-muted" style="margin-top:6px">Última edición: ${i(n.updated_by)} · ${new Date(n.updated_at).toLocaleString("es-CL")}</div>`:""}
        </div>
      </div></div>`,document.body.appendChild(t);const d=a=>t.querySelector(a),g=a=>{try{_.remove()}catch{}t.remove(),document.removeEventListener("keydown",q,!0),h(a)},q=a=>{a.key==="Escape"&&(a.stopPropagation(),g(null))};document.addEventListener("keydown",q,!0),t.addEventListener("mousedown",a=>{a.target===t&&g(null)}),t.querySelectorAll("[data-cerrar]").forEach(a=>a.addEventListener("click",()=>g(null))),t.querySelectorAll("[data-k]").forEach(a=>a.addEventListener("input",()=>{e[a.dataset.k]=a.value}));const S=Number.isFinite(+e.lat)&&e.lat!==null?[+e.lat,+e.lon]:p.centro&&Number.isFinite(+p.centro.lat)?[+p.centro.lat,+p.centro.lon]:[-33.45,-70.66],_=L.map(d("[data-map]")).setView(S,e.lat!==null&&e.lat!==void 0?17:13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(_);const N=L.marker(S,{draggable:r,icon:L.divIcon({className:"mo-pin-wrap",html:`<div class="mo-pin">${b("location_on")}</div>`,iconSize:[36,36],iconAnchor:[18,34]})}).addTo(_),A=(a,m=!1)=>{N.setLatLng(a),e.lat=a.lat,e.lon=a.lng,e.movido=!0,M(),m||(d('[data-ll="lat"]').value=(+a.lat).toFixed(6),d('[data-ll="lon"]').value=(+a.lng).toFixed(6))},z=(a,m)=>a>=-56.5&&a<=-17&&m>=-110&&m<=-66;t.querySelectorAll("[data-ll]").forEach(a=>a.addEventListener("input",()=>{const m=a.value.match(/(-?\d+(?:\.\d+)?)\s*(?:[,;]\s*|\s+)(-\d+(?:\.\d+)?)/);m&&(d('[data-ll="lat"]').value=m[1].replace(",","."),d('[data-ll="lon"]').value=m[2].replace(",","."));const x=parseFloat(String(d('[data-ll="lat"]').value).replace(",",".")),f=parseFloat(String(d('[data-ll="lon"]').value).replace(",",".")),v=d("[data-err]");if(!Number.isFinite(x)||!Number.isFinite(f))return;if(!z(x,f)){v.textContent="Coordenadas fuera de Chile: revise latitud (−17 a −56) y longitud (−66 a −110).";return}v.textContent="";const y=L.latLng(x,f);_.setView(y,Math.max(_.getZoom(),16)),A(y,!0)})),N.on("dragend",()=>A(N.getLatLng())),r&&_.on("click",a=>A(a.latlng)),setTimeout(()=>_.invalidateSize(),50);function M(){const a=$(n),m=Number.isFinite(+e.lat)&&e.lat!==null?`${(+e.lat).toFixed(6)}, ${(+e.lon).toFixed(6)}`:"sin coordenadas";d("[data-geo]").innerHTML=e.movido?`<div class="mo-geo-l ok">${b("check_circle")}<b>Nueva ubicación marcada</b> <span class="mono">${m}</span></div><div class="mo-muted">Se guardará como ubicación manual.</div>`:`<div class="mo-geo-l" style="color:${a.ink}">${b(a.icon)}<b>${i(a.largo)}</b></div>
           <div class="mo-muted mono">${m}</div>${n.geo_detalle?`<div class="mo-muted">${i(n.geo_detalle)}</div>`:""}
           ${r&&n.geo_estado==="AUTO_CALLE"?`<label class="mo-chk"><input type="checkbox" data-confirmar ${e.confirmar?"checked":""}> El punto es correcto (confirmar)</label>`:""}
           ${r&&a.falta&&!(e.lat!==null&&e.lat!==void 0)?'<div class="mo-warn">Busque la dirección o marque el punto en el mapa.</div>':""}`,d("[data-confirmar]")?.addEventListener("change",x=>{e.confirmar=x.target.checked})}M();const F=async()=>{const a=d("[data-q]").value.trim();if(!a)return;const m=d("[data-res]");m.innerHTML='<div class="mo-muted">Buscando…</div>';try{const f=await(await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=cl&accept-language=es&q=${encodeURIComponent(/chile/i.test(a)?a:a+", Chile")}`)).json();if(!f.length){m.innerHTML='<div class="mo-muted">Sin resultados. Pruebe sólo calle y comuna, o marque el punto en el mapa.</div>';return}m.innerHTML=f.map((v,y)=>`<button class="mo-r" data-i="${y}">${b("location_on")}<span>${i(v.display_name)}</span></button>`).join(""),m.querySelectorAll("[data-i]").forEach(v=>v.addEventListener("click",()=>{const y=f[+v.dataset.i],C=L.latLng(+y.lat,+y.lon);_.setView(C,17),r&&A(C),m.innerHTML=""}))}catch(x){m.innerHTML=`<div class="mo-err">No se pudo buscar: ${i(x.message)}</div>`}};d("[data-buscar]").addEventListener("click",F),d("[data-q]").addEventListener("keydown",a=>{a.key==="Enter"&&(a.preventDefault(),F())}),d("[data-guardar]")?.addEventListener("click",async a=>{const m=a.currentTarget,x=d("[data-err]");if(x.textContent="",e.contacto_email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.contacto_email.trim())){x.textContent="Correo inválido.";return}if(e.movido&&!(Number.isFinite(+e.lat)&&Number.isFinite(+e.lon)&&z(+e.lat,+e.lon))){x.textContent="Latitud / longitud inválidas.";return}const f={id_obra:c,direccion:e.direccion.trim()||null,comuna:e.comuna.trim()||null,contacto_nombre:e.contacto_nombre.trim()||null,contacto_telefono:e.contacto_telefono.trim()||null,contacto_email:e.contacto_email.trim()||null};u||Object.assign(f,{id_cliente:s.id_cliente||null,nombre_cliente:s.nombre_cliente||null,ruta:s.ruta||null,requiere_geo:!0}),e.movido?Object.assign(f,{lat:+(+e.lat).toFixed(6),lon:+(+e.lon).toFixed(6),geo_estado:"MANUAL",geo_detalle:"Ubicada a mano en SIT EBEMA"}):e.confirmar?Object.assign(f,{geo_estado:"MANUAL",geo_detalle:(n.geo_detalle||"")+" · confirmada por usuario"}):u&&f.direccion!==(u.direccion||null)&&u.geo_estado!=="MANUAL"&&Object.assign(f,{geo_estado:"PENDIENTE",geo_intentos:0}),m.disabled=!0,m.textContent="Guardando…";const v=u?E.from("maestro_obras").update(f).eq("id_obra",c):E.from("maestro_obras").insert(f),{data:y,error:C}=await v.select("*").maybeSingle();if(C){m.disabled=!1,m.innerHTML=`${b("save")}Guardar`,x.textContent="No se pudo guardar: "+C.message;return}g(y||{...n,...f})})})}const l={obras:[],clientes:[],tab:"obras",q:"",est:"falta",soloDespacho:!0,pag:0};let w=null;async function W(o,p="obras"){P(),l.tab=p==="clientes"?"clientes":"obras",l.pag=0,o.innerHTML=`<div class="mo-v">
    <header class="mo-v-top">
      <div class="mo-h-ic">${b("apartment")}</div>
      <div style="margin-right:auto"><div class="mo-h-t">Socios de Negocios · Obras y Clientes</div><div class="mo-h-s">Se cargan solas desde SAP y se georreferencian automáticamente; las que no se encuentran quedan para ubicar a mano.</div></div>
      <nav class="mo-tabs"><button data-tab="obras" class="${l.tab==="obras"?"is-on":""}">${b("apartment")}Obras</button><button data-tab="clientes" class="${l.tab==="clientes"?"is-on":""}">${b("groups")}Clientes</button></nav>
    </header>
    <div class="mo-v-bar">
      <label class="mo-search" style="flex:1;max-width:420px">${b("search")}<input data-q placeholder="Obra, cliente, dirección, comuna, contacto…"></label>
      <div class="mo-chips" data-est></div>
      <label class="mo-chk"><input type="checkbox" data-desp checked> Sólo obras con despacho</label>
      <button class="mo-btn sm" data-reload>${b("refresh")}Actualizar</button>
    </div>
    <div class="mo-v-tab" data-cont><div class="mo-muted" style="padding:24px">Cargando…</div></div>
  </div>`,w=o.querySelector(".mo-v");const c=s=>w.querySelector(s);w.querySelectorAll("[data-tab]").forEach(s=>s.addEventListener("click",()=>{l.tab=s.dataset.tab,l.pag=0,w.querySelectorAll("[data-tab]").forEach(n=>n.classList.toggle("is-on",n===s)),k()}));let u;c("[data-q]").addEventListener("input",s=>{clearTimeout(u),u=setTimeout(()=>{l.q=s.target.value.trim().toLowerCase(),l.pag=0,k()},160)}),c("[data-desp]").addEventListener("change",s=>{l.soloDespacho=s.target.checked,l.pag=0,k()}),c("[data-reload]").addEventListener("click",()=>D()),await D()}async function D(){const o=async(p,c)=>{const u=[];for(let s=0;;s+=1e3){const{data:n,error:e}=await E.from(p).select("*").order(c).range(s,s+999);if(e)throw new Error(e.message);if(u.push(...n||[]),!n||n.length<1e3)break}return u};try{[l.obras,l.clientes]=await Promise.all([o("maestro_obras","id_obra"),o("maestro_clientes","id_cliente")])}catch(p){w.querySelector("[data-cont]").innerHTML=`<div class="mo-err" style="padding:24px">${i(p.message)}</div>`;return}k()}function k(){const o=t=>w.querySelector(t);if(o("[data-desp]").closest("label").style.display=l.tab==="obras"?"":"none",l.tab==="clientes")return V();const p=l.obras.filter(t=>!l.soloDespacho||t.requiere_geo),c=t=>t==="todas"?p.length:t==="falta"?p.filter(d=>$(d).falta).length:p.filter(d=>d.geo_estado===t).length,u=[["falta","Falta ubicar","#dc2626"],["AUTO_CALLE","Calle (aprox.)","#d97706"],["AUTO","Auto","#16a34a"],["MANUAL","Manual","#16a34a"],["todas","Todas","#191c1d"]];o("[data-est]").innerHTML=u.map(([t,d,g])=>`<button class="mo-chip${l.est===t?" is-on":""}" data-e="${t}" style="--c:${g}">${i(d)} <b>${c(t)}</b></button>`).join(""),o("[data-est]").querySelectorAll("[data-e]").forEach(t=>t.addEventListener("click",()=>{l.est=t.dataset.e,l.pag=0,k()}));const s=l.q,n=p.filter(t=>l.est==="todas"||(l.est==="falta"?$(t).falta:t.geo_estado===l.est)).filter(t=>!s||[t.id_obra,t.id_cliente,t.nombre_cliente,t.direccion,t.comuna,t.ruta,t.contacto_nombre,t.contacto_telefono,t.contacto_email].some(d=>String(d||"").toLowerCase().includes(s))).sort((t,d)=>String(d.visto_en||"").localeCompare(String(t.visto_en||""))),e=200,r=n.length,h=n.slice(l.pag*e,(l.pag+1)*e);o("[data-cont]").innerHTML=`<div class="mo-tscroll"><table class="mo-t"><thead><tr>
      <th>Georreferencia</th><th>Obra</th><th>Cliente</th><th>Dirección</th><th>Comuna</th><th class="r">Latitud</th><th class="r">Longitud</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
    <tbody>${h.map(t=>`<tr data-id="${i(t.id_obra)}">
      <td>${H(t)}</td><td class="mono"><b>${i(t.id_obra)}</b></td>
      <td class="mo-trunc" title="${i(t.nombre_cliente||"")}">${i(t.nombre_cliente||"—")} <span class="mo-muted mono">${i(t.id_cliente||"")}</span></td>
      <td class="mo-trunc" title="${i(t.direccion||"")}">${i(t.direccion||"—")}</td><td>${i(t.comuna||"—")}</td>
      <td class="r mono">${t.lat!=null?(+t.lat).toFixed(6):"—"}</td><td class="r mono">${t.lon!=null?(+t.lon).toFixed(6):"—"}</td>
      <td>${i(t.contacto_nombre||"—")}</td><td class="mono">${i(t.contacto_telefono||"—")}</td><td>${i(t.contacto_email||"—")}</td>
      <td><button class="mo-btn sm" data-edit>${b($(t).falta?"edit_location_alt":"edit")}${$(t).falta?"Ubicar":"Editar"}</button></td></tr>`).join("")||'<tr><td colspan="11" class="mo-muted" style="text-align:center;padding:24px">Sin obras para el filtro.</td></tr>'}</tbody></table></div>
    <div class="mo-pag"><span class="mo-muted">${r} obras${r>e?` · página ${l.pag+1} de ${Math.ceil(r/e)}`:""}</span>
      ${r>e?`<button class="mo-btn sm" data-p="-1" ${l.pag?"":"disabled"}>‹</button><button class="mo-btn sm" data-p="1" ${(l.pag+1)*e<r?"":"disabled"}>›</button>`:""}</div>`,o("[data-cont]").querySelectorAll("[data-p]").forEach(t=>t.addEventListener("click",()=>{l.pag+=+t.dataset.p,k()})),o("[data-cont]").querySelectorAll("[data-edit]").forEach(t=>t.addEventListener("click",async()=>{const d=t.closest("tr").dataset.id,g=await G(d);if(g){const q=l.obras.findIndex(S=>S.id_obra===g.id_obra);q>=0&&(l.obras[q]=g),k()}}))}function V(){const o=e=>w.querySelector(e);o("[data-est]").innerHTML="";const p=new Map;l.obras.forEach(e=>p.set(e.id_cliente,(p.get(e.id_cliente)||0)+1));const c=l.q,u=l.clientes.filter(e=>!c||[e.id_cliente,e.nombre,e.contacto_nombre,e.contacto_telefono,e.contacto_email].some(r=>String(r||"").toLowerCase().includes(c))),s=u.slice(0,300),n=j();o("[data-cont]").innerHTML=`<div class="mo-tscroll"><table class="mo-t"><thead><tr><th>Cliente</th><th>Nombre</th><th class="r">Obras</th><th>Contacto</th><th>Teléfono</th><th>Correo (opcional)</th><th></th></tr></thead>
    <tbody>${s.map(e=>`<tr data-id="${i(e.id_cliente)}"><td class="mono"><b>${i(e.id_cliente)}</b></td><td>${i(e.nombre||"—")}</td><td class="r mono">${p.get(e.id_cliente)||0}</td>
      <td><input class="mo-in" data-f="contacto_nombre" value="${i(e.contacto_nombre||"")}" ${n?"":"disabled"}></td>
      <td><input class="mo-in" data-f="contacto_telefono" value="${i(e.contacto_telefono||"")}" ${n?"":"disabled"}></td>
      <td><input class="mo-in" data-f="contacto_email" value="${i(e.contacto_email||"")}" ${n?"":"disabled"}></td>
      <td>${n?`<button class="mo-btn sm" data-save disabled>${b("save")}</button>`:""}</td></tr>`).join("")}</tbody></table></div>
    <div class="mo-pag"><span class="mo-muted">${u.length} clientes${u.length>s.length?" · mostrando 300 (use la búsqueda)":""}</span></div>`,o("[data-cont]").querySelectorAll("tr[data-id]").forEach(e=>{const r=e.querySelector("[data-save]");r&&(e.querySelectorAll("[data-f]").forEach(h=>h.addEventListener("input",()=>{r.disabled=!1,r.classList.add("pri")})),r.addEventListener("click",async()=>{const h={};if(e.querySelectorAll("[data-f]").forEach(g=>{h[g.dataset.f]=g.value.trim()||null}),h.contacto_email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(h.contacto_email)){alert("Correo inválido");return}r.disabled=!0;const{error:t}=await E.from("maestro_clientes").update(h).eq("id_cliente",e.dataset.id);if(t){r.disabled=!1,alert("No se pudo guardar: "+t.message);return}const d=l.clientes.find(g=>g.id_cliente===e.dataset.id);Object.assign(d,h),r.classList.remove("pri"),r.innerHTML=b("check")}))})}function P(){if(document.getElementById("mo-style"))return;const o=document.createElement("style");o.id="mo-style",o.textContent=`
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
`,document.head.appendChild(o)}export{U as GEO,G as abrirEditorObra,H as badgeGeo,Q as cargarObras,K as faltaGeo,$ as geoDe,j as puedeEditarObras,W as renderMaestroObras,B as tieneUbicacion};
