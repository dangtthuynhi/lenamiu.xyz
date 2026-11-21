/* Máy chủ "lenamiu-cheer": bộ đếm số lần cổ vũ của cả fandom cho Sảnh cổ vũ (lenamiu.xyz/cheer/).
     GET  /stats  → { a, b }   tổng lần gõ của phe LenaMiu (a) và MiuLena (b); trình duyệt + Cloudflare giữ bản sao 5 giây
     POST /add    "a=12&b=0"   trang gom số lần gõ rồi gửi mỗi 6 giây (và lúc rời trang, bằng sendBeacon)
   Chống phá: mỗi lần gửi tối đa MAX_PER_POST lần gõ mỗi phe; cùng một máy gửi dày hơn MIN_GAP_MS thì bỏ qua; chỉ nhận từ
   lenamiu.xyz (và máy thử 127.0.0.1 / localhost). Địa chỉ IP chỉ giữ tạm trong bộ nhớ để chặn gửi dồn, không ghi lại ở đâu. */
import { DurableObject } from 'cloudflare:workers';

const ORIGINS = ['https://lenamiu.xyz', 'https://www.lenamiu.xyz'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_PER_POST = 150;      // trang gửi mỗi 6 giây; gõ nhanh nhất cỡ 10 lần/giây
const MIN_GAP_MS = 2500;

export class CheerCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.recent = new Map();     // máy → lúc gửi gần nhất (chỉ trong bộ nhớ)
    ctx.blockConcurrencyWhile(async () => { this.t = (await ctx.storage.get('t')) || { a: 0, b: 0 }; });
  }
  async add(who, a, b) {
    const now = Date.now();
    if ((a || b) && now - (this.recent.get(who) || 0) >= MIN_GAP_MS) {
      this.recent.set(who, now);
      if (this.recent.size > 20000) this.recent.clear();
      this.t = { a: this.t.a + a, b: this.t.b + b };
      await this.ctx.storage.put('t', this.t);
    }
    return this.t;
  }
  async get() { return this.t; }
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = ORIGINS.includes(origin) || LOCAL.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const counter = env.COUNTER.get(env.COUNTER.idFromName('all'));

    if (url.pathname === '/stats' && request.method === 'GET') {
      const cache = caches.default, key = new Request(url.origin + '/stats');
      let res = await cache.match(key);
      if (!res) {
        const t = await counter.get();
        res = json({ a: t.a, b: t.b }, 200, { 'Cache-Control': 'public, max-age=5' });
        ctx.waitUntil(cache.put(key, res.clone()));
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }

    if (url.pathname === '/add' && request.method === 'POST') {
      if (!allowed) return json({ ok: false }, 403, cors);
      const p = new URLSearchParams((await request.text()).slice(0, 200));
      const n = (k) => Math.max(0, Math.min(MAX_PER_POST, parseInt(p.get(k), 10) || 0));
      const t = await counter.add(request.headers.get('CF-Connecting-IP') || 'local', n('a'), n('b'));
      return json({ a: t.a, b: t.b }, 200, cors);
    }

    return json({ ok: url.pathname === '/', routes: ['GET /stats', 'POST /add'] }, url.pathname === '/' ? 200 : 404, cors);
  },
};
