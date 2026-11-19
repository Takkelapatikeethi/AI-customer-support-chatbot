# Fictional company support dataset

## Additional testing records

`company_support_faq.additional.synthetic.json` adds 30 new fictional records with distinct IDs. The original file and its 20 records are unchanged. Combined local dataset: 50 records. The additional records cover IT 7, Security 6, HR 6, Application Access 3, Finance 3, Onboarding 2, and Workplace Policy 3. New topics include printing, slow devices, file recovery, secure sharing, payroll, procurement and office services.

Import verified on November 19, 2026: 30 additions inserted, live table count 50. Read-only SDK verification confirmed all 50 records match the local datasets, including the unchanged original 20, and all 150 standard-question/alternative-phrase lookups return their intended saved answers. The administrator should remove `TemporaryImportAdditionalFaq` from `company-support-dev` after this one-time import to restore its read-only permissions.

All additional records use employee access, active status, fictional NovaTech Solutions source names, two alternative phrases, and no source URLs. The backend matching tests exercise all 50 questions and 100 alternative phrases together.

### Uploading the additions

The local files do not automatically change DynamoDB. In CloudShell, use an identity authorized to perform `dynamodb:PutItem` on `company_support_faq` in `us-east-1`. The application's read-only `company-support-dev` user cannot import records; do not broaden its permissions for this operation.

Upload **both** `company_support_faq.additional.synthetic.json` and `import_additional_faq.py` into the same CloudShell directory using Actions > Upload file. Then run each command separately:

```bash
python3 ~/import_additional_faq.py
python3 ~/import_additional_faq.py --apply
aws dynamodb scan --region us-east-1 --table-name company_support_faq --select COUNT --consistent-read --query Count --output text --no-cli-pager
```

The first command previews and validates with no AWS calls. The second inserts missing IDs only and skips any existing IDs without overwriting them. It uses the standard-library Python and AWS CLI available in CloudShell; no packages are installed. It stops on the first unexpected AWS error and reports partial counts; rerunning safely skips completed IDs. It never deletes records or creates resources. The expected final count is **50**, provided the original 20 remain and no other records have been added. AWS writes and verification reads may incur normal usage charges.

No application restart is required after importing because runtime retrieval does not cache answers. The SDK check (`npm run check:dynamodb` from `server`) reports the current active employee count and verifies representative original answers without enforcing a fixed dataset size.

## Original 20-record dataset

`company_support_faq.synthetic.json` contains exactly 20 demonstration FAQs for the fictional NovaTech Solutions. Every policy, process, portal name and answer is synthetic. Nothing represents a real employer or verified company policy. Review and replace these answers before real employee use.

Category counts: IT Support 5; Information Security 4; HR 4; Application Access 2; Finance 2; Employee Onboarding 2; Workplace Policy 1.

Each record contains a stable `id`, a standard `question`, two `alternativePhrases`, `keywords`, an approved-answer placeholder in `answer`, and source/department metadata. `sourceUrl` is null; there are no invented public links. `isSynthetic` is true on every record. The source names are fictional references, not existing source documents.

These datasets use ordinary application JSON, not DynamoDB AttributeValue JSON or ready-to-run BatchWriteItem requests. The accompanying importer converts the additional records to DynamoDB attributes and conditionally inserts missing IDs. The original 20 were uploaded separately through CloudShell.

DynamoDB does not train on these records or perform automatic natural-language matching. Backend lookup/matching logic is still needed to use questions, phrases and keywords. For this small demonstration, that logic can be designed separately before creating AWS resources.

All items are marked `accessLevel: employee`; metadata alone does not enforce access. The DynamoDB reply flow checks server-side authenticated sessions and does not retrieve company answers for guests. Registration alone does not establish actual employment; a real deployment needs a way to verify employee access.

The dataset file itself does not create resources or insert records. The 20 records were subsequently imported through CloudShell, and the backend integration is documented in `../DYNAMODB_SUPPORT.md`. React and MySQL accounts/history remain unchanged.
