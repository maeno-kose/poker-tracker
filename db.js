/* Minimal IndexedDB wrapper for Poker Hand Tracker */
(function (global) {
  const DB_NAME = 'poker-tracker';
  const DB_VERSION = 1;
  let _dbPromise = null;

  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('startTime', 'startTime', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(storeNames, mode) {
    return open().then((db) => {
      const t = db.transaction(storeNames, mode);
      const stores = {};
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      names.forEach((n) => { stores[n] = t.objectStore(n); });
      return { t, stores };
    });
  }

  function reqAsPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ----- Settings -----
  async function getSetting(key, fallback) {
    const { stores } = await tx('settings', 'readonly');
    const r = await reqAsPromise(stores.settings.get(key));
    return r ? r.value : fallback;
  }
  async function setSetting(key, value) {
    const { stores, t } = await tx('settings', 'readwrite');
    stores.settings.put({ key, value });
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  // ----- Sessions -----
  async function addSession(session) {
    const { stores, t } = await tx('sessions', 'readwrite');
    const r = stores.sessions.add(session);
    await new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    return r.result;
  }
  async function putSession(session) {
    const { stores, t } = await tx('sessions', 'readwrite');
    stores.sessions.put(session);
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function getSession(id) {
    const { stores } = await tx('sessions', 'readonly');
    return reqAsPromise(stores.sessions.get(id));
  }
  async function deleteSession(id) {
    const { stores, t } = await tx('sessions', 'readwrite');
    stores.sessions.delete(id);
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function listSessions() {
    const { stores } = await tx('sessions', 'readonly');
    return reqAsPromise(stores.sessions.getAll());
  }
  async function findActiveSession() {
    const all = await listSessions();
    return all.find((s) => s.status === 'active') || null;
  }

  // ----- Export / Import -----
  async function exportAll() {
    const sessions = await listSessions();
    const { stores } = await tx('settings', 'readonly');
    const settings = await reqAsPromise(stores.settings.getAll());
    return {
      app: 'poker-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings, sessions,
    };
  }
  async function importAll(payload, { merge = false } = {}) {
    if (!payload || payload.app !== 'poker-tracker') throw new Error('不正な形式');
    const { stores, t } = await tx(['sessions', 'settings'], 'readwrite');
    if (!merge) {
      stores.sessions.clear();
      stores.settings.clear();
    }
    (payload.settings || []).forEach((s) => stores.settings.put(s));
    (payload.sessions || []).forEach((s) => {
      // when merging, drop id so we don't collide
      if (merge) { const copy = { ...s }; delete copy.id; stores.sessions.add(copy); }
      else stores.sessions.put(s);
    });
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function wipeAll() {
    const { stores, t } = await tx(['sessions', 'settings'], 'readwrite');
    stores.sessions.clear();
    stores.settings.clear();
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  global.DB = {
    getSetting, setSetting,
    addSession, putSession, getSession, deleteSession,
    listSessions, findActiveSession,
    exportAll, importAll, wipeAll,
  };
})(window);
