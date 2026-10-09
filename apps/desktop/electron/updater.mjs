import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const RELEASES = 'https://github.com/IblankD/BBPlayerForWin/releases';
export const LATEST_API = 'https://api.github.com/repos/IblankD/BBPlayerForWin/releases/latest';
const MAX_SIZE = 300 * 1024 * 1024;
// Electron fetch cancels manual redirects instead of exposing the 3xx response.
// Capture each redirect with ClientRequest so the updater can validate every hop.
export function fetchWithElectron(net, url, options = {}) {
  if (options.redirect !== 'manual') return net.fetch(url, options);
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    let settled = false;
    const aborted = () => { request.abort(); if (!settled) reject(new Error('更新请求已取消')); };
    options.signal?.addEventListener('abort', aborted, { once: true });
    request.on('close', () => options.signal?.removeEventListener('abort', aborted));
    request.on('error', error => { if (!settled) reject(error); });
    request.on('redirect', (statusCode, _method, target) => {
      settled = true; resolve(new Response(null, { status: statusCode, headers: { location: target } })); request.abort();
    });
    request.on('response', message => {
      const headers = new Headers();
      for (const [name, values] of Object.entries(message.headers)) for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
      settled = true;
      resolve(new Response([204, 205, 304].includes(message.statusCode) ? null : Readable.toWeb(message), { status: message.statusCode, headers }));
    });
    for (const [name, value] of Object.entries(options.headers || {})) request.setHeader(name, value);
    request.end();
  });
}
const versionParts = value => typeof value === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.replace(/^v/, '').split('.').map(Number) : null;
export function compareVersions(a, b) {
  const left = versionParts(a); const right = versionParts(b);
  if (!left || !right || [...left, ...right].some(n => !Number.isSafeInteger(n))) throw new Error('版本号格式无效');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function trustedDownload(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export class ReleaseUpdater {
  constructor({ version, portable = false, enabled = true, directory, fetcher = fetch, notify = () => {}, openExternal, launchInstaller, prepareInstall = async () => {}, quit = () => {} }) {
    this.directory = directory; this.fetcher = fetcher; this.notify = notify; this.openExternal = openExternal; this.launchInstaller = launchInstaller; this.prepareInstall = prepareInstall; this.quit = quit;
    this.state = { status: 'idle', currentVersion: version, latestVersion: '', notes: '', releaseUrl: RELEASES, portable, enabled, progress: 0, error: '', canDownload: false };
    this.asset = null; this.readyFile = null; this.checking = null; this.downloadAbort = null;
  }
  update(value) { this.state = { ...this.state, ...value }; this.notify(this.state); return this.state; }
  async check() {
    if (this.checking) return this.checking;
    if (['downloading', 'ready', 'installing'].includes(this.state.status)) return this.state;
    this.checking = this.checkLatest().finally(() => { this.checking = null; });
    return this.checking;
  }
  async checkLatest() {
    this.update({ status: 'checking', error: '' });
    try {
      const response = await this.fetcher(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          await response.body?.cancel();
          return await this.checkPublicPage();
        }
        throw new Error(`检查更新失败（HTTP ${response.status}）`);
      }
      // Release metadata is bounded before JSON parsing.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('更新信息为空');
      const chunks = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('更新信息过大'); } chunks.push(value); }
      const release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (release.draft || release.prerelease) throw new Error('未找到正式版本');
      compareVersions(release.tag_name, this.state.currentVersion);
      const version = release.tag_name.replace(/^v/, '');
      const tag = release.tag_name;
      const releaseUrl = `${RELEASES}/tag/${tag}`;
      if (release.html_url !== releaseUrl) throw new Error('更新来源不匹配');
      const name = `BBPlayer-${version}-x64-Setup.exe`;
      const asset = Array.isArray(release.assets) ? release.assets.find(a => a.name === name) : null;
      this.asset = asset && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_SIZE && /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') && asset.browser_download_url === `${RELEASES}/download/${tag}/${name}` ? { name, size: asset.size, digest: asset.digest.slice(7).toLowerCase(), url: asset.browser_download_url } : null;
      const available = compareVersions(version, this.state.currentVersion) > 0;
      return this.update({ status: available ? 'available' : 'current', latestVersion: version, notes: String(release.body || '').slice(0, 20000), releaseUrl, progress: 0, checkedAt: Date.now(), canDownload: available && !!this.asset && this.state.enabled && !this.state.portable });
    } catch (error) { return this.update({ status: 'error', error: error instanceof Error ? error.message : '检查更新失败' }); }
  }
  async checkPublicPage() {
    const message = 'GitHub 暂时限制请求，请稍后检查';
    const response = await this.fetcher(`${RELEASES}/latest`, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(30000) });
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status)) throw new Error(message);
    const target = new URL(response.headers.get('location') || '', RELEASES).href;
    if (!target.startsWith(`${RELEASES}/tag/`)) throw new Error(message);
    const tag = target.slice(`${RELEASES}/tag/`.length);
    const available = compareVersions(tag, this.state.currentVersion) > 0;
    this.asset = null;
    return this.update({ status: available ? 'available' : 'current', latestVersion: tag.replace(/^v/, ''), notes: '', releaseUrl: target, checkedAt: Date.now(), canDownload: false, error: available ? 'GitHub API 暂时限流，请从发布页面下载更新。' : '' });
  }
  async fetchAsset(url, signal) {
    for (let i = 0; i < 6; i++) {
      signal.throwIfAborted();
      if (!trustedDownload(url)) throw new Error('更新下载地址无效');
      const response = await this.fetcher(url, { redirect: 'manual', credentials: 'omit', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const target = response.headers.get('location');
        if (!target) throw new Error('更新下载重定向无效');
        url = new URL(target, url).href; continue;
      }
      if (!response.ok || response.status !== 200 || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`);
      return response;
    }
    throw new Error('更新下载重定向过多');
  }
  async download() {
    if (this.state.status !== 'available' || !this.state.canDownload || !this.asset) throw new Error('当前没有可校验的安装版更新');
    const asset = this.asset;
    this.downloadAbort = new AbortController();
    const signal = AbortSignal.any([this.downloadAbort.signal, AbortSignal.timeout(15 * 60000)]);
    this.update({ status: 'downloading', error: '', progress: 0 });
    let file; let handle; let reader;
    try {
      await mkdir(this.directory, { recursive: true });
      file = path.join(this.directory, `${randomUUID()}-${asset.name}`);
      const response = await this.fetchAsset(asset.url, signal);
      handle = await open(file, 'wx'); reader = response.body.getReader();
      const hash = createHash('sha256'); let size = 0; let lastProgress = -1; let lastNotice = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        signal.throwIfAborted();
        size += value.length;
        if (size > asset.size) throw new Error('安装包大小不匹配');
        hash.update(value);
        // FileHandle.write can write fewer bytes than requested.
        let offset = 0;
        while (offset < value.length) { const { bytesWritten } = await handle.write(value, offset, value.length - offset); if (!bytesWritten) throw new Error('安装包写入失败'); offset += bytesWritten; }
        const progress = Math.floor(size / asset.size * 100);
        if (progress !== lastProgress && Date.now() - lastNotice > 150) { lastProgress = progress; lastNotice = Date.now(); this.update({ progress }); }
      }
      await handle.close(); handle = null;
      signal.throwIfAborted();
      if (size !== asset.size || hash.digest('hex') !== asset.digest) throw new Error('SHA256 校验失败，请重新下载');
      this.readyFile = { path: file, digest: asset.digest };
      return this.update({ status: 'ready', progress: 100 });
    } catch (error) {
      await reader?.cancel().catch(() => {}); await handle?.close().catch(() => {});
      if (file) await unlink(file).catch(() => {});
      return this.update({ status: 'available', progress: 0, error: this.downloadAbort.signal.aborted ? '已取消下载' : error instanceof Error ? error.message : '下载更新失败' });
    } finally { this.downloadAbort = null; }
  }
  cancel() { this.downloadAbort?.abort(); }
  async install() {
    if (this.state.status !== 'ready' || !this.readyFile || this.state.portable || !this.state.enabled) throw new Error('没有已校验的安装包');
    this.update({ status: 'installing', error: '' });
    try {
      if (await hashFile(this.readyFile.path) !== this.readyFile.digest) throw new Error('安装包已发生变化，请重新下载');
      await this.prepareInstall();
      const result = await this.launchInstaller(this.readyFile.path);
      if (result) throw new Error(`无法打开安装程序：${result}`);
      this.quit(); return this.state;
    } catch (error) {
      this.readyFile = null;
      return this.update({ status: 'available', progress: 0, error: error instanceof Error ? error.message : '安装启动失败' });
    }
  }
  async openRelease() { await this.openExternal(this.state.releaseUrl); }
}
