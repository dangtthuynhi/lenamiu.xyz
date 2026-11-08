/* Máy chủ trang Fanfic LenaMiu (Cloudflare Workers + D1, gói miễn phí).

   Tài khoản   POST /auth/register  /auth/login  /auth/logout  /auth/password     GET|PUT /auth/me
   Đọc truyện  GET  /stories                 danh sách truyện đã đăng
               GET  /stories/:id             thông tin truyện + mục lục
               GET  /chapters/:id?u=         nội dung chương (u = mã người đọc, để biết đã thả tim chưa)
               POST /chapters/:id/heart      thả / bỏ tim               POST /read   đếm lượt đọc
               GET|POST /chapters/:id/comments   bình luận (khách chỉ cần tên + email, email không hiện công khai)
               DELETE /comments/:id
   Viết truyện /my/...                       truyện của tôi: tạo, sửa, thêm chương, gửi duyệt
   Duyệt       /admin/...                    hàng chờ duyệt, thành viên, ẩn / xoá truyện (chỉ người duyệt)

   Quy tắc duyệt:
     - Thành viên thường: truyện / chương mới và bản sửa của chương đã đăng phải chờ người duyệt.
       Trong lúc chờ, người đọc vẫn thấy bản cũ.
     - Thành viên "tin cậy" (người duyệt bật cho) và người duyệt: đăng / sửa là hiện luôn.

   Bí mật (đặt bằng `npx wrangler secret put ...`, không ghi vào file này):
     FIC_SALT          chuỗi ngẫu nhiên để băm IP (giới hạn spam theo mạng, không lưu IP thật)
     TURNSTILE_SECRET  khoá Turnstile chống tạo tài khoản ảo. Không đặt thì bỏ qua bước này (thử trong máy).
*/

const ORIGINS = ['https://lenamiu.xyz', 'https://www.lenamiu.xyz', 'https://dangtthuynhi.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SESSION_MS = 60 * 86400e3;           // đăng nhập một lần dùng được 60 ngày
const MAX = { title: 120, summary: 2000, body: 100000, comment: 1000, name: 40, note: 500, tag: 24, tags: 8 };
const RATINGS = ['all', '13', '16', '18'];
const PASS_RE = /^[a-f0-9]{64}$/;          // mật khẩu đã được trình duyệt băm thành 64 ký tự hex

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new HttpError(status, message); }

const enc = new TextEncoder();
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function randomHex(bytes) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
function sameString(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const nowIso = () => new Date().toISOString();
function vnDay(offsetDays = 0) { return new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10); }

// Làm sạch chữ người dùng gửi lên. Trả null nếu dài quá max (để báo lỗi rõ ràng thay vì cắt mất chữ).
// Ký tự ngắt dòng lạ, BOM, dấu cách không ngắt: tạo bằng mã số cho khỏi lẫn ký tự vô hình vào file
const ODD = new RegExp('[' + String.fromCharCode(0x2028, 0x2029, 0xfeff) + ']', 'g');
const NBSP = new RegExp(String.fromCharCode(0xa0), 'g');
function clean(v, max, multiline = false) {
  let s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(ODD, '').replace(NBSP, ' ');
  if (multiline) {
    s = s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    s = s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return s.length > max ? null : s;
}
function countWords(s) { const t = String(s || '').trim(); return t ? t.split(/\s+/).length : 0; }
function tagsOf(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,|#\n]/);
  const out = [];
  for (const raw of list) {
    const t = clean(String(raw).slice(0, 200), 200).slice(0, MAX.tag).trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX.tags) break;
  }
  return out.join('|');
}
const splitTags = (s) => (s ? String(s).split('|') : []);
const visitorOf = (v) => (/^[a-f0-9]{16,32}$/.test(String(v || '')) ? String(v) : null);
const canPublish = (u) => u.role === 'trusted' || u.role === 'admin';
const pubUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors }
  });
}

async function readJson(c) {
  if (Number(c.req.headers.get('Content-Length') || 0) > 1_000_000) fail(413, 'Nội dung gửi lên quá lớn.');
  const t = await c.req.text();
  if (t.length > 1_000_000) fail(413, 'Nội dung gửi lên quá lớn.');
  let v;
  try { v = JSON.parse(t || '{}'); } catch (e) { fail(400, 'Dữ liệu gửi lên không đúng.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Dữ liệu gửi lên không đúng.');
  return v;
}

// Lượt đọc / thả tim chỉ nhận từ trang của mình (trang khác không "bơm" số qua trình duyệt người xem được)
function fromSite(c) {
  const o = c.req.headers.get('Origin') || '';
  if (!ORIGINS.includes(o) && !LOCAL_ORIGIN.test(o)) fail(403, 'Không được phép.');
}

/* ---------- giới hạn số lần ---------- */
async function ipKey(c) {
  return (await sha256((c.env.FIC_SALT || '') + '|' + (c.req.headers.get('CF-Connecting-IP') || ''))).slice(0, 20);
}
async function limitOk(c, key, max) {
  const r = await c.db.prepare('SELECT n FROM limits WHERE k = ?1 AND until > ?2').bind(key, Date.now()).first();
  return !r || r.n < max;
}
async function limitBump(c, key, windowSec) {
  const t = Date.now();
  await c.db.prepare(`INSERT INTO limits (k, n, until) VALUES (?1, 1, ?2)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN until <= ?3 THEN 1 ELSE n + 1 END,
                                   until = CASE WHEN until <= ?3 THEN ?2 ELSE until END`)
    .bind(key, t + windowSec * 1000, t).run();
}
async function limit(c, key, max, windowSec, message) {
  if (!(await limitOk(c, key, max))) fail(429, message);
  await limitBump(c, key, windowSec);
}
async function cleanup(env) {
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM limits WHERE until < ?1').bind(t),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?1').bind(t),
    env.DB.prepare('DELETE FROM seen WHERE day < ?1').bind(vnDay(-2))
  ]);
}

