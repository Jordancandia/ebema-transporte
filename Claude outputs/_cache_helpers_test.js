const CACHE_DB    = 'sit_ebema_cache';
const CACHE_STORE = 'tablas';

function _openCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function _cacheGet(key) {
  try {
    const db = await _openCacheDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch (_e) { return null; }
}

async function _cachePut(key, value) {
  try {
    const db = await _openCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
    });
  } catch (e) { console.warn('Caché IDB no disponible:', e.message || e); }
}

async function _getRemoteVersions() {
  try {
    const { data, error } = await supabase.from('data_version').select('tabla,version');
    if (error) throw error;
    const m = {};
    (data || []).forEach(r => { m[r.tabla] = r.version; });
    return m;
  } catch (e) {
    console.warn('data_version no disponible, se descarga sin caché:', e.message || e);
    return null;
  }
}

async function _cacheUid() {
  try { return (await supabase.auth.getSession()).data?.session?.user?.id || null; }
  catch (_e) { return null; }
}

// Devuelve las filas de la caché si la versión coincide; si no, descarga con fetcher()
// y guarda una copia (clonada ANTES de que la app mute las filas en memoria).
async function fetchCached(table, fetcher, versions, uid, force = false) {
  const remoteV = versions && versions[table];
  const key = uid ? `${uid}:${table}` : null;
  if (!force && remoteV && key) {
    const c = await _cacheGet(key);
    if (c && c.version === remoteV && Array.isArray(c.rows)) {
      console.info(`[cache] ${table}: ${c.rows.length} filas desde caché local (sin descarga)`);
      return c.rows;
    }
  }
  const rows = await fetcher();
  if (remoteV && key) {
    let copy = null;
    try { copy = structuredClone(rows); } catch (_e) { copy = null; }
    if (copy) _cachePut(key, { version: remoteV, rows: copy, savedAt: Date.now() });
  }
  console.info(`[cache] ${table}: ${rows.length} filas descargadas de Supabase`);
  return rows;
}


