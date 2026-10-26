import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

const buttonVariants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300 dark:disabled:bg-brand-900 shadow-sm shadow-brand-600/20',
  secondary:
    'bg-ink-900 text-white hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-200 disabled:opacity-50',
  ghost:
    'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50',
  outline:
    'border border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800',
};

const buttonSizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:cursor-not-allowed',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'brand' | 'emerald' | 'amber' | 'rose' | 'sky';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{value}</p>
          {hint && <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
        </div>
        {icon && <div className={cn('rounded-xl p-2.5', tones[tone])}>{icon}</div>}
      </div>
    </Card>
  );
}

export function ProgressBar({
  value,
  className,
  showLabel,
}: {
  value: number;
  className?: string;
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && <span className="w-10 text-right text-xs font-semibold text-ink-600 dark:text-ink-300">{Math.round(clamped)}%</span>}
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet';
  className?: string;
}) {
  const tones = {
    neutral: 'border-ink-200 bg-ink-50 text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300',
    brand: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300',
    emerald:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return src ? (
    <img
      src={src}
      alt={name}
      style={{ width: size, height: size }}
      className="rounded-full border border-ink-200 object-cover dark:border-ink-700"
    />
  ) : (
    <div
      style={{ width: size, height: size, fontSize: Math.max(11, size / 2.8) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 font-bold text-white"
      aria-hidden
    >
      {initials}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 shadow-2xl dark:border-ink-800 dark:bg-ink-900',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500 dark:text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}…
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 px-6 py-12 text-center dark:border-ink-800">
      {icon && <div className="mb-3 rounded-xl bg-ink-100 p-3 text-ink-400 dark:bg-ink-800 dark:text-ink-500">{icon}</div>}
      <p className="font-semibold text-ink-800 dark:text-ink-100">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input min-h-24 resize-y', props.className)} />;
}

export function Select({
  options,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...rest} className={cn('input appearance-none', className)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 rounded-xl bg-ink-100/80 p-1 dark:bg-ink-900/80', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
            active === tab.id
              ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
              : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200',
          )}
        >
          {tab.label}
          {typeof tab.count === 'number' && (
            <span className="ml-1.5 rounded-full bg-ink-200 px-1.5 text-[10px] dark:bg-ink-700">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/* ------------------------- Rich text renderer ------------------------- */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\d+\])/g;
  const pieces = text.split(pattern).filter((piece) => piece !== '');
  return pieces.map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.startsWith('**') && piece.endsWith('**')) return <strong key={key}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith('*') && piece.endsWith('*')) return <em key={key}>{piece.slice(1, -1)}</em>;
    if (piece.startsWith('`') && piece.endsWith('`'))
      return (
        <code key={key} className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-ink-800">
          {piece.slice(1, -1)}
        </code>
      );
    if (/^\[\d+\]$/.test(piece)) {
      return (
        <span key={key} className="citation">
          {piece.slice(1, -1)}
        </span>
      );
    }
    return <span key={key}>{piece}</span>;
  });
}

export function RichText({ content, className }: { content: string; className?: string }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = () => {
    if (!bulletBuffer.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {bulletBuffer.map((item, index) => (
          <li key={index}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      return;
    }
    if (/^[-•]\s+/.test(trimmed)) {
      bulletBuffer.push(trimmed.replace(/^[-•]\s+/, ''));
      return;
    }
    flushBullets();
    if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length < 70) {
      blocks.push(
        <p key={`h-${index}`} className="mt-3 first:mt-0">
          <strong>{trimmed.slice(2, -2)}</strong>
        </p>,
      );
      return;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(trimmed, `p-${index}`)}</p>);
  });
  flushBullets();

  return <div className={cn('rich-text', className)}>{blocks}</div>;
}
