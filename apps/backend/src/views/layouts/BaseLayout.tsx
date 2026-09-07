import {raw} from 'hono/html'
import type {Child} from 'hono/jsx'

const FAVICON_DATA_URL =
    'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2210%22%20fill%3D%22%23050505%22%2F%3E%3Cg%20fill%3D%22%23fff%22%20font-family%3D%22Nohemi%2CArial%2Csans-serif%22%20font-size%3D%2225%22%20font-weight%3D%22800%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%2232%22%20y%3D%2228%22%3EMY%3C%2Ftext%3E%3Ctext%20x%3D%2232%22%20y%3D%2251%22%3EOC%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E'

type BaseLayoutProps = {
    title: string
    head?: Child
    children: Child
}

export function BaseLayout({title, head, children}: BaseLayoutProps) {
    return (
        <>
            {raw('<!DOCTYPE html>')}
            <html data-theme="black" lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta content="width=device-width, initial-scale=1" name="viewport" />
                    <title>{title}</title>
                    <link href={FAVICON_DATA_URL} rel="icon" type="image/svg+xml" />
                    <link href="/app.css" rel="stylesheet" />
                    {head}
                </head>
                <body class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
                    {children}
                    <UploadCenter />
                </body>
            </html>
        </>
    )
}

function UploadCenter() {
    return (
        <>
            <div aria-live="polite" class="toast toast-end toast-bottom z-50 hidden max-w-[min(24rem,calc(100vw-2rem))]" data-upload-center>
                <section class="card card-sm border border-base-300 bg-base-100 shadow-xl" data-upload-center-card>
                    <div class="card-body gap-3">
                        <div class="flex items-center justify-between gap-4">
                            <h2 class="card-title text-base">Uploads</h2>
                            <button aria-label="Hide completed uploads" class="btn btn-ghost btn-xs" data-upload-center-clear type="button">
                                Clear
                            </button>
                        </div>
                        <div class="space-y-2" data-upload-center-list />
                    </div>
                </section>
            </div>
            <script>{raw(UPLOAD_CENTER_SCRIPT)}</script>
        </>
    )
}

