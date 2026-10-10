import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(os.tmpdir(), 'bbplayer-upgrade-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const oldExecutable = process.env.BBPLAYER_OLD_EXECUTABLE || path.join(root, 'release', 'BBPlayer-0.1.3-x64-Portable.exe');
const newExecutable = path.join(root, 'release', 'win-unpacked', 'BBPlayer.exe');
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; await new Promise(resolve => server.close(resolve));
const child = spawn(oldExecutable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: 'ignore' });
let browser; let app;
const errors = [];
try {
  let endpoint;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json()).webSocketDebuggerUrl; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(endpoint, 'Old portable did not start');
  browser = await chromium.connectOverCDP(endpoint);
  let page = browser.contexts()[0].pages()[0];
  await page.getByRole('heading', { name: '给生活，配一点音乐。' }).waitFor();
  await page.getByRole('button', { name: '新建歌单', exact: true }).click();
  await page.getByLabel('歌单名称').fill('旧版迁移验收');
  await page.getByRole('button', { name: '创建歌单', exact: true }).click();
  await page.getByRole('slider', { name: '音量' }).fill('0.42');
  await expect.poll(() => page.evaluate(async () => (await window.desktop.loadLibrary()).volume)).toBe(.42);
  assert.equal((await page.evaluate(() => window.desktop.updateState())).currentVersion, '0.1.3');
  await page.evaluate(() => window.desktop.windowControl('quit')).catch(() => {});
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  await browser.close(); browser = null;
  const oldLibrary = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
  const oldSession = JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8'));
  assert.equal(oldLibrary.schemaVersion, undefined);
  const launch = () => electron.launch({ executablePath: newExecutable, args: [`--user-data-dir=${profile}`], env, timeout: 60000 });
  app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '旧版迁移验收', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.desktop.loadLibrary()), oldLibrary);
  assert.deepEqual(await page.evaluate(() => window.desktop.loadSession()), oldSession);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'library.json'))).schemaVersion, 1);
  await page.getByRole('button', { name: '歌单备份与设置', exact: true }).click();
  await page.getByRole('button', { name: '立即备份', exact: true }).click();
  await page.getByText('备份已创建', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '新建歌单', exact: true }).click();
  await page.getByLabel('歌单名称').fill('恢复时应移除');
  await page.getByRole('button', { name: '创建歌单', exact: true }).click();
  await page.getByRole('button', { name: '歌单备份与设置', exact: true }).click();
  // Choose confirmation at the OS dialog boundary; real restore IPC/file work runs.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.desktop.loadLibrary())).toEqual(oldLibrary);
  await page.getByText('已恢复备份，原数据可从备份列表找回', { exact: true }).waitFor();
  await expect(page.getByRole('button', { name: '恢复时应移除', exact: true })).toHaveCount(0);
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.locator('.backup-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, 'test-results', 'desktop-backups.png') });
  await app.close(); app = null;
  assert.equal(JSON.parse(await readFile(path.join(profile, 'session.json'))).schemaVersion, 1);
  // Simulate disk damage between launches, then exercise actual startup recovery.
  await writeFile(path.join(profile, 'library.json'), '{corrupted');
  app = await launch(); page = await app.firstWindow();
  await page.getByRole('button', { name: '旧版迁移验收', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.desktop.loadLibrary()), oldLibrary);
  assert.match(await page.evaluate(() => window.desktop.dataNotice()), /已从最近/);
  assert.ok((await readdir(profile)).some(name => name.startsWith('library-corrupt-')));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', profile, oldVersion: '0.1.3', newVersion: (await page.evaluate(() => window.desktop.updateState())).currentVersion, tested: ['actual old portable saved data', 'same profile migration', 'versioned session', 'backup UI', 'restore with pre-restore backup', 'corruption recovery'], installerWizardExecuted: false, rendererErrors: errors }, null, 2));
} finally {
  await app?.close().catch(() => {}); await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
