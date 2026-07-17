import type {Bindings} from '../types/bindings'
import {parseManagedR2MediaKey} from './media/r2Cleanup'

const LEADERBOARD_CACHE_KEY = 'leaderboard:daily:v1'

const LEADERBOARD_LIMIT = 10
const LEADERBOARD_STORAGE_CANDIDATE_LIMIT = 100
const TOP_USER_CANDIDATE_LIMIT = 100
const STORAGE_COST_PER_GB_MONTH_USD = 0.015
const BYTES_PER_GB = 1024 * 1024 * 1024
const R2_LIST_LIMIT = 1000
const D1_SAFE_VARIABLES_PER_QUERY = 90
const MANAGED_R2_PREFIXES = ['users/', 'characters/'] as const

type LeaderboardBuildEnv = Pick<Bindings, 'DB' | 'MEDIA_BUCKET'>
type LeaderboardRefreshEnv = LeaderboardBuildEnv & Pick<Bindings, 'CACHE'>

type LeaderboardUserBaseEntry = {
    rank: number
    userId: string
    username: string
    profilePhotoKey: string | null
}

export type LeaderboardUserCharacterEntry = LeaderboardUserBaseEntry & {
    characterCount: number
}

export type LeaderboardUserImageEntry = LeaderboardUserBaseEntry & {
    imageCount: number
}

export type LeaderboardUserDataEntry = LeaderboardUserBaseEntry & {
    bytes: number
    monthlyStorageCostUsd: number
}

type LeaderboardTopUserEntry = LeaderboardUserBaseEntry & {
    characterCount: number
    imageCount: number
    bytes: number
    monthlyStorageCostUsd: number
}

export type LeaderboardCharacterDataEntry = {
    rank: number
    characterId: string
    userId: string
    name: string
    ownerUsername: string
    profileImageKey: string
    bytes: number
    monthlyStorageCostUsd: number
}

export type LeaderboardSnapshot = {
    version: 1
    generatedAt: string
    costPerGbMonthUsd: number
    totalManagedBytes: number
    totalUsers: number
    totalCharacters: number
    totalImages: number
    topUsers: LeaderboardTopUserEntry[]
    usersByCharacters: LeaderboardUserCharacterEntry[]
    usersByImages: LeaderboardUserImageEntry[]
    usersByData: LeaderboardUserDataEntry[]
    charactersByData: LeaderboardCharacterDataEntry[]
}

export type LeaderboardRefreshSummary = {
    key: string
    generatedAt: string
    scannedObjects: number
    recognizedObjects: number
    skippedUnknownObjects: number
    totalManagedBytes: number
    totalMonthlyStorageCostUsd: number
    rankedTopUsers: number
    rankedUsersByCharacters: number
    rankedUsersByImages: number
    rankedUsersByData: number
    rankedCharactersByData: number
}

type BuiltLeaderboard = {
    snapshot: LeaderboardSnapshot
    scannedObjects: number
    recognizedObjects: number
    skippedUnknownObjects: number
}

type StorageAggregation = {
    userBytes: Map<string, number>
    characterBytes: Map<string, number>
    scannedObjects: number
    recognizedObjects: number
    skippedUnknownObjects: number
    totalManagedBytes: number
}

type UserLeaderboardRow = {
    id: string
    username: string
    profile_photo_key: string | null
}

type CharacterCountRow = UserLeaderboardRow & {
    character_count: number | string | null
}

type ImageCountRow = UserLeaderboardRow & {
    image_count: number | string | null
}

type TopUserRow = UserLeaderboardRow & {
    character_count: number | string | null
    image_count: number | string | null
}

type LeaderboardTotalsRow = {
    total_users: number | string | null
    total_characters: number | string | null
    total_images: number | string | null
}

type CharacterLeaderboardRow = {
    id: string
    user_id: string
    name: string
    profile_image_key: string
    owner_username: string
}

type StorageCandidate = {
    id: string
    bytes: number
}

export async function getLeaderboardSnapshot(cache: KVNamespace | undefined): Promise<LeaderboardSnapshot | null> {
    if (!cache) {
        return null
    }

    try {
        const snapshot = await cache.get<unknown>(LEADERBOARD_CACHE_KEY, 'json')
        return isLeaderboardSnapshot(snapshot) ? snapshot : null
    } catch {
        return null
    }
}

