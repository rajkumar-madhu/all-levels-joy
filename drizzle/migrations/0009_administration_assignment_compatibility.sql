-- Deactivation revokes future access and assignment, while preserving the ability
-- of another authorized operator to finish records with historical ownership.
-- Submitted scope and every approval/lifecycle gate remain enforced.
CREATE OR REPLACE FUNCTION public.itsm_approval_parent_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  kind text := CASE WHEN TG_TABLE_NAME='changes' THEN 'change' ELSE 'request' END;
  required boolean;
  expected_status text;
  total integer;
  approved integer;
  rejected integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.number<>OLD.number
      OR NEW.requester_id IS DISTINCT FROM OLD.requester_id THEN
      RAISE EXCEPTION 'Approval subject identity cannot be changed';
    END IF;
    IF kind='request' THEN
      IF NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id
        OR NEW.requested_for_id IS DISTINCT FROM OLD.requested_for_id
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'Submitted request scope cannot be changed; submit a new request';
      END IF;
    ELSE
      IF (to_jsonb(NEW) - ARRAY['state','approval_status','actual_start_at','actual_end_at','delivery_outcome','validation_results','rollback_used','delivered_at','closed_at','pir_notes','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','approval_status','actual_start_at','actual_end_at','delivery_outcome','validation_results','rollback_used','delivered_at','closed_at','pir_notes','updated_at']) THEN
        RAISE EXCEPTION 'Submitted change scope cannot be changed; submit a new change';
      END IF;
    END IF;
    IF (OLD.approval_status='not_required') <> (NEW.approval_status='not_required') THEN
      RAISE EXCEPTION 'The submitted approval requirement cannot be changed';
    END IF;
    required := OLD.approval_status<>'not_required';
  ELSE
    IF kind='request' THEN
      SELECT c.approval_required INTO required FROM public.catalog_items c
        WHERE c.id=NEW.catalog_item_id AND c.organization_id=NEW.organization_id AND c.active;
      IF NOT FOUND THEN RAISE EXCEPTION 'That catalog item is not available in this organization'; END IF;
    ELSE
      required := NEW.change_type<>'standard';
    END IF;
    IF NEW.approval_status <> (CASE WHEN required THEN 'requested' ELSE 'not_required' END)
      OR NEW.state <> (CASE WHEN required THEN 'pending'::public.record_state WHEN kind='change' THEN 'open'::public.record_state ELSE 'new'::public.record_state END) THEN
      RAISE EXCEPTION 'New records must start in their required approval state';
    END IF;
  END IF;

  IF kind='change' THEN
    IF NEW.service_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.services WHERE id=NEW.service_id AND organization_id=NEW.organization_id) THEN
      RAISE EXCEPTION 'The selected service is not in this organization';
    END IF;
    IF NEW.owner_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)
      AND NOT public.is_org_member(NEW.organization_id,NEW.owner_id) THEN
      RAISE EXCEPTION 'The selected owner is not an active organization member';
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(NEW.affected_ci_ids) ci WHERE NOT EXISTS(SELECT 1 FROM public.configuration_items c WHERE c.id=ci AND c.organization_id=NEW.organization_id)) THEN
      RAISE EXCEPTION 'An affected configuration item is not in this organization';
    END IF;
  ELSE
    IF NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND organization_id=NEW.organization_id) THEN
      RAISE EXCEPTION 'The selected group is not in this organization';
    END IF;
    IF NEW.assignee_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
      AND NOT public.is_org_member(NEW.organization_id,NEW.assignee_id) THEN
      RAISE EXCEPTION 'The selected assignee is not an active organization member';
    END IF;
  END IF;

  IF TG_OP='UPDATE' AND required THEN
    SELECT count(*),count(*) FILTER(WHERE status='approved'),count(*) FILTER(WHERE status='rejected')
      INTO total,approved,rejected FROM public.approvals
      WHERE organization_id=NEW.organization_id AND record_type=kind AND record_id=NEW.id;
    expected_status := CASE WHEN rejected>0 THEN 'rejected' WHEN total>0 AND approved=total THEN 'approved' ELSE 'requested' END;
    IF NEW.approval_status<>expected_status THEN RAISE EXCEPTION 'Approval status must match all designated approver decisions'; END IF;
    IF expected_status='requested' AND NEW.state NOT IN ('pending','cancelled') THEN
      RAISE EXCEPTION 'All designated approvers must approve before work can proceed';
    END IF;
    IF expected_status='rejected' AND NEW.state<>'cancelled' THEN RAISE EXCEPTION 'A rejected record must remain cancelled'; END IF;
  END IF;

  IF TG_OP='UPDATE' AND NEW.state<>OLD.state THEN
    IF OLD.state IN ('closed','cancelled') THEN RAISE EXCEPTION 'A closed or cancelled record cannot be reopened'; END IF;
    IF kind='change' AND NOT (
      (OLD.state='pending' AND NEW.state IN ('open','cancelled')) OR
      (OLD.state='open' AND NEW.state IN ('in_progress','cancelled')) OR
      (OLD.state='in_progress' AND NEW.state IN ('resolved','cancelled')) OR
      (OLD.state='resolved' AND NEW.state='closed')) THEN RAISE EXCEPTION 'Invalid change lifecycle transition'; END IF;
    IF kind='request' AND NEW.state='closed' AND OLD.state<>'resolved' THEN RAISE EXCEPTION 'Resolve a request before closing it'; END IF;
    IF NEW.state='cancelled' THEN
      UPDATE public.approvals SET status='cancelled',decided_at=clock_timestamp(),
        decision_notes='Approval is no longer required because the record was cancelled.'
        WHERE organization_id=NEW.organization_id AND record_type=kind AND record_id=NEW.id AND status='requested';
    END IF;
  END IF;
  IF kind='change' AND TG_OP='UPDATE' THEN
    IF NEW.state='in_progress' AND OLD.state<>'in_progress' THEN
      IF NEW.start_at>now() THEN RAISE EXCEPTION 'Implementation cannot start before the scheduled window'; END IF;
      NEW.actual_start_at := clock_timestamp();
    END IF;
    IF NEW.state='resolved' AND OLD.state<>'resolved' THEN
      IF nullif(btrim(NEW.pir_notes),'') IS NULL OR nullif(btrim(NEW.validation_results),'') IS NULL OR NEW.delivery_outcome IS NULL THEN
        RAISE EXCEPTION 'Delivery outcome, validation results and review notes are required';
      END IF;
      NEW.actual_end_at := clock_timestamp(); NEW.delivered_at := NEW.actual_end_at;
    END IF;
    IF NEW.state='closed' AND OLD.state<>'closed' THEN NEW.closed_at:=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.itsm_approval_parent_guard() FROM PUBLIC,anon,authenticated;
