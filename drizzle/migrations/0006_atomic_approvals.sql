-- Approval subjects, selected approvers, decisions and notifications commit together.
-- The policy is ALL selected approvers; one rejection is final. Self-approval is excluded.
ALTER TABLE public.service_requests ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required'
  CHECK (approval_status IN ('not_required', 'requested', 'approved', 'rejected'));

UPDATE public.service_requests r SET approval_status = CASE
  WHEN EXISTS (SELECT 1 FROM public.approvals a WHERE a.organization_id=r.organization_id AND a.record_type='request' AND a.record_id=r.id AND a.status='rejected') THEN 'rejected'
  WHEN EXISTS (SELECT 1 FROM public.approvals a WHERE a.organization_id=r.organization_id AND a.record_type='request' AND a.record_id=r.id)
    AND NOT EXISTS (SELECT 1 FROM public.approvals a WHERE a.organization_id=r.organization_id AND a.record_type='request' AND a.record_id=r.id AND a.status<>'approved') THEN 'approved'
  WHEN EXISTS (SELECT 1 FROM public.catalog_items c WHERE c.id=r.catalog_item_id AND c.approval_required)
    OR EXISTS (SELECT 1 FROM public.approvals a WHERE a.organization_id=r.organization_id AND a.record_type='request' AND a.record_id=r.id) THEN 'requested'
  ELSE 'not_required' END;

-- Legacy non-standard changes must not inherit the old default exemption.
UPDATE public.changes SET approval_status='requested'
WHERE change_type<>'standard' AND approval_status='not_required';

CREATE UNIQUE INDEX approvals_one_approver_per_record
  ON public.approvals(organization_id, record_type, record_id, approver_id);

-- RLS alone cannot make a multi-table operation atomic. Authenticated callers use RPCs.
REVOKE INSERT ON public.service_requests, public.changes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM authenticated;
DROP POLICY IF EXISTS approvals_manage ON public.approvals;

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
    IF NEW.owner_id IS NOT NULL AND NOT public.is_org_member(NEW.organization_id,NEW.owner_id) THEN
      RAISE EXCEPTION 'The selected owner is not an active organization member';
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(NEW.affected_ci_ids) ci WHERE NOT EXISTS(SELECT 1 FROM public.configuration_items c WHERE c.id=ci AND c.organization_id=NEW.organization_id)) THEN
      RAISE EXCEPTION 'An affected configuration item is not in this organization';
    END IF;
  ELSE
    IF NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.groups WHERE id=NEW.group_id AND organization_id=NEW.organization_id) THEN
      RAISE EXCEPTION 'The selected group is not in this organization';
    END IF;
    IF NEW.assignee_id IS NOT NULL AND NOT public.is_org_member(NEW.organization_id,NEW.assignee_id) THEN
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
CREATE TRIGGER request_approval_guard BEFORE INSERT OR UPDATE ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.itsm_approval_parent_guard();
CREATE TRIGGER change_approval_guard BEFORE INSERT OR UPDATE ON public.changes FOR EACH ROW EXECUTE FUNCTION public.itsm_approval_parent_guard();

CREATE OR REPLACE FUNCTION public.itsm_create_service_request(_org_id uuid,_catalog_item_id uuid,_title text,_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item public.catalog_items; subject public.service_requests; approvers uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id,auth.uid()) THEN RAISE EXCEPTION 'Active organization membership is required'; END IF;
  IF length(btrim(_title)) NOT BETWEEN 5 AND 160 OR length(btrim(_description)) NOT BETWEEN 5 AND 6000 OR _title IS NULL OR _description IS NULL THEN
    RAISE EXCEPTION 'A valid title and description are required';
  END IF;
  SELECT * INTO item FROM public.catalog_items WHERE id=_catalog_item_id AND organization_id=_org_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That catalog item is not available in this organization'; END IF;
  IF item.approval_required THEN
    SELECT array_agg(DISTINCT r.user_id ORDER BY r.user_id) INTO approvers FROM public.user_roles r
      JOIN public.memberships m ON m.organization_id=r.organization_id AND m.user_id=r.user_id AND m.is_active
      WHERE r.organization_id=_org_id AND r.role IN ('manager','admin') AND r.user_id<>auth.uid();
    IF coalesce(cardinality(approvers),0)=0 THEN RAISE EXCEPTION 'No eligible independent approver is available; contact your workspace administrator'; END IF;
  END IF;
  INSERT INTO public.service_requests(organization_id,number,catalog_item_id,title,description,requester_id,requested_for_id,state,approval_status,due_at)
  VALUES(_org_id,public.next_record_number(_org_id,'REQ'),item.id,btrim(_title),btrim(_description),auth.uid(),auth.uid(),
    CASE WHEN item.approval_required THEN 'pending'::public.record_state ELSE 'new'::public.record_state END,
    CASE WHEN item.approval_required THEN 'requested' ELSE 'not_required' END,now()+make_interval(days=>greatest(0,item.delivery_days))) RETURNING * INTO subject;
  INSERT INTO public.approvals(organization_id,record_type,record_id,approver_id)
    SELECT _org_id,'request',subject.id,x FROM unnest(approvers) x;
  INSERT INTO public.notifications(organization_id,user_id,title,body,record_type,record_id)
    SELECT _org_id,x,'Approval needed: '||subject.number,subject.title,'request',subject.id FROM unnest(approvers) x;
  RETURN jsonb_build_object('id',subject.id,'number',subject.number);