export async function refreshLeaderboard(env: LeaderboardRefreshEnv, now: Date = new Date()): Promise<LeaderboardRefreshSummary> {
    const built = await buildLeaderboardSnapshot(env, now)

    await env.CACHE.put(LEADERBOARD_CACHE_KEY, JSON.stringify(built.snapshot))

    return {
        key: LEADERBOARD_CACHE_KEY,
        generatedAt: built.snapshot.generatedAt,
        scannedObjects: built.scannedObjects,
        recognizedObjects: built.recognizedObjects,
        skippedUnknownObjects: built.skippedUnknownObjects,
        totalManagedBytes: built.snapshot.totalManagedBytes,
        totalMonthlyStorageCostUsd: monthlyStorageCostUsd(built.snapshot.totalManagedBytes),
        rankedTopUsers: built.snapshot.topUsers.length,
        rankedUsersByCharacters: built.snapshot.usersByCharacters.length,
        rankedUsersByImages: built.snapshot.usersByImages.length,
        rankedUsersByData: built.snapshot.usersByData.length,
        rankedCharactersByData: built.snapshot.charactersByData.length,
    }
}

async function buildLeaderboardSnapshot(env: LeaderboardBuildEnv, now: Date = new Date()): Promise<BuiltLeaderboard> {
    const [usersByCharacters, usersByImages, totals, storage] = await Promise.all([
        getUsersByCharacterCount(env.DB),
        getUsersByImageCount(env.DB),
        getLeaderboardTotals(env.DB),
        aggregateManagedR2Storage(env.MEDIA_BUCKET),
    ])
    const [topUsers, usersByData, charactersByData] = await Promise.all([
        getTopUsers(env.DB, storage.userBytes),
        getUsersByData(env.DB, storage.userBytes),
        getCharactersByData(env.DB, storage.characterBytes),
    ])

    return {
        snapshot: {
            version: 1,
            generatedAt: now.toISOString(),
            costPerGbMonthUsd: STORAGE_COST_PER_GB_MONTH_USD,
            totalManagedBytes: storage.totalManagedBytes,
            totalUsers: totals.totalUsers,
            totalCharacters: totals.totalCharacters,
            totalImages: totals.totalImages,
            topUsers,
            usersByCharacters,
            usersByImages,
            usersByData,
            charactersByData,
        },
        scannedObjects: storage.scannedObjects,
        recognizedObjects: storage.recognizedObjects,
        skippedUnknownObjects: storage.skippedUnknownObjects,
    }
}

async function getLeaderboardTotals(db: D1Database): Promise<Pick<LeaderboardSnapshot, 'totalUsers' | 'totalCharacters' | 'totalImages'>> {
    const row = await db
        .prepare(
            `SELECT (SELECT COUNT(*) FROM users) AS total_users,
                    (SELECT COUNT(*) FROM characters) AS total_characters,
                    (SELECT COALESCE(SUM(
                        CASE WHEN sfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                            + CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                    ), 0) FROM character_media) AS total_images`,
        )
        .bind()
        .first<LeaderboardTotalsRow>()

    return {
        totalUsers: positiveInteger(row?.total_users),
        totalCharacters: positiveInteger(row?.total_characters),
        totalImages: positiveInteger(row?.total_images),
    }
}

