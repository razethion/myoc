import type {ImageProcessingFailureMessage, ImageProcessingMessage} from './imageProcessing'

export type Bindings = Omit<
    Env,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'D1_DATABASE_ID'
    | 'IMAGE_PROCESSING_DLQ'
    | 'IMAGE_PROCESSING_QUEUE'
    | 'IMAGE_PROCESSING_DLQ_NAME'
    | 'OBJECT_STORAGE_ENCRYPTION_KEY'
> & {
    CLOUDFLARE_ACCOUNT_ID: string
    D1_DATABASE_ID: string
    D1_REST_API_TOKEN: string
    IMAGE_PROCESSING_DLQ: Queue<ImageProcessingFailureMessage>
    IMAGE_PROCESSING_QUEUE: Queue<ImageProcessingMessage>
    IMAGE_PROCESSING_DLQ_NAME: string
    IMAGE_UPLOAD_ASYNC_ENABLED?: string
    OBJECT_STORAGE_ENCRYPTION_KEY: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
}
