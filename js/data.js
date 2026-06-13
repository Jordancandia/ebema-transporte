// Capa de datos de SIT EBEMA
// Fuente principal: Supabase (PostgreSQL compartido, protegido con RLS).
// localStorage se mantiene como copia local de respaldo (modo sin conexión).
import { supabase } from './supabase-client.js';

const STORAGE_KEY = 'ebema_transporte_db';

// Mapeo colección local ↔ tabla Supabase (con su clave primaria)
const TABLE_MAP = [
  { local: 'logisticsCentres',  table: 'logistics_centres',  pk: 'id' },
  { local: 'routes',            table: 'routes',             pk: 'id' },
  { local: 'truckTypes',        table: 'truck_types',        pk: 'type' },
  { local: 'transports',        table: 'transports',         pk: 'id' },
  { local: 'transportsCamiones',  table: 'transports_camiones',  pk: 'id_camion' },
  { local: 'transportsChoferes',  table: 'transports_choferes',  pk: 'rut' },
  { local: 'quotesHistory',     table: 'quotes_history',     pk: 'id' },
  { local: 'users',             table: 'app_users',          pk: 'email' },
  { local: 'providers',         table: 'providers',          pk: 'email' },
  { local: 'tariffConfig',       table: 'tariff_config',        pk: 'id' },
  { local: 'clientTariffConfig', table: 'client_tariff_config', pk: 'id' }
];

