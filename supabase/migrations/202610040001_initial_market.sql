-- Market data only. No files, bills, user profiles or consumption history.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists vector with schema extensions;

create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 120),
  name text not null check (length(name) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  territory text not null default 'peninsula_baleares' check (territory = 'peninsula_baleares'),
  energy_p1 double precision not null check (energy_p1 between 0 and 5),
  energy_p2 double precision not null check (energy_p2 between 0 and 5),
  energy_p3 double precision not null check (energy_p3 between 0 and 5),
  power_p1 double precision not null check (power_p1 between 0 and 5),
  power_p2 double precision not null check (power_p2 between 0 and 5),
  monthly_fee double precision not null default 0 check (monthly_fee between 0 and 1000),
  price_guarantee_months integer not null check (price_guarantee_months >= 12),
  commitment_months integer not null default 0 check (commitment_months between 0 and 60),
  renewable boolean not null default false,
  conditions text not null check (length(conditions) between 1 and 4000),
  source_url text check (source_url ~ '^https://[^\s]+$'),
  verified_at timestamptz,
  valid_from date not null,
  valid_until date not null check (valid_until >= valid_from),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint publication_requires_review check (
    status <> 'published' or (source_url is not null and verified_at is not null and not is_demo)
  )
);
comment on table public.tariffs is 'Reviewed fixed-price 2.0TD market offers. All prices exclude taxes and meter rental; include mandatory services in monthly_fee. Published offers guarantee prices for at least 12 months.';
create index tariffs_published_validity on public.tariffs(valid_until, verified_at) where status = 'published';
alter table public.tariffs enable row level security;
revoke all on public.tariffs from anon, authenticated;
grant select on public.tariffs to authenticated;
create policy "Authenticated sessions read reviewed current market offers"
  on public.tariffs for select to authenticated using (
    status = 'published' and not is_demo and valid_from <= current_date and valid_until >= current_date
    and verified_at >= now() - interval '30 days' and verified_at <= now()
  );

-- Foundation for future market-only retrieval. Not an implemented chatbot.
create table public.market_documents (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.tariffs(id) on delete cascade,
  source_url text not null check (source_url ~ '^https://[^\s]+$'),
  excerpt text not null check (length(excerpt) between 1 and 50000),
  retrieved_at timestamptz not null default now(),
  reviewed boolean not null default false,
  embedding extensions.vector(1536),
  embedding_model text,
  check ((embedding is null) = (embedding_model is null))
);
alter table public.market_documents enable row level security;
revoke all on public.market_documents from anon, authenticated;
grant select on public.market_documents to authenticated;
create policy "Read reviewed documents of visible tariffs" on public.market_documents
  for select to authenticated using (reviewed and exists (select 1 from public.tariffs t where t.id = tariff_id));

-- The only per-session record is an operational counter, never a consumption value.
create table private.analysis_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null check (requests between 1 and 30)
);
alter table private.analysis_quotas enable row level security;
revoke all on private.analysis_quotas from public, anon, authenticated;
create or replace function public.consume_analysis_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  subject uuid := auth.uid();
  granted integer;
begin
  if subject is null then raise exception 'Authentication required'; end if;
  insert into private.analysis_quotas as q (user_id, window_start, requests)
  values (subject, date_trunc('hour', now()), 1)
  on conflict (user_id) do update set
    window_start = excluded.window_start,
    requests = case when q.window_start < excluded.window_start then 1 else q.requests + 1 end
  where q.window_start < excluded.window_start or q.requests < 30
  returning requests into granted;
  return granted is not null;
end;
$$;
revoke all on function public.consume_analysis_quota() from public, anon;
grant execute on function public.consume_analysis_quota() to authenticated;

-- Run daily as postgres/administration; never expose this function to clients.
create or replace function public.prune_analysis_quotas() returns void
language sql security definer set search_path = '' as $$
  delete from private.analysis_quotas where window_start < now() - interval '24 hours';
$$;
revoke all on function public.prune_analysis_quotas() from public, anon, authenticated;
grant execute on function public.prune_analysis_quotas() to service_role;
