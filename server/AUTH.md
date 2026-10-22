# Accounts

The homepage and guest chat remain public. Sign up or log in from the navigation to save new conversations to an account. Guest conversations are deliberately not transferred to an account. Logging out restores the browser's guest history.

Account tables are created additively at backend startup (`initializeAuth` in `auth.js`). Existing users and conversations are preserved. Passwords use salted scrypt hashes. Session tokens are stored hashed in MySQL and sent in HTTP-only, SameSite=Strict cookies with a seven-day expiry. Production cookies require HTTPS. Password reset revokes all account sessions and all reset tokens for that account.

Configuration in server/.env:

```
APP_ORIGIN=http://localhost:3000
# Configure these to enable reset email delivery through Resend:
RESEND_API_KEY=
AUTH_EMAIL_FROM=
```

Use an authorized sender email for AUTH_EMAIL_FROM. Without email settings, reset requests clearly report that email is not configured; no reset tokens are exposed. Email links expire in 30 minutes and can be used once. Email ownership verification during signup is not implemented.

For deployment, set NODE_ENV=production and APP_ORIGIN to the exact HTTPS frontend origin. Host the API on the same site (for example app.example.com and api.example.com), or reverse proxy it under the frontend origin. Set REACT_APP_API_URL before building the frontend. SameSite=Strict sessions do not support unrelated frontend/API sites. Origin checks and credentialed CORS accept only APP_ORIGIN. Auth attempts are limited per IP in memory (30 per 15 minutes); use a shared rate limiter for multiple server instances. The app does not trust proxy headers by default; configure a specific trusted proxy before relying on client IPs behind a proxy.

Run `node scripts/test-auth.js` from server for account isolation and reset integration checks with real MySQL and mocked AI/email. The script creates additive auth tables, makes temporary accounts, and removes only those test accounts afterward. Run `npm run test:history` to verify guest history continues working.
