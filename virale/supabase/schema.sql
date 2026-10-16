-- Virale · schema Supabase
-- Esegui tutto nel SQL Editor di Supabase (Database → SQL Editor), poi setup-produzione.sql (Storage e mezzanotte).
-- Stessa logica di src/engine/engine.ts: se cambi pesi o soglie, aggiornali in entrambi.
--
-- Flusso:
--   giorno D     insert in posts + arena_submit()  -> un post (foto e/o video) in gara per utente
--                feed_for_you()       -> i Provini: il server sceglie cosa mostrare (alla cieca)
--                arena_record_view()  -> segnali impliciti, promozione tra livelli
--   fine di D    arena_close_day(D)   -> pg_cron, un solo vincitore in daily_viral
--   giorno D+1   get_today_cover()    -> la Copertina: lo stesso post per tutti, appena si apre l'app

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profili e contenuti
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (length(display_name) between 1 and 40),
  bio text not null default '' check (length(bio) <= 160),
  -- Accettazione di termini e linee guida (con dichiarazione di almeno 14 anni): obbligatoria per iscriversi.
  terms_accepted_at timestamptz not null default now(),
  is_moderator boolean not null default false,
  -- L'amministratore modera e in più verifica i documenti e cambia le impostazioni (orario della copertina).
  is_admin boolean not null default false,
  banned_at timestamptz,
  created_at timestamptz not null default now()
);

