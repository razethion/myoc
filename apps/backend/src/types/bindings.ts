import type {ImageProcessingFailureMessage, ImageProcessingMessage} from './imageProcessing'

export type Bindings = Omit<
    Env,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'D1_DATABASE_ID'
    | 'DB_BACKUP_BUCKET'
    | 'IMAGE_PROCESSING_DLQ'
    | 'IMAGE_PROCESSING_QUEUE'
    | 'IMAGE_PROCESSING_DLQ_NAME'
> & {
    CLOUDFLARE_ACCOUNT_ID: string
    D1_DATABASE_ID: string
    D1_REST_API_TOKEN: string
    DB_BACKUP_BUCKET?: R2Bucket
    IMAGE_PROCESSING_DLQ: Queue<ImageProcessingFailureMessage>
    IMAGE_PROCESSING_QUEUE: Queue<ImageProcessingMessage>
    IMAGE_PROCESSING_DLQ_NAME: string
    IMAGE_UPLOAD_ASYNC_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
}
