import {z} from 'zod'

const NullableStringSchema = z.string().nullable()
const PositiveIntegerSchema = z.number().int().nonnegative()

export function responseSchema<TShape extends z.ZodRawShape>(shape: TShape) {
    return z.object(shape).strict()
}

export const ErrorResponseSchema = z
    .object({
        error: z.string(),
    })
    .strict()

export const OkResponseSchema = z
    .object({
        ok: z.literal(true),
    })
    .strict()

export const UserRoleSchema = z.enum(['user', 'moderator', 'admin'])

export const OwnUserSchema = z
    .object({
        id: z.string(),
        email: z.string(),
        username: z.string(),
        role: UserRoleSchema,
        profilePhotoKey: NullableStringSchema,
        bio: z.string(),
        displayNsfwMedia: z.boolean(),
        lastSeenVersion: NullableStringSchema,
        createdAt: z.string(),
    })
    .strict()

export const PublicCharacterSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        profileImageKey: NullableStringSchema,
        profileImageUrl: NullableStringSchema,
        folderId: NullableStringSchema,
        sortOrder: z.number().int(),
        description: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
    })
    .strict()

export const CharacterFolderSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        parentFolderId: NullableStringSchema,
        folderImageKey: NullableStringSchema,
        folderImageUrl: NullableStringSchema,
        sortOrder: z.number().int(),
        createdAt: z.string(),
        updatedAt: z.string(),
    })
    .strict()

export const CharacterHeightChartImageSchema = z
    .object({
        key: z.string(),
        contentType: z.string(),
        naturalWidth: z.number(),
        naturalHeight: z.number(),
        url: z.string(),
    })
    .strict()

export const CharacterHeightChartSchema = z
    .object({
        version: z.literal(1),
        height: z
            .object({
                meters: z.number(),
            })
            .strict(),
        image: CharacterHeightChartImageSchema.nullable(),
        calibration: z
            .object({
                headYPercent: z.number(),
                footYPercent: z.number(),
                footIsVirtual: z.boolean(),
                nameTagXPercent: z.number(),
            })
            .strict(),
    })
    .strict()
    .nullable()

export const PublicMediaSchema = z
    .object({
        id: z.string(),
        sfwImageKey: NullableStringSchema,
        nsfwImageKey: NullableStringSchema,
        sfwContentType: NullableStringSchema,
        nsfwContentType: NullableStringSchema,
        sfwImageUrl: NullableStringSchema,
        nsfwImageUrl: NullableStringSchema,
        sfwPreviewImageKey: NullableStringSchema,
        nsfwPreviewImageKey: NullableStringSchema,
        nsfwBlurImageKey: NullableStringSchema,
        sfwPreviewImageUrl: NullableStringSchema,
        nsfwPreviewImageUrl: NullableStringSchema,
        nsfwBlurImageUrl: NullableStringSchema,
        sfwArtist: z.string(),
        nsfwArtist: z.string(),
        sfwWidth: z.number().nullable(),
        sfwHeight: z.number().nullable(),
        sfwByteSize: z.number().nullable(),
        nsfwWidth: z.number().nullable(),
        nsfwHeight: z.number().nullable(),
        nsfwByteSize: z.number().nullable(),
        sfwPreviewWidth: z.number().nullable(),
        sfwPreviewHeight: z.number().nullable(),
        sfwPreviewByteSize: z.number().nullable(),
        nsfwPreviewWidth: z.number().nullable(),
        nsfwPreviewHeight: z.number().nullable(),
        nsfwPreviewByteSize: z.number().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
    })
    .strict()

export const ChunkedUploadSchema = z
    .object({
        uploadId: z.string(),
        imageKey: z.string(),
        contentType: z.string(),
        chunkSize: z.number().int().positive(),
    })
    .strict()

export const R2UploadedPartSchema = z
    .object({
        partNumber: z.number().int(),
        etag: z.string(),
    })
    .strict()

export const GalleryLayoutResponseSchema = z
    .object({
        gallery: z
            .object({
                tabs: z.array(
                    z
                        .object({
                            id: z.string(),
                            name: z.string(),
                            rows: z.array(
                                z
                                    .object({
                                        id: z.string(),
                                        mediaIds: z.array(z.string()),
                                        forceFullWidth: z.boolean(),
                                    })
                                    .strict(),
                            ),
                        })
                        .strict(),
                ),
            })
            .strict(),
    })
    .strict()

export const SearchUserResultSchema = z
    .object({
        id: z.string(),
        username: z.string(),
        bio: z.string(),
        profilePhotoUrl: z.string(),
        profileUrl: z.string(),
        characterCount: PositiveIntegerSchema,
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

export const SearchResponseSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('users'),
            query: z.string(),
            wasTruncated: z.boolean(),
            items: z.array(SearchUserResultSchema),
            total: PositiveIntegerSchema,
            nextOffset: PositiveIntegerSchema.nullable(),
            hasMore: z.boolean(),
        })
        .strict(),
    z
        .object({
            type: z.literal('characters'),
            query: z.string(),
            wasTruncated: z.boolean(),
            items: z.array(SearchCharacterResultSchema),
            total: PositiveIntegerSchema,
            nextOffset: PositiveIntegerSchema.nullable(),
            hasMore: z.boolean(),
        })
        .strict(),
])

export const SizeChartSearchItemSchema = z
    .object({
        id: z.string(),
        sizeChartId: z.string(),
        name: z.string(),
        ownerId: z.string(),
        ownerUsername: z.string(),
        profileImageUrl: z.string(),
        hasSizeChart: z.boolean(),
        heightChart: CharacterHeightChartSchema,
    })
    .strict()

