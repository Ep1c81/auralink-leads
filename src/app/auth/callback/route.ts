import { NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de correo de Supabase (invitación y recuperación).
 * Intercambia el código por una sesión y redirige a una ruta interna.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/auth/nueva-clave";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/auth/nueva-clave";

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && (type === "invite" || type === "recovery" || type === "magiclink")) {
    try {
      const supabase = await createSupabaseUserClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    } catch {
      // cae al redirect de error
    }
  } else if (code) {
    try {
      const supabase = await createSupabaseUserClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    } catch {
      // cae al redirect de error
    }
  }
  return NextResponse.redirect(new URL("/login?error=enlace-invalido", url.origin));
}
