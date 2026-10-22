-- Privileged access: vaulted secrets, time-boxed access requests and an append-only event log.
-- Staff read secret metadata through RLS; the encrypted password column is never granted to
-- `authenticated`. Only the API's service-role paths (reveal after an approved request, rotation,
-- verification) read or write it, after OPA and the request checks.

-- Custodians manage secrets and decide access: workspace managers and administrators.
CREATE OR REPLACE FUNCTION public.pam_is_custodian(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_org_id) AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE organization_id = _org_id AND user_id = auth.uid()
      AND role IN ('manager', 'admin'))
$$;
REVOKE ALL ON FUNCTION public.pam_is_custodian(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pam_is_custodian(uuid) TO authenticated, service_role;

CREATE TABLE public.pam_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  host text NOT NULL CHECK (length(btrim(host)) BETWEEN 1 AND 255),
  port integer NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
  username text NOT NULL CHECK (length(btrim(username)) BETWEEN 1 AND 128),
  template text NOT NULL DEFAULT 'ssh' CHECK (template IN ('ssh', 'database', 'windows', 'api_key')),
  environment text NOT NULL CHECK (environment IN ('production', 'dr', 'uat', 'development')),
  folder text NOT NULL DEFAULT 'General' CHECK (length(btrim(folder)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  owner_group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  ci_id uuid REFERENCES public.configuration_items(id) ON DELETE SET NULL,
  approval_required boolean NOT NULL DEFAULT true,
  max_checkout_minutes integer NOT NULL DEFAULT 240 CHECK (max_checkout_minutes BETWEEN 15 AND 1440),
  rotation_enabled boolean NOT NULL DEFAULT false,
  rotation_interval_days integer NOT NULL DEFAULT 30 CHECK (rotation_interval_days BETWEEN 1 AND 365),
  rotate_after_checkout boolean NOT NULL DEFAULT false,
  verify_enabled boolean NOT NULL DEFAULT false,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  password_changed_at timestamptz,
  next_rotation_at timestamptz,
  last_verified_at timestamptz,
  last_verification_ok boolean,
  last_rotation_error text,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  -- Production access always needs an independent approver.
  CONSTRAINT pam_production_needs_approval CHECK (environment <> 'production' OR approval_required)
);
CREATE INDEX pam_secrets_org_env_idx ON public.pam_secrets(organization_id, environment);
CREATE INDEX pam_secrets_due_idx ON public.pam_secrets(next_rotation_at) WHERE rotation_enabled;
CREATE TRIGGER set_pam_secrets_updated_at BEFORE UPDATE ON public.pam_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pam_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY pam_secrets_staff_read ON public.pam_secrets FOR SELECT TO authenticated
  USING (public.can_manage(organization_id));
CREATE POLICY pam_secrets_custodian_insert ON public.pam_secrets FOR INSERT TO authenticated
  WITH CHECK (public.pam_is_custodian(organization_id) AND created_by = auth.uid());
CREATE POLICY pam_secrets_custodian_update ON public.pam_secrets FOR UPDATE TO authenticated
  USING (public.pam_is_custodian(organization_id)) WITH CHECK (public.pam_is_custodian(organization_id));
CREATE POLICY pam_secrets_custodian_delete ON public.pam_secrets FOR DELETE TO authenticated
  USING (public.pam_is_custodian(organization_id));

-- Column privileges: everything except the ciphertext.
REVOKE ALL ON public.pam_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, organization_id, name, host, port, username, template, environment, folder, description,
  owner_group_id, ci_id, approval_required, max_checkout_minutes, rotation_enabled, rotation_interval_days,
  rotate_after_checkout, verify_enabled, key_version, password_changed_at, next_rotation_at, last_verified_at,
  last_verification_ok, last_rotation_error, last_used_at, created_by, created_at, updated_at)
  ON public.pam_secrets TO authenticated;
GRANT INSERT ON public.pam_secrets TO authenticated;
GRANT UPDATE (name, host, port, username, template, environment, folder, description, owner_group_id, ci_id,
  approval_required, max_checkout_minutes, rotation_enabled, rotation_interval_days, rotate_after_checkout,
  verify_enabled, next_rotation_at)
  ON public.pam_secrets TO authenticated;
GRANT DELETE ON public.pam_secrets TO authenticated;
GRANT ALL ON public.pam_secrets TO service_role;

CREATE TABLE public.pam_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  secret_id uuid NOT NULL REFERENCES public.pam_secrets(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  ticket_reference text CHECK (ticket_reference IS NULL OR length(ticket_reference) <= 40),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'checked_in', 'expired')),
  approver_id uuid,
  decision_notes text,
  decided_at timestamptz,
  starts_at timestamptz,
  expires_at timestamptz,
  checked_in_at timestamptz,
  reveal_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Nobody approves their own access; the only exception is a secret that needs no approval.
  CONSTRAINT pam_requests_independent_approver CHECK (approver_id IS NULL OR approver_id <> requester_id
    OR coalesce(decision_notes, '') = 'auto-approved: no approval required')
);
CREATE INDEX pam_requests_org_status_idx ON public.pam_access_requests(organization_id, status);
CREATE INDEX pam_requests_secret_idx ON public.pam_access_requests(secret_id);
-- One open request per person and secret.
CREATE UNIQUE INDEX pam_requests_one_open ON public.pam_access_requests(secret_id, requester_id)
  WHERE status IN ('pending', 'approved');
