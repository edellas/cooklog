-- Test end-to-end di docs/supabase-viral-of-the-day.sql (vedi docs/viral-del-giorno.md).
\set ON_ERROR_STOP on
update arena_config set tier_thresholds='{3,5}', min_cohort=100, baseline_score=0.3, submission_cutoff_hour=24, report_min_views=3;
-- 6 utenti: u1..u3 autori, tutti spettatori
insert into auth.users select ('00000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,6) i;
insert into profiles (id, username, display_name, created_at)
  select id, 'u'||right(id::text,1), 'Utente '||right(id::text,1), now() - interval '10 days' from auth.users;
insert into food_posts (id, author_id, title, media_url, category)
  select ('10000000-0000-0000-0000-00000000000'||i)::uuid, ('00000000-0000-0000-0000-00000000000'||i)::uuid, 'Piatto '||i, 'https://x/'||i, 'Primi'
  from generate_series(1,3) i;
insert into food_posts (id, author_id, title, media_url, category) values ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Secondo piatto','https://x/9','Primi');
grant select on all tables in schema public to authenticated;

set role authenticated;
do $$
declare i int;
begin
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||i, false);
    perform arena_submit(('10000000-0000-0000-0000-00000000000'||i)::uuid);
  end loop;
end $$;

-- doppia candidatura: deve fallire
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ begin perform arena_submit('10000000-0000-0000-0000-000000000009'); raise exception 'NON DOVEVA PASSARE';
exception when others then raise notice 'ok, rifiutato: %', sqlerrm; end $$;

-- voto su un piatto non servito: deve restituire false
select arena_record_view((select id from arena_entries where author_id='00000000-0000-0000-0000-000000000002'), 9000, true, true) as voto_non_servito;

-- ogni spettatore vede il batch e reagisce: piatto 1 ottimo, 2 medio, 3 skip
do $$
declare v int; r record; ok boolean;
begin
  for v in 1..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||v, false);
    for r in select * from arena_next_batch(10) loop
      if r.author_id = auth.uid() then raise exception 'servito il proprio piatto!'; end if;
      ok := arena_record_view(r.entry_id,
        case r.title when 'Piatto 1' then 9000 when 'Piatto 2' then 4000 else 500 end,
        r.title = 'Piatto 1', r.title = 'Piatto 1', false, false);
      if not ok then raise exception 'vista rifiutata'; end if;
      -- seconda vista dello stesso piatto: rifiutata
      if arena_record_view(r.entry_id, 9000, true, true) then raise exception 'doppio voto accettato'; end if;
    end loop;
    if exists (select 1 from arena_next_batch(10)) then raise exception 'batch ripetuto'; end if;
  end loop;
end $$;

reset role;
select fp.title, e.tier, e.status, round(e.last_score,3) score, (arena_entry_totals(e.id)).views
from arena_entries e join food_posts fp on fp.id=e.post_id order by fp.title;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select tier, status, views from arena_my_entry();
reset role;

-- chiusura (service role) e virale del giorno dopo
select fp.title as vincitore from food_posts fp where fp.id = (select post_id from arena_entries where id = arena_close_day(arena_today()));
select arena_close_day(arena_today()) is not null as idempotente;
update daily_viral set featured_on = arena_today();  -- simula "domani"
set role anon;
select title, author_name, total_entries, total_views from get_daily_viral();
do $$ begin perform arena_close_day(arena_today()); raise exception 'anon NON deve poter chiudere';
exception when insufficient_privilege then raise notice 'ok, anon non può chiudere la giornata'; end $$;
