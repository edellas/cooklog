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

-- Quanti file ha già chi carica, in un bucket (per i limiti qui sotto).
create or replace function public.my_object_count(p_bucket text)
returns bigint language sql stable security definer set search_path = storage, public, pg_temp as $$
  select count(*) from storage.objects where bucket_id = p_bucket and (storage.foldername(name))[1] = auth.uid()::text;
$$;
revoke execute on function public.my_object_count(text) from public, anon;
grant execute on function public.my_object_count(text) to authenticated;

-- 2) Ognuno scrive, elenca e cancella solo nella propria cartella (<id utente>/...).
--    Leggere i file è pubblico (bucket pubblico), serve per mostrarli nell'app.
--    Caricare richiede un profilo che può pubblicare (niente account "vuoti" usati come hosting) e ha un tetto.
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
              and public.can_act(auth.uid()) and public.my_object_count('media') < 1000);

drop policy if exists "media list own folder" on storage.objects;
create policy "media list own folder" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media delete own" on storage.objects;
-- L'amministratore cancella i file di post di account chiusi o eliminati (coda storage_purge).
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid())));

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

-- 3) Chiusura della giornata a mezzanotte (ora di Roma): sceglie la Copertina.
--    pg_cron ragiona in UTC: la mezzanotte italiana è alle 22:00 UTC d'estate e alle 23:00 UTC d'inverno.
--    Gira un minuto dopo entrambe: una delle due è la mezzanotte giusta, l'altra non fa nulla
--    (la giornata è già chiusa). Così la nuova copertina esce al minuto 00:01 tutto l'anno.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'arena-close-day';
select cron.schedule(
  'arena-close-day',
  '1 22,23 * * *',
  $$ select public.arena_close_day(public.arena_today() - 1);
     delete from public.post_views where day < public.arena_today() - 1;
     delete from public.notifications where created_at < now() - interval '90 days';
     delete from public.seen_posts where seen_at < now() - interval '30 days';
     delete from public.user_interests where updated_at < now() - interval '120 days';
     -- Utenti di accesso rimasti senza profilo (registrazione interrotta) dopo un giorno: liberano il nome.
     delete from auth.users u where u.created_at < now() - interval '1 day'
       and not exists (select 1 from public.profiles p where p.id = u.id) $$
);

-- 4) Amministratore: DOPO esserti registrato dall'app, togli i due trattini e metti il tuo nome utente.
--    L'amministratore modera, verifica i documenti e sceglie l'orario della copertina.
-- update public.profiles set is_admin = true where username = 'il_tuo_username';
