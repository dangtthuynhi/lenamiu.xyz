/* Sảnh cổ vũ LenaMiu — lenamiu.xyz/cheer/
   Chọn bài / video / chỗ ngồi, xem video trên sân khấu, gõ lightstick cổ vũ (cả sảnh sáng theo),
   và trò chơi gõ nhịp: trái tim chạy trên làn, gõ khi chạm vòng (nốt soạn sẵn ở charts/, tạo bằng tools/make-chart.mjs).
   - Danh sách bài: songs.js (window.LM_CHEER). Chữ giao diện: ../i18n.js (khoá c.*). Đầu trang, ngôn ngữ: ../site.js (window.LM).
   - Gõ = chạm lightstick / chạm làn nốt / phím Space, F, J. Lúc gõ tính theo thời điểm của sự kiện (e.timeStamp)
     so với giây của video (đã làm mượt, cộng độ trễ người chơi tự căn ở mục "Căn nhịp").
   - Video YouTube chạy qua IFrame API (để biết đang phát / đang ở giây nào → đám đông lắc theo nhịp),
     video trên máy chủ riêng chạy bằng <video>.
   - Sảnh 3D vẽ bằng three.js (tải từ jsDelivr). Máy không có WebGL hoặc tải lỗi thì vẫn xem + cổ vũ được, chỉ thiếu sảnh.
   - Link: ?song=<id>&v=<thứ tự video, từ 0>&seat=<front|floor|back|balcony>.
     Chỗ ngồi, màu lightstick, bật / tắt tiếng gõ, tổng số lần cổ vũ: nhớ trên máy người xem (localStorage).
*/
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js';

const LM = window.LM || { t: (k) => k, tr: (o, f) => (o ? o[f] : ''), lang: 'vi', locale: 'vi-VN' };
const { t, tr } = LM;
const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const SITE = (window.VIETSUB || {}).site || {};
const VIDEO_BASE = String(SITE.videoBase || '').trim().replace(/\/*$/, '/');

const SEAT_KEY = 'lm_cheer_seat', TEAM_KEY = 'lm_cheer_team', SOUND_KEY = 'lm_cheer_sound', TOTAL_KEY = 'lm_cheer_total';
const LEVEL_KEY = 'lm_cheer_level', OFFSET_KEY = 'lm_cheer_offset', BEST_PREFIX = 'lm_cheer_best:', SFX_VOL_KEY = 'lm_cheer_sfxvol';
// cùng số ?v= với trang (GitHub Pages giữ file 10 phút: có ?v= thì sửa nốt là thấy ngay)
const V = new URL(import.meta.url).searchParams.get('v') || String(Date.now());

/* Trò chơi gõ nhịp */
const LEVELS = ['easy', 'normal', 'hard', 'off'];                 // off = không có nốt, cổ vũ tự do
const APPROACH = { easy: 2.2, normal: 1.8, hard: 1.5 };          // số giây trái tim chạy từ mép phải tới vòng
const WIN = { perfect: 0.05, great: 0.09, good: 0.135 };          // gõ lệch tối đa (giây) cho từng mức chấm
const POINTS = { perfect: 100, great: 70, good: 40 };             // nốt to: gấp đôi; combo cộng thêm tới +100%
const ENERGY = { perfect: 6, great: 5, good: 3, miss: -3, free: 1.5, idle: 5.5 };   // năng lượng khán đài mỗi lần gõ

// Màu lightstick hai phe (giống thanh PK của site): LenaMiu hồng, MiuLena tím
const TEAM = { a: '#ff5c9d', b: '#9a6bff' };
// Màu đèn sân khấu theo ô hall của bài: beams = cột đèn quét, led = màn LED sau sân khấu, light = đèn rọi đám đông
const THEMES = {
  pink:   { beams: ['#ff4f9a', '#ff8cc6', '#c86bff'], led: ['#ff3d8f', '#ff9bd0', '#8a4dff'], light: '#ff6fb0', glow: '#ff5fa2' },
  red:    { beams: ['#ff2d55', '#ff6b81', '#ff9a7a'], led: ['#d9143a', '#ff7a90', '#a3124f'], light: '#ff4d6d', glow: '#ff3358' },
  violet: { beams: ['#9a5cff', '#d38bff', '#ff6fb5'], led: ['#7a3dff', '#c98cff', '#ff5fa8'], light: '#a777ff', glow: '#9b6bff' },
  sunset: { beams: ['#ff7a45', '#ffb35c', '#ff4f8b'], led: ['#ff5a3c', '#ffc06a', '#ff3d8f'], light: '#ff8f5a', glow: '#ff7a55' },
  ocean:  { beams: ['#3fa9ff', '#6fe3ff', '#8c62ee'], led: ['#2a7dff', '#7fe8ff', '#8c62ee'], light: '#5ab4ff', glow: '#4aa8ff' },
};
// Chỗ ngồi: vị trí mắt người xem và điểm nhìn (mét; sân khấu ở phía z âm, khán đài trên ở phía z dương)
const SEATS = [
  { id: 'front',   pos: [0.6, 1.72, -20.6], look: [0, 5.2, -31] },
  { id: 'floor',   pos: [-1.3, 1.72, -6.5], look: [0, 4.4, -31] },
  { id: 'back',    pos: [1.6, 1.72, 8.6],   look: [0, 4.0, -31] },
  { id: 'balcony', pos: [0, 7.3, 23.5],     look: [0, 2.2, -22] },
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function store(key, val) {
  try { return val === undefined ? localStorage.getItem(key) : localStorage.setItem(key, val); }
  catch (e) { return null; }
}
function norm(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
// Nhận ID trần hoặc mọi kiểu link: youtu.be/…, watch?v=…, /shorts/…, /embed/…, /live/…
function ytId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([\w-]{11})/);
  return m ? m[1] : '';
}
// Video trên máy chủ riêng: tên file trên kho R2 (ghép với site.videoBase trong ../videos.js) hoặc nguyên link https://
function fileUrl(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (!VIDEO_BASE || VIDEO_BASE === '/') { console.warn('[cheer] Có video "' + s + '" nhưng chưa điền videoBase trong videos.js.'); return ''; }
  return VIDEO_BASE + s.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || 0));
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/* ================= danh sách bài ================= */
const usedIds = new Set();
const SONGS = ((window.LM_CHEER || {}).songs || []).map((s, i) => {
  if (!s) return null;
  const versions = (Array.isArray(s.versions) ? s.versions : []).filter(Boolean).map((v, j) => ({
    named: !!String(tr(v, 'label') || '').trim(),   // có tên riêng (vd ghi công kênh quay fancam) → hiện dưới tên bài
    label: String(tr(v, 'label') || '').trim() || 'Video ' + (j + 1),
    yt: ytId(v.youtube), file: fileUrl(v.video),
    start: Math.max(0, num(v.start) || 0), anchor: num(v.anchor),
  })).filter((v) => v.yt || v.file);
  let id = slug(s.id || s.title) || 'bai-' + (i + 1);
  while (usedIds.has(id)) id += '-2';
  usedIds.add(id);
  const bpm = num(s.bpm);
  return {
    id, versions,
    title: String(tr(s, 'title') || '').trim(), artist: String(tr(s, 'artist') || '').trim(),
    bpm: bpm >= 40 && bpm <= 240 ? bpm : 0, theme: THEMES[s.hall] || THEMES.pink,
    chart: /^[\w.-]+\.json$/.test(String(s.chart || '')) ? String(s.chart) : '',
    key: typeof s.key === 'string' ? s.key.trim() : '',
  };
}).filter((s) => s && s.title && s.versions.length);

/* ================= trạng thái ================= */
const params = new URLSearchParams(location.search);
const seatOk = (id) => SEATS.some((s) => s.id === id);
let songI = Math.max(0, SONGS.findIndex((s) => s.id === params.get('song')));
let verI = SONGS.length ? clampInt(params.get('v'), 0, SONGS[songI].versions.length - 1) : 0;
let seatId = [params.get('seat'), store(SEAT_KEY)].find(seatOk) || 'floor';
let team = store(TEAM_KEY) === 'b' ? 'b' : 'a';
let soundOn = store(SOUND_KEY) !== '0';
let total = Math.max(0, parseInt(store(TOTAL_KEY), 10) || 0);
let level = LEVELS.includes(store(LEVEL_KEY)) ? store(LEVEL_KEY) : 'normal';
let offsetMs = Math.max(-300, Math.min(300, parseInt(store(OFFSET_KEY), 10) || 0));   // độ trễ người chơi tự căn
let started = false;        // người xem đã bấm phát một lần → đổi bài / video thì phát luôn
let hall = null;            // sảnh 3D (null khi chưa tải xong hoặc máy không vẽ được)
const song = () => SONGS[songI];

function syncUrl() {
  try {
    const u = new URL(location.href);
    if (song()) u.searchParams.set('song', song().id); else u.searchParams.delete('song');
    if (verI) u.searchParams.set('v', String(verI)); else u.searchParams.delete('v');
    u.searchParams.set('seat', seatId);
    history.replaceState(null, '', u);
  } catch (e) { /* bỏ qua */ }
}

