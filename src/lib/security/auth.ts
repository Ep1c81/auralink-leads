import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { allowedOperator, validOrigin, readBody, UUID, sameSecret } from './policy';
import { randomUUID } from 'node:crypto';
export async function userClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Autenticación no configurada');
  const jar = await cookies();
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: entries => { try { entries.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Los RSC no escriben cookies. */ } },
    },
  });
}
export async function operator() {
  if (!(await cookies()).getAll().some(c => c.name.startsWith("sb-"))) return null;
  const db = await userClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;
  if (!allowedOperator(user.id, user.email)) return null;
  return user;
}
export async function requireOperator() {
  const user = await operator();
  if (!user) redirect('/login');
  return user;
}
export function failure(status: number, error: string, requestId = randomUUID()) {
  return Response.json({ error, request_id: requestId }, { status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
}
export function withOperator<A extends unknown[]>(handler: (request: Request, ...args: A) => Promise<Response>) {
  return async (request: Request, ...args: A): Promise<Response> => {
    const id = randomUUID();
    try {
      if (!await operator()) return failure(401, 'Iniciá sesión con una cuenta autorizada.', id);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        if (!validOrigin(request)) return failure(403, 'El origen de la solicitud no está autorizado.', id);
        if (request.body) {
          const bytes = await readBody(request);
          if (bytes.length) {
            let value;
            try { value = JSON.parse(Buffer.from(bytes).toString()); } catch { return failure(400, 'El contenido debe ser JSON válido.', id); }
            if (!value || typeof value !== 'object' || Array.isArray(value)) return failure(400, 'Los datos no son válidos.', id);
            for (const [key, item] of Object.entries(value)) {
              if ((key.endsWith('_id') && item != null && (typeof item !== 'string' || !UUID.test(item))) || (typeof item === 'string' && item.length > 16000)) return failure(400, 'Revisá los identificadores y la extensión del contenido.', id);
            }
          }
          request = new Request(request.url, { method: request.method, headers: request.headers, body: Buffer.from(bytes) });
        }
      }
      const response = await handler(request, ...args);
      if (!response.ok) return failure(response.status, response.status >= 500 ? 'No pudimos completar la operación. Intentá de nuevo o consultá el código de referencia.' : 'Revisá los datos y el estado de la operación.', id);
      response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Request-ID', id);
      return response;
    } catch {
      console.error(JSON.stringify({ request_id: id, event: 'operation_failed' }));
      return failure(503, 'El servicio no está disponible por el momento.', id);
    }
  };
}

/** Integraciones autenticadas antes de leer el cuerpo o acceder a la base. */
export function withMachine(handler: (request: Request) => Promise<Response>, secretEnv: string, header = 'authorization', prefix = 'Bearer ') {
  return async (request: Request): Promise<Response> => {
    const id=randomUUID();
    const expected=process.env[secretEnv];
    if(!sameSecret(request.headers.get(header),expected?prefix+expected:undefined))return failure(401,'Integración no autorizada.',id);
    try{
      if(request.body){const raw=await readBody(request);request=new Request(request.url,{method:request.method,headers:request.headers,body:Buffer.from(raw)});}
      const response=await handler(request);
      if(!response.ok)return failure(response.status,response.status>=500?'No se pudo completar la integración.':'Revisá el contenido de la solicitud.',id);
      response.headers.set('X-Request-ID',id);response.headers.set('Cache-Control','no-store');return response;
    }catch{console.error(JSON.stringify({event:'integration_failed',request_id:id}));return failure(503,'La integración no está disponible por el momento.',id);}
  };
}
