// NSIS launchers do not forward Playwright's inspector pipe. Test the portable
// executable through a temporary loopback CDP port instead.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'release', 'BBPlayer-0.1.0-x64-Portable.exe');
const profile = await mkdtemp(path.join(os.tmpdir(), 'bbplayer-portable-'));
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, stdio: 'ignore', windowsHide: true });
let browser;
try {
  let endpoint;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); endpoint = (await response.json()).webSocketDebuggerUrl; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(endpoint, 'Portable application did not open its diagnostic port');
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '给生活，配一点音乐。' }).waitFor();
  const search = page.getByRole('textbox', { name: '搜索音乐或 BV 号' });
  await search.fill('BV1GJ411x7h7'); await search.press('Enter');
  await page.getByRole('button', { name: '播放 【官方 MV】Never Gonna Give You Up - Rick Astley', exact: true }).click({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .5, undefined, { timeout: 30000 });
  await page.getByRole('slider', { name: '播放进度' }).fill('60');
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= 59, undefined, { timeout: 15000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const playback = await page.evaluate(() => { const audio = document.querySelector('audio'); return { duration: audio.duration, position: audio.currentTime, paused: audio.paused }; });
  assert.ok(playback.duration > 200); assert.equal(playback.paused, true); assert.deepEqual(errors, []);
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'portable-playback.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  console.log(JSON.stringify({ result: 'PASS', executable, playback, rendererErrors: errors }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  // Normal closing allows the NSIS launcher to clean its extraction directory.
  if (child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
}
