CREATE OR REPLACE FUNCTION public.portal_submit_ticket(_org_id uuid, _title text, _description text, _impact smallint, _urgency smallint, _category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); n bigint; num text; new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to submit a ticket'; END IF;
  IF length(trim(coalesce(_title,''))) < 5 OR length(_title) > 160 THEN RAISE EXCEPTION 'Summary must be 5-160 characters'; END IF;
  IF length(trim(coalesce(_description,''))) < 5 OR length(_description) > 6000 THEN RAISE EXCEPTION 'Description must be 5-6000 characters'; END IF;
  IF _impact NOT BETWEEN 1 AND 3 OR _urgency NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid impact or urgency'; END IF;
  IF _category IS NOT NULL AND _category NOT IN ('network','hardware','software','database','inquiry') THEN RAISE EXCEPTION 'Invalid category'; END IF;
  IF (SELECT count(*) FROM incidents WHERE requester_id = uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many tickets submitted recently. Please try again later.';
  END IF;
  INSERT INTO record_counters (organization_id, prefix, current_value) VALUES (_org_id, 'INC', 1001)
  ON CONFLICT (organization_id, prefix) DO UPDATE SET current_value = record_counters.current_value + 1, updated_at = now()
  RETURNING current_value INTO n;
  num := 'INC' || lpad(n::text, 7, '0');
  INSERT INTO incidents (organization_id, number, title, description, state, impact, urgency, requester_id, category, contact_type, sla_due_at)
  VALUES (_org_id, num, trim(_title), trim(_description), 'new', _impact, _urgency, uid, _category, 'portal',
    now() + CASE WHEN _impact + _urgency <= 2 THEN interval '2 hours' WHEN _impact + _urgency <= 4 THEN interval '8 hours' ELSE interval '24 hours' END)
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('id', new_id, 'number', num);
END $$;
REVOKE ALL ON FUNCTION public.portal_submit_ticket(uuid,text,text,smallint,smallint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_submit_ticket(uuid,text,text,smallint,smallint,text) TO authenticated;