import { userClient, failure } from '@/lib/security/auth';
import { validOrigin } from '@/lib/security/policy';
export async function POST(request: Request) {
  if (!validOrigin(request)) return failure(403, 'Origen no autorizado.');
  await (await userClient()).auth.signOut();
  return Response.redirect(`${process.env.APP_ORIGIN}/login`, 303);
}
