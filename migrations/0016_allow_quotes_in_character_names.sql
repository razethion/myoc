PRAGMA foreign_keys= off;

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

CREATE INDEX idx_characters_user_id
    ON characters (user_id);

CREATE INDEX idx_characters_user_folder_id
    ON characters (user_id, folder_id);

CREATE INDEX idx_characters_user_created_at
    ON characters (user_id, created_at);

CREATE UNIQUE INDEX idx_characters_user_name_unique
    ON characters (user_id, name COLLATE NOCASE);

PRAGMA foreign_keys= on;
