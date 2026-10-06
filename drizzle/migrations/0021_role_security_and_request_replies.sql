-- Helpers
CREATE OR REPLACE FUNCTION public.can_author_knowledge(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_org_id, auth.uid()) AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE organization_id = _org_id AND user_id = auth.uid()
      AND role IN ('service_desk','fulfiller','manager','admin'))
$$;
REVOKE ALL ON FUNCTION public.can_author_knowledge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_author_knowledge(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL AND lower(split_part(u.email, '@', 2)) = 'wecrew.in')
$$;
REVOKE ALL ON FUNCTION public.portal_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_allowed() TO authenticated, service_role;

-- Ticket creation: staff only directly
DROP POLICY incidents_create ON public.incidents;
CREATE POLICY incidents_create ON public.incidents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage(organization_id) AND requester_id = auth.uid());

-- Knowledge authoring
DROP POLICY knowledge_manage ON public.knowledge_articles;
CREATE POLICY knowledge_manage ON public.knowledge_articles FOR ALL TO authenticated
  USING (public.can_author_knowledge(organization_id)) WITH CHECK (public.can_author_knowledge(organization_id));
DROP POLICY knowledge_categories_insert ON public.knowledge_categories;
CREATE POLICY knowledge_categories_insert ON public.knowledge_categories FOR INSERT TO authenticated
  WITH CHECK (public.can_author_knowledge(organization_id));
DROP POLICY knowledge_categories_update ON public.knowledge_categories;
CREATE POLICY knowledge_categories_update ON public.knowledge_categories FOR UPDATE TO authenticated
  USING (public.can_author_knowledge(organization_id)) WITH CHECK (public.can_author_knowledge(organization_id));

-- Portal requester reads limited to members or allowed portal users
DROP POLICY incidents_requester_read ON public.incidents;
CREATE POLICY incidents_requester_read ON public.incidents FOR SELECT TO authenticated
  USING (requester_id = auth.uid() AND (public.is_org_member(organization_id) OR public.portal_allowed()));
DROP POLICY requests_requester_read ON public.service_requests;
CREATE POLICY requests_requester_read ON public.service_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() AND (public.is_org_member(organization_id) OR public.portal_allowed()));

-- Managers may approve changes
DO $do$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.itsm_create_change(uuid,jsonb)'::regprocedure);
  EXECUTE replace(def, $q$('cab_member','change_manager','admin')$q$, $q$('cab_member','change_manager','manager','admin')$q$);
  def := pg_get_functiondef('public.itsm_decide_approval(uuid,text,text)'::regprocedure);
  EXECUTE replace(def, $q$('cab_member','change_manager','admin')$q$, $q$('cab_member','change_manager','manager','admin')$q$);
  -- Portal submissions require an allowed portal account
  def := pg_get_functiondef('public.portal_submit_ticket(uuid,text,text,smallint,smallint,text)'::regprocedure);
  EXECUTE replace(def, $q$IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to submit a ticket'; END IF;$q$,
    $q$IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to submit a ticket'; END IF;
  IF NOT public.portal_allowed() THEN RAISE EXCEPTION 'The support portal is available to confirmed @wecrew.in accounts only'; END IF;$q$);
  def := pg_get_functiondef('public.portal_reply(uuid,text)'::regprocedure);
  EXECUTE replace(def, $q$IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply'; END IF;$q$,
    $q$IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply'; END IF;
  IF NOT public.portal_allowed() THEN RAISE EXCEPTION 'The support portal is available to confirmed @wecrew.in accounts only'; END IF;$q$);
END $do$;

