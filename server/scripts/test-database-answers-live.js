// Temporary FAQ fixtures are rolled back; no approved answer records are changed.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { pool } = require('../database');
const { findDatabaseAnswer, NO_ANSWER } = require('../database-answers');

(async () => {
  let db;
  try {
    db = await pool.getConnection();
    await db.beginTransaction();
    const prefix = randomBytes(12).toString('hex');
    await db.execute('INSERT INTO faq_answers (question, answer, keywords, is_active) VALUES (?, ?, ?, 1), (?, ?, ?, 0)',
      [`${prefix} approved question`, 'Saved approved answer', prefix, `${prefix} inactive question`, 'Hidden answer', prefix]);
    assert.equal(await findDatabaseAnswer(`${prefix} approved question`, db), 'Saved approved answer');
    assert.equal(await findDatabaseAnswer(`${prefix} inactive question`, db), NO_ANSWER);
    // InnoDB FULLTEXT indexes see committed rows; use existing committed FAQ content if present.
    const [indexes] = await db.query('SHOW INDEX FROM faq_answers');
    assert.ok(indexes.some(index => index.Key_name === 'ft_faq_search' && index.Index_type === 'FULLTEXT'));
    console.log('PASS: live exact lookup, inactive exclusion, FULLTEXT index verified; fixtures rolled back.');
  } catch (error) {
    console.error('Live FAQ test failed:', error.code || error.name || 'TEST_ERROR');
    process.exitCode = 1;
  } finally {
    if (db) {
      await db.rollback();
      db.release();
    }
    await pool.end();
  }
})();
