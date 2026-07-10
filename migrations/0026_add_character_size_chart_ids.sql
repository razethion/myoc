PRAGMA foreign_keys= off;

DROP TABLE IF EXISTS __migration_0026_character_media_backup;
DROP TABLE IF EXISTS __migration_0026_character_gallery_tabs_backup;
DROP TABLE IF EXISTS __migration_0026_character_gallery_rows_backup;
DROP TABLE IF EXISTS __migration_0026_character_gallery_row_media_backup;
DROP TABLE IF EXISTS __migration_0026_character_media_review_events_backup;
DROP TABLE IF EXISTS __migration_0026_toyhouse_import_items_backup;
DROP TABLE IF EXISTS __migration_0026_character_folder_placements_backup;

CREATE TABLE __migration_0026_character_media_backup AS
SELECT *
FROM character_media;

CREATE TABLE __migration_0026_character_gallery_tabs_backup AS
SELECT *
FROM character_gallery_tabs;

CREATE TABLE __migration_0026_character_gallery_rows_backup AS
SELECT *
FROM character_gallery_rows;

CREATE TABLE __migration_0026_character_gallery_row_media_backup AS
SELECT *
FROM character_gallery_row_media;

CREATE TABLE __migration_0026_character_media_review_events_backup AS
SELECT *
FROM character_media_review_events;

CREATE TABLE __migration_0026_toyhouse_import_items_backup AS
SELECT *
FROM toyhouse_import_items;

CREATE TABLE __migration_0026_character_folder_placements_backup AS
SELECT *
FROM character_folder_placements;

CREATE TABLE __migration_0026_character_size_chart_ids
(
    character_id  TEXT PRIMARY KEY,
    size_chart_id BLOB NOT NULL UNIQUE,
    CHECK (length(size_chart_id) = 6)
);

INSERT OR IGNORE INTO __migration_0026_character_size_chart_ids (character_id, size_chart_id)
SELECT id,
       randomblob(6)
FROM characters;

INSERT OR IGNORE INTO __migration_0026_character_size_chart_ids (character_id, size_chart_id)
SELECT id,
       randomblob(6)
FROM characters
WHERE id NOT IN (SELECT character_id FROM __migration_0026_character_size_chart_ids);

INSERT OR IGNORE INTO __migration_0026_character_size_chart_ids (character_id, size_chart_id)
SELECT id,
       randomblob(6)
FROM characters
WHERE id NOT IN (SELECT character_id FROM __migration_0026_character_size_chart_ids);

CREATE TABLE characters_new
(
    id                TEXT PRIMARY KEY,
    size_chart_id     BLOB    NOT NULL,
    user_id           TEXT    NOT NULL,

    name              TEXT    NOT NULL,
    profile_image_key TEXT    NOT NULL,
    folder_id         TEXT,

    created_at        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    description       TEXT    NOT NULL DEFAULT '',
    height_chart_json TEXT    NOT NULL DEFAULT '',

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES character_folders (id) ON DELETE SET NULL,
    CHECK (length(size_chart_id) = 6),
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (trim(name) GLOB '*[A-Za-z0-9]*'),
    CHECK (name NOT GLOB '*[^A-Za-z0-9 _''"().-]*'),
    CHECK (length(profile_image_key) > 0),
    CHECK (folder_id IS NULL OR length(folder_id) BETWEEN 1 AND 128)
);

INSERT INTO characters_new (id,
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
SELECT characters.id,
       __migration_0026_character_size_chart_ids.size_chart_id,
       characters.user_id,
       characters.name,
       characters.profile_image_key,
       characters.folder_id,
       characters.created_at,
       characters.updated_at,
       characters.sort_order,
       characters.description,
       characters.height_chart_json
FROM characters
         LEFT JOIN __migration_0026_character_size_chart_ids
                   ON __migration_0026_character_size_chart_ids.character_id = characters.id;

DROP TABLE characters;

ALTER TABLE characters_new
    RENAME TO characters;

INSERT OR IGNORE INTO character_media
SELECT *
FROM __migration_0026_character_media_backup;

INSERT OR IGNORE INTO character_gallery_tabs
SELECT *
FROM __migration_0026_character_gallery_tabs_backup;

INSERT OR IGNORE INTO character_gallery_rows
SELECT *
FROM __migration_0026_character_gallery_rows_backup;

INSERT OR IGNORE INTO character_gallery_row_media
SELECT *
FROM __migration_0026_character_gallery_row_media_backup;

INSERT OR IGNORE INTO character_media_review_events
SELECT *
FROM __migration_0026_character_media_review_events_backup;

INSERT OR IGNORE INTO toyhouse_import_items
SELECT *
FROM __migration_0026_toyhouse_import_items_backup;

INSERT OR IGNORE INTO character_folder_placements
SELECT *
FROM __migration_0026_character_folder_placements_backup;

DROP TABLE __migration_0026_character_size_chart_ids;
DROP TABLE __migration_0026_character_media_backup;
DROP TABLE __migration_0026_character_gallery_tabs_backup;
DROP TABLE __migration_0026_character_gallery_rows_backup;
DROP TABLE __migration_0026_character_gallery_row_media_backup;
DROP TABLE __migration_0026_character_media_review_events_backup;
DROP TABLE __migration_0026_toyhouse_import_items_backup;
DROP TABLE __migration_0026_character_folder_placements_backup;

CREATE INDEX idx_characters_user_id
    ON characters (user_id);

CREATE INDEX idx_characters_user_folder_id
    ON characters (user_id, folder_id);

CREATE INDEX idx_characters_user_created_at
    ON characters (user_id, created_at);

CREATE UNIQUE INDEX idx_characters_user_name_unique
    ON characters (user_id, name COLLATE NOCASE);

CREATE UNIQUE INDEX idx_characters_size_chart_id_unique
    ON characters (size_chart_id);

PRAGMA foreign_keys= on;