END;
$$;

CREATE OR REPLACE FUNCTION public.itsm_create_change(_org_id uuid,_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE subject public.changes; approvers uuid[]; field text; start_time timestamptz; end_time timestamptz;
  change_kind text:=_input->>'changeType'; risk_level text:=_input->>'risk'; ci_ids uuid[]; outage integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id,auth.uid()) OR NOT EXISTS(
    SELECT 1 FROM public.user_roles WHERE organization_id=_org_id AND user_id=auth.uid() AND role IN ('fulfiller','change_manager','manager','admin')) THEN
    RAISE EXCEPTION 'You do not have permission to create a change';
  END IF;
  IF change_kind IS NULL OR change_kind NOT IN ('standard','normal','emergency') OR risk_level IS NULL OR risk_level NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'A valid change type and risk are required'; END IF;
  FOREACH field IN ARRAY ARRAY['title','description','implementationPlan','testPlan','rollbackPlan','businessJustification','impactAssessment','validationPlan','rollbackTrigger','communicationPlan'] LOOP
    IF nullif(btrim(_input->>field),'') IS NULL OR length(btrim(_input->>field)) NOT BETWEEN 5 AND (CASE WHEN field='title' THEN 160 ELSE 6000 END) THEN
      RAISE EXCEPTION 'A valid % is required',field;
    END IF;
  END LOOP;
  start_time:=(_input->>'startAt')::timestamptz; end_time:=(_input->>'endAt')::timestamptz;
  IF start_time IS NULL OR end_time IS NULL OR NOT isfinite(start_time) OR NOT isfinite(end_time) OR end_time<=start_time THEN RAISE EXCEPTION 'The change window must end after it starts'; END IF;
  outage:=(_input->>'expectedOutageMinutes')::integer;
  IF outage IS NULL OR outage NOT BETWEEN 0 AND 10080 THEN RAISE EXCEPTION 'Expected outage must be between 0 and 10080 minutes'; END IF;
  IF jsonb_typeof(_input->'affectedCiIds') IS DISTINCT FROM 'array' OR jsonb_array_length(_input->'affectedCiIds')>100 THEN RAISE EXCEPTION 'Provide up to 100 affected configuration items'; END IF;
  SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO ci_ids FROM jsonb_array_elements_text(_input->'affectedCiIds');
  IF change_kind<>'standard' THEN
    SELECT array_agg(DISTINCT r.user_id ORDER BY r.user_id) INTO approvers FROM public.user_roles r
      JOIN public.memberships m ON m.organization_id=r.organization_id AND m.user_id=r.user_id AND m.is_active
      WHERE r.organization_id=_org_id AND r.role IN ('cab_member','change_manager','admin') AND r.user_id<>auth.uid();
    IF coalesce(cardinality(approvers),0)=0 THEN RAISE EXCEPTION 'No eligible independent approver is available; contact your workspace administrator'; END IF;
    -- Emergency changes need one independent CAB decision, selected deterministically.
    IF change_kind='emergency' THEN approvers:=approvers[1:1]; END IF;
  END IF;
  INSERT INTO public.changes(organization_id,number,title,description,change_type,risk,requester_id,owner_id,service_id,
    implementation_plan,test_plan,rollback_plan,business_justification,impact_assessment,expected_outage_minutes,affected_ci_ids,
    validation_plan,rollback_trigger,communication_plan,start_at,end_at,approval_status,state)
  VALUES(_org_id,public.next_record_number(_org_id,'CHG'),btrim(_input->>'title'),btrim(_input->>'description'),change_kind,risk_level,auth.uid(),
    coalesce(nullif(_input->>'ownerId','')::uuid,auth.uid()),nullif(_input->>'serviceId','')::uuid,
    btrim(_input->>'implementationPlan'),btrim(_input->>'testPlan'),btrim(_input->>'rollbackPlan'),btrim(_input->>'businessJustification'),btrim(_input->>'impactAssessment'),outage,ci_ids,
    btrim(_input->>'validationPlan'),btrim(_input->>'rollbackTrigger'),btrim(_input->>'communicationPlan'),start_time,end_time,
    CASE WHEN change_kind='standard' THEN 'not_required' ELSE 'requested' END,CASE WHEN change_kind='standard' THEN 'open'::public.record_state ELSE 'pending'::public.record_state END)
  RETURNING * INTO subject;
  INSERT INTO public.approvals(organization_id,record_type,record_id,approver_id) SELECT _org_id,'change',subject.id,x FROM unnest(approvers) x;
  INSERT INTO public.notifications(organization_id,user_id,title,body,record_type,record_id)
    SELECT _org_id,x,'CAB approval needed: '||subject.number,subject.title,'change',subject.id FROM unnest(approvers) x;
  RETURN jsonb_build_object('id',subject.id,'number',subject.number);
