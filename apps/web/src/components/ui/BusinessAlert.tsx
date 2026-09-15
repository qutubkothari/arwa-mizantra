'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, XCircle } from 'lucide-react';

type BusinessAlertTone = 'success' | 'info' | 'warning' | 'danger' | 'access';

interface BusinessAlertState {
  id: number;
  title: string;
  message: string;
  tone: BusinessAlertTone;
  primaryLabel?: string;
}

let sequence = 1;

function stringifyMessage(message: unknown): string {
  if (message instanceof Error) return message.message;
  if (typeof message === 'string') return message;
  if (message === null || message === undefined) return '';
  try {
    return JSON.stringify(message, null, 2);
  } catch {
    return String(message);
  }
}

function cleanMessage(raw: string): string {
  return raw
    .replace(/^[✅✓❌✕⚠️\s]+/u, '')
    .replace(/^error:\s*/i, '')
    .replace(/^warning:\s*/i, '')
    .trim();
}

function normalizeBusinessAlert(message: unknown): BusinessAlertState {
  const raw = stringifyMessage(message).trim() || 'Action completed.';
  const clean = cleanMessage(raw) || raw;
  const lower = clean.toLowerCase();

  if (
    lower.includes('permission') ||
    lower.includes('access denied') ||
    lower.includes('not authorized') ||
    lower.includes('unauthorized') ||
    lower.includes('maker-checker')
  ) {
    return {
      id: sequence++,
      title: 'Access Notice',
      message: clean,
      tone: 'access',
    };
  }

  if (
    lower.includes('success') ||
    lower.includes('successfully') ||
    lower.startsWith('checked in') ||
    lower.startsWith('checked out') ||
    lower.includes('created') ||
    lower.includes('updated') ||
    lower.includes('approved') ||
    lower.includes('saved')
  ) {
    return {
      id: sequence++,
      title: 'Completed',
      message: clean,
      tone: 'success',
    };
  }

  if (
    lower.includes('required') ||
    lower.includes('please') ||
    lower.includes('select') ||
    lower.includes('warning') ||
    lower.includes('cannot') ||
    lower.includes('outside the office') ||
    lower.includes('not allowed') ||
    lower.includes('already exists')
  ) {
    return {
      id: sequence++,
      title: 'Action Required',
      message: clean,
      tone: 'warning',
    };
  }

  if (
    lower.includes('failed') ||
    lower.includes('error') ||
    lower.includes('invalid') ||
    lower.includes('server') ||
    lower.includes('exception')
  ) {
    return {
      id: sequence++,
      title: 'Unable to Complete',
      message: clean,
      tone: 'danger',
    };
  }

  return {
    id: sequence++,
    title: 'Information',
    message: clean,
    tone: 'info',
  };
}

export function BusinessAlertProvider() {
  const nativeAlert = useRef<typeof window.alert | null>(null);
  const [queue, setQueue] = useState<BusinessAlertState[]>([]);
  const active = queue[0] ?? null;

  useEffect(() => {
    nativeAlert.current = window.alert.bind(window);
    window.alert = (message?: unknown) => {
      setQueue((current) => [...current, normalizeBusinessAlert(message)]);
    };

    return () => {
      if (nativeAlert.current) window.alert = nativeAlert.current;
    };
  }, []);

  const close = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, close]);

  const tone = useMemo(() => {
    const styles: Record<
      BusinessAlertTone,
      {
        icon: ReactNode;
        chip: string;
        iconWrap: string;
        border: string;
        button: string;
        eyebrow: string;
      }
    > = {
      success: {
        icon: <CheckCircle2 className="h-7 w-7" />,
        chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        iconWrap: 'bg-emerald-50 text-emerald-700',
        border: 'border-emerald-200',
        button: 'bg-emerald-700 hover:bg-emerald-800 focus:ring-emerald-600',
        eyebrow: 'Process confirmation',
      },
      info: {
        icon: <Info className="h-7 w-7" />,
        chip: 'border-blue-200 bg-blue-50 text-blue-700',
        iconWrap: 'bg-blue-50 text-blue-700',
        border: 'border-blue-200',
        button: 'bg-blue-700 hover:bg-blue-800 focus:ring-blue-600',
        eyebrow: 'System information',
      },
      warning: {
        icon: <AlertTriangle className="h-7 w-7" />,
        chip: 'border-amber-200 bg-amber-50 text-amber-800',
        iconWrap: 'bg-amber-50 text-amber-800',
        border: 'border-amber-200',
        button: 'bg-[#8B6F47] hover:bg-[#745B38] focus:ring-[#8B6F47]',
        eyebrow: 'Business validation',
      },
      danger: {
        icon: <XCircle className="h-7 w-7" />,
        chip: 'border-red-200 bg-red-50 text-red-700',
        iconWrap: 'bg-red-50 text-red-700',
        border: 'border-red-200',
        button: 'bg-red-700 hover:bg-red-800 focus:ring-red-600',
        eyebrow: 'System exception',
      },
      access: {
        icon: <ShieldAlert className="h-7 w-7" />,
        chip: 'border-purple-200 bg-purple-50 text-purple-700',
        iconWrap: 'bg-purple-50 text-purple-700',
        border: 'border-purple-200',
        button: 'bg-[#8B6F47] hover:bg-[#745B38] focus:ring-[#8B6F47]',
        eyebrow: 'Role and authorization',
      },
    };
    return active ? styles[active.tone] : styles.info;
  }, [active]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-[#2E241C]/45 p-4 backdrop-blur-sm"
      data-no-modal-enhancer="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="business-alert-title"
    >
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-2xl border bg-white shadow-2xl ${tone.border}`}
        data-no-modal-enhancer="true"
      >
        <div className="h-2 bg-[#8B6F47]" />
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tone.iconWrap}`}>
              {tone.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`mb-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${tone.chip}`}>
                {tone.eyebrow}
              </div>
              <h2 id="business-alert-title" className="text-xl font-bold text-[#2B1D14]">
                {active.title}
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#5C4738]">
                {active.message}
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={close}
              autoFocus
              className={`rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${tone.button}`}
            >
              {active.primaryLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
