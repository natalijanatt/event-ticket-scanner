import { cn } from '@/lib/utils';

/** Product mark: a ticket stub with its tear notch, in the accent color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="hsl(var(--accent))" />
      <path
        d="M9 10.5A1.5 1.5 0 0 1 10.5 9h11A1.5 1.5 0 0 1 23 10.5v3.1a2.5 2.5 0 0 0 0 4.8v3.1a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 21.5v-3.1a2.5 2.5 0 0 0 0-4.8z"
        fill="hsl(var(--navy))"
      />
      <path d="M17.5 12v8" stroke="hsl(var(--accent))" strokeWidth="1.6" strokeDasharray="1.6 1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className={cn('text-[17px] font-bold tracking-tight', tone === 'light' ? 'text-navy-text' : 'text-ink')}>Propusnica</span>
    </span>
  );
}
