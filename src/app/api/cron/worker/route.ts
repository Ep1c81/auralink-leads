import { sameSecret } from '@/lib/security/policy';
import { failure } from '@/lib/security/auth';
import { runDispatchWorker } from '@/lib/durableDispatch';
export async function POST(request: Request) {
 if(!sameSecret(request.headers.get('authorization'),process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined)) return failure(401,'Acceso denegado.');
 try { return Response.json(await runDispatchWorker()); } catch { return failure(503,'No se pudo procesar la cola.'); }
}