-- Un post: da 1 a 10 elementi, foto e/o video, come su TikTok.
-- media = [{ "kind": "image"|"video", "url": "...", "width": 1080, "height": 1920, "duration_ms": 12000 }]
create or replace function public.valid_media(m jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(m) = 'array'
     and jsonb_array_length(m) between 1 and 10
     and not exists (
       select 1 from jsonb_array_elements(m) x
       where jsonb_typeof(x) <> 'object'
          -- coalesce: un elemento senza "kind" darebbe NULL e passerebbe il controllo.
          or not coalesce(x->>'kind' in ('image', 'video') and coalesce(x->>'url', '') ~ '^https://', false)
          -- La durata arriva in millisecondi, anche con decimali (iOS): si confronta come numero.
          -- La durata deve essere un numero (anche con decimali, come la manda iOS) e al massimo 61 s.
          or (x->>'kind' = 'video' and x ? 'duration_ms'
              and (jsonb_typeof(x->'duration_ms') <> 'number' or (x->>'duration_ms')::numeric > 61000))
     );
$$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media jsonb not null check (public.valid_media(media)),
  caption text not null default '' check (length(caption) <= 300),
  like_count int not null default 0,
  comment_count int not null default 0,
  save_count int not null default 0,
  share_count int not null default 0,
  view_count int not null default 0,
  -- Nascosto dalla moderazione o dalle segnalazioni: non compare più da nessuna parte.
  hidden_at timestamptz,
  hidden_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_posts_author on public.posts (author_id, created_at desc);
create index if not exists idx_posts_recent on public.posts (created_at desc);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists idx_post_saves_user on public.post_saves (user_id, created_at desc);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists idx_comments_post on public.comments (post_id, created_at);
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists idx_follows_followee on public.follows (followee_id);

-- ---------------------------------------------------------------------------
-- Sicurezza della community: blocchi, segnalazioni, ban (richiesti da App Store e Google Play)
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists idx_blocks_blocked on public.blocks (blocked_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- "set null": chi viene segnalato non cancella le tracce eliminando post o account.
  post_id uuid references public.posts(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('spam', 'nudo', 'violenza', 'odio', 'molestie', 'minori', 'falso', 'altro')),
  note text check (length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);
create index if not exists idx_reports_open on public.reports (status, created_at) where status = 'open';
create index if not exists idx_reports_post on public.reports (post_id);
create index if not exists idx_reports_reporter on public.reports (reporter_id);
create index if not exists idx_reports_reported on public.reports (reported_user_id);

alter table public.blocks enable row level security;
alter table public.reports enable row level security;
drop policy if exists "blocks own" on public.blocks;
create policy "blocks own" on public.blocks for select to authenticated using (auth.uid() = blocker_id);
-- Le segnalazioni passano solo dalle funzioni report_post / mod_*: nessun accesso diretto.

/** Un utente può agire (pubblicare, commentare, votare) solo se ha un profilo e non è stato espulso. */
create or replace function public.is_active(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = p_uid and banned_at is null);
$$;

alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_staff(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = p_uid and banned_at is null and (is_moderator or is_admin));
$$;
create or replace function public.is_admin(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  -- Si può chiedere solo di sé: l'elenco degli amministratori non è pubblico.
  select (auth.uid() is null or p_uid = auth.uid())
     and exists (select 1 from profiles where id = p_uid and banned_at is null and is_admin);
$$;

-- ---------------------------------------------------------------------------
-- Dati personali e verifica dell'età (privati: li leggono solo l'interessato e l'amministratore)
-- ---------------------------------------------------------------------------
create table if not exists public.profile_private (
  id uuid primary key references public.profiles(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 60),
  last_name text not null check (length(trim(last_name)) between 1 and 60),
  birth_date date not null check (birth_date >= date '1900-01-01'),
  created_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
drop policy if exists "private own" on public.profile_private;
create policy "private own" on public.profile_private for select to authenticated using (id = auth.uid());
revoke all on public.profile_private from anon;
revoke insert, update, delete on public.profile_private from authenticated;

-- Il documento d'identità: si carica entro una scadenza; lo controlla a mano un amministratore e
-- i file si cancellano appena deciso. Restano solo esito, date e chi ha deciso.
create table if not exists public.identity_checks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'missing' check (status in ('missing', 'pending', 'approved', 'rejected')),
  deadline timestamptz not null,
  document_path text,
  selfie_path text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reject_reason text check (length(reject_reason) <= 200)
);
create index if not exists idx_identity_pending on public.identity_checks (submitted_at) where status = 'pending';
alter table public.identity_checks enable row level security;
drop policy if exists "identity own" on public.identity_checks;
create policy "identity own" on public.identity_checks for select to authenticated using (user_id = auth.uid());
revoke all on public.identity_checks from anon;
revoke insert, update, delete on public.identity_checks from authenticated;

/**
 * Può pubblicare, commentare, mettere mi piace, seguire e votare: account attivo e documento approvato,
 * oppure ancora dentro il periodo concesso per caricarlo. Scaduto il periodo si guarda soltanto.
 */
create or replace function public.can_act(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  -- Solo di sé (lo stato di verifica degli altri è privato). Chi ha inviato il documento entro la scadenza
  -- non resta bloccato se l'amministratore è in ritardo: ha altri 14 giorni.
  select (auth.uid() is null or p_uid = auth.uid()) and public.is_active(p_uid) and exists (
    select 1 from identity_checks
    where user_id = p_uid
      and (status = 'approved' or now() < deadline
           or (status = 'pending' and submitted_at <= deadline and now() < deadline + interval '14 days'))
  );
$$;

-- Vota (conta nella gara) solo chi ha l'età verificata: gli account falsi non spostano la copertina.
create or replace function public.can_vote(p_uid uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active(p_uid) and exists (select 1 from identity_checks where user_id = p_uid and status = 'approved');
$$;

-- File da cancellare dallo Storage (documenti dopo la decisione, media di account chiusi o eliminati).
-- Il database non può cancellare i file: lo fa l'app dell'amministratore ogni volta che apre l'Amministrazione.
create table if not exists public.storage_purge (
  bucket text not null check (bucket in ('media', 'documenti')),
  path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table public.storage_purge enable row level security;
revoke all on public.storage_purge from anon, authenticated;

-- Nomi utente di account espulsi (anche per età): non si possono riprendere eliminando e ricreando l'account.
create table if not exists public.banned_usernames (
  username text primary key,
  reason text not null,
  banned_at timestamptz not null default now()
);
alter table public.banned_usernames enable row level security;
revoke all on public.banned_usernames from anon, authenticated;

create or replace function public.media_path(p_url text)
returns text language sql immutable as $$
  select substring(p_url from '/storage/v1/object/public/media/(.+)$');
$$;

/** Vero se uno dei due ha bloccato l'altro: in quel caso non si vedono più a vicenda. */
-- Chi chiama può chiedere solo dei blocchi che lo riguardano: i blocchi altrui sono privati.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select a is not null and b is not null
     and (auth.uid() is null or auth.uid() in (a, b))
     and exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

/**
 * Un post è visibile a chi guarda se non è nascosto, l'autore non è espulso, non c'è un blocco tra i due
 * e chi guarda non l'ha segnalato (un post segnalato sparisce subito per chi lo segnala).
 */
create or replace function public.can_see(p_post_id uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from posts p join profiles a on a.id = p.author_id
    where p.id = p_post_id and p.hidden_at is null and a.banned_at is null
      and not public.is_blocked_pair(p_viewer, p.author_id)
      -- Solo per sé: chiedere "X ha segnalato questo post?" per un altro rivelerebbe chi segnala.
      and (p_viewer is distinct from auth.uid()
           or not exists (select 1 from reports r where r.post_id = p_post_id and r.reporter_id = p_viewer))
  );
$$;

-- Campi che decide sempre il server, qualunque cosa mandi il client: date, ruoli, contatori, stato.
create or replace function public.force_server_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'profiles' then
    new.created_at := now();
    new.is_moderator := false;
    new.is_admin := false;
    new.banned_at := null;
    new.terms_accepted_at := now();
  elsif tg_table_name = 'posts' then
    new.created_at := now();
    new.like_count := 0;
    new.comment_count := 0;
    new.save_count := 0;
    new.share_count := 0;
    new.view_count := 0;
    new.hidden_at := null;
    new.hidden_reason := null;
  else
    new.created_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_profiles_server_fields on public.profiles;
create trigger trg_profiles_server_fields before insert on public.profiles for each row execute function public.force_server_fields();
drop trigger if exists trg_posts_server_fields on public.posts;
create trigger trg_posts_server_fields before insert on public.posts for each row execute function public.force_server_fields();
drop trigger if exists trg_comments_server_fields on public.comments;
create trigger trg_comments_server_fields before insert on public.comments for each row execute function public.force_server_fields();

-- Contatori mantenuti dal database: il client non può gonfiarli.
create or replace function public.bump_post_counter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_col text := tg_argv[0];
  v_post uuid := coalesce(new.post_id, old.post_id);
  v_delta int := case tg_op when 'INSERT' then 1 else -1 end;
begin
  execute format('update posts set %I = greatest(%I + $1, 0) where id = $2', v_col, v_col) using v_delta, v_post;
  return null;
end;
$$;
drop trigger if exists trg_likes_count on public.post_likes;
create trigger trg_likes_count after insert or delete on public.post_likes for each row execute function public.bump_post_counter('like_count');
drop trigger if exists trg_saves_count on public.post_saves;
create trigger trg_saves_count after insert or delete on public.post_saves for each row execute function public.bump_post_counter('save_count');
-- Condivisioni: una per persona e post, così il contatore (e il segnale di gara) non si gonfia a forza di tocchi.
create table if not exists public.post_shares (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists idx_post_shares_user on public.post_shares (user_id);
alter table public.post_shares enable row level security;
drop trigger if exists trg_shares_count on public.post_shares;
create trigger trg_shares_count after insert or delete on public.post_shares for each row execute function public.bump_post_counter('share_count');
create index if not exists idx_post_likes_user on public.post_likes (user_id);
create index if not exists idx_comments_user on public.comments (user_id);
drop trigger if exists trg_comments_count on public.comments;
create trigger trg_comments_count after insert or delete on public.comments for each row execute function public.bump_post_counter('comment_count');

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
-- Data di creazione, ruolo ed espulsione li impone il trigger force_server_fields: un client non può
-- retrodatare l'account (per votare subito) né nominarsi moderatore.
create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
-- La registrazione passa da complete_registration (età, dati privati, scadenza del documento): niente insert diretti.
-- Dei profili altrui si leggono solo i campi pubblici.
revoke select, insert on public.profiles from anon, authenticated;
grant select (id, username, display_name, bio, created_at) on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- Ruolo di moderatore ed espulsione non si cambiano dal client: dal client si aggiornano solo nome e bio.
-- (Una revoca per colonna non basta se esiste il permesso sull'intera tabella, quindi si revoca tutto e si riconcede.)
revoke update on public.profiles from anon, authenticated;
grant update (display_name, bio) on public.profiles to authenticated;
drop policy if exists "posts readable" on public.posts;
-- Un post nascosto, rimosso, di un utente espulso o bloccato non si legge nemmeno interrogando la tabella.
create policy "posts readable" on public.posts for select to authenticated using (author_id = auth.uid() or public.can_see(id, auth.uid()));
drop policy if exists "posts insert own" on public.posts;
-- Contatori, data e stato li impone il trigger: un client non può inserire un post con 10.000 like o datato nel futuro.
create policy "posts insert own" on public.posts for insert to authenticated
  with check (auth.uid() = author_id and public.can_act(auth.uid()));
revoke all on public.posts from anon;
revoke insert, update on public.posts from authenticated;
grant insert (author_id, media, caption) on public.posts to authenticated;
drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts for delete to authenticated using (auth.uid() = author_id);

-- Mi piace e salvataggi: si aggiungono e si tolgono, mai si modificano (spostare un like su un altro post
-- aggirava i contatori).
drop policy if exists "likes own" on public.post_likes;
drop policy if exists "likes select own" on public.post_likes;
drop policy if exists "likes insert own" on public.post_likes;
drop policy if exists "likes delete own" on public.post_likes;
create policy "likes select own" on public.post_likes for select to authenticated using (auth.uid() = user_id);
create policy "likes insert own" on public.post_likes for insert to authenticated
  with check (auth.uid() = user_id and public.can_act(auth.uid()) and public.can_see(post_id, auth.uid()));
create policy "likes delete own" on public.post_likes for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "saves own" on public.post_saves;
drop policy if exists "saves select own" on public.post_saves;
drop policy if exists "saves insert own" on public.post_saves;
drop policy if exists "saves delete own" on public.post_saves;
create policy "saves select own" on public.post_saves for select to authenticated using (auth.uid() = user_id);
create policy "saves insert own" on public.post_saves for insert to authenticated
  with check (auth.uid() = user_id and public.can_act(auth.uid()) and public.can_see(post_id, auth.uid()));
create policy "saves delete own" on public.post_saves for delete to authenticated using (auth.uid() = user_id);
revoke all on public.post_likes, public.post_saves, public.post_shares from anon;
revoke update on public.post_likes, public.post_saves, public.post_shares from authenticated;
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
         or (public.can_see(post_id, auth.uid()) and public.is_active(user_id) and not public.is_blocked_pair(auth.uid(), user_id)));
revoke all on public.comments from anon;
revoke insert, update on public.comments from authenticated;
grant insert (post_id, user_id, body) on public.comments to authenticated;
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert to authenticated
  with check (auth.uid() = user_id and public.can_act(auth.uid()) and public.can_see(post_id, auth.uid()));
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows for select to authenticated using (auth.uid() in (follower_id, followee_id));
drop policy if exists "follows own" on public.follows;
create policy "follows own" on public.follows for insert to authenticated
  with check (auth.uid() = follower_id and public.can_act(auth.uid()) and public.is_active(followee_id)
              and not public.is_blocked_pair(follower_id, followee_id));
revoke all on public.follows from anon;
revoke update on public.follows from authenticated;
drop policy if exists "unfollow own" on public.follows;
create policy "unfollow own" on public.follows for delete to authenticated using (auth.uid() = follower_id);

-- ---------------------------------------------------------------------------
-- Configurazione (una riga)
-- ---------------------------------------------------------------------------
create table if not exists public.arena_config (
  id boolean primary key default true check (id),
  time_zone text not null default 'Europe/Rome',
  tier_thresholds int[] not null default '{50,300,1800,10000}',
  promote_percentile numeric not null default 0.8,
  min_cohort int not null default 10,
  baseline_score numeric not null default 0.35,
  winner_cooldown_days int not null default 30,
  max_report_rate numeric not null default 0.02,
  report_min_views int not null default 50,
  complete_dwell_ms int not null default 3000,
  skip_dwell_ms int not null default 1500,
  max_dwell_ms int not null default 60000,
  smoothing numeric not null default 20,
  prior_points_per_view numeric not null default 0.15,
  lcb_spread numeric not null default 2,
  upper_share numeric not null default 0.5,
  -- Ora locale dopo la quale non si accettano nuove candidature (tutti hanno tempo di essere visti).
  submission_cutoff_hour int not null default 20,
  -- Le viste di account più giovani di così non contano (anti account-fantoccio).
  min_viewer_account_age interval not null default interval '24 hours',
  stat_shards int not null default 16,
  -- Minuti dopo la mezzanotte (ora di Roma) in cui compare la nuova copertina: lo decide l'amministratore.
  reveal_minutes int not null default 0 check (reveal_minutes between 0 and 1439),
  -- Giorni concessi ai nuovi iscritti per caricare il documento d'identità.
  id_grace_days int not null default 7 check (id_grace_days between 1 and 60)
);
insert into public.arena_config default values on conflict do nothing;

create or replace function public.arena_cfg()
returns public.arena_config language sql stable as $$
  select * from public.arena_config limit 1;
$$;

create or replace function public.arena_today()
returns date language sql stable as $$
  select (now() at time zone (select time_zone from public.arena_config limit 1))::date;
$$;

-- Colonne aggiunte dopo la prima versione: prima delle funzioni che le usano (un database vecchio deve aggiornarsi).
alter table public.arena_config add column if not exists reveal_minutes int not null default 0 check (reveal_minutes between 0 and 1439);
alter table public.arena_config add column if not exists id_grace_days int not null default 7 check (id_grace_days between 1 and 60);

-- Il giorno della copertina visibile adesso: la gara chiude a mezzanotte, ma la nuova copertina compare
-- all'orario scelto dall'amministratore. Prima di quell'ora resta quella del giorno prima.
create or replace function public.cover_day()
returns date language sql stable as $$
  select case
    when extract(hour from l) * 60 + extract(minute from l) >= c.reveal_minutes then l::date
    else l::date - 1 end
  from public.arena_config c, lateral (select now() at time zone c.time_zone as l) t
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists public.arena_entries (
  id uuid primary key default gen_random_uuid(),
  contest_day date not null,
  -- Se il post viene eliminato la candidatura resta (squalificata): così non se ne fa una seconda lo stesso giorno.
  post_id uuid references public.posts(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  tier smallint not null default 0,
  status text not null default 'active' check (status in ('active', 'parked', 'finalist', 'disqualified')),
  -- 'segnalazioni' (tasso di segnalazioni oltre soglia: un moderatore può annullarla), 'moderazione', 'ritirato'.
  disqualified_reason text,
  last_score numeric,
  -- Chiave casuale indicizzata: permette di campionare candidati in O(log n) anche con centinaia di migliaia di contenuti.
  rand_key double precision not null default random(),
  created_at timestamptz not null default now(),
  unique (contest_day, author_id),
  unique (contest_day, post_id)
);
-- Campionamento in O(log n): due indici parziali con i predicati esatti usati da arena_pick.
drop index if exists public.idx_arena_entries_pick;
create index if not exists idx_arena_pick_lower on public.arena_entries (contest_day, rand_key) where status in ('active', 'finalist') and tier = 0;
create index if not exists idx_arena_pick_upper on public.arena_entries (contest_day, rand_key) where status in ('active', 'finalist') and tier >= 1;
create index if not exists idx_arena_entries_post on public.arena_entries (post_id);
create index if not exists idx_arena_entries_author on public.arena_entries (author_id, contest_day);

-- Eliminare un post in gara lo ritira: la candidatura resta, squalificata.
create or replace function public.withdraw_entry_on_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update arena_entries set status = 'disqualified', disqualified_reason = 'ritirato'
   where post_id = old.id and status <> 'disqualified';
  return old;
end;
$$;
drop trigger if exists trg_posts_withdraw on public.posts;
create trigger trg_posts_withdraw before delete on public.posts for each row execute function public.withdraw_entry_on_delete();

-- Contatori "shardati": i finalisti ricevono migliaia di viste al secondo, una sola riga
-- diventerebbe un collo di bottiglia per i lock. Ogni vista incrementa uno shard a caso.
create table if not exists public.arena_entry_stats (
  entry_id uuid not null references public.arena_entries(id) on delete cascade,
  shard smallint not null,
  views int not null default 0,
  completes int not null default 0,
  rewatches int not null default 0,
  likes int not null default 0,
  comments int not null default 0,
  saves int not null default 0,
  shares int not null default 0,
  skips int not null default 0,
  reports int not null default 0,
  dwell_ms bigint not null default 0,
  primary key (entry_id, shard)
);

-- Una riga per (contenuto, spettatore): creata quando il server serve il contenuto,
-- completata quando arriva la vista. Senza riga servita la vista viene ignorata.
create table if not exists public.arena_views (
  entry_id uuid not null references public.arena_entries(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  contest_day date not null,
  served_at timestamptz not null default now(),
  recorded_at timestamptz,
  -- Segnali già accreditati per questa vista: un commento scritto dopo (dal foglio dei commenti)
  -- si accredita una volta sola, anche togliendo e rimettendo un mi piace.
  credited text[] not null default '{}',
  primary key (entry_id, viewer_id)
);
create index if not exists idx_arena_views_viewer on public.arena_views (viewer_id, contest_day);
create index if not exists idx_arena_views_day on public.arena_views (contest_day);

create table if not exists public.arena_tier_results (
  entry_id uuid not null references public.arena_entries(id) on delete cascade,
  contest_day date not null,
  tier smallint not null,
  score numeric not null,
  promoted boolean not null,
  evaluated_at timestamptz not null default now(),
  primary key (entry_id, tier)
);
create index if not exists idx_arena_tier_results_cohort on public.arena_tier_results (contest_day, tier);

create table if not exists public.daily_viral (
  featured_on date primary key,
  contest_day date not null unique,
  entry_id uuid not null references public.arena_entries(id) on delete cascade,
  -- Se il vincitore elimina il post la riga resta (senza post): la giornata non viene riassegnata
  -- e la pausa di 30 giorni del vincitore vale comunque.
  post_id uuid references public.posts(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  final_score numeric not null,
  total_entries int not null,
  total_views bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_daily_viral_author on public.daily_viral (author_id, featured_on desc);
create index if not exists idx_daily_viral_post on public.daily_viral (post_id);
create index if not exists idx_daily_viral_entry on public.daily_viral (entry_id);

-- ---------------------------------------------------------------------------
-- Aggiornamento di un database creato con una versione precedente di questo file
-- ("create table if not exists" non modifica tabelle già esistenti). Rieseguirlo non fa danni.
-- ---------------------------------------------------------------------------
alter table public.arena_entries add column if not exists disqualified_reason text;
-- Chi esisteva prima della verifica dell'età ha il periodo standard per caricare il documento.
insert into public.identity_checks (user_id, deadline)
select id, now() + interval '7 days' from public.profiles on conflict do nothing;
alter table public.arena_entries alter column post_id drop not null;
alter table public.arena_views add column if not exists credited text[] not null default '{}';
alter table public.posts add column if not exists view_count int not null default 0;
alter table public.daily_viral alter column post_id drop not null;
alter table public.reports alter column reported_user_id drop not null;
alter table public.reports alter column reporter_id drop not null;
do $$
declare r record;
begin
  for r in select * from (values
    ('arena_entries', 'post_id', 'posts'),
    ('daily_viral', 'post_id', 'posts'),
    ('reports', 'post_id', 'posts'),
    ('reports', 'reported_user_id', 'profiles'),
    ('reports', 'reporter_id', 'profiles')) as t(tbl, col, ref)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.tbl || '_' || r.col || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete set null',
                   r.tbl, r.tbl || '_' || r.col || '_fkey', r.col, r.ref);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: lettura pubblica per autenticati, scritture solo tramite le funzioni qui sotto
-- ---------------------------------------------------------------------------
alter table public.arena_config enable row level security;
alter table public.arena_entries enable row level security;
alter table public.arena_entry_stats enable row level security;
alter table public.arena_views enable row level security;
alter table public.arena_tier_results enable row level security;
alter table public.daily_viral enable row level security;

-- Le candidature non si leggono dalla tabella (punteggi e autori resterebbero esposti): solo tramite le funzioni.
drop policy if exists "arena entries readable" on public.arena_entries;
revoke all on public.arena_entries, public.arena_entry_stats, public.arena_tier_results, public.arena_config from anon, authenticated;
drop policy if exists "arena views own" on public.arena_views;
create policy "arena views own" on public.arena_views for select to authenticated using (auth.uid() = viewer_id);
-- La copertina si legge solo con get_today_cover (che rispetta l'orario di rivelazione), mai dalla tabella.
drop policy if exists "daily viral readable" on public.daily_viral;
revoke all on public.daily_viral from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Punteggio (identico a qualityScore / lowerBoundScore in engine.ts)
-- ---------------------------------------------------------------------------
create or replace function public.arena_points(s public.arena_entry_stats)
returns numeric language sql immutable as $$
  select s.completes * 1.0 + s.rewatches * 1.5 + s.likes * 2 + s.comments * 3 + s.saves * 3 + s.shares * 6 - s.skips * 1.5 - s.reports * 20;
$$;

create or replace function public.arena_entry_totals(p_entry_id uuid)
returns public.arena_entry_stats language sql stable security definer set search_path = public, pg_temp as $$
  select p_entry_id, 0::smallint,
         coalesce(sum(views), 0)::int, coalesce(sum(completes), 0)::int, coalesce(sum(rewatches), 0)::int,
         coalesce(sum(likes), 0)::int, coalesce(sum(comments), 0)::int,
         coalesce(sum(saves), 0)::int, coalesce(sum(shares), 0)::int, coalesce(sum(skips), 0)::int,
         coalesce(sum(reports), 0)::int, coalesce(sum(dwell_ms), 0)::bigint
  from public.arena_entry_stats where entry_id = p_entry_id;
$$;

create or replace function public.arena_quality(s public.arena_entry_stats)
returns numeric language sql stable as $$
  select (public.arena_points(s) + c.smoothing * c.prior_points_per_view) / (s.views + c.smoothing)
  from public.arena_config c limit 1;
$$;

create or replace function public.arena_lower_bound(s public.arena_entry_stats)
returns numeric language sql stable as $$
  select public.arena_quality(s) - c.lcb_spread / sqrt(s.views + c.smoothing)
  from public.arena_config c limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 1) Candidatura
-- ---------------------------------------------------------------------------
create or replace function public.arena_submit(p_post_id uuid)
returns public.arena_entries
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_day date := public.arena_today();
  v_entry public.arena_entries;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if not public.can_act(v_uid) then raise exception 'Per partecipare devi verificare la tua età: carica il documento dal profilo.'; end if;
  if extract(hour from now() at time zone v_cfg.time_zone) >= v_cfg.submission_cutoff_hour then
    raise exception 'Candidature chiuse per oggi: riprova domani.';
  end if;
  if not exists (select 1 from posts where id = p_post_id and author_id = v_uid) then
    raise exception 'Puoi candidare solo un tuo post.';
  end if;
  if exists (
    select 1 from daily_viral
    -- Stessa finestra di arena_close_day: il post di oggi uscirebbe domani (v_day + 1).
    where author_id = v_uid and featured_on > v_day + 1 - v_cfg.winner_cooldown_days
  ) then
    raise exception 'Hai già vinto di recente: potrai ripartecipare tra qualche giorno.';
  end if;

  insert into arena_entries (contest_day, post_id, author_id)
  values (v_day, p_post_id, v_uid)
  returning * into v_entry;
  return v_entry;
exception when unique_violation then
  raise exception 'Puoi candidare un solo post al giorno.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Prossimi contenuti da mostrare (scelti dal server, mai dall'utente)
-- ---------------------------------------------------------------------------
-- Campiona fino a p_n candidati di un intervallo di livelli partendo da un punto casuale dell'indice.
create or replace function public.arena_pick(p_day date, p_viewer uuid, p_min_tier int, p_max_tier int, p_n int)
returns setof public.arena_entries
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_start double precision := random();
begin
  -- Due rami con predicati letterali (tier = 0 / tier >= 1): solo così il piano usa gli indici parziali
  -- e legge pochi elementi dell'indice invece di tutte le candidature del giorno.
  if p_max_tier = 0 then
    return query
    with candidates as (
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier = 0 and e.rand_key >= v_start
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
        order by e.rand_key limit p_n)
      union all
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier = 0 and e.rand_key < v_start
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
        order by e.rand_key limit p_n)
    )
    select * from candidates limit p_n;
  else
    return query
    with candidates as (
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier >= 1 and e.rand_key >= v_start
          and e.tier between p_min_tier and p_max_tier
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
        order by e.rand_key limit p_n)
      union all
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier >= 1 and e.rand_key < v_start
          and e.tier between p_min_tier and p_max_tier
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
        order by e.rand_key limit p_n)
    )
    select * from candidates limit p_n;
  end if;
end;
$$;

-- Un post composto come lo legge l'app: autore, media, contatori, e cosa ne pensa chi guarda.
create or replace function public.post_json(p_post_id uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id,
    'author', jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name),
    'media', p.media,
    'caption', p.caption,
    'created_at', p.created_at,
    'like_count', p.like_count,
    'comment_count', p.comment_count,
    'save_count', p.save_count,
    'share_count', p.share_count,
    'view_count', p.view_count,
    'liked', exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = p_viewer),
    'saved', exists (select 1 from post_saves v where v.post_id = p.id and v.user_id = p_viewer),
    'following', exists (select 1 from follows f where f.follower_id = p_viewer and f.followee_id = p.author_id),
    'contest', (
      select jsonb_build_object('entry_id', e.id, 'tier', e.tier, 'status', e.status)
      from arena_entries e where e.post_id = p.id and e.contest_day = public.arena_today()
    )
  )
  from posts p join profiles pr on pr.id = p.author_id
  where p.id = p_post_id;
$$;

-- I Provini ("In gara"): i post in gara oggi, pescati a caso ma con probabilità che cresce con il livello
-- e con l'interesse di chi guarda (sezione 15). Esaurita la gara, si continua con Esplora.
create or replace function public.feed_for_you(p_limit int default 6, p_exclude uuid[] default '{}')
returns table (entry_id uuid, post jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_day date := public.arena_today();
  v_limit int := least(greatest(p_limit, 1), 20);
  v_upper_slots int := ceil(least(greatest(p_limit, 1), 20) * v_cfg.upper_share);
  v_ids uuid[];
  v_n int;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;

  with pool as materialized (
    select p.id, p.post_id, p.tier, true as upper from public.arena_pick(v_day, v_uid, 1, 32767, 200) p
    union all
    select p.id, p.post_id, p.tier, false from public.arena_pick(v_day, v_uid, 0, 0, v_limit * 4) p
  ), ranked as (
    -- Solo i gusti personali (niente popolarità): la gara la decidono gli sguardi, non chi è già avanti.
    select r.post_id, r.score from public.rank_posts(v_uid, array(select post_id from pool), true) r
  ), weighted as materialized (
    -- Campionamento pesato (Efraimidis–Spirakis): peso = (1 + livello) × e^gusto, con il gusto tra -1 e 1,2.
    -- Anche i post lontani dai tuoi gusti escono, solo meno spesso: ogni post in gara trova pubblico.
    select x.id, x.upper,
           -ln(greatest(random(), 1e-12)) / ((case when x.upper then 1 + x.tier else 1 end)
             * exp(least(greatest(coalesce(r.score, 0), -1), 1.2))) as k
    from pool x left join ranked r on r.post_id = x.post_id
  ), upper_pick as (
    select id from weighted where upper order by k limit v_upper_slots
  ), lower_pick as (
    select id, k from weighted where not upper order by k limit v_limit
  ), merged as (
    select id, 0 as pri, 0::double precision as k from upper_pick
    union all select id, 1, k from lower_pick
    union all select id, 2, k from weighted where upper and id not in (select id from upper_pick)
  )
  select array_agg(id) into v_ids from (select id from merged order by pri, k limit v_limit) x;

  if v_ids is not null then
    insert into arena_views (entry_id, viewer_id, contest_day)
    select unnest(v_ids), v_uid, v_day
    on conflict do nothing;

    return query
    select e.id, public.post_json(e.post_id, v_uid)
    from arena_entries e
    where e.id = any (v_ids)
    order by random();
  end if;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < v_limit then
    return query select null::uuid, x from public.feed_explore(v_limit - v_n, p_exclude) x;
  end if;
end;
$$;

-- "Seguiti": i post di chi segui, dal più recente, a pagine (p_before = data dell'ultimo già mostrato).
drop function if exists public.feed_following(int);
create or replace function public.feed_following(p_limit int default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.post_json(p.id, auth.uid())
  from posts p
  join follows f on f.followee_id = p.author_id and f.follower_id = auth.uid()
  where public.can_see(p.id, auth.uid())
    and p.created_at < coalesce(p_before, 'infinity')
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 60);
$$;

create or replace function public.get_post(p_post_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  -- L'autore vede sempre i propri post; gli altri solo se visibili.
  select public.post_json(p_post_id, auth.uid())
  where public.can_see(p_post_id, auth.uid())
     or exists (select 1 from posts where id = p_post_id and author_id = auth.uid());
$$;

-- Commenti di un post, senza quelli di utenti bloccati o espulsi.
create or replace function public.get_comments(p_post_id uuid)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at,
                            'author', jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name))
  from comments c join profiles a on a.id = c.user_id
  where c.post_id = p_post_id and a.banned_at is null and not public.is_blocked_pair(auth.uid(), c.user_id)
    and (public.can_see(p_post_id, auth.uid()) or exists (select 1 from posts where id = p_post_id and author_id = auth.uid()))
  order by c.created_at
  limit 300;
$$;

-- Segnala un post. Con 3 segnalazioni aperte da persone diverse il post sparisce subito
-- (e va in revisione): la community non deve aspettare il moderatore.
create or replace function public.report_post(p_post_id uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_author uuid;
  v_open int;
  v_new boolean;
  v_entry uuid;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  -- Lock sul post: tre segnalazioni simultanee contano tutte e tre.
  select author_id into v_author from posts where id = p_post_id for update;
  if v_author is null then raise exception 'Post non trovato.'; end if;
  if v_author = v_uid then raise exception 'Non puoi segnalare un tuo post.'; end if;

  insert into reports (post_id, reported_user_id, reporter_id, reason, note)
  values (p_post_id, v_author, v_uid, p_reason, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (post_id, reporter_id) do nothing
  returning true into v_new;
  if v_new is null then return; end if;

  -- Per nascondere subito un post contano solo account con più di 24 ore: tre account appena creati
  -- non possono far sparire il primo in classifica a pochi minuti dalla mezzanotte.
  select count(distinct r.reporter_id) into v_open
    from reports r join profiles pr on pr.id = r.reporter_id
   where r.post_id = p_post_id and r.status = 'open' and pr.created_at <= now() - v_cfg.min_viewer_account_age
     and pr.banned_at is null and exists (select 1 from identity_checks i where i.user_id = pr.id and i.status = 'approved');
  if v_open >= 3 then
    -- Solo nascosto, non squalificato: se il moderatore dà ragione al post, torna in gara da dove era.
    update posts set hidden_at = coalesce(hidden_at, now()), hidden_reason = coalesce(hidden_reason, 'segnalazioni') where id = p_post_id;
  end if;

  -- La segnalazione pesa nella gara solo se è vera (c'è la riga in reports) e viene da chi il post l'ha visto nei Provini.
  select e.id into v_entry from arena_entries e
   where e.post_id = p_post_id and e.contest_day = public.arena_today() and e.status in ('active', 'finalist');
  if v_entry is not null
     and exists (select 1 from arena_views v where v.entry_id = v_entry and v.viewer_id = v_uid)
     and exists (select 1 from profiles where id = v_uid and created_at <= now() - v_cfg.min_viewer_account_age)
     and public.can_vote(v_uid) then
    insert into arena_entry_stats as st (entry_id, shard, reports) values (v_entry, floor(random() * v_cfg.stat_shards)::smallint, 1)
    on conflict (entry_id, shard) do update set reports = st.reports + 1;
    perform public.arena_evaluate(v_entry);
  end if;
end;
$$;

create or replace function public.block_user(p_user_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into blocks (blocker_id, blocked_id) select auth.uid(), p_user_id
  where auth.uid() is not null and auth.uid() <> p_user_id
  on conflict do nothing;
  -- Bloccare toglie anche i follow in entrambe le direzioni.
  delete from follows where (follower_id = auth.uid() and followee_id = p_user_id) or (follower_id = p_user_id and followee_id = auth.uid());
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_user_id;
$$;

create or replace function public.list_blocked()
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name)
  from blocks b join profiles a on a.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

-- Elimina il proprio account e tutto ciò che contiene (post, commenti, like, follow, gare).
-- I file nello Storage li cancella l'app prima di chiamare questa funzione.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  -- I file restano nello Storage se l'app non riesce a cancellarli: li si mette in coda per la pulizia.
  insert into storage_purge (bucket, path)
  select 'documenti', x from identity_checks i, unnest(array[i.document_path, i.selfie_path]) x where i.user_id = v_uid and x is not null
  on conflict do nothing;
  insert into storage_purge (bucket, path)
  select 'media', public.media_path(m->>'url') from posts p, jsonb_array_elements(p.media) m
  where p.author_id = v_uid and public.media_path(m->>'url') is not null
  on conflict do nothing;
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderazione: coda delle segnalazioni, solo per i moderatori (profiles.is_moderator)
-- ---------------------------------------------------------------------------
create or replace function public.mod_queue()
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'Solo per i moderatori.'; end if;
  return query
  select jsonb_build_object(
    'post', public.post_json(r.post_id, null),
    'hidden', p.hidden_at is not null,
    'reports', count(*),
    'reasons', jsonb_agg(distinct r.reason),
    'first_at', min(r.created_at)
  )
  from reports r join posts p on p.id = r.post_id
  where r.status = 'open'
  group by r.post_id, p.hidden_at
  order by min(r.created_at);
end;
$$;

-- action: 'dismiss' (nessun problema, il post torna visibile), 'remove' (post rimosso),
-- 'ban' (post rimosso e utente espulso: tutti i suoi post spariscono e non può più agire).
create or replace function public.mod_resolve(p_post_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
begin
  if not public.is_staff(v_uid) then raise exception 'Solo per i moderatori.'; end if;
  if p_action not in ('dismiss', 'remove', 'ban') then raise exception 'Azione non valida.'; end if;
  select author_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post non trovato.'; end if;
  if v_author = v_uid then raise exception 'Non puoi decidere sui tuoi post.'; end if;
  -- Un moderatore agisce solo su post segnalati e non può espellere chi fa parte dello staff.
  if not public.is_admin(v_uid) then
    if not exists (select 1 from reports where post_id = p_post_id and status = 'open') then
      raise exception 'Il post non ha segnalazioni aperte.';
    end if;
    if p_action = 'ban' and exists (select 1 from profiles where id = v_author and (is_admin or is_moderator)) then
      raise exception 'Non puoi espellere un membro dello staff.';
    end if;
  end if;

  update reports set status = case when p_action = 'dismiss' then 'dismissed' else 'removed' end,
                     resolved_by = v_uid, resolved_at = now()
   where post_id = p_post_id and status = 'open';

  if p_action = 'dismiss' then
    update posts set hidden_at = null, hidden_reason = null where id = p_post_id and hidden_reason = 'segnalazioni';
    -- Le segnalazioni respinte non pesano più: se avevano fatto squalificare il post, torna in gara dal suo livello.
    update arena_entry_stats set reports = 0
     where entry_id in (select id from arena_entries where post_id = p_post_id and contest_day = public.arena_today());
    update arena_entries set status = case when tier >= array_length((public.arena_cfg()).tier_thresholds, 1) then 'finalist' else 'active' end,
                             disqualified_reason = null
     where post_id = p_post_id and contest_day = public.arena_today() and status = 'disqualified' and disqualified_reason = 'segnalazioni';
  else
    update posts set hidden_at = coalesce(hidden_at, now()), hidden_reason = 'moderazione' where id = p_post_id;
    update arena_entries set status = 'disqualified', disqualified_reason = 'moderazione' where post_id = p_post_id;
    -- L'autore viene avvisato (e può scrivere al supporto se pensa sia un errore).
    perform public.notify(v_author, 'removed', null, p_post_id);
  end if;

  if p_action = 'ban' then
    insert into banned_usernames (username, reason) select username, 'moderazione' from profiles where id = v_author
    on conflict (username) do nothing;
    update profiles set banned_at = now() where id = v_author;
    update posts set hidden_at = coalesce(hidden_at, now()), hidden_reason = coalesce(hidden_reason, 'utente espulso') where author_id = v_author;
    update arena_entries set status = 'disqualified', disqualified_reason = 'moderazione' where author_id = v_author and contest_day = public.arena_today();
  end if;
end;
$$;

-- Una condivisione per persona e post: il contatore lo tiene il trigger su post_shares.
create or replace function public.register_share(p_post_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into post_shares (post_id, user_id)
  select p_post_id, auth.uid()
  where auth.uid() is not null and public.can_act(auth.uid()) and public.can_see(p_post_id, auth.uid())
  on conflict do nothing;
$$;

create or replace function public.get_profile(p_username text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_pr profiles;
begin
  select * into v_pr from profiles where username = p_username;
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  if not found or (v_pr.id <> v_uid and (v_pr.banned_at is not null or public.is_blocked_pair(v_uid, v_pr.id))) then
    raise exception 'Profilo non trovato.';
  end if;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_pr.id, 'username', v_pr.username, 'display_name', v_pr.display_name, 'bio', v_pr.bio,
      -- Stesse regole degli elenchi (list_follows): niente account espulsi o bloccati.
      'followers', (select count(*) from follows f join profiles a on a.id = f.follower_id
                    where f.followee_id = v_pr.id and a.banned_at is null and not public.is_blocked_pair(v_uid, a.id)),
      'following', (select count(*) from follows f join profiles a on a.id = f.followee_id
                    where f.follower_id = v_pr.id and a.banned_at is null and not public.is_blocked_pair(v_uid, a.id)),
      'covers', (select count(*) from daily_viral where author_id = v_pr.id and featured_on <= public.cover_day()),
      'views', (select coalesce(sum(view_count), 0) from posts where author_id = v_pr.id and (v_pr.id = v_uid or hidden_at is null)),
      'followed', exists (select 1 from follows where follower_id = v_uid and followee_id = v_pr.id),
      'is_me', v_pr.id = v_uid,
      'is_moderator', v_pr.id = v_uid and (v_pr.is_moderator or v_pr.is_admin),
      'is_admin', v_pr.id = v_uid and v_pr.is_admin
    ),
    'posts', coalesce((select jsonb_agg(public.post_json(p.id, v_uid) order by p.created_at desc)
                       from (select id, created_at from posts where author_id = v_pr.id
                             and (v_pr.id = v_uid or public.can_see(id, v_uid)) order by created_at desc limit 30) p), '[]'),
    'saved', case when v_pr.id = v_uid then
               coalesce((select jsonb_agg(public.post_json(s.post_id, v_uid) order by s.created_at desc)
                         from (select post_id, created_at from post_saves where user_id = v_uid and public.can_see(post_id, v_uid)
                               order by created_at desc limit 30) s), '[]')
             else '[]'::jsonb end,
    'entry', (select jsonb_build_object('entry_id', e.id, 'post_id', e.post_id, 'tier', e.tier, 'status', e.status,
                                        'views', (public.arena_entry_totals(e.id)).views, 'contest_day', e.contest_day)
              -- La propria candidatura è privata: degli altri non si vedono livello e viste.
              from arena_entries e where e.author_id = v_pr.id and v_pr.id = v_uid and e.post_id is not null
                and e.contest_day = public.arena_today())
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Valutazione di fine livello (interna)
-- ---------------------------------------------------------------------------
create or replace function public.arena_evaluate(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg public.arena_config := public.arena_cfg();
  v_entry public.arena_entries;
  v_stats public.arena_entry_stats;
  v_threshold int;
  v_score numeric;
  v_cohort int;
  v_cut numeric;
  v_promoted boolean;
  v_levels int := array_length(v_cfg.tier_thresholds, 1);
begin
  -- Lock della riga: due viste concorrenti non possono promuovere due volte.
  select * into v_entry from arena_entries where id = p_entry_id for no key update;
  if not found or v_entry.status not in ('active', 'finalist') then return; end if;

  v_stats := public.arena_entry_totals(p_entry_id);

  if v_stats.views >= v_cfg.report_min_views
     and v_stats.reports::numeric / v_stats.views > v_cfg.max_report_rate then
    update arena_entries set status = 'disqualified', disqualified_reason = 'segnalazioni' where id = p_entry_id;
    return;
  end if;

  if v_entry.status = 'finalist' then return; end if;
  v_threshold := v_cfg.tier_thresholds[v_entry.tier + 1];
  if v_threshold is null or v_stats.views < v_threshold then return; end if;

  v_score := public.arena_quality(v_stats);

  insert into arena_tier_results (entry_id, contest_day, tier, score, promoted)
  values (p_entry_id, v_entry.contest_day, v_entry.tier, v_score, false)
  on conflict do nothing;

  select count(*), percentile_cont(v_cfg.promote_percentile) within group (order by score)
    into v_cohort, v_cut
  from arena_tier_results
  where contest_day = v_entry.contest_day and tier = v_entry.tier;

  if v_cohort < v_cfg.min_cohort then v_cut := v_cfg.baseline_score; end if;
  v_promoted := v_score >= v_cut;

  update arena_tier_results set promoted = v_promoted where entry_id = p_entry_id and tier = v_entry.tier;
  update arena_entries
     set last_score = v_score,
         tier = case when v_promoted then tier + 1 else tier end,
         status = case
           when not v_promoted then 'parked'
           when tier + 1 >= v_levels then 'finalist'
           else 'active' end
   where id = p_entry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Registrazione di una vista
-- ---------------------------------------------------------------------------
create or replace function public.arena_record_view(
  p_entry_id uuid,
  p_dwell_ms int,
  p_completed boolean default null,
  p_rewatched boolean default false,
  p_liked boolean default false,
  p_commented boolean default false,
  p_saved boolean default false,
  p_shared boolean default false,
  p_reported boolean default false
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_dwell int := least(greatest(coalesce(p_dwell_ms, 0), 0), v_cfg.max_dwell_ms);
  v_views int;
  v_entry public.arena_entries;
  v_liked boolean;
  v_commented boolean;
  v_saved boolean;
  v_shared boolean;
  v_completed boolean;
begin
  if v_uid is null or not public.can_act(v_uid) then return false; end if;

  -- Solo contenuti serviti a questo utente, solo una volta, solo il giorno stesso.
  update arena_views set recorded_at = now()
   where entry_id = p_entry_id and viewer_id = v_uid and recorded_at is null
     and contest_day = public.arena_today();
  if not found then return false; end if;

  -- Gli account appena creati, o senza età verificata, guardano ma non votano.
  if exists (select 1 from profiles where id = v_uid and created_at > now() - v_cfg.min_viewer_account_age)
     or not public.can_vote(v_uid) then
    return false;
  end if;

  -- I segnali si leggono dal database, non da ciò che dice il client: mi piace, commento, salvataggio
  -- e condivisione contano solo se esistono davvero. Le segnalazioni passano da report_post.
  select * into v_entry from arena_entries where id = p_entry_id;
  v_liked := exists (select 1 from post_likes where post_id = v_entry.post_id and user_id = v_uid);
  v_commented := exists (select 1 from comments where post_id = v_entry.post_id and user_id = v_uid);
  v_saved := exists (select 1 from post_saves where post_id = v_entry.post_id and user_id = v_uid);
  v_shared := exists (select 1 from post_shares where post_id = v_entry.post_id and user_id = v_uid);
  -- Completamento e ri-visione li misura il telefono, ma devono essere compatibili col tempo passato sul post.
  v_completed := v_dwell >= v_cfg.complete_dwell_ms or (coalesce(p_completed, false) and v_dwell >= v_cfg.skip_dwell_ms);
  update arena_views set credited = array_remove(array[
      case when v_liked then 'like' end, case when v_commented then 'comment' end,
      case when v_saved then 'save' end, case when v_shared then 'share' end], null)
   where entry_id = p_entry_id and viewer_id = v_uid;

  insert into arena_entry_stats as s (entry_id, shard, views, completes, rewatches, likes, comments, saves, shares, skips, reports, dwell_ms)
  values (
    p_entry_id, floor(random() * v_cfg.stat_shards)::smallint, 1,
    v_completed::int, (coalesce(p_rewatched, false) and v_dwell >= 2 * v_cfg.complete_dwell_ms)::int,
    v_liked::int, v_commented::int, v_saved::int,
    v_shared::int, (v_dwell < v_cfg.skip_dwell_ms)::int, 0, v_dwell
  )
  on conflict (entry_id, shard) do update set
    views = s.views + 1,
    completes = s.completes + excluded.completes,
    rewatches = s.rewatches + excluded.rewatches,
    likes = s.likes + excluded.likes,
    comments = s.comments + excluded.comments,
    saves = s.saves + excluded.saves,
    shares = s.shares + excluded.shares,
    skips = s.skips + excluded.skips,
    reports = s.reports + excluded.reports,
    dwell_ms = s.dwell_ms + excluded.dwell_ms;

  select coalesce(sum(views), 0) into v_views from arena_entry_stats where entry_id = p_entry_id;
  -- I finalisti non vengono rivalutati a ogni vista (eviterebbe il lock sulla riga calda): solo a fine livello,
  -- quando si raggiungono le viste minime per il controllo delle segnalazioni, o quando ne arriva una (report_post).
  if (v_entry.status = 'active' and v_views >= coalesce(v_cfg.tier_thresholds[v_entry.tier + 1], 2147483647))
     or v_views = v_cfg.report_min_views then
    perform public.arena_evaluate(p_entry_id);
  end if;
  return true;
end;
$$;

-- Segnali arrivati dopo la vista: nei Provini la vista si registra quando apri i commenti o un foglio,
-- quindi il commento (o un mi piace messo un attimo dopo) arriva dopo. Lo si accredita qui, una volta,
-- solo se la vista è di oggi, già registrata e di un account che può votare.
create or replace function public.credit_late_signal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg public.arena_config := public.arena_cfg();
  v_kind text := tg_argv[0];
  v_entry uuid;
begin
  select e.id into v_entry from arena_entries e
   where e.post_id = new.post_id and e.contest_day = public.arena_today() and e.status in ('active', 'finalist');
  if v_entry is null then return null; end if;
  update arena_views set credited = credited || v_kind
   where entry_id = v_entry and viewer_id = new.user_id and recorded_at is not null
     and not (v_kind = any (credited))
     and exists (select 1 from profiles where id = new.user_id and banned_at is null
                   and created_at <= now() - v_cfg.min_viewer_account_age)
     and public.can_vote(new.user_id);
  if not found then return null; end if;
  insert into arena_entry_stats as st (entry_id, shard, likes, comments, saves, shares)
  values (v_entry, floor(random() * v_cfg.stat_shards)::smallint,
          (v_kind = 'like')::int, (v_kind = 'comment')::int, (v_kind = 'save')::int, (v_kind = 'share')::int)
  on conflict (entry_id, shard) do update set
    likes = st.likes + excluded.likes, comments = st.comments + excluded.comments,
    saves = st.saves + excluded.saves, shares = st.shares + excluded.shares;
  return null;
end;
$$;
drop trigger if exists trg_late_like on public.post_likes;
create trigger trg_late_like after insert on public.post_likes for each row execute function public.credit_late_signal('like');
drop trigger if exists trg_late_comment on public.comments;
create trigger trg_late_comment after insert on public.comments for each row execute function public.credit_late_signal('comment');
drop trigger if exists trg_late_save on public.post_saves;
create trigger trg_late_save after insert on public.post_saves for each row execute function public.credit_late_signal('save');
drop trigger if exists trg_late_share on public.post_shares;
create trigger trg_late_share after insert on public.post_shares for each row execute function public.credit_late_signal('share');

-- ---------------------------------------------------------------------------
-- 5) Stato del mio contenuto in gara
-- ---------------------------------------------------------------------------
create or replace function public.arena_my_entry()
returns table (entry_id uuid, post_id uuid, tier smallint, status text, views int, contest_day date)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.post_id, e.tier, e.status, (public.arena_entry_totals(e.id)).views, e.contest_day
  from arena_entries e
  where e.author_id = auth.uid() and e.contest_day = public.arena_today() and e.post_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- 6) Chiusura della giornata: un solo vincitore (solo service_role / pg_cron)
-- ---------------------------------------------------------------------------
create or replace function public.arena_close_day(p_day date)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg public.arena_config := public.arena_cfg();
  v_winner record;
  v_total_entries int;
  v_total_views bigint;
begin
  -- Due esecuzioni contemporanee (cron doppio) non devono scontrarsi: la seconda aspetta e trova il vincitore.
  perform pg_advisory_xact_lock(hashtext('arena_close_day:' || p_day::text));
  -- Si chiude solo la giornata appena finita (o una ancora aperta, per i test): mai riassegnare giorni passati.
  if p_day < public.arena_today() - 1 then
    return (select entry_id from daily_viral where contest_day = p_day);
  end if;
  if exists (select 1 from daily_viral where contest_day = p_day) then
    return (select entry_id from daily_viral where contest_day = p_day);
  end if;

  select count(*) into v_total_entries from arena_entries where contest_day = p_day;
  select coalesce(sum(s.views), 0) into v_total_views
    from arena_entry_stats s join arena_entries e on e.id = s.entry_id where e.contest_day = p_day;

  select e.id, e.post_id, e.author_id, public.arena_lower_bound(t) as lcb
    into v_winner
  from arena_entries e
  cross join lateral public.arena_entry_totals(e.id) t
  where e.contest_day = p_day
    and e.status <> 'disqualified'
    and public.can_see(e.post_id, null)
    and t.views > 0
    and not (t.views >= v_cfg.report_min_views and t.reports::numeric / t.views > v_cfg.max_report_rate)
    and not exists (
      select 1 from daily_viral d
      where d.author_id = e.author_id and d.featured_on > p_day + 1 - v_cfg.winner_cooldown_days
    )
  order by e.tier desc, lcb desc, e.created_at asc
  limit 1;

  if not found then return null; end if;

  insert into daily_viral (featured_on, contest_day, entry_id, post_id, author_id, final_score, total_entries, total_views)
  values (p_day + 1, p_day, v_winner.id, v_winner.post_id, v_winner.author_id, v_winner.lcb, v_total_entries, v_total_views);

  -- Le righe per-spettatore servono solo durante la gara: si tengono 7 giorni per audit e poi si eliminano.
  delete from arena_views where contest_day < p_day - 7;
  return v_winner.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Il virale di oggi: identico per tutti => cacheabile su CDN, costo trascurabile anche con milioni di utenti
-- ---------------------------------------------------------------------------
create or replace function public.get_today_cover()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('featured_on', d.featured_on, 'total_entries', d.total_entries, 'total_views', d.total_views,
                            'post', public.post_json(d.post_id, auth.uid()))
  from daily_viral d
  where d.featured_on = public.cover_day() and public.can_see(d.post_id, auth.uid());
$$;

-- L'Archivio: le copertine uscite, dalla più recente.
create or replace function public.get_cover_archive(p_limit int default 60)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('featured_on', d.featured_on, 'total_entries', d.total_entries, 'total_views', d.total_views,
                            'post', public.post_json(d.post_id, auth.uid()))
  from daily_viral d
  where d.featured_on <= public.cover_day() and public.can_see(d.post_id, auth.uid())
  order by d.featured_on desc
  limit least(greatest(p_limit, 1), 120);
$$;

-- ---------------------------------------------------------------------------
-- 11) Registrazione, verifica dell'età, impostazioni dell'amministratore
-- ---------------------------------------------------------------------------
-- Età minima per iscriversi (in Italia 14 anni per i servizi online, art. 2-quinquies Codice privacy).
create or replace function public.min_age_years() returns int language sql immutable as $$ select 14 $$;

-- Dominio dell'email interna usata per l'accesso (nomeutente@dominio): deve coincidere con EXPO_PUBLIC_LOGIN_DOMAIN.
create or replace function public.login_domain() returns text language sql immutable as $$ select 'utenti.virale.invalid' $$;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public, auth, pg_temp as $$
  select lower(p_username) ~ '^[a-z0-9_.]{3,24}$'
     and not exists (select 1 from profiles where username = lower(p_username))
     and not exists (select 1 from banned_usernames where username = lower(p_username))
     and not exists (select 1 from auth.users where lower(email) = lower(p_username) || '@' || public.login_domain());
$$;

/**
 * Completa la registrazione dopo la creazione dell'utente in Supabase Auth: profilo pubblico,
 * dati privati (nome, cognome, data di nascita) e scadenza per il documento.
 * Il nome mostrato agli altri è "Nome I." (iniziale del cognome): il cognome completo resta privato.
 */
create or replace function public.complete_registration(
  p_username text, p_first_name text, p_last_name text, p_birth_date date, p_accept_terms boolean
)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_user text := lower(trim(p_username));
  v_first text := trim(p_first_name);
  v_last text := trim(p_last_name);
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  if exists (select 1 from profiles where id = v_uid) then raise exception 'Hai già un profilo.'; end if;
  if not coalesce(p_accept_terms, false) then raise exception 'Per registrarti devi accettare termini e linee guida.'; end if;
  if v_user !~ '^[a-z0-9_.]{3,24}$' then raise exception 'Nome utente: da 3 a 24 caratteri tra lettere minuscole, numeri, punto e trattino basso.'; end if;
  -- Il nome utente è legato all'email interna di accesso: non si registra "alice" con l'accesso di "bob".
  if (select lower(email) from auth.users where id = v_uid) is distinct from v_user || '@' || public.login_domain() then
    raise exception 'Nome utente non valido per questo accesso.';
  end if;
  if exists (select 1 from banned_usernames where username = v_user) then raise exception 'Questo nome utente non è disponibile.'; end if;
  if length(v_first) not between 1 and 60 or length(v_last) not between 1 and 60 then raise exception 'Scrivi nome e cognome.'; end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > public.arena_today() then
    raise exception 'Data di nascita non valida.';
  end if;
  if p_birth_date > (public.arena_today() - make_interval(years => public.min_age_years()))::date then
    raise exception 'Per usare Virale devi avere almeno % anni.', public.min_age_years();
  end if;

  insert into profiles (id, username, display_name) values (v_uid, v_user, left(v_first, 38) || ' ' || upper(left(v_last, 1)) || '.');
  insert into profile_private (id, first_name, last_name, birth_date) values (v_uid, v_first, v_last, p_birth_date);
  insert into identity_checks (user_id, deadline) values (v_uid, now() + make_interval(days => v_cfg.id_grace_days));
  return jsonb_build_object('id', v_uid, 'username', v_user, 'display_name', left(v_first, 38) || ' ' || upper(left(v_last, 1)) || '.');
exception when unique_violation then
  raise exception 'Questo nome utente è già preso.';
end;
$$;

create or replace function public.get_settings()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reveal_minutes', c.reveal_minutes, 'id_grace_days', c.id_grace_days,
                            'submission_cutoff_hour', c.submission_cutoff_hour, 'time_zone', c.time_zone)
  from arena_config c limit 1;
$$;

create or replace function public.admin_set_settings(p_reveal_minutes int, p_id_grace_days int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  if p_reveal_minutes not between 0 and 1439 then raise exception 'Orario non valido.'; end if;
  if p_id_grace_days not between 1 and 60 then raise exception 'I giorni per il documento vanno da 1 a 60.'; end if;
  -- Supabase rifiuta gli UPDATE senza WHERE (estensione safeupdate) anche dentro le funzioni.
  update arena_config set reveal_minutes = p_reveal_minutes, id_grace_days = p_id_grace_days where id;
  return public.get_settings();
end;
$$;

-- Per chi si era iscritto prima delle password: nome, cognome e data di nascita, necessari per la verifica.
create or replace function public.complete_private_data(p_first_name text, p_last_name text, p_birth_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if length(trim(p_first_name)) not between 1 and 60 or length(trim(p_last_name)) not between 1 and 60 then raise exception 'Scrivi nome e cognome.'; end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > public.arena_today() then raise exception 'Data di nascita non valida.'; end if;
  if p_birth_date > (public.arena_today() - make_interval(years => public.min_age_years()))::date then
    raise exception 'Per usare Virale devi avere almeno % anni.', public.min_age_years();
  end if;
  insert into profile_private (id, first_name, last_name, birth_date) values (v_uid, trim(p_first_name), trim(p_last_name), p_birth_date)
  on conflict (id) do nothing;
  if not found then raise exception 'Dati già inseriti.'; end if;
end;
$$;

-- L'utente ha caricato documento e selfie nella sua cartella privata del bucket "documenti".
create or replace function public.submit_identity(p_document_path text, p_selfie_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row identity_checks;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if p_document_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]+\.jpg$') or p_selfie_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]+\.jpg$')
     or p_document_path = p_selfie_path then
    raise exception 'File non validi.';
  end if;
  if not exists (select 1 from profile_private where id = v_uid) then raise exception 'Prima inserisci nome, cognome e data di nascita.'; end if;
  select * into v_row from identity_checks where user_id = v_uid for update;
  if not found then raise exception 'Autenticazione richiesta'; end if;
  if v_row.status = 'approved' then raise exception 'La tua età è già verificata.'; end if;
  -- Un invio alla volta (niente code intasate), e dopo un rifiuto si aspetta qualche minuto.
  if v_row.status = 'pending' then raise exception 'Il documento è già in controllo.'; end if;
  if v_row.status = 'rejected' and v_row.reviewed_at > now() - interval '10 minutes' then
    raise exception 'Aspetta qualche minuto prima di ricaricarlo.';
  end if;
  update identity_checks set status = 'pending', document_path = p_document_path, selfie_path = p_selfie_path,
                             submitted_at = now(), reject_reason = null
   where user_id = v_uid;
end;
$$;

-- Coda per l'amministratore: chi ha caricato il documento, con i dati dichiarati da confrontare.
create or replace function public.identity_queue()
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  return query
  select jsonb_build_object('user_id', i.user_id, 'username', p.username, 'first_name', v.first_name, 'last_name', v.last_name,
                            'birth_date', v.birth_date, 'document_path', i.document_path, 'selfie_path', i.selfie_path,
                            'submitted_at', i.submitted_at, 'deadline', i.deadline)
  from identity_checks i join profiles p on p.id = i.user_id left join profile_private v on v.id = i.user_id
  where i.status = 'pending'
  order by i.submitted_at;
end;
$$;

/**
 * Decisione dell'amministratore: 'approve' (dati coerenti, almeno 14 anni), 'reject' (foto illeggibile,
 * dati diversi: l'utente può ricaricare) o 'underage' (meno di 14 anni: account espulso).
 * Restituisce i percorsi dei file, che l'app dell'amministratore cancella subito dallo Storage.
 */
drop function if exists public.identity_review(uuid, text, text);
create or replace function public.identity_review(p_user_id uuid, p_decision text, p_reason text default null, p_submitted_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid := auth.uid();
  v_row identity_checks;
begin
  if not public.is_admin(v_admin) then raise exception 'Solo per gli amministratori.'; end if;
  if p_user_id = v_admin then raise exception 'Non puoi verificare te stesso: serve un altro amministratore.'; end if;
  if p_decision not in ('approve', 'reject', 'underage') then raise exception 'Decisione non valida.'; end if;
  select * into v_row from identity_checks where user_id = p_user_id for update;
  if not found or v_row.status <> 'pending' then raise exception 'Nessun documento in attesa per questo utente.'; end if;
  -- Si decide sulle foto viste: se nel frattempo ne sono arrivate altre, si ricarica la coda.
  if p_submitted_at is not null and v_row.submitted_at is distinct from p_submitted_at then
    raise exception 'Il documento è cambiato: ricarica la coda.';
  end if;
  -- Le foto vanno cancellate in ogni caso: se l'app dell'amministratore non ci riesce subito, restano in coda.
  insert into storage_purge (bucket, path)
  select 'documenti', x from unnest(array[v_row.document_path, v_row.selfie_path]) x where x is not null
  on conflict do nothing;

  update identity_checks
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         reject_reason = case when p_decision = 'approve' then null
                              when p_decision = 'underage' then 'Hai meno di ' || public.min_age_years() || ' anni.'
                              else left(coalesce(nullif(trim(p_reason), ''), 'Documento non leggibile o non corrispondente.'), 200) end,
         reviewed_at = now(), reviewed_by = v_admin, document_path = null, selfie_path = null
   where user_id = p_user_id;
  if p_decision = 'underage' then
    -- Minore dell'età minima: account chiuso, contenuti e dati personali eliminati; resta solo il nome utente
    -- tra quelli non riutilizzabili.
    insert into banned_usernames (username, reason) select username, 'età' from profiles where id = p_user_id on conflict (username) do nothing;
    update profiles set banned_at = now() where id = p_user_id;
    insert into storage_purge (bucket, path)
    select 'media', public.media_path(m->>'url') from posts p, jsonb_array_elements(p.media) m
    where p.author_id = p_user_id and public.media_path(m->>'url') is not null
    on conflict do nothing;
    delete from posts where author_id = p_user_id;
    delete from profile_private where id = p_user_id;
  end if;
  insert into notifications (user_id, kind, data)
  values (p_user_id, case when p_decision = 'approve' then 'identity_ok' else 'identity_ko' end,
          jsonb_build_object('reason', (select reject_reason from identity_checks where user_id = p_user_id), 'final', p_decision = 'underage'))
  on conflict (user_id, kind, actor_id, post_id) do update set created_at = now(), read_at = null, data = excluded.data;
  return jsonb_build_object('paths', jsonb_build_array(v_row.document_path, v_row.selfie_path));
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) Notifiche (nell'app): nuovi follower, mi piace, commenti, gradini in gara, copertina, verifica
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('follow', 'like', 'comment', 'tier', 'cover', 'identity_ok', 'identity_ko', 'removed')),
  actor_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- Una notifica per persona e post: togliere e rimettere un mi piace non ne crea dieci.
  unique nulls not distinct (user_id, kind, actor_id, post_id)
);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_actor on public.notifications (actor_id);
create index if not exists idx_notifications_post on public.notifications (post_id);
alter table public.notifications enable row level security;
drop policy if exists "notifications own" on public.notifications;
create policy "notifications own" on public.notifications for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;

drop function if exists public.notify(uuid, text, uuid, uuid, jsonb);
create or replace function public.notify(p_user uuid, p_kind text, p_actor uuid, p_post uuid, p_data jsonb default '{}', p_at timestamptz default now())
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and public.is_blocked_pair_internal(p_user, p_actor) then return; end if;
  insert into notifications (user_id, kind, actor_id, post_id, data, created_at) values (p_user, p_kind, p_actor, p_post, coalesce(p_data, '{}'), p_at)
  on conflict (user_id, kind, actor_id, post_id) do update set created_at = excluded.created_at, read_at = null, data = excluded.data;
end;
$$;

-- Come is_blocked_pair ma senza il filtro su chi chiama: serve ai trigger, che agiscono per conto del sistema.
create or replace function public.is_blocked_pair_internal(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create or replace function public.notify_on_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_author uuid;
begin
  if tg_table_name = 'follows' then
    if tg_op = 'INSERT' then perform public.notify(new.followee_id, 'follow', new.follower_id, null);
    else delete from notifications where user_id = old.followee_id and kind = 'follow' and actor_id = old.follower_id; end if;
  elsif tg_table_name = 'post_likes' then
    if tg_op = 'INSERT' then
      select author_id into v_author from posts where id = new.post_id;
      perform public.notify(v_author, 'like', new.user_id, new.post_id);
    else
      delete from notifications where kind = 'like' and actor_id = old.user_id and post_id = old.post_id;
    end if;
  elsif tg_table_name = 'comments' then
    if tg_op = 'DELETE' then
      -- Un commento cancellato non resta nelle notifiche (con il suo testo).
      delete from notifications where kind = 'comment' and actor_id = old.user_id and post_id = old.post_id;
      return null;
    end if;
    select author_id into v_author from posts where id = new.post_id;
    perform public.notify(v_author, 'comment', new.user_id, new.post_id, jsonb_build_object('body', left(new.body, 120)));
  elsif tg_table_name = 'arena_entries' then
    if new.tier > old.tier and new.post_id is not null then
      perform public.notify(new.author_id, 'tier', null, new.post_id, jsonb_build_object('tier', new.tier));
    end if;
  elsif tg_table_name = 'daily_viral' then
    -- Il vincitore lo scopre insieme a tutti, all'orario di rivelazione (la notifica compare da quell'istante).
    perform public.notify(new.author_id, 'cover', null, new.post_id, jsonb_build_object('featured_on', new.featured_on),
      (select (new.featured_on + make_interval(mins => c.reveal_minutes))::timestamp at time zone c.time_zone from arena_config c limit 1));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow after insert or delete on public.follows for each row execute function public.notify_on_change();
drop trigger if exists trg_notify_like on public.post_likes;
create trigger trg_notify_like after insert or delete on public.post_likes for each row execute function public.notify_on_change();
drop trigger if exists trg_notify_comment on public.comments;
create trigger trg_notify_comment after insert or delete on public.comments for each row execute function public.notify_on_change();
drop trigger if exists trg_notify_tier on public.arena_entries;
create trigger trg_notify_tier after update of tier on public.arena_entries for each row execute function public.notify_on_change();
drop trigger if exists trg_notify_cover on public.daily_viral;
create trigger trg_notify_cover after insert on public.daily_viral for each row execute function public.notify_on_change();

drop function if exists public.list_notifications(int);
create or replace function public.list_notifications(p_limit int default 50, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'data', n.data, 'created_at', n.created_at, 'read', n.read_at is not null,
    'actor', case when a.id is null then null else jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name) end,
    'post', case when n.post_id is null then null else jsonb_build_object('id', p.id, 'media', p.media) end
  )
  from notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  where n.user_id = auth.uid()
    and (a.id is null or (a.banned_at is null and not public.is_blocked_pair_internal(auth.uid(), a.id)))
    and (n.post_id is null or p.id is not null)
    and n.created_at <= now()
    and n.created_at < coalesce(p_before, 'infinity')
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Segna come lette solo quelle mostrate (fino a p_up_to): una arrivata nel frattempo resta da leggere.
drop function if exists public.mark_notifications_read();
create or replace function public.mark_notifications_read(p_up_to timestamptz default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and created_at <= least(now(), coalesce(p_up_to, now()));
$$;

-- ---------------------------------------------------------------------------
-- 13) Visualizzazioni: una per persona, post e giorno
-- ---------------------------------------------------------------------------
create table if not exists public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  primary key (post_id, viewer_id, day)
);
create index if not exists idx_post_views_day on public.post_views (day);
alter table public.post_views enable row level security;
revoke all on public.post_views from anon, authenticated;

-- L'app manda a gruppi i post rimasti sullo schermo almeno un secondo. I propri post non contano.
create or replace function public.register_views(p_post_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.arena_today();
begin
  if v_uid is null or not public.can_act(v_uid) or p_post_ids is null then return; end if;
  with fresh as (
    insert into post_views (post_id, viewer_id, day)
    select distinct x, v_uid, v_day
    from unnest(p_post_ids[1:20]) x
    join posts p on p.id = x and p.author_id <> v_uid
    where public.can_see(x, v_uid)
    on conflict do nothing
    returning post_id
  )
  update posts set view_count = view_count + 1 where id in (select post_id from fresh);
end;
$$;

-- Chi segue e chi è seguito: elenchi visibili a tutti, senza utenti espulsi o bloccati.
drop function if exists public.list_follows(text, text, int);
create or replace function public.list_follows(p_username text, p_kind text, p_limit int default 100, p_before timestamptz default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_target profiles;
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  if p_kind not in ('followers', 'following') then raise exception 'Elenco non valido.'; end if;
  select * into v_target from profiles where username = p_username;
  if not found or (v_target.id <> v_uid and (v_target.banned_at is not null or public.is_blocked_pair(v_uid, v_target.id))) then
    raise exception 'Profilo non trovato.';
  end if;
  return query
  select jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name,
                            'followed', exists (select 1 from follows m where m.follower_id = v_uid and m.followee_id = a.id),
                            'is_me', a.id = v_uid, 'cursor', f.created_at)
  from follows f
  join profiles a on a.id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
  where (case when p_kind = 'followers' then f.followee_id else f.follower_id end) = v_target.id
    and a.banned_at is null and not public.is_blocked_pair(v_uid, a.id)
    and f.created_at < coalesce(p_before, 'infinity')
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 500);
end;
$$;

-- Lo stato dell'utente che serve all'app: verifica, ruoli, notifiche non lette, impostazioni.
create or replace function public.my_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'identity', (select jsonb_build_object('status', i.status, 'deadline', i.deadline, 'reason', i.reject_reason,
                                           'can_act', public.can_act(auth.uid()))
                   from identity_checks i where i.user_id = auth.uid()),
    'is_moderator', public.is_staff(auth.uid()),
    'is_admin', public.is_admin(auth.uid()),
    'banned', exists (select 1 from profiles where id = auth.uid() and banned_at is not null),
    'unread', (select count(*) from notifications n left join profiles a on a.id = n.actor_id
               where n.user_id = auth.uid() and n.read_at is null and n.created_at <= now()
                 and (a.id is null or (a.banned_at is null and not public.is_blocked_pair_internal(auth.uid(), a.id)))),
    'needs_private', not exists (select 1 from profile_private where id = auth.uid()),
    'settings', public.get_settings()
  );
$$;

-- ---------------------------------------------------------------------------
-- 14) Pulizia dei file e controllo degli indirizzi dei media
-- ---------------------------------------------------------------------------
create or replace function public.storage_purge_list(p_limit int default 200)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  return query select jsonb_build_object('bucket', bucket, 'path', path) from storage_purge order by queued_at limit least(greatest(p_limit, 1), 1000);
end;
$$;

create or replace function public.storage_purge_done(p_bucket text, p_paths text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  delete from storage_purge where bucket = p_bucket and path = any (p_paths);
end;
$$;

/**
 * Foto e video di un post devono stare nel bucket "media", nella cartella dell'autore: niente immagini
 * da siti esterni (che vedrebbero l'indirizzo di chi guarda, o cambierebbero dopo la moderazione).
 */
create or replace function public.check_media_urls()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from jsonb_array_elements(new.media) m
    where coalesce(m->>'url', '') !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/' || new.author_id::text || '/[^/?#]+$')
  ) then
    raise exception 'I file del post devono essere caricati dall''app.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_posts_media_urls on public.posts;
create trigger trg_posts_media_urls before insert on public.posts for each row execute function public.check_media_urls();

-- ---------------------------------------------------------------------------
-- 15) Interessi: cosa ti piace guardare, imparato da come guardi (come TikTok)
-- ---------------------------------------------------------------------------
-- Ogni persona ha un punteggio per "chiavi": l'autore (a:<id>), gli hashtag della didascalia (t:<tag>)
-- e il tipo di contenuto (k:video / k:image). I segnali lo spostano: guardare fino in fondo o rivedere
-- (+), mi piace, commenti, salvataggi, condivisioni, seguire (++), scorrere via subito (−), segnalare (−−).
-- I punteggi si dimezzano ogni 14 giorni: contano i gusti di adesso, non quelli di mesi fa.
create table if not exists public.user_interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null check (length(key) <= 80),
  score real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_interests enable row level security;
revoke all on public.user_interests from anon, authenticated;

-- Post già passati sullo schermo: Esplora non li ripropone per qualche giorno.
create table if not exists public.seen_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists idx_seen_posts_at on public.seen_posts (seen_at);
alter table public.seen_posts enable row level security;
revoke all on public.seen_posts from anon, authenticated;
create index if not exists idx_post_likes_user on public.post_likes (user_id, created_at desc);

create or replace function public.interest_decayed(p_score real, p_at timestamptz)
returns real language sql stable set search_path = public, pg_temp as $$
  select (p_score * power(0.5, extract(epoch from (now() - p_at)) / (14 * 86400.0)))::real;
$$;

-- Le chiavi di un post con il loro peso: l'autore conta più di un singolo hashtag.
create or replace function public.post_interest_keys(p_post_id uuid)
returns table (key text, weight real) language sql stable security definer set search_path = public, pg_temp as $$
  with p as (select author_id, caption, media from posts where id = p_post_id),
  tags as (
    select distinct lower(m[1]) as t
    from p, regexp_matches(coalesce(p.caption, ''), '#([[:alnum:]_]{2,40})', 'g') m
    limit 8
  )
  select 'a:' || p.author_id::text, 1.0::real from p
  union all
  select 'k:' || coalesce(p.media -> 0 ->> 'kind', 'image'), 0.25::real from p
  union all
  select 't:' || tags.t, (0.6 / sqrt(greatest((select count(*) from tags), 1)))::real from tags;
$$;

create or replace function public.interest_bump_key(p_uid uuid, p_key text, p_delta real)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_uid is null or p_key is null or p_delta = 0 then return; end if;
  -- Durante la cancellazione di un account i trigger non devono ricreare righe per chi non c'è più.
  if not exists (select 1 from profiles where id = p_uid) then return; end if;
  insert into user_interests as ui (user_id, key, score, updated_at)
  values (p_uid, p_key, greatest(-20, least(50, p_delta)), now())
  on conflict (user_id, key) do update
    set score = greatest(-20, least(50, public.interest_decayed(ui.score, ui.updated_at) + excluded.score)),
        updated_at = now();
end;
$$;

create or replace function public.interest_bump(p_uid uuid, p_post_id uuid, p_delta real)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_uid is null or p_post_id is null or p_delta = 0 then return; end if;
  if not exists (select 1 from profiles where id = p_uid) then return; end if;
  -- I propri post non insegnano nulla sui propri gusti.
  if exists (select 1 from posts where id = p_post_id and author_id = p_uid) then return; end if;
  insert into user_interests as ui (user_id, key, score, updated_at)
  select p_uid, k.key, greatest(-20, least(50, p_delta * k.weight)), now() from public.post_interest_keys(p_post_id) k
  on conflict (user_id, key) do update
    set score = greatest(-20, least(50, public.interest_decayed(ui.score, ui.updated_at) + excluded.score)),
        updated_at = now();
end;
$$;

-- Mi piace, salvataggi, condivisioni, commenti, segnalazioni e follow aggiornano gli interessi dal server:
-- non dipendono da cosa racconta l'app.
create or replace function public.interest_on_signal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'post_likes' then
    if tg_op = 'INSERT' then perform public.interest_bump(new.user_id, new.post_id, 1.0);
    else perform public.interest_bump(old.user_id, old.post_id, -1.0); end if;
  elsif tg_table_name = 'post_saves' then
    if tg_op = 'INSERT' then perform public.interest_bump(new.user_id, new.post_id, 2.0);
    else perform public.interest_bump(old.user_id, old.post_id, -1.5); end if;
  elsif tg_table_name = 'post_shares' then
    perform public.interest_bump(new.user_id, new.post_id, 2.0);
  elsif tg_table_name = 'comments' then
    perform public.interest_bump(new.user_id, new.post_id, 1.5);
  elsif tg_table_name = 'reports' then
    perform public.interest_bump(new.reporter_id, new.post_id, -8.0);
  elsif tg_table_name = 'follows' then
    if tg_op = 'INSERT' then perform public.interest_bump_key(new.follower_id, 'a:' || new.followee_id::text, 3.0);
    elsif exists (select 1 from profiles where id = old.followee_id) then
      perform public.interest_bump_key(old.follower_id, 'a:' || old.followee_id::text, -3.0);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_interest_likes on public.post_likes;
create trigger trg_interest_likes after insert or delete on public.post_likes for each row execute function public.interest_on_signal();
drop trigger if exists trg_interest_saves on public.post_saves;
create trigger trg_interest_saves after insert or delete on public.post_saves for each row execute function public.interest_on_signal();
drop trigger if exists trg_interest_shares on public.post_shares;
create trigger trg_interest_shares after insert on public.post_shares for each row execute function public.interest_on_signal();
drop trigger if exists trg_interest_comments on public.comments;
create trigger trg_interest_comments after insert on public.comments for each row execute function public.interest_on_signal();
drop trigger if exists trg_interest_reports on public.reports;
create trigger trg_interest_reports after insert on public.reports for each row execute function public.interest_on_signal();
drop trigger if exists trg_interest_follows on public.follows;
create trigger trg_interest_follows after insert or delete on public.follows for each row execute function public.interest_on_signal();

-- Quanto un post fa per te. Somma di:
--   gusti (autore, hashtag, tipo) · persone con gusti simili ai tuoi che lo hanno apprezzato ·
--   e, se p_personal_only è falso, quanto piace in proporzione a chi l'ha visto, quanto è recente e se segui l'autore.
-- Tutti i termini sono schiacciati (tanh) così nessuno domina: un autore adorato non riempie il feed da solo.
create or replace function public.rank_posts(p_uid uuid, p_ids uuid[], p_personal_only boolean default false)
returns table (post_id uuid, score real) language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select key, public.interest_decayed(score, updated_at) as s from user_interests where user_id = p_uid
  ), similar_users as (
    -- Chi ha messo mi piace agli stessi post tuoi negli ultimi 30 giorni (i 50 più vicini).
    select l2.user_id, count(*)::real as n
    from post_likes l1
    join post_likes l2 on l2.post_id = l1.post_id and l2.user_id <> l1.user_id
    where l1.user_id = p_uid and l1.created_at > now() - interval '30 days'
    group by l2.user_id
    order by n desc
    limit 50
  ), c as (
    select p.* from posts p where p.id = any (p_ids)
  ), taste as (
    select c.id, coalesce(sum(k.weight * m.s), 0)::real as t
    from c cross join lateral public.post_interest_keys(c.id) k
    left join mine m on m.key = k.key
    group by c.id
  ), crowd as (
    select l.post_id, sum(su.n)::real as n
    from post_likes l join similar_users su on su.user_id = l.user_id
    where l.post_id = any (p_ids)
    group by l.post_id
  )
  select c.id,
    (tanh(coalesce(t.t, 0) / 4.0) * 1.2
     + tanh(coalesce(cr.n, 0) / 3.0) * 0.7
     + case when p_personal_only then 0 else
         least((c.like_count + 2 * c.save_count + 2 * c.share_count + c.comment_count + 1.0) / (c.view_count + 8.0), 1.0) * 0.8
         + exp(-extract(epoch from (now() - c.created_at)) / (3 * 86400.0)) * 0.4
         + case when exists (select 1 from follows f where f.follower_id = p_uid and f.followee_id = c.author_id) then 0.3 else 0 end
       end)::real
  from c
  left join taste t on t.id = c.id
  left join crowd cr on cr.post_id = c.id;
$$;

-- Esplora: tutti i post fuori dalla gara di oggi, ordinati per te. Un po' di caso (esplorazione) fa
-- scoprire anche cose nuove, e al massimo due post dello stesso autore per pagina.
-- Finiti quelli nuovi, ripropone i meno recenti: il feed non finisce mai.
create or replace function public.feed_explore(p_limit int default 8, p_exclude uuid[] default '{}')
returns setof jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.arena_today();
  v_limit int := least(greatest(p_limit, 1), 20);
  v_ex uuid[] := (coalesce(p_exclude, '{}'::uuid[]))[1:300];
  v_pool uuid[];
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;

  select array_agg(id) into v_pool from (
    select p.id from posts p
    where p.author_id <> v_uid
      and p.created_at > now() - interval '30 days'
      and not (p.id = any (v_ex))
      and not exists (select 1 from arena_entries e where e.post_id = p.id and e.contest_day = v_day)
      and not exists (select 1 from seen_posts s where s.user_id = v_uid and s.post_id = p.id and s.seen_at > now() - interval '3 days')
      and public.can_see(p.id, v_uid)
    order by p.created_at desc
    limit 400
  ) x;

  if coalesce(array_length(v_pool, 1), 0) < v_limit then
    select array_agg(id) into v_pool from (
      select p.id from posts p
      where p.author_id <> v_uid
        and not (p.id = any (v_ex))
        and not exists (select 1 from arena_entries e where e.post_id = p.id and e.contest_day = v_day)
        and public.can_see(p.id, v_uid)
      order by random()
      limit 400
    ) x;
  end if;
  if v_pool is null then return; end if;

  return query
  with r as (
    select r.post_id, r.score + random() * 0.6 as s from public.rank_posts(v_uid, v_pool, false) r
  ), d as (
    select r.post_id, r.s, row_number() over (partition by p.author_id order by r.s desc) as rn
    from r join posts p on p.id = r.post_id
  )
  select public.post_json(d.post_id, v_uid) from d where d.rn <= 2 order by d.s desc limit v_limit;
end;
$$;

-- Cosa è passato sullo schermo e per quanto. Serve a tre cose: le visualizzazioni dei post (da 1 secondo,
-- una per persona al giorno, solo per chi ha l'età verificata o è nei giorni di tolleranza), i gusti
-- (scorrere via subito abbassa, guardare fino in fondo alza) e a non riproporre gli stessi post in Esplora.
create or replace function public.track_views(p_items jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.arena_today();
  v_act boolean;
  r record;
begin
  if v_uid is null or not public.is_active(v_uid) or p_items is null or jsonb_typeof(p_items) <> 'array' then return; end if;
  v_act := public.can_act(v_uid);
  for r in
    select distinct on (x.post_id) x.post_id,
           least(greatest(coalesce(x.dwell_ms, 0), 0), 600000) as dwell,
           coalesce(x.completed, false) as completed,
           coalesce(x.rewatched, false) as rewatched
    from (select * from jsonb_to_recordset(p_items) as y(post_id uuid, dwell_ms int, completed boolean, rewatched boolean) limit 30) x
    join posts p on p.id = x.post_id and p.author_id <> v_uid
    where public.can_see(x.post_id, v_uid)
  loop
    insert into seen_posts (user_id, post_id, seen_at) values (v_uid, r.post_id, now())
    on conflict (user_id, post_id) do update set seen_at = now();
    perform public.interest_bump(v_uid, r.post_id,
      case when r.rewatched then 1.2
           when r.completed then 0.7
           when r.dwell >= 6000 then 0.5
           when r.dwell >= 2500 then 0.2
           when r.dwell < 1200 then -0.4
           else 0 end);
    if v_act and r.dwell >= 1000 then
      insert into post_views (post_id, viewer_id, day) values (r.post_id, v_uid, v_day) on conflict do nothing;
      if found then update posts set view_count = view_count + 1 where id = r.post_id; end if;
    end if;
  end loop;
end;
$$;

-- Griglia del profilo a pagine: i post (o i salvati, solo i propri) più vecchi di p_before.
create or replace function public.profile_posts(p_username text, p_kind text, p_before timestamptz default null, p_limit int default 30)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_pr profiles;
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  select * into v_pr from profiles where username = p_username;
  if not found or (v_pr.id <> v_uid and (v_pr.banned_at is not null or public.is_blocked_pair(v_uid, v_pr.id))) then
    raise exception 'Profilo non trovato.';
  end if;
  if p_kind = 'saved' then
    if v_pr.id <> v_uid then return; end if;
    return query
    select public.post_json(s.post_id, v_uid) || jsonb_build_object('cursor', s.created_at)
    from post_saves s
    where s.user_id = v_uid and public.can_see(s.post_id, v_uid) and s.created_at < coalesce(p_before, 'infinity')
    order by s.created_at desc
    limit least(greatest(p_limit, 1), 60);
  else
    return query
    select public.post_json(p.id, v_uid) || jsonb_build_object('cursor', p.created_at)
    from posts p
    where p.author_id = v_pr.id and (v_pr.id = v_uid or public.can_see(p.id, v_uid))
      and p.created_at < coalesce(p_before, 'infinity')
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 60);
  end if;
end;
$$;

-- Permessi: per default ogni funzione è eseguibile da chiunque. Si toglie tutto e si riconcede solo il necessario.
revoke execute on all functions in schema public from public, anon, authenticated;
-- Usate dalle regole RLS e dai controlli delle tabelle: devono restare eseguibili da chi è autenticato.
grant execute on function public.is_active(uuid) to authenticated;
grant execute on function public.can_see(uuid, uuid) to authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.valid_media(jsonb) to authenticated;
revoke truncate on all tables in schema public from anon, authenticated;
-- Permessi: i client chiamano solo queste funzioni.
revoke all on function public.arena_close_day(date) from public, anon, authenticated;
revoke all on function public.arena_evaluate(uuid) from public, anon, authenticated;
revoke all on function public.arena_entry_totals(uuid) from public, anon, authenticated;
revoke all on function public.arena_pick(date, uuid, int, int, int) from public, anon, authenticated;
revoke all on function public.bump_post_counter() from public, anon, authenticated;
grant execute on function public.arena_submit(uuid) to authenticated;
grant execute on function public.feed_for_you(int, uuid[]) to authenticated;
grant execute on function public.feed_following(int, timestamptz) to authenticated;
grant execute on function public.arena_record_view(uuid, int, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.arena_my_entry() to authenticated;
grant execute on function public.get_post(uuid) to authenticated;
grant execute on function public.get_profile(text) to authenticated;
grant execute on function public.register_share(uuid) to authenticated;
grant execute on function public.get_today_cover() to authenticated;
grant execute on function public.get_cover_archive(int) to authenticated;
grant execute on function public.get_comments(uuid) to authenticated;
grant execute on function public.report_post(uuid, text, text) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocked() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.mod_queue() to authenticated;
grant execute on function public.mod_resolve(uuid, text) to authenticated;
grant execute on function public.can_act(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.complete_registration(text, text, text, date, boolean) to authenticated;
grant execute on function public.my_status() to authenticated;
grant execute on function public.get_settings() to anon, authenticated;
grant execute on function public.admin_set_settings(int, int) to authenticated;
grant execute on function public.submit_identity(text, text) to authenticated;
grant execute on function public.identity_queue() to authenticated;
grant execute on function public.identity_review(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.complete_private_data(text, text, date) to authenticated;
grant execute on function public.storage_purge_list(int) to authenticated;
grant execute on function public.storage_purge_done(text, text[]) to authenticated;
grant execute on function public.list_notifications(int, timestamptz) to authenticated;
grant execute on function public.mark_notifications_read(timestamptz) to authenticated;
grant execute on function public.register_views(uuid[]) to authenticated;
grant execute on function public.list_follows(text, text, int, timestamptz) to authenticated;
grant execute on function public.feed_explore(int, uuid[]) to authenticated;
grant execute on function public.track_views(jsonb) to authenticated;
grant execute on function public.profile_posts(text, text, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8-9) Pianificazione di mezzanotte e Storage: vedi setup-produzione.sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 10) Moderatori
-- ---------------------------------------------------------------------------
-- Dopo esserti iscritto dall'app, nomina te stesso (o il tuo team) moderatore:
-- update public.profiles set is_moderator = true where username = 'il_tuo_username';
-- Per l'amministratore (modera, verifica i documenti, sceglie l'orario della copertina):
-- update public.profiles set is_admin = true where username = 'il_tuo_username';
-- Nell'app comparirà la voce "Moderazione" nelle Impostazioni.

