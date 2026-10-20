-- Test end-to-end di supabase/schema.sql su un Postgres locale (vedi README.md).
\set ON_ERROR_STOP on
-- Esito "ok" del controllo automatico (come lo scrive la funzione verifica-eta, azione "modera") per un file
-- del bucket media (kind 'file'), una foto profilo ('avatar', p_name = percorso) o una didascalia ('caption').
create function test_ok(p_uid uuid, p_name text, p_kind text default 'file', p_verdict text default 'ok') returns void
language sql security definer as $$
  insert into media_checks (kind, path, owner_id, verdict)
  select p_kind, case p_kind when 'caption' then caption_check_path(p_uid, p_name) when 'avatar' then p_name else p_uid || '/' || p_name end, p_uid, p_verdict
  where exists (select 1 from profiles where id = p_uid)
  on conflict (kind, path) do update set verdict = excluded.verdict, owner_id = excluded.owner_id;
$$;
-- Indirizzo di un file nel bucket media, nella cartella dell'autore (come lo carica l'app), già controllato.
create function test_media(p_uid uuid, p_name text) returns jsonb language plpgsql security definer as $$
begin
  if not exists (select 1 from media_checks where kind = 'file' and path = p_uid || '/' || p_name) then perform test_ok(p_uid, p_name); end if;
  return jsonb_build_array(jsonb_build_object('kind', 'image', 'url', 'https://proj.supabase.co/storage/v1/object/public/media/' || p_uid || '/' || p_name, 'width', 1080, 'height', 1620));
end $$;
grant execute on function test_media(uuid, text) to authenticated;
-- I dati di prova inseriti dal superutente hanno file e didascalia già controllati ("ok"), come se fossero
-- passati dalla funzione: i test del controllo automatico pubblicano come utenti (ruolo authenticated).
create function test_fixture_checks() returns trigger language plpgsql as $$
begin
  if current_user = 'postgres' then
    perform test_ok(new.author_id, split_part(x, '/', 2)) from media_paths(new.media) x
      where not exists (select 1 from media_checks where kind = 'file' and path = x);
    if new.caption <> '' and not exists (select 1 from media_checks where kind = 'caption' and path = caption_check_path(new.author_id, new.caption)) then
      perform test_ok(new.author_id, new.caption, 'caption');
    end if;
  end if;
  return new;
end $$;
create trigger trg_posts_0_test_fixture before insert on posts for each row execute function test_fixture_checks();
update arena_config set tier_thresholds='{3,5}', min_cohort=100, baseline_score=0.3, submission_cutoff_hour=24, report_min_views=3;

-- 6 utenti: user1..user3 sono autori, tutti sono spettatori.
insert into auth.users select ('00000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,6) i;
insert into profiles (id, username, display_name, created_at)
  select id, 'user'||right(id::text,1), 'Utente '||right(id::text,1), now() - interval '10 days' from auth.users;
-- Il trigger impone created_at = now() (anche al superutente): per il test gli account diventano "vecchi" di 10 giorni.
update profiles set created_at = now() - interval '10 days';
-- Utenti di prova già verificati (documento approvato).
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles;
insert into posts (id, author_id, media, caption)
  select ('10000000-0000-0000-0000-00000000000'||i)::uuid, ('00000000-0000-0000-0000-00000000000'||i)::uuid,
         test_media(('00000000-0000-0000-0000-00000000000'||i)::uuid, i||'.jpg'), 'Post '||i
  from generate_series(1,3) i;
-- Un carosello misto foto + video dello stesso autore.
insert into posts (id, author_id, media, caption) values ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001',
  test_media('00000000-0000-0000-0000-000000000001', 'a.jpg') || jsonb_build_array(jsonb_build_object('kind','video','url','https://proj.supabase.co/storage/v1/object/public/media/00000000-0000-0000-0000-000000000001/b.mp4','width',720,'height',1280,'duration_ms',15000)), 'Carosello');

-- Media non validi: rifiutati.
do $$ begin
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000001', '[]');
  raise exception 'NON DOVEVA PASSARE';
exception when check_violation then raise notice 'ok, post senza media rifiutato'; end $$;
do $$ begin
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('kind','video','url','https://proj.supabase.co/storage/v1/object/public/media/00000000-0000-0000-0000-000000000001/v.mp4','duration_ms',90000)));
  raise exception 'NON DOVEVA PASSARE';
exception when check_violation then raise notice 'ok, video oltre 60 s rifiutato'; end $$;

set role authenticated;

-- Un client non può creare un post con contatori gonfiati.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  insert into posts (author_id, media, like_count) values ('00000000-0000-0000-0000-000000000002', test_media('00000000-0000-0000-0000-000000000002', '1.jpg'), 10000);
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

-- Le candidature non si leggono dalla tabella.
do $$ begin perform 1 from arena_entries limit 1; raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, candidature non leggibili dal client'; end $$;
-- Voto su un post non servito: rifiutato.
reset role;
select id as entry_user2 from arena_entries where author_id = '00000000-0000-0000-0000-000000000002' \gset
set role authenticated;
select arena_record_view(:'entry_user2', 9000, p_liked => true) as voto_non_servito;

-- Ogni spettatore riceve i Provini e reagisce: post 1 ottimo, 2 medio, 3 skip.
do $$
declare v int; r record; ok boolean; cap text;
begin
  for v in 1..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||v, false);
    for r in select * from feed_for_you(10) where entry_id is not null loop
      if (r.post->'author'->>'id')::uuid = auth.uid() then raise exception 'servito il proprio post!'; end if;
      cap := r.post->>'caption';
      -- I segnali contano solo se esistono davvero: per il post 1 lo spettatore mette mi piace, commenta e condivide.
      if cap = 'Post 1' then
        insert into post_likes (post_id, user_id) values ((r.post->>'id')::uuid, auth.uid());
        insert into comments (post_id, user_id, body) values ((r.post->>'id')::uuid, auth.uid(), 'Wow');
        perform register_share((r.post->>'id')::uuid);
      end if;
      ok := arena_record_view(r.entry_id,
        case cap when 'Post 1' then 9000 when 'Post 2' then 4000 else 500 end,
        p_rewatched => cap = 'Post 1', p_liked => cap = 'Post 1', p_commented => cap = 'Post 1', p_shared => cap = 'Post 1');
      if not ok then raise exception 'vista rifiutata'; end if;
      if arena_record_view(r.entry_id, 9000, p_liked => true) then raise exception 'doppio voto accettato'; end if;
    end loop;
    if exists (select 1 from feed_for_you(10) where entry_id is not null) then raise exception 'provini ripetuti'; end if;
  end loop;
end $$;

-- Segnali falsi: dire "mi è piaciuto" senza il mi piace non conta.
reset role;
select sum(likes) as like_registrati_post2, sum(comments) as commenti_registrati_post2 from arena_entry_stats where entry_id = :'entry_user2';
set role authenticated;

-- Un segnale arrivato dopo la vista (dal foglio dei commenti, o un salvataggio un attimo dopo) conta una volta sola,
-- anche togliendolo e rimettendolo. Il post 1 è finalista: user4 l'ha visto ma non l'aveva salvato.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
insert into post_saves (post_id, user_id) values ('10000000-0000-0000-0000-000000000001', auth.uid());
delete from post_saves where post_id = '10000000-0000-0000-0000-000000000001' and user_id = auth.uid();
insert into post_saves (post_id, user_id) values ('10000000-0000-0000-0000-000000000001', auth.uid());
reset role;
do $$ declare n int; begin
  select sum(saves) into n from arena_entry_stats e join arena_entries a on a.id = e.entry_id
   where a.author_id = '00000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'salvataggio tardivo accreditato % volte', n; end if;
  raise notice 'ok, segnale dopo la vista accreditato una volta';
end $$;
set role authenticated;

-- Interazioni sociali e contatori mantenuti dai trigger (user5 ha già messo mi piace al post 1 nei Provini).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
do $$ begin
  update post_likes set post_id = '10000000-0000-0000-0000-000000000002' where user_id = auth.uid();
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, un mi piace non si sposta su un altro post'; end $$;
insert into post_saves (post_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005');
insert into comments (post_id, user_id, body) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'Bellissima!');
-- Condividere due volte conta una volta.
select register_share('10000000-0000-0000-0000-000000000001');
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
-- Nemmeno leggendo la tabella: un post nascosto non si vede.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select count(*) as post_nascosto_in_tabella from posts where id = '10000000-0000-0000-0000-000000000002';
reset role;
select status as stato_dopo_segnalazioni, disqualified_reason from arena_entries where post_id = '10000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);

