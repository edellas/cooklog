-- =============================================================================
-- Virale · AZZERAMENTO TOTALE
-- Cancella TUTTI gli account (anche il tuo), i post, i commenti, le copertine, le gare, le notifiche,
-- le segnalazioni e i dati di verifica. NON si può annullare.
-- Restano: le impostazioni (orario della copertina, giorni per il documento, metodo di verifica) e la
-- struttura del database. I file (foto, video, documenti) vengono messi in coda e cancellati dallo Storage
-- dal lavoro automatico "virale-lavori" entro qualche minuto.
--
-- Uso: Supabase → SQL Editor → incolla tutto → Run.
-- Dopo: rifai l'iscrizione con Google o Facebook e, nel SQL Editor, renditi amministratore:
--   update public.profiles set is_admin = (username = 'TUO_NOME'), is_moderator = (username = 'TUO_NOME')
--    where is_admin or is_moderator or username = 'TUO_NOME';
-- =============================================================================
begin;

-- Copertine e gare (giorni chiusi compresi: la prossima gara riparte da oggi).
delete from public.daily_viral where true;
delete from public.arena_tier_results where true;
delete from public.arena_views where true;
delete from public.arena_entry_stats where true;
delete from public.arena_entries where true;
delete from public.arena_closed_days where true;
update public.arena_config set next_close_at = null where id;

-- Notifiche (anche quelle sul telefono in coda) e segnalazioni.
delete from public.push_broadcasts where true;
delete from public.push_outbox where true;
delete from public.notifications where true;
delete from public.reports where true;
delete from public.user_reports where true;

-- Dati di uso e controlli.
delete from public.post_views where true;
delete from public.seen_posts where true;
delete from public.user_interests where true;
delete from public.media_checks where true;
delete from public.rate_events where true;

-- Tutti gli account: con loro se ne vanno profili, post, commenti, mi piace, salvataggi, follow, blocchi,
-- dati privati, verifiche dell'età, token delle notifiche. I file dei post finiscono nella coda di cancellazione.
delete from auth.users where true;

-- Nomi utente bloccati (espulsi o minorenni): si possono di nuovo usare.
delete from public.banned_usernames where true;

commit;

-- Controllo: tutto deve essere 0 (tranne file_da_cancellare, che scende a 0 entro qualche minuto).
select (select count(*) from auth.users)              as account,
       (select count(*) from public.profiles)         as profili,
       (select count(*) from public.posts)            as post,
       (select count(*) from public.daily_viral)      as copertine,
       (select count(*) from public.arena_entries)    as candidature,
       (select count(*) from public.notifications)    as notifiche,
       (select count(*) from public.storage_purge)    as file_da_cancellare;
