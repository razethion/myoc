export async function deleteR2Objects(bucket: R2Bucket, objectKeys: string[], operation = 'media-cleanup'): Promise<void> {
    for (const objectKey of objectKeys) {
        try {
            await bucket.delete(objectKey)
        } catch (error) {
            console.warn(
                JSON.stringify({
                    message: 'Unable to delete R2 object',
                    operation,
                    objectKey,
                    error: error instanceof Error ? error.message : String(error),
                }),
            )
        }
    }
}
