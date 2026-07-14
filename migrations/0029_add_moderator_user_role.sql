PRAGMA foreign_keys= off;

DROP TABLE IF EXISTS users_new;

CREATE TABLE users_new
(
    id                                      TEXT PRIMARY KEY,

    email                                   TEXT    NOT NULL UNIQUE,
    username                                TEXT    NOT NULL UNIQUE,
    password_hash                           TEXT    NOT NULL,

    profile_photo_key                       TEXT,
    bio                                     TEXT    NOT NULL DEFAULT '',
    display_nsfw_media                      INTEGER NOT NULL DEFAULT 0,
    role                                    TEXT    NOT NULL DEFAULT 'user'
        CHECK (role IN ('user', 'moderator', 'admin')),

    created_at                              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_version                       TEXT,
    banned_at                               TEXT,
    banned_by_user_id                       TEXT REFERENCES users (id) ON DELETE SET NULL,
    webauthn_user_id                        TEXT,
    recovery_phrase_hash                    TEXT,
    recovery_phrase_set_at                  TEXT,
    recovery_phrase_confirmed_at            TEXT,
    secure_account_required                 INTEGER NOT NULL DEFAULT 0
        CHECK (secure_account_required IN (0, 1)),
    secure_account_required_at              TEXT,
    secure_account_required_passkey_id      TEXT,
    passkey_prompt_seen_at                  TEXT,

    CHECK (length(username) BETWEEN 3 AND 32),
    CHECK (username GLOB '[A-Za-z0-9_]*'),
    CHECK (username NOT GLOB '*[^A-Za-z0-9_]*')
);

INSERT INTO users_new (id,
                       email,
                       username,
                       password_hash,
                       profile_photo_key,
                       bio,
                       display_nsfw_media,
                       role,
                       created_at,
                       last_seen_version,
                       banned_at,
                       banned_by_user_id,
                       webauthn_user_id,
                       recovery_phrase_hash,
                       recovery_phrase_set_at,
                       recovery_phrase_confirmed_at,
                       secure_account_required,
                       secure_account_required_at,
                       secure_account_required_passkey_id,
                       passkey_prompt_seen_at)
SELECT id,
       email,
       username,
       password_hash,
       profile_photo_key,
       bio,
       display_nsfw_media,
       role,
       created_at,
       last_seen_version,
       banned_at,
       banned_by_user_id,
       webauthn_user_id,
       recovery_phrase_hash,
       recovery_phrase_set_at,
       recovery_phrase_confirmed_at,
       secure_account_required,
       secure_account_required_at,
       secure_account_required_passkey_id,
       passkey_prompt_seen_at
FROM users;

DROP TABLE users;

ALTER TABLE users_new
    RENAME TO users;

CREATE INDEX idx_users_email
    ON users (email);

CREATE INDEX idx_users_username
    ON users (username);

CREATE INDEX idx_users_banned_at
    ON users (banned_at);

CREATE UNIQUE INDEX idx_users_webauthn_user_id
    ON users (webauthn_user_id);

PRAGMA foreign_keys= on;
