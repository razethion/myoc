import type {Bindings} from '../../types/bindings'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../media/cacheControl'
import {type HeightChartJson, parseHeightChartJson} from '../media/heightChart'
import {readGalleryImageMetadata} from '../media/imageMetadata'
import {generateHeightChartImageWithContainer} from '../media/previewGeneration'
import {characterHeightChartImageObjectKey} from '../media/url'

export const SIZE_CHART_IMAGE_BACKFILL_BATCH_SIZE = 25
export const SIZE_CHART_IMAGE_BACKFILL_ITEMS_PER_WORKFLOW = 250

export type SizeChartImageBackfillSummary = {
    totalImages: number
    processedImages: number
    replacedImages: number
    skippedImages: number
    failedImages: number
    lastError: string | null
}

export type SizeChartImageBackfillCandidate = {
    characterId: string
    userId: string
    chartJson: string
    targetImageKey: string
}

export type SizeChartImageBackfillResult = {status: 'replaced'} | {status: 'skipped'}

type BackfillEnv = Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

const CANDIDATE_WHERE = `json_valid(height_chart_json)
    AND json_type(height_chart_json, '$.image') = 'object'
    AND COALESCE(lower(json_extract(height_chart_json, '$.image.contentType')), 'image/png') <> 'image/avif'`

export function emptySizeChartImageBackfillSummary(): SizeChartImageBackfillSummary {
    return {
        totalImages: 0,
        processedImages: 0,
        replacedImages: 0,
        skippedImages: 0,
        failedImages: 0,
        lastError: null,
    }
}

export function sizeChartImageBackfillWorkflowInstanceId(runId: string, segment: number): string {
    return segment === 0 ? runId : `${runId}-size-chart-segment-${segment}`
}

export function activeSizeChartImageBackfillWorkflowInstanceIds(runId: string, processedImages: number): string[] {
    const segment = Math.floor(processedImages / SIZE_CHART_IMAGE_BACKFILL_ITEMS_PER_WORKFLOW)
    const ids = new Set([runId])
    if (segment > 0) ids.add(sizeChartImageBackfillWorkflowInstanceId(runId, segment))
    if (segment > 1) ids.add(sizeChartImageBackfillWorkflowInstanceId(runId, segment - 1))
    return [...ids]
}

export function parseSizeChartImageBackfillSummary(value: string | null): SizeChartImageBackfillSummary {
    if (value) {
        try {
            const parsed = JSON.parse(value) as unknown
            if (isSizeChartImageBackfillSummary(parsed)) return parsed
        } catch {
            // Use an empty summary if the stored job data is invalid.
        }
    }
    return emptySizeChartImageBackfillSummary()
}

function isSizeChartImageBackfillSummary(value: unknown): value is SizeChartImageBackfillSummary {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

    const summary = value as Record<string, unknown>
    const keys = Object.keys(summary)
    return (
        keys.length === 6 &&
        keys.every((key) => SIZE_CHART_IMAGE_BACKFILL_SUMMARY_KEYS.has(key)) &&
        isNonnegativeInteger(summary.totalImages) &&
        isNonnegativeInteger(summary.processedImages) &&
        isNonnegativeInteger(summary.replacedImages) &&
        isNonnegativeInteger(summary.skippedImages) &&
        isNonnegativeInteger(summary.failedImages) &&
        (typeof summary.lastError === 'string' || summary.lastError === null)
    )
}

const SIZE_CHART_IMAGE_BACKFILL_SUMMARY_KEYS = new Set([
    'totalImages',
    'processedImages',
    'replacedImages',
    'skippedImages',
    'failedImages',
    'lastError',
])

function isNonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export async function countSizeChartImageBackfillCandidates(db: D1Database): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM characters WHERE ${CANDIDATE_WHERE}`).first<{count: number}>()
    return Number(row?.count ?? 0)
}

export async function getSizeChartImageBackfillCandidates(
    db: D1Database,
    cursor: string | null,
    limit = SIZE_CHART_IMAGE_BACKFILL_BATCH_SIZE,
): Promise<SizeChartImageBackfillCandidate[]> {
    const result = await db
        .prepare(
            `SELECT id, user_id, height_chart_json
             FROM characters
             WHERE id > ?
               AND ${CANDIDATE_WHERE}
             ORDER BY id
             LIMIT ?`,
        )
        .bind(cursor ?? '', limit)
        .all<{id: string; user_id: string; height_chart_json: string}>()

    return result.results.map((row) => ({
        characterId: row.id,
        userId: row.user_id,
        chartJson: row.height_chart_json,
        targetImageKey: crypto.randomUUID(),
    }))
}

export async function replaceSizeChartImage(
    env: BackfillEnv,
    candidate: SizeChartImageBackfillCandidate,
): Promise<SizeChartImageBackfillResult> {
    const chart = parseHeightChartJson(candidate.chartJson)
    if (!chart?.image || chart.image.contentType.toLowerCase() === 'image/avif') {
        return {status: 'skipped'}
    }

    const oldObjectKey = characterHeightChartImageObjectKey(
        candidate.userId,
        candidate.characterId,
        chart.image.key,
        chart.image.contentType,
    )
    const targetObjectKey = characterHeightChartImageObjectKey(
        candidate.userId,
        candidate.characterId,
        candidate.targetImageKey,
        'image/avif',
    )
    const currentBeforeConversion = await readCurrentChart(env.DB, candidate.characterId, candidate.userId)
    if (referencesReplacement(currentBeforeConversion, candidate.targetImageKey)) {
        await env.MEDIA_BUCKET.delete(oldObjectKey)
        return {status: 'replaced'}
    }

    const sourceObject = await env.MEDIA_BUCKET.get(oldObjectKey)
    if (!sourceObject) {
        throw new Error(`The source size chart image is missing: ${oldObjectKey}`)
    }

    const sourceBytes = new Uint8Array(await sourceObject.arrayBuffer())
    const sourceContentType = sourceObject.httpMetadata?.contentType ?? chart.image.contentType
    const metadata = readGalleryImageMetadata(sourceBytes, sourceContentType)
    if (!metadata) {
        throw new Error(`The source size chart image is invalid: ${oldObjectKey}`)
    }

    const converted = await generateHeightChartImageWithContainer(
        env,
        async () => new Response(sourceBytes.slice()).body as ReadableStream,
        {
            width: metadata.width,
            height: metadata.height,
            displayWidth: metadata.displayWidth,
            displayHeight: metadata.displayHeight,
        },
        oldObjectKey,
        {priority: 'background'},
    )
    const storedChart = JSON.parse(candidate.chartJson) as Record<string, unknown>
    const replacementChart = {
        ...storedChart,
        image: {
            key: candidate.targetImageKey,
            contentType: converted.contentType,
            naturalWidth: converted.width,
            naturalHeight: converted.height,
        },
    }
    const replacementJson = JSON.stringify(replacementChart)

    const published = await publishReplacement(env, candidate, targetObjectKey, replacementJson, converted.bytes)
    if (!published) return {status: 'skipped'}

    await env.MEDIA_BUCKET.delete(oldObjectKey)
    return {status: 'replaced'}
}

async function publishReplacement(
    env: BackfillEnv,
    candidate: SizeChartImageBackfillCandidate,
    targetObjectKey: string,
    replacementJson: string,
    bytes: Uint8Array,
): Promise<boolean> {
    await env.MEDIA_BUCKET.put(targetObjectKey, bytes, {
        httpMetadata: {
            cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
            contentType: 'image/avif',
        },
    })

    try {
        const update = await env.DB.prepare(
            `UPDATE characters
             SET height_chart_json = ?
             WHERE id = ?
               AND user_id = ?
               AND height_chart_json = ?`,
        )
            .bind(replacementJson, candidate.characterId, candidate.userId, candidate.chartJson)
            .run()
        if (Number(update.meta.changes) > 0) return true

        const current = await readCurrentChart(env.DB, candidate.characterId, candidate.userId)
        if (referencesReplacement(current, candidate.targetImageKey)) return true
        await env.MEDIA_BUCKET.delete(targetObjectKey)
        return false
    } catch (error) {
        const current = await readCurrentChart(env.DB, candidate.characterId, candidate.userId).catch(() => undefined)
        if (current !== undefined && !referencesReplacement(current, candidate.targetImageKey)) {
            await env.MEDIA_BUCKET.delete(targetObjectKey)
        }
        if (!referencesReplacement(current ?? null, candidate.targetImageKey)) throw error
        return true
    }
}

async function readCurrentChart(db: D1Database, characterId: string, userId: string): Promise<HeightChartJson | null> {
    const row = await db
        .prepare('SELECT height_chart_json FROM characters WHERE id = ? AND user_id = ?')
        .bind(characterId, userId)
        .first<{height_chart_json: string}>()
    return parseHeightChartJson(row?.height_chart_json)
}

function referencesReplacement(chart: HeightChartJson | null, targetImageKey: string): boolean {
    return chart?.image?.key === targetImageKey && chart.image.contentType.toLowerCase() === 'image/avif'
}

export function sizeChartImageBackfillErrorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
