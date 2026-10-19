import {z} from 'zod'
import {characterMediaImageUrl, characterMediaPreviewImageUrl, characterProfileImageUrl, profilePhotoUrl} from './media/url'

export const RECENT_MEDIA_PAGE_SIZE = 24
export const RECENT_MEDIA_MAX_PAGE_SIZE = 30

const RecentMediaItemSchema = z.object({
    id: z.string(),
    groupId: z.string(),
    alt: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    previewSrc: z.string(),
    originalSrc: z.string(),
    character: z.object({
        name: z.string(),
        href: z.string(),
        avatarUrl: z.string(),
    }),
    user: z.object({
        username: z.string(),
        href: z.string(),
        avatarUrl: z.string().nullable(),
        initial: z.string(),
    }),
})

export const RecentMediaPageSchema = z.object({
    items: z.array(RecentMediaItemSchema),
    nextCursor: z.string().nullable(),
    head: z.string().nullable(),
})

export const RecentMediaStateSchema = z.object({
    head: z.string().nullable(),
    newCount: z.number().int().nonnegative(),
})

export type RecentMediaItem = z.infer<typeof RecentMediaItemSchema>
export type RecentMediaPage = z.infer<typeof RecentMediaPageSchema>
export type RecentMediaState = z.infer<typeof RecentMediaStateSchema>

export type RecentMediaOptions = {
    cursor?: string | null
    limit?: number
    showNsfw?: boolean
    showUnapproved?: boolean
}

export type RecentMediaRow = {
    id: string
    user_id: string
    character_id: string
    sfw_image_key: string | null
    sfw_preview_image_key: string | null
    sfw_preview_content_type: string
    sfw_content_type: string | null
    sfw_width: number | null
    sfw_height: number | null
    sfw_preview_width: number | null
    sfw_preview_height: number | null
    sfw_review_status: string
    sfw_approved_at: string | null
    nsfw_image_key: string | null
    nsfw_preview_image_key: string | null
    nsfw_preview_content_type: string
    nsfw_content_type: string | null
    nsfw_width: number | null
    nsfw_height: number | null
    nsfw_preview_width: number | null
    nsfw_preview_height: number | null
    nsfw_review_status: string
    nsfw_approved_at: string | null
    created_at: string
    updated_at: string
    character_name: string
    character_profile_image_key: string
    owner_username: string
    owner_profile_photo_key: string | null
}

export type RecentMediaSourceCursor = {
    createdAt: string
    id: string
}

export function normalizeRecentMediaLimit(limit: number | undefined): number {
    if (!Number.isInteger(limit) || !limit) {
        return RECENT_MEDIA_PAGE_SIZE
    }

    return Math.min(Math.max(limit, 1), RECENT_MEDIA_MAX_PAGE_SIZE)
}

function isEligibleRecentMediaVariant(row: RecentMediaRow, rating: 'sfw' | 'nsfw', showUnapproved: boolean): boolean {
    const imageKey = rating === 'sfw' ? row.sfw_image_key : row.nsfw_image_key
    const previewImageKey = rating === 'sfw' ? row.sfw_preview_image_key : row.nsfw_preview_image_key

    if (!imageKey || !previewImageKey) {
        return false
    }

    if (showUnapproved) {
        return true
    }

    const reviewStatus = rating === 'sfw' ? row.sfw_review_status : row.nsfw_review_status
    const approvedAt = rating === 'sfw' ? row.sfw_approved_at : row.nsfw_approved_at

    return reviewStatus === 'approved' && Boolean(approvedAt && approvedAt >= row.updated_at)
}

type RecentMediaRating = 'sfw' | 'nsfw'

type RecentMediaVariantData = {
    contentType: string | null
    height: number
    imageKey: string | null
    previewImageKey: string | null
    previewContentType: string
    width: number
}

function recentMediaVariantData(row: RecentMediaRow, rating: RecentMediaRating): RecentMediaVariantData {
    if (rating === 'nsfw') {
        return {
            contentType: row.nsfw_content_type,
            height: row.nsfw_preview_height ?? row.nsfw_height ?? 1,
            imageKey: row.nsfw_image_key,
            previewImageKey: row.nsfw_preview_image_key,
            previewContentType: row.nsfw_preview_content_type,
            width: row.nsfw_preview_width ?? row.nsfw_width ?? 1,
        }
    }

    return {
        contentType: row.sfw_content_type,
        height: row.sfw_preview_height ?? row.sfw_height ?? 1,
        imageKey: row.sfw_image_key,
        previewImageKey: row.sfw_preview_image_key,
        previewContentType: row.sfw_preview_content_type,
        width: row.sfw_preview_width ?? row.sfw_width ?? 1,
    }
}

function recentMediaItemFromRow(row: RecentMediaRow, mediaBaseUrl: string, showNsfw: boolean, showUnapproved: boolean): RecentMediaItem {
    const rating: RecentMediaRating = showNsfw && isEligibleRecentMediaVariant(row, 'nsfw', showUnapproved) ? 'nsfw' : 'sfw'
    const {contentType, height, imageKey, previewContentType, previewImageKey, width} = recentMediaVariantData(row, rating)
    const characterHref = `/u/${encodeURIComponent(row.owner_username)}/${encodeURIComponent(row.character_name)}`

    if (!imageKey || !previewImageKey) {
        throw new Error('Recent media query returned an ineligible media variant')
    }

    return {
        id: row.id,
        groupId: JSON.stringify([row.user_id, row.character_id]),
        alt: `${row.character_name} character art`,
        width: width > 0 ? width : 1,
        height: height > 0 ? height : 1,
        previewSrc: characterMediaPreviewImageUrl(
            mediaBaseUrl,
            row.user_id,
            row.character_id,
            row.id,
            previewImageKey,
            rating,
            previewContentType,
        ),
        originalSrc: characterMediaImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, imageKey, rating, contentType),
        character: {
            name: row.character_name,
            href: characterHref,
            avatarUrl: characterProfileImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.character_profile_image_key),
        },
        user: {
            username: row.owner_username,
            href: `/u/${encodeURIComponent(row.owner_username)}`,
            avatarUrl: row.owner_profile_photo_key ? profilePhotoUrl(mediaBaseUrl, row.user_id, row.owner_profile_photo_key) : null,
            initial: row.owner_username.trim().charAt(0).toUpperCase() || 'U',
        },
    }
}

export function recentMediaItemsFromRows(
    rows: RecentMediaRow[],
    mediaBaseUrl: string,
    showNsfw: boolean,
    showUnapproved: boolean,
): RecentMediaItem[] {
    return rows
        .filter((row) => {
            const sfwEligible = isEligibleRecentMediaVariant(row, 'sfw', showUnapproved)
            return showNsfw ? sfwEligible || isEligibleRecentMediaVariant(row, 'nsfw', showUnapproved) : sfwEligible
        })
        .map((row) => recentMediaItemFromRow(row, mediaBaseUrl, showNsfw, showUnapproved))
}
