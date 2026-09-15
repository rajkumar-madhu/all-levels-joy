REVOKE ALL ON FUNCTION public.is_org_member(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage(uuid) TO authenticated, service_role;