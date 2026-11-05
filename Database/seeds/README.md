# Fictional company support dataset

`company_support_faq.synthetic.json` contains exactly 20 demonstration FAQs for the fictional NovaTech Solutions. Every policy, process, portal name and answer is synthetic. Nothing represents a real employer or verified company policy. Review and replace these answers before real employee use.

Category counts: IT Support 5; Information Security 4; HR 4; Application Access 2; Finance 2; Employee Onboarding 2; Workplace Policy 1.

Each record contains a stable `id`, a standard `question`, two `alternativePhrases`, `keywords`, an approved-answer placeholder in `answer`, and source/department metadata. `sourceUrl` is null; there are no invented public links. `isSynthetic` is true on every record. The source names are fictional references, not existing source documents.

This is ordinary application JSON, not DynamoDB AttributeValue JSON or a ready-to-run BatchWriteItem request. It has not been uploaded. A future importer can map `id` to a String partition key and the remaining fields to DynamoDB attributes. Stable IDs support repeatable importing, but overwriting existing IDs requires an explicit import strategy; this file alone does not provide idempotency.

DynamoDB does not train on these records or perform automatic natural-language matching. Backend lookup/matching logic is still needed to use questions, phrases and keywords. For this small demonstration, that logic can be designed separately before creating AWS resources.

All items are marked `accessLevel: employee`; this is metadata, not access enforcement. The current guest-enabled MySQL FAQ flow must not be connected to this internal dataset without server-side authenticated-account checks. Registration alone also does not establish actual employment; a real deployment needs a way to verify employee access.

The dataset file itself does not create resources or insert records. The 20 records were subsequently imported through CloudShell, and the backend integration is documented in `../DYNAMODB_SUPPORT.md`. React and MySQL accounts/history remain unchanged.
