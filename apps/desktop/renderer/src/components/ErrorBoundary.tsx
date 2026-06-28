import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: 48, textAlign: 'center', color: 'rgba(15,23,42,0.62)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>页面模块加载失败</h3>
          <p style={{ fontSize: 13 }}>
            {this.state.error?.message || '渲染异常'}
          </p>
          <button
            className="glass-btn-secondary"
            onClick={() => { this.setState({ hasError: false, error: null }); }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