/* ---------- tài khoản ---------- */
async function hashPass(clientHash) {
  const salt = randomHex(16);
  return salt + ':' + (await sha256(salt + ':' + clientHash));
}
async function checkPass(clientHash, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h || !PASS_RE.test(String(clientHash || ''))) return false;
  return sameString(h, await sha256(salt + ':' + clientHash));
}
async function newSession(c, userId) {
  const token = randomHex(32);
  await c.db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?1, ?2, ?3)')
    .bind(await sha256(token), userId, Date.now() + SESSION_MS).run();
  return token;
}
function bearer(c) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(c.req.headers.get('Authorization') || '');
  return m ? m[1] : null;
}
async function currentUser(c) {
  if ('user' in c) return c.user;
  c.user = null;
  const t = bearer(c);
  if (t) {
    const u = await c.db.prepare(`SELECT u.id, u.username, u.name, u.role, u.banned
        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1 AND s.expires > ?2`)
      .bind(await sha256(t), Date.now()).first();
    if (u && !u.banned) c.user = u;
  }
  return c.user;
}
async function needUser(c) {
  const u = await currentUser(c);
  if (!u) fail(401, 'Bạn cần đăng nhập trước nhé.');
  return u;
}
async function needAdmin(c) {
  const u = await needUser(c);
  if (u.role !== 'admin') fail(403, 'Chỉ người duyệt mới làm được việc này.');
  return u;
}
async function turnstileOk(c, token) {
  if (!c.env.TURNSTILE_SECRET) return true;            // chưa cài Turnstile (thử trong máy) thì bỏ qua
  if (!token || String(token).length > 2048) return false;
  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET);
  form.append('response', String(token));
  const ip = c.req.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

// Hàng chờ duyệt: chương mới chờ duyệt + bản sửa của chương đã đăng (truyện bị ẩn / người bị khoá thì bỏ qua)
const QUEUE_WHERE = `(ch.status = 'pending' OR ch.edit_status = 'pending') AND s.status != 'hidden' AND u.banned = 0`;
async function queueCount(c) {
  const r = await c.db.prepare(`SELECT
      (SELECT COUNT(*) FROM chapters ch JOIN stories s ON s.id = ch.story_id JOIN users u ON u.id = s.author_id WHERE ${QUEUE_WHERE}) +
      (SELECT COUNT(*) FROM stories s JOIN users u ON u.id = s.author_id WHERE s.edit_meta IS NOT NULL AND s.status != 'hidden' AND u.banned = 0) AS n`).first();
  return r ? r.n : 0;
}

/* ---------- định tuyến ---------- */
const routes = [];
function route(method, pattern, fn) {
  routes.push({ method, fn, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>\\d{1,12})') + '$') });
}
const idOf = (c) => Number(c.params.id);

/* ===== tài khoản ===== */
route('POST', '/auth/register', async (c) => {
  const b = await readJson(c);
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) fail(400, 'Tên đăng nhập cần 3–20 ký tự, chỉ gồm chữ thường không dấu, số và dấu _.');
  const name = clean(b.name, MAX.name);
  if (!name || name.length < 2) fail(400, 'Bút danh cần 2–40 ký tự.');
  if (!PASS_RE.test(String(b.pass || ''))) fail(400, 'Mật khẩu không hợp lệ.');
  const ipk = 'reg:' + (await ipKey(c));
  if (!(await limitOk(c, ipk, 5))) fail(429, 'Hôm nay mạng này đã tạo nhiều tài khoản quá, mai thử lại nhé.');
  if (!(await turnstileOk(c, b.ts))) fail(400, 'Chưa qua bước kiểm tra chống spam, bạn thử lại nhé.');
  const r = await c.db.prepare(`INSERT OR IGNORE INTO users (username, name, pass, role, created) VALUES (?1, ?2, ?3, 'user', ?4)`)
    .bind(username, name, await hashPass(b.pass), nowIso()).run();
  if (!r.meta.changes) fail(409, 'Tên đăng nhập này có người dùng rồi, bạn chọn tên khác nhé.');
  await limitBump(c, ipk, 86400);
  const user = { id: r.meta.last_row_id, username, name, role: 'user' };
  return { token: await newSession(c, user.id), user };
});

