"""
B2B lead generator for Google Maps reputation-management outreach.

Queries OpenStreetMap (Overpass API) for businesses in Santa Ana, Escazu,
San Jose (central), and Belen, Costa Rica, filters for candidates that look
like they need Google review / local-visibility help, and writes the result
to gmaps_review_prospects.csv.
"""
import csv
import json
import sys
import time

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "prospect-lead-engine/1.0 (gmaps-review-prospects)"}

# [South-Lat, West-Lon, North-Lat, East-Lon] per canton, kept tight to avoid
# pulling in unrelated GAM cantons.
LOCATIONS = {
    "Santa Ana": (9.910, -84.220, 9.945, -84.155),
    "Escazu": (9.905, -84.170, 9.945, -84.115),
    "San Jose": (9.920, -84.115, 9.960, -84.050),
    "Belen": (9.975, -84.230, 10.005, -84.180),
}

# amenity/shop tag -> (human-readable category, pitch angle)
CATEGORY_MAP = {
    "dentist": ("Dental Clinic", "Patients Google a dentist before booking — a thin or stale review profile sends them to a competitor's listing instead."),
    "clinic": ("Dental Clinic", "Patients Google a dentist before booking — a thin or stale review profile sends them to a competitor's listing instead."),
    "car_repair": ("Auto Repair Shop", "Drivers pick a shop by star rating when their car breaks down — few or no reviews reads as unproven, even with great work."),
    "hairdresser": ("Beauty Salon/Barbershop", "Walk-in beauty traffic is driven almost entirely by nearby Google star ratings and photos."),
    "beauty": ("Beauty Salon/Barbershop", "Walk-in beauty traffic is driven almost entirely by nearby Google star ratings and photos."),
    "hotel": ("Boutique Hotel", "Travelers filter hotels by review score first — a incomplete Maps listing loses bookings to reviewed competitors."),
    "guest_house": ("Boutique Hotel", "Travelers filter hotels by review score first — a incomplete Maps listing loses bookings to reviewed competitors."),
    "veterinary": ("Veterinary Clinic", "Pet owners choose a vet by recent reviews and responsiveness — a quiet profile looks inactive."),
    "restaurant": ("Restaurant", "Diners rely on review volume and recency to pick where to eat — gaps in either cost table turns."),
    "cafe": ("Restaurant", "Diners rely on review volume and recency to pick where to eat — gaps in either cost table turns."),
    "physiotherapist": ("Physical Therapy Center", "Referral patients still verify a clinic on Google before calling — missing reviews undercuts trust built by the referral."),
}

TARGET_TAGS = list(CATEGORY_MAP.keys())


def build_query(bbox):
    south, west, north, east = bbox
    tag_regex = "|".join(TARGET_TAGS)
    return f"""
    [out:json][timeout:60];
    (
      node["amenity"~"^({tag_regex})$"]({south},{west},{north},{east});
      way["amenity"~"^({tag_regex})$"]({south},{west},{north},{east});
      node["shop"~"^({tag_regex})$"]({south},{west},{north},{east});
      way["shop"~"^({tag_regex})$"]({south},{west},{north},{east});
      node["healthcare"~"^({tag_regex})$"]({south},{west},{north},{east});
      node["tourism"~"^({tag_regex})$"]({south},{west},{north},{east});
      way["tourism"~"^({tag_regex})$"]({south},{west},{north},{east});
    );
    out center tags;
    """


def fetch_location(name, bbox, retries=3):
    query = build_query(bbox)
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(OVERPASS_URL, data=query.encode("utf-8"), headers=HEADERS, timeout=90)
        except requests.RequestException as exc:
            print(f"  [{name}] request failed (attempt {attempt}/{retries}): {exc}")
            time.sleep(5)
            continue

        if resp.status_code == 200:
            return resp.json().get("elements", [])

        print(f"  [{name}] Overpass returned {resp.status_code} (attempt {attempt}/{retries})")
        time.sleep(5)

    print(f"  [{name}] giving up after {retries} attempts.")
    return []


def classify_tag(tags):
    for key in ("amenity", "shop", "healthcare", "tourism"):
        val = tags.get(key)
        if val in CATEGORY_MAP:
            category, base_pitch = CATEGORY_MAP[val]
            return val, category, base_pitch
    return None


