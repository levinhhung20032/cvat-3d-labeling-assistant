import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = /context invalidated/i.test(this.state.error);
    return (
      <div style={{ font: '13px system-ui', padding: 12, color: '#b00' }}>
        {stale
          ? 'Extension vừa được Reload hoặc cập nhật. Hãy tải lại tab CVAT (F5) rồi bấm lại biểu tượng extension.'
          : `Lỗi giao diện: ${this.state.error}`}
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
