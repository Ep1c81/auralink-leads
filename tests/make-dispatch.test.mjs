import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildTestPayload, main } from "../scripts/test-make-webhook.mjs";

const source = fs.readFileSync(new URL("../src/lib/makeDispatch.ts", import.meta.url), "utf8");
function transport(fetchMock) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortSignal, fetch: fetchMock });
  return exports;
}

test("self-send blocked with formatted sender", () => {
  const api = transport();
  assert.throws(() => api.assertNotSender("+50680000001", "+506 8000 0001"), /coincide/);
  assert.doesNotThrow(() => api.assertNotSender("+50680000002", "+50680000001"));
  assert.throws(() => api.assertNotSender("+50680000002", "123456789012345"), /Phone Number ID/);
});

test("webhook URL cannot send contacts to an arbitrary host or redirect", () => {
  const api = transport();
  assert.equal(api.validateMakeWebhook(" https://hook.us2.make.com/test "), "https://hook.us2.make.com/test");
  for (const url of [undefined, "https://hook.us2.make.com.evil.test/key", "http://hook.us2.make.com/key", "https://hook.us2.make.com/key?secret=1", "https://hook.us2.make.com/", "https://user:pass@hook.us2.make.com/key"]) {
    assert.throws(() => api.validateMakeWebhook(url));
  }
});

test("Make acceptance preserves payload and does not claim delivery", async () => {
  let calls = 0;
  const api = transport(async (url, options) => {
    calls++;
    assert.equal(url, "https://hook.us2.make.com/test");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body), { count: 1 });
    return new Response("Accepted");
  });
  assert.equal(await api.sendMakePayload("https://hook.us2.make.com/test", { count: 1 }), undefined);
  assert.equal(calls, 1);
});

test("rejections keep status but never disclose body or webhook credentials", async () => {
  for (const status of [400, 404, 410, 429, 500]) {
    const api = transport(async () => new Response("secret-token", { status }));
    await assert.rejects(api.sendMakePayload("https://hook.us2.make.com/private", {}), error => {
      assert.equal(error.outcome, "rejected");
      assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /secret-token|private/);
      return true;
    });
  }
});

test("timeout/network failure is unknown and never automatically retried", async () => {
  let calls = 0;
  const api = transport(async () => { calls++; throw new Error("secret-url"); });
  await assert.rejects(api.sendMakePayload("https://hook.us2.make.com/private", {}), error => {
    assert.equal(error.outcome, "unknown");
    assert.doesNotMatch(error.message, /secret-url|private/);
    return true;
  });
  assert.equal(calls, 1);
});

test("test fixture has exactly one synthetic lead and the dispatch fields", () => {
  const data = buildTestPayload("+506 8000 0002", "+50680000001");
  assert.equal(data.count, 1);
  assert.equal(data.leads.length, 1);
  assert.equal(data.leads[0].outreach_status, "Queued");
  assert.equal(data.leads[0].lead_score, 10);
  assert.match(data.leads[0].lead_id, /^[0-9a-f-]{36}$/);
  assert.throws(() => buildTestPayload("50680000001", "50680000001"), /mismo/);
  assert.throws(() => buildTestPayload("50680000002", ""), /Configurá/);
  assert.throws(() => buildTestPayload("80000002", "50680000001"));
});

test("test script previews without network; --send posts one item only", async () => {
  const previousFetch = global.fetch;
  const previousLog = console.log;
  const logs = [];
  let calls = 0;
  console.log = (...args) => logs.push(args.join(" "));
  global.fetch = async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).leads.length, 1);
    return new Response("Accepted");
  };
  try {
    const env = { WHATSAPP_SENDER_PHONE: "50680000001", MAKE_DISPATCH_WEBHOOK_URL: "https://hook.us2.make.com/test" };
    await main(["50680000002"], env);
    assert.equal(calls, 0);
    await main(["50680000002", "--send"], env);
    assert.equal(calls, 1);
    assert.ok(logs.some(line => line.includes("NO confirma entrega")));
    await assert.rejects(main(["50680000002", "--sned"], env), /Uso/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
  }
});
