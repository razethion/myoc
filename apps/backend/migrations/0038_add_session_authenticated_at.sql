-- Issue #251: a stolen session must not become a persistent account takeover.
-- Sessions now record when the user last completed a full authentication.
-- Sensitive account changes require an authentication inside a recent window.
-- Login is the only writer of this column; daily session renewal never moves
-- it forward, so an old stolen session cannot age into eligibility.
-- Existing sessions inherit their creation time, which was their last full
-- authentication before this column existed.

ALTER TABLE sessions
    ADD COLUMN authenticated_at TEXT;

UPDATE sessions
SET authenticated_at = created_at
WHERE authenticated_at IS NULL;
