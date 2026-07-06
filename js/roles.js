import { getDatabase, saveDatabase, getCentreName } from './data.js?v=20260703b';
import { showAlert, escapeHtml } from './utils.js';

// --- Perfiles de Acceso (Roles y Perfiles + Row Level Security) ---
// 5 perfiles canónicos. Cada uno determina qué puede ver/editar el usuario
// en la plataforma; el control real de acceso se aplica vía RLS en Supabase
// usando el rol y, cuando corresponde, el centro/transportista asociado.
const ROLE_CONFIG = {
  'OWNER':                  { bg: '#ffdad5', text: '#93000a', border: '#ffb4aa', icon: 'workspace_premium', label: 'Owner' },
  'ADMINISTRADOR_DEPOSITO': { bg: '#e3f2fd', text: '#0d47a1', border: '#90caf9', icon: 'warehouse',          label: 'Admin. Depósito' },
  'AGENTE_COMERCIAL':       { bg: '#e8f5e9', text: '#1b5e20', border: '#a5d6a7', icon: 'request_quote',      label: 'Agente Comercial' },
  'TRANSPORTISTA':          { bg: '#fff3e0', text: '#e65100', border: '#ffcc80', icon: 'local_shipping',    label: 'Transportista' },
  'CHOFER':                 { bg: '#f3e5f5', text: '#6a1b9a', border: '#ce93d8', icon: 'badge',              label: 'Chofer' }
};

// Descripciones de cada perfil (se muestran al seleccionar el rol en el modal)
const ROLE_DESCRIPTIONS = {
  'OWNER': 'Ve y edita cualquier campo de la plataforma: todos los centros, planes, rutas, tarifas de transporte y clientes.',
  'ADMINISTRADOR_DEPOSITO': 'Igual que Owner, pero limitado a su centro asociado (centros, rutas, tarifas y clientes de ese centro).',
  'AGENTE_COMERCIAL': 'Puede cotizar y ver la información asociada a su centro.',
  'TRANSPORTISTA': 'Ve el estado de sus camiones, cuenta bancaria asociada, transportes y choferes. Edita solo lo que está en su perfil.',
  'CHOFER': 'Ve el estado de su camión asignado, datos del transporte y sus datos personales (nombre, RUT, correo, teléfono, licencia y carnet).'
};

// Roles legados (datos antiguos) → equivalente normalizado entre los 5 perfiles
const LEGACY_ROLE_MAP = {
  'Administrador': 'OWNER',
  'admin': 'OWNER',
  'Admin SIT': 'OWNER',
  'Operador Logístico': 'ADMINISTRADOR_DEPOSITO',
  'operador': 'ADMINISTRADOR_DEPOSITO',
  'Logistics Operator': 'ADMINISTRADOR_DEPOSITO',
  'Visita': 'AGENTE_COMERCIAL',
  'proveedor': 'TRANSPORTISTA'
};

// Roles que requieren un "Centro Logístico" asociado
const CENTRO_ROLES = ['ADMINISTRADOR_DEPOSITO', 'AGENTE_COMERCIAL'];
// Roles que requieren un "Transportista" asociado
const TRANSPORTE_ROLES = ['TRANSPORTISTA', 'CHOFER'];

// Normaliza un rol (legado o nuevo) a uno de los 5 perfiles canónicos
function normalizeRole(role) {
  if (ROLE_CONFIG[role]) return role;
  return LEGACY_ROLE_MAP[role] || 'AGENTE_COMERCIAL';
}

