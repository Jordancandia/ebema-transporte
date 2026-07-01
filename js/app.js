import { getDatabase, saveDatabase, initDatabase } from './data.js?v=20260701c';
import { supabase } from './supabase-client.js';
import { renderTransportsView } from './transports.js';
import { renderRoutesView } from './routes.js';
import { renderRatesView } from './rates.js';
import { renderRolesView } from './roles.js';
import { renderTariffTransportView } from './tarifas-transporte.js?v=20260701c';
import { renderClientTariffView } from './tarifas-clientes.js?v=20260622b';
import { showAlert, formatRut, validateRut, formatPhone } from './utils.js';

const SESSION_KEY = 'ebema_user_session';
let currentSession = null;
let currentTab = 'rates'; // Cotizador activo por defecto

// Estado de la pantalla de autenticación ('login', 'register', 'recover')
let authState = 'login';

const appRoot = document.getElementById('app-root');

document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
  renderApp();
});

// Verificar sesión real en Supabase y cargar la base de datos compartida
async function checkSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      currentSession = null;
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const email = session.user.email.toLowerCase();
    const meta = session.user.user_metadata || {};

    // ===== RAMA PROVEEDOR DE SERVICIO (correo externo) =====
    if (!email.endsWith('@ebema.cl')) {
      await initDatabase(); // RLS solo le entrega SUS datos
      // Asegurar que existe su perfil de proveedor (creado desde los datos del registro)
      let { data: provider } = await supabase.from('providers').select('*').eq('email', email).maybeSingle();
      if (!provider) {
        // Los datos vienen de user_metadata, 100% controlados por el usuario externo en signUp().
        // Se validan y acotan ANTES de insertar en providers (el RUT/razonSocial quedan
        // bloqueados para edición posterior por el trigger anti-tamper).
        const rut = formatRut(meta.rut || '');
        if (!validateRut(rut)) {
          await supabase.auth.signOut();
          currentSession = null;
          localStorage.removeItem(SESSION_KEY);
          showAlert('El RUT registrado no es válido. Contacte a EBEMA para activar su cuenta.', 'error');
          return;
        }
        const newProvider = {
          email,
          razonSocial: (meta.razonSocial || meta.full_name || email.split('@')[0]).toString().slice(0, 120),
          rut,
          telefono: (meta.telefono || '').toString().slice(0, 30),
          representante: (meta.representante || '').toString().slice(0, 80),
          estado: 'pendiente'
        };
        const { error: insErr } = await supabase.from('providers').insert(newProvider);
        if (insErr) {
          console.error('No se pudo crear el perfil de proveedor:', insErr.message);
          await supabase.auth.signOut();
          currentSession = null;
          localStorage.removeItem(SESSION_KEY);
          showAlert('No se pudo activar su cuenta de proveedor. Contacte a EBEMA.', 'error');
          return;
        }
        provider = newProvider;
      }
      currentSession = { email, name: provider.razonSocial, role: 'proveedor', tipo: 'proveedor' };
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
      return;
    }

    // ===== RAMA FUNCIONARIO EBEMA =====
    await initDatabase();
    const db = getDatabase();
    let u = (db.users || []).find(x => x.email === email);

    // Primer ingreso (ej. vía Google): crear el perfil automáticamente
    if (!u) {
      const googleName = meta.full_name || meta.name;
      u = {
        email,
        name: googleName || email.split('@')[0].toUpperCase(),
        role: 'AGENTE_COMERCIAL', // rol canónico inicial (no privilegiado); un OWNER puede cambiarlo después
        activo: true,
        lastAccess: new Date().toLocaleDateString('es-CL')
      };
      db.users.push(u);
      // Upsert directo: no usar saveDatabase() aquí porque sincroniza TODOS los usuarios,
      // lo que genera errores RLS al intentar modificar filas de otros usuarios.
      // La policy app_users_insert permite auto-registro de la propia fila @ebema.cl.
      const { error: regErr } = await supabase.from('app_users').upsert(u);
      if (regErr) console.warn('No se pudo registrar perfil en Supabase:', regErr.message);
    } else {
      // Actualizar lastAccess en cada inicio de sesión
      u.lastAccess = new Date().toLocaleDateString('es-CL');
      await supabase.from('app_users').update({ lastAccess: u.lastAccess }).eq('email', email);
    }

    // Cuenta inhabilitada por el administrador
    if (u.activo === false) {
      await supabase.auth.signOut();
      currentSession = null;
      localStorage.removeItem(SESSION_KEY);
      showAlert('Su cuenta corporativa ha sido inhabilitada por el administrador.', 'error');
      return;
    }

    currentSession = { email, name: u.name, role: u.role, tipo: 'funcionario' };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
  } catch (err) {
    console.error('Error verificando sesión:', err);
    currentSession = null;
  }
}

