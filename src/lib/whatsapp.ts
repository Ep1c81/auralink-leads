// Costa Rica: local numbers are 8 digits with no area code; +506 is the
// country code. This is a best-effort formatter for wa.me links, not
// validation — a number that fits neither shape is passed through as-is
// (within E.164's 15-digit ceiling) rather than rejected, since a
// wrong-but-present number is still worth a rep double-checking manually.
export const CR_COUNTRY_CODE = "506";
const E164_MAX_DIGITS = 15;

/**
 * Digits-only international number for WhatsApp click-to-chat links, or null
 * if unusable. Mirrored in SQL by public.format_wa_phone (which backs the
 * bizmap_leads.wa_phone generated column) — change both together.
 */
export function formatWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw || raw === "N/A") return null;
  // "00" is the international dialing prefix ("00506 2269 3709"), not part of the number.
  const digits = raw.replace(/\D/g, "").replace(/^00/, "");
  if (!digits) return null;
  if (digits.length === 8) return CR_COUNTRY_CODE + digits;
  // Longer than E.164 allows — typically several numbers run together in the
  // source data, which wa.me can't open.
  if (digits.length > E164_MAX_DIGITS) return null;
  if (digits.startsWith(CR_COUNTRY_CODE) && digits.length >= 10) return digits;
  return digits.length >= 8 ? digits : null;
}

/**
 * `address` in bizmap_leads holds the canton/city ("Escazu", "San Jose"), but
 * ~80% of rows carry the generic "GAM, Costa Rica" placeholder, which reads
 * badly inside a sentence — treat that as "no canton".
 */
export function cantonFromAddress(address: string | null | undefined): string {
  const cleaned = (address ?? "").replace(/,?\s*Costa Rica\s*$/i, "").trim();
  if (!cleaned || cleaned.toUpperCase() === "GAM" || cleaned === "N/A") return "";
  return cleaned;
}

export type OutreachStage = "pitch" | "follow_up";

export const OUTREACH_STAGES: { value: OutreachStage; label: string }[] = [
  { value: "pitch", label: "Mensaje 1: Pitch Inicial" },
  { value: "follow_up", label: "Mensaje 2: Seguimiento (Sin respuesta)" },
];

/** Stage a rep most likely wants: anyone already messaged gets the follow-up. */
export function defaultOutreachStage(outreachedAt: string | null | undefined): OutreachStage {
  return outreachedAt ? "follow_up" : "pitch";
}

export function buildOutreachMessage({
  businessName,
  canton,
  stage = "pitch",
}: {
  businessName?: string | null;
  canton?: string | null;
  stage?: OutreachStage;
}): string {
  if (stage === "follow_up") return buildFollowUpMessage(businessName);
  return buildPitchMessage(businessName, canton);
}

function buildFollowUpMessage(businessName?: string | null): string {
  const name = businessName?.trim() || "su negocio";
  return `Estimado/a ${name},

Le escribimos hace unos días desde BizMapShield sobre cómo ayudar a su negocio a destacar en Google Maps y multiplicar sus reseñas de 5 estrellas.

Sabemos que su agenda es muy ocupada, así que queríamos dar seguimiento por si el mensaje anterior se le pasó.

Si le interesa, con gusto le mostramos en una demostración breve y sin compromiso cómo funciona. Puede responder directamente a este mensaje o escribirnos a nuestro correo oficial: premium@auralinkdigital.com

Cordialmente,
Equipo AuralinkDigital 🇨🇷`.normalize("NFC");
}

function buildPitchMessage(businessName?: string | null, canton?: string | null): string {
  const name = businessName?.trim() || "su negocio";
  const zone = canton?.trim() || "la zona";

  return `Estimado/a ${name},

Le escribimos desde BizMapShield, la solución costarricense que ayuda a negocios locales como el suyo en ${zone} a destacar en Google Maps y multiplicar sus reseñas de 5 estrellas.

Sabemos que su reputación es su activo más valioso. Nuestro sistema convierte cada visita en una reseña automática, sin que usted tenga que pedir nada.

Si desea conocer más sobre cómo podemos ayudarle a dominar su zona, puede:

💬 Responder directamente a este mensaje
✉️ Escribirnos a nuestro correo oficial: premium@auralinkdigital.com
🌐 Visitarnos en:
   • bizmapshield.vercel.app
   • auralinkdigital.com

Estamos a su disposición para una demostración sin compromiso.

Cordialmente,
Equipo AuralinkDigital 🇨🇷`.normalize("NFC");
}

// Not wa.me: its redirect to api.whatsapp.com mangles 4-byte UTF-8 (emoji
// such as 🚨 / 👋 / 🔥) in the prefilled text, which then shows up as "�" in
// the chat box. Linking to api.whatsapp.com directly skips that hop.
export function buildWhatsAppUrl(waNumber: string, message?: string): string {
  const base = `https://api.whatsapp.com/send?phone=${waNumber}`;
  return message ? `${base}&text=${encodeURIComponent(message)}` : base;
}
