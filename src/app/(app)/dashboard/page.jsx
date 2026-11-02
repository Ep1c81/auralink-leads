"use client";
import { useState, useEffect, useMemo } from "react";

import {
  formatWhatsAppNumber,
  buildOutreachMessage,
  buildWhatsAppUrl,
  cantonFromAddress,
  defaultOutreachStage,
  OUTREACH_STAGES,
} from "@/lib/whatsapp";

const PAGE_SIZE = 50;
// "Contacted, nothing further tracked, N days later" — a coarse proxy for
// follow-up, since bizmap_leads has no reply/reminder tracking of its own.
const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

async function fetchBizmapLeads() {
  const res = await fetch("/api/bizmap-leads");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body?.details && typeof body.details !== "string" ? JSON.stringify(body.details) : body?.details;
    throw new Error([body?.error, detail].filter(Boolean).join(": ") || `Request failed (${res.status})`);
  }
  return body?.leads ?? [];
}

function isFollowUpNeeded(lead) {
  if (!lead.outreached_at) return false;
  const outreachedAt = new Date(lead.outreached_at).getTime();
  if (Number.isNaN(outreachedAt)) return false;
  return Date.now() - outreachedAt >= FOLLOW_UP_AFTER_MS;
}

const FILTERS = [
  {
    key: "contactable",
    label: "Has WhatsApp / Phone",
    test: (lead) => Boolean(formatWhatsAppNumber(lead.phone_number)),
  },
  {
    key: "noWebsite",
    label: "No Website (High Priority Prospect)",
    test: (lead) => lead.website === "N/A",
  },
  {
    key: "followUp",
    label: "Follow-up Needed",
    test: isFollowUpNeeded,
  },
];

