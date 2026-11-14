/* Máy chủ nhỏ cho thanh PK LenaMiu vs MiuLena (chạy trên Cloudflare Workers, miễn phí)

   POST /sepay  SePay gọi vào mỗi khi tài khoản ngân hàng có tiền vào (webhook).
                Nội dung chuyển khoản có chữ "LenaMiu" hoặc "MiuLena" thì cộng tiền cho phe đó.
   GET  /pk     Trang lenamiu.xyz hỏi % mỗi phe + vài lượt gần nhất (không có số tiền, không có tên người chuyển).

   POST /hit    Đếm lượt truy cập trang ('site') hoặc lượt xem video ('v:<id>'): 1 người / 1 lượt / ngày.
   GET  /stats  Trả số lượt truy cập + lượt xem từng video.
   GET  /geo    Trả mã nước của người xem theo IP (Cloudflare tự biết, vd { country: "TH" }), để trang chọn ngôn ngữ
                lần đầu. Không lưu gì, không trả IP. Chỉ trả lời cho trang lenamiu.xyz.

   PayPal (người ủng hộ ở nước ngoài, cộng chung vào thanh PK):
   POST /paypal/order    trang gửi { team, amount } → máy chủ tạo đơn PayPal (ghi phe ở custom_id), trả { id }
   POST /paypal/capture  trang gửi { order } sau khi người xem bấm trả → máy chủ thu tiền, cộng vào phe ngay
   POST /paypal/webhook  PayPal tự báo (PAYMENT.CAPTURE.COMPLETED / REFUNDED / REVERSED), máy chủ nhờ PayPal xác minh
                         chữ ký rồi mới cộng / trừ — phòng khi người xem tắt trang trước khi trang kịp báo.
                         Cùng mã giao dịch nên báo bao nhiêu lần cũng chỉ cộng một lần.
   Cấu hình ([vars] trong wrangler.toml): PAYPAL_ENV ('sandbox' để thử | 'live'), PAYPAL_CLIENT_ID, PAYPAL_WEBHOOK_ID,
   PAYPAL_VND_PER_USD (tỷ giá quy đổi, vd 25000). Bí mật: `npx wrangler secret put PAYPAL_SECRET`.

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
// Lượt PayPal (bảng paypal, đã quy ra VNĐ) cộng chung với chuyển khoản; id trả về dạng "pp-<mã>" cho khỏi trùng.
async function onPk(env, cors) {
  const [totals, recentTx, recentPp] = await env.DB.batch([
    env.DB.prepare(`SELECT team, SUM(total) AS total, SUM(n) AS n FROM (
        SELECT team, SUM(amount) AS total, SUM(id > 0) AS n FROM tx GROUP BY team
        UNION ALL SELECT team, SUM(amount), COUNT(*) FROM paypal GROUP BY team) GROUP BY team`),
    env.DB.prepare('SELECT id, team, at FROM tx WHERE id > 0 ORDER BY at DESC, id DESC LIMIT 5'),
    env.DB.prepare('SELECT id, team, at FROM paypal ORDER BY at DESC LIMIT 5')
  ]);
  const recent = { results: [...recentTx.results, ...recentPp.results.map((r) => ({ ...r, id: 'pp-' + r.id }))]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 5) };
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

// Mã nước theo IP (request.cf.country do Cloudflare điền). Mỗi người một kết quả nên không cho lưu đệm chung.
function onGeo(request) {
  const origin = request.headers.get('Origin') || '';
  const ok = STATS_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
  const country = String((request.cf && request.cf.country) || '').toUpperCase();
  return json({ country: ok && /^[A-Z]{2}$/.test(country) ? country : '' }, ok ? 200 : 403, {
    'Cache-Control': 'private, no-store', Vary: 'Origin',
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {})
  });
}

/* ---------- PayPal ---------- */
const PP_MIN = 1, PP_MAX = 500;                 // mỗi lượt ủng hộ từ 1 đến 500 USD
const ppBase = (env) => env.PAYPAL_API ||       // PAYPAL_API: chỉ dùng khi thử với máy chủ PayPal giả trong máy
  (env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
const ppReady = (env) => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
let ppToken = null;                             // mã đăng nhập PayPal, dùng lại tới khi gần hết hạn
async function ppAuth(env) {
  const key = env.PAYPAL_CLIENT_ID + '|' + ppBase(env);
  if (ppToken && ppToken.key === key && ppToken.exp > Date.now() + 60e3) return ppToken.v;
  const r = await fetch(ppBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error('PayPal đăng nhập lỗi ' + r.status);
  const d = await r.json();
  ppToken = { v: d.access_token, exp: Date.now() + (Number(d.expires_in) || 300) * 1000, key };
  return ppToken.v;
}
// Gọi API PayPal. body là chuỗi JSON (gửi nguyên văn) hoặc object. Trả { status, data }.
async function ppApi(env, method, path, body) {
  const r = await fetch(ppBase(env) + path, {
    method,
    headers: { Authorization: 'Bearer ' + (await ppAuth(env)), 'Content-Type': 'application/json' },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  let data = null;
  try { data = await r.json(); } catch (e) { /* không có nội dung */ }
  return { status: r.status, data };
}
// Giờ Việt Nam "2026-11-14 18:05:09" (giống SePay) để trang hiện "lúc 18:05"
function vnTime(iso) {
  const t = Date.parse(iso || '');
  return new Date((isNaN(t) ? Date.now() : t) + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}
// Ghi một khoản đã thu xong (capture). Phe lấy từ custom_id do chính máy chủ ghi lúc tạo đơn.
async function ppRecord(env, capture, customId) {
  const team = String(customId || (capture && capture.custom_id) || '');
  if (!capture || capture.status !== 'COMPLETED' || !TEAMS.some((t) => t.key === team)) return { counted: false };
  const cur = capture.amount && capture.amount.currency_code;
  const usd = Number(capture.amount && capture.amount.value);
  if (cur !== 'USD' || !(usd > 0) || !/^[A-Z0-9]{5,40}$/.test(String(capture.id || ''))) return { counted: false };
  const vnd = Math.round(usd * (Number(env.PAYPAL_VND_PER_USD) || 25000));
  const r = await env.DB.prepare('INSERT OR IGNORE INTO paypal (id, team, amount, usd, at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(String(capture.id), team, vnd, usd, vnTime(capture.create_time)).run();
  return { counted: r.meta.changes > 0, team };
}
async function ppRecordOrder(env, order) {
  let counted = false, team = null;
  for (const pu of (order && order.purchase_units) || []) {
    for (const c of (pu.payments && pu.payments.captures) || []) {
      const x = await ppRecord(env, c, pu.custom_id);
      counted = counted || x.counted;
      team = x.team || team;
    }
  }
  return { counted, team };
}
const siteCors = (origin) => ({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' });
function fromSite(request) {
  const origin = request.headers.get('Origin') || '';
  return STATS_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : '';
}
async function readBody(request) {
  const t = await request.text();
  if (t.length > 2000) return null;
  try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

// Tạo đơn: trang gửi phe + số tiền (USD). Máy chủ tự ghi phe vào đơn nên người ủng hộ không phải ghi gì thêm.
async function onPaypalOrder(request, env) {
  const origin = fromSite(request);
  if (!origin) return json({ error: 'forbidden' }, 403);
  const cors = siteCors(origin);
  if (!ppReady(env)) return json({ error: 'paypal-off' }, 503, cors);
  const b = await readBody(request);
  const team = String((b && b.team) || '');
  const amount = Math.round(Number(b && b.amount) * 100) / 100;
  if (!TEAMS.some((t) => t.key === team)) return json({ error: 'team' }, 400, cors);
  if (!(amount >= PP_MIN && amount <= PP_MAX)) return json({ error: 'amount' }, 400, cors);
  const r = await ppApi(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: team,
      description: 'Lumi – LenaMiu fan project · team ' + team,
      amount: { currency_code: 'USD', value: amount.toFixed(2) }
    }],
    application_context: { brand_name: 'LenaMiu Sub', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' }
  });
  if (r.status >= 300 || !r.data || !r.data.id) return json({ error: 'paypal', status: r.status }, 502, cors);
  return json({ id: r.data.id }, 200, cors);
}

// Thu tiền sau khi người xem bấm trả trên cửa sổ PayPal → cộng vào phe ngay (thanh PK đổi liền)
async function onPaypalCapture(request, env) {
  const origin = fromSite(request);
  if (!origin) return json({ error: 'forbidden' }, 403);
  const cors = siteCors(origin);
  if (!ppReady(env)) return json({ error: 'paypal-off' }, 503, cors);
  const b = await readBody(request);
  const order = String((b && b.order) || '');
  if (!/^[A-Z0-9]{5,40}$/.test(order)) return json({ error: 'order' }, 400, cors);
  let r = await ppApi(env, 'POST', '/v2/checkout/orders/' + order + '/capture', '{}');
  // đã thu rồi (vd bấm 2 lần, hoặc webhook tới trước): đọc lại đơn để biết kết quả
  if (r.status === 422) r = await ppApi(env, 'GET', '/v2/checkout/orders/' + order);
  if (r.status >= 300 || !r.data) return json({ error: 'paypal', status: r.status }, 502, cors);
  const done = r.data.status === 'COMPLETED';
  const x = done ? await ppRecordOrder(env, r.data) : { counted: false, team: null };
  return json({ ok: done, status: r.data.status, counted: x.counted, team: x.team }, done ? 200 : 402, cors);
}

// PayPal tự báo. Nhờ PayPal xác minh chữ ký (gửi nguyên văn nội dung nhận được) rồi mới cộng / trừ.
async function onPaypalWebhook(request, env) {
  const raw = await request.text();
  if (!ppReady(env) || !env.PAYPAL_WEBHOOK_ID) return json({ ok: false }, 503);
  let ev;
  try { ev = JSON.parse(raw); } catch (e) { return json({ ok: false }, 400); }
  const h = (k) => JSON.stringify(String(request.headers.get(k) || ''));
  const check = '{"auth_algo":' + h('paypal-auth-algo') + ',"cert_url":' + h('paypal-cert-url') +
    ',"transmission_id":' + h('paypal-transmission-id') + ',"transmission_sig":' + h('paypal-transmission-sig') +
    ',"transmission_time":' + h('paypal-transmission-time') + ',"webhook_id":' + JSON.stringify(env.PAYPAL_WEBHOOK_ID) +
    ',"webhook_event":' + raw + '}';
  const v = await ppApi(env, 'POST', '/v1/notifications/verify-webhook-signature', check);
  if (!v.data || v.data.verification_status !== 'SUCCESS') return json({ ok: false }, 401);
  const res = ev.resource || {};
  if (ev.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const x = await ppRecord(env, res);
    return json({ ok: true, counted: x.counted });
  }
  // Hoàn tiền / bị đòi lại: bỏ lượt đó khỏi thanh PK
  let capId = '';
  if (ev.event_type === 'PAYMENT.CAPTURE.REVERSED') capId = String(res.id || '');
  if (ev.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const up = (res.links || []).find((l) => l.rel === 'up');
    capId = up ? String(up.href).split('/').pop() : '';
  }
  if (/^[A-Z0-9]{5,40}$/.test(capId)) {
    await env.DB.prepare('DELETE FROM paypal WHERE id = ?1').bind(capId).run();
    return json({ ok: true, removed: capId });
  }
  return json({ ok: true });
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
    if (url.pathname === '/geo' && request.method === 'GET') return onGeo(request);
    try {
      if (url.pathname === '/paypal/order' && request.method === 'POST') return await onPaypalOrder(request, env);
      if (url.pathname === '/paypal/capture' && request.method === 'POST') return await onPaypalCapture(request, env);
      if (url.pathname === '/paypal/webhook' && request.method === 'POST') return await onPaypalWebhook(request, env);
    } catch (e) {
      console.error(e && e.stack || e);
      const origin = fromSite(request);
      return json({ error: 'paypal' }, 502, origin ? siteCors(origin) : {});
    }
    if (url.pathname === '/pk' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    return json({ ok: true, routes: ['GET /pk', 'POST /sepay', 'POST /hit', 'GET /stats', 'GET /geo',
      'POST /paypal/order', 'POST /paypal/capture', 'POST /paypal/webhook'] }, url.pathname === '/' ? 200 : 404);
  }
};
