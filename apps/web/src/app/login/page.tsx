'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/api-client';
import { buildDocumentBranding } from '@/lib/document-branding';
import { getDefaultLandingPath } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
const appBranding = buildDocumentBranding(null);

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<Array<{ accountId: string; tenantId: string; companyName: string; displayName?: string; username?: string; email?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resetTenantSelection = () => {
    setTenantId('');
    setAccountId('');
    setTenantOptions([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.login({
        username: username.trim(),
        password,
        tenantId: tenantId || undefined,
        accountId: accountId || undefined,
      });

      if (response.success && response.data?.requiresTenantSelection) {
        setTenantOptions(response.data.tenants || []);
        setTenantId(response.data.tenants?.[0]?.tenantId || '');
        setAccountId(response.data.tenants?.[0]?.accountId || '');
        setError(response.data.message || 'Select the company to continue.');
      } else if (response.success && response.data?.accessToken) {
        const landingPath = getDefaultLandingPath(response.data.user as any);
        if (typeof window !== 'undefined' && landingPath.startsWith('/dashboard/hr/')) {
          sessionStorage.setItem('postLoginLandingPath', landingPath);
        }
        router.replace(landingPath);
      } else {
        setError(response.error || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f1e8] text-[#2f2118]">
      <section className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-[#d9c9ab] bg-white shadow-[0_18px_60px_rgba(47,33,24,0.14)] lg:grid-cols-[0.92fr_1.08fr]">
          <aside className="hidden border-r border-[#e5d8c2] bg-[#f9f5ed] p-10 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-8">
                <div className="flex items-center gap-4">
                  <img src="/branding/sak-solutions-mark.png" alt="SAK Solutions logo" className="h-20 w-20 object-contain" />
                  <span className="font-serif text-3xl font-semibold text-[#273b73]">SAK Solutions</span>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#8b6f47]">Enterprise Resource Planning</p>
              </div>

              <div className="rounded-xl border border-[#e3d4b9] bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6f47]">System</p>
                <p className="mt-2 text-lg font-black">Mizantra ERP</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-[#eee3d0] bg-[#fbf8f1] p-3">
                    <p className="text-xs font-semibold uppercase text-[#8b6f47]">Environment</p>
                    <p className="mt-1 font-bold text-[#2f2118]">ERP v2</p>
                  </div>
                  <div className="rounded-lg border border-[#eee3d0] bg-[#fbf8f1] p-3">
                    <p className="text-xs font-semibold uppercase text-[#8b6f47]">Access</p>
                    <p className="mt-1 font-bold text-[#2f2118]">Authorized users</p>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs leading-5 text-[#7b6654]">
              This system is restricted to authorized company users. Activities may be logged for security and audit purposes.
            </p>
          </aside>

          <div className="p-6 sm:p-10">
            <div className="mb-8 flex items-start justify-between gap-4 lg:hidden">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <img src="/branding/sak-solutions-mark.png" alt="SAK Solutions logo" className="h-12 w-12 object-contain" />
                    <span className="font-serif text-xl font-semibold text-[#273b73]">SAK Solutions</span>
                  </div>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-[#8b6f47]">Mizantra ERP</p>
                </div>
              </div>
              <span className="rounded-full border border-[#d9c9ab] bg-[#fbf8f1] px-3 py-1 text-xs font-bold text-[#6f4e37]">ERP v2</span>
            </div>

            <div className="mb-8">
              <div className="mb-4 hidden items-center justify-between lg:flex">
                <span className="rounded-full border border-[#d9c9ab] bg-[#fbf8f1] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#6f4e37]">
                  ERP v2
                </span>
                <span className="text-xs font-semibold text-[#8d7a69]">Secure Sign In</span>
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#2f2118]">Sign in</h2>
              <p className="mt-2 text-sm text-[#7b6654]">Enter your credentials to access the ERP system.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="username" className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-[#6f4e37]">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    resetTenantSelection();
                  }}
                  required
                  autoComplete="username"
                  className="w-full rounded-xl border border-[#cdbd9f] bg-white px-4 py-3 text-base text-[#2f2118] outline-none transition focus:border-[#8b6f47] focus:ring-3 focus:ring-[#8b6f47]/10"
                  placeholder="Enter username"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-[#6f4e37]">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    resetTenantSelection();
                  }}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#cdbd9f] bg-white px-4 py-3 text-base text-[#2f2118] outline-none transition focus:border-[#8b6f47] focus:ring-3 focus:ring-[#8b6f47]/10"
                  placeholder="Enter password"
                />
              </div>

              {tenantOptions.length > 0 && (
                <div>
                  <label htmlFor="tenant" className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-[#6f4e37]">
                    Company / Account
                  </label>
                  <select
                    id="tenant"
                    value={accountId}
                    onChange={(e) => {
                      const selected = tenantOptions.find((option) => option.accountId === e.target.value);
                      setAccountId(e.target.value);
                      setTenantId(selected?.tenantId || '');
                    }}
                    required
                    className="w-full rounded-xl border border-[#cdbd9f] bg-white px-4 py-3 text-base text-[#2f2118] outline-none transition focus:border-[#8b6f47] focus:ring-3 focus:ring-[#8b6f47]/10"
                  >
                    {tenantOptions.map((option) => (
                      <option key={option.accountId} value={option.accountId}>
                        {option.companyName} - {option.displayName || option.username || option.email || 'User'} ({option.accountId.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-[#7a6555]">
                    These credentials are linked to multiple accounts. Select the correct company and continue.
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#8b6f47] px-5 py-3.5 text-base font-black text-white shadow-sm transition hover:bg-[#765c38] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in...' : tenantOptions.length > 0 ? 'Continue to Company' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-[#6f4e37]">
              <Link href="/forgot-password" className="font-semibold hover:text-[#8b6f47] hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
