-- Virale · configurazione di produzione su Supabase.
-- Esegui DOPO schema.sql, nel SQL Editor del progetto (una volta sola; rieseguirlo non fa danni).
-- Contiene ciò che dipende da Supabase e quindi non sta nei test locali: Storage e pg_cron.

-- 1) Bucket pubblico "media" per foto e video: massimo 50 MB a file, solo immagini e video.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Quanti file ha già chi carica, in un bucket (per i limiti qui sotto): in tutto, e nelle ultime 24 ore.
create or replace function public.my_object_count(p_bucket text)
returns bigint language sql stable security definer set search_path = storage, public, pg_temp as $$
  select count(*) from storage.objects where bucket_id = p_bucket and (storage.foldername(name))[1] = auth.uid()::text;
$$;
create or replace function public.my_recent_object_count(p_bucket text)
returns bigint language sql stable security definer set search_path = storage, public, pg_temp as $$
  select count(*) from storage.objects
   where bucket_id = p_bucket and (storage.foldername(name))[1] = auth.uid()::text and created_at > now() - interval '24 hours';
$$;
revoke execute on function public.my_object_count(text) from public, anon;
grant execute on function public.my_object_count(text) to authenticated;
revoke execute on function public.my_recent_object_count(text) from public, anon;
grant execute on function public.my_recent_object_count(text) to authenticated;

-- 2) Ognuno scrive, elenca e cancella solo nella propria cartella (<id utente>/...).
--    Leggere i file è pubblico (bucket pubblico), serve per mostrarli nell'app.
--    Caricare richiede un profilo che può pubblicare (niente account "vuoti" usati come hosting) e ha un tetto.
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
              -- Un tetto giornaliero (non per sempre): pubblicare tanto va bene, usare l'app come hosting no.
              and public.can_act(auth.uid()) and public.my_recent_object_count('media') < 200);

drop policy if exists "media list own folder" on storage.objects;
create policy "media list own folder" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media delete own" on storage.objects;
-- Ognuno cancella i propri file che non sono in un post (caricamenti falliti, post eliminati): il file di un
-- post pubblicato non si cancella né si sostituisce, così dopo la moderazione il contenuto non cambia.
-- L'amministratore cancella i file in coda di pulizia (post rimossi, account chiusi o eliminati).
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (((storage.foldername(name))[1] = auth.uid()::text and not public.media_in_use(name))
                                  or public.is_admin(auth.uid())));
-- Nessuna regola di UPDATE sul bucket media: un file caricato non si sovrascrive.
drop policy if exists "media update own" on storage.objects;

-- 2b) Bucket PRIVATO "documenti" per la verifica dell'età: 10 MB a file, solo immagini.
--     Ognuno carica nella propria cartella; leggono solo l'interessato e gli amministratori;
--     l'app dell'amministratore cancella i file appena presa la decisione.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documenti', 'documenti', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documenti upload own" on storage.objects;
create policy "documenti upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti' and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_active(auth.uid()) and public.my_object_count('documenti') < 6);
drop policy if exists "documenti read own or admin" on storage.objects;
create policy "documenti read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'documenti' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid())));
drop policy if exists "documenti delete own or admin" on storage.objects;
create policy "documenti delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'documenti' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid())));

-- 3) Chiusura della gara: ogni minuto si controlla se è passato l'orario della copertina (scelto
--    dall'amministratore, ora di Roma). Appena passa, la gara chiude, si sceglie il vincitore e la nuova
--    copertina esce. Negli altri minuti non fa nulla (una lettura).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('arena-close-day', 'virale-pulizia', 'virale-lavori');
-- Solo la chiusura: da sola, così un errore nelle pulizie non può annullarla.
select cron.schedule('arena-close-day', '* * * * *', $$ select public.arena_close_due() $$);

-- Pulizie, una volta al giorno alle 3:17 UTC, in un'operazione separata.
select cron.schedule(
  'virale-pulizia',
  '17 3 * * *',
  $$ delete from public.post_views where day < (select public.arena_today()) - 1;
     delete from public.rate_events where at < now() - interval '1 day';
     delete from cron.job_run_details where end_time < now() - interval '2 days';
     delete from public.notifications where created_at < now() - interval '90 days';
     delete from public.seen_posts where seen_at < now() - interval '30 days';
     delete from public.user_interests where updated_at < now() - interval '120 days';
     -- File caricati da più di un giorno e mai usati in un post (pubblicazione interrotta): in pulizia.
     insert into public.storage_purge (bucket, path)
     select o.bucket_id, o.name from storage.objects o
      where o.bucket_id = 'media' and o.created_at between now() - interval '3 days' and now() - interval '1 day'
        and not public.media_in_use(o.name)
     on conflict do nothing;
     -- Documenti rimasti senza una verifica in attesa (invio fallito): dopo un giorno, in pulizia.
     insert into public.storage_purge (bucket, path)
     select o.bucket_id, o.name from storage.objects o
      where o.bucket_id = 'documenti' and o.created_at < now() - interval '1 day'
        and not exists (select 1 from public.identity_checks i where i.status = 'pending' and o.name in (i.document_path, i.selfie_path))
     on conflict do nothing;
     -- Foto profilo caricate da più di un giorno e non usate da nessun profilo (cambiate o mai salvate): in pulizia.
     insert into public.storage_purge (bucket, path)
     select o.bucket_id, o.name from storage.objects o
      where o.bucket_id = 'avatars' and o.created_at < now() - interval '1 day'
        and not exists (select 1 from public.profiles p where p.avatar_path = o.name)
     on conflict do nothing;
     -- Utenti di accesso rimasti senza profilo (registrazione interrotta) dopo un giorno: liberano il nome.
     delete from auth.users u where u.created_at < now() - interval '1 day'
       and not exists (select 1 from public.profiles p where p.id = u.id) $$
);

-- 3b) Lavori ogni minuto: la funzione verifica-eta (rotta /lavori) cancella dallo Storage i file rimossi dalla
--     moderazione o di account chiusi (e, con le notifiche push configurate, le invia). Parte solo dopo aver
--     creato i due segreti nel Vault (vedi PUBBLICARE.md):
--       select vault.create_secret('https://<il-tuo-progetto>.supabase.co', 'virale_url');
--       select vault.create_secret('<stringa segreta lunga>', 'virale_cron_secret');
--     e il segreto VIRALE_CRON_SECRET (stesso valore) nella funzione. Senza, ogni minuto non fa nulla.
create extension if not exists pg_net;
select cron.schedule('virale-lavori', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'virale_url') || '/functions/v1/verifica-eta/lavori',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-virale-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'virale_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from vault.decrypted_secrets where name = 'virale_cron_secret')
    and exists (select 1 from vault.decrypted_secrets where name = 'virale_url') $$);

-- 4) Amministratore: DOPO esserti registrato dall'app, togli i due trattini e metti il tuo nome utente.
--    L'amministratore modera, verifica i documenti e sceglie l'orario della copertina.
-- update public.profiles set is_admin = true where username = 'il_tuo_username';
