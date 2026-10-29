const { searchCompanyKnowledge } = require('./company-knowledge');
const { searchCompanyKnowledgeSemantic } = require('./company-embeddings');

// Reciprocal rank fusion: a record found in both lists receives both rank votes.
// It never compares MySQL relevance numbers directly with cosine scores.
function combineRankedResults(semantic, lexical, limit = 5) {
  const merged = new Map();
  for (const [kind, rows] of [['semantic', semantic], ['fulltext', lexical]]) {
    const seen = new Set();
    rows.forEach((row, rank) => {
      const id = String(row.id);
      if (seen.has(id)) return;
      seen.add(id);
      const candidate = merged.get(id) || { ...row, hybridScore: 0, retrievalMethods: [] };
      candidate.hybridScore += 1 / (60 + rank + 1);
      candidate.retrievalMethods.push(kind);
      if (kind === 'semantic') candidate.similarity = row.similarity;
      merged.set(id, candidate);
    });
  }
  return [...merged.values()].sort((a, b) => b.hybridScore - a.hybridScore ||
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).slice(0, limit);
}

async function searchCompanyKnowledgeHybrid(query, {
  limit = 5, lexicalFilter,
  enabled = process.env.COMPANY_KNOWLEDGE_SEMANTIC_ENABLED === 'true',
  fulltext = searchCompanyKnowledge, semantic = searchCompanyKnowledgeSemantic,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Hybrid limit must be 1–5.');
  // Search the original query. No synonym rewriting or model-based classification.
  let semanticRows = [];
  if (enabled) {
    try { semanticRows = await semantic(query, { limit }); }
    catch { console.warn('Semantic retrieval unavailable; using FULLTEXT fallback.'); }
  }
  const raw = await fulltext(query, { limit });
  // Chat supplies its existing lexical guard. Semantic matches bypass this word
  // overlap guard because they already passed the calibrated similarity threshold.
  const lexical = lexicalFilter ? lexicalFilter(query, raw) : raw;
  return combineRankedResults(semanticRows, lexical, limit);
}

module.exports = { combineRankedResults, searchCompanyKnowledgeHybrid };
