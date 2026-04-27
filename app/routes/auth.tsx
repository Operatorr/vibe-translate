import { SignIn, useAuth } from '@clerk/react'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth')({
  component: AuthPage,
})

function AuthPage() {
  const { isSignedIn, isLoaded } = useAuth()

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-12">
      {!isLoaded ? (
        <p className="text-sm text-muted">Loading authentication...</p>
      ) : isSignedIn ? (
        <div className="rounded-lg border border-border bg-panel p-6">
          <h1 className="text-xl font-semibold">You are signed in.</h1>
          <Link className="button-primary mt-5 inline-flex" to={'/app' as never}>
            Continue
          </Link>
        </div>
      ) : (
        <SignIn routing="hash" signUpUrl="/auth#sign-up" />
      )}
    </main>
  )
}
