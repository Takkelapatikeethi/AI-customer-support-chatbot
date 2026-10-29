# Step 6: real embedding and retrieval evaluation

## Completion

- Model/provider: configured OpenAI, text-embedding-3-small, 1536 dimensions.
- Indexing: 20 processed, 20 created, 0 updated, 0 skipped, 0 failed.
- Read-only validation: 20/20 vectors valid and current; no stale vectors.
- Approved embedding requests completed: 20 indexing + 13 evaluation = 33.
- Calibration/replay/regression tests made zero additional external API calls.
- Final indexing dry run: 20 skipped, 0 requiring embeddings, 0 API calls.
- No company knowledge records were modified. No React, authentication, vector
  database, S3, PDF ingestion, or additional company data changes were made.

## Calibrated configuration

```
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
COMPANY_KNOWLEDGE_MIN_SIMILARITY=0.30
COMPANY_KNOWLEDGE_SEMANTIC_ENABLED=true
```

The strongest unrelated match was 0.1398054. The weakest best expected-company
topic match was 0.3124421. The initial 0.30 threshold excludes many incidental
0.20–0.29 matches rather than using the much looser midpoint of that gap. It
intentionally excludes the secondary MFA result (0.2992172) for the sign-in
question while retaining password recovery (0.3315302).

This is provisional small-corpus calibration, not a probability or guarantee.
The margin for the weakest expected topic is only 0.0124. A larger held-out set
is needed before claiming production reliability. No threshold was selected from
mocked scores, and the policies were not changed to improve results.

## Ranking and filtering

Semantic candidates are authorized, active, current-model/current-provider
vectors with cosine similarity at least 0.30. FULLTEXT remains available and its
chat candidates pass the existing Step 5 lexical guard. Reciprocal-rank fusion
sums 1/(60+rank) for each method, deduplicates knowledge IDs, and limits final
context to five records. Agreement receives votes from both methods. Cosine
scores and MySQL scores are not directly added together.

## Record legend

| ID | Knowledge title |
|---:|---|
| 1 | Company Password Reset |
| 2 | Company Laptop Replacement |
| 3 | Company VPN Troubleshooting |
| 4 | Software Installation Requests |
| 5 | IT Help Desk Escalation |
| 6 | Lost or Stolen Company Device |
| 7 | Phishing Email Reporting |
| 8 | Multi-Factor Authentication Recovery |
| 9 | Security Incident Reporting |
| 10 | Paid Time Off Entitlement |
| 11 | Sick Leave and Absence Notification |
| 12 | Vacation Request and Approval Process |
| 13 | Employee Benefits Information and Enrollment |
| 14 | Requesting Business Application Access |
| 15 | Changing or Removing Application Access |
| 16 | Expense Reimbursement Submission |
| 17 | Business Travel Approval and Expenses |
| 18 | New Employee Technology Setup |
| 19 | First-Week Employee Onboarding |
| 20 | Remote and Hybrid Work Arrangements |

## Complete comparison

IDs refer to the titles above. Lists are ranked. Semantic lists show the top five
BEFORE thresholding, with cosine scores rounded to six decimals. FULLTEXT is raw
database ranking before the Step 5 lexical guard. Hybrid is the actual final
candidate order after semantic thresholding, lexical filtering, and fusion.

