CREATE TABLE sessions (
                          id TEXT PRIMARY KEY,
                          user_id TEXT NOT NULL,
                          session_hash TEXT NOT NULL UNIQUE,

                          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          expires_at TEXT NOT NULL,

                          FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_user_id
    ON sessions(user_id);

CREATE INDEX idx_sessions_expires_at
    ON sessions(expires_at);