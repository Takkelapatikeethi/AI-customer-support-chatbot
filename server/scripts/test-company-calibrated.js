// Replays saved REAL scores through HTTP/chat/retry with the enabled calibration.
// No query embedding or text-generation API requests are permitted in this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');
const { pool } = require('../database');
const E = require('../company-embeddings');
const { Embeddings } = require('openai/resources/embeddings');
const report = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'reports', 'step6-retrieval-evaluation.json'), 'utf8'));
const originalSearch = E.searchCompanyKnowledgeSemantic;
const originalCreate = Embeddings.prototype.create;
let forbiddenApiCalls = 0;
let semanticCalls = 0;
let server;
let candidates;
const email = `calibrated-test-${randomBytes(8).toString('hex')}@example.com`;
const token = randomBytes(32).toString('hex');
const guestEmail = `guest-${createHash('sha256').update(token).digest('hex')}@chatbot.invalid`;
Embeddings.prototype.create = async () => { forbiddenApiCalls++; throw new Error('No extra embedding calls authorized.'); };
E.searchCompanyKnowledgeSemantic = async (query, { limit }) => {
  semanticCalls++;
  const item = report.report.find((entry) => entry.query === query);
  assert.ok(item, 'Only saved evaluation questions may be replayed');
  const threshold = E.getMinSimilarity();
  return item.semanticAll.filter((row) => row.similarity >= threshold && candidates.some((candidate) => String(candidate.id) === String(row.id)))
    .slice(0, limit).map((row) => ({ ...candidates.find((candidate) => String(candidate.id) === String(row.id)), similarity: row.similarity }));
};
const { app } = require('../server');

(async () => {
  try {
    assert.equal(process.env.COMPANY_KNOWLEDGE_SEMANTIC_ENABLED, 'true');
    assert.equal(E.getMinSimilarity(), 0.30);
    candidates = await E.loadSemanticCandidates();
    assert.equal(candidates.length, 20);
    app.locals.generateReply = async (history, context) => {
      const question = history[history.length - 1].content;
      return question === 'What is 2 + 2?' ? '4' : question === 'What is the capital of France?' ? 'Paris' :
        question === 'Explain photosynthesis.' ? 'Plants convert light into chemical energy.' : 'Mock answer using the selected company references.';
    };
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, body, cookie, guest) => {
      const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: {
        'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(guest ? { 'X-Chat-Token': guest } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const account = await request('/api/auth/signup', { name: 'Calibrated Test', email, password: 'calibrated-test-password-123' });
    assert.equal(account.status, 201);
    let first;
    for (const item of report.report) {
      const response = await request('/message', { text: item.query }, account.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(response.data.sources.map((row) => String(row.id)), item.hybrid.map((row) => String(row.id)));
      if (item.expectedTargets.length) assert.ok(response.data.sources.some((row) => item.expectedTargets.includes(row.title)));
      else assert.deepEqual(response.data.sources, []);
      first ||= response.data;
    }
    console.log('PASS: Enabled 0.30 configuration reproduces all 13 real-score hybrid rankings through authenticated HTTP chat');
    console.log('PASS: All ten company cases retain an expected topic; all three general cases have no company sources');
    const history = await request(`/api/chats/${first.sessionId}/messages`, null, account.cookie);
    const beforeRetry = semanticCalls;
    const retry = await request(`/api/chats/${first.sessionId}/messages/${history.data.messages[1].message_id}/retry`, {}, account.cookie);
    assert.equal(retry.status, 200);
    assert.equal(semanticCalls, beforeRetry + 1);
    assert.deepEqual(retry.data.sources.map((row) => String(row.id)), report.report[0].hybrid.map((row) => String(row.id)));
    console.log('PASS: Retry uses the same calibrated real-score retrieval and source metadata');
    const beforeGuest = semanticCalls;
    const guest = await request('/message', { text: report.report[0].query }, null, token);
    assert.equal(guest.status, 200);
    assert.deepEqual(guest.data.sources, []);
    assert.equal(semanticCalls, beforeGuest);
    assert.equal(forbiddenApiCalls, 0);
    assert.equal((await E.loadSemanticCandidates()).length, 20);
    console.log('PASS: Guest isolation and all 20 current vectors remain intact; zero additional API calls');
  } catch (error) { console.error('Calibrated replay test failed:', error.code || error.message); process.exitCode = 1; }
  finally {
    E.searchCompanyKnowledgeSemantic = originalSearch;
    Embeddings.prototype.create = originalCreate;
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.execute('DELETE FROM users WHERE email IN (?,?)', [email, guestEmail]);
    await pool.end();
  }
})();
