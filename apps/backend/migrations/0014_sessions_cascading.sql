CREATE TABLE sessions_new
(
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    session_hash TEXT NOT NULL UNIQUE,

    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

INSERT INTO sessions_new (id,
                          user_id,
                          session_hash,
                          created_at,
                          expires_at)
SELECT id,
       user_id,
       session_hash,
       created_at,
       expires_at
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new
    RENAME TO sessions;