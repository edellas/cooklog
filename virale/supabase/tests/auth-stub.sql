-- Stub minimo di Supabase (ruoli, auth.uid(), privilegi di default) per testare lo schema su un Postgres locale.
do $$ begin create role anon nologin; create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
-- Come su Supabase: un'identità per ogni modo di accesso (email per nome utente e password, google, facebook…).
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, provider_id text not null, identity_data jsonb not null default '{}',
  email text generated always as (lower(identity_data ->> 'email')) stored, unique (provider_id, provider));
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- Come su Supabase: i ruoli API hanno privilegi sulle tabelle, è la RLS a filtrare.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
