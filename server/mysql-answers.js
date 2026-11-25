const { pool } = require('./database');
const { NO_ANSWER } = require('./faq-text');
const { matchCompanyAnswer } = require('./faq-matching');
const SIGN_IN_REQUIRED = 'Please sign in to access company-support answers.';
async function loadCompanyAnswers(db = pool) {
  const [rows] = await db.execute("SELECT record FROM company_support_faq WHERE is_active = ? AND access_level = ? ORDER BY id LIMIT 1001", [1, 'employee']);
  if (rows.length > 1000) throw Object.assign(new Error('FAQ dataset exceeds matching limit.'), { code: 'FAQ_SCAN_LIMIT' });
  return rows.map(row => typeof row.record === 'string' ? JSON.parse(row.record) : row.record);
}
async function createMysqlReply(history, { account, loadAnswers = loadCompanyAnswers } = {}) {
  if (!account?.id) return SIGN_IN_REQUIRED;
  const question = [...history].reverse().find(message => message.role === 'user');
  if (!question?.content?.trim()) return NO_ANSWER;
  return matchCompanyAnswer(question.content, await loadAnswers());
}
module.exports = { createMysqlReply, loadCompanyAnswers, matchCompanyAnswer, SIGN_IN_REQUIRED };
