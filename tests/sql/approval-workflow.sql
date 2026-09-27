\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_approval_failure(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected in SQLERRM)=0 THEN RAISE EXCEPTION 'Unexpected error: %; wanted %',SQLERRM,expected; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %',statement;
END;
$$;
CREATE FUNCTION pg_temp.check_approval(condition boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END;
$$;

INSERT INTO public.memberships(organization_id,user_id,is_active) VALUES
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',true),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',true),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',true),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004',false),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000005',true);
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','admin'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','cab_member'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','admin'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003','manager'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003','cab_member'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004','admin'),
 ('10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000005','requester');
INSERT INTO public.organizations(id,name,slug) VALUES('11000000-0000-0000-0000-000000000001','Approval other tenant','approval-other-tenant');
INSERT INTO public.catalog_items(id,organization_id,name,category) VALUES('41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Other tenant item','Hardware');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE approval_test_subjects(name text PRIMARY KEY,id uuid);
CREATE TEMP TABLE approval_test_input(data jsonb);
INSERT INTO approval_test_input VALUES ('{
 "title":"Upgrade gateway","description":"Upgrade the production gateway","changeType":"normal","risk":"medium",
 "implementationPlan":"Upgrade one node at a time","testPlan":"Run health checks","rollbackPlan":"Restore previous image",
 "businessJustification":"Improve reliability","impactAssessment":"One node offline at a time","expectedOutageMinutes":0,
 "affectedCiIds":["80000000-0000-0000-0000-000000000001"],"validationPlan":"Verify customer traffic",
 "rollbackTrigger":"Error rate increases","communicationPlan":"Notify service owners","startAt":"2026-01-01T01:00:00Z","endAt":"2026-01-01T02:00:00Z"
}');
INSERT INTO approval_test_subjects SELECT 'request',(public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Laptop request','Replace broken laptop')->>'id')::uuid;
SELECT pg_temp.check_approval((SELECT count(*)=2 FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request')),'Approvers must be distinct, active and independent');
SELECT pg_temp.check_approval(NOT EXISTS(SELECT 1 FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request') AND approver_id IN ('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004')),'Self or inactive approver selected');
SELECT pg_temp.check_approval((SELECT state='pending' AND approval_status='requested' FROM public.service_requests WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')),'Approval request must start pending');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.service_requests SET state='open' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'All designated approvers');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.service_requests SET approval_status='not_required',state='open' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'approval requirement cannot be changed');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.service_requests SET catalog_item_id='40000000-0000-0000-0000-000000000003' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'scope cannot be changed');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.approvals SET approver_id=auth.uid() WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'permission denied');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.approvals SET status='approved' WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'permission denied');
SELECT pg_temp.expect_approval_failure($q$DELETE FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request')$q$,'permission denied');
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_decide_approval((SELECT id FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request') LIMIT 1),'approved')$q$,'not assigned');
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','Cross tenant','Not an allowed item')$q$,'not available');

SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request') AND approver_id=auth.uid();
SELECT pg_temp.check_approval((SELECT state='pending' FROM public.service_requests WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')),'First approval opened an ALL-policy request');
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request') AND approver_id=auth.uid()$q$,'already been decided');
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true);
SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='request') AND approver_id=auth.uid();
SELECT pg_temp.check_approval((SELECT state='open' AND approval_status='approved' FROM public.service_requests WHERE id=(SELECT id FROM approval_test_subjects WHERE name='request')),'All approval decisions failed to open request');

SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
INSERT INTO approval_test_subjects SELECT 'rejected',(public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Rejected laptop','Purchase not required')->>'id')::uuid;
INSERT INTO approval_test_subjects SELECT 'change',(public.itsm_create_change('10000000-0000-0000-0000-000000000001',data)->>'id')::uuid FROM approval_test_input;
INSERT INTO approval_test_subjects SELECT 'standard',(public.itsm_create_change('10000000-0000-0000-0000-000000000001',data||'{"changeType":"standard"}'::jsonb)->>'id')::uuid FROM approval_test_input;
SELECT pg_temp.check_approval((SELECT state='open' AND approval_status='not_required' FROM public.changes WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard')),'Standard change exemption broken');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.changes SET state='in_progress' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='change')$q$,'All designated approvers');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.changes SET change_type='standard',approval_status='not_required' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='change')$q$,'scope cannot be changed');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.changes SET state='resolved' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard')$q$,'Invalid change lifecycle');
UPDATE public.changes SET state='in_progress' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard');
SELECT pg_temp.expect_approval_failure($q$UPDATE public.changes SET state='resolved' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard')$q$,'Delivery outcome');
UPDATE public.changes SET state='resolved',delivery_outcome='successful',validation_results='All probes passed',pir_notes='Delivered without issues' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard');
UPDATE public.changes SET state='closed' WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard');
SELECT pg_temp.check_approval((SELECT actual_start_at IS NOT NULL AND delivered_at IS NOT NULL AND closed_at IS NOT NULL FROM public.changes WHERE id=(SELECT id FROM approval_test_subjects WHERE name='standard')),'Delivery timestamps missing');

SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_decide_approval(id,'rejected',' ') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='rejected') AND approver_id=auth.uid()$q$,'Decision notes are required');
SELECT public.itsm_decide_approval(id,'rejected','Purchase not justified') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='rejected') AND approver_id=auth.uid();
SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='change') AND approver_id=auth.uid();
SELECT pg_temp.check_approval((SELECT state='pending' FROM public.changes WHERE id=(SELECT id FROM approval_test_subjects WHERE name='change')),'First CAB approval opened an ALL-policy change');
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true);
SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='change') AND approver_id=auth.uid();
SELECT pg_temp.check_approval((SELECT state='open' AND approval_status='approved' FROM public.changes WHERE id=(SELECT id FROM approval_test_subjects WHERE name='change')),'All CAB approvals did not open the change');
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_decide_approval(id,'approved') FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='rejected') AND approver_id=auth.uid()$q$,'already been decided');
SELECT pg_temp.check_approval((SELECT state='cancelled' AND approval_status='rejected' FROM public.service_requests WHERE id=(SELECT id FROM approval_test_subjects WHERE name='rejected')),'Rejection must remain final');
SELECT pg_temp.check_approval(NOT EXISTS(SELECT 1 FROM public.approvals WHERE record_id=(SELECT id FROM approval_test_subjects WHERE name='rejected') AND status='requested'),'Rejected records left stale pending approval tasks');

-- Missing independent approvers is a failure with no partial parent/notification writes.
RESET ROLE;
UPDATE public.memberships SET is_active=false WHERE user_id IN ('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','No approver request','Must not be created')$q$,'No eligible independent approver');
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_create_change('10000000-0000-0000-0000-000000000001',data) FROM approval_test_input$q$,'No eligible independent approver');
SELECT pg_temp.check_approval(NOT EXISTS(SELECT 1 FROM public.service_requests WHERE title='No approver request'),'Failed creation left a partial parent');

-- Inject notification failure after parent+approval insertion to prove transaction rollback.
RESET ROLE;
UPDATE public.memberships SET is_active=true WHERE user_id IN ('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003');
CREATE FUNCTION pg_temp.reject_approval_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected notification failure'; END; $$;
CREATE TRIGGER approval_test_notification_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_approval_notification();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_approval_failure($q$SELECT public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Rollback request','Must roll back the entire transaction')$q$,'Injected notification failure');
SELECT pg_temp.check_approval(NOT EXISTS(SELECT 1 FROM public.service_requests WHERE title='Rollback request'),'Notification failure left a parent record');
RESET ROLE;
DROP TRIGGER approval_test_notification_failure ON public.notifications;
ROLLBACK;
\echo Approval creation, ALL-policy decisions, role, scope, lifecycle and rollback checks passed.

-- Independent sessions test real parent-lock serialization. Disposable database only.
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO public.memberships(organization_id,user_id) VALUES
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000003');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','requester'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000003','manager');
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',false);
SELECT public.itsm_create_service_request('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Concurrent approvals','Concurrent decisions serialize at the parent row');
SELECT dblink_connect('approval_a','dbname=postgres user=postgres application_name=approval_test_a');
SELECT dblink_connect('approval_b','dbname=postgres user=postgres application_name=approval_test_b');
SELECT dblink_exec('approval_a','SET ROLE authenticated');
SELECT dblink_exec('approval_b','SET ROLE authenticated');
SELECT dblink_exec('approval_a',$q$SET request.jwt.claim.sub='92000000-0000-0000-0000-000000000002'$q$);
SELECT dblink_exec('approval_b',$q$SET request.jwt.claim.sub='92000000-0000-0000-0000-000000000003'$q$);
SELECT dblink_exec('approval_a','BEGIN');
SELECT * FROM dblink('approval_a',$q$SELECT public.itsm_decide_approval(a.id,'approved') FROM public.approvals a JOIN public.service_requests r ON r.id=a.record_id WHERE r.title='Concurrent approvals' AND a.approver_id=auth.uid()$q$) AS result(value jsonb);
SELECT dblink_send_query('approval_b',$q$SELECT public.itsm_decide_approval(a.id,'approved') FROM public.approvals a JOIN public.service_requests r ON r.id=a.record_id WHERE r.title='Concurrent approvals' AND a.approver_id=auth.uid()$q$);
DO $$
DECLARE waiting boolean:=false;
BEGIN
  FOR attempt IN 1..50 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='approval_test_b' AND wait_event_type='Lock') INTO waiting;
    EXIT WHEN waiting;
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT waiting THEN RAISE EXCEPTION 'Concurrent approval did not wait on the parent lock'; END IF;
END;
$$;
SELECT dblink_exec('approval_a','COMMIT');
SELECT * FROM dblink_get_result('approval_b') AS result(value jsonb);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.service_requests WHERE title='Concurrent approvals' AND state='open' AND approval_status='approved') THEN
    RAISE EXCEPTION 'Serialized approvals lost a decision or failed to open the record';
  END IF;
  IF (SELECT count(*) FROM public.notifications WHERE title LIKE '% approved' AND record_id=(SELECT id FROM public.service_requests WHERE title='Concurrent approvals'))<>1 THEN
    RAISE EXCEPTION 'Final approval notification was not sent exactly once';
  END IF;
END; $$;
SELECT dblink_disconnect('approval_a');
SELECT dblink_disconnect('approval_b');
\echo Concurrent independent approvals serialized and final state/notification checks passed.
