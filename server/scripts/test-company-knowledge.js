// Real HTTP/account/FULLTEXT integration checks. Never writes knowledge records.
// Negative filter/limit fixtures use a read-only derived SELECT, not seed changes.
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');
const { app } = require('../server');
const { pool } = require('../database');
const { searchCompanyKnowledge } = require('../company-knowledge');

const email = `knowledge-test-${randomBytes(8).toString('hex')}@example.com`;
const originalExecute = pool.execute.bind(pool);
let server;
let checks = 0;
let aiCalls = 0;
const pass = (name) => { checks++; console.log(`PASS: ${name}`); };
const snapshot = async () => {
  const [rows] = await originalExecute('SELECT * FROM company_knowledge ORDER BY id');
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
};

(async () => {
  try {
    const before = await snapshot();
    const [[count]] = await originalExecute('SELECT COUNT(*) AS total FROM company_knowledge');
    assert.equal(Number(count.total), 20);
    app.locals.generateReply = async () => { aiCalls++; throw new Error('AI must not be called'); };
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { body, cookie, guest } = {}) => {
      const response = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(guest ? { 'X-Chat-Token': guest } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control') };
    };
    const signup = await request('/api/auth/signup', { body: { name: 'Knowledge Test', email, password: 'knowledge-test-password-123' } });
    assert.equal(signup.status, 201);
    const login = await request('/api/auth/login', { body: { email, password: 'knowledge-test-password-123' } });
    assert.equal(login.status, 200);
    const cookie = login.cookie;
    pass('Existing signup/login produce a usable account session');

    assert.equal((await request('/api/knowledge/search?q=laptop')).status, 401);
    assert.equal((await request('/api/knowledge/search?q=laptop', { guest: randomBytes(32).toString('hex') })).status, 401);
    assert.equal((await request('/api/knowledge/search?q=laptop', { cookie: `chatbot_session=${randomBytes(32).toString('hex')}` })).status, 401);
    pass('Anonymous, browser-token guests, and invalid sessions are rejected');

    for (const query of ['', '?q=', '?q=%20%20', `?q=${'x'.repeat(501)}`, '?q=laptop&q=password']) {
      assert.equal((await request('/api/knowledge/search' + query, { cookie })).status, 400);
    }
    for (const limit of ['0', '-1', '11', '1.5', 'abc', '1&limit=2']) {
      assert.equal((await request('/api/knowledge/search?q=laptop&limit=' + limit, { cookie })).status, 400);
    }
    await assert.rejects(searchCompanyKnowledge(' '), (err) => err.status === 400);
    await assert.rejects(searchCompanyKnowledge('laptop', { limit: 11 }), (err) => err.status === 400);
    pass('Missing/empty/long/repeated queries and invalid limits are rejected');

    const direct = {
      password: 'Company Password Reset',
      laptop: 'Company Laptop Replacement',
      phishing: 'Phishing Email Reporting',
      vacation: 'Vacation Request and Approval Process',
      expense: 'Expense Reimbursement Submission',
      VPN: 'Company VPN Troubleshooting',
    };
    const directResults = {};
    for (const [query, expected] of Object.entries(direct)) {
      const response = await request('/api/knowledge/search?q=' + encodeURIComponent(query), { cookie });
      assert.equal(response.status, 200);
      assert.equal(response.cache, 'no-store');
      assert.equal(response.data.query, query);
      assert.equal(response.data.count, response.data.results.length);
      assert.ok(response.data.count <= 5);
      assert.ok(response.data.results.some((row) => row.title === expected));
      for (const row of response.data.results) assert.deepEqual(Object.keys(row).sort(), ['id', 'category', 'title', 'content', 'sourceName', 'sourceUrl', 'department'].sort());
      directResults[query] = response.data.results.map((row) => row.title);
    }
    const trimmed = await request('/api/knowledge/search?q=%20laptop%20&limit=1', { cookie });
    assert.equal(trimmed.data.query, 'laptop');
    assert.equal(trimmed.data.count, 1);
    assert.equal(trimmed.data.results[0].title, 'Company Laptop Replacement');
    pass('Signed-in HTTP searches return relevant FULLTEXT results, safe fields, and trimmed queries');

    const naturalResults = {};
    for (const query of [
      'My computer is broken and I need another one',
      'I clicked a suspicious email',
      'I cannot sign into my account',
      'I need some days off',
      'I paid for something during a business trip',
    ]) {
      const response = await request('/api/knowledge/search?q=' + encodeURIComponent(query), { cookie });
      assert.equal(response.status, 200);
      naturalResults[query] = response.data.results.map((row) => row.title);
    }
    pass('Natural-language queries run unchanged through the HTTP endpoint');

    // Reuse the production SQL with constant relevance against SELECT-only fixtures.
    // This exercises MySQL filtering/LIMIT without changing any stored knowledge.
    const fixtures = [
      { id: 1, active: 0, access: 'employee' },
      { id: 2, active: 1, access: 'admin' },
      ...Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, active: 1, access: 'employee' })),
    ].map((row) => `SELECT ${row.id} AS id, 'Test' AS category, 'Fixture' AS title,
      'Synthetic fixture' AS content, 'Fixture source' AS source_name,
      NULL AS source_url, 'Test' AS department,
      ${row.active} AS is_active, '${row.access}' AS access_level`).join(' UNION ALL ');
    pool.execute = async (sql, values) => {
      if (!sql.includes('FROM company_knowledge')) return originalExecute(sql, values);
      assert.match(sql, /WHERE is_active = 1 AND access_level = 'employee'/);
      assert.match(sql, /ORDER BY MATCH\(title, content, keywords\) AGAINST \(\? IN NATURAL LANGUAGE MODE\) DESC/);
      assert.deepEqual(values.slice(0, 2), ["laptop' OR 1=1 --", "laptop' OR 1=1 --"]);
      const fixtureSql = sql.replace('FROM company_knowledge', `FROM (${fixtures}) AS company_knowledge`)
        .replace(/MATCH\(title, content, keywords\) AGAINST \(\? IN NATURAL LANGUAGE MODE\)/g, '(1.0)');
      return originalExecute(fixtureSql, [values[2]]);
    };
    const filtered = await searchCompanyKnowledge("laptop' OR 1=1 --");
    assert.equal(filtered.length, 5);
    assert.ok(filtered.every((row) => Number(row.id) >= 100));
    const maximum = await searchCompanyKnowledge("laptop' OR 1=1 --", { limit: 10 });
    assert.equal(maximum.length, 10);
    pass('MySQL excludes inactive/non-employee fixtures; default/max limits hold and query input stays bound');
    pool.execute = async (sql, values) => {
      if (sql.includes('FROM company_knowledge')) throw Object.assign(new Error('Do not expose internal SQL'), { code: 'TEST_DATABASE_FAILURE' });
      return originalExecute(sql, values);
    };
    const failed = await request('/api/knowledge/search?q=laptop', { cookie });
    assert.equal(failed.status, 503);
    assert.equal(failed.data.reply, 'Company knowledge search is unavailable. Please try again.');
    pool.execute = originalExecute;
    pass('Database errors return a generic 503 without SQL details');

    await request('/api/auth/logout', { cookie, body: {} });
    assert.equal((await request('/api/knowledge/search?q=laptop', { cookie })).status, 401);
    assert.equal(await snapshot(), before);
    assert.equal(aiCalls, 0);
    pass('Logged-out sessions are rejected; all 20 knowledge records are unchanged; no AI calls');
    console.log(JSON.stringify({ checksPassed: checks, directResults, naturalResults }, null, 2));
  } catch (error) {
    console.error('Knowledge test failed:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    pool.execute = originalExecute;
    // Only this script's unique temporary account is removed (sessions cascade).
    await originalExecute('DELETE FROM users WHERE email=?', [email]);
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
})();
