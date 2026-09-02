CREATE TABLE toyhouse_import_jobs
(
    id           TEXT PRIMARY KEY,
    user_id      TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    total_images INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    CHECK (total_images >= 0)
);

CREATE INDEX idx_toyhouse_import_jobs_user_id
    ON toyhouse_import_jobs (user_id, created_at);

CREATE TABLE toyhouse_import_items
(
    id                    TEXT PRIMARY KEY,
    job_id                TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    character_id          TEXT    NOT NULL,
    toyhouse_character_id TEXT    NOT NULL,
    toyhouse_image_url    TEXT    NOT NULL,
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
    FOREIGN KEY (media_id) REFERENCES character_media (id) ON DELETE SET NULL,
    UNIQUE (user_id, character_id, toyhouse_image_url),
    CHECK (length(toyhouse_character_id) > 0),
    CHECK (length(toyhouse_image_url) > 0),
    CHECK (rating IN ('sfw', 'nsfw')),
    CHECK (status IN ('pending', 'uploading', 'imported', 'failed')),
    CHECK (sort_order >= 0)
);

CREATE INDEX idx_toyhouse_import_items_job_id
    ON toyhouse_import_items (job_id, sort_order);

CREATE INDEX idx_toyhouse_import_items_character_id
    ON toyhouse_import_items (character_id, status);
