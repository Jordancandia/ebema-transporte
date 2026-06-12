// Capa de datos de SIT EBEMA
// Fuente principal: Supabase (PostgreSQL compartido, protegido con RLS).
// localStorage se mantiene como copia local de respaldo (modo sin conexión).
import { supabase } from './supabase-client.js';

const STORAGE_KEY = 'ebema_transporte_db';

// Mapeo colección local ↔ tabla Supabase (con su clave primaria)
const TABLE_MAP = [
  { local: 'logisticsCentres', table: 'logistics_centres', pk: 'id' },
  { local: 'routes',           table: 'routes',            pk: 'id' },
  { local: 'truckTypes',       table: 'truck_types',       pk: 'type' },
  { local: 'transports',       table: 'transports',        pk: 'id' },
  { local: 'quotesHistory',    table: 'quotes_history',    pk: 'id' },
  { local: 'users',            table: 'app_users',         pk: 'email' }
];

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
      idCentroSap: 'CD100',
      lat: -33.3768,
      lon: -70.8354
    },
    {
      id: 'cd2',
      nombre: 'CD Concepción',
      direccion: 'Ruta 160 Km 12, Coronel, Región del Biobío',
      idCentroSap: 'CD200',
      lat: -36.9015,
      lon: -73.1168
    },
    {
      id: 'cd3',
      nombre: 'CD Temuco',
      direccion: 'Av. Recabarren 02500, Temuco, Región de La Araucanía',
      idCentroSap: 'CD300',
      lat: -38.7490,
      lon: -72.6360
    }
  ],

  // 5. Configuración de Tarifas (Matriz)
  // Define los costos base y costo por KM para cada categoría de Camión
  truckTypes: [
    { type: 'Sencillo', capacityTons: '5 - 10 Tons', baseRate: 45000, ratePerKm: 1200 },
    { type: 'Doble Puente', capacityTons: '11 - 18 Tons', baseRate: 75000, ratePerKm: 1800 },
    { type: 'Rampla', capacityTons: '19 - 30 Tons', baseRate: 120000, ratePerKm: 2500 }
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
        const dcd = defaultData.logisticsCentres.find(item => item.idCentroSap === cd.idCentroSap);
        cd.lat = dcd ? dcd.lat : -33.4489;
        cd.lon = dcd ? dcd.lon : -70.6693;
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
  
  if (migrado) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }
  
  return parsed;
}

// Obtener el nombre de un Centro Logístico a partir de su ID
export function getCentreName(db, centreId) {
  const cd = db.logisticsCentres.find(c => c.id === centreId);
  return cd ? cd.nombre : '(centro eliminado)';
}

// Guardar: memoria + respaldo local + sincronización con Supabase
export function saveDatabase(data) {
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
