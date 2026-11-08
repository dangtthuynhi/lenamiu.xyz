-- Thêm ảnh bìa truyện vào database đã tạo từ trước (chỉ chạy MỘT lần; database mới tạo từ schema.sql thì không cần).
--   npx wrangler d1 execute lenamiu-fic --remote --file nang-cap-anh-bia.sql
ALTER TABLE stories ADD COLUMN cover INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS covers (
  story_id INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  type     TEXT    NOT NULL,
  updated  INTEGER NOT NULL,
  data     BLOB    NOT NULL,
  PRIMARY KEY (story_id, kind)
);
