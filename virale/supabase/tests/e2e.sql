-- Test end-to-end di supabase/schema.sql su un Postgres locale (vedi README.md).
\set ON_ERROR_STOP on
update arena_config set tier_thresholds='{3,5}', min_cohort=100, baseline_score=0.3, submission_cutoff_hour=24, report_min_views=3;

-- 6 utenti: user1..user3 sono autori, tutti sono spettatori.
insert into auth.users select ('00000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,6) i;
insert into profiles (id, username, display_name, created_at)
  select id, 'user'||right(id::text,1), 'Utente '||right(id::text,1), now() - interval '10 days' from auth.users;
insert into posts (id, author_id, media, caption)
  select ('10000000-0000-0000-0000-00000000000'||i)::uuid, ('00000000-0000-0000-0000-00000000000'||i)::uuid,
         jsonb_build_array(jsonb_build_object('kind','image','url','https://cdn.example/'||i||'.jpg','width',1080,'height',1620)), 'Post '||i
  from generate_series(1,3) i;
-- Un carosello misto foto + video dello stesso autore.
insert into posts (id, author_id, media, caption) values ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001',
  '[{"kind":"image","url":"https://cdn.example/a.jpg","width":1080,"height":1620},{"kind":"video","url":"https://cdn.example/b.mp4","width":720,"height":1280,"duration_ms":15000}]', 'Carosello');

-- Media non validi: rifiutati.
do $$ begin
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000001', '[]');
  raise exception 'NON DOVEVA PASSARE';
exception when check_violation then raise notice 'ok, post senza media rifiutato'; end $$;
do $$ begin
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000001', '[{"kind":"video","url":"https://x/v.mp4","duration_ms":90000}]');
  raise exception 'NON DOVEVA PASSARE';
exception when check_violation then raise notice 'ok, video oltre 60 s rifiutato'; end $$;

set role authenticated;

-- Un client non può creare un post con contatori gonfiati.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  insert into posts (author_id, media, like_count) values ('00000000-0000-0000-0000-000000000002', '[{"kind":"image","url":"https://x/1.jpg"}]', 10000);
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, contatori gonfiati rifiutati'; end $$;

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
  if sqlerrm not like '%un solo post%' then raise; end if;
  raise notice 'ok, doppia candidatura rifiutata';
end $$;

-- Candidare il post di un altro: rifiutato.
do $$ begin perform arena_submit('10000000-0000-0000-0000-000000000002'); raise exception 'NON DOVEVA PASSARE';
exception when others then
  if sqlerrm not like '%tuo post%' then raise; end if;
  raise notice 'ok, post altrui rifiutato';
end $$;

-- Voto su un post non servito: rifiutato.
select arena_record_view((select id from arena_entries where author_id='00000000-0000-0000-0000-000000000002'), 9000, p_liked => true) as voto_non_servito;

-- Ogni spettatore riceve i Provini e reagisce: post 1 ottimo, 2 medio, 3 skip.
do $$
declare v int; r record; ok boolean; cap text;
begin
  for v in 1..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||v, false);
    for r in select * from feed_for_you(10) where entry_id is not null loop
      if (r.post->'author'->>'id')::uuid = auth.uid() then raise exception 'servito il proprio post!'; end if;
      cap := r.post->>'caption';
      ok := arena_record_view(r.entry_id,
        case cap when 'Post 1' then 9000 when 'Post 2' then 4000 else 500 end,
        p_rewatched => cap = 'Post 1', p_liked => cap = 'Post 1', p_commented => cap = 'Post 1', p_shared => cap = 'Post 1');
      if not ok then raise exception 'vista rifiutata'; end if;
      if arena_record_view(r.entry_id, 9000, p_liked => true) then raise exception 'doppio voto accettato'; end if;
    end loop;
    if exists (select 1 from feed_for_you(10) where entry_id is not null) then raise exception 'provini ripetuti'; end if;
  end loop;
end $$;

