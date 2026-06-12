CREATE UNIQUE INDEX idx_characters_user_name_unique
    ON characters (user_id, name COLLATE NOCASE);
