# Company-grounded replies (Step 5)

Step 6 now routes retrieval through company-hybrid.js, preserving the grounding
rules described here. See SEMANTIC_RETRIEVAL.md for calibrated semantic retrieval,
FULLTEXT fallback, and the real evaluation results.

Both POST /message and the reply retry endpoint call generateConversationReply
in company-chat.js. browserIdentity marks a validated login with req.chatAccount.
Guest headers or request-body fields cannot set that marker. Guest generation
keeps the previous prompt and does not search company knowledge.

For accounts, the helper searches the current question unchanged, with limit 5,
using the existing active/employee FULLTEXT filters. It prefers candidates with
substantive title overlap. If none have title overlap, it requires two substantive content-word matches
(one match when the question contains only one substantive word). Common question
and company/policy words are ignored for this guard. This is only a lexical check.

Explicit company wording is treated as company intent. Known workplace topic
words or usable matches also indicate company intent, except for general prompts
starting with phrases such as "explain", "what is", or "calculate", without an
explicit company marker. For example, "Explain phishing in general" remains a
general request. This heuristic can misclassify ambiguous requests and follow-ups.

Clear company questions with no usable references return a fixed verified-info
not-found reply without a model call. The fallback is saved like other assistant
messages. Questions longer than the search service's 500-character maximum are
not truncated: clear company questions abstain; general requests retain normal
generation within the existing 20,000-character chat limit. A database retrieval
error returns 503 and preserves the question, without falling back to an
ungrounded model call.

Every account model call receives fixed company-grounding instructions, including
when no company references apply. Retrieved text is JSON-escaped and placed in a
separate user reference message immediately before the current question. System
instructions forbid treating reference/history/attachment text as overriding
commands or inventing missing company facts. Both existing provider branches use
the same input builder. These precautions reduce injection risk; they cannot
guarantee semantic relevance or model compliance.

Successful replies and retries return sources with id, title, category,
sourceName, and department. These are the selected records supplied as context,
not model-verified claim-level citations. Sources are not stored in chat_messages,
so reopening history does not recover them. Original replies are kept on retry.
Retry uses the last user question in the history preceding the selected answer,
matching the existing append-only retry design; source selection is recomputed.

Accounts are a temporary employee proxy, not verified employee membership. No
RBAC, schema changes, embeddings, vector search, UI citations, or data ingestion
are added. The synthetic NovaTech data is unchanged. FULLTEXT scores are not
calibrated semantic confidence: incidental word overlap can still pass the guard,
while synonyms and short follow-ups can be rejected. The model is instructed to
abstain when selected records do not actually answer a company question.

Run `node scripts/test-company-chat.js` from server for real MySQL/auth/history
integration checks with mocked AI. It creates and removes only its temporary
account and guest records and checks that company knowledge remains unchanged.