// Avisar si una sincronización con el servidor falla
window.addEventListener('db_sync_error', (e) => {
  const detalle = e && e.detail ? ` (${e.detail})` : '';
  showAlert(`No se pudo sincronizar parte de los datos con el servidor. Cambios guardados solo localmente.${detalle}`, 'error');
});

function renderApp() {
  if (!currentSession) {
    renderAuthView();
  } else if (currentSession.tipo === 'proveedor') {
    import('./provider-portal.js').then(m => m.renderProviderShell(currentSession, handleLogout));
  } else {
    renderDashboardShell();
  }
}

// Cierre de sesión compartido (dashboard y portal de proveedores)
async function handleLogout() {
  await supabase.auth.signOut();
  localStorage.removeItem(SESSION_KEY);
  currentSession = null;
  currentTab = 'rates';
  authState = 'login';
  showAlert('Sesión finalizada.');
  renderApp();
}

// ==========================================================================
// PANTALLAS DE AUTENTICACIÓN (LOGIN, REGISTRO, RECUPERACIÓN)
// ==========================================================================
function renderAuthView() {
  if (authState === 'login') {
    renderLoginView();
  } else if (authState === 'register') {
    renderRegisterView();
  } else if (authState === 'recover') {
    renderRecoverView();
  }
}