route('POST', '/auth/login', async (c) => {
  const b = await readJson(c);
  const username = String(b.username || '').trim().toLowerCase().slice(0, 40);
  const ipk = 'login-ip:' + (await ipKey(c)), uk = 'login:' + username;
  if (!(await limitOk(c, ipk, 30)) || !(await limitOk(c, uk, 10))) {
    fail(429, 'Nhập sai nhiều lần quá, bạn đợi 15 phút rồi thử lại nhé.');
  }
  const u = await c.db.prepare('SELECT id, username, name, role, banned, pass FROM users WHERE username = ?1').bind(username).first();
  if (!u || !(await checkPass(b.pass, u.pass))) {
    await limitBump(c, ipk, 900);
    await limitBump(c, uk, 900);
    fail(401, 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  if (u.banned) fail(403, 'Tài khoản này đã bị khoá.');
  return { token: await newSession(c, u.id), user: pubUser(u) };
});

route('POST', '/auth/logout', async (c) => {
  const t = bearer(c);
  if (t) await c.db.prepare('DELETE FROM sessions WHERE token = ?1').bind(await sha256(t)).run();
  return { ok: true };
});

route('GET', '/auth/me', async (c) => {
  const u = await currentUser(c);
  if (!u) return { user: null };
  return { user: pubUser(u), queue: u.role === 'admin' ? await queueCount(c) : 0 };
});

route('PUT', '/auth/me', async (c) => {
  const u = await needUser(c);
  const name = clean((await readJson(c)).name, MAX.name);
  if (!name || name.length < 2) fail(400, 'Bút danh cần 2–40 ký tự.');
  await c.db.prepare('UPDATE users SET name = ?2 WHERE id = ?1').bind(u.id, name).run();
  return { user: { ...pubUser(u), name } };
});

route('POST', '/auth/password', async (c) => {
  const u = await needUser(c);
  const b = await readJson(c);
  if (!PASS_RE.test(String(b.pass || ''))) fail(400, 'Mật khẩu mới không hợp lệ.');
  const row = await c.db.prepare('SELECT pass FROM users WHERE id = ?1').bind(u.id).first();
  if (!(await checkPass(b.old, row && row.pass))) fail(400, 'Mật khẩu hiện tại chưa đúng.');
  await c.db.batch([
    c.db.prepare('UPDATE users SET pass = ?2 WHERE id = ?1').bind(u.id, await hashPass(b.pass)),
    // đăng xuất các máy khác, giữ máy đang dùng
    c.db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token != ?2').bind(u.id, await sha256(bearer(c)))
  ]);
  return { ok: true };
});

/* ===== đọc truyện (ai cũng xem được) ===== */
route('GET', '/stories', async (c) => {
  const { results } = await c.db.prepare(`SELECT s.id, s.title, s.summary, s.tags, s.rating, s.done, s.reads, s.created, s.updated,
        u.name AS author, u.username, COUNT(ch.id) AS chapters, SUM(ch.words) AS words, SUM(ch.hearts) AS hearts
      FROM stories s JOIN users u ON u.id = s.author_id
      JOIN chapters ch ON ch.story_id = s.id AND ch.status = 'published'
      WHERE s.status = 'published' AND u.banned = 0
      GROUP BY s.id ORDER BY s.updated DESC LIMIT 500`).all();
  return {
    stories: results.map((r) => ({
      id: r.id, title: r.title, summary: r.summary, tags: splitTags(r.tags), rating: r.rating, done: !!r.done,
      reads: r.reads, created: r.created, updated: r.updated, author: { name: r.author, username: r.username },
      chapters: r.chapters, words: r.words || 0, hearts: r.hearts || 0
    }))
  };
});

route('GET', '/stories/:id', async (c) => {
  const id = idOf(c);
  const s = await c.db.prepare(`SELECT s.*, u.name AS author, u.username FROM stories s JOIN users u ON u.id = s.author_id
      WHERE s.id = ?1 AND s.status = 'published' AND u.banned = 0`).bind(id).first();
  const { results } = s
    ? await c.db.prepare(`SELECT id, title, words, hearts, published FROM chapters
        WHERE story_id = ?1 AND status = 'published' ORDER BY n, id`).bind(id).all()
    : { results: [] };
  if (!s || !results.length) fail(404, 'Không tìm thấy truyện này (có thể truyện đang chờ duyệt hoặc đã bị gỡ).');
  return {
    story: {
      id, title: s.title, summary: s.summary, tags: splitTags(s.tags), rating: s.rating, done: !!s.done, reads: s.reads,
      created: s.created, updated: s.updated, authorId: s.author_id, author: { name: s.author, username: s.username },
      chapters: results, words: results.reduce((a, x) => a + x.words, 0), hearts: results.reduce((a, x) => a + x.hearts, 0)
    }
  };
});

route('GET', '/chapters/:id', async (c) => {
  const id = idOf(c);
  const ch = await c.db.prepare(`SELECT ch.id, ch.story_id, ch.title, ch.body, ch.words, ch.hearts, ch.published,
        s.title AS story_title, s.rating, s.author_id, u.name AS author, u.username
      FROM chapters ch JOIN stories s ON s.id = ch.story_id JOIN users u ON u.id = s.author_id
      WHERE ch.id = ?1 AND ch.status = 'published' AND s.status = 'published' AND u.banned = 0`).bind(id).first();
  if (!ch) fail(404, 'Không tìm thấy chương này (có thể đang chờ duyệt hoặc đã bị gỡ).');
  const who = visitorOf(c.url.searchParams.get('u'));
  const [list, mine] = await c.db.batch([
    c.db.prepare(`SELECT id, title FROM chapters WHERE story_id = ?1 AND status = 'published' ORDER BY n, id`).bind(ch.story_id),
    c.db.prepare('SELECT 1 AS x FROM hearts WHERE chapter_id = ?1 AND who = ?2').bind(id, who || '-')
  ]);
  return {
    chapter: {
      id, title: ch.title, body: ch.body, words: ch.words, hearts: ch.hearts, published: ch.published,
      hearted: !!(who && mine.results.length), index: list.results.findIndex((x) => x.id === id), list: list.results,
      story: { id: ch.story_id, title: ch.story_title, rating: ch.rating, authorId: ch.author_id,
               author: { name: ch.author, username: ch.username } }
    }
  };
});

async function publishedChapter(c, id) {
  const ok = await c.db.prepare(`SELECT ch.id, s.author_id FROM chapters ch JOIN stories s ON s.id = ch.story_id
      JOIN users u ON u.id = s.author_id
      WHERE ch.id = ?1 AND ch.status = 'published' AND s.status = 'published' AND u.banned = 0`).bind(id).first();
  if (!ok) fail(404, 'Không tìm thấy chương này.');
  return ok;
}

route('POST', '/chapters/:id/heart', async (c) => {
  fromSite(c);
  const id = idOf(c);
  const b = await readJson(c);
  const who = visitorOf(b.u);
  if (!who) fail(400, 'Thiếu mã người đọc.');
  await publishedChapter(c, id);
  await limit(c, 'heart:' + (await ipKey(c)), 600, 86400, 'Hôm nay bạn thả tim nhiều quá rồi, mai thả tiếp nha.');
  const on = b.on !== false;
  const r = await c.db.prepare(on ? 'INSERT OR IGNORE INTO hearts (chapter_id, who) VALUES (?1, ?2)'
                                  : 'DELETE FROM hearts WHERE chapter_id = ?1 AND who = ?2').bind(id, who).run();
  if (r.meta.changes) {
    await c.db.prepare(`UPDATE chapters SET hearts = MAX(0, hearts ${on ? '+' : '-'} 1) WHERE id = ?1`).bind(id).run();
  }
  return { hearted: on, hearts: await c.db.prepare('SELECT hearts FROM chapters WHERE id = ?1').bind(id).first('hearts') };
});

route('POST', '/read', async (c) => {
  fromSite(c);
  const b = await readJson(c);
  const who = visitorOf(b.u), id = Number(b.story);
  if (!who || !Number.isSafeInteger(id) || id <= 0) fail(400, 'Thiếu thông tin.');
  const ipk = 'read:' + (await ipKey(c));
  if (!(await limitOk(c, ipk, 300))) return { counted: false };
  const day = vnDay();
  const s = await c.db.prepare(`SELECT id FROM stories WHERE id = ?1 AND status = 'published'`).bind(id).first();
  if (!s) return { counted: false };
  const r = await c.db.prepare('INSERT OR IGNORE INTO seen (k, day) VALUES (?1, ?2)').bind(day + '|' + who + '|' + id, day).run();
  if (!r.meta.changes) return { counted: false };             // hôm nay người này đã được tính rồi
  await c.db.prepare('UPDATE stories SET reads = reads + 1 WHERE id = ?1').bind(id).run();
  await limitBump(c, ipk, 86400);
  return { counted: true };
});

// Bình luận: khách để lại tên + email là được (không cần tài khoản). Email chỉ người duyệt thấy.
route('GET', '/chapters/:id/comments', async (c) => {
  const viewer = await currentUser(c);
  const admin = !!viewer && viewer.role === 'admin';
  const { results } = await c.db.prepare(`SELECT cm.id, cm.body, cm.created, cm.name, cm.email, cm.user_id, u.name AS uname, u.role
      FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.chapter_id = ?1 AND (cm.user_id IS NULL OR u.banned = 0) ORDER BY cm.id LIMIT 500`).bind(idOf(c)).all();
  return {
    comments: results.map((r) => ({
      id: r.id, body: r.body, created: r.created, name: r.uname || r.name,
      user: r.user_id ? { id: r.user_id, role: r.role } : null,
      ...(admin && r.email ? { email: r.email } : {})
    }))
  };
});

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
route('POST', '/chapters/:id/comments', async (c) => {
  fromSite(c);
  const u = await currentUser(c);
  const id = idOf(c);
  const b = await readJson(c);
  if (b.website) fail(400, 'Không gửi được bình luận.');      // ô ẩn: người thật không thấy nên không điền, máy spam thì điền
  const body = clean(b.body, MAX.comment, true);
  if (body === null) fail(400, 'Bình luận dài quá (tối đa 1.000 ký tự).');
  if (!body) fail(400, 'Bạn chưa viết gì cả.');
  if ((body.match(/https?:\/\/|www\./gi) || []).length > 2) fail(400, 'Bình luận có nhiều link quá, bạn bớt link đi nhé.');
  let name, email = '';
  if (u) {
    name = u.name;                                             // đã đăng nhập: dùng bút danh, không cần email
  } else {
    name = clean(b.name, MAX.name);
    if (!name || name.length < 2) fail(400, 'Bạn để lại tên (2–40 ký tự) nhé.');
    email = String(b.email || '').trim().toLowerCase();
    if (email.length > 120 || !EMAIL_RE.test(email)) fail(400, 'Email chưa đúng, bạn kiểm tra lại nhé.');
  }
  await publishedChapter(c, id);
  const ipk = await ipKey(c);
  await limit(c, u ? 'cmt:' + u.id : 'cmt-ip:' + ipk, u ? 20 : 8, 3600, 'Bạn bình luận nhanh quá, nghỉ tay chút rồi viết tiếp nha.');
  const t = nowIso();
  const r = await c.db.prepare(`INSERT INTO comments (chapter_id, user_id, name, email, ip, body, created)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(id, u ? u.id : null, name, email, ipk, body, t).run();
  return { comment: { id: r.meta.last_row_id, body, created: t, name, user: u ? { id: u.id, role: u.role } : null } };
});

route('DELETE', '/comments/:id', async (c) => {
  const u = await needUser(c);
  const cm = await c.db.prepare(`SELECT cm.id, cm.user_id, s.author_id FROM comments cm
      JOIN chapters ch ON ch.id = cm.chapter_id JOIN stories s ON s.id = ch.story_id WHERE cm.id = ?1`).bind(idOf(c)).first();
  if (!cm) fail(404, 'Bình luận này không còn nữa.');
  // người viết bình luận, tác giả truyện và người duyệt được xoá
  if (cm.user_id !== u.id && cm.author_id !== u.id && u.role !== 'admin') fail(403, 'Bạn không xoá được bình luận này.');
  await c.db.prepare('DELETE FROM comments WHERE id = ?1').bind(cm.id).run();
  return { ok: true };
});

/* ===== truyện của tôi ===== */
async function myStory(c, id) {
  const user = await needUser(c);
  const s = await c.db.prepare('SELECT * FROM stories WHERE id = ?1').bind(id).first();
  if (!s || (s.author_id !== user.id && user.role !== 'admin')) fail(404, 'Không tìm thấy truyện này trong tài khoản của bạn.');
  return { user, s };
}
async function myChapter(c, id) {
  const user = await needUser(c);
  const ch = await c.db.prepare(`SELECT ch.*, s.author_id, s.title AS story_title, s.status AS story_status
      FROM chapters ch JOIN stories s ON s.id = ch.story_id WHERE ch.id = ?1`).bind(id).first();
  if (!ch || (ch.author_id !== user.id && user.role !== 'admin')) fail(404, 'Không tìm thấy chương này trong tài khoản của bạn.');
  return { user, ch };
}
function storyFields(b) {
  const title = clean(b.title, MAX.title);
  if (title === null) fail(400, 'Tên truyện dài quá (tối đa 120 ký tự).');
  if (!title) fail(400, 'Truyện cần có tên nhé.');
  const summary = clean(b.summary, MAX.summary, true);
  if (summary === null) fail(400, 'Tóm tắt dài quá (tối đa 2.000 ký tự).');
  return { title, summary, tags: tagsOf(b.tags), rating: RATINGS.includes(String(b.rating)) ? String(b.rating) : 'all',
           done: b.done ? 1 : 0 };
}
function chapterFields(b) {
  const title = clean(b.title, MAX.title);
  if (title === null) fail(400, 'Tên chương dài quá (tối đa 120 ký tự).');
  const body = clean(b.body, MAX.body, true);
  if (body === null) fail(400, 'Chương dài quá (tối đa 100.000 ký tự), bạn chia thành 2 chương nhé.');
  if (!body) fail(400, 'Chương chưa có nội dung.');
  return { title, body, words: countWords(body) };
}
// Chương vừa được đăng: truyện hiện lên (nếu chưa bị ẩn) và nhảy lên đầu mục "mới cập nhật"
function afterPublish(c, storyId, t) {
  return c.db.prepare(`UPDATE stories SET updated = ?2,
      status = CASE WHEN status IN ('draft', 'pending') THEN 'published' ELSE status END WHERE id = ?1`).bind(storyId, t).run();
}
function afterSubmit(c, storyId) {
  return c.db.prepare(`UPDATE stories SET status = 'pending' WHERE id = ?1 AND status = 'draft'`).bind(storyId).run();
}
function deleteStoryStmts(c, id) {
  return [
    c.db.prepare('DELETE FROM comments WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = ?1)').bind(id),
    c.db.prepare('DELETE FROM hearts WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = ?1)').bind(id),
    c.db.prepare('DELETE FROM chapters WHERE story_id = ?1').bind(id),
    c.db.prepare('DELETE FROM stories WHERE id = ?1').bind(id)
  ];
}

route('GET', '/my/stories', async (c) => {
  const u = await needUser(c);
  const { results } = await c.db.prepare(`SELECT s.id, s.title, s.status, s.rating, s.done, s.reads, s.created, s.updated, s.note,
        s.edit_meta IS NOT NULL AS meta_waiting, COUNT(ch.id) AS total,
        SUM(ch.status = 'published') AS published, SUM(ch.status = 'draft') AS drafts,
        SUM(ch.status = 'pending' OR ch.edit_status = 'pending') AS waiting,
        SUM(ch.status = 'rejected' OR ch.edit_status = 'rejected') AS rejected, SUM(ch.hearts) AS hearts
      FROM stories s LEFT JOIN chapters ch ON ch.story_id = s.id
      WHERE s.author_id = ?1 GROUP BY s.id ORDER BY COALESCE(s.updated, s.created) DESC`).bind(u.id).all();
  return {
    stories: results.map((r) => ({
      id: r.id, title: r.title, status: r.status, rating: r.rating, done: !!r.done, reads: r.reads, created: r.created,
      updated: r.updated, note: r.note, metaWaiting: !!r.meta_waiting, total: r.total || 0, published: r.published || 0,
      drafts: r.drafts || 0, waiting: r.waiting || 0, rejected: r.rejected || 0, hearts: r.hearts || 0
    }))
  };
});

route('GET', '/my/stories/:id', async (c) => {
  const { user, s } = await myStory(c, idOf(c));
  const { results } = await c.db.prepare(`SELECT id, n, title, words, status, note, edit_status AS editStatus, hearts, updated, published
      FROM chapters WHERE story_id = ?1 ORDER BY n, id`).bind(s.id).all();
  let pendingMeta = null;
  try { pendingMeta = s.edit_meta ? JSON.parse(s.edit_meta) : null; } catch (e) { /* bỏ qua */ }
  return {
    canPublish: canPublish(user),
    story: {
      id: s.id, title: s.title, summary: s.summary, tags: splitTags(s.tags), rating: s.rating, done: !!s.done,
      status: s.status, note: s.note, reads: s.reads, created: s.created, updated: s.updated, authorId: s.author_id,
      pendingMeta: pendingMeta && { ...pendingMeta, tags: splitTags(pendingMeta.tags) }
    },
    chapters: results
  };
});

route('POST', '/my/stories', async (c) => {
  const u = await needUser(c);
  const f = storyFields(await readJson(c));
  await limit(c, 'story:' + u.id, 10, 86400, 'Hôm nay bạn tạo nhiều truyện quá rồi, mai tạo tiếp nha.');
  const r = await c.db.prepare(`INSERT INTO stories (author_id, title, summary, tags, rating, done, status, created)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7)`).bind(u.id, f.title, f.summary, f.tags, f.rating, f.done, nowIso()).run();
  return { id: r.meta.last_row_id };
});

route('PUT', '/my/stories/:id', async (c) => {
  const { user, s } = await myStory(c, idOf(c));
  const f = storyFields(await readJson(c));
  if (s.status === 'published' && !canPublish(user)) {
    // Truyện đã đăng của thành viên thường: tên / tóm tắt / thẻ / độ tuổi mới phải chờ duyệt. "Đã hoàn" thì đổi luôn.
    const changed = f.title !== s.title || f.summary !== s.summary || f.tags !== s.tags || f.rating !== s.rating;
    const meta = changed ? JSON.stringify({ title: f.title, summary: f.summary, tags: f.tags, rating: f.rating }) : null;
    await c.db.prepare(`UPDATE stories SET done = ?2, edit_meta = ?3, note = '' WHERE id = ?1`).bind(s.id, f.done, meta).run();
    return { pending: changed };
  }
  await c.db.prepare(`UPDATE stories SET title = ?2, summary = ?3, tags = ?4, rating = ?5, done = ?6, edit_meta = NULL, note = ''
      WHERE id = ?1`).bind(s.id, f.title, f.summary, f.tags, f.rating, f.done).run();
  return { pending: false };
});

route('DELETE', '/my/stories/:id', async (c) => {
  const { s } = await myStory(c, idOf(c));
  await c.db.batch(deleteStoryStmts(c, s.id));
  return { ok: true };
});

route('GET', '/my/chapters/:id', async (c) => {
  const { user, ch } = await myChapter(c, idOf(c));
  const editing = ch.status === 'published' && ch.edit_status;     // đang có bản sửa → mở bản sửa để viết tiếp
  return {
    canPublish: canPublish(user),
    chapter: {
      id: ch.id, storyId: ch.story_id, storyTitle: ch.story_title, status: ch.status, note: ch.note,
      editStatus: ch.edit_status, title: editing ? ch.edit_title : ch.title, body: editing ? ch.edit_body : ch.body,
      updated: ch.updated
    }
  };
});

route('POST', '/my/stories/:id/chapters', async (c) => {
  const { user, s } = await myStory(c, idOf(c));
  const b = await readJson(c);
  const f = chapterFields(b);
  await limit(c, 'chap:' + user.id, 50, 86400, 'Hôm nay bạn thêm nhiều chương quá rồi, mai thêm tiếp nha.');
  const status = b.submit ? (canPublish(user) ? 'published' : 'pending') : 'draft';
  const t = nowIso();
  const r = await c.db.prepare(`INSERT INTO chapters (story_id, n, title, body, words, status, created, updated, published)
      VALUES (?1, (SELECT COALESCE(MAX(n), 0) + 1 FROM chapters WHERE story_id = ?1), ?2, ?3, ?4, ?5, ?6, ?6, ?7)`)
    .bind(s.id, f.title, f.body, f.words, status, t, status === 'published' ? t : null).run();
  if (status === 'published') await afterPublish(c, s.id, t);
  else if (status === 'pending') await afterSubmit(c, s.id);
  return { id: r.meta.last_row_id, status };
});

route('PUT', '/my/chapters/:id', async (c) => {
  const { user, ch } = await myChapter(c, idOf(c));
  const b = await readJson(c);
  const f = chapterFields(b);
  const t = nowIso();
  if (ch.status === 'published') {
    if (canPublish(user)) {
      await c.db.prepare(`UPDATE chapters SET title = ?2, body = ?3, words = ?4, updated = ?5,
          edit_title = NULL, edit_body = NULL, edit_status = NULL, note = '' WHERE id = ?1`)
        .bind(ch.id, f.title, f.body, f.words, t).run();
      return { status: 'published', editStatus: null };
    }
    // Chương đã đăng của thành viên thường: lưu thành bản sửa chờ duyệt, người đọc vẫn thấy bản cũ
    await c.db.prepare(`UPDATE chapters SET edit_title = ?2, edit_body = ?3, edit_status = 'pending', note = '', updated = ?4
        WHERE id = ?1`).bind(ch.id, f.title, f.body, t).run();
    return { status: 'published', editStatus: 'pending' };
  }
  const status = b.submit ? (canPublish(user) ? 'published' : 'pending') : 'draft';
  await c.db.prepare(`UPDATE chapters SET title = ?2, body = ?3, words = ?4, status = ?5, note = '', updated = ?6,
      published = CASE WHEN ?5 = 'published' THEN ?6 ELSE published END WHERE id = ?1`)
    .bind(ch.id, f.title, f.body, f.words, status, t).run();
  if (status === 'published') await afterPublish(c, ch.story_id, t);
  else if (status === 'pending') await afterSubmit(c, ch.story_id);
  return { status };
});

route('POST', '/my/chapters/:id/cancel-edit', async (c) => {
  const { ch } = await myChapter(c, idOf(c));
  await c.db.prepare(`UPDATE chapters SET edit_title = NULL, edit_body = NULL, edit_status = NULL, note = '' WHERE id = ?1`)
    .bind(ch.id).run();
  return { ok: true };
});

route('DELETE', '/my/chapters/:id', async (c) => {
  const { ch } = await myChapter(c, idOf(c));
  await c.db.batch([
    c.db.prepare('DELETE FROM comments WHERE chapter_id = ?1').bind(ch.id),
    c.db.prepare('DELETE FROM hearts WHERE chapter_id = ?1').bind(ch.id),
    c.db.prepare('DELETE FROM chapters WHERE id = ?1').bind(ch.id)
  ]);
  return { ok: true };
});

/* ===== người duyệt ===== */
route('GET', '/admin/queue', async (c) => {
  await needAdmin(c);
  const [chs, metas] = await c.db.batch([
    c.db.prepare(`SELECT ch.id, ch.story_id, ch.title, ch.body, ch.words, ch.status, ch.edit_title, ch.edit_body, ch.updated,
          (SELECT COUNT(*) FROM chapters x WHERE x.story_id = ch.story_id AND (x.n < ch.n OR (x.n = ch.n AND x.id < ch.id))) + 1 AS pos,
          s.title AS story_title, s.status AS story_status, s.summary, s.tags, s.rating, u.name AS author, u.username
        FROM chapters ch JOIN stories s ON s.id = ch.story_id JOIN users u ON u.id = s.author_id
        WHERE ${QUEUE_WHERE} ORDER BY ch.updated LIMIT 50`),
    c.db.prepare(`SELECT s.id, s.title, s.summary, s.tags, s.rating, s.edit_meta, u.name AS author, u.username
        FROM stories s JOIN users u ON u.id = s.author_id
        WHERE s.edit_meta IS NOT NULL AND s.status != 'hidden' AND u.banned = 0 LIMIT 50`)
  ]);
  const items = chs.results.map((r) => {
    const edit = r.status === 'published';
    return {
      kind: edit ? 'edit' : r.story_status === 'published' ? 'chapter' : 'story',
      id: r.id, pos: r.pos, updated: r.updated, author: { name: r.author, username: r.username },
      title: edit ? r.edit_title : r.title, body: edit ? r.edit_body : r.body,
      oldTitle: edit ? r.title : null, words: countWords(edit ? r.edit_body : r.body),
      story: { id: r.story_id, title: r.story_title, summary: r.summary, tags: splitTags(r.tags), rating: r.rating }
    };
  });
  for (const r of metas.results) {
    let m = {};
    try { m = JSON.parse(r.edit_meta); } catch (e) { /* bỏ qua */ }
    items.push({
      kind: 'meta', id: r.id, author: { name: r.author, username: r.username },
      story: { id: r.id, title: r.title, summary: r.summary, tags: splitTags(r.tags), rating: r.rating },
      next: { title: m.title, summary: m.summary, tags: splitTags(m.tags), rating: m.rating }
    });
  }
  return { items };
});

route('POST', '/admin/chapters/:id', async (c) => {
  await needAdmin(c);
  const b = await readJson(c);
  const note = clean(String(b.note || '').slice(0, MAX.note), MAX.note, true) || '';
  const ch = await c.db.prepare('SELECT id, story_id, status, edit_status, edit_body FROM chapters WHERE id = ?1').bind(idOf(c)).first();
  if (!ch) fail(404, 'Chương này không còn nữa (có thể tác giả đã xoá).');
  const t = nowIso();
  if (b.action === 'approve') {
    if (ch.status === 'pending') {
      await c.db.prepare(`UPDATE chapters SET status = 'published', published = ?2, note = '' WHERE id = ?1`).bind(ch.id, t).run();
      await afterPublish(c, ch.story_id, t);
    } else if (ch.edit_status === 'pending') {
      await c.db.prepare(`UPDATE chapters SET title = edit_title, body = edit_body, words = ?2, updated = ?3,
          edit_title = NULL, edit_body = NULL, edit_status = NULL, note = '' WHERE id = ?1`)
        .bind(ch.id, countWords(ch.edit_body), t).run();
    } else fail(409, 'Mục này đã được xử lý rồi.');
  } else if (b.action === 'reject') {
    if (ch.status === 'pending') {
      await c.db.prepare(`UPDATE chapters SET status = 'rejected', note = ?2 WHERE id = ?1`).bind(ch.id, note).run();
    } else if (ch.edit_status === 'pending') {
      await c.db.prepare(`UPDATE chapters SET edit_status = 'rejected', note = ?2 WHERE id = ?1`).bind(ch.id, note).run();
    } else fail(409, 'Mục này đã được xử lý rồi.');
  } else fail(400, 'Thao tác không hợp lệ.');
  return { ok: true, queue: await queueCount(c) };
});

route('POST', '/admin/stories/:id', async (c) => {
  await needAdmin(c);
  const b = await readJson(c);
  const s = await c.db.prepare('SELECT id, edit_meta FROM stories WHERE id = ?1').bind(idOf(c)).first();
  if (!s) fail(404, 'Truyện này không còn nữa.');
  const note = clean(String(b.note || '').slice(0, MAX.note), MAX.note, true) || '';
  if (b.action === 'approve-meta') {
    if (!s.edit_meta) fail(409, 'Mục này đã được xử lý rồi.');
    const m = JSON.parse(s.edit_meta);
    await c.db.prepare(`UPDATE stories SET title = ?2, summary = ?3, tags = ?4, rating = ?5, edit_meta = NULL, note = '' WHERE id = ?1`)
      .bind(s.id, m.title, m.summary, m.tags, m.rating).run();
  } else if (b.action === 'reject-meta') {
    if (!s.edit_meta) fail(409, 'Mục này đã được xử lý rồi.');
    await c.db.prepare('UPDATE stories SET edit_meta = NULL, note = ?2 WHERE id = ?1').bind(s.id, note).run();
  } else if (b.action === 'hide') {
    await c.db.prepare(`UPDATE stories SET status = 'hidden', note = ?2 WHERE id = ?1`).bind(s.id, note).run();
  } else if (b.action === 'unhide') {
    await c.db.prepare(`UPDATE stories SET note = '', status = CASE
        WHEN EXISTS (SELECT 1 FROM chapters WHERE story_id = ?1 AND status = 'published') THEN 'published'
        WHEN EXISTS (SELECT 1 FROM chapters WHERE story_id = ?1 AND status = 'pending') THEN 'pending'
        ELSE 'draft' END WHERE id = ?1`).bind(s.id).run();
  } else if (b.action === 'delete') {
    await c.db.batch(deleteStoryStmts(c, s.id));
  } else fail(400, 'Thao tác không hợp lệ.');
  return { ok: true, queue: await queueCount(c) };
});

route('GET', '/admin/stories', async (c) => {
  await needAdmin(c);
  const { results } = await c.db.prepare(`SELECT s.id, s.title, s.status, s.reads, s.created, s.updated, u.name AS author, u.username,
        u.banned, COUNT(ch.id) AS total, SUM(ch.status = 'published') AS published
      FROM stories s JOIN users u ON u.id = s.author_id LEFT JOIN chapters ch ON ch.story_id = s.id
      GROUP BY s.id ORDER BY s.id DESC LIMIT 500`).all();
  return {
    stories: results.map((r) => ({ id: r.id, title: r.title, status: r.status, reads: r.reads, created: r.created,
      updated: r.updated, author: { name: r.author, username: r.username, banned: !!r.banned },
      total: r.total || 0, published: r.published || 0 }))
  };
});

route('GET', '/admin/users', async (c) => {
  await needAdmin(c);
  const { results } = await c.db.prepare(`SELECT u.id, u.username, u.name, u.role, u.banned, u.created,
        (SELECT COUNT(*) FROM stories WHERE author_id = u.id) AS stories,
        (SELECT COUNT(*) FROM comments WHERE user_id = u.id) AS comments
      FROM users u ORDER BY u.id DESC LIMIT 1000`).all();
  return { users: results.map((r) => ({ ...r, banned: !!r.banned })) };
});

route('POST', '/admin/users/:id', async (c) => {
  const me = await needAdmin(c);
  const id = idOf(c);
  if (id === me.id) fail(400, 'Không tự đổi quyền hay khoá chính mình được.');
  const u = await c.db.prepare('SELECT id, role FROM users WHERE id = ?1').bind(id).first();
  if (!u) fail(404, 'Không tìm thấy thành viên này.');
  if (u.role === 'admin') fail(403, 'Không đổi được tài khoản của người duyệt khác.');
  const b = await readJson(c);
  const role = b.role === undefined ? null : ['user', 'trusted'].includes(b.role) ? b.role : fail(400, 'Quyền không hợp lệ.');
  const banned = b.banned === undefined ? null : b.banned ? 1 : 0;
  let pass = null;
  if (b.pass !== undefined) {
    if (!PASS_RE.test(String(b.pass))) fail(400, 'Mật khẩu không hợp lệ.');
    pass = await hashPass(b.pass);
  }
  const stmts = [c.db.prepare(`UPDATE users SET role = COALESCE(?2, role), banned = COALESCE(?3, banned),
      pass = COALESCE(?4, pass) WHERE id = ?1`).bind(id, role, banned, pass)];
  if (banned || pass) stmts.push(c.db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id));   // đăng xuất khỏi mọi máy
  await c.db.batch(stmts);
  return { ok: true };
});

/* ---------- cổng vào ---------- */
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = (ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin))
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } });
    }
    const c = { req, env, ctx, url, db: env.DB, params: {} };
    try {
      let pathFound = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathFound = true;
        if (r.method !== req.method) continue;
        c.params = m.groups || {};
        const out = await r.fn(c);
        if (Math.random() < 0.02) ctx.waitUntil(cleanup(env).catch(() => {}));
        return json(out ?? { ok: true }, 200, cors);
      }
      if (url.pathname === '/') return json({ ok: true, name: 'lenamiu-fic' }, 200, cors);
      return json({ error: pathFound ? 'Sai phương thức.' : 'Không có đường dẫn này.' }, pathFound ? 405 : 404, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e && e.stack || e);
      return json({ error: 'Máy chủ gặp lỗi, bạn thử lại sau nhé.' }, 500, cors);
    }
  }
};
