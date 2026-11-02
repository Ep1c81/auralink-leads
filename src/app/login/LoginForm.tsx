"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, signIn, type LoginState } from "./actions";

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const buttonClass =
  "w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60";

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [loginState, loginAction, loginPending] = useActionState<LoginState, FormData>(signIn, {});
  const [resetState, resetAction, resetPending] = useActionState<LoginState, FormData>(
    requestPasswordReset,
    {}
  );

  if (mode === "reset") {
    return (
      <form action={resetAction} className="flex flex-col gap-4" aria-labelledby="reset-title">
        <h2 id="reset-title" className="text-lg font-semibold text-gray-900 dark:text-zinc-50">
          Recuperar acceso
        </h2>
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          Escriba su correo y le enviaremos un enlace para crear una contraseña nueva.
        </p>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
          Correo
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </label>
        {resetState.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{resetState.error}</p>
        )}
        {resetState.info && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{resetState.info}</p>
        )}
        <button type="submit" disabled={resetPending} className={buttonClass}>
          {resetPending ? "Enviando…" : "Enviar enlace"}
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className="text-sm text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
        >
          Volver al ingreso
        </button>
      </form>
    );
  }

  return (
    <form action={loginAction} className="flex flex-col gap-4" aria-labelledby="login-title">
      <h2 id="login-title" className="text-lg font-semibold text-gray-900 dark:text-zinc-50">
        Ingresar
      </h2>
      {notice && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {notice}
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
        Correo
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      {loginState.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{loginState.error}</p>
      )}
      <button type="submit" disabled={loginPending} className={buttonClass}>
        {loginPending ? "Ingresando…" : "Ingresar"}
      </button>
      <button
        type="button"
        onClick={() => setMode("reset")}
        className="text-sm text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
      >
        ¿Olvidó su contraseña?
      </button>
    </form>
  );
}
