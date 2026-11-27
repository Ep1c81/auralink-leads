import test from "node:test";
import assert from "node:assert/strict";
import { livePayload, liveDispatch } from "../src/lib/acquisition.mjs";

const R = (id, phone, stage = "pitch_1") => ({ id, phone, stage, state: "reserved" });
const C = (phone, n, suppressed = false) => ({ phone, lead_id: `lead-${n}`, business_name: `Fixture ${n}`, suppressed });

test("payload builder includes reservation_id and the validated lead contract", () => {
  const { body, ineligible } = livePayload("pitch_1", [R("res-1", "50680000001")], [C("50680000001", 1)]);
  assert.deepEqual(ineligible, []);
  assert.deepEqual(body, {
    sequence_stage: "pitch_1", count: 1,
    leads: [{ reservation_id: "res-1", preview_lead_id: "lead-1", phone: "50680000001", business_name: "Fixture 1",
      consent_verified: true, suppressed: false, sequence_stage: "pitch_1" }],
  });
});

test("payload builder rejects blocked, suppressed, missing, malformed, sender and wrong-stage rows", () => {
  const reservations = [R("ok", "50680000001"), R("blocked", "50663489897"), R("supp", "50680000002"), R("missing", "50680000003"),
    R("bad", "50610000000"), R("self", "50680000004"), R("stage", "50680000001", "followup_2")];
  const contacts = [C("50680000001", 1), C("50663489897", 2), C("50680000002", 3, true), C("50610000000", 5), C("50680000004", 6)];
  const { body, ineligible } = livePayload("pitch_1", reservations, contacts, "+506 8000 0004");
  assert.deepEqual(body.leads.map(l => l.reservation_id), ["ok"]);
  assert.equal(body.count, 1);
  assert.deepEqual(ineligible.sort(), ["bad", "blocked", "missing", "self", "stage", "supp"]);
  assert.throws(() => livePayload("pitch_9", [], []), /invalid stage/);
});

function store(reservations, contacts) {
  const failed = [];
  return { failed, reserve: async () => reservations, contacts: async () => contacts, markFailed: async ids => { failed.push(...ids); } };
}

test("empty reservation list returns dispatched 0 without calling Make", async () => {
  let calls = 0;
  const r = await liveDispatch({ stage: "pitch_1", store: store([], []), send: async () => { calls++; } });
  assert.equal(r.dispatched, 0);
  assert.equal(calls, 0);
});

test("accepted dispatch POSTs once with every reservation", async () => {
  const s = store([R("a", "50680000001"), R("b", "50680000002")], [C("50680000001", 1), C("50680000002", 2)]);
  const sent = [];
  const r = await liveDispatch({ stage: "pitch_1", store: s, send: async body => { sent.push(body); } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].count, 2);
  assert.deepEqual(r.reservation_ids, ["a", "b"]);
  assert.equal(r.dispatched, 2);
  assert.deepEqual(s.failed, []);
});

test("Make rejection marks the sent reservations failed; unknown outcome leaves them reserved", async () => {
  const mk = () => store([R("a", "50680000001")], [C("50680000001", 1)]);
  const rejected = mk();
  let calls = 0;
  const r1 = await liveDispatch({ stage: "pitch_1", store: rejected,
    send: async () => { calls++; throw Object.assign(new Error("Make respondió HTTP 400."), { outcome: "rejected" }); } });
  assert.equal(calls, 1);
  assert.equal(r1.outcome, "rejected");
  assert.deepEqual(rejected.failed, ["a"]);
  const unknown = mk();
  const r2 = await liveDispatch({ stage: "pitch_1", store: unknown,
    send: async () => { throw Object.assign(new Error("timeout"), { outcome: "unknown" }); } });
  assert.equal(r2.outcome, "unknown");
  assert.equal(r2.dispatched, 0);
  assert.deepEqual(unknown.failed, []);
});

test("ineligible reservations are released and never sent", async () => {
  const s = store([R("a", "50680000001")], [C("50680000001", 1, true)]);
  let calls = 0;
  const r = await liveDispatch({ stage: "pitch_1", store: s, send: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(r.dispatched, 0);
  assert.deepEqual(s.failed, ["a"]);
});
