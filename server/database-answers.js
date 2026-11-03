const { pool } = require('./database');

const NO_ANSWER = "I couldn't find an answer in the available information. Please rephrase your question or contact support.";
const STOP_WORDS = new Set('a an the i my me we our you your is are was were be been do does did can could would should how what where when why to for of in on at and or it this that please some'.split(' '));

function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function terms(text) {
  return [...new Set(normalize(text).split(' ').filter(word => word.length >= 3 && !STOP_WORDS.has(word)))];
}

async function findDatabaseAnswer(question, db = pool) {
  if (typeof question !== 'string' || !question.trim()) return NO_ANSWER;
  // Exact comparison is parameterized; punctuation/case variants can use FULLTEXT below.
  const [exact] = await db.execute(
    'SELECT answer FROM faq_answers WHERE is_active = 1 AND question = ? ORDER BY id LIMIT 1',
    [question.trim()]
  );
  if (exact.length) return exact[0].answer;
  const words = terms(question);
  if (!words.length) return NO_ANSWER;
  const search = words.join(' ');
  const [rows] = await db.execute(
    `SELECT id, question, answer, keywords,
      MATCH(question, keywords) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
     FROM faq_answers
     WHERE is_active = 1 AND MATCH(question, keywords) AGAINST (? IN NATURAL LANGUAGE MODE) > 0
     ORDER BY score DESC, id ASC LIMIT 5`, [search, search]
  );
  // Require meaningful lexical coverage rather than accepting every nearest match.
  const match = rows.find(row => {
    if (normalize(row.question) === normalize(question)) return true;
    const available = new Set(terms(`${row.question} ${row.keywords || ''}`));
    const overlap = words.filter(word => available.has(word)).length;
    return overlap >= Math.min(2, words.length) && overlap / words.length >= 0.5;
  });
  return match ? match.answer : NO_ANSWER;
}

async function createDatabaseReply(history) {
  const question = [...history].reverse().find(message => message.role === 'user');
  return findDatabaseAnswer(question?.content);
}

module.exports = { findDatabaseAnswer, createDatabaseReply, normalize, terms, NO_ANSWER };
