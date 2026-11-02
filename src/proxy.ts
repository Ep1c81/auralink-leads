import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Proxy (antes "middleware" en Next 16):
 *  1. Refresca las cookies de sesión de Supabase en cada solicitud de página.
 *  2. Redirección OPTIMISTA a /login si no hay sesión.
 *
 * NO es la barrera de seguridad: cada página, Server Action y API vuelve a
 * verificar identidad y allowlist en src/lib/auth.ts (la guía de Next
 * recomienda no depender solo del proxy). Las rutas /api/* se excluyen: se
 * autorizan dentro de cada handler (operador o secreto máquina).
 */

const PUBLIC_PATHS = ["/login", "/auth/"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));

  if (!url || !key) {
    // Sin configuración de Auth no hay forma de iniciar sesión: mandar a
    // /login, que muestra el problema. Nunca dejar pasar a páginas privadas.
    return isPublic ? response : NextResponse.redirect(new URL("/login?error=no-disponible", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims valida la firma del JWT (y refresca la sesión si hace falta).
  let hasSession = false;
  try {
    const { data } = await supabase.auth.getClaims();
    hasSession = Boolean(data?.claims?.sub);
  } catch {
    hasSession = false;
  }

  if (!hasSession && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    if (path !== "/") loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
