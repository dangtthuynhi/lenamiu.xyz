#!/usr/bin/env node
/* Đổi file phụ đề (.ass của Aegisub, .srt, .vtt) sang .vtt cho trình phát trên web, cất vào thư mục subs/.

   Cách dùng (chạy ở thư mục lenamiu.xyz):
     node tools/sub-to-vtt.mjs <id-video> vi="D:\sub\tap1.vi.ass" en="D:\sub\tap1.en.srt" th="D:\sub\tap1.th.ass"

     <id-video>  đúng ô id của video trong videos.js (vd eat-trip-ship) — dùng để đặt tên file
     vi= en= th= zh= id=   mỗi thứ tiếng một file (có bao nhiêu thì ghi bấy nhiêu)

   Lệnh sẽ:
     1. Đọc từng file (UTF-8 hoặc UTF-16 đều được).
     2. Giữ chữ nghiêng / đậm / gạch chân, xuống dòng; câu đặt trên đầu màn hình (\an8, \pos ở nửa trên) thì vẫn ở trên.
        Bỏ hình vẽ (\p1), dòng ghi chú (Comment), dòng trùng lặp do làm viền nhiều lớp. Màu, font, karaoke thì bỏ.
     3. Ghi ra subs/<id-video>.<mã-tiếng>.vtt và in sẵn dòng subs: { ... } để dán vào khối của video trong videos.js.

   QUAN TRỌNG: video dùng sub rời phải là bản RAW (không dính sub), không thì sub hiện chồng lên chữ đã in trong hình.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'subs');
const LANGS = ['vi', 'en', 'th', 'zh', 'id'];
// Ký tự đặc biệt tạo bằng mã số (khỏi lẫn ký tự vô hình vào file)
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const MARK_OPEN = String.fromCharCode(1), MARK_CLOSE = String.fromCharCode(2);

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

/* ---------- đọc file: UTF-8 / UTF-16, bỏ BOM ---------- */
function readText(file) {
  const b = readFileSync(file);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) {                       // UTF-16 BE: đảo byte rồi đọc
    const s = Buffer.from(b.subarray(2));
    for (let i = 0; i + 1 < s.length; i += 2) { const x = s[i]; s[i] = s[i + 1]; s[i + 1] = x; }
    return s.toString('utf16le');
  }
  const t = b.toString('utf8');
  return t.startsWith(BOM) ? t.slice(1) : t;
}

/* ---------- thời gian ---------- */
const pad = (n, w = 2) => String(n).padStart(w, '0');
function fmtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return pad(h) + ':' + pad(m) + ':' + pad(s) + '.' + pad(ms % 1000, 3);
}
// ASS: 0:01:02.35 (phần trăm giây) · SRT: 00:01:02,350 · VTT: 00:01:02.350 hoặc 01:02.350
function parseTime(s) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*$/.exec(String(s));
  if (!m) return NaN;
  const frac = m[4].length === 1 ? +m[4] * 100 : m[4].length === 2 ? +m[4] * 10 : +m[4];
  return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + frac;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// dọn: thẻ rỗng, khoảng trắng thừa, dòng trống
function tidy(out) {
  return out.replace(/<(i|b|u)><\/\1>/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}
const hasText = (s) => !!s.replace(/<\/?[ibu]>/g, '').trim();

/* ---------- .ass / .ssa ---------- */
function fromAss(text) {
  let section = '', format = null, playResY = 288;
  const cues = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { section = line.toLowerCase(); continue; }
    if (section === '[script info]') {
      const m = /^PlayResY\s*:\s*(\d+)/i.exec(line);
      if (m) playResY = +m[1] || playResY;
      continue;
    }
    if (section !== '[events]') continue;
    if (/^Format\s*:/i.test(line)) { format = line.replace(/^Format\s*:/i, '').split(',').map((x) => x.trim().toLowerCase()); continue; }
    if (!/^Dialogue\s*:/i.test(line)) continue;                 // bỏ Comment:, Picture:...
    const f = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    // tách đúng số cột; cột cuối (chữ) giữ nguyên cả dấu phẩy bên trong
    let rest = line.replace(/^Dialogue\s*:\s*/i, '');
    const parts = [];
    for (let i = 0; i < f.length - 1; i++) {
      const k = rest.indexOf(',');
      if (k < 0) { parts.push(rest); rest = ''; continue; }
      parts.push(rest.slice(0, k));
      rest = rest.slice(k + 1);
    }
    parts.push(rest);
    const get = (k) => (f.indexOf(k) >= 0 ? parts[f.indexOf(k)] : '') || '';
    const start = parseTime(get('start')), end = parseTime(get('end'));
    if (!(end > start)) continue;
    const c = assLine(get('text'), playResY);
    if (c) cues.push({ start, end, text: c.text, top: c.top });
  }
  return cues;
}
// Một câu ASS → câu VTT. Bỏ hình vẽ (\p1). Câu ở nửa trên màn hình (\an7-9, \pos / \move có y nhỏ) thì để trên đầu.
function assLine(s, playResY) {
  if (/\{[^}]*\\p[1-9]/.test(s)) return null;
  let top = false;
  for (const block of s.matchAll(/\{([^}]*)\}/g)) {
    const tags = block[1];
    const an = /\\an([1-9])/.exec(tags);
    const a = /\\a(\d+)(?!\d)/.exec(tags);                      // kiểu đánh số cũ của SSA: 5–7, 9–11 là ở trên
    const pos = /\\(?:pos|move)\(\s*[-\d.]+\s*,\s*([-\d.]+)/.exec(tags);
    if ((an && +an[1] >= 7) || (a && /^(5|6|7|9|10|11)$/.test(a[1])) || (pos && +pos[1] < playResY * 0.4)) top = true;
  }
  // Đi lần lượt từng đoạn chữ / khối mã, giữ trạng thái nghiêng / đậm / gạch chân để thẻ luôn đóng mở đúng cặp:
  // {\i1} → <i>, {\b1} → <b>, {\u1} → <u>, {\r} → bỏ hết, \N → xuống dòng, \h → dấu cách không ngắt; mã khác bỏ.
  const st = { i: false, b: false, u: false };
  let out = '';
  const toggle = (k, on) => { if (on !== st[k]) { st[k] = on; out += on ? '<' + k + '>' : '</' + k + '>'; } };
  const closeAll = () => { toggle('u', false); toggle('b', false); toggle('i', false); };
  const plain = (t) => esc(t.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, NBSP));
  const re = /\{([^}]*)\}/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    out += plain(s.slice(last, m.index));
    last = re.lastIndex;
    for (const tm of m[1].matchAll(/\\([ibu])(\d*)(?![a-z])|\\r(?![a-z])/g)) {
      if (!tm[1]) { closeAll(); continue; }
      const v = tm[2];
      toggle(tm[1], tm[1] === 'b' ? v !== '' && v !== '0' && v !== '400' : v === '1');
    }
  }
  out += plain(s.slice(last));
  closeAll();
  out = tidy(out);
  return hasText(out) ? { text: out, top } : null;
}

