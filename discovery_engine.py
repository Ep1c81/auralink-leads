import requests
import json
import os

def discover_leads(query):
    """
    Searches for businesses using the Google Places API (New) and extracts
    key contact and reputation metrics.
    """
    url = "https://places.googleapis.com/v1/places:searchText"
    
    # Replace YOUR_API_KEY_HERE with your Google Places API Key
    api_key = os.getenv("GOOGLE_PLACES_API_KEY", "AIzaSyDDpt7wIW7mnGPQAFlbHtkMhhpsj2JTRDA")
    
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount"
    }
    
    payload = {
        "textQuery": query,
        "languageCode": "en",
        "maxResultCount": 10
    }
    
    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code != 200:
        print(f"Error fetching data: {response.status_code}")
        print(response.text)
        return []
        
    data = response.json()
    places = data.get("places", [])
    
    leads = []
    for place in places:
        lead = {
            "business_name": place.get("displayName", {}).get("text", "N/A"),
            "address": place.get("formattedAddress", "N/A"),
            "website": place.get("websiteUri", "N/A"),
            "phone_number": place.get("nationalPhoneNumber", "N/A"),
            "rating": place.get("rating", 0.0),
            "review_count": place.get("userRatingCount", 0)
        }
        leads.append(lead)
        
    return leads

def save_to_json(data, filename="leads.json"):
    """
    Exports the structured lead data to a JSON file.
    """
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print(f"Successfully saved {len(data)} leads to {filename}")

if __name__ == "__main__":
    search_query = "restaurants in San José"
    print(f"Initializing Discovery Engine for: '{search_query}'...\n")
    
    extracted_leads = discover_leads(search_query)
    
    if extracted_leads:
        save_to_json(extracted_leads)
        print("\nSample Lead Extracted:")
        print(json.dumps(extracted_leads[0], indent=2, ensure_ascii=False))
    else:
        print("No leads found or there was an error with the API request.")