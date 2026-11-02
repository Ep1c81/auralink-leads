import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingresar" };

const NOTICES: Record<string, string> = {
  "sin-acceso":
    "Su cuenta existe pero no tiene acceso a Auralink Leads. Pídale al administrador que lo habilite.",
  "no-disponible": "No se pudo verificar la sesión en este momento. Intente de nuevo en unos minutos.",
  "enlace-invalido": "El enlace venció o ya se usó. Solicite uno nuevo.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-xl font-bold text-gray-900 dark:text-zinc-50">Auralink Leads</h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-zinc-400">
          Herramienta interna de ventas de Auralink Digital y BizMapShield.
        </p>
        <LoginForm next={safeNext} notice={error ? NOTICES[error] ?? null : null} />
      </div>
    </main>
  );
}
