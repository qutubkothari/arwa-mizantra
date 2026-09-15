'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect page for backwards compatibility.
 * Store Vouchers have been split into separate SIV and SRV menu items.
 * This page redirects to SIV by default.
 */
export default function StoreVouchersRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/inventory/siv');
  }, [router]);

  return (
    <div className="p-6 text-sm text-gray-600">
      Redirecting to SIV (Store Issue Voucher)...
    </div>
  );
}