// 1. Iniciar Sesión
function renderLoginView() {
  appRoot.innerHTML = `
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

          <div id="google-section">
          <!-- Separador -->
          <div style="display:flex;align-items:center;gap:12px;margin-top:22px">
            <div style="flex:1;height:1px;background:#e1e3e4"></div>
            <span style="font-size:12px;color:#5c5f61">o</span>
            <div style="flex:1;height:1px;background:#e1e3e4"></div>
          </div>

          <!-- Botón Google -->
          <button
            type="button"
            id="btn-login-google"
            style="width:100%;margin-top:18px;padding:12px;background:white;color:#191c1d;border:1.5px solid #e1e3e4;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:border-color 0.2s,background 0.2s;display:flex;align-items:center;justify-content:center;gap:10px"
            onmouseover="this.style.borderColor='#c5c7c9';this.style.background='#f8f9fa'"
            onmouseout="this.style.borderColor='#e1e3e4';this.style.background='white'"
          >
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
            Continuar con Google
          </button>
          <p style="font-size:11px;color:#5c5f61;text-align:center;margin-top:8px">Solo cuentas corporativas @ebema.cl</p>
          </div>

          <!-- Footer -->
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e9bcb6;text-align:center">
            <p style="font-size:13px;color:#5c5f61">¿Es proveedor y no tiene cuenta? <button id="link-go-register" style="color:#b5000b;background:none;border:none;cursor:pointer;font-weight:700;font-size:13px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Regístrese como Proveedor de Servicio</button></p>
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
  `;

  // Pestañas: Funcionarios EBEMA / Proveedores de Servicio
  let loginType = 'funcionario';
  const tabFunc = document.getElementById('tab-funcionario');
  const tabProv = document.getElementById('tab-proveedor');
  const googleSection = document.getElementById('google-section');
  const emailLabel = document.getElementById('login-email-label');
  const emailInput = document.getElementById('login-email');

  function setLoginTab(tipo) {
    loginType = tipo;
    const activeStyle = (btn) => {
      btn.style.background = 'white';
      btn.style.color = '#b5000b';
      btn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)';
    };
    const inactiveStyle = (btn) => {
      btn.style.background = 'transparent';
      btn.style.color = '#5c5f61';
      btn.style.boxShadow = 'none';
    };
    if (tipo === 'funcionario') {
      activeStyle(tabFunc); inactiveStyle(tabProv);
      googleSection.style.display = 'block';
      emailLabel.textContent = 'Correo Corporativo';
      emailInput.placeholder = 'usuario@ebema.cl';
    } else {
      activeStyle(tabProv); inactiveStyle(tabFunc);
      googleSection.style.display = 'none';
      emailLabel.textContent = 'Correo del Proveedor';
      emailInput.placeholder = 'contacto@suempresa.cl';
    }
  }
  tabFunc.addEventListener('click', () => setLoginTab('funcionario'));
  tabProv.addEventListener('click', () => setLoginTab('proveedor'));

  // Toggle ver/ocultar contraseña
  document.getElementById('toggle-login-pass').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const icon = document.querySelector('#toggle-login-pass .material-symbols-outlined');
    if (input.type === 'password') {
      input.type = 'text';
      icon.textContent = 'visibility_off';
    } else {
      input.type = 'password';
      icon.textContent = 'visibility';
    }
  });

  // Login con Google (Workspace de EBEMA)
  document.getElementById('btn-login-google').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: {
          hd: 'ebema.cl',           // Sugerir solo cuentas del dominio EBEMA
          prompt: 'select_account'  // Permitir elegir la cuenta
        }
      }
    });
    if (error) {
      showAlert('No se pudo iniciar con Google: ' + error.message, 'error');
    }
    // Si no hay error, el navegador redirige a Google y vuelve con sesión
  });

  document.getElementById('link-go-register').addEventListener('click', () => {
    authState = 'register';
    renderAuthView();
  });

  document.getElementById('link-go-recover').addEventListener('click', () => {
    authState = 'recover';
    renderAuthView();
  });

  const loginForm = document.getElementById('login-form');
  const loginErrorAlert = document.getElementById('login-error-alert');
  const loginErrorText = document.getElementById('login-error-text');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login-submit');
    btn.innerHTML = '<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Verificando...';
    btn.disabled = true;

    const showLoginError = (msg) => {
      loginErrorText.innerText = msg;
      loginErrorAlert.style.display = 'flex';
      loginErrorAlert.classList.remove('hidden');
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">login</span> Iniciar Sesión';
      btn.disabled = false;
    };

    if (loginType === 'funcionario' && !email.endsWith('@ebema.cl')) {
      return showLoginError('Acceso restringido. Utilice su correo corporativo @ebema.cl');
    }
    if (loginType === 'proveedor' && email.endsWith('@ebema.cl')) {
      return showLoginError('Los funcionarios EBEMA deben usar la pestaña "Funcionarios EBEMA".');
    }

    // Autenticación real contra Supabase Auth
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('invalid login credentials')) return showLoginError('Correo o contraseña incorrectos.');
      if (m.includes('email not confirmed')) return showLoginError('Debe confirmar su correo. Revise su bandeja de entrada.');
      return showLoginError('No se pudo iniciar sesión: ' + error.message);
    }

    // Resolver el perfil según tipo de cuenta (funcionario o proveedor)
    await checkSession();
    if (!currentSession) {
      return showLoginError('No se pudo cargar su perfil. Intente nuevamente.');
    }
    showAlert(`Bienvenido, ${currentSession.name}`);
    renderApp();
  });
}

