-- Cơ sở dữ liệu trang Fanfic LenaMiu (Cloudflare D1).
-- Chạy:  npx wrangler d1 execute lenamiu-fic --local --file schema.sql    (thử trong máy)
--        npx wrangler d1 execute lenamiu-fic --remote --file schema.sql   (trên mạng)

-- Tài khoản. Mật khẩu được trình duyệt băm (PBKDF2) trước khi gửi, máy chủ băm thêm lần nữa có muối:
-- máy chủ không bao giờ thấy mật khẩu thật.
CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY,
  username TEXT    NOT NULL UNIQUE,          -- tên đăng nhập: chữ thường không dấu, số, _ (không đổi được)
  name     TEXT    NOT NULL,                 -- bút danh hiện trên trang (đổi được)
  pass     TEXT    NOT NULL,                 -- muối:mã băm
  role     TEXT    NOT NULL DEFAULT 'user',  -- 'user' (đăng phải chờ duyệt) | 'trusted' (đăng thẳng) | 'admin' (người duyệt)
  banned   INTEGER NOT NULL DEFAULT 0,       -- 1 = bị khoá: không đăng nhập được, truyện + bình luận bị ẩn
  created  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT    PRIMARY KEY,               -- mã băm SHA-256 của mã đăng nhập (mã thật chỉ nằm trong trình duyệt)
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL                   -- hết hạn (mili giây)
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS stories (
  id        INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL,
  title     TEXT    NOT NULL,
  summary   TEXT    NOT NULL DEFAULT '',
  tags      TEXT    NOT NULL DEFAULT '',     -- các thẻ, ngăn bằng dấu |
  rating    TEXT    NOT NULL DEFAULT 'all',  -- 'all' | '13' | '16' | '18'
  done      INTEGER NOT NULL DEFAULT 0,      -- 1 = đã hoàn
  status    TEXT    NOT NULL DEFAULT 'draft',-- 'draft' (chưa gửi) | 'pending' (chờ duyệt lần đầu) | 'published' | 'hidden' (người duyệt ẩn)
  edit_meta TEXT,                            -- (JSON) thông tin truyện đã sửa, đang chờ duyệt — truyện đã đăng của người chưa tin cậy
  note      TEXT    NOT NULL DEFAULT '',     -- lời nhắn của người duyệt (vd lý do từ chối bản sửa)
  reads     INTEGER NOT NULL DEFAULT 0,      -- lượt đọc (1 người / 1 truyện / 1 ngày)
  created   TEXT    NOT NULL,
  updated   TEXT                             -- lần gần nhất có chương mới được đăng
);
CREATE INDEX IF NOT EXISTS stories_author ON stories (author_id);
CREATE INDEX IF NOT EXISTS stories_status ON stories (status, updated);

CREATE TABLE IF NOT EXISTS chapters (
  id          INTEGER PRIMARY KEY,
  story_id    INTEGER NOT NULL,
  n           INTEGER NOT NULL,              -- thứ tự chương trong truyện
  title       TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  words       INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'draft', -- 'draft' | 'pending' | 'published' | 'rejected'
  note        TEXT    NOT NULL DEFAULT '',   -- lý do từ chối
  edit_title  TEXT,                          -- bản sửa của chương ĐÃ ĐĂNG (người chưa tin cậy): người đọc vẫn thấy bản cũ
  edit_body   TEXT,                          --   cho tới khi bản sửa được duyệt
  edit_status TEXT,                          -- NULL | 'pending' | 'rejected'
  hearts      INTEGER NOT NULL DEFAULT 0,
  created     TEXT    NOT NULL,
  updated     TEXT    NOT NULL,
  published   TEXT
);
CREATE INDEX IF NOT EXISTS chapters_story ON chapters (story_id, n);
CREATE INDEX IF NOT EXISTS chapters_status ON chapters (status);

-- Tim: mỗi người (mã người đọc trong trình duyệt) 1 tim / 1 chương
CREATE TABLE IF NOT EXISTS hearts (
  chapter_id INTEGER NOT NULL,
  who        TEXT    NOT NULL,
  PRIMARY KEY (chapter_id, who)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_chapter ON comments (chapter_id, id);

-- Ai đã được tính lượt đọc hôm nay (ngày | mã người đọc | id truyện). Cũ hơn 2 ngày tự xoá.
CREATE TABLE IF NOT EXISTS seen (
  k   TEXT PRIMARY KEY,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_day ON seen (day);

-- Giới hạn số lần (tạo tài khoản, đăng nhập sai, bình luận...) để chặn spam / dò mật khẩu
CREATE TABLE IF NOT EXISTS limits (
  k     TEXT    PRIMARY KEY,
  n     INTEGER NOT NULL,
  until INTEGER NOT NULL                     -- hết thời gian đếm (mili giây)
);
