"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewCampaignForm } from "./NewCampaignForm";
import { primaryButton, secondaryButton } from "./theme";

/**
 * Owns the "create a campaign" interaction end to end: the trigger button
 * (styled per placement) plus the form. On success it calls router.refresh()
 * so the parent Server Component re-fetches listCampaigns() and the new
 * campaign appears — this component holds no campaign list state itself,
 * the server list is the single source of truth.
 */
export function CreateCampaignFlow({ variant }: { variant: "header" | "empty" }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  function handleCreated() {
    setCreating(false);
    router.refresh();
  }

  if (variant === "empty") {
    return creating ? (
      <div className="w-full max-w-sm">
        <NewCampaignForm onCancel={() => setCreating(false)} onCreated={handleCreated} />
      </div>
    ) : (
      <button type="button" onClick={() => setCreating(true)} className={`mt-2 ${primaryButton}`}>
        Create campaign
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={secondaryButton}>
            + New campaign
          </button>
        )}
      </div>
      {creating && (
        <NewCampaignForm onCancel={() => setCreating(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
