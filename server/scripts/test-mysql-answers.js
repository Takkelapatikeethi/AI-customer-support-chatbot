const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../database');
const { loadCompanyAnswers, createMysqlReply, SIGN_IN_REQUIRED } = require('../mysql-answers');
after(() => pool.end());
test('MySQL filters active employee records using parameters', async () => {
  const record = { id: 'IT-001', question: 'Password', answer: 'Reset', isActive: true, accessLevel: 'employee' };
  const result = await loadCompanyAnswers({ execute: async (sql, params) => {
    assert.match(sql, /is_active = \? AND access_level = \?/);
    assert.deepEqual(params, [1, 'employee']);
    return [[{ record: JSON.stringify(record) }]];
  } });
  assert.deepEqual(result, [record]);
});
test('MySQL dataset bound fails closed', async () => {
  await assert.rejects(loadCompanyAnswers({ execute: async () => [Array(1001).fill({})] }), { code: 'FAQ_SCAN_LIMIT' });
});
test('guest cannot load MySQL knowledge', async () => {
  assert.equal(await createMysqlReply([], { loadAnswers: () => { throw Error('Must not read'); } }), SIGN_IN_REQUIRED);
});