/* ================= trình phát ================= */
const player = { kind: '', yt: null, vd: null, playing: false, ended: false };
let playToken = 0;
let ytApi = null;
function loadYtApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; reject(new Error('iframe_api')); };
    document.head.append(s);
    setTimeout(() => reject(new Error('timeout')), 12000);
  });
  return ytApi;
}
function videoTime() {
  try {
    if (player.kind === 'yt' && player.yt && player.yt.getCurrentTime) return player.yt.getCurrentTime();
    if (player.kind === 'file' && player.vd) return player.vd.currentTime;
  } catch (e) { /* bỏ qua */ }
  return null;
}
// Giây của video tại thời điểm ms (performance.now / e.timeStamp / giờ của khung hình).
//  - <video> (máy chủ riêng): currentTime chính xác sẵn, chỉ lùi lại phần thời gian từ ms tới lúc đọc.
//  - YouTube: giây báo qua iframe theo từng nấc, hơi trễ. Khi đang phát, (giây video − giờ máy) gần như không đổi;
//    lấy giá trị lớn nhất trong 0.5 giây gần đây (mẫu mới nhất, ít trễ nhất). Tua / giật (lệch > 0.25 giây) thì đo lại.
const clk = { d: [], est: null };
function songTime(ms) {
  const raw = videoTime();
  if (raw == null) return null;
  if (!player.playing) { clk.d.length = 0; clk.est = null; return raw; }
  const pnow = performance.now();
  const d = raw - pnow / 1000;                       // so với lúc đọc (không phải lúc bắt đầu khung hình)
  if (player.kind === 'file') { clk.est = d; return ms / 1000 + d; }
  if (clk.est != null && Math.abs(d - clk.est) > 0.25) clk.d.length = 0;
  clk.d.push({ at: pnow, d });
  while (clk.d.length > 1 && pnow - clk.d[0].at > 500) clk.d.shift();
  let est = -Infinity;
  for (const x of clk.d) if (x.d > est) est = x.d;
  clk.est = est;
  return ms / 1000 + est;
}
// lúc gõ (giữa hai khung hình): không thêm mẫu
function songTimeAt(ms) {
  if (player.playing && player.kind === 'file' && player.vd) return player.vd.currentTime - (performance.now() - ms) / 1000;
  return player.playing && clk.est != null ? ms / 1000 + clk.est : videoTime();
}
function stopPlayer() {
  playToken++;
  if (player.yt) { try { player.yt.destroy(); } catch (e) { /* bỏ qua */ } }
  Object.assign(player, { kind: '', yt: null, vd: null, playing: false, ended: false });
  $('screen').textContent = '';
}
function showScreen(play) {
  stopPlayer();
  const s = song();
  if (!s) {
    $('screen').append(el('div', 'empty', t('c.empty')));
    return;
  }
  const v = s.versions[verI];
  if (!play) return facade(s, v);
  started = true;
  paintGame();
  if (v.file) playFile(v); else playYt(v, s);
}
// Chưa bấm phát thì chỉ hiện ảnh bìa (trang mở nhanh, chưa tải YouTube)
function facade(s, v) {
  const b = el('button', 'facade');
  b.type = 'button';
  b.setAttribute('aria-label', t('c.play', { title: s.title }));
  const thumb = v.yt ? 'https://i.ytimg.com/vi/' + v.yt + '/hqdefault.jpg'
    : /\.mp4(\?|$)/i.test(v.file) ? v.file.replace(/\.mp4(\?|$)/i, '.jpg$1') : '';
  if (thumb) {
    const img = el('img');
    img.alt = '';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = thumb;
    b.append(img);
  }
  const cap = el('span', 'cap', s.title);
  cap.append(el('small', '', [s.artist, v.named ? v.label : ''].filter(Boolean).join(' · ')));
  b.append(el('span', 'play'), cap);
  b.addEventListener('click', () => showScreen(true));
  $('screen').append(b);
}
function playFile(v) {
  const vd = el('video');
  vd.controls = true;
  vd.playsInline = true;
  vd.setAttribute('playsinline', '');
  vd.preload = 'auto';
  vd.src = v.file + (v.start ? '#t=' + v.start : '');
  vd.addEventListener('playing', () => { player.playing = true; player.ended = false; });
  ['pause', 'ended', 'waiting', 'emptied'].forEach((ev) => vd.addEventListener(ev, () => { player.playing = false; }));
  vd.addEventListener('ended', () => { player.ended = true; });
  Object.assign(player, { kind: 'file', vd });
  $('screen').append(vd);
  const p = vd.play();
  if (p && p.catch) p.catch(() => { /* trình duyệt chặn tự phát: người xem bấm nút phát */ });
}
function playYt(v, s) {
  const box = el('div');
  $('screen').append(box);
  player.kind = 'yt';
  const token = playToken;
  const vars = { autoplay: 1, playsinline: 1, rel: 0, hl: LM.lang === 'zh' ? 'zh-CN' : LM.lang };
  if (v.start) vars.start = Math.floor(v.start);
  loadYtApi().then((YT) => {
    if (token !== playToken) return;
    player.yt = new YT.Player(box, {
      host: 'https://www.youtube-nocookie.com', videoId: v.yt, playerVars: vars,
      events: {
        onReady: (e) => { try { e.target.playVideo(); } catch (err) { /* bỏ qua */ } keepKeys(); },
        onStateChange: (e) => {   // 1 = đang phát, 0 = hết video
          player.playing = e.data === 1;
          player.ended = e.data === 0;
          if (player.playing) keepKeys();
        },
      },
    });
  }).catch(() => {
    if (token !== playToken) return;
    // không tải được IFrame API (bị chặn...): nhúng thẳng, chỉ không biết video đang phát hay dừng
    const f = el('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + v.yt + '?autoplay=1&rel=0&playsinline=1' + (vars.start ? '&start=' + vars.start : '');
    f.title = s.title;
    f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    box.replaceWith(f);
    player.kind = 'iframe';
  });
}
// Khung YouTube tự giữ bàn phím khi bắt đầu phát (và khi người xem bấm vào nó): lúc đó Space là dừng video,
// F là toàn màn hình, J là tua lùi — không cổ vũ được. Nên mỗi lần video bắt đầu phát, trả bàn phím về trang.
function keepKeys() {
  const back = () => {
    const a = document.activeElement;
    if (a && a.tagName === 'IFRAME' && $('screen').contains(a)) $('main').focus({ preventScroll: true });
  };
  setTimeout(back, 50);
  setTimeout(back, 700);
}
// Phách nhạc hiện tại (số thực, tính từ ô anchor của video) khi đang phát bài có bpm; không biết thì null
function beatPos(time) {
  const s = song();
  const bpm = (game.chart && game.chart.bpm) || (s && s.bpm);
  if (!player.playing || !s || !bpm || time == null) return null;
  return (time - (s.versions[verI].anchor || 0)) * bpm / 60;
}

/* ================= trò chơi gõ nhịp ================= */
// Nốt trong charts/<bài>.json ghi theo số phách từ mốc phách; đổi ra giây của video đang chọn: anchor + phách × 60 / bpm.
// Trạng thái: idle (chờ bấm Bắt đầu) → play → done (bảng kết quả). Đổi bài / video / mức là về idle.
const game = {
  state: 'idle', chart: null, notes: [], i: 0, endT: 0, lastT: null,
  score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 }, fx: [],
};
const charts = new Map();
function loadChart(s) {
  if (!charts.has(s.chart)) {
    charts.set(s.chart, fetch('charts/' + encodeURIComponent(s.chart) + '?v=' + V)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c || !(Number(c.bpm) > 0)) return null;
        const lv = {};
        for (const k of ['easy', 'normal', 'hard']) {
          lv[k] = (Array.isArray(c[k]) ? c[k] : []).filter((n) => Array.isArray(n) && Number.isFinite(Number(n[0])))
            .map((n) => ({ b: Number(n[0]), big: !!n[1] })).sort((a, b) => a.b - b.b);
        }
        return { bpm: Number(c.bpm), key: typeof c.key === 'string' ? c.key : '', lv };
      })
      .catch(() => null));
  }
  return charts.get(s.chart);
}
// đổi bài / video: tải nốt của bài (nếu có), về trạng thái chờ
function prepareSong() {
  const s = song();
  game.chart = null;
  resetRun('idle');
  paintGame();
  if (!s || !s.chart) return;
  loadChart(s).then((c) => {
    if (song() !== s) return;
    game.chart = c;
    resetRun('idle');
    paintGame();
  });
}
function resetRun(state) {
  const s = song(), c = game.chart;
  const v = s && s.versions[verI];
  game.notes = !c || level === 'off' || !v || v.anchor == null ? []
    : c.lv[level].map((n) => ({ t: v.anchor + n.b * 60 / c.bpm, big: n.big, st: 0, j: '', pts: 0 }));   // st: 0 chờ, 1 trúng, 2 trượt, 3 bỏ qua
  Object.assign(game, {
    state, i: 0, lastT: null, score: 0, combo: 0, maxCombo: 0, fx: [],
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    endT: game.notes.length ? game.notes[game.notes.length - 1].t + 2 : 0,
  });
  $('results').hidden = true;
  paintHud();
}
const playable = () => !!(game.chart && level !== 'off' && game.notes.length);
function startGame() {
  if (!playable()) return;
  resetRun('play');
  paintGame();
  catSay(t('c.cat.go'), 1400);
  const v = song().versions[verI];
  try {
    if (player.kind === 'yt' && player.yt && player.yt.seekTo) { player.yt.seekTo(v.start || 0, true); player.yt.playVideo(); return; }
    if (player.kind === 'file' && player.vd) {
      player.vd.currentTime = v.start || 0;
      const p = player.vd.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
  } catch (e) { /* bỏ qua: mở lại trình phát bên dưới */ }
  showScreen(true);   // chưa mở video (hoặc trình phát lạ): mở và tự phát từ đầu
}
// mỗi khung hình: nốt đi qua vòng mà chưa gõ → trượt; phát hiện tua; hết bài → kết quả
function updateGame(st) {
  if (game.state !== 'play' || st == null) return;
  const tj = st - offsetMs / 1000;
  if (game.lastT != null) {
    if (st < game.lastT - 0.6) rewindTo(tj);                 // tua lùi: chơi lại các nốt phía sau
    else if (st > game.lastT + 1.2) skipTo(tj);              // tua tới: nốt bị bỏ qua không tính trượt
  }
  game.lastT = st;
  while (game.i < game.notes.length) {
    const n = game.notes[game.i];
    if (n.st) { game.i++; continue; }
    if (tj - n.t > WIN.good) { judgeNote(n, 'miss'); game.i++; continue; }
    break;
  }
  if (tj > game.endT || player.ended) finishGame();
}
function rewindTo(tj) {
  for (const n of game.notes) {
    if (!n.st || n.t <= tj - WIN.good) continue;
    if (n.j && n.j !== 'skip') { game.counts[n.j]--; game.score -= n.pts; }
    Object.assign(n, { st: 0, j: '', pts: 0 });
  }
  game.i = 0;
  game.combo = 0;
  paintHud();
}
function skipTo(tj) {
  for (const n of game.notes) if (!n.st && n.t < tj - WIN.good) Object.assign(n, { st: 3, j: 'skip' });
}
// gõ lúc ms: tìm nốt gần nhất còn chờ trong khoảng ±WIN.good
function tryHit(ms) {
  if (game.state !== 'play') return null;
  const st = songTimeAt(ms);
  if (st == null) return null;
  const tj = st - offsetMs / 1000;
  let best = null;
  for (let k = game.i; k < game.notes.length; k++) {
    const n = game.notes[k];
    if (n.t - tj > WIN.good) break;
    if (n.st) continue;
    const d = Math.abs(tj - n.t);
    if (d <= WIN.good && (!best || d < best.d)) best = { n, d };
  }
  if (!best) return null;
  judgeNote(best.n, best.d <= WIN.perfect ? 'perfect' : best.d <= WIN.great ? 'great' : 'good');
  return best.n;
}
function judgeNote(n, j) {
  n.j = j;
  if (j === 'miss') {
    n.st = 2;
    game.counts.miss++;
    game.combo = 0;
    addEnergy(ENERGY.miss);
    if (performance.now() - lastCheer < 3000) { cat.oopsUntil = performance.now() + 450; cat.flinch = 1; }   // chỉ khi người chơi đang gõ thật
  } else {
    n.st = 1;
    game.combo++;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    n.pts = Math.round(POINTS[j] * (n.big ? 2 : 1) * (1 + Math.min(game.combo, 100) / 100));
    game.score += n.pts;
    game.counts[j]++;
    addEnergy(ENERGY[j] * (n.big ? 1.5 : 1));
    game.fx.push({ t0: performance.now(), big: n.big });
    if (j === 'perfect' && game.combo % 4 === 0) cat.happyUntil = performance.now() + 450;
    if (n.big) cat.starUntil = performance.now() + 900;
    if (game.combo === 10 || game.combo === 25 || (game.combo >= 50 && game.combo % 50 === 0)) catCombo(game.combo);
  }
  showJudge(j);
  paintHud();
}
const bestKey = () => BEST_PREFIX + (song() ? song().id : '') + ':' + level;
function readBest() {
  try { const b = JSON.parse(store(bestKey()) || 'null'); return b && b.score > 0 ? b : null; } catch (e) { return null; }
}
const fmt = (n) => Math.round(n).toLocaleString(LM.locale);
function finishGame() {
  if (game.state !== 'play') return;
  game.state = 'done';
  const c = game.counts;
  const judged = c.perfect + c.great + c.good + c.miss;
  const acc = judged ? Math.round((c.perfect + c.great * 0.7 + c.good * 0.4) / judged * 1000) / 10 : 0;
  const grade = acc >= 95 ? 'S' : acc >= 88 ? 'A' : acc >= 75 ? 'B' : acc >= 60 ? 'C' : 'D';
  catResult(grade);
  const prev = readBest();
  const isBest = game.score > 0 && (!prev || game.score > prev.score);
  if (isBest) store(bestKey(), JSON.stringify({ score: game.score, acc, combo: game.maxCombo, at: Date.now() }));
  const box = $('results');
  const info = el('div');
  const p1 = el('p');
  p1.append(el('strong', '', t('c.res.points', { n: fmt(game.score) })), ' · ' + t('c.res.acc', { n: acc }) + ' · ' + t('c.res.maxCombo', { n: game.maxCombo }));
  info.append(p1, el('p', '', t('c.res.counts', { p: c.perfect, g: c.great, o: c.good, m: c.miss })));
  if (isBest) info.append(el('p', 'best', t('c.res.newBest')));
  else if (prev) info.append(el('p', '', t('c.best', { n: fmt(prev.score) })));
  box.replaceChildren(el('b', 'grade', grade), info);
  box.setAttribute('aria-label', t('c.res.title'));
  box.hidden = false;
  paintGame();
  box.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}
// phần chữ của trò chơi: hiện / ẩn theo bài + mức, nút Bắt đầu / Chơi lại, kỷ lục
function paintGame() {
  const s = song();
  const has = !!(s && s.chart);
  $('levelPick').hidden = !has;
  const on = has && level !== 'off';
  $('game').hidden = !on;
  $('hint').textContent = on ? t('c.hintGame') : started ? t('c.hint2') : t('c.hint');
  if (!on) return;
  const ready = playable();
  const btn = $('start');
  btn.hidden = game.state === 'play';
  btn.disabled = !ready;
  $('startLabel').textContent = !game.chart ? t('c.loading') : game.state === 'done' ? t('c.again') : t('c.start');
  const best = ready && readBest();
  $('startBest').textContent = best ? t('c.best', { n: fmt(best.score) }) : '';
  $('howto').textContent = t('c.howto');
}
function paintHud() {
  $('score').textContent = fmt(game.score);
  $('combo').textContent = game.combo >= 3 ? t('c.combo', { n: game.combo }) : '';
}
function showJudge(j) {
  const n = $('judge');
  n.textContent = t('c.j.' + j);
  n.dataset.j = j;
  if (!n.animate) { n.style.opacity = '1'; return; }
  n.animate([
    { transform: reduced ? 'none' : 'scale(1.35)', opacity: 1 }, { transform: 'none', opacity: 1, offset: 0.25 },
    { opacity: 1, offset: 0.7 }, { opacity: 0 },
  ], { duration: 700, easing: 'ease-out', fill: 'forwards' });
}

/* ---- làn nốt (canvas 2D): vạch phách, vòng đích hình trái tim, trái tim chạy từ phải sang ---- */
const lane = $('lane');
const lctx = lane.getContext('2d');
const HEART = typeof Path2D === 'function' ? new Path2D('M50 84C20 64 9 45 20 29c9-13 25-11 30 1 5-12 21-14 30-1 11 16 0 35-30 55z') : null;
let laneW = 0, laneH = 0;
function sizeLane() {
  const r = lane.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  laneW = r.width;
  laneH = r.height;
  lane.width = Math.max(1, Math.round(r.width * dpr));
  lane.height = Math.max(1, Math.round(r.height * dpr));
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
if (window.ResizeObserver) new ResizeObserver(sizeLane).observe(lane); else window.addEventListener('resize', sizeLane);
function heart(x, y, size, fill, stroke, alpha, lw, glow) {
  if (!HEART) return;
  const k = size / 100;
  lctx.save();
  lctx.globalAlpha = alpha;
  lctx.translate(x, y);
  lctx.scale(k, k);
  lctx.translate(-50, -52);
  if (glow) { lctx.shadowColor = glow; lctx.shadowBlur = 14 / k; }
  if (fill) { lctx.fillStyle = fill; lctx.fill(HEART); }
  lctx.shadowBlur = 0;
  if (stroke) { lctx.lineWidth = lw / k; lctx.strokeStyle = stroke; lctx.stroke(HEART); }
  lctx.restore();
}
function drawLane(st, now) {
  if ($('game').hidden || !laneW) return;
  lctx.clearRect(0, 0, laneW, laneH);
  const s = song(), c = game.chart;
  if (!s || !c) return;
  const v = s.versions[verI], P = 60 / c.bpm, a = v.anchor || 0, off = offsetMs / 1000;
  const time = st == null ? (v.start || 0) : st;
  const tx = Math.max(38, Math.min(84, laneW * 0.1)), cy = laneH / 2;
  const speed = (laneW - tx + 24) / APPROACH[level === 'off' ? 'normal' : level];
  const X = (sec) => tx + (sec + off - time) * speed;
  // vạch phách (vạch đậm mỗi 4 phách)
  const first = Math.ceil((time - off - a - tx / speed) / P), lastB = Math.floor((time - off - a + (laneW - tx) / speed) / P);
  for (let b = first; b <= lastB; b++) {
    lctx.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.07)';
    lctx.fillRect(Math.round(X(a + b * P)), 9, 1, laneH - 18);
  }
  // vòng đích: trái tim rỗng, nhún nhẹ theo phách khi đang phát
  const ph = (time - off - a) / P;
  const pulse = player.playing && !reduced ? Math.max(0, 1 - (ph - Math.floor(ph)) * 4) : 0;
  const stickCol = TEAM[team];
  heart(tx, cy, laneH * 0.64 * (1 + 0.07 * pulse), 'rgba(255,255,255,.07)', 'rgba(255,255,255,.9)', 1, 2.5);
  // gõ trúng: trái tim loang ra từ vòng đích
  game.fx = game.fx.filter((f) => now - f.t0 < 420);
  for (const f of game.fx) {
    const k = (now - f.t0) / 420;
    heart(tx, cy, laneH * (0.64 + 0.55 * k) * (f.big ? 1.15 : 1), null, f.big ? '#ffd36e' : stickCol, 1 - k, 3);
  }
  if (game.state !== 'play') return;
  for (let k = Math.max(0, game.i - 6); k < game.notes.length; k++) {
    const n = game.notes[k];
    const x = X(n.t);
    if (x > laneW + 30) break;
    if (x < -30 || n.st === 1 || n.st === 3) continue;
    const size = laneH * (n.big ? 0.66 : 0.46);
    if (n.st === 2) heart(x, cy, size, 'rgba(150,140,165,.55)', null, Math.max(0, Math.min(0.8, (x + 30) / (tx + 30))), 0);
    else heart(x, cy, size, n.big ? '#ffd36e' : stickCol, '#fff', 1, n.big ? 3 : 2, n.big ? '#ffb347' : stickCol);
  }
}

/* ================= chọn bài / video / ghế / màu / tiếng ================= */
function paintSongs() {
  const box = $('songs');
  box.hidden = SONGS.length < 2;
  box.replaceChildren(...SONGS.map((s, i) => {
    const b = el('button', 'song', s.title);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === songI));
    b.setAttribute('aria-controls', 'screen');
    b.tabIndex = i === songI ? 0 : -1;
    b.dataset.i = String(i);
    if (s.artist) b.append(el('small', '', s.artist));
    return b;
  }));
}
function paintVersions() {
  const s = song();
  const sel = $('version');
  sel.replaceChildren(...(s ? s.versions : []).map((v, i) => {
    const o = el('option', '', v.label);
    o.value = String(i);
    return o;
  }));
  sel.value = String(verI);
  sel.setAttribute('aria-label', t('c.video'));
  $('versionPick').hidden = !s || s.versions.length < 2;
}
function paintSound() {
  const b = $('sound');
  b.textContent = soundOn ? '🔊' : '🔇';
  b.title = t(soundOn ? 'c.soundOn' : 'c.soundOff');
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-pressed', String(soundOn));
}
function applyTheme() {
  const th = song() ? song().theme : THEMES.pink;
  document.documentElement.style.setProperty('--glow', th.glow);
  if (hall) hall.setTheme(th);
}
function applyTeam() {
  document.documentElement.style.setProperty('--stick', TEAM[team]);
  if (hall) hall.setTeam(TEAM[team]);
}
function selectSong(i, focus) {
  if (i === songI || !SONGS[i]) return;
  songI = i;
  verI = 0;
  paintSongs();
  paintVersions();
  applyTheme();
  prepareSong();
  showScreen(started);
  syncUrl();
  if (focus) $('songs').querySelector('[aria-selected="true"]').focus();
}

document.title = t('c.doc');
paintSongs();
paintVersions();
$('seat').replaceChildren(...SEATS.map((s) => { const o = el('option', '', t('c.seat.' + s.id)); o.value = s.id; return o; }));
$('seat').value = seatId;
$('seat').setAttribute('aria-label', t('c.seat'));
$('team').replaceChildren(...['a', 'b'].map((k) => { const o = el('option', '', t('c.stick.' + k)); o.value = k; return o; }));
$('team').value = team;
$('team').setAttribute('aria-label', t('c.stick'));
paintSound();
applyTheme();
applyTeam();
showScreen(false);
syncUrl();

