ALTER TABLE character_media
    ADD COLUMN sfw_review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sfw_review_status IN ('pending', 'approved', 'reported'));

ALTER TABLE character_media
    ADD COLUMN sfw_reviewed_at TEXT;

ALTER TABLE character_media
    ADD COLUMN sfw_approved_at TEXT;

ALTER TABLE character_media
    ADD COLUMN sfw_homepage_allowed INTEGER NOT NULL DEFAULT 0
        CHECK (sfw_homepage_allowed IN (0, 1));

ALTER TABLE character_media
    ADD COLUMN nsfw_review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (nsfw_review_status IN ('pending', 'approved', 'reported'));

ALTER TABLE character_media
    ADD COLUMN nsfw_reviewed_at TEXT;

ALTER TABLE character_media
    ADD COLUMN nsfw_approved_at TEXT;

CREATE INDEX idx_character_media_review_queue
    ON character_media (created_at, id);

CREATE TABLE character_media_review_events
(
    id               TEXT PRIMARY KEY,
    media_id         TEXT    NOT NULL,
    image_rating     TEXT    NOT NULL,
    action           TEXT    NOT NULL,
    homepage_allowed INTEGER NOT NULL DEFAULT 0,
    moderator_id     TEXT    NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (media_id) REFERENCES character_media (id) ON DELETE CASCADE,
    FOREIGN KEY (moderator_id) REFERENCES users (id) ON DELETE CASCADE,
    CHECK (image_rating IN ('sfw', 'nsfw')),
    CHECK (length(action) BETWEEN 1 AND 64),
    CHECK (homepage_allowed IN (0, 1))
);

CREATE INDEX idx_character_media_review_events_media_id
    ON character_media_review_events (media_id, created_at);

CREATE INDEX idx_character_media_review_events_created_at
    ON character_media_review_events (created_at);
