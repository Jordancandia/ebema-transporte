// Funciones de Utilidad Compartidas para la Plataforma Ebema

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
