# Production deployment preparation

The application is a fictional company-support demo, not a verified employee system. No real deployment or AWS provisioning has been performed by these changes.

## Prepared application

- Node 24 LTS, pinned in `.nvmrc`, `.node-version`, package engines and Dockerfile.
- Vite builds the React frontend; Vitest runs the existing component tests. JSX source files now use `.jsx` extensions. CSS remains in `chat_bot/src/styles`.
- Express serves `chat_bot/build` in production. With no `VITE_API_URL`, API calls use the same origin, avoiding cross-site cookie configuration. Hash navigation needs no SPA catch-all route.
- HTTPS is mandatory in production except `/health/live` for internal health checks. The host must terminate TLS and forward only trusted proxy headers. `TRUST_PROXY_HOPS` must match the actual proxy chain, not a guessed value. Keep the backend listener inaccessible directly from the internet.
- Helmet supplies CSP, frame restrictions, content-type protection, and HSTS. Inline styles are allowed because the existing React UI uses style objects; script execution stays restricted to the application's own origin.
- Guest API requests are rejected with 401, including histories and retries. Old guest records are preserved, not deleted. Public signup still permits any registered person to view fictional answers. Real company policies require a separate employee-verification process before ingestion.
- Messages and retries share a per-account limit of 20 requests/minute. API endpoints also have a 300 requests/15 minute IP limit. Existing auth throttling remains. Counters are in memory: run one backend process initially. Multiple replicas require a shared limiter store or suitable gateway enforcement; budgets reset on process restart.
- Production startup checks existing tables instead of creating tables. Provision the schema separately and use a runtime MySQL account with only the required DML permissions. Do not grant runtime users DROP, ALTER, or broad administration rights.
- Invalid JSON, oversized bodies, and unexpected errors return generic JSON without stack traces.

## Production configuration

Use `server/.env.production.example` as a list of settings; inject real values through your hosting service's secret/configuration store. Do not commit or bake `.env` files into images. The app reads `server/.env` if present, without overriding host environment variables; never ship that local file. It does not automatically select `.env.production`.

Set `NODE_ENV=production`, your real HTTPS `APP_ORIGIN`, the correct `TRUST_PROXY_HOPS`, DB credentials and verified CA path. Do not use the placeholder domain. Do not set `AWS_PROFILE` in production. FAQ answers now use the existing MySQL pool; no DynamoDB role is required. Apply migration 005 and run `npm run import:faq` before starting the app. Temporary import permissions must stay removed. Never deploy root credentials or copy local login caches.

Password recovery requires a Resend API key and a verified sender configured as `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, plus `AUTH_PASSWORD_RESET_ENABLED=true`. Verify the sender/domain with the email provider and test actual email delivery before claiming recovery is available. These credentials and DNS settings cannot be generated from the repository. If recovery is not ready, explicitly set `AUTH_PASSWORD_RESET_ENABLED=false`: the UI hides the recovery link, a direct forgot route explains unavailability, and the backend refuses requests. Production startup rejects incomplete enabled recovery configuration.

## Build and run

With Node 24 installed, run each command separately:

```powershell
cd chat_bot
npm ci
npm test
npm run build
cd ../server
npm ci
npm test
```

Supply production settings through the host, then run `node server.js`. For local development, use `npm start` separately in both directories. Vite listens on port 3000, Express on port 5000. Restart old development processes after the toolchain/runtime migration.

The Dockerfile builds the frontend and runs Express as a non-root user. Build with `docker build -t support-desk .` if Docker is installed. It still needs external HTTPS termination, production environment settings, private RDS connectivity, and an IAM role. A successful local Vite build is not proof that an unbuilt container or a hosting platform has been verified.

## Host/account checks still required

Before provisioning choose the host, public domain, deployment region, expected traffic and budget. Then:

1. Configure TLS certificates, HTTPS redirects at the edge, proxy headers, and same-origin routing.
2. Restrict RDS security groups to the backend, inspect public accessibility, encryption at rest, backups and retention, and test recovery. Existing verified MySQL TLS protects transit but does not establish those other controls.
3. Verify the workload role and remove development profiles/import permissions from production.
4. Configure deployment secrets, log retention, alerting and spending alerts. Keep passwords, cookies and reset tokens out of logs. Review chat/file retention before accepting real user data.
5. Estimate costs for compute, RDS instance/storage/backups, logs, bandwidth, and any load balancer/NAT/domain/email. FAQ lookup loads at most 1,000 authorized MySQL FAQ records for matching. A fixed estimate is not valid without resource sizes and traffic assumptions.
6. Test signup/login/logout, HTTPS Secure cookies, password recovery if enabled, all relevant answers, retries, rate limits and mobile layouts on the deployed URL.

No AWS network rules, IAM policies, billing budgets, DNS, certificates, email domains or hosting resources are automatically changed by the repository. They require the selected infrastructure and account permissions. Real browser-based production authentication and cloud backup/restore tests remain deployment-time checks.

## Automated checks

CI runs frontend tests/build and backend unit/security tests without database access. `npm run test:auth`, `npm run test:history`, and `npm run test:mysql-chat` use isolated temporary MySQL accounts; the last reads the MySQL FAQ table. The MySQL chat integration reads the imported FAQ table and simulates an outage. Integration scripts are opt-in, not run against a production database by CI.
