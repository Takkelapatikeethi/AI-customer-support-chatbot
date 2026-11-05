const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { normalize, terms, NO_ANSWER } = require('./database-answers');

const SIGN_IN_REQUIRED = 'Please sign in to access company-support answers.';
const tableName = process.env.DYNAMODB_FAQ_TABLE || 'company_support_faq';
let client;

function getClient() {
  if (!client) {
    client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {}),
      maxAttempts: 3,
    }));
  }
  return client;
}

function authorized(record) {
  return record.isActive === true && record.accessLevel === 'employee' &&
    typeof record.id === 'string' && typeof record.question === 'string' &&
    typeof record.answer === 'string' && Boolean(record.answer.trim());
}

function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

async function loadCompanyAnswers(db = getClient()) {
  const records = [];
  let key;
  let evaluated = 0;
  let pages = 0;
  do {
    pages++;
    const page = await db.send(new ScanCommand({
      TableName: tableName,
      ConsistentRead: true,
      Limit: 100,
      FilterExpression: '#active = :active AND #access = :access',
      ExpressionAttributeNames: { '#active': 'isActive', '#access': 'accessLevel' },
      ExpressionAttributeValues: { ':active': true, ':access': 'employee' },
      ...(key ? { ExclusiveStartKey: key } : {}),
    }));
    records.push(...(page.Items || []).filter(authorized));
    evaluated += page.ScannedCount ?? 100;
    key = page.LastEvaluatedKey;
    if (key && (evaluated >= 1000 || pages >= 10)) {
      const error = new Error('FAQ dataset exceeds the small-dataset scan limit.');
      error.code = 'FAQ_SCAN_LIMIT';
      throw error;
    }
  } while (key);
  return records;
}

function matchCompanyAnswer(question, records) {
  if (typeof question !== 'string' || !normalize(question)) return NO_ANSWER;
  const normalized = normalize(question);
  const candidates = records.filter(authorized);
  const exact = candidates.filter(record => [record.question, ...stringList(record.alternativePhrases)]
    .some(phrase => typeof phrase === 'string' && normalize(phrase) === normalized));
  if (exact.length) return exact.length === 1 ? exact[0].answer : NO_ANSWER;
  const words = terms(question);
  if (!words.length) return NO_ANSWER;
  const ranked = candidates.map(record => {
    const phrases = [record.question, ...stringList(record.alternativePhrases), ...stringList(record.keywords)]
      .filter(phrase => typeof phrase === 'string');
    const available = new Set(terms(phrases.join(' ')));
    const overlap = words.filter(word => available.has(word)).length;
    const coverage = overlap / words.length;
    const phraseSimilarity = Math.max(...phrases.map(phrase => {
      const phraseWords = terms(phrase);
      const common = phraseWords.filter(word => words.includes(word)).length;
      return 2 * common / Math.max(1, words.length + phraseWords.length);
    }));
    return { record, score: 0.8 * coverage + 0.2 * phraseSimilarity,
      relevant: coverage >= 0.6 && overlap >= Math.min(2, words.length) };
  }).filter(item => item.relevant).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  // Ambiguous matches need a more specific question rather than an arbitrary policy.
  if (!ranked.length || (ranked[1] && ranked[0].score - ranked[1].score < 0.05)) return NO_ANSWER;
  return ranked[0].record.answer;
}

async function createDynamoReply(history, { account, loadAnswers = loadCompanyAnswers } = {}) {
  // Never read DynamoDB for guests. The account comes from validated server-side sessions.
  if (!account?.id) return SIGN_IN_REQUIRED;
  const question = [...history].reverse().find(message => message.role === 'user');
  if (!question?.content?.trim()) return NO_ANSWER;
  return matchCompanyAnswer(question.content, await loadAnswers());
}

module.exports = { createDynamoReply, loadCompanyAnswers, matchCompanyAnswer, SIGN_IN_REQUIRED };
