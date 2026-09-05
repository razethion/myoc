ALTER TABLE media_preview_regeneration_items
ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0);
