import{supabase as H}from"./supabase-client.js?v=fd17fd7d20";import{getDatabase as Q,loadRoutesData as ze,HIST_ALIAS_PREFIJO as Me}from"./data.js?v=6ce8cb5f60";import{loadLeaflet as Ce}from"./utils.js";import{filtrarPorCentro as Te,can as Pe}from"./permisos.js?v=a8b193e9fb";import{cargarObras as qe,abrirEditorObra as Fe,tieneUbicacion as ee,badgeGeo as je}from"./maestro-obras.js?v=2643773560";const de={tiles:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",kgUnitSospechoso:5e3},pe="sit_cc_sucursal",G=[{key:"EBE-DESP",label:"EBEMA Despacha",corto:"EBEMA despacha",color:"#2563eb",bg:"#dbeafe",ink:"#1e40af",icon:"local_shipping"},{key:"EBE-RET / EBE-DESP",label:"EBEMA Retira – EBEMA Despacha",corto:"Retira EBEMA › despacha",color:"#0d9488",bg:"#ccfbf1",ink:"#115e59",icon:"sync_alt"},{key:"EBE-RET / CLI-RET",label:"EBEMA Retira – Cliente Retira",corto:"Retira EBEMA › cliente",color:"#ea580c",bg:"#ffedd5",ink:"#9a3412",icon:"storefront"},{key:"FAB-DESP / EBE-DESP",label:"Fábrica Despacha – EBEMA Despacha",corto:"Fábrica › EBEMA despacha",color:"#7c3aed",bg:"#ede9fe",ink:"#5b21b6",icon:"factory"}],fe=e=>String(e||"").toUpperCase().replace(/\s*\/\s*/g," / ").replace(/\s+/g," ").trim(),O=new Map(G.map(e=>[e.key,e])),V=[{key:"sin",label:"Sin entrega",icon:"schedule",color:"#6b7280",bg:"#f3f4f6",ink:"#374151"},{key:"parcial",label:"Entrega parcial",icon:"incomplete_circle",color:"#f59e0b",bg:"#fef3c7",ink:"#92400e"},{key:"lista",label:"Con entrega",icon:"task_alt",color:"#16a34a",bg:"#dcfce7",ink:"#166534"},{key:"bloq",label:"Bloqueado",icon:"block",color:"#dc2626",bg:"#fee2e2",ink:"#991b1b"}],A=new Map(V.map(e=>[e.key,e])),Ge=/^(60|70|CR)\b/i,n={raw:null,sucursal:"",centro:null,pedidos:[],byId:new Map,cond:new Set(G.map(e=>e.key)),fEstado:"todos",soloVencidos:!1,soloExpress:!1,soloSinGeo:!1,q:"",sel:null,editGeo:!1,orden:{col:"prio",dir:1}};let _=null,v=null,P=null,U=null,R=null;const C=new Map,N=new Map,B=new Map,f=e=>_.querySelector(e),l=e=>String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]),S=e=>{const t=String(e??"").trim();if(!t)return 0;const c=t.includes(",")?t.replace(/\./g,"").replace(",","."):t,a=parseFloat(c);return Number.isFinite(a)?a:0},y=e=>String(e??"").trim().replace(/^0+(?=\d)/,""),w=(e,t=2)=>(Number.isFinite(e)?e:0).toLocaleString("es-CL",{minimumFractionDigits:t,maximumFractionDigits:t}),be=e=>`${Math.round((Number.isFinite(e)?e:0)*100)}%`,ge=e=>{const t=String(e||"").match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);return t?`${t[3]}-${t[2]}-${t[1]}`:""},q=e=>e?`${e.slice(8,10)}-${e.slice(5,7)}-${e.slice(0,4)}`:"—",me=()=>{const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`},ue=e=>{if(!e)return null;const t=new Date(e+"T00:00:00"),c=new Date(me()+"T00:00:00");return Math.round((t-c)/864e5)},z=e=>Number.isFinite(e.latitud)&&Number.isFinite(e.longitud),Oe=e=>{let t=2166136261;for(const c of String(e))t^=c.charCodeAt(0),t=Math.imul(t,16777619);return t>>>0},d=(e,t="")=>`<span class="material-symbols-outlined"${t}>${e}</span>`,h=e=>"$"+Math.round(Number.isFinite(e)?e:0).toLocaleString("es-CL"),K='<span class="cc-rayo" title="Flete express · pedido spot"><span class="material-symbols-outlined">bolt</span></span>';function Be(e,t,c){return c<e?e:t>0&&c>t?t:c}async function xe(e){const t=[];for(let c=0;;c+=1e3){const{data:a,error:o}=await e().range(c,c+999);if(o)throw new Error(o.message);if(t.push(...a||[]),!a||a.length<1e3)break}return t}async function he(){await ze();const[e,t]=await Promise.all([xe(()=>H.from("trc_live").select("data,cargado_en").eq("fuente","pedidos_ventas_sucursal").order("fila")),xe(()=>H.from("trc_live").select("data").eq("fuente","entregas_periodo").order("fila"))]),c=e.map(b=>b.data).filter(b=>O.has(fe(b?.cond_expedicion))),a=[...new Set(c.map(b=>y(b.material)).filter(Boolean))],o=new Map;for(let b=0;b<a.length;b+=300){const{data:s,error:g}=await H.from("maestro_productos").select("id_material,peso_bruto").in("id_material",a.slice(b,b+300));if(g)break;(s||[]).forEach(u=>{+u.peso_bruto>0&&o.set(y(u.id_material),+u.peso_bruto)})}const r=e.reduce((b,s)=>s.cargado_en&&s.cargado_en>b?s.cargado_en:b,"");let p=new Map,m=!0;try{p=await qe(c.map(b=>b.id_obra))}catch{m=!1}n.raw={suc:Te(c,b=>y(b.ofvta)),ent:t.map(b=>b.data),geo:p,geoOk:m,maestro:o,cargado:r}}function De(){const e=Q(),t=new Map;return(e.routes||[]).forEach(c=>{c.codigo&&t.set(String(c.codigo).trim().toUpperCase(),c)}),c=>{const a=String(c||"").trim().toUpperCase();if(!a)return null;let o=t.get(a);if(!o){const r=Me[a.slice(0,3)];r&&(o=t.get(r+a.slice(3)))}return o||null}}function Ie(e){const{suc:t,ent:c,geo:a,maestro:o}=n.raw,r=De(),p=new Map;c.forEach(s=>{if(!/^ZE/i.test(String(s.tipo_entrega||"")))return;const g=y(s.documento_precedente_doc_modelo)+"|"+y(s.posicion_modelo),u=p.get(g)||{cant:0,entregas:new Set};u.cant+=S(s.cantidad_entregada),u.entregas.add(y(s.entrega)),p.set(g,u)});const m=new Map;t.forEach(s=>{if(y(s.ofvta)!==e)return;const g=y(s.doc_ventas);if(!g)return;const u=String(s.motivo_rechazo||s.mr||"").trim();if(Ge.test(u))return;let i=m.get(g);if(!i){const k=r(s.ruta),Le=String(s.ruta_desc||"").split("/").slice(1).join("/").trim();i={id_pedido:g,id_obra:y(s.id_obra),cliente:String(s.nombre_cliente||"").trim(),solic:y(s.solic),cond:fe(s.cond_expedicion),clase:s.clvt||"",rutaCodigo:k?String(k.codigo).toUpperCase():String(s.ruta||"").trim().toUpperCase(),rutaDesc:s.ruta_desc||"",comuna:k&&k.comuna||Le||(s.ruta?String(s.ruta):"Sin ruta"),direccion:String(s.direccion_obra||"").trim(),interlocutor:s.interlocutor||"",creado:ge(s.creado_el),latitud:null,longitud:null,geoExacta:!1,_rutaObj:k,posiciones:[]},m.set(g,i)}const x=S(s.cantidad_de_pedido),j=S(s.pendiente_entrega),W=S(s.peso_bruto),E=String(s.um||"").trim().toUpperCase(),se=y(s.material),re=E==="KG"?1:o.get(se)||(x>0?W/x:0),le=[u,s.dcto_vendedor].map(k=>String(k||"").trim()).filter(Boolean).join(" / "),Se=String(s.bloqueada||"").trim().toUpperCase()==="X"||!!le,Y=y(s.pos),M={reparto:y(s.reparto)||"—",fecha:ge(s.fe_entrega),confirmada:S(s.reparto_confirmado||s.ctd_confirmada),pendiente:j,entregado:S(s.cantidad_entrg)};let $=i.posiciones.find(k=>k.pos===Y);if(!$){const k=p.get(g+"|"+Y);$={pos:Y,sku:se,descripcion:s.denominacion_de_posicion||"",um:E,cantidad:x,confirmada:0,entregado:0,pendiente:0,kgUnit:re>de.kgUnitSospechoso?0:re,bloqueo:Se?le||"X":null,fecha:"",repartos:[],entTrat:k?k.cant:0,entregas:k?[...k.entregas]:[],fleteTraslado:S(s.flete_zflt),fleteUltMilla:S(s.flete_zfl0_zfl1),fleteMin:S(s.flete_minimo),fleteMax:S(s.flete_maximo),fletePk:S(s.flete_peso_kilo),express:String(s.flete_express||"").trim().toUpperCase()==="X"},$.fleteSug=Be($.fleteMin,$.fleteMax,$.fletePk),i.posiciones.push($)}$.repartos.push(M),$.confirmada+=M.confirmada,$.entregado+=M.entregado,$.pendiente+=M.pendiente,j>0&&M.fecha&&(!$.fecha||M.fecha<$.fecha)&&($.fecha=M.fecha),!$.fecha&&M.fecha&&($.fecha=M.fecha)});const b=[...m.values()].filter(s=>s.posiciones.some(g=>g.pendiente>0));return b.forEach(s=>{const g=a.get(s.id_obra);if(s.obra=g||null,ee(g))s.latitud=+g.lat,s.longitud=+g.lon,s.geoExacta=!0;else if(s._rutaObj&&Number.isFinite(+s._rutaObj.lat)&&Number.isFinite(+s._rutaObj.lon)&&+s._rutaObj.lat!=0){const u=Oe(s.id_pedido),i=u%360*Math.PI/180,x=.0012+(u>>>9)%100/100*.0045;s.latitud=+s._rutaObj.lat+x*Math.sin(i),s.longitud=+s._rutaObj.lon+x*1.2*Math.cos(i)}ve(s)}),b}function ve(e){const t=e.posiciones.filter(i=>i.pendiente>0),c=t.filter(i=>!i.bloqueo),a=t.filter(i=>i.bloqueo),o=i=>i.entTrat+1e-6>=i.pendiente,r=c.filter(i=>i.entTrat>0),p=c.reduce((i,x)=>i+x.pendiente*x.kgUnit,0),m=c.reduce((i,x)=>i+Math.min(x.entTrat,x.pendiente)*x.kgUnit,0);e._ton=p/1e3,e._avance=c.length?p>0?m/p:c.filter(o).length/c.length:0,e._nPos=t.length,e._nLib=c.length,e._nBloq=a.length,e._nCub=c.filter(o).length,e._entregas=[...new Set(c.flatMap(i=>i.entregas))],e._estado=c.length?c.every(o)?"lista":r.length||c.some(i=>i.entregado>0)?"parcial":"sin":"bloq";const b=(c.length?c:t).map(i=>i.fecha).filter(Boolean).sort();e.fecha=b[0]||"",e._dias=ue(e.fecha),e._vencido=e._estado!=="lista"&&e._dias!==null&&e._dias<0;const s=[];e._vencido&&s.push({t:"rd",txt:`Vencido ${-e._dias} d`}),e._estado!=="bloq"&&a.length&&s.push({t:"am",txt:`Bloqueo parcial · ${a.length} pos.`}),c.some(i=>i.confirmada+1e-6<i.cantidad)&&s.push({t:"am",txt:"Unidades sin confirmar"}),e._sinGeo=!e.geoExacta,e._sinGeo?s.push({t:"rd",txt:e.obra&&e.obra.geo_estado==="PENDIENTE"?"Georref. pendiente":"Falta georreferencia"}):e.obra&&e.obra.geo_estado==="AUTO_CALLE"&&s.push({t:"am",txt:"Ubicación calle (aprox.)"}),e._marcas=s,e.codigo_bloqueo=[...new Set(a.map(i=>i.bloqueo))].join(", "),e._express=e.posiciones.some(i=>i.express),e._express&&s.unshift({t:"xp",txt:"Express · spot"});const g=e.posiciones,u=i=>g.reduce((x,j)=>x+(j[i]||0),0);e._flete={min:u("fleteMin"),max:u("fleteMax"),pk:u("fletePk"),sug:u("fleteSug"),traslado:u("fleteTraslado"),ultMilla:u("fleteUltMilla")},e._flete.cobrado=e._flete.traslado+e._flete.ultMilla,e._prio=(e._express?0:1)*1e8+(e._estado==="bloq"?0:e._vencido?1:e._estado==="sin"?2:e._estado==="parcial"?3:4)*1e6+(e._dias??9999)}const Ae=e=>n.cond.has(e.cond)&&(n.fEstado==="todos"||e._estado===n.fEstado)&&(!n.soloVencidos||e._vencido)&&(!n.soloExpress||e._express)&&(!n.soloSinGeo||e._sinGeo);function te(e){const t=n.q.trim().toLowerCase();return!t||[e.id_pedido,e.id_obra,e.cliente,e.comuna,e.direccion,e.rutaCodigo,...e._entregas].some(c=>String(c||"").toLowerCase().includes(t))}const D=()=>n.pedidos.filter(e=>Ae(e)&&te(e));function ce(e){n.sucursal=e;try{localStorage.setItem(pe,e)}catch{}const c=(Q().logisticsCentres||[]).find(o=>String(o.id)===e);n.centro={id:e,nombre:c?c.nombre:`Centro ${e}`,lat:c?+c.lat:-33.45,lon:c?+c.lon:-70.66},n.pedidos=Ie(e),n.byId=new Map(n.pedidos.map(o=>[o.id_pedido,o])),n.sel=null,Ne(),Je(),F(!0);const a=n.pedidos.filter(o=>o._express&&n.cond.has(o.cond)).length;a&&T("xp",`${a} pedido${a>1?"s":""} express (spot) en ${n.centro.nombre}`,"Flete express: revisar y coordinar a la brevedad. Filtre con la tarjeta Express.")}function Ue(){v=L.map(f("#cc-map"),{zoomControl:!0}).setView([n.centro.lat,n.centro.lon],11),L.tileLayer(de.tiles,{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(v),P=L.layerGroup().addTo(v),U=L.layerGroup().addTo(v)}function Ne(){v||Ue(),P.clearLayers(),U.clearLayers(),C.clear(),N.clear(),B.clear(),R&&R.remove(),R=L.marker([n.centro.lat,n.centro.lon],{icon:L.divIcon({className:"cc-pin-wrap",html:`<div class="cc-hub">${d("warehouse")}</div>`,iconSize:[36,36],iconAnchor:[18,18]}),zIndexOffset:2e3,keyboard:!1}).addTo(v).bindTooltip(`<div class="cc-tt-h">${l(n.centro.nombre)}</div><div class="cc-tt-r">Centro ${l(n.centro.id)}</div>`,{className:"cc-tt",direction:"top",offset:[0,-16]}),n.editGeo&&(n.editGeo=!1,f("#cc-btn-geo").classList.remove("is-on")),setTimeout(()=>{v.invalidateSize(),X()},0)}function X(){const e=D().filter(z).map(t=>[t.latitud,t.longitud]);e.push([n.centro.lat,n.centro.lon]),e.length>1?v.fitBounds(e,{padding:[30,30],maxZoom:13}):v.setView(e[0],11)}function He(e){const t=O.get(e.cond),c=A.get(e._estado),r=`<div class="${`cc-pin${n.sel===e.id_pedido?" sel":""}${e.geoExacta?"":" aprox nogeo"}${n.editGeo&&!e.geoExacta?" drag":""}${e._vencido?" venc":""}${e._express?" xp":""}`}" style="--pc:${t.color}" data-id="${l(e.id_pedido)}">${d(t.icon)}<i class="cc-pin-st" style="background:${c.color}" title="${l(c.label)}"></i>${e._express?`<b class="cc-pin-xp">${d("bolt")}</b>`:""}${e._sinGeo?`<b class="cc-pin-ng" title="Falta georreferencia">${d("question_mark")}</b>`:""}</div>`;return{firma:r,icon:L.divIcon({className:"cc-pin-wrap",html:r,iconSize:[30,30],iconAnchor:[15,15]})}}function Ve(e){const t=O.get(e.cond),c=A.get(e._estado);return`<div class="cc-tt-h"><span class="cc-ci" style="background:${t.color}">${d(t.icon)}</span><span class="mono">${l(e.id_pedido)}</span>${e._express?K:""}<span class="cc-est-pill" style="background:${c.bg};color:${c.ink}">${l(c.label)}</span></div>
    <div class="cc-tt-r"><b>${l(e.cliente)}</b><br>${l(t.label)}<br>${l(e.direccion||"—")} · ${l(e.comuna)}<br>F. entrega <b>${q(e.fecha)}</b> · ${e._nCub}/${e._nLib} pos. con entrega · ${w(e._ton,1)} t</div>
    ${e._marcas.length?`<div class="cc-tt-r" style="margin-top:3px">${e._marcas.map(a=>`<span class="cc-tag ${a.t}">${l(a.txt)}</span>`).join(" ")}</div>`:""}
    <div class="cc-tt-f">${n.editGeo&&!e.geoExacta?"Arrastre al punto de la obra y guarde":"Clic para ver el detalle"}</div>`}function ae(){const e=new Set(D().map(t=>t.id_pedido));n.pedidos.forEach(t=>{const c=t.id_pedido;let a=C.get(c);if(!z(t)){a&&(P.removeLayer(a),C.delete(c),N.delete(c));return}const{firma:o,icon:r}=He(t);a?N.get(c)!==o&&(a.setIcon(r),N.set(c,o)):(a=L.marker([t.latitud,t.longitud],{icon:r,riseOnHover:!0,draggable:!1}),a.on("click",()=>{if(n.editGeo&&!t.geoExacta){a.openPopup();return}I(c,{desdeMapa:!0}),J(c)}),a.on("mouseover",()=>ye(c,!0)),a.on("mouseout",()=>ye(c,!1)),a.on("dragend",()=>{a._movido=!0,a.openPopup()}),a.bindTooltip(()=>Ve(t),{className:"cc-tt",direction:"top",offset:[0,-14]}),C.set(c,a),N.set(c,o));const p=n.editGeo&&!t.geoExacta;p&&!a.getPopup()&&a.bindPopup(()=>ke(t,a),{minWidth:240}),!p&&a.getPopup()&&a.unbindPopup(),a.dragging&&(p?a.dragging.enable():a.dragging.disable()),a.setZIndexOffset(n.sel===c?1500:t._express?900:t._estado==="bloq"||t._vencido?300:0);const m=e.has(c);m&&!P.hasLayer(a)&&P.addLayer(a),!m&&P.hasLayer(a)&&P.removeLayer(a)})}function Re(e){const t=C.get(e);return t&&t.getElement()?t.getElement().querySelector(".cc-pin"):null}function Z(e,t){const c=Re(e);c&&c.classList.toggle("hl",t)}function ye(e,t){_.querySelectorAll(`[data-id="${CSS.escape(e)}"]`).forEach(c=>{c.classList.contains("cc-pin")||c.classList.toggle("is-hl",t)})}function I(e,{desdeMapa:t=!1,sinScroll:c=!1}={}){if(n.sel=e,ae(),we(),ne(),!n.sel)return;const a=n.byId.get(e);if(!t&&z(a)&&(v.setView([a.latitud,a.longitud],Math.max(v.getZoom(),14)),setTimeout(()=>{const p=C.get(e);p&&p.openTooltip()},260)),c)return;const o=_.querySelector(`tr[data-id="${CSS.escape(e)}"]`);o&&o.scrollIntoView({block:"nearest",behavior:"smooth"});const r=_.querySelector(`.cc-li[data-id="${CSS.escape(e)}"]`);r&&r.scrollIntoView({block:"nearest",behavior:"smooth"})}const oe=()=>{const e=new Map;return D().forEach(t=>{!t.geoExacta&&t.id_obra&&!e.has(t.id_obra)&&e.set(t.id_obra,t)}),[...e.values()]};async function Ke(e,t,c){const a={lat:+(+t).toFixed(6),lon:+(+c).toFixed(6),geo_estado:"MANUAL",geo_detalle:"Ubicada a mano en el Monitor de Pedidos"},{data:o,error:r}=await H.from("maestro_obras").update(a).eq("id_obra",e).select("*").maybeSingle();if(r)throw new Error(r.message);if(!o)throw new Error("La obra aún no está en el maestro (se sincroniza cada 10 min) o su perfil no puede editarla.");return o}function $e(e){e&&(n.raw.geo.set(y(e.id_obra),e),n.pedidos.forEach(t=>{if(t.id_obra!==y(e.id_obra))return;t.obra=e,ee(e)&&(t.latitud=+e.lat,t.longitud=+e.lon,t.geoExacta=!0),ve(t);const c=C.get(t.id_pedido);c&&z(t)&&c.setLatLng([t.latitud,t.longitud])}),F())}async function Xe(e){const t=await Fe(e.id_obra,{base:{direccion:e.direccion,comuna:e.comuna,nombre_cliente:e.cliente,id_cliente:e.solic,ruta:e.rutaCodigo},centro:z(e)?{lat:e.latitud,lon:e.longitud}:{lat:n.centro.lat,lon:n.centro.lon}});return t&&($e(t),T("ok",`Obra ${t.id_obra} guardada`,ee(t)?"Los pedidos de esta obra (actuales y futuros) toman esta ubicación.":"Datos de contacto guardados.")),t}function Ze(e){if(e&&!n.raw.geoOk){T("err","Georreferenciación no disponible","No se pudo leer el maestro de obras.");return}if(e&&!Pe("editar")){T("warn","Sin permiso de edición","Su perfil no puede guardar coordenadas de obra.");return}n.editGeo=e,f("#cc-btn-geo").classList.toggle("is-on",e),U.clearLayers(),B.clear(),e||n.pedidos.forEach(t=>{const c=C.get(t.id_pedido);c&&z(t)&&(c._movido=!1,c.closePopup(),c.setLatLng([t.latitud,t.longitud]))}),e&&oe().filter(t=>!z(t)).forEach((t,c)=>{const a=L.marker([n.centro.lat+.012*Math.cos(c*.9),n.centro.lon+.015*Math.sin(c*.9)],{draggable:!0,autoPan:!0,zIndexOffset:3e3,icon:L.divIcon({className:"cc-pin-wrap",html:`<div class="cc-pin edit">${d("location_on")}</div>`,iconSize:[30,30],iconAnchor:[15,15]})});a.bindPopup(()=>ke(t,a),{minWidth:240}),a.on("dragend",()=>{a._movido=!0,a.openPopup()}),a.addTo(U),B.set(t.id_obra,a)}),_e(),ae()}function ke(e,t){const c=n.pedidos.filter(m=>m.id_obra===e.id_obra).map(m=>m.id_pedido),{lat:a,lng:o}=t.getLatLng(),r=document.createElement("div");r.className="cc-geo-pop",r.innerHTML=`<div><b>Obra ${l(e.id_obra)}</b> <span class="cc-tag am">${z(e)?"Ubicación aprox.":"Sin ubicación"}</span></div>
    <div style="font-size:12px;color:#5c5f61">${l(e.cliente)}<br>${l(e.direccion||"—")}<br>${l(e.comuna)} · pedidos <span class="mono">${c.map(l).join(", ")}</span></div>
    <div class="mono">${a.toFixed(6)}, ${o.toFixed(6)}</div>
    <div style="font-size:11.5px;color:#5c5f61">${t._movido?"Verifique el punto y guarde.":"Arrastre el marcador al acceso de la obra."}</div>`;const p=document.createElement("button");return p.className="cc-btn pri sm",p.innerHTML=`${d("save")}Guardar coordenadas`,p.disabled=!t._movido,p.onclick=async()=>{p.disabled=!0,p.textContent="Guardando…";const m=t.getLatLng();try{const b=await Ke(e.id_obra,m.lat,m.lng);$e(b),B.has(e.id_obra)&&(U.removeLayer(B.get(e.id_obra)),B.delete(e.id_obra)),c.forEach(s=>{const g=C.get(s);g&&(g.closePopup(),g.setLatLng([b.lat,b.lon]))}),t.closePopup(),T("ok",`Obra ${e.id_obra} georreferenciada`,`${c.length} pedido${c.length>1?"s":""} con ubicación exacta.`),F()}catch(b){p.disabled=!1,p.innerHTML=`${d("save")}Reintentar`,T("err","No se pudo guardar",b.message||String(b))}},r.appendChild(p),r}function _e(){const e=f("#cc-maphint");n.editGeo?(e.innerHTML=`${d("edit_location_alt")}Modo edición: arrastre los pines de borde punteado (${oe().length} obras) y guarde`,e.classList.add("show")):e.classList.remove("show")}function Je(){const e=Q(),t=[...new Set(n.raw.suc.map(c=>y(c.ofvta)).filter(Boolean))].sort();f("#cc-suc").innerHTML=t.map(c=>{const a=(e.logisticsCentres||[]).find(o=>String(o.id)===c);return`<option value="${l(c)}"${c===n.sucursal?" selected":""}>${l(c)} · ${l(a?a.nombre:"")}</option>`}).join(""),f("#cc-centro-lbl").textContent=`Torre de Control · ${n.centro.nombre}`}function We(){const e=n.pedidos.filter(o=>n.cond.has(o.cond)&&te(o)),t=o=>e.filter(r=>r._estado===o).length,c=e.filter(o=>o._vencido).length,a=[{k:"todos",label:"Pedidos",icon:"receipt_long",v:e.length,color:"#191c1d",sub:`${w(e.reduce((o,r)=>o+r._ton,0),1)} t pendientes`},...V.map(o=>({k:o.key,label:o.label,icon:o.icon,v:t(o.key),color:o.color,sub:e.length?be(t(o.key)/e.length):"0%"}))];f("#cc-kpis").innerHTML=a.map(o=>`<button class="cc-kpi${n.fEstado===o.k?" is-on":""}" data-est="${o.k}" style="--kc:${o.color}">
      <span class="cc-kpi-ic">${d(o.icon)}</span><span class="cc-kpi-b"><span class="cc-kpi-l">${l(o.label)}</span><b class="num">${o.v}</b><span class="cc-kpi-s">${l(o.sub)}</span></span></button>`).join("")+`<button class="cc-kpi xp${n.soloExpress?" is-on":""}${e.some(o=>o._express)?" alerta":""}" data-xp="1" style="--kc:#ca8a04"><span class="cc-kpi-ic">${d("bolt")}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Express (spot)</span><b class="num">${e.filter(o=>o._express).length}</b><span class="cc-kpi-s">Atender a la brevedad</span></span></button><button class="cc-kpi ng${n.soloSinGeo?" is-on":""}" data-ng="1" style="--kc:#7c2d12"><span class="cc-kpi-ic">${d("wrong_location")}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Sin georreferencia</span><b class="num">${e.filter(o=>o._sinGeo).length}</b><span class="cc-kpi-s">Ubicar obra</span></span></button><button class="cc-kpi venc${n.soloVencidos?" is-on":""}" data-venc="1" style="--kc:#b91c1c"><span class="cc-kpi-ic">${d("event_busy")}</span><span class="cc-kpi-b"><span class="cc-kpi-l">Vencidos</span><b class="num">${c}</b><span class="cc-kpi-s">F. entrega &lt; hoy</span></span></button>`}function Ye(){const e=n.pedidos.filter(te);f("#cc-cond").innerHTML=G.map(t=>{const c=e.filter(a=>a.cond===t.key).length;return`<button class="cc-cchip${n.cond.has(t.key)?" is-on":""}" data-cond="${l(t.key)}" style="--cc:${t.color};--cb:${t.bg};--ci:${t.ink}" title="${l(t.key)}">
      <span class="cc-ci" style="background:${t.color}">${d(t.icon)}</span>${l(t.label)}<span class="cc-cnt">${c}</span></button>`}).join(""),f("#cc-legend").innerHTML=G.map(t=>`<div><span class="cc-ci sm" style="background:${t.color}">${d(t.icon)}</span>${l(t.corto)}</div>`).join("")+'<div class="cc-legend-sep"></div>'+V.map(t=>`<div><i style="background:${t.color}"></i>${l(t.label)}</div>`).join("")+'<div><i class="dash"></i>Ubicación aprox. (ruta)</div>'}function we(){let e="";const t=D().sort((c,a)=>c._prio-a._prio).slice(0,150);e+=`<div class="cc-sec-t"><span>Pedidos por atender</span><span>${D().length}</span></div>`,t.length||(e+=`<div class="cc-empty">${d("inbox")}Sin pedidos para los filtros actuales.</div>`),e+=t.map(c=>{const a=O.get(c.cond),o=A.get(c._estado),r=c._dias===null?"Sin fecha":c._dias<0?`Vencido hace ${-c._dias} d`:c._dias===0?"Entrega hoy":c._dias===1?"Entrega mañana":`En ${c._dias} días`;return`<div class="cc-li${n.sel===c.id_pedido?" is-sel":""}${c._express?" xp":""}" data-id="${l(c.id_pedido)}">
      <span class="cc-ci" style="background:${a.color}">${d(a.icon)}</span>
      <div style="min-width:0"><div class="cc-li-id">${l(c.id_pedido)}${c._express?K:""}${c._sinGeo?'<span class="cc-ng" title="Falta georreferencia de la obra">'+d("wrong_location")+"</span>":""}<span class="cc-est-pill" style="background:${o.bg};color:${o.ink}">${l(o.label)}</span></div>
      <div class="cc-li-sub">${l(c.cliente)} · ${l(c.comuna)}</div>
      <div class="cc-li-f"><span class="${c._vencido?"cc-venc":""}">${d("event")}${r}</span><span class="cc-mini"><i style="width:${c._avance*100}%;background:${o.color}"></i></span><span class="mono">${c._nCub}/${c._nLib}</span></div></div>
      <span class="cc-x">${d("chevron_right")}</span></div>`}).join(""),f("#cc-pane").innerHTML=e}function Qe(){const e=D(),t={prio:c=>c._prio,estado:c=>V.findIndex(a=>a.key===c._estado),id:c=>c.id_pedido,cond:c=>G.findIndex(a=>a.key===c.cond),cliente:c=>c.cliente,comuna:c=>c.comuna,fecha:c=>c.fecha||"9999",creado:c=>c.creado||"9999",flete:c=>c._flete.sug,avance:c=>c._avance,ton:c=>c._ton}[n.orden.col];return e.sort((c,a)=>{const o=t(c),r=t(a);return(o>r?1:o<r?-1:0)*n.orden.dir||c.id_pedido.localeCompare(a.id_pedido)}),e}function ne(){const e=Qe();f("#cc-tbody").innerHTML=e.map(t=>{const c=O.get(t.cond),a=A.get(t._estado),o=t.id_pedido;return`<tr data-id="${l(o)}" class="${n.sel===o?"is-sel":""}${t._express?" xp":""}">
      <td><span class="cc-est-pill" style="background:${a.bg};color:${a.ink}">${d(a.icon)}${l(a.label)}</span></td>
      <td class="mono"><b>${l(o)}</b>${t._express?K:""}</td>
      <td><span class="cc-cond" style="background:${c.bg};color:${c.ink}"><span class="cc-ci xs" style="background:${c.color}">${d(c.icon)}</span>${l(c.label)}</span></td>
      <td class="cc-td-cli" title="${l(t.cliente)}">${l(t.cliente)}</td>
      <td class="mono">${l(t.id_obra)}</td>
      <td>${l(t.comuna)}</td>
      <td class="mono">${q(t.creado)}</td>
      <td class="mono${t._vencido?" cc-venc":""}">${q(t.fecha)}</td>
      <td class="r mono">${t._flete.sug?h(t._flete.sug):"—"}</td>
      <td><span class="cc-av"><span class="cc-mini"><i style="width:${t._avance*100}%;background:${a.color}"></i></span><span class="mono">${t._nCub}/${t._nLib} pos.</span></span></td>
      <td class="mono">${t._entregas.length?l(t._entregas.slice(0,2).join(", "))+(t._entregas.length>2?` +${t._entregas.length-2}`:""):"—"}</td>
      <td class="r mono">${w(t._ton,2)}</td>
      <td>${t._marcas.map(r=>`<span class="cc-tag ${r.t}">${l(r.txt)}</span>`).join(" ")}${t._estado==="bloq"?` <span class="cc-tag rd">${l(t.codigo_bloqueo)}</span>`:""}</td>
      <td><div class="cc-acts">
        <button class="cc-ib" data-act="ver" title="${z(t)?"Ver en mapa":"Sin ubicación"}" ${z(t)?"":"disabled"}>${d("my_location")}</button>
        <button class="cc-ib" data-act="detalle" title="Detalle de posiciones y entregas">${d("fact_check")}</button></div></td></tr>`}).join("")||'<tr><td colspan="14" style="text-align:center;color:var(--cc-ink2);padding:24px">Sin pedidos para los filtros actuales.</td></tr>',f("#cc-tbar-s").textContent=`${e.length} de ${n.pedidos.length} pedidos · ${w(e.reduce((t,c)=>t+c._ton,0),1)} t pendientes`,_.querySelectorAll(".cc-t th.sort").forEach(t=>{t.querySelector(".material-symbols-outlined")?.remove(),t.dataset.col===n.orden.col&&t.insertAdjacentHTML("beforeend",d(n.orden.dir>0?"arrow_upward":"arrow_downward"))}),f("#cc-geo-cnt").textContent=oe().length}function F(e=!1){We(),Ye(),ae(),we(),ne(),_e(),e&&v&&X()}function J(e){const t=n.byId.get(e),c=O.get(t.cond),a=A.get(t._estado),o=me(),r=t._flete,p=[...t.posiciones].sort((i,x)=>i.pos.localeCompare(x.pos,"es",{numeric:!0})),m=!p.some(i=>i.fleteMin||i.fleteMax||i.fletePk),b=p.map(i=>{const x=i.bloqueo?"Bloqueada":i.pendiente<=0?"Entregada":i.entTrat+1e-6>=i.pendiente?"Con entrega":i.entTrat>0?"Entrega parcial":"Sin entrega",j=i.fletePk<i.fleteMin?"Mín.":i.fleteMax>0&&i.fletePk>i.fleteMax?"Máx.":"$/kg",W=i.repartos.map(E=>`<span class="cc-rep${E.fecha&&E.fecha<o&&E.pendiente>0?" venc":""}" title="Reparto ${l(E.reparto)} · confirmado ${w(E.confirmada,0)} · pendiente ${w(E.pendiente,0)}">${q(E.fecha)} <small>${w(E.confirmada,0)}</small></span>`).join("");return`<tr class="${i.bloqueo?"blq":x==="Entrega parcial"?"bad":""}">
      <td class="mono">${l(i.pos)}${i.express?K:""}</td><td class="mono">${l(i.sku)}</td><td class="cc-desc" title="${l(i.descripcion)}">${l(i.descripcion)}</td>
      <td class="r mono">${w(i.cantidad,0)} <small>${l(i.um)}</small></td><td class="r mono">${w(i.entregado,0)}</td><td class="r mono">${w(i.pendiente,0)}</td>
      <td><div class="cc-reps">${W||"—"}</div></td>
      <td class="mono">${i.entregas.length?i.entregas.map(l).join(", ")+` <small>(${w(i.entTrat,0)})</small>`:"—"}</td>
      <td>${i.bloqueo?`<span class="cc-tag rd">${l(i.bloqueo)}</span>`:l(x)}</td>
      <td class="r mono sep">${h(i.fleteTraslado)}</td><td class="r mono">${h(i.fleteUltMilla)}</td>
      <td class="r mono sep">${h(i.fleteMin)}</td><td class="r mono">${i.fleteMax?h(i.fleteMax):"<small>sin tope</small>"}</td><td class="r mono">${h(i.fletePk)}</td>
      <td class="r mono sug"><b>${h(i.fleteSug)}</b> <small class="cc-regla">${j}</small></td></tr>`}).join(""),s=r.cobrado-r.sug,g=[...new Set(t.posiciones.flatMap(i=>i.entregas))],u=[...new Set(t.posiciones.flatMap(i=>i.repartos.map(x=>x.fecha)).filter(Boolean))].sort();f("#cc-modal-c").innerHTML=`
    <div class="cc-modal-h${t._express?" xp":""}"><span class="cc-ci lg" style="background:${c.color}">${d(c.icon)}</span>
      <div style="flex:1;min-width:0"><h3>Pedido ${l(t.id_pedido)} ${t._express?'<span class="cc-xp-badge">'+d("bolt")+"FLETE EXPRESS · SPOT</span>":""}<span class="cc-est-pill" style="background:${a.bg};color:${a.ink}">${d(a.icon)}${l(a.label)}</span></h3>
      <p><b>${l(c.label)}</b> · clase ${l(t.clase)} · sucursal ${l(n.centro.nombre)}</p>
      ${t._marcas.length?`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${t._marcas.map(i=>`<span class="cc-tag ${i.t}">${l(i.txt)}</span>`).join("")}</div>`:""}</div>
      ${z(t)?`<button class="cc-btn sm" data-act="ver-mapa" data-id="${l(t.id_pedido)}">${d("my_location")}Ver en mapa</button>`:""}
      <button class="cc-x" data-act="cerrar-modal" title="Cerrar (Esc)">${d("close")}</button></div>
    <div class="cc-modal-b">
      <div class="cc-steps">${et(t)}</div>
      <div class="cc-dgrid">
        <section class="cc-dbox"><h4>${d("person")}Cliente y destino</h4>
          <dl><dt>Cliente</dt><dd><b>${l(t.cliente)}</b> <span class="mono">(${l(t.solic)})</span></dd>
          <dt>Dirección</dt><dd>${l(t.direccion||"—")}</dd>
          <dt>Comuna</dt><dd>${l(t.comuna)} · ruta <span class="mono">${l(t.rutaCodigo||"—")}</span></dd>
          <dt>Obra</dt><dd><span class="mono">${l(t.id_obra)}</span> ${je(t.obra)}</dd>
          <dt>Contacto obra</dt><dd>${t.obra&&(t.obra.contacto_nombre||t.obra.contacto_telefono||t.obra.contacto_email)?[t.obra.contacto_nombre,t.obra.contacto_telefono,t.obra.contacto_email].filter(Boolean).map(l).join(" · "):'<span class="cc-tag gy">Sin contacto</span>'}</dd>
          <dt>Vendedor</dt><dd>${l(t.interlocutor||"—")}</dd></dl>
          <button class="cc-btn sm${t._sinGeo?" pri":""}" data-act="obra-edit" data-id="${l(t.id_pedido)}" style="margin-top:8px">${d(t._sinGeo?"edit_location_alt":"contact_page")}${t._sinGeo?"Georreferenciar obra y contacto":"Editar ubicación y contacto"}</button></section>
        <section class="cc-dbox"><h4>${d("event")}Fechas y entrega</h4>
          <dl><dt>Creación pedido</dt><dd><b>${q(t.creado)}</b>${t.creado?` <small>(hace ${-ue(t.creado)} d)</small>`:""}</dd>
          <dt>Próximo reparto</dt><dd class="${t._vencido?"cc-venc":""}"><b>${q(t.fecha)}</b>${t._vencido?` · vencido ${-t._dias} d`:""}</dd>
          <dt>Fechas de reparto</dt><dd>${u.map(q).join(" · ")||"—"}</dd>
          <dt>Entrega(s) SAP</dt><dd class="mono">${g.length?g.map(l).join(", "):'<span class="cc-tag gy">Sin entrega asociada</span>'}</dd>
          <dt>Avance</dt><dd>${t._nCub} de ${t._nLib} posiciones con entrega · ${w(t._ton,2)} t pendientes</dd></dl></section>
        <section class="cc-dbox cc-flete"><h4>${d("payments")}Flete</h4>
          <div class="cc-fl-row"><span>Flete traslado (ZFLT)</span><b class="mono">${h(r.traslado)}</b></div>
          <div class="cc-fl-row"><span>Flete última milla (ZFL0/ZFL1)</span><b class="mono">${h(r.ultMilla)}</b></div>
          <div class="cc-fl-row tot"><span>Flete cobrado</span><b class="mono">${h(r.cobrado)}</b></div>
          <div class="cc-fl-row sug"><span>${d("auto_awesome")}Flete sugerido sistema</span><b class="mono">${m?"—":h(r.sug)}</b></div>
          ${m?'<p class="cc-fl-nota">Sin datos de flete mínimo / máximo / $ por kilo en la carga SAP.</p>':`<div class="cc-fl-row dif ${s<0?"neg":"pos"}"><span>Cobrado − sugerido</span><b class="mono">${s<0?"−":"+"}${h(Math.abs(s))}</b></div>
          <p class="cc-fl-nota">Por posición: $/kg bajo el mínimo → mínimo; sobre el máximo → máximo; entre ambos → $/kg. Σ mín ${h(r.min)} · Σ máx ${h(r.max)} · Σ $/kg ${h(r.pk)}</p>`}
        </section>
      </div>
      <h4 class="cc-dtit">${d("inventory_2")}Detalle de productos <small>${p.length} posiciones</small></h4>
      <div class="cc-dtab"><table><thead>
        <tr class="grp"><th colspan="9"></th><th colspan="2" class="sep">Flete cobrado</th><th colspan="4" class="sep">Flete sugerido sistema</th></tr>
        <tr><th>Pos</th><th>Material</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Entregado</th><th class="r">Pendiente</th><th>Repartos (fecha · ctd)</th><th>Entrega</th><th>Estado</th>
        <th class="r sep">Traslado</th><th class="r">Últ. milla</th><th class="r sep">Mínimo</th><th class="r">Máximo</th><th class="r">$ por kilo</th><th class="r">Sugerido</th></tr></thead>
        <tbody>${b}</tbody>
        <tfoot><tr><td colspan="9"><b>Total pedido</b></td>
          <td class="r mono sep"><b>${h(r.traslado)}</b></td><td class="r mono"><b>${h(r.ultMilla)}</b></td>
          <td class="r mono sep"><b>${h(r.min)}</b></td><td class="r mono"><b>${h(r.max)}</b></td><td class="r mono"><b>${h(r.pk)}</b></td><td class="r mono sug"><b>${h(r.sug)}</b></td></tr></tfoot>
      </table></div>
    </div>`,f("#cc-modal").classList.add("show")}function et(e){if(e._estado==="bloq")return`<div class="cc-step on rd">${d("receipt_long")}<span>Pedido creado</span></div><i class="cc-step-l"></i><div class="cc-step on rd">${d("block")}<span>Bloqueado ${l(e.codigo_bloqueo)}</span></div>`;const t=e._estado==="sin"?1:e._estado==="parcial"?2:3;return[["receipt_long","Pedido creado"],["inventory",e._estado==="parcial"?`Entrega parcial (${be(e._avance)})`:"Entrega creada"],["task_alt","Todas las posiciones con entrega"]].map((a,o)=>`<div class="cc-step${o<t?" on":""}">${d(a[0])}<span>${l(a[1])}</span></div>`).join('<i class="cc-step-l"></i>')}function T(e,t,c){const a={ok:"check_circle",err:"error",warn:"warning",info:"info",xp:"bolt"}[e]||"info",o=document.createElement("div");o.className=`cc-toast ${e}`,o.innerHTML=`${d(a)}<div><b>${l(t)}</b>${c?`<p>${l(c)}</p>`:""}</div><button class="cc-x" title="Cerrar">${d("close")}</button>`;const r=()=>o.remove();o.querySelector(".cc-x").onclick=r;const p=document.getElementById("cc-toasts");if(p){for(p.appendChild(o);p.children.length>4;)p.firstChild.remove();setTimeout(r,e==="xp"?9e3:4800)}}function tt(){f("#cc-suc").addEventListener("change",a=>ce(a.target.value)),f("#cc-kpis").addEventListener("click",a=>{const o=a.target.closest(".cc-kpi");o&&(o.dataset.venc?n.soloVencidos=!n.soloVencidos:o.dataset.xp?n.soloExpress=!n.soloExpress:o.dataset.ng?n.soloSinGeo=!n.soloSinGeo:n.fEstado=n.fEstado===o.dataset.est?"todos":o.dataset.est,n.sel=null,F(!0))}),f("#cc-cond").addEventListener("click",a=>{const o=a.target.closest("[data-cond]");if(!o)return;const r=o.dataset.cond;a.altKey||a.ctrlKey||a.metaKey?n.cond=new Set([r]):n.cond.has(r)?n.cond.size>1&&n.cond.delete(r):n.cond.add(r),F(!0)}),f("#cc-btn-todas").onclick=()=>{n.cond=new Set(G.map(a=>a.key)),n.fEstado="todos",n.soloVencidos=!1,n.soloExpress=!1,n.soloSinGeo=!1,n.q="",f("#cc-q").value="",F(!0)},f("#cc-btn-geo").onclick=()=>Ze(!n.editGeo),f("#cc-btn-encuadrar").onclick=()=>X(),f("#cc-btn-panel").onclick=()=>{const a=_.classList.toggle("sin-panel");f("#cc-btn-panel").innerHTML=d(a?"right_panel_open":"right_panel_close"),setTimeout(()=>v.invalidateSize(),220)},f("#cc-btn-full").onclick=()=>{const a=_.classList.toggle("map-full");f("#cc-btn-full").innerHTML=d(a?"fullscreen_exit":"fullscreen"),setTimeout(()=>{v.invalidateSize(),X()},120)},f("#cc-btn-reload").onclick=()=>at();const e=f("#cc-pane");e.addEventListener("click",a=>{const o=a.target.closest(".cc-li[data-id]");o&&(I(o.dataset.id,{sinScroll:!0}),J(o.dataset.id))}),e.addEventListener("mouseover",a=>{const o=a.target.closest(".cc-li[data-id]");o&&Z(o.dataset.id,!0)}),e.addEventListener("mouseout",a=>{const o=a.target.closest(".cc-li[data-id]");o&&Z(o.dataset.id,!1)});const t=f("#cc-tbody");t.addEventListener("click",a=>{const o=a.target.closest("tr[data-id]");if(!o)return;const r=o.dataset.id;if(a.target.closest("[data-act]")?.dataset.act==="ver"){I(r);return}I(r,{sinScroll:!0}),J(r)}),t.addEventListener("mouseover",a=>{const o=a.target.closest("tr[data-id]");o&&Z(o.dataset.id,!0)}),t.addEventListener("mouseout",a=>{const o=a.target.closest("tr[data-id]");o&&Z(o.dataset.id,!1)}),_.querySelector(".cc-t thead").addEventListener("click",a=>{const o=a.target.closest("th.sort");if(!o)return;const r=o.dataset.col;n.orden={col:r,dir:n.orden.col===r?-n.orden.dir:r==="ton"||r==="avance"||r==="flete"?-1:1},ne()});let c;f("#cc-q").addEventListener("input",a=>{clearTimeout(c),c=setTimeout(()=>{n.q=a.target.value,F()},160)}),f("#cc-modal").addEventListener("click",a=>{if(a.target.id==="cc-modal"||a.target.closest('[data-act="cerrar-modal"]')){f("#cc-modal").classList.remove("show");return}const o=a.target.closest('[data-act="obra-edit"]');if(o){const p=n.byId.get(o.dataset.id);Xe(p).then(m=>{m&&J(p.id_pedido)});return}const r=a.target.closest('[data-act="ver-mapa"]');r&&(f("#cc-modal").classList.remove("show"),I(r.dataset.id))})}function ie(e){if(!_||!document.body.contains(_)){document.removeEventListener("keydown",ie);return}if(e.key==="Escape"){if(f("#cc-modal").classList.contains("show")){f("#cc-modal").classList.remove("show");return}_.classList.contains("map-full")&&f("#cc-btn-full").click()}}function ct(){return`<div class="cc">
  <header class="cc-top">
    <div class="cc-brand">
      <div class="cc-brand-ic">${d("cell_tower")}</div>
      <div><div class="cc-brand-t">Monitor de Pedidos</div><div class="cc-brand-s" id="cc-centro-lbl"></div></div>
    </div>
    <div class="cc-grp"><span class="cc-lbl">Sucursal (of. ventas)</span><select class="cc-select" id="cc-suc"></select></div>
    <label class="cc-search">${d("search")}<input id="cc-q" placeholder="Pedido, cliente, obra, comuna, entrega…"></label>
    <div class="cc-chips">
      <button class="cc-chip" id="cc-btn-todas" title="Quitar todos los filtros">${d("filter_alt_off")}Limpiar filtros</button>
      <button class="cc-chip is-tool" id="cc-btn-geo" title="Ubicar obras arrastrando su pin">${d("edit_location_alt")}Georreferenciar <span class="cc-cnt" id="cc-geo-cnt">0</span></button>
      <button class="cc-chip" id="cc-btn-reload" title="Volver a leer los datos SAP">${d("refresh")}Actualizar</button>
    </div>
    <div class="cc-kpis" id="cc-kpis"></div>
    <div class="cc-grp cc-grp-full"><span class="cc-lbl">Condición de expedición <span style="text-transform:none;font-weight:500;letter-spacing:0">· Ctrl+clic para ver sólo una</span></span><div class="cc-chips" id="cc-cond"></div></div>
  </header>
  <section class="cc-main">
    <div class="cc-card">
      <div class="cc-mapwrap">
        <div id="cc-map"></div>
        <div class="cc-maphint" id="cc-maphint"></div>
        <div class="cc-mapbtns">
          <button class="cc-mapbtn" id="cc-btn-encuadrar" title="Encuadrar todos los pedidos">${d("fit_screen")}</button>
          <button class="cc-mapbtn" id="cc-btn-panel" title="Ocultar / mostrar panel lateral">${d("right_panel_close")}</button>
          <button class="cc-mapbtn" id="cc-btn-full" title="Mapa a pantalla completa">${d("fullscreen")}</button>
        </div>
        <div class="cc-legend" id="cc-legend"></div>
      </div>
    </div>
    <aside class="cc-card cc-side"><div class="cc-pane" id="cc-pane"></div></aside>
  </section>
  <section class="cc-card cc-tablecard">
    <div class="cc-tbar"><span class="cc-tbar-t">Pedidos</span><span class="cc-tbar-s" id="cc-tbar-s"></span></div>
    <div class="cc-tscroll"><table class="cc-t"><thead><tr>
      <th class="sort" data-col="estado">Estado</th><th class="sort" data-col="id">Pedido</th><th class="sort" data-col="cond">Condición</th>
      <th class="sort" data-col="cliente">Cliente</th><th>Obra</th><th class="sort" data-col="comuna">Comuna</th>
      <th class="sort" data-col="creado">Creado</th><th class="sort" data-col="fecha">F. reparto</th><th class="sort r" data-col="flete">Flete sug.</th><th class="sort" data-col="avance">Avance entrega</th><th>Entrega(s)</th>
      <th class="sort r" data-col="ton">Ton</th><th>Observaciones</th><th></th>
    </tr></thead><tbody id="cc-tbody"></tbody></table></div>
  </section>
  <div class="cc-modal" id="cc-modal"><div class="cc-modal-c" id="cc-modal-c"></div></div>
</div>`}async function at(){const e=f("#cc-btn-reload");e&&(e.disabled=!0);try{await he();const t=n.sel;ce(n.sucursal),t&&n.byId.has(t)&&I(t),Ee(),T("ok","Datos actualizados",`${n.pedidos.length} pedidos en ${n.centro.nombre}.`)}catch(t){T("err","No se pudo actualizar",t.message||String(t))}e&&(e.disabled=!1)}function Ee(){const e=document.getElementById("sv-upd");if(!e||!n.raw.cargado)return;const t=new Date(n.raw.cargado);e.innerHTML=`${d("schedule")}Datos SAP ${t.toLocaleDateString("es-CL")} ${t.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})}`,e.classList.remove("hidden")}async function ot(e){if(nt(),!document.getElementById("cc-toasts")){const a=document.createElement("div");a.id="cc-toasts",a.className="cc-toasts",document.body.appendChild(a)}if(v){try{v.remove()}catch{}v=null,R=null}n.editGeo=!1,n.sel=null,await Promise.all([Ce(),he()]),e.innerHTML=ct(),_=e.querySelector(".cc"),tt(),document.removeEventListener("keydown",ie),document.addEventListener("keydown",ie);const t=[...new Set(n.raw.suc.map(a=>y(a.ofvta)).filter(Boolean))].sort();if(!t.length){_.querySelector(".cc-main").innerHTML='<div class="cc-card"><div class="cc-empty" style="margin:24px">No hay pedidos de despacho/retiro en su alcance.</div></div>';return}let c="";try{c=localStorage.getItem(pe)||""}catch{}ce(t.includes(c)?c:t[0]),Ee()}const ft=ot;function nt(){document.getElementById("cc-style")?.remove();const e=document.createElement("style");e.id="cc-style",e.textContent=`
.cc{--cc-primary:#b5000b;--cc-sel:#ffdad5;--cc-sel2:#fff5f3;--cc-ink:#191c1d;--cc-ink2:#5c5f61;--cc-ink3:#444749;--cc-s1:#f3f4f5;--cc-s2:#edeeef;--cc-s3:#e7e8e9;--cc-line:#e1e3e4;--cc-line2:#edeeef;--cc-mono:'JetBrains Mono',ui-monospace,Consolas,monospace;--cc-gray:#9ca3af;
display:flex;flex-direction:column;gap:10px;color:var(--cc-ink);font-size:14px}
.cc *,.cc-toasts *{box-sizing:border-box}
.cc .material-symbols-outlined,.cc-toasts .material-symbols-outlined,.cc-pin .material-symbols-outlined,.cc-tt .material-symbols-outlined{font-size:18px;line-height:1;vertical-align:middle;display:inline-block;width:1em;overflow:hidden;white-space:nowrap;flex-shrink:0}
.cc .mono,.cc-tt .mono{font-family:var(--cc-mono,monospace);font-size:12px}.cc .num{font-variant-numeric:tabular-nums}
.cc-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;background:#fff;border:1px solid var(--cc-line);border-radius:8px;padding:8px 12px}
.cc-brand{display:flex;align-items:center;gap:10px;margin-right:auto;min-width:220px}
.cc-brand-ic{width:36px;height:36px;border-radius:8px;background:var(--cc-sel);color:var(--cc-primary);display:flex;align-items:center;justify-content:center}
.cc-brand-ic .material-symbols-outlined{font-size:22px}
.cc-brand-t{font-size:16px;font-weight:700;line-height:20px}.cc-brand-s{font-size:12px;color:var(--cc-ink2)}
.cc-grp{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}.cc-grp-full{flex-basis:100%}
.cc-lbl{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2)}
.cc-chips{display:flex;gap:6px;flex-wrap:wrap}
.cc-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cc-line);background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--cc-ink3);white-space:nowrap}
.cc-chip:hover{border-color:var(--cc-ink2)}.cc-chip:disabled{opacity:.5}
.cc-chip.is-tool.is-on{background:var(--cc-primary);border-color:var(--cc-primary);color:#fff}
.cc-chip .cc-cnt{font-family:var(--cc-mono);font-size:10.5px;background:#fef3c7;color:#92400e;border-radius:999px;padding:0 6px}
.cc-select{border:1px solid var(--cc-line);border-radius:6px;padding:5px 8px;font-size:13px;background:#fff}
.cc-search{display:flex;align-items:center;gap:6px;border:1px solid var(--cc-line);border-radius:6px;padding:5px 9px;background:#fff;align-self:flex-end}
.cc-search input{border:none;outline:none;width:240px;font-size:13px;background:none}
/* KPIs */
.cc-kpis{flex-basis:100%;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
.cc-kpi{display:flex;align-items:center;gap:8px;border:1px solid var(--cc-line);background:#fff;border-radius:8px;padding:5px 9px;cursor:pointer;text-align:left;transition:border-color .15s,box-shadow .15s;position:relative;overflow:hidden}
.cc-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--kc)}
.cc-kpi:hover{border-color:var(--kc)}
.cc-kpi.is-on{border-color:var(--kc);box-shadow:0 0 0 2px var(--kc) inset;background:color-mix(in srgb,var(--kc) 6%,#fff)}
.cc-kpi-ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--kc) 14%,#fff);color:var(--kc)}
.cc-kpi-ic .material-symbols-outlined{font-size:20px}
.cc-kpi-b{display:flex;flex-direction:column;min-width:0}
.cc-kpi-l{font-size:11px;font-weight:600;color:var(--cc-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-kpi b{font-size:17px;line-height:20px}
.cc-kpi-s{display:none}
/* Condición */
.cc-ci{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}
.cc-ci .material-symbols-outlined{font-size:15px}
.cc-ci.sm{width:18px;height:18px;border-radius:5px;margin-right:6px}.cc-ci.sm .material-symbols-outlined{font-size:12px}
.cc-ci.xs{width:16px;height:16px;border-radius:4px;margin-right:5px}.cc-ci.xs .material-symbols-outlined{font-size:11px}
.cc-ci.lg{width:40px;height:40px;border-radius:10px}.cc-ci.lg .material-symbols-outlined{font-size:24px}
.cc-cchip{display:inline-flex;align-items:center;gap:7px;border:1.5px solid var(--cc-line);background:#fff;border-radius:999px;padding:3px 11px 3px 4px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--cc-ink2);opacity:.55;transition:all .15s}
.cc-cchip:hover{opacity:.85}
.cc-cchip.is-on{opacity:1;border-color:var(--cc);background:var(--cb);color:var(--ci)}
.cc-cchip .cc-cnt{font-family:var(--cc-mono);font-size:11px;background:#fff;border-radius:999px;padding:0 7px;color:var(--cc-ink)}
.cc-cond{display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;padding:2px 8px 2px 3px;border-radius:999px;white-space:nowrap}
.cc-est-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.cc-est-pill .material-symbols-outlined{font-size:14px}
/* Layout */
.cc-main{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px;height:max(620px,calc(100vh - 290px))}
.cc-card{background:#fff;border:1px solid var(--cc-line);border-radius:8px;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--cc-line);background:#fff;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--cc-ink)}
.cc-btn:disabled{opacity:.45;cursor:not-allowed}.cc-btn.pri{background:var(--cc-primary);border-color:var(--cc-primary);color:#fff}.cc-btn.sm{padding:4px 9px;font-size:12px}
.cc-mapwrap{position:relative;flex:1;min-height:0}
#cc-map{position:absolute;inset:0;background:#e8eaeb}
.cc-maphint{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:500;background:var(--cc-ink);color:#fff;font-size:12px;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;align-items:center;gap:6px;pointer-events:none}
.cc-maphint.show{display:flex}
.cc-legend{position:absolute;left:10px;bottom:10px;z-index:500;background:rgba(255,255,255,.92);border:1px solid var(--cc-line);border-radius:8px;padding:6px 9px;font-size:10.5px;display:flex;flex-direction:column;gap:4px;color:var(--cc-ink3);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.cc-legend div{display:flex;align-items:center;gap:7px}
.cc-legend i{width:10px;height:10px;border-radius:50%;display:inline-block;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15);margin:0 4px 0 4px}
.cc-legend i.dash{background:#fff;border:1.5px dashed var(--cc-ink2);box-shadow:none}
.cc-legend-sep{height:1px;background:var(--cc-line);margin:2px 0}
/* Pines */
.cc-pin-wrap{background:none;border:none}
.cc-pin{position:relative;width:30px;height:30px;border-radius:50% 50% 50% 6px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.38);color:#fff;background:var(--pc);cursor:pointer;transition:transform .12s}
.cc-pin>.material-symbols-outlined{transform:rotate(45deg);font-size:16px}
.cc-pin-st{position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;transform:rotate(45deg)}
.cc-pin.aprox{border-style:dashed}
.cc-pin.venc{box-shadow:0 0 0 3px rgba(220,38,38,.45),0 1px 5px rgba(0,0,0,.38)}
.cc-pin.sel{transform:rotate(-45deg) scale(1.28);box-shadow:0 0 0 3px var(--cc-ink,#191c1d),0 3px 10px rgba(0,0,0,.45)}
.cc-pin.hl{transform:rotate(-45deg) scale(1.3)}
.cc-pin.drag{animation:ccBob 1.4s ease-in-out infinite;cursor:grab}
.cc-pin.edit{background:#fff;color:#5c5f61;border:2px dashed #5c5f61;animation:ccBob 1.4s ease-in-out infinite}
@keyframes ccBob{50%{margin-top:-4px}}
.cc-hub{width:36px;height:36px;border-radius:9px;background:#b5000b;color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.cc-hub .material-symbols-outlined{font-size:22px;font-family:'Material Symbols Outlined'}
.leaflet-tooltip.cc-tt{font-size:12px;padding:8px 10px;border-radius:8px;border:1px solid #e1e3e4;box-shadow:0 4px 14px rgba(0,0,0,.14);color:#191c1d;max-width:340px;white-space:normal}
.cc-tt-h{font-weight:700;display:flex;gap:7px;align-items:center;margin-bottom:4px}.cc-tt-r{color:#5c5f61;line-height:1.45}
.cc-tt-f{margin-top:5px;font-size:11px;color:#5c5f61;border-top:1px solid #edeeef;padding-top:4px}
.cc-tt .cc-ci{width:20px;height:20px}.cc-tt .cc-ci .material-symbols-outlined{font-size:13px}
.cc-tt .cc-est-pill{font-size:10.5px}
.cc-geo-pop{display:flex;flex-direction:column;gap:6px;min-width:220px;font-size:13px}.cc-geo-pop .mono{font-family:'JetBrains Mono',monospace;font-size:12px;color:#5c5f61}
.cc-geo-pop .cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer;background:#b5000b;border:1px solid #b5000b;color:#fff}
.cc-geo-pop .cc-btn:disabled{opacity:.45}
/* Panel */
.cc-pane{flex:1;overflow:auto;padding:6px 12px 14px}
.cc-sec-t{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cc-ink2);margin:10px 2px 6px;display:flex;justify-content:space-between;align-items:center}
.cc-empty{color:var(--cc-ink2);font-size:13px;text-align:center;padding:22px 10px;border:1px dashed var(--cc-line);border-radius:8px}
.cc-empty .material-symbols-outlined{font-size:28px;display:block;margin:0 auto 6px;color:var(--cc-gray)}
.cc-li{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:9px;padding:8px 6px;border-radius:8px;border:1px solid transparent;cursor:pointer}
.cc-li:hover,.cc-li.is-hl{background:var(--cc-s1);border-color:var(--cc-line2)}
.cc-li.is-sel{background:var(--cc-sel2);border-color:var(--cc-sel)}
.cc-li-id{font-family:var(--cc-mono);font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:6px}
.cc-li-sub{font-size:11.5px;color:var(--cc-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-li-f{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--cc-ink2);margin-top:2px}
.cc-li-f>span:first-child{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.cc-li-f .material-symbols-outlined{font-size:13px}
.cc-li-f .cc-mini{flex:1;max-width:80px}
.cc-x{border:none;background:none;color:#5c5f61;cursor:pointer;padding:3px;border-radius:4px;display:flex}
.cc-x:hover{background:#e7e8e9;color:#b5000b}
.cc-mini{height:6px;background:var(--cc-s2);border-radius:3px;overflow:hidden;position:relative;display:inline-block}
.cc-mini i{position:absolute;inset:0 auto 0 0;border-radius:3px}
.cc-tag{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.02em;padding:1px 6px;border-radius:4px;white-space:nowrap;text-transform:uppercase}
.cc-tag.am{background:#fef3c7;color:#92400e}.cc-tag.gr{background:#dcfce7;color:#166534}.cc-tag.rd{background:#fee2e2;color:#991b1b}.cc-tag.gy{background:#edeeef;color:#444749}
.cc-venc{color:#b91c1c!important;font-weight:700}
/* Tabla */
.cc-tablecard{height:min(46vh,480px)}
.cc-tbar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--cc-line)}
.cc-tbar-t{font-weight:700;font-size:14px}.cc-tbar-s{font-size:12px;color:var(--cc-ink2)}
.cc-tscroll{flex:1;overflow:auto}
table.cc-t{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.cc-t th{position:sticky;top:0;z-index:2;background:var(--cc-s1);text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cc-ink2);padding:8px 10px;border-bottom:1px solid var(--cc-line);white-space:nowrap;user-select:none}
.cc-t th.sort{cursor:pointer}.cc-t th.sort:hover{color:var(--cc-primary)}.cc-t th .material-symbols-outlined{font-size:14px}
.cc-t td{padding:6px 10px;border-bottom:1px solid var(--cc-line2);white-space:nowrap;vertical-align:middle}
.cc-t td.r,.cc-t th.r{text-align:right}
.cc-t td.cc-td-cli{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.cc-t tbody tr{cursor:pointer}.cc-t tbody tr:hover,.cc-t tbody tr.is-hl{background:var(--cc-s1)}
.cc-t tbody tr.is-sel{background:var(--cc-sel2)}.cc-t tbody tr.is-sel td:first-child{box-shadow:inset 3px 0 0 var(--cc-primary)}
.cc-av{display:inline-flex;align-items:center;gap:7px}.cc-av .cc-mini{width:60px}
.cc-acts{display:flex;gap:2px}
.cc-ib{border:none;background:none;color:var(--cc-ink2);cursor:pointer;padding:4px;border-radius:4px;display:inline-flex}
.cc-ib:hover:not(:disabled){background:var(--cc-s3);color:var(--cc-primary)}.cc-ib:disabled{opacity:.35;cursor:default}
/* Toasts */
.cc-toasts{position:fixed;right:18px;bottom:18px;z-index:2000;display:flex;flex-direction:column;gap:8px;max-width:380px}
.cc-toast{background:#fff;border:1px solid #e1e3e4;border-left:4px solid #2563eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 12px;display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:start;font-size:13px;color:#191c1d}
.cc-toast>.material-symbols-outlined{font-size:20px;font-variation-settings:'FILL' 1}
.cc-toast b{display:block;font-size:13px}.cc-toast p{margin:2px 0 0;font-size:12px;color:#5c5f61;line-height:1.4}
.cc-toast.ok{border-left-color:#16a34a}.cc-toast.ok>.material-symbols-outlined{color:#16a34a}
.cc-toast.err{border-left-color:#dc2626}.cc-toast.err>.material-symbols-outlined{color:#dc2626}
.cc-toast.warn{border-left-color:#f59e0b}.cc-toast.warn>.material-symbols-outlined{color:#f59e0b}
/* Modal */
.cc-modal{position:fixed;inset:0;z-index:2100;background:rgba(25,28,29,.38);display:none;align-items:center;justify-content:center;padding:16px}
.cc-modal.show{display:flex}
.cc-modal-c{background:#fff;border-radius:10px;width:min(1020px,100%);max-height:86vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.3)}
.cc-modal-h{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--cc-line)}
.cc-modal-h h3{margin:0;font-size:16px;font-family:var(--cc-mono);display:flex;align-items:center;gap:8px}.cc-modal-h p{margin:3px 0 0;color:var(--cc-ink2);font-size:12.5px}
.cc-modal-b{padding:14px 18px 18px}
.cc-steps{display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.cc-step{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--cc-s1);color:var(--cc-gray);font-size:12px;font-weight:600}
.cc-step.on{background:#dcfce7;color:#166534}.cc-step.on.rd{background:#fee2e2;color:#991b1b}
.cc-step-l{flex:0 0 24px;height:2px;background:var(--cc-line)}
.cc-kv{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.cc-kv div{background:var(--cc-s1);border-radius:6px;padding:7px 9px}
.cc-kv span{display:block;font-size:10.5px;color:var(--cc-ink2);text-transform:uppercase;letter-spacing:.04em;font-weight:700}.cc-kv b{font-size:13px}
.cc-modal table{width:100%;border-collapse:collapse;font-size:12.5px}
.cc-modal th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--cc-ink2);padding:6px 8px;border-bottom:1px solid var(--cc-line);background:var(--cc-s1);white-space:nowrap}
.cc-modal td{padding:6px 8px;border-bottom:1px solid var(--cc-line2)}
.cc-modal tr.bad td{background:#fef3c7}.cc-modal tr.blq td{background:#fff5f5;color:#7f1d1d;text-decoration:line-through}
.cc-modal tr.blq td:last-child,.cc-modal .cc-dtab tr.blq td:nth-child(n+9){text-decoration:none}
.cc-modal .r{text-align:right}
/* Express (spot) */
.cc-rayo{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#facc15;color:#713f12;margin:0 3px;vertical-align:middle;box-shadow:0 0 0 2px #fef9c3;animation:ccXp 1.6s ease-in-out infinite}
.cc-rayo .material-symbols-outlined{font-size:14px!important;font-variation-settings:'FILL' 1}
@keyframes ccXp{50%{box-shadow:0 0 0 5px rgba(250,204,21,.35)}}
.cc-pin-xp{position:absolute;bottom:-7px;left:-7px;width:17px;height:17px;border-radius:50%;background:#facc15;color:#713f12;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:rotate(45deg)}
.cc-pin-xp .material-symbols-outlined{font-size:12px!important;font-variation-settings:'FILL' 1}
.cc-pin.xp{animation:ccPinXp 1.4s ease-in-out infinite}
@keyframes ccPinXp{50%{box-shadow:0 0 0 6px rgba(250,204,21,.55),0 1px 5px rgba(0,0,0,.38)}}
.cc-kpi.xp.alerta{background:#fefce8;border-color:#facc15}.cc-kpi.xp.alerta .cc-kpi-ic{animation:ccXp 1.6s ease-in-out infinite}
.cc-kpi.xp .material-symbols-outlined{font-variation-settings:'FILL' 1}
.cc-li.xp{border-left:3px solid #facc15;background:#fffdf0}
.cc-t tbody tr.xp td:first-child{box-shadow:inset 3px 0 0 #facc15}
.cc-t tbody tr.xp{background:#fffdf0}
.cc-tag.xp{background:#facc15;color:#713f12}
.cc-toast.xp{border-left-color:#facc15;background:#fffdf0}.cc-toast.xp>.material-symbols-outlined{color:#ca8a04}
.cc-xp-badge{display:inline-flex;align-items:center;gap:3px;background:#facc15;color:#713f12;font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:800;padding:2px 9px 2px 5px;border-radius:999px;letter-spacing:.03em}
.cc-xp-badge .material-symbols-outlined{font-size:15px;font-variation-settings:'FILL' 1}
.cc-modal-h.xp{background:linear-gradient(90deg,#fefce8,#fff 60%)}
/* Vista detalle */
.cc-modal-c{width:min(1320px,100%);max-height:92vh}
.cc-dgrid{display:grid;grid-template-columns:1.1fr 1.1fr 1fr;gap:10px;margin-bottom:14px}
.cc-dbox{border:1px solid var(--cc-line);border-radius:8px;padding:10px 12px}
.cc-dbox h4,.cc-dtit{margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--cc-ink2);display:flex;align-items:center;gap:6px}
.cc-dtit small{text-transform:none;font-weight:500;letter-spacing:0}
.cc-dbox dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:12.5px}
.cc-dbox dt{color:var(--cc-ink2)}.cc-dbox dd{margin:0}
.cc-flete{background:#fafafa}
.cc-fl-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:3px 0}
.cc-fl-row.tot{border-top:1px solid var(--cc-line);margin-top:2px;padding-top:6px;font-weight:600}
.cc-fl-row.sug{background:#eef2ff;border-radius:6px;padding:6px 8px;margin-top:6px;color:#3730a3;font-weight:700}
.cc-fl-row.sug span{display:flex;align-items:center;gap:5px}
.cc-fl-row.dif.neg b{color:#b91c1c}.cc-fl-row.dif.pos b{color:#15803d}
.cc-fl-nota{font-size:11px;color:var(--cc-ink2);margin:6px 0 0;line-height:1.4}
.cc-dtab{overflow:auto;border:1px solid var(--cc-line);border-radius:8px}
.cc-modal .cc-dtab table{font-size:12px}
.cc-modal .cc-dtab th.sep,.cc-modal .cc-dtab td.sep{border-left:2px solid var(--cc-line)}
.cc-modal .cc-dtab tr.grp th{background:#fff;font-size:10px;text-align:center;border-bottom:none}
.cc-modal .cc-dtab td.sug{background:#eef2ff}
.cc-modal .cc-dtab tfoot td{background:var(--cc-s1);border-top:2px solid var(--cc-line);padding:7px 8px}
.cc-modal .cc-dtab td small{color:var(--cc-ink2)}
.cc-desc{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-regla{font-size:9.5px;font-weight:700;color:#4338ca;background:#e0e7ff;border-radius:3px;padding:0 4px}
.cc-reps{display:flex;flex-wrap:wrap;gap:3px}
.cc-rep{font-family:var(--cc-mono);font-size:11px;background:var(--cc-s1);border-radius:4px;padding:1px 5px;white-space:nowrap}
.cc-rep.venc{background:#fee2e2;color:#991b1b}
@media (max-width:1100px){.cc-dgrid{grid-template-columns:1fr}}
/* Mapa protagonista (18-nov-2026) */
.cc-mapbtns{position:absolute;top:10px;right:10px;z-index:600;display:flex;flex-direction:column;gap:6px}
.cc-mapbtn{width:34px;height:34px;border-radius:8px;border:1px solid var(--cc-line);background:#fff;color:var(--cc-ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.cc-mapbtn:hover{color:var(--cc-primary);border-color:var(--cc-primary)}
.cc-mapbtn .material-symbols-outlined{font-size:20px}
.cc.sin-panel .cc-main{grid-template-columns:minmax(0,1fr) 0}
.cc.sin-panel .cc-side{display:none}
.cc.map-full .cc-main{position:fixed;inset:0;z-index:1900;height:100vh;grid-template-columns:minmax(0,1fr) 330px;background:#fff;padding:8px;gap:8px}
.cc.map-full.sin-panel .cc-main{grid-template-columns:minmax(0,1fr) 0}
/* Georreferencia de obra (maestro_obras) */
.cc-pin.nogeo{border-color:#fff;border-style:dashed;opacity:.9}
.cc-pin-ng{position:absolute;top:-7px;left:-7px;width:16px;height:16px;border-radius:50%;background:#7c2d12;color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:rotate(45deg)}
.cc-pin-ng .material-symbols-outlined{font-size:11px!important;font-weight:700}
.cc-ng{display:inline-flex;color:#b91c1c;margin-left:2px}.cc-ng .material-symbols-outlined{font-size:15px!important}
.cc-btn.pri{background:#b5000b;border-color:#b5000b;color:#fff}
@media (max-width:1280px){.cc-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1100px){.cc{height:auto}.cc-main{grid-template-columns:1fr;height:auto}.cc-mapwrap{height:58vh;flex:none}.cc-side{max-height:560px}.cc-tablecard{height:auto;max-height:70vh}}
@media (max-width:640px){.cc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-kv{grid-template-columns:repeat(2,1fr)}.cc-search input{width:140px}.cc-brand{min-width:0;width:100%}}
`,document.head.appendChild(e)}export{ft as renderMonitorConsolidacion,ot as renderMonitorPedidos};
