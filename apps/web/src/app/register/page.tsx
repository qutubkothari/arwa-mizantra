'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/api-client';
import { buildDocumentBranding } from '@/lib/document-branding';

export const dynamic = 'force-dynamic';
const appBranding = buildDocumentBranding(null);

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    company: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await apiClient.register({
        name: `${formData.firstName} ${formData.lastName}`,
        username: formData.username.trim().toLowerCase(),
        email: formData.email,
        password: formData.password,
        companyName: formData.company,
      });

      if (response.success) {
        // Redirect to dashboard on successful registration
        router.push('/dashboard');
      } else {
        setError(response.error || 'Registration failed. Please try again.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12" style={{ backgroundColor: '#FAF9F6' }}>
      <div className="w-full max-w-md p-8 rounded-lg shadow-lg" style={{ backgroundColor: 'white' }}>
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#8B6F47' }}>
            Create Account
          </h1>
          <p className="text-sm" style={{ color: '#6F4E37' }}>
            Join {appBranding.companyName} ERP Platform
          </p>
        </div>

        {/* Register Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                First Name
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={formData.firstName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
              />
            </div>

            <div>
              <label htmlFor="lastName" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Last Name
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={formData.lastName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="company" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Company Name
            </label>
            <input
              id="company"
              name="company"
              type="text"
              value={formData.company}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              required
              minLength={8}
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80 transition-colors"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
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
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        {/* Additional Links */}
        <div className="mt-6 text-center">
          <div className="text-sm" style={{ color: '#6F4E37' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold hover:underline" style={{ color: '#8B6F47' }}>
              Sign in here
            </Link>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: '#E8DCC4' }}>
          <Link 
            href="/" 
            className="text-sm hover:underline"
            style={{ color: '#6F4E37' }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
