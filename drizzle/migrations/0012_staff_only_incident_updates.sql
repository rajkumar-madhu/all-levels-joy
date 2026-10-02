DROP POLICY IF EXISTS incidents_update ON public.incidents;
CREATE POLICY incidents_update ON public.incidents FOR UPDATE TO authenticated
  USING (public.can_manage(organization_id))
  WITH CHECK (public.can_manage(organization_id));

CREATE OR REPLACE FUNCTION public.validate_incident_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.problem_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.problems WHERE id = NEW.problem_id AND organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'The selected problem is not available in this organization'; END IF;
  IF current_user = 'authenticated' AND NOT public.can_manage(NEW.organization_id) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.major_incident OR NEW.problem_id IS NOT NULL OR NEW.resolution_notes IS NOT NULL
        OR NEW.close_code IS NOT NULL OR NEW.on_hold_reason IS NOT NULL OR NEW.first_responded_at IS NOT NULL THEN
        RAISE EXCEPTION 'You do not have permission to set incident operational fields';
      END IF;
      NEW.created_at := clock_timestamp();
      NEW.updated_at := NEW.created_at;
      NEW.sla_due_at := NEW.created_at + CASE WHEN NEW.impact + NEW.urgency <= 2 THEN interval '2 hours'
        WHEN NEW.impact + NEW.urgency <= 4 THEN interval '8 hours' ELSE interval '24 hours' END;
    ELSE
      RAISE EXCEPTION 'You do not have permission to manage incidents';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;