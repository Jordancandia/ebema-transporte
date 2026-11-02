// ============================================================================
//  PORTERÍA · RELOJ CONTROL v2 (1-nov-2026, Jordan)
//  Control puerta trabaja por PESTAÑA de tipo de visita:
//    TRONCAL          troncales del Plan de Carga por bloque + ramplas CD-Cliente
//                     (un troncal con retiro de fábrica = UNA línea, con sus guías)
//    PROVEEDOR        agenda del día por bloque + los que llegan sin agenda
//    RETIRO_CLIENTE   no se programa: el cliente llega y se presenta
//    DESPACHO_EBEMA   salida a cliente (entregas + pesos) y retorno (peso y devoluciones)
//  Reglas: la hora de cada hito la pone el servidor; TODO camión que ingresa se
//  pesa en romana (fn_porteria_marcar lo exige); búsqueda única por patente /
//  NV / OC / guía / entrega / chofer; monitor de alertas para Operaciones con
//  umbrales configurables.
//  SQL: supabase/sql/2026-10-18_porteria_reloj_control.sql
//       supabase/sql/2026-11-01_porteria_v2_pestanas_alertas.sql
// ============================================================================
import { supabase } from './supabase-client.js?v=202611021253';
import { escapeHtml as esc, showAlert, toCSV, downloadFile } from './utils.js';
import { confirmar, pedirDato } from './confirmar.js?v=202611021253';
import { getPerfil, PERFIL_UMBRALES } from './permisos.js?v=202611021253';

