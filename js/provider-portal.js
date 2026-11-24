import{supabase as f}from"./supabase-client.js?v=fd17fd7d20";import{getDatabase as b}from"./data.js?v=99b844b255";import{showAlert as g,formatPhone as x,escapeHtml as t}from"./utils.js";import{renderFichaTransporte as u}from"./ficha-transporte.js?v=259bfaa3f8";const m={pendiente:{label:"Pendiente de aprobación",color:"#92400e",bg:"#fef3c7",border:"#fbbf24",icon:"schedule"},aprobado:{label:"Proveedor aprobado",color:"#166534",bg:"#dcfce7",border:"#86efac",icon:"verified"},rechazado:{label:"Solicitud rechazada",color:"#991b1b",bg:"#fee2e2",border:"#fca5a5",icon:"block"}};function E(i,e){const a=document.getElementById("app-root");a.innerHTML=`
    <!-- Topbar del portal -->
    <header style="display:flex;justify-content:space-between;align-items:center;height:64px;padding:0 28px;background:white;border-bottom:1px solid #e1e3e4;position:sticky;top:0;z-index:40">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="https://www.ebema.cl/wp-content/uploads/2023/03/cropped-cropped-Ebema-Logo-Ebema-Removebg-1-270x270.png" alt="Logo EBEMA" style="width:38px;height:38px;object-fit:contain" />
        <div>
          <div style="font-weight:900;font-size:16px;color:#b5000b;line-height:1.1">SIT EBEMA</div>
          <h2 id="current-page-title" style="font-size:11px;color:#5c5f61;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;margin:0">Portal de Proveedores</h2>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="text-align:right" class="hidden sm:block">
          <p style="font-size:13px;font-weight:700;color:#191c1d;line-height:1.1">${t(i.name)}</p>
          <p style="font-size:11px;color:#5c5f61">${t(i.email)}</p>
        </div>
        <button id="btn-provider-logout" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px solid #e1e3e4;border-radius:8px;font-size:13px;font-weight:600;color:#5c5f61;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='#b5000b';this.style.color='#b5000b'" onmouseout="this.style.borderColor='#e1e3e4';this.style.color='#5c5f61'">
          <span class="material-symbols-outlined" style="font-size:17px">logout</span>
          Salir
        </button>
      </div>
    </header>

    <!-- Contenido -->
    <main style="max-width:980px;margin:0 auto;padding:32px 24px;min-height:calc(100vh - 64px);background:#f8f9fa">
      <div id="stage-area"></div>
    </main>
  `,document.getElementById("btn-provider-logout").addEventListener("click",e),y(document.getElementById("stage-area"))}async function y(i){i.innerHTML='<div style="text-align:center;padding:60px;color:#5c5f61">Cargando su información...</div>';const{data:e,error:a}=await f.from("providers").select("*").limit(1).maybeSingle();if(a||!e){i.innerHTML='<div style="text-align:center;padding:60px;color:#93000a">No se pudo cargar su perfil. Intente recargar la página.</div>';return}const r=m[e.estado]||m.pendiente,n=b().transports||[];i.innerHTML=`
    <!-- Banner de estado -->
    <div style="display:flex;align-items:center;gap:14px;background:${r.bg};border:1.5px solid ${r.border};border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <span class="material-symbols-outlined" style="font-size:28px;color:${r.color}">${r.icon}</span>
      <div>
        <p style="font-size:16px;font-weight:800;color:${r.color};line-height:1.2">${r.label}</p>
        <p style="font-size:12px;color:${r.color};opacity:0.85;margin-top:2px">${e.estado==="pendiente"?"Su solicitud está siendo revisada por el equipo de EBEMA.":e.estado==="aprobado"?"Su empresa está habilitada para operar con EBEMA.":"Contacte a EBEMA para más información."}</p>
      </div>
    </div>

    <!-- Perfil de la empresa -->
    <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);margin-bottom:24px">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:#ffdad5;border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="font-size:18px;color:#b5000b">business</span>
        </div>
        <div>
          <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Datos de la Empresa</h2>
          <p style="font-size:12px;color:#5c5f61;margin-top:2px">Información de registro como proveedor de servicio</p>
        </div>
      </div>
      <div style="padding:20px">
        <form id="form-provider-profile" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${l("Razón Social","p-razon",t(e.razonSocial),!1)}
          ${l("RUT Empresa","p-rut",t(e.rut),!1)}
          ${l("Correo de Contacto","p-email",t(e.email),!1)}
          ${l("Teléfono","p-telefono",t(e.telefono),!0)}
          ${l("Nombre Representante Legal","p-representante",t(e.representante),!0,"2")}
          <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
            <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#b5000b;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">
              <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Cambios
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Mis camiones -->
    <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:#e8f5e9;border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="font-size:18px;color:#2e7d32">local_shipping</span>
        </div>
        <div>
          <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Mis Camiones</h2>
          <p style="font-size:12px;color:#5c5f61;margin-top:2px">Complete la documentación de cada vehículo</p>
        </div>
      </div>
      <div style="padding:20px">
        ${n.length===0?`
          <div style="text-align:center;padding:30px;color:#5c5f61">
            <span class="material-symbols-outlined" style="font-size:42px;color:#c5c7c9">no_transfer</span>
            <p style="font-size:14px;margin-top:10px">EBEMA aún no ha asociado camiones a su cuenta.</p>
            <p style="font-size:12px;margin-top:4px;color:#888">Los vehículos se asocian usando el correo <strong>${t(e.email)}</strong> como contacto del transporte.</p>
          </div>
        `:`
          <div style="display:flex;flex-direction:column;gap:10px">
            ${n.map(o=>`
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e1e3e4;border-radius:10px;padding:14px 16px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:12px">
                  <span class="material-symbols-outlined" style="font-size:26px;color:#b5000b">local_shipping</span>
                  <div>
                    <p style="font-size:14px;font-weight:700;color:#191c1d">${t(o.patente)} — ${t(o.modelo)||"Sin modelo"}</p>
                    <p style="font-size:12px;color:#5c5f61">${t(o.capacidad)} Tons · Código ${t(o.codigoSap)||"—"}</p>
                  </div>
                </div>
                <button class="btn-ver-ficha" data-id="${o.id}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#b5000b;color:white;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">
                  <span class="material-symbols-outlined" style="font-size:15px">folder_open</span>
                  Ver Ficha y Documentación
                </button>
              </div>
            `).join("")}
          </div>
        `}
      </div>
    </section>
  `,document.getElementById("p-telefono").addEventListener("blur",o=>{o.target.value.trim()&&(o.target.value=x(o.target.value))}),document.getElementById("form-provider-profile").addEventListener("submit",async o=>{o.preventDefault();const d=x(document.getElementById("p-telefono").value.trim()),p=document.getElementById("p-representante").value.trim(),{error:s}=await f.from("providers").update({telefono:d,representante:p}).eq("email",e.email);s?g("No se pudo guardar: "+s.message,"error"):g("Datos actualizados correctamente.")}),i.querySelectorAll(".btn-ver-ficha").forEach(o=>{o.addEventListener("click",d=>{const p=d.currentTarget.getAttribute("data-id"),s=document.getElementById("current-page-title");s&&(s.textContent="Ficha de Transporte"),u(i,p)})})}function l(i,e,a,r,c="1"){const n=!r;return`
    <div style="grid-column:span ${c}">
      <label for="${e}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${i}${n?' <span style="color:#b5000b;font-size:9px">(bloqueado)</span>':""}</label>
      <input type="text" id="${e}" value="${a??""}" ${n?"readonly":""}
        style="width:100%;padding:9px 12px;border:1.5px solid ${n?"#e9bcb6":"#e1e3e4"};border-radius:7px;font-size:13px;color:${n?"#5c5f61":"#191c1d"};background:${n?"#fdf5f4":"white"};outline:none;box-sizing:border-box;cursor:${n?"not-allowed":"text"}" />
    </div>`}export{y as renderPortalHome,E as renderProviderShell};
