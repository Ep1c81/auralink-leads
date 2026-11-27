/** Transport errors are deliberately safe to return to the operator: never
 * include the webhook URL (a credential), response body, or fetch cause. */
export class MakeDispatchError extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "unknown") {
    super(message);
  }
}

export function validateMakeWebhook(raw: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw?.trim() ?? "");
  } catch {
    throw new Error("Configurá MAKE_DISPATCH_WEBHOOK_URL con la URL del webhook de Make.");
  }
  if (url.protocol !== "https:" || !/^hook\.[a-z0-9-]+\.make\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname === "/" || url.search || url.hash) {
    throw new Error("MAKE_DISPATCH_WEBHOOK_URL debe ser un webhook HTTPS de Make, sin parámetros adicionales.");
  }
  return url.href;
}

export function assertNotSender(recipient: string, sender?: string): void {
  if (!sender?.trim()) return;
  const digits = sender.replace(/\D/g, "");
  if (!/^506[0-9]{8}$/.test(digits)) {
    throw new Error("WHATSAPP_SENDER_PHONE debe incluir 506 y ocho dígitos; no uses el Phone Number ID.");
  }
  if (recipient.replace(/\D/g, "") === digits) {
    throw new Error("El destinatario coincide con el emisor de WhatsApp. Usá otro número para la prueba.");
  }
}

/** A successful result ONLY means accepted by Make, never delivered by Meta.
 * No automatic retries: a timed-out request may already be in Make's queue. */
export async function sendMakePayload(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    throw new MakeDispatchError(
      "No se pudo confirmar la recepción de Make. El envío puede estar en cola: revisá su historial antes de reintentar.",
      "unknown"
    );
  }
  if (!response.ok) {
    const hint = response.status === 410 || response.status === 404
      ? "Revisá que el webhook exista y esté asociado al escenario correcto."
      : response.status === 429
        ? "Make alcanzó su límite de solicitudes."
        : response.status === 400
          ? "Revisá la cola, el formato del JSON y la configuración del webhook."
          : "Revisá el historial del escenario y su conexión.";
    throw new MakeDispatchError(`Make respondió HTTP ${response.status}. ${hint}`, "rejected");
  }
}
