import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'JWT Keys',
};

export default function JwtLayout({ children }: { children: React.ReactNode }) {
  return children;
}