const CENTRO = '1003';
const TZ = 'America/Santiago';
const TIPOS = {
  TRONCAL:        { label: 'Troncal',        icon: 'local_shipping', pill: 'info',   hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Sucursal destino' },
  PROVEEDOR:      { label: 'Proveedor',      icon: 'factory',        pill: 'purple', hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Proveedor' },
  RETIRO_CLIENTE: { label: 'Cliente retira', icon: 'person',         pill: 'orange', hitos: ['presentacion', 'ingreso', 'salida'], contra: 'Cliente' },
  DESPACHO_EBEMA: { label: 'Despacho Ebema', icon: 'outbound',       pill: 'mute',   hitos: ['salida', 'regreso'],                 contra: 'Cliente / obra' },
};
// Pestañas de control puerta (una por tipo de visita)
const TABS = [
  { k: 'TRONCAL',        icon: 'local_shipping', label: 'Troncales',          sub: 'Programados · por bloque' },
  { k: 'PROVEEDOR',      icon: 'factory',        label: 'Proveedores',        sub: 'Agenda por bloque' },
  { k: 'RETIRO_CLIENTE', icon: 'person',         label: 'Cliente retira',     sub: 'Sin agenda · llega y se presenta' },
  { k: 'DESPACHO_EBEMA', icon: 'outbound',       label: 'Despacho a cliente', sub: 'Salida y retorno' },
];
const HITO_LBL = { presentacion: 'Llegada', ingreso: 'Ingreso', salida: 'Salida', regreso: 'Ingreso' };
const HITO_BTN = { presentacion: 'Llegó', ingreso: 'Ingresa', salida: 'Sale', regreso: 'Registrar retorno' };
const ESTADOS = {
  PROGRAMADO: ['Programado', 'mute'], EN_COLA: ['En cola', 'warn'], EN_PATIO: ['En patio', 'info'], EN_RUTA: ['En ruta', 'purple'],
  FINALIZADO: ['Finalizado', 'ok'], NO_SE_PRESENTA: ['No se presenta', 'bad'], NO_CARGA: ['No carga', 'orange'], ANULADO: ['Anulado', 'mute'],
};
const DOC_TIPOS = ['GUIA', 'OC', 'NV', 'ENTREGA', 'DT'];
const MOTIVOS_DEV = ['Cliente rechazó la entrega', 'No había quien recibiera', 'Dirección o acceso con problema', 'Producto no conforme', 'Otro'];
const COLS = 'id,fecha,centro,tipo,subtipo,estado,patente,patente_carro,chofer_nombre,chofer_rut,chofer_telefono,id_transporte,transportista,contraparte,ce,documentos,hora_agenda,t_presentacion,t_ingreso,t_salida,t_regreso,tara_kg,bruto_kg,peso_guias_kg,neto_kg,origen,clave_esperado,plan_ref,retiros,consolida_retiro,obs,created_by,updated_by,updated_at'
  + ',pedido_venta,retira_nombre,retira_rut,retira_telefono,retira_es_chofer,fuera_agenda,guias_proveedor,bruto_ingreso_kg,entregas_devueltas,motivo_devolucion,anden,sin_romana_autorizado,sin_romana_por,patente_coordinada,chofer_coordinado,datos_confirmados_at,datos_confirmados_por';

const S = {
  fecha: hoy(), sub: 'registro', tab: 'TRONCAL', q: '', busq: null, visitas: [], esperados: [], metas: {}, cfg: {}, bloques: [], centros: null, proveedores: null,
  desde: addDays(hoy(), -30), hasta: hoy(), ind: null, alertas: null,
};
let _stage = null;
let _tick = null;
let _poll = null;

// ── Utilidades ──────────────────────────────────────────────────────────────
function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const hhmm = t => (t ? new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '');
const fechaCorta = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '');
const minEntre = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);
const nf = (v, d = 0) => (v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: d }));
function fmtMin(m) {
  if (m == null || isNaN(m)) return '—';
  m = Math.max(0, Math.round(m));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
function num(v) {
  if (v == null) return null;
  let s = String(v).trim(); if (!s) return null;
  s = s.replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function fmtPatente(p) {
  const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}([A-Z]{2}|[0-9]{2})[0-9]{2}$/.test(s) ? `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}` : String(p || '').trim().toUpperCase();
}
const patenteValida = p => /^[A-Z]{2}-[A-Z0-9]{2}-[0-9]{2}$/.test(fmtPatente(p));
function toLocalInput(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
const pill = (txt, cls) => `<span class="sv-pill ${cls}"><i></i>${esc(txt)}</span>`;
const tipoPill = t => pill(TIPOS[t]?.label || t, TIPOS[t]?.pill || 'mute');
const estadoPill = e => pill((ESTADOS[e] || [e])[0], (ESTADOS[e] || [e, 'mute'])[1]);
const docsTxt = docs => (Array.isArray(docs) ? docs : []).map(d => `${d.tipo} ${d.numero}`).join(' · ');
const arr = x => (Array.isArray(x) ? x : []);

// ── Horario de presentación solicitado (28-oct-2026) ────────────────────────
const TOL_CITA_MIN = 15;
const hmMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const esCdCliente = x => x && x.subtipo === 'CD_CLIENTE';
const esRampla = esCdCliente;
function citaDe(x) {
  const r = (x && x.plan_ref) || {};
  const desde = x.hora_presentacion || r.hora_presentacion || (x.hora_agenda ? hhmm(x.hora_agenda) : '');
  const hasta = x.hora_hasta || r.hora_hasta || '';
  const bloque = x.bloque ?? r.bloque ?? null;
  return desde ? { desde, hasta, bloque, txt: hasta ? `${desde}–${hasta}` : desde } : null;
}
const horaEn = (fechaIso, min) => new Date(`${fechaIso}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`);
const limiteCita = (c, fechaIso) => horaEn(fechaIso, hmMin(c.hasta) ?? ((hmMin(c.desde) ?? 0) + TOL_CITA_MIN));
const inicioCita = (c, fechaIso) => horaEn(fechaIso, hmMin(c.desde) ?? 0);
function cumpleCita(v) {
  const c = citaDe(v);
  if (!c || !v.t_presentacion) return null;
  const lleg = new Date(v.t_presentacion), ini = inicioCita(c, v.fecha), lim = limiteCita(c, v.fecha);
  if (lleg < ini) return { txt: `Anticipado ${fmtMin((ini - lleg) / 60000)}`, cls: 'info' };
  if (lleg <= lim) return { txt: 'En horario', cls: 'ok' };
  return { txt: `Atrasado ${fmtMin((lleg - (c.hasta ? lim : ini)) / 60000)}`, cls: 'bad' };
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/ROMANA_INGRESO/.test(m)) return 'Todo camión que ingresa se pesa: registre el peso de entrada antes del ingreso.';
  if (/ROMANA_REGRESO/.test(m)) return 'Registre el peso de ingreso del camión antes de cerrar el retorno.';
  if (/chk_pv_ingreso/.test(m)) return 'El ingreso no puede ser anterior a la presentación.';
  if (/chk_pv_salida/.test(m)) return 'La salida no puede ser anterior al ingreso.';
  if (/chk_pv_regreso/.test(m)) return 'El regreso no puede ser anterior a la salida.';
  if (/ux_porteria_esperado/.test(m)) return 'Ese camión esperado ya fue registrado hoy.';
  return m;
}

function proximoHito(v) {
  if (['FINALIZADO', 'NO_SE_PRESENTA', 'NO_CARGA', 'ANULADO'].includes(v.estado)) return null;
  return (TIPOS[v.tipo]?.hitos || []).find(h => !v['t_' + h]) || null;
}
// Tiempo vigente (en curso) o final, y contra qué umbral se compara
function tiempo(v, ahora = new Date()) {
  const now = ahora.toISOString();
  const meta = S.metas[v.tipo] || {};
  if (v.tipo === 'DESPACHO_EBEMA') {
    if (v.t_regreso) return { min: minEntre(v.t_salida, v.t_regreso), que: 'Ruta', vivo: false, umbral: meta.meta_min };
    if (v.t_salida && v.estado === 'EN_RUTA') return { min: minEntre(v.t_salida, now), que: 'En ruta', vivo: true, umbral: meta.meta_min };
    return { min: null, que: '' };
  }
  if (v.t_salida && v.t_ingreso) return { min: minEntre(v.t_ingreso, v.t_salida), que: 'Permanencia', vivo: false, umbral: meta.meta_min };
  if (v.t_ingreso && v.estado === 'EN_PATIO') return { min: minEntre(v.t_ingreso, now), que: 'En patio', vivo: true, umbral: meta.meta_min };
  if (v.t_presentacion && v.estado === 'EN_COLA') return { min: minEntre(v.t_presentacion, now), que: 'Sin atención', vivo: true, umbral: meta.meta_espera_min };
  return { min: null, que: '' };
}
function semaforo(t) {
  if (!t.umbral || t.min == null) return 'mute';
  if (t.min > t.umbral) return 'bad';
  if (t.min > t.umbral * 0.8) return 'warn';
  return 'ok';
}
// Carga según romana de un despacho (bruto de salida − tara) y su diferencia con las guías
function cargaRomana(v) {
  if (v.tipo !== 'DESPACHO_EBEMA' || v.bruto_kg == null || v.tara_kg == null) return null;
  const carga = v.bruto_kg - v.tara_kg;
  const g = v.peso_guias_kg;
  const pct = g > 0 ? (carga - g) / g * 100 : null;
  return { carga, guias: g, pct, fuera: pct != null && Math.abs(pct) > Number(S.metas[v.tipo]?.tolerancia_peso_pct ?? 3) };
}
const vuelveKg = v => (v.bruto_ingreso_kg != null && v.tara_kg != null ? v.bruto_ingreso_kg - v.tara_kg : null);

// ── Estilos propios (sobre el sistema visual v2) ────────────────────────────
function css() {
  if (document.getElementById('pt-css')) return;
  const st = document.createElement('style');
  st.id = 'pt-css';
  st.textContent = `
  .pt .sv-card { overflow: hidden; }
  .pt-ch { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:13px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-ch h2 { margin:0; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .pt-ch h2 small { font-weight:600; color:var(--sv-ink2); font-size:12px; }
  .pt-mono { font-family: var(--sv-mono); font-size:12.5px; }
  .pt-sub { font-size:12px; color:var(--sv-ink2); margin-top:2px; }
  .pt-na { color: var(--sv-line); }
  .pt-live { animation: ptPulse 2s ease-in-out infinite; }
  @keyframes ptPulse { 50% { opacity:.55; } }
  /* Pestañas de tipo de visita */
  .pt-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
  .pt-tab { font:inherit; cursor:pointer; background:#fff; border:1px solid var(--sv-line); border-radius:11px; padding:12px 14px; min-height:72px; display:flex; align-items:center; gap:11px; text-align:left; color:var(--sv-ink); }
  .pt-tab:hover { border-color: var(--sv-ink); }
  .pt-tab.is-on { background: var(--sv-ink); border-color: var(--sv-ink); color:#fff; }
  .pt-tab i { width:36px; height:36px; border-radius:9px; background:var(--sv-s2); display:flex; align-items:center; justify-content:center; flex:none; }
  .pt-tab.is-on i { background: rgba(255,255,255,.14); }
  .pt-tab i .material-symbols-outlined { font-size:21px; }
  .pt-tab b { display:block; font-size:14px; font-weight:700; }
  .pt-tab span { display:block; font-size:11.5px; color:var(--sv-ink2); margin-top:2px; }
  .pt-tab.is-on span { color: rgba(255,255,255,.72); }
  .pt-tab em { margin-left:auto; font-style:normal; font-family:var(--sv-mono); font-size:17px; font-weight:700; }
  /* Buscador único */
  .pt-srch { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--sv-line); border-radius:8px; padding:0 11px; min-height:38px; min-width:250px; }
  .pt-srch:focus-within { border-color: var(--sv-ink); }
  .pt-srch input { border:none; outline:none; font:inherit; font-size:13px; width:100%; min-width:0; background:none; font-family:var(--sv-mono); text-transform:uppercase; }
  .pt-srch .material-symbols-outlined { font-size:19px; color:var(--sv-ink2); }
  /* Secciones y filas */
  .pt-sect { font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--sv-ink); background:var(--sv-s1); padding:8px 16px; display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid var(--sv-line); border-top:1px solid var(--sv-line); }
  .pt-sect span { font-family:var(--sv-mono); letter-spacing:0; text-transform:none; color:var(--sv-ink2); font-size:12px; }
  .pt-sect.is-off { background:#fdf6e6; color:#7a4f00; }
  .pt-row { display:grid; grid-template-columns:120px 190px minmax(0,1fr) 292px 116px 128px; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-row:hover { background: var(--sv-s1); }
  .pt-plate { font-family:var(--sv-mono); font-size:20px; font-weight:700; line-height:1.1; }
  .pt-dest { font-size:14px; font-weight:600; }
  .pt-st { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:700; white-space:nowrap; }
  .pt-st i { width:10px; height:10px; border-radius:50%; flex:none; }
  .pt-step { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
  .pt-step.is-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .pt-h { border:1px solid var(--sv-line); border-radius:7px; padding:5px 7px; background:var(--sv-s1); }
  .pt-h.done { background:#eef4ef; border-color:#cfe2d5; }
  .pt-h.next { background:#fff; border:2px solid var(--sv-ink); padding:4px 6px; }
  .pt-h b { display:block; font-size:9.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--sv-ink2); }
  .pt-h u { display:block; text-decoration:none; font-family:var(--sv-mono); font-size:14.5px; font-weight:700; margin-top:1px; }
  .pt-h u.na { color:#a9aba7; }
  .pt-h s { display:block; text-decoration:none; font-family:var(--sv-mono); font-size:10.5px; color:var(--sv-ink2); }
  .pt-tm { font-family:var(--sv-mono); font-size:17px; font-weight:700; line-height:1.1; }
  .pt-tml { font-size:11px; color:var(--sv-ink2); margin-top:2px; }
  .pt-bar { height:4px; background:var(--sv-s2); border-radius:2px; overflow:hidden; margin-top:5px; }
  .pt-bar i { display:block; height:100%; }
  .pt-band { display:flex; align-items:center; gap:9px; flex-wrap:wrap; background:#fdf6e6; border-bottom:1px solid #f0dcb0; padding:8px 16px; font-size:12.5px; color:#5a3b00; }
  .pt-band b { font-weight:700; }
  .pt-band .sv-btn { background:#fff; }
  .pt-cta { background:var(--sv-ink); color:#fff; border-radius:12px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .pt-cta h2 { margin:0; font-size:16px; font-weight:700; }
  .pt-cta p { margin:4px 0 0; font-size:12.5px; color:rgba(255,255,255,.72); max-width:80ch; }
  .pt-tag { font-size:11px; font-weight:600; border-radius:5px; padding:2px 7px; background:var(--sv-s2); color:var(--sv-ink); border:1px solid var(--sv-line); font-family:var(--sv-mono); }
  .pt-tag.miss { background:#fbe7e8; border-color:#e8c3c5; color:#8e0009; font-family:inherit; }
  .pt-tags { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; align-items:center; }
  .pt-addg { font:inherit; font-size:11px; font-weight:600; border:1px dashed var(--sv-line); background:#fff; border-radius:5px; padding:3px 7px; cursor:pointer; color:var(--sv-ink2); }
  .pt-addg:hover { border-color: var(--sv-ink); color: var(--sv-ink); }
  .pt-act { display:flex; flex-direction:column; gap:5px; }
  .pt-act .sv-btn, .pt-act .sv-btn-p { width:100%; justify-content:center; }
  /* Formularios */
  .pt-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px 12px; }
  .pt-grid .full { grid-column: 1 / -1; }
  .pt-f { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .pt-f > span { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--sv-ink2); }
  .pt-f input, .pt-f select, .pt-f textarea { border:1px solid var(--sv-line); border-radius:4px; padding:8px 10px; font:inherit; font-size:13px; color:var(--sv-ink); background:#fff; min-width:0; }
  .pt-f input:focus, .pt-f select:focus, .pt-f textarea:focus { outline:none; border-color: var(--sv-ink2); }
  .pt-f input.is-mono { font-family: var(--sv-mono); text-transform: uppercase; }
  .pt-f input.is-err { border-color:#b5000b; }
  .pt-f input[readonly] { background: var(--sv-s1); color: var(--sv-ink2); }
  .pt-chk { display:flex; align-items:flex-start; gap:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 12px; cursor:pointer; }
  .pt-chk input { width:18px; height:18px; flex:none; margin:1px 0 0; }
  .pt-chk b { display:block; font-size:13px; font-weight:700; color:#17388f; }
  .pt-chk span { display:block; font-size:11.5px; color:#28457f; margin-top:2px; line-height:1.4; }
  .pt-docs { display:flex; flex-wrap:wrap; gap:6px; }
  .pt-doc { display:inline-flex; align-items:center; gap:4px; background:var(--sv-s2); border-radius:4px; padding:3px 4px 3px 8px; font-family:var(--sv-mono); font-size:12px; }
  .pt-doc b { font-family: inherit; font-size:10px; color:var(--sv-ink2); }
  .pt-doc button { border:none; background:none; cursor:pointer; color:var(--sv-ink2); padding:0; display:flex; }
  .pt-doc button .material-symbols-outlined { font-size:16px; }
  .pt-docadd { display:flex; gap:6px; }
  .pt-docadd select { width:110px; }
  .pt-docadd input { flex:1; }
  .pt-match { border:1px solid #bfdbfe; background:#eff6ff; border-radius:8px; padding:10px 12px; font-size:13px; display:flex; gap:10px; align-items:flex-start; justify-content:space-between; }
  .pt-calc { font-size:12px; color:var(--sv-ink2); }
  .pt-calc b { color: var(--sv-ink); }
  .pt-kv { display:grid; grid-template-columns: 1fr auto; gap:4px 12px; font-size:12.5px; }
  .pt-kv span:nth-child(odd) { color:var(--sv-ink2); }
  .pt-kv span:nth-child(even) { font-weight:700; text-align:right; font-family:var(--sv-mono); }
  .pt-ent { display:flex; align-items:center; gap:10px; border:1px solid var(--sv-line); border-radius:8px; padding:9px 11px; cursor:pointer; margin-bottom:7px; background:#fff; }
  .pt-ent.is-on { border-color:#b5000b; background:#fdf5f5; }
  .pt-ent input { width:18px; height:18px; flex:none; }
  .pt-ent b { font-family:var(--sv-mono); font-size:14px; font-weight:700; }
  .pt-ent em { margin-left:auto; font-style:normal; font-family:var(--sv-mono); font-size:13px; font-weight:700; white-space:nowrap; }
  /* Indicadores / monitor */
  .pt-heat { border-collapse:separate; border-spacing:2px; font-size:11px; width:100%; }
  .pt-heat th { font-weight:700; color:var(--sv-ink2); padding:2px 4px; text-align:center; }
  .pt-heat th:first-child { text-align:left; white-space:nowrap; }
  .pt-heat td { text-align:center; padding:6px 0; border-radius:3px; font-family:var(--sv-mono); min-width:26px; }
  .pt-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px; }
  .pt-tile { background:#fff; border:1px solid var(--sv-line); border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .pt-tile-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .pt-big { font-size:28px; line-height:34px; font-weight:700; }
  .pt-big small { font-size:13px; font-weight:600; color:var(--sv-ink2); margin-left:4px; }
  .pt-al { display:flex; gap:13px; align-items:flex-start; padding:14px 16px; border-bottom:1px solid var(--sv-line); }
  .pt-al.is-crit { background:#fdf5f5; }
  .pt-al-i { width:36px; height:36px; border-radius:9px; flex:none; display:flex; align-items:center; justify-content:center; }
  .pt-al-b { flex:1 1 auto; min-width:0; }
  .pt-al-k { font-size:11.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .pt-al-h { font-size:15.5px; font-weight:700; margin:4px 0 0; display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  .pt-al-h b { font-family:var(--sv-mono); font-size:16px; }
  .pt-al-d { font-size:12.5px; color:var(--sv-ink); margin-top:4px; line-height:1.5; }
  .pt-al-a { display:flex; flex-direction:column; gap:6px; flex:none; width:150px; }
  .pt-al-a .pt-big { font-family:var(--sv-mono); font-size:24px; line-height:1; }
  @media (max-width: 1280px) { .pt-row { grid-template-columns:110px 170px minmax(0,1fr) 262px 104px 118px; gap:10px; } }
  @media (max-width: 1080px) { .pt-tabs { grid-template-columns:repeat(2,minmax(0,1fr)); } .pt-row { grid-template-columns:minmax(0,1fr); gap:9px; } .pt-act { flex-direction:row; } }
  @media (max-width: 640px) { .pt-grid { grid-template-columns: 1fr; } .pt-tabs { grid-template-columns:minmax(0,1fr); } }
  `;
  document.head.appendChild(st);
}

// ── Carga de datos ──────────────────────────────────────────────────────────
async function cargarMetas() {
  const [m, c] = await Promise.all([
    supabase.from('porteria_metas').select('*'),
    supabase.from('porteria_config').select('*'),
  ]);
  if (!m.error) S.metas = Object.fromEntries((m.data || []).map(x => [x.tipo, x]));
  if (!c.error) S.cfg = Object.fromEntries((c.data || []).map(x => [x.clave, Number(x.valor)]));
}
async function cargarDia() {
  const d = S.fecha;
  const abiertos = `and(fecha.gte.${addDays(d, -3)},fecha.lt.${d},estado.in.(EN_COLA,EN_PATIO,EN_RUTA))`;
  const [v, e] = await Promise.all([
    supabase.from('porteria_visitas').select(COLS).eq('centro', CENTRO).or(`fecha.eq.${d},${abiertos}`).order('created_at', { ascending: true }),
    supabase.rpc('fn_porteria_esperados', { p_fecha: d, p_centro: CENTRO }),
  ]);
  if (v.error) { showAlert('Error al leer portería: ' + v.error.message, 'error'); return false; }
  if (e.error) showAlert('No se pudieron leer los esperados del día: ' + e.error.message, 'error');
  S.visitas = v.data || [];
  S.esperados = e.data || [];
  return true;
}
async function catalogos() {
  if (!S.bloques.length) {
    const { data } = await supabase.from('abast_bloque_presentacion').select('bloque,desde,hasta,cupo').eq('activo', true).order('bloque');
    S.bloques = (data || []).map(b => ({ ...b, desde: String(b.desde).slice(0, 5), hasta: String(b.hasta).slice(0, 5) }));
  }
  if (!S.centros) {
    const { data } = await supabase.from('logistics_centres').select('id,nombre').order('nombre');
    S.centros = (data || []).filter(c => c.id !== CENTRO);
  }
  if (!S.proveedores) {
    const { data } = await supabase.from('abast_proveedores').select('nombre').eq('activo', true).order('nombre').limit(3000);
    S.proveedores = (data || []).map(p => p.nombre).filter(Boolean);
  }
}

function limpiarTimers() { clearInterval(_tick); clearInterval(_poll); _tick = _poll = null; }
function montado() { return _stage && document.body.contains(_stage) && _stage.querySelector('.pt'); }

// ── Vista principal ─────────────────────────────────────────────────────────
export async function renderPorteria(stage, sub = 'registro') {
  _stage = stage;
  css();
  limpiarTimers();
  S.sub = sub;
  stage.innerHTML = `<div class="sv-view pt"><div class="sv-desc">Cargando portería…</div></div>`;
  await cargarMetas();
  if (sub === 'indicadores') return renderIndicadores();
  if (sub === 'alertas') return renderAlertas();
  await catalogos();
  await cargarDia();
  renderRegistro();
  _tick = setInterval(() => { if (!montado()) return limpiarTimers(); actualizarTiempos(); }, 30000);
  _poll = setInterval(async () => {
    if (!montado()) return limpiarTimers();
    if (document.querySelector('.sv-dr') || document.querySelector('.sv-cf-bg') || S.busq) return;
    if (await cargarDia()) renderRegistro();
  }, 120000);
}

// ── Pestañas, KPIs y secciones ──────────────────────────────────────────────
const pendientesTab = k => S.esperados.filter(e => e.tipo === k && !e.visita_id).length;
const visitasTab = k => S.visitas.filter(v => v.tipo === k && v.estado !== 'ANULADO');

function tabsHtml() {
  return `<nav class="pt-tabs" aria-label="Tipo de visita">${TABS.map(t => {
    const n = pendientesTab(t.k) + visitasTab(t.k).length;
    return `<button type="button" class="pt-tab ${S.tab === t.k ? 'is-on' : ''}" data-tab="${t.k}" ${S.tab === t.k ? 'aria-current="page"' : ''}>
      <i><span class="material-symbols-outlined" style="font-size:21px;color:inherit">${t.icon}</span></i>
      <div style="min-width:0"><b>${esc(t.label)}</b><span>${esc(t.sub)}</span></div>
      <em>${n}</em></button>`;
  }).join('')}</nav>`;
}

function kpisTab() {
  const v = visitasTab(S.tab);
  const c = e => v.filter(x => x.estado === e).length;
  const k = (lbl, n, color, sub) => `<div class="sv-kpi" style="cursor:default"><div class="sv-kpi-l"><i style="background:${color}"></i>${lbl}</div><div class="sv-kpi-v">${n}</div><div class="sv-kpi-s">${sub}</div></div>`;
  if (S.tab === 'DESPACHO_EBEMA') {
    const dif = v.filter(x => cargaRomana(x)?.fuera).length;
    const dev = v.filter(x => arr(x.entregas_devueltas).length).length;
    return `<div class="sv-kpis">
      ${k('En ruta', c('EN_RUTA'), '#7e22ce', 'sin registrar retorno')}
      ${k('Retornos', c('FINALIZADO'), '#15803d', 'cerrados hoy')}
      ${k('Diferencia de peso', dif, '#b5000b', 'romana vs guías')}
      ${k('Entregas devueltas', dev, '#b5000b', 'vuelven al CD')}
      ${k('Sin salida', c('PROGRAMADO'), '#9a9c99', 'registrados sin partir')}
    </div>`;
  }
  const pend = pendientesTab(S.tab);
  const tarde = S.esperados.filter(e => e.tipo === S.tab && !e.visita_id && citaDe(e) && S.fecha === hoy() && new Date() > limiteCita(citaDe(e), S.fecha)).length;
  const base = `${k('En cola', c('EN_COLA'), '#ca8a04', 'sin atención')}
      ${k('En patio', c('EN_PATIO'), '#1d4ed8', 'dentro del CD')}
      ${k('Finalizados', c('FINALIZADO'), '#15803d', 'ciclo completo')}`;
  if (S.tab === 'RETIRO_CLIENTE') {
    const fin = v.filter(x => x.estado === 'FINALIZADO').map(x => minEntre(x.t_ingreso, x.t_salida)).filter(x => x != null);
    const prom = fin.length ? fin.reduce((a, b) => a + b, 0) / fin.length : null;
    return `<div class="sv-kpis">${base}${k('Permanencia promedio', fmtMin(prom), '#9a9c99', 'ingreso → salida')}</div>`;
  }
  return `<div class="sv-kpis">${base}
      ${k('Por llegar', pend, '#9a9c99', S.tab === 'TRONCAL' ? 'del Plan de Carga' : 'de la agenda del día')}
      ${k('Fuera de horario', tarde, '#b5000b', 'no llegaron en su bloque')}
    </div>`;
}

function grupos() {
  const bl = S.bloques.map(b => ({ k: 'b' + b.bloque, t: `Bloque ${b.bloque} · ${b.desde}–${b.hasta}`, meta: `cupo ${b.cupo}` }));
  if (S.tab === 'TRONCAL') return [...bl, { k: 'libre', t: 'Hora libre · ramplas a cliente', meta: 'sin tope de bloque' }, { k: 'sin', t: 'Sin horario solicitado' }];
  if (S.tab === 'PROVEEDOR') return [...bl, { k: 'libre', t: 'Con hora de agenda' }, { k: 'sin', t: 'Sin agenda', off: true }];
  if (S.tab === 'RETIRO_CLIENTE') return [{ k: 'all', t: 'Retiros de cliente de hoy', meta: 'presentación → ingreso → salida' }];
  return [{ k: 'ruta', t: 'En ruta · pendientes de retorno' }, { k: 'retorno', t: 'Retornos registrados hoy' }, { k: 'otros', t: 'Registrados sin salida' }];
}
function grupoDe(x) {
  if (S.tab === 'RETIRO_CLIENTE') return 'all';
  if (S.tab === 'DESPACHO_EBEMA') return x.estado === 'EN_RUTA' ? 'ruta' : (x.t_regreso ? 'retorno' : 'otros');
  if (esRampla(x)) return 'libre';
  const c = citaDe(x);
  if (c && c.bloque) return 'b' + c.bloque;
  if (c) return 'libre';
  return 'sin';
}

// ── Celdas ──────────────────────────────────────────────────────────────────
function celdaCamion(x) {
  return `<div><div class="pt-plate">${esc(x.patente || '— sin patente')}</div>
    <div class="pt-sub">${x.patente_carro ? 'Carro ' + esc(x.patente_carro) + '<br>' : ''}${esc(x.chofer_nombre || '')}${x.transportista ? '<br>' + esc(x.transportista) : ''}</div></div>`;
}
function celdaContra(x) {
  const tags = [];
  if (esRampla(x)) tags.push('<span class="pt-tag" style="background:#e6f0e9;border-color:#c7e0d1;color:#14603a;font-family:inherit">RAMPLA</span>');
  if (x.fuera_agenda) tags.push('<span class="pt-tag" style="background:#fdf6e6;border-color:#f0dcb0;color:#7a4f00;font-family:inherit">SIN AGENDA</span>');
  if (x.pedido_venta) tags.push(`<span class="pt-tag">NV ${esc(x.pedido_venta)}</span>`);
  arr(x.documentos).slice(0, 3).forEach(d => tags.push(`<span class="pt-tag">${esc(d.tipo)} ${esc(d.numero)}</span>`));
  arr(x.retiros).forEach(r => tags.push(`<span class="pt-tag">OC ${esc(r.doc_compr)}</span>`));
  const pr = x.plan_ref || {};
  const det = S.tab === 'TRONCAL' && !esRampla(x) && pr.camion != null ? `Camión ${esc(pr.camion)} · ${nf(pr.ton, 1)} t · ${nf(pr.pct)}%`
    : esRampla(x) ? `${nf(pr.ton, 1)} t · carga de material a cliente`
    : S.tab === 'DESPACHO_EBEMA' ? `${arr(x.documentos).length} entrega(s)${x.subtipo === 'FIERRO' ? ' · Fierro' : ''}`
    : pr.tipo ? esc(pr.tipo) : '';
  const retira = x.retira_nombre ? `<div class="pt-sub">Retira <b>${esc(x.retira_nombre)}</b>${x.retira_rut ? ' · ' + esc(x.retira_rut) : ''}${x.retira_es_chofer ? ' · es el chofer' : ''}</div>` : '';
  return `<div style="min-width:0"><div class="pt-dest">${esc(x.contraparte || '—')}</div>
    ${det ? `<div class="pt-sub">${det}</div>` : ''}${retira}
    ${tags.length ? `<div class="pt-tags">${tags.join('')}</div>` : ''}</div>`;
}
function celdaEstadoEsp(e) {
  const c = citaDe(e);
  const tarde = c && S.fecha === hoy() && new Date() > limiteCita(c, S.fecha);
  return `<div><div class="pt-st" style="color:${tarde ? '#b5000b' : 'var(--sv-ink2)'}"><i style="background:${tarde ? '#b5000b' : '#9a9c99'}"></i>${tarde ? 'No llegó' : 'Programado'}</div>
    <div class="pt-sub pt-mono">${c ? esc(c.txt) : 'sin horario'}</div></div>`;
}
function celdaEstadoVis(v) {
  const col = { EN_COLA: '#ca8a04', EN_PATIO: '#1d4ed8', EN_RUTA: '#7e22ce', FINALIZADO: '#15803d', PROGRAMADO: '#9a9c99', NO_SE_PRESENTA: '#b5000b', NO_CARGA: '#c2410c', ANULADO: '#9a9c99' }[v.estado] || '#9a9c99';
  const k = cumpleCita(v);
  return `<div><div class="pt-st"><i style="background:${col}"></i>${(ESTADOS[v.estado] || [v.estado])[0]}</div>
    ${k ? `<div class="pt-sub" style="color:${k.cls === 'bad' ? '#b5000b' : k.cls === 'ok' ? '#15803d' : 'inherit'}">${esc(k.txt)}</div>` : v.fuera_agenda ? '<div class="pt-sub">llegada sin cita</div>' : ''}</div>`;
}
function hitoBox(v, h, cls) {
  const t = v['t_' + h];
  const peso = h === 'ingreso' ? v.tara_kg : h === 'salida' ? (v.tipo === 'DESPACHO_EBEMA' ? v.bruto_kg : v.bruto_kg) : h === 'regreso' ? v.bruto_ingreso_kg : null;
  const lbl = v.tipo === 'DESPACHO_EBEMA' && h === 'salida' ? 'Salida' : HITO_LBL[h];
  return `<div class="pt-h ${cls}"><b>${lbl}</b><u class="${t ? '' : 'na'}">${t ? hhmm(t) : '—'}</u>
    ${peso != null ? `<s>${nf(peso)} kg</s>` : cls === 'next' && (h === 'ingreso' || h === 'regreso') ? '<s>pesar</s>' : ''}</div>`;
}
function celdaStep(v) {
  const hitos = TIPOS[v.tipo].hitos;
  const nx = proximoHito(v);
  return `<div class="pt-step ${hitos.length === 2 ? 'is-2' : ''}">${hitos.map(h => hitoBox(v, h, v['t_' + h] ? 'done' : h === nx ? 'next' : '')).join('')}</div>`;
}
function celdaStepEsp(e) {
  const hitos = TIPOS[e.tipo].hitos;
  return `<div class="pt-step ${hitos.length === 2 ? 'is-2' : ''}">${hitos.map((h, i) => `<div class="pt-h ${i === 0 ? 'next' : ''}"><b>${HITO_LBL[h]}</b><u class="na">—</u></div>`).join('')}</div>`;
}
function celdaTiempo(v) {
  const t = tiempo(v);
  if (t.min == null) return '<div><div class="pt-tm pt-na">—</div><div class="pt-tml">sin medición</div></div>';
  const sem = semaforo(t);
  const col = { ok: '#15803d', warn: '#8a5a00', bad: '#b5000b', mute: 'var(--sv-ink2)' }[sem];
  const pct = t.umbral ? Math.min(100, Math.round(t.min / t.umbral * 100)) : 0;
  return `<div data-timer="${v.id}"><div class="pt-tm ${t.vivo ? 'pt-live' : ''}" style="color:${col}">${fmtMin(t.min)}</div>
    <div class="pt-tml">${esc(t.que)}${t.umbral ? ` · meta ${t.umbral}` : ''}</div>
    ${t.umbral ? `<div class="pt-bar"><i style="width:${pct}%;background:${col}"></i></div>` : ''}</div>`;
}
function celdaPesosDesp(v) {
  const c = cargaRomana(v);
  const vk = vuelveKg(v);
  const col = c?.fuera ? '#b5000b' : '#15803d';
  return `<div class="pt-sub" style="margin:0">
    ${v.tara_kg != null ? `Tara ${nf(v.tara_kg)} · ` : ''}${v.bruto_kg != null ? `Bruto ${nf(v.bruto_kg)}` : 'sin pesaje'}
    ${c ? `<div>Carga romana <b>${nf(c.carga)} kg</b> · guías ${nf(c.guias)} kg</div>
      <div style="color:${col};font-weight:700">${c.pct != null ? (c.pct > 0 ? '+' : '') + nf(c.carga - c.guias) + ' kg · ' + (c.pct > 0 ? '+' : '') + nf(c.pct, 1) + '%' : 'sin guías'}${c.fuera ? ' fuera de tolerancia' : ''}</div>` : ''}
    ${vk != null ? `<div>Vuelve con <b>${nf(vk)} kg</b>${arr(v.entregas_devueltas).length ? ' · ' + arr(v.entregas_devueltas).map(d => 'ENT ' + esc(d.n_entrega)).join(', ') : ''}</div>` : ''}</div>`;
}

// ── Render de la pestaña ────────────────────────────────────────────────────
function ctaTab() {
  if (S.tab === 'RETIRO_CLIENTE') return `<div class="pt-cta">
    <div><h2>Se presentó un cliente a retirar</h2>
      <p>Obligatorio: N° de pedido de ventas, nombre y RUT de quien retira, patente del vehículo y transportista. La patente del carro es opcional y, si quien retira es el mismo chofer, se copian nombre y RUT.</p></div>
    <button class="sv-btn" id="pt-retiro" style="background:#fff;color:var(--sv-ink)"><span class="material-symbols-outlined">add</span>Registrar retiro de cliente</button></div>`;
  if (S.tab === 'DESPACHO_EBEMA') return `<div class="pt-cta">
    <div><h2>Salida de un despacho a cliente</h2>
      <p>Se registra patente, hora de salida, las entregas cargadas y los pesos (tara, bruto de salida y peso de las guías) para calcular la diferencia. Al volver se piden hora y peso de ingreso y qué entregas regresan.</p></div>
    <button class="sv-btn" id="pt-salida" style="background:#fff;color:var(--sv-ink)"><span class="material-symbols-outlined">outbound</span>Registrar salida</button></div>`;
  return '';
}

function bandRetiro(x) {
  if (x.tipo !== 'TRONCAL' || !arr(x.retiros).length) return '';
  const g = arr(x.guias_proveedor);
  return `<div class="pt-band"><span class="material-symbols-outlined" style="font-size:18px">merge</span>
    <b>Viene con retiro de fábrica</b> · ${arr(x.retiros).map(r => esc(r.proveedor || '') + ' · OC ' + esc(r.doc_compr)).join(' · ')} · misma patente y chofer, una sola línea
    ${g.map(y => `<span class="pt-tag">GUÍA ${esc(y.numero)}</span>`).join('') || '<span class="pt-tag miss">Sin guías del proveedor</span>'}
    ${x.id ? `<button class="sv-btn" data-guia="${x.id}" style="min-height:0;padding:4px 10px">Agregar guía</button>` : '<span class="pt-sub" style="margin:0">Las guías se piden al registrar la llegada.</span>'}</div>`;
}

function filaEsperado(e) {
  const i = S.esperados.indexOf(e);
  return `<div class="pt-row">
    ${celdaEstadoEsp(e)}${celdaCamion(e)}${celdaContra(e)}${celdaStepEsp(e)}
    <div><div class="pt-tm pt-na">—</div><div class="pt-tml">sin presentación</div></div>
    <div class="pt-act"><button class="sv-btn-p" data-esp="${i}" ${S.fecha === hoy() ? '' : 'disabled title="Sólo se registra la llegada del día de hoy"'}>Llegó</button></div>
  </div>${bandRetiro(e)}`;
}

function filaVisita(v) {
  const nx = proximoHito(v);
  const desp = v.tipo === 'DESPACHO_EBEMA';
  const btn = nx === 'regreso' ? `<button class="sv-btn-p" data-ret="${v.id}">Registrar retorno</button>`
    : nx ? `<button class="sv-btn-p" data-hito="${nx}" data-vid="${v.id}">${HITO_BTN[nx]}</button>` : '';
  return `<div class="pt-row" data-id="${v.id}">
    ${celdaEstadoVis(v)}${celdaCamion(v)}
    <div style="min-width:0">${celdaContra(v)}${desp ? celdaPesosDesp(v) : ''}</div>
    ${celdaStep(v)}${celdaTiempo(v)}
    <div class="pt-act">${btn}<button class="sv-btn is-icon" data-edit="${v.id}" title="Editar / corregir"><span class="material-symbols-outlined">edit</span></button></div>
  </div>${bandRetiro(v)}`;
}

function cuerpoTab() {
  const T = TABS.find(t => t.k === S.tab);
  const esps = S.esperados.filter(e => e.tipo === S.tab && !e.visita_id);
  const vis = visitasTab(S.tab);
  let html = `<div class="pt-ch"><h2><span class="material-symbols-outlined">${T.icon}</span>${esc(T.label)}
      <small>${fechaCorta(S.fecha)} · ${esps.length} por llegar · ${vis.length} registrado(s)</small></h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${S.tab === 'PROVEEDOR' ? '<button class="sv-btn" id="pt-agenda"><span class="material-symbols-outlined">event_available</span>Agregar cita de proveedor</button>' : ''}
      <button class="sv-btn" id="pt-csv"><span class="material-symbols-outlined">download</span>CSV del día</button></div></div>`;
  const items = [...esps.map(e => ({ e, cita: citaDe(e) })), ...vis.map(v => ({ v, cita: citaDe(v) }))];
  let n = 0;
  grupos().forEach(g => {
    const rows = items.filter(it => grupoDe(it.e || it.v) === g.k)
      .sort((a, b) => (hmMin(a.cita && a.cita.desde) ?? 9999) - (hmMin(b.cita && b.cita.desde) ?? 9999));
    const fijo = /^b\d+$/.test(g.k) && ['TRONCAL', 'PROVEEDOR'].includes(S.tab);
    if (!rows.length && !fijo) return;
    n += rows.length;
    html += `<div class="pt-sect ${g.off ? 'is-off' : ''}">${esc(g.t)}<span>${rows.length ? rows.length + ' camión(es)' : 'sin camiones'}${g.meta ? ' · ' + esc(g.meta) : ''}</span></div>`;
    html += rows.map(it => (it.e ? filaEsperado(it.e) : filaVisita(it.v))).join('');
  });
  if (!n) html += `<div class="sv-empty" style="padding:28px 16px;text-align:center">Sin camiones de este tipo para ${fechaCorta(S.fecha)}.</div>`;
  return html;
}

function renderRegistro() {
  if (!_stage) return;
  if (S.sub === 'alertas') return renderAlertas();
  if (S.sub === 'indicadores') return renderIndicadores();
  const esHoy = S.fecha === hoy();
  _stage.innerHTML = `<div class="sv-view pt">
    <div class="sv-vhead">
      <div>
        <h1 class="sv-h1">Control puerta · CD Quilicura</h1>
        <div class="sv-desc">Busca la patente o elige el tipo de visita. La hora de cada hito la pone el servidor y el ingreso al patio exige el peso de romana.</div>
      </div>
      <div class="sv-actions">
        <label class="pt-srch"><span class="material-symbols-outlined">search</span>
          <input id="pt-q" value="${esc(S.q)}" placeholder="Patente, NV, OC o guía" autocomplete="off" aria-label="Buscar patente, pedido de venta, orden de compra o guía"></label>
        <label class="sv-inp"><span class="material-symbols-outlined">event</span><input type="date" id="pt-fecha" value="${S.fecha}"></label>
        ${esHoy ? '' : '<button class="sv-btn" id="pt-hoy">Hoy</button>'}
        <button class="sv-btn is-icon" id="pt-ref" title="Actualizar"><span class="material-symbols-outlined">refresh</span></button>
        <button class="sv-btn-p" id="pt-nuevo"><span class="material-symbols-outlined">add</span>Llegada sin agenda</button>
      </div>
    </div>
    ${tabsHtml()}
    <div id="pt-busq">${S.busq ? panelBusqueda() : ''}</div>
    ${kpisTab()}
    ${ctaTab()}
    <div class="sv-card">${cuerpoTab()}</div>
  </div>`;
  bindRegistro();
}

function bindRegistro() {
  const $ = s => _stage.querySelector(s);
  $('#pt-fecha').addEventListener('change', async e => { S.fecha = e.target.value || hoy(); await cargarDia(); renderRegistro(); });
  $('#pt-hoy')?.addEventListener('click', async () => { S.fecha = hoy(); await cargarDia(); renderRegistro(); });
  $('#pt-ref').addEventListener('click', async () => { await cargarDia(); renderRegistro(); });
  $('#pt-nuevo').addEventListener('click', () => abrirForm(null));
  $('#pt-retiro')?.addEventListener('click', () => formRetiroCliente(null));
  $('#pt-salida')?.addEventListener('click', () => abrirForm(null, 'DESPACHO_EBEMA'));
  $('#pt-agenda')?.addEventListener('click', () => formAgendaProveedor());
  $('#pt-csv')?.addEventListener('click', csvDia);
  _stage.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderRegistro(); }));
  const q = $('#pt-q');
  let tk;
  q.addEventListener('input', () => { clearTimeout(tk); tk = setTimeout(() => buscar(q.value), 350); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(tk); buscar(q.value); } });
  _stage.querySelectorAll('[data-esp]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); llegoEsperado(S.esperados[+b.dataset.esp]); }));
  _stage.querySelectorAll('[data-hito]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); marcarHito(+b.dataset.vid, b.dataset.hito); }));
  _stage.querySelectorAll('[data-ret]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); formRetorno(S.visitas.find(v => v.id === +b.dataset.ret)); }));
  _stage.querySelectorAll('[data-guia]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); agregarGuia(S.visitas.find(v => v.id === +b.dataset.guia)); }));
  _stage.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); abrirForm(S.visitas.find(v => v.id === +b.dataset.edit)); }));
  _stage.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); abrirForm(S.visitas.find(v => v.id === +b.dataset.ver)); }));
  _stage.querySelector('#pt-bcerrar')?.addEventListener('click', () => { S.busq = null; S.q = ''; renderRegistro(); });
}

