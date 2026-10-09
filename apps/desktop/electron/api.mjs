import { randomUUID } from 'node:crypto';
import { signWbi, normalizeTrack, parseVideoId, isMediaUrl } from './core.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export class BilibiliClient {
  constructor({ fetcher = fetch, cookie = '', onCookie = async () => {} } = {}) {
    this.fetcher = fetcher; this.cookie = cookie; this.onCookie = onCookie; this.keys = null; this.media = new Map(); this.qrKey = null;
  }
  async request(path, { passport = false, signed = false, params = {}, acceptNav = false } = {}) {
    const host = passport ? 'https://passport.bilibili.com' : 'https://api.bilibili.com';
    const query = signed ? await this.signedQuery(params) : new URLSearchParams(params).toString();
    const response = await this.fetcher(`${host}${path}${query ? `?${query}` : ''}`, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Cookie: this.cookie }, signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new Error(`B 站请求失败（HTTP ${response.status}），请稍后重试`);
    const json = await response.json();
    if (json.code !== 0 && !(acceptNav && json.code === -101)) throw new Error(json.code === -352 || json.code === -412 ? 'B 站暂时限制了请求，请登录或稍后重试' : `B 站：${json.message || '请求失败'}（${json.code}）`);
    return { data: json.data, response };
  }
  async signedQuery(params) {
    if (!this.keys || Date.now() - this.keys.time > 3600000) {
      const { data } = await this.request('/x/web-interface/nav', { acceptNav: true });
      const extract = value => new URL(value).pathname.split('/').at(-1).split('.')[0];
      this.keys = { img: extract(data.wbi_img.img_url), sub: extract(data.wbi_img.sub_url), time: Date.now() };
    }
    return signWbi(params, this.keys.img, this.keys.sub);
  }
  async account() {
    const { data } = await this.request('/x/web-interface/nav', { acceptNav: true });
    return data.isLogin ? { mid: data.mid, name: data.uname } : null;
  }
  async search(keyword, page = 1) {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200 || !Number.isInteger(page) || page < 1 || page > 100) throw new Error('搜索内容无效');
    const bvid = parseVideoId(keyword);
    if (bvid) return { tracks: [(await this.video(bvid)).track], pages: 1 };
    const { data } = await this.request('/x/web-interface/wbi/search/type', { signed: true, params: { keyword: keyword.trim(), search_type: 'video', page } });
    return { tracks: (data.result || []).map(normalizeTrack).filter(Boolean), pages: data.numPages || 1 };
  }
  async video(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) throw new Error('BV 号无效');
    const { data } = await this.request('/x/web-interface/view', { params: { bvid } });
    return { track: normalizeTrack(data), parts: (data.pages || []).map(p => ({ cid: p.cid, title: p.part, duration: p.duration })) };
  }
  async stream(bvid, cid) {
    const video = await this.video(bvid);
    const part = cid ? video.parts.find(p => p.cid === cid) : video.parts[0];
    if (!part) throw new Error('视频分 P 不存在');
    const { data } = await this.request('/x/player/wbi/playurl', { signed: true, params: { bvid, cid: part.cid, fnval: 4048, fnver: 0, fourk: 1, qn: 80 } });
    const audio = [...(data.dash?.audio || [])].filter(a => !a.codecs || a.codecs.startsWith('mp4a')).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    const candidates = audio ? [audio.baseUrl || audio.base_url, ...(audio.backupUrl || audio.backup_url || [])] : [data.durl?.[0]?.url, ...(data.durl?.[0]?.backup_url || [])];
    const url = candidates.find(isMediaUrl);
    if (!isMediaUrl(url)) throw new Error('这个视频没有可播放的音频流');
    const token = randomUUID();
    this.media.set(token, { url, expires: Date.now() + 2 * 3600000 });
    for (const [id, value] of this.media) if (value.expires < Date.now()) this.media.delete(id);
    if (this.media.size > 100) this.media.delete(this.media.keys().next().value);
    return { url: `bbmedia://audio/${token}`, track: { ...video.track, cid: part.cid, duration: part.duration }, parts: video.parts };
  }
  async fetchMedia(token, request) {
    const entry = this.media.get(token);
    if (!entry || entry.expires < Date.now()) return new Response('音频地址已过期，请重新播放', { status: 410 });
    let url = entry.url;
    const range = request.headers.get('range');
    for (let hop = 0; hop < 5; hop++) {
      if (!isMediaUrl(url)) return new Response('无效音频地址', { status: 403 });
      const response = await this.fetcher(url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', ...(range ? { Range: range } : {}) }, redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]) });
      if ([301,302,303,307,308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue; }
      const headers = new Headers({ 'Access-Control-Allow-Origin': '*', 'Content-Type': response.headers.get('content-type') || 'audio/mp4' });
      for (const name of ['content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) headers.set(name, response.headers.get(name));
      return new Response(response.body, { status: response.status, headers });
    }
    return new Response('音频重定向过多', { status: 502 });
  }
  async qrGenerate() {
    const { data } = await this.request('/x/passport-login/web/qrcode/generate', { passport: true });
    this.qrKey = data.qrcode_key;
    return { key: data.qrcode_key, url: data.url };
  }
  async qrPoll(key) {
    if (!key || key !== this.qrKey) throw new Error('二维码已失效，请刷新');
    const { data, response } = await this.request('/x/passport-login/web/qrcode/poll', { passport: true, params: { qrcode_key: key } });
    if (data.code === 0) {
      const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      if (!cookies.includes('SESSDATA=')) throw new Error('未收到登录凭据，请重新扫码');
      await this.onCookie(cookies); this.cookie = cookies; this.keys = null; this.qrKey = null;
      return { code: 0, account: await this.account() };
    }
    return { code: data.code };
  }
  async logout() { await this.onCookie(''); this.cookie = ''; this.keys = null; this.media.clear(); this.qrKey = null; }
  async favorites() {
    const user = await this.account();
    if (!user) throw new Error('请先登录 B 站账号');
    const { data } = await this.request('/x/v3/fav/folder/created/list-all', { params: { up_mid: user.mid } });
    return (data.list || []).map(f => ({ id: f.id, title: f.title, count: f.media_count }));
  }
  async favoriteTracks(id, page = 1) {
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isInteger(page) || page < 1 || page > 1000) throw new Error('收藏夹参数无效');
    const { data } = await this.request('/x/v3/fav/resource/list', { params: { media_id: id, pn: page, ps: 40 } });
    return { tracks: (data.medias || []).map(normalizeTrack).filter(Boolean), hasMore: !!data.has_more };
  }
}
