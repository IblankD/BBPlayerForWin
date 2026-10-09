import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../src/player.ts';
import { validateSession } from '../electron/core.mjs';

const track = { bvid: 'BV1GJ411x7h7', title: 'Song', artist: 'Artist', cover: '', duration: 120, cid: 1 };
const other = { ...track, bvid: 'BV1xx411c7mD', title: 'Other', cid: 2 };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
class Audio extends EventTarget {
  src = ''; currentTime = 0; duration = 120; paused = true; ended = false; error = null;
  getAttribute() { return this.src || null; }
  removeAttribute() { this.src = ''; }
  load() { this.currentTime = 0; if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
function fixture(t, stream = async (bvid, cid) => ({ url: `bbmedia://audio/${bvid}`, track: { ...(bvid === other.bvid ? other : track), cid }, parts: [] })) {
  const audio = new Audio(); const heard = []; const notices = [];
  const player = new PlaybackController(stream, () => {}, value => heard.push(value), value => notices.push(value));
  const detach = player.attach(audio); t.after(detach);
  return { player, audio, heard, notices };
}
test('session migrates an old profile, normalizes queue and never stores URLs or credentials', () => {
  assert.deepEqual(validateSession(), { queue: [], current: null, position: 0, shuffle: false, view: 'home', closeBehavior: 'ask' });
  const saved = validateSession({ queue: [null, { bvid: 'bad' }], current: { ...track, url: 'secret', cookie: 'secret' }, position: Infinity, view: 'search', closeBehavior: 'tray', shuffle: true });
  assert.equal(saved.queue.length, 1); assert.equal(saved.position, 0); assert.equal(saved.current.url, undefined); assert.equal(saved.current.cookie, undefined); assert.equal(saved.closeBehavior, 'tray');
  assert.equal(validateSession({ current: track, position: 500 }).position, 119.75);
});
test('restoring keeps playback paused and gets a fresh stream only on resume at the saved part and offset', async t => {
  const calls = [];
  const { player, audio } = fixture(t, async (bvid, cid) => { calls.push({ bvid, cid }); return { url: 'bbmedia://audio/fresh', track, parts: [] }; });
  player.restore(validateSession({ current: track, position: 60, queue: [track, other] }));
  assert.equal(calls.length, 0); assert.equal(audio.paused, true); assert.equal(player.state.position, 60);
  player.toggle(); await flush();
  assert.deepEqual(calls, [{ bvid: track.bvid, cid: 1 }]); assert.equal(audio.currentTime, 60); assert.equal(audio.paused, false);
});
test('late stream results cannot replace a newer selection or start playback after pause', async t => {
  let resolveOld;
  const { player, audio } = fixture(t, async bvid => bvid === track.bvid ? new Promise(resolve => { resolveOld = resolve; }) : { url: 'bbmedia://audio/new', track: other, parts: [] });
  player.play(track); player.play(other); await flush();
  resolveOld({ url: 'bbmedia://audio/old', track, parts: [] }); await flush();
  assert.equal(audio.src, 'bbmedia://audio/new'); assert.equal(player.state.current.bvid, other.bvid);
  player.play(track); player.pause(); resolveOld({ url: 'bbmedia://audio/old', track, parts: [] }); await flush();
  assert.equal(audio.paused, true); assert.equal(audio.src, '');
});
test('network recovery retains position; pausing offline cancels automatic resume', async t => {
  const { player, audio } = fixture(t);
  player.play(track); await flush(); player.seek(45); player.setOnline(false);
  assert.equal(audio.paused, true); assert.equal(player.state.position, 45);
  player.setOnline(true); await flush(); assert.equal(audio.currentTime, 45); assert.equal(audio.paused, false);
  player.setOnline(false); player.pause(); player.setOnline(true); await flush(); assert.equal(audio.paused, true);
});
test('expired audio refreshes the stream with the same progress and part', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const { player, audio } = fixture(t, async () => ({ url: `bbmedia://audio/${++calls}`, track, parts: [] }));
  player.play(track); await flush(); player.seek(60);
  audio.dispatchEvent(new Event('error')); t.mock.timers.tick(1000); await flush();
  assert.equal(calls, 2); assert.equal(audio.currentTime, 60); assert.equal(audio.paused, false);
});
test('retries are bounded and pending retries cannot interrupt a new song', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const { player, audio, notices } = fixture(t, async bvid => { calls++; if (bvid === track.bvid) throw new Error('network failure'); return { url: 'bbmedia://audio/new', track: other, parts: [] }; });
  player.play(track); await flush();
  for (const delay of [1000, 3000, 6000]) { t.mock.timers.tick(delay); await flush(); }
  assert.equal(calls, 4); assert.equal(notices.length, 1); assert.equal(player.state.buffering, false);
  t.mock.timers.tick(30000); await flush(); assert.equal(calls, 4);
  player.play(track); await flush(); player.play(other); await flush(); t.mock.timers.tick(10000); await flush();
  assert.equal(audio.src, 'bbmedia://audio/new'); assert.equal(calls, 6);
});
test('pausing cancels a scheduled retry; inaccessible videos stop without retrying', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const { player, notices } = fixture(t, async bvid => { calls++; throw new Error(bvid === other.bvid ? 'B 站：视频不存在（-404）' : 'network failure'); });
  player.play(track); await flush(); player.pause(); t.mock.timers.tick(10000); await flush(); assert.equal(calls, 1);
  player.play(other); await flush(); t.mock.timers.tick(10000); await flush(); assert.equal(calls, 2); assert.equal(notices.length, 1);
});
test('a stalled stream refreshes rather than buffering forever', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 10000 });
  let calls = 0;
  const { player, audio } = fixture(t, async () => ({ url: `bbmedia://audio/${++calls}`, track, parts: [] }));
  player.play(track); await flush(); player.seek(30);
  t.mock.timers.tick(1000); await flush();
  t.mock.timers.tick(13000); await flush();
  t.mock.timers.tick(1000); await flush();
  assert.equal(calls, 2); assert.equal(audio.currentTime, 30);
});
