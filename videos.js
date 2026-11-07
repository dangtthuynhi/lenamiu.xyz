/* ============================================================
   DANH SÁCH VIDEO — thêm video mới chỉ cần sửa file này
   ============================================================
   Mỗi video là một khối { ... }. Video để trên cùng sẽ hiện đầu tiên.

     title        Tên video (bắt buộc)
     youtube      Link YouTube, dán nguyên link là được. Không có thì để ''
     dailymotion  Link Dailymotion, dán nguyên link là được. Không có thì để ''
     group        Nhóm để lọc, vd 'Pls Love', 'Hậu trường'. Không cần thì để ''
     date         Ngày đăng, dạng '2026-11-07'. Không cần thì để ''
     note         Vài dòng ghi chú hiện dưới tên video. Không cần thì để ''
     id           (không bắt buộc) đuôi link riêng của video, vd 'pls-love-ep4'.
                  Bỏ trống thì tự lấy theo tên video — nhưng sửa tên là link
                  cũ hết dùng được, nên video nào hay gửi link thì đặt id luôn.

   Mỗi video cần ít nhất một trong hai link youtube / dailymotion.
   Có cả hai thì người xem bấm đổi qua lại được, YouTube bị chặn thì còn Dailymotion.
*/
window.VIETSUB = {

  site: {
    title: 'LenaMiu Vietsub',
    tagline: 'Vietsub bởi dangtthuynhi & Kem Dâu Ngọt · xem trên YouTube hoặc Dailymotion',
    footer: 'Vietsub phi lợi nhuận, làm vì thương LenaMiu. Video thuộc về chủ sở hữu gốc.',

    // Dailymotion chỉ cho phát ngay trên web khi có Player ID. Lấy bằng cách vào
    // Dailymotion Studio → Players → tạo một player, rồi dán Player ID (dạng 'x1abc') vào đây.
    // Để trống thì video Dailymotion sẽ mở qua trang Dailymotion.
    dailymotionPlayerId: ''
  },

  videos: [
    {
      title: 'Pls Love: Dàn cast chơi Imposter',
      youtube: 'https://youtu.be/x0N-N1NYxys',
      dailymotion: '',
      group: 'Pls Love',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'MARCHU EP.228 — March rủ Lena & Miu vào bếp',
      youtube: 'https://youtu.be/NtTOD8Wi_NI',
      dailymotion: '',
      group: 'MARCHU',
      date: '2026-11-07',
      note: ''
    },
    {
      title: 'Khoảnh khắc đặc biệt của tụi mình ở Biarritz',
      youtube: '',
      dailymotion: 'https://dai.ly/xbuiali',
      group: 'Vlog',
      date: '2026-11-07',
      note: ''
    },

    // Chép khối dưới đây, xoá dấu // ở đầu mỗi dòng rồi sửa:
    // {
    //   title: 'Pls Love EP4',
    //   youtube: 'https://youtu.be/xxxxxxxxxxx',
    //   dailymotion: 'https://www.dailymotion.com/video/xxxxxxx',
    //   group: 'Pls Love',
    //   date: '2026-11-07',
    //   note: ''
    // },
  ]
};