$('songs').addEventListener('click', (e) => {
  const b = e.target.closest('.song');
  if (b) selectSong(+b.dataset.i);
});
// danh sách bài là tablist: mũi tên trái / phải để đổi bài
$('songs').addEventListener('keydown', (e) => {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (d == null && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const n = SONGS.length;
  selectSong(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (songI + d + n) % n, true);
});
$('version').addEventListener('change', (e) => {
  verI = clampInt(e.target.value, 0, song().versions.length - 1);
  prepareSong();
  showScreen(started);
  syncUrl();
});
$('seat').addEventListener('change', (e) => {
  seatId = seatOk(e.target.value) ? e.target.value : 'floor';
  store(SEAT_KEY, seatId);
  if (hall) hall.setSeat(seatId);
  syncUrl();
});
$('team').addEventListener('change', (e) => {
  team = e.target.value === 'b' ? 'b' : 'a';
  store(TEAM_KEY, team);
  applyTeam();
});
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  store(SOUND_KEY, soundOn ? '1' : '0');
  paintSound();
  if (soundOn) tapSound('tap');
});

/* ================= cổ vũ ================= */
let energy = 0, shownEnergy = -1, lastCheer = -1e9, burstUntil = 0, sayTimer = 0, hearts = 0;
const swingEl = document.querySelector('#stick .swing');
const haloEl = document.querySelector('#stick .halo');

function paintCount() { $('count').textContent = t('c.count', { n: total.toLocaleString(LM.locale) }); }
paintCount();

