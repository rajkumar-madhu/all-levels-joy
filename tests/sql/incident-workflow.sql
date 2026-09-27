\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_failure(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected in SQLERRM) = 0 THEN RAISE EXCEPTION 'Unexpected error: %; wanted %', SQLERRM, expected; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END;
$$;

INSERT INTO public.organizations(id, name, slug) VALUES ('10000000-0000-0000-0000-000000000002', 'Other test organization', 'incident-test-other');
INSERT INTO public.memberships(organization_id,user_id) VALUES
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','service_desk'),
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','requester'),
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','change_manager');
INSERT INTO public.groups(id, organization_id, name) VALUES ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other group');
INSERT INTO public.services(id, organization_id, name, code) VALUES ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','Other service','OTHER');
INSERT INTO public.incidents(id, organization_id, number, title, requester_id) VALUES
 ('50000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','INC-TEST-GUARDS','Lifecycle test','90000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);

-- Exercise all 49 state pairs through the real trigger and RLS, not a reimplementation.
DO $$
DECLARE
  from_state public.record_state;
  to_state public.record_state;
  record_id uuid;
  allowed boolean;
BEGIN
  FOREACH from_state IN ARRAY enum_range(NULL::public.record_state) LOOP
    FOREACH to_state IN ARRAY enum_range(NULL::public.record_state) LOOP
      record_id := gen_random_uuid();
      INSERT INTO public.incidents(id, organization_id, number, title, requester_id)
      VALUES(record_id, '10000000-0000-0000-0000-000000000001', 'INC-TEST-' || record_id, 'State pair', auth.uid());
      IF from_state = 'closed' THEN
        UPDATE public.incidents SET state='resolved', resolution_notes='Verified recovery', close_code='solved_permanently' WHERE id=record_id;
      END IF;
      IF from_state <> 'new' THEN
        UPDATE public.incidents SET state=from_state, on_hold_reason='awaiting_vendor', resolution_notes='Verified recovery', close_code='solved_permanently' WHERE id=record_id;
      END IF;
      allowed := from_state = to_state OR
        (from_state='new' AND to_state IN ('open','in_progress','pending','resolved','cancelled')) OR
        (from_state IN ('open','in_progress','pending') AND to_state IN ('open','in_progress','pending','resolved','cancelled')) OR
        (from_state='resolved' AND to_state IN ('open','closed')) OR
        (from_state='closed' AND to_state='open');
      IF allowed THEN
        UPDATE public.incidents SET state=to_state, on_hold_reason='awaiting_vendor', resolution_notes='Verified recovery', close_code='solved_permanently' WHERE id=record_id;
      ELSE
        PERFORM pg_temp.expect_failure(format('UPDATE public.incidents SET state=%L WHERE id=%L',to_state,record_id),'Incident cannot move');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET state='pending' WHERE number='INC-TEST-GUARDS'$q$, 'valid hold reason');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET state='resolved', resolution_notes='  ', close_code='solved_permanently' WHERE number='INC-TEST-GUARDS'$q$, 'resolution notes');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET state='resolved', resolution_notes='Restored', close_code='invalid' WHERE number='INC-TEST-GUARDS'$q$, 'valid close code');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET group_id='20000000-0000-0000-0000-000000000003' WHERE number='INC-TEST-GUARDS'$q$, 'selected group');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET service_id='30000000-0000-0000-0000-000000000004' WHERE number='INC-TEST-GUARDS'$q$, 'selected service');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET assignee_id='90000000-0000-0000-0000-000000000099' WHERE number='INC-TEST-GUARDS'$q$, 'selected assignee');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET organization_id='10000000-0000-0000-0000-000000000002' WHERE number='INC-TEST-GUARDS'$q$, 'cannot be changed');

DO $$
DECLARE before_version timestamptz; resolved_time timestamptz; incident public.incidents; affected integer;
BEGIN
  SELECT updated_at INTO before_version FROM public.incidents WHERE number='INC-TEST-GUARDS';
  UPDATE public.incidents SET category='network' WHERE number='INC-TEST-GUARDS' AND updated_at=before_version;
  UPDATE public.incidents SET category='hardware' WHERE number='INC-TEST-GUARDS' AND updated_at=before_version;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Stale optimistic update changed the incident'; END IF;
  SELECT * INTO incident FROM public.incidents WHERE number='INC-TEST-GUARDS';
  IF incident.first_responded_at IS NOT NULL THEN RAISE EXCEPTION 'Classification falsely counted as response'; END IF;
  UPDATE public.incidents SET assignee_id=auth.uid() WHERE number='INC-TEST-GUARDS';
  UPDATE public.incidents SET state='resolved', resolution_notes='Verified recovery', close_code='solved_workaround' WHERE number='INC-TEST-GUARDS' RETURNING resolved_at INTO resolved_time;
  UPDATE public.incidents SET state='closed', resolved_at='2000-01-01' WHERE number='INC-TEST-GUARDS';
  SELECT * INTO incident FROM public.incidents WHERE number='INC-TEST-GUARDS';
  IF incident.resolved_at <> resolved_time THEN RAISE EXCEPTION 'Closing changed the resolution timestamp'; END IF;
  IF incident.first_responded_at IS NULL THEN RAISE EXCEPTION 'Assignment did not count as response'; END IF;
  UPDATE public.incidents SET state='open', reopen_count=999 WHERE number='INC-TEST-GUARDS';
  SELECT * INTO incident FROM public.incidents WHERE number='INC-TEST-GUARDS';
  IF incident.reopen_count <> 1 OR incident.resolved_at IS NOT NULL OR incident.resolution_notes IS NOT NULL OR incident.close_code IS NOT NULL THEN
    RAISE EXCEPTION 'Reopen did not clear resolution evidence or preserve accurate reopen count';
  END IF;
  UPDATE public.incidents SET category='software', reopen_count=999 WHERE number='INC-TEST-GUARDS';
  SELECT * INTO incident FROM public.incidents WHERE number='INC-TEST-GUARDS';
  IF incident.reopen_count <> 1 THEN RAISE EXCEPTION 'Client overwrote reopen count'; END IF;
END;
$$;

-- Requesters cannot bypass the server role check by writing to the REST table.
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET state='resolved', resolution_notes='Fake fix', close_code='solved_permanently' WHERE number='INC-TEST-GUARDS'$q$, 'permission to manage');
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET assignee_id=auth.uid() WHERE number='INC-TEST-GUARDS'$q$, 'permission to manage');
SELECT pg_temp.expect_failure($q$INSERT INTO public.incidents(organization_id,number,title,requester_id,state) VALUES('10000000-0000-0000-0000-000000000001','INC-TEST-FAKE','Fake terminal incident',auth.uid(),'closed')$q$, 'must start in new');

-- Change managers retain command-center linkage without gaining incident operations.
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
UPDATE public.incidents SET major_incident=true WHERE number='INC-TEST-GUARDS';
SELECT pg_temp.expect_failure($q$UPDATE public.incidents SET state='resolved', resolution_notes='Fake fix', close_code='solved_permanently' WHERE number='INC-TEST-GUARDS'$q$, 'permission to manage');

-- An unrelated authenticated identity cannot even read or update the record.
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000099',true);
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.incidents SET title='Cross-tenant write' WHERE number='INC-TEST-GUARDS';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Outsider changed an incident'; END IF;
  IF EXISTS (SELECT 1 FROM public.incidents WHERE number='INC-TEST-GUARDS') THEN RAISE EXCEPTION 'Outsider read an incident'; END IF;
END;
$$;
ROLLBACK;
\echo Incident database lifecycle, RLS, tenant and concurrency checks passed.
