const { pool } = require('./database');
const { account } = require('./auth');

const MAX_QUERY_LENGTH = 500;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function invalidSearch(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw invalidSearch('Provide a non-empty search query in q.');
  }
  const trimmed = query.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw invalidSearch(`Search queries must be ${MAX_QUERY_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

// Database retrieval only. Callers must authorize access before exposing results.
async function searchCompanyKnowledge(query, { limit = DEFAULT_LIMIT } = {}) {
  const text = normalizeQuery(query);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalidSearch(`Result limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  const [rows] = await pool.execute(
    `SELECT id, category, title, content,
       source_name AS sourceName, source_url AS sourceUrl, department
     FROM company_knowledge
     WHERE is_active = 1 AND access_level = 'employee'
       AND MATCH(title, content, keywords) AGAINST (? IN NATURAL LANGUAGE MODE)
     ORDER BY MATCH(title, content, keywords) AGAINST (? IN NATURAL LANGUAGE MODE) DESC,
       id ASC
     LIMIT ?`,
    // A numeric string keeps LIMIT compatible with mysql2 prepared statements.
    [text, text, String(limit)]);
  return rows;
}

function installCompanyKnowledgeRoutes(app) {
  app.get('/api/knowledge/search', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      // Deliberately do not use browserIdentity: it also permits guest access.
      const user = await account(req);
      if (!user) return res.status(401).json({ reply: 'Log in to search company knowledge.' });

      const query = normalizeQuery(req.query.q);
      let limit = DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        if (typeof req.query.limit !== 'string' || !/^[1-9]\d?$/.test(req.query.limit)) {
          throw invalidSearch(`Result limit must be an integer from 1 to ${MAX_LIMIT}.`);
        }
        limit = Number(req.query.limit);
      }
      const results = await searchCompanyKnowledge(query, { limit });
      res.json({ query, count: results.length, results });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ reply: error.message });
      console.error('Company knowledge search failed:', error.code || 'DATABASE_ERROR');
      res.status(503).json({ reply: 'Company knowledge search is unavailable. Please try again.' });
    }
  });
}

module.exports = { searchCompanyKnowledge, installCompanyKnowledgeRoutes };
