CREATE TABLE admin_image_review_queue
(
    media_id          TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    queued_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_id          TEXT,
    leased_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
    leased_at         TEXT,
    lease_expires_at  TEXT,

    FOREIGN KEY (media_id) REFERENCES character_media (id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_image_review_queue_available
    ON admin_image_review_queue (lease_expires_at, created_at, media_id);

CREATE INDEX idx_admin_image_review_queue_lease_user
    ON admin_image_review_queue (leased_by_user_id, lease_expires_at);

INSERT OR IGNORE INTO admin_image_review_queue (media_id, created_at, queued_at)
SELECT id, created_at, CURRENT_TIMESTAMP
FROM character_media
WHERE (
    sfw_image_key IS NOT NULL
        AND (
        sfw_review_status = 'pending'
            OR sfw_reviewed_at IS NULL
            OR updated_at > sfw_reviewed_at
        )
    )
   OR (
    nsfw_image_key IS NOT NULL
        AND (
        nsfw_review_status = 'pending'
            OR nsfw_reviewed_at IS NULL
            OR updated_at > nsfw_reviewed_at
        )
    );
