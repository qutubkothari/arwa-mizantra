'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { BusinessAlertProvider } from '@/components/ui/BusinessAlert';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { LocaleProvider } from '@/lib/locale';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>{children}</LocaleProvider>
      <BusinessAlertProvider />
      <ConfirmDialogProvider />
      <Toaster
        position="top-right"
        closeButton
        richColors={false}
        expand
        duration={6500}
        visibleToasts={5}
        toastOptions={{
          classNames: {
            toast:
              'font-sans text-sm border-l-4 border-[#8B6F47] bg-white text-[#2F1F17] shadow-xl ring-1 ring-[#D8CBB8]',
            success: 'border-l-emerald-600 bg-emerald-50 text-emerald-950 ring-emerald-200',
            error: 'border-l-amber-600 bg-amber-50 text-amber-950 ring-amber-200',
            warning: 'border-l-amber-600 bg-amber-50 text-amber-950 ring-amber-200',
            info: 'border-l-blue-600 bg-blue-50 text-blue-950 ring-blue-200',
            title: 'font-semibold tracking-tight',
            description: 'text-[#6B5A4A]',
            actionButton: 'bg-[#8B6F47] text-white hover:bg-[#6f5838]',
            cancelButton: 'bg-white text-[#4A3426] ring-1 ring-[#D8CBB8]',
          },
        }}
      />
    </QueryClientProvider>
  );
}
