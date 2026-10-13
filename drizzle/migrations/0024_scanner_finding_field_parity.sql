CREATE OR REPLACE FUNCTION public.itsm_upsert_scanner_finding(_org_id uuid, _input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.security_findings; before_row jsonb;
  sev text := _input->>'severity'; scanner text := btrim(_input->>'scanner');
  ref text := btrim(_input->>'reference'); asset text := coalesce(btrim(_input->>'asset'),'');
  created boolean := false; service uuid := nullif(_input->>'serviceId','')::uuid;
  owner_user uuid := nullif(_input->>'ownerId','')::uuid; ci_ids uuid[];
BEGIN
  IF sev IS NULL OR sev NOT IN ('critical','high','medium','low') OR nullif(scanner,'') IS NULL OR nullif(ref,'') IS NULL
    OR length(btrim(coalesce(_input->>'title',''))) < 3 THEN RAISE EXCEPTION 'Invalid scanner finding'; END IF;
  IF service IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.services WHERE id=service AND organization_id=_org_id) THEN
    RAISE EXCEPTION 'Service must belong to this workspace'; END IF;
  IF owner_user IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.memberships WHERE user_id=owner_user AND organization_id=_org_id AND is_active) THEN
    RAISE EXCEPTION 'Owner must be an active workspace member'; END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO ci_ids FROM jsonb_array_elements_text(coalesce(_input->'affectedCiIds','[]'::jsonb));
  IF EXISTS(SELECT 1 FROM unnest(ci_ids) ci WHERE NOT EXISTS(SELECT 1 FROM public.configuration_items WHERE id=ci AND organization_id=_org_id)) THEN
    RAISE EXCEPTION 'Affected assets must belong to this workspace'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || scanner || ':' || ref || ':' || asset,0));
  SELECT * INTO f FROM public.security_findings WHERE organization_id=_org_id AND source='scanner' AND scanner_name=scanner AND reference=ref AND asset_key=asset FOR UPDATE;
  IF FOUND THEN
    before_row := to_jsonb(f);
    UPDATE public.security_findings SET last_seen_at=now(), title=btrim(_input->>'title'),
      description=CASE WHEN _input ? 'description' THEN btrim(_input->>'description') ELSE description END,
      severity=sev,
      service_id=CASE WHEN state='requested' AND _input ? 'serviceId' THEN service ELSE service_id END,
      owner_id=CASE WHEN state='requested' AND _input ? 'ownerId' THEN owner_user ELSE owner_id END,
      affected_ci_ids=CASE WHEN state='requested' AND _input ? 'affectedCiIds' THEN ci_ids ELSE affected_ci_ids END,
      impact_assessment=CASE WHEN state='requested' THEN coalesce(_input->>'impactAssessment',impact_assessment) ELSE impact_assessment END,
      fix_plan=CASE WHEN state='requested' THEN coalesce(_input->>'fixPlan',fix_plan) ELSE fix_plan END,
      test_plan=CASE WHEN state='requested' THEN coalesce(_input->>'testPlan',test_plan) ELSE test_plan END,
      rollback_plan=CASE WHEN state='requested' THEN coalesce(_input->>'rollbackPlan',rollback_plan) ELSE rollback_plan END,
      rollback_trigger=CASE WHEN state='requested' THEN coalesce(_input->>'rollbackTrigger',rollback_trigger) ELSE rollback_trigger END,
      state=CASE WHEN state IN ('closed','cancelled') THEN 'requested' ELSE state END,
      due_at=CASE WHEN state IN ('closed','cancelled') THEN public.itsm_security_due(sev,now()) ELSE due_at END
    WHERE id=f.id RETURNING * INTO f;
  ELSE
    INSERT INTO public.security_findings(organization_id,number,title,description,source,scanner_name,reference,asset_key,severity,due_at,service_id,owner_id,affected_ci_ids,impact_assessment,fix_plan,test_plan,rollback_plan,rollback_trigger)
    VALUES(_org_id,public.itsm_security_next_number(_org_id),btrim(_input->>'title'),coalesce(btrim(_input->>'description'),''),
      'scanner',scanner,ref,asset,sev,public.itsm_security_due(sev,now()),service,owner_user,ci_ids,
      _input->>'impactAssessment',_input->>'fixPlan',_input->>'testPlan',_input->>'rollbackPlan',_input->>'rollbackTrigger') RETURNING * INTO f;
    created := true;
  END IF;
  PERFORM public.itsm_security_audit(f,CASE WHEN created THEN 'scanner_created' ELSE 'scanner_seen' END,before_row);
  RETURN jsonb_build_object('id',f.id,'number',f.number,'created',created);
END; $$;
REVOKE ALL ON FUNCTION public.itsm_upsert_scanner_finding(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itsm_upsert_scanner_finding(uuid,jsonb) TO service_role;