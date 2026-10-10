import { useEffect, useState } from 'react';
import type { UpdateState } from './types';

export default function UpdatePanel() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState('');
  const [cache, setCache] = useState({ files: 0, bytes: 0 });
  useEffect(() => {
    let active = true;
    const off = window.desktop.onUpdate(value => { if (active) setState(value); });
    void window.desktop.updateState().then(value => { if (active) setState(value); }).catch(cause => { if (active) setError(String(cause)); });
    void window.desktop.updateCache().then(value => { if (active) setCache(value); }).catch(() => {});
    return () => { active = false; off(); };
  }, []);
  const run = (action: () => Promise<unknown>) => { setError(''); void action().catch(cause => setError(cause instanceof Error ? cause.message : '更新操作失败')); };
  const busy = state && ['checking', 'downloading', 'installing'].includes(state.status);
  useEffect(() => { void window.desktop.updateCache().then(setCache).catch(() => {}); }, [state?.status]);
  return <div className="update-panel"><span className="eyebrow">KEEP YOUR MUSIC GOING</span><h2>软件更新</h2><p>当前版本 {state?.currentVersion || __APP_VERSION__}{state?.portable ? ' · 便携版' : ''}</p>
    <p className="update-status" role="status">{!state ? '正在读取更新状态…' : state.status === 'idle' ? '检查 GitHub 上的正式发布版本。' : state.status === 'checking' ? '正在检查更新…' : state.status === 'current' ? '当前已是最新版本。' : state.status === 'available' ? `发现新版本 ${state.latestVersion}` : state.status === 'downloading' ? `正在下载 ${state.progress}%` : state.status === 'ready' ? '安装包已下载，SHA256 校验通过。' : state.status === 'installing' ? '正在打开安装程序…' : '暂时无法检查更新。'}</p>
    {(error || state?.error) && <p className="update-error" role="alert">{error || state?.error}</p>}
    {state?.status === 'downloading' && <progress aria-label="更新下载进度" max={100} value={state.progress} />}
    <div className="settings-actions">
      <button className="secondary" disabled={!state || !!busy || state.status === 'ready'} onClick={() => run(() => window.desktop.checkUpdate())}>检查更新</button>
      {state?.status === 'available' && state.canDownload && <button className="primary" onClick={() => run(() => window.desktop.downloadUpdate())}>下载并校验更新</button>}
      {state?.status === 'downloading' && <button className="secondary" onClick={() => run(() => window.desktop.cancelUpdate())}>取消下载</button>}
      {state?.status === 'ready' && <button className="primary" onClick={() => run(() => window.desktop.installUpdate())}>退出并安装更新</button>}
      <button className="text-button" disabled={!state || state.status === 'installing'} onClick={() => run(() => window.desktop.openRelease())}>打开发布页面</button>
    </div>
    <p className="small-note">{state?.portable ? '便携版请从发布页面下载新版，退出后替换原程序。本地歌单会保留。' : !state?.enabled ? '开发环境仅检查版本；安装后的程序支持下载并校验更新。' : state.status === 'available' && !state.canDownload ? '此版本缺少可校验的安装包，请从发布页面下载。' : '启动后自动检查版本，下载和安装由你确认。安装时选择原安装目录，歌单与使用状态会保留。'}</p>
    {state?.notes && <details className="update-notes"><summary>版本说明 · {state.latestVersion}</summary><pre>{state.notes}</pre></details>}
    <div className="update-cache"><p className="small-note">更新缓存：{cache.files} 个安装包 · {(cache.bytes / 1024 / 1024).toFixed(1)} MB。启动时自动清理上次留下的安装包。</p><button className="secondary" disabled={!!busy || !cache.files} onClick={() => run(async () => { setCache(await window.desktop.clearUpdateCache()); })}>清理更新缓存</button></div>
  </div>;
}
