CREATE POLICY incidents_requester_read ON public.incidents FOR SELECT TO authenticated
  USING (requester_id = auth.uid());
CREATE POLICY requests_requester_read ON public.service_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid());