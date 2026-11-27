// Deterministic WhatsApp conversation engine for the BizMapShield 14-day trial funnel.
// Pure function: no I/O, no AI. Given the contact row (or null) and one inbound message,
// returns the reply to send (inside the free 24h customer-service window), the contact
// fields to update, and an optional alert for Alex. Same input -> same output.

export const SIGNUP_URL = 'https://bizmapshield.vercel.app/?prueba=1';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const has = (t, ...words) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(t));

export const TEXT = {
  welcome: (name, business) =>
    `¡Hola${name ? ' ' + name : ''}! 👋 Soy el asistente de BizMapShield. Recibimos el registro de *${business}* para la prueba gratis de 14 días.\n\n` +
    `Responda con un número:\n1️⃣ Activar mi prueba gratis\n2️⃣ Tengo una pregunta\n3️⃣ No me interesa`,
  askSchedule:
    '¡Excelente! 🙌 La instalación es gratis en la GAM y toma unos 10 minutos.\n\n¿Qué día y horario le queda mejor? (Ej.: "martes en la mañana")',
  scheduled: (slot) =>
    `¡Listo! ✅ Anotamos su preferencia: *${slot}*.\nAlex le escribe pronto para confirmar la visita. ¡Gracias por confiar en BizMapShield!`,
  askQuestion: 'Con gusto. Escríbame su pregunta (por ejemplo: precios, cómo funciona, si necesita app). 🙂',
  handoff: 'Gracias, le paso su consulta a Alex y él le responde por aquí pronto. 🙌',
  declined: 'Entendido, no le volveremos a escribir. ¡Muchos éxitos con su negocio! 🙏',
  sale: '¡Excelente! 🎉 Alex le contacta en breve para ayudarle a elegir y activar su plan.',
  invite:
    `¡Hola! 👋 Gracias por escribir a BizMapShield. Para activar su prueba gratis de 14 días, complete este registro de 30 segundos:\n${SIGNUP_URL}`,
  nextStep: '\n\n¿Activamos su prueba gratis de 14 días? Responda *1* para coordinar.',
};

export const FAQ = [
  [['precio', 'precios', 'cuanto', 'costo', 'cuesta', 'vale', 'plan', 'planes', 'tarifa'],
    'Planes: Básico ₡19.900 pago único · Pro ₡19.900 inicial + ₡9.900/mes · Premium ₡39.900 inicial + ₡39.900/mes. La prueba de 14 días es gratis y sin compromiso.'],
  [['funciona', 'como', 'que es', 'nfc', 'qr', 'tarjeta', 'stand'],
    'Colocamos un stand o tarjeta NFC con QR. Sus clientes la tocan o escanean y llegan directo a la página de reseñas de su negocio en Google. Cada cliente decide libremente si deja su opinión.'],
  [['app', 'aplicacion', 'descargar', 'instalar'],
    'No hace falta instalar ninguna aplicación: el cliente solo acerca el celular o escanea el QR.'],
  [['autentic', 'falsa', 'falsas', 'compran', 'comprar resenas', 'garantiz'],
    'Solo invitamos a clientes reales a opinar de forma voluntaria. No compramos reseñas ni garantizamos 5 estrellas.'],
  [['prueba', 'gratis', '14 dias', 'compromiso'],
    'La prueba dura 14 días, es gratis, sin compromiso de compra, y la instalación en la GAM no tiene costo.'],
];

const OPT_OUT = ['salir', 'stop', 'baja', 'no me interesa', 'no gracias', 'no, gracias', 'no molestar'];
const BUY = ['comprar', 'contratar', 'pagar', 'pago', 'sinpe', 'quiero el plan', 'plan pro', 'plan premium', 'plan basico'];
const YES = ['1', 'si', 'activar', 'activemos', 'quiero', 'confirmo', 'dale', 'claro', 'enviar', 'si envieme el video'];

