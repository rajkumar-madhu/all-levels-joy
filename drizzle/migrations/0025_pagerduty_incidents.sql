CREATE TABLE public.pagerduty_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pagerduty_id text NOT NULL,
  incident_id uuid NOT NULL REFERENCES public.incidents(id),
  status text NOT NULL,
  urgency text NOT NULL DEFAULT 'high',
  html_url text,
  service_name text,
  last_event_id text,
  last_occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, pagerduty_id)
);
CREATE TABLE public.pagerduty_events (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  pagerduty_id text NOT NULL,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_id)
);
GRANT SELECT ON public.pagerduty_incidents TO authenticated;
GRANT ALL ON public.pagerduty_incidents TO service_role;
GRANT ALL ON public.pagerduty_events TO service_role;
ALTER TABLE public.pagerduty_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagerduty_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read PagerDuty links" ON public.pagerduty_incidents
  FOR SELECT TO authenticated USING (public.can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.itsm_upsert_pagerduty_incident(_org_id uuid, _input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pd_id text := left(btrim(_input->>'id'), 256);
  ev_id text := left(btrim(_input->>'event_id'), 256);
  ev_type text := _input->>'event_type';
  pd_status text := _input->>'status';
  occurred timestamptz := (_input->>'occurred_at')::timestamptz;
  urg text := lower(coalesce(_input->>'urgency', 'high'));
  link public.pagerduty_incidents;
  inc public.incidents;
  next_value bigint;
  num text;
  imp smallint; urgv smallint;
  action text := 'updated';
BEGIN
  IF pd_id IS NULL OR pd_id = '' OR ev_id IS NULL OR ev_id = '' THEN RAISE EXCEPTION 'Missing identifiers'; END IF;
  IF ev_type NOT IN ('incident.triggered','incident.acknowledged','incident.resolved','incident.reopened') THEN
    RAISE EXCEPTION 'Unsupported event';
  END IF;

  INSERT INTO public.pagerduty_events(organization_id, event_id, pagerduty_id, event_type)
  VALUES (_org_id, ev_id, pd_id, ev_type) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO link FROM public.pagerduty_incidents WHERE organization_id = _org_id AND pagerduty_id = pd_id;
    RETURN jsonb_build_object('action','duplicate_event','incident_id', link.incident_id);
  END IF;

  SELECT * INTO link FROM public.pagerduty_incidents
    WHERE organization_id = _org_id AND pagerduty_id = pd_id FOR UPDATE;

  IF NOT FOUND THEN
    IF urg = 'high' THEN imp := 1; urgv := 1; ELSE imp := 2; urgv := 3; END IF;
    INSERT INTO public.record_counters(organization_id, prefix, current_value) VALUES (_org_id, 'INC', 1001)
      ON CONFLICT (organization_id, prefix) DO UPDATE SET current_value = public.record_counters.current_value + 1, updated_at = now()
      RETURNING current_value INTO next_value;
    num := 'INC' || lpad(next_value::text, 7, '0');
    INSERT INTO public.incidents(organization_id, number, title, description, category, contact_type, impact, urgency, sla_due_at)
    VALUES (_org_id, num, left('[PagerDuty] ' || coalesce(_input->>'title','PagerDuty incident'), 200),
      concat_ws(E'\n', 'Raised from PagerDuty.',
        CASE WHEN coalesce(_input->>'service','') <> '' THEN 'Service: ' || (_input->>'service') END,
        CASE WHEN coalesce(_input->>'html_url','') <> '' THEN 'Link: ' || (_input->>'html_url') END),
      'network', 'pagerduty', imp, urgv,
      now() + CASE WHEN imp + urgv <= 2 THEN interval '2 hours' WHEN imp + urgv <= 4 THEN interval '8 hours' ELSE interval '24 hours' END)
    RETURNING * INTO inc;
    INSERT INTO public.pagerduty_incidents(organization_id, pagerduty_id, incident_id, status, urgency, html_url, service_name, last_event_id, last_occurred_at)
    VALUES (_org_id, pd_id, inc.id, 'triggered', urg, nullif(_input->>'html_url',''), nullif(_input->>'service',''), ev_id, occurred)
    RETURNING * INTO link;
    action := 'created';
  ELSE
    IF link.last_occurred_at IS NOT NULL AND occurred < link.last_occurred_at THEN
      RETURN jsonb_build_object('action','stale_event','incident_id', link.incident_id);
    END IF;
    UPDATE public.pagerduty_incidents SET status = pd_status, last_event_id = ev_id, last_occurred_at = occurred, updated_at = now()
      WHERE id = link.id;
    SELECT * INTO inc FROM public.incidents WHERE id = link.incident_id FOR UPDATE;
    IF ev_type = 'incident.acknowledged' AND inc.state IN ('new','open') THEN
      UPDATE public.incidents SET state = 'in_progress' WHERE id = inc.id;
    ELSIF ev_type = 'incident.resolved' AND inc.state IN ('new','open','in_progress','pending') THEN
      UPDATE public.incidents SET state = 'resolved', close_code = 'solved_remotely',
        resolution_notes = 'Resolved in PagerDuty at ' || to_char(occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.'
        WHERE id = inc.id;
    ELSIF ev_type IN ('incident.reopened','incident.triggered') AND inc.state IN ('resolved','closed') THEN
      UPDATE public.incidents SET state = 'open' WHERE id = inc.id;
    END IF;
  END IF;

  SELECT * INTO inc FROM public.incidents WHERE id = link.incident_id;
  RETURN jsonb_build_object('action', action, 'incident_id', inc.id, 'number', inc.number, 'state', inc.state);
END $$;
REVOKE ALL ON FUNCTION public.itsm_upsert_pagerduty_incident(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itsm_upsert_pagerduty_incident(uuid, jsonb) TO service_role;