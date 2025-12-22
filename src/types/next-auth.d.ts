import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  /**
   * Extended Session interface with custom properties
   */
  interface Session {
    /** Whether the user has granted Gmail read scope */
    has_gmail_scope: boolean | undefined;
    /** OAuth access token for API calls */
    accessToken?: string;
    /** Error from token refresh */
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  /**
   * Extended JWT interface with OAuth tokens
   */
  interface JWT {
    /** OAuth access token */
    access_token?: string;
    /** OAuth refresh token */
    refresh_token?: string;
    /** Token expiration timestamp (seconds since epoch) */
    expires_at?: number;
    /** Error from token refresh */
    error?: string;
    /** OAuth scopes granted */
    scope?: string;
  }
}
