import type { Part, PlayerSession, Track } from './types';

export interface PlaybackState { queue: Track[]; current: Track | null; parts: Part[]; playing: boolean; buffering: boolean; position: number; duration: number; status: string }
type Stream = (bvid: string, cid?: number) => Promise<{ url: string; track: Track; parts: Part[] }>;
const delays = [1000, 3000, 6000];

// All stream loads share one generation: late responses never replace a newer song.
export class PlaybackController {
  state: PlaybackState = { queue: [], current: null, parts: [], playing: false, buffering: false, position: 0, duration: 0, status: '' };
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private wantsPlay = false;
  private loading = false;
  private online = true;
  private refresh = true;
  private attempts = 0;
  private pending = 0;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private clockTimer: ReturnType<typeof setInterval> | undefined;
  private lastProgress = 0;
  private progressPosition = 0;
  private healthySince = 0;
  private stream: Stream;
  private changed: (value: PlaybackState) => void;
  private heard: (track: Track) => void;
  private notice: (text: string) => void;
  constructor(stream: Stream, changed: (value: PlaybackState) => void, heard: (track: Track) => void, notice: (text: string) => void) { this.stream = stream; this.changed = changed; this.heard = heard; this.notice = notice; }
  setCallbacks(heard: (track: Track) => void, notice: (text: string) => void) { this.heard = heard; this.notice = notice; }
  private update(value: Partial<PlaybackState>) { this.state = { ...this.state, ...value }; this.changed(this.state); }
  attach(audio: HTMLAudioElement) {
    this.audio = audio;
    const time = () => { if (!this.loading && !this.refresh) this.update({ position: audio.currentTime }); };
    const playing = () => { this.lastProgress = Date.now(); this.healthySince = Date.now(); this.update({ playing: true, buffering: false, status: '' }); };
    const pause = () => this.update({ playing: false });
    const waiting = () => { if (this.wantsPlay) this.update({ buffering: true }); };
    const error = () => { if (!this.loading && audio.getAttribute('src')) this.failed(new Error('音频地址失效或网络异常')); };
    const listeners = { timeupdate: time, playing, pause, waiting, stalled: waiting, error };
    for (const [event, listener] of Object.entries(listeners)) audio.addEventListener(event, listener);
    this.clockTimer = setInterval(() => {
      if (!this.wantsPlay || this.loading || this.refresh || !this.online || audio.ended) return;
      if (Math.abs(audio.currentTime - this.progressPosition) > .05) {
        this.progressPosition = audio.currentTime; this.lastProgress = Date.now();
        if (Date.now() - this.healthySince > 5000) this.attempts = 0;
      } else if (Date.now() - this.lastProgress > 12000) this.failed(new Error('缓冲超时'));
    }, 1000);
    return () => {
      this.cancel(); clearInterval(this.clockTimer);
      for (const [event, listener] of Object.entries(listeners)) audio.removeEventListener(event, listener);
      this.audio = null;
    };
  }
  private cancel() {
    this.generation++; this.abort?.abort(); this.abort = null;
    clearTimeout(this.retryTimer); this.retryTimer = undefined; this.loading = false;
  }
  restore(session: PlayerSession) {
    this.cancel(); this.wantsPlay = false; this.refresh = true; this.pending = session.position;
    this.update({ queue: session.queue, current: session.current, position: session.position, duration: session.current?.duration || 0, parts: [], playing: false, buffering: false, status: session.current ? '已恢复上次进度，点击播放继续' : '' });
  }
  setQueue(queue: Track[]) { this.update({ queue }); }
  play(track: Track, items?: Track[], cid?: number) {
    this.cancel(); this.audio?.pause(); this.audio?.removeAttribute('src'); this.audio?.load();
    this.wantsPlay = true; this.attempts = 0; this.refresh = true; this.pending = 0;
    const current = { ...track, cid: cid ?? track.cid };
    const queue = items || (this.state.queue.some(t => t.bvid === track.bvid) ? this.state.queue : [...this.state.queue, current]);
    this.update({ queue, current, position: 0, duration: current.duration, parts: [], playing: false, buffering: true, status: '' });
    void this.load();
  }
  seek(position: number) {
    const value = Math.max(0, Math.min(position, Math.max(0, this.state.duration - .25)));
    this.pending = value;
    if (this.audio && !this.refresh && !this.loading) this.audio.currentTime = value;
    this.update({ position: value });
  }
  pause() {
    this.wantsPlay = false;
    if (this.loading || this.retryTimer) this.refresh = true;
    this.cancel();
    this.audio?.pause(); this.update({ playing: false, buffering: false, status: this.refresh ? '已暂停，点击播放重试' : '' });
  }
  toggle() { if (this.wantsPlay) this.pause(); else this.resume(); }
  resume() {
    if (!this.state.current || !this.audio) return;
    if (this.wantsPlay && (this.loading || this.retryTimer)) return;
    this.wantsPlay = true; this.attempts = 0;
    if (this.refresh || !this.audio.getAttribute('src') || this.audio.error) { this.pending = this.state.position; void this.load(); }
    else { const id = this.generation; this.lastProgress = Date.now(); void this.audio.play().catch(cause => { if (id === this.generation) this.failed(cause); }); }
  }
  setOnline(value: boolean) {
    this.online = value;
    if (!value && this.wantsPlay && this.state.current) {
      this.pending = this.state.position; this.refresh = true; this.cancel(); this.audio?.pause();
      this.update({ playing: false, buffering: false, status: '网络已断开，联网后继续播放' });
    } else if (value && this.wantsPlay && this.refresh && !this.loading && !this.retryTimer) {
      this.attempts = 0; void this.load();
    }
  }
  private waitMetadata(audio: HTMLAudioElement, url: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', loaded); audio.removeEventListener('error', failed); signal.removeEventListener('abort', canceled); };
      const loaded = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error('音频地址失效或网络异常')); };
      const canceled = () => { clean(); reject(new Error('播放请求已取消')); };
      const timer = setTimeout(() => { clean(); reject(new Error('音频加载超时')); }, 20000);
      audio.addEventListener('loadedmetadata', loaded); audio.addEventListener('error', failed); signal.addEventListener('abort', canceled);
      audio.src = url; audio.load();
    });
  }
  private async load() {
    if (!this.audio || !this.state.current || !this.wantsPlay) return;
    if (!this.online) { this.update({ buffering: false, status: '网络已断开，联网后继续播放' }); return; }
    const id = ++this.generation;
    const audio = this.audio;
    const track = this.state.current;
    this.abort?.abort(); this.abort = new AbortController();
    this.loading = true; this.refresh = true; audio.pause();
    this.update({ playing: false, buffering: true });
    try {
      const result = await this.stream(track.bvid, track.cid);
      if (id !== this.generation) return;
      await this.waitMetadata(audio, result.url, this.abort.signal);
      if (id !== this.generation) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : result.track.duration;
      const offset = Math.min(this.pending, Math.max(0, duration - .25));
      audio.currentTime = offset;
      this.refresh = false; this.loading = false;
      this.lastProgress = Date.now(); this.progressPosition = offset; this.healthySince = Date.now();
      this.update({ current: result.track, parts: result.parts, position: offset, duration });
      await audio.play();
      if (id !== this.generation) return;
      this.heard(result.track);
    } catch (cause) { if (id === this.generation) { this.loading = false; this.failed(cause); } }
  }
  private failed(cause: unknown) {
    if (this.retryTimer) return;
    const message = cause instanceof Error ? cause.message : '播放失败';
    this.pending = this.state.position; this.refresh = true;
    this.audio?.pause(); this.update({ playing: false, buffering: false });
    if (!this.wantsPlay) return;
    if (!this.online) { this.update({ status: '网络已断开，联网后继续播放' }); return; }
    if (this.attempts >= delays.length || /[（(]-(?:404|403|10403|352|412)[）)]|没有可播放|分 P 不存在/.test(message)) {
      this.wantsPlay = false;
      this.update({ status: '恢复失败，点击播放重试或切换下一首' }); this.notice(message); return;
    }
    const delay = delays[this.attempts++];
    this.update({ status: `正在恢复播放（${this.attempts}/${delays.length}）…` });
    const id = this.generation;
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (id === this.generation && this.wantsPlay) void this.load(); }, delay);
  }
  checkpoint() { return { queue: this.state.queue, current: this.state.current, position: this.refresh ? this.state.position : this.audio?.currentTime || this.state.position }; }
}
