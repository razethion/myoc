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
SELECT id,
       user_id,
       session_hash,
       created_at,
       expires_at
FROM sessions;

CREATE TABLE __migration_0029_user_social_links_backup AS
SELECT user_id,
       platform,
       label,
       url,
       created_at,
       updated_at
FROM user_social_links;

CREATE TABLE __migration_0029_character_folders_backup AS
SELECT id,
       user_id,
       name,
       parent_folder_id,
       sort_order,
       created_at,
       updated_at,
       folder_image_key
FROM character_folders;

CREATE TABLE __migration_0029_characters_backup AS
SELECT id,
       size_chart_id,
       user_id,
       name,
       profile_image_key,
       folder_id,
       created_at,
       updated_at,
       sort_order,
       description,
       height_chart_json
FROM characters;

CREATE TABLE __migration_0029_character_media_backup AS
SELECT id,
       user_id,
       character_id,
       sfw_image_key,
       nsfw_image_key,
       sfw_artist,
       nsfw_artist,
       sfw_width,
       sfw_height,
       sfw_byte_size,
       nsfw_width,
       nsfw_height,
       nsfw_byte_size,
       created_at,
       updated_at,
       sfw_review_status,
       sfw_reviewed_at,
       sfw_approved_at,
       sfw_homepage_allowed,
       nsfw_review_status,
       nsfw_reviewed_at,
       nsfw_approved_at,
       sfw_content_type,
       nsfw_content_type,
       sfw_preview_image_key,
       sfw_preview_width,
       sfw_preview_height,
       sfw_preview_byte_size,
       nsfw_preview_image_key,
       nsfw_preview_width,
       nsfw_preview_height,
       nsfw_preview_byte_size,
       nsfw_blur_image_key
FROM character_media;

CREATE TABLE __migration_0029_character_gallery_tabs_backup AS
SELECT id,
       user_id,
       character_id,
       name,
       sort_order,
       created_at,
       updated_at
FROM character_gallery_tabs;

CREATE TABLE __migration_0029_character_gallery_rows_backup AS
SELECT id,
       user_id,
       character_id,
       tab_id,
       sort_order,
       created_at,
       updated_at,
       force_full_width
FROM character_gallery_rows;

CREATE TABLE __migration_0029_character_gallery_row_media_backup AS
SELECT row_id,
       media_id,
       sort_order
FROM character_gallery_row_media;

CREATE TABLE __migration_0029_character_media_review_events_backup AS
SELECT id,
       media_id,
       image_rating,
       action,
       homepage_allowed,
       moderator_id,
       created_at
FROM character_media_review_events;

CREATE TABLE __migration_0029_toyhouse_import_jobs_backup AS
SELECT id,
       user_id,
       status,
       total_images,
       created_at,
       updated_at
FROM toyhouse_import_jobs;

CREATE TABLE __migration_0029_toyhouse_import_items_backup AS
SELECT id,
       job_id,
       user_id,
       character_id,
       toyhouse_character_id,
       toyhouse_image_url,
       import_mode,
       rating,
       status,
       media_id,
       error,
       sort_order,
       created_at,
       updated_at
FROM toyhouse_import_items;

CREATE TABLE __migration_0029_character_folder_placements_backup AS
SELECT user_id,
       folder_id,
       character_id,
       sort_order,
       created_at,
       updated_at
FROM character_folder_placements;

CREATE TABLE __migration_0029_user_passkeys_backup AS
SELECT id,
       user_id,
       credential_id,
       public_key,
       webauthn_user_id,
       counter,
       device_type,
       backed_up,
       transports,
       name,
       created_at,
       last_used_at
FROM user_passkeys;

CREATE TABLE __migration_0029_webauthn_challenges_backup AS
SELECT id,
       user_id,
       email,
       username,
       webauthn_user_id,
       ceremony,
       challenge,
       expires_at,
       created_at
FROM webauthn_challenges;

