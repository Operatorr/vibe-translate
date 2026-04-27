import type { ErrorInfo, PropsWithChildren } from 'react'
import { Component } from 'react'

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary caught an error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-screen max-w-[42rem] flex-col justify-center px-6">
          <h1 className="text-2xl font-semibold">The interface crashed</h1>
          <p className="mt-3 text-sm text-muted">{this.state.error.message}</p>
        </main>
      )
    }

    return this.props.children
  }
}
