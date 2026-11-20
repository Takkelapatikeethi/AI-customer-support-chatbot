FROM node:24.22.3-alpine AS frontend
WORKDIR /app/chat_bot
COPY chat_bot/package*.json ./
RUN npm ci
COPY chat_bot/ ./
RUN npm run build

FROM node:24.22.3-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production PORT=5000
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
COPY Database/certs/ /app/Database/certs/
COPY --from=frontend /app/chat_bot/build/ /app/chat_bot/build/
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:5000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
