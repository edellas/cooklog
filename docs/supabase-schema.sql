-- Cooklog social schema
-- Esegui in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Timestamp trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  interest text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, interest)
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_post_id uuid,
  title text not null,
  description text,
  image_url text,
  category text not null,
  cooking_time_minutes int not null default 0,
  servings int not null default 1,
  personal_notes text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null,
  quantity text,
  sort_order int not null default 0
);

create table if not exists public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  step_text text not null,
  sort_order int not null default 0
);

create table if not exists public.food_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete cascade,
  title text not null,
  description text,
  media_url text not null,
  media_type text not null default 'image',
  category text not null,
  cooking_time_minutes int not null default 0,
  servings int not null default 1,
  interests text[] not null default '{}',
  like_count int not null default 0,
  comment_count int not null default 0,
  save_count int not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.food_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.saved_posts (
  post_id uuid not null references public.food_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.food_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_recipes_owner_id on public.recipes(owner_id);
create index if not exists idx_food_posts_author_id on public.food_posts(author_id);
create index if not exists idx_food_posts_created_at on public.food_posts(created_at desc);
create index if not exists idx_food_posts_public on public.food_posts(is_public);
create index if not exists idx_post_likes_user on public.post_likes(user_id);
create index if not exists idx_saved_posts_user on public.saved_posts(user_id);
create index if not exists idx_comments_post on public.comments(post_id);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_recipes_updated_at on public.recipes;
create trigger trg_recipes_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

drop trigger if exists trg_food_posts_updated_at on public.food_posts;
create trigger trg_food_posts_updated_at
before update on public.food_posts
for each row execute function public.set_updated_at();

-- Counter functions
create or replace function public.increment_post_like_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set like_count = like_count + 1 where id = post_uuid;
$$;

create or replace function public.decrement_post_like_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set like_count = greatest(like_count - 1, 0) where id = post_uuid;
$$;

create or replace function public.increment_post_save_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set save_count = save_count + 1 where id = post_uuid;
$$;

create or replace function public.decrement_post_save_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set save_count = greatest(save_count - 1, 0) where id = post_uuid;
$$;

create or replace function public.increment_post_comment_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set comment_count = comment_count + 1 where id = post_uuid;
$$;

create or replace function public.decrement_post_comment_count(post_uuid uuid)
returns void language sql as $$
  update public.food_posts set comment_count = greatest(comment_count - 1, 0) where id = post_uuid;
$$;

alter table public.profiles enable row level security;
alter table public.user_interests enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.food_posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.saved_posts enable row level security;
alter table public.comments enable row level security;

-- profiles
create policy "profiles readable by authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "profiles update own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profiles insert own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

-- interests
create policy "interests owner manage"
on public.user_interests for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- recipes
create policy "recipes read own or public-linked"
on public.recipes for select
to authenticated
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.food_posts fp
    where fp.recipe_id = recipes.id and fp.is_public = true
  )
);

create policy "recipes owner write"
on public.recipes for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- ingredients/steps readable if recipe readable
create policy "ingredients read if recipe readable"
on public.recipe_ingredients for select
to authenticated
using (
  exists (
    select 1 from public.recipes r
    where r.id = recipe_ingredients.recipe_id
      and (
        auth.uid() = r.owner_id
        or exists (select 1 from public.food_posts fp where fp.recipe_id = r.id and fp.is_public = true)
      )
  )
);

create policy "ingredients owner manage"
on public.recipe_ingredients for all
to authenticated
using (
  exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.recipes r where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid())
);

create policy "steps read if recipe readable"
on public.recipe_steps for select
to authenticated
using (
  exists (
    select 1 from public.recipes r
    where r.id = recipe_steps.recipe_id
      and (
        auth.uid() = r.owner_id
        or exists (select 1 from public.food_posts fp where fp.recipe_id = r.id and fp.is_public = true)
      )
  )
);

create policy "steps owner manage"
on public.recipe_steps for all
to authenticated
using (
  exists (select 1 from public.recipes r where r.id = recipe_steps.recipe_id and r.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.recipes r where r.id = recipe_steps.recipe_id and r.owner_id = auth.uid())
);

-- food posts
create policy "food posts readable authenticated"
on public.food_posts for select
to authenticated
using (is_public = true or auth.uid() = author_id);

create policy "food posts author write"
on public.food_posts for all
to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

-- likes/saves/comments
create policy "likes readable authenticated"
on public.post_likes for select
to authenticated
using (true);

create policy "likes insert own"
on public.post_likes for insert
to authenticated
with check (auth.uid() = user_id);

create policy "likes delete own"
on public.post_likes for delete
to authenticated
using (auth.uid() = user_id);

create policy "saves readable authenticated"
on public.saved_posts for select
to authenticated
using (true);

create policy "saves insert own"
on public.saved_posts for insert
to authenticated
with check (auth.uid() = user_id);

create policy "saves delete own"
on public.saved_posts for delete
to authenticated
using (auth.uid() = user_id);

create policy "comments readable authenticated"
on public.comments for select
to authenticated
using (true);

create policy "comments insert own"
on public.comments for insert
to authenticated
with check (auth.uid() = user_id);

create policy "comments delete own"
on public.comments for delete
to authenticated
using (auth.uid() = user_id);

-- Storage bucket notes:
-- 1) crea bucket: avatars (public false) e food-media (public false).
-- 2) policies storage.objects:
--    - select per utenti autenticati su entrambi i bucket.
--    - insert/update/delete su avatars solo con path che inizia con auth.uid().
--    - insert/update/delete su food-media solo autenticati (consigliato anche prefisso auth.uid()).
