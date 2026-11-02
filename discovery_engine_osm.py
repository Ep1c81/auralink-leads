"""Discovery OSM acotado, con caché/checkpoint local. No envía mensajes."""
import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import requests

MISSING_PHONE_VALUES = {'', 'n/a', 'na', 'none', 'null'}
def has_phone(lead):
    value = lead.get('phone_number')
    return isinstance(value, str) and value.strip().lower() not in MISSING_PHONE_VALUES

def drop_leads_without_phone(leads):
    # Compatibilidad con importadores antiguos; discovery conserva todos los registros.
    return [lead for lead in leads if has_phone(lead)]

def normalize_element(elem):
    if not isinstance(elem, dict) or elem.get('type') not in ('node', 'way', 'relation') or not isinstance(elem.get('id'), int):
        return None
    tags = elem.get('tags', {})
    if not isinstance(tags, dict) or not isinstance(tags.get('name'), str):
        return None
    center = elem.get('center', elem)
    lat, lon = center.get('lat'), center.get('lon')
    if lat is not None and (not isinstance(lat, (int, float)) or not -90 <= lat <= 90): return None
    if lon is not None and (not isinstance(lon, (int, float)) or not -180 <= lon <= 180): return None
    address = ', '.join(str(tags[k]) for k in ('addr:street', 'addr:housenumber', 'addr:city', 'addr:state') if tags.get(k))
    return {'source_key': f"osm_{elem['type']}_{elem['id']}", 'business_name': tags['name'],
            'business_type': tags.get('amenity') or tags.get('shop') or 'SMB', 'address': address or None,
            'phone_number': tags.get('phone') or tags.get('contact:phone'),
            'website': tags.get('website') or tags.get('contact:website'), 'source': 'OpenStreetMap',
            'latitude': lat, 'longitude': lon, 'discovered_at': datetime.now(timezone.utc).isoformat(),
            'lead_score': 0, 'source_metadata': {'osm_type': elem['type'], 'osm_id': elem['id'], 'address_tags': {k: v for k, v in tags.items() if k.startswith('addr:')}, 'score_kind': 'sin estimar', 'attribution': '© OpenStreetMap contributors, ODbL'}}

def save_to_json(data, filename='leads.json'):
    target = Path(filename)
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')
    os.replace(temporary, target)

def discover(bbox, category, checkpoint_dir, session=requests):
    south, west, north, east = bbox
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180) or (north-south)*(east-west) > .04:
        raise ValueError('Usá una zona acotada, hasta 0,04 grados cuadrados.')
    if category not in ('restaurant', 'cafe', 'bar', 'clinic', 'dentist', 'veterinary', 'pharmacy', 'hairdresser', 'beauty'):
        raise ValueError('Categoría no permitida.')
    key = hashlib.sha256(json.dumps([bbox,category]).encode()).hexdigest()
    directory=Path(checkpoint_dir);directory.mkdir(parents=True,exist_ok=True)
    checkpoint=directory/(key+'.json')
    if checkpoint.exists():
        data=json.loads(checkpoint.read_text())
        if data.get('status')=='complete': return data['leads']
    query=f'[out:json][timeout:20];nwr["{"shop" if category in ("hairdresser","beauty") else "amenity"}"="{category}"]({south},{west},{north},{east});out center 100;'
    for attempt in range(3):
        try:
            start=time.monotonic()
            with session.post('https://overpass-api.de/api/interpreter',data=query.encode(),headers={'User-Agent':'AuralinkLeads/3.0 (auralinkdigital.com)'},timeout=(5,25),stream=True,allow_redirects=False) as response:
                if response.status_code in (429,503,504):
                    delay=max(2**attempt, int(response.headers.get('Retry-After','0')) if response.headers.get('Retry-After','0').isdigit() else 60)
                    save_to_json({'status':'partial','attempt':attempt+1,'retry_after_seconds':delay},checkpoint)
                    if delay>30 or attempt==2: raise RuntimeError('Proveedor ocupado. Retomá desde el checkpoint más tarde.')
                    time.sleep(delay);continue
                response.raise_for_status()
                chunks=[];size=0
                for chunk in response.iter_content(65536):
                    size+=len(chunk)
                    if size>2097152 or time.monotonic()-start>30: raise RuntimeError('Respuesta fuera de los límites.')
                    chunks.append(chunk)
                payload=json.loads(b''.join(chunks))
                if not isinstance(payload,dict) or not isinstance(payload.get('elements'),list): raise ValueError('Discovery malformado.')
                leads={}
                for elem in payload['elements']:
                    lead=normalize_element(elem)
                    if lead: leads[lead['source_key']]=lead
                result=list(leads.values())
                save_to_json({'status':'complete','leads':result},checkpoint)
                return result
        except (requests.RequestException,ValueError,RuntimeError):
            if not checkpoint.exists():save_to_json({'status':'failed','attempt':attempt+1},checkpoint)
            raise
    raise RuntimeError('Discovery incompleto.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Búsqueda OSM pequeña y reanudable; no equivale a cobertura nacional.')
    parser.add_argument('--bbox',nargs=4,type=float,required=True,metavar=('SUR','OESTE','NORTE','ESTE'))
    parser.add_argument('--category',required=True)
    parser.add_argument('--output',default='discovery-results.json')
    parser.add_argument('--checkpoints',default='.discovery-checkpoints')
    args=parser.parse_args()
    try:
        result=discover(args.bbox,args.category,args.checkpoints)
        save_to_json(result,args.output)
        print(f'Discovery completo: {len(result)} registros guardados antes de cualquier scoring.')
    except Exception:
        print('Discovery incompleto. Revisá la configuración y el checkpoint; no se descartó el avance.',file=sys.stderr)
        sys.exit(1)
