/* Máy chủ nhỏ cho thanh PK LenaMiu vs MiuLena (chạy trên Cloudflare Workers, miễn phí)

   POST /sepay  SePay gọi vào mỗi khi tài khoản ngân hàng có tiền vào (webhook).
                Nội dung chuyển khoản có chữ "LenaMiu" hoặc "MiuLena" thì cộng tiền cho phe đó.
   GET  /pk     Trang lenamiu.xyz hỏi tổng tiền mỗi phe + vài lượt gần nhất (không có tên người chuyển).

   Bí mật SEPAY_SECRET đặt bằng lệnh `npx wrangler secret put SEPAY_SECRET`, KHÔNG ghi vào file này.
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

async function onPk(env, cors) {
  const [totals, recent] = await env.DB.batch([
    env.DB.prepare('SELECT team, SUM(amount) AS total, COUNT(*) AS n FROM tx GROUP BY team'),
    env.DB.prepare('SELECT id, team, amount, at FROM tx ORDER BY at DESC, id DESC LIMIT 5')
  ]);
  const teams = {};
  for (const t of TEAMS) teams[t.key] = { total: 0, count: 0 };
  for (const r of totals.results) if (teams[r.team]) teams[r.team] = { total: r.total, count: r.n };
  return json({ teams, recent: recent.results }, 200, {
    ...cors,
    'Cache-Control': 'public, max-age=3'
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Số liệu PK là công khai, chỉ đọc → cho trang nào đọc cũng được (kể cả khi thử trong máy)
    const cors = { 'Access-Control-Allow-Origin': '*' };

    if (url.pathname === '/sepay' && request.method === 'POST') return onSepay(request, env);
    if (url.pathname === '/pk' && request.method === 'GET') return onPk(env, cors);
    if (url.pathname === '/pk' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    return json({ ok: true, routes: ['GET /pk', 'POST /sepay'] }, url.pathname === '/' ? 200 : 404);
  }
};