END;
$$;

CREATE OR REPLACE FUNCTION public.itsm_decide_approval(_approval_id uuid,_decision text,_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE decision public.approvals; parent_state public.record_state; parent_status text; requester uuid; record_number text;
  total integer; approved integer; rejected integer; final_status text;
BEGIN
  IF _decision IS NULL OR _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approved or rejected'; END IF;
  IF length(coalesce(_notes,''))>2000 THEN RAISE EXCEPTION 'Decision notes must be at most 2000 characters'; END IF;
  IF _decision='rejected' AND nullif(btrim(_notes),'') IS NULL THEN RAISE EXCEPTION 'Decision notes are required when rejecting a record'; END IF;
  SELECT * INTO decision FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND OR auth.uid() IS NULL OR decision.approver_id<>auth.uid() OR NOT public.is_org_member(decision.organization_id,auth.uid()) THEN
    RAISE EXCEPTION 'This approval is not assigned to your active membership';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE organization_id=decision.organization_id AND user_id=auth.uid()
    AND ((decision.record_type='request' AND role IN ('manager','admin')) OR (decision.record_type='change' AND role IN ('cab_member','change_manager','admin')))) THEN
    RAISE EXCEPTION 'You no longer hold an authorized approver role';
  END IF;
  -- Always lock the parent first. Concurrent decisions on different approval rows serialize.
  IF decision.record_type='request' THEN
    SELECT state,approval_status,requester_id,number INTO parent_state,parent_status,requester,record_number
      FROM public.service_requests WHERE id=decision.record_id AND organization_id=decision.organization_id FOR UPDATE;
  ELSIF decision.record_type='change' THEN
    SELECT state,approval_status,requester_id,number INTO parent_state,parent_status,requester,record_number
      FROM public.changes WHERE id=decision.record_id AND organization_id=decision.organization_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'This record type does not support this approval workflow'; END IF;
  IF parent_state IS NULL THEN RAISE EXCEPTION 'The approval parent no longer exists'; END IF;
  IF requester=auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own record'; END IF;
  SELECT * INTO decision FROM public.approvals WHERE id=_approval_id FOR UPDATE;
  IF decision.status<>'requested' THEN RAISE EXCEPTION 'This approval has already been decided'; END IF;
  IF parent_state<>'pending' OR parent_status<>'requested' THEN RAISE EXCEPTION 'This record is no longer awaiting approval'; END IF;
  UPDATE public.approvals SET status=_decision,decision_notes=nullif(btrim(_notes),''),decided_at=clock_timestamp() WHERE id=decision.id;
  SELECT count(*),count(*) FILTER(WHERE status='approved'),count(*) FILTER(WHERE status='rejected') INTO total,approved,rejected FROM public.approvals
    WHERE organization_id=decision.organization_id AND record_type=decision.record_type AND record_id=decision.record_id;
  final_status:=CASE WHEN rejected>0 THEN 'rejected' WHEN total>0 AND approved=total THEN 'approved' ELSE 'requested' END;
  IF final_status<>'requested' THEN
    IF decision.record_type='request' THEN
      UPDATE public.service_requests SET approval_status=final_status,state=CASE WHEN final_status='approved' THEN 'open'::public.record_state ELSE 'cancelled'::public.record_state END WHERE id=decision.record_id;
    ELSE
      UPDATE public.changes SET approval_status=final_status,state=CASE WHEN final_status='approved' THEN 'open'::public.record_state ELSE 'cancelled'::public.record_state END WHERE id=decision.record_id;
    END IF;
    INSERT INTO public.notifications(organization_id,user_id,title,body,record_type,record_id)
      VALUES(decision.organization_id,requester,record_number||' '||final_status,
      CASE WHEN final_status='approved' THEN 'All designated approvers have approved this record.' ELSE 'This record was rejected. Review the approval decision notes.' END,decision.record_type,decision.record_id);
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.itsm_create_service_request(uuid,uuid,text,text),public.itsm_create_change(uuid,jsonb),public.itsm_decide_approval(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.itsm_create_service_request(uuid,uuid,text,text),public.itsm_create_change(uuid,jsonb),public.itsm_decide_approval(uuid,text,text) TO authenticated;
