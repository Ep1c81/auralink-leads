import Link from "next/link";
import { body, eyebrow, pageTitle, primaryButton } from "@/components/outreach/theme";

export default function CampaignNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
      <p className={eyebrow}>404</p>
      <h1 className={pageTitle}>Campaign not found</h1>
      <p className={`max-w-sm ${body}`}>
        This campaign doesn&apos;t exist or may have been removed.
      </p>
      <Link href="/outreach" className={`mt-2 ${primaryButton}`}>
        ← All campaigns
      </Link>
    </div>
  );
}
