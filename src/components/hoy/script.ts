import type { HotLead } from "@/lib/hotList";

// Copy kept separate from presentation. Compliant with Google's review
// policy: ask every customer, real reviews only, never ask for 5 stars,
// never offer anything in exchange for a review.

export function whatsappIntro(lead: HotLead): string {
  return [
    `Hola, ¿hablo con el encargado de ${lead.name}?`,
    "Soy Alex de Aura Link Digital.",
    `Ayudamos a negocios${lead.zone ? ` de ${lead.zone}` : " de la zona"} a conseguir más reseñas reales en Google con una tarjeta NFC en el mostrador: el cliente la toca y deja su opinión en segundos.`,
    "Instalamos una prueba gratis de 14 días, sin compromiso. ¿Le puedo pasar a enseñarla 5 minutos esta semana?",
  ].join(" ");
}

export function callScript(lead: HotLead): string[] {
  const reviews =
    lead.reviewCount !== null
      ? `Vi que en Google tienen ${lead.reviewCount} reseñas${lead.rating !== null ? ` y ${lead.rating.toFixed(1)} estrellas` : ""}.`
      : "Vi que casi no tienen reseñas en Google.";
  return [
    `Saludo: "Hola, soy Alex de Aura Link Digital. ¿Me regala 2 minutos con el encargado de ${lead.name}?"`,
    `Gancho: "${reviews} La mayoría de clientes contentos nunca escriben, no porque no quieran, sino porque nadie se lo pide en el momento."`,
    `Solución: "Ponemos una tarjeta NFC en el mostrador. El personal le pregunta a cada cliente cómo le fue y lo invita a dejar su opinión. Lo toca con el celular y abre su perfil de Google directo."`,
    `Prueba: "Se la instalo gratis 14 días. Al día 4 le mando un reporte con lo que llevamos. Si no ve resultados, me la llevo y no paga nada."`,
    `Prueba social: "Con La Liko Store, en Santa Ana, empezamos el 6 de noviembre y en 4 días ya tenían 14 reseñas nuevas."`,
    `Cierre: "¿Se la dejo instalada hoy mismo o prefiere que pase mañana?"`,
    `Regla: invitar a todos los clientes por igual, solo reseñas reales, nunca pedir 5 estrellas ni dar nada a cambio.`,
  ];
}

export function digitsForWhatsApp(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 8) return `506${digits}`;
  return digits.length >= 10 ? digits : null;
}

export function routeUrl(leads: HotLead[]): string | null {
  const stops = leads
    .slice(0, 10)
    .map((l) => (l.address ? `${l.name}, ${l.address}` : `${l.name}, ${l.zone}, Costa Rica`));
  if (stops.length === 0) return null;
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams({ api: "1", destination, travelmode: "driving" });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export const STAGE_LABELS = {
  por_visitar: "Por visitar",
  visitado: "Visitado",
  interesado: "Interesado",
  prueba_instalada: "Prueba instalada",
  cliente: "Cliente",
  no_interesado: "No interesado",
} as const;
