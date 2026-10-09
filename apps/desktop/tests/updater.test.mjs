import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ReleaseUpdater, compareVersions, LATEST_API, RELEASES } from '../electron/updater.mjs';

const bytes = Buffer.from('verified test package');
const digest = createHash('sha256').update(bytes).digest('hex');
const release = () => ({ tag_name: 'v0.1.4', html_url: `${RELEASES}/tag/v0.1.4`, body: 'Release notes', draft: false, prerelease: false, assets: [{ name: 'BBPlayer-0.1.4-x64-Setup.exe', state: 'uploaded', size: bytes.length, digest: `sha256:${digest}`, browser_download_url: `${RELEASES}/download/v0.1.4/BBPlayer-0.1.4-x64-Setup.exe` }] });
async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bbplayer-update-test-'));
  const events = []; const opened = []; const launched = [];
  const updater = new ReleaseUpdater({ version: '0.1.3', directory, notify: value => events.push(value.status), fetcher: async url => url === LATEST_API ? Response.json(release()) : new Response(bytes), openExternal: async url => opened.push(url), prepareInstall: async () => events.push('saved'), launchInstaller: async file => { launched.push(file); events.push('launched'); return ''; }, quit: () => events.push('quit'), ...options });
  return { updater, directory, events, opened, launched };
}
test('semantic version comparison handles multi-digit components and rejects unstable or malformed versions', () => {
  assert.equal(compareVersions('v0.1.10', '0.1.9'), 1); assert.equal(compareVersions('0.2.0', '0.1.99'), 1);
  assert.equal(compareVersions('0.1.3', 'v0.1.3'), 0); assert.equal(compareVersions('0.1.2', '0.1.3'), -1);
  for (const version of ['1.0.0-beta', '01.2.3', '1.2', '../../test', '9999999999999999999999.1.1']) assert.throws(() => compareVersions(version, '0.1.3'));
});
test('update check accepts only this repository release and its matching hashed installer', async () => {
  const { updater } = await fixture();
  assert.equal((await updater.check()).canDownload, true); assert.equal(updater.state.latestVersion, '0.1.4');
  for (const change of [r => { r.html_url = 'https://evil.test/release'; }, r => { r.draft = true; }, r => { r.tag_name = 'v0.1.4-beta'; }]) {
    const r = release(); change(r); const { updater: invalid } = await fixture({ fetcher: async () => Response.json(r) });
    assert.equal((await invalid.check()).status, 'error');
  }
  for (const change of [r => { r.assets[0].digest = ''; }, r => { r.assets[0].browser_download_url = 'https://evil.test/package.exe'; }, r => { r.assets[0].size = 1024 * 1024 * 301; }]) {
    const r = release(); change(r); const { updater: invalid } = await fixture({ fetcher: async () => Response.json(r) });
    assert.equal((await invalid.check()).status, 'available'); assert.equal(invalid.state.canDownload, false);
    await assert.rejects(invalid.download(), /可校验/);
  }
});
test('portable and development builds check versions but cannot download or install automatically', async () => {
  for (const mode of [{ portable: true }, { enabled: false }]) {
    const { updater, opened } = await fixture(mode); await updater.check();
    assert.equal(updater.state.canDownload, false); await assert.rejects(updater.download()); await assert.rejects(updater.install());
    await updater.openRelease(); assert.deepEqual(opened, [`${RELEASES}/tag/v0.1.4`]);
  }
});
test('update download verifies size and SHA256; only explicit install flushes state and launches', async () => {
  const { updater, launched, events } = await fixture();
  await updater.check(); assert.equal((await updater.download()).status, 'ready');
  assert.equal(launched.length, 0); assert.deepEqual(await readFile(updater.readyFile.path), bytes);
  await updater.install(); assert.equal(launched.length, 1); assert.deepEqual(events.slice(-3), ['saved', 'launched', 'quit']);
  await assert.rejects(updater.install());
});
test('wrong checksum and truncated or oversized downloads are removed without launching', async () => {
  for (const content of [Buffer.alloc(bytes.length, 1), bytes.subarray(0, 2), Buffer.concat([bytes, bytes])]) {
    const { updater, directory, launched } = await fixture({ fetcher: async url => url === LATEST_API ? Response.json(release()) : new Response(content) });
    await updater.check(); assert.equal((await updater.download()).status, 'available'); assert.ok(updater.state.error);
    assert.deepEqual(await readdir(directory), []); await assert.rejects(updater.install()); assert.equal(launched.length, 0);
  }
});
test('download follows trusted GitHub asset redirects and rejects foreign hosts before requesting them', async () => {
  for (const target of ['https://release-assets.githubusercontent.com/asset', 'https://github.com.evil.test/asset', 'https://127.0.0.1/package', 'https://user@github.com/package', 'https://github.com:8080/package']) {
    const calls = [];
    const { updater } = await fixture({ fetcher: async url => { calls.push(url); return url === LATEST_API ? Response.json(release()) : url === target ? new Response(bytes) : new Response(null, { status: 302, headers: { location: target } }); } });
    await updater.check(); const result = await updater.download();
    if (target.includes('release-assets.githubusercontent.com')) assert.equal(result.status, 'ready');
    else { assert.equal(result.status, 'available'); assert.equal(calls.includes(target), false); }
  }
});
test('installation rechecks the file and refuses a modified installer', async () => {
  const { updater, launched, events } = await fixture(); await updater.check(); await updater.download();
  await writeFile(updater.readyFile.path, 'tampered'); await updater.install();
  assert.equal(updater.state.status, 'available'); assert.match(updater.state.error, /变化/); assert.equal(launched.length, 0); assert.equal(events.includes('quit'), false);
});
test('download cancellation removes the incomplete file and preserves retry access', async () => {
  const { updater, directory } = await fixture({ fetcher: async (url, options) => {
    if (url === LATEST_API) return Response.json(release());
    options.signal.throwIfAborted();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await updater.check(); const downloading = updater.download();
  await new Promise(resolve => setImmediate(resolve)); updater.cancel(); await downloading;
  assert.equal(updater.state.status, 'available'); assert.match(updater.state.error, /取消/); assert.deepEqual(await readdir(directory), []);
});
test('checking reports rate limits and concurrent checks share one request', async () => {
  let calls = 0;
  const { updater } = await fixture({ fetcher: async () => { calls++; await Promise.resolve(); return new Response('', { status: 403 }); } });
  const [a, b] = await Promise.all([updater.check(), updater.check()]);
  assert.equal(calls, 2); assert.equal(a.status, 'error'); assert.deepEqual(a, b); assert.match(a.error, /限制/);
});
test('API rate limits fall back to the fixed official latest page without enabling an unverified installer', async () => {
  const { updater } = await fixture({ fetcher: async url => url === LATEST_API ? new Response('', { status: 403 }) : new Response(null, { status: 302, headers: { location: `${RELEASES}/tag/v0.1.4` } }) });
  assert.equal((await updater.check()).status, 'available'); assert.equal(updater.state.latestVersion, '0.1.4'); assert.equal(updater.state.canDownload, false);
  await assert.rejects(updater.download());
  const { updater: foreign } = await fixture({ fetcher: async url => url === LATEST_API ? new Response('', { status: 403 }) : new Response(null, { status: 302, headers: { location: 'https://evil.test/tag/v99.0.0' } }) });
  assert.equal((await foreign.check()).status, 'error');
});