function actualizarTiempos() {
  _stage.querySelectorAll('[data-timer]').forEach(el => {
    const v = S.visitas.find(x => x.id === +el.dataset.timer);
    if (v && tiempo(v).vivo) el.outerHTML = celdaTiempo(v);
  });
}

// ── Acciones ────────────────────────────────────────────────────────────────
function reemplazar(v) {
  const i = S.visitas.findIndex(x => x.id === v.id);
  if (i >= 0) S.visitas[i] = v; else S.visitas.push(v);
}

// Pesaje obligatorio al ingresar; el peso de salida se pide (opcional) al salir.
async function marcarHito(id, hito) {
  const v = S.visitas.find(x => x.id === id); if (!v) return;
  const desp = v.tipo === 'DESPACHO_EBEMA';
  const patch = {};
  if (hito === 'ingreso' && !desp && v.tara_kg == null) {
    const r = await pedirDato(`Ingreso · ${v.patente || ''}\n\nPeso de entrada en romana (kg). Todo camión que ingresa se pesa.`,
      { aceptar: 'Registrar ingreso', placeholder: 'Ej: 15.420', icono: 'scale', patron: /^[\d.,\s]+$/, error: 'Ingrese el peso en kg' });
    if (r === null) return;
    const n = num(r);
    if (n == null) return showAlert('El ingreso necesita el peso de romana.', 'error');
    patch.tara_kg = n;
  }
  if (hito === 'salida' && v.bruto_kg == null) {
    const lbl = desp ? 'Peso de salida con carga (bruto)' : 'Peso de salida (bruto)';
    const r = await pedirDato(`Salida · ${v.patente || ''}\n\n${lbl} en romana (kg).${desp ? '' : ' Puede quedar vacío y completarse después.'}`,
      { aceptar: 'Registrar salida', placeholder: 'Ej: 27.980', opcional: !desp, icono: 'scale', patron: /^[\d.,\s]+$/, error: 'Ingrese sólo números (kg)' });
    if (r === null) return;
    const n = num(r);
    if (n == null && desp) return showAlert('La salida del despacho necesita el peso de romana.', 'error');
    if (n != null) patch.bruto_kg = n;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('porteria_visitas').update(patch).eq('id', id);
    if (error) return showAlert(errMsg(error), 'error');
    Object.assign(v, patch);
  }
  const { data, error } = await supabase.rpc('fn_porteria_marcar', { p_id: id, p_hito: hito });
  if (error) return showAlert(errMsg(error), 'error');
  reemplazar({ ...v, ...patch, ...data });
  showAlert(`${HITO_LBL[hito]} registrada ${hhmm(data['t_' + hito])} · ${data.patente || ''}`);
  renderRegistro();
}

