import { getDatabase } from './data.js';
import { renderTransportsView } from './transports.js';
import { renderRoutesView } from './routes.js';
import { renderLogisticsView } from './logistics.js';
import { renderRatesView } from './rates.js';
import { showAlert } from './utils.js';

// Inicializar la Base de Datos al arrancar
getDatabase();

// Claves de localStorage para sesión
const SESSION_KEY = 'ebema_user_session';

// Estado global de la aplicación
let currentSession = null;
let currentTab = 'transports'; // Vista inicial por defecto

// Elemento contenedor principal del DOM
const appRoot = document.getElementById('app-root');

// Ejecución Inicial al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  renderApp();
});

// Comprobar si existe una sesión activa
function checkSession() {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    currentSession = JSON.parse(session);
  } else {
    currentSession = null;
  }
}

// Renderizar la interfaz según la sesión
function renderApp() {
  if (!currentSession) {
    renderLoginView();
  } else {
    renderDashboardShell();
  }
}

// ==========================================================================
// VISTA DE LOGIN (AUTENTICACIÓN CORPORATIVA)
// ==========================================================================
function renderLoginView() {
  appRoot.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <div class="logo-icon">E</div>
          <h1>Ebema <span>Logística</span></h1>
          <p>Plataforma de Administración de Transporte</p>
        </div>
        
        <div id="login-error-alert" class="login-alert alert-danger" style="display: none;">
          <!-- Mensaje de error inyectado dinámicamente -->
        </div>

        <form id="login-form">
          <div class="form-group">
            <label for="login-email">Correo Corporativo</label>
            <input 
              type="email" 
              id="login-email" 
              class="form-control" 
              placeholder="usuario@ebema.cl" 
              required
            >
          </div>
          
          <div class="form-group" style="margin-bottom: 25px;">
            <label for="login-password">Contraseña Corporativa</label>
            <input 
              type="password" 
              id="login-password" 
              class="form-control" 
              placeholder="••••••••" 
              required
            >
          </div>

          <button type="submit" class="btn-primary" id="btn-submit-login">
            Iniciar Sesión
          </button>
        </form>
      </div>
    </div>
  `;

  const loginForm = document.getElementById('login-form');
  const loginErrorAlert = document.getElementById('login-error-alert');

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    
    // Validación Corporativa MVP
    // Para simplificar, permitimos cualquier correo que termine en @ebema.cl
    const isCorpEmail = email.endsWith('@ebema.cl');

    if (!isCorpEmail) {
      loginErrorAlert.innerText = 'Acceso Restringido. Utilice su correo corporativo @ebema.cl';
      loginErrorAlert.style.display = 'flex';
      return;
    }

    // Guardar sesión corporativa simulada
    const userSession = {
      email: email,
      name: email.split('@')[0].toUpperCase(),
      role: email.includes('admin') ? 'Administrador' : 'Operador Logístico'
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
    currentSession = userSession;
    
    showAlert(`Bienvenido, ${userSession.name}`);
    renderApp();
  });
}

// ==========================================================================
// VISTA DEL DASHBOARD COMPLETO (SHELL + SIDEBAR)
// ==========================================================================
function renderDashboardShell() {
  appRoot.innerHTML = `
    <div class="app-shell">
      <!-- SIDEBAR IZQUIERDO -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-icon">E</div>
          <h2>Ebema <span>Transporte</span></h2>
        </div>
        
        <nav class="sidebar-menu">
          <div class="menu-item active" data-tab="transports" id="menu-transports">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Administrar Transportes
          </div>

          <div class="menu-item" data-tab="routes" id="menu-routes">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Administrar Rutas
          </div>

          <div class="menu-item" data-tab="logistics" id="menu-logistics">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Centros Logísticos (CD)
          </div>

          <div class="menu-item" data-tab="rates" id="menu-rates">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Matriz de Tarifas
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="user-profile">
            <div class="user-avatar">
              ${currentSession.name.charAt(0)}
            </div>
            <div class="user-info">
              <span class="user-name">${currentSession.name}</span>
              <span class="user-role">${currentSession.role}</span>
            </div>
          </div>
          <button id="btn-logout" class="btn-logout">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <!-- CONTENIDOR DE VISTAS PRINCIPAL -->
      <main class="main-content">
        <header class="topbar">
          <div class="page-title">
            <h3 id="current-page-title">Administración de Transportistas</h3>
          </div>
          <div class="topbar-actions">
            <span class="badge-corp">Ebema Corporativo</span>
          </div>
        </header>

        <!-- ESPACIO DE VISTA ACTIVA -->
        <section class="stage-area" id="stage-area">
          <!-- Inyectado dinámicamente mediante JS -->
        </section>
      </main>
    </div>
  `;

  // Registrar Cierre de Sesión
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    currentSession = null;
    currentTab = 'transports';
    showAlert('Sesión cerrada correctamente');
    renderApp();
  });

  // Configurar Enrutamiento de Pestañas (Tab Navigation)
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const selectedTab = e.currentTarget.getAttribute('data-tab');
      switchTab(selectedTab);
    });
  });

  // Cargar vista inicial (Transportes)
  switchTab(currentTab);
}

// Cambiar de vista activa
function switchTab(tabName) {
  currentTab = tabName;
  
  // Actualizar estilos activos en el menú
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeMenu = document.querySelector(`.menu-item[data-tab="${tabName}"]`);
  if (activeMenu) {
    activeMenu.classList.add('active');
  }

  // Actualizar título de la página
  const pageTitle = document.getElementById('current-page-title');
  const stage = document.getElementById('stage-area');

  switch (tabName) {
    case 'transports':
      pageTitle.textContent = 'Administración de Transportistas';
      renderTransportsView(stage);
      break;
    case 'routes':
      pageTitle.textContent = 'Administración de Rutas Logísticas';
      renderRoutesView(stage);
      break;
    case 'logistics':
      pageTitle.textContent = 'Centros Logísticos Ebema';
      renderLogisticsView(stage);
      break;
    case 'rates':
      pageTitle.textContent = 'Matriz de Tarifas y Simulador';
      renderRatesView(stage);
      break;
  }
}
