#!/usr/bin/env node
/* Soạn nốt cho trò chơi gõ nhịp ở Sảnh cổ vũ (cheer/) từ âm thanh của bài hát.

   Cách dùng (chạy ở thư mục lenamiu.xyz):
     node tools/make-chart.mjs "D:\nhac\style.webm" style
     node tools/make-chart.mjs "D:\nhac\style.webm" style --bpm 100 --anchor 1.375   ← đã biết nhịp / mốc phách
   (nhận mọi file ffmpeg đọc được: mp4, webm, m4a, mp3, wav...; cần cài ffmpeg như tools/up-video.mjs)

   Lệnh sẽ:
     1. Đọc âm thanh, tự đo nhịp (BPM) và mốc phách (giây của phách đầu tiên) nếu chưa ghi --bpm / --anchor.
     2. Tìm đoạn có nhạc theo phách (bỏ đoạn nói chuyện / vỗ tay ở đầu và cuối).
     3. Tìm những chỗ nhấn trong nhạc (trống, phách mạnh) và đặt nốt lên lưới phách cho 3 mức:
          easy   Dễ   chỉ trên phách, thưa
          normal Vừa  thêm nửa phách
          hard   Khó  thêm 1/4 phách, dày
        Đoạn to (điệp khúc) nhiều nốt hơn đoạn hát nhẹ. Vài phách mạnh nhất thành nốt to (gấp đôi điểm).
     4. Ghi cheer/charts/<tên>.json, in sẵn các dòng để dán vào cheer/songs.js.
   Nốt ghi theo SỐ PHÁCH tính từ mốc phách (không theo giây), nên mọi video của cùng một bài (cùng bản nhạc)
   dùng chung được một file nốt; mỗi video chỉ cần ô anchor riêng (giây có phách đầu tiên trong video đó).
   File âm thanh gốc không bị sửa và không bị chép vào thư mục web.
*/
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 22050, N = 1024, HOP = 256, FPS = SR / HOP;     // khung phân tích ~11.6 ms
// Mỗi mức: step = nốt được đặt cách nhau bội số mấy ô 1/4 phách (4 = chỉ trên phách), minGap = khoảng cách tối thiểu
// (ô 1/4 phách), density = số nốt trung bình mỗi phách, maxGap = khoảng trống dài nhất được phép (ô), big = tỉ lệ nốt to,
// floor = độ nhấn tối thiểu (so với mức nhấn thường gặp quanh đó) mới được đặt nốt.
const LEVELS = {
  easy:   { step: 4, minGap: 4, density: 0.42, maxGap: 24, big: 0.1,  floor: 0.55 },
  normal: { step: 2, minGap: 2, density: 0.85, maxGap: 16, big: 0.08, floor: 0.5 },
  hard:   { step: 1, minGap: 1, density: 1.45, maxGap: 12, big: 0.07, floor: 0.45 },
};

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [src, idArg] = plain;

