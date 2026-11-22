-- Issue #254: usernames must be unique regardless of case.
-- The column-level UNIQUE constraint on users.username is case-sensitive,
-- so accounts like "Raz" and "raz" could both exist and impersonate each other.

-- Collapse existing case-insensitive duplicates before creating the unique
-- index so the migration succeeds on databases that already contain
-- collisions. The oldest account per case-insensitive name keeps its username.
-- Every newer duplicate is renamed to "<name prefix>_<first 8 chars of id>",
-- which stays within the username CHECK constraints (23 + 1 + 8 = 32) and
-- cannot collide with another renamed row because user ids are unique.
UPDATE users
SET username = substr(username, 1, 23) || '_' || substr(id, 1, 8)
WHERE EXISTS (
    SELECT 1
    FROM users AS older
    WHERE older.id <> users.id
      AND lower(older.username) = lower(users.username)
      AND (
          older.created_at < users.created_at
          OR (older.created_at = users.created_at AND older.id < users.id)
      )
);

CREATE UNIQUE INDEX idx_users_username_nocase
    ON users (username COLLATE NOCASE);