-- Interazioni sociali e contatori mantenuti dai trigger.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
insert into post_likes (post_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005');
insert into post_saves (post_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005');
insert into comments (post_id, user_id, body) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'Bellissima!');
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001');
select register_share('10000000-0000-0000-0000-000000000001');
do $$ begin
  insert into post_likes (post_id, user_id) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004');
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, like a nome di altri rifiutato'; end $$;
select p->>'like_count' likes, p->>'save_count' saves, p->>'comment_count' comments, p->>'share_count' shares, p->>'liked' liked, p->>'saved' saved
from get_post('10000000-0000-0000-0000-000000000001') p;
select count(*) as post_seguiti from feed_following(10);
select p->'profile'->>'followers' as follower_di_user1 from get_profile('user1') p;

-- ---------- Sicurezza della community ----------
-- Un client non può nominarsi moderatore né togliersi un ban.
do $$ begin
  update profiles set is_moderator = true where id = auth.uid();
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, ruolo di moderatore non modificabile dal client'; end $$;

-- Blocco: user5 blocca user1 -> sparisce il follow, il profilo e i suoi post non si vedono più.
select block_user('00000000-0000-0000-0000-000000000001');
select count(*) as post_seguiti_dopo_blocco from feed_following(10);
do $$ begin perform get_profile('user1'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%non trovato%' then raise; end if; raise notice 'ok, profilo bloccato non visibile'; end $$;
select get_post('10000000-0000-0000-0000-000000000001') is null as post_bloccato_nascosto;
select jsonb_array_length(coalesce((select jsonb_agg(x) from list_blocked() x), '[]')) as bloccati;
select unblock_user('00000000-0000-0000-0000-000000000001');
select get_post('10000000-0000-0000-0000-000000000001') is not null as visibile_dopo_sblocco;

-- Non si segnala un proprio post.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin perform report_post('10000000-0000-0000-0000-000000000002', 'spam'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%tuo post%' then raise; end if; raise notice 'ok, auto-segnalazione rifiutata'; end $$;

-- Tre segnalazioni da persone diverse nascondono il post e lo tolgono dalla gara.
do $$
declare v int;
begin
  for v in 4..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||v, false);
    perform report_post('10000000-0000-0000-0000-000000000002', 'spam');
  end loop;
end $$;
select get_post('10000000-0000-0000-0000-000000000002') is null as post_segnalato_nascosto;

-- La coda di moderazione è solo per i moderatori.
do $$ begin perform mod_queue(); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%moderatori%' then raise; end if; raise notice 'ok, coda riservata ai moderatori'; end $$;
reset role;
update profiles set is_moderator = true where username = 'user6';
set role authenticated;
select (q->>'reports')::int as segnalazioni_in_coda from mod_queue() q;
-- "Nessun problema": il post torna visibile.
select mod_resolve('10000000-0000-0000-0000-000000000002', 'dismiss');
select get_post('10000000-0000-0000-0000-000000000002') is not null as visibile_dopo_revisione;
reset role;
select status <> 'disqualified' as ancora_in_gara_dopo_revisione from arena_entries where post_id = '10000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
-- Espulsione: user3 non può più pubblicare e i suoi post spariscono.
select report_post('10000000-0000-0000-0000-000000000003', 'odio');
select mod_resolve('10000000-0000-0000-0000-000000000003', 'ban');
select get_post('10000000-0000-0000-0000-000000000003') is null as post_espulso_nascosto;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000003', '[{"kind":"image","url":"https://x/1.jpg"}]');
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, utente espulso non può pubblicare'; end $$;

-- Eliminazione dell'account: sparisce tutto ciò che è suo.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select delete_my_account();
reset role;
select (select count(*) from profiles where username = 'user5') as profilo_user5,
       (select count(*) from comments where user_id = '00000000-0000-0000-0000-000000000005') as commenti_user5,
       (select like_count from posts where id = '10000000-0000-0000-0000-000000000001') as like_post1_dopo;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

reset role;
select (p.post->>'caption') caption, e.tier, e.status, round(e.last_score, 3) score, (arena_entry_totals(e.id)).views
from arena_entries e cross join lateral (select public.post_json(e.post_id, null) post) p order by 1;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select tier, status, views from arena_my_entry();
reset role;

-- Chiusura (service role) e copertina del giorno dopo.
select p.caption as vincitore from posts p where p.id = (select post_id from arena_entries where id = arena_close_day(arena_today()));
select arena_close_day(arena_today()) is not null as chiusura_idempotente;
update daily_viral set featured_on = arena_today();  -- simula "domani"
set role anon;
select c->'post'->>'caption' caption, c->'post'->'author'->>'username' autore, c->>'total_entries' in_gara from get_today_cover() c;
select count(*) as archivio from get_cover_archive(10);
do $$ begin perform arena_close_day(arena_today()); raise exception 'anon NON deve poter chiudere';
exception when insufficient_privilege then raise notice 'ok, anon non può chiudere la giornata'; end $$;
