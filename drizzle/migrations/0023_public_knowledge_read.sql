GRANT SELECT ON public.knowledge_articles TO anon;
GRANT SELECT ON public.knowledge_categories TO anon;

CREATE POLICY knowledge_public_read ON public.knowledge_articles
  FOR SELECT TO anon
  USING (status = 'published');

CREATE POLICY knowledge_categories_public_read ON public.knowledge_categories
  FOR SELECT TO anon
  USING (active = true);