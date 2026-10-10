import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.BBPLAYER_SMOKE_EXECUTABLE || path.join(root, 'release/win-unpacked/BBPlayer.exe');
const profile = await mkdtemp(path.join(os.tmpdir(), 'bbplayer-update-smoke-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60000 });
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '给生活，配一点音乐。' }).waitFor();
  await page.getByRole('slider', { name: '音量' }).fill('0.37');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '软件更新' });
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect.poll(async () => ['current', 'available', 'error'].includes((await page.evaluate(() => window.desktop.updateState())).status), { timeout: 40000 }).toBe(true);
  const live = await page.evaluate(() => window.desktop.updateState());
  assert.notEqual(live.status, 'error', live.error);
  assert.match(live.latestVersion, /^\d+\.\d+\.\d+$/);
  assert.match(live.releaseUrl, /^https:\/\/github\.com\/IblankD\/BBPlayerForWin\/releases\/tag\//);
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'desktop-updates.png') });
  const content = 'verified integration fixture, never executed';
  const digest = createHash('sha256').update(content).digest('hex');
  // Mock only network and OS launch boundaries; run production IPC, state,
  // download, hashing, UI and persistence against an isolated real application.
  await app.evaluate(({ net, shell, app }, { content, digest }) => {
    globalThis.bbplayerOriginalQuit = app.quit.bind(app);
    app.quit = () => { globalThis.bbplayerQuitRequested = true; };
    shell.openPath = async file => { globalThis.bbplayerLaunchedInstaller = file; return ''; };
    net.fetch = async url => {
      const base = 'https://github.com/IblankD/BBPlayerForWin/releases';
      if (String(url).includes('api.github.com')) return Response.json({ tag_name: 'v99.0.0', html_url: `${base}/tag/v99.0.0`, body: '更新验收用模拟版本，不执行实际安装。', draft: false, prerelease: false, assets: [{ name: 'BBPlayer-99.0.0-x64-Setup.exe', state: 'uploaded', size: new TextEncoder().encode(content).length, digest: `sha256:${digest}`, browser_download_url: `${base}/download/v99.0.0/BBPlayer-99.0.0-x64-Setup.exe` }] });
      return new Response(content);
    };
    net.request = () => {
      const { EventEmitter } = process.getBuiltinModule('node:events');
      const { Readable } = process.getBuiltinModule('node:stream');
      const request = new EventEmitter();
      request.setHeader = () => {};
      request.abort = () => request.emit('close');
      request.end = () => queueMicrotask(() => {
        const message = Readable.from([Buffer.from(content)]); message.statusCode = 200; message.headers = {};
        message.once('end', () => request.emit('close')); request.emit('response', message);
      });
      return request;
    };
  }, { content, digest });
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '发现新版本 99.0.0' }).waitFor();
  await panel.getByRole('button', { name: '下载并校验更新', exact: true }).click();
  await panel.getByText('安装包已下载，SHA256 校验通过。', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.bbplayerLaunchedInstaller), undefined);
  let files = await readdir(path.join(profile, 'updates')); assert.equal(files.length, 1);
  assert.equal(createHash('sha256').update(await readFile(path.join(profile, 'updates', files[0]))).digest('hex'), digest);
  await panel.getByRole('button', { name: '清理更新缓存', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '发现新版本 99.0.0' }).waitFor();
  assert.deepEqual(await readdir(path.join(profile, 'updates')), []);
  await panel.getByRole('button', { name: '下载并校验更新', exact: true }).click();
  await panel.getByText('安装包已下载，SHA256 校验通过。', { exact: true }).waitFor();
  files = await readdir(path.join(profile, 'updates')); assert.equal(files.length, 1);
  await panel.getByRole('button', { name: '退出并安装更新', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.bbplayerQuitRequested === true), { timeout: 10000 }).toBe(true);
  // The shell boundary records the request; no installer is executed by this test.
  const launched = await app.evaluate(() => ({ file: globalThis.bbplayerLaunchedInstaller, quit: globalThis.bbplayerQuitRequested }));
  assert.equal(launched.file, path.join(profile, 'updates', files[0])); assert.equal(launched.quit, true);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).playlists[0].id, 'liked');
  assert.equal(JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).volume, .37);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', live: { currentVersion: live.currentVersion, latestVersion: live.latestVersion, releaseUrl: live.releaseUrl }, simulated: ['new version', 'download', 'SHA256', 'explicit install', 'flush library', 'request installer and quit'], actualInstallerExecuted: false, rendererErrors: errors }, null, 2));
} finally {
  await app.evaluate(({ app }) => { if (globalThis.bbplayerOriginalQuit) app.quit = globalThis.bbplayerOriginalQuit; }).catch(() => {});
  await app.close().catch(() => {});
}
