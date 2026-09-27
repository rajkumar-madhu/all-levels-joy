-- Transactional, immutable evidence for incident, request, change and approval
-- mutations. AFTER triggers capture the row produced by every BEFORE trigger,
-- including generated priority and server-derived incident resolution times.
-- Only typed business metadata is retained: free-text descriptions, plans,
-- resolution/decision notes and arbitrary JSON are deliberately excluded.
CREATE OR REPLACE FUNCTION public.core_audit_snapshot(_table_name text, _row jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO pg_catalog, public
AS $$
DECLARE allowed_fields text[];
BEGIN
  IF _row IS NULL THEN RETURN NULL; END IF;
  CASE _table_name
    WHEN 'incidents' THEN allowed_fields := ARRAY[
      'id','organization_id','number','state','impact','urgency','priority',
      'requester_id','assignee_id','group_id','service_id','sla_due_at','resolved_at',
      'first_responded_at','reopen_count','close_code','on_hold_reason',
      'problem_id','major_incident','created_at','updated_at'];
    WHEN 'service_requests' THEN allowed_fields := ARRAY[
      'id','organization_id','number','catalog_item_id','state','requester_id',
      'assignee_id','group_id','requested_for_id','due_at','approval_status','created_at','updated_at'];
    WHEN 'changes' THEN allowed_fields := ARRAY[
      'id','organization_id','number','change_type','state','risk','requester_id',
      'owner_id','service_id','start_at','end_at','expected_outage_minutes',
      'affected_ci_ids','approval_status','actual_start_at','actual_end_at',
      'delivery_outcome','rollback_used','delivered_at','closed_at',
      'created_at','updated_at'];
    WHEN 'approvals' THEN allowed_fields := ARRAY[
      'id','organization_id','record_type','record_id','approver_id','status',
      'decided_at','created_at','updated_at'];
    ELSE RAISE EXCEPTION 'Unsupported audited table: %', _table_name;
  END CASE;
  RETURN (SELECT jsonb_object_agg(entry.key, entry.value)
    FROM jsonb_each(_row) entry WHERE entry.key = ANY(allowed_fields));
END;
$$;
REVOKE ALL ON FUNCTION public.core_audit_snapshot(text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE database_event boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Audit events are immutable';
  END IF;

  -- API roles cannot invoke the SECURITY DEFINER writer or select its identity.
  -- A session setting is intentionally not used as a bypass capability.
  database_event := pg_trigger_depth() > 1 AND NEW.source = 'database'
    AND current_user NOT IN ('anon','authenticated','service_role');

  IF NOT database_event THEN
    IF NEW.action LIKE 'approval\_%' ESCAPE '\' OR
       (NEW.record_type IN ('incident','request','change','approval') AND
        NEW.action NOT IN ('comment_added','attachment_added')) THEN
      RAISE EXCEPTION 'Core record audit events are written only by database triggers';
    END IF;
    -- Legacy non-core application audit remains supported. Legacy comment and
    -- attachment notifications are explicitly application-sourced, contain no
    -- row snapshots, and cannot impersonate core lifecycle evidence.
    NEW.source := 'application';
    IF NEW.record_type IN ('incident','request','change','approval') THEN
      NEW.before_values := NULL;
      NEW.after_values := NULL;
    END IF;
  END IF;
  NEW.id := gen_random_uuid();
  NEW.actor_id := auth.uid();
  NEW.created_at := clock_timestamp();
  NEW.correlation_id := gen_random_uuid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_audit_event
BEFORE INSERT OR UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.guard_audit_event();
CREATE TRIGGER guard_audit_truncate
BEFORE TRUNCATE ON public.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_audit_event();

CREATE OR REPLACE FUNCTION public.append_core_audit_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  previous_row jsonb;
  current_row jsonb;
  identity_row jsonb;
  event_record_type text;
  event_record_id uuid;
  event_action text;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN current_row := to_jsonb(NEW); END IF;
  identity_row := coalesce(current_row, previous_row);

  IF TG_TABLE_NAME = 'approvals' THEN
    -- Keep decision events on the parent ticket's activity timeline. The
    -- approval's own identity is retained in its before/after metadata.
    event_record_type := identity_row->>'record_type';
    event_record_id := (identity_row->>'record_id')::uuid;
    event_action := CASE
      WHEN TG_OP = 'DELETE' THEN 'approval_deleted'
      WHEN TG_OP = 'INSERT' OR current_row->>'status' IS DISTINCT FROM previous_row->>'status'
        THEN 'approval_' || (identity_row->>'status')
      ELSE 'approval_updated' END;
  ELSE
    event_record_type := CASE TG_TABLE_NAME
      WHEN 'incidents' THEN 'incident'
      WHEN 'service_requests' THEN 'request'
      WHEN 'changes' THEN 'change'
      ELSE NULL END;
    IF event_record_type IS NULL THEN RAISE EXCEPTION 'Unsupported audited table'; END IF;
    event_record_id := (identity_row->>'id')::uuid;
    event_action := CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  END IF;

  -- Do not catch insert failures: ticket/approval mutation and its evidence
  -- either both commit or both roll back, including inside approval RPCs.
  INSERT INTO public.audit_events (
    organization_id, record_type, record_id, actor_id, action, source,
    before_values, after_values
  ) VALUES (
    (identity_row->>'organization_id')::uuid, event_record_type, event_record_id,
    auth.uid(), event_action, 'database',
    public.core_audit_snapshot(TG_TABLE_NAME, previous_row),
    public.core_audit_snapshot(TG_TABLE_NAME, current_row)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.append_core_audit_event() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER audit_incident_mutation AFTER INSERT OR UPDATE OR DELETE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.append_core_audit_event();
CREATE TRIGGER audit_request_mutation AFTER INSERT OR UPDATE OR DELETE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.append_core_audit_event();
CREATE TRIGGER audit_change_mutation AFTER INSERT OR UPDATE OR DELETE ON public.changes
FOR EACH ROW EXECUTE FUNCTION public.append_core_audit_event();
CREATE TRIGGER audit_approval_mutation AFTER INSERT OR UPDATE OR DELETE ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.append_core_audit_event();

-- TRUNCATE has no row events. API roles must use ordinary audited mutations.
REVOKE TRUNCATE ON public.incidents, public.service_requests, public.changes, public.approvals
FROM authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated, service_role;
DROP POLICY IF EXISTS audit_read ON public.audit_events;
DROP POLICY IF EXISTS audit_create ON public.audit_events;
-- Snapshots include internal ownership and approval state. The requester
-- portal consumes public comments and ticket state, not the operator audit.
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated
USING (public.can_manage(organization_id));
CREATE POLICY audit_create ON public.audit_events FOR INSERT TO authenticated
WITH CHECK (
  public.is_org_member(organization_id) AND actor_id = auth.uid()
  AND source = 'application'
  AND (
    (record_type IN ('incident','request','change')
      AND action IN ('comment_added','attachment_added')
      AND public.can_access_record(organization_id, record_type, record_id))
    OR record_type NOT IN ('incident','request','change','approval')
  )
);
