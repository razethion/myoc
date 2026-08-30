ALTER TABLE users
    ADD COLUMN show_unapproved_media INTEGER NOT NULL DEFAULT 1
        CHECK (show_unapproved_media IN (0, 1));

CREATE INDEX idx_character_media_recent_sfw
    ON character_media (created_at DESC, id DESC)
    WHERE sfw_image_key IS NOT NULL
      AND sfw_preview_image_key IS NOT NULL
      AND sfw_review_status = 'approved'
      AND sfw_approved_at IS NOT NULL;

CREATE INDEX idx_character_media_recent_any
    ON character_media (created_at DESC, id DESC)
    WHERE (sfw_image_key IS NOT NULL AND sfw_preview_image_key IS NOT NULL)
       OR (nsfw_image_key IS NOT NULL AND nsfw_preview_image_key IS NOT NULL);

CREATE TABLE recent_feed_state
(
    singleton          INTEGER PRIMARY KEY CHECK (singleton = 1),
    requested_revision INTEGER NOT NULL DEFAULT 1 CHECK (requested_revision >= 0),
    published_revision INTEGER NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
    generation         TEXT,
    root_key           TEXT,
    published_at       TEXT,
    lease_owner        TEXT,
    lease_expires_at   TEXT,
    bootstrap_revision INTEGER CHECK (bootstrap_revision IS NULL OR bootstrap_revision > 0),
    bootstrap_cursor_created_at TEXT,
    bootstrap_cursor_id TEXT,
    bootstrap_variant_roots_json TEXT,
    bootstrap_active_key TEXT,
    bootstrap_objects_written INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_objects_written >= 0),
    bootstrap_bytes_written INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_bytes_written >= 0),
    bootstrap_started_at TEXT,
    last_error         TEXT,
    updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((bootstrap_cursor_created_at IS NULL AND bootstrap_cursor_id IS NULL)
        OR (bootstrap_cursor_created_at IS NOT NULL AND bootstrap_cursor_id IS NOT NULL))
);

CREATE TABLE recent_feed_dirty_hours
(
    dirty_hour  TEXT PRIMARY KEY,
    revision    INTEGER NOT NULL CHECK (revision > 0),
    reason      TEXT    NOT NULL,
    urgent      INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (dirty_hour = '*' OR length(dirty_hour) = 13)
);

CREATE TABLE recent_feed_generations
(
    generation      TEXT PRIMARY KEY,
    through_revision INTEGER NOT NULL CHECK (through_revision > 0),
    root_key         TEXT    NOT NULL UNIQUE,
    item_counts_json TEXT    NOT NULL,
    object_count     INTEGER NOT NULL CHECK (object_count >= 0),
    byte_count       INTEGER NOT NULL CHECK (byte_count >= 0),
    published_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recent_feed_revocations
(
    media_id              TEXT PRIMARY KEY,
    visible_from_revision INTEGER CHECK (visible_from_revision IS NULL OR visible_from_revision > 0),
    revoked_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason                TEXT NOT NULL
);

CREATE INDEX idx_recent_feed_dirty_hours_revision
    ON recent_feed_dirty_hours (revision);

CREATE INDEX idx_recent_feed_generations_published_at
    ON recent_feed_generations (published_at DESC);

CREATE INDEX idx_recent_feed_revocations_revoked_at
    ON recent_feed_revocations (revoked_at DESC);

INSERT INTO recent_feed_state (singleton)
VALUES (1);

INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent)
VALUES ('*', 1, 'initial-build', 1);

CREATE TRIGGER recent_feed_after_media_insert
    AFTER INSERT
    ON character_media
