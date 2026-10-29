const { pool } = require('../database');
const { getEmbeddingSettings, indexCompanyKnowledge, safeEmbeddingError } = require('../company-embeddings');

async function main() {
  let connection;
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !['--dry-run', '--apply', '--allow-api-charges'].includes(arg)) ||
        (args.includes('--dry-run') && args.includes('--apply'))) throw new Error('Use --dry-run or --apply --allow-api-charges.');
    const apply = args.includes('--apply');
    if (apply && !args.includes('--allow-api-charges')) throw new Error('Real indexing requires --apply --allow-api-charges after approval.');
    const settings = getEmbeddingSettings();
    connection = await pool.getConnection();
    const [[selected]] = await connection.query('SELECT DATABASE() AS name');
    if (selected.name !== 'chatbot_db') throw new Error('Unexpected database.');
    if (apply) {
      const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', ['company_knowledge_embedding_index']);
      if (Number(lock.acquired) !== 1) throw new Error('Another indexer is running.');
    }
    const counts = await indexCompanyKnowledge({ db: connection, settings, dryRun: !apply, stopOnError: true });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', provider: 'Configured OPENAI_BASE_URL or default OpenAI',
      model: settings.model, dimensions: settings.dimensions, ...counts,
      expectedEmbeddingRequests: counts.requiringEmbeddings,
      ...(apply ? { embeddingInputsAttempted: counts.requiringEmbeddings } : { apiCallsMade: 0 }) }, null, 2));
    if (counts.failed) process.exitCode = 1;
  } catch (error) {
    // Configuration messages contain no credentials. Do not print provider error bodies.
    console.error(JSON.stringify({ stopped: true, error: safeEmbeddingError(error), counts: error.indexingCounts || null }, null, 2));
    process.exitCode = 1;
  } finally {
    if (connection) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', ['company_knowledge_embedding_index']); } catch { /* connection may be unavailable */ }
      connection.release();
    }
    await pool.end();
  }
}

if (require.main === module) main();
module.exports = { main };
