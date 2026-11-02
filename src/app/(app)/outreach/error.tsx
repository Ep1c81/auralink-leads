"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/outreach/ErrorState";

// Error boundaries must be Client Components. `retry()` re-fetches and
// re-renders this segment (i.e. re-runs listCampaigns() in page.tsx) —
// the "failed fetches must show a retry action" requirement, handled by
// the framework's own recovery mechanism instead of manual state.
export default function OutreachError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[outreach] campaign list failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <ErrorState
        title="Couldn't load campaigns"
        message={error.message || "An unexpected error occurred."}
        onRetry={retry}
      />
    </div>
  );
}
