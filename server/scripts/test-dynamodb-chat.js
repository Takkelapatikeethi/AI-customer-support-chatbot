// Real MySQL sessions; --live also reads DynamoDB. Cleans up its own test accounts.
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');
const { app } = require('../server');
const { pool } = require('../database');
const { initializeAuth } = require('../auth');
const { initializeHistory } = require('../chat-history');
const { createDynamoReply, loadCompanyAnswers, SIGN_IN_REQUIRED } = require('../dynamodb-answers');
const live = process.argv.includes('--live');
const { NO_ANSWER } = require('../database-answers');
const records = require('../../Database/seeds/company_support_faq.synthetic.json');
const prefix = `dynamo-test-${randomBytes(8).toString('hex')}`;
const emails = [`${prefix}@example.com`, `${prefix}-other@example.com`];
const guest = randomBytes(32).toString('hex');
emails.push(`guest-${createHash('sha256').update(guest).digest('hex')}@chatbot.invalid`);
let server;

(async () => {
  try {
    await initializeAuth();
    await initializeHistory();
    let reads = 0;
    let unavailable = false;
    app.locals.generateReply = (history, context) => createDynamoReply(history, {
      ...context,
      loadAnswers: async () => {
        reads++;
        if (unavailable) throw new Error('Private credential error details');
        return live ? loadCompanyAnswers() : records;
      },
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, body, cookie, guestToken) {
      const response = await fetch(base + route, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(guestToken ? { 'X-Chat-Token': guestToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    const signup = await request('/api/auth/signup', { email: emails[0], name: 'Dynamo Test', password: 'test-password-123' });
    assert.equal(signup.status, 201);
    const cookie = signup.cookie;
    const laptop = records.find(record => record.id === 'IT-002');
    const message = await request('/message', { text: 'My work computer is broken' }, cookie);
    assert.equal(message.status, 200);
    assert.equal(message.data.reply, laptop.answer);
    assert.equal(reads, 1);
    const id = message.data.sessionId;
    const chat = await request(`/api/chats/${id}/messages`, null, cookie);
    assert.deepEqual(chat.data.messages.map(item => item.role), ['user', 'assistant']);
    const replyId = chat.data.messages[1].message_id;
    console.log('PASS: authenticated account receives DynamoDB answer and MySQL stores conversation');
    const retried = await request(`/api/chats/${id}/messages/${replyId}/retry`, {}, cookie);
    assert.equal(retried.status, 200);
    assert.equal(reads, 2);
    assert.equal((await request(`/api/chats/${id}/messages`, null, cookie)).data.messages.at(-1).content, laptop.answer);
    console.log('PASS: retry uses same retrieval and saves the stored answer unchanged');
    const beforeGuest = reads;
    const guestReply = await request('/message', { text: laptop.question }, null, guest);
    assert.equal(guestReply.status, 200);
    assert.equal(guestReply.data.reply, SIGN_IN_REQUIRED);
    assert.equal(reads, beforeGuest);
    const guestChat = await request(`/api/chats/${guestReply.data.sessionId}/messages`, null, null, guest);
    const guestId = guestChat.data.messages[1].message_id;
    assert.equal((await request(`/api/chats/${guestReply.data.sessionId}/messages/${guestId}/retry`, {}, null, guest)).status, 200);
    assert.equal(reads, beforeGuest);
    assert.equal((await request('/message', { text: laptop.question })).status, 401);
    assert.equal((await request('/message', { text: laptop.question }, `chatbot_session=${'a'.repeat(64)}`, guest)).status, 401);
    console.log('PASS: guest messages/retries never read company data; missing and invalid sessions rejected');
    const unknown = await request('/message', { text: 'Explain photosynthesis' }, cookie);
    assert.equal(unknown.data.reply, NO_ANSWER);
    const other = await request('/api/auth/signup', { email: emails[1], name: 'Other', password: 'test-password-123' });
    assert.equal((await request(`/api/chats/${id}/messages/${replyId}/retry`, {}, other.cookie)).status, 404);
    console.log('PASS: unknown questions fall back and another account cannot retry private chats');
    for (const recordId of ['IT-001', 'SEC-002', 'HR-003', 'FIN-001']) {
      const record = records.find(item => item.id === recordId);
      const response = await request('/message', { sessionId: id, text: record.question }, cookie);
      assert.equal(response.status, 200);
      assert.equal(response.data.reply, record.answer);
    }
    console.log('PASS: password reset, phishing, vacation and expense questions return stored answers');
    unavailable = true;
    const failed = await request('/message', { sessionId: id, text: 'VPN problem' }, cookie);
    assert.equal(failed.status, 503);
    assert.equal(failed.data.saved, true);
    assert.ok(!JSON.stringify(failed.data).includes('credential'));
    assert.equal((await request(`/api/chats/${id}/messages/${replyId}/retry`, {}, cookie)).status, 503);
    assert.equal((await request(`/api/chats/${id}/messages`, null, cookie)).data.messages.at(-1).role, 'user');
    console.log('PASS: DynamoDB failure and retry failure return safe errors and preserve the question');
    console.log(live ? 'Live DynamoDB reads verified; outage simulated. Test accounts cleaned up on exit.' : 'DynamoDB mocked; test accounts cleaned up on exit.');
  } catch (error) {
    console.error('DynamoDB chat test failed:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { await pool.execute('DELETE FROM users WHERE email IN (?,?,?)', emails); }
    finally { await pool.end(); }
  }
})();
