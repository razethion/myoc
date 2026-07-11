import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import type {CurrentUser} from '../../lib/auth/session'

type AuthMode = 'login' | 'register'

type AuthPageProps = {
    mode: AuthMode
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
}

function AuthPageStyles() {
    return (
        <style>{`
            .auth-shell {
                background:
                    radial-gradient(circle at 18% 16%, rgba(0, 210, 255, 0.16), transparent 28rem),
                    radial-gradient(circle at 82% 8%, rgba(255, 0, 170, 0.15), transparent 24rem),
                    linear-gradient(135deg, rgba(255, 255, 255, 0.035), transparent 34%),
                    var(--color-base-100);
            }

            .auth-shell::before {
                content: "";
                position: absolute;
                inset: 0;
                pointer-events: none;
                background:
                    linear-gradient(var(--color-base-300) 1px, transparent 1px),
                    linear-gradient(90deg, var(--color-base-300) 1px, transparent 1px);
                background-size: 54px 54px;
                opacity: 0.34;
                mask-image: linear-gradient(to bottom, black, transparent 88%);
            }

            .auth-card {
                background:
                    linear-gradient(135deg, rgba(255, 255, 255, 0.07), transparent 36%),
                    linear-gradient(315deg, rgba(0, 210, 255, 0.055), transparent 44%),
                    rgba(255, 255, 255, 0.015);
                border: 1px solid rgba(165, 243, 252, 0.28);
                box-shadow:
                    0 32px 90px rgba(0, 0, 0, 0.38),
                    0 24px 80px rgba(0, 210, 255, 0.065),
                    inset 0 1px 0 rgba(255, 255, 255, 0.18);
                backdrop-filter: blur(10px) saturate(140%);
                -webkit-backdrop-filter: blur(10px) saturate(140%);
            }

            .register-panel {
                background:
                    linear-gradient(135deg, rgba(255, 0, 170, 0.10), transparent 36%),
                    linear-gradient(315deg, rgba(0, 210, 255, 0.11), transparent 44%),
                    rgba(255, 255, 255, 0.018);
                border: 1px solid rgba(255, 255, 255, 0.14);
            }
        `}</style>
    )
}

