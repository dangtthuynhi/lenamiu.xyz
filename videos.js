/* ============================================================
   DANH SÁCH VIDEO — thêm video mới chỉ cần sửa file này
   ============================================================
   Mỗi video là một khối { ... }. Video để trên cùng sẽ hiện đầu tiên.

     title        Tên video (bắt buộc)
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

   Mỗi video cần ít nhất một link. Có nhiều link thì người xem bấm đổi qua lại được,
   trang tự chọn theo thứ tự YouTube → Odysee → Drive.
   (Vẫn nhận thêm dailymotion: '...' nếu sau này cần.)
*/
window.VIETSUB = {

  site: {
    title: 'LenaMiu Vietsub',
    tagline: 'Vietsub bởi dangtthuynhi & Kem Dâu Ngọt',
    footer: 'Vietsub phi lợi nhuận, làm vì thương LenaMiu. Video thuộc về chủ sở hữu gốc.',

    // Chỉ cần nếu có video Dailymotion: Dailymotion Studio → Embeds → Players → tạo player,
    // rồi dán Player ID (dạng 'x1abc') vào đây. Để trống thì video Dailymotion mở qua trang Dailymotion.
    dailymotionPlayerId: '',

    // Nút mở hộp mã QR (ở đầu trang + chân trang).
    //   button       chữ trên nút
    //   buttonShort  chữ trên nút khi xem bằng điện thoại (màn hình hẹp), nên ngắn
    //   qr           ảnh mã QR hiện trong hộp (nên là ảnh chỉ có mã QR, để mã to dễ quét)
    //   save         ảnh tải về khi bấm "Lưu ảnh QR". Bỏ trống thì tải ảnh qr.
    //   title, text  tiêu đề + dòng chữ trong hộp. text không cần thì để ''
    //   bank, account, name  ngân hàng / số tài khoản / tên chủ tài khoản
    //   pkApi        địa chỉ máy chủ thanh PK LenaMiu vs MiuLena (Cloudflare Worker, xem thư mục worker/).
    //                Có pkApi + bank là ngân hàng (MB, ACB, Vietcombank...) + account thì trang tự tạo
    //                mã QR kèm nội dung theo phe người xem chọn, và hiện thanh PK. Để trống thì dùng ảnh qr.
    //   bankBin      (hiếm khi cần) mã ngân hàng VietQR, khi ngân hàng không có trong danh sách của trang
    // Để qr và pkApi trống thì nút tự ẩn.
    // Gửi link https://lenamiu.xyz/#lumi là người nhận thấy hộp QR luôn.
    donate: {
      button: '🍼 Dự án nuôi Lumi',
      buttonShort: '🍼 Nuôi Lumi',
      qr: 'donate-qr.png',
      save: '',
      title: 'Mua sữa tã cho Lumi 🍼',
      text: '',
      bank: 'MoMo',
      account: 'PSG2631213500000002',
      name: 'DANG THI THUY NHI',
      pkApi: ''
    },

    // Nút "Đăng lên X": mỗi lần bấm chọn ngẫu nhiên 1 mẫu dưới đây để viết sẵn bài đăng.
    //   {title} = tên video   {group} = nhóm   {link} = link tới đúng video   {hashtags} = hashtag
    //   \n = xuống dòng. Mẫu có {group} chỉ dùng cho video có nhóm.
    // Muốn thêm câu thì chép 1 dòng '...', rồi sửa chữ bên trong.
    share: {
      hashtags: '#LenaMiu #ลีน่าหมิว',
      templates: [
        'Vietsub LenaMiu mới nè 🩷\n{title}\n👉 {link}\n\n{hashtags}',
        'Ai chưa xem thì xem liền nha 🥹\n[Vietsub] LenaMiu | {title}\n{link}\n\n{hashtags}',
        'Lena với Miu lại làm tim mình rung rinh nữa rồi 💗\n{title} (có vietsub)\n{link}\n\n{hashtags}',
        'Đã có vietsub: {title} ✨\nXem tại 👉 {link}\n\n{hashtags}',
        'Xem LenaMiu mà cười không ngậm được miệng 😭🩷\n[Vietsub] {title}\n{link}\n\n{hashtags}',
        'Thêm một video {group} có vietsub nè 🩷\n{title}\n👉 {link}\n\n{hashtags}'
      ]
    }
  },

  videos: [
    {
      title: 'Khoảnh khắc đặc biệt của tụi mình ở Biarritz',
      youtube: '',
      odysee: 'https://odysee.com/LenaMiu-Biarritz-(Vietsub):c4c77f27387570b5353b3ebb2d864631586f760f',
      drive: '',
      group: 'Vlog',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'Pls Love Reaction EP 2',
      youtube: '',
      odysee: 'https://odysee.com/PLS-Love-Reaction-EP.2-(Vietsub):f0ba0e0126dd0a6658d00f57afed7503a3b2623f',
      drive: 'https://drive.google.com/file/d/1azHXoRmIEKz26vlqoA57jroFKLPtGxMc/view?usp=sharing',
      group: 'Pls Love',
      date: '',
      note: ''
    },
    {
      title: 'Pls Love: Dàn cast chơi Imposter',
      youtube: 'https://youtu.be/x0N-N1NYxys',
      drive: '',
      group: 'Pls Love',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'MARCHU EP.228 — March rủ Lena & Miu vào bếp',
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