// 2. Registro (Crear Cuenta Corporativa)
function renderRegisterView() {
  appRoot.innerHTML = `
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
  `;

  // Toggle contraseña
  document.getElementById('toggle-reg-pass').addEventListener('click', () => {
    const input = document.getElementById('reg-password');
    const icon = document.querySelector('#toggle-reg-pass .material-symbols-outlined');
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
  });

  // Indicador de fuerza de contraseña
  document.getElementById('reg-password').addEventListener('input', (e) => {
    const val = e.target.value;
    const bars = [1,2,3,4].map(n => document.getElementById(`str-bar-${n}`));
    const label = document.getElementById('str-label');
    let strength = 0;
    if (val.length >= 6) strength++;
    if (val.length >= 10) strength++;
    if (/[A-Z]/.test(val) && /[0-9]/.test(val)) strength++;
    if (/[^A-Za-z0-9]/.test(val)) strength++;
    const colors = ['#ba1a1a', '#f59e0b', '#10b981', '#059669'];
    const labels = ['Muy débil', 'Débil', 'Buena', 'Excelente'];
    bars.forEach((b, i) => { b.style.background = i < strength ? colors[strength - 1] : '#e1e3e4'; });
    label.textContent = val.length === 0 ? 'Ingrese una contraseña' : labels[strength - 1] || 'Muy débil';
    label.style.color = strength > 0 ? colors[strength - 1] : '#5c5f61';
  });

  ['link-back-login', 'link-back-login-footer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { authState = 'login'; renderAuthView(); });
  });

  const regErrorAlert = document.getElementById('register-error-alert');
  const regErrorText = document.getElementById('register-error-text');

  // Formato automático del RUT
  document.getElementById('reg-rut').addEventListener('blur', (e) => {
    e.target.value = formatRut(e.target.value);
  });

  // Formato automático del Teléfono (siempre con prefijo +56)
  document.getElementById('reg-telefono').addEventListener('blur', (e) => {
    if (e.target.value.trim()) e.target.value = formatPhone(e.target.value);
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const razonSocial = document.getElementById('reg-razonsocial').value.trim();
    const rut = formatRut(document.getElementById('reg-rut').value.trim());
    const telefono = formatPhone(document.getElementById('reg-telefono').value.trim());
    const representante = document.getElementById('reg-representante').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const pass = document.getElementById('reg-password').value;
    const confirmPass = document.getElementById('reg-confirm').value;
    const btn = document.getElementById('btn-reg-submit');

    const showErr = (msg) => {
      regErrorText.innerText = msg;
      regErrorAlert.style.display = 'flex';
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">person_add</span> Crear Cuenta de Proveedor';
      btn.disabled = false;
    };

    if (email.endsWith('@ebema.cl')) return showErr('Este registro es solo para proveedores externos. Los funcionarios EBEMA ingresan con Google.');
    if (!validateRut(rut)) return showErr('El RUT de la empresa no es válido');
    if (pass.length < 6) return showErr('La contraseña debe tener mínimo 6 caracteres');
    if (pass !== confirmPass) return showErr('Las contraseñas no coinciden');

    btn.innerHTML = '<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Creando cuenta...';
    btn.disabled = true;

    // Registro real en Supabase Auth (requiere confirmación por correo).
    // Los datos de la empresa viajan en los metadatos y se convierten en
    // el perfil de proveedor en el primer inicio de sesión.
    const { error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: { data: { tipo: 'proveedor', razonSocial, rut, telefono, representante } }
    });

    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('already registered')) return showErr('El correo ya se encuentra registrado');
      return showErr('No se pudo crear la cuenta: ' + error.message);
    }

    showAlert('Cuenta creada. Revise su correo para confirmar la cuenta antes de iniciar sesión.');
    authState = 'login';
    renderAuthView();
  });
}

