#!/usr/bin/env node
/**
 * Da acceso a un operador de Auralink Leads (no hay registro público).
 *
 * Uso (desde la carpeta del proyecto, con .env.local completo):
 *   node scripts/invite-operator.mjs correo@ejemplo.com [admin|operator]
 *   node scripts/invite-operator.mjs --desactivar correo@ejemplo.com
 *
 * Qué hace:
 *   1. Crea el usuario en Supabase Auth si no existe (correo confirmado).
 *   2. Lo agrega/activa en public.operators.
 *   3. Imprime un enlace de un solo uso para que la persona cree su
 *      contraseña. Ese enlace ES una credencial: envíelo solo a esa persona.
 *
 * Requiere SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y APP_ORIGIN (o
 * OUTREACH_APP_URL) en .env.local. Nunca imprime claves.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // sin .env.local: se usan las variables del entorno
  }
}

loadEnvLocal();
const args = process.argv.slice(2);
const deactivate = args[0] === "--desactivar";
const email = (deactivate ? args[1] : args[0])?.trim().toLowerCase();
const role = deactivate ? null : args[1] === "admin" ? "admin" : "operator";

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: node scripts/invite-operator.mjs correo@ejemplo.com [admin|operator]");
  process.exit(2);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const origin = (process.env.APP_ORIGIN?.split(",")[0] || process.env.OUTREACH_APP_URL || "").replace(/\/$/, "");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(target) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

if (deactivate) {
  const { error, count } = await admin
    .from("operators")
    .update({ active: false }, { count: "exact" })
    .eq("email", email);
  if (error) {
    console.error("No se pudo desactivar:", error.message);
    process.exit(1);
  }
  console.log(count ? `Acceso desactivado para ${email}.` : `${email} no estaba en la lista.`);
  process.exit(0);
}

if (!origin) {
  console.error("Falta APP_ORIGIN (o OUTREACH_APP_URL) para construir el enlace.");
  process.exit(2);
}

let userId = await findUserId(email);
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) {
    console.error("No se pudo crear el usuario:", error.message);
    process.exit(1);
  }
  userId = data.user.id;
}

const { error: opError } = await admin
  .from("operators")
  .upsert({ user_id: userId, email, role, active: true, invited_by: "scripts/invite-operator.mjs" });
if (opError) {
  console.error("No se pudo registrar en operators (¿aplicó la migración 20261101100000?):", opError.message);
  process.exit(1);
}

const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
if (linkError || !link?.properties?.hashed_token) {
  console.error("Usuario habilitado, pero no se pudo generar el enlace:", linkError?.message);
  console.error("La persona puede usar «¿Olvidó su contraseña?» en la pantalla de ingreso.");
  process.exit(1);
}
const setPasswordUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(
  link.properties.hashed_token
)}&type=recovery&next=/auth/nueva-clave`;

console.log(`Listo: ${email} tiene acceso como ${role}.`);
console.log("Enlace de un solo uso para crear la contraseña (vence pronto; no lo comparta con nadie más):");
console.log(setPasswordUrl);
