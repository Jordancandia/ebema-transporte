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
let currentTab = 'rates'; // Cotizador activo por defecto

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
      <div class="max-w-md w-full bg-white border border-outline-variant p-lg shadow-sm rounded-xl space-y-lg">
        
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

    const isCorpEmail = email.endsWith('@ebema.cl');

    if (!isCorpEmail) {
      loginErrorText.innerText = 'Acceso restringido. Utilice su correo corporativo @ebema.cl';
      loginErrorAlert.classList.remove('hidden');
      return;
    }

    const userSession = {
      email: email,
      name: email.split('@')[0].toUpperCase(),
      role: email.includes('admin') ? 'Admin SIT' : 'Logistics Operator'
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
    currentSession = userSession;

    showAlert(`Sesión iniciada como ${userSession.name}`);
    renderApp();
  });
}

// ==========================================================================
// SHELL DEL DASHBOARD DE SIT EBEMA (IDÉNTICO A GOOGLE STITCH)
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

        <!-- Transportistas (Transports) -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="transports" id="nav-transports">
          <span class="material-symbols-outlined">local_shipping</span>
          <span class="font-body-md text-body-md">Transportes</span>
        </a>

        <!-- Rutas (Routes) -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="routes" id="nav-routes">
          <span class="material-symbols-outlined">route</span>
          <span class="font-body-md text-body-md">Rutas</span>
        </a>

        <!-- Direcciones / CDs (Addresses) -->
        <a class="sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer" data-tab="logistics" id="nav-logistics">
          <span class="material-symbols-outlined">location_on</span>
          <span class="font-body-md text-body-md">Centros SAP</span>
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

  // Restaurar clases inactivas
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.className = "sidebar-item flex items-center gap-md px-md py-sm text-secondary hover:text-primary hover:bg-surface-container-high transition-colors rounded-lg cursor-pointer active:scale-95";
  });

  const activeNav = document.getElementById(`nav-${tabName}`);
  if (activeNav) {
    // Aplicar la clase activa de Google Stitch exacta (bg-primary-container y text-on-primary-container)
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
      pageTitle.textContent = 'Gestión de Rutas';
      renderRoutesView(stage);
      break;
    case 'logistics':
      pageTitle.textContent = 'Gestión de Centros';
      renderLogisticsView(stage);
      break;
  }
}
