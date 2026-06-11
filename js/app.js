import { getDatabase } from './data.js';
import { renderTransportsView } from './transports.js';
import { renderRoutesView } from './routes.js';
import { renderLogisticsView } from './logistics.js';
import { renderRatesView } from './rates.js';
import { showAlert } from './utils.js';

// Inicializar base de datos
getDatabase();

const SESSION_KEY = 'ebema_user_session';
let currentSession = null;
let currentTab = 'rates'; // Cotizador de Tarifas activo por defecto, coincidiendo con la pantalla solicitada

const appRoot = document.getElementById('app-root');

document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  renderApp();
});

function checkSession() {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    currentSession = JSON.parse(session);
  } else {
    currentSession = null;
  }
}

function renderApp() {
  if (!currentSession) {
    renderLoginView();
  } else {
    renderDashboardShell();
  }
}

// ==========================================================================
// VISTA DE LOGIN (ESTILO SIT EBEMA CON TAILWIND)
// ==========================================================================
function renderLoginView() {
  appRoot.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-md py-xl">
      <div class="max-w-md w-full bg-white border border-outline-variant p-lg shadow-md rounded-xl space-y-lg">
        
        <!-- Logo y Título -->
        <div class="text-center space-y-xs">
          <div class="w-16 h-16 bg-primary text-white font-extrabold rounded-xl flex items-center justify-center text-3xl mx-auto shadow-md">
            E
          </div>
          <h1 class="font-headline-md text-headline-md font-bold text-on-surface">SIT EBEMA</h1>
          <p class="font-body-md text-secondary">Plataforma de Administración y Tarifas</p>
        </div>

        <div id="login-error-alert" class="p-sm bg-error-container text-on-error-container text-xs border border-error/20 rounded hidden flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px]">error</span>
          <span id="login-error-text"></span>
        </div>

        <!-- Formulario -->
        <form id="login-form" class="space-y-md">
          <div class="space-y-xs">
            <label for="login-email" class="font-label-caps text-label-caps text-secondary block">CORREO CORPORATIVO</label>
            <input 
              type="email" 
              id="login-email" 
              class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" 
              placeholder="usuario@ebema.cl" 
              required
            >
          </div>

          <div class="space-y-xs">
            <label for="login-password" class="font-label-caps text-label-caps text-secondary block">CONTRASEÑA CORPORATIVA</label>
            <input 
              type="password" 
              id="login-password" 
              class="w-full border border-[#CED4DA] p-sm font-body-md text-body-md focus:border-primary focus:ring-0 transition-all rounded bg-white" 
              placeholder="••••••••" 
              required
            >
          </div>

          <button type="submit" class="w-full bg-primary hover:bg-[#930007] text-white font-bold py-sm rounded transition-all cursor-pointer shadow">
            Iniciar Sesión
          </button>
        </form>
      </div>
    </div>
  `;

  const loginForm = document.getElementById('login-form');
  const loginErrorAlert = document.getElementById('login-error-alert');
  const loginErrorText = document.getElementById('login-error-text');

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();

    // Lógica de validación corporativa
    const isCorpEmail = email.endsWith('@ebema.cl');

    if (!isCorpEmail) {
      loginErrorText.innerText = 'Acceso restringido. Utilice su correo corporativo @ebema.cl';
      loginErrorAlert.classList.remove('hidden');
      return;
    }

    const userSession = {
      email: email,
      name: email.split('@')[0].toUpperCase(),
      role: email.includes('admin') ? 'Control Operativo' : 'Operaciones Logísticas'
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
    currentSession = userSession;

    showAlert(`Sesión iniciada como ${userSession.name}`);
    renderApp();
  });
}

// ==========================================================================
// SHELL DEL DASHBOARD DE SIT EBEMA
// ==========================================================================
function renderDashboardShell() {
  appRoot.innerHTML = `
    <!-- SideNavBar Shell -->
    <aside class="fixed left-0 top-0 h-full flex flex-col h-screen w-64 border-r border-outline-variant bg-surface z-50">
      <div class="p-md border-b border-outline-variant flex flex-col gap-xs">
        <span class="font-headline-sm text-headline-sm font-bold text-primary">SIT EBEMA</span>
        <span class="font-body-md text-body-md text-secondary">Logistics Management</span>
      </div>
      
      <nav class="flex-1 py-md overflow-y-auto space-y-xs">
        <!-- Cotizador (Costs) -->
        <div class="sidebar-item flex items-center gap-md text-secondary hover:bg-surface-container-high transition-colors px-md py-sm cursor-pointer active:opacity-80" data-tab="rates" id="nav-rates">
          <span class="material-symbols-outlined">payments</span>
          <span class="font-body-md text-body-md font-label-caps">Cotizador</span>
        </div>

        <!-- Transportistas (Transports) -->
        <div class="sidebar-item flex items-center gap-md text-secondary hover:bg-surface-container-high transition-colors px-md py-sm cursor-pointer active:opacity-80" data-tab="transports" id="nav-transports">
          <span class="material-symbols-outlined">local_shipping</span>
          <span class="font-body-md text-body-md font-label-caps">Transportes</span>
        </div>

        <!-- Rutas (Routes) -->
        <div class="sidebar-item flex items-center gap-md text-secondary hover:bg-surface-container-high transition-colors px-md py-sm cursor-pointer active:opacity-80" data-tab="routes" id="nav-routes">
          <span class="material-symbols-outlined">route</span>
          <span class="font-body-md text-body-md font-label-caps font-bold">Rutas</span>
        </div>

        <!-- Direcciones / CDs (Addresses) -->
        <div class="sidebar-item flex items-center gap-md text-secondary hover:bg-surface-container-high transition-colors px-md py-sm cursor-pointer active:opacity-80" data-tab="logistics" id="nav-logistics">
          <span class="material-symbols-outlined">location_on</span>
          <span class="font-body-md text-body-md font-label-caps">Centros SAP</span>
        </div>
      </nav>

      <!-- Logotipo Footer y Botón Cerrar Sesión -->
      <div class="p-md mt-auto border-t border-outline-variant space-y-md">
        <div class="flex items-center justify-between text-xs text-secondary">
          <div>
            <p class="font-bold text-on-surface leading-none">${currentSession.name}</p>
            <p class="text-[10px] opacity-75">${currentSession.role}</p>
          </div>
          <button id="btn-logout" class="text-primary hover:text-red-700 flex items-center gap-xs cursor-pointer bg-transparent border-none">
            <span class="material-symbols-outlined text-[16px]">logout</span>
          </button>
        </div>
        
        <div class="flex justify-center">
          <img alt="EBEMA Logo" class="h-6 object-contain filter grayscale opacity-45" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCX6vaoBm4uTcctJ9LQ_NdCcthUj_n7foJNufSUyUJiON2kZEEvb3UwSDy7WkdEeP0XkixkBtmRwDfymWhdhMxU7VzoUwqH17_s2K77qVRruMYBBJbzylJ0b3uJLmKB0_m_E28HRnUoYf9pvmm-c1B6vv1xiT1AhH_HgkXKmtJCQSMxmhuTRRVwcX6-wAQV9M63ScbxnL0aKfTRPqu3OcuViZvntMqKMGpV_H_W0U_553Kq8Xlmg1nucaU7GqEXAILnnrRBV9BliJg"/>
        </div>
      </div>
    </aside>

    <!-- TopNavBar Shell -->
    <header class="fixed top-0 right-0 left-64 h-16 flex justify-between items-center px-lg bg-surface border-b border-outline-variant z-40">
      <div class="flex items-center gap-md flex-1">
        <div class="relative w-96 focus-within:ring-2 focus-within:ring-primary rounded-lg overflow-hidden">
          <span class="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-secondary">search</span>
          <input class="w-full bg-surface-container-low border-none pl-10 pr-md py-xs font-body-md text-body-md focus:outline-none" placeholder="Buscar guías, rutas o transportes..." type="text"/>
        </div>
      </div>
      <div class="flex items-center gap-lg">
        <div class="flex gap-md">
          <span class="material-symbols-outlined text-secondary hover:text-primary cursor-pointer transition-colors" title="Notificaciones">notifications</span>
          <span class="material-symbols-outlined text-secondary hover:text-primary cursor-pointer transition-colors" title="Configuración">settings</span>
        </div>
        <div class="flex items-center gap-sm border-l border-outline-variant pl-lg">
          <div class="text-right hidden sm:block">
            <p class="font-body-md text-body-md font-bold text-on-surface leading-tight">Admin Ebema</p>
            <p class="font-label-caps text-label-caps text-secondary">Control Operativo</p>
          </div>
          <img alt="User profile photo" class="w-10 h-10 rounded-full border border-outline-variant object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRFHJbXGNKVbHm7RNOX4bWHc3XaRu5LZ7EjxeoWOznluth2v6OLt55JedMINMC3obM6As49yFlAgZ1Tx_Syt297-N_b3mIG1jW6LQ7gbIKLxpOtKSpv5w1BYECELivxnlTyaMqaorObxbMo1qI5bw5VGlkyYg4icJewVPQF5OdfCDpzWOZdrVRscsMD_X8BzyWDOtl8uxufo3DtrceNIEf8UQDED8tnjJKQy9DGfay9E5QWDk2bvaFK92KRPZKgk77_lM7AjH9kr0"/>
        </div>
      </div>
    </header>

    <!-- Main Content Canvas -->
    <main class="ml-64 pt-16 min-h-screen bg-background">
      <div class="p-xl max-w-7xl mx-auto" id="stage-area">
        <!-- Inyectado dinámicamente -->
      </div>
    </main>
  `;

  // Cerrar Sesión
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    currentSession = null;
    currentTab = 'rates';
    showAlert('Sesión finalizada.');
    renderApp();
  });

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

  // Actualizar estilos activos de los ítems de navegación
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.className = "sidebar-item flex items-center gap-md text-secondary hover:bg-surface-container-high transition-colors px-md py-sm cursor-pointer active:opacity-80";
  });

  const activeNav = document.getElementById(`nav-${tabName}`);
  if (activeNav) {
    // Aplicar estilo de pestaña activa (borde izquierdo rojo y fondo)
    activeNav.className = "sidebar-item flex items-center gap-md bg-secondary-container text-primary border-l-4 border-primary px-md py-sm active:opacity-80 transition-all font-bold";
  }

  const stage = document.getElementById('stage-area');

  switch (tabName) {
    case 'rates':
      renderRatesView(stage);
      break;
    case 'transports':
      renderTransportsView(stage);
      break;
    case 'routes':
      renderRoutesView(stage);
      break;
    case 'logistics':
      renderLogisticsView(stage);
      break;
  }
}
