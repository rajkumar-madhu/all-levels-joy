\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_true(actual boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'Access assertion failed: %', description; END IF;
END; $$;
CREATE FUNCTION pg_temp.expect_failure(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected in SQLERRM) = 0 THEN RAISE EXCEPTION 'Unexpected error: %; wanted %', SQLERRM, expected; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END; $$;

INSERT INTO public.organizations(id,name,slug)
VALUES('10000000-0000-0000-0000-000000000002','Access test foreign tenant','access-test-foreign');
INSERT INTO public.memberships(organization_id,user_id,is_active) VALUES
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001',true),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000002',true),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003',true),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000004',false),
 ('10000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000005',true),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000006',true);
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','requester'),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000002','requester'),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','service_desk'),
 ('10000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000004','admin'),
 ('10000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000005','admin');
INSERT INTO public.profiles(id,display_name,status) VALUES
 ('9a000000-0000-0000-0000-000000000004','Disabled member','inactive'),
 ('9a000000-0000-0000-0000-000000000006','Preserve my profile','active');
INSERT INTO public.incidents(id,organization_id,number,title,requester_id) VALUES
 ('5a000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ACCESS-INC-OWN','Private employee case','9a000000-0000-0000-0000-000000000001'),
 ('5a000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ACCESS-INC-PEER','Another employee case','9a000000-0000-0000-0000-000000000002'),
 ('5a000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','ACCESS-INC-FOREIGN','Foreign employee case','9a000000-0000-0000-0000-000000000005');
INSERT INTO public.service_requests(id,organization_id,number,title,requester_id,catalog_item_id) VALUES
 ('6a000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ACCESS-REQ-OWN','Private request','9a000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003'),
 ('6a000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ACCESS-REQ-PEER','Another request','9a000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003');
INSERT INTO public.changes(id,organization_id,number,title,requester_id,change_type,state,owner_id) VALUES
 ('7a000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ACCESS-CHG-OWN','Private change','9a000000-0000-0000-0000-000000000001','standard','open','9a000000-0000-0000-0000-000000000001'),
 ('7a000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ACCESS-CHG-PEER','Another change','9a000000-0000-0000-0000-000000000002','standard','open','9a000000-0000-0000-0000-000000000002');
INSERT INTO public.knowledge_articles(id,organization_id,number,title,status,author_id) VALUES
 ('8a000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ACCESS-KB-PUBLIC','Published help','published',NULL),
 ('8a000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ACCESS-KB-DRAFT','Internal draft','draft','9a000000-0000-0000-0000-000000000001');
INSERT INTO public.record_comments(organization_id,record_type,record_id,author_id,body,internal) VALUES
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','ACCESS visible reply',false),
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','ACCESS internal diagnosis',true),
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000003','ACCESS peer reply',false),
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000003','ACCESS forged cross-org parent',false);
INSERT INTO public.attachments(organization_id,record_type,record_id,uploader_id,storage_path,file_name) VALUES
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000001/own.txt','ACCESS own.txt'),
 ('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000002/peer.txt','ACCESS peer.txt');
GRANT SELECT,INSERT ON storage.objects TO authenticated;
INSERT INTO storage.objects(id,bucket_id,name) VALUES
 ('aa000000-0000-0000-0000-000000000001','itsm-evidence','10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000001/own.txt'),
 ('aa000000-0000-0000-0000-000000000002','itsm-evidence','10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000002/peer.txt');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000006',true);
SELECT public.bootstrap_workspace('Ignore replacement name');
SELECT public.bootstrap_workspace('Ignore replacement name again');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_roles WHERE user_id = auth.uid())
  AND public.has_role(auth.uid(),'requester','10000000-0000-0000-0000-000000000001'), 'bootstrap adds only one requester role');
SELECT pg_temp.assert_true((SELECT display_name = 'Preserve my profile' FROM public.profiles WHERE id = auth.uid()), 'bootstrap preserves existing profile');
SELECT pg_temp.assert_true(NOT public.can_manage('10000000-0000-0000-0000-000000000001'), 'bootstrap does not grant staff privilege');

SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000001',true);
SELECT public.bootstrap_workspace('First requester');
SELECT pg_temp.assert_true((SELECT display_name = 'First requester' FROM public.profiles WHERE id = auth.uid()), 'bootstrap creates missing own profile');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.incidents WHERE number LIKE 'ACCESS-%'), 'requester sees own incident only');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.service_requests WHERE number LIKE 'ACCESS-%'), 'requester sees own request only');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.changes WHERE number LIKE 'ACCESS-%'), 'requester sees own change only');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.knowledge_articles WHERE number LIKE 'ACCESS-%'), 'requester sees published knowledge only even if draft author');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.record_comments WHERE body LIKE 'ACCESS%'), 'internal notes and inaccessible-parent comments stay private');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.attachments WHERE file_name LIKE 'ACCESS%'), 'attachments follow parent access');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'itsm-evidence'), 'storage downloads follow parent access');
SELECT pg_temp.assert_true(NOT public.can_access_record('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000003'), 'cross-tenant parent mismatch is denied');
SELECT pg_temp.assert_true(NOT public.can_access_record('10000000-0000-0000-0000-000000000001','unsupported','5a000000-0000-0000-0000-000000000001'), 'unknown parent type is denied');
SELECT pg_temp.assert_true(NOT public.can_access_evidence_path('invalid/incident/not-a-uuid/file.txt'), 'malformed paths fail closed without cast errors');

INSERT INTO public.record_comments(organization_id,record_type,record_id,author_id,body)
VALUES('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001',auth.uid(),'Requester follow-up');
SELECT pg_temp.expect_failure($q$INSERT INTO public.record_comments(organization_id,record_type,record_id,author_id,body,internal)
VALUES('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001',auth.uid(),'Fake internal note',true)$q$,'row-level security');
SELECT pg_temp.expect_failure($q$INSERT INTO public.record_comments(organization_id,record_type,record_id,author_id,body)
VALUES('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000002',auth.uid(),'Peer injection')$q$,'row-level security');
SELECT pg_temp.expect_failure($q$INSERT INTO public.attachments(organization_id,record_type,record_id,uploader_id,storage_path,file_name)
VALUES('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001',auth.uid(),'10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000002/stolen.txt','stolen.txt')$q$,'row-level security');
SELECT pg_temp.expect_failure($q$INSERT INTO storage.objects(id,bucket_id,name)
VALUES(gen_random_uuid(),'itsm-evidence','10000000-0000-0000-0000-000000000001/incident/5a000000-0000-0000-0000-000000000002/injection.txt')$q$,'row-level security');
SELECT pg_temp.expect_failure($q$INSERT INTO public.memberships(organization_id,user_id)
VALUES('10000000-0000-0000-0000-000000000002',auth.uid())$q$,'row-level security');
SELECT pg_temp.expect_failure($q$INSERT INTO public.user_roles(organization_id,user_id,role)
VALUES('10000000-0000-0000-0000-000000000001',auth.uid(),'admin')$q$,'permission denied');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET major_incident=true WHERE number='ACCESS-INC-OWN'$q$,'permission to manage');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET created_at='2000-01-01' WHERE number='ACCESS-INC-OWN'$q$,'permission to manage');
SELECT pg_temp.expect_failure($q$INSERT INTO public.incidents(organization_id,number,title,requester_id,first_responded_at)
VALUES('10000000-0000-0000-0000-000000000001','ACCESS-FAKE-RESPONSE','Fake response',auth.uid(),now())$q$,'operational fields');
INSERT INTO public.incidents(organization_id,number,title,requester_id,sla_due_at,created_at)
VALUES('10000000-0000-0000-0000-000000000001','ACCESS-INC-CLOCK','Clock guarded',auth.uid(),'2099-01-01','2000-01-01');
SELECT pg_temp.assert_true((SELECT created_at > now() - interval '1 minute' AND sla_due_at < now() + interval '25 hours'
  FROM public.incidents WHERE number='ACCESS-INC-CLOCK'), 'requester cannot tamper with creation or SLA clocks');