CREATE TABLE __migration_0029_admin_job_runs_backup AS
SELECT id,
       job_name,
       trigger_source,
       triggered_by_user_id,
       cron,
       status,
       started_at,
       finished_at,
       duration_ms,
       summary_json,
       error_message
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

INSERT OR IGNORE INTO user_social_links (user_id,
                                         platform,
                                         label,
                                         url,
                                         created_at,
                                         updated_at)
SELECT user_id,
       platform,
       label,
       url,
       created_at,
       updated_at
FROM __migration_0029_user_social_links_backup;

INSERT OR IGNORE INTO sessions (id,
                                user_id,
                                session_hash,
                                created_at,
                                expires_at)
SELECT id,
       user_id,
       session_hash,
       created_at,
       expires_at
FROM __migration_0029_sessions_backup;

INSERT OR IGNORE INTO character_folders (id,
                                        user_id,
                                        name,
                                        parent_folder_id,
                                        sort_order,
                                        created_at,
                                        updated_at,
                                        folder_image_key)
SELECT id,
       user_id,
       name,
       parent_folder_id,
       sort_order,
       created_at,
       updated_at,
       folder_image_key
FROM __migration_0029_character_folders_backup;

INSERT OR IGNORE INTO characters (id,
                                  size_chart_id,
                                  user_id,
                                  name,
                                  profile_image_key,
                                  folder_id,
                                  created_at,
                                  updated_at,
                                  sort_order,
                                  description,
                                  height_chart_json)
SELECT id,
       size_chart_id,
       user_id,
       name,
       profile_image_key,
       folder_id,
       created_at,
       updated_at,
       sort_order,
       description,
       height_chart_json
FROM __migration_0029_characters_backup;

INSERT OR IGNORE INTO character_media (id,
                                       user_id,
                                       character_id,
                                       sfw_image_key,
                                       nsfw_image_key,
                                       sfw_artist,
                                       nsfw_artist,
                                       sfw_width,
                                       sfw_height,
                                       sfw_byte_size,
                                       nsfw_width,
                                       nsfw_height,
                                       nsfw_byte_size,
                                       created_at,
                                       updated_at,
                                       sfw_review_status,
                                       sfw_reviewed_at,
                                       sfw_approved_at,
                                       sfw_homepage_allowed,
                                       nsfw_review_status,
                                       nsfw_reviewed_at,
                                       nsfw_approved_at,
                                       sfw_content_type,
                                       nsfw_content_type,
                                       sfw_preview_image_key,
                                       sfw_preview_width,
                                       sfw_preview_height,
                                       sfw_preview_byte_size,
                                       nsfw_preview_image_key,
                                       nsfw_preview_width,
                                       nsfw_preview_height,
                                       nsfw_preview_byte_size,
                                       nsfw_blur_image_key)
SELECT id,
       user_id,
       character_id,
       sfw_image_key,
       nsfw_image_key,
       sfw_artist,
       nsfw_artist,
       sfw_width,
       sfw_height,
       sfw_byte_size,
       nsfw_width,
       nsfw_height,
       nsfw_byte_size,
       created_at,
       updated_at,
       sfw_review_status,
       sfw_reviewed_at,
       sfw_approved_at,
       sfw_homepage_allowed,
       nsfw_review_status,
       nsfw_reviewed_at,
       nsfw_approved_at,
       sfw_content_type,
       nsfw_content_type,
       sfw_preview_image_key,
       sfw_preview_width,
       sfw_preview_height,
       sfw_preview_byte_size,
       nsfw_preview_image_key,
       nsfw_preview_width,
       nsfw_preview_height,
       nsfw_preview_byte_size,
       nsfw_blur_image_key
FROM __migration_0029_character_media_backup;

INSERT OR IGNORE INTO character_gallery_tabs (id,
                                             user_id,
                                             character_id,
                                             name,
                                             sort_order,
                                             created_at,
                                             updated_at)
