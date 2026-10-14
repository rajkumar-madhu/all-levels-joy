CREATE TABLE IF NOT EXISTS public.pagerduty_incidents (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pagerduty_id text NOT NULL,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  html_url text,
  pd_status text,
  last_event text,
  last_event_id text,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, pagerduty_id)
);

ALTER TABLE public.pagerduty_incidents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pagerduty_incidents TO authenticated;
GRANT ALL ON public.pagerduty_incidents TO service_role;
DROP POLICY IF EXISTS pagerduty_incidents_read ON public.pagerduty_incidents;
CREATE POLICY pagerduty_incidents_read ON public.pagerduty_incidents
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.itsm_upsert_pagerduty_incident(_org_id uuid, _input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.pagerduty_incidents;
  row public.incidents;
  pd_id text := btrim(_input->>'id');
  pd_title text := left(btrim(coalesce(_input->>'title', 'PagerDuty incident')), 160);
  incoming_status text := lower(btrim(coalesce(_input->>'status', 'triggered')));
  pd_event text := btrim(coalesce(_input->>'event_type', ''));
  pd_event_id text := btrim(coalesce(_input->>'event_id', ''));
  pd_url text := nullif(btrim(coalesce(_input->>'html_url', '')), '');
  pd_urgency text := lower(btrim(coalesce(_input->>'urgency', 'high')));
  impact smallint := CASE WHEN pd_urgency = 'low' THEN 2 ELSE 1 END;
  urgency smallint := CASE WHEN pd_urgency = 'low' THEN 2 ELSE 1 END;
  created boolean := false;
  service_name text := nullif(btrim(coalesce(_input->>'service', '')), '');
  event_at timestamptz := nullif(_input->>'occurred_at', '')::timestamptz;
  description text;
  next_value bigint;
BEGIN
  IF pd_id IS NULL OR pd_id = '' OR length(pd_id) > 256 THEN
    RAISE EXCEPTION 'Valid PagerDuty incident id is required';
  END IF;
  IF event_at IS NULL THEN
    RAISE EXCEPTION 'PagerDuty event timestamp is required';
  END IF;
  IF pd_event_id = '' OR length(pd_event_id) > 256 THEN
    RAISE EXCEPTION 'Valid PagerDuty event id is required';
  END IF;
  IF pd_event NOT IN (
    'incident.triggered', 'incident.acknowledged', 'incident.resolved', 'incident.reopened'
  ) OR incoming_status NOT IN ('triggered', 'acknowledged', 'resolved') THEN
    RAISE EXCEPTION 'Unsupported PagerDuty incident event';
  END IF;
  -- Serialize first delivery too: SELECT FOR UPDATE cannot lock a row that
  -- does not exist, and PagerDuty may retry or deliver the same incident twice.
  PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || pd_id, 0));
  IF length(pd_title) < 5 THEN
    pd_title := left('PagerDuty ' || pd_title, 160);
  END IF;
  description := 'Opened from PagerDuty' ||
    CASE WHEN service_name IS NULL THEN '' ELSE ' service ' || service_name END ||
    CASE WHEN pd_url IS NULL THEN '.' ELSE E'.\n' || pd_url END;

  SELECT * INTO link FROM pagerduty_incidents WHERE organization_id = _org_id AND pagerduty_id = pd_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO record_counters (organization_id, prefix, current_value)
    VALUES (_org_id, 'INC', 1001)
    ON CONFLICT (organization_id, prefix)
    DO UPDATE SET current_value = record_counters.current_value + 1, updated_at = now()
    RETURNING current_value INTO next_value;

    INSERT INTO incidents (
      organization_id, number, title, description, state, impact, urgency,
      category, contact_type, sla_due_at
    ) VALUES (
      _org_id,
      'INC' || lpad(next_value::text, 7, '0'),
      pd_title,
      description,
      'new',
      impact,
      urgency,
      'network',
      'monitoring',
      now() + CASE WHEN urgency = 1 THEN interval '2 hours' ELSE interval '8 hours' END
    ) RETURNING * INTO row;
    INSERT INTO pagerduty_incidents (
      organization_id, pagerduty_id, incident_id, html_url, pd_status,
      last_event, last_event_id, last_event_at
    ) VALUES (_org_id, pd_id, row.id, pd_url, incoming_status, pd_event, pd_event_id, event_at);
    created := true;
    SELECT * INTO link FROM pagerduty_incidents WHERE incident_id = row.id;
  ELSE
    SELECT * INTO row FROM incidents WHERE id = link.incident_id FOR UPDATE;
    IF pd_event_id = link.last_event_id OR
       (link.last_event_at IS NOT NULL AND event_at < link.last_event_at) THEN
      RETURN jsonb_build_object(
        'id', row.id,
        'number', row.number,
        'created', false,
        'state', row.state,
        'html_url', link.html_url,
        'stale_event', true
      );
    END IF;
  END IF;

  IF pd_event = 'incident.acknowledged' THEN
    IF row.state = 'new' THEN
      UPDATE incidents SET state = 'in_progress', updated_at = now() WHERE id = row.id RETURNING * INTO row;
    END IF;
  ELSIF pd_event = 'incident.resolved' THEN
    IF row.state IN ('new', 'open', 'in_progress', 'pending') THEN
      UPDATE incidents
      SET state = 'resolved',
          resolution_notes = 'Resolved in PagerDuty',
          close_code = 'solved_remotely',
          updated_at = now()
      WHERE id = row.id RETURNING * INTO row;
    END IF;
  ELSIF pd_event = 'incident.reopened' AND row.state IN ('resolved', 'closed') THEN
    UPDATE incidents
    SET state = 'open', updated_at = now()
    WHERE id = row.id RETURNING * INTO row;
  END IF;

  UPDATE pagerduty_incidents
  SET html_url = coalesce(pd_url, html_url),
      pd_status = incoming_status,
      last_event = nullif(pd_event, ''),
      last_event_id = pd_event_id,
      last_event_at = event_at,
      updated_at = now()
  WHERE organization_id = _org_id AND pagerduty_id = pd_id;

  RETURN jsonb_build_object(
    'id', row.id,
    'number', row.number,
    'created', created,
    'state', row.state,
    'html_url', pd_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.itsm_upsert_pagerduty_incident(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itsm_upsert_pagerduty_incident(uuid, jsonb) TO service_role;
