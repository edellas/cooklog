-- Test end-to-end di supabase/schema.sql su un Postgres locale (vedi README.md).
\set ON_ERROR_STOP on
update arena_config set tier_thresholds='{3,5}', min_cohort=100, baseline_score=0.3, submission_cutoff_hour=24, report_min_views=3;

-- 6 utenti: user1..user3 sono autori, tutti sono spettatori.
insert into auth.users select ('00000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,6) i;
insert into profiles (id, username, display_name, created_at)
  select id, 'user'||right(id::text,1), 'Utente '||right(id::text,1), now() - interval '10 days' from auth.users;
insert into posts (id, author_id, media_type, body, caption)
  select ('10000000-0000-0000-0000-00000000000'||i)::uuid, ('00000000-0000-0000-0000-00000000000'||i)::uuid, 'text', 'Testo '||i, 'Post '||i
  from generate_series(1,3) i;
insert into posts (id, author_id, media_type, media_url, caption)
  values ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','video','https://cdn/x.mp4','Secondo post');

set role authenticated;
do $$
declare i int;
begin
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||i, false);
    perform arena_submit(('10000000-0000-0000-0000-00000000000'||i)::uuid);
  end loop;
end $$;

-- Doppia candidatura: rifiutata.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ begin perform arena_submit('10000000-0000-0000-0000-000000000009'); raise exception 'NON DOVEVA PASSARE';
exception when others then
  if sqlerrm not like '%un solo contenuto%' then raise; end if;
  raise notice 'ok, doppia candidatura rifiutata: %', sqlerrm;
end $$;

-- Candidare il contenuto di un altro: rifiutato.
do $$ begin perform arena_submit('10000000-0000-0000-0000-000000000002'); raise exception 'NON DOVEVA PASSARE';
exception when others then
  if sqlerrm not like '%tuo contenuto%' then raise; end if;
  raise notice 'ok, contenuto altrui rifiutato';
end $$;

-- Voto su un contenuto non servito: rifiutato.
select arena_record_view((select id from arena_entries where author_id='00000000-0000-0000-0000-000000000002'), 9000, p_liked => true) as voto_non_servito;

-- Ogni spettatore riceve il batch e reagisce: post 1 ottimo, 2 medio, 3 skip.
do $$
declare v int; r record; ok boolean;
begin
  for v in 1..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||v, false);
    for r in select * from arena_next_batch(10) loop
      if r.author_id = auth.uid() then raise exception 'servito il proprio contenuto!'; end if;
      ok := arena_record_view(r.entry_id,
        case r.caption when 'Post 1' then 9000 when 'Post 2' then 4000 else 500 end,
        p_rewatched => r.caption = 'Post 1', p_liked => r.caption = 'Post 1', p_shared => r.caption = 'Post 1');
      if not ok then raise exception 'vista rifiutata'; end if;
      if arena_record_view(r.entry_id, 9000, p_liked => true) then raise exception 'doppio voto accettato'; end if;
    end loop;
    if exists (select 1 from arena_next_batch(10)) then raise exception 'batch ripetuto'; end if;
  end loop;
end $$;

reset role;
select p.caption, e.tier, e.status, round(e.last_score, 3) score, (arena_entry_totals(e.id)).views
from arena_entries e join posts p on p.id = e.post_id order by p.caption;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select tier, status, views from arena_my_entry();
reset role;

-- Chiusura (service role) e virale del giorno dopo.
select p.caption as vincitore from posts p where p.id = (select post_id from arena_entries where id = arena_close_day(arena_today()));
select arena_close_day(arena_today()) is not null as chiusura_idempotente;
update daily_viral set featured_on = arena_today();  -- simula "domani"
set role anon;
select caption, author_username, total_entries, total_views from get_daily_viral();
select count(*) as albo_doro from get_hall_of_fame(10);
do $$ begin perform arena_close_day(arena_today()); raise exception 'anon NON deve poter chiudere';
exception when insufficient_privilege then raise notice 'ok, anon non può chiudere la giornata'; end $$;
