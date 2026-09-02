CREATE TABLE admin_job_runs (
    id TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    trigger_source TEXT NOT NULL CHECK (trigger_source IN ('cron', 'manual')),
    triggered_by_user_id TEXT,
    cron TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    summary_json TEXT,
    error_message TEXT,
    FOREIGN KEY (triggered_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_job_runs_started_at ON admin_job_runs(started_at DESC);
CREATE INDEX idx_admin_job_runs_job_started_at ON admin_job_runs(job_name, started_at DESC);