function getRoleConfig(role) {
  return ROLE_CONFIG[normalizeRole(role)] || { bg: '#f3f4f5', text: '#5c5f61', border: '#e1e3e4', icon: 'person', label: role || 'Sin rol' };
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Colores de avatar deterministas según email
const AVATAR_PALETTES = [
  ['#b5000b', '#fff5f3'],
  ['#1565c0', '#e3f2fd'],
  ['#2e7d32', '#e8f5e9'],
  ['#6a1b9a', '#f3e5f5'],
  ['#e65100', '#fff3e0'],
  ['#00695c', '#e0f2f1'],
];
function getAvatarPalette(email) {
  let h = 0;
  for (let c of (email || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length];
}

export function renderRolesView(container) {
  const db = getDatabase();
  const users = db.users;

  const totalUsers = users.length;
  const ownerCount = users.filter(u => normalizeRole(u.role) === 'OWNER').length;
  const depositoCount = users.filter(u => normalizeRole(u.role) === 'ADMINISTRADOR_DEPOSITO').length;
  const activeCount = users.filter(u => u.activo !== false).length;

  container.innerHTML = `
    <!-- Encabezado de Sección -->
    <div class="mb-xl">
      <div class="flex items-center justify-between flex-wrap gap-md">
        <div>
          <h1 class="font-headline-lg text-headline-lg text-on-surface">Roles y Perfiles</h1>
          <p class="font-body-lg text-body-lg text-secondary mt-1">Gestione los accesos y permisos de usuarios corporativos en SIT EBEMA.</p>
        </div>
        <button id="btn-open-add-user"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#b5000b;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s"
          onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'">
          <span class="material-symbols-outlined" style="font-size:18px">person_add</span>
          Agregar Usuario
        </button>
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-xl">
      <div style="background:white;border:1px solid #e9bcb6;border-left:4px solid #b5000b;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Total Usuarios</p>
          <p style="font-size:28px;font-weight:800;color:#b5000b;line-height:1">${totalUsers}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#b5000b;opacity:0.4">groups</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Owners</p>
          <p style="font-size:28px;font-weight:800;color:#93000a;line-height:1">${ownerCount}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#93000a;opacity:0.3">workspace_premium</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Admin. Depósito</p>
          <p style="font-size:28px;font-weight:800;color:#0d47a1;line-height:1">${depositoCount}</p>
        </div>
        <span class="material-symbols-outlined" style="font-size:32px;color:#0d47a1;opacity:0.3">warehouse</span>
      </div>
      <div style="background:white;border:1px solid #e1e3e4;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Activos Ahora</p>
          <p style="font-size:28px;font-weight:800;color:#191c1d;line-height:1">${activeCount}</p>
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
          <span style="font-size:11px;padding:2px 8px;background:#f3f4f5;border:1px solid #e1e3e4;border-radius:20px;color:#5c5f61;font-weight:600">${totalUsers} registros</span>
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
      <div style="background:white;border-radius:16px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,0.2);animation:slideUp 0.3s ease-out">
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
              ${Object.keys(ROLE_CONFIG).map(rol => {
                const rc = getRoleConfig(rol);
                return `
                <label style="cursor:pointer">
                  <input type="radio" name="modal-role" value="${rol}" style="display:none" class="role-radio" />
                  <div class="role-option" data-role="${rol}" style="padding:10px 8px;border:2px solid #e1e3e4;border-radius:8px;text-align:center;transition:all 0.15s;user-select:none">
                    <span class="material-symbols-outlined" style="font-size:20px;color:${rc.text};display:block;margin-bottom:4px">${rc.icon}</span>
                    <span style="font-size:11px;font-weight:700;color:#191c1d;display:block;line-height:1.2">${rc.label}</span>
                  </div>
                </label>`;
              }).join('')}
            </div>
            <p id="role-desc-text" style="font-size:12px;color:#5c5f61;margin-top:8px;line-height:1.4;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:6px;padding:8px 10px"></p>
          </div>

          <div id="field-centro" style="display:none">
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Centro Asociado</label>
            <div style="position:relative">
              <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">location_on</span>
              <select id="modal-user-centro"
                style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;box-sizing:border-box;transition:border-color 0.2s;appearance:none"
                onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'">
                <option value="">Seleccione un centro...</option>
                ${(db.logisticsCentres || []).map(cd => `<option value="${cd.id}">${cd.nombre} (${cd.id})</option>`).join('')}
              </select>
            </div>
          </div>

          <div id="field-transportista" style="display:none">
            <label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:6px">Transportista Asociado</label>
            <div style="position:relative">
              <span class="material-symbols-outlined" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5c5f61;font-size:16px;pointer-events:none">local_shipping</span>
              <select id="modal-user-transportista"
                style="width:100%;padding:11px 12px 11px 36px;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;background:white;color:#191c1d;outline:none;box-sizing:border-box;transition:border-color 0.2s;appearance:none"
                onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'">
                <option value="">Seleccione un transportista...</option>
                ${(db.transports || []).map(t => `<option value="${t.id}">${escapeHtml(t.razonSocial || t.nombre || t.id)}</option>`).join('')}
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
  `;

  // Renderizar tabla
  renderUsersTable(users, container);

  // Búsqueda en tiempo real
  document.getElementById('users-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const db2 = getDatabase();
    const filtered = db2.users.filter(u =>
      (u.name || '').toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.role || '').toLowerCase().includes(query)
    );
    renderUsersTable(filtered, container, true);
  });

  // Abrir modal (nuevo usuario)
  document.getElementById('btn-open-add-user').addEventListener('click', () => {
    openModal();
  });

  // Cerrar modal
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-user').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-user')) closeModal();
  });

  // Selector de roles visual
  setupRoleSelector();

  // Submit del modal
  document.getElementById('modal-user-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveUser();
  });
}

