ALTER TABLE public.catalog_items
  ADD COLUMN default_group_id uuid REFERENCES public.groups(id),
  ADD COLUMN default_priority smallint NOT NULL DEFAULT 3 CHECK (default_priority BETWEEN 1 AND 4);
ALTER TABLE public.service_requests
  ADD COLUMN priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4);

UPDATE public.catalog_items SET default_group_id = CASE WHEN name = 'Software installation'
  THEN '20000000-0000-0000-0000-000000000002'::uuid ELSE '20000000-0000-0000-0000-000000000001'::uuid END,
  default_priority = CASE WHEN name = 'Software installation' THEN 4 ELSE 3 END
WHERE organization_id = '00000000-0000-0000-0000-000000000001' OR default_group_id IS NULL;

CREATE OR REPLACE FUNCTION public.itsm_route_incident_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.group_id IS NULL THEN
    SELECT id INTO NEW.group_id FROM public.groups
      WHERE organization_id = NEW.organization_id AND is_active
        AND name = CASE WHEN NEW.category IN ('network','database') THEN 'Platform Operations' ELSE 'Service Desk' END
      LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.itsm_route_incident_group() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER route_incident_group BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.itsm_route_incident_group();

CREATE OR REPLACE FUNCTION public.itsm_open_incident_sla()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sla_due_at IS NOT NULL THEN
    INSERT INTO public.sla_instances(organization_id, record_type, record_id, target_type, started_at, due_at)
    VALUES (NEW.organization_id, 'incident', NEW.id, 'response', NEW.created_at, NEW.sla_due_at);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.itsm_open_incident_sla() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER open_incident_sla AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.itsm_open_incident_sla();

CREATE OR REPLACE FUNCTION public.itsm_create_service_request(_org_id uuid, _catalog_item_id uuid, _title text, _description text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE item public.catalog_items; subject public.service_requests; approvers uuid[]; days int; grp_name text;
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
  days := greatest(0, item.delivery_days);
  IF item.default_priority = 1 THEN days := least(days, 1);
  ELSIF item.default_priority = 2 THEN days := least(days, 2); END IF;
  INSERT INTO public.service_requests(organization_id,number,catalog_item_id,title,description,requester_id,requested_for_id,state,approval_status,due_at,group_id,priority)
  VALUES(_org_id,public.next_record_number(_org_id,'REQ'),item.id,btrim(_title),btrim(_description),auth.uid(),auth.uid(),
    CASE WHEN item.approval_required THEN 'pending'::public.record_state ELSE 'new'::public.record_state END,
    CASE WHEN item.approval_required THEN 'requested' ELSE 'not_required' END,
    now()+make_interval(days=>days), item.default_group_id, item.default_priority) RETURNING * INTO subject;
  INSERT INTO public.sla_instances(organization_id, record_type, record_id, target_type, started_at, due_at)
    VALUES (_org_id, 'request', subject.id, 'fulfilment', subject.created_at, subject.due_at);
  INSERT INTO public.approvals(organization_id,record_type,record_id,approver_id)
    SELECT _org_id,'request',subject.id,x FROM unnest(approvers) x;
  INSERT INTO public.notifications(organization_id,user_id,title,body,record_type,record_id)
    SELECT _org_id,x,'Approval needed: '||subject.number,subject.title,'request',subject.id FROM unnest(approvers) x;
  SELECT name INTO grp_name FROM public.groups WHERE id = subject.group_id;
  RETURN jsonb_build_object('id',subject.id,'number',subject.number,'groupName',grp_name,'dueAt',subject.due_at,'priority',subject.priority);
END;
$function$;