import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for the App Router (Node.js runtime).
 *
 * Two things matter here and are easy to get wrong:
 *
 * 1. No custom `global.fetch` override is passed to `createClient`. supabase-js
 *    uses the platform `fetch` on its own, which is what works on Vercel's Node
 *    serverless runtime. A hand-rolled fetch wrapper is the usual source of an
 *    opaque `TypeError: fetch failed` in production.
 * 2. The client is built lazily. Constructing it at module scope and throwing on
 *    missing env vars turns a config problem into an import-time crash, which
 *    Vercel surfaces as a bare 500 with no usable message.
 */

const URL_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const KEY_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export type SupabaseEnv = {
  url: string | null;
  key: string | null;
  /** Name of the env var the key was read from, for logging. */
  keyName: string | null;
  /** Human-readable names of what is missing or malformed. */
  problems: string[];
};

/** Reads a var and trims it — a trailing newline pasted into the Vercel UI is
 *  enough to make the URL unresolvable and produce `fetch failed`. */
function read(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSupabaseEnv(): SupabaseEnv {
  const problems: string[] = [];

  let url: string | null = null;
  for (const name of URL_VARS) {
    url = read(name);
    if (url) break;
  }

  let key: string | null = null;
  let keyName: string | null = null;
  for (const name of KEY_VARS) {
    key = read(name);
    if (key) {
      keyName = name;
      break;
    }
  }

  if (!url) {
    problems.push(`Missing ${URL_VARS.join(" or ")}`);
  } else if (!/^https:\/\/[^/\s]+/.test(url)) {
    // Catches the common pastes: a bare project ref, a postgres:// connection
    // string, or a URL with the scheme stripped. All of these fail at the
    // network layer rather than returning a Supabase error.
    problems.push(
      `SUPABASE_URL must be the project API URL starting with https:// (got "${url.slice(0, 24)}...")`
    );
  }

  if (!key) {
    problems.push(`Missing ${KEY_VARS.join(" or ")}`);
  }

  return { url, key, keyName, problems };
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const { url, key, problems } = resolveSupabaseEnv();
  if (!url || !key) {
    throw new Error(`Supabase is not configured: ${problems.join("; ")}`);
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

/**
 * Back-compat named export. Existing modules import `{ supabase }` and use it
 * directly; this proxy defers construction to first property access so a missing
 * env var surfaces inside a request handler (where it can be caught and
 * reported) instead of at import time.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});