-- La coda di moderazione è solo per i moderatori.
do $$ begin perform mod_queue(); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%moderatori%' then raise; end if; raise notice 'ok, coda riservata ai moderatori'; end $$;
reset role;
update profiles set is_moderator = true where username = 'user6';
set role authenticated;
select (q->>'reports')::int as segnalazioni_in_coda from mod_queue() q;
-- "Nessun problema": il post torna visibile.
select mod_resolve('10000000-0000-0000-0000-000000000002', 'dismiss');
-- Torna visibile a tutti (tranne a chi l'ha segnalato, che ha chiesto di non vederlo più).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
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
  insert into posts (author_id, media) values ('00000000-0000-0000-0000-000000000003', test_media('00000000-0000-0000-0000-000000000003', '1.jpg'));
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, utente espulso non può pubblicare'; end $$;

-- Registrazione: età minima, nome utente libero, niente insert diretti nei profili.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000007', 'user7@utenti.virale.invalid');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
do $$ begin
  insert into profiles (id, username, display_name) values (auth.uid(), 'user7', 'Utente 7');
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, profilo solo tramite registrazione'; end $$;
do $$ begin
  perform complete_registration('user7', 'Ada', 'Bianchi', (current_date - interval '13 years')::date, true);
  raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%almeno 14 anni%' then raise; end if; raise notice 'ok, meno di 14 anni rifiutato'; end $$;
select username_available('user1') as user1_libero, username_available('user7') as user7_libero;
select complete_registration('user7', 'Ada', 'Bianchi', '2000-05-01', true) ->> 'display_name' as nome_mostrato;
select (my_status() -> 'identity' ->> 'status') as stato_documento, (my_status() -> 'identity' ->> 'can_act')::boolean as puo_agire;
reset role;
select created_at > now() - interval '1 minute' as account_nuovo, is_moderator, is_admin from profiles where username = 'user7';
set role authenticated;

-- Periodo per il documento scaduto: si guarda soltanto.
reset role;
update identity_checks set deadline = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000000007';
set role authenticated;
do $$ begin
  insert into posts (author_id, media) values (auth.uid(), test_media(auth.uid(), '7.jpg'));
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, senza documento dopo la scadenza non si pubblica'; end $$;
do $$ begin perform submit_identity('00000000-0000-0000-0000-000000000001/doc.jpg', '00000000-0000-0000-0000-000000000007/selfie.jpg'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%File non validi%' then raise; end if; raise notice 'ok, documento nella cartella di un altro rifiutato'; end $$;
select submit_identity('00000000-0000-0000-0000-000000000007/doc.jpg', '00000000-0000-0000-0000-000000000007/selfie.jpg');
do $$ begin perform identity_queue(); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%amministratori%' then raise; end if; raise notice 'ok, coda documenti solo per amministratori'; end $$;
do $$ begin perform admin_set_settings(600, 7); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%amministratori%' then raise; end if; raise notice 'ok, impostazioni solo per amministratori'; end $$;
reset role;
update profiles set is_admin = true where username = 'user4';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select count(*) as documenti_in_coda from identity_queue() q;
select identity_review('00000000-0000-0000-0000-000000000007', 'approve') -> 'paths' as file_da_cancellare;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
select (my_status() -> 'identity' ->> 'status') as stato_dopo_revisione, (my_status() -> 'identity' ->> 'can_act')::boolean as puo_agire_dopo;
select count(*) as notifica_verifica from list_notifications() n where n ->> 'kind' = 'identity_ok';

-- Orario della copertina deciso dall'amministratore.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select admin_set_settings(1439, 10) ->> 'reveal_minutes' as nuovo_orario;
reset role;
do $$ begin
  -- Ieri è già chiuso: spostare l'orario più avanti non riapre un giorno chiuso, la gara di oggi si allunga
  -- fino alle 23:59 di domani.
  if arena_today() <> (now() at time zone 'Europe/Rome')::date then
    raise exception 'il giorno di gara è tornato indietro: %', arena_today();
  end if;
  if (get_settings() ->> 'closes_at')::timestamptz <> ((arena_today() + 1)::timestamp + interval '23 hours 59 minutes') at time zone 'Europe/Rome' then
    raise exception 'fine della gara sbagliata: %', get_settings() ->> 'closes_at';
  end if;
  if cover_day() <> arena_today() then raise exception 'copertina e gara su giorni diversi'; end if;
  raise notice 'ok, il giorno di gara non torna mai su un giorno chiuso';
end $$;
update arena_config set reveal_minutes = 0;
select cover_day() = arena_today() as dopo_la_rivelazione_si_vede_oggi;
set role authenticated;

-- Notifiche: follow e mi piace (e il mi piace tolto sparisce), segna come lette.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
insert into follows (follower_id, followee_id) values (auth.uid(), '00000000-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
reset role;
select count(*) filter (where kind = 'follow') as notifiche_follow_user1, count(*) filter (where kind = 'like') as notifiche_like_user1
from notifications where user_id = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select (my_status() ->> 'unread')::int > 0 as ci_sono_non_lette;
select mark_notifications_read();
select (my_status() ->> 'unread')::int as non_lette_dopo;

-- Visualizzazioni: una per persona al giorno, i propri post non contano.
select register_views(array['10000000-0000-0000-0000-000000000009'::uuid, '10000000-0000-0000-0000-000000000003'::uuid]);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
select register_views(array['10000000-0000-0000-0000-000000000009'::uuid]);
select register_views(array['10000000-0000-0000-0000-000000000009'::uuid]);
select (get_post('10000000-0000-0000-0000-000000000009') ->> 'view_count')::int as visualizzazioni_carosello;

-- Elenchi di chi segue e di chi è seguito.
select count(*) as follower_di_user1 from list_follows('user1', 'followers') x;
select count(*) as seguiti_da_user6 from list_follows('user6', 'following') x;

-- Ritirare un post in gara (eliminandolo) non permette una seconda candidatura lo stesso giorno.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
delete from posts where id = '10000000-0000-0000-0000-000000000002';
do $$ declare v uuid; begin
  insert into posts (author_id, media) values (auth.uid(), test_media(auth.uid(), '8.jpg')) returning id into v;
  perform arena_submit(v); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%un solo post%' then raise; end if; raise notice 'ok, niente seconda candidatura dopo aver ritirato il post'; end $$;

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
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select c->'post'->>'caption' caption, c->'post'->'author'->>'username' autore, c->>'total_entries' in_gara from get_today_cover() c;
select count(*) as archivio from get_cover_archive(10);
set role anon;
do $$ begin perform post_json('10000000-0000-0000-0000-000000000001', null); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, anon non chiama le funzioni interne'; end $$;
do $$ begin perform arena_close_day(arena_today()); raise exception 'anon NON deve poter chiudere';
exception when insufficient_privilege then raise notice 'ok, anon non può chiudere la giornata'; end $$;

-- ---------- Revisione di sicurezza: protezioni aggiuntive ----------
reset role;
set role authenticated;
-- Un post con immagini da un sito esterno viene rifiutato.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin
  insert into posts (author_id, media) values (auth.uid(), '[{"kind":"image","url":"https://evil.example/track.gif"}]');
  raise exception 'NON DOVEVA PASSARE';
exception when check_violation then raise notice 'ok, media da siti esterni rifiutati'; end $$;
-- Un file già usato da un altro post (anche come anteprima) non si riusa: eliminando il secondo post
-- si libererebbe il file del primo, già moderato.
do $$ begin
  insert into posts (author_id, media) values (auth.uid(), test_media(auth.uid(), 'riuso.jpg'));
  begin
    insert into posts (author_id, media) values (auth.uid(), jsonb_build_array(jsonb_build_object('kind', 'video',
      'url', 'https://proj.supabase.co/storage/v1/object/public/media/' || auth.uid() || '/nuovo.mp4',
      'poster', 'https://proj.supabase.co/storage/v1/object/public/media/' || auth.uid() || '/riuso.jpg')));
    raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then raise notice 'ok, file di un altro post non riusabile'; end;
  begin
    -- Indirizzo valido: a far rifiutare il post è solo il campo in più.
    insert into posts (author_id, media) values (auth.uid(), jsonb_set(test_media(auth.uid(), 'campi.jpg'), '{0,extra}', '"x"'));
    raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then raise notice 'ok, campi sconosciuti nei media rifiutati'; end;
end $$;
-- Nessuno può sapere chi è amministratore o se un altro è verificato.
select is_admin('00000000-0000-0000-0000-000000000004') as io_admin, is_admin('00000000-0000-0000-0000-000000000006') as altro_admin_visibile,
       can_act('00000000-0000-0000-0000-000000000006') as verifica_altrui_visibile;
-- La tabella delle copertine non si legge direttamente (si vedrebbe prima dell'orario).
do $$ begin perform 1 from daily_viral limit 1; raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, copertine non leggibili prima della rivelazione'; end $$;
-- L'amministratore non verifica se stesso.
reset role;
update identity_checks set status = 'pending', submitted_at = now() where user_id = '00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$ begin perform identity_review('00000000-0000-0000-0000-000000000004', 'approve'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%te stesso%' then raise; end if; raise notice 'ok, niente auto-verifica'; end $$;
-- Un moderatore non può espellere un amministratore.
reset role;
update identity_checks set status = 'approved' where user_id = '00000000-0000-0000-0000-000000000004';
update profiles set is_moderator = true where username = 'user6';
insert into posts (id, author_id, media) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', test_media('00000000-0000-0000-0000-000000000004', 'a.jpg'));
insert into reports (post_id, reported_user_id, reporter_id, reason) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'spam');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
do $$ begin perform mod_resolve('10000000-0000-0000-0000-00000000000a', 'ban'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%staff%' then raise; end if; raise notice 'ok, lo staff non si espelle a vicenda'; end $$;
-- Un nome utente espulso non si riprende.
reset role;
insert into banned_usernames (username, reason) values ('cattivo', 'moderazione');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000008', 'cattivo@utenti.virale.invalid');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000008', false);
select username_available('cattivo') as cattivo_disponibile;
do $$ begin perform complete_registration('cattivo', 'C', 'A', '1990-01-01', true); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%non è disponibile%' then raise; end if; raise notice 'ok, nome di un espulso non riutilizzabile'; end $$;
-- Il nome utente deve corrispondere all'accesso.
do $$ begin perform complete_registration('altro_nome', 'C', 'A', '1990-01-01', true); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%non valido per questo accesso%' then raise; end if; raise notice 'ok, nome utente legato all''accesso'; end $$;
reset role;

-- ---------- Interessi, Esplora, pagine ----------
-- b1 guarda; b2 pubblica gatti, b3 pubblica auto.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3');
insert into profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-0000000000b1', 'guarda', 'Guarda G.'), ('00000000-0000-0000-0000-0000000000b2', 'gatti', 'Gatti G.'), ('00000000-0000-0000-0000-0000000000b3', 'auto', 'Auto A.');
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username in ('guarda', 'gatti', 'auto');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', test_media('00000000-0000-0000-0000-0000000000b2', '1.jpg'), 'Micio #gatti');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', test_media('00000000-0000-0000-0000-0000000000b2', '2.jpg'), 'Ancora #gatti');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b2', test_media('00000000-0000-0000-0000-0000000000b2', '3.jpg'), 'Sonno #gatti');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b3', test_media('00000000-0000-0000-0000-0000000000b3', '1.jpg'), 'Rombo #auto');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b3', test_media('00000000-0000-0000-0000-0000000000b3', '2.jpg'), 'Pista #auto');
insert into posts (id, author_id, media, caption) values ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b3', test_media('00000000-0000-0000-0000-0000000000b3', '3.jpg'), 'Box #auto');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
insert into post_likes (post_id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1');
select track_views('[{"post_id":"20000000-0000-0000-0000-000000000004","dwell_ms":300},{"post_id":"20000000-0000-0000-0000-000000000005","dwell_ms":400},{"post_id":"20000000-0000-0000-0000-000000000006","dwell_ms":500},{"post_id":"20000000-0000-0000-0000-000000000001","dwell_ms":5000,"completed":true}]');
reset role;
do $$ declare a real; b real; t real; v int; begin
  select score into a from user_interests where user_id = '00000000-0000-0000-0000-0000000000b1' and key = 'a:00000000-0000-0000-0000-0000000000b2';
  select score into b from user_interests where user_id = '00000000-0000-0000-0000-0000000000b1' and key = 'a:00000000-0000-0000-0000-0000000000b3';
  select score into t from user_interests where user_id = '00000000-0000-0000-0000-0000000000b1' and key = 't:gatti';
  select view_count into v from posts where id = '20000000-0000-0000-0000-000000000004';
  if not (a > 1 and b < 0 and t > 0) then raise exception 'interessi sbagliati: % % %', a, b, t; end if;
  if v <> 0 then raise exception 'una scorsa di 0,3 s non è una visualizzazione'; end if;
  if (select view_count from posts where id = '20000000-0000-0000-0000-000000000001') <> 1 then raise exception 'visualizzazione non contata'; end if;
  raise notice 'ok, gusti imparati da mi piace e da come si guarda';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare authors text[]; ids text[]; g int; au int; begin
  select array_agg(x ->> 'id'), array_agg(x -> 'author' ->> 'username') into ids, authors from feed_explore(20) x;
  g := array_position(authors, 'gatti');
  au := coalesce(array_position(authors, 'auto'), 999);
  if g is null or g > au then raise exception 'in Esplora doveva venire prima chi piace: %', authors; end if;
  if exists (select 1 from posts where id::text = any (ids) and author_id = auth.uid()) then raise exception 'propri post in Esplora'; end if;
  raise notice 'ok, Esplora ordinata per gusti, senza i propri post';
end $$;
do $$ declare n int; begin
  select count(*) into n from feed_explore(5, array['20000000-0000-0000-0000-000000000002'::uuid]) x where x ->> 'id' = '20000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'Esplora ripropone un post già nella pagina'; end if;
  raise notice 'ok, Esplora non ripete i post già mostrati';
end $$;
do $$ declare n_all int; n_entries int; begin
  select count(*), count(entry_id) into n_all, n_entries from feed_for_you(20);
  if n_all <> n_entries then raise exception 'In gara mostra post non in gara (% su %)', n_all - n_entries, n_all; end if;
  raise notice 'ok, In gara mostra solo post in gara';
end $$;
-- Pagine: Seguiti, profilo, elenchi.
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
do $$ declare p1 jsonb[]; p2 jsonb[]; begin
  select array_agg(x) into p1 from feed_following(2) x;
  select array_agg(x) into p2 from feed_following(2, (p1[2] ->> 'created_at')::timestamptz) x;
  if array_length(p1, 1) <> 2 or array_length(p2, 1) <> 1 or p2[1] ->> 'id' in (p1[1] ->> 'id', p1[2] ->> 'id') then raise exception 'pagine di Seguiti sbagliate'; end if;
  select array_agg(x) into p1 from profile_posts('auto', 'posts', null, 2) x;
  select array_agg(x) into p2 from profile_posts('auto', 'posts', (p1[2] ->> 'cursor')::timestamptz, 2) x;
  if array_length(p1, 1) <> 2 or array_length(p2, 1) <> 1 then raise exception 'pagine del profilo sbagliate'; end if;
  raise notice 'ok, Seguiti e profilo a pagine senza doppioni';
end $$;
-- Le scelte dell'amministratore passano anche con safeupdate (UPDATE sempre con WHERE).
reset role;
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'admin_set_settings' and prosrc ~* 'update arena_config set [^;]* where') then
    raise exception 'admin_set_settings senza WHERE';
  end if;
  raise notice 'ok, nessun UPDATE senza WHERE nelle impostazioni';
end $$;
-- Gli interessi non impediscono di cancellare l'account (i trigger non ricreano righe orfane).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select delete_my_account();
reset role;
do $$ begin
  if exists (select 1 from user_interests where user_id = '00000000-0000-0000-0000-0000000000b1') then raise exception 'interessi rimasti'; end if;
  raise notice 'ok, account con interessi cancellato del tutto';
end $$;

-- ---------- Verifica automatica (Didit) ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-0000000000c1', 'adulto', 'Adulto A.'), ('00000000-0000-0000-0000-0000000000c2', 'piccolo', 'Piccolo P.');
insert into identity_checks (user_id, deadline) select id, now() + interval '7 days' from profiles where username in ('adulto', 'piccolo');
insert into profile_private (id, first_name, last_name, birth_date) values ('00000000-0000-0000-0000-0000000000c1', 'Ada', 'Rossi', '1995-01-01');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c3');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-0000000000c3', 'fratello', 'Luca B.');
insert into identity_checks (user_id, deadline) values ('00000000-0000-0000-0000-0000000000c3', now() + interval '7 days');
insert into profile_private (id, first_name, last_name, birth_date) values ('00000000-0000-0000-0000-0000000000c3', 'Luca', 'Bianchi', '2000-01-01');
-- L'app non può chiamare le funzioni riservate alla verifica automatica.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$ begin perform identity_provider_result('00000000-0000-0000-0000-0000000000c1', 's1', 'Approved', '1990-01-01'); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, esito automatico non falsificabile dall''app'; end $$;
reset role;
set role service_role;
select identity_provider_start('00000000-0000-0000-0000-0000000000c1', 'sess-a');
select identity_provider_start('00000000-0000-0000-0000-0000000000c2', 'sess-b');
do $$ begin
  if identity_provider_result('00000000-0000-0000-0000-0000000000c1', 'vecchia', 'Approved', '1990-01-01') <> 'ignored' then raise exception 'sessione vecchia accettata'; end if;
  if identity_provider_result('00000000-0000-0000-0000-0000000000c1', 'sess-a', 'In Review', null) <> 'review' then raise exception 'revisione'; end if;
  if identity_provider_result('00000000-0000-0000-0000-0000000000c1', 'sess-a', 'Approved', '1990-03-04', 'ADA', 'ROSSI') <> 'approved' then raise exception 'approvazione'; end if;
  if identity_provider_result('00000000-0000-0000-0000-0000000000c2', 'sess-b', 'Approved', (current_date - interval '12 years')::date) <> 'underage' then raise exception 'minore'; end if;
  perform identity_provider_start('00000000-0000-0000-0000-0000000000c3', 'sess-c');
  if identity_provider_result('00000000-0000-0000-0000-0000000000c3', 'sess-c', 'Approved', '1980-05-05', 'Marco', 'Bianchi') <> 'review' then raise exception 'nome diverso approvato'; end if;
  raise notice 'ok, esiti automatici applicati';
end $$;
reset role;
do $$ begin
  if (select status from identity_checks where user_id = '00000000-0000-0000-0000-0000000000c1') <> 'approved' then raise exception 'non approvato'; end if;
  if (select birth_date from profile_private where id = '00000000-0000-0000-0000-0000000000c1') <> '1990-03-04' then raise exception 'data del documento non salvata'; end if;
  if (select banned_at from profiles where username = 'piccolo') is null then raise exception 'minore non espulso'; end if;
  if not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'identity_ok') then raise exception 'notifica mancante'; end if;
  if (select status from identity_checks where user_id = '00000000-0000-0000-0000-0000000000c3') <> 'pending'
     or (select provider_note from identity_checks where user_id = '00000000-0000-0000-0000-0000000000c3') not like '%Marco Bianchi%' then
    raise exception 'documento di un altro non mandato in revisione';
  end if;
  raise notice 'ok, verifica automatica: adulto approvato, minore espulso, documento di un altro in revisione';
end $$;

-- Un post aperto da un link conta come visualizzazione ma non cambia i gusti.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-0000000000d1', 'curioso', 'Curioso C.');
insert into identity_checks (user_id, status, deadline) values ('00000000-0000-0000-0000-0000000000d1', 'approved', now());
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select track_views('[{"post_id":"20000000-0000-0000-0000-000000000004"}]');
reset role;
do $$ begin
  if exists (select 1 from user_interests where user_id = '00000000-0000-0000-0000-0000000000d1' and score <> 0) then raise exception 'gusti cambiati da un link'; end if;
  if (select view_count from posts where id = '20000000-0000-0000-0000-000000000004') <> 1 then raise exception 'visualizzazione da link non contata'; end if;
  raise notice 'ok, aprire un post da un link conta la vista senza toccare i gusti';
end $$;

-- ---------- Revisione: gara e sicurezza ----------
reset role;
update arena_config set tier_thresholds = '{100,200}', min_cohort = 100;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000e'||i)::uuid, 'gara'||i||'@utenti.virale.invalid' from generate_series(1,6) i;
insert into profiles (id, username, display_name) select id, 'gara'||right(id::text,1), 'Gara G.' from auth.users where id::text like '00000000-0000-0000-0000-0000000000e%';
update profiles set created_at = now() - interval '10 days' where username like 'gara%';
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username like 'gara%';
insert into posts (id, author_id, media, caption)
  select ('30000000-0000-0000-0000-00000000000'||i)::uuid, ('00000000-0000-0000-0000-0000000000e'||i)::uuid,
         test_media(('00000000-0000-0000-0000-0000000000e'||i)::uuid, 'g.jpg'), 'Gara '||i
  from generate_series(1,3) i;
set role authenticated;
do $$ declare i int; begin
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e'||i, false);
    perform arena_submit(('30000000-0000-0000-0000-00000000000'||i)::uuid);
  end loop;
end $$;
-- Il livello di una candidatura lo vede solo l'autore.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
do $$ declare c jsonb; begin
  select get_post('30000000-0000-0000-0000-000000000001') -> 'contest' into c;
  if c ->> 'tier' is not null or c ->> 'entry_id' is not null or c ->> 'status' <> 'active' then raise exception 'livello visibile a chi vota: %', c; end if;
  raise notice 'ok, chi vota vede solo "in gara", non il livello';
end $$;
-- Un mi piace dato prima che il post fosse servito non è un voto.
insert into post_likes (post_id, user_id) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e4');
-- Date imposte dal server: un follow datato nel futuro non passa.
do $$ begin
  insert into follows (follower_id, followee_id, created_at) values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e1', 'infinity');
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, data dei follow decisa dal server'; end $$;
-- Consegnati ma mai guardati: dopo 10 minuti tornano.
do $$ declare n1 int; n2 int; begin
  select count(*) into n1 from feed_for_you(10) f where f.post ->> 'id' like '30000000%';
  select count(*) into n2 from feed_for_you(10) f where f.post ->> 'id' like '30000000%';
  if n1 <> 3 or n2 <> 0 then raise exception 'consegna: % poi %', n1, n2; end if;
end $$;
reset role;
update arena_views set last_served_at = now() - interval '11 minutes', served_at = served_at
 where viewer_id = '00000000-0000-0000-0000-0000000000e4';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
-- Già nella lista sullo schermo: non torna nella stessa lista anche se sono passati 10 minuti.
do $$ declare n int; begin
  select count(*) into n from feed_for_you(10, array['30000000-0000-0000-0000-000000000001'::uuid]) f
   where f.post ->> 'id' like '30000000%';
  if n <> 2 then raise exception 'esclusione della lista: tornati %', n; end if;
  if exists (select 1 from feed_for_you(10, array['30000000-0000-0000-0000-000000000001'::uuid]) f
              where f.post ->> 'id' = '30000000-0000-0000-0000-000000000001') then
    raise exception 'post già nella lista ripetuto';
  end if;
  raise notice 'ok, niente doppioni nella stessa lista';
end $$;
reset role;
update arena_views set last_served_at = now() - interval '11 minutes', served_at = served_at
 where viewer_id = '00000000-0000-0000-0000-0000000000e4';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
do $$ declare n int; e uuid; begin
  create temp table served on commit drop as select * from feed_for_you(10) f where f.post ->> 'id' like '30000000%';
  select count(*) into n from served;
  if n <> 3 then raise exception 'candidati non guardati persi: tornati %', n; end if;
  raise notice 'ok, i candidati consegnati ma non guardati tornano';
  select entry_id into e from served where post ->> 'id' = '30000000-0000-0000-0000-000000000001';
  perform arena_record_view(e, 5000, true);
end $$;
reset role;
do $$ begin
  if (select coalesce(sum(likes), 0) from arena_entry_stats s join arena_entries e on e.id = s.entry_id where e.post_id = '30000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'un mi piace vecchio è stato contato come voto';
  end if;
  if not (select counted from arena_views v join arena_entries e on e.id = v.entry_id where e.post_id = '30000000-0000-0000-0000-000000000001' and v.viewer_id = '00000000-0000-0000-0000-0000000000e4') then
    raise exception 'vista non segnata come contata';
  end if;
  raise notice 'ok, contano solo i segnali dati dopo che il post è stato servito';
end $$;
-- Tre segnalazioni da chi il post non l'ha mai avuto davanti non lo nascondono.
set role authenticated;
do $$ declare i int; begin
  for i in 4..6 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e'||i, false);
    perform report_post('30000000-0000-0000-0000-000000000002', 'spam');
  end loop;
end $$;
reset role;
do $$ begin
  if (select hidden_at from posts where id = '30000000-0000-0000-0000-000000000002') is not null then
    raise exception 'tre account hanno nascosto un post che non avevano visto';
  end if;
  raise notice 'ok, segnalazioni di chi non ha visto il post non lo nascondono';
end $$;
-- Un post già in gara un altro giorno non si ricandida.
update arena_entries set contest_day = arena_today() - 3 where post_id = '30000000-0000-0000-0000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', false);
do $$ begin perform arena_submit('30000000-0000-0000-0000-000000000003'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%già partecipato%' then raise; end if; raise notice 'ok, un post partecipa una volta sola'; end $$;
-- Chi ha deciso sul documento non si legge.
do $$ begin perform reviewed_by from identity_checks where user_id = auth.uid(); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, nome di chi verifica riservato'; end $$;
-- Il nome di accesso non si cambia.
reset role;
do $$ begin
  update auth.users set email = 'altro@utenti.virale.invalid' where id = '00000000-0000-0000-0000-0000000000e1';
  raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%non si può cambiare%' then raise; end if; raise notice 'ok, nome di accesso bloccato'; end $$;
-- Stessa persona, secondo account: la verifica automatica lo manda in revisione.
insert into profile_private (id, first_name, last_name, birth_date) values
  ('00000000-0000-0000-0000-0000000000e5', 'Mario', 'Rossi', '1990-01-01'), ('00000000-0000-0000-0000-0000000000e6', 'Mario', 'Rossi', '1990-01-01');
update identity_checks set status = 'missing' where user_id in ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6');
set role service_role;
select identity_provider_start('00000000-0000-0000-0000-0000000000e5', 'dup-a');
select identity_provider_start('00000000-0000-0000-0000-0000000000e6', 'dup-b');
do $$ begin
  if identity_provider_result('00000000-0000-0000-0000-0000000000e5', 'dup-a', 'Approved', '1990-01-01', 'Mario', 'Rossi', 'CA12345AB') <> 'approved' then raise exception 'primo'; end if;
  if identity_provider_result('00000000-0000-0000-0000-0000000000e6', 'dup-b', 'Approved', '1990-01-01', 'Mario', 'Rossi', 'CA12345AB') <> 'rejected' then raise exception 'stesso documento non rifiutato'; end if;
  raise notice 'ok, stesso documento su due account: il secondo è rifiutato';
end $$;
reset role;
do $$ begin
  if (select status from identity_checks where user_id = '00000000-0000-0000-0000-0000000000e6') <> 'rejected'
     or (select reject_reason from identity_checks where user_id = '00000000-0000-0000-0000-0000000000e6') not like '%già stato usato%' then
    raise exception 'motivo del rifiuto per documento doppio';
  end if;
  raise notice 'ok, il rifiuto spiega che il documento è già usato';
end $$;
-- La copertina resta assegnata anche se il vincitore elimina l'account; rimuovere la copertina sceglie il secondo.
do $$ declare w uuid; d date := arena_today(); author uuid; again uuid; begin
  w := arena_close_day(d);
  if w is null then raise exception 'nessun vincitore'; end if;
  select author_id into author from daily_viral where contest_day = d;
  delete from auth.users where id = author;
  if not exists (select 1 from daily_viral where contest_day = d) then raise exception 'giorno riassegnabile dopo la cancellazione'; end if;
  again := arena_close_day(d);
  if again is distinct from (select entry_id from daily_viral where contest_day = d) then raise exception 'secondo vincitore'; end if;
  raise notice 'ok, la copertina non si riassegna se il vincitore se ne va';
end $$;

-- Una condivisione conta una volta: la seconda non alza il contatore.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
do $$ begin
  if not register_share('30000000-0000-0000-0000-000000000003') then raise exception 'prima condivisione non registrata'; end if;
  if register_share('30000000-0000-0000-0000-000000000003') then raise exception 'seconda condivisione contata'; end if;
  raise notice 'ok, una condivisione per persona e post';
end $$;
reset role;

-- Esplora mostra anche i post in gara (e di chi non si segue): nessun post resta invisibile.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e6', false);
do $$ begin
  if not exists (select 1 from feed_explore(20, '{}') x where x ->> 'id' = '30000000-0000-0000-0000-000000000001') then
    raise exception 'un post in gara non compare in Esplora';
  end if;
  raise notice 'ok, Esplora mostra anche i post in gara';
end $$;
reset role;

-- La gara chiude da sola all'orario della copertina, anche senza voti validi, e la copertina esce subito.
do $$ declare d date; w uuid; begin
  update arena_config set reveal_minutes = 0 where id;
  d := arena_today() - 1;
  delete from daily_viral where contest_day = d or featured_on = d + 1;
  delete from arena_closed_days where contest_day >= d;
  update arena_entries set contest_day = d where post_id = '30000000-0000-0000-0000-000000000002';
  perform arena_close_due();
  select entry_id into w from daily_viral where contest_day = d;
  if w is null then raise exception 'nessuna copertina senza voti'; end if;
  if not exists (select 1 from arena_closed_days where contest_day = d) then raise exception 'giorno non segnato come chiuso'; end if;
  if arena_today() <> d + 1 then raise exception 'giorno di gara sbagliato dopo la chiusura'; end if;
  raise notice 'ok, la gara chiude da sola e la copertina esce anche senza voti validi';
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select c ->> 'featured_on' from get_today_cover() c)::date is distinct from arena_today() then raise exception 'copertina appena uscita non visibile'; end if;
  raise notice 'ok, la copertina appena scelta è visibile subito';
end $$;

-- Doppioni: stessa persona con nomi dichiarati parziali e un altro documento → revisione.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-0000000000f1', 'luig', 'Luig V.'), ('00000000-0000-0000-0000-0000000000f2', 'luigi2', 'Luigi V.');
insert into identity_checks (user_id, deadline) select id, now() + interval '7 days' from profiles where username in ('luig', 'luigi2');
insert into profile_private (id, first_name, last_name, birth_date) values
  ('00000000-0000-0000-0000-0000000000f1', 'Luig', 'Verd', '1991-02-02'), ('00000000-0000-0000-0000-0000000000f2', 'Luigi', 'Verdi', '1991-02-02');
set role service_role;
select identity_provider_start('00000000-0000-0000-0000-0000000000f1', 'lv-1');
select identity_provider_start('00000000-0000-0000-0000-0000000000f2', 'lv-2');
do $$ begin
  if identity_provider_result('00000000-0000-0000-0000-0000000000f1', 'lv-1', 'Approved', '1991-02-02', 'Luigi', 'Verdi', 'AAA11111') <> 'approved' then raise exception 'primo'; end if;
  if identity_provider_result('00000000-0000-0000-0000-0000000000f2', 'lv-2', 'Approved', '1991-02-02', 'Luigi', 'Verdi', 'BBB22222') <> 'review' then raise exception 'doppione con nomi parziali approvato'; end if;
  raise notice 'ok, doppione riconosciuto anche con nomi dichiarati parziali';
end $$;
reset role;

-- Togliere e rimettere un mi piace a raffica viene fermato.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
do $$ declare i int; begin
  for i in 1..400 loop
    insert into post_likes (post_id, user_id) values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e4');
    delete from post_likes where post_id = '30000000-0000-0000-0000-000000000003' and user_id = '00000000-0000-0000-0000-0000000000e4';
  end loop;
  raise exception 'NON DOVEVA PASSARE';
exception when others then
  if sqlerrm not like '%Troppi mi piace%' then raise; end if;
  raise notice 'ok, mi piace a raffica fermati anche togliendoli';
end $$;
reset role;

-- Un file condiviso da due post (dati vecchi): eliminando uno dei due non finisce fra i file da cancellare.
reset role;
set session_replication_role = replica;
insert into posts (id, author_id, media) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004', test_media('00000000-0000-0000-0000-000000000004', 'condiviso.jpg')),
  ('10000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000004', test_media('00000000-0000-0000-0000-000000000004', 'condiviso.jpg'));
set session_replication_role = origin;
delete from posts where id = '10000000-0000-0000-0000-0000000000f2';
do $$ begin
  if exists (select 1 from storage_purge where path = '00000000-0000-0000-0000-000000000004/condiviso.jpg') then
    raise exception 'file ancora in uso messo fra quelli da cancellare';
  end if;
  delete from posts where id = '10000000-0000-0000-0000-0000000000f1';
  if not exists (select 1 from storage_purge where path = '00000000-0000-0000-0000-000000000004/condiviso.jpg') then
    raise exception 'file non più usato non messo in coda';
  end if;
  raise notice 'ok, si cancellano solo i file che nessun post usa';
end $$;

-- ---------- Rilascio 1.0: registrazione e profilo (W6) ----------
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'nome.lungo@utenti.virale.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'mario.rossi_2@utenti.virale.invalid');
set role authenticated;
-- Un nome di 60 caratteri: registrazione riuscita, nome mostrato entro i 40 caratteri.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare d text; begin
  d := complete_registration('nome.lungo', left(repeat('Mariagiovanna', 5), 60), 'Bianchi', '1999-09-09', true) ->> 'display_name';
  if length(d) > 40 or (select length(display_name) from profiles where username = 'nome.lungo') > 40 then raise exception 'nome troppo lungo: %', d; end if;
  raise notice 'ok, nome di 60 caratteri registrato, mostrato in % caratteri', length(d);
end $$;
-- Nomi utente senza lettere o numeri, con punti all'inizio, alla fine o di fila, e nomi riservati: rifiutati.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$ declare u text; begin
  foreach u in array array['...', '.abc', 'abc.', 'a..b', '___'] loop
    begin
      perform complete_registration(u, 'Mario', 'Rossi', '1990-01-01', true);
      raise exception 'NON DOVEVA PASSARE: %', u;
    exception when others then if sqlerrm not like '%almeno una lettera o un numero%' then raise; end if; end;
  end loop;
  foreach u in array array['virale', 'viraleitalia', 'admin2', 'supporto', 'moderatore'] loop
    begin
      perform complete_registration(u, 'Mario', 'Rossi', '1990-01-01', true);
      raise exception 'NON DOVEVA PASSARE: %', u;
    exception when others then if sqlerrm not like '%non è disponibile%' then raise; end if; end;
  end loop;
  if username_available('virale') or username_available('adminitalia') or username_available('a..b') then raise exception 'nome riservato o non valido disponibile'; end if;
  raise notice 'ok, nomi utente non validi o riservati rifiutati';
end $$;
do $$ begin
  perform complete_registration('mario.rossi_2', 'Mario', 'Rossi', '1990-01-01', true);
  if not exists (select 1 from profiles where username = 'mario.rossi_2') then raise exception 'mario.rossi_2 non registrato'; end if;
  raise notice 'ok, nome utente con punto e trattino basso accettato';
end $$;
-- Nome e bio non si cambiano più direttamente dalla tabella (niente controlli lì): solo da update_my_profile.
do $$ begin
  update profiles set bio = 'x' where id = auth.uid();
  raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, modifica diretta del profilo rifiutata'; end $$;
reset role;

-- ---------- Esplora non finisce mai (W4) ----------
-- Un autore con 5 post e uno spettatore che li ha già tutti nella lista: Esplora ne ripropone comunque.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-0000000000a3', 'cinquepost', 'Cinque P.'), ('00000000-0000-0000-0000-0000000000a4', 'spettatore', 'Spettatore S.');
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username in ('cinquepost', 'spettatore');
insert into posts (id, author_id, media, caption)
  select ('40000000-0000-0000-0000-00000000000'||i)::uuid, '00000000-0000-0000-0000-0000000000a3',
         test_media('00000000-0000-0000-0000-0000000000a3', 'e'||i||'.jpg'), 'Esplora '||i
  from generate_series(1,5) i;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
do $$ declare n int; v_all uuid[]; begin
  select array_agg(id) into v_all from posts where author_id <> auth.uid();
  select count(*) into n from feed_explore(8, v_all) x;
  if n < 1 then raise exception 'Esplora finita con tutti i post già mostrati'; end if;
  raise notice 'ok, Esplora ripropone i post anche quando li hai già visti tutti (%)', n;
end $$;
-- Nessun post altrui da vedere: nessun post e nessun errore (dentro un blocco annullato alla fine).
reset role;
do $$ declare n int; begin
  -- Si simula un database senza post visibili: tutti nascosti, poi si annulla.
  update posts set hidden_at = now() where author_id <> '00000000-0000-0000-0000-0000000000a4' and hidden_at is null;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
  set local role authenticated;
  select count(*) into n from feed_explore(8, '{}') x;
  if n <> 0 then raise exception 'Esplora senza post da vedere ne ha restituiti %', n; end if;
  raise notice 'ok, Esplora senza post da vedere: nessun post, nessun errore';
  raise exception using errcode = 'P0002', message = 'annulla';
exception when no_data_found then null;
end $$;

-- ---------- Segnalazioni di commenti e profili, coda di moderazione (W3) ----------
reset role;
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000001'||lpad(i::text, 2, '0'))::uuid from generate_series(1, 6) i;
insert into profiles (id, username, display_name, bio)
  select ('00000000-0000-0000-0000-0000000001'||lpad(i::text, 2, '0'))::uuid, 'mod'||i, 'Mod '||i, 'Bio di mod'||i from generate_series(1, 6) i;
update profiles set created_at = now() - interval '10 days' where username like 'mod_';
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username like 'mod_';
insert into profile_private (id, first_name, last_name, birth_date) values ('00000000-0000-0000-0000-000000000102', 'Carla', 'Neri', '1990-01-01');
-- mod1 pubblica, mod2 e mod3 commentano; mod5 è moderatore, mod6 amministratore.
insert into posts (id, author_id, media, caption) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', test_media('00000000-0000-0000-0000-000000000101', 'm.jpg'), 'Moderazione');
insert into comments (id, post_id, user_id, body) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'Commento brutto'),
  ('51000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'Commento normale');
update profiles set is_moderator = true where username = 'mod5';
update profiles set is_admin = true where username = 'mod6';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
do $$ declare n int; begin
  perform report_comment('51000000-0000-0000-0000-000000000001', 'spam');
  perform report_comment('51000000-0000-0000-0000-000000000001', 'odio');
  if (select count(*) from get_comments('50000000-0000-0000-0000-000000000001')) <> 1 then raise exception 'il commento segnalato si vede ancora'; end if;
  -- Il conteggio sotto il post coincide con i commenti mostrati.
  if (get_post('50000000-0000-0000-0000-000000000001') ->> 'comment_count')::int <> 1 then raise exception 'conteggio diverso dai commenti mostrati'; end if;
  raise notice 'ok, commento segnalato: sparisce per chi segnala, anche dal conteggio';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
do $$ begin
  if (select count(*) from get_comments('50000000-0000-0000-0000-000000000001')) <> 2 then raise exception 'il commento segnalato è sparito anche per gli altri'; end if;
  begin perform report_comment('51000000-0000-0000-0000-000000000002', 'spam'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%tuo commento%' then raise; end if; end;
  begin perform mod_user_reports(); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%moderatori%' then raise; end if; end;
  begin perform report_profile(auth.uid(), 'spam'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%tuo profilo%' then raise; end if; end;
  perform report_profile('00000000-0000-0000-0000-000000000102', 'falso');
  raise notice 'ok, niente segnalazioni dei propri contenuti, coda riservata allo staff';
end $$;
reset role;
do $$ begin
  if (select count(*) from user_reports where comment_id = '51000000-0000-0000-0000-000000000001') <> 1 then raise exception 'doppia segnalazione registrata'; end if;
  if (select snapshot ->> 'body' from user_reports where comment_id = '51000000-0000-0000-0000-000000000001') <> 'Commento brutto' then raise exception 'testo del commento non conservato'; end if;
  raise notice 'ok, la doppia segnalazione dello stesso commento si ignora e il testo resta come prova';
end $$;
-- Il moderatore vede la coda e rimuove: il commento sparisce e l'autore riceve il motivo.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', false);
do $$ declare q jsonb[]; begin
  select array_agg(x) into q from mod_user_reports() x;
  if array_length(q, 1) <> 2 then raise exception 'coda: % elementi', array_length(q, 1); end if;
  perform mod_resolve_user_report('comment', '51000000-0000-0000-0000-000000000001', 'remove');
  if exists (select 1 from mod_user_reports() x where x ->> 'kind' = 'comment') then raise exception 'segnalazione ancora in coda'; end if;
  raise notice 'ok, coda dei commenti e dei profili, la rimozione la svuota';
end $$;
reset role;
do $$ declare d jsonb; begin
  if exists (select 1 from comments where id = '51000000-0000-0000-0000-000000000001') then raise exception 'commento non cancellato'; end if;
  select data into d from notifications where user_id = '00000000-0000-0000-0000-000000000102' and kind = 'removed';
  if d ->> 'what' <> 'comment' or d ->> 'reason' not in ('spam', 'odio') or d ->> 'body' <> 'Commento brutto' then raise exception 'notifica di rimozione senza motivo: %', d; end if;
  raise notice 'ok, commento rimosso e autore avvisato con il motivo';
end $$;
-- Rimozione del profilo: bio e foto azzerate, nome neutro "Utente".
update profiles set avatar_path = '00000000-0000-0000-0000-000000000102/avatar-1700000000000.jpg', display_name = 'Moderatore Ufficiale' where username = 'mod2';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', false);
select mod_resolve_user_report('profile', '00000000-0000-0000-0000-000000000102', 'remove');
reset role;
do $$ declare pr profiles; begin
  select * into pr from profiles where username = 'mod2';
  if pr.bio <> '' or pr.avatar_path is not null or pr.display_name <> 'Utente' then raise exception 'profilo non azzerato: % % %', pr.bio, pr.avatar_path, pr.display_name; end if;
  if not exists (select 1 from storage_purge where bucket = 'avatars' and path = '00000000-0000-0000-0000-000000000102/avatar-1700000000000.jpg') then raise exception 'foto non messa in pulizia'; end if;
  raise notice 'ok, profilo rimosso: bio e foto azzerate, nome neutro';
end $$;
-- Un moderatore non espelle un amministratore (nemmeno da una segnalazione di profilo).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
select report_profile('00000000-0000-0000-0000-000000000106', 'spam');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', false);
do $$ begin perform mod_resolve_user_report('profile', '00000000-0000-0000-0000-000000000106', 'ban'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%staff%' then raise; end if; raise notice 'ok, un moderatore non espelle un amministratore'; end $$;
-- 31 segnalazioni in un'ora: la trentunesima viene fermata (post, commenti e profili contano insieme).
reset role;
insert into rate_events (user_id, kind, at) select '00000000-0000-0000-0000-000000000104', 'reports', now() from generate_series(1, 29);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
do $$ begin
  perform report_profile('00000000-0000-0000-0000-000000000103', 'spam');
  raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%Troppe segnalazioni%' then raise; end if; raise notice 'ok, segnalazioni a raffica fermate'; end $$;
reset role;

-- ---------- Commenti coerenti: conteggi, blocchi, notifiche, espulsi (W14) ----------
-- Conteggio per chi ha bloccato un commentatore (B10).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', false);
insert into comments (post_id, user_id, body) values ('50000000-0000-0000-0000-000000000001', auth.uid(), 'Grazie');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
select block_user('00000000-0000-0000-0000-000000000103');
do $$ declare shown int; counted int; begin
  select count(*) into shown from get_comments('50000000-0000-0000-0000-000000000001');
  counted := (get_post('50000000-0000-0000-0000-000000000001') ->> 'comment_count')::int;
  if shown <> counted then raise exception 'conteggio % ma commenti mostrati %', counted, shown; end if;
  raise notice 'ok, il conteggio dei commenti coincide con quelli mostrati (blocchi e segnalazioni)';
end $$;
-- Due commenti della stessa persona: cancellandone uno la notifica resta (con l'altro testo), poi sparisce (B33).
reset role;
insert into comments (id, post_id, user_id, body) values ('51000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104', 'Primo');
insert into comments (id, post_id, user_id, body) values ('51000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104', 'Secondo');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
delete from comments where id = '51000000-0000-0000-0000-000000000004';
reset role;
do $$ begin
  if (select data ->> 'body' from notifications where user_id = '00000000-0000-0000-0000-000000000101' and kind = 'comment' and actor_id = '00000000-0000-0000-0000-000000000104') is distinct from 'Primo' then
    raise exception 'notifica sparita o con il testo sbagliato';
  end if;
  delete from comments where id = '51000000-0000-0000-0000-000000000003';
  if exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000101' and kind = 'comment' and actor_id = '00000000-0000-0000-0000-000000000104') then
    raise exception 'notifica rimasta senza commenti';
  end if;
  raise notice 'ok, la notifica del commento segue i commenti rimasti';
end $$;
-- Espulsione: i commenti dell'espulso spariscono e il conteggio scende (N7).
do $$ declare before int; begin
  select comment_count into before from posts where id = '50000000-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000106', true);
  perform mod_resolve_user_report('profile', '00000000-0000-0000-0000-000000000103', 'ban');
  if exists (select 1 from comments where user_id = '00000000-0000-0000-0000-000000000103') then raise exception 'commenti dell''espulso rimasti'; end if;
  if (select comment_count from posts where id = '50000000-0000-0000-0000-000000000001') <> before - 1 then raise exception 'conteggio non sceso'; end if;
  if (select banned_at from profiles where username = 'mod3') is null then raise exception 'non espulso'; end if;
  raise notice 'ok, espulso: commenti cancellati e conteggio aggiornato';
end $$;

-- ---------- Pulizia dei file con il lavoro programmato (W8) ----------
do $$ begin
  insert into storage_purge (bucket, path) values ('avatars', '00000000-0000-0000-0000-000000000101/avatar-1700000000001.jpg'), ('media', '00000000-0000-0000-0000-000000000101/vecchio.jpg');
  -- Un file ancora usato da un post non va cancellato anche se qualcuno l'ha messo in coda.
  insert into storage_purge (bucket, path) values ('media', '00000000-0000-0000-0000-000000000101/m.jpg');
  update profiles set avatar_path = '00000000-0000-0000-0000-000000000101/avatar-1700000000002.jpg' where username = 'mod1';
  insert into storage_purge (bucket, path) values ('avatars', '00000000-0000-0000-0000-000000000101/avatar-1700000000002.jpg');
  raise notice 'ok, la coda di pulizia accetta il bucket avatars';
end $$;
set role authenticated;
do $$ begin perform storage_purge_take(10); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, la pulizia programmata non si chiama dall''app'; end $$;
reset role;
set role service_role;
do $$ declare paths text[]; begin
  select array_agg(path) into paths from storage_purge_take(1000);
  if not ('00000000-0000-0000-0000-000000000101/vecchio.jpg' = any (paths)) or not ('00000000-0000-0000-0000-000000000101/avatar-1700000000001.jpg' = any (paths)) then
    raise exception 'file da cancellare non restituiti: %', paths;
  end if;
  if '00000000-0000-0000-0000-000000000101/m.jpg' = any (paths) or '00000000-0000-0000-0000-000000000101/avatar-1700000000002.jpg' = any (paths) then
    raise exception 'restituito un file ancora in uso';
  end if;
  perform storage_purge_finish('media', array['00000000-0000-0000-0000-000000000101/vecchio.jpg']);
  if exists (select 1 from storage_purge where path = '00000000-0000-0000-0000-000000000101/vecchio.jpg') then raise exception 'non tolto dalla coda'; end if;
  raise notice 'ok, pulizia programmata: solo i file non più usati, poi tolti dalla coda';
end $$;
reset role;

-- ---------- Numero dell'uscita, Archivio a pagine, copertina di un giorno (W13) ----------
reset role;
do $$ declare d date := arena_today(); begin
  -- Due copertine uscite in giorni diversi (oltre a quelle dei test precedenti).
  delete from daily_viral;
  insert into daily_viral (featured_on, contest_day, post_id, author_id, final_score, total_entries, total_views)
  values (d - 1, d - 2, '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 0, 3, 10),
         (d, d - 1, '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 0, 2, 5),
         (d + 1, d, '40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a3', 0, 2, 5);
end $$;
update posts set hidden_at = null where id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
do $$ declare a jsonb[]; p jsonb[]; begin
  select array_agg(x) into a from get_cover_archive(60) x;
  if array_length(a, 1) <> 2 or (a[1] ->> 'issue')::int <> 2 or (a[2] ->> 'issue')::int <> 1 then raise exception 'numeri delle uscite sbagliati: %', a; end if;
  if (get_today_cover() ->> 'issue')::int <> 2 then raise exception 'numero della copertina di oggi sbagliato'; end if;
  select array_agg(x) into p from get_cover_archive(60, (a[1] ->> 'featured_on')::date) x;
  if array_length(p, 1) <> 1 or p[1] ->> 'featured_on' <> a[2] ->> 'featured_on' then raise exception 'pagina successiva dell''Archivio sbagliata'; end if;
  raise notice 'ok, uscite numerate dal server (N. 1, N. 2) e Archivio a pagine';
end $$;
do $$ declare d date := (get_today_cover() ->> 'featured_on')::date; begin
  if get_cover(d + 1) is not null then raise exception 'copertina di domani visibile in anticipo'; end if;
  if get_cover(d - 30) is not null then raise exception 'copertina inesistente'; end if;
  if (get_cover(d - 1) ->> 'issue')::int <> 1 then raise exception 'copertina di ieri sbagliata'; end if;
  raise notice 'ok, la copertina di un giorno: solo se è già uscita';
end $$;
reset role;

-- ---------- Modifica del profilo (W15) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
do $$ declare r jsonb; begin
  begin perform update_my_profile(p_bio => repeat('a', 161)); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%160 caratteri%' then raise; end if; end;
  begin perform update_my_profile(p_bio => 'ciao' || chr(7)); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%caratteri non validi%' then raise; end if; end;
  begin perform update_my_profile(p_bio => E'1\n2\n3\n4\n5\n6'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%a capo%' then raise; end if; end;
  begin perform update_my_profile(p_display_name => 'Il Moderatore'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%non è disponibile%' then raise; end if; end;
  begin perform update_my_profile(p_avatar_path => '00000000-0000-0000-0000-000000000101/avatar-1700000000000.jpg'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%Foto non valida%' then raise; end if; end;
  -- Foto profilo: serve il controllo automatico con esito "ok" ("review" non basta).
  begin perform update_my_profile(p_avatar_path => '00000000-0000-0000-0000-000000000104/avatar-1700000000123.jpg'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%controllo automatico%' then raise; end if; end;
  perform test_ok('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104/avatar-1700000000123.jpg', 'avatar', 'review');
  begin perform update_my_profile(p_avatar_path => '00000000-0000-0000-0000-000000000104/avatar-1700000000123.jpg'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%controllo automatico%' then raise; end if; end;
  perform test_ok('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104/avatar-1700000000123.jpg', 'avatar');
  r := update_my_profile(p_display_name => '  Nuovo   Nome ', p_bio => E'Riga uno\nRiga due', p_avatar_path => '00000000-0000-0000-0000-000000000104/avatar-1700000000123.jpg');
  if r ->> 'display_name' <> 'Nuovo Nome' or r ->> 'avatar_path' is null then raise exception 'profilo non aggiornato: %', r; end if;
  begin perform update_my_profile(p_display_name => 'Altro Nome'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%7 giorni%' then raise; end if; end;
  -- Stesso nome di adesso: nessun cambio, nessun errore.
  perform update_my_profile(p_display_name => 'Nuovo Nome', p_bio => 'Bio nuova');
  raise notice 'ok, profilo: regole su nome, bio e foto (solo se controllata), nome una volta ogni 7 giorni';
end $$;
do $$ begin
  if (get_post('50000000-0000-0000-0000-000000000001') -> 'author' ->> 'avatar_path') is not null then null; end if;
  if not ((select get_profile('mod4')) -> 'profile' ? 'avatar_path') then raise exception 'avatar_path mancante nel profilo'; end if;
  raise notice 'ok, la foto profilo è nei dati degli autori';
end $$;
reset role;
do $$ begin
  if not (post_json('50000000-0000-0000-0000-000000000001', null) -> 'author' ? 'avatar_path') then raise exception 'avatar_path mancante in post_json'; end if;
  update identity_checks set status = 'missing', deadline = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-000000000104';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
do $$ begin perform update_my_profile(p_bio => 'x'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%verifica%' then raise; end if; raise notice 'ok, con la verifica scaduta il profilo non si modifica'; end $$;
reset role;
update identity_checks set status = 'approved' where user_id = '00000000-0000-0000-0000-000000000104';

-- ---------- Cerca persone (W16) ----------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000201'), ('00000000-0000-0000-0000-000000000202'), ('00000000-0000-0000-0000-000000000203'), ('00000000-0000-0000-0000-000000000204');
insert into profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-000000000201', 'giulia_viaggia', 'Giulia Ferri'),
  ('00000000-0000-0000-0000-000000000202', 'giuliano', 'Giuliano Bassi'),
  ('00000000-0000-0000-0000-000000000203', 'giuxlia', 'Altro Nome'),
  ('00000000-0000-0000-0000-000000000204', 'giulietta', 'Giulietta Espulsa');
update profiles set banned_at = now() where username = 'giulietta';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
select block_user('00000000-0000-0000-0000-000000000202');
do $$ declare u text[]; begin
  select array_agg(x ->> 'username') into u from search_profiles('@Giu') x;
  if not ('giulia_viaggia' = any (u)) then raise exception 'prefisso non trovato: %', u; end if;
  if 'giuliano' = any (u) then raise exception 'bloccato tra i risultati'; end if;
  if 'giulietta' = any (u) then raise exception 'espulso tra i risultati'; end if;
  select array_agg(x ->> 'username') into u from search_profiles('giu_') x;
  if u is not null and 'giuxlia' = any (u) then raise exception '"_" usato come jolly: %', u; end if;
  if (select count(*) from search_profiles('g')) <> 0 then raise exception 'risultati con un carattere'; end if;
  select array_agg(x ->> 'username') into u from search_profiles('ferri') x;
  if not ('giulia_viaggia' = any (u)) then raise exception 'ricerca per nome mostrato: %', u; end if;
  select array_agg(x ->> 'username') into u from search_profiles('mod4') x;
  if u is not null then raise exception 'si trova sé stessi'; end if;
  raise notice 'ok, ricerca persone: prefissi, "_" come lettera, niente bloccati, espulsi né sé stessi';
end $$;
reset role;

-- ---------- In gara: se il voto conta (W18) ----------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000301');
insert into profiles (id, username, display_name) values ('00000000-0000-0000-0000-000000000301', 'appena.iscritto', 'Appena I.');
insert into identity_checks (user_id, status, deadline) values ('00000000-0000-0000-0000-000000000301', 'approved', now());
set role authenticated;
do $$ declare v jsonb; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
  v := my_status() -> 'voter';
  if (v ->> 'can_vote')::boolean or v ->> 'from' is null then raise exception 'account appena creato: %', v; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
  v := my_status() -> 'voter';
  if not (v ->> 'can_vote')::boolean then raise exception 'account verificato di 10 giorni senza voto: %', v; end if;
  raise notice 'ok, my_status dice se il voto conta e da quando';
end $$;
reset role;

-- ---------- Codice di recupero della password (W20) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
create temp table recovery_code as select create_recovery_code() as code;
reset role;
do $$ declare c text := (select code from recovery_code); begin
  if c !~ '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$' then raise exception 'formato del codice: %', c; end if;
  if (select recovery_hash from profile_private where id = '00000000-0000-0000-0000-000000000102') like '%' || replace(c, '-', '') || '%' then raise exception 'codice salvato in chiaro'; end if;
  raise notice 'ok, codice di recupero nel formato giusto, salvato solo come impronta';
  perform set_config('virale.test_code', c, false);
end $$;
set role authenticated;
do $$ begin perform recovery_redeem('mod2', 'AAAA-AAAA-AAAA-AAAA'); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, il codice si usa solo dalla funzione (chiave di servizio)'; end $$;
reset role;
set role service_role;
do $$ declare c text := current_setting('virale.test_code'); begin
  if recovery_redeem('mod2', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ') is not null then raise exception 'codice sbagliato accettato'; end if;
  if recovery_redeem('nessuno', c) is not null then raise exception 'utente inesistente'; end if;
  -- Solo controllo, senza consumarlo (la funzione lo consuma dopo aver cambiato la password).
  if recovery_redeem('@MOD2', lower(c), false) is distinct from '00000000-0000-0000-0000-000000000102' then raise exception 'controllo del codice giusto'; end if;
  if recovery_redeem('mod2', c) is distinct from '00000000-0000-0000-0000-000000000102' then raise exception 'codice giusto rifiutato'; end if;
  if recovery_redeem('mod2', c) is not null then raise exception 'codice usato due volte'; end if;
  raise notice 'ok, il codice giusto vale una volta sola';
end $$;
do $$ declare i int; begin
  for i in 1..5 loop perform recovery_redeem('mod2', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ'); end loop;
  raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%Troppi tentativi%' then raise; end if; raise notice 'ok, dopo 5 tentativi sbagliati in un''ora si ferma'; end $$;
reset role;
drop table recovery_code;

-- ---------- Notifiche push (W21) ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000d0a1'), ('00000000-0000-0000-0000-00000000d0a2'), ('00000000-0000-0000-0000-00000000d0a3');
insert into profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-00000000d0a1', 'pusha', 'Push A'), ('00000000-0000-0000-0000-00000000d0a2', 'pushb', 'Push B'), ('00000000-0000-0000-0000-00000000d0a3', 'pushc', 'Push C');
update profiles set created_at = now() - interval '10 days' where username in ('pusha', 'pushb', 'pushc');
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username in ('pusha', 'pushb', 'pushc');
insert into posts (id, author_id, media, caption) values ('10000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0a1',
  test_media('00000000-0000-0000-0000-00000000d0a1', 'p.jpg'), 'Post di A');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', false);
do $$ begin perform register_push_token('token-a-caso', 'android'); raise exception 'NON DOVEVA PASSARE';
exception when others then if sqlerrm not like '%Token di notifica non valido%' then raise; end if; raise notice 'ok, token di notifica in un formato non valido rifiutato'; end $$;
select register_push_token('ExponentPushToken[telefonoA]', 'android');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a2', false);
select register_push_token('ExponentPushToken[telefonoA]', 'ios');
reset role;
do $$ begin
  if (select user_id from push_tokens where token = 'ExponentPushToken[telefonoA]') <> '00000000-0000-0000-0000-00000000d0a2' then raise exception 'token non riassegnato'; end if;
  raise notice 'ok, lo stesso telefono passa al nuovo account';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a2', false);
select register_push_token('ExponentPushToken[telefonoB]', 'ios');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', false);
select register_push_token('ExponentPushToken[telefonoA]', 'android');
do $$ begin perform push_claim(10); raise exception 'NON DOVEVA PASSARE';
exception when insufficient_privilege then raise notice 'ok, push_claim solo con la chiave di servizio'; end $$;
reset role;

-- B segue A: notifica push per A; un mi piace no.
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000d0a1');
insert into post_likes (user_id, post_id) values ('00000000-0000-0000-0000-00000000d0a2', '10000000-0000-0000-0000-00000000d0a1');
do $$ begin
  if not exists (select 1 from push_outbox where user_id = '00000000-0000-0000-0000-00000000d0a1' and kind = 'follow'
                   and title = 'Nuovo follower' and body = '@pushb ha iniziato a seguirti.' and url = '/utente/pushb') then
    raise exception 'push del follow mancante: %', (select jsonb_agg(o) from push_outbox o);
  end if;
  if exists (select 1 from push_outbox where kind = 'like') then raise exception 'push per un mi piace'; end if;
  raise notice 'ok, un follow crea una notifica push, un mi piace no';
end $$;
-- Con "Follower e commenti" spento: niente push.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', false);
do $$ begin
  if (set_push_prefs(true, true, false)->>'social')::boolean then raise exception 'preferenza non salvata'; end if;
end $$;
reset role;
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-00000000d0a3', '00000000-0000-0000-0000-00000000d0a1');
do $$ begin
  if exists (select 1 from push_outbox where user_id = '00000000-0000-0000-0000-00000000d0a1' and dedup like 'follow|00000000-0000-0000-0000-00000000d0a3|%') then
    raise exception 'push inviata con social = false';
  end if;
  raise notice 'ok, con "Follower e commenti" spento il follow non manda push';
end $$;
update push_prefs set social = true where user_id = '00000000-0000-0000-0000-00000000d0a1';
-- Un commento alle 23:30 (ora della gara) aspetta le 8 del mattino dopo.
do $$
declare
  v_tz text := (select time_zone from arena_config limit 1);
  v_at timestamptz := ((now() at time zone v_tz)::date + time '23:30') at time zone v_tz;
  v_nb timestamptz;
begin
  perform notify('00000000-0000-0000-0000-00000000d0a1', 'comment', '00000000-0000-0000-0000-00000000d0a3', '10000000-0000-0000-0000-00000000d0a1',
                 jsonb_build_object('body', repeat('bello ', 20)), v_at);
  select not_before into v_nb from push_outbox where user_id = '00000000-0000-0000-0000-00000000d0a1' and kind = 'comment';
  if v_nb is distinct from (((now() at time zone v_tz)::date + 1 + time '08:00') at time zone v_tz) then raise exception 'not_before %', v_nb; end if;
  if (select body from push_outbox where user_id = '00000000-0000-0000-0000-00000000d0a1' and kind = 'comment') not like '@pushc: “bello bello%…”' then
    raise exception 'testo del commento: %', (select body from push_outbox where kind = 'comment');
  end if;
  raise notice 'ok, una notifica delle 23:30 parte alle 8:00, il commento tagliato a 80 caratteri';
end $$;
-- Ogni copertina uscita ha la sua notifica "per tutti"; un giorno non ancora rivelato non si invia.
do $$ begin
  if (select count(*) from push_broadcasts) <> (select count(*) from daily_viral) or not exists (select 1 from push_broadcasts) then
    raise exception 'push_broadcasts % / daily_viral %', (select count(*) from push_broadcasts), (select count(*) from daily_viral);
  end if;
  raise notice 'ok, la chiusura del giorno crea la notifica della copertina per tutti';
end $$;
update push_broadcasts set done_at = now();
insert into push_broadcasts (featured_on) values (cover_day() + 1) on conflict (featured_on) do update set done_at = null, cursor = null;
set role service_role;
do $$ begin
  if exists (select 1 from push_broadcast_take(100) b where b.featured_on > cover_day()) then raise exception 'copertina non ancora uscita inviata'; end if;
  raise notice 'ok, la copertina di un giorno non ancora rivelato non si annuncia';
end $$;
reset role;
-- Più di 3 notifiche in attesa per la stessa persona diventano una sola; chi non ha telefoni: chiuse.
insert into push_outbox (user_id, kind, title, body, url, not_before)
select '00000000-0000-0000-0000-00000000d0a2', 'follow', 'T' || i, 'B' || i, '/', now() - interval '1 minute' from generate_series(1, 4) i;
insert into push_outbox (user_id, kind, title, body, url, not_before) values ('00000000-0000-0000-0000-00000000d0a3', 'follow', 'T', 'B', '/', now() - interval '1 minute');
set role service_role;
create temp table claimed as select * from push_claim(500);
reset role;
do $$ begin
  if not exists (select 1 from claimed where title = 'Novità su Virale' and body = 'Hai 4 nuove notifiche.' and cardinality(ids) = 4
                   and tokens = array['ExponentPushToken[telefonoB]']) then
    raise exception 'raggruppamento: %', (select jsonb_agg(c) from claimed c);
  end if;
  if exists (select 1 from push_outbox where user_id = '00000000-0000-0000-0000-00000000d0a3' and sent_at is null) then raise exception 'riga senza telefono non chiusa'; end if;
  raise notice 'ok, più di 3 notifiche in attesa diventano una sola; senza telefono la riga si chiude';
end $$;
set role service_role;
select push_done((select array_agg(x) from claimed, unnest(ids) x));
select push_drop_tokens(array['ExponentPushToken[telefonoB]']);
reset role;
do $$ begin
  if exists (select 1 from push_outbox o join claimed c on o.id = any(c.ids) where o.sent_at is null) then raise exception 'push_done'; end if;
  if exists (select 1 from push_tokens where token = 'ExponentPushToken[telefonoB]') then raise exception 'push_drop_tokens'; end if;
  raise notice 'ok, push_done segna le inviate e push_drop_tokens dimentica i telefoni';
end $$;
drop table claimed;

-- ---------- Completamento dei video: non si ottiene trascinando la barra (W12) ----------
insert into posts (id, author_id, media, caption) values ('10000000-0000-0000-0000-00000000d0a3', '00000000-0000-0000-0000-00000000d0a3',
  jsonb_build_array(jsonb_build_object('kind', 'video', 'url', 'https://proj.supabase.co/storage/v1/object/public/media/00000000-0000-0000-0000-00000000d0a3/v.mp4',
                                       'width', 720, 'height', 1280, 'duration_ms', 30000)), 'Video di 30 secondi');
insert into arena_entries (id, contest_day, post_id, author_id)
values ('20000000-0000-0000-0000-00000000d0a3', arena_today(), '10000000-0000-0000-0000-00000000d0a3', '00000000-0000-0000-0000-00000000d0a3');
insert into arena_views (entry_id, viewer_id, contest_day)
select '20000000-0000-0000-0000-00000000d0a3', id, arena_today() from profiles where username in ('pusha', 'pushb');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', false);
select arena_record_view('20000000-0000-0000-0000-00000000d0a3', 2000, true, true);
reset role;
do $$ begin
  if (select coalesce(sum(completes), 0) + coalesce(sum(rewatches), 0) from arena_entry_stats where entry_id = '20000000-0000-0000-0000-00000000d0a3') <> 0 then
    raise exception 'video di 30 s completato in 2 s';
  end if;
  if (select coalesce(sum(views), 0) from arena_entry_stats where entry_id = '20000000-0000-0000-0000-00000000d0a3') <> 1 then raise exception 'vista non contata'; end if;
  raise notice 'ok, un video di 30 secondi "completato" in 2 non conta come completato né rivisto';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a2', false);
select arena_record_view('20000000-0000-0000-0000-00000000d0a3', 20000, true, true);
reset role;
do $$ begin
  if (select sum(completes) from arena_entry_stats where entry_id = '20000000-0000-0000-0000-00000000d0a3') <> 1 then raise exception 'completamento vero non contato'; end if;
  if (select sum(rewatches) from arena_entry_stats where entry_id = '20000000-0000-0000-0000-00000000d0a3') <> 0 then raise exception 'rivisto senza un giro intero'; end if;
  raise notice 'ok, con 20 secondi su 30 il completamento conta (il rivisto no)';
end $$;

-- ---------- "Non mi interessa" (W33) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', false);
select not_interested('10000000-0000-0000-0000-00000000d0a3');
reset role;
do $$ begin
  if (select score from user_interests where user_id = '00000000-0000-0000-0000-00000000d0a1' and key = 'a:00000000-0000-0000-0000-00000000d0a3') >= 0 then
    raise exception 'gusto per l''autore non sceso';
  end if;
  if not exists (select 1 from seen_posts where user_id = '00000000-0000-0000-0000-00000000d0a1' and post_id = '10000000-0000-0000-0000-00000000d0a3') then
    raise exception 'post non segnato come visto';
  end if;
  raise notice 'ok, "Non mi interessa" abbassa il gusto per l''autore e toglie il post da Esplora';
end $$;

-- ---------- Rilascio: file dei post rimossi, notifiche, segnalazioni, nomi ----------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000007ee1'), ('00000000-0000-0000-0000-000000007ee2'),
  ('00000000-0000-0000-0000-000000007ee3'), ('00000000-0000-0000-0000-000000007ee4');
insert into profiles (id, username, display_name) values
  ('00000000-0000-0000-0000-000000007ee1', 'relea', 'Rel A'), ('00000000-0000-0000-0000-000000007ee2', 'releb', 'Rel B'),
  ('00000000-0000-0000-0000-000000007ee3', 'relec', 'Rel C'), ('00000000-0000-0000-0000-000000007ee4', 'reled', 'Rel D');
update profiles set created_at = now() - interval '10 days' where username in ('relea', 'releb', 'relec', 'reled');
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username in ('relea', 'releb', 'relec', 'reled');
insert into posts (id, author_id, media, caption) values
  ('10000000-0000-0000-0000-000000007ee1', '00000000-0000-0000-0000-000000007ee1', test_media('00000000-0000-0000-0000-000000007ee1', 'rimosso.jpg'), 'Da rimuovere'),
  ('10000000-0000-0000-0000-000000007ee2', '00000000-0000-0000-0000-000000007ee2', test_media('00000000-0000-0000-0000-000000007ee2', 'espulso.jpg'), 'Di un espulso'),
  ('10000000-0000-0000-0000-000000007ee3', '00000000-0000-0000-0000-000000007ee3', test_media('00000000-0000-0000-0000-000000007ee3', 'nascosto.jpg'), 'Nascosto in attesa di revisione'),
  ('10000000-0000-0000-0000-000000007ee4', '00000000-0000-0000-0000-000000007ee3', test_media('00000000-0000-0000-0000-000000007ee3', 'visibile.jpg'), 'Visibile');
-- Post rimosso dalla moderazione, utente espulso, post nascosto solo dalle segnalazioni (può tornare visibile).
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  perform mod_resolve('10000000-0000-0000-0000-000000007ee1', 'remove');
  perform mod_ban_user('00000000-0000-0000-0000-000000007ee2');
  update posts set hidden_at = now(), hidden_reason = 'segnalazioni' where id = '10000000-0000-0000-0000-000000007ee3';
  insert into storage_purge (bucket, path) values ('media', '00000000-0000-0000-0000-000000007ee3/nascosto.jpg'), ('media', '00000000-0000-0000-0000-000000007ee3/visibile.jpg');
end $$;
set role service_role;
do $$ declare paths text[]; begin
  select array_agg(path) into paths from storage_purge_take(1000);
  if not ('00000000-0000-0000-0000-000000007ee1/rimosso.jpg' = any (paths)) then raise exception 'file del post rimosso non cancellato: %', paths; end if;
  if not ('00000000-0000-0000-0000-000000007ee2/espulso.jpg' = any (paths)) then raise exception 'file dell''espulso non cancellato: %', paths; end if;
  if '00000000-0000-0000-0000-000000007ee3/nascosto.jpg' = any (paths) or '00000000-0000-0000-0000-000000007ee3/visibile.jpg' = any (paths) then
    raise exception 'cancellato il file di un post che può tornare visibile';
  end if;
  raise notice 'ok, la pulizia programmata cancella i file dei post rimossi e degli espulsi, non quelli in revisione';
end $$;
reset role;

-- Notifiche push che hanno perso senso prima dell'invio: commento cancellato, autore bloccato o espulso.
insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[telefonoE3]', '00000000-0000-0000-0000-000000007ee3', 'android');
insert into comments (id, post_id, user_id, body) values ('51000000-0000-0000-0000-000000007ee1', '10000000-0000-0000-0000-000000007ee4', '00000000-0000-0000-0000-000000007ee1', 'Ciao');
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-000000007ee4', '00000000-0000-0000-0000-000000007ee3');
select notify('00000000-0000-0000-0000-000000007ee3', 'follow', '00000000-0000-0000-0000-000000007ee2', null);
insert into follows (follower_id, followee_id) values ('00000000-0000-0000-0000-000000007ee1', '00000000-0000-0000-0000-000000007ee3');
delete from comments where id = '51000000-0000-0000-0000-000000007ee1';
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-000000007ee3', '00000000-0000-0000-0000-000000007ee4');
update push_outbox set not_before = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000007ee3';
do $$ begin
  if (select count(*) from push_outbox where user_id = '00000000-0000-0000-0000-000000007ee3' and sent_at is null) <> 4 then
    raise exception 'notifiche in coda: %', (select jsonb_agg(o) from push_outbox o where user_id = '00000000-0000-0000-0000-000000007ee3');
  end if;
end $$;
set role service_role;
create temp table claimed2 as select * from push_claim(500);
reset role;
do $$ begin
  if (select count(*) from claimed2 where tokens = array['ExponentPushToken[telefonoE3]']) <> 1
     or not exists (select 1 from claimed2 where tokens = array['ExponentPushToken[telefonoE3]'] and body = '@relea ha iniziato a seguirti.') then
    raise exception 'inviate: %', (select jsonb_agg(c) from claimed2 c);
  end if;
  if exists (select 1 from push_outbox where user_id = '00000000-0000-0000-0000-000000007ee3' and sent_at is null
               and actor_id <> '00000000-0000-0000-0000-000000007ee1') then raise exception 'notifiche saltate non chiuse'; end if;
  raise notice 'ok, all''invio si saltano commenti cancellati, autori bloccati ed espulsi';
end $$;
drop table claimed2;
-- Password cambiata con il codice: nessun telefono riceve più le notifiche; cambio dall'app: resta solo questo.
do $$ begin
  perform revoke_sessions('00000000-0000-0000-0000-000000007ee3');
  if exists (select 1 from push_tokens where user_id = '00000000-0000-0000-0000-000000007ee3') then raise exception 'token rimasti dopo il recupero'; end if;
end $$;
insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[questo]', '00000000-0000-0000-0000-000000007ee3', 'android'),
  ('ExponentPushToken[perso]', '00000000-0000-0000-0000-000000007ee3', 'ios');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000007ee3', false);
select drop_other_push_tokens('ExponentPushToken[questo]');
reset role;
do $$ begin
  if (select array_agg(token) from push_tokens where user_id = '00000000-0000-0000-0000-000000007ee3') <> array['ExponentPushToken[questo]'] then
    raise exception 'token dopo il cambio di password: %', (select array_agg(token) from push_tokens where user_id = '00000000-0000-0000-0000-000000007ee3');
  end if;
  raise notice 'ok, cambiando la password i telefoni degli altri accessi non ricevono più notifiche';
end $$;

-- Un commento con spazi in coda si segnala (la copia del testo resta entro il limite).
insert into comments (id, post_id, user_id, body) values ('51000000-0000-0000-0000-000000007ee2', '10000000-0000-0000-0000-000000007ee4',
  '00000000-0000-0000-0000-000000007ee1', 'Brutto' || repeat(' ', 2500));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000007ee3', false);
select report_comment('51000000-0000-0000-0000-000000007ee2', 'spam', 'Nota di chi segnala');
reset role;
do $$ begin
  if (select snapshot ->> 'body' from user_reports where comment_id = '51000000-0000-0000-0000-000000007ee2') is distinct from 'Brutto' then
    raise exception 'copia del commento: %', (select snapshot from user_reports where comment_id = '51000000-0000-0000-0000-000000007ee2');
  end if;
  raise notice 'ok, commento con spazi in coda segnalabile, copia senza spazi';
end $$;
-- Account eliminato: la copia del suo commento nelle segnalazioni sparisce.
delete from auth.users where id = '00000000-0000-0000-0000-000000007ee1';
do $$ begin
  if exists (select 1 from user_reports where reporter_id = '00000000-0000-0000-0000-000000007ee3' and kind = 'comment' and snapshot <> '{}'::jsonb) then
    raise exception 'copia rimasta dopo l''eliminazione dell''account';
  end if;
  raise notice 'ok, eliminando l''account si cancellano le copie nelle segnalazioni';
end $$;
-- Segnalazioni chiuse da più di 12 mesi: cancellate; quelle aperte o recenti restano.
insert into reports (id, post_id, reporter_id, reason, status, resolved_at) values
  ('7e000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000007ee4', '00000000-0000-0000-0000-000000007ee4', 'spam', 'dismissed', now() - interval '13 months'),
  ('7e000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000007ee3', '00000000-0000-0000-0000-000000007ee4', 'spam', 'dismissed', now() - interval '1 month'),
  ('7e000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000007ee2', '00000000-0000-0000-0000-000000007ee4', 'spam', 'open', null);
update user_reports set status = 'dismissed', resolved_at = now() - interval '13 months' where reporter_id = '00000000-0000-0000-0000-000000007ee3' and kind = 'comment';
do $$ begin
  perform reports_retention();
  if exists (select 1 from reports where id = '7e000000-0000-0000-0000-000000000001')
     or exists (select 1 from user_reports where reporter_id = '00000000-0000-0000-0000-000000007ee3' and kind = 'comment') then
    raise exception 'segnalazione chiusa da più di 12 mesi rimasta';
  end if;
  if (select count(*) from reports where id in ('7e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-000000000003')) <> 2 then
    raise exception 'cancellata una segnalazione recente o aperta';
  end if;
  raise notice 'ok, segnalazioni chiuse da più di 12 mesi cancellate';
end $$;

-- Nomi da staff e caratteri invisibili: né alla registrazione né cambiando il nome.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000007ee5', 'nomi.veri@utenti.virale.invalid');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000007ee5', false);
do $$ declare n text[]; begin
  foreach n slice 1 in array array[['Staff', 'Rossi'], ['V1rale', 'Rossi'], ['Ad.min', 'Bianchi'], ['Moderatore', 'Verdi'], ['Àmministratore', 'Neri']] loop
    begin
      perform complete_registration('nomi.veri', n[1], n[2], '1990-01-01', true);
      raise exception 'NON DOVEVA PASSARE: %', n;
    exception when others then if sqlerrm not like '%non è disponibile%' then raise; end if; end;
  end loop;
  foreach n slice 1 in array array[[E'Ma​rio', 'Rossi'], [E'Mario\nStaff', 'Rossi'], ['Mario', E'‮Rossi']] loop
    begin
      perform complete_registration('nomi.veri', n[1], n[2], '1990-01-01', true);
      raise exception 'NON DOVEVA PASSARE: %', n;
    exception when others then if sqlerrm not like '%caratteri non validi%' then raise; end if; end;
  end loop;
  perform complete_registration('nomi.veri', 'Mario', 'Rossi', '1990-01-01', true);
  foreach n slice 1 in array array[['S t a f f', 'x'], ['M0derat0re', 'x'], ['Vìrale ufficiale', 'x']] loop
    begin
      perform update_my_profile(n[1]);
      raise exception 'NON DOVEVA PASSARE: %', n;
    exception when others then if sqlerrm not like '%non è disponibile%' then raise; end if; end;
  end loop;
  raise notice 'ok, niente nomi da staff né caratteri invisibili, alla registrazione e dopo';
end $$;
reset role;

-- ---------- Controllo automatico dei contenuti prima della pubblicazione (media_checks) ----------
-- c1 e c2 pubblicano, c3 è l'amministratore. Gli esiti li scrive la funzione verifica-eta (service_role).
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000c0de'||i)::uuid from generate_series(1,3) i;
insert into profiles (id, username, display_name) select id, 'controllo'||right(id::text,1), 'Controllo C.' from auth.users where id::text like '00000000-0000-0000-0000-0000000c0de%';
update profiles set created_at = now() - interval '10 days' where username like 'controllo%';
update profiles set is_admin = true where username = 'controllo3';
insert into identity_checks (user_id, status, deadline) select id, 'approved', now() from profiles where username like 'controllo%';
create function test_url(p_uid uuid, p_name text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('kind', 'image', 'url', 'https://proj.supabase.co/storage/v1/object/public/media/' || p_uid || '/' || p_name, 'width', 1080, 'height', 1620))
$$;

-- Nessuno dall'app legge o scrive gli esiti, né chiama le funzioni riservate alla funzione verifica-eta.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de1', false);
do $$ begin
  begin
    insert into media_checks (kind, path, owner_id, verdict) values ('file', '00000000-0000-0000-0000-0000000c0de1/finto.jpg', auth.uid(), 'ok');
    raise exception 'NON DOVEVA PASSARE';
  exception when insufficient_privilege then null; end;
  begin perform 1 from media_checks; raise exception 'NON DOVEVA PASSARE'; exception when insufficient_privilege then null; end;
  begin
    perform media_check_save(auth.uid(), '[{"kind":"file","path":"00000000-0000-0000-0000-0000000c0de1/finto.jpg","verdict":"ok"}]');
    raise exception 'NON DOVEVA PASSARE';
  exception when insufficient_privilege then null; end;
  begin perform media_check_start(auth.uid(), 'file', array['00000000-0000-0000-0000-0000000c0de1/finto.jpg']); raise exception 'NON DOVEVA PASSARE';
  exception when insufficient_privilege then null; end;
  raise notice 'ok, authenticated non legge né scrive media_checks';
end $$;
reset role;
set role anon;
do $$ begin
  begin insert into media_checks (kind, path, owner_id, verdict) values ('file', 'x/y.jpg', '00000000-0000-0000-0000-0000000c0de1', 'ok'); raise exception 'NON DOVEVA PASSARE';
  exception when insufficient_privilege then null; end;
  raise notice 'ok, anon non scrive media_checks';
end $$;
reset role;

-- La funzione (service_role, senza utente nel token): solo file di chi chiama e non già pubblicati; poi salva gli esiti.
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
do $$ declare ids jsonb; begin
  begin perform media_check_start('00000000-0000-0000-0000-0000000c0de1', 'file', array['00000000-0000-0000-0000-0000000c0de2/altrui.jpg']); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%non valida%' then raise; end if; end;
  ids := media_check_start('00000000-0000-0000-0000-0000000c0de1', 'file', array['00000000-0000-0000-0000-0000000c0de1/ok.jpg', '00000000-0000-0000-0000-0000000c0de1/dubbio.jpg']);
  if not ids ? '00000000-0000-0000-0000-0000000c0de1/ok.jpg' then raise exception 'media_check_start: %', ids; end if;
  perform media_check_save('00000000-0000-0000-0000-0000000c0de1', jsonb_build_array(
    jsonb_build_object('kind', 'file', 'path', '00000000-0000-0000-0000-0000000c0de1/ok.jpg', 'verdict', 'ok', 'scores', '{"sexual":0.01}'::jsonb),
    jsonb_build_object('kind', 'file', 'path', '00000000-0000-0000-0000-0000000c0de1/dubbio.jpg', 'verdict', 'review', 'categories', '["sexual"]'::jsonb, 'scores', '{"sexual":0.42}'::jsonb),
    jsonb_build_object('kind', 'file', 'path', '00000000-0000-0000-0000-0000000c0de1/vietato.jpg', 'verdict', 'blocked', 'categories', '["violence/graphic"]'::jsonb),
    jsonb_build_object('kind', 'caption', 'caption', 'Ciao a tutti', 'verdict', 'ok'),
    jsonb_build_object('kind', 'caption', 'caption', 'Didascalia dubbia', 'verdict', 'review', 'categories', '["harassment"]'::jsonb)));
  begin perform media_check_save('00000000-0000-0000-0000-0000000c0de1', '[{"kind":"file","path":"00000000-0000-0000-0000-0000000c0de2/x.jpg","verdict":"ok"}]'); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%non valida%' then raise; end if; end;
  raise notice 'ok, la funzione salva gli esiti solo nella cartella di chi chiama';
end $$;
reset role;
-- Un esito di un altro utente sullo stesso percorso (non deve contare).
insert into media_checks (kind, path, owner_id, verdict) values ('file', '00000000-0000-0000-0000-0000000c0de1/altrui.jpg', '00000000-0000-0000-0000-0000000c0de2', 'ok');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de1', false);
do $$ declare v uuid; w uuid; begin
  begin insert into posts (author_id, media) values (auth.uid(), test_url(auth.uid(), 'mai-controllato.jpg')); raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then if sqlerrm not like '%non è stato controllato%' then raise; end if; end;
  begin insert into posts (author_id, media) values (auth.uid(), test_url(auth.uid(), 'altrui.jpg')); raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then if sqlerrm not like '%non è stato controllato%' then raise; end if; end;
  begin insert into posts (author_id, media) values (auth.uid(), test_url(auth.uid(), 'vietato.jpg')); raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then if sqlerrm not like '%non è stato controllato%' then raise; end if; end;
  -- File controllato, didascalia no (o diversa da quella controllata): rifiutato.
  begin insert into posts (author_id, media, caption) values (auth.uid(), test_url(auth.uid(), 'ok.jpg'), 'Ciao a tutti!'); raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then if sqlerrm not like '%non è stato controllato%' then raise; end if; end;
  -- Un post con un file "blocked" in mezzo a file buoni: rifiutato.
  begin insert into posts (author_id, media) values (auth.uid(), test_url(auth.uid(), 'ok.jpg') || test_url(auth.uid(), 'vietato.jpg')); raise exception 'NON DOVEVA PASSARE';
  exception when check_violation then if sqlerrm not like '%non è stato controllato%' then raise; end if; end;
  raise notice 'ok, post senza controllo, con il controllo di un altro, bloccato o con didascalia diversa: rifiutati';

  -- "ok": visibile subito e candidabile.
  insert into posts (author_id, media, caption) values (auth.uid(), test_url(auth.uid(), 'ok.jpg'), 'Ciao a tutti') returning id into v;
  if (select hidden_at from posts where id = v) is not null then raise exception 'post ok nascosto'; end if;
  perform arena_submit(v);
  raise notice 'ok, esito ok: post visibile e candidabile';

  -- "review": il post si crea nascosto e non si candida.
  insert into posts (author_id, media) values (auth.uid(), test_url(auth.uid(), 'dubbio.jpg')) returning id into w;
  if (select hidden_reason from posts where id = w) is distinct from 'revisione' or (select hidden_at from posts where id = w) is null then
    raise exception 'post in revisione non nascosto';
  end if;
  if get_post(w) is null then raise exception 'l''autore deve vedere il suo post in revisione'; end if;
  begin perform arena_submit(w); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%in revisione%' then raise; end if; end;
  raise notice 'ok, esito review: post nascosto, visibile solo all''autore, non candidabile';
end $$;
-- Didascalia "review" con un file ok: nascosto anche lui.
reset role;
select test_ok('00000000-0000-0000-0000-0000000c0de1', 'ok2.jpg');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de1', false);
do $$ declare v uuid; begin
  insert into posts (author_id, media, caption) values (auth.uid(), test_url(auth.uid(), 'ok2.jpg'), 'Didascalia dubbia') returning id into v;
  if (select hidden_reason from posts where id = v) is distinct from 'revisione' then raise exception 'didascalia in revisione: post non nascosto'; end if;
  raise notice 'ok, didascalia da rivedere: post nascosto';
end $$;
-- Gli altri non lo vedono.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de2', false);
do $$ begin
  if exists (select 1 from posts where author_id = '00000000-0000-0000-0000-0000000c0de1' and hidden_reason = 'revisione') then raise exception 'post in revisione leggibile da altri'; end if;
  if get_post((select id from posts where author_id = '00000000-0000-0000-0000-0000000c0de1' and media @> test_url('00000000-0000-0000-0000-0000000c0de1', 'ok.jpg'))) is null then
    raise exception 'post ok non visibile agli altri';
  end if;
  begin perform mod_queue(); raise exception 'NON DOVEVA PASSARE'; exception when others then if sqlerrm not like '%moderatori%' then raise; end if; end;
  raise notice 'ok, un post in revisione non lo vede nessun altro';
end $$;
-- L'amministratore lo trova in coda, con il motivo, e lo approva (diventa visibile) o lo rimuove.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de3', false);
do $$ declare q jsonb; n int; v uuid; c uuid; begin
  select count(*) into n from mod_queue() x where x ? 'review' and x -> 'post' -> 'author' ->> 'username' = 'controllo1';
  if n <> 2 then raise exception 'coda di revisione: % post invece di 2', n; end if;
  select x into q from mod_queue() x where x ? 'review' and x -> 'review' -> 'categories' ? 'sexual';
  if q is null then raise exception 'motivo della revisione mancante'; end if;
  v := (q -> 'post' ->> 'id')::uuid;
  perform mod_resolve(v, 'dismiss');
  if (select hidden_at from posts where id = v) is not null then raise exception 'post approvato ancora nascosto'; end if;
  select (x -> 'post' ->> 'id')::uuid into c from mod_queue() x where x ? 'review';
  perform mod_resolve(c, 'remove');
  if (select hidden_reason from posts where id = c) <> 'moderazione' then raise exception 'post rimosso non rimosso'; end if;
  if exists (select 1 from mod_queue() x where x ? 'review') then raise exception 'coda di revisione non vuota'; end if;
  raise notice 'ok, coda di revisione: Approva rende visibile, Rimuovi toglie e cancella i file';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0de2', false);
do $$ begin
  if get_post((select id from posts where author_id = '00000000-0000-0000-0000-0000000c0de1' and media @> test_url('00000000-0000-0000-0000-0000000c0de1', 'dubbio.jpg'))) is null then
    raise exception 'post approvato non visibile agli altri';
  end if;
  raise notice 'ok, post approvato visibile a tutti';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select data ->> 'reason' from notifications where user_id = '00000000-0000-0000-0000-0000000c0de1' and kind = 'removed' limit 1) is distinct from 'molestie' then
    raise exception 'motivo della rimozione: %', (select data from notifications where user_id = '00000000-0000-0000-0000-0000000c0de1' and kind = 'removed' limit 1);
  end if;
  if not exists (select 1 from storage_purge where path = '00000000-0000-0000-0000-0000000c0de1/ok2.jpg') then raise exception 'file del post rimosso non in pulizia'; end if;
  -- Un file pubblicato non si ricontrolla (un esito nuovo potrebbe cancellarlo).
  begin perform media_check_start('00000000-0000-0000-0000-0000000c0de1', 'file', array['00000000-0000-0000-0000-0000000c0de1/ok.jpg']); raise exception 'NON DOVEVA PASSARE';
  exception when others then if sqlerrm not like '%già pubblicato%' then raise; end if; end;
  raise notice 'ok, rimozione notificata con il motivo del controllo; file pubblicati non ricontrollabili';
end $$;
-- Gli esiti di file non pubblicati si cancellano dopo 7 giorni (pulizia notturna); quelli dei post restano.
update media_checks set checked_at = now() - interval '8 days' where owner_id = '00000000-0000-0000-0000-0000000c0de1';
do $$ begin
  perform reports_retention();
  if exists (select 1 from media_checks where owner_id = '00000000-0000-0000-0000-0000000c0de1' and path like '%vietato.jpg') then raise exception 'esito di un file mai pubblicato rimasto'; end if;
  if exists (select 1 from media_checks where owner_id = '00000000-0000-0000-0000-0000000c0de1' and kind = 'caption') then raise exception 'esito di una didascalia rimasto'; end if;
  if not exists (select 1 from media_checks where path = '00000000-0000-0000-0000-0000000c0de1/ok.jpg') then raise exception 'esito di un file pubblicato cancellato'; end if;
  raise notice 'ok, esiti del controllo: restano solo quelli dei file pubblicati';
end $$;
