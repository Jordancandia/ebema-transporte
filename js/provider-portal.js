// Portal de Proveedores de Servicio — SIT EBEMA
// El proveedor solo ve su perfil y las fichas de SUS camiones (RLS lo garantiza en el servidor).
import { supabase } from './supabase-client.js';
import { getDatabase } from './data.js?v=20260622m';
import { showAlert, formatRut, formatPhone, escapeHtml } from './utils.js';
import { renderFichaTransporte } from './ficha-transporte.js';

const ESTADOS = {
  pendiente: { label: 'Pendiente de aprobación', color: '#92400e', bg: '#fef3c7', border: '#fbbf24', icon: 'schedule' },
  aprobado:  { label: 'Proveedor aprobado',      color: '#166534', bg: '#dcfce7', border: '#86efac', icon: 'verified' },
  rechazado: { label: 'Solicitud rechazada',     color: '#991b1b', bg: '#fee2e2', border: '#fca5a5', icon: 'block' }
};

// Shell completo del portal (topbar + área de contenido)
export function renderProviderShell(session, onLogout) {
  const appRoot = document.getElementById('app-root');
  appRoot.innerHTML = `
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
          <p style="font-size:13px;font-weight:700;color:#191c1d;line-height:1.1">${escapeHtml(session.name)}</p>
          <p style="font-size:11px;color:#5c5f61">${escapeHtml(session.email)}</p>
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
  `;

  document.getElementById('btn-provider-logout').addEventListener('click', onLogout);
  renderPortalHome(document.getElementById('stage-area'));
}

// Vista principal: estado + perfil + camiones
export async function renderPortalHome(container) {
  container.innerHTML = `<div style="text-align:center;padding:60px;color:#5c5f61">Cargando su información...</div>`;

  // Perfil del proveedor (RLS: solo su fila)
  const { data: provider, error } = await supabase.from('providers').select('*').limit(1).maybeSingle();
  if (error || !provider) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:#93000a">No se pudo cargar su perfil. Intente recargar la página.</div>`;
    return;
  }

  const estado = ESTADOS[provider.estado] || ESTADOS.pendiente;
  const db = getDatabase();
  const myTransports = (db.transports || []); // RLS ya filtró: solo sus camiones

  container.innerHTML = `
    <!-- Banner de estado -->
    <div style="display:flex;align-items:center;gap:14px;background:${estado.bg};border:1.5px solid ${estado.border};border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <span class="material-symbols-outlined" style="font-size:28px;color:${estado.color}">${estado.icon}</span>
      <div>
        <p style="font-size:16px;font-weight:800;color:${estado.color};line-height:1.2">${estado.label}</p>
        <p style="font-size:12px;color:${estado.color};opacity:0.85;margin-top:2px">${provider.estado === 'pendiente' ? 'Su solicitud está siendo revisada por el equipo de EBEMA.' : provider.estado === 'aprobado' ? 'Su empresa está habilitada para operar con EBEMA.' : 'Contacte a EBEMA para más información.'}</p>
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
          ${campo('Razón Social', 'p-razon', escapeHtml(provider.razonSocial), false)}
          ${campo('RUT Empresa', 'p-rut', escapeHtml(provider.rut), false)}
          ${campo('Correo de Contacto', 'p-email', escapeHtml(provider.email), false)}
          ${campo('Teléfono', 'p-telefono', escapeHtml(provider.telefono), true)}
          ${campo('Nombre Representante Legal', 'p-representante', escapeHtml(provider.representante), true, '2')}
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
        ${myTransports.length === 0 ? `
          <div style="text-align:center;padding:30px;color:#5c5f61">
            <span class="material-symbols-outlined" style="font-size:42px;color:#c5c7c9">no_transfer</span>
            <p style="font-size:14px;margin-top:10px">EBEMA aún no ha asociado camiones a su cuenta.</p>
            <p style="font-size:12px;margin-top:4px;color:#888">Los vehículos se asocian usando el correo <strong>${escapeHtml(provider.email)}</strong> como contacto del transporte.</p>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:10px">
            ${myTransports.map(t => `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e1e3e4;border-radius:10px;padding:14px 16px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:12px">
                  <span class="material-symbols-outlined" style="font-size:26px;color:#b5000b">local_shipping</span>
                  <div>
                    <p style="font-size:14px;font-weight:700;color:#191c1d">${escapeHtml(t.patente)} — ${escapeHtml(t.modelo) || 'Sin modelo'}</p>
                    <p style="font-size:12px;color:#5c5f61">${escapeHtml(t.capacidad)} Tons · Código ${escapeHtml(t.codigoSap) || '—'}</p>
                  </div>
                </div>
                <button class="btn-ver-ficha" data-id="${t.id}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#b5000b;color:white;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">
                  <span class="material-symbols-outlined" style="font-size:15px">folder_open</span>
                  Ver Ficha y Documentación
                </button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </section>
  `;

  // Formato automático del Teléfono (siempre con prefijo +56)
  document.getElementById('p-telefono').addEventListener('blur', (e) => {
    if (e.target.value.trim()) e.target.value = formatPhone(e.target.value);
  });

  // Guardar perfil (solo campos editables)
  document.getElementById('form-provider-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const telefono = formatPhone(document.getElementById('p-telefono').value.trim());
    const representante = document.getElementById('p-representante').value.trim();
    const { error: upErr } = await supabase.from('providers')
      .update({ telefono, representante })
      .eq('email', provider.email);
    if (upErr) {
      showAlert('No se pudo guardar: ' + upErr.message, 'error');
    } else {
      showAlert('Datos actualizados correctamente.');
    }
  });

  // Abrir ficha de un camión
  container.querySelectorAll('.btn-ver-ficha').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const title = document.getElementById('current-page-title');
      if (title) title.textContent = 'Ficha de Transporte';
      renderFichaTransporte(container, id);
    });
  });
}

function campo(label, id, value, editable, colSpan = '1') {
  const locked = !editable;
  const val = value !== undefined && value !== null ? value : '';
  return `
    <div style="grid-column:span ${colSpan}">
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}${locked ? ' <span style="color:#b5000b;font-size:9px">(bloqueado)</span>' : ''}</label>
      <input type="text" id="${id}" value="${val}" ${locked ? 'readonly' : ''}
        style="width:100%;padding:9px 12px;border:1.5px solid ${locked ? '#e9bcb6' : '#e1e3e4'};border-radius:7px;font-size:13px;color:${locked ? '#5c5f61' : '#191c1d'};background:${locked ? '#fdf5f4' : 'white'};outline:none;box-sizing:border-box;cursor:${locked ? 'not-allowed' : 'text'}" />
    </div>`;
}
