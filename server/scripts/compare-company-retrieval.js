const { pool } = require('../database');
const fs = require('node:fs');
const path = require('node:path');
const { searchCompanyKnowledge } = require('../company-knowledge');
const { usableKnowledge } = require('../company-chat');
const { combineRankedResults } = require('../company-hybrid');
const { getEmbeddingSettings, getMinSimilarity, loadSemanticCandidates,
  generateEmbedding, rankSemanticCandidates, safeEmbeddingError } = require('../company-embeddings');

const cases = [
  { query: 'My computer is broken and I need another one', targets: ['Company Laptop Replacement'] },
  { query: 'I clicked a suspicious email', targets: ['Phishing Email Reporting'] },
  { query: 'I cannot sign into my account', targets: ['Company Password Reset', 'Multi-Factor Authentication Recovery'] },
  { query: 'I need some days off', targets: ['Paid Time Off Entitlement', 'Vacation Request and Approval Process'] },
  { query: 'I paid for something during a business trip', targets: ['Business Travel Approval and Expenses', 'Expense Reimbursement Submission'] },
  { query: 'My work machine stopped functioning.', targets: ['Company Laptop Replacement'] },
  { query: 'I received a message that looks like someone is trying to steal my credentials.', targets: ['Phishing Email Reporting'] },
  { query: 'I need permission to use an internal system.', targets: ['Requesting Business Application Access'] },
  { query: 'I will be away from work for several days.', targets: ['Paid Time Off Entitlement', 'Vacation Request and Approval Process'] },
  { query: "My authentication code isn't working.", targets: ['Multi-Factor Authentication Recovery'] },
  { query: 'What is 2 + 2?', targets: [] },
  { query: 'What is the capital of France?', targets: [] },
  { query: 'Explain photosynthesis.', targets: [] },
];

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !['--dry-run', '--allow-api-charges', '--replay'].includes(arg)) ||
        args.length > 1) throw new Error('Use --dry-run, --replay, or --allow-api-charges after approval.');
    if (args.includes('--replay')) {
      const file = path.join(__dirname, '..', 'reports', 'step6-retrieval-evaluation.json');
      const result = JSON.parse(fs.readFileSync(file, 'utf8'));
      const threshold = getMinSimilarity();
      result.configuredThreshold = threshold;
      result.replayEmbeddingRequests = 0;
      for (const item of result.report) {
        const accepted = item.semanticAll.filter((row) => row.similarity >= threshold).slice(0, 5);
        item.hybrid = combineRankedResults(accepted, item.lexicalCandidates, 5)
          .map((row) => ({ id: row.id, title: row.title, similarity: row.similarity ?? null, methods: row.retrievalMethods }));
      }
      fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify({ replayEmbeddingRequests: 0, threshold,
        report: result.report.map((item) => ({ query: item.query, hybrid: item.hybrid })) }, null, 2));
      return;
    }
    const real = args.includes('--allow-api-charges');
    const settings = getEmbeddingSettings();
    const candidates = await loadSemanticCandidates({ settings });
    const [[total]] = await pool.execute("SELECT COUNT(*) AS total FROM company_knowledge WHERE is_active = 1 AND access_level = 'employee'");
    if (real && candidates.length !== Number(total.total)) throw new Error('Complete current-model indexing before chargeable query evaluation.');
    let threshold = null;
    try { threshold = getMinSimilarity(); } catch { /* calibration is deliberately pending */ }
    const report = [];
    const positiveScores = [];
    const negativeScores = [];
    for (const item of cases) {
      const lexical = await searchCompanyKnowledge(item.query, { limit: 5 });
      let semantic = [];
      if (real) {
        const vector = await generateEmbedding(item.query, { settings });
        semantic = rankSemanticCandidates(vector, candidates, settings);
        if (item.targets.length) positiveScores.push(Math.max(...semantic.filter((row) => item.targets.includes(row.title)).map((row) => row.similarity)));
        else negativeScores.push(semantic[0]?.similarity ?? -1);
      }
      const hybrid = real && threshold !== null ? combineRankedResults(
        semantic.filter((row) => row.similarity >= threshold).slice(0, 5), usableKnowledge(item.query, lexical), 5) : null;
      report.push({ query: item.query, expectedTargets: item.targets,
        fulltext: lexical.map((row) => row.title),
        lexicalCandidates: usableKnowledge(item.query, lexical).map((row) => ({ id: row.id, title: row.title })),
        semanticAll: real ? semantic.map((row) => ({ id: row.id, title: row.title, similarity: row.similarity })) : [],
        semantic: real ? semantic.slice(0, 5).map((row) => ({ title: row.title, score: row.similarity })) : 'Pending approved embedding calls',
        hybrid: hybrid?.map((row) => ({ title: row.title, similarity: row.similarity ?? null, methods: row.retrievalMethods })) ?? 'Pending real scores and threshold calibration' });
    }
    const result = { model: settings.model, dimensions: settings.dimensions,
      indexedCurrentRecords: candidates.length, activeEmployeeRecords: Number(total.total),
      queryEmbeddingRequests: real ? cases.length : 0, futureEvaluationRequests: real ? 0 : cases.length,
      configuredThreshold: threshold,
      observedDistribution: real ? { weakestExpectedTarget: Math.min(...positiveScores),
        strongestUnrelatedMatch: Math.max(...negativeScores),
        separationExists: Math.min(...positiveScores) > Math.max(...negativeScores) } : 'Not measured: no chargeable calls made',
      note: 'Review all scores before setting a threshold. Do not choose a value solely to pass this small evaluation set.', report };
    if (real) {
      const directory = path.join(__dirname, '..', 'reports');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'step6-retrieval-evaluation.json'), JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ stopped: true, error: safeEmbeddingError(error) }, null, 2));
    process.exitCode = 1;
  } finally { await pool.end(); }
}
if (require.main === module) main();
module.exports = { cases };
