-- Mỗi dòng = một lượt chuyển khoản có ghi phe LenaMiu / MiuLena.
-- Không lưu tên, số tài khoản người chuyển: chỉ cần phe + số tiền để vẽ thanh PK.
CREATE TABLE IF NOT EXISTS tx (
  id     INTEGER PRIMARY KEY,   -- id giao dịch của SePay: gửi lại cùng giao dịch thì không cộng trùng
  team   TEXT    NOT NULL,      -- 'LenaMiu' hoặc 'MiuLena'
  amount INTEGER NOT NULL,      -- số tiền (VNĐ)
  at     TEXT    NOT NULL       -- thời gian giao dịch theo SePay
);
CREATE INDEX IF NOT EXISTS tx_at ON tx (at);
