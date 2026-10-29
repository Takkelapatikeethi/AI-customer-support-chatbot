// Semantic/chat integration with real auth/history/FULLTEXT and MOCK embeddings.
// Fixture vectors prove routing/threshold contracts, not real model quality.
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');
const names = ['EMBEDDING_MODEL', 'EMBEDDING_DIMENSIONS', 'COMPANY_KNOWLEDGE_MIN_SIMILARITY', 'COMPANY_KNOWLEDGE_SEMANTIC_ENABLED'];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
process.env.EMBEDDING_DIMENSIONS = '32';
process.env.COMPANY_KNOWLEDGE_MIN_SIMILARITY = '0.8'; // Fixture-only, NOT real calibration.
process.env.COMPANY_KNOWLEDGE_SEMANTIC_ENABLED = 'true';
const { Embeddings } = require('openai/resources/embeddings');
const originalCreate = Embeddings.prototype.create;
const { app } = require('../server');
const { pool } = require('../database');
const { cases } = require('./compare-company-retrieval');
const { getEmbeddingSettings, contentHash } = require('../company-embeddings');
const originalExecute = pool.execute.bind(pool);
const email = `semantic-test-${randomBytes(8).toString('hex')}@example.com`;
const token = randomBytes(32).toString('hex');
const guestEmail = `guest-${createHash('sha256').update(token).digest('hex')}@chatbot.invalid`;
let server;
let checks = 0;
const pass = (message) => { checks++; console.log(`PASS: ${message}`); };

(async () => {
  try {
    const settings = getEmbeddingSettings();
    const [rows] = await originalExecute('SELECT *, source_name AS sourceName, source_url AS sourceUrl FROM company_knowledge ORDER BY id');
    const before = JSON.stringify(rows);
    const [[embeddingCount]] = await originalExecute('SELECT COUNT(*) AS total FROM company_knowledge_embeddings');
    const basis = (index) => Array.from({ length: 32 }, (_, i) => i === index ? 1 : 0);
    const candidates = rows.filter((row) => row.is_active === 1 && row.access_level === 'employee').map((row, index) => ({ ...row,
      embedding: basis(index), embedding_model: settings.model, embedding_dimensions: 32,
      content_hash: contentHash(row), provider_hash: settings.providerHash }));
    let semanticReads = 0;
    let fulltextReads = 0;
    const embeddingQueries = [];
    let failEmbeddings = false;
    pool.execute = async (sql, values) => {
      if (sql.includes('JOIN company_knowledge_embeddings e')) {
        semanticReads++;
        assert.match(sql, /k.is_active = 1 AND k.access_level = 'employee'/);
        return [candidates, []];
      }
      if (sql.includes('FROM company_knowledge') && sql.includes('MATCH(')) fulltextReads++;
      return originalExecute(sql, values);
    };
    Embeddings.prototype.create = async function (body) {
      embeddingQueries.push(body.input);
      if (failEmbeddings) throw new Error('Mock embedding provider unavailable');
      const item = cases.find((entry) => entry.query === body.input);
      const target = item?.targets[0];
      const index = target ? candidates.findIndex((row) => row.title === target) : 31;
      assert.ok(index >= 0);
      return { model: settings.model, data: [{ embedding: basis(index) }] };
    };
    let generated;
    app.locals.generateReply = async (history, context) => { generated = { history, context }; return 'Mocked grounded/general reply'; };
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { body, cookie, guest } = {}) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
        'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(guest ? { 'X-Chat-Token': guest } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const signup = await request('/api/auth/signup', { body: { name: 'Semantic Test', email, password: 'semantic-test-password-123' } });
    assert.equal(signup.status, 201);
    const cookie = signup.cookie;
    let first;
    for (const item of cases) {
      const response = await request('/message', { cookie, body: { text: item.query } });
      assert.equal(response.status, 200);
      if (item.targets.length) {
        assert.ok(response.data.sources.some((source) => item.targets.includes(source.title)));
        assert.ok(generated.context.knowledge.some((row) => item.targets.includes(row.title)));
        assert.ok(response.data.sources.length <= 5);
        first ||= { sessionId: response.data.sessionId, query: item.query };
      } else {
        assert.deepEqual(response.data.sources, []);
        assert.deepEqual(generated.context.knowledge, []);
      }
    }
    pass('Ten paraphrases flow through hybrid grounding; three unrelated questions have no company sources (fixture vectors only)');
    const history = await request(`/api/chats/${first.sessionId}/messages`, { cookie });
    const beforeRetry = embeddingQueries.length;
    const retryPath = `/api/chats/${first.sessionId}/messages/${history.data.messages[1].message_id}/retry`;
    const retry = await request(retryPath, { cookie, body: {} });
    assert.equal(retry.status, 200);
    assert.equal(embeddingQueries.length, beforeRetry + 1);
    assert.equal(embeddingQueries[embeddingQueries.length - 1], first.query);
    assert.ok(retry.data.sources.some((source) => source.title === 'Company Laptop Replacement'));
    pass('Retry shares hybrid retrieval, threshold, sources, and existing persistence');

    const beforeGuest = { semanticReads, fulltextReads, calls: embeddingQueries.length };
    const guest = await request('/message', { guest: token, body: { text: 'My work machine stopped functioning.' } });
    assert.equal(guest.status, 200); assert.deepEqual(guest.data.sources, []);
    assert.equal(generated.context, undefined);
    const guestHistory = await request(`/api/chats/${guest.data.sessionId}/messages`, { guest: token });
    await request(`/api/chats/${guest.data.sessionId}/messages/${guestHistory.data.messages[1].message_id}/retry`, { guest: token, body: {} });
    assert.deepEqual({ semanticReads, fulltextReads, calls: embeddingQueries.length }, beforeGuest);
    assert.equal((await request(retryPath, { guest: token, body: {} })).status, 404);
    pass('Guest message/retry never read company knowledge or call embeddings; ownership remains enforced');

    failEmbeddings = true;
    const fallback = await request('/message', { cookie, body: { text: 'How do I reset my company password?' } });
    assert.equal(fallback.status, 200);
    assert.ok(fallback.data.sources.some((source) => source.title === 'Company Password Reset'));
    pass('Embedding-provider failure preserves FULLTEXT-grounded answers');
    app.locals.generateReply = async () => { throw Object.assign(new Error('Mock AI failure'), { status: 429 }); };
    const failed = await request('/message', { cookie, body: { text: 'How do I reset my company password?' } });
    assert.equal(failed.status, 429); assert.equal(failed.data.saved, true);
    pass('Existing generation-provider failure preserves saved question');

    const [after] = await originalExecute('SELECT *, source_name AS sourceName, source_url AS sourceUrl FROM company_knowledge ORDER BY id');
    const [[afterCount]] = await originalExecute('SELECT COUNT(*) AS total FROM company_knowledge_embeddings');
    assert.equal(JSON.stringify(after), before);
    assert.equal(String(afterCount.total), String(embeddingCount.total));
    pass('Knowledge and stored embeddings remain unchanged; no external requests');
    console.log(`${checks} semantic/chat integration groups passed. Scores are fixtures, not real evaluation results.`);
  } catch (error) { console.error('Semantic chat test failed:', error.code || error.message); process.exitCode = 1; }
  finally {
    pool.execute = originalExecute;
    Embeddings.prototype.create = originalCreate;
    if (server) await new Promise((resolve) => server.close(resolve));
    await originalExecute('DELETE FROM users WHERE email IN (?,?)', [email, guestEmail]);
    await pool.end();
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
})();
