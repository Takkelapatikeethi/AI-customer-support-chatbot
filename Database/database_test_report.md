# Database test report

Database: `chatbot_db` (AWS RDS MySQL)

Run time (UTC): 2026-10-21T02:09:40.404Z

Result: PASSED; 29 checks passed.

- PASS: Connected to chatbot_db
- PASS: TLS with AWS CA verification
- PASS: Five tables use transactional InnoDB
- PASS: Insert linked records in all five tables
- PASS: Read joined conversation in order
- PASS: Document default status
- PASS: Default creation timestamp
- PASS: Update and read document
- PASS: Update and read feedback
- PASS: Duplicate email rejected
- PASS: Null message content rejected
- PASS: Duplicate feedback rejected
- PASS: Rating 0 rejected
- PASS: Rating 6 rejected
- PASS: Invalid thumbs value rejected
- PASS: Feedback without vote or rating rejected
- PASS: Invalid role rejected in non-strict mode
- PASS: Invalid document status rejected in non-strict mode
- PASS: Session foreign key enforced
- PASS: Message foreign key enforced
- PASS: Document foreign key enforced
- PASS: Feedback message foreign key enforced
- PASS: Feedback user foreign key enforced
- PASS: User deletion cascades to sessions
- PASS: User deletion cascades to messages
- PASS: User deletion cascades to feedback
- PASS: Document retained with null uploader
- PASS: Test transaction rolled back
- PASS: All six test records absent after rollback

The initial run found that non-strict SQL mode accepted invalid ENUM inputs as empty values. Added explicit CHECK constraints for message roles and document statuses, then reran the tests.

All test records were rolled back. Auto-increment counters may advance even after rollback.

Scope: direct database access, CRUD, relationships, and validation. Backend integration, load testing, backups, and application-level feedback authorization were not tested.
