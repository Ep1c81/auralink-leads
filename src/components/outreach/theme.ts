/**
 * Single source of truth for the /outreach module's visual language: a dark,
 * glassmorphism "high-tech" surface distinct from the light main dashboard.
 * All colors here are chosen to hold >=4.5:1 contrast against the module's
 * bg-slate-950 canvas (buttons darken rather than lighten on hover/active so
 * contrast never drops below AA as state changes).
 */

// Type scale — five distinct levels, used consistently instead of ad-hoc sizes.
export const eyebrow =
  "text-xs font-semibold uppercase tracking-widest text-violet-300/80";
export const pageTitle = "text-2xl font-semibold tracking-tight text-white sm:text-3xl";
export const panelTitle = "text-base font-semibold text-white";
export const cardTitle = "text-sm font-semibold text-white";
export const label = "text-[11px] font-semibold uppercase tracking-wider text-slate-500";
export const body = "text-sm text-slate-300";
export const meta = "text-xs text-slate-500";

// Glass panel surfaces.
export const panel =
  "rounded-2xl border border-white/10 bg-slate-900/50 backdrop-blur-xl shadow-[0_20px_60px_-25px_rgba(0,0,0,0.8)]";
export const panelInteractive =
  `${panel} transition-colors hover:border-violet-400/30 hover:bg-slate-900/70`;

// Focus ring — one consistent style, offset so it reads clearly against both
// the dark canvas and colored button fills.
export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400";

// Buttons darken on hover (never lighten) so text contrast can only improve.
export const primaryButton =
  `${focusRing} inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-[0_0_20px_-6px_rgba(139,92,246,0.7)] transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none`;
export const successButton =
  `${focusRing} inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-6px_rgba(16,185,129,0.6)] transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none`;
export const secondaryButton =
  `${focusRing} inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50`;
export const ghostButton =
  `${focusRing} rounded-md px-2 py-1 text-slate-400 transition-colors hover:text-white`;

// Form controls.
export const input =
  `${focusRing} w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60`;
export const textarea = `${input} resize-y font-mono text-[13px] leading-relaxed`;

// Links.
export const link =
  `${focusRing} rounded text-slate-100 underline decoration-slate-600 decoration-dotted underline-offset-4 transition-colors hover:text-violet-300 hover:decoration-violet-400`;
export const subtleLink =
  `${focusRing} rounded text-xs font-medium text-slate-400 underline decoration-slate-700 decoration-dotted underline-offset-4 transition-colors hover:text-white hover:decoration-slate-400`;

// Skeleton shimmer block.
export const skeletonBlock = "animate-pulse rounded-lg bg-white/5";
