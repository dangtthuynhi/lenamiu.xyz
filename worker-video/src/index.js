/* Máy chủ phát video LenaMiu (Cloudflare Workers + kho R2, miễn phí)

   GET /<tên-file>   Trả file trong kho R2 (vd /pls-love-ep2.mp4, /pls-love-ep2.jpg).
                     Hỗ trợ tải từng đoạn (Range) để tua video và để iPhone phát được.

   Vì sao không dùng link r2.dev có sẵn của R2: link đó bị Cloudflare giới hạn tốc độ, không dành cho web thật.
   Phát qua Worker thì không giới hạn kiểu đó, và cũng không phải chuyển DNS của lenamiu.xyz sang Cloudflare.
*/

// Trang được phép nhúng video. Mở thẳng link (không có Referer) thì vẫn cho xem.
// Trang khác nhúng / hút video thì chặn, đỡ tốn lượt đọc miễn phí.
const ALLOWED_HOSTS = ['lenamiu.xyz', 'www.lenamiu.xyz', 'dangtthuynhi.github.io', 'localhost', '127.0.0.1'];

function text(body, status, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
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
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    const url = new URL(request.url);
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
