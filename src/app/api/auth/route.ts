import { userClient, failure } from '@/lib/security/auth';
import { allowedOperator, readBody, validOrigin } from '@/lib/security/policy';
export async function POST(request: Request) {
  if (!validOrigin(request)) return failure(403, 'Origen no autorizado.');
  try {
    const input = JSON.parse(Buffer.from(await readBody(request, 4096)).toString());
    const db = await userClient();
    if (input.action === 'logout') { await db.auth.signOut(); return Response.json({ ok: true }); }
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!email || email.length > 254) return failure(400, 'Revisá el correo.');
    if (input.action === 'link') {
      // Respuesta uniforme: no revela quién tiene acceso. Supabase aplica sus límites de correo.
      if (allowedOperator('', email)) await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${process.env.APP_ORIGIN}/auth/confirm` } });
      return Response.json({ ok: true, message: 'Si tu cuenta está habilitada, recibirás un enlace para entrar.' });
    }
    if (typeof input.password !== 'string' || input.password.length > 256) return failure(400, 'Revisá la contraseña.');
    const { data, error } = await db.auth.signInWithPassword({ email, password: input.password });
    if (error || !data.user || !allowedOperator(data.user.id, data.user.email)) {
      await db.auth.signOut(); return failure(401, 'No pudimos iniciar sesión con esos datos.');
    }
    return Response.json({ ok: true });
  } catch { return failure(503, 'No pudimos iniciar sesión. Intentá nuevamente.'); }
}
