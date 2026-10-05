CREATE OR REPLACE FUNCTION public.portal_reply(_incident_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); inc public.incidents; outcome text := 'comment';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply'; END IF;
  IF length(btrim(coalesce(_body,''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Reply must be 1-4000 characters'; END IF;
  SELECT * INTO inc FROM public.incidents WHERE id = _incident_id AND requester_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only reply to your own tickets.'; END IF;
  INSERT INTO public.record_comments(organization_id, record_type, record_id, author_id, body, internal)
    VALUES (inc.organization_id, 'incident', inc.id, uid, btrim(_body), false);
  IF inc.state = 'pending' AND inc.on_hold_reason = 'awaiting_caller' THEN
    UPDATE public.incidents SET state = 'in_progress', updated_at = now() WHERE id = inc.id;
    outcome := 'resumed';
  ELSIF inc.state = 'resolved' AND inc.resolved_at > now() - interval '7 days' THEN
    UPDATE public.sla_instances SET status = 'met', completed_at = coalesce(completed_at, now()), updated_at = now()
      WHERE record_type='incident' AND record_id=inc.id AND status IN ('running','paused');
    UPDATE public.incidents SET state = 'open',
      updated_at = now(),
      sla_due_at = now() + CASE WHEN inc.impact + inc.urgency <= 2 THEN interval '2 hours'
        WHEN inc.impact + inc.urgency <= 4 THEN interval '8 hours' ELSE interval '24 hours' END
      WHERE id = inc.id RETURNING * INTO inc;
    INSERT INTO public.sla_instances(organization_id, record_type, record_id, target_type, started_at, due_at)
      VALUES (inc.organization_id, 'incident', inc.id, 'resolution', now(), inc.sla_due_at);
    outcome := 'reopened';
  ELSIF inc.state IN ('closed','cancelled') THEN
    outcome := 'closed';
  END IF;
  INSERT INTO public.notifications(organization_id, user_id, title, body, record_type, record_id)
    SELECT inc.organization_id, gm.user_id, 'Customer replied: ' || inc.number, left(btrim(_body), 200), 'incident', inc.id
    FROM public.group_members gm WHERE gm.group_id = inc.group_id AND gm.user_id <> uid
    UNION SELECT inc.organization_id, inc.assignee_id, 'Customer replied: ' || inc.number, left(btrim(_body), 200), 'incident', inc.id
    WHERE inc.assignee_id IS NOT NULL AND inc.assignee_id <> uid;
  SELECT * INTO inc FROM public.incidents WHERE id = _incident_id;
  RETURN jsonb_build_object('outcome', outcome, 'state', inc.state, 'slaDueAt', inc.sla_due_at);
END $$;
REVOKE ALL ON FUNCTION public.portal_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reply(uuid, text) TO authenticated;