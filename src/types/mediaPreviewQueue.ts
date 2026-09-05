import {z} from 'zod'

export const MediaPreviewRegenerationMessageSchema = z
    .object({
        version: z.literal(1),
        taskId: z.string().min(1).max(512),
        runId: z.string().min(1).max(128),
        containerSlot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    })
    .strict()

export type MediaPreviewRegenerationCandidate = {
    mediaId: string
    userId: string
    characterId: string
    rating: 'sfw' | 'nsfw'
    ratingOrder: number
    imageKey: string
    storedImageContentType: string | null
    imageContentType: string
    previousPreviewKey: string | null
    previousPreviewContentType: string
    previousBlurKey: string | null
    previousBlurContentType: string
    targetPreviewKey: string
    targetBlurKey: string | null
}

export type MediaPreviewRegenerationMessage = z.infer<typeof MediaPreviewRegenerationMessageSchema>

export type MediaPreviewRegenerationFailureMessage = MediaPreviewRegenerationMessage & {
    error: string
}
