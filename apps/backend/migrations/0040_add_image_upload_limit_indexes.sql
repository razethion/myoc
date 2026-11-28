-- Issue #253: support per-account upload quota checks and terminal-job retention cleanup.
-- image_upload_jobs_owner_created backs the rolling quota count (user_id + created_at window).
-- image_upload_jobs_retention backs the periodic purge of terminal jobs by updated_at.

CREATE INDEX image_upload_jobs_owner_created
    ON image_upload_jobs (user_id, created_at);

CREATE INDEX image_upload_jobs_retention
    ON image_upload_jobs (updated_at)
    WHERE state IN ('ready', 'failed', 'canceled');
