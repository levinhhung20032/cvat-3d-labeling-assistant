import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
      <div style={{ font: '13px system-ui', padding: 12, color: 'var(--cvla-c-bb0000, #b00)' }}>
        {stale
          ? 'Extension vừa được Reload hoặc cập nhật. Hãy tải lại tab CVAT (F5) rồi bấm lại biểu tượng extension.'
          : `Lỗi giao diện: ${this.state.error}`}
      </div>
    );
  }
}

/** Vẽ panel vào một phần tử (trang extension trong iframe, hoặc gốc Shadow DOM ở chế độ nhúng). */
export function mountPanel(container: HTMLElement): Root {
  const root = createRoot(container);
  root.render(
    <Boundary>
      <App />
    </Boundary>,
  );
  return root;
}
