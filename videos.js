/* ============================================================
   DANH SÁCH VIDEO — thêm video mới chỉ cần sửa file này
   ============================================================
   Mỗi video là một khối { ... }. Video để trên cùng sẽ hiện đầu tiên.

     title        Tên video (bắt buộc)
     video        Tên file video trên máy chủ riêng (kho Cloudflare R2), vd 'pls-love-ep2.mp4'.
                  Up video bằng lệnh: node tools/up-video.mjs "đường-dẫn-video.mp4"
                  (lệnh in sẵn dòng video: '...' để dán vào đây). Nhanh nhất, iPhone xem mượt nhất.
     youtube      Link YouTube, dán nguyên link là được. Không có thì để ''
     odysee       Link Odysee (odysee.com/...), dán nguyên link là được. Không có thì để ''
     drive        Link Google Drive, dán nguyên link là được. Không có thì để ''
                  (file trên Drive phải bật chia sẻ "Bất kỳ ai có đường liên kết";
                  trên iPhone trình phát Drive hay lỗi, nên có Odysee/YouTube thì tốt hơn)
     group        Nhóm để lọc, vd 'Pls Love', 'MARCHU'. Không cần thì để ''
     date         Ngày đăng, dạng '2026-11-07'. Không cần thì để ''
     note         Vài dòng ghi chú hiện dưới tên video. Không cần thì để ''
     hashtags     (không bắt buộc) hashtag riêng của video khi bấm "Đăng lên X", vd '#PlsLove'.
                  Hashtag chung cho mọi video thì sửa ở site.share bên dưới.
     id           (không bắt buộc) đuôi link riêng của video, vd 'pls-love-ep4'.
                  Bỏ trống thì tự lấy theo tên video — nhưng sửa tên là link
                  cũ hết dùng được, nên video nào hay gửi link thì đặt id luôn.
     subs         (không bắt buộc) phụ đề nhiều thứ tiếng để người xem tự chọn (thanh "💬 Phụ đề" dưới video):
                    subs: { vi: 'eat-trip-ship.vi.vtt', en: 'eat-trip-ship.en.vtt', th: 'eat-trip-ship.th.vtt' },
                  Tạo file bằng lệnh (nhận .ass của Aegisub, .srt, .vtt; lệnh in sẵn dòng subs để dán vào đây):
                    node tools/sub-to-vtt.mjs eat-trip-ship vi="D:\sub\vi.ass" en="D:\sub\en.srt"
                  Chỉ dùng với ô video (máy chủ riêng), và video đó phải là bản RAW không dính sub.
                  Video đã in cứng Vietsub thì đừng thêm ô này (sub sẽ chồng lên chữ trong hình).

   Mỗi video cần ít nhất một link. Có nhiều link thì người xem bấm đổi qua lại được,
   trang tự chọn theo thứ tự video (máy chủ riêng) → YouTube → Odysee → Drive.
   (Vẫn nhận thêm dailymotion: '...' nếu sau này cần.)

   ĐA NGÔN NGỮ (không bắt buộc): trang có 5 thứ tiếng, người xem đổi bằng nút 🌐 ở đầu trang.
     Muốn tên / ghi chú video hiện bằng thứ tiếng khác thì thêm ô cùng tên + đuôi mã tiếng:
       title_en  tiếng Anh      title_th  tiếng Thái      title_zh  tiếng Trung      title_id  tiếng Indonesia
       (note_en, note_th... cũng vậy)
     Ô nào bỏ trống hoặc không có thì trang hiện bản tiếng Việt. Chữ trên nút, thông báo...: sửa ở i18n.js.
*/
window.VIETSUB = {

  site: {
    title: 'LenaMiu Sub',
    tagline: 'Sub bởi dangtthuynhi & Kem Dâu Ngọt',
    tagline_en: 'Subs by dangtthuynhi & Kem Dâu Ngọt',
    tagline_th: 'ซับโดย dangtthuynhi & Kem Dâu Ngọt',
    tagline_zh: '字幕：dangtthuynhi & Kem Dâu Ngọt',
    tagline_id: 'Subtitle oleh dangtthuynhi & Kem Dâu Ngọt',
    footer: 'Sub phi lợi nhuận, làm vì thương LenaMiu. Video thuộc về chủ sở hữu gốc.',
    footer_en: 'Non-profit fansubs, made with love for LenaMiu. All videos belong to their original owners.',
    footer_th: 'ซับไตเติลแบบไม่แสวงหากำไร ทำด้วยความรักต่อ LenaMiu วิดีโอทั้งหมดเป็นของเจ้าของต้นฉบับ',
    footer_zh: '非营利字幕，因为喜欢 LenaMiu 而制作。视频版权归原作者所有。',
    footer_id: 'Subtitle nirlaba, dibuat dengan cinta untuk LenaMiu. Semua video milik pemilik aslinya.',

    // Trang X của người làm sub: tên nào có trong dòng ghi công (tagline) ở đầu trang thì tự thành link,
    // và hiện thêm ở chân trang video (cạnh link YouTube). name phải viết giống hệt trong tagline.
    socials: [
      { name: 'dangtthuynhi', x: 'https://x.com/dangtthuynhi' },
      { name: 'Kem Dâu Ngọt', x: 'https://x.com/kemdaungot02' }
    ],

    // Tên nhóm (ô group của video) bằng thứ tiếng khác. Nhóm là tên riêng (Pls Love, MARCHU...) thì khỏi dịch.
    groupNames: {
      'Phỏng vấn': { en: 'Interviews', th: 'สัมภาษณ์', zh: '采访', id: 'Wawancara' }
    },

    // Chỉ cần nếu có video Dailymotion: Dailymotion Studio → Embeds → Players → tạo player,
    // rồi dán Player ID (dạng 'x1abc') vào đây. Để trống thì video Dailymotion mở qua trang Dailymotion.
    dailymotionPlayerId: '',

    // Máy chủ phát video riêng (Cloudflare Worker + kho R2, xem thư mục worker-video/)
    videoBase: 'https://lenamiu-video.dangthithuynhi2000.workers.dev/',

    // Máy chủ đếm lượt truy cập + lượt xem (dùng chung máy chủ thanh PK, thư mục worker/).
    // Để trống thì không đếm, không hiện số.
    statsApi: 'https://lenamiu-pk.dangthithuynhi2000.workers.dev',

    // Nút mở hộp mã QR (ở đầu trang + chân trang).
    //   button       chữ trên nút
    //   buttonShort  chữ trên nút khi xem bằng điện thoại (màn hình hẹp), nên ngắn
    //   title, text  tiêu đề + dòng chữ trong hộp. text không cần thì để ''
    //   teamQr       ảnh mã QR làm sẵn cho từng phe (tạo trên SePay, nội dung CK là LenaMiu / MiuLena).
    //                Người xem chọn phe nào thì hiện ảnh phe đó.
    //   pkApi        địa chỉ máy chủ thanh PK (Cloudflare Worker, xem thư mục worker/). Để trống thì ẩn thanh PK.
    //   bank, account, name  ngân hàng / số tài khoản / tên chủ tài khoản, hiện thành chữ dưới mã QR.
    //                account để trống thì không hiện số tài khoản (ảnh QR của SePay đã che bớt số).
    //   qr, save     (cách cũ) một ảnh QR chung cho mọi người, dùng khi không có teamQr.
    //   bankBin      (hiếm khi cần) mã ngân hàng VietQR, chỉ dùng khi trang tự tạo mã QR từ account.
    //   paypalClientId  Client ID của app PayPal (developer.paypal.com, công khai — không phải Secret).
    //                Người xem bằng tiếng nước ngoài thấy nút PayPal: chọn phe + số tiền, tiền vào được cộng vào thanh PK.
    //                Phải khớp PAYPAL_CLIENT_ID của máy chủ PK (worker/wrangler.toml). Để trống thì không có nút PayPal.
    //   paypalAmounts   các mức tiền gợi ý (USD), vd [3, 5, 10, 20]; người xem vẫn gõ được số khác (1–500)
    //   intlUrl      (khi chưa có nút PayPal) link ủng hộ cho người ở nước ngoài, vd Ko-fi https://ko-fi.com/...
    //                Người xem bằng tiếng nước ngoài sẽ thấy nút mở link này, mã QR ẩn sau nút "có tài khoản ngân hàng VN".
    //                Không có cả hai thì họ vẫn thấy mã QR, kèm ghi chú chỉ quét được bằng app ngân hàng / ví Việt Nam.
    //   button_en, title_th...  chữ trên nút / tiêu đề bằng thứ tiếng khác (như ô title_en của video)
    // Gửi link https://lenamiu.xyz/#lumi là người nhận thấy hộp QR luôn.
    donate: {
      button: '🍼 Dự án nuôi Lumi',
      button_en: '🍼 Project Lumi',
      button_th: '🍼 โปรเจกต์เลี้ยงลูมิ',
      button_zh: '🍼 养育 Lumi 计划',
      button_id: '🍼 Proyek Lumi',
      buttonShort: '🍼 Nuôi Lumi',
      buttonShort_en: '🍼 Lumi',
      buttonShort_th: '🍼 ลูมิ',
      buttonShort_zh: '🍼 养 Lumi',
      buttonShort_id: '🍼 Lumi',
      title: 'Mua sữa tã cho Lumi 🍼',
      title_en: 'Buy milk & diapers for Lumi 🍼',
      title_th: 'ซื้อนมและผ้าอ้อมให้ลูมิ 🍼',
      title_zh: '给 Lumi 买奶粉和尿布 🍼',
      title_id: 'Belikan susu & popok untuk Lumi 🍼',
      text: '',
      paypalClientId: 'BAA8PTre52a28ZAJ10Wxcvv_EOPCGHg7Dk4QQuv6JcEy_iNt4lB5gsKNt67_3vrt3RjlvPxKBSSTiElnJU',
      paypalAmounts: [3, 5, 10, 20],
      // Thử PayPal bằng tiền giả (Sandbox): CHỈ dùng khi mở trang trong máy (localhost / 127.0.0.1),
      // trang lenamiu.xyz thật không bao giờ dùng. pkApi = máy chủ PK chạy trong máy (cd worker && npx wrangler dev --port 8790).
      paypalSandbox: {
        clientId: 'BAAF84AvKOuzKf26mrB-k_oIvKfqRt6Tu8QjoGy_9HTqNUkwwXZ-zez6yaTOESXJqXaRm5ljrKQI_sJRsE',
        pkApi: 'http://127.0.0.1:8790'
      },
      intlUrl: '',
      teamQr: {
        LenaMiu: 'qr-lenamiu.png',
        MiuLena: 'qr-miulena.png'
      },
      pkApi: 'https://lenamiu-pk.dangthithuynhi2000.workers.dev',
      bank: 'BIDV',
      account: '',
      name: 'DANG THI THUY NHI',
      qr: '',
      save: ''
    },

    // Nút "Đăng lên X": mỗi lần bấm chọn ngẫu nhiên 1 mẫu dưới đây để viết sẵn bài đăng.
    //   {title} = tên video   {group} = nhóm   {link} = link tới đúng video   {hashtags} = hashtag
    //   \n = xuống dòng. Mẫu có {group} chỉ dùng cho video có nhóm.
    // Muốn thêm câu thì chép 1 dòng '...', rồi sửa chữ bên trong.
    // templates_en, templates_th...: mẫu câu cho người xem bằng thứ tiếng đó (link tự kèm ?lang= cho đúng tiếng).
    share: {
      hashtags: '#LenaMiu #ลีน่าหมิว',
      templates: [
        'Vietsub LenaMiu mới nè 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        'Ai chưa xem thì xem liền nha 🥹\n[Vietsub] LenaMiu | {title}\n{link}\n\n{hashtags}',
        'Lena với Miu lại làm tim mình rung rinh nữa rồi 💗\n{title} (có vietsub)\n{link}\n\n{hashtags}',
        'Đã có vietsub: {title} ✨\nXem tại 👉 {link}\n\n{hashtags}',
        'Xem LenaMiu mà cười không ngậm được miệng 😭🩷\n[Vietsub] {title}\n{link}\n\n{hashtags}',
        'Thêm một video {group} có vietsub nè 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ],
      templates_en: [
        'New LenaMiu video 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        'Haven’t watched this yet? Go go go 🥹\nLenaMiu | {title}\n{link}\n\n{hashtags}',
        'Lena and Miu made my heart flutter again 💗\n{title}\n{link}\n\n{hashtags}',
        'Another {group} video 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ],
      templates_th: [
        'วิดีโอ LenaMiu มาใหม่ 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        'ใครยังไม่ได้ดู รีบไปดูเลย 🥹\nLenaMiu | {title}\n{link}\n\n{hashtags}',
        'ลีน่ากับหมิวทำใจเต้นอีกแล้ว 💗\n{title}\n{link}\n\n{hashtags}',
        'วิดีโอ {group} มาอีกแล้ว 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ],
      templates_zh: [
        'LenaMiu 新视频来啦 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        '还没看的快去看 🥹\nLenaMiu | {title}\n{link}\n\n{hashtags}',
        'Lena 和 Miu 又让我心动了 💗\n{title}\n{link}\n\n{hashtags}',
        '又一个 {group} 视频 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ],
      templates_id: [
        'Video LenaMiu baru nih 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        'Yang belum nonton, buruan tonton 🥹\nLenaMiu | {title}\n{link}\n\n{hashtags}',
        'Lena dan Miu bikin deg-degan lagi 💗\n{title}\n{link}\n\n{hashtags}',
        'Satu lagi video {group} 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ]
    }
  },

  videos: [
    {
      title: 'Vogue Exclusive – Phỏng vấn Lena & Miu: hậu trường bìa Vogue cùng CHANEL',
      title_en: 'Vogue Exclusive – Lena & Miu interview: behind their CHANEL Vogue cover',
      title_th: 'Vogue Exclusive – สัมภาษณ์พิเศษ ลีน่า-หมิว กับเบื้องหลังปกโว้กในลุค CHANEL',
      title_zh: 'Vogue Exclusive – Lena & Miu 专访：CHANEL 造型 Vogue 封面幕后',
      title_id: 'Vogue Exclusive – Wawancara Lena & Miu: di balik sampul Vogue bersama CHANEL',
      id: 'vogue-exclusive',
      video: 'lenamiu-vogue-exclusive.mp4',
      subs: { vi: 'vogue-exclusive.vi.vtt', en: 'vogue-exclusive.en.vtt', th: 'vogue-exclusive.th.vtt', zh: 'vogue-exclusive.zh.vtt', id: 'vogue-exclusive.id.vtt' },
      youtube: '',
      drive: '',
      group: 'Phỏng vấn',
      date: '2026-11-14',
      note: ''
    },
    {
      title: 'Yriety – Phỏng vấn độc quyền Lena & Miu: chuyện đáng yêu của hai đứa',
      title_en: 'Yriety – Exclusive interview with Lena & Miu: the cutest stories of the two',
      title_th: 'Yriety – สัมภาษณ์พิเศษ Lena & Miu: เรื่องน่ารัก ๆ ของสองคนนี้',
      title_zh: 'Yriety – Lena & Miu 独家专访：两人的可爱小故事',
      title_id: 'Yriety – Wawancara eksklusif Lena & Miu: cerita manis mereka berdua',
      id: 'yriety-interview',
      video: 'lenamiu-yriety-interview.mp4',
      youtube: '',
      drive: '',
      group: 'Phỏng vấn',
      date: '2026-11-12',
      note: ''
    },
    {
      title: 'Pls Love Reaction EP 3',
      id: 'pls-love-reaction-ep-3',
      video: 'pls-love-reaction-ep-3.mp4',
      youtube: '',
      drive: '',
      group: 'Pls Love',
      date: '2026-11-12',
      note: ''
    },
    {
      title: 'Lena đã thì thầm gì trong clip hậu trường?? – Phỏng vấn LenaMiu (Fesicuro)',
      title_en: 'What did Lena whisper in the behind-the-scenes clip?? – LenaMiu interview (Fesicuro)',
      title_th: 'Lena กระซิบอะไรในคลิปเบื้องหลัง?? – สัมภาษณ์ LenaMiu (Fesicuro)',
      title_zh: 'Lena 在幕后花絮里悄悄说了什么？？– LenaMiu 专访（Fesicuro）',
      title_id: 'Apa yang dibisikkan Lena di klip behind the scenes?? – Wawancara LenaMiu (Fesicuro)',
      id: 'fesicuro-phong-van',
      video: 'lenamiu-fesicuro-interview.mp4',
      youtube: '',
      drive: '',
      group: 'Phỏng vấn',
      date: '2026-11-11',
      note: ''
    },
    {
      title: 'Tee Tai Krua – Bật mí: Lena & Miu lần nào cũng tập hôn trước?!',
      title_en: 'Tee Tai Krua – Revealed: Lena & Miu always rehearse the kiss scenes first?!',
      title_th: 'Tee Tai Krua – เปิดใจ: Lena & Miu ซ้อมฉากจูบก่อนทุกครั้ง?!',
      title_zh: 'Tee Tai Krua – 揭秘：Lena & Miu 每次都会先排练吻戏？！',
      title_id: 'Tee Tai Krua – Terungkap: Lena & Miu selalu latihan adegan ciuman dulu?!',
      id: 'tee-tai-krua',
      video: 'lenamiu-tee-tai-krua.mp4',
      youtube: '',
      drive: '',
      group: 'Tee Tai Krua',
      date: '2026-11-11',
      note: ''
    },
    {
      title: 'PODKAZZ EP.24 – Lena & Miu: May mắn khi có partner tốt',
      title_en: 'PODKAZZ EP.24 – Lena & Miu: Lucky to have a great partner',
      title_th: 'PODKAZZ EP.24 – Lena & Miu: โชคดีที่มีพาร์ทเนอร์ที่ดี',
      title_zh: 'PODKAZZ EP.24 – Lena & Miu：很幸运有个好搭档',
      title_id: 'PODKAZZ EP.24 – Lena & Miu: Beruntung punya partner yang baik',
      id: 'podkazz-ep-24',
      video: 'podkazz-ep-24.mp4',
      youtube: '',
      drive: '',
      group: 'PODKAZZ',
      date: '2026-11-09',
      note: ''
    },
    {
      title: 'Eat Trip Ship – Lena & Miu hẹn hò ở Siam Square',
      title_en: 'Eat Trip Ship – Lena & Miu on a date at Siam Square',
      title_th: 'Eat Trip Ship – Lena & Miu เดตกันที่สยามสแควร์',
      title_zh: 'Eat Trip Ship – Lena & Miu 在暹罗广场约会',
      title_id: 'Eat Trip Ship – Lena & Miu kencan di Siam Square',
      id: 'eat-trip-ship',
      video: 'lenamiu-eat-trip-ship.mp4',
      youtube: '',
      drive: '',
      group: 'Vlog',
      date: '2026-11-08',
      note: ''
    },
    {
      title: 'Katanyu Tonight – Part 2',
      video: 'katanyu-tonight-part-2.mp4',
      youtube: '',
      drive: '',
      group: 'Katanyu Tonight',
      date: '2026-11-08',
      note: ''
    },
    {
      title: 'Katanyu Tonight – Part 1',
      video: 'katanyu-tonight-part-1.mp4',
      youtube: '',
      drive: '',
      group: 'Katanyu Tonight',
      date: '2026-11-08',
      note: ''
    },
    {
      title: 'Khoảnh khắc đặc biệt của tụi mình ở Biarritz',
      title_en: 'Our special moments in Biarritz',
      title_th: 'ช่วงเวลาพิเศษของพวกเราที่บีอาร์ริตซ์',
      title_zh: '我们在比亚里茨的特别时刻',
      title_id: 'Momen spesial kami di Biarritz',
      video: 'lenamiu-biarritz.mp4',
      youtube: '',
      odysee: 'https://odysee.com/LenaMiu-Biarritz-(Vietsub):c4c77f27387570b5353b3ebb2d864631586f760f',
      drive: '',
      group: 'Vlog',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'Pls Love Reaction EP 2',
      video: 'pls-love-reaction-ep-2.mp4',
      youtube: '',
      odysee: 'https://odysee.com/PLS-Love-Reaction-EP.2-(Vietsub):f0ba0e0126dd0a6658d00f57afed7503a3b2623f',
      drive: 'https://drive.google.com/file/d/1azHXoRmIEKz26vlqoA57jroFKLPtGxMc/view?usp=sharing',
      group: 'Pls Love',
      date: '',
      note: ''
    },
    {
      title: 'Pls Love: Dàn cast chơi Imposter',
      title_en: 'Pls Love: The cast plays Imposter',
      title_th: 'Pls Love: นักแสดงเล่นเกม Imposter',
      title_zh: 'Pls Love：演员们玩 Imposter 游戏',
      title_id: 'Pls Love: Para pemain main Imposter',
      youtube: 'https://youtu.be/x0N-N1NYxys',
      drive: '',
      group: 'Pls Love',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'MARCHU EP.228 — March rủ Lena & Miu vào bếp',
      title_en: 'MARCHU EP.228 — March invites Lena & Miu into the kitchen',
      title_th: 'MARCHU EP.228 — March ชวน Lena & Miu เข้าครัว',
      title_zh: 'MARCHU EP.228 — March 邀请 Lena & Miu 一起下厨',
      title_id: 'MARCHU EP.228 — March mengajak Lena & Miu masak bareng',
      youtube: 'https://youtu.be/NtTOD8Wi_NI',
      drive: '',
      group: 'MARCHU',
      date: '2026-11-07',
      note: ''
    },

    // Chép khối dưới đây, xoá dấu // ở đầu mỗi dòng rồi sửa:
    // {
    //   title: 'Pls Love Reaction EP 3',
    //   youtube: 'https://youtu.be/xxxxxxxxxxx',
    //   odysee: 'https://odysee.com/ten-video:x',
    //   drive: 'https://drive.google.com/file/d/xxxxxxxx/view',
    //   group: 'Pls Love',
    //   date: '2026-11-07',
    //   note: ''
    // },
  ]
};
