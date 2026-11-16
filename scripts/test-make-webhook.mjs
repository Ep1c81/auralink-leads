// Preview one synthetic lead; --send is required to contact Make.
// No database reads or writes. Never supplies real prospect records.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export function buildTestPayload(rawPhone, rawSender) {
  const phone = (rawPhone ?? "").replace(/\D/g, "");
  const sender = (rawSender ?? "").replace(/\D/g, "");
  if (!/^506[5-8]\d{7}$/.test(phone)) {
    throw new Error("Indicá otro celular tuyo con WhatsApp: 506 seguido de ocho dígitos.");
  }
  if (!/^506\d{8}$/.test(sender)) {
    throw new Error("Configurá WHATSAPP_SENDER_PHONE con el número emisor (506 y ocho dígitos), no su ID.");
  }
  if (phone === sender) throw new Error("El destinatario no puede ser el mismo número emisor.");
  return {
    sequence_stage: "pitch_1", count: 1,
    leads: [{
      lead_id: randomUUID(), phone: `+${phone}`, business_name: "Negocio de Prueba",
      lead_score: 10, outreach_status: "Queued", canton: "", province: "",
      message_text: "Prueba de conexión de Auralink.", sequence_stage: "pitch_1",
    }],
  };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== "--send")) {
    throw new Error("Uso: node scripts/test-make-webhook.mjs 506XXXXXXXX [--send]");
  }
  const payload = buildTestPayload(args[0], env.WHATSAPP_SENDER_PHONE);
  if (!args.includes("--send")) {
    console.log("VISTA PREVIA: no se envió nada. Confirmá el mapeo de Make antes de usar --send.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  let url;
  try { url = new URL((env.MAKE_DISPATCH_WEBHOOK_URL || env.MAKE_WEBHOOK_URL || "").trim()); }
  catch { throw new Error("Configurá MAKE_DISPATCH_WEBHOOK_URL."); }
  if (url.protocol !== "https:" || !/^hook\.[a-z0-9-]+\.make\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname === "/" || url.search || url.hash) {
    throw new Error("La URL debe ser un webhook HTTPS de Make, sin parámetros adicionales.");
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000), redirect: "error",
    });
  } catch {
    throw new Error("Recepción incierta. Revisá Make antes de repetir: el mensaje puede estar en cola.");
  }
  if (!response.ok) throw new Error(`Make rechazó la solicitud: HTTP ${response.status}. Revisá el escenario.`);
  console.log(`HTTP ${response.status}: aceptado por Make. Esto NO confirma entrega por WhatsApp.`);
  console.log("Verificá el Message ID del módulo de WhatsApp y la recepción en el teléfono de prueba.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
