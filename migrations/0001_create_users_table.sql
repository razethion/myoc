CREATE TABLE users (
                       id TEXT PRIMARY KEY,

                       email TEXT NOT NULL UNIQUE,
                       username TEXT NOT NULL UNIQUE,
                       password_hash TEXT NOT NULL,

                       profile_photo_key TEXT,
                       bio TEXT NOT NULL DEFAULT '',

                       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);