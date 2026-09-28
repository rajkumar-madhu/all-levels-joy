\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_admin(actual boolean,description text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'Administration assertion failed: %',description; END IF; END; $$;
CREATE FUNCTION pg_temp.expect_admin_failure(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM)=0 THEN RAISE EXCEPTION 'Unexpected error: %; wanted %',SQLERRM,expected; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %',statement;
END; $$;
CREATE TEMP TABLE administration_refs(label text PRIMARY KEY,id uuid);
GRANT ALL ON administration_refs TO authenticated;

INSERT INTO public.organizations(id,name,slug) VALUES('1b000000-0000-0000-0000-000000000002','Foreign administration test','admin-test-foreign');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('9b000000-0000-0000-0000-000000000001','admin-one@example.test',now()),
 ('9b000000-0000-0000-0000-000000000002','admin-two@example.test',now()),
 ('9b000000-0000-0000-0000-000000000003','disabled@example.test',now()),
 ('9b000000-0000-0000-0000-000000000004','operator@example.test',now()),
 ('9b000000-0000-0000-0000-000000000005','requester@example.test',now()),
 ('9b000000-0000-0000-0000-000000000006','foreign@example.test',now()),
 ('9b000000-0000-0000-0000-000000000007','wrong@example.test',now()),
 ('9b000000-0000-0000-0000-000000000008','invited@example.test',now()),
 ('9b000000-0000-0000-0000-000000000009','rollback@example.test',now()),
 ('9b000000-0000-0000-0000-000000000010','unverified@example.test',NULL),
 ('9b000000-0000-0000-0000-000000000011','expired@example.test',now()),
 ('9b000000-0000-0000-0000-000000000012','revoked@example.test',now());
INSERT INTO public.memberships(organization_id,user_id,is_active)
SELECT '10000000-0000-0000-0000-000000000001',id,id<>'9b000000-0000-0000-0000-000000000003'
FROM auth.users WHERE id BETWEEN '9b000000-0000-0000-0000-000000000001' AND '9b000000-0000-0000-0000-000000000005';
INSERT INTO public.memberships(organization_id,user_id) VALUES('1b000000-0000-0000-0000-000000000002','9b000000-0000-0000-0000-000000000006');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001','admin'),
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000002','admin'),
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000003','admin'),
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000004','service_desk'),
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005','requester'),
 ('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000008','admin'),
 ('1b000000-0000-0000-0000-000000000002','9b000000-0000-0000-0000-000000000006','admin');

SET LOCAL ROLE authenticated;
-- Operator, requester, disabled administrator, foreign administrator, outsider.
DO $$ DECLARE identity uuid; BEGIN
  FOREACH identity IN ARRAY ARRAY[
    '9b000000-0000-0000-0000-000000000003'::uuid,'9b000000-0000-0000-0000-000000000004',
    '9b000000-0000-0000-0000-000000000005','9b000000-0000-0000-0000-000000000006','9b000000-0000-0000-0000-000000000007'
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',identity::text,true);
    PERFORM pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_overview('10000000-0000-0000-0000-000000000001')$q$,'active workspace administrator');
    PERFORM pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','forbidden@example.test',ARRAY['admin']::public.app_role[])$q$,'active workspace administrator');
    PERFORM pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['admin']::public.app_role[],true,1)$q$,'active workspace administrator');
    PERFORM pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,'Forbidden group','',true,'{}',NULL)$q$,'active workspace administrator');
    PERFORM pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_workspace('10000000-0000-0000-0000-000000000001','Forbidden name','UTC',1)$q$,'active workspace administrator');
  END LOOP;
END; $$;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_admin((public.itsm_admin_overview('10000000-0000-0000-0000-000000000001')->'organization'->>'admin_version')::integer=1,'workspace has initial version');
SELECT pg_temp.assert_admin(jsonb_array_length(public.itsm_admin_overview('10000000-0000-0000-0000-000000000001')->'members')>=5,'overview contains organization members');
SELECT pg_temp.assert_admin(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.itsm_admin_overview('10000000-0000-0000-0000-000000000001')->'members') m
  WHERE m->>'user_id'='9b000000-0000-0000-0000-000000000006'),'overview excludes foreign members');

