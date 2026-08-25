CREATE INDEX idx_character_media_recent_sfw
    ON character_media (created_at DESC, id DESC)
    WHERE sfw_image_key IS NOT NULL
      AND sfw_preview_image_key IS NOT NULL
      AND sfw_review_status = 'approved'
      AND sfw_approved_at IS NOT NULL;
