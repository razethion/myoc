CREATE TABLE media_preview_regeneration_runs (
    run_id TEXT PRIMARY KEY,
    dispatch_complete INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_complete IN (0, 1)),
    enqueued_items INTEGER NOT NULL DEFAULT 0 CHECK (enqueued_items >= 0),
    FOREIGN KEY (run_id) REFERENCES admin_job_runs(id) ON DELETE CASCADE
);

CREATE TABLE media_preview_regeneration_items (
    task_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('sfw', 'nsfw')),
    container_slot INTEGER NOT NULL CHECK (container_slot BETWEEN 0 AND 2),
    candidate_json TEXT NOT NULL CHECK (json_valid(candidate_json)),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'regenerated', 'skipped', 'failed')),
    lease_id TEXT,
    lease_expires_at TEXT,
    regenerated_blur INTEGER NOT NULL DEFAULT 0 CHECK (regenerated_blur IN (0, 1)),
    last_error TEXT,
    UNIQUE (run_id, media_id, rating),
    FOREIGN KEY (run_id) REFERENCES admin_job_runs(id) ON DELETE CASCADE
);

CREATE TRIGGER media_preview_regeneration_item_finished
    AFTER UPDATE OF status ON media_preview_regeneration_items
    WHEN OLD.status IN ('pending', 'processing') AND NEW.status IN ('regenerated', 'skipped', 'failed')
BEGIN
    UPDATE admin_job_runs
    SET summary_json = json_set(
            COALESCE(summary_json, '{}'),
            '$.processedVariants', COALESCE(json_extract(summary_json, '$.processedVariants'), 0) + 1,
            '$.regeneratedPreviews', COALESCE(json_extract(summary_json, '$.regeneratedPreviews'), 0) +
                CASE WHEN NEW.status = 'regenerated' THEN 1 ELSE 0 END,
            '$.regeneratedBlurs', COALESCE(json_extract(summary_json, '$.regeneratedBlurs'), 0) + NEW.regenerated_blur,
            '$.skippedVariants', COALESCE(json_extract(summary_json, '$.skippedVariants'), 0) +
                CASE WHEN NEW.status = 'skipped' THEN 1 ELSE 0 END,
            '$.failedVariants', COALESCE(json_extract(summary_json, '$.failedVariants'), 0) +
                CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
            '$.lastError', CASE
                WHEN NEW.status = 'failed' THEN substr(NEW.last_error, 1, 2000)
                ELSE json_extract(summary_json, '$.lastError')
            END
        ),
        status = CASE
            WHEN (SELECT dispatch_complete FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id) = 1
                 AND COALESCE(json_extract(summary_json, '$.processedVariants'), 0) + 1 >=
                     (SELECT enqueued_items FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id)
                THEN 'success'
            ELSE status
        END,
        finished_at = CASE
            WHEN (SELECT dispatch_complete FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id) = 1
                 AND COALESCE(json_extract(summary_json, '$.processedVariants'), 0) + 1 >=
                     (SELECT enqueued_items FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id)
                THEN CURRENT_TIMESTAMP
            ELSE finished_at
        END,
        duration_ms = CASE
            WHEN (SELECT dispatch_complete FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id) = 1
                 AND COALESCE(json_extract(summary_json, '$.processedVariants'), 0) + 1 >=
                     (SELECT enqueued_items FROM media_preview_regeneration_runs WHERE run_id = NEW.run_id)
                THEN MAX(0, CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400000 AS INTEGER))
            ELSE duration_ms
        END
    WHERE id = NEW.run_id
      AND status = 'running';
END;
