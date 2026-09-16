"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Toast } from "@/components/Toast";
import type {
  BantQualification,
  EnrichmentStatus,
  Lead,
  LeadStatus,
  OutreachContent,
  WebEnrichment,
} from "@/lib/types";

const POLL_INTERVAL_MS = 5000;
const QUALIFY_MAX_ATTEMPTS = 2;
const QUALIFY_RETRY_DELAY_MS = 2000;
const FALLBACK_LEAD_EMAIL = "no-email@placeholder.local";
// Spacing between sequential batch-queue requests. The backend's own
// PIPELINE_DEADLINE_MS + heuristic fallback (see /api/qualify) is the real
// safety net against rate limits or gateway drops — this stagger just keeps
// requests from stacking up back-to-back.
const BULK_QUALIFY_STAGGER_MS = 1500;
// Gap between full Auto-Pilot sweeps once one finishes. /api/cron/auto-prospect
// already staggers its own per-lead qualify/outreach calls internally, so
// this just paces how often the dashboard re-triggers the whole sweep.
const AUTO_PILOT_SWEEP_INTERVAL_MS = 60_000;

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  unqualified: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  needs_more_info: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  unqualified: "Unqualified",
  needs_more_info: "Needs Info",
};

const ENRICHMENT_STYLES: Record<EnrichmentStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  enriched: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const ENRICHMENT_LABELS: Record<EnrichmentStatus, string> = {
  pending: "Enrichment pending",
  enriched: "Enriched",
  failed: "Enrichment failed",
};

const BANT_DIMENSIONS = [
  { key: "budget", label: "Budget" },
  { key: "authority", label: "Authority" },
  { key: "need", label: "Need" },
  { key: "timeline", label: "Timeline" },
] as const;

interface FormState {
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  company: "",
  message: "",
};

interface ProspectFormState {
  industry: string;
  location: string;
  lowRatingOnly: boolean;
}

const EMPTY_PROSPECT_FORM: ProspectFormState = {
  industry: "",
  location: "",
  lowRatingOnly: false,
};

interface ProspectResult {
  found: number;
  imported: Lead[];
  skipped: number;
}

type Tab = "submit" | "discover";

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// Only shown once an enrichment attempt has actually happened — "pending" is
// the default/no-signal state for every lead and isn't worth surfacing.
function EnrichmentBadge({ status }: { status: EnrichmentStatus }) {
  if (status === "pending") return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${ENRICHMENT_STYLES[status]}`}
    >
      {ENRICHMENT_LABELS[status]}
    </span>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(10, score)) * 10;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-zinc-500 dark:text-zinc-400">
        {score}
      </span>
    </div>
  );
}

function BantBreakdown({ bant }: { bant: BantQualification }) {
  return (
    <div className="flex flex-col gap-1.5">
      {BANT_DIMENSIONS.map(({ key, label }) => (
        <ScoreBar key={key} label={label} score={bant[key].score} />
      ))}
    </div>
  );
}

function ContactDetails({
  phone,
  enrichment,
  whatsappNumber,
  instagramUrl,
  facebookUrl,
}: {
  phone: string | null;
  enrichment?: WebEnrichment;
  whatsappNumber?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
}) {
  const emails = enrichment?.emails ?? [];
  const social = enrichment ? Object.entries(enrichment.socialLinks) : [];
  const deepLinks: Array<{ label: string; url: string }> = [
    whatsappNumber ? { label: "whatsapp", url: `https://wa.me/${whatsappNumber}` } : null,
    instagramUrl ? { label: "instagram", url: instagramUrl } : null,
    facebookUrl ? { label: "facebook", url: facebookUrl } : null,
  ].filter((l): l is { label: string; url: string } => l !== null);

  if (
    !phone &&
    emails.length === 0 &&
    social.length === 0 &&
    deepLinks.length === 0 &&
    !enrichment?.error
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
      {phone && <p>📞 {phone}</p>}
      {emails.length > 0 && <p>✉️ {emails.join(", ")}</p>}
      {(social.length > 0 || deepLinks.length > 0) && (
        <p>
          {deepLinks.map(({ label, url }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mr-3 underline decoration-dotted hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {label}
            </a>
          ))}
          {social.map(([platform, url]) => (
            <a
              key={platform}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mr-3 underline decoration-dotted hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {platform}
            </a>
          ))}
        </p>
      )}
      {enrichment?.error && (
        <p className="text-zinc-400 dark:text-zinc-600">
          Website enrichment failed: {enrichment.error}
        </p>
      )}
    </div>
  );
}

