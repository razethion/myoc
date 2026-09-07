CREATE TABLE character_folders
(
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,

    name             TEXT NOT NULL,
    parent_folder_id TEXT,

    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (parent_folder_id) REFERENCES character_folders (id) ON DELETE SET NULL,
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (trim(name) GLOB '[A-Za-z0-9]*'),
    CHECK (name NOT GLOB '*[^A-Za-z0-9 _''().-]*'),
    CHECK (parent_folder_id IS NULL OR length(parent_folder_id) BETWEEN 1 AND 128),
    CHECK (parent_folder_id IS NULL OR parent_folder_id <> id)
);

CREATE INDEX idx_character_folders_user_id
    ON character_folders (user_id);

CREATE INDEX idx_character_folders_user_parent_folder_id
    ON character_folders (user_id, parent_folder_id);

CREATE TABLE characters
(
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,

    name              TEXT NOT NULL,
    profile_image_key TEXT NOT NULL,
    folder_id         TEXT,

    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES character_folders (id) ON DELETE SET NULL,
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (trim(name) GLOB '[A-Za-z0-9]*'),
    CHECK (name NOT GLOB '*[^A-Za-z0-9 _''().-]*'),
    CHECK (length(profile_image_key) > 0),
    CHECK (folder_id IS NULL OR length(folder_id) BETWEEN 1 AND 128)
);

CREATE INDEX idx_characters_user_id
    ON characters (user_id);

CREATE INDEX idx_characters_user_folder_id
    ON characters (user_id, folder_id);

CREATE INDEX idx_characters_user_created_at
    ON characters (user_id, created_at);