function die(msg) { throw new Error(msg); }
function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---------- đọc âm thanh: mono, 22050 Hz, float32 ---------- */
function readAudio(file) {
  const dir = mkdtempSync(join(tmpdir(), 'lm-chart-'));
  try {
    const out = join(dir, 'a.f32');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', out],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.error) die('Không chạy được ffmpeg (máy đã cài ffmpeg chưa?): ' + r.error.message);
    if (r.status !== 0) die('ffmpeg không đọc được file: ' + file);
    const b = readFileSync(out);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ---------- FFT radix-2 tại chỗ ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h;
        const vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi;
        re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/* ---------- độ nhấn theo thời gian (spectral flux), tách 3 dải: trầm (trống), giữa (snare, vỗ tay), cao ---------- */
function analyze(x) {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP));
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const BANDS = [[2, 9], [9, 94], [94, 400]];          // ~43–190 Hz, 190 Hz–2 kHz, 2–8.6 kHz
  const flux = BANDS.map(() => new Float32Array(frames));
  const all = new Float32Array(frames), rms = new Float32Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float32Array(400), cur = new Float32Array(400);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < N; i++) { const s = x[f * HOP + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    for (let b = 1; b < 400; b++) cur[b] = Math.log1p(100 * Math.hypot(re[b], im[b]));
    BANDS.forEach(([lo, hi], k) => {
      let s = 0;
      for (let b = lo; b < hi; b++) { const d = cur[b] - prev[b]; if (d > 0) s += d; }
      flux[k][f] = s;
      all[f] += s;
    });
    [prev, cur] = [cur, prev];
  }
  // chỉ giữ phần nhô lên so với trung bình trượt ±0.25 s
  const detrend = (a) => {
    const W = Math.round(FPS * 0.25), out = new Float32Array(a.length);
    let s = 0, lo = 0, hi = -1;
    for (let f = 0; f < a.length; f++) {
      while (hi < Math.min(a.length - 1, f + W)) s += a[++hi];
      while (lo < f - W) s -= a[lo++];
      out[f] = Math.max(0, a[f] - s / (hi - lo + 1));
    }
    return out;
  };
  const on = detrend(all);
  const bands = flux.map(detrend);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length) || 1;
  const bm = bands.map(mean);
  // độ nhấn tổng hợp: trầm 45%, giữa 35%, cao 20% (mỗi dải chia cho mức trung bình của chính nó)
  const S = new Float32Array(frames);
  for (let f = 0; f < frames; f++) S[f] = 0.45 * bands[0][f] / bm[0] + 0.35 * bands[1][f] / bm[1] + 0.2 * bands[2][f] / bm[2];
  const low = bands[0].map((v) => v / bm[0]);
  return { frames, dur: x.length / SR, on, S, low, rms };
}
const peak = (a, t, r = 2) => {          // giá trị lớn nhất quanh thời điểm t (±r khung)
  const c = Math.round(t * FPS);
  let m = 0;
  for (let f = Math.max(0, c - r); f <= Math.min(a.length - 1, c + r); f++) if (a[f] > m) m = a[f];
  return m;
};
const lerpAt = (a, t) => {
  const p = t * FPS, i = Math.floor(p);
  return i < 0 || i + 1 >= a.length ? 0 : a[i] + (a[i + 1] - a[i]) * (p - i);
};
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/* ---------- nhịp + mốc phách ---------- */
function gridScore(on, bpm, a, b) {
  const P = 60 / bpm;
  let best = { s: -1, ph: 0 };
  const tryPh = (ph) => {
    let s = 0, n = 0;
    for (let t = a + ph; t < b; t += P) { s += lerpAt(on, t); n++; }
    s /= Math.max(1, n);
    if (s > best.s) best = { s, ph };
  };
  for (let k = 0; k < 64; k++) tryPh((k / 64) * P);
  const ph0 = best.ph;
  for (let d = -P / 64; d <= P / 64; d += P / 640) tryPh(ph0 + d);
  return { bpm, s: best.s, phase: a + best.ph };
}
function findTempo(on, a, b) {
  const list = [];
  for (let bpm = 70; bpm <= 190; bpm += 0.05) list.push(gridScore(on, bpm, a, b));
  list.sort((p, q) => q.s - p.s);
  const top = [];
  for (const r of list) if (top.every((q) => Math.abs(q.bpm - r.bpm) > 1.5)) { top.push(r); if (top.length === 4) break; }
  let best = top[0];
  for (let bpm = best.bpm - 0.6; bpm <= best.bpm + 0.6; bpm += 0.01) {
    const r = gridScore(on, bpm, a, b);
    if (r.s > best.s) best = r;
  }
  return { best, top };
}

