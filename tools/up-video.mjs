#!/usr/bin/env node
/* Up video lên kho R2 cho trang LenaMiu Sub.

   Cách dùng (chạy ở thư mục lenamiu.xyz):
     node tools/up-video.mjs "D:\video\Pls Love EP2 vietsub.mp4"
     node tools/up-video.mjs "D:\video\abc.mp4" pls-love-ep2        ← tự đặt tên file trên kho
     node tools/up-video.mjs "D:\video\abc.mp4" pls-love-ep2 --nen  ← nén nhẹ lại (720p) cho người xem bằng 4G đỡ giật

   Lệnh sẽ:
     1. Đọc thông tin video (ffprobe). Không phải H.264 + AAC (iPhone kén) thì tự chuyển.
     2. Dời phần mục lục của file lên đầu (faststart) để bấm là phát ngay, khỏi chờ tải hết.
     3. Chụp 1 khung hình làm ảnh bìa (.jpg cùng tên).
     4. Tải video + ảnh bìa lên kho R2 qua máy chủ lenamiu-video, từng phần 50 MB
        (video lớn bao nhiêu cũng được, phần nào lỗi mạng thì tự gửi lại phần đó).
     5. In sẵn dòng để dán vào videos.js.
   Video gốc trong máy không bị sửa.

   Mã bí mật để tải lên nằm ở file %USERPROFILE%\.lenamiu\upload.json (ngoài thư mục web,
   không bao giờ bị đưa lên GitHub): { "url": "https://lenamiu-video....workers.dev", "secret": "..." }
*/
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const PART = 50 * 1024 * 1024;          // mỗi phần 50 MB (Worker gói miễn phí nhận tối đa 100 MB mỗi lần)
const CONFIG = join(homedir(), '.lenamiu', 'upload.json');

const args = process.argv.slice(2);
const compress = args.includes('--nen');
const local = args.includes('--local');  // (để thử) tải vào máy chủ chạy trong máy: npx wrangler dev --port 8788
const [src, nameArg] = args.filter((a) => !a.startsWith('--'));

