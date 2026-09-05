export type ImageProcessingMessage = {
    version: 1
    taskId: string
    slot: 0 | 1 | 2
}

export type ImageProcessingFailureMessage = ImageProcessingMessage & {
    failureId: string
    jobId: string
    errorCode: string
    error: string
}
