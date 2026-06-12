import { getDatabase, saveDatabase } from './data.js';
import { formatRut, showAlert } from './utils.js';

const REGIONES_CHILE = [
  'Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo',
  'Valparaíso','Metropolitana','Libertador General Bernardo O\'Higgins',
  'Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo','Magallanes y Antártica Chilena'
];

const DOCS_CONFIG = [
  { key: 'permisoCirculacion', label: 'Permiso de Circulación',       icon: 'description' },
  { key: 'seguroCarga',        label: 'Seguro de Carga',               icon: 'security' },
  { key: 'padron',             label: 'Padrón del Vehículo',           icon: 'badge' },
  { key: 'soap',               label: 'SOAP',                          icon: 'health_and_safety' },
  { key: 'certificadoEmision', label: 'Certificado de Emisión de Gases', icon: 'air' }
];

// Calcula el estado general del transporte
function calcularEstado(t) {
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  let alerts = [];

  // Verificar documentos vencidos o sin fecha
  const docs = t.documentos || {};
  DOCS_CONFIG.forEach(d => {
    const doc = docs[d.key] || {};
    if (!doc.hasta) {
      alerts.push(`${d.label}: sin fecha de vigencia`);
    } else {
      const hasta = new Date(doc.hasta);
      if (hasta < hoy) alerts.push(`${d.label}: VENCIDO`);
    }
    if (!doc.desde) alerts.push(`${d.label}: sin fecha desde`);
  });

  // Verificar conductor
  const c = t.conductor || {};
  if (!c.nombre) alerts.push('Conductor: sin nombre');
  if (!c.rut) alerts.push('Conductor: sin RUT');
  if (!c.licencia) alerts.push('Conductor: sin número de licencia');

  // Verificar datos básicos
  if (!t.modelo) alerts.push('Vehículo: sin modelo');

  return alerts.length === 0
    ? { status: 'ok',    label: 'Aprobado',   color: '#16a34a', bg: '#dcfce7', border: '#86efac' }
    : { status: 'alert', label: 'Alerta',     color: '#d97706', bg: '#fef3c7', border: '#fbbf24', alerts };
}

function formatDateForInput(str) {
  if (!str) return '';
  // Convierte "YYYY-MM-DD" a "YYYY-MM-DD" (ya está bien para type=date)
  return str.slice(0, 10);
}

