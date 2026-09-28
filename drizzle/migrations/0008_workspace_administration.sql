-- Administration is an authenticated, versioned transaction boundary. Every
-- mutation acquires the organization lock before checking administrator access.
ALTER TABLE public.memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE public.organizations ADD COLUMN admin_version integer NOT NULL DEFAULT 1 CHECK (admin_version > 0);
ALTER TABLE public.groups
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT groups_org_identity UNIQUE (organization_id, id);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_admin_name_valid
  CHECK (name=btrim(name) AND length(name) BETWEEN 2 AND 120);
ALTER TABLE public.groups ADD CONSTRAINT groups_admin_name_valid
  CHECK (name=btrim(name) AND length(name) BETWEEN 2 AND 120),
  ADD CONSTRAINT groups_admin_description_valid CHECK (description IS NULL OR length(description)<=1000);

CREATE FUNCTION public.itsm_valid_admin_roles(_roles public.app_role[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT _roles IS NOT NULL AND cardinality(_roles) BETWEEN 1 AND 8
    AND array_position(_roles,NULL) IS NULL AND 'requester'::public.app_role = ANY(_roles)
    AND cardinality(_roles) = (SELECT count(DISTINCT role) FROM unnest(_roles) role);
$$;
CREATE FUNCTION public.itsm_normalize_admin_roles(_roles public.app_role[])
RETURNS public.app_role[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF _roles IS NULL OR cardinality(_roles) NOT BETWEEN 1 AND 8 OR array_position(_roles,NULL) IS NOT NULL
    OR cardinality(_roles) <> (SELECT count(DISTINCT role) FROM unnest(_roles) role) THEN
    RAISE EXCEPTION 'Choose at least one role, without duplicates';
  END IF;
  RETURN (SELECT array_agg(role ORDER BY role) FROM (
    SELECT DISTINCT unnest(_roles || ARRAY['requester'::public.app_role]) role
  ) chosen);
END;
$$;

CREATE TABLE public.group_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id,user_id),
  FOREIGN KEY (organization_id,group_id) REFERENCES public.groups(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,user_id) REFERENCES public.memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE INDEX group_members_org_user ON public.group_members(organization_id,user_id);

CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 5 AND 254
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  roles public.app_role[] NOT NULL CHECK (public.itsm_valid_admin_roles(roles)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by uuid NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (expires_at > created_at),
  CHECK ((status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_invitations_one_pending_email
  ON public.workspace_invitations(organization_id,email) WHERE status='pending';
CREATE INDEX workspace_invitations_org_created ON public.workspace_invitations(organization_id,created_at);

GRANT ALL ON public.workspace_invitations,public.group_members TO service_role;
GRANT SELECT ON public.workspace_invitations,public.group_members TO authenticated;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitations_admin_read ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin',organization_id));
CREATE POLICY group_members_admin_read ON public.group_members FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin',organization_id));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.organizations,public.groups,public.user_roles FROM authenticated;
REVOKE UPDATE,DELETE,TRUNCATE ON public.memberships FROM authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.workspace_invitations,public.group_members FROM authenticated;
-- Preserve membership INSERT privilege with no INSERT policy, so self-enrollment
-- continues to fail at the RLS boundary. Only trusted provisioning/RPCs can insert.

CREATE FUNCTION public.itsm_lock_admin_workspace(_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=_org_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An active workspace administrator role is required';
  END IF;
  -- Also lock the caller membership. Under a stronger transaction isolation
  -- level, concurrent revocation must cause serialization failure, not a check
  -- against a stale snapshot of the caller's roles.
  PERFORM 1 FROM public.memberships WHERE organization_id=_org_id AND user_id=auth.uid() FOR SHARE;
  IF NOT public.has_role(auth.uid(),'admin',_org_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An active workspace administrator role is required';
  END IF;
END;
$$;

CREATE FUNCTION public.itsm_admin_overview(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin',_org_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An active workspace administrator role is required';
  END IF;
  SELECT jsonb_build_object(
    'organization',jsonb_build_object('id',o.id,'name',o.name,'timezone',o.timezone,'admin_version',o.admin_version),
    'members',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',m.id,'user_id',m.user_id,'email',u.email,'display_name',coalesce(p.display_name,u.email,'Workspace member'),
      'is_active',m.is_active,'version',m.version,'created_at',m.created_at,
      'roles',coalesce((SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.user_roles r
        WHERE r.organization_id=m.organization_id AND r.user_id=m.user_id),'[]'::jsonb)
      ) ORDER BY coalesce(p.display_name,u.email,'Workspace member'),m.user_id)
      FROM public.memberships m LEFT JOIN auth.users u ON u.id=m.user_id LEFT JOIN public.profiles p ON p.id=m.user_id
      WHERE m.organization_id=o.id),'[]'::jsonb),
    'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',i.id,'email',i.email,'roles',i.roles,'status',CASE WHEN i.status='pending' AND i.expires_at<=clock_timestamp() THEN 'expired' ELSE i.status END,
      'expires_at',i.expires_at,'created_at',i.created_at,'version',i.version) ORDER BY i.created_at DESC,i.id)
      FROM public.workspace_invitations i WHERE i.organization_id=o.id),'[]'::jsonb),
    'groups',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',g.id,'name',g.name,'description',g.description,'is_active',g.is_active,'version',g.version,
      'member_ids',coalesce((SELECT jsonb_agg(gm.user_id ORDER BY gm.user_id) FROM public.group_members gm
        WHERE gm.organization_id=g.organization_id AND gm.group_id=g.id),'[]'::jsonb)) ORDER BY g.name,g.id)
      FROM public.groups g WHERE g.organization_id=o.id),'[]'::jsonb)
  ) INTO result FROM public.organizations o WHERE o.id=_org_id;
  RETURN result;