async function getTopUsers(db: D1Database, userBytes: Map<string, number>): Promise<LeaderboardTopUserEntry[]> {
    const result = await db
        .prepare(
            `WITH character_counts AS (
                 SELECT user_id, COUNT(*) AS character_count
                 FROM characters
                 GROUP BY user_id
             ),
             image_counts AS (
                 SELECT user_id,
                        SUM(
                                CASE WHEN sfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                                    + CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                        ) AS image_count
                 FROM character_media
                 WHERE sfw_image_key IS NOT NULL
                    OR nsfw_image_key IS NOT NULL
                 GROUP BY user_id
             )
             SELECT users.id,
                    users.username,
                    users.profile_photo_key,
                    COALESCE(character_counts.character_count, 0) AS character_count,
                    COALESCE(image_counts.image_count, 0) AS image_count
             FROM users
                      LEFT JOIN character_counts ON character_counts.user_id = users.id
                      LEFT JOIN image_counts ON image_counts.user_id = users.id
             WHERE COALESCE(character_counts.character_count, 0) > 0
                OR COALESCE(image_counts.image_count, 0) > 0
             ORDER BY character_count DESC, image_count DESC, lower(users.username), users.id
             LIMIT ?`,
        )
        .bind(TOP_USER_CANDIDATE_LIMIT)
        .all<TopUserRow>()

    return (result.results ?? [])
        .map((row) => {
            const bytes = positiveInteger(userBytes.get(row.id) ?? 0)

            return {
                rank: 0,
                userId: row.id,
                username: row.username,
                profilePhotoKey: row.profile_photo_key ?? null,
                characterCount: positiveInteger(row.character_count),
                imageCount: positiveInteger(row.image_count),
                bytes,
                monthlyStorageCostUsd: monthlyStorageCostUsd(bytes),
            }
        })
        .sort(
            (left, right) =>
                right.characterCount - left.characterCount ||
                right.imageCount - left.imageCount ||
                right.bytes - left.bytes ||
                left.username.localeCompare(right.username) ||
                left.userId.localeCompare(right.userId),
        )
        .slice(0, LEADERBOARD_LIMIT)
        .map((entry, index) => ({...entry, rank: index + 1}))
}

function monthlyStorageCostUsd(bytes: number): number {
    return (Math.max(0, bytes) / BYTES_PER_GB) * STORAGE_COST_PER_GB_MONTH_USD
}

async function getUsersByCharacterCount(db: D1Database): Promise<LeaderboardUserCharacterEntry[]> {
    const result = await db
        .prepare(
            `SELECT users.id,
                    users.username,
                    users.profile_photo_key,
                    COUNT(characters.id) AS character_count
             FROM users
                      INNER JOIN characters ON characters.user_id = users.id
             GROUP BY users.id, users.username, users.profile_photo_key
             HAVING character_count > 0
             ORDER BY character_count DESC, lower(users.username), users.id
             LIMIT ?`,
        )
        .bind(LEADERBOARD_LIMIT)
        .all<CharacterCountRow>()

    return (result.results ?? []).map((row, index) => ({
        rank: index + 1,
        userId: row.id,
        username: row.username,
        profilePhotoKey: row.profile_photo_key ?? null,
        characterCount: positiveInteger(row.character_count),
    }))
}

async function getUsersByImageCount(db: D1Database): Promise<LeaderboardUserImageEntry[]> {
    const result = await db
        .prepare(
            `SELECT users.id,
                    users.username,
                    users.profile_photo_key,
                    SUM(
                            CASE WHEN character_media.sfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                                + CASE WHEN character_media.nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                    ) AS image_count
             FROM users
                      INNER JOIN character_media ON character_media.user_id = users.id
             WHERE character_media.sfw_image_key IS NOT NULL
                OR character_media.nsfw_image_key IS NOT NULL
             GROUP BY users.id, users.username, users.profile_photo_key
             HAVING image_count > 0
             ORDER BY image_count DESC, lower(users.username), users.id
             LIMIT ?`,
        )
        .bind(LEADERBOARD_LIMIT)
        .all<ImageCountRow>()

    return (result.results ?? []).map((row, index) => ({
        rank: index + 1,
        userId: row.id,
        username: row.username,
        profilePhotoKey: row.profile_photo_key ?? null,
        imageCount: positiveInteger(row.image_count),
    }))
}

async function getUsersByData(db: D1Database, userBytes: Map<string, number>): Promise<LeaderboardUserDataEntry[]> {
    const candidates = topStorageCandidates(userBytes)
    const usersById = await getLeaderboardUsers(
        db,
        candidates.map((candidate) => candidate.id),
    )

    return candidates
        .flatMap((candidate) => {
            const user = usersById.get(candidate.id)

            if (!user) {
                return []
            }

            return [
                {
                    rank: 0,
                    userId: user.id,
                    username: user.username,
                    profilePhotoKey: user.profile_photo_key ?? null,
                    bytes: candidate.bytes,
                    monthlyStorageCostUsd: monthlyStorageCostUsd(candidate.bytes),
                },
            ]
        })
        .slice(0, LEADERBOARD_LIMIT)
        .map((entry, index) => ({...entry, rank: index + 1}))
}