// ms = thời điểm gõ (e.timeStamp của sự kiện, cùng mốc với performance.now) để chấm nốt chính xác
function cheer(ms) {
  const now = performance.now();
  if (!(ms > 0) || ms > now) ms = now;
  lastCheer = now;
  if (sync) { syncTap(ms); tapSound('tap'); swing(); return; }   // căn nhịp: tiếng phát ngay, không khớp lưới
  let power = 1, snd = 'tap', hit = null;
  if (game.state === 'play') {
    const n = tryHit(ms);
    if (n) { power = n.big ? 1.8 : 1.2; snd = n.big ? 'big' : 'tap'; hit = n; }
    else { addEnergy(ENERGY.free); power = 0.6; snd = 'soft'; }
  } else addEnergy(ENERGY.idle);
  total += 1;
  store(TOTAL_KEY, String(total));
  paintCount();
  tapSound(snd, ms, hit);
  swing();
  cat.kick = Math.min(1, 0.55 + 0.25 * power);
  catSparkle(power >= 1.2 ? (small ? 2 : 3) : 1, now);
  spawnHeart();
  if (hall) hall.tap(power);
}
function addEnergy(d) {
  energy = Math.max(0, Math.min(100, energy + d));
  const now = performance.now();
  if (energy >= 100 && now > burstUntil) burst(now);
}
// Năng lượng đầy: cả sảnh nhảy, pháo giấy rơi (rồi hạ năng lượng xuống để lần sau phải gõ tiếp mới đầy lại)
function burst(now) {
  burstUntil = now + 3500;
  energy = 60;
  if (hall) hall.burst();
  $('say').textContent = t('c.burst');
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { $('say').textContent = ''; }, 3200);
}
function swing() {
  if (!swingEl || !swingEl.animate) return;
  swingEl.animate([
    { transform: 'rotate(0deg)' }, { transform: 'rotate(-13deg)', offset: 0.35 },
    { transform: 'rotate(4deg)', offset: 0.7 }, { transform: 'rotate(0deg)' },
  ], { duration: reduced ? 1 : 320, easing: 'ease-out' });
  haloEl.animate([{ opacity: 1, transform: 'scale(1.3)' }, { opacity: 0.55, transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
}
// Mèo "sống" (bản 4). cheer.js điều khiển từng bộ phận của hình SVG #cat mỗi khung hình.
//  - Nhạc đang chạy: 7 điệu nhảy (catPose), mỗi câu 8 phách đổi một điệu; cuối câu nhún lấy đà, đầu câu bật lên + nháy mắt.
//    Gõ nhiều (năng lượng cao / combo dài) thì chuyển sang chuỗi điệu sôi động hơn (CAT_HYPE).
//  - Chưa có nhạc: thở, nhìn theo con trỏ / chỗ vừa chạm, làm việc vặt (vẫy tay, ngáp, ngắm lightstick, nhảy cẫng, ngoái nhìn đuôi,
//    nghiêng đầu); 30 giây không ai động tới thì ngủ gật (zzz), có người tới thì giật mình dậy.
//  - Phản ứng: bấm vào mèo = vuốt ve (meo + tim), gõ lightstick = nhảy vọt + tia sáng, combo tròn = mắt sao + "×25!",
//    trượt = nhăn mặt rụt đầu, hết bài = mừng hoặc rủ chơi lại.
//  - Vật lý phụ: đầu lắc kiểu lò xo, thân nảy, tai / nơ / chuông / đuôi 3 khúc đi theo quán tính, đầu quay giả 3D
//    (mặt trượt trong khuôn đầu, mắt bên xa hẹp lại), đèn tim để lại vệt sáng khi vung nhanh.
const catEl = $('cat'), sayEl = $('catSay');
const CAT_PARTS = ['all', 'shadow', 'spot', 'body', 'head', 'ears', 'ear-l', 'ear-r', 'cheeks', 'blush', 'wh-l', 'wh-r', 'face',
  'eyes', 'eye-l', 'eye-r', 'pupils', 'sing', 'bow', 'bell', 'arm-l', 'arm-r', 'stick', 'ghost', 'foot-l', 'foot-r', 'glow', 'spark',
  't1', 't2', 't3'];
const catP = Object.fromEntries(CAT_PARTS.map((k) => [k, catEl ? [...catEl.querySelectorAll('.cat-' + k)] : []]));
const cat = {
  ok: CAT_PARTS.every((k) => catP[k].length), kick: 0, flinch: 0, mood: '', tag: '', last: 0, P: null,
  V: { sq: 0, rot: 0, head: 0, turn: 0 }, prevY: 0,
  happyUntil: 0, starUntil: 0, oopsUntil: 0, winkUntil: 0, petUntil: 0, cheerUntil: 0,
  blinkAt: 2000, twitchAt: 3500, twitchR: false, gazeAt: 0, gx: 0, gy: 0, lookX: 0, lookY: 0,
  ear: 0, earV: 0, bell: 0, bellV: 0, t1: 0, t2: 0, t3: 0, wide: 1,
  noteStep: -1, bits: 0, ph: null, hype: false, m: -1, mPrev: -1, mBeat: 0, playing: false, stopAt: 0, asked: true,
  act: null, lastAct: '', nextActAt: 4500, activeAt: 0, asleep: false, zAt: 0,
  g1: [26, 94], g2: [26, 94], hx: 26, hy: 94, rect: null, rectAt: 0,
};
const ptr = { x: 0, y: 0, at: -1e9 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;
const rotPt = (x, y, cx, cy, deg) => {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};
// Chuỗi điệu theo câu 8 phách: 0 nhún đổi chân · 1 chân trước ngang má lắc lư · 2 nhảy cao · 3 xoay vòng · 4 bước ngang ·
// 5 giơ lightstick vẫy · 6 lắc hông
const CAT_CALM = [0, 5, 1, 4, 0, 6, 5, 1];
const CAT_HYPE = [4, 2, 6, 3, 5, 2, 0, 3];
const CAT_ACTS = [['wave', 1400], ['yawn', 2400], ['peek', 2200], ['hop', 1100], ['tail', 2400], ['tilt', 1700]];
const CAT_SPRING = { sq: [520, 18], rot: [300, 14], head: [170, 10], turn: [140, 14] };   // [độ cứng, giảm chấn] → nảy quá đà một chút
const CAT_BASE = { x: 0, y: 0, rot: 0, sq: 0, breath: 0, head: 0, headY: 0, turn: 0, armL: 0, liftL: 0, shL: 0, stick: 0,
  armR: 0, liftR: 0, footL: 0, footR: 0, flip: 1, sing: 0, tail: 0, ear: 0 };
// Tư thế đích của điệu m tại phách b.
// armL / armR = góc xoay tay (tay trái cầm lightstick: dương = giơ lên; tay phải: âm = giơ lên), liftL / liftR = nhấc cả tay (px),
// shL = đưa tay cầm lightstick sang ngang, stick = góc vẩy riêng của cây lightstick, turn = quay đầu (−1 trái … +1 phải).
// Đầu mèo to hơn thân nhiều nên "giơ tay" là giơ lên ngang má; lúc vẽ còn chặn thêm để đèn tim không che mắt.
function catPose(m, b, amp) {
  const up = Math.abs(Math.sin(Math.PI * b)) ** 0.8;      // 0 đúng phách (chạm đất) → 1 giữa hai phách
  const alt = Math.cos(Math.PI * b);                      // +1 phách chẵn, −1 phách lẻ (đổi bên mượt)
  const T = { ...CAT_BASE, tail: alt * 12 };
  if (m === 1) {            // hai chân trước giơ ngang má, cả người lắc lư qua lại
    T.x = alt * 9 * amp; T.y = up * 4 * amp; T.rot = alt * 8 * amp; T.sq = (1 - up) * 0.04;
    T.head = alt * 13 * amp; T.turn = alt * 0.45; T.armL = 6 + alt * 8; T.liftL = 12; T.stick = -6 + alt * 6;
    T.armR = -40 + alt * 8; T.liftR = 8; T.tail = -alt * 14;
  } else if (m === 2) {     // nhảy cao: 1 phách trên không (hai tay vung lên, co chân), 1 phách tiếp đất nhún hai cái
    const g = b / 2 - Math.floor(b / 2);
    if (g < 0.5) {
      const a = Math.sin(Math.PI * g * 2);
      T.y = a * 30 * amp; T.sq = -0.07 * a; T.armL = 4 + 10 * a; T.liftL = 16 * a; T.stick = 8 * a;
      T.armR = -(10 + 36 * a); T.liftR = 8 * a; T.head = -3 * a; T.headY = 2 * a; T.footL = 5 * a; T.footR = 5 * a;
    } else {
      const a = (g - 0.5) * 2, bob = Math.abs(Math.sin(2 * Math.PI * a));
      T.y = bob * 5 * amp; T.sq = (1 - bob) * 0.13 * (1 - a * 0.6); T.armL = alt * 8; T.armR = -(10 - alt * 8); T.head = alt * 6;
    }
    T.rot = alt * 2;
  } else if (m === 3) {     // xoay vòng: mỗi 2 phách quay mặt sang bên kia, vừa nhún vừa lắc hông
    const c = b / 2, h = c - Math.floor(c), dir = Math.floor(c) % 2 ? -1 : 1;
    T.flip = h < 0.25 ? -dir * Math.cos(Math.PI * h * 4) : dir;
    T.y = up * 9 * amp; T.rot = Math.sin(2 * Math.PI * b) * 5 * amp; T.sq = (1 - up) * 0.07;
    T.armL = 2 + alt * 10; T.liftL = 4; T.stick = alt * 8; T.armR = -(24 - alt * 14); T.liftR = 2; T.head = -alt * 6;
    T.footL = Math.max(0, alt) * up * 6; T.footR = Math.max(0, -alt) * up * 6;
  } else if (m === 4) {     // bước ngang: 2 phách sang phải, 2 phách sang trái, người nghiêng và mắt nhìn theo hướng đi
    const s = Math.sin(Math.PI * b / 2), c = Math.cos(Math.PI * b / 2);
    T.x = s * 13 * amp; T.y = up * 7 * amp; T.rot = c * 5 * amp; T.sq = (1 - up) * 0.07;
    T.head = c * 7; T.headY = up * 1.5; T.turn = c * 0.8;
    T.armL = -4 + s * 10; T.stick = -8 + s * 10; T.armR = -(16 + s * 14); T.liftR = 3;
    T.footL = Math.max(0, alt) * up * 9; T.footR = Math.max(0, -alt) * up * 9; T.tail = -c * 16;
  } else if (m === 5) {     // giơ lightstick lên cạnh tai vẫy qua lại, người đung đưa ngược chiều, tay kia chống hông
    T.x = -alt * 3; T.y = up * 6 * amp; T.rot = -alt * 5 * amp; T.sq = (1 - up) * 0.06;
    T.head = alt * 8; T.headY = 1 - (1 - up) * 1.5; T.turn = -0.3 + alt * 0.3;
    T.liftL = 20; T.shL = -8; T.armL = alt * 5; T.stick = -8 + alt * 18; T.armR = 6;
    T.footL = Math.max(0, alt) * up * 5; T.footR = Math.max(0, -alt) * up * 5;
  } else if (m === 6) {     // lắc hông: hơi khuỵu, mỗi phách lắc một cái, đầu lắc ngược, đuôi quất mạnh
    const w = Math.sin(2 * Math.PI * b);
    T.x = w * 5 * amp; T.y = 2 + up * 3; T.rot = w * 4 * amp; T.sq = 0.035 + (1 - up) * 0.04;
    T.head = -w * 7; T.turn = Math.sin(Math.PI * b) * 0.4;
    T.armL = -10 + w * 8; T.stick = -6 - w * 8; T.armR = 2 - w * 10; T.tail = w * 26;
    T.footL = Math.max(0, w) * 4; T.footR = Math.max(0, -w) * 4;
  } else {                  // nhún theo phách, đổi chân, vung lightstick, tay kia giơ lên ở phách lẻ
    T.x = alt * 3.5 * amp; T.y = up * 13 * amp; T.rot = alt * 3 * amp; T.sq = (1 - up) * 0.1 * amp;
    T.head = alt * 9 * amp; T.headY = up * 2.5; T.turn = alt * 0.25;
    T.armL = (alt * 12 - 4) * amp; T.stick = alt * 10 - 4; T.liftL = Math.max(0, alt) * 5;
    T.armR = -(8 + Math.max(0, -alt) * 34) * amp; T.liftR = Math.max(0, -alt) * 4;
    T.footL = Math.max(0, alt) * up * 8 * amp; T.footR = Math.max(0, -alt) * up * 8 * amp;
  }
  return T;
}
function catSet(k, v) { for (const n of catP[k]) n.style.transform = v; }
function catRect(now) {
  if (!cat.rect || now - cat.rectAt > 600) { cat.rect = catEl.firstElementChild.getBoundingClientRect(); cat.rectAt = now; }
  return cat.rect;
}
// lời thoại ngắn trong bong bóng cạnh đầu mèo
let sayOff = 0;
function catSay(text, ms = 1400) {
  if (!sayEl) return;
  sayEl.textContent = text;
  sayEl.hidden = false;
  if (sayEl.animate && !reduced) {
    sayEl.animate([{ transform: 'scale(.3) rotate(-10deg)', opacity: 0 }, { transform: 'scale(1.14) rotate(3deg)', opacity: 1, offset: 0.6 },
      { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
  }
  clearTimeout(sayOff);
  sayOff = setTimeout(() => { sayEl.hidden = true; }, ms);
}
// hạt nhỏ bay ra từ mèo: nốt nhạc, tim, tia sáng, chữ z (tối đa 14 hạt cùng lúc)
function catBit(ch, cls, x, y, dx, dy, ms, s0 = 0.5, s1 = 1.1) {
  if (reduced || cat.bits >= 14) return;
  const n = el('span', 'cnote' + (cls ? ' ' + cls : ''), ch);
  if (!n.animate) return;
  const rot = (Math.random() - 0.5) * 50;
  n.setAttribute('aria-hidden', 'true');
  document.body.append(n);
  cat.bits++;
  n.animate([
    { transform: `translate(${x}px, ${y}px) scale(${s0}) rotate(0deg)`, opacity: 0 },
    { transform: `translate(${x + dx * 0.4}px, ${y + dy * 0.4}px) scale(${(s0 + s1) / 2}) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.3 },
    { transform: `translate(${x + dx}px, ${y + dy}px) scale(${s1}) rotate(${rot}deg)`, opacity: 0 },
  ], { duration: ms, easing: 'ease-out' }).onfinish = () => { n.remove(); cat.bits--; };
}
function catNote(now) {
  const r = catRect(now);
  catBit(['♪', '♫', '♬'][(Math.random() * 3) | 0], '', r.left + r.width * (0.55 + Math.random() * 0.3), r.top + r.height * 0.12,
    14 + Math.random() * 44, -(r.height * 0.35 + Math.random() * r.height * 0.3), 1400);
}
function catZ(now) {
  const r = catRect(now);
  catBit('z', 'cz', r.left + r.width * 0.72, r.top + r.height * 0.2, 16 + Math.random() * 16, -r.height * 0.42, 2300, 0.6, 1.5);
}
function catHearts(n, now) {
  const r = catRect(now);
  for (let i = 0; i < n; i++) {
    catBit('♥', 'cheart', r.left + r.width * (0.25 + Math.random() * 0.45), r.top + r.height * 0.14,
      (Math.random() - 0.5) * 70, -(36 + Math.random() * 60), 1000 + Math.random() * 400, 0.5, 1.25);
  }
}
function catSparkle(n, now) {       // tia sáng toé ra từ đèn tim trên tay mèo
  const r = catRect(now), k = r.width / 200;
  const x = r.left + cat.hx * k - 7, y = r.top + cat.hy * k - 10;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, d = (22 + Math.random() * 36) * k * 1.6;
    catBit('✦', 'cstar', x, y, Math.cos(a) * d, Math.sin(a) * d, 480 + Math.random() * 200, 0.4, 1);
  }
}
function catDo(name, dur, now) { cat.act = { name, t0: now, dur }; cat.lastAct = name; }
// có người vừa động tới trang (chuột, chạm, phím, nhạc): mèo đang ngủ thì giật mình dậy
function catPoke(now) {
  cat.activeAt = now;
  if (!cat.asleep) return;
  cat.asleep = false; cat.act = null; cat.nextActAt = now + 3500;
  cat.kick = 1; cat.earV -= 260;
  catSay('!', 900);
}
function catPet() {
  const now = performance.now();
  catPoke(now);
  if (cat.act) { cat.act = null; cat.nextActAt = now + 3000; }
  cat.petUntil = now + 1100;
  cat.kick = Math.max(cat.kick, 0.5);
  catSay(t('c.cat.meow') + ' ♥', 1300);
  catHearts(3, now);
}
function catCombo(n) {
  const now = performance.now();
  cat.starUntil = now + 900; cat.kick = 1;
  catSay('×' + n + '!', 1300);
  catSparkle(5, now);
}
function catResult(grade) {
  const now = performance.now();
  if (grade === 'S' || grade === 'A') {
    cat.starUntil = cat.cheerUntil = now + 2800;
    catSay(t('c.cat.nice'), 2800); catDo('cheer', 2800, now); catHearts(4, now);
  } else if (grade === 'B') {
    cat.happyUntil = now + 1800; catSay('♥', 1600); catDo('hop', 1100, now);
  } else {
    cat.happyUntil = now + 1200; catSay(t('c.cat.again'), 2800); catDo('wave', 1700, now);
  }
}
if (catEl) {
  const seen = (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.at = performance.now(); catPoke(ptr.at); };
  addEventListener('pointermove', seen, { passive: true });
  addEventListener('pointerdown', seen, { passive: true, capture: true });
  addEventListener('keydown', () => catPoke(performance.now()), true);
  catEl.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); catPet(); });
}
// Tư thế lúc chưa có nhạc
function catIdle(now, sec) {
  const br = Math.sin(sec * 2.2);
  const T = { ...CAT_BASE, rot: Math.sin(sec * 0.9) * 1.5, breath: br, head: Math.sin(sec * 0.7) * 4, headY: br * 0.6,
    armL: Math.sin(sec * 1.3) * 4, armR: -Math.sin(sec * 1.1) * 4, stick: Math.sin(sec * 0.8) * 5,
    tail: Math.sin(sec * 1.7) * 10 + Math.sin(sec * 0.63) * 6 };
  if (cat.asleep) {         // ngủ gật: thở chậm, đầu gục dần rồi giật lên, tai cụp, lightstick hạ xuống
    const slow = Math.sin(sec * 1.25), nod = (sec * 0.22) % 1;
    Object.assign(T, { rot: 2, breath: slow * 1.8, head: 9 + slow * 1.5, headY: -2.5 - 4 * nod * nod + slow * 0.8,
      armL: -12, armR: 8, stick: -22, tail: Math.sin(sec * 0.8) * 6, ear: 12, sq: 0.02 });
    cat.gx = 0; cat.gy = 0.6;
    if (now > cat.zAt) { cat.zAt = now + 1700; catZ(now); }
    return T;
  }
  const watching = now - ptr.at < 3500;       // nhìn theo con trỏ / chỗ vừa chạm; không thì nhìn quanh
  if (watching) {
    const r = catRect(now);
    cat.gx = clamp((ptr.x - (r.left + r.width * 0.5)) / (innerWidth * 0.3), -1, 1);
    cat.gy = clamp((ptr.y - (r.top + r.height * 0.42)) / (innerHeight * 0.3), -1, 1);
    T.turn = cat.gx * 0.6; T.head += cat.gx * 4; T.headY -= cat.gy * 1.5;
  } else {
    if (now > cat.gazeAt) { cat.gazeAt = now + 1500 + Math.random() * 2800; cat.gx = (Math.random() - 0.5) * 2; cat.gy = Math.random() - 0.5; }
    T.turn = cat.gx * 0.45;
  }
  if (!cat.act && now > cat.nextActAt) {
    let c;
    do { c = CAT_ACTS[(Math.random() * CAT_ACTS.length) | 0]; } while (c[0] === cat.lastAct);
    catDo(c[0], c[1], now);
  }
  const a = cat.act;
  if (!a) return T;
  const u = (now - a.t0) / a.dur;
  if (u >= 1) { cat.act = null; cat.nextActAt = now + 2500 + Math.random() * 4500; return T; }
  const env = Math.sin(Math.PI * u) ** 0.6;   // 0 → 1 → 0
  if (a.name === 'wave') {            // vẫy tay chào
    T.armR = -(34 + Math.sin(sec * 15) * 12) * env; T.liftR = 6 * env; T.head += 7 * env; T.turn *= 1 - env;
    cat.gx *= 1 - env; cat.gy *= 1 - env;
  } else if (a.name === 'yawn') {     // ngáp + vươn vai, xong lắc đầu cho tỉnh
    T.head -= 6 * env; T.headY += 3 * env; T.sing = 1.35 * env; T.sq = -0.05 * env; T.ear = 10 * env;
    T.armR = -40 * env; T.liftR = 10 * env; T.armL = 8 * env; T.liftL = 14 * env;
    if (u > 0.86) T.head += Math.sin(sec * 42) * 4;
  } else if (a.name === 'peek') {     // ngắm cây lightstick của mình, vẩy thử mấy cái rồi cười
    T.turn = -0.9 * env; cat.gx = -1; cat.gy = -0.15; T.head -= 5 * env;
    T.liftL = 8 * env; T.stick = Math.sin(u * Math.PI * 5) * 13 * env;
    if (u > 0.7) cat.happyUntil = now + 300;
  } else if (a.name === 'hop') {      // nhảy cẫng hai cái
    const h = Math.abs(Math.sin(u * Math.PI * 2));
    T.y = h * 15; T.sq = (1 - h) * 0.08 * env; T.armR = -30 * env; T.liftR = 6 * env; T.liftL = 8 * env;
    cat.happyUntil = now + 200;
  } else if (a.name === 'tail') {     // ngoái nhìn cái đuôi đang ve vẩy
    T.turn = 0.95 * env; cat.gx = 1; cat.gy = 0.5; T.head += 6 * env; T.tail = Math.sin(u * Math.PI * 7) * 24 * env;
  } else if (a.name === 'tilt') {     // nghiêng đầu thắc mắc
    T.head = 13 * env; T.turn *= 1 - env; T.ear = -6 * env;
    cat.gx *= 1 - env; cat.gy *= 1 - env;
  } else if (a.name === 'cheer') {    // mừng: nhảy liên tục, hai tay vung
    const h = Math.abs(Math.sin(sec * 7));
    T.y = h * 16 * env; T.sq = (1 - h) * 0.08 * env; T.armR = -(30 + Math.sin(sec * 14) * 10) * env; T.liftR = 8 * env;
    T.liftL = 12 * env; T.stick = Math.sin(sec * 14) * 12 * env;
  }
  return T;
}
function danceCat(st, now) {
  if (!cat.ok) return;
  const dt = clamp((now - cat.last) / 1000, 0.001, 0.05);
  cat.last = now;
  const bursting = now < burstUntil;
  const b = beatPos(st), E = Math.min(100, energy) / 100, sec = now / 1000;
  const playing = b != null;
  if (playing !== cat.playing) {      // nhạc vừa chạy: bật dậy; vừa dừng: lát nữa nghiêng đầu hỏi
    cat.playing = playing;
    if (playing) { catPoke(now); cat.kick = 1; cat.act = null; cat.ph = null; cat.m = -1; if (!sayEl || sayEl.hidden) catSay('♪', 900); }
    else { cat.stopAt = now; cat.asked = false; cat.nextActAt = now + 3500; }
  }
  if (playing) cat.activeAt = now;
  else if (!cat.asked && now - cat.stopAt > 900) {
    cat.asked = true;
    if (game.state !== 'done' && !player.ended && !cat.act) { catDo('tilt', 1700, now); catSay('?', 1200); }
  }
  if (!playing && !cat.asleep && !cat.act && now - cat.activeAt > 30000) cat.asleep = true;
  const yawning = cat.act && cat.act.name === 'yawn' && Math.abs((now - cat.act.t0) / cat.act.dur - 0.5) < 0.3;
  const mood = now < cat.oopsUntil ? 'oops' : bursting || now < cat.starUntil ? 'star' : cat.asleep || yawning ? 'sleep'
    : now < cat.happyUntil || now < cat.petUntil ? 'happy' : now < cat.winkUntil ? 'wink' : '';
  if (mood !== cat.mood) { cat.mood = mood; catEl.className = 'cat' + (mood ? ' ' + mood : ''); }
  if (reduced) return;
  cat.kick = Math.max(0, cat.kick - dt * 3.6);
  cat.flinch = Math.max(0, cat.flinch - dt * 2.5);
  let T, hitP = 0, tag;
  if (!playing) {
    T = catIdle(now, sec);
    tag = cat.asleep ? 'sleep' : cat.act ? cat.act.name : 'idle';
  } else {
    const f = b - Math.floor(b), ph = Math.floor(b / 8);
    if (ph !== cat.ph) {              // sang câu nhạc mới: chọn chuỗi điệu theo độ sôi động, câu chẵn thì nháy mắt
      const first = cat.ph == null;
      cat.ph = ph;
      cat.hype = E > 0.55 || (game.state === 'play' && game.combo >= 20);
      if (!first && ph % 2 === 0) { cat.winkUntil = now + 480; catSparkle(2, now); }
    }
    const seq = cat.hype ? CAT_HYPE : CAT_CALM, n = seq.length;
    const party = bursting || now < cat.cheerUntil;
    const m = party ? 2 : seq[((ph % n) + n) % n];
    const amp = 0.8 + E * 0.5 + (party ? 0.25 : 0);
    T = catPose(m, b, amp);
    tag = 'm' + m;
    if (m !== cat.m) { cat.mPrev = cat.m; cat.m = m; cat.mBeat = b; }
    const since = b - cat.mBeat;
    if (cat.mPrev >= 0 && since >= 0 && since < 0.4) {      // vừa đổi điệu: hoà dần từ tư thế của điệu cũ sang
      const c = since / 0.4, e = c * c * (3 - 2 * c), T0 = catPose(cat.mPrev, b, amp);
      for (const key in T) T[key] = T0[key] + (T[key] - T0[key]) * e;
    }
    const f8 = b - ph * 8;
    if (!party && f8 > 7.4) {         // cuối câu: khuỵu xuống lấy đà
      const c = (f8 - 7.4) / 0.6, e = c * c * (3 - 2 * c);
      T.sq += 0.1 * e; T.y *= 1 - e; T.headY -= 2 * e; T.armL -= 8 * e; T.armR += 8 * e; T.liftL *= 1 - e; T.liftR *= 1 - e;
    } else if (!party && f8 < 0.5 && m !== 2) {   // đầu câu: bật lên, tay vung
      const a = Math.sin(Math.PI * f8 * 2);
      T.y += 15 * a * amp; T.sq -= 0.05 * a; T.liftL += 6 * a; T.liftR += 8 * a; T.armR -= 20 * a;
    }
    hitP = (1 - f) ** 2;
    T.sing = mood === 'oops' ? 0 : 0.25 + 0.75 * (1 - f) ** 1.5;
    cat.gx = clamp(T.turn * 1.2 + Math.cos(Math.PI * b) * 0.4, -1, 1);
    cat.gy = -0.15;
    const two = Math.floor(b / 2);
    if (two !== cat.noteStep) { cat.noteStep = two; catNote(now); }
    cat.wide += ((Math.floor(b) % 2 ? 1.25 : 0.92) - cat.wide) * (1 - Math.exp(-dt * 14));
  }
  if (tag !== cat.tag) { cat.tag = tag; catEl.dataset.act = tag; }
  // gõ lightstick: nhảy vọt + vẩy đèn; trượt: rụt đầu lắc lắc; đang được vuốt: rung rung khoái chí
  T.y += cat.kick * 18; T.liftL += cat.kick * 8; T.stick += cat.kick * 10;
  if (cat.flinch > 0) {
    T.head += Math.sin(sec * 38) * 5 * cat.flinch; T.y *= 1 - 0.5 * cat.flinch; T.sq += 0.06 * cat.flinch; T.ear += 14 * cat.flinch;
  }
  const petting = now < cat.petUntil;
  if (petting) { T.head += Math.sin(sec * 46) * 1.6; T.sq += 0.03; T.headY -= 1.5; }
  // làm mượt tư thế; thân, độ nghiêng và đầu dùng lò xo nên nảy quá đà một chút rồi mới dừng
  const P = cat.P || (cat.P = { ...T });
  const k = 1 - Math.exp(-dt * 26);
  for (const key in T) {
    const s = CAT_SPRING[key];
    if (s) { cat.V[key] += ((T[key] - P[key]) * s[0] - cat.V[key] * s[1]) * dt; P[key] += cat.V[key] * dt; }
    else P[key] += (T[key] - P[key]) * k;
  }
  // quán tính: tai (lò xo) cụp ra khi bật lên, vểnh lại khi rơi; chuông lắc; đuôi 3 khúc, khúc sau trễ hơn khúc trước
  const vy = (P.y - cat.prevY) / dt;
  cat.prevY = P.y;
  const earT = clamp(vy * 0.05, -18, 18) + P.ear + (mood === 'oops' ? 15 : 0);
  cat.earV += ((earT - cat.ear) * 190 - cat.earV * 13) * dt;
  cat.ear += cat.earV * dt;
  if (now > cat.twitchAt) { cat.twitchAt = now + 1800 + Math.random() * 3800; cat.twitchR = Math.random() < 0.5; }
  const tw = Math.max(0, 1 - Math.abs(cat.twitchAt - now - 150) / 150) * 14;
  const bellT = clamp(-P.rot * 1.2 - cat.V.rot * 0.06 - vy * 0.03, -32, 32);
  cat.bellV += ((bellT - cat.bell) * 140 - cat.bellV * 5) * dt;
  cat.bell = clamp(cat.bell + cat.bellV * dt, -40, 40);
  const t1T = -P.rot * 1.6 - clamp(vy * 0.04, -14, 14) + Math.sin(sec * 3.1) * 5 + P.tail;
  cat.t1 += (t1T - cat.t1) * (1 - Math.exp(-dt * 14));
  cat.t2 += (cat.t1 * 1.2 - cat.t2) * (1 - Math.exp(-dt * 9));
  cat.t3 += (cat.t2 * 1.3 - cat.t3) * (1 - Math.exp(-dt * 6));
  const kg = 1 - Math.exp(-dt * 8);
  cat.lookX += (cat.gx - cat.lookX) * kg;
  cat.lookY += (cat.gy - cat.lookY) * kg;

  const F = (v, d = 2) => v.toFixed(d);
  const air = clamp(P.y / 30, 0, 1), turn = clamp(P.turn, -1, 1), fdx = turn * 6 + cat.lookX * 1.2;
  // Vị trí đèn tim (toạ độ hình vẽ) sau khi vẩy lightstick, xoay và nhấc tay — để chặn nó khỏi che mắt trái, khỏi lọt mép màn hình
  const armRot = clamp(P.armL, -28, 16), stickRot = clamp(P.stick, -36, 12);
  let [hx, hy] = rotPt(26, 94, 50, 143, stickRot);
  [hx, hy] = rotPt(hx, hy, 76, 150, armRot);
  let ax = P.shL, ay = -P.liftL;
  hx += ax; hy += ay;
  let [ex, ey] = rotPt(74 + fdx, 96, 100, 134, P.head);
  ey -= P.headY;
  const ddx = hx - ex, ddy = hy - ey, dd = Math.hypot(ddx, ddy) || 1;
  if (dd < 33) { const push = (33 - dd) / dd; ax += ddx * push; ay += ddy * push; hx += ddx * push; hy += ddy * push; }
  let bx = P.x;
  const box = catRect(now), minX = 18.5 - box.left * 200 / (box.width || 200);     // tâm đèn tim cách mép trái màn hình ≥ nửa bề ngang của nó
  const hw = 100 + bx + (hx - 100) * P.flip * (1 + P.sq) * Math.cos(P.rot * RAD) + (206 - hy) * (1 - P.sq) * Math.sin(P.rot * RAD);
  if (hw < minX) bx += minX - hw;
  cat.hx = Math.max(hw, minX); cat.hy = hy - P.y;
  // vệt sáng: hai bóng tim đi sau đèn tim, vung càng nhanh càng rõ
  const kt = 1 - Math.exp(-dt * 16), g1 = cat.g1, g2 = cat.g2;
  g1[0] += (hx - g1[0]) * kt; g1[1] += (hy - g1[1]) * kt;
  g2[0] += (g1[0] - g2[0]) * kt; g2[1] += (g1[1] - g2[1]) * kt;
  catP.ghost[0].style.transform = `translate(${F(g2[0] - 26)}px, ${F(g2[1] - 94)}px)`;
  catP.ghost[0].style.opacity = F(clamp((Math.hypot(g2[0] - hx, g2[1] - hy) - 3) / 24, 0, 0.3));
  catP.ghost[1].style.transform = `translate(${F(g1[0] - 26)}px, ${F(g1[1] - 94)}px)`;
  catP.ghost[1].style.opacity = F(clamp((Math.hypot(g1[0] - hx, g1[1] - hy) - 2) / 14, 0, 0.45));

  catSet('all', `translate(${F(bx)}px, ${F(-P.y)}px) rotate(${F(P.rot)}deg) scale(${F(P.flip * (1 + P.sq), 3)}, ${F(1 - P.sq, 3)})`);
  catSet('shadow', `translateX(${F(bx)}px) scale(${F(1 - air * 0.4, 3)})`);
  catP.shadow[0].style.opacity = F(1 - air * 0.5);
  catP.spot[0].style.opacity = F(0.45 + 0.55 * hitP + 0.3 * cat.kick);
  catSet('body', `scale(${F(1 + P.breath * 0.012, 3)}, ${F(1 + P.breath * 0.02, 3)})`);
  catSet('head', `translateY(${F(-P.headY)}px) rotate(${F(P.head)}deg)`);
  catSet('ears', `translateX(${F(-turn * 3)}px)`);
  catSet('ear-l', `rotate(${F(-cat.ear - (cat.twitchR ? 0 : tw))}deg)`);
  catSet('ear-r', `rotate(${F(cat.ear + (cat.twitchR ? tw : 0))}deg)`);
  catSet('bow', `translateX(${F(-turn * 3)}px) rotate(${F(cat.ear * 0.8 + cat.bell * 0.15)}deg)`);
  catSet('cheeks', `translateX(${F(turn * 3.5)}px)`);
  catP.blush[0].style.opacity = F(clamp(0.5 + 0.3 * E + (petting || mood === 'happy' || mood === 'star' ? 0.35 : 0), 0, 0.95));
  const whisk = tw * 0.5 + Math.min(1, P.sing) * 3;
  catSet('wh-l', `rotate(${F(whisk)}deg)`);
  catSet('wh-r', `rotate(${F(-whisk)}deg)`);
  catSet('face', `translate(${F(fdx)}px, ${F(cat.lookY * 0.8)}px)`);
  catSet('eye-l', `scaleX(${F(1 + (turn < 0 ? turn * 0.18 : turn * 0.04), 3)})`);
  catSet('eye-r', `scaleX(${F(1 - (turn > 0 ? turn * 0.18 : turn * 0.04), 3)})`);
  if (now > cat.blinkAt + 130) cat.blinkAt = now + (Math.random() < 0.22 ? 190 : 1800 + Math.random() * 3200);   // đôi khi chớp hai cái liền
  catSet('eyes', now > cat.blinkAt ? 'scaleY(0.1)' : 'none');
  catSet('pupils', `translate(${F(cat.lookX * 2.6)}px, ${F(cat.lookY * 2.2)}px) scale(${F(1 + 0.08 * E + 0.12 * cat.kick, 3)})`);
  catSet('sing', `scale(${F(P.sing > 0.02 ? (0.45 + 0.55 * Math.min(1, P.sing)) * (playing ? cat.wide : 1) : 0, 3)}, ${F(P.sing, 3)})`);
  catSet('bell', `rotate(${F(cat.bell)}deg)`);
  catSet('t1', `rotate(${F(cat.t1)}deg)`);
  catSet('t2', `rotate(${F(cat.t2)}deg)`);
  catSet('t3', `rotate(${F(cat.t3)}deg)`);
  catSet('arm-l', `translate(${F(ax)}px, ${F(ay)}px) rotate(${F(armRot)}deg)`);
  catSet('stick', `rotate(${F(stickRot)}deg)`);
  catSet('arm-r', `translateY(${F(-P.liftR)}px) rotate(${F(clamp(P.armR - cat.kick * 18, -48, 12))}deg)`);
  catSet('foot-l', `translateY(${F(-P.footL)}px)`);
  catSet('foot-r', `translateY(${F(-P.footR)}px)`);
  catSet('glow', `scale(${F(0.8 + 0.3 * hitP + 0.7 * cat.kick + 0.25 * E, 3)})`);
  catP.spark[0].style.opacity = F(Math.max(0, E - 0.45) * 1.8 * (0.55 + 0.45 * Math.sin(now / 130)));
}
// trái tim nhỏ bay lên từ đầu lightstick
const HEART_SVG = '<svg viewBox="0 0 100 92" aria-hidden="true"><path d="M50 84C20 64 9 45 20 29c9-13 25-11 30 1 5-12 21-14 30-1 11 16 0 35-30 55z"/></svg>';
function spawnHeart() {
  if (reduced || hearts > 18) return;
  const h = el('span', 'heart');
  if (!h.animate) return;
  h.innerHTML = HEART_SVG;
  const r = $('stick').getBoundingClientRect();
  const x = r.left + r.width / 2 - 15, y = r.top + r.height * 0.2 - 14;
  const dx = (Math.random() - 0.72) * 190, dy = -(170 + Math.random() * 190);
  const s = 0.8 + Math.random() * 0.7, rot = (Math.random() - 0.5) * 50;
  document.body.append(h);
  hearts++;
  const a = h.animate([
    { transform: `translate(${x}px, ${y}px) scale(${s * 0.6})`, opacity: 1 },
    { transform: `translate(${x + dx * 0.55}px, ${y + dy * 0.6}px) scale(${s})`, opacity: 1, offset: 0.55 },
    { transform: `translate(${x + dx}px, ${y + dy}px) scale(${s * 1.1}) rotate(${rot}deg)`, opacity: 0 },
  ], { duration: 1000 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' });
  a.onfinish = () => { h.remove(); hearts--; };
}
// Tiếng gõ lightstick (tự tạo bằng Web Audio, không cần file): TỰ KHỚP NHỊP + NỐT CHUÔNG THEO TÔNG BÀI.
//  - Nhạc đang chạy: tiếng không phát đúng lúc ngón tay chạm mà rơi vào lưới nửa phách của bài. Gõ hơi sớm → chờ tới phách;
//    gõ muộn không quá 70 ms → phát ngay; muộn hơn → sang ô kế tiếp. Mỗi ô chỉ một tiếng nên gõ dồn không thành loạn.
//    Trong ván chơi, gõ trúng nốt thì tiếng rơi đúng lúc của nốt đó. Tim, đèn, mèo vẫn phản ứng ngay lúc gõ.
//  - Mỗi ô lưới là một nốt trong thang ngũ cung của tông bài (SFX_RIFF, lặp lại mỗi 2 ô nhịp): gõ đều theo phách nghe thành
//    một đoạn chuông đệm theo bài. Tông lấy ở songs.js (key) hoặc file nốt (tools/make-chart.mjs đo sẵn).
//    Bài chưa biết tông thì chỉ có tiếng "tốc" trầm, không cao độ (không bao giờ lệch tông).
//  - Chưa phát nhạc / đang căn nhịp bằng tai: phát ngay; chuông đi lần lượt các nốt của hợp âm chủ.
//   kind: 'tap' gõ thường · 'big' trúng tim vàng (thêm nốt cao hơn một quãng tám) · 'soft' gõ lúc không có nốt khi đang chơi
// Âm lượng tiếng gõ chỉnh được ở mục "Tiếng gõ, căn nhịp & giới thiệu" (mặc định 35%).
let ac = null, sfxOut = null, noise = null;
let sfxVol = clampInt(store(SFX_VOL_KEY) ?? 35, 0, 100);
const SNAP_LATE = 0.07;     // gõ muộn hơn ô lưới không quá 70 ms vẫn phát ngay
function audio() {
  if (!soundOn || !sfxVol) return null;
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      sfxOut = sfxBus(ac);
      noise = noiseBuffer(ac);
    }
    sfxOut.gain.value = sfxVol / 100;
    if (ac.state !== 'running') ac.resume();
  } catch (e) { return null; }
  return ac;
}
// âm lượng → chặn mềm ở cuối (không dùng bộ nén: bộ nén của Chrome làm tiếng trễ thêm ~6 ms)
function sfxBus(c) {
  const vol = c.createGain(), pre = c.createGain(), shaper = c.createWaveShaper(), n = 2049, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {             // vào: ±1 ứng với ±2 (pre giảm một nửa); dưới 0.7 giữ nguyên, trên đó cong dần tới 0.98
    const x = (i / (n - 1)) * 4 - 2, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  pre.gain.value = 0.5;
  shaper.curve = curve;
  shaper.oversample = 'none';
  vol.connect(pre).connect(shaper).connect(c.destination);
  return vol;
}
function noiseBuffer(c) {
  const b = c.createBuffer(1, Math.round(c.sampleRate * 0.5), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// vỏ âm lượng: lên trong 2 ms rồi tắt dần trong `len` giây
function sfxEnv(c, out, t, vol, len) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  g.connect(out);
  return g;
}
function sfxOsc(c, out, t, vol, f0, f1, len) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + 0.04);
  o.connect(sfxEnv(c, out, t, vol, len));
  o.start(t);
  o.stop(t + len + 0.02);
}
// "tốc": thân trầm tụt cao độ (như gõ trống da nhỏ) + bồi âm cho loa điện thoại / laptop nghe rõ + tiếng chạm
function sfxThump(c, out, buf, t, v) {
  sfxOsc(c, out, t, v, 210, 82, 0.22);
  sfxOsc(c, out, t, v * 0.32, 420, 170, 0.09);
  const s = c.createBufferSource(), f = c.createBiquadFilter();
  s.buffer = buf;
  f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.7;
  s.connect(f).connect(sfxEnv(c, out, t, v * 0.33, 0.025));
  s.start(t, Math.random() * 0.3);
  s.stop(t + 0.05);
}
// chuông kiểu hộp nhạc: âm gốc ngân + bồi âm quãng 8, quãng 12 tắt nhanh + chút ánh kim
function sfxBell(c, out, t, f, v) {
  for (const [m, a, len] of [[1, 1, 0.9], [2, 0.3, 0.42], [3, 0.09, 0.22], [4.2, 0.05, 0.1]]) sfxOsc(c, out, t, v * a, f * m, f * m, len);
}
// tông: 'Db', 'F#m', 'Bb'… → { pc: cao độ chủ âm 0–11 (C = 0), minor }
function parseKey(str) {
  const m = /^([A-Ga-g])([#b]?)(m?)$/.exec(String(str || '').trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  return { pc: (base + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12, minor: m[3] === 'm' };
}
// vai trò trong thang ngũ cung: 0 chủ âm · 1 quãng 3 · 2 quãng 5 · 3 quãng 6 (thứ: 7) · 4 nốt nối (trưởng: quãng 2, thứ: quãng 4)
const SFX_ROLE = { major: [0, 4, 7, 9, 2], minor: [0, 3, 7, 10, 5] };
// đoạn chuông theo 16 ô nửa phách (2 ô nhịp): [vai trò, quãng 8]; ô chẵn là đúng phách
const SFX_RIFF = [[0, 1], [2, 0], [1, 0], [2, 0], [3, 0], [2, 0], [1, 0], [4, 0], [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 1], [3, 0], [2, 0]];
const SFX_ARP = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 0], [1, 0]];   // chưa có nhạc: lần lượt các nốt của hợp âm chủ
function bellFreq(key, slot, count) {
  if (!key) return 0;
  let f = 440 * 2 ** ((key.pc - 9) / 12);
  while (f < 370) f *= 2;
  while (f >= 740) f /= 2;                  // chủ âm nằm trong khoảng F#4–F#5
  const [role, oct] = slot == null ? SFX_ARP[count % SFX_ARP.length] : SFX_RIFF[((slot % 16) + 16) % 16];
  return f * 2 ** ((SFX_ROLE[key.minor ? 'minor' : 'major'][role] + 12 * oct) / 12);
}
// ô nửa phách cho cú gõ: tapBeat = phách lúc gõ (đã trừ độ trễ người chơi), nowBeat = phách lúc này, late = SNAP_LATE tính theo phách
function snapSlot(tapBeat, nowBeat, late) {
  const slot = Math.round(tapBeat * 2);
  return slot / 2 < nowBeat - late ? Math.ceil(nowBeat * 2 - 1e-9) : slot;
}
function sfxPlay(c, out, buf, kind, t, f) {
  const v = kind === 'soft' ? 0.5 : 1;
  sfxThump(c, out, buf, t, (f ? 0.4 : 0.85) * v);
  if (!f) return;
  sfxBell(c, out, t, f, 0.55 * v);
  if (kind === 'big') sfxBell(c, out, t + 0.003, f * 2, 0.28);
}
// Khi nào phát (giây kể từ bây giờ) và ô lưới nào. null = phát ngay, không theo lưới (chưa phát nhạc, bài chưa có nhịp…)
function sfxWhen(ms, note) {
  const s = song(), bpm = (game.chart && game.chart.bpm) || (s && s.bpm);
  const now = songTimeAt(performance.now());
  if (ms == null || !s || !bpm || !player.playing || now == null) return null;
  const a = s.versions[verI].anchor || 0, P = 60 / bpm, nowBeat = (now - a) / P;
  if (note) return { delay: Math.max(0, note.t - now), slot: Math.floor((note.t - a) / P * 2 + 1e-6), note: true };
  const tap = songTimeAt(ms);
  if (tap == null) return null;
  const slot = snapSlot((tap - offsetMs / 1000 - a) / P, nowBeat, SNAP_LATE / P);
  return { delay: Math.max(0, (slot / 2 - nowBeat) * P), slot, note: false };
}
let sfxCount = 0, sfxSlot = null;
// ms = lúc gõ (bỏ trống: phát ngay, như nghe thử / căn nhịp); note = nốt vừa gõ trúng trong ván chơi
function tapSound(kind, ms, note) {
  const c = audio();
  if (!c) return;
  const w = sfxWhen(ms, note);
  if (w && !w.note) {
    if (w.slot === sfxSlot) return;         // ô này đã có tiếng rồi
    sfxSlot = w.slot;
  }
  const s = song();
  const key = parseKey(s && s.key) || parseKey(game.chart && game.chart.key);
  sfxPlay(c, sfxOut, noise, kind, c.currentTime + (w ? w.delay : 0), bellFreq(key, w ? w.slot : null, sfxCount++));
}
function setSfxVol(v) {
  sfxVol = clampInt(v, 0, 100);
  store(SFX_VOL_KEY, String(sfxVol));
  $('sfxVol').value = String(sfxVol);
  $('sfxOut').textContent = sfxVol + '%';
  if (sfxOut) sfxOut.gain.value = sfxVol / 100;
}
setSfxVol(sfxVol);
let sfxTry = 0;
$('sfxVol').addEventListener('input', (e) => {
  setSfxVol(e.target.value);
  const now = performance.now();
  if (sfxVol && now - sfxTry > 180) { sfxTry = now; tapSound('tap'); }   // kéo tới đâu nghe thử tới đó
});
// tạo sẵn bộ âm thanh ngay lần chạm / bấm phím đầu tiên trên trang, để tiếng gõ đầu tiên không bị trễ
['pointerdown', 'keydown'].forEach((type) => addEventListener(type, () => { if (!ac) audio(); }, { capture: true, passive: true }));

// Bấm / chạm lightstick (pointerdown: không chờ nhấc tay, gõ nhanh được), hoặc phím Space, F, J ở bất cứ đâu
const stick = $('stick');
stick.addEventListener('pointerdown', (e) => { if (e.button > 0) return; cheer(e.timeStamp); });
stick.addEventListener('click', (e) => { if (e.detail === 0 && performance.now() - lastCheer > 150) cheer(e.timeStamp); });   // Enter khi đang chọn nút
stick.addEventListener('contextmenu', (e) => e.preventDefault());
// chạm vào làn nốt cũng là gõ (điện thoại: chỗ chạm to, ngay dưới video)
lane.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); cheer(e.timeStamp); });
lane.addEventListener('contextmenu', (e) => e.preventDefault());
// Space không bao giờ được kéo trang xuống: chặn cả lúc giữ phím (e.repeat) và lúc đang chọn một đường link.
// Chỉ nhường cho trình duyệt khi đang gõ / chọn trong ô, hoặc Space trên một nút khác (Space = bấm nút đó).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k !== ' ' && k !== 'f' && k !== 'j') return;
  const tg = e.target, tag = tg && tg.tagName;
  if (tg && tg !== stick) {
    if (tg.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && tg.type !== 'range')) return;
    if (k === ' ' && (tag === 'BUTTON' || tag === 'SUMMARY')) return;
  }
  if (document.querySelector('dialog[open], details.lang[open]')) return;
  e.preventDefault();
  if (!e.repeat) cheer(e.timeStamp);
});

/* ================= mức chơi, căn nhịp ================= */
$('level').replaceChildren(...LEVELS.map((k) => { const o = el('option', '', t('c.level.' + k)); o.value = k; return o; }));
$('level').value = level;
$('level').setAttribute('aria-label', t('c.mode'));
$('level').addEventListener('change', (e) => {
  level = LEVELS.includes(e.target.value) ? e.target.value : 'normal';
  store(LEVEL_KEY, level);
  resetRun('idle');
  paintGame();
});
$('start').addEventListener('click', () => { startGame(); $('main').focus({ preventScroll: true }); });

function setOffset(ms) {
  offsetMs = Math.max(-300, Math.min(300, Math.round((Number(ms) || 0) / 5) * 5));
  store(OFFSET_KEY, String(offsetMs));
  $('offset').value = String(offsetMs);
  $('offOut').textContent = (offsetMs > 0 ? '+' : '') + offsetMs + ' ms';
}
setOffset(offsetMs);
$('offset').addEventListener('input', (e) => setOffset(e.target.value));
// Căn nhịp bằng tai: video đang phát, gõ theo phách 8 lần → độ lệch trung bình (trung vị) so với phách = độ trễ
let sync = null;
$('syncBtn').addEventListener('click', () => {
  const s = song();
  const bpm = (game.chart && game.chart.bpm) || (s && s.bpm);
  const anchor = s && s.versions[verI].anchor;
  if (!bpm || anchor == null || !player.playing) { $('syncOut').textContent = t('c.syncNeedPlay'); return; }
  sync = { taps: [], P: 60 / bpm, a: anchor };
  $('syncOut').textContent = t('c.syncLeft', { n: 8 });
  $('main').focus({ preventScroll: true });   // Space tiếp theo là gõ, không bấm lại nút này
});
function syncTap(ms) {
  const st = songTimeAt(ms);
  if (st == null || !player.playing) { $('syncOut').textContent = t('c.syncNeedPlay'); sync = null; return; }
  const ph = (st - sync.a) / sync.P;
  sync.taps.push((ph - Math.round(ph)) * sync.P);
  const left = 8 - sync.taps.length;
  if (left > 0) { $('syncOut').textContent = t('c.syncLeft', { n: left }); return; }
  const d = [...sync.taps].sort((x, y) => x - y);
  setOffset(((d[3] + d[4]) / 2) * 1000);
  $('syncOut').textContent = t('c.syncDone', { ms: (offsetMs > 0 ? '+' : '') + offsetMs });
  sync = null;
}
prepareSong();

/* ================= vòng lặp mỗi khung hình ================= */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.hidden) return;
  const st = songTime(now);
  updateGame(st);
  drawLane(st, now);
  danceCat(st, now);
  const bursting = now < burstUntil;
  // năng lượng tự giảm khi không gõ; đang chơi thì giảm chậm hơn (nốt thưa vẫn giữ được)
  if (!bursting) energy = Math.max(0, energy - dt * (now - lastCheer > 800 ? (game.state === 'play' ? 3 : 7) : 1.5));
  const e = Math.round(bursting ? 100 : energy);
  if (e !== shownEnergy) {
    shownEnergy = e;
    $('energy').firstElementChild.style.width = e + '%';
    $('energy').setAttribute('aria-valuenow', String(e));
  }
  if (hall) {
    const s = song();
    hall.frame(now / 1000, dt, { energy: bursting ? 100 : energy, playing: player.playing,
      bpm: (game.chart && game.chart.bpm) || (s ? s.bpm : 0), beat: beatPos(st), bursting });
  }
}
requestAnimationFrame(frame);

/* ================= sảnh 3D ================= */
initHall().then((h) => {
  if (!h) return;
  hall = h;
  applyTheme();
  applyTeam();
  hall.setSeat(seatId, true);
});

async function initHall() {
  let THREE;
  try { THREE = await import(THREE_URL); }
  catch (e) { console.warn('[cheer] Không tải được three.js, trang chạy không có sảnh 3D.', e); return null; }
  try { return makeHall(THREE, $('hall')); }
  catch (e) { console.warn('[cheer] Máy không vẽ được sảnh 3D (WebGL).', e); return null; }
}

// số ngẫu nhiên có hạt giống cố định: lần nào vào cũng cùng một đám đông
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeHall(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setClearColor(0x0b0810, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c0714, 0.021);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 160);
  const rand = mulberry32(20261118);
  const add = (o) => { scene.add(o); return o; };
  const dark = (hex) => new THREE.MeshLambertMaterial({ color: hex });

  /* ---- ánh sáng: rọi từ sân khấu xuống đám đông (thấy lưng khán giả thành bóng), thêm chút sáng phía sau ---- */
  add(new THREE.HemisphereLight(0x6a4d8a, 0x0a0612, 1.1));
  const key = add(new THREE.DirectionalLight(0xff6fb0, 2.4));
  key.position.set(0, 14, -34);
  const fill = add(new THREE.DirectionalLight(0x5c4d84, 0.7));
  fill.position.set(0, 9, 30);

  /* ---- sàn, sân khấu, khung đèn, khán đài trên ---- */
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(90, 100), dark(0x140f1b)));
  floor.rotation.x = -Math.PI / 2;
  add(new THREE.Mesh(new THREE.BoxGeometry(30, 1.3, 9), dark(0x1d1526))).position.set(0, 0.65, -28.5);
  add(new THREE.Mesh(new THREE.BoxGeometry(33, 0.45, 0.45), dark(0x221a2b))).position.set(0, 16.3, -27);
  for (const sx of [-16, 16]) add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 16.5, 0.5), dark(0x221a2b))).position.set(sx, 8.2, -27);
  for (let r = 0; r < 7; r++) {
    const h = 2.6 + r * 0.6;
    add(new THREE.Mesh(new THREE.BoxGeometry(36, h, 1.1), dark(0x17111e))).position.set(0, h / 2, 18 + r * 1.1);
  }

  /* ---- ánh sáng tròn mờ dùng chung cho đầu lightstick, bóng đèn ---- */
  const glowTex = (() => {
    const s = 64, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,.85)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  })();

  /* ---- màn LED phía sau sân khấu: lưới chấm sáng tự chạy hiệu ứng (vẽ bằng shader, màu theo bài) ----
     sóng màu chạy chéo · các cột sáng cao thấp đổi mỗi phách (như thanh âm lượng) · vòng sáng lan ra mỗi phách ·
     chấm lấp lánh · loé lên khi người xem gõ. uStep = số thứ tự phách, uPulse = 1 đúng phách rồi tắt dần về 0. */
  const ledMat = new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uB: { value: new THREE.Color() },
      uTime: { value: 0 }, uStep: { value: 0 }, uPulse: { value: 0 }, uEnergy: { value: 0 }, uFlash: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform vec3 uA; uniform vec3 uMid; uniform vec3 uB;',
      'uniform float uTime; uniform float uStep; uniform float uPulse; uniform float uEnergy; uniform float uFlash;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'void main(){',
      '  vec2 g = vUv * vec2(68.0, 34.0); vec2 cell = floor(g); vec2 f = fract(g) - 0.5;',
      '  float dotMask = smoothstep(0.36, 0.2, length(f));',
      '  vec2 u = (cell + 0.5) / vec2(68.0, 34.0);',
      '  float m = max(0.0, 1.0 - length(vec2(u.x - 0.5, (u.y - 0.45) * 1.6)) * 1.8) * 0.8;',
      '  vec3 col = mix(mix(uA, uB, u.x), uMid, m);',
      '  float wave = 0.5 + 0.5 * sin(u.x * 9.0 + u.y * 5.0 - uTime * 1.5);',
      '  float h = 0.14 + 0.52 * hash(vec2(cell.x, uStep)) * (0.3 + 0.7 * uEnergy) + 0.22 * uPulse;',
      '  float bar = step(u.y, h) * (0.55 + 0.45 * u.y / max(h, 0.01));',
      '  float d = length(vec2(u.x - 0.5, (u.y - 0.5) * 0.5));',
      '  float ring = smoothstep(0.05, 0.0, abs(d - (1.0 - uPulse) * 0.62)) * uPulse;',
      '  float tw = step(0.962, hash(cell + floor(uTime * 5.0)));',
      '  float glow = 0.14 + 0.3 * wave + 0.55 * bar + 0.9 * ring + 0.6 * tw + 0.55 * uFlash;',
      '  gl_FragColor = vec4(col * glow * dotMask + vec3(0.012, 0.008, 0.02), 1.0);',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  add(new THREE.Mesh(new THREE.PlaneGeometry(34, 17), ledMat)).position.set(0, 9.2, -33);

  /* ---- dải bóng đèn: hai cột hai bên, xà trên, mép sân khấu, mép khán đài trên ---- */
  // mỗi dải ghi thứ tự bóng (dotK) để cho ánh sáng chạy đuổi dọc theo dải
  const dots = [], dotK = [];
  const strip = (pts) => pts.forEach((p, i) => { dots.push(p[0], p[1], p[2]); dotK.push(i); });
  const range = (a, b, step, f) => { const out = []; for (let v = a; v <= b + 1e-6; v += step) out.push(f(v)); return out; };
  for (const sx of [-16, 16]) strip(range(0.6, 15.9, 0.5, (y) => [sx + (sx < 0 ? 0.45 : -0.45), y, -26.6]));
  strip(range(-16, 16, 0.5, (x) => [x, 16, -26.6]));
  strip(range(-14.5, 14.5, 0.5, (x) => [x, 1.33, -23.95]));
  strip(range(-17.5, 17.5, 0.6, (x) => [x, 2.68, 17.42]));
  for (const sx of [-11.5, 11.5]) strip(range(1.6, 13.4, 0.45, (y) => [sx, y, -26.9]));     // hai trụ đèn trong
  const dotCol = new Float32Array(dotK.length * 3).fill(0.8);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
  dotGeo.setAttribute('color', new THREE.BufferAttribute(dotCol, 3).setUsage(THREE.DynamicDrawUsage));
  const dotMat = new THREE.PointsMaterial({ size: 0.42, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  add(new THREE.Points(dotGeo, dotMat));
  for (const sx of [-11.5, 11.5]) add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 13.6, 0.3), dark(0x221a2b))).position.set(sx, 6.8, -27.1);

  /* ---- đèn chớp (blinder) trên hai trụ trong: loé theo phách, xen kẽ trên / dưới ---- */
  const BLIND = [];
  for (const sx of [-11.5, 11.5]) for (const y of [4, 8.5, 13]) BLIND.push([sx, y, -26.7]);
  const blindCol = new Float32Array(BLIND.length * 3);
  const blindGeo = new THREE.BufferGeometry();
  blindGeo.setAttribute('position', new THREE.Float32BufferAttribute(BLIND.flat(), 3));
  blindGeo.setAttribute('color', new THREE.BufferAttribute(blindCol, 3).setUsage(THREE.DynamicDrawUsage));
  add(new THREE.Points(blindGeo, new THREE.PointsMaterial({
    size: 3.4, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  })));

  /* ---- tia laser: hai chùm hình quạt từ hai bên sân khấu, quét qua đầu khán giả khi năng lượng cao ---- */
  const LASER_RAYS = 7, LASER_FROM = [[-10.5, 2.1, -24.4], [10.5, 2.1, -24.4]];
  const lasPos = new Float32Array(LASER_FROM.length * LASER_RAYS * 6);
  const lasGeo = new THREE.BufferGeometry();
  lasGeo.setAttribute('position', new THREE.BufferAttribute(lasPos, 3).setUsage(THREE.DynamicDrawUsage));
  const lasMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const lasers = add(new THREE.LineSegments(lasGeo, lasMat));
  lasers.frustumCulled = false;
  lasers.visible = false;

  /* ---- đèn màu lia qua đám đông (3 bóng di chuyển phía trên): vai và đầu khán giả ánh lên theo ---- */
  const movers = [0, 1, 2].map(() => add(new THREE.PointLight(0xffffff, 0, 15, 1.8)));

  /* ---- hai bên tường sảnh có thanh đèn dọc, sáng chạy đuổi về phía sân khấu (thấy rõ từ cuối sảnh / khán đài trên) ---- */
  for (const sx of [-18.6, 18.6]) {
    const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(62, 19), dark(0x120c18)));
    wall.position.set(sx, 9.5, -4);
    wall.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const BARS = [];
  for (const sx of [-18.4, 18.4]) for (let z = -20; z <= 22; z += 6) BARS.push([sx, 7.5, z]);
  const bars = add(new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 10, 0.45), new THREE.MeshBasicMaterial(), BARS.length));
  const barMtx = new THREE.Matrix4();
  BARS.forEach((p, i) => { barMtx.makeTranslation(p[0], p[1], p[2]); bars.setMatrixAt(i, barMtx); bars.setColorAt(i, new THREE.Color(0x221428)); });
  bars.frustumCulled = false;

  /* ---- bụi sáng lơ lửng trong không khí ---- */
  const MN = reduced ? 0 : small ? 90 : 170;
  const mBase = new Float32Array(MN * 3), mPos = new Float32Array(MN * 3), mSeed = new Float32Array(MN);
  for (let i = 0; i < MN; i++) {
    mBase[i * 3] = (rand() - 0.5) * 34; mBase[i * 3 + 1] = 1.5 + rand() * 12; mBase[i * 3 + 2] = -24 + rand() * 40;
    mSeed[i] = rand();
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
  const moteMat = new THREE.PointsMaterial({ size: 0.17, map: glowTex, color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = add(new THREE.Points(moteGeo, moteMat));
  motes.frustumCulled = false;

  /* ---- cột đèn quét (hình nón sáng mờ dần) ---- */
  const beamGeo = new THREE.ConeGeometry(3.4, 30, 28, 1, true);
  beamGeo.translate(0, -15, 0);   // đỉnh nón ở gốc toạ độ, loe xuống dưới
  const beams = [-11, -6.6, -2.2, 2.2, 6.6, 11].map((x, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uAlpha: { value: 0.2 } },
      vertexShader: 'varying float vT; varying vec3 vN; varying vec3 vV;' +
        'void main(){ vT = -position.y / 30.0; vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
        ' vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vT; varying vec3 vN; varying vec3 vV;' +
        'void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);' +
        ' float a = uAlpha * pow(1.0 - clamp(vT, 0.0, 1.0), 1.7) * edge; gl_FragColor = vec4(uColor, a);\n' +
        '#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = add(new THREE.Mesh(beamGeo, mat));
    m.position.set(x, 15.6, -26.6);
    m.userData.k = i;
    return m;
  });

  /* ---- đám đông ---- */
  const people = [];
  // chừa trống quanh mỗi chỗ ngồi, để đầu người ngay sát không thành mảng đen che màn hình
  const nearSeat = (x, y, z) => SEATS.some((s) => Math.abs(s.pos[1] - 1.72 - y) < 1 && Math.hypot(s.pos[0] - x, s.pos[2] - z) < 1.45);
  const person = (x, y, z) => ({
    x, y, z, s: 0.92 + rand() * 0.16, side: rand() < 0.5 ? -1 : 1, ph: (rand() - 0.5) * 1.1,
    stick: rand() < 0.88, team: rand() < 0.56 ? 0 : 1, white: rand() < 0.06,
  });
  const sp = small ? 0.92 : 0.76;
  for (let z = -21.6; z <= 14.5; z += sp) {
    for (let x = -12.6; x <= 12.6; x += sp) {
      const px = x + (rand() - 0.5) * sp * 0.55, pz = z + (rand() - 0.5) * sp * 0.55;
      if (!nearSeat(px, 0, pz)) people.push(person(px, 0, pz));
    }
  }
  for (let r = 0; r < 7; r++) {
    const y = 2.6 + r * 0.6, z = 18 + r * 1.1;
    for (let x = -16.5; x <= 16.5; x += sp * 1.05) {
      const px = x + (rand() - 0.5) * 0.25;
      if (!nearSeat(px, y, z)) people.push(person(px, y, z + (rand() - 0.5) * 0.2));
    }
  }
  const N = people.length;
  // vài người giơ bảng tên thay cho lightstick; người không cầm gì thì phần lớn bật đèn điện thoại
  const BOARD_KINDS = 5;
  let boardsLeft = small ? 22 : 40;
  for (const p of people) {
    // (không phát bảng cho người đứng gần chỗ ngồi: bảng sát mắt sẽ che màn hình)
    const nearCam = SEATS.some((s) => Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z) < 4.5);
    if (boardsLeft > 0 && !nearCam && p.z > -20 && p.z < 21 && rand() < 0.03) { p.board = (rand() * BOARD_KINDS) | 0; p.stick = false; boardsLeft--; }
    else if (!p.stick) p.phone = rand() < 0.65;
  }
  const CLOTH =['#2c2238', '#382a44', '#221b2b', '#43303b', '#2b3142', '#4b3b55', '#3a2630', '#1f2230'].map((c) => new THREE.Color(c));
  const HAIR = ['#171214', '#2a1c16', '#3b291f', '#120f16', '#4d3426', '#5b4a3e'].map((c) => new THREE.Color(c));
  const bodies = add(new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.95, small ? 2 : 4, small ? 7 : 10), new THREE.MeshLambertMaterial(), N));
  const heads = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, small ? 8 : 12, small ? 6 : 9), new THREE.MeshLambertMaterial(), N));
  const mtx = new THREE.Matrix4();
  people.forEach((p, i) => {
    mtx.makeScale(p.s, p.s, p.s);
    mtx.setPosition(p.x, p.y + 0.675 * p.s, p.z);
    bodies.setMatrixAt(i, mtx);
    mtx.setPosition(p.x, p.y + 1.5 * p.s, p.z);
    heads.setMatrixAt(i, mtx);
    bodies.setColorAt(i, CLOTH[(rand() * CLOTH.length) | 0]);
    heads.setColorAt(i, HAIR[(rand() * HAIR.length) | 0]);
  });
  for (const im of [bodies, heads]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; }
  const bodyArr = bodies.instanceMatrix.array, headArr = heads.instanceMatrix.array;

  // lightstick của đám đông: cán = đoạn thẳng, đầu = chấm sáng (màu hai phe, vài người cầm đèn trắng);
  // đèn điện thoại cũng là một chấm sáng trắng (không có cán, không lắc)
  const holders = people.filter((p) => p.stick || p.phone);
  const M = holders.length;
  const stickPos = new Float32Array(M * 6), tipPos = new Float32Array(M * 3), tipCol = new Float32Array(M * 3);
  const stickGeo = new THREE.BufferGeometry();
  stickGeo.setAttribute('position', new THREE.BufferAttribute(stickPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sticks = add(new THREE.LineSegments(stickGeo, new THREE.LineBasicMaterial({ color: 0xb4a6c4, transparent: true, opacity: 0.32 })));
  const tipGeo = new THREE.BufferGeometry();
  tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3).setUsage(THREE.DynamicDrawUsage));
  tipGeo.setAttribute('color', new THREE.BufferAttribute(tipCol, 3).setUsage(THREE.DynamicDrawUsage));
  const tips = add(new THREE.Points(tipGeo, new THREE.PointsMaterial({
    size: 0.6, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  sticks.frustumCulled = tips.frustumCulled = false;
  const teamCol = [new THREE.Color(TEAM.a), new THREE.Color(TEAM.b)], whiteCol = new THREE.Color('#fff2fa');
  const userCol = new THREE.Color(TEAM.a), tmp = new THREE.Color();

  /* ---- bảng tên fan giơ trên đầu (bảng đèn LED): 5 kiểu chữ, mỗi kiểu một InstancedMesh ---- */
  const HEART_D = 'M50 84C20 64 9 45 20 29c9-13 25-11 30 1 5-12 21-14 30-1 11 16 0 35-30 55z';
  function boardTexture(parts, glow) {
    const W = 256, H = 96, cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#170d20';
    g.fillRect(0, 0, W, H);
    g.lineWidth = 6;
    g.strokeStyle = glow;
    g.shadowColor = glow;
    g.shadowBlur = 12;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.font = '900 50px "Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    const HW = 52, GAP = 8;
    const widths = parts.map((s) => (s === '♥' ? HW : g.measureText(s).width));
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1);
    const k = Math.min(1, (W - 40) / total);
    g.translate(W / 2, H / 2 + 2);
    g.scale(k, k);
    let x = -total / 2;
    parts.forEach((s, i) => {
      if (s === '♥') {
        g.save();
        g.translate(x, -26);
        g.scale(0.52, 0.52);
        g.fillStyle = '#ff5c9d';
        g.shadowColor = '#ff5c9d';
        g.fill(new Path2D(HEART_D));
        g.restore();
      } else {
        g.fillStyle = '#fff';
        g.shadowColor = glow;
        g.shadowBlur = 16;
        g.fillText(s, x, 0);
        g.fillText(s, x, 0);      // vẽ hai lần cho chữ sáng rõ trên quầng sáng
      }
      x += widths[i] + GAP;
    });
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 4;
    return tx;
  }
  const BOARD_DEFS = [[['LENA', '♥', 'MIU'], TEAM.a], [['LenaMiu'], TEAM.b], [['LENA'], TEAM.a], [['MIU'], TEAM.b], [['♥', 'LM', '♥'], '#ffd36e']];
  const boardGeo = typeof Path2D === 'function' ? new THREE.PlaneGeometry(0.98, 0.37) : null;
  const boards = [];
  if (boardGeo) {
    BOARD_DEFS.forEach(([parts, glow], kind) => {
      const who = people.filter((p) => p.board === kind);
      if (!who.length) return;
      const mesh = add(new THREE.InstancedMesh(boardGeo, new THREE.MeshBasicMaterial({ map: boardTexture(parts, glow), side: THREE.DoubleSide }), who.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      who.forEach((p, i) => boards.push({ p, mesh, i }));
    });
  }

  /* ---- trái tim bay lên từ đám đông mỗi lần người xem gõ (gõ trúng nốt thì nhiều hơn) ---- */
  const heartTex = (() => {
    const s = 64, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    if (typeof Path2D !== 'function') return glowTex;
    const g = cv.getContext('2d');
    g.translate(2, 1);
    g.scale(0.6, 0.6);
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 5;
    g.fill(new Path2D(HEART_D));
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  })();
  const HN = reduced ? 0 : small ? 60 : 120;
  const hPos = new Float32Array(HN * 3).fill(-99), hCol = new Float32Array(HN * 3), hBase = new Float32Array(HN * 3);
  const hVy = new Float32Array(HN), hLife = new Float32Array(HN), hSeed = new Float32Array(HN);
  const hGeo = new THREE.BufferGeometry();
  hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3).setUsage(THREE.DynamicDrawUsage));
  hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 3).setUsage(THREE.DynamicDrawUsage));
  const heartPts = add(new THREE.Points(hGeo, new THREE.PointsMaterial({
    size: 0.62, map: heartTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  heartPts.frustumCulled = false;
  let hNext = 0, hAlive = 0;
  // n trái tim bay lên từ đầu những khán giả ở gần điểm (cx, cz) trong bán kính r
  function spawnHearts(n, cx, cz, r, color) {
    for (let k = 0; k < n && HN; k++) {
      let p = people[(Math.random() * N) | 0];
      // tìm người trong vùng, nhưng không lấy người đứng sát máy quay (trái tim sát mắt sẽ to che màn hình)
      const bad = (q) => Math.hypot(q.x - cx, q.z - cz) > r || Math.hypot(q.x - camera.position.x, q.z - camera.position.z) < 3.2;
      for (let tries = 0; tries < 12 && bad(p); tries++) p = people[(Math.random() * N) | 0];
      if (bad(p) && Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < 3.2) continue;
      const i = hNext;
      hNext = (hNext + 1) % HN;
      hPos[i * 3] = p.x; hPos[i * 3 + 1] = p.y + 1.9; hPos[i * 3 + 2] = p.z;
      hBase[i * 3] = color.r; hBase[i * 3 + 1] = color.g; hBase[i * 3 + 2] = color.b;
      hVy[i] = 1.3 + Math.random() * 1.3;
      hLife[i] = 1.5 + Math.random() * 0.8;
      hSeed[i] = Math.random() * 6.28;
    }
    hAlive = 1;
  }

  /* ---- pháo hoa phun ở mép sân khấu: khi năng lượng đầy (4 ống, 1.6 giây) hoặc gõ trúng tim vàng (2 ống, phụt ngắn) ---- */
  const PYRO_FROM = [[-12.6, 1.4, -24.1], [12.6, 1.4, -24.1], [-9.4, 1.4, -24.1], [9.4, 1.4, -24.1]];
  const PN = reduced ? 0 : small ? 220 : 460;
  const pPos = new Float32Array(PN * 3).fill(-99), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const pyro = add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.26, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  })));
  pyro.frustumCulled = false;
  pyro.visible = false;
  let pNext = 0, pyroUntil = -1, pyroTubes = 4, pyroDebt = 0;
  function emitPyro(n) {
    for (let k = 0; k < n && PN; k++) {
      const i = pNext, e = PYRO_FROM[(Math.random() * pyroTubes) | 0];
      pNext = (pNext + 1) % PN;
      pPos[i * 3] = e[0]; pPos[i * 3 + 1] = e[1]; pPos[i * 3 + 2] = e[2];
      pVel[i * 3] = (Math.random() - 0.5) * 2.2; pVel[i * 3 + 1] = 9 + Math.random() * 5; pVel[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
      pLife[i] = 0.9 + Math.random() * 0.7;
    }
  }

  /* ---- pháo giấy khi năng lượng đầy ---- */
  const CN = reduced ? 0 : small ? 160 : 320;
  const cPos = new Float32Array(CN * 3), cCol = new Float32Array(CN * 3), cVy = new Float32Array(CN);
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3).setUsage(THREE.DynamicDrawUsage));
  cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  const confetti = add(new THREE.Points(cGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true })));
  confetti.frustumCulled = false;
  confetti.visible = false;

  /* ---- máy quay (chỗ ngồi) ---- */
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), look = new THREE.Vector3();
  const fromPos = new THREE.Vector3(), fromLook = new THREE.Vector3(), toPos = new THREE.Vector3(), toLook = new THREE.Vector3();
  let camT = 1, portrait = false;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = w / h < 0.9;
    camera.fov = portrait ? 68 : w / h < 1.3 ? 58 : 48;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });

  // biên dịch sẵn shader của mọi hiệu ứng (kể cả thứ đang ẩn), để lần đầu pháo hoa / laser hiện ra không làm khựng hình
  const hidden = [lasers, pyro, confetti].filter((o) => !o.visible);
  hidden.forEach((o) => { o.visible = true; });
  try { renderer.compile(scene, camera); } catch (e) { /* bỏ qua */ }
  hidden.forEach((o) => { o.visible = false; });

  /* ---- mỗi khung hình ---- */
  const TAP_LIFE = 2.6;
  const taps = [];
  let now = 0, phase = 0, burstAt = -99, flash = 0, beamClock = 0;
  let themeCols = [new THREE.Color(0xffffff)];
  function frame(time, dt, st) {
    now = time;
    if (lost) return;
    // nhịp lắc: đang phát bài có bpm thì một nhịp lắc qua lại = 2 phách, bám theo giây của video
    const rate = st.playing && st.bpm ? Math.PI * st.bpm / 60 : st.playing ? 1.7 : 1.15;
    phase += dt * rate;
    if (st.beat != null) {
      let diff = Math.PI * st.beat - phase;
      diff -= Math.round(diff / (2 * Math.PI)) * 2 * Math.PI;
      phase += diff * Math.min(1, dt * 2.5);
    }
    // phách: bp = số phách (liên tục), step = phách thứ mấy, hit = 1 đúng phách rồi tắt dần (chỉ khi video đang phát),
    // pulse = nhô lên quanh mỗi phách. E = năng lượng khán đài 0..1.
    const bp = phase / Math.PI, step = Math.floor(bp);
    const hit = st.playing && !reduced ? (1 - (bp - step)) ** 2 : 0;
    const pulse = st.playing ? Math.max(0, Math.cos(phase * 2)) ** 4 : 0;
    const E = st.energy / 100;
    flash = Math.max(0, flash - dt * 3);
    const amp = (st.playing ? 0.34 : 0.16) + st.energy * 0.0026;
    const jump = reduced ? 0 : (st.energy / 100) ** 2 * 0.1 + (st.bursting ? 0.26 : 0);
    while (taps.length && time - taps[0].t > TAP_LIFE) taps.shift();

    for (let i = 0, k = 0; i < N; i++) {
      const p = people[i];
      // sóng sáng: mỗi lần gõ, một vòng sáng lan ra từ chỗ người xem ngồi (15 m/giây)
      let boost = 0;
      for (let j = 0; j < taps.length; j++) {
        const tp = taps[j], age = time - tp.t;
        const d = Math.hypot(p.x - tp.x, p.z - tp.z) - age * 15;
        boost += Math.exp(-d * d / 4.5) * (1 - age / TAP_LIFE) * tp.p;
      }
      if (boost > 1.4) boost = 1.4;
      const ph = phase + p.ph;
      const hop = reduced ? 0 : jump * Math.max(0, Math.sin(ph * 2)) ** 2 + 0.16 * boost;
      const by = p.y + hop;
      bodyArr[i * 16 + 13] = by + 0.675 * p.s;
      headArr[i * 16 + 13] = by + 1.5 * p.s;
      if (p.board != null) p.by = by;
      if (p.phone) {              // đèn điện thoại: chấm trắng giơ ngang đầu, nhấp nháy nhẹ
        const px = p.x + p.side * 0.16, py = by + 1.78 * p.s, o = k * 6;
        stickPos[o] = stickPos[o + 3] = tipPos[k * 3] = px;
        stickPos[o + 1] = stickPos[o + 4] = tipPos[k * 3 + 1] = py;
        stickPos[o + 2] = stickPos[o + 5] = tipPos[k * 3 + 2] = p.z;
        const v = (0.4 + 0.14 * Math.sin(time * 2.1 + p.ph * 9)) * (1 + boost);
        tipCol[k * 3] = whiteCol.r * v; tipCol[k * 3 + 1] = whiteCol.g * v; tipCol[k * 3 + 2] = whiteCol.b * v;
        k++;
        continue;
      }
      if (!p.stick) continue;
      const th = (reduced ? amp * 0.3 : amp) * Math.sin(ph);
      const hx = p.x + p.side * 0.19 * p.s, hy = by + 1.56 * p.s, hz = p.z - 0.04, L = 0.42 * p.s;
      const tx = hx + Math.sin(th) * L, ty = hy + Math.cos(th) * L;
      const o = k * 6;
      stickPos[o] = hx; stickPos[o + 1] = hy; stickPos[o + 2] = hz;
      stickPos[o + 3] = tx; stickPos[o + 4] = ty; stickPos[o + 5] = hz;
      tipPos[k * 3] = tx; tipPos[k * 3 + 1] = ty; tipPos[k * 3 + 2] = hz;
      tmp.copy(p.white ? whiteCol : teamCol[p.team]).lerp(userCol, Math.min(1, boost));
      const br = 0.72 + 1.3 * boost + (st.bursting ? 0.35 : 0) + st.energy * 0.003 + 0.2 * pulse;
      tipCol[k * 3] = tmp.r * br; tipCol[k * 3 + 1] = tmp.g * br; tipCol[k * 3 + 2] = tmp.b * br;
      k++;
    }
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    stickGeo.attributes.position.needsUpdate = true;
    tipGeo.attributes.position.needsUpdate = tipGeo.attributes.color.needsUpdate = true;

    // bảng tên: đi theo người cầm, nghiêng qua lại theo nhịp
    for (const b of boards) {
      const p = b.p;
      mtx.makeRotationZ(reduced ? 0 : 0.11 * Math.sin(phase + p.ph));
      mtx.setPosition(p.x, (p.by || p.y) + 2.04 * p.s, p.z + 0.03);
      b.mesh.setMatrixAt(b.i, mtx);
      b.mesh.instanceMatrix.needsUpdate = true;
    }

    // màn LED
    const U = ledMat.uniforms;
    U.uTime.value = reduced ? 0 : time;
    U.uStep.value = step;
    U.uPulse.value = hit;
    U.uEnergy.value = E;
    U.uFlash.value = flash + (st.bursting ? 0.35 : 0);

    // đèn quét: lia nhanh hơn khi năng lượng cao, đổi màu mỗi 8 phách
    const nc = themeCols.length, shift = st.playing ? Math.floor(bp / 8) : 0;
    beamClock += dt * (1 + 1.3 * E);
    for (const b of beams) {
      const k = b.userData.k;
      b.rotation.x = -(reduced ? 0.55 : 0.55 + 0.25 * Math.sin(beamClock * 0.45 + k * 1.7));
      b.rotation.z = reduced ? (k - 2.5) * 0.08 : 0.35 * Math.sin(beamClock * 0.31 + k * 2.3);
      b.material.uniforms.uAlpha.value = 0.15 + 0.12 * hit + st.energy * 0.0009 + (st.bursting ? 0.08 : 0);
      b.material.uniforms.uColor.value.copy(themeCols[(k + shift) % nc]);
    }

    // dải bóng đèn: ánh sáng chạy đuổi dọc theo dải, cả dải loé lên mỗi phách
    if (!reduced) {
      const sp2 = time * (4 + 5 * E);
      for (let i = 0; i < dotK.length; i++) {
        const w = 0.5 + 0.5 * Math.sin(dotK[i] * 0.55 - sp2);
        const v = 0.28 + 0.72 * w * w * w + 0.5 * hit;
        dotCol[i * 3] = v; dotCol[i * 3 + 1] = v * 0.89; dotCol[i * 3 + 2] = v * 0.95;
      }
      dotGeo.attributes.color.needsUpdate = true;
    }

    // đèn chớp: xen kẽ nhau loé theo phách
    for (let i = 0; i < BLIND.length; i++) {
      const v = reduced ? 0.2 : 0.12 + ((i + step) % 2 === 0 ? 1.25 : 0.25) * hit + (st.bursting ? 0.45 : 0);
      const c = themeCols[i % nc];
      blindCol[i * 3] = (c.r * 0.6 + 0.4) * v; blindCol[i * 3 + 1] = (c.g * 0.6 + 0.4) * v; blindCol[i * 3 + 2] = (c.b * 0.6 + 0.4) * v;
    }
    blindGeo.attributes.color.needsUpdate = true;

    // laser: hiện dần khi năng lượng trên 35%, rõ nhất lúc bùng nổ
    const lasOp = reduced ? 0 : Math.min(1, Math.max(0, (st.energy - 35) / 45)) * 0.5 + (st.bursting ? 0.3 : 0);
    lasers.visible = lasOp > 0.01;
    if (lasers.visible) {
      lasMat.opacity = lasOp * (0.7 + 0.3 * hit);
      let o = 0;
      LASER_FROM.forEach((f, e) => {
        const mid = (e ? -0.3 : 0.3) + 0.5 * Math.sin(time * 0.9 + e * 2.1);
        const pitch = 0.3 + 0.16 * Math.sin(time * 0.7 + e * 1.3), cp = Math.cos(pitch);
        const spread = 0.1 * (1 + 0.5 * Math.sin(time * 1.7 + e));
        for (let r = 0; r < LASER_RAYS; r++) {
          const yaw = mid + (r - (LASER_RAYS - 1) / 2) * spread;
          lasPos[o++] = f[0]; lasPos[o++] = f[1]; lasPos[o++] = f[2];
          lasPos[o++] = f[0] + Math.sin(yaw) * cp * 48; lasPos[o++] = f[1] + Math.sin(pitch) * 48; lasPos[o++] = f[2] + Math.cos(yaw) * cp * 48;
        }
      });
      lasGeo.attributes.position.needsUpdate = true;
    }

    // đèn màu lia qua đám đông
    movers.forEach((l, k) => {
      const tt = reduced ? k * 2 : time;
      l.position.set(10 * Math.sin(tt * 0.5 + k * 2.1), 4.6, -9 + 11 * Math.sin(tt * 0.37 + k * 1.3));
      l.intensity = 16 + 20 * hit + 22 * E;
      l.color.copy(themeCols[k % nc]);
    });

    // thanh đèn hai bên tường: sáng chạy đuổi về phía sân khấu
    const perSide = BARS.length / 2;
    for (let i = 0; i < BARS.length; i++) {
      const row = i % perSide;
      const w = reduced ? 0.4 : Math.max(0, Math.sin(time * 2.6 + row * 0.9)) ** 3;
      tmp.copy(themeCols[(row + shift) % nc]).multiplyScalar(0.08 + w * (0.25 + 0.6 * E) + 0.25 * hit);
      bars.setColorAt(i, tmp);
    }
    bars.instanceColor.needsUpdate = true;

    // bụi sáng trôi chậm
    if (MN) {
      for (let i = 0; i < MN; i++) {
        const s = mSeed[i];
        mPos[i * 3] = mBase[i * 3] + Math.sin(time * 0.21 + s * 6.28) * 1.3;
        mPos[i * 3 + 1] = mBase[i * 3 + 1] + Math.sin(time * 0.17 + s * 12.7) * 0.9;
        mPos[i * 3 + 2] = mBase[i * 3 + 2] + Math.cos(time * 0.13 + s * 9.1) * 1.3;
      }
      moteGeo.attributes.position.needsUpdate = true;
      moteMat.opacity = 0.3 + 0.3 * E + 0.15 * hit;
    }

    // trái tim bay lên rồi mờ dần
    if (hAlive) {
      hAlive = 0;
      for (let i = 0; i < HN; i++) {
        if (hLife[i] <= 0) continue;
        hLife[i] -= dt;
        if (hLife[i] <= 0) { hPos[i * 3 + 1] = -99; hCol[i * 3] = hCol[i * 3 + 1] = hCol[i * 3 + 2] = 0; continue; }
        hAlive = 1;
        hPos[i * 3 + 1] += hVy[i] * dt;
        hPos[i * 3] += Math.sin(time * 3 + hSeed[i]) * 0.45 * dt;
        const f = Math.min(1, hLife[i] / 0.6) * 1.15;
        hCol[i * 3] = hBase[i * 3] * f; hCol[i * 3 + 1] = hBase[i * 3 + 1] * f; hCol[i * 3 + 2] = hBase[i * 3 + 2] * f;
      }
      hGeo.attributes.position.needsUpdate = hGeo.attributes.color.needsUpdate = true;
    }

    // pháo hoa phun: tia lửa vàng bay lên rồi rơi xuống
    if (PN && (time < pyroUntil || pyro.visible)) {
      if (time < pyroUntil) {
        pyroDebt += dt * PN / 1.5;
        const n = pyroDebt | 0;
        pyroDebt -= n;
        emitPyro(n);
        pyro.visible = true;
      }
      let alive = 0;
      for (let i = 0; i < PN; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= dt;
        if (pLife[i] <= 0) { pPos[i * 3 + 1] = -99; continue; }
        alive++;
        pVel[i * 3 + 1] -= 9.5 * dt;
        pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        const f = Math.min(1, pLife[i] / 0.5) * 1.6;
        pCol[i * 3] = f; pCol[i * 3 + 1] = f * 0.8; pCol[i * 3 + 2] = f * 0.42;
      }
      pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
      if (!alive && time >= pyroUntil) pyro.visible = false;
    }

    if (confetti.visible) {
      let alive = 0;
      for (let i = 0; i < CN; i++) {
        if (cPos[i * 3 + 1] < -50) continue;
        cPos[i * 3 + 1] += cVy[i] * dt;
        cPos[i * 3] += Math.sin(time * 2.2 + i) * 0.5 * dt;
        if (cPos[i * 3 + 1] < 0) cPos[i * 3 + 1] = -99; else alive++;
      }
      cGeo.attributes.position.needsUpdate = true;
      if (!alive && time - burstAt > 1) confetti.visible = false;
    }

    // máy quay: chuyển chỗ ngồi mượt, hơi đung đưa như người thật, nhún theo khi cả sảnh nhảy
    if (camT < 1) {
      camT = Math.min(1, camT + dt / 1.6);
      const e = camT < 0.5 ? 4 * camT ** 3 : 1 - (-2 * camT + 2) ** 3 / 2;
      camPos.lerpVectors(fromPos, toPos, e);
      camLook.lerpVectors(fromLook, toLook, e);
    }
    camera.position.copy(camPos);
    if (!reduced) {
      camera.position.x += Math.sin(time * 0.37) * 0.06;
      camera.position.y += Math.sin(time * 0.51) * 0.035 + jump * 0.5 * Math.max(0, Math.sin(phase * 2)) ** 2;
    }
    look.copy(camLook);
    if (portrait) look.y -= 1.4;    // màn hình dọc: video che nửa trên, hạ góc nhìn để thấy đám đông nhiều hơn
    camera.lookAt(look);
    renderer.render(scene, camera);
  }

  return {
    frame,
    setTheme(th) {
      themeCols = th.beams.map((c) => new THREE.Color(c));
      key.color.set(th.light);
      ledMat.uniforms.uA.value.set(th.led[0]);
      ledMat.uniforms.uMid.value.set(th.led[1]);
      ledMat.uniforms.uB.value.set(th.led[2]);
      lasMat.color.set(th.led[1]);
      moteMat.color.set(th.light).lerp(whiteCol, 0.45);
    },
    setTeam(hex) { userCol.set(hex); },
    setSeat(id, instant) {
      const s = SEATS.find((x) => x.id === id) || SEATS[1];
      toPos.fromArray(s.pos);
      toLook.fromArray(s.look);
      if (instant || reduced) { camPos.copy(toPos); camLook.copy(toLook); camT = 1; }
      else { fromPos.copy(camPos); fromLook.copy(camLook); camT = 0; }
    },
    // power: 1 = gõ thường, >1 = gõ trúng nốt (sóng sáng mạnh hơn), <1 = gõ hụt
    tap(power = 1) {
      taps.push({ t: now, x: camera.position.x, z: camera.position.z, p: power });
      if (taps.length > 8) taps.shift();
      flash = Math.min(1, flash + 0.3 * power);          // màn LED loé lên
      // trái tim bay lên từ khán giả phía trước mặt; gõ trúng tim vàng thì thêm pháo hoa phụt ngắn
      spawnHearts(power > 1.5 ? 6 : power >= 1 ? 3 : 1, camera.position.x, camera.position.z - 7, 8, userCol);
      if (power > 1.5 && now >= pyroUntil) { pyroTubes = 2; pyroUntil = now + 0.22; }
    },
    burst() {
      burstAt = now;
      pyroTubes = 4;
      pyroUntil = now + 1.6;
      spawnHearts(HN * 0.3, 0, -4, 60, teamCol[0]);
      spawnHearts(HN * 0.3, 0, -4, 60, teamCol[1]);
      if (!CN) return;
      const pal = [...teamCol, whiteCol, new THREE.Color('#ffd36e')];
      for (let i = 0; i < CN; i++) {
        cPos[i * 3] = (rand() - 0.5) * 28;
        cPos[i * 3 + 1] = 13 + rand() * 7;
        cPos[i * 3 + 2] = -22 + rand() * 34;
        cVy[i] = -(1.3 + rand() * 1.7);
        const c = pal[(rand() * pal.length) | 0];
        cCol[i * 3] = c.r; cCol[i * 3 + 1] = c.g; cCol[i * 3 + 2] = c.b;
      }
      cGeo.attributes.position.needsUpdate = cGeo.attributes.color.needsUpdate = true;
      confetti.visible = true;
    },
  };
}
