# Company Support Desk

A fictional NovaTech Solutions support portal. React displays prepared company-support answers retrieved from AWS RDS MySQL; Express stores accounts and conversation history in AWS RDS MySQL. No AI provider is called.

## Requirements and local setup

Use Node.js 24 LTS (`.nvmrc`). Install dependencies with `npm ci` separately in `server` and `chat_bot`. Configure `server/.env` from `server/.env.example` with your local RDS settings and non-root AWS profile. Never commit credentials. Renew local AWS authentication with `aws login --profile company-support-dev --region us-east-1`.

Run `npm start` in `server` for the backend on port 5000 and in `chat_bot` for Vite on port 3000. Log in or create an account; guest API access is disabled. Password reset is shown only when email delivery is configured.

## Tests

- Frontend: `npm test` in `chat_bot` (Vitest and React Testing Library).
- Backend unit/security: `npm test` in `server`.
- MySQL integration: `npm run test:auth`, `npm run test:history`, `npm run test:dynamodb-chat` in `server`. These create temporary test accounts and clean them up.
- MySQL FAQ import/verification: `npm run import:faq`; chat integration: `npm run test:mysql-chat` in `server`.
- Connection checks: `npm run check:db` and `npm run check:dynamodb` in `server`.

## Structure

- `chat_bot/src/App.jsx`: account-gated chat workspace and interactions.
- `chat_bot/src/SupportHome.jsx` and `SupportWelcome.jsx`: welcome screens and support topics.
- `chat_bot/src/Account.jsx`: account forms.
- `chat_bot/src/styles/`: all frontend CSS.
- `server/server.js`: API routes and production frontend serving.
- `server/auth.js`: password hashing and database-backed sessions.
- `server/chat-history.js`: authenticated chat ownership, history and actions.
- `server/dynamodb-answers.js`: authorized prepared-answer retrieval and lexical matching.
- `server/security.js` and `production-config.js`: limits, headers and startup configuration validation.
- `Database/seeds/`: the 20 original and 30 additional fictional FAQs and conditional importer.

See [DEPLOYMENT.md](DEPLOYMENT.md) for HTTPS, IAM workload roles, email delivery, secret management, testing and remaining infrastructure decisions. Build the frontend with `npm run build` in `chat_bot`; Express serves that build in production using the same origin. The Dockerfile is a deployment template, not a provisioned host.

All company policies are synthetic demonstration content. Account registration does not verify employment. Do not add real confidential policies until employee verification is implemented.
