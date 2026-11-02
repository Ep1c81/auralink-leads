import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, insertLead } from "./harness";

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  await db.query("update public.app_settings set value = 'true'::jsonb where key = 'sends_enabled'");
  await db.query("update public.app_settings set value = '100'::jsonb where key = 'daily_send_cap'");
});
afterEach(async () => {
  await db.close();
});

type Json = Record<string, unknown>;

async function createBatch(leads: { id: string; wa_phone: string }[], stage = "pitch_1", text = "Hola") {
  const items = leads.map((l) => ({ lead_id: l.id, wa_phone: l.wa_phone, message_text: `${text} ${l.id}` }));
  const res = await db.query<{ r: Json }>("select public.create_outreach_batch($1, $2, $3::jsonb, $4) as r", [
    "test",
    stage,
    JSON.stringify(items),
    "op@test",
  ]);
  return res.rows[0].r as { batch_id: string; content_hash: string; item_count: number; skipped: Json[] };
}

async function approve(batchId: string, hash: string) {
  const res = await db.query<{ r: Json }>("select public.approve_outreach_batch($1, $2, 'op@test') as r", [batchId, hash]);
  return res.rows[0].r;
}

async function claim(owner: string, limit = 10, lease = 60) {
  const res = await db.query<{ id: string; lead_id: string }>(
    "select id, lead_id from public.claim_outreach_sends($1, $2, $3)",
    [owner, limit, lease]
  );
  return res.rows;
}

async function sendStatus(id: string) {
  const res = await db.query<{ status: string; needs_review: boolean; attempts: number }>(
    "select status, needs_review, attempts from public.outreach_sends where id = $1",
    [id]
  );
  return res.rows[0];
}

async function leadStatus(id: string) {
  const res = await db.query<{ outreach_status: string | null }>(
    "select outreach_status from public.bizmap_leads where id = $1",
    [id]
  );
  return res.rows[0].outreach_status;
}

describe("aprobación de lotes", () => {
  it("la aprobación exige el mismo contenido que se previsualizó", async () => {
    const a = await insertLead(db, { phone_number: "8888 0001" });
    const batch = await createBatch([a]);
    expect(batch.item_count).toBe(1);

    // Alguien cambia el texto después del preview: la aprobación se rechaza.
    await db.query("update public.outreach_sends set message_text = 'otro texto' where batch_id = $1", [batch.batch_id]);
    const result = await approve(batch.batch_id, batch.content_hash);
    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect((await claim("w1")).length).toBe(0);
  });

  it("aprobar dos veces (doble clic) no duplica envíos", async () => {
    const a = await insertLead(db, { phone_number: "8888 0002" });
    const batch = await createBatch([a]);
    expect(await approve(batch.batch_id, batch.content_hash)).toMatchObject({ ok: true, queued: 1 });
    expect(await approve(batch.batch_id, batch.content_hash)).toMatchObject({ ok: true, already_approved: true });
    const count = await db.query<{ n: number }>("select count(*)::int n from public.outreach_sends where status = 'queued'");
    expect(count.rows[0].n).toBe(1);
  });

  it("dos lotes abiertos (dos pestañas) no programan el mismo número dos veces", async () => {
    const a = await insertLead(db, { phone_number: "8888 0003" });
    const first = await createBatch([a]);
    const second = await createBatch([a]);
    expect(first.item_count).toBe(1);
    expect(second.item_count).toBe(0);
    expect(second.skipped[0]).toMatchObject({ reason: "ya_programado" });
  });

  it("sin permiso registrado el prospecto no entra a la cola automática", async () => {
    const a = await insertLead(db, { phone_number: "8888 0004", automation_consent: null });
    const batch = await createBatch([a]);
    expect(batch.item_count).toBe(0);
    expect(batch.skipped[0]).toMatchObject({ reason: "sin_permiso" });
  });
});

