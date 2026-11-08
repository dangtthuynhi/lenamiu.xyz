#!/usr/bin/env node
/* Up video lên kho R2 cho trang LenaMiu Vietsub.

   Cách dùng (chạy ở thư mục lenamiu.xyz):
     node tools/up-video.mjs "D:\video\Pls Love EP2 vietsub.mp4"
     node tools/up-video.mjs "D:\video\abc.mp4" pls-love-ep2        ← tự đặt tên file trên kho
     node tools/up-video.mjs "D:\video\abc.mp4" pls-love-ep2 --nen  ← nén nhỏ lại (video quá 290 MB)

   Lệnh sẽ:
     1. Đọc thông tin video (ffprobe). Không phải H.264 + AAC (iPhone kén) thì tự chuyển.
     2. Dời phần mục lục của file lên đầu (faststart) để bấm là phát ngay, khỏi chờ tải hết.
     3. Chụp 1 khung hình làm ảnh bìa (.jpg cùng tên).
     4. Tải video + ảnh bìa lên kho R2 "lenamiu-videos" (cần đăng nhập: npx wrangler login).
     5. In sẵn dòng để dán vào videos.js.
   Video gốc trong máy không bị sửa.
*/
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const BUCKET = 'lenamiu-videos';
const LIMIT = 290 * 1024 * 1024;   // wrangler chỉ tải được file tới ~300 MB mỗi lần

const args = process.argv.slice(2);
const compress = args.includes('--nen');
const local = args.includes('--local');          // (để thử) tải vào kho giả lập trong máy, dùng với npx wrangler dev
const [src, nameArg] = args.filter((a) => !a.startsWith('--'));
const WORKER_DIR = new URL('../worker-video/', import.meta.url);

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }
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
// npx là file .cmd trên Windows → phải chạy qua shell, nên tự bọc ngoặc kép cho từng tham số
function npx(list) {
  const q = (s) => (/[\s"&|<>^]/.test(s) ? '"' + String(s).replace(/"/g, '\\"') + '"' : s);
  const r = spawnSync('npx --yes wrangler@4 ' + list.map(q).join(' '),
                      { stdio: 'inherit', shell: true, cwd: WORKER_DIR });
  if (r.status !== 0) die('wrangler báo lỗi khi tải lên (đã bật R2 và đăng nhập Cloudflare chưa? thử: npx wrangler login)');
}

if (!src) die('Thiếu đường dẫn video. Ví dụ: node tools/up-video.mjs "D:\\video\\tap1.mp4"');
if (!existsSync(src)) die('Không thấy file: ' + src);
const key = slug(nameArg || basename(src, extname(src)));
if (!key) die('Tên file không hợp lệ, hãy tự đặt tên: node tools/up-video.mjs "' + src + '" ten-video');

// 1. Đọc thông tin video
const info = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src], { capture: true }));
const v = info.streams.find((s) => s.codec_type === 'video');
const a = info.streams.find((s) => s.codec_type === 'audio');
if (!v) die('File này không có hình (video).');
const duration = Number(info.format.duration) || 0;
const okCodec = v.codec_name === 'h264' && (v.pix_fmt === 'yuv420p' || v.pix_fmt === 'yuvj420p') && (!a || a.codec_name === 'aac');
console.log('\n▶ ' + basename(src));
console.log('  ' + v.width + 'x' + v.height + ', ' + v.codec_name + '/' + (a ? a.codec_name : 'không tiếng') +
            ', ' + Math.floor(duration / 60) + ':' + String(Math.round(duration % 60)).padStart(2, '0') +
            ', ' + mb(statSync(src).size));

const work = mkdtempSync(join(tmpdir(), 'lenamiu-up-'));
const outVideo = join(work, key + '.mp4');
const outThumb = join(work, key + '.jpg');
try {
  // 2. Chuẩn hoá video: chỉ đóng gói lại (nhanh, giữ nguyên chất lượng) nếu đã đúng chuẩn
  const reencode = compress || !okCodec;
  const vArgs = reencode
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', compress ? '26' : '21', '-pix_fmt', 'yuv420p',
       ...(compress && v.height > 720 ? ['-vf', 'scale=-2:720'] : []),
       '-c:a', 'aac', '-b:a', '128k', '-ac', '2']
    : ['-c', 'copy'];
  console.log(reencode ? (compress ? '  → Nén lại (720p)… có thể mất vài phút' : '  → Chuyển sang H.264/AAC cho iPhone xem được… có thể mất vài phút')
                       : '  → Đóng gói lại để phát ngay (không giảm chất lượng)…');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stats', '-y', '-i', src, '-map', '0:v:0', ...(a ? ['-map', '0:a:0'] : []),
                 ...vArgs, '-movflags', '+faststart', outVideo]);
  const size = statSync(outVideo).size;
  if (size > LIMIT) {
    die('Video sau xử lý nặng ' + mb(size) + ', quá giới hạn 290 MB mỗi lần tải lên.\n' +
        '  Chạy lại kèm --nen để nén nhỏ:  node tools/up-video.mjs "' + src + '" ' + key + ' --nen');
  }

  // 3. Ảnh bìa: lấy khung hình ở khoảng 15% thời lượng (tránh màn hình đen lúc mở đầu)
  const at = Math.max(1, Math.min(duration * 0.15, 60)).toFixed(1);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', outVideo, '-frames:v', '1',
                 '-vf', 'scale=1280:-2', '-q:v', '3', outThumb]);

  // 4. Tải lên R2
  console.log('  → Tải lên kho R2 (' + mb(size) + ')…');
  const where = local ? '--local' : '--remote';
  npx(['r2', 'object', 'put', BUCKET + '/' + key + '.mp4', '--file', outVideo, '--content-type', 'video/mp4', where]);
  npx(['r2', 'object', 'put', BUCKET + '/' + key + '.jpg', '--file', outThumb, '--content-type', 'image/jpeg', where]);

  // 5. Dòng để dán vào videos.js
  console.log('\n✓ Xong! Thêm dòng này vào khối của video trong videos.js:\n');
  console.log("      video: '" + key + ".mp4',\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
