const { normalize, terms, NO_ANSWER } = require('./database-answers');
function authorized(record) {
  return record.isActive === true && record.accessLevel === 'employee' &&
    typeof record.id === 'string' && typeof record.question === 'string' &&
    typeof record.answer === 'string' && Boolean(record.answer.trim());
}

function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
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


module.exports = { matchCompanyAnswer };
