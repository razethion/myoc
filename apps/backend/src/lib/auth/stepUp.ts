import type {Context} from 'hono'
import type {Bindings} from '../../types/bindings'
import {jsonResponse} from '../http/jsonResponse'
import {StepUpRequiredResponseSchema} from '../http/responseSchemas'

export const STEP_UP_REQUIRED_ERROR = 'Your login is too old for this change. Log in again, then retry.'

export function stepUpRequiredResponse(c: Context<{Bindings: Bindings}>): Response {
    return jsonResponse(c, StepUpRequiredResponseSchema, {error: STEP_UP_REQUIRED_ERROR, stepUpRequired: true}, 403)
}
