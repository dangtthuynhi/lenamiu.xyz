#!/usr/bin/env node
/* Tạo (hoặc lấy lại) tài khoản NGƯỜI DUYỆT cho trang Fanfic.
   Dùng khi chưa có người duyệt nào, hoặc người duyệt quên mật khẩu.
   (Trang không cho tự đăng ký. Người duyệt tạo tài khoản cho người khác ở Duyệt truyện → Thành viên.)

   Chạy ở thư mục lenamiu.xyz:
     node tools/tao-nguoi-duyet.mjs ten_dang_nhap "Bút danh"
     node tools/tao-nguoi-duyet.mjs ten_dang_nhap "Bút danh" --local     ← thử trong máy

   Lệnh tạo một mật khẩu tạm ngẫu nhiên và in ra màn hình. Đăng nhập xong vào mục "Tài khoản" để đổi mật khẩu ngay.
   Tài khoản đã có thì được đặt lại mật khẩu tạm + nâng lên người duyệt + mở khoá + đăng xuất khỏi mọi máy.
*/
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const local = args.includes('--local');
const [username = '', name = ''] = args.filter((a) => !a.startsWith('--'));
if (!/^[a-z0-9_]{3,20}$/.test(username)) {
  console.error('Tên đăng nhập cần 3–20 ký tự: chữ thường không dấu, số, dấu _.\nVí dụ: node tools/tao-nguoi-duyet.mjs nhi "Nhi"');
  process.exit(1);
}
const pen = name.trim() || username;
if (pen.length < 2 || pen.length > 40) { console.error('Bút danh cần 2–40 ký tự.'); process.exit(1); }

// Giống hệt cách trang web băm mật khẩu: trình duyệt PBKDF2 (150.000 vòng), máy chủ băm thêm có muối
const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
const temp = [...randomBytes(12)].map((b) => abc[b % abc.length]).join('');
const client = pbkdf2Sync(temp.normalize('NFC'), 'lenamiu-fic:' + username, 150000, 32, 'sha256').toString('hex');
const salt = randomBytes(16).toString('hex');
const stored = salt + ':' + createHash('sha256').update(salt + ':' + client).digest('hex');
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = `INSERT INTO users (username, name, pass, role, created) VALUES (${q(username)}, ${q(pen)}, ${q(stored)}, 'admin', ${q(new Date().toISOString())})
  ON CONFLICT(username) DO UPDATE SET pass = excluded.pass, role = 'admin', banned = 0;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(username)});
`;

const dir = mkdtempSync(join(tmpdir(), 'lenamiu-admin-'));
const file = join(dir, 'admin.sql');
try {
  writeFileSync(file, sql);
  const cmd = 'npx --yes wrangler@4 d1 execute lenamiu-fic ' + (local ? '--local' : '--remote') + ' --file "' + file + '"';
  const r = spawnSync(cmd, { cwd: new URL('../worker-fic/', import.meta.url), stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: true });
  if (r.status !== 0) { console.error('\n✗ Không ghi được vào cơ sở dữ liệu' + (r.stdout ? ':\n' + r.stdout.slice(-800) : '.')); process.exit(1); }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('\n✓ Xong! Tài khoản người duyệt' + (local ? ' (trong máy)' : '') + ':');
console.log('    Tên đăng nhập: ' + username);
console.log('    Mật khẩu tạm:  ' + temp);
console.log('  Đăng nhập tại ' + (local ? 'http://localhost:8000/fanfic/#/dang-nhap' : 'https://lenamiu.xyz/fanfic/#/dang-nhap') +
            ' rồi vào "Tài khoản" để đổi mật khẩu ngay nhé.\n');
