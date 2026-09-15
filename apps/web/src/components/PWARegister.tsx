'use client';

import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = async () => {
      try {
        // Version the worker URL so browsers running the former cache-first
        // worker cannot keep intercepting its own update request.
        const registration = await navigator.serviceWorker.register(
          '/sw.js?v=20260730-blank-page-fix',
          { scope: '/' },
        );
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      } catch (error) {
        console.warn('[PWA] Service worker registration failed', error);
      }
    };

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
