"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/outreach/ErrorState";

export default function CampaignDetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[outreach] campaign detail failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <ErrorState
        title="Couldn't load this campaign"
        message={error.message || "An unexpected error occurred."}
        onRetry={retry}
      />
    </div>
  );
}
