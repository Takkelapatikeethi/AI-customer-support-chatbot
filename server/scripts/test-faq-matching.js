const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const original = require('../../Database/seeds/company_support_faq.synthetic.json');
const additional = require('../../Database/seeds/company_support_faq.additional.synthetic.json');
const records = [...original, ...additional];
const { pool } = require('../database');
const { NO_ANSWER } = require('../faq-text');
const { createMysqlReply, loadCompanyAnswers, matchCompanyAnswer, SIGN_IN_REQUIRED } = require('../mysql-answers');

after(() => pool.end());
const account = { id: 42 };

test('dataset contains 20 original and 30 additional unique fictional employee records', () => {
  assert.equal(original.length, 20);
  assert.equal(additional.length, 30);
  assert.equal(new Set(records.map(record => record.id)).size, 50);
  const phrases = [];
  for (const record of records) {
    assert.equal(record.isSynthetic, true);
    assert.equal(record.isActive, true);
    assert.equal(record.accessLevel, 'employee');
    assert.equal(record.sourceUrl, null);
    assert.equal(record.alternativePhrases.length, 2);
    assert.ok(record.keywords.length >= 4);
    phrases.push(record.question, ...record.alternativePhrases);
  }
  const { normalize } = require('../faq-text');
  assert.equal(new Set(phrases.map(normalize)).size, 150);
});
test('all 50 questions and 100 alternative phrases return the exact stored answers', () => {
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
test('guests never invoke MySQL', async () => {
  let calls = 0;
  const loadAnswers = async () => { calls++; return records; };
  assert.equal(await createMysqlReply([{ role: 'user', content: records[0].question }], { loadAnswers }), SIGN_IN_REQUIRED);
  assert.equal(calls, 0);
});
test('authenticated reply uses the latest user question and returns stored text', async () => {
  assert.equal(await createMysqlReply([
    { role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' },
    { role: 'user', content: records[1].question },
  ], { account, loadAnswers: async () => records }), records[1].answer);
});
test('MySQL credential and service failures propagate for safe HTTP handling', async () => {
  const error = Object.assign(new Error('Do not expose this provider detail'), { name: 'CredentialsProviderError' });
  await assert.rejects(createMysqlReply([{ role: 'user', content: 'test' }], {
    account, loadAnswers: async () => { throw error; },
  }), { name: 'CredentialsProviderError' });
});
