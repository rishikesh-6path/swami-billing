import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { useHotkeys } from '../lib/hotkeys.tsx';

export function Button({
  variant = 'secondary',
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button type="button" {...props} className={`btn btn-${variant} ${props.className ?? ''}`} />
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
}

/** A labelled text box. Errors and hints are linked for screen readers and sit right under the box. */
export function TextField({
  label,
  hint,
  error,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-note`}
        {...input}
      />
      <div id={`${id}-note`} className="field-note">
        {error ?? hint ?? ''}
      </div>
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...select
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-describedby={`${id}-note`} {...select}>
        {children}
      </select>
      <div id={`${id}-note`} className="field-note">
        {error ?? hint ?? ''}
      </div>
    </div>
  );
}

export function Notice({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  actions,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </header>
  );
}

/** Shows an error message when loading fails, a spinner-less "loading" line while waiting. */
export function LoadState({
  state,
  children,
}: {
  state: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };
  children: ReactNode;
}) {
  if (state.status === 'loading') return <p className="muted">Loading...</p>;
  if (state.status === 'error') return <Notice>{state.message}</Notice>;
  return <>{children}</>;
}

/** Modal question. Enter confirms, Esc cancels; focus starts on the confirm button. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  useHotkeys({ Escape: onCancel, Y: onConfirm, N: onCancel });
  return (
    <div className="overlay">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InfoDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useHotkeys({ Escape: onClose, Enter: onClose });
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <Button ref={closeRef} variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ToastApi {
  show: (message: string, kind?: 'success' | 'error') => void;
}
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const api: ToastApi = { show: (message, kind = 'success') => setToast({ message, kind }) };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('ToastProvider is missing');
  return api;
}
