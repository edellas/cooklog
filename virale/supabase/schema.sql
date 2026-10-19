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
          -- Solo i campi che l'app conosce, e piccoli: altro verrebbe mandato a chiunque guardi il post.
          or (x - array['kind', 'url', 'width', 'height', 'duration_ms', 'poster']) <> '{}'::jsonb
          or length(x::text) > 4096
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
-- Verifica automatica (sezione 16): con quale metodo è arrivata la decisione e la sessione aperta presso il fornitore.
alter table public.identity_checks add column if not exists method text not null default 'manual' check (method in ('manual', 'didit'));
alter table public.identity_checks add column if not exists provider_session text;
-- Perché la verifica automatica è passata a una persona (es. nome sul documento diverso da quello dichiarato).
alter table public.identity_checks add column if not exists provider_note text check (length(provider_note) <= 300);
-- Impronte (hash, mai i dati in chiaro) di chi è stato verificato: la stessa persona o lo stesso documento non
-- verificano un secondo account senza che lo veda un amministratore.
alter table public.identity_checks add column if not exists person_key text;
alter table public.identity_checks add column if not exists doc_key text;
create index if not exists idx_identity_person_key on public.identity_checks (person_key) where status = 'approved';
create index if not exists idx_identity_doc_key on public.identity_checks (doc_key) where status = 'approved';
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
  bucket text not null check (bucket in ('media', 'documenti', 'avatars')),
  path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table public.storage_purge enable row level security;
revoke all on public.storage_purge from anon, authenticated;
-- Database esistenti: anche le foto profilo (bucket "avatars") finiscono in pulizia.
alter table public.storage_purge drop constraint if exists storage_purge_bucket_check;
alter table public.storage_purge add constraint storage_purge_bucket_check check (bucket in ('media', 'documenti', 'avatars'));

-- Foto profilo (bucket "avatars", <id utente>/avatar-<ms>.jpg) e ultimo cambio del nome mostrato.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists name_changed_at timestamptz;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_path_check
    check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar-[0-9]{10,16}\.jpg$');
exception when duplicate_object then null; end $$;

-- Segnalazioni di commenti e profili (quelle dei post stanno in reports). La "fotografia" (snapshot) tiene
-- il testo del commento o nome, bio e foto del profilo al momento della segnalazione: resta come prova anche
-- se il contenuto viene cambiato o rimosso.
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('comment', 'profile')),
  comment_id uuid references public.comments(id) on delete set null,
  -- Il post su cui stava il commento (contesto per chi modera).
  post_id uuid references public.posts(id) on delete set null,
  -- L'autore del commento o il profilo segnalato.
  target_user_id uuid references public.profiles(id) on delete set null,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('spam', 'nudo', 'violenza', 'odio', 'molestie', 'minori', 'falso', 'altro')),
  note text check (length(note) <= 300),
  snapshot jsonb not null default '{}' check (length(snapshot::text) <= 2000),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_user_reports_comment on public.user_reports (comment_id, reporter_id) where kind = 'comment';
create unique index if not exists uq_user_reports_profile_open on public.user_reports (target_user_id, reporter_id) where kind = 'profile' and status = 'open';
create index if not exists idx_user_reports_open on public.user_reports (status, created_at) where status = 'open';
create index if not exists idx_user_reports_reporter on public.user_reports (reporter_id, kind);
create index if not exists idx_user_reports_target on public.user_reports (target_user_id);
alter table public.user_reports enable row level security;
-- Si legge e si scrive solo tramite le funzioni report_* / mod_*.
revoke all on public.user_reports from anon, authenticated;
create index if not exists idx_comments_post_user on public.comments (post_id, user_id);

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

-- Tutti i file di un post (foto, video e l'immagine di anteprima dei video), come percorsi nel bucket media.
create or replace function public.media_paths(p_media jsonb)
returns setof text language sql immutable as $$
  select public.media_path(u) from jsonb_array_elements(p_media) m, lateral (values (m->>'url'), (m->>'poster')) v(u)
   where public.media_path(u) is not null;
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
grant select (id, username, display_name, bio, avatar_path, created_at) on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
-- Il profilo non si modifica dalla tabella: nome, bio e foto passano da update_my_profile (regole, limiti,
-- moderazione). Prima nome e bio si potevano scrivere liberamente (a capo, caratteri di controllo,
-- "Moderatore Virale"): permesso e regola tolti anche dai database esistenti.
drop policy if exists "profiles update own" on public.profiles;
-- (Una revoca per colonna non basta se esiste il permesso sull'intera tabella, quindi si revoca tutto.)
revoke update on public.profiles from anon, authenticated;
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

-- Colonne aggiunte dopo la prima versione: prima delle funzioni che le usano (un database vecchio deve aggiornarsi).
alter table public.arena_config add column if not exists reveal_minutes int not null default 0 check (reveal_minutes between 0 and 1439);
alter table public.arena_config add column if not exists id_grace_days int not null default 7 check (id_grace_days between 1 and 60);
-- Come si verifica l'età: 'manual' (foto controllate dall'amministratore) o 'didit' (verifica automatica, sezione 16).
alter table public.arena_config add column if not exists id_provider text not null default 'manual' check (id_provider in ('manual', 'didit'));

-- Giorni di gara già chiusi (anche senza vincitore): il giorno di gara non torna mai indietro, nemmeno se
-- l'amministratore sposta l'orario più avanti dopo la chiusura.
create table if not exists public.arena_closed_days (
  contest_day date primary key,
  closed_at timestamptz not null default now()
);
alter table public.arena_closed_days enable row level security;
revoke all on public.arena_closed_days from anon, authenticated;

-- Il giorno di gara va da un orario di rivelazione al successivo (ora italiana): all'orario scelto
-- dall'amministratore la gara chiude, si sceglie il vincitore e la nuova copertina esce subito.
-- Con l'orario a mezzanotte (0) è il giorno di calendario.
create or replace function public.arena_today()
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(
           ((now() at time zone c.time_zone) - make_interval(mins => c.reveal_minutes))::date,
           coalesce((select max(d.contest_day) + 1 from public.arena_closed_days d), '-infinity'::date))
  from public.arena_config c limit 1;
$$;

-- La data di calendario a Roma: per l'età (un compleanno vale da mezzanotte, non dall'orario della gara).
create or replace function public.rome_today()
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone c.time_zone)::date from public.arena_config c limit 1;
$$;

-- La copertina visibile adesso è quella uscita alla fine della gara precedente: stessa data della gara in corso.
create or replace function public.cover_day()
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select public.arena_today();
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
-- Ultima volta che il post è stato consegnato (served_at resta la prima): un candidato consegnato ma mai
-- guardato (app chiusa, feed aggiornato) torna disponibile dopo 10 minuti, invece di sparire per sempre.
alter table public.arena_views add column if not exists last_served_at timestamptz not null default now();
-- La vista è stata contata nella gara (chi guardava poteva votare): solo allora contano i segnali arrivati dopo.
alter table public.arena_views add column if not exists counted boolean not null default false;
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
  entry_id uuid references public.arena_entries(id) on delete set null,
  -- Se il vincitore elimina il post (o l'account) la riga resta: la giornata non viene riassegnata
  -- e la pausa di 30 giorni del vincitore vale comunque.
  post_id uuid references public.posts(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  final_score numeric not null,
  total_entries int not null,
  total_views bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_daily_viral_author on public.daily_viral (author_id, featured_on desc);
-- Database già esistenti: le colonne erano "not null ... on delete cascade" (la riga spariva e il giorno si riassegnava).
alter table public.daily_viral alter column entry_id drop not null;
alter table public.daily_viral alter column author_id drop not null;
alter table public.daily_viral drop constraint if exists daily_viral_entry_id_fkey;
alter table public.daily_viral add constraint daily_viral_entry_id_fkey foreign key (entry_id) references public.arena_entries(id) on delete set null;
alter table public.daily_viral drop constraint if exists daily_viral_author_id_fkey;
alter table public.daily_viral add constraint daily_viral_author_id_fkey foreign key (author_id) references public.profiles(id) on delete set null;
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
  -- Le candidature restano aperte per le prime submission_cutoff_hour ore della gara (di norma 20 su 24):
  -- le ultime ore servono a far vedere a tutti i post appena candidati.
  if extract(epoch from ((now() at time zone v_cfg.time_zone) - make_interval(mins => v_cfg.reveal_minutes))::time) / 60
     >= v_cfg.submission_cutoff_hour * 60 then
    raise exception 'Candidature chiuse: riaprono alle %, quando esce la nuova copertina.',
      to_char(make_time(v_cfg.reveal_minutes / 60, v_cfg.reveal_minutes % 60, 0), 'HH24:MI');
  end if;
  if not exists (select 1 from posts where id = p_post_id and author_id = v_uid) then
    raise exception 'Puoi candidare solo un tuo post.';
  end if;
  -- Un post partecipa una volta sola: niente seconda occasione per un post già in gara un altro giorno.
  if exists (select 1 from arena_entries where post_id = p_post_id and contest_day < v_day) then
    raise exception 'Questo post ha già partecipato: candidane uno nuovo.';
  end if;
  if exists (
    select 1 from daily_viral
    -- Stessa finestra di arena_close_day: il post di oggi uscirebbe domani (v_day + 1). Si guardano solo le
    -- copertine già rivelate: rispondere "hai già vinto" prima dell'orario svelerebbe il risultato.
    where author_id = v_uid and featured_on > v_day + 1 - v_cfg.winner_cooldown_days and featured_on <= public.cover_day()
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
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer
                            and (v.recorded_at is not null or v.last_served_at > now() - interval '10 minutes'))
        order by e.rand_key limit p_n)
      union all
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier = 0 and e.rand_key < v_start
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer
                            and (v.recorded_at is not null or v.last_served_at > now() - interval '10 minutes'))
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
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer
                            and (v.recorded_at is not null or v.last_served_at > now() - interval '10 minutes'))
        order by e.rand_key limit p_n)
      union all
      (select e.* from arena_entries e
        where e.contest_day = p_day and e.status in ('active', 'finalist') and e.tier >= 1 and e.rand_key < v_start
          and e.tier between p_min_tier and p_max_tier
          and e.author_id <> p_viewer and public.can_see(e.post_id, p_viewer)
          and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer
                            and (v.recorded_at is not null or v.last_served_at > now() - interval '10 minutes'))
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
    'author', jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_path', pr.avatar_path),
    'media', p.media,
    'caption', p.caption,
    'created_at', p.created_at,
    'like_count', p.like_count,
    -- I commenti che chi guarda vede davvero: senza quelli di persone bloccate (nei due sensi) e quelli che
    -- ha segnalato (come get_comments). Il conto si fa solo se chi guarda ha blocchi o segnalazioni.
    'comment_count', greatest(p.comment_count - case
        when p_viewer is not null
             and (exists (select 1 from blocks b where b.blocker_id = p_viewer)
                  or exists (select 1 from blocks b where b.blocked_id = p_viewer)
                  or exists (select 1 from user_reports r where r.reporter_id = p_viewer and r.kind = 'comment'))
        then (select count(*) from comments c
               where c.post_id = p.id
                 and (c.user_id in (select blocked_id from blocks where blocker_id = p_viewer
                                    union select blocker_id from blocks where blocked_id = p_viewer)
                      or exists (select 1 from user_reports r where r.kind = 'comment' and r.comment_id = c.id and r.reporter_id = p_viewer)))
        else 0 end, 0),
    'save_count', p.save_count,
    'share_count', p.share_count,
    'view_count', p.view_count,
    'liked', exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = p_viewer),
    'saved', exists (select 1 from post_saves v where v.post_id = p.id and v.user_id = p_viewer),
    'following', exists (select 1 from follows f where f.follower_id = p_viewer and f.followee_id = p.author_id),
    -- Livello e stato della candidatura li vede solo l'autore: chi guarda (e vota) sa solo che è in gara.
    'contest', (
      select case when p.author_id = p_viewer then jsonb_build_object('entry_id', e.id, 'tier', e.tier, 'status', e.status)
                  when e.status in ('active', 'finalist') then jsonb_build_object('entry_id', null, 'tier', null, 'status', 'active')
             end
      from arena_entries e where e.post_id = p.id and e.contest_day = public.arena_today()
    )
  )
  from posts p join profiles pr on pr.id = p.author_id
  where p.id = p_post_id;
