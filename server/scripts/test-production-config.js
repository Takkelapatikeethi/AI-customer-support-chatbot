const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { getConfig } = require('../production-config');
const { installSecurity, createChatLimiter } = require('../security');
const production = { NODE_ENV: 'production', APP_ORIGIN: 'https://support.example.com', AUTH_PASSWORD_RESET_ENABLED: 'false' };

test('production requires HTTPS origin and rejects local domains', () => {
  for (const origin of [undefined, 'http://support.example.com', 'https://localhost', 'https://127.0.0.1', 'https://support.example.com/path']) {
    assert.throws(() => getConfig({ ...production, APP_ORIGIN: origin }));
  }
  assert.equal(getConfig(production).production, true);
});
test('production rejects local AWS profile and validates trusted proxy setting', () => {
  assert.throws(() => getConfig({ ...production, AWS_PROFILE: 'root-profile' }));
  for (const value of ['true', '-1', '4', '1.5']) assert.throws(() => getConfig({ ...production, TRUST_PROXY_HOPS: value }));
  assert.equal(getConfig({ ...production, TRUST_PROXY_HOPS: '1' }).trustProxyHops, 1);
});
test('email reset must be configured or explicitly disabled in production', () => {
  assert.throws(() => getConfig({ ...production, AUTH_PASSWORD_RESET_ENABLED: 'true' }));
  assert.equal(getConfig({ ...production, AUTH_PASSWORD_RESET_ENABLED: 'true', RESEND_API_KEY: 'mock', AUTH_EMAIL_FROM: 'support@example.com' }).resetEnabled, true);
  assert.equal(getConfig(production).resetEnabled, false);
});
test('security middleware enforces HTTPS and sets response security headers', async () => {
  const app = express();
  installSecurity(app, getConfig({ ...production, TRUST_PROXY_HOPS: '1' }));
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/check', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/check')).status, 426);
    assert.equal((await fetch(base + '/health/live')).status, 200);
    const secure = await fetch(base + '/api/check', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(secure.status, 200);
    assert.equal(secure.headers.get('x-powered-by'), null);
    assert.equal(secure.headers.get('x-content-type-options'), 'nosniff');
    assert.match(secure.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(secure.headers.get('strict-transport-security'), /max-age=31536000/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('chat limit shares an account budget across messages and retries', async () => {
  const app = express();
  const limiter = createChatLimiter();
  app.use((req, res, next) => { req.chatAccount = { id: 1 }; next(); });
  app.post(['/message', '/retry'], limiter, (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 20; i++) assert.equal((await fetch(base + '/message', { method: 'POST' })).status, 200);
    const blocked = await fetch(base + '/retry', { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal((await blocked.json()).reply, 'Too many messages. Please wait a minute and try again.');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
