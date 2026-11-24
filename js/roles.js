import{getDatabase as A,saveDatabase as $,getCentreName as B}from"./data.js?v=99b844b255";import{showAlert as y,escapeHtml as w}from"./utils.js";import{supabase as N}from"./supabase-client.js?v=fd17fd7d20";import{ROLES_CON_CENTROS as C,PERFILES as Y,ALIAS_PERFIL as K,ACCIONES_EXTRA as X,VISTAS_CATALOGO as Q,perfilVeMenu as Z,esOwner as S,can as P,TODOS_CENTROS as L}from"./permisos.js?v=a8b193e9fb";import{confirmar as ee}from"./confirmar.js?v=84d7f13f40";const _={OWNER:{bg:"#ffdad5",text:"#93000a",border:"#ffb4aa",icon:"workspace_premium",label:"Owner"},ADMINISTRADOR:{bg:"#fce4ec",text:"#880e4f",border:"#f48fb1",icon:"shield_person",label:"Administrador"},PLANNER_DISTRIBUCION:{bg:"#fff3e0",text:"#bf360c",border:"#ffab91",icon:"alt_route",label:"Planner Distribución"},JEFE_ABASTECIMIENTO:{bg:"#e0f2f1",text:"#004d40",border:"#4db6ac",icon:"inventory_2",label:"Jefe Abastecimiento"},PLANNER_ABASTECIMIENTO:{bg:"#e0f2f1",text:"#00695c",border:"#80cbc4",icon:"inventory",label:"Planner Abastecimiento"},JEFE_OPERACIONES:{bg:"#e3f2fd",text:"#0d47a1",border:"#90caf9",icon:"warehouse",label:"Jefe Operaciones"},PLANNER_OPERACIONES:{bg:"#ede7f6",text:"#4527a0",border:"#b39ddb",icon:"monitoring",label:"Planner Operaciones"},CONTROL_PUERTA:{bg:"#fff8e1",text:"#7a5300",border:"#ffd54f",icon:"meeting_room",label:"Control Puerta"},JEFE_SUCURSAL:{bg:"#e8eaf6",text:"#283593",border:"#9fa8da",icon:"storefront",label:"Jefe Sucursal"},JEFE_CATEGORIA:{bg:"#f1f8e9",text:"#33691e",border:"#c5e1a5",icon:"category",label:"Jefe Categoría"},VENDEDOR:{bg:"#e8f5e9",text:"#1b5e20",border:"#a5d6a7",icon:"request_quote",label:"Vendedor"},TRANSPORTISTA:{bg:"#fff3e0",text:"#e65100",border:"#ffcc80",icon:"local_shipping",label:"Transportista"},CHOFER:{bg:"#f3e5f5",text:"#6a1b9a",border:"#ce93d8",icon:"badge",label:"Chofer"}},te={OWNER:"Todas las vistas y centros. Visualizar, comentar, editar, borrar e invitar. Único perfil que agrega vistas o funcionalidades extra a un usuario.",ADMINISTRADOR:"Todas las vistas y centros. Visualizar, comentar, editar (excluir y subir pedidos al Plan de Carga) e invitar usuarios. No borra.",PLANNER_DISTRIBUCION:"Todas las vistas (Cotizador, Gestión Troncales, Flete Tercero, Indicadores, Tarifas, Maestros, Roles) y centros. Comenta, edita e invita.",JEFE_ABASTECIMIENTO:"Home y Gestión Troncales completa, todos los centros. Comenta y edita (excluir y subir pedidos al Plan de Carga).",PLANNER_ABASTECIMIENTO:"Home y Gestión Troncales completa, todos los centros. Comenta y edita (excluir y subir pedidos al Plan de Carga).",JEFE_OPERACIONES:"Sus centros: Home, Gestión Troncales, Flete Tercero, Indicadores y Tarifas Clientes. Comenta (sin edición).",PLANNER_OPERACIONES:"Sus centros: Home, Cotizador, Gestión Troncales, Flete Tercero, Indicadores y Tarifas Clientes. Comenta (sin edición).",CONTROL_PUERTA:"Sólo Portería · Control Puerta del centro asignado (1003): registra llegadas, ingresos, salidas, pesos, guías y retornos. Edita, no borra.",JEFE_SUCURSAL:"Sus centros: Home, Cotizador, Gestión Troncales, Flete Tercero, Indicadores y Tarifas Clientes. Comenta (sin edición).",JEFE_CATEGORIA:"Todos los centros: Home, Gestión Troncales e Indicadores. Comenta (sin edición).",VENDEDOR:"Sólo Cotizador Despacho: puede cotizar. No ve ninguna otra vista.",TRANSPORTISTA:"Ve el estado de sus camiones, cuenta bancaria asociada, transportes y choferes. Edita solo lo que está en su perfil.",CHOFER:"Ve el estado de su camión asignado, datos del transporte y sus datos personales (nombre, RUT, correo, teléfono, licencia y carnet)."},oe={Administrador:"OWNER",admin:"OWNER","Admin SIT":"OWNER","Operador Logístico":"JEFE_OPERACIONES",operador:"JEFE_OPERACIONES","Logistics Operator":"JEFE_OPERACIONES",Visita:"VENDEDOR",...K,proveedor:"TRANSPORTISTA"},q=[],k=["TRANSPORTISTA","CHOFER"];function T(e){return _[e]?e:oe[e]||"VENDEDOR"}function U(e){return _[T(e)]||{bg:"#f3f4f5",text:"#5c5f61",border:"#e1e3e4",icon:"person",label:e||"Sin rol"}}function se(e){return(e||"?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2)}const D=[["#b5000b","#fff5f3"],["#1565c0","#e3f2fd"],["#2e7d32","#e8f5e9"],["#6a1b9a","#f3e5f5"],["#e65100","#fff3e0"],["#00695c","#e0f2f1"]];function ne(e){let n=0;for(let a of e||"")n=n*31+a.charCodeAt(0)&65535;return D[n%D.length]}function z(e){const n=A(),a=n.users,s=a.length,r=a.filter(o=>T(o.role)==="OWNER").length,t=a.filter(o=>C.includes(T(o.role))).length,u=S(),l=a.filter(o=>o.activo!==!1).length;e.innerHTML=`
    <!-- Encabezado de Sección -->
    <div class="mb-xl">
      <div class="flex items-center justify-between flex-wrap gap-md">
        <div>
          <h1 class="font-headline-lg text-headline-lg text-on-surface">Roles y Perfiles</h1>
          <p class="font-body-lg text-body-lg text-secondary mt-1">Gestione los accesos y permisos de usuarios corporativos en SIT EBEMA.</p>
        </div>
        ${P("invitar")?`<button id="btn-open-add-user"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s"
          onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'">
          <span class="material-symbols-outlined" style="font-size:18px">person_add</span>
          Agregar Usuario
        </button>`:""}
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-xl">
      <div style="background:white;border:1px solid #e9bcb6;border-left:4px solid #b5000b;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Total Usuarios</p>
          <p style="font-size:28px;font-weight:800;color:#b5000b;line-height:1">${s}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#b5000b;opacity:0.4">groups</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Owners</p>
          <p style="font-size:28px;font-weight:800;color:#93000a;line-height:1">${r}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#93000a;opacity:0.3">workspace_premium</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Perfiles por centro</p>
          <p style="font-size:28px;font-weight:800;color:#0d47a1;line-height:1">${t}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#0d47a1;opacity:0.3">warehouse</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Activos Ahora</p>
          <p style="font-size:28px;font-weight:800;color:#191c1d;line-height:1">${l}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#191c1d;opacity:0.2">how_to_reg</span>
      </div>
    </div>

    <!-- Tabla de Usuarios -->
    <div style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      <!-- Barra de herramientas de la tabla -->
      <div style="padding:16px 20px;border-bottom:1px solid #e1e3e4;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="material-symbols-outlined" style="color:#b5000b;font-size:20px">security</span>
          <h3 style="font-size:16px;font-weight:700;color:#191c1d">Usuarios Corporativos</h3>
          <span style="font-size:11px;padding:2px 8px;background:#f3f4f5;border:1px solid #e1e3e4;border-radius:20px;color:#5c5f61;font-weight:600">${s} registros</span>
        </div>
        <div style="position:relative">
          <span class="material-symbols-outlined" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">search</span>
          <input id="users-search" type="text" placeholder="Buscar usuario..." style="padding:7px 12px 7px 32px;border:1px solid #e1e3e4;border-radius:6px;font-size:13px;background:#f8f9fa;color:#191c1d;outline:none;width:220px" onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
        </div>
      </div>

      <!-- Tabla -->
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f8f9fa;border-bottom:1px solid #e1e3e4">
              <th style="padding:10px 20px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61">Usuario</th>
              <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61">Correo</th>
              <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61">Rol</th>
              <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61">Estado</th>
              <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61">Acciones</th>
            </tr>
          </thead>
          <tbody id="users-roles-tbody">
            <!-- Cargado dinámicamente -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Agregar / Editar Usuario -->
    <div id="modal-user" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:999;display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px)">
      <div style="background:white;border-radius:16px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);animation:slideUp 0.3s ease-out">
        <div style="padding:24px 24px 0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div>
              <h3 id="modal-user-title" style="font-size:20px;font-weight:800;color:#191c1d">Agregar Usuario</h3>
              <p style="font-size:13px;color:#5c5f61;margin-top:2px">Complete los datos del usuario corporativo</p>
            </div>
            <button id="btn-modal-close" style="background:#f3f4f5;border:none;border-radius:8px;padding:8px;cursor:pointer;display:flex;align-items:center" onmouseover="this.style.background='#e1e3e4'" onmouseout="this.style.background='#f3f4f5'">
              <span class="material-symbols-outlined" style="font-size:20px;color:#5c5f61">close</span>
            </button>
          </div>
        </div>

        <!-- Formulario del Modal -->
        <form id="modal-user-form" style="padding:0 24px 24px;display:flex;flex-direction:column;gap:16px">
          <input type="hidden" id="modal-edit-idx" value="">

          <div>
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Nombre Completo</label>
            <div style="position:relative">
              <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">person</span>
              <input type="text" id="modal-user-name" placeholder="Ej. Juan Pérez" required
                style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;box-sizing:border-box;transition:border-color 0.2s"
                onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
            </div>
          </div>

          <div>
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Correo Corporativo</label>
            <div style="position:relative">
              <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">mail</span>
              <input type="email" id="modal-user-email" placeholder="usuario@ebema.cl" required
                style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;box-sizing:border-box;transition:border-color 0.2s"
                onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
            </div>
          </div>

          <div>
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:8px">Rol de Acceso (Perfil)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px" id="rol-selector">
              ${Object.keys(_).filter(o=>u||o!=="OWNER").map(o=>{const i=U(o);return`
                <label style="cursor:pointer">
                  <input type="radio" name="modal-role" value="${o}" style="display:none" class="role-radio" />
                  <div class="role-option" data-role="${o}" style="padding:10px 8px;border:2px solid #e1e3e4;border-radius:8px;text-align:center;transition:all 0.15s;user-select:none">
                    <span class="material-symbols-outlined" style="font-size:20px;color:${i.text};display:block;margin-bottom:4px">${i.icon}</span>
                    <span style="font-size:11px;font-weight:700;color:#191c1d;display:block;line-height:1.2">${i.label}</span>
                  </div>
                </label>`}).join("")}
            </div>
            <p id="role-desc-text" style="font-size:12px;color:#5c5f61;margin-top:8px;line-height:1.4;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:6px;padding:8px 10px"></p>
          </div>

          <div id="field-centros-asig" style="display:none">
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Centros Asignados</label>
            <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#f8f9fa">
              <input type="checkbox" id="asig-todos-centros" style="width:16px;height:16px;accent-color:#b5000b" />
              <span style="font-size:13px;font-weight:700;color:#191c1d">Todos los centros</span>
              <span style="font-size:11px;color:#5c5f61">(incluye centros nuevos)</span>
            </label>
            <div style="display:flex;gap:8px;margin-bottom:6px">
              <button type="button" id="asig-todos" style="font-size:11px;font-weight:700;color:#b5000b;background:none;border:none;cursor:pointer;padding:0">Marcar todos</button>
              <button type="button" id="asig-ninguno" style="font-size:11px;font-weight:700;color:#5c5f61;background:none;border:none;cursor:pointer;padding:0">Limpiar</button>
            </div>
            <div id="modal-user-asig-list" style="max-height:160px;overflow-y:auto;border:1.5px solid #e1e3e4;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px">
              ${(n.logisticsCentres||[]).map(o=>`
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" class="modal-user-asig-item" value="${o.id}" style="width:15px;height:15px;accent-color:#b5000b" />
                  <span style="font-size:13px;color:#191c1d">${o.nombre} (${o.id})</span>
                </label>`).join("")}
            </div>
            <p style="font-size:11px;color:#5c5f61;margin-top:6px;line-height:1.4">Uno, varios o todos. El usuario solo verá información de estos centros (centro destino).</p>
          </div>

          ${u?`
          <div id="field-extras" style="border:1.5px dashed #ffb4aa;border-radius:10px;padding:12px;background:#fffaf9">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span class="material-symbols-outlined" style="font-size:18px;color:#b5000b">tune</span>
              <span style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#93000a">Accesos adicionales (solo Owner)</span>
            </div>
            <p style="font-size:11px;color:#5c5f61;line-height:1.4;margin-bottom:8px">Se suman a la estructura por defecto del perfil. Las vistas ya incluidas en el perfil aparecen marcadas y bloqueadas.</p>
            <p style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin:6px 0 4px">Vistas</p>
            <div id="extras-vistas" style="max-height:180px;overflow-y:auto;border:1px solid #e1e3e4;border-radius:8px;padding:8px 10px;background:white">
              ${Q.map(o=>`
                <p style="font-size:10px;font-weight:700;color:#93000a;margin:6px 0 2px">${w(o.modulo)}</p>
                ${o.items.map(([i,p])=>`
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0">
                  <input type="checkbox" class="extra-vista" value="${i}" style="width:15px;height:15px;accent-color:#b5000b" />
                  <span style="font-size:12px;color:#191c1d">${w(p)}</span>
                </label>`).join("")}`).join("")}
            </div>
            <p style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin:10px 0 4px">Funcionalidades</p>
            <div id="extras-acciones" style="border:1px solid #e1e3e4;border-radius:8px;padding:8px 10px;background:white;display:flex;flex-direction:column;gap:4px">
              ${X.map(o=>`
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" class="extra-accion" value="${o.key}" data-solo-editor="${o.soloEditor?1:0}" style="width:15px;height:15px;accent-color:#b5000b" />
                  <span style="font-size:12px;color:#191c1d">${w(o.label)}</span>
                </label>`).join("")}
            </div>
            <p style="font-size:10px;color:#5c5f61;margin-top:6px;line-height:1.4">Las funcionalidades de edición solo se habilitan en perfiles con privilegio Editar. Los datos visibles en una vista extra respetan el perfil base y sus centros.</p>
          </div>`:""}

          <div id="field-transportista" style="display:none">
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Transportista Asociado</label>
            <div style="position:relative">
              <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">local_shipping</span>
              <select id="modal-user-transportista"
                style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;box-sizing:border-box;transition:border-color 0.2s;appearance:none"
                onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'">
                <option value="">Seleccione un transportista...</option>
                ${(n.transports||[]).map(o=>`<option value="${o.id}">${w(o.razonSocial||o.nombre||o.id)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div id="modal-user-error" style="display:none;align-items:center;gap:8px;padding:10px 12px;background:#ffdad6;border:1px solid rgba(186,26,26,0.2);border-radius:8px;font-size:13px;color:#93000a">
            <span class="material-symbols-outlined" style="font-size:16px">error</span>
            <span id="modal-user-error-text"></span>
          </div>

          <button type="submit" id="btn-modal-submit"
            style="width:100%;padding:12px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background 0.2s;margin-top:4px"
            onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'">
            <span class="material-symbols-outlined" style="font-size:18px">save</span>
            Guardar Usuario
          </button>
        </form>
      </div>
    </div>

    <style>
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .user-row:hover { background: #fafafa !important; }
      .role-option.selected {
        border-color: #b5000b !important;
        background: #fff5f3 !important;
      }
    </style>
  `,G(a,e),document.getElementById("users-search").addEventListener("input",o=>{const i=o.target.value.toLowerCase(),c=A().users.filter(d=>(d.name||"").toLowerCase().includes(i)||(d.email||"").toLowerCase().includes(i)||(d.role||"").toLowerCase().includes(i));G(c,e,!0)}),document.getElementById("btn-open-add-user")?.addEventListener("click",()=>{V()}),document.getElementById("btn-modal-close").addEventListener("click",R),document.getElementById("modal-user").addEventListener("click",o=>{o.target===document.getElementById("modal-user")&&R()}),M(),ae(),de(),document.getElementById("modal-user-form").addEventListener("submit",o=>{o.preventDefault(),pe()})}function M(){document.querySelectorAll(".role-option").forEach(e=>{e.addEventListener("click",()=>{const n=e.dataset.role;document.querySelectorAll(".role-option").forEach(s=>s.classList.remove("selected")),e.classList.add("selected");const a=document.querySelector(`input[name="modal-role"][value="${n}"]`);a&&(a.checked=!0),H(n)})})}function ae(){const e=document.getElementById("modal-user-centro-todos"),n=document.getElementById("modal-user-centro-list");!e||!n||e.addEventListener("change",()=>{const a=n.querySelectorAll(".modal-user-centro-item");e.checked?(a.forEach(s=>{s.checked=!1,s.disabled=!0}),n.style.opacity="0.5"):(a.forEach(s=>{s.disabled=!1}),n.style.opacity="1")})}function re(){return document.getElementById("asig-todos-centros")?.checked?[L]:Array.from(document.querySelectorAll(".modal-user-asig-item:checked")).map(e=>e.value)}function F(e){const n=document.getElementById("modal-user-asig-list");document.querySelectorAll(".modal-user-asig-item").forEach(a=>{a.disabled=e,e&&(a.checked=!1)}),n&&(n.style.opacity=e?"0.5":"1")}function J(e){const n=Array.isArray(e)?e.map(String):[],a=n.includes(L),s=document.getElementById("asig-todos-centros");s&&(s.checked=a),document.querySelectorAll(".modal-user-asig-item").forEach(r=>{r.checked=!a&&n.includes(r.value)}),F(a)}let O={vistasExtra:[],accionesExtra:[]};function ie(e){const n=Y[e],a=!!n&&n.acciones.includes("editar");document.querySelectorAll(".extra-vista").forEach(s=>{const r=Z(e,s.value);s.disabled=r,s.checked=r||O.vistasExtra.includes(s.value),s.parentElement.style.opacity=r?"0.55":"1"}),document.querySelectorAll(".extra-accion").forEach(s=>{const r=!!n&&n.acciones.includes(s.value),t=r||s.dataset.soloEditor==="1"&&!a;s.disabled=t,s.checked=r||!t&&O.accionesExtra.includes(s.value),s.parentElement.style.opacity=t?"0.55":"1"})}function le(){return{vistasExtra:Array.from(document.querySelectorAll(".extra-vista:checked:not(:disabled)")).map(e=>e.value),accionesExtra:Array.from(document.querySelectorAll(".extra-accion:checked:not(:disabled)")).map(e=>e.value)}}function de(){document.getElementById("asig-todos-centros")?.addEventListener("change",e=>F(e.target.checked)),document.getElementById("asig-todos")?.addEventListener("click",()=>document.querySelectorAll(".modal-user-asig-item:not(:disabled)").forEach(e=>{e.checked=!0})),document.getElementById("asig-ninguno")?.addEventListener("click",()=>document.querySelectorAll(".modal-user-asig-item").forEach(e=>{e.checked=!1}))}function ce(){const e=document.getElementById("modal-user-centro-todos");if(e&&e.checked)return null;const n=Array.from(document.querySelectorAll(".modal-user-centro-item:checked")).map(a=>a.value);return n.length?n:null}function j(e){const n=document.getElementById("modal-user-centro-todos"),a=document.getElementById("modal-user-centro-list");if(!n||!a)return;const s=a.querySelectorAll(".modal-user-centro-item"),r=!e||e.length===0;n.checked=r,s.forEach(t=>{t.checked=!r&&e.includes(t.value),t.disabled=r}),a.style.opacity=r?"0.5":"1"}function H(e){const n=document.getElementById("role-desc-text");n&&(n.textContent=te[e]||"");const a=document.getElementById("field-centro"),s=document.getElementById("field-transportista");a&&(a.style.display=q.includes(e)?"block":"none");const r=document.getElementById("field-centros-asig");r&&(r.style.display=C.includes(e)?"block":"none"),s&&(s.style.display=k.includes(e)?"block":"none");const t=document.getElementById("field-extras");t&&(t.style.display=k.includes(e)?"none":"block",ie(e))}function V(e=null){const n=document.getElementById("modal-user"),a=document.getElementById("modal-user-title"),s=document.getElementById("modal-edit-idx"),r=document.getElementById("modal-user-name"),t=document.getElementById("modal-user-email"),u=document.getElementById("modal-user-error"),l=document.getElementById("btn-modal-submit");u.style.display="none",document.querySelectorAll(".role-option").forEach(c=>c.classList.remove("selected")),document.querySelectorAll('input[name="modal-role"]').forEach(c=>c.checked=!1);const o=document.getElementById("modal-user-transportista");o&&(o.value=""),j(null),J([]),O={vistasExtra:[],accionesExtra:[]};let i="VENDEDOR";if(e!==null){const d=A().users[e];a.textContent="Editar Usuario",l.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">save</span> Guardar Cambios',s.value=e,r.value=d.name||"",t.value=d.email||"",t.readOnly=!0,t.style.background="#f3f4f5",t.style.cursor="not-allowed",i=T(d.role),j(d.centrosPreferencia||null),J(d.centrosAsignados||[]),O={vistasExtra:Array.isArray(d.vistasExtra)?d.vistasExtra:[],accionesExtra:Array.isArray(d.accionesExtra)?d.accionesExtra:[]},o&&d.transportistaId&&(o.value=d.transportistaId)}else a.textContent="Agregar Usuario",l.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">person_add</span> Guardar Usuario',s.value="",r.value="",t.value="",t.readOnly=!1,t.style.background="white",t.style.cursor="text";const p=document.querySelector(`.role-option[data-role="${i}"]`);if(p){p.classList.add("selected");const c=document.querySelector(`input[name="modal-role"][value="${i}"]`);c&&(c.checked=!0)}H(i),n.style.display="flex",r.focus()}function R(){document.getElementById("modal-user").style.display="none"}async function pe(){const e=A(),n=document.getElementById("modal-edit-idx").value,a=document.getElementById("modal-user-name").value.trim(),s=document.getElementById("modal-user-email").value.trim().toLowerCase(),r=document.querySelector('input[name="modal-role"]:checked')?.value,t=document.getElementById("modal-user-error"),u=document.getElementById("modal-user-error-text"),l=m=>{u.textContent=m,t.style.display="flex"};if(!a)return l("El nombre es obligatorio.");if(!s.endsWith("@ebema.cl"))return l("El correo debe pertenecer al dominio @ebema.cl");if(!r)return l("Seleccione un rol de acceso.");const o=ce(),i=document.getElementById("modal-user-transportista")?.value||"";if(k.includes(r)&&!i)return l("Seleccione el Transportista Asociado para este perfil.");const p=C.includes(r)?re():[];if(C.includes(r)&&p.length===0)return l("Asigne al menos un centro a este perfil.");if(r==="OWNER"&&!S())return l("Solo un Owner puede asignar el perfil Owner.");const c=S()&&!k.includes(r)?le():null,d=null,b=k.includes(r)?i:null;if(n===""){if(e.users.some(f=>f.email===s))return l("El correo ya se encuentra registrado.");const m=document.getElementById("btn-modal-submit"),h=m.innerHTML;m.disabled=!0,m.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">outgoing_mail</span> Enviando invitación...';const{data:g,error:I}=await N.functions.invoke("invite-user",{body:{email:s,name:a,role:r,centrosPreferencia:d,centrosAsignados:p,transportistaId:b,...c||{},redirectTo:window.location.origin+window.location.pathname}});if(m.disabled=!1,m.innerHTML=h,I||g&&g.error)return l(g&&g.error||I?.message||"No se pudo enviar la invitación.");e.users.push({email:s,name:a,role:r,centrosPreferencia:d,centrosAsignados:p,transportistaId:b,vistasExtra:c?.vistasExtra||[],accionesExtra:c?.accionesExtra||[],activo:!0,lastAccess:"Invitación enviada"}),y(g&&(g.message||g.warning)||`Invitación enviada a ${s}.`),R();const E=document.getElementById("stage-area");E&&z(E);return}const x=parseInt(n);e.users[x]&&(e.users[x].name=a,e.users[x].role=r,e.users[x].centrosPreferencia=d,e.users[x].centrosAsignados=p,e.users[x].transportistaId=b,c&&(e.users[x].vistasExtra=c.vistasExtra,e.users[x].accionesExtra=c.accionesExtra),y(`Perfil de ${a} actualizado.`)),$(e,{syncOnly:["users"]}),R();const v=document.getElementById("stage-area");v&&z(v)}function G(e,n,a=!1){const s=document.getElementById("users-roles-tbody");if(!s)return;if(s.innerHTML="",e.length===0){s.innerHTML=`
      <tr>
        <td colspan="5" style="padding:48px 20px;text-align:center;color:#5c5f61">
          <span class="material-symbols-outlined" style="font-size:40px;display:block;margin-bottom:8px;opacity:0.3">search_off</span>
          <p style="font-size:14px">No se encontraron usuarios</p>
        </td>
      </tr>
    `;return}const r=A();e.forEach((t,u)=>{const l=a?r.users.findIndex(f=>f.email===t.email):u,o=T(t.role),i=U(t.role),[p,c]=ne(t.email),d=se(t.name),b=t.activo!==!1,x=!t.lastAccess||t.lastAccess==="Invitación enviada"||t.lastAccess==="Nunca",v=i.label;let m="";if(C.includes(o)){const f=t.centrosAsignados||[];m=f.includes(L)?"Todos los centros":f.length===0?"Sin centros asignados":f.length===1?B(r,f[0])||f[0]:`${f.length} centros asignados`}else if(q.includes(o)){const f=t.centrosPreferencia;!f||f.length===0?m="Todos los centros":f.length===1?m=B(r,f[0])||f[0]:m=`${f.length} centros seleccionados`}else if(k.includes(o)&&t.transportistaId){const f=(r.transports||[]).find(W=>W.id===t.transportistaId);m=f&&(f.razonSocial||f.nombre)||""}const h=(Array.isArray(t.vistasExtra)?t.vistasExtra.length:0)+(Array.isArray(t.accionesExtra)?t.accionesExtra.length:0),g=(JSON.parse(localStorage.getItem("ebema_user_session")||"{}").email||"").toLowerCase(),I=S()||o!=="OWNER"&&(t.email||"").toLowerCase()!==g,E=document.createElement("tr");E.className="user-row",E.style.cssText="border-bottom:1px solid #f3f4f5;transition:background 0.15s",E.innerHTML=`
      <td style="padding:14px 20px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:50%;background:${p};color:${c};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;border:1px solid ${p}">
            ${d}
          </div>
          <div>
            <p style="font-size:14px;font-weight:700;color:#191c1d;line-height:1.2">${t.name||"—"}</p>
            <p style="font-size:11px;color:#5c5f61;margin-top:2px">Último acceso: ${t.lastAccess||"Nunca"}</p>
          </div>
        </div>
      </td>
      <td style="padding:14px 16px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#5c5f61">${t.email}</span>
      </td>
      <td style="padding:14px 16px">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:${i.bg};color:${i.text};border:1px solid ${i.border};border-radius:20px;font-size:11px;font-weight:700">
          <span class="material-symbols-outlined" style="font-size:12px">${i.icon}</span>
          ${v}
        </span>
        ${m?`<p style="font-size:10px;color:#5c5f61;margin-top:4px">${m}</p>`:""}
        ${h?`<p style="font-size:10px;color:#b5000b;font-weight:700;margin-top:2px" title="Vistas/funcionalidades agregadas por Owner">+${h} acceso${h>1?"s":""} adicional${h>1?"es":""}</p>`:""}
      </td>
      <td style="padding:14px 16px;text-align:center">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;${b?"background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7":"background:#fce4e4;color:#b71c1c;border:1px solid #ef9a9a"}">
          <span style="width:5px;height:5px;border-radius:50%;background:${b?"#43a047":"#e53935"};display:inline-block"></span>
          ${b?"ACTIVO":"INACTIVO"}
        </span>
      </td>
      <td style="padding:14px 16px;text-align:center">
        <div style="display:inline-flex;align-items:center;gap:4px">
          ${I?`<button class="btn-edit-user" data-idx="${l}"
            title="Editar perfil"
            style="padding:6px;background:#f3f4f5;border:1px solid #e1e3e4;border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.background='#e7e8e9';this.style.borderColor='#b5000b'" onmouseout="this.style.background='#f3f4f5';this.style.borderColor='#e1e3e4'">
            <span class="material-symbols-outlined" style="font-size:16px;color:#5c5f61">edit</span>
          </button>`:""}
          ${x&&b?`
          <button class="btn-resend-invite" data-idx="${l}" data-email="${t.email}"
            title="Reenviar invitación"
            style="padding:6px;background:#fff8e1;border:1px solid #ffca28;border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.background='#ffecb3'" onmouseout="this.style.background='#fff8e1'">
            <span class="material-symbols-outlined" style="font-size:16px;color:#f57f17">forward_to_inbox</span>
          </button>`:""}
          ${I?`<button class="btn-toggle-user" data-idx="${l}"
            title="${b?"Desactivar usuario":"Activar usuario"}"
            style="padding:6px;background:${b?"#fff8f7":"#f0fdf4"};border:1px solid ${b?"#ffb4aa":"#a5d6a7"};border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'">
            <span class="material-symbols-outlined" style="font-size:16px;color:${b?"#b5000b":"#2e7d32"}">${b?"person_off":"how_to_reg"}</span>
          </button>`:""}
          ${P("eliminar")?`<button class="btn-delete-user" data-idx="${l}" data-email="${t.email}" data-name="${w(t.name||t.email)}"
            title="Eliminar usuario permanentemente"
            style="padding:6px;background:#fff8f7;border:1px solid #ffb4aa;border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.background='#ffdad6';this.style.borderColor='#b5000b'" onmouseout="this.style.background='#fff8f7';this.style.borderColor='#ffb4aa'">
            <span class="material-symbols-outlined" style="font-size:16px;color:#b5000b">delete_forever</span>
          </button>`:""}
        </div>
      </td>
    `,s.appendChild(E)}),s.querySelectorAll(".btn-resend-invite").forEach(t=>{t.addEventListener("click",async u=>{const l=u.currentTarget.getAttribute("data-email"),o=u.currentTarget.querySelector(".material-symbols-outlined"),i=o.textContent;u.currentTarget.disabled=!0,o.textContent="sync";const{data:p,error:c}=await N.functions.invoke("resend-invite",{body:{email:l}});if(u.currentTarget.disabled=!1,o.textContent=i,c||p&&p.error){y(p&&p.error||c?.message||"No se pudo reenviar la invitación.","error");return}y(p&&p.message||`Invitación reenviada a ${l}.`)})}),s.querySelectorAll(".btn-edit-user").forEach(t=>{t.addEventListener("click",u=>{const l=parseInt(u.currentTarget.getAttribute("data-idx"));V(l),M()})}),s.querySelectorAll(".btn-delete-user").forEach(t=>{t.addEventListener("click",async u=>{const l=parseInt(u.currentTarget.getAttribute("data-idx")),o=u.currentTarget.getAttribute("data-email"),i=u.currentTarget.getAttribute("data-name");if(JSON.parse(localStorage.getItem("ebema_user_session")||"{}").email===o){y("No puede eliminar su propio usuario.","error");return}if(!await ee(`¿Eliminar permanentemente a "${i}" (${o})?

Esta acción no se puede deshacer.`))return;t.disabled=!0,t.style.opacity="0.5";const{data:d,error:b}=await N.functions.invoke("delete-user",{body:{email:o}});if(b||d&&d.error){y(d&&d.error||b?.message||"No se pudo eliminar el usuario.","error"),t.disabled=!1,t.style.opacity="1";return}const x=A(),v=x.users.findIndex(h=>h.email===o);v!==-1&&x.users.splice(v,1),$(x,{syncOnly:["users"]}),y(`${i} eliminado correctamente.`);const m=document.getElementById("stage-area");m&&z(m)})}),s.querySelectorAll(".btn-toggle-user").forEach(t=>{t.addEventListener("click",u=>{const l=parseInt(u.currentTarget.getAttribute("data-idx")),o=A(),i=o.users[l];if(!i)return;if(JSON.parse(localStorage.getItem("ebema_user_session")||"{}").email===i.email){y("No puede desactivar su propio usuario activo.","error");return}i.activo=i.activo===void 0?!1:!i.activo,$(o),y(`${i.name} ha sido ${i.activo?"activado":"desactivado"}.`);const c=document.getElementById("stage-area");c&&z(c)})})}export{z as renderRolesView};
