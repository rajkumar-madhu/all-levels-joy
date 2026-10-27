-- Fixes for gaps inherited from the legacy schema that matter once more than one workspace, or more
-- than one person, uses the system. Applied by `apply_app_schema` after the legacy migrations.

-- 1. Record numbers are unique per workspace, matching the per-workspace counters in next_record_number.
--    Incidents, requests, changes and articles were unique across the whole database, so a second
--    workspace failed to create its INC0001001. Problems, major incidents and findings were already per
--    workspace.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidents', 'service_requests', 'changes', 'knowledge_articles'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_number_key');
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass AND conname = t || '_organization_id_number_key'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (organization_id, number)',
                     t, t || '_organization_id_number_key');
    END IF;
  END LOOP;
END $$;

-- 2. Anonymous visitors read published knowledge only from workspaces that publish it (the customer
--    portal's workspace), not from every workspace. The API already filters by PORTAL_ORG_ID; this makes
--    the database enforce the same. `manage.py sync_portal_workspace` keeps the flag on PORTAL_ORG_ID.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS knowledge_public boolean NOT NULL DEFAULT false;
-- The seeded workspace is the legacy portal workspace and PORTAL_ORG_ID's default.
UPDATE public.organizations SET knowledge_public = true WHERE id = '10000000-0000-0000-0000-000000000001';

CREATE OR REPLACE FUNCTION public.knowledge_is_public(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT knowledge_public FROM public.organizations WHERE id = _org_id), false)
$$;
REVOKE ALL ON FUNCTION public.knowledge_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.knowledge_is_public(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS knowledge_public_read ON public.knowledge_articles;
CREATE POLICY knowledge_public_read ON public.knowledge_articles FOR SELECT TO anon
  USING (status = 'published' AND public.knowledge_is_public(organization_id));
DROP POLICY IF EXISTS knowledge_categories_public_read ON public.knowledge_categories;
CREATE POLICY knowledge_categories_public_read ON public.knowledge_categories FOR SELECT TO anon
  USING (active AND public.knowledge_is_public(organization_id));

-- 3. Major incident declarations notify the workspace's responders. `notifications` has no insert policy
--    (the legacy app's client-side inserts were always refused), so this security-definer function sends
--    them. It takes only the major incident: recipients and text come from the database, the caller must
--    be the staff member who declared it, and it sends once per major incident.
CREATE OR REPLACE FUNCTION public.itsm_notify_major_incident_declared(_major_incident_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m record;
  sent integer;
BEGIN
  SELECT id, organization_id, number, severity, situation_summary, declared_by
    INTO m FROM public.major_incidents WHERE id = _major_incident_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Major incident not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR m.declared_by IS DISTINCT FROM auth.uid() OR NOT public.can_manage(m.organization_id) THEN
    RAISE EXCEPTION 'Only the person who declared this major incident can send its notifications'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE record_type = 'major_incident' AND record_id = m.id) THEN
    RETURN 0;
  END IF;
  -- Same responder roles as the legacy declareMajorIncident; active members only; not the declarer.
  INSERT INTO public.notifications(organization_id, user_id, title, body, record_type, record_id)
  SELECT DISTINCT m.organization_id, ur.user_id, m.number || ' declared — severity ' || m.severity,
         left(m.situation_summary, 280), 'major_incident', m.id
  FROM public.user_roles ur
  JOIN public.memberships ms
    ON ms.organization_id = ur.organization_id AND ms.user_id = ur.user_id AND ms.is_active
  WHERE ur.organization_id = m.organization_id
    AND ur.role IN ('manager', 'admin', 'service_desk', 'change_manager')
    AND ur.user_id <> m.declared_by;
  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION public.itsm_notify_major_incident_declared(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_notify_major_incident_declared(uuid) TO authenticated, service_role;
