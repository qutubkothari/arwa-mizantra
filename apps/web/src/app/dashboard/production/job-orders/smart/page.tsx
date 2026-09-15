'use client';

import { useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function SmartJobOrderRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    router.replace(`/dashboard/production/job-orders/smart-items${query ? `?${query}` : ''}`);
  }, [router, searchParams]);

  return (
    <div className="p-6 text-sm text-gray-600">
      Redirecting to the Create Job Order screen...
    </div>
  );
}

export default function SmartJobOrderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Redirecting to the Create Job Order screen...</div>}>
      <SmartJobOrderRedirect />
    </Suspense>
  );
}
