ALTER TABLE character_media
    ADD COLUMN sfw_preview_image_key TEXT;

ALTER TABLE character_media
    ADD COLUMN sfw_preview_width INTEGER CHECK (sfw_preview_width IS NULL OR sfw_preview_width > 0);

ALTER TABLE character_media
    ADD COLUMN sfw_preview_height INTEGER CHECK (sfw_preview_height IS NULL OR sfw_preview_height > 0);

ALTER TABLE character_media
    ADD COLUMN sfw_preview_byte_size INTEGER CHECK (sfw_preview_byte_size IS NULL OR sfw_preview_byte_size > 0);

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_image_key TEXT;

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_width INTEGER CHECK (nsfw_preview_width IS NULL OR nsfw_preview_width > 0);

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_height INTEGER CHECK (nsfw_preview_height IS NULL OR nsfw_preview_height > 0);

ALTER TABLE character_media
    ADD COLUMN nsfw_preview_byte_size INTEGER CHECK (nsfw_preview_byte_size IS NULL OR nsfw_preview_byte_size > 0);
