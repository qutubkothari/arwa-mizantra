'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export default function PWAStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.9rem)] z-[920] mx-auto max-w-md md:bottom-4">
      {!online && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 shadow-lg">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Offline. Live ERP transactions are paused until connection returns.</span>
        </div>
      )}
    </div>
  );
}
