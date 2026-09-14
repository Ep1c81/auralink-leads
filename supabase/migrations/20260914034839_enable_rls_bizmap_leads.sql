-- Enable Row Level Security on bizmap_leads.
--
-- This table had no migration in this repo at all — it was created ad hoc
-- outside of migrations and had RLS disabled, meaning the anon key (shipped
-- in the browser bundle for src/app/dashboard/page.jsx) could read AND write
-- every row. This closes writes while keeping the dashboard's read working.
ALTER TABLE public.bizmap_leads ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to only READ data, preventing public write/delete access
CREATE POLICY "anon can read bizmap_leads" ON public.bizmap_leads
FOR SELECT TO anon USING (true);
