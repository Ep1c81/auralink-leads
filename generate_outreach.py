"""Prepara borradores sin envío y sin imprimir datos de prospectos en logs."""
import os
import sys
from dotenv import load_dotenv
from supabase import create_client
from discovery_engine_osm import save_to_json

def craft_outreach_message(lead):
    name=lead.get('business_name') or 'su negocio'
    return f'Hola, equipo de {name}. Soy de BizMapShield. Facilitamos que sus clientes abran el enlace de reseñas de Google con una tarjeta NFC o un QR y compartan su experiencia. ¿Les gustaría conocer cómo funciona? Si prefieren no recibir más mensajes, nos lo indican.'

def run_outreach_generator():
    load_dotenv('.env.local')
    url,key=os.environ.get('SUPABASE_URL'),os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:raise RuntimeError('Configuración incompleta.')
    db=create_client(url,key)
    leads=db.table('bizmap_leads').select('id,business_name,business_type').gte('lead_score',8).order('id').limit(10).execute().data
    save_to_json([{'lead_id':row['id'],'body':craft_outreach_message(row),'status':'draft'} for row in leads],'outreach-drafts.json')
    print(f'Guardados {len(leads)} borradores. No se enviaron mensajes.')
if __name__=='__main__':
    try:run_outreach_generator()
    except Exception:print('No se pudieron preparar los borradores.',file=sys.stderr);sys.exit(1)
