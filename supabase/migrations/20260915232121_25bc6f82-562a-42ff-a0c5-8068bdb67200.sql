CREATE TYPE public.app_role AS ENUM ('requester','service_desk','fulfiller','change_manager','cab_member','cmdb_manager','manager','admin');
CREATE TYPE public.record_state AS ENUM ('new','open','in_progress','pending','resolved','closed','cancelled');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  avatar_url text,
  phone text,
  job_title text,
  department text,
  locale text NOT NULL DEFAULT 'en-IN',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid, _user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.memberships WHERE organization_id=_org_id AND user_id=_user_id AND is_active) $$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role, _org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE organization_id=_org_id AND user_id=_user_id AND role=_role) $$;
CREATE OR REPLACE FUNCTION public.can_manage(_org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE organization_id=_org_id AND user_id=auth.uid() AND role IN ('service_desk','fulfiller','change_manager','cab_member','cmdb_manager','manager','admin')) $$;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid,uuid), public.has_role(uuid,public.app_role,uuid), public.can_manage(uuid) TO authenticated;

CREATE POLICY organizations_member_read ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(id));
CREATE POLICY organizations_create ON public.organizations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY organizations_admin_update ON public.organizations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin',id));
CREATE POLICY memberships_org_read ON public.memberships FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY memberships_self_join ON public.memberships FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
CREATE POLICY memberships_admin_manage ON public.memberships FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin',organization_id));
CREATE POLICY user_roles_org_read ON public.user_roles FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY profiles_org_read ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid() OR EXISTS (SELECT 1 FROM public.memberships me JOIN public.memberships them ON them.organization_id=me.organization_id WHERE me.user_id=auth.uid() AND them.user_id=profiles.id));

