import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import { SiteNav } from '@/components/vibe-design/shell'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import { authClient, clearResetSession, useSignedIn } from '@/lib/auth-client'

// Sign in / sign up / password reset (Better Auth). Every auth email and OAuth
// round-trip lands back here: `?token=` opens the new-password form (reset
// link), `?error=` explains a failed link or Google sign-in. Verification links
// sign the user in and land here too, which forwards to /app.
type AuthSearch = { token?: string; error?: string }

export const Route = createFileRoute('/auth')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: AuthPage,
})

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'sent'

const ERRORS: Record<string, string> = {
  account_not_linked:
    'That email already has an unverified password account. Verify it from your inbox (signing in re-sends the link), then use Google.',
  token_expired: 'That link has expired — request a new one.',
  invalid_token:
    'That link is invalid, has already been used, or has expired — request a new one.',
  access_denied: 'Google sign-in was cancelled.',
}

const errorText = (code: string) =>
  ERRORS[code.toLowerCase()] ?? 'Sign-in failed. Please try again.'

function AuthPage() {
  const frame = useVibeFrame('/auth')
  const navigate = useNavigate()
  const search = Route.useSearch()
  const signedIn = useSignedIn()

  const [mode, setMode] = React.useState<Mode>(
    search.token ? 'reset' : 'sign-in',
  )
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(
    search.error ? errorText(search.error) : null,
  )
  const [sentMessage, setSentMessage] = React.useState('')
  const [resetDone, setResetDone] = React.useState(false)

  // Signed in (sign-in success, verification link, existing session) → /app.
  // The session store refreshes after sign-in, so this is the one redirect.
  // A reset link must still work for a signed-in visitor.
  React.useEffect(() => {
    if (signedIn && mode !== 'reset' && !resetDone)
      void navigate({ to: '/app', replace: true })
  }, [signedIn, mode, resetDone, navigate])

  const go = (next: Mode) => {
    setMode(next)
    setError(null)
    setPassword('')
  }

  const sent = (message: string) => {
    setSentMessage(message)
    go('sent')
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (mode === 'sign-in') {
        // callbackURL is where the re-sent verification link lands (unverified case).
        const { error } = await authClient.signIn.email({
          email,
          password,
          callbackURL: '/auth',
        })
        if (error?.code === 'EMAIL_NOT_VERIFIED') {
          sent(
            `Verify your email first — a fresh link is on its way to ${email}. If it doesn't arrive, try signing in again to resend it.`,
          )
        } else if (error) {
          setError(error.message ?? 'Could not sign in.')
        } else {
          setResetDone(false)
        }
      } else if (mode === 'sign-up') {
        if (!name.trim()) {
          setError('Enter your name.')
          return
        }
        const { error } = await authClient.signUp.email({
          name: name.trim(),
          email,
          password,
          callbackURL: '/auth',
        })
        if (error) setError(error.message ?? 'Could not create the account.')
        else
          sent(
            `A verification link is on its way to ${email}. Open it to finish signing up. If it doesn't arrive, sign in to request a fresh link.`,
          )
      } else if (mode === 'forgot') {
        const { error } = await authClient.requestPasswordReset({
          email,
          redirectTo: '/auth',
        })
        if (error) setError(error.message ?? 'Could not send the reset link.')
        else
          sent(
            `If ${email} has an account, a password-reset link is on its way.`,
          )
      } else if (mode === 'reset') {
        const { error } = await authClient.resetPassword({
          newPassword: password,
          token: search.token ?? '',
        })
        if (error) {
          setError(error.message ?? 'Could not reset the password.')
        } else {
          // Reset revokes every session; drop the spent token from the URL.
          await clearResetSession()
          setResetDone(true)
          go('sign-in')
          void navigate({ to: '/auth', search: {}, replace: true })
        }
      }
    })
  }

  const google = () =>
    run(async () => {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/app',
        errorCallbackURL: '/auth',
      })
      if (error)
        setError(
          error.code === 'PROVIDER_NOT_FOUND'
            ? 'Google sign-in is not configured. Use email and password.'
            : (error.message ?? 'Google sign-in is unavailable.'),
        )
    })

  const title = {
    'sign-in': 'Sign in',
    'sign-up': 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    sent: 'Check your inbox',
  }[mode]

  return (
    <div className="site">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/auth"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
      />

      <main className="site-main auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title" className="auth-card__title">
            {title}
          </h1>

          {resetDone && mode === 'sign-in' && (
            <p className="auth-note" role="status">
              Password updated — sign in with your new password.
            </p>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {mode === 'sent' ? (
            <>
              <p className="auth-card__sub">{sentMessage}</p>
              <button
                type="button"
                className="vt-btn vt-btn--ghost vt-btn--block"
                onClick={() => go('sign-in')}
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              {(mode === 'sign-in' || mode === 'sign-up') && (
                <>
                  <button
                    type="button"
                    className="vt-btn vt-btn--ghost vt-btn--block"
                    onClick={() => void google()}
                    disabled={busy}
                  >
                    <GoogleMark /> Continue with Google
                  </button>
                  <div className="auth-divider">
                    <span>or</span>
                  </div>
                </>
              )}

              <form className="auth-form" onSubmit={onSubmit}>
                {mode === 'sign-up' && (
                  <label className="auth-field">
                    <span>Name</span>
                    <input
                      className="cust__input"
                      autoComplete="name"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                {mode !== 'reset' && (
                  <label className="auth-field">
                    <span>Email</span>
                    <input
                      className="cust__input"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                )}
                {mode !== 'forgot' && (
                  <div className="auth-field">
                    <span className="auth-field__row">
                      <label htmlFor="auth-password">
                        {mode === 'reset' ? 'New password' : 'Password'}
                      </label>
                      {mode === 'sign-in' && (
                        <button
                          type="button"
                          className="auth-link"
                          onClick={() => go('forgot')}
                        >
                          Forgot password?
                        </button>
                      )}
                    </span>
                    <input
                      className="cust__input"
                      id="auth-password"
                      type="password"
                      autoComplete={
                        mode === 'sign-in' ? 'current-password' : 'new-password'
                      }
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                )}
                <button
                  type="submit"
                  className="vt-btn vt-btn--primary vt-btn--block"
                  disabled={busy}
                >
                  {busy && <Icon name="loader" className="vt-spin" />}
                  {
                    {
                      'sign-in': 'Sign in',
                      'sign-up': 'Create account',
                      forgot: 'Send reset link',
                      reset: 'Update password',
                    }[mode]
                  }
                </button>
              </form>

              <p className="auth-switch">
                {mode === 'sign-in' ? (
                  <>
                    New here?{' '}
                    <button
                      type="button"
                      className="auth-link"
                      onClick={() => go('sign-up')}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    {mode === 'sign-up' ? 'Already have an account? ' : ''}
                    <button
                      type="button"
                      className="auth-link"
                      onClick={() => go('sign-in')}
                    >
                      {mode === 'sign-up' ? 'Sign in' : 'Back to sign in'}
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  )
}
