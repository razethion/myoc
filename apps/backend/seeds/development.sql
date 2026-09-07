-- Safe fake login for local development and PR previews.
-- Password: password123

INSERT INTO users (
    id,
    email,
    username,
    password_hash,
    profile_photo_key,
    bio,
    created_at
) VALUES (
    'seed-user-demo',
    'demo@example.test',
    'demo',
    -- nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash -- Intentional fake local seed password hash for password123.
    '$2b$10$6bayY7DO0rJ1M/iiWU.sWudNEKLZQ038jPlsYOikyHbVElK0YcMF6',
    NULL,
    '',
    '2026-06-10 12:00:00'
);
