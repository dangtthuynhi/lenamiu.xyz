/* Phần dùng chung cho MỌI trang của lenamiu.xyz (trang video, Fanfic, 404). Đi cùng site.css.
     - Dải chữ chạy trên cùng: tỉ lệ PK LenaMiu vs MiuLena + lượt donate gần nhất + rủ tiếp sức
     - Đầu trang: logo, dòng ghi công, nút 🎬 Video · 📖 Fanfic · 🍼 Nuôi Lumi
     - Hộp "Mua sữa tã cho Lumi": chọn phe → mã QR, thanh PK; tung bông tung hoa khi có người donate
   Cách gắn vào một trang (đặt ngay đầu <body>, sau khi nạp site.css trong <head>):
     <script>(function(){var v=Date.now();document.write('<script src="videos.js?v='+v+'"><\/script><script src="site.js?v='+v+'"><\/script>');})();</script>
   (trang nằm trong thư mục con thì thêm ../ trước tên file). Đầu trang được chèn ngay tại chỗ thẻ <script> đó.
   Cấu hình (chữ trên nút, ảnh QR, máy chủ PK...) đọc từ videos.js → site.donate, site.tagline.
   Chỗ trống cho từng trang: <div id="topExtra"> ở cuối đầu trang (trang Fanfic để nút tài khoản ở đây).
   Link mở hộp donate ở chỗ khác trong trang: <a href="#" data-donate></a>, bọc trong <p data-donate-wrap hidden>.
*/
(function () {
  'use strict';
  if (window.LM) return;

  const me = document.currentScript;
  const ROOT = new URL('./', (me && me.src) || location.href).href;          // thư mục gốc của trang web
  // trang đang mở (để tô đậm nút tương ứng ở đầu trang): 'video' (trang chủ), 'fanfic', hoặc '' (vd trang 404)
  const PAGE = /\/fanfic(\/|$)/.test(location.pathname) ? 'fanfic'
    : (location.pathname === new URL(ROOT).pathname || /\/index\.html$/.test(location.pathname)) ? 'video' : '';
  const SITE = Object.assign({ tagline: '' }, (window.VIETSUB || {}).site);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const abs = (p) => { try { return p ? new URL(String(p).trim(), ROOT).href : ''; } catch (e) { return ''; } };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function store(key, val) {
    try { return val === undefined ? localStorage.getItem(key) : localStorage.setItem(key, val); }
    catch (e) { return null; }
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  /* ================= đầu trang + dải chữ chạy ================= */
  const topHtml =
    '<a class="ticker" id="ticker" href="' + ROOT + '#lumi" hidden>' +
      '<span class="ticker-track" aria-hidden="true"><span class="ticker-item" id="tickerA"></span>' +
      '<span class="ticker-item" id="tickerB"></span></span></a>' +
    '<header class="top wrap" id="siteTop">' +
      '<a class="brand" href="' + ROOT + '"><img src="' + ROOT + 'favicon.svg" alt="" width="32" height="32">' +
        '<span>LenaMiu <b>Vietsub</b></span></a>' +
      '<p class="tagline" id="tagline"></p>' +
      '<nav class="top-nav" aria-label="Mục chính">' +
        '<a class="top-link" href="' + ROOT + '" data-page="video">🎬 Video</a>' +
        '<a class="top-link" href="' + ROOT + 'fanfic/" data-page="fanfic">📖 Fanfic</a>' +
        '<button type="button" class="donate-btn" id="donateBtn" hidden><span class="btn-long"></span><span class="btn-short"></span></button>' +
      '</nav>' +
      '<div class="top-extra" id="topExtra"></div>' +
    '</header>';
  if (me && me.parentNode && document.readyState === 'loading') me.insertAdjacentHTML('beforebegin', topHtml);
  else document.body.insertAdjacentHTML('afterbegin', topHtml);
  $('tagline').textContent = SITE.tagline || '';
  $('tagline').hidden = !SITE.tagline;
  document.querySelectorAll('#siteTop .top-link').forEach((a) => {
    if (a.dataset.page === PAGE) a.setAttribute('aria-current', 'page');
  });

  /* ================= hộp "Mua sữa tã cho Lumi" ================= */
  document.body.insertAdjacentHTML('beforeend',
    '<dialog class="sheet lm-dd" id="donateDialog" aria-labelledby="dTitle">' +
    '<form method="dialog" class="sheet-in">' +
      '<div class="sheet-head"><h2 id="dTitle"></h2><button class="icon-btn" value="close" aria-label="Đóng">✕</button></div>' +
      '<p class="sheet-sub" id="dText"></p>' +
      '<section class="pk" id="pk" aria-label="PK LenaMiu và MiuLena" hidden>' +
        '<div class="pk-score">' +
          '<span class="pk-side a" id="pkSideA"><b><span class="crown" aria-hidden="true">👑</span>LenaMiu</b><span class="pk-pct" id="pkA">50%</span></span>' +
          '<span class="pk-vs" aria-hidden="true">VS</span>' +
          '<span class="pk-side b" id="pkSideB"><b>MiuLena<span class="crown" aria-hidden="true">👑</span></b><span class="pk-pct" id="pkB">50%</span></span>' +
        '</div>' +
        '<div class="pk-bar" id="pkBar" role="img" aria-label="Hai phe đang hoà">' +
          '<div class="pk-track"><span class="pk-fill a" id="pkFill"></span><span class="pk-fill b"></span></div>' +
          '<span class="pk-spark" id="pkSpark" aria-hidden="true">⚡</span>' +
        '</div>' +
        '<p class="pk-news" id="pkNews" aria-live="polite"></p>' +
      '</section>' +
      '<div id="teamBox" hidden>' +
        '<p class="teams-label" id="teamsLabel">Bạn đứng phe nào?</p>' +
        '<div class="teams" role="group" aria-labelledby="teamsLabel">' +
          '<button type="button" class="team a" data-team="LenaMiu" aria-pressed="false">LenaMiu</button>' +
          '<button type="button" class="team b" data-team="MiuLena" aria-pressed="false">MiuLena</button>' +
        '</div>' +
      '</div>' +
      '<figure class="qr" id="dQrBox"><img id="dQr" alt="Mã QR chuyển khoản"></figure>' +
      '<p class="memo" id="dMemoRow" hidden>Nội dung chuyển khoản: <b id="dMemo"></b>' +
        '<button type="button" class="memo-copy" id="dMemoCopy">Chép</button></p>' +
      '<dl class="acct" id="dAcct"></dl>' +
      '<p class="qr-tip">Đang xem trên điện thoại? Bấm “Lưu ảnh QR” (hoặc nhấn giữ ảnh → Lưu), ' +
        'rồi mở app ngân hàng / MoMo → Quét mã → chọn ảnh vừa lưu.</p>' +
      '<p class="qr-tip" id="pkTip" hidden>Chuyển khoản xong, thanh PK tự cập nhật sau vài giây. ' +
        'Nhớ giữ nguyên nội dung <b>LenaMiu</b> hoặc <b>MiuLena</b> khi chuyển để được tính nha.</p>' +
      '<div class="sheet-actions">' +
        '<button type="button" class="ghost" id="dCopy" hidden>Chép số tài khoản</button>' +
        '<a class="primary" id="dSave" download>Lưu ảnh QR</a>' +
      '</div>' +
    '</form></dialog>');

  // Mở thẳng lenamiu.xyz/#lumi là hiện luôn hộp QR (link cũ #coffee, #ung-ho vẫn dùng được).
  const DONATE = Object.assign({ button: 'Ủng hộ', buttonShort: '', qr: '', save: '', title: '', text: '',
                                 bank: '', bankBin: '', account: '', name: '', teamQr: null, pkApi: '' }, SITE.donate);
  const isDonateHash = (h) => h === 'lumi' || h === 'coffee' || h === 'ung-ho';
  let openDonate = () => {};
  let donateReady = false;

  // Hai phe của thanh PK. Phải khớp với máy chủ PK (worker/src/index.js).
  const TEAMS = ['LenaMiu', 'MiuLena'];
  const TEAM_KEY = 'pk_team';
  // Mã ngân hàng (BIN) theo chuẩn VietQR/Napas, để tự tạo mã QR từ tên ngân hàng + số tài khoản.
  const BANK_BIN = {
    vietcombank: '970436', vcb: '970436', vietinbank: '970415', bidv: '970418', agribank: '970405',
    mb: '970422', mbbank: '970422', techcombank: '970407', tcb: '970407', acb: '970416',
    vpbank: '970432', tpbank: '970423', sacombank: '970403', hdbank: '970437', vib: '970441',
    shb: '970443', eximbank: '970431', msb: '970426', ocb: '970448', seabank: '970440',
    lpbank: '970449', namabank: '970428', abbank: '970425', bacabank: '970409', pvcombank: '970412',
    kienlongbank: '970452', bvbank: '970454', timo: '970454', cake: '546034', ubank: '546035'
  };
  const BANK_BIN_OF = String(DONATE.bankBin || BANK_BIN[norm(DONATE.bank).replace(/[^a-z]/g, '')] || '');
  const PK_API = String(DONATE.pkApi || '').trim().replace(/\/+$/, '');
  // Ảnh QR làm sẵn cho từng phe (vd tạo trên SePay), dạng { LenaMiu: 'qr-lenamiu.png', MiuLena: '...' }
  const TEAM_QR = {};
  if (DONATE.teamQr && typeof DONATE.teamQr === 'object') TEAMS.forEach((t) => { TEAM_QR[t] = abs(DONATE.teamQr[t]); });
  const HAS_TEAM_QR = TEAMS.every((t) => TEAM_QR[t]);
  // Chọn phe khi: có ảnh QR từng phe, hoặc (có máy chủ PK + tài khoản ngân hàng) để tự tạo mã.
  // Không thì dùng một ảnh QR cố định (qr). Thanh PK chỉ hiện khi có pkApi.
  const AUTO_QR = HAS_TEAM_QR || !!(PK_API && BANK_BIN_OF && String(DONATE.account || '').trim());

  /* --- VietQR: chuỗi chuyển khoản chuẩn Napas, kèm sẵn nội dung (trường 62.08) --- */
  function tlv(id, v) { v = String(v); return id + String(v.length).padStart(2, '0') + v; }
  function crc16(s) {   // CRC-16/CCITT-FALSE, đúng kiểu VietQR dùng (đã thử khớp với mã QR MoMo cũ)
    let c = 0xFFFF;
    for (const b of new TextEncoder().encode(s)) {
      c ^= b << 8;
      for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return c.toString(16).toUpperCase().padStart(4, '0');
  }
  function vietqr(bin, account, memo) {
    const p = tlv('00', '01') + tlv('01', '11') +
      tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA')) +
      tlv('53', '704') + tlv('58', 'VN') + (memo ? tlv('62', tlv('08', memo)) : '') + '6304';
    return p + crc16(p);
  }

  // Thư viện vẽ mã QR: chỉ tải khi cần (lần đầu mở hộp), có kiểm tra toàn vẹn file
  let qrLibP = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLibP) {
      qrLibP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
        s.integrity = 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1';
        s.crossOrigin = 'anonymous';
        s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode')));
        s.onerror = () => { qrLibP = null; reject(new Error('qrcode')); };
        document.head.append(s);
      });
    }
    return qrLibP;
  }
  function qrMatrix(lib, text) {
    const q = lib(0, 'M');
    q.addData(text);
    q.make();
    return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
  }
  function qrSvg(m) {
    const NS = 'http://www.w3.org/2000/svg';
    const pad = 4;
    const size = m.n + pad * 2;
    let d = '';
    for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.dark(r, c)) d += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#000');
    svg.append(bg, p);
    return svg;
  }
  // Ảnh để lưu về máy: mã QR + vài dòng chữ bên dưới (nội dung chuyển khoản, tài khoản)
  function qrPng(m, lines) {
    const s = 12, pad = 4, w = (m.n + pad * 2) * s, lineH = 42;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = w + lines.length * lineH + 20;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.dark(r, c)) g.fillRect((c + pad) * s, (r + pad) * s, s, s);
    g.textAlign = 'center';
    lines.forEach((t, i) => {
      g.font = (i === 0 ? '700 30px' : '500 24px') + ' system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = i === 0 ? '#c13a6c' : '#1d1a1f';
      g.fillText(t, w / 2, w + 4 + i * lineH + 28, w - 24);
    });
    return cv.toDataURL('image/png');
  }

  const label = String(DONATE.button || '').trim() || 'Ủng hộ';

  // Link mở hộp donate ở chỗ khác trong trang (vd chân trang): <a data-donate>, bọc trong [data-donate-wrap]
  function wireDonateLinks() {
    if (!donateReady) return;
    document.querySelectorAll('[data-donate]:not([data-lm])').forEach((a) => {
      a.setAttribute('data-lm', '');
      if (!a.textContent.trim()) a.textContent = label;
      a.addEventListener('click', (e) => { e.preventDefault(); openDonate(); });
    });
    document.querySelectorAll('[data-donate-wrap]').forEach((w) => { w.hidden = false; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireDonateLinks);

  (function setupDonate() {
    const qr = abs(DONATE.qr);
    if (!qr && !AUTO_QR) return;
    const dd = $('donateDialog');
    $('donateBtn').querySelector('.btn-long').textContent = label;
    $('donateBtn').querySelector('.btn-short').textContent = String(DONATE.buttonShort || '').trim() || label;
    $('donateBtn').setAttribute('aria-label', label);
    $('dTitle').textContent = String(DONATE.title || '').trim() || label;
    $('dText').textContent = DONATE.text;
    $('dText').hidden = !DONATE.text;

    const rows = [['Ngân hàng', DONATE.bank], ['Số tài khoản', DONATE.account], ['Chủ tài khoản', DONATE.name]]
      .filter((r) => String(r[1] || '').trim());
    rows.forEach(([k, v]) => $('dAcct').append(el('dt', '', k), el('dd', '', v)));
    $('dAcct').hidden = !rows.length;
    $('dCopy').hidden = !String(DONATE.account || '').trim();

    function showButtons() {
      $('donateBtn').hidden = false;
      donateReady = true;
      wireDonateLinks();
      if (isDonateHash(location.hash.slice(1))) openDonate();
    }

    let team = '';            // phe đang chọn
    let pkTimer = 0;
    let seen = null;          // id các lượt đã thấy, để nhận ra lượt mới vừa vào
    let newsTimer = 0;
    let preloaded = false;    // đã tải sẵn ảnh QR hai phe chưa
    let pkFast = false;       // hộp donate đang mở → hỏi máy chủ PK nhanh hơn
    let lastPk = null;        // số liệu PK mới nhất
    let tickerText = '';

    openDonate = () => {
      if (typeof dd.showModal === 'function') { if (!dd.open) dd.showModal(); }
      else window.open(HAS_TEAM_QR ? TEAM_QR[team || TEAMS[0]] : qr, '_blank', 'noopener');
      if (AUTO_QR) { preloadTeamQr(); renderQr(); pkStart(); }
    };
    dd.addEventListener('close', pkStop);

    if (AUTO_QR) setupTeams();
    else {
      // Ảnh QR cố định: ảnh tải được thì mới hiện nút
      const save = abs(DONATE.save) || qr;
      $('dSave').href = save;
      $('dSave').setAttribute('download', 'ma-qr-nuoi-lumi' + (save.match(/\.\w+$/) || ['.png'])[0]);
      $('dQr').addEventListener('load', showButtons, { once: true });
      $('dQr').src = qr;
    }

    /* --- chọn phe → mã QR có sẵn nội dung LenaMiu / MiuLena --- */
    // Tải sẵn ảnh QR của cả hai phe khi mở hộp, để bấm đổi phe là hiện ngay
    function preloadTeamQr() {
      if (!HAS_TEAM_QR || preloaded) return;
      preloaded = true;
      TEAMS.forEach((t) => { new Image().src = TEAM_QR[t]; });
    }

    function setupTeams() {
      $('teamBox').hidden = false;
      $('pk').hidden = !PK_API;
      $('pkTip').hidden = !PK_API;
      team = TEAMS.includes(store(TEAM_KEY)) ? store(TEAM_KEY) : '';   // nhớ phe đã chọn lần trước
      $('teamBox').addEventListener('click', (e) => {
        const b = e.target.closest('.team');
        if (!b) return;
        team = b.dataset.team;
        store(TEAM_KEY, team);
        renderQr();
      });
      $('dMemoCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(team); } catch (e) { window.prompt('Chép nội dung này nha:', team); return; }
        $('dMemoCopy').textContent = 'Đã chép ✓';
        setTimeout(() => { $('dMemoCopy').textContent = 'Chép'; }, 2000);
      });
      $('ticker').addEventListener('click', (e) => { e.preventDefault(); openDonate(); });
      showButtons();
      pkSchedule(0);                    // bắt đầu theo dõi PK cho cả trang (dải chữ chạy + tung hoa)
    }

    function renderQr() {
      $('teamBox').querySelectorAll('.team').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.team === team)));
      const box = $('dQrBox');
      $('dMemoRow').hidden = !team;
      $('dSave').hidden = !team;
      if (!team) {
        box.replaceChildren(el('div', 'qr-wait', 'Chọn phe LenaMiu hoặc MiuLena để hiện mã QR nha'));
        return;
      }
      $('dMemo').textContent = team;
      if (HAS_TEAM_QR) {
        const src = TEAM_QR[team];
        const img = el('img');
        img.alt = 'Mã QR chuyển khoản, nội dung ' + team;
        img.addEventListener('error', () => {
          box.replaceChildren(el('div', 'qr-wait', 'Chưa tải được ảnh mã QR, bạn thử mở lại sau chút nha.'));
        }, { once: true });
        img.src = src;
        box.replaceChildren(img);
        $('dSave').href = src;
        $('dSave').setAttribute('download', 'ma-qr-' + team + (src.match(/\.\w+$/) || ['.png'])[0]);
        return;
      }
      const want = team;
      loadQrLib().then((lib) => {
        if (want !== team) return;   // đã bấm qua phe khác trong lúc chờ
        const account = String(DONATE.account).replace(/\s+/g, '');
        const m = qrMatrix(lib, vietqr(BANK_BIN_OF, account, team));
        const svg = qrSvg(m);
        svg.setAttribute('aria-label', 'Mã QR chuyển khoản, nội dung ' + team);
        box.replaceChildren(svg);
        $('dSave').href = qrPng(m, ['Nội dung: ' + team, [DONATE.bank, account].filter(Boolean).join(' · '),
                                    String(DONATE.name || '')].filter(Boolean));
        $('dSave').setAttribute('download', 'ma-qr-' + team + '.png');
      }).catch(() => {
        box.replaceChildren(el('div', 'qr-wait',
          'Chưa tải được mã QR. Bạn chuyển khoản theo số tài khoản bên dưới, nội dung ghi ' + team + ' nha.'));
        $('dSave').hidden = true;
      });
    }

    /* --- thanh PK: chỉ hiện %, không hiện số tiền (máy chủ cũng chỉ trả về %) --- */
    const fmtPct = (p) => p.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    let shownPct = 50;        // % phe LenaMiu đang hiện trên màn hình
    let pctRaf = 0;
    let hitTimer = 0;

    // Số % chạy dần từ số cũ sang số mới
    function countTo(to) {
      const from = shownPct;
      shownPct = to;
      cancelAnimationFrame(pctRaf);
      const paint = (p) => { $('pkA').textContent = fmtPct(p); $('pkB').textContent = fmtPct(100 - p); };
      if (reduced || from === to) { paint(to); return; }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1000);
        paint(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) pctRaf = requestAnimationFrame(step);
      };
      pctRaf = requestAnimationFrame(step);
    }

    // Tim bay ra từ chỗ hai phe giáp nhau
    function burst(t) {
      if (reduced) return;
      const left = $('pkSpark').style.left || '50%';
      for (let i = 0; i < 12; i++) {
        const h = el('span', 'pk-heart', t === 'LenaMiu' ? '💗' : '💜');
        h.setAttribute('aria-hidden', 'true');
        h.style.left = left;
        h.style.setProperty('--dx', Math.round(Math.random() * 140 - 70) + 'px');
        h.style.setProperty('--dy', Math.round(-30 - Math.random() * 60) + 'px');
        h.style.setProperty('--r', Math.round(Math.random() * 70 - 35) + 'deg');
        h.style.animationDelay = i * 30 + 'ms';
        $('pkBar').append(h);
        setTimeout(() => h.remove(), 1700);
      }
    }

    /* --- hỏi máy chủ PK cho cả trang: 30 giây/lần, 5 giây/lần khi hộp donate đang mở,
           ngừng khi người xem chuyển qua tab khác (đỡ tốn lượt gọi miễn phí) --- */
    function pkSchedule(ms) {
      clearTimeout(pkTimer);
      if (PK_API && AUTO_QR) pkTimer = setTimeout(pkTick, ms);
    }
    async function pkTick() {
      if (!document.hidden) {
        try {
          const r = await fetch(PK_API + '/pk', { cache: 'no-store' });
          if (r.ok) onPk(await r.json());
        } catch (e) { /* mạng chập chờn: giữ số cũ, lần sau hỏi lại */ }
      }
      pkSchedule(pkFast ? 5000 : 30000);
    }
    function pkStart() {               // mở hộp donate: vẽ ngay số đang có, rồi hỏi nhanh hơn
      pkFast = true;
      if (lastPk) renderPk(lastPk, []);
      pkSchedule(0);
    }
    function pkStop() { pkFast = false; }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pkSchedule(0); });

    function onPk(d) {
      lastPk = d;
      const recent = Array.isArray(d && d.recent) ? d.recent : [];
      const fresh = seen ? recent.filter((x) => !seen.has(x.id)) : [];   // lần đầu tải trang: chưa tính là mới
      seen = new Set([...(seen || []), ...recent.map((x) => x.id)]);
      renderTicker(d);
      if (dd.open) renderPk(d, fresh);
      // Chỉ tung hoa cho lượt vừa vào trong vài phút (quay lại tab sau lâu thì thôi, khỏi báo "vừa" sai)
      if (fresh.length && minutesAgo(fresh[0].at) < 10) celebrate(fresh[0].team);
    }

    function minutesAgo(at) {
      const t = new Date(String(at || '').replace(' ', 'T') + '+07:00');
      return isNaN(t) ? Infinity : (Date.now() - t.getTime()) / 60000;
    }

    // % mỗi phe (máy chủ bản cũ còn trả số tiền thì tự tính %)
    function pkNums(d) {
      const t = (d && d.teams) || {};
      const A = t.LenaMiu || {};
      const B = t.MiuLena || {};
      let pa;
      let started;
      if (typeof A.pct === 'number') { pa = A.pct; started = !!d.started; }
      else {
        const a = Number(A.total) || 0, b = Number(B.total) || 0;
        pa = a + b ? (a / (a + b)) * 100 : 50;
        started = a + b > 0;
      }
      pa = Math.min(100, Math.max(0, Math.round(pa * 10) / 10));
      return { pa, pb: Math.round((100 - pa) * 10) / 10, started };
    }

    function renderPk(d, fresh) {
      const { pa, pb, started } = pkNums(d);

      // Thanh: phe nào có lượt thì vẫn chừa ít nhất 3% bề ngang cho thấy được
      const w = pa > 0 && pa < 3 ? 3 : pa < 100 && pa > 97 ? 97 : pa;
      $('pkFill').style.width = w + '%';
      $('pkSpark').style.left = w + '%';
      countTo(pa);
      $('pkSideA').classList.toggle('lead', started && pa > pb);
      $('pkSideB').classList.toggle('lead', started && pb > pa);
      $('pkBar').setAttribute('aria-label', pa === pb ? 'Hai phe đang hoà, mỗi bên 50%'
        : 'LenaMiu ' + fmtPct(pa) + ', MiuLena ' + fmtPct(pb));

      const recent = Array.isArray(d && d.recent) ? d.recent : [];
      if (fresh.length) {
        const x = fresh[0];
        $('pkNews').setAttribute('aria-live', 'polite');   // chỉ đọc to khi có lượt mới
        $('pkNews').textContent = (x.team === 'LenaMiu' ? '💗' : '💜') + ' Phe ' + x.team + ' vừa được tiếp sức!';
        $('pkNews').classList.add('fresh');
        const pk = $('pk');
        pk.classList.remove('hit', 'hit-a', 'hit-b');
        void pk.offsetWidth;                       // chạy lại hiệu ứng nếu đang chạy dở
        pk.classList.add('hit', x.team === 'LenaMiu' ? 'hit-a' : 'hit-b');
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => pk.classList.remove('hit', 'hit-a', 'hit-b'), 800);
        burst(x.team);
        clearTimeout(newsTimer);
        newsTimer = setTimeout(() => { $('pkNews').classList.remove('fresh'); }, 8000);
      } else if (!$('pkNews').classList.contains('fresh')) {
        // Lượt donate gần nhất: phe nào + lúc nào (số nhập tay không tính, máy chủ đã lọc)
        const last = recent[0];
        const textNow = last ? lastText(last) : !started ? 'Chưa có lượt nào, mở màn đi nào!' : '';
        $('pkNews').setAttribute('aria-live', 'off');     // "N phút trước" đổi liên tục, khỏi đọc to mỗi phút
        if ($('pkNews').textContent !== textNow) $('pkNews').textContent = textNow;
      }
    }

    // Câu báo lượt donate gần nhất, viết như câu nói bình thường. Giờ theo giờ Việt Nam
    // (SePay ghi dạng "2026-11-08 10:21:51"), đúng cả khi máy người xem ở múi giờ khác.
    // fixed = true: luôn ghi giờ cụ thể (dải chữ chạy dùng, để chữ khỏi đổi mỗi phút làm giật)
    function lastText(x, fixed) {
      const icon = x.team === 'LenaMiu' ? '💗 ' : '💜 ';
      const t = new Date(String(x.at || '').replace(' ', 'T') + '+07:00');
      if (isNaN(t)) return icon + 'Lần donate gần nhất là cho phe ' + x.team;
      const vn = (d) => new Date(d.getTime() + 7 * 3600e3);
      const v = vn(t);
      const two = (n) => String(n).padStart(2, '0');
      const hm = two(v.getUTCHours()) + ':' + two(v.getUTCMinutes());
      const mins = Math.floor((Date.now() - t.getTime()) / 60000);
      if (!fixed && mins < 1) return icon + 'Phe ' + x.team + ' vừa được donate xong!';
      if (!fixed && mins < 60) return icon + 'Phe ' + x.team + ' vừa được donate cách đây ' + mins + ' phút';
      const today = v.toISOString().slice(0, 10) === vn(new Date()).toISOString().slice(0, 10);
      return icon + 'Lần donate gần nhất là cho phe ' + x.team + ', lúc ' + hm +
             (today ? ' hôm nay' : ' ngày ' + two(v.getUTCDate()) + '/' + two(v.getUTCMonth() + 1));
    }

    /* --- dải chữ chạy ở trên cùng trang: tỉ lệ PK + lượt donate gần nhất + rủ tiếp sức --- */
    function renderTicker(d) {
      const tk = $('ticker');
      const { pa, pb, started } = pkNums(d);
      const recent = Array.isArray(d && d.recent) ? d.recent : [];
      const parts = [label + ': LenaMiu ' + fmtPct(pa) + ' ⚡ ' + fmtPct(pb) + ' MiuLena'];
      if (recent[0]) parts.push(lastText(recent[0], true));
      if (!started) parts.push('Chưa ai mở màn, bạn làm người đầu tiên nha!');
      else if (Math.abs(pa - pb) < 5) parts.push('🔥 Hai phe đang sát nút, ai sẽ thắng đây?');
      else {
        const behind = pa < pb ? 'LenaMiu' : 'MiuLena';
        const icon = behind === 'LenaMiu' ? '💗' : '💜';
        parts.push(Math.abs(pa - pb) < 15
          ? icon + ' Phe ' + behind + ' đang bị dẫn trước, tiếp sức để lật kèo nào!'
          : icon + ' Phe ' + behind + ' ơi, đang bị bỏ xa rồi, tiếp sức ngay nào!');
      }
      parts.push('👉 Bấm vào đây, chọn phe rồi quét mã để tiếp sức nha');
      const text = parts.join('     ✦     ');
      if (text === tickerText) return;            // chữ không đổi thì để yên, khỏi giật
      tickerText = text;
      $('tickerA').textContent = text;
      $('tickerB').textContent = text;            // chép 2 lần để chạy vòng liền mạch
      tk.setAttribute('aria-label', parts.join('. '));
      tk.hidden = false;
      // chữ dài hay ngắn cũng chạy cùng tốc độ, khoảng 70px mỗi giây
      requestAnimationFrame(() => tk.style.setProperty('--dur', Math.max(15, $('tickerA').offsetWidth / 70) + 's'));
    }

    /* --- tung bông tung hoa cho phe vừa được donate --- */
    function celebrate(t) {
      // Hộp donate đang mở (nằm lớp trên cùng) thì vẽ bên trong hộp, không thì vẽ trên cả trang
      const host = dd.open ? dd : document.body;
      const banner = el('div', 'cele-banner ' + (t === 'LenaMiu' ? 'a' : 'b'),
                        '🎉 Phe ' + t + ' vừa được tiếp sức! ' + (t === 'LenaMiu' ? '💗' : '💜'));
      banner.setAttribute('role', 'status');
      host.append(banner);
      setTimeout(() => banner.remove(), 5400);
      const tk = $('ticker');
      tk.classList.remove('flash'); void tk.offsetWidth; tk.classList.add('flash');
      if (!reduced) confetti(host, t);
    }

    function confetti(host, t) {
      const cv = document.createElement('canvas');
      cv.className = 'confetti';
      cv.setAttribute('aria-hidden', 'true');
      const W = innerWidth, H = innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = W * dpr; cv.height = H * dpr;
      host.append(cv);
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      const colors = t === 'LenaMiu' ? ['#ff7aa8', '#d63a78', '#ffc2d6', '#ffffff', '#ffd166']
                                     : ['#8c62ee', '#b89cff', '#6a3fd8', '#ffffff', '#ffd166'];
      const emojis = t === 'LenaMiu' ? ['🌸', '💗', '🌷', '💐'] : ['💜', '🌸', '💐', '✨'];
      const rand = (a, b) => a + Math.random() * (b - a);
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const P = [];
      const add = (x, y, vx, vy, emoji) => P.push({
        x, y, vx, vy, rot: rand(0, 6.28), vr: rand(-0.2, 0.2), flip: rand(0, 6.28), phase: rand(0, 6.28),
        w: rand(7, 13), h: rand(4, 8), color: pick(colors), shape: Math.random() < 0.3 ? 'dot' : 'rect',
        emoji: emoji ? pick(emojis) : '', size: rand(18, 30)
      });
      // Pháo bắn chéo lên từ 2 góc dưới
      const n = W < 600 ? 55 : 85;
      for (let i = 0; i < n; i++) {
        const sL = rand(11, 21) * (H / 800 + 0.4), aL = rand(-1.4, -0.85);
        add(0, H, Math.cos(aL) * sL, Math.sin(aL) * sL, i % 7 === 0);
        const sR = rand(11, 21) * (H / 800 + 0.4), aR = rand(-2.3, -1.75);
        add(W, H, Math.cos(aR) * sR, Math.sin(aR) * sR, i % 7 === 0);
      }
      // Hoa + pháo giấy rơi từ trên xuống
      for (let i = 0; i < (W < 600 ? 22 : 36); i++) add(rand(0, W), rand(-H * 0.5, -20), rand(-1, 1), rand(1, 3), i % 3 === 0);

      const start = performance.now();
      let prev = start;
      const step = (now) => {
        const dt = Math.min(3, (now - prev) / 16.7);   // máy 120Hz hay 60Hz cũng rơi cùng tốc độ
        prev = now;
        const age = now - start;
        g.clearRect(0, 0, W, H);
        g.globalAlpha = age > 4200 ? Math.max(0, 1 - (age - 4200) / 800) : 1;
        let alive = 0;
        for (const p of P) {
          p.vx *= Math.pow(0.985, dt);
          p.vy = p.vy * Math.pow(0.985, dt) + 0.32 * dt;
          if (p.vy > 4.5) p.vy = 4.5;                   // rơi chậm lại như giấy bay
          p.x += (p.vx + Math.sin(age / 260 + p.phase) * 0.7) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          p.flip += 0.12 * dt;
          if (p.y > H + 40) continue;
          alive++;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          if (p.emoji) {
            g.font = p.size + 'px serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(p.emoji, 0, 0);
          } else {
            g.fillStyle = p.color;
            if (p.shape === 'dot') { g.beginPath(); g.arc(0, 0, p.h * 0.6, 0, 6.28); g.fill(); }
            else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.flip)) + 1);   // lật như giấy thật
          }
          g.restore();
        }
        if (age < 5000 && alive) requestAnimationFrame(step);
        else cv.remove();
      };
      requestAnimationFrame(step);
    }

    $('donateBtn').addEventListener('click', openDonate);
    dd.addEventListener('click', (e) => { if (e.target === dd) dd.close(); });
    $('dCopy').addEventListener('click', async () => {
      const btn = $('dCopy');
      const acc = String(DONATE.account).replace(/\s+/g, '');
      try { await navigator.clipboard.writeText(acc); }
      catch (e) { window.prompt('Chép số tài khoản này nha:', acc); return; }
      btn.textContent = 'Đã chép ✓';
      setTimeout(() => { btn.textContent = 'Chép số tài khoản'; }, 2000);
    });
  })();

  // Cho từng trang dùng: mở hộp donate, nhận ra link #lumi
  window.LM = { root: ROOT, page: PAGE, openDonate: () => openDonate(), isDonateHash };
})();
