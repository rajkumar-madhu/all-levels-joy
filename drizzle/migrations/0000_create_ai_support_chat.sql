CREATE TABLE public.ai_chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ai_chat_threads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  suggested_ticket jsonb,
  created_incident_id uuid REFERENCES public.incidents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_chat_threads_user_idx ON public.ai_chat_threads (user_id, updated_at DESC);
CREATE INDEX ai_chat_messages_thread_idx ON public.ai_chat_messages (thread_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_threads TO authenticated;
GRANT ALL ON public.ai_chat_threads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_messages TO authenticated;
GRANT ALL ON public.ai_chat_messages TO service_role;

ALTER TABLE public.ai_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own threads select" ON public.ai_chat_threads FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own threads insert" ON public.ai_chat_threads FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own threads update" ON public.ai_chat_threads FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own threads delete" ON public.ai_chat_threads FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "own messages select" ON public.ai_chat_messages FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own messages insert" ON public.ai_chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));
CREATE POLICY "own messages update" ON public.ai_chat_messages FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own messages delete" ON public.ai_chat_messages FOR DELETE TO authenticated USING (user_id = auth.uid());