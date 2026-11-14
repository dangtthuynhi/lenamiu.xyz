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

   Đa ngôn ngữ: chữ giao diện ở i18n.js (nạp TRƯỚC site.js). Nút 🌐 ở đầu trang để đổi, trang nhớ lựa chọn.
     - Link có ?lang=en (th, zh, id, vi) thì mở bằng thứ tiếng đó (chỉ lần đó, không đổi lựa chọn đã lưu).
     - Lần đầu vào: máy để giờ Việt Nam hoặc có cài tiếng Việt → tiếng Việt; máy cài tiếng Thái / Trung / Indonesia → tiếng đó;
       máy chỉ cài tiếng Anh / tiếng khác → hỏi máy chủ PK (GET /geo) xem người xem ở nước nào theo IP (xem detectLang).
     - Chữ cố định trong trang: <span data-i18n="khoá"></span>, thuộc tính: data-i18n-attr="placeholder:khoá,aria-label:khoá".
     - Trang dùng qua window.LM: LM.t('khoá', {biến}), LM.tr(obj, 'title') (đọc ô title_en...), LM.lang, LM.locale.
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
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ================= ngôn ngữ ================= */
  const I18N = window.LM_I18N || { langs: [['vi', 'Tiếng Việt', 'VI', 'vi-VN']], vi: {} };
  const LANGS = I18N.langs.map(([code, name, short, locale]) => ({ code, name, short, locale }));
  const CODES = LANGS.map((l) => l.code);
  const LANG_KEY = 'lm_lang';          // thứ tiếng người xem tự chọn bằng nút 🌐
  const IP_KEY = 'lm_lang_ip';         // thứ tiếng đoán theo IP: lưu 30 ngày cho khỏi hỏi máy chủ mỗi lần
  // Mã nước (theo IP) → thứ tiếng. Nước khác: tiếng Anh.
  const COUNTRY_LANG = { VN: 'vi', TH: 'th', ID: 'id', CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh' };
  let askIp = false;
  // Thứ tự ưu tiên khi chọn thứ tiếng:
  //   1. link có ?lang=... (chỉ lần đó)   2. người xem đã tự chọn bằng nút 🌐
  //   3. máy để giờ Việt Nam / có cài tiếng Việt → tiếng Việt (nhiều bạn Việt dùng điện thoại cài tiếng Anh)
  //   4. máy có cài tiếng Thái / Trung / Indonesia → tiếng đó (đúng cả khi dùng VPN)
  //   5. máy chỉ cài tiếng Anh / tiếng khác → đoán theo IP (VN, TH, ID, CN/TW/HK/MO), còn lại tiếng Anh
  function detectLang() {
    let q = '';
    try { q = String(new URLSearchParams(location.search).get('lang') || '').toLowerCase(); } catch (e) { /* bỏ qua */ }
    if (CODES.includes(q)) return q;
    const saved = store(LANG_KEY);
    if (CODES.includes(saved)) return saved;
    const prefs = (navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language || ''])
      .map((x) => String(x).toLowerCase());
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* bỏ qua */ }
    if (/^Asia\/(Ho_Chi_Minh|Saigon)$/.test(tz) || prefs.some((p) => p.startsWith('vi'))) return 'vi';
    for (const p of prefs) {
      const c = p === 'in' || p.startsWith('in-') ? 'id' : p.split('-')[0];   // "in" là mã cũ của tiếng Indonesia
      if (c !== 'en' && CODES.includes(c)) return c;
    }
    try {
      const x = JSON.parse(store(IP_KEY) || 'null');
      if (x && CODES.includes(x.lang) && Date.now() - x.at < 30 * 86400e3) return x.lang;
    } catch (e) { /* bỏ qua */ }
    askIp = true;
    return CODES.includes('en') ? 'en' : CODES[0];
  }
  const LANG = detectLang();

  // Bước 5: hỏi máy chủ (lenamiu-pk, Cloudflare biết nước theo IP; không lưu IP). Trang vừa mở (dưới 4 giây)
  // mà nước đó dùng thứ tiếng khác thì tải lại trang một lần cho đúng tiếng; chậm hơn thì để lần sau dùng.
  if (askIp) {
    const api = String(SITE.statsApi || (SITE.donate || {}).pkApi || '').trim().replace(/\/+$/, '');
    const t0 = Date.now();
    if (api && window.fetch && /^https?:$/.test(location.protocol)) {
      fetch(api + '/geo', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const c = String((d && d.country) || '').toUpperCase();
          if (!/^[A-Z]{2}$/.test(c)) return;
          const want = CODES.includes(COUNTRY_LANG[c]) ? COUNTRY_LANG[c] : CODES.includes('en') ? 'en' : LANG;
          const rec = JSON.stringify({ lang: want, at: Date.now() });
          store(IP_KEY, rec);
          // chỉ tải lại khi đã lưu được (trình duyệt chặn lưu thì tải lại mãi), người xem chưa tự chọn tiếng
          if (want !== LANG && store(IP_KEY) === rec && !store(LANG_KEY) && Date.now() - t0 < 4000) location.reload();
        })
        .catch(() => { /* không hỏi được thì giữ tiếng Anh */ });
    }
  }
  const LOC = (LANGS.find((l) => l.code === LANG) || LANGS[0] || { locale: 'vi-VN' }).locale;
  const HTML_LANG = LANG === 'zh' ? 'zh-Hans' : LANG;
  // Chữ giao diện: thứ tiếng đang chọn → tiếng Anh → tiếng Việt. {biến} được thay bằng giá trị trong vars.
  function t(key, vars) {
    const dict = [I18N[LANG], I18N.en, I18N.vi].find((d) => d && Object.prototype.hasOwnProperty.call(d, key));
    let s = dict ? String(dict[key]) : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
    return s;
  }
  // Ô dịch trong videos.js (vd title_en, note_th, button_zh): có thì dùng, không thì dùng bản tiếng Việt
  function tr(obj, field) {
    if (!obj) return '';
    if (LANG !== 'vi') {
      const v = obj[field + '_' + LANG];
      if (v != null && v !== false && String(v).trim() !== '') return v;
    }
    return obj[field];
  }
  // Chữ cố định trong trang: data-i18n="khoá" (thay chữ), data-i18n-attr="placeholder:khoá,aria-label:khoá"
  function applyI18n(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
    scope.querySelectorAll('[data-i18n-attr]').forEach((n) => {
      n.getAttribute('data-i18n-attr').split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        if (attr && key) n.setAttribute(attr, t(key));
      });
    });
  }
  // Trang Fanfic: truyện viết bằng tiếng Việt nên giữ lang="vi" cho cả trang, chỉ đầu trang theo ngôn ngữ đã chọn
  if (PAGE !== 'fanfic') document.documentElement.lang = HTML_LANG;
  const curLang = LANGS.find((l) => l.code === LANG) || { short: LANG.toUpperCase() };

  /* ================= đầu trang + dải chữ chạy ================= */
  const topHtml =
    '<a class="ticker" id="ticker" href="' + ROOT + '#lumi" hidden>' +
      '<span class="ticker-track" aria-hidden="true"><span class="ticker-item" id="tickerA"></span>' +
      '<span class="ticker-item" id="tickerB"></span></span></a>' +
    '<header class="top wrap" id="siteTop" lang="' + esc(HTML_LANG) + '">' +
      '<a class="brand" href="' + ROOT + '"><img src="' + ROOT + 'favicon.svg" alt="" width="32" height="32">' +
        '<span>LenaMiu <b>Sub</b></span></a>' +
      '<p class="tagline" id="tagline"></p>' +
      '<nav class="top-nav" aria-label="' + esc(t('nav.aria')) + '">' +
        '<a class="top-link" href="' + ROOT + '" data-page="video">' + esc(t('nav.video')) + '</a>' +
        '<a class="top-link" href="' + ROOT + 'fanfic/" data-page="fanfic">' + esc(t('nav.fanfic')) + '</a>' +
        '<button type="button" class="donate-btn" id="donateBtn" hidden><span class="btn-long"></span><span class="btn-short"></span></button>' +
      '</nav>' +
      // nút đổi ngôn ngữ: link thật (?lang=...) để không có JavaScript vẫn bấm được
      '<details class="lang" id="langMenu"><summary aria-label="' + esc(t('lang.aria')) + '">' +
        '<span aria-hidden="true">🌐</span><span class="lang-cur">' + esc(curLang.short) + '</span></summary>' +
        '<ul class="lang-list">' + LANGS.map((l) => '<li><a href="?lang=' + l.code + '" lang="' + l.code + '" hreflang="' + l.code + '"' +
          ' data-lang="' + l.code + '"' + (l.code === LANG ? ' aria-current="true"' : '') + '>' + esc(l.name) + '</a></li>').join('') +
        '</ul></details>' +
      '<div class="top-extra" id="topExtra"></div>' +
    '</header>' +
    (PAGE === 'fanfic' && t('fanfic.note') ? '<p class="lang-note wrap" lang="' + esc(HTML_LANG) + '">' + esc(t('fanfic.note')) + '</p>' : '');
  if (me && me.parentNode && document.readyState === 'loading') me.insertAdjacentHTML('beforebegin', topHtml);
  else document.body.insertAdjacentHTML('afterbegin', topHtml);
  // Trang X của người làm sub (site.socials trong videos.js): { name, x, handle }
  const SOCIALS = (Array.isArray(SITE.socials) ? SITE.socials : [])
    .filter((p) => p && String(p.name || '').trim() && /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,30}\/?$/i.test(String(p.x || '').trim()))
    .map((p) => ({ name: String(p.name).trim(), x: String(p.x).trim(), handle: String(p.x).trim().replace(/\/$/, '').split('/').pop() }));
  const socialLink = (p, text) => {
    const a = el('a', 'social', text);
    a.href = p.x;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'X @' + p.handle;
    return a;
  };
  // Dòng ghi công: tên người làm sub có trang X thì thành link (giữ nguyên chữ của từng thứ tiếng)
  const tagline = tr(SITE, 'tagline') || '';
  let rest = tagline;
  while (rest) {
    let best = null;
    for (const p of SOCIALS) {
      const i = rest.indexOf(p.name);
      if (i >= 0 && (!best || i < best.i)) best = { i, p };
    }
    if (!best) { $('tagline').append(rest); break; }
    $('tagline').append(rest.slice(0, best.i), socialLink(best.p, best.p.name));
    rest = rest.slice(best.i + best.p.name.length);
  }
  $('tagline').hidden = !tagline;
  document.querySelectorAll('#siteTop .top-link').forEach((a) => {
    if (a.dataset.page === PAGE) a.setAttribute('aria-current', 'page');
  });

  // Đổi ngôn ngữ: lưu lựa chọn rồi tải lại trang (giữ nguyên video / chương đang xem trong phần # của link)
  $('langMenu').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-lang]');
    if (!a) return;
    e.preventDefault();
    const code = a.dataset.lang;
    store(LANG_KEY, code);
    if (code === LANG) { $('langMenu').open = false; return; }
    const u = new URL(location.href);
    u.searchParams.set('lang', code);
    location.assign(u.href);
  });
  document.addEventListener('click', (e) => { if ($('langMenu').open && !$('langMenu').contains(e.target)) $('langMenu').open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('langMenu').open) { $('langMenu').open = false; $('langMenu').querySelector('summary').focus(); } });

  /* ================= hộp "Mua sữa tã cho Lumi" ================= */
  document.body.insertAdjacentHTML('beforeend',
    '<dialog class="sheet lm-dd" id="donateDialog" aria-labelledby="dTitle" lang="' + esc(HTML_LANG) + '">' +
    '<form method="dialog" class="sheet-in">' +
      '<div class="sheet-head"><h2 id="dTitle"></h2><button class="icon-btn" value="close" aria-label="' + esc(t('close')) + '">✕</button></div>' +
      '<p class="sheet-sub" id="dText"></p>' +
      '<section class="pk" id="pk" aria-label="' + esc(t('d.pkAria')) + '" hidden>' +
        '<div class="pk-score">' +
          '<span class="pk-side a" id="pkSideA"><b><span class="crown" aria-hidden="true">👑</span>LenaMiu</b><span class="pk-pct" id="pkA">50%</span></span>' +
          '<span class="pk-vs" aria-hidden="true">VS</span>' +
          '<span class="pk-side b" id="pkSideB"><b>MiuLena<span class="crown" aria-hidden="true">👑</span></b><span class="pk-pct" id="pkB">50%</span></span>' +
        '</div>' +
        '<div class="pk-bar" id="pkBar" role="img" aria-label="' + esc(t('pk.tie')) + '">' +
          '<div class="pk-track"><span class="pk-fill a" id="pkFill"></span><span class="pk-fill b"></span></div>' +
          '<span class="pk-spark" id="pkSpark" aria-hidden="true">⚡</span>' +
        '</div>' +
        '<p class="pk-news" id="pkNews" aria-live="polite"></p>' +
      '</section>' +
      // chọn phe: dùng chung cho mã QR và nút PayPal
      '<div id="teamBox" hidden>' +
        '<p class="teams-label" id="teamsLabel"><span class="step-no" aria-hidden="true">1</span>' + esc(t('d.teams')) + '</p>' +
        '<div class="teams" role="group" aria-labelledby="teamsLabel">' +
          '<button type="button" class="team a" data-team="LenaMiu" aria-pressed="false">LenaMiu</button>' +
          '<button type="button" class="team b" data-team="MiuLena" aria-pressed="false">MiuLena</button>' +
        '</div>' +
      '</div>' +
      // người xem tiếng nước ngoài: nút PayPal (site.donate.paypalClientId) hoặc link Ko-fi (intlUrl) thay cho mã QR
      '<div class="intl" id="intlBox" hidden>' +
        '<p class="intl-text" id="intlText"></p>' +
        '<div class="pp" id="ppBox" hidden>' +
          '<p class="pp-label" id="ppAmtLabel"><span class="step-no" aria-hidden="true">2</span>' + esc(t('d.ppAmount')) + '</p>' +
          '<div class="pp-amounts" id="ppAmounts" role="group" aria-labelledby="ppAmtLabel"></div>' +
          '<input class="pp-other" id="ppOther" type="number" min="1" max="500" step="1" inputmode="decimal" hidden' +
            ' aria-label="' + esc(t('d.ppOtherAria')) + '" placeholder="' + esc(t('d.ppOtherAria')) + '">' +
          '<p class="pp-msg" id="ppMsg" aria-live="polite"></p>' +
          '<div class="pp-buttons" id="ppButtons"></div>' +
        '</div>' +
        '<a class="primary intl-go" id="intlGo" target="_blank" rel="noopener"></a>' +
        '<button type="button" class="intl-qr" id="intlQr">' + esc(t('d.showQr')) + '</button>' +
      '</div>' +
      '<div id="qrPart">' +
        (t('d.vnOnly') ? '<p class="qr-tip vn-only">' + esc(t('d.vnOnly')) + '</p>' : '') +
        '<figure class="qr" id="dQrBox"><img id="dQr" alt="' + esc(t('d.qrAlt')) + '"></figure>' +
        '<p class="memo" id="dMemoRow" hidden>' + esc(t('d.memo')) + ' <b id="dMemo"></b>' +
          '<button type="button" class="memo-copy" id="dMemoCopy">' + esc(t('d.copy')) + '</button></p>' +
        '<dl class="acct" id="dAcct"></dl>' +
        '<p class="qr-tip">' + esc(t('d.qrTip')) + '</p>' +
        '<p class="qr-tip" id="pkTip" hidden>' + esc(t('d.pkTip')) + '</p>' +
        '<div class="sheet-actions">' +
          '<button type="button" class="ghost" id="dCopy" hidden>' + esc(t('d.copyAcct')) + '</button>' +
          '<a class="primary" id="dSave" download>' + esc(t('d.saveQr')) + '</a>' +
        '</div>' +
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
  // Mở trang trong máy (localhost) mà có site.donate.paypalSandbox: dùng PayPal thử (tiền giả) + máy chủ PK trong máy.
  // Trang thật (lenamiu.xyz) không bao giờ vào nhánh này.
  const PP_SANDBOX = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && DONATE.paypalSandbox &&
    DONATE.paypalSandbox.clientId ? DONATE.paypalSandbox : null;
  const PK_API = String((PP_SANDBOX && PP_SANDBOX.pkApi) || DONATE.pkApi || '').trim().replace(/\/+$/, '');
  // Nút PayPal cho người ở nước ngoài (chỉ khi xem bằng tiếng nước ngoài): tiền vào được cộng vào phe trên thanh PK
  // (máy chủ PK tạo đơn + thu tiền, xem worker/src/index.js). Có nút PayPal thì không dùng link intlUrl.
  const PP_CLIENT = LANG !== 'vi' && PK_API ? String((PP_SANDBOX && PP_SANDBOX.clientId) || DONATE.paypalClientId || '').trim() : '';
  const PP_AMOUNTS = (Array.isArray(DONATE.paypalAmounts) ? DONATE.paypalAmounts : [3, 5, 10, 20])
    .map(Number).filter((n) => n >= 1 && n <= 500);
  const PP_LOCALE = { en: 'en_US', th: 'th_TH', zh: 'zh_CN', id: 'id_ID' }[LANG] || 'en_US';
  // Link ủng hộ cho người ở nước ngoài (Ko-fi...): chỉ dùng khi đang xem bằng tiếng nước ngoài và chưa có nút PayPal
  const INTL_URL = (() => {
    const u = String(DONATE.intlUrl || '').trim();
    return LANG !== 'vi' && !PP_CLIENT && /^https:\/\/[^\s"<>]+$/i.test(u) ? u : '';
  })();
  const INTL_ON = !!(PP_CLIENT || INTL_URL);
  const INTL_SITE = (() => {
    if (!INTL_URL) return '';
    let host = '';
    try { host = new URL(INTL_URL).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; }
    return /ko-fi\.com$/.test(host) ? 'Ko-fi' : /paypal\.(me|com)$/.test(host) ? 'PayPal'
      : /buymeacoffee\.com$/.test(host) ? 'Buy Me a Coffee' : /patreon\.com$/.test(host) ? 'Patreon' : host;
  })();
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

  const label = String(tr(DONATE, 'button') || '').trim() || 'Ủng hộ';
  const fmtPct = (p) => p.toLocaleString(LOC, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

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
    $('donateBtn').querySelector('.btn-short').textContent = String(tr(DONATE, 'buttonShort') || '').trim() || label;
    $('donateBtn').setAttribute('aria-label', label);
    $('dTitle').textContent = String(tr(DONATE, 'title') || '').trim() || label;
    const dText = tr(DONATE, 'text') || '';
    $('dText').textContent = dText;
    $('dText').hidden = !dText;

    // Đang xem bằng tiếng nước ngoài và có nút PayPal / link Ko-fi: hiện cái đó trước, mã QR ẩn sau một nút bấm
    if (INTL_ON) {
      $('intlBox').hidden = false;
      if (PP_CLIENT) {
        $('intlText').textContent = t('d.ppText');
        $('ppBox').hidden = false;
        $('intlGo').hidden = true;
      } else {
        $('intlText').textContent = t('d.intlText', { site: INTL_SITE });
        $('intlGo').href = INTL_URL;
        $('intlGo').textContent = t('d.intlBtn', { site: INTL_SITE });
      }
      $('qrPart').hidden = true;
      $('intlQr').addEventListener('click', () => {
        $('qrPart').hidden = false;
        $('intlQr').hidden = true;
        if (AUTO_QR) { $('teamBox').hidden = false; preloadTeamQr(); renderQr(); }
      });
    }

    const rows = [[t('d.bank'), DONATE.bank], [t('d.account'), DONATE.account], [t('d.holder'), DONATE.name]]
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
    let ppAmt = PP_AMOUNTS.includes(5) ? 5 : PP_AMOUNTS[0] || 5;   // số tiền PayPal đang chọn (USD); 0 = đang gõ số khác
    let ppRendered = false;   // đã vẽ nút PayPal chưa
    let ppLib = null;         // đang tải thư viện PayPal

    openDonate = () => {
      if (typeof dd.showModal === 'function') { if (!dd.open) dd.showModal(); }
      else window.open(HAS_TEAM_QR ? TEAM_QR[team || TEAMS[0]] : qr, '_blank', 'noopener');
      if (AUTO_QR) { preloadTeamQr(); renderQr(); pkStart(); }
      if (PP_CLIENT) renderPaypal();
    };
    dd.addEventListener('close', pkStop);

    if (AUTO_QR) setupTeams();
    if (PP_CLIENT) setupPaypal();
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

    /* --- nút PayPal (người xem tiếng nước ngoài): chọn phe + số tiền → PayPal → máy chủ PK cộng vào phe --- */
    function ppSay(msg, kind) {
      $('ppMsg').textContent = msg || '';
      $('ppMsg').className = 'pp-msg' + (kind ? ' ' + kind : '');
    }
    function ppAmount() {
      const v = ppAmt || Math.round(Number($('ppOther').value) * 100) / 100;
      return v >= 1 && v <= 500 ? v : 0;
    }
    function setupPaypal() {
      const box = $('ppAmounts');
      const paint = () => box.querySelectorAll('.pp-amt').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === ppAmt)));
      PP_AMOUNTS.forEach((n) => {
        const b = el('button', 'pp-amt', '$' + n);
        b.type = 'button';
        b.dataset.v = String(n);
        box.append(b);
      });
      const other = el('button', 'pp-amt', t('d.ppOther'));
      other.type = 'button';
      other.dataset.v = '0';
      box.append(other);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.pp-amt');
        if (!b) return;
        ppAmt = Number(b.dataset.v);
        $('ppOther').hidden = ppAmt !== 0;
        if (!ppAmt) $('ppOther').focus();
        paint();
        ppSay('');
      });
      paint();
    }
    function loadPaypal() {
      if (window.paypal && window.paypal.Buttons) return Promise.resolve(window.paypal);
      if (!ppLib) {
        ppLib = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(PP_CLIENT) +
            '&currency=USD&intent=capture&components=buttons&locale=' + PP_LOCALE;
          s.onload = () => (window.paypal && window.paypal.Buttons ? resolve(window.paypal) : reject(new Error('paypal')));
          s.onerror = () => { ppLib = null; reject(new Error('paypal')); };
          document.head.append(s);
        });
      }
      return ppLib;
    }
    const ppPost = (path, body) => fetch(PK_API + path, { method: 'POST', body: JSON.stringify(body) })
      .then((r) => r.json().catch(() => ({})));
    // Nút PayPal chỉ tải khi mở hộp donate lần đầu (thư viện PayPal khá nặng)
    function renderPaypal() {
      if (ppRendered) return;
      ppRendered = true;
      ppSay(t('d.ppLoad'));
      loadPaypal().then((pp) => {
        ppSay('');
        return pp.Buttons({
          style: { layout: 'vertical', shape: 'pill', color: 'gold', label: 'paypal', height: 45 },
          onClick: (data, actions) => {
            if (!team) {
              // chưa chọn phe: nhắc ngay trên nút, ô chọn phe rung nhẹ + cuộn tới cho dễ thấy
              ppSay(t('d.ppPick'), 'bad');
              const tb = $('teamBox');
              tb.classList.remove('need');
              void tb.offsetWidth;
              tb.classList.add('need');
              tb.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
              return actions.reject();
            }
            if (!ppAmount()) { ppSay(t('d.ppMin'), 'bad'); return actions.reject(); }
            ppSay('');
            return actions.resolve();
          },
          // máy chủ PK tạo đơn và tự ghi phe vào đơn
          createOrder: () => ppPost('/paypal/order', { team, amount: ppAmount() }).then((d) => {
            if (!d.id) throw new Error('order');
            return d.id;
          }),
          // người xem bấm trả xong → máy chủ thu tiền, cộng vào phe → thanh PK + tung hoa cập nhật ngay
          onApprove: (data) => ppPost('/paypal/capture', { order: data.orderID }).then((d) => {
            if (!d.ok) throw new Error('capture');
            ppSay(t('d.ppThanks', { team: d.team || team }), 'good');
            pkSchedule(0);
          }),
          onCancel: () => ppSay(''),
          onError: () => ppSay(t('d.ppFail'), 'bad')
        }).render('#ppButtons');
      }).catch(() => { ppRendered = false; ppSay(t('d.ppLoadFail'), 'bad'); });
    }

    function setupTeams() {
      // có link Ko-fi (không dùng phe): ô chọn phe ẩn tới khi người xem bấm hiện mã QR
      $('teamBox').hidden = !!INTL_URL;
      $('pk').hidden = !PK_API;
      $('pkTip').hidden = !PK_API;
      team = TEAMS.includes(store(TEAM_KEY)) ? store(TEAM_KEY) : '';   // nhớ phe đã chọn lần trước
      $('teamBox').addEventListener('click', (e) => {
        const b = e.target.closest('.team');
        if (!b) return;
        team = b.dataset.team;
        store(TEAM_KEY, team);
        $('teamBox').classList.remove('need');
        if (PP_CLIENT && $('ppMsg').classList.contains('bad')) ppSay('');   // đã chọn phe: bỏ lời nhắc
        renderQr();
      });
      $('dMemoCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(team); } catch (e) { window.prompt(t('d.copyPrompt'), team); return; }
        $('dMemoCopy').textContent = t('d.copied');
        setTimeout(() => { $('dMemoCopy').textContent = t('d.copy'); }, 2000);
      });
      $('ticker').addEventListener('click', (e) => { e.preventDefault(); openDonate(); });
      showButtons();
      pkSchedule(0);                    // bắt đầu theo dõi PK cho cả trang (dải chữ chạy + tung hoa)
    }

    function renderQr() {
      $('teamBox').querySelectorAll('.team').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.team === team)));
      $('teamBox').classList.toggle('pick', !team);       // chưa chọn phe: làm nổi ô chọn phe
      const box = $('dQrBox');
      $('dMemoRow').hidden = !team;
      $('dSave').hidden = !team;
      if (!team) {
        box.replaceChildren(el('div', 'qr-wait', t('d.pickTeam')));
        return;
      }
      $('dMemo').textContent = team;
      if (HAS_TEAM_QR) {
        const src = TEAM_QR[team];
        const img = el('img');
        img.alt = t('d.qrAltTeam', { team });
        img.addEventListener('error', () => {
          box.replaceChildren(el('div', 'qr-wait', t('d.qrFail')));
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
        svg.setAttribute('aria-label', t('d.qrAltTeam', { team }));
        box.replaceChildren(svg);
        $('dSave').href = qrPng(m, [t('d.memoLine', { team }), [DONATE.bank, account].filter(Boolean).join(' · '),
                                    String(DONATE.name || '')].filter(Boolean));
        $('dSave').setAttribute('download', 'ma-qr-' + team + '.png');
      }).catch(() => {
        box.replaceChildren(el('div', 'qr-wait', t('d.qrLibFail', { team })));
        $('dSave').hidden = true;
      });
    }

    /* --- thanh PK: chỉ hiện %, không hiện số tiền (máy chủ cũng chỉ trả về %) --- */
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
      $('pkBar').setAttribute('aria-label', pa === pb ? t('pk.tie')
        : 'LenaMiu ' + fmtPct(pa) + ', MiuLena ' + fmtPct(pb));

      const recent = Array.isArray(d && d.recent) ? d.recent : [];
      if (fresh.length) {
        const x = fresh[0];
        $('pkNews').setAttribute('aria-live', 'polite');   // chỉ đọc to khi có lượt mới
        $('pkNews').textContent = (x.team === 'LenaMiu' ? '💗 ' : '💜 ') + t('pk.boosted', { team: x.team });
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
        const textNow = last ? lastText(last) : !started ? t('pk.none') : '';
        $('pkNews').setAttribute('aria-live', 'off');     // "N phút trước" đổi liên tục, khỏi đọc to mỗi phút
        if ($('pkNews').textContent !== textNow) $('pkNews').textContent = textNow;
      }
    }

    // Câu báo lượt donate gần nhất, viết như câu nói bình thường. Giờ theo giờ Việt Nam
    // (SePay ghi dạng "2026-11-08 10:21:51"), đúng cả khi máy người xem ở múi giờ khác.
    // fixed = true: luôn ghi giờ cụ thể (dải chữ chạy dùng, để chữ khỏi đổi mỗi phút làm giật)
    function lastText(x, fixed) {
      const icon = x.team === 'LenaMiu' ? '💗 ' : '💜 ';
      const team = x.team;
      const at = new Date(String(x.at || '').replace(' ', 'T') + '+07:00');
      if (isNaN(at)) return icon + t('last.basic', { team });
      const vn = (d) => new Date(d.getTime() + 7 * 3600e3);
      const v = vn(at);
      const two = (n) => String(n).padStart(2, '0');
      const time = two(v.getUTCHours()) + ':' + two(v.getUTCMinutes());
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (!fixed && mins < 1) return icon + t('last.now', { team });
      if (!fixed && mins < 60) return icon + t('last.mins', { team, n: mins });
      const today = v.toISOString().slice(0, 10) === vn(new Date()).toISOString().slice(0, 10);
      if (today) return icon + t('last.today', { team, time });
      // ngày theo giờ Việt Nam, viết theo kiểu của từng thứ tiếng (vd 08/11 · Nov 8 · 11月8日)
      let date = two(v.getUTCDate()) + '/' + two(v.getUTCMonth() + 1);
      if (LANG !== 'vi') {
        try { date = new Intl.DateTimeFormat(LOC, { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' }).format(at); }
        catch (e) { /* trình duyệt cũ: giữ kiểu 08/11 */ }
      }
      return icon + t('last.day', { team, time, date });
    }

    /* --- dải chữ chạy ở trên cùng trang: tỉ lệ PK + lượt donate gần nhất + rủ tiếp sức --- */
    function renderTicker(d) {
      const tk = $('ticker');
      const { pa, pb, started } = pkNums(d);
      const recent = Array.isArray(d && d.recent) ? d.recent : [];
      const parts = [label + ': LenaMiu ' + fmtPct(pa) + ' ⚡ ' + fmtPct(pb) + ' MiuLena'];
      if (recent[0]) parts.push(lastText(recent[0], true));
      if (!started) parts.push(t('tk.start'));
      else if (Math.abs(pa - pb) < 5) parts.push(t('tk.close'));
      else {
        const behind = pa < pb ? 'LenaMiu' : 'MiuLena';
        const icon = behind === 'LenaMiu' ? '💗 ' : '💜 ';
        parts.push(icon + t(Math.abs(pa - pb) < 15 ? 'tk.behind' : 'tk.far', { team: behind }));
      }
      parts.push(t(INTL_ON ? 'tk.ctaIntl' : 'tk.cta'));
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
    function celebrate(team) {
      // Hộp donate đang mở (nằm lớp trên cùng) thì vẽ bên trong hộp, không thì vẽ trên cả trang
      const host = dd.open ? dd : document.body;
      const banner = el('div', 'cele-banner ' + (team === 'LenaMiu' ? 'a' : 'b'),
                        t('cele', { team }) + ' ' + (team === 'LenaMiu' ? '💗' : '💜'));
      banner.setAttribute('role', 'status');
      host.append(banner);
      setTimeout(() => banner.remove(), 5400);
      const tk = $('ticker');
      tk.classList.remove('flash'); void tk.offsetWidth; tk.classList.add('flash');
      if (!reduced) confetti(host, team);
    }

    function confetti(host, team) {
      const t = team;   // (tên ngắn dùng bên dưới; chỉ là tên phe, không phải hàm dịch)
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
      catch (e) { window.prompt(t('d.copyAcctPrompt'), acc); return; }
      btn.textContent = t('d.copied');
      setTimeout(() => { btn.textContent = t('d.copyAcct'); }, 2000);
    });
  })();

  // Chữ cố định trong trang (data-i18n): trang tự gọi LM.applyI18n() sớm; gọi lại lúc tải xong cho chắc
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyI18n());
  else applyI18n();

  // Cho từng trang dùng: mở hộp donate, nhận ra link #lumi, chữ theo ngôn ngữ
  window.LM = { root: ROOT, page: PAGE, openDonate: () => openDonate(), isDonateHash,
                lang: LANG, locale: LOC, langs: LANGS, t, tr, applyI18n, socials: SOCIALS, socialLink };
})();
