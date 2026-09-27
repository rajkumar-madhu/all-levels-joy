-- Access is provisioned by an administrator. Signing in never joins a tenant,
-- reactivates membership, or grants an operational role.
DROP POLICY IF EXISTS memberships_self_join ON public.memberships;
DROP POLICY IF EXISTS organizations_create ON public.organizations;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_org_id, _user_id) AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE organization_id = _org_id AND user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_org_id) AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND role IN ('service_desk','fulfiller','change_manager','cab_member','cmdb_manager','manager','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_workspace(_display_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  workspace_id CONSTANT uuid := '10000000-0000-0000-0000-000000000001';
  caller uuid := auth.uid();
  membership_active boolean;
BEGIN
  SELECT is_active INTO membership_active FROM public.memberships
    WHERE organization_id = workspace_id AND user_id = caller FOR SHARE;
  IF caller IS NULL OR membership_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'Your account does not have active access to this workspace. Ask your workspace administrator for an invitation.';
  END IF;
  IF length(coalesce(_display_name, '')) > 120 THEN
    RAISE EXCEPTION 'Display name must be 120 characters or fewer';
  END IF;
  INSERT INTO public.profiles(id, display_name)
    VALUES(caller, coalesce(nullif(btrim(_display_name), ''), 'Workspace member'))
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(organization_id, user_id, role)
    VALUES(workspace_id, caller, 'requester')
    ON CONFLICT (organization_id, user_id, role) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'organization_id', workspace_id);
END;
$$;

-- The same parent check protects comments, attachments, storage and audit RPCs.
-- SECURITY DEFINER deliberately avoids recursive RLS checks; every branch checks
-- both organization and ownership after requiring the caller's active membership.
CREATE OR REPLACE FUNCTION public.can_access_record(_org_id uuid, _record_type text, _record_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE operator_access boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RETURN false; END IF;
  operator_access := public.can_manage(_org_id);
  CASE _record_type
    WHEN 'incident' THEN RETURN EXISTS (
      SELECT 1 FROM public.incidents WHERE id = _record_id AND organization_id = _org_id
        AND (operator_access OR requester_id = auth.uid()));
    WHEN 'request' THEN RETURN EXISTS (
      SELECT 1 FROM public.service_requests WHERE id = _record_id AND organization_id = _org_id
        AND (operator_access OR requester_id = auth.uid()));
    WHEN 'change' THEN RETURN EXISTS (
      SELECT 1 FROM public.changes WHERE id = _record_id AND organization_id = _org_id
        AND (operator_access OR requester_id = auth.uid()));
    WHEN 'knowledge' THEN RETURN EXISTS (
      SELECT 1 FROM public.knowledge_articles WHERE id = _record_id AND organization_id = _org_id
        AND (operator_access OR status = 'published'));
    WHEN 'problem' THEN RETURN operator_access AND EXISTS (
      SELECT 1 FROM public.problems WHERE id = _record_id AND organization_id = _org_id);
    WHEN 'major_incident' THEN RETURN operator_access AND EXISTS (
      SELECT 1 FROM public.major_incidents WHERE id = _record_id AND organization_id = _org_id);
    WHEN 'ci', 'asset' THEN RETURN operator_access AND EXISTS (
      SELECT 1 FROM public.configuration_items WHERE id = _record_id AND organization_id = _org_id);
    ELSE RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_workspace(text), public.can_access_record(uuid,text,uuid),
  public.has_role(uuid,public.app_role,uuid), public.can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace(text), public.can_access_record(uuid,text,uuid),
  public.has_role(uuid,public.app_role,uuid), public.can_manage(uuid) TO authenticated, service_role;

DROP POLICY memberships_org_read ON public.memberships;
CREATE POLICY memberships_org_read ON public.memberships FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (user_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY memberships_admin_manage ON public.memberships;
CREATE POLICY memberships_admin_manage ON public.memberships FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin', organization_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin', organization_id));
DROP POLICY user_roles_org_read ON public.user_roles;
CREATE POLICY user_roles_org_read ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (user_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY profiles_org_read ON public.profiles;
CREATE POLICY profiles_org_read ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.memberships them WHERE them.user_id = profiles.id AND them.is_active
      AND public.can_manage(them.organization_id)
  ));

