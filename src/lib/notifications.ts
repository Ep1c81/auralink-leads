import type { BantQualification, Lead } from "@/lib/types";

const WHATSAPP_API_VERSION = "v21.0";

function formatAlert(lead: Lead, qualification: BantQualification): string {
  return [
    `🎯 Lead qualified: ${lead.name ?? "Unknown"} (${lead.company ?? "n/a"})`,
    `Score: ${qualification.overall_score}/100`,
    `Email: ${lead.email ?? "n/a"} | Phone: ${lead.phone ?? "n/a"}`,
    qualification.summary,
  ].join("\n");
}

/**
 * Sends a WhatsApp alert via the Meta Cloud API when configured
 * (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_ALERT_TO).
 * Falls back to a console log otherwise. Never throws — a notification
 * failure should not fail lead qualification.
 */
export async function notifyLeadQualified(
  lead: Lead,
  qualification: BantQualification
): Promise<void> {
  if (process.env.OPERATOR_ALERTS_ENABLED !== 'true') return;
  const message = formatAlert(lead, qualification);

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const toNumber = process.env.WHATSAPP_ALERT_TO;

  if (!phoneNumberId || !accessToken || !toNumber) {
    console.log("notifications.ts: operación registrada");
    return;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toNumber,
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!response.ok) {

      console.error("notifications.ts: operación registrada");
    }
  } catch {
    console.error("notifications.ts: operación registrada");
  }
}
