begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.tariffs(id, provider, name, status, energy_p1, energy_p2, energy_p3, power_p1, power_p2, monthly_fee, price_guarantee_months, conditions, source_url, verified_at, valid_from, valid_until)
select id::uuid, 'Test provider', name, status, .15, .12, .08, .09, .02, 0, 12, 'Reviewed fixed price offer', 'https://example.org/terms', verified_at, current_date - 1, valid_until from (values
  ('11111111-1111-4111-8111-111111111111', 'Visible', 'published', now(), current_date + 30),
  ('22222222-2222-4222-8222-222222222222', 'Draft', 'draft', now(), current_date + 30),
  ('33333333-3333-4333-8333-333333333333', 'Expired', 'published', now(), current_date - 1),
  ('44444444-4444-4444-8444-444444444444', 'Stale', 'published', now() - interval '31 days', current_date + 30)
) as sample(id, name, status, verified_at, valid_until);
insert into public.market_documents(tariff_id, source_url, excerpt, reviewed) values
('11111111-1111-4111-8111-111111111111', 'https://example.org/terms', 'Reviewed public terms', true),
('11111111-1111-4111-8111-111111111111', 'https://example.org/terms', 'Unreviewed draft', false),
('22222222-2222-4222-8222-222222222222', 'https://example.org/terms', 'Draft tariff terms', true);

set local role anon;
select throws_ok('select * from public.tariffs', '42501', null, 'Unauthenticated visitors cannot read the catalog');
select throws_ok('select public.consume_analysis_quota()', '42501', null, 'Unauthenticated visitors cannot consume quota');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":true,"role":"authenticated"}', true);
select is((select count(*) from public.tariffs), 1::bigint, 'Anonymous authenticated users see only current reviewed offers');
select is((select count(*) from public.market_documents), 1::bigint, 'Only reviewed documents of visible offers are readable');
select throws_ok('update public.tariffs set energy_p1 = 0', '42501', null, 'Users cannot manipulate prices');
select throws_ok('delete from public.market_documents', '42501', null, 'Users cannot delete sources');
select throws_ok('select * from private.analysis_quotas', '42501', null, 'Users cannot read operational counters');
select ok(public.consume_analysis_quota(), 'First request has quota');
do $$ begin for i in 2..30 loop perform public.consume_analysis_quota(); end loop; end $$;
select ok(not public.consume_analysis_quota(), 'Request 31 is limited');
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","is_anonymous":true,"role":"authenticated"}', true);
select ok(public.consume_analysis_quota(), 'Another session has its own quota');
select throws_ok('select public.prune_analysis_quotas()', '42501', null, 'Clients cannot run retention maintenance');
reset role;
update private.analysis_quotas set window_start = now() - interval '2 days';
select public.prune_analysis_quotas();
select is((select count(*) from private.analysis_quotas), 0::bigint, 'Retention removes expired counters');
select * from finish();
rollback;