describe("worker y reservas", () => {
  async function queued(n: number) {
    const leads = [];
    for (let i = 0; i < n; i++) leads.push(await insertLead(db, { phone_number: `8888 1${String(i).padStart(3, "0")}` }));
    const batch = await createBatch(leads);
    await approve(batch.batch_id, batch.content_hash);
    return leads;
  }

  it("dos workers no reservan el mismo envío", async () => {
    await queued(6);
    const w1 = await claim("w1", 4);
    const w2 = await claim("w2", 4);
    expect(w1.length).toBe(4);
    expect(w2.length).toBe(2);
    const overlap = w1.filter((a) => w2.some((b) => b.id === a.id));
    expect(overlap).toEqual([]);
  });

  it("caída antes de transmitir: el envío vuelve a la cola al vencer el lease", async () => {
    await queued(1);
    const [s] = await claim("w1", 1, 1);
    await db.query("update public.outreach_sends set lease_expires_at = now() - interval '1 second' where id = $1", [s.id]);
    const again = await claim("w2", 1);
    expect(again.map((r) => r.id)).toEqual([s.id]);
  });

  it("caída después de transmitir: queda incierto, sin reenvío ciego", async () => {
    await queued(1);
    const [s] = await claim("w1", 1);
    const ok = await db.query<{ ok: boolean }>("select public.mark_send_transmitting($1, 'w1') ok", [s.id]);
    expect(ok.rows[0].ok).toBe(true);
    await db.query("update public.outreach_sends set lease_expires_at = now() - interval '1 second' where id = $1", [s.id]);
    expect(await claim("w2", 1)).toEqual([]);
    expect(await sendStatus(s.id)).toMatchObject({ status: "uncertain", needs_review: true });
  });

  it("timeout tras aceptación de Make: incierto y no se reenvía; callback tardío lo resuelve", async () => {
    const [lead] = await queued(1);
    const [s] = await claim("w1", 1);
    await db.query("select public.mark_send_transmitting($1, 'w1')", [s.id]);
    await db.query("select public.complete_outreach_send($1, 'w1', 'uncertain', null, 'timeout', null, null)", [s.id]);
    expect(await claim("w2", 5)).toEqual([]);
    expect(await leadStatus(lead.id)).toBe("Queued");

    const cb = await db.query<{ r: Json }>("select public.apply_send_callback($1, 'accepted', 'mk-1', null) r", [s.id]);
    expect(cb.rows[0].r).toMatchObject({ applied: true, status: "accepted" });
    expect(await leadStatus(lead.id)).toBe("Pitch Sent");
  });

  it("aceptado por Make no es entregado; un callback tardío no retrocede el estado", async () => {
    await queued(1);
    const [s] = await claim("w1", 1);
    await db.query("select public.mark_send_transmitting($1, 'w1')", [s.id]);
    await db.query("select public.complete_outreach_send($1, 'w1', 'accepted', 200, null, null, null)", [s.id]);
    expect((await sendStatus(s.id)).status).toBe("accepted");

    await db.query("select public.apply_send_callback($1, 'delivered', null, null)", [s.id]);
    const late = await db.query<{ r: Json }>("select public.apply_send_callback($1, 'accepted', null, null) r", [s.id]);
    expect(late.rows[0].r).toMatchObject({ applied: false, status: "delivered" });
    const lateFail = await db.query<{ r: Json }>("select public.apply_send_callback($1, 'failed', null, null) r", [s.id]);
    expect(lateFail.rows[0].r).toMatchObject({ applied: false });
    expect((await sendStatus(s.id)).status).toBe("delivered");
  });

  it("baja registrada antes del despacho impide el envío", async () => {
    const [lead] = await queued(1);
    await db.query("select public.add_contact_suppression($1, 'pidió no ser contactado', 'test', 'op', null)", [
      lead.wa_phone,
    ]);
    expect(await claim("w1", 5)).toEqual([]);
    const s = await db.query<{ status: string }>("select status from public.outreach_sends");
    expect(s.rows[0].status).toBe("suppressed");
  });

  it("si el prospecto respondió entre la aprobación y el envío, se suprime", async () => {
    const [lead] = await queued(1);
    await db.query("update public.bizmap_leads set has_replied = true, outreach_status = 'Replied' where id = $1", [lead.id]);
    expect(await claim("w1", 5)).toEqual([]);
  });

  it("el interruptor global detiene la reserva y la transmisión", async () => {
    await queued(2);
    const [s] = await claim("w1", 1);
    await db.query("update public.app_settings set value = 'false'::jsonb where key = 'sends_enabled'");
    const ok = await db.query<{ ok: boolean }>("select public.mark_send_transmitting($1, 'w1') ok", [s.id]);
    expect(ok.rows[0].ok).toBe(false);
    expect((await sendStatus(s.id)).status).toBe("queued");
    expect(await claim("w2", 5)).toEqual([]);
  });

  it("respeta el límite diario", async () => {
    await db.query("update public.app_settings set value = '2'::jsonb where key = 'daily_send_cap'");
    await queued(5);
    expect((await claim("w1", 10)).length).toBe(2);
    expect((await claim("w2", 10)).length).toBe(0);
  });

  it("errores transitorios se reintentan y terminan en DLQ; replay queda auditado", async () => {
    await db.query("update public.app_settings set value = '2'::jsonb where key = 'send_max_attempts'");
    await queued(1);
    let [s] = await claim("w1", 1);
    await db.query("select public.mark_send_transmitting($1, 'w1')", [s.id]);
    await db.query("select public.complete_outreach_send($1, 'w1', 'retry', 503, 'down', now(), null)", [s.id]);
    expect((await sendStatus(s.id)).status).toBe("queued");
    [s] = await claim("w1", 1);
    await db.query("select public.mark_send_transmitting($1, 'w1')", [s.id]);
    await db.query("select public.complete_outreach_send($1, 'w1', 'retry', 503, 'down', now(), null)", [s.id]);
    expect(await sendStatus(s.id)).toMatchObject({ status: "dead", needs_review: true });

    await db.query("select public.replay_outreach_send($1, 'admin@test', 'Make volvió')", [s.id]);
    expect((await sendStatus(s.id)).status).toBe("queued");
    const audit = await db.query<{ actor: string; to_status: string }>(
      "select actor, to_status from public.outreach_send_events where send_id = $1 order by id",
      [s.id]
    );
    expect(audit.rows.at(-1)).toMatchObject({ actor: "admin@test", to_status: "queued" });
  });

  it("un worker con lease vencido no puede completar un envío ajeno", async () => {
    await queued(1);
    const [s] = await claim("w1", 1);
    const r = await db.query<{ r: string }>(
      "select public.complete_outreach_send($1, 'otro', 'accepted', 200, null, null, null) r",
      [s.id]
    );
    expect(r.rows[0].r).toBe("stale");
  });
});

