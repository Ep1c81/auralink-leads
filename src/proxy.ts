import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
// Solo renueva cookies. Las rutas y DAL autorizan de forma independiente.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const db = createServerClient(url, key, { cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }, cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: entries => { entries.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
  } });
  await db.auth.getUser();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/', '/dashboard/:path*', '/outreach/:path*'] };