function payloadDesdeEsperado(e) {
  const docs = [];
  const ya = new Set();
  const addDoc = (tipo, n) => { const k = tipo + '|' + n; if (n && !ya.has(k)) { ya.add(k); docs.push({ tipo, numero: String(n) }); } };
  arr(e.retiros).forEach(r => { addDoc('OC', r.doc_compr); addDoc('ENTREGA', r.entrega_entrante); });
  arr(e.plan_ref && e.plan_ref.docs).forEach(d => { addDoc('NV', d.pedido_venta); addDoc('ENTREGA', d.n_entrega); });
  return {
    tipo: e.tipo, subtipo: e.subtipo || null, hora_agenda: e.hora_agenda || null,
    patente: e.patente, patente_carro: e.patente_carro, chofer_nombre: e.chofer_nombre, chofer_rut: e.chofer_rut,
    chofer_telefono: e.chofer_telefono, id_transporte: e.id_transporte, transportista: e.transportista,
    contraparte: e.contraparte, ce: e.ce, documentos: docs, clave_esperado: e.clave,
    plan_ref: { ...(e.plan_ref || {}), bloque: e.bloque ?? null, hora_presentacion: e.hora_presentacion || null, hora_hasta: e.hora_hasta || null },
    retiros: arr(e.retiros), consolida_retiro: !!e.consolida_retiro,
    patente_coordinada: e.patente || null, chofer_coordinado: e.chofer_nombre || null,
    origen: e.tipo === 'TRONCAL' ? (e.consolida_retiro ? 'PLAN_CARGA+RETIRO' : 'PLAN_CARGA') : 'RETIRO_FABRICA',
  };
}

// Troncales y ramplas: la llegada abre la confirmación de datos; el resto se registra directo.
async function llegoEsperado(e) {
  if (!e) return;
  if (e.tipo === 'TRONCAL') return formLlegadaTroncal(e);
  const p = payloadDesdeEsperado(e);
  if (!p.patente) {
    const pat = await pedirDato(`Llegada · ${e.contraparte || ''}\n\nNo hay patente coordinada. Ingrese la patente del camión que llegó.`,
      { aceptar: 'Registrar llegada', placeholder: 'AA-BB-12', icono: 'local_shipping' });
    if (pat === null) return;
    p.patente = fmtPatente(pat);
    p.patente_coordinada = null;
  }
  const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: 'presentacion' });
  if (error) return showAlert(errMsg(error), 'error');
  S.visitas.push(data);
  e.visita_id = data.id;
  showAlert(`Llegada registrada ${hhmm(data.t_presentacion)} · ${data.patente || ''}`);
  renderRegistro();
}

async function csvDia() { const d = S.desde, h = S.hasta; S.desde = S.fecha; S.hasta = S.fecha; await descargarCSV(); S.desde = d; S.hasta = h; }

