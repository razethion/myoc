ALTER TABLE users
    ADD COLUMN banned_at TEXT;

ALTER TABLE users
    ADD COLUMN banned_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_users_banned_at
    ON users (banned_at);
