-- Virale · configurazione di produzione su Supabase.
-- Esegui DOPO schema.sql, nel SQL Editor del progetto (una volta sola; rieseguirlo non fa danni).
-- Contiene ciò che dipende da Supabase e quindi non sta nei test locali: Storage e pg_cron.

-- 1) Bucket pubblico "media" per foto e video: massimo 50 MB a file, solo immagini e video.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Ognuno scrive, elenca e cancella solo nella propria cartella (<id utente>/...).
--    Leggere i file è pubblico (bucket pubblico), serve per mostrarli nell'app.
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media list own folder" on storage.objects;
create policy "media list own folder" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media delete own" on storage.objects;
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Chiusura della giornata a mezzanotte (ora di Roma): sceglie la Copertina.
--    pg_cron ragiona in UTC: la mezzanotte italiana è alle 22:00 UTC d'estate e alle 23:00 UTC d'inverno.
--    Gira un minuto dopo entrambe: una delle due è la mezzanotte giusta, l'altra non fa nulla
--    (la giornata è già chiusa). Così la nuova copertina esce al minuto 00:01 tutto l'anno.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'arena-close-day';
select cron.schedule(
  'arena-close-day',
  '1 22,23 * * *',
  $$ select public.arena_close_day(public.arena_today() - 1) $$
);

-- 4) Moderatori: DOPO esserti iscritto dall'app, togli i due trattini e metti il tuo nome utente.
-- update public.profiles set is_moderator = true where username = 'il_tuo_username';