-- Even an administrator must use the versioned RPCs, not direct REST writes.
SELECT pg_temp.expect_admin_failure($q$UPDATE public.organizations SET name='Bypass' WHERE id='10000000-0000-0000-0000-000000000001'$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$UPDATE public.memberships SET is_active=false WHERE user_id=auth.uid()$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$INSERT INTO public.user_roles(organization_id,user_id,role) VALUES('10000000-0000-0000-0000-000000000001',auth.uid(),'manager')$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$INSERT INTO public.groups(organization_id,name) VALUES('10000000-0000-0000-0000-000000000001','Bypass group')$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$DELETE FROM public.workspace_invitations$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$DELETE FROM public.group_members$q$,'permission denied');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_lock_admin_workspace('10000000-0000-0000-0000-000000000001')$q$,'permission denied');

-- Membership updates, role baseline and version conflicts.
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['fulfiller']::public.app_role[],true,1);
SELECT pg_temp.assert_admin(public.has_role('9b000000-0000-0000-0000-000000000005','requester','10000000-0000-0000-0000-000000000001')
  AND public.has_role('9b000000-0000-0000-0000-000000000005','fulfiller','10000000-0000-0000-0000-000000000001'),'member retains requester baseline');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['admin']::public.app_role[],true,1)$q$,'member changed');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000006',ARRAY['admin']::public.app_role[],true,1)$q$,'Member not found');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['requester','requester']::public.app_role[],true,2)$q$,'without duplicates');
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['fulfiller']::public.app_role[],false,2);
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_admin(NOT public.can_manage('10000000-0000-0000-0000-000000000001'),'deactivation immediately revokes operational access');
SELECT pg_temp.expect_admin_failure($q$SELECT public.bootstrap_workspace('Do not reactivate')$q$,'does not have active access');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000001',true);
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005',ARRAY['requester']::public.app_role[],true,3);
SELECT pg_temp.assert_admin(public.is_org_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000005')
  AND NOT public.has_role('9b000000-0000-0000-0000-000000000005','fulfiller','10000000-0000-0000-0000-000000000001'),'administrator explicitly restores only selected roles');
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000002',ARRAY['requester']::public.app_role[],true,1);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',ARRAY['requester']::public.app_role[],true,1)$q$,'at least one active');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001',ARRAY['admin']::public.app_role[],false,1)$q$,'at least one active');
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000002',ARRAY['admin']::public.app_role[],true,2);

SELECT public.itsm_admin_update_workspace('10000000-0000-0000-0000-000000000001',' Administration workspace ','Asia/Kolkata',1);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_workspace('10000000-0000-0000-0000-000000000001','Stale overwrite','UTC',1)$q$,'workspace changed');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_update_workspace('10000000-0000-0000-0000-000000000001','Invalid timezone','Invented/Zone',2)$q$,'recognized IANA timezone');

INSERT INTO administration_refs VALUES('group',(public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,' Access team ','  Team purpose  ',true,
  ARRAY['9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000004']::uuid[],NULL)->>'id')::uuid);
