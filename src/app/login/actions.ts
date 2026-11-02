"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseUserClient } from "@/lib/supabase/server";

/**
 * Server Actions de acceso. Next verifica Origin vs Host en Server Actions
 * (protección CSRF integrada). No existe registro público: las cuentas se
 * crean por invitación (scripts/invite-operator.mjs).
 */

export interface LoginState {
  error?: string;
  info?: string;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  // Solo rutas internas: evita redirecciones abiertas.
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/dashboard";
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Revise el correo y la contraseña." };

  let supabase;
  try {
    supabase = await createSupabaseUserClient();
  } catch {
    return { error: "El inicio de sesión no está disponible en este momento." };
  }
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Mensaje genérico: no revela si el correo existe.
    return { error: "Correo o contraseña incorrectos." };
  }
  redirect(safeNext(formData.get("next")));
}

async function appOrigin(): Promise<string> {
  const configured = process.env.APP_ORIGIN?.split(",")[0]?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestPasswordReset(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(formData.get("email"));
  if (!email.success) return { error: "Escriba un correo válido." };
  try {
    const supabase = await createSupabaseUserClient();
    await supabase.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${await appOrigin()}/auth/callback?next=/auth/nueva-clave`,
    });
  } catch {
    // Se ignora a propósito: la respuesta es la misma exista o no la cuenta.
  }
  return {
    info: "Si el correo tiene acceso, le llegará un enlace para crear una contraseña nueva. Revise también la carpeta de spam.",
  };
}

const newPasswordSchema = z
  .object({ password: z.string().min(10).max(200), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"] });

export async function setNewPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: "La contraseña debe tener al menos 10 caracteres y ambas deben coincidir." };
  }
  const supabase = await createSupabaseUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "El enlace venció. Solicite uno nuevo desde la pantalla de ingreso." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "No se pudo guardar la contraseña. Intente con otra." };
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createSupabaseUserClient();
    await supabase.auth.signOut();
  } finally {
    redirect("/login");
  }
}
