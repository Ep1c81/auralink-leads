"""Estimación determinística acotada; no utiliza IA ni presume ausencia de sitio web."""
import os
import sys
from dotenv import load_dotenv
from supabase import create_client

def evaluate_lead(lead):
    category=str(lead.get('business_type') or '').lower()
    relevant=any(t in category for t in ('restaurant','cafe','bar','hairdresser','beauty','supermarket'))
    return {'lead_score':8 if relevant else 5,'status':'Hot Lead' if relevant else 'Standard Lead','ai_notes':'Estimación heurística por categoría; no confirma ventas, tráfico, reputación ni ausencia de sitio web.'}

def run_full_qualification():
    load_dotenv('.env.local');url,key=os.environ.get('SUPABASE_URL'),os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:raise RuntimeError('Configuración incompleta.')
    db=create_client(url,key)
    rows=db.table('bizmap_leads').select('id,business_type,website').eq('lead_score',0).order('id').limit(100).execute().data
    for row in rows:db.table('bizmap_leads').update(evaluate_lead(row)).eq('id',row['id']).eq('lead_score',0).execute()
    print(f'Estimaciones guardadas: {len(rows)}. Volvé a ejecutar para procesar otro lote.')
if __name__=='__main__':
    try:run_full_qualification()
    except Exception:print('Cualificación incompleta. El avance guardado se conserva.',file=sys.stderr);sys.exit(1)
