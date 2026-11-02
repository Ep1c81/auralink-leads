import { userClient } from '@/lib/security/auth';
import { allowedOperator } from '@/lib/security/policy';
export async function GET(request: Request) {
  const token_hash = new URL(request.url).searchParams.get('token_hash');
  const db = await userClient();
  if (token_hash && token_hash.length < 1024) {
    const { data, error } = await db.auth.verifyOtp({ token_hash, type: 'email' });
    if (!error && data.user && allowedOperator(data.user.id, data.user.email)) return Response.redirect(`${process.env.APP_ORIGIN}/`, 303);
  }
  await db.auth.signOut();
  return Response.redirect(`${process.env.APP_ORIGIN}/login?error=link`, 303);
}
