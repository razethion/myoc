import type {MediaRegenerationProcessingMessage, RegenerationProcessingFailureMessage} from './imageProcessing'

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

export type MediaPreviewRegenerationMessage = MediaRegenerationProcessingMessage

export type MediaPreviewRegenerationFailureMessage = Extract<RegenerationProcessingFailureMessage, {kind: 'media-regeneration'}>
