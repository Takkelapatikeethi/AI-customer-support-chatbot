const { createHash } = require('node:crypto');
const OpenAI = require('openai');
const { pool } = require('./database');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
function safeEmbeddingError(error) {
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null;
  const status = Number.isInteger(error.status) ? error.status : null;
  const code = identifier(error.code) || 'EMBEDDING_REQUEST_FAILED';
  const summary = code === 'insufficient_quota' ? 'Provider quota or billing credits are insufficient.'
    : status === 401 ? 'Provider authentication failed.'
    : status === 403 ? 'Provider denied access to the requested resource.'
    : status === 404 ? 'Provider model or endpoint was not found.'
    : status === 429 ? 'Provider rate limit or quota rejected the request.'
    : 'Embedding request or configuration failed; no raw provider response is displayed.';
  return { status, code, type: identifier(error.type), param: identifier(error.param), summary };
}
function getEmbeddingSettings(env = process.env) {
  const baseURL = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const url = new URL(baseURL);
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:') {
    throw new Error('Embedding endpoint must be HTTPS without URL credentials or query parameters.');
  }
  if (url.hostname !== 'api.openai.com' && !env.EMBEDDING_MODEL) {
    throw new Error('Set an embedding model supported by the configured provider.');
  }
  const model = env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const dimensions = Number(env.EMBEDDING_DIMENSIONS || 1536);
  if (!model || model.length > 191 || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > 16384) {
    throw new Error('Invalid embedding model or dimensions.');
  }
  return { model, dimensions, baseURL, providerHash: sha256(baseURL.replace(/\/+$/, '')) };
}

function formatKnowledge(record) {
  const fields = ['category', 'title', 'content', 'keywords', 'department'];
  return fields.map((field) => {
    const value = record[field] ?? '';
    if (typeof value !== 'string') throw new Error('Knowledge text fields must be strings.');
    return `${field}: ${value.normalize('NFC').replace(/\r\n?/g, '\n').trim()}`;
  }).join('\n\n');
}

function contentHash(record) { return sha256(formatKnowledge(record)); }

function validateEmbedding(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== dimensions ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Invalid embedding shape or numeric values.');
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding must have finite nonzero magnitude.');
  return vector;
}

function storedVector(value, dimensions) {
  return validateEmbedding(typeof value === 'string' ? JSON.parse(value) : value, dimensions);
}

function cosineSimilarity(a, b) {
  validateEmbedding(a, a.length);
  validateEmbedding(b, a.length);
  const normA = Math.hypot(...a);
  const normB = Math.hypot(...b);
  const score = a.reduce((sum, value, i) => sum + (value / normA) * (b[i] / normB), 0);
  return Math.max(-1, Math.min(1, score));
}

function isEmbeddingStale(record, stored, settings) {
  if (!stored || stored.embedding_model !== settings.model ||
      Number(stored.embedding_dimensions) !== settings.dimensions ||
      stored.content_hash !== contentHash(record) || stored.provider_hash !== settings.providerHash) return true;
  try { storedVector(stored.embedding, settings.dimensions); return false; }
  catch { return true; }
}

async function generateEmbedding(text, { settings = getEmbeddingSettings(), client } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
    throw new Error('Embedding text must contain 1–20000 characters.');
  }
  const provider = client || new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, baseURL: settings.baseURL,
    maxRetries: 0, timeout: 30000,
  });
  const response = await provider.embeddings.create({
    model: settings.model, input: text, encoding_format: 'float',
    ...(settings.model.includes('text-embedding-3') ? { dimensions: settings.dimensions } : {}),
  });
  if (!Array.isArray(response.data) || response.data.length !== 1 || response.model !== settings.model) {
    throw new Error('Embedding provider returned unexpected model metadata.');
  }
  return validateEmbedding(response.data[0].embedding, settings.dimensions);
}

