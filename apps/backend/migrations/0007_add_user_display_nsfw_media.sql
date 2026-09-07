ALTER TABLE users
    ADD COLUMN display_nsfw_media INTEGER NOT NULL DEFAULT 0
        CHECK (display_nsfw_media IN (0, 1));
