ALTER TABLE character_media
    ADD COLUMN sfw_preview_content_type TEXT NOT NULL DEFAULT 'image/webp'
        CHECK (sfw_preview_content_type IN ('image/webp', 'image/avif'));

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_content_type TEXT NOT NULL DEFAULT 'image/webp'
        CHECK (nsfw_preview_content_type IN ('image/webp', 'image/avif'));
