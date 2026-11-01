"""
Bridge between bizmap_leads (Supabase) and the automated WhatsApp sequence
that Make.com runs for BizMapShield.

The app's /api/outreach/dispatch route stays the only thing that sends: it
posts a batch to the Make webhook and moves each lead Queued -> Pitch Sent,
with a status guard and a per-number dedupe, so a lead is never pitched
twice. This module never writes to bizmap_leads and never calls Make. It:

  * lists the high-score leads (lead_score >= 8 by default) that the next
    dispatch would pick, with name, phone, score and outreach status
    (read-only, same rules as dispatchPitches in src/lib/outreachAutomation.ts);
  * triggers the dispatch route, as a dry run unless --send is passed.

Usage:
  python outreach_bridge.py                      # list leads ready for a pitch
  python outreach_bridge.py --json ready.json    # also save them as JSON
  python outreach_bridge.py --dispatch           # dry run of the next batch on the server
  python outreach_bridge.py --dispatch --send    # really send the next batch

Settings, from .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
OUTREACH_APP_URL (deployed app, e.g. https://<project>.vercel.app),
OUTREACH_AUTOMATION_SECRET, and optionally OUTREACH_MIN_LEAD_SCORE.
"""

import argparse
import json
import os
import re
import sys

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(".env.local")

DEFAULT_MIN_LEAD_SCORE = 8

# Keep in step with src/lib/outreachAutomation.ts.
CR_NUMBER = r"^506[0-9]{8}$"
CR_MOBILE_NUMBER = r"^506[5-8][0-9]{7}$"
CONTACTED_STATUSES = [
    "Pitch Sent", "Followup Sent", "Replied", "Closed",
    "No WhatsApp (landline)", "No WhatsApp (mobile)", "Invalid Number", "Wrong Business",
]
PAGE_SIZE = 1000  # PostgREST's row cap per select
IN_CHUNK = 200  # phones per .in_() filter, to keep URLs short


def env_min_score():
    raw = os.environ.get("OUTREACH_MIN_LEAD_SCORE", "").strip()
    if not raw:
        return DEFAULT_MIN_LEAD_SCORE
    if not raw.isdigit() or int(raw) > 10:
        sys.exit("OUTREACH_MIN_LEAD_SCORE must be a whole number from 0 to 10.")
    return int(raw)


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env.local.")
    return create_client(url, key)


def fetch_ready_leads(supabase: Client, min_score=DEFAULT_MIN_LEAD_SCORE, mobile_only=True):
    """
    Returns the Queued leads the pitch dispatch would send to, best first:
    score >= min_score, no reply, a Costa Rican (mobile) WhatsApp number, and
    one lead per number, skipping numbers another row has already contacted.
    """
    rows = []
    offset = 0
    while True:
        query = (
            supabase.table("bizmap_leads")
            .select("id,business_name,wa_phone,lead_score,outreach_status,created_at")
            .eq("outreach_status", "Queued")
            .eq("has_replied", False)
            .filter("wa_phone", "match", CR_MOBILE_NUMBER if mobile_only else CR_NUMBER)
        )
        if min_score > 0:
            query = query.gte("lead_score", min_score)
        page = (
            query.order("lead_score", desc=True)
            .order("created_at")
            .order("id")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    phones = sorted({row["wa_phone"] for row in rows})
    contacted = set()
    for i in range(0, len(phones), IN_CHUNK):
        result = (
            supabase.table("bizmap_leads")
            .select("wa_phone")
            .in_("wa_phone", phones[i:i + IN_CHUNK])
            .in_("outreach_status", CONTACTED_STATUSES)
            .execute()
        )
        contacted.update(row["wa_phone"] for row in result.data)

    ready = []
    seen = set(contacted)
    for row in rows:
        if row["wa_phone"] in seen:
            continue
        seen.add(row["wa_phone"])
        ready.append({
            "lead_id": row["id"],
            "business_name": (row.get("business_name") or "").strip(),
            "phone": f"+{row['wa_phone']}",
            "lead_score": row.get("lead_score") or 0,
            "outreach_status": row["outreach_status"],
        })
    return ready, len(rows) - len(ready)


def trigger_dispatch(min_score, limit, dry_run=True, mobile_only=True):
    """
    Calls /api/outreach/dispatch on the deployed app, which picks, dedupes,
    sends to Make and updates outreach_status. Returns the route's JSON reply.
    """
    app_url = os.environ.get("OUTREACH_APP_URL", "").strip().rstrip("/")
    secret = os.environ.get("OUTREACH_AUTOMATION_SECRET", "").strip()
    if not re.match(r"^https?://", app_url):
        sys.exit("Set OUTREACH_APP_URL in .env.local to the deployed app, e.g. https://<project>.vercel.app")
    if not secret:
        sys.exit("OUTREACH_AUTOMATION_SECRET not found in .env.local.")

    params = {"min_score": min_score, "limit": limit, "mobile_only": int(mobile_only)}
    if dry_run:
        params["dry_run"] = 1
    response = requests.post(
        f"{app_url}/api/outreach/dispatch",
        params=params,
        headers={"Authorization": f"Bearer {secret}"},
        timeout=120,
    )
    try:
        body = response.json()
    except ValueError:
        body = {"error": response.text[:500]}
    if not response.ok:
        sys.exit(f"Dispatch failed (HTTP {response.status_code}): {body.get('error', body)}")
    return body


def print_leads(leads):
    for lead in leads:
        print(f"  {lead['lead_score']:>2}  {lead['phone']}  {lead['outreach_status']:<7}  {lead['business_name']}")


def main():
    # Business names carry accents and other non-ASCII; a Windows console
    # defaults to cp1252 and would crash printing them.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--min-score", type=int, default=None,
                        help=f"lowest lead_score to pitch, 0-10 (default: OUTREACH_MIN_LEAD_SCORE or {DEFAULT_MIN_LEAD_SCORE})")
    parser.add_argument("--include-landlines", action="store_true",
                        help="also consider landlines (2/4 prefix), which rarely have WhatsApp")
    parser.add_argument("--json", metavar="PATH", help="save the ready leads to this JSON file")
    parser.add_argument("--dispatch", action="store_true",
                        help="ask the app to dispatch the next batch (dry run unless --send)")
    parser.add_argument("--send", action="store_true", help="with --dispatch: really send to Make")
    parser.add_argument("--limit", type=int, default=25, help="batch size for --dispatch (1-100, default 25)")
    args = parser.parse_args()

    min_score = env_min_score() if args.min_score is None else args.min_score
    if not 0 <= min_score <= 10:
        parser.error("--min-score must be from 0 to 10")
    if args.send and not args.dispatch:
        parser.error("--send only works with --dispatch")
    mobile_only = not args.include_landlines

    if args.dispatch:
        result = trigger_dispatch(min_score, args.limit, dry_run=not args.send, mobile_only=mobile_only)
        mode = "DRY RUN, nothing sent" if result.get("dry_run") else "SENT to Make"
        print(f"{mode}: {result['dispatched']} pitches (min_score {result.get('min_score')}, "
              f"{result['skipped_duplicates']} duplicate numbers skipped).")
        print_leads(result["leads"])
        return

    leads, skipped = fetch_ready_leads(get_supabase(), min_score, mobile_only)
    kind = "number" if args.include_landlines else "mobile number"
    print(f"{len(leads)} Queued leads with lead_score >= {min_score} and a CR {kind} are ready for a pitch "
          f"({skipped} skipped: number already contacted or listed twice).")
    print_leads(leads)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(leads, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(leads)} leads to {args.json}")


if __name__ == "__main__":
    main()
