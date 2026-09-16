import json
import os
import sys

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

DEDUPE_COLUMNS = ("business_name", "business_type", "address", "phone_number", "website")


def push_to_supabase(json_file_path="leads.json"):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("Error: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env.local.")
        print("bizmap_leads has RLS enabled with no anon insert policy, so a service-role key is required to write.")
        sys.exit(1)

    # Service-role key bypasses RLS for server-side writes, same as the app's API routes.
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    try:
        with open(json_file_path, "r", encoding="utf-8") as f:
            leads_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Could not find {json_file_path}")
        return

    print(f"Found {len(leads_data)} leads in {json_file_path}.")

    # bizmap_leads has no unique constraint, and a prior migration already had
    # to purge ~16k exact-duplicate rows from earlier scraper runs. Dedupe
    # against what's already in the table before inserting anything new.
    existing = supabase.table("bizmap_leads").select(",".join(DEDUPE_COLUMNS)).execute()
    existing_keys = {tuple(row.get(col) for col in DEDUPE_COLUMNS) for row in existing.data}
    print(f"Found {len(existing_keys)} existing rows in bizmap_leads for dedupe.")

    new_rows = []
    skipped = 0
    for lead in leads_data:
        key = tuple(lead.get(col) for col in DEDUPE_COLUMNS)
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)  # guard against duplicates within the input file itself
        new_rows.append(lead)

    print(f"{len(new_rows)} new rows to insert ({skipped} already present, skipped).")

    if not new_rows:
        print("Nothing new to upload.")
        return

    batch_size = 500
    inserted = 0
    for i in range(0, len(new_rows), batch_size):
        batch = new_rows[i:i + batch_size]
        try:
            supabase.table("bizmap_leads").insert(batch).execute()
            inserted += len(batch)
            print(f"Uploaded batch {i // batch_size + 1} (rows {i} to {i + len(batch)})")
        except Exception as e:
            print(f"Error uploading batch {i // batch_size + 1}: {e}")

    print(f"\nDone. Inserted {inserted} new rows into bizmap_leads ({skipped} duplicates skipped).")


if __name__ == "__main__":
    json_path = sys.argv[1] if len(sys.argv) > 1 else "leads.json"
    push_to_supabase(json_path)
