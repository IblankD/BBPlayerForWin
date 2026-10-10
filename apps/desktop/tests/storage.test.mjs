import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LibraryStorage, decodeSession, encodeSession } from '../electron/storage.mjs';

const track = { bvid: 'BV1GJ411x7h7', title: '测试歌曲', artist: '作者', cover: '', duration: 212, cid: 123 };
const legacy = () => ({ playlists: [{ id: 'liked', name: '我喜欢的音乐', tracks: [track] }], history: [track], lyrics: { [track.bvid]: '[00:01]歌词' }, volume: .42, repeat: 'one' });
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bbplayer-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = 1800000000000;
  return { directory, storage: new LibraryStorage(directory, legacy, () => time), advance: () => { time += 300001; } };
}
test('legacy migration preserves playlists, history, lyrics and settings with a versioned backup', async t => {
  const { directory, storage } = await fixture(t);
  await writeFile(path.join(directory, 'library.json'), JSON.stringify(legacy()));
  const result = await storage.load(); assert.match(result.notice, /迁移/); assert.deepEqual(result.library, legacy());
  assert.deepEqual(JSON.parse(await readFile(storage.file)), { schemaVersion: 1, ...legacy() });
  assert.equal((await storage.list()).length, 1);
  const session = { queue: [track], current: track, position: 67, shuffle: true, view: 'liked', closeBehavior: 'tray' };
  assert.deepEqual(decodeSession(JSON.parse(encodeSession(session))), session);
});
test('corrupt library automatically recovers the newest valid backup and preserves its original', async t => {
  const { directory, storage } = await fixture(t);
  await storage.load(); await storage.backup();
  await writeFile(storage.file, '{broken');
  const result = await new LibraryStorage(directory, legacy).load();
  assert.match(result.notice, /已从最近/); assert.deepEqual(result.library, legacy());
  const corrupt = (await readdir(directory)).find(name => name.startsWith('library-corrupt-'));
  assert.equal(await readFile(path.join(directory, corrupt), 'utf8'), '{broken');
});
test('unsupported schema refuses to overwrite or quarantine the original', async t => {
  const { storage } = await fixture(t); const original = JSON.stringify({ ...legacy(), schemaVersion: 99 });
  await writeFile(storage.file, original); await assert.rejects(storage.load(), /对应版本/);
  assert.equal(await readFile(storage.file, 'utf8'), original); assert.deepEqual(await storage.list(), []);
  assert.throws(() => decodeSession({ schemaVersion: 99 }), /对应版本/);
});
test('automatic backup interval and retention avoid autosave floods; restore preserves replaced data', async t => {
  const { storage, advance } = await fixture(t); await storage.load();
  await storage.save({ ...legacy(), volume: .2 }); assert.equal((await storage.list()).length, 1);
  await storage.save({ ...legacy(), volume: .3 }); assert.equal((await storage.list()).length, 1);
  for (let i = 0; i < 12; i++) { advance(); await storage.save({ ...legacy(), volume: i / 100 }); }
  assert.equal((await storage.list()).length, 10);
  const id = (await storage.list()).at(-1).id; const replaced = storage.current;
  advance(); await storage.restore(id);
  assert.notDeepEqual(storage.current, replaced);
  const newest = (await storage.list())[1];
  const backedUp = JSON.parse(await readFile(path.join(storage.backups, newest.id)));
  assert.equal(backedUp.volume, replaced.volume);
  await assert.rejects(storage.restore('../library.json'), /名称无效/);
});
