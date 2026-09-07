import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {characterHeightChartImageObjectKey} from '../media/url'
import {
    activeSizeChartImageBackfillWorkflowInstanceIds,
    countSizeChartImageBackfillCandidates,
    emptySizeChartImageBackfillSummary,
    getSizeChartImageBackfillCandidates,
    parseSizeChartImageBackfillSummary,
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
    it('accepts only complete stored summaries', () => {
        const valid = {
            totalImages: 10,
            processedImages: 6,
            replacedImages: 4,
            skippedImages: 1,
            failedImages: 1,
            lastError: 'One image failed.',
        }

        expect(parseSizeChartImageBackfillSummary(JSON.stringify(valid))).toEqual(valid)
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({totalImages: 10, processedImages: 6, replacedImages: 4}))).toEqual(
            emptySizeChartImageBackfillSummary(),
        )
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({...valid, failedImages: '1'}))).toEqual(
            emptySizeChartImageBackfillSummary(),
        )
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({...valid, skippedImages: -1}))).toEqual(
            emptySizeChartImageBackfillSummary(),
        )
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({...valid, unexpected: true}))).toEqual(
            emptySizeChartImageBackfillSummary(),
        )
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({...valid, processedImages: 1.5}))).toEqual(
            emptySizeChartImageBackfillSummary(),
        )
        expect(parseSizeChartImageBackfillSummary(JSON.stringify({...valid, lastError: 1}))).toEqual(emptySizeChartImageBackfillSummary())
        expect(parseSizeChartImageBackfillSummary(JSON.stringify([]))).toEqual(emptySizeChartImageBackfillSummary())
        expect(parseSizeChartImageBackfillSummary(null)).toEqual(emptySizeChartImageBackfillSummary())
        expect(parseSizeChartImageBackfillSummary('{invalid')).toEqual(emptySizeChartImageBackfillSummary())
    })

    it('lists workflow instances that can own the active segment', () => {
        expect(activeSizeChartImageBackfillWorkflowInstanceIds('run', 0)).toEqual(['run'])
        expect(activeSizeChartImageBackfillWorkflowInstanceIds('run', 250)).toEqual(['run', 'run-size-chart-segment-1'])
        expect(activeSizeChartImageBackfillWorkflowInstanceIds('run', 500)).toEqual([
            'run',
            'run-size-chart-segment-2',
            'run-size-chart-segment-1',
        ])
    })

    it('selects only legacy size chart images', async () => {
        await seedUser({id: 'chart-owner'})
        await seedCharacter({id: 'legacy-chart', userId: 'chart-owner', heightChartJson: chartJson('legacy')})
        await seedCharacter({id: 'avif-chart', userId: 'chart-owner', heightChartJson: chartJson('current', 'image/avif')})
        await seedCharacter({
            id: 'no-chart-image',
            userId: 'chart-owner',
            heightChartJson: chartJson('none').replace(/"image":\{[^}]+}/, '"image":null'),
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
        expect(bucket.put).toHaveBeenCalledWith(targetObjectKey, expect.any(Uint8Array), {
            httpMetadata: {
                cacheControl: 'public, max-age=300, must-revalidate',
                contentType: 'image/avif',
            },
        })
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

    it('finishes a replay after the replacement was already saved', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'replay-owner'
        const characterId = 'replay-chart'
        const originalJson = chartJson('legacy-image')
        const replacementJson = chartJson('replacement-image', 'image/avif')
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'legacy-image', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: replacementJson})
        await bucket.put(oldObjectKey, await createPngFile(3200, 1600).arrayBuffer())

        await expect(
            replaceSizeChartImage(backfillEnv(bucket), {
                characterId,
                userId,
                chartJson: originalJson,
                targetImageKey: 'replacement-image',
            }),
        ).resolves.toEqual({status: 'replaced'})

        expect(await bucket.head(oldObjectKey)).toBeNull()
    })

    it('skips a candidate that no longer contains a legacy image', async () => {
        const candidate = {
            characterId: 'skipped-chart',
            userId: 'skipped-owner',
            chartJson: chartJson('current-image', 'image/avif'),
            targetImageKey: 'unused-image',
        }

        await expect(replaceSizeChartImage(backfillEnv(createMockR2Bucket()), candidate)).resolves.toEqual({status: 'skipped'})
    })

    it('rejects an invalid source image before it publishes a replacement', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'invalid-source-owner'
        const characterId = 'invalid-source-chart'
        const originalJson = chartJson('invalid-image')
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'invalid-image', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: originalJson})
        await bucket.put(oldObjectKey, new Uint8Array([1, 2, 3]))

        await expect(
            replaceSizeChartImage(backfillEnv(bucket), {
                characterId,
                userId,
                chartJson: originalJson,
                targetImageKey: 'unused-image',
            }),
        ).rejects.toThrow(`The source size chart image is invalid: ${oldObjectKey}`)

        expect(bucket.put).toHaveBeenCalledOnce()
    })

    it('keeps a committed replacement when D1 reports an uncertain write', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'uncertain-write-owner'
        const characterId = 'uncertain-write-chart'
        const originalJson = chartJson('legacy-image')
        const candidate = {characterId, userId, chartJson: originalJson, targetImageKey: 'committed-image'}
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'legacy-image', 'image/png')
        const targetObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'committed-image', 'image/avif')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: originalJson})
        await bucket.put(oldObjectKey, await createPngFile(3200, 1600).arrayBuffer())

        const uncertainDb = databaseThatThrowsAfterCharacterUpdate(db)
        await expect(replaceSizeChartImage({...backfillEnv(bucket), DB: uncertainDb}, candidate)).resolves.toEqual({status: 'replaced'})

        expect(await bucket.head(oldObjectKey)).toBeNull()
        expect(await bucket.head(targetObjectKey)).not.toBeNull()
        const stored = await queryOne<{height_chart_json: string}>('SELECT height_chart_json FROM characters WHERE id = ?', [characterId])
        expect(JSON.parse(stored?.height_chart_json ?? 'null')).toMatchObject({image: {key: 'committed-image', contentType: 'image/avif'}})
    })

    it('removes an unpublished replacement when D1 rejects the write', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'rejected-write-owner'
        const characterId = 'rejected-write-chart'
        const originalJson = chartJson('legacy-image')
        const candidate = {characterId, userId, chartJson: originalJson, targetImageKey: 'rejected-image'}
        const oldObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'legacy-image', 'image/png')
        const targetObjectKey = characterHeightChartImageObjectKey(userId, characterId, 'rejected-image', 'image/avif')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId, heightChartJson: originalJson})
        await bucket.put(oldObjectKey, await createPngFile(3200, 1600).arrayBuffer())

        const rejectedDb = databaseThatRejectsCharacterUpdate(db)
        await expect(replaceSizeChartImage({...backfillEnv(bucket), DB: rejectedDb}, candidate)).rejects.toThrow('D1 rejected the write')

        expect(await bucket.head(oldObjectKey)).not.toBeNull()
        expect(await bucket.head(targetObjectKey)).toBeNull()
    })
})