$$;

-- I Provini ("In gara"): SOLO i post in gara oggi (mai i propri), pescati a caso ma con probabilità che cresce
-- con il livello e con l'interesse di chi guarda (sezione 15). Visti tutti, la lista finisce: i post fuori gara
-- sono in Esplora. p_exclude resta per compatibilità con le versioni vecchie dell'app.
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
  -- Gli ultimi 300 post della lista sullo schermo (quelli prima sono lontani), senza doppioni.
  v_ex uuid[] := coalesce(p_exclude, '{}'::uuid[]);
  v_extra int;
  v_ids uuid[];
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if cardinality(v_ex) > 300 then v_ex := v_ex[cardinality(v_ex) - 299:cardinality(v_ex)]; end if;
  v_ex := array(select distinct x from unnest(v_ex) x);
  -- Quanti dei candidati pescati potrebbero essere scartati perché già nella lista: se ne pescano altrettanti in più.
  v_extra := cardinality(v_ex);

  with pool as materialized (
    select x.* from (
      select p.id, p.post_id, p.tier, true as upper from public.arena_pick(v_day, v_uid, 1, 32767, 200 + v_extra) p
      union all
      select p.id, p.post_id, p.tier, false from public.arena_pick(v_day, v_uid, 0, 0, v_limit * 4 + v_extra) p
    ) x
    -- Già nella lista sullo schermo (consegnati e tornati dopo 10 minuti): non si ripetono nella stessa lista.
    where not (x.post_id = any (v_ex))
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
    on conflict (entry_id, viewer_id) do update set last_served_at = now() where arena_views.recorded_at is null;

    return query
    select e.id, public.post_json(e.post_id, v_uid)
    from arena_entries e
    where e.id = any (v_ids)
    order by random();
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

-- Commenti di un post, senza quelli di utenti bloccati o espulsi e senza quelli che chi guarda ha segnalato.
create or replace function public.get_comments(p_post_id uuid)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at,
                            'author', jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path))
  from comments c join profiles a on a.id = c.user_id
  where c.post_id = p_post_id and a.banned_at is null and not public.is_blocked_pair(auth.uid(), c.user_id)
    and not exists (select 1 from user_reports r where r.kind = 'comment' and r.comment_id = c.id and r.reporter_id = auth.uid())
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

  -- Per nascondere subito un post contano solo account verificati con più di 24 ore che il post l'hanno
  -- avuto davanti: se è in gara, servito a caso nei Provini (non si può scegliere chi colpire); altrimenti
  -- passato sullo schermo. E più un post è visto, più segnalazioni servono (1 ogni 100 viste, minimo 3).
  select e.id into v_entry from arena_entries e
   where e.post_id = p_post_id and e.contest_day = public.arena_today() and e.status in ('active', 'finalist');
  select count(distinct r.reporter_id) into v_open
    from reports r join profiles pr on pr.id = r.reporter_id
   where r.post_id = p_post_id and r.status = 'open' and pr.created_at <= now() - v_cfg.min_viewer_account_age
     and pr.banned_at is null and exists (select 1 from identity_checks i where i.user_id = pr.id and i.status = 'approved')
     and case when v_entry is not null
              then exists (select 1 from arena_views v where v.entry_id = v_entry and v.viewer_id = pr.id and v.counted)
              else exists (select 1 from seen_posts sp where sp.user_id = pr.id and sp.post_id = p_post_id) end;
  if v_open >= greatest(3, ceil(coalesce(case when v_entry is not null then (public.arena_entry_totals(v_entry)).views
                                               else (select view_count from posts where id = p_post_id) end, 0) / 100.0)) then
    -- Solo nascosto, non squalificato: se il moderatore dà ragione al post, torna in gara da dove era.
    update posts set hidden_at = coalesce(hidden_at, now()), hidden_reason = coalesce(hidden_reason, 'segnalazioni') where id = p_post_id;
  end if;

  -- La segnalazione pesa nella gara solo se è vera (c'è la riga in reports) e viene da chi il post l'ha visto nei Provini.
  if v_entry is not null
     and exists (select 1 from arena_views v where v.entry_id = v_entry and v.viewer_id = v_uid and v.counted)
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
  select jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path)
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
  select 'media', x from posts p, public.media_paths(p.media) x where p.author_id = v_uid
  on conflict do nothing;
  insert into storage_purge (bucket, path) select 'avatars', avatar_path from profiles where id = v_uid and avatar_path is not null
  on conflict do nothing;
  -- Anche i file caricati e mai usati in un post: tutta la cartella dell'utente (solo su Supabase).
  if to_regclass('storage.objects') is not null then
    execute 'insert into public.storage_purge (bucket, path)
             select bucket_id, name from storage.objects
              where bucket_id in (''media'', ''documenti'', ''avatars'') and split_part(name, ''/'', 1) = $1
             on conflict do nothing' using v_uid::text;
  end if;
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
-- Espulsione di un utente (dalla moderazione dei post, dei commenti o dei profili): non può più agire, i
-- suoi post spariscono e i loro file vanno in pulizia, i suoi commenti si cancellano (contatori e notifiche
-- li aggiornano i trigger), il nome utente non si potrà riprendere.
create or replace function public.mod_ban_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into banned_usernames (username, reason) select username, 'moderazione' from profiles where id = p_user
  on conflict (username) do nothing;
  update profiles set banned_at = now() where id = p_user;
  update posts set hidden_at = coalesce(hidden_at, now()), hidden_reason = coalesce(hidden_reason, 'utente espulso') where author_id = p_user;
  insert into storage_purge (bucket, path)
  select 'media', x from posts p, public.media_paths(p.media) x where p.author_id = p_user
  on conflict do nothing;
  insert into storage_purge (bucket, path) select 'avatars', avatar_path from profiles where id = p_user and avatar_path is not null
  on conflict do nothing;
  update profiles set avatar_path = null where id = p_user and avatar_path is not null;
  update arena_entries set status = 'disqualified', disqualified_reason = 'moderazione' where author_id = p_user and contest_day = public.arena_today();
  delete from comments where user_id = p_user;
end;
$$;

-- Il motivo più frequente fra le segnalazioni aperte (per la notifica di rimozione, DSA art. 17).
create or replace function public.mod_top_reason(p_reasons text[])
returns text language sql immutable as $$
  select coalesce((select r from unnest(p_reasons) r group by r order by count(*) desc, r limit 1), 'altro');
$$;

