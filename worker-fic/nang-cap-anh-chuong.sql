-- Thêm ảnh ngang đầu chương vào database đã tạo từ trước (chỉ chạy MỘT lần; database mới tạo từ schema.sql thì không cần).
--   npx wrangler d1 execute lenamiu-fic --remote --file nang-cap-anh-chuong.sql
ALTER TABLE chapters ADD COLUMN image INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ch_images (
  chapter_id INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  updated    INTEGER NOT NULL,
  data       BLOB    NOT NULL,
  PRIMARY KEY (chapter_id, kind)
);
