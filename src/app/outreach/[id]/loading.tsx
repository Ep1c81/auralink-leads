import { CampaignDetailSkeleton } from "@/components/outreach/Skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <CampaignDetailSkeleton />
    </div>
  );
}
