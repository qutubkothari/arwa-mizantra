import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '../lib/install-date-format';
import './globals.css';
import { Providers } from '@/components/providers';
import DateLocaleBootstrap from '@/components/DateLocaleBootstrap';
import ModalEnhancer from '@/components/ModalEnhancer';
import VersionRefreshNotice from '@/components/VersionRefreshNotice';
import PWARegister from '@/components/PWARegister';
import PWAStatus from '@/components/PWAStatus';
import { buildDocumentBranding } from '@/lib/document-branding';
import GlobalSmartSelect from '@/components/GlobalSmartSelect';

const inter = Inter({ subsets: ['latin'] });
const appBranding = buildDocumentBranding(null);

export const metadata: Metadata = {
  title: `Mizantra ERP | ${appBranding.companyName}`,
  description: `Mizantra ERP by ${appBranding.companyName} with multi-tenant, multi-plant, and traceability support`,
  manifest: '/manifest.webmanifest',
  applicationName: 'Mizantra ERP',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Mizantra ERP',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/pwa-icon-192.png',
    apple: '/pwa-icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#8B6F47',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>
          <DateLocaleBootstrap />
          <PWARegister />
          <PWAStatus />
          <VersionRefreshNotice />
          {children}
          <ModalEnhancer />
          <GlobalSmartSelect />
        </Providers>
      </body>
    </html>
  );
}
