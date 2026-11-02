import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Candado con vencimiento en PostgreSQL (tabla public.job_locks, RPCs
 * try_acquire_job_lock / release_job_lock). Evita que varias pestañas o un
 * cron simultáneo ejecuten el mismo trabajo (discovery, barrido, worker).
 * Si el proceso muere, el candado vence solo (ttlSeconds).
 */
export async function withJobLock<T>(
  name: string,
  ownerLabel: string,
  ttlSeconds: number,
  run: () => Promise<T>
): Promise<{ status: "ok"; result: T } | { status: "busy" }> {
  const owner = `${ownerLabel}:${randomUUID()}`;
  const db = getSupabaseAdmin();
  const { data: acquired, error } = await db.rpc("try_acquire_job_lock", {
    p_name: name,
    p_owner: owner,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`No se pudo tomar el candado ${name}: ${error.message}`);
  if (!acquired) return { status: "busy" };
  try {
    return { status: "ok", result: await run() };
  } finally {
    const { error: releaseError } = await db.rpc("release_job_lock", { p_name: name, p_owner: owner });
    if (releaseError) console.error(`[jobLock] no se pudo liberar ${name}:`, releaseError.message);
  }
}
