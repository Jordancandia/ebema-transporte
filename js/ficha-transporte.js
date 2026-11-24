import{getDatabase as $,saveDatabase as C,getOrigenGroups as O,calcEjes as I,deleteRow as L,deleteRows as N}from"./data.js?v=6ce8cb5f60";import{formatRut as q,showAlert as g,escapeHtml as v}from"./utils.js";import{confirmar as V}from"./confirmar.js?v=84d7f13f40";const P=["Arica y Parinacota","Tarapacá","Antofagasta","Atacama","Coquimbo","Valparaíso","Metropolitana","Libertador General Bernardo O'Higgins","Maule","Ñuble","Biobío","La Araucanía","Los Ríos","Los Lagos","Aysén del General Carlos Ibáñez del Campo","Magallanes y Antártica Chilena"],_=["Banco de Chile","Banco Internacional","Banco Estado","Banco BICE","Banco Santander Chile","Itaú Corpbanca","Banco Security","Banco Falabella","Banco Ripley","Banco Consorcio","Scotiabank Chile","Banco BTG Pactual Chile","HSBC Bank Chile","Banco de Crédito e Inversiones (BCI)","China Construction Bank Chile","Coopeuch","Tenpo Prepago"],G=["Cuenta Corriente","Cuenta Vista","Chequera Electrónica","Cuenta RUT"],j=[{key:"permisoCirculacion",label:"Permiso de Circulación",icon:"description",conValor:!0},{key:"seguroCarga",label:"Seguro de Carga",icon:"security",conValor:!0},{key:"soap",label:"SOAP",icon:"health_and_safety",conValor:!0},{key:"padron",label:"Padrón del Vehículo",icon:"badge",conValor:!1},{key:"certificadoEmision",label:"Certificado de Emisión de Gases",icon:"air",conValor:!1}];function k(e){if(!e)return!1;const t=new Date;return t.setHours(0,0,0,0),new Date(e)<t}function H(e){if(!e||!e.hasta)return{bg:"#fef9c3",text:"#92400e",label:"Sin Fecha",icon:"warning"};if(k(e.hasta))return{bg:"#fee2e2",text:"#991b1b",label:"Vencido",icon:"error"};const t=Math.ceil((new Date(e.hasta)-new Date)/864e5);return t<=30?{bg:"#fef3c7",text:"#92400e",label:`${t}d`,icon:"schedule"}:{bg:"#dcfce7",text:"#166534",label:"Vigente",icon:"check_circle"}}function F(e){const t=[],d=e.camiones||[],o=e.choferes||[];return d.length===0&&t.push("Sin camiones registrados"),o.length===0&&t.push("Sin choferes registrados"),(!e.centrosServicio||e.centrosServicio.length===0)&&t.push("Sin centro de servicio asignado"),d.forEach(n=>{const y=n.documentos||{};j.forEach(r=>{const p=y[r.key]||{};p.hasta?k(p.hasta)&&t.push(`${n.patente}: ${r.label} VENCIDO`):t.push(`${n.patente}: ${r.label} sin vigencia`),r.conValor&&!(Number(p.valor)>0)&&t.push(`${n.patente}: ${r.label} sin valor declarado`)}),n.choferRut||t.push(`${n.patente}: sin chofer asignado`)}),t.length===0?{status:"ok",color:"#16a34a",bg:"#dcfce7",border:"#86efac"}:{status:"alert",color:"#d97706",bg:"#fef3c7",border:"#fbbf24",alerts:t}}function U(e,t){const d=$(),o=d.transports.find(a=>a.id===t);if(!o){e.innerHTML='<div class="p-xl text-center text-secondary">Transporte no encontrado.</div>';return}o.camiones||(o.camiones=[]),o.choferes||(o.choferes=[]),o.centrosServicio||(o.centrosServicio=[]),o.datosBancarios||(o.datosBancarios={banco:"",tipoCuenta:"",numeroCuenta:"",rut:o.rut}),o.datosBancarios.rut=o.rut;const n=F(o),y=O(d);e.innerHTML=`
    <!-- ===== HEADER ===== -->
    <div style="margin-bottom:28px">
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#5c5f61;margin-bottom:16px">
        <button id="btn-back-transports" style="background:none;border:none;cursor:pointer;color:#b5000b;font-weight:700;font-size:13px;padding:0;display:flex;align-items:center;gap:4px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
          <span class="material-symbols-outlined" style="font-size:15px">arrow_back</span>
          Volver
        </button>
        <span class="material-symbols-outlined" style="font-size:14px;color:#c5c7c9">chevron_right</span>
        <span style="color:#191c1d;font-weight:600">${v(o.razonSocial)}</span>
      </div>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <h1 style="font-size:28px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:4px">Ficha del Transportista</h1>
          <p style="font-size:14px;color:#5c5f61">${o.camiones.length} camión(es) · ${o.choferes.length} chofer(es) registrados</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px;background:${n.bg};border:1.5px solid ${n.border};border-radius:12px;padding:12px 20px">
          <div style="width:14px;height:14px;border-radius:50%;background:${n.color};flex-shrink:0"></div>
          <div>
            <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${n.color};line-height:1">Estado del Expediente</p>
            <p style="font-size:18px;font-weight:800;color:${n.color};line-height:1.2;margin-top:2px">${n.status==="ok"?"✓ Aprobado / Completo":"⚠ Alerta Documental"}</p>
            ${n.alerts?`<p style="font-size:11px;color:${n.color};margin-top:4px;opacity:0.8">${n.alerts.length} observación(es)</p>`:""}
          </div>
        </div>
      </div>

      ${n.alerts?`
      <div style="margin-top:16px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#92400e;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span class="material-symbols-outlined" style="font-size:14px">warning</span>
          Observaciones que requieren atención
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${n.alerts.slice(0,12).map(a=>`<span style="padding:3px 10px;background:#fef3c7;border:1px solid #fbbf24;border-radius:20px;font-size:11px;color:#78350f;font-weight:600">${v(a)}</span>`).join("")}
          ${n.alerts.length>12?`<span style="padding:3px 10px;font-size:11px;color:#78350f">+${n.alerts.length-12} más...</span>`:""}
        </div>
      </div>`:""}
    </div>

    <div style="display:flex;flex-direction:column;gap:20px;margin-bottom:48px">

      <!-- ===== 1. DATOS DEL PROVEEDOR + CENTROS DE SERVICIO ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${E("business","#b5000b","#ffdad5","Datos del Proveedor","Información de la empresa y centros donde presta servicio")}
        <div style="padding:20px">
          <form id="form-proveedor" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${w("Razón Social","f-razon",o.razonSocial,"text",!1)}
            ${w("RUT Proveedor","f-rut",o.rut,"text",!1)}
            ${w("Dirección","f-dir",o.direccion,"text",!0,"2")}
            ${w("Comuna","f-comuna",o.comuna,"text",!0)}
            ${J("Región","f-region",o.region)}
            ${w("Correo Electrónico","f-email",o.email,"email",!0)}
            ${w("Teléfono","f-tel",o.telefono,"text",!0)}

            <!-- Centros de servicio (máximo 2) -->
            <div style="grid-column:1/-1;padding:14px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
              <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:12px;display:flex;align-items:center;gap:6px">
                <span class="material-symbols-outlined" style="font-size:14px">location_on</span>
                Centros donde presta servicio (máximo 2 grupos)
              </p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${T("Centro de Servicio 1","f-centro1",y,o.centrosServicio[0]||"")}
                ${T("Centro de Servicio 2 (opcional)","f-centro2",y,o.centrosServicio[1]||"")}
              </div>
            </div>

            <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              ${A("#b5000b","Guardar Datos del Proveedor")}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 2. DATOS BANCARIOS (CUENTA CORRIENTE PARA PAGOS) ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${E("account_balance","#1565c0","#e3f2fd","Datos Bancarios para Pago","Cuenta a la que se realizarán los pagos por servicios de transporte")}
        <div style="padding:20px">
          <form id="form-bancario" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${K("Banco","b-banco",o.datosBancarios.banco)}
            ${Y("Tipo de Cuenta","b-tipo",o.datosBancarios.tipoCuenta)}
            ${w("Número de Cuenta","b-numero",o.datosBancarios.numeroCuenta,"text",!0)}
            ${w("RUT Asociado a la Cuenta","b-rut",o.datosBancarios.rut,"text",!1)}

            <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              ${A("#1565c0","Guardar Datos Bancarios")}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 3. CHOFERES ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${E("group","#7b1fa2","#f3e5f5","Choferes","Conductores de la empresa — se asignan a los camiones por RUT")}
        <div style="padding:20px">
          <form id="form-choferes" style="display:flex;flex-direction:column;gap:10px">
            <div id="choferes-rows" style="display:flex;flex-direction:column;gap:10px">
              ${o.choferes.map((a,i)=>R(a,i)).join("")}
            </div>
            ${o.choferes.length===0?'<p id="choferes-empty" style="text-align:center;color:#5c5f61;font-size:13px;padding:10px">No hay choferes registrados. Agregue el primero.</p>':""}
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid #f3f4f5">
              <button type="button" id="btn-add-chofer" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px dashed #7b1fa2;border-radius:7px;font-size:12px;font-weight:700;color:#7b1fa2;cursor:pointer">
                <span class="material-symbols-outlined" style="font-size:16px">person_add</span> Agregar Chofer
              </button>
              ${A("#7b1fa2","Guardar Choferes")}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 4. CAMIONES ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${E("local_shipping","#2e7d32","#e8f5e9","Camiones (Patentes)","Flota del transportista con su documentación y chofer asignado")}
        <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
          <div id="camiones-cards" style="display:flex;flex-direction:column;gap:16px">
            ${o.camiones.map((a,i)=>M(a,i,o.choferes)).join("")}
          </div>
          ${o.camiones.length===0?'<p style="text-align:center;color:#5c5f61;font-size:13px;padding:10px">No hay camiones registrados. Agregue el primero.</p>':""}
          <button type="button" id="btn-add-camion" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:12px;background:white;border:1.5px dashed #2e7d32;border-radius:8px;font-size:13px;font-weight:700;color:#2e7d32;cursor:pointer">
            <span class="material-symbols-outlined" style="font-size:18px">add_circle</span> Agregar Camión
          </button>
        </div>
      </section>

    </div>
  `,document.getElementById("btn-back-transports").addEventListener("click",()=>{const a=document.getElementById("stage-area"),i=document.getElementById("current-page-title");let l=null;try{l=JSON.parse(localStorage.getItem("ebema_user_session"))}catch{}l&&l.tipo==="proveedor"?(i&&(i.textContent="Portal de Proveedores"),import("./provider-portal.js?v=0f35781af9").then(b=>b.renderPortalHome(a))):(i&&(i.textContent="Gestión de Transportes"),import("./transports.js?v=0f35781af9").then(b=>b.renderTransportsView(a)))});const r=()=>U(e,t),p=a=>a.transports.find(i=>i.id===t);document.getElementById("form-proveedor").addEventListener("submit",a=>{a.preventDefault();const i=$(),l=p(i);if(!l)return;l.direccion=document.getElementById("f-dir").value,l.comuna=document.getElementById("f-comuna").value,l.region=document.getElementById("f-region").value,l.email=document.getElementById("f-email").value,l.telefono=document.getElementById("f-tel").value,l.ownerEmail=(l.email||"").trim().toLowerCase();const b=document.getElementById("f-centro1").value,u=document.getElementById("f-centro2").value;if(b&&u&&b===u)return g("Los dos grupos de servicio no pueden ser el mismo.","error");const f=[b,u].filter(Boolean),c=[];f.forEach(m=>{const s=y.find(h=>h.grupo===m);s&&c.push(...s.centroIds)}),l.centrosServicio=c,C(i,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),g("Datos del proveedor actualizados."),r()}),document.getElementById("form-bancario").addEventListener("submit",a=>{a.preventDefault();const i=$(),l=p(i);if(!l)return;const b=document.getElementById("b-banco").value,u=document.getElementById("b-tipo").value,f=document.getElementById("b-numero").value.trim();if(!b||!u||!f)return g("Complete banco, tipo de cuenta y número de cuenta.","error");l.datosBancarios={banco:b,tipoCuenta:u,numeroCuenta:f,rut:l.rut},C(i,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),g("Datos bancarios actualizados."),r()}),document.getElementById("btn-add-chofer").addEventListener("click",()=>{const a=document.getElementById("choferes-rows"),i=a.children.length;a.insertAdjacentHTML("beforeend",R({nombre:"",rut:"",telefono:"",licencia:""},i));const l=document.getElementById("choferes-empty");l&&l.remove()}),document.getElementById("form-choferes").addEventListener("submit",a=>{a.preventDefault();const i=$(),l=p(i);if(!l)return;const b=[...document.querySelectorAll("#choferes-rows .chofer-row")],u=[];for(const c of b){const m=c.querySelector(".ch-nombre").value.trim(),s=q(c.querySelector(".ch-rut").value.trim()),h=c.querySelector(".ch-tel").value.trim(),D=c.querySelector(".ch-lic").value.trim();if(!m&&!s)continue;if(!m||!s)return g("Cada chofer debe tener al menos nombre y RUT.","error");if(u.some(S=>S.rut===s))return g(`RUT de chofer duplicado: ${s}`,"error");const x=(l.choferes||[]).find(S=>S.rut===s)||{};u.push({...x,nombre:m,rut:s,telefono:h,licencia:D})}const f=(l.choferes||[]).map(c=>c.rut).filter(c=>c&&!u.some(m=>m.rut===c));l.choferes=u,(l.camiones||[]).forEach(c=>{c.choferRut&&!u.some(m=>m.rut===c.choferRut)&&(c.choferRut="")}),C(i,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),f.length>0&&N("transportsChoferes",f).catch(c=>console.error("Error al borrar chofer(es) en Supabase:",c.message||c)),g("Choferes guardados correctamente."),r()}),document.getElementById("choferes-rows").addEventListener("click",a=>{const i=a.target.closest(".btn-del-chofer");i&&i.closest(".chofer-row").remove()}),document.getElementById("btn-add-camion").addEventListener("click",()=>{const a=$(),i=p(a);i&&(i.camiones.push({id:"c"+Date.now(),patente:"",modelo:"",anio:new Date().getFullYear(),capacidad:5,ejes:I(5),dimensiones:{largo:0,ancho:0,alto:0},documentos:{},choferRut:""}),C(a,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),r())}),document.getElementById("camiones-cards").addEventListener("click",async a=>{const i=a.target.closest(".btn-save-camion"),l=a.target.closest(".btn-del-camion"),b=a.target.closest(".btn-upload-doc");if(b){const u=document.getElementById(b.getAttribute("data-input"));u&&u.click();return}if(l){const u=l.getAttribute("data-camion");if(!await V("¿Eliminar este camión y su documentación?"))return;const f=$(),c=p(f),m=(c.camiones||[]).find(s=>s.id===u);c.camiones=c.camiones.filter(s=>s.id!==u),C(f,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),m&&m.patente&&L("transportsCamiones",m.patente).catch(s=>console.error("Error al borrar camión en Supabase:",s.message||s)),g("Camión eliminado."),r();return}if(i){const u=i.getAttribute("data-camion"),f=i.closest(".camion-card"),c=$(),m=p(c),s=m.camiones.find(x=>x.id===u);if(!s)return;const h=f.querySelector(".cam-patente").value.toUpperCase().replace(/\s+/g,"");if(!h)return g("La patente es obligatoria.","error");if(m.camiones.some(x=>x.id!==u&&x.patente===h))return g("Esa patente ya está registrada en este transportista.","error");s.patente=h,s.modelo=f.querySelector(".cam-modelo").value,s.anio=parseInt(f.querySelector(".cam-anio").value)||2020,s.capacidad=Number(f.querySelector(".cam-capacidad").value)||0,s.ejes=I(s.capacidad),s.dimensiones={largo:parseFloat(f.querySelector(".cam-largo").value)||0,ancho:parseFloat(f.querySelector(".cam-ancho").value)||0,alto:parseFloat(f.querySelector(".cam-alto").value)||0},s.choferRut=f.querySelector(".cam-chofer").value,s.documentos||(s.documentos={}),j.forEach(x=>{s.documentos[x.key]||(s.documentos[x.key]={archivo:null,desde:"",hasta:""}),s.documentos[x.key].desde=f.querySelector(`.doc-desde-${x.key}`).value||"",s.documentos[x.key].hasta=f.querySelector(`.doc-hasta-${x.key}`).value||"",x.conValor&&(s.documentos[x.key].valor=Number(f.querySelector(`.doc-valor-${x.key}`).value)||0)}),C(c,{syncOnly:["transports","transportsCamiones","transportsChoferes"]}),g(`Camión ${h} guardado correctamente.`),r()}}),document.getElementById("camiones-cards").addEventListener("change",a=>{const i=a.target.closest(".doc-file-input");if(!i||!i.files[0])return;const l=i.getAttribute("data-camion"),b=i.getAttribute("data-doc"),u=i.files[0],f=$(),m=p(f).camiones.find(h=>h.id===l);if(!m)return;m.documentos||(m.documentos={}),m.documentos[b]||(m.documentos[b]={archivo:null,desde:"",hasta:""}),m.documentos[b].archivo=u.name,C(f,{syncOnly:["transports","transportsCamiones","transportsChoferes"]});const s=document.getElementById(`lbl-${l}-${b}`);s&&(s.textContent=`✓ ${u.name}`),g(`Archivo "${u.name}" registrado.`)})}function E(e,t,d,o,n){return`
    <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;background:${d};border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span class="material-symbols-outlined" style="font-size:18px;color:${t}">${e}</span>
      </div>
      <div>
        <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">${o}</h2>
        <p style="font-size:12px;color:#5c5f61;margin-top:2px">${n}</p>
      </div>
    </div>`}function A(e,t){return`
    <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:${e};color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">
      <span class="material-symbols-outlined" style="font-size:16px">save</span> ${t}
    </button>`}function R(e,t){return`
    <div class="chofer-row" style="display:grid;grid-template-columns:2fr 1.2fr 1.2fr 1.2fr auto;gap:10px;align-items:end;border:1px solid #e1e3e4;border-radius:8px;padding:12px;background:#fcfcfc">
      ${B("Nombre y Apellido","ch-nombre",e.nombre)}
      ${B("RUT","ch-rut",e.rut)}
      ${B("Teléfono","ch-tel",e.telefono)}
      ${B("N° Licencia","ch-lic",e.licencia)}
      <button type="button" class="btn-del-chofer" title="Eliminar chofer" style="background:none;border:1px solid #fca5a5;border-radius:7px;padding:8px;cursor:pointer;color:#991b1b;display:flex;align-items:center;height:fit-content">
        <span class="material-symbols-outlined" style="font-size:17px">delete</span>
      </button>
    </div>`}function B(e,t,d){return`
    <div>
      <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${e}</label>
      <input type="text" class="${t}" value="${v(d)}"
        style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='#7b1fa2'" onblur="this.style.borderColor='#e1e3e4'" />
    </div>`}function M(e,t,d){const o=e.documentos||{},n=e.dimensiones||{},y=(d||[]).map(r=>`<option value="${v(r.rut)}" ${r.rut===e.choferRut?"selected":""}>${v(r.nombre)} (${v(r.rut)})</option>`).join("");return`
    <div class="camion-card" style="border:1.5px solid #e1e3e4;border-radius:12px;overflow:hidden">
      <!-- Header del camión -->
      <div style="padding:12px 16px;background:#f0f7f0;border-bottom:1px solid #e1e3e4;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="material-symbols-outlined" style="font-size:22px;color:#2e7d32">local_shipping</span>
          <span style="font-size:15px;font-weight:800;color:#191c1d">Camión ${t+1}${e.patente?" — "+v(e.patente):" (nuevo)"}</span>
        </div>
        <button type="button" class="btn-del-camion" data-camion="${e.id}" style="display:inline-flex;align-items:center;gap:4px;background:none;border:1px solid #fca5a5;border-radius:7px;padding:6px 10px;cursor:pointer;color:#991b1b;font-size:11px;font-weight:700">
          <span class="material-symbols-outlined" style="font-size:15px">delete</span> Eliminar
        </button>
      </div>

      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <!-- Datos del vehículo -->
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px">
          ${z("Patente","cam-patente",e.patente)}
          ${z("Modelo","cam-modelo",e.modelo)}
          ${z("Año","cam-anio",e.anio,"number")}
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Capacidad (Tons)</label>
            <input type="number" step="0.1" class="cam-capacidad" value="${e.capacidad!==void 0&&e.capacidad!==null?e.capacidad:""}"
              oninput="var ej=document.getElementById('cam-ejes-${e.id}'); if(ej) ej.textContent = (Number(this.value) >= 15 ? '3 Ejes' : '2 Ejes');"
              style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
              onfocus="this.style.borderColor='#2e7d32'" onblur="this.style.borderColor='#e1e3e4'" />
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Tipo de Eje</label>
            <div id="cam-ejes-${e.id}" style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#5c5f61;background:#f8f9fa;font-weight:700;box-sizing:border-box">${I(e.capacidad)} Ejes</div>
          </div>
        </div>

        <!-- Dimensiones + chofer -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:12px;padding:12px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
          ${z("Largo (m)","cam-largo",n.largo,"number")}
          ${z("Ancho (m)","cam-ancho",n.ancho,"number")}
          ${z("Alto (m)","cam-alto",n.alto,"number")}
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Chofer Asignado</label>
            <select class="cam-chofer" style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
              <option value="">Sin chofer asignado...</option>
              ${y}
            </select>
          </div>
        </div>

        <!-- Documentación con valores -->
        <div>
          <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <span class="material-symbols-outlined" style="font-size:14px">folder_open</span>
            Documentación del vehículo
          </p>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${j.map(r=>{const p=o[r.key]||{},a=H(p);return`
              <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr ${r.conValor?"1fr":""} 1.3fr;gap:10px;align-items:end;border:1px solid ${k(p.hasta)?"#fca5a5":"#e1e3e4"};border-radius:8px;padding:10px 12px;background:${k(p.hasta)?"#fef2f2":"white"}">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="material-symbols-outlined" style="font-size:18px;color:#3949ab">${r.icon}</span>
                  <div>
                    <p style="font-size:12px;font-weight:700;color:#191c1d;line-height:1.2">${r.label}</p>
                    <span style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;padding:1px 8px;background:${a.bg};color:${a.text};border-radius:20px;font-size:10px;font-weight:700">
                      <span class="material-symbols-outlined" style="font-size:11px">${a.icon}</span>${a.label}
                    </span>
                  </div>
                </div>
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5c5f61;margin-bottom:3px">Desde</label>
                  <input type="date" class="doc-desde-${r.key}" value="${(p.desde||"").slice(0,10)}" style="width:100%;padding:6px 8px;border:1.5px solid #e1e3e4;border-radius:6px;font-size:12px;box-sizing:border-box" />
                </div>
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5c5f61;margin-bottom:3px">Hasta</label>
                  <input type="date" class="doc-hasta-${r.key}" value="${(p.hasta||"").slice(0,10)}" style="width:100%;padding:6px 8px;border:1.5px solid #e1e3e4;border-radius:6px;font-size:12px;box-sizing:border-box" />
                </div>
                ${r.conValor?`
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#b5000b;margin-bottom:3px">Valor (CLP)</label>
                  <input type="number" min="0" class="doc-valor-${r.key}" value="${p.valor||""}" placeholder="$"
                    style="width:100%;padding:6px 8px;border:1.5px solid ${Number(p.valor)>0?"#e1e3e4":"#fcd34d"};border-radius:6px;font-size:12px;box-sizing:border-box;background:${Number(p.valor)>0?"white":"#fffbeb"}" />
                </div>`:""}
                <div>
                  <input type="file" id="file-${e.id}-${r.key}" class="doc-file-input" data-camion="${e.id}" data-doc="${r.key}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" />
                  <button type="button" class="btn-upload-doc" data-input="file-${e.id}-${r.key}"
                    style="display:inline-flex;align-items:center;gap:5px;padding:7px 10px;background:white;border:1.5px dashed #c5c7c9;border-radius:6px;font-size:11px;font-weight:600;color:#5c5f61;cursor:pointer;width:100%;justify-content:center">
                    <span class="material-symbols-outlined" style="font-size:14px">upload_file</span>
                    <span id="lbl-${e.id}-${r.key}">${p.archivo?"✓ "+v(p.archivo):"Subir archivo"}</span>
                  </button>
                </div>
              </div>`}).join("")}
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;padding-top:6px;border-top:1px solid #f3f4f5">
          <button type="button" class="btn-save-camion" data-camion="${e.id}" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#2e7d32;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">
            <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Camión
          </button>
        </div>
      </div>
    </div>`}function z(e,t,d,o="text"){return`
    <div>
      <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${e}</label>
      <input type="${o}" class="${t}" value="${v(d??"")}" ${o==="number"?'step="0.1"':""}
        style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='#2e7d32'" onblur="this.style.borderColor='#e1e3e4'" />
    </div>`}function w(e,t,d,o="text",n=!0,y="1"){const r=!n;return`
    <div style="grid-column:span ${y}">
      <label for="${t}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${e}${n?"":' <span style="color:#b5000b;font-size:9px">(bloqueado)</span>'}</label>
      <input type="${o}" id="${t}" value="${v(d??"")}" ${r?"readonly":""}
        style="width:100%;padding:9px 12px;border:1.5px solid ${r?"#e9bcb6":"#e1e3e4"};border-radius:7px;font-size:13px;color:${r?"#5c5f61":"#191c1d"};background:${r?"#fdf5f4":"white"};outline:none;box-sizing:border-box;cursor:${r?"not-allowed":"text"}"
        ${r?"":`onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'"`} />
    </div>`}function J(e,t,d){const o=P.map(n=>`<option value="${n}" ${n===d?"selected":""}>${n}</option>`).join("");return`
    <div>
      <label for="${t}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${e}</label>
      <select id="${t}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar región...</option>
        ${o}
      </select>
    </div>`}function K(e,t,d){const o=_.map(n=>`<option value="${n}" ${n===d?"selected":""}>${n}</option>`).join("");return`
    <div>
      <label for="${t}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${e}</label>
      <select id="${t}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar banco...</option>
        ${o}
      </select>
    </div>`}function Y(e,t,d){const o=G.map(n=>`<option value="${n}" ${n===d?"selected":""}>${n}</option>`).join("");return`
    <div>
      <label for="${t}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${e}</label>
      <select id="${t}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar tipo de cuenta...</option>
        ${o}
      </select>
    </div>`}function T(e,t,d,o){const n=d.find(r=>r.centroIds.includes(o)),y=d.map(r=>{const p=n&&r.grupo===n.grupo;return`<option value="${r.grupo}" ${p?"selected":""}>${r.nombre} (${r.centroIds.join(", ")})</option>`}).join("");return`
    <div>
      <label for="${t}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${e}</label>
      <select id="${t}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Sin asignar...</option>
        ${y}
      </select>
    </div>`}export{U as renderFichaTransporte};
