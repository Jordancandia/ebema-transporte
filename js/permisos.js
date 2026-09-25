// ============================================================================
//  PERMISOS POR PERFIL Y CENTRO — fuente única de verdad del frontend
//  (25-sep-2026). La base de datos aplica la misma lógica vía RLS:
//  app_role(), app_centros(), app_grupos() — ver migración
//  perfiles_planner_centros_asignados.
//
//  Regla de UI: lo que un perfil no puede hacer se OCULTA, sin mensajes.
//
//  Menú: cada perfil lista las claves visibles.
//    'tab'            → ítem simple (home, rates, roles)
//    'grupo'          → todo el grupo desplegable (proveedores, rutas…)
//    'tab:sub'        → sólo esa pestaña dentro de un grupo
//  null = ve todo el menú.
// ============================================================================

const ABAST_OPERATIVAS = [
  'abastecimiento:stock_almacen',
  'abastecimiento:pedidos_traslados_revex',
  'abastecimiento:pedidos_venta',
  'abastecimiento:retiros',
  'abastecimiento:pedidos_traslados_4000',
  'abastecimiento:pedidos_traslados',
  'abastecimiento:plan_carga',
];

export const PERFILES = {
  OWNER: {
    label: 'Owner',
    menu: null,
    acciones: ['editar', 'eliminar', 'descargar', 'descargar_plan', 'excluir', 'coordinar_retiro', 'invitar', 'descargar_bd'],
    alcance: 'TODOS',
  },
  PLANNER_OPERACIONES: {
    label: 'Planner Operaciones',
    // Igual que OWNER, sin Cotizador, Tarifas Transporte, Tarifas Clientes ni Roles.
    menu: [
      'home', 'proveedores', 'rutas', 'abastecimiento', 'indicadores', 'flete-tercero',
    ],
    acciones: ['descargar_plan'],
    alcance: 'TODOS',
  },
  PLANNER_ABASTECIMIENTO: {
    label: 'Planner Abastecimiento',
    menu: [
      'proveedores',
      'abastecimiento:calendario',
      ...ABAST_OPERATIVAS,
      'abastecimiento:entregas_creadas',
      'abastecimiento:documentos_transporte',
      'abastecimiento:ind_plan_carga',
    ],
    acciones: ['editar', 'descargar', 'descargar_plan', 'excluir', 'coordinar_retiro'],
    alcance: 'CENTROS',
  },
  ADMINISTRADOR_DEPOSITO: {
    label: 'Admin. Depósito',
    menu: [
      'home', 'rates', 'proveedores', 'rutas',
      ...ABAST_OPERATIVAS,
      'indicadores:nivel', 'indicadores:tarifa', 'indicadores:margen',
      'flete-tercero',
    ],
    acciones: ['descargar_plan'],
    alcance: 'CENTROS',
  },
  AGENTE_COMERCIAL: {
    label: 'Agente',
    menu: ['rates', 'rutas', ...ABAST_OPERATIVAS],
    acciones: ['descargar_plan'],
    alcance: 'CENTROS',
  },
  // Pendientes de definición: sin vistas en la plataforma interna (usan el portal).
  TRANSPORTISTA: { label: 'Transportista', menu: [], acciones: [], alcance: 'CENTROS' },
  CHOFER:        { label: 'Chofer',        menu: [], acciones: [], alcance: 'CENTROS' },
};

// Perfiles que requieren centros asignados (restricción de datos)
export const ROLES_CON_CENTROS = Object.keys(PERFILES).filter(r => PERFILES[r].alcance === 'CENTROS' && !['TRANSPORTISTA', 'CHOFER'].includes(r));

// ── Sesión activa ───────────────────────────────────────────────────────────
let _role = null;
let _centros = [];

export function setSesionPermisos(role, centros) {
  _role = role || null;
  _centros = Array.isArray(centros) ? centros.map(c => String(c).trim()).filter(Boolean) : [];
}
export function getRol() { return _role; }
function perfil() { return PERFILES[_role] || { menu: [], acciones: [], alcance: 'CENTROS' }; }

// ¿Puede ejecutar la acción?
export function can(accion) { return perfil().acciones.includes(accion); }
export function esSoloLectura() { return !can('editar'); }

// ── Menú ────────────────────────────────────────────────────────────────────
// key: 'home' | 'proveedores' (grupo) | 'abastecimiento:plan_carga' (pestaña)
export function puedeVerMenu(grupoOTab, sub = null) {
  const m = perfil().menu;
  if (m === null) return true;
  if (m.includes(grupoOTab)) return true;
  if (sub != null && m.includes(`${grupoOTab}:${sub}`)) return true;
  if (sub == null && m.some(k => k.startsWith(grupoOTab + ':'))) return true; // grupo con alguna pestaña visible
  return false;
}

// ── Alcance por centro ──────────────────────────────────────────────────────
// null = ve todos los centros; array = sólo esos (vacío = ninguno)
export function centrosAlcance() { return perfil().alcance === 'TODOS' ? null : _centros.slice(); }
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
