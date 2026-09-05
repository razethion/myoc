import type {ImageProcessingFailureMessage, ImageProcessingMessage} from './imageProcessing'
import type {MediaPreviewRegenerationFailureMessage, MediaPreviewRegenerationMessage} from './mediaPreviewQueue'

export type Bindings = Omit<
    Env,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'D1_DATABASE_ID'
    | 'MEDIA_PREVIEW_REGENERATION_DLQ'
    | 'MEDIA_PREVIEW_REGENERATION_QUEUE_0'
    | 'MEDIA_PREVIEW_REGENERATION_QUEUE_1'
    | 'MEDIA_PREVIEW_REGENERATION_QUEUE_2'
    | 'MEDIA_PREVIEW_OVERFLOW_ENABLED'
    | 'IMAGE_PROCESSING_DLQ'
    | 'IMAGE_PROCESSING_QUEUE_0'
    | 'IMAGE_PROCESSING_QUEUE_1'
    | 'IMAGE_PROCESSING_QUEUE_2'
    | 'IMAGE_PROCESSING_DLQ_NAME'
    | 'MEDIA_PREVIEW_REGENERATION_DLQ_NAME'
> & {
    CLOUDFLARE_ACCOUNT_ID: string
    D1_DATABASE_ID: string
    D1_REST_API_TOKEN: string
    MEDIA_PREVIEW_REGENERATION_DLQ: Queue<MediaPreviewRegenerationFailureMessage>
    MEDIA_PREVIEW_REGENERATION_QUEUE_0: Queue<MediaPreviewRegenerationMessage>
    MEDIA_PREVIEW_REGENERATION_QUEUE_1: Queue<MediaPreviewRegenerationMessage>
    MEDIA_PREVIEW_REGENERATION_QUEUE_2: Queue<MediaPreviewRegenerationMessage>
    MEDIA_PREVIEW_OVERFLOW_ENABLED?: string
    IMAGE_PROCESSING_DLQ: Queue<ImageProcessingFailureMessage>
    IMAGE_PROCESSING_QUEUE_0: Queue<ImageProcessingMessage>
    IMAGE_PROCESSING_QUEUE_1: Queue<ImageProcessingMessage>
    IMAGE_PROCESSING_QUEUE_2: Queue<ImageProcessingMessage>
    IMAGE_PROCESSING_DLQ_NAME: string
    IMAGE_UPLOAD_ASYNC_ENABLED?: string
    MEDIA_PREVIEW_REGENERATION_DLQ_NAME: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
}
