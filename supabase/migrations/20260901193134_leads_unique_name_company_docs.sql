-- Documents a unique index that already existed on the live database but was
-- never captured in a tracked migration (schema drift, discovered while
-- fixing the 500 on Search & import). No-op if present.
create unique index if not exists unique_name_company on leads (name, company);
