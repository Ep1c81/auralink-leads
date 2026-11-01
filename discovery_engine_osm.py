import requests
import json
import os
from concurrent.futures import ThreadPoolExecutor

import anthropic
from dotenv import load_dotenv

# Placeholder values the scraper writes when OSM has no phone tag.
MISSING_PHONE_VALUES = {"", "n/a", "na", "none", "null"}

SCORING_MODEL = "claude-haiku-5-5"
SCORING_WORKERS = 8

SCORING_SYSTEM_PROMPT = """You qualify local Costa Rican businesses as sales leads for a digital agency that sells NFC Google-review cards and website design/hosting.
Every business you see already has a working phone number. Score how good a target it is from 1 to 10:
- 8-10: the business has NO website. These are ideal targets for both the NFC review cards and a new website. Use 10 for high foot-traffic, review-driven businesses (restaurants, cafes, bars, salons, beauty, clinics, dentists, veterinarians) and 8-9 for the rest.
- 1-5: the business ALREADY has a website. Use 4-5 for high foot-traffic, review-driven businesses that could still use NFC review cards, and 1-3 for the rest.
Never return 6 or 7."""

SCORE_SCHEMA = {
    "type": "object",
    "properties": {"score": {"type": "integer"}},
    "required": ["score"],
    "additionalProperties": False,
}

def has_phone(lead):
    phone = lead.get("phone_number")
    return isinstance(phone, str) and phone.strip().lower() not in MISSING_PHONE_VALUES

def drop_leads_without_phone(leads):
    """
    Drops leads whose phone number is missing, blank, or a placeholder like "N/A".
    """
    return [lead for lead in leads if has_phone(lead)]

def ai_score_lead(client, lead):
    """
    Asks Claude for a 1-10 lead score. Returns None if the call fails so the
    lead keeps the table default (lead_score = 0) and src/qualify_leads.py can
    still pick it up later.
    """
    website_status = "No website" if lead.get("needs_website") else f"Has website: {lead.get('website')}"
    lead_details = (
        f"Business name: {lead.get('business_name')}\n"
        f"Business type: {lead.get('business_type')}\n"
        f"Website status: {website_status}"
    )

    try:
        response = client.messages.create(
            model=SCORING_MODEL,
            max_tokens=2048,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCORE_SCHEMA}},
            system=SCORING_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": lead_details}],
        )
    except anthropic.AuthenticationError:
        raise
    except anthropic.APIError as e:
        print(f"  AI scoring failed for {lead.get('business_name')!r}: {e}")
        return None

    if response.stop_reason != "end_turn":
        print(f"  AI scoring stopped early ({response.stop_reason}) for {lead.get('business_name')!r}")
        return None

    text = next((block.text for block in response.content if block.type == "text"), "")
    score = json.loads(text)["score"]
    return max(1, min(10, int(score)))

def score_leads_with_ai(leads):
    """
    Adds an AI-generated lead_score (1-10) to each lead in place. lead_score is
    the existing bizmap_leads column the dashboard sorts and displays.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("AI scoring skipped: ANTHROPIC_API_KEY not found in .env.local. Leads will upload with lead_score = 0.")
        return leads

    client = anthropic.Anthropic()
    print(f"Scoring {len(leads)} leads with {SCORING_MODEL}...")

    try:
        with ThreadPoolExecutor(max_workers=SCORING_WORKERS) as pool:
            scores = list(pool.map(lambda lead: ai_score_lead(client, lead), leads))
    except anthropic.AuthenticationError:
        print("AI scoring skipped: ANTHROPIC_API_KEY was rejected. Leads will upload with lead_score = 0.")
        return leads

    for lead, score in zip(leads, scores):
        if score is not None:
            lead["lead_score"] = score

    scored = sum(score is not None for score in scores)
    print(f"AI scored {scored}/{len(leads)} leads.")
    return leads

def discover_leads_gam():
    """
    Queries OpenStreetMap for a massive variety of SMBs across the entire Costa Rican GAM.
    """
    url = "https://overpass-api.de/api/interpreter"
    
    # Bounding Box for the GAM: [South-Lat, West-Lon, North-Lat, East-Lon]
    # This covers Alajuela, Heredia, San José, Cartago, Escazú, Santa Ana, etc.
    query = """
    [out:json][timeout:90];
    (
      node["amenity"~"restaurant|cafe|bar|clinic|dentist|veterinary|pharmacy"](9.75, -84.40, 10.15, -83.70);
      way["amenity"~"restaurant|cafe|bar|clinic|dentist|veterinary|pharmacy"](9.75, -84.40, 10.15, -83.70);
      node["shop"~"hairdresser|beauty|car_repair|clothes|bakery|supermarket|hardware"](9.75, -84.40, 10.15, -83.70);
      way["shop"~"hairdresser|beauty|car_repair|clothes|bakery|supermarket|hardware"](9.75, -84.40, 10.15, -83.70);
    );
    out center tags;
    """
    
    headers = {
        "User-Agent": "Auralinkdigital.com-Lead-Engine/2.0"
    }
    
    print("Initializing massive GAM sweep for SMBs (this may take up to 30 seconds)...")
    
    response = requests.post(url, data=query.encode('utf-8'), headers=headers)
    
    if response.status_code != 200:
        print(f"Error fetching data: {response.status_code}\nDetails: {response.text}")
        return []
        
    data = response.json()
    elements = data.get("elements", [])
    
    leads = []
    for elem in elements:
        tags = elem.get("tags", {})
        name = tags.get("name")
        
        if not name:
            continue
            
        phone = tags.get("phone") or tags.get("contact:phone") or "N/A"
        website = tags.get("website") or tags.get("contact:website") or "N/A"
        
        # Identify the business type for better filtering later
        biz_type = tags.get("amenity") or tags.get("shop") or "SMB"
        
        lead = {
            "business_name": name,
            "business_type": biz_type,
            "address": "GAM, Costa Rica", # Broad address fallback
            "website": website,
            "phone_number": phone,
            "source": "OpenStreetMap",
            "needs_website": website == "N/A"
        }
        leads.append(lead)
        
    return leads

def save_to_json(data, filename="leads.json"):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print(f"\nSuccessfully saved {len(data)} REAL leads to {filename}")

if __name__ == "__main__":
    scraped_leads = discover_leads_gam()
    extracted_leads = drop_leads_without_phone(scraped_leads)
    print(f"Dropped {len(scraped_leads) - len(extracted_leads)} leads with no phone number; {len(extracted_leads)} remain.")

    if extracted_leads:
        load_dotenv(".env.local")
        score_leads_with_ai(extracted_leads)
        save_to_json(extracted_leads)
        print("\nSample Real Lead Extracted:")
        print(json.dumps(extracted_leads[0], indent=2, ensure_ascii=False))
    else:
        print("No leads found. Check the Overpass query.")