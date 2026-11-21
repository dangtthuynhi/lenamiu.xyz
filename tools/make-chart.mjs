#!/usr/bin/env node
/* Soạn nốt cho trò chơi gõ nhịp ở Sảnh cổ vũ (cheer/) từ âm thanh của bài hát.

   Cách dùng (chạy ở thư mục lenamiu.xyz):
     node tools/make-chart.mjs "D:\nhac\style.webm" style
     node tools/make-chart.mjs "D:\nhac\style.webm" style --bpm 100 --anchor 1.375   ← đã biết nhịp / mốc phách
     node tools/make-chart.mjs "D:\nhac\style.webm" style --key Db                   ← ghi tay tông của bài (C, F#, Bb, Am, C#m…)
   (nhận mọi file ffmpeg đọc được: mp4, webm, m4a, mp3, wav...; cần cài ffmpeg như tools/up-video.mjs)

   Lệnh sẽ:
     1. Đọc âm thanh, tự đo nhịp (BPM) và mốc phách (giây của phách đầu tiên) nếu chưa ghi --bpm / --anchor.
     2. Tìm đoạn có nhạc theo phách (bỏ đoạn nói chuyện / vỗ tay ở đầu và cuối).
     3. Tìm những chỗ nhấn trong nhạc (trống, phách mạnh) và đặt nốt lên lưới phách cho 3 mức:
          easy   Dễ   chỉ trên phách, thưa
          normal Vừa  thêm nửa phách
          hard   Khó  thêm 1/4 phách, dày
        Đoạn to (điệp khúc) nhiều nốt hơn đoạn hát nhẹ. Vài phách mạnh nhất thành nốt to (gấp đôi điểm).
     4. Đo tông và hợp âm theo từng phách (tiếng gõ lightstick chơi nốt trong hợp âm đang vang, nên luôn hợp với bài),
        soạn câu hô fanchant "Lena · Miu · Lena · Miu" cho các đoạn sôi động (chant: [phách, tiếng hô] — sửa tay được).
     5. Ghi cheer/charts/<tên>.json, in sẵn các dòng để dán vào cheer/songs.js.
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

/* ---------- tông + hợp âm ----------
   Mỗi khung phân tích (8192 mẫu, bước 1024): chỉ lấy các đỉnh phổ nhô hẳn lên khỏi nền xung quanh (nốt nhạc thật; tiếng hò,
   tiếng vang khán đài trải đều nên bị bỏ), cộng vào 12 cao độ (chroma) của phách chứa khung đó, tách phần trầm (< 260 Hz) và giữa.
   Tông: tổng chroma cả bài so với khuôn Krumhansl–Kessler của 24 giọng.
   Hợp âm: mỗi phách chấm điểm các hợp âm ba thuận của tông (bỏ hợp âm giảm), rồi Viterbi chọn chuỗi hợp âm (phạt đổi hợp âm,
   phạt nhẹ ở đầu ô nhịp; đầu ô nhịp = vị trí phách hay đổi hợp âm nhất). */
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const keyName = (pc, minor) => NOTE_NAMES[pc] + (minor ? 'm' : '');
function parseKey(str) {
  const m = /^([A-Ga-g])([#b]?)(m?)$/.exec(String(str || '').trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  return { pc: (base + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12, minor: m[3] === 'm' };
}
function beatChroma(x, anchor, P, nBeats) {
  const K = 8192, H = 1024;
  const win = Float64Array.from({ length: K }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / K));
  const lo = Math.ceil(55 * K / SR), split = Math.round(260 * K / SR), hi = Math.floor(2200 * K / SR);
  const re = new Float64Array(K), im = new Float64Array(K), mag = new Float64Array(hi + 2);
  const bass = Array.from({ length: nBeats }, () => new Float64Array(12)), mid = Array.from({ length: nBeats }, () => new Float64Array(12));
  for (let s = 0; s + K <= x.length; s += H) {
    const bi = Math.floor(((s + K / 2) / SR - anchor) / P);
    if (bi < 0 || bi >= nBeats) continue;
    for (let i = 0; i < K; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= hi + 1; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let k = lo + 1; k <= hi; k++) {
      if (!(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1])) continue;
      let bg = 0, n = 0;
      for (let j = Math.max(lo, k - 30); j <= Math.min(hi, k + 30); j++) { bg += mag[j]; n++; }
      bg /= n;
      if (mag[k] < bg * 4) continue;                                   // không nhô hẳn lên: tiếng ồn, bỏ
      const a = mag[k - 1], b = mag[k], c = mag[k + 1], d = 0.5 * (a - c) / (a - 2 * b + c);   // vị trí đỉnh chính xác hơn
      const semi = Math.round(12 * Math.log2((k + d) * SR / K / 440)) + 9;
      (k < split ? bass : mid)[bi][((semi % 12) + 12) % 12] += Math.log1p(b / bg);
    }
  }
  return { bass, mid };
}
function findKey(C, first, last) {
  const chroma = new Float64Array(12);
  for (let i = first; i <= last; i++) for (let p = 0; p < 12; p++) chroma[p] += C.bass[i][p] + C.mid[i][p];
  const corr = (prof, rot) => {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += chroma[i]; mb += prof[i]; }
    ma /= 12; mb /= 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { const a = chroma[(i + rot) % 12] - ma, b = prof[i] - mb; n += a * b; da += a * a; db += b * b; }
    return n / Math.sqrt(da * db);
  };
  const all = [];
  for (let pc = 0; pc < 12; pc++) all.push({ key: keyName(pc, false), r: corr(KK_MAJOR, pc) }, { key: keyName(pc, true), r: corr(KK_MINOR, pc) });
  all.sort((a, b) => b.r - a.r);
  return { key: all[0].key, top: all.slice(0, 4) };
}
function findChords(C, first, last, keyStr) {
  const key = parseKey(keyStr);
  const scale = (key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((d) => (key.pc + d) % 12);
  const CH = [];
  for (let d = 0; d < 7; d++) {         // hợp âm ba trên từng bậc của thang, bỏ hợp âm giảm
    const r = scale[d], t3 = scale[(d + 2) % 7], t5 = scale[(d + 4) % 7];
    const i3 = (t3 - r + 12) % 12, i5 = (t5 - r + 12) % 12;
    if (i5 !== 7) continue;
    CH.push({ name: NOTE_NAMES[r] + (i3 === 3 ? 'm' : ''), tones: [r, t3, t5] });
  }
  const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return s > 0 ? Array.from(v, (x) => x / s) : Array.from(v); };
  const S = [];
  for (let i = first; i <= last; i++) {
    const m = norm(C.mid[i]), bs = norm(C.bass[i]);
    S.push(CH.map(({ tones: [r, t3, t5], tones }) => {
      let out = 0;
      for (let p = 0; p < 12; p++) if (!tones.includes(p)) out += m[p];
      return m[r] + 0.9 * m[t3] + 0.8 * m[t5] - 0.35 * out + 1.1 * bs[r] + 0.25 * (bs[t3] + bs[t5]);
    }));
  }
  const viterbi = (pen) => {
    const n = S.length, N = CH.length, back = [];
    let dp = S[0].slice();
    for (let i = 1; i < n; i++) {
      const nd = new Array(N), bk = new Array(N);
      for (let c = 0; c < N; c++) {
        let best = -1e9, arg = 0;
        for (let q = 0; q < N; q++) { const v = dp[q] - (q === c ? 0 : pen(i + first)); if (v > best) { best = v; arg = q; } }
        nd[c] = best + S[i][c]; bk[c] = arg;
      }
      back.push(bk); dp = nd;
    }
    let c = dp.indexOf(Math.max(...dp));
    const path = [c];
    for (let i = back.length - 1; i >= 0; i--) { c = back[i][c]; path.unshift(c); }
    return path;
  };
  const p1 = viterbi(() => 0.25), changes = [0, 0, 0, 0];
  for (let i = 1; i < p1.length; i++) if (p1[i] !== p1[i - 1]) changes[(i + first) % 4]++;
  const bar = changes.indexOf(Math.max(...changes));
  const path = viterbi((i) => { const q = ((i - bar) % 4 + 4) % 4; return q === 0 ? 0.12 : q === 2 ? 0.45 : 0.9; });
  const runs = [];
  path.forEach((c, i) => { if (!runs.length || runs[runs.length - 1][1] !== CH[c].name) runs.push([i + first, CH[c].name]); });
  let rootBass = 0;
  path.forEach((c, i) => { const bs = Array.from(C.bass[i + first]); if (bs.indexOf(Math.max(...bs)) === CH[c].tones[0]) rootBass++; });
  return { bar, runs, rootBass: rootBass / path.length };
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
  const X = readAudio(src);
  const A = analyze(X);
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

  /* ---- tông + hợp âm (cho giai điệu tiếng gõ lightstick) ---- */
  const C = beatChroma(X, anchor, P, nBeats);
  let key = flag('key');
  if (key != null && !parseKey(key)) die('--key không đúng dạng (vd C, F#, Bb, Am, C#m): ' + key);
  if (key == null) {
    const K = findKey(C, first, last);
    key = K.key;
    console.log('• Tông của bài (điểm càng gần 1 càng chắc): ' + K.top.map((k) => k.key + ' ' + k.r.toFixed(2)).join(' · '));
  } else { const k = parseKey(key); key = keyName(k.pc, k.minor); console.log('• Tông của bài: ' + key); }
  const CHD = findChords(C, first, last, key);
  console.log(`• Hợp âm: ${CHD.runs.length} lần đổi, đầu ô nhịp ở phách ≡ ${CHD.bar} (mod 4), nốt trầm khớp chủ âm ${Math.round(CHD.rootBass * 100)}% số phách`);
  const barLine = [];
  for (let b = CHD.bar + Math.ceil((first - CHD.bar) / 4) * 4, n = 0; b <= last && n < 16; b += 4, n++) {
    let name = ''; for (const [s0, c] of CHD.runs) if (s0 <= b) name = c;
    barLine.push(name);
  }
  console.log('    16 ô nhịp đầu: ' + barLine.join(' '));

  /* ---- fanchant: câu hô "Lena · Miu · Lena · Miu" (mỗi tên một phách) ở nửa sau mỗi câu 8 phách của các đoạn sôi động (to nhất bài,
     kéo dài ít nhất 2 câu liền — thường là điệp khúc). Trang hiện câu hô như karaoke trên video. Sửa tay được trong file nốt. ---- */
  const CHANT = [[4, 'Lena'], [5, 'Miu'], [6, 'Lena'], [7, 'Miu']];
  const phrases = [];
  for (let p0 = CHD.bar + Math.ceil((first + 16 - CHD.bar) / 8) * 8; p0 + 8 <= last; p0 += 8) {
    let r = 0;
    for (let i = p0; i < p0 + 8; i++) r += beatRms[i];
    phrases.push({ p0, r: r / 8 });
  }
  const loudCut = pct(phrases.map((x) => x.r), 0.65), loud = phrases.map((x) => x.r >= loudCut);
  const chant = [];
  phrases.forEach((x, k) => { if (loud[k] && (loud[k - 1] || loud[k + 1])) CHANT.forEach(([o, syl]) => chant.push([x.p0 + o, syl])); });
  console.log(`• Fanchant: ${chant.length / CHANT.length} câu hô (trong ${phrases.length} câu nhạc)`);

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
    '  "key": ' + JSON.stringify(key) + ',\n' +
    '  "bar": ' + CHD.bar + ',\n' +
    '  "chords": ' + JSON.stringify(CHD.runs) + ',\n' +
    '  "chant": ' + JSON.stringify(chant) + ',\n' +
    '  "note": "Nốt tính theo số phách từ mốc phách (anchor) của từng video. [phách, 1 = nốt to]. chords: [phách bắt đầu, hợp âm]; bar: phách đầu ô nhịp (mod 4). Tạo bằng tools/make-chart.mjs",\n' +
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
