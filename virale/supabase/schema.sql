-- Virale · schema Supabase
-- Esegui tutto nel SQL Editor di Supabase (Database → SQL Editor), poi abilita pg_cron (sezione 8).
-- Stessa logica di src/engine/engine.ts: se cambi pesi o soglie, aggiornali in entrambi.
--
-- Flusso:
--   giorno D     create_post() + arena_submit()   -> un contenuto in gara per utente
--                arena_next_batch()   -> il server sceglie cosa mostrare (alla cieca)
--                arena_record_view()  -> segnali impliciti, promozione tra livelli
--   fine di D    arena_close_day(D)   -> pg_cron, un solo vincitore in daily_viral
--   giorno D+1   get_daily_viral()    -> lo stesso contenuto per tutti, appena si apre l'app

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profili e contenuti
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('video', 'image', 'text')),
  -- URL pubblico nello Storage (bucket "media"); null per i post di solo testo.
  media_url text,
  body text,
  caption text not null default '',
  background text not null default '#111111',
  created_at timestamptz not null default now(),
  check (media_type = 'text' or media_url is not null),
  check (media_type <> 'text' or length(coalesce(body, '')) between 1 and 280)
);
create index if not exists idx_posts_author on public.posts (author_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts for select to anon, authenticated using (true);
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts for delete to authenticated using (auth.uid() = author_id);

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
  stat_shards int not null default 16
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

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists public.arena_entries (
  id uuid primary key default gen_random_uuid(),
  contest_day date not null,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  tier smallint not null default 0,
  status text not null default 'active' check (status in ('active', 'parked', 'finalist', 'disqualified')),
  last_score numeric,
  -- Chiave casuale indicizzata: permette di campionare candidati in O(log n) anche con centinaia di migliaia di contenuti.
  rand_key double precision not null default random(),
  created_at timestamptz not null default now(),
  unique (contest_day, author_id),
  unique (contest_day, post_id)
);
create index if not exists idx_arena_entries_pick on public.arena_entries (contest_day, status, tier, rand_key);

-- Contatori "shardati": i finalisti ricevono migliaia di viste al secondo, una sola riga
-- diventerebbe un collo di bottiglia per i lock. Ogni vista incrementa uno shard a caso.
create table if not exists public.arena_entry_stats (
  entry_id uuid not null references public.arena_entries(id) on delete cascade,
  shard smallint not null,
  views int not null default 0,
  completes int not null default 0,
  rewatches int not null default 0,
  likes int not null default 0,
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
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  final_score numeric not null,
  total_entries int not null,
  total_views bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_daily_viral_author on public.daily_viral (author_id, featured_on desc);

-- ---------------------------------------------------------------------------
-- RLS: lettura pubblica per autenticati, scritture solo tramite le funzioni qui sotto
-- ---------------------------------------------------------------------------
alter table public.arena_config enable row level security;
alter table public.arena_entries enable row level security;
alter table public.arena_entry_stats enable row level security;
alter table public.arena_views enable row level security;
alter table public.arena_tier_results enable row level security;
alter table public.daily_viral enable row level security;

drop policy if exists "arena entries readable" on public.arena_entries;
create policy "arena entries readable" on public.arena_entries for select to authenticated using (true);
drop policy if exists "arena views own" on public.arena_views;
create policy "arena views own" on public.arena_views for select to authenticated using (auth.uid() = viewer_id);
drop policy if exists "daily viral readable" on public.daily_viral;
create policy "daily viral readable" on public.daily_viral for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Punteggio (identico a qualityScore / lowerBoundScore in engine.ts)
-- ---------------------------------------------------------------------------
create or replace function public.arena_points(s public.arena_entry_stats)
returns numeric language sql immutable as $$
  select s.completes * 1.0 + s.rewatches * 1.5 + s.likes * 2 + s.saves * 3 + s.shares * 6 - s.skips * 1.5 - s.reports * 20;
$$;

create or replace function public.arena_entry_totals(p_entry_id uuid)
returns public.arena_entry_stats language sql stable security definer set search_path = public as $$
  select p_entry_id, 0::smallint,
         coalesce(sum(views), 0)::int, coalesce(sum(completes), 0)::int, coalesce(sum(rewatches), 0)::int,
         coalesce(sum(likes), 0)::int,
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
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_day date := public.arena_today();
  v_entry public.arena_entries;
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;
  if extract(hour from now() at time zone v_cfg.time_zone) >= v_cfg.submission_cutoff_hour then
    raise exception 'Candidature chiuse per oggi: riprova domani.';
  end if;
  if not exists (select 1 from posts where id = p_post_id and author_id = v_uid) then
    raise exception 'Puoi candidare solo un tuo contenuto.';
  end if;
  if exists (
    select 1 from daily_viral
    where author_id = v_uid and featured_on > v_day - v_cfg.winner_cooldown_days
  ) then
    raise exception 'Hai già vinto di recente: potrai ripartecipare tra qualche giorno.';
  end if;

  insert into arena_entries (contest_day, post_id, author_id)
  values (v_day, p_post_id, v_uid)
  returning * into v_entry;
  return v_entry;
exception when unique_violation then
  raise exception 'Puoi candidare un solo contenuto al giorno.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Prossimi contenuti da mostrare (scelti dal server, mai dall'utente)
-- ---------------------------------------------------------------------------
-- Campiona fino a p_n candidati di un intervallo di livelli partendo da un punto casuale dell'indice.
create or replace function public.arena_pick(p_day date, p_viewer uuid, p_min_tier int, p_max_tier int, p_n int)
returns setof public.arena_entries
language plpgsql volatile set search_path = public as $$
declare
  v_start double precision := random();
begin
  return query
  with candidates as (
    (select e.* from arena_entries e
      where e.contest_day = p_day and e.status in ('active', 'finalist')
        and e.tier between p_min_tier and p_max_tier and e.rand_key >= v_start
        and e.author_id <> p_viewer
        and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
      order by e.rand_key limit p_n)
    union all
    (select e.* from arena_entries e
      where e.contest_day = p_day and e.status in ('active', 'finalist')
        and e.tier between p_min_tier and p_max_tier and e.rand_key < v_start
        and e.author_id <> p_viewer
        and not exists (select 1 from arena_views v where v.entry_id = e.id and v.viewer_id = p_viewer)
      order by e.rand_key limit p_n)
  )
  select * from candidates limit p_n;
end;
$$;

create or replace function public.arena_next_batch(p_limit int default 10)
returns table (
  entry_id uuid, post_id uuid, tier smallint, author_id uuid, author_username text, author_name text,
  media_type text, media_url text, body text, caption text, background text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_day date := public.arena_today();
  v_limit int := least(greatest(p_limit, 1), 20);
  v_upper_slots int := ceil(least(greatest(p_limit, 1), 20) * v_cfg.upper_share);
  v_ids uuid[];
begin
  if v_uid is null then raise exception 'Autenticazione richiesta'; end if;

  with upper_pool as (
    select p.id, p.tier from public.arena_pick(v_day, v_uid, 1, 32767, 200) p
  ), upper_pick as (
    -- Campionamento pesato per livello (Efraimidis–Spirakis), come serveBatch in engine.ts.
    select id from upper_pool order by -ln(greatest(random(), 1e-12)) / (1 + upper_pool.tier) limit v_upper_slots
  ), lower_pick as (
    select p.id from public.arena_pick(v_day, v_uid, 0, 0, v_limit) p
  ), merged as (
    select id, 0 as pri from upper_pick
    union all select id, 1 from lower_pick
    union all select id, 2 from upper_pool where id not in (select id from upper_pick)
  )
  select array_agg(id) into v_ids from (select id from merged order by pri, random() limit v_limit) x;

  if v_ids is null then return; end if;

  insert into arena_views (entry_id, viewer_id, contest_day)
  select unnest(v_ids), v_uid, v_day
  on conflict do nothing;

  return query
  select e.id, p.id, e.tier, e.author_id, pr.username, pr.display_name,
         p.media_type, p.media_url, p.body, p.caption, p.background, p.created_at
  from arena_entries e
  join posts p on p.id = e.post_id
  left join profiles pr on pr.id = e.author_id
  where e.id = any (v_ids)
  order by random();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Valutazione di fine livello (interna)
-- ---------------------------------------------------------------------------
create or replace function public.arena_evaluate(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
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
  select * into v_entry from arena_entries where id = p_entry_id for update;
  if not found or v_entry.status not in ('active', 'finalist') then return; end if;

  v_stats := public.arena_entry_totals(p_entry_id);

  if v_stats.views >= v_cfg.report_min_views
     and v_stats.reports::numeric / v_stats.views > v_cfg.max_report_rate then
    update arena_entries set status = 'disqualified' where id = p_entry_id;
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
  p_saved boolean default false,
  p_shared boolean default false,
  p_reported boolean default false
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.arena_config := public.arena_cfg();
  v_dwell int := least(greatest(coalesce(p_dwell_ms, 0), 0), v_cfg.max_dwell_ms);
  v_views int;
  v_entry public.arena_entries;
begin
  if v_uid is null then return false; end if;

  -- Solo contenuti serviti a questo utente, solo una volta, solo il giorno stesso.
  update arena_views set recorded_at = now()
   where entry_id = p_entry_id and viewer_id = v_uid and recorded_at is null
     and contest_day = public.arena_today();
  if not found then return false; end if;

  -- Gli account appena creati guardano ma non votano.
  if exists (select 1 from profiles where id = v_uid and created_at > now() - v_cfg.min_viewer_account_age) then
    return false;
  end if;

  insert into arena_entry_stats as s (entry_id, shard, views, completes, rewatches, likes, saves, shares, skips, reports, dwell_ms)
  values (
    p_entry_id, floor(random() * v_cfg.stat_shards)::smallint, 1,
    coalesce(p_completed, v_dwell >= v_cfg.complete_dwell_ms)::int, coalesce(p_rewatched, false)::int,
    coalesce(p_liked, false)::int, coalesce(p_saved, false)::int,
    coalesce(p_shared, false)::int, (v_dwell < v_cfg.skip_dwell_ms)::int, coalesce(p_reported, false)::int, v_dwell
  )
  on conflict (entry_id, shard) do update set
    views = s.views + 1,
    completes = s.completes + excluded.completes,
    rewatches = s.rewatches + excluded.rewatches,
    likes = s.likes + excluded.likes,
    saves = s.saves + excluded.saves,
    shares = s.shares + excluded.shares,
    skips = s.skips + excluded.skips,
    reports = s.reports + excluded.reports,
    dwell_ms = s.dwell_ms + excluded.dwell_ms;

  select * into v_entry from arena_entries where id = p_entry_id;
  select coalesce(sum(views), 0) into v_views from arena_entry_stats where entry_id = p_entry_id;
  -- I finalisti non vengono rivalutati a ogni vista (eviterebbe il lock sulla riga calda),
  -- solo quando arriva una segnalazione.
  if (v_entry.status = 'active' and v_views >= coalesce(v_cfg.tier_thresholds[v_entry.tier + 1], 2147483647))
     or (p_reported and v_views >= v_cfg.report_min_views) then
    perform public.arena_evaluate(p_entry_id);
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Stato del mio contenuto in gara
-- ---------------------------------------------------------------------------
create or replace function public.arena_my_entry()
returns table (entry_id uuid, post_id uuid, tier smallint, status text, views int, contest_day date)
language sql stable security definer set search_path = public as $$
  select e.id, e.post_id, e.tier, e.status, (public.arena_entry_totals(e.id)).views, e.contest_day
  from arena_entries e
  where e.author_id = auth.uid() and e.contest_day = public.arena_today();
$$;

-- ---------------------------------------------------------------------------
-- 6) Chiusura della giornata: un solo vincitore (solo service_role / pg_cron)
-- ---------------------------------------------------------------------------
create or replace function public.arena_close_day(p_day date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.arena_config := public.arena_cfg();
  v_winner record;
  v_total_entries int;
  v_total_views bigint;
begin
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
create or replace function public.get_daily_viral()
returns table (
  featured_on date, contest_day date, post_id uuid, author_id uuid, author_username text, author_name text,
  media_type text, media_url text, body text, caption text, background text,
  total_entries int, total_views bigint, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.featured_on, d.contest_day, p.id, d.author_id, pr.username, pr.display_name,
         p.media_type, p.media_url, p.body, p.caption, p.background,
         d.total_entries, d.total_views, p.created_at
  from daily_viral d
  join posts p on p.id = d.post_id
  left join profiles pr on pr.id = d.author_id
  where d.featured_on = public.arena_today();
$$;

-- Albo d'oro: i vincitori dei giorni passati.
create or replace function public.get_hall_of_fame(p_limit int default 30)
returns table (
  featured_on date, post_id uuid, author_id uuid, author_username text, author_name text,
  media_type text, media_url text, body text, caption text, background text,
  total_entries int, total_views bigint, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.featured_on, p.id, d.author_id, pr.username, pr.display_name,
         p.media_type, p.media_url, p.body, p.caption, p.background,
         d.total_entries, d.total_views, p.created_at
  from daily_viral d
  join posts p on p.id = d.post_id
  left join profiles pr on pr.id = d.author_id
  where d.featured_on <= public.arena_today()
  order by d.featured_on desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Permessi: i client chiamano solo queste funzioni.
revoke all on function public.arena_close_day(date) from public, anon, authenticated;
revoke all on function public.arena_evaluate(uuid) from public, anon, authenticated;
revoke all on function public.arena_entry_totals(uuid) from public, anon, authenticated;
revoke all on function public.arena_pick(date, uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.arena_submit(uuid) to authenticated;
grant execute on function public.arena_next_batch(int) to authenticated;
grant execute on function public.arena_record_view(uuid, int, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.arena_my_entry() to authenticated;
grant execute on function public.get_daily_viral() to anon, authenticated;
grant execute on function public.get_hall_of_fame(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Pianificazione (Database → Extensions → abilita pg_cron)
-- ---------------------------------------------------------------------------
-- 00:05 UTC è già il giorno dopo a Roma: si chiude il giorno di gara precedente.
-- select cron.schedule(
--   'arena-close-day',
--   '5 0 * * *',
--   $$ select public.arena_close_day(public.arena_today() - 1) $$
-- );

-- ---------------------------------------------------------------------------
-- 9) Storage per video e foto
-- ---------------------------------------------------------------------------
-- Crea un bucket pubblico "media" (Storage → New bucket) e queste policy:
-- create policy "media upload own folder" on storage.objects for insert to authenticated
--   with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "media delete own" on storage.objects for delete to authenticated
--   using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
-- Per i video consigliato: limite di 50 MB per file (Storage → Settings) e una CDN davanti al bucket.
