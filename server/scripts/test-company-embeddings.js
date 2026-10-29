const assert = require('node:assert/strict');
const { pool } = require('../database');
const E = require('../company-embeddings');
const { combineRankedResults, searchCompanyKnowledgeHybrid } = require('../company-hybrid');
const settings = E.getEmbeddingSettings({ EMBEDDING_DIMENSIONS: '3' });
let checks = 0;
const pass = (name) => { checks++; console.log(`PASS: ${name}`); };
const record = (id, extra = {}) => ({ id, category: 'IT', title: `Policy ${id}`, content: 'Approved synthetic content',
  keywords: 'test, policy', department: 'IT', sourceName: 'Synthetic', sourceUrl: null,
  is_active: 1, access_level: 'employee', ...extra });
const vectorRow = (row, embedding = [1, 0, 0]) => ({ ...row, embedding,
  embedding_model: settings.model, embedding_dimensions: 3, content_hash: E.contentHash(row), provider_hash: settings.providerHash });

function memoryConnection(records) {
  const stored = new Map();
  return { stored, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
    execute: async (sql, values) => {
      if (sql.includes('LEFT JOIN company_knowledge_embeddings')) return [records.filter((r) => r.is_active === 1 && r.access_level === 'employee').map((r) => ({ ...r, ...stored.get(String(r.id)) }))];
      if (sql.includes('FOR UPDATE')) return [records.filter((r) => String(r.id) === String(values[0]))];
      if (sql.includes('INSERT INTO company_knowledge_embeddings')) {
        stored.set(String(values[0]), { embedding_model: values[1], embedding: values[2], embedding_dimensions: values[3], content_hash: values[4], provider_hash: values[5] });
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected test SQL');
    },
  };
}

(async () => {
  try {
    const r = record(1);
    assert.equal(E.formatKnowledge(r), E.formatKnowledge({ ...r, id: 999, created_at: 'later', access_level: 'admin', source_url: 'ignored' }));
    assert.equal(E.contentHash(r), E.contentHash({ ...r }));
    for (const field of ['category', 'title', 'content', 'keywords', 'department']) assert.notEqual(E.contentHash(r), E.contentHash({ ...r, [field]: 'Changed' }));
    assert.equal(E.formatKnowledge({ ...r, content: ' cafe\u0301\r\ntext ' }), E.formatKnowledge({ ...r, content: 'café\ntext' }));
    pass('Formatting/hash are deterministic, normalize Unicode/line endings, and exclude identifiers/flags/URLs');

    assert.throws(() => E.validateEmbedding([NaN, 0, 1], 3));
    assert.throws(() => E.validateEmbedding(['1', 0, 0], 3));
    assert.throws(() => E.validateEmbedding([0, 0, 0], 3));
    assert.throws(() => E.validateEmbedding([1], 3));
    assert.equal(E.cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(E.cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(E.cosineSimilarity([1, 0], [-1, 0]), -1);
    assert.throws(() => E.cosineSimilarity([1], [1, 2]));
    pass('Embedding validation and cosine similarity reject invalid vectors');

    let calls = 0;
    const client = { embeddings: { create: async (body) => { calls++; assert.equal(body.model, settings.model); assert.equal(body.dimensions, 3); return { model: settings.model, data: [{ embedding: [1, 0, 0] }] }; } } };
    assert.deepEqual(await E.generateEmbedding('Synthetic text', { settings, client }), [1, 0, 0]);
    assert.equal(calls, 1);
    await assert.rejects(E.generateEmbedding('', { settings, client }));
    await assert.rejects(E.generateEmbedding('Test', { settings, client: { embeddings: { create: async () => ({ model: 'wrong', data: [{ embedding: [1, 0, 0] }] }) } } }));
    pass('Provider output/model metadata are validated with external requests mocked');

    const stored = vectorRow(r);
    assert.equal(E.isEmbeddingStale(r, stored, settings), false);
    for (const altered of [{ ...stored, content_hash: 'wrong' }, { ...stored, embedding_model: 'other' },
      { ...stored, embedding_dimensions: 2 }, { ...stored, provider_hash: 'other' }, { ...stored, embedding: [0, 0, 0] }]) assert.equal(E.isEmbeddingStale(r, altered, settings), true);
    assert.equal(E.isEmbeddingStale({ ...r, content: 'Changed' }, stored, settings), true);
    pass('Staleness covers text/model/dimensions/provider/corruption');

    const records = [record(1), record(2), record(3, { is_active: 0 }), record(4, { access_level: 'admin' })];
    const db = memoryConnection(records);
    let generated = 0;
    const embed = async () => { generated++; return [1, 0, 0]; };
    const dry = await E.indexCompanyKnowledge({ db, settings, embed });
    assert.equal(dry.requiringEmbeddings, 2); assert.equal(generated, 0);
    const first = await E.indexCompanyKnowledge({ db, settings, embed, dryRun: false });
    assert.equal(first.created, 2); assert.equal(generated, 2);
    const second = await E.indexCompanyKnowledge({ db, settings, embed, dryRun: false });
    assert.equal(second.skipped, 2); assert.equal(generated, 2);
    records[0].keywords = 'changed';
    const third = await E.indexCompanyKnowledge({ db, settings, embed, dryRun: false });
    assert.equal(third.updated, 1); assert.equal(third.skipped, 1); assert.equal(generated, 3);
    const failed = await E.indexCompanyKnowledge({ db: memoryConnection([record(8)]), settings, dryRun: false, embed: async () => { throw new Error('Provider failed'); } });
    assert.equal(failed.failed, 1); assert.equal(failed.created, 0);
    pass('Indexing dry run, idempotency, changed-content updates, authorization, and provider failures');
    let attempts = 0;
    await assert.rejects(E.indexCompanyKnowledge({ db: memoryConnection([record(8), record(9)]), settings, dryRun: false, stopOnError: true,
      embed: async () => { attempts++; throw Object.assign(new Error('fake-secret must not be logged'), { status: 401, code: 'invalid_api_key', type: 'invalid_request_error' }); } }), (error) => {
      assert.equal(error.indexingCounts.failed, 1);
      assert.equal(error.indexingCounts.processed, 1);
      const safe = E.safeEmbeddingError(error);
      assert.equal(safe.status, 401); assert.equal(safe.code, 'invalid_api_key');
      assert.ok(!JSON.stringify(safe).includes('fake-secret'));
      return true;
    });
    assert.equal(attempts, 1);
    pass('Chargeable indexer stops on first failure and error summaries exclude raw messages/secrets');

    const candidates = [vectorRow(record(1)), vectorRow(record(2), [0.9, 0.1, 0]), vectorRow(record(3), [0, 1, 0]), vectorRow(record(4, { is_active: 0 })), vectorRow(record(5, { access_level: 'admin' }))];
    const searchDb = { execute: async (sql, values) => {
      assert.match(sql, /k.is_active = 1 AND k.access_level = 'employee'/);
      assert.deepEqual(values, [settings.model, '3', settings.providerHash]);
      return [candidates.filter((row) => row.is_active === 1 && row.access_level === 'employee')];
    } };
    const ranked = await E.searchCompanyKnowledgeSemantic('Paraphrased request', { settings, db: searchDb, embed: async () => [1, 0, 0], minSimilarity: 0.8 });
    assert.deepEqual(ranked.map((row) => row.id), [1, 2]);
    const unrelated = await E.searchCompanyKnowledgeSemantic('Unrelated request', { settings, db: searchDb, embed: async () => [0, 0, 1], minSimilarity: 0.8 });
    assert.deepEqual(unrelated, []);
    await E.searchCompanyKnowledgeSemantic('Test', { settings, db: { execute: async () => [[]] }, embed: async () => { throw new Error('Must not bill for empty index'); }, minSimilarity: 0.8 });
    assert.throws(() => E.getMinSimilarity({}));
    assert.throws(() => E.getMinSimilarity({ COMPANY_KNOWLEDGE_MIN_SIMILARITY: '1.5' }));
    pass('Semantic ranking/threshold/auth filters work; empty indexes never call the provider; threshold must be configured');

    const fused = combineRankedResults([{ id: 1 }, { id: 2 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
    assert.equal(fused[0].id, 2);
    assert.equal(new Set(fused.map((row) => row.id)).size, fused.length);
    assert.equal(combineRankedResults([{ id: 1 }], [{ id: 2 }], 1).length, 1);
    const fallback = await searchCompanyKnowledgeHybrid('Test', { enabled: true,
      semantic: async () => { throw new Error('Provider down'); }, fulltext: async () => [{ id: 9 }] });
    assert.equal(fallback[0].id, 9);
    let semanticCalled = false;
    await searchCompanyKnowledgeHybrid('Test', { enabled: false, semantic: async () => { semanticCalled = true; return []; }, fulltext: async () => [] });
    assert.equal(semanticCalled, false);
    pass('Hybrid fusion boosts agreement, deduplicates IDs, limits context, and preserves FULLTEXT fallback');
    console.log(`${checks} embedding/hybrid test groups passed. All provider calls were mocked; no database writes.`);
  } catch (error) { console.error('Embedding tests failed:', error.code || error.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
