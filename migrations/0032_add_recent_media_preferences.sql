ALTER TABLE users
    ADD COLUMN show_unapproved_media INTEGER NOT NULL DEFAULT 1
        CHECK (show_unapproved_media IN (0, 1));

CREATE INDEX idx_character_media_recent_any
    ON character_media (created_at DESC, id DESC)
    WHERE (sfw_image_key IS NOT NULL AND sfw_preview_image_key IS NOT NULL)
       OR (nsfw_image_key IS NOT NULL AND nsfw_preview_image_key IS NOT NULL);
