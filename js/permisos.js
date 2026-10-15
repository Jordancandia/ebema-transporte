// ============================================================================
//  PERMISOS POR PERFIL Y CENTRO — fuente única de verdad del frontend
//  v2 (12-oct-2026, Jordan · planilla ROLES_Y_PERFILES.xlsx).
//  La base de datos aplica la misma lógica vía RLS: app_perfil() (perfil real),
//  app_role() (clase de seguridad), app_centros() ('*' = todos), app_tiene_accion().
//  Migración SQL: supabase/sql/2026-10-12_perfiles_v2_roles.sql
//
//  Regla de UI: lo que un perfil no puede hacer se OCULTA, sin mensajes.
//  Estructura por defecto según perfil; sólo OWNER agrega vistas/funcionalidades
//  extra por usuario (app_users."vistasExtra" / "accionesExtra").
//
//  Menú: cada perfil lista las claves visibles.
//    'tab'            → ítem simple (home, rates, roles)
//    'grupo'          → todo el grupo desplegable (proveedores, rutas…)
//    'tab:sub'        → sólo esa pestaña dentro de un grupo
//  null = ve todo el menú.
// ============================================================================

// Gestión Troncales — secciones del menú (NAV_LAYOUT en app.js)
const TRONCALES_CONFIG = ['abastecimiento:calendario', 'abastecimiento:stock_almacen'];
const TRONCALES_ORDEN = [
  'abastecimiento:pedidos_traslados_revex', 'abastecimiento:pedidos_venta', 'abastecimiento:retiros',
  'abastecimiento:pedidos_traslados_4000', 'abastecimiento:pedidos_traslados',
];
const TRONCALES_PLANIF = [
  'abastecimiento:plan_carga', 'abastecimiento:seguimiento_carga',
  'abastecimiento:control_diferencias', 'abastecimiento:ind_plan_carga',
];
const TRONCALES = [...TRONCALES_CONFIG, ...TRONCALES_ORDEN, ...TRONCALES_PLANIF];
const MAESTROS = ['proveedores', 'rutas', 'productos'];

// Privilegios de la planilla → acciones de la plataforma
//   VISUALIZAR: base de todos (descarga del Plan de Carga incluida, como hasta ahora)
//   COMENTAR:   reservado (funcionalidad de comentarios pendiente)
//   EDITAR:     excluir pedidos y subir pedidos al Plan de Carga + edición de datos de sus vistas
//   BORRAR:     sólo OWNER
//   INVITAR:    invitar usuarios desde Roles y Perfiles
const P_VISUALIZAR = ['descargar_plan'];
const P_COMENTAR = ['comentar'];
const P_EDITAR = ['editar', 'descargar', 'excluir', 'incluir_plan', 'ajustar_plan'];
const P_BORRAR = ['eliminar'];
const P_INVITAR = ['invitar'];
// Acciones operativas que por defecto sólo tiene OWNER (asignables como extra)
const OWNER_EXTRA = ['coordinar_venta', 'coordinar_retiro', 'forzar_cd_cliente', 'programar_transporte', 'coordinar_transporte', 'editar_dt_seguimiento', 'descargar_bd', 'activar_saldo'];

