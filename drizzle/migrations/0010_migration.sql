CREATE TABLE public.change_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  change_id uuid NOT NULL REFERENCES public.changes(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('incident','problem')),
  record_id uuid NOT NULL,
  relation text NOT NULL DEFAULT 'resolves' CHECK (relation IN ('resolves','caused_by','related')),
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_id, record_type, record_id)
);
GRANT SELECT, INSERT, DELETE ON public.change_links TO authenticated;
GRANT ALL ON public.change_links TO service_role;
ALTER TABLE public.change_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX change_links_record_idx ON public.change_links (record_type, record_id);
CREATE POLICY "Members read change links" ON public.change_links FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "Managers add change links" ON public.change_links FOR INSERT TO authenticated
  WITH CHECK (public.can_manage(organization_id) AND linked_by = auth.uid());
CREATE POLICY "Managers remove change links" ON public.change_links FOR DELETE TO authenticated
  USING (public.can_manage(organization_id));