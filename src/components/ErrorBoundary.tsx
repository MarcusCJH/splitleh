import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  private reset = () => {
    this.setState({ error: null })
    window.location.hash = '/'
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isMemory =
      error.message.toLowerCase().includes('memory') ||
      error.message.toLowerCase().includes('context') ||
      error.message.toLowerCase().includes('canvas')

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100dvh',
        padding: '2rem', textAlign: 'center', gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--color-bg, #fff)',
        color: 'var(--color-text, #111)',
      }}>
        <span style={{ fontSize: '2.5rem' }}>⚠️</span>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Something went wrong</h2>
        <p style={{ margin: 0, maxWidth: '28rem', lineHeight: 1.5, opacity: 0.75 }}>
          {isMemory
            ? 'The device ran out of memory while processing the receipt. Try a smaller photo, or close other apps and try again.'
            : 'An unexpected error occurred. Returning home should fix it.'}
        </p>
        <button className="btn btn-primary" onClick={this.reset}>
          Go Home
        </button>
        <details style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.5, textAlign: 'left', maxWidth: '28rem' }}>
          <summary style={{ cursor: 'pointer' }}>Error details</summary>
          <pre style={{ overflow: 'auto', marginTop: '0.5rem', padding: '0.5rem', background: '#f4f4f4', borderRadius: '4px' }}>
            {error.message}
          </pre>
        </details>
      </div>
    )
  }
}
