// Read-only SDK verification. Never prints credentials or account/chat records.
const { loadCompanyAnswers, matchCompanyAnswer } = require('../dynamodb-answers');
const { pool } = require('../database');

(async () => {
  try {
    const records = await loadCompanyAnswers();
    console.log('Active employee FAQ records:', records.length);
    for (const question of ['My work computer is broken', 'How do I reset my company password?', 'How do I report a phishing email?']) {
      const answer = matchCompanyAnswer(question, records);
      const record = records.find(item => item.answer === answer);
      console.log(`${question} -> ${record ? `${record.id}: ${record.question}` : 'No match'}`);
    }
    if (records.length !== 20) throw Object.assign(new Error(), { code: 'UNEXPECTED_FAQ_COUNT' });
  } catch (error) {
    console.error('DynamoDB check failed:', error.code || error.name || 'DYNAMODB_ERROR');
    console.error('If your local session expired, run: aws login --profile company-support-dev --region us-east-1');
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
