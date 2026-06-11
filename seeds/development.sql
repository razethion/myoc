-- Safe fake data for local development and PR previews.
-- Password for every seeded account: password123

INSERT OR IGNORE INTO users (
    id,
    email,
    username,
    password_hash,
    profile_photo_key,
    bio,
    created_at
) VALUES
    (
        'seed-user-demo',
        'demo@example.test',
        'demo',
        '$2b$10$6bayY7DO0rJ1M/iiWU.sWudNEKLZQ038jPlsYOikyHbVElK0YcMF6',
        NULL,
        'Demo account for checking the basic logged-in experience.',
        '2026-06-10 12:00:00'
    ),
    (
        'seed-user-artist',
        'artist@example.test',
        'artist',
        '$2b$10$hq4T.TiE83zOQjLiOllLZutmh6zBLhpclyjZo0Ntg6Spx9jY6dWpC',
        NULL,
        'Fake artist account for gallery and character workflow previews.',
        '2026-06-10 12:05:00'
    ),
    (
        'seed-user-collector',
        'collector@example.test',
        'collector',
        '$2b$10$.WSmCng5L0KCHzF26wVjRebIaUT0WFn0MOg4Dr6jWM7TZ4s28VW9m',
        NULL,
        'Fake collector account for browsing and organization previews.',
        '2026-06-10 12:10:00'
    );
