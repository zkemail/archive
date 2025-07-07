import './globals.css';

import { GoogleOAuthProvider } from '@react-oauth/google';
import type { Metadata } from 'next';
import { Fustat } from 'next/font/google';
import { ThemeProvider } from 'next-themes';

import Footer from '@/components/Footer';
import Navbar from '@/components/Navbar';
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
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${fustat.className} transition-theme antialiased`}>
        <ThemeProvider attribute='class' enableSystem defaultTheme='default'>
          <div className='transition-theme flex h-screen flex-col justify-between'>
            <Navbar />
            {children}
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
