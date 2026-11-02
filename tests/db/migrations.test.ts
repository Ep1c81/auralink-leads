import { describe, expect, it } from "vitest";
import { applyMigration, freshDb, migrationFiles } from "./harness";

describe("migraciones", () => {
  it("reproducen una base limpia de principio a fin", async () => {
    const db = await freshDb();
    const tables = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by 1"
    );
    const names = tables.rows.map((r) => r.tablename);
    for (const t of ["bizmap_leads", "leads", "operators", "outreach_sends", "inbound_events", "contact_suppressions"]) {
      expect(names).toContain(t);
    }
    await db.close();
  });

  it("son re-ejecutables sobre una base existente (idempotentes)", async () => {
    const db = await freshDb();
    await db.query("insert into public.bizmap_leads (business_name, phone_number) values ('Existente', '8888 1234')");
    // Re-aplicar las migraciones recientes no debe fallar ni borrar datos.
    for (const file of migrationFiles().filter((f) => f >= "20261101")) {
      await applyMigration(db, file);
    }
    const count = await db.query<{ n: number }>("select count(*)::int n from public.bizmap_leads");
    expect(count.rows[0].n).toBe(1);
    await db.close();
  });

  it("anon y authenticated no tienen privilegios sobre el CRM", async () => {
    const db = await freshDb();
    const res = await db.query<{ table_name: string; grantee: string }>(
      `select table_name, grantee from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')`
    );
    expect(res.rows).toEqual([]);
    const policies = await db.query("select policyname from pg_policies where schemaname = 'public'");
    expect(policies.rows).toEqual([]);
    await db.close();
  });

  it("anon no puede leer bizmap_leads aunque intente", async () => {
    const db = await freshDb();
    await db.query("insert into public.bizmap_leads (business_name, phone_number) values ('Secreto', '8888 1234')");
    await db.exec("set role anon");
    await expect(db.query("select * from public.bizmap_leads")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.outreach_health()")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.close();
  });
});
