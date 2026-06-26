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
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: '12px', color: '#b9bbbe'
        }}>
          <span style={{ fontSize: '2rem' }}>⚠</span>
          <p style={{ margin: 0 }}>Une erreur est survenue.</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '6px 16px', borderRadius: '4px',
              background: '#5865f2', color: '#fff', border: 'none', cursor: 'pointer'
            }}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