UPDATE public.incidents SET description='Requester additional context' WHERE number='ACCESS-INC-OWN';
SELECT pg_temp.assert_true((SELECT description='Requester additional context' FROM public.incidents WHERE number='ACCESS-INC-OWN'), 'requester can add descriptive context');
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.service_requests SET state='closed' WHERE number='ACCESS-REQ-OWN';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Requester directly advanced request lifecycle'; END IF;
  UPDATE public.changes SET state='closed' WHERE number='ACCESS-CHG-OWN';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Requester directly advanced change lifecycle'; END IF;
  UPDATE public.knowledge_articles SET status='published' WHERE number='ACCESS-KB-DRAFT';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Requester directly published knowledge'; END IF;
END; $$;

SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.incidents WHERE number LIKE 'ACCESS-%'), 'operator sees workspace incidents including requester submission');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.service_requests WHERE number LIKE 'ACCESS-%'), 'operator sees workspace requests');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.changes WHERE number LIKE 'ACCESS-%'), 'operator sees workspace changes');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.knowledge_articles WHERE number LIKE 'ACCESS-%'), 'operator sees draft and published knowledge');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.record_comments WHERE body LIKE 'ACCESS%'), 'operator sees internal notes but not forged foreign parent');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM storage.objects WHERE bucket_id='itsm-evidence'), 'operator can read tenant evidence');
UPDATE public.incidents SET state='open' WHERE number='ACCESS-INC-PEER';
SELECT pg_temp.assert_true((SELECT state='open' FROM public.incidents WHERE number='ACCESS-INC-PEER'), 'operator incident lifecycle still works');

-- Disabling membership revokes privileges even while staff role rows remain.
SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.expect_failure($q$SELECT public.bootstrap_workspace('Reactivate me')$q$,'does not have active access');
SELECT pg_temp.assert_true(NOT public.has_role(auth.uid(),'admin','10000000-0000-0000-0000-000000000001')
  AND NOT public.can_manage('10000000-0000-0000-0000-000000000001'), 'inactive membership disables stale admin role');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incidents), 'inactive member cannot read incidents');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.record_comments), 'inactive member cannot read internal notes');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects), 'inactive member cannot download evidence');
SELECT pg_temp.expect_failure($q$INSERT INTO public.record_comments(organization_id,record_type,record_id,author_id,body)
VALUES('10000000-0000-0000-0000-000000000001','incident','5a000000-0000-0000-0000-000000000001',auth.uid(),'Inactive injection')$q$,'row-level security');

SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.expect_failure($q$SELECT public.bootstrap_workspace('Foreign administrator')$q$,'does not have active access');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.incidents WHERE number LIKE 'ACCESS-%'), 'foreign admin sees own tenant only');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.service_requests), 'foreign admin cannot read primary workspace requests');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.record_comments), 'foreign admin cannot read primary workspace comments');
SELECT pg_temp.assert_true(NOT public.can_manage('10000000-0000-0000-0000-000000000001'), 'foreign admin has no primary workspace privileges');

SELECT set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000099',true);
SELECT pg_temp.expect_failure($q$SELECT public.bootstrap_workspace('Uninvited')$q$,'does not have active access');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incidents), 'uninvited identity cannot read incidents');
SELECT pg_temp.expect_failure($q$INSERT INTO public.memberships(organization_id,user_id)
VALUES('10000000-0000-0000-0000-000000000001',auth.uid())$q$,'row-level security');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.memberships WHERE user_id='9a000000-0000-0000-0000-000000000099'), 'bootstrap did not self-enroll outsider');
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.memberships WHERE user_id='9a000000-0000-0000-0000-000000000004'), 'bootstrap did not reactivate membership');
SELECT pg_temp.assert_true((SELECT status='inactive' FROM public.profiles WHERE id='9a000000-0000-0000-0000-000000000004'), 'bootstrap did not reactivate profile');
ROLLBACK;
\echo Workspace access, requester privacy, internal notes, storage and direct-write persona checks passed.