describe("inbox idempotente", () => {
  it("diez entregas del mismo evento producen un solo registro", async () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      const r = await db.query<{ r: Json }>(
        "select public.record_inbound_event('meta_whatsapp', 'wamid.X', 'message', '{}'::jsonb) r"
      );
      results.push(r.rows[0].r);
    }
    expect(results.filter((r) => r.inserted).length).toBe(1);
    const n = await db.query<{ n: number }>("select count(*)::int n from public.inbound_events");
    expect(n.rows[0].n).toBe(1);
  });

  it("dos workers no procesan el mismo evento", async () => {
    await db.query("select public.record_inbound_event('make', 'e1', 'reply', '{}'::jsonb)");
    await db.query("select public.record_inbound_event('make', 'e2', 'reply', '{}'::jsonb)");
    const a = await db.query<{ id: string }>("select id from public.claim_inbound_events('w1', 1, 60)");
    const b = await db.query<{ id: string }>("select id from public.claim_inbound_events('w2', 5, 60)");
    expect(a.rows.length).toBe(1);
    expect(b.rows.length).toBe(1);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
  });
});

describe("candados", () => {
  it("un segundo proceso no toma el candado hasta que vence o se libera", async () => {
    const q = (sql: string) => db.query<{ v: boolean }>(sql).then((r) => r.rows[0].v);
    expect(await q("select public.try_acquire_job_lock('discovery', 'a', 60) v")).toBe(true);
    expect(await q("select public.try_acquire_job_lock('discovery', 'b', 60) v")).toBe(false);
    await db.query("select public.release_job_lock('discovery', 'a')");
    expect(await q("select public.try_acquire_job_lock('discovery', 'b', 60) v")).toBe(true);
    await db.query("update public.job_locks set expires_at = now() - interval '1 second'");
    expect(await q("select public.try_acquire_job_lock('discovery', 'c', 60) v")).toBe(true);
  });
});
