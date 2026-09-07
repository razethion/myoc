ALTER TABLE characters
    ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE characters
    ADD COLUMN gallery_fullsize_last_row INTEGER NOT NULL DEFAULT 0;

CREATE TABLE character_media
(
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    character_id    TEXT NOT NULL,

    sfw_image_key   TEXT,
    nsfw_image_key  TEXT,
    sfw_artist      TEXT NOT NULL DEFAULT '',
    nsfw_artist     TEXT NOT NULL DEFAULT '',
    sfw_width       INTEGER,
    sfw_height      INTEGER,
    sfw_byte_size   INTEGER,
    nsfw_width      INTEGER,
    nsfw_height     INTEGER,
    nsfw_byte_size  INTEGER,

    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
    CHECK (sfw_image_key IS NOT NULL OR nsfw_image_key IS NOT NULL),
    CHECK (length(sfw_artist) <= 80),
    CHECK (length(nsfw_artist) <= 80),
    CHECK (sfw_width IS NULL OR sfw_width > 0),
    CHECK (sfw_height IS NULL OR sfw_height > 0),
    CHECK (sfw_byte_size IS NULL OR sfw_byte_size > 0),
    CHECK (nsfw_width IS NULL OR nsfw_width > 0),
    CHECK (nsfw_height IS NULL OR nsfw_height > 0),
    CHECK (nsfw_byte_size IS NULL OR nsfw_byte_size > 0)
);

CREATE INDEX idx_character_media_character_id
    ON character_media (character_id, created_at);

CREATE TABLE character_gallery_tabs
(
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    character_id TEXT NOT NULL,

    name         TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
    UNIQUE (character_id, name),
    CHECK (length(trim(name)) BETWEEN 1 AND 32),
    CHECK (trim(name) GLOB '[A-Za-z0-9]*'),
    CHECK (name NOT GLOB '*[^A-Za-z0-9 _''().-]*')
);

CREATE INDEX idx_character_gallery_tabs_character_id
    ON character_gallery_tabs (character_id, sort_order);

CREATE TABLE character_gallery_rows
(
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    character_id TEXT NOT NULL,
    tab_id       TEXT NOT NULL,

    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
    FOREIGN KEY (tab_id) REFERENCES character_gallery_tabs (id) ON DELETE CASCADE
);

CREATE INDEX idx_character_gallery_rows_tab_id
    ON character_gallery_rows (tab_id, sort_order);

CREATE TABLE character_gallery_row_media
(
    row_id     TEXT NOT NULL,
    media_id   TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (row_id, media_id),
    FOREIGN KEY (row_id) REFERENCES character_gallery_rows (id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES character_media (id) ON DELETE CASCADE
);

CREATE INDEX idx_character_gallery_row_media_media_id
    ON character_gallery_row_media (media_id);
