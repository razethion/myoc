import type {WorkflowStep} from 'cloudflare:workers'
import {completeAdminJobRun} from '../lib/admin/jobs'
import {publishRecentFeed, requestRecentFeedRegeneration} from '../lib/recentMedia/publisher'
import type {Bindings} from '../types/bindings'

export type RecentFeedRegenerationWorkflowParams = {
    kind: 'recent-feed'
    runId: string
}

const STEP_CONFIG = {
    retries: {limit: 10, delay: '5 seconds', backoff: 'exponential'},
    timeout: '5 minutes',
} as const

export async function runRecentFeedRegenerationWorkflow(env: Bindings, params: RecentFeedRegenerationWorkflowParams, step: WorkflowStep) {
    const requested = await step.do('request recent feed regeneration', STEP_CONFIG, async () => {
        const result = await requestRecentFeedRegeneration(env, params.runId)
        if (result.status === 'busy') throw new Error('Recent feed publication is busy. Try again shortly.')
        return result
    })
    if (requested.status === 'closed') return {status: 'closed'}

    for (let batch = 1; batch <= 1_000; batch += 1) {
        const result = await step.do(`publish recent feed batch ${batch}`, STEP_CONFIG, async () => {
            const active = await env.DB.prepare(
                `SELECT id FROM admin_job_runs WHERE id = ? AND job_name = 'recent-feed-regeneration' AND status = 'running'`,
            )
                .bind(params.runId)
                .first<{id: string}>()
            if (!active) return null

            const summary = await publishRecentFeed(env, {force: true})
            await env.DB.prepare(
                `UPDATE admin_job_runs SET summary_json = json_patch(COALESCE(summary_json, '{}'), ?)
                 WHERE id = ? AND status = 'running'`,
            )
                .bind(JSON.stringify(summary), params.runId)
                .run()
            return summary
        })
        if (!result) return {status: 'closed'}

        if (result.status === 'published' || result.status === 'current') {
            await step.do('complete recent feed regeneration', STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, result)
                return {finished: true}
            })
            return result
        }

        await step.sleep(`wait for recent feed batch ${batch}`, '1 second')
    }

    throw new Error('Recent page regeneration did not finish within 1000 batches. Start it again from Admin Options.')
}
