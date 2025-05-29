import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GoogleOAuthProvider } from "@react-oauth/google";
import ToastProvider from "@/contexts/ToastProvider";
import GoogleAuthProvider from "@/contexts/GoogleAuthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <GoogleOAuthProvider
            clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""}
          >
            <GoogleAuthProvider>
              <ToastProvider>{children}</ToastProvider>
            </GoogleAuthProvider>
          </GoogleOAuthProvider>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
