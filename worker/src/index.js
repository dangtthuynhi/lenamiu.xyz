/* Máy chủ nhỏ cho thanh PK LenaMiu vs MiuLena (chạy trên Cloudflare Workers, miễn phí)

   POST /sepay  SePay gọi vào mỗi khi tài khoản ngân hàng có tiền vào (webhook).
                Nội dung chuyển khoản có chữ "LenaMiu" hoặc "MiuLena" thì cộng tiền cho phe đó.
   GET  /pk     Trang lenamiu.xyz hỏi % mỗi phe + vài lượt gần nhất (không có số tiền, không có tên người chuyển).

   POST /hit    Đếm lượt truy cập trang ('site') hoặc lượt xem video ('v:<id>'): 1 người / 1 lượt / ngày.
   GET  /stats  Trả số lượt truy cập + lượt xem từng video.

   Bí mật SEPAY_SECRET đặt bằng lệnh `npx wrangler secret put SEPAY_SECRET`, KHÔNG ghi vào file này.
   STATS_SALT (mã trộn khi băm IP) cũng đặt bằng `npx wrangler secret put STATS_SALT`.
   Dữ liệu nằm trong Cloudflare D1 (bảng tx, xem schema.sql). id giao dịch của SePay là khoá chính,
   nên SePay có gửi lại cùng một giao dịch thì cũng không bị cộng hai lần.
*/

// Thứ tự không quan trọng: phe nào xuất hiện trước trong nội dung chuyển khoản thì tính cho phe đó.
// Ngân hàng hay đổi nội dung thành chữ HOA, có khi tách chữ ("LENA MIU") nên khớp không phân biệt hoa thường.
const TEAMS = [
  { key: 'LenaMiu', re: /lena\s*miu/i },
  { key: 'MiuLena', re: /miu\s*lena/i }
];

const enc = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}

// So sánh chuỗi không để lộ thời gian (chống đoán dần từng ký tự của mã bí mật)
function sameString(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// SePay hỗ trợ 2 kiểu xác thực, cấu hình kiểu nào trong SePay cũng được, dùng chung một SEPAY_SECRET:
//  - HMAC-SHA256 (SePay khuyến nghị): X-SePay-Signature = "sha256=" + HMAC(secret, timestamp + "." + body)
//  - API Key: Authorization = "Apikey <secret>"
async function verified(request, raw, secret) {
  if (!secret) return false;
  const sig = request.headers.get('X-SePay-Signature');
  const ts = request.headers.get('X-SePay-Timestamp');
  if (sig && ts) {
    if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;   // lệch quá 5 phút: bỏ
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
                                              false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(ts + '.' + raw));
    return sameString(sig, 'sha256=' + hex(mac));
  }
  return sameString(request.headers.get('Authorization') || '', 'Apikey ' + secret);
}

function teamOf(content) {
  let best = null;
  let at = Infinity;
  for (const t of TEAMS) {
    const m = t.re.exec(String(content || ''));
    if (m && m.index < at) { best = t.key; at = m.index; }
  }
  return best;
}

async function onSepay(request, env) {
  const raw = await request.text();
  if (!(await verified(request, raw, env.SEPAY_SECRET))) return json({ success: false }, 401);

  let tx;
  try { tx = JSON.parse(raw); } catch (e) { return json({ success: false, error: 'bad json' }, 400); }

  // Trả {"success": true} cho cả giao dịch không liên quan, để SePay khỏi gửi lại mãi
  const amount = Number(tx.transferAmount);
  const team = teamOf(tx.content) || teamOf(tx.description);
  if (tx.transferType !== 'in' || !team || !Number.isSafeInteger(amount) || amount <= 0 ||
      !Number.isSafeInteger(Number(tx.id))) {
    return json({ success: true, counted: false });
  }

  const r = await env.DB.prepare('INSERT OR IGNORE INTO tx (id, team, amount, at) VALUES (?1, ?2, ?3, ?4)')
    .bind(Number(tx.id), team, amount, String(tx.transactionDate || new Date().toISOString()))
    .run();
  return json({ success: true, counted: r.meta.changes > 0, team });   // changes = 0: giao dịch đã cộng rồi
}

