const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { app } = require('../server');
const { pool } = require('../database');
const { initializeAuth } = require('../auth');
const { initializeHistory } = require('../chat-history');
const prefix = `auth-test-${randomBytes(8).toString('hex')}`;
const email = `${prefix}@example.com`;
let server;
(async () => {
  try {
    await initializeAuth();
    await initializeHistory();
    app.locals.generateReply = async () => 'Account test reply';
    let resetLink;
    app.locals.sendResetEmail = async (_, url) => { resetLink = url; };
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, body, cookie, origin) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], cookieHeader: response.headers.get('set-cookie') };
    };
    assert.equal((await request('/api/auth/signup', { name: 'Test', email, password: 'short' })).status, 400);
    const created = await request('/api/auth/signup', { name: 'Test', email, password: 'test-password-123' });
    assert.equal(created.status, 201); assert.match(created.cookieHeader, /HttpOnly/); assert.match(created.cookieHeader, /SameSite=Strict/i);
    const cookie = created.cookie;
    assert.equal((await request('/api/auth/me', null, cookie)).data.user.email, email);
    assert.equal((await request('/api/auth/login', { email, password: 'wrong-password-123' })).status, 401);
    const login = await request('/api/auth/login', { email: email.toUpperCase(), password: 'test-password-123' });
    assert.equal(login.status, 200);
    assert.equal((await request('/api/auth/signup', { name: 'Test', email, password: 'test-password-123' })).status, 409);
    const message = await request('/message', { text: 'Private account message' }, cookie);
    assert.equal(message.status, 200);
    assert.equal((await request('/api/chats', null, login.cookie)).data.sessions.length, 1);
    const other = await request('/api/auth/signup', { name: 'Other', email: `${prefix}-other@example.com`, password: 'another-password-123' });
    assert.equal(other.status, 201);
    assert.equal((await request(`/api/chats/${message.data.sessionId}/messages`, null, other.cookie)).status, 404);
    assert.equal((await request('/message', { text: 'Intrusion', sessionId: message.data.sessionId }, other.cookie)).status, 404);
    assert.equal((await request('/api/auth/logout', {}, cookie, 'https://untrusted.example')).status, 403);
    await request('/api/auth/forgot', { email }); assert.ok(resetLink);
    const token = resetLink.split('#reset=')[1];
    assert.equal((await request('/api/auth/reset', { token, password: 'changed-password-123' })).status, 200);
    assert.equal((await request('/api/auth/reset', { token, password: 'changed-password-123' })).status, 400);
    assert.equal((await request('/api/chats', null, cookie)).status, 401);
    assert.equal((await request('/api/auth/login', { email, password: 'test-password-123' })).status, 401);
    const renewed = await request('/api/auth/login', { email, password: 'changed-password-123' });
    assert.equal(renewed.status, 200);
    assert.equal((await request('/api/chats', null, renewed.cookie)).data.sessions.length, 1);
    await request('/api/auth/logout', {}, renewed.cookie);
    assert.equal((await request('/api/auth/me', null, renewed.cookie)).data.user, null);
    console.log('PASS: signup, validation, login, cookies, cross-session history, account isolation, origin protection, single-use reset, session revocation, logout. AI and reset email mocked; MySQL real.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await pool.execute('DELETE FROM users WHERE email IN (?,?)', [email, `${prefix}-other@example.com`]);
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
})();
