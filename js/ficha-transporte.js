import { getDatabase, saveDatabase, getCentreName, getOrigenGroups, calcEjes } from './data.js';
import { formatRut, showAlert, escapeHtml } from './utils.js';

// Ficha del Transportista — SIT EBEMA
// Estructura: EMPRESA → CAMIONES (patentes con documentación y valores) → CHOFERES.
// Cada camión mantiene la relación transportista ↔ patente ↔ chofer (por RUT del chofer).

const REGIONES_CHILE = [
  'Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo',
  'Valparaíso','Metropolitana','Libertador General Bernardo O\'Higgins',
  'Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo','Magallanes y Antártica Chilena'
];

// Bancos habilitados para operar en Chile (según CMF)
const BANCOS_CHILE = [
  'Banco de Chile', 'Banco Internacional', 'Banco Estado', 'Banco BICE',
  'Banco Santander Chile', 'Itaú Corpbanca', 'Banco Security', 'Banco Falabella',
  'Banco Ripley', 'Banco Consorcio', 'Scotiabank Chile', 'Banco BTG Pactual Chile',
  'HSBC Bank Chile', 'Banco de Crédito e Inversiones (BCI)', 'China Construction Bank Chile',
  'Coopeuch', 'Tenpo Prepago'
];

// Tipos de cuenta bancaria aceptados para pago a transportistas
const TIPOS_CUENTA = ['Cuenta Corriente', 'Cuenta Vista', 'Chequera Electrónica', 'Cuenta RUT'];

// Documentos del camión. Los marcados con "conValor" exigen declarar su valor en CLP.
const DOCS_CONFIG = [
  { key: 'permisoCirculacion', label: 'Permiso de Circulación',           icon: 'description',      conValor: true },
  { key: 'seguroCarga',        label: 'Seguro de Carga',                  icon: 'security',         conValor: true },
  { key: 'soap',               label: 'SOAP',                             icon: 'health_and_safety', conValor: true },
  { key: 'padron',             label: 'Padrón del Vehículo',              icon: 'badge',            conValor: false },
  { key: 'certificadoEmision', label: 'Certificado de Emisión de Gases',  icon: 'air',              conValor: false }
];

function isVencido(hastaStr) {
  if (!hastaStr) return false;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return new Date(hastaStr) < hoy;
}

function docStatusStyle(doc) {
  if (!doc || !doc.hasta) return { bg: '#fef9c3', text: '#92400e', label: 'Sin Fecha', icon: 'warning' };
  if (isVencido(doc.hasta)) return { bg: '#fee2e2', text: '#991b1b', label: 'Vencido', icon: 'error' };
  const dias = Math.ceil((new Date(doc.hasta) - new Date()) / 86400000);
  if (dias <= 30) return { bg: '#fef3c7', text: '#92400e', label: `${dias}d`, icon: 'schedule' };
  return { bg: '#dcfce7', text: '#166534', label: 'Vigente', icon: 'check_circle' };
}

// Estado general del expediente del transportista
function calcularEstado(t) {
  const alerts = [];
  const camiones = t.camiones || [];
  const choferes = t.choferes || [];

  if (camiones.length === 0) alerts.push('Sin camiones registrados');
  if (choferes.length === 0) alerts.push('Sin choferes registrados');
  if (!t.centrosServicio || t.centrosServicio.length === 0) alerts.push('Sin centro de servicio asignado');

  camiones.forEach(c => {
    const docs = c.documentos || {};
    DOCS_CONFIG.forEach(d => {
      const doc = docs[d.key] || {};
      if (!doc.hasta) alerts.push(`${c.patente}: ${d.label} sin vigencia`);
      else if (isVencido(doc.hasta)) alerts.push(`${c.patente}: ${d.label} VENCIDO`);
      if (d.conValor && !(Number(doc.valor) > 0)) alerts.push(`${c.patente}: ${d.label} sin valor declarado`);
    });
    if (!c.choferRut) alerts.push(`${c.patente}: sin chofer asignado`);
  });

  return alerts.length === 0
    ? { status: 'ok', color: '#16a34a', bg: '#dcfce7', border: '#86efac' }
    : { status: 'alert', color: '#d97706', bg: '#fef3c7', border: '#fbbf24', alerts };
}

