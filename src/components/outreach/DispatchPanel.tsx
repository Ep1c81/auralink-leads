"use client";

import { useState } from "react";
import type { DispatchItem, DispatchResult } from "@/lib/outreachAutomation";
import {
  body,
  input,
  label,
  meta,
  panel,
  panelTitle,
  primaryButton,
  secondaryButton,
  successButton,
} from "./theme";

const SECRET_KEY = "outreach-automation-secret";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

function readSavedSecret(): string {
  try {
    return sessionStorage.getItem(SECRET_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveSecret(secret: string) {
  try {
    sessionStorage.setItem(SECRET_KEY, secret);
  } catch {
    // Storage blocked (private window etc.): the secret just isn't remembered.
  }
}

type Phase = "idle" | "previewing" | "previewed" | "sending" | "sent";

/**
 * Manual trigger for stage 1 of the automated WhatsApp sequence. Calls
 * /api/outreach/dispatch with the OUTREACH_AUTOMATION_SECRET the operator
 * types in — the CRM has no login, so the secret is never shipped in the
 * bundle. "Preview batch" does a dry_run first; "Send now" skips the preview
 * and dispatches straight away.
 */
export function DispatchPanel() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState(readSavedSecret);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function dispatch(dryRun: boolean) {
    setError(null);
    setPhase(dryRun ? "previewing" : "sending");
    saveSecret(secret);
    const params = new URLSearchParams({ limit: String(limit) });
    if (dryRun) params.set("dry_run", "1");
    try {
      const response = await fetch(`/api/outreach/dispatch?${params}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret.trim()}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const reason =
          response.status === 401 ? "Wrong secret" : (data?.error ?? `Request failed (${response.status})`);
        throw new Error(reason);
      }
      setResult(data as DispatchResult);
      setPhase(dryRun ? "previewed" : "sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A failed send may still have gone out (see the route's error text),
      // so drop back to idle and make the operator preview again.
      setPhase("idle");
      setResult(null);
    }
  }

  function reset() {
    setPhase("idle");
    setResult(null);
    setError(null);
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className={primaryButton}>
          Dispatch WhatsApp pitches
        </button>
      </div>
    );
  }

  const busy = phase === "previewing" || phase === "sending";
  const leads = result?.leads ?? [];

  return (
    <section className={`${panel} flex flex-col gap-4 p-5`} aria-labelledby="dispatch-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="dispatch-title" className={panelTitle}>
            Dispatch pitches
          </h2>
          <p className={`mt-1 ${body}`}>
            Sends the first WhatsApp message to Queued mobile leads through Make and marks them
            Pitch Sent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className={secondaryButton}
          disabled={busy}
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Automation secret</span>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              reset();
            }}
            className={input}
            placeholder="OUTREACH_AUTOMATION_SECRET"
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Leads</span>
          <input
            type="number"
            min={1}
            max={MAX_LIMIT}
            value={limit}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              setLimit(Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : 1);
              reset();
            }}
            className={input}
            disabled={busy}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {phase === "sent" && result && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Sent {result.dispatched} pitch{result.dispatched === 1 ? "" : "es"} to Make
          {result.skipped_duplicates > 0 && ` · ${result.skipped_duplicates} duplicate number(s) skipped`}.
        </p>
      )}

      {(phase === "previewed" || phase === "sent") && (
        <LeadList leads={leads} heading={phase === "sent" ? "Sent" : "Will be sent"} />
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {phase === "previewed" ? (
          <>
            <button type="button" onClick={reset} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => dispatch(false)}
              className={successButton}
              disabled={leads.length === 0}
            >
              Send {leads.length} pitch{leads.length === 1 ? "" : "es"}
            </button>
          </>
        ) : phase === "sent" ? (
          <button type="button" onClick={reset} className={primaryButton}>
            Start another batch
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => dispatch(true)}
              className={secondaryButton}
              disabled={busy || !secret.trim()}
            >
              {phase === "previewing" ? "Loading preview…" : "Preview batch"}
            </button>
            <button
              type="button"
              onClick={() => dispatch(false)}
              className={successButton}
              disabled={busy || !secret.trim()}
            >
              {phase === "sending" ? "Sending…" : `Send now (${limit})`}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function LeadList({ leads, heading }: { leads: DispatchItem[]; heading: string }) {
  if (leads.length === 0) {
    return <p className={body}>No Queued mobile leads to send right now.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className={label}>
        {heading} · {leads.length}
      </p>
      <ul className="flex max-h-72 flex-col divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/10">
        {leads.map((lead) => (
          <li key={lead.lead_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
            <span className="text-sm text-slate-100">{lead.business_name || "(no name)"}</span>
            <span className={`${meta} font-mono`}>
              {lead.phone}
              {(lead.canton || lead.province) && ` · ${[lead.canton, lead.province].filter(Boolean).join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
