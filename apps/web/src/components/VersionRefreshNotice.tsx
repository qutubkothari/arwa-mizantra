'use client';

import { useEffect, useState } from 'react';

const VERSION_POLL_MS = 60000;

async function fetchBuildId(): Promise<string | null> {
  try {
    const response = await fetch('/build-id', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const buildId = String(data?.buildId || '').trim();
    return buildId || null;
  } catch {
    return null;
  }
}

export default function VersionRefreshNotice() {
  const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
  const [pendingBuildId, setPendingBuildId] = useState<string | null>(null);
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkBuildId = async () => {
      const nextBuildId = await fetchBuildId();
      if (cancelled || !nextBuildId) return;

      setCurrentBuildId((prev) => {
        if (!prev) {
          return nextBuildId;
        }

        if (prev !== nextBuildId) {
          setPendingBuildId(nextBuildId);
        }

        return prev;
      });
    };

    void checkBuildId();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkBuildId();
    }, VERSION_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const updateAvailable = Boolean(
    pendingBuildId && pendingBuildId !== currentBuildId && pendingBuildId !== dismissedBuildId,
  );

  if (!updateAvailable) {
    return null;
  }

  return (
    <div className="fixed left-1/2 top-3 z-[930] w-[min(960px,calc(100vw-1rem))] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg sm:top-4 sm:px-4 sm:py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div>
        <div className="font-semibold">A newer version is available.</div>
        <div className="text-amber-800">Reload to get the latest fixes from the recent deployment.</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-amber-700 px-3 py-2 font-medium text-white hover:bg-amber-800"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => setDismissedBuildId(pendingBuildId)}
          className="rounded-lg border border-amber-300 px-3 py-2 font-medium text-amber-900 hover:bg-amber-100"
        >
          Later
        </button>
      </div>
      </div>
    </div>
  );
}
