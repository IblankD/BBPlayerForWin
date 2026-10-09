import { createHash } from 'node:crypto';

// Adapted from apps/mobile/src/lib/api/bilibili/wbi.ts.
const mixin = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function signWbi(params, imgKey, subKey, now = Date.now()) {
  const key = mixin.map(i => (imgKey + subKey)[i]).join('').slice(0, 32);
  const values = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(values).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}
export function isMediaUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['bilivideo.com', 'bilivideo.cn'].some(d => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}
export function cleanTitle(text = '') {
  return String(text).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
export function imageUrl(value = '') {
  const raw = String(value).startsWith('//') ? `https:${value}` : String(value).replace(/^http:/, 'https:');
  try { const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'hdslb.com' || u.hostname.endsWith('.hdslb.com')) ? raw : ''; } catch { return ''; }
}
export function parseVideoId(value) {
  const text = String(value).trim();
  return text.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:$|[/?#])/i)?.[1] || text.match(/\b(BV[0-9A-Za-z]{10})\b/i)?.[1] || null;
}
export function normalizeTrack(item) {
  const bvid = item.bvid || item.bv_id;
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) return null;
  const parts = String(item.duration || '').split(':').map(Number);
  const duration = typeof item.duration === 'number' ? item.duration : parts.reduce((total, part) => total * 60 + (part || 0), 0);
  return { bvid, title: cleanTitle(item.title).slice(0, 500), artist: String(item.artist || item.author || item.upper?.name || item.owner?.name || '').slice(0, 200), cover: imageUrl(item.pic || item.cover), duration, cid: Number(item.cid) || undefined };
}
export function validateLibrary(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.playlists) || input.playlists.length > 100) throw new Error('歌单数据格式无效');
  const ids = new Set();
  const playlists = input.playlists.map(p => {
    if (typeof p.id !== 'string' || !p.id || p.id.length > 100 || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.tracks) || p.tracks.length > 10000) throw new Error('歌单数据格式无效');
    ids.add(p.id);
    return { id: p.id.slice(0, 100), name: p.name.trim().slice(0, 100), tracks: p.tracks.map(normalizeTrack).filter(Boolean) };
  });
  const history = Array.isArray(input.history) ? input.history.slice(0, 100).map(normalizeTrack).filter(Boolean) : [];
  const lyrics = {};
  for (const [id, text] of Object.entries(input.lyrics || {}).slice(0, 1000)) if (/^BV[0-9A-Za-z]{10}$/.test(id) && typeof text === 'string') lyrics[id] = text.slice(0, 100000);
  return { playlists, history, lyrics, volume: Math.max(0, Math.min(1, Number(input.volume) || 0)), repeat: ['off', 'all', 'one'].includes(input.repeat) ? input.repeat : 'all' };
}
