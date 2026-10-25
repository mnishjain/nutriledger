// Storage, migration, backup/restore and profile-isolation tests against the real Store class (fake-indexeddb).
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDB, MIGRATIONS } from '../../js/store/db.js';
import { validateBackup } from '../../js/store/validate.js';
import { LEGACY_KEY } from '../../js/store/legacy.js';
import { getBuiltin } from '../../js/core/library.js';
import { makeItem, makeFoodEntry, makeMeal } from '../../js/core/entries.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/legacy-v2-anonymised.json', import.meta.url)));
let n = 0; const fresh = () => openDB(`test-${process.pid}-${n++}`);
const fakeLS = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null), setItem() { throw new Error('must never write'); }, removeItem() { throw new Error('must never delete'); } });
const entryFor = (pid, date, id = 'f:apple', g = 150) => makeFoodEntry({ profileId: pid, date, slot: 'Snacks', item: makeItem(getBuiltin(id), { grams: g }) });

test('persistence: data survives closing and reopening the database', async () => {
  const name = `persist-${process.pid}`;
  let s = await openDB(name);
  await s.put('profiles', { id: 'p1', name: 'A' });
  await s.addEntries([entryFor('p1', '2026-10-25')]);
  s.db.close();
  s = await openDB(name);
  assert.equal((await s.entriesOn('p1', '2026-10-25')).length, 1);
  assert.equal((await s.get('profiles', 'p1')).name, 'A');
});

test('migration: legacy v2 data is imported non-destructively, once', async () => {
  const s = await fresh();
  const ls = fakeLS({ [LEGACY_KEY]: JSON.stringify(fixture) });
  const r = await s.importLegacyIfNeeded(ls);
  assert.equal(r.status, 'imported');
  assert.equal(r.counts.entries, 5); assert.equal(r.counts.meals, 1); assert.equal(r.counts.weights, 1, 'duplicate same-day weight collapsed');
  assert.equal(r.counts.foods, 1, 'only the genuinely custom food is kept');
  assert.equal(r.report.duplicateFoodIds.length, 3, 'f25/f26/f27 collisions detected');
  const pid = (await s.meta('activeProfileId'));
  const e = await s.entriesOn(pid, '2026-10-20');
  assert.equal(e.length, 4);
  const whey = e.find((x) => x.name.startsWith('Whey'));
  assert.equal(whey.n.kcal, 240); assert.equal(whey.n.protein, 48); assert.equal(whey.items[0].grams, 60);
  assert.equal(whey.n.sodium, null, 'unknown in old data stays unknown');
  const kadhi = (await s.entriesOn(pid, '2026-10-21'))[0];
  assert.equal(kadhi.n.sodium, 450); assert.equal(kadhi.n.fibre, 2);
  const prof = await s.get('profiles', pid);
  assert.deepEqual(prof.overrides, {}, 'old default goals replaced by calculated targets');
  const again = await s.importLegacyIfNeeded(ls);
  assert.equal(again.status, 'imported');
  assert.equal((await s.entriesOn(pid, '2026-10-20')).length, 4, 'not imported twice');
});

test('migration: unreadable old data is preserved, not overwritten', async () => {
  const s = await fresh();
  const r = await s.importLegacyIfNeeded(fakeLS({ [LEGACY_KEY]: '{"profiles":[{"id":"p1"' }));
  assert.equal(r.status, 'unreadable');
  assert.ok(r.raw.startsWith('{"profiles"'));
  assert.equal((await s.counts()).entries, 0);
});

test('migration: no old data → nothing happens', async () => {
  const s = await fresh();
  assert.equal((await s.importLegacyIfNeeded(fakeLS({}))).status, 'none');
});

test('schema migration framework upgrades an existing v1 database without losing data', async () => {
  const name = `schema-${process.pid}`;
  let s = await openDB(name);
  await s.put('profiles', { id: 'p1', name: 'Keep me' });
  s.db.close();
  const v2 = [...MIGRATIONS, (db, tx) => { db.createObjectStore('water', { keyPath: 'id' }); tx.objectStore('profiles').put({ id: 'p2', name: 'added by migration' }); }];
  s = await openDB(name, { migrations: v2 });
  assert.equal(s.db.version, 2);
  assert.ok(s.db.objectStoreNames.contains('water'));
  assert.equal((await s.get('profiles', 'p1')).name, 'Keep me');
  assert.equal((await s.get('profiles', 'p2')).name, 'added by migration');
});

