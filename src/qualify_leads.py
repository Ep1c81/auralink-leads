import json
from supabase import create_client, Client

SUPABASE_URL = "https://paggxsvqosfduuqlgydl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDcwNTAsImV4cCI6MjEwMjkyMzA1MH0.G9cmY4_dFX7ab6cOgYdlWnvRBbVHL4KK6IEccCpRTac"

def evaluate_lead(lead):
    score = 5
    notes = []
    
    biz_type = lead.get("business_type", "").lower()
    website = lead.get("website", "N/A")
    
    high_value_types = ["restaurant", "cafe", "bar", "hairdresser", "beauty", "supermarket"]
    if any(t in biz_type for t in high_value_types):
        score += 3
        notes.append(f"High foot-traffic niche ({biz_type}) ideal for NFC review standees.")
        
    if website == "N/A" or not website:
        score += 2
        notes.append("Missing digital web presence; prime candidate for full web package.")
    else:
        notes.append(f"Has website: {website}")
        
    score = min(score, 10)
    status = "Hot Lead" if score >= 8 else "Standard Lead"
    
    return {
        "lead_score": score,
        "status": status,
        "ai_notes": " | ".join(notes)
    }

def run_full_qualification():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    batch_size = 100
    total_processed = 0
    
    print("Starting full database qualification loop...")
    
    while True:
        # Fetch a batch of leads that haven't been scored yet (lead_score is 0 or default)
        response = supabase.table("bizmap_leads").select("*").eq("lead_score", 0).limit(batch_size).execute()
        leads = response.data
        
        if not leads:
            print(f"\nAll done! Total leads qualified: {total_processed}")
            break
            
        print(f"Processing batch of {len(leads)} leads...")
        
        for lead in leads:
            lead_id = lead["id"]
            evaluation = evaluate_lead(lead)
            
            supabase.table("bizmap_leads").update({
                "lead_score": evaluation["lead_score"],
                "status": evaluation["status"],
                "ai_notes": evaluation["ai_notes"]
            }).eq("id", lead_id).execute()
            
        total_processed += len(leads)
        print(f"Progress: {total_processed} leads processed so far...")

if __name__ == "__main__":
    run_full_qualification()