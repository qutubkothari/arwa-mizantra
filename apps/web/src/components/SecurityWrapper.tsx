'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';

/**
 * SecurityWrapper - Implements data protection measures
 * 1. Session timeout after inactivity
 * 2. Screen watermark with username (deters screenshots)
 * 3. Disable right-click context menu
 * 4. Disable common screenshot shortcuts (PrintScreen, Ctrl+Shift+S, etc.)
 * 5. Warn on DevTools opening
 */

const SESSION_TIMEOUT_MINUTES = 60; // Auto-logout after 60 min inactivity
const WARNING_BEFORE_LOGOUT = 60; // Show warning 60 seconds before logout

export function SecurityWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_BEFORE_LOGOUT);
  const [lastActivity, setLastActivity] = useState(0);
  const [isSecurityEnabled, setIsSecurityEnabled] = useState(false);
  const [watermarkTimestamp, setWatermarkTimestamp] = useState('');

  useEffect(() => {
    // Disabled security features globally per user request
    setIsSecurityEnabled(false);
    setLastActivity(Date.now());
    setWatermarkTimestamp(new Date().toISOString());
  }, []);

  // Get user info for watermark (name may come from various fields)
  const userEmail = user?.email || 'Unknown';
  const userName = (user as any)?.name || (user as any)?.username || user?.first_name || user?.firstName || user?.email || 'Unknown User';
  const watermarkText = `${userName} | ${watermarkTimestamp || 'SESSION'} | CONFIDENTIAL`;

  // Session timeout logic
  useEffect(() => {
    if (!isSecurityEnabled) return;

    let warningTimer: NodeJS.Timeout;
    let logoutTimer: NodeJS.Timeout;
    let countdownInterval: NodeJS.Timeout;

    const resetTimers = () => {
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
      clearInterval(countdownInterval);
      setShowWarning(false);
      setSecondsLeft(WARNING_BEFORE_LOGOUT);

      // Set warning timer
      warningTimer = setTimeout(() => {
        setShowWarning(true);
        // Start countdown
        countdownInterval = setInterval(() => {
          setSecondsLeft((prev) => {
            if (prev <= 1) {
              clearInterval(countdownInterval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }, (SESSION_TIMEOUT_MINUTES * 60 - WARNING_BEFORE_LOGOUT) * 1000);

      // Set logout timer
      logoutTimer = setTimeout(() => {
        handleLogout();
      }, SESSION_TIMEOUT_MINUTES * 60 * 1000);
    };

    const handleActivity = () => {
      setLastActivity(Date.now());
      resetTimers();
    };

    const handleLogout = () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.removeItem('userId');
      localStorage.removeItem('tenant');
      localStorage.removeItem('tenantId');
      router.replace('/login?reason=session_timeout');
    };

    // Listen for user activity
    const events = ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'input', 'change', 'scroll', 'wheel', 'touchstart', 'touchmove', 'mousemove', 'pointermove', 'focus'];
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    resetTimers();

    return () => {
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
      clearInterval(countdownInterval);
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [router, isSecurityEnabled]);

  // Disable right-click
  useEffect(() => {
    if (!isSecurityEnabled) return;

    const disableRightClick = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    document.addEventListener('contextmenu', disableRightClick);
    return () => {
      document.removeEventListener('contextmenu', disableRightClick);
    };
  }, [isSecurityEnabled]);

  // Disable common screenshot shortcuts
  useEffect(() => {
    if (!isSecurityEnabled) return;

    const disableShortcuts = (e: KeyboardEvent) => {
      // PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        alert('Screenshots are not permitted for security reasons.');
        return false;
      }
      // Ctrl+Shift+S (Windows screenshot tool)
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        return false;
      }
      // Cmd+Shift+5 (Mac screenshot tool)
      if (e.metaKey && e.shiftKey && e.key === '5') {
        e.preventDefault();
        return false;
      }
      // Ctrl+P (Print)
      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        alert('Printing is restricted for security reasons.');
        return false;
      }
    };

    document.addEventListener('keydown', disableShortcuts);
    return () => {
      document.removeEventListener('keydown', disableShortcuts);
    };
  }, [isSecurityEnabled]);

  // Detect DevTools opening (basic detection)
  useEffect(() => {
    if (!isSecurityEnabled) return;

    const threshold = 160;
    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;
      if (widthThreshold || heightThreshold) {
        console.warn('%cSTOP!', 'color: red; font-size: 40px; font-weight: bold;');
        console.warn('%cThis is a secured application. Unauthorized access attempts are logged.', 'color: red; font-size: 16px;');
      }
    };

    window.addEventListener('resize', checkDevTools);
    return () => {
      window.removeEventListener('resize', checkDevTools);
    };
  }, [isSecurityEnabled]);

  // Prevent copy/paste of sensitive data
  useEffect(() => {
    if (!isSecurityEnabled) return;

    const preventCopy = (e: ClipboardEvent) => {
      // Allow copy on input fields for usability, block elsewhere
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (!isInput) {
        e.preventDefault();
        return false;
      }
    };

    document.addEventListener('copy', preventCopy);
    return () => {
      document.removeEventListener('copy', preventCopy);
    };
  }, [isSecurityEnabled]);

  return (
    <>
      {children}

      {/* Session Timeout Warning Modal */}
      {isSecurityEnabled && showWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-md">
            <h3 className="mb-2 text-lg font-bold text-red-600">Session Timeout Warning</h3>
            <p className="mb-4 text-gray-700">
              Your session will expire in <strong>{secondsLeft}</strong> seconds due to inactivity.
            </p>
            <p className="mb-4 text-sm text-gray-500">
              Move your mouse or press any key to stay logged in.
            </p>
            <button
              onClick={() => setLastActivity(Date.now())}
              className="w-full rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
            >
              Continue Session
            </button>
          </div>
        </div>
      )}

      {/* Watermark Overlay - Repeating diagonal text */}
      {isSecurityEnabled && (
        <div
          className="fixed inset-0 pointer-events-none z-[9000] overflow-hidden"
          style={{
            background: 'transparent',
          }}
        >
          {/* Repeating watermark pattern */}
          <div
            className="absolute inset-0 opacity-[0.08] select-none"
            style={{
              backgroundImage: `repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 150px,
                rgba(0,0,0,0.3) 150px,
                rgba(0,0,0,0.3) 300px
              )`,
            }}
          />
          {/* Text watermarks */}
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute select-none whitespace-nowrap text-lg font-bold text-red-500/20 rotate-[-45deg]"
              style={{
                left: `${(i % 5) * 25}%`,
                top: `${Math.floor(i / 5) * 25}%`,
                transform: 'rotate(-45deg)',
              }}
            >
              {watermarkText}
            </div>
          ))}
        </div>
      )}

      {/* Bottom right user indicator */}
      {isSecurityEnabled && (
        <div className="fixed bottom-2 right-2 z-[9001] select-none rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 border border-yellow-300">
          👤 {userName} | 🕐 Auto-logout: {SESSION_TIMEOUT_MINUTES}min
        </div>
      )}
    </>
  );
}
