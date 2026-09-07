import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {characterHeightChartImageObjectKey} from '../media/url'
import {
    countSizeChartImageBackfillCandidates,
    getSizeChartImageBackfillCandidates,
    replaceSizeChartImage,
    type SizeChartImageBackfillCandidate,
} from './sizeChartImageBackfill'

const db = useTestDatabase()

function chartJson(imageKey: string, contentType = 'image/png'): string {
    return JSON.stringify({
        version: 1,
        height: {meters: 1.83},
        image: {key: imageKey, contentType, naturalWidth: 3200, naturalHeight: 1600},
        calibration: {headYPercent: 7.25, footYPercent: 94.5, footIsVirtual: true, nameTagXPercent: 63},
        retainedField: 'keep-me',
    })
}

function createContainer(): Bindings['MYOC_DOCKER_SHARP_CONTAINER'] {
    const fetch = vi.fn(async () => new Response(createAvifBytes(1600, 800), {headers: {'content-type': 'image/avif'}}))
    return {
        idFromName: vi.fn(() => 'size-chart-container-id'),
        get: vi.fn(() => ({fetch})),
    } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']
}

function backfillEnv(bucket: R2Bucket): Bindings {
    return createWorkerEnv({
        DB: db,
        MEDIA_BUCKET: bucket,
        MYOC_DOCKER_SHARP_CONTAINER: createContainer(),
        PREVIEW_PROCESSOR_TOKEN: 'size-chart-test-token',
    })
}

describe('size chart image backfill', () => {
    it('selects only legacy size chart images', async () => {
        await seedUser({id: 'chart-owner'})
        await seedCharacter({id: 'legacy-chart', userId: 'chart-owner', heightChartJson: chartJson('legacy')})
        await seedCharacter({id: 'avif-chart', userId: 'chart-owner', heightChartJson: chartJson('current', 'image/avif')})
        await seedCharacter({
            id: 'no-chart-image',
            userId: 'chart-owner',
            heightChartJson: chartJson('none').replace(/"image":\{[^}]+\}/, '"image":null'),
        })

        expect(await countSizeChartImageBackfillCandidates(db)).toBe(1)
        const candidates = await getSizeChartImageBackfillCandidates(db, null)
        expect(candidates).toHaveLength(1)
        expect(candidates[0]).toMatchObject({characterId: 'legacy-chart', userId: 'chart-owner', chartJson: chartJson('legacy')})
        expect(candidates[0]?.targetImageKey).toBeTruthy()
    })

    it('replaces a legacy image and preserves the chart calibration', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'replace-owner'
        const characterId = 'replace-chart'
        const originalJson = chartJson('legacy-image')
        const candidate: SizeChartImageBackfillCandidate = {
            characterId,
            userId,
            chartJson: originalJson,
            targetImageKey: 'replacement-image',
        }
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: originalJson})
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'legacy-image', 'image/png')
        const targetObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'replacement-image', 'image/avif')
        await bucket.put(oldObjectKey, await createPngFile(3200, 1600).arrayBuffer())

        await expect(replaceSizeChartImage(backfillEnv(bucket), candidate)).resolves.toEqual({status: 'replaced'})

        const stored = await queryOne<{height_chart_json: string}>('SELECT height_chart_json FROM characters WHERE id = ?', [characterId])
        const parsed = JSON.parse(stored?.height_chart_json ?? 'null')
        expect(parsed).toMatchObject({
            height: {meters: 1.83},
            calibration: {headYPercent: 7.25, footYPercent: 94.5, footIsVirtual: true, nameTagXPercent: 63},
            retainedField: 'keep-me',
            image: {key: 'replacement-image', contentType: 'image/avif', naturalWidth: 1600, naturalHeight: 800},
        })
        expect(await bucket.head(oldObjectKey)).toBeNull()
        expect(await bucket.head(targetObjectKey)).not.toBeNull()
    })

    it('keeps a concurrent user replacement and removes its unused AVIF', async () => {
        const baseBucket = createMockR2Bucket()
        const userId = 'race-owner'
        const characterId = 'race-chart'
        const originalJson = chartJson('legacy-image')
        const userJson = chartJson('user-image', 'image/avif')
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'legacy-image', 'image/png')
        const targetObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'job-image', 'image/avif')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: originalJson})
        await baseBucket.put(oldObjectKey, await createPngFile(3200, 1600).arrayBuffer())
        let raceEnabled = true
        const bucket = new Proxy(baseBucket, {
            get(target, property, receiver) {
                if (property !== 'put') return Reflect.get(target, property, receiver)
                return async (...args: Parameters<R2Bucket['put']>) => {
                    const result = await target.put(...args)
                    if (raceEnabled && args[0] === targetObjectKey) {
                        raceEnabled = false
                        await db.prepare('UPDATE characters SET height_chart_json = ? WHERE id = ?').bind(userJson, characterId).run()
                    }
                    return result
                }
            },
        })

        await expect(
            replaceSizeChartImage(backfillEnv(bucket), {
                characterId,
                userId,
                chartJson: originalJson,
                targetImageKey: 'job-image',
            }),
        ).resolves.toEqual({status: 'skipped'})

        expect(await queryOne<{height_chart_json: string}>('SELECT height_chart_json FROM characters WHERE id = ?', [characterId])).toEqual(
            {
                height_chart_json: userJson,
            },
        )
        expect(await baseBucket.head(oldObjectKey)).not.toBeNull()
        expect(await baseBucket.head(targetObjectKey)).toBeNull()
    })
})
