const enableStandalone = process.env.NEXT_STANDALONE === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: enableStandalone ? 'standalone' : undefined,

  eslint: {
    // Keep builds deployable even if there are lint warnings/errors.
    // TypeScript typechecking still runs.
    ignoreDuringBuilds: true,
  },
  
  // Disable static page generation to avoid SSR context issues
  // Multi-language support disabled temporarily
  // i18n: {
  //   locales: ['en', 'hi', 'bn', 'te'],
  //   defaultLocale: 'en',
  // },

  // Environment variables
  env: {
    API_URL: process.env.API_URL || 'http://localhost:4000',
  },

  // Image optimization
  images: {
    domains: ['localhost'],
  },

  // Experimental features
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  async rewrites() {
    // Proxy browser calls like /api/v1/... (to :3000) over to the Nest API (:4000).
    // This avoids hard-coding public IPs and avoids CORS.
    const configured = process.env.API_URL || 'http://127.0.0.1:4000';
    const apiOrigin = configured.replace(/\/api\/v1\/?$/, '');

    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${apiOrigin}/uploads/:path*`,
      },
    ];
  },

  async headers() {
    const noStoreHeaders = [
      {
        key: 'Cache-Control',
        value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      },
      {
        key: 'Pragma',
        value: 'no-cache',
      },
      {
        key: 'Expires',
        value: '0',
      },
    ];

    // Security headers to prevent XSS, clickjacking, data leakage
    const securityHeaders = [
      {
        key: 'X-Frame-Options',
        value: 'DENY', // Prevent clickjacking
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff', // Prevent MIME type sniffing
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block', // Enable XSS filter
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin', // Limit referrer info
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(), geolocation=(self), payment=()', // Attendance uses camera/photo capture and GPS stamping
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains', // HTTPS only
      },
    ];

    return [
      {
        source: '/',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/dashboard',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/dashboard/:path*',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/login',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/register',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/forgot-password',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
      {
        source: '/reset-password',
        headers: [...noStoreHeaders, ...securityHeaders],
      },
    ];
  },
};

module.exports = nextConfig;
