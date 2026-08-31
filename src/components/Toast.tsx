"use client";

import { useEffect } from "react";

const AUTO_DISMISS_MS = 4000;

/**
 * Minimal fixed-position toast for transient, non-blocking notices (e.g. a
 * rejected submission that isn't really an "error" — just already exists).
 * Auto-dismisses, but stays screen-reader friendly via aria-live.
 */
export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex w-full max-w-sm items-start gap-3 rounded-lg border border-amber-200 bg-white px-4 py-3 shadow-lg dark:border-amber-900/40 dark:bg-zinc-900"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <p className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </div>
  );
}