// Báo lỗi bằng cách ném ra (không thoát ngay) để khối finally còn dọn file tạm
function die(msg) { throw new Error(msg); }
function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }
function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function run(cmd, list, opts = {}) {
  const r = spawnSync(cmd, list, { stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', ...opts });
  if (r.error) die('Không chạy được ' + cmd + ': ' + r.error.message);
  if (r.status !== 0) die(cmd + ' báo lỗi' + (opts.capture ? ':\n' + (r.stderr || '').slice(-1500) : ''));
  return r.stdout;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  if (local) {
    const vars = new URL('../worker-video/.dev.vars', import.meta.url);
    const m = existsSync(vars) && readFileSync(vars, 'utf8').match(/^UPLOAD_SECRET=(.+)$/m);
    if (!m) die('Thiếu UPLOAD_SECRET trong worker-video/.dev.vars để thử trong máy.');
    return { url: 'http://127.0.0.1:8788', secret: m[1].trim() };
  }
  if (!existsSync(CONFIG)) die('Chưa có file cấu hình ' + CONFIG + ' (chứa địa chỉ máy chủ + mã bí mật tải lên).');
  const c = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (!c.url || !c.secret) die('File ' + CONFIG + ' thiếu "url" hoặc "secret".');
  return { url: String(c.url).replace(/\/+$/, ''), secret: String(c.secret) };
}

async function api(cfg, path, opts = {}) {
  const r = await fetch(cfg.url + path, { ...opts, headers: { Authorization: 'Bearer ' + cfg.secret, ...(opts.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(r.status + ' ' + t.slice(0, 300));
  return JSON.parse(t);
}

async function upload(cfg, file, key, type) {
  const size = statSync(file).size;
  const q = (extra) => '?key=' + encodeURIComponent(key) + extra;
  const { uploadId } = await api(cfg, '/_upload/start' + q('&type=' + encodeURIComponent(type)), { method: 'POST' });
  const withId = (extra = '') => q('&uploadId=' + encodeURIComponent(uploadId) + extra);
  const fd = openSync(file, 'r');
  const parts = [];
  try {
    for (let n = 1, off = 0; off < size; n++, off += PART) {
      const len = Math.min(PART, size - off);
      const buf = Buffer.allocUnsafe(len);
      readSync(fd, buf, 0, len, off);
      for (let tries = 1; ; tries++) {
        try {
          const p = await api(cfg, '/_upload/part' + withId('&n=' + n), { method: 'PUT', body: buf });
          parts.push({ partNumber: p.partNumber, etag: p.etag });
          break;
        } catch (e) {
          if (tries >= 4) throw e;
          process.stdout.write('\n    (mạng chập chờn, gửi lại phần ' + n + '…)');
          await sleep(3000 * tries);
        }
      }
      process.stdout.write('\r    ' + key + ': ' + Math.round(((off + len) / size) * 100) + '% (' + mb(off + len) + ' / ' + mb(size) + ')   ');
    }
    const done = await api(cfg, '/_upload/complete' + withId(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts })
    });
    process.stdout.write('\n');
    if (done.size !== size) throw new Error('kích thước trên kho (' + done.size + ') khác file gửi lên (' + size + ')');
  } catch (e) {
    await api(cfg, '/_upload/abort' + withId(), { method: 'POST' }).catch(() => {});
    die('Tải lên thất bại (' + key + '): ' + e.message);
  } finally {
    closeSync(fd);
  }
}

async function main() {
if (!src) die('Thiếu đường dẫn video. Ví dụ: node tools/up-video.mjs "D:\\video\\tap1.mp4"');
if (!existsSync(src)) die('Không thấy file: ' + src);
const key = slug(nameArg || basename(src, extname(src)));
if (!key) die('Tên file không hợp lệ, hãy tự đặt tên: node tools/up-video.mjs "' + src + '" ten-video');
const cfg = loadConfig();

// 1. Đọc thông tin video
const info = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src], { capture: true }));
const v = info.streams.find((s) => s.codec_type === 'video');
const a = info.streams.find((s) => s.codec_type === 'audio');
if (!v) die('File này không có hình (video).');
const duration = Number(info.format.duration) || 0;
const kbps = Math.round((Number(info.format.bit_rate) || 0) / 1000);
const okCodec = v.codec_name === 'h264' && (v.pix_fmt === 'yuv420p' || v.pix_fmt === 'yuvj420p') && (!a || a.codec_name === 'aac');
console.log('\n▶ ' + basename(src));
console.log('  ' + v.width + 'x' + v.height + ', ' + v.codec_name + '/' + (a ? a.codec_name : 'không tiếng') +
            ', ' + Math.floor(duration / 60) + ':' + String(Math.round(duration % 60)).padStart(2, '0') +
            ', ' + mb(statSync(src).size) + (kbps ? ', ' + (kbps / 1000).toFixed(1) + ' Mbps' : ''));
if (!compress && kbps > 6000) {
  console.log('  (Video khá nặng: ' + (kbps / 1000).toFixed(1) + ' Mbps. Người xem bằng 4G yếu có thể bị giật;' +
              ' muốn nhẹ hơn thì chạy lại kèm --nen)');
}

const work = mkdtempSync(join(tmpdir(), 'lenamiu-up-'));
const outVideo = join(work, key + '.mp4');
const outThumb = join(work, key + '.jpg');
try {
  // 2. Chuẩn hoá video: chỉ đóng gói lại (nhanh, giữ nguyên chất lượng) nếu đã đúng chuẩn
  const reencode = compress || !okCodec;
  const vArgs = reencode
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', compress ? '24' : '21', '-pix_fmt', 'yuv420p',
       ...(compress ? ['-maxrate', '3500k', '-bufsize', '7000k'] : []),
       ...(compress && v.height > 720 ? ['-vf', 'scale=-2:720'] : []),
       '-c:a', 'aac', '-b:a', '128k', '-ac', '2']
    : ['-c', 'copy'];
  console.log(reencode ? (compress ? '  → Nén lại (720p, tối đa 3,5 Mbps)… có thể mất một lúc' : '  → Chuyển sang H.264/AAC cho iPhone xem được… có thể mất một lúc')
                       : '  → Đóng gói lại để phát ngay (không giảm chất lượng)…');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stats', '-y', '-i', src, '-map', '0:v:0', ...(a ? ['-map', '0:a:0'] : []),
                 ...vArgs, '-movflags', '+faststart', outVideo]);

  // 3. Ảnh bìa: lấy khung hình ở khoảng 15% thời lượng (tránh màn hình đen lúc mở đầu)
  const at = Math.max(1, Math.min(duration * 0.15, 60)).toFixed(1);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', outVideo, '-frames:v', '1',
                 '-vf', 'scale=1280:-2', '-q:v', '3', outThumb]);

  // 4. Tải lên R2
  console.log('  → Tải lên kho R2 (' + mb(statSync(outVideo).size) + ')' + (local ? ' [thử trong máy]' : '') + '…');
  await upload(cfg, outThumb, key + '.jpg', 'image/jpeg');
  await upload(cfg, outVideo, key + '.mp4', 'video/mp4');

  // 5. Dòng để dán vào videos.js
  console.log('\n✓ Xong! Thêm dòng này vào khối của video trong videos.js:\n');
  console.log("      video: '" + key + ".mp4',\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exitCode = 1; });
