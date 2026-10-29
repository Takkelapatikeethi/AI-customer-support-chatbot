# Hybrid retrieval (Step 6; real indexing and initial calibration complete)

The inspected RDS database runs MySQL 8.4.9. Read-only probes found no usable
VECTOR cast or STRING_TO_VECTOR function. Migration 005 therefore adds a normal
InnoDB table with JSON vectors rather than a separate vector database. Its primary
key is (knowledge_id, embedding_model); its foreign key deletes vectors when the
knowledge record is deleted. It stores dimensions, provider fingerprint, content
hash, and timestamps. The knowledge table and its 20 records are unchanged.

company-embeddings.js reuses the existing database pool and server-side
OPENAI_API_KEY / OPENAI_BASE_URL. The proposed OpenAI model is
text-embedding-3-small, 1536 dimensions. No additional package is required.
Provider model access was verified by 20 successful indexing requests and 13
successful query-evaluation requests, explicitly approved by the user.
There are no fallback providers. Custom endpoints require an explicit model.

Text formatting is deterministic, with labeled category, title, content, keywords,
and department. Unicode/line endings and outer field whitespace are normalized.
IDs, timestamps, URLs, and access flags are excluded. Hashes identify that text.
Invalid, zero, non-finite, wrong-dimension, wrong-model, or stale vectors are not
used. A provider endpoint change also makes existing vectors stale.

The indexer defaults to dry run. Real indexing requires BOTH --apply and
--allow-api-charges after approval. It serializes cooperating indexers with a
connection-scoped advisory lock, skips current vectors, and generates only missing
or stale ones. It rechecks current knowledge under a transaction/row lock before
upserting each vector. Counts include processed, created, updated, skipped, failed,
and requiringEmbeddings. API retries are disabled to bound request attempts.

Commands from server:

```
node scripts/index-company-knowledge.js --dry-run
# Only after explicit approval of chargeable requests:
node scripts/index-company-knowledge.js --apply --allow-api-charges
```

Semantic search loads only active employee-level rows for the configured model,
dimensions, and provider, rejects stale vectors, then embeds the employee query.
No query embedding is requested for an empty usable index. Cosine similarity is
computed in Node.js. This scans the authorized dataset and is intended for small
portfolio datasets, not a large production corpus.

company-hybrid.js combines threshold-passing semantic results with the existing
FULLTEXT results. Chat applies its Step 5 lexical guard to FULLTEXT candidates.
Semantic candidates bypass that word-overlap guard so paraphrases can survive.
Reciprocal rank fusion sums 1/(60+rank), independently in each list, deduplicating
by knowledge ID. Records present in both lists receive both votes. At most five
records reach grounding. Embedding/configuration failures preserve FULLTEXT
fallback. FULLTEXT failures still fail closed through existing chat handling.

Both new messages and retries use this path in company-chat.js, after account and
conversation-ownership checks. Guests bypass it completely. Grounding rules,
reference escaping, source metadata, general-question classification, and the
verified-information fallback remain in place. No React/authentication changes.

Semantic retrieval remains opt-in by default in code. The actual server/.env is
now enabled after real score calibration:

```
COMPANY_KNOWLEDGE_SEMANTIC_ENABLED=true
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
COMPANY_KNOWLEDGE_MIN_SIMILARITY=0.30
```

The initial 0.30 threshold uses observed real scores: the strongest unrelated
match was 0.1398054 and the weakest best expected-company-topic match was
0.3124421. This rejects many incidental 0.20–0.29 matches. It deliberately drops
the secondary MFA result (0.2992172) for the sign-in question while retaining
password recovery (0.3315302). It is a conservative starting point for this small
corpus, not a semantic confidence probability or guarantee. The 0.8 used in mocked
tests is still only a fixture threshold, not real calibration.

compare-company-retrieval.js includes all ten requested paraphrases and three
unrelated questions. Dry run reads FULLTEXT baselines only. After document
indexing, charge-approved evaluation makes 13 query-embedding requests and prints
FULLTEXT results, semantic scores, weakest expected-target score, and strongest
unrelated-query score. When a threshold is configured it also prints hybrid
results. Review the whole distribution and ambiguous cases before selecting a
conservative initial threshold; if positive/negative scores overlap, report that
limitation rather than claiming a threshold can separate them. Do not tune only
to pass these examples. This small set is not a production relevance evaluation.

```
node scripts/compare-company-retrieval.js --dry-run
# Only after explicit approval of chargeable requests:
node scripts/compare-company-retrieval.js --allow-api-charges
# Recompute hybrid results from saved scores without additional API requests:
node scripts/compare-company-retrieval.js --replay
```

Real results are saved in reports/step6-retrieval-evaluation.json and summarized
in reports/step6-final-report.md. Current state: all 20 vectors are valid/current,
20 indexing requests and 13 evaluation requests succeeded, with no extra API
requests made during calibration or regression testing. Semantic retrieval introduces a
query embedding request for signed-in chat/retry when a current index exists.
Only the threshold and semantic-enabled values in the actual .env were changed;
credentials were not altered or printed. .env.example keeps enablement opt-in.

Tests (all embedding and generation calls mocked):

```
node scripts/test-company-embeddings.js
node scripts/test-company-semantic-chat.js
node scripts/test-company-calibrated.js
```

The first uses in-memory database fixtures. The second uses real RDS account/chat
operations, read-only company records, and synthetic vectors returned by a mocked
embedding client. It creates/removes only its temporary test identities and chats;
it never stores fabricated vectors in RDS. Tests prove integration and filtering,
not semantic quality. The calibrated replay test uses saved real similarity
rankings with the actual enabled 0.30 configuration and mocked answer generation.
It verifies HTTP source order, company cases, all three general questions, retry,
and guest isolation without further API calls. Existing grounding/search/history/
auth regressions also pass. FULLTEXT remains available.

Observed limitations are retained rather than tuned away: reciprocal-rank fusion
can promote noisy lexical candidates. Application access was semantic rank 1 but
hybrid rank 2 behind a lexical-only security-incident result. The ambiguous
"away from work" query ranked sick leave first semantically and remote work first
in hybrid, with vacation retained at rank 3. All ten company queries have a target
in the top five; top-one target rates are 7/10 raw FULLTEXT, 9/10 semantic, 8/10
hybrid. A larger held-out evaluation is needed before claiming broad reliability.
