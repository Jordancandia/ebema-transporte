// ============================================================================
// COMENTARIOS Y NOTIFICACIONES (12-oct-2026, Jordan)
// Orden de Carga de Gestión Troncales (Revex, Ventas CD, Retiros de Fábrica,
// Crossdocking, Pedidos de Traslados): comentarios por fila con @menciones,
// respuestas (un nivel) y me gusta. Campana en el encabezado con las
// notificaciones del usuario; al elegir una se abre la vista y el comentario.
// BD: trc_comentarios, trc_comentario_likes, notificaciones (los triggers
// generan las notificaciones), fn_usuarios_mencionables().
// Permisos: ver = perfiles internos; comentar / responder / me gusta =
// privilegio COMENTAR (can('comentar')); ocultar comentario = OWNER.
// ============================================================================
import { supabase } from './supabase-client.js?v=202610291554';
import { can, esOwner, perfilVeMenu } from './permisos.js?v=202610291554';
import { showAlert } from './utils.js';

export const VISTAS_COMENTARIOS = {
  pedidos_traslados_revex: 'Revex',
  pedidos_venta: 'Ventas CD (1003)',
  retiros: 'Retiros de Fábrica',
  pedidos_traslados_4000: 'Crossdocking',
  pedidos_traslados: 'Pedidos de Traslados',
};
export const comentariosHabilitados = vista => Object.prototype.hasOwnProperty.call(VISTAS_COMENTARIOS, vista);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const iniciales = n => String(n || '?').split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
export function hace(ts) {
  const d = new Date(ts); if (isNaN(d)) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} d`;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
const fechaLarga = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }); };

// ── Estilos (una vez) ─────────────────────────────────────────────────────
function css() {
  if (document.getElementById('cm-css')) return;
  const st = document.createElement('style'); st.id = 'cm-css';
  st.textContent = `
  .cm-wrap{display:flex;flex-direction:column;gap:10px}
  .cm-h{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700}
  .cm-h .material-symbols-outlined{font-size:18px;color:var(--sv-primary,#b5000b)}
  .cm-h small{font-weight:600;color:var(--sv-ink2,#5c5f61)}
  .cm-list{display:flex;flex-direction:column;gap:10px}
  .cm-empty{font-size:12px;color:var(--sv-ink2,#5c5f61);padding:10px 12px;background:var(--sv-s1,#f3f4f5);border-radius:6px}
  .cm-c{display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:8px;transition:background .6s}
  .cm-c.is-foco{background:#fff3cd;box-shadow:inset 3px 0 0 #ca8a04}
  .cm-av{width:30px;height:30px;border-radius:50%;background:var(--sv-sel,#ffdad5);color:var(--sv-primary-h,#930007);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0}
  .cm-b{flex:1;min-width:0}
  .cm-meta{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
  .cm-n{font-size:13px;font-weight:700;color:var(--sv-ink,#191c1d)}
  .cm-t{font-size:11px;color:var(--sv-ink2,#5c5f61)}
  .cm-x{font-size:13px;line-height:1.45;color:var(--sv-ink,#191c1d);white-space:pre-wrap;word-break:break-word;margin-top:2px}
  .cm-at{color:#1d4ed8;font-weight:700;background:#e8f0fe;border-radius:3px;padding:0 2px}
  .cm-acts{display:flex;gap:12px;margin-top:4px}
  .cm-a{border:none;background:none;padding:0;font-size:12px;font-weight:700;color:var(--sv-ink2,#5c5f61);cursor:pointer;display:inline-flex;align-items:center;gap:3px}
  .cm-a:hover{color:var(--sv-primary,#b5000b)}
  .cm-a .material-symbols-outlined{font-size:16px}
  .cm-a.is-on{color:var(--sv-primary,#b5000b)}
  .cm-a.is-on .material-symbols-outlined{font-variation-settings:'FILL' 1}
  .cm-replies{margin-top:6px;padding-left:12px;border-left:2px solid var(--sv-line,#e1e3e4);display:flex;flex-direction:column;gap:6px}
  .cm-replies .cm-c{padding:6px}
  .cm-replies .cm-av{width:24px;height:24px;font-size:10px}
  .cm-comp{position:relative;display:flex;flex-direction:column;gap:6px}
  .cm-comp textarea{width:100%;min-height:60px;resize:vertical;border:1.5px solid var(--sv-line,#e1e3e4);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;color:var(--sv-ink,#191c1d);box-sizing:border-box;outline:none}
  .cm-comp textarea:focus{border-color:var(--sv-primary,#b5000b)}
  .cm-comp-f{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .cm-hint{font-size:11px;color:var(--sv-ink2,#5c5f61)}
  .cm-send{border:none;background:var(--sv-primary,#b5000b);color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
  .cm-send:disabled{opacity:.5;cursor:default}
  .cm-send .material-symbols-outlined{font-size:16px}
  .cm-cancel{border:none;background:none;font-size:12px;font-weight:700;color:var(--sv-ink2,#5c5f61);cursor:pointer}
  .cm-dd{position:absolute;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid var(--sv-line,#e1e3e4);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;z-index:120}
  .cm-dd button{display:flex;width:100%;align-items:center;gap:8px;border:none;background:none;padding:7px 10px;text-align:left;cursor:pointer;font-size:13px}
  .cm-dd button.is-on,.cm-dd button:hover{background:var(--sv-sel2,#fff5f3)}
  .cm-dd small{color:var(--sv-ink2,#5c5f61);font-size:11px;margin-left:auto}
  .cm-ro{font-size:11px;color:var(--sv-ink2,#5c5f61)}
  .cm-cnt{border:1px solid transparent;background:none;border-radius:12px;padding:2px 6px;display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--sv-ink2,#5c5f61);cursor:pointer}
  .cm-cnt:hover{border-color:var(--sv-line,#e1e3e4);color:var(--sv-primary,#b5000b)}
  .cm-cnt.has{color:var(--sv-primary,#b5000b)}
  .cm-cnt .material-symbols-outlined{font-size:17px}
  .cm-cnt.has .material-symbols-outlined{font-variation-settings:'FILL' 1}
  /* Campana */
  .nt-wrap{position:relative}
  .nt-btn{position:relative}
  .nt-badge{position:absolute;top:0;right:0;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--sv-primary,#b5000b);color:#fff;font-size:10px;font-weight:800;line-height:16px;text-align:center;box-sizing:border-box}
  .nt-pop{position:absolute;right:0;top:calc(100% + 6px);width:min(400px,calc(100vw - 24px));max-height:70vh;display:flex;flex-direction:column;background:#fff;border:1px solid var(--sv-line,#e1e3e4);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16);z-index:95;overflow:hidden}
  .nt-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--sv-line,#e1e3e4)}
  .nt-h b{font-size:14px}
  .nt-all{border:none;background:none;font-size:12px;font-weight:700;color:var(--sv-primary,#b5000b);cursor:pointer}
  .nt-list{overflow-y:auto}
  .nt-i{display:flex;gap:10px;width:100%;border:none;background:none;text-align:left;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--sv-line2,#edeeef)}
  .nt-i:hover{background:var(--sv-s1,#f3f4f5)}
  .nt-i.is-new{background:var(--sv-sel2,#fff5f3)}
  .nt-ic{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .nt-ic .material-symbols-outlined{font-size:17px}
  .nt-tx{flex:1;min-width:0;font-size:13px;color:var(--sv-ink,#191c1d);line-height:1.35}
  .nt-ex{font-size:12px;color:var(--sv-ink2,#5c5f61);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .nt-tm{font-size:11px;color:var(--sv-ink2,#5c5f61);margin-top:2px}
  .nt-dot{width:8px;height:8px;border-radius:50%;background:var(--sv-primary,#b5000b);flex-shrink:0;margin-top:6px}
  .nt-empty{padding:28px 14px;text-align:center;font-size:13px;color:var(--sv-ink2,#5c5f61)}
  .nt-empty .material-symbols-outlined{display:block;font-size:30px;opacity:.4;margin-bottom:6px}
  .cm-solo-bg{position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:90}
  `;
  document.head.appendChild(st);
}

// ── Sesión ────────────────────────────────────────────────────────────────
let _email = null;
async function miEmail() {
  if (_email) return _email;
  try { const { data } = await supabase.auth.getUser(); _email = (data?.user?.email || '').toLowerCase() || null; } catch (_e) { /* sin sesión */ }
  return _email;
}

// ── Usuarios etiquetables ───────────────────────────────────────────────────
let _usuarios = null, _usuariosTs = 0;
async function usuarios() {
  if (_usuarios && Date.now() - _usuariosTs < 600000) return _usuarios;
  const { data, error } = await supabase.rpc('fn_usuarios_mencionables');
  if (error) { console.warn('menciones:', error.message); return _usuarios || []; }
  _usuarios = data || []; _usuariosTs = Date.now();
  return _usuarios;
}
// Sólo se puede etiquetar a quien ve la vista (perfil base o vista extra asignada por Owner)
function veVista(u, vista) {
  const k = `abastecimiento:${vista}`;
  return perfilVeMenu(u.perfil, k) || (u.vistas_extra || []).includes(k);
}

// ── Conteo por fila (columna de la tabla) ───────────────────────────────────
export async function conteosComentarios(vista) {
  const m = new Map();
  for (let p = 0; p < 10; p++) {
    const { data, error } = await supabase.from('trc_comentarios').select('clave').eq('vista', vista).eq('borrado', false).range(p * 1000, p * 1000 + 999);
    if (error) { console.warn('comentarios:', error.message); break; }
    (data || []).forEach(r => m.set(r.clave, (m.get(r.clave) || 0) + 1));
    if (!data || data.length < 1000) break;
  }
  return m;
}
export function celdaComentarios(n, rid) {
  return `<button class="cm-cnt ${n ? 'has' : ''}" data-cmt="${esc(rid)}" data-ro-ok title="${n ? `${n} comentario${n > 1 ? 's' : ''}` : 'Comentar'}">
    <span class="material-symbols-outlined">${n ? 'forum' : 'add_comment'}</span>${n ? n : ''}</button>`;
}

// ── Foco pendiente (desde una notificación) ─────────────────────────────────
let _foco = null;
export function setFoco(f) { _foco = f; }
export function tomarFoco(vista) { if (_foco && _foco.vista === vista) { const f = _foco; _foco = null; return f; } return null; }

// ── Editor con @menciones ───────────────────────────────────────────────────
function editor(host, { vista, placeholder, prefill = '', prefillMenc = [], onEnviar, onCancelar, autofocus }) {
  host.innerHTML = `<div class="cm-comp">
    <textarea maxlength="2000" placeholder="${esc(placeholder)}">${esc(prefill)}</textarea>
    <div class="cm-comp-f"><span class="cm-hint">Escribe @ para etiquetar a alguien</span>
      <span style="display:flex;gap:8px;align-items:center">${onCancelar ? '<button type="button" class="cm-cancel" data-ro-ok>Cancelar</button>' : ''}
      <button type="button" class="cm-send" data-ro-ok disabled><span class="material-symbols-outlined">send</span>Comentar</button></span></div></div>`;
  const ta = host.querySelector('textarea'), send = host.querySelector('.cm-send'), comp = host.querySelector('.cm-comp');
  const menc = new Map(prefillMenc.map(u => [u.email, u.nombre]));
  let dd = null, opts = [], sel = 0, inicio = -1;
  const cerrar = () => { dd?.remove(); dd = null; inicio = -1; };
  const upd = () => { send.disabled = !ta.value.trim(); };
  const elegir = u => {
    if (!u || inicio < 0) return;
    const ini = ta.value.slice(0, inicio), fin = ta.value.slice(ta.selectionStart);
    const ins = `@${u.nombre} `;
    ta.value = ini + ins + fin;
    const pos = (ini + ins).length; ta.setSelectionRange(pos, pos);
    menc.set(u.email, u.nombre);
    cerrar(); upd(); ta.focus();
  };
  const pintar = () => {
    if (!opts.length) { cerrar(); return; }
    if (!dd) { dd = document.createElement('div'); dd.className = 'cm-dd'; comp.appendChild(dd); }
    dd.innerHTML = opts.map((u, i) => `<button type="button" data-ro-ok data-i="${i}" class="${i === sel ? 'is-on' : ''}">
      <span class="cm-av" style="width:24px;height:24px;font-size:10px">${esc(iniciales(u.nombre))}</span>${esc(u.nombre)}<small>${esc(u.email)}</small></button>`).join('');
    dd.querySelectorAll('[data-i]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); elegir(opts[+b.dataset.i]); }));
  };
  ta.addEventListener('input', async () => {
    upd();
    const antes = ta.value.slice(0, ta.selectionStart);
    const m = antes.match(/(^|\s)@([^\s@]{0,25}(?:\s[^\s@]{0,25})?)$/);
    if (!m) { cerrar(); return; }
    inicio = antes.length - m[2].length - 1;
    const q = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const yo = await miEmail();
    const lista = (await usuarios()).filter(u => u.email !== yo && veVista(u, vista));
    opts = lista.filter(u => (u.nombre + ' ' + u.email).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)).slice(0, 8);
    sel = 0; pintar();
  });
  ta.addEventListener('keydown', e => {
    if (dd && opts.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % opts.length; pintar(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + opts.length) % opts.length; pintar(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); elegir(opts[sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !send.disabled) { e.preventDefault(); send.click(); }
  });
  ta.addEventListener('blur', () => setTimeout(cerrar, 150));
  host.querySelector('.cm-cancel')?.addEventListener('click', () => onCancelar && onCancelar());
  send.addEventListener('click', async () => {
    const texto = ta.value.trim(); if (!texto) return;
    const menciones = [...menc.entries()].filter(([, n]) => texto.includes('@' + n)).map(([e]) => e);
    send.disabled = true;
    const ok = await onEnviar(texto, menciones);
    if (ok) { ta.value = ''; menc.clear(); } else send.disabled = false;
    upd();
  });
  upd();
  if (autofocus) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

// Texto con las menciones resaltadas
function textoHtml(c, nombres) {
  let h = esc(c.texto);
  (c.menciones || []).map(e => nombres.get(e)).filter(Boolean).sort((a, b) => b.length - a.length)
    .forEach(n => { const t = esc('@' + n); h = h.split(t).join(`<span class="cm-at">${t}</span>`); });
  return h;
}

// ── Hilo de comentarios de una fila ─────────────────────────────────────────
// opts: { vista, clave, documento, centro, focoId, onCount(n) }
export async function montarHilo(el, opts) {
  css();
  const { vista, clave } = opts;
  const yo = await miEmail();
  const puede = can('comentar');
  el.innerHTML = '<div class="cm-wrap"><div class="cm-h"><span class="material-symbols-outlined">forum</span>Comentarios</div><div class="cm-empty">Cargando comentarios…</div></div>';
  let lista = [], likes = new Map(), respondiendo = null;

  async function cargar() {
    const { data, error } = await supabase.from('trc_comentarios').select('*').eq('vista', vista).eq('clave', clave).eq('borrado', false).order('created_at');
    if (error) { el.querySelector('.cm-empty').textContent = 'No se pudieron cargar los comentarios: ' + error.message; return false; }
    lista = data || [];
    likes = new Map();
    if (lista.length) {
      const { data: lk } = await supabase.from('trc_comentario_likes').select('comentario_id,email').in('comentario_id', lista.map(c => c.id));
      (lk || []).forEach(l => { if (!likes.has(l.comentario_id)) likes.set(l.comentario_id, []); likes.get(l.comentario_id).push(l.email); });
    }
    opts.onCount && opts.onCount(lista.length);
    return true;
  }
  const nombres = () => {
    const m = new Map((_usuarios || []).map(u => [u.email, u.nombre]));
    lista.forEach(c => m.set(c.autor_email, c.autor_nombre));
    return m;
  };
  function cHtml(c, esResp) {
    const lk = likes.get(c.id) || [], mio = lk.includes(yo);
    const nm = nombres();
    const quien = lk.map(e => nm.get(e) || e.split('@')[0]).join(', ');
    return `<div class="cm-c" id="cm-${c.id}" data-cid="${c.id}">
      <div class="cm-av" title="${esc(c.autor_email)}">${esc(iniciales(c.autor_nombre))}</div>
      <div class="cm-b">
        <div class="cm-meta"><span class="cm-n">${esc(c.autor_nombre || c.autor_email)}</span><span class="cm-t" title="${esc(fechaLarga(c.created_at))}">${esc(hace(c.created_at))}</span></div>
        <div class="cm-x">${textoHtml(c, nm)}</div>
        <div class="cm-acts">
          <button class="cm-a ${mio ? 'is-on' : ''}" data-like="${c.id}" data-ro-ok ${puede ? '' : 'disabled'} title="${esc(quien || (puede ? 'Me gusta' : ''))}"><span class="material-symbols-outlined">thumb_up</span>${lk.length ? lk.length : ''} Me gusta</button>
          ${puede ? `<button class="cm-a" data-resp="${c.id}" data-ro-ok><span class="material-symbols-outlined">reply</span>Responder</button>` : ''}
          ${esOwner() ? `<button class="cm-a" data-ocultar="${c.id}" data-ro-ok title="Ocultar comentario"><span class="material-symbols-outlined">visibility_off</span>Ocultar</button>` : ''}
        </div>
        ${!esResp ? `<div class="cm-replies" data-replies="${c.id}" ${lista.some(r => r.parent_id === c.id) || respondiendo?.root === c.id ? '' : 'style="display:none"'}>
          ${lista.filter(r => r.parent_id === c.id).map(r => cHtml(r, true)).join('')}
          <div data-rbox="${c.id}"></div></div>` : ''}
      </div></div>`;
  }
  function pintar() {
    const raices = lista.filter(c => !c.parent_id);
    el.innerHTML = `<div class="cm-wrap">
      <div class="cm-h"><span class="material-symbols-outlined">forum</span>Comentarios <small>${lista.length ? `(${lista.length})` : ''}</small></div>
      <div class="cm-list">${raices.length ? raices.map(c => cHtml(c, false)).join('') : '<div class="cm-empty">Aún no hay comentarios en este registro.</div>'}</div>
      ${puede ? '<div data-nuevo></div>' : '<div class="cm-ro">Tu perfil puede ver los comentarios, pero no comentar.</div>'}
    </div>`;
    if (puede) editor(el.querySelector('[data-nuevo]'), { vista, placeholder: 'Agrega un comentario…', onEnviar: (t, m) => publicar(t, m, null) });
    if (respondiendo) {
      const box = el.querySelector(`[data-rbox="${respondiendo.root}"]`);
      if (box) editor(box, { vista, placeholder: 'Escribe una respuesta…', prefill: respondiendo.prefill, prefillMenc: respondiendo.menc, autofocus: true,
        onEnviar: (t, m) => publicar(t, m, respondiendo.root), onCancelar: () => { respondiendo = null; pintar(); } });
    }
    el.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', () => toggleLike(+b.dataset.like)));
    el.querySelectorAll('[data-resp]').forEach(b => b.addEventListener('click', () => {
      const c = lista.find(x => x.id === +b.dataset.resp); if (!c) return;
      const root = c.parent_id || c.id;
      const otro = c.autor_email !== yo;
      respondiendo = { root, prefill: otro ? `@${c.autor_nombre} ` : '', menc: otro ? [{ email: c.autor_email, nombre: c.autor_nombre }] : [] };
      pintar();
    }));
    el.querySelectorAll('[data-ocultar]').forEach(b => b.addEventListener('click', async () => {
      const { error } = await supabase.from('trc_comentarios').update({ borrado: true }).eq('id', +b.dataset.ocultar);
      if (error) { showAlert('No se pudo ocultar: ' + error.message, 'error'); return; }
      await cargar(); pintar();
    }));
  }
  async function publicar(texto, menciones, parent) {
    const fila = { vista, clave, documento: opts.documento || null, centro: opts.centro || null, texto, menciones, parent_id: parent, autor_email: yo };
    const { error } = await supabase.from('trc_comentarios').insert(fila);
    if (error) { showAlert('No se pudo publicar el comentario: ' + error.message, 'error'); return false; }
    if (parent) respondiendo = null;
    await cargar(); pintar();
    const ult = lista[lista.length - 1];
    if (ult) el.querySelector(`#cm-${ult.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
  }
  async function toggleLike(id) {
    if (!puede || !yo) return;
    const mio = (likes.get(id) || []).includes(yo);
    const q = mio ? supabase.from('trc_comentario_likes').delete().eq('comentario_id', id).eq('email', yo)
      : supabase.from('trc_comentario_likes').insert({ comentario_id: id, email: yo });
    const { error } = await q;
    if (error) { showAlert('No se pudo registrar el me gusta: ' + error.message, 'error'); return; }
    await cargar(); pintar();
  }

  usuarios(); // precarga para menciones
  if (!(await cargar())) return;
  pintar();
  if (opts.focoId) {
    const c = el.querySelector(`#cm-${opts.focoId}`);
    if (c) {
      c.classList.add('is-foco');
      setTimeout(() => c.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
      setTimeout(() => c.classList.remove('is-foco'), 4000);
    } else showAlert('Ese comentario ya no está disponible.', 'error');
  }
}

// Hilo suelto cuando el registro ya no está en la vista (p. ej. el pedido salió del SQVI)
export function abrirHiloSuelto(f) {
  css();
  document.getElementById('cm-solo')?.remove();
  const wrap = document.createElement('div'); wrap.id = 'cm-solo';
  wrap.innerHTML = `<div class="cm-solo-bg" data-x></div><aside class="sv-dr" role="dialog" aria-label="Comentarios">
    <div class="sv-dr-h"><div style="flex:1;min-width:0"><div class="sv-dr-k">${esc(VISTAS_COMENTARIOS[f.vista] || f.vista)}</div>
      <div class="sv-dr-t">${esc(f.documento || f.clave)}</div><div class="sv-dr-s">El registro ya no aparece en la vista con los datos actuales.</div></div>
      <button class="sv-iconbtn" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="sv-dr-b"><div data-hilo></div></div></aside>`;
  document.body.appendChild(wrap);
  const cerrar = () => { wrap.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') cerrar(); };
  wrap.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
  document.addEventListener('keydown', esc_);
  montarHilo(wrap.querySelector('[data-hilo]'), { vista: f.vista, clave: f.clave, documento: f.documento, focoId: f.comentarioId });
}

// ── Campana de notificaciones ───────────────────────────────────────────────
const TIPO = {
  mencion:   { icon: 'alternate_email', bg: '#e8f0fe', fg: '#1d4ed8', txt: 'te etiquetó en' },
  respuesta: { icon: 'reply',           bg: '#e6f4ea', fg: '#137333', txt: 'respondió en' },
  like:      { icon: 'thumb_up',        bg: '#fff5f3', fg: '#b5000b', txt: 'dio me gusta a tu comentario en' },
  // (15-oct-2026, Jordan) Flujo de aprobación de PRIORIDAD de carga (Operaciones → Abastecimiento)
  prioridad_solicitud: { icon: 'priority_high', bg: '#fff4e5', fg: '#c2410c', txt: 'solicita evaluar PRIORIDAD de carga en' },
  prioridad_aceptada:  { icon: 'check_circle',  bg: '#e6f4ea', fg: '#137333', txt: 'aceptó tu PRIORIDAD de carga en' },
  prioridad_rechazada: { icon: 'block',         bg: '#fde8e8', fg: '#b91c1c', txt: 'rechazó tu PRIORIDAD de carga en' },
};
let _timer = null;
export async function initCampana(slot, { navegar }) {
  css();
  if (!slot) return;
  const yo = await miEmail();
  if (!yo) return;
  slot.innerHTML = `<div class="nt-wrap"><button class="sv-iconbtn nt-btn" data-ro-ok id="nt-btn" title="Notificaciones" aria-haspopup="true" aria-expanded="false">
      <span class="material-symbols-outlined">notifications</span><span class="nt-badge" hidden></span></button><div data-pop></div></div>`;
  const btn = slot.querySelector('#nt-btn'), badge = slot.querySelector('.nt-badge'), popSlot = slot.querySelector('[data-pop]');
  let abierto = false, items = [];

  async function contar() {
    if (document.hidden) return;
    const { count, error } = await supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('destinatario', yo).eq('leida', false);
    if (error) return;
    badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count || '');
    btn.title = count ? `Notificaciones (${count} sin leer)` : 'Notificaciones';
  }
  async function cargar() {
    const { data } = await supabase.from('notificaciones').select('*').eq('destinatario', yo).order('created_at', { ascending: false }).limit(40);
    items = data || [];
  }
  function pintar() {
    if (!abierto) { popSlot.innerHTML = ''; btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    const nuevas = items.filter(n => !n.leida).length;
    popSlot.innerHTML = `<div class="nt-pop" role="dialog" aria-label="Notificaciones">
      <div class="nt-h"><b>Notificaciones</b>${nuevas ? '<button class="nt-all" data-ro-ok data-todas>Marcar todo como leído</button>' : ''}</div>
      <div class="nt-list">${items.length ? items.map(n => {
        const t = TIPO[n.tipo] || TIPO.mencion;
        return `<button class="nt-i ${n.leida ? '' : 'is-new'}" data-ro-ok data-n="${n.id}">
          <span class="nt-ic" style="background:${t.bg};color:${t.fg}"><span class="material-symbols-outlined">${t.icon}</span></span>
          <span class="nt-tx"><b>${esc(n.actor_nombre || n.actor_email)}</b> ${t.txt} <b>${esc(VISTAS_COMENTARIOS[n.vista] || n.vista || '')}</b>${n.documento ? ` · ${esc(n.documento)}` : ''}
            ${n.extracto ? `<div class="nt-ex">“${esc(n.extracto)}”</div>` : ''}<div class="nt-tm">${esc(hace(n.created_at))}</div></span>
          ${n.leida ? '' : '<span class="nt-dot"></span>'}</button>`;
      }).join('') : '<div class="nt-empty"><span class="material-symbols-outlined">notifications_off</span>No tienes notificaciones.</div>'}</div></div>`;
    popSlot.querySelector('[data-todas]')?.addEventListener('click', async e => {
      e.stopPropagation();
      await supabase.from('notificaciones').update({ leida: true }).eq('destinatario', yo).eq('leida', false);
      items.forEach(n => { n.leida = true; }); pintar(); contar();
    });
    popSlot.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const n = items.find(x => x.id === +b.dataset.n); if (!n) return;
      if (!n.leida) { await supabase.from('notificaciones').update({ leida: true }).eq('id', n.id); n.leida = true; }
      abierto = false; pintar(); contar();
      setFoco({ vista: n.vista, clave: n.clave, documento: n.documento, comentarioId: n.comentario_id, prio: String(n.tipo || '').startsWith('prioridad') });
      navegar(n.vista);
    }));
  }
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    abierto = !abierto;
    if (abierto) { await cargar(); }
    pintar();
  });
  document.addEventListener('click', e => { if (abierto && !slot.contains(e.target)) { abierto = false; pintar(); } });
  document.addEventListener('keydown', e => { if (abierto && e.key === 'Escape') { abierto = false; pintar(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) contar(); });
  if (_timer) clearInterval(_timer);
  _timer = setInterval(contar, 60000);
  contar();
}