// Costa Rica is the default target market for this pipeline's Spanish
// outreach copy — local numbers are stored without a country code, so an
// 8-digit national number needs "506" prepended for a valid wa.me link.
const CR_COUNTRY_CODE = "506";

function buildWhatsAppLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountryCode =
    digits.length <= 8 ? `${CR_COUNTRY_CODE}${digits}` : digits;
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(text)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard access denied — nothing actionable to do here
        }
      }}
      className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

interface AutoPilotRunSummary {
  at: string;
  imported: number;
  qualified: number;
}

function AutoPilotToggle({
  enabled,
  running,
  onToggle,
  lastRun,
  error,
}: {
  enabled: boolean;
  running: boolean;
  onToggle: () => void;
  lastRun: AutoPilotRunSummary | null;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
          enabled
            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
            : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
        }`}
      >
        <span
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-3" : "translate-x-0"
            }`}
          />
        </span>
        Run Background Auto-Pilot
        {running && <span className="font-normal opacity-70">(sweeping...)</span>}
      </button>
      {lastRun && !error && (
        <span className="text-[11px] text-zinc-400">
          Last sweep {new Date(lastRun.at).toLocaleTimeString()}: {lastRun.imported} imported,{" "}
          {lastRun.qualified} qualified
        </span>
      )}
      {error && <span className="text-[11px] text-red-500 dark:text-red-400">{error}</span>}
    </div>
  );
}