// id > 0: giao dịch thật từ SePay. id < 0: số nhập tay (vd tiền nhận trước khi có thanh PK) —
// vẫn cộng vào tổng tiền, nhưng không tính là "lượt" và không hiện thành lượt mới vào.
async function onPk(env, cors) {
  const [totals, recent] = await env.DB.batch([
    env.DB.prepare('SELECT team, SUM(amount) AS total, SUM(id > 0) AS n FROM tx GROUP BY team'),
    env.DB.prepare('SELECT id, team, at FROM tx WHERE id > 0 ORDER BY at DESC, id DESC LIMIT 5')
  ]);
  // Chỉ trả về % mỗi phe (làm tròn 0,1%), KHÔNG trả số tiền: ai mở link này cũng không biết đã nhận bao nhiêu.
  const sum = {};
  const count = {};
  for (const t of TEAMS) { sum[t.key] = 0; count[t.key] = 0; }
  for (const r of totals.results) if (r.team in sum) { sum[r.team] = r.total || 0; count[r.team] = r.n || 0; }
  const all = TEAMS.reduce((s, t) => s + sum[t.key], 0);
  const [first, second] = TEAMS.map((t) => t.key);
  const pFirst = all ? Math.round((sum[first] / all) * 1000) / 10 : 50;
  const teams = {
    [first]: { pct: pFirst, count: count[first] },
    [second]: { pct: Math.round((100 - pFirst) * 10) / 10, count: count[second] }
  };
  return json({
    started: all > 0,
    teams,
    recent: recent.results.map((r) => ({ id: r.id, team: r.team, at: r.at }))   // bỏ số tiền
  }, 200, { ...cors, 'Cache-Control': 'public, max-age=3' });
}

/* ---------- đếm lượt truy cập / lượt xem ---------- */
// Chỉ nhận lượt đếm gửi từ các trang này (trang khác không "bơm" lượt xem qua trình duyệt người xem được)
const STATS_ORIGINS = ['https://lenamiu.xyz', 'https://www.lenamiu.xyz', 'https://dangtthuynhi.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const HITS_PER_IP_PER_DAY = 300;   // một mạng (IP) tối đa bấy nhiêu lượt đếm mỗi ngày, chặn bơm số

function vnDay(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
}

async function sha256hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function onHit(request, env, ctx, cors) {
  const origin = request.headers.get('Origin') || '';
  if (!STATS_ORIGINS.includes(origin) && !LOCAL_ORIGIN.test(origin)) return json({ ok: false }, 403, cors);
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false }, 400, cors); }
  const name = String((body && body.k) || '');
  const visitor = String((body && body.u) || '');
  if (!/^(site|v:[a-z0-9-]{1,80})$/.test(name) || !/^[a-f0-9]{16,32}$/.test(visitor)) {
    return json({ ok: false }, 400, cors);
  }
  const day = vnDay();
  const ip = (await sha256hex((env.STATS_SALT || '') + '|' + day + '|' + (request.headers.get('CF-Connecting-IP') || ''))).slice(0, 16);
  const used = await env.DB.prepare('SELECT COUNT(*) AS c FROM seen WHERE ip = ?1 AND day = ?2').bind(ip, day).first('c');
  if (used >= HITS_PER_IP_PER_DAY) return json({ ok: true, counted: false }, 200, cors);

  const r = await env.DB.prepare('INSERT OR IGNORE INTO seen (k, ip, day) VALUES (?1, ?2, ?3)')
    .bind(day + '|' + visitor + '|' + name, ip, day).run();
  const counted = r.meta.changes > 0;
  if (counted) {
    await env.DB.prepare('INSERT INTO counters (name, n) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET n = n + 1')
      .bind(name).run();
  }
  // Thỉnh thoảng dọn dữ liệu "đã đếm" cũ hơn 2 ngày cho bảng khỏi phình
  if (Math.random() < 0.02) ctx.waitUntil(env.DB.prepare('DELETE FROM seen WHERE day < ?1').bind(vnDay(-2)).run());
  return json({ ok: true, counted }, 200, cors);
}

async function onStats(env, cors) {
  const { results } = await env.DB.prepare('SELECT name, n FROM counters').all();
  const out = { site: 0, videos: {} };
  for (const r of results) {
    if (r.name === 'site') out.site = r.n;
    else if (r.name.startsWith('v:')) out.videos[r.name.slice(2)] = r.n;
  }
  return json(out, 200, { ...cors, 'Cache-Control': 'public, max-age=15' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Số liệu PK là công khai, chỉ đọc → cho trang nào đọc cũng được (kể cả khi thử trong máy)
    const cors = { 'Access-Control-Allow-Origin': '*' };

    if (url.pathname === '/sepay' && request.method === 'POST') return onSepay(request, env);
    if (url.pathname === '/pk' && request.method === 'GET') return onPk(env, cors);
    if (url.pathname === '/hit' && request.method === 'POST') return onHit(request, env, ctx, cors);
    if (url.pathname === '/stats' && request.method === 'GET') return onStats(env, cors);
    if (url.pathname === '/pk' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    return json({ ok: true, routes: ['GET /pk', 'POST /sepay', 'POST /hit', 'GET /stats'] }, url.pathname === '/' ? 200 : 404);
  }
};