function faq(t) {
  for (const [keys, answer] of FAQ) if (keys.some((k) => (k.includes(' ') ? t.includes(k) : has(t, k)))) return answer;
  return null;
}

/**
 * @param {{contact: null | {phone:string,business_name:string,contact_name?:string|null,conv_state:string,trial_status:string,customer?:boolean},
 *          text?: string, button?: string, kind: 'reply'|'optout'}} input
 * @returns {{reply: string|null, update: Record<string,unknown>|null, notify: string|null}}
 */
export function decide({ contact, text, button, kind }) {
  const raw = String(text || '').slice(0, 1000);
  const t = norm(raw);
  const btn = norm(button);
  const who = contact ? `${contact.business_name} (+${contact.phone})` : '';

  if (!contact) {
    if (has(t, 'prueba', 'diagnostico', 'shieldy', 'bizmapshield', 'tarjeta', 'resenas', 'info', 'informacion'))
      return { reply: TEXT.invite, update: null, notify: null };
    return { reply: null, update: null, notify: `Mensaje de un número sin registro: "${raw.slice(0, 300)}"` };
  }
  if (contact.customer || ['ready_for_activation', 'active'].includes(contact.trial_status)) {
    return { reply: null, update: null, notify: `Mensaje de ${who} (${contact.trial_status === 'active' ? 'cliente' : 'prueba por activar'}): "${raw.slice(0, 300)}"` };
  }
  if (kind === 'optout' || btn === 'no' || OPT_OUT.some((w) => t === w || t.startsWith(w + ' ') || t.includes(w))
      || (contact.conv_state === 'awaiting_choice' && t === '3')) {
    return { reply: TEXT.declined, update: { conv_state: 'closed', trial_status: 'declined', suppressed: true }, notify: null };
  }
  if (BUY.some((w) => t.includes(w))) {
    return { reply: TEXT.sale, update: { conv_state: 'done' }, notify: `💰 VENTA LISTA: ${who} quiere comprar. Mensaje: "${raw.slice(0, 300)}"` };
  }
  const state = contact.conv_state || 'new';
  if (state === 'awaiting_schedule') {
    if (raw.trim().length >= 3) {
      const slot = raw.trim().slice(0, 120);
      return { reply: TEXT.scheduled(slot), update: { conv_state: 'done', trial_status: 'ready_for_activation', preferred_slot: slot },
        notify: `✅ LISTO PARA ACTIVAR: ${who}${contact.contact_name ? ' — ' + contact.contact_name : ''}. Horario preferido: "${slot}"` };
    }
    return { reply: TEXT.askSchedule, update: null, notify: null };
  }
  if (state === 'awaiting_choice' || state === 'faq' || state === 'done') {
    if (YES.includes(t) || btn === 'enviar' || t.startsWith('si ') || t.startsWith('1 ')) {
      return { reply: TEXT.askSchedule, update: { conv_state: 'awaiting_schedule', trial_status: 'scheduling' }, notify: null };
    }
    if (t === '2' || has(t, 'pregunta', 'consulta', 'duda')) return { reply: TEXT.askQuestion, update: { conv_state: 'faq' }, notify: null };
    const a = faq(t);
    if (a) return { reply: a + TEXT.nextStep, update: { conv_state: 'awaiting_choice' }, notify: null };
    return { reply: TEXT.handoff, update: { conv_state: 'awaiting_choice' }, notify: `❓ Consulta de ${who}: "${raw.slice(0, 300)}"` };
  }
  // state 'new': first message after registering (or a reply to an approved pitch template).
  if (btn === 'enviar' || YES.includes(t)) {
    return { reply: TEXT.askSchedule, update: { conv_state: 'awaiting_schedule', trial_status: 'scheduling' }, notify: null };
  }
  return { reply: TEXT.welcome(contact.contact_name, contact.business_name),
    update: { conv_state: 'awaiting_choice', trial_status: contact.trial_status === 'none' ? 'registered' : contact.trial_status }, notify: null };
}
