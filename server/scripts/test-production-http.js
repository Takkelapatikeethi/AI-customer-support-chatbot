// Production-mode HTTP checks: no AWS calls, no account creation, no database queries.
process.env.NODE_ENV = 'production';
process.env.APP_ORIGIN = 'https://support.example.com';
process.env.TRUST_PROXY_HOPS = '1';
process.env.AWS_PROFILE = '';
process.env.AUTH_PASSWORD_RESET_ENABLED = 'false';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app } = require('../server');
const { pool } = require('../database');
let server;

(async () => {
  try {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'X-Forwarded-Proto': 'https' };
    assert.equal((await fetch(base + '/')).status, 426);
    assert.equal((await fetch(base + '/health/live')).status, 200);
    const page = await fetch(base + '/', { headers });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Support Desk/);
    assert.ok(!html.includes('localhost:5000'));
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const assetPath = html.match(/src="([^"]+\.js)"/)[1];
    const asset = await fetch(base + assetPath, { headers });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.ok(!(await asset.text()).includes('localhost:5000'));
    const me = await fetch(base + '/api/auth/me', { headers });
    assert.deepEqual(await me.json(), { user: null, passwordResetEnabled: false });
    const post = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Origin: process.env.APP_ORIGIN }, body: '{}' };
    assert.equal((await fetch(base + '/api/auth/forgot', post)).status, 503);
    assert.equal((await fetch(base + '/message', post)).status, 401);
    assert.equal((await fetch(base + '/message', { ...post, headers: { ...post.headers, Origin: 'https://untrusted.example' } })).status, 403);
    const malformed = await fetch(base + '/message', { ...post, body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { reply: 'Invalid request body.' });
    console.log('PASS: HTTPS enforcement, production HTML/assets, cache/security headers, same-origin bundle, guest denial, origin checks, disabled reset and safe JSON errors.');
  } catch (error) {
    console.error('Production HTTP check failed:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})();