def normalize_phone(tags):
    for key in ("contact:phone", "phone", "contact:mobile", "mobile"):
        val = tags.get(key)
        if val:
            return val.strip()
    return ""


def has_whatsapp(tags, phone):
    if tags.get("contact:whatsapp") or tags.get("whatsapp"):
        return "Yes"
    # Costa Rica mobile numbers (leading 6, 7, or 8) are commonly WhatsApp-reachable.
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) >= 8 and digits[-8] in ("6", "7", "8"):
        return "Likely"
    return "No" if phone else "Unknown"


def build_pitch(base_pitch, has_website, has_phone, name):
    angle = base_pitch
    if not has_website:
        angle += f" {name} has no listed website, so the Google Business Profile is likely their entire online storefront."
    if not has_phone:
        angle += " No contact number on file also means missed calls aren't being recovered."
    return angle


def collect_prospects():
    all_rows = []
    seen = set()

    for loc_name, bbox in LOCATIONS.items():
        print(f"Querying Overpass for {loc_name}...")
        elements = fetch_location(loc_name, bbox)
        print(f"  -> {len(elements)} raw elements returned")

        for elem in elements:
            tags = elem.get("tags", {})
            name = tags.get("name")
            if not name:
                continue

            category_info = classify_tag(tags)
            if not category_info:
                continue
            raw_tag, category, base_pitch = category_info

            phone = normalize_phone(tags)
            if not phone:
                # Filtering logic requires valid contact info — skip businesses without a phone.
                continue

            dedupe_key = (name.strip().lower(), loc_name)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            website = tags.get("website") or tags.get("contact:website") or ""
            has_website = bool(website)
            whatsapp_ready = has_whatsapp(tags, phone)
            pitch = build_pitch(base_pitch, has_website, bool(phone), name)

            all_rows.append({
                "Business Name": name,
                "Category": category,
                "Canton/Location": loc_name,
                "Phone": phone,
                "WhatsApp Ready": whatsapp_ready,
                "Website Present (Yes/No)": "Yes" if has_website else "No",
                "Google Review Pitch Angle": pitch,
                # Raw fields, kept alongside the human-facing CSV columns above
                # so the Supabase export doesn't lose the actual website URL
                # behind a Yes/No flag.
                "_raw_tag": raw_tag,
                "_raw_website": website,
            })

        time.sleep(2)  # be polite to the shared public Overpass instance

    return all_rows


def save_csv(rows, filename="gmaps_review_prospects.csv"):
    fieldnames = [
        "Business Name",
        "Category",
        "Canton/Location",
        "Phone",
        "WhatsApp Ready",
        "Website Present (Yes/No)",
        "Google Review Pitch Angle",
    ]
    with open(filename, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows({k: r[k] for k in fieldnames} for r in rows)
    print(f"\nSaved {len(rows)} prospects to {filename}")


def save_bizmap_json(rows, filename="gmaps_review_prospects_bizmap.json"):
    """
    Mirrors the bizmap_leads table schema (business_name, business_type,
    address, website, phone_number, source, needs_website, status, lead_score,
    ai_notes) so push_to_supabase.py can insert these rows directly.
    """
    records = []
    for r in rows:
        website = r["_raw_website"] or "N/A"
        records.append({
            "business_name": r["Business Name"],
            "business_type": r["_raw_tag"],
            "address": r["Canton/Location"],
            "website": website,
            "phone_number": r["Phone"],
            "source": "OpenStreetMap-CR-Cantons",
            "needs_website": website == "N/A",
            "status": "New",
            "lead_score": 0,
            "ai_notes": r["Google Review Pitch Angle"],
        })

    with open(filename, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(records)} bizmap_leads-shaped records to {filename}")


def main():
    rows = collect_prospects()
    if not rows:
        print("No prospects with valid contact info were found. Nothing written.")
        sys.exit(1)

    save_csv(rows)
    save_bizmap_json(rows)

    no_website = sum(1 for r in rows if r["Website Present (Yes/No)"] == "No")
    by_location = {}
    for r in rows:
        by_location[r["Canton/Location"]] = by_location.get(r["Canton/Location"], 0) + 1

    print("\n=== Summary ===")
    print(f"Total prospects: {len(rows)}")
    print(f"Missing a website (strong review-optimization candidates): {no_website}")
    for loc, count in by_location.items():
        print(f"  {loc}: {count}")


if __name__ == "__main__":
    main()
