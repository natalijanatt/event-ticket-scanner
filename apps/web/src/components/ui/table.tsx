import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Bordered, horizontally scrollable container for data tables. */
export function TableFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap border-b border-line bg-subtle/60 px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-ink-muted', className)}
      {...props}
    />
  );
}

export function Tr({ className, selected, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      className={cn('border-b border-line transition-colors last:border-b-0 hover:bg-subtle/50', selected && 'bg-accent-soft/50 hover:bg-accent-soft/60', className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Stranice" className={cn('flex items-center justify-between gap-3 text-sm text-ink-muted', className)}>
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} od {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft /> Prethodna
        </Button>
        <span className="tabular px-1">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Sledeća <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
