import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isSameOriginMutation, newRequestId } from "@/lib/http";

/**
 * Capa de acceso (DAL) para operadores. Cada API administrativa, Server
 * Action y Server Component que lee datos del CRM pasa por aquí.
 *
 * 1. Identidad: `supabase.auth.getUser()` valida el token con el servidor de
 *    Supabase Auth (no basta con que exista una cookie).
 * 2. Autorización: el usuario debe estar en `public.operators` con
 *    active = true. La lista se administra solo del lado servidor
 *    (scripts/invite-operator.mjs); no hay registro público.
 */

export type OperatorRole = "admin" | "operator";

export interface Operator {
  userId: string;
  email: string;
  role: OperatorRole;
}

export type OperatorCheck =
  | { status: "ok"; operator: Operator }
  | { status: "anonymous" }
  | { status: "forbidden"; email: string | null }
  | { status: "unavailable" };

export interface AuthDeps {
  getUser(): Promise<{ id: string; email: string | null } | null>;
  findOperator(userId: string): Promise<{ email: string; role: string; active: boolean } | null>;
}

/** Lógica pura y testeable de la verificación. */
export async function checkOperatorWith(deps: AuthDeps): Promise<OperatorCheck> {
  let user: { id: string; email: string | null } | null;
  try {
    user = await deps.getUser();
  } catch (err) {
    unstable_rethrow(err); // errores de control de Next (render dinámico, redirect)
    console.error("[auth] no se pudo verificar la sesión:", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }
  if (!user) return { status: "anonymous" };

  let row: Awaited<ReturnType<AuthDeps["findOperator"]>>;
  try {
    row = await deps.findOperator(user.id);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[auth] no se pudo consultar operators:", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }
  if (!row || !row.active) return { status: "forbidden", email: user.email };
  const role: OperatorRole = row.role === "admin" ? "admin" : "operator";
  return { status: "ok", operator: { userId: user.id, email: row.email, role } };
}

const realDeps: AuthDeps = {
  async getUser() {
    const supabase = await createSupabaseUserClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // "Auth session missing" = simplemente no hay sesión.
      if (error.status === 400 || error.status === 401 || /session/i.test(error.message)) return null;
      throw error;
    }
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  },
  async findOperator(userId) {
    const { data, error } = await getSupabaseAdmin()
      .from("operators")
      .select("email, role, active")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};

/** Memorizado por render (React cache), como recomienda la guía de Next. */
export const checkOperator = cache(async (): Promise<OperatorCheck> => checkOperatorWith(realDeps));

/** Para Server Components / Server Actions: redirige si no hay operador. */
export async function requireOperatorPage(): Promise<Operator> {
  const result = await checkOperator();
  if (result.status === "ok") return result.operator;
  if (result.status === "forbidden") redirect("/login?error=sin-acceso");
  if (result.status === "unavailable") redirect("/login?error=no-disponible");
  redirect("/login");
}

/**
 * Para Route Handlers administrativos. Devuelve el operador o una respuesta
 * de error lista para retornar. En mutaciones también valida el origen (CSRF).
 */
export async function requireOperatorApi(
  request: Request
): Promise<{ operator: Operator; requestId: string } | NextResponse> {
  const requestId = newRequestId();
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "Solicitud rechazada: origen no permitido", request_id: requestId },
      { status: 403 }
    );
  }
  const result = await checkOperator();
  switch (result.status) {
    case "ok":
      return { operator: result.operator, requestId };
    case "anonymous":
      return NextResponse.json(
        { error: "Inicie sesión para continuar", request_id: requestId },
        { status: 401 }
      );
    case "forbidden":
      return NextResponse.json(
        { error: "Su usuario no tiene acceso a Auralink Leads", request_id: requestId },
        { status: 403 }
      );
    default:
      return NextResponse.json(
        { error: "No se pudo verificar su sesión. Intente de nuevo en un momento.", request_id: requestId },
        { status: 503 }
      );
  }
}
