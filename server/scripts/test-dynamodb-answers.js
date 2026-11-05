const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const records = require('../../Database/seeds/company_support_faq.synthetic.json');
const { pool } = require('../database');
const { NO_ANSWER } = require('../database-answers');
const { createDynamoReply, loadCompanyAnswers, matchCompanyAnswer, SIGN_IN_REQUIRED } = require('../dynamodb-answers');

after(() => pool.end());
const account = { id: 42 };

test('all 20 questions and 40 alternative phrases return the exact stored answers', () => {
  for (const record of records) {
    for (const question of [record.question, ...record.alternativePhrases]) {
      assert.equal(matchCompanyAnswer(question, records), record.answer, question);
    }
  }
});
test('normalizes case, punctuation and whitespace', () => {
  assert.equal(matchCompanyAnswer('  MY WORK COMPUTER IS BROKEN!!! ', records), records.find(r => r.id === 'IT-002').answer);
});
test('ranks keyword matches deterministically', () => {
  assert.equal(matchCompanyAnswer('broken laptop replacement', [...records].reverse()), records.find(r => r.id === 'IT-002').answer);
  assert.equal(matchCompanyAnswer('phishing email', records), records.find(r => r.id === 'SEC-002').answer);
});
test('unrelated and weak queries receive fallback', () => {
  for (const question of ['What is 2 + 2?', 'Explain photosynthesis', 'Capital of France', '', 'please', 'explain plant growth password']) {
    assert.equal(matchCompanyAnswer(question, records), NO_ANSWER, question);
  }
});
test('ambiguous questions receive fallback rather than arbitrary answers', () => {
  const first = records[0];
  assert.equal(matchCompanyAnswer(first.question, [first, { ...first, id: 'duplicate', answer: 'Different answer' }]), NO_ANSWER);
  assert.equal(matchCompanyAnswer('access', records), NO_ANSWER);
});
test('inactive, non-employee and empty answers cannot match', () => {
  for (const replacement of [{ isActive: false }, { accessLevel: 'admin' }, { answer: '' }]) {
    const record = { ...records[0], ...replacement };
    assert.equal(matchCompanyAnswer(record.question, [record]), NO_ANSWER);
  }
});
test('malformed optional search fields do not crash matching', () => {
  const record = { ...records[0], alternativePhrases: 'not an array', keywords: null };
  assert.equal(matchCompanyAnswer(record.question, [record]), record.answer);
  assert.equal(matchCompanyAnswer('unrelated biology topic', [record]), NO_ANSWER);
});
test('scan paginates even when a filtered page is empty and filters again locally', async () => {
  const calls = [];
  const db = { send: async command => {
    calls.push(command.input);
    return calls.length === 1
      ? { Items: [], ScannedCount: 1, LastEvaluatedKey: { id: 'page1' } }
      : { Items: [records[0], { ...records[1], isActive: false }, { ...records[2], accessLevel: 'admin' }], ScannedCount: 3 };
  } };
  assert.deepEqual(await loadCompanyAnswers(db), [records[0]]);
  assert.deepEqual(calls[1].ExclusiveStartKey, { id: 'page1' });
  assert.equal(calls[0].ConsistentRead, true);
  assert.equal(calls[0].ExpressionAttributeValues[':access'], 'employee');
  assert.equal(calls[0].ExpressionAttributeValues[':active'], true);
});
test('scan is bounded and refuses partial results', async () => {
  const db = { send: async () => ({ Items: [], ScannedCount: 1000, LastEvaluatedKey: { id: 'more' } }) };
  await assert.rejects(loadCompanyAnswers(db), { code: 'FAQ_SCAN_LIMIT' });
});
test('guests never invoke DynamoDB', async () => {
  let calls = 0;
  const loadAnswers = async () => { calls++; return records; };
  assert.equal(await createDynamoReply([{ role: 'user', content: records[0].question }], { loadAnswers }), SIGN_IN_REQUIRED);
  assert.equal(calls, 0);
});
test('authenticated reply uses the latest user question and returns stored text', async () => {
  assert.equal(await createDynamoReply([
    { role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' },
    { role: 'user', content: records[1].question },
  ], { account, loadAnswers: async () => records }), records[1].answer);
});
test('DynamoDB credential and service failures propagate for safe HTTP handling', async () => {
  const error = Object.assign(new Error('Do not expose this provider detail'), { name: 'CredentialsProviderError' });
  await assert.rejects(createDynamoReply([{ role: 'user', content: 'test' }], {
    account, loadAnswers: async () => { throw error; },
  }), { name: 'CredentialsProviderError' });
});
