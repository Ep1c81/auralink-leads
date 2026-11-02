"""Ejecuta un trabajo previamente aprobado en el CRM. Nunca selecciona nuevos destinatarios."""
import argparse
import os
import sys
from urllib.parse import urlparse
import requests
from dotenv import load_dotenv

def main():
    parser=argparse.ArgumentParser(description='Los lotes se revisan y aprueban en Campañas. Este script solo procesa la cola.')
    parser.add_argument('--run-approved',action='store_true');args=parser.parse_args()
    if not args.run_approved:
        print('Sin acciones: revisá y aprobá un lote en el CRM. Usá --run-approved para procesar un trabajo aprobado.');return
    load_dotenv('.env.local');origin=os.environ.get('APP_ORIGIN','');secret=os.environ.get('CRON_SECRET')
    url=urlparse(origin)
    if url.scheme!='https' or not url.hostname or url.username or url.password or not secret:raise RuntimeError('Configuración incompleta.')
    with requests.post(origin.rstrip('/')+'/api/cron/worker',headers={'Authorization':'Bearer '+secret},timeout=(5,30),allow_redirects=False) as response:
        response.raise_for_status()
        print('Worker ejecutado. Revisá el estado del trabajo en el CRM; no equivale a entrega.')
if __name__=='__main__':
    try:main()
    except Exception:print('No se confirmó el resultado del worker. Revisá el CRM antes de reintentar.',file=sys.stderr);sys.exit(1)
