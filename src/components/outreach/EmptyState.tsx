import type { ReactNode } from "react";
import { body, cardTitle, panel } from "./theme";

// Presentational, server-render-safe (no hooks). `children` is a slot for a
// call-to-action — often a small Client Component — following the standard
// Next.js pattern of interleaving a client subtree inside server-rendered UI.
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-16 text-center ${panel}`}>
      <div
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-500/10 ring-1 ring-inset ring-violet-400/30"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-5 w-5 text-violet-300"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5v10.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V6.75Zm0 0L12 13.5l8.25-6.75"
          />
        </svg>
      </div>
      <p className={cardTitle}>{title}</p>
      <p className={`max-w-sm ${body}`}>{description}</p>
      {children}
    </div>
  );
}