CREATE TABLE public.groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated; GRANT ALL ON public.groups TO service_role; ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_read ON public.groups FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY groups_manage ON public.groups FOR ALL TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TABLE public.services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, name text NOT NULL, code text NOT NULL, description text, owner_name text, status text NOT NULL DEFAULT 'operational', criticality text NOT NULL DEFAULT 'medium', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated; GRANT ALL ON public.services TO service_role; ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY services_read ON public.services FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY services_manage ON public.services FOR ALL TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TABLE public.incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, number text NOT NULL UNIQUE, title text NOT NULL, description text NOT NULL DEFAULT '', state public.record_state NOT NULL DEFAULT 'new', impact smallint NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 3), urgency smallint NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 3), priority smallint GENERATED ALWAYS AS (LEAST(5, GREATEST(1, impact + urgency - 1))) STORED, requester_id uuid, assignee_id uuid, group_id uuid REFERENCES public.groups(id), service_id uuid REFERENCES public.services(id), sla_due_at timestamptz, resolved_at timestamptz, resolution_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated; GRANT ALL ON public.incidents TO service_role; ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY incidents_read ON public.incidents FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY incidents_create ON public.incidents FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND requester_id=auth.uid()); CREATE POLICY incidents_update ON public.incidents FOR UPDATE TO authenticated USING (requester_id=auth.uid() OR public.can_manage(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.catalog_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, name text NOT NULL, category text NOT NULL, description text, delivery_days integer NOT NULL DEFAULT 3, approval_required boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_items TO authenticated; GRANT ALL ON public.catalog_items TO service_role; ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_read ON public.catalog_items FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY catalog_manage ON public.catalog_items FOR ALL TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TABLE public.service_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, number text NOT NULL UNIQUE, catalog_item_id uuid REFERENCES public.catalog_items(id), title text NOT NULL, description text NOT NULL DEFAULT '', state public.record_state NOT NULL DEFAULT 'new', requester_id uuid NOT NULL, assignee_id uuid, group_id uuid REFERENCES public.groups(id), requested_for_id uuid, due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_requests TO authenticated; GRANT ALL ON public.service_requests TO service_role; ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY requests_read ON public.service_requests FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY requests_create ON public.service_requests FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND requester_id=auth.uid()); CREATE POLICY requests_update ON public.service_requests FOR UPDATE TO authenticated USING (requester_id=auth.uid() OR public.can_manage(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.request_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE, title text NOT NULL, state public.record_state NOT NULL DEFAULT 'new', assignee_id uuid, due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_tasks TO authenticated; GRANT ALL ON public.request_tasks TO service_role; ALTER TABLE public.request_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_tasks_read ON public.request_tasks FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY request_tasks_manage ON public.request_tasks FOR ALL TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TABLE public.changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, number text NOT NULL UNIQUE, title text NOT NULL, description text NOT NULL DEFAULT '', change_type text NOT NULL CHECK(change_type IN ('standard','normal','emergency')), state public.record_state NOT NULL DEFAULT 'new', risk text NOT NULL DEFAULT 'medium' CHECK(risk IN ('low','medium','high','critical')), requester_id uuid NOT NULL, owner_id uuid, service_id uuid REFERENCES public.services(id), implementation_plan text, test_plan text, rollback_plan text, start_at timestamptz, end_at timestamptz, pir_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.changes TO authenticated; GRANT ALL ON public.changes TO service_role; ALTER TABLE public.changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY changes_read ON public.changes FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY changes_create ON public.changes FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND requester_id=auth.uid()); CREATE POLICY changes_update ON public.changes FOR UPDATE TO authenticated USING (requester_id=auth.uid() OR public.has_role(auth.uid(),'change_manager',organization_id) OR public.has_role(auth.uid(),'admin',organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, record_type text NOT NULL CHECK(record_type IN ('request','change','knowledge')), record_id uuid NOT NULL, approver_id uuid NOT NULL, status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','cancelled')), decision_notes text, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated; GRANT ALL ON public.approvals TO service_role; ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY approvals_read ON public.approvals FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY approvals_manage ON public.approvals FOR ALL TO authenticated USING (approver_id=auth.uid() OR public.can_manage(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.knowledge_articles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, number text NOT NULL UNIQUE, title text NOT NULL, summary text, content text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'General', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','published','retired')), version integer NOT NULL DEFAULT 1, author_id uuid, reviewer_id uuid, published_at timestamptz, expires_at timestamptz, helpful_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_articles TO authenticated; GRANT ALL ON public.knowledge_articles TO service_role; ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_read ON public.knowledge_articles FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY knowledge_manage ON public.knowledge_articles FOR ALL TO authenticated USING (author_id=auth.uid() OR public.can_manage(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.configuration_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, name text NOT NULL, ci_class text NOT NULL, asset_tag text, environment text, status text NOT NULL DEFAULT 'operational', criticality text NOT NULL DEFAULT 'medium', owner_id uuid, service_id uuid REFERENCES public.services(id), location text, ip_address inet, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, last_discovered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuration_items TO authenticated; GRANT ALL ON public.configuration_items TO service_role; ALTER TABLE public.configuration_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_read ON public.configuration_items FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY ci_manage ON public.configuration_items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'cmdb_manager',organization_id) OR public.has_role(auth.uid(),'admin',organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.ci_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, parent_id uuid NOT NULL REFERENCES public.configuration_items(id) ON DELETE CASCADE, child_id uuid NOT NULL REFERENCES public.configuration_items(id) ON DELETE CASCADE, relationship_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(parent_id,child_id,relationship_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ci_relationships TO authenticated; GRANT ALL ON public.ci_relationships TO service_role; ALTER TABLE public.ci_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_rel_read ON public.ci_relationships FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY ci_rel_manage ON public.ci_relationships FOR ALL TO authenticated USING (public.has_role(auth.uid(),'cmdb_manager',organization_id) OR public.has_role(auth.uid(),'admin',organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE TABLE public.record_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, record_type text NOT NULL, record_id uuid NOT NULL, author_id uuid NOT NULL, body text NOT NULL, internal boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.record_comments TO authenticated; GRANT ALL ON public.record_comments TO service_role; ALTER TABLE public.record_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY comments_read ON public.record_comments FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY comments_create ON public.record_comments FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND author_id=auth.uid());

CREATE TABLE public.attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, record_type text NOT NULL, record_id uuid NOT NULL, uploader_id uuid NOT NULL, storage_path text NOT NULL, file_name text NOT NULL, mime_type text, size_bytes bigint, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attachments TO authenticated; GRANT ALL ON public.attachments TO service_role; ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_read ON public.attachments FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY attachments_create ON public.attachments FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND uploader_id=auth.uid());

CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL, title text NOT NULL, body text, record_type text, record_id uuid, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated; GRANT ALL ON public.notifications TO service_role; ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON public.notifications FOR SELECT TO authenticated USING (user_id=auth.uid()); CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());

CREATE TABLE public.sla_instances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, record_type text NOT NULL, record_id uuid NOT NULL, target_type text NOT NULL CHECK(target_type IN ('response','resolution','fulfillment')), started_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL, completed_at timestamptz, paused_at timestamptz, status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','met','breached','cancelled')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_instances TO authenticated; GRANT ALL ON public.sla_instances TO service_role; ALTER TABLE public.sla_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_read ON public.sla_instances FOR SELECT TO authenticated USING (public.is_org_member(organization_id)); CREATE POLICY sla_manage ON public.sla_instances FOR ALL TO authenticated USING (public.can_manage(organization_id)) WITH CHECK (public.can_manage(organization_id));

CREATE TABLE public.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, record_type text NOT NULL, record_id uuid, actor_id uuid, action text NOT NULL, source text NOT NULL DEFAULT 'user', before_values jsonb, after_values jsonb, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_events TO authenticated; GRANT ALL ON public.audit_events TO service_role; ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING (public.is_org_member(organization_id) AND (public.has_role(auth.uid(),'manager',organization_id) OR public.has_role(auth.uid(),'admin',organization_id) OR actor_id=auth.uid())); CREATE POLICY audit_create ON public.audit_events FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND actor_id=auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['organizations','profiles','groups','services','incidents','catalog_items','service_requests','request_tasks','changes','approvals','knowledge_articles','configuration_items','sla_instances'] LOOP EXECUTE format('CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',t,t); END LOOP; END $$;

CREATE INDEX incidents_org_state_idx ON public.incidents(organization_id,state,priority); CREATE INDEX incidents_assignee_idx ON public.incidents(assignee_id); CREATE INDEX requests_org_state_idx ON public.service_requests(organization_id,state); CREATE INDEX changes_org_state_idx ON public.changes(organization_id,state); CREATE INDEX approvals_approver_idx ON public.approvals(approver_id,status); CREATE INDEX ci_org_class_idx ON public.configuration_items(organization_id,ci_class); CREATE INDEX audit_record_idx ON public.audit_events(record_type,record_id,created_at DESC);

CREATE POLICY evidence_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='itsm-evidence' AND public.is_org_member(((storage.foldername(name))[1])::uuid));
CREATE POLICY evidence_create ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='itsm-evidence' AND public.is_org_member(((storage.foldername(name))[1])::uuid));
CREATE POLICY avatar_own_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY avatar_own_create ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY avatar_own_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

INSERT INTO public.organizations(id,name,slug) VALUES ('10000000-0000-0000-0000-000000000001','WeCrew Technologies','wecrew-technologies');
INSERT INTO public.groups(id,organization_id,name,description) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Service Desk','L1 intake and triage'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Platform Operations','L2/L3 application and infrastructure support');
INSERT INTO public.services(id,organization_id,name,code,description,owner_name,status,criticality) VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Employee Digital Workplace','EDW','Identity, endpoint, collaboration, and productivity services','Ananya Rao','operational','high'),('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Order Management Platform','OMP','Customer order processing and fulfillment','Vikram Shah','degraded','critical'),('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Cloud Platform','CLD','Shared Kubernetes and cloud runtime','Meera Nair','operational','critical');
INSERT INTO public.catalog_items(id,organization_id,name,category,description,delivery_days,approval_required) VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','New laptop','Hardware','Provision a standard managed laptop',5,true),('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Application access','Access','Request access to an approved business application',2,true),('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Software installation','Software','Install approved software on a managed endpoint',2,false);
INSERT INTO public.incidents(id,organization_id,number,title,description,state,impact,urgency,group_id,service_id,sla_due_at) VALUES ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','INC0012847','Checkout latency above threshold','Customers are reporting delayed order confirmation.','in_progress',1,1,'20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',now()+interval '42 minutes'),('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','INC0012845','VPN access intermittent','Remote users see repeated reconnects.','open',2,2,'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now()+interval '3 hours'),('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','INC0012839','Certificate expiry warning','Monitoring detected an expiring ingress certificate.','pending',2,1,'20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003',now()-interval '18 minutes');
INSERT INTO public.changes(id,organization_id,number,title,description,change_type,state,risk,requester_id,service_id,implementation_plan,test_plan,rollback_plan,start_at,end_at) VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','CHG0004182','Upgrade production ingress controllers','Rolling upgrade across production clusters.','normal','pending','high','00000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000003','Upgrade one cluster at a time','Run health and synthetic checks','Restore previous controller image',now()+interval '2 days',now()+interval '2 days 2 hours'),('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','CHG0004179','Rotate SSO signing certificate','Scheduled certificate rotation.','standard','open','low','00000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000001','Install and activate new certificate','Validate SSO for test accounts','Reactivate previous certificate',now()+interval '5 days',now()+interval '5 days 1 hour');
INSERT INTO public.knowledge_articles(id,organization_id,number,title,summary,content,category,status,published_at,helpful_count) VALUES ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','KB001093','Restore VPN connectivity','Validated steps for common remote access failures.','Confirm network connectivity, refresh the device certificate, then reconnect using the managed VPN profile.','Network','published',now()-interval '20 days',48),('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','KB001087','Request application access','How managers and employees request access.','Open the service catalog, choose Application access, select the system and business justification, then submit for approval.','Access','published',now()-interval '35 days',31);
INSERT INTO public.configuration_items(id,organization_id,name,ci_class,asset_tag,environment,status,criticality,service_id,location,last_discovered_at) VALUES ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','prod-k8s-ap-south-1','Kubernetes cluster','CI-CLD-0041','production','operational','critical','30000000-0000-0000-0000-000000000003','Mumbai Region',now()-interval '8 minutes'),('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','orders-api-prod','Application service','CI-APP-0188','production','degraded','critical','30000000-0000-0000-0000-000000000002','Mumbai Region',now()-interval '5 minutes'),('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','vpn-gateway-01','Network device','CI-NET-0024','production','operational','high','30000000-0000-0000-0000-000000000001','Bengaluru DC',now()-interval '12 minutes');
INSERT INTO public.ci_relationships(organization_id,parent_id,child_id,relationship_type) VALUES ('10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002','hosts');