const STATUS_STYLES = {
  "Hot Lead": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "Standard Lead": "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  New: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

function StatTile({ label, value, valueClassName }) {
  return (
    <div className="flex-1 min-w-[180px] rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-gray-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${valueClassName ?? "text-gray-900 dark:text-zinc-50"}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.New;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {status || "New"}
    </span>
  );
}

export default function LeadDashboard() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilters, setActiveFilters] = useState(() => new Set());
  const [pendingOutreachIds, setPendingOutreachIds] = useState(() => new Set());
  // Per-lead stage the rep picked; unset rows fall back to defaultOutreachStage.
  const [stageOverrides, setStageOverrides] = useState({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [promotingIds, setPromotingIds] = useState(() => new Set());
  const [promotedIds, setPromotedIds] = useState(() => new Set());
  const [duplicateIds, setDuplicateIds] = useState(() => new Set());
  const [promoteErrors, setPromoteErrors] = useState({});

  // `cancelled` guards every setState call so a slow request that resolves
  // after the effect re-runs (or the component unmounts) never clobbers
  // newer state — mirrors the fetch effect in src/app/page.tsx.
  useEffect(() => {
    let cancelled = false;
    fetchBizmapLeads()
      .then((data) => {
        if (!cancelled) setLeads(data);
      })
      .catch((err) => {
        console.error("Error fetching bizmap leads:", err);
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    fetchBizmapLeads()
      .then(setLeads)
      .catch((err) => {
        console.error("Error fetching bizmap leads:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  const metrics = useMemo(
    () => ({
      total: leads.length,
      contactable: leads.filter((lead) => Boolean(formatWhatsAppNumber(lead.phone_number))).length,
      outreached: leads.filter((lead) => Boolean(lead.outreached_at)).length,
    }),
    [leads]
  );

  const toggleFilter = (key) => {
    setVisibleCount(PAGE_SIZE);
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredLeads = useMemo(() => {
    const active = FILTERS.filter((f) => activeFilters.has(f.key));
    if (active.length === 0) return leads;
    return leads.filter((lead) => active.every((f) => f.test(lead)));
  }, [leads, activeFilters]);

  const visibleLeads = filteredLeads.slice(0, visibleCount);

  const stageFor = (lead) => stageOverrides[lead.id] ?? defaultOutreachStage(lead.outreached_at);

  const handleOutreach = async (lead) => {
    const waNumber = formatWhatsAppNumber(lead.phone_number);
    if (!waNumber) return;

    const message = buildOutreachMessage({
      businessName: lead.business_name,
      canton: cantonFromAddress(lead.address),
      stage: stageFor(lead),
    });
    window.open(buildWhatsAppUrl(waNumber, message), "_blank", "noopener,noreferrer");

    if (lead.outreached_at) return; // already tracked — don't re-stamp on repeat clicks

    setPendingOutreachIds((prev) => new Set(prev).add(lead.id));
    try {
      const res = await fetch(`/api/bizmap-leads/${lead.id}/outreach`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      const outreachedAt = body?.lead?.outreached_at ?? new Date().toISOString();
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, outreached_at: outreachedAt } : l)));
    } catch (err) {
      // Non-fatal: the WhatsApp chat already opened in a new tab; only the
      // "mark as outreached" bookkeeping failed, so just log it.
      console.error("Error marking lead as outreached:", err);
    } finally {
      setPendingOutreachIds((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const handlePromote = async (lead) => {
    setPromotingIds((prev) => new Set(prev).add(lead.id));
    setPromoteErrors((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });

    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lead.business_name,
          company: lead.business_name,
          phone: lead.phone_number,
          email: lead.email || undefined,
          auto_qualify: true,
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409 && body?.error === "duplicate_prospect") {
          setDuplicateIds((prev) => new Set(prev).add(lead.id));
          return;
        }
        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      setPromotedIds((prev) => new Set(prev).add(lead.id));
    } catch (err) {
      console.error("Error promoting lead to pipeline:", err);
      setPromoteErrors((prev) => ({ ...prev, [lead.id]: err.message }));
    } finally {
      setPromotingIds((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-50">Auralink Digital CRM Pipeline</h1>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <StatTile label="Total leads" value={metrics.total.toLocaleString()} />
        <StatTile
          label="Contactable leads (Phone/WhatsApp ready)"
          value={metrics.contactable.toLocaleString()}
          valueClassName="text-emerald-600 dark:text-emerald-400"
        />
        <StatTile
          label="Outreached leads"
          value={metrics.outreached.toLocaleString()}
          valueClassName="text-blue-600 dark:text-blue-400"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleFilter(f.key)}
            aria-pressed={activeFilters.has(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeFilters.has(f.key)
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white dark:bg-zinc-900 border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
            }`}
          >
            {f.label}
          </button>
        ))}
        {activeFilters.size > 0 && (
          <button
            onClick={() => {
              setActiveFilters(new Set());
              setVisibleCount(PAGE_SIZE);
            }}
            className="px-3 py-1.5 rounded-full text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-600 dark:text-zinc-400">Loading full database pipeline...</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-red-700 dark:text-red-300 font-medium">Could not load leads</p>
          <p className="text-red-600 dark:text-red-400 text-sm mt-1">{error}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mb-2">
            Showing {visibleLeads.length.toLocaleString()} of {filteredLeads.length.toLocaleString()}
            {filteredLeads.length !== leads.length ? ` (filtered from ${leads.length.toLocaleString()})` : ""}
          </p>
          <div className="bg-white dark:bg-zinc-900 shadow-md rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300">
                    <th className="p-4 font-semibold">Business Name</th>
                    <th className="p-4 font-semibold">Type</th>
                    <th className="p-4 font-semibold">Phone</th>
                    <th className="p-4 font-semibold">Website</th>
                    <th className="p-4 font-semibold">Score</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Outreach</th>
                    <th className="p-4 font-semibold">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-gray-500 dark:text-zinc-400">
                        No leads match the current filters.
                      </td>
                    </tr>
                  ) : (
                    visibleLeads.map((lead) => {
                      const waNumber = formatWhatsAppNumber(lead.phone_number);
                      const hasWebsite = lead.website && lead.website !== "N/A";
                      const followUp = isFollowUpNeeded(lead);
                      const pending = pendingOutreachIds.has(lead.id);
                      const promoting = promotingIds.has(lead.id);
                      const promoted = promotedIds.has(lead.id);
                      const duplicate = duplicateIds.has(lead.id);
                      const promoteError = promoteErrors[lead.id];

                      return (
                        <tr
                          key={lead.id}
                          className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50"
                        >
                          <td className="p-4 font-medium text-gray-900 dark:text-zinc-50">
                            {lead.business_name || "Unnamed"}
                          </td>
                          <td className="p-4 text-blue-600 dark:text-blue-400 font-semibold">
                            {lead.business_type || "N/A"}
                          </td>
                          <td className="p-4 text-gray-700 dark:text-zinc-300">
                            {waNumber ? lead.phone_number : <span className="text-gray-400 dark:text-zinc-500">—</span>}
                          </td>
                          <td className="p-4">
                            {hasWebsite ? (
                              <a
                                href={lead.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Visit site
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                No website
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-gray-700 dark:text-zinc-300">{lead.lead_score ?? 0}</td>
                          <td className="p-4">
                            <StatusBadge status={lead.status} />
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              {waNumber ? (
                                <>
                                  <select
                                    value={stageFor(lead)}
                                    onChange={(e) =>
                                      setStageOverrides((prev) => ({ ...prev, [lead.id]: e.target.value }))
                                    }
                                    aria-label="Outreach message"
                                    className="px-2 py-1.5 rounded-md text-xs border border-gray-300 bg-white text-gray-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                                  >
                                    {OUTREACH_STAGES.map((s) => (
                                      <option key={s.value} value={s.value}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleOutreach(lead)}
                                    disabled={pending}
                                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    {lead.outreached_at ? "Message again" : "WhatsApp"}
                                  </button>
                                </>
                              ) : (
                                <span className="text-xs text-gray-400 dark:text-zinc-500">No phone</span>
                              )}
                              {lead.outreached_at && (
                                <span className="text-xs text-gray-500 dark:text-zinc-400">
                                  ✓ {new Date(lead.outreached_at).toLocaleDateString()}
                                </span>
                              )}
                              {followUp && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                                  Follow up
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col items-start gap-1">
                              {promoted ? (
                                <button
                                  disabled
                                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 disabled:opacity-100"
                                >
                                  ✓ In Pipeline
                                </button>
                              ) : duplicate ? (
                                <button
                                  disabled
                                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400 disabled:opacity-100"
                                >
                                  Already in Pipeline
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePromote(lead)}
                                  disabled={promoting}
                                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 disabled:opacity-50"
                                >
                                  {promoting ? "Promoting…" : "Promote to Pipeline"}
                                </button>
                              )}
                              {promoteError && (
                                <span className="text-xs text-red-600 dark:text-red-400">
                                  {promoteError}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {visibleCount < filteredLeads.length && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
              >
                Load more ({filteredLeads.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
