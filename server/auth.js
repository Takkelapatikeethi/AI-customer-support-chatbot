const { randomBytes, createHash, scrypt: derive, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { pool } = require('./database');
const scrypt = promisify(derive);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cookieName = 'chatbot_session';
const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const attempts = new Map();
function limit(req, res, next) {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
  const key = req.ip;
  const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  attempts.set(key, item);
  if (++item.count > 30) return res.status(429).json({ reply: 'Too many attempts. Try again in 15 minutes.' });
  next();
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function matches(password, stored) {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(Buffer.from(key, 'hex'), await scrypt(password, salt, 64));
}
const validPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const emailOf = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
function setCookie(res, value, maxAge) {
  res.cookie(cookieName, value, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge });
}
async function newSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO account_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))', [hash(token), userId]);
  setCookie(res, token, 7 * 86400000);
}
async function account(req) {
  const token = sessionToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await pool.execute('SELECT u.id, u.username, u.email FROM account_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW()', [hash(token)]);
  return rows[0] || null;
}
async function initializeAuth() {
  // Additive tables keep existing guest users and chat history intact.
  await pool.query(`CREATE TABLE IF NOT EXISTS account_credentials (user_id INT PRIMARY KEY, password_hash VARCHAR(200) NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS account_sessions (token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX (expires_at)) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`);
}
function installAuth(app) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin') && req.get('Origin') !== origin) return res.status(403).json({ reply: 'Request origin is not allowed.' });
    next();
  });
  const route = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (error) { console.error('Account request failed:', error.code || 'AUTH_ERROR'); res.status(503).json({ reply: 'Account service unavailable. Please try again.' }); }
  };
  app.get('/api/auth/me', route(async (req, res) => res.json({ user: await account(req) })));
  app.post('/api/auth/signup', limit, route(async (req, res) => {
    const email = emailOf(req.body.email);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@chatbot.invalid') || !validPassword(req.body.password)) return res.status(400).json({ reply: 'Enter a name, valid email, and a password of 12–128 characters.' });
    const password = await passwordHash(req.body.password);
    const db = await pool.getConnection();
    let id;
    try {
      await db.beginTransaction();
      const [result] = await db.execute('INSERT INTO users (username,email) VALUES (?,?)', [name, email]);
      id = result.insertId;
      await db.execute('INSERT INTO account_credentials (user_id,password_hash) VALUES (?,?)', [id, password]);
      await db.commit();
    } catch (err) {
      await db.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ reply: 'Unable to create this account. Try logging in or resetting your password.' });
      throw err;
    } finally { db.release(); }
    await newSession(res, id);
    res.status(201).json({ user: { id, username: name, email } });
  }));
  app.post('/api/auth/login', limit, route(async (req, res) => {
    if (!validPassword(req.body.password)) return res.status(401).json({ reply: 'Email or password is incorrect.' });
    const [rows] = await pool.execute('SELECT u.id,u.username,u.email,c.password_hash FROM users u JOIN account_credentials c ON c.user_id=u.id WHERE u.email=?', [emailOf(req.body.email)]);
    const user = rows[0];
    // Perform the same expensive derivation for unknown accounts.
    const ok = await matches(req.body.password, user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !ok) return res.status(401).json({ reply: 'Email or password is incorrect.' });
    await newSession(res, user.id);
    delete user.password_hash;
    res.json({ user });
  }));
  app.post('/api/auth/logout', route(async (req, res) => {
    const token = sessionToken(req);
    if (token) await pool.execute('DELETE FROM account_sessions WHERE token_hash=?', [hash(token)]);
    setCookie(res, '', 0);
    res.json({ ok: true });
  }));
  app.post('/api/auth/forgot', limit, route(async (req, res) => {
    if (!app.locals.sendResetEmail && (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM)) return res.status(503).json({ reply: 'Password reset email is not configured yet. Contact the website administrator.' });
    const [rows] = await pool.execute('SELECT u.id,u.email FROM users u JOIN account_credentials c ON c.user_id=u.id WHERE u.email=?', [emailOf(req.body.email)]);
    if (rows.length) {
      const token = randomBytes(32).toString('hex');
      await pool.execute('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [hash(token), rows[0].id]);
      const url = `${origin}/#reset=${token}`;
      if (app.locals.sendResetEmail) await app.locals.sendResetEmail(rows[0].email, url);
      else {
        const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: rows[0].email, subject: 'Reset your password', text: `Reset your password within 30 minutes: ${url}\nIf you did not request this, ignore this email.` }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Email delivery failed');
      }
    }
    res.json({ reply: 'If an account exists, a password reset link will be sent to its email address.' });
  }));
  app.post('/api/auth/reset', limit, route(async (req, res) => {
    if (!validPassword(req.body.password) || typeof req.body.token !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.token)) return res.status(400).json({ reply: 'Use a valid reset link and a password of 12–128 characters.' });
    const password = await passwordHash(req.body.password);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const [rows] = await db.execute('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>NOW() FOR UPDATE', [hash(req.body.token)]);
      if (!rows.length) { await db.rollback(); return res.status(400).json({ reply: 'Reset link is invalid or expired.' }); }
      const id = rows[0].user_id;
      await db.execute('UPDATE account_credentials SET password_hash=? WHERE user_id=?', [password, id]);
      await db.execute('DELETE FROM account_sessions WHERE user_id=?', [id]);
      await db.execute('DELETE FROM password_resets WHERE user_id=?', [id]);
      await db.commit();
      res.json({ reply: 'Password updated. Log in with your new password.' });
    } catch (err) { await db.rollback(); throw err; } finally { db.release(); }
  }));
}
module.exports = { installAuth, initializeAuth, account, sessionToken, origin };
