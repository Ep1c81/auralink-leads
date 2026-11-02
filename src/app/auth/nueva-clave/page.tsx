import type { Metadata } from "next";
import { NewPasswordForm } from "./NewPasswordForm";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default function NewPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-xl font-bold text-gray-900 dark:text-zinc-50">Crear contraseña</h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-zinc-400">
          Use al menos 10 caracteres. Puede ser una frase fácil de recordar.
        </p>
        <NewPasswordForm />
      </div>
    </main>
  );
}
