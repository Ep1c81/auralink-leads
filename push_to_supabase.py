"""Importa identidades OSM sin fusionar sucursales ni descartar contactos incompletos."""
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

def push_to_supabase(json_file_path='discovery-results.json'):
    load_dotenv('.env.local')
    url,key=os.environ.get('SUPABASE_URL'),os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key: raise RuntimeError('Configuración incompleta.')
    rows=json.loads(Path(json_file_path).read_text(encoding='utf8'))
    if not isinstance(rows,list) or len(rows)>1000: raise ValueError('Lote inválido.')
    allowed={'source_key','business_name','business_type','address','phone_number','website','source','latitude','longitude','discovered_at','lead_score','source_metadata'}
    for row in rows:
        if not isinstance(row,dict) or not row.get('source_key'): raise ValueError('Falta identidad de fuente; reconciliá el archivo anterior antes de importarlo.')
    db=create_client(url,key)
    for offset in range(0,len(rows),100):
        batch=[{k:v for k,v in row.items() if k in allowed} for row in rows[offset:offset+100]]
        # Reejecución segura: conserva las notas/scoring del CRM y no pisa filas existentes.
        db.table('bizmap_leads').upsert(batch,on_conflict='source_key',ignore_duplicates=True).execute()
        print(f'Lote guardado: {offset+len(batch)} de {len(rows)}.')

if __name__=='__main__':
    try:push_to_supabase(sys.argv[1] if len(sys.argv)>1 else 'discovery-results.json')
    except Exception:
        print('Importación incompleta. Reintentá el mismo archivo; los lotes guardados no se duplican.',file=sys.stderr)
        sys.exit(1)
