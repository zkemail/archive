import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  async rewrites() {
    return [
      // Statement verification keys live at a stable well-known path
      // (REG-736) so consumers can pin one URL for the lifetime of
      // the evidence they archive. Served via a rewrite rather than an
      // `app/.well-known/` segment because App Router does not pick up
      // dot-prefixed directories, and via a rewrite rather than a `public/`
      // file so the response is generated from the same committed JWKS the
      // signer validates its kid against.
      {
        source: '/.well-known/dkim-archive-jwks.json',
        destination: '/api/statement/jwks',
      },
    ];
  },
};

export default nextConfig;
