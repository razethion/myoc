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
        const alerts = document.querySelectorAll('[data-auth-alert]');
        const loginForm = document.querySelector('[data-login-form]');
        const registerForm = document.querySelector('[data-register-form]');

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

        async function submitJson(form, url, body) {
            const button = form.querySelector('button[type="submit"]');
            const originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = 'Working...';
            clearAlerts();

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({}));
                    showAlert(form, errorBody.error || 'Something went wrong.');
                    return;
                }

                showAlert(form, 'Success. Redirecting...', true);
                window.location.href = '/';
            } catch {
                showAlert(form, 'Could not reach the server. Try again.');
            } finally {
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }

        if (loginForm) {
            loginForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);

                submitJson(form, '/api/login', {
                    username: data.get('username'),
                    password: data.get('password'),
                });
            });
        }

        if (registerForm) {
            registerForm.addEventListener('submit', (event) => {
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
    `

    return (
        <script dangerouslySetInnerHTML={{__html: script}}></script>
    )
}

export function AuthPage({mode, currentUser, guestInitial, mediaBaseUrl}: AuthPageProps) {
    const isLogin = mode === 'login'

    return (
        <BaseLayout head={<AuthPageStyles />} title={`${mode === 'login' ? 'Login' : 'Create account'} | MyOC`}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>

            <main class={`auth-shell relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden px-4 py-12 sm:px-6 lg:px-8 ${isLogin ? '' : 'lg:py-16'}`}>
                {isLogin ? (
                    <div class="relative z-10 mx-auto w-full max-w-md">
                        <section class="auth-card rounded-3xl p-6 sm:p-8">
                            <form action="/api/login" class="flex flex-col gap-6" data-login-form method="post">
                                <div class="text-center">
                                    <span class="badge badge-primary badge-lg">Login</span>
                                    <h1 class="mt-5 text-4xl font-black leading-none sm:text-5xl">Welcome back.</h1>
                                    <p class="mt-3 opacity-70">Sign in with your MyOC username.</p>
                                </div>

                            <div class="alert alert-error" data-auth-alert hidden></div>

                            <label class="form-control w-full">
                                <div class="label">
                                    <span class="label-text">Username</span>
                                </div>
                                <input autocomplete="username" class="input input-bordered w-full" name="username" required type="text" />
                            </label>

                            <label class="form-control w-full">
                                <div class="label">
                                    <span class="label-text">Password</span>
                                </div>
                                <input autocomplete="current-password" class="input input-bordered w-full" name="password" required type="password" />
                            </label>

                            <button class="btn btn-primary btn-block" type="submit">Login</button>

                            <p class="text-center text-sm opacity-75">
                                New to MyOC? <a class="link link-primary font-semibold" href="/register">Create an account</a>
                            </p>
                            </form>
                        </section>
                    </div>
                ) : (
                    <div class="relative z-10 mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                        <aside class="register-panel rounded-3xl p-6 sm:p-8">
                            <span class="badge badge-secondary badge-lg">Create account</span>
                            <h1 class="mt-5 text-4xl font-black leading-none sm:text-5xl">Build a home for your characters.</h1>
                            <p class="mt-4 leading-7 opacity-75">
                                Keep references, commissions, variants, and folders together in a gallery built around original-quality character art.
                            </p>

                            <div class="mt-8 space-y-4">
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Organize character media</p>
                                    <p class="mt-1 text-sm opacity-70">Group artwork, references, outfits, and detail shots around each character.</p>
                                </div>
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Preserve image quality</p>
                                    <p class="mt-1 text-sm opacity-70">Upload and view art without flattening it into low-quality previews.</p>
                                </div>
                                <div class="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                                    <p class="font-bold">Share clean galleries</p>
                                    <p class="mt-1 text-sm opacity-70">Create focused character pages that are easy to browse and send to others.</p>
                                </div>
                            </div>
                        </aside>

                        <section class="auth-card rounded-3xl p-6 sm:p-8">
                            <form action="/api/users" class="flex flex-col gap-6" data-register-form method="post">
                                <div>
                                    <h2 class="text-3xl font-black">Account details</h2>
                                    <p class="mt-2 opacity-70">Choose these carefully. The username must be unique.</p>
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
                                    <input autocomplete="username" class="input input-bordered w-full" maxLength={32} minLength={3} name="username" pattern="[A-Za-z0-9_]+" required title="Use 3-32 letters, numbers, or underscores." type="text" />
                                </label>

                                <label class="form-control w-full">
                                    <div class="label">
                                        <span class="label-text">Password</span>
                                        <span class="label-text-alt">8+ characters</span>
                                    </div>
                                    <input autocomplete="new-password" class="input input-bordered w-full" minLength={8} name="password" required type="password" />
                                </label>

                                <button class="btn btn-primary btn-block" type="submit">Create account</button>

                                <p class="text-center text-sm opacity-75">
                                    Already have an account? <a class="link link-primary font-semibold" href="/login">Login</a>
                                </p>
                            </form>
                        </section>
                    </div>
                )}
            </main>

            <AuthPageScript />
        </BaseLayout>
    )
}
