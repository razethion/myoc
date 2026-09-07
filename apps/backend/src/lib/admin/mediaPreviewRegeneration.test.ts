import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import type {Bindings} from '../../types/bindings'
import {characterMediaImageObjectKey, characterMediaNsfwBlurImageObjectKey, characterMediaPreviewImageObjectKey} from '../media/url'
import {
    getMediaPreviewRegenerationCandidates,
    initializeMediaPreviewRegenerationDispatch,
    regenerateMediaPreviewCandidate,
} from './mediaPreviewRegeneration'

const db = useTestDatabase()
const userId = 'preview-owner'
const characterId = 'preview-character'
const mediaId = 'preview-media'
const mediaPublicBaseUrl: Bindings['MEDIA_PUBLIC_BASE_URL'] = 'https://m.myoc.art'

function createMockPreviewContainer(
    responses: Response | Error | Array<Response | Error> = new Response(createAvifBytes(100, 80), {
        headers: {'content-type': 'image/avif'},
    }),
): Bindings['MYOC_DOCKER_SHARP_CONTAINER'] {
    const responseSequence = Array.isArray(responses) ? responses : [responses]
    let responseIndex = 0
    const fetch = vi.fn(async () => {
        const response = responseSequence[Math.min(responseIndex, responseSequence.length - 1)]
        responseIndex += 1

        if (response instanceof Error) throw response
        if (!response) throw new Error('Missing mocked container response')
        return response.clone()
    })

    return {
        idFromName: vi.fn(() => 'preview-container-id'),
        get: vi.fn(() => ({fetch})),
    } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']
}

function regenerationEnv(bucket: R2Bucket, previewContainer = createMockPreviewContainer()) {
    return {
        DB: db,
        MEDIA_BUCKET: bucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        MYOC_DOCKER_SHARP_CONTAINER: previewContainer,
        PREVIEW_PROCESSOR_TOKEN: 'preview-token',
    }
}

async function pngBytes(width = 100, height = 80): Promise<Uint8Array> {
    return new Uint8Array(await createPngFile(width, height).arrayBuffer())
}

async function seedPreviewMedia(): Promise<void> {
    await seedUser({id: userId, email: 'preview@example.test', username: 'preview_owner'})
    await seedCharacter({id: characterId, userId, name: 'Preview Character'})
    await seedMedia({
        id: mediaId,
        userId,
        characterId,
        sfwImageKey: 'sfw-source',
        sfwContentType: null,
        sfwPreviewImageKey: 'sfw-old-preview',
        sfwPreviewContentType: 'image/webp',
        sfwPreviewWidth: 90,
        sfwPreviewHeight: 72,
        sfwPreviewByteSize: 100,
        sfwReviewStatus: 'approved',
        sfwReviewedAt: '2026-07-01 01:00:00',
        sfwApprovedAt: '2026-07-01 01:00:00',
        sfwHomepageAllowed: true,
        nsfwImageKey: 'nsfw-source',
        nsfwPreviewImageKey: 'nsfw-old-preview',
        nsfwPreviewContentType: 'image/webp',
        nsfwPreviewWidth: 90,
        nsfwPreviewHeight: 72,
        nsfwPreviewByteSize: 100,
        nsfwBlurImageKey: 'nsfw-old-blur',
        nsfwBlurContentType: 'image/webp',
        nsfwReviewStatus: 'approved',
        nsfwReviewedAt: '2026-07-01 02:00:00',
        nsfwApprovedAt: '2026-07-01 02:00:00',
        updatedAt: '2026-07-01 03:00:00',
    })
}

async function createRegenerationFixture(rating: 'sfw' | 'nsfw') {
    await seedPreviewMedia()
    const bucket = createMockR2Bucket()
    await bucket.put(characterMediaImageObjectKey(userId, characterId, mediaId, `${rating}-source`, rating, 'image/png'), await pngBytes())
    const candidate = (await getMediaPreviewRegenerationCandidates(db, null)).find((item) => item.rating === rating)

    if (!candidate) throw new Error(`Expected an ${rating.toUpperCase()} regeneration candidate`)
    return {bucket, candidate}
}

