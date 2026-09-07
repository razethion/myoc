/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {reset} from 'cloudflare:test'
import {env} from 'cloudflare:workers'
import type {Bindings} from '../types/bindings'

export const workerEnv = env as Bindings

export function createWorkerEnv(overrides: Partial<Bindings> = {}): Bindings {
    return {
        ...workerEnv,
        ...overrides,
    }
}

export async function resetWorkerBindings(): Promise<void> {
    await reset()
}
