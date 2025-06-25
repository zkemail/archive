import './globals.css';

import { GoogleOAuthProvider } from '@react-oauth/google';
import type { Metadata } from 'next';
import { Fustat } from 'next/font/google';
import { ThemeProvider } from 'next-themes';

import Footer from '@/components/Footer';
import Navbar from '@/components/Navbar';
import GoogleAuthProvider from '@/contexts/GoogleAuthProvider';
import ToastProvider from '@/contexts/ToastProvider';

const fustat = Fustat({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ZK Email',
  description: '',
  icons: {
    icon: [
      {
        media: '(prefers-color-scheme: light)',
        url: '/favicon-dark.svg',
      },
      {
        media: '(prefers-color-scheme: dark)',
        url: '/favicon-light.svg',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    return (
      <html lang='en' suppressHydrationWarning>
        <body className={`${fustat.className} antialiased`}>
          <ThemeProvider attribute='class' enableSystem defaultTheme='system'>
            <GoogleOAuthProvider
              clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''}
            >
              <GoogleAuthProvider>
                <ToastProvider>{children}</ToastProvider>
              </GoogleAuthProvider>
            </GoogleOAuthProvider>
          </ThemeProvider>
        </body>
      </html>
    );
  }

  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${fustat.className} transition-theme antialiased`}>
        <ThemeProvider attribute='class' enableSystem defaultTheme='default'>
          <div className='transition-theme flex h-screen flex-col justify-between'>
            <Navbar />
            <ToastProvider>{children}</ToastProvider>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