function AuthPageScript() {
    const script = `
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === '::1') {
            const localhostUrl = new URL(window.location.href);
            localhostUrl.hostname = 'localhost';
            window.location.replace(localhostUrl.toString());
        }

        const alerts = document.querySelectorAll('[data-auth-alert]');
        const passwordLoginForm = document.querySelector('[data-password-login-form]');
        const passkeyLoginForm = document.querySelector('[data-passkey-login-form]');
        const passkeyRegisterForm = document.querySelector('[data-passkey-register-form]');
        const passwordRegisterForm = document.querySelector('[data-password-register-form]');
        const showPasswordLoginButton = document.querySelector('[data-show-password-login]');
        const showRecoveryLoginButton = document.querySelector('[data-show-recovery-login]');
        const recoveryLoginForm = document.querySelector('[data-recovery-login-form]');
        const passwordRegisterPanel = document.querySelector('[data-password-register-panel]');
        const showPasswordRegisterButton = document.querySelector('[data-show-password-register]');
        const recoveryModal = document.querySelector('[data-recovery-modal]');
        const recoveryPhraseText = document.querySelector('[data-recovery-phrase]');
        const recoverySavedButton = document.querySelector('[data-recovery-saved-button]');
        const recoveryConfirmPanel = document.querySelector('[data-recovery-confirm-panel]');
        const recoveryConfirmInput = document.querySelector('[data-recovery-confirm-input]');
        const recoveryConfirmButton = document.querySelector('[data-recovery-confirm-button]');
        let recoveryCsrfToken = '';
        let passkeyLoginInFlight = false;

        function showAlert(form, message, isSuccess = false) {
            const alert = form.querySelector('[data-auth-alert]');
            alert.textContent = message;
            alert.classList.toggle('alert-error', !isSuccess);
            alert.classList.toggle('alert-success', isSuccess);
            alert.hidden = false;
        }

        function clearAlerts() {
            for (const alert of alerts) {
                alert.hidden = true;
                alert.textContent = '';
            }
        }

        async function postJson(url, body, csrfToken = '') {
            const headers = {
                'content-type': 'application/json',
            };

            if (csrfToken) {
                headers['x-csrf-token'] = csrfToken;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            const responseBody = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(responseBody.error || 'Something went wrong.');
            }

            return responseBody;
        }

        function openRecoveryModal(phrase, csrfToken) {
            recoveryCsrfToken = csrfToken || '';

            if (!recoveryModal || !recoveryPhraseText) {
                window.location.href = '/';
                return;
            }

            recoveryPhraseText.textContent = phrase;
            recoveryConfirmPanel.hidden = true;
            recoveryConfirmInput.value = '';
            recoveryModal.showModal();
        }

        async function submitJson(form, url, body) {
            const button = form.querySelector('button[type="submit"]');
            const originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = 'Working...';
            clearAlerts();

            try {
                await postJson(url, body);
                showAlert(form, 'Success. Redirecting...', true);
                window.location.href = '/';
            } catch (error) {
                showAlert(form, error instanceof Error ? error.message : 'Could not reach the server. Try again.');
            } finally {
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }

        async function beginPasskeyLogin(form, username, showErrors = true) {
            if (passkeyLoginInFlight) {
                return;
            }

            passkeyLoginInFlight = true;
            const button = form.querySelector('button[type="submit"]');
            const originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = 'Checking...';
            clearAlerts();

            try {
                if (!window.SimpleWebAuthnBrowser?.startAuthentication) {
                    throw new Error('Passkeys could not load. Refresh and try again.');
                }

                const optionsBody = await postJson('/api/login/passkey/options', {
                    username,
                });
                const credential = await window.SimpleWebAuthnBrowser.startAuthentication({
                    optionsJSON: optionsBody.options,
                });
                await postJson('/api/login/passkey/verify', {
                    challengeId: optionsBody.challengeId,
                    credential,
                });
                showAlert(form, 'Success. Redirecting...', true);
                window.location.href = '/';
            } catch (error) {
                if (showErrors) {
                    showAlert(form, error instanceof Error ? error.message : 'Passkey login failed.');
                }
            } finally {
                passkeyLoginInFlight = false;
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }

        if (passkeyLoginForm) {
            passkeyLoginForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                await beginPasskeyLogin(form, data.get('username'), true);
            });

            requestAnimationFrame(() => {
                beginPasskeyLogin(passkeyLoginForm, '', false);
            });
        }

        if (passwordLoginForm) {
            passwordLoginForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);

                submitJson(form, '/api/login', {
                    username: data.get('username'),
                    password: data.get('password'),
                });
            });
        }

        if (passkeyRegisterForm) {
            passkeyRegisterForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const button = form.querySelector('button[type="submit"]');
                const originalLabel = button.textContent;
                button.disabled = true;
                button.textContent = 'Creating...';
                clearAlerts();

                try {
                    if (!window.SimpleWebAuthnBrowser?.startRegistration) {
                        throw new Error('Passkeys could not load. Refresh and try again.');
                    }

                    const data = new FormData(form);
                    const optionsBody = await postJson('/api/register/passkey/options', {
                        email: data.get('email'),
                        username: data.get('username'),
                    });
                    const credential = await window.SimpleWebAuthnBrowser.startRegistration({
                        optionsJSON: optionsBody.options,
                    });
                    const responseBody = await postJson('/api/register/passkey/verify', {
                        challengeId: optionsBody.challengeId,
                        credential,
                        name: 'Primary passkey',
                    });
                    showAlert(form, 'Passkey created.', true);
                    openRecoveryModal(responseBody.recoveryPhrase, responseBody.csrfToken);
                } catch (error) {
                    showAlert(form, error instanceof Error ? error.message : 'Passkey account could not be created.');
                } finally {
                    button.disabled = false;
                    button.textContent = originalLabel;
                }
            });
        }

        if (passwordRegisterForm) {
            passwordRegisterForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);

                submitJson(form, '/api/users', {
                    email: data.get('email'),
                    username: data.get('username'),
                    password: data.get('password'),
                });
            });
        }

        if (showPasswordLoginButton && passwordLoginForm) {
            showPasswordLoginButton.addEventListener('click', () => {
                passwordLoginForm.hidden = false;
                showPasswordLoginButton.hidden = true;
            });
        }

        if (showRecoveryLoginButton && recoveryLoginForm) {
            showRecoveryLoginButton.addEventListener('click', () => {
                recoveryLoginForm.hidden = false;
                showRecoveryLoginButton.hidden = true;
            });
        }

        if (recoveryLoginForm) {
            recoveryLoginForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                const button = form.querySelector('button[type="submit"]');
                const originalLabel = button.textContent;
                button.disabled = true;
                button.textContent = 'Recovering...';
                clearAlerts();

                try {
                    await postJson('/api/recovery/login', {
                        username: data.get('username'),
                        recoveryPhrase: data.get('recoveryPhrase'),
                    });
                    showAlert(form, 'Success. Redirecting...', true);
                    window.location.href = '/settings';
                } catch (error) {
                    showAlert(form, error instanceof Error ? error.message : 'Recovery failed.');
                } finally {
                    button.disabled = false;
                    button.textContent = originalLabel;
                }
            });
        }

        if (showPasswordRegisterButton && passwordRegisterPanel) {
            showPasswordRegisterButton.addEventListener('click', () => {
                passwordRegisterPanel.hidden = false;
                showPasswordRegisterButton.hidden = true;
            });
        }

        if (recoverySavedButton) {
            recoverySavedButton.addEventListener('click', () => {
                recoveryConfirmPanel.hidden = false;
                recoveryConfirmInput.focus();
            });
        }

        if (recoveryConfirmButton) {
            recoveryConfirmButton.addEventListener('click', async () => {
                recoveryConfirmButton.disabled = true;
                const originalLabel = recoveryConfirmButton.textContent;
                recoveryConfirmButton.textContent = 'Confirming...';

                try {
                    await postJson('/api/security/recovery/confirm', {
                        recoveryPhrase: recoveryConfirmInput.value,
                    }, recoveryCsrfToken);
                    await postJson('/api/security/complete', {}, recoveryCsrfToken);
                    window.location.href = '/';
                } catch (error) {
                    alert(error instanceof Error ? error.message : 'Recovery phrase could not be confirmed.');
                } finally {
                    recoveryConfirmButton.disabled = false;
                    recoveryConfirmButton.textContent = originalLabel;
                }
            });
        }
    `

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function AuthPage({mode, currentUser, guestInitial, mediaBaseUrl}: AuthPageProps) {
    const isLogin = mode === 'login'

    return (
        <BaseLayout head={<AuthPageStyles />} title={`${mode === 'login' ? 'Login' : 'Create account'} | MyOC`}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />

            <main
                class={`auth-shell relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden px-4 py-12 sm:px-6 lg:px-8 ${isLogin ? '' : 'lg:py-16'}`}
            >
                {isLogin ? (
                    <div class="relative z-10 mx-auto w-full max-w-md">
                        <section class="auth-card rounded-3xl p-6 sm:p-8">
                            <form action="/api/login/passkey/options" class="flex flex-col gap-6" data-passkey-login-form method="post">
                                <div class="text-center">
                                    <span class="badge badge-primary badge-lg">Login</span>
                                    <h1 class="mt-5 text-4xl font-black leading-none sm:text-5xl">Welcome back.</h1>
                                    <p class="mt-3 opacity-70">Sign in with a passkey.</p>
                                </div>

                                <div class="alert alert-error" data-auth-alert hidden></div>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Username</span>
                                    </div>
                                    <input
                                        autocomplete="username webauthn"
                                        class="input input-bordered w-full"
                                        name="username"
                                        type="text"
                                    />
                                </label>

                                <button class="btn btn-primary btn-block" type="submit">
                                    Continue with Passkey
                                </button>

                                <div class="flex flex-wrap justify-center gap-3 text-sm">
                                    <button class="link link-primary font-semibold" data-show-password-login type="button">
                                        Use password
                                    </button>
                                    <button class="link link-primary font-semibold" data-show-recovery-login type="button">
                                        Use recovery phrase
                                    </button>
                                </div>

                                <p class="text-center text-sm opacity-75">
                                    New to MyOC?{' '}
                                    <a class="link link-primary font-semibold" href="/register">
                                        Create an account
                                    </a>
                                </p>
                            </form>

                            <form
                                action="/api/login"
                                class="mt-6 flex flex-col gap-4 border-t border-base-300 pt-6"
                                data-password-login-form
                                hidden
                                method="post"
                            >
                                <div class="alert alert-error" data-auth-alert hidden></div>
                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Username</span>
                                    </div>
                                    <input
                                        autocomplete="username"
                                        class="input input-bordered w-full"
                                        name="username"
                                        required
                                        type="text"
                                    />
                                </label>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Password</span>
                                    </div>
                                    <input
                                        autocomplete="current-password"
                                        class="input input-bordered w-full"
                                        name="password"
                                        required
                                        type="password"
                                    />
                                </label>

                                <button class="btn btn-secondary btn-block" type="submit">
                                    Login with Password
                                </button>
                            </form>

                            <form
                                action="/api/recovery/login"
                                class="mt-6 flex flex-col gap-4 border-t border-base-300 pt-6"
                                data-recovery-login-form
                                hidden
                                method="post"
                            >
                                <div class="alert alert-error" data-auth-alert hidden></div>
                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Username</span>
                                    </div>
                                    <input
                                        autocomplete="username"
                                        class="input input-bordered w-full"
                                        name="username"
                                        required
                                        type="text"
                                    />
                                </label>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Recovery phrase</span>
                                    </div>
                                    <input
                                        autocomplete="off"
                                        class="input input-bordered w-full"
                                        name="recoveryPhrase"
                                        required
                                        type="text"
                                    />
                                </label>

                                <button class="btn btn-secondary btn-block" type="submit">
                                    Recover Account
                                </button>
                            </form>
                        </section>
                    </div>
                ) : (
                    <div class="relative z-10 mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                        <aside class="register-panel rounded-3xl p-6 sm:p-8">
                            <span class="badge badge-secondary badge-lg">Create account</span>
                            <h1 class="mt-5 text-4xl font-black leading-none sm:text-5xl">Build a home for your characters.</h1>
                            <p class="mt-4 leading-7 opacity-75">
                                Keep references, commissions, variants, and folders together in a gallery built around original-quality
                                character art.
                            </p>

                            <div class="mt-8 space-y-4">
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Organize character media</p>
                                    <p class="mt-1 text-sm opacity-70">
                                        Group artwork, references, outfits, and detail shots around each character.
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Preserve image quality</p>
                                    <p class="mt-1 text-sm opacity-70">
                                        Upload and view art without flattening it into low-quality previews.
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Share clean galleries</p>
                                    <p class="mt-1 text-sm opacity-70">
                                        Create focused character pages that are easy to browse and send to others.
                                    </p>
                                </div>
                            </div>
                        </aside>

                        <section class="auth-card rounded-3xl p-6 sm:p-8">
                            <form
                                action="/api/register/passkey/options"
                                class="flex flex-col gap-6"
                                data-passkey-register-form
                                method="post"
                            >
                                <div>
                                    <h2 class="text-3xl font-black">Account details</h2>
                                    <p class="mt-2 opacity-70">Create a passkey account without setting a password.</p>
                                </div>

                                <div class="alert alert-error" data-auth-alert hidden></div>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Email</span>
                                    </div>
                                    <input autocomplete="email" class="input input-bordered w-full" name="email" required type="email" />
                                </label>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Username</span>
                                        <span class="label-text-alt">3-32 letters, numbers, or underscores</span>
                                    </div>
                                    <input
                                        autocomplete="username"
                                        class="input input-bordered w-full"
                                        maxLength={32}
                                        minLength={3}
                                        name="username"
                                        pattern="[A-Za-z0-9_]+"
                                        required
                                        title="Use 3-32 letters, numbers, or underscores."
                                        type="text"
                                    />
                                </label>

                                <button class="btn btn-primary btn-block" type="submit">
                                    Create Account with Passkey
                                </button>

                                <button class="btn btn-ghost btn-block" data-show-password-register type="button">
                                    Use Password Instead
                                </button>

                                <p class="text-center text-sm opacity-75">
                                    Already have an account?{' '}
                                    <a class="link link-primary font-semibold" href="/login">
                                        Login
                                    </a>
                                </p>
                            </form>

                            <div class="mt-6 border-t border-base-300 pt-6" data-password-register-panel hidden>
                                <form action="/api/users" class="flex flex-col gap-6" data-password-register-form method="post">
                                    <div class="alert alert-error" data-auth-alert hidden></div>

                                    <label class="form-control w-full">
                                        <div class="label">
                                            <span class="label-text">Email</span>
                                        </div>
                                        <input
                                            autocomplete="email"
                                            class="input input-bordered w-full"
                                            name="email"
                                            required
                                            type="email"
                                        />
                                    </label>

                                    <label class="form-control w-full">
                                        <div class="label">
                                            <span class="label-text">Username</span>
                                            <span class="label-text-alt">3-32 letters, numbers, or underscores</span>
                                        </div>
                                        <input
                                            autocomplete="username"
                                            class="input input-bordered w-full"
                                            maxLength={32}
                                            minLength={3}
                                            name="username"
                                            pattern="[A-Za-z0-9_]+"
                                            required
                                            title="Use 3-32 letters, numbers, or underscores."
                                            type="text"
                                        />
                                    </label>

                                    <label class="form-control w-full">
                                        <div class="label">
                                            <span class="label-text">Password</span>
                                            <span class="label-text-alt">8+ characters</span>
                                        </div>
                                        <input
                                            autocomplete="new-password"
                                            class="input input-bordered w-full"
                                            minLength={8}
                                            name="password"
                                            required
                                            type="password"
                                        />
                                    </label>

                                    <button class="btn btn-secondary btn-block" type="submit">
                                        Create Account with Password
                                    </button>
                                </form>
                            </div>
                        </section>
                    </div>
                )}
            </main>

            <dialog class="modal" data-recovery-modal>
                <div class="modal-box">
                    <h3 class="text-xl font-bold">Recovery Phrase</h3>
                    <p class="mt-2 text-sm text-base-content/70">Save this phrase before continuing.</p>
                    <div class="mt-4 rounded-box border border-base-300 bg-base-200 p-4">
                        <code class="block break-words text-lg font-bold" data-recovery-phrase></code>
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-primary" data-recovery-saved-button type="button">
                            Saved
                        </button>
                    </div>

                    <div class="mt-4" data-recovery-confirm-panel hidden>
                        <label class="form-control w-full">
                            <div class="label">
                                <span class="label-text">Enter recovery phrase</span>
                            </div>
                            <input autocomplete="off" class="input input-bordered w-full" data-recovery-confirm-input type="text" />
                        </label>
                        <div class="mt-3 flex justify-end">
                            <button class="btn btn-primary" data-recovery-confirm-button type="button">
                                Confirm Phrase
                            </button>
                        </div>
                    </div>
                </div>
            </dialog>

            <script src="/vendor/simplewebauthn/index.umd.min.js"></script>
            <AuthPageScript />
        </BaseLayout>
    )
}
