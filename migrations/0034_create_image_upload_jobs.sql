ALTER TABLE users
    ADD COLUMN profile_photo_content_type TEXT NOT NULL DEFAULT 'image/webp';

ALTER TABLE characters
    ADD COLUMN profile_image_content_type TEXT NOT NULL DEFAULT 'image/webp';

ALTER TABLE character_folders
    ADD COLUMN folder_image_content_type TEXT NOT NULL DEFAULT 'image/webp';

CREATE TABLE image_upload_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    batch_id TEXT,
    target_type TEXT NOT NULL CHECK (target_type IN (
        'gallery_create',
        'gallery_replace',
        'user_profile',
        'character_profile',
        'folder_image'
    )),
    target_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'uploading',
        'queued',
        'processing',
        'waiting_for_sources',
        'publishing',
        'ready',
        'failed',
        'canceled'
    )),
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
    idempotency_key TEXT NOT NULL,
    last_retry_idempotency_key TEXT,
    request_json TEXT NOT NULL CHECK (json_valid(request_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    error_code TEXT,
    error_message TEXT,
    deadline_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, idempotency_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE image_upload_sources (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    rating TEXT CHECK (rating IS NULL OR rating IN ('sfw', 'nsfw')),
    state TEXT NOT NULL CHECK (state IN ('uploading', 'ready', 'failed', 'canceled')),
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, rating),
    FOREIGN KEY (job_id) REFERENCES image_upload_jobs(id) ON DELETE CASCADE
);

CREATE TABLE image_upload_parts (
    source_id TEXT NOT NULL,
    part_number INTEGER NOT NULL CHECK (part_number > 0),
    etag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_id, part_number),
    FOREIGN KEY (source_id) REFERENCES image_upload_sources(id) ON DELETE CASCADE
);

CREATE TABLE image_processing_tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    recipe TEXT NOT NULL CHECK (recipe IN (
        'gallery-sfw-v1',
        'gallery-nsfw-v1',
        'user-profile-v1',
        'character-profile-v1',
        'folder-image-v1'
    )),
    container_slot INTEGER NOT NULL CHECK (container_slot BETWEEN 0 AND 2),
    state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'ready', 'failed', 'canceled')),
    sharp_attempts INTEGER NOT NULL DEFAULT 0 CHECK (sharp_attempts BETWEEN 0 AND 3),
    lease_id TEXT,
    lease_expires_at TEXT,
    last_enqueued_at TEXT,
    output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, run_id),
    FOREIGN KEY (job_id) REFERENCES image_upload_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES image_upload_sources(id) ON DELETE CASCADE
);

CREATE TABLE image_processing_attempts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
    container_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'ready', 'failed')),
    error_code TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    UNIQUE (task_id, attempt_number),
    FOREIGN KEY (task_id) REFERENCES image_processing_tasks(id) ON DELETE CASCADE
);

CREATE TABLE image_queue_outbox (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    container_slot INTEGER NOT NULL CHECK (container_slot BETWEEN 0 AND 2),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent')),
    send_attempts INTEGER NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
    next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    FOREIGN KEY (task_id) REFERENCES image_processing_tasks(id) ON DELETE CASCADE
);

CREATE TABLE image_cleanup_tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    bucket TEXT NOT NULL CHECK (bucket IN ('media', 'source')),
    object_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
    not_before TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bucket, object_key),
    FOREIGN KEY (job_id) REFERENCES image_upload_jobs(id) ON DELETE SET NULL
);

CREATE INDEX image_upload_jobs_owner_state
    ON image_upload_jobs (user_id, state, updated_at DESC);

CREATE INDEX image_upload_jobs_deadline
    ON image_upload_jobs (deadline_at)
    WHERE state IN ('uploading', 'queued', 'processing', 'waiting_for_sources', 'publishing');

CREATE INDEX image_processing_tasks_recovery
    ON image_processing_tasks (state, lease_expires_at, last_enqueued_at);

CREATE INDEX image_queue_outbox_dispatch
    ON image_queue_outbox (state, next_attempt_at, created_at);

CREATE INDEX image_cleanup_tasks_due
    ON image_cleanup_tasks (state, not_before, created_at);
