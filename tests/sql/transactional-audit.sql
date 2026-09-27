\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_audit_failure(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Unexpected error: %; wanted %', SQLERRM, expected;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END;
$$;

INSERT INTO public.memberships(organization_id,user_id) VALUES
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002');
INSERT INTO public.user_roles(organization_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','service_desk'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','manager'),
 ('10000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002','requester');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
INSERT INTO public.incidents(id,organization_id,number,title,description,requester_id)
VALUES('52000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  'INC-AUDIT-TEST','PRIVATE-TEXT-MARKER','PRIVATE-TEXT-MARKER',auth.uid());
UPDATE public.incidents SET state='resolved',resolution_notes='PRIVATE-TEXT-MARKER',
  close_code='solved_permanently',resolved_at='2000-01-01'
WHERE id='52000000-0000-0000-0000-000000000001';

DO $$
DECLARE incident public.incidents; event public.audit_events;
BEGIN
  IF (SELECT count(*) FROM public.audit_events WHERE record_id='52000000-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Direct authenticated insert/update did not produce exactly two audit events';
  END IF;
  SELECT * INTO STRICT event FROM public.audit_events
    WHERE record_id='52000000-0000-0000-0000-000000000001' AND action='created';
  IF event.before_values IS NOT NULL OR event.after_values->>'state' <> 'new'
    OR event.after_values->>'priority' <> '5' THEN
    RAISE EXCEPTION 'Created event does not contain actual generated row metadata';
  END IF;
  SELECT * INTO STRICT incident FROM public.incidents WHERE id='52000000-0000-0000-0000-000000000001';
  SELECT * INTO STRICT event FROM public.audit_events
    WHERE record_id=incident.id AND action='updated';
  IF event.record_type <> 'incident' OR event.source <> 'database'
    OR event.organization_id <> incident.organization_id OR event.actor_id <> auth.uid()
    OR event.before_values->>'state' <> 'new' OR event.after_values->>'state' <> 'resolved'
    OR (event.after_values->>'resolved_at')::timestamptz IS DISTINCT FROM incident.resolved_at
    OR (event.after_values->>'updated_at')::timestamptz IS DISTINCT FROM incident.updated_at
    OR incident.resolved_at <= '2000-01-02'::timestamptz
    OR event.created_at < incident.resolved_at THEN
    RAISE EXCEPTION 'Audit actor, mapping, before/after or final trigger-derived timestamps are incorrect';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_events WHERE record_id=incident.id
      AND (coalesce(before_values::text,'') || coalesce(after_values::text,'')) LIKE '%PRIVATE-TEXT-MARKER%') THEN
    RAISE EXCEPTION 'Audit copied sensitive free-text fields';
  END IF;
END;
$$;

-- API users cannot manufacture lifecycle evidence or impersonate its source.
SELECT pg_temp.expect_audit_failure($q$INSERT INTO public.audit_events(organization_id,record_type,record_id,action,source,actor_id)
 VALUES('10000000-0000-0000-0000-000000000001','incident','52000000-0000-0000-0000-000000000001','updated','database',auth.uid())$q$,
 'written only by database triggers');
SELECT pg_temp.expect_audit_failure($q$INSERT INTO public.audit_events(organization_id,record_type,record_id,action)
 VALUES('10000000-0000-0000-0000-000000000001','knowledge','52000000-0000-0000-0000-000000000001','approval_approved')$q$,
 'written only by database triggers');
SELECT pg_temp.expect_audit_failure('SELECT public.append_core_audit_event()', 'permission denied');
SELECT pg_temp.expect_audit_failure($q$UPDATE public.audit_events SET action='forged' WHERE record_id='52000000-0000-0000-0000-000000000001'$q$, 'permission denied');
SELECT pg_temp.expect_audit_failure($q$DELETE FROM public.audit_events WHERE record_id='52000000-0000-0000-0000-000000000001'$q$, 'permission denied');
SELECT pg_temp.expect_audit_failure('TRUNCATE public.audit_events', 'permission denied');

-- Legacy application events cannot spoof actor, time, correlation, database
-- source, ID or a core snapshot, and are kept distinct from row evidence.
INSERT INTO public.audit_events(id,organization_id,record_type,record_id,action,source,
  actor_id,created_at,correlation_id,before_values,after_values)
VALUES('a2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  'incident','52000000-0000-0000-0000-000000000001','comment_added','database',
  '92000000-0000-0000-0000-000000000099','2000-01-01',
  'a2000000-0000-0000-0000-000000000002','{"state":"fake"}','{"state":"fake"}');
DO $$
DECLARE event public.audit_events;
BEGIN
  SELECT * INTO STRICT event FROM public.audit_events
    WHERE record_id='52000000-0000-0000-0000-000000000001' AND action='comment_added';
  IF event.actor_id <> auth.uid() OR event.source <> 'application'
    OR event.created_at < transaction_timestamp() OR event.before_values IS NOT NULL
    OR event.after_values IS NOT NULL OR event.id='a2000000-0000-0000-0000-000000000001'
    OR event.correlation_id='a2000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'Application audit metadata can be spoofed';
  END IF;
END;
$$;

RESET ROLE;
-- A failing audit append must undo the incident mutation in its subtransaction.
CREATE FUNCTION pg_temp.fail_audit_append() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_id='52000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'Simulated audit storage failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_fail_audit BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit_append();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_audit_failure($q$UPDATE public.incidents SET state='closed' WHERE id='52000000-0000-0000-0000-000000000001'$q$, 'Simulated audit storage failure');
DO $$
BEGIN
  IF (SELECT state FROM public.incidents WHERE id='52000000-0000-0000-0000-000000000001') <> 'resolved'
    OR (SELECT count(*) FROM public.audit_events WHERE record_id='52000000-0000-0000-0000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'Incident mutation or partial audit survived failed audit append';
  END IF;
END;
$$;
RESET ROLE;
DROP TRIGGER test_fail_audit ON public.audit_events;

-- Trusted maintenance writes still generate evidence; use the table owner to
-- cover DELETE without granting new destructive API privileges to end users.
DELETE FROM public.incidents WHERE id='52000000-0000-0000-0000-000000000001';
INSERT INTO public.service_requests(id,organization_id,number,title,requester_id,catalog_item_id,state,approval_status)
VALUES('52000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
  'REQ-AUDIT-TEST','Audit test','92000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001','pending','requested');
UPDATE public.service_requests SET assignee_id=auth.uid() WHERE id='52000000-0000-0000-0000-000000000002';
INSERT INTO public.changes(id,organization_id,number,title,change_type,requester_id,state)
VALUES('52000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
  'CHG-AUDIT-TEST','Audit test','standard','92000000-0000-0000-0000-000000000002','open');
UPDATE public.changes SET state='in_progress' WHERE id='52000000-0000-0000-0000-000000000003';
INSERT INTO public.approvals(id,organization_id,record_type,record_id,approver_id)
VALUES('52000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
  'request','52000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001');
UPDATE public.approvals SET status='approved',decision_notes='PRIVATE-TEXT-MARKER',decided_at=clock_timestamp()
WHERE id='52000000-0000-0000-0000-000000000004';
DELETE FROM public.approvals WHERE id='52000000-0000-0000-0000-000000000004';
DELETE FROM public.service_requests WHERE id='52000000-0000-0000-0000-000000000002';
DELETE FROM public.changes WHERE id='52000000-0000-0000-0000-000000000003';
DO $$
DECLARE event public.audit_events;
BEGIN
  IF (SELECT count(*) FROM public.audit_events WHERE source='database' AND
    record_id IN ('52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003')) <> 12 THEN
    RAISE EXCEPTION 'Core CRUD or approval mutation is missing audit evidence';
  END IF;
  SELECT * INTO STRICT event FROM public.audit_events
    WHERE record_type='request' AND record_id='52000000-0000-0000-0000-000000000002' AND action='approval_approved';
  IF event.before_values->>'status' <> 'requested' OR event.after_values->>'status' <> 'approved'
    OR event.after_values->>'id' <> '52000000-0000-0000-0000-000000000004'
    OR event.after_values ? 'decision_notes' OR event.actor_id <> auth.uid() THEN
    RAISE EXCEPTION 'Approval metadata, parent mapping or actor is incorrect';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_events WHERE action='deleted'
    AND record_id IN ('52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003')
    AND (before_values IS NULL OR after_values IS NOT NULL)) THEN
    RAISE EXCEPTION 'Deleted event lost its before metadata';
  END IF;
END;
$$;

-- Even trusted direct UPDATE/DELETE/TRUNCATE is guarded against accidental
-- erasure; explicit DBA DDL remains outside the app's threat boundary.
SELECT pg_temp.expect_audit_failure($q$UPDATE public.audit_events SET action='forged'$q$, 'Audit events are immutable');
SELECT pg_temp.expect_audit_failure($q$DELETE FROM public.audit_events$q$, 'Audit events are immutable');
SELECT pg_temp.expect_audit_failure('TRUNCATE public.audit_events', 'Audit events are immutable');

-- Exercise the real SECURITY DEFINER approval RPCs. Fail the parent audit after
-- the approval has already written its own audit: the entire decision, both
-- evidence rows and requester notification must still roll back together.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000002',true);
SELECT public.itsm_create_service_request('10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','Audit transactional approval RPC',
  'PRIVATE-TEXT-MARKER');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_approved_parent_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_type='request' AND NEW.action='updated'
    AND NEW.after_values->>'approval_status'='approved' THEN
    RAISE EXCEPTION 'Simulated parent audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_fail_approved_audit BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_approved_parent_audit();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE subject_id uuid; approval_id uuid;
BEGIN
  SELECT id INTO STRICT subject_id FROM public.service_requests WHERE title='Audit transactional approval RPC';
  SELECT id INTO STRICT approval_id FROM public.approvals WHERE record_type='request' AND record_id=subject_id;
  PERFORM pg_temp.expect_audit_failure(format('SELECT public.itsm_decide_approval(%L,''approved'',NULL)',approval_id), 'Simulated parent audit failure');
  IF (SELECT status FROM public.approvals WHERE id=approval_id) <> 'requested'
    OR (SELECT state FROM public.service_requests WHERE id=subject_id) <> 'pending'
    OR (SELECT count(*) FROM public.audit_events WHERE record_type='request' AND record_id=subject_id) <> 2 THEN
    RAISE EXCEPTION 'RPC mutation or earlier approval evidence survived parent audit failure';
  END IF;
END;
$$;
RESET ROLE;
DO $$
DECLARE subject_id uuid;
BEGIN
  SELECT id INTO STRICT subject_id FROM public.service_requests WHERE title='Audit transactional approval RPC';
  IF (SELECT count(*) FROM public.notifications WHERE record_type='request' AND record_id=subject_id) <> 1 THEN
    RAISE EXCEPTION 'Failed decision generated a notification';
  END IF;
END;
$$;
DROP TRIGGER test_fail_approved_audit ON public.audit_events;
SET LOCAL ROLE authenticated;
DO $$
DECLARE subject_id uuid; approval_id uuid; event public.audit_events;
BEGIN
  SELECT id INTO STRICT subject_id FROM public.service_requests WHERE title='Audit transactional approval RPC';
  SELECT id INTO STRICT approval_id FROM public.approvals WHERE record_type='request' AND record_id=subject_id;
  PERFORM public.itsm_decide_approval(approval_id,'approved',NULL);
  SELECT * INTO STRICT event FROM public.audit_events WHERE record_id=subject_id AND action='approval_approved';
  IF event.actor_id <> auth.uid() OR event.source <> 'database'
    OR event.after_values->>'id' <> approval_id::text OR event.after_values->>'status' <> 'approved' THEN
    RAISE EXCEPTION 'SECURITY DEFINER RPC lost actual deciding actor or approval evidence';
  END IF;
  SELECT * INTO STRICT event FROM public.audit_events WHERE record_id=subject_id AND action='updated';
  IF event.actor_id <> auth.uid() OR event.after_values->>'approval_status' <> 'approved'
    OR event.before_values->>'approval_status' <> 'requested' OR event.after_values->>'state' <> 'open' THEN
    RAISE EXCEPTION 'Parent aggregate approval effect lacks accurate audit evidence';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_events WHERE record_id=subject_id
      AND action IN ('created','approval_requested')
      AND (actor_id IS DISTINCT FROM '92000000-0000-0000-0000-000000000002'::uuid OR source<>'database')) THEN
    RAISE EXCEPTION 'SECURITY DEFINER creation lost actual requester identity';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.audit_events) THEN
    RAISE EXCEPTION 'Requester can read internal operator audit metadata';
  END IF;
END; $$;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000099',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.audit_events) THEN RAISE EXCEPTION 'Outsider can read audit events'; END IF;
END; $$;
SELECT pg_temp.expect_audit_failure($q$INSERT INTO public.audit_events(organization_id,record_type,record_id,action)
 VALUES('10000000-0000-0000-0000-000000000001','incident','52000000-0000-0000-0000-000000000001','comment_added')$q$, 'row-level security');

ROLLBACK;
\echo Transactional audit, immutable metadata, source integrity and privacy checks passed.
