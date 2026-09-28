\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assignment compatibility: %', description; END IF;
END; $$;
CREATE FUNCTION pg_temp.expect_failure(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected in SQLERRM)=0 THEN RAISE EXCEPTION 'Unexpected error: %; expected %',SQLERRM,expected; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %',statement;
END; $$;

INSERT INTO public.organizations(id,name,slug) VALUES
('10000000-0000-0000-0000-00000000009a','Assignment compatibility','assignment-compatibility');
INSERT INTO public.memberships(organization_id,user_id) VALUES
('10000000-0000-0000-0000-00000000009a','9c000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-00000000009a','9c000000-0000-0000-0000-000000000002');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
('10000000-0000-0000-0000-00000000009a','9c000000-0000-0000-0000-000000000001','admin'),
('10000000-0000-0000-0000-00000000009a','9c000000-0000-0000-0000-000000000002','requester');
INSERT INTO public.groups(id,organization_id,name) VALUES
('2c000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000009a','Retiring support group');
INSERT INTO public.catalog_items(id,organization_id,name,category,approval_required) VALUES
('4c000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000009a','Compatibility item','Software',false);
INSERT INTO public.service_requests(id,organization_id,number,title,requester_id,catalog_item_id,assignee_id,group_id) VALUES
('6c000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000009a','COMPAT-REQ-OLD','Historical assignment','9c000000-0000-0000-0000-000000000001','4c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000002','2c000000-0000-0000-0000-000000000001'),
('6c000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000009a','COMPAT-REQ-NEW','No assignment','9c000000-0000-0000-0000-000000000001','4c000000-0000-0000-0000-000000000001',NULL,NULL);
INSERT INTO public.changes(id,organization_id,number,title,requester_id,owner_id,change_type,state,start_at,end_at) VALUES
('7c000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000009a','COMPAT-CHG-OLD','Historical ownership','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000002','standard','open',now()-interval '1 hour',now()+interval '1 hour');

SELECT set_config('request.jwt.claim.sub','9c000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.itsm_admin_update_member('10000000-0000-0000-0000-00000000009a','9c000000-0000-0000-0000-000000000002',ARRAY['requester']::public.app_role[],false,1);
SELECT public.itsm_admin_save_group('10000000-0000-0000-0000-00000000009a','2c000000-0000-0000-0000-000000000001','Retiring support group','',false,ARRAY[]::uuid[],1);

UPDATE public.service_requests SET state='in_progress' WHERE number='COMPAT-REQ-OLD';
SELECT pg_temp.assert_true((SELECT state='in_progress' FROM public.service_requests WHERE number='COMPAT-REQ-OLD'), 'another operator can work a request with inactive historical assignee and archived group');
UPDATE public.changes SET state='in_progress' WHERE number='COMPAT-CHG-OLD';
SELECT pg_temp.assert_true((SELECT state='in_progress' FROM public.changes WHERE number='COMPAT-CHG-OLD'), 'another operator can implement a change after historical owner deactivation');
SELECT pg_temp.expect_failure($q$UPDATE public.service_requests SET assignee_id='9c000000-0000-0000-0000-000000000002' WHERE number='COMPAT-REQ-NEW'$q$,'active organization member');

RESET ROLE;
SELECT pg_temp.expect_failure($q$INSERT INTO public.changes(organization_id,number,title,requester_id,owner_id,change_type,state)
VALUES('10000000-0000-0000-0000-00000000009a','COMPAT-CHG-BAD','Inactive new owner','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000002','standard','open')$q$,'active organization member');
ROLLBACK;
\echo Deactivation and group archival preserve historical work while rejecting new inactive assignment.