// Capacidad nominal en KG a partir del nombre del tipo de camión (ej: "Camión 28 Ton" -> 28000)
export function truckCapKg(type) {
  const m = String(type).match(/(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}

// Tipo de eje según capacidad del camión (Tons): 5 a 10 Ton -> 2 ejes · 15 a 28 Ton -> 3 ejes
export function calcEjes(capacidad) {
  return Number(capacidad) >= 15 ? 3 : 2;
}

// Derivar las tablas normalizadas transports_camiones / transports_choferes
// a partir de los arrays JSON transports[].camiones / transports[].choferes.
// El JSON sigue siendo la fuente de verdad (sin reescritura de la pantalla Transportistas);
// estas tablas planas se regeneran completas en cada guardado para mantenerse sincronizadas.
function deriveCamionesChoferes(db) {
  const camiones = [];
  const choferes = [];
  (db.transports || []).forEach(t => {
    (t.camiones || []).forEach(c => {
      if (!c.patente) return;
      camiones.push({
        id_camion: c.patente,
        id_transporte: t.id,
        modelo: c.modelo || '',
        anio: c.anio || null,
        capacidad_ton: c.capacidad || 0,
        ejes: c.ejes !== undefined ? c.ejes : calcEjes(c.capacidad),
        alto_carroceria: (c.dimensiones && c.dimensiones.alto) || null,
        ancho_carroceria: (c.dimensiones && c.dimensiones.ancho) || null,
        largo_carroceria: (c.dimensiones && c.dimensiones.largo) || null,
        chofer_rut: c.choferRut || null,
        documentos: c.documentos || {}
      });
    });
    (t.choferes || []).forEach(ch => {
      if (!ch.rut) return;
      const nombreCompleto = (ch.nombre || '').trim();
      const partes = nombreCompleto.split(/\s+/);
      const idCamion = (t.camiones || []).find(c => c.choferRut === ch.rut);
      choferes.push({
        rut: ch.rut,
        nombre: partes[0] || '',
        apellido: partes.slice(1).join(' '),
        licencia: ch.licencia || '',
        celula_identidad: ch.archivoCarne || null,
        telefono: ch.telefono || '',
        id_transporte: t.id,
        id_camion: idCamion ? idCamion.patente : null
      });
    });
  });
  db.transportsCamiones = camiones;
  db.transportsChoferes = choferes;
}

// Configuración por defecto: Administrador de Tarifas Transporte (Pantalla 1)
export function defaultTariffConfig() {
  return {
    // Sub-módulo 1: Peajes — [{ id, rutaId, ejes, concesionaria, plazaPeaje, valorPeaje }]
    peajes: [],
    // Sub-módulo 2: Combustibles — { [centroId]: { precioLitro, fecha } }
    combustibles: {},
    // Matriz de rendimiento estructural (km/L), por capacidad en kg
    rendimientos: {
      '5000':  { cargado: 7.5, vacio: 9.5 },
      '10000': { cargado: 5.0, vacio: 7.0 },
      '15000': { cargado: 4.2, vacio: 5.8 },
      '28000': { cargado: 2.8, vacio: 4.0 }
    },
    // Mapeo fijo de ejes por capacidad (kg)
    ejes: { '5000': 2, '10000': 2, '15000': 3, '28000': 3 },
    // Sub-módulo 3: Seguro de carga — { [centroId]: ufMensual }
    seguros: {},
    // Permiso de circulación + SOAP anual — { 'centroId|capKg': { permiso, soap } }
    permisosSoap: {},
    // KM Mensuales Ofrecidos — { 'centroId|capKg': km }
    kmOfrecidos: {},
    // Sub-módulo 4: Variables generales
    variables: {
      valorUF: 38000,
      fechaUF: '',
      margenGanancia: 15,
      neumaticos: {
        ciclo: 50000,
        costos: { '5000': 400000, '10000': 600000, '15000': 800000, '28000': 1200000 }
      },
      gps: { costoUF: 0.45 },
      mantencion: { ciclo: 20000, costos: {} }, // { 'centroId|capKg': costo }
      chofer: { sueldoMinimo: {}, diasHabiles: 22, comisionPct: 5 }, // sueldoMinimo: { centroId: monto }
      factorRuta: { NORMAL: 1.00, ISLA: 1.35, EXTREMA: 1.50 },
      costosBase: {
        '5000':  { fijo: 30000,  kmAdicional: 46000 },
        '10000': { fijo: 30000,  kmAdicional: 76000 },
        '15000': { fijo: 30000,  kmAdicional: 83000 },
        '28000': { fijo: 100000, kmAdicional: 100000 }
      }
    }
  };
}

// Configuración por defecto: Administrador de Tarifas Clientes (Pantalla 2)
export function defaultClientTariffConfig() {
  return {
    // Sub-módulo A: histórico 6M ingresado vía CSV
    historico: [], // [{ centroId, rutaId, tipoCamionKg, toneladas, clientes, obras, interregional }]
    // Sub-módulo B/C: resultados de consolidación y complejidad por ruta
    consolidacion: {}, // { rutaId: { factorFinal, indicador, cluster } }
    clusterColors:    { '1': '#16a34a', '2': '#f59e0b', '3': '#3b82f6', spot: '#6b7280' },
    clusterNV:        { '1': 3.5, '2': 2.0, '3': 2.0, spot: 1.0 },
    clusterFrecuencia:{ '1': 'Lunes a Viernes', '2': '2 a 3 días/semana', '3': '2 días/semana', spot: '48 horas' },
    // Sub-módulo: Tarifas especiales
    especiales: {
      tipo0000: { tarifaPlana: 0 },
      recargoExclusividad: {} // { centroId: { activo: false, pct: 0 } }
    }
  };
}

let memoryDb = null;

// Cargar TODO desde Supabase a memoria (llamar tras iniciar sesión)
export async function initDatabase() {
  try {
    const results = await Promise.all(
      TABLE_MAP.map(t => supabase.from(t.table).select('*'))
    );
    const failed = results.find(r => r.error);
    if (failed) throw failed.error;

    memoryDb = {};
    TABLE_MAP.forEach((t, i) => { memoryDb[t.local] = results[i].data || []; });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryDb));
    return memoryDb;
  } catch (err) {
    console.error('Supabase no disponible, usando copia local:', err.message || err);
    memoryDb = null; // getDatabase usará el respaldo de localStorage
    return getDatabase();
  }
}