// ── Panel lateral reutilizable ──────────────────────────────────────────────
function drawer(aria) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="${esc(aria)}"></aside>`;
  document.body.appendChild(wrap);
  const dr = wrap.querySelector('.sv-dr');
  const onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.sv-cf-bg')) { ev.preventDefault(); cerrar(); } };
  const cerrar = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sv-dr-bg').addEventListener('click', cerrar);
  return { dr, cerrar };
}
const campo = (lbl, id, val, extra = '', cls = '') => `<label class="pt-f ${cls}"><span>${lbl}</span><input id="${id}" value="${esc(val ?? '')}" ${extra}></label>`;

// ── Llegada de troncal / rampla: confirmación de datos ──────────────────────
async function formLlegadaTroncal(e) {
  const { dr, cerrar } = drawer('Confirmar llegada de troncal');
  const c = citaDe(e);
  const g = [];
  const tieneRetiro = arr(e.retiros).length > 0;
  const draw = () => {
    dr.innerHTML = `
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">${esRampla(e) ? 'Rampla a cliente · confirmar datos' : 'Llegada de troncal · confirmar datos'}</div>
        <div class="sv-dr-t">${esc(e.contraparte || '')}</div>
        <div class="sv-dr-s">${c ? `Citación ${esc(c.txt)}${c.bloque ? ' · bloque ' + c.bloque : ''}` : 'Sin horario solicitado'}${e.plan_ref?.camion != null ? ` · camión ${esc(e.plan_ref.camion)} · ${nf(e.plan_ref.ton, 1)} t` : ''}</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div class="pt-match"><div><div class="pt-sub" style="margin:0">Patente coordinada</div>
          <div style="font-family:var(--sv-mono);font-size:26px;font-weight:700">${esc(e.patente || '— sin patente —')}</div>
          ${e.chofer_nombre ? `<div class="pt-sub">Chofer coordinado: ${esc(e.chofer_nombre)}</div>` : ''}</div>
          <button type="button" class="sv-btn" id="f-ok">Coincide todo</button></div>
        ${tieneRetiro ? `<div class="pt-band" style="border:1px solid #f0dcb0;border-radius:8px;padding:10px 12px">
          <span class="material-symbols-outlined" style="font-size:18px">merge</span>
          <div style="flex:1;min-width:0"><b>Viene con retiro de fábrica</b> · ${arr(e.retiros).map(r => esc(r.proveedor || '') + ' · OC ' + esc(r.doc_compr)).join(' · ')}
            <div class="pt-sub" style="color:#5a3b00">Mismo camión planificado para retirar y consolidar en el CD: queda como una sola línea. Registre las guías del proveedor.</div></div></div>
          <div>
            <div class="sv-dr-sect">Guías del proveedor</div>
            <div class="pt-docs" id="f-gl">${g.length ? g.map((x, i) => `<span class="pt-doc"><b>GUÍA</b>${esc(x.numero)}<button type="button" data-delg="${i}"><span class="material-symbols-outlined">close</span></button></span>`).join('') : '<span class="pt-sub">Sin guías registradas aún.</span>'}</div>
            <div class="pt-docadd" style="margin-top:8px"><input id="f-gnum" class="pt-mono" placeholder="N° de guía (varias separadas por coma)" autocomplete="off"><button type="button" class="sv-btn" id="f-gadd">Agregar</button></div>
          </div>` : ''}
        <div>
          <div class="sv-dr-sect">Datos del camión que llegó</div>
          <div class="pt-grid">
            ${campo('Patente camión *', 'f-pat', e.patente, 'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${campo('Patente carro', 'f-car', e.patente_carro, 'class="is-mono" autocomplete="off"')}
            ${campo('Nombre del chofer', 'f-cho', e.chofer_nombre, 'autocomplete="off"', 'full')}
            ${campo('RUT chofer', 'f-rut', e.chofer_rut, 'autocomplete="off"')}
            ${campo('Teléfono', 'f-tel', e.chofer_telefono, 'autocomplete="off"')}
            ${campo('Transportista', 'f-tra', e.transportista, 'readonly', 'full')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Romana (opcional ahora)</div>
          <div class="pt-grid">
            ${campo('Peso de entrada (kg)', 'f-tara', '', 'inputmode="decimal" class="pt-mono" placeholder="se exige al ingresar"')}
            ${campo('Peso según guías (kg)', 'f-guias', '', 'inputmode="decimal" class="pt-mono"')}
          </div>
          <div class="pt-sub" style="margin-top:6px">El peso de entrada es obligatorio para marcar el ingreso al patio; el de salida se pide al salir.</div>
        </div>
      </div>
      <div class="sv-dr-f"><div></div><div style="display:flex;gap:6px">
        <button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar llegada</button></div></div>`;
    dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
    dr.querySelector('#f-ok')?.addEventListener('click', () => dr.querySelector('#f-save').click());
    const addG = () => {
      const nums = (dr.querySelector('#f-gnum')?.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      if (!nums.length) return;
      nums.forEach(n => { if (!g.some(x => x.numero === n)) g.push({ numero: n, proveedor: arr(e.retiros)[0]?.proveedor || null, doc_compr: arr(e.retiros)[0]?.doc_compr || null }); });
      draw();
      dr.querySelector('#f-gnum')?.focus();
    };
    dr.querySelector('#f-gadd')?.addEventListener('click', addG);
    dr.querySelector('#f-gnum')?.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addG(); } });
    dr.querySelectorAll('[data-delg]').forEach(b => b.addEventListener('click', () => { g.splice(+b.dataset.delg, 1); draw(); }));
    dr.querySelector('#f-save').addEventListener('click', guardar);
  };
  const v = id => dr.querySelector('#' + id)?.value?.trim() ?? '';
  async function guardar() {
    const pat = fmtPatente(v('f-pat'));
    if (!pat) return showAlert('Ingrese la patente del camión que llegó', 'error');
    if (!patenteValida(pat) && !(await confirmar(`¿Continuar con la patente ${pat}?\n\nNo tiene el formato AA-BB-12 / AA-12-34.`, { aceptar: 'Continuar' }))) return;
    const btn = dr.querySelector('#f-save'); btn.disabled = true;
    const p = payloadDesdeEsperado(e);
    p.patente = pat;
    p.patente_carro = v('f-car') ? fmtPatente(v('f-car')) : null;
    p.chofer_nombre = v('f-cho') || null;
    p.chofer_rut = v('f-rut') || null;
    p.chofer_telefono = v('f-tel') || null;
    p.guias_proveedor = g;
    p.tara_kg = num(v('f-tara'));
    p.peso_guias_kg = num(v('f-guias'));
    p.datos_confirmados_at = new Date().toISOString();
    const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: 'presentacion' });
    btn.disabled = false;
    if (error) return showAlert(errMsg(error), 'error');
    S.visitas.push(data);
    e.visita_id = data.id;
    cerrar();
    showAlert(`Llegada registrada ${hhmm(data.t_presentacion)} · ${data.patente}`);
    renderRegistro();
  }
  draw();
  dr.querySelector('#f-pat')?.focus();
}

// ── Cliente retira (no se programa) ─────────────────────────────────────────
async function formRetiroCliente() {
  await catalogos();
  const { dr, cerrar } = drawer('Registrar cliente que retira');
  let mismo = true;
  const draw = () => {
    dr.innerHTML = `
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">Cliente retira · sin agenda</div>
        <div class="sv-dr-t">Registrar quien viene a retirar</div>
        <div class="sv-dr-s">Los campos con * son obligatorios para abrir el reloj.</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Pedido</div>
          <div class="pt-grid">
            ${campo('N° pedido de ventas *', 'f-nv', '', 'inputmode="numeric" class="pt-mono" autocomplete="off"')}
            ${campo('Cliente *', 'f-cli', '', 'autocomplete="off"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Quien retira</div>
          <div class="pt-grid">
            ${campo('Nombre completo *', 'f-rnom', '', 'autocomplete="off"', 'full')}
            ${campo('RUT *', 'f-rrut', '', 'autocomplete="off" class="pt-mono"')}
            ${campo('Teléfono', 'f-rtel', '', 'autocomplete="off" class="pt-mono"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Vehículo</div>
          <div class="pt-grid">
            ${campo('Patente vehículo *', 'f-pat', '', 'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${campo('Patente carro', 'f-car', '', 'class="is-mono" autocomplete="off" placeholder="opcional"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Transportista y chofer</div>
          <label class="pt-f"><span>Transportista *</span>
            <input id="f-tra" list="pt-tra" value="Particular del cliente" autocomplete="off">
            <datalist id="pt-tra"><option value="Particular del cliente"></option>${(S.proveedores || []).slice(0, 0).map(x => '').join('')}</datalist></label>
          <label class="pt-chk" for="f-mismo" style="margin-top:10px">
            <input type="checkbox" id="f-mismo" ${mismo ? 'checked' : ''}>
            <span><b>Quien retira es el mismo chofer</b><span>Copia el nombre y el RUT de arriba a los datos del chofer; si lo desmarcas, se piden por separado.</span></span></label>
          <div class="pt-grid" style="margin-top:10px">
            ${campo('Nombre del chofer', 'f-cho', '', mismo ? 'readonly' : 'autocomplete="off"', 'full')}
            ${campo('RUT del chofer', 'f-crut', '', mismo ? 'readonly' : 'autocomplete="off" class="pt-mono"')}
            ${campo('Guía de despacho', 'f-guia', '', 'class="pt-mono" autocomplete="off" placeholder="se agrega a la salida"')}
          </div>
        </div>
      </div>
      <div class="sv-dr-f"><div class="pt-sub">La hora de presentación la pone el servidor al confirmar.</div>
        <div style="display:flex;gap:6px"><button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar presentación</button></div></div>`;
    dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
    dr.querySelector('#f-mismo').addEventListener('change', ev => {
      mismo = ev.target.checked;
      const nom = dr.querySelector('#f-rnom').value, rut = dr.querySelector('#f-rrut').value;
      const cho = dr.querySelector('#f-cho'), crut = dr.querySelector('#f-crut');
      cho.readOnly = crut.readOnly = mismo;
      if (mismo) { cho.value = nom; crut.value = rut; }
    });
    const sync = () => { if (!mismo) return; dr.querySelector('#f-cho').value = dr.querySelector('#f-rnom').value; dr.querySelector('#f-crut').value = dr.querySelector('#f-rrut').value; };
    dr.querySelector('#f-rnom').addEventListener('input', sync);
    dr.querySelector('#f-rrut').addEventListener('input', sync);
    dr.querySelector('#f-save').addEventListener('click', guardar);
  };
  const v = id => dr.querySelector('#' + id)?.value?.trim() ?? '';
  async function guardar() {
    const falta = [];
    if (!v('f-nv')) falta.push('N° de pedido de ventas');
    if (!v('f-cli')) falta.push('cliente');
    if (!v('f-rnom')) falta.push('nombre de quien retira');
    if (!v('f-rrut')) falta.push('RUT de quien retira');
    if (!v('f-pat')) falta.push('patente del vehículo');
    if (!v('f-tra')) falta.push('transportista');
    if (falta.length) return showAlert('Falta ' + falta.join(', ') + '.', 'error');
    const pat = fmtPatente(v('f-pat'));
    if (!patenteValida(pat) && !(await confirmar(`¿Continuar con la patente ${pat}?`, { aceptar: 'Continuar' }))) return;
    const btn = dr.querySelector('#f-save'); btn.disabled = true;
    const docs = [{ tipo: 'NV', numero: v('f-nv') }];
    if (v('f-guia')) docs.push({ tipo: 'GUIA', numero: v('f-guia') });
    const p = {
      tipo: 'RETIRO_CLIENTE', fecha: S.fecha, patente: pat, patente_carro: v('f-car') ? fmtPatente(v('f-car')) : null,
      chofer_nombre: (mismo ? v('f-rnom') : v('f-cho')) || null, chofer_rut: (mismo ? v('f-rrut') : v('f-crut')) || null,
      transportista: v('f-tra'), contraparte: v('f-cli'), documentos: docs, pedido_venta: v('f-nv'),
      retira_nombre: v('f-rnom'), retira_rut: v('f-rrut'), retira_telefono: v('f-rtel') || null, retira_es_chofer: mismo,
      fuera_agenda: true, origen: 'MANUAL',
    };
    const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: 'presentacion' });
    btn.disabled = false;
    if (error) return showAlert(errMsg(error), 'error');
    S.visitas.push(data);
    cerrar();
    showAlert(`Retiro registrado ${hhmm(data.t_presentacion)} · ${data.patente}`);
    S.tab = 'RETIRO_CLIENTE';
    renderRegistro();
  }
  draw();
  dr.querySelector('#f-nv')?.focus();
}

// ── Retorno de un despacho: peso de ingreso y entregas que vuelven ──────────
async function formRetorno(v0) {
  if (!v0) return;
  const { dr, cerrar } = drawer('Registrar retorno de despacho');
  const ents = arr(v0.documentos).filter(d => d.tipo === 'ENTREGA');
  const sel = new Set();
  let conCarga = true;
  const draw = () => {
    const bi = num(dr.querySelector('#f-bi')?.value) ?? null;
    const carga = cargaRomana(v0);
    const vuelve = bi != null && v0.tara_kg != null ? bi - v0.tara_kg : null;
    const kgSel = [...sel].reduce((a, k) => a + (num(dr.querySelector(`#f-kg-${k}`)?.value) ?? 0), 0);
    dr.innerHTML = `
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
        <div class="sv-dr-k">Despacho a cliente · retorno</div>
        <div class="sv-dr-t" style="font-family:var(--sv-mono)">${esc(v0.patente || '')}</div>
        <div class="sv-dr-s">${esc(v0.chofer_nombre || '')} · salió ${hhmm(v0.t_salida)} con ${ents.length} entrega(s)</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Ingreso y romana</div>
          <div class="pt-grid">
            ${campo('Peso de ingreso, bruto (kg) *', 'f-bi', bi ?? '', 'inputmode="decimal" class="pt-mono"')}
            <div class="pt-f"><span>Cálculo</span><div class="pt-calc" style="padding:8px 0">
              ${v0.tara_kg != null ? `Tara <b>${nf(v0.tara_kg)} kg</b><br>` : 'Sin tara registrada<br>'}
              ${carga ? `Carga que salió <b>${nf(carga.carga)} kg</b> · guías ${nf(carga.guias)} kg<br>` : ''}
              ${vuelve != null ? `Vuelve con <b style="color:${vuelve > 50 ? '#b5000b' : '#15803d'}">${nf(vuelve)} kg</b>` : 'Ingrese el peso de ingreso'}</div></div>
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">¿Vuelve con alguna entrega?</div>
          <div class="sv-seg" style="display:inline-flex">
            <button type="button" data-cc="0" class="${conCarga ? '' : 'is-on'}">No, volvió vacío</button>
            <button type="button" data-cc="1" class="${conCarga ? 'is-on' : ''}">Sí, trae carga</button></div>
        </div>
        ${conCarga ? `<div>
          <div class="sv-dr-sect">Marca las entregas que vuelven al CD</div>
          ${ents.length ? ents.map((d, i) => `<label class="pt-ent ${sel.has(i) ? 'is-on' : ''}" for="f-e-${i}">
              <input type="checkbox" id="f-e-${i}" data-ent="${i}" ${sel.has(i) ? 'checked' : ''}>
              <span style="min-width:0"><b>${esc(d.numero)}</b></span>
              <em><input id="f-kg-${i}" class="pt-mono" placeholder="kg" value="${esc(d.kg ?? '')}" inputmode="decimal" style="width:88px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 7px" ${sel.has(i) ? '' : 'disabled'}></em></label>`).join('')
            : '<div class="pt-sub">Este camión no tiene entregas registradas: agréguelas con el lápiz de la fila.</div>'}
          ${sel.size ? `<div class="pt-calc" style="margin-top:8px">Marcado <b>${nf(kgSel)} kg</b>${vuelve != null ? ` · el camión trae <b>${nf(vuelve)} kg</b>${Math.abs(kgSel - vuelve) > 100 ? ' <span style="color:#b5000b">— no cuadra</span>' : ' <span style="color:#15803d">— cuadra</span>'}` : ''}</div>` : ''}
          <label class="pt-f" style="margin-top:12px"><span>Motivo de la devolución</span>
            <select id="f-mot">${MOTIVOS_DEV.map(m => `<option>${esc(m)}</option>`).join('')}</select></label>
        </div>` : ''}
        <label class="pt-f"><span>Observación</span><textarea id="f-obs" rows="2">${esc(v0.obs || '')}</textarea></label>
      </div>
      <div class="sv-dr-f"><div class="pt-sub">La hora de ingreso la pone el servidor.</div>
        <div style="display:flex;gap:6px"><button class="sv-btn" data-x>Cancelar</button>
        <button class="sv-btn-p" id="f-save"><span class="material-symbols-outlined">login</span>Registrar retorno</button></div></div>`;
    dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
    dr.querySelectorAll('[data-cc]').forEach(b => b.addEventListener('click', () => { conCarga = b.dataset.cc === '1'; if (!conCarga) sel.clear(); draw(); }));
    dr.querySelectorAll('[data-ent]').forEach(b => b.addEventListener('change', () => { const i = +b.dataset.ent; if (b.checked) sel.add(i); else sel.delete(i); draw(); }));
    dr.querySelector('#f-bi')?.addEventListener('change', draw);
    dr.querySelector('#f-save').addEventListener('click', guardar);
  };
  async function guardar() {
    const bi = num(dr.querySelector('#f-bi').value);
    if (bi == null) return showAlert('Registre el peso de ingreso del camión.', 'error');
    if (conCarga && !sel.size) return showAlert('Marque qué entrega vuelve al CD, o indique que volvió vacío.', 'error');
    const btn = dr.querySelector('#f-save'); btn.disabled = true;
    const dev = [...sel].map(i => ({ n_entrega: ents[i].numero, kg: num(dr.querySelector(`#f-kg-${i}`)?.value) }));
    const upd = {
      bruto_ingreso_kg: bi, entregas_devueltas: dev,
      motivo_devolucion: dev.length ? (dr.querySelector('#f-mot')?.value || null) : null,
      obs: dr.querySelector('#f-obs').value.trim() || null,
    };
    const { error } = await supabase.from('porteria_visitas').update(upd).eq('id', v0.id);
    if (error) { btn.disabled = false; return showAlert(errMsg(error), 'error'); }
    const { data, error: e2 } = await supabase.rpc('fn_porteria_marcar', { p_id: v0.id, p_hito: 'regreso' });
    btn.disabled = false;
    if (e2) return showAlert(errMsg(e2), 'error');
    reemplazar({ ...v0, ...upd, ...data });
    cerrar();
    showAlert(`Retorno registrado ${hhmm(data.t_regreso)} · ${data.patente}${dev.length ? ' · ' + dev.length + ' entrega(s) de vuelta' : ''}`);
    renderRegistro();
  }
  draw();
  dr.querySelector('#f-bi')?.focus();
}

// ── Guías del proveedor de un troncal con retiro de fábrica ─────────────────
async function agregarGuia(v) {
  if (!v) return;
  const r = await pedirDato(`Guías del proveedor · ${v.patente || ''}\n\n${arr(v.retiros).map(x => 'OC ' + x.doc_compr).join(' · ')}\n\nN° de guía (varias separadas por coma).`,
    { aceptar: 'Agregar', placeholder: 'Ej: 884120, 884121', icono: 'receipt_long' });
  if (r === null) return;
  const nums = String(r).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!nums.length) return;
  const g = arr(v.guias_proveedor).slice();
  nums.forEach(n => { if (!g.some(x => x.numero === n)) g.push({ numero: n, proveedor: arr(v.retiros)[0]?.proveedor || null, doc_compr: arr(v.retiros)[0]?.doc_compr || null }); });
  const { data, error } = await supabase.from('porteria_visitas').update({ guias_proveedor: g }).eq('id', v.id).select(COLS).single();
  if (error) return showAlert(errMsg(error), 'error');
  reemplazar(data);
  showAlert(`${nums.length} guía(s) registrada(s)`);
  renderRegistro();
}

// ── Agenda de proveedores del día ───────────────────────────────────────────
async function formAgendaProveedor() {
  await catalogos();
  const { dr, cerrar } = drawer('Agregar cita de proveedor');
  dr.innerHTML = `
    <div class="sv-dr-h"><div style="flex:1;min-width:0">
      <div class="sv-dr-k">Agenda de proveedores · ${fechaCorta(S.fecha)}</div>
      <div class="sv-dr-t">Agregar cita</div>
      <div class="sv-dr-s">Queda en la pestaña Proveedores, en su bloque de horario.</div></div>
      <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="sv-dr-b">
      <div class="pt-grid">
        <label class="pt-f full"><span>Proveedor *</span><input id="a-prov" list="a-dl" autocomplete="off"><datalist id="a-dl">${(S.proveedores || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="pt-f"><span>Bloque de horario</span><select id="a-blo"><option value="">— Sin bloque —</option>${S.bloques.map(b => `<option value="${b.bloque}">Bloque ${b.bloque} · ${b.desde}–${b.hasta}</option>`).join('')}</select></label>
        ${campo('Hora (si no usa bloque)', 'a-hora', '', 'type="time"')}
        ${campo('Orden de compra', 'a-oc', '', 'class="pt-mono" autocomplete="off"')}
        ${campo('Patente', 'a-pat', '', 'class="is-mono" autocomplete="off"')}
        ${campo('Transportista', 'a-tra', '', 'autocomplete="off"', 'full')}
        <label class="pt-f full"><span>Observación</span><textarea id="a-obs" rows="2"></textarea></label>
      </div>
    </div>
    <div class="sv-dr-f"><div></div><div style="display:flex;gap:6px">
      <button class="sv-btn" data-x>Cancelar</button><button class="sv-btn-p" id="a-save">Agregar a la agenda</button></div></div>`;
  dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
  const v = id => dr.querySelector('#' + id)?.value?.trim() ?? '';
  dr.querySelector('#a-save').addEventListener('click', async () => {
    if (!v('a-prov')) return showAlert('Indique el proveedor', 'error');
    const row = {
      fecha: S.fecha, centro: CENTRO, proveedor: v('a-prov'), doc_compr: v('a-oc') || null,
      bloque: v('a-blo') ? Number(v('a-blo')) : null, hora_presentacion: v('a-blo') ? null : (v('a-hora') || null),
      patente: v('a-pat') ? fmtPatente(v('a-pat')) : null, transportista: v('a-tra') || null, obs: v('a-obs') || null,
    };
    const { error } = await supabase.from('porteria_agenda_proveedor').insert(row);
    if (error) return showAlert(errMsg(error), 'error');
    cerrar();
    showAlert('Cita agregada a la agenda del día');
    await cargarDia();
    S.tab = 'PROVEEDOR';
    renderRegistro();
  });
  dr.querySelector('#a-prov')?.focus();
}

// ── Búsqueda única por patente / NV / OC / guía / entrega / chofer ──────────
async function buscar(q) {
  S.q = q || '';
  if (S.q.replace(/[^A-Za-z0-9]/g, '').length < 2) { S.busq = null; pintarBusqueda(); return; }
  const { data, error } = await supabase.rpc('fn_porteria_buscar', { p_q: S.q, p_centro: CENTRO });
  if (error) { showAlert('Error en la búsqueda: ' + error.message, 'error'); return; }
  S.busq = data || null;
  pintarBusqueda();
}
function pintarBusqueda() {
  const box = _stage?.querySelector('#pt-busq'); if (!box) return;
  box.innerHTML = S.busq ? panelBusqueda() : '';
  box.querySelectorAll('[data-irv]').forEach(b => b.addEventListener('click', () => irAVisita(+b.dataset.irv)));
  box.querySelectorAll('[data-ire]').forEach(b => b.addEventListener('click', () => irAEsperado(b.dataset.ire)));
  box.querySelector('#pt-bcerrar')?.addEventListener('click', () => { S.busq = null; S.q = ''; const i = _stage.querySelector('#pt-q'); if (i) i.value = ''; pintarBusqueda(); });
  box.querySelectorAll('[data-nuevo]').forEach(b => b.addEventListener('click', () => {
    S.tab = b.dataset.nuevo; S.busq = null;
    renderRegistro();
    if (b.dataset.nuevo === 'RETIRO_CLIENTE') formRetiroCliente(); else abrirForm(null, b.dataset.nuevo);
  }));
}
function panelBusqueda() {
  const B = S.busq;
  const esps = arr(B.esperados), vis = arr(B.visitas), hist = arr(B.historial);
  const hay = esps.length || vis.length;
  const row = (h, sub, tags, btn) => `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--sv-line)">
    <div style="min-width:0"><div style="font-size:15px;font-weight:700">${h}</div><div class="pt-sub">${sub}</div>
      ${tags ? `<div class="pt-tags">${tags}</div>` : ''}</div>${btn}</div>`;
  let html = `<div class="sv-card" style="margin-bottom:16px">
    <div class="pt-ch"><h2><span class="material-symbols-outlined">search</span>${esc(B.q || '')}
      <small>${hay ? `${esps.length} programado(s) · ${vis.length} registrado(s)` : 'sin coincidencias de hoy'}</small></h2>
      <button class="sv-btn is-icon" id="pt-bcerrar" title="Cerrar búsqueda"><span class="material-symbols-outlined">close</span></button></div>`;
  esps.forEach(e => {
    const c = citaDe(e);
    html += row(`${esc(e.patente || '— sin patente')} <span style="font-weight:600;font-size:13px">${esc(e.contraparte || '')}</span>`,
      `${TIPOS[e.tipo]?.label || e.tipo}${esRampla(e) ? ' · rampla a cliente' : ''} · ${c ? 'citación ' + esc(c.txt) : 'sin horario'}${e.chofer_nombre ? ' · ' + esc(e.chofer_nombre) : ''}`,
      `${e.consolida_retiro ? '<span class="pt-tag miss">Viene con retiro de fábrica</span>' : ''}${arr(e.retiros).map(r => `<span class="pt-tag">OC ${esc(r.doc_compr)}</span>`).join('')}`,
      e.visita_id ? `<button class="sv-btn" data-irv="${e.visita_id}">Ver registro</button>` : `<button class="sv-btn-p" data-ire="${esc(e.clave)}">Registrar llegada</button>`);
  });
  vis.forEach(v => {
    const t = tiempo(v);
    html += row(`${esc(v.patente || '')} <span style="font-weight:600;font-size:13px">${esc(v.contraparte || '')}</span>`,
      `${TIPOS[v.tipo]?.label || v.tipo} · ${(ESTADOS[v.estado] || [v.estado])[0]} · ${fechaCorta(v.fecha)} · llegada ${hhmm(v.t_presentacion) || '—'} · ingreso ${hhmm(v.t_ingreso) || '—'} · salida ${hhmm(v.t_salida) || '—'}${t.min != null ? ` · ${esc(t.que)} ${fmtMin(t.min)}` : ''}`,
      `${v.pedido_venta ? `<span class="pt-tag">NV ${esc(v.pedido_venta)}</span>` : ''}${arr(v.documentos).slice(0, 4).map(d => `<span class="pt-tag">${esc(d.tipo)} ${esc(d.numero)}</span>`).join('')}`,
      `<button class="sv-btn" data-irv="${v.id}">Abrir</button>`);
  });
  if (!hay) {
    html += `<div style="padding:16px">
      <div style="font-size:15px;font-weight:700">No hay nada programado hoy para «${esc(B.q || '')}»</div>
      <div class="pt-sub">No aparece en el plan de carga, ni en la agenda de proveedores, ni en retiros de fábrica. Regístralo según lo que venga a hacer: queda marcado fuera de agenda y avisa al monitor de Operaciones.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="sv-btn" data-nuevo="PROVEEDOR">Proveedor sin agenda</button>
        <button class="sv-btn" data-nuevo="RETIRO_CLIENTE">Cliente retira</button>
        <button class="sv-btn" data-nuevo="TRONCAL">Troncal sin plan</button>
        <button class="sv-btn" data-nuevo="DESPACHO_EBEMA">Despacho a cliente</button></div></div>`;
  }
  if (hist.length) {
    html += `<div class="pt-sect">Historial de esta patente<span>últimas ${hist.length} visitas</span></div>
      <div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contraparte</th><th class="r">Espera</th><th class="r">Permanencia</th><th class="r">Neto romana</th></tr></thead><tbody>
      ${hist.map(h => `<tr style="cursor:default"><td class="pt-mono">${fechaCorta(h.fecha)}</td><td>${tipoPill(h.tipo)}</td><td>${esc(h.contraparte || '')}</td>
        <td class="r pt-mono">${fmtMin(h.espera)}</td><td class="r pt-mono">${fmtMin(h.tipo === 'DESPACHO_EBEMA' ? h.ruta : h.permanencia)}</td>
        <td class="r pt-mono">${h.neto_kg != null ? nf(h.neto_kg) + ' kg' : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return html + '</div>';
}
async function irAEsperado(clave) {
  if (S.fecha !== hoy()) { S.fecha = hoy(); await cargarDia(); }
  const e = S.esperados.find(x => x.clave === clave);
  if (!e) return showAlert('Ese camión ya no está en los esperados de hoy.', 'error');
  S.tab = e.tipo; S.busq = null; S.q = '';
  renderRegistro();
  if (!e.visita_id) llegoEsperado(e);
}
async function irAVisita(id) {
  const v = S.visitas.find(x => x.id === id);
  if (v) { S.tab = v.tipo; S.busq = null; S.q = ''; renderRegistro(); return abrirForm(v); }
  const { data, error } = await supabase.from('porteria_visitas').select(COLS).eq('id', id).single();
  if (error) return showAlert(errMsg(error), 'error');
  abrirForm(data);
}
async function abrirForm(v, tipoPreset) {
  await catalogos();
  const nuevo = !v;
  const f = v ? JSON.parse(JSON.stringify(v))
    : { tipo: tipoPreset || S.tab || 'TRONCAL', subtipo: (tipoPreset || S.tab) === 'DESPACHO_EBEMA' ? 'GENERAL' : null, documentos: [], retiros: [] };
  let vinculo = null; // esperado vinculado al patente (sólo alta)
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sv-dr-bg" style="z-index:120"></div><aside class="sv-dr" style="z-index:121;width:min(600px,100vw)" role="dialog" aria-label="Registro portería"></aside>`;
  document.body.appendChild(wrap);
  const dr = wrap.querySelector('.sv-dr');
  const cerrar = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.sv-cf-bg')) { ev.preventDefault(); cerrar(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sv-dr-bg').addEventListener('click', cerrar);

  const fld = (lbl, id, val, extra = '', cls = '') => `<label class="pt-f ${cls}"><span>${lbl}</span><input id="${id}" value="${esc(val ?? '')}" ${extra}></label>`;

  const draw = () => {
    const T = TIPOS[f.tipo];
    const desp = f.tipo === 'DESPACHO_EBEMA';
    const listaContra = f.tipo === 'TRONCAL' ? (S.centros || []).map(c => c.nombre) : f.tipo === 'PROVEEDOR' ? (S.proveedores || []) : [];
    dr.innerHTML = `
      <div class="sv-dr-h"><div style="flex:1;min-width:0">
          <div class="sv-dr-k">${nuevo ? 'Registrar camión' : `Visita #${f.id} · ${fechaCorta(f.fecha)}`}</div>
          <div class="sv-dr-t">${esc(f.patente || 'Nuevo registro')}</div>
          <div class="sv-dr-s">${nuevo ? 'CD Quilicura (1003)' : `${estadoPill(f.estado)} · ${esc(f.origen || 'MANUAL')}${f.updated_by ? ` · editado por ${esc(f.updated_by)}` : ''}`}</div></div>
        <button class="sv-btn is-icon" data-x title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>
      <div class="sv-dr-b">
        <div>
          <div class="sv-dr-sect">Tipo de movimiento</div>
          <div class="sv-seg" style="flex-wrap:wrap">${Object.entries(TIPOS).map(([k, t]) => `<button type="button" data-tipo="${k}" class="${f.tipo === k ? 'is-on' : ''}"><span class="material-symbols-outlined">${t.icon}</span>${t.label}</button>`).join('')}</div>
          ${desp ? `<div class="sv-seg" style="margin-top:8px;display:inline-flex">${['GENERAL', 'FIERRO'].map(s => `<button type="button" data-sub="${s}" class="${(f.subtipo || 'GENERAL') === s ? 'is-on' : ''}">${s === 'GENERAL' ? 'Despacho general' : 'Fierro'}</button>`).join('')}</div>` : ''}
          <div class="pt-sub" style="margin-top:6px">Hitos: ${T.hitos.map(h => HITO_LBL[h]).join(' → ')}</div>
        </div>
        <div id="pt-match"></div>
        <div>
          <div class="sv-dr-sect">Camión y chofer</div>
          <div class="pt-grid">
            ${fld('Patente camión *', 'f-patente', f.patente, 'class="is-mono" autocomplete="off" placeholder="AA-BB-12"')}
            ${fld('Patente carro', 'f-carro', f.patente_carro, 'class="is-mono" autocomplete="off"')}
            ${fld('Nombre chofer', 'f-chofer', f.chofer_nombre, 'autocomplete="off"')}
            ${fld('RUT chofer', 'f-rut', f.chofer_rut, 'autocomplete="off"')}
            ${fld('Teléfono', 'f-tel', f.chofer_telefono, 'autocomplete="off"')}
            ${fld('Transportista', 'f-transp', f.transportista, 'autocomplete="off"')}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">${T.contra} y documentos</div>
          <div class="pt-grid">
            ${f.tipo === 'TRONCAL'
              ? `<label class="pt-f full"><span>${T.contra}</span><select id="f-ce"><option value="">— Seleccionar —</option>${(S.centros || []).map(c => `<option value="${esc(c.id)}" ${f.ce === c.id ? 'selected' : ''}>${esc(c.nombre)} (${esc(c.id)})</option>`).join('')}</select></label>`
              : `${fld(T.contra, 'f-contra', f.contraparte, `list="pt-dl" autocomplete="off"`, f.tipo === 'PROVEEDOR' ? '' : 'full')}<datalist id="pt-dl">${listaContra.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`}
            ${['PROVEEDOR', 'TRONCAL'].includes(f.tipo) ? fld(f.tipo === 'TRONCAL' ? 'Hora citación (presentación)' : 'Hora agenda', 'f-agenda', f.hora_agenda ? toLocalInput(f.hora_agenda).slice(11) : '', 'type="time"') : ''}
            ${f.tipo === 'TRONCAL' && citaDe(f)?.hasta ? `<div class="pt-f"><span>Bloque solicitado</span><div class="pt-calc" style="padding:8px 0"><b>${esc(citaDe(f).txt)}</b></div></div>` : ''}
            <div class="pt-f full"><span>Guías / OC / NV / Entregas / DT</span>
              <div class="pt-docs" id="f-docs">${(f.documentos || []).map((d, i) => `<span class="pt-doc"><b>${esc(d.tipo)}</b>${esc(d.numero)}<button type="button" data-deldoc="${i}" title="Quitar"><span class="material-symbols-outlined">close</span></button></span>`).join('') || '<span class="pt-sub">Sin documentos.</span>'}</div>
              <div class="pt-docadd"><select id="f-doctipo">${DOC_TIPOS.map(t => `<option ${t === (desp ? 'GUIA' : f.tipo === 'PROVEEDOR' ? 'OC' : f.tipo === 'RETIRO_CLIENTE' ? 'NV' : 'GUIA') ? 'selected' : ''}>${t}</option>`).join('')}</select>
                <input id="f-docnum" class="pt-mono" placeholder="N° (varios separados por coma)" autocomplete="off"><button type="button" class="sv-btn" id="f-docadd">Agregar</button></div>
            </div>
            ${(f.retiros || []).length ? `<div class="pt-f full"><span>Retiros de Fábrica vinculados</span><div class="sv-tags" style="margin:0">${f.retiros.map(r => `<span class="sv-tag mute">OC ${esc(r.doc_compr)} · ${esc(r.proveedor || '')}</span>`).join('')}</div></div>` : ''}
          </div>
        </div>
        <div>
          <div class="sv-dr-sect">Romana (kg, digitado)</div>
          <div class="pt-grid">
            ${fld(desp ? 'Peso salida (cargado)' : 'Peso entrada', desp ? 'f-bruto' : 'f-tara', desp ? f.bruto_kg : f.tara_kg, 'inputmode="decimal" class="pt-mono"')}
            ${fld(desp ? 'Peso regreso' : 'Peso salida', desp ? 'f-tara' : 'f-bruto', desp ? f.tara_kg : f.bruto_kg, 'inputmode="decimal" class="pt-mono"')}
            ${fld('Peso según guías', 'f-guias', f.peso_guias_kg, 'inputmode="decimal" class="pt-mono"')}
            <div class="pt-f"><span>Neto / diferencia</span><div class="pt-calc" id="f-calc" style="padding:8px 0"></div></div>
          </div>
        </div>
        ${nuevo ? '' : `<div>
          <div class="sv-dr-sect">Hitos (corrección manual)</div>
          <div class="pt-grid">${T.hitos.map(h => fld(HITO_LBL[h], 'f-h-' + h, toLocalInput(f['t_' + h]), 'type="datetime-local"')).join('')}</div>
          <div class="pt-sub" style="margin-top:6px">Sólo para corregir errores: los hitos se registran con los botones del Reloj Control.</div>
        </div>`}
        <label class="pt-f"><span>Observaciones</span><textarea id="f-obs" rows="2">${esc(f.obs || '')}</textarea></label>
      </div>
      <div class="sv-dr-f">
        <div style="display:flex;gap:6px;flex-wrap:wrap">${nuevo ? '' : `
          ${desp ? '' : '<button class="sv-btn" data-est="NO_SE_PRESENTA">No se presenta</button><button class="sv-btn" data-est="NO_CARGA">No carga</button>'}
          ${['NO_SE_PRESENTA', 'NO_CARGA', 'ANULADO'].includes(f.estado) ? '<button class="sv-btn" data-est="REABRIR">Reabrir</button>' : '<button class="sv-btn" data-est="ANULADO">Anular</button>'}`}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="sv-btn" data-x>Cancelar</button>
          ${nuevo ? `<button class="sv-btn" data-save="">Guardar sin hito</button>
            <button class="sv-btn-p" data-save="${desp ? 'salida' : 'presentacion'}"><span class="material-symbols-outlined">${desp ? 'logout' : 'login'}</span>Guardar y marcar ${desp ? 'salida' : 'llegada'}</button>`
            : '<button class="sv-btn-p" data-save="edit">Guardar cambios</button>'}
        </div>
      </div>`;
    bind();
    calc();
    if (nuevo && f.patente) buscarPatente(false);
  };

  const val = id => dr.querySelector('#' + id)?.value?.trim() ?? '';
  const leer = () => {
    f.patente = val('f-patente') ? fmtPatente(val('f-patente')) : null;
    f.patente_carro = val('f-carro') ? fmtPatente(val('f-carro')) : null;
    f.chofer_nombre = val('f-chofer') || null;
    f.chofer_rut = val('f-rut') || null;
    f.chofer_telefono = val('f-tel') || null;
    f.transportista = val('f-transp') || null;
    if (f.tipo === 'TRONCAL') {
      const ce = val('f-ce');
      f.ce = ce || null;
      // (28-oct-2026) CD-Cliente: la contraparte es el cliente, no la sucursal
      f.contraparte = esCdCliente(f) ? (f.contraparte || null) : ce ? (S.centros.find(c => c.id === ce)?.nombre || ce) : (f.contraparte || null);
    } else if (dr.querySelector('#f-contra')) { f.contraparte = val('f-contra') || null; }
    if (dr.querySelector('#f-agenda')) {
      const h = val('f-agenda');
      f.hora_agenda = h ? fromLocalInput(`${f.fecha || S.fecha}T${h}`) : null;
    }
    f.tara_kg = num(val('f-tara'));
    f.bruto_kg = num(val('f-bruto'));
    f.peso_guias_kg = num(val('f-guias'));
    f.obs = val('f-obs') || null;
    if (!nuevo) TIPOS[f.tipo].hitos.forEach(h => { const el = dr.querySelector('#f-h-' + h); if (el) f['t_' + h] = fromLocalInput(el.value); });
  };
  const calc = () => {
    const a = num(val('f-tara')), b = num(val('f-bruto')), g = num(val('f-guias'));
    const el = dr.querySelector('#f-calc'); if (!el) return;
    if (a == null || b == null) { el.innerHTML = 'Faltan pesajes'; return; }
    const neto = Math.abs(b - a);
    let txt = `Neto <b>${nf(neto)} kg</b>`;
    if (g > 0) {
      const p = (neto - g) / g * 100;
      const tol = Number(S.metas[f.tipo]?.tolerancia_peso_pct ?? 3);
      txt += ` · <b style="color:${Math.abs(p) > tol ? '#b5000b' : '#15803d'}">${p > 0 ? '+' : ''}${nf(p, 1)}%</b> vs guías (tol. ${nf(tol, 1)}%)`;
    }
    el.innerHTML = txt;
  };
  // Al ingresar la patente: proponer chofer desde la base de choferes y detectar si es un camión esperado hoy
  const buscarPatente = async (rellenar = true) => {
    const pat = fmtPatente(val('f-patente'));
    const inp = dr.querySelector('#f-patente');
    if (!pat) return;
    inp.value = pat;
    inp.classList.toggle('is-err', !patenteValida(pat));
    if (rellenar && !val('f-chofer')) {
      const { data } = await supabase.from('abast_base_choferes').select('chofer_nombre,chofer_rut,chofer_telefono,transportista,id_transporte,patente_carro')
        .eq('patente', pat).order('ultimo_uso', { ascending: false }).limit(1);
      const b = data?.[0];
      if (b) {
        const set = (id, v) => { const el = dr.querySelector('#' + id); if (el && !el.value && v) el.value = v; };
        set('f-chofer', b.chofer_nombre); set('f-rut', b.chofer_rut); set('f-tel', b.chofer_telefono); set('f-transp', b.transportista); set('f-carro', b.patente_carro);
        f.id_transporte = f.id_transporte || b.id_transporte || null;
      }
    }
    if (!nuevo) return;
    const box = dr.querySelector('#pt-match');
    const e = S.esperados.find(x => !x.visita_id && x.patente === pat);
    // No repintar si no cambió: al salir del campo patente (blur → change) el botón Vincular no debe reemplazarse bajo el clic
    const k = e && S.fecha === hoy() ? e.clave + (vinculo === e ? '|v' : '') : '';
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    if (!k) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="pt-match"><div><b>${pat}</b> está esperado hoy: ${esc(TIPOS[e.tipo].label)} ${e.tipo === 'TRONCAL' ? 'a ' : ''}${esc(e.contraparte || '')}
        ${e.consolida_retiro ? `<div class="pt-sub">Consolida retiro de fábrica: ${(e.retiros || []).map(r => 'OC ' + esc(r.doc_compr)).join(', ')}</div>` : ''}</div>
      <button type="button" class="sv-btn" id="pt-vinc">${vinculo === e ? 'Vinculado ✓' : 'Vincular'}</button></div>`;
    box.querySelector('#pt-vinc').addEventListener('click', () => {
      leer();
      vinculo = e;
      const p = payloadDesdeEsperado(e);
      Object.keys(p).forEach(k => { if (p[k] != null && (k !== 'documentos' || !(f.documentos || []).length)) f[k] = p[k]; });
      draw();
    });
  };

  const bind = () => {
    dr.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', cerrar));
    dr.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { leer(); f.tipo = b.dataset.tipo; if (f.tipo !== 'DESPACHO_EBEMA' && !(f.tipo === 'TRONCAL' && esCdCliente(f))) f.subtipo = null; draw(); }));
    dr.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { leer(); f.subtipo = b.dataset.sub; draw(); }));
    dr.querySelector('#f-patente').addEventListener('change', () => buscarPatente(true));
    ['f-tara', 'f-bruto', 'f-guias'].forEach(id => dr.querySelector('#' + id)?.addEventListener('input', calc));
    const addDoc = () => {
      const tipo = val('f-doctipo');
      const nums = val('f-docnum').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      if (!nums.length) return;
      leer();
      f.documentos = f.documentos || [];
      nums.forEach(n => { if (!f.documentos.some(d => d.tipo === tipo && d.numero === n)) f.documentos.push({ tipo, numero: n }); });
      draw();
      dr.querySelector('#f-docnum')?.focus();
    };
    dr.querySelector('#f-docadd').addEventListener('click', addDoc);
    dr.querySelector('#f-docnum').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDoc(); } });
    dr.querySelectorAll('[data-deldoc]').forEach(b => b.addEventListener('click', () => { leer(); f.documentos.splice(+b.dataset.deldoc, 1); draw(); }));
    dr.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => guardar(b.dataset.save, b)));
    dr.querySelectorAll('[data-est]').forEach(b => b.addEventListener('click', () => cambiarEstado(b.dataset.est)));
  };

  const guardar = async (modo, btn) => {
    leer();
    if (!f.patente) { showAlert('Ingrese la patente del camión', 'error'); dr.querySelector('#f-patente').focus(); return; }
    if (!patenteValida(f.patente) && !(await confirmar(`¿Continuar con la patente ${f.patente}?\n\nNo tiene el formato AA-BB-12 / AA-12-34.`, { aceptar: 'Continuar' }))) return;
    if (f.tipo === 'TRONCAL' && !f.contraparte) { showAlert('Seleccione la sucursal destino del troncal', 'error'); return; }
    btn.disabled = true;
    if (nuevo) {
      const p = {
        tipo: f.tipo, subtipo: f.tipo === 'DESPACHO_EBEMA' ? (f.subtipo || 'GENERAL') : (f.tipo === 'TRONCAL' && esCdCliente(f) ? 'CD_CLIENTE' : null), fecha: S.fecha,
        patente: f.patente, patente_carro: f.patente_carro, chofer_nombre: f.chofer_nombre, chofer_rut: f.chofer_rut, chofer_telefono: f.chofer_telefono,
        id_transporte: f.id_transporte || null, transportista: f.transportista, contraparte: f.contraparte, ce: f.ce || null,
        documentos: f.documentos || [], hora_agenda: f.hora_agenda, tara_kg: f.tara_kg, bruto_kg: f.bruto_kg, peso_guias_kg: f.peso_guias_kg, obs: f.obs,
        clave_esperado: vinculo ? f.clave_esperado : null, plan_ref: vinculo ? f.plan_ref : null, retiros: vinculo ? f.retiros : [],
        consolida_retiro: vinculo ? !!f.consolida_retiro : false, origen: vinculo ? f.origen : 'MANUAL',
        fuera_agenda: !vinculo, pedido_venta: f.pedido_venta || null,
        estado: modo ? 'EN_COLA' : 'PROGRAMADO',
      };
      const { data, error } = await supabase.rpc('fn_porteria_registrar', { p, p_hito: modo || null });
      btn.disabled = false;
      if (error) return showAlert(errMsg(error), 'error');
      S.visitas.push(data);
      if (vinculo) vinculo.visita_id = data.id;
      showAlert(modo ? `${HITO_LBL[modo]} registrada ${hhmm(data['t_' + modo])} · ${data.patente}` : 'Camión registrado');
    } else {
      const upd = {
        tipo: f.tipo, subtipo: f.tipo === 'DESPACHO_EBEMA' ? (f.subtipo || 'GENERAL') : (f.tipo === 'TRONCAL' && esCdCliente(f) ? 'CD_CLIENTE' : null),
        patente: f.patente, patente_carro: f.patente_carro, chofer_nombre: f.chofer_nombre, chofer_rut: f.chofer_rut, chofer_telefono: f.chofer_telefono,
        transportista: f.transportista, contraparte: f.contraparte, ce: f.ce || null, documentos: f.documentos || [], hora_agenda: f.hora_agenda,
        tara_kg: f.tara_kg, bruto_kg: f.bruto_kg, peso_guias_kg: f.peso_guias_kg, obs: f.obs,
        t_presentacion: f.t_presentacion ?? null, t_ingreso: f.t_ingreso ?? null, t_salida: f.t_salida ?? null, t_regreso: f.t_regreso ?? null,
      };
      // Al cambiar de tipo, los hitos que no aplican se limpian
      Object.keys(HITO_LBL).forEach(h => { if (!TIPOS[f.tipo].hitos.includes(h)) upd['t_' + h] = null; });
      const { data, error } = await supabase.from('porteria_visitas').update(upd).eq('id', f.id).select(COLS).single();
      btn.disabled = false;
      if (error) return showAlert(errMsg(error), 'error');
      reemplazar(data);
      showAlert('Cambios guardados');
    }
    cerrar();
    renderRegistro();
  };

  const cambiarEstado = async est => {
    const txt = { NO_SE_PRESENTA: 'Marcar "No se presenta"', NO_CARGA: 'Marcar "No carga"', ANULADO: 'Anular el registro', REABRIR: 'Reabrir el registro' }[est];
    if (!(await confirmar(`¿${txt} de ${f.patente || 'este camión'}?\n\n${est === 'ANULADO' ? 'No cuenta en los indicadores.' : est === 'REABRIR' ? 'El estado vuelve a calcularse desde los hitos.' : 'Queda registrado para el indicador de cumplimiento.'}`,
      { aceptar: est === 'REABRIR' ? 'Reabrir' : 'Confirmar', tono: est === 'ANULADO' ? 'peligro' : 'normal' }))) return;
    const { data, error } = await supabase.from('porteria_visitas').update({ estado: est === 'REABRIR' ? 'EN_COLA' : est }).eq('id', f.id).select(COLS).single();
    if (error) return showAlert(errMsg(error), 'error');
    reemplazar(data);
    const e = S.esperados.find(x => x.visita_id === f.id);
    if (e && est === 'ANULADO') e.visita_id = null;
    cerrar();
    renderRegistro();
  };

  draw();
  dr.querySelector('#f-patente')?.focus();
}

