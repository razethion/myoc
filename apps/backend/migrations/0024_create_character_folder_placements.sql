CREATE TABLE character_folder_placements
(
    user_id      TEXT    NOT NULL,
    folder_id    TEXT    NOT NULL,
    character_id TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (folder_id, character_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES character_folders (id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
    CHECK (length(folder_id) BETWEEN 1 AND 128),
    CHECK (length(character_id) BETWEEN 1 AND 128),
    CHECK (sort_order >= 0)
);

CREATE INDEX idx_character_folder_placements_user_folder_order
    ON character_folder_placements (user_id, folder_id, sort_order);

CREATE INDEX idx_character_folder_placements_user_character
    ON character_folder_placements (user_id, character_id);

INSERT OR IGNORE INTO character_folder_placements (user_id,
                                                   folder_id,
                                                   character_id,
                                                   sort_order,
                                                   created_at,
                                                   updated_at)
SELECT user_id,
       folder_id,
       id,
       sort_order,
       created_at,
       updated_at
FROM characters
WHERE folder_id IS NOT NULL;
