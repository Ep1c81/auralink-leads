"""Google Places: consulta pequeña, configuración explícita y sin claves incrustadas."""
import argparse
import json
import os
import sys
import time
import requests
from discovery_engine_osm import save_to_json

def discover_leads(query):
    api_key=os.environ.get('GOOGLE_PLACES_API_KEY')
    if not api_key:raise RuntimeError('Falta configuración de Google Places.')
    start=time.monotonic()
    headers={'Content-Type':'application/json','X-Goog-Api-Key':api_key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.location'}
    with requests.post('https://places.googleapis.com/v1/places:searchText',headers=headers,json={'textQuery':query,'languageCode':'es','maxResultCount':10},timeout=(5,20),stream=True,allow_redirects=False) as response:
        response.raise_for_status();chunks=[];size=0
        for chunk in response.iter_content(65536):
            size+=len(chunk)
            if size>2097152 or time.monotonic()-start>25:raise RuntimeError('Respuesta fuera de límites.')
            chunks.append(chunk)
        data=json.loads(b''.join(chunks))
    if not isinstance(data,dict) or not isinstance(data.get('places',[]),list):raise ValueError('Respuesta inválida.')
    return [{'source_key':'google_places:'+p['id'],'source':'Google Places','business_name':p.get('displayName',{}).get('text'),'address':p.get('formattedAddress'),'website':p.get('websiteUri'),'phone_number':p.get('nationalPhoneNumber'),'latitude':p.get('location',{}).get('latitude'),'longitude':p.get('location',{}).get('longitude'),'source_metadata':{'rating':p.get('rating'),'review_count':p.get('userRatingCount'),'score_kind':'sin estimar'}} for p in data.get('places',[]) if isinstance(p,dict) and isinstance(p.get('id'),str)]

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--query',required=True);parser.add_argument('--output',default='discovery-results.json');args=parser.parse_args()
    try:
        rows=discover_leads(args.query);save_to_json(rows,args.output);print(f'Guardados {len(rows)} registros.')
    except Exception:print('Discovery incompleto; no se descartaron archivos anteriores.',file=sys.stderr);sys.exit(1)