SELECT id,
       user_id,
       character_id,
       name,
       sort_order,
       created_at,
       updated_at
FROM __migration_0029_character_gallery_tabs_backup;

INSERT OR IGNORE INTO character_gallery_rows (id,
                                             user_id,
                                             character_id,
                                             tab_id,
                                             sort_order,
                                             created_at,
                                             updated_at,
                                             force_full_width)
SELECT id,
       user_id,
       character_id,
       tab_id,
       sort_order,
       created_at,
       updated_at,
       force_full_width
FROM __migration_0029_character_gallery_rows_backup;

INSERT OR IGNORE INTO character_gallery_row_media (row_id,
                                                  media_id,
                                                  sort_order)
SELECT row_id,
       media_id,
       sort_order
FROM __migration_0029_character_gallery_row_media_backup;

INSERT OR IGNORE INTO character_media_review_events (id,
                                                    media_id,
                                                    image_rating,
                                                    action,
                                                    homepage_allowed,
                                                    moderator_id,
                                                    created_at)
SELECT id,
       media_id,
       image_rating,
       action,
       homepage_allowed,
       moderator_id,
       created_at
FROM __migration_0029_character_media_review_events_backup;

INSERT OR IGNORE INTO toyhouse_import_jobs (id,
                                           user_id,
                                           status,
                                           total_images,
                                           created_at,
                                           updated_at)
SELECT id,
       user_id,
       status,
       total_images,
       created_at,
       updated_at
FROM __migration_0029_toyhouse_import_jobs_backup;

INSERT OR IGNORE INTO toyhouse_import_items (id,
                                            job_id,
                                            user_id,
                                            character_id,
                                            toyhouse_character_id,
                                            toyhouse_image_url,
                                            import_mode,
                                            rating,
                                            status,
                                            media_id,
                                            error,
                                            sort_order,
                                            created_at,
                                            updated_at)
SELECT id,
       job_id,
       user_id,
       character_id,
       toyhouse_character_id,
       toyhouse_image_url,
       import_mode,
       rating,
       status,
       media_id,
       error,
       sort_order,
       created_at,
       updated_at
FROM __migration_0029_toyhouse_import_items_backup;

INSERT OR IGNORE INTO character_folder_placements (user_id,
                                                  folder_id,
                                                  character_id,
                                                  sort_order,
                                                  created_at,
                                                  updated_at)
SELECT user_id,
       folder_id,
       character_id,
       sort_order,
       created_at,
       updated_at
FROM __migration_0029_character_folder_placements_backup;

INSERT OR IGNORE INTO user_passkeys (id,
                                    user_id,
                                    credential_id,
                                    public_key,
                                    webauthn_user_id,
                                    counter,
                                    device_type,
                                    backed_up,
                                    transports,
                                    name,
                                    created_at,
                                    last_used_at)
SELECT id,
       user_id,
       credential_id,
       public_key,
       webauthn_user_id,
       counter,
       device_type,
       backed_up,
       transports,
       name,
       created_at,
       last_used_at
FROM __migration_0029_user_passkeys_backup;

INSERT OR IGNORE INTO webauthn_challenges (id,
                                           user_id,
                                           email,
                                           username,
                                           webauthn_user_id,
                                           ceremony,
                                           challenge,
                                           expires_at,
                                           created_at)
SELECT id,
       user_id,
       email,
       username,
       webauthn_user_id,
       ceremony,
       challenge,
       expires_at,
       created_at
FROM __migration_0029_webauthn_challenges_backup;

INSERT OR IGNORE INTO admin_job_runs (id,
                                      job_name,
                                      trigger_source,
                                      triggered_by_user_id,
                                      cron,
                                      status,
                                      started_at,
                                      finished_at,
                                      duration_ms,
                                      summary_json,
                                      error_message)
SELECT id,
       job_name,
       trigger_source,
       triggered_by_user_id,
       cron,
       status,
       started_at,
       finished_at,
       duration_ms,
       summary_json,
       error_message
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
