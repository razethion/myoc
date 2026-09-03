import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockR2Bucket} from '../../test/mockR2'
import type {Bindings} from '../../types/bindings'
import {characterMediaImageObjectKey, characterMediaNsfwBlurImageObjectKey, characterMediaPreviewImageObjectKey} from '../media/url'
import {
    applyMediaPreviewRegenerationResults,
    emptyMediaPreviewRegenerationSummary,
    getMediaPreviewRegenerationCandidates,
    initializeMediaPreviewRegenerationSummary,
    regenerateMediaPreviewCandidate,
} from './mediaPreviewRegeneration'

const db = useTestDatabase()
const userId = 'preview-owner'
const characterId = 'preview-character'
const mediaId = 'preview-media'
const mediaPublicBaseUrl: Bindings['MEDIA_PUBLIC_BASE_URL'] = 'https://m.myoc.art'

function createMockPreviewContainer(width: number, height: number): Bindings['MYOC_DOCKER_SHARP_CONTAINER'] {
    const fetch = vi.fn(async () => {
        return new Response(createAvifBytes(width, height), {
            headers: {'content-type': 'image/avif'},
        })
    })

    return {
        idFromName: vi.fn(() => 'preview-container-id'),
        get: vi.fn(() => ({fetch})),
    } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']
}

function regenerationEnv(bucket: R2Bucket, images: ImagesBinding | undefined = createMockImagesBinding()) {
    return {
        DB: db,
        IMAGES: images,
        MEDIA_BUCKET: bucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        MYOC_DOCKER_SHARP_CONTAINER: createMockPreviewContainer(100, 80),
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

describe('media preview regeneration', () => {
    it('initializes and accumulates the regeneration progress summary', async () => {
        expect(emptyMediaPreviewRegenerationSummary()).toEqual({
            totalVariants: 0,
            processedVariants: 0,
            regeneratedPreviews: 0,
            regeneratedBlurs: 0,
            skippedVariants: 0,
            failedVariants: 0,
            lastError: null,
        })
        await expect(initializeMediaPreviewRegenerationSummary(db)).resolves.toMatchObject({totalVariants: 0})

        await seedPreviewMedia()

        const summary = await initializeMediaPreviewRegenerationSummary(db)
        expect(summary).toMatchObject({totalVariants: 2})
        expect(
            applyMediaPreviewRegenerationResults(summary, [
                {status: 'regenerated', regeneratedBlur: false, error: null},
                {status: 'regenerated', regeneratedBlur: true, error: null},
                {status: 'skipped', regeneratedBlur: false, error: null},
                {status: 'failed', regeneratedBlur: false, error: 'Preview processor is unavailable'},
            ]),
        ).toEqual({
            totalVariants: 2,
            processedVariants: 4,
            regeneratedPreviews: 2,
            regeneratedBlurs: 1,
            skippedVariants: 1,
            failedVariants: 1,
            lastError: 'Preview processor is unavailable',
        })
    })

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
        }>('SELECT * FROM character_media WHERE id = ?', [mediaId])
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
        await seedPreviewMedia()
        const bucket = createMockR2Bucket()
        await bucket.put(characterMediaImageObjectKey(userId, characterId, mediaId, 'sfw-source', 'sfw', 'image/png'), await pngBytes())
        const candidate = (await getMediaPreviewRegenerationCandidates(db, null))[0]

        if (!candidate) {
            throw new Error('Expected an SFW regeneration candidate')
        }
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
        await seedPreviewMedia()
        const bucket = createMockR2Bucket()
        await bucket.put(characterMediaImageObjectKey(userId, characterId, mediaId, 'nsfw-source', 'nsfw', 'image/png'), await pngBytes())
        const candidate = (await getMediaPreviewRegenerationCandidates(db, null))[1]

        if (!candidate?.targetBlurKey) {
            throw new Error('Expected an NSFW regeneration candidate')
        }

        await expect(regenerateMediaPreviewCandidate(regenerationEnv(bucket, null as unknown as ImagesBinding), candidate)).rejects.toThrow(
            'Cloudflare Images binding is not configured.',
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
