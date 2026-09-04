-- Temporary Canva import PDF memory. Private bucket + metadata table.
-- Service role (Electron main) bypasses RLS. Anon/authenticated have no policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'canva-import-temp',
  'canva-import-temp',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.canva_import_temp (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  job_id text,
  object_path text not null unique,
  checksum text not null,
  mime text not null default 'application/pdf',
  bytes bigint,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists canva_import_temp_expires_at_idx
  on public.canva_import_temp (expires_at);

create index if not exists canva_import_temp_project_id_idx
  on public.canva_import_temp (project_id);

alter table public.canva_import_temp enable row level security;

revoke all on table public.canva_import_temp from anon, authenticated;
grant all on table public.canva_import_temp to service_role;
