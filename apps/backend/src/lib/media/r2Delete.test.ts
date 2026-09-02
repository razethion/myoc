import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {deleteR2Objects} from './r2Delete'

describe('R2 object deletion', () => {
    it.each([new Error('R2 unavailable'), 'R2 unavailable'])('continues after one object cannot be deleted: %s', async (error) => {
        const bucket = createMockR2Bucket()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        await bucket.put('first-key', 'first')
        await bucket.put('second-key', 'second')
        vi.mocked(bucket.delete).mockRejectedValueOnce(error)

        try {
            await deleteR2Objects(bucket, ['first-key', 'second-key'], 'test-cleanup')

            expect(await bucket.get('first-key')).not.toBeNull()
            expect(await bucket.get('second-key')).toBeNull()
            expect(warning).toHaveBeenCalledOnce()
            expect(warning).toHaveBeenCalledWith(expect.stringContaining('R2 unavailable'))
        } finally {
            warning.mockRestore()
        }
    })
})