export const AdminJobNameSchema = z.enum(['d1-backup', 'r2-media-cleanup', 'leaderboard-refresh'])
export const AdminJobStatusSchema = z.enum(['running', 'success', 'error'])
export const AdminJobTriggerSourceSchema = z.enum(['cron', 'manual'])

export const D1BackupSummarySchema = z
    .object({
        key: z.string(),
        databaseName: z.string(),
        generatedAt: z.string(),
        schemaObjects: PositiveIntegerSchema,
        tables: PositiveIntegerSchema,
        rows: PositiveIntegerSchema,
        compressedBytes: PositiveIntegerSchema,
    })
    .strict()

export const R2CleanupSummarySchema = z
    .object({
        scanned: PositiveIntegerSchema,
        recognized: PositiveIntegerSchema,
        skippedUnknown: PositiveIntegerSchema,
        skippedRecent: PositiveIntegerSchema,
        keptReferenced: PositiveIntegerSchema,
        deleted: PositiveIntegerSchema,
        errors: PositiveIntegerSchema,
        stoppedAtDeleteLimit: z.boolean(),
    })
    .strict()

export const LeaderboardRefreshSummarySchema = z
    .object({
        key: z.string(),
        generatedAt: z.string(),
        scannedObjects: PositiveIntegerSchema,
        recognizedObjects: PositiveIntegerSchema,
        skippedUnknownObjects: PositiveIntegerSchema,
        totalManagedBytes: PositiveIntegerSchema,
        totalMonthlyStorageCostUsd: z.number().nonnegative(),
        rankedTopUsers: PositiveIntegerSchema,
        rankedUsersByCharacters: PositiveIntegerSchema,
        rankedUsersByImages: PositiveIntegerSchema,
        rankedUsersByData: PositiveIntegerSchema,
        rankedCharactersByData: PositiveIntegerSchema,
    })
    .strict()

export const AdminJobSummarySchema = z.union([D1BackupSummarySchema, R2CleanupSummarySchema, LeaderboardRefreshSummarySchema])

export const AdminJobRunSchema = z
    .object({
        id: z.string(),
        jobName: AdminJobNameSchema,
        label: z.string(),
        triggerSource: AdminJobTriggerSourceSchema,
        triggeredByUserId: NullableStringSchema,
        triggeredByUsername: NullableStringSchema,
        cron: NullableStringSchema,
        status: AdminJobStatusSchema,
        startedAt: z.string(),
        finishedAt: NullableStringSchema,
        durationMs: z.number().nullable(),
        summary: AdminJobSummarySchema.nullable(),
        errorMessage: NullableStringSchema,
    })
    .strict()

export const AdminJobRunResultSchema = z
    .object({
        jobName: AdminJobNameSchema,
        runId: z.string(),
        status: AdminJobStatusSchema,
        summary: AdminJobSummarySchema.optional(),
    })
    .strict()

export const ImageApprovalVariantSchema = z
    .object({
        rating: z.enum(['sfw', 'nsfw']),
        imageKey: z.string(),
        contentType: z.string(),
        imageUrl: z.string(),
        fullImageUrl: z.string(),
        previewImageUrl: NullableStringSchema,
        objectKey: z.string(),
        artist: z.string(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        byteSize: z.number().nullable(),
        reviewStatus: z.string(),
        reviewedAt: NullableStringSchema,
        approvedAt: NullableStringSchema,
        homepageAllowed: z.boolean(),
        needsReview: z.boolean(),
    })
    .strict()

export const ImageApprovalDataSchema = z
    .object({
        current: z
            .object({
                id: z.string(),
                createdAt: z.string(),
                updatedAt: z.string(),
                user: z
                    .object({
                        id: z.string(),
                        username: z.string(),
                        email: z.string(),
                        profileUrl: z.string(),
                    })
                    .strict(),
                character: z
                    .object({
                        id: z.string(),
                        name: z.string(),
                        url: z.string(),
                    })
                    .strict(),
                sfw: ImageApprovalVariantSchema.nullable(),
                nsfw: ImageApprovalVariantSchema.nullable(),
            })
            .strict()
            .nullable(),
        pending: z.array(
            z
                .object({
                    id: z.string(),
                    createdAt: z.string(),
                    username: z.string(),
                    characterName: z.string(),
                    pendingSfw: z.boolean(),
                    pendingNsfw: z.boolean(),
                })
                .strict(),
        ),
        pendingCount: PositiveIntegerSchema,
        history: z.array(
            z
                .object({
                    id: z.string(),
                    mediaId: z.string(),
                    imageRating: z.enum(['sfw', 'nsfw']),
                    action: z.string(),
                    homepageAllowed: z.boolean(),
                    moderatorUsername: z.string(),
                    ownerUsername: z.string(),
                    characterName: z.string(),
                    createdAt: z.string(),
                })
                .strict(),
        ),
    })
    .strict()

export const AdminImageReportSchema = z
    .object({
        type: z.literal('image'),
        id: z.string(),
        mediaId: z.string(),
        rating: z.enum(['sfw', 'nsfw']),
        imageUrl: z.string(),
        previewImageUrl: NullableStringSchema,
        objectKey: z.string(),
        reviewStatus: z.string(),
        reportedAt: z.string(),
        reportedByUsername: NullableStringSchema,
        user: z
            .object({
                id: z.string(),
                username: z.string(),
                profileUrl: z.string(),
            })
            .strict(),
        character: z
            .object({
                id: z.string(),
                name: z.string(),
                url: z.string(),
            })
            .strict(),
    })
    .strict()