DROP POLICY incidents_read ON public.incidents;
CREATE POLICY incidents_read ON public.incidents FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (requester_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY incidents_update ON public.incidents;
CREATE POLICY incidents_update ON public.incidents FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id) AND (requester_id = auth.uid() OR public.can_manage(organization_id)))
  WITH CHECK (public.is_org_member(organization_id) AND (requester_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY requests_read ON public.service_requests;
CREATE POLICY requests_read ON public.service_requests FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (requester_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY requests_update ON public.service_requests;
CREATE POLICY requests_update ON public.service_requests FOR UPDATE TO authenticated
  USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));
DROP POLICY changes_read ON public.changes;
CREATE POLICY changes_read ON public.changes FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (requester_id = auth.uid() OR public.can_manage(organization_id)));
DROP POLICY changes_update ON public.changes;
CREATE POLICY changes_update ON public.changes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'change_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id))
  WITH CHECK (public.has_role(auth.uid(), 'change_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id));
DROP POLICY request_tasks_read ON public.request_tasks;
CREATE POLICY request_tasks_read ON public.request_tasks FOR SELECT TO authenticated
  USING (public.can_manage(organization_id) AND public.can_access_record(organization_id, 'request', request_id));

DROP POLICY knowledge_read ON public.knowledge_articles;
DROP POLICY knowledge_manage ON public.knowledge_articles;
CREATE POLICY knowledge_read ON public.knowledge_articles FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) AND (status = 'published' OR public.can_manage(organization_id)));
CREATE POLICY knowledge_manage ON public.knowledge_articles FOR ALL TO authenticated
  USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

DROP POLICY comments_read ON public.record_comments;
DROP POLICY comments_create ON public.record_comments;
CREATE POLICY comments_read ON public.record_comments FOR SELECT TO authenticated
  USING (public.can_access_record(organization_id, record_type, record_id)
    AND (NOT internal OR public.can_manage(organization_id)));
CREATE POLICY comments_create ON public.record_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_access_record(organization_id, record_type, record_id)
    AND (NOT internal OR public.can_manage(organization_id)));
DROP POLICY attachments_read ON public.attachments;
DROP POLICY attachments_create ON public.attachments;
CREATE POLICY attachments_read ON public.attachments FOR SELECT TO authenticated
  USING (public.can_access_record(organization_id, record_type, record_id));
CREATE POLICY attachments_create ON public.attachments FOR INSERT TO authenticated
  WITH CHECK (uploader_id = auth.uid() AND public.can_access_record(organization_id, record_type, record_id)
    AND starts_with(storage_path, organization_id::text || '/' || record_type || '/' || record_id::text || '/'));

CREATE OR REPLACE FUNCTION public.can_access_evidence_path(_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts text[] := string_to_array(_path, '/');
BEGIN
  IF array_length(parts, 1) <> 4 OR parts[4] = '' THEN RETURN false; END IF;
  RETURN public.can_access_record(parts[1]::uuid, parts[2], parts[3]::uuid);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_evidence_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_evidence_path(text) TO authenticated, service_role;
DROP POLICY evidence_read ON storage.objects;
DROP POLICY evidence_create ON storage.objects;
CREATE POLICY evidence_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'itsm-evidence' AND public.can_access_evidence_path(name));
CREATE POLICY evidence_create ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'itsm-evidence' AND public.can_access_evidence_path(name));

