ALTER TABLE character_media
    ADD COLUMN sfw_preview_animated INTEGER NOT NULL DEFAULT 0
        CHECK (sfw_preview_animated IN (0, 1));

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_animated INTEGER NOT NULL DEFAULT 0
        CHECK (nsfw_preview_animated IN (0, 1));