function setupRoleSelector() {
  document.querySelectorAll('.role-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const role = opt.dataset.role;
      document.querySelectorAll('.role-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      // Marcar el radio correspondiente
      const radio = document.querySelector(`input[name="modal-role"][value="${role}"]`);
      if (radio) radio.checked = true;
      updateRoleFields(role);
    });
  });
}

// Actualiza la descripción del perfil y muestra/oculta los campos de
// "Centro Asociado" / "Transportista Asociado" según el rol seleccionado.
function updateRoleFields(role) {
  const descEl = document.getElementById('role-desc-text');
  if (descEl) descEl.textContent = ROLE_DESCRIPTIONS[role] || '';

  const fieldCentro = document.getElementById('field-centro');
  const fieldTransportista = document.getElementById('field-transportista');
  if (fieldCentro) fieldCentro.style.display = CENTRO_ROLES.includes(role) ? 'block' : 'none';
  if (fieldTransportista) fieldTransportista.style.display = TRANSPORTE_ROLES.includes(role) ? 'block' : 'none';
}

function openModal(userIdx = null) {
  const modal = document.getElementById('modal-user');
  const title = document.getElementById('modal-user-title');
  const editIdx = document.getElementById('modal-edit-idx');
  const nameInput = document.getElementById('modal-user-name');
  const emailInput = document.getElementById('modal-user-email');
  const errorDiv = document.getElementById('modal-user-error');
  const submitBtn = document.getElementById('btn-modal-submit');

  errorDiv.style.display = 'none';

  // Limpiar selección de roles
  document.querySelectorAll('.role-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('input[name="modal-role"]').forEach(r => r.checked = false);
  const centroSelect = document.getElementById('modal-user-centro');
  const transportistaSelect = document.getElementById('modal-user-transportista');
  if (centroSelect) centroSelect.value = '';
  if (transportistaSelect) transportistaSelect.value = '';

  let selectedRole = 'AGENTE_COMERCIAL';

  if (userIdx !== null) {
    // Modo edición
    const db = getDatabase();
    const user = db.users[userIdx];
    title.textContent = 'Editar Usuario';
    submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">save</span> Guardar Cambios';
    editIdx.value = userIdx;
    nameInput.value = user.name || '';
    emailInput.value = user.email || '';
    emailInput.readOnly = true;
    emailInput.style.background = '#f3f4f5';
    emailInput.style.cursor = 'not-allowed';

    // Seleccionar rol actual (normalizado a los 5 perfiles canónicos)
    selectedRole = normalizeRole(user.role);
    if (centroSelect && user.centroId) centroSelect.value = user.centroId;
    if (transportistaSelect && user.transportistaId) transportistaSelect.value = user.transportistaId;
  } else {
    // Modo creación
    title.textContent = 'Agregar Usuario';
    submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">person_add</span> Guardar Usuario';
    editIdx.value = '';
    nameInput.value = '';
    emailInput.value = '';
    emailInput.readOnly = false;
    emailInput.style.background = 'white';
    emailInput.style.cursor = 'text';
  }

  const roleOpt = document.querySelector(`.role-option[data-role="${selectedRole}"]`);
  if (roleOpt) {
    roleOpt.classList.add('selected');
    const radio = document.querySelector(`input[name="modal-role"][value="${selectedRole}"]`);
    if (radio) radio.checked = true;
  }
  updateRoleFields(selectedRole);

  modal.style.display = 'flex';
  nameInput.focus();
}

function closeModal() {
  document.getElementById('modal-user').style.display = 'none';
}

function saveUser() {
  const db = getDatabase();
  const editIdx = document.getElementById('modal-edit-idx').value;
  const name = document.getElementById('modal-user-name').value.trim();
  const email = document.getElementById('modal-user-email').value.trim().toLowerCase();
  const selectedRole = document.querySelector('input[name="modal-role"]:checked')?.value;
  const errorDiv = document.getElementById('modal-user-error');
  const errorText = document.getElementById('modal-user-error-text');

  const showErr = (msg) => {
    errorText.textContent = msg;
    errorDiv.style.display = 'flex';
  };

  if (!name) return showErr('El nombre es obligatorio.');
  if (!email.endsWith('@ebema.cl')) return showErr('El correo debe pertenecer al dominio @ebema.cl');
  if (!selectedRole) return showErr('Seleccione un rol de acceso.');

  // Centro / transportista asociado (según el perfil seleccionado)
  const centroId = document.getElementById('modal-user-centro')?.value || '';
  const transportistaId = document.getElementById('modal-user-transportista')?.value || '';

  if (CENTRO_ROLES.includes(selectedRole) && !centroId) {
    return showErr('Seleccione el Centro Asociado para este perfil.');
  }
  if (TRANSPORTE_ROLES.includes(selectedRole) && !transportistaId) {
    return showErr('Seleccione el Transportista Asociado para este perfil.');
  }

  // Limpiar asociaciones que no correspondan al perfil
  const finalCentroId = CENTRO_ROLES.includes(selectedRole) ? centroId : null;
  const finalTransportistaId = TRANSPORTE_ROLES.includes(selectedRole) ? transportistaId : null;

  if (editIdx === '') {
    // Crear usuario
    if (db.users.some(u => u.email === email)) return showErr('El correo ya se encuentra registrado.');
    db.users.push({ email, name, role: selectedRole, centroId: finalCentroId, transportistaId: finalTransportistaId, activo: true, lastAccess: 'Nunca' });
    showAlert(`Usuario ${name} registrado con éxito.`);
  } else {
    // Editar usuario
    const idx = parseInt(editIdx);
    if (db.users[idx]) {
      db.users[idx].name = name;
      db.users[idx].role = selectedRole;
      db.users[idx].centroId = finalCentroId;
      db.users[idx].transportistaId = finalTransportistaId;
      showAlert(`Perfil de ${name} actualizado.`);
    }
  }

  saveDatabase(db);
  closeModal();

  // Re-renderizar la vista completa
  const container = document.getElementById('stage-area');
  if (container) renderRolesView(container);
}

function renderUsersTable(usersList, viewContainer, isFiltered = false) {
  const tbody = document.getElementById('users-roles-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (usersList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:48px 20px;text-align:center;color:#5c5f61">
          <span class="material-symbols-outlined" style="font-size:40px;display:block;margin-bottom:8px;opacity:0.3">search_off</span>
          <p style="font-size:14px">No se encontraron usuarios</p>
        </td>
      </tr>
    `;
    return;
  }

  // Necesitamos el índice real en db.users para acciones
  const db = getDatabase();

  usersList.forEach((user, localIdx) => {
    // Índice real en la DB (para editar/toggle por índice)
    const realIdx = isFiltered
      ? db.users.findIndex(u => u.email === user.email)
      : localIdx;

    const normRole = normalizeRole(user.role);
    const rc = getRoleConfig(user.role);
    const [avatarBg, avatarText] = getAvatarPalette(user.email);
    const initials = getInitials(user.name);
    const isActive = user.activo !== false;

    // Normalizar nombre de rol para display (uno de los 5 perfiles canónicos)
    const roleDisplay = rc.label;

    // Centro o transportista asociado (según el perfil)
    let asociadoTxt = '';
    if (CENTRO_ROLES.includes(normRole) && user.centroId) {
      asociadoTxt = getCentreName(db, user.centroId) || '';
    } else if (TRANSPORTE_ROLES.includes(normRole) && user.transportistaId) {
      const t = (db.transports || []).find(t => t.id === user.transportistaId);
      asociadoTxt = t ? (t.razonSocial || t.nombre || '') : '';
    }

    const tr = document.createElement('tr');
    tr.className = 'user-row';
    tr.style.cssText = 'border-bottom:1px solid #f3f4f5;transition:background 0.15s';

    tr.innerHTML = `
      <td style="padding:14px 20px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:50%;background:${avatarBg};color:${avatarText};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;border:1px solid ${avatarBg}">
            ${initials}
          </div>
          <div>
            <p style="font-size:14px;font-weight:700;color:#191c1d;line-height:1.2">${user.name || '—'}</p>
            <p style="font-size:11px;color:#5c5f61;margin-top:2px">Último acceso: ${user.lastAccess || 'Nunca'}</p>
          </div>
        </div>
      </td>
      <td style="padding:14px 16px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#5c5f61">${user.email}</span>
      </td>
      <td style="padding:14px 16px">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};border-radius:20px;font-size:11px;font-weight:700">
          <span class="material-symbols-outlined" style="font-size:12px">${rc.icon}</span>
          ${roleDisplay}
        </span>
        ${asociadoTxt ? `<p style="font-size:10px;color:#5c5f61;margin-top:4px">${asociadoTxt}</p>` : ''}
      </td>
      <td style="padding:14px 16px;text-align:center">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;${isActive ? 'background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7' : 'background:#fce4e4;color:#b71c1c;border:1px solid #ef9a9a'}">
          <span style="width:5px;height:5px;border-radius:50%;background:${isActive ? '#43a047' : '#e53935'};display:inline-block"></span>
          ${isActive ? 'ACTIVO' : 'INACTIVO'}
        </span>
      </td>
      <td style="padding:14px 16px;text-align:center">
        <div style="display:inline-flex;align-items:center;gap:4px">
          <button class="btn-edit-user" data-idx="${realIdx}"
            title="Editar perfil"
            style="padding:6px;background:#f3f4f5;border:1px solid #e1e3e4;border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.background='#e7e8e9';this.style.borderColor='#b5000b'" onmouseout="this.style.background='#f3f4f5';this.style.borderColor='#e1e3e4'">
            <span class="material-symbols-outlined" style="font-size:16px;color:#5c5f61">edit</span>
          </button>
          <button class="btn-toggle-user" data-idx="${realIdx}"
            title="${isActive ? 'Desactivar usuario' : 'Activar usuario'}"
            style="padding:6px;background:${isActive ? '#fff8f7' : '#f0fdf4'};border:1px solid ${isActive ? '#ffb4aa' : '#a5d6a7'};border-radius:6px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s"
            onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'">
            <span class="material-symbols-outlined" style="font-size:16px;color:${isActive ? '#b5000b' : '#2e7d32'}">${isActive ? 'person_off' : 'how_to_reg'}</span>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Eventos: Editar usuario
  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
      openModal(idx);
      setupRoleSelector();
    });
  });

  // Eventos: Activar / Desactivar usuario
  tbody.querySelectorAll('.btn-toggle-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
      const db = getDatabase();
      const user = db.users[idx];
      if (!user) return;

      const session = JSON.parse(localStorage.getItem('ebema_user_session') || '{}');
      if (session.email === user.email) {
        showAlert('No puede desactivar su propio usuario activo.', 'error');
        return;
      }

      user.activo = user.activo === undefined ? false : !user.activo;
      saveDatabase(db);
      showAlert(`${user.name} ha sido ${user.activo ? 'activado' : 'desactivado'}.`);

      const stageContainer = document.getElementById('stage-area');
      if (stageContainer) renderRolesView(stageContainer);
    });
  });
}
