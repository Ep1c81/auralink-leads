import json
from supabase import create_client, Client

SUPABASE_URL = "https://paggxsvqosfduuqlgydl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDcwNTAsImV4cCI6MjEwMjkyMzA1MH0.G9cmY4_dFX7ab6cOgYdlWnvRBbVHL4KK6IEccCpRTac"

def craft_outreach_message(lead):
    name = lead.get("business_name", "Local Business")
    biz_type = lead.get("business_type", "establishment")
    notes = lead.get("ai_notes", "")
    
    if "Missing digital web presence" in notes:
        pitch = f"noticed your {biz_type} is killing it locally, but you don't have a dedicated web presence yet. At Auralinkdigital.com, we build high-converting web apps that get local businesses ranking and capturing traffic."
    else:
        pitch = f"love what you're doing at {name}. With high foot-traffic in your niche, we help spots like yours double their 5-star Google reviews automatically using smart NFC standees."

    message = f"Hola team at {name}! I {pitch} Let's connect if you're open to scaling your digital footprint this month."
    return message

def run_outreach_generator():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    print("Fetching 'Hot Leads' from Supabase...")
    response = supabase.table("bizmap_leads").select("*").eq("status", "Hot Lead").limit(10).execute()
    hot_leads = response.data
    
    if not hot_leads:
        print("No Hot Leads found yet.")
        return
        
    print("\nGenerated Personalized Outreach for Top Prospects:\n" + "="*50)
    
    for lead in hot_leads:
        msg = craft_outreach_message(lead)
        print(f"\nTarget: {lead.get('business_name')} ({lead.get('business_type')})")
        print(f"Score: {lead.get('lead_score')} / 10")
        print(f"Draft Message:\n\"{msg}\"")
        print("-" * 50)

if __name__ == "__main__":
    run_outreach_generator()
