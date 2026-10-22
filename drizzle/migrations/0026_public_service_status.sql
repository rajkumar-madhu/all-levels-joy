CREATE OR REPLACE FUNCTION public.itsm_public_service_status()
RETURNS TABLE(name text, status text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.name::text, s.status::text, s.updated_at
  FROM public.services s
  WHERE s.organization_id = '10000000-0000-0000-0000-000000000001'::uuid
  ORDER BY s.name;
$$;
REVOKE ALL ON FUNCTION public.itsm_public_service_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.itsm_public_service_status() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.itsm_public_service_status() IS 'Public read-only service health projection for the Argus status page. No owners, descriptions, infrastructure, ticket or organization details are returned.';