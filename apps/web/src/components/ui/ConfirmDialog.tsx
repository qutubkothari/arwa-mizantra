'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

type Variant = 'danger' | 'warning' | 'info';

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  disableDismiss?: boolean;
}

interface ConfirmState extends ConfirmDialogOptions {
  resolve: (value: boolean) => void;
}

let openConfirmFn: ((opts: ConfirmDialogOptions) => Promise<boolean>) | null = null;

/** Imperative confirm — drop-in replacement for window.confirm() */
export async function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  if (!openConfirmFn) {
    // Fallback if component not mounted
    return window.confirm(opts.message);
  }
  return openConfirmFn(opts);
}

/** Mount once in the layout — provides the confirm dialog globally */
export function ConfirmDialogProvider() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  useEffect(() => {
    openConfirmFn = (opts) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setState({ ...opts, resolve });
      });
    return () => {
      openConfirmFn = null;
    };
  }, []);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) return;
      if (e.key === 'Escape' && !state.disableDismiss) close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  if (!state) return null;

  const variantStyles: Record<Variant, { icon: React.ReactNode; btn: string }> = {
    danger: {
      icon: <Trash2 className="h-6 w-6 text-red-600" aria-hidden />,
      btn: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
    warning: {
      icon: <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden />,
      btn: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    },
    info: {
      icon: <AlertTriangle className="h-6 w-6 text-blue-500" aria-hidden />,
      btn: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    },
  };

  const v = variantStyles[state.variant ?? 'danger'];

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !state.disableDismiss && close(false)}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-xl bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 transition-all duration-150 scale-100">
        {!state.disableDismiss && (
          <button
            onClick={() => close(false)}
            className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
            {v.icon}
          </div>
          <div className="flex-1 pt-0.5">
            <h3 id="confirm-title" className="text-lg font-semibold text-gray-900 leading-tight">
              {state.title}
            </h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-gray-600">{state.message}</p>
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => close(false)}
            autoFocus
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
          >
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${v.btn}`}
          >
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
