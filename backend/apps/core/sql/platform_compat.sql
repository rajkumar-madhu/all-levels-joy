-- Platform objects the legacy Supabase migrations depend on, recreated for plain PostgreSQL 16.
-- Safe to run repeatedly and safe on a database restored from a Supabase dump (existing objects
-- are kept; only auth.uid() is redefined, with the same claim semantics Supabase uses).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- The API's login role switches into these per transaction (apps.core.db). Granting needs a
-- superuser or ADMIN OPTION, so existing memberships (e.g. from deploy/postgres-init.sql) are kept.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT pg_has_role(current_user, r, 'MEMBER') THEN
      EXECUTE format('GRANT %I TO %I', r, current_user);
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The caller's user id. Django sets `request.jwt.claim.sub` with SET LOCAL semantics.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array($1, '/');
$$;

GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated, service_role;

-- Keycloak subject -> legacy user id. Linking keeps existing tickets attached to their owners.
CREATE TABLE IF NOT EXISTS app.external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS external_identities_user_idx ON app.external_identities(user_id);

-- Ledger for `manage.py apply_legacy_schema`.
CREATE TABLE IF NOT EXISTS app.legacy_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
