import{getDatabase as xe,initDatabase as ye,startDatabase as he,dbReady as we,loadRoutesData as S,loadHistoricoFlete360 as Y}from"./data.js?v=99b844b255";import{supabase as f}from"./supabase-client.js?v=fd17fd7d20";import{setSesionPermisos as K,puedeVerMenu as h,can as R,esSoloLectura as G,PERFILES as ke,normalizarPerfil as W}from"./permisos.js?v=a8b193e9fb";const q={};async function v(t,e){return q[t]||(q[t]=await import(e)),q[t]}const D=(t,e)=>setTimeout(()=>window.requestIdleCallback?requestIdleCallback(t,{timeout:3e3}):t(),e);function V(){try{const t=T("home")||T("indicadores",null),e=T("abastecimiento",null),o=e||["rates","routes","tarifas-transporte","tarifas-clientes","flete-tercero"].some(a=>T(a,null));t&&D(()=>v("ind","./indicadores.js?v=011be41305").catch(()=>{}),600),o&&D(()=>S().catch(()=>{}),1200),e&&D(()=>v("abast","./abastecimiento.js?v=d61608ea35").catch(()=>{}),2500)}catch(t){console.warn("[prewarm]",t)}}import{showAlert as x,formatRut as J,validateRut as Ee,formatPhone as N}from"./utils.js";const w="ebema_user_session";let d=null,k="home",L=null,y="login";const I=document.getElementById("app-root");document.addEventListener("DOMContentLoaded",async()=>{const e=new URLSearchParams(window.location.hash.replace("#","")).get("type");if(e==="invite"||e==="recovery"){const{data:{session:o}}=await f.auth.getSession();if(o){history.replaceState(null,"",window.location.pathname+window.location.search),Ie(o.user,e);return}}await $(),C(),d&&d.tipo!=="proveedor"&&V(),ze(),Le()});const Z=(()=>{try{return new URL(import.meta.url).searchParams.get("v")||""}catch{return""}})();let Q="";async function _e(){try{const t=await fetch("index.html?_="+Date.now(),{cache:"no-store"});if(!t.ok)return"";const e=(await t.text()).match(/js\/app\.js\?v=([0-9a-z]+)/i);return e?e[1]:""}catch{return""}}function Se(){if(document.getElementById("aviso-version-nueva"))return;const t=document.createElement("div");t.id="aviso-version-nueva",t.style.cssText="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;background:#1f2937;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;font:500 14px/1.3 system-ui,sans-serif;max-width:calc(100vw - 32px)",t.innerHTML='<span>Hay una nueva versión de SIT EBEMA.</span><button type="button" style="background:#dc2626;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer">Actualizar</button>',t.querySelector("button").addEventListener("click",()=>location.reload()),document.body.appendChild(t)}function Le(){if(!Z)return;let t=0;const e=async o=>{const a=Q||await _e();if(!(!a||a===Z)){if(Q=a,o){location.reload();return}Se()}};document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){t=Date.now();return}e(t&&Date.now()-t>2*60*1e3)}),setInterval(()=>e(!1),10*60*1e3)}let H=!1;function F(){H||!d||(H=!0,d=null,localStorage.removeItem(w),y="login",x("Tu sesión expiró. Vuelve a ingresar para ver los datos actualizados.","error"),C(),setTimeout(()=>{H=!1},3e3))}function ze(){try{f.auth.onAuthStateChange((e,o)=>{(e==="SIGNED_OUT"&&d||o===null&&d&&e!=="INITIAL_SESSION")&&F()})}catch{}const t=async()=>{if(d)try{const{data:{session:e}}=await f.auth.getSession();e||F()}catch{}};document.addEventListener("visibilitychange",()=>{document.visibilityState==="visible"&&t()}),window.addEventListener("focus",t),setInterval(t,5*60*1e3)}function Ie(t,e){const o=e==="invite"?"Bienvenido — Define tu contraseña corporativa":"Restablecer contraseña";I.innerHTML=`
    <div class="min-h-screen flex items-center justify-center bg-background">
      <div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div class="flex items-center gap-sm mb-md">
          <div style="width:36px;height:36px;background:#b5000b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:white">E</div>
          <div>
            <div class="font-bold text-primary text-lg leading-none">SIT EBEMA</div>
            <div class="text-xs text-secondary">Sistema Integrado de Transporte</div>
          </div>
        </div>
        <h2 class="font-bold text-headline-sm mb-xs">${o}</h2>
        <p class="text-sm text-secondary mb-md">Cuenta: <strong>${t.email}</strong></p>

        <form id="set-pass-form" class="flex flex-col gap-sm" autocomplete="off">
          <div>
            <label class="text-xs font-bold text-secondary uppercase tracking-wide block mb-[4px]">Nueva contraseña</label>
            <input id="sp-pass" type="password" minlength="8" required placeholder="Mínimo 8 caracteres"
              class="border border-outline-variant rounded px-sm py-xs text-sm w-full focus:outline-none focus:border-primary"/>
          </div>
          <div>
            <label class="text-xs font-bold text-secondary uppercase tracking-wide block mb-[4px]">Confirmar contraseña</label>
            <input id="sp-confirm" type="password" minlength="8" required placeholder="Repite la contraseña"
              class="border border-outline-variant rounded px-sm py-xs text-sm w-full focus:outline-none focus:border-primary"/>
          </div>

          <div id="sp-error" class="hidden bg-error-container text-on-error-container text-xs p-sm rounded"></div>

          <button type="submit" id="sp-btn"
            class="bg-primary hover:bg-[#930007] text-white rounded px-md py-sm text-sm font-bold mt-xs flex items-center justify-center gap-xs transition-colors">
            <span class="material-symbols-outlined text-[16px]">lock_reset</span>
            Activar cuenta y entrar
          </button>
        </form>
      </div>
    </div>`,document.getElementById("set-pass-form").addEventListener("submit",async a=>{a.preventDefault();const n=document.getElementById("sp-pass").value,i=document.getElementById("sp-confirm").value,s=document.getElementById("sp-error"),r=document.getElementById("sp-btn");if(s.classList.add("hidden"),n.length<8){s.textContent="La contraseña debe tener al menos 8 caracteres.",s.classList.remove("hidden");return}if(n!==i){s.textContent="Las contraseñas no coinciden.",s.classList.remove("hidden");return}r.disabled=!0,r.innerHTML='<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Activando...';const{error:c}=await f.auth.updateUser({password:n});if(c){s.textContent=c.message,s.classList.remove("hidden"),r.disabled=!1,r.innerHTML='<span class="material-symbols-outlined text-[16px]">lock_reset</span> Activar cuenta y entrar';return}x("¡Contraseña definida! Bienvenido al sistema."),await $(),C()})}async function $(){try{const{data:{session:t}}=await f.auth.getSession();if(!t){d=null,localStorage.removeItem(w);return}const e=t.user.email.toLowerCase(),o=t.user.user_metadata||{};if(!e.endsWith("@ebema.cl")){await ye();let{data:i}=await f.from("providers").select("*").eq("email",e).maybeSingle();if(!i){await f.auth.signOut(),d=null,localStorage.removeItem(w),x("Su cuenta no tiene acceso habilitado. El ingreso a SIT EBEMA es solo por invitación.","error");return}d={email:e,name:i.razonSocial,role:"proveedor",tipo:"proveedor"},localStorage.setItem(w,JSON.stringify(d));return}const a=he();let n=null;{const{data:i,error:s}=await f.from("app_users").select("*").eq("email",e).maybeSingle();!s&&i?n=i:(await a,n=(xe().users||[]).find(r=>r.email===e))}if(n)n.lastAccess=new Date().toLocaleDateString("es-CL"),f.from("app_users").update({lastAccess:n.lastAccess}).eq("email",e).then(()=>{},()=>{});else{await f.auth.signOut(),d=null,localStorage.removeItem(w),x("Su cuenta no tiene acceso habilitado. El ingreso a SIT EBEMA es solo por invitación; solicítela al administrador.","error");return}if(n.activo===!1){await f.auth.signOut(),d=null,localStorage.removeItem(w),x("Su cuenta corporativa ha sido inhabilitada por el administrador.","error");return}d={email:e,name:n.name,role:W(n.role),tipo:"funcionario",centros:Array.isArray(n.centrosAsignados)?n.centrosAsignados:[],vistasExtra:Array.isArray(n.vistasExtra)?n.vistasExtra:[],accionesExtra:Array.isArray(n.accionesExtra)?n.accionesExtra:[]},K(d.role,d.centros,d),localStorage.setItem(w,JSON.stringify(d))}catch(t){console.error("Error verificando sesión:",t),d=null}}window.addEventListener("db_sync_error",t=>{const e=t&&t.detail?` (${t.detail})`:"";x(`No se pudo sincronizar parte de los datos con el servidor. Cambios guardados solo localmente.${e}`,"error")});function C(){d?d.tipo==="proveedor"?import("./provider-portal.js?v=259bfaa3f8").then(t=>t.renderProviderShell(d,X)):We():E()}async function X(){await f.auth.signOut();const t=(()=>{try{return JSON.parse(localStorage.getItem(w)||"{}").email||"anon"}catch{return"anon"}})();localStorage.removeItem(w),localStorage.removeItem("ebema_transporte_db"),localStorage.removeItem("sit_ebema_hist_v1"),localStorage.removeItem(`ebema_recent_quotes_${t}`);try{const e=indexedDB.deleteDatabase("sit_ebema_idb");e.onerror=()=>console.warn("No se pudo eliminar la caché IndexedDB local (sit_ebema_idb)."),e.onblocked=()=>console.warn("Eliminación de caché IndexedDB (sit_ebema_idb) bloqueada por otra pestaña abierta.")}catch{console.warn("No se pudo iniciar la eliminación de la caché IndexedDB local (sit_ebema_idb).")}d=null,k="home",L=null;try{history.replaceState(null,"",window.location.pathname+window.location.search)}catch{}y="login",x("Sesión finalizada."),C()}function E(){y==="login"?Ce():y==="recover"&&Be()}function Ce(){I.innerHTML=`
    <div class="auth-split-layout min-h-screen flex" style="background:#f8f9fa">

      <!-- Panel Izquierdo: Branding EBEMA -->
      <div class="auth-brand-panel hidden lg:flex flex-col justify-between w-2/5 p-12 relative overflow-hidden" style="background:linear-gradient(145deg,#8b0000 0%,#b5000b 45%,#d40010 80%,#ff1a24 100%)">
        <!-- Patrón de fondo decorativo -->
        <div style="position:absolute;inset:0;background-image:radial-gradient(circle at 20% 80%, rgba(255,255,255,0.06) 0%, transparent 50%),radial-gradient(circle at 80% 20%, rgba(255,255,255,0.04) 0%, transparent 50%);pointer-events:none"></div>
        <div style="position:absolute;bottom:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>
        <div style="position:absolute;top:-40px;left:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.03);pointer-events:none"></div>

        <!-- Logo Superior -->
        <div style="position:relative;z-index:2">
          <div style="display:inline-flex;align-items:center;gap:16px;margin-bottom:40px">
            <div style="width:72px;height:72px;background:white;border-radius:16px;display:flex;align-items:center;justify-content:center;padding:8px;box-shadow:0 4px 14px rgba(0,0,0,0.25)">
              <img src="https://www.ebema.cl/wp-content/uploads/2023/03/cropped-cropped-Ebema-Logo-Ebema-Removebg-1-270x270.png" alt="Logo EBEMA" style="width:100%;height:100%;object-fit:contain" />
            </div>
            <div>
              <div style="color:white;font-weight:900;font-size:34px;letter-spacing:-0.01em;line-height:1.05">SIT EBEMA</div>
              <div style="color:rgba(255,255,255,0.65);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px">Sistema Integrado de Transporte</div>
            </div>
          </div>

          <h2 style="color:white;font-size:30px;font-weight:800;line-height:1.25;letter-spacing:-0.01em;margin-bottom:14px;text-transform:uppercase">Gestión Logística<br/>de Transporte</h2>
          <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.6;max-width:320px">Plataforma centralizada para cotización de tarifas, administración de rutas y control de transportes.</p>
        </div>

        <!-- Foto camión con materiales de construcción -->
        <div style="position:relative;z-index:2">
          <div style="border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.25);box-shadow:0 10px 30px rgba(0,0,0,0.3);margin-bottom:20px">
            <img src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=900&q=70" alt="Camión de transporte de materiales de construcción" style="width:100%;height:200px;object-fit:cover;display:block" />
            <div style="background:rgba(0,0,0,0.35);backdrop-filter:blur(6px);padding:10px 16px;display:flex;align-items:center;gap:8px;position:absolute;bottom:0;left:0;right:0">
              <span class="material-symbols-outlined" style="font-size:16px;color:white">local_shipping</span>
              <span style="color:white;font-size:12px;font-weight:600">Flota de transporte de materiales de construcción EBEMA</span>
            </div>
          </div>
          <p style="color:rgba(255,255,255,0.4);font-size:11px">© 2026 EBEMA Chile — Acceso restringido</p>
        </div>
      </div>

      <!-- Panel Derecho: Formulario -->
      <div class="auth-form-panel flex-1 flex items-center justify-center p-8">
        <div style="width:100%;max-width:420px;animation:slideUp 0.4s ease-out">

          <!-- Header del formulario -->
          <div style="margin-bottom:24px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
              <img src="https://www.ebema.cl/wp-content/uploads/2023/03/cropped-cropped-Ebema-Logo-Ebema-Removebg-1-270x270.png" alt="Logo EBEMA" style="width:52px;height:52px;object-fit:contain" />
              <span style="color:#b5000b;font-weight:900;font-size:26px;letter-spacing:-0.01em">SIT EBEMA</span>
            </div>
            <h1 style="font-size:28px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:6px">Iniciar Sesión</h1>
            <p style="color:#5c5f61;font-size:14px">Seleccione su tipo de acceso a la plataforma</p>
          </div>

          <!-- Pestañas de tipo de acceso -->
          <div style="display:flex;background:#edeeef;border-radius:10px;padding:4px;margin-bottom:24px">
            <button type="button" id="tab-funcionario" style="flex:1;padding:10px 8px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;background:white;color:#b5000b;box-shadow:0 1px 4px rgba(0,0,0,0.12);display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s">
              <span class="material-symbols-outlined" style="font-size:17px">badge</span>
              Funcionarios EBEMA
            </button>
            <button type="button" id="tab-proveedor" style="flex:1;padding:10px 8px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:#5c5f61;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s">
              <span class="material-symbols-outlined" style="font-size:17px">local_shipping</span>
              Proveedores de Servicio
            </button>
          </div>

          <!-- Alerta de error -->
          <div id="login-error-alert" class="hidden" style="display:none;align-items:center;gap:8px;padding:10px 14px;background:#ffdad6;border:1px solid rgba(186,26,26,0.2);border-radius:8px;margin-bottom:20px;font-size:13px;color:#93000a">
            <span class="material-symbols-outlined" style="font-size:16px">error</span>
            <span id="login-error-text"></span>
          </div>

          <!-- Formulario -->
          <form id="login-form" style="display:flex;flex-direction:column;gap:18px">
            <div>
              <label for="login-email" id="login-email-label" style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Correo Corporativo</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">mail</span>
                <input
                  type="email"
                  id="login-email"
                  placeholder="usuario@ebema.cl"
                  required
                  style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'"
                  onblur="this.style.borderColor='#e1e3e4'"
                />
              </div>
            </div>

            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <label for="login-password" style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61">Contraseña</label>
                <button type="button" id="link-go-recover" style="font-size:12px;color:#b5000b;background:none;border:none;cursor:pointer;font-weight:600;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">¿Olvidó su clave?</button>
              </div>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">lock</span>
                <input
                  type="password"
                  id="login-password"
                  placeholder="••••••••"
                  required
                  style="width:100%;padding:12px 40px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'"
                  onblur="this.style.borderColor='#e1e3e4'"
                />
                <button type="button" id="toggle-login-pass" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#5c5f61;display:flex;align-items:center">
                  <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="btn-login-submit"
              style="width:100%;padding:13px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:background 0.2s,transform 0.1s;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px"
              onmouseover="this.style.background='#930007'"
              onmouseout="this.style.background='#b5000b'"
              onmousedown="this.style.transform='scale(0.98)'"
              onmouseup="this.style.transform='scale(1)'"
            >
              <span class="material-symbols-outlined" style="font-size:18px">login</span>
              Iniciar Sesión
            </button>
          </form>

          <!-- Footer: acceso solo por invitación (17-nov-2026) -->
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e9bcb6;text-align:center">
            <p style="font-size:13px;color:#5c5f61">El acceso es solo por invitación. Si necesita una cuenta, solicítela al administrador de la plataforma.</p>
          </div>
        </div>
      </div>
    </div>

    <style>
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  `;let t="funcionario";const e=document.getElementById("tab-funcionario"),o=document.getElementById("tab-proveedor"),a=document.getElementById("login-email-label"),n=document.getElementById("login-email");function i(u){t=u;const l=m=>{m.style.background="white",m.style.color="#b5000b",m.style.boxShadow="0 1px 4px rgba(0,0,0,0.12)"},p=m=>{m.style.background="transparent",m.style.color="#5c5f61",m.style.boxShadow="none"};u==="funcionario"?(l(e),p(o),a.textContent="Correo Corporativo",n.placeholder="usuario@ebema.cl"):(l(o),p(e),a.textContent="Correo del Proveedor",n.placeholder="contacto@suempresa.cl")}e.addEventListener("click",()=>i("funcionario")),o.addEventListener("click",()=>i("proveedor")),document.getElementById("toggle-login-pass").addEventListener("click",()=>{const u=document.getElementById("login-password"),l=document.querySelector("#toggle-login-pass .material-symbols-outlined");u.type==="password"?(u.type="text",l.textContent="visibility_off"):(u.type="password",l.textContent="visibility")}),document.getElementById("link-go-recover").addEventListener("click",()=>{y="recover",E()});const s=document.getElementById("login-form"),r=document.getElementById("login-error-alert"),c=document.getElementById("login-error-text");s.addEventListener("submit",async u=>{u.preventDefault();const l=document.getElementById("login-email").value.trim().toLowerCase(),p=document.getElementById("login-password").value,m=document.getElementById("btn-login-submit");m.innerHTML='<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Verificando...',m.disabled=!0;const b=A=>{c.innerText=A,r.style.display="flex",r.classList.remove("hidden"),m.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">login</span> Iniciar Sesión',m.disabled=!1};if(t==="funcionario"&&!l.endsWith("@ebema.cl"))return b("Acceso restringido. Utilice su correo corporativo @ebema.cl");if(t==="proveedor"&&l.endsWith("@ebema.cl"))return b('Los funcionarios EBEMA deben usar la pestaña "Funcionarios EBEMA".');const{error:P}=await f.auth.signInWithPassword({email:l,password:p});if(P){const A=(P.message||"").toLowerCase();return A.includes("invalid login credentials")?b("Correo o contraseña incorrectos."):A.includes("email not confirmed")?b("Debe confirmar su correo. Revise su bandeja de entrada."):b("No se pudo iniciar sesión: "+P.message)}if(await $(),!d)return b("No se pudo cargar su perfil. Intente nuevamente.");x(`Bienvenido, ${d.name}`),C(),V()})}function it(t){I.innerHTML=`
    <div class="min-h-screen flex items-center justify-center bg-background">
      <div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm text-center">

        <div class="flex items-center justify-center gap-sm mb-md">
          <div style="width:36px;height:36px;background:#b5000b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:white">E</div>
          <div style="text-align:left">
            <div class="font-bold text-primary text-lg leading-none">SIT EBEMA</div>
            <div class="text-xs text-secondary">Verificación de seguridad</div>
          </div>
        </div>

        <span class="material-symbols-outlined text-primary" style="font-size:48px">mark_email_read</span>
        <h2 class="font-bold text-headline-sm mt-xs mb-xs">Doble verificación</h2>
        <p class="text-sm text-secondary mb-md">
          Ingresa el código de <strong>6 dígitos</strong> enviado a<br/>
          <strong>${t.user.email}</strong>
        </p>

        <input id="otp-code" type="text" maxlength="6" inputmode="numeric" autocomplete="one-time-code"
          placeholder="· · · · · ·"
          class="border-2 border-outline-variant rounded-lg text-center text-3xl font-data-mono tracking-[0.4em] w-44 py-sm mx-auto block focus:outline-none focus:border-primary transition-colors"/>

        <div id="otp-error" class="hidden mt-sm bg-error-container text-on-error-container text-xs p-sm rounded mx-auto w-44"></div>

        <button id="btn-verify-otp"
          class="bg-primary hover:bg-[#930007] text-white rounded px-md py-sm text-sm font-bold mt-md w-full flex items-center justify-center gap-xs transition-colors">
          <span class="material-symbols-outlined text-[16px]">verified_user</span>
          Verificar y entrar
        </button>

        <div class="mt-md border-t border-outline-variant pt-sm">
          <p class="text-xs text-secondary">¿No recibiste el código?</p>
          <button id="btn-resend-otp" class="text-primary text-xs font-bold underline mt-xs hover:text-[#930007]">
            Reenviar código
          </button>
          <span id="resend-timer" class="text-secondary text-xs ml-xs hidden">(espera <span id="resend-sec">60</span>s)</span>
        </div>

        <button id="btn-mfa-back" class="text-secondary text-xs mt-sm underline block mx-auto hover:text-on-surface">
          Volver al inicio de sesión
        </button>
      </div>
    </div>`;const e=document.getElementById("otp-code");e.focus(),e.addEventListener("input",()=>{e.value=e.value.replace(/\D/g,"").slice(0,6)}),e.addEventListener("keydown",n=>{n.key==="Enter"&&document.getElementById("btn-verify-otp").click()});let o=null;const a=()=>{const n=document.getElementById("resend-timer"),i=document.getElementById("resend-sec"),s=document.getElementById("btn-resend-otp");let r=60;s.disabled=!0,s.classList.add("opacity-40","cursor-default"),n.classList.remove("hidden"),o=setInterval(()=>{r--,i&&(i.textContent=r),r<=0&&(clearInterval(o),n.classList.add("hidden"),s.disabled=!1,s.classList.remove("opacity-40","cursor-default"))},1e3)};a(),document.getElementById("btn-verify-otp").addEventListener("click",async()=>{const n=e.value.trim(),i=document.getElementById("otp-error"),s=document.getElementById("btn-verify-otp");if(i.classList.add("hidden"),n.length!==6){i.textContent="Ingresa el código completo de 6 dígitos.",i.classList.remove("hidden");return}s.disabled=!0,s.innerHTML='<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Verificando...';try{const r=await f.functions.invoke("verify-mfa-code",{body:{code:n},headers:{Authorization:`Bearer ${t.access_token}`}});if(r.error||!r.data?.verified){const c=r.data?.error||"Código incorrecto. Intente de nuevo.";i.textContent=c,i.classList.remove("hidden"),s.disabled=!1,s.innerHTML='<span class="material-symbols-outlined text-[16px]">verified_user</span> Verificar y entrar',e.value="",e.focus();return}if(await $(),!d){i.textContent="No se pudo cargar su perfil. Recargue e intente de nuevo.",i.classList.remove("hidden"),s.disabled=!1,s.innerHTML='<span class="material-symbols-outlined text-[16px]">verified_user</span> Verificar y entrar';return}x(`Bienvenido, ${d.name}`),C(),V()}catch{i.textContent="Error de conexión. Intente nuevamente.",i.classList.remove("hidden"),s.disabled=!1,s.innerHTML='<span class="material-symbols-outlined text-[16px]">verified_user</span> Verificar y entrar'}}),document.getElementById("btn-resend-otp").addEventListener("click",async()=>{const n=document.getElementById("otp-error");n.classList.add("hidden");try{const i=await f.functions.invoke("send-mfa-code",{headers:{Authorization:`Bearer ${t.access_token}`}});if(i.error)throw new Error(i.error.message);x("Nuevo código enviado a tu correo."),a()}catch(i){n.textContent="No se pudo reenviar el código: "+i.message,n.classList.remove("hidden")}}),document.getElementById("btn-mfa-back").addEventListener("click",async()=>{o&&clearInterval(o),await f.auth.signOut(),d=null,y="login",E()})}function at(){I.innerHTML=`
    <div class="min-h-screen flex" style="background:#f8f9fa">

      <!-- Panel Izquierdo: Branding -->
      <div class="hidden lg:flex flex-col justify-between w-2/5 p-12 relative overflow-hidden" style="background:linear-gradient(145deg,#8b0000 0%,#b5000b 45%,#d40010 80%,#ff1a24 100%)">
        <div style="position:absolute;inset:0;background-image:radial-gradient(circle at 20% 80%, rgba(255,255,255,0.06) 0%, transparent 50%),radial-gradient(circle at 80% 20%, rgba(255,255,255,0.04) 0%, transparent 50%);pointer-events:none"></div>
        <div style="position:absolute;bottom:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>

        <div style="position:relative;z-index:2">
          <div style="display:inline-flex;align-items:center;gap:12px;margin-bottom:48px">
            <div style="width:48px;height:48px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white">E</div>
            <div>
              <div style="color:white;font-weight:800;font-size:18px;line-height:1.1">SIT EBEMA</div>
              <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.08em;text-transform:uppercase">Sistema Integrado de Transporte</div>
            </div>
          </div>

          <h2 style="color:white;font-size:32px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;margin-bottom:16px">Regístrese como<br/>Proveedor de Servicio</h2>
          <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.6;max-width:300px">Cree la cuenta de su empresa de transportes para gestionar la documentación de su flota con EBEMA.</p>
        </div>

        <!-- Pasos del proceso -->
        <div style="position:relative;z-index:2">
          <p style="color:rgba(255,255,255,0.55);font-size:11px;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:16px">Proceso de registro</p>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:28px;height:28px;background:#b5000b;border:2px solid rgba(255,255,255,0.8);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700">1</div>
              <span style="color:white;font-size:13px">Completar datos corporativos</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:28px;height:28px;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:12px;font-weight:700">2</div>
              <span style="color:rgba(255,255,255,0.6);font-size:13px">Aprobación por administrador</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:28px;height:28px;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:12px;font-weight:700">3</div>
              <span style="color:rgba(255,255,255,0.6);font-size:13px">Acceso al sistema habilitado</span>
            </div>
          </div>
          <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:24px">© 2026 EBEMA Chile — Solo dominio @ebema.cl</p>
        </div>
      </div>

      <!-- Panel Derecho: Formulario de Registro -->
      <div class="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <div style="width:100%;max-width:440px;animation:slideUp 0.4s ease-out">

          <!-- Header -->
          <div style="margin-bottom:32px">
            <button id="link-back-login" style="display:inline-flex;align-items:center;gap:6px;color:#5c5f61;background:none;border:none;cursor:pointer;font-size:13px;margin-bottom:20px;padding:0" onmouseover="this.style.color='#b5000b'" onmouseout="this.style.color='#5c5f61'">
              <span class="material-symbols-outlined" style="font-size:16px">arrow_back</span>
              Volver al Login
            </button>
            <h1 style="font-size:26px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:6px">Regístrate como Proveedor de Servicio</h1>
            <p style="color:#5c5f61;font-size:14px">Complete los datos de su empresa de transportes.</p>
          </div>

          <!-- Alerta de error -->
          <div id="register-error-alert" style="display:none;align-items:center;gap:8px;padding:10px 14px;background:#ffdad6;border:1px solid rgba(186,26,26,0.2);border-radius:8px;margin-bottom:20px;font-size:13px;color:#93000a">
            <span class="material-symbols-outlined" style="font-size:16px">error</span>
            <span id="register-error-text"></span>
          </div>

          <!-- Formulario -->
          <form id="register-form" style="display:flex;flex-direction:column;gap:16px">
            <!-- Razón Social -->
            <div>
              <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Razón Social</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">business</span>
                <input type="text" id="reg-razonsocial" placeholder="Ej. Transportes del Sur Ltda." required maxlength="120"
                  style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
              </div>
            </div>

            <!-- RUT y Teléfono -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">RUT Empresa</label>
                <div style="position:relative">
                  <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">pin</span>
                  <input type="text" id="reg-rut" placeholder="76.123.456-7" required
                    style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                    onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
                </div>
              </div>
              <div>
                <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Teléfono</label>
                <div style="position:relative">
                  <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">call</span>
                  <input type="tel" id="reg-telefono" placeholder="+56 9 1234 5678" required maxlength="30"
                    style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                    onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
                </div>
              </div>
            </div>

            <!-- Representante Legal -->
            <div>
              <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Nombre Representante Legal</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">person</span>
                <input type="text" id="reg-representante" placeholder="Ej. Juan Pérez Soto" required maxlength="80"
                  style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
              </div>
            </div>

            <!-- Email -->
            <div>
              <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Correo de Contacto</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">mail</span>
                <input type="email" id="reg-email" placeholder="contacto@suempresa.cl" required
                  style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
              </div>
            </div>

            <!-- Contraseña con indicador -->
            <div>
              <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Contraseña</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">lock</span>
                <input type="password" id="reg-password" placeholder="Mínimo 6 caracteres" required
                  style="width:100%;padding:12px 40px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
                <button type="button" id="toggle-reg-pass" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#5c5f61;display:flex;align-items:center">
                  <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
                </button>
              </div>
              <!-- Indicador de fuerza -->
              <div style="margin-top:8px">
                <div style="display:flex;gap:4px;margin-bottom:4px">
                  <div id="str-bar-1" style="height:3px;flex:1;border-radius:2px;background:#e1e3e4;transition:background 0.3s"></div>
                  <div id="str-bar-2" style="height:3px;flex:1;border-radius:2px;background:#e1e3e4;transition:background 0.3s"></div>
                  <div id="str-bar-3" style="height:3px;flex:1;border-radius:2px;background:#e1e3e4;transition:background 0.3s"></div>
                  <div id="str-bar-4" style="height:3px;flex:1;border-radius:2px;background:#e1e3e4;transition:background 0.3s"></div>
                </div>
                <p id="str-label" style="font-size:11px;color:#5c5f61">Ingrese una contraseña</p>
              </div>
            </div>

            <!-- Confirmar Contraseña -->
            <div>
              <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Confirmar Contraseña</label>
              <div style="position:relative">
                <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">lock_reset</span>
                <input type="password" id="reg-confirm" placeholder="Repita su contraseña" required
                  style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                  onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
              </div>
            </div>

            <button type="submit" id="btn-reg-submit"
              style="width:100%;padding:13px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:background 0.2s,transform 0.1s;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px"
              onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'"
              onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'"
            >
              <span class="material-symbols-outlined" style="font-size:18px">person_add</span>
              Crear Cuenta de Proveedor
            </button>
          </form>

          <!-- Footer -->
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e9bcb6;text-align:center">
            <p style="font-size:13px;color:#5c5f61">¿Ya tiene cuenta? <button id="link-back-login-footer" style="color:#b5000b;background:none;border:none;cursor:pointer;font-weight:700;font-size:13px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Iniciar Sesión</button></p>
          </div>
        </div>
      </div>
    </div>

    <style>
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  `,document.getElementById("toggle-reg-pass").addEventListener("click",()=>{const o=document.getElementById("reg-password"),a=document.querySelector("#toggle-reg-pass .material-symbols-outlined");o.type=o.type==="password"?"text":"password",a.textContent=o.type==="password"?"visibility":"visibility_off"}),document.getElementById("reg-password").addEventListener("input",o=>{const a=o.target.value,n=[1,2,3,4].map(u=>document.getElementById(`str-bar-${u}`)),i=document.getElementById("str-label");let s=0;a.length>=6&&s++,a.length>=10&&s++,/[A-Z]/.test(a)&&/[0-9]/.test(a)&&s++,/[^A-Za-z0-9]/.test(a)&&s++;const r=["#ba1a1a","#f59e0b","#10b981","#059669"],c=["Muy débil","Débil","Buena","Excelente"];n.forEach((u,l)=>{u.style.background=l<s?r[s-1]:"#e1e3e4"}),i.textContent=a.length===0?"Ingrese una contraseña":c[s-1]||"Muy débil",i.style.color=s>0?r[s-1]:"#5c5f61"}),["link-back-login","link-back-login-footer"].forEach(o=>{const a=document.getElementById(o);a&&a.addEventListener("click",()=>{y="login",E()})});const t=document.getElementById("register-error-alert"),e=document.getElementById("register-error-text");document.getElementById("reg-rut").addEventListener("blur",o=>{o.target.value=J(o.target.value)}),document.getElementById("reg-telefono").addEventListener("blur",o=>{o.target.value.trim()&&(o.target.value=N(o.target.value))}),document.getElementById("register-form").addEventListener("submit",async o=>{o.preventDefault();const a=document.getElementById("reg-razonsocial").value.trim(),n=J(document.getElementById("reg-rut").value.trim()),i=N(document.getElementById("reg-telefono").value.trim()),s=document.getElementById("reg-representante").value.trim(),r=document.getElementById("reg-email").value.trim().toLowerCase(),c=document.getElementById("reg-password").value,u=document.getElementById("reg-confirm").value,l=document.getElementById("btn-reg-submit"),p=b=>{e.innerText=b,t.style.display="flex",l.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">person_add</span> Crear Cuenta de Proveedor',l.disabled=!1};if(r.endsWith("@ebema.cl"))return p("Este registro es solo para proveedores externos. Los funcionarios EBEMA ingresan con su correo corporativo en la pestaña Funcionarios EBEMA.");if(!Ee(n))return p("El RUT de la empresa no es válido");if(c.length<6)return p("La contraseña debe tener mínimo 6 caracteres");if(c!==u)return p("Las contraseñas no coinciden");l.innerHTML='<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Creando cuenta...',l.disabled=!0;const{error:m}=await f.auth.signUp({email:r,password:c,options:{data:{tipo:"proveedor",razonSocial:a,rut:n,telefono:i,representante:s}}});if(m)return(m.message||"").toLowerCase().includes("already registered")?p("El correo ya se encuentra registrado"):p("No se pudo crear la cuenta: "+m.message);x("Cuenta creada. Revise su correo para confirmar la cuenta antes de iniciar sesión."),y="login",E()})}function Be(){I.innerHTML=`
    <div class="min-h-screen flex" style="background:#f8f9fa">

      <!-- Panel Izquierdo: Branding -->
      <div class="hidden lg:flex flex-col justify-between w-2/5 p-12 relative overflow-hidden" style="background:linear-gradient(145deg,#8b0000 0%,#b5000b 45%,#d40010 80%,#ff1a24 100%)">
        <div style="position:absolute;inset:0;background-image:radial-gradient(circle at 20% 80%, rgba(255,255,255,0.06) 0%, transparent 50%),radial-gradient(circle at 80% 20%, rgba(255,255,255,0.04) 0%, transparent 50%);pointer-events:none"></div>
        <div style="position:absolute;bottom:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>

        <div style="position:relative;z-index:2">
          <div style="display:inline-flex;align-items:center;gap:12px;margin-bottom:48px">
            <div style="width:48px;height:48px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white">E</div>
            <div>
              <div style="color:white;font-weight:800;font-size:18px;line-height:1.1">SIT EBEMA</div>
              <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:0.08em;text-transform:uppercase">Sistema Integrado de Transporte</div>
            </div>
          </div>

          <h2 style="color:white;font-size:32px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;margin-bottom:16px">Recupere<br/>su acceso</h2>
          <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.6;max-width:300px">Ingrese su correo corporativo y recibirá instrucciones para restablecer su contraseña en minutos.</p>
        </div>

        <!-- Instrucciones del proceso -->
        <div style="position:relative;z-index:2">
          <p style="color:rgba(255,255,255,0.55);font-size:11px;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:16px">¿Cómo funciona?</p>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="min-width:28px;height:28px;background:rgba(255,255,255,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center">
                <span class="material-symbols-outlined" style="color:white;font-size:14px">mail</span>
              </div>
              <div>
                <p style="color:white;font-size:13px;font-weight:600;margin-bottom:2px">Ingrese su correo</p>
                <p style="color:rgba(255,255,255,0.55);font-size:12px">Use su dirección @ebema.cl corporativa</p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="min-width:28px;height:28px;background:rgba(255,255,255,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center">
                <span class="material-symbols-outlined" style="color:white;font-size:14px">mark_email_read</span>
              </div>
              <div>
                <p style="color:white;font-size:13px;font-weight:600;margin-bottom:2px">Revise su bandeja</p>
                <p style="color:rgba(255,255,255,0.55);font-size:12px">Le enviaremos un enlace seguro</p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="min-width:28px;height:28px;background:rgba(255,255,255,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center">
                <span class="material-symbols-outlined" style="color:white;font-size:14px">lock_open</span>
              </div>
              <div>
                <p style="color:white;font-size:13px;font-weight:600;margin-bottom:2px">Restablezca su clave</p>
                <p style="color:rgba(255,255,255,0.55);font-size:12px">Cree una nueva contraseña segura</p>
              </div>
            </div>
          </div>
          <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:24px">© 2026 EBEMA Chile — Acceso restringido</p>
        </div>
      </div>

      <!-- Panel Derecho: Formulario de Recuperación -->
      <div class="flex-1 flex items-center justify-center p-8">
        <div style="width:100%;max-width:420px;animation:slideUp 0.4s ease-out">

          <!-- Estado: Formulario -->
          <div id="recover-step-form">
            <div style="margin-bottom:32px">
              <button id="link-back-login" style="display:inline-flex;align-items:center;gap:6px;color:#5c5f61;background:none;border:none;cursor:pointer;font-size:13px;margin-bottom:20px;padding:0" onmouseover="this.style.color='#b5000b'" onmouseout="this.style.color='#5c5f61'">
                <span class="material-symbols-outlined" style="font-size:16px">arrow_back</span>
                Volver al Login
              </button>

              <div style="width:52px;height:52px;background:#ffdad5;border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:20px">
                <span class="material-symbols-outlined" style="color:#b5000b;font-size:28px">lock_reset</span>
              </div>

              <h1 style="font-size:26px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:6px">Recuperar Contraseña</h1>
              <p style="color:#5c5f61;font-size:14px">Ingrese su correo corporativo para recibir el enlace de restablecimiento.</p>
            </div>

            <form id="recover-form" style="display:flex;flex-direction:column;gap:18px">
              <div>
                <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Correo Corporativo</label>
                <div style="position:relative">
                  <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:18px;pointer-events:none">mail</span>
                  <input type="email" id="recover-email" placeholder="usuario@ebema.cl" required
                    style="width:100%;padding:12px 12px 12px 40px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;transition:border-color 0.2s;box-sizing:border-box"
                    onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
                </div>
              </div>

              <button type="submit" id="btn-recover-submit"
                style="width:100%;padding:13px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:background 0.2s;display:flex;align-items:center;justify-content:center;gap:8px"
                onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'"
              >
                <span class="material-symbols-outlined" style="font-size:18px">send</span>
                Enviar Instrucciones
              </button>
            </form>
          </div>

          <!-- Estado: Éxito (oculto inicialmente) -->
          <div id="recover-step-success" style="display:none;text-align:center;animation:slideUp 0.4s ease-out">
            <div style="width:72px;height:72px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px">
              <span class="material-symbols-outlined" style="color:#16a34a;font-size:36px">mark_email_read</span>
            </div>
            <h2 style="font-size:22px;font-weight:800;color:#191c1d;margin-bottom:10px">¡Correo enviado!</h2>
            <p style="color:#5c5f61;font-size:14px;line-height:1.6;margin-bottom:28px">Hemos enviado las instrucciones de recuperación a <strong id="recover-email-display"></strong>. Revise su bandeja de entrada.</p>
            <div style="padding:14px;background:#f3f4f5;border-radius:8px;margin-bottom:24px;text-align:left">
              <p style="font-size:12px;color:#5c5f61;display:flex;align-items:flex-start;gap:8px">
                <span class="material-symbols-outlined" style="font-size:16px;color:#b5000b;flex-shrink:0;margin-top:1px">info</span>
                Si no recibe el correo en 5 minutos, revise la carpeta de spam o contacte al administrador del sistema.
              </p>
            </div>
            <button id="btn-go-login" style="width:100%;padding:12px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'">
              <span class="material-symbols-outlined" style="font-size:16px">login</span>
              Volver al Inicio de Sesión
            </button>
          </div>

        </div>
      </div>
    </div>

    <style>
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
  `,document.getElementById("link-back-login").addEventListener("click",()=>{y="login",E()}),document.getElementById("btn-go-login")?.addEventListener("click",()=>{y="login",E()}),document.getElementById("recover-form").addEventListener("submit",async t=>{t.preventDefault();const e=document.getElementById("recover-email").value.trim().toLowerCase(),o=document.getElementById("btn-recover-submit");if(!e.endsWith("@ebema.cl")){x("El correo debe ser de dominio corporativo @ebema.cl","error");return}o.innerHTML='<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Enviando...',o.disabled=!0;const{error:a}=await f.auth.resetPasswordForEmail(e,{redirectTo:window.location.origin+window.location.pathname});if(a){x("No se pudo enviar el correo: "+a.message,"error"),o.innerHTML="Enviar instrucciones",o.disabled=!1;return}document.getElementById("recover-step-form").style.display="none";const n=document.getElementById("recover-step-success");n.style.display="block",document.getElementById("recover-email-display").textContent=e,document.getElementById("btn-go-login").addEventListener("click",()=>{y="login",E()})})}function ee(t){return h(t.group||t.tab)}function Te(t,e){return h(t.group,e.sub)}const Ae=Object.fromEntries(Object.entries(ke).map(([t,e])=>[t,e.label])),_=[{tab:"home",icon:"home",label:"Home"},{tab:"rates",icon:"payments",label:"Cotizador Despacho"},{group:"proveedores",icon:"groups",label:"Proveedores",children:[{tab:"abastecimiento",sub:"proveedores",icon:"factory",label:"Proveedores (Fábricas)"}]},{group:"socios-negocios",icon:"handshake",label:"Socios de Negocios",children:[{tab:"transports",sub:"transportistas",icon:"badge",label:"Transportistas"},{tab:"transports",sub:"flota",icon:"local_shipping",label:"Flota Camiones"},{tab:"transports",sub:"conductores",icon:"person",label:"Conductores"},{tab:"maestro-obras",sub:"obras",icon:"apartment",label:"Obras"},{tab:"maestro-obras",sub:"clientes",icon:"groups",label:"Clientes"}]},{group:"productos",icon:"inventory",label:"Productos",children:[{tab:"productos",sub:"maestro",icon:"inventory",label:"Maestro de Productos"}]},{group:"rutas",icon:"route",label:"Rutas de Transporte",children:[{tab:"routes",sub:"centros",icon:"location_on",label:"Centros Logisticos"},{tab:"routes",sub:"rutas",icon:"route",label:"Rutas"},{tab:"routes",sub:"zonas",icon:"map",label:"Zonas de Transportes"}]},{group:"tarifas-transporte",icon:"calculate",label:"Tarifas Transporte",children:[{tab:"tarifas-transporte",sub:"peajes",icon:"toll",label:"Peajes"},{tab:"tarifas-transporte",sub:"combustibles",icon:"local_gas_station",label:"Combustibles y Rendimientos"},{tab:"tarifas-transporte",sub:"seguros",icon:"shield",label:"Seguros y Permisos"},{tab:"tarifas-transporte",sub:"costos-extras",icon:"add_circle",label:"Costos Extras"},{tab:"tarifas-transporte",sub:"variables",icon:"tune",label:"Variables Generales"},{tab:"tarifas-transporte",sub:"resultados",icon:"speed",label:"Motor de Costos"},{tab:"tarifas-transporte",sub:"reajuste",icon:"percent",label:"Reajuste Polinómico"},{tab:"tarifas-transporte",sub:"camiones",icon:"local_shipping",label:"Tarifas por Camion"},{tab:"tarifas-transporte",sub:"zcap",icon:"table_chart",label:"Tarifas Rutas"},{tab:"tarifas-transporte",sub:"variacion",icon:"difference",label:"Variación Tarifa"}]},{group:"tarifas-clientes",icon:"request_quote",label:"Tarifas Clientes",children:[{tab:"tarifas-clientes",sub:"historico",icon:"history",label:"Historico (6M)"},{tab:"tarifas-clientes",sub:"consolidacion",icon:"inventory",label:"Consolidacion"},{tab:"tarifas-clientes",sub:"densidad",icon:"location_on",label:"Densidad Logistica"},{tab:"tarifas-clientes",sub:"especiales",icon:"star",label:"Frecuencia y Especiales"},{tab:"tarifas-clientes",sub:"cluster",icon:"map",label:"Cluster"},{tab:"tarifas-clientes",sub:"zfmp",icon:"request_quote",label:"Tarifas $/Kg"},{tab:"tarifas-clientes",sub:"zfmi",icon:"request_quote",label:"Tarifa Min/Max"},{tab:"tarifas-clientes",sub:"retiro",icon:"swap_horiz",label:"Tarifas Retiro Retorno"},{tab:"tarifas-clientes",sub:"ebemaclick",icon:"shopping_cart",label:"Tarifas EbemaClick"}]},{group:"abastecimiento",icon:"inventory_2",label:"Gestión Troncales",children:[{tab:"abastecimiento",sub:"calendario",icon:"calendar_month",label:"Calendario Sucursales"},{tab:"abastecimiento",sub:"pedidos_traslados_revex",icon:"recycling",label:"Revex"},{tab:"abastecimiento",sub:"pedidos_venta",icon:"sell",label:"Ventas CD (1003)"},{tab:"abastecimiento",sub:"retiros",icon:"factory",label:"Retiros de Fábrica"},{tab:"abastecimiento",sub:"pedidos_traslados_4000",icon:"local_shipping",label:"Crossdocking"},{tab:"abastecimiento",sub:"pedidos_traslados",icon:"swap_horiz",label:"Pedidos de Traslados"},{tab:"abastecimiento",sub:"plan_carga",icon:"local_shipping",label:"Plan de Carga"},{tab:"abastecimiento",sub:"seguimiento_carga",icon:"fact_check",label:"Seguimiento de Carga"},{tab:"abastecimiento",sub:"ind_plan_carga",icon:"insights",label:"Indicadores Plan de Carga"}]},{group:"indicadores",icon:"monitoring",label:"Indicadores",children:[{tab:"indicadores",sub:"consolidado",icon:"dashboard",label:"Consolidado"},{tab:"indicadores",sub:"nivel",icon:"local_shipping",label:"Nivel de Servicio"},{tab:"indicadores",sub:"tarifa",icon:"request_quote",label:"Tarifa $/Kg"},{tab:"indicadores",sub:"margen",icon:"trending_down",label:"Margen de Flete"},{tab:"indicadores",sub:"despachos",icon:"receipt_long",label:"Detalle por Despacho"},{tab:"indicadores",sub:"transportistas",icon:"local_shipping",label:"Pagado Transportistas"}]},{group:"flete-tercero",icon:"local_shipping",label:"Flete Tercero",children:[{tab:"flete-tercero",sub:"dashboard",icon:"monitoring",label:"Nivel de Servicio"},{tab:"flete-tercero",sub:"seguimiento",icon:"search",label:"Seguimiento por Pedido"},{tab:"flete-tercero",sub:"vencidos",icon:"event_busy",label:"Pedidos Vencidos"},{tab:"flete-tercero",sub:"en_curso",icon:"pending_actions",label:"Pedidos en Curso"}]},{group:"monitor-consolidacion",icon:"cell_tower",label:"Torre de Control",children:[{tab:"monitor-consolidacion",sub:"mapa",icon:"map",label:"Monitor de Pedidos"}]},{group:"porteria",icon:"door_front",label:"Portería",children:[{tab:"porteria",sub:"registro",icon:"timer",label:"Control Puerta"},{tab:"porteria",sub:"alertas",icon:"notifications_active",label:"Monitor de Operaciones"},{tab:"porteria",sub:"indicadores",icon:"insights",label:"Indicadores de Portería"}]},{tab:"roles",icon:"admin_panel_settings",label:"Roles y Perfiles"}],$e={transports:{transportistas:null,flota:null,conductores:null},"tarifas-clientes":{zfmp:"resultados",zfmi:"zfmi"}},te={"abastecimiento:plan_carga":2,"abastecimiento:seguimiento_carga":3},oe=t=>`<b title="Paso ${t} del flujo de Gestión Troncales" style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;margin-right:6px;border-radius:50%;background:#e1e3e4;color:#444749;font-size:10px;font-weight:800;line-height:1;vertical-align:middle">${t}</b>`,Me=t=>{const e=Number((window.__sitPendMenu||{})[t])||0;return`<span data-pend-menu="${t}" title="Pendientes de la vista (último cálculo)" style="display:${e?"inline-flex":"none"};align-items:center;justify-content:center;min-width:18px;height:16px;padding:0 5px;border-radius:8px;background:#b5000b;color:#fff;font-size:10px;font-weight:800;line-height:1;flex:none">${e||""}</span>`},se=[{tab:"home"},{tab:"rates"},{key:"troncales",icon:"inventory_2",label:"Gestión Troncales",sections:[{label:"Configuraciones",group:"abastecimiento",collapsible:!0,subs:["calendario"]},{label:"Orden de Carga",paso:1,group:"abastecimiento",subs:["pedidos_traslados_revex","pedidos_venta","retiros","pedidos_traslados_4000","pedidos_traslados"]},{label:"Planificación",group:"abastecimiento",subs:["plan_carga","seguimiento_carga","ind_plan_carga"]}]},{key:"distribucion",icon:"cell_tower",label:"Torre de Control",sections:[{label:"Monitor de Pedidos",group:"monitor-consolidacion"},{label:"Gestión de Recursos",sublabel:"Socios de Negocios",group:"socios-negocios"}]},{key:"porteria",icon:"door_front",label:"Portería",sections:[{label:"CD Quilicura",group:"porteria"}]},{key:"flete",icon:"local_shipping",label:"Flete Tercero",sections:[{label:"Seguimiento",group:"flete-tercero"}]},{key:"ind",icon:"monitoring",label:"Indicadores",sections:[{label:"Reportes",group:"indicadores"}]},{key:"tarifas",icon:"calculate",label:"Tarifas",sections:[{label:"Transporte",group:"tarifas-transporte"},{label:"Clientes",group:"tarifas-clientes"}]},{key:"maestros",icon:"groups",label:"Maestros",sections:[{label:"Proveedores",group:"proveedores"},{label:"Rutas",group:"rutas"},{label:"Productos",group:"productos"}]},{tab:"roles"}],ie=["abastecimiento:plan_carga","abastecimiento:calendario","abastecimiento:ind_plan_carga"],ae="sit_nav_favs",ne="sit_nav_collapsed",O="sit_nav_sect_closed";function M(t,e){try{const o=localStorage.getItem(t);return o==null?e:JSON.parse(o)}catch{return e}}function U(t,e){try{localStorage.setItem(t,JSON.stringify(e))}catch{}}const g=t=>String(t??"").replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function j(){const t=[];return se.forEach(e=>{if(e.tab){const o=_.find(a=>!a.group&&a.tab===e.tab);o&&ee(o)&&t.push({key:o.tab,tab:o.tab,sub:null,label:o.label,icon:o.icon,modulo:o.label,seccion:""});return}e.sections.forEach(o=>{const a=_.find(i=>i.group===o.group);if(!a||!ee(a))return;(o.subs?o.subs.map(i=>a.children.find(s=>s.sub===i)).filter(Boolean):a.children).filter(i=>Te(a,i)).forEach(i=>t.push({key:`${i.tab}:${i.sub}`,tab:i.tab,sub:i.sub,label:i.label,icon:i.icon,modulo:e.label,seccion:o.sublabel?`${o.label} › ${o.sublabel}`:o.label,modKey:e.key,secLabel:o.label}))})}),t}function re(){const t=j(),e=M(ae,ie);return(Array.isArray(e)?e:ie).map(o=>t.find(a=>a.key===o)).filter(Boolean)}function je(t,e){const o=j(),a=o.find(n=>n.tab===t&&(e?n.sub===e:!n.sub));if(!a){const n=o.find(i=>i.tab===t);return{path:[],last:n?n.modulo:""}}return a.sub?{path:[a.modulo,a.seccion].filter(Boolean),last:a.label}:{path:[],last:a.label}}function le(){const t=j(),e=re(),o=new Set(e.map(s=>s.key)),a=new Set(M(O,[])),n=e.length?`
    <div class="sv-navsec" id="sv-favs">
      <div class="sv-navlbl sv-hide-c">Favoritos</div>
      ${e.map(s=>`<a class="sv-item sv-fav" data-fav-tab="${s.tab}" ${s.sub?`data-fav-sub="${s.sub}"`:""} title="${g(s.label)}">
        <span class="material-symbols-outlined">${s.icon}</span><span class="sv-hide-c">${g(s.label)}</span></a>`).join("")}
    </div>`:"",i=se.map(s=>{if(s.tab){const c=t.find(u=>u.tab===s.tab&&!u.sub);return c?`<a class="sv-item sidebar-item" data-tab="${c.tab}" id="nav-${c.tab}" title="${g(c.label)}">
        <span class="material-symbols-outlined">${c.icon}</span><span class="sv-hide-c">${g(c.label)}</span></a>`:""}const r=s.sections.map(c=>{const u=t.filter(b=>b.modKey===s.key&&b.secLabel===c.label);if(!u.length)return"";const l=`${s.key}|${c.label}`,p=c.collapsible!==!1,m=p&&a.has(l);return`<div class="sv-sectwrap">
        <div class="sv-sect ${p?"is-coll":""} ${m?"is-closed":""}" ${p?`data-sect="${g(l)}"`:""}>
          <span>${c.paso?oe(c.paso):""}${g(c.label)}${p?`<small class="sv-sect-n"> · ${u.length}</small>`:""}</span>${p?'<span class="material-symbols-outlined">expand_more</span>':""}</div>
        <div class="sv-sectbody ${m?"hidden":""}">
          ${c.sublabel?`<div class="sv-sub sv-hide-c" style="margin:4px 0 2px 14px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5c5f61;display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px">handshake</span>${g(c.sublabel)}</div>`:""}
          ${u.map(b=>`<a class="sv-child sidebar-item" data-tab="${b.tab}" data-sub="${b.sub}" title="${g(b.label)}">
            <span class="sv-lbl">${te[b.key]?oe(te[b.key]):""}${g(b.label)}</span>${b.tab==="abastecimiento"?Me(b.sub):""}
            <button class="sv-star ${o.has(b.key)?"is-on":""}" data-star="${b.key}" data-ro-ok title="${o.has(b.key)?"Quitar de favoritos":"Agregar a favoritos"}"><span class="material-symbols-outlined">star</span></button>
          </a>`).join("")}
        </div></div>`}).join("");return r.trim()?`<div class="sv-group" data-mod="${s.key}">
      <a class="sv-item sv-group-toggle" title="${g(s.label)}">
        <span class="material-symbols-outlined">${s.icon}</span><span class="sv-hide-c" style="flex:1">${g(s.label)}</span>
        <span class="material-symbols-outlined sv-chev sv-hide-c">expand_more</span></a>
      <div class="sv-kids hidden">${r}</div></div>`:""}).join("");return`${n}
    <div class="sv-navsec"><div class="sv-navlbl sv-hide-c">Módulos</div>${i}</div>`}function de(){if(document.querySelector(".sv-pal-bg"))return;const t=j(),e=l=>String(l||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase(),o=document.createElement("div");o.className="sv-pal-bg",o.innerHTML=`<div class="sv-pal" role="dialog" aria-label="Ir a una vista">
    <div class="sv-pal-in"><span class="material-symbols-outlined">search</span><input placeholder="Ir a una vista…" aria-label="Buscar vista"/><span class="sv-kbd">Esc</span></div>
    <div class="sv-pal-list"></div></div>`,document.body.appendChild(o);const a=o.querySelector("input"),n=o.querySelector(".sv-pal-list");let i=0,s=t;const r=()=>o.remove(),c=l=>{r(),l&&z(l.tab,l.sub)},u=()=>{const l=e(a.value.trim());s=l?t.filter(p=>e(`${p.label} ${p.modulo} ${p.seccion}`).includes(l)):t,i>=s.length&&(i=Math.max(0,s.length-1)),n.innerHTML=s.length?s.map((p,m)=>`<div class="sv-pal-it ${m===i?"is-sel":""}" data-i="${m}">
      <span class="material-symbols-outlined">${p.icon}</span><span>${g(p.label)}</span>
      <span class="sv-pal-g">${g([p.sub?p.modulo:"",p.seccion].filter(Boolean).join(" › "))}</span></div>`).join(""):'<div class="sv-pal-empty">Sin coincidencias.</div>',n.querySelectorAll("[data-i]").forEach(p=>p.addEventListener("click",()=>c(s[+p.dataset.i]))),n.querySelector(".is-sel")?.scrollIntoView({block:"nearest"})};a.addEventListener("input",()=>{i=0,u()}),a.addEventListener("keydown",l=>{l.key==="ArrowDown"?(i=Math.min(i+1,s.length-1),u(),l.preventDefault()):l.key==="ArrowUp"?(i=Math.max(i-1,0),u(),l.preventDefault()):l.key==="Enter"?c(s[i]):l.key==="Escape"&&r()}),o.addEventListener("mousedown",l=>{l.target===o&&r()}),u(),a.focus()}let ce=!1;function Pe(){ce||(ce=!0,document.addEventListener("keydown",t=>{if((t.ctrlKey||t.metaKey)&&(t.key==="k"||t.key==="K")){if(!document.getElementById("sv-nav"))return;t.preventDefault(),de()}}))}function pe(){const t=document.getElementById("sv-nav");t.querySelectorAll(".sidebar-item").forEach(e=>{e.addEventListener("click",o=>{o.target.closest("[data-star]")||z(e.getAttribute("data-tab"),e.getAttribute("data-sub")||null)})}),t.querySelectorAll(".sv-fav").forEach(e=>e.addEventListener("click",()=>z(e.dataset.favTab,e.dataset.favSub||null))),t.querySelectorAll("[data-star]").forEach(e=>e.addEventListener("click",o=>{o.preventDefault(),o.stopPropagation();const a=e.dataset.star,n=re().map(s=>s.key),i=n.includes(a)?n.filter(s=>s!==a):n.concat([a]);U(ae,i),Re()})),t.querySelectorAll(".sv-group-toggle").forEach(e=>e.addEventListener("click",()=>{const o=e.closest(".sv-group");if(document.body.classList.contains("sv-side-collapsed")){ue(!1),o.querySelector(".sv-kids").classList.remove("hidden"),e.classList.add("is-expanded");return}const a=o.querySelector(".sv-kids"),n=a.classList.contains("hidden");a.classList.toggle("hidden",!n),e.classList.toggle("is-expanded",n)})),t.querySelectorAll("[data-sect]").forEach(e=>e.addEventListener("click",()=>{const o=e.nextElementSibling,a=!o.classList.contains("hidden");o.classList.toggle("hidden",a),e.classList.toggle("is-closed",a);const n=new Set(M(O,[]));a?n.add(e.dataset.sect):n.delete(e.dataset.sect),U(O,[...n])}))}function Re(){const t=document.getElementById("sidebar-nav-container");if(!t)return;const e=[...document.querySelectorAll(".sv-group")].filter(o=>!o.querySelector(".sv-kids").classList.contains("hidden")).map(o=>o.dataset.mod);t.innerHTML=le(),e.forEach(o=>{const a=document.querySelector(`.sv-group[data-mod="${o}"]`);a&&(a.querySelector(".sv-kids").classList.remove("hidden"),a.querySelector(".sv-group-toggle").classList.add("is-expanded"))}),pe(),be(k,L)}function ue(t){document.body.classList.toggle("sv-side-collapsed",!!t),U(ne,!!t);const e=document.querySelector("#sv-side-toggle .material-symbols-outlined");e&&(e.textContent=t?"left_panel_open":"left_panel_close")}function be(t,e){document.querySelectorAll(".sidebar-item.is-active, .sv-fav.is-active").forEach(i=>i.classList.remove("is-active")),document.querySelectorAll(".sv-group-toggle.is-open-group").forEach(i=>i.classList.remove("is-open-group"));const o=e?`.sidebar-item[data-tab="${t}"][data-sub="${e}"]`:`.sidebar-item[data-tab="${t}"]:not([data-sub])`,a=document.querySelector(o);if(a){a.classList.add("is-active");const i=a.closest(".sv-group");if(i){i.querySelector(".sv-kids").classList.remove("hidden"),i.querySelector(".sv-group-toggle").classList.add("is-open-group","is-expanded");const r=a.closest(".sv-sectbody");r&&r.classList.contains("hidden")&&(r.classList.remove("hidden"),r.previousElementSibling?.classList.remove("is-closed"))}}const n=e?`.sv-fav[data-fav-tab="${t}"][data-fav-sub="${e}"]`:`.sv-fav[data-fav-tab="${t}"]:not([data-fav-sub])`;return document.querySelector(n)?.classList.add("is-active"),a}function qe(t,e){const o=je(t,e),a=document.getElementById("sv-crumbs");a&&(a.innerHTML=o.path.map(n=>`<span>${g(n)}</span><span class="material-symbols-outlined">chevron_right</span>`).join("")+`<span class="sv-crumb-last" id="current-page-title">${g(o.last)}</span>`,document.title=(o.last?o.last+" · ":"")+"SIT EBEMA")}const De=new Set(["save","add","delete","edit","upload","add_circle","person_add","person_off","how_to_reg","remove","cloud_upload","create","mode_edit","delete_forever","send","publish","check_circle","done_all","download","import_export","file_download"]),Ve=["guardar","agregar","crear","eliminar","actualizar","nuevo","nueva","importar","subir","enviar","confirmar","descargar","exportar","publicar","csv","excluir","reactivar","coordinar","invitar","editar"],me=["data-est-sum","data-trabajo","data-volver","data-chip","data-echip","data-exp","data-truck","data-origen","data-refrescar","data-modo","data-rango-clear","data-close","data-cancel","data-tab","data-sub"],ge=["rates","home","indicadores"];let B=null;const He=["data-descarga","data-csv","data-pt-sin-ent","data-picking"],fe=t=>He.some(e=>t.hasAttribute(e));function Fe(t){if(R("descargar"))return!0;const e=k==="abastecimiento"&&L==="plan_carga";return!R("descargar_plan")||!e?!1:fe(t)}const Oe=new Set(["delete","delete_forever","delete_sweep","person_remove"]),Ue=["eliminar","borrar"];function Ye(t){t.querySelectorAll("button:not([data-del-ok])").forEach(e=>{if(me.some(i=>e.hasAttribute(i))){e.setAttribute("data-del-ok","");return}const o=e.querySelector(".material-symbols-outlined")?.textContent?.trim()??"",a=e.textContent?.trim().toLowerCase()??"",n=(e.getAttribute("title")||"").toLowerCase();Oe.has(o)||Ue.some(i=>a.includes(i)||n.includes(i))?e.style.display="none":e.setAttribute("data-del-ok","")})}function Ke(t){t.querySelectorAll("button:not([data-ro-ok])").forEach(e=>{if(me.some(r=>e.hasAttribute(r))){e.setAttribute("data-ro-ok","");return}if(fe(e)){Fe(e)?e.setAttribute("data-ro-ok",""):e.style.display="none";return}const a=e.querySelector(".material-symbols-outlined")?.textContent?.trim()??"",n=e.textContent?.trim().toLowerCase()??"",i=De.has(a)||Ve.some(r=>n.includes(r)),s=n.includes("buscar")||e.id?.includes("search")||a==="close"||a==="search";i&&!s&&(e.style.display="none")}),t.querySelectorAll("tbody input:not([type=radio]):not([type=checkbox]), tbody select, tbody textarea").forEach(e=>{e.disabled=!0})}function Ge(t){if(B&&(B.disconnect(),B=null),ge.includes(k))return;const e=G(),o=!R("eliminar");if(!e&&!o)return;const a=()=>{e?Ke(t):Ye(t)};a();let n=!1;B=new MutationObserver(()=>{n||(n=!0,requestAnimationFrame(()=>{n=!1,a()}))}),B.observe(t,{childList:!0,subtree:!0}),!t._roSubmit&&(t._roSubmit=!0,t.addEventListener("submit",i=>{!G()||ge.includes(k)||(i.preventDefault(),i.stopImmediatePropagation())},!0))}function We(){K(d?.role,d?.centros,d);const t=String(d?.name||d?.email||""),e=t.split(/[\s._@-]+/).filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join("")||"U";document.body.classList.toggle("sv-side-collapsed",!!M(ne,!1));const o=document.body.classList.contains("sv-side-collapsed");I.innerHTML=`
    <nav class="sv-nav" id="sv-nav" aria-label="Menú principal">
      <div class="sv-brand">
        <div class="sv-hide-c" style="display:flex;flex-direction:column">
          <span class="sv-brand-t">SIT EBEMA</span><span class="sv-brand-s">Logistics Admin</span>
        </div>
        <button class="sv-iconbtn" id="sv-side-toggle" data-ro-ok title="Contraer / expandir menú">
          <span class="material-symbols-outlined">${o?"left_panel_open":"left_panel_close"}</span></button>
      </div>
      <button class="sv-goto" id="sv-goto" data-ro-ok title="Ir a una vista (Ctrl K)">
        <span class="material-symbols-outlined">search</span>
        <span class="sv-hide-c" style="flex:1">Ir a una vista…</span><span class="sv-kbd sv-hide-c">Ctrl K</span>
      </button>
      <div class="sv-navscroll" id="sidebar-nav-container">${le()}</div>
      <div class="sv-foot">
        <div class="sv-avatar" title="${g(t)}">${g(e)}</div>
        <div class="sv-user sv-hide-c">
          <div class="sv-user-n" id="topbar-user-name">${g(t)}</div>
          <div class="sv-user-r">${g(Ae[W(d.role)]||d.role)}</div>
        </div>
        <button class="sv-iconbtn sv-hide-c" id="btn-logout" data-ro-ok title="Cerrar sesión"><span class="material-symbols-outlined">logout</span></button>
      </div>
    </nav>

    <header class="sv-header">
      <div class="sv-crumbs" id="sv-crumbs"><span class="sv-crumb-last" id="current-page-title"></span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="sv-upd hidden" id="sv-upd" title="Última actualización de los datos SAP de esta vista"></div>
        <div id="sv-notif-slot"></div>
      </div>
    </header>

    <main class="sv-main">
      <div id="stage-area"></div>
    </main>
  `,document.getElementById("btn-logout").addEventListener("click",X),document.getElementById("sv-side-toggle").addEventListener("click",()=>ue(!document.body.classList.contains("sv-side-collapsed"))),document.getElementById("sv-goto").addEventListener("click",de),Pe(),import("./comentarios.js?v=19466b3aaf").then(n=>n.initCampana(document.getElementById("sv-notif-slot"),{navegar:i=>z("abastecimiento",i)})).catch(n=>console.warn("notificaciones:",n)),pe();const a=Je();a&&(k=a.tab,L=a.sub),z(k,L)}function Je(){const t=String(window.location.hash||"").match(/^#\/([\w-]+)(?:\/([\w-]+))?$/);if(!t)return null;const e=t[1],o=t[2]||null;return _.some(n=>!n.group&&n.tab===e||n.group&&(n.children||[]).some(i=>i.tab===e&&(o==null||i.sub===o)))?{tab:e,sub:o}:null}function Ne(t,e){try{const o=`#/${t}${e?"/"+e:""}`;window.location.hash!==o&&history.replaceState(null,"",window.location.pathname+window.location.search+o)}catch{}}function ve({kpis:t=4,filas:e=8,titulo:o=!0}={}){return`<div class="sk-wrap" aria-busy="true" aria-label="Cargando">
    ${o?'<div class="sk-head"><div class="sk sk-line big w25"></div><div class="sk sk-pill"></div></div>':""}
    ${t?`<div class="sk-kpis">${'<div class="sk-card"><div class="sk sk-line w40"></div><div class="sk sk-line big w60"></div></div>'.repeat(t)}</div>`:""}
    <div class="sk-filters"><div class="sk sk-pill w"></div><div class="sk sk-pill w"></div><div class="sk sk-pill"></div></div>
    <div class="sk-table">${'<div class="sk-row"><div class="sk sk-line w15"></div><div class="sk sk-line w30"></div><div class="sk sk-line w20"></div><div class="sk sk-line w10"></div><div class="sk sk-line w15"></div></div>'.repeat(e)}</div>
  </div>`}window.sitSkeleton=ve;function Ze(t){t.innerHTML=ve()}function T(t,e){const o=_.find(i=>!i.group&&i.tab===t);if(o)return h(o.tab);const a=_.filter(i=>i.group&&i.children?.some(s=>s.tab===t));if(!a.length)return!1;const n=a.find(i=>i.children.some(s=>s.tab===t&&s.sub===e));return n?h(n.group,e):e==null?a.some(i=>i.children.some(s=>s.tab===t&&h(i.group,s.sub))):!1}function Qe(){for(const t of _){if(!t.group){if(h(t.tab))return{tab:t.tab,sub:null};continue}const e=t.children.find(o=>h(t.group,o.sub));if(e)return{tab:e.tab,sub:e.sub}}return null}async function z(t,e=null){if(e==null&&!_.some(s=>!s.group&&s.tab===t)&&!h("__todo__"))for(const s of _.filter(r=>r.group)){const r=s.children.find(c=>c.tab===t&&h(s.group,c.sub));if(r){e=r.sub;break}}if(!T(t,e)){const s=Qe();if(s&&!(s.tab===t&&s.sub===e)){z(s.tab,s.sub);return}document.getElementById("stage-area").innerHTML="";return}k=t,L=e,Ne(t,e),be(t,e),qe(t,e);const o=document.getElementById("sv-upd");o&&(o.classList.add("hidden"),o.innerHTML="");const a=$e[t]||{},n=e!=null?a[e]!==void 0?a[e]:e:null,i=document.getElementById("stage-area");if(Ze(i),!(t!=="home"&&t!=="indicadores"&&(await we(),k!==t||L!==e))){switch(t){case"home":{(await v("ind","./indicadores.js?v=011be41305")).renderIndicadoresHome(i);break}case"rates":{await S(),(await v("rates","./rates.js?v=070af6a478")).renderRatesView(i);break}case"transports":{(await v("trans","./transports.js?v=259bfaa3f8")).renderTransportsView(i);break}case"routes":{await S();const s=await v("routes","./routes.js?v=0b50e5476b");n&&s.setRoutesSubTab(n),s.renderRoutesView(i);break}case"roles":{(await v("roles","./roles.js?v=73fe3401ed")).renderRolesView(i);break}case"tarifas-transporte":{await S(),await Y();const s=await v("tt","./tarifas-transporte.js?v=68708e50f3");n&&s.setActiveSub(n),s.renderTariffTransportView(i);break}case"tarifas-clientes":{await S(),await Y();const s=await v("tc","./tarifas-clientes.js?v=b73e78d9d7");n&&s.setActiveSubC(n),s.renderClientTariffView(i);break}case"abastecimiento":{await S();const s=await v("abast","./abastecimiento.js?v=d61608ea35");e&&s.setAbastSubTab(e),s.setAbastNavegar&&s.setAbastNavegar(r=>z("abastecimiento",r)),s.renderAbastecimientoView(i);break}case"indicadores":{const s=await v("ind","./indicadores.js?v=011be41305");e&&s.setIndicadoresSubTab(e),s.renderIndicadoresView(i);break}case"productos":{(await v("mprod","./maestro-productos.js?v=a8309e8812")).renderMaestroProductos(i);break}case"maestro-obras":{await(await v("mobras","./maestro-obras.js?v=2643773560")).renderMaestroObras(i,e||"obras");break}case"monitor-consolidacion":{await(await v("mcons","./monitor-consolidacion.js?v=81e9c0f0a4")).renderMonitorConsolidacion(i);break}case"porteria":{await(await v("port","./porteria.js?v=f9d0fcebf5")).renderPorteria(i,e||"registro");break}case"flete-tercero":{await S();const s=await v("fter","./flete-tercero.js?v=dd49f98fc7");e&&s.setFleteTerceroSubTab(e),s.renderFleteTerceroView(i);break}}Ge(i)}}