// clase = clase de seguridad en BD (app_role()); debe coincidir con la migración
export const PERFILES = {
  OWNER: {
    label: 'Owner', clase: 'OWNER', menu: null, alcance: 'TODOS',
    privilegios: ['VISUALIZAR', 'COMENTAR', 'EDITAR', 'BORRAR', 'INVITAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR, ...P_EDITAR, ...P_BORRAR, ...P_INVITAR, ...OWNER_EXTRA],
  },
  ADMINISTRADOR: {
    label: 'Administrador', clase: 'OWNER', menu: null, alcance: 'TODOS',
    privilegios: ['VISUALIZAR', 'COMENTAR', 'EDITAR', 'INVITAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR, ...P_EDITAR, ...P_INVITAR],
  },
  PLANNER_DISTRIBUCION: {
    label: 'Planner Distribución', clase: 'OWNER', alcance: 'TODOS',
    menu: ['home', 'rates', ...TRONCALES, 'flete-tercero', 'indicadores', 'tarifas-transporte', 'tarifas-clientes', ...MAESTROS, 'roles'],
    privilegios: ['COMENTAR', 'EDITAR', 'INVITAR'],
    // (12-oct-2026, Jordan) Coordina, programa y edita el transporte de los camiones del Plan de Carga.
    // (15-oct-2026, Jordan) También activa saldos de camiones que viajaron parciales (Seguimiento de Carga).
    acciones: [...P_VISUALIZAR, ...P_COMENTAR, ...P_EDITAR, ...P_INVITAR, 'coordinar_transporte', 'programar_transporte', 'activar_saldo'],
  },
  JEFE_ABASTECIMIENTO: {
    label: 'Jefe Abastecimiento', clase: 'PLANNER_ABASTECIMIENTO', alcance: 'TODOS',
    menu: ['home', ...TRONCALES],
    privilegios: ['COMENTAR', 'EDITAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR, ...P_EDITAR],
  },
  PLANNER_ABASTECIMIENTO: {
    label: 'Planner Abastecimiento', clase: 'PLANNER_ABASTECIMIENTO', alcance: 'TODOS',
    menu: ['home', ...TRONCALES],
    privilegios: ['COMENTAR', 'EDITAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR, ...P_EDITAR],
  },
  JEFE_OPERACIONES: {
    label: 'Jefe Operaciones', clase: 'ADMINISTRADOR_DEPOSITO', alcance: 'CENTROS',
    menu: ['home', ...TRONCALES, 'flete-tercero', 'indicadores', 'tarifas-clientes'],
    privilegios: ['COMENTAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR],
  },
  PLANNER_OPERACIONES: {
    label: 'Planner Operaciones', clase: 'ADMINISTRADOR_DEPOSITO', alcance: 'CENTROS',
    menu: ['home', 'rates', ...TRONCALES, 'flete-tercero', 'indicadores', 'tarifas-clientes'],
    privilegios: ['COMENTAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR],
  },
  JEFE_SUCURSAL: {
    label: 'Jefe Sucursal', clase: 'ADMINISTRADOR_DEPOSITO', alcance: 'CENTROS',
    menu: ['home', 'rates', ...TRONCALES, 'flete-tercero', 'indicadores', 'tarifas-clientes'],
    privilegios: ['COMENTAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR],
  },
  JEFE_CATEGORIA: {
    label: 'Jefe Categoría', clase: 'PLANNER_OPERACIONES', alcance: 'TODOS',
    menu: ['home', ...TRONCALES, 'indicadores'],
    privilegios: ['COMENTAR'],
    acciones: [...P_VISUALIZAR, ...P_COMENTAR],
  },
  VENDEDOR: {
    label: 'Vendedor', clase: 'AGENTE_COMERCIAL', alcance: 'CENTROS',
    menu: ['home', 'rates', ...TRONCALES_PLANIF],
    privilegios: ['VISUALIZAR'],
    acciones: [...P_VISUALIZAR],
  },
  // Sin vistas en la plataforma interna (usan el portal de proveedor).
  TRANSPORTISTA: { label: 'Transportista', clase: 'TRANSPORTISTA', menu: [], acciones: [], privilegios: [], alcance: 'CENTROS' },
  CHOFER:        { label: 'Chofer',        clase: 'CHOFER',        menu: [], acciones: [], privilegios: [], alcance: 'CENTROS' },
};

// Nombres antiguos (antes del 12-oct-2026) → perfil vigente
export const ALIAS_PERFIL = { AGENTE_COMERCIAL: 'VENDEDOR', ADMINISTRADOR_DEPOSITO: 'JEFE_OPERACIONES' };
export function normalizarPerfil(r) { return ALIAS_PERFIL[r] || r; }

// Perfiles que requieren centros asignados (restricción de datos por centro destino)
export const ROLES_CON_CENTROS = Object.keys(PERFILES).filter(r => PERFILES[r].alcance === 'CENTROS' && !['TRANSPORTISTA', 'CHOFER'].includes(r));
// Perfiles que pueden invitar / ver Roles y Perfiles
export const PERFILES_INTERNOS = Object.keys(PERFILES).filter(r => !['TRANSPORTISTA', 'CHOFER'].includes(r));
export const TODOS_CENTROS = '*';

// Funcionalidades que OWNER puede agregar a un usuario (además de su perfil).
// soloEditor: requieren un perfil con EDITAR (la BD no permite escribir a perfiles de sólo lectura).
export const ACCIONES_EXTRA = [
  { key: 'descargar',             label: 'Descargar reportes (CSV/Excel)' },
  { key: 'coordinar_venta',       label: 'Coordinar despacho de Ventas CD', soloEditor: true },
  { key: 'coordinar_retiro',      label: 'Coordinar Retiros de Fábrica', soloEditor: true },
  { key: 'forzar_cd_cliente',     label: 'Forzar / revertir tipo CD-Cliente', soloEditor: true },
  { key: 'coordinar_transporte',  label: 'Coordinar transporte del Plan de Carga (sin programar)', soloEditor: true },
  { key: 'programar_transporte',  label: 'Programar camión con transporte', soloEditor: true },
  { key: 'editar_dt_seguimiento', label: 'Editar DT en Seguimiento de Carga', soloEditor: true },
  { key: 'activar_saldo',         label: 'Activar saldo de camión parcial (Seguimiento de Carga)', soloEditor: true },
];

// ── Sesión activa ───────────────────────────────────────────────────────────
let _role = null;
let _centros = [];
let _vistasExtra = [];
let _accionesExtra = [];

const _arr = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
export function setSesionPermisos(role, centros, extras = {}) {
  _role = role ? normalizarPerfil(role) : null;
  _centros = _arr(centros);
  _vistasExtra = _arr(extras?.vistasExtra);
  _accionesExtra = _arr(extras?.accionesExtra);
}
export function getRol() { return _role; }
export function getPerfil() { return _role; }
function perfil() { return PERFILES[_role] || { menu: [], acciones: [], alcance: 'CENTROS', clase: null }; }
// Clase de seguridad (igual a app_role() en BD): OWNER, PLANNER_ABASTECIMIENTO, PLANNER_OPERACIONES, ADMINISTRADOR_DEPOSITO, AGENTE_COMERCIAL…
export function rolClase() { return perfil().clase || null; }
export function esOwner() { return _role === 'OWNER'; }

// ¿Puede ejecutar la acción? (perfil base + funcionalidades extra asignadas por OWNER)
export function can(accion) { return perfil().acciones.includes(accion) || _accionesExtra.includes(accion); }
export function esSoloLectura() { return !can('editar'); }

// ── Menú ────────────────────────────────────────────────────────────────────
// key: 'home' | 'proveedores' (grupo) | 'abastecimiento:plan_carga' (pestaña)
function _match(m, grupoOTab, sub) {
  if (m.includes(grupoOTab)) return true;
  if (sub != null && m.includes(`${grupoOTab}:${sub}`)) return true;
  if (sub == null && m.some(k => k.startsWith(grupoOTab + ':'))) return true; // grupo con alguna pestaña visible
  return false;
}
export function puedeVerMenu(grupoOTab, sub = null) {
  const m = perfil().menu;
  if (m === null) return true;
  return _match(m, grupoOTab, sub) || _match(_vistasExtra, grupoOTab, sub);
}
// ¿El perfil base (sin extras) ya ve esa clave? — usado por Roles y Perfiles
export function perfilVeMenu(role, key) {
  const p = PERFILES[normalizarPerfil(role)];
  if (!p) return false;
  if (p.menu === null) return true;
  const [g, s] = key.split(':');
  return _match(p.menu, g, s ?? null);
}

// ── Alcance por centro ──────────────────────────────────────────────────────
// null = ve todos los centros; array = sólo esos (vacío = ninguno). '*' = todos.
export function centrosAlcance() {
  if (perfil().alcance === 'TODOS' || _centros.includes(TODOS_CENTROS)) return null;
  return _centros.slice();
}
export function enAlcance(centro) {
  const a = centrosAlcance();
  if (a === null) return true;
  return a.includes(String(centro ?? '').trim());
}
export function filtrarPorCentro(rows, campoOFn) {
  const a = centrosAlcance();
  if (a === null || !Array.isArray(rows)) return rows;
  const get = typeof campoOFn === 'function' ? campoOFn : (r => r[campoOFn]);
  return rows.filter(r => a.includes(String(get(r) ?? '').trim()));
}

// Catálogo de vistas que OWNER puede agregar a un usuario (clave de menú → etiqueta)
export const VISTAS_CATALOGO = [
  { modulo: 'General', items: [['home', 'Home'], ['rates', 'Cotizador Despacho']] },
  { modulo: 'Gestión Troncales · Configuraciones', items: [['abastecimiento:calendario', 'Calendario Sucursales'], ['abastecimiento:stock_almacen', 'Stock Almacén 4000']] },
  { modulo: 'Gestión Troncales · Orden de Carga', items: [['abastecimiento:pedidos_traslados_revex', 'Revex'], ['abastecimiento:pedidos_venta', 'Ventas CD (1003)'], ['abastecimiento:retiros', 'Retiros de Fábrica'], ['abastecimiento:pedidos_traslados_4000', 'Crossdocking'], ['abastecimiento:pedidos_traslados', 'Pedidos de Traslados']] },
  { modulo: 'Gestión Troncales · Planificación', items: [['abastecimiento:plan_carga', 'Plan de Carga'], ['abastecimiento:seguimiento_carga', 'Seguimiento de Carga'], ['abastecimiento:control_diferencias', 'Control de Diferencias'], ['abastecimiento:ind_plan_carga', 'Indicadores Plan de Carga']] },
  { modulo: 'Flete Tercero / Indicadores', items: [['flete-tercero', 'Flete Tercero (Seguimiento)'], ['indicadores', 'Indicadores (Reportes)']] },
  { modulo: 'Tarifas', items: [['tarifas-transporte', 'Tarifas Transporte'], ['tarifas-clientes', 'Tarifas Clientes']] },
  { modulo: 'Maestros', items: [['proveedores', 'Proveedores'], ['rutas', 'Rutas'], ['productos', 'Productos']] },
  { modulo: 'Administración', items: [['roles', 'Roles y Perfiles']] },
];