const UPLOAD_CENTER_SCRIPT = `
(() => {
    const root = document.querySelector('[data-upload-center]');
    const list = document.querySelector('[data-upload-center-list]');
    const clearButton = document.querySelector('[data-upload-center-clear]');
    if (!root || !list || !clearButton) return;

    const storageKey = 'myoc-active-image-uploads-v1';
    const records = new Map();
    const pollDelays = [1000, 2000, 3000, 5000];
    let timer = null;

    function save() {
        const stored = [...records.values()].map(({id, label, statusUrl, state, csrfToken}) => ({id, label, statusUrl, state, csrfToken}));
        sessionStorage.setItem(storageKey, JSON.stringify(stored));
    }

    function restore() {
        try {
            const stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
            if (!Array.isArray(stored)) return;
            for (const item of stored) {
                if (!item || typeof item.id !== 'string' || typeof item.statusUrl !== 'string') continue;
                records.set(item.id, {
                    id: item.id,
                    label: typeof item.label === 'string' ? item.label : 'Image upload',
                    statusUrl: item.statusUrl,
                    state: typeof item.state === 'string' ? item.state : 'waiting',
                    csrfToken: typeof item.csrfToken === 'string' ? item.csrfToken : '',
                    delayIndex: 0,
                    etag: '',
                });
            }
        } catch {
            sessionStorage.removeItem(storageKey);
        }
    }

    function stateText(state) {
        if (state === 'ready') return 'Ready';
        if (state === 'failed') return 'Failed';
        if (state === 'canceled') return 'Canceled';
        if (state === 'processing') return 'Processing';
        if (state === 'uploading') return 'Uploading';
        return 'Waiting';
    }

    function render() {
        const active = [...records.values()];
        root.classList.toggle('hidden', active.length === 0);
        list.replaceChildren();

        for (const record of active) {
            const item = document.createElement('div');
            item.className = record.state === 'failed'
                ? 'alert alert-error alert-soft flex items-center justify-between gap-3'
                : 'flex items-center justify-between gap-3 rounded-box bg-base-200 p-3';
            const copy = document.createElement('div');
            const label = document.createElement('p');
            label.className = 'font-medium';
            label.textContent = record.label;
            const status = document.createElement('p');
            status.className = 'text-sm text-base-content/70';
            status.textContent = record.error || stateText(record.state);
            copy.append(label, status);
            item.append(copy);

            if (!['ready', 'failed', 'canceled'].includes(record.state)) {
                const actions = document.createElement('div');
                actions.className = 'flex items-center gap-2';
                const spinner = document.createElement('span');
                spinner.className = 'loading loading-spinner loading-sm shrink-0';
                spinner.setAttribute('aria-label', 'Processing');
                actions.append(spinner);
                if (record.csrfToken) {
                    const cancel = document.createElement('button');
                    cancel.className = 'btn btn-ghost btn-xs';
                    cancel.type = 'button';
                    cancel.textContent = 'Cancel';
                    cancel.addEventListener('click', () => cancelJob(record));
                    actions.append(cancel);
                }
                item.append(actions);
            } else if (record.state === 'failed' && record.csrfToken) {
                const retry = document.createElement('button');
                retry.className = 'btn btn-sm';
                retry.type = 'button';
                retry.textContent = 'Retry';
                retry.addEventListener('click', () => retryJob(record));
                item.append(retry);
            }

            list.append(item);
        }
    }

    async function retryJob(record) {
        const response = await fetch(record.statusUrl + '/retry', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'idempotency-key': crypto.randomUUID(),
                'x-csrf-token': record.csrfToken,
            },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.job) {
            record.error = body.error || 'Could not retry the upload.';
            render();
            return;
        }
        updateRecord(record, body.job);
        schedule(0);
    }

    async function cancelJob(record) {
        const response = await fetch(record.statusUrl, {
            method: 'DELETE',
            headers: {'x-csrf-token': record.csrfToken},
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.job) {
            record.error = body.error || 'Could not cancel the upload.';
            render();
            return;
        }
        updateRecord(record, body.job);
    }

    function updateRecord(record, job) {
        record.state = job.state;
        record.error = job.error && job.error.message ? job.error.message : '';
        record.delayIndex = job.state === 'processing' ? Math.min(record.delayIndex + 1, pollDelays.length - 1) : 0;
        save();
        render();
        if (job.state === 'ready' && typeof record.onReady === 'function') record.onReady(job.result || {});
        if (job.state === 'failed' && typeof record.onFailed === 'function') record.onFailed(job.error || {});
    }

    async function pollRecord(record) {
        const headers = {accept: 'application/json'};
        if (record.etag) headers['if-none-match'] = record.etag;
        const response = await fetch(record.statusUrl, {headers});
        if (response.status === 304) return;
        if (!response.ok) throw new Error('Could not read upload status.');
        record.etag = response.headers.get('etag') || '';
        const body = await response.json();
        if (!body.job) throw new Error('Upload status was invalid.');
        updateRecord(record, body.job);
    }

    async function poll() {
        timer = null;
        if (document.hidden) return;
        const active = [...records.values()].filter((record) => !['ready', 'failed', 'canceled'].includes(record.state));
        await Promise.all(active.map(async (record) => {
            try {
                await pollRecord(record);
            } catch (error) {
                record.error = error instanceof Error ? error.message : 'Could not read upload status.';
                record.delayIndex = Math.min(record.delayIndex + 1, pollDelays.length - 1);
                render();
            }
        }));
        if (active.length > 0) {
            const delay = Math.max(...active.map((record) => pollDelays[record.delayIndex] || 5000));
            schedule(delay + Math.floor(Math.random() * 400));
        }
    }

    function schedule(delay) {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(poll, delay);
    }

    clearButton.addEventListener('click', () => {
        for (const [id, record] of records) {
            if (['ready', 'canceled'].includes(record.state)) records.delete(id);
        }
        save();
        render();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) schedule(0);
    });

    restore();
    render();
    if (records.size > 0) schedule(0);

    window.myocUploadCenter = {
        track(payload, options = {}) {
            if (!payload || !payload.job || typeof payload.statusUrl !== 'string') return;
            const record = {
                id: payload.job.id,
                label: options.label || 'Image upload',
                statusUrl: payload.statusUrl,
                state: payload.job.state,
                csrfToken: options.csrfToken || '',
                onReady: options.onReady,
                onFailed: options.onFailed,
                delayIndex: 0,
                etag: '',
                error: '',
            };
            records.set(record.id, record);
            save();
            render();
            schedule(0);
        },
    };
})();
`
