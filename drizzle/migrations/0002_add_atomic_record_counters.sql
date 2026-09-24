CREATE TABLE public.record_counters (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prefix text NOT NULL,
  current_value bigint NOT NULL DEFAULT 1000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, prefix),
  CONSTRAINT record_counters_prefix_check CHECK (prefix IN ('INC', 'REQ', 'CHG', 'KB', 'PRB', 'MI')),
  CONSTRAINT record_counters_value_check CHECK (current_value >= 0)
);

GRANT ALL ON public.record_counters TO service_role;

ALTER TABLE public.record_counters ENABLE ROW LEVEL SECURITY;

INSERT INTO public.record_counters (organization_id, prefix, current_value)
SELECT o.id, series.prefix,
  GREATEST(
    1000,
    COALESCE(
      CASE series.prefix
        WHEN 'INC' THEN (SELECT max(substring(i.number from '[0-9]+$')::bigint) FROM public.incidents i WHERE i.organization_id = o.id)
        WHEN 'REQ' THEN (SELECT max(substring(r.number from '[0-9]+$')::bigint) FROM public.service_requests r WHERE r.organization_id = o.id)
        WHEN 'CHG' THEN (SELECT max(substring(c.number from '[0-9]+$')::bigint) FROM public.changes c WHERE c.organization_id = o.id)
        WHEN 'KB' THEN (SELECT max(substring(k.number from '[0-9]+$')::bigint) FROM public.knowledge_articles k WHERE k.organization_id = o.id)
        WHEN 'PRB' THEN (SELECT max(substring(p.number from '[0-9]+$')::bigint) FROM public.problems p WHERE p.organization_id = o.id)
        WHEN 'MI' THEN (SELECT max(substring(m.number from '[0-9]+$')::bigint) FROM public.major_incidents m WHERE m.organization_id = o.id)
      END,
      1000
    )
  )
FROM public.organizations o
CROSS JOIN (VALUES ('INC'), ('REQ'), ('CHG'), ('KB'), ('PRB'), ('MI')) AS series(prefix);

CREATE OR REPLACE FUNCTION public.next_record_number(_org_id uuid, _prefix text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_value bigint;
  number_width integer;
BEGIN
  IF _prefix NOT IN ('INC', 'REQ', 'CHG', 'KB', 'PRB', 'MI') THEN
    RAISE EXCEPTION 'Unsupported record prefix';
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  INSERT INTO public.record_counters (organization_id, prefix, current_value)
  VALUES (_org_id, _prefix, 1001)
  ON CONFLICT (organization_id, prefix)
  DO UPDATE SET
    current_value = public.record_counters.current_value + 1,
    updated_at = now()
  RETURNING current_value INTO next_value;

  number_width := CASE WHEN _prefix = 'KB' THEN 6 ELSE 7 END;
  RETURN _prefix || lpad(next_value::text, number_width, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_record_number(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_record_number(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_record_number(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_record_number(uuid, text) TO service_role;