import {characterProfileImageUrl, profilePhotoUrl} from './media/url'

export const SEARCH_QUERY_MAX_LENGTH = 80
export const SEARCH_USER_PAGE_SIZE = 4
export const SEARCH_CHARACTER_PAGE_SIZE = 8
const SEARCH_MAX_OFFSET = 1000

export type SearchUserResult = {
    id: string
    username: string
    bio: string
    profilePhotoUrl: string
    profileUrl: string
    characterCount: number
}

export type SearchCharacterResult = {
    id: string
    name: string
    ownerId: string
    ownerUsername: string
    profileImageUrl: string
    characterUrl: string
}

export type SearchCollection<T> = {
    items: T[]
    total: number
    nextOffset: number | null
    hasMore: boolean
}

export type SearchResults = {
    query: string
    wasTruncated: boolean
    users: SearchCollection<SearchUserResult>
    characters: SearchCollection<SearchCharacterResult>
}

type UserSearchRow = {
    id: string
    username: string
    bio: string
    profile_photo_key: string | null
    character_count: number
}

type CharacterSearchRow = {
    id: string
    name: string
    profile_image_key: string
    user_id: string
    username: string
}

export function normalizeSearchQuery(value: unknown): {query: string; wasTruncated: boolean} {
    const rawValue = typeof value === 'string' ? value : ''
    const normalized = rawValue.normalize('NFKC').replace(/\s+/g, ' ').trim()
    const query = normalized.slice(0, SEARCH_QUERY_MAX_LENGTH)

    return {
        query,
        wasTruncated: normalized.length > query.length,
    }
}

export function normalizeSearchOffset(value: unknown): number {
    const rawValue = typeof value === 'string' ? value : ''
    if (!/^\d+$/.test(rawValue)) {
        return 0
    }

    const offset = Number.parseInt(rawValue, 10)

    if (!Number.isFinite(offset) || offset < 0) {
        return 0
    }

    return Math.min(offset, SEARCH_MAX_OFFSET)
}

export async function searchAll(db: D1Database, mediaBaseUrl: string, rawQuery: unknown): Promise<SearchResults> {
    const {query, wasTruncated} = normalizeSearchQuery(rawQuery)
    const [users, characters] = await Promise.all([
        searchUsers(db, mediaBaseUrl, query, SEARCH_USER_PAGE_SIZE, 0),
        searchCharacters(db, mediaBaseUrl, query, SEARCH_CHARACTER_PAGE_SIZE, 0),
    ])

    return {
        query,
        wasTruncated,
        users,
        characters,
    }
}

export async function searchUsers(
    db: D1Database,
    mediaBaseUrl: string,
    query: string,
    limit = SEARCH_USER_PAGE_SIZE,
    offset = 0,
): Promise<SearchCollection<SearchUserResult>> {
    if (!query) {
        return emptyCollection(offset)
    }

    const safeLimit = normalizeLimit(limit, SEARCH_USER_PAGE_SIZE)
    const safeOffset = normalizeSearchOffset(String(offset))
    const terms = createSearchTerms(query)
    const result = await db
        .prepare(
            `SELECT users.id,
                users.username,
                users.bio,
                users.profile_photo_key,
                COUNT(characters.id) AS character_count
         FROM users
         LEFT JOIN characters ON characters.user_id = users.id
         WHERE lower(users.username) = ?
            OR lower(users.username) LIKE ? ESCAPE '\\'
            OR lower(users.username) LIKE ? ESCAPE '\\'
            OR lower(users.bio) LIKE ? ESCAPE '\\'
         GROUP BY users.id, users.username, users.bio, users.profile_photo_key
         ORDER BY CASE
                      WHEN lower(users.username) = ? THEN 0
                      WHEN lower(users.username) LIKE ? ESCAPE '\\' THEN 1
                      WHEN lower(users.username) LIKE ? ESCAPE '\\' THEN 2
                      WHEN lower(users.bio) LIKE ? ESCAPE '\\' THEN 3
                      ELSE 4
                  END,
                  lower(users.username)
         LIMIT ? OFFSET ?`,
        )
        .bind(
            terms.exact,
            terms.prefix,
            terms.contains,
            terms.contains,
            terms.exact,
            terms.prefix,
            terms.contains,
            terms.contains,
            safeLimit + 1,
            safeOffset,
        )
        .all<UserSearchRow>()
    const total = await countUsers(db, terms)
    const rows = result.results ?? []
    const items = rows.slice(0, safeLimit).map((row) => toUserSearchResult(row, mediaBaseUrl))

    return collectionFromItems(items, total, rows.length > safeLimit, safeLimit, safeOffset)
}

