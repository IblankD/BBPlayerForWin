import test from 'node:test';
import assert from 'node:assert/strict';
import { signWbi, isMediaUrl, parseVideoId, normalizeTrack, validateLibrary } from '../electron/core.mjs';
import { BilibiliClient } from '../electron/api.mjs';
import { parseLrc } from '../src/lyrics.ts';

const bvid = 'BV1GJ411x7h7';
const track = { bvid, title: 'A song', artist: 'An artist', cover: 'https://i0.hdslb.com/test.jpg', duration: 120, cid: 1 };
const library = () => ({ playlists: [{ id: 'liked', name: '喜欢', tracks: [track] }], history: [track], lyrics: {}, volume: .7, repeat: 'all' });
test('WBI signature matches known reference, ignores insertion order and preserves caller input', () => {
  const params = { foo: '114', bar: '514', baz: '1919810' };
  const result = signWbi(params, '7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45', 1702204169000);
  // Independently checked using MD5(query + 'ea1db124af3c7062474693fa704f4ff8').
  assert.equal(result, 'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee');
  assert.equal(signWbi({ baz: '1919810', foo: '114', bar: '514' }, '7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45', 1702204169000), result);
  assert.equal(params.wts, undefined);
});
test('media proxy rejects local addresses, lookalike domains, credentials and unapproved ports', () => {
  assert.equal(isMediaUrl('https://upos-sz.bilivideo.com/a'), true);
  for (const url of ['http://upos.bilivideo.com/a', 'https://bilivideo.com.evil.test/a', 'https://evilbilivideo.com/a', 'https://127.0.0.1/a', 'https://user@upos.bilivideo.com/a', 'https://upos.bilivideo.com:8082/a']) assert.equal(isMediaUrl(url), false, url);
});
test('BV and URL input, title sanitization and duration normalization', () => {
  assert.equal(parseVideoId(`https://www.bilibili.com/video/${bvid}?p=1`), bvid);
  assert.equal(parseVideoId(bvid), bvid);
  assert.equal(parseVideoId('hello'), null);
  assert.equal(normalizeTrack({ bvid, title: '<em>Music</em> &amp; joy', author: 'UP', duration: '1:02:03' }).duration, 3723);
  assert.equal(normalizeTrack({ bvid, title: '<em>Music</em> &amp; joy' }).title, 'Music & joy');
  assert.equal(normalizeTrack({ bvid: '' }), null);
});
test('library save/load preserves metadata and rejects malformed or oversized playlists', () => {
  assert.deepEqual(validateLibrary(JSON.parse(JSON.stringify(library()))), library());
  assert.throws(() => validateLibrary({ playlists: [{ id: 'one', name: 'one', tracks: [] }, { id: 'one', name: 'two', tracks: [] }] }));
  assert.throws(() => validateLibrary({ playlists: Array.from({ length: 101 }, () => ({})) }));
  assert.throws(() => validateLibrary({ playlists: [{ id: 'a', name: ' ', tracks: [] }] }));
  const input = library(); input.volume = 99; assert.equal(validateLibrary(input).volume, 1);
});
test('LRC supports repeated timestamps, fractional seconds and offset', () => {
  assert.deepEqual(parseLrc('[offset:-500]\n[00:01.00][00:02.50]你好\n[ar:作者]'), [{ time: .5, text: '你好' }, { time: 2, text: '你好' }]);
});
test('stream chooses a trusted backup when primary CDN uses an unapproved port', async () => {
  const c = new BilibiliClient();
  c.video = async () => ({ track, parts: [{ cid: 1, duration: 120 }] });
  c.request = async () => ({ data: { dash: { audio: [{ codecs: 'mp4a.40.2', baseUrl: 'https://mcdn.bilivideo.cn:8082/a', backupUrl: ['https://not-trusted.test/a', 'https://upos.bilivideo.com/a'] }] } } });
  const stream = await c.stream(bvid);
  assert.equal(c.media.get(new URL(stream.url).pathname.slice(1)).url, 'https://upos.bilivideo.com/a');
  await assert.rejects(c.stream(bvid, 999), /分 P/);
});
test('proxy forwards Range, streams 206 response and never sends account cookies to CDN', async () => {
  let observed;
  const c = new BilibiliClient({ cookie: 'SESSDATA=secret', fetcher: async (_url, options) => { observed = options; return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-range': 'bytes 0-2/3', 'content-length': '3', 'content-type': 'audio/mp4' } }); } });
  c.media.set('test', { url: 'https://upos.bilivideo.com/a', expires: Date.now() + 10000 });
  const response = await c.fetchMedia('test', new Request('bbmedia://audio/test', { headers: { Range: 'bytes=0-2' } }));
  assert.equal(observed.headers.Range, 'bytes=0-2'); assert.equal(observed.headers.Cookie, undefined);
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-2/3');
  assert.equal((await response.arrayBuffer()).byteLength, 3);
});
test('proxy rejects redirects to local services before making a second request', async () => {
  let calls = 0;
  const c = new BilibiliClient({ fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } }); } });
  c.media.set('test', { url: 'https://upos.bilivideo.com/a', expires: Date.now() + 10000 });
  assert.equal((await c.fetchMedia('test', new Request('bbmedia://audio/test'))).status, 403); assert.equal(calls, 1);
  assert.equal((await c.fetchMedia('missing', new Request('bbmedia://audio/missing'))).status, 410);
});
test('QR login does not expose cookies, and logout clears credentials and media', async () => {
  let stored;
  const c = new BilibiliClient({ onCookie: async cookie => { stored = cookie; } });
  c.qrKey = 'active';
  c.request = async () => ({ data: { code: 0 }, response: new Response('{}', { headers: [['Set-Cookie', 'SESSDATA=test; HttpOnly'], ['Set-Cookie', 'bili_jct=csrf; Path=/']] }) });
  c.account = async () => ({ mid: 1, name: 'User' });
  await assert.rejects(c.qrPoll('wrong'), /失效/);
  assert.deepEqual(await c.qrPoll('active'), { code: 0, account: { mid: 1, name: 'User' } });
  assert.equal(stored, 'SESSDATA=test; bili_jct=csrf');
  c.media.set('token', {}); await c.logout(); assert.equal(stored, ''); assert.equal(c.media.size, 0);
});
test('API errors and invalid search parameters have actionable messages', async () => {
  const c = new BilibiliClient({ fetcher: async () => new Response(JSON.stringify({ code: -352, message: 'risk' })) });
  await assert.rejects(c.account(), /限制/);
  await assert.rejects(c.search('', 1), /无效/);
  await assert.rejects(c.favoriteTracks(-1), /无效/);
});
