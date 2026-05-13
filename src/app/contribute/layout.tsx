import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contribute',
};

export default function ContributeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