test('backup → restore round trip is lossless', async () => {
  const a = await fresh();
  await a.put('profiles', { id: 'p1', name: 'A', sex: 'male', age: 47, heightCm: 168, weightKg: 72, activity: 'light', goal: 'lose' });
  await a.addEntries([entryFor('p1', '2026-10-24'), entryFor('p1', '2026-10-25', 'd:chapati', 80)]);
  await a.put('meals', makeMeal({ profileId: 'p1', name: 'Snack', items: [makeItem(getBuiltin('f:peanuts'), { grams: 20 })] }));
  await a.put('weights', { id: 'w1', profileId: 'p1', date: '2026-10-25', kg: 72.1 });
  await a.put('days', { id: 'p1|2026-10-24', profileId: 'p1', date: '2026-10-24', complete: true });
  await a.setMeta('activeProfileId', 'p1');
  const file = JSON.parse(JSON.stringify(await a.exportAll()));
  const b = await fresh();
  const v = validateBackup(file);
  assert.ok(v.ok, v.error);
  await b.importValidated(v, 'replace');
  for (const st of ['profiles', 'entries', 'meals', 'weights', 'days']) {
    const x = (await a.all(st)).sort((p, q) => p.id.localeCompare(q.id)); const y = (await b.all(st)).sort((p, q) => p.id.localeCompare(q.id));
    assert.equal(y.length, x.length, st);
    if (st === 'entries') for (let i = 0; i < x.length; i++) { assert.equal(y[i].n.kcal, x[i].n.kcal); assert.equal(y[i].date, x[i].date); }
  }
});

test('restore rejects bad files and strips unsafe content', async () => {
  assert.equal(validateBackup({ hello: 1 }).ok, false);
  assert.equal(validateBackup({ format: 'nutriledger-backup', version: 99, data: {} }).ok, false);
  const v = validateBackup({ format: 'nutriledger-backup', version: 3, data: {
    profiles: [{ id: 'p1', name: '<img src=x onerror=alert(1)>'.repeat(10) }],
    entries: [{ id: 'e1', profileId: 'p1', date: '2026-13-45', items: [{ n: { kcal: 1 } }] }, { id: 'e2', profileId: 'ghost', date: '2026-10-01', items: [{ n: { kcal: 1 } }] }, { id: 'e3', profileId: 'p1', date: '2026-10-01', items: [{ name: 'ok', n: { kcal: '50', protein: 'x' } }] }],
    weights: [{ profileId: 'p1', date: '2026-10-01', kg: 'abc' }],
  } });
  assert.ok(v.ok);
  assert.ok(v.data.profiles[0].name.length <= 40);
  assert.equal(v.data.entries.length, 1, 'invalid date and orphaned profile rejected');
  assert.equal(v.data.entries[0].items[0].n.kcal, 50); assert.equal(v.data.entries[0].items[0].n.protein, null);
  assert.equal(v.data.weights.length, 0);
});

test('merge import keeps newer local edits', async () => {
  const s = await fresh();
  await s.put('profiles', { id: 'p1', name: 'Newer', updatedAt: 2000 });
  const v = validateBackup({ format: 'nutriledger-backup', version: 3, data: { profiles: [{ id: 'p1', name: 'Older', updatedAt: 1000 }, { id: 'p2', name: 'New', updatedAt: 1000 }] } });
  await s.importValidated(v, 'merge');
  assert.equal((await s.get('profiles', 'p1')).name, 'Newer');
  assert.equal((await s.get('profiles', 'p2')).name, 'New');
});

