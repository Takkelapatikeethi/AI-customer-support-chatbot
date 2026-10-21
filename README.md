# Chatbot Project

React chatbot frontend with an Express backend that calls the OpenAI API.

## Setup

1. Install backend dependencies:

```bash
cd server
npm install
```

2. Create `server/.env` from `server/.env.example`:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=
PORT=5000
```

3. Install frontend dependencies:

```bash
cd ../chat_bot
npm install
```

## Run

The backend connects to AWS RDS MySQL using the `DB_*` settings in
`server/.env`. Copy the database settings from `server/.env.example` and set
your endpoint, username, and password. Keep the AWS CA certificate path set
to `../Database/certs/us-east-1-bundle.pem` for verified TLS.

From `server`, run `npm run check:db` to verify the connection and list tables.
The backend checks database connectivity before accepting HTTP requests.
`GET /health/db` returns HTTP 200 when connected or 503 when unavailable.
Other backend modules can use `const { pool } = require("./database")` and
`await pool.execute("SELECT * FROM users WHERE id = ?", [userId])`.

Chat history is saved automatically in `chat_sessions` and `chat_messages`.
Use the Chat history sidebar to reopen a conversation, or New chat to start
another. The active conversation restores after a refresh. A random token in
browser local storage provides access to that browser's chats; there is no
account sign-in or cross-device recovery. Clearing browser storage loses access.
Chats made before this feature was enabled cannot be recovered.

The backend requires an `X-Chat-Token` header (64 lowercase hexadecimal
characters) for `POST /message`, `GET /api/chats`, and
`GET /api/chats/:sessionId/messages`. The React app supplies it automatically.
`POST /message` accepts an optional `sessionId` to continue a conversation and
returns the saved `sessionId`. Questions are retained if the AI provider fails;
provider errors are shown as alerts rather than saved assistant messages.
AI requests include the latest 40 stored messages, including uploaded text context.
The sidebar lists the latest 100 conversations for this browser.

For existing databases, apply `Database/migrations/003_message_attachments.sql`
once to preserve uploaded file names and text in conversation history. It has
already been applied to the connected RDS database.
Run `npm run test:history` from `server` to test the API against the configured
database with mocked AI replies. The test removes its own temporary guest data.

Start the backend:

```bash
cd server
npm start
```

Start the frontend in another terminal:

```bash
cd chat_bot
npm start
```

Open `http://localhost:3000`. The React app sends messages to
`http://localhost:5000/message`, and the backend keeps your OpenAI API key out
of the browser.

## Current OpenAI Notes

- The OpenAI integration lives in `server/server.js`.
- Keep `OPENAI_API_KEY` only in `server/.env`; `.env` files are ignored by Git.
- If the bot replies that quota is exceeded, the API key is working but the
  OpenAI account or project needs billing/credits.

## OpenRouter Option

OpenRouter keys usually start with `sk-or-v1-`. To use one, set your
`server/.env` like this:

```env
OPENAI_API_KEY=your_openrouter_key_here
OPENAI_MODEL=openai/gpt-5.4-nano
OPENAI_BASE_URL=https://openrouter.ai/api/v1
PORT=5000
```

The server will use the OpenAI Responses API for direct OpenAI keys and the
OpenAI-compatible chat endpoint when `OPENAI_BASE_URL` points to OpenRouter.
