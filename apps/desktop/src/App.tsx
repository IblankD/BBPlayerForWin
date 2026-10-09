import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search, House, Heart, History, FolderHeart, Plus, Music2, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, ListMusic, Mic2, Minus, Square, X, ChevronRight, ChevronLeft, Download, Upload, LogOut, LoaderCircle, Trash2, Headphones, Disc3, Check, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import type { Account, Favorite, Library, PlayerSession, Track } from './types';
import { parseLrc } from './lyrics';
import { usePlayback } from './usePlayback';
import UpdatePanel from './UpdatePanel';

const initial: Library = { playlists: [{ id: 'liked', name: '我喜欢的音乐', tracks: [] }], history: [], lyrics: {}, volume: 0.7, repeat: 'all' };
const durationText = (value: number) => `${Math.floor((value || 0) / 60)}:${String(Math.floor((value || 0) % 60)).padStart(2, '0')}`;
function IconButton({ label, children, onClick, active = false, disabled = false }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Cover({ track, className = '' }: { track?: Track | null; className?: string }) {
  return <div className={`cover ${className}`}>{track?.cover ? <img src={track.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <Disc3 />}</div>;
}

export default function App() {
  const [library, setLibrary] = useState<Library>(initial);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [view, setView] = useState('home');
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [remote, setRemote] = useState<Track[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<PlayerSession['closeBehavior']>('ask');
  const [sessionReady, setSessionReady] = useState(false);
  const [modal, setModal] = useState<'login' | 'new' | 'add' | 'lyrics' | 'queue' | 'settings' | 'updates' | null>(null);
  const [target, setTarget] = useState<Track | null>(null);
  const [name, setName] = useState('');
  const [lyricText, setLyricText] = useState('');
  const [qr, setQr] = useState('');
  const [qrStatus, setQrStatus] = useState('');
  const [qrVersion, setQrVersion] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const requestSequence = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const { queue, current, parts, playing, buffering, position, duration, status, controller } = usePlayback(audio,
    track => setLibrary(value => ({ ...value, history: [track, ...value.history.filter(t => t.bvid !== track.bvid)].slice(0, 100) })), notify);
  const snapshot = useRef({ queue, current, library, shuffle });
  useEffect(() => { snapshot.current = { queue, current, library, shuffle }; }, [queue, current, library, shuffle]);
  const fail = useCallback((cause: unknown) => notify(cause instanceof Error ? cause.message : '操作失败'), [notify]);
  const run = (promise: Promise<unknown>) => { void promise.catch(fail); };

  useEffect(() => {
    let active = true;
    if (!window.desktop) { setError('请在 BBPlayer Windows 应用中打开此页面'); return; }
    Promise.all([window.desktop.loadLibrary(), window.desktop.loadSession()]).then(([value, saved]) => {
      if (!active) return;
      setLibrary(value); setReady(true); controller.restore(saved); setShuffle(saved.shuffle); setCloseBehavior(saved.closeBehavior);
      setView(saved.view.startsWith('playlist:') && !value.playlists.some(p => `playlist:${p.id}` === saved.view) ? 'home' : saved.view);
      setSessionReady(true);
    }).catch(fail);
    window.desktop.account().then(value => { if (active) setAccount(value); }).catch(() => { /* Offline usage remains available. */ });
    return () => { active = false; };
  }, [fail, controller]);
  const sessionSnapshot = useRef({ shuffle, view, closeBehavior, sessionReady, library });
  useEffect(() => { sessionSnapshot.current = { shuffle, view, closeBehavior, sessionReady, library }; }, [shuffle, view, closeBehavior, sessionReady, library]);
  const saveSession = useCallback(async () => {
    const state = sessionSnapshot.current;
    if (state.sessionReady) await window.desktop.saveSession({ ...controller.checkpoint(), shuffle: state.shuffle, view: state.view, closeBehavior: state.closeBehavior });
  }, [controller]);
  useEffect(() => {
    if (!sessionReady) return;
    void saveSession().catch(fail);
    const timer = setInterval(() => { void saveSession().catch(fail); }, 5000);
    return () => clearInterval(timer);
  }, [queue, current, playing, shuffle, view, sessionReady, saveSession, fail]);
  useEffect(() => window.desktop?.onSaveRequest(async () => {
    try {
      await saveSession();
      if (sessionSnapshot.current.sessionReady) await window.desktop.saveLibrary(sessionSnapshot.current.library);
    } catch (cause) { fail(cause); }
  }), [saveSession, fail]);
  useEffect(() => { if (sessionReady) void window.desktop.playerStatus({ title: current?.title || '', playing }).catch(fail); }, [current, playing, sessionReady, fail]);
  useEffect(() => window.desktop?.onCloseBehavior(setCloseBehavior), []);
  useEffect(() => {
    let announced = '';
    return window.desktop?.onUpdate(value => {
      if (value.status === 'available' && announced !== value.latestVersion) { announced = value.latestVersion; notify(`发现新版本 ${value.latestVersion}，可在“检查更新”中升级。`); }
    });
  }, [notify]);
  useEffect(() => { if (ready) void window.desktop.saveLibrary(library).catch(fail); }, [library, ready, fail]);
  useEffect(() => { if (audio.current) audio.current.volume = library.volume; }, [library.volume]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  const play = useCallback(async (track: Track, items?: Track[], cid?: number) => { controller.play(track, items, cid); }, [controller]);
  const toggle = useCallback(() => controller.toggle(), [controller]);
  const skip = useCallback((direction: number, ended = false) => {
    const state = snapshot.current;
    if (!state.queue.length || !state.current) return;
    if (ended && state.library.repeat === 'one') { controller.seek(0); controller.resume(); return; }
    const index = state.queue.findIndex(item => item.bvid === state.current?.bvid);
    if (direction < 0 && controller.state.position > 3 && !ended) { controller.seek(0); return; }
    const next = state.shuffle && state.queue.length > 1 ? (index + 1 + Math.floor(Math.random() * (state.queue.length - 1))) % state.queue.length : index + direction;
    if (ended && next >= state.queue.length && state.library.repeat === 'off') { controller.pause(); return; }
    void play(state.queue[(next + state.queue.length) % state.queue.length]).catch(fail);
  }, [play, fail, controller]);
  useEffect(() => {
    if (!window.desktop) return;
    const off = window.desktop.onPlayerCommand(command => { if (command === 'toggle') toggle(); else skip(command === 'next' ? 1 : -1); });
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,button') || modal) return;
      if (event.code === 'Space') { event.preventDefault(); toggle(); }
      if (event.ctrlKey && event.code === 'ArrowRight') { event.preventDefault(); skip(1); }
      if (event.ctrlKey && event.code === 'ArrowLeft') { event.preventDefault(); skip(-1); }
    };
    document.addEventListener('keydown', listener);
    return () => { off(); document.removeEventListener('keydown', listener); };
  }, [skip, toggle, modal]);
  useEffect(() => {
    if (!current || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: 'BBPlayer', artwork: current.cover ? [{ src: current.cover }] : [] });
    navigator.mediaSession.setActionHandler('play', () => controller.resume());
    navigator.mediaSession.setActionHandler('pause', () => controller.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [current, playing, skip, controller]);

  useEffect(() => {
    if (modal !== 'login') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setQr(''); setQrStatus('正在生成二维码…');
    const start = async () => {
      try {
        const result = await window.desktop.qrGenerate();
        const image = await QRCode.toDataURL(result.url, { width: 240, margin: 1, color: { dark: '#12354e', light: '#ffffff' } });
        if (!active) return;
        setQr(image); setQrStatus('使用哔哩哔哩 App 扫码');
        const poll = async () => {
          try {
            if (!active) return;
            const state = await window.desktop.qrPoll(result.key);
            if (!active) return;
            if (state.code === 0) { setAccount(state.account || null); setModal(null); notify('登录成功'); return; }
            if (state.code === 86038) { setQrStatus('二维码已过期，请刷新'); return; }
            setQrStatus(state.code === 86090 ? '扫码成功，请在手机上确认' : '使用哔哩哔哩 App 扫码');
            timer = setTimeout(() => { void poll(); }, 2000);
          } catch (cause) { if (active) setQrStatus(cause instanceof Error ? cause.message : '登录失败，请刷新'); }
        };
        timer = setTimeout(() => { void poll(); }, 2000);
      } catch (cause) { if (active) setQrStatus(cause instanceof Error ? cause.message : '二维码加载失败'); }
    };
    void start();
    return () => { active = false; clearTimeout(timer); };
  }, [modal, qrVersion, notify]);

  async function search(value: string, number = 1) {
    if (!value.trim()) return;
    const id = ++requestSequence.current;
    setInput(value); setKeyword(value); setView('search'); setRemote([]); setPage(number); setError(''); setLoading(true);
    try { const result = await window.desktop.search(value, number); if (id === requestSequence.current) { setRemote(result.tracks); setPages(result.pages); } }
    catch (cause) { if (id === requestSequence.current) setError(cause instanceof Error ? cause.message : '搜索失败'); }
    finally { if (id === requestSequence.current) setLoading(false); }
  }
  function navigate(value: string) { requestSequence.current++; setLoading(false); setError(''); setView(value); }
  async function openFavorites() {
    navigate('favorites');
    if (!account) { setModal('login'); return; }
    const id = ++requestSequence.current; setLoading(true);
    try { const result = await window.desktop.favorites(); if (id === requestSequence.current) setFavorites(result); }
    catch (cause) { if (id === requestSequence.current) setError(cause instanceof Error ? cause.message : '收藏夹加载失败'); }
    finally { if (id === requestSequence.current) setLoading(false); }
  }
  async function openFavorite(favorite: Favorite, number = 1) {
    const id = ++requestSequence.current;
    setView(`favorite:${favorite.id}`); setRemote([]); setError(''); setLoading(true); setPage(number);
    try { const result = await window.desktop.favoriteTracks(favorite.id, number); if (id === requestSequence.current) { setRemote(result.tracks); setPages(result.hasMore ? number + 1 : number); } }
    catch (cause) { if (id === requestSequence.current) setError(cause instanceof Error ? cause.message : '收藏夹加载失败'); }
    finally { if (id === requestSequence.current) setLoading(false); }
  }
  const liked = library.playlists.find(p => p.id === 'liked')?.tracks || [];
  function like(track: Track) {
    setLibrary(value => {
      const list = value.playlists.find(p => p.id === 'liked');
      if (!list) return { ...value, playlists: [{ id: 'liked', name: '我喜欢的音乐', tracks: [track] }, ...value.playlists] };
      return { ...value, playlists: value.playlists.map(p => p.id === 'liked' ? { ...p, tracks: p.tracks.some(t => t.bvid === track.bvid) ? p.tracks.filter(t => t.bvid !== track.bvid) : [...p.tracks, track] } : p) };
    });
  }
  function addTo(id: string) {
    if (!target) return;
    setLibrary(value => ({ ...value, playlists: value.playlists.map(p => p.id === id && !p.tracks.some(t => t.bvid === target.bvid) ? { ...p, tracks: [...p.tracks, target] } : p) }));
    notify('已保存到歌单'); setModal(null);
  }
  function createPlaylist() {
    if (!name.trim()) return;
    if (library.playlists.length >= 100) { notify('最多支持 100 个歌单'); return; }
    const id = crypto.randomUUID();
    setLibrary(value => ({ ...value, playlists: [...value.playlists, { id, name: name.trim(), tracks: [] }] }));
    setName(''); setModal(null); navigate(`playlist:${id}`);
  }
  const playlist = library.playlists.find(p => view === `playlist:${p.id}` || (view === 'liked' && p.id === 'liked'));
  const favorite = favorites.find(f => view === `favorite:${f.id}`);
  const tracks = playlist?.tracks || (view === 'history' ? library.history : remote);
  const title = playlist?.name || favorite?.title || (view === 'history' ? '最近播放' : view === 'search' ? `“${keyword}” 的搜索结果` : '我的 B 站收藏夹');
  const lines = useMemo(() => parseLrc(current ? library.lyrics[current.bvid] || '' : ''), [library.lyrics, current]);
  const activeLine = lines.findLastIndex(line => line.time <= position);

  function trackList(items: Track[], compact = false) {
    return <div className={`track-list ${compact ? 'compact' : ''}`}>
      {!compact && <div className="track-heading"><span>#</span><span>歌曲 / 视频</span><span>UP 主</span><span>时长</span><span /></div>}
      {items.map((track, i) => <div className={`track-row ${current?.bvid === track.bvid ? 'selected' : ''}`} key={`${track.bvid}-${i}`}>
        <button className="row-play" aria-label={`播放 ${track.title}`} onClick={() => run(play(track, items))}>{current?.bvid === track.bvid && playing ? <span className="equalizer"><i /><i /><i /></span> : <><span>{String(i + 1).padStart(2, '0')}</span><Play size={15} /></>}</button>
        <button className="track-info" onClick={() => run(play(track, items))}><Cover track={track} /><span><strong title={track.title}>{track.title}</strong>{compact && <small>{track.artist}</small>}</span></button>
        {!compact && <span className="artist" title={track.artist}>{track.artist}</span>}
        {!compact && <span className="track-time">{durationText(track.duration)}</span>}
        <div className="track-actions"><IconButton label="喜欢" active={liked.some(t => t.bvid === track.bvid)} onClick={() => like(track)}><Heart size={16} fill={liked.some(t => t.bvid === track.bvid) ? 'currentColor' : 'none'} /></IconButton>
          {!compact && <IconButton label="添加到歌单" onClick={() => { setTarget(track); setModal('add'); }}><Plus size={17} /></IconButton>}
          {playlist && !compact && <IconButton label="从歌单移除" onClick={() => setLibrary(value => ({ ...value, playlists: value.playlists.map(p => p.id === playlist.id ? { ...p, tracks: p.tracks.filter(t => t.bvid !== track.bvid) } : p) }))}><Trash2 size={15} /></IconButton>}
        </div>
      </div>)}
    </div>;
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><img src="./app-icon.png" alt="BBPlayer 图标" /></span><b>BBPlayer<span>DESKTOP</span></b></div>
      <div className="nav-label">发现音乐</div>
      <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}><House size={19} />首页</button>
      <button className={`nav-item ${view.startsWith('favorite') ? 'active' : ''}`} onClick={() => run(openFavorites())}><FolderHeart size={19} />B 站收藏夹</button>
      <div className="nav-label">我的音乐</div>
      <button className={`nav-item ${view === 'liked' ? 'active' : ''}`} onClick={() => navigate('liked')}><Heart size={19} />我喜欢的音乐<span className="count">{liked.length}</span></button>
      <button className={`nav-item ${view === 'history' ? 'active' : ''}`} onClick={() => navigate('history')}><History size={19} />最近播放</button>
      <div className="nav-label playlists-label">我的歌单<IconButton label="新建歌单" onClick={() => { setName(''); setModal('new'); }}><Plus size={15} /></IconButton></div>
      <div className="playlist-nav">{library.playlists.filter(p => p.id !== 'liked').map(p => <button key={p.id} className={`nav-item ${view === `playlist:${p.id}` ? 'active' : ''}`} onClick={() => navigate(`playlist:${p.id}`)}><ListMusic size={18} /><span>{p.name}</span></button>)}</div>
      <div className="sidebar-bottom"><button className="text-button" onClick={() => setModal('settings')}><Download size={13} />歌单备份与设置</button><button className="text-button update-entry" onClick={() => setModal('updates')}><RefreshCw size={13} />检查更新</button><div className="local-note"><span className="status-dot" />音乐与你的歌单，留在本地</div><button className="account" onClick={() => setModal(account ? 'settings' : 'login')}><span className="avatar">{account?.name.slice(0, 1) || <img src="./app-icon.png" alt="" />}</span><span><strong>{account?.name || '登录 B 站账号'}</strong><small>{account ? '账户与歌单备份' : '听见你的收藏'}</small></span><ChevronRight size={16} /></button></div>
    </aside>
    <div className="main-panel">
      <header className="topbar"><form className="search-box" onSubmit={event => { event.preventDefault(); run(search(input)); }}><Search size={18} /><input aria-label="搜索音乐或 BV 号" placeholder="搜索音乐、UP 主，或粘贴 BV 号" value={input} onChange={event => setInput(event.target.value)} /><kbd>Enter</kbd></form><span className="platform-label">WINDOWS EDITION</span><div className="window-buttons"><IconButton label="最小化" onClick={() => run(window.desktop.windowControl('minimize'))}><Minus size={17} /></IconButton><IconButton label="最大化" onClick={() => run(window.desktop.windowControl('maximize'))}><Square size={13} /></IconButton><IconButton label="关闭" onClick={() => run(window.desktop.saveLibrary(library).then(() => window.desktop.windowControl('close')))}><X size={18} /></IconButton></div></header>
      <main className="content">
        {view === 'home' ? <>
          <div className="greeting"><span>YOUR EVERYDAY SOUNDTRACK</span><h1>给生活，配一点音乐。</h1><p>把喜欢的声音留下，让每一次播放都轻松一点。</p></div>
          <section className="hero"><div className="hero-copy"><span className="eyebrow"><span /> JUST PRESS PLAY</span><h2>好音乐，<br />值得专心听。</h2><p>从 B 站发现你的下一首心动。<br />搜索、收藏、播放，在桌面上自在听歌。</p><button className="primary" onClick={() => document.querySelector<HTMLInputElement>('.search-box input')?.focus()}><Search size={17} />发现音乐<ChevronRight size={16} /></button></div><div className="hero-art" aria-hidden="true"><div className={`vinyl ${playing ? 'spinning' : ''}`}><div className="vinyl-label"><img src="./app-icon.png" alt="" /><span>BB / SIDE A</span></div></div><div className="art-caption"><span>33⅓ RPM</span><span>GOOD VIBES ONLY</span></div><div className="sparkle">✦</div></div></section>
          <div className="section-heading"><h2>从这里开始</h2><span>让喜欢的声音，触手可及</span></div>
          <div className="shortcut-grid"><button className="shortcut-card pink" onClick={() => navigate('liked')}><span className="shortcut-icon"><Heart /></span><div><h3>我喜欢的音乐</h3><p>{liked.length ? `${liked.length} 首珍藏的声音` : '收藏你的每一次心动'}</p></div><ChevronRight /></button><button className="shortcut-card lavender" onClick={() => run(openFavorites())}><span className="shortcut-icon"><FolderHeart /></span><div><h3>B 站收藏夹</h3><p>把熟悉的歌单带到桌面</p></div><ChevronRight /></button><button className="shortcut-card mint" onClick={() => navigate('history')}><span className="shortcut-icon"><History /></span><div><h3>最近播放</h3><p>{library.history.length ? '重逢那些好听的旋律' : '你的音乐足迹从这里开始'}</p></div><ChevronRight /></button></div>
          <div className="section-heading"><h2>最近听过</h2><button className="text-button" onClick={() => navigate('history')}>查看全部<ChevronRight size={15} /></button></div>
          {library.history.length ? trackList(library.history.slice(0, 5), true) : <div className="welcome-empty"><Headphones size={27} /><div><strong>你的第一首歌，还在等你</strong><p>在顶部搜索喜欢的音乐，或粘贴 B 站视频链接开始播放。</p></div></div>}
        </> : <>
          <div className="page-heading"><span className="eyebrow">{view === 'search' ? 'FIND YOUR SOUND' : 'YOUR MUSIC LIBRARY'}</span><h1>{title}</h1><p>{view === 'favorites' ? '登录后，直接播放你在 B 站创建的收藏夹。' : `${tracks.length} 首${view === 'search' ? ` · 第 ${page} 页` : ''}`}</p></div>
          {tracks.length > 0 && view !== 'favorites' && <div className="list-toolbar"><button className="primary" onClick={() => run(play(tracks[0], tracks))}><Play size={16} fill="currentColor" />播放全部</button><button className="secondary" onClick={() => { controller.setQueue(tracks); notify('已替换播放队列'); }}><ListMusic size={17} />加入播放队列</button>{playlist && playlist.id !== 'liked' && <button className="text-button danger" onClick={() => { setLibrary(value => ({ ...value, playlists: value.playlists.filter(p => p.id !== playlist.id) })); navigate('home'); }}>删除歌单</button>}</div>}
          {loading ? <div className="empty"><LoaderCircle className="spin" /><h3>正在寻找好声音…</h3></div> : error ? <div className="empty"><Music2 /><h3>暂时没有加载成功</h3><p>{error}</p><button className="secondary" onClick={() => run(view === 'search' ? search(keyword, page) : favorite ? openFavorite(favorite, page) : openFavorites())}><RefreshCw size={16} />重试</button></div> : view === 'favorites' ? favorites.length ? <div className="favorites-grid">{favorites.map(f => <button key={f.id} className="favorite-card" onClick={() => run(openFavorite(f))}><span><FolderHeart size={40} /></span><h3>{f.title}</h3><p>{f.count} 个视频</p></button>)}</div> : <div className="empty"><FolderHeart /><h3>{account ? '还没有收藏夹' : '登录，听见你的收藏'}</h3><p>{account ? '在 B 站创建收藏夹后，这里就能找到它。' : '使用 B 站 App 扫码登录即可访问收藏夹。'}</p>{!account && <button className="primary" onClick={() => setModal('login')}>扫码登录</button>}</div> : tracks.length ? trackList(tracks) : <div className="empty"><Music2 /><h3>{view === 'search' ? '没有找到相关视频' : '这里还很安静'}</h3><p>{view === 'search' ? '试试歌名、歌手，或直接粘贴 BV 号。' : '搜索喜欢的音乐，点击爱心或加号保存到歌单。'}</p></div>}
          {(view === 'search' || favorite) && !loading && !error && pages > 1 && <div className="pagination"><button className="secondary" disabled={page <= 1} onClick={() => run(favorite ? openFavorite(favorite, page - 1) : search(keyword, page - 1))}><ChevronLeft size={15} />上一页</button><span>第 {page} 页</span><button className="secondary" disabled={page >= pages} onClick={() => run(favorite ? openFavorite(favorite, page + 1) : search(keyword, page + 1))}>下一页<ChevronRight size={15} /></button></div>}
        </>}
        <footer className="content-footer"><span>BBPlayer · 为好声音而生</span><span>本地优先 · 自在聆听</span></footer>
      </main>
    </div>
    <footer className="player-bar"><div className="now-playing"><Cover track={current} /><div><strong title={current?.title}>{current?.title || '准备好听点什么？'}</strong><small>{status || current?.artist || '搜索一首歌，开启你的音乐时刻'}</small></div>{current && <IconButton label="喜欢当前歌曲" active={liked.some(t => t.bvid === current.bvid)} onClick={() => like(current)}><Heart size={18} fill={liked.some(t => t.bvid === current.bvid) ? 'currentColor' : 'none'} /></IconButton>}</div><div className="player-center"><div className="playback-buttons"><IconButton label="随机播放" active={shuffle} onClick={() => setShuffle(value => !value)}><Shuffle size={17} /></IconButton><IconButton label="上一首" disabled={!current} onClick={() => skip(-1)}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" aria-label={playing ? '暂停' : '播放'} disabled={!current} onClick={toggle}>{buffering ? <LoaderCircle className="spin" size={21} /> : playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" disabled={!current} onClick={() => skip(1)}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label={library.repeat === 'one' ? '单曲循环' : library.repeat === 'all' ? '列表循环' : '顺序播放'} active={library.repeat !== 'off'} onClick={() => setLibrary(value => ({ ...value, repeat: value.repeat === 'all' ? 'one' : value.repeat === 'one' ? 'off' : 'all' }))}>{library.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</IconButton></div><div className="progress"><span>{durationText(position)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} disabled={!duration} onChange={event => { if (audio.current) { controller.seek(Number(event.target.value)); } }} /><span>{durationText(duration)}</span></div></div><div className="player-tools"><IconButton label="歌词" active={modal === 'lyrics'} disabled={!current} onClick={() => { setLyricText(current ? library.lyrics[current.bvid] || '' : ''); setModal('lyrics'); }}><Mic2 size={19} /></IconButton><IconButton label="播放队列" active={modal === 'queue'} onClick={() => setModal('queue')}><ListMusic size={20} /></IconButton><Volume2 size={18} /><input type="range" aria-label="音量" min="0" max="1" step="0.01" value={library.volume} onChange={event => setLibrary(value => ({ ...value, volume: Number(event.target.value) }))} /></div></footer>
    <audio ref={audio} onEnded={() => skip(1, true)} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className={`modal ${modal === 'queue' ? 'queue-modal' : modal === 'lyrics' ? 'lyrics-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'new' ? '新建歌单' : modal === 'login' ? '扫码登录' : modal === 'add' ? '添加到歌单' : modal === 'lyrics' ? '歌词' : modal === 'queue' ? '播放队列' : modal === 'updates' ? '软件更新' : '账户与备份'} onClick={event => event.stopPropagation()}><IconButton label="关闭弹窗" onClick={() => setModal(null)}><X size={20} /></IconButton>
      {modal === 'updates' && <UpdatePanel />}
      {modal === 'login' && <div className="login-content"><span className="modal-icon"><img src="./app-icon.png" alt="BBPlayer 图标" /></span><h2>登录，听见你的收藏</h2><p>使用哔哩哔哩 App 扫码登录</p><div className="qr-code">{qr ? <img src={qr} alt="B 站登录二维码" /> : <LoaderCircle className="spin" />}</div><p className="qr-status">{qrStatus}</p><button className="text-button" onClick={() => setQrVersion(v => v + 1)}><RefreshCw size={15} />刷新二维码</button><small>登录凭据加密保存在这台电脑上。</small></div>}
      {modal === 'new' && <><span className="eyebrow">MAKE IT YOURS</span><h2>新建歌单</h2><p>给这一组好声音起个名字。</p><form onSubmit={event => { event.preventDefault(); createPlaylist(); }}><input className="text-input" autoFocus aria-label="歌单名称" placeholder="例如：下班路上的歌" maxLength={100} value={name} onChange={event => setName(event.target.value)} /><button className="primary" type="submit" disabled={!name.trim() || !ready}>创建歌单</button></form></>}
      {modal === 'add' && <><h2>添加到歌单</h2><p className="ellipsis">{target?.title}</p><div className="choose-playlist">{library.playlists.map(p => <button key={p.id} onClick={() => addTo(p.id)}><ListMusic size={19} /><span>{p.name}</span><small>{p.tracks.length} 首</small><Plus size={17} /></button>)}</div></>}
      {modal === 'queue' && <><h2>播放队列 <small>{queue.length} 首</small></h2><p>点击歌曲立即播放</p>{queue.length ? trackList(queue, true) : <div className="empty"><ListMusic /><h3>还没有待播放的音乐</h3></div>}{parts.length > 1 && <div className="parts"><h3>当前视频的分 P</h3>{parts.map(part => <button className="secondary" key={part.cid} onClick={() => current && run(play(current, undefined, part.cid))}>{part.title}</button>)}</div>}</>}
      {modal === 'lyrics' && <><span className="eyebrow">WORDS THAT STAY</span><h2 className="ellipsis">{current?.title}</h2><div className="lyric-preview">{lines.length ? lines.map((line, i) => <p className={i === activeLine ? 'active' : ''} key={`${line.time}-${i}`}>{line.text || '♪'}</p>) : <p>粘贴 LRC 歌词，跟着音乐一起唱。</p>}</div><details open={!lines.length}><summary>编辑 LRC 歌词</summary><textarea aria-label="LRC 歌词" placeholder={'[00:00.00] 第一行歌词\n[00:05.00] 第二行歌词'} value={lyricText} onChange={event => setLyricText(event.target.value)} maxLength={100000} /><button className="primary" onClick={() => { if (current) setLibrary(value => ({ ...value, lyrics: { ...value.lyrics, [current.bvid]: lyricText } })); notify('歌词已保存'); }}>保存歌词</button></details></>}
      {modal === 'settings' && <><span className="eyebrow">YOUR LIBRARY, YOUR WAY</span><h2>账户与歌单备份</h2><p>{account ? `已登录：${account.name}` : '当前未登录'}</p><label className="close-setting">关闭窗口时<select aria-label="关闭窗口时" value={closeBehavior} onChange={event => { const value = event.target.value as PlayerSession["closeBehavior"]; void window.desktop.setCloseBehavior(value).then(() => setCloseBehavior(value)).catch(fail); }}><option value="ask">每次询问</option><option value="tray">最小化到托盘，继续播放</option><option value="quit">退出程序</option></select></label><p className="small-note">启动后恢复上次歌曲与进度，点击播放继续。托盘菜单可控制播放或退出。</p><div className="settings-actions"><button className="secondary" onClick={() => run(window.desktop.saveLibrary(library).then(() => window.desktop.exportLibrary()).then(saved => { if (saved) notify('歌单备份已导出'); }))}><Download size={18} />导出歌单备份</button><button className="secondary" onClick={() => run(window.desktop.saveLibrary(library).then(() => window.desktop.importLibrary()).then(value => { if (value) { setLibrary(value); notify('歌单已合并导入'); } }))}><Upload size={18} />导入歌单备份</button>{account ? <button className="secondary danger" onClick={() => run(window.desktop.logout().then(() => { controller.pause(); setAccount(null); setFavorites([]); setModal(null); notify('已退出登录'); }))}><LogOut size={18} />退出登录</button> : <button className="primary" onClick={() => setModal('login')}>扫码登录</button>}</div><p className="small-note">备份包含歌单、播放历史和手动歌词，不包含登录凭据。<br />快捷键：空格播放 / 暂停，Ctrl + ← / → 切歌。<br />BBPlayer Desktop {__APP_VERSION__}</p></>}
    </section></div>}
  </div>;
}