export function renderFichaTransporte(container, transportId) {
  const db = getDatabase();
  const t = db.transports.find(x => x.id === transportId);
  if (!t) {
    container.innerHTML = `<div class="p-xl text-center text-secondary">Transporte no encontrado.</div>`;
    return;
  }

  // Compatibilidad: garantizar estructura nueva
  if (!t.camiones) t.camiones = [];
  if (!t.choferes) t.choferes = [];
  if (!t.centrosServicio) t.centrosServicio = [];
  if (!t.datosBancarios) t.datosBancarios = { banco: '', tipoCuenta: '', numeroCuenta: '', rut: t.rut };
  t.datosBancarios.rut = t.rut; // siempre debe coincidir con el RUT del proveedor

  const estado = calcularEstado(t);
  const grupos = getOrigenGroups(db);

  container.innerHTML = `
    <!-- ===== HEADER ===== -->
    <div style="margin-bottom:28px">
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#5c5f61;margin-bottom:16px">
        <button id="btn-back-transports" style="background:none;border:none;cursor:pointer;color:#b5000b;font-weight:700;font-size:13px;padding:0;display:flex;align-items:center;gap:4px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
          <span class="material-symbols-outlined" style="font-size:15px">arrow_back</span>
          Volver
        </button>
        <span class="material-symbols-outlined" style="font-size:14px;color:#c5c7c9">chevron_right</span>
        <span style="color:#191c1d;font-weight:600">${escapeHtml(t.razonSocial)}</span>
      </div>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <h1 style="font-size:28px;font-weight:800;color:#191c1d;letter-spacing:-0.02em;line-height:1.2;margin-bottom:4px">Ficha del Transportista</h1>
          <p style="font-size:14px;color:#5c5f61">${(t.camiones).length} camión(es) · ${(t.choferes).length} chofer(es) registrados</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px;background:${estado.bg};border:1.5px solid ${estado.border};border-radius:12px;padding:12px 20px">
          <div style="width:14px;height:14px;border-radius:50%;background:${estado.color};flex-shrink:0"></div>
          <div>
            <p style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${estado.color};line-height:1">Estado del Expediente</p>
            <p style="font-size:18px;font-weight:800;color:${estado.color};line-height:1.2;margin-top:2px">${estado.status === 'ok' ? '✓ Aprobado / Completo' : '⚠ Alerta Documental'}</p>
            ${estado.alerts ? `<p style="font-size:11px;color:${estado.color};margin-top:4px;opacity:0.8">${estado.alerts.length} observación(es)</p>` : ''}
          </div>
        </div>
      </div>

      ${estado.alerts ? `
      <div style="margin-top:16px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#92400e;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span class="material-symbols-outlined" style="font-size:14px">warning</span>
          Observaciones que requieren atención
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${estado.alerts.slice(0, 12).map(a => `<span style="padding:3px 10px;background:#fef3c7;border:1px solid #fbbf24;border-radius:20px;font-size:11px;color:#78350f;font-weight:600">${escapeHtml(a)}</span>`).join('')}
          ${estado.alerts.length > 12 ? `<span style="padding:3px 10px;font-size:11px;color:#78350f">+${estado.alerts.length - 12} más...</span>` : ''}
        </div>
      </div>` : ''}
    </div>

    <div style="display:flex;flex-direction:column;gap:20px;margin-bottom:48px">

      <!-- ===== 1. DATOS DEL PROVEEDOR + CENTROS DE SERVICIO ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${seccionHeader('business', '#b5000b', '#ffdad5', 'Datos del Proveedor', 'Información de la empresa y centros donde presta servicio')}
        <div style="padding:20px">
          <form id="form-proveedor" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${fieldGroup('Razón Social', 'f-razon', t.razonSocial, 'text', false)}
            ${fieldGroup('RUT Proveedor', 'f-rut', t.rut, 'text', false)}
            ${fieldGroup('Dirección', 'f-dir', t.direccion, 'text', true, '2')}
            ${fieldGroup('Comuna', 'f-comuna', t.comuna, 'text', true)}
            ${selectRegion('Región', 'f-region', t.region)}
            ${fieldGroup('Correo Electrónico', 'f-email', t.email, 'email', true)}
            ${fieldGroup('Teléfono', 'f-tel', t.telefono, 'text', true)}

            <!-- Centros de servicio (máximo 2) -->
            <div style="grid-column:1/-1;padding:14px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
              <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:12px;display:flex;align-items:center;gap:6px">
                <span class="material-symbols-outlined" style="font-size:14px">location_on</span>
                Centros donde presta servicio (máximo 2 grupos)
              </p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${selectGrupoCentro('Centro de Servicio 1', 'f-centro1', grupos, t.centrosServicio[0] || '')}
                ${selectGrupoCentro('Centro de Servicio 2 (opcional)', 'f-centro2', grupos, t.centrosServicio[1] || '')}
              </div>
            </div>

            <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              ${btnGuardar('#b5000b', 'Guardar Datos del Proveedor')}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 2. DATOS BANCARIOS (CUENTA CORRIENTE PARA PAGOS) ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${seccionHeader('account_balance', '#1565c0', '#e3f2fd', 'Datos Bancarios para Pago', 'Cuenta a la que se realizarán los pagos por servicios de transporte')}
        <div style="padding:20px">
          <form id="form-bancario" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${selectBanco('Banco', 'b-banco', t.datosBancarios.banco)}
            ${selectTipoCuenta('Tipo de Cuenta', 'b-tipo', t.datosBancarios.tipoCuenta)}
            ${fieldGroup('Número de Cuenta', 'b-numero', t.datosBancarios.numeroCuenta, 'text', true)}
            ${fieldGroup('RUT Asociado a la Cuenta', 'b-rut', t.datosBancarios.rut, 'text', false)}

            <div style="grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid #f3f4f5">
              ${btnGuardar('#1565c0', 'Guardar Datos Bancarios')}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 3. CHOFERES ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${seccionHeader('group', '#7b1fa2', '#f3e5f5', 'Choferes', 'Conductores de la empresa — se asignan a los camiones por RUT')}
        <div style="padding:20px">
          <form id="form-choferes" style="display:flex;flex-direction:column;gap:10px">
            <div id="choferes-rows" style="display:flex;flex-direction:column;gap:10px">
              ${(t.choferes).map((ch, i) => choferRow(ch, i)).join('')}
            </div>
            ${t.choferes.length === 0 ? `<p id="choferes-empty" style="text-align:center;color:#5c5f61;font-size:13px;padding:10px">No hay choferes registrados. Agregue el primero.</p>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid #f3f4f5">
              <button type="button" id="btn-add-chofer" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1.5px dashed #7b1fa2;border-radius:7px;font-size:12px;font-weight:700;color:#7b1fa2;cursor:pointer">
                <span class="material-symbols-outlined" style="font-size:16px">person_add</span> Agregar Chofer
              </button>
              ${btnGuardar('#7b1fa2', 'Guardar Choferes')}
            </div>
          </form>
        </div>
      </section>

      <!-- ===== 4. CAMIONES ===== -->
      <section style="background:white;border:1px solid #e1e3e4;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        ${seccionHeader('local_shipping', '#2e7d32', '#e8f5e9', 'Camiones (Patentes)', 'Flota del transportista con su documentación y chofer asignado')}
        <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
          <div id="camiones-cards" style="display:flex;flex-direction:column;gap:16px">
            ${(t.camiones).map((c, i) => camionCard(c, i, t.choferes)).join('')}
          </div>
          ${t.camiones.length === 0 ? `<p style="text-align:center;color:#5c5f61;font-size:13px;padding:10px">No hay camiones registrados. Agregue el primero.</p>` : ''}
          <button type="button" id="btn-add-camion" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:12px;background:white;border:1.5px dashed #2e7d32;border-radius:8px;font-size:13px;font-weight:700;color:#2e7d32;cursor:pointer">
            <span class="material-symbols-outlined" style="font-size:18px">add_circle</span> Agregar Camión
          </button>
        </div>
      </section>

    </div>
  `;

  // ============================================================
  // EVENTOS
  // ============================================================

  // Volver (proveedor → portal; funcionario → transportes)
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

  const refresh = () => renderFichaTransporte(container, transportId);
  const getT = (database) => database.transports.find(x => x.id === transportId);

  // --- 1. PROVEEDOR + CENTROS ---
  document.getElementById('form-proveedor').addEventListener('submit', e => {
    e.preventDefault();
    const database = getDatabase();
    const obj = getT(database);
    if (!obj) return;
    obj.direccion = document.getElementById('f-dir').value;
    obj.comuna = document.getElementById('f-comuna').value;
    obj.region = document.getElementById('f-region').value;
    obj.email = document.getElementById('f-email').value;
    obj.telefono = document.getElementById('f-tel').value;
    obj.ownerEmail = (obj.email || '').trim().toLowerCase();

    const c1 = document.getElementById('f-centro1').value;
    const c2 = document.getElementById('f-centro2').value;
    if (c1 && c2 && c1 === c2) return showAlert('Los dos grupos de servicio no pueden ser el mismo.', 'error');
    const gruposSel = [c1, c2].filter(Boolean);
    const expanded = [];
    gruposSel.forEach(g => {
      const grupo = grupos.find(gr => gr.grupo === g);
      if (grupo) expanded.push(...grupo.centroIds);
    });
    obj.centrosServicio = expanded;

    saveDatabase(database);
    showAlert('Datos del proveedor actualizados.');
    refresh();
  });

  // --- 2. DATOS BANCARIOS ---
  document.getElementById('form-bancario').addEventListener('submit', e => {
    e.preventDefault();
    const database = getDatabase();
    const obj = getT(database);
    if (!obj) return;

    const banco = document.getElementById('b-banco').value;
    const tipoCuenta = document.getElementById('b-tipo').value;
    const numeroCuenta = document.getElementById('b-numero').value.trim();
    if (!banco || !tipoCuenta || !numeroCuenta) return showAlert('Complete banco, tipo de cuenta y número de cuenta.', 'error');

    obj.datosBancarios = {
      banco,
      tipoCuenta,
      numeroCuenta,
      rut: obj.rut // el RUT de la cuenta nunca es editable: siempre coincide con el RUT del proveedor
    };

    saveDatabase(database);
    showAlert('Datos bancarios actualizados.');
    refresh();
  });

  // --- 3. CHOFERES ---
  document.getElementById('btn-add-chofer').addEventListener('click', () => {
    const rows = document.getElementById('choferes-rows');
    const idx = rows.children.length;
    rows.insertAdjacentHTML('beforeend', choferRow({ nombre: '', rut: '', telefono: '', licencia: '' }, idx));
    const empty = document.getElementById('choferes-empty');
    if (empty) empty.remove();
  });

  document.getElementById('form-choferes').addEventListener('submit', e => {
    e.preventDefault();
    const database = getDatabase();
    const obj = getT(database);
    if (!obj) return;

    const rows = [...document.querySelectorAll('#choferes-rows .chofer-row')];
    const nuevos = [];
    for (const row of rows) {
      const nombre = row.querySelector('.ch-nombre').value.trim();
      const rut = formatRut(row.querySelector('.ch-rut').value.trim());
      const telefono = row.querySelector('.ch-tel').value.trim();
      const licencia = row.querySelector('.ch-lic').value.trim();
      if (!nombre && !rut) continue; // fila vacía: se descarta
      if (!nombre || !rut) return showAlert('Cada chofer debe tener al menos nombre y RUT.', 'error');
      if (nuevos.some(n => n.rut === rut)) return showAlert(`RUT de chofer duplicado: ${rut}`, 'error');
      const anterior = (obj.choferes || []).find(c => c.rut === rut) || {};
      nuevos.push({ ...anterior, nombre, rut, telefono, licencia });
    }

    obj.choferes = nuevos;
    // Limpiar asignaciones de camiones cuyo chofer ya no existe
    (obj.camiones || []).forEach(c => {
      if (c.choferRut && !nuevos.some(n => n.rut === c.choferRut)) c.choferRut = '';
    });

    saveDatabase(database);
    showAlert('Choferes guardados correctamente.');
    refresh();
  });

  // Eliminar fila de chofer (delegado)
  document.getElementById('choferes-rows').addEventListener('click', e => {
    const btn = e.target.closest('.btn-del-chofer');
    if (btn) btn.closest('.chofer-row').remove();
  });

  // --- 4. CAMIONES ---
  document.getElementById('btn-add-camion').addEventListener('click', () => {
    const database = getDatabase();
    const obj = getT(database);
    if (!obj) return;
    obj.camiones.push({
      id: 'c' + Date.now(),
      patente: '',
      modelo: '',
      anio: new Date().getFullYear(),
      capacidad: 5,
      ejes: calcEjes(5),
      dimensiones: { largo: 0, ancho: 0, alto: 0 },
      documentos: {},
      choferRut: ''
    });
    saveDatabase(database);
    refresh();
  });

  // Guardar / eliminar / subir archivo por camión (delegado)
  document.getElementById('camiones-cards').addEventListener('click', e => {
    const saveBtn = e.target.closest('.btn-save-camion');
    const delBtn = e.target.closest('.btn-del-camion');
    const upBtn = e.target.closest('.btn-upload-doc');

    if (upBtn) {
      const input = document.getElementById(upBtn.getAttribute('data-input'));
      if (input) input.click();
      return;
    }

    if (delBtn) {
      const camionId = delBtn.getAttribute('data-camion');
      if (!confirm('¿Eliminar este camión y su documentación?')) return;
      const database = getDatabase();
      const obj = getT(database);
      obj.camiones = obj.camiones.filter(c => c.id !== camionId);
      saveDatabase(database);
      showAlert('Camión eliminado.');
      refresh();
      return;
    }

    if (saveBtn) {
      const camionId = saveBtn.getAttribute('data-camion');
      const card = saveBtn.closest('.camion-card');
      const database = getDatabase();
      const obj = getT(database);
      const cam = obj.camiones.find(c => c.id === camionId);
      if (!cam) return;

      const patente = card.querySelector('.cam-patente').value.toUpperCase().replace(/\s+/g, '');
      if (!patente) return showAlert('La patente es obligatoria.', 'error');
      const repetida = obj.camiones.some(c => c.id !== camionId && c.patente === patente);
      if (repetida) return showAlert('Esa patente ya está registrada en este transportista.', 'error');

      cam.patente = patente;
      cam.modelo = card.querySelector('.cam-modelo').value;
      cam.anio = parseInt(card.querySelector('.cam-anio').value) || 2020;
      cam.capacidad = Number(card.querySelector('.cam-capacidad').value) || 0;
      cam.ejes = calcEjes(cam.capacidad);
      cam.dimensiones = {
        largo: parseFloat(card.querySelector('.cam-largo').value) || 0,
        ancho: parseFloat(card.querySelector('.cam-ancho').value) || 0,
        alto: parseFloat(card.querySelector('.cam-alto').value) || 0
      };
      cam.choferRut = card.querySelector('.cam-chofer').value;

      if (!cam.documentos) cam.documentos = {};
      DOCS_CONFIG.forEach(d => {
        if (!cam.documentos[d.key]) cam.documentos[d.key] = { archivo: null, desde: '', hasta: '' };
        cam.documentos[d.key].desde = card.querySelector(`.doc-desde-${d.key}`).value || '';
        cam.documentos[d.key].hasta = card.querySelector(`.doc-hasta-${d.key}`).value || '';
        if (d.conValor) {
          cam.documentos[d.key].valor = Number(card.querySelector(`.doc-valor-${d.key}`).value) || 0;
        }
      });

      saveDatabase(database);
      showAlert(`Camión ${patente} guardado correctamente.`);
      refresh();
    }
  });

  // Subida de archivos de documentos (delegado por change)
  document.getElementById('camiones-cards').addEventListener('change', e => {
    const input = e.target.closest('.doc-file-input');
    if (!input || !input.files[0]) return;
    const camionId = input.getAttribute('data-camion');
    const docKey = input.getAttribute('data-doc');
    const file = input.files[0];

    const database = getDatabase();
    const obj = getT(database);
    const cam = obj.camiones.find(c => c.id === camionId);
    if (!cam) return;
    if (!cam.documentos) cam.documentos = {};
    if (!cam.documentos[docKey]) cam.documentos[docKey] = { archivo: null, desde: '', hasta: '' };
    cam.documentos[docKey].archivo = file.name;
    saveDatabase(database);

    const lbl = document.getElementById(`lbl-${camionId}-${docKey}`);
    if (lbl) lbl.textContent = `✓ ${file.name}`;
    showAlert(`Archivo "${file.name}" registrado.`);
  });
}

// ============================================================
// PLANTILLAS
// ============================================================

function seccionHeader(icon, color, bg, titulo, subtitulo) {
  return `
    <div style="padding:16px 20px;border-bottom:1px solid #f3f4f5;background:#f8f9fa;display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;background:${bg};border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span class="material-symbols-outlined" style="font-size:18px;color:${color}">${icon}</span>
      </div>
      <div>
        <h2 style="font-size:15px;font-weight:800;color:#191c1d;line-height:1">${titulo}</h2>
        <p style="font-size:12px;color:#5c5f61;margin-top:2px">${subtitulo}</p>
      </div>
    </div>`;
}

function btnGuardar(color, texto) {
  return `
    <button type="submit" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:${color};color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">
      <span class="material-symbols-outlined" style="font-size:16px">save</span> ${texto}
    </button>`;
}

function choferRow(ch, i) {
  return `
    <div class="chofer-row" style="display:grid;grid-template-columns:2fr 1.2fr 1.2fr 1.2fr auto;gap:10px;align-items:end;border:1px solid #e1e3e4;border-radius:8px;padding:12px;background:#fcfcfc">
      ${miniField('Nombre y Apellido', `ch-nombre`, ch.nombre)}
      ${miniField('RUT', `ch-rut`, ch.rut)}
      ${miniField('Teléfono', `ch-tel`, ch.telefono)}
      ${miniField('N° Licencia', `ch-lic`, ch.licencia)}
      <button type="button" class="btn-del-chofer" title="Eliminar chofer" style="background:none;border:1px solid #fca5a5;border-radius:7px;padding:8px;cursor:pointer;color:#991b1b;display:flex;align-items:center;height:fit-content">
        <span class="material-symbols-outlined" style="font-size:17px">delete</span>
      </button>
    </div>`;
}

function miniField(label, cls, value) {
  return `
    <div>
      <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${label}</label>
      <input type="text" class="${cls}" value="${escapeHtml(value)}"
        style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='#7b1fa2'" onblur="this.style.borderColor='#e1e3e4'" />
    </div>`;
}

function camionCard(c, i, choferes) {
  const docs = c.documentos || {};
  const dim = c.dimensiones || {};
  const choferOpts = (choferes || []).map(ch =>
    `<option value="${escapeHtml(ch.rut)}" ${ch.rut === c.choferRut ? 'selected' : ''}>${escapeHtml(ch.nombre)} (${escapeHtml(ch.rut)})</option>`
  ).join('');

  return `
    <div class="camion-card" style="border:1.5px solid #e1e3e4;border-radius:12px;overflow:hidden">
      <!-- Header del camión -->
      <div style="padding:12px 16px;background:#f0f7f0;border-bottom:1px solid #e1e3e4;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="material-symbols-outlined" style="font-size:22px;color:#2e7d32">local_shipping</span>
          <span style="font-size:15px;font-weight:800;color:#191c1d">Camión ${i + 1}${c.patente ? ' — ' + escapeHtml(c.patente) : ' (nuevo)'}</span>
        </div>
        <button type="button" class="btn-del-camion" data-camion="${c.id}" style="display:inline-flex;align-items:center;gap:4px;background:none;border:1px solid #fca5a5;border-radius:7px;padding:6px 10px;cursor:pointer;color:#991b1b;font-size:11px;font-weight:700">
          <span class="material-symbols-outlined" style="font-size:15px">delete</span> Eliminar
        </button>
      </div>

      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <!-- Datos del vehículo -->
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px">
          ${camField('Patente', 'cam-patente', c.patente)}
          ${camField('Modelo', 'cam-modelo', c.modelo)}
          ${camField('Año', 'cam-anio', c.anio, 'number')}
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Capacidad (Tons)</label>
            <input type="number" step="0.1" class="cam-capacidad" value="${c.capacidad !== undefined && c.capacidad !== null ? c.capacidad : ''}"
              oninput="var ej=document.getElementById('cam-ejes-${c.id}'); if(ej) ej.textContent = (Number(this.value) >= 15 ? '3 Ejes' : '2 Ejes');"
              style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
              onfocus="this.style.borderColor='#2e7d32'" onblur="this.style.borderColor='#e1e3e4'" />
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Tipo de Eje</label>
            <div id="cam-ejes-${c.id}" style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#5c5f61;background:#f8f9fa;font-weight:700;box-sizing:border-box">${calcEjes(c.capacidad)} Ejes</div>
          </div>
        </div>

        <!-- Dimensiones + chofer -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:12px;padding:12px;background:#f8f9fa;border:1px solid #e1e3e4;border-radius:8px">
          ${camField('Largo (m)', 'cam-largo', dim.largo, 'number')}
          ${camField('Ancho (m)', 'cam-ancho', dim.ancho, 'number')}
          ${camField('Alto (m)', 'cam-alto', dim.alto, 'number')}
          <div>
            <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">Chofer Asignado</label>
            <select class="cam-chofer" style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
              <option value="">Sin chofer asignado...</option>
              ${choferOpts}
            </select>
          </div>
        </div>

        <!-- Documentación con valores -->
        <div>
          <p style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <span class="material-symbols-outlined" style="font-size:14px">folder_open</span>
            Documentación del vehículo
          </p>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${DOCS_CONFIG.map(d => {
              const doc = docs[d.key] || {};
              const st = docStatusStyle(doc);
              return `
              <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr ${d.conValor ? '1fr' : ''} 1.3fr;gap:10px;align-items:end;border:1px solid ${isVencido(doc.hasta) ? '#fca5a5' : '#e1e3e4'};border-radius:8px;padding:10px 12px;background:${isVencido(doc.hasta) ? '#fef2f2' : 'white'}">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="material-symbols-outlined" style="font-size:18px;color:#3949ab">${d.icon}</span>
                  <div>
                    <p style="font-size:12px;font-weight:700;color:#191c1d;line-height:1.2">${d.label}</p>
                    <span style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;padding:1px 8px;background:${st.bg};color:${st.text};border-radius:20px;font-size:10px;font-weight:700">
                      <span class="material-symbols-outlined" style="font-size:11px">${st.icon}</span>${st.label}
                    </span>
                  </div>
                </div>
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5c5f61;margin-bottom:3px">Desde</label>
                  <input type="date" class="doc-desde-${d.key}" value="${(doc.desde || '').slice(0, 10)}" style="width:100%;padding:6px 8px;border:1.5px solid #e1e3e4;border-radius:6px;font-size:12px;box-sizing:border-box" />
                </div>
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5c5f61;margin-bottom:3px">Hasta</label>
                  <input type="date" class="doc-hasta-${d.key}" value="${(doc.hasta || '').slice(0, 10)}" style="width:100%;padding:6px 8px;border:1.5px solid #e1e3e4;border-radius:6px;font-size:12px;box-sizing:border-box" />
                </div>
                ${d.conValor ? `
                <div>
                  <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#b5000b;margin-bottom:3px">Valor (CLP)</label>
                  <input type="number" min="0" class="doc-valor-${d.key}" value="${doc.valor || ''}" placeholder="$"
                    style="width:100%;padding:6px 8px;border:1.5px solid ${Number(doc.valor) > 0 ? '#e1e3e4' : '#fcd34d'};border-radius:6px;font-size:12px;box-sizing:border-box;background:${Number(doc.valor) > 0 ? 'white' : '#fffbeb'}" />
                </div>` : ''}
                <div>
                  <input type="file" id="file-${c.id}-${d.key}" class="doc-file-input" data-camion="${c.id}" data-doc="${d.key}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" />
                  <button type="button" class="btn-upload-doc" data-input="file-${c.id}-${d.key}"
                    style="display:inline-flex;align-items:center;gap:5px;padding:7px 10px;background:white;border:1.5px dashed #c5c7c9;border-radius:6px;font-size:11px;font-weight:600;color:#5c5f61;cursor:pointer;width:100%;justify-content:center">
                    <span class="material-symbols-outlined" style="font-size:14px">upload_file</span>
                    <span id="lbl-${c.id}-${d.key}">${doc.archivo ? '✓ ' + escapeHtml(doc.archivo) : 'Subir archivo'}</span>
                  </button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;padding-top:6px;border-top:1px solid #f3f4f5">
          <button type="button" class="btn-save-camion" data-camion="${c.id}" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#2e7d32;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">
            <span class="material-symbols-outlined" style="font-size:16px">save</span> Guardar Camión
          </button>
        </div>
      </div>
    </div>`;
}

function camField(label, cls, value, type = 'text') {
  return `
    <div>
      <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${label}</label>
      <input type="${type}" class="${cls}" value="${escapeHtml(value !== undefined && value !== null ? value : '')}" ${type === 'number' ? 'step="0.1"' : ''}
        style="width:100%;padding:8px 10px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box"
        onfocus="this.style.borderColor='#2e7d32'" onblur="this.style.borderColor='#e1e3e4'" />
    </div>`;
}

function fieldGroup(label, id, value, type = 'text', editable = true, colSpan = '1') {
  const locked = !editable;
  const val = value !== undefined && value !== null ? value : '';
  return `
    <div style="grid-column:span ${colSpan}">
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}${editable ? '' : ' <span style="color:#b5000b;font-size:9px">(bloqueado)</span>'}</label>
      <input type="${type}" id="${id}" value="${escapeHtml(val)}" ${locked ? 'readonly' : ''}
        style="width:100%;padding:9px 12px;border:1.5px solid ${locked ? '#e9bcb6' : '#e1e3e4'};border-radius:7px;font-size:13px;color:${locked ? '#5c5f61' : '#191c1d'};background:${locked ? '#fdf5f4' : 'white'};outline:none;box-sizing:border-box;cursor:${locked ? 'not-allowed' : 'text'}"
        ${locked ? '' : `onfocus="this.style.borderColor='#b5000b'" onblur="this.style.borderColor='#e1e3e4'"`} />
    </div>`;
}

function selectRegion(label, id, current) {
  const options = REGIONES_CHILE.map(r =>
    `<option value="${r}" ${r === current ? 'selected' : ''}>${r}</option>`
  ).join('');
  return `
    <div>
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}</label>
      <select id="${id}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar región...</option>
        ${options}
      </select>
    </div>`;
}

function selectBanco(label, id, current) {
  const options = BANCOS_CHILE.map(b =>
    `<option value="${b}" ${b === current ? 'selected' : ''}>${b}</option>`
  ).join('');
  return `
    <div>
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}</label>
      <select id="${id}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar banco...</option>
        ${options}
      </select>
    </div>`;
}

function selectTipoCuenta(label, id, current) {
  const options = TIPOS_CUENTA.map(tc =>
    `<option value="${tc}" ${tc === current ? 'selected' : ''}>${tc}</option>`
  ).join('');
  return `
    <div>
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5c5f61;margin-bottom:5px">${label}</label>
      <select id="${id}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Seleccionar tipo de cuenta...</option>
        ${options}
      </select>
    </div>`;
}

function selectGrupoCentro(label, id, grupos, currentCentroId) {
  const grupoActual = grupos.find(g => g.centroIds.includes(currentCentroId));
  const options = grupos.map(g => {
    const selected = grupoActual && g.grupo === grupoActual.grupo;
    return `<option value="${g.grupo}" ${selected ? 'selected' : ''}>${g.nombre} (${g.centroIds.join(', ')})</option>`;
  }).join('');
  return `
    <div>
      <label for="${id}" style="display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5c5f61;margin-bottom:4px">${label}</label>
      <select id="${id}" style="width:100%;padding:9px 12px;border:1.5px solid #e1e3e4;border-radius:7px;font-size:13px;color:#191c1d;background:white;outline:none;box-sizing:border-box">
        <option value="">Sin asignar...</option>
        ${options}
      </select>
    </div>`;
}