-- Self-service incidents (catalogue issue form, assistant) for active members
CREATE OR REPLACE FUNCTION public.itsm_self_service_incident(_org_id uuid, _title text, _description text,
  _impact smallint, _urgency smallint, _category text, _subcategory text, _contact_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); num text; new_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_org_member(_org_id, uid) THEN RAISE EXCEPTION 'Active organization membership is required'; END IF;
  IF length(btrim(coalesce(_title,''))) NOT BETWEEN 5 AND 160 THEN RAISE EXCEPTION 'Summary must be 5-160 characters'; END IF;
  IF length(btrim(coalesce(_description,''))) NOT BETWEEN 5 AND 6000 THEN RAISE EXCEPTION 'Description must be 5-6000 characters'; END IF;
  IF _impact NOT BETWEEN 1 AND 3 OR _urgency NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid impact or urgency'; END IF;
  IF _contact_type IS NULL OR _contact_type NOT IN ('self_service','chat') THEN RAISE EXCEPTION 'Invalid contact type'; END IF;
  IF (SELECT count(*) FROM public.incidents WHERE requester_id = uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many tickets submitted recently. Please try again later.';
  END IF;
  num := public.next_record_number(_org_id, 'INC');
  INSERT INTO public.incidents(organization_id, number, title, description, state, impact, urgency, requester_id,
    category, subcategory, contact_type, sla_due_at)
  VALUES (_org_id, num, btrim(_title), btrim(_description), 'new', _impact, _urgency, uid,
    nullif(btrim(coalesce(_category,'')),''), nullif(btrim(coalesce(_subcategory,'')),''), _contact_type,
    now() + CASE WHEN _impact + _urgency <= 2 THEN interval '2 hours' WHEN _impact + _urgency <= 4 THEN interval '8 hours' ELSE interval '24 hours' END)
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('id', new_id, 'number', num);
END $$;
REVOKE ALL ON FUNCTION public.itsm_self_service_incident(uuid,text,text,smallint,smallint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itsm_self_service_incident(uuid,text,text,smallint,smallint,text,text,text) TO authenticated;

-- Requests waiting on customer
ALTER TABLE public.service_requests ADD COLUMN awaiting_customer_since timestamptz;

CREATE OR REPLACE FUNCTION public.itsm_pause_request_sla()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE waited interval;
BEGIN
  IF NEW.awaiting_customer_since IS NOT NULL AND OLD.awaiting_customer_since IS NULL THEN
    NEW.awaiting_customer_since := now();
    UPDATE public.sla_instances SET paused_at = now(), status = 'paused', updated_at = now()
      WHERE record_type = 'request' AND record_id = NEW.id AND status = 'running';
  ELSIF NEW.awaiting_customer_since IS NULL AND OLD.awaiting_customer_since IS NOT NULL THEN
    waited := now() - OLD.awaiting_customer_since;
    NEW.due_at := NEW.due_at + waited;
    UPDATE public.sla_instances SET due_at = due_at + waited, paused_at = NULL, status = 'running', updated_at = now()
      WHERE record_type = 'request' AND record_id = NEW.id AND status = 'paused';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.itsm_pause_request_sla() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pause_request_sla BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.itsm_pause_request_sla();

CREATE OR REPLACE FUNCTION public.portal_reply_request(_request_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); req public.service_requests; outcome text := 'comment';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply'; END IF;
  IF NOT (public.portal_allowed() OR EXISTS (SELECT 1 FROM public.service_requests s WHERE s.id = _request_id AND public.is_org_member(s.organization_id, uid))) THEN
    RAISE EXCEPTION 'The support portal is available to confirmed @wecrew.in accounts only';
  END IF;
  IF length(btrim(coalesce(_body,''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Reply must be 1-4000 characters'; END IF;
  SELECT * INTO req FROM public.service_requests WHERE id = _request_id AND requester_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only reply to your own tickets.'; END IF;
  INSERT INTO public.record_comments(organization_id, record_type, record_id, author_id, body, internal)
    VALUES (req.organization_id, 'request', req.id, uid, btrim(_body), false);
  IF req.awaiting_customer_since IS NOT NULL THEN
    UPDATE public.service_requests SET awaiting_customer_since = NULL,
      state = CASE WHEN state IN ('new','open','pending') AND approval_status <> 'requested' THEN 'in_progress'::public.record_state ELSE state END,
      updated_at = now() WHERE id = req.id;
    outcome := 'resumed';
  ELSIF req.state IN ('closed','cancelled') THEN
    outcome := 'closed';
  END IF;
  INSERT INTO public.notifications(organization_id, user_id, title, body, record_type, record_id)
    SELECT req.organization_id, gm.user_id, 'Customer replied: ' || req.number, left(btrim(_body), 200), 'request', req.id
    FROM public.group_members gm WHERE gm.group_id = req.group_id AND gm.user_id <> uid
    UNION SELECT req.organization_id, req.assignee_id, 'Customer replied: ' || req.number, left(btrim(_body), 200), 'request', req.id
    WHERE req.assignee_id IS NOT NULL AND req.assignee_id <> uid;
  SELECT * INTO req FROM public.service_requests WHERE id = _request_id;
  RETURN jsonb_build_object('outcome', outcome, 'state', req.state, 'dueAt', req.due_at);
END $$;
REVOKE ALL ON FUNCTION public.portal_reply_request(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reply_request(uuid,text) TO authenticated;