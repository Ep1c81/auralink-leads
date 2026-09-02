import requests
import json

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
    extracted_leads = discover_leads_gam()
    
    if extracted_leads:
        save_to_json(extracted_leads)
        print("\nSample Real Lead Extracted:")
        print(json.dumps(extracted_leads[0], indent=2, ensure_ascii=False))
    else:
        print("No leads found. Check the Overpass query.")