// 3. Recuperar Clave
function renderRecoverView() {
  appRoot.innerHTML = `
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
  `;

  document.getElementById('link-back-login').addEventListener('click', () => {
    authState = 'login'; renderAuthView();
  });

  document.getElementById('btn-go-login')?.addEventListener('click', () => {
    authState = 'login'; renderAuthView();
  });

  document.getElementById('recover-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recover-email').value.trim().toLowerCase();
    const btn = document.getElementById('btn-recover-submit');

    if (!email.endsWith('@ebema.cl')) {
      showAlert('El correo debe ser de dominio corporativo @ebema.cl', 'error');
      return;
    }

    btn.innerHTML = '<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Enviando...';
    btn.disabled = true;

    // Envío real del correo de recuperación vía Supabase Auth
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) {
      showAlert('No se pudo enviar el correo: ' + error.message, 'error');
      btn.innerHTML = 'Enviar instrucciones';
      btn.disabled = false;
      return;
    }

    document.getElementById('recover-step-form').style.display = 'none';
    const successEl = document.getElementById('recover-step-success');
    successEl.style.display = 'block';
    document.getElementById('recover-email-display').textContent = email;

    document.getElementById('btn-go-login').addEventListener('click', () => {
      authState = 'login'; renderAuthView();
    });
  });
}

// ==========================================================================
// SHELL DEL DASHBOARD DE SIT EBEMA
// ==========================================================================
function renderDashboardShell() {
  appRoot.innerHTML = `
    <!-- SideNavBar Anchor -->
    <nav class="flex flex-col h-full py-lg px-md h-full w-64 fixed left-0 top-0 border-r border-surface-variant bg-surface z-50">
      <div class="mb-xl px-sm flex flex-col gap-xs">
        <h1 class="text-headline-sm font-headline-sm font-bold text-primary">SIT EBEMA</h1>
        <p class="text-label-caps font-label-caps text-secondary uppercase tracking-wider">Logistics Admin</p>
      </div>
      
      <div class="space-y-base flex-1" id="sidebar-nav-container">
        <!-- Cotizador (Costs) -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="rates" id="nav-rates">
          <span class="material-symbols-outlined">payments</span>
          <span class="font-body-md text-body-md">Cotizador</span>
        </a>

        <!-- Proveedores de Transporte -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="transports" id="nav-transports">
          <span class="material-symbols-outlined">groups</span>
          <span class="font-body-md text-body-md">Proveedores</span>
        </a>

        <!-- Rutas de Transporte (Routes + Centros SAP) -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="routes" id="nav-routes">
          <span class="material-symbols-outlined">route</span>
          <span class="font-body-md text-body-md">Rutas de Transporte</span>
        </a>

        <!-- Roles y Perfiles -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="roles" id="nav-roles">
          <span class="material-symbols-outlined">admin_panel_settings</span>
          <span class="font-body-md text-body-md">Roles y Perfiles</span>
        </a>


        <!-- Administrador de Tarifas Transporte -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="tarifas-transporte" id="nav-tarifas-transporte">
          <span class="material-symbols-outlined">calculate</span>
          <span class="font-body-md text-body-md">Tarifas Transporte</span>
        </a>

        <!-- Administrador de Tarifas Clientes -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="tarifas-clientes" id="nav-tarifas-clientes">
          <span class="material-symbols-outlined">request_quote</span>
          <span class="font-body-md text-body-md">Tarifas Clientes</span>
        </a>
      </div>

      <div class="mt-auto space-y-base border-t border-surface-variant pt-lg">

        <a class="flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" id="btn-logout">
          <span class="material-symbols-outlined">logout</span>
          <span class="font-body-md text-body-md">Logout</span>
        </a>
      </div>
    </nav>

    <!-- TopAppBar Anchor -->
    <header class="flex justify-between items-center h-16 w-full pl-72 pr-margin-desktop bg-surface/80 backdrop-blur-md sticky top-0 z-40 border-b border-surface-variant">
      <div class="flex items-center gap-md">
        <span class="text-headline-sm font-headline-sm font-black text-primary hidden md:block">SIT EBEMA</span>
        <div class="h-8 w-px bg-surface-variant mx-md"></div>
        <h2 class="text-headline-sm font-headline-sm text-on-surface" id="current-page-title">Cotizador de Tarifas</h2>
      </div>
      
      <div class="flex items-center gap-lg">
        <div class="relative hidden lg:block">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary">search</span>
          <input class="pl-10 pr-md py-2 bg-surface-container rounded-lg border-none text-body-md w-64 focus:ring-2 focus:ring-primary/20" placeholder="Buscar..." type="text"/>
        </div>
        
        <div class="flex items-center gap-sm">
          <button class="p-2 text-secondary hover:text-primary transition-colors hover:bg-surface-container rounded-full cursor-pointer">
            <span class="material-symbols-outlined">notifications</span>
          </button>
          <button class="p-2 text-secondary hover:text-primary transition-colors hover:bg-surface-container rounded-full cursor-pointer">
            <span class="material-symbols-outlined">help_outline</span>
          </button>
          
          <div class="ml-md flex items-center gap-sm border-l border-outline-variant pl-md">
            <img alt="Administrator Profile" class="w-8 h-8 rounded-full border border-surface-variant object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAAiTCyOhKKpto4TzfW6NIN1sv2OnD_9ISi9_9_tuiAbSovN5cnzTELz4Nql3oFKqQtKhma605ToY_Wn_NCRFbTTLlPwqO5mUsoaSuanYh8zDr7tuqBfaVDdqELWJ7hsYGQl0_xbHsbnSyfAJtiMUt8QMjibQpBCKP4HVz8EUYAGiIrmOly9grHxAaCVCvEcLusH9iewFzjlCHudJnFoLRiF6UTfElTfE36J3YYH5nQBtZlQWKZWewp0HE3B2ymMPHWw9X9ic394nY"/>
            <div class="hidden sm:block text-left">
              <p class="text-label-caps font-label-caps leading-none font-bold" id="topbar-user-name">${currentSession.name}</p>
              <p class="text-[10px] text-secondary">${currentSession.role}</p>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content Canvas -->
    <main class="ml-64 p-margin-desktop min-h-[calc(100vh-64px)] bg-background">
      <div id="stage-area">
        <!-- Inyectado dinámicamente -->
      </div>
    </main>
  `;

  // Cerrar Sesión (también en el servidor)
  document.getElementById('btn-logout').addEventListener('click', handleLogout);


  // Enrutamiento de pestañas del Sidebar
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const tabName = e.currentTarget.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  // Cargar pestaña inicial
  switchTab(currentTab);
}

