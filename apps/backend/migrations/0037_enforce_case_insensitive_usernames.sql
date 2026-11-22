-- Issue #254: usernames must be unique regardless of case.
-- The column-level UNIQUE constraint on users.username is case-sensitive,
-- so accounts like "Raz" and "raz" could both exist and impersonate each other.

-- Resolve existing case-insensitive duplicates before creating the unique
-- index, so the migration succeeds on databases that already contain
-- collisions. The oldest account per case-insensitive name keeps its username.
-- Every newer duplicate is renamed to "<name prefix>_<id hex>", using the
-- shortest id suffix length that produces a free name. Availability is
-- checked case-insensitively against every existing username. SQLite updates
-- rows one at a time, so each rename also sees earlier renames in this
-- statement and cannot collide with another replacement. Suffix lengths run
-- from 8 to 27 characters, so the result always stays within the 32-character
-- username limit. If no candidate is free, the subquery returns NULL and the
-- NOT NULL constraint aborts the migration instead of writing a colliding
-- name.
UPDATE users
SET username = (
    SELECT substr(users.username, 1, 31 - suffix.n) || '_' || substr(replace(users.id, '-', ''), 1, suffix.n)
    FROM (
        WITH RECURSIVE suffix_lengths(n) AS (
            SELECT 8
            UNION ALL
            SELECT n + 1 FROM suffix_lengths WHERE n < 27
        )
        SELECT n FROM suffix_lengths
    ) AS suffix
    WHERE NOT EXISTS (
        SELECT 1
        FROM users AS taken
        WHERE lower(taken.username) = lower(
            substr(users.username, 1, 31 - suffix.n) || '_' || substr(replace(users.id, '-', ''), 1, suffix.n)
        )
    )
    ORDER BY suffix.n
    LIMIT 1
)
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
