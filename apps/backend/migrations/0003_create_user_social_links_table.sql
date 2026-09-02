CREATE TABLE user_social_links
(
    user_id    TEXT NOT NULL,
    platform   TEXT NOT NULL,
    label      TEXT,
    url        TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, platform),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CHECK (platform IN ('twitter', 'telegram', 'discord', 'instagram', 'furaffinity', 'bluesky', 'custom')),
    CHECK (length(url) > 0),
    CHECK (label IS NULL OR length(label) <= 40)
);

CREATE INDEX idx_user_social_links_user_id
    ON user_social_links (user_id);
