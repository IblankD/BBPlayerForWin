import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLibrary, validateSession } from './core.mjs';

export const SCHEMA_VERSION = 1;
function checkVersion(input) {
  if (input?.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    const error = new Error('数据由其他版本创建，请使用对应版本打开，原文件已保留');
    error.code = 'SCHEMA_VERSION'; throw error;
  }
}
export function decodeLibrary(input) { checkVersion(input); return validateLibrary(input); }
export function decodeSession(input) { checkVersion(input); return validateSession(input); }
export const encodeSession = input => JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...validateSession(input) });
const encodeLibrary = input => JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...validateLibrary(input) });
const snapshotName = /^library-\d{13}-[\da-f-]{36}\.json$/;

// All calls are serialized by the main process write queue.
export class LibraryStorage {
  constructor(directory, defaults, now = Date.now) {
    this.directory = directory; this.defaults = defaults; this.now = now; this.lastBackup = 0; this.current = null;
    this.backups = path.join(directory, 'backups'); this.file = path.join(directory, 'library.json');
  }
  async atomic(content) {
    await mkdir(this.directory, { recursive: true });
    await writeFile(`${this.file}.tmp`, content);
    await rename(`${this.file}.tmp`, this.file);
  }
  async list() {
    let names;
    try { names = await readdir(this.backups); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const results = [];
    for (const id of names.filter(name => snapshotName.test(name)).sort().reverse()) {
      try {
        const value = decodeLibrary(JSON.parse(await readFile(path.join(this.backups, id), 'utf8')));
        results.push({ id, createdAt: Number(id.split('-')[1]), playlists: value.playlists.length, tracks: value.playlists.reduce((sum, p) => sum + p.tracks.length, 0) });
      } catch { /* Keep unreadable files for manual recovery, but never offer them for restore. */ }
    }
    return results;
  }
  async backup(value = this.current) {
    if (!value) throw new Error('歌单尚未载入');
    await mkdir(this.backups, { recursive: true });
    const previous = await this.list();
    const timestamp = Math.max(this.now(), (previous[0]?.createdAt || 0) + 1);
    const id = `library-${timestamp}-${randomUUID()}.json`;
    await writeFile(path.join(this.backups, id), encodeLibrary(value), { flag: 'wx' });
    this.lastBackup = this.now();
    const snapshots = await this.list();
    for (const old of snapshots.slice(10)) await unlink(path.join(this.backups, old.id));
    return id;
  }
  async load() {
    let notice = '';
    let raw;
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'));
      this.current = decodeLibrary(raw);
    } catch (error) {
      if (error.code === 'SCHEMA_VERSION') throw error;
      raw = null;
      if (error.code === 'ENOENT') { this.current = this.defaults(); await this.atomic(encodeLibrary(this.current)); }
      else {
        // Move must succeed before a replacement can be written.
        await rename(this.file, path.join(this.directory, `library-corrupt-${this.now()}-${randomUUID()}.json`));
        const latest = (await this.list())[0];
        this.current = latest ? decodeLibrary(JSON.parse(await readFile(path.join(this.backups, latest.id), 'utf8'))) : this.defaults();
        await this.atomic(encodeLibrary(this.current));
        notice = latest ? '歌单文件损坏，已从最近的自动备份恢复。原文件已保留。' : '歌单文件无法读取，原文件已保留。可在设置中导入 JSON 备份。';
      }
    }
    if (raw && this.current) {
      await this.backup();
      if (raw.schemaVersion === undefined) { await this.atomic(encodeLibrary(this.current)); notice = '旧版歌单已迁移，并创建自动备份。'; }
    }
    return { library: this.current, notice };
  }
  async save(value, forceBackup = false) {
    const next = decodeLibrary(value);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    if (this.current && (forceBackup || this.now() - this.lastBackup >= 5 * 60000)) await this.backup();
    await this.atomic(encodeLibrary(next)); this.current = next;
  }
  async restore(id) {
    if (typeof id !== 'string' || !snapshotName.test(id)) throw new Error('备份名称无效');
    const value = decodeLibrary(JSON.parse(await readFile(path.join(this.backups, id), 'utf8')));
    // Preserve the state being replaced, even if the target matches it.
    await this.backup(); await this.atomic(encodeLibrary(value)); this.current = value;
    await this.backup();
    return value;
  }
}
