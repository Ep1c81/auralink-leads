// Sends one test lead straight to the Make dispatch webhook, bypassing
// /api/outreach/dispatch and the database. Nothing in bizmap_leads changes.
//
//   MAKE_WEBHOOK_URL=https://hook.us2.make.com/... node scripts/test-make-webhook.mjs 5068XXXXXXX
//
// The phone must be your own Costa Rican mobile: 506 followed by 8 digits
// starting with 5-8.

const url = process.env.MAKE_WEBHOOK_URL;
const phone = (process.argv[2] ?? "").replace(/\D/g, "");

if (!url?.startsWith("https://hook.")) {
  console.error("Set MAKE_WEBHOOK_URL to the Make webhook URL.");
  process.exit(1);
}
if (!/^506[5-8]\d{7}$/.test(phone)) {
  console.error("Usage: node scripts/test-make-webhook.mjs 506XXXXXXXX  (a CR mobile number)");
  process.exit(1);
}

// Same envelope and lead fields that /api/outreach/dispatch sends, so the
// scenario's Iterator on `leads` and its field mappings behave as they would
// for a real batch.
const payload = {
  sequence_stage: "pitch_1",
  count: 1,
  leads: [
    {
      lead_id: "test-lead",
      phone: `+${phone}`,
      business_name: "Test Salon",
      canton: "",
      province: "",
      message_text: "Prueba de Auralink: si recibe este mensaje, el webhook de Make funciona.",
      sequence_stage: "pitch_1",
    },
  ],
};

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log(`HTTP ${response.status}: ${await response.text()}`);
if (!response.ok) process.exit(1);
