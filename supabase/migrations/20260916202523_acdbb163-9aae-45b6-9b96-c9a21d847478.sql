ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS contact_type text,
  ADD COLUMN IF NOT EXISTS on_hold_reason text,
  ADD COLUMN IF NOT EXISTS close_code text,
  ADD COLUMN IF NOT EXISTS first_responded_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS incidents_category_idx ON public.incidents (organization_id, category);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON public.incidents (organization_id, created_at DESC);

UPDATE public.incidents SET category = 'network', contact_type = 'monitoring'
  WHERE category IS NULL AND (title ILIKE '%vpn%' OR title ILIKE '%network%');
UPDATE public.incidents SET category = 'software', contact_type = 'self_service'
  WHERE category IS NULL;