import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente ADMINISTRATIVO (service-role). Ignora RLS, así que solo debe usarse
 * DESPUÉS de autorizar la solicitud (operador verificado en src/lib/auth.ts o
 * secreto máquina-a-máquina en src/lib/machineAuth.ts).
 *
 * A diferencia de la versión anterior, NO hay fallback a la clave anon: si
 * falta la service-role, falla de forma explícita en lugar de cambiar
 * silenciosamente de privilegios.
 *
 * `server-only` hace fallar el build si un Client Component lo importa.
 */

export class SupabaseConfigError extends Error {}

function read(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Problemas de configuración por nombre de variable (nunca incluye valores). */
export function adminConfigProblems(): string[] {
  const problems: string[] = [];
  const url = read("SUPABASE_URL");
  if (!url) problems.push("Falta SUPABASE_URL");
  else if (!/^https:\/\/[^/\s]+/.test(url)) problems.push("SUPABASE_URL debe empezar con https://");
  if (!read("SUPABASE_SERVICE_ROLE_KEY")) problems.push("Falta SUPABASE_SERVICE_ROLE_KEY");
  return problems;
}

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const problems = adminConfigProblems();
  if (problems.length > 0) {
    throw new SupabaseConfigError(`Supabase (admin) no está configurado: ${problems.join("; ")}`);
  }
  client = createClient(read("SUPABASE_URL")!, read("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * Proxy perezoso para módulos existentes que usan `supabaseAdmin.from(...)`.
 * Difiere la construcción al primer uso para que un error de configuración
 * aparezca dentro del handler (donde se reporta) y no al importar.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAdmin(), prop, receiver);
  },
});
