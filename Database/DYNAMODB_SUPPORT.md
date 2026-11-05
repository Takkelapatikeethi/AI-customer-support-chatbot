# Company-support answers from DynamoDB

The React application and MySQL accounts/history remain unchanged. New messages and retries now retrieve prepared answers from DynamoDB, without any AI provider calls. The MySQL `faq_answers` table is retained but is no longer the runtime answer source. Historical replies remain unchanged.

## Local configuration

Install backend dependencies with `npm install` in `server`. Keep these non-secret settings in `server/.env`:

```dotenv
AWS_PROFILE=company-support-dev
AWS_REGION=us-east-1
DYNAMODB_FAQ_TABLE=company_support_faq
```

Authenticate as the non-root IAM user with the table-specific read-only policy:

```powershell
aws login --profile company-support-dev --region us-east-1
aws sts get-caller-identity --profile company-support-dev --query Arn --output text
```

Confirm the ARN ends in `:user/company-support-dev`. Do not replace this profile with root credentials. The SDK uses local AWS profile credentials; AWS keys are not stored in React, source code, or `.env`. Sessions expire and require renewed sign-in. In a hosted deployment, use an appropriate workload role and omit the local `AWS_PROFILE` setting.

The existing read-only policy needs `dynamodb:Scan`, `dynamodb:GetItem`, and `dynamodb:DescribeTable` on the specific table. Runtime lookup currently uses only Scan; no writes or resource creation occur.

## Matching and authorization

The existing session validation attaches the authenticated account to the request. The reply function checks this account before any DynamoDB request. Guests receive a fixed sign-in message and keep access to their own chat history. Invalid or expired account cookies still return 401. New messages and retries call the same reply function and keep existing chat ownership checks.

This demonstration allows registered authenticated accounts; signup does not verify actual employment. Do not put real confidential policies into this app until employee verification is implemented.

For the 20-record dataset, each authenticated question performs a consistent paginated Scan filtered to `isActive=true` and `accessLevel=employee`. The service also checks these flags locally and rejects missing/empty answers. It follows LastEvaluatedKey even on an empty filtered page. A cap of 1000 evaluated items prevents unbounded scanning and returns an error rather than a partial answer when exceeded. Scans incur reads across evaluated items, including those filtered out. There is no cache, so deactivated records are not intentionally served from stale application memory.

Matching first compares normalized questions and alternative phrases. Otherwise it ranks lexical query coverage (80%) and phrase similarity (20%). At least 60% of meaningful question words and two words must match (one for a single-word query). Close candidates within 0.05, duplicate exact matches, and unrelated questions return the existing not-found response. These are initial lexical heuristics, not semantic understanding or a guarantee of correctness. Synonyms, negation and context-dependent follow-ups may need clearer wording. Saved answers are returned unchanged. Attachments remain stored but are not interpreted.

## Validation and start

Run from `server`:

```powershell
npm run test:dynamodb
npm run test:dynamodb-chat
npm run check:dynamodb
npm run test:dynamodb-live
npm start
```

Unit tests use local fictional fixtures and mocked AWS calls. The HTTP integration test uses isolated temporary MySQL accounts and cleans them up, while mocking DynamoDB. The check command performs real read-only SDK calls and checks the expected initial 20 active employee records. Existing auth/history scripts remain available. The seed data is fictional, not company-approved real policy.

The optional `test:dynamodb-live` command runs the HTTP integration checks with real DynamoDB reads (including laptop, password, phishing, vacation, expenses and retry) and temporary MySQL test accounts. AWS reads may incur charges. It does not modify DynamoDB records. The outage case remains simulated. For browser testing, start React with `npm start` in `chat_bot`, then sign up or log in at `http://localhost:3000`. Guest messages receive the sign-in prompt.

The backend returns a generic 503 if AWS credentials expire, permissions fail, or DynamoDB is unavailable. It does not silently fall back to MySQL or an AI provider. Saved user questions remain in history when answer lookup fails.
