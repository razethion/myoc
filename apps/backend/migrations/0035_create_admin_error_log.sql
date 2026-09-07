ALTER TABLE image_processing_tasks
    ADD COLUMN failure_event_id TEXT;

ALTER TABLE image_processing_tasks
    ADD COLUMN failure_reported_at TEXT;

CREATE UNIQUE INDEX image_processing_tasks_failure_event
    ON image_processing_tasks (failure_event_id)
    WHERE failure_event_id IS NOT NULL;

CREATE INDEX image_processing_tasks_pending_failure
    ON image_processing_tasks (state, failure_reported_at, updated_at)
    WHERE state = 'failed' AND failure_event_id IS NOT NULL;

CREATE TABLE admin_error_logs (
    source TEXT NOT NULL CHECK (source IN ('image-processing', 'media-preview-regeneration')),
    message_id TEXT NOT NULL,
    job_id TEXT,
    task_id TEXT,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source, message_id)
);

CREATE INDEX admin_error_logs_created_at
    ON admin_error_logs (created_at DESC);
