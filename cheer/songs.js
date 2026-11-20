/* ============================================================
   SẢNH CỔ VŨ (lenamiu.xyz/cheer/) — DANH SÁCH BÀI HÁT
   Thêm bài mới chỉ cần sửa file này.
   ============================================================
   Mỗi bài là một khối { ... }. Bài để trên cùng sẽ mở đầu tiên.

     title      Tên bài (bắt buộc). Tên bằng thứ tiếng khác: title_en, title_th, title_zh, title_id
     artist     Người hát, vd 'Lena & Miu'. Không cần thì để ''
     id         (không bắt buộc) đuôi link của bài: lenamiu.xyz/cheer/?song=<id>
                Bỏ trống thì tự lấy theo tên bài.
     bpm        Nhịp bài hát (số phách mỗi phút, vd 120). Đám đông lắc lightstick theo nhịp này.
                Không biết thì để 0: đám đông lắc nhịp chậm, không theo nhạc.
     chart      (không bắt buộc) file nốt cho trò chơi gõ nhịp, nằm trong thư mục cheer/charts/, vd 'ten-bai.json'.
                Tạo từ âm thanh của bài: node tools/make-chart.mjs "D:\nhac\bai.webm" ten-bai
                (lệnh tự đo bpm + anchor và in sẵn các dòng để dán vào đây). Không có thì chỉ cổ vũ tự do.
     hall       Màu đèn sân khấu: 'pink' (hồng), 'red' (đỏ), 'violet' (tím), 'sunset' (cam hoàng hôn), 'ocean' (xanh)
     versions   Các video của bài (sân khấu khác nhau, fancam...), người xem đổi trong ô "Video". Mỗi video:
                  label    tên ngắn, vd 'Fanmeeting Bangkok' (thứ tiếng khác: label_en, label_th, label_zh, label_id)
                  youtube  link YouTube, dán nguyên link            ┐ cần một trong hai
                  video    tên file trên máy chủ riêng (kho R2)      ┘ (giống ô video trong ../videos.js)
                  start    (không bắt buộc) bắt đầu phát từ giây thứ mấy, vd 12
                  anchor   giây có phách số 0 của bài trong video này, vd 3.52 (lệnh make-chart in sẵn).
                           Cần cho trò chơi gõ nhịp (nốt tính từ mốc này). Không có thì đám đông chỉ lắc đúng nhịp, không đúng phách.

   Ví dụ:
     {
       title: 'Tên bài hát', title_en: 'Song title',
       artist: 'Lena & Miu',
       bpm: 120,
       hall: 'pink',
       versions: [
         { label: 'Fanmeeting Bangkok', youtube: 'https://youtu.be/xxxxxxxxxxx' },
         { label: 'Fancam', video: 'ten-file.mp4', start: 5 }
       ]
     },
*/
window.LM_CHEER = {
  songs: [

    {
      title: 'Style',
      artist: 'LenaMiu',
      id: 'style',
      bpm: 100,          // đo từ âm thanh của fancam: đúng 100 BPM, đều suốt bài (bản phối nhanh hơn bản gốc 95 BPM)
      chart: 'style.json',
      hall: 'red',
      versions: [
        { label: 'Kỷ niệm 56 năm Channel 3 · fancam 99.99percent',
          label_en: 'Channel 3 56th anniversary · fancam by 99.99percent',
          label_th: 'มหกรรมฉลองครบรอบ 56 ปี ช่อง 3 · แฟนแคม 99.99percent',
          label_zh: '3台56周年庆典 · 饭拍 99.99percent',
          label_id: 'Perayaan 56 tahun Channel 3 · fancam 99.99percent',
          youtube: 'https://youtu.be/jTpecXqsd5A', anchor: 1.374 }
      ]
    },

  ]
};
