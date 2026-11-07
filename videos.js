/* ============================================================
   DANH SÁCH VIDEO — thêm video mới chỉ cần sửa file này
   ============================================================
   Mỗi video là một khối { ... }. Video để trên cùng sẽ hiện đầu tiên.

     title        Tên video (bắt buộc)
     youtube      Link YouTube, dán nguyên link là được. Không có thì để ''
     drive        Link Google Drive, dán nguyên link là được. Không có thì để ''
                  (file trên Drive phải bật chia sẻ "Bất kỳ ai có đường liên kết")
     group        Nhóm để lọc, vd 'Pls Love', 'MARCHU'. Không cần thì để ''
     date         Ngày đăng, dạng '2026-11-07'. Không cần thì để ''
     note         Vài dòng ghi chú hiện dưới tên video. Không cần thì để ''
     id           (không bắt buộc) đuôi link riêng của video, vd 'pls-love-ep4'.
                  Bỏ trống thì tự lấy theo tên video — nhưng sửa tên là link
                  cũ hết dùng được, nên video nào hay gửi link thì đặt id luôn.

   Mỗi video cần ít nhất một link. Có cả YouTube lẫn Drive thì người xem bấm đổi
   qua lại được — YouTube bị chặn thì còn Drive.
   (Vẫn nhận thêm dailymotion: '...' nếu sau này cần.)
*/
window.VIETSUB = {

  site: {
    title: 'LenaMiu Vietsub',
    tagline: 'Vietsub bởi dangtthuynhi & Kem Dâu Ngọt · xem trên YouTube hoặc Google Drive',
    footer: 'Vietsub phi lợi nhuận, làm vì thương LenaMiu. Video thuộc về chủ sở hữu gốc.',

    // Chỉ cần nếu có video Dailymotion: Dailymotion Studio → Embeds → Players → tạo player,
    // rồi dán Player ID (dạng 'x1abc') vào đây. Để trống thì video Dailymotion mở qua trang Dailymotion.
    dailymotionPlayerId: ''
  },

  videos: [
    {
      title: 'Pls Love Reaction EP 2',
      youtube: '',
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
    //   drive: 'https://drive.google.com/file/d/xxxxxxxx/view',
    //   group: 'Pls Love',
    //   date: '2026-11-07',
    //   note: ''
    // },
  ]
};
