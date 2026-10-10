import { useEffect, useState } from 'react';
import type { Desktop, Library } from './types';

export default function BackupPanel({ restore, save }: { restore: (value: Library) => void; save: () => Promise<void> }) {
  const [backups, setBackups] = useState<Awaited<ReturnType<Desktop['listBackups']>>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void window.desktop.listBackups().then(setBackups).catch(error => setMessage(String(error))); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); setBackups(await window.desktop.listBackups()); }
    catch (error) { setMessage(error instanceof Error ? error.message : '备份操作失败'); }
    finally { setBusy(false); }
  };
  return <div className="backup-panel"><h3>自动备份与恢复</h3><p className="small-note">启动时及歌单变化时自动备份（变化间隔至少 5 分钟），保留最近 10 份。恢复前会备份当前数据，登录凭据不进入备份。</p>
    <button className="secondary" disabled={busy} onClick={() => { void run(async () => { await save(); await window.desktop.createBackup(); setMessage('备份已创建'); }); }}>立即备份</button>
    <div className="backup-list">{backups.map(item => <div className="backup-row" key={item.id}><span>{new Date(item.createdAt).toLocaleString()}<small>{item.playlists} 个歌单 · {item.tracks} 首歌曲</small></span><button className="text-button" disabled={busy} onClick={() => { void run(async () => { await save(); const value = await window.desktop.restoreBackup(item.id); if (value) { restore(value); setMessage('已恢复备份，原数据可从备份列表找回'); } }); }}>恢复</button></div>)}{!backups.length && <p className="small-note">暂无备份，可立即创建一份。</p>}</div>
    {message && <p role="status" className="small-note">{message}</p>}
  </div>;
}
