"use client";

import { useActionState } from "react";
import { setNewPassword, type LoginState } from "@/app/login/actions";

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
        Contraseña nueva
        <input name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
        Repita la contraseña
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? "Guardando…" : "Guardar y entrar"}
      </button>
    </form>
  );
}