SELECT pg_temp.assert_admin((SELECT name='Access team' AND description='Team purpose' FROM public.groups WHERE id=(SELECT id FROM administration_refs WHERE label='group')),'group strings normalized');
SELECT pg_temp.assert_admin((SELECT count(*)=2 FROM public.group_members WHERE group_id=(SELECT id FROM administration_refs WHERE label='group')),'group membership saved atomically');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,'Foreign group','',true,ARRAY['9b000000-0000-0000-0000-000000000006']::uuid[],NULL)$q$,'active access');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,'Inactive group','',true,ARRAY['9b000000-0000-0000-0000-000000000003']::uuid[],NULL)$q$,'active access');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,'Duplicate members','',true,ARRAY['9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001']::uuid[],NULL)$q$,'unique members');
INSERT INTO public.incidents(organization_id,number,title,requester_id,group_id)
VALUES('10000000-0000-0000-0000-000000000001','ADMIN-ASSIGNMENT','Preserve assignment',auth.uid(),(SELECT id FROM administration_refs WHERE label='group'));
INSERT INTO administration_refs VALUES('assigned_request',(public.itsm_create_service_request('10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003','Historical assignment request','Preserve group assignment after archival')->>'id')::uuid);
INSERT INTO administration_refs VALUES('new_assignment_request',(public.itsm_create_service_request('10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003','New assignment request','Reject new archived group assignment')->>'id')::uuid);
UPDATE public.service_requests SET group_id=(SELECT id FROM administration_refs WHERE label='group') WHERE id=(SELECT id FROM administration_refs WHERE label='assigned_request');
SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',(SELECT id FROM administration_refs WHERE label='group'),'Access team','Archived team',false,
  ARRAY['9b000000-0000-0000-0000-000000000001']::uuid[],1);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',(SELECT id FROM administration_refs WHERE label='group'),'Stale overwrite','',true,'{}',1)$q$,'group changed');
UPDATE public.incidents SET title='Historic archived assignment still editable' WHERE number='ADMIN-ASSIGNMENT';
UPDATE public.service_requests SET state='open' WHERE id=(SELECT id FROM administration_refs WHERE label='assigned_request');
SELECT pg_temp.assert_admin((SELECT group_id=(SELECT id FROM administration_refs WHERE label='group') FROM public.incidents WHERE number='ADMIN-ASSIGNMENT'),'archival preserves existing assignment');
SELECT pg_temp.expect_admin_failure($q$INSERT INTO public.incidents(organization_id,number,title,requester_id,group_id)
VALUES('10000000-0000-0000-0000-000000000001','ADMIN-ARCHIVED','New archived assignment',auth.uid(),(SELECT id FROM administration_refs WHERE label='group'))$q$,'active assignment group');
SELECT pg_temp.expect_admin_failure($q$UPDATE public.service_requests SET group_id=(SELECT id FROM administration_refs WHERE label='group')
WHERE id=(SELECT id FROM administration_refs WHERE label='new_assignment_request')$q$,'active assignment group');

