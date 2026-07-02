import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center min-h-screen w-full gap-4 bg-fc-bg text-fc-text px-6 text-center">
          <div className="text-5xl mb-2">⚠️</div>
          <h2 className="text-white text-xl font-semibold">Quelque chose a planté</h2>
          <p className="text-fc-muted text-sm max-w-md">
            Une erreur inattendue s'est produite. Vous pouvez essayer de réessayer ou recharger la page.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <pre className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3 max-w-lg overflow-auto text-left max-h-48">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-lg border border-fc-hover text-fc-muted hover:text-white hover:border-fc-text transition text-sm"
            >
              Réessayer
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-fc-accent hover:bg-indigo-500 text-white font-medium transition text-sm"
            >
              Recharger la page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
