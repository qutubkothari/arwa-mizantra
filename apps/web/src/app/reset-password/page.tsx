'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../../../lib/api-client';
import { buildDocumentBranding } from '@/lib/document-branding';

export const dynamic = 'force-dynamic';

const appBranding = buildDocumentBranding(null);

function readResetTokenFromLocation(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('token')?.trim() || '';
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(readResetTokenFromLocation());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is missing or invalid. Please request a new one.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const response = await apiClient.resetPassword({ token, newPassword });

      if (response.success) {
        setSuccess(true);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setError(response.error || 'Failed to reset password. Please request a new reset link.');
      }
    } catch (err) {
      console.error('Reset password error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#FAF9F6' }}>
      <div className="w-full max-w-md p-8 rounded-lg shadow-lg" style={{ backgroundColor: 'white' }}>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#8B6F47' }}>
            {appBranding.companyName}
          </h1>
          <p className="text-sm" style={{ color: '#6F4E37' }}>
            Choose a new password for your account
          </p>
        </div>

        {success ? (
          <div className="text-center space-y-5">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: '#E8DCC4' }}>
              <svg className="w-8 h-8" style={{ color: '#8B6F47' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-3" style={{ color: '#8B6F47' }}>
                Password Updated
              </h2>
              <p style={{ color: '#6F4E37' }}>
                Your password has been reset successfully. You can now sign in with your new password.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-block py-3 px-6 rounded-lg font-semibold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: '#8B6F47' }}
            >
              Go to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {!token && (
              <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE', color: '#C33' }}>
                This reset link is invalid. Request a new password reset email to continue.
              </div>
            )}

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="Enter your new password"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="Re-enter your new password"
              />
            </div>

            <p className="text-sm" style={{ color: '#6F4E37' }}>
              Use at least 8 characters.
            </p>

            {error && (
              <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE', color: '#C33' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-3 rounded-lg font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#8B6F47' }}
            >
              {loading ? 'Updating...' : 'Reset Password'}
            </button>
          </form>
        )}

        <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: '#E8DCC4' }}>
          <Link
            href="/login"
            className="text-sm hover:underline"
            style={{ color: '#6F4E37' }}
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}