// ── Indicadores ─────────────────────────────────────────────────────────────
async function renderIndicadores() {
  _stage.innerHTML = `<div class="sv-view pt"><div class="sv-desc">Calculando indicadores…</div></div>`;
  const { data, error } = await supabase.rpc('fn_porteria_indicadores', { p_desde: S.desde, p_hasta: S.hasta, p_centro: CENTRO });
  if (error) { _stage.innerHTML = `<div class="sv-view pt"><div class="sv-note-box">Error: ${esc(error.message)}</div></div>`; return; }
  S.ind = data || {};
  const I = S.ind;
  const porTipo = Object.fromEntries((I.por_tipo || []).map(t => [t.tipo, t]));
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

  const tile = (k) => {
    const T = TIPOS[k], t = porTipo[k] || { n: 0 };
    const desp = k === 'DESPACHO_EBEMA';
    const p50 = desp ? t.ruta_p50 : t.perm_p50, p90 = desp ? t.ruta_p90 : t.perm_p90;
    const meta = S.metas[k]?.meta_min;
    const sobre = pct(t.sobre_meta || 0, t.con_metrica || 0);
    const color = meta == null || p50 == null ? '#9ca3af' : p50 > meta ? '#b5000b' : p50 > meta * 0.8 ? '#ca8a04' : '#15803d';
    return `<div class="pt-tile">
      <div class="pt-tile-h">${tipoPill(k)}<span class="pt-sub">${nf(t.n)} visitas</span></div>
      <div><div class="pt-sub">${desp ? 'Tiempo en ruta' : 'Permanencia en CD'} · mediana</div>
        <div class="pt-big" style="color:${color}">${fmtMin(p50)}<small>${meta ? `meta ${meta} min` : 'sin meta'}</small></div></div>
      ${meta && t.con_metrica ? `<div><div class="pt-bar"><i style="width:${100 - sobre}%;background:#15803d"></i></div><div class="pt-sub">${100 - sobre}% dentro de meta · ${sobre}% sobre meta</div></div>` : ''}
      <div class="pt-kv">
        <span>P90 ${desp ? 'ruta' : 'permanencia'}</span><span>${fmtMin(p90)}</span>
        ${desp ? '' : `<span>Espera en portería (p50 / p90)</span><span>${fmtMin(t.espera_p50)} / ${fmtMin(t.espera_p90)}</span>
        <span>Tiempo total (p50)</span><span>${fmtMin(t.total_p50)}</span>`}
        <span>Finalizados / en curso</span><span>${nf(t.finalizados || 0)} / ${nf(t.en_curso || 0)}</span>
        ${desp ? '' : `<span>No se presenta / No carga</span><span>${nf(t.no_se_presenta || 0)} / ${nf(t.no_carga || 0)}</span>`}
        ${k === 'TRONCAL' ? `<span>Consolidan retiro de fábrica</span><span>${nf(t.consolida || 0)}</span>` : ''}
        <span>Pesos fuera de tolerancia</span><span>${nf(t.fuera_tol || 0)} de ${nf(t.con_peso || 0)}</span>
      </div></div>`;
  };

  // Llegadas por hora (presentación; salida para despachos)
  const horas = Array.from({ length: 16 }, (_, i) => i + 6);
  const ph = I.por_hora || [];
  const maxH = Math.max(1, ...ph.map(x => x.n));
  const heat = `<table class="pt-heat"><thead><tr><th></th>${horas.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${Object.keys(TIPOS).map(k => `<tr><th>${TIPOS[k].label}</th>${horas.map(h => {
      const n = ph.find(x => x.tipo === k && x.hora === h)?.n || 0;
      const a = n ? 0.12 + 0.78 * n / maxH : 0;
      return `<td style="background:${n ? `rgba(181,0,11,${a.toFixed(2)})` : 'var(--sv-s1)'};color:${a > 0.5 ? '#fff' : 'var(--sv-ink)'}" title="${TIPOS[k].label} · ${h}:00 · ${n}">${n || ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;

  const pc = (I.por_contraparte || []).slice().sort((a, b) => b.n - a.n);
  const tablaPc = `<table class="sv-table"><thead><tr><th>Tipo</th><th>Contraparte</th><th class="r">Visitas</th><th class="r">Espera p50</th><th class="r">Permanencia / ruta p50</th><th class="r">% sobre meta</th></tr></thead><tbody>
    ${pc.length ? pc.map(r => {
      const s = pct(r.sobre_meta || 0, r.con_metrica || 0);
      return `<tr style="cursor:default"><td>${tipoPill(r.tipo)}</td><td>${esc(r.contraparte)}</td><td class="r">${nf(r.n)}</td>
        <td class="r pt-mono">${r.tipo === 'DESPACHO_EBEMA' ? '<span class="pt-na">·</span>' : fmtMin(r.espera_p50)}</td><td class="r pt-mono">${fmtMin(r.metrica_p50)}</td>
        <td class="r">${s == null || S.metas[r.tipo]?.meta_min == null ? '<span class="pt-na">—</span>' : pill(s + '%', s > 50 ? 'bad' : s > 20 ? 'warn' : 'ok')}</td></tr>`;
    }).join('') : '<tr class="sv-empty"><td colspan="6">Sin visitas en el período.</td></tr>'}</tbody></table>`;

  _stage.innerHTML = `<div class="sv-view pt">
    <div class="sv-vhead">
      <div><h1 class="sv-h1">Indicadores de Portería</h1>
        <div class="sv-desc">Tiempos de permanencia de camiones en CD Quilicura (1003): espera en portería (presentación → ingreso), permanencia (ingreso → salida) y ruta de despachos Ebema (salida → regreso). Medianas (p50) y percentil 90.</div></div>
      <div class="sv-actions">
        <label class="sv-inp"><span class="material-symbols-outlined">date_range</span><input type="date" id="pi-desde" value="${S.desde}"><span class="sv-sep">→</span><input type="date" id="pi-hasta" value="${S.hasta}"></label>
        <button class="sv-btn" id="pi-csv"><span class="material-symbols-outlined">download</span>Detalle CSV</button>
      </div>
    </div>
    <div class="pt-tiles">${Object.keys(TIPOS).map(tile).join('')}</div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">schedule</span>Llegadas por hora <small>presentación en portería · salida en despachos</small></h2></div>
      <div style="padding:12px 16px;overflow-x:auto">${heat}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">leaderboard</span>Por sucursal, proveedor o cliente</h2></div>
      <div class="sv-tablewrap" style="max-height:480px">${tablaPc}</div></div>
    <div class="sv-card"><div class="pt-ch"><h2><span class="material-symbols-outlined">flag</span>Metas</h2><button class="sv-btn-p" id="pi-metas">Guardar metas</button></div>
      <div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Tipo</th><th>Métrica</th><th class="r">Meta (min)</th><th class="r">Tolerancia peso (%)</th></tr></thead><tbody>
      ${Object.keys(TIPOS).map(k => `<tr style="cursor:default"><td>${tipoPill(k)}</td><td>${k === 'DESPACHO_EBEMA' ? 'Salida → regreso' : 'Ingreso → salida'}</td>
        <td class="r"><input data-meta="${k}" value="${S.metas[k]?.meta_min ?? ''}" inputmode="numeric" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td>
        <td class="r"><input data-tol="${k}" value="${S.metas[k]?.tolerancia_peso_pct ?? 3}" inputmode="decimal" class="pt-mono" style="width:90px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 8px"></td></tr>`).join('')}
      </tbody></table></div></div>
  </div>`;

  const $ = s => _stage.querySelector(s);
  const recargar = () => { S.desde = $('#pi-desde').value || S.desde; S.hasta = $('#pi-hasta').value || S.hasta; if (S.desde > S.hasta) [S.desde, S.hasta] = [S.hasta, S.desde]; renderIndicadores(); };
  $('#pi-desde').addEventListener('change', recargar);
  $('#pi-hasta').addEventListener('change', recargar);
  $('#pi-csv').addEventListener('click', descargarCSV);
  $('#pi-metas').addEventListener('click', async () => {
    const rows = Object.keys(TIPOS).map(k => ({
      tipo: k, meta_min: num(_stage.querySelector(`[data-meta="${k}"]`).value), tolerancia_peso_pct: num(_stage.querySelector(`[data-tol="${k}"]`).value) ?? 3,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('porteria_metas').upsert(rows, { onConflict: 'tipo' });
    if (error) return showAlert('No se pudieron guardar las metas: ' + error.message, 'error');
    await cargarMetas();
    showAlert('Metas guardadas');
    renderIndicadores();
  });
}

async function descargarCSV() {
  const { data, error } = await supabase.from('porteria_visitas').select(COLS).eq('centro', CENTRO)
    .gte('fecha', S.desde).lte('fecha', S.hasta).order('fecha').order('created_at').limit(20000);
  if (error) return showAlert('Error al descargar: ' + error.message, 'error');
  const f = t => (t ? new Date(t).toLocaleString('es-CL', { timeZone: TZ }) : '');
  const m = (a, b) => { const x = minEntre(a, b); return x == null ? '' : Math.round(x); };
  const kg = v => (v == null ? '' : String(v).replace('.', ','));
  const rows = (data || []).map(v => [
    v.fecha, TIPOS[v.tipo]?.label || v.tipo, v.subtipo || '', (ESTADOS[v.estado] || [v.estado])[0], v.patente || '', v.patente_carro || '',
    v.chofer_nombre || '', v.chofer_rut || '', v.transportista || '', v.contraparte || '', docsTxt(v.documentos),
    (v.retiros || []).map(r => r.doc_compr).join(' '), v.consolida_retiro ? 'SI' : '',
    f(v.hora_agenda), citaDe(v)?.txt || '', cumpleCita(v)?.txt || '', f(v.t_presentacion), f(v.t_ingreso), f(v.t_salida), f(v.t_regreso),
    m(v.t_presentacion, v.t_ingreso), m(v.t_ingreso, v.t_salida), m(v.t_presentacion, v.t_salida), m(v.t_salida, v.t_regreso),
    kg(v.tara_kg), kg(v.bruto_kg), kg(v.neto_kg), kg(v.peso_guias_kg),
    v.pedido_venta || '', v.retira_nombre || '', v.retira_rut || '', v.retira_es_chofer ? 'SI' : '', v.fuera_agenda ? 'SI' : '',
    (Array.isArray(v.guias_proveedor) ? v.guias_proveedor : []).map(g => g.numero).join(' '),
    kg(v.bruto_ingreso_kg), kg(v.bruto_ingreso_kg != null && v.tara_kg != null ? v.bruto_ingreso_kg - v.tara_kg : null),
    (Array.isArray(v.entregas_devueltas) ? v.entregas_devueltas : []).map(d => d.n_entrega).join(' '), v.motivo_devolucion || '',
    v.anden || '', v.sin_romana_autorizado ? 'SI' : '', v.origen || '', v.obs || '',
  ]);
  const head = ['Fecha', 'Tipo', 'Subtipo', 'Estado', 'Patente', 'Patente carro', 'Chofer', 'RUT chofer', 'Transportista', 'Contraparte', 'Documentos',
    'OC retiro', 'Consolida retiro', 'Hora agenda', 'Horario solicitado', 'Cumplimiento citación', 'Presentación', 'Ingreso', 'Salida', 'Regreso',
    'Espera (min)', 'Permanencia (min)', 'Total (min)', 'Ruta (min)', 'Peso entrada (kg)', 'Peso salida (kg)', 'Neto (kg)', 'Peso guías (kg)',
    'Pedido de venta', 'Quien retira', 'RUT quien retira', 'Retira es chofer', 'Fuera de agenda', 'Guías proveedor',
    'Bruto ingreso (kg)', 'Vuelve con (kg)', 'Entregas devueltas', 'Motivo devolución', 'Andén', 'Sin romana', 'Origen', 'Observaciones'];
  downloadFile(`reloj_control_${S.desde}_${S.hasta}.csv`, toCSV(head, rows));
}

// ── Monitor de Operaciones: alertas, bloques, tiempos y umbrales ────────────
const SEV = {
  CRITICA: { k: 'Críticas', bg: '#fbe7e8', fg: '#8e0009', dot: '#b5000b', icon: 'error' },
  ALTA:    { k: 'Altas',    bg: '#fbf0dc', fg: '#7a4f00', dot: '#ca8a04', icon: 'schedule' },
  MEDIA:   { k: 'Medias',   bg: '#e7eaef', fg: '#3c4049', dot: '#5b6070', icon: 'info' },
};
const AL_ICON = {
  SIN_ATENCION: 'hourglass_top', PERMANENCIA: 'timer', RUTA: 'local_shipping', DEVOLUCION: 'keyboard_return',
  SIN_ROMANA: 'scale', NO_SE_PRESENTO: 'event_busy', SOBRECUPO: 'groups', FUERA_AGENDA: 'factory',
  DATOS_DISTINTOS: 'compare_arrows', PESAJE_INCOMPLETO: 'scale', PESO_FUERA_TOL: 'balance',
  ABIERTO_ANTIGUO: 'history',
};

async function renderAlertas() {
  _stage.innerHTML = `<div class="sv-view pt"><div class="sv-desc">Leyendo alertas de portería…</div></div>`;
  const { data, error } = await supabase.rpc('fn_porteria_alertas', { p_centro: CENTRO });
  if (error) { _stage.innerHTML = `<div class="sv-view pt"><div class="sv-note-box">Error: ${esc(error.message)}</div></div>`; return; }
  S.alertas = data || {};
  const A = S.alertas;
  const als = arr(A.alertas), R = A.resumen || {}, T = A.tiempos || {}, metas = arr(A.metas);
  const peor = als.filter(a => a.tipo === 'SIN_ATENCION').reduce((m, a) => Math.max(m, a.minutos || 0), 0);
  const tile = (lbl, val, sub, cls) => `<div class="pt-tile" ${cls === 'crit' ? 'style="background:#b5000b;border-color:#b5000b;color:#fff"' : ''}>
    <div class="sv-kpi-l" style="${cls === 'crit' ? 'color:#ffd9db' : ''}"><i style="background:${cls === 'crit' ? '#fff' : '#9a9c99'}"></i>${lbl}</div>
    <div class="pt-big">${val}</div><div class="pt-sub" style="${cls === 'crit' ? 'color:#ffd9db' : ''};margin:0">${sub}</div></div>`;

  const alHtml = als.length ? als.map(a => {
    const s = SEV[a.severidad] || SEV.MEDIA;
    const valor = a.tipo === 'DEVOLUCION' ? `${nf(a.kg)} kg` : a.tipo === 'PESO_FUERA_TOL' ? `${a.pct > 0 ? '+' : ''}${nf(a.pct, 1)}%`
      : a.minutos != null ? fmtMin(a.minutos) : '';
    const acc = [];
    if (a.tipo === 'SIN_ATENCION' && a.visita_id) acc.push(`<button class="sv-btn-p" data-anden="${a.visita_id}">Asignar andén</button>`);
    if (a.visita_id) acc.push(`<button class="sv-btn ${acc.length ? '' : 'sv-btn-p'}" data-al="${a.visita_id}">${a.tipo === 'DEVOLUCION' ? 'Ver retorno' : 'Abrir camión'}</button>`);
    return `<div class="pt-al ${a.severidad === 'CRITICA' ? 'is-crit' : ''}">
      <div class="pt-al-i" style="background:${s.bg};color:${s.fg}"><span class="material-symbols-outlined">${AL_ICON[a.tipo] || s.icon}</span></div>
      <div class="pt-al-b">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <span class="pt-al-k" style="color:${s.fg}">${esc(a.titulo || a.tipo)}</span>
          ${a.escalado ? '<span class="pt-tag miss">Escalado al Jefe de Operaciones</span>' : ''}
          ${a.desde ? `<span class="pt-sub pt-mono" style="margin:0">desde ${hhmm(a.desde)}</span>` : ''}</div>
        <p class="pt-al-h">${a.patente ? `<b>${esc(a.patente)}</b>` : ''}${a.tipo_visita ? tipoPill(a.tipo_visita) : ''}${esc(a.contraparte || '')}</p>
        <div class="pt-al-d">${esc(a.detalle || '')}${a.umbral ? ` <span class="pt-sub" style="margin:0">(umbral ${a.umbral}${a.tipo === 'PESO_FUERA_TOL' ? '%' : a.tipo === 'SOBRECUPO' ? ' camiones' : ' min'})</span>` : ''}</div>
        <div class="pt-tags">${a.chofer ? `<span class="pt-sub" style="margin:0">Chofer ${esc(a.chofer)}</span>` : ''}
          ${a.transportista ? `<span class="pt-sub" style="margin:0">· ${esc(a.transportista)}</span>` : ''}
          ${a.anden ? `<span class="pt-tag">Andén ${esc(a.anden)}</span>` : a.tipo === 'SIN_ATENCION' ? '<span class="pt-tag miss">Andén sin asignar</span>' : ''}
          ${arr(a.entregas).map(d => `<span class="pt-tag miss">ENT ${esc(d.n_entrega)}${d.kg ? ' · ' + nf(d.kg) + ' kg' : ''}</span>`).join('')}</div>
      </div>
      <div class="pt-al-a">${valor ? `<div class="pt-big" style="color:${s.dot}">${valor}</div>` : ''}${acc.join('')}</div>
    </div>`;
  }).join('') : '<div class="sv-empty" style="padding:28px 16px;text-align:center">Sin alertas abiertas. Todos los camiones del día están dentro de los umbrales.</div>';

  const editaUmbrales = PERFIL_UMBRALES.includes(getPerfil());
  const inp = (id, v, w = 62) => (editaUmbrales
    ? `<input id="${id}" value="${v ?? ''}" inputmode="numeric" class="pt-mono" style="width:${w}px;text-align:right;border:1px solid var(--sv-line);border-radius:4px;padding:5px 7px">`
    : `<span class="pt-mono" style="font-weight:700">${v ?? '—'}</span>`);
  const bloques = arr(A.bloques).map(b => `<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:700">Bloque ${b.bloque}<span class="pt-sub pt-mono" style="margin:0">${esc(b.desde)}–${esc(b.hasta)}</span></div>
    <div style="display:flex;gap:4px;margin-top:8px">${Array.from({ length: Math.max(b.cupo, b.usados) }, (_, i) =>
      `<i style="flex:1;height:8px;border-radius:4px;background:${i < b.usados ? (i < b.cupo ? '#15161a' : '#b5000b') : 'var(--sv-s2)'}"></i>`).join('')}</div>
    <div class="pt-sub">${b.usados} de ${b.cupo} cupos${b.usados > b.cupo ? ' · <span style="color:#b5000b;font-weight:700">sobrecupo</span>' : b.usados === b.cupo ? ' · completo' : ' · queda ' + (b.cupo - b.usados)}</div></div>`).join('');

  const barra = (lbl, val, meta, fmt = fmtMin) => {
    if (val == null) return `<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${lbl}</span><b class="pt-mono">—</b></div><div class="pt-sub">sin datos del día</div></div>`;
    const col = meta ? (val > meta ? '#b5000b' : val > meta * 0.8 ? '#ca8a04' : '#15803d') : '#5b6070';
    const w = meta ? Math.min(100, Math.round(val / (meta * 1.25) * 100)) : 50;
    return `<div style="padding:12px 16px;border-bottom:1px solid var(--sv-line)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px"><span>${lbl}</span><b class="pt-mono" style="color:${col};font-size:15px">${fmt(val)}</b></div>
      <div class="pt-bar" style="height:8px;position:relative;margin-top:8px"><i style="width:${w}%;background:${col}"></i>${meta ? `<u style="position:absolute;top:-3px;bottom:-3px;left:80%;width:2px;background:var(--sv-ink);text-decoration:none"></u>` : ''}</div>
      <div class="pt-sub" style="display:flex;justify-content:space-between"><span>${meta ? 'meta ' + meta + ' min' : 'sin meta'}</span><span></span></div></div>`;
  };

  _stage.innerHTML = `<div class="sv-view pt">
    <div class="sv-vhead">
      <div><h1 class="sv-h1">Alertas de portería · Operaciones</h1>
        <div class="sv-desc">Qué camión está detenido, desde cuándo y quién debe actuar. El reloj corre contra el umbral de cada tipo; a los ${A.escalamiento_min || 30} minutos sobre el umbral la alerta escala al Jefe de Operaciones.</div></div>
      <div class="sv-actions">
        <div class="pt-mono" style="padding:9px 12px;border:1px solid var(--sv-line);border-radius:6px;background:#fff">CD Quilicura · ${hhmm(A.ahora)}</div>
        <button class="sv-btn is-icon" id="al-ref" title="Actualizar"><span class="material-symbols-outlined">refresh</span></button>
      </div>
    </div>
    <div class="pt-tiles" style="margin-bottom:16px">
      ${tile('Críticas', R.criticas || 0, 'detenidos sobre umbral o con devolución', (R.criticas || 0) > 0 ? 'crit' : '')}
      ${tile('Altas', R.altas || 0, 'no se presentaron, sobrecupo, sin romana')}
      ${tile('Medias', R.medias || 0, 'fuera de agenda, datos y pesaje')}
      ${tile('Peor tiempo sin atención', peor ? fmtMin(peor) : '—', 'camión esperando ingreso')}
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1.95fr) minmax(0,1fr);gap:16px;align-items:start" id="al-cols">
      <div class="sv-card">
        <div class="pt-ch"><h2><span class="material-symbols-outlined">notifications_active</span>Alertas abiertas <small>${als.length} · ordenadas por severidad y tiempo sobre el umbral</small></h2></div>
        ${alHtml}
      </div>
      <div>
        <div class="sv-card" style="margin-bottom:16px">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">event_seat</span>Ocupación de bloques</h2></div>
          ${bloques || '<div class="pt-sub" style="padding:14px 16px">Sin bloques configurados.</div>'}
        </div>
        <div class="sv-card" style="margin-bottom:16px">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">speed</span>Tiempos de hoy <small>mediana de ${T.n || 0} camión(es)</small></h2></div>
          ${barra('Espera en portería', T.espera_p50, S.metas.TRONCAL?.meta_espera_min)}
          ${barra('Permanencia en patio', T.perm_p50, S.metas.TRONCAL?.meta_min)}
          ${barra('Ruta de despachos', T.ruta_p50, S.metas.DESPACHO_EBEMA?.meta_min)}
          <div style="padding:12px 16px"><div class="pt-kv"><span>P90 espera</span><span>${fmtMin(T.espera_p90)}</span>
            <span>P90 permanencia</span><span>${fmtMin(T.perm_p90)}</span>
            <span>Finalizados hoy</span><span>${nf(T.finalizados || 0)} de ${nf(T.n || 0)}</span></div></div>
        </div>
        <div class="sv-card">
          <div class="pt-ch"><h2><span class="material-symbols-outlined">tune</span>Umbrales de alerta</h2>${editaUmbrales ? '<button class="sv-btn-p" id="al-save">Guardar</button>' : '<span class="pt-sub" style="margin:0">Los edita el Jefe de Operaciones</span>'}</div>
          <div class="sv-tablewrap"><table class="sv-table">
            <thead><tr><th>Tipo de visita</th><th class="r">Sin atención</th><th class="r">Permanencia / ruta</th><th class="r">Tol. peso</th></tr></thead>
            <tbody>${Object.keys(TIPOS).map(k => {
              const m = metas.find(x => x.tipo === k) || {};
              return `<tr style="cursor:default"><td>${tipoPill(k)}</td>
                <td class="r">${k === 'DESPACHO_EBEMA' ? '<span class="pt-na">·</span>' : inp('u-e-' + k, m.meta_espera_min) + ' min'}</td>
                <td class="r">${inp('u-m-' + k, m.meta_min) + ' min'}</td>
                <td class="r">${inp('u-t-' + k, m.tolerancia_peso_pct, 52) + ' %'}</td></tr>`;
            }).join('')}
            <tr style="cursor:default"><td colspan="3">Escalamiento al Jefe de Operaciones</td><td class="r">${inp('u-esc', A.escalamiento_min)} min</td></tr>
            </tbody></table></div>
          <div class="pt-sub" style="padding:12px 16px">No se presentó, devolución de entrega e ingreso autorizado sin romana alertan de inmediato. La rampla a cliente usa los umbrales de Troncal.</div>
        </div>
      </div>
    </div>
  </div>`;

  const $ = s => _stage.querySelector(s);
  $('#al-ref').addEventListener('click', renderAlertas);
  _stage.querySelectorAll('[data-al]').forEach(b => b.addEventListener('click', async () => {
    const { data: v, error: e } = await supabase.from('porteria_visitas').select(COLS).eq('id', +b.dataset.al).single();
    if (e) return showAlert(errMsg(e), 'error');
    abrirForm(v);
  }));
  _stage.querySelectorAll('[data-anden]').forEach(b => b.addEventListener('click', async () => {
    const r = await pedirDato('Asignar andén\n\n¿En qué andén se atiende este camión?', { aceptar: 'Asignar', placeholder: 'Ej: 4', icono: 'warehouse' });
    if (r === null) return;
    const { error } = await supabase.from('porteria_visitas').update({ anden: r.trim() || null }).eq('id', +b.dataset.anden);
    if (error) return showAlert(errMsg(error), 'error');
    showAlert('Andén asignado');
    renderAlertas();
  }));
  $('#al-save')?.addEventListener('click', async () => {
    const val = id => num($('#' + id)?.value);
    const rows = Object.keys(TIPOS).map(k => ({
      tipo: k, meta_min: val('u-m-' + k), meta_espera_min: k === 'DESPACHO_EBEMA' ? null : val('u-e-' + k),
      tolerancia_peso_pct: val('u-t-' + k) ?? 3, updated_at: new Date().toISOString(),
    }));
    const [a, b2] = await Promise.all([
      supabase.from('porteria_metas').upsert(rows, { onConflict: 'tipo' }),
      supabase.from('porteria_config').upsert({ clave: 'escalamiento_min', valor: val('u-esc') ?? 30, updated_at: new Date().toISOString() }, { onConflict: 'clave' }),
    ]);
    if (a.error || b2.error) return showAlert('No se pudieron guardar los umbrales: ' + (a.error || b2.error).message, 'error');
    await cargarMetas();
    showAlert('Umbrales guardados');
    renderAlertas();
  });
  limpiarTimers();
  _poll = setInterval(() => {
    if (!montado()) return limpiarTimers();
    if (document.querySelector('.sv-dr') || document.querySelector('.sv-cf-bg')) return;
    renderAlertas();
  }, 60000);
}
