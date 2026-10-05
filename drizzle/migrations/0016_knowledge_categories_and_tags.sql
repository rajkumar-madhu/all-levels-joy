CREATE TABLE public.knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, slug)
);

GRANT SELECT, INSERT, UPDATE ON public.knowledge_categories TO authenticated;
GRANT ALL ON public.knowledge_categories TO service_role;
ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_categories_read ON public.knowledge_categories FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY knowledge_categories_insert ON public.knowledge_categories FOR INSERT TO authenticated WITH CHECK (public.can_manage(organization_id));
CREATE POLICY knowledge_categories_update ON public.knowledge_categories FOR UPDATE TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TRIGGER set_knowledge_categories_updated_at BEFORE UPDATE ON public.knowledge_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.knowledge_articles ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX knowledge_articles_tags_idx ON public.knowledge_articles USING gin (tags);

INSERT INTO public.knowledge_categories(organization_id,name,slug,sort_order) SELECT DISTINCT organization_id, category, lower(regexp_replace(category,'[^a-zA-Z0-9]+','-','g')), 900 FROM public.knowledge_articles ON CONFLICT DO NOTHING;