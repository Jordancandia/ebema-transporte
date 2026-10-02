// ==========================================================================
// SIT EBEMA — Diálogo de confirmación con el estilo de la plataforma (2-oct-2026)
// Reemplaza window.confirm() (cuadro nativo del navegador "github.io dice").
// Uso:  if (!(await confirmar('¿Eliminar X?\n\nDetalle…'))) return;
// El texto antes del primer "\n\n" es el título; el resto, el detalle.
// opts: { aceptar: 'Eliminar', cancelar: 'Cancelar', tono: 'peligro'|'normal', icono }
// ==========================================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Documentos SAP (≥6 dígitos) en monoespaciado, igual que en las tablas.
const fmt = s => esc(s).replace(/\b\d{6,}\b/g, m => `<span class="sv-cf-doc">${m}</span>`).replace(/\n/g, '<br>');

const VERBOS = [
  [/^¿?\s*(eliminar|borrar|vaciar)/i, 'Eliminar', 'peligro', 'delete'],
  [/^¿?\s*excluir/i, 'Excluir', 'peligro', 'visibility_off'],
  [/^¿?\s*anular/i, 'Anular', 'peligro', 'block'],
  [/^¿?\s*quitar/i, 'Quitar', 'peligro', 'undo'],
  [/^¿?\s*descartar|sin guardar/i, 'Descartar', 'peligro', 'warning'],
  [/^¿?\s*incluir/i, 'Incluir', 'normal', 'playlist_add'],
  [/^¿?\s*marcar/i, 'Confirmar', 'normal', 'task_alt'],
  [/^¿?\s*asignar/i, 'Asignar', 'normal', 'auto_awesome'],
  [/^¿?\s*georreferenciar/i, 'Georreferenciar', 'normal', 'location_on'],
];

export function confirmar(mensaje, opts = {}) {
  const txt = String(mensaje ?? '');
  const i = txt.indexOf('\n\n');
  const titulo = (i >= 0 ? txt.slice(0, i) : txt).trim();
  const detalle = i >= 0 ? txt.slice(i + 2).trim() : '';
  const v = VERBOS.find(([re]) => re.test(titulo)) || [null, 'Continuar', 'normal', 'help'];
  const aceptar = opts.aceptar || v[1];
  const tono = opts.tono || v[2];
  const icono = opts.icono || v[3];
  const prevFocus = document.activeElement;

  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'sv-cf-bg';
    bg.innerHTML = `<div class="sv-cf" role="alertdialog" aria-modal="true" aria-labelledby="sv-cf-t">
        <div class="sv-cf-b">
          <div class="sv-cf-ic ${tono === 'peligro' ? 'is-bad' : ''}"><span class="material-symbols-outlined">${esc(icono)}</span></div>
          <div style="min-width:0">
            <div class="sv-cf-t" id="sv-cf-t">${fmt(titulo)}</div>
            ${detalle ? `<div class="sv-cf-d">${fmt(detalle)}</div>` : ''}
          </div>
        </div>
        <div class="sv-cf-f">
          <button type="button" class="sv-btn" data-cf="0">${esc(opts.cancelar || 'Cancelar')}</button>
          <button type="button" class="sv-btn-p" data-cf="1">${esc(aceptar)}</button>
        </div></div>`;
    const cerrar = ok => {
      document.removeEventListener('keydown', onKey, true);
      bg.classList.remove('is-on');
      setTimeout(() => bg.remove(), 120);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_e) { /* */ }
      resolve(ok);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    };
    bg.addEventListener('click', e => { if (e.target === bg) cerrar(false); });
    bg.querySelectorAll('[data-cf]').forEach(b => b.addEventListener('click', () => cerrar(b.dataset.cf === '1')));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('is-on'));
    bg.querySelector('[data-cf="1"]').focus();
  });
}
