import Link from "next/link";
import { listPipelineLeads } from "@/lib/leadsPipeline";
import { EmptyState } from "@/components/outreach/EmptyState";
import { LeadTable } from "@/components/pipeline/LeadTable";
import { LeadCard } from "@/components/pipeline/LeadCard";
import { body, eyebrow, pageTitle, secondaryButton } from "@/components/outreach/theme";

const PAGE_SIZE = 50;

/**
 * Server Component: fetches leads directly from the data layer (same
 * lib/leadsPipeline.ts a future API route could use) rather than
 * round-tripping through fetch() to its own API.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 0;
  const { leads, count } = await listPipelineLeads(page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:py-14">
      <header>
        <p className={eyebrow}>AuraLink Digital · Pipeline</p>
        <h1 className={pageTitle}>Leads Pipeline</h1>
        <p className={`mt-1.5 ${body}`}>
          Qualify and enrich prospects promoted from the raw business dataset.
        </p>
      </header>

      {leads.length === 0 ? (
        <EmptyState
          title="No leads in the pipeline yet"
          description="No leads in the pipeline yet — promote a prospect from the Home page to get started."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
          <div className="hidden md:block">
            <LeadTable leads={leads} />
          </div>

          <div className="flex items-center justify-between">
            {page > 0 ? (
              <Link href={`/pipeline?page=${page - 1}`} className={secondaryButton}>
                Prev
              </Link>
            ) : (
              <span className={`${secondaryButton} pointer-events-none opacity-50`}>Prev</span>
            )}
            <span className={body}>
              Page {page + 1} of {totalPages}
            </span>
            {page + 1 < totalPages ? (
              <Link href={`/pipeline?page=${page + 1}`} className={secondaryButton}>
                Next
              </Link>
            ) : (
              <span className={`${secondaryButton} pointer-events-none opacity-50`}>Next</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