/* ---------- .srt / .vtt ---------- */
function fromSrtOrVtt(text) {
  const cues = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;                                        // WEBVTT, NOTE, STYLE, số thứ tự...
    const [a, b] = lines[ti].split('-->');
    const settings = String(b || '').trim().split(/\s+/);
    const start = parseTime(a), end = parseTime(settings[0]);
    if (!(end > start)) continue;
    let body = lines.slice(ti + 1).join('\n');
    const top = /\{\\an[789]\}/.test(body) || settings.slice(1).some((x) => /^line:0(%|\.0+%?)?$/.test(x));
    body = body.replace(/\{\\[^}]*\}/g, '')                      // mã kiểu ASS lẫn trong SRT
      .replace(/<(\/?)([ibu])>/gi, MARK_OPEN + '$1$2' + MARK_CLOSE) // giữ thẻ i / b / u
      .replace(/<\/?[a-z][^>]*>/gi, '');                         // bỏ <font>, <script>... (chỉ bỏ thẻ, giữ chữ)
    body = esc(body).split(MARK_OPEN).map((part, i) => {
      if (!i) return part;
      const k = part.indexOf(MARK_CLOSE);
      return '<' + part.slice(0, k).toLowerCase() + '>' + part.slice(k + 1);
    }).join('');
    body = tidy(body);
    if (hasText(body)) cues.push({ start, end, text: body, top });
  }
  return cues;
}

function toVtt(cues) {
  cues.sort((x, y) => x.start - y.start || x.end - y.end);
  const seen = new Set();
  const out = ['WEBVTT', ''];
  let n = 0;
  for (const c of cues) {
    const key = c.start + '|' + c.end + '|' + c.text;
    if (seen.has(key)) continue;                                 // dòng trùng (viền / bóng làm bằng nhiều lớp)
    seen.add(key);
    out.push(fmtTime(c.start) + ' --> ' + fmtTime(c.end) + (c.top ? ' line:0' : ''), c.text, '');
    n++;
  }
  return { vtt: out.join('\n'), n };
}

/* ---------- chạy ---------- */
const args = process.argv.slice(2);
const id = args.find((a) => !a.includes('='));
const pairs = args.filter((a) => a.includes('=')).map((a) => {
  const k = a.indexOf('=');
  return [a.slice(0, k).trim().toLowerCase(), a.slice(k + 1).trim().replace(/^"(.*)"$/, '$1')];
});
if (!id || !pairs.length) die('Cách dùng: node tools/sub-to-vtt.mjs <id-video> vi="file.ass" en="file.srt" ...');
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) die('id video chỉ gồm chữ thường không dấu, số và dấu - (đúng ô id trong videos.js).');
for (const [lang, file] of pairs) {
  if (!LANGS.includes(lang)) die('Mã tiếng "' + lang + '" không có. Dùng: ' + LANGS.join(', '));
  if (!existsSync(file)) die('Không thấy file: ' + file);
}
mkdirSync(OUT_DIR, { recursive: true });
const made = {};
for (const [lang, file] of pairs) {
  const text = readText(file);
  const ext = extname(file).toLowerCase();
  const cues = ext === '.ass' || ext === '.ssa' || /^\s*\[Script Info\]/i.test(text) ? fromAss(text) : fromSrtOrVtt(text);
  const { vtt, n } = toVtt(cues);
  if (!n) die(file + ': không đọc được câu sub nào (file đúng là .ass / .srt / .vtt không?)');
  const name = id + '.' + lang + '.vtt';
  writeFileSync(join(OUT_DIR, name), vtt + '\n', 'utf8');
  made[lang] = name;
  console.log('✓ ' + lang + ': ' + n + ' câu → subs/' + name);
}
const order = LANGS.filter((l) => made[l]);
console.log('\nDán dòng này vào khối của video "' + id + '" trong videos.js (thay dòng subs cũ nếu có):\n');
console.log('      subs: { ' + order.map((l) => l + ": '" + made[l] + "'").join(', ') + ' },');
console.log('\nNhớ: ô video của khối đó phải là bản RAW (không dính sub).');
