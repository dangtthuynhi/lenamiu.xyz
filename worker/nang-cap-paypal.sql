-- Thêm bảng PayPal vào database thanh PK đã tạo từ trước (chạy MỘT lần; database mới tạo từ schema.sql thì không cần).
--   npx wrangler d1 execute lenamiu-pk --remote --file nang-cap-paypal.sql
CREATE TABLE IF NOT EXISTS paypal (
  id     TEXT    PRIMARY KEY,
  team   TEXT    NOT NULL,
  amount INTEGER NOT NULL,
  usd    REAL    NOT NULL,
  at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS paypal_at ON paypal (at);
