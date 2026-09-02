import json
from supabase import create_client, Client

# --- SETUP YOUR CREDENTIALS HERE ---
SUPABASE_URL = "https://paggxsvqosfduuqlgydl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZ2d4c3Zxb3NmZHV1cWxneWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDcwNTAsImV4cCI6MjEwMjkyMzA1MH0.G9cmY4_dFX7ab6cOgYdlWnvRBbVHL4KK6IEccCpRTac"

def push_to_supabase(json_file_path="leads.json"):
    # 1. Initialize the connection
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # 2. Load the JSON data
    try:
        with open(json_file_path, "r", encoding="utf-8") as f:
            leads_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Could not find {json_file_path}")
        return
        
    print(f"Found {len(leads_data)} leads. Starting upload to Supabase...")
    
    # 3. Batch upload (chunks of 500 to prevent timeouts)
    batch_size = 500
    for i in range(0, len(leads_data), batch_size):
        batch = leads_data[i:i + batch_size]
        try:
            # Insert the batch into the 'bizmap_leads' table
            response = supabase.table("bizmap_leads").insert(batch).execute()
            print(f"Successfully uploaded batch {i // batch_size + 1} (Rows {i} to {i + len(batch)})")
        except Exception as e:
            print(f"Error uploading batch {i // batch_size + 1}: {e}")
            
    print("\nMission Accomplished! All leads have been injected into your database.")

if __name__ == "__main__":
    push_to_supabase()