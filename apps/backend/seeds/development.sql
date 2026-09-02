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
        -- nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash -- Intentional fake local seed password hash for password123.
        '$2b$10$6bayY7DO0rJ1M/iiWU.sWudNEKLZQ038jPlsYOikyHbVElK0YcMF6',
        NULL,
        'Demo account for checking the basic logged-in experience.',
        '2026-06-10 12:00:00'
    ),
    (
        'seed-user-artist',
        'artist@example.test',
        'artist',
        -- nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash -- Intentional fake local seed password hash for password123.
        '$2b$10$hq4T.TiE83zOQjLiOllLZutmh6zBLhpclyjZo0Ntg6Spx9jY6dWpC',
        NULL,
        'Fake artist account for gallery and character workflow previews.',
        '2026-06-10 12:05:00'
    ),
    (
        'seed-user-collector',
        'collector@example.test',
        'collector',
        -- nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash -- Intentional fake local seed password hash for password123.
        '$2b$10$.WSmCng5L0KCHzF26wVjRebIaUT0WFn0MOg4Dr6jWM7TZ4s28VW9m',
        NULL,
        'Fake collector account for browsing and organization previews.',
        '2026-06-10 12:10:00'
    );

INSERT OR IGNORE INTO user_social_links (user_id,
                                         platform,
                                         label,
                                         url)
VALUES ('seed-user-demo', 'twitter', NULL, 'https://twitter.com/demo'),
       ('seed-user-demo', 'bluesky', NULL, 'https://bsky.app/profile/demo.example.test'),
       ('seed-user-demo', 'custom', 'Portfolio', 'https://example.test/demo'),
       ('seed-user-artist', 'furaffinity', NULL, 'https://www.furaffinity.net/user/artist'),
       ('seed-user-artist', 'telegram', NULL, 'https://t.me/artist'),
       ('seed-user-collector', 'instagram', NULL, 'https://instagram.com/collector');

INSERT OR IGNORE INTO character_folders (
    id,
    user_id,
    name,
    parent_folder_id,
    sort_order,
    created_at,
    updated_at
) VALUES
    (
        'seed-folder-demo-main',
        'seed-user-demo',
        'Main Characters',
        NULL,
        0,
        '2026-06-10 12:20:00',
        '2026-06-10 12:20:00'
    ),
    (
        'seed-folder-demo-story',
        'seed-user-demo',
        'Story Arc',
        'seed-folder-demo-main',
        0,
        '2026-06-10 12:21:00',
        '2026-06-10 12:21:00'
    ),
    (
        'seed-folder-demo-sale',
        'seed-user-demo',
        'For Sale',
        NULL,
        1,
        '2026-06-10 12:22:00',
        '2026-06-10 12:22:00'
    ),
    (
        'seed-folder-artist-commissions',
        'seed-user-artist',
        'Commission Queue',
        NULL,
        0,
        '2026-06-10 12:23:00',
        '2026-06-10 12:23:00'
    ),
    (
        'seed-folder-collector-archive',
        'seed-user-collector',
        'Archive',
        NULL,
        0,
        '2026-06-10 12:24:00',
        '2026-06-10 12:24:00'
    );

INSERT OR IGNORE INTO characters (
    id,
    size_chart_id,
    user_id,
    name,
    profile_image_key,
    folder_id,
    sort_order,
    created_at,
    updated_at
) VALUES
    (
        'seed-character-demo-vyn',
        X'000000000101',
        'seed-user-demo',
        'VYN',
        '11111111-1111-4111-8111-111111111111',
        'seed-folder-demo-story',
        0,
        '2026-06-10 12:30:00',
        '2026-06-10 12:30:00'
    ),
    (
        'seed-character-demo-ren',
        X'000000000102',
        'seed-user-demo',
        'REN',
        '22222222-2222-4222-8222-222222222222',
        'seed-folder-demo-story',
        1,
        '2026-06-10 12:31:00',
        '2026-06-10 12:31:00'
    ),
    (
        'seed-character-demo-razeth',
        X'000000000103',
        'seed-user-demo',
        'RAZETH',
        '33333333-3333-4333-8333-333333333333',
        'seed-folder-demo-main',
        0,
        '2026-06-10 12:32:00',
        '2026-06-10 12:32:00'
    ),
    (
        'seed-character-demo-lazarus',
        X'000000000104',
        'seed-user-demo',
        'LAZARUS',
        '44444444-4444-4444-8444-444444444444',
        'seed-folder-demo-main',
        1,
        '2026-06-10 12:33:00',
        '2026-06-10 12:33:00'
    ),
    (
        'seed-character-demo-ivo',
        X'000000000105',
        'seed-user-demo',
        'IVO',
        '55555555-5555-4555-8555-555555555555',
        'seed-folder-demo-sale',
        0,
        '2026-06-10 12:34:00',
        '2026-06-10 12:34:00'
    ),
    (
        'seed-character-demo-kitty',
        X'000000000106',
        'seed-user-demo',
        'KITTY',
        '66666666-6666-4666-8666-666666666666',
        NULL,
        0,
        '2026-06-10 12:35:00',
        '2026-06-10 12:35:00'
    ),
    (
        'seed-character-artist-mara',
        X'000000000107',
        'seed-user-artist',
        'Mara',
        '77777777-7777-4777-8777-777777777777',
        'seed-folder-artist-commissions',
        0,
        '2026-06-10 12:36:00',
        '2026-06-10 12:36:00'
    ),
    (
        'seed-character-collector-orbit',
        X'000000000108',
        'seed-user-collector',
        'Orbit',
        '88888888-8888-4888-8888-888888888888',
        'seed-folder-collector-archive',
        0,
        '2026-06-10 12:37:00',
        '2026-06-10 12:37:00'
    );

INSERT OR IGNORE INTO character_folder_placements (user_id,
                                                   folder_id,
                                                   character_id,
                                                   sort_order,
                                                   created_at,
                                                   updated_at)
VALUES ('seed-user-demo',
        'seed-folder-demo-story',
        'seed-character-demo-vyn',
        0,
        '2026-06-10 12:30:00',
        '2026-06-10 12:30:00'),
       ('seed-user-demo',
        'seed-folder-demo-story',
        'seed-character-demo-ren',
        1,
        '2026-06-10 12:31:00',
        '2026-06-10 12:31:00'),
       ('seed-user-demo',
        'seed-folder-demo-main',
        'seed-character-demo-razeth',
        0,
        '2026-06-10 12:32:00',
        '2026-06-10 12:32:00'),
       ('seed-user-demo',
        'seed-folder-demo-main',
        'seed-character-demo-lazarus',
        1,
        '2026-06-10 12:33:00',
        '2026-06-10 12:33:00'),
       ('seed-user-demo',
        'seed-folder-demo-main',
        'seed-character-demo-vyn',
        2,
        '2026-06-10 12:34:30',
        '2026-06-10 12:34:30'),
       ('seed-user-demo',
        'seed-folder-demo-sale',
        'seed-character-demo-ivo',
        0,
        '2026-06-10 12:34:00',
        '2026-06-10 12:34:00'),
       ('seed-user-artist',
        'seed-folder-artist-commissions',
        'seed-character-artist-mara',
        0,
        '2026-06-10 12:36:00',
        '2026-06-10 12:36:00'),
       ('seed-user-collector',
        'seed-folder-collector-archive',
        'seed-character-collector-orbit',
        0,
        '2026-06-10 12:37:00',
        '2026-06-10 12:37:00');