-- Invitation normalization, duplicate handling, member checks and explicit revoke.
INSERT INTO administration_refs VALUES('invite',(public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','  INVITED@EXAMPLE.TEST ',ARRAY['service_desk']::public.app_role[])->>'id')::uuid);
INSERT INTO administration_refs VALUES('rollback',(public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','rollback@example.test',ARRAY['requester']::public.app_role[])->>'id')::uuid);
INSERT INTO administration_refs VALUES('unverified',(public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','unverified@example.test',ARRAY['requester']::public.app_role[])->>'id')::uuid);
INSERT INTO administration_refs VALUES('revoked',(public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','revoked@example.test',ARRAY['requester']::public.app_role[])->>'id')::uuid);
SELECT pg_temp.assert_admin((SELECT email='invited@example.test' AND roles=ARRAY['requester','service_desk']::public.app_role[]
  AND expires_at-created_at=interval '7 days' FROM public.workspace_invitations WHERE id=(SELECT id FROM administration_refs WHERE label='invite')),'invitation normalization, baseline and expiry');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','INVITED@example.test',ARRAY['requester']::public.app_role[])$q$,'pending invitation already');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','disabled@example.test',ARRAY['admin']::public.app_role[])$q$,'already belongs');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','admin-one@example.test',ARRAY['requester']::public.app_role[])$q$,'already belongs');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','not-an-email',ARRAY['requester']::public.app_role[])$q$,'valid email');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','emptyroles@example.test','{}'::public.app_role[])$q$,'at least one role');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_revoke_invitation('10000000-0000-0000-0000-000000000001',(SELECT id FROM administration_refs WHERE label='revoked'),9)$q$,'invitation changed');
SELECT public.itsm_admin_revoke_invitation('10000000-0000-0000-0000-000000000001',(SELECT id FROM administration_refs WHERE label='revoked'),1);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_revoke_invitation('10000000-0000-0000-0000-000000000001',(SELECT id FROM administration_refs WHERE label='revoked'),2)$q$,'Only pending');

RESET ROLE;
INSERT INTO public.workspace_invitations(organization_id,email,roles,invited_by,created_at,expires_at)
VALUES('10000000-0000-0000-0000-000000000001','expired@example.test',ARRAY['requester']::public.app_role[],'9b000000-0000-0000-0000-000000000001',now()-interval '8 days',now()-interval '1 day');
INSERT INTO administration_refs SELECT 'expired',id FROM public.workspace_invitations WHERE email='expired@example.test';
-- Simulate membership disabled after an invitation was issued by trusted provisioning.
INSERT INTO public.workspace_invitations(organization_id,email,roles,invited_by)
VALUES('10000000-0000-0000-0000-000000000001','disabled@example.test',ARRAY['requester']::public.app_role[],'9b000000-0000-0000-0000-000000000001');
INSERT INTO administration_refs SELECT 'disabled',id FROM public.workspace_invitations WHERE email='disabled@example.test';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000007',true);
SELECT set_config('request.jwt.claim.email','invited@example.test',true);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_get_invitation((SELECT id FROM administration_refs WHERE label='invite'))$q$,'verified email');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='invite'))$q$,'verified email');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_get_invitation((SELECT id FROM administration_refs WHERE label='unverified'))$q$,'verified email');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='unverified'))$q$,'verified email');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='disabled'))$q$,'membership is disabled');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_admin(public.itsm_get_invitation((SELECT id FROM administration_refs WHERE label='expired'))->>'status'='expired','expired invitation detail status');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='expired'))$q$,'invitation has expired');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='revoked'))$q$,'accepted or revoked');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_admin(public.itsm_get_invitation((SELECT id FROM administration_refs WHERE label='invite'))->>'email'='invited@example.test','matching verified user can preview invitation');
SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='invite'));
SELECT pg_temp.assert_admin(public.is_org_member('10000000-0000-0000-0000-000000000001')
  AND public.has_role(auth.uid(),'service_desk','10000000-0000-0000-0000-000000000001')
  AND public.has_role(auth.uid(),'requester','10000000-0000-0000-0000-000000000001'),'acceptance creates active membership and exact roles');
SELECT pg_temp.assert_admin(NOT public.has_role(auth.uid(),'admin','10000000-0000-0000-0000-000000000001'),
  'acceptance clears orphan elevated roles instead of activating them');
SELECT public.bootstrap_workspace('Invited member');
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='invite'))$q$,'accepted or revoked');

-- Administration evidence is immutable, server sourced and admin visible only.
SELECT pg_temp.assert_admin(NOT EXISTS(SELECT 1 FROM public.audit_events WHERE record_type IN ('workspace','membership','role_assignment','group','group_membership','workspace_invitation')),'operator cannot read administration evidence');
SELECT pg_temp.expect_admin_failure($q$INSERT INTO public.audit_events(organization_id,record_type,record_id,action,source)
VALUES('10000000-0000-0000-0000-000000000001','membership',auth.uid(),'created','database')$q$,'Administration audit events');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_admin(EXISTS(SELECT 1 FROM public.audit_events WHERE record_type='workspace_invitation'
  AND record_id=(SELECT id FROM administration_refs WHERE label='invite') AND action='updated'
  AND source='database' AND actor_id='9b000000-0000-0000-0000-000000000008'
  AND before_values->>'status'='pending' AND after_values->>'status'='accepted'),'acceptance audit captures actor and state');
SELECT pg_temp.assert_admin(EXISTS(SELECT 1 FROM public.audit_events WHERE record_type='role_assignment'
  AND after_values->>'user_id'='9b000000-0000-0000-0000-000000000008' AND after_values->>'role'='service_desk'),'granted role has transactional evidence');
