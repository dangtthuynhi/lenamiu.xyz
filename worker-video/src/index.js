/* Máy chủ phát video LenaMiu (Cloudflare Workers + kho R2, miễn phí)

   GET /<tên-file>   Trả file trong kho R2 (vd /pls-love-ep2.mp4, /pls-love-ep2.jpg).
                     Hỗ trợ tải từng đoạn (Range) để tua video và để iPhone phát được.

   Vì sao không dùng link r2.dev có sẵn của R2: link đó bị Cloudflare giới hạn tốc độ, không dành cho web thật.
   Phát qua Worker thì không giới hạn kiểu đó, và cũng không phải chuyển DNS của lenamiu.xyz sang Cloudflare.

   /_upload/...      Lệnh tools/up-video.mjs tải video lên theo từng phần 50 MB (video lớn bao nhiêu cũng được).
                     Phải có mã bí mật UPLOAD_SECRET (đặt bằng `npx wrangler secret put UPLOAD_SECRET`),
                     người ngoài không tải lên được.
*/

// Trang được phép nhúng video. Mở thẳng link (không có Referer) thì vẫn cho xem.
// Trang khác nhúng / hút video thì chặn, đỡ tốn lượt đọc miễn phí.
const ALLOWED_HOSTS = ['lenamiu.xyz', 'www.lenamiu.xyz', 'dangtthuynhi.github.io', 'localhost', '127.0.0.1'];

function text(body, status, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

// So sánh không để lộ thời gian (chống đoán dần từng ký tự mã bí mật)
function sameString(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Tải lên từng phần (multipart) vào kho R2:
//   POST /_upload/start?key=&type=           → { uploadId }
//   PUT  /_upload/part?key=&uploadId=&n=     (thân = 1 phần, mọi phần trừ phần cuối cùng cỡ) → { partNumber, etag }
//   POST /_upload/complete?key=&uploadId=    (thân = { parts: [...] }) → { key, size }
//   POST /_upload/abort?key=&uploadId=
async function onUpload(request, env, url) {
  if (!env.UPLOAD_SECRET || !sameString(request.headers.get('Authorization') || '', 'Bearer ' + env.UPLOAD_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const key = url.searchParams.get('key') || '';
  if (!/^[a-z0-9][a-z0-9._-]{0,200}$/.test(key)) return json({ error: 'bad key' }, 400);
  const action = url.pathname.slice('/_upload/'.length);
  try {
    if (action === 'start' && request.method === 'POST') {
      const type = url.searchParams.get('type') || 'application/octet-stream';
      const up = await env.VIDEOS.createMultipartUpload(key, { httpMetadata: { contentType: type } });
      return json({ uploadId: up.uploadId });
    }
    const uploadId = url.searchParams.get('uploadId') || '';
    if (!uploadId) return json({ error: 'missing uploadId' }, 400);
    const up = env.VIDEOS.resumeMultipartUpload(key, uploadId);
    if (action === 'part' && request.method === 'PUT') {
      const n = Number(url.searchParams.get('n'));
      if (!Number.isInteger(n) || n < 1 || n > 10000) return json({ error: 'bad part number' }, 400);
      if (!request.body) return json({ error: 'empty body' }, 400);
      return json(await up.uploadPart(n, request.body));
    }
    if (action === 'complete' && request.method === 'POST') {
      const body = await request.json();
      const obj = await up.complete(body.parts);
      return json({ key: obj.key, size: obj.size });
    }
    if (action === 'abort' && request.method === 'POST') {
      await up.abort();
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function refererAllowed(request) {
  const ref = request.headers.get('Referer');
  if (!ref) return true;
  try { return ALLOWED_HOSTS.includes(new URL(ref).hostname); } catch (e) { return false; }
}

// R2 trả đoạn đã cắt dưới dạng {offset, length} hoặc {suffix}; đổi về offset + length cụ thể
function rangeOf(r, size) {
  if (r && 'suffix' in r) {
    const length = Math.min(r.suffix, size);
    return { offset: size - length, length };
  }
  const offset = (r && r.offset) || 0;
  const length = r && r.length != null ? r.length : size - offset;
  return { offset, length };
}

function baseHeaders(obj) {
  const h = new Headers();
  obj.writeHttpMetadata(h);           // Content-Type... lấy từ lúc tải file lên
  h.set('ETag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'public, max-age=86400');
  return h;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_upload/')) return onUpload(request, env, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    let key;
    try { key = decodeURIComponent(url.pathname.slice(1)); } catch (e) { return text('Bad path', 400); }
    if (!key) return text('LenaMiu video', 200);
    if (!refererAllowed(request)) return text('Forbidden', 403);

    if (request.method === 'HEAD') {
      const head = await env.VIDEOS.head(key);
      if (!head) return text('Not found', 404);
      const h = baseHeaders(head);
      h.set('Content-Length', String(head.size));
      return new Response(null, { status: 200, headers: h });
    }

    let obj;
    try {
      obj = await env.VIDEOS.get(key, { range: request.headers, onlyIf: request.headers });
    } catch (e) {
      // Range vượt quá cỡ file
      const head = await env.VIDEOS.head(key);
      if (!head) return text('Not found', 404);
      return text('Range not satisfiable', 416, { 'Content-Range': 'bytes */' + head.size });
    }
    if (obj === null) return text('Not found', 404);

    const h = baseHeaders(obj);
    if (!obj.body) {                  // điều kiện If-None-Match / If-Match... không thoả
      return new Response(null, { status: request.headers.has('If-None-Match') ? 304 : 412, headers: h });
    }
    if (request.headers.has('Range') && obj.range) {
      const { offset, length } = rangeOf(obj.range, obj.size);
      h.set('Content-Range', 'bytes ' + offset + '-' + (offset + length - 1) + '/' + obj.size);
      h.set('Content-Length', String(length));
      return new Response(obj.body, { status: 206, headers: h });
    }
    h.set('Content-Length', String(obj.size));
    return new Response(obj.body, { status: 200, headers: h });
  }
};
