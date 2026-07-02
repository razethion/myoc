CREATE INDEX idx_character_media_sfw_review_pending
    ON character_media (created_at, id)
    WHERE sfw_image_key IS NOT NULL
        AND (
              sfw_review_status = 'pending'
                  OR sfw_reviewed_at IS NULL
                  OR updated_at > sfw_reviewed_at
              );

CREATE INDEX idx_character_media_nsfw_review_pending
    ON character_media (created_at, id)
    WHERE nsfw_image_key IS NOT NULL
        AND (
              nsfw_review_status = 'pending'
                  OR nsfw_reviewed_at IS NULL
                  OR updated_at > nsfw_reviewed_at
              );
