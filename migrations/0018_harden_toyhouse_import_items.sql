PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_toyhouse_import_items_job_id;
DROP INDEX IF EXISTS idx_toyhouse_import_items_character_id;

CREATE TABLE toyhouse_import_items_next
(
    id                    TEXT PRIMARY KEY,
    job_id                TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    character_id          TEXT    NOT NULL,
    toyhouse_character_id TEXT    NOT NULL,
    toyhouse_image_url    TEXT    NOT NULL,
    import_mode           TEXT    NOT NULL DEFAULT 'existing',
    rating                TEXT    NOT NULL,
    status                TEXT    NOT NULL DEFAULT 'pending',
    media_id              TEXT,
    error                 TEXT    NOT NULL DEFAULT '',
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (job_id) REFERENCES toyhouse_import_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES character_media (id) ON DELETE CASCADE,
    UNIQUE (user_id, character_id, toyhouse_image_url),
    CHECK (length(toyhouse_character_id) > 0),
    CHECK (length(toyhouse_image_url) > 0),
    CHECK (import_mode IN ('create', 'existing')),
    CHECK (rating IN ('sfw', 'nsfw')),
    CHECK (status IN ('pending', 'uploading', 'imported', 'failed')),
    CHECK (sort_order >= 0)
);

INSERT INTO toyhouse_import_items_next (id,
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
       'existing',
       rating,
       status,
       media_id,
       error,
       sort_order,
       created_at,
       updated_at
FROM toyhouse_import_items;

DROP TABLE toyhouse_import_items;

ALTER TABLE toyhouse_import_items_next
    RENAME TO toyhouse_import_items;

CREATE INDEX idx_toyhouse_import_items_job_id
    ON toyhouse_import_items (job_id, sort_order);

CREATE INDEX idx_toyhouse_import_items_character_id
    ON toyhouse_import_items (character_id, status);

CREATE INDEX idx_toyhouse_import_items_media_id
    ON toyhouse_import_items (media_id);

PRAGMA foreign_keys = ON;
