# Single-database support answers

The application now uses the existing RDS MySQL pool for accounts, conversations, feedback, and FAQ answers. No DynamoDB calls are made by the default message or retry flow.

Migration `005_mysql_company_support_faq.sql` adds `company_support_faq`. Its string primary key preserves the original FAQ IDs. The JSON `record` preserves every original field, including alternative phrases, keyword arrays, source metadata, and fictional-company flags. Generated access and active columns provide indexed filtering without inconsistent duplicate flags.

Run `npm run import:faq` from `server`. This applies the additive migration, inserts missing IDs transactionally, refuses to overwrite differing existing records, and verifies all 50 records and 150 question variants. Existing account, chat, feedback, and legacy FAQ tables are not modified.

The 50 local seed records are the verified migration source. The remote DynamoDB table has not been deleted or modified. Obsolete DynamoDB tools and dependencies have been removed from the project. Any records added directly to DynamoDB after the original 50-record verification would need a separate export and reconciliation.

Matching retains the original exact/alternative-phrase and lexical scoring rules, ambiguity fallback, employee restriction, and active-record filtering. It uses no AI. The initial small-dataset matcher supports at most 1,000 active employee records and fails rather than returning partial candidates.

Run `npm test` and `npm run test:mysql-chat` from `server`. The latter creates and cleans up temporary test accounts in MySQL and exercises real FAQ reads, retry, history, guest isolation, ownership, and safe failure handling.
