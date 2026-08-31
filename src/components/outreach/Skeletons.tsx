import { panel, skeletonBlock } from "./theme";

// Loading placeholders that mirror each route's real layout, used by
// loading.tsx files (which Next.js automatically wraps around page.tsx in a
// Suspense boundary) — shown instantly on navigation while the Server
// Component fetches campaign/message data.

export function CampaignListSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className={`h-3 w-32 ${skeletonBlock}`} />
        <div className={`h-8 w-56 ${skeletonBlock}`} />
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-28 ${panel} ${skeletonBlock}`} />
        ))}
      </div>
      <div className={`hidden h-56 md:block ${panel} ${skeletonBlock}`} />
    </div>
  );
}

export function CampaignDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className={`h-3 w-28 ${skeletonBlock}`} />
      <div className="flex items-center gap-3">
        <div className={`h-8 w-64 ${skeletonBlock}`} />
        <div className={`h-6 w-16 rounded-full ${skeletonBlock}`} />
      </div>
      <div className={`h-72 ${panel} ${skeletonBlock}`} />
    </div>
  );
}
