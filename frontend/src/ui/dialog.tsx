// 应用内确认框 / 提示框，替代 window.confirm / window.alert：
// 桌面版的 WebView（macOS WKWebView、Windows WebView2）对原生对话框的支持不一致，可能直接不弹。
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from './index';

type Opts = { title?: string; confirmText?: string; cancelText?: string; danger?: boolean };

function Dialog({ message, opts, alertOnly, onClose }: { message: string; opts: Opts; alertOnly: boolean; onClose: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="dz-dialog__scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }}>
      <div className="dz-dialog" role={alertOnly ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dz-dialog-title">
        <h2 id="dz-dialog-title" className="dz-dialog__title">{opts.title ?? (alertOnly ? '提示' : '确认一下')}</h2>
        <p className="dz-dialog__msg">{message}</p>
        <div className="dz-dialog__actions">
          {!alertOnly && <Button variant="ghost" onClick={() => onClose(false)}>{opts.cancelText ?? '取消'}</Button>}
          <Button ref={okRef} variant={opts.danger ? 'danger' : 'primary'} onClick={() => onClose(true)}>
            {opts.confirmText ?? (alertOnly ? '知道了' : '确定')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function open(message: string, opts: Opts, alertOnly: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const prev = document.activeElement as HTMLElement | null;
    const close = (ok: boolean) => {
      root.unmount();
      host.remove();
      prev?.focus?.();
      resolve(ok);
    };
    root.render(<Dialog message={message} opts={opts} alertOnly={alertOnly} onClose={close} />);
  });
}

export const confirmDialog = (message: string, opts: Opts = {}) => open(message, opts, false);
export const alertDialog = (message: string, opts: Opts = {}) => open(message, opts, true).then(() => undefined);
