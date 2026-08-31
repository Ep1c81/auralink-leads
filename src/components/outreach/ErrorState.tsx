import { body, cardTitle, secondaryButton } from "./theme";

// Presentational fallback for a failed section fetch, with a retry action.
// Used inside route error.tsx boundaries (which call this with `onRetry`
// bound to the boundary's `retry()`), so a failed load always offers a way
// to recover rather than dead-ending on a blank screen.
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-12 text-center backdrop-blur-xl">
      <p className={`${cardTitle} text-red-300`}>{title}</p>
      <p className={`max-w-sm ${body} text-red-200/70`}>{message}</p>
      <button type="button" onClick={onRetry} className={`mt-1 ${secondaryButton}`}>
        Try again
      </button>
    </div>
  );
}