create or replace function public.mod_resolve(p_post_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_day date;
  v_reason text;
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

  select public.mod_top_reason(array_agg(reason)) into v_reason from reports where post_id = p_post_id and status = 'open';
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
    -- Un contenuto rimosso non deve restare raggiungibile dal suo indirizzo pubblico: i file vanno in pulizia.
    insert into storage_purge (bucket, path)
    select 'media', x from posts p, public.media_paths(p.media) x where p.id = p_post_id
    on conflict do nothing;
    -- Era la copertina appena scelta (o in attesa di uscire)? Si toglie e si sceglie il secondo classificato.
    select contest_day into v_day from daily_viral where post_id = p_post_id and featured_on >= public.cover_day();
    if v_day is not null then
      delete from daily_viral where contest_day = v_day;
      perform public.arena_close_day(v_day);
    end if;
    -- L'autore viene avvisato, con il motivo (e può scrivere al supporto se pensa sia un errore).
    perform public.notify(v_author, 'removed', null, p_post_id, jsonb_build_object('reason', v_reason, 'what', 'post'));
  end if;

  if p_action = 'ban' then perform public.mod_ban_user(v_author); end if;
end;
$$;

-- Segnala un commento: per chi segnala sparisce subito; va nella coda "Commenti e profili".
create or replace function public.report_comment(p_comment_id uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_c comments;
  v_author profiles;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  select * into v_c from comments where id = p_comment_id;
  if not found or not (public.can_see(v_c.post_id, v_uid) or exists (select 1 from posts where id = v_c.post_id and author_id = v_uid)) then
    raise exception 'Commento non trovato.';
  end if;
  if v_c.user_id = v_uid then raise exception 'Non puoi segnalare un tuo commento.'; end if;
  select * into v_author from profiles where id = v_c.user_id;
  insert into user_reports (kind, comment_id, post_id, target_user_id, reporter_id, reason, note, snapshot)
  values ('comment', v_c.id, v_c.post_id, v_c.user_id, v_uid, p_reason, nullif(trim(coalesce(p_note, '')), ''),
          jsonb_build_object('body', v_c.body, 'username', v_author.username, 'created_at', v_c.created_at))
  on conflict (comment_id, reporter_id) where kind = 'comment' do nothing;
end;
$$;

-- Segnala un profilo (nome, bio o foto): va nella coda "Commenti e profili".
create or replace function public.report_profile(p_user_id uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_pr profiles;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if p_user_id = v_uid then raise exception 'Non puoi segnalare il tuo profilo.'; end if;
  select * into v_pr from profiles where id = p_user_id;
  if not found or v_pr.banned_at is not null or public.is_blocked_pair(v_uid, p_user_id) then raise exception 'Profilo non trovato.'; end if;
  insert into user_reports (kind, target_user_id, reporter_id, reason, note, snapshot)
  values ('profile', p_user_id, v_uid, p_reason, nullif(trim(coalesce(p_note, '')), ''),
          jsonb_build_object('username', v_pr.username, 'display_name', v_pr.display_name, 'bio', v_pr.bio, 'avatar_path', v_pr.avatar_path))
  on conflict (target_user_id, reporter_id) where kind = 'profile' and status = 'open' do nothing;
end;
$$;

-- Coda dei commenti e dei profili segnalati (solo staff), dal più vecchio, con il contenuto di adesso.
create or replace function public.mod_user_reports()
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'Solo per i moderatori.'; end if;
  return query
  select jsonb_build_object(
    'kind', r.kind,
    'target', case when r.kind = 'comment' then r.comment_id else r.target_user_id end,
    'reports', count(*),
    'reasons', jsonb_agg(distinct r.reason),
    'first_at', min(r.created_at),
    'snapshot', (array_agg(r.snapshot order by r.created_at desc))[1],
    'comment', (select jsonb_build_object('id', c.id, 'body', c.body, 'post_id', c.post_id, 'created_at', c.created_at)
                  from comments c where c.id = r.comment_id),
    'user', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'bio', pr.bio,
                                       'avatar_path', pr.avatar_path, 'banned', pr.banned_at is not null)
               from profiles pr where pr.id = r.target_user_id)
  )
  from user_reports r
  -- Un commento già cancellato (dal suo autore) non ha più niente da decidere.
  where r.status = 'open' and (r.kind = 'profile' or r.comment_id is not null) and r.target_user_id is not null
  group by r.kind, r.comment_id, r.target_user_id
  order by min(r.created_at);
end;
$$;

-- Profilo azzerato dalla moderazione: niente bio né foto, il nome torna "Nome I." (se ci sono i dati privati).
create or replace function public.mod_reset_profile(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into storage_purge (bucket, path) select 'avatars', avatar_path from profiles where id = p_user and avatar_path is not null
  on conflict do nothing;
  update profiles
     set bio = '', avatar_path = null, name_changed_at = now(),
         display_name = coalesce((select left(trim(v.first_name), 36) || ' ' || upper(left(trim(v.last_name), 1)) || '.'
                                    from profile_private v where v.id = p_user), display_name)
   where id = p_user;
end;
$$;

-- action: 'dismiss' (va bene), 'remove' (commento cancellato / profilo azzerato), 'ban' (in più l'autore è espulso).
create or replace function public.mod_resolve_user_report(p_kind text, p_target uuid, p_action text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_post uuid;
  v_body text;
  v_reason text;
begin
  if not public.is_staff(v_uid) then raise exception 'Solo per i moderatori.'; end if;
  if p_action not in ('dismiss', 'remove', 'ban') then raise exception 'Azione non valida.'; end if;
  if p_kind = 'comment' then
    select user_id, post_id, body into v_author, v_post, v_body from comments where id = p_target;
    if v_author is null then raise exception 'Il commento non esiste più.'; end if;
  elsif p_kind = 'profile' then
    select id into v_author from profiles where id = p_target;
    if v_author is null then raise exception 'Profilo non trovato.'; end if;
  else
    raise exception 'Tipo non valido.';
  end if;
  if v_author = v_uid then raise exception 'Non puoi decidere sui tuoi contenuti.'; end if;
  -- Un moderatore agisce solo su segnalazioni aperte e non può espellere chi fa parte dello staff.
  if not public.is_admin(v_uid) then
    if not exists (select 1 from user_reports where status = 'open' and kind = p_kind
                     and (case when p_kind = 'comment' then comment_id else target_user_id end) = p_target) then
      raise exception 'Non ci sono segnalazioni aperte.';
    end if;
    if p_action = 'ban' and exists (select 1 from profiles where id = v_author and (is_admin or is_moderator)) then
      raise exception 'Non puoi espellere un membro dello staff.';
    end if;
  end if;

  select public.mod_top_reason(array_agg(reason)) into v_reason from user_reports
   where status = 'open' and kind = p_kind and (case when p_kind = 'comment' then comment_id else target_user_id end) = p_target;
  update user_reports set status = case when p_action = 'dismiss' then 'dismissed' else 'removed' end,
                          resolved_by = v_uid, resolved_at = now()
   where status = 'open' and kind = p_kind and (case when p_kind = 'comment' then comment_id else target_user_id end) = p_target;

  if p_action <> 'dismiss' then
    if p_kind = 'comment' then
      -- La fotografia nella segnalazione resta come prova.
      delete from comments where id = p_target;
      perform public.notify(v_author, 'removed', null, v_post, jsonb_build_object('reason', v_reason, 'what', 'comment', 'body', left(v_body, 80)));
    else
      perform public.mod_reset_profile(v_author);
      perform public.notify(v_author, 'removed', null, null, jsonb_build_object('reason', v_reason, 'what', 'profile'));
    end if;
  end if;
  if p_action = 'ban' then perform public.mod_ban_user(v_author); end if;
end;
$$;

-- Una condivisione per persona e post: il contatore lo tiene il trigger su post_shares.
-- Restituisce true solo alla prima condivisione: l'app alza il contatore solo allora.
drop function if exists public.register_share(uuid);
create or replace function public.register_share(p_post_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  with ins as (
    insert into post_shares (post_id, user_id)
    select p_post_id, auth.uid()
    where auth.uid() is not null and public.can_act(auth.uid()) and public.can_see(p_post_id, auth.uid())
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins);
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
      'id', v_pr.id, 'username', v_pr.username, 'display_name', v_pr.display_name, 'bio', v_pr.bio, 'avatar_path', v_pr.avatar_path,
      -- Per la modifica del profilo: da quando si può cambiare di nuovo il nome (solo per sé).
      'name_change_from', case when v_pr.id = v_uid and v_pr.name_changed_at is not null then v_pr.name_changed_at + interval '7 days' end,
      -- Stesse regole degli elenchi (list_follows): niente account espulsi o bloccati.
      'followers', (select count(*) from follows f join profiles a on a.id = f.follower_id
                    where f.followee_id = v_pr.id and a.banned_at is null and not public.is_blocked_pair(v_uid, a.id)),
      'following', (select count(*) from follows f join profiles a on a.id = f.followee_id
                    where f.follower_id = v_pr.id and a.banned_at is null and not public.is_blocked_pair(v_uid, a.id)),
      'covers', (select count(*) from daily_viral where author_id = v_pr.id and featured_on <= public.cover_day()),
      'views', (select coalesce(sum(view_count), 0) from posts where author_id = v_pr.id and (v_pr.id = v_uid or hidden_at is null)),
      'post_count', (select count(*) from posts where author_id = v_pr.id and (v_pr.id = v_uid or public.can_see(id, v_uid))),
      'saved_count', case when v_pr.id = v_uid then (select count(*) from post_saves where user_id = v_uid and public.can_see(post_id, v_uid)) else 0 end,
      'followed', exists (select 1 from follows where follower_id = v_uid and followee_id = v_pr.id),
      'is_me', v_pr.id = v_uid,
      'is_moderator', v_pr.id = v_uid and (v_pr.is_moderator or v_pr.is_admin),
      'is_admin', v_pr.id = v_uid and v_pr.is_admin
    ),
    'posts', coalesce((select jsonb_agg(public.post_json(p.id, v_uid) || jsonb_build_object('cursor', p.created_at) order by p.created_at desc)
                       from (select id, created_at from posts where author_id = v_pr.id
                             and (v_pr.id = v_uid or public.can_see(id, v_uid)) order by created_at desc limit 30) p), '[]'),
    'saved', case when v_pr.id = v_uid then
               coalesce((select jsonb_agg(public.post_json(s.post_id, v_uid) || jsonb_build_object('cursor', s.created_at) order by s.created_at desc)
                         from (select post_id, created_at from post_saves where user_id = v_uid and public.can_see(post_id, v_uid)
                               order by created_at desc limit 30) s), '[]')
             else '[]'::jsonb end,
    'entry', (select jsonb_build_object('entry_id', e.id, 'post_id', e.post_id, 'tier', e.tier, 'status', e.status,
                                        'views', (public.arena_entry_totals(e.id)).views, 'contest_day', e.contest_day)
              -- La propria candidatura è privata: degli altri non si vedono livello e viste.
              -- Anche la candidatura ritirata (post eliminato): l'app spiega che per oggi è fatta.
              from arena_entries e where e.author_id = v_pr.id and v_pr.id = v_uid
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
  v_served timestamptz;
begin
  if v_uid is null or not public.can_act(v_uid) then return false; end if;

  -- Solo contenuti serviti a questo utente, solo una volta, solo il giorno stesso.
  update arena_views set recorded_at = now()
   where entry_id = p_entry_id and viewer_id = v_uid and recorded_at is null
     and contest_day = public.arena_today()
  returning served_at into v_served;
  if not found then return false; end if;

  -- Gli account appena creati, o senza età verificata, guardano ma non votano.
  if exists (select 1 from profiles where id = v_uid and created_at > now() - v_cfg.min_viewer_account_age)
     or not public.can_vote(v_uid) then
    return false;
  end if;

  -- I segnali si leggono dal database, non da ciò che dice il client: mi piace, commento, salvataggio
  -- e condivisione contano solo se esistono davvero. Le segnalazioni passano da report_post.
  select * into v_entry from arena_entries where id = p_entry_id;
  -- Contano solo i segnali dati dopo che il post è stato servito: un mi piace di giorni fa non è un voto di oggi.
  v_liked := exists (select 1 from post_likes where post_id = v_entry.post_id and user_id = v_uid and created_at >= v_served);
  v_commented := exists (select 1 from comments where post_id = v_entry.post_id and user_id = v_uid and created_at >= v_served);
  v_saved := exists (select 1 from post_saves where post_id = v_entry.post_id and user_id = v_uid and created_at >= v_served);
  v_shared := exists (select 1 from post_shares where post_id = v_entry.post_id and user_id = v_uid and created_at >= v_served);
  -- Completamento e ri-visione li misura il telefono, ma devono essere compatibili col tempo passato sul post.
  -- Video (p_completed presente): conta l'arrivo alla fine, con un tempo minimo. Foto: conta il tempo.
  v_completed := case when p_completed is null then v_dwell >= v_cfg.complete_dwell_ms
                      else p_completed and v_dwell >= v_cfg.skip_dwell_ms end;
  update arena_views set counted = true, credited = array_remove(array[
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
   where entry_id = v_entry and viewer_id = new.user_id and recorded_at is not null and counted
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
  -- Anche la candidatura ritirata (post eliminato, post_id nullo): per oggi non se ne può fare un'altra.
  where e.author_id = auth.uid() and e.contest_day = public.arena_today();
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
  -- Il giorno (se è davvero finito) risulta chiuso anche senza vincitore: non si riapre.
  if p_day < ((now() at time zone v_cfg.time_zone) - make_interval(mins => v_cfg.reveal_minutes))::date then
    insert into arena_closed_days (contest_day) values (p_day) on conflict do nothing;
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
    -- Un post nascosto solo da segnalazioni (non ancora esaminate) resta in gara: qualche account d'accordo
    -- non deve poter cambiare la copertina all'ultimo minuto. Finché un moderatore non decide, la copertina
    -- non si vede; se il moderatore lo rimuove, mod_resolve fa scegliere il secondo.
    and exists (select 1 from posts p join profiles a on a.id = p.author_id
                 where p.id = e.post_id and a.banned_at is null
                   and (p.hidden_at is null or p.hidden_reason = 'segnalazioni'))
    and not (t.views >= v_cfg.report_min_views and t.reports::numeric / t.views > v_cfg.max_report_rate)
    and not exists (
      select 1 from daily_viral d
      where d.author_id = e.author_id and d.featured_on > p_day + 1 - v_cfg.winner_cooldown_days
    )
  -- Prima chi ha voti validi (livello, poi punteggio prudente); se nessuno ne ha (comunità piccola, nessun
  -- votante verificato) vince il post più apprezzato: ogni giorno con candidati ha la sua copertina.
  order by (t.views > 0) desc, e.tier desc, lcb desc,
           (select p.like_count + 2 * p.save_count + 2 * p.share_count + p.comment_count + p.view_count / 10.0
              from posts p where p.id = e.post_id) desc nulls last,
           e.created_at asc
  limit 1;

  if not found then return null; end if;

  insert into daily_viral (featured_on, contest_day, entry_id, post_id, author_id, final_score, total_entries, total_views)
  values (p_day + 1, p_day, v_winner.id, v_winner.post_id, v_winner.author_id, v_winner.lcb, v_total_entries, v_total_views);

  -- Le righe per-spettatore servono solo durante la gara: si tengono 7 giorni per audit e poi si eliminano.
  delete from arena_views where contest_day < p_day - 7;
  return v_winner.id;
end;
$$;

-- Chiude la gara appena finita (la chiama pg_cron ogni minuto, e l'amministratore quando cambia l'orario):
-- appena passa l'orario di rivelazione si sceglie il vincitore e la copertina esce. Se non c'è nulla da
-- chiudere costa una lettura.
create or replace function public.arena_close_due()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg public.arena_config := public.arena_cfg();
  v_natural date := ((now() at time zone v_cfg.time_zone) - make_interval(mins => v_cfg.reveal_minutes))::date;
begin
  if not exists (select 1 from arena_closed_days where contest_day = v_natural - 1)
     and not exists (select 1 from arena_closed_days where contest_day >= v_natural) then
    perform public.arena_close_day(v_natural - 1);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Il virale di oggi: identico per tutti => cacheabile su CDN, costo trascurabile anche con milioni di utenti
-- ---------------------------------------------------------------------------
-- Il numero dell'uscita: quante copertine sono uscite fino a quel giorno compreso (la prima vera è la N. 1).
create or replace function public.cover_issue(p_day date)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) from daily_viral where featured_on <= p_day;
$$;

create or replace function public.cover_json(d public.daily_viral)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('featured_on', d.featured_on, 'issue', public.cover_issue(d.featured_on),
                            'total_entries', d.total_entries, 'total_views', d.total_views,
                            'post', public.post_json(d.post_id, auth.uid()));
$$;

create or replace function public.get_today_cover()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.cover_json(d)
  from daily_viral d
  -- La più recente già uscita: se la gara appena chiusa non ha avuto candidati, resta quella di prima.
  where d.featured_on <= public.cover_day() and public.can_see(d.post_id, auth.uid())
  order by d.featured_on desc
  limit 1;
$$;

-- L'Archivio: le copertine uscite, dalla più recente, a pagine (p_before = il giorno dell'ultima già mostrata).
drop function if exists public.get_cover_archive(int);
create or replace function public.get_cover_archive(p_limit int default 60, p_before date default null)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.cover_json(d)
  from daily_viral d
  where d.featured_on <= public.cover_day() and public.can_see(d.post_id, auth.uid())
    and d.featured_on < coalesce(p_before, 'infinity'::date)
  order by d.featured_on desc
  limit least(greatest(p_limit, 1), 120);
$$;

-- La copertina di un giorno (link o Archivio), se è già uscita ed è visibile a chi guarda.
create or replace function public.get_cover(p_day date)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.cover_json(d)
  from daily_viral d
  where d.featured_on = p_day and d.featured_on <= public.cover_day() and public.can_see(d.post_id, auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 11) Registrazione, verifica dell'età, impostazioni dell'amministratore
-- ---------------------------------------------------------------------------
-- Età minima per iscriversi (in Italia 14 anni per i servizi online, art. 2-quinquies Codice privacy).
create or replace function public.min_age_years() returns int language sql immutable as $$ select 14 $$;

-- Dominio dell'email interna usata per l'accesso (nomeutente@dominio): deve coincidere con EXPO_PUBLIC_LOGIN_DOMAIN.
create or replace function public.login_domain() returns text language sql immutable as $$ select 'utenti.virale.invalid' $$;

-- Regole dei nomi utente per le iscrizioni nuove (il check della tabella resta quello largo: i nomi già
-- registrati restano validi). Da 3 a 24 caratteri a-z 0-9 _ . con almeno una lettera o un numero, senza
-- punti all'inizio, alla fine o di fila.
create or replace function public.username_format_ok(p text)
returns boolean language sql immutable as $$
  select coalesce(p ~ '^[a-z0-9_.]{3,24}$' and p ~ '[a-z0-9]' and left(p, 1) <> '.' and right(p, 1) <> '.' and position('..' in p) = 0, false);
$$;

-- Nomi che sembrerebbero dello staff o dell'app: nessuno se li prende (l'account ufficiale lo crea il titolare).
create or replace function public.username_reserved(p text)
returns boolean language sql immutable as $$
  select coalesce(p in ('virale', 'admin', 'amministratore', 'moderatore', 'moderazione', 'supporto', 'assistenza', 'staff',
                        'ufficiale', 'official', 'help', 'aiuto', 'copertina', 'provini', 'sistema', 'root')
                  or p ~ '^(virale|admin)', false);
$$;

create or replace function public.username_ok(p text)
returns boolean language sql immutable as $$
  select public.username_format_ok(p) and not public.username_reserved(p);
$$;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public, auth, pg_temp as $$
  select public.username_ok(lower(p_username))
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
  if not public.username_format_ok(v_user) then
    raise exception 'Nome utente: da 3 a 24 caratteri tra lettere minuscole, numeri, punto e trattino basso, con almeno una lettera o un numero. Il punto non può stare all’inizio, alla fine o due volte di fila.';
  end if;
  if public.username_reserved(v_user) then raise exception 'Questo nome utente non è disponibile.'; end if;
  -- Il nome utente è legato all'email interna di accesso: non si registra "alice" con l'accesso di "bob".
  if (select lower(email) from auth.users where id = v_uid) is distinct from v_user || '@' || public.login_domain() then
    raise exception 'Nome utente non valido per questo accesso.';
  end if;
  if exists (select 1 from banned_usernames where username = v_user) then raise exception 'Questo nome utente non è disponibile.'; end if;
  if length(v_first) not between 1 and 60 or length(v_last) not between 1 and 60 then raise exception 'Scrivi nome e cognome.'; end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > public.rome_today() then
    raise exception 'Data di nascita non valida.';
  end if;
  if p_birth_date > (public.rome_today() - make_interval(years => public.min_age_years()))::date then
    raise exception 'Per usare Virale devi avere almeno % anni.', public.min_age_years();
  end if;

  -- "Nome I.": al massimo 36 + 3 = 39 caratteri, dentro il limite di 40 anche con un nome lunghissimo.
  insert into profiles (id, username, display_name) values (v_uid, v_user, left(v_first, 36) || ' ' || upper(left(v_last, 1)) || '.');
  insert into profile_private (id, first_name, last_name, birth_date) values (v_uid, v_first, v_last, p_birth_date);
  insert into identity_checks (user_id, deadline) values (v_uid, now() + make_interval(days => v_cfg.id_grace_days));
  return jsonb_build_object('id', v_uid, 'username', v_user, 'display_name', left(v_first, 36) || ' ' || upper(left(v_last, 1)) || '.');
exception when unique_violation then
  raise exception 'Questo nome utente è già preso.';
end;
$$;

create or replace function public.get_settings()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reveal_minutes', c.reveal_minutes, 'id_grace_days', c.id_grace_days,
                            'submission_cutoff_hour', c.submission_cutoff_hour, 'time_zone', c.time_zone,
                            'id_provider', c.id_provider,
                            -- Gara in corso e quando finisce (è anche quando esce la prossima copertina).
                            'contest_day', public.arena_today(),
                            'closes_at', ((public.arena_today() + 1)::timestamp + make_interval(mins => c.reveal_minutes)) at time zone c.time_zone)
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
  -- Se il nuovo orario per oggi è già passato, la gara chiude adesso e la copertina esce subito.
  perform public.arena_close_due();
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
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > public.rome_today() then raise exception 'Data di nascita non valida.'; end if;
  if p_birth_date > (public.rome_today() - make_interval(years => public.min_age_years()))::date then
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
  -- Le foto chiudono un'eventuale verifica automatica rimasta a metà: il suo esito tardivo non le scavalca.
  update identity_checks set status = 'pending', document_path = p_document_path, selfie_path = p_selfie_path,
                             submitted_at = now(), reject_reason = null, method = 'manual', provider_session = null, provider_note = null
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
                            'submitted_at', i.submitted_at, 'deadline', i.deadline, 'method', i.method,
                            'provider_note', i.provider_note,
                            'duplicate_of', public.identity_duplicate(i.user_id, public.person_key(v.first_name, v.last_name, v.birth_date), i.doc_key))
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
  return public.identity_apply(p_user_id, p_decision, p_reason, v_admin);
end;
$$;

-- Applica una decisione sulla verifica (dall'amministratore o dalla verifica automatica): cancella le foto,
-- aggiorna lo stato, chiude l'account se ha meno dell'età minima, avvisa l'utente.
create or replace function public.identity_apply(p_user_id uuid, p_decision text, p_reason text, p_reviewer uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row identity_checks;
begin
  select * into v_row from identity_checks where user_id = p_user_id for update;
  if not found then raise exception 'Utente senza verifica.'; end if;
  -- Le foto vanno cancellate in ogni caso: se l'app dell'amministratore non ci riesce subito, restano in coda.
  insert into storage_purge (bucket, path)
  select 'documenti', x from unnest(array[v_row.document_path, v_row.selfie_path]) x where x is not null
  on conflict do nothing;

  update identity_checks
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         reject_reason = case when p_decision = 'approve' then null
                              when p_decision = 'underage' then 'Hai meno di ' || public.min_age_years() || ' anni.'
                              else left(coalesce(nullif(trim(p_reason), ''), 'Documento non leggibile o non corrispondente.'), 200) end,
         reviewed_at = now(), reviewed_by = p_reviewer, document_path = null, selfie_path = null,
         person_key = case when p_decision = 'approve'
                           then (select public.person_key(v.first_name, v.last_name, v.birth_date) from profile_private v where v.id = p_user_id)
                      end
   where user_id = p_user_id;
  if p_decision = 'underage' then
    -- Minore dell'età minima: account chiuso, contenuti e dati personali eliminati; resta solo il nome utente
    -- tra quelli non riutilizzabili.
    insert into banned_usernames (username, reason) select username, 'età' from profiles where id = p_user_id on conflict (username) do nothing;
    update profiles set banned_at = now() where id = p_user_id;
    insert into storage_purge (bucket, path)
    select 'media', x from posts p, public.media_paths(p.media) x where p.author_id = p_user_id
    on conflict do nothing;
    delete from posts where author_id = p_user_id;
    delete from comments where user_id = p_user_id;
    insert into storage_purge (bucket, path) select 'avatars', avatar_path from profiles where id = p_user_id and avatar_path is not null
    on conflict do nothing;
    update profiles set avatar_path = null, bio = '' where id = p_user_id;
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
  v_body text;
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
      -- Un commento cancellato non resta nelle notifiche (con il suo testo): se la stessa persona ha altri
      -- commenti sul post la notifica mostra il più recente, altrimenti sparisce.
      select body into v_body from comments where post_id = old.post_id and user_id = old.user_id order by created_at desc limit 1;
      if v_body is not null then
        update notifications set data = jsonb_build_object('body', left(v_body, 120))
         where kind = 'comment' and actor_id = old.user_id and post_id = old.post_id;
      else
        delete from notifications where kind = 'comment' and actor_id = old.user_id and post_id = old.post_id;
      end if;
      return null;
    end if;
    select author_id into v_author from posts where id = new.post_id;
    perform public.notify(v_author, 'comment', new.user_id, new.post_id, jsonb_build_object('body', left(new.body, 120)));
  elsif tg_table_name = 'arena_entries' then
    if new.tier > old.tier and new.post_id is not null then
      perform public.notify(new.author_id, 'tier', null, new.post_id, jsonb_build_object('tier', new.tier));
    end if;
  elsif tg_table_name = 'daily_viral' then
    -- La copertina esce nel momento in cui la gara chiude: il vincitore lo scopre insieme a tutti.
    perform public.notify(new.author_id, 'cover', null, new.post_id, jsonb_build_object('featured_on', new.featured_on));
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
drop function if exists public.list_notifications(int, timestamptz);
create or replace function public.list_notifications(p_limit int default 50, p_before timestamptz default null, p_before_id bigint default null)
returns setof jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'data', n.data, 'created_at', n.created_at, 'read', n.read_at is not null,
    'actor', case when a.id is null then null else jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path) end,
    'post', case when n.post_id is null then null else jsonb_build_object('id', p.id, 'media', p.media) end
  )
  from notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  where n.user_id = auth.uid()
    and (a.id is null or (a.banned_at is null and not public.is_blocked_pair_internal(auth.uid(), a.id)))
    and (n.post_id is null or p.id is not null)
    and n.created_at <= now()
    -- La notifica "sei la copertina" non arriva prima della rivelazione, anche se l'orario è stato spostato.
    and (n.kind <> 'cover' or coalesce((n.data->>'featured_on')::date, '-infinity'::date) <= public.cover_day())
    -- Pagine per (data, id): notifiche nate nella stessa transazione hanno la stessa data.
    and (n.created_at, n.id) < (coalesce(p_before, 'infinity'), coalesce(p_before_id, 9223372036854775807))
  order by n.created_at desc, n.id desc
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
  select jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path,
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
                                           'can_act', public.can_act(auth.uid()),
                                           'submitted_at', i.submitted_at, 'reviewed_at', i.reviewed_at)
                   from identity_checks i where i.user_id = auth.uid()),
    'is_moderator', public.is_staff(auth.uid()),
    'is_admin', public.is_admin(auth.uid()),
    'banned', exists (select 1 from profiles where id = auth.uid() and banned_at is not null),
    'unread', (select count(*) from notifications n left join profiles a on a.id = n.actor_id
               where n.user_id = auth.uid() and n.read_at is null and n.created_at <= now()
                 and (n.kind <> 'cover' or coalesce((n.data->>'featured_on')::date, '-infinity'::date) <= public.cover_day())
                 and (a.id is null or (a.banned_at is null and not public.is_blocked_pair_internal(auth.uid(), a.id)))),
    'needs_private', not exists (select 1 from profile_private where id = auth.uid()),
    'settings', public.get_settings()
  );