| Question | FULLTEXT IDs | Semantic ID:score, ranked | Final hybrid IDs |
|---|---|---|---|
| My computer is broken and I need another one | 2, 5, 14, 6, 8 | 2:0.397026; 6:0.215634; 4:0.199264; 8:0.182366; 18:0.174637 | 2 |
| I clicked a suspicious email | 7, 9, 18 | 7:0.486142; 9:0.326192; 8:0.263705; 6:0.236883; 3:0.227945 | 7, 9 |
| I cannot sign into my account | 3, 1, 18, 7, 10 | 1:0.331530; 8:0.299217; 3:0.280031; 6:0.246002; 9:0.243129 | 1 |
| I need some days off | 10, 12, 3, 14, 20 | 12:0.333065; 10:0.315530; 11:0.312338; 20:0.288051; 15:0.187298 | 10, 12, 11 |
| I paid for something during a business trip | 17, 10, 5, 16, 19 | 17:0.431989; 16:0.322778; 10:0.269004; 2:0.250575; 18:0.245100 | 17, 10, 16 |
| My work machine stopped functioning. | 20, 2, 3, 5, 18 | 2:0.393191; 3:0.281730; 6:0.274859; 1:0.238907; 8:0.234552 | 2, 20 |
| I received a message that looks like someone is trying to steal my credentials. | 7, 1, 3, 14 | 7:0.384138; 1:0.325139; 9:0.324345; 6:0.324309; 8:0.323987 | 7, 1, 9, 6, 8 |
| I need permission to use an internal system. | 14, 5, 9, 20, 1 | 14:0.446267; 4:0.406237; 15:0.364333; 17:0.319245; 12:0.317066 | 9, 14, 4, 15, 17 |
| I will be away from work for several days. | 20, 18, 12, 2, 3 | 11:0.343425; 20:0.327095; 12:0.312442; 10:0.284554; 6:0.230811 | 20, 11, 12 |
| My authentication code isn't working. | 8, 20, 10, 11, 18 | 8:0.363537; 3:0.286174; 1:0.281474; 6:0.218936; 14:0.198736 | 8 |
| What is 2 + 2? | None | 8:0.139805; 5:0.121223; 9:0.105068; 10:0.084444; 4:0.078144 | None |
| What is the capital of France? | None | 17:0.084977; 2:0.074943; 16:0.056000; 3:0.054956; 6:0.051278 | None |
| Explain photosynthesis. | 14 | 18:0.051613; 13:0.048670; 10:0.048575; 16:0.042785; 1:0.038988 | None |

## Measured outcomes and limitations

- Company-query target at rank 1: raw FULLTEXT 7/10, semantic 9/10, hybrid 8/10.
- At least one expected target in top five: 10/10 for all three raw result lists.
- General queries with empty final company context: 3/3.
- Semantic retrieval improves ranking for the sign-in and broken-machine queries.
  It also preserves useful targets that the Step 5 lexical guard had discarded.
- Hybrid fusion is not always better than semantic ranking. For the permission
  query, a lexical-only Security Incident Reporting match ties the leading
  semantic rank vote and wins the deterministic ID tie-break. Application access
  remains rank 2; this limitation was not hidden or tuned away.
- The away-from-work question is ambiguous. Sick leave is semantic rank 1,
  remote work is hybrid rank 1, and vacation is rank 3 in both lists. The model
  must not confidently choose an unsupported leave entitlement from that alone.
- Lexical-only results can survive below the semantic threshold by design,
  preserving FULLTEXT fallback; incidental lexical matches can therefore persist.
- Grounding instructions and authorization remain authoritative. Sources are
  selected references, not verified claim-level citations. Real generated-answer
  quality was not assessed with paid generation calls.

## Tests after enabling

- 8 embedding/hybrid test groups passed, including idempotency, stale detection,
  numeric validation, fail-fast behavior, safe error summaries, and filtering.
- 6 mocked semantic/chat integration groups passed.
- 4 enabled-calibration replay checks passed: all 13 real-score candidate orders
  through HTTP chat, ten company targets, three general questions, retry, guest
  isolation, and unchanged vectors. Answer generation was mocked.
- 11 Step 5 grounding regression groups passed with semantic calls disabled.
- 15 chat-history checks passed, including ownership, feedback, retry, rename,
  pin/unpin, delete, persistence, and attachments.
- Existing authentication and 8 standalone search test groups passed.
- Tests used no additional external API calls. Temporary test identities/chats
  were removed; no fabricated vectors were stored in RDS.

## Step 6 files

Created across Step 6: migration 005, company-embeddings.js, company-hybrid.js,
index-company-knowledge.js, compare-company-retrieval.js, test-company-embeddings.js,
test-company-semantic-chat.js, test-company-calibrated.js, SEMANTIC_RETRIEVAL.md,
and this report plus step6-retrieval-evaluation.json.

Modified: company-chat.js (shared hybrid retrieval and exported lexical guard),
.env.example (documented configuration), server/.env (only threshold and enablement
settings), and COMPANY_CHAT.md (link to Step 6 behavior). No new package or pool.

Restart any already-running backend to load the updated code and environment.
After restart, ordinary authenticated queries/retries may incur query-embedding
charges; the 33-request evaluation itself is complete. No Step 7 work performed.
