'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'approve' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ErpButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border-[#8B6F47] bg-[#8B6F47] text-white hover:border-[#6F4E37] hover:bg-[#6F4E37]',
  secondary: 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3] hover:text-[#4A3426]',
  approve: 'border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800',
  danger: 'border-red-300 bg-white text-red-700 hover:border-red-400 hover:bg-red-50',
  ghost: 'border-transparent bg-transparent text-[#7A6555] hover:bg-[#F5EFE3] hover:text-[#4A3426]',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
};

export const ErpButton = forwardRef<HTMLButtonElement, ErpButtonProps>(
  ({ className, variant = 'secondary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6F47] focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  ),
);

ErpButton.displayName = 'ErpButton';

interface ErpPageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function ErpPageHeader({ title, description, eyebrow, actions }: ErpPageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[#E8DCC4] pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-0.5 text-[11px] font-semibold uppercase text-[#8B6F47]">{eyebrow}</p>
        ) : null}
        <h1 className="text-xl font-bold text-[#4A3426] sm:text-2xl">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-xs text-[#7A6555] sm:text-sm">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

interface ErpMetricStripProps {
  metrics: Array<{
    label: string;
    value: string | number;
    tone?: 'neutral' | 'warning' | 'success' | 'danger';
  }>;
  loading?: boolean;
}

const metricToneClasses = {
  neutral: 'text-[#4A3426]',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
  danger: 'text-red-700',
};

export function ErpMetricStrip({ metrics, loading = false }: ErpMetricStripProps) {
  return (
    <dl className="flex min-h-11 flex-wrap items-stretch divide-x divide-[#E8DCC4] rounded-md border border-[#E8DCC4] bg-white">
      {metrics.map((metric) => (
        <div key={metric.label} className="flex min-w-[10rem] flex-1 items-center gap-3 px-3 py-2">
          <dt className="text-xs font-medium text-[#7A6555]">{metric.label}</dt>
          <dd className={`ml-auto text-lg font-bold tabular-nums ${metricToneClasses[metric.tone ?? 'neutral']}`}>
            {loading ? <span className="block h-5 w-8 animate-pulse rounded bg-[#E8DCC4]" /> : metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const statusToneClasses: Record<StatusTone, string> = {
  neutral: 'border-[#E8DCC4] bg-[#FAF9F6] text-[#6F4E37]',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
};

function getStatusTone(status: string): StatusTone {
  const normalized = status.trim().toUpperCase();

  if (['REJECTED', 'CANCELLED', 'FAILED', 'OVERDUE'].includes(normalized)) return 'danger';
  if (['DRAFT', 'PENDING', 'OPEN'].includes(normalized)) return 'neutral';
  if (['SUBMITTED', 'RFQ_ISSUED', 'RFQ_RCVD', 'PARTIAL', 'IN_PROGRESS'].includes(normalized)) return 'info';
  if (['ON_HOLD', 'AWAITING_APPROVAL'].includes(normalized)) return 'warning';
  if (['APPROVED', 'COMPLETED', 'PO_DONE', 'GOODS_RCVD', 'RECEIVED', 'DONE'].includes(normalized)) {
    return 'success';
  }

  return 'neutral';
}

interface ErpStatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
  label?: string;
  tone?: StatusTone;
}

export function ErpStatusBadge({
  status,
  label,
  tone,
  className,
  ...props
}: ErpStatusBadgeProps) {
  const resolvedTone = tone ?? getStatusTone(status);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
        statusToneClasses[resolvedTone],
        className,
      )}
      title={label ?? status}
      {...props}
    >
      <span className="truncate">{label ?? status}</span>
    </span>
  );
}