$$;

-- ---------------------------------------------------------------------------
-- 14) Pulizia dei file e controllo degli indirizzi dei media
-- ---------------------------------------------------------------------------
-- Una foto profilo è ancora quella di qualcuno?
create or replace function public.avatar_in_use(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where avatar_path = p_path);
$$;

-- I file da cancellare davvero: un file che un post (o un profilo) usa ancora non si cancella mai,
-- chiunque l'abbia messo in coda.
create or replace function public.storage_purge_pending(p_limit int)
returns table (bucket text, path text) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select q.bucket, q.path from storage_purge q
   where not (q.bucket = 'media' and public.media_in_use(q.path))
     and not (q.bucket = 'avatars' and public.avatar_in_use(q.path))
   order by q.queued_at limit least(greatest(p_limit, 1), 1000);
end;
$$;

-- Dall'app dell'amministratore (ripiego se il lavoro programmato non è configurato).
create or replace function public.storage_purge_list(p_limit int default 200)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  return query select jsonb_build_object('bucket', q.bucket, 'path', q.path) from public.storage_purge_pending(p_limit) q;
end;
$$;

create or replace function public.storage_purge_done(p_bucket text, p_paths text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  delete from storage_purge where bucket = p_bucket and path = any (p_paths);
end;
$$;

-- Dal lavoro programmato (funzione verifica-eta, rotta /lavori, con la chiave di servizio): i file rimossi
-- dalla moderazione o di account chiusi spariscono entro un minuto, senza aspettare l'amministratore.
create or replace function public.storage_purge_take(p_limit int default 500)
returns table (bucket text, path text) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select * from public.storage_purge_pending(p_limit);
end;
$$;

create or replace function public.storage_purge_finish(p_bucket text, p_paths text[])
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from storage_purge where bucket = p_bucket and path = any (p_paths);
$$;

/**
 * Foto e video di un post devono stare nel bucket "media", nella cartella dell'autore: niente immagini
 * da siti esterni (che vedrebbero l'indirizzo di chi guarda, o cambierebbero dopo la moderazione).
 */
create or replace function public.check_media_urls()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Il progetto Supabase di questa app, dal token di chi pubblica (iss = https://<progetto>.supabase.co/auth/v1).
  v_host text := substring(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'iss' from '^https://([^/]+)/');
  v_exists boolean;
  v_item jsonb;
begin
  if exists (
    -- Ogni indirizzo del post: il file e, per i video, l'immagine di anteprima ("poster").
    select 1 from jsonb_array_elements(new.media) m, lateral (values (m->>'url', true), (m->>'poster', m ? 'poster')) v(u, required)
    where v.required and (
          coalesce(v.u, '') !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/' || new.author_id::text || '/[^/?#]+$')
          -- Un altro progetto Supabase andrebbe bene alla regola sopra: il file deve stare nel nostro.
          or (v_host is not null and substring(v.u from '^https://([^/]+)/') is distinct from v_host))
  ) then
    raise exception 'I file del post devono essere caricati dall''app.' using errcode = 'check_violation';
  end if;
  -- E il file deve esistere davvero nel bucket (su Supabase; nei test locali lo Storage non c'è).
  if to_regclass('storage.objects') is not null then
    for v_item in select to_jsonb(x) from public.media_paths(new.media) x loop
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_exists
        using 'media', v_item #>> '{}';
      if not v_exists then
        raise exception 'I file del post devono essere caricati dall''app.' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  -- Ogni file appartiene a un post solo: un secondo post che lo riusa, eliminato, libererebbe il nome del file
  -- del primo (già visto e moderato) per un contenuto nuovo. Il trigger gira prima dell'inserimento: chi
  -- usa già il file è per forza un altro post.
  if exists (select 1 from public.media_paths(new.media) x where public.media_in_use(x))
     or (select count(*) <> count(distinct x) from public.media_paths(new.media) x) then
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
create index if not exists idx_post_likes_user_time on public.post_likes (user_id, created_at desc);
create index if not exists idx_post_likes_post_time on public.post_likes (post_id, created_at desc);
create index if not exists idx_follows_followee_time on public.follows (followee_id, created_at desc);
create index if not exists idx_follows_follower_time on public.follows (follower_id, created_at desc);
create index if not exists idx_notifications_user_time_id on public.notifications (user_id, created_at desc, id desc);

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
    -- Con limiti: i tuoi ultimi 100 mi piace e, per ciascun post, gli ultimi 200 che l'hanno apprezzato.
    select l2.user_id, count(*)::real as n
    from (select post_id from post_likes where user_id = p_uid and created_at > now() - interval '30 days'
          order by created_at desc limit 100) l1
    cross join lateral (select user_id from post_likes where post_id = l1.post_id and user_id <> p_uid
                        order by created_at desc limit 200) l2
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

-- Esplora: tutti i post di tutti (anche quelli in gara e di chi non segui), ordinati per te. Un po' di caso
-- (esplorazione) fa scoprire anche cose nuove, e al massimo due post dello stesso autore per pagina.
-- Guardare qui un post in gara non è un voto: si vota solo in "In gara", dove i post arrivano alla cieca.
-- Finiti quelli nuovi, ripropone i meno recenti (anche già visti): il feed non finisce mai.
create or replace function public.feed_explore(p_limit int default 8, p_exclude uuid[] default '{}')
returns setof jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.arena_today();
  v_limit int := least(greatest(p_limit, 1), 20);
  v_ex uuid[] := coalesce(p_exclude, '{}'::uuid[]);
  v_bounds int[];
  v_pool uuid[];
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  -- Contano gli ultimi 300 mostrati (i più vecchi possono tornare).
  if cardinality(v_ex) > 300 then v_ex := v_ex[cardinality(v_ex) - 299:cardinality(v_ex)]; end if;

  select array_agg(id) into v_pool from (
    select p.id from posts p
    where p.author_id <> v_uid
      and p.created_at > now() - interval '30 days'
      and not (p.id = any (v_ex))
      and not exists (select 1 from seen_posts s where s.user_id = v_uid and s.post_id = p.id and s.seen_at > now() - interval '3 days')
      and public.can_see(p.id, v_uid)
    order by p.created_at desc
    limit 400
  ) x;

  if coalesce(array_length(v_pool, 1), 0) < v_limit then
    -- Visti tutti quelli nuovi: si ripesca a caso tra i 3000 più recenti (indice per data, niente scansione
    -- completa). Si evitano solo gli ultimi 50 mostrati; se non basta (pochi post in tutto) solo gli ultimi 5,
    -- e alla fine nessuno: Esplora non finisce mai finché esiste un post da vedere.
    foreach v_bounds slice 1 in array array[
      array[cardinality(v_ex) - 49, cardinality(v_ex)],
      array[cardinality(v_ex) - 4, cardinality(v_ex)],
      array[1, 0]] loop
      select array_agg(id) into v_pool from (
        select r.id from (
          select p.id from posts p
          where p.author_id <> v_uid
            and not (p.id = any (v_ex[greatest(v_bounds[1], 1):v_bounds[2]]))
          order by p.created_at desc
          limit 3000
        ) r
        order by random()
        limit 600
      ) x where public.can_see(x.id, v_uid);
      exit when v_pool is not null;
    end loop;
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
  v_act := public.can_vote(v_uid);
  for r in
    select distinct on (x.post_id) x.post_id,
           case when x.dwell_ms is null then null else least(greatest(x.dwell_ms, 0), 600000) end as dwell,
           coalesce(x.completed, false) as completed,
           coalesce(x.rewatched, false) as rewatched
    from (select * from jsonb_to_recordset(p_items) as y(post_id uuid, dwell_ms int, completed boolean, rewatched boolean) limit 30) x
    join posts p on p.id = x.post_id and p.author_id <> v_uid
    where public.can_see(x.post_id, v_uid)
  loop
    insert into seen_posts (user_id, post_id, seen_at) values (v_uid, r.post_id, now())
    on conflict (user_id, post_id) do update set seen_at = now();
    -- Senza tempo (post aperto da un link, copertina): conta la visualizzazione, i gusti non cambiano.
    perform public.interest_bump(v_uid, r.post_id,
      case when r.dwell is null then 0
           when r.rewatched then 1.2
           when r.completed then 0.7
           when r.dwell >= 6000 then 0.5
           when r.dwell >= 2500 then 0.2
           when r.dwell < 1200 then -0.4
           else 0 end);
    -- Le visualizzazioni pubbliche le fanno solo account con l'età verificata: account finti appena creati
    -- non gonfiano i numeri.
    if v_act and (r.dwell is null or r.dwell >= 1000) then
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

-- ---------------------------------------------------------------------------
-- 16) Verifica automatica dell'età con Didit (didit.me)
-- ---------------------------------------------------------------------------
-- L'app chiede una sessione alla funzione "verifica-eta" (supabase/functions/verifica-eta), che la apre su Didit.
-- L'utente fotografa il documento e fa un breve video-selfie nel browser; Didit confronta volto e documento e
-- legge la data di nascita. Il risultato arriva alla funzione (webhook firmato), che lo rilegge da Didit e lo
-- passa qui. Queste due funzioni le chiama solo la funzione, con la chiave di servizio: mai l'app.

-- L'amministratore sceglie il metodo dall'app.
create or replace function public.admin_set_id_provider(p_provider text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo per gli amministratori.'; end if;
  if p_provider not in ('manual', 'didit') then raise exception 'Metodo non valido.'; end if;
  update arena_config set id_provider = p_provider where id;
  return public.get_settings();
end;
$$;

-- Nome confrontabile: minuscolo, senza accenti, apostrofi, trattini e spazi doppi.
create or replace function public.name_norm(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(translate(lower(coalesce(p, '')), 'àáâäãèéêëìíîïòóôöõùúûüçñ''’-', 'aaaaaeeeeiiiiooooouuuucn   '), '\s+', ' ', 'g'));
$$;

create or replace function public.person_key(p_first text, p_last text, p_birth date)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_birth is null then null
              else encode(sha256(convert_to(public.name_norm(p_first) || '|' || public.name_norm(p_last) || '|' || p_birth::text, 'UTF8')), 'hex') end;
$$;

create or replace function public.doc_key(p_number text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when length(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g')) < 5 then null
              else encode(sha256(convert_to(upper(regexp_replace(p_number, '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex') end;
$$;

-- Altro account già verificato con la stessa persona (nome, cognome, nascita) o lo stesso documento.
create or replace function public.identity_duplicate(p_user_id uuid, p_person_key text, p_doc_key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select p.username from identity_checks i join profiles p on p.id = i.user_id
   where i.status = 'approved' and i.user_id <> p_user_id
     and ((p_person_key is not null and i.person_key = p_person_key) or (p_doc_key is not null and i.doc_key = p_doc_key))
   limit 1;
$$;

create or replace function public.identity_provider_start(p_user_id uuid, p_session text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_session is null or length(p_session) > 100 then raise exception 'Sessione non valida.'; end if;
  update identity_checks set provider_session = p_session
   where user_id = p_user_id and status <> 'approved';
end;
$$;

-- Esito della verifica automatica. Restituisce cosa è stato deciso ('approved', 'underage', 'rejected',
-- 'review') oppure 'ignored' se l'esito non riguarda la sessione aperta (vecchio, ripetuto, già verificato).
drop function if exists public.identity_provider_result(uuid, text, text, date, text, text);
create or replace function public.identity_provider_result(p_user_id uuid, p_session text, p_status text,
                                                           p_birth_date date, p_first_name text default null, p_last_name text default null,
                                                           p_document_number text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row identity_checks;
  v_priv profile_private;
  v_doc text;
  v_age int;
  v_dup text;
begin
  select * into v_row from identity_checks where user_id = p_user_id for update;
  if not found or v_row.provider_session is distinct from p_session or v_row.status = 'approved' then return 'ignored'; end if;
  if exists (select 1 from profiles where id = p_user_id and banned_at is not null) then return 'ignored'; end if;
  -- Nel frattempo ha mandato le foto all'amministratore: solo un'approvazione automatica le scavalca.
  if v_row.status = 'pending' and v_row.document_path is not null and p_status <> 'Approved' then return 'ignored'; end if;

  if p_status = 'In Review' then
    -- Didit ha dubbi: decide una persona dalla console di Didit, poi arriva un nuovo esito.
    update identity_checks set status = 'pending', method = 'didit', submitted_at = now(), reject_reason = null, provider_note = null
     where user_id = p_user_id;
    return 'review';
  end if;

  if p_status = 'Declined' then
    update identity_checks set method = 'didit' where user_id = p_user_id;
    perform public.identity_apply(p_user_id, 'reject',
      'La verifica automatica non è riuscita: riprova con il documento originale, ben illuminato e senza riflessi', null);
    return 'rejected';
  end if;

  if p_status <> 'Approved' then return 'ignored'; end if;

  update identity_checks set method = 'didit' where user_id = p_user_id;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > public.rome_today() then
    perform public.identity_apply(p_user_id, 'reject', 'Non riesco a leggere la data di nascita: riprova con un altro documento', null);
    return 'rejected';
  end if;
  v_age := extract(year from age(public.rome_today(), p_birth_date))::int;
  if v_age < public.min_age_years() then
    perform public.identity_apply(p_user_id, 'underage', null, null);
    return 'underage';
  end if;
  -- Didit garantisce che documento e volto coincidono, non che siano di chi si è iscritto: se il nome sul
  -- documento non è quello dichiarato (es. un fratello maggiore), decide una persona.
  select * into v_priv from profile_private where id = p_user_id;
  if found then
    v_doc := public.name_norm(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));
    if position(public.name_norm(v_priv.first_name) in v_doc) = 0 or position(public.name_norm(v_priv.last_name) in v_doc) = 0 then
      update identity_checks
         set status = 'pending', method = 'didit', submitted_at = now(), reject_reason = null,
             provider_note = left('Nome sul documento: ' || coalesce(p_first_name, '?') || ' ' || coalesce(p_last_name, '?')
                                  || ', nato/a il ' || to_char(p_birth_date, 'DD/MM/YYYY') || '. Dichiarato: '
                                  || v_priv.first_name || ' ' || v_priv.last_name || '.', 300)
       where user_id = p_user_id;
      return 'review';
    end if;
  end if;
  -- Stessa persona o stesso documento già usati per un altro account verificato: decide una persona.
  -- Si confrontano sia i nomi letti sul documento sia quelli dichiarati (che possono essere parziali).
  v_dup := coalesce(
    public.identity_duplicate(p_user_id, public.person_key(p_first_name, p_last_name, p_birth_date), public.doc_key(p_document_number)),
    public.identity_duplicate(p_user_id, (select public.person_key(v.first_name, v.last_name, p_birth_date) from profile_private v where v.id = p_user_id), null));
  if v_dup is not null then
    update identity_checks
       set status = 'pending', method = 'didit', submitted_at = now(), reject_reason = null,
           provider_note = left('Lo stesso documento o la stessa persona hanno già verificato @' || v_dup
                                || '. Una persona, un account: controlla prima di approvare.', 300),
           doc_key = public.doc_key(p_document_number)
     where user_id = p_user_id;
    return 'review';
  end if;
  update identity_checks set doc_key = public.doc_key(p_document_number) where user_id = p_user_id;
  -- Fa fede il documento: la data di nascita privata diventa quella letta da Didit.
  insert into profile_private (id, first_name, last_name, birth_date)
  values (p_user_id, left(coalesce(nullif(trim(p_first_name), ''), '-'), 60), left(coalesce(nullif(trim(p_last_name), ''), '-'), 60), p_birth_date)
  on conflict (id) do update set birth_date = excluded.birth_date;
  perform public.identity_apply(p_user_id, 'approve', null, null);
  -- L'impronta salvata è quella dei nomi sul documento (fa fede il documento, non come uno si è iscritto).
  update identity_checks set person_key = public.person_key(p_first_name, p_last_name, p_birth_date)
   where user_id = p_user_id and p_first_name is not null and p_last_name is not null;
  return 'approved';
end;
$$;

-- ---------------------------------------------------------------------------
-- 17) Protezioni aggiuntive (revisione di sicurezza)
-- ---------------------------------------------------------------------------
-- Date decise dal server anche per follow, mi piace, salvataggi e condivisioni: un client non può datare
-- un follow nel futuro (invisibile negli elenchi) o un mi piace "recente" per pilotare i consigli.
revoke insert on public.post_likes, public.post_saves, public.follows from authenticated;
grant insert (post_id, user_id) on public.post_likes, public.post_saves to authenticated;
grant insert (follower_id, followee_id) on public.follows to authenticated;
create or replace function public.force_created_now()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists trg_likes_now on public.post_likes;
create trigger trg_likes_now before insert on public.post_likes for each row execute function public.force_created_now();
drop trigger if exists trg_saves_now on public.post_saves;
create trigger trg_saves_now before insert on public.post_saves for each row execute function public.force_created_now();
drop trigger if exists trg_shares_now on public.post_shares;
create trigger trg_shares_now before insert on public.post_shares for each row execute function public.force_created_now();
drop trigger if exists trg_follows_now on public.follows;
create trigger trg_follows_now before insert on public.follows for each row execute function public.force_created_now();

-- Limiti di velocità: un account (anche verificato) non può seguire, commentare, mettere mi piace o segnalare
-- a raffica. Valori larghi per una persona vera, stretti per un programma.
create index if not exists idx_comments_user_time on public.comments (user_id, created_at desc);
create index if not exists idx_reports_reporter_time on public.reports (reporter_id, created_at desc);
-- Ogni azione lascia una traccia (anche se poi viene tolta): togliere e rimettere un mi piace a raffica conta.
create table if not exists public.rate_events (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists idx_rate_events on public.rate_events (user_id, kind, at desc);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

create or replace function public.rate_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_window interval := case tg_table_name when 'follows' then interval '1 hour' when 'reports' then interval '1 hour'
                                          when 'user_reports' then interval '1 hour'
                                          when 'comments' then interval '5 minutes' else interval '10 minutes' end;
  v_max int := case tg_table_name when 'post_likes' then 300 when 'post_saves' then 200 when 'follows' then 150
                                  when 'comments' then 20 else 30 end;
  v_n int;
begin
  if tg_table_name = 'follows' then v_user := new.follower_id;
  elsif tg_table_name in ('reports', 'user_reports') then v_user := new.reporter_id;
  else v_user := new.user_id; end if;
  -- Segnalazioni di post, commenti e profili contano insieme: lo stesso tetto per tutte.
  select count(*) into v_n from rate_events where user_id = v_user
     and kind = any (case when tg_table_name in ('reports', 'user_reports') then array['reports', 'user_reports'] else array[tg_table_name] end)
     and at > now() - v_window;
  if v_n >= v_max then
    raise exception '%', case tg_table_name
      when 'post_likes' then 'Troppi mi piace in poco tempo: riprova tra qualche minuto.'
      when 'post_saves' then 'Troppi salvataggi in poco tempo: riprova tra qualche minuto.'
      when 'follows' then 'Hai iniziato a seguire troppe persone in poco tempo: riprova più tardi.'
      when 'comments' then 'Troppi commenti in poco tempo: riprova tra qualche minuto.'
      else 'Troppe segnalazioni in poco tempo: riprova più tardi.' end;
  end if;
  insert into rate_events (user_id, kind) values (v_user, tg_table_name);
  return new;
end;
$$;
drop trigger if exists trg_rate_likes on public.post_likes;
create trigger trg_rate_likes before insert on public.post_likes for each row execute function public.rate_guard();
drop trigger if exists trg_rate_saves on public.post_saves;
create trigger trg_rate_saves before insert on public.post_saves for each row execute function public.rate_guard();
drop trigger if exists trg_rate_follows on public.follows;
create trigger trg_rate_follows before insert on public.follows for each row execute function public.rate_guard();
drop trigger if exists trg_rate_comments on public.comments;
create trigger trg_rate_comments before insert on public.comments for each row execute function public.rate_guard();
drop trigger if exists trg_rate_reports on public.reports;
create trigger trg_rate_reports before insert on public.reports for each row execute function public.rate_guard();
drop trigger if exists trg_rate_user_reports on public.user_reports;
create trigger trg_rate_user_reports before insert on public.user_reports for each row execute function public.rate_guard();
create index if not exists idx_user_reports_reporter_time on public.user_reports (reporter_id, created_at desc);

-- Chi verifica i documenti resta riservato: l'utente legge il proprio esito, non il nome dell'amministratore.
revoke select on public.identity_checks from authenticated;
grant select (user_id, status, deadline, submitted_at, reviewed_at, reject_reason, method) on public.identity_checks to authenticated;

-- I file di un post eliminato (dall'autore, per età, con l'account) vanno in pulizia: niente file orfani pubblici.
create or replace function public.purge_post_media()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Solo i file che nessun altro post usa (il post eliminato non c'è già più).
  insert into storage_purge (bucket, path)
  select 'media', x from public.media_paths(old.media) x where not public.media_in_use(x)
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists trg_posts_purge_media on public.posts;
create trigger trg_posts_purge_media after delete on public.posts for each row execute function public.purge_post_media();

-- Un file del bucket media è usato da un post del suo autore? (Regola dello Storage: non si cancella né
-- si sostituisce il file di un post pubblicato, così il contenuto non cambia dopo la moderazione.)
create or replace function public.media_in_use(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select split_part(p_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (
       select 1 from posts p, jsonb_array_elements(p.media) m
        where p.author_id = split_part(p_path, '/', 1)::uuid
          and (public.media_path(m->>'url') = p_path or public.media_path(m->>'poster') = p_path)
     );
$$;

-- Il nome di accesso è legato al nome utente: un account non può prendersi altri nomi cambiando email.
create or replace function public.guard_login_email()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_username text;
begin
  if new.email is not distinct from old.email then return new; end if;
  select username into v_username from public.profiles where id = new.id;
  if v_username is not null and lower(coalesce(new.email, '')) <> v_username || '@' || public.login_domain() then
    raise exception 'Il nome di accesso non si può cambiare.';
  end if;
  return new;
end;
$$;
do $$ begin
  drop trigger if exists trg_guard_login_email on auth.users;
  create trigger trg_guard_login_email before update of email on auth.users for each row execute function public.guard_login_email();
exception when insufficient_privilege then
  raise notice 'Non ho i permessi per il controllo sul nome di accesso (auth.users): salto.';
end $$;

-- ---------------------------------------------------------------------------
-- 18) Modifica del profilo: nome mostrato, bio e foto, con regole (prima si scrivevano senza controlli)
-- ---------------------------------------------------------------------------
-- Un parametro null vuol dire "non cambia". Con la verifica dell'età scaduta si guarda soltanto.
create or replace function public.update_my_profile(p_display_name text default null, p_bio text default null,
                                                    p_avatar_path text default null, p_remove_avatar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_pr profiles;
  v_name text;
  v_bio text;
  v_avatar text;
  v_exists boolean;
begin
  if v_uid is null or not public.is_active(v_uid) then raise exception 'Autenticazione richiesta'; end if;
  if not public.can_act(v_uid) then raise exception 'Per modificare il profilo serve la verifica dell’età.'; end if;
  if (select count(*) from rate_events where user_id = v_uid and kind = 'profile' and at > now() - interval '1 hour') >= 10 then
    raise exception 'Troppe modifiche in poco tempo: riprova più tardi.';
  end if;
  insert into rate_events (user_id, kind) values (v_uid, 'profile');
  select * into v_pr from profiles where id = v_uid for update;
  v_name := v_pr.display_name;
  v_bio := v_pr.bio;
  v_avatar := v_pr.avatar_path;

  if p_display_name is not null then
    v_name := regexp_replace(trim(p_display_name), '\s+', ' ', 'g');
    if length(v_name) not between 1 and 30 then raise exception 'Il nome può avere da 1 a 30 caratteri.'; end if;
    if v_name ~ '[[:cntrl:]]' then raise exception 'Il nome contiene caratteri non validi.'; end if;
    -- Nessuno si spaccia per l'app o per chi la gestisce.
    if lower(v_name) ~ '(virale|staff|moderat|amministrat|supporto)' then raise exception 'Questo nome non è disponibile.'; end if;
    if v_name is distinct from v_pr.display_name then
      if v_pr.name_changed_at > now() - interval '7 days' then raise exception 'Puoi cambiare il nome una volta ogni 7 giorni.'; end if;
    end if;
  end if;

  if p_bio is not null then
    v_bio := trim(p_bio);
    if length(v_bio) > 160 then raise exception 'La bio può avere al massimo 160 caratteri.'; end if;
    if length(v_bio) - length(replace(v_bio, E'\n', '')) > 4 then raise exception 'La bio può andare a capo al massimo 4 volte.'; end if;
    if replace(v_bio, E'\n', '') ~ '[[:cntrl:]]' then raise exception 'La bio contiene caratteri non validi.'; end if;
  end if;

  if coalesce(p_remove_avatar, false) then
    v_avatar := null;
  elsif p_avatar_path is not null then
    if p_avatar_path !~ ('^' || v_uid::text || '/avatar-[0-9]{10,16}\.jpg$') then raise exception 'Foto non valida.'; end if;
    -- Su Supabase la foto deve esistere davvero nel bucket "avatars" (nei test locali lo Storage non c'è).
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''avatars'' and name = $1)' into v_exists using p_avatar_path;
      if not v_exists then raise exception 'Foto non valida.'; end if;
    end if;
    v_avatar := p_avatar_path;
  end if;
  -- La foto di prima va cancellata dallo Storage.
  if v_pr.avatar_path is not null and v_avatar is distinct from v_pr.avatar_path then
    insert into storage_purge (bucket, path) values ('avatars', v_pr.avatar_path) on conflict do nothing;
  end if;

  update profiles
     set display_name = v_name, bio = v_bio, avatar_path = v_avatar,
         name_changed_at = case when v_name is distinct from v_pr.display_name then now() else name_changed_at end
   where id = v_uid
  returning * into v_pr;
  return jsonb_build_object('id', v_pr.id, 'username', v_pr.username, 'display_name', v_pr.display_name, 'bio', v_pr.bio,
                            'avatar_path', v_pr.avatar_path, 'name_changed_at', v_pr.name_changed_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 19) Cerca persone (solo profili: la gara resta alla cieca)
-- ---------------------------------------------------------------------------
create index if not exists idx_profiles_username_prefix on public.profiles (username text_pattern_ops);
create index if not exists idx_profiles_display_prefix on public.profiles (lower(display_name) text_pattern_ops);

-- Per @nome o per nome, dall'inizio: prima il nome utente identico, poi chi comincia così, poi i più seguiti.
-- Niente espulsi, niente persone bloccate (nei due sensi), non sé stessi. Da 2 caratteri, al massimo 30 risultati.
create or replace function public.search_profiles(p_query text, p_limit int default 20)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_q text := left(regexp_replace(lower(trim(coalesce(p_query, ''))), '^@+', ''), 30);
  v_like text;
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  if length(v_q) < 2 then return; end if;
  -- "_" e "%" sono lettere da cercare, non jolly.
  v_like := replace(replace(replace(v_q, '\', '\\'), '_', '\_'), '%', '\%') || '%';
  return query
  with c as (
    (select p.* from profiles p where p.username like v_like order by p.username limit 200)
    union
    (select p.* from profiles p where lower(p.display_name) like v_like order by lower(p.display_name) limit 200)
  )
  select jsonb_build_object('id', c.id, 'username', c.username, 'display_name', c.display_name, 'avatar_path', c.avatar_path,
                            'followed', exists (select 1 from follows f where f.follower_id = v_uid and f.followee_id = c.id))
  from c
  where c.id <> v_uid and c.banned_at is null and not public.is_blocked_pair(v_uid, c.id)
  order by (c.username = v_q) desc, (c.username like v_like) desc,
           (select count(*) from follows f where f.followee_id = c.id) desc, c.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
end;
$$;

-- Prima volta con la gara che chiude all'orario della copertina (database che usavano la mezzanotte):
-- se ieri non ha avuto una copertina la si sceglie adesso, e tutti i giorni di calendario passati risultano chiusi.
do $$
declare
  v_today date := public.rome_today();
begin
  if not exists (select 1 from public.arena_closed_days) then
    if exists (select 1 from public.arena_entries where contest_day = v_today - 1)
       and not exists (select 1 from public.daily_viral where contest_day = v_today - 1) then
      perform public.arena_close_day(v_today - 1);
    end if;
    insert into public.arena_closed_days (contest_day)
    select d::date from generate_series(
      least(coalesce((select min(contest_day) from public.arena_entries), v_today), v_today - 1), v_today - 1, interval '1 day') d
    on conflict do nothing;
  end if;
end $$;


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
revoke all on function public.arena_close_due() from public, anon, authenticated;
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
grant execute on function public.get_cover_archive(int, date) to authenticated;
grant execute on function public.get_cover(date) to authenticated;
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
-- Segnalazioni di commenti e profili, e la loro coda.
grant execute on function public.report_comment(uuid, text, text) to authenticated;
grant execute on function public.report_profile(uuid, text, text) to authenticated;
grant execute on function public.mod_user_reports() to authenticated;
grant execute on function public.mod_resolve_user_report(text, uuid, text) to authenticated;
grant execute on function public.update_my_profile(text, text, text, boolean) to authenticated;
grant execute on function public.search_profiles(text, int) to authenticated;
-- Pulizia dei file dal lavoro programmato: solo con la chiave di servizio.
revoke all on function public.storage_purge_take(int) from public, anon, authenticated;
revoke all on function public.storage_purge_finish(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_purge_take(int) to service_role;
grant execute on function public.storage_purge_finish(text, text[]) to service_role;
revoke all on function public.mod_ban_user(uuid) from public, anon, authenticated;
revoke all on function public.mod_reset_profile(uuid) from public, anon, authenticated;
grant execute on function public.list_notifications(int, timestamptz, bigint) to authenticated;
grant execute on function public.mark_notifications_read(timestamptz) to authenticated;
grant execute on function public.register_views(uuid[]) to authenticated;
grant execute on function public.list_follows(text, text, int, timestamptz) to authenticated;
grant execute on function public.feed_explore(int, uuid[]) to authenticated;
grant execute on function public.track_views(jsonb) to authenticated;
grant execute on function public.admin_set_id_provider(text) to authenticated;
-- Usate dalle regole dello Storage sui bucket media e avatars (setup-produzione.sql).
grant execute on function public.media_in_use(text) to authenticated;
grant execute on function public.avatar_in_use(text) to authenticated;
-- Solo per la funzione verifica-eta (chiave di servizio).
revoke all on function public.identity_provider_start(uuid, text) from public, anon, authenticated;
revoke all on function public.identity_provider_result(uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.identity_apply(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.identity_provider_start(uuid, text) to service_role;
grant execute on function public.identity_provider_result(uuid, text, text, date, text, text, text) to service_role;
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

