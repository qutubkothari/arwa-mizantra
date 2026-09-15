'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const widthMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  full: 'max-w-none',
};

/**
 * Enterprise-grade slide-over panel for create/edit forms.
 * Replaces the modal-on-monolith-page-pattern with a clean side panel.
 */
export function SlidePanel({
  open,
  onClose,
  title,
  subtitle,
  width = 'xl',
  children,
  footer,
}: SlidePanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[1000] bg-[#4A3426]/35 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'fixed right-0 top-0 z-[1010] flex h-[100dvh] w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out',
          widthMap[width],
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-[#E8DCC4] px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-[#4A3426] leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-[#7A6555]">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1.5 text-[#9A8878] transition-colors hover:bg-[#F5EFE3] hover:text-[#6F4E37]"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {/* Footer — optional sticky action bar */}
        {footer && (
          <div className="flex-shrink-0 border-t border-[#E8DCC4] bg-[#FAF9F6] px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