function switchTab(tabName) {
  currentTab = tabName;

  // Restaurar clases inactivas
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.className = "sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer active:scale-95";
  });

  const activeNav = document.getElementById(`nav-${tabName}`);
  if (activeNav) {
    // Aplicar la clase activa de Google Stitch
    activeNav.className = "sidebar-item flex items-center gap-md px-md py-sm bg-primary-container text-on-primary-container rounded-lg font-semibold opacity-90 transition-all duration-150 cursor-pointer";
  }

  const pageTitle = document.getElementById('current-page-title');
  const stage = document.getElementById('stage-area');

  switch (tabName) {
    case 'rates':
      pageTitle.textContent = 'Cotizador de Tarifas';
      renderRatesView(stage);
      break;
    case 'transports':
      pageTitle.textContent = 'Gestión de Transportes';
      renderTransportsView(stage);
      break;
    case 'routes':
      pageTitle.textContent = 'Rutas de Transporte';
      renderRoutesView(stage);
      break;
    case 'roles':
      pageTitle.textContent = 'Roles y Perfiles';
      renderRolesView(stage);
      break;
    case 'tarifas-transporte':
      pageTitle.textContent = 'Administrador de Tarifas Transporte';
      renderTariffTransportView(stage);
      break;
    case 'tarifas-clientes':
      pageTitle.textContent = 'Administrador de Tarifas Clientes';
      renderClientTariffView(stage);
      break;
  }
}

// Exponer utilidad de limpieza en consola
