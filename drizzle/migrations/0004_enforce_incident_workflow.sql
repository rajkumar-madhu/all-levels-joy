-- Keep lifecycle rules effective for direct Supabase clients as well as server functions.
-- Existing historical rows are not rewritten; transitions validate new evidence.
CREATE OR REPLACE FUNCTION public.validate_incident_workflow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  incident_operator boolean;
  changing_state boolean;
BEGIN
  incident_operator := public.is_org_member(NEW.organization_id) AND (
    public.has_role(auth.uid(), 'service_desk', NEW.organization_id) OR
    public.has_role(auth.uid(), 'fulfiller', NEW.organization_id) OR
    public.has_role(auth.uid(), 'manager', NEW.organization_id) OR
    public.has_role(auth.uid(), 'admin', NEW.organization_id)
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'new' OR NEW.resolved_at IS NOT NULL OR NEW.reopen_count <> 0 THEN
      RAISE EXCEPTION 'New incidents must start in new state without resolution history';
    END IF;
    IF current_user = 'authenticated' AND NOT incident_operator AND NEW.assignee_id IS NOT NULL THEN
      RAISE EXCEPTION 'You do not have permission to assign incidents';
    END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
       NEW.requester_id IS DISTINCT FROM OLD.requester_id OR
       NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number THEN
      RAISE EXCEPTION 'Incident identity, organization, and requester cannot be changed';
    END IF;
    IF current_user = 'authenticated' AND NOT incident_operator AND
       ROW(NEW.state, NEW.assignee_id, NEW.group_id, NEW.impact, NEW.urgency,
           NEW.resolved_at, NEW.resolution_notes, NEW.close_code, NEW.on_hold_reason,
           NEW.reopen_count, NEW.first_responded_at, NEW.sla_due_at)
       IS DISTINCT FROM
       ROW(OLD.state, OLD.assignee_id, OLD.group_id, OLD.impact, OLD.urgency,
           OLD.resolved_at, OLD.resolution_notes, OLD.close_code, OLD.on_hold_reason,
           OLD.reopen_count, OLD.first_responded_at, OLD.sla_due_at) THEN
      RAISE EXCEPTION 'You do not have permission to manage incidents';
    END IF;

    changing_state := NEW.state IS DISTINCT FROM OLD.state;
    IF changing_state AND NOT (
      (OLD.state = 'new' AND NEW.state IN ('open', 'in_progress', 'pending', 'resolved', 'cancelled')) OR
      (OLD.state IN ('open', 'in_progress', 'pending') AND NEW.state IN ('open', 'in_progress', 'pending', 'resolved', 'cancelled')) OR
      (OLD.state = 'resolved' AND NEW.state IN ('closed', 'open')) OR
      (OLD.state = 'closed' AND NEW.state = 'open')
    ) THEN
      RAISE EXCEPTION 'Incident cannot move from % to %', OLD.state, NEW.state;
    END IF;

    IF NEW.state = 'pending' AND (changing_state OR NEW.on_hold_reason IS DISTINCT FROM OLD.on_hold_reason) AND
       (NEW.on_hold_reason IS NULL OR NEW.on_hold_reason NOT IN ('awaiting_caller', 'awaiting_vendor', 'awaiting_change', 'awaiting_problem')) THEN
      RAISE EXCEPTION 'Select a valid hold reason before placing this incident on hold';
    END IF;
    IF NEW.state <> 'pending' THEN NEW.on_hold_reason := NULL; END IF;

    NEW.reopen_count := OLD.reopen_count;
    IF changing_state AND OLD.state IN ('resolved', 'closed') AND NEW.state = 'open' THEN
      NEW.resolved_at := NULL;
      NEW.resolution_notes := NULL;
      NEW.close_code := NULL;
      NEW.reopen_count := OLD.reopen_count + 1;
    ELSIF NEW.state IN ('resolved', 'closed') THEN
      IF changing_state OR NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes OR NEW.close_code IS DISTINCT FROM OLD.close_code THEN
        IF NEW.resolution_notes IS NULL OR btrim(NEW.resolution_notes) = '' THEN
          RAISE EXCEPTION 'Add resolution notes before resolving or closing this incident';
        END IF;
        IF NEW.close_code IS NULL OR NEW.close_code NOT IN ('solved_permanently', 'solved_workaround', 'solved_remotely', 'not_solved', 'duplicate') THEN
          RAISE EXCEPTION 'Select a valid close code before resolving or closing this incident';
        END IF;
      END IF;
      IF changing_state AND NEW.state = 'resolved' THEN
        NEW.resolved_at := clock_timestamp();
      ELSE
        NEW.resolved_at := OLD.resolved_at;
      END IF;
      IF changing_state AND NEW.state = 'closed' AND NEW.resolved_at IS NULL THEN
        RAISE EXCEPTION 'This incident has no resolution timestamp. Reopen and resolve it before closing';
      END IF;
    ELSE
      NEW.resolved_at := NULL;
    END IF;

    NEW.first_responded_at := OLD.first_responded_at;
    IF OLD.first_responded_at IS NULL AND (
      (NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) OR
      (changing_state AND NEW.state IN ('open', 'in_progress', 'pending', 'resolved'))
    ) THEN NEW.first_responded_at := clock_timestamp(); END IF;

    -- This trigger sorts after set_incidents_updated_at. Monotonic versions also
    -- prevent two writes inside one transaction from sharing a concurrency token.
    NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  END IF;

  IF NEW.group_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM OLD.group_id) AND
     NOT EXISTS (SELECT 1 FROM public.groups WHERE id = NEW.group_id AND organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'The selected group is not available in this organization';
  END IF;
  IF NEW.service_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id) AND
     NOT EXISTS (SELECT 1 FROM public.services WHERE id = NEW.service_id AND organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'The selected service is not available in this organization';
  END IF;
  IF NEW.assignee_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) AND
     NOT public.is_org_member(NEW.organization_id, NEW.assignee_id) THEN
    RAISE EXCEPTION 'The selected assignee is not a member of this organization';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_incident_workflow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validate_incident_workflow ON public.incidents;
CREATE TRIGGER validate_incident_workflow
BEFORE INSERT OR UPDATE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.validate_incident_workflow();
