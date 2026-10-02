import type { NextConfig } from 'next';

// NOTE: archive.prove.email is a legacy alias of archive.zk.email served by
// the same Render service. Google sign-in only works on the host AUTH_URL
// names (archive.zk.email): Auth.js sets its PKCE/state cookies host-only on
// the host where sign-in starts, then sends Google's callback to AUTH_URL, so
// a sign-in started on the alias lands on archive.zk.email without its
// cookies and fails with `error=Configuration`. Sending the alias's pages to
// the canonical host before sign-in starts avoids that.
const LEGACY_HOST = 'archive.prove.email';
const CANONICAL_ORIGIN = 'https://archive.zk.email';

const nextConfig: NextConfig = {
  output: 'standalone',

  async redirects() {
    // NOTE: match on Host, not X-Forwarded-Host. The Next.js server overwrites
    // X-Forwarded-Host itself before redirects run (a local test with
    // X-Forwarded-Host set to the alias did not redirect). That overwrite is
    // probably also why Auth.js, with AUTH_URL unset, derived
    // `localhost:10000` on Render. Don't remove AUTH_URL.
    const has = [{ type: 'host' as const, value: LEGACY_HOST }];
    return [
      // REASON: pages and the NextAuth routes only. The public API and the
      // well-known JWKS stay served on the alias, because existing
      // cross-origin consumers may call them there, and a CORS preflight
      // cannot follow a redirect, so redirecting them would break those
      // callers outright. Temporary (307) on purpose: browsers cache a 308
      // indefinitely, which would make this hard to undo.
      {
        source: '/:path((?!api/|\\.well-known/).*)',
        has,
        destination: `${CANONICAL_ORIGIN}/:path`,
        permanent: false,
      },
      {
        source: '/api/auth/:path*',
        has,
        destination: `${CANONICAL_ORIGIN}/api/auth/:path*`,
        permanent: false,
      },
    ];
  },

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