function main() {
  if (!src) die('Thiếu file âm thanh. Cách dùng: node tools/make-chart.mjs "D:\\nhac\\bai.webm" ten-bai [--bpm 100] [--anchor 1.375]');
  const id = slug(idArg || '') || die('Thiếu tên bài (vd style): node tools/make-chart.mjs "<file>" style');
  console.log('• Đọc âm thanh: ' + src);
  const A = analyze(readAudio(src));
  if (A.dur < 20) die('File quá ngắn (' + A.dur.toFixed(1) + ' giây).');

  // khoảng có tiếng (bỏ im lặng hẳn ở đầu / cuối) để đo nhịp
  const quiet = pct(A.rms, 0.5) * 0.35;
  let t0 = 0, t1 = A.dur;
  for (let f = 0; f < A.frames; f++) if (A.rms[f] > quiet) { t0 = f / FPS; break; }
  for (let f = A.frames - 1; f >= 0; f--) if (A.rms[f] > quiet) { t1 = f / FPS; break; }

  let bpm = Number(flag('bpm')), anchor = Number(flag('anchor'));
  if (!(bpm >= 40 && bpm <= 240)) {
    const { best, top } = findTempo(A.on, t0, t1);
    const mean = A.on.reduce((s, v) => s + v, 0) / A.frames;
    console.log('• Đo nhịp (điểm càng cao càng khớp):');
    for (const r of top) console.log(`    ${r.bpm.toFixed(2)} BPM   điểm ${(r.s / mean).toFixed(2)}`);
    bpm = Math.round(best.bpm * 100) / 100;
    if (Math.abs(bpm - Math.round(bpm)) < 0.03) bpm = Math.round(bpm);   // bản phối thu sẵn thường đúng số tròn
    if (!(Number.isFinite(anchor))) anchor = gridScore(A.on, bpm, t0, t1).phase;
    console.log(`  → ${bpm} BPM  (sai thì chạy lại với --bpm <số đúng>)`);
  } else if (!Number.isFinite(anchor)) {
    anchor = gridScore(A.on, bpm, t0, t1).phase;
  }
  const P = 60 / bpm;
  // mốc phách = phách đầu tiên từ lúc có tiếng
  while (anchor - P >= t0 - 0.05) anchor -= P;
  while (anchor < t0 - 0.05) anchor += P;
  anchor = Math.round(anchor * 1000) / 1000;
  console.log(`• Mốc phách (phách số 0): giây ${anchor.toFixed(3)}`);

  /* ---- đoạn có nhạc theo phách: mỗi phách tính độ "khớp lưới" (nhấn đúng phách / nhấn trung bình) và độ to ---- */
  const nBeats = Math.floor((t1 - anchor) / P);
  const beatFit = [], beatRms = [];
  for (let i = 0; i < nBeats; i++) {
    const a = anchor + i * P;
    let s = 0, r = 0, n = 0;
    for (let f = Math.floor(a * FPS); f < Math.floor((a + P) * FPS) && f < A.frames; f++) { s += A.S[f]; r += A.rms[f]; n++; }
    beatFit.push(peak(A.S, a) / Math.max(1e-6, s / Math.max(1, n)));
    beatRms.push(r / Math.max(1, n));
  }
  const smooth = (arr, w) => arr.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(arr.length - 1, i + w); k++) { s += arr[k]; n++; }
    return s / n;
  });
  const fitS = smooth(beatFit, 4), rmsS = smooth(beatRms, 4);
  const midRms = pct(beatRms.slice(Math.floor(nBeats * 0.2), Math.floor(nBeats * 0.8)), 0.5);
  const fitRef = pct(fitS.slice(Math.floor(nBeats * 0.2), Math.floor(nBeats * 0.8)), 0.5);
  const isMusic = (i) => fitS[i] > fitRef * 0.6 && rmsS[i] > midRms * 0.3;
  let first = 0, last = nBeats - 1;
  while (first < nBeats && !isMusic(first)) first++;
  while (last > first && !isMusic(last)) last--;
  if (last - first < 16) die('Không tìm thấy đoạn nhạc đủ dài theo nhịp ' + bpm + ' BPM. Thử ghi --bpm đúng.');
  console.log(`• Có nhạc từ phách ${first} (giây ${(anchor + first * P).toFixed(1)}) đến phách ${last} (giây ${(anchor + last * P).toFixed(1)}) — ${last - first + 1} phách`);

  /* ---- ô lưới 1/4 phách: độ nhấn tương đối so với vùng xung quanh, độ to của ô nhịp (4 phách) ---- */
  const s0 = first * 4, s1 = last * 4 + 3;
  const slots = [];
  for (let s = s0; s <= s1; s++) {
    const t = anchor + s * P / 4;
    slots.push({ s, v: peak(A.S, t), low: peak(A.low, t) });
  }
  slots.forEach((o, i) => {
    const w = slots.slice(Math.max(0, i - 32), i + 33).map((q) => q.v);
    o.r = o.v / Math.max(1e-6, pct(w, 0.75));
  });
  const barLoud = {};
  for (let i = first; i <= last; i++) { const bar = Math.floor(i / 4); (barLoud[bar] ||= []).push(beatRms[i]); }
  const barVals = Object.values(barLoud).map((a) => a.reduce((s, v) => s + v, 0) / a.length);
  const rank = (v) => barVals.filter((u) => u <= v).length / barVals.length;   // 0..1: ô nhịp này to cỡ nào trong bài
  for (const o of slots) {
    const bar = Math.floor(o.s / 16);
    const loud = rank(barLoud[bar].reduce((s, v) => s + v, 0) / barLoud[bar].length);
    const pw = o.s % 4 === 0 ? 1 : o.s % 2 === 0 ? 0.72 : 0.5;           // trên phách > nửa phách > 1/4 phách
    o.m = 0.65 + 0.7 * loud;
    o.w = o.r * pw * o.m;
  }

  /* ---- chọn nốt cho từng mức ---- */
  const beats = last - first + 1;
  const out = {};
  for (const [name, L] of Object.entries(LEVELS)) {
    const cand = slots.filter((o) => o.s % L.step === 0);
    const taken = new Set();
    const free = (s) => { for (let d = -(L.minGap - 1); d <= L.minGap - 1; d++) if (taken.has(s + d)) return false; return true; };
    const target = Math.round(L.density * beats);
    for (const o of [...cand].sort((a, b) => b.w - a.w)) {
      if (taken.size >= target) break;
      if (o.r * (o.s % 4 === 0 ? 1 : 0.85) < L.floor) continue;
      if (free(o.s)) taken.add(o.s);
    }
    // lấp khoảng trống quá dài (vẫn phải là chỗ có nhấn, dù nhẹ)
    for (let pass = 0; pass < 8; pass++) {
      const list = [s0 - L.maxGap, ...[...taken].sort((a, b) => a - b), s1 + 1];
      let added = 0;
      for (let k = 0; k + 1 < list.length; k++) {
        if (list[k + 1] - list[k] <= L.maxGap) continue;
        const inGap = cand.filter((o) => o.s > list[k] && o.s < list[k + 1] && free(o.s) && o.r >= L.floor * 0.6);
        if (!inGap.length) continue;
        const mid = (list[k] + list[k + 1]) / 2;
        inGap.sort((a, b) => (b.w - Math.abs(b.s - mid) * 0.01) - (a.w - Math.abs(a.s - mid) * 0.01));
        taken.add(inGap[0].s);
        added++;
      }
      if (!added) break;
    }
    // nốt to: trên phách, nhấn trầm mạnh nhất, cách nhau ít nhất 2 phách
    const notes = [...taken].sort((a, b) => a - b);
    const bySlot = new Map(slots.map((o) => [o.s, o]));
    const bigWant = Math.round(notes.length * L.big);
    const big = new Set();
    for (const s of notes.filter((q) => q % 4 === 0).sort((a, b) => bySlot.get(b).low * bySlot.get(b).m - bySlot.get(a).low * bySlot.get(a).m)) {
      if (big.size >= bigWant) break;
      if ([...big].every((q) => Math.abs(q - s) >= 8)) big.add(s);
    }
    out[name] = notes.map((s) => [s / 4, big.has(s) ? 1 : 0]);
    const gaps = notes.slice(1).map((s, i) => (s - notes[i]) / 4);
    console.log(`• ${name.padEnd(6)} ${String(notes.length).padStart(4)} nốt (${big.size} nốt to) · ${(notes.length / beats).toFixed(2)} nốt/phách · ` +
      `${(notes.length / ((beats * P) / 60)).toFixed(0)} nốt/phút · trống dài nhất ${Math.max(...gaps).toFixed(2)} phách`);
  }

  /* ---- ghi file ---- */
  const dir = join(ROOT, 'cheer', 'charts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, id + '.json');
  const line = (arr) => '[' + arr.map(([b, k]) => '[' + b + ',' + k + ']').join(',') + ']';
  const json = '{\n' +
    '  "v": 1,\n' +
    '  "song": ' + JSON.stringify(id) + ',\n' +
    '  "bpm": ' + bpm + ',\n' +
    '  "note": "Nốt tính theo số phách từ mốc phách (anchor) của từng video. [phách, 1 = nốt to]. Tạo bằng tools/make-chart.mjs",\n' +
    '  "end": ' + (last + 1) + ',\n' +
    Object.keys(LEVELS).map((k) => '  "' + k + '": ' + line(out[k])).join(',\n') + '\n}\n';
  writeFileSync(file, json);
  console.log('\n✓ Đã ghi ' + file.replace(ROOT, '.').replace(/\\/g, '/'));
  console.log('\nDán vào bài trong cheer/songs.js:');
  console.log(`      bpm: ${bpm},\n      chart: '${id}.json',`);
  console.log('và trong video tương ứng (giây có phách số 0 trong video này):');
  console.log(`      anchor: ${anchor},`);
}

try { main(); } catch (e) { console.error('\n✗ ' + e.message + '\n'); process.exitCode = 1; }