END;
$$;

CREATE FUNCTION public.itsm_admin_invite(_org_id uuid,_email text,_roles public.app_role[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized_email text := lower(btrim(_email)); chosen_roles public.app_role[]; invitation_id uuid;
BEGIN
  PERFORM public.itsm_lock_admin_workspace(_org_id);
  chosen_roles := public.itsm_normalize_admin_roles(_roles);
  IF normalized_email IS NULL OR length(normalized_email) NOT BETWEEN 5 AND 254
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address with at most 254 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships m JOIN auth.users u ON u.id=m.user_id
    WHERE m.organization_id=_org_id AND lower(btrim(u.email))=normalized_email) THEN
    RAISE EXCEPTION 'This email already belongs to a workspace member; manage their existing access instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_invitations WHERE organization_id=_org_id
    AND email=normalized_email AND status='pending' AND expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'A pending invitation already exists for this email';
  END IF;
  UPDATE public.workspace_invitations SET status='revoked',version=version+1,updated_at=clock_timestamp()
    WHERE organization_id=_org_id AND email=normalized_email AND status='pending' AND expires_at<=clock_timestamp();
  INSERT INTO public.workspace_invitations(organization_id,email,roles,invited_by)
    VALUES(_org_id,normalized_email,chosen_roles,auth.uid()) RETURNING id INTO invitation_id;
  RETURN jsonb_build_object('id',invitation_id);
END;
$$;

CREATE FUNCTION public.itsm_admin_revoke_invitation(_org_id uuid,_invitation_id uuid,_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invitation public.workspace_invitations;
BEGIN
  PERFORM public.itsm_lock_admin_workspace(_org_id);
  SELECT * INTO invitation FROM public.workspace_invitations WHERE id=_invitation_id AND organization_id=_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found in this workspace'; END IF;
  IF invitation.version IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'This invitation changed. Refresh and try again'; END IF;
  IF invitation.status <> 'pending' THEN RAISE EXCEPTION 'Only pending invitations can be revoked'; END IF;
  UPDATE public.workspace_invitations SET status='revoked',version=version+1,updated_at=clock_timestamp() WHERE id=invitation.id;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE FUNCTION public.itsm_admin_update_member(_org_id uuid,_user_id uuid,_roles public.app_role[],_is_active boolean,_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member public.memberships; chosen_roles public.app_role[];
BEGIN
  PERFORM public.itsm_lock_admin_workspace(_org_id);
  chosen_roles := public.itsm_normalize_admin_roles(_roles);
  IF _is_active IS NULL THEN RAISE EXCEPTION 'Choose an active or disabled membership state'; END IF;
  SELECT * INTO member FROM public.memberships WHERE organization_id=_org_id AND user_id=_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in this workspace'; END IF;
  IF member.version IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'This member changed. Refresh and try again'; END IF;
  PERFORM m.id FROM public.memberships m JOIN public.user_roles r
    ON r.organization_id=m.organization_id AND r.user_id=m.user_id AND r.role='admin'
    WHERE m.organization_id=_org_id AND m.is_active FOR SHARE OF m;
  IF member.is_active AND public.has_role(_user_id,'admin',_org_id)
    AND (NOT _is_active OR NOT ('admin'::public.app_role=ANY(chosen_roles)))
    AND NOT EXISTS (SELECT 1 FROM public.memberships m JOIN public.user_roles r
      ON r.organization_id=m.organization_id AND r.user_id=m.user_id AND r.role='admin'
      WHERE m.organization_id=_org_id AND m.is_active AND m.user_id<>_user_id) THEN
    RAISE EXCEPTION 'Keep at least one active workspace administrator';
  END IF;
  UPDATE public.memberships SET is_active=_is_active,version=version+1 WHERE id=member.id;
  DELETE FROM public.user_roles WHERE organization_id=_org_id AND user_id=_user_id AND NOT(role=ANY(chosen_roles));
  INSERT INTO public.user_roles(organization_id,user_id,role)
    SELECT _org_id,_user_id,role FROM unnest(chosen_roles) role ON CONFLICT (organization_id,user_id,role) DO NOTHING;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE FUNCTION public.itsm_admin_save_group(_org_id uuid,_group_id uuid,_name text,_description text,
  _is_active boolean,_member_ids uuid[],_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected_group public.groups; group_identity uuid;
BEGIN
  PERFORM public.itsm_lock_admin_workspace(_org_id);
  IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 2 AND 120 OR length(coalesce(_description,''))>1000 THEN
    RAISE EXCEPTION 'Group name must be 2-120 characters and description at most 1000 characters';
  END IF;
  IF _is_active IS NULL OR _member_ids IS NULL OR cardinality(_member_ids)>500 OR array_position(_member_ids,NULL) IS NOT NULL
    OR cardinality(_member_ids)<>(SELECT count(DISTINCT id) FROM unnest(_member_ids) id) THEN
    RAISE EXCEPTION 'Choose a valid group state and up to 500 unique members';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(_member_ids) member_id WHERE NOT public.is_org_member(_org_id,member_id)) THEN
    RAISE EXCEPTION 'Every group member must have active access to this workspace';
  END IF;
  IF (_group_id IS NULL) IS DISTINCT FROM (_expected_version IS NULL) THEN RAISE EXCEPTION 'Refresh the group before saving'; END IF;
  IF _group_id IS NULL THEN
    INSERT INTO public.groups(organization_id,name,description,is_active)
      VALUES(_org_id,btrim(_name),nullif(btrim(_description),''),_is_active) RETURNING id INTO group_identity;
  ELSE
    SELECT * INTO selected_group FROM public.groups WHERE id=_group_id AND organization_id=_org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found in this workspace'; END IF;
    IF selected_group.version IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'This group changed. Refresh and try again'; END IF;
    UPDATE public.groups SET name=btrim(_name),description=nullif(btrim(_description),''),is_active=_is_active,version=version+1
      WHERE id=selected_group.id RETURNING id INTO group_identity;
  END IF;
  DELETE FROM public.group_members WHERE organization_id=_org_id AND group_id=group_identity AND NOT(user_id=ANY(_member_ids));
  INSERT INTO public.group_members(organization_id,group_id,user_id)
    SELECT _org_id,group_identity,member_id FROM unnest(_member_ids) member_id ON CONFLICT(group_id,user_id) DO NOTHING;
  RETURN jsonb_build_object('id',group_identity);
END;
$$;

CREATE FUNCTION public.itsm_admin_update_workspace(_org_id uuid,_name text,_timezone text,_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.itsm_lock_admin_workspace(_org_id);
  IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Workspace name must be 2-120 characters'; END IF;
  IF _timezone IS NULL OR length(_timezone)>100 OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=_timezone) THEN
    RAISE EXCEPTION 'Choose a recognized IANA timezone';
  END IF;
  IF (SELECT admin_version FROM public.organizations WHERE id=_org_id) IS DISTINCT FROM _expected_version THEN
    RAISE EXCEPTION 'This workspace changed. Refresh and try again';
  END IF;
  UPDATE public.organizations SET name=btrim(_name),timezone=_timezone,admin_version=admin_version+1 WHERE id=_org_id;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE FUNCTION public.itsm_get_invitation(_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invitation public.workspace_invitations; verified_email text;
BEGIN
  SELECT lower(btrim(email)) INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  SELECT * INTO invitation FROM public.workspace_invitations WHERE id=_invitation_id;
  IF NOT FOUND OR verified_email IS NULL OR invitation.email IS DISTINCT FROM verified_email THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sign in with the verified email address that received this invitation';
  END IF;
  RETURN jsonb_build_object('id',invitation.id,'organization_id',invitation.organization_id,
    'organization_name',(SELECT name FROM public.organizations WHERE id=invitation.organization_id),
    'email',invitation.email,'roles',invitation.roles,
    'status',CASE WHEN invitation.status='pending' AND invitation.expires_at<=clock_timestamp() THEN 'expired' ELSE invitation.status END,
    'expires_at',invitation.expires_at);
END;
$$;

CREATE FUNCTION public.itsm_accept_invitation(_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_org uuid; invitation public.workspace_invitations; verified_email text; existing_member public.memberships;
BEGIN
  SELECT organization_id INTO target_org FROM public.workspace_invitations WHERE id=_invitation_id;
  PERFORM 1 FROM public.organizations WHERE id=target_org FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is not available'; END IF;
  SELECT * INTO invitation FROM public.workspace_invitations WHERE id=_invitation_id AND organization_id=target_org FOR UPDATE;
  SELECT lower(btrim(email)) INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  IF verified_email IS NULL OR invitation.email IS DISTINCT FROM verified_email THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sign in with the verified email address that received this invitation';
  END IF;
  IF invitation.status <> 'pending' THEN RAISE EXCEPTION 'This invitation has already been accepted or revoked'; END IF;
  IF invitation.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'This invitation has expired. Ask an administrator for a new invitation'; END IF;
  SELECT * INTO existing_member FROM public.memberships WHERE organization_id=target_org AND user_id=auth.uid() FOR UPDATE;
  IF FOUND THEN
    IF NOT existing_member.is_active THEN RAISE EXCEPTION 'Your membership is disabled. Ask an administrator to restore your access'; END IF;
    RAISE EXCEPTION 'You are already a member of this workspace';
  END IF;
  -- Legacy provisioning can leave role rows without a membership. Accepting a
  -- requester invitation must never activate such orphaned elevated privileges.
  DELETE FROM public.user_roles WHERE organization_id=target_org AND user_id=auth.uid();
  INSERT INTO public.memberships(organization_id,user_id) VALUES(target_org,auth.uid());
  INSERT INTO public.user_roles(organization_id,user_id,role)
    SELECT target_org,auth.uid(),role FROM unnest(invitation.roles) role ON CONFLICT (organization_id,user_id,role) DO NOTHING;
  UPDATE public.workspace_invitations SET status='accepted',accepted_by=auth.uid(),accepted_at=clock_timestamp(),
    updated_at=clock_timestamp(),version=version+1 WHERE id=invitation.id;
  RETURN jsonb_build_object('organization_id',target_org);
END;
$$;

REVOKE ALL ON FUNCTION public.itsm_valid_admin_roles(public.app_role[]),public.itsm_normalize_admin_roles(public.app_role[]),
  public.itsm_lock_admin_workspace(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.itsm_admin_overview(uuid),public.itsm_admin_invite(uuid,text,public.app_role[]),
  public.itsm_admin_revoke_invitation(uuid,uuid,integer),public.itsm_admin_update_member(uuid,uuid,public.app_role[],boolean,integer),
  public.itsm_admin_save_group(uuid,uuid,text,text,boolean,uuid[],integer),public.itsm_admin_update_workspace(uuid,text,text,integer),
  public.itsm_get_invitation(uuid),public.itsm_accept_invitation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.itsm_admin_overview(uuid),public.itsm_admin_invite(uuid,text,public.app_role[]),
  public.itsm_admin_revoke_invitation(uuid,uuid,integer),public.itsm_admin_update_member(uuid,uuid,public.app_role[],boolean,integer),
  public.itsm_admin_save_group(uuid,uuid,text,text,boolean,uuid[],integer),public.itsm_admin_update_workspace(uuid,text,text,integer),
  public.itsm_get_invitation(uuid),public.itsm_accept_invitation(uuid) TO authenticated,service_role;

-- Archival preserves historical ownership but blocks every new group assignment.
CREATE FUNCTION public.itsm_guard_active_assignment_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.group_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.group_id IS DISTINCT FROM OLD.group_id) THEN
    -- Serialize a new assignment against archival, while existing assignments
    -- remain valid. Organization locks use NO KEY UPDATE so FK key-share locks
    -- in ticket/bootstrap transactions cannot create a reverse lock dependency.
    PERFORM 1 FROM public.groups WHERE id=NEW.group_id AND organization_id=NEW.organization_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active assignment group in this workspace'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.itsm_guard_active_assignment_group() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER workspace_active_assignment_group BEFORE INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.itsm_guard_active_assignment_group();
CREATE TRIGGER workspace_active_assignment_group BEFORE INSERT OR UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.itsm_guard_active_assignment_group();

-- Reserved administration evidence is produced only by row triggers. Values
-- exclude group free text and authentication secrets. Every event is part of
-- the same transaction as the mutation, including invitation acceptance.
CREATE FUNCTION public.administration_audit_snapshot(_table text,_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE fields text[];
BEGIN
  IF _row IS NULL THEN RETURN NULL; END IF;
  fields := CASE _table
    WHEN 'organizations' THEN ARRAY['id','name','timezone','admin_version']
    WHEN 'memberships' THEN ARRAY['id','organization_id','user_id','is_active','version']
    WHEN 'user_roles' THEN ARRAY['id','organization_id','user_id','role']
    WHEN 'groups' THEN ARRAY['id','organization_id','name','is_active','version']
    WHEN 'group_members' THEN ARRAY['organization_id','group_id','user_id']
    WHEN 'workspace_invitations' THEN ARRAY['id','organization_id','email','roles','status','invited_by','accepted_by','accepted_at','expires_at','version']
    ELSE NULL END;
  IF fields IS NULL THEN RAISE EXCEPTION 'Unsupported administration audit table'; END IF;
  RETURN (SELECT jsonb_object_agg(key,value) FROM jsonb_each(_row) WHERE key=ANY(fields));
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_audit_event()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE database_event boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Audit events are immutable'; END IF;
  database_event := pg_trigger_depth()>1 AND NEW.source='database' AND current_user NOT IN ('anon','authenticated','service_role');
  IF NOT database_event THEN
    IF NEW.record_type IN ('workspace','membership','role_assignment','group','group_membership','workspace_invitation') THEN
      RAISE EXCEPTION 'Administration audit events are written only by database triggers';
    END IF;
    IF NEW.action LIKE 'approval\_%' ESCAPE '\' OR
      (NEW.record_type IN ('incident','request','change','approval') AND NEW.action NOT IN ('comment_added','attachment_added')) THEN
      RAISE EXCEPTION 'Core record audit events are written only by database triggers';
    END IF;
    NEW.source:='application';
    IF NEW.record_type IN ('incident','request','change','approval') THEN NEW.before_values:=NULL; NEW.after_values:=NULL; END IF;
  END IF;
  NEW.id:=gen_random_uuid(); NEW.actor_id:=auth.uid(); NEW.created_at:=clock_timestamp(); NEW.correlation_id:=gen_random_uuid();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.append_administration_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous_row jsonb; current_row jsonb; identity_row jsonb; kind text; org_id uuid; record_id uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN previous_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN current_row:=to_jsonb(NEW); END IF;
  identity_row:=coalesce(current_row,previous_row);
  kind:=CASE TG_TABLE_NAME WHEN 'organizations' THEN 'workspace' WHEN 'memberships' THEN 'membership'
    WHEN 'user_roles' THEN 'role_assignment' WHEN 'groups' THEN 'group' WHEN 'group_members' THEN 'group_membership'
    WHEN 'workspace_invitations' THEN 'workspace_invitation' ELSE NULL END;
  IF kind IS NULL THEN RAISE EXCEPTION 'Unsupported administration audit table'; END IF;
  org_id:=CASE WHEN TG_TABLE_NAME='organizations' THEN (identity_row->>'id')::uuid ELSE (identity_row->>'organization_id')::uuid END;
  record_id:=CASE WHEN TG_TABLE_NAME='group_members' THEN (identity_row->>'group_id')::uuid ELSE (identity_row->>'id')::uuid END;
  INSERT INTO public.audit_events(organization_id,record_type,record_id,actor_id,action,source,before_values,after_values)
    VALUES(org_id,kind,record_id,auth.uid(),CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
      'database',public.administration_audit_snapshot(TG_TABLE_NAME,previous_row),public.administration_audit_snapshot(TG_TABLE_NAME,current_row));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.administration_audit_snapshot(text,jsonb),public.append_administration_audit_event()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_workspace_administration AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
CREATE TRIGGER audit_membership_administration AFTER INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
CREATE TRIGGER audit_role_administration AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
CREATE TRIGGER audit_group_administration AFTER INSERT OR UPDATE OR DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
CREATE TRIGGER audit_group_members_administration AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
CREATE TRIGGER audit_invitation_administration AFTER INSERT OR UPDATE OR DELETE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.append_administration_audit_event();
REVOKE TRUNCATE ON public.organizations,public.memberships,public.user_roles,public.groups,public.group_members,public.workspace_invitations
  FROM authenticated,service_role;
DROP POLICY audit_read ON public.audit_events;
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING (
  CASE WHEN record_type IN ('workspace','membership','role_assignment','group','group_membership','workspace_invitation')
    THEN public.has_role(auth.uid(),'admin',organization_id) ELSE public.can_manage(organization_id) END
);
DROP POLICY audit_create ON public.audit_events;
CREATE POLICY audit_create ON public.audit_events FOR INSERT TO authenticated WITH CHECK (
  public.is_org_member(organization_id) AND actor_id=auth.uid() AND source='application'
  AND record_type NOT IN ('workspace','membership','role_assignment','group','group_membership','workspace_invitation')
  AND ((record_type IN ('incident','request','change') AND action IN ('comment_added','attachment_added')
    AND public.can_access_record(organization_id,record_type,record_id)) OR record_type NOT IN ('incident','request','change','approval'))
);
