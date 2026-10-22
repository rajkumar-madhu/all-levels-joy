-- Database secrets name their engine so the live rotation backend knows how to change the password.
ALTER TABLE public.pam_secrets ADD COLUMN database_engine text
  CHECK (database_engine IS NULL OR database_engine IN ('postgresql', 'mysql'));
UPDATE public.pam_secrets SET database_engine = 'postgresql' WHERE template = 'database';
ALTER TABLE public.pam_secrets ADD CONSTRAINT pam_database_engine_matches_template
  CHECK ((template = 'database') = (database_engine IS NOT NULL));
GRANT SELECT (database_engine), UPDATE (database_engine) ON public.pam_secrets TO authenticated;
