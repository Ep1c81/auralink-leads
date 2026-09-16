/**
 * Unwraps the nested `cause` chain that undici puts a real network error in.
 * `TypeError: fetch failed` is only ever the outer wrapper — the actionable
 * detail (ENOTFOUND, ECONNREFUSED, certificate errors) lives in `cause`.
 * Shared by every route that talks to Supabase over fetch.
 */
export function describeFetchCause(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  let current: unknown = error;
  let depth = 0;

  while (current instanceof Error && depth < 5) {
    const prefix = depth === 0 ? "" : `cause${depth}.`;
    details[`${prefix}name`] = current.name;
    details[`${prefix}message`] = current.message;
    const code = (current as NodeJS.ErrnoException).code;
    if (code) details[`${prefix}code`] = code;
    current = (current as Error).cause;
    depth += 1;
  }

  if (depth === 0) details.message = String(error);
  return details;
}
