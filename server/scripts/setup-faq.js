// Applies only the additive FAQ migration; never inserts sample answers.
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../database');

(async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    const sql = fs.readFileSync(path.join(__dirname, '../../Database/migrations/004_faq_answers.sql'), 'utf8');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    const [columns] = await connection.query('DESCRIBE faq_answers');
    const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM faq_answers');
    console.log('faq_answers ready:', columns.map(column => column.Field).join(', '));
    console.log('Stored answers:', count.total);
  } catch (error) {
    console.error('FAQ setup failed:', error.code || 'DATABASE_ERROR');
    process.exitCode = 1;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
})();
