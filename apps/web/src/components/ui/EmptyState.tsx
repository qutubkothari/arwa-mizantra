'use client';

import { ReactNode } from 'react';
import { Inbox, Search, AlertCircle, PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyVariant = 'empty' | 'search' | 'error' | 'items';

interface EmptyStateProps {
  variant?: EmptyVariant;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

const icons: Record<EmptyVariant, ReactNode> = {
  empty: <Inbox className="h-12 w-12 text-gray-300" strokeWidth={1.5} />,
  search: <Search className="h-12 w-12 text-gray-300" strokeWidth={1.5} />,
  error: <AlertCircle className="h-12 w-12 text-red-300" strokeWidth={1.5} />,
  items: <PackageSearch className="h-12 w-12 text-gray-300" strokeWidth={1.5} />,
};

/**
 * Standardised empty-state component for all list views and tables.
 * Replaces ad-hoc "No results" text and emoji placeholders.
 */
export function EmptyState({
  variant = 'empty',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-white p-4 shadow-sm border border-gray-100">
        {icons[variant]}
      </div>
      <h3 className="text-base font-semibold text-gray-700">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-gray-500 leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Inline empty state for table cells */
export function TableEmptyRow({
  colSpan,
  message = 'No results found',
}: {
  colSpan: number;
  message?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Inbox className="h-8 w-8 text-gray-300" strokeWidth={1.5} />
          <p className="text-sm text-gray-400">{message}</p>
        </div>
      </td>
    </tr>
  );
}
