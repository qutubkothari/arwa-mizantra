'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';

export const dynamic = 'force-dynamic';

export default function UnauthorizedDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    if (!apiClient.isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl border-2 shadow-md p-6" style={{ borderColor: '#E8DCC4' }}>
        <h1 className="text-2xl font-bold" style={{ color: '#36454F' }}>
          Access restricted
        </h1>
        <p className="mt-2 text-sm" style={{ color: '#6F4E37' }}>
          Your role does not have access to the global dashboard or the page you tried to open.
          Please contact an admin to assign the correct module permissions.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg border-2 font-medium"
            style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
          >
            Go back
          </button>
          <button
            onClick={async () => {
              await apiClient.logout();
              router.replace('/login');
            }}
            className="px-4 py-2 rounded-lg text-white font-medium hover:opacity-90"
            style={{ backgroundColor: '#6F4E37' }}
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
