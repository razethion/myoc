import {z} from 'zod'

const NonnegativeIntegerSchema = z.number().int().nonnegative()

export const SearchUserResultSchema = z
    .object({
        id: z.string(),
        username: z.string(),
        bio: z.string(),
        profilePhotoUrl: z.string(),
        profileUrl: z.string(),
        characterCount: NonnegativeIntegerSchema,
    })
    .strict()

export const SearchCharacterResultSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        ownerId: z.string(),
        ownerUsername: z.string(),
        profileImageUrl: z.string(),
        characterUrl: z.string(),
    })
    .strict()

function searchCollectionSchema<T extends z.ZodType>(itemSchema: T) {
    return z
        .object({
            items: z.array(itemSchema),
            total: NonnegativeIntegerSchema,
            nextOffset: NonnegativeIntegerSchema.nullable(),
            hasMore: z.boolean(),
        })
        .strict()
}

const SearchResultsSchema = z
    .object({
        query: z.string(),
        wasTruncated: z.boolean(),
        users: searchCollectionSchema(SearchUserResultSchema),
        characters: searchCollectionSchema(SearchCharacterResultSchema),
    })
    .strict()

export const SearchPageDataSchema = z
    .object({
        shell: z
            .object({
                viewer: z
                    .object({
                        username: z.string(),
                        profileUrl: z.string(),
                        avatarUrl: z.string(),
                        csrfToken: z.string(),
                        canModerateImages: z.boolean(),
                    })
                    .strict()
                    .nullable(),
                appVersion: z.string(),
                showVersionNotification: z.boolean(),
                importantRelease: z.boolean(),
            })
            .strict(),
        results: SearchResultsSchema,
    })
    .strict()

export type SearchUserResult = z.infer<typeof SearchUserResultSchema>
export type SearchCharacterResult = z.infer<typeof SearchCharacterResultSchema>
export type SearchCollection<T> = {
    items: T[]
    total: number
    nextOffset: number | null
    hasMore: boolean
}
export type SearchResults = z.infer<typeof SearchResultsSchema>
export type SearchPageData = z.infer<typeof SearchPageDataSchema>