function formatDateForDisplay(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isVencido(hastaStr) {
  if (!hastaStr) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return new Date(hastaStr) < hoy;
}

function docStatusStyle(doc) {
  if (!doc || !doc.hasta) return { bg: '#fef9c3', text: '#92400e', label: 'Sin Fecha', icon: 'warning' };
  if (isVencido(doc.hasta)) return { bg: '#fee2e2', text: '#991b1b', label: 'Vencido', icon: 'error' };
  // Próximo a vencer (< 30 días)
  const diasRestantes = Math.ceil((new Date(doc.hasta) - new Date()) / 86400000);
  if (diasRestantes <= 30) return { bg: '#fef3c7', text: '#92400e', label: `${diasRestantes}d`, icon: 'schedule' };
  return { bg: '#dcfce7', text: '#166534', label: 'Vigente', icon: 'check_circle' };
}

export function renderFichaTransporte(container, transportId) {
  const db = getDatabase();
  const t = db.transports.find(x => x.id === transportId);
  if (!t) {
    container.innerHTML = `<div class="p-xl text-center text-secondary">Transporte no encontrado.</div>`;
    return;
  }

  const estado = calcularEstado(t);
  const docs = t.documentos || {};
  const conductor = t.conductor || {};
  const dim = t.dimensiones || {};

  container.innerHTML = `
    <!-- ===== HEADER DE LA FICHA ===== -->
    <div style="margin-bottom:28px">
      <!-- Breadcrumb -->
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#5c5f61;margin-bottom:16px">
        <button id="btn-back-transports" style="background:none;border:none;cursor:pointer;color:#b5000b;font-weight:700;font-size:13px;padding:0;display:flex;align-items:center;gap:4px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
          <span class="material-symbols-outlined" style="font-size:15px">arrow_back</span>
          Transportes
        </button>
        <span class="material-symbols-outlined" style="font-size:14px;color:#c5c7c9">chevron_right</span>
        <span style="color:#191c1d;font-weight:600">${t.razonSocial}</span>
      </div>

      <!-- Título + Estado -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <h1 style="font-size:28px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:4px">Ficha de Transporte</h1>
          <p style="font-size:14px;color:#5c5f61">Administración de Transporte / Detalle de Flota</p>
        </div>

        <!-- Badge de Estado -->
        <div style="display:flex;align-items:center;gap:12px;background:${estado.bg};border:1.5px solid ${estado.border};border-radius:12px;padding:12px 20px">
          <div style="width:14px;height:14px;border-radius:50%;background:${estado.color};box-shadow:0 0 0 4px ${estado.bg},0 0 0 6px ${estado.color}40;flex-shrink:0"></div>
          <div>
            <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${estado.color};line-height:1">Estado del Expediente</p>
            <p style="font-size:18px;font-weight:800;color:${estado.color};line-height:1.2;margin-top:2px">${estado.status === 'ok' ? '✓ Aprobado / Completo' : '⚠ Alerta Documental'}</p>
            ${estado.alerts ? `<p style="font-size:11px;color:${estado.color};margin-top:4px;opacity:0.8">${estado.alerts.length} observaci${estado.alerts.length === 1 ? 'ón' : 'ones'} pendiente${estado.alerts.length === 1 ? '' : 's'}</p>` : ''}
          </div>
        </div>
      </div>

      ${estado.alerts ? `
      <!-- Lista de alertas -->
      <div style="margin-top:16px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#92400e;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span class="material-symbols-outlined" style="font-size:14px">warning</span>
          Observaciones que requieren atención
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${estado.alerts.map(a => `<span style="padding:3px 10px;background:#fef3c7;border:1px solid #fbbf24;border-radius:20px;font-size:11px;color:#78350f;font-weight:600">${a}</span>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- ===== CONTENIDO EN 2 COLUMNAS ===== -->
    <div style="display:grid;grid-template-columns:1fr;gap:20px" id="ficha-grid">

      <!-- ===== SECCIÓN 1: DATOS DEL PROVEEDOR ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:#ffdad5;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:18px;color:#b5000b">business</span>
          </div>
          <div>
            <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Datos del Proveedor</h2>
            <p style="font-size:12px;color:#5c5f61;margin-top:2px">Información de la empresa de transportes</p>
          </div>
        </div>
        <div style="padding:20px">
          <form id="form-proveedor" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${fieldGroup('Razón Social', 'f-razon', t.razonSocial, 'text', false)}
            ${fieldGroup('RUT Proveedor', 'f-rut', t.rut, 'text', false)}
            ${fieldGroup('Dirección', 'f-dir', t.direccion, 'text', true, '2')}
            ${fieldGroup('Comuna', 'f-comuna', t.comuna, 'text', true)}
            ${selectGroup('Región', 'f-region', t.region)}
            ${fieldGroup('Correo Electrónico', 'f-email', t.email, 'email', true)}
            ${fieldGroup('Teléfono', 'f-tel', t.telefono, 'text', true)}
            <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#b5000b;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#930007'" onmouseout="this.style.background='#b5000b'">
                <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Cambios
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- ===== SECCIÓN 2: CARACTERÍSTICAS TÉCNICAS ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:#e8f5e9;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:18px;color:#2e7d32">local_shipping</span>
          </div>
          <div>
            <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Características Técnicas del Vehículo</h2>
            <p style="font-size:12px;color:#5c5f61;margin-top:2px">Atributos físicos del camión para la matriz de tarifas</p>
          </div>
        </div>
        <div style="padding:20px">
          <form id="form-vehiculo" style="display:flex;flex-direction:column;gap:14px">
            <!-- Datos base -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              ${fieldGroupLocked('Patente', t.patente)}
              ${fieldGroup('Modelo / Descripción', 'f-modelo', t.modelo, 'text', true)}
              ${fieldGroup('Año de Fabricación', 'f-anio', t.anio, 'number', true)}
              ${fieldGroupLocked('Capacidad (Tons)', `${t.capacidad} Tons`)}
            </div>

            <!-- Dimensiones de Rampla -->
            <div style="padding:14px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
              <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:12px;display:flex;align-items:center;gap:6px">
                <span class="material-symbols-outlined" style="font-size:14px">straighten</span>
                Dimensiones de Rampla / Carrocería
              </p>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                ${fieldGroup('Largo (metros)', 'f-largo', dim.largo, 'number', true)}
                ${fieldGroup('Ancho (metros)', 'f-ancho', dim.ancho, 'number', true)}
                ${fieldGroup('Alto (metros)', 'f-alto', dim.alto, 'number', true)}
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#2e7d32;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#1b5e20'" onmouseout="this.style.background='#2e7d32'">
                <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Cambios
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- ===== SECCIÓN 3: DOCUMENTACIÓN OBLIGATORIA ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:#e8eaf6;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:18px;color:#3949ab">folder_open</span>
          </div>
          <div>
            <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Documentación Obligatoria del Vehículo</h2>
            <p style="font-size:12px;color:#5c5f61;margin-top:2px">5 documentos requeridos con control de vigencia</p>
          </div>
        </div>
        <div style="padding:20px">
          <form id="form-documentos" style="display:flex;flex-direction:column;gap:12px">
            ${DOCS_CONFIG.map(docCfg => {
              const doc = docs[docCfg.key] || {};
              const st = docStatusStyle(doc);
              return `
              <div style="border:1.5px solid ${isVencido(doc.hasta) ? '#fca5a5' : (!doc.hasta ? '#fcd34d' : '#e1e3e4')};border-radius:10px;overflow:hidden;transition:all 0.2s">
                <!-- Header del documento -->
                <div style="padding:12px 16px;background:${isVencido(doc.hasta) ? '#fef2f2' : (!doc.hasta ? '#fffbeb' : '#f8f9fa')};display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span class="material-symbols-outlined" style="font-size:20px;color:#3949ab">${docCfg.icon}</span>
                    <span style="font-size:14px;font-weight:700;color:#191c1d">${docCfg.label}</span>
                  </div>
                  <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:${st.bg};color:${st.text};border-radius:20px;font-size:11px;font-weight:700;border:1px solid ${st.text}20">
                    <span class="material-symbols-outlined" style="font-size:12px">${st.icon}</span>
                    ${st.label}
                  </span>
                </div>

                <!-- Controles del documento -->
                <div style="padding:14px 16px;display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:end;flex-wrap:wrap">
                  <!-- Botón subir archivo -->
                  <div>
                    <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">Archivo PDF / Imagen</label>
                    <div style="position:relative">
                      <input type="file" id="file-${docCfg.key}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" data-dockey="${docCfg.key}" />
                      <button type="button" onclick="document.getElementById('file-${docCfg.key}').click()"
                        style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px dashed #c5c7c9;border-radius:7px;font-size:12px;font-weight:600;color:#5c5f61;cursor:pointer;width:100%;justify-content:center;transition:all 0.15s"
                        onmouseover="this.style.borderColor='#3949ab';this.style.color='#3949ab'" onmouseout="this.style.borderColor='#c5c7c9';this.style.color='#5c5f61'"
                        id="btn-upload-${docCfg.key}">
                        <span class="material-symbols-outlined" style="font-size:16px">upload_file</span>
                        <span id="lbl-file-${docCfg.key}">${doc.archivo ? '✓ Archivo cargado' : 'Subir PDF / Imagen'}</span>
                      </button>
                    </div>
                  </div>

                  <!-- Vigencia Desde -->
                  <div style="min-width:140px">
                    <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">Vigencia Desde</label>
                    <input type="date" id="desde-${docCfg.key}" value="${formatDateForInput(doc.desde)}" data-dockey="${docCfg.key}" data-tipo="desde"
                      style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;transition:border-color 0.2s"
                      onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'" />
                  </div>

                  <!-- Vigencia Hasta -->
                  <div style="min-width:140px">
                    <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${isVencido(doc.hasta) ? '#991b1b' : '#5c5f61'};margin-bottom:5px">Vigencia Hasta</label>
                    <input type="date" id="hasta-${docCfg.key}" value="${formatDateForInput(doc.hasta)}" data-dockey="${docCfg.key}" data-tipo="hasta"
                      style="width:100%;padding:8px 10px;border:1.5px solid ${isVencido(doc.hasta) ? '#fca5a5' : '#e1e3e4'};border-radius:7px;font-size:13px;color:${isVencido(doc.hasta) ? '#991b1b' : '#191c1d'};background:${isVencido(doc.hasta) ? '#fef2f2' : 'white'};outline:none;transition:border-color 0.2s"
                      onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='${isVencido(doc.hasta) ? '#fca5a5' : '#e1e3e4'}'" />
                  </div>
                </div>
              </div>`;
            }).join('')}

            <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#3949ab;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#283593'" onmouseout="this.style.background='#3949ab'">
                <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Documentación
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- ===== SECCIÓN 4: DATOS DEL CONDUCTOR ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);margin-bottom:48px">
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:#f3e5f5;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:18px;color:#7b1fa2">person_pin</span>
          </div>
          <div>
            <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">Datos del Conductor</h2>
            <p style="font-size:12px;color:#5c5f61;margin-top:2px">Chofer asignado al vehículo</p>
          </div>
        </div>
        <div style="padding:20px">
          <form id="form-conductor" style="display:flex;flex-direction:column;gap:14px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              ${fieldGroup('Nombre y Apellido', 'f-c-nombre', conductor.nombre, 'text', true)}
              ${fieldGroup('RUT Conductor', 'f-c-rut', conductor.rut, 'text', true)}
              ${fieldGroup('Teléfono de Contacto', 'f-c-tel', conductor.telefono, 'text', true)}
              ${fieldGroup('Número de Licencia de Conducir', 'f-c-licencia', conductor.licencia, 'text', true)}
            </div>

            <!-- Adjuntar documentos del conductor -->
            <div style="padding:14px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
              <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:12px">Documentos del Conductor</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <!-- Licencia -->
                <div>
                  <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">Adjuntar Licencia de Conducir</label>
                  <input type="file" id="file-licencia-conductor" accept=".pdf,.jpg,.jpeg,.png" style="display:none" />
                  <button type="button" onclick="document.getElementById('file-licencia-conductor').click()"
                    style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px dashed #c5c7c9;border-radius:7px;font-size:12px;font-weight:600;color:#5c5f61;cursor:pointer;width:100%;justify-content:center;transition:all 0.15s"
                    onmouseover="this.style.borderColor='#7b1fa2';this.style.color='#7b1fa2'" onmouseout="this.style.borderColor='#c5c7c9';this.style.color='#5c5f61'">
                    <span class="material-symbols-outlined" style="font-size:16px">upload_file</span>
                    <span id="lbl-licencia-conductor">${conductor.archivoLicencia ? '✓ Licencia cargada' : 'Subir PDF / Imagen'}</span>
                  </button>
                </div>
                <!-- Carnet -->
                <div>
                  <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">Adjuntar Carnet de Identidad</label>
                  <input type="file" id="file-carne-conductor" accept=".pdf,.jpg,.jpeg,.png" style="display:none" />
                  <button type="button" onclick="document.getElementById('file-carne-conductor').click()"
                    style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px dashed #c5c7c9;border-radius:7px;font-size:12px;font-weight:600;color:#5c5f61;cursor:pointer;width:100%;justify-content:center;transition:all 0.15s"
                    onmouseover="this.style.borderColor='#7b1fa2';this.style.color='#7b1fa2'" onmouseout="this.style.borderColor='#c5c7c9';this.style.color='#5c5f61'">
                    <span class="material-symbols-outlined" style="font-size:16px">badge</span>
                    <span id="lbl-carne-conductor">${conductor.archivoCarne ? '✓ Carnet cargado' : 'Subir PDF / Imagen'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#7b1fa2;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#4a148c'" onmouseout="this.style.background='#7b1fa2'">
                <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Conductor
              </button>
            </div>
          </form>
        </div>
      </section>

    </div><!-- fin ficha-grid -->
  `;

  // ============================================================
  // EVENTOS
  // ============================================================

  // Botón volver (proveedor → su portal; funcionario → gestión de transportes)
  document.getElementById('btn-back-transports').addEventListener('click', () => {
    const stage = document.getElementById('stage-area');
    const title = document.getElementById('current-page-title');
    let sesion = null;
    try { sesion = JSON.parse(localStorage.getItem('ebema_user_session')); } catch (e) { /* ignorar */ }

    if (sesion && sesion.tipo === 'proveedor') {
      if (title) title.textContent = 'Portal de Proveedores';
      import('./provider-portal.js').then(m => m.renderPortalHome(stage));
    } else {
      if (title) title.textContent = 'Gestión de Transportes';
      import('./transports.js').then(m => m.renderTransportsView(stage));
    }
  });

  // --- FORM PROVEEDOR ---
  document.getElementById('form-proveedor').addEventListener('submit', e => {
    e.preventDefault();
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx === -1) return;
    db.transports[idx].direccion = document.getElementById('f-dir').value;
    db.transports[idx].comuna    = document.getElementById('f-comuna').value;
    db.transports[idx].region    = document.getElementById('f-region').value;
    db.transports[idx].email     = document.getElementById('f-email').value;
    db.transports[idx].telefono  = document.getElementById('f-tel').value;
    saveDatabase(db);
    showAlert('Datos del proveedor actualizados.');
    renderFichaTransporte(container, transportId);
  });

  // --- FORM VEHÍCULO ---
  document.getElementById('form-vehiculo').addEventListener('submit', e => {
    e.preventDefault();
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx === -1) return;
    db.transports[idx].modelo = document.getElementById('f-modelo').value;
    db.transports[idx].anio   = parseInt(document.getElementById('f-anio').value) || 2020;
    db.transports[idx].dimensiones = {
      largo: parseFloat(document.getElementById('f-largo').value) || 0,
      ancho: parseFloat(document.getElementById('f-ancho').value) || 0,
      alto:  parseFloat(document.getElementById('f-alto').value)  || 0
    };
    saveDatabase(db);
    showAlert('Características del vehículo actualizadas.');
    renderFichaTransporte(container, transportId);
  });

  // --- SUBIDA DE ARCHIVOS (documentos del vehículo) ---
  DOCS_CONFIG.forEach(docCfg => {
    const fileInput = document.getElementById(`file-${docCfg.key}`);
    fileInput?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const db = getDatabase();
      const idx = db.transports.findIndex(x => x.id === transportId);
      if (idx === -1) return;
      if (!db.transports[idx].documentos) db.transports[idx].documentos = {};
      if (!db.transports[idx].documentos[docCfg.key]) db.transports[idx].documentos[docCfg.key] = {};
      db.transports[idx].documentos[docCfg.key].archivo = file.name;
      saveDatabase(db);
      const lbl = document.getElementById(`lbl-file-${docCfg.key}`);
      if (lbl) lbl.textContent = `✓ ${file.name}`;
      showAlert(`Archivo "${file.name}" registrado para ${docCfg.label}.`);
    });
  });

  // --- FORM DOCUMENTOS (fechas) ---
  document.getElementById('form-documentos').addEventListener('submit', e => {
    e.preventDefault();
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx === -1) return;
    if (!db.transports[idx].documentos) db.transports[idx].documentos = {};

    DOCS_CONFIG.forEach(docCfg => {
      const desde = document.getElementById(`desde-${docCfg.key}`)?.value || '';
      const hasta = document.getElementById(`hasta-${docCfg.key}`)?.value || '';
      if (!db.transports[idx].documentos[docCfg.key]) db.transports[idx].documentos[docCfg.key] = {};
      db.transports[idx].documentos[docCfg.key].desde = desde;
      db.transports[idx].documentos[docCfg.key].hasta = hasta;
    });

    saveDatabase(db);
    showAlert('Documentación guardada correctamente.');
    renderFichaTransporte(container, transportId);
  });

  // --- FORM CONDUCTOR ---
  document.getElementById('form-conductor').addEventListener('submit', e => {
    e.preventDefault();
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx === -1) return;
    if (!db.transports[idx].conductor) db.transports[idx].conductor = {};
    db.transports[idx].conductor.nombre   = document.getElementById('f-c-nombre').value;
    db.transports[idx].conductor.rut      = document.getElementById('f-c-rut').value;
    db.transports[idx].conductor.telefono = document.getElementById('f-c-tel').value;
    db.transports[idx].conductor.licencia = document.getElementById('f-c-licencia').value;
    saveDatabase(db);
    showAlert('Datos del conductor actualizados.');
    renderFichaTransporte(container, transportId);
  });

  // Archivos del conductor
  document.getElementById('file-licencia-conductor')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx !== -1) { db.transports[idx].conductor.archivoLicencia = file.name; saveDatabase(db); }
    document.getElementById('lbl-licencia-conductor').textContent = `✓ ${file.name}`;
    showAlert(`Licencia "${file.name}" registrada.`);
  });

  document.getElementById('file-carne-conductor')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const db = getDatabase();
    const idx = db.transports.findIndex(x => x.id === transportId);
    if (idx !== -1) { db.transports[idx].conductor.archivoCarne = file.name; saveDatabase(db); }
    document.getElementById('lbl-carne-conductor').textContent = `✓ ${file.name}`;
    showAlert(`Carnet "${file.name}" registrado.`);
  });
}