test('profile isolation: entries, meals, weights never leak; deletion cascades only that profile', async () => {
  const s = await fresh();
  await s.putMany('profiles', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  await s.addEntries([entryFor('a', '2026-10-25'), entryFor('a', '2026-10-25'), entryFor('b', '2026-10-25')]);
  await s.put('meals', makeMeal({ profileId: 'a', name: 'A meal', items: [makeItem(getBuiltin('f:apple'), { grams: 100 })] }));
  await s.put('weights', { id: 'wb', profileId: 'b', date: '2026-10-25', kg: 60 });
  assert.equal((await s.entriesOn('a', '2026-10-25')).length, 2);
  assert.equal((await s.entriesOn('b', '2026-10-25')).length, 1);
  assert.equal((await s.byProfile('meals', 'b')).length, 0);
  await s.deleteProfile('a');
  assert.equal((await s.entriesOn('a', '2026-10-25')).length, 0);
  assert.equal((await s.byProfile('meals', 'a')).length, 0);
  assert.equal((await s.entriesOn('b', '2026-10-25')).length, 1);
  assert.equal((await s.byProfile('weights', 'b')).length, 1);
});

test('snapshots: automatic safety copy and restore after accidental deletion', async () => {
  const s = await fresh();
  await s.put('profiles', { id: 'p1', name: 'A' });
  await s.addEntries([entryFor('p1', '2026-10-25')]);
  const id = await s.snapshot('test');
  await s.deleteProfile('p1');
  assert.equal((await s.counts()).entries, 0);
  await s.restoreSnapshot(id);
  assert.equal((await s.counts()).entries, 1);
  for (let i = 0; i < 10; i++) await s.snapshot('x');
  assert.ok((await s.listSnapshots()).length <= 7);
});

test('transactions are atomic: a failing write leaves no partial data', async () => {
  const s = await fresh();
  await assert.rejects(s.run(['entries'], 'readwrite', async (o) => { o.entries.put({ id: 'ok', profileId: 'p', date: '2026-10-25' }); o.entries.put({ notAnId: true }); }));
  assert.equal((await s.counts()).entries, 0);
});

test('owner real backup (local only, not in repo) migrates correctly if present', async (t) => {
  const p = '/home/claude/private/real-backup-2026-10-25.json';
  if (!fs.existsSync(p)) return t.skip('private file not present');
  const real = JSON.parse(fs.readFileSync(p, 'utf8'));
  const v = validateBackup(real);
  assert.ok(v.ok);
  assert.equal(v.counts.entries, real.entries.length);
  const sumOld = real.entries.reduce((a, e) => a + e.k, 0);
  const sumNew = v.data.entries.reduce((a, e) => a + e.n.kcal, 0);
  assert.equal(sumNew, sumOld, 'calories identical after migration');
  assert.equal(v.report.duplicateFoodIds.length, 3);
});

import { importFromSiblingDb } from '../../js/store/db.js';
test('beta → live copy: single profiles merge into one person, entries copied once, source untouched', async () => {
  const beta = await openDB(`nutriledger-beta-${process.pid}`);
  await beta.put('profiles', { id: 'p-beta', name: 'Manish', sex: 'male', age: 47, heightCm: 170, weightKg: 71, activity: 'moderate', goal: 'lose', updatedAt: 5 });
  await beta.addEntries([entryFor('p-beta', '2026-10-25'), entryFor('p-beta', '2026-10-25', 'd:chapati', 80)]);
  await beta.put('weights', { id: 'w-p-beta|2026-10-25', profileId: 'p-beta', date: '2026-10-25', kg: 71 });
  const live = await fresh();
  await live.put('profiles', { id: 'p-p1', name: 'MJ', sex: 'male', age: 47, heightCm: 168, weightKg: 72, activity: 'light', goal: 'lose', updatedAt: 1, createdAt: 1 });
  await live.addEntries([entryFor('p-p1', '2026-10-20')]);
  const r = await importFromSiblingDb(live, beta.name);
  assert.equal(r.status, 'imported');
  const profs = await live.all('profiles');
  assert.equal(profs.length, 1, 'no duplicate person');
  assert.equal(profs[0].id, 'p-p1'); assert.equal(profs[0].heightCm, 170, 'newer beta settings win');
  assert.equal((await live.entriesOn('p-p1', '2026-10-25')).length, 2);
  assert.equal((await live.entriesOn('p-p1', '2026-10-20')).length, 1, 'existing live data kept');
  assert.equal((await live.byProfile('weights', 'p-p1')).length, 1);
  assert.equal((await beta.counts()).entries, 2, 'beta untouched');
  assert.equal((await importFromSiblingDb(live, beta.name)).status, 'imported', 'second call is a no-op');
  assert.equal((await live.entriesOn('p-p1', '2026-10-25')).length, 2, 'not copied twice');
});
test('beta → live copy: nothing to copy when the beta database does not exist', async () => {
  const live = await fresh();
  assert.equal((await importFromSiblingDb(live, 'does-not-exist-db')).status, 'none');
});
