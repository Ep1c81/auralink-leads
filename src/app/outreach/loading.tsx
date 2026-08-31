import { CampaignListSkeleton } from "@/components/outreach/Skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <CampaignListSkeleton />
    </div>
  );
}
