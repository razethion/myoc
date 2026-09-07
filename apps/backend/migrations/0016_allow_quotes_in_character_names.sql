PRAGMA foreign_keys= off;

DROP TABLE IF EXISTS __migration_0016_character_media_backup;
DROP TABLE IF EXISTS __migration_0016_character_gallery_tabs_backup;
DROP TABLE IF EXISTS __migration_0016_character_gallery_rows_backup;
DROP TABLE IF EXISTS __migration_0016_character_gallery_row_media_backup;
DROP TABLE IF EXISTS __migration_0016_character_media_review_events_backup;

CREATE TABLE __migration_0016_character_media_backup AS
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
       nsfw_content_type
FROM character_media;

CREATE TABLE __migration_0016_character_gallery_tabs_backup AS
SELECT id,
       user_id,
       character_id,
       name,
       sort_order,
       created_at,
       updated_at
FROM character_gallery_tabs;

CREATE TABLE __migration_0016_character_gallery_rows_backup AS
SELECT id,
       user_id,
       character_id,
       tab_id,
       sort_order,
       created_at,
       updated_at
FROM character_gallery_rows;

CREATE TABLE __migration_0016_character_gallery_row_media_backup AS
SELECT row_id,
       media_id,
       sort_order
FROM character_gallery_row_media;

CREATE TABLE __migration_0016_character_media_review_events_backup AS
SELECT id,
       media_id,
       image_rating,
       action,
       homepage_allowed,
       moderator_id,
       created_at
FROM character_media_review_events;

DROP INDEX IF EXISTS idx_characters_user_name_unique;
DROP INDEX IF EXISTS idx_characters_user_id;
DROP INDEX IF EXISTS idx_characters_user_folder_id;
DROP INDEX IF EXISTS idx_characters_user_created_at;

CREATE TABLE characters_new
(
    id                        TEXT PRIMARY KEY,
    user_id                   TEXT    NOT NULL,

    name                      TEXT    NOT NULL,
    profile_image_key         TEXT    NOT NULL,
    folder_id                 TEXT,

    created_at                TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sort_order                INTEGER NOT NULL DEFAULT 0,
    description               TEXT    NOT NULL DEFAULT '',
    gallery_fullsize_last_row INTEGER NOT NULL DEFAULT 0,
    height_chart_json         TEXT    NOT NULL DEFAULT '',

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES character_folders (id) ON DELETE SET NULL,
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (trim(name) GLOB '*[A-Za-z0-9]*'),
    CHECK (name NOT GLOB '*[^A-Za-z0-9 _''"().-]*'),
    CHECK (length(profile_image_key) > 0),
    CHECK (folder_id IS NULL OR length(folder_id) BETWEEN 1 AND 128)
);

INSERT INTO characters_new (id,
                            user_id,
                            name,
                            profile_image_key,
                            folder_id,
                            created_at,
                            updated_at,
                            sort_order,
                            description,
                            gallery_fullsize_last_row,
                            height_chart_json)
SELECT id,
       user_id,
       name,
       profile_image_key,
       folder_id,
       created_at,
       updated_at,
       sort_order,
       description,
       gallery_fullsize_last_row,
       height_chart_json
FROM characters;

DROP TABLE characters;

ALTER TABLE characters_new
    RENAME TO characters;

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
                                       nsfw_content_type)
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
       nsfw_content_type
FROM __migration_0016_character_media_backup;

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
FROM __migration_0016_character_gallery_tabs_backup;

INSERT OR IGNORE INTO character_gallery_rows (id,
                                             user_id,
                                             character_id,
                                             tab_id,
                                             sort_order,
                                             created_at,
                                             updated_at)
SELECT id,
       user_id,
       character_id,
       tab_id,
       sort_order,
       created_at,
       updated_at
FROM __migration_0016_character_gallery_rows_backup;

INSERT OR IGNORE INTO character_gallery_row_media (row_id,
                                                  media_id,
                                                  sort_order)
SELECT row_id,
       media_id,
       sort_order
FROM __migration_0016_character_gallery_row_media_backup;

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
FROM __migration_0016_character_media_review_events_backup;

DROP TABLE __migration_0016_character_media_backup;
DROP TABLE __migration_0016_character_gallery_tabs_backup;
DROP TABLE __migration_0016_character_gallery_rows_backup;
DROP TABLE __migration_0016_character_gallery_row_media_backup;
DROP TABLE __migration_0016_character_media_review_events_backup;

CREATE INDEX idx_characters_user_id
    ON characters (user_id);

CREATE INDEX idx_characters_user_folder_id
    ON characters (user_id, folder_id);

CREATE INDEX idx_characters_user_created_at
    ON characters (user_id, created_at);

CREATE UNIQUE INDEX idx_characters_user_name_unique
    ON characters (user_id, name COLLATE NOCASE);

PRAGMA foreign_keys= on;
