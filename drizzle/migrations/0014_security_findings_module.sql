CREATE TABLE public.security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','scanner')),
  scanner_name text,
  reference text,
  asset_key text NOT NULL DEFAULT '',
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','pending_approval','scheduled','remediating','delivered','closed','cancelled','risk_accepted')),
  service_id uuid REFERENCES public.services(id),
  affected_ci_ids uuid[] NOT NULL DEFAULT '{}',
  owner_id uuid,
  requester_id uuid,
  impact_assessment text,
  fix_plan text,
  test_plan text,
  rollback_plan text,
  rollback_trigger text,
  window_start timestamptz,
  window_end timestamptz,
  due_at timestamptz NOT NULL,
  approver_id uuid,
  approval_notes text,
  approved_at timestamptz,
  delivery_outcome text CHECK (delivery_outcome IS NULL OR delivery_outcome IN ('successful','partial','failed')),
  validation_results text,
  rollback_used boolean NOT NULL DEFAULT false,
  review_notes text,
  delivered_at timestamptz,
  closed_at timestamptz,
  change_id uuid REFERENCES public.changes(id),
  incident_id uuid REFERENCES public.incidents(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);
CREATE UNIQUE INDEX security_findings_scanner_key ON public.security_findings(organization_id, scanner_name, reference, asset_key) WHERE source='scanner';
CREATE INDEX security_findings_org_state ON public.security_findings(organization_id, state, severity);

CREATE TABLE public.security_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES public.security_findings(id) ON DELETE CASCADE,
  justification text NOT NULL,
  compensating_controls text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','expired')),
  previous_state text,
  requested_by uuid,
  decided_by uuid,
  decision_notes text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_exceptions_finding ON public.security_exceptions(finding_id);

GRANT SELECT ON public.security_findings TO authenticated;
GRANT ALL ON public.security_findings TO service_role;
GRANT SELECT ON public.security_exceptions TO authenticated;
GRANT ALL ON public.security_exceptions TO service_role;
ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_findings_staff_read ON public.security_findings FOR SELECT TO authenticated USING (public.can_manage(organization_id));
CREATE POLICY security_exceptions_staff_read ON public.security_exceptions FOR SELECT TO authenticated USING (public.can_manage(organization_id));

