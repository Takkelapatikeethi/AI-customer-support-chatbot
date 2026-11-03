# Database-only chatbot answers

The backend now returns approved answers from `chatbot_db.faq_answers`; it makes no OpenAI calls, including when retrying a reply. Login and guest access are unchanged. Only add answers suitable for all chatbot users, including guests.

Apply the additive migration from `server`:

```powershell
node scripts/setup-faq.js
```

Add your own approved content through your connected SQL client. Example template (replace the placeholders before executing):

```sql
INSERT INTO chatbot_db.faq_answers (question, answer, keywords)
VALUES ('Your standard question', 'Your approved answer', 'alternative wording, search keywords');
```

Use SQL parameters when inserting from application code. No sample policies or answers are inserted automatically.

Search first checks the exact question, then uses MySQL FULLTEXT on question and keywords. A candidate must cover at least half of the meaningful query words and at least two words (one for single-word queries). Unmatched questions receive a fixed not-found message. This is lexical matching, not semantic understanding; wording and MySQL stopword/minimum-token settings affect results. Follow-ups must state the question explicitly. Retry performs the same lookup and can return the same approved answer.

Attachments remain saved with chat history but are not interpreted to produce answers. Existing historical AI replies remain in history. OpenAI environment settings and the installed dependency may remain unused; neither is required for answering.

Set `is_active = 0` on an FAQ record to stop using it. Stored answers are returned unchanged. No management UI or new public endpoint is added.