export async function searchCharacters(
    db: D1Database,
    mediaBaseUrl: string,
    query: string,
    limit = SEARCH_CHARACTER_PAGE_SIZE,
    offset = 0,
): Promise<SearchCollection<SearchCharacterResult>> {
    if (!query) {
        return emptyCollection(offset)
    }

    const safeLimit = normalizeLimit(limit, SEARCH_CHARACTER_PAGE_SIZE)
    const safeOffset = normalizeSearchOffset(String(offset))
    const terms = createSearchTerms(query)
    const result = await db
        .prepare(
            `SELECT characters.id,
                characters.name,
                characters.profile_image_key,
                users.id AS user_id,
                users.username
         FROM characters
         INNER JOIN users ON users.id = characters.user_id
         WHERE lower(characters.name) = ?
            OR lower(characters.name) LIKE ? ESCAPE '\\'
            OR lower(characters.name) LIKE ? ESCAPE '\\'
            OR lower(users.username) = ?
            OR lower(users.username) LIKE ? ESCAPE '\\'
            OR lower(users.username) LIKE ? ESCAPE '\\'
         ORDER BY CASE
                      WHEN lower(characters.name) = ? THEN 0
                      WHEN lower(characters.name) LIKE ? ESCAPE '\\' THEN 1
                      WHEN lower(characters.name) LIKE ? ESCAPE '\\' THEN 2
                      WHEN lower(users.username) = ? THEN 3
                      WHEN lower(users.username) LIKE ? ESCAPE '\\' THEN 4
                      WHEN lower(users.username) LIKE ? ESCAPE '\\' THEN 5
                      ELSE 6
                  END,
                  lower(characters.name),
                  lower(users.username)
         LIMIT ? OFFSET ?`,
        )
        .bind(
            terms.exact,
            terms.prefix,
            terms.contains,
            terms.exact,
            terms.prefix,
            terms.contains,
            terms.exact,
            terms.prefix,
            terms.contains,
            terms.exact,
            terms.prefix,
            terms.contains,
            safeLimit + 1,
            safeOffset,
        )
        .all<CharacterSearchRow>()
    const total = await countCharacters(db, terms)
    const rows = result.results ?? []
    const items = rows.slice(0, safeLimit).map((row) => toCharacterSearchResult(row, mediaBaseUrl))

    return collectionFromItems(items, total, rows.length > safeLimit, safeLimit, safeOffset)
}

function createSearchTerms(query: string): {exact: string; prefix: string; contains: string} {
    const exact = query.toLowerCase()
    const escaped = escapeLike(exact)

    return {
        exact,
        prefix: `${escaped}%`,
        contains: `%${escaped}%`,
    }
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

async function countUsers(db: D1Database, terms: {exact: string; prefix: string; contains: string}): Promise<number> {
    const row = await db
        .prepare(
            `SELECT COUNT(*) AS count
         FROM users
         WHERE lower(username) = ?
            OR lower(username) LIKE ? ESCAPE '\\'
            OR lower(username) LIKE ? ESCAPE '\\'
            OR lower(bio) LIKE ? ESCAPE '\\'`,
        )
        .bind(terms.exact, terms.prefix, terms.contains, terms.contains)
        .first<{count: number}>()

    return Number(row?.count ?? 0)
}

async function countCharacters(
    db: D1Database,
    terms: {
        exact: string
        prefix: string
        contains: string
    },
): Promise<number> {
    const row = await db
        .prepare(
            `SELECT COUNT(*) AS count
         FROM characters
         INNER JOIN users ON users.id = characters.user_id
         WHERE lower(characters.name) = ?
            OR lower(characters.name) LIKE ? ESCAPE '\\'
            OR lower(characters.name) LIKE ? ESCAPE '\\'
            OR lower(users.username) = ?
            OR lower(users.username) LIKE ? ESCAPE '\\'
            OR lower(users.username) LIKE ? ESCAPE '\\'`,
        )
        .bind(terms.exact, terms.prefix, terms.contains, terms.exact, terms.prefix, terms.contains)
        .first<{count: number}>()

    return Number(row?.count ?? 0)
}

function normalizeLimit(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return fallback
    }

    return Math.min(Math.floor(value), 24)
}

function emptyCollection<T>(offset = 0): SearchCollection<T> {
    return {
        items: [],
        total: 0,
        nextOffset: offset,
        hasMore: false,
    }
}

function collectionFromItems<T>(items: T[], total: number, hasMore: boolean, limit: number, offset: number): SearchCollection<T> {
    return {
        items,
        total,
        nextOffset: hasMore ? offset + limit : null,
        hasMore,
    }
}

function toUserSearchResult(row: UserSearchRow, mediaBaseUrl: string): SearchUserResult {
    return {
        id: row.id,
        username: row.username,
        bio: row.bio,
        profilePhotoUrl: row.profile_photo_key
            ? profilePhotoUrl(mediaBaseUrl, row.id, row.profile_photo_key)
            : fallbackAvatarUrl(row.username),
        profileUrl: userProfileUrl(row.username),
        characterCount: Number(row.character_count ?? 0),
    }
}

function toCharacterSearchResult(row: CharacterSearchRow, mediaBaseUrl: string): SearchCharacterResult {
    return {
        id: row.id,
        name: row.name,
        ownerId: row.user_id,
        ownerUsername: row.username,
        profileImageUrl: characterProfileImageUrl(mediaBaseUrl, row.user_id, row.id, row.profile_image_key),
        characterUrl: `${userProfileUrl(row.username)}/${encodeURIComponent(row.name)}`,
    }
}

function userProfileUrl(username: string): string {
    return `/u/${encodeURIComponent(username)}`
}

function fallbackAvatarUrl(name: string): string {
    const letter = name.trim().charAt(0).toUpperCase() || 'U'

    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=ccc&color=000`
}
