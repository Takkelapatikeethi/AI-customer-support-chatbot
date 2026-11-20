# Support Desk frontend

React with Vite and Vitest. Requires Node.js 24 LTS.

- `npm ci`: install locked dependencies.
- `npm start`: local development at http://localhost:3000.
- `npm test`: component tests.
- `npm run build`: production output in `build/`.
- `npm run preview`: local build preview, not a public production server.

Components containing JSX use `.jsx` filenames. CSS files are in `src/styles`. Local API calls default to http://localhost:5000; production defaults to the same origin. If needed, set the public `VITE_API_URL` at build time. Never put secrets in Vite environment variables.

See the root DEPLOYMENT.md for the recommended same-origin hosting configuration and authentication requirements.
