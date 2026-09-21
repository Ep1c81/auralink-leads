// Costa Rica: local numbers are 8 digits with no area code; +506 is the
// country code. This is a best-effort formatter for wa.me links, not
// validation — a number that fits neither shape is passed through as-is
// (within E.164's 15-digit ceiling) rather than rejected, since a
// wrong-but-present number is still worth a rep double-checking manually.
export const CR_COUNTRY_CODE = "506";
const E164_MAX_DIGITS = 15;

/** Digits-only number ready for `https://wa.me/<number>`, or null if unusable. */
export function formatWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw || raw === "N/A") return null;
  const digits = raw.replace(/\D/g, "");
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

export function buildOutreachMessage({
  businessName,
  canton,
}: {
  businessName?: string | null;
  canton?: string | null;
}): string {
  const name = businessName?.trim() || "su negocio";
  const zone = canton?.trim() || "la zona";
  // "en la zona de la zona" is nonsense, so the fallback drops the "de".
  const inZoneOf = canton?.trim() ? `en la zona de ${zone}` : "en la zona";

  return `🚨 ¿Cuántos clientes perdió hoy en ${name} por no aparecer de primero en Google Maps?

Hola, equipo de ${name}. Un gusto saludarle.

Estaba revisando las búsquedas locales ${inZoneOf} y noté algo crítico:

Su negocio tiene un excelente servicio, pero sus competidores más cercanos se están llevando a los clientes listos para pagar solo porque tienen más opiniones de 5 estrellas acumuladas en Google Maps.

Hoy en día, el 88% de las personas en Costa Rica deciden a dónde ir basándose únicamente en la reputación en Google antes de llamar o pedir un Uber. Si no está capturando esas reseñas en el momento exacto en que sus clientes están satisfechos, está dejando ingresos sobre la mesa todos los meses.

En Auralink Digital desarrollamos un sistema inteligente con placas NFC / QR de contacto directo y filtrado automático por WhatsApp:

1. Cero fricción: El cliente toca la placa con su celular al pagar y en 3 segundos deja su reseña de 5 estrellas.
2. Protección de reputación: Filtra opiniones negativas de forma privada antes de que lleguen a su perfil público.
3. Dominio local: Supera a su competencia local en el mapa en tiempo récord.

🔥 Oferta exclusiva para la zona: Solo estamos activando 5 placas piloto esta semana para negocios verificados en ${zone} con condiciones especiales.

Sin compromiso alguno, ¿le parecería bien si le comparto un video corto de 20 segundos para que vea cómo funciona en vivo?`;
}

export function buildWhatsAppUrl(waNumber: string, message?: string): string {
  const base = `https://wa.me/${waNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
