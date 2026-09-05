export function imageProcessingRetryDelaySeconds(attempts: number): number {
    return Math.min(60, 2 ** Math.min(6, Math.max(0, attempts - 1)))
}

export function imageProcessingErrorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
