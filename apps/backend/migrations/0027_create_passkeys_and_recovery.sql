ALTER TABLE users
    ADD COLUMN webauthn_user_id TEXT;

CREATE UNIQUE INDEX idx_users_webauthn_user_id
    ON users (webauthn_user_id);

ALTER TABLE users
    ADD COLUMN recovery_phrase_hash TEXT;

ALTER TABLE users
    ADD COLUMN recovery_phrase_set_at TEXT;

ALTER TABLE users
    ADD COLUMN recovery_phrase_confirmed_at TEXT;

ALTER TABLE users
    ADD COLUMN secure_account_required INTEGER NOT NULL DEFAULT 0
        CHECK (secure_account_required IN (0, 1));

ALTER TABLE users
    ADD COLUMN secure_account_required_at TEXT;

ALTER TABLE users
    ADD COLUMN secure_account_required_passkey_id TEXT;

ALTER TABLE users
    ADD COLUMN passkey_prompt_seen_at TEXT;

CREATE TABLE user_passkeys
(
    id               TEXT PRIMARY KEY,
    user_id          TEXT    NOT NULL,
    credential_id    TEXT    NOT NULL UNIQUE,
    public_key       TEXT    NOT NULL,
    webauthn_user_id TEXT    NOT NULL,
    counter          INTEGER NOT NULL DEFAULT 0,
    device_type      TEXT    NOT NULL,
    backed_up        INTEGER NOT NULL DEFAULT 0
        CHECK (backed_up IN (0, 1)),
    transports       TEXT,
    name             TEXT,
    created_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at     TEXT,

    FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_user_passkeys_user_id
    ON user_passkeys (user_id);

CREATE TABLE webauthn_challenges
(
    id               TEXT PRIMARY KEY,
    user_id          TEXT,
    email            TEXT,
    username         TEXT,
    webauthn_user_id TEXT,
    ceremony         TEXT NOT NULL
        CHECK (ceremony IN ('registration', 'authentication')),
    challenge        TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webauthn_challenges_expires_at
    ON webauthn_challenges (expires_at);

CREATE INDEX idx_webauthn_challenges_user_id
    ON webauthn_challenges (user_id);
