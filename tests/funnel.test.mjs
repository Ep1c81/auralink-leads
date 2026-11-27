import test from "node:test";
import assert from "node:assert/strict";
import { decide, TEXT, SIGNUP_URL } from "../src/lib/funnel.mjs";

const C = (over = {}) => ({ phone: "50660691124", business_name: "Barbería Prueba", contact_name: "Ana", conv_state: "new", trial_status: "registered", customer: false, ...over });

test("first message after registering gets the welcome menu", () => {
  const r = decide({ contact: C(), text: "¡Hola! Me registré para la prueba", kind: "reply" });
  assert.equal(r.reply, TEXT.welcome("Ana", "Barbería Prueba"));
  assert.deepEqual(r.update, { conv_state: "awaiting_choice", trial_status: "registered" });
  assert.equal(r.notify, null);
});

test("full happy path: 1 -> schedule -> ready for activation with an alert", () => {
  const a = decide({ contact: C({ conv_state: "awaiting_choice" }), text: "1", kind: "reply" });
  assert.equal(a.reply, TEXT.askSchedule);
  assert.deepEqual(a.update, { conv_state: "awaiting_schedule", trial_status: "scheduling" });
  const b = decide({ contact: C({ conv_state: "awaiting_schedule", trial_status: "scheduling" }), text: "Martes en la mañana", kind: "reply" });
  assert.equal(b.update.trial_status, "ready_for_activation");
  assert.equal(b.update.preferred_slot, "Martes en la mañana");
  assert.match(b.notify, /LISTO PARA ACTIVAR: Barbería Prueba \(\+50660691124\) — Ana/);
});

test("FAQ answers with accents removed and offers next step", () => {
  const r = decide({ contact: C({ conv_state: "faq" }), text: "¿Cuánto cuesta?", kind: "reply" });
  assert.match(r.reply, /₡19\.900/);
  assert.match(r.reply, /Responda \*1\*/);
  assert.equal(r.notify, null);
  const app = decide({ contact: C({ conv_state: "awaiting_choice" }), text: "hay que descargar una app?", kind: "reply" });
  assert.match(app.reply, /No hace falta instalar/);
});

test("unknown question is handed to Alex", () => {
  const r = decide({ contact: C({ conv_state: "faq" }), text: "¿Atienden los domingos?", kind: "reply" });
  assert.equal(r.reply, TEXT.handoff);
  assert.match(r.notify, /Consulta de Barbería Prueba/);
});

test("opt-outs: SALIR, option 3, 'No, gracias' button and optout kind all stop and suppress", () => {
  for (const input of [{ text: "SALIR" }, { text: "3", state: "awaiting_choice" }, { text: "No, gracias", button: "no" }, { text: "x", kind: "optout" }]) {
    const r = decide({ contact: C({ conv_state: input.state || "awaiting_choice" }), text: input.text, button: input.button, kind: input.kind || "reply" });
    assert.equal(r.reply, TEXT.declined);
    assert.deepEqual(r.update, { conv_state: "closed", trial_status: "declined", suppressed: true });
  }
});

test("purchase intent alerts Alex as a sale", () => {
  const r = decide({ contact: C({ conv_state: "awaiting_choice" }), text: "Quiero el plan Pro, ¿cómo pago por SINPE?", kind: "reply" });
  assert.equal(r.reply, TEXT.sale);
  assert.match(r.notify, /VENTA LISTA/);
});

test("pitch template button 'Sí, envíeme el video' enters the funnel", () => {
  const r = decide({ contact: C({ trial_status: "none" }), text: "Sí, envíeme el video", button: "enviar", kind: "reply" });
  assert.equal(r.reply, TEXT.askSchedule);
});

test("unknown numbers: interested -> signup link; anything else -> alert only, no bot reply", () => {
  const a = decide({ contact: null, text: "Hola, quiero info de la prueba", kind: "reply" });
  assert.match(a.reply, new RegExp(SIGNUP_URL.replace(/[.?]/g, "\\$&")));
  const b = decide({ contact: null, text: "Mae, ¿a qué hora llegás?", kind: "reply" });
  assert.equal(b.reply, null);
  assert.match(b.notify, /sin registro/);
});

test("customers and trials already handed over never get bot replies", () => {
  for (const c of [C({ customer: true }), C({ trial_status: "ready_for_activation" }), C({ trial_status: "active" })]) {
    const r = decide({ contact: c, text: "Hola", kind: "reply" });
    assert.equal(r.reply, null);
    assert.ok(r.notify);
  }
});

test("schedule step ignores empty/too-short answers", () => {
  const r = decide({ contact: C({ conv_state: "awaiting_schedule" }), text: "ok", kind: "reply" });
  assert.equal(r.reply, TEXT.askSchedule);
  assert.equal(r.update, null);
});
