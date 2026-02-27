import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          className="error-boundary-fallback"
          style={{
            padding: '2rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: 'var(--color-text, #333)',
            maxWidth: '480px',
            margin: '2rem auto',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>發生錯誤</h2>
          <p style={{ marginBottom: '1rem', color: 'var(--color-text-secondary, #666)' }}>
            頁面載入時發生問題，請重新整理後再試。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-card, #fff)',
              cursor: 'pointer',
            }}
          >
            重新整理
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