// ============================================================
// HELPERS DE RENDERIZADO DE CAMPOS
// ============================================================

function fieldGroup(label, id, value, type = 'text', editable = true, colSpan = '1') {
  const locked = !editable;
  const val = value !== undefined && value !== null ? value : '';
  return `
    <div style="grid-column:span ${colSpan}">
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}${editable ? '' : ' <span style="color:#b5000b;font-size:9px">(bloqueado)</span>'}</label>
      <input type="${type}" id="${id}" value="${val}" ${locked ? 'readonly' : ''}
        step="${type === 'number' ? '0.1' : ''}"
        style="width:100%;padding:9px 12px;border:1.5px solid ${locked ? '#e9bcb6' : '#e1e3e4'};border-radius:7px;font-size:13px;color:${locked ? '#5c5f61' : '#191c1d'};background:${locked ? '#fdf5f4' : 'white'};outline:none;box-sizing:border-box;cursor:${locked ? 'not-allowed' : 'text'};transition:border-color 0.2s"
        ${locked ? '' : `onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'"`} />
    </div>`;
}

function fieldGroupLocked(label, value) {
  return `
    <div>
      <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label} <span style="color:#b5000b;font-size:9px">(bloqueado)</span></label>
      <div style="padding:9px 12px;border:1.5px solid #e9bcb6;border-radius:7px;font-size:13px;color:#5c5f61;background:#fdf5f4;font-weight:600">
        ${value !== undefined && value !== null ? value : '—'}
      </div>
    </div>`;
}

function selectGroup(label, id, current) {
  const options = REGIONES_CHILE.map(r =>
    `<option value="${r}" ${r === current ? 'selected' : ''}>${r}</option>`
  ).join('');
  return `
    <div>
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}</label>
      <select id="${id}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box;transition:border-color 0.2s"
        onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'">
        <option value="">Seleccionar región...</option>
        ${options}
      </select>
    </div>`;
}
