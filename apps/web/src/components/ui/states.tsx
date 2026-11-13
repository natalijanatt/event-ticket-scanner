import { AlertTriangle, WifiOff, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { ApiError, errorMessage, NetworkError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './controls';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Renders without its own border, for use inside an existing frame. */
  bare?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, className, bare }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center px-6 py-14 text-center',
        !bare && 'rounded-lg border border-dashed border-line-strong bg-surface/60',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-md border border-line bg-surface text-ink-muted">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const offline = error instanceof NetworkError;
  const notFound = error instanceof ApiError && error.status === 404;
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className={cn('flex flex-col items-center rounded-lg border border-line bg-surface px-6 py-12 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-md border border-danger/25 bg-danger-soft text-danger">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="mt-4 text-base font-semibold">{offline ? 'Nema veze sa serverom' : notFound ? 'Nije pronađeno' : 'Podaci nisu učitani'}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{errorMessage(error)}</p>
      {onRetry && !notFound && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Pokušaj ponovo
        </Button>
      )}
    </div>
  );
}

/** Placeholder rows shown while a table loads. */
export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)} aria-busy="true" aria-label="Učitavanje">
      <div className="h-10 border-b border-line bg-subtle/60" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="hidden h-4 w-48 sm:block" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Titled content block with a hairline border – the only "card" in the system. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A single headline number with its label. */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'success' | 'danger';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className={cn('tabular mt-1 text-[28px] font-bold leading-none tracking-tight', tone === 'success' && 'text-success', tone === 'danger' && 'text-danger')}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

/** Row of stats separated by hairlines instead of individual boxes. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5', className)}>
      {React.Children.map(children, (child) => (child ? <div className="bg-surface px-5 py-4">{child}</div> : null))}
    </div>
  );
}
