CREATE TABLE public.problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state public.record_state NOT NULL DEFAULT 'new',
  impact SMALLINT NOT NULL DEFAULT 2,
  urgency SMALLINT NOT NULL DEFAULT 2,
  priority SMALLINT,
  category TEXT,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  assignee_id UUID,
  opened_by UUID,
  known_error BOOLEAN NOT NULL DEFAULT false,
  workaround TEXT,
  root_cause TEXT,
  fix_plan TEXT,
  resolution_notes TEXT,
  knowledge_article_id UUID REFERENCES public.knowledge_articles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

GRANT SELECT, INSERT, UPDATE ON public.problems TO authenticated;
GRANT ALL ON public.problems TO service_role;
ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read problems" ON public.problems
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Managers create problems" ON public.problems
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(organization_id));
CREATE POLICY "Managers update problems" ON public.problems
  FOR UPDATE TO authenticated USING (public.can_manage(organization_id));

CREATE TRIGGER set_problems_updated_at BEFORE UPDATE ON public.problems
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_problems_org_state ON public.problems(organization_id, state);
CREATE INDEX idx_problems_service ON public.problems(service_id);

CREATE TABLE public.problem_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  linked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (problem_id, incident_id)
);

GRANT SELECT, INSERT, DELETE ON public.problem_incidents TO authenticated;
GRANT ALL ON public.problem_incidents TO service_role;
ALTER TABLE public.problem_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read problem links" ON public.problem_incidents
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Managers link problems" ON public.problem_incidents
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(organization_id));
CREATE POLICY "Managers unlink problems" ON public.problem_incidents
  FOR DELETE TO authenticated USING (public.can_manage(organization_id));

CREATE INDEX idx_problem_incidents_problem ON public.problem_incidents(problem_id);
CREATE INDEX idx_problem_incidents_incident ON public.problem_incidents(incident_id);

CREATE TABLE public.major_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES public.problems(id) ON DELETE SET NULL,
  severity SMALLINT NOT NULL DEFAULT 1,
  bridge_state TEXT NOT NULL DEFAULT 'declared',
  commander_id UUID,
  comms_lead_id UUID,
  bridge_url TEXT,
  situation_summary TEXT,
  customer_impact TEXT,
  escalation_level SMALLINT NOT NULL DEFAULT 1,
  declared_by UUID,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mitigated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  next_update_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (incident_id)
);

GRANT SELECT, INSERT, UPDATE ON public.major_incidents TO authenticated;
GRANT ALL ON public.major_incidents TO service_role;
ALTER TABLE public.major_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read major incidents" ON public.major_incidents
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Managers declare major incidents" ON public.major_incidents
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(organization_id));
CREATE POLICY "Managers update major incidents" ON public.major_incidents
  FOR UPDATE TO authenticated USING (public.can_manage(organization_id));

CREATE TRIGGER set_major_incidents_updated_at BEFORE UPDATE ON public.major_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_major_incidents_org_state ON public.major_incidents(organization_id, bridge_state);

CREATE TABLE public.major_incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  major_incident_id UUID NOT NULL REFERENCES public.major_incidents(id) ON DELETE CASCADE,
  author_id UUID,
  update_type TEXT NOT NULL DEFAULT 'status',
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'internal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.major_incident_updates TO authenticated;
GRANT ALL ON public.major_incident_updates TO service_role;
ALTER TABLE public.major_incident_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read major incident updates" ON public.major_incident_updates
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Managers post major incident updates" ON public.major_incident_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage(organization_id));

CREATE INDEX idx_major_incident_updates_parent
  ON public.major_incident_updates(major_incident_id, created_at DESC);

ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS major_incident BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS problem_id UUID REFERENCES public.problems(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_problem ON public.incidents(problem_id);
