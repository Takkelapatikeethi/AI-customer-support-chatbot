# Fictional support FAQ data

The two JSON files contain 20 original and 30 additional fictional NovaTech Solutions records. They are test data, not real employer policies or AI training data.

From `server`, run `npm run import:faq` to apply the additive MySQL FAQ migration, import missing records, and verify all 50 records and 150 question variants. Reruns skip identical IDs and refuse to overwrite differing data. See `../MYSQL_SUPPORT.md`.
