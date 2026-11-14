-- Mỗi dòng = một lượt chuyển khoản có ghi phe LenaMiu / MiuLena.
-- Không lưu tên, số tài khoản người chuyển: chỉ cần phe + số tiền để vẽ thanh PK.
CREATE TABLE IF NOT EXISTS tx (
  id     INTEGER PRIMARY KEY,   -- id giao dịch của SePay (gửi lại cùng giao dịch thì không cộng trùng);
                                -- id âm = số nhập tay, cộng vào tổng nhưng không tính là lượt
  team   TEXT    NOT NULL,      -- 'LenaMiu' hoặc 'MiuLena'
  amount INTEGER NOT NULL,      -- số tiền (VNĐ)
  at     TEXT    NOT NULL       -- thời gian giao dịch theo SePay
);
CREATE INDEX IF NOT EXISTS tx_at ON tx (at);

-- Mỗi dòng = một lượt ủng hộ qua PayPal (người ở nước ngoài), cộng chung vào thanh PK.
-- (Database tạo trước khi có PayPal: chạy thêm file nang-cap-paypal.sql một lần.)
CREATE TABLE IF NOT EXISTS paypal (
  id     TEXT    PRIMARY KEY,   -- mã giao dịch (capture) của PayPal: báo nhiều lần cũng không cộng trùng
  team   TEXT    NOT NULL,      -- 'LenaMiu' hoặc 'MiuLena' (người ủng hộ chọn trên trang, ghi trong đơn PayPal)
  amount INTEGER NOT NULL,      -- quy ra VNĐ theo tỷ giá PAYPAL_VND_PER_USD lúc nhận (để so được với chuyển khoản)
  usd    REAL    NOT NULL,      -- số tiền gốc (USD)
  at     TEXT    NOT NULL       -- giờ Việt Nam "YYYY-MM-DD HH:MM:SS" (giống SePay)
);
CREATE INDEX IF NOT EXISTS paypal_at ON paypal (at);

-- Bộ đếm lượt truy cập ('site') và lượt xem từng video ('v:<id video>')
CREATE TABLE IF NOT EXISTS counters (
  name TEXT    PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0
);
-- Ai đã được đếm hôm nay (để 1 người chỉ tính 1 lượt / ngày). Không lưu IP thật, chỉ lưu mã băm
-- có trộn mã bí mật + ngày, nên không suy ngược ra IP được. Dữ liệu cũ hơn 2 ngày tự xoá.
CREATE TABLE IF NOT EXISTS seen (
  k   TEXT PRIMARY KEY,         -- ngày | mã người xem | tên bộ đếm
  ip  TEXT NOT NULL,            -- mã băm IP (để giới hạn số lượt mỗi mạng mỗi ngày)
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_ip_day ON seen (ip, day);
CREATE INDEX IF NOT EXISTS seen_day ON seen (day);
