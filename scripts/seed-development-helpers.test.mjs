import {describe, expect, it} from 'vitest'
import {
    assertD1DatabaseIdentity,
    collectMediaObjectKeys,
    insertStatement,
    prepareCloneData,
    randomizeMediaApprovals,
    scrubUser,
} from './seed-development-helpers.mjs'

describe('development seed helpers', () => {
    it('accepts a D1 database only when its UUID and name match the target', () => {
        expect(() =>
            assertD1DatabaseIdentity(
                {uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', name: 'myoc-pr-123'},
                'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                'myoc-pr-123',
            ),
        ).not.toThrow()
        expect(() =>
            assertD1DatabaseIdentity(
                {uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'unrelated-database'},
                'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                'myoc-pr-123',
            ),
        ).toThrow('D1 target aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee is not the database named myoc-pr-123')
        expect(() =>
            assertD1DatabaseIdentity(
                {uuid: '11111111-2222-3333-4444-555555555555', name: 'myoc-pr-123'},
                'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                'myoc-pr-123',
            ),
        ).toThrow('D1 target aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee is not the database named myoc-pr-123')
    })

    it('removes authentication and account security data from a cloned user', () => {
        expect(
            scrubUser({
                id: 'user-1',
                username: 'Razeth',
                email: 'real@example.com',
                password_hash: 'real-hash',
                role: 'admin',
                banned_at: '2026-01-01',
                webauthn_user_id: 'credential-user',
                recovery_phrase_hash: 'recovery-hash',
            }),
        ).toMatchObject({
            email: 'clone-c6c289e49e9c05b2145860387b73bcb18df43fb09a1e4a4a9713c76c88bb541b@users.invalid',
            password_hash: 'passkey-only:development-clone',
            role: 'user',
            banned_at: null,
            webauthn_user_id: null,
            recovery_phrase_hash: null,
            secure_account_required: 0,
        })
    })

    it('creates an approved and pending mix for two or more image variants', () => {
        const rows = [
            {id: 'media-1', sfw_image_key: 'sfw-1', nsfw_image_key: null},
            {id: 'media-2', sfw_image_key: 'sfw-2', nsfw_image_key: 'nsfw-2'},
        ]
        const result = randomizeMediaApprovals(rows, 'test-seed', new Date('2026-01-02T03:04:05Z'))
        const statuses = result.flatMap((row) => [
            row.sfw_image_key ? row.sfw_review_status : null,
            row.nsfw_image_key ? row.nsfw_review_status : null,
        ])

        expect(statuses).toContain('approved')
        expect(statuses).toContain('pending')
        expect(result.filter((row) => row.sfw_review_status === 'pending').every((row) => row.sfw_approved_at === null)).toBe(true)
    })

    it('collects each referenced gallery and height chart object once', () => {
        const keys = collectMediaObjectKeys({
            users: [{id: 'user-1', profile_photo_key: 'photo'}],
            character_folders: [{id: 'folder-1', user_id: 'user-1', folder_image_key: 'avif-folder'}],
            characters: [
                {
                    id: 'character-1',
                    user_id: 'user-1',
                    profile_image_key: 'profile',
                    height_chart_json: JSON.stringify({image: {key: 'chart', contentType: 'image/png'}}),
                },
            ],
            character_media: [
                {
                    id: 'media-1',
                    user_id: 'user-1',
                    character_id: 'character-1',
                    sfw_image_key: 'full',
                    sfw_content_type: 'image/jpeg',
                    sfw_preview_image_key: 'small',
                    sfw_preview_content_type: 'image/avif',
                    nsfw_image_key: null,
                },
            ],
        })

        expect(keys).toEqual([
            'characters/user-1/character-1/height-chart/chart.png',
            'characters/user-1/character-1/media/media-1/sfw/full.jpg',
            'characters/user-1/character-1/media/media-1/sfw/preview/small.avif',
            'characters/user-1/character-1/profile/profile.webp',
            'characters/user-1/folders/folder-1/image/avif-folder.avif',
            'users/user-1/profile/photo.webp',
        ])
    })

    it('uses a bound, validated hex value for size chart IDs', () => {
        expect(
            insertStatement('characters', {
                id: 'character-1',
                __size_chart_id_hex: '001122aabbcc',
                user_id: 'user-1',
                name: 'Character',
                profile_image_key: 'profile-image',
            }),
        ).toEqual({
            sql: 'INSERT INTO characters (id, size_chart_id, user_id, name, profile_image_key) VALUES (?, unhex(?), ?, ?, ?)',
            params: ['character-1', '001122aabbcc', 'user-1', 'Character', 'profile-image'],
        })
    })

    it('does not mutate the fetched source data object', () => {
        const source = {users: [{id: 'user-1', username: 'Razeth'}], character_media: []}
        prepareCloneData(source, 'seed')
        expect(source.users[0]).toEqual({id: 'user-1', username: 'Razeth'})
    })
})
