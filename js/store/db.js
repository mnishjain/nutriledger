// IndexedDB storage with versioned migrations and transactional writes.
// Data lives only on this device/browser; it is NOT a backup. Exports are the backup.
import { FORMAT, FORMAT_VERSION, validateBackup, STORES_IN_BACKUP } from './validate.js';
import { LEGACY_KEY } from './legacy.js';

export const DB_VERSION = 1;

/** Migrations: index i upgrades the database from version i to i+1. Append only; never edit old steps. */
export const MIGRATIONS = [
  (db) => {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('profiles', { keyPath: 'id' });
    db.createObjectStore('foods', { keyPath: 'id' });
    const meals = db.createObjectStore('meals', { keyPath: 'id' }); meals.createIndex('profileId', 'profileId');
    const ent = db.createObjectStore('entries', { keyPath: 'id' }); ent.createIndex('profileId', 'profileId'); ent.createIndex('profileDate', ['profileId', 'date']);
    const w = db.createObjectStore('weights', { keyPath: 'id' }); w.createIndex('profileId', 'profileId');
    const d = db.createObjectStore('days', { keyPath: 'id' }); d.createIndex('profileId', 'profileId');
    const s = db.createObjectStore('stats', { keyPath: 'id' }); s.createIndex('profileId', 'profileId');
    db.createObjectStore('portions', { keyPath: 'id' });
    db.createObjectStore('snapshots', { keyPath: 'id' });
  },
];

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });

export class StorageError extends Error {
  constructor(message, cause) { super(message); this.name = 'StorageError'; this.cause = cause; }
}
function friendly(e) {
  const name = e?.name || '';
  if (name === 'QuotaExceededError') return new StorageError('Phone storage for this app is full. Export a backup, then free up space.', e);
  if (name === 'InvalidStateError') return new StorageError('The database was closed (often after an update). Close and reopen the app.', e);
  return new StorageError(`Saving failed: ${e?.message || name || 'unknown error'}`, e);
}

export async function openDB(name, { idb = globalThis.indexedDB, migrations = MIGRATIONS, version = migrations.length } = {}) {
  if (!idb) throw new StorageError('This browser does not support IndexedDB storage.');
  const open = idb.open(name, version);
  open.onupgradeneeded = (ev) => {
    const db = open.result; const tx = open.transaction;
    for (let v = ev.oldVersion; v < version; v++) migrations[v](db, tx, v);
  };
  const db = await new Promise((res, rej) => {
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(friendly(open.error));
    open.onblocked = () => rej(new StorageError('Another NutriLedger tab is open with an older version. Close it and reopen.'));
  });
  db.onversionchange = () => { db.close(); };
  return new Store(db, name);
}

export class Store {
  constructor(db, name) { this.db = db; this.name = name; this.listeners = new Set(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch { /* ignore */ } } }

