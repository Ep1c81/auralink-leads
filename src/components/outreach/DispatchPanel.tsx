'use client';
import { useRef, useState } from 'react';
type Preview={batch_id:string;items:{id:string;phone:string;eligible:boolean;payload:{business_name:string;message_text:string}}[]};
export function DispatchPanel(){
 const [stage,setStage]=useState('pitch_1');
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
 async function act(action:'preview'|'approve'){
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{const r=await fetch('/api/outreach/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='preview'?{action,limit:5,stage}:{action,batch_id:preview?.batch_id})});const d=await r.json();if(!r.ok)throw new Error(d.error);if(action==='preview')setPreview(d);else{setMessage('Lote aprobado. Solo los contactos habilitados pasan a la cola. La entrega requiere confirmación del proveedor.');setPreview(null);}}
  catch(e){setMessage(e instanceof Error?e.message:'No se pudo completar la operación.');}finally{lock.current=false;setBusy(false);}
 }
 return <section className="rounded border p-4 space-y-3"><h2 className="font-bold">Revisar lote de contacto</h2><label className="block">Etapa<select className="border p-2 ml-2" value={stage} disabled={busy} onChange={e=>{setStage(e.target.value);setPreview(null);}}><option value="pitch_1">Primer contacto</option><option value="followup_2">Seguimiento pendiente</option></select></label><p>Un teléfono público no acredita permiso para automatizar. Revisá el mensaje y cada destinatario.</p><button className="rounded bg-blue-700 p-2 text-white" disabled={busy} onClick={()=>void act('preview')}>Preparar vista previa</button>{preview&&<><ul>{preview.items.map(x=><li className="my-3 border rounded p-3" key={x.id}><strong>{x.payload.business_name}</strong><p>{x.phone} · {x.eligible?'Habilitado':'Falta evidencia de permiso; no se enviará'}</p><p className="whitespace-pre-wrap">{x.payload.message_text}</p></li>)}</ul>{!preview.items.length?<p>No hay contactos nuevos para este lote.</p>:<button className="rounded bg-green-700 p-2 text-white" disabled={busy||!preview.items.some(x=>x.eligible)} onClick={()=>void act('approve')}>Confirmar este lote</button>}</>}<p role="status">{message}</p></section>;
}