// Sincronizar una colección completa hacia Supabase (upsert + borrar faltantes)
async function syncTable(table, pk, rows) {
  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows);
    if (error) throw error;
  }
  const keys = rows.map(r => String(r[pk]).replace(/"/g, ''));
  let q = supabase.from(table).delete();
  q = keys.length > 0
    ? q.not(pk, 'in', `(${keys.map(k => `"${k}"`).join(',')})`)
    : q.neq(pk, '___nunca___');
  const { error } = await q;
  if (error) throw error;
}

// Enviar el estado completo a Supabase (en segundo plano)
async function syncToSupabase(db) {
  for (const t of TABLE_MAP) {
    await syncTable(t.table, t.pk, db[t.local] || []);
  }
}

const defaultData = {
  // 1. Usuarios corporativos registrados
  users: [
    { email: 'admin@ebema.cl', name: 'Administrador Ebema', role: 'admin' },
    { email: 'logistica@ebema.cl', name: 'Operador Logístico', role: 'operador' }
  ],
  
  // 2. Transportistas (Administrador de Transportes)
  transports: [
    {
      id: 't1',
      razonSocial: 'Transportes TransMateriales Ltda',
      rut: '76.849.201-3',
      direccion: 'Av. Américo Vespucio 1230, Quilicura',
      comuna: 'Quilicura',
      region: 'Metropolitana',
      telefono: '+56 9 8765 4321',
      email: 'contacto@transmateriales.cl',
      patente: 'HR-PX-45',
      modelo: 'Mercedes-Benz Actros 2651',
      anio: 2021,
      capacidad: 28,
      dimensiones: { largo: 13.6, ancho: 2.4, alto: 2.7 },
      codigoSap: 'TRSP001',
      activo: true,
      documentos: {
        permisoCirculacion:   { archivo: null, desde: '2025-01-01', hasta: '2026-12-31' },
        seguroCarga:          { archivo: null, desde: '2025-03-01', hasta: '2026-02-28' },
        padron:               { archivo: null, desde: '2020-06-01', hasta: '2030-06-01' },
        soap:                 { archivo: null, desde: '2026-01-01', hasta: '2026-12-31' },
        certificadoEmision:   { archivo: null, desde: '2025-06-01', hasta: '2026-06-01' }
      },
      conductor: {
        nombre: 'Carlos Riquelme Fuentes',
        rut: '15.432.876-K',
        telefono: '+56 9 7654 3210',
        licencia: 'A2-567890',
        archivoLicencia: null,
        archivoCarne: null
      }
    },
    {
      id: 't2',
      razonSocial: 'Logística Rápida del Sur',
      rut: '85.340.500-K',
      direccion: 'Panamericana Sur Km 15, San Bernardo',
      comuna: 'San Bernardo',
      region: 'Metropolitana',
      telefono: '+56 9 1234 5678',
      email: 'operaciones@lograpidasur.cl',
      patente: 'LK-TR-89',
      modelo: 'Scania R 410',
      anio: 2019,
      capacidad: 15,
      dimensiones: { largo: 8.5, ancho: 2.4, alto: 2.6 },
      codigoSap: 'TRSP002',
      activo: true,
      documentos: {
        permisoCirculacion:   { archivo: null, desde: '2025-01-01', hasta: '2025-12-31' },
        seguroCarga:          { archivo: null, desde: '2025-03-01', hasta: '2025-12-31' },
        padron:               { archivo: null, desde: '2019-04-01', hasta: '2029-04-01' },
        soap:                 { archivo: null, desde: '2025-01-01', hasta: '2025-12-31' },
        certificadoEmision:   { archivo: null, desde: '2025-01-01', hasta: '2025-06-30' }
      },
      conductor: {
        nombre: 'Pedro Soto Contreras',
        rut: '12.345.678-9',
        telefono: '+56 9 9876 5432',
        licencia: 'A2-112233',
        archivoLicencia: null,
        archivoCarne: null
      }
    },
    {
      id: 't3',
      razonSocial: 'Fletes y Transportes del Centro',
      rut: '93.200.410-6',
      direccion: 'Camino a Melipilla 8900, Maipú',
      comuna: 'Maipú',
      region: 'Metropolitana',
      telefono: '+56 9 4455 6677',
      email: 'fletes.centro@gmail.com',
      patente: 'GB-DS-12',
      modelo: 'Volvo FH 420',
      anio: 2018,
      capacidad: 10,
      dimensiones: { largo: 7.2, ancho: 2.3, alto: 2.5 },
      codigoSap: 'TRSP003',
      activo: false,
      documentos: {
        permisoCirculacion:   { archivo: null, desde: '', hasta: '' },
        seguroCarga:          { archivo: null, desde: '', hasta: '' },
        padron:               { archivo: null, desde: '', hasta: '' },
        soap:                 { archivo: null, desde: '', hasta: '' },
        certificadoEmision:   { archivo: null, desde: '', hasta: '' }
      },
      conductor: {
        nombre: '',
        rut: '',
        telefono: '',
        licencia: '',
        archivoLicencia: null,
        archivoCarne: null
      }
    }
  ],

  // 3. Rutas (Administrador de Rutas)
  routes: [
    {
      id: 'r1',
      codigo: 'RUT-SCL-QUI',
      origenId: 'cd1',
      destino: 'Quilicura',
      region: 'Metropolitana',
      tipo: 'Comuna',
      km: 25,
      activo: true
    },
    {
      id: 'r2',
      codigo: 'RUT-SCL-RAN',
      origenId: 'cd1',
      destino: 'Rancagua',
      region: 'Libertador General Bernardo O\'Higgins',
      tipo: 'Sector',
      km: 95,
      activo: true
    },
    {
      id: 'r3',
      codigo: 'RUT-SCL-CON',
      origenId: 'cd1',
      destino: 'Concepción',
      region: 'Biobío',
      tipo: 'Sector',
      km: 510,
      activo: true
    },
    {
      id: 'r4',
      codigo: 'RUT-CON-TAL',
      origenId: 'cd2',
      destino: 'Talcahuano',
      region: 'Biobío',
      tipo: 'Comuna',
      km: 18,
      activo: true
    },
    {
      id: 'r5',
      codigo: 'RUT-TEM-PAD',
      origenId: 'cd3',
      destino: 'Padre Las Casas',
      region: 'La Araucanía',
      tipo: 'Comuna',
      km: 8,
      activo: false
    }
  ],

  // 4. Centros Logísticos (CD)
  logisticsCentres: [
    {
      id: 'cd1',
      nombre: 'CD Santiago Noviciado',
      direccion: 'Camino Noviciado 1050, Lampa, Región Metropolitana',
      lat: -33.3768,
      lon: -70.8354
    },
    {
      id: 'cd2',
      nombre: 'CD Concepción',
      direccion: 'Ruta 160 Km 12, Coronel, Región del Biobío',
      lat: -36.9015,
      lon: -73.1168
    },
    {
      id: 'cd3',
      nombre: 'CD Temuco',
      direccion: 'Av. Recabarren 02500, Temuco, Región de La Araucanía',
      lat: -38.7490,
      lon: -72.6360
    }
  ],

  // 5. Configuración de Tarifas (Matriz)
  // Define los costos base y costo por KM para cada categoría de Camión
  truckTypes: [
    { type: 'Camión 5 Ton',  capacityTons: 'Hasta 5 Tons',  baseRate: 45000,  ratePerKm: 1200 },
    { type: 'Camión 10 Ton', capacityTons: 'Hasta 10 Tons', baseRate: 60000,  ratePerKm: 1500 },
    { type: 'Camión 15 Ton', capacityTons: 'Hasta 15 Tons', baseRate: 75000,  ratePerKm: 1800 },
    { type: 'Camión 28 Ton', capacityTons: 'Hasta 28 Tons', baseRate: 120000, ratePerKm: 2500 }
  ],

  // 6. Historial de Cotizaciones (historial_cotizaciones)
  quotesHistory: [
    {
      id: 'q1',
      fecha: '2026-06-11 08:45',
      origen: 'CD Santiago Noviciado',
      destino: 'Rancagua',
      vehiculo: 'Doble Puente',
      estado: 'COTIZADO',
      monto: 246000
    },
    {
      id: 'q2',
      fecha: '2026-06-11 08:12',
      origen: 'CD Concepción',
      destino: 'Talcahuano',
      vehiculo: 'Sencillo',
      estado: 'ASIGNADO',
      monto: 66600
    }
  ],

  // 7. Administrador de Tarifas Transporte (Pantalla 1)
  tariffConfig: [
    { id: 'global', data: defaultTariffConfig() }
  ],

  // 8. Administrador de Tarifas Clientes (Pantalla 2)
  clientTariffConfig: [
    { id: 'global', data: defaultClientTariffConfig() }
  ]
};

// Obtener la base de datos en memoria (Supabase) o respaldo local
export function getDatabase() {
  if (memoryDb) return memoryDb;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
    return defaultData;
  }
  
  const parsed = JSON.parse(data);
  
  // Migración automática: Asegurar que todos los centros logísticos tengan lat y lon
  let migrado = false;
  if (parsed.logisticsCentres) {
    parsed.logisticsCentres.forEach(cd => {
      if (cd.lat === undefined || cd.lon === undefined) {
        const dcd = defaultData.logisticsCentres.find(item => item.id === cd.id);
        cd.lat = dcd ? dcd.lat : -33.4489;
        cd.lon = dcd ? dcd.lon : -70.6693;
        migrado = true;
      }
      // Eliminar el campo redundante idCentroSap (id ahora ES el código SAP)
      if (cd.idCentroSap !== undefined) {
        delete cd.idCentroSap;
        migrado = true;
      }
    });
  }
  
  if (!parsed.hasOwnProperty('quotesHistory')) {
    parsed.quotesHistory = defaultData.quotesHistory;
    migrado = true;
  }

  // Migración: Asegurar que existe la tabla de usuarios (Roles y Perfiles)
  if (!parsed.users) {
    parsed.users = defaultData.users;
    migrado = true;
  }

  // Migración: Asegurar que existe la colección de proveedores
  if (!parsed.providers) {
    parsed.providers = [];
    migrado = true;
  }

  // Migración: Nuevos tipos de camión (5/10/15/28 Ton)
  if (!parsed.truckTypes || !parsed.truckTypes.some(t => t.type === 'Camión 28 Ton')) {
    parsed.truckTypes = defaultData.truckTypes;
    migrado = true;
  }

  // Migración: Característica de rutas (NORMAL / EXTREMA / ISLA)
  if (parsed.routes) {
    parsed.routes.forEach(r => {
      if (!r.caracteristica) { r.caracteristica = 'NORMAL'; migrado = true; }
    });
  }

  // Migración: Zona de transporte, clasificación y coordenadas del destino
  if (parsed.routes) {
    parsed.routes.forEach(r => {
      if (r.idZonaTrans === undefined) { r.idZonaTrans = ''; migrado = true; }
      if (r.clasificRuta === undefined) { r.clasificRuta = 'Regional'; migrado = true; }
      if (r.lat === undefined) { r.lat = null; migrado = true; }
      if (r.lon === undefined) { r.lon = null; migrado = true; }
    });
  }

  // Migración: Transportistas multi-camión y multi-chofer
  if (parsed.transports) {
    parsed.transports.forEach(t => {
      if (!t.camiones) {
        t.camiones = t.patente ? [{
          id: 'c' + t.id,
          patente: t.patente,
          modelo: t.modelo || '',
          anio: t.anio || 2020,
          capacidad: t.capacidad || 0,
          ejes: calcEjes(t.capacidad || 0),
          dimensiones: t.dimensiones || { largo: 0, ancho: 0, alto: 0 },
          documentos: t.documentos || {},
          choferRut: (t.conductor && t.conductor.rut) || ''
        }] : [];
        migrado = true;
      }
      if (!t.choferes) {
        t.choferes = (t.conductor && t.conductor.nombre) ? [t.conductor] : [];
        migrado = true;
      }
      if (!t.centrosServicio) { t.centrosServicio = []; migrado = true; }
    });
  }

  // Migración: Tipo de eje por capacidad de camión (5-10 Ton -> 2 ejes · 15-28 Ton -> 3 ejes)
  if (parsed.transports) {
    parsed.transports.forEach(t => {
      (t.camiones || []).forEach(c => {
        if (c.ejes === undefined) { c.ejes = calcEjes(c.capacidad); migrado = true; }
      });
    });
  }

  // Migración: Datos bancarios para pago a transportistas (cuenta corriente / vista / etc.)
  if (parsed.transports) {
    parsed.transports.forEach(t => {
      if (!t.datosBancarios) {
        t.datosBancarios = { banco: '', tipoCuenta: '', numeroCuenta: '', rut: t.rut };
        migrado = true;
      } else if (t.datosBancarios.rut !== t.rut) {
        t.datosBancarios.rut = t.rut;
        migrado = true;
      }
    });
  }

  // Migración: Rutas enlazadas por nombre de CD → enlazar por ID (origenId)
  if (parsed.routes && parsed.logisticsCentres) {
    parsed.routes.forEach(r => {
      if (!r.origenId) {
        const cd = parsed.logisticsCentres.find(c =>
          c.nombre && r.origen && c.nombre.trim().toLowerCase() === r.origen.trim().toLowerCase()
        );
        r.origenId = cd ? cd.id : (parsed.logisticsCentres[0] ? parsed.logisticsCentres[0].id : null);
        delete r.origen;
        migrado = true;
      }
    });
  }

  // Migración: Denominación de ruta (centro origen + destino)
  if (parsed.routes && parsed.logisticsCentres) {
    parsed.routes.forEach(r => {
      if (!r.denominacion) {
        const cd = parsed.logisticsCentres.find(c => c.id === r.origenId);
        r.denominacion = `${cd ? cd.nombre : 'Origen'} - ${r.destino || ''}`;
        migrado = true;
      }
    });
  }

  // Migración: Asegurar que todos los transportes tienen campos de ficha
  if (parsed.transports) {
    parsed.transports.forEach(t => {
      if (!t.documentos) {
        t.documentos = {
          permisoCirculacion:   { archivo: null, desde: '', hasta: '' },
          seguroCarga:          { archivo: null, desde: '', hasta: '' },
          padron:               { archivo: null, desde: '', hasta: '' },
          soap:                 { archivo: null, desde: '', hasta: '' },
          certificadoEmision:   { archivo: null, desde: '', hasta: '' }
        };
        migrado = true;
      }
      if (!t.conductor) {
        t.conductor = { nombre: '', rut: '', telefono: '', licencia: '', archivoLicencia: null, archivoCarne: null };
        migrado = true;
      }
      if (!t.dimensiones) {
        t.dimensiones = { largo: 0, ancho: 0, alto: 0 };
        migrado = true;
      }
      if (!t.modelo) { t.modelo = ''; migrado = true; }
      if (!t.anio) { t.anio = 2020; migrado = true; }
      if (!t.comuna) { t.comuna = ''; migrado = true; }
      if (!t.region) { t.region = ''; migrado = true; }
    });
  }
  
  // Migración: Administrador de Tarifas Transporte (Pantalla 1)
  if (!parsed.tariffConfig || !parsed.tariffConfig.length) {
    parsed.tariffConfig = [{ id: 'global', data: defaultTariffConfig() }];
    migrado = true;
  } else {
    // Fusión superficial con valores por defecto para llenar claves nuevas
    const def = defaultTariffConfig();
    const cfg = parsed.tariffConfig[0].data || {};
    Object.keys(def).forEach(k => {
      if (cfg[k] === undefined) { cfg[k] = def[k]; migrado = true; }
    });
    if (!cfg.variables) cfg.variables = def.variables;
    Object.keys(def.variables).forEach(k => {
      if (cfg.variables[k] === undefined) { cfg.variables[k] = def.variables[k]; migrado = true; }
    });
    parsed.tariffConfig[0].data = cfg;
  }

  // Migración: Administrador de Tarifas Clientes (Pantalla 2)
  if (!parsed.clientTariffConfig || !parsed.clientTariffConfig.length) {
    parsed.clientTariffConfig = [{ id: 'global', data: defaultClientTariffConfig() }];
    migrado = true;
  } else {
    const def = defaultClientTariffConfig();
    const cfg = parsed.clientTariffConfig[0].data || {};
    Object.keys(def).forEach(k => {
      if (cfg[k] === undefined) { cfg[k] = def[k]; migrado = true; }
    });
    parsed.clientTariffConfig[0].data = cfg;
  }

  if (migrado) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }

  return parsed;
}