BEGIN
    UPDATE recent_feed_state
    SET requested_revision = requested_revision + 1,
        updated_at         = CURRENT_TIMESTAMP
    WHERE singleton = 1;

    UPDATE recent_feed_revocations
    SET visible_from_revision = (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
        revoked_at            = CURRENT_TIMESTAMP,
        reason                = 'media-reinsert'
    WHERE media_id = NEW.id;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    VALUES (strftime('%Y-%m-%dT%H', NEW.created_at),
            (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
            'media-insert',
            CASE WHEN EXISTS (SELECT 1 FROM recent_feed_revocations WHERE media_id = NEW.id) THEN 1 ELSE 0 END,
            CURRENT_TIMESTAMP)
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;
END;

CREATE TRIGGER recent_feed_after_media_update
    AFTER UPDATE OF user_id, character_id,
        sfw_image_key, sfw_preview_image_key, sfw_content_type,
        sfw_width, sfw_height, sfw_preview_width, sfw_preview_height,
        sfw_review_status, sfw_approved_at,
        nsfw_image_key, nsfw_preview_image_key, nsfw_content_type,
        nsfw_width, nsfw_height, nsfw_preview_width, nsfw_preview_height,
        nsfw_review_status, nsfw_approved_at,
        created_at, updated_at
    ON character_media
    WHEN OLD.user_id IS NOT NEW.user_id
        OR OLD.character_id IS NOT NEW.character_id
        OR OLD.sfw_image_key IS NOT NEW.sfw_image_key
        OR OLD.sfw_preview_image_key IS NOT NEW.sfw_preview_image_key
        OR OLD.sfw_content_type IS NOT NEW.sfw_content_type
        OR OLD.sfw_width IS NOT NEW.sfw_width
        OR OLD.sfw_height IS NOT NEW.sfw_height
        OR OLD.sfw_preview_width IS NOT NEW.sfw_preview_width
        OR OLD.sfw_preview_height IS NOT NEW.sfw_preview_height
        OR OLD.sfw_review_status IS NOT NEW.sfw_review_status
        OR OLD.sfw_approved_at IS NOT NEW.sfw_approved_at
        OR OLD.nsfw_image_key IS NOT NEW.nsfw_image_key
        OR OLD.nsfw_preview_image_key IS NOT NEW.nsfw_preview_image_key
        OR OLD.nsfw_content_type IS NOT NEW.nsfw_content_type
        OR OLD.nsfw_width IS NOT NEW.nsfw_width
        OR OLD.nsfw_height IS NOT NEW.nsfw_height
        OR OLD.nsfw_preview_width IS NOT NEW.nsfw_preview_width
        OR OLD.nsfw_preview_height IS NOT NEW.nsfw_preview_height
        OR OLD.nsfw_review_status IS NOT NEW.nsfw_review_status
        OR OLD.nsfw_approved_at IS NOT NEW.nsfw_approved_at
        OR OLD.created_at IS NOT NEW.created_at
        OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
    UPDATE recent_feed_state
    SET requested_revision = requested_revision + 1,
        updated_at         = CURRENT_TIMESTAMP
    WHERE singleton = 1;

    INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
    VALUES (NEW.id,
            (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
            'media-update')
    ON CONFLICT(media_id) DO UPDATE SET visible_from_revision = excluded.visible_from_revision,
                                        revoked_at            = CURRENT_TIMESTAMP,
                                        reason                = excluded.reason;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    VALUES (strftime('%Y-%m-%dT%H', OLD.created_at),
            (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
            'media-update',
            1,
            CURRENT_TIMESTAMP)
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    SELECT strftime('%Y-%m-%dT%H', NEW.created_at),
           (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
           'media-update',
           1,
           CURRENT_TIMESTAMP
    WHERE strftime('%Y-%m-%dT%H', NEW.created_at) <> strftime('%Y-%m-%dT%H', OLD.created_at)
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;
END;

CREATE TRIGGER recent_feed_after_media_delete
    AFTER DELETE
    ON character_media
BEGIN
    INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
    VALUES (OLD.id, NULL, 'media-delete')
    ON CONFLICT(media_id) DO UPDATE SET visible_from_revision = NULL,
                                        revoked_at            = CURRENT_TIMESTAMP,
                                        reason                = excluded.reason;

    UPDATE recent_feed_state
    SET requested_revision = requested_revision + 1,
        updated_at         = CURRENT_TIMESTAMP
    WHERE singleton = 1;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    VALUES (strftime('%Y-%m-%dT%H', OLD.created_at),
            (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
            'media-delete',
            1,
            CURRENT_TIMESTAMP)
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;
END;

CREATE TRIGGER recent_feed_after_character_display_update
    AFTER UPDATE OF name, profile_image_key, user_id
    ON characters
    WHEN (OLD.name IS NOT NEW.name
        OR OLD.profile_image_key IS NOT NEW.profile_image_key
        OR OLD.user_id IS NOT NEW.user_id)
        AND EXISTS (SELECT 1 FROM character_media WHERE character_id = NEW.id)
BEGIN
    UPDATE recent_feed_state
    SET requested_revision = requested_revision + 1,
        updated_at         = CURRENT_TIMESTAMP
    WHERE singleton = 1;

    INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
    SELECT id,
           (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
           'character-display-update'
    FROM character_media
    WHERE character_id = NEW.id
    ON CONFLICT(media_id) DO UPDATE SET visible_from_revision = excluded.visible_from_revision,
                                        revoked_at            = CURRENT_TIMESTAMP,
                                        reason                = excluded.reason;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    SELECT DISTINCT strftime('%Y-%m-%dT%H', created_at),
                    (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
                    'character-display-update',
                    1,
                    CURRENT_TIMESTAMP
    FROM character_media
    WHERE character_id = NEW.id
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;
END;

CREATE TRIGGER recent_feed_after_user_display_update
    AFTER UPDATE OF username, profile_photo_key
    ON users
    WHEN (OLD.username IS NOT NEW.username OR OLD.profile_photo_key IS NOT NEW.profile_photo_key)
        AND EXISTS (SELECT 1 FROM character_media WHERE user_id = NEW.id)
BEGIN
    UPDATE recent_feed_state
    SET requested_revision = requested_revision + 1,
        updated_at         = CURRENT_TIMESTAMP
    WHERE singleton = 1;

    INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
    SELECT id,
           (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
           'user-display-update'
    FROM character_media
    WHERE user_id = NEW.id
    ON CONFLICT(media_id) DO UPDATE SET visible_from_revision = excluded.visible_from_revision,
                                        revoked_at            = CURRENT_TIMESTAMP,
                                        reason                = excluded.reason;

    INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent, updated_at)
    SELECT DISTINCT strftime('%Y-%m-%dT%H', created_at),
                    (SELECT requested_revision FROM recent_feed_state WHERE singleton = 1),
                    'user-display-update',
                    1,
                    CURRENT_TIMESTAMP
    FROM character_media
    WHERE user_id = NEW.id
    ON CONFLICT(dirty_hour) DO UPDATE SET revision   = excluded.revision,
                                          reason     = excluded.reason,
                                          urgent     = MAX(recent_feed_dirty_hours.urgent, excluded.urgent),
                                          updated_at = excluded.updated_at;
END;
