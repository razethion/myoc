import {Hono} from 'hono'
import {beforeEach, describe, expect, it} from 'vitest'
import type {RecentMediaItem} from '../../lib/recentMedia'
import {resetRecentFeedHeadCache} from '../../lib/recentMedia/query'
import {seedAuthenticatedUser, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {apiRoutes} from '../api'

const app = new Hono<{Bindings: Bindings}>().route('/api', apiRoutes)
const db = useTestDatabase()
const cursorSecret = 'test-secret-with-at-least-thirty-two-characters'
const env = createWorkerEnv({DB: db, RECENT_FEED_CURSOR_SECRET: cursorSecret})

beforeEach(async () => {
    resetRecentFeedHeadCache()
    await seedUser({id: 'user-1'})
    await seedCharacter({id: 'character-1', userId: 'user-1'})
})

async function requestRecentMedia(query = '', init: RequestInit = {}): Promise<Response> {
    return await app.request(`https://example.com/api/recent-media${query}`, init, env)
}

async function seedUpload(options: {
    id: string
    createdAt: string
    approved?: boolean
    nsfwOnly?: boolean
    userId?: string
    characterId?: string
}): Promise<void> {
    const {id, createdAt, approved = false, nsfwOnly = false, userId = 'user-1', characterId = 'character-1'} = options

    await seedMedia({
        id,
        userId,
        characterId,
        sfwImageKey: nsfwOnly ? null : `${id}-sfw`,
        sfwPreviewImageKey: nsfwOnly ? null : `${id}-sfw-preview`,
        sfwReviewStatus: approved ? 'approved' : 'pending',
        sfwApprovedAt: approved ? createdAt : null,
        nsfwImageKey: nsfwOnly ? `${id}-nsfw` : null,
        nsfwPreviewImageKey: nsfwOnly ? `${id}-nsfw-preview` : null,
        nsfwReviewStatus: approved ? 'approved' : 'pending',
        nsfwApprovedAt: approved ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
    })
}

type RecentMediaPageBody = {
    items: RecentMediaItem[]
    nextCursor: string | null
    head: string | null
}

async function itemIds(response: Response): Promise<string[]> {
    const body = await response.json<{items: RecentMediaItem[]}>()

    return body.items.map((item) => item.id)
}

describe('recent media API', () => {
    it('returns the requested feed variant and page shape', async () => {
        await seedUpload({id: 'approved-media', createdAt: '2026-08-25 12:00:00', approved: true})
        await seedUpload({id: 'pending-media', createdAt: '2026-08-25 11:00:00'})

        const unapprovedResponse = await requestRecentMedia('?nsfw=false&unapproved=true')
        expect(unapprovedResponse.status).toBe(200)
        expect(await itemIds(unapprovedResponse)).toEqual(['approved-media', 'pending-media'])

        const approvedResponse = await requestRecentMedia('?nsfw=false&unapproved=false')
        expect(approvedResponse.status).toBe(200)
        await expect(approvedResponse.json()).resolves.toMatchObject({
            items: [{id: 'approved-media'}],
            nextCursor: null,
            head: expect.any(String),
        })
    })

    it('uses the signed-in user media settings when query settings are absent', async () => {
        await seedAuthenticatedUser(
            {
                id: 'settings-user',
                username: 'settings_user',
                displayNsfwMedia: true,
                showUnapprovedMedia: false,
            },
            'settings-session',
            db,
        )
        await seedCharacter({id: 'settings-character', userId: 'settings-user'})
        await seedUpload({
            id: 'approved-sfw',
            createdAt: '2026-08-25 12:00:00',
            approved: true,
            userId: 'settings-user',
            characterId: 'settings-character',
        })
        await seedUpload({
            id: 'approved-nsfw',
            createdAt: '2026-08-25 12:01:00',
            approved: true,
            nsfwOnly: true,
            userId: 'settings-user',
            characterId: 'settings-character',
        })
        await seedUpload({id: 'pending-sfw', createdAt: '2026-08-25 12:02:00', userId: 'settings-user', characterId: 'settings-character'})

        const response = await requestRecentMedia('', {headers: {Cookie: 'myoc_session=settings-session'}})

        expect(response.status).toBe(200)
        expect(await itemIds(response)).toEqual(['approved-nsfw', 'approved-sfw'])
    })

    it('uses public media defaults when there is no signed-in user', async () => {
        await seedUpload({id: 'public-default', createdAt: '2026-08-25 12:00:00'})
        await seedUpload({id: 'nsfw-only', createdAt: '2026-08-25 12:01:00', approved: true, nsfwOnly: true})

        const response = await requestRecentMedia()

        expect(response.status).toBe(200)
        expect(await itemIds(response)).toEqual(['public-default'])
    })

    it.each([
        ['an invalid limit', '?limit=0'],
        ['an invalid media setting', '?nsfw=yes'],
        ['a cursor that is too long', `?cursor=${'x'.repeat(513)}`],
    ])('rejects %s', async (_description, query) => {
        const response = await requestRecentMedia(query)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media query is invalid'})
    })

    it('rejects a tampered cursor', async () => {
        await seedUpload({id: 'first', createdAt: '2026-08-25 12:03:00'})
        await seedUpload({id: 'second', createdAt: '2026-08-25 12:02:00'})
        await seedUpload({id: 'third', createdAt: '2026-08-25 12:01:00'})

        const firstPage = await requestRecentMedia('?nsfw=false&unapproved=true&limit=1')
        const body = await firstPage.json<{nextCursor: string | null}>()
        expect(body.nextCursor).toBeTypeOf('string')

        const tampered = `${body.nextCursor?.slice(0, -3)}aaa`
        const response = await requestRecentMedia(`?nsfw=false&unapproved=true&limit=1&cursor=${tampered}`)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media cursor is invalid'})
    })

    it('pages with signed cursors', async () => {
        await seedUpload({id: 'first', createdAt: '2026-08-25 12:03:00'})
        await seedUpload({id: 'second', createdAt: '2026-08-25 12:02:00'})
        await seedUpload({id: 'third', createdAt: '2026-08-25 12:01:00'})

        const firstBody = await (await requestRecentMedia('?nsfw=false&unapproved=true&limit=1')).json<RecentMediaPageBody>()
        expect(firstBody.items.map((item) => item.id)).toEqual(['first'])
        expect(firstBody.nextCursor).toBeTypeOf('string')

        const secondBody = await (
            await requestRecentMedia(`?nsfw=false&unapproved=true&limit=1&cursor=${firstBody.nextCursor}`)
        ).json<RecentMediaPageBody>()
        expect(secondBody.items.map((item) => item.id)).toEqual(['second'])
        expect(secondBody.nextCursor).toBeTypeOf('string')

        const thirdBody = await (
            await requestRecentMedia(`?nsfw=false&unapproved=true&limit=1&cursor=${secondBody.nextCursor}`)
        ).json<RecentMediaPageBody>()
        expect(thirdBody.items.map((item) => item.id)).toEqual(['third'])
        expect(thirdBody.nextCursor).toBeNull()
    })

    it('counts uploads newer than the pinned head on the state route', async () => {
        await seedUpload({id: 'older-media', createdAt: '2026-08-25 12:00:00', approved: true})

        const page = await requestRecentMedia('?nsfw=false&unapproved=false')
        const head = (await page.json<{head: string | null}>()).head
        expect(head).toBeTypeOf('string')

        await seedUpload({id: 'newer-media', createdAt: '2026-08-25 12:05:00', approved: true})
        resetRecentFeedHeadCache()

        const stateResponse = await requestRecentMedia(`/state?cursor=${head}&nsfw=false&unapproved=false`)
        expect(stateResponse.status).toBe(200)
        expect(stateResponse.headers.get('cache-control')).toBe('no-store')
        const state = await stateResponse.json<{head: string | null; newCount: number}>()
        expect(state.newCount).toBe(1)
        expect(state.head).not.toBe(head)

        const freshState = await requestRecentMedia('/state?nsfw=false&unapproved=false')
        await expect(freshState.json()).resolves.toMatchObject({newCount: 0})
    })

    it('rejects state cursors from another variant', async () => {
        await seedUpload({id: 'first', createdAt: '2026-08-25 12:03:00'})
        await seedUpload({id: 'second', createdAt: '2026-08-25 12:02:00'})

        const page = await requestRecentMedia('?nsfw=true&unapproved=true&limit=1')
        const cursor = (await page.json<{nextCursor: string | null}>()).nextCursor
        expect(cursor).toBeTypeOf('string')

        const response = await requestRecentMedia(`/state?cursor=${cursor}&nsfw=false&unapproved=true`)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media cursor is invalid'})
    })
})