async function getCharactersByData(db: D1Database, characterBytes: Map<string, number>): Promise<LeaderboardCharacterDataEntry[]> {
    const candidates = topStorageCandidates(characterBytes)
    const charactersById = await getLeaderboardCharacters(
        db,
        candidates.map((candidate) => candidate.id),
    )

    return candidates
        .flatMap((candidate) => {
            const character = charactersById.get(candidate.id)

            if (!character) {
                return []
            }

            return [
                {
                    rank: 0,
                    characterId: character.id,
                    userId: character.user_id,
                    name: character.name,
                    ownerUsername: character.owner_username,
                    profileImageKey: character.profile_image_key,
                    bytes: candidate.bytes,
                    monthlyStorageCostUsd: monthlyStorageCostUsd(candidate.bytes),
                },
            ]
        })
        .slice(0, LEADERBOARD_LIMIT)
        .map((entry, index) => ({...entry, rank: index + 1}))
}

async function getLeaderboardUsers(db: D1Database, userIds: string[]): Promise<Map<string, UserLeaderboardRow>> {
    const rows = await selectRowsByIds<UserLeaderboardRow>(
        db,
        userIds,
        (placeholders) => `SELECT id, username, profile_photo_key
                           FROM users
                           WHERE id IN (${placeholders})`,
    )

    return new Map(rows.map((row) => [row.id, row]))
}

async function getLeaderboardCharacters(db: D1Database, characterIds: string[]): Promise<Map<string, CharacterLeaderboardRow>> {
    const rows = await selectRowsByIds<CharacterLeaderboardRow>(
        db,
        characterIds,
        (placeholders) => `SELECT characters.id,
                                  characters.user_id,
                                  characters.name,
                                  characters.profile_image_key,
                                  users.username AS owner_username
                           FROM characters
                                    INNER JOIN users ON users.id = characters.user_id
                           WHERE characters.id IN (${placeholders})`,
    )

    return new Map(rows.map((row) => [row.id, row]))
}

async function selectRowsByIds<TRow>(db: D1Database, ids: string[], sqlForPlaceholders: (placeholders: string) => string): Promise<TRow[]> {
    const rows: TRow[] = []
    const uniqueIds = [...new Set(ids)]

    for (let index = 0; index < uniqueIds.length; index += D1_SAFE_VARIABLES_PER_QUERY) {
        const chunk = uniqueIds.slice(index, index + D1_SAFE_VARIABLES_PER_QUERY)

        if (chunk.length === 0) {
            continue
        }

        const placeholders = chunk.map(() => '?').join(', ')
        const result = await db
            .prepare(sqlForPlaceholders(placeholders))
            .bind(...chunk)
            .all<TRow>()

        rows.push(...(result.results ?? []))
    }

    return rows
}

async function aggregateManagedR2Storage(bucket: R2Bucket): Promise<StorageAggregation> {
    const aggregation: StorageAggregation = {
        userBytes: new Map(),
        characterBytes: new Map(),
        scannedObjects: 0,
        recognizedObjects: 0,
        skippedUnknownObjects: 0,
        totalManagedBytes: 0,
    }

    for (const prefix of MANAGED_R2_PREFIXES) {
        let cursor: string | undefined

        do {
            const listed = await bucket.list({
                prefix,
                limit: R2_LIST_LIMIT,
                cursor,
            })

            for (const object of listed.objects) {
                aggregation.scannedObjects += 1

                const parsed = parseManagedR2MediaKey(object.key)

                if (!parsed) {
                    aggregation.skippedUnknownObjects += 1
                    continue
                }

                const bytes = positiveInteger(object.size)

                aggregation.recognizedObjects += 1
                aggregation.totalManagedBytes += bytes

                switch (parsed.kind) {
                    case 'userProfile':
                        addBytes(aggregation.userBytes, parsed.userId, bytes)
                        break
                    case 'characterFolderImage':
                        addBytes(aggregation.userBytes, parsed.userId, bytes)
                        break
                    case 'characterProfile':
                    case 'characterMedia':
                    case 'characterMediaPreview':
                    case 'characterMediaNsfwBlur':
                    case 'characterHeightChart':
                        addBytes(aggregation.userBytes, parsed.userId, bytes)
                        addBytes(aggregation.characterBytes, parsed.characterId, bytes)
                        break
                }
            }

            cursor = listed.truncated ? listed.cursor : undefined
        } while (cursor)
    }

    return aggregation
}

