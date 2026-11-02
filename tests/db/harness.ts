import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

/**
 * Base PostgreSQL real (PGlite, en memoria) con el esqueleto mínimo de
 * Supabase (roles anon/authenticated/service_role y auth.users) para aplicar
 * TODAS las migraciones del repo en orden, como en una base limpia.
 *
 * Limitación: PGlite es de una sola conexión, así que la concurrencia real
 * entre workers se aproxima con reservas sucesivas dentro de transacciones.
 */

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

const SUPABASE_SKELETON = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  -- Supabase concede por defecto todo en public a anon/authenticated.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export async function freshDb(opts: { upTo?: string } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(SUPABASE_SKELETON);
  for (const file of migrationFiles()) {
    if (opts.upTo && file > opts.upTo) break;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Falló la migración ${file}: ${(err as Error).message}`);
    }
  }
  return db;
}

export async function applyMigration(db: PGlite, file: string): Promise<void> {
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
}

export async function insertLead(
  db: PGlite,
  fields: Partial<{
    id: string;
    business_name: string;
    phone_number: string;
    outreach_status: string | null;
    has_replied: boolean;
    automation_consent: string | null;
    last_contacted_at: string | null;
    lead_score: number;
  }> = {}
): Promise<{ id: string; wa_phone: string }> {
  const res = await db.query<{ id: string; wa_phone: string }>(
    `insert into public.bizmap_leads (business_name, phone_number, outreach_status, has_replied, automation_consent, last_contacted_at, lead_score)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, wa_phone`,
    [
      fields.business_name ?? "Soda Prueba",
      fields.phone_number ?? "8888 0001",
      fields.outreach_status === undefined ? "Queued" : fields.outreach_status,
      fields.has_replied ?? false,
      fields.automation_consent === undefined ? "opt_in" : fields.automation_consent,
      fields.last_contacted_at ?? null,
      fields.lead_score ?? 9,
    ]
  );
  return res.rows[0];
}
