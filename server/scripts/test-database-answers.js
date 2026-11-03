const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { pool } = require('../database');
const { findDatabaseAnswer, NO_ANSWER } = require('../database-answers');

after(() => pool.end());

function database(rows) {
  const calls = [];
  return {
    calls,
    async execute(sql, values) {
      calls.push({ sql, values });
      assert.match(sql, /is_active = 1/);
      assert.ok(!sql.includes('injected-search'));
      return [calls.length === 1 ? [] : rows];
    },
  };
}

test('exact match returns stored answer unchanged', async () => {
  const db = { execute: async () => [[{ answer: 'Approved answer.' }]] };
  assert.equal(await findDatabaseAnswer('Saved question', db), 'Approved answer.');
});
test('keyword match uses bound FULLTEXT search, active filter and bounded candidates', async () => {
  const db = database([{ question: 'Password recovery', keywords: 'reset password', answer: 'Use account recovery.' }]);
  assert.equal(await findDatabaseAnswer('How do I reset my password?', db), 'Use account recovery.');
  assert.match(db.calls[1].sql, /LIMIT 5/);
  assert.match(db.calls[1].sql, /MATCH\(question, keywords\)/);
  assert.deepEqual(db.calls[1].values, ['reset password', 'reset password']);
});
test('unrelated or weak overlap returns fallback', async () => {
  const db = database([{ question: 'Company password', keywords: '', answer: 'Wrong answer' }]);
  assert.equal(await findDatabaseAnswer('Explain plant growth and password', db), NO_ANSWER);
});
test('empty table and empty questions return fallback', async () => {
  assert.equal(await findDatabaseAnswer('Unknown question', database([])), NO_ANSWER);
  assert.equal(await findDatabaseAnswer('   ', database([])), NO_ANSWER);
});
test('SQL input is passed as parameters', async () => {
  const db = database([]);
  await findDatabaseAnswer("injected-search' OR 1=1 --", db);
  assert.equal(db.calls[0].values[0], "injected-search' OR 1=1 --");
});
test('database failures propagate for safe route handling', async () => {
  await assert.rejects(findDatabaseAnswer('test', { execute: async () => { throw new Error('unavailable'); } }));
});
