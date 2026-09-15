'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DebugPage() {
  const router = useRouter();
  const [tokenInfo, setTokenInfo] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    try {
      const token = localStorage.getItem('accessToken');
      
      if (!token) {
        setError('No access token found. Please login.');
        return;
      }

      // Decode JWT (split by dots, take payload, base64 decode)
      const parts = token.split('.');
      if (parts.length !== 3) {
        setError('Invalid token format');
        return;
      }

      const payload = JSON.parse(atob(parts[1]));
      setTokenInfo({
        userId: payload.sub,
        email: payload.email,
        tenantId: payload.tenantId,
        iat: new Date(payload.iat * 1000).toLocaleString(),
        exp: new Date(payload.exp * 1000).toLocaleString(),
        fullPayload: payload,
      });
    } catch (err: any) {
      setError(`Error decoding token: ${err.message}`);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-8">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-amber-600 hover:text-amber-800 mb-4"
        >
          ← Back to Dashboard
        </button>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-amber-900 mb-6">🔍 JWT Token Debug</h1>

          {error ? (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          ) : tokenInfo ? (
            <div className="space-y-6">
              {/* Critical Check */}
              <div className={`p-4 rounded-lg ${tokenInfo.tenantId ? 'bg-green-100 border-2 border-green-500' : 'bg-red-100 border-2 border-red-500'}`}>
                <h2 className="text-xl font-bold mb-2">
                  {tokenInfo.tenantId ? '✅ Tenant ID Present' : '❌ NO TENANT ID - CRITICAL ISSUE'}
                </h2>
                {tokenInfo.tenantId ? (
                  <p className="text-green-800">Your token has tenant isolation enabled</p>
                ) : (
                  <div className="text-red-800">
                    <p className="font-bold">Your token is missing tenantId!</p>
                    <p className="mt-2">This means you&apos;re logged in with an OLD session before the multi-tenant fix.</p>
                    <p className="mt-2 font-bold">ACTION REQUIRED: Logout and login again to get a fresh token with tenantId</p>
                  </div>
                )}
              </div>

              {/* Token Details */}
              <div className="border rounded-lg p-4">
                <h3 className="font-bold text-lg mb-3">Token Information:</h3>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <span className="font-medium">User ID:</span>
                    <span className="col-span-2 font-mono text-sm">{tokenInfo.userId}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="font-medium">Email:</span>
                    <span className="col-span-2">{tokenInfo.email}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="font-medium">Tenant ID:</span>
                    <span className={`col-span-2 font-mono text-sm ${tokenInfo.tenantId ? 'text-green-600' : 'text-red-600'}`}>
                      {tokenInfo.tenantId || 'MISSING ❌'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="font-medium">Issued At:</span>
                    <span className="col-span-2">{tokenInfo.iat}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="font-medium">Expires At:</span>
                    <span className="col-span-2">{tokenInfo.exp}</span>
                  </div>
                </div>
              </div>

              {/* Full Payload */}
              <div className="border rounded-lg p-4">
                <h3 className="font-bold text-lg mb-3">Full JWT Payload:</h3>
                <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-xs">
                  {JSON.stringify(tokenInfo.fullPayload, null, 2)}
                </pre>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={() => {
                    localStorage.clear();
                    window.location.href = '/';
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  🚪 Force Logout & Clear All Data
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  🔄 Refresh Debug Info
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Loading token information...</div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-bold text-blue-900 mb-3">🎯 How to Fix &quot;No Vendors/GRN Showing&quot; Issue:</h3>
          <ol className="list-decimal list-inside space-y-2 text-blue-800">
            <li>Check if your JWT token has a <code className="bg-blue-100 px-1 rounded">tenantId</code> field</li>
            <li>If <strong>missing tenantId</strong>: Click &quot;Force Logout&quot; above, then login again</li>
            <li>After fresh login, your token will have tenantId and vendors will be isolated to your company</li>
            <li>Old vendors created before the fix may belong to a previous default tenant - you&apos;ll need to create new ones</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