SELECT pg_temp.expect_admin_failure($q$UPDATE public.audit_events SET action='forged' WHERE record_type='workspace'$q$,'permission denied');
SELECT public.itsm_admin_invite('10000000-0000-0000-0000-000000000001','expired@example.test',ARRAY['requester']::public.app_role[]);
SELECT pg_temp.assert_admin((SELECT status='revoked' AND version=2 FROM public.workspace_invitations WHERE id=(SELECT id FROM administration_refs WHERE label='expired')),'reinvite explicitly revokes expired pending record');

RESET ROLE;
CREATE FUNCTION pg_temp.reject_administration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.record_type IN ('group','role_assignment') THEN RAISE EXCEPTION 'Injected administration audit failure'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER administration_test_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_administration_audit();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-000000000001',NULL,'Rollback group','',true,'{}',NULL)$q$,'Injected administration audit failure');
SELECT pg_temp.assert_admin(NOT EXISTS(SELECT 1 FROM public.groups WHERE name='Rollback group'),'audit failure rolls back group creation');
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation((SELECT id FROM administration_refs WHERE label='rollback'))$q$,'Injected administration audit failure');
RESET ROLE;
SELECT pg_temp.assert_admin(NOT EXISTS(SELECT 1 FROM public.memberships WHERE user_id='9b000000-0000-0000-0000-000000000009'),'role audit failure rolls back invited membership');
SELECT pg_temp.assert_admin((SELECT status='pending' AND version=1 FROM public.workspace_invitations WHERE id=(SELECT id FROM administration_refs WHERE label='rollback')),'failed acceptance leaves pending invitation unchanged');
DROP TRIGGER administration_test_audit_failure ON public.audit_events;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_admin_failure($q$SELECT public.itsm_accept_invitation('00000000-0000-0000-0000-000000000000')$q$,'permission denied');
RESET ROLE;
-- Over 1,000 rows in each directory proves overview is not subject to a hidden
-- application/REST page cap. Bulk fixture writes stay inside this rollback.
INSERT INTO public.memberships(organization_id,user_id)
SELECT '10000000-0000-0000-0000-000000000001',('9b100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,1005) n;
INSERT INTO public.groups(organization_id,name)
SELECT '10000000-0000-0000-0000-000000000001','Bulk administration group '||n FROM generate_series(1,1005) n;
INSERT INTO public.workspace_invitations(organization_id,email,roles,invited_by)
SELECT '10000000-0000-0000-0000-000000000001','bulk-admin-'||n||'@example.test',ARRAY['requester']::public.app_role[],
  '9b000000-0000-0000-0000-000000000001' FROM generate_series(1,1005) n;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE overview jsonb; BEGIN
  overview:=public.itsm_admin_overview('10000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert_admin(jsonb_array_length(overview->'members')=(SELECT count(*) FROM public.memberships WHERE organization_id='10000000-0000-0000-0000-000000000001'),'complete member directory beyond 1000 records');
  PERFORM pg_temp.assert_admin(jsonb_array_length(overview->'groups')=(SELECT count(*) FROM public.groups WHERE organization_id='10000000-0000-0000-0000-000000000001'),'complete group directory beyond 1000 records');
  PERFORM pg_temp.assert_admin(jsonb_array_length(overview->'invitations')=(SELECT count(*) FROM public.workspace_invitations WHERE organization_id='10000000-0000-0000-0000-000000000001'),'complete invitation directory beyond 1000 records');
END; $$;
ROLLBACK;
\echo Administration access, versioned mutations, invitations, group archival and transactional audit checks passed.

-- Real independent sessions prove last-admin safety and permission rechecking
-- after a concurrent administrator revocation has acquired the workspace lock.
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO public.organizations(id,name,slug) VALUES('1b000000-0000-0000-0000-000000000003','Concurrent admin test','admin-test-concurrent');
INSERT INTO public.memberships(organization_id,user_id) VALUES
 ('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000021'),
 ('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000022');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000021','admin'),
 ('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000022','admin');
SELECT dblink_connect('admin_a','dbname=postgres user=postgres application_name=admin_test_a');
SELECT dblink_connect('admin_b','dbname=postgres user=postgres application_name=admin_test_b');
SELECT dblink_exec('admin_a','SET ROLE authenticated');
SELECT dblink_exec('admin_b','SET ROLE authenticated');
SELECT dblink_exec('admin_a',$q$SET request.jwt.claim.sub='9b000000-0000-0000-0000-000000000021'$q$);
SELECT dblink_exec('admin_b',$q$SET request.jwt.claim.sub='9b000000-0000-0000-0000-000000000022'$q$);
SELECT dblink_exec('admin_a','BEGIN');
SELECT * FROM dblink('admin_a',$q$SELECT public.itsm_admin_update_member('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000021',ARRAY['requester']::public.app_role[],true,1)$q$) AS result(value jsonb);
SELECT dblink_send_query('admin_b',$q$SELECT public.itsm_admin_update_member('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000022',ARRAY['requester']::public.app_role[],true,1)$q$);
DO $$ DECLARE waiting boolean:=false; BEGIN
  FOR attempt IN 1..50 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='admin_test_b' AND wait_event_type='Lock') INTO waiting;
    EXIT WHEN waiting; PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT waiting THEN RAISE EXCEPTION 'Concurrent admin removal did not wait on organization lock'; END IF;
END; $$;
SELECT dblink_exec('admin_a','COMMIT');
SELECT * FROM dblink_get_result('admin_b',false) AS result(value jsonb);
DO $$ BEGIN
  IF position('at least one active' IN dblink_error_message('admin_b'))=0 THEN RAISE EXCEPTION 'Last active administrator was not protected'; END IF;
  IF (SELECT count(*) FROM public.memberships m JOIN public.user_roles r USING(organization_id,user_id)
    WHERE m.organization_id='1b000000-0000-0000-0000-000000000003' AND m.is_active AND r.role='admin')<>1 THEN
    RAISE EXCEPTION 'Concurrent removal did not preserve exactly one active admin';
  END IF;
END; $$;
SELECT * FROM dblink_get_result('admin_b',false) AS result(value jsonb);
INSERT INTO public.user_roles(organization_id,user_id,role)
VALUES('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000021','admin');
SELECT dblink_exec('admin_a','BEGIN');
SELECT * FROM dblink('admin_a',$q$SELECT public.itsm_admin_update_member('1b000000-0000-0000-0000-000000000003','9b000000-0000-0000-0000-000000000022',ARRAY['requester']::public.app_role[],true,1)$q$) AS result(value jsonb);
SELECT dblink_send_query('admin_b',$q$SELECT public.itsm_admin_update_workspace('1b000000-0000-0000-0000-000000000003','Unauthorized concurrent overwrite','UTC',1)$q$);
DO $$ DECLARE waiting boolean:=false; BEGIN
  FOR attempt IN 1..50 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='admin_test_b' AND wait_event_type='Lock') INTO waiting;
    EXIT WHEN waiting; PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT waiting THEN RAISE EXCEPTION 'Concurrent workspace edit did not wait on organization lock'; END IF;
END; $$;
SELECT dblink_exec('admin_a','COMMIT');
SELECT * FROM dblink_get_result('admin_b',false) AS result(value jsonb);
DO $$ BEGIN
  IF position('active workspace administrator' IN dblink_error_message('admin_b'))=0 THEN RAISE EXCEPTION 'Admin privilege was not rechecked after the lock'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE name='Unauthorized concurrent overwrite') THEN RAISE EXCEPTION 'Revoked admin changed workspace'; END IF;
END; $$;
SELECT dblink_disconnect('admin_a');
SELECT dblink_disconnect('admin_b');
\echo Concurrent last-admin protection and post-lock administrator revocation checks passed.
