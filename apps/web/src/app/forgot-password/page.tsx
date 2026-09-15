'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../../../lib/api-client';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.requestPasswordReset({ email });

      if (response.success) {
        setSuccess(true);
      } else {
        setError(response.error || 'Failed to send reset email. Please try again.');
      }
    } catch (err) {
      console.error('Password reset error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF9F6' }}>
        <div className="w-full max-w-md p-8 rounded-lg shadow-lg text-center" style={{ backgroundColor: 'white' }}>
          <div className="mb-6">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: '#E8DCC4' }}>
              <svg className="w-8 h-8" style={{ color: '#8B6F47' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h1 className="text-2xl font-bold mb-4" style={{ color: '#8B6F47' }}>
            Check Your Email
          </h1>
          <p className="mb-8" style={{ color: '#6F4E37' }}>
            If an account exists for <strong>{email}</strong>, password reset instructions have been sent.
          </p>

          <Link 
            href="/login"
            className="inline-block py-3 px-6 rounded-lg font-semibold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: '#8B6F47' }}
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF9F6' }}>
      <div className="w-full max-w-md p-8 rounded-lg shadow-lg" style={{ backgroundColor: 'white' }}>
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#8B6F47' }}>
            Reset Password
          </h1>
          <p className="text-sm" style={{ color: '#6F4E37' }}>
            Enter your email or username to receive reset instructions
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Email Address / Username
            </label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ 
                borderColor: '#E8DCC4',
                color: '#6F4E37'
              }}
              placeholder="email@company.com or username"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#FEE', color: '#C33' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#8B6F47' }}
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        {/* Back to Login */}
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