-- Operational workspaces can contain internal incident details and infrastructure
-- inventory. Requesters consume their own records and published knowledge instead.
DROP POLICY "Members read problems" ON public.problems;
CREATE POLICY "Members read problems" ON public.problems FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY "Members read problem links" ON public.problem_incidents;
CREATE POLICY "Members read problem links" ON public.problem_incidents FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY "Members read major incidents" ON public.major_incidents;
CREATE POLICY "Members read major incidents" ON public.major_incidents FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY "Members read major incident updates" ON public.major_incident_updates;
CREATE POLICY "Members read major incident updates" ON public.major_incident_updates FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY ci_read ON public.configuration_items;
CREATE POLICY ci_read ON public.configuration_items FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY ci_manage ON public.configuration_items;
CREATE POLICY ci_manage ON public.configuration_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'cmdb_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id))
  WITH CHECK (public.has_role(auth.uid(), 'cmdb_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id));
DROP POLICY ci_rel_read ON public.ci_relationships;
CREATE POLICY ci_rel_read ON public.ci_relationships FOR SELECT TO authenticated USING (public.can_manage(organization_id));
DROP POLICY ci_rel_manage ON public.ci_relationships;
CREATE POLICY ci_rel_manage ON public.ci_relationships FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'cmdb_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id))
  WITH CHECK (public.has_role(auth.uid(), 'cmdb_manager', organization_id) OR public.has_role(auth.uid(), 'admin', organization_id));
DROP POLICY sla_read ON public.sla_instances;
CREATE POLICY sla_read ON public.sla_instances FOR SELECT TO authenticated
  USING (public.can_access_record(organization_id, record_type, record_id));
DROP POLICY notifications_own ON public.notifications;
CREATE POLICY notifications_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id));
DROP POLICY notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));

-- Old chat policies allowed inactive members to continue accessing tenant data.
DROP POLICY "own threads select" ON public.ai_chat_threads;
DROP POLICY "own threads update" ON public.ai_chat_threads;
DROP POLICY "own threads delete" ON public.ai_chat_threads;
CREATE POLICY "own threads select" ON public.ai_chat_threads FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own threads update" ON public.ai_chat_threads FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own threads delete" ON public.ai_chat_threads FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id));
DROP POLICY "own messages select" ON public.ai_chat_messages;
DROP POLICY "own messages update" ON public.ai_chat_messages;
DROP POLICY "own messages delete" ON public.ai_chat_messages;
CREATE POLICY "own messages select" ON public.ai_chat_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own messages update" ON public.ai_chat_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own messages delete" ON public.ai_chat_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id));

-- Complete requester restrictions beyond the lifecycle fields in migration 0004.
CREATE OR REPLACE FUNCTION public.validate_incident_access()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.problem_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.problems WHERE id = NEW.problem_id AND organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'The selected problem is not available in this organization'; END IF;
  IF current_user = 'authenticated' AND NOT public.can_manage(NEW.organization_id) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.major_incident OR NEW.problem_id IS NOT NULL OR NEW.resolution_notes IS NOT NULL
        OR NEW.close_code IS NOT NULL OR NEW.on_hold_reason IS NOT NULL OR NEW.first_responded_at IS NOT NULL THEN
        RAISE EXCEPTION 'You do not have permission to set incident operational fields';
      END IF;
      -- Requester-supplied clocks must not extend SLA or manufacture response history.
      NEW.created_at := clock_timestamp();
      NEW.updated_at := NEW.created_at;
      NEW.sla_due_at := NEW.created_at + CASE WHEN NEW.impact + NEW.urgency <= 2 THEN interval '2 hours'
        WHEN NEW.impact + NEW.urgency <= 4 THEN interval '8 hours' ELSE interval '24 hours' END;
    ELSIF (to_jsonb(NEW) - ARRAY['title','description','updated_at','priority'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['title','description','updated_at','priority']) THEN
      RAISE EXCEPTION 'You do not have permission to manage incidents';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_incident_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workspace_incident_access BEFORE INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.validate_incident_access();
