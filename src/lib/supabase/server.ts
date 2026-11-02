import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de USUARIO para Server Components, Server Actions y Route Handlers.
 * Usa la clave pública (anon/publishable) + las cookies de sesión del
 * operador: solo sirve para autenticación (login, logout, verificar sesión).
 * Los datos del CRM se leen con el cliente admin DESPUÉS de autorizar.
 */
export function userClientConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export async function createSupabaseUserClient() {
  const config = userClientConfig();
  if (!config) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component (cookies de solo lectura). El
          // proxy refresca la sesión en cada solicitud, así que es seguro ignorarlo.
        }
      },
    },
  });
}
