import type {z} from 'zod'
import type {RecentMediaItem} from '../recentMedia'
import type {RecentFeedVariant} from './config'
import {
    RecentFeedBlockSchema,
    type RecentFeedDayManifest,
    RecentFeedDayManifestSchema,
    type RecentFeedDayReference,
    type RecentFeedHourReference,
    type RecentFeedMonthManifest,
    RecentFeedMonthManifestSchema,
    type RecentFeedMonthReference,
    type RecentFeedVariantRoot,
    type RecentFeedYearManifest,
    RecentFeedYearManifestSchema,
    type RecentFeedYearReference,
} from './model'

export class RecentFeedTreeError extends Error {}

export async function readRecentFeedTreeItems(
    bucket: R2Bucket,
    root: RecentFeedVariantRoot,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    objectCache = new Map<string, unknown>(),
): Promise<RecentMediaItem[]> {
    const items: RecentMediaItem[] = []
    let remainingPosition = position

    for (const reference of root.years) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }

        const manifest = await readCachedJson(bucket, reference.key, RecentFeedYearManifestSchema, objectCache)
        assertYearManifest(manifest, reference, variant)
        await readYearItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0

        if (items.length >= maximum) break
    }

    return items
}

async function readYearItems(
    bucket: R2Bucket,
    year: RecentFeedYearManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position
    for (const reference of year.months) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }
        const manifest = await readCachedJson(bucket, reference.key, RecentFeedMonthManifestSchema, objectCache)
        assertMonthManifest(manifest, reference, variant, year.year)
        await readMonthItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0
        if (items.length >= maximum) return
    }
}

async function readMonthItems(
    bucket: R2Bucket,
    month: RecentFeedMonthManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position
    for (const reference of month.days) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }
        const manifest = await readCachedJson(bucket, reference.key, RecentFeedDayManifestSchema, objectCache)
        assertDayManifest(manifest, reference, variant, month.month)
        await readDayItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0
        if (items.length >= maximum) return
    }
}

async function readDayItems(
    bucket: R2Bucket,
    day: RecentFeedDayManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position
    for (const hour of day.hours) {
        if (remainingPosition >= hour.itemCount) {
            remainingPosition -= hour.itemCount
            continue
        }
        await readHourItems(bucket, hour, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0
        if (items.length >= maximum) return
    }
}

async function readHourItems(
    bucket: R2Bucket,
    hour: RecentFeedHourReference,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position
    for (const reference of hour.blocks) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }
        const block = await readCachedJson(bucket, reference.key, RecentFeedBlockSchema, objectCache)
        if (block.variant !== variant || block.hour !== hour.hour || block.items.length !== reference.itemCount) {
            throw new RecentFeedTreeError('Recent feed block does not match its reference')
        }
        items.push(...block.items.slice(remainingPosition, remainingPosition + (maximum - items.length)))
        remainingPosition = 0
        if (items.length >= maximum) return
    }
}

function assertYearManifest(manifest: RecentFeedYearManifest, reference: RecentFeedYearReference, variant: RecentFeedVariant): void {
    if (
        manifest.variant !== variant ||
        manifest.year !== reference.year ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.months) ||
        manifest.months.some((month) => !month.month.startsWith(`${manifest.year}-`))
    ) {
        throw new RecentFeedTreeError('Recent feed year manifest does not match its reference')
    }
}

function assertMonthManifest(
    manifest: RecentFeedMonthManifest,
    reference: RecentFeedMonthReference,
    variant: RecentFeedVariant,
    year: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.month !== reference.month ||
        !manifest.month.startsWith(`${year}-`) ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.days) ||
        manifest.days.some((day) => !day.day.startsWith(`${manifest.month}-`))
    ) {
        throw new RecentFeedTreeError('Recent feed month manifest does not match its reference')
    }
}

function assertDayManifest(
    manifest: RecentFeedDayManifest,
    reference: RecentFeedDayReference,
    variant: RecentFeedVariant,
    month: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.day !== reference.day ||
        !manifest.day.startsWith(`${month}-`) ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.hours) ||
        manifest.hours.some((hour) => !hour.hour.startsWith(`${manifest.day}T`) || hour.itemCount !== sumItemCounts(hour.blocks))
    ) {
        throw new RecentFeedTreeError('Recent feed day manifest does not match its reference')
    }
}

async function readCachedJson<T>(bucket: R2Bucket, key: string, schema: z.ZodType<T>, objectCache: Map<string, unknown>): Promise<T> {
    const cached = objectCache.get(key)
    if (cached !== undefined) return schema.parse(cached)

    const object = await bucket.get(key)
    if (!object) throw new RecentFeedTreeError(`Recent feed object is missing: ${key}`)

    const parsed = schema.parse(await object.json<unknown>())
    objectCache.set(key, parsed)
    return parsed
}

function sumItemCounts(values: Array<{itemCount: number}>): number {
    return values.reduce((total, value) => total + value.itemCount, 0)
}
