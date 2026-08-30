import {z} from 'zod'
import {RecentMediaItemSchema} from '../recentMedia'
import {RECENT_FEED_INITIAL_ITEMS, RECENT_FEED_SCHEMA_VERSION, RECENT_FEED_VARIANTS} from './config'

const RecentFeedObjectKeySchema = z.string().min(1).max(1024)
const RecentFeedItemCountSchema = z.number().int().nonnegative()
const RecentFeedYearValueSchema = z.string().regex(/^\d{4}$/)
const RecentFeedMonthValueSchema = z.string().regex(/^\d{4}-\d{2}$/)
const RecentFeedDayValueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const RecentFeedHourValueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/)

export const RecentFeedBlockSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    variant: z.enum(RECENT_FEED_VARIANTS),
    hour: RecentFeedHourValueSchema,
    items: z.array(RecentMediaItemSchema),
})

export const RecentFeedBlockReferenceSchema = z.object({
    key: RecentFeedObjectKeySchema,
    itemCount: RecentFeedItemCountSchema,
})

const RecentFeedHourReferenceSchema = z.object({
    hour: RecentFeedHourValueSchema,
    itemCount: RecentFeedItemCountSchema,
    blocks: z.array(RecentFeedBlockReferenceSchema).max(4096),
})

export const RecentFeedDayManifestSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    variant: z.enum(RECENT_FEED_VARIANTS),
    day: RecentFeedDayValueSchema,
    itemCount: RecentFeedItemCountSchema,
    hours: z.array(RecentFeedHourReferenceSchema),
})

const RecentFeedDayReferenceSchema = z.object({
    day: RecentFeedDayValueSchema,
    key: RecentFeedObjectKeySchema,
    itemCount: RecentFeedItemCountSchema,
})

export const RecentFeedMonthManifestSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    variant: z.enum(RECENT_FEED_VARIANTS),
    month: RecentFeedMonthValueSchema,
    itemCount: RecentFeedItemCountSchema,
    days: z.array(RecentFeedDayReferenceSchema),
})

const RecentFeedMonthReferenceSchema = z.object({
    month: RecentFeedMonthValueSchema,
    key: RecentFeedObjectKeySchema,
    itemCount: RecentFeedItemCountSchema,
})

export const RecentFeedYearManifestSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    variant: z.enum(RECENT_FEED_VARIANTS),
    year: RecentFeedYearValueSchema,
    itemCount: RecentFeedItemCountSchema,
    months: z.array(RecentFeedMonthReferenceSchema),
})

const RecentFeedYearReferenceSchema = z.object({
    year: RecentFeedYearValueSchema,
    key: RecentFeedObjectKeySchema,
    itemCount: RecentFeedItemCountSchema,
})

export const RecentFeedVariantRootSchema = z.object({
    itemCount: RecentFeedItemCountSchema,
    years: z.array(RecentFeedYearReferenceSchema),
})

export const RecentFeedRootSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    generation: z.string().min(1).max(128),
    throughRevision: z.number().int().positive(),
    publishedAt: z.string().min(1),
    variants: z.object({
        'n0-u0': RecentFeedVariantRootSchema,
        'n0-u1': RecentFeedVariantRootSchema,
        'n1-u0': RecentFeedVariantRootSchema,
        'n1-u1': RecentFeedVariantRootSchema,
    }),
    initialItems: z
        .object({
            'n0-u0': z.array(RecentMediaItemSchema).max(RECENT_FEED_INITIAL_ITEMS),
            'n0-u1': z.array(RecentMediaItemSchema).max(RECENT_FEED_INITIAL_ITEMS),
            'n1-u0': z.array(RecentMediaItemSchema).max(RECENT_FEED_INITIAL_ITEMS),
            'n1-u1': z.array(RecentMediaItemSchema).max(RECENT_FEED_INITIAL_ITEMS),
        })
        .optional(),
})

const RecentFeedPointerSchema = z.object({
    generation: z.string().min(1).max(128),
    rootKey: RecentFeedObjectKeySchema,
    publishedAt: z.string().min(1),
    throughRevision: z.number().int().positive(),
})

export type RecentFeedBlock = z.infer<typeof RecentFeedBlockSchema>
export type RecentFeedBlockReference = z.infer<typeof RecentFeedBlockReferenceSchema>
export type RecentFeedDayManifest = z.infer<typeof RecentFeedDayManifestSchema>
export type RecentFeedDayReference = z.infer<typeof RecentFeedDayReferenceSchema>
export type RecentFeedHourReference = z.infer<typeof RecentFeedHourReferenceSchema>
export type RecentFeedMonthManifest = z.infer<typeof RecentFeedMonthManifestSchema>
export type RecentFeedMonthReference = z.infer<typeof RecentFeedMonthReferenceSchema>
export type RecentFeedPointer = z.infer<typeof RecentFeedPointerSchema>
export type RecentFeedRoot = z.infer<typeof RecentFeedRootSchema>
export type RecentFeedVariantRoot = z.infer<typeof RecentFeedVariantRootSchema>
export type RecentFeedYearManifest = z.infer<typeof RecentFeedYearManifestSchema>
export type RecentFeedYearReference = z.infer<typeof RecentFeedYearReferenceSchema>