CREATE TRIGGER set_security_findings_updated_at BEFORE UPDATE ON public.security_findings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.itsm_security_due(_severity text, _from timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _from + (CASE _severity WHEN 'critical' THEN 7 WHEN 'high' THEN 30 WHEN 'medium' THEN 90 ELSE 180 END) * interval '1 day';
$$;

CREATE OR REPLACE FUNCTION public.itsm_security_next_number(_org_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO public.record_counters(organization_id,prefix,current_value) VALUES(_org_id,'SEC',1001)
  ON CONFLICT(organization_id,prefix) DO UPDATE SET current_value=record_counters.current_value+1, updated_at=now()
  RETURNING current_value INTO v;
  RETURN 'SEC'||lpad(v::text,7,'0');
END; $$;
REVOKE ALL ON FUNCTION public.itsm_security_next_number(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.itsm_security_audit(_f public.security_findings, _action text, _before jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_events(organization_id,record_type,record_id,actor_id,action,source,before_values,after_values,correlation_id)
  VALUES(_f.organization_id,'security_finding',_f.id,auth.uid(),_action,'application',_before,
    jsonb_build_object('number',_f.number,'state',_f.state,'severity',_f.severity,'due_at',_f.due_at,'window_start',_f.window_start,'window_end',_f.window_end),gen_random_uuid());
END; $$;
REVOKE ALL ON FUNCTION public.itsm_security_audit(public.security_findings,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.itsm_create_security_finding(_org_id uuid, _input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.security_findings; sev text := _input->>'severity';
BEGIN
  IF NOT public.can_manage(_org_id) THEN RAISE EXCEPTION 'Only workspace staff can record security findings' USING ERRCODE='42501'; END IF;
  IF sev NOT IN ('critical','high','medium','low') THEN RAISE EXCEPTION 'Choose a valid severity'; END IF;
  IF length(btrim(coalesce(_input->>'title','')))<5 THEN RAISE EXCEPTION 'Title must be at least 5 characters'; END IF;
  IF nullif(_input->>'serviceId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM services WHERE id=(_input->>'serviceId')::uuid AND organization_id=_org_id) THEN
    RAISE EXCEPTION 'The selected service is not in this organization'; END IF;
  INSERT INTO security_findings(organization_id,number,title,description,source,reference,severity,service_id,owner_id,requester_id,due_at)
  VALUES(_org_id,itsm_security_next_number(_org_id),btrim(_input->>'title'),coalesce(btrim(_input->>'description'),''),'manual',
    nullif(btrim(_input->>'reference'),''),sev,nullif(_input->>'serviceId','')::uuid,auth.uid(),auth.uid(),itsm_security_due(sev,now()))
  RETURNING * INTO f;
  PERFORM itsm_security_audit(f,'created',NULL);
  RETURN jsonb_build_object('id',f.id,'number',f.number);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_create_security_finding(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_create_security_finding(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.itsm_transition_security_finding(_finding_id uuid, _action text, _input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.security_findings; before jsonb; approver boolean; ws timestamptz; we timestamptz;
BEGIN
  SELECT * INTO f FROM security_findings WHERE id=_finding_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage(f.organization_id) THEN RAISE EXCEPTION 'Security finding not available' USING ERRCODE='42501'; END IF;
  before := jsonb_build_object('state',f.state);
  approver := EXISTS(SELECT 1 FROM user_roles WHERE organization_id=f.organization_id AND user_id=auth.uid() AND role IN ('manager','admin','change_manager'));
  IF f.state IN ('closed','cancelled') THEN RAISE EXCEPTION 'This finding is already closed'; END IF;
  CASE _action
  WHEN 'submit' THEN
    IF f.state<>'requested' THEN RAISE EXCEPTION 'Only requested findings can be submitted'; END IF;
    IF length(btrim(coalesce(_input->>'impactAssessment','')))<5 OR length(btrim(coalesce(_input->>'fixPlan','')))<5
      OR length(btrim(coalesce(_input->>'testPlan','')))<5 OR length(btrim(coalesce(_input->>'rollbackPlan','')))<5
      OR length(btrim(coalesce(_input->>'rollbackTrigger','')))<5 THEN
      RAISE EXCEPTION 'Impact assessment, fix, test and rollback plans and rollback trigger are required'; END IF;
    UPDATE security_findings SET impact_assessment=btrim(_input->>'impactAssessment'),fix_plan=btrim(_input->>'fixPlan'),
      test_plan=btrim(_input->>'testPlan'),rollback_plan=btrim(_input->>'rollbackPlan'),rollback_trigger=btrim(_input->>'rollbackTrigger'),
      state='pending_approval' WHERE id=f.id RETURNING * INTO f;
  WHEN 'approve', 'reject' THEN
    IF f.state<>'pending_approval' THEN RAISE EXCEPTION 'This finding is not awaiting approval'; END IF;
    IF NOT approver THEN RAISE EXCEPTION 'Only a manager, change manager or admin can approve fixes' USING ERRCODE='42501'; END IF;
    IF f.requester_id=auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own fix plan'; END IF;
    IF _action='reject' AND nullif(btrim(_input->>'notes'),'') IS NULL THEN RAISE EXCEPTION 'Decision notes are required when rejecting'; END IF;
    UPDATE security_findings SET approver_id=auth.uid(),approval_notes=nullif(btrim(_input->>'notes'),''),approved_at=clock_timestamp(),
      state=CASE WHEN _action='approve' THEN 'scheduled' ELSE 'cancelled' END,
      closed_at=CASE WHEN _action='reject' THEN clock_timestamp() END WHERE id=f.id RETURNING * INTO f;
    IF f.requester_id IS NOT NULL THEN
      INSERT INTO notifications(organization_id,user_id,title,body,record_type,record_id)
      VALUES(f.organization_id,f.requester_id,f.number||' '||CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END,
        coalesce(f.approval_notes,'The fix plan decision was recorded.'),'security_finding',f.id);
    END IF;
  WHEN 'schedule' THEN
    IF f.state<>'scheduled' THEN RAISE EXCEPTION 'Approve the fix before scheduling it'; END IF;
    ws := (_input->>'windowStart')::timestamptz; we := (_input->>'windowEnd')::timestamptz;
    IF ws IS NULL OR we IS NULL OR we<=ws THEN RAISE EXCEPTION 'The fix window must end after it starts'; END IF;
    UPDATE security_findings SET window_start=ws,window_end=we WHERE id=f.id RETURNING * INTO f;
  WHEN 'start' THEN
    IF f.state<>'scheduled' OR f.window_start IS NULL THEN RAISE EXCEPTION 'Schedule a fix window first'; END IF;
    IF f.window_start>now() THEN RAISE EXCEPTION 'Work cannot start before the fix window opens'; END IF;
    UPDATE security_findings SET state='remediating' WHERE id=f.id RETURNING * INTO f;
  WHEN 'deliver' THEN
    IF f.state<>'remediating' THEN RAISE EXCEPTION 'Start remediation before recording delivery'; END IF;
    IF coalesce(_input->>'outcome','') NOT IN ('successful','partial','failed') OR nullif(btrim(_input->>'validationResults'),'') IS NULL
      OR nullif(btrim(_input->>'reviewNotes'),'') IS NULL THEN RAISE EXCEPTION 'Outcome, validation results and review notes are required'; END IF;
    UPDATE security_findings SET state='delivered',delivery_outcome=_input->>'outcome',validation_results=btrim(_input->>'validationResults'),
      review_notes=btrim(_input->>'reviewNotes'),rollback_used=coalesce((_input->>'rollbackUsed')::boolean,false),delivered_at=clock_timestamp()
      WHERE id=f.id RETURNING * INTO f;
  WHEN 'close' THEN
    IF f.state<>'delivered' THEN RAISE EXCEPTION 'Record delivery before closing'; END IF;
    UPDATE security_findings SET state='closed',closed_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
  WHEN 'cancel' THEN
    UPDATE security_findings SET state='cancelled',closed_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
  WHEN 'link' THEN
    IF nullif(_input->>'changeId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM changes WHERE id=(_input->>'changeId')::uuid AND organization_id=f.organization_id) THEN RAISE EXCEPTION 'Change not found'; END IF;
    IF nullif(_input->>'incidentId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM incidents WHERE id=(_input->>'incidentId')::uuid AND organization_id=f.organization_id) THEN RAISE EXCEPTION 'Incident not found'; END IF;
    UPDATE security_findings SET change_id=CASE WHEN _input ? 'changeId' THEN nullif(_input->>'changeId','')::uuid ELSE change_id END,
      incident_id=CASE WHEN _input ? 'incidentId' THEN nullif(_input->>'incidentId','')::uuid ELSE incident_id END
      WHERE id=f.id RETURNING * INTO f;
  ELSE RAISE EXCEPTION 'Unknown action';
  END CASE;
  PERFORM itsm_security_audit(f,_action,before);
  RETURN jsonb_build_object('ok',true,'state',f.state);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_transition_security_finding(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_transition_security_finding(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.itsm_request_security_exception(_finding_id uuid, _justification text, _controls text, _expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.security_findings; e_id uuid;
BEGIN
  SELECT * INTO f FROM security_findings WHERE id=_finding_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage(f.organization_id) THEN RAISE EXCEPTION 'Security finding not available' USING ERRCODE='42501'; END IF;
  IF f.state IN ('closed','cancelled','delivered','risk_accepted') THEN RAISE EXCEPTION 'An exception cannot be requested for this finding'; END IF;
  IF length(btrim(coalesce(_justification,'')))<10 OR length(btrim(coalesce(_controls,'')))<10 THEN RAISE EXCEPTION 'Justification and compensating controls are required'; END IF;
  IF _expires_at<=now() OR _expires_at>now()+interval '366 days' THEN RAISE EXCEPTION 'Expiry must be within the next year'; END IF;
  IF EXISTS(SELECT 1 FROM security_exceptions WHERE finding_id=f.id AND status='requested') THEN RAISE EXCEPTION 'An exception is already awaiting a decision'; END IF;
  INSERT INTO security_exceptions(organization_id,finding_id,justification,compensating_controls,expires_at,requested_by)
  VALUES(f.organization_id,f.id,btrim(_justification),btrim(_controls),_expires_at,auth.uid()) RETURNING id INTO e_id;
  PERFORM itsm_security_audit(f,'exception_requested',NULL);
  RETURN jsonb_build_object('id',e_id);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_request_security_exception(uuid,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_request_security_exception(uuid,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.itsm_decide_security_exception(_exception_id uuid, _decision text, _notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.security_exceptions; f public.security_findings;
BEGIN
  SELECT * INTO e FROM security_exceptions WHERE id=_exception_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM user_roles WHERE organization_id=e.organization_id AND user_id=auth.uid() AND role IN ('manager','admin'))
    OR NOT public.is_org_member(e.organization_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only a manager or admin can decide risk exceptions' USING ERRCODE='42501'; END IF;
  IF e.status<>'requested' THEN RAISE EXCEPTION 'This exception has already been decided'; END IF;
  IF e.requested_by=auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own exception'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approved or rejected'; END IF;
  IF _decision='rejected' AND nullif(btrim(_notes),'') IS NULL THEN RAISE EXCEPTION 'Decision notes are required when rejecting'; END IF;
  SELECT * INTO f FROM security_findings WHERE id=e.finding_id FOR UPDATE;
  UPDATE security_exceptions SET status=_decision,decided_by=auth.uid(),decision_notes=nullif(btrim(_notes),''),decided_at=clock_timestamp(),
    previous_state=f.state WHERE id=e.id;
  IF _decision='approved' THEN
    UPDATE security_findings SET state='risk_accepted' WHERE id=f.id RETURNING * INTO f;
  END IF;
  PERFORM itsm_security_audit(f,'exception_'||_decision,NULL);
  RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_decide_security_exception(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_decide_security_exception(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.itsm_expire_security_exceptions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record; f public.security_findings; n integer := 0;
BEGIN
  FOR e IN SELECT * FROM security_exceptions WHERE status='approved' AND expires_at<=now() FOR UPDATE LOOP
    UPDATE security_exceptions SET status='expired' WHERE id=e.id;
    UPDATE security_findings SET state=CASE WHEN coalesce(e.previous_state,'requested') IN ('scheduled','remediating','pending_approval') THEN e.previous_state ELSE 'requested' END,
      due_at=itsm_security_due(severity,now())
      WHERE id=e.finding_id AND state='risk_accepted' RETURNING * INTO f;
    IF f.id IS NOT NULL THEN
      PERFORM itsm_security_audit(f,'exception_expired',NULL);
      IF f.owner_id IS NOT NULL THEN
        INSERT INTO notifications(organization_id,user_id,title,body,record_type,record_id)
        VALUES(f.organization_id,f.owner_id,f.number||' reopened','The risk exception expired. The finding needs remediation.','security_finding',f.id);
      END IF;
    END IF;
    n := n+1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.itsm_expire_security_exceptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itsm_expire_security_exceptions() TO service_role;

CREATE OR REPLACE FUNCTION public.itsm_upsert_scanner_finding(_org_id uuid, _input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.security_findings; sev text := _input->>'severity'; scanner text := btrim(_input->>'scanner');
  ref text := btrim(_input->>'reference'); asset text := coalesce(btrim(_input->>'asset'),''); created boolean := false;
BEGIN
  IF sev NOT IN ('critical','high','medium','low') OR nullif(scanner,'') IS NULL OR nullif(ref,'') IS NULL THEN RAISE EXCEPTION 'Invalid scanner finding'; END IF;
  SELECT * INTO f FROM security_findings WHERE organization_id=_org_id AND source='scanner' AND scanner_name=scanner AND reference=ref AND asset_key=asset FOR UPDATE;
  IF FOUND THEN
    UPDATE security_findings SET last_seen_at=now(), severity=sev,
      state=CASE WHEN state IN ('closed','cancelled') THEN 'requested' ELSE state END,
      due_at=CASE WHEN state IN ('closed','cancelled') THEN itsm_security_due(sev,now()) ELSE due_at END
      WHERE id=f.id RETURNING * INTO f;
  ELSE
    INSERT INTO security_findings(organization_id,number,title,description,source,scanner_name,reference,asset_key,severity,due_at)
    VALUES(_org_id,itsm_security_next_number(_org_id),left(btrim(_input->>'title'),160),left(coalesce(_input->>'description',''),6000),
      'scanner',scanner,ref,asset,sev,itsm_security_due(sev,now())) RETURNING * INTO f;
    created := true;
  END IF;
  PERFORM itsm_security_audit(f,CASE WHEN created THEN 'scanner_created' ELSE 'scanner_seen' END,NULL);
  RETURN jsonb_build_object('id',f.id,'number',f.number,'created',created);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_upsert_scanner_finding(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itsm_upsert_scanner_finding(uuid,jsonb) TO service_role;