// Receives a connection from the existing pool. No new pool or schema is created.
async function indexCompanyKnowledge({ db, settings = getEmbeddingSettings(), embed = generateEmbedding, dryRun = true, stopOnError = false }) {
  const [records] = await db.execute(
    `SELECT k.*, e.embedding, e.embedding_model, e.embedding_dimensions,
       e.content_hash, e.provider_hash
     FROM company_knowledge k LEFT JOIN company_knowledge_embeddings e
       ON e.knowledge_id = k.id AND e.embedding_model = ?
     WHERE k.is_active = 1 AND k.access_level = 'employee' ORDER BY k.id`, [settings.model]);
  const counts = { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0, requiringEmbeddings: 0 };
  for (const record of records) {
    counts.processed++;
    if (!isEmbeddingStale(record, record.embedding_model ? record : null, settings)) { counts.skipped++; continue; }
    counts.requiringEmbeddings++;
    if (dryRun) continue;
    try {
      const vector = validateEmbedding(await embed(formatKnowledge(record), { settings }), settings.dimensions);
      await db.beginTransaction();
      const [current] = await db.execute('SELECT * FROM company_knowledge WHERE id = ? FOR UPDATE', [record.id]);
      if (!current[0] || Number(current[0].is_active) !== 1 || current[0].access_level !== 'employee' || contentHash(current[0]) !== contentHash(record)) {
        throw new Error('Knowledge changed while embedding was generated. Rerun indexing.');
      }
      await db.execute(
        `INSERT INTO company_knowledge_embeddings
         (knowledge_id, embedding_model, embedding, embedding_dimensions, content_hash, provider_hash)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE embedding = VALUES(embedding),
           embedding_dimensions = VALUES(embedding_dimensions),
           content_hash = VALUES(content_hash), provider_hash = VALUES(provider_hash)`,
        [record.id, settings.model, JSON.stringify(vector), settings.dimensions, contentHash(record), settings.providerHash]);
      await db.commit();
      counts[record.embedding_model ? 'updated' : 'created']++;
    } catch (error) {
      await db.rollback();
      counts.failed++;
      if (stopOnError) {
        error.indexingCounts = { ...counts };
        throw error;
      }
    }
  }
  return counts;
}

async function loadSemanticCandidates({ settings = getEmbeddingSettings(), db = pool } = {}) {
  const [rows] = await db.execute(
    `SELECT k.id, k.category, k.title, k.content, k.keywords, k.department,
       k.source_name AS sourceName, k.source_url AS sourceUrl,
       e.embedding, e.embedding_model, e.embedding_dimensions, e.content_hash, e.provider_hash
     FROM company_knowledge k JOIN company_knowledge_embeddings e ON e.knowledge_id = k.id
     WHERE k.is_active = 1 AND k.access_level = 'employee'
       AND e.embedding_model = ? AND e.embedding_dimensions = ? AND e.provider_hash = ?`,
    [settings.model, String(settings.dimensions), settings.providerHash]);
  return rows.filter((row) => !isEmbeddingStale(row, row, settings));
}

function rankSemanticCandidates(queryVector, candidates, settings) {
  validateEmbedding(queryVector, settings.dimensions);
  return candidates.map((row) => ({
    id: row.id, category: row.category, title: row.title, content: row.content,
    sourceName: row.sourceName, sourceUrl: row.sourceUrl, department: row.department,
    similarity: cosineSimilarity(queryVector, storedVector(row.embedding, settings.dimensions)),
  })).sort((a, b) => b.similarity - a.similarity || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

function getMinSimilarity(env = process.env) {
  if (!env.COMPANY_KNOWLEDGE_MIN_SIMILARITY?.trim()) throw new Error('Calibrate COMPANY_KNOWLEDGE_MIN_SIMILARITY before enabling semantic retrieval.');
  const value = Number(env.COMPANY_KNOWLEDGE_MIN_SIMILARITY);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Similarity threshold must be between 0 and 1.');
  return value;
}

async function searchCompanyKnowledgeSemantic(query, {
  limit = 5, settings = getEmbeddingSettings(), minSimilarity = getMinSimilarity(),
  embed = generateEmbedding, db = pool,
} = {}) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 500) throw Object.assign(new Error('Invalid semantic query.'), { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Object.assign(new Error('Invalid result limit.'), { status: 400 });
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) throw new Error('Invalid similarity threshold.');
  const candidates = await loadSemanticCandidates({ settings, db });
  // Do not bill for a query when no current authorized vectors exist.
  if (!candidates.length) return [];
  const vector = await embed(query.trim(), { settings });
  return rankSemanticCandidates(vector, candidates, settings).filter((row) => row.similarity >= minSimilarity).slice(0, limit);
}

module.exports = { safeEmbeddingError, getEmbeddingSettings, formatKnowledge, contentHash, validateEmbedding,
  storedVector, cosineSimilarity, isEmbeddingStale, generateEmbedding, indexCompanyKnowledge,
  loadSemanticCandidates, rankSemanticCandidates, getMinSimilarity, searchCompanyKnowledgeSemantic };