describe('media preview regeneration', () => {
    it('returns ordered candidates after a cursor and ignores media with an empty image key', async () => {
        await seedPreviewMedia()
        await seedMedia({
            id: 'empty-source-key',
            userId,
            characterId,
            sfwImageKey: 'temporary-source-key',
            nsfwImageKey: null,
        })
        await db.prepare("UPDATE character_media SET sfw_image_key = '' WHERE id = ?").bind('empty-source-key').run()

        const candidates = await getMediaPreviewRegenerationCandidates(db, null)
        expect(candidates.map((candidate) => [candidate.mediaId, candidate.rating])).toEqual([
            [mediaId, 'sfw'],
            [mediaId, 'nsfw'],
        ])
        expect(candidates[0]).toMatchObject({
            imageContentType: 'image/png',
            previousPreviewContentType: 'image/webp',
            previousBlurContentType: 'image/webp',
            targetBlurKey: null,
        })

        await expect(getMediaPreviewRegenerationCandidates(db, {mediaId, ratingOrder: 0})).resolves.toMatchObject([
            {mediaId, rating: 'nsfw', ratingOrder: 1},
        ])
        await expect(getMediaPreviewRegenerationCandidates(db, {mediaId, ratingOrder: 1})).resolves.toEqual([])
    })

    it('selects only variants with a missing or non-AVIF preview or NSFW blur', async () => {
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({
            id: 'a-valid',
            userId,
            characterId,
            sfwPreviewImageKey: 'sfw-preview',
            sfwPreviewContentType: 'image/avif',
            nsfwImageKey: 'nsfw-source',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwPreviewContentType: 'image/avif',
            nsfwBlurImageKey: 'nsfw-blur',
            nsfwBlurContentType: 'image/avif',
        })
        await seedMedia({
            id: 'b-preview-webp',
            userId,
            characterId,
            sfwPreviewImageKey: 'sfw-preview',
            sfwPreviewContentType: 'image/webp',
        })
        await seedMedia({
            id: 'c-preview-missing',
            userId,
            characterId,
            sfwPreviewImageKey: null,
            sfwPreviewContentType: 'image/avif',
        })
        await seedMedia({
            id: 'd-preview-empty',
            userId,
            characterId,
            sfwPreviewImageKey: '',
            sfwPreviewContentType: 'image/avif',
        })
        await seedMedia({
            id: 'e-both-invalid',
            userId,
            characterId,
            sfwPreviewImageKey: null,
            sfwPreviewContentType: 'image/avif',
            nsfwImageKey: 'nsfw-source',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwPreviewContentType: 'image/webp',
            nsfwBlurImageKey: 'nsfw-blur',
            nsfwBlurContentType: 'image/avif',
        })
        await seedMedia({
            id: 'f-nsfw-blur-missing',
            userId,
            characterId,
            sfwPreviewImageKey: 'sfw-preview',
            sfwPreviewContentType: 'image/avif',
            nsfwImageKey: 'nsfw-source',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwPreviewContentType: 'image/avif',
            nsfwBlurImageKey: null,
            nsfwBlurContentType: 'image/avif',
        })
        await seedMedia({
            id: 'g-nsfw-blur-webp',
            userId,
            characterId,
            sfwImageKey: null,
            nsfwImageKey: 'nsfw-source',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwPreviewContentType: 'image/avif',
            nsfwBlurImageKey: 'nsfw-blur',
            nsfwBlurContentType: 'image/webp',
        })

        const candidates = await getMediaPreviewRegenerationCandidates(db, null, true)

        expect(candidates.map(({mediaId: candidateMediaId, rating}) => [candidateMediaId, rating])).toEqual([
            ['b-preview-webp', 'sfw'],
            ['c-preview-missing', 'sfw'],
            ['d-preview-empty', 'sfw'],
            ['e-both-invalid', 'sfw'],
            ['e-both-invalid', 'nsfw'],
            ['f-nsfw-blur-missing', 'nsfw'],
            ['g-nsfw-blur-webp', 'nsfw'],
        ])

        const runId = crypto.randomUUID()
        await db
            .prepare(
                `INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at)
                 VALUES (?, 'media-preview-regeneration', 'manual', 'running', CURRENT_TIMESTAMP)`,
            )
            .bind(runId)
            .run()

        await expect(initializeMediaPreviewRegenerationDispatch(db, runId, true)).resolves.toMatchObject({totalVariants: 7})
    })

    it('paginates sparse invalid variants without stopping at valid AVIF rows', async () => {
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({
            id: 'page-0000',
            userId,
            characterId,
            sfwPreviewImageKey: 'sfw-preview',
            sfwPreviewContentType: 'image/avif',
        })

        for (let index = 1; index <= 101; index += 1) {
            await seedMedia({
                id: `page-${String(index).padStart(4, '0')}`,
                userId,
                characterId,
                sfwPreviewImageKey: null,
                sfwPreviewContentType: 'image/avif',
            })
        }

        const first = await getMediaPreviewRegenerationCandidates(db, null, true)
        const last = first.at(-1)
        if (!last) throw new Error('Expected a full first candidate page')
        const second = await getMediaPreviewRegenerationCandidates(db, {mediaId: last.mediaId, ratingOrder: last.ratingOrder}, true)

        expect(first).toHaveLength(100)
        expect(first[0]).toMatchObject({mediaId: 'page-0001', rating: 'sfw'})
        expect(last).toMatchObject({mediaId: 'page-0100', rating: 'sfw'})
        expect(second).toMatchObject([{mediaId: 'page-0101', rating: 'sfw'}])
    })

    it('replaces SFW previews and NSFW previews and blurs without changing review data', async () => {
        await seedPreviewMedia()
        const bucket = createMockR2Bucket()
        const sourceBytes = await pngBytes()
        const oldSfwPreview = characterMediaPreviewImageObjectKey(userId, characterId, mediaId, 'sfw-old-preview', 'sfw', 'image/webp')
        const oldNsfwPreview = characterMediaPreviewImageObjectKey(userId, characterId, mediaId, 'nsfw-old-preview', 'nsfw', 'image/webp')
        const oldNsfwBlur = characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, 'nsfw-old-blur', 'image/webp')
        await Promise.all([
            bucket.put(characterMediaImageObjectKey(userId, characterId, mediaId, 'sfw-source', 'sfw', 'image/png'), sourceBytes),
            bucket.put(characterMediaImageObjectKey(userId, characterId, mediaId, 'nsfw-source', 'nsfw', 'image/png'), sourceBytes),
            bucket.put(oldSfwPreview, createAvifBytes(90, 72)),
            bucket.put(oldNsfwPreview, createAvifBytes(90, 72)),
            bucket.put(oldNsfwBlur, createAvifBytes(90, 72)),
        ])
        const candidates = await getMediaPreviewRegenerationCandidates(db, null)
        const env = regenerationEnv(bucket)

        expect(candidates).toHaveLength(2)
        await expect(Promise.all(candidates.map(async (candidate) => regenerateMediaPreviewCandidate(env, candidate)))).resolves.toEqual([
            {status: 'regenerated', regeneratedBlur: false, error: null},
            {status: 'regenerated', regeneratedBlur: true, error: null},
        ])

        const row = await queryOne<{
            sfw_preview_image_key: string
            sfw_preview_content_type: string
            sfw_preview_width: number
            sfw_preview_height: number
            sfw_review_status: string
            sfw_reviewed_at: string
            sfw_approved_at: string
            sfw_homepage_allowed: number
            nsfw_preview_image_key: string
            nsfw_preview_content_type: string
            nsfw_blur_image_key: string
            nsfw_blur_content_type: string
            nsfw_review_status: string
            nsfw_reviewed_at: string
            nsfw_approved_at: string
            updated_at: string
        }>(
            `SELECT sfw_preview_image_key,
                    sfw_preview_content_type,
                    sfw_preview_width,
                    sfw_preview_height,
                    sfw_review_status,
                    sfw_reviewed_at,
                    sfw_approved_at,
                    sfw_homepage_allowed,
                    nsfw_preview_image_key,
                    nsfw_preview_content_type,
                    nsfw_blur_image_key,
                    nsfw_blur_content_type,
                    nsfw_review_status,
                    nsfw_reviewed_at,
                    nsfw_approved_at,
                    updated_at
             FROM character_media
             WHERE id = ?`,
            [mediaId],
        )
        expect(row).toMatchObject({
            sfw_preview_image_key: candidates[0]?.targetPreviewKey,
            sfw_preview_content_type: 'image/avif',
            sfw_preview_width: 100,
            sfw_preview_height: 80,
            sfw_review_status: 'approved',
            sfw_reviewed_at: '2026-07-01 01:00:00',
            sfw_approved_at: '2026-07-01 01:00:00',
            sfw_homepage_allowed: 1,
            nsfw_preview_image_key: candidates[1]?.targetPreviewKey,
            nsfw_preview_content_type: 'image/avif',
            nsfw_blur_image_key: candidates[1]?.targetBlurKey,
            nsfw_blur_content_type: 'image/avif',
            nsfw_review_status: 'approved',
            nsfw_reviewed_at: '2026-07-01 02:00:00',
            nsfw_approved_at: '2026-07-01 02:00:00',
            updated_at: '2026-07-01 03:00:00',
        })
        await expect(bucket.get(oldSfwPreview)).resolves.not.toBeNull()
        await expect(bucket.get(oldNsfwPreview)).resolves.not.toBeNull()
        await expect(bucket.get(oldNsfwBlur)).resolves.not.toBeNull()
    })

    it('keeps the current database references when another update wins the publish race', async () => {
        const {bucket, candidate} = await createRegenerationFixture('sfw')
        await db.prepare(`UPDATE character_media SET sfw_preview_image_key = 'newer-preview' WHERE id = ?`).bind(mediaId).run()
        const result = await regenerateMediaPreviewCandidate(regenerationEnv(bucket), candidate)

        expect(result).toEqual({status: 'skipped', regeneratedBlur: false, error: null})
        const row = await queryOne<{sfw_preview_image_key: string}>('SELECT sfw_preview_image_key FROM character_media WHERE id = ?', [
            mediaId,
        ])
        expect(row?.sfw_preview_image_key).toBe('newer-preview')
        await expect(
            bucket.get(characterMediaPreviewImageObjectKey(userId, characterId, mediaId, candidate.targetPreviewKey, 'sfw', 'image/avif')),
        ).resolves.toBeNull()
    })

    it('skips a task when its source key changed after dispatch', async () => {
        await seedPreviewMedia()
        const bucket = createMockR2Bucket()
        const candidate = (await getMediaPreviewRegenerationCandidates(db, null))[0]

        if (!candidate) throw new Error('Expected an SFW regeneration candidate')
        await db.prepare(`UPDATE character_media SET sfw_image_key = 'new-source' WHERE id = ?`).bind(mediaId).run()

        await expect(regenerateMediaPreviewCandidate(regenerationEnv(bucket), candidate)).resolves.toEqual({
            status: 'skipped',
            regeneratedBlur: false,
            error: null,
        })
    })

    it('does not delete a published target when a duplicate attempt fails', async () => {
        const {bucket, candidate} = await createRegenerationFixture('sfw')
        const targetKey = characterMediaPreviewImageObjectKey(userId, characterId, mediaId, candidate.targetPreviewKey, 'sfw', 'image/avif')
        const publishedBytes = createAvifBytes(100, 80)
        await bucket.put(targetKey, publishedBytes)
        await db
            .prepare(`UPDATE character_media SET sfw_preview_image_key = ?, sfw_preview_content_type = 'image/avif' WHERE id = ?`)
            .bind(candidate.targetPreviewKey, mediaId)
            .run()

        await expect(
            regenerateMediaPreviewCandidate(
                regenerationEnv(bucket, createMockPreviewContainer(new Error('Container stopped'))),
                candidate,
                {
                    maxContainerAttempts: 1,
                },
            ),
        ).rejects.toThrow('Container stopped')
        const stored = await bucket.get(targetKey)
        expect(stored && new Uint8Array(await stored.arrayBuffer())).toEqual(publishedBytes)
    })

    it('does not delete published NSFW targets when a duplicate attempt fails', async () => {
        const {bucket, candidate} = await createRegenerationFixture('nsfw')

        if (!candidate.targetBlurKey) throw new Error('Expected an NSFW regeneration candidate')
        const previewKey = characterMediaPreviewImageObjectKey(
            userId,
            characterId,
            mediaId,
            candidate.targetPreviewKey,
            'nsfw',
            'image/avif',
        )
        const blurKey = characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, candidate.targetBlurKey, 'image/avif')
        const publishedBytes = createAvifBytes(100, 80)
        await Promise.all([bucket.put(previewKey, publishedBytes), bucket.put(blurKey, publishedBytes)])
        await db
            .prepare(
                `UPDATE character_media
                 SET nsfw_preview_image_key = ?,
                     nsfw_preview_content_type = 'image/avif',
                     nsfw_blur_image_key = ?,
                     nsfw_blur_content_type = 'image/avif'
                 WHERE id = ?`,
            )
            .bind(candidate.targetPreviewKey, candidate.targetBlurKey, mediaId)
            .run()

        await expect(
            regenerateMediaPreviewCandidate(
                regenerationEnv(bucket, createMockPreviewContainer(new Error('Container stopped'))),
                candidate,
                {
                    maxContainerAttempts: 1,
                },
            ),
        ).rejects.toThrow('Container stopped')
        await expect(bucket.get(previewKey)).resolves.not.toBeNull()
        await expect(bucket.get(blurKey)).resolves.not.toBeNull()
    })

    it('records a missing original as a failed item and leaves the old preview in place', async () => {
        await seedPreviewMedia()
        const bucket = createMockR2Bucket()
        const candidate = (await getMediaPreviewRegenerationCandidates(db, null))[0]

        if (!candidate) {
            throw new Error('Expected an SFW regeneration candidate')
        }
        const result = await regenerateMediaPreviewCandidate(regenerationEnv(bucket), candidate)

        expect(result).toMatchObject({status: 'failed', regeneratedBlur: false})
        expect(result.error).toContain('source image is missing or invalid')
        const row = await queryOne<{sfw_preview_image_key: string}>('SELECT sfw_preview_image_key FROM character_media WHERE id = ?', [
            mediaId,
        ])
        expect(row?.sfw_preview_image_key).toBe('sfw-old-preview')
    })

    it('removes newly written objects when NSFW blur generation fails', async () => {
        const {bucket, candidate} = await createRegenerationFixture('nsfw')

        if (!candidate.targetBlurKey) {
            throw new Error('Expected an NSFW regeneration candidate')
        }

        const container = createMockPreviewContainer([
            new Response(createAvifBytes(100, 80), {headers: {'content-type': 'image/avif'}}),
            new Response(null, {status: 400}),
        ])
        await expect(regenerateMediaPreviewCandidate(regenerationEnv(bucket, container), candidate)).rejects.toThrow(
            'Container blur failed with 400',
        )
        await expect(
            bucket.get(characterMediaPreviewImageObjectKey(userId, characterId, mediaId, candidate.targetPreviewKey, 'nsfw', 'image/avif')),
        ).resolves.toBeNull()
        await expect(
            bucket.get(characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, candidate.targetBlurKey, 'image/avif')),
        ).resolves.toBeNull()
        const row = await queryOne<{nsfw_preview_image_key: string; nsfw_blur_image_key: string}>(
            'SELECT nsfw_preview_image_key, nsfw_blur_image_key FROM character_media WHERE id = ?',
            [mediaId],
        )
        expect(row).toEqual({nsfw_preview_image_key: 'nsfw-old-preview', nsfw_blur_image_key: 'nsfw-old-blur'})
    })
})