  async run(stores, mode, fn) {
    let tx;
    try { tx = this.db.transaction(stores, mode); } catch (e) { throw friendly(e); }
    const os = Object.fromEntries((Array.isArray(stores) ? stores : [stores]).map((s) => [s, tx.objectStore(s)]));
    let result;
    try {
      result = await fn(os, tx);
      await done(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw e instanceof StorageError ? e : friendly(e);
    }
    if (mode === 'readwrite') this.emit(stores);
    return result;
  }
  get(store, id) { return this.run(store, 'readonly', (o) => req(o[store].get(id))); }
  all(store) { return this.run(store, 'readonly', (o) => req(o[store].getAll())); }
  byProfile(store, pid) { return this.run(store, 'readonly', (o) => req(o[store].index('profileId').getAll(pid))); }
  put(store, rec) { return this.run(store, 'readwrite', (o) => req(o[store].put(rec)).then(() => rec)); }
  putMany(store, recs) { return this.run(store, 'readwrite', async (o) => { for (const r of recs) o[store].put(r); return recs.length; }); }
  del(store, id) { return this.run(store, 'readwrite', (o) => req(o[store].delete(id))); }
  async meta(key, fallback = null) { const r = await this.get('meta', key); return r ? r.value : fallback; }
  setMeta(key, value) { return this.put('meta', { key, value }); }

  entriesOn(pid, date) { return this.run('entries', 'readonly', (o) => req(o.entries.index('profileDate').getAll([pid, date]))); }
  entriesBetween(pid, from, to) { return this.run('entries', 'readonly', (o) => req(o.entries.index('profileDate').getAll(IDBKeyRange.bound([pid, from], [pid, to])))); }

  /** Add an entry and bump personal food statistics in one transaction. */
  addEntries(entries, statUpdates = []) {
    return this.run(['entries', 'stats'], 'readwrite', async (o) => {
      for (const e of entries) o.entries.put(e);
      for (const s of statUpdates) {
        const cur = await req(o.stats.get(s.id));
        o.stats.put({ ...(cur || { id: s.id, profileId: s.profileId, foodId: s.foodId, count: 0 }), ...s, count: (cur?.count || 0) + 1, lastUsed: Date.now() });
      }
      return entries;
    });
  }

  /** Delete a profile and everything that belongs to it, atomically. */
  deleteProfile(pid) {
    return this.run(['profiles', 'meals', 'entries', 'weights', 'days', 'stats'], 'readwrite', async (o) => {
      for (const s of ['meals', 'entries', 'weights', 'days', 'stats']) {
        const keys = await req(o[s].index('profileId').getAllKeys(pid));
        for (const k of keys) o[s].delete(k);
      }
      o.profiles.delete(pid);
    });
  }

  async exportAll() {
    const data = {};
    await this.run(STORES_IN_BACKUP, 'readonly', async (o) => { for (const s of STORES_IN_BACKUP) data[s] = await req(o[s].getAll()); });
    return { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), app: 'NutriLedger', activeProfileId: await this.meta('activeProfileId'), data };
  }
  async counts() {
    const c = {};
    await this.run(STORES_IN_BACKUP, 'readonly', async (o) => { for (const s of STORES_IN_BACKUP) c[s] = await req(o[s].count()); });
    return c;
  }

  /**
   * Import a validated backup. mode 'replace' wipes app data first (after a safety snapshot);
   * 'merge' keeps existing records and adds/updates by id (newer updatedAt wins).
   */
  async importValidated(v, mode = 'merge') {
    if (!v?.ok) throw new Error(v?.error || 'Invalid backup');
    await this.snapshot('before-import');
    await this.run([...STORES_IN_BACKUP, 'meta'], 'readwrite', async (o) => {
      if (mode === 'replace') for (const s of STORES_IN_BACKUP) o[s].clear();
      for (const s of STORES_IN_BACKUP) {
        for (const r of v.data[s] || []) {
          if (mode === 'merge') {
            const cur = await req(o[s].get(r.id));
            if (cur && (cur.updatedAt || 0) > (r.updatedAt || 0)) continue;
          }
          o[s].put(r);
        }
      }
      if (mode === 'replace' || !(await req(o.meta.get('activeProfileId')))) o.meta.put({ key: 'activeProfileId', value: v.activeProfileId });
    });
    return v.counts;
  }

  /** Internal safety copy inside the same database (protects against mistakes, NOT against data loss). */
  async snapshot(reason = 'auto', keep = 7) {
    const backup = await this.exportAll();
    const id = `${Date.now()}`;
    await this.run('snapshots', 'readwrite', async (o) => {
      o.snapshots.put({ id, at: Date.now(), reason, counts: Object.fromEntries(Object.entries(backup.data).map(([k, v]) => [k, v.length])), backup });
      const keys = (await req(o.snapshots.getAllKeys())).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - keep))) o.snapshots.delete(k);
    });
    return id;
  }
  async listSnapshots() { return (await this.all('snapshots')).map(({ id, at, reason, counts }) => ({ id, at, reason, counts })).sort((a, b) => b.at - a.at); }
  async restoreSnapshot(id) {
    const s = await this.get('snapshots', id);
    if (!s) throw new Error('Snapshot not found');
    return this.importValidated(validateBackup(s.backup), 'replace');
  }
  async autoSnapshotIfDue() {
    const last = await this.meta('lastAutoSnapshot', 0);
    if (Date.now() - last < 20 * 3600 * 1000) return false;
    const c = await this.counts();
    if (!c.entries && !c.profiles) return false;
    await this.snapshot('daily');
    await this.setMeta('lastAutoSnapshot', Date.now());
    return true;
  }

  /**
   * One-time, non-destructive import of NutriLedger v2 data from localStorage.
   * The localStorage copy is never modified or removed.
   */
  async importLegacyIfNeeded(ls = globalThis.localStorage) {
    const already = await this.meta('legacyImport');
    if (already) return already;
    let raw = null;
    try { raw = ls ? ls.getItem(LEGACY_KEY) : null; } catch { raw = null; }
    let result;
    if (!raw) result = { status: 'none', at: Date.now() };
    else {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* unreadable */ }
      const v = parsed ? validateBackup(parsed) : { ok: false, error: 'Old data could not be read' };
      if (!v.ok) result = { status: 'unreadable', at: Date.now(), error: v.error, raw: raw.slice(0, 5_000_000) };
      else {
        await this.importValidated(v, 'merge');
        result = { status: 'imported', at: Date.now(), counts: v.counts, report: v.report };
      }
    }
    await this.setMeta('legacyImport', result);
    return result;
  }
}

