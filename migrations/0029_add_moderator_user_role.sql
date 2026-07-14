PRAGMA foreign_keys= off;

DROP TABLE IF EXISTS users_new;
DROP TABLE IF EXISTS __migration_0029_sessions_backup;
DROP TABLE IF EXISTS __migration_0029_user_social_links_backup;
DROP TABLE IF EXISTS __migration_0029_character_folders_backup;
DROP TABLE IF EXISTS __migration_0029_characters_backup;
DROP TABLE IF EXISTS __migration_0029_character_media_backup;
DROP TABLE IF EXISTS __migration_0029_character_gallery_tabs_backup;
DROP TABLE IF EXISTS __migration_0029_character_gallery_rows_backup;
DROP TABLE IF EXISTS __migration_0029_character_gallery_row_media_backup;
DROP TABLE IF EXISTS __migration_0029_character_media_review_events_backup;
DROP TABLE IF EXISTS __migration_0029_toyhouse_import_jobs_backup;
DROP TABLE IF EXISTS __migration_0029_toyhouse_import_items_backup;
DROP TABLE IF EXISTS __migration_0029_character_folder_placements_backup;
DROP TABLE IF EXISTS __migration_0029_user_passkeys_backup;
DROP TABLE IF EXISTS __migration_0029_webauthn_challenges_backup;
DROP TABLE IF EXISTS __migration_0029_admin_job_runs_backup;

CREATE TABLE __migration_0029_sessions_backup AS
SELECT *
FROM sessions;

CREATE TABLE __migration_0029_user_social_links_backup AS
SELECT *
FROM user_social_links;

CREATE TABLE __migration_0029_character_folders_backup AS
SELECT *
FROM character_folders;

CREATE TABLE __migration_0029_characters_backup AS
SELECT *
FROM characters;

CREATE TABLE __migration_0029_character_media_backup AS
SELECT *
FROM character_media;

CREATE TABLE __migration_0029_character_gallery_tabs_backup AS
SELECT *
FROM character_gallery_tabs;

CREATE TABLE __migration_0029_character_gallery_rows_backup AS
SELECT *
FROM character_gallery_rows;

CREATE TABLE __migration_0029_character_gallery_row_media_backup AS
SELECT *
FROM character_gallery_row_media;

CREATE TABLE __migration_0029_character_media_review_events_backup AS
SELECT *
FROM character_media_review_events;

CREATE TABLE __migration_0029_toyhouse_import_jobs_backup AS
SELECT *
FROM toyhouse_import_jobs;

CREATE TABLE __migration_0029_toyhouse_import_items_backup AS
SELECT *
FROM toyhouse_import_items;

CREATE TABLE __migration_0029_character_folder_placements_backup AS
SELECT *
FROM character_folder_placements;

CREATE TABLE __migration_0029_user_passkeys_backup AS
SELECT *
FROM user_passkeys;

CREATE TABLE __migration_0029_webauthn_challenges_backup AS
SELECT *
FROM webauthn_challenges;

CREATE TABLE __migration_0029_admin_job_runs_backup AS
SELECT *
FROM admin_job_runs;

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

INSERT OR IGNORE INTO user_social_links
SELECT *
FROM __migration_0029_user_social_links_backup;

INSERT OR IGNORE INTO sessions
SELECT *
FROM __migration_0029_sessions_backup;

INSERT OR IGNORE INTO character_folders
SELECT *
FROM __migration_0029_character_folders_backup;

INSERT OR IGNORE INTO characters
SELECT *
FROM __migration_0029_characters_backup;

INSERT OR IGNORE INTO character_media
SELECT *
FROM __migration_0029_character_media_backup;

INSERT OR IGNORE INTO character_gallery_tabs
SELECT *
FROM __migration_0029_character_gallery_tabs_backup;

INSERT OR IGNORE INTO character_gallery_rows
SELECT *
FROM __migration_0029_character_gallery_rows_backup;

INSERT OR IGNORE INTO character_gallery_row_media
SELECT *
FROM __migration_0029_character_gallery_row_media_backup;

INSERT OR IGNORE INTO character_media_review_events
SELECT *
FROM __migration_0029_character_media_review_events_backup;

INSERT OR IGNORE INTO toyhouse_import_jobs
SELECT *
FROM __migration_0029_toyhouse_import_jobs_backup;

INSERT OR IGNORE INTO toyhouse_import_items
SELECT *
FROM __migration_0029_toyhouse_import_items_backup;

INSERT OR IGNORE INTO character_folder_placements
SELECT *
FROM __migration_0029_character_folder_placements_backup;

INSERT OR IGNORE INTO user_passkeys
SELECT *
FROM __migration_0029_user_passkeys_backup;

INSERT OR IGNORE INTO webauthn_challenges
SELECT *
FROM __migration_0029_webauthn_challenges_backup;

INSERT OR IGNORE INTO admin_job_runs
SELECT *
FROM __migration_0029_admin_job_runs_backup;

DROP TABLE __migration_0029_sessions_backup;
DROP TABLE __migration_0029_user_social_links_backup;
DROP TABLE __migration_0029_character_folders_backup;
DROP TABLE __migration_0029_characters_backup;
DROP TABLE __migration_0029_character_media_backup;
DROP TABLE __migration_0029_character_gallery_tabs_backup;
DROP TABLE __migration_0029_character_gallery_rows_backup;
DROP TABLE __migration_0029_character_gallery_row_media_backup;
DROP TABLE __migration_0029_character_media_review_events_backup;
DROP TABLE __migration_0029_toyhouse_import_jobs_backup;
DROP TABLE __migration_0029_toyhouse_import_items_backup;
DROP TABLE __migration_0029_character_folder_placements_backup;
DROP TABLE __migration_0029_user_passkeys_backup;
DROP TABLE __migration_0029_webauthn_challenges_backup;
DROP TABLE __migration_0029_admin_job_runs_backup;

CREATE INDEX idx_users_email
    ON users (email);

CREATE INDEX idx_users_username
    ON users (username);

CREATE INDEX idx_users_banned_at
    ON users (banned_at);

CREATE UNIQUE INDEX idx_users_webauthn_user_id
    ON users (webauthn_user_id);

PRAGMA foreign_keys= on;
