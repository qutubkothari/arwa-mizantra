'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Icons or text badges (e.g. record count) */
  badge?: ReactNode;
  /** Primary action button or element */
  action?: ReactNode;
  /** Secondary actions (e.g. export, filter toggles) */
  secondaryAction?: ReactNode;
  className?: string;
}

/**
 * Standardised page-level header — replaces ad-hoc header divs across all 20+ pages.
 */
export function PageHeader({
  title,
  subtitle,
  badge,
  action,
  secondaryAction,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight truncate">{title}</h1>
          {badge && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>

      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {secondaryAction}
          {action}
        </div>
      )}
    </div>
  );
}

/** Reusable primary action button style */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm',
        'hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700',
        'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Reusable secondary action button style */
export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm',
        'hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400',
        'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Reusable danger button */
export function DangerButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm',
        'hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
        'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
        className,
      )}
    >
      {children}
    </button>
  );
}
