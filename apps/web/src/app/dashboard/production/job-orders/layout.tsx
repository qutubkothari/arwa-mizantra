'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export default function JobOrdersLayout({ children }: { children: ReactNode }) {
  usePathname();

  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
