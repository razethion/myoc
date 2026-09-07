ALTER TABLE character_media
    ADD COLUMN sfw_content_type TEXT;

ALTER TABLE character_media
    ADD COLUMN nsfw_content_type TEXT;

UPDATE character_media
SET sfw_content_type = 'image/png'
WHERE sfw_image_key IS NOT NULL;

UPDATE character_media
SET nsfw_content_type = 'image/png'
WHERE nsfw_image_key IS NOT NULL;
