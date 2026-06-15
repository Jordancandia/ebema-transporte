// Funciones de Utilidad Compartidas para la Plataforma Ebema

// 0. Escapar texto antes de insertarlo en innerHTML (previene XSS con datos de usuarios/proveedores)
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 1. Formatear y Validar RUT Chileno (ej: 76.849.201-3 o 768492013)
export function formatRut(rut) {
  // Limpiar caracteres extraños
  let valor = rut.replace(/[^0-9kK]/g, '');
  if (valor.length < 2) return valor;

  // Separar cuerpo y dígito verificador
  let cuerpo = valor.slice(0, -1);
  let dv = valor.slice(-1).toUpperCase();

  // Formatear cuerpo con puntos
  let cuerpoFormateado = '';
  while (cuerpo.length > 3) {
    cuerpoFormateado = '.' + cuerpo.slice(-3) + cuerpoFormateado;
    cuerpo = cuerpo.slice(0, -3);
  }
  cuerpoFormateado = cuerpo + cuerpoFormateado;

  return cuerpoFormateado + '-' + dv;
}

export function validateRut(rut) {
  if (!rut || rut.length < 3) return false;
  let valor = rut.replace(/[^0-9kK]/g, '');
  if (valor.length < 8) return false;

  let cuerpo = valor.slice(0, -1);
  let dv = valor.slice(-1).toUpperCase();

  // Calcular dígito verificador
  let suma = 0;
  let multiplicador = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i)) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  let dvEsperado = 11 - (suma % 11);
  let dvCalc = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : dvEsperado.toString();

  return dv === dvCalc;
}

// 1b. Formatear Teléfono Chileno con prefijo +56 (ej: +56 9 1234 5678)
export function formatPhone(value) {
  let digits = (value || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('56')) digits = digits.slice(2);
  if (!digits) return '';
  if (digits.length === 9) {
    return `+56 ${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
  }
  return `+56 ${digits}`;
}

// 2. Formatear Moneda Pesos Chilenos (CLP) (ej: $150.000)
export function formatCLP(value) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0
  }).format(value);
}

// 3. Generar Códigos SAP Correlativos automáticos (ej: TRSP004)
export function generateSapCode(prefix, list, key) {
  const nums = list.map(item => {
    const code = item[key] || '';
    const numPart = code.replace(new RegExp(`^${prefix}`), '');
    const parsed = parseInt(numPart, 10);
    return isNaN(parsed) ? 0 : parsed;
  });
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}${(maxNum + 1).toString().padStart(3, '0')}`;
}

// 4. Analizador de CSV Simple (retorna un array de objetos basados en las cabeceras)
export function parseCSV(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 2) return [];

  // Detectar delimitador (coma o punto y coma)
  const headerLine = lines[0];
  const delimiter = headerLine.includes(';') ? ';' : ',';

  const headers = headerLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, ''));
    if (row.length === headers.length) {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      results.push(obj);
    }
  }
  return results;
}

// 5. Alerta flotante premium temporal
export function showAlert(message, type = 'success') {
  // Eliminar alerta previa si existe
  const activeAlerts = document.querySelectorAll('.toast-alert');
  activeAlerts.forEach(a => a.remove());

  const alertContainer = document.createElement('div');
  alertContainer.className = `toast-alert toast-${type}`;
  alertContainer.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${type === 'success' ? '✓' : '⚠'}</span>
      <span class="toast-message">${message}</span>
    </div>
  `;

  // Agregar estilos rápidos de la alerta
  Object.assign(alertContainer.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    backgroundColor: type === 'success' ? 'var(--state-success)' : 'var(--state-error)',
    color: 'white',
    padding: '12px 24px',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-lg)',
    zIndex: '1000',
    fontFamily: 'inherit',
    fontWeight: '600',
    fontSize: '14px',
    transition: 'all 0.3s ease',
    opacity: '0',
    transform: 'translateY(20px)'
  });

  document.body.appendChild(alertContainer);

  // Forzar reflow y animar entrada
  setTimeout(() => {
    alertContainer.style.opacity = '1';
    alertContainer.style.transform = 'translateY(0)';
  }, 10);

  // Ocultar y remover después de 3 segundos
  setTimeout(() => {
    alertContainer.style.opacity = '0';
    alertContainer.style.transform = 'translateY(20px)';
    setTimeout(() => alertContainer.remove(), 300);
  }, 3000);
}

// 5b. Construir un CSV (separado por comas) a partir de encabezados y filas (array de arrays)
export function toCSV(headers, rows) {
  const escape = (v) => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  rows.forEach(r => lines.push(r.map(escape).join(',')));
  return lines.join('\n');
}

// 5c. Descargar un string como archivo (CSV, texto, etc.)
export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 5d. Formatear fecha DD-MM-YYYY (requerido por exportaciones CSV ERP)
export function formatDateDDMMYYYY(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

// 6. Geolocalizar una dirección mediante OpenStreetMap Nominatim (Gratuito, sin API Keys)
// Estrategia de reintentos: dirección completa -> sin número de calle -> solo comuna/región.
// Devuelve siempre { lat, lon, displayName, found } — found=false indica que NO se encontró
// nada útil y se usó el centro de Santiago como último recurso (debe ajustarse manualmente).
export async function geocodeAddress(address) {
  const tryQuery = async (q) => {
    try {
      const query = encodeURIComponent(q);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=cl&q=${query}`);
      if (!response.ok) throw new Error('Error de conexión con Nominatim');

      const results = await response.json();
      if (results && results.length > 0) {
        return {
          lat: parseFloat(results[0].lat),
          lon: parseFloat(results[0].lon),
          displayName: results[0].display_name,
          found: true
        };
      }
    } catch (error) {
      console.error("Error al geolocalizar dirección:", error);
    }
    return null;
  };

  // Intento 1: dirección completa
  let result = await tryQuery(`${address}, Chile`);
  if (result) return result;

  // Intento 2: sin el número de calle (algunas direcciones industriales/rurales
  // no están indexadas a nivel de número exacto en OpenStreetMap)
  const sinNumero = address.replace(/\b\d+[A-Za-z]?\b/g, '').replace(/\s{2,}/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (sinNumero && sinNumero.toLowerCase() !== address.toLowerCase()) {
    result = await tryQuery(`${sinNumero}, Chile`);
    if (result) {
      result.displayName += ' (aproximado: sin número de calle — verifique el pin)';
      return result;
    }
  }

  // Intento 3: solo la comuna/región (último segmento separado por coma)
  const partes = address.split(',');
  if (partes.length > 1) {
    const comuna = partes.slice(1).join(',').trim();
    if (comuna) {
      result = await tryQuery(`${comuna}, Chile`);
      if (result) {
        result.displayName += ' (aproximado: solo comuna/región — ajuste el pin)';
        return result;
      }
    }
  }

  // Sin resultados en ningún intento: coordenadas por defecto (Santiago Centro),
  // marcadas como NO encontradas para que la interfaz pida ajuste manual del pin.
  return {
    lat: -33.4489,
    lon: -70.6693,
    displayName: "No se encontró la dirección — ajuste el pin manualmente",
    found: false
  };
}
