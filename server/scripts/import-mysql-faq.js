const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pool } = require('../database');
const records = [...require('../../Database/seeds/company_support_faq.synthetic.json'), ...require('../../Database/seeds/company_support_faq.additional.synthetic.json')];
(async () => {
  let db;
  try {
    assert.equal(records.length, 50);
    assert.equal(new Set(records.map(r => r.id)).size, 50);
    db = await pool.getConnection();
    const [[database]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(database.name, 'chatbot_db');
    await db.query(fs.readFileSync(path.join(__dirname, '../../Database/migrations/005_mysql_company_support_faq.sql'), 'utf8'));
    await db.beginTransaction();
    let inserted = 0;
    for (const record of records) {
      const [rows] = await db.execute('SELECT record FROM company_support_faq WHERE id = ?', [record.id]);
      if (rows.length) assert.deepEqual(typeof rows[0].record === 'string' ? JSON.parse(rows[0].record) : rows[0].record, record);
      else {
        await db.execute('INSERT INTO company_support_faq (id, record) VALUES (?, ?)', [record.id, JSON.stringify(record)]);
        inserted++;
      }
    }
    await db.commit();
    const { loadCompanyAnswers, matchCompanyAnswer } = require('../mysql-answers');
    const stored = await loadCompanyAnswers(db);
    for (const record of records) {
      assert.deepEqual(stored.find(r => r.id === record.id), record);
      for (const question of [record.question, ...record.alternativePhrases]) assert.equal(matchCompanyAnswer(question, stored), record.answer);
    }
    console.log(JSON.stringify({ inserted, skipped: 50 - inserted, verifiedRecords: 50, verifiedQuestions: 150 }));
  } catch (error) {
    if (db) await db.rollback();
    console.error('FAQ import/verification failed:', error.code || error.name);
    process.exitCode = 1;
  } finally { if (db) db.release(); await pool.end(); }
})();
