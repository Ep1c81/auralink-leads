"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/outreach/ErrorState";

export default function HoyError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[hoy] hot list failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <ErrorState
        title="No se pudo cargar la lista"
        message="Revisá la conexión con la base de datos e intentá de nuevo."
        onRetry={retry}
      />
    </div>
  );
}