function topStorageCandidates(bytesById: Map<string, number>): StorageCandidate[] {
    return [...bytesById.entries()]
        .map(([id, bytes]) => ({id, bytes: positiveInteger(bytes)}))
        .filter((candidate) => candidate.bytes > 0)
        .sort((left, right) => right.bytes - left.bytes || left.id.localeCompare(right.id))
        .slice(0, LEADERBOARD_STORAGE_CANDIDATE_LIMIT)
}

function addBytes(target: Map<string, number>, id: string, bytes: number): void {
    target.set(id, (target.get(id) ?? 0) + bytes)
}

function positiveInteger(value: unknown): number {
    const number = Number(value)

    if (!Number.isFinite(number) || number <= 0) {
        return 0
    }

    return Math.floor(number)
}

function isLeaderboardSnapshot(value: unknown): value is LeaderboardSnapshot {
    if (!isRecord(value)) {
        return false
    }

    return (
        value.version === 1 &&
        typeof value.generatedAt === 'string' &&
        Number.isFinite(value.costPerGbMonthUsd) &&
        Number.isFinite(value.totalManagedBytes) &&
        Number.isFinite(value.totalUsers) &&
        Number.isFinite(value.totalCharacters) &&
        Number.isFinite(value.totalImages) &&
        Array.isArray(value.topUsers) &&
        value.topUsers.every(isTopUserEntry) &&
        Array.isArray(value.usersByCharacters) &&
        value.usersByCharacters.every(isUserCharacterEntry) &&
        Array.isArray(value.usersByImages) &&
        value.usersByImages.every(isUserImageEntry) &&
        Array.isArray(value.usersByData) &&
        value.usersByData.every(isUserDataEntry) &&
        Array.isArray(value.charactersByData) &&
        value.charactersByData.every(isCharacterDataEntry)
    )
}

function isUserBaseEntry(value: unknown): value is LeaderboardUserBaseEntry {
    if (!isRecord(value)) {
        return false
    }

    return (
        Number.isFinite(value.rank) &&
        typeof value.userId === 'string' &&
        typeof value.username === 'string' &&
        (typeof value.profilePhotoKey === 'string' || value.profilePhotoKey === null)
    )
}

function isUserCharacterEntry(value: unknown): value is LeaderboardUserCharacterEntry {
    if (!isUserBaseEntry(value) || !isRecord(value)) {
        return false
    }

    const entry = value as Record<string, unknown>
    return Number.isFinite(entry.characterCount)
}

function isUserImageEntry(value: unknown): value is LeaderboardUserImageEntry {
    if (!isUserBaseEntry(value) || !isRecord(value)) {
        return false
    }

    const entry = value as Record<string, unknown>
    return Number.isFinite(entry.imageCount)
}

function isUserDataEntry(value: unknown): value is LeaderboardUserDataEntry {
    if (!isUserBaseEntry(value) || !isRecord(value)) {
        return false
    }

    const entry = value as Record<string, unknown>
    return Number.isFinite(entry.bytes) && Number.isFinite(entry.monthlyStorageCostUsd)
}

function isTopUserEntry(value: unknown): value is LeaderboardTopUserEntry {
    if (!isUserBaseEntry(value) || !isRecord(value)) {
        return false
    }

    const entry = value as Record<string, unknown>

    return (
        Number.isFinite(entry.characterCount) &&
        Number.isFinite(entry.imageCount) &&
        Number.isFinite(entry.bytes) &&
        Number.isFinite(entry.monthlyStorageCostUsd)
    )
}

function isCharacterDataEntry(value: unknown): value is LeaderboardCharacterDataEntry {
    if (!isRecord(value)) {
        return false
    }

    return (
        Number.isFinite(value.rank) &&
        typeof value.characterId === 'string' &&
        typeof value.userId === 'string' &&
        typeof value.name === 'string' &&
        typeof value.ownerUsername === 'string' &&
        typeof value.profileImageKey === 'string' &&
        Number.isFinite(value.bytes) &&
        Number.isFinite(value.monthlyStorageCostUsd)
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}