function databaseThatThrowsAfterCharacterUpdate(database: D1Database): D1Database {
    return new Proxy(database, {
        get(target, property, receiver) {
            if (property !== 'prepare') return Reflect.get(target, property, receiver)

            return (query: string) => {
                const statement = target.prepare(query)
                if (!query.includes('UPDATE characters')) return statement

                return new Proxy(statement, {
                    get(statementTarget, statementProperty, statementReceiver) {
                        if (statementProperty !== 'bind') return Reflect.get(statementTarget, statementProperty, statementReceiver)

                        return (...values: unknown[]) => {
                            const bound = statementTarget.bind(...values)
                            return new Proxy(bound, {
                                get(boundTarget, boundProperty, boundReceiver) {
                                    if (boundProperty !== 'run') return Reflect.get(boundTarget, boundProperty, boundReceiver)
                                    return async () => {
                                        await boundTarget.run()
                                        throw new Error('D1 response was lost')
                                    }
                                },
                            })
                        }
                    },
                })
            }
        },
    })
}

function databaseThatRejectsCharacterUpdate(database: D1Database): D1Database {
    return new Proxy(database, {
        get(target, property, receiver) {
            if (property !== 'prepare') return Reflect.get(target, property, receiver)

            return (query: string) => {
                const statement = target.prepare(query)
                if (!query.includes('UPDATE characters')) return statement

                return new Proxy(statement, {
                    get(statementTarget, statementProperty, statementReceiver) {
                        if (statementProperty !== 'bind') return Reflect.get(statementTarget, statementProperty, statementReceiver)
                        return (..._values: unknown[]) => ({
                            run: async () => {
                                throw new Error('D1 rejected the write')
                            },
                        })
                    },
                })
            }
        },
    })
}
