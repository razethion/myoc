import {z} from 'zod'

const ImageUploadProcessingMessageSchema = z
    .object({
        version: z.literal(1),
        kind: z.literal('upload'),
        taskId: z.uuid(),
    })
    .strict()

const MediaRegenerationProcessingMessageSchema = z
    .object({
        version: z.literal(1),
        kind: z.literal('media-regeneration'),
        taskId: z.string().min(1).max(512),
        runId: z.string().min(1).max(128),
    })
    .strict()

const ThumbnailRegenerationProcessingMessageSchema = z
    .object({
        version: z.literal(1),
        kind: z.literal('thumbnail-regeneration'),
        taskId: z.string().min(1).max(512),
        runId: z.string().min(1).max(128),
    })
    .strict()

export const ImageProcessingMessageSchema = z.discriminatedUnion('kind', [
    ImageUploadProcessingMessageSchema,
    MediaRegenerationProcessingMessageSchema,
    ThumbnailRegenerationProcessingMessageSchema,
])

export type ImageProcessingMessage = z.infer<typeof ImageProcessingMessageSchema>
export type ImageUploadProcessingMessage = z.infer<typeof ImageUploadProcessingMessageSchema>
export type MediaRegenerationProcessingMessage = z.infer<typeof MediaRegenerationProcessingMessageSchema>
export type ThumbnailRegenerationProcessingMessage = z.infer<typeof ThumbnailRegenerationProcessingMessageSchema>

const ProcessingFailureFields = {
    errorCode: z.string().min(1).max(128),
    error: z.string().min(1).max(2_000),
} as const

type ProcessingFailure = {
    errorCode: string
    error: string
}

const ImageUploadProcessingFailureMessageSchema = ImageUploadProcessingMessageSchema.extend({
    ...ProcessingFailureFields,
    failureId: z.string().min(1).max(512),
    jobId: z.uuid(),
}).strict()

const MediaRegenerationProcessingFailureMessageSchema = MediaRegenerationProcessingMessageSchema.extend(ProcessingFailureFields).strict()

const ThumbnailRegenerationProcessingFailureMessageSchema =
    ThumbnailRegenerationProcessingMessageSchema.extend(ProcessingFailureFields).strict()

export const ImageProcessingFailureMessageSchema = z.discriminatedUnion('kind', [
    ImageUploadProcessingFailureMessageSchema,
    MediaRegenerationProcessingFailureMessageSchema,
    ThumbnailRegenerationProcessingFailureMessageSchema,
])

type ImageUploadProcessingFailureMessage = ImageUploadProcessingMessage &
    ProcessingFailure & {
        failureId: string
        jobId: string
    }

export type RegenerationProcessingFailureMessage =
    | (MediaRegenerationProcessingMessage & ProcessingFailure)
    | (ThumbnailRegenerationProcessingMessage & ProcessingFailure)

export type ImageProcessingFailureMessage = ImageUploadProcessingFailureMessage | RegenerationProcessingFailureMessage