/**
 * One-time copy of data from another NutriLedger database on this origin (used to bring beta data into
 * the live app). Profiles are matched by name; with one profile on each side they are treated as the same
 * person and the newer profile settings win. Never modifies or deletes the source database.
 */
export async function importFromSiblingDb(target, sourceName, { idb = globalThis.indexedDB } = {}) {
  const done = await target.meta(`siblingImport:${sourceName}`);
  if (done) return done;
  let names = null;
  try { names = idb.databases ? (await idb.databases()).map((d) => d.name) : null; } catch { names = null; }
  if (!names || !names.includes(sourceName)) { const r = { status: 'none', at: Date.now() }; await target.setMeta(`siblingImport:${sourceName}`, r); return r; }
  const src = await openDB(sourceName, { idb });
  let r;
  try {
    const exp = await src.exportAll();
    const v = validateBackup(exp);
    if (!v.ok || !v.data.entries.length) r = { status: 'empty', at: Date.now() };
    else {
      const mine = await target.all('profiles');
      const map = new Map();
      for (const p of v.data.profiles) {
        const same = mine.find((m) => m.id === p.id) || mine.find((m) => m.name.trim().toLowerCase() === p.name.trim().toLowerCase())
          || (mine.length === 1 && v.data.profiles.length === 1 ? mine[0] : null);
        if (same) map.set(p.id, same.id);
      }
      for (const p of v.data.profiles) if (map.has(p.id)) { const t = mine.find((m) => m.id === map.get(p.id)); Object.assign(p, { ...p, id: t.id, createdAt: t.createdAt, updatedAt: Math.max(p.updatedAt || 0, (t.updatedAt || 0) + 1) }); }
      for (const st of ['meals', 'entries', 'weights', 'days', 'stats']) for (const rec of v.data[st]) if (map.has(rec.profileId)) {
        const np = map.get(rec.profileId);
        if (st === 'days') rec.id = `${np}|${rec.date}`;
        if (st === 'stats') rec.id = `${np}|${rec.foodId}`;
        if (st === 'weights' && rec.id.startsWith('w-')) rec.id = `w-${np}|${rec.date}`;
        rec.profileId = np;
      }
      if (map.has(v.activeProfileId)) v.activeProfileId = map.get(v.activeProfileId);
      await target.importValidated(v, 'merge');
      r = { status: 'imported', at: Date.now(), counts: v.counts };
    }
  } finally { src.db.close(); }
  await target.setMeta(`siblingImport:${sourceName}`, r);
  return r;
}

/** Ask the browser not to evict our storage. Returns 'granted' | 'denied' | 'unsupported'. */
export async function requestPersistence(nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persist) return 'unsupported';
    if (await nav.storage.persisted()) return 'granted';
    return (await nav.storage.persist()) ? 'granted' : 'denied';
  } catch { return 'unsupported'; }
}
export async function storageEstimate(nav = globalThis.navigator) {
  try { return nav?.storage?.estimate ? await nav.storage.estimate() : null; } catch { return null; }
}