// Atajo: obtener/guardar la configuración de Tarifas Transporte (Pantalla 1)
export function getTariffConfig(db) {
  if (!db.tariffConfig || !db.tariffConfig.length) {
    db.tariffConfig = [{ id: 'global', data: defaultTariffConfig() }];
  }
  return db.tariffConfig[0].data;
}

// Atajo: obtener/guardar la configuración de Tarifas Clientes (Pantalla 2)
export function getClientTariffConfig(db) {
  if (!db.clientTariffConfig || !db.clientTariffConfig.length) {
    db.clientTariffConfig = [{ id: 'global', data: defaultClientTariffConfig() }];
  }
  return db.clientTariffConfig[0].data;
}

// Obtener el nombre de un Centro Logístico a partir de su ID
export function getCentreName(db, centreId) {
  const cd = db.logisticsCentres.find(c => c.id === centreId);
  return cd ? cd.nombre : '(centro eliminado)';
}

// Guardar: memoria + respaldo local + sincronización con Supabase
export function saveDatabase(data) {
  deriveCamionesChoferes(data);
  memoryDb = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  // Despachar un evento personalizado para actualizar las vistas en tiempo real
  window.dispatchEvent(new Event('db_updated'));
  // Sincronizar con el servidor en segundo plano
  syncToSupabase(data).catch(err => {
    console.error('Error al sincronizar con Supabase:', err.message || err);
    window.dispatchEvent(new CustomEvent('db_sync_error', { detail: err.message || String(err) }));
  });
}

// Resetear base de datos a los valores predeterminados
export function resetDatabase() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
  window.dispatchEvent(new Event('db_updated'));
  return defaultData;
}
// fin de data.js
