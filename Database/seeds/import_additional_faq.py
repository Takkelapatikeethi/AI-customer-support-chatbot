"""CloudShell importer: preview by default; --apply inserts only missing IDs."""
import argparse
import json
import pathlib
import subprocess
import sys


def attribute(value):
    if value is None:
        return {"NULL": True}
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, str):
        return {"S": value}
    if isinstance(value, list):
        return {"L": [attribute(item) for item in value]}
    raise ValueError("Unsupported field type")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--file", type=pathlib.Path, default=pathlib.Path(__file__).with_name("company_support_faq.additional.synthetic.json"))
    args = parser.parse_args()
    records = json.loads(args.file.read_text(encoding="utf-8"))
    if len(records) != 30 or len({record["id"] for record in records}) != 30:
        raise ValueError("Expected exactly 30 unique additional records")
    items = []
    for record in records:
        if (record.get("isSynthetic") is not True or record.get("isActive") is not True
                or record.get("accessLevel") != "employee" or not record.get("answer")
                or not record.get("question") or record.get("companyName") != "NovaTech Solutions"):
            raise ValueError("Invalid fictional employee FAQ record")
        items.append({key: attribute(value) for key, value in record.items()})
    print("Table: company_support_faq; Region: us-east-1")
    print(f"Validated {len(items)} fictional records.")
    if not args.apply:
        print("Preview only. No AWS calls made. Add --apply to insert missing records.")
        return
    inserted = skipped = 0
    for record, item in zip(records, items):
        result = subprocess.run([
            "aws", "dynamodb", "put-item", "--region", "us-east-1",
            "--table-name", "company_support_faq", "--item", json.dumps(item),
            "--condition-expression", "attribute_not_exists(#id)",
            "--expression-attribute-names", '{"#id":"id"}', "--no-cli-pager",
        ], capture_output=True, text=True)
        if result.returncode == 0:
            inserted += 1
        elif "ConditionalCheckFailedException" in result.stderr:
            skipped += 1
        else:
            print(f"Stopped at {record['id']}. Inserted: {inserted}; skipped: {skipped}.", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            raise SystemExit(1)
    print(f"Inserted: {inserted}; skipped existing: {skipped}.")
    print("Import completed. Verify the live table count separately.")


if __name__ == "__main__":
    main()