CREATE TRIGGER set_pam_requests_updated_at BEFORE UPDATE ON public.pam_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pam_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pam_requests_read ON public.pam_access_requests FOR SELECT TO authenticated
  USING (public.can_manage(organization_id)
    AND (requester_id = auth.uid() OR public.pam_is_custodian(organization_id)));
-- New requests start pending and undecided; only the service-role paths move them on.
CREATE POLICY pam_requests_create ON public.pam_access_requests FOR INSERT TO authenticated
  WITH CHECK (public.can_manage(organization_id) AND requester_id = auth.uid() AND status = 'pending'
    AND approver_id IS NULL AND decision_notes IS NULL AND decided_at IS NULL AND starts_at IS NULL
    AND expires_at IS NULL AND checked_in_at IS NULL AND reveal_count = 0
    AND EXISTS (SELECT 1 FROM public.pam_secrets s WHERE s.id = pam_access_requests.secret_id
      AND s.organization_id = pam_access_requests.organization_id));
-- Decisions, check-ins and reveals go through the API's service-role paths, which apply the rules.
REVOKE ALL ON public.pam_access_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.pam_access_requests TO authenticated;
GRANT ALL ON public.pam_access_requests TO service_role;

CREATE TABLE public.pam_events (
  id bigserial PRIMARY KEY,
  -- No cascading foreign keys: the log is append-only and outlives the secrets and requests it names.
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  secret_id uuid,
  secret_name text,
  request_id uuid,
  actor_id uuid,
  action text NOT NULL CHECK (action IN (
    'created', 'updated', 'deleted', 'password_set', 'access_requested', 'access_approved', 'access_rejected',
    'access_cancelled', 'revealed', 'checked_in', 'access_expired', 'rotated', 'rotation_failed', 'verified',
    'verification_failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pam_events_secret_idx ON public.pam_events(secret_id, created_at DESC);

-- Append-only, for every role including the service role.
CREATE OR REPLACE FUNCTION public.pam_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Privileged access events cannot be changed or removed';
END $$;
CREATE TRIGGER pam_events_no_update BEFORE UPDATE OR DELETE ON public.pam_events
  FOR EACH ROW EXECUTE FUNCTION public.pam_events_immutable();
CREATE TRIGGER pam_events_no_truncate BEFORE TRUNCATE ON public.pam_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.pam_events_immutable();

ALTER TABLE public.pam_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pam_events_staff_read ON public.pam_events FOR SELECT TO authenticated
  USING (public.can_manage(organization_id));
-- Only the API's service-role paths write events, so callers cannot forge reveals or rotations.
REVOKE ALL ON public.pam_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pam_events TO authenticated;
GRANT USAGE ON SEQUENCE public.pam_events_id_seq TO service_role;
GRANT SELECT, INSERT ON public.pam_events TO service_role;
