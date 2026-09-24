ALTER TABLE public.changes
  ADD COLUMN IF NOT EXISTS business_justification text,
  ADD COLUMN IF NOT EXISTS impact_assessment text,
  ADD COLUMN IF NOT EXISTS expected_outage_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS affected_ci_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS validation_plan text,
  ADD COLUMN IF NOT EXISTS rollback_trigger text,
  ADD COLUMN IF NOT EXISTS communication_plan text,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS actual_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_outcome text,
  ADD COLUMN IF NOT EXISTS validation_results text,
  ADD COLUMN IF NOT EXISTS rollback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE public.changes
  ADD CONSTRAINT changes_expected_outage_nonnegative CHECK (expected_outage_minutes >= 0),
  ADD CONSTRAINT changes_approval_status_valid CHECK (approval_status IN ('not_required', 'requested', 'approved', 'rejected')),
  ADD CONSTRAINT changes_delivery_outcome_valid CHECK (delivery_outcome IS NULL OR delivery_outcome IN ('successful', 'successful_with_issues', 'failed', 'rolled_back'));

CREATE INDEX IF NOT EXISTS idx_changes_approval_status ON public.changes (organization_id, approval_status, start_at);
CREATE INDEX IF NOT EXISTS idx_changes_delivery ON public.changes (organization_id, delivered_at, closed_at);

CREATE OR REPLACE FUNCTION public.validate_change_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.start_at IS NOT NULL AND NEW.end_at IS NOT NULL AND NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'Change window end must be after its start';
  END IF;
  IF NEW.actual_start_at IS NOT NULL AND NEW.actual_end_at IS NOT NULL AND NEW.actual_end_at < NEW.actual_start_at THEN
    RAISE EXCEPTION 'Actual completion must be after implementation start';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_change_window ON public.changes;
CREATE TRIGGER validate_change_window
BEFORE INSERT OR UPDATE ON public.changes
FOR EACH ROW EXECUTE FUNCTION public.validate_change_window();