function OutreachModal({
  lead,
  content,
  loading,
  error,
  onClose,
}: {
  lead: Lead;
  content: OutreachContent | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Outreach · {lead.name ?? lead.company ?? "Lead"}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Spanish WhatsApp pitch + email template for Costa Rican SMB outreach
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            Generating outreach with Gemini...
          </p>
        )}

        {error && (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {content && !loading && (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  WhatsApp pitch
                </h3>
                <CopyButton text={content.whatsapp_pitch} />
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {content.whatsapp_pitch}
              </p>
              {lead.phone ? (
                <a
                  href={buildWhatsAppLink(lead.phone, content.whatsapp_pitch)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  Open in WhatsApp Web
                </a>
              ) : (
                <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
                  No phone on file — can&apos;t open WhatsApp Web directly.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Email
                </h3>
                <CopyButton text={`${content.email_subject}\n\n${content.email_body}`} />
              </div>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {content.email_subject}
              </p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {content.email_body}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("submit");

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    lead: Lead;
    qualification: BantQualification;
  } | null>(null);

  const [prospectForm, setProspectForm] = useState<ProspectFormState>(
    EMPTY_PROSPECT_FORM
  );
  const [prospecting, setProspecting] = useState(false);
  const [prospectError, setProspectError] = useState<string | null>(null);
  const [prospectResult, setProspectResult] = useState<ProspectResult | null>(
    null
  );

  const [qualifyingIds, setQualifyingIds] = useState<Set<string>>(new Set());
  const [qualifyErrors, setQualifyErrors] = useState<Record<string, string>>({});
  const [autoQualifyingIds, setAutoQualifyingIds] = useState<Set<string>>(new Set());
  const [autoQualifyErrors, setAutoQualifyErrors] = useState<Record<string, string>>({});
  const [bulkQualifying, setBulkQualifying] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{
    succeeded: number;
    failed: number;
    cancelled: number;
  } | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // Checked between batch-queue iterations to stop the loop early; the
  // in-flight request is aborted separately via bulkAbortControllerRef so
  // Cancel takes effect immediately instead of waiting out the current call.
  const bulkCancelRequestedRef = useRef(false);
  const bulkAbortControllerRef = useRef<AbortController | null>(null);

  const [outreachLead, setOutreachLead] = useState<Lead | null>(null);
  const [outreachContent, setOutreachContent] = useState<OutreachContent | null>(
    null
  );
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);

  const [autoPilotEnabled, setAutoPilotEnabled] = useState(false);
  const [autoPilotRunning, setAutoPilotRunning] = useState(false);
  const [autoPilotLastRun, setAutoPilotLastRun] = useState<AutoPilotRunSummary | null>(
    null
  );
  const [autoPilotError, setAutoPilotError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/leads");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setLeads(data.leads ?? []);
      } catch {
        // silent: polling failures shouldn't disrupt the dashboard
      }
    };

    const interval = setInterval(load, POLL_INTERVAL_MS);
    load();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Drives the "Run Background Auto-Pilot" toggle: while enabled, repeatedly
  // triggers a full /api/cron/auto-prospect sweep (discover -> import ->
  // qualify -> pre-generate outreach), waiting AUTO_PILOT_SWEEP_INTERVAL_MS
  // between completed sweeps so it processes new leads continuously without
  // hammering the discovery/Gemini APIs back-to-back.
  useEffect(() => {
    if (!autoPilotEnabled) return;

    let cancelled = false;

    const runLoop = async () => {
      while (!cancelled) {
        setAutoPilotRunning(true);
        setAutoPilotError(null);

        try {
          const res = await fetch("/api/cron/auto-prospect", { method: "POST" });
          const data = await res.json();

          if (cancelled) return;

          if (!res.ok) {
            setAutoPilotError(data.error ?? "Auto-Pilot sweep failed");
          } else {
            const results = (data.results ?? []) as Array<{
              imported: number;
              qualified: number;
            }>;
            const totals = results.reduce(
              (acc, r) => ({
                imported: acc.imported + r.imported,
                qualified: acc.qualified + r.qualified,
              }),
              { imported: 0, qualified: 0 }
            );
            setAutoPilotLastRun({ at: new Date().toISOString(), ...totals });

            // Pull the fresh leads in immediately so newly imported/qualified
            // businesses show up without waiting on the next poll tick.
            const leadsRes = await fetch("/api/leads");
            if (leadsRes.ok && !cancelled) {
              const leadsData = await leadsRes.json();
              setLeads(leadsData.leads ?? []);
            }
          }
        } catch {
          if (!cancelled) setAutoPilotError("Network error during Auto-Pilot sweep");
        } finally {
          if (!cancelled) setAutoPilotRunning(false);
        }

        if (cancelled) return;
        await new Promise((r) => setTimeout(r, AUTO_PILOT_SWEEP_INTERVAL_MS));
      }
    };

    runLoop();

    return () => {
      cancelled = true;
    };
  }, [autoPilotEnabled]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim() && !form.phone.trim() && !form.company.trim()) {
      setError("Provide at least a name, phone, or company");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.error === "duplicate_prospect") {
          setToastMessage(data.message ?? "This prospect is already in your pipeline!");
          return;
        }
        setError(data.error ?? "Failed to qualify lead");
        return;
      }

      setLastResult({ lead: data.lead, qualification: data.qualification });
      setForm(EMPTY_FORM);
      setLeads((prev) => {
        const rest = prev.filter((l) => l.id !== data.lead.id);
        return [data.lead as Lead, ...rest];
      });
    } catch {
      setError("Network error while qualifying lead");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProspect(e: React.FormEvent) {
    e.preventDefault();
    setProspecting(true);
    setProspectError(null);

    try {
      const res = await fetch("/api/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prospectForm),
      });

      const data = await res.json();

      if (!res.ok) {
        setProspectError(data.error ?? "Failed to discover businesses");
        return;
      }

      const result = data as ProspectResult;
      setProspectResult(result);

      if (result.imported.length > 0) {
        setLeads((prev) => {
          const importedIds = new Set(result.imported.map((l) => l.id));
          const rest = prev.filter((l) => !importedIds.has(l.id));
          return [...result.imported, ...rest];
        });
      }
    } catch {
      setProspectError("Network error while discovering businesses");
    } finally {
      setProspecting(false);
    }
  }

  async function qualifyLead(
    leadId: string,
    attempt = 1,
    signal?: AbortSignal
  ): Promise<boolean> {
    setQualifyingIds((prev) => new Set(prev).add(leadId));
    setQualifyErrors((prev) => {
      const next = { ...prev };
      delete next[leadId];
      return next;
    });

    // Transient network errors (dropped connection, upstream 502/504) get
    // one automatic retry with a short delay before we surface a final
    // error to the user.
    const retryTransient = async (): Promise<boolean> => {
      if (attempt >= QUALIFY_MAX_ATTEMPTS) return false;
      setQualifyErrors((prev) => ({
        ...prev,
        [leadId]: "Network hiccup while qualifying lead — retrying...",
      }));
      await new Promise((r) => setTimeout(r, QUALIFY_RETRY_DELAY_MS));
      return qualifyLead(leadId, attempt + 1, signal);
    };

    // Every qualification action — plain "Qualify lead" and "Auto-Qualify &
    // Enrich" alike — goes through the same /api/qualify endpoint, which
    // runs the shared runBantQualificationFromProfileWithFallback() engine.
    const lead = leads.find((l) => l.id === leadId);

    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          // Guard against a null/missing email tripping Supabase schema
          // validation on the backend's lookup/insert path.
          email: lead?.email || FALLBACK_LEAD_EMAIL,
        }),
        signal,
      });
      const data = await res.json();

      if (!res.ok) {
        console.error(
          `[qualify] request failed for lead ${leadId} with status ${res.status}`,
          data
        );
        if (res.status === 502 || res.status === 504) {
          const retried = await retryTransient();
          if (retried) return true;
        }
        setQualifyErrors((prev) => ({
          ...prev,
          [leadId]: data.error ?? "Qualification failed",
        }));
        return false;
      }

      setLeads((prev) => prev.map((l) => (l.id === leadId ? (data.lead as Lead) : l)));
      return true;
    } catch (err) {
      // A user-initiated cancel (batch Cancel button) aborts the in-flight
      // fetch — that's expected, so skip the retry/error UI for it.
      if (err instanceof DOMException && err.name === "AbortError") {
        return false;
      }

      console.error(`[qualify] fetch threw for lead ${leadId}:`, err);
      const retried = await retryTransient();
      if (retried) return true;

      setQualifyErrors((prev) => ({
        ...prev,
        [leadId]: "Network error while qualifying lead. Please try again.",
      }));
      return false;
    } finally {
      setQualifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  async function autoQualifyLead(leadId: string, attempt = 1): Promise<boolean> {
    setAutoQualifyingIds((prev) => new Set(prev).add(leadId));
    setAutoQualifyErrors((prev) => {
      const next = { ...prev };
      delete next[leadId];
      return next;
    });

    // Same transient-error auto-retry as qualifyLead above.
    const retryTransient = async (): Promise<boolean> => {
      if (attempt >= QUALIFY_MAX_ATTEMPTS) return false;
      setAutoQualifyErrors((prev) => ({
        ...prev,
        [leadId]: "Network hiccup while auto-qualifying lead — retrying...",
      }));
      await new Promise((r) => setTimeout(r, QUALIFY_RETRY_DELAY_MS));
      return autoQualifyLead(leadId, attempt + 1);
    };

    // Auto-Qualify & Enrich hits the same /api/qualify engine as plain
    // qualify, with auto_qualify:true opting into the default targeting
    // context, enrichment, and outreach generation.
    const lead = leads.find((l) => l.id === leadId);

    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          email: lead?.email || FALLBACK_LEAD_EMAIL,
          auto_qualify: true,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        console.error(
          `[qualify] auto-qualify request failed for lead ${leadId} with status ${res.status}`,
          data
        );
        if (res.status === 502 || res.status === 504) {
          const retried = await retryTransient();
          if (retried) return true;
        }
        setAutoQualifyErrors((prev) => ({
          ...prev,
          [leadId]: data.error ?? "Auto-qualify failed",
        }));
        return false;
      }

      setLeads((prev) => prev.map((l) => (l.id === leadId ? (data.lead as Lead) : l)));
      return true;
    } catch (err) {
      console.error(`[qualify] auto-qualify fetch threw for lead ${leadId}:`, err);
      const retried = await retryTransient();
      if (retried) return true;

      setAutoQualifyErrors((prev) => ({
        ...prev,
        [leadId]: "Network error while auto-qualifying lead. Please try again.",
      }));
      return false;
    } finally {
      setAutoQualifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  function cancelBulkQualify() {
    bulkCancelRequestedRef.current = true;
    bulkAbortControllerRef.current?.abort();
  }

  async function qualifyAllUnscored() {
    const targets = leads.filter((l) => l.status === "new").map((l) => l.id);
    if (targets.length === 0) return;

    bulkCancelRequestedRef.current = false;
    setBulkQualifying(true);
    setBulkSummary(null);
    let succeeded = 0;
    let failed = 0;
    let cancelledAt: number | null = null;

    for (let i = 0; i < targets.length; i++) {
      if (bulkCancelRequestedRef.current) {
        cancelledAt = i;
        break;
      }

      // "Processing lead i+1 of total" — bulkProgress.done tracks the
      // 0-indexed item currently in flight, not yet-completed count.
      setBulkProgress({ done: i, total: targets.length });

      const controller = new AbortController();
      bulkAbortControllerRef.current = controller;
      const ok = await qualifyLead(targets[i], 1, controller.signal);
      bulkAbortControllerRef.current = null;

      if (bulkCancelRequestedRef.current) {
        cancelledAt = i;
        break;
      }

      // The per-item update inside qualifyLead already merges the fresh
      // lead (score, BANT bars, status) into `leads` as soon as this
      // request resolves, so the pipeline list re-renders live — no
      // separate refetch needed between batch items.
      if (ok) succeeded += 1;
      else failed += 1;

      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, BULK_QUALIFY_STAGGER_MS));
      }
    }

    setBulkProgress(null);
    setBulkSummary({
      succeeded,
      failed,
      cancelled: cancelledAt !== null ? targets.length - cancelledAt : 0,
    });
    setBulkQualifying(false);
  }

  async function openOutreach(lead: Lead) {
    setOutreachLead(lead);
    setOutreachContent(null);
    setOutreachError(null);
    setOutreachLoading(true);

    try {
      const res = await fetch(`/api/leads/${lead.id}/outreach`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setOutreachError(data.error ?? "Failed to generate outreach");
        return;
      }

      setOutreachContent(data.outreach as OutreachContent);
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? (data.lead as Lead) : l)));
    } catch {
      setOutreachError("Network error while generating outreach");
    } finally {
      setOutreachLoading(false);
    }
  }

  function closeOutreach() {
    setOutreachLead(null);
    setOutreachContent(null);
    setOutreachError(null);
  }

  return (
    <div className="flex-1 bg-zinc-50 dark:bg-black">
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Prospect Lead Engine
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Submit a prospect, get an instant AI BANT qualification, and track the pipeline.
            </p>
          </div>
          <AutoPilotToggle
            enabled={autoPilotEnabled}
            running={autoPilotRunning}
            onToggle={() => setAutoPilotEnabled((v) => !v)}
            lastRun={autoPilotLastRun}
            error={autoPilotError}
          />
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          <section className="lg:col-span-2">
            <div className="inline-flex rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setActiveTab("submit")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "submit"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                Submit Prospect
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("discover")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "discover"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                Discover Businesses
              </button>
            </div>

            {activeTab === "submit" && (
              <>
                <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Submit prospect
                  </h2>
                  <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
                    <input
                      placeholder="Name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <input
                      type="email"
                      placeholder="Email (optional)"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <input
                      placeholder="Phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <input
                      placeholder="Company"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <textarea
                      required
                      placeholder="Inbound message / inquiry details..."
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      rows={4}
                      className="resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="mt-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      {submitting ? "Qualifying..." : "Qualify lead"}
                    </button>
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                  </form>
                </div>

                {lastResult && (
                  <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        Latest qualification
                      </h2>
                      <StatusBadge status={lastResult.qualification.status} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {lastResult.lead.name} · score {lastResult.qualification.overall_score}/100
                    </p>
                    <div className="mt-4">
                      <BantBreakdown bant={lastResult.qualification} />
                    </div>
                    <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {lastResult.qualification.summary}
                    </p>
                  </div>
                )}
              </>
            )}

            {activeTab === "discover" && (
              <>
                <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Discover businesses
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Search local businesses by industry and location, and import new
                    matches into the pipeline as leads.
                  </p>
                  <form onSubmit={handleProspect} className="mt-4 flex flex-col gap-3">
                    <input
                      required
                      placeholder="Industry (e.g. dentists)"
                      value={prospectForm.industry}
                      onChange={(e) =>
                        setProspectForm({ ...prospectForm, industry: e.target.value })
                      }
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <input
                      required
                      placeholder="Location (e.g. Austin, TX)"
                      value={prospectForm.location}
                      onChange={(e) =>
                        setProspectForm({ ...prospectForm, location: e.target.value })
                      }
                      className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
                    />
                    <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        checked={prospectForm.lowRatingOnly}
                        onChange={(e) =>
                          setProspectForm({
                            ...prospectForm,
                            lowRatingOnly: e.target.checked,
                          })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        Only rating &lt; 4.2 or &lt; 15 reviews (prime targets for review
                        management &amp; tap standees)
                      </span>
                    </label>
                    <button
                      type="submit"
                      disabled={prospecting}
                      className="mt-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      {prospecting ? "Searching..." : "Search & import"}
                    </button>
                    {prospectError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{prospectError}</p>
                    )}
                  </form>
                </div>

                {prospectResult && (
                  <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
                    <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      Search results
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Found {prospectResult.found} · Imported {prospectResult.imported.length}{" "}
                      · Already in pipeline {prospectResult.skipped}
                    </p>
                    {prospectResult.imported.length > 0 && (
                      <ul className="mt-4 flex flex-col gap-2">
                        {prospectResult.imported.map((lead) => {
                          const rating = lead.metadata?.rating;
                          const reviewCount = lead.metadata?.user_rating_count;
                          return (
                            <li
                              key={lead.id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-zinc-900 dark:text-zinc-50">
                                {lead.name}
                              </span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {typeof rating === "number"
                                  ? `★${rating.toFixed(1)} (${
                                      typeof reviewCount === "number" ? reviewCount : 0
                                    })`
                                  : "no rating"}{" "}
                                · {lead.phone ?? "no phone"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="lg:col-span-3">
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-col gap-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Pipeline
                  </h2>
                  <span className="text-xs text-zinc-400">{leads.length} leads</span>
                </div>
                {(() => {
                  const unscoredCount = leads.filter((l) => l.status === "new").length;
                  // Keep the progress/cancel UI mounted for the whole batch run even
                  // once the last "new" lead flips status mid-loop — only collapse
                  // the row once there's truly nothing to show.
                  if (unscoredCount === 0 && !bulkQualifying && !bulkSummary) return null;

                  if (bulkQualifying) {
                    const pct = bulkProgress
                      ? Math.round((bulkProgress.done / bulkProgress.total) * 100)
                      : 0;
                    return (
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {bulkProgress
                            ? `Processing lead ${bulkProgress.done + 1} of ${bulkProgress.total}...`
                            : "Starting..."}
                        </span>
                        <div className="h-1.5 w-24 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <div
                            className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={cancelBulkQualify}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-400 dark:border-red-900 dark:text-red-400 dark:hover:border-red-700"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="flex items-center gap-3">
                      {unscoredCount > 0 && (
                        <button
                          type="button"
                          onClick={qualifyAllUnscored}
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        >
                          {`Auto-Qualify All New (${unscoredCount})`}
                        </button>
                      )}
                      {bulkSummary && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {bulkSummary.succeeded} qualified
                          {bulkSummary.failed > 0 ? `, ${bulkSummary.failed} failed` : ""}
                          {bulkSummary.cancelled > 0
                            ? `, ${bulkSummary.cancelled} cancelled`
                            : ""}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {leads.length === 0 && (
                  <li className="px-6 py-8 text-center text-sm text-zinc-400">
                    No leads yet. Submit a prospect to get started.
                  </li>
                )}
                {leads.map((lead) => {
                  const bant = lead.metadata?.bant;
                  const enrichment = lead.metadata?.enrichment as WebEnrichment | undefined;
                  const isQualifying = qualifyingIds.has(lead.id);
                  const qualifyError = qualifyErrors[lead.id];
                  const isAutoQualifying = autoQualifyingIds.has(lead.id);
                  const autoQualifyError = autoQualifyErrors[lead.id];
                  return (
                    <li key={lead.id} className="flex flex-col gap-3 px-6 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {lead.name ?? "Unnamed"}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {[lead.company, lead.email].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                            {lead.lead_score}
                          </span>
                          <EnrichmentBadge status={lead.enrichment_status} />
                          <StatusBadge status={lead.status} />
                        </div>
                      </div>
                      {bant && (
                        <div className="max-w-sm">
                          <BantBreakdown bant={bant} />
                        </div>
                      )}
                      <ContactDetails
                        phone={lead.phone}
                        enrichment={enrichment}
                        whatsappNumber={lead.whatsapp_number}
                        instagramUrl={lead.instagram_url}
                        facebookUrl={lead.facebook_url}
                      />
                      <div className="flex items-center gap-2">
                        {lead.status === "new" && (
                          <button
                            type="button"
                            onClick={() => qualifyLead(lead.id)}
                            disabled={isQualifying}
                            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                          >
                            {isQualifying ? "Qualifying..." : "Qualify lead"}
                          </button>
                        )}
                        {lead.status === "qualified" && (
                          <button
                            type="button"
                            onClick={() => openOutreach(lead)}
                            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                          >
                            Outreach
                          </button>
                        )}
                        {lead.status === "qualified" && (
                          <Link
                            href={`/outreach?draftLead=${lead.id}&draftLeadName=${encodeURIComponent(
                              lead.name ?? lead.company ?? "Lead"
                            )}`}
                            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
                          >
                            Draft outreach email
                          </Link>
                        )}
                        {lead.status === "needs_more_info" && (
                          <button
                            type="button"
                            onClick={() => autoQualifyLead(lead.id)}
                            disabled={isAutoQualifying}
                            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                          >
                            {isAutoQualifying ? "Auto-Qualifying..." : "Auto-Qualify & Enrich"}
                          </button>
                        )}
                      </div>
                      {qualifyError && (
                        <p className="text-xs text-red-600 dark:text-red-400">{qualifyError}</p>
                      )}
                      {autoQualifyError && (
                        <p className="text-xs text-red-600 dark:text-red-400">{autoQualifyError}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </div>
      {outreachLead && (
        <OutreachModal
          lead={outreachLead}
          content={outreachContent}
          loading={outreachLoading}
          error={outreachError}
          onClose={closeOutreach}
        />
      )}
    </div>
